import { randomUUID } from 'node:crypto';
import { recordRequestMetric, countRecentFailures, claimAlert } from './db.js';

// --- Request correlation, request metrics and failure alerting. ---
// Everything recorded here is deliberately content-free: a route name, an outcome, an HTTP
// status and a latency. No household data, item names, user IDs, emails, IP addresses or
// request bodies are logged or stored, so the operational signal can be read by anyone
// running the deployment without exposing what the household keeps in it.

const requests = new WeakMap();
const failureOutcomes = new Set(['write_failure', 'server_error']);

export function environment() {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
}

export function beginRequest(req, res) {
  const existing = requests.get(res);
  if (existing) return existing;
  const supplied = String(req.headers?.['x-request-id'] || '');
  const id = /^[A-Za-z0-9._-]{1,80}$/.test(supplied) ? supplied : randomUUID();
  res.setHeader('x-request-id', id);
  const request = { id, started: Date.now() };
  requests.set(res, request);
  return request;
}

export function logFailure({ id, started }, route, status, error) {
  console.error(JSON.stringify({
    event: 'request_failure', requestId: id, route, status,
    latencyMs: Date.now() - started, environment: environment(),
    error: error instanceof Error ? error.name : 'UnknownError',
  }));
}

// A side effect that failed without failing the request it belongs to (an audit row, an
// image cleanup, a metrics prune): worth a correlated line, but not a request failure.
export function logIssue({ id }, route, event, error) {
  console.error(JSON.stringify({
    event, requestId: id, route, environment: environment(),
    error: error instanceof Error ? error.name : 'UnknownError',
  }));
}

// A write that never committed and a server error are the failures worth paging on; auth
// failures and rate limiting are tracked and displayed, but a wrong password is not an outage.
export function classifyOutcome(method, status) {
  const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method).toUpperCase());
  if (status === 401 || status === 403) return 'auth_failure';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return write ? 'write_failure' : 'server_error';
  if (status === 409 && write) return 'write_failure';
  if (status >= 400) return 'client_error';
  return 'ok';
}
export function isFailure(outcome) { return failureOutcomes.has(outcome); }

export function alertPolicy() {
  const number = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    webhook: process.env.ALERT_WEBHOOK_URL || '',
    threshold: number('ALERT_FAILURE_THRESHOLD', 5),
    windowMinutes: number('ALERT_WINDOW_MINUTES', 15),
    cooldownMinutes: number('ALERT_COOLDOWN_MINUTES', 60),
  };
}
export function metricsRetentionDays() {
  const value = Number(process.env.METRICS_RETENTION_DAYS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 14;
}

async function postAlert(payload) {
  const { webhook } = alertPolicy();
  if (!webhook) return false;
  let url;
  try { url = new URL(webhook); } catch { throw new Error('ALERT_WEBHOOK_URL is not a valid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('ALERT_WEBHOOK_URL must be an http(s) URL.');
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Alert webhook responded ${response.status}.`);
  return true;
}

const defaultTelemetry = {
  record: recordRequestMetric,
  countRecentFailures,
  claimAlert,
  sendAlert: postAlert,
};

// Fires at most once per cooldown per route, whichever instance claims it first, so a burst
// of failures is one alert rather than one per request. Without ALERT_WEBHOOK_URL the same
// decision still produces a structured `alert` log line for log-based alerting.
async function maybeAlert(request, route, telemetry) {
  const { threshold, windowMinutes, cooldownMinutes, webhook } = alertPolicy();
  const failures = await telemetry.countRecentFailures(route, windowMinutes);
  if (failures < threshold) return;
  if (!await telemetry.claimAlert(`failures:${route}`, cooldownMinutes)) return;
  const payload = {
    text: `NorthStar Prep: ${failures} failed requests on ${route} in the last ${windowMinutes} minutes (${environment()}).`,
    event: 'alert', reason: 'repeated_request_failures', route, failures,
    windowMinutes, threshold, environment: environment(), requestId: request.id,
  };
  console.error(JSON.stringify(payload));
  if (webhook) await telemetry.sendAlert(payload);
}

async function report(request, route, method, status, telemetry) {
  const latencyMs = Date.now() - request.started;
  const outcome = classifyOutcome(method, status);
  const line = JSON.stringify({
    event: 'request', requestId: request.id, route, method, status, outcome,
    latencyMs, environment: environment(),
  });
  if (isFailure(outcome)) console.error(line); else console.log(line);
  try {
    await telemetry.record({ route, outcome, status, latencyMs });
    if (isFailure(outcome)) await maybeAlert(request, route, telemetry);
  } catch (error) {
    // Metrics and alerting must never turn a served request into a failed one; the
    // structured log line above is the fallback signal when the database is unreachable.
    logIssue(request, route, 'telemetry_failure', error);
  }
}

function statusOf(res) {
  return typeof res?.statusCode === 'number' ? res.statusCode : (res?.code ?? 200);
}

// Wraps an API handler so every response — not just the failures a handler logs itself —
// is correlated, logged and counted.
export function observe(route, handler, telemetry = defaultTelemetry) {
  return async function observedHandler(req, res) {
    const request = beginRequest(req, res);
    try {
      const result = await handler(req, res);
      await report(request, route, req.method, statusOf(res), telemetry);
      return result;
    } catch (error) {
      logFailure(request, route, 500, error);
      await report(request, route, req.method, 500, telemetry);
      throw error;
    }
  };
}

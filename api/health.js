import { database, getMembership, recordRequestMetric, summarizeRequestMetrics } from '../server/db.js';
import { validSession } from '../server/auth.js';
import { alertPolicy, beginRequest, logFailure, logIssue, metricsRetentionDays, observe } from '../server/observability.js';

const metricsWindowMinutes = 1440;

async function probeDatabase() {
  const sql = database();
  await sql`SELECT 1`;
}

// Turns the raw per-route rows into the few numbers a maintainer actually acts on. The rows
// themselves carry no household content, so nothing here can leak what the household stores.
function summarize(rows, retentionDays, latencyMs) {
  const total = outcome => rows.filter(row => row.outcome === outcome).reduce((sum, row) => sum + row.requests, 0);
  const probes = rows.filter(row => row.route === 'database');
  const probeRequests = probes.reduce((sum, row) => sum + row.requests, 0);
  const policy = alertPolicy();
  return {
    windowMinutes: metricsWindowMinutes,
    retentionDays,
    totals: {
      requests: rows.reduce((sum, row) => sum + row.requests, 0),
      failedWrites: total('write_failure'),
      serverErrors: total('server_error'),
      authFailures: total('auth_failure'),
      rateLimited: total('rate_limited'),
    },
    database: {
      latencyMs,
      averageLatencyMs: probeRequests
        ? Math.round(probes.reduce((sum, row) => sum + row.average_latency_ms * row.requests, 0) / probeRequests)
        : null,
      maxLatencyMs: probes.length ? Math.max(...probes.map(row => row.max_latency_ms)) : null,
      probes: probeRequests,
    },
    alerting: {
      webhookConfigured: Boolean(policy.webhook),
      thresholdFailures: policy.threshold,
      windowMinutes: policy.windowMinutes,
      cooldownMinutes: policy.cooldownMinutes,
    },
    routes: rows.map(row => ({
      route: row.route, outcome: row.outcome, requests: row.requests,
      averageLatencyMs: row.average_latency_ms, maxLatencyMs: row.max_latency_ms,
      lastSeen: row.last_seen,
    })),
  };
}

export function createHandler(
  repository = {probeDatabase, getMembership, summarizeRequestMetrics, recordRequestMetric},
  authenticate = validSession,
) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({status: 'error', error: 'Method not allowed.'});

    const started = Date.now();
    let databaseOk = true;
    try { await repository.probeDatabase(); }
    catch (error) { databaseOk = false; logFailure(request, '/api/health', 503, error); }
    const latencyMs = Date.now() - started;
    // Recorded as its own pseudo-route so database latency is visible separately from the
    // request latency of the endpoints that depend on it.
    try { await repository.recordRequestMetric({route: 'database', outcome: databaseOk ? 'ok' : 'server_error', status: databaseOk ? 200 : 503, latencyMs}); }
    catch { /* The probe result is still reported; only its history is lost. */ }

    if (!databaseOk) return res.status(503).json({status: 'error', database: 'unavailable', latencyMs, requestId: request.id, error: 'Database is unavailable.'});
    const body = {status: 'ok', database: 'ok', latencyMs, requestId: request.id};

    // Aggregate counters are household-neutral but still operational detail, so they are
    // shown only to a signed-in member rather than to every unauthenticated caller.
    const session = authenticate(req);
    if (session) {
      try {
        if (await repository.getMembership(session.userId)) {
          const rows = await repository.summarizeRequestMetrics(metricsWindowMinutes);
          body.metrics = summarize(rows, metricsRetentionDays(), latencyMs);
        }
      } catch (error) { logIssue(request, '/api/health', 'metrics_summary_failure', error); }
    }
    return res.status(200).json(body);
  };
}
export default observe('/api/health', createHandler());

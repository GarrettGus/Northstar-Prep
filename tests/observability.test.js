import test from 'node:test';
import assert from 'node:assert/strict';
import { beginRequest, classifyOutcome, isFailure, observe } from '../server/observability.js';
import { createHandler as createHealthHandler } from '../api/health.js';

process.env.SESSION_SECRET = 'test-only-secret-with-more-than-32-characters';
process.env.DATABASE_URL = 'postgres://test-only/db';

function response() {
  return {code: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; }};
}
function recorder(overrides = {}) {
  const recorded = [], alerts = [];
  return {
    recorded, alerts, claims: 0,
    async record(metric) { recorded.push(metric); },
    async countRecentFailures() { return 0; },
    async claimAlert() { this.claims++; return true; },
    async sendAlert(payload) { alerts.push(payload); },
    ...overrides,
  };
}
// Keeps the structured log lines out of the test output while still exercising them.
function quietly(run) {
  const { log, error } = console;
  const lines = [];
  console.log = console.error = message => lines.push(message);
  return run().finally(() => { console.log = log; console.error = error; }).then(() => lines);
}

test('correlation IDs are reused when valid, generated when not, and stable per response', () => {
  const res = response();
  const request = beginRequest({headers: {'x-request-id': 'upstream-123'}}, res);
  assert.equal(request.id, 'upstream-123');
  assert.equal(res.headers['x-request-id'], 'upstream-123');
  assert.equal(beginRequest({headers: {'x-request-id': 'something-else'}}, res).id, 'upstream-123');

  const generated = beginRequest({headers: {'x-request-id': 'not valid; drop table'}}, response());
  assert.match(generated.id, /^[0-9a-f-]{36}$/);
  assert.match(beginRequest({headers: {}}, response()).id, /^[0-9a-f-]{36}$/);
});

test('outcomes separate failed writes, auth failures and rate limiting from ordinary client errors', () => {
  assert.equal(classifyOutcome('GET', 200), 'ok');
  assert.equal(classifyOutcome('POST', 503), 'write_failure');
  assert.equal(classifyOutcome('POST', 409), 'write_failure');
  assert.equal(classifyOutcome('GET', 503), 'server_error');
  assert.equal(classifyOutcome('GET', 401), 'auth_failure');
  assert.equal(classifyOutcome('POST', 403), 'auth_failure');
  assert.equal(classifyOutcome('POST', 429), 'rate_limited');
  assert.equal(classifyOutcome('POST', 400), 'client_error');
  assert.equal(isFailure('write_failure'), true);
  assert.equal(isFailure('auth_failure'), false);
});

test('observed requests record a content-free metric and a correlated structured log line', async () => {
  const telemetry = recorder();
  const res = response();
  const handler = observe('/api/hub', async (req, res) => res.status(200).json({data: {inventory: [{name: 'Rice'}]}}), telemetry);
  const lines = await quietly(() => handler({method: 'POST', headers: {'x-request-id': 'req-1'}, body: {item: 'Rice'}}, res));

  assert.deepEqual(telemetry.recorded.map(m => [m.route, m.outcome, m.status]), [['/api/hub', 'ok', 200]]);
  assert.equal(typeof telemetry.recorded[0].latencyMs, 'number');
  const logged = lines.map(line => JSON.parse(line)).find(entry => entry.event === 'request');
  assert.equal(logged.requestId, 'req-1');
  assert.equal(logged.route, '/api/hub');
  assert.equal(logged.outcome, 'ok');
  assert.ok(!lines.join(' ').includes('Rice'), 'metrics and logs must never carry household contents');
});

test('a handler that throws is still logged, counted as a failed write and rethrown', async () => {
  const telemetry = recorder();
  const handler = observe('/api/hub', async () => { throw new Error('Database unavailable.'); }, telemetry);
  await quietly(async () => {
    await assert.rejects(() => handler({method: 'POST', headers: {}}, response()), /Database unavailable/);
  });
  assert.deepEqual(telemetry.recorded.map(m => [m.outcome, m.status]), [['write_failure', 500]]);
});

test('metrics or alerting failures never turn a served request into a failed one', async () => {
  const telemetry = recorder({async record() { throw new Error('Metrics table missing.'); }});
  const res = response();
  const handler = observe('/api/hub', async (req, res) => res.status(200).json({ok: true}), telemetry);
  const lines = await quietly(() => handler({method: 'GET', headers: {}}, res));
  assert.equal(res.code, 200);
  assert.deepEqual(res.data, {ok: true});
  assert.ok(lines.some(line => JSON.parse(line).event === 'telemetry_failure'));
});

test('repeated failures alert once per cooldown, and never for wrong passwords', async () => {
  const overThreshold = recorder({async countRecentFailures() { return 9; }});
  process.env.ALERT_WEBHOOK_URL = 'https://alerts.example.com/hook';
  try {
    const handler = observe('/api/hub', async (req, res) => res.status(503).json({error: 'Database unavailable.'}), overThreshold);
    await quietly(() => handler({method: 'POST', headers: {}}, response()));
    assert.equal(overThreshold.alerts.length, 1);
    assert.equal(overThreshold.alerts[0].route, '/api/hub');
    assert.equal(overThreshold.alerts[0].failures, 9);
    assert.match(overThreshold.alerts[0].text, /9 failed requests on \/api\/hub/);
    assert.ok(!JSON.stringify(overThreshold.alerts[0]).toLowerCase().includes('inventory'));

    // The cooldown is owned by the claim, so a second burst inside it sends nothing.
    const cooling = recorder({async countRecentFailures() { return 9; }, async claimAlert() { return false; }});
    const cooled = observe('/api/hub', async (req, res) => res.status(503).json({error: 'Database unavailable.'}), cooling);
    await quietly(() => cooled({method: 'POST', headers: {}}, response()));
    assert.equal(cooling.alerts.length, 0);

    const belowThreshold = recorder({async countRecentFailures() { return 2; }});
    const quiet = observe('/api/hub', async (req, res) => res.status(503).json({error: 'Database unavailable.'}), belowThreshold);
    await quietly(() => quiet({method: 'POST', headers: {}}, response()));
    assert.equal(belowThreshold.alerts.length, 0);

    const authFailures = recorder({async countRecentFailures() { return 99; }});
    const login = observe('/api/session', async (req, res) => res.status(401).json({error: 'Incorrect email or password.'}), authFailures);
    await quietly(() => login({method: 'POST', headers: {}}, response()));
    assert.equal(authFailures.alerts.length, 0);
    assert.equal(authFailures.recorded[0].outcome, 'auth_failure');
  } finally { delete process.env.ALERT_WEBHOOK_URL; }
});

test('health reports database availability and latency to anyone, metrics only to members', async () => {
  const rows = [
    {route: '/api/hub', outcome: 'ok', requests: 40, average_latency_ms: 80, max_latency_ms: 120, last_seen: '2026-09-14T00:00:00.000Z'},
    {route: '/api/hub', outcome: 'write_failure', requests: 3, average_latency_ms: 900, max_latency_ms: 1200, last_seen: '2026-09-14T00:01:00.000Z'},
    {route: '/api/session', outcome: 'auth_failure', requests: 7, average_latency_ms: 50, max_latency_ms: 90, last_seen: '2026-09-14T00:02:00.000Z'},
    {route: 'database', outcome: 'ok', requests: 10, average_latency_ms: 25, max_latency_ms: 60, last_seen: '2026-09-14T00:03:00.000Z'},
  ];
  const probes = [];
  const repository = {
    async probeDatabase() {},
    async getMembership() { return {role: 'member'}; },
    async summarizeRequestMetrics(windowMinutes) { assert.equal(windowMinutes, 1440); return rows; },
    async recordRequestMetric(metric) { probes.push(metric); },
  };

  const anonymous = response();
  await createHealthHandler(repository, () => false)({method: 'GET', headers: {}}, anonymous);
  assert.equal(anonymous.code, 200);
  assert.equal(anonymous.data.database, 'ok');
  assert.equal(anonymous.data.metrics, undefined);
  assert.equal(typeof anonymous.data.latencyMs, 'number');
  assert.deepEqual(probes.map(p => [p.route, p.outcome]), [['database', 'ok']]);

  const member = response();
  await createHealthHandler(repository, () => ({userId: 'user-1'}))({method: 'GET', headers: {}}, member);
  const {metrics} = member.data;
  assert.equal(metrics.totals.requests, 60);
  assert.equal(metrics.totals.failedWrites, 3);
  assert.equal(metrics.totals.authFailures, 7);
  assert.equal(metrics.database.averageLatencyMs, 25);
  assert.equal(metrics.database.maxLatencyMs, 60);
  assert.equal(metrics.retentionDays, 14);
  assert.equal(metrics.alerting.webhookConfigured, false);
  assert.equal(metrics.routes.length, 4);
  assert.ok(!JSON.stringify(metrics).toLowerCase().includes('rice'));
});

test('health fails closed with a 503 when the database probe fails', async () => {
  const repository = {
    async probeDatabase() { throw new Error('Connection refused.'); },
    async getMembership() { throw new Error('should not be called'); },
    async summarizeRequestMetrics() { throw new Error('should not be called'); },
    async recordRequestMetric() { throw new Error('Metrics unavailable too.'); },
  };
  const res = response();
  await quietly(() => createHealthHandler(repository, () => ({userId: 'user-1'}))({method: 'GET', headers: {}}, res));
  assert.equal(res.code, 503);
  assert.equal(res.data.database, 'unavailable');
  assert.match(res.data.error, /unavailable/i);
  assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
});

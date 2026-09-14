import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

function startServer(handler) {
  return new Promise(resolve => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function urlOf(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

test('smoke test passes against a healthy deployment', async () => {
  const server = await startServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({status: 'ok', database: 'ok', latencyMs: 3}));
  });
  try {
    const {stdout} = await run('node', ['scripts/smoketest.js', urlOf(server)]);
    assert.match(stdout, /Smoke test passed/);
  } finally { server.close(); }
});

test('smoke test fails and retries against an unhealthy deployment', async () => {
  let requests = 0;
  const server = await startServer((req, res) => {
    requests++;
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({status: 'error', database: 'unavailable'}));
  });
  try {
    await assert.rejects(run('node', ['scripts/smoketest.js', urlOf(server)], {
      env: {...process.env, SMOKE_TEST_ATTEMPTS: '2', SMOKE_TEST_DELAY_MS: '1'},
    }));
    assert.equal(requests, 2);
  } finally { server.close(); }
});

test('smoke test fails fast with no URL given', async () => {
  await assert.rejects(run('node', ['scripts/smoketest.js'], {env: {...process.env, SMOKE_TEST_URL: ''}}));
});

test('smoke test sends the Vercel protection bypass header when configured', async () => {
  let receivedHeader;
  const server = await startServer((req, res) => {
    receivedHeader = req.headers['x-vercel-protection-bypass'];
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({status: 'ok', database: 'ok', latencyMs: 1}));
  });
  try {
    await run('node', ['scripts/smoketest.js', urlOf(server)], {
      env: {...process.env, VERCEL_AUTOMATION_BYPASS_SECRET: 'secret-value'},
    });
    assert.equal(receivedHeader, 'secret-value');
  } finally { server.close(); }
});

test('smoke test hints at deployment protection for a non-JSON response with no bypass secret set', async () => {
  const server = await startServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<html>Authenticating...</html>');
  });
  try {
    const {stderr} = await run('node', ['scripts/smoketest.js', urlOf(server)], {
      env: {...process.env, SMOKE_TEST_ATTEMPTS: '1', VERCEL_AUTOMATION_BYPASS_SECRET: ''},
    }).catch(error => error);
    assert.match(stderr, /Vercel Authentication interstitial|bypass secret/);
  } finally { server.close(); }
});

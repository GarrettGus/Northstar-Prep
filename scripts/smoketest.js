// Verifies a deployed environment is healthy before it is promoted (preview -> staging ->
// production). Hits the public, unauthenticated /api/health endpoint, which itself confirms
// the deployment can reach its configured Postgres database.
const url = process.argv[2] || process.env.SMOKE_TEST_URL;
if (!url) {
  console.error('Usage: npm run smoke-test -- <deployment-url>  (or set SMOKE_TEST_URL)');
  process.exit(1);
}

const attempts = Number(process.env.SMOKE_TEST_ATTEMPTS) || 5;
const delayMs = Number(process.env.SMOKE_TEST_DELAY_MS) || 5000;
const healthUrl = new URL('/api/health', url).toString();

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function checkOnce() {
  const response = await fetch(healthUrl, { headers: { 'cache-control': 'no-store' } });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== 'ok' || body?.database !== 'ok') {
    throw new Error(`Unhealthy response (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    const body = await checkOnce();
    console.log(`Smoke test passed against ${healthUrl} (latency ${body.latencyMs}ms).`);
    process.exit(0);
  } catch (error) {
    console.error(`Smoke test attempt ${attempt}/${attempts} failed: ${error.message}`);
    if (attempt === attempts) {
      console.error(`Smoke test failed: ${healthUrl} did not report a healthy database after ${attempts} attempts.`);
      process.exit(1);
    }
    await sleep(delayMs);
  }
}

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
// Deployments behind Vercel Authentication (Project Settings -> Deployment Protection) reject
// unauthenticated requests before they reach the app. Vercel's "Protection Bypass for Automation"
// feature issues a secret that this header exchanges for access; see README's staging smoke test
// setup notes. Without it, a protected deployment cannot be smoke tested at all.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function checkOnce() {
  const headers = { 'cache-control': 'no-store' };
  if (bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret;
  const response = await fetch(healthUrl, { headers });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== 'ok' || body?.database !== 'ok') {
    const hint = body === null && !bypassSecret
      ? ' (non-JSON response with no bypass secret set — this may be a Vercel Authentication interstitial rather than the app; see README)'
      : '';
    throw new Error(`Unhealthy response (${response.status}): ${JSON.stringify(body)}${hint}`);
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

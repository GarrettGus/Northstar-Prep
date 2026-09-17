// Outbound email via Resend's HTTP API (plain fetch, no SDK — the same dependency-free
// pattern ALERT_WEBHOOK_URL uses in server/observability.js). Every call site treats a failed
// or unconfigured send as fail-soft: the manual-link and no-email paths this app already
// supports keep working exactly as before (see README's Architecture section).
export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail({to, subject, text}, fetchImpl = fetch) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return false;
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({from, to, subject, text}),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Email provider responded ${response.status}.`);
  return true;
}

// Which day the optional weekly readiness digest goes out (0=Sunday..6=Saturday, evaluated in
// UTC since that's the clock the cron runs on). Defaults to Monday.
export function digestWeekday() {
  const value = Number(process.env.EMAIL_DIGEST_WEEKDAY);
  return Number.isInteger(value) && value >= 0 && value <= 6 ? value : 1;
}
export function isDigestDay(now = new Date()) {
  return now.getUTCDay() === digestWeekday();
}

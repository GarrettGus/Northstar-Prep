// Outbound email through Resend's HTTP API (no SDK). Everything here fails soft: with no provider
// configured, sendEmail reports {sent: false} and every caller keeps its manual-link path, exactly
// as the app behaved before email existed. Messages carry links and generic text only, never
// household contents (no item names, medications, plans or members other than the recipient).
export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail({to, subject, text}, fetchImpl = (...args) => fetch(...args)) {
  if (!emailConfigured()) return {sent: false, reason: 'not_configured'};
  // EMAIL_API_BASE exists for the browser suite's local stub; deployments leave it unset.
  const base = process.env.EMAIL_API_BASE || 'https://api.resend.com';
  const response = await fetchImpl(`${base}/emails`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({from: process.env.EMAIL_FROM, to: [to], subject, text}),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Email provider responded ${response.status}`);
  return {sent: true};
}

// The app's own address for links in emails. APP_URL wins; otherwise the request's Origin, which
// every mutating route has already checked matches Host (server/auth.js sameOrigin).
export function appUrl(req) {
  const configured = process.env.APP_URL;
  if (configured && /^https?:\/\/[^\s/]+/i.test(configured)) return configured.replace(/\/+$/, '');
  const origin = req?.headers?.origin;
  if (origin && /^https?:\/\/[^\s/]+$/i.test(origin)) return origin;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return req?.headers?.host ? `http://${req.headers.host}` : null;
}

const signature = '\n\n-- \nNorthStar Prep\nYou are receiving this because you are a member of a NorthStar Prep household.';

export function inviteEmail({link, role, expiresAt}) {
  return {
    subject: 'You have been invited to a NorthStar Prep household',
    text: `You have been invited to join a household on NorthStar Prep as ${role === 'owner' ? 'an owner' : 'a member'}.\n\nSet your password and join here:\n${link}\n\nThis link expires ${new Date(expiresAt).toUTCString()} and can only be used once. If you were not expecting it, ignore this email.${signature}`,
  };
}

export function resetEmail({link}) {
  return {
    subject: 'Reset your NorthStar Prep password',
    text: `Someone asked to reset the password for this NorthStar Prep account.\n\nChoose a new password here:\n${link}\n\nThe link expires in 1 hour and can only be used once. If you did not ask for this, you can ignore this email; your password has not changed.${signature}`,
  };
}

export function backupFailureEmail({url}) {
  return {
    subject: 'NorthStar Prep: the daily backup failed',
    text: `Today's automatic encrypted backup of your household did not complete.\n\nOpen Household settings to see the backup history${url ? `:\n${url}` : '.'}\n\nUntil a backup succeeds, consider downloading a manual backup from the app.${signature}`,
  };
}

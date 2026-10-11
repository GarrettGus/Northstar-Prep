import webpush from 'web-push';
import { createHash } from 'node:crypto';

// Web Push (VAPID). Off unless VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are all set,
// the same fail-closed stance automatic backups take without their key. Generate a key pair once
// with `npx web-push generate-vapid-keys` (see README).
export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}
export function vapidPublicKey() { return pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null; }

export function subscriptionId(endpoint) { return createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 64); }

// Sends one notification to one stored subscription. Resolves to 'sent', or 'gone' when the push
// service says the subscription no longer exists (the caller deletes it); other errors throw.
export async function sendPush(subscription, payload, send = webpush.sendNotification) {
  try {
    await send(
      {endpoint: subscription.endpoint, keys: {p256dh: subscription.p256dh, auth: subscription.auth}},
      JSON.stringify(payload),
      {
        TTL: 12 * 3600,
        vapidDetails: {subject: process.env.VAPID_SUBJECT, publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY},
      },
    );
    return 'sent';
  } catch (error) {
    if (error?.statusCode === 404 || error?.statusCode === 410) return 'gone';
    throw error;
  }
}

// Fans a payload out to many subscriptions, pruning dead ones. Never throws: one bad endpoint must
// not stop the rest, and callers (the cron, an activation) must not fail because of push.
export async function broadcast(subscriptions, payload, {send = sendPush, remove = async () => {}, onError = () => {}} = {}) {
  const results = await Promise.allSettled(subscriptions.map(subscription => send(subscription, payload)));
  let sent = 0, removed = 0, failed = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && result.value === 'sent') sent++;
    else if (result.status === 'fulfilled' && result.value === 'gone') { removed++; try { await remove(subscriptions[i].id); } catch (error) { onError(error); } }
    else { failed++; onError(result.reason); }
  }
  return {sent, removed, failed};
}

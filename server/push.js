import webpush from 'web-push';

// Web Push (see api/push.js for subscribe/unsubscribe and api/backup.js for the daily digest
// that sends through this). No-op cleanly when VAPID keys are not configured, the same way
// automatic backups fail closed without BACKUP_ENCRYPTION_KEY.
export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}
export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// Sends one push message. Returns 'sent', or 'gone' when the push service reports the
// subscription is expired or invalid (410/404) so the caller can delete it; anything else
// throws, mirroring uploadBackupCopy's fail-soft shape in server/backupBlobStore.js.
export async function sendPush(subscription, payload, client = webpush) {
  if (!pushConfigured()) return 'skipped';
  client.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  try {
    await client.sendNotification(
      {endpoint: subscription.endpoint, keys: {p256dh: subscription.p256dh, auth: subscription.auth}},
      JSON.stringify(payload),
    );
    return 'sent';
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) return 'gone';
    throw error;
  }
}

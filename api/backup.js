import { validSession, sameOrigin } from '../server/auth.js';
import { readState, getMembership, insertBackupRecord, updateBackupOffSiteStatus, listBackupRecords, getBackupRecord, pruneBackups, pruneRequestMetrics, recordReadinessSnapshot, pruneReadinessHistory, listOwnerEmails, listDigestOptedInEmails, listPushSubscriptions, deletePushSubscription } from '../server/db.js';
import { backupsConfigured, encryptBackup, decryptBackup } from '../server/backupCrypto.js';
import { configured as offSiteConfigured, uploadBackupCopy, downloadBackupCopy, deleteBackupCopy } from '../server/backupBlobStore.js';
import { stateSchema, backupSchema } from '../shared/schema.js';
import { beginRequest, logFailure, logIssue, metricsRetentionDays, readinessRetentionDays, observe } from '../server/observability.js';
import { computeReadiness } from '../shared/readiness.js';
import { todayLocal } from '../shared/reminders.js';
import { emailConfigured, sendEmail, isDigestDay } from '../server/email.js';
import { pushConfigured, sendPush } from '../server/push.js';
import { buildDailyDigest, digestSummaryText, weeklyDigestText } from '../shared/digest.js';

const retainCount = 30;

// Vercel Cron always calls this path with GET, adding this header automatically once
// CRON_SECRET is configured as an environment variable. See README for setup.
function isCronRequest(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

export function createHandler(
  repository = {readState, getMembership, insertBackupRecord, updateBackupOffSiteStatus, listBackupRecords, getBackupRecord, pruneBackups, pruneRequestMetrics, recordReadinessSnapshot, pruneReadinessHistory, listOwnerEmails, listDigestOptedInEmails, listPushSubscriptions, deletePushSubscription},
  authenticate = validSession,
  offSite = {configured: offSiteConfigured, upload: uploadBackupCopy, download: downloadBackupCopy, remove: deleteBackupCopy},
) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET' && isCronRequest(req)) {
      try {
        let state;
        try { ({data: state} = await repository.readState()); }
        catch (error) {
          await repository.insertBackupRecord({status: 'failed', error: error.message}).catch(() => {});
          if (emailConfigured()) {
            try {
              const owners = await repository.listOwnerEmails();
              await Promise.allSettled(owners.map(to => sendEmail({
                to, subject: 'NorthStar Prep backup failed',
                text: `Today's automatic household backup failed: ${error.message}\n\nCheck Household settings for backup history once the app is reachable again.`,
              }))).then(results => {
                for (const result of results) if (result.status === 'rejected') logIssue(request, '/api/backup', 'failure_email_failure', result.reason);
              });
            } catch (emailError) { logIssue(request, '/api/backup', 'failure_email_failure', emailError); }
          }
          throw error;
        }
        const plaintext = JSON.stringify(state);
        const {iv, ciphertext, authTag, checksum} = encryptBackup(plaintext);
        const backupId = await repository.insertBackupRecord({
          status: 'success', checksum, sizeBytes: ciphertext.length,
          inventoryCount: state.inventory.length, shoppingCount: state.shoppingList.length,
          applianceCount: state.appliances.length, hasPlan: state.plan !== null,
          iv, authTag, ciphertext,
        });
        // A failed off-site copy never fails the backup itself: the Postgres copy the cron
        // exists for is already safely written by this point.
        let offSiteStatus = 'skipped';
        if (offSite.configured()) {
          try { await offSite.upload(backupId, {iv, ciphertext, authTag, checksum}); offSiteStatus = 'success'; }
          catch (error) { offSiteStatus = 'failed'; logIssue(request, '/api/backup', 'off_site_copy_failure', error); }
        }
        try { await repository.updateBackupOffSiteStatus(backupId, {status: offSiteStatus, error: offSiteStatus === 'failed' ? 'Off-site copy failed; the Postgres copy is unaffected.' : null}); }
        catch (error) { logIssue(request, '/api/backup', 'off_site_status_write_failure', error); }

        const prunedIds = await repository.pruneBackups(1, retainCount);
        if (offSite.configured() && prunedIds.length > 0) {
          await Promise.allSettled(prunedIds.map(id => offSite.remove(id))).then(results => {
            for (const result of results) if (result.status === 'rejected') logIssue(request, '/api/backup', 'off_site_prune_failure', result.reason);
          });
        }
        // The daily cron doubles as the maintenance run for request metrics, so operational
        // history stays bounded without a second scheduled job (Vercel Hobby allows one).
        let metricsPruned = true;
        try { await repository.pruneRequestMetrics(metricsRetentionDays()); }
        catch (error) { metricsPruned = false; logIssue(request, '/api/backup', 'metrics_prune_failure', error); }
        // The same run records the day's readiness snapshot, for the same reason: the Hobby plan
        // allows one scheduled run a day, so this is the only cron there is. A snapshot failure
        // must never fail the backup the cron exists for, so it is logged and reported instead.
        const stats = computeReadiness(state, state.settings);
        let readinessRecorded = true;
        try {
          await repository.recordReadinessSnapshot({
            day: todayLocal(),
            waterDays: stats.waterDays, foodDays: stats.foodDays, powerDays: stats.powerDays,
            fuelHours: stats.totalFuelHours, itemCount: state.inventory.length,
            lowStock: stats.lowStock, expired: stats.expired,
          });
          await repository.pruneReadinessHistory(readinessRetentionDays());
        } catch (error) { readinessRecorded = false; logIssue(request, '/api/backup', 'readiness_snapshot_failure', error); }

        // Push and (weekly) email digests ride the same daily cron for the same reason request
        // metrics and the readiness snapshot do: Vercel's Hobby plan allows one scheduled run a
        // day, so this is the only cron there is. Neither can fail the backup the cron exists for.
        if (pushConfigured()) {
          try {
            const digest = buildDailyDigest(state);
            if (digest) {
              const subscriptions = await repository.listPushSubscriptions();
              const payload = {title: 'NorthStar Prep', body: digestSummaryText(digest), url: '/'};
              const stale = [];
              await Promise.allSettled(subscriptions.map(async subscription => {
                const result = await sendPush(subscription, payload);
                if (result === 'gone') stale.push(subscription.endpoint);
              })).then(results => {
                for (const result of results) if (result.status === 'rejected') logIssue(request, '/api/backup', 'push_send_failure', result.reason);
              });
              if (stale.length) {
                await Promise.allSettled(stale.map(endpoint => repository.deletePushSubscription(endpoint))).then(results => {
                  for (const result of results) if (result.status === 'rejected') logIssue(request, '/api/backup', 'push_subscription_prune_failure', result.reason);
                });
              }
            }
          } catch (error) { logIssue(request, '/api/backup', 'push_digest_failure', error); }
        }
        if (emailConfigured() && isDigestDay()) {
          try {
            const recipients = await repository.listDigestOptedInEmails();
            if (recipients.length) {
              const text = weeklyDigestText(stats);
              await Promise.allSettled(recipients.map(to => sendEmail({to, subject: 'Your weekly NorthStar Prep readiness digest', text}))).then(results => {
                for (const result of results) if (result.status === 'rejected') logIssue(request, '/api/backup', 'digest_email_failure', result.reason);
              });
            }
          } catch (error) { logIssue(request, '/api/backup', 'digest_email_failure', error); }
        }

        return res.status(200).json({status: 'success', checksum, sizeBytes: ciphertext.length, metricsPruned, readinessRecorded, offSiteStatus});
      } catch (error) {
        logFailure(request, '/api/backup', 500, error);
        return res.status(500).json({status: 'failed', error: error.message});
      }
    }

    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({error: 'Method not allowed.'});
    const session = authenticate(req);
    if (!session) { logFailure(request, '/api/backup', 401); return res.status(401).json({error: 'Please sign in again.'}); }
    if (req.method === 'POST' && !sameOrigin(req)) return res.status(403).json({error: 'Request origin rejected.'});
    try {
      const membership = await repository.getMembership(session.userId);
      if (!membership) return res.status(403).json({error: 'Not a member of this household.'});

      if (req.method === 'GET') {
        const backups = await repository.listBackupRecords();
        return res.status(200).json({backups, configured: backupsConfigured()});
      }

      const id = Number(req.body?.id);
      if (req.body?.type !== 'restore' || !Number.isInteger(id)) return res.status(400).json({error: 'Unknown request.'});
      const record = await repository.getBackupRecord(id);
      if (!record) return res.status(404).json({error: 'Backup not found.'});
      let plaintext;
      try { plaintext = decryptBackup(record); }
      catch {
        // The Postgres copy is corrupted or was tampered with; fall back to the off-site copy
        // of the same backup, if one exists, before giving up. Same decrypt/checksum pipeline
        // either way, so a recovered backup gets exactly the same validation as normal.
        let offSiteRecord;
        if (offSite.configured()) { try { offSiteRecord = await offSite.download(id); } catch { offSiteRecord = undefined; } }
        if (!offSiteRecord) return res.status(422).json({error: 'This backup could not be verified. It may be corrupted or the encryption key changed.'});
        try { plaintext = decryptBackup(offSiteRecord); }
        catch { return res.status(422).json({error: 'This backup could not be verified. It may be corrupted or the encryption key changed.'}); }
      }
      let backup;
      try { backup = backupSchema.parse(stateSchema.parse(JSON.parse(plaintext))); }
      catch { return res.status(422).json({error: 'This backup failed validation and was not restored.'}); }
      return res.status(200).json({backup});
    } catch (error) {
      logFailure(request, '/api/backup', 503, error);
      return res.status(503).json({error: 'Backup history is unavailable.'});
    }
  };
}
export default observe('/api/backup', createHandler());

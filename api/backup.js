import { validSession, sameOrigin } from '../server/auth.js';
import { readState, getMembership, insertBackupRecord, listBackupRecords, getBackupRecord, pruneBackups } from '../server/db.js';
import { backupsConfigured, encryptBackup, decryptBackup } from '../server/backupCrypto.js';
import { stateSchema, backupSchema } from '../shared/schema.js';
import { beginRequest, logFailure } from '../server/observability.js';

const retainCount = 30;

// Vercel Cron always calls this path with GET, adding this header automatically once
// CRON_SECRET is configured as an environment variable. See README for setup.
function isCronRequest(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

export function createHandler(repository = {readState, getMembership, insertBackupRecord, listBackupRecords, getBackupRecord, pruneBackups}, authenticate = validSession) {
  return async function handler(req, res) {
    const request = beginRequest(req, res);
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET' && isCronRequest(req)) {
      try {
        let state;
        try { ({data: state} = await repository.readState()); }
        catch (error) { await repository.insertBackupRecord({status: 'failed', error: error.message}).catch(() => {}); throw error; }
        const plaintext = JSON.stringify(state);
        const {iv, ciphertext, authTag, checksum} = encryptBackup(plaintext);
        await repository.insertBackupRecord({
          status: 'success', checksum, sizeBytes: ciphertext.length,
          inventoryCount: state.inventory.length, shoppingCount: state.shoppingList.length,
          applianceCount: state.appliances.length, hasPlan: state.plan !== null,
          iv, authTag, ciphertext,
        });
        await repository.pruneBackups(1, retainCount);
        return res.status(200).json({status: 'success', checksum, sizeBytes: ciphertext.length});
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
      catch { return res.status(422).json({error: 'This backup could not be verified. It may be corrupted or the encryption key changed.'}); }
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
export default createHandler();

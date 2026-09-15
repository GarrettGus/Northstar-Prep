import { put, get, del, list } from '@vercel/blob';

// Off-site copy of each encrypted backup, alongside the Postgres copy the daily cron already
// writes: a database loss (corruption, accidental deletion, a bad migration) no longer takes
// every recoverable copy with it. Stored private (never a public URL) and namespaced by
// household, the same way inventory images are. No-op cleanly when the token isn't configured,
// the same way automatic backups already fail closed without BACKUP_ENCRYPTION_KEY.
const CONTENT_TYPE = 'application/json';

function blobToken() {
  const value = process.env.BLOB_READ_WRITE_TOKEN;
  if (!value) { const error = new Error('Object storage is not configured.'); error.status = 503; throw error; }
  return value;
}

export function configured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function backupPathname(backupId, householdId = 1) {
  return `households/${householdId}/backups/${backupId}.json`;
}

// iv/ciphertext/authTag are Buffers (see server/backupCrypto.js); base64 them into one JSON
// blob rather than storing multiple objects per backup. Exported (pure, no network) so the
// round trip is directly unit-testable.
export function encodeBackupRecord({ iv, ciphertext, authTag, checksum }) {
  return JSON.stringify({
    iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64'), checksum,
  });
}
export function decodeBackupRecord(text) {
  const parsed = JSON.parse(text);
  return {
    iv: Buffer.from(parsed.iv, 'base64'), ciphertext: Buffer.from(parsed.ciphertext, 'base64'),
    authTag: Buffer.from(parsed.authTag, 'base64'), checksum: parsed.checksum,
  };
}

export async function uploadBackupCopy(backupId, record, householdId = 1) {
  const token = blobToken();
  await put(backupPathname(backupId, householdId), encodeBackupRecord(record), {
    access: 'private', contentType: CONTENT_TYPE, token, addRandomSuffix: false,
  });
}

// Returns undefined (not a throw) when no off-site copy exists for this backup, so callers can
// treat "no copy yet" the same as "off-site storage not configured" and fall back cleanly.
export async function downloadBackupCopy(backupId, householdId = 1) {
  const token = blobToken();
  const result = await get(backupPathname(backupId, householdId), { access: 'private', token });
  if (!result) return undefined;
  const text = await new Response(result.stream).text();
  return decodeBackupRecord(text);
}

export async function deleteBackupCopy(backupId, householdId = 1) {
  const token = blobToken();
  await del(backupPathname(backupId, householdId), { token });
}

// Used only by scripts/restore-off-site-backup.js: when Postgres itself is the thing that was
// lost, there is no northstar_backups row left to say which backup IDs exist, so recovery has
// to discover them from the off-site copies directly.
export async function listBackupCopies(householdId = 1) {
  const token = blobToken();
  const prefix = `households/${householdId}/backups/`;
  const { blobs } = await list({ prefix, token });
  return blobs
    .map(blob => ({ backupId: blob.pathname.slice(prefix.length, -'.json'.length), uploadedAt: blob.uploadedAt, size: blob.size }))
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

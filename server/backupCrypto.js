import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

// AES-256-GCM at-rest encryption for automatic household backups. The GCM auth tag
// detects any tampering/corruption of the ciphertext; the checksum lets callers show
// a backup's integrity status without needing to decrypt it first.
function backupKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) throw new Error('Backup encryption is not configured.');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must decode to 32 bytes (base64-encoded).');
  return key;
}
export function backupsConfigured() { try { backupKey(); return true; } catch { return false; } }

export function encryptBackup(plaintext) {
  const key = backupKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const checksum = createHash('sha256').update(plaintext).digest('hex');
  return { iv, ciphertext, authTag, checksum };
}
export function decryptBackup({ iv, ciphertext, authTag, checksum }) {
  const key = backupKey();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let plaintext;
  try { plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'); }
  catch { throw new Error('Backup is corrupted or was encrypted with a different key.'); }
  if (createHash('sha256').update(plaintext).digest('hex') !== checksum) throw new Error('Backup checksum mismatch; the record may be corrupted.');
  return plaintext;
}

// Recovery path for a total database loss: unlike the app's own restore flow, this needs
// neither DATABASE_URL nor a running deployment, only BLOB_READ_WRITE_TOKEN (to reach the
// off-site copies in Vercel Blob) and BACKUP_ENCRYPTION_KEY (to decrypt them) — get the key
// from wherever you stored it when you generated it (a secret manager, password vault, or
// your own notes); it is never stored alongside the backup itself, so losing it means the
// off-site copies are unrecoverable too. See README's "Recovery procedure for a total
// database loss" for the full walkthrough.
//
// Usage:
//   node scripts/restore-off-site-backup.js list [householdId]
//   node scripts/restore-off-site-backup.js <backupId> [outputFile] [householdId]
//
// `list` prints the available off-site backup IDs (newest first) without needing Postgres at
// all, since a lost database can no longer say which IDs exist. Given a backup ID, the script
// downloads its off-site copy, decrypts and validates it exactly like the app's own restore
// path, and writes the plaintext household-state JSON to outputFile (default ./restored-backup.json).
// Sign in to a freshly migrated deployment as a new owner and use Household settings' "Import
// JSON backup" to load that file — the same non-destructive merge preview as any other import.
import { writeFile } from 'node:fs/promises';
import { decryptBackup } from '../server/backupCrypto.js';
import { listBackupCopies, downloadBackupCopy, configured } from '../server/backupBlobStore.js';
import { stateSchema, backupSchema } from '../shared/schema.js';

if (!configured()) {
  console.error('BLOB_READ_WRITE_TOKEN is not set. It must point at the same Vercel Blob store the lost deployment used.');
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/restore-off-site-backup.js list [householdId]');
  console.error('       node scripts/restore-off-site-backup.js <backupId> [outputFile] [householdId]');
  process.exit(1);
}

if (command === 'list') {
  const householdId = Number(rest[0]) || 1;
  const copies = await listBackupCopies(householdId);
  if (copies.length === 0) { console.log('No off-site backup copies found for this household.'); process.exit(0); }
  for (const copy of copies) console.log(`${copy.backupId}\t${copy.uploadedAt.toISOString()}\t${copy.size} bytes`);
  process.exit(0);
}

const backupId = command;
const outputFile = rest[0] || 'restored-backup.json';
const householdId = Number(rest[1]) || 1;

if (!process.env.BACKUP_ENCRYPTION_KEY) {
  console.error('BACKUP_ENCRYPTION_KEY is not set. This must be the same key the lost deployment had configured, retrieved from your own secret storage.');
  process.exit(1);
}

const record = await downloadBackupCopy(backupId, householdId);
if (!record) { console.error(`No off-site copy found for backup ${backupId} (household ${householdId}). Run "list" to see what's available.`); process.exit(1); }

let plaintext;
try { plaintext = decryptBackup(record); }
catch (error) { console.error(`Could not decrypt this backup: ${error.message}`); process.exit(1); }

let state;
try { state = backupSchema.parse(stateSchema.parse(JSON.parse(plaintext))); }
catch (error) { console.error(`This backup failed validation: ${error.message}`); process.exit(1); }

await writeFile(outputFile, JSON.stringify(state, null, 2));
console.log(`Restored backup ${backupId} written to ${outputFile}. Sign in to a freshly migrated deployment as a new owner and import it from Household settings.`);

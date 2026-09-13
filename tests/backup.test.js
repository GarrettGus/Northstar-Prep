import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { backupsConfigured, encryptBackup, decryptBackup } from '../server/backupCrypto.js';
import { createHandler } from '../api/backup.js';
import { emptyState } from '../shared/schema.js';
import { token, cookie } from '../server/auth.js';

process.env.SESSION_SECRET = 'test-only-secret-with-more-than-32-characters';
process.env.DATABASE_URL = 'postgres://test-only/db';
process.env.CRON_SECRET = 'test-only-cron-secret';
process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString('base64');

function response() { return {code:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}}; }
function authedRequest(method, body) {
  return {method, headers:{'content-type':'application/json', cookie: cookie(token('user-1'))}, body};
}

test('encryptBackup/decryptBackup round-trips and reports the configured key state', () => {
  const previous = process.env.BACKUP_ENCRYPTION_KEY;
  const plaintext = JSON.stringify(emptyState());
  const record = encryptBackup(plaintext);
  assert.equal(decryptBackup(record), plaintext);
  assert.equal(backupsConfigured(), true);
  delete process.env.BACKUP_ENCRYPTION_KEY;
  assert.equal(backupsConfigured(), false);
  assert.throws(() => encryptBackup(plaintext));
  process.env.BACKUP_ENCRYPTION_KEY = previous;
});

test('decryptBackup detects tampered ciphertext, a wrong auth tag and a checksum mismatch', () => {
  const plaintext = JSON.stringify({ a: 1 });
  const record = encryptBackup(plaintext);
  const flipped = Buffer.from(record.ciphertext); flipped[0] ^= 0xff;
  assert.throws(() => decryptBackup({ ...record, ciphertext: flipped }));
  const flippedTag = Buffer.from(record.authTag); flippedTag[0] ^= 0xff;
  assert.throws(() => decryptBackup({ ...record, authTag: flippedTag }));
  assert.throws(() => decryptBackup({ ...record, checksum: 'not-the-real-checksum' }));
});

test('backup API: a valid cron secret creates a backup and prunes old ones', async () => {
  const state = { ...emptyState(), inventory: [{id:'rice',name:'Rice',quantity:2,unit:'units',category:'Food',caloriesPerUnit:0,hoursPerUnit:0,capacityPerUnit:0,price:0,gallonsPerUnit:0,target:0,store:'',emoji:'',image:'',macroTag:'',fuelType:'',purchaseDate:'',expiryDate:''}] };
  let inserted = null, pruned = false;
  const repository = {
    async readState() { return {data: state, version: 1}; },
    async insertBackupRecord(entry) { inserted = entry; },
    async pruneBackups() { pruned = true; },
  };
  const res = response();
  await createHandler(repository)({method:'GET', headers:{authorization:'Bearer test-only-cron-secret'}}, res);
  assert.equal(res.code, 200);
  assert.equal(res.data.status, 'success');
  assert.equal(inserted.status, 'success');
  assert.equal(inserted.inventoryCount, 1);
  assert.ok(pruned);
});

test('backup API: cron creation failure while reading state is recorded and surfaced', async () => {
  let recordedError = null;
  const repository = {
    async readState() { throw new Error('Database unavailable.'); },
    async insertBackupRecord(entry) { recordedError = entry; },
  };
  const res = response();
  await createHandler(repository)({method:'GET', headers:{authorization:'Bearer test-only-cron-secret'}}, res);
  assert.equal(res.code, 500);
  assert.equal(recordedError.status, 'failed');
  assert.match(recordedError.error, /Database unavailable/);
});

test('backup API: an invalid cron secret falls through to normal session auth and is rejected', async () => {
  const res = response();
  await createHandler({}, () => false)({method:'GET', headers:{authorization:'Bearer wrong-secret'}}, res);
  assert.equal(res.code, 401);
});

test('backup API: authenticated members list backup history without exposing ciphertext', async () => {
  const repository = {
    async getMembership() { return {role:'member'}; },
    async listBackupRecords() { return [{id:1, created_at:'now', status:'success', checksum:'abc', size_bytes:10, inventory_count:2, shopping_count:0, appliance_count:0, has_plan:false}]; },
  };
  const res = response();
  await createHandler(repository, () => ({userId:'user-1'}))(authedRequest('GET'), res);
  assert.equal(res.code, 200);
  assert.equal(res.data.backups.length, 1);
  assert.equal('ciphertext' in res.data.backups[0], false);
  assert.equal(typeof res.data.configured, 'boolean');
});

test('backup API: non-members are denied and unauthenticated requests are rejected', async () => {
  const deniedMember = response();
  await createHandler({async getMembership() { return undefined; }}, () => ({userId:'user-1'}))(authedRequest('GET'), deniedMember);
  assert.equal(deniedMember.code, 403);

  const unauthed = response();
  await createHandler({}, () => false)({method:'GET', headers:{}}, unauthed);
  assert.equal(unauthed.code, 401);
});

test('backup API: restoring a valid backup validates it and returns a mergeable preview', async () => {
  const state = { ...emptyState(), inventory: [{id:'rice',name:'Rice',quantity:2,unit:'units',category:'Food',caloriesPerUnit:0,hoursPerUnit:0,capacityPerUnit:0,price:0,gallonsPerUnit:0,target:0,store:'',emoji:'',image:'',macroTag:'',fuelType:'',purchaseDate:'',expiryDate:''}] };
  const encrypted = encryptBackup(JSON.stringify(state));
  const repository = {
    async getMembership() { return {role:'owner'}; },
    async getBackupRecord(id) { return id === 7 ? encrypted : undefined; },
  };
  const res = response();
  await createHandler(repository, () => ({userId:'user-1'}))(authedRequest('POST', {type:'restore', id:7}), res);
  assert.equal(res.code, 200);
  assert.equal(res.data.backup.inventory.length, 1);
  assert.equal(res.data.backup.inventory[0].id, 'rice');
});

test('backup API: restoring a missing or corrupted backup fails safely without applying anything', async () => {
  const encrypted = encryptBackup(JSON.stringify(emptyState()));
  const tamperedCiphertext = Buffer.from(encrypted.ciphertext); tamperedCiphertext[0] ^= 0xff;
  const tampered = { ...encrypted, ciphertext: tamperedCiphertext };
  const repository = {
    async getMembership() { return {role:'owner'}; },
    async getBackupRecord(id) { return {1: tampered}[id]; },
  };
  const notFound = response();
  await createHandler(repository, () => ({userId:'user-1'}))(authedRequest('POST', {type:'restore', id:999}), notFound);
  assert.equal(notFound.code, 404);

  const corrupted = response();
  await createHandler(repository, () => ({userId:'user-1'}))(authedRequest('POST', {type:'restore', id:1}), corrupted);
  assert.equal(corrupted.code, 422);
});

test('backup API: restore mutations reject cross-site origins', async () => {
  const repository = {async getMembership() { return {role:'owner'}; }};
  const res = response();
  await createHandler(repository, () => ({userId:'user-1'}))({method:'POST', headers:{'content-type':'application/json', origin:'https://evil.com', host:'example.com'}, body:{type:'restore', id:1}}, res);
  assert.equal(res.code, 403);
});

// Runs the real `npm run db:migrate` script against throwaway Postgres databases, then drives
// the shipping server/db.js helpers over the schema it produced. These are the checks a unit
// test with a stubbed repository cannot make: that the DDL applies, that it is re-runnable,
// that it backfills a pre-relational deployment, and that every column name, alias and type
// server/db.js asks for actually exists.
//
// Skipped (not failed) when no Postgres is reachable, so `npm test` still runs everywhere;
// CI always provides one. Point TEST_DATABASE_URL at a server you can create databases on.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createDisposableDatabase, dropDatabase, migrate, postgresAvailable } from '../support/postgres.js';
import { installNeonOverPostgres, closeNeonPools } from '../support/neonOverPostgres.js';
import { verifyPassword } from '../../server/auth.js';
import { encryptBackup, decryptBackup } from '../../server/backupCrypto.js';

const ownerEnv = {HOUSEHOLD_OWNER_EMAIL: 'owner@example.test', HOUSEHOLD_PASSWORD: 'correct-horse-battery-staple'};
const available = await postgresAvailable();

installNeonOverPostgres();

// server/db.js reads DATABASE_URL on every call, so each test points it at its own database.
async function loadDb(url) {
  process.env.DATABASE_URL = url;
  return import('../../server/db.js');
}

async function query(url, text, values = []) {
  const client = new pg.Client({connectionString: url});
  await client.connect();
  try { return (await client.query(text, values)).rows; } finally { await client.end(); }
}

function disposableDatabase() {
  const state = {};
  before(async () => { Object.assign(state, await createDisposableDatabase()); });
  after(async () => { await dropDatabase(state.name); });
  return state;
}

after(async () => { await closeNeonPools(); });

describe('database migration', {skip: available ? false : 'no Postgres reachable at TEST_DATABASE_URL'}, () => {
  describe('a fresh database', () => {
    const database = disposableDatabase();
    before(async () => { await migrate(database.url); });

    it('creates every table the app reads and writes', async () => {
      const rows = await query(database.url, `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
      const tables = rows.map(row => row.tablename).sort();
      assert.deepEqual(tables, [
        'northstar_alert_state', 'northstar_appliances', 'northstar_audit_log', 'northstar_backups',
        'northstar_checklist_checks', 'northstar_contacts', 'northstar_family_members', 'northstar_household',
        'northstar_household_members', 'northstar_inventory', 'northstar_invitations', 'northstar_kits', 'northstar_login_limits',
        'northstar_medications', 'northstar_password_resets', 'northstar_plan', 'northstar_readiness_history', 'northstar_reminder_history', 'northstar_reminders',
        'northstar_request_metrics', 'northstar_settings', 'northstar_shopping_items', 'northstar_users',
      ]);
    });

    it('leaves the app able to read and write household state', async () => {
      const db = await loadDb(database.url);
      const {data, version} = await db.readState();
      assert.equal(version, 0);
      assert.deepEqual(data.inventory, []);
      assert.equal(data.settings.householdSize, 4);

      const item = {
        id: 'rice-1', name: 'Rice', quantity: 5, unit: 'lbs', category: 'Food', caloriesPerUnit: 1600,
        hoursPerUnit: 0, capacityPerUnit: 0, price: 12, gallonsPerUnit: 0, target: 10, store: '', emoji: '',
        image: '', macroTag: 'Carbs', fuelType: '', purchaseDate: '', expiryDate: '', barcode: '012345678905', recurringDays: 30,
        location: '', kitId: '',
      };
      const saved = await db.compareAndSave(version, {...data, inventory: [item]}, data);
      assert.equal(saved, 1);

      const after = await db.readState();
      assert.equal(after.version, 1);
      assert.deepEqual(after.data.inventory, [item]);
    });

    it('rejects a write whose version is already stale', async () => {
      const db = await loadDb(database.url);
      const {data, version} = await db.readState();
      assert.equal(await db.compareAndSave(version - 1, {...data, inventory: []}, data), undefined);
      assert.equal((await db.readState()).data.inventory.length, 1, 'the stale write must not have applied');
    });

    it('applies only one of two devices saving from the same version', async () => {
      const db = await loadDb(database.url);
      const {data, version} = await db.readState();
      const row = (id, name) => ({
        id, name, quantity: 1, unit: 'units', category: 'Gear', caloriesPerUnit: 0, hoursPerUnit: 0,
        capacityPerUnit: 0, price: 0, gallonsPerUnit: 0, target: 0, store: '', emoji: '', image: '',
        macroTag: '', fuelType: '', purchaseDate: '', expiryDate: '', barcode: '', recurringDays: 0,
        location: '', kitId: '',
      });
      const phoneEdit = {...data, inventory: [...data.inventory, row('phone-1', 'Radio')]};
      const laptopEdit = {...data, inventory: [...data.inventory, row('laptop-1', 'Lantern')]};

      const saved = await Promise.all([
        db.compareAndSave(version, phoneEdit, data),
        db.compareAndSave(version, laptopEdit, data),
      ]);
      assert.deepEqual(saved.filter(result => result !== undefined), [version + 1], 'exactly one save may win');

      const after = await db.readState();
      assert.equal(after.version, version + 1);
      const winner = saved[0] === undefined ? 'Lantern' : 'Radio';
      const loser = winner === 'Radio' ? 'Lantern' : 'Radio';
      const names = after.data.inventory.map(item => item.name);
      assert.ok(names.includes(winner), `the winning device's item is missing: ${names}`);
      assert.ok(!names.includes(loser), `the losing device's item was applied anyway: ${names}`);
    });

    it('saves and reads back kits, medications, and an item with a storage location and kit assignment', async () => {
      const db = await loadDb(database.url);
      const {data, version} = await db.readState();
      const kit = {id: 'kit-1', name: 'Go-bag', purpose: 'Evacuation', targetContents: [{name: 'Flashlight', quantity: 1, unit: 'units'}]};
      const medication = {id: 'med-1', person: 'Alex', name: 'Lisinopril', dose: '10mg', quantityOnHand: 30, refillDate: '2026-10-01', prescriber: 'Dr. Lee', notes: ''};
      const item = {id: 'flashlight-1', name: 'Flashlight', quantity: 1, unit: 'units', category: 'Gear',
        caloriesPerUnit: 0, hoursPerUnit: 0, capacityPerUnit: 0, price: 0, gallonsPerUnit: 0, target: 0, store: '', emoji: '', image: '',
        macroTag: '', fuelType: '', purchaseDate: '', expiryDate: '', barcode: '', recurringDays: 0, location: 'Basement', kitId: 'kit-1'};
      const saved = await db.compareAndSave(version, {...data, inventory: [...data.inventory, item], kits: [kit], medications: [medication]}, data);
      assert.equal(saved, version + 1);

      const after = await db.readState();
      assert.deepEqual(after.data.kits, [kit]);
      assert.deepEqual(after.data.medications, [medication]);
      const savedItem = after.data.inventory.find(row => row.id === 'flashlight-1');
      assert.equal(savedItem.location, 'Basement');
      assert.equal(savedItem.kitId, 'kit-1');

      const deleted = await db.compareAndSave(after.version, {...after.data, kits: [], medications: []}, after.data);
      assert.equal(deleted, after.version + 1);
      assert.deepEqual((await db.readState()).data.kits, []);
      assert.deepEqual((await db.readState()).data.medications, []);
    });

    it('stores and reads back an encrypted backup record and request metrics', async () => {
      const db = await loadDb(database.url);
      // A full encrypt -> store -> read -> decrypt round trip: the halves of this are unit
      // tested in isolation, but only Postgres shows whether what comes back out of the
      // bytea columns is still the shape backupCrypto expects.
      process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
      const plaintext = JSON.stringify({inventory: [{id: 'rice-1'}]});
      const {iv, ciphertext, authTag, checksum} = encryptBackup(plaintext);
      await db.insertBackupRecord({
        status: 'success', checksum, sizeBytes: ciphertext.length, inventoryCount: 1, shoppingCount: 0,
        applianceCount: 0, hasPlan: false, iv, authTag, ciphertext,
      });
      const [record] = await db.listBackupRecords();
      assert.equal(record.status, 'success');
      const stored = await db.getBackupRecord(record.id);
      assert.equal(decryptBackup(stored), plaintext);

      await db.recordRequestMetric({route: '/api/hub', outcome: 'ok', status: 200, latencyMs: 12});
      await db.recordRequestMetric({route: '/api/hub', outcome: 'ok', status: 200, latencyMs: 30});
      const summary = await db.summarizeRequestMetrics(60);
      assert.deepEqual(summary, [{route: '/api/hub', outcome: 'ok', requests: 2, average_latency_ms: 21, max_latency_ms: 30, last_seen: summary[0].last_seen}]);
      assert.equal(await db.countRecentFailures('/api/hub'), 0);
    });

    it('stores one readiness snapshot per day, upserting and pruning by retention', async () => {
      const db = await loadDb(database.url);
      const snapshot = {waterDays: 3.5, foodDays: 7, powerDays: 1.25, fuelHours: 24, itemCount: 12, lowStock: 2, expired: 1};
      await db.recordReadinessSnapshot({day: '2026-09-10', ...snapshot});
      await db.recordReadinessSnapshot({day: '2026-09-11', ...snapshot, waterDays: 4.5});
      // A second run on the same day updates that day rather than adding a row, so the daily
      // cron running twice cannot double-count.
      await db.recordReadinessSnapshot({day: '2026-09-11', ...snapshot, waterDays: 6});

      const entries = await db.listReadinessHistory();
      assert.equal(entries.length, 2);
      // Oldest first, so the client can plot straight through without reversing.
      assert.deepEqual(entries.map(entry => Number(entry.waterDays)), [3.5, 6]);
      assert.equal(Number(entries[0].itemCount), 12);
      assert.equal(Number(entries[1].expired), 1);
      // The column is a date, and comes back as one rather than a timestamp string.
      assert.ok(entries[0].day instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(entries[0].day)));

      // Retention is measured from today, and these rows are historical fixtures, so a
      // zero-tolerance window would be ambiguous: prune everything older than one day.
      await db.pruneReadinessHistory(1);
      assert.deepEqual(await db.listReadinessHistory(), []);
    });
  });

  describe('re-running the migration', () => {
    const database = disposableDatabase();
    before(async () => { await migrate(database.url, ownerEnv); });

    it('creates the first owner account once and never a second', async () => {
      const [user] = await query(database.url, 'SELECT id, email, password_hash FROM northstar_users');
      assert.equal(user.email, 'owner@example.test');
      assert.ok(verifyPassword(ownerEnv.HOUSEHOLD_PASSWORD, user.password_hash));
      const [membership] = await query(database.url, 'SELECT role FROM northstar_household_members WHERE user_id = $1', [user.id]);
      assert.equal(membership.role, 'owner');

      const second = await migrate(database.url, {...ownerEnv, HOUSEHOLD_PASSWORD: 'a-different-password-entirely'});
      assert.match(second.stdout, /Database schema ready/);
      const users = await query(database.url, 'SELECT id, password_hash FROM northstar_users');
      assert.equal(users.length, 1);
      assert.equal(users[0].password_hash, user.password_hash, 're-running must not reset the owner password');
    });

    it('preserves household data already in the relational tables', async () => {
      const db = await loadDb(database.url);
      const {data, version} = await db.readState();
      const appliance = {id: 'fridge-1', name: 'Fridge', watts: 150, hours: 8, active: true};
      await db.compareAndSave(version, {...data, appliances: [appliance]}, data);

      await migrate(database.url, ownerEnv);

      const after = await db.readState();
      // Saved without an outage priority, so it reads back at the column's default rather than
      // failing the write: compareAndSave does not assume its caller parsed the input first.
      assert.deepEqual(after.data.appliances, [{...appliance, priority: 'normal'}]);
      assert.equal(after.version, version + 1, 're-running the migration must not bump the household version');
    });
  });

  describe('a deployment still on the pre-relational JSONB row', () => {
    const database = disposableDatabase();
    const legacyState = {
      inventory: [{id: 'water-1', name: 'Water Jug', quantity: 4, unit: 'gal', category: 'Water', caloriesPerUnit: 0, hoursPerUnit: 0, capacityPerUnit: 0, price: 6, gallonsPerUnit: 0, target: 14, store: '', emoji: '💧', image: '', macroTag: '', fuelType: '', purchaseDate: '', expiryDate: ''}],
      shoppingList: [{id: 'beans-1', name: 'Beans', quantity: 2, unit: 'cans', category: 'Food', caloriesPerUnit: 350, hoursPerUnit: 0, capacityPerUnit: 0, price: 2, gallonsPerUnit: 0, target: 0, store: 'Costco', emoji: '', image: '', macroTag: 'Protein', fuelType: '', purchaseDate: '', expiryDate: ''}],
      appliances: [{id: 'furnace-1', name: 'Furnace fan', watts: 400, hours: 6, active: true}],
      plan: {shelterSpot: 'Basement', family: [{name: 'A', role: 'adult', dob: ''}], contacts: [{name: 'Clinic', phone: '555', type: 'medical'}], meetingPoints: {primary: 'Oak tree', secondary: 'Library'}},
      settings: {householdSize: 3, caloriesPerPersonPerDay: 2200, waterGallonsPerPersonPerDay: 1.5, survivalGoalDays: 21, heatGoalHours: 48, powerGoalKwh: 25, batteryUsableFraction: 0.8, inverterEfficiency: 0.85},
    };

    before(async () => {
      // Bring the schema up, then rewind it to how a pre-relational deployment looks: everything
      // in northstar_household.data, nothing in the per-collection tables. The legacy blob has no
      // reminders/checklistChecks key at all, which is exactly what those deployments stored.
      await migrate(database.url);
      await query(database.url, 'TRUNCATE northstar_inventory, northstar_shopping_items, northstar_appliances, northstar_plan, northstar_family_members, northstar_contacts, northstar_settings');
      await query(database.url, 'UPDATE northstar_household SET data = $1::jsonb WHERE id = 1', [JSON.stringify(legacyState)]);
    });

    it('backfills the relational tables from the JSONB row', async () => {
      const result = await migrate(database.url);
      assert.match(result.stdout, /Backfilled relational tables .*1 inventory, 1 shopping list, 1 appliances/);

      const db = await loadDb(database.url);
      const {data} = await db.readState();
      assert.deepEqual(data.inventory.map(row => [row.name, row.quantity, row.barcode, row.recurringDays]), [['Water Jug', 4, '', 0]]);
      assert.deepEqual(data.shoppingList.map(row => [row.name, row.store]), [['Beans', 'Costco']]);
      // A pre-relational blob predates outage priorities; backfilled rows take the default.
      assert.deepEqual(data.appliances, [{...legacyState.appliances[0], priority: 'normal'}]);
      // A pre-relational blob predates per-member consumption figures. Members come back as
      // people with blank overrides -- blank, not zero -- so readiness keeps using the flat
      // householdSize math for this household until someone opts in.
      assert.deepEqual(data.plan, {
        ...legacyState.plan,
        family: legacyState.plan.family.map(member => ({...member, kind: 'person', caloriesPerDay: '', waterGallonsPerDay: ''})),
      });
      assert.deepEqual(data.settings, legacyState.settings);
      assert.deepEqual(data.reminders, [], 'a blob predating reminders must migrate to an empty collection');
      assert.deepEqual(data.checklistChecks, []);
    });

    it('does not backfill a second time over newer edits', async () => {
      const db = await loadDb(database.url);
      const {data, version} = await db.readState();
      await db.compareAndSave(version, {...data, inventory: []}, data);

      const result = await migrate(database.url);
      assert.match(result.stdout, /already contain data; skipping JSONB backfill/);
      assert.deepEqual((await db.readState()).data.inventory, [], 'the deleted item must stay deleted');
    });
  });
});

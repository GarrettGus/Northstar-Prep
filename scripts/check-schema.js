// Read-only check run after a production migration: confirms the tables and columns the current
// code reads and writes exist, and prints row counts for the household's main tables so a run
// that pointed at the wrong (empty) database is obvious. Prints no row contents.
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL_UNPOOLED (or DATABASE_URL).'); process.exit(1); }
const sql = neon(url);

const requiredColumns = {
  northstar_activation: ['mode', 'note', 'started_by', 'started_at'],
  northstar_checkins: ['user_id', 'status', 'note', 'updated_at'],
  northstar_push_subscriptions: ['id', 'user_id', 'endpoint', 'p256dh', 'auth'],
  northstar_kits: ['assigned_to'],
  northstar_plan: ['location_label', 'latitude', 'longitude', 'hazards', 'links'],
  northstar_consumption_events: ['item_id', 'event_date', 'quantity'],
};

const rows = await sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`;
const present = new Set(rows.map(row => `${row.table_name}.${row.column_name}`));
const missing = Object.entries(requiredColumns).flatMap(([table, columns]) => columns.filter(column => !present.has(`${table}.${column}`)).map(column => `${table}.${column}`));
if (missing.length) { console.error(`Missing after migration: ${missing.join(', ')}`); process.exit(1); }

const [counts] = await sql`SELECT
  (SELECT count(*)::int FROM northstar_users) AS accounts,
  (SELECT count(*)::int FROM northstar_inventory) AS inventory,
  (SELECT count(*)::int FROM northstar_plan) AS plans,
  (SELECT version FROM northstar_household WHERE id = 1) AS household_version`;
console.log(`Schema OK. Accounts: ${counts.accounts}, inventory rows: ${counts.inventory}, plans: ${counts.plans}, household version: ${counts.household_version}.`);

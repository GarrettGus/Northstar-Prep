// Direct database access for the browser suite: resetting the household between specs and
// reading back what the app actually persisted. Deliberately bypasses the API so an assertion
// about stored state cannot pass because of a cache the UI is still showing.
import pg from 'pg';
import { environment } from './environment.js';

const collections = [
  'northstar_inventory', 'northstar_shopping_items', 'northstar_appliances', 'northstar_reminders',
  'northstar_checklist_checks', 'northstar_plan', 'northstar_family_members', 'northstar_contacts',
  'northstar_settings', 'northstar_audit_log', 'northstar_reminder_history', 'northstar_backups',
];

export async function query(text, values = []) {
  const client = new pg.Client({connectionString: environment().databaseUrl});
  await client.connect();
  try { return (await client.query(text, values)).rows; } finally { await client.end(); }
}

export async function resetHousehold() {
  await query(`TRUNCATE ${collections.join(', ')}`);
  await query('UPDATE northstar_household SET version = 0, writer_token = NULL WHERE id = 1');
}

export async function inventoryNames() {
  return (await query('SELECT name FROM northstar_inventory WHERE household_id = 1 ORDER BY name')).map(row => row.name);
}

export async function shoppingNames() {
  return (await query('SELECT name FROM northstar_shopping_items WHERE household_id = 1 ORDER BY name')).map(row => row.name);
}

import { neon } from '@neondatabase/serverless';
import { emptyState, stateSchema } from '../shared/schema.js';
export function database() {
  if (!process.env.DATABASE_URL) throw new Error('Database is not configured.');
  return neon(process.env.DATABASE_URL);
}
export async function readState() {
  const sql = database();
  const rows = await sql`SELECT data, version FROM northstar_household WHERE id = 1`;
  if (!rows.length) throw new Error('Run the database migration before using the app.');
  return {data:stateSchema.parse(rows[0].data), version:rows[0].version};
}
export async function compareAndSave(version, data) {
  const sql = database();
  const rows = await sql`UPDATE northstar_household SET data = ${JSON.stringify(data)}::jsonb, version = version + 1 WHERE id = 1 AND version = ${version} RETURNING version`;
  return rows[0]?.version;
}
export async function rateLimit(key) {
  const sql = database();
  const rows = await sql`INSERT INTO northstar_login_limits (key, attempts, reset_at)
    VALUES (${key}, 1, now() + interval '15 minutes')
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN northstar_login_limits.reset_at < now() THEN 1 ELSE northstar_login_limits.attempts + 1 END,
      reset_at = CASE WHEN northstar_login_limits.reset_at < now() THEN now() + interval '15 minutes' ELSE northstar_login_limits.reset_at END
    RETURNING attempts`;
  return rows[0].attempts <= 10;
}

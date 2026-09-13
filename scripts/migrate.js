import { neon } from '@neondatabase/serverless';
import { emptyState } from '../shared/schema.js';
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
await sql`CREATE TABLE IF NOT EXISTS northstar_household (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL, version integer NOT NULL DEFAULT 0)`;
await sql`INSERT INTO northstar_household (id,data) VALUES (1,${JSON.stringify(emptyState())}::jsonb) ON CONFLICT (id) DO NOTHING`;
await sql`CREATE TABLE IF NOT EXISTS northstar_login_limits (key text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL)`;
console.log('Database schema ready. Existing household data preserved.');

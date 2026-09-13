import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import { emptyState, emailSchema } from '../shared/schema.js';
import { hashPassword } from '../server/auth.js';
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
await sql`CREATE TABLE IF NOT EXISTS northstar_household (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL, version integer NOT NULL DEFAULT 0)`;
await sql`INSERT INTO northstar_household (id,data) VALUES (1,${JSON.stringify(emptyState())}::jsonb) ON CONFLICT (id) DO NOTHING`;
await sql`CREATE TABLE IF NOT EXISTS northstar_login_limits (key text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL)`;

await sql`CREATE TABLE IF NOT EXISTS northstar_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE TABLE IF NOT EXISTS northstar_household_members (
  household_id integer NOT NULL REFERENCES northstar_household(id),
  user_id uuid NOT NULL REFERENCES northstar_users(id),
  role text NOT NULL CHECK (role IN ('owner','member')),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
)`;
await sql`CREATE TABLE IF NOT EXISTS northstar_invitations (
  id uuid PRIMARY KEY,
  household_id integer NOT NULL REFERENCES northstar_household(id),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','member')),
  invited_by uuid REFERENCES northstar_users(id),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES northstar_users(id)
)`;
await sql`CREATE TABLE IF NOT EXISTS northstar_audit_log (
  id bigserial PRIMARY KEY,
  household_id integer NOT NULL REFERENCES northstar_household(id),
  user_id uuid REFERENCES northstar_users(id),
  action text NOT NULL,
  collection text,
  item_id text,
  item_name text,
  created_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS northstar_audit_log_household_idx ON northstar_audit_log (household_id, created_at DESC)`;

// One-time bootstrap: migrating from the shared-password login creates the first owner
// account from HOUSEHOLD_OWNER_EMAIL/HOUSEHOLD_PASSWORD. It only ever runs while no
// accounts exist yet, so it's safe to leave both variables set after the first run.
const [{count}] = await sql`SELECT count(*)::int AS count FROM northstar_users`;
if (count === 0 && process.env.HOUSEHOLD_OWNER_EMAIL && process.env.HOUSEHOLD_PASSWORD) {
  const email = emailSchema.parse(process.env.HOUSEHOLD_OWNER_EMAIL);
  const userId = randomUUID();
  await sql.transaction(tx => [
    tx`INSERT INTO northstar_users (id, email, password_hash) VALUES (${userId}, ${email}, ${hashPassword(process.env.HOUSEHOLD_PASSWORD)})`,
    tx`INSERT INTO northstar_household_members (household_id, user_id, role) VALUES (1, ${userId}, 'owner')`,
  ]);
  console.log(`Created the first owner account for ${email}. The shared HOUSEHOLD_PASSWORD login no longer works; sign in with this email and password instead.`);
} else if (count === 0) {
  console.log('No accounts exist yet. Set HOUSEHOLD_OWNER_EMAIL and HOUSEHOLD_PASSWORD, then re-run this migration to create the first owner account.');
}

console.log('Database schema ready. Existing household data preserved.');

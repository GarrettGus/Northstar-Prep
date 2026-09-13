import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
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

// --- Accounts, membership, invitations and audit history (household 1 is the only household today). ---
export async function findUserByEmail(email) {
  const sql = database();
  const rows = await sql`SELECT id, email, password_hash FROM northstar_users WHERE email = ${email}`;
  return rows[0];
}
export async function findUserById(userId) {
  const sql = database();
  const rows = await sql`SELECT id, email FROM northstar_users WHERE id = ${userId}`;
  return rows[0];
}
export async function getMembership(userId, householdId = 1) {
  const sql = database();
  const rows = await sql`SELECT role FROM northstar_household_members WHERE household_id = ${householdId} AND user_id = ${userId}`;
  return rows[0];
}
export async function listMembers(householdId = 1) {
  const sql = database();
  return sql`SELECT u.id AS user_id, u.email, m.role, m.added_at
    FROM northstar_household_members m JOIN northstar_users u ON u.id = m.user_id
    WHERE m.household_id = ${householdId} ORDER BY m.added_at ASC`;
}
export async function createUserWithMembership({email, passwordHash, householdId = 1, role}) {
  const sql = database();
  const userId = randomUUID();
  await sql.transaction(tx => [
    tx`INSERT INTO northstar_users (id, email, password_hash) VALUES (${userId}, ${email}, ${passwordHash})`,
    tx`INSERT INTO northstar_household_members (household_id, user_id, role) VALUES (${householdId}, ${userId}, ${role})`,
  ]);
  return userId;
}
export async function removeMember(userId, householdId = 1) {
  const sql = database();
  // The guard against removing the last owner runs inside the DELETE so no
  // concurrent request can race between a count check and the delete itself.
  const rows = await sql`DELETE FROM northstar_household_members
    WHERE household_id = ${householdId} AND user_id = ${userId}
      AND (role <> 'owner' OR (SELECT count(*) FROM northstar_household_members WHERE household_id = ${householdId} AND role = 'owner') > 1)
    RETURNING user_id`;
  return Boolean(rows[0]);
}
export async function createInvitation({householdId = 1, email, role, invitedBy, tokenHash, expiresAt}) {
  const sql = database();
  const id = randomUUID();
  await sql`INSERT INTO northstar_invitations (id, household_id, email, role, invited_by, token_hash, expires_at)
    VALUES (${id}, ${householdId}, ${email}, ${role}, ${invitedBy}, ${tokenHash}, ${expiresAt})`;
  return id;
}
export async function listPendingInvitations(householdId = 1) {
  const sql = database();
  return sql`SELECT id, email, role, created_at, expires_at FROM northstar_invitations
    WHERE household_id = ${householdId} AND accepted_at IS NULL ORDER BY created_at DESC`;
}
export async function revokeInvitation(invitationId, householdId = 1) {
  const sql = database();
  const rows = await sql`DELETE FROM northstar_invitations WHERE id = ${invitationId} AND household_id = ${householdId} AND accepted_at IS NULL RETURNING id`;
  return Boolean(rows[0]);
}
export async function findInvitationByTokenHash(tokenHash) {
  const sql = database();
  const rows = await sql`SELECT id, household_id, email, role, expires_at, accepted_at FROM northstar_invitations WHERE token_hash = ${tokenHash}`;
  return rows[0];
}
export async function acceptInvitation({invitationId, householdId, role, email, passwordHash}) {
  const sql = database();
  const userId = randomUUID();
  await sql.transaction(tx => [
    tx`INSERT INTO northstar_users (id, email, password_hash) VALUES (${userId}, ${email}, ${passwordHash})`,
    tx`INSERT INTO northstar_household_members (household_id, user_id, role) VALUES (${householdId}, ${userId}, ${role})`,
    tx`UPDATE northstar_invitations SET accepted_at = now(), accepted_by = ${userId} WHERE id = ${invitationId} AND accepted_at IS NULL`,
  ]);
  return userId;
}
export async function insertAuditLog({householdId = 1, userId, action, collection = null, itemId = null, itemName = null}) {
  const sql = database();
  await sql`INSERT INTO northstar_audit_log (household_id, user_id, action, collection, item_id, item_name)
    VALUES (${householdId}, ${userId}, ${action}, ${collection}, ${itemId}, ${itemName})`;
}
export async function listAuditLog(householdId = 1, limit = 50) {
  const sql = database();
  return sql`SELECT a.action, a.collection, a.item_id, a.item_name, a.created_at, u.email AS actor_email
    FROM northstar_audit_log a LEFT JOIN northstar_users u ON u.id = a.user_id
    WHERE a.household_id = ${householdId} ORDER BY a.created_at DESC LIMIT ${limit}`;
}

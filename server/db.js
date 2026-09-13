import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import { emptyState, stateSchema } from '../shared/schema.js';
export function database() {
  if (!process.env.DATABASE_URL) throw new Error('Database is not configured.');
  return neon(process.env.DATABASE_URL);
}

const householdId = 1;

// --- Household state, normalized across per-collection tables instead of one JSONB blob. ---
// readState() joins the tables back into the shape the rest of the app already expects;
// compareAndSave() diffs the incoming state against what was last read and only writes the
// rows that actually changed, inside one transaction guarded by the household's version.
export async function readState() {
  const sql = database();
  const [households, inventory, shoppingList, appliances, planRows, familyRows, contactRows, settingsRows] = await Promise.all([
    sql`SELECT version FROM northstar_household WHERE id = ${householdId}`,
    sql`SELECT id, name, quantity, unit, category,
          calories_per_unit AS "caloriesPerUnit", hours_per_unit AS "hoursPerUnit", capacity_per_unit AS "capacityPerUnit",
          price, gallons_per_unit AS "gallonsPerUnit", target, store, emoji, image,
          macro_tag AS "macroTag", fuel_type AS "fuelType", purchase_date AS "purchaseDate", expiry_date AS "expiryDate"
        FROM northstar_inventory WHERE household_id = ${householdId} ORDER BY seq`,
    sql`SELECT id, name, quantity, unit, category,
          calories_per_unit AS "caloriesPerUnit", hours_per_unit AS "hoursPerUnit", capacity_per_unit AS "capacityPerUnit",
          price, gallons_per_unit AS "gallonsPerUnit", target, store, emoji, image,
          macro_tag AS "macroTag", fuel_type AS "fuelType", purchase_date AS "purchaseDate", expiry_date AS "expiryDate"
        FROM northstar_shopping_items WHERE household_id = ${householdId} ORDER BY seq`,
    sql`SELECT id, name, watts, hours, active FROM northstar_appliances WHERE household_id = ${householdId} ORDER BY seq`,
    sql`SELECT shelter_spot AS "shelterSpot", meeting_primary AS "meetingPrimary", meeting_secondary AS "meetingSecondary"
        FROM northstar_plan WHERE household_id = ${householdId}`,
    sql`SELECT name, role, dob FROM northstar_family_members WHERE household_id = ${householdId} ORDER BY position`,
    sql`SELECT name, phone, type FROM northstar_contacts WHERE household_id = ${householdId} ORDER BY position`,
    sql`SELECT household_size AS "householdSize", calories_per_person_per_day AS "caloriesPerPersonPerDay",
          water_gallons_per_person_per_day AS "waterGallonsPerPersonPerDay", survival_goal_days AS "survivalGoalDays",
          heat_goal_hours AS "heatGoalHours", power_goal_kwh AS "powerGoalKwh",
          battery_usable_fraction AS "batteryUsableFraction", inverter_efficiency AS "inverterEfficiency"
        FROM northstar_settings WHERE household_id = ${householdId}`,
  ]);
  if (!households.length) throw new Error('Run the database migration before using the app.');
  const planRow = planRows[0];
  const plan = planRow ? {
    shelterSpot: planRow.shelterSpot,
    family: familyRows,
    contacts: contactRows,
    meetingPoints: {primary: planRow.meetingPrimary, secondary: planRow.meetingSecondary},
  } : null;
  const data = stateSchema.parse({inventory, shoppingList, appliances, plan, settings: settingsRows[0]});
  return {data, version: households[0].version};
}

function diffById(currentRows, nextRows) {
  const currentById = new Map(currentRows.map(row => [row.id, row]));
  const nextIds = new Set(nextRows.map(row => row.id));
  const toDelete = currentRows.filter(row => !nextIds.has(row.id)).map(row => row.id);
  const toUpsert = nextRows.filter(row => JSON.stringify(currentById.get(row.id)) !== JSON.stringify(row));
  return {toDelete, toUpsert};
}
function upsertInventoryItem(tx, item, guard) {
  return tx`INSERT INTO northstar_inventory (household_id, id, name, quantity, unit, category, calories_per_unit, hours_per_unit, capacity_per_unit, price, gallons_per_unit, target, store, emoji, image, macro_tag, fuel_type, purchase_date, expiry_date)
    SELECT ${householdId}, ${item.id}, ${item.name}, ${item.quantity}, ${item.unit}, ${item.category}, ${item.caloriesPerUnit}, ${item.hoursPerUnit}, ${item.capacityPerUnit}, ${item.price}, ${item.gallonsPerUnit}, ${item.target}, ${item.store}, ${item.emoji}, ${item.image}, ${item.macroTag}, ${item.fuelType}, ${item.purchaseDate}, ${item.expiryDate}
    WHERE ${guard}
    ON CONFLICT (household_id, id) DO UPDATE SET
      name = EXCLUDED.name, quantity = EXCLUDED.quantity, unit = EXCLUDED.unit, category = EXCLUDED.category,
      calories_per_unit = EXCLUDED.calories_per_unit, hours_per_unit = EXCLUDED.hours_per_unit, capacity_per_unit = EXCLUDED.capacity_per_unit,
      price = EXCLUDED.price, gallons_per_unit = EXCLUDED.gallons_per_unit, target = EXCLUDED.target, store = EXCLUDED.store,
      emoji = EXCLUDED.emoji, image = EXCLUDED.image, macro_tag = EXCLUDED.macro_tag, fuel_type = EXCLUDED.fuel_type,
      purchase_date = EXCLUDED.purchase_date, expiry_date = EXCLUDED.expiry_date`;
}
function upsertShoppingItem(tx, item, guard) {
  return tx`INSERT INTO northstar_shopping_items (household_id, id, name, quantity, unit, category, calories_per_unit, hours_per_unit, capacity_per_unit, price, gallons_per_unit, target, store, emoji, image, macro_tag, fuel_type, purchase_date, expiry_date)
    SELECT ${householdId}, ${item.id}, ${item.name}, ${item.quantity}, ${item.unit}, ${item.category}, ${item.caloriesPerUnit}, ${item.hoursPerUnit}, ${item.capacityPerUnit}, ${item.price}, ${item.gallonsPerUnit}, ${item.target}, ${item.store}, ${item.emoji}, ${item.image}, ${item.macroTag}, ${item.fuelType}, ${item.purchaseDate}, ${item.expiryDate}
    WHERE ${guard}
    ON CONFLICT (household_id, id) DO UPDATE SET
      name = EXCLUDED.name, quantity = EXCLUDED.quantity, unit = EXCLUDED.unit, category = EXCLUDED.category,
      calories_per_unit = EXCLUDED.calories_per_unit, hours_per_unit = EXCLUDED.hours_per_unit, capacity_per_unit = EXCLUDED.capacity_per_unit,
      price = EXCLUDED.price, gallons_per_unit = EXCLUDED.gallons_per_unit, target = EXCLUDED.target, store = EXCLUDED.store,
      emoji = EXCLUDED.emoji, image = EXCLUDED.image, macro_tag = EXCLUDED.macro_tag, fuel_type = EXCLUDED.fuel_type,
      purchase_date = EXCLUDED.purchase_date, expiry_date = EXCLUDED.expiry_date`;
}

export async function compareAndSave(version, next, current = emptyState()) {
  const sql = database();
  const targetVersion = version + 1;
  const inventoryDiff = diffById(current.inventory, next.inventory);
  const shoppingDiff = diffById(current.shoppingList, next.shoppingList);
  const applianceDiff = diffById(current.appliances, next.appliances);
  const planChanged = JSON.stringify(current.plan) !== JSON.stringify(next.plan);
  const settingsChanged = JSON.stringify(current.settings) !== JSON.stringify(next.settings);

  const results = await sql.transaction(tx => {
    const statements = [tx`UPDATE northstar_household SET version = ${targetVersion} WHERE id = ${householdId} AND version = ${version} RETURNING version`];
    const guard = tx`EXISTS (SELECT 1 FROM northstar_household WHERE id = ${householdId} AND version = ${targetVersion})`;

    for (const id of inventoryDiff.toDelete) statements.push(tx`DELETE FROM northstar_inventory WHERE household_id = ${householdId} AND id = ${id} AND ${guard}`);
    for (const item of inventoryDiff.toUpsert) statements.push(upsertInventoryItem(tx, item, guard));
    for (const id of shoppingDiff.toDelete) statements.push(tx`DELETE FROM northstar_shopping_items WHERE household_id = ${householdId} AND id = ${id} AND ${guard}`);
    for (const item of shoppingDiff.toUpsert) statements.push(upsertShoppingItem(tx, item, guard));
    for (const id of applianceDiff.toDelete) statements.push(tx`DELETE FROM northstar_appliances WHERE household_id = ${householdId} AND id = ${id} AND ${guard}`);
    for (const appliance of applianceDiff.toUpsert) statements.push(tx`
      INSERT INTO northstar_appliances (household_id, id, name, watts, hours, active)
      SELECT ${householdId}, ${appliance.id}, ${appliance.name}, ${appliance.watts}, ${appliance.hours}, ${appliance.active}
      WHERE ${guard}
      ON CONFLICT (household_id, id) DO UPDATE SET name = EXCLUDED.name, watts = EXCLUDED.watts, hours = EXCLUDED.hours, active = EXCLUDED.active`);

    if (planChanged) {
      if (next.plan === null) {
        statements.push(tx`DELETE FROM northstar_plan WHERE household_id = ${householdId} AND ${guard}`);
        statements.push(tx`DELETE FROM northstar_family_members WHERE household_id = ${householdId} AND ${guard}`);
        statements.push(tx`DELETE FROM northstar_contacts WHERE household_id = ${householdId} AND ${guard}`);
      } else {
        statements.push(tx`INSERT INTO northstar_plan (household_id, shelter_spot, meeting_primary, meeting_secondary)
          SELECT ${householdId}, ${next.plan.shelterSpot}, ${next.plan.meetingPoints.primary}, ${next.plan.meetingPoints.secondary}
          WHERE ${guard}
          ON CONFLICT (household_id) DO UPDATE SET shelter_spot = EXCLUDED.shelter_spot, meeting_primary = EXCLUDED.meeting_primary, meeting_secondary = EXCLUDED.meeting_secondary`);
        statements.push(tx`DELETE FROM northstar_family_members WHERE household_id = ${householdId} AND ${guard}`);
        for (let position = 0; position < next.plan.family.length; position++) {
          const member = next.plan.family[position];
          statements.push(tx`INSERT INTO northstar_family_members (household_id, position, name, role, dob)
            SELECT ${householdId}, ${position}, ${member.name}, ${member.role}, ${member.dob} WHERE ${guard}`);
        }
        statements.push(tx`DELETE FROM northstar_contacts WHERE household_id = ${householdId} AND ${guard}`);
        for (let position = 0; position < next.plan.contacts.length; position++) {
          const contact = next.plan.contacts[position];
          statements.push(tx`INSERT INTO northstar_contacts (household_id, position, name, phone, type)
            SELECT ${householdId}, ${position}, ${contact.name}, ${contact.phone}, ${contact.type} WHERE ${guard}`);
        }
      }
    }

    if (settingsChanged) {
      statements.push(tx`INSERT INTO northstar_settings (household_id, household_size, calories_per_person_per_day, water_gallons_per_person_per_day, survival_goal_days, heat_goal_hours, power_goal_kwh, battery_usable_fraction, inverter_efficiency)
        SELECT ${householdId}, ${next.settings.householdSize}, ${next.settings.caloriesPerPersonPerDay}, ${next.settings.waterGallonsPerPersonPerDay}, ${next.settings.survivalGoalDays}, ${next.settings.heatGoalHours}, ${next.settings.powerGoalKwh}, ${next.settings.batteryUsableFraction}, ${next.settings.inverterEfficiency}
        WHERE ${guard}
        ON CONFLICT (household_id) DO UPDATE SET household_size = EXCLUDED.household_size, calories_per_person_per_day = EXCLUDED.calories_per_person_per_day,
          water_gallons_per_person_per_day = EXCLUDED.water_gallons_per_person_per_day, survival_goal_days = EXCLUDED.survival_goal_days,
          heat_goal_hours = EXCLUDED.heat_goal_hours, power_goal_kwh = EXCLUDED.power_goal_kwh,
          battery_usable_fraction = EXCLUDED.battery_usable_fraction, inverter_efficiency = EXCLUDED.inverter_efficiency`);
    }

    return statements;
  });

  return results[0][0]?.version;
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

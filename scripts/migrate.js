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

// --- Relational household tables (inventory, shopping list, appliances, family plan, settings). ---
// These replace the single JSONB blob in northstar_household.data as the source of truth so that
// one edit only touches its own row instead of rewriting the entire household's state.
await sql`CREATE TABLE IF NOT EXISTS northstar_inventory (
  household_id integer NOT NULL REFERENCES northstar_household(id),
  id text NOT NULL,
  seq bigserial,
  name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'units',
  category text NOT NULL DEFAULT 'Gear',
  calories_per_unit numeric NOT NULL DEFAULT 0,
  hours_per_unit numeric NOT NULL DEFAULT 0,
  capacity_per_unit numeric NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  gallons_per_unit numeric NOT NULL DEFAULT 0,
  target numeric NOT NULL DEFAULT 0,
  store text NOT NULL DEFAULT '',
  emoji text NOT NULL DEFAULT '',
  image text NOT NULL DEFAULT '',
  macro_tag text NOT NULL DEFAULT '',
  fuel_type text NOT NULL DEFAULT '',
  purchase_date text NOT NULL DEFAULT '',
  expiry_date text NOT NULL DEFAULT '',
  barcode text NOT NULL DEFAULT '',
  recurring_days integer NOT NULL DEFAULT 0,
  PRIMARY KEY (household_id, id)
)`;
await sql`CREATE TABLE IF NOT EXISTS northstar_shopping_items (
  household_id integer NOT NULL REFERENCES northstar_household(id),
  id text NOT NULL,
  seq bigserial,
  name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'units',
  category text NOT NULL DEFAULT 'Gear',
  calories_per_unit numeric NOT NULL DEFAULT 0,
  hours_per_unit numeric NOT NULL DEFAULT 0,
  capacity_per_unit numeric NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  gallons_per_unit numeric NOT NULL DEFAULT 0,
  target numeric NOT NULL DEFAULT 0,
  store text NOT NULL DEFAULT '',
  emoji text NOT NULL DEFAULT '',
  image text NOT NULL DEFAULT '',
  macro_tag text NOT NULL DEFAULT '',
  fuel_type text NOT NULL DEFAULT '',
  purchase_date text NOT NULL DEFAULT '',
  expiry_date text NOT NULL DEFAULT '',
  barcode text NOT NULL DEFAULT '',
  recurring_days integer NOT NULL DEFAULT 0,
  PRIMARY KEY (household_id, id)
)`;
// Existing deployments created these tables before barcode/recurring_days existed.
await sql`ALTER TABLE northstar_inventory ADD COLUMN IF NOT EXISTS barcode text NOT NULL DEFAULT ''`;
await sql`ALTER TABLE northstar_inventory ADD COLUMN IF NOT EXISTS recurring_days integer NOT NULL DEFAULT 0`;
await sql`ALTER TABLE northstar_shopping_items ADD COLUMN IF NOT EXISTS barcode text NOT NULL DEFAULT ''`;
await sql`ALTER TABLE northstar_shopping_items ADD COLUMN IF NOT EXISTS recurring_days integer NOT NULL DEFAULT 0`;
await sql`CREATE TABLE IF NOT EXISTS northstar_appliances (
  household_id integer NOT NULL REFERENCES northstar_household(id),
  id text NOT NULL,
  seq bigserial,
  name text NOT NULL,
  watts numeric NOT NULL DEFAULT 0,
  hours numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (household_id, id)
)`;
await sql`CREATE TABLE IF NOT EXISTS northstar_plan (
  household_id integer PRIMARY KEY REFERENCES northstar_household(id),
  shelter_spot text NOT NULL DEFAULT '',
  meeting_primary text NOT NULL DEFAULT '',
  meeting_secondary text NOT NULL DEFAULT ''
)`;
await sql`CREATE TABLE IF NOT EXISTS northstar_family_members (
  household_id integer NOT NULL REFERENCES northstar_household(id),
  position integer NOT NULL,
  name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  dob text NOT NULL DEFAULT '',
  PRIMARY KEY (household_id, position)
)`;
await sql`CREATE TABLE IF NOT EXISTS northstar_contacts (
  household_id integer NOT NULL REFERENCES northstar_household(id),
  position integer NOT NULL,
  name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT '',
  PRIMARY KEY (household_id, position)
)`;
await sql`CREATE TABLE IF NOT EXISTS northstar_settings (
  household_id integer PRIMARY KEY REFERENCES northstar_household(id),
  household_size integer NOT NULL DEFAULT 4,
  calories_per_person_per_day numeric NOT NULL DEFAULT 2000,
  water_gallons_per_person_per_day numeric NOT NULL DEFAULT 1,
  survival_goal_days integer NOT NULL DEFAULT 14,
  heat_goal_hours numeric NOT NULL DEFAULT 36,
  power_goal_kwh numeric NOT NULL DEFAULT 20,
  battery_usable_fraction numeric NOT NULL DEFAULT 0.9,
  inverter_efficiency numeric NOT NULL DEFAULT 0.9
)`;
await sql`CREATE INDEX IF NOT EXISTS northstar_inventory_household_category_idx ON northstar_inventory (household_id, category)`;
await sql`CREATE INDEX IF NOT EXISTS northstar_shopping_items_household_category_idx ON northstar_shopping_items (household_id, category)`;

// --- Encrypted, scheduled household backups (see api/backup.js and server/backupCrypto.js). ---
await sql`CREATE TABLE IF NOT EXISTS northstar_backups (
  id bigserial PRIMARY KEY,
  household_id integer NOT NULL REFERENCES northstar_household(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('success','failed')),
  error text,
  checksum text,
  size_bytes integer,
  inventory_count integer,
  shopping_count integer,
  appliance_count integer,
  has_plan boolean,
  iv bytea,
  auth_tag bytea,
  ciphertext bytea
)`;
await sql`CREATE INDEX IF NOT EXISTS northstar_backups_household_idx ON northstar_backups (household_id, created_at DESC)`;

// One-time backfill: copy the existing JSONB row into the new relational tables. Only runs while
// the relational tables are still empty, so it's safe to leave in place and re-run this script.
const [{count: inventoryRows}] = await sql`SELECT count(*)::int AS count FROM northstar_inventory`;
const [{count: settingsRows}] = await sql`SELECT count(*)::int AS count FROM northstar_settings`;
if (inventoryRows === 0 && settingsRows === 0) {
  const [existing] = await sql`SELECT data FROM northstar_household WHERE id = 1`;
  if (existing) {
    const state = stateSchema.parse(existing.data);
    for (const item of state.inventory) {
      await sql`INSERT INTO northstar_inventory (household_id, id, name, quantity, unit, category, calories_per_unit, hours_per_unit, capacity_per_unit, price, gallons_per_unit, target, store, emoji, image, macro_tag, fuel_type, purchase_date, expiry_date)
        VALUES (1, ${item.id}, ${item.name}, ${item.quantity}, ${item.unit}, ${item.category}, ${item.caloriesPerUnit}, ${item.hoursPerUnit}, ${item.capacityPerUnit}, ${item.price}, ${item.gallonsPerUnit}, ${item.target}, ${item.store}, ${item.emoji}, ${item.image}, ${item.macroTag}, ${item.fuelType}, ${item.purchaseDate}, ${item.expiryDate})
        ON CONFLICT (household_id, id) DO NOTHING`;
    }
    for (const item of state.shoppingList) {
      await sql`INSERT INTO northstar_shopping_items (household_id, id, name, quantity, unit, category, calories_per_unit, hours_per_unit, capacity_per_unit, price, gallons_per_unit, target, store, emoji, image, macro_tag, fuel_type, purchase_date, expiry_date)
        VALUES (1, ${item.id}, ${item.name}, ${item.quantity}, ${item.unit}, ${item.category}, ${item.caloriesPerUnit}, ${item.hoursPerUnit}, ${item.capacityPerUnit}, ${item.price}, ${item.gallonsPerUnit}, ${item.target}, ${item.store}, ${item.emoji}, ${item.image}, ${item.macroTag}, ${item.fuelType}, ${item.purchaseDate}, ${item.expiryDate})
        ON CONFLICT (household_id, id) DO NOTHING`;
    }
    for (const appliance of state.appliances) {
      await sql`INSERT INTO northstar_appliances (household_id, id, name, watts, hours, active)
        VALUES (1, ${appliance.id}, ${appliance.name}, ${appliance.watts}, ${appliance.hours}, ${appliance.active})
        ON CONFLICT (household_id, id) DO NOTHING`;
    }
    if (state.plan) {
      await sql`INSERT INTO northstar_plan (household_id, shelter_spot, meeting_primary, meeting_secondary)
        VALUES (1, ${state.plan.shelterSpot}, ${state.plan.meetingPoints.primary}, ${state.plan.meetingPoints.secondary})
        ON CONFLICT (household_id) DO NOTHING`;
      for (let position = 0; position < state.plan.family.length; position++) {
        const member = state.plan.family[position];
        await sql`INSERT INTO northstar_family_members (household_id, position, name, role, dob)
          VALUES (1, ${position}, ${member.name}, ${member.role}, ${member.dob})
          ON CONFLICT (household_id, position) DO NOTHING`;
      }
      for (let position = 0; position < state.plan.contacts.length; position++) {
        const contact = state.plan.contacts[position];
        await sql`INSERT INTO northstar_contacts (household_id, position, name, phone, type)
          VALUES (1, ${position}, ${contact.name}, ${contact.phone}, ${contact.type})
          ON CONFLICT (household_id, position) DO NOTHING`;
      }
    }
    await sql`INSERT INTO northstar_settings (household_id, household_size, calories_per_person_per_day, water_gallons_per_person_per_day, survival_goal_days, heat_goal_hours, power_goal_kwh, battery_usable_fraction, inverter_efficiency)
      VALUES (1, ${state.settings.householdSize}, ${state.settings.caloriesPerPersonPerDay}, ${state.settings.waterGallonsPerPersonPerDay}, ${state.settings.survivalGoalDays}, ${state.settings.heatGoalHours}, ${state.settings.powerGoalKwh}, ${state.settings.batteryUsableFraction}, ${state.settings.inverterEfficiency})
      ON CONFLICT (household_id) DO NOTHING`;
    console.log(`Backfilled relational tables from the existing household row (${state.inventory.length} inventory, ${state.shoppingList.length} shopping list, ${state.appliances.length} appliances).`);
  }
} else {
  console.log('Relational household tables already contain data; skipping JSONB backfill.');
}

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

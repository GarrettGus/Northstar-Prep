import { z } from 'zod';

const text = z.string().max(500);
const number = z.coerce.number().finite().nonnegative().max(1e9).default(0);
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/);
const date = z.union([z.literal(''), z.iso.date()]).default('');
export const fuelTypes = ['', 'Propane', 'Gasoline', 'Diesel', 'Wood', 'Kerosene', 'Battery', 'Other'];

export const emailSchema = z.preprocess(value => typeof value === 'string' ? value.trim().toLowerCase() : value, z.email().max(254));
export const passwordSchema = z.string().min(8).max(200);
export const roleSchema = z.enum(['owner', 'member']);

const fraction = z.coerce.number().finite().min(0).max(1);
const settingsFields = {
  householdSize: z.coerce.number().int().min(1).max(50),
  caloriesPerPersonPerDay: z.coerce.number().finite().min(0).max(10000),
  waterGallonsPerPersonPerDay: z.coerce.number().finite().min(0).max(20),
  survivalGoalDays: z.coerce.number().int().min(1).max(365),
  heatGoalHours: z.coerce.number().finite().min(0).max(10000),
  powerGoalKwh: z.coerce.number().finite().min(0).max(10000),
  batteryUsableFraction: fraction,
  inverterEfficiency: fraction,
};

// Accept names used by the first Firebase-free build so existing rows and backups remain readable.
const normalizeSettingsAliases = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = {...value};
  if (next.caloriesPerPersonPerDay === undefined && next.caloriesPerPersonDay !== undefined) next.caloriesPerPersonPerDay = next.caloriesPerPersonDay;
  if (next.waterGallonsPerPersonPerDay === undefined && next.waterPerPersonDay !== undefined) next.waterGallonsPerPersonPerDay = next.waterPerPersonDay;
  delete next.caloriesPerPersonDay;
  delete next.waterPerPersonDay;
  delete next.powerRuntimeGoalDays;
  return next;
};

const settingsObject = z.object({
  householdSize: settingsFields.householdSize.default(4),
  caloriesPerPersonPerDay: settingsFields.caloriesPerPersonPerDay.default(2000),
  waterGallonsPerPersonPerDay: settingsFields.waterGallonsPerPersonPerDay.default(1),
  survivalGoalDays: settingsFields.survivalGoalDays.default(14),
  heatGoalHours: settingsFields.heatGoalHours.default(36),
  powerGoalKwh: settingsFields.powerGoalKwh.default(20),
  batteryUsableFraction: settingsFields.batteryUsableFraction.default(0.9),
  inverterEfficiency: settingsFields.inverterEfficiency.default(0.9),
});
export const settingsSchema = z.preprocess(normalizeSettingsAliases, settingsObject);
export const settingsInputSchema = z.preprocess(normalizeSettingsAliases, z.object(settingsFields).partial());

export const itemSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(200), quantity: number,
  unit: z.string().max(80).default('units'),
  category: z.enum(['Food', 'Water', 'Medical', 'Gear', 'Fuel', 'Power']).default('Gear'),
  caloriesPerUnit: number, hoursPerUnit: number, capacityPerUnit: number, price: number,
  gallonsPerUnit: number, target: number, store: text.default(''), emoji: z.string().max(30).default(''),
  // Legacy/offline-queued rows may still carry a base64 data URL; the server converts those to
  // an object storage URL (https://*.public.blob.vercel-storage.com/...) before persisting.
  image: z.string().max(180000).regex(/^(?:|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+|https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[A-Za-z0-9/_.-]+)$/).default(''),
  macroTag: z.enum(['', 'Carbs', 'Protein', 'Fat', 'Balanced']).default(''),
  fuelType: z.enum(fuelTypes).default(''),
  purchaseDate: date, expiryDate: date,
});
export const applianceSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(200), watts: number, hours: z.coerce.number().finite().min(0).max(24), active: z.boolean().default(true) });
export const planSchema = z.object({
  shelterSpot: z.string().max(3000).default(''),
  family: z.array(z.object({name: z.string().max(100), role: z.string().max(100), dob: z.string().max(30)})).max(30).default([]),
  contacts: z.array(z.object({name: text, phone: z.string().max(80), type: text.default('')})).max(50).default([]),
  meetingPoints: z.object({primary: text.default(''), secondary: text.default('')}).default({primary:'',secondary:''}),
});
export const stateSchema = z.object({ inventory: z.array(itemSchema).max(2000), shoppingList: z.array(itemSchema).max(2000), appliances: z.array(applianceSchema).max(200), plan: planSchema.nullable(), settings: settingsSchema.default(() => settingsSchema.parse({})) });
export const backupSchema = z.object({ inventory: z.array(itemSchema).max(2000), shoppingList: z.array(itemSchema).max(2000), appliances: z.array(applianceSchema).max(200), plan: planSchema.nullable().default(null), settings: settingsInputSchema.optional() });
export const emptyState = () => ({inventory:[], shoppingList:[], appliances:[], plan:null, settings:settingsSchema.parse({})});
export const collectionKey = {inventory:'inventory', shopping_list:'shoppingList', appliances:'appliances'};

export function normalizeBackup(input, makeId) {
  if (Array.isArray(input)) input = {inventory:input};
  if (!input || typeof input !== 'object') throw new Error('Expected a backup object.');
  const result = {};
  for (const key of ['inventory','shoppingList','appliances']) {
    const rows = input[key] ?? [];
    if (!Array.isArray(rows)) throw new Error(`${key} must be an array.`);
    result[key] = rows.map(row => ({...row, id: row.id || makeId()}));
    if (new Set(result[key].map(row => row.id)).size !== rows.length) throw new Error('Duplicate IDs in backup.');
  }
  result.plan = input.plan ?? null;
  result.settings = input.settings === undefined ? undefined : settingsInputSchema.parse(input.settings);
  return backupSchema.parse(result);
}

export function applyAction(state, action) {
  const next = structuredClone(state);
  if (action.type === 'import') {
    const backup = backupSchema.parse(action.backup);
    for (const key of ['inventory','shoppingList','appliances']) {
      const merged = new Map(next[key].map(row => [row.id,row]));
      backup[key].forEach(row => merged.set(row.id,row));
      next[key] = [...merged.values()];
    }
    if (backup.plan !== null) next.plan = backup.plan;
    if (backup.settings) next.settings = settingsSchema.parse({...next.settings, ...backup.settings});
  } else if (action.type === 'plan') next.plan = planSchema.parse(action.plan);
  else if (action.type === 'settings') next.settings = settingsSchema.parse({...next.settings, ...action.settings});
  else if (action.type === 'buy') {
    const id = idSchema.parse(action.id);
    const item = next.shoppingList.find(row => row.id === id);
    if (!item) return next; // Idempotent retry or another device already bought it.
    if (next.inventory.some(row => row.id === id)) throw new Error('An inventory item already uses this ID.');
    next.inventory.push(item);
    next.shoppingList = next.shoppingList.filter(row => row.id !== id);
  } else {
    if (action.type === 'bulk_delete') {
      if (!Object.hasOwn(collectionKey, action.collection) || !Array.isArray(action.ids) || action.ids.length > 2000) throw new Error('Invalid bulk delete.');
      const key = collectionKey[action.collection];
      const ids = new Set(action.ids.map(idSchema.parse));
      next[key] = next[key].filter(row => !ids.has(row.id));
      return stateSchema.parse(next);
    }
    if (!Object.hasOwn(collectionKey, action.collection)) throw new Error('Unknown collection.');
    const key = collectionKey[action.collection];
    const id = idSchema.parse(action.id);
    const index = next[key].findIndex(row => row.id === id);
    if (action.type === 'delete') next[key] = next[key].filter(row => row.id !== id);
    else if (action.type === 'add' || action.type === 'update') {
      if (action.type === 'update' && index < 0) throw new Error('Item no longer exists. Refresh and retry.');
      if (action.type === 'add' && index >= 0) throw new Error('Item already exists.');
      const schema = key === 'appliances' ? applianceSchema : itemSchema;
      const value = schema.parse({...next[key][index], ...action.item, id});
      if (index < 0) next[key].push(value); else next[key][index] = value;
    } else throw new Error('Unknown action.');
  }
  return stateSchema.parse(next);
}

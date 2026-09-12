import { z } from 'zod';
const text = z.string().max(500);
const number = z.coerce.number().finite().nonnegative().max(1e9).default(0);
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/);
const date = z.union([z.literal(''), z.iso.date()]).default('');
export const fuelTypes = ['', 'Propane', 'Gasoline', 'Diesel', 'Wood', 'Kerosene', 'Battery', 'Other'];
export const itemSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(200), quantity: number,
  unit: z.string().max(80).default('units'),
  category: z.enum(['Food', 'Water', 'Medical', 'Gear', 'Fuel', 'Power']).default('Gear'),
  caloriesPerUnit: number, hoursPerUnit: number, capacityPerUnit: number, price: number,
  gallonsPerUnit: number, target: number, store: text.default(''), emoji: z.string().max(30).default(''),
  image: z.string().max(180000).regex(/^(?:|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/).default(''),
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
const fraction = z.coerce.number().finite().min(0).max(1);
export const settingsSchema = z.object({
  householdSize: z.coerce.number().int().min(1).max(50).default(4),
  caloriesPerPersonPerDay: z.coerce.number().finite().min(0).max(10000).default(2000),
  waterGallonsPerPersonPerDay: z.coerce.number().finite().min(0).max(20).default(1),
  survivalGoalDays: z.coerce.number().int().min(1).max(365).default(14),
  heatGoalHours: z.coerce.number().finite().min(0).max(10000).default(36),
  powerGoalKwh: z.coerce.number().finite().min(0).max(10000).default(20),
  batteryUsableFraction: fraction.default(0.9),
  inverterEfficiency: fraction.default(0.9),
});
export const stateSchema = z.object({ inventory: z.array(itemSchema).max(2000), shoppingList: z.array(itemSchema).max(2000), appliances: z.array(applianceSchema).max(200), plan: planSchema.nullable(), settings: settingsSchema.default(() => settingsSchema.parse({})) });
export const emptyState = () => ({inventory:[], shoppingList:[], appliances:[], plan:null, settings: settingsSchema.parse({})});
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
  return stateSchema.parse(result);
}
export function applyAction(state, action) {
  const next = structuredClone(state);
  if (action.type === 'import') {
    const backup = stateSchema.parse(action.backup);
    for (const key of ['inventory','shoppingList','appliances']) {
      const merged = new Map(next[key].map(row => [row.id,row]));
      backup[key].forEach(row => merged.set(row.id,row));
      next[key] = [...merged.values()];
    }
    if (backup.plan !== null) next.plan = backup.plan;
  } else if (action.type === 'plan') next.plan = planSchema.parse(action.plan);
  else if (action.type === 'settings') next.settings = settingsSchema.parse(action.settings);
  else if (action.type === 'buy') {
    const id = idSchema.parse(action.id);
    const item = next.shoppingList.find(row => row.id === id);
    if (!item) return next; // Idempotent retry or another device already bought it.
    if (next.inventory.some(row => row.id === id)) throw new Error('An inventory item already uses this ID.');
    next.inventory.push(item);
    next.shoppingList = next.shoppingList.filter(row => row.id !== id);
  } else {
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

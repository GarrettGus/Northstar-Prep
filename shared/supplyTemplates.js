// Fixed catalog of starter supply templates, in the same shape as the seasonal checklist catalog
// in shared/checklists.js: not user-editable, and applied by generating ordinary inventory rows
// rather than by storing a reference to the template.
//
// Quantities here are starting points for a household to adjust, not recommendations to follow
// exactly. Each item says how it scales:
//   perPersonPerDay - multiplied by household size and by the survival goal (water, calories)
//   perPerson       - multiplied by household size only (a respirator, a sleeping bag)
//   fixed           - one per household however large (a radio, a fire extinguisher)
export const supplyTemplateCatalog = [
  {
    id: 'water-and-food', label: 'Water & Food Basics',
    description: 'The two pillars readiness is measured in, sized to your household and goal.',
    items: [
      {id: 'drinking-water', name: 'Drinking water', category: 'Water', unit: 'gal', scale: 'perPersonPerDay', quantity: 1, gallonsPerUnit: 1},
      {id: 'rice', name: 'Rice (dry)', category: 'Food', unit: 'lb', scale: 'perPersonPerDay', quantity: 0.15, caloriesPerUnit: 1600},
      {id: 'beans', name: 'Dried beans', category: 'Food', unit: 'lb', scale: 'perPersonPerDay', quantity: 0.1, caloriesPerUnit: 1500},
      {id: 'canned-protein', name: 'Canned protein', category: 'Food', unit: 'cans', scale: 'perPersonPerDay', quantity: 0.5, caloriesPerUnit: 180},
      {id: 'peanut-butter', name: 'Peanut butter', category: 'Food', unit: 'jars', scale: 'perPerson', quantity: 1, caloriesPerUnit: 3000},
      {id: 'energy-bars', name: 'Energy bars', category: 'Food', unit: 'bars', scale: 'perPersonPerDay', quantity: 1, caloriesPerUnit: 250},
    ],
  },
  {
    id: 'first-aid', label: 'First Aid & Medical',
    description: 'A baseline kit. Add your household’s own prescriptions and dosages on top of it.',
    items: [
      {id: 'first-aid-kit', name: 'First aid kit', category: 'Medical', unit: 'kits', scale: 'fixed', quantity: 1},
      {id: 'bandages', name: 'Assorted bandages', category: 'Medical', unit: 'boxes', scale: 'fixed', quantity: 2},
      {id: 'antiseptic', name: 'Antiseptic wipes', category: 'Medical', unit: 'packs', scale: 'fixed', quantity: 2},
      {id: 'pain-reliever', name: 'Pain reliever', category: 'Medical', unit: 'bottles', scale: 'fixed', quantity: 1},
      {id: 'n95', name: 'N95 respirators', category: 'Medical', unit: 'masks', scale: 'perPerson', quantity: 2},
    ],
  },
  {
    id: 'light-and-power', label: 'Light & Power',
    description: 'Enough to get through a night without mains power.',
    items: [
      {id: 'flashlight', name: 'Flashlight', category: 'Gear', unit: 'units', scale: 'perPerson', quantity: 1},
      {id: 'aa-batteries', name: 'AA batteries', category: 'Gear', unit: 'batteries', scale: 'perPerson', quantity: 8},
      {id: 'power-bank', name: 'USB power bank', category: 'Power', unit: 'units', scale: 'fixed', quantity: 1, capacityPerUnit: 0.1},
      {id: 'weather-radio', name: 'Hand-crank weather radio', category: 'Gear', unit: 'units', scale: 'fixed', quantity: 1},
      {id: 'candles', name: 'Emergency candles', category: 'Gear', unit: 'candles', scale: 'fixed', quantity: 6},
    ],
  },
  {
    id: 'heat-and-cooking', label: 'Heat & Cooking',
    description: 'A way to stay warm and cook without utilities. Never burn fuel indoors unvented.',
    items: [
      {id: 'propane', name: 'Propane canisters', category: 'Fuel', unit: 'canisters', scale: 'fixed', quantity: 4, hoursPerUnit: 4, fuelType: 'Propane'},
      {id: 'camp-stove', name: 'Camp stove', category: 'Gear', unit: 'units', scale: 'fixed', quantity: 1},
      {id: 'matches', name: 'Waterproof matches', category: 'Gear', unit: 'boxes', scale: 'fixed', quantity: 2},
      {id: 'wool-blanket', name: 'Wool blanket', category: 'Gear', unit: 'blankets', scale: 'perPerson', quantity: 1},
      {id: 'hand-warmers', name: 'Hand warmers', category: 'Gear', unit: 'pairs', scale: 'perPerson', quantity: 4},
    ],
  },
  {
    id: 'sanitation', label: 'Sanitation & Hygiene',
    description: 'The category households forget until the water stops running.',
    items: [
      {id: 'toilet-paper', name: 'Toilet paper', category: 'Gear', unit: 'rolls', scale: 'perPerson', quantity: 4},
      {id: 'garbage-bags', name: 'Heavy-duty garbage bags', category: 'Gear', unit: 'bags', scale: 'fixed', quantity: 20},
      {id: 'bleach', name: 'Unscented bleach', category: 'Gear', unit: 'bottles', scale: 'fixed', quantity: 1},
      {id: 'hand-sanitizer', name: 'Hand sanitizer', category: 'Gear', unit: 'bottles', scale: 'perPerson', quantity: 1},
      {id: 'soap', name: 'Bar soap', category: 'Gear', unit: 'bars', scale: 'perPerson', quantity: 2},
    ],
  },
];

export const templateScales = ['perPersonPerDay', 'perPerson', 'fixed'];

// Quantities are rounded up: half a can of food is not a useful shopping target, and rounding
// down would quietly under-stock every line. A template line never scales below 1.
export function scaleTemplateQuantity(item, settings) {
  const size = Math.max(1, Number(settings.householdSize) || 1);
  const days = Math.max(1, Number(settings.survivalGoalDays) || 1);
  const base = Number(item.quantity) || 0;
  if (item.scale === 'perPersonPerDay') return Math.max(1, Math.ceil(base * size * days));
  if (item.scale === 'perPerson') return Math.max(1, Math.ceil(base * size));
  return Math.max(1, Math.ceil(base));
}

export function findSupplyTemplate(id) {
  return supplyTemplateCatalog.find(template => template.id === id) ?? null;
}

// Builds the inventory rows a template would add, as a backup-shaped object so it can go through
// the same non-destructive import preview and merge-by-ID path as a JSON backup. IDs are derived
// from the template and item IDs, so applying the same template twice updates those rows in place
// rather than piling up duplicates.
export function templateToBackup(template, settings) {
  return {
    inventory: template.items.map(item => ({
      id: `template-${template.id}-${item.id}`,
      name: item.name,
      category: item.category,
      unit: item.unit ?? 'units',
      quantity: scaleTemplateQuantity(item, settings),
      // The scaled quantity is also the restock target, so a template-seeded item reads as fully
      // stocked rather than immediately showing up as low stock.
      target: scaleTemplateQuantity(item, settings),
      caloriesPerUnit: item.caloriesPerUnit ?? 0,
      hoursPerUnit: item.hoursPerUnit ?? 0,
      capacityPerUnit: item.capacityPerUnit ?? 0,
      gallonsPerUnit: item.gallonsPerUnit ?? 0,
      fuelType: item.fuelType ?? '',
    })),
    shoppingList: [],
    appliances: [],
    reminders: [],
    checklistChecks: [],
    plan: null,
  };
}

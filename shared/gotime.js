// "Go time": turning the plan into an action list at the moment something happens. Everything
// here is derived from household state already on the device, so it works offline; the only
// server-side part is the shared activation and check-ins (api/go.js).
import { itemsInKit, kitCompleteness } from './kits.js';

export const activationModes = ['evacuate', 'shelter'];
export const activationModeLabels = {evacuate: 'Evacuate', shelter: 'Shelter in place'};

export const checkinStatuses = ['safe_home', 'safe_meeting_point', 'safe_elsewhere', 'need_help'];
export const checkinStatusLabels = {
  safe_home: 'Safe at home',
  safe_meeting_point: 'At the meeting point',
  safe_elsewhere: 'Safe elsewhere',
  need_help: 'Need help',
};

const normalizeName = value => String(value || '').trim().toLowerCase();

// Things nobody puts in an inventory but everybody needs on the way out the door.
const essentials = [
  {key: 'phones', label: 'Phones and chargers'},
  {key: 'id-cash', label: 'Wallets, ID and cash'},
  {key: 'keys', label: 'House and car keys'},
  {key: 'documents', label: 'Copies of important documents (ID, insurance, medical)'},
  {key: 'glasses', label: 'Glasses, contacts, hearing aids'},
];
const petEssentials = [
  {key: 'pet-food', label: 'Pet food and water'},
  {key: 'pet-carrier', label: 'Leashes and carriers'},
  {key: 'pet-records', label: 'Vaccination records and a recent photo of each pet'},
];

const itemDetail = item => [`${Number(item.quantity) || 0} ${item.unit || 'units'}`, item.location].filter(Boolean).join(' · ');

// The evacuation grab list, in sections: each kit (what is assigned to it, plus any target-list
// row still missing), then medications, then pets, then the always-forgotten essentials. Row IDs
// are stable so a device can remember what has already been checked off.
export function grabList({kits = [], inventory = [], medications = [], family = []} = {}) {
  const sections = [];
  for (const kit of kits) {
    const assigned = itemsInKit(kit, inventory);
    const {contents} = kitCompleteness(kit, inventory);
    const missing = contents.filter(row => !row.met);
    const locations = [...new Set(assigned.map(item => item.location).filter(Boolean))];
    sections.push({
      key: `kit:${kit.id}`,
      title: kit.assignedTo ? `${kit.name} (${kit.assignedTo})` : kit.name,
      subtitle: locations.length ? `Kept in: ${locations.join(', ')}` : '',
      rows: [
        ...assigned.map(item => ({id: `kit:${kit.id}:${item.id}`, label: item.name, detail: itemDetail(item)})),
        ...missing.map(row => ({id: `kit:${kit.id}:missing:${normalizeName(row.name)}`, label: row.name, detail: `Not packed: need ${row.quantity} ${row.unit}, have ${row.actualQuantity}`, missing: true})),
      ],
    });
  }
  // No kits yet: fall back to the supplies most worth grabbing, grouped by where they're kept.
  if (!kits.length) {
    const grabbable = inventory.filter(item => ['Water', 'Medical'].includes(item.category)).slice(0, 30);
    if (grabbable.length) {
      sections.push({
        key: 'supplies',
        title: 'Water and medical supplies',
        subtitle: 'No kits set up yet. Create a go-bag under Supplies → Kits so this list is ready next time.',
        rows: grabbable.map(item => ({id: `item:${item.id}`, label: item.name, detail: itemDetail(item)})),
      });
    }
  }
  if (medications.length) {
    sections.push({
      key: 'medications', title: 'Medications', subtitle: '',
      rows: medications.map(med => ({id: `med:${med.id}`, label: [med.name, med.dose].filter(Boolean).join(' '), detail: [med.person, `${Number(med.quantityOnHand) || 0} on hand`].filter(Boolean).join(' · ')})),
    });
  }
  const pets = family.filter(member => member.kind === 'pet');
  if (pets.length) {
    sections.push({
      key: 'pets', title: pets.length === 1 ? `Pet: ${pets[0].name || 'unnamed'}` : `Pets (${pets.length})`, subtitle: '',
      rows: petEssentials.map(row => ({id: `pet:${row.key}`, label: row.label, detail: ''})),
    });
  }
  sections.push({key: 'essentials', title: 'Essentials', subtitle: '', rows: essentials.map(row => ({id: `essential:${row.key}`, label: row.label, detail: ''}))});
  return sections;
}

export const lastOutSteps = {
  evacuate: [
    'Shut off gas only if you smell gas or officials tell you to (it takes a utility to turn it back on)',
    'Unplug electronics; switch off the main breaker if flooding is expected',
    'Close and lock windows and doors',
    'Leave a note on the fridge saying where you went and when',
    'Take your planned route; never drive through flood water',
  ],
  shelter: [
    'Bring everyone, including pets, inside and to the shelter spot when warned',
    'Fill bathtubs and spare containers with water while the taps still run',
    'Charge phones and power banks now',
    'Turn the fridge and freezer to their coldest setting and keep them closed',
    'Keep a battery or crank radio on for updates',
  ],
};

// Per person: whether anyone has assigned them a kit, and how complete the best one is. Pets are
// listed only when a kit names them; people always are, since every person needs a go-bag.
export function goBagCoverage(family = [], kits = [], inventory = []) {
  return family
    .filter(member => member.name && member.name.trim())
    .map(member => {
      const theirs = kits.filter(kit => normalizeName(kit.assignedTo) === normalizeName(member.name));
      const best = theirs.reduce((top, kit) => Math.max(top, kitCompleteness(kit, inventory).percent), 0);
      const status = !theirs.length ? 'none' : best >= 100 ? 'packed' : 'partial';
      return {name: member.name, kind: member.kind || 'person', kits: theirs.map(kit => kit.name), percent: best, status};
    })
    .filter(row => row.kind !== 'pet' || row.kits.length);
}

// Shelter in place: what to switch off and how much water and food each day can use so stores
// last the household's survival goal. Takes an outage simulation (shared/outage.js) and readiness
// stats (shared/readiness.js) rather than recomputing either.
export function shelterGuidance(simulation, stats, settings) {
  const days = Math.max(1, Number(settings.survivalGoalDays) || 1);
  const waterPerDay = simulation.resources.waterGallons / days;
  const caloriesPerDay = (Number(stats.totalCalories) || 0) / days;
  return {
    days,
    shedNow: simulation.shedding.shed.map(appliance => appliance.name),
    shedsCritical: simulation.shedding.shedsCritical,
    water: {perDay: waterPerDay, need: stats.dailyWaterNeed, short: waterPerDay < stats.dailyWaterNeed},
    food: {perDay: caloriesPerDay, need: stats.dailyCalorieNeed, short: caloriesPerDay < stats.dailyCalorieNeed},
    firstExhausted: simulation.firstExhausted,
    survives: simulation.survives,
  };
}

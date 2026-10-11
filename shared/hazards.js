// Fixed catalog of hazards a household can say it faces. Choosing hazards in the Family Hub adds
// that hazard's checklist alongside the seasonal ones (shared/checklists.js) and its supply
// template alongside the starter templates (shared/supplyTemplates.js), so the advice a household
// sees matches where it lives instead of assuming one climate.
//
// Checklist progress uses the same `${season}__${itemId}` rows as the seasonal checklists, with
// the season key `hazard-<id>`, so it reuses the existing checklist collection, backups and binder.
export const hazardCatalog = [
  {
    id: 'hurricane', label: 'Hurricane', readyUrl: 'https://www.ready.gov/hurricanes',
    checklist: [
      {id: 'know-zone', text: 'Look up your evacuation zone and the route out of it'},
      {id: 'shutters', text: 'Have storm shutters or pre-cut plywood ready for windows'},
      {id: 'secure-yard', text: 'Plan where outdoor furniture and bins go before a storm'},
      {id: 'photo-inventory', text: 'Photograph the home and belongings for insurance'},
      {id: 'fuel-generator', text: 'Store generator fuel safely and test-run the generator'},
    ],
    supplies: [
      {id: 'plywood', name: 'Plywood window covers', category: 'Gear', unit: 'sheets', scale: 'fixed', quantity: 6},
      {id: 'tarp', name: 'Heavy-duty tarp', category: 'Gear', unit: 'tarps', scale: 'fixed', quantity: 2},
      {id: 'dry-bags', name: 'Waterproof document bags', category: 'Gear', unit: 'bags', scale: 'fixed', quantity: 2},
    ],
  },
  {
    id: 'flood', label: 'Flood', readyUrl: 'https://www.ready.gov/floods',
    checklist: [
      {id: 'flood-insurance', text: 'Check whether your policy covers flooding (most home policies do not)'},
      {id: 'raise-utilities', text: 'Know how to switch off electricity at the main panel'},
      {id: 'high-ground', text: 'Pick a route to high ground that avoids low crossings'},
      {id: 'elevate-valuables', text: 'Move valuables and documents off basement floors'},
      {id: 'sump-backup', text: 'Give the sump pump a battery backup'},
    ],
    supplies: [
      {id: 'sandbags', name: 'Sandbags', category: 'Gear', unit: 'bags', scale: 'fixed', quantity: 20},
      {id: 'waders', name: 'Rubber boots or waders', category: 'Gear', unit: 'pairs', scale: 'perPerson', quantity: 1},
      {id: 'dry-bags', name: 'Waterproof document bags', category: 'Gear', unit: 'bags', scale: 'fixed', quantity: 2},
    ],
  },
  {
    id: 'wildfire', label: 'Wildfire', readyUrl: 'https://www.ready.gov/wildfires',
    checklist: [
      {id: 'defensible-space', text: 'Clear 5 ft of non-flammable space around the house'},
      {id: 'go-bag-ready', text: 'Keep go-bags packed through fire season, not just when smoke appears'},
      {id: 'air-filter', text: 'Set up a clean-air room with a HEPA purifier or MERV-13 filter'},
      {id: 'two-routes', text: 'Know two ways out of the neighborhood'},
      {id: 'alerts-signup', text: 'Sign up for your county\'s emergency alerts'},
    ],
    supplies: [
      {id: 'n95-fire', name: 'N95 respirators (smoke)', category: 'Medical', unit: 'masks', scale: 'perPerson', quantity: 10},
      {id: 'hepa-filter', name: 'Spare HEPA/MERV-13 filter', category: 'Gear', unit: 'filters', scale: 'fixed', quantity: 2},
      {id: 'hose', name: 'Garden hose long enough to reach around the house', category: 'Gear', unit: 'units', scale: 'fixed', quantity: 1},
    ],
  },
  {
    id: 'earthquake', label: 'Earthquake', readyUrl: 'https://www.ready.gov/earthquakes',
    checklist: [
      {id: 'strap-heater', text: 'Strap the water heater and tall furniture to the wall'},
      {id: 'gas-wrench', text: 'Keep a wrench by the gas meter and know how to shut it off'},
      {id: 'drop-cover', text: 'Practise drop, cover and hold on with everyone'},
      {id: 'under-bed', text: 'Keep shoes and a flashlight under each bed'},
      {id: 'heavy-items-low', text: 'Move heavy items to low shelves'},
    ],
    supplies: [
      {id: 'gas-wrench', name: 'Gas shut-off wrench', category: 'Gear', unit: 'units', scale: 'fixed', quantity: 1},
      {id: 'work-gloves', name: 'Work gloves', category: 'Gear', unit: 'pairs', scale: 'perPerson', quantity: 1},
      {id: 'whistle', name: 'Emergency whistle', category: 'Gear', unit: 'units', scale: 'perPerson', quantity: 1},
    ],
  },
  {
    id: 'winter-storm', label: 'Winter storm', readyUrl: 'https://www.ready.gov/winter-weather',
    checklist: [
      {id: 'drip-faucets', text: 'Know which faucets to drip and where the main water shut-off is'},
      {id: 'co-detectors', text: 'Test carbon monoxide detectors before running any backup heat'},
      {id: 'one-warm-room', text: 'Pick one room to heat if the power goes out'},
      {id: 'car-kit', text: 'Keep a blanket, scraper and snacks in each car'},
    ],
    supplies: [
      {id: 'sleeping-bag', name: 'Cold-rated sleeping bag', category: 'Gear', unit: 'bags', scale: 'perPerson', quantity: 1},
      {id: 'ice-melt', name: 'Ice melt', category: 'Gear', unit: 'bags', scale: 'fixed', quantity: 2},
      {id: 'co-detector', name: 'Battery CO detector', category: 'Gear', unit: 'units', scale: 'fixed', quantity: 1},
    ],
  },
  {
    id: 'tornado', label: 'Tornado', readyUrl: 'https://www.ready.gov/tornadoes',
    checklist: [
      {id: 'safe-room', text: 'Pick the lowest, most interior room as the shelter spot'},
      {id: 'helmets', text: 'Keep helmets or pillows in the shelter spot'},
      {id: 'weather-radio-alerts', text: 'Set the weather radio to alert for your county'},
      {id: 'tornado-drill', text: 'Run a drill: everyone in the shelter spot within 2 minutes'},
    ],
    supplies: [
      {id: 'helmet', name: 'Helmet', category: 'Gear', unit: 'units', scale: 'perPerson', quantity: 1},
      {id: 'sturdy-shoes', name: 'Sturdy shoes kept in the shelter spot', category: 'Gear', unit: 'pairs', scale: 'perPerson', quantity: 1},
    ],
  },
  {
    id: 'extreme-heat', label: 'Extreme heat', readyUrl: 'https://www.ready.gov/heat',
    checklist: [
      {id: 'cooling-center', text: 'Find the nearest cooling center and its hours'},
      {id: 'check-on', text: 'Agree who checks on elderly neighbors and relatives'},
      {id: 'heat-signs', text: 'Learn the signs of heat exhaustion and heat stroke'},
      {id: 'blackout-curtains', text: 'Hang reflective or blackout curtains on sun-facing windows'},
    ],
    supplies: [
      {id: 'electrolytes', name: 'Electrolyte packets', category: 'Medical', unit: 'packets', scale: 'perPersonPerDay', quantity: 1},
      {id: 'battery-fan', name: 'Battery-powered fan', category: 'Gear', unit: 'units', scale: 'perPerson', quantity: 1},
    ],
  },
];

export const hazardIds = hazardCatalog.map(hazard => hazard.id);

export function selectedHazards(plan) {
  const chosen = new Set(plan?.hazards || []);
  return hazardCatalog.filter(hazard => chosen.has(hazard.id));
}

// Checklists in the same shape as checklistCatalog, so they render and print the same way.
export function hazardChecklists(plan) {
  return selectedHazards(plan).map(hazard => ({season: `hazard-${hazard.id}`, label: `${hazard.label} Readiness`, items: hazard.checklist}));
}

// Supply templates in the same shape as supplyTemplateCatalog.
export function hazardSupplyTemplates(plan) {
  return selectedHazards(plan).map(hazard => ({
    id: `hazard-${hazard.id}`, label: `${hazard.label} Supplies`,
    description: `Extra supplies for ${hazard.label.toLowerCase()} on top of the basics.`,
    items: hazard.supplies,
  }));
}

// Coordinates are kept to two decimal places (about 1 km): enough to look up weather alerts and
// the local forecast office, without the plan storing the household's exact address.
export function roundCoordinate(value) {
  return Math.round(Number(value) * 100) / 100;
}

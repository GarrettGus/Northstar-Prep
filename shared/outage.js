import { householdNeeds, isExpired, waterGallons } from './readiness.js';

// Appliances are shed from the bottom of this list upwards: 'low' loads go first, 'critical'
// ones last. 'normal' is the default so an existing appliance keeps a sensible place in the
// order without anyone having to revisit it.
export const appliancePriorities = ['critical', 'high', 'normal', 'low'];
export const appliancePriorityLabels = {critical: 'Critical', high: 'High', normal: 'Normal', low: 'Low'};
const shedOrder = [...appliancePriorities].reverse();

export function applianceDailyKwh(appliance) {
  return ((Number(appliance.watts) || 0) * (Number(appliance.hours) || 0)) / 1000;
}

// Available stored resources at the moment the power goes out. Expired water and food are
// excluded here exactly as computeReadiness excludes them; fuel is counted whatever its date
// because a propane tank does not spoil.
export function outageResources({inventory = [], appliances = [], plan = null}, settings) {
  let waterAvailable = 0, storedPowerKwh = 0, fuelHours = 0;
  for (const item of inventory) {
    const notExpired = !isExpired(item.expiryDate);
    if (item.category === 'Water' && notExpired) waterAvailable += waterGallons(item);
    if (item.category === 'Power') storedPowerKwh += (Number(item.quantity) || 0) * (Number(item.capacityPerUnit) || 0);
    if (item.category === 'Fuel') fuelHours += (Number(item.quantity) || 0) * (Number(item.hoursPerUnit) || 0);
  }
  const {dailyWaterNeed} = householdNeeds(plan, settings);
  const activeAppliances = appliances.filter(appliance => appliance.active !== false);
  return {
    // Usable rather than nameplate capacity: battery depth-of-discharge and inverter loss both
    // apply during an outage, the same derating computeReadiness reports on the Dashboard.
    powerKwh: storedPowerKwh * settings.batteryUsableFraction * settings.inverterEfficiency,
    dailyLoadKwh: activeAppliances.reduce((total, appliance) => total + applianceDailyKwh(appliance), 0),
    waterGallons: waterAvailable,
    dailyWaterNeed,
    // A fuel item's hoursPerUnit is already "hours of heat", so heating consumes one hour of
    // fuel per hour of outage. Nothing here models running a generator off the same fuel.
    fuelHours,
  };
}

// Hours a resource lasts at a constant draw. A resource nothing consumes never runs out, which
// is reported as null rather than a number so callers do not render "Infinity hours".
function runwayHours(available, perDay) {
  if (!(perDay > 0)) return null;
  return (available / perDay) * 24;
}

function remaining(available, perDay, atHour) {
  return Math.max(0, available - (perDay > 0 ? perDay * (atHour / 24) : 0));
}

// Shed the least essential loads first, and within one priority tier the hungriest load first,
// until what is left runs for targetHours. An empty `shed` list means the goal is already met.
//
// There is deliberately no "impossible" outcome: shedding every load always reaches the target,
// because nothing is then drawing the battery down. The warning worth surfacing is not that the
// goal is unreachable but what reaching it costs -- `shedsCritical` is true when the household
// cannot last the outage without turning off loads it marked critical.
function planLoadShedding(appliances, powerKwh, targetHours) {
  const active = appliances.filter(appliance => appliance.active !== false);
  const candidates = [...active].sort((a, b) => {
    const tier = shedOrder.indexOf(a.priority || 'normal') - shedOrder.indexOf(b.priority || 'normal');
    return tier !== 0 ? tier : applianceDailyKwh(b) - applianceDailyKwh(a);
  });
  const meets = load => {
    const hours = runwayHours(powerKwh, load);
    return hours === null || hours >= targetHours;
  };
  let load = active.reduce((total, appliance) => total + applianceDailyKwh(appliance), 0);
  const shed = [];
  for (const appliance of candidates) {
    if (meets(load)) break;
    shed.push(appliance);
    load -= applianceDailyKwh(appliance);
  }
  return {
    shed,
    remainingDailyLoadKwh: Math.max(0, load),
    shedsCritical: shed.some(appliance => (appliance.priority || 'normal') === 'critical'),
  };
}

// Draws stored power, fuel and water down over an outage of a given length and reports what runs
// out, when, and which loads to shed to last the whole way. Consumption is constant, so the
// timeline is a set of sample points rather than an iterative simulation; the sample interval
// keeps the table readable for a two-day outage and a two-week one alike.
export function simulateOutage(state, settings, {hours = settings.survivalGoalDays * 24, samples = 8} = {}) {
  const duration = Math.max(1, Number(hours) || 0);
  const resources = outageResources(state, settings);
  const tracked = [
    {key: 'power', label: 'Stored power', unit: 'kWh', available: resources.powerKwh, perDay: resources.dailyLoadKwh},
    {key: 'fuel', label: 'Heating fuel', unit: 'h', available: resources.fuelHours, perDay: 24},
    {key: 'water', label: 'Water', unit: 'gal', available: resources.waterGallons, perDay: resources.dailyWaterNeed},
  ];

  const step = duration / Math.max(1, samples);
  const timeline = [];
  for (let index = 0; index <= samples; index++) {
    const atHour = Math.min(duration, index * step);
    timeline.push({
      hour: atHour,
      day: atHour / 24,
      ...Object.fromEntries(tracked.map(resource => [resource.key, remaining(resource.available, resource.perDay, atHour)])),
    });
  }

  const exhausted = tracked
    .map(resource => ({
      key: resource.key, label: resource.label, unit: resource.unit,
      available: resource.available, perDay: resource.perDay,
      runwayHours: runwayHours(resource.available, resource.perDay),
    }))
    .filter(resource => resource.runwayHours !== null)
    .sort((a, b) => a.runwayHours - b.runwayHours);
  const within = exhausted.filter(resource => resource.runwayHours < duration);

  const shedding = planLoadShedding(state.appliances ?? [], resources.powerKwh, duration);
  return {
    hours: duration,
    resources,
    timeline,
    runways: exhausted,
    // What gives out first, and whether it gives out before the outage is over.
    firstExhausted: within[0] ?? null,
    survives: within.length === 0,
    shedding,
  };
}

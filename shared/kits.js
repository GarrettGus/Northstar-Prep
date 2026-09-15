// Per-kit readiness: how much of a kit's target contents list is actually packed, based on the
// inventory items assigned to it (item.kitId === kit.id). Matching is by item name (trimmed,
// case-insensitive) rather than item id, since the target list describes generic supplies
// ("first aid kit", "flashlight") rather than specific inventory rows.
const normalizeName = value => String(value || '').trim().toLowerCase();

export function itemsInKit(kit, inventory = []) {
  return inventory.filter(item => item.kitId === kit.id);
}

// For each target row, sums the quantity of assigned items whose name matches it and reports
// whether that meets the target quantity. A kit with no target contents is only ever fully
// "packed" once at least one item is assigned to it (100% with no targets to fall short of), so
// a fresh kit with an empty list still needs at least one item before it registers as ready.
export function kitCompleteness(kit, inventory = []) {
  const assigned = itemsInKit(kit, inventory);
  const contents = (kit.targetContents || []).map(target => {
    const actualQuantity = assigned
      .filter(item => normalizeName(item.name) === normalizeName(target.name))
      .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    return {...target, actualQuantity, met: actualQuantity >= target.quantity};
  });
  const metCount = contents.filter(row => row.met).length;
  const totalCount = contents.length;
  const percent = totalCount > 0 ? Math.round((metCount / totalCount) * 100) : (assigned.length > 0 ? 100 : 0);
  return {assignedCount: assigned.length, contents, metCount, totalCount, percent};
}

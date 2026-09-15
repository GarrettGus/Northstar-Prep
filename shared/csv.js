// CSV import/export for inventory and shopping list rows, alongside the existing JSON backup
// path. Import validates each row through the same itemSchema JSON backups use and reports
// per-row errors instead of failing the whole file, then hands the surviving rows to
// normalizeBackup so they go through the existing merge-by-ID import action unchanged.
import { itemSchema, normalizeBackup } from './schema.js';

export const csvColumns = [
  'collection', 'id', 'name', 'quantity', 'unit', 'category', 'store', 'location', 'barcode',
  'purchaseDate', 'expiryDate', 'recurringDays', 'caloriesPerUnit', 'hoursPerUnit',
  'capacityPerUnit', 'gallonsPerUnit', 'price', 'target', 'macroTag', 'fuelType', 'emoji',
];

// Same per-collection row cap the JSON backup schema enforces (see shared/schema.js).
export const maxCsvRowsPerCollection = 2000;

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Minimal RFC4180 parser: quoted fields, doubled-quote escaping, CRLF/LF rows.
export function parseCsvRows(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += char;
      continue;
    }
    if (char === '"') { inQuotes = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(cells => !(cells.length === 1 && cells[0] === ''));
}

export function backupToCsv(inventory, shoppingList) {
  const lines = [csvColumns];
  for (const [collection, rows] of [['inventory', inventory], ['shopping_list', shoppingList]]) {
    for (const row of rows) lines.push(csvColumns.map(key => key === 'collection' ? collection : row[key]));
  }
  return lines.map(line => line.map(csvEscape).join(',')).join('\r\n');
}

// Returns {inventory, shoppingList, errors}: errors are {row, message} for rows skipped rather
// than raised, so one bad row never fails the whole file. Surviving rows are re-validated (a
// no-op for already-valid rows) through normalizeBackup to reuse the same ID/duplicate handling
// JSON import already has, and to fit the existing {type:'import', backup} action unchanged.
export function csvToBackup(text, makeId) {
  const rows = parseCsvRows(text);
  const errors = [];
  const inventory = [], shoppingList = [];
  if (rows.length === 0) return { inventory, shoppingList, errors };
  const header = rows[0].map(cell => cell.trim());
  for (let i = 1; i < rows.length; i++) {
    const lineNumber = i + 1; // 1-based, header is line 1
    const cells = rows[i];
    const raw = {};
    header.forEach((key, index) => { raw[key] = cells[index]; });
    const collection = (raw.collection || 'inventory').trim().toLowerCase();
    const isShopping = collection === 'shopping_list' || collection === 'shopping' || collection === 'shopping list';
    const target = isShopping ? shoppingList : inventory;
    if (target.length >= maxCsvRowsPerCollection) {
      errors.push({ row: lineNumber, message: `Skipped: ${isShopping ? 'shopping list' : 'inventory'} limit of ${maxCsvRowsPerCollection} rows reached.` });
      continue;
    }
    const candidate = { id: (raw.id || '').trim() || makeId() };
    for (const key of csvColumns) {
      if (key === 'collection' || key === 'id') continue;
      const value = typeof raw[key] === 'string' ? raw[key].trim() : raw[key];
      if (value !== '' && value !== undefined) candidate[key] = value;
    }
    const result = itemSchema.safeParse(candidate);
    if (!result.success) { errors.push({ row: lineNumber, message: result.error.issues[0]?.message || 'Invalid row.' }); continue; }
    target.push(result.data);
  }
  return { inventory, shoppingList, errors };
}

// Wraps csvToBackup with the same normalizeBackup pass JSON imports use, so any leftover
// cross-row problem (e.g. duplicate IDs) still surfaces before anything is previewed.
export function csvToBackupPreview(text, makeId) {
  const { inventory, shoppingList, errors } = csvToBackup(text, makeId);
  const backup = normalizeBackup({ inventory, shoppingList }, makeId);
  return { backup, errors };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { backupToCsv, parseCsvRows, csvToBackup, csvToBackupPreview, maxCsvRowsPerCollection } from '../shared/csv.js';

test('parseCsvRows handles quoted commas, embedded quotes and CRLF/LF lines', () => {
  const rows = parseCsvRows('a,"b, c","d""e"\r\nf,g,h\n');
  assert.deepEqual(rows, [['a', 'b, c', 'd"e'], ['f', 'g', 'h']]);
});

test('backupToCsv/csvToBackup round-trips inventory and shopping list rows', () => {
  const inventory = [{id: 'a1', name: 'Rice, White', quantity: 5, unit: 'lbs', category: 'Food', store: '', location: 'Pantry', barcode: '', purchaseDate: '2026-01-01', expiryDate: '', recurringDays: 0, caloriesPerUnit: 100, hoursPerUnit: 0, capacityPerUnit: 0, gallonsPerUnit: 0, price: 3.5, target: 0, macroTag: 'Carbs', fuelType: '', emoji: ''}];
  const shoppingList = [{id: 's1', name: 'Batteries', quantity: 8, unit: 'units', category: 'Gear', store: '', location: '', barcode: '', purchaseDate: '', expiryDate: '', recurringDays: 0, caloriesPerUnit: 0, hoursPerUnit: 0, capacityPerUnit: 0, gallonsPerUnit: 0, price: 0, target: 0, macroTag: '', fuelType: '', emoji: ''}];
  const csv = backupToCsv(inventory, shoppingList);
  const result = csvToBackup(csv, () => 'generated');
  assert.equal(result.errors.length, 0);
  assert.equal(result.inventory.length, 1);
  assert.equal(result.inventory[0].name, 'Rice, White');
  assert.equal(result.inventory[0].id, 'a1');
  assert.equal(result.shoppingList.length, 1);
  assert.equal(result.shoppingList[0].name, 'Batteries');
});

test('csvToBackup reports a per-row error and keeps validating the rest of the file', () => {
  const csv = 'collection,name,quantity,category\ninventory,,5,Food\ninventory,Batteries,10,NotACategory\nshopping_list,Water,4,Water\n';
  const result = csvToBackup(csv, () => 'generated');
  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].row, 2);
  assert.equal(result.errors[1].row, 3);
  assert.equal(result.inventory.length, 0);
  assert.equal(result.shoppingList.length, 1);
  assert.equal(result.shoppingList[0].name, 'Water');
});

test('csvToBackup defaults blank category/unit rather than rejecting them', () => {
  const csv = 'collection,name,quantity\ninventory,Rice,5\n';
  const result = csvToBackup(csv, () => 'generated');
  assert.equal(result.errors.length, 0);
  assert.equal(result.inventory[0].category, 'Gear');
  assert.equal(result.inventory[0].unit, 'units');
});

test('csvToBackup enforces the same per-collection row limit as the JSON backup schema', () => {
  const rows = ['collection,name,quantity'];
  for (let i = 0; i < maxCsvRowsPerCollection + 5; i++) rows.push(`inventory,Item ${i},1`);
  let counter = 0;
  const result = csvToBackup(rows.join('\n'), () => `generated-${counter++}`);
  assert.equal(result.inventory.length, maxCsvRowsPerCollection);
  assert.equal(result.errors.length, 5);
  assert.match(result.errors[0].message, /limit of \d+ rows reached/);
});

test('csvToBackupPreview produces a backup accepted by the existing import action', () => {
  const csv = 'collection,name,quantity,category\ninventory,Rice,5,Food\nshopping_list,Water,4,Water\n';
  const {backup, errors} = csvToBackupPreview(csv, () => 'generated');
  assert.equal(errors.length, 0);
  assert.equal(backup.inventory.length, 1);
  assert.equal(backup.shoppingList.length, 1);
  assert.equal(backup.appliances.length, 0);
  assert.equal(backup.plan, null);
});

const blankItem = {quantity: 1, unit: 'units', category: 'Gear', store: '', location: '', barcode: '', purchaseDate: '', expiryDate: '', recurringDays: 0, caloriesPerUnit: 0, hoursPerUnit: 0, capacityPerUnit: 0, gallonsPerUnit: 0, price: 0, target: 0, macroTag: '', fuelType: '', emoji: ''};

test('backupToCsv neutralises text cells a spreadsheet would run as a formula, but leaves numbers alone', () => {
  const names = ['=HYPERLINK("http://evil.example","x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1+1', '\r=1+1'];
  const inventory = names.map((name, index) => ({...blankItem, id: `i${index}`, name, store: '=cmd|\' /C calc\'!A0', quantity: 5, price: 0}));
  const csv = backupToCsv(inventory, []);
  const lines = parseCsvRows(csv).slice(1);
  for (const [index, cells] of lines.entries()) {
    assert.equal(cells[2], `'${names[index]}`, `name ${index} is prefixed`);
    assert.equal(cells[6], `'=cmd|' /C calc'!A0`, 'every free-text column is covered, not just the name');
    assert.equal(cells[3], '5', 'a real number is not prefixed');
  }
  // No cell in the file starts with a formula character once parsed.
  for (const cells of parseCsvRows(csv)) for (const cell of cells) assert.doesNotMatch(cell, /^[=+\-@\t\r]/);
});

test('a file the app exported imports back to the original names, and ordinary text is untouched', () => {
  const originals = ['=SUM(1)', '-Spare tire', 'Rice', "'quoted but harmless"];
  const inventory = originals.map((name, index) => ({...blankItem, id: `i${index}`, name}));
  const result = csvToBackup(backupToCsv(inventory, []), () => 'generated');
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.inventory.map(row => row.name), originals);
});

test('a hand-written CSV with an unguarded leading dash keeps its text on import', () => {
  const result = csvToBackup('collection,name,quantity\ninventory,-Spare tire,1\n', () => 'generated');
  assert.equal(result.inventory[0].name, '-Spare tire');
});

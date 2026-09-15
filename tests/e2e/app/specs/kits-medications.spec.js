import { test, expect, addItem, field, selectField, itemRow, openTab, signedInHome } from '../support/app.js';
import { query } from '../support/household.js';

test('a kit can be created, an item assigned to it, and its completeness reflects the assignment', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');

  await page.getByRole('button', {name: 'Add kit'}).click();
  await field(page, 'Name').fill('Go-bag — Dad');
  await field(page, 'Purpose (optional)').fill('Grab-and-go bag for evacuation');
  await page.getByRole('button', {name: 'Add target item'}).click();
  await page.getByPlaceholder('Item name').fill('Flashlight');
  await page.getByRole('button', {name: 'Add Kit'}).click();
  await expect(page.locator('section').getByText('Go-bag — Dad')).toBeVisible();
  await expect(page.getByText('0/1 packed')).toBeVisible();

  await addItem(page, {name: 'Flashlight', quantity: '1', category: 'Gear'});
  await page.getByRole('button', {name: 'Edit Flashlight'}).click();
  await field(page, 'Location (optional)').fill('Basement');
  await selectField(page, 'Kit (optional)').selectOption({label: 'Go-bag — Dad'});
  await page.getByRole('button', {name: 'Save Changes'}).click();

  await expect(page.getByText('1/1 packed')).toBeVisible();
  const [{id: kitId}] = await query(`SELECT id FROM northstar_kits WHERE name = 'Go-bag — Dad'`);
  expect(await query(`SELECT location, kit_id FROM northstar_inventory WHERE name = 'Flashlight'`)).toEqual([{location: 'Basement', kit_id: kitId}]);

  // Filtering the Supply Hub down to just this kit still shows the assigned item.
  await page.getByLabel('Filter by kit').selectOption({label: 'Go-bag — Dad'});
  await expect(itemRow(page, 'Flashlight')).toBeVisible();
  await page.getByLabel('Filter by kit').selectOption({label: 'All kits'});

  await page.getByLabel('Group items by').selectOption({label: 'Group: Location'});
  await expect(page.getByRole('heading', {name: 'Basement'})).toBeVisible();
});

test('medications surface a refill-due banner on the Dashboard and appear in the emergency binder', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Family');

  await page.getByRole('button', {name: 'Add medication'}).click();
  await field(page, 'Medication name').fill('Lisinopril');
  await field(page, 'Person').fill('Alex');
  await field(page, 'Dose').fill('10mg daily');
  await field(page, 'Refill date').fill('2020-01-01');
  await page.getByRole('button', {name: 'Add Medication'}).click();
  await expect(page.getByText('Lisinopril')).toBeVisible();
  await expect(page.getByText(/Refill due since/)).toBeVisible();

  await openTab(page, 'Status');
  await expect(page.getByText(/medication.*due for refill/)).toBeVisible();

  await openTab(page, 'Family');
  await page.getByRole('button', {name: 'Printable Emergency Binder'}).click();
  await expect(page.getByRole('heading', {name: 'Medications'})).toBeVisible();
  await expect(page.getByText(/Lisinopril \(10mg daily\) — Alex/)).toBeVisible();

  const rows = await query(`SELECT person, name, dose, refill_date FROM northstar_medications`);
  expect(rows).toEqual([{person: 'Alex', name: 'Lisinopril', dose: '10mg daily', refill_date: '2020-01-01'}]);
});

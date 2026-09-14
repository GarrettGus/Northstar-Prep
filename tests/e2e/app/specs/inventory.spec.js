import { test, expect, addItem, field, itemRow, openTab, signedInHome } from '../support/app.js';
import { inventoryNames, query } from '../support/household.js';

test('a supply can be added, edited and deleted, and each step reaches Postgres', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');

  await addItem(page, {name: 'Rice', quantity: '5', category: 'Food'});
  await expect(page.getByText('5 units')).toBeVisible();
  expect(await inventoryNames()).toEqual(['Rice']);

  await page.getByRole('button', {name: 'Edit Rice'}).click();
  await field(page, 'Name').fill('Long grain rice');
  await field(page, 'Quantity').fill('12');
  await page.getByRole('button', {name: 'Save Changes'}).click();

  await expect(itemRow(page, 'Long grain rice')).toBeVisible();
  await expect(page.getByText('12 units')).toBeVisible();
  expect(await query('SELECT name, quantity::float AS quantity FROM northstar_inventory')).toEqual([{name: 'Long grain rice', quantity: 12}]);

  await page.getByRole('button', {name: 'Edit Long grain rice'}).click();
  await page.getByRole('button', {name: 'Delete', exact: true}).click();

  await expect(itemRow(page, 'Long grain rice')).toHaveCount(0);
  await expect(page.getByText('List Empty')).toBeVisible();
  expect(await inventoryNames()).toEqual([]);
});

test('a duplicate name and category is refused before it reaches the server', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');
  await addItem(page, {name: 'Bottled water', quantity: '3', category: 'Water'});

  await page.getByRole('button', {name: 'Add item'}).click();
  await field(page, 'Name').fill('bottled WATER');
  await field(page, 'Quantity').fill('1');
  await page.locator('form').locator('label:text-is("Category")').locator('xpath=following-sibling::select[1]').selectOption('Water');
  await page.getByRole('button', {name: 'Add to Hub'}).click();

  await expect(page.getByRole('alert')).toContainText('already exists');
  expect(await inventoryNames()).toEqual(['Bottled water']);
});

test('every edit is recorded in the household audit log', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');
  await addItem(page, {name: 'Headlamp', quantity: '2', category: 'Gear'});

  await page.getByRole('button', {name: 'Edit Headlamp'}).click();
  await page.getByRole('button', {name: 'Delete', exact: true}).click();
  await expect(itemRow(page, 'Headlamp')).toHaveCount(0);

  const log = await query(`SELECT action, item_name FROM northstar_audit_log ORDER BY created_at, id`);
  expect(log).toEqual([
    {action: 'add', item_name: 'Headlamp'},
    {action: 'delete', item_name: 'Headlamp'},
  ]);
});

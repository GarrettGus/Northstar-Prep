import { test, expect, addItem, itemRow, openTab, signedInHome } from '../support/app.js';
import { inventoryNames, shoppingNames } from '../support/household.js';

test('buying a shopping item moves it into the supply hub in one atomic step', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Shop');

  await addItem(page, {name: 'Propane cylinder', quantity: '2', category: 'Fuel', store: 'Hardware store'});
  await expect(page.getByRole('heading', {name: 'Hardware store'})).toBeVisible();
  expect(await shoppingNames()).toEqual(['Propane cylinder']);

  await page.getByRole('button', {name: 'Move Propane cylinder to inventory'}).click();

  await expect(page.getByText('List Empty')).toBeVisible();
  expect(await shoppingNames()).toEqual([]);
  expect(await inventoryNames()).toEqual(['Propane cylinder']);

  await openTab(page, 'Supplies');
  await expect(itemRow(page, 'Propane cylinder')).toBeVisible();
  await expect(page.getByText('2 units')).toBeVisible();
});

test('a purchase carries the item\'s details, not just its name', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Shop');
  await addItem(page, {name: 'Canned chili', quantity: '8', category: 'Food', store: 'Grocery'});

  await page.getByRole('button', {name: 'Move Canned chili to inventory'}).click();
  await expect(page.getByText('List Empty')).toBeVisible();

  await openTab(page, 'Supplies');
  await expect(itemRow(page, 'Canned chili')).toBeVisible();
  // Grouped under its category on the Supply Hub, and still 8 units.
  await expect(page.getByRole('heading', {name: 'Food'})).toBeVisible();
  await expect(page.getByText('8 units')).toBeVisible();
});

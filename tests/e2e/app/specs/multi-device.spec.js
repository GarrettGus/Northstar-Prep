import { test, expect, addItem, field, itemRow, openTab, signedInHome } from '../support/app.js';
import { storageStatePath } from '../support/environment.js';
import { inventoryNames } from '../support/household.js';

// Two browser contexts signed into the same household, which is what "two devices" means here:
// separate cookie jars, separate local storage, one shared server and database.
async function openDevices(browser) {
  const contexts = await Promise.all([
    browser.newContext({storageState: storageStatePath}),
    browser.newContext({storageState: storageStatePath}),
  ]);
  const pages = await Promise.all(contexts.map(async context => {
    const page = await context.newPage();
    await signedInHome(page);
    await openTab(page, 'Supplies');
    return page;
  }));
  return {phone: pages[0], laptop: pages[1], close: () => Promise.all(contexts.map(context => context.close()))};
}

// The app refreshes on window focus as well as on its 15-second timer; firing focus is how a
// spec gets the other device's next poll now instead of waiting out the interval.
const refresh = page => page.evaluate(() => window.dispatchEvent(new Event('focus')));

test('an edit on one device reaches the other', async ({browser}) => {
  const {phone, laptop, close} = await openDevices(browser);
  try {
    await addItem(phone, {name: 'Hand crank radio', quantity: '1', category: 'Gear'});

    await expect(itemRow(laptop, 'Hand crank radio')).toHaveCount(0);
    await refresh(laptop);
    await expect(itemRow(laptop, 'Hand crank radio')).toBeVisible();

    await laptop.getByRole('button', {name: 'Edit Hand crank radio'}).click();
    await field(laptop, 'Quantity').fill('3');
    await laptop.getByRole('button', {name: 'Save Changes'}).click();
    await expect(laptop.getByText('3 units')).toBeVisible();

    await refresh(phone);
    await expect(phone.getByText('3 units')).toBeVisible();
  } finally { await close(); }
});

test('simultaneous adds from both devices both survive', async ({browser}) => {
  const {phone, laptop, close} = await openDevices(browser);
  try {
    for (const [page, name] of [[phone, 'Wool blankets'], [laptop, 'Storm lantern']]) {
      await page.getByRole('button', {name: 'Add item'}).click();
      await field(page, 'Name').fill(name);
      await field(page, 'Quantity').fill('2');
    }

    // Both saves are in flight against the same household version; the server's
    // compare-and-swap retry has to land both rather than letting one overwrite the other.
    await Promise.all([
      phone.getByRole('button', {name: 'Add to Hub'}).click(),
      laptop.getByRole('button', {name: 'Add to Hub'}).click(),
    ]);

    await expect.poll(inventoryNames).toEqual(['Storm lantern', 'Wool blankets']);

    await refresh(phone);
    await refresh(laptop);
    for (const page of [phone, laptop]) {
      await expect(itemRow(page, 'Wool blankets')).toBeVisible();
      await expect(itemRow(page, 'Storm lantern')).toBeVisible();
    }
  } finally { await close(); }
});

test('saving a form for an item another device deleted is refused, not silently re-created', async ({browser}) => {
  const {phone, laptop, close} = await openDevices(browser);
  try {
    await addItem(phone, {name: 'Camp stove', quantity: '1', category: 'Gear'});
    await refresh(laptop);
    await expect(itemRow(laptop, 'Camp stove')).toBeVisible();

    // The laptop opens the editor while the item still exists; the form keeps that stale copy
    // even after a background refresh, which is exactly the case a conflict check has to catch.
    await laptop.getByRole('button', {name: 'Edit Camp stove'}).click();
    await field(laptop, 'Quantity').fill('9');

    await phone.getByRole('button', {name: 'Edit Camp stove'}).click();
    await phone.getByRole('button', {name: 'Delete', exact: true}).click();
    await expect(itemRow(phone, 'Camp stove')).toHaveCount(0);

    await laptop.getByRole('button', {name: 'Save Changes'}).click();

    await expect(laptop.getByRole('alert').first()).toContainText('item conflict');
    expect(await inventoryNames()).toEqual([]);

    await refresh(laptop);
    await expect(itemRow(laptop, 'Camp stove')).toHaveCount(0);
  } finally { await close(); }
});

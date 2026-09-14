import { test, expect, addItem, field, itemRow, openTab, signedInHome } from '../support/app.js';
import { storageStatePath } from '../support/environment.js';
import { inventoryNames } from '../support/household.js';

const syncStatus = page => page.getByRole('button', {name: 'Open household settings'});
const queueLength = page => page.evaluate(() => JSON.parse(localStorage.getItem('northstar-action-queue-v1') || '[]').length);

async function addWhileOffline(page, name) {
  await page.getByRole('button', {name: 'Add item'}).click();
  await field(page, 'Name').fill(name);
  await field(page, 'Quantity').fill('4');
  await page.getByRole('button', {name: 'Add to Hub'}).click();
  await expect(itemRow(page, name)).toBeVisible();
}

test('edits made offline are queued locally and sync on reconnect', async ({page, context, browser}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');
  await addItem(page, {name: 'First aid kit', quantity: '1', category: 'Medical'});

  await context.setOffline(true);
  // The header's live region drops out of its "saved" state: it reads Offline, or Sync error
  // once the background poll has also failed. Either way it stops claiming the household is saved.
  await expect(syncStatus(page)).toHaveText(/Offline|Sync error/);

  await addWhileOffline(page, 'Emergency candles');
  // Held on this device only: nothing reached the server while the connection was down.
  expect(await queueLength(page)).toBe(1);
  expect(await inventoryNames()).toEqual(['First aid kit']);
  await expect(page.getByRole('alert').first()).toContainText('Offline');

  await context.setOffline(false);

  await expect.poll(() => queueLength(page)).toBe(0);
  await expect.poll(inventoryNames).toEqual(['Emergency candles', 'First aid kit']);

  // A device that was never offline sees the reconnected edit, so it really was persisted.
  const other = await browser.newContext({storageState: storageStatePath});
  try {
    const fresh = await other.newPage();
    await signedInHome(fresh);
    await openTab(fresh, 'Supplies');
    await expect(itemRow(fresh, 'Emergency candles')).toBeVisible();
  } finally { await other.close(); }
});

test('losing connectivity keeps the household on screen from the local cache', async ({page, context}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');
  await addItem(page, {name: 'Solar charger', quantity: '1', category: 'Power'});

  // The app shell is served over the network, so this covers an open tab losing its connection
  // (the case the local cache exists for), not a cold reload with no connectivity at all.
  await context.setOffline(true);

  await expect(page.getByRole('alert').first()).toContainText('Offline mode: showing the last saved copy');
  await expect(itemRow(page, 'Solar charger')).toBeVisible();
  await expect(syncStatus(page)).toHaveText(/Offline|Sync error/);

  await context.setOffline(false);

  await expect.poll(() => page.getByRole('alert').count()).toBe(0);
  await expect(itemRow(page, 'Solar charger')).toBeVisible();
});

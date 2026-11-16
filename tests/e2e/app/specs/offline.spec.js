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

const QUEUE_KEY = 'northstar-action-queue-v1';
const REJECTED_KEY = 'northstar-rejected-actions-v1';
const rejectedLength = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]').length, REJECTED_KEY);
const addAction = (id, name, quantity) => ({type: 'add', collection: 'inventory', id, item: {name, quantity}, queuedAt: Date.now()});

test('an edit the server rejects is set aside with a notice, and the edits queued behind it still sync', async ({page}) => {
  await signedInHome(page);
  // A queue as if it were built offline: a change the server will refuse (a negative quantity),
  // then two good ones. Before this was fixed, the first blocked the others until sign-out.
  await page.evaluate(([key, queue]) => localStorage.setItem(key, JSON.stringify(queue)), [QUEUE_KEY, [
    addAction('bad-item', 'Broken lantern', -5),
    addAction('good-1', 'Water filter', 2),
    addAction('good-2', 'Matches', 6),
  ]]);
  await page.reload();

  await expect.poll(inventoryNames).toEqual(['Matches', 'Water filter']);
  await expect.poll(() => queueLength(page)).toBe(0);

  const notice = page.getByRole('alert').filter({hasText: 'could not be saved'});
  await expect(notice).toContainText('1 change could not be saved');
  await expect(notice).toContainText('Add: Broken lantern');
  await expect(notice).toContainText('Invalid data');
  expect(await rejectedLength(page)).toBe(1);
  // It was never stored, and the screen does not keep pretending it was.
  await openTab(page, 'Supplies');
  await expect(itemRow(page, 'Water filter')).toBeVisible();
  await expect(itemRow(page, 'Broken lantern')).toHaveCount(0);

  // "Try again" puts it back in the queue; the server refuses it again, so it returns to the notice.
  await notice.getByRole('button', {name: /Try again/}).click();
  await expect(notice).toContainText('1 change could not be saved');
  expect(await queueLength(page)).toBe(0);
  expect(await inventoryNames()).toEqual(['Matches', 'Water filter']);

  // Discarding removes it for good, and the notice goes away.
  await notice.getByRole('button', {name: /Discard/}).click();
  await expect(page.getByRole('alert').filter({hasText: 'could not be saved'})).toHaveCount(0);
  expect(await rejectedLength(page)).toBe(0);
});

test('an edit made during a brief outage is retried by itself, without a reload or reconnect', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');
  // The browser stays "online" but saves fail, as in a Wi-Fi blip or a server restart.
  await page.route('**/api/hub', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  await addWhileOffline(page, 'Camp stove');
  expect(await queueLength(page)).toBe(1);
  expect(await inventoryNames()).toEqual([]);

  await page.unroute('**/api/hub');
  // No reload, no offline/online event: the app tries again on its own and the edit lands.
  await expect.poll(() => queueLength(page), {timeout: 20_000}).toBe(0);
  await expect.poll(inventoryNames).toEqual(['Camp stove']);
  await expect(page.getByRole('alert').filter({hasText: 'keep retrying'})).toHaveCount(0);
});

test('while earlier edits are waiting to sync, a new edit queues behind them instead of overtaking them', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');
  const posts = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/hub')) posts.push(JSON.parse(request.postData() || '{}').item?.name); });
  await page.route('**/api/hub', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  await addWhileOffline(page, 'Tarp');
  await addWhileOffline(page, 'Rope');
  await page.unroute('**/api/hub');
  await expect.poll(inventoryNames, {timeout: 20_000}).toEqual(['Rope', 'Tarp']);
  // The server saw the successful sends in the order the edits were made.
  const delivered = posts.slice(posts.lastIndexOf('Tarp'));
  expect(delivered.filter((name, index) => name !== delivered[index - 1])).toEqual(['Tarp', 'Rope']);
});

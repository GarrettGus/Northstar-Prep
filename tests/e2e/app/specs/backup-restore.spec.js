import { test, expect, addItem, itemRow, openTab, signedInHome } from '../support/app.js';
import { environment } from '../support/environment.js';
import { inventoryNames, query } from '../support/household.js';

const cronHeaders = {authorization: `Bearer ${environment().cronSecret}`};

// Drives the scheduled-backup path the deployment actually runs: the cron request encrypts and
// stores the household, and Household settings restores it through the same preview-then-merge
// flow used for manual JSON imports.
async function takeScheduledBackup(request) {
  const response = await request.get('/api/backup', {headers: cronHeaders});
  expect(response.status(), await response.text()).toBe(200);
  expect((await response.json()).status).toBe('success');
}

async function openBackups(page) {
  await page.getByRole('button', {name: 'Open household settings'}).click();
  await expect(page.getByRole('heading', {name: 'Automatic backups'})).toBeVisible();
}

test('a scheduled backup restores a deleted supply after preview and merge', async ({page, request}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');
  await addItem(page, {name: 'Emergency radio', quantity: '1', category: 'Gear'});

  await takeScheduledBackup(request);

  await page.getByRole('button', {name: 'Edit Emergency radio'}).click();
  await page.getByRole('button', {name: 'Delete', exact: true}).click();
  await expect(itemRow(page, 'Emergency radio')).toHaveCount(0);
  expect(await inventoryNames()).toEqual([]);

  await openBackups(page);
  await page.getByRole('button', {name: 'Preview restore'}).click();

  // Nothing is applied until the merge is confirmed.
  await expect(page.getByRole('status')).toContainText('1 inventory items');
  expect(await inventoryNames()).toEqual([]);

  await page.getByRole('button', {name: 'Merge backup'}).click();

  await expect(itemRow(page, 'Emergency radio')).toBeVisible();
  expect(await inventoryNames()).toEqual(['Emergency radio']);
});

test('a corrupted backup is refused instead of restoring unverified data', async ({page, request}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');
  await addItem(page, {name: 'Water filter', quantity: '1', category: 'Water'});

  await takeScheduledBackup(request);
  await query('UPDATE northstar_backups SET ciphertext = $1 WHERE status = $2', [Buffer.from('tampered-with'), 'success']);

  await openBackups(page);
  await page.getByRole('button', {name: 'Preview restore'}).click();

  await expect(page.getByRole('alert').first()).toContainText('Restore failed');
  await expect(page.getByRole('alert').first()).toContainText('could not be verified');
  await expect(page.getByRole('button', {name: 'Merge backup'})).toHaveCount(0);
  expect(await inventoryNames()).toEqual(['Water filter'], 'the household must be left exactly as it was');
});

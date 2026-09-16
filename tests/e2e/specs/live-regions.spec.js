import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the sync status live region announces syncing, queued, offline, error and synced states', async ({ page }) => {
  const liveRegion = page.locator('[aria-live="polite"]');
  await expect(liveRegion).toBeVisible();

  await page.getByTestId('set-syncing').click();
  await expect(liveRegion).toHaveText(/Saved|s ago|Not synced yet/);

  await page.getByTestId('set-queued').click();
  await expect(liveRegion).toHaveText('3 queued');

  await page.getByTestId('set-offline').click();
  await expect(liveRegion).toHaveText('Offline');

  await page.getByTestId('set-error').click();
  await expect(liveRegion).toHaveText('Sync error');

  await page.getByTestId('set-synced').click();
  await expect(liveRegion).toHaveText(/Saved 1[0-9]s ago/);
});

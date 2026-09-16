import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('icon-only header controls expose accessible names', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Download household backup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open household settings' })).toBeVisible();
});

test('inventory row controls are labelled and the input has a visible-name label', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Edit Water Jug' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select Water Jug' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move Water Jug to inventory' })).toBeVisible();
});

test('outage simulation modal close controls are labelled', async ({ page }) => {
  await page.getByTestId('open-simulation-modal').click();
  const dialog = page.getByRole('dialog', { name: '3-day outage' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close simulation result' })).toBeVisible();
});

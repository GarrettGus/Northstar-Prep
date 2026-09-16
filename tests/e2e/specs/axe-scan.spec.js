import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Broad, automated sweep for accessibility regressions (missing names, invalid ARIA,
// focus order, contrast, etc.) across the harness in its default state and with the
// dialog open, on top of the specific behaviors pinned by the other specs here.
test('harness has no detectable accessibility violations (default state)', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('harness has no detectable accessibility violations (dialog open)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-simulation-modal').click();
  await expect(page.getByRole('dialog', { name: '3-day outage' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

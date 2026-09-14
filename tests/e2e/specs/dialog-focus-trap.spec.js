import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opening the dialog moves focus inside it, trapping Tab between its controls', async ({ page }) => {
  const trigger = page.getByTestId('open-ai-modal');
  await trigger.click();

  const closeIcon = page.getByRole('button', { name: 'Close AI result' });
  const closeButton = page.getByRole('button', { name: 'Close', exact: true });

  // Focus starts on the dialog's first focusable control.
  await expect(closeIcon).toBeFocused();

  // Tab forward from the last focusable control wraps back to the first.
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeIcon).toBeFocused();

  // Shift+Tab from the first focusable control wraps back to the last.
  await page.keyboard.press('Shift+Tab');
  await expect(closeButton).toBeFocused();
});

test('Escape closes the dialog and restores focus to the control that opened it', async ({ page }) => {
  const trigger = page.getByTestId('open-ai-modal');
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Meal Plan' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog', { name: 'Meal Plan' })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

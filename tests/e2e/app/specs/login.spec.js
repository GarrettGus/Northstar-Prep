import { test, expect } from '@playwright/test';
import { environment } from '../support/environment.js';
import { resetHousehold } from '../support/household.js';

// Signed out on purpose: this spec covers the sign-in flow itself. Login attempts are
// rate-limited to 10 per IP per 15 minutes, so it keeps its number of attempts small.
test.use({storageState: {cookies: [], origins: []}});

const owner = environment().owner;

test.beforeAll(async () => { await resetHousehold(); });

test('an unauthenticated visitor gets the sign-in form, not household data', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'NorthStar Prep'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Sign in'})).toBeEnabled();
  await expect(page.getByRole('button', {name: 'Open household settings'})).toHaveCount(0);
});

test('the wrong password is rejected without revealing whether the account exists', async ({page}) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill('not-the-right-password');
  await page.getByRole('button', {name: 'Sign in'}).click();

  await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.');
  await expect(page.getByRole('button', {name: 'Open household settings'})).toHaveCount(0);
});

test('signing in opens the household, survives a reload, and can be signed out again', async ({page}) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', {name: 'Sign in'}).click();

  await expect(page.getByRole('button', {name: 'Open household settings'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Supplies'})).toBeVisible();

  // The session cookie, not page state, is what keeps the household open.
  await page.reload();
  await expect(page.getByRole('button', {name: 'Open household settings'})).toBeVisible();

  await page.getByRole('button', {name: 'Open household settings'}).click();
  await page.getByRole('button', {name: 'Sign out'}).click();
  await expect(page.getByRole('button', {name: 'Sign in'})).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', {name: 'Sign in'})).toBeVisible();
});

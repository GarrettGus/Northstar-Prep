import { test as base, expect } from '@playwright/test';
import { resetHousehold } from './household.js';
import { storageStatePath } from './environment.js';

// Every spec but login.spec.js starts signed in as the owner and with an empty household.
export const test = base.extend({
  storageState: storageStatePath,
  household: [async ({}, use) => { await resetHousehold(); await use(); }, {auto: true}],
});
export { expect };

// --- Locators for the shared UI. The add/edit form's fields have no id/htmlFor pairing, so
// they are addressed through the label that immediately precedes each control. ---
export function itemForm(page) { return page.locator('form'); }
export function field(page, label) {
  return itemForm(page).locator(`label:text-is("${label}")`).locator('xpath=following-sibling::input[1]');
}
export function selectField(page, label) {
  return itemForm(page).locator(`label:text-is("${label}")`).locator('xpath=following-sibling::select[1]');
}
export function itemRow(page, name) { return page.getByRole('heading', {name, level: 4}); }

// Family Hub sections (household members, contacts, meeting points) render label/input pairs
// outside a <form>, scoped by their own <section>; find the section by its heading, then the
// field within it, the same way `field` finds one within the item form.
export function sectionByHeading(page, heading) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: heading }) });
}
export function fieldIn(container, label) {
  return container.locator(`label:text-is("${label}")`).locator('xpath=following-sibling::input[1]');
}

export async function openTab(page, label) {
  await page.getByRole('button', {name: label, exact: true}).click();
}

export async function signedInHome(page) {
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Open household settings'})).toBeVisible();
  return page;
}

export async function addItem(page, {name, quantity = '1', category, store, submit = 'Add to Hub'}) {
  await page.getByRole('button', {name: 'Add item'}).click();
  await field(page, 'Name').fill(name);
  await field(page, 'Quantity').fill(String(quantity));
  if (category) await selectField(page, 'Category').selectOption(category);
  if (store !== undefined) await field(page, 'Store').fill(store);
  await page.getByRole('button', {name: submit, exact: true}).click();
  await expect(itemRow(page, name)).toBeVisible();
}

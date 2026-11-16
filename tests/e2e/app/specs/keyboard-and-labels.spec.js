import { test, expect, openTab, signedInHome } from '../support/app.js';

// Real keyboard and screen-reader checks against the signed-in app. Every form label is attached
// to its control (so getByLabel finds it, which is how assistive technology finds it), and the
// kit, medication and reminder rows open from the keyboard.

const duplicateIds = page => page.evaluate(() => {
  const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
  return ids.length - new Set(ids).size;
});

test('every field in the supply form is found by its label, and clicking a label focuses its input', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');
  await page.getByRole('button', {name: 'Add item'}).click();
  for (const label of ['Name', 'Quantity', 'Unit', 'Purchase Date', 'Expiry Date', 'Price ($/Unit)', 'Category', 'Location (optional)', 'Kit (optional)', 'Barcode (optional)', 'Restock every N days (0 = never)']) {
    await expect(page.getByLabel(label, {exact: true}), label).toHaveCount(1);
  }
  // A bare <label> does nothing when clicked; an attached one moves focus to its input.
  await page.locator('label', {hasText: /^Quantity$/}).click();
  await expect(page.getByLabel('Quantity', {exact: true})).toBeFocused();
  expect(await duplicateIds(page)).toBe(0);
});

test('the kit form labels its fields and every target-contents row, and ids stay unique with several rows', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');
  await page.getByRole('button', {name: 'Add kit'}).click();
  await expect(page.getByLabel('Name', {exact: true})).toHaveCount(1);
  await expect(page.getByLabel('Purpose (optional)', {exact: true})).toHaveCount(1);
  await expect(page.getByLabel('Kit belongs to')).toHaveCount(1);
  await page.getByRole('button', {name: 'Add target item'}).click();
  await page.getByRole('button', {name: 'Add target item'}).click();
  // Before, these inputs had only a placeholder: no name at all for a screen reader.
  for (const row of [1, 2]) {
    for (const part of ['name', 'quantity', 'unit']) await expect(page.getByLabel(`Target item ${row} ${part}`)).toHaveCount(1);
  }
  await expect(page.getByRole('group', {name: 'Target contents'})).toBeVisible();
  expect(await duplicateIds(page)).toBe(0);
});

test('a kit opens from the keyboard with Enter or Space', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Supplies');
  await page.getByRole('button', {name: 'Add kit'}).click();
  await page.getByLabel('Name', {exact: true}).fill('Car kit');
  await page.getByRole('button', {name: 'Add Kit'}).click();

  const row = page.getByRole('button', {name: 'Edit kit Car kit'});
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', {name: 'Save Changes'})).toBeVisible();
  await expect(page.getByLabel('Name', {exact: true})).toHaveValue('Car kit');
  await page.getByRole('button', {name: 'Cancel adding kit'}).click();

  await row.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', {name: 'Save Changes'})).toBeVisible();
});

test('a medication and a reminder open from the keyboard, and typing in an open form does not re-open anything', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Family');

  await page.getByRole('button', {name: 'Add medication'}).click();
  await page.getByLabel('Medication name', {exact: true}).fill('Insulin');
  await page.getByRole('button', {name: 'Add Medication'}).click();
  const medication = page.getByRole('button', {name: 'Edit medication Insulin'});
  await medication.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Medication name', {exact: true})).toHaveValue('Insulin');
  // Space typed into a field is a space, not a command: only a key pressed on the row itself opens it.
  await page.getByLabel('Medication name', {exact: true}).fill('Insulin ');
  await page.keyboard.type('pen');
  await expect(page.getByLabel('Medication name', {exact: true})).toHaveValue('Insulin pen');
  await page.getByRole('button', {name: 'Cancel adding medication'}).click();

  await page.getByRole('button', {name: 'Add reminder'}).click();
  await page.getByLabel('Title', {exact: true}).fill('Test the generator');
  await page.getByRole('button', {name: 'Add Reminder'}).click();
  const reminder = page.getByRole('button', {name: 'Edit reminder Test the generator'});
  await reminder.focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Title', {exact: true})).toHaveValue('Test the generator');
  // The Mark Complete and Snooze buttons beside it are separate controls and keep working.
  await page.getByRole('button', {name: 'Cancel adding reminder'}).click();
  await expect(page.getByRole('button', {name: 'Mark Test the generator complete'})).toBeVisible();
});

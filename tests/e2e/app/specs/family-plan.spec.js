import { test, expect, openTab, signedInHome, sectionByHeading, fieldIn } from '../support/app.js';
import { query } from '../support/household.js';

test('editing family members, contacts, meeting points and the shelter spot persists', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Family');

  await page.getByRole('button', {name: 'Edit', exact: true}).click();

  const familySection = sectionByHeading(page, 'Household Tracking');
  await page.getByRole('button', {name: 'Add person'}).click();
  await fieldIn(familySection, 'Name').fill('Jamie Rivera');
  await fieldIn(familySection, 'Role').fill('Adult');
  await fieldIn(familySection, 'Date of birth').fill('1990-05-01');

  const contactsSection = sectionByHeading(page, 'Emergency Contacts');
  await page.getByRole('button', {name: 'Add contact'}).click();
  await fieldIn(contactsSection, 'Name').fill('Aunt Robin');
  await fieldIn(contactsSection, 'Phone').fill('555-0100');
  await fieldIn(contactsSection, 'Type').fill('Out-of-area');

  const meetingSection = sectionByHeading(page, 'Meeting Points');
  await fieldIn(meetingSection, 'Primary').fill('End of the driveway');
  await fieldIn(meetingSection, 'Secondary (out of neighborhood)').fill('Community center on Main St');

  await sectionByHeading(page, 'Storm Point').locator('textarea').fill('Basement, southwest corner');

  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Edit', exact: true})).toBeVisible();

  // Displayed immediately, without a reload.
  await expect(page.getByText('Jamie Rivera')).toBeVisible();
  await expect(page.getByText('Aunt Robin')).toBeVisible();
  await expect(page.getByText('End of the driveway')).toBeVisible();
  await expect(page.getByText('Basement, southwest corner')).toBeVisible();

  // And actually persisted server-side, not just held in local component state.
  const family = await query('SELECT name, role, dob FROM northstar_family_members WHERE household_id = 1 ORDER BY position');
  expect(family).toEqual([{name: 'Jamie Rivera', role: 'Adult', dob: '1990-05-01'}]);
  const contacts = await query('SELECT name, phone, type FROM northstar_contacts WHERE household_id = 1 ORDER BY position');
  expect(contacts).toEqual([{name: 'Aunt Robin', phone: '555-0100', type: 'Out-of-area'}]);
  const [plan] = await query('SELECT shelter_spot, meeting_primary, meeting_secondary FROM northstar_plan WHERE household_id = 1');
  expect(plan.shelter_spot).toEqual('Basement, southwest corner');
  expect(plan.meeting_primary).toEqual('End of the driveway');
  expect(plan.meeting_secondary).toEqual('Community center on Main St');

  // Reloading re-fetches from the server rather than showing stale local state.
  await page.reload();
  await openTab(page, 'Family');
  await expect(page.getByText('Jamie Rivera')).toBeVisible();
  await expect(page.getByText('Aunt Robin')).toBeVisible();
});

test('removing a member or contact while editing drops it on save', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Family');

  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  await page.getByRole('button', {name: 'Add person'}).click();
  await fieldIn(sectionByHeading(page, 'Household Tracking'), 'Name').fill('Temporary Person');
  await page.getByRole('button', {name: 'Remove Temporary Person'}).click();
  await page.getByRole('button', {name: 'Save', exact: true}).click();

  await expect(page.getByText('No household members added yet.')).toBeVisible();
  const family = await query('SELECT name FROM northstar_family_members WHERE household_id = 1');
  expect(family).toEqual([]);
});

test('a household member with other fields filled in but no name is refused, not silently dropped', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Family');

  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  await page.getByRole('button', {name: 'Add person'}).click();
  await fieldIn(sectionByHeading(page, 'Household Tracking'), 'Role').fill('Dog');
  await page.getByRole('button', {name: 'Save', exact: true}).click();

  await expect(page.getByRole('alert')).toHaveText('Give each household member a name, or remove the empty row, before saving.');
  // Still in edit mode with the typed data intact, not discarded.
  await expect(fieldIn(sectionByHeading(page, 'Household Tracking'), 'Role')).toHaveValue('Dog');
  const family = await query('SELECT name FROM northstar_family_members WHERE household_id = 1');
  expect(family).toEqual([]);
});

test('a pet with its own consumption figures persists and switches readiness to per-member mode', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Family');

  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  const familySection = sectionByHeading(page, 'Household Tracking');
  await page.getByRole('button', {name: 'Add pet'}).click();
  await fieldIn(familySection, 'Name').fill('Rex');
  await fieldIn(familySection, 'Role').fill('Dog');
  await fieldIn(familySection, 'Calories per day').fill('700');
  await fieldIn(familySection, 'Water gal per day').fill('0.25');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Edit', exact: true})).toBeVisible();

  const family = await query('SELECT name, kind, calories_per_day, water_gallons_per_day FROM northstar_family_members WHERE household_id = 1 ORDER BY position');
  expect(family).toEqual([{name: 'Rex', kind: 'pet', calories_per_day: '700', water_gallons_per_day: '0.25'}]);

  // Adding a pet opts the household into per-member readiness, which the Dashboard states.
  await openTab(page, 'Status');
  await expect(page.getByText(/Adds up each household member's own needs/)).toBeVisible();
  await expect(page.getByText(/1 pet/)).toBeVisible();
});

test('canceling an edit discards unsaved changes', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Family');

  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  await sectionByHeading(page, 'Storm Point').locator('textarea').fill('Discarded draft');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();

  await expect(page.getByText('Discarded draft')).toHaveCount(0);
  const [plan] = await query('SELECT shelter_spot FROM northstar_plan WHERE household_id = 1');
  expect(plan?.shelter_spot ?? '').not.toEqual('Discarded draft');
});

test('the printable emergency binder reflects the saved plan and works without AI', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Family');
  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  await sectionByHeading(page, 'Storm Point').locator('textarea').fill('Basement, southwest corner');
  await page.getByRole('button', {name: 'Save', exact: true}).click();

  await page.getByRole('button', {name: 'Printable Emergency Binder'}).click();
  await expect(page.getByRole('heading', {name: 'Emergency Binder'})).toBeVisible();
  await expect(page.getByText('Basement, southwest corner')).toBeVisible();
  await expect(page.getByText('Readiness summary')).toBeVisible();
  await expect(page.getByText('Seasonal checklists')).toBeVisible();

  await page.getByRole('button', {name: 'Close', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Emergency Binder'})).toHaveCount(0);
});

test('the dashboard suggests a deterministic shortfall instead of an AI gap analysis', async ({page}) => {
  await signedInHome(page);
  await expect(page.getByRole('heading', {name: 'Readiness Gaps'})).toBeVisible();
  await expect(page.getByText('Every readiness goal is currently met.')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Add water shortfall to shopping list'})).toBeVisible();

  await page.getByRole('button', {name: 'Add water shortfall to shopping list'}).click();
  await openTab(page, 'Shop');
  await expect(page.getByRole('heading', {name: 'Drinking water (readiness shortfall)', level: 4})).toBeVisible();
});

import { test, expect, addItem, field, selectField, openTab, signedInHome, sectionByHeading, fieldIn } from '../support/app.js';
import { query } from '../support/household.js';

async function addFamilyMember(page, name) {
  await openTab(page, 'Family');
  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  await page.getByRole('button', {name: 'Add person'}).click();
  await fieldIn(sectionByHeading(page, 'Household Tracking'), 'Name').fill(name);
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Edit', exact: true})).toBeVisible();
}

test('activating the plan reaches Postgres, a check-in is recorded for the signed-in member, and standing down ends it', async ({page}) => {
  await signedInHome(page);
  await page.getByRole('button', {name: /Go time: activate the plan/}).click();
  await page.getByRole('radio', {name: 'Shelter in place'}).click();
  await page.getByLabel('Note for the household (optional)').fill('Ice storm, power out');
  await page.getByRole('button', {name: 'Activate for the household'}).click();

  await expect(page.getByRole('heading', {name: 'Shelter in place', level: 1})).toBeVisible();
  expect(await query('SELECT mode, note FROM northstar_activation WHERE household_id = 1')).toEqual([{mode: 'shelter', note: 'Ice storm, power out'}]);
  await expect(page.getByRole('heading', {name: /Make supplies last/})).toBeVisible();

  await page.getByRole('button', {name: 'Safe at home'}).click();
  await expect(page.getByRole('list', {name: 'Household check-ins'})).toContainText('Safe at home');
  expect(await query('SELECT status FROM northstar_checkins WHERE household_id = 1')).toEqual([{status: 'safe_home'}]);

  // Closing keeps the event visible from every tab until someone stands down.
  await page.getByRole('button', {name: 'Close go time'}).click();
  await openTab(page, 'Supplies');
  await expect(page.getByRole('button', {name: /Shelter in place in progress · 1 of 1 checked in/})).toBeVisible();

  await page.getByRole('button', {name: /Shelter in place in progress/}).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: 'Stand down (everyone is safe)'}).click();
  await expect(page.getByRole('button', {name: 'Activate for the household'})).toBeVisible();
  expect(await query('SELECT count(*)::int AS count FROM northstar_activation')).toEqual([{count: 0}]);
  expect((await query(`SELECT action FROM northstar_audit_log WHERE collection = 'plan_activation' ORDER BY id`)).map(row => row.action)).toEqual(['activate', 'checkin', 'stand_down']);
});

test('a drill runs on this device only: the grab list shows each person\'s go-bag and remembers check-offs', async ({page}) => {
  await signedInHome(page);
  await addFamilyMember(page, 'Sam');

  await openTab(page, 'Supplies');
  await page.getByRole('button', {name: 'Add kit'}).click();
  await field(page, 'Name').fill('Sam bag');
  await page.getByLabel('Kit belongs to').selectOption('Sam');
  await page.getByRole('button', {name: 'Add target item'}).click();
  await page.getByPlaceholder('Item name').fill('Headlamp');
  await page.getByRole('button', {name: 'Add Kit'}).click();
  await expect(page.getByText('For Sam')).toBeVisible();
  expect(await query(`SELECT assigned_to FROM northstar_kits WHERE name = 'Sam bag'`)).toEqual([{assigned_to: 'Sam'}]);

  await addItem(page, {name: 'Water bottle', quantity: '2', category: 'Water'});
  await page.getByRole('button', {name: 'Edit Water bottle'}).click();
  await field(page, 'Location (optional)').fill('Hall closet');
  await selectField(page, 'Kit (optional)').selectOption({label: 'Sam bag'});
  await page.getByRole('button', {name: 'Save Changes'}).click();

  await openTab(page, 'Status');
  await page.getByRole('button', {name: /Go time: activate the plan/}).click();
  await page.getByRole('button', {name: 'Practice drill on this device'}).click();
  await expect(page.getByRole('heading', {name: 'Evacuate (drill)', level: 1})).toBeVisible();
  expect(await query('SELECT count(*)::int AS count FROM northstar_activation')).toEqual([{count: 0}]);

  await expect(page.getByRole('heading', {name: 'Sam bag (Sam)'})).toBeVisible();
  await expect(page.getByText('Kept in: Hall closet')).toBeVisible();
  await expect(page.getByText('Not packed: need 1 units, have 0')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Go-bags'})).toBeVisible();

  await page.getByRole('checkbox', {name: /Water bottle/}).check();
  await page.getByRole('button', {name: 'Close go time'}).click();
  await page.getByRole('button', {name: /Go time: activate the plan/}).click();
  await page.getByRole('button', {name: 'Practice drill on this device'}).click();
  await expect(page.getByRole('checkbox', {name: /Water bottle/})).toBeChecked();
});

test('notification deep links open Go time or a tab, and the notifications panel explains when push is not set up', async ({page}) => {
  await page.goto('/?go=1');
  await expect(page.getByRole('button', {name: 'Activate for the household'})).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/?tab=power');
  await expect(page.getByRole('button', {name: 'Power'})).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', {name: 'Open household settings'}).click();
  await expect(page.getByRole('heading', {name: 'Notifications'})).toBeVisible();
  await expect(page.getByText("Push notifications aren't set up for this household yet.")).toBeVisible();
});

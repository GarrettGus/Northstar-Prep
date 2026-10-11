import { test, expect, openTab, signedInHome } from '../support/app.js';
import { query } from '../support/household.js';

test('a hazard profile persists, adds its checklist and supply template, and brings in local weather alerts', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Family');
  await page.getByRole('button', {name: 'Edit', exact: true}).click();

  await page.getByLabel('Location name').fill('Home');
  await page.getByLabel('Latitude').fill('44.977');
  await page.getByLabel('Longitude').fill('-93.268');
  await page.getByRole('checkbox', {name: 'Winter storm'}).check();
  await page.getByRole('checkbox', {name: 'Flood'}).check();
  await page.getByRole('button', {name: 'Add link'}).click();
  await page.getByLabel('Link title').fill('Power outage map');
  await page.getByLabel('Link address').fill('https://outages.example.com');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Edit', exact: true})).toBeVisible();

  // Stored rounded to ~1 km, with the hazards and link, straight from Postgres.
  const [row] = await query('SELECT location_label, latitude::float AS latitude, longitude::float AS longitude, hazards, links FROM northstar_plan WHERE household_id = 1');
  expect(row).toEqual({location_label: 'Home', latitude: 44.98, longitude: -93.27, hazards: ['winter-storm', 'flood'], links: [{title: 'Power outage map', url: 'https://outages.example.com'}]});

  await expect(page.getByRole('list', {name: 'Chosen hazards'})).toContainText('Flood');
  await expect(page.getByRole('link', {name: /Power outage map/})).toHaveAttribute('href', 'https://outages.example.com');
  await expect(page.getByRole('link', {name: /Flood: what to do/})).toHaveAttribute('href', 'https://www.ready.gov/floods');
  await expect(page.getByRole('button', {name: /Winter storm Readiness/})).toBeVisible();
  // The forecast office comes from the NWS lookup for the saved point (a local stub in this suite).
  await expect(page.getByRole('link', {name: /NWS forecast office \(MPX\)/})).toBeVisible();

  await openTab(page, 'Status');
  const alerts = page.getByRole('region', {name: 'Weather alerts'});
  await expect(alerts).toContainText('Winter Storm Warning · Minneapolis, MN');
  await alerts.getByText('Winter Storm Warning · Minneapolis, MN').click();
  await expect(alerts).toContainText('Travel only if you must.');

  await page.getByRole('button', {name: 'Open household settings'}).click();
  await page.getByRole('button', {name: /Starter supply templates/}).click();
  await expect(page.getByText('Flood Supplies')).toBeVisible();
});

test('a location outside the US is saved but explains that alerts are unavailable', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Family');
  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  await page.getByLabel('Latitude').fill('51.5');
  await page.getByLabel('Longitude').fill('-0.12');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByText('Weather alerts are only available for US locations.')).toBeVisible();
});

test('a half-entered location or an unsafe link is refused before saving', async ({page}) => {
  await signedInHome(page);
  await openTab(page, 'Family');
  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  await page.getByLabel('Latitude').fill('44.98');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Enter both latitude and longitude');

  await page.getByLabel('Latitude').fill('');
  await page.getByRole('button', {name: 'Add link'}).click();
  await page.getByLabel('Link title').fill('Bad');
  await page.getByLabel('Link address').fill('javascript:alert(1)');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('starting with https://');
  expect(await query('SELECT count(*)::int AS count FROM northstar_plan')).toEqual([{count: 0}]);
});

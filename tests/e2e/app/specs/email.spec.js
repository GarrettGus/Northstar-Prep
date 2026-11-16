import { test, expect } from '../support/app.js';
import { environment, storageStatePath } from '../support/environment.js';
import { query } from '../support/household.js';

// The dev server sends through a local stand-in for the email provider (support/stubServices.js).
const stub = () => environment().stubBase;
async function sentEmails() { return (await fetch(`${stub()}/sent`)).json(); }
async function clearEmails() { await fetch(`${stub()}/sent`, {method: 'DELETE'}); }
const linkIn = text => text.match(/https?:\/\/\S+/)[0];

test.beforeEach(clearEmails);

test('an owner\'s invitation is emailed, and the emailed link lets the new member join', async ({page, browser}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Open household settings'}).click();
  await page.getByPlaceholder('Invite by email').fill('casey@example.test');
  await page.getByRole('button', {name: 'Send invitation'}).click();
  await expect(page.getByRole('status').filter({hasText: 'Invitation emailed to casey@example.test'})).toBeVisible();

  const [email] = await sentEmails();
  expect(email.to).toEqual(['casey@example.test']);
  expect(email.subject).toContain('invited');
  const link = linkIn(email.text);
  expect(link).toContain('?invite=');

  const guest = await browser.newContext({storageState: {cookies: [], origins: []}});
  try {
    const invited = await guest.newPage();
    await invited.goto(link);
    await invited.getByLabel('Email').fill('casey@example.test');
    await invited.getByLabel('Choose a password').fill('casey-password-123');
    await invited.getByRole('button', {name: 'Join household'}).click();
    await expect(invited.getByRole('button', {name: 'Open household settings'})).toBeVisible();
  } finally { await guest.close(); }
  expect(await query(`SELECT m.role FROM northstar_household_members m JOIN northstar_users u ON u.id = m.user_id WHERE u.email = 'casey@example.test'`)).toEqual([{role: 'member'}]);
});

test('removing a member cuts off their signed-in device at once and clears the household from it', async ({page, browser}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Open household settings'}).click();
  await page.getByPlaceholder('Invite by email').fill('riley@example.test');
  await page.getByRole('button', {name: 'Send invitation'}).click();
  await expect(page.getByRole('status').filter({hasText: 'Invitation emailed to riley@example.test'})).toBeVisible();
  const link = linkIn((await sentEmails())[0].text);

  const guest = await browser.newContext({storageState: {cookies: [], origins: []}});
  try {
    const member = await guest.newPage();
    await member.goto(link);
    await member.getByLabel('Choose a password').fill('riley-password-123');
    await member.getByRole('button', {name: 'Join household'}).click();
    await expect(member.getByRole('button', {name: 'Open household settings'})).toBeVisible();
    await expect.poll(() => member.evaluate(() => localStorage.getItem('northstar-state-cache-v1'))).not.toBeNull();

    // The member list was loaded before the invitation was accepted; reopen settings to reload it.
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    await page.getByRole('button', {name: 'Open household settings'}).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('listitem').filter({hasText: 'riley@example.test'}).getByRole('button', {name: 'Remove'}).click();
    await expect(page.getByRole('listitem').filter({hasText: 'riley@example.test'})).toHaveCount(0);

    // Their session cookie is still validly signed; membership is what the server checks.
    expect(await member.evaluate(async () => (await fetch('/api/hub')).status)).toBe(403);
    expect(await member.evaluate(async () => (await fetch('/api/hub', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({type: 'add', collection: 'inventory', id: 'sneaky', item: {name: 'Sneaky'}})})).status)).toBe(403);

    // The app's next poll (on focus here, rather than waiting out the 15-second timer).
    await member.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(member.getByRole('button', {name: 'Sign in'})).toBeVisible();
    expect(await member.evaluate(() => localStorage.getItem('northstar-state-cache-v1'))).toBeNull();
  } finally { await guest.close(); }
  expect(await query(`SELECT name FROM northstar_inventory`)).toEqual([]);
});

test.describe('signed out', () => {
  test.use({storageState: {cookies: [], origins: []}});

  test('a member who forgot their password can email themselves a reset link and sign in with the new password, which signs out every other device', async ({page, browser}) => {
    // Another device that is already signed in as this member, from before the reset.
    const otherDevice = await browser.newContext({storageState: storageStatePath});
    const otherPage = await otherDevice.newPage();
    await otherPage.goto('/');
    await expect(otherPage.getByRole('button', {name: 'Open household settings'})).toBeVisible();

    await page.goto('/');
    await page.getByRole('button', {name: 'Forgot password?'}).click();
    await page.getByLabel('Email').fill(environment().owner.email);
    await page.getByRole('button', {name: 'Email me a reset link'}).click();
    await expect(page.getByRole('status')).toContainText('a reset link is on its way');

    const [email] = await sentEmails();
    expect(email.to).toEqual([environment().owner.email]);
    await page.goto(linkIn(email.text));
    // Same password again, so the rest of the suite (login.spec.js) still signs in with it.
    await page.getByLabel('New password').fill(environment().owner.password);
    await page.getByRole('button', {name: 'Set new password'}).click();
    await expect(page.getByRole('button', {name: 'Open household settings'})).toBeVisible();

    // The device that reset is signed in with its fresh cookie; the other one is signed out
    // the next time it asks the server anything, even though its cookie has not expired.
    await page.reload();
    await expect(page.getByRole('button', {name: 'Open household settings'})).toBeVisible();
    await otherPage.reload();
    await expect(otherPage.getByRole('button', {name: 'Sign in'})).toBeVisible();
    await otherDevice.close();
  });

  test('asking for an address that is not a member looks the same and sends nothing', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Forgot password?'}).click();
    await page.getByLabel('Email').fill('stranger@example.test');
    await page.getByRole('button', {name: 'Email me a reset link'}).click();
    await expect(page.getByRole('status')).toContainText('a reset link is on its way');
    expect(await sentEmails()).toEqual([]);
  });
});

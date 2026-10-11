import { test, expect } from '../support/app.js';
import { environment } from '../support/environment.js';
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

test.describe('signed out', () => {
  test.use({storageState: {cookies: [], origins: []}});

  test('a member who forgot their password can email themselves a reset link and sign in with the new password', async ({page}) => {
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

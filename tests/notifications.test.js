import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { buildDailyDigest, digestSummaryText, weeklyDigestText } from '../shared/digest.js';
import { emailConfigured, sendEmail, digestWeekday, isDigestDay } from '../server/email.js';
import { pushConfigured, vapidPublicKey, sendPush } from '../server/push.js';
import { createHandler as createPushHandler } from '../api/push.js';
import { createHandler as createMembersHandler } from '../api/members.js';
import { createHandler as createBackupHandler } from '../api/backup.js';
import { emptyState } from '../shared/schema.js';
import { randomBytes } from 'node:crypto';

process.env.SESSION_SECRET = 'test-only-secret-with-more-than-32-characters';
process.env.DATABASE_URL = 'postgres://test-only/db';

function response() { return {code:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}}; }

// --- shared/digest.js ---
test('buildDailyDigest is null when nothing is overdue, expiring or due, and populated otherwise', () => {
  const now = new Date(2026, 0, 15);
  assert.equal(buildDailyDigest(emptyState(), now), null);
  const state = {
    ...emptyState(),
    reminders: [{id:'r1', title:'Rotate water', category:'Other', recurringDays:90, notes:'', startDate:'2025-01-01', lastCompletedDate:'', snoozedUntil:''}],
    inventory: [
      {id:'i1', name:'Bandages', quantity:1, unit:'units', category:'Gear', expiryDate:'2026-01-18', recurringDays:0, purchaseDate:''},
      {id:'i2', name:'Batteries', quantity:1, unit:'units', category:'Gear', expiryDate:'', recurringDays:30, purchaseDate:'2025-12-01'},
    ],
  };
  const digest = buildDailyDigest(state, now);
  assert.equal(digest.overdueReminders.length, 1);
  assert.equal(digest.expiringSupplies.length, 1);
  assert.equal(digest.dueRestocks.length, 1);
  assert.match(digestSummaryText(digest), /overdue reminder/);
  assert.match(digestSummaryText(digest), /expiring soon/);
  assert.match(digestSummaryText(digest), /due for restock/);
});

test('weeklyDigestText summarizes readiness stats without leaking item contents', () => {
  const text = weeklyDigestText({waterDays: 3.456, foodDays: 10, powerDays: 0, lowStock: 2, expired: 1});
  assert.match(text, /3\.5 days of supply/);
  assert.match(text, /2 items low on stock, 1 item expired/);
});

// --- server/email.js ---
test('emailConfigured requires both RESEND_API_KEY and EMAIL_FROM', () => {
  delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
  assert.equal(emailConfigured(), false);
  process.env.RESEND_API_KEY = 'key';
  assert.equal(emailConfigured(), false);
  process.env.EMAIL_FROM = 'noreply@example.com';
  assert.equal(emailConfigured(), true);
  delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
});

test('sendEmail no-ops when unconfigured, posts to the provider when configured, and throws on a bad response', async () => {
  assert.equal(await sendEmail({to:'a@example.com', subject:'s', text:'t'}), false);
  process.env.RESEND_API_KEY = 'key'; process.env.EMAIL_FROM = 'noreply@example.com';
  let captured = null;
  const fakeFetch = async (url, init) => { captured = {url, init}; return {ok: true}; };
  assert.equal(await sendEmail({to:'a@example.com', subject:'s', text:'t'}, fakeFetch), true);
  assert.equal(captured.url, 'https://api.resend.com/emails');
  assert.equal(JSON.parse(captured.init.body).to, 'a@example.com');
  assert.equal(captured.init.headers.Authorization, 'Bearer key');
  await assert.rejects(sendEmail({to:'a@example.com', subject:'s', text:'t'}, async () => ({ok: false, status: 500})));
  delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
});

test('digestWeekday defaults to Monday and honors an override; isDigestDay compares in UTC', () => {
  delete process.env.EMAIL_DIGEST_WEEKDAY;
  assert.equal(digestWeekday(), 1);
  process.env.EMAIL_DIGEST_WEEKDAY = '3';
  assert.equal(digestWeekday(), 3);
  assert.equal(isDigestDay(new Date(Date.UTC(2026, 0, 21))), true); // a Wednesday
  assert.equal(isDigestDay(new Date(Date.UTC(2026, 0, 22))), false);
  delete process.env.EMAIL_DIGEST_WEEKDAY;
});

// --- server/push.js ---
test('pushConfigured requires all three VAPID variables; vapidPublicKey reflects the configured key', () => {
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
  assert.equal(pushConfigured(), false);
  assert.equal(vapidPublicKey(), null);
  process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv';
  assert.equal(pushConfigured(), false);
  process.env.VAPID_SUBJECT = 'mailto:owner@example.com';
  assert.equal(pushConfigured(), true);
  assert.equal(vapidPublicKey(), 'pub');
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
});

test('sendPush skips when unconfigured, sends when configured, and reports a gone subscription instead of throwing', async () => {
  const subscription = {endpoint: 'https://push.example.com/abc', p256dh: 'p', auth: 'a'};
  assert.equal(await sendPush(subscription, {title: 't'}), 'skipped');
  process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv'; process.env.VAPID_SUBJECT = 'mailto:owner@example.com';
  let sent = null;
  const fakeClient = {setVapidDetails(){}, async sendNotification(sub, payload){ sent = {sub, payload}; }};
  assert.equal(await sendPush(subscription, {title: 't'}, fakeClient), 'sent');
  assert.equal(sent.sub.endpoint, subscription.endpoint);

  const goneClient = {setVapidDetails(){}, async sendNotification(){ const error = new Error('gone'); error.statusCode = 410; throw error; }};
  assert.equal(await sendPush(subscription, {title: 't'}, goneClient), 'gone');

  const brokenClient = {setVapidDetails(){}, async sendNotification(){ throw new Error('network error'); }};
  await assert.rejects(sendPush(subscription, {title: 't'}, brokenClient));
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
});

// --- api/push.js ---
test('push API requires auth and membership, reports config, and saves/removes subscriptions for the caller only', async () => {
  const saved = [];
  const repository = {
    async getMembership(userId) { return userId === 'user-1' ? {role: 'member'} : undefined; },
    async savePushSubscription(entry) { saved.push(entry); },
    async deletePushSubscriptionForUser(userId, endpoint) { saved.splice(0, saved.length, ...saved.filter(s => !(s.userId === userId && s.endpoint === endpoint))); },
  };
  const handler = createPushHandler(repository, () => ({userId: 'user-1'}));

  const unauthed = response();
  await createPushHandler(repository, () => false)({method: 'GET', headers: {}}, unauthed);
  assert.equal(unauthed.code, 401);

  const deniedMember = response();
  await createPushHandler(repository, () => ({userId: 'nobody'}))({method: 'GET', headers: {}}, deniedMember);
  assert.equal(deniedMember.code, 403);

  const configRes = response();
  await handler({method: 'GET', headers: {}}, configRes);
  assert.equal(configRes.data.configured, false);
  assert.equal(configRes.data.publicKey, null);

  const invalid = response();
  await handler({method: 'POST', headers: {'content-type': 'application/json'}, body: {subscription: {endpoint: 'e'}}}, invalid);
  assert.equal(invalid.code, 400);

  const saveRes = response();
  await handler({method: 'POST', headers: {'content-type': 'application/json'}, body: {subscription: {endpoint: 'https://push.example/1', keys: {p256dh: 'p', auth: 'a'}}}}, saveRes);
  assert.equal(saveRes.code, 200);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].userId, 'user-1');

  const crossSite = response();
  await handler({method: 'POST', headers: {'content-type': 'application/json', origin: 'https://evil.com', host: 'example.com'}, body: {subscription: {endpoint: 'e', keys: {p256dh: 'p', auth: 'a'}}}}, crossSite);
  assert.equal(crossSite.code, 403);

  const deleteRes = response();
  await handler({method: 'DELETE', headers: {'content-type': 'application/json'}, body: {endpoint: 'https://push.example/1'}}, deleteRes);
  assert.equal(deleteRes.code, 200);
  assert.equal(saved.length, 0);
});

// --- api/members.js: self-service digest opt-in and email side effects ---
test('members API lets any member set their own weekly-digest preference, and reports whether email is configured', async () => {
  let optIn = null;
  const repository = {
    async getMembership(userId) { return userId === 'member-1' ? {role: 'member'} : undefined; },
    async listMembers() { return []; },
    async listPendingInvitations() { return []; },
    async getEmailDigestOptIn() { return optIn ?? false; },
    async setEmailDigestOptIn(userId, value) { optIn = value; },
  };
  const handler = createMembersHandler(repository, () => ({userId: 'member-1'}));

  const set = response();
  await handler({method: 'POST', headers: {'content-type': 'application/json'}, body: {type: 'set-email-digest', optIn: true}}, set);
  assert.equal(set.code, 200);
  assert.equal(optIn, true);

  const list = response();
  await handler({method: 'GET', headers: {}}, list);
  assert.equal(list.data.emailDigestOptIn, true);
  assert.equal(list.data.emailConfigured, false);
});

test('members API emails the invite and reset links when a provider is configured, without changing the manual-link response', async () => {
  process.env.RESEND_API_KEY = 'key'; process.env.EMAIL_FROM = 'noreply@example.com';
  const sentEmails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sentEmails.push(JSON.parse(init.body)); return {ok: true}; };
  try {
    const repository = {
      async getMembership(userId) { return {'owner-1': {role: 'owner'}, 'member-1': {role: 'member'}}[userId]; },
      async createInvitation() { return 'inv-1'; },
      async createPasswordReset() {},
      async findUserById(userId) { return userId === 'member-1' ? {id: 'member-1', email: 'member@example.com'} : undefined; },
    };
    const handler = createMembersHandler(repository, () => ({userId: 'owner-1'}));

    const invited = response();
    await handler({method: 'POST', headers: {'content-type': 'application/json', origin: 'https://app.example.com', host: 'app.example.com'}, body: {type: 'invite', email: 'new@example.com', role: 'member'}}, invited);
    assert.equal(invited.code, 200);
    assert.ok(invited.data.token);
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, 'new@example.com');
    assert.match(sentEmails[0].text, /app\.example\.com\/\?invite=/);

    const reset = response();
    await handler({method: 'POST', headers: {'content-type': 'application/json', origin: 'https://app.example.com', host: 'app.example.com'}, body: {type: 'reset-link', userId: 'member-1'}}, reset);
    assert.equal(reset.code, 200);
    assert.ok(reset.data.token);
    assert.equal(sentEmails.length, 2);
    assert.equal(sentEmails[1].to, 'member@example.com');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
  }
});

test('members API still returns the invite link when the email provider fails', async () => {
  process.env.RESEND_API_KEY = 'key'; process.env.EMAIL_FROM = 'noreply@example.com';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ok: false, status: 500});
  try {
    const repository = {
      async getMembership() { return {role: 'owner'}; },
      async createInvitation() { return 'inv-1'; },
    };
    const handler = createMembersHandler(repository, () => ({userId: 'owner-1'}));
    const res = response();
    await handler({method: 'POST', headers: {'content-type': 'application/json'}, body: {type: 'invite', email: 'new@example.com', role: 'member'}}, res);
    assert.equal(res.code, 200);
    assert.ok(res.data.token);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
  }
});

// --- api/backup.js: failure email, push digest, weekly email digest ---
const noOffSite = {configured: () => false, upload: async () => {}, download: async () => undefined, remove: async () => {}};
process.env.CRON_SECRET = 'test-only-cron-secret';
process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString('base64');

test('backup cron emails owners when reading state fails, and still reports the failure', async () => {
  process.env.RESEND_API_KEY = 'key'; process.env.EMAIL_FROM = 'noreply@example.com';
  const sentEmails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sentEmails.push(JSON.parse(init.body)); return {ok: true}; };
  try {
    const repository = {
      async readState() { throw new Error('Database unavailable.'); },
      async insertBackupRecord() {},
      async listOwnerEmails() { return ['owner@example.com']; },
    };
    const res = response();
    await createBackupHandler(repository, undefined, noOffSite)({method: 'GET', headers: {authorization: 'Bearer test-only-cron-secret'}}, res);
    assert.equal(res.code, 500);
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, 'owner@example.com');
    assert.match(sentEmails[0].text, /Database unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
  }
});

test('backup cron sends a push digest to subscriptions when something is overdue, expiring or due, and prunes gone ones', async () => {
  process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv'; process.env.VAPID_SUBJECT = 'mailto:owner@example.com';
  const originalSend = webpush.sendNotification;
  const originalSetVapid = webpush.setVapidDetails;
  const sent = [];
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = async subscription => {
    sent.push(subscription.endpoint);
    if (subscription.endpoint === 'gone-endpoint') { const error = new Error('gone'); error.statusCode = 410; throw error; }
  };
  try {
    const state = {
      ...emptyState(),
      reminders: [{id: 'r1', title: 'Check radio', category: 'Other', recurringDays: 30, notes: '', startDate: '2020-01-01', lastCompletedDate: '', snoozedUntil: ''}],
    };
    const deleted = [];
    const repository = {
      async readState() { return {data: state, version: 1}; },
      async insertBackupRecord() { return 1; },
      async updateBackupOffSiteStatus() {},
      async pruneBackups() { return []; },
      async pruneRequestMetrics() {},
      async recordReadinessSnapshot() {},
      async pruneReadinessHistory() {},
      async listPushSubscriptions() { return [{endpoint: 'live-endpoint', p256dh: 'p', auth: 'a'}, {endpoint: 'gone-endpoint', p256dh: 'p', auth: 'a'}]; },
      async deletePushSubscription(endpoint) { deleted.push(endpoint); },
    };
    const res = response();
    await createBackupHandler(repository, undefined, noOffSite)({method: 'GET', headers: {authorization: 'Bearer test-only-cron-secret'}}, res);
    assert.equal(res.data.status, 'success');
    assert.deepEqual(sent.sort(), ['gone-endpoint', 'live-endpoint']);
    assert.deepEqual(deleted, ['gone-endpoint']);
  } finally {
    webpush.sendNotification = originalSend;
    webpush.setVapidDetails = originalSetVapid;
    delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
  }
});

test('backup cron skips the push digest entirely when nothing is due, and skips the weekly email off its scheduled day', async () => {
  process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv'; process.env.VAPID_SUBJECT = 'mailto:owner@example.com';
  process.env.RESEND_API_KEY = 'key'; process.env.EMAIL_FROM = 'noreply@example.com';
  // Pick a weekday that is never "today" in UTC for this test, so the email digest is skipped.
  const notToday = (new Date().getUTCDay() + 3) % 7;
  process.env.EMAIL_DIGEST_WEEKDAY = String(notToday);
  const originalSend = webpush.sendNotification;
  let pushCalled = false;
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = async () => { pushCalled = true; };
  const originalFetch = globalThis.fetch;
  let emailCalled = false;
  globalThis.fetch = async () => { emailCalled = true; return {ok: true}; };
  try {
    let subscriptionsQueried = false, recipientsQueried = false;
    const repository = {
      async readState() { return {data: emptyState(), version: 1}; },
      async insertBackupRecord() { return 1; },
      async updateBackupOffSiteStatus() {},
      async pruneBackups() { return []; },
      async pruneRequestMetrics() {},
      async recordReadinessSnapshot() {},
      async pruneReadinessHistory() {},
      async listPushSubscriptions() { subscriptionsQueried = true; return []; },
      async listDigestOptedInEmails() { recipientsQueried = true; return ['member@example.com']; },
    };
    const res = response();
    await createBackupHandler(repository, undefined, noOffSite)({method: 'GET', headers: {authorization: 'Bearer test-only-cron-secret'}}, res);
    assert.equal(res.data.status, 'success');
    assert.equal(pushCalled, false);
    // Nothing was due, so the digest is null and the subscription list is never even fetched.
    assert.equal(subscriptionsQueried, false);
    assert.equal(emailCalled, false);
    assert.equal(recipientsQueried, false);
  } finally {
    webpush.sendNotification = originalSend;
    globalThis.fetch = originalFetch;
    delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
    delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; delete process.env.EMAIL_DIGEST_WEEKDAY;
  }
});

test('backup cron sends the weekly readiness email to opted-in members on the scheduled day', async () => {
  process.env.RESEND_API_KEY = 'key'; process.env.EMAIL_FROM = 'noreply@example.com';
  process.env.EMAIL_DIGEST_WEEKDAY = String(new Date().getUTCDay());
  const sentEmails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sentEmails.push(JSON.parse(init.body)); return {ok: true}; };
  try {
    const repository = {
      async readState() { return {data: emptyState(), version: 1}; },
      async insertBackupRecord() { return 1; },
      async updateBackupOffSiteStatus() {},
      async pruneBackups() { return []; },
      async pruneRequestMetrics() {},
      async recordReadinessSnapshot() {},
      async pruneReadinessHistory() {},
      async listDigestOptedInEmails() { return ['member@example.com']; },
    };
    const res = response();
    await createBackupHandler(repository, undefined, noOffSite)({method: 'GET', headers: {authorization: 'Bearer test-only-cron-secret'}}, res);
    assert.equal(res.data.status, 'success');
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, 'member@example.com');
    assert.match(sentEmails[0].subject, /weekly/i);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; delete process.env.EMAIL_DIGEST_WEEKDAY;
  }
});

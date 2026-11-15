import test from 'node:test';
import assert from 'node:assert/strict';

// src/offline.js only touches localStorage when a function runs, so a Map-backed stand-in is enough.
const store = new Map();
globalThis.localStorage = {
  getItem: key => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: key => { store.delete(key); },
};
const offline = await import('../src/offline.js');
const QUEUE = 'northstar-action-queue-v1';
const REJECTED = 'northstar-rejected-actions-v1';
test.beforeEach(() => store.clear());

test('only a refusal that can never succeed is set aside; connection and server trouble stays queued', () => {
  for (const status of [400, 404, 410, 413, 422]) assert.equal(offline.isPermanentRejection(status), true, String(status));
  // 401 means sign in again, 403 an origin/permission problem, 408/425/429 are "try later", and 409 is a
  // conflict the server already retried against concurrent edits: none says the edit itself is bad.
  for (const status of [401, 403, 408, 409, 425, 429, 500, 502, 503, 504, undefined, null, 0, NaN]) assert.equal(offline.isPermanentRejection(status), false, String(status));
});

test('retry delays start short, grow, and stop at one minute', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10, 1000].map(offline.retryDelayMs), [2000, 5000, 15000, 60000, 60000, 60000, 60000]);
  assert.equal(offline.retryDelayMs(undefined), 2000);
  assert.equal(offline.retryDelayMs(-3), 2000);
});

test('a rejected edit leaves the queue so the edits behind it can sync, and keeps the reason it was refused', () => {
  offline.enqueueAction({type: 'add', collection: 'inventory', id: 'bad', item: {name: 'Bad', quantity: -5}});
  offline.enqueueAction({type: 'add', collection: 'inventory', id: 'good', item: {name: 'Good'}});
  assert.equal(offline.peekQueuedAction().id, 'bad');

  assert.equal(offline.rejectQueuedAction('Invalid data.'), 1);
  assert.equal(offline.peekQueuedAction().id, 'good', 'the next edit is now at the head');
  const [rejected] = offline.loadRejectedActions();
  assert.equal(rejected.message, 'Invalid data.');
  assert.equal(rejected.action.id, 'bad');
  assert.deepEqual(Object.keys(rejected.action).sort(), ['collection', 'id', 'item', 'type'], 'bookkeeping is not kept on the edit');
  assert.ok(rejected.id && rejected.rejectedAt);

  // Nothing queued: nothing to reject, and nothing invented.
  offline.shiftQueuedAction();
  assert.equal(offline.rejectQueuedAction('x'), 0);
  assert.equal(offline.loadRejectedActions().length, 1);
});

test('the server is sent the edit without the queue\'s own bookkeeping', () => {
  offline.enqueueAction({type: 'delete', collection: 'inventory', id: 'a'});
  const entry = offline.peekQueuedAction();
  assert.ok(entry.queuedAt && entry.queueId);
  assert.deepEqual(offline.actionBody(entry), {type: 'delete', collection: 'inventory', id: 'a'});
});

test('shifting the queue keeps an edit that was queued while the first was being sent', () => {
  offline.enqueueAction({type: 'add', collection: 'inventory', id: 'first', item: {name: 'First'}});
  const inFlight = offline.peekQueuedAction();
  offline.enqueueAction({type: 'add', collection: 'inventory', id: 'second', item: {name: 'Second'}});
  assert.equal(offline.shiftQueuedAction(), 1);
  assert.equal(inFlight.id, 'first');
  assert.deepEqual(offline.loadQueuedActions().map(entry => entry.id), ['second']);
});

test('trying a rejected edit again puts it at the back of the queue; discarding drops it', () => {
  offline.enqueueAction({type: 'update', collection: 'inventory', id: 'a', item: {quantity: -1}});
  offline.enqueueAction({type: 'add', collection: 'inventory', id: 'b', item: {name: 'B'}});
  offline.rejectQueuedAction('Nope.');
  const [{id}] = offline.loadRejectedActions();

  assert.equal(offline.retryRejectedAction(id), 2);
  assert.deepEqual(offline.loadQueuedActions().map(entry => entry.id), ['b', 'a']);
  assert.deepEqual(offline.loadRejectedActions(), []);
  assert.equal(offline.retryRejectedAction('missing'), 0);

  offline.rejectQueuedAction('Nope again.'); // 'b' this time
  const [again] = offline.loadRejectedActions();
  offline.discardRejectedAction(again.id);
  assert.deepEqual(offline.loadRejectedActions(), []);
  assert.equal(store.has(REJECTED), false, 'an empty list is not left behind in storage');
});

test('signing out clears rejected edits too, since they hold household data', async () => {
  offline.enqueueAction({type: 'add', collection: 'medications', id: 'm', item: {name: 'Insulin'}});
  offline.rejectQueuedAction('Nope.');
  assert.ok(store.has(REJECTED));
  await offline.clearDeviceData();
  assert.equal(store.has(REJECTED), false);
  assert.equal(store.has(QUEUE), false);
});

test('edits are described in plain words for the list of changes that could not be saved', () => {
  assert.equal(offline.describeAction({type: 'add', item: {name: 'Rice'}}), 'Add: Rice');
  assert.equal(offline.describeAction({type: 'delete', id: 'x'}), 'Delete');
  assert.equal(offline.describeAction({type: 'bulk_update'}), 'Change several items');
  assert.equal(offline.describeAction({type: 'something-new'}), 'Make a change');
  assert.equal(offline.describeAction(null), 'Make a change');
});

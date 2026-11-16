const STATE_KEY = 'northstar-state-cache-v1';
const QUEUE_KEY = 'northstar-action-queue-v1';
const REJECTED_KEY = 'northstar-rejected-actions-v1';
const CHECKIN_KEY = 'northstar-pending-checkin-v1';
const GRAB_KEY = 'northstar-grab-checks-v1';

function read(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function loadCachedState() {
  const cached = read(STATE_KEY, null);
  return cached && cached.data ? cached : null;
}

export function saveCachedState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({...state, savedAt: Date.now()}));
  } catch {
    // A private browsing session or a full storage quota should not block saves.
  }
}

// Signing out must not leave the household (including medications) readable on this device.
// Clears the cached state, any queued or rejected edits, and every Cache Storage entry the service worker
// holds, including API responses that versions before the shell-only worker cached.
export async function clearDeviceData() {
  try { for (const key of [STATE_KEY, QUEUE_KEY, REJECTED_KEY, CHECKIN_KEY, GRAB_KEY]) localStorage.removeItem(key); } catch { /* storage unavailable: nothing to clear */ }
  try { if (typeof caches !== 'undefined') await Promise.all((await caches.keys()).map(key => caches.delete(key))); } catch { /* best effort */ }
}

export function loadQueuedActions() {
  const queue = read(QUEUE_KEY, []);
  return Array.isArray(queue) ? queue : [];
}

export function saveQueuedActions(queue) {
  try {
    if (queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    throw new Error('Offline storage is unavailable. Download a backup before continuing.');
  }
}

export function enqueueAction(action) {
  const queue = loadQueuedActions();
  queue.push({...action, queuedAt: Date.now(), queueId: newId()});
  if (queue.length > 100) throw new Error('Offline queue is full. Reconnect before making more changes.');
  saveQueuedActions(queue);
  return queue.length;
}

// --- Retrying and rejecting queued edits. ---
// A queued edit fails for one of two very different reasons. The connection or the server was
// unavailable (no status, a 5xx, a timeout, a rate limit, or a conflict the server already
// retried): the edit is fine and must stay queued to try again. Or the server read it and said
// no, for good (400 invalid data, 404, 413...): sending it again can never succeed, and leaving
// it at the head of the queue would block every edit behind it. The second kind is moved out of
// the queue into a list the person can review, retry or discard.
const retryable = new Set([401, 403, 408, 409, 425, 429]);
export function isPermanentRejection(status) {
  return Number.isInteger(status) && status >= 400 && status < 500 && !retryable.has(status);
}

// How long to wait before the next try after `attempt` consecutive failures (0 for the first
// failure): quick at first, since most failures are a brief blip, then backing off to a minute.
const retryDelays = [2000, 5000, 15000, 60000];
export function retryDelayMs(attempt) {
  const index = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
  return retryDelays[Math.min(index, retryDelays.length - 1)];
}

// The queue stores bookkeeping alongside the action; the server should only see the action.
export function actionBody(entry) {
  const {queuedAt, queueId, ...action} = entry; // eslint-disable-line no-unused-vars
  return action;
}

// The oldest queued edit, or null.
export function peekQueuedAction() {
  return loadQueuedActions()[0] ?? null;
}

// Removes the oldest queued edit once the server has accepted it. Reads storage afresh instead
// of trusting an earlier copy, so an edit queued while this one was in flight is kept.
export function shiftQueuedAction() {
  const queue = loadQueuedActions();
  queue.shift();
  saveQueuedActions(queue);
  return queue.length;
}

export function loadRejectedActions() {
  const list = read(REJECTED_KEY, []);
  return Array.isArray(list) ? list : [];
}
function saveRejectedActions(list) {
  try {
    if (list.length) localStorage.setItem(REJECTED_KEY, JSON.stringify(list));
    else localStorage.removeItem(REJECTED_KEY);
  } catch { /* storage unavailable: the notice still shows for this session */ }
}
function newId() {
  try { return crypto.randomUUID(); } catch { return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
}

// Moves the oldest queued edit out of the queue into the rejected list, with the reason the
// server gave. Returns how many edits are still queued.
export function rejectQueuedAction(message) {
  const queue = loadQueuedActions();
  const entry = queue.shift();
  if (!entry) return queue.length;
  const rejected = loadRejectedActions();
  rejected.push({id: newId(), action: actionBody(entry), message: String(message || 'The server did not accept this change.'), rejectedAt: Date.now()});
  saveRejectedActions(rejected);
  saveQueuedActions(queue);
  return queue.length;
}

export function discardRejectedAction(id) {
  saveRejectedActions(loadRejectedActions().filter(entry => entry.id !== id));
}

// Puts a rejected edit back at the end of the queue to try again.
export function retryRejectedAction(id) {
  const entry = loadRejectedActions().find(candidate => candidate.id === id);
  if (!entry) return 0;
  const count = enqueueAction(entry.action);
  discardRejectedAction(id);
  return count;
}

// A short plain-language name for an edit, for the list of changes that could not be saved.
const actionVerbs = {
  add: 'Add', update: 'Change', delete: 'Delete', buy: 'Buy', consume: 'Record use of', delete_consumption: 'Remove a usage entry',
  bulk_delete: 'Delete several items', bulk_update: 'Change several items', plan: 'Update the family plan',
  settings: 'Update settings', import: 'Import a backup',
};
export function describeAction(action) {
  const verb = actionVerbs[action?.type] ?? 'Make a change';
  const name = typeof action?.item?.name === 'string' && action.item.name ? action.item.name : '';
  return name ? `${verb}: ${name}` : verb;
}

// A check-in sent while offline is held here (only the latest one matters) and sent on reconnect.
export function loadPendingCheckin() { return read(CHECKIN_KEY, null); }
export function savePendingCheckin(checkin) {
  try { if (checkin) localStorage.setItem(CHECKIN_KEY, JSON.stringify(checkin)); else localStorage.removeItem(CHECKIN_KEY); } catch { /* storage unavailable */ }
}

// Grab-list check-offs are per device and per event: `scope` is the activation's start time (or
// "drill"), so starting a new event starts with an unchecked list.
export function loadGrabChecks(scope) {
  const stored = read(GRAB_KEY, null);
  return stored && stored.scope === scope && Array.isArray(stored.ids) ? stored.ids : [];
}
export function saveGrabChecks(scope, ids) {
  try { localStorage.setItem(GRAB_KEY, JSON.stringify({scope, ids})); } catch { /* storage unavailable */ }
}

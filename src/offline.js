const STATE_KEY = 'northstar-state-cache-v1';
const QUEUE_KEY = 'northstar-action-queue-v1';
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
// Clears the cached state, any queued edits, and every Cache Storage entry the service worker
// holds, including API responses that versions before the shell-only worker cached.
export async function clearDeviceData() {
  try { for (const key of [STATE_KEY, QUEUE_KEY, CHECKIN_KEY, GRAB_KEY]) localStorage.removeItem(key); } catch { /* storage unavailable: nothing to clear */ }
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
  queue.push({...action, queuedAt: Date.now()});
  if (queue.length > 100) throw new Error('Offline queue is full. Reconnect before making more changes.');
  saveQueuedActions(queue);
  return queue.length;
}

export function clearQueuedActions() {
  saveQueuedActions([]);
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

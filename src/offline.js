const STATE_KEY = 'northstar-state-cache-v1';
const QUEUE_KEY = 'northstar-action-queue-v1';

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

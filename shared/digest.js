import { isReminderOverdue } from './reminders.js';
import { expirationQueue, isRecurringDue } from './readiness.js';

// How soon an expiry counts as "soon" for a daily digest, distinct from the wider rotation
// queue (30/60/90 days) shown in the app itself: a daily notification only earns its interruption
// for something that close.
const digestExpiryWindowDays = 7;

// Built from already-loaded household state for the daily push digest (see api/backup.js). Returns
// null when there is nothing to report, so a household with nothing overdue does not get a daily
// notification with nothing in it.
export function buildDailyDigest(state, now = new Date()) {
  const overdueReminders = (state.reminders || []).filter(reminder => isReminderOverdue(reminder, now));
  const expiringSupplies = expirationQueue(state.inventory || [], now, [digestExpiryWindowDays]);
  const dueRestocks = (state.inventory || []).filter(item => isRecurringDue(item, now));
  if (!overdueReminders.length && !expiringSupplies.length && !dueRestocks.length) return null;
  return {overdueReminders, expiringSupplies, dueRestocks};
}

function plural(count, noun) { return `${count} ${noun}${count === 1 ? '' : 's'}`; }

export function digestSummaryText(digest) {
  const parts = [];
  if (digest.overdueReminders.length) parts.push(`${plural(digest.overdueReminders.length, 'overdue reminder')}`);
  if (digest.expiringSupplies.length) parts.push(`${plural(digest.expiringSupplies.length, 'supply')} expiring soon`);
  if (digest.dueRestocks.length) parts.push(`${plural(digest.dueRestocks.length, 'item')} due for restock`);
  return parts.join(', ');
}

// The weekly readiness email, built from the same aggregate figures the Dashboard and the daily
// readiness snapshot already use — no item names or quantities, consistent with how that history
// is kept content-free (see README's Monitoring and alerts section).
export function weeklyDigestText(stats) {
  const round = value => Math.round(value * 10) / 10;
  return [
    `Water: ${round(stats.waterDays)} days of supply.`,
    `Food: ${round(stats.foodDays)} days of supply.`,
    `Power: ${round(stats.powerDays)} days of runtime.`,
    `${plural(stats.lowStock, 'item')} low on stock, ${plural(stats.expired, 'item')} expired.`,
    'Sign in to NorthStar Prep for details.',
  ].join(' ');
}

// The daily push digest: what needs attention today, as counts only. A lock-screen notification
// can be read by anyone holding the phone, so it never names items, medications or people --
// "2 medications due for refill" is useful; "Insulin for Sam" is not something to show there.
import { daysUntilExpiry, isExpired, isRecurringDue } from './readiness.js';
import { isMedicationRefillDue, isReminderOverdue } from './reminders.js';

export const expiringWithinDays = 7;

export function dailyDigest(state, now = new Date()) {
  const inventory = state.inventory ?? [];
  const counts = {
    overdueReminders: (state.reminders ?? []).filter(reminder => isReminderOverdue(reminder, now)).length,
    refillsDue: (state.medications ?? []).filter(medication => isMedicationRefillDue(medication, now)).length,
    expired: inventory.filter(item => isExpired(item.expiryDate, now)).length,
    expiringSoon: inventory.filter(item => { const days = daysUntilExpiry(item.expiryDate, now); return days !== null && days >= 0 && days <= expiringWithinDays; }).length,
    restockDue: inventory.filter(item => isRecurringDue(item, now)).length,
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    counts.overdueReminders && plural(counts.overdueReminders, 'maintenance reminder overdue', 'maintenance reminders overdue'),
    counts.refillsDue && plural(counts.refillsDue, 'medication due for refill', 'medications due for refill'),
    counts.expired && plural(counts.expired, 'item expired', 'items expired'),
    counts.expiringSoon && plural(counts.expiringSoon, `item expiring within ${expiringWithinDays} days`, `items expiring within ${expiringWithinDays} days`),
    counts.restockDue && plural(counts.restockDue, 'item due for restock', 'items due for restock'),
  ].filter(Boolean);
  if (!parts.length) return {counts, notification: null};
  // Deep-link to where most of the work is: reminders and refills live in the Family Hub,
  // everything else in the Supply Hub.
  const familyWork = counts.overdueReminders + counts.refillsDue;
  const supplyWork = counts.expired + counts.expiringSoon + counts.restockDue;
  return {
    counts,
    notification: {
      title: 'NorthStar Prep: needs attention',
      body: parts.join(' · '),
      tag: 'daily-digest',
      url: familyWork >= supplyWork ? '/?tab=plan' : '/?tab=inventory',
    },
  };
}

export function isoLocal(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function todayLocal(now = new Date()) { return isoLocal(now); }
export function addDaysISO(base, days) {
  const [y, m, d] = base.split('-').map(Number);
  return isoLocal(new Date(y, m - 1, d + Number(days)));
}
// A reminder recurs every recurringDays from its last completion, or from startDate if never completed.
export function nextReminderDueDate(reminder) {
  const base = reminder.lastCompletedDate || reminder.startDate;
  if (!base) return null;
  return addDaysISO(base, reminder.recurringDays || 0);
}
// A snooze postpones the due date; it can never bring it earlier than the recurrence would.
export function effectiveReminderDueDate(reminder) {
  const due = nextReminderDueDate(reminder);
  if (!due) return null;
  if (reminder.snoozedUntil && reminder.snoozedUntil > due) return reminder.snoozedUntil;
  return due;
}
export function isReminderOverdue(reminder, now = new Date()) {
  const due = effectiveReminderDueDate(reminder);
  if (!due) return false;
  return due <= isoLocal(now);
}
// A medication with no refill date on file is never "due" — there is nothing to compare against.
export function isMedicationRefillDue(medication, now = new Date()) {
  if (!medication.refillDate) return false;
  return medication.refillDate <= isoLocal(now);
}

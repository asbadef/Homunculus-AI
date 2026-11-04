// In-memory medication reminders for the demo (no device scheduling in M0).
export type Reminder = { drugId: string; time: string };

let store: Reminder[] = [];

export function addReminder(drugId: string, time: string): void {
  if (!store.some((r) => r.drugId === drugId && r.time === time)) {
    store.push({ drugId, time });
  }
}
export function listReminders(): Reminder[] {
  return [...store];
}
export function clearReminders(): void {
  store = [];
}

import { addReminder, listReminders, clearReminders } from "./reminders";

test("add a reminder then list it", () => {
  clearReminders();
  addReminder("p1", "20:00");
  expect(listReminders()).toEqual([{ drugId: "p1", time: "20:00" }]);
});

test("same drug+time is not duplicated", () => {
  clearReminders();
  addReminder("p1", "20:00");
  addReminder("p1", "20:00");
  expect(listReminders()).toHaveLength(1);
});

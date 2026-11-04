import { parseApptDate } from "./apptDate";

test("parses an Azerbaijani date + time", () => {
  const d = parseApptDate("28 Noyabr 2026", "14:30")!;
  expect(d.getFullYear()).toBe(2026);
  expect(d.getMonth()).toBe(10); // Noyabr = November = index 10
  expect(d.getDate()).toBe(28);
  expect(d.getHours()).toBe(14);
  expect(d.getMinutes()).toBe(30);
});

test("handles dotted-İ month (İyul)", () => {
  expect(parseApptDate("20 İyul 2026", "16:00")!.getMonth()).toBe(6);
});

test("returns null on a bad month", () => {
  expect(parseApptDate("1 Xyz 2026", "10:00")).toBeNull();
});

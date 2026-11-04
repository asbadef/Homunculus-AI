import { greetKey } from "./greeting";

test("greetKey picks the right band by hour", () => {
  expect(greetKey(new Date(2026, 0, 1, 8))).toBe("greet.morning");
  expect(greetKey(new Date(2026, 0, 1, 14))).toBe("greet.afternoon");
  expect(greetKey(new Date(2026, 0, 1, 21))).toBe("greet.evening");
});

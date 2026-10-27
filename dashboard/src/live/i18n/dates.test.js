import { describe, it, expect } from "vitest";
import { dayStamp, ddmm, ddmmhhmm, ddmmyyyy, hhmm, weekdayKey } from "./dates.js";
import { DICTIONARIES } from "./catalog.js";

// A local-time moment: 4 October 2026 is a Sunday.
const SUNDAY_EVENING = new Date(2026, 9, 4, 21, 5).getTime();

describe("the shell's dates", () => {
  it("writes 24-hour HH:MM, dd.MM and dd.MM.yyyy, zero-padded", () => {
    expect(hhmm(SUNDAY_EVENING)).toBe("21:05");
    expect(hhmm(new Date(2026, 0, 2, 7, 3).getTime())).toBe("07:03");
    expect(ddmm(SUNDAY_EVENING)).toBe("04.10");
    expect(ddmmyyyy(SUNDAY_EVENING)).toBe("04.10.2026");
  });

  it("names the weekday from the dictionary, in each language", () => {
    expect(weekdayKey(SUNDAY_EVENING)).toBe("dates.wd0");
    expect(DICTIONARIES.az["dates.wd0"]).toBe("B.");
    expect(DICTIONARIES.tr["dates.wd1"]).toBe("Pzt");
    expect(DICTIONARIES.ru["dates.wd6"]).toBe("Сб");
  });
});

describe("the day-aware stamp", () => {
  const MORNING_AFTER = new Date(2026, 9, 5, 8, 30).getTime();
  it("writes dd.MM hh:mm", () => {
    expect(ddmmhhmm(SUNDAY_EVENING)).toBe("04.10 21:05");
  });

  it("writes the time alone for a moment on the reader's own day, and the day and month for any other", () => {
    expect(dayStamp(SUNDAY_EVENING, new Date(2026, 9, 4, 23, 59).getTime())).toBe("21:05");
    expect(dayStamp(SUNDAY_EVENING, MORNING_AFTER)).toBe("04.10 21:05");
    // The same day and month a year apart is not today.
    expect(dayStamp(SUNDAY_EVENING, new Date(2027, 9, 4, 8, 0).getTime())).toBe("04.10 21:05");
  });
});

import { describe, it, expect } from "vitest";
import { ddmm, ddmmyyyy, hhmm, weekdayKey } from "./dates.js";
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

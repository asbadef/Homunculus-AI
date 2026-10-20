// How an instant, a mark and a value beside a reading are worded. The time labels are the chart's own
// (whenText), so a value or a mark that carries its own time says it the way the axis does.
import { describe, it, expect } from "vitest";
import { NOW } from "../../../data/board.testutil.js";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { markBeside, pointsText, valueBeside, whenText } from "./trendText.js";

const MINUTE = 60_000;
const t = (key) => ({ "patient.trendsMarkerAlarm": "siqnal", "patient.trendsMarkerAntibiotic": "antibiotik" })[key];

describe("trendText", () => {
  it("writes an instant as the chart's axis does — the date as well over three days", () => {
    expect(whenText(NOW, 24)).toBe(hhmm(NOW));
    expect(whenText(NOW, 6)).toBe(hhmm(NOW));
    expect(whenText(NOW, 72)).toBe(`${ddmm(NOW)} ${hhmm(NOW)}`);
  });

  it("gives a value its own time in parentheses when it reads differently from the reading it is beside", () => {
    const at = NOW - 60 * MINUTE;
    expect(valueBeside("64 mmHg", at - 75_000, at, 24)).toBe(`64 mmHg (${hhmm(at - 75_000)})`);
    expect(valueBeside("64 mmHg", at + 12_000, at, 24)).toBe("64 mmHg");            // the same minute: nothing added
    expect(valueBeside("64", at, at, 24)).toBe("64");
    // Over three days the date is part of the reading — a value a day away is not "the same time".
    expect(valueBeside("64", at - 24 * 60 * MINUTE, at, 72)).toBe(`64 (${whenText(at - 24 * 60 * MINUTE, 72)})`);
  });

  it("gives a mark its own time in the same way", () => {
    const at = NOW - 60 * MINUTE;
    const mark = { kind: "alarm", label: "news2", ms: at - 90_000 };
    expect(markBeside(t, mark, at, 24)).toBe(`siqnal: news2 (${hhmm(at - 90_000)})`);
    expect(markBeside(t, { ...mark, ms: at }, at, 24)).toBe("siqnal: news2");
    expect(markBeside(t, { kind: "antibiotic", ms: at }, at, 24)).toBe("antibiotik");
  });

  it("prints the engine's points as a column does: +n, 0, or a dash for none", () => {
    expect(pointsText(3)).toBe("+3");
    expect(pointsText(0)).toBe("0");
    expect(pointsText(null)).toBe("—");
    expect(pointsText(Number.NaN)).toBe("—");
    expect(pointsText(2.5)).toBe("—");
  });
});

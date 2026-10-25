// The monitor strip's display rules (Aşama A), pure: ages, cells, counts, sentences. No value is
// ever coloured, banded or judged here — a test below holds that the module has no threshold.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVIDENCE, PARAM_ORDER, PARTIAL, STATUS_KEY, UNIT_KEY, ageText, cellOf, chipCounts, displayAge, feedSentenceKey,
  lastSeenMs, linkSentenceKey, maxAgeOf, readAgeS, reasonKey,
} from "./monitor.js";
import { NBP_CHANGED_AT, param, strip, bed, unassigned } from "../../data/shadow.testutil.js";
import { createTranslator } from "../../i18n/translate.js";
import { DICTIONARIES } from "../../i18n/catalog.js";

const FETCHED = 1_000_000;

describe("ages and cells", () => {
  it("adds the time since the fetch to the server's age", () => {
    expect(displayAge(param("hr", 72, { age_s: 2 }), FETCHED + 3000, FETCHED)).toBe(5);
    expect(displayAge({ age_s: null }, FETCHED, FETCHED)).toBeNull();
  });

  it("does not know an age when this browser's clock is before the fetch (it was stepped back)", () => {
    expect(displayAge(param("hr", 72, { age_s: 2 }), FETCHED - 500, FETCHED)).toBeNull();
    expect(cellOf(param("hr", 72), { nowMs: FETCHED - 500, fetchedAtMs: FETCHED }).kind).toBe("old");
    expect(readAgeS(FETCHED + 2500, FETCHED)).toBe(2.5);
    expect(readAgeS(FETCHED - 1, FETCHED)).toBeNull();
    expect(readAgeS(FETCHED, null)).toBeNull();
  });

  it("draws a number only while it is fresh — 14.9 s is a value, 15.1 s is old and has none", () => {
    const at = (age) => cellOf(param("hr", 72, { age_s: age }), { nowMs: FETCHED, fetchedAtMs: FETCHED });
    expect(at(14.9)).toMatchObject({ kind: "value", value: 72 });
    expect(at(15.1)).toMatchObject({ kind: "old" });
    expect(at(15.1).value).toBeUndefined();
  });

  it("ages a value between polls: fresh at the fetch, old 6 s later", () => {
    const hr = param("hr", 72, { age_s: 10 });
    expect(cellOf(hr, { nowMs: FETCHED, fetchedAtMs: FETCHED }).kind).toBe("value");
    expect(cellOf(hr, { nowMs: FETCHED + 6000, fetchedAtMs: FETCHED }).kind).toBe("old");
  });

  it("shows the monitor's *** as invalid, the server's old as old, and nothing at all off a dead feed", () => {
    expect(cellOf(param("spo2", null), { nowMs: FETCHED, fetchedAtMs: FETCHED }).kind).toBe("invalid");
    expect(cellOf(param("hr", 72, { state: "old", value: null, age_s: 30 }), { nowMs: FETCHED, fetchedAtMs: FETCHED }).kind)
      .toBe("old");
    expect(cellOf(param("hr", 72), { nowMs: FETCHED, fetchedAtMs: FETCHED, feedOk: false }).kind).toBe("old");
    expect(cellOf(param("hr", 72), { nowMs: FETCHED, fetchedAtMs: FETCHED, maxAgeS: 1 }).kind).toBe("old");
  });

  it("writes an age in the board's own units, rounded up", () => {
    const az = createTranslator("az", DICTIONARIES);
    expect(ageText(az, 2.1)).toBe("3 san");
    expect(ageText(az, 120)).toBe("2 dəq");
    expect(ageText(az, null)).toBeNull();
  });
});

describe("NBP's cell: the time its value last changed", () => {
  const NBP = param("nbp", [118, 79, 92]);
  const at = (p, over = {}) => cellOf(p, { nowMs: FETCHED, fetchedAtMs: FETCHED, ...over });

  it("shows the three numbers with the time the value changed and how long ago that was", () => {
    expect(at(NBP)).toEqual({ kind: "nbp", systolic: 118, diastolic: 79, mean: 92,
      changedAtMs: Date.parse(NBP_CHANGED_AT), measuredAgeS: 600, ageS: 2 });
  });

  it("ages the change between polls, and goes old with its packet like any value", () => {
    expect(at(NBP, { nowMs: FETCHED + 3000 })).toMatchObject({ kind: "nbp", measuredAgeS: 603, ageS: 5 });
    expect(at(NBP, { nowMs: FETCHED + 14_000 })).toEqual({ kind: "old", ageS: 614, lastAt: NBP_CHANGED_AT });
    expect(at(NBP, { feedOk: false })).toEqual({ kind: "old", ageS: 600, lastAt: NBP_CHANGED_AT });
  });

  it("takes the server's withholding as it comes and judges no age itself", () => {
    // The 2-hour limit is the API's: an answer that says "value" three hours after the change is
    // drawn, and one that says "old" ten minutes after it is not.
    expect(at(param("nbp", [118, 79, 92], { measured_age_s: 10_800 })).kind).toBe("nbp");
    const withheld = param("nbp", null, { changed_at: NBP_CHANGED_AT, last_at: NBP_CHANGED_AT, age_s: 600, measured_age_s: 600 });
    expect(at(withheld)).toEqual({ kind: "old", ageS: 600, lastAt: NBP_CHANGED_AT });
    // A fresh packet that still carries numbers, which the server says are old: none is drawn.
    expect(at(param("nbp", [118, 79, 92], { state: "old" }))).toEqual({ kind: "old", ageS: 600, lastAt: NBP_CHANGED_AT });
  });

  it("never draws NBP's numbers without the age and the time of their change", () => {
    expect(at(param("nbp", [118, 79, 92], { measured_age_s: null }))).toEqual({ kind: "old", ageS: null, lastAt: NBP_CHANGED_AT });
    expect(at(param("nbp", [118, 79, 92], { changed_at: null }))).toEqual({ kind: "old", ageS: null, lastAt: null });
  });

  it("awaits a measurement when no change was seen: no number, no age, no time", () => {
    expect(at(param("nbp", null))).toEqual({ kind: "old", ageS: null, lastAt: null });
    expect(at(param("nbp", null), { nowMs: FETCHED - 500 })).toEqual({ kind: "old", ageS: null, lastAt: null });
  });

  it("shows the monitor's *** when it flags a component, and lets it go old with its packet", () => {
    const flagged = param("nbp", null, { state: "invalid", age_s: 2, last_at: NBP_CHANGED_AT, changed_at: NBP_CHANGED_AT,
      measured_age_s: 600 });
    expect(at(flagged)).toEqual({ kind: "invalid", ageS: 2 });
    // 14 s later its packet is 16 s old: the *** is no longer shown, and the age left is the change's.
    expect(at(flagged, { nowMs: FETCHED + 14_000 })).toEqual({ kind: "old", ageS: 614, lastAt: NBP_CHANGED_AT });
  });

  it("the test util refuses a wire name such as nbp_systolic", () => {
    expect(() => param("nbp_systolic", 118)).toThrow(TypeError);
  });

  it("does not lend its change time to a silent monitor's last-sent time", () => {
    const hr = param("hr", 72, { last_at: "2026-10-08T09:59:00+00:00" });
    const nbpNewer = param("nbp", [118, 79, 92], { last_at: "2026-10-08T09:59:30+00:00" });
    expect(lastSeenMs(bed("REA-01 · 2", [hr, nbpNewer], { status: "silent" }))).toBe(Date.parse("2026-10-08T09:59:00+00:00"));
    expect(lastSeenMs(bed("REA-01 · 2", [nbpNewer], { status: "silent" }))).toBeNull();
  });
});

describe("counts and sentences", () => {
  it("counts silent, waiting and unknown as silent, standby and unassigned on their own", () => {
    const data = strip({
      beds: [bed("REA-01 · 1"), bed("REA-01 · 2", [], { status: "silent" }), bed("REA-01 · 3", [], { status: "waiting" }),
        bed("REA-01 · 4", [], { status: "unknown" }), bed("REA-01 · 5", [], { status: "standby" })],
      unassigned: [unassigned("192.0.2.28"), unassigned("192.0.2.34", "not_in_table")],
    });
    expect(chipCounts(data)).toEqual({ total: 7, streaming: 1, silent: 3, standby: 3, unassigned: 2 });
    expect(chipCounts({ stage: "off" })).toBeNull();
  });

  it("counts nothing it was not told: a missing number is no count, never a zero", () => {
    const data = strip({ beds: [bed("REA-01 · 1")] });
    delete data.feed.devices.unknown;
    expect(chipCounts(data)).toBeNull();
    expect(chipCounts({ ...data, feed: { ...data.feed, unassigned: undefined } })).toBeNull();
  });

  it("names the feed's trouble, and nothing when it is ok", () => {
    expect(feedSentenceKey("ok")).toBeNull();
    expect(feedSentenceKey("never")).toBe("monitor.feedNever");
    expect(feedSentenceKey("forwarder_silent")).toBe("monitor.feedForwarder");
    expect(feedSentenceKey("collector_disconnected")).toBe("monitor.feedCollector");
    expect(feedSentenceKey("something new")).toBe("monitor.unreadable");     // cannot know: its own words
  });

  it("names a device status that replaces the values, and none for one that is streaming", () => {
    expect(STATUS_KEY.streaming).toBeUndefined();
    expect(STATUS_KEY).toEqual({ standby: "monitor.standby", silent: "monitor.silent", waiting: "monitor.waiting",
      unsupported: "monitor.unsupported", unknown: "monitor.unknown" });
  });

  it("says why a bed's monitor is on no patient, and why a device is on no bed", () => {
    expect(linkSentenceKey(bed("B", [], { link: "none" }))).toBe("monitor.noPatient");
    expect(linkSentenceKey(bed("B", [], { link: "ambiguous", link_reason: "two_patients" }))).toBe("monitor.ambiguous");
    expect(linkSentenceKey(bed("B", [], { link: "ambiguous", link_reason: "two_monitors" }))).toBe("monitor.ambiguousMonitors");
    expect(linkSentenceKey(bed("B", [], { link: "ambiguous" }))).toBe("monitor.ambiguous");
    expect(linkSentenceKey(bed("B", [], { link: "one", patient_id: "S-001" }))).toBeNull();
    expect(linkSentenceKey(bed("B", [], { link: "hidden" }))).toBeNull();
    expect(reasonKey("table_unassigned")).toBe("monitor.reasonUnassigned");
    expect(reasonKey("not_in_table")).toBe("monitor.reasonNotInTable");
    expect(reasonKey("table_missing")).toBe("monitor.reasonTable");
    expect(reasonKey("table_invalid")).toBe("monitor.reasonTable");
  });
});

describe("the display limit", () => {
  it("is the server's, but never longer than 15 s", () => {
    expect(maxAgeOf({ display_max_age_s: 10 })).toBe(10);
    expect(maxAgeOf({ display_max_age_s: 60 })).toBe(15);
    expect(maxAgeOf({})).toBe(15);
    expect(maxAgeOf({ display_max_age_s: "x" })).toBe(15);
  });
});

describe("the tables", () => {
  it("orders the parameters as the API does, NBP's one entry last", () => {
    expect(PARAM_ORDER).toEqual(["hr", "pls", "spo2", "etco2", "temperature", "art_systolic", "art_diastolic",
      "art_mean", "respiration", "nbp"]);
  });

  it("writes each unit with the board's own unit text", () => {
    expect(UNIT_KEY).toEqual({ bpm: "board.unitBpm", "/min": "board.unitBpm", "%": "board.unitPct",
      mmHg: "board.unitMmhg", C: "board.unitC" });
  });

  it("knows each parameter's evidence and partial mark as the API states them", () => {
    // The legend lists every parameter, including ones no card is showing; it reads this copy, which
    // is held to the API's own (homunculus-engine api/infinity_shadow.py EVIDENCE, PARTIAL).
    const py = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../homunculus-engine/src/homunculus/api/infinity_shadow.py"), "utf8");
    const evidence = Object.fromEntries([.../^EVIDENCE = \{([^}]*)\}/m.exec(py)[1].matchAll(/"(\w+)":\s*"(\w+)"/g)]
      .map((m) => [m[1], m[2]]));
    const partial = [.../^PARTIAL = frozenset\(\{([^}]*)\}\)/m.exec(py)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(EVIDENCE).toEqual(evidence);
    expect([...PARTIAL].sort()).toEqual(partial.sort());
    expect(Object.keys(EVIDENCE).sort()).toEqual([...PARAM_ORDER].sort());
  });

  it("holds no threshold, band or colour that depends on a value", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, "monitor.js"), "utf8");
    expect(source).not.toMatch(/text-(?:crit|high|mid|low|ok|v-)|bg-(?:crit|high|mid|low|ok)/);
    expect(source).not.toMatch(/value\s*[<>]=?\s*\d/);
    // X47, over the rules and over the strip that draws them (MonitorStrip.jsx's NbpValue and Cell):
    // no value, NBP part or age is compared with a number of the browser's own. The strip's colours
    // are held by its own sweep (MonitorStrip.test.jsx), since its header names `text-v-hr` as what
    // it never uses.
    for (const file of ["monitor.js", "MonitorStrip.jsx"]) {
      const code = fs.readFileSync(path.join(here, file), "utf8");
      expect(code, file).not.toMatch(/\b(?:value|systolic|diastolic|mean)\b\s*[<>]=?\s*\d|\d\s*[<>]=?\s*(?:value|systolic|diastolic|mean)\b/);
      expect(code, file).not.toMatch(/\b(?:ageS|measuredAgeS|age_s|measured_age_s)\b\s*[<>]=?\s*\d|\d\s*[<>]=?\s*(?:ageS|measuredAgeS|age_s|measured_age_s)\b/);
    }
  });
});

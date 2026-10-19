// The monitor strip's display rules (Aşama A), pure: ages, cells, counts, sentences. No value is
// ever coloured, banded or judged here — a test below holds that the module has no threshold.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PARAM_ORDER, STATUS_KEY, UNIT_KEY, ageText, cellOf, chipCounts, displayAge, feedSentenceKey, linkSentenceKey,
  reasonKey,
} from "./monitor.js";
import { param, strip, bed, unassigned } from "../../data/shadow.testutil.js";
import { createTranslator } from "../../i18n/translate.js";
import { DICTIONARIES } from "../../i18n/catalog.js";

const FETCHED = 1_000_000;

describe("ages and cells", () => {
  it("adds the time since the fetch to the server's age", () => {
    expect(displayAge(param("hr", 72, { age_s: 2 }), FETCHED + 3000, FETCHED)).toBe(5);
    expect(displayAge(param("hr", 72, { age_s: 2 }), FETCHED - 500, FETCHED)).toBe(2);   // never younger
    expect(displayAge({ age_s: null }, FETCHED, FETCHED)).toBeNull();
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

describe("the tables", () => {
  it("orders the parameters as the API does", () => {
    expect(PARAM_ORDER).toEqual(["hr", "pls", "spo2", "etco2", "temperature", "art_systolic", "art_diastolic",
      "art_mean", "respiration"]);
  });

  it("writes each unit with the board's own unit text", () => {
    expect(UNIT_KEY).toEqual({ bpm: "board.unitBpm", "/min": "board.unitBpm", "%": "board.unitPct",
      mmHg: "board.unitMmhg", C: "board.unitC" });
  });

  it("holds no threshold, band or colour that depends on a value", () => {
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "monitor.js"), "utf8");
    expect(source).not.toMatch(/text-(?:crit|high|mid|low|ok|v-)|bg-(?:crit|high|mid|low|ok)/);
    expect(source).not.toMatch(/value\s*[<>]=?\s*\d/);
  });
});

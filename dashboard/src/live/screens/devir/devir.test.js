// devir.test.js — the «Vardiya devri» screen's rules (G2-B3b, spec D5, D7, D9). Synthetic rows and alarms.
import { describe, it, expect } from "vitest";
import { alertsFromPatients, patientsFromBoard } from "../../../liveAdapters.js";
import { CONNECTION } from "../../../liveConnection.js";
import { alarm, board, entry } from "../../data/board.testutil.js";
import { NOTE_PARTS, PART_MAX, PART_MIN, emptyNote, groupHandovers, noteValid, openCriticalOnBoard } from "./devir.js";

describe("the D-Ö-D-Ö note", () => {
  it("is four empty parts, a fresh object each time", () => {
    expect(emptyNote()).toEqual({ situation: "", background: "", assessment: "", recommendation: "" });
    expect(Object.keys(emptyNote())).toEqual(NOTE_PARTS);
    const a = emptyNote();
    a.situation = "değişti";
    expect(emptyNote().situation).toBe("");
  });

  // D5: at least one part of 3 or more characters after trimming; each part at most 2000.
  it("is valid when one part, in any position, holds three characters after trimming", () => {
    expect(PART_MIN).toBe(3);
    expect(PART_MAX).toBe(2000);
    for (const part of NOTE_PARTS) {
      expect(noteValid({ ...emptyNote(), [part]: "abc" }), part).toBe(true);
      expect(noteValid({ ...emptyNote(), [part]: "  abc  " }), part).toBe(true);
    }
    expect(noteValid({ situation: "ab", background: "ab", assessment: "abc", recommendation: "" })).toBe(true);
  });

  it("is not valid when every part is empty, blank or shorter than three characters after trimming", () => {
    expect(noteValid(emptyNote())).toBe(false);
    expect(noteValid({ ...emptyNote(), situation: "     " })).toBe(false);
    expect(noteValid({ ...emptyNote(), situation: "  ab  " })).toBe(false);
    // short parts do not add up
    expect(noteValid({ situation: "ab", background: "ab", assessment: "ab", recommendation: "ab" })).toBe(false);
    // a letter among blanks is still one letter
    expect(noteValid({ ...emptyNote(), assessment: " \n a \t " })).toBe(false);
  });

  it("refuses a part over 2000 characters, even when another part is fine", () => {
    expect(noteValid({ ...emptyNote(), situation: "a".repeat(2000) })).toBe(true);
    expect(noteValid({ ...emptyNote(), situation: "a".repeat(2001) })).toBe(false);
    expect(noteValid({ ...emptyNote(), situation: "abc", recommendation: "a".repeat(2001) })).toBe(false);
  });

  // Python's len() — what the server measures — counts code points, JavaScript's .length counts UTF-16 units.
  it("counts characters as the server does: a code point is one", () => {
    expect(noteValid({ ...emptyNote(), situation: "😀".repeat(1000) })).toBe(true);
    expect(noteValid({ ...emptyNote(), situation: "😀".repeat(2001) })).toBe(false);
    expect(noteValid({ ...emptyNote(), situation: "😀😀😀" })).toBe(true);
  });

  it("is not valid for anything that is not a note, and ignores a part that is not text", () => {
    for (const odd of [null, undefined, "abc", 3, []]) expect(noteValid(odd), String(odd)).toBe(false);
    expect(noteValid({})).toBe(false);
    expect(noteValid({ situation: 12345, background: null, assessment: undefined, recommendation: ["abc"] })).toBe(false);
    expect(noteValid({ situation: 12345, background: "abc" })).toBe(true);
  });
});

describe("the critical alarms of one patient on the live board", () => {
  const alertsOf = (entries) => alertsFromPatients(patientsFromBoard(board(entries)));
  const live = (alerts) => ({ alerts, connection: CONNECTION.LIVE });

  it("counts the patient's critical alarms nobody acknowledged", () => {
    const alerts = alertsOf([
      entry("202600000001", [alarm("news2", "critical"), alarm("sepsis", "critical")]),
      entry("202600000002", [alarm("news2", "critical")]),
    ]);
    expect(openCriticalOnBoard(live(alerts), "202600000001")).toBe(2);
    expect(openCriticalOnBoard(live(alerts), "202600000002")).toBe(1);
  });

  it("does not count an acknowledged alarm, another severity, or another patient's alarm", () => {
    const alerts = alertsOf([
      entry("202600000001", [
        alarm("news2", "critical", { acknowledged: true, acknowledged_by: "u1", acknowledged_at: "2026-11-10T08:00:00Z" }),
        alarm("sepsis", "high"),
        alarm("hr", "moderate"),
        alarm("spo2", "low"),
        alarm("temp", "info"),
      ]),
      entry("202600000002", [alarm("news2", "critical")]),
    ]);
    expect(openCriticalOnBoard(live(alerts), "202600000001")).toBe(0);
    expect(openCriticalOnBoard(live(alerts), "202600000003")).toBe(0);
  });

  // G2-A1 (O17): a critical whose rule stopped before anyone answered it waits on the board until somebody does,
  // and the engine's gate (admission/boardlink.py count_open_critical) counts it like a firing one.
  it("counts a latched critical alarm — one whose rule stopped before it was acknowledged", () => {
    const alerts = alertsOf([entry("202600000001", [alarm("news2", "critical", { resolved_at: "2026-11-10T07:50:00Z" })])]);
    expect(alerts[0].status).toBe("RESOLVED");
    expect(openCriticalOnBoard(live(alerts), "202600000001")).toBe(1);
  });

  it("is asked by the board key, which is the alarm's patientId", () => {
    const alerts = alertsOf([entry("202600000001", [alarm("news2", "critical")])]);
    expect(alerts[0].patientId).toBe("202600000001");
    expect(openCriticalOnBoard({ alerts }, "202600000001")).toBe(1);
  });

  it("is zero for a board that holds nothing, and for a key that names nobody", () => {
    expect(openCriticalOnBoard(live([]), "202600000001")).toBe(0);
    for (const odd of [null, undefined, {}, { alerts: null }, { alerts: "x" }]) expect(openCriticalOnBoard(odd, "202600000001")).toBe(0);
    // an alarm with no patient is nobody's: it must not answer to a missing key
    const stray = [{ patientId: undefined, severity: "critical", ack: null }, { patientId: null, severity: "critical", ack: null }];
    for (const key of [undefined, null, ""]) expect(openCriticalOnBoard(live(stray), key), String(key)).toBe(0);
  });
});

describe("the handovers grouped for the screen", () => {
  const person = (id, name) => ({ id, name });
  const patient = { admission_id: "a-1", board_key: "202600000001", display_name: "Sentetik Hasta", bed_label: "YB-01", unit_name: "YBÜ" };
  const row = (id, status, over = {}) => ({
    id, status, created_at: "2026-11-10T06:00:00Z", bridge_expires_at: "2026-11-10T06:30:00Z",
    outgoing_signed_at: null, incoming_signed_at: null,
    outgoing: person("u-1", "Sentetik Giden"), incoming: person("u-2", "Sentetik Gelen"),
    patients: [patient], note: null, summary: null, ...over,
  });
  const ids = (rows) => rows.map((r) => r.id);

  it("lists what waits for my countersignature, the one signed longest ago first", () => {
    const { toCountersign } = groupHandovers({
      incoming: [
        row("new", "OUTGOING_SIGNED", { outgoing_signed_at: "2026-11-10T08:00:00Z" }),
        row("old", "OUTGOING_SIGNED", { outgoing_signed_at: "2026-11-10T06:10:00Z" }),
        row("mid", "OUTGOING_SIGNED", { outgoing_signed_at: "2026-11-10T07:00:00Z" }),
        row("not-yet", "OPEN"),
        row("done", "COMPLETED", { outgoing_signed_at: "2026-11-10T05:00:00Z", incoming_signed_at: "2026-11-10T05:05:00Z" }),
      ],
      outgoing: [],
    });
    expect(ids(toCountersign)).toEqual(["old", "mid", "new"]);
  });

  it("lists my open handovers, and the ones waiting for the other's signature, apart", () => {
    const { mineOpen, mineWaiting, toCountersign } = groupHandovers({
      incoming: [],
      outgoing: [
        row("open-1", "OPEN"),
        row("waiting-1", "OUTGOING_SIGNED", { outgoing_signed_at: "2026-11-10T07:00:00Z" }),
        row("open-2", "OPEN"),
        row("done", "COMPLETED"),
      ],
    });
    expect(ids(mineOpen)).toEqual(["open-1", "open-2"]);
    expect(ids(mineWaiting)).toEqual(["waiting-1"]);
    // a handover I gave is never one I countersign
    expect(toCountersign).toEqual([]);
  });

  it("puts the finished and the lapsed of both boxes into one list, the newest first", () => {
    const { recent } = groupHandovers({
      incoming: [
        row("in-done", "COMPLETED", { outgoing_signed_at: "2026-11-10T05:00:00Z", incoming_signed_at: "2026-11-10T05:10:00Z" }),
        row("in-wait", "OUTGOING_SIGNED", { outgoing_signed_at: "2026-11-10T05:00:00Z" }),
      ],
      outgoing: [
        row("out-done", "COMPLETED", { outgoing_signed_at: "2026-11-10T07:00:00Z", incoming_signed_at: "2026-11-10T07:20:00Z" }),
        row("out-lapsed", "EXPIRED", { created_at: "2026-11-10T06:00:00Z", bridge_expires_at: "2026-11-10T06:30:00Z" }),
        row("out-open", "OPEN"),
      ],
    });
    expect(ids(recent)).toEqual(["out-done", "out-lapsed", "in-done"]);
  });

  it("keeps the rows themselves, not copies with fields dropped", () => {
    const r = row("x", "COMPLETED", { note: { situation: "Sentetik not" }, summary: { risk: "high" } });
    const { recent } = groupHandovers({ incoming: [r], outgoing: [] });
    expect(recent[0]).toBe(r);
  });

  it("gives empty groups for an input that is not two lists", () => {
    const empty = { toCountersign: [], mineOpen: [], mineWaiting: [], recent: [] };
    expect(groupHandovers({ incoming: null, outgoing: undefined })).toEqual(empty);
    expect(groupHandovers({ incoming: "x", outgoing: {} })).toEqual(empty);
    expect(groupHandovers({})).toEqual(empty);
    expect(groupHandovers()).toEqual(empty);
    expect(groupHandovers(null)).toEqual(empty);
  });

  it("ignores an entry that is not a row, and a status this build does not know", () => {
    const g = groupHandovers({
      incoming: [null, "x", row("odd", "SOMETHING_NEW"), row("ok", "OUTGOING_SIGNED", { outgoing_signed_at: "2026-11-10T07:00:00Z" })],
      outgoing: [undefined, row("o", "OPEN")],
    });
    expect(ids(g.toCountersign)).toEqual(["ok"]);
    expect(ids(g.mineOpen)).toEqual(["o"]);
    expect(g.recent).toEqual([]);
  });
});

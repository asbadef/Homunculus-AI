// src/live/screens/patient/readings/ReadingsBox.test.jsx — the patient screen's «Ölçüm kaydı» box (G3-05 D16) and
// its «Düzelt» (D13). Synthetic values only (readings.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW, board, entry } from "../../../data/board.testutil.js";
import { dayStamp } from "../../../i18n/dates.js";
import { RETRACT_ARM_MS } from "../../common/RetractDialog.jsx";
import { HAND_AT, LATE_AT, MIN, ROUND_AT, emptyReadings, readings } from "./readings.testutil.js";
import { ReadingsBox } from "./ReadingsBox.jsx";
import { READINGS_POLL_MS } from "./useReadings.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const CHART = ["board.view", "clinical.chart"];
const BED = "REA-01 · 2";
const WHY = "manşet yanlış koldaydı, yeniden ölçüldü";

/** The box on its own, on a session holding `perms`, reading `answer` for whichever patient and window it asks. */
async function open({ perms = CHART, answer = readings, id = "S-001", host = null, setup, onWritten = vi.fn() } = {}) {
  const ui = host ?? <ReadingsBox patientId={id} bed={BED} nowMs={NOW} canChart={perms.includes("clinical.chart")} onWritten={onWritten} />;
  const mounted = await mount(ui, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      api.boardPatients.mockResolvedValue(board([entry("S-001")]));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.patientReadings.mockImplementation((pid, hours) => Promise.resolve(answer(pid, hours)));
      api.retractEntry.mockResolvedValue({ retracted: 422, code: "sbp", alerts: [] });
      api.chart.mockResolvedValue({ patient_id: "S-001", charted: 1, alerts: [], entries: [{ code: "sbp", entry: 501 }] });
      setup?.(api);
    },
  });
  await act(async () => { await settle(); });
  return { ...mounted, onWritten };
}

const sets = () => [...document.querySelectorAll("[data-set]")];
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
const type = (el, text) => act(async () => { fireEvent.change(el, { target: { value: text } }); await settle(); });
const arm = () => act(async () => { vi.advanceTimersByTime(RETRACT_ARM_MS + 1); await settle(); });
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);
const correctButtons = () => screen.queryAllByRole("button", { name: "Düzəlt" });

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the measurement record — what was measured, and by what", () => {
  it("reads the patient's 24 hours on mount and lists the sets newest first, each with its source", async () => {
    const { api } = await open();
    expect(api.patientReadings).toHaveBeenCalledWith("S-001", 24);
    expect(screen.getByRole("heading", { level: 2, name: "Ölçmə qeydi" })).toBeInTheDocument();
    expect(sets()).toHaveLength(3);
    expect(sets()[0]).toHaveTextContent(dayStamp(HAND_AT, NOW));
    expect(sets()[0]).toHaveTextContent("əl ilə · hem.ayse");
    expect(sets()[1]).toHaveTextContent(dayStamp(ROUND_AT, NOW));
    expect(sets()[1]).toHaveTextContent("cihazdan · CONNEX-3A");
    expect(sets()[1]).toHaveTextContent("Nəbz");
    expect(sets()[1]).toHaveTextContent("88 /dəq");
    expect(sets()[1]).toHaveTextContent("36,8 °C");
  });

  it("says «alındı» only where the engine marks the arrival as late", async () => {
    await open();
    expect(sets()[2]).toHaveTextContent(`qəbul edildi ${dayStamp(LATE_AT + 30 * MIN, NOW)}`);
    expect(sets()[1]).not.toHaveTextContent("qəbul edildi");
    expect(sets()[0]).not.toHaveTextContent("qəbul edildi");
  });

  it("keeps a withdrawn value, struck through, with its reason, who and when — and offers no «Düzelt» on it", async () => {
    await open();
    const struck = sets()[1].querySelector("[data-reading='22']");
    expect(struck.querySelector("s")).toHaveTextContent("188 mmHg");
    expect(struck).toHaveTextContent(`səhv qeyd — manşet yanlış koldaydı · hem.ayse · ${dayStamp(ROUND_AT + 8 * MIN, NOW)}`);
    expect(within(struck).queryByRole("button")).toBeNull();
    // the other values of the set are not struck
    expect(sets()[1].querySelector("[data-reading='21'] s")).toBeNull();
  });

  it("offers the three windows and reads again for the one chosen", async () => {
    const { api } = await open();
    const window = within(screen.getByRole("group", { name: "Dövr" }));
    expect(window.getByRole("button", { name: "24 saat" })).toHaveAttribute("aria-pressed", "true");
    await press(window.getByRole("button", { name: "7 gün" }));
    expect(api.patientReadings).toHaveBeenLastCalledWith("S-001", 168);
    expect(window.getByRole("button", { name: "7 gün" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says so when the window holds nothing, and why when the read fails — keeping the last answer", async () => {
    const { api } = await open({ answer: emptyReadings });
    expect(screen.getByText("Bu dövrdə ölçmə qeydi yoxdur.")).toBeInTheDocument();
    cleanup();
    const again = await open();
    again.api.patientReadings.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor"));
    await act(async () => { vi.advanceTimersByTime(READINGS_POLL_MS); await settle(); });
    expect(screen.getByText(/^Ölçmə qeydi oxunmadı: /)).toBeInTheDocument();
    expect(sets()).toHaveLength(3);                       // the last answer stays beside the note
    expect(api.patientReadings).toHaveBeenCalled();
  });

  it("reads again once a minute", async () => {
    const { api } = await open();
    const before = api.patientReadings.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(READINGS_POLL_MS); await settle(); });
    expect(api.patientReadings.mock.calls.length).toBe(before + 1);
  });

  it("never shows another patient's record: a move shows nothing until that patient answers", async () => {
    let release;
    const answer = (pid, hours) => (pid === "S-002" ? new Promise((resolve) => { release = () => resolve(readings(pid, hours)); }) : readings(pid, hours));
    function Host() {
      const [id, setId] = React.useState("S-001");
      return (<><button type="button" onClick={() => setId("S-002")}>move</button>
        <ReadingsBox patientId={id} bed={BED} nowMs={NOW} canChart /></>);
    }
    await open({ host: <Host />, answer });
    expect(sets()).toHaveLength(3);
    await press(screen.getByRole("button", { name: "move" }));
    expect(sets()).toHaveLength(0);
    expect(screen.getByText("Ölçmə qeydi oxunur…")).toBeInTheDocument();
    await act(async () => { release(); await settle(); });
    expect(sets()).toHaveLength(3);
  });

  it("an answer that is not this patient's record for this window is not shown", async () => {
    await open({ answer: () => ({ patient_id: "S-999", hours: 24, sets: [] }) });
    expect(screen.getByText(/^Ölçmə qeydi oxunmadı: /)).toBeInTheDocument();
    expect(sets()).toHaveLength(0);
  });
});

describe("«Düzelt» — who is offered it, and on what", () => {
  it("is absent without clinical.chart — never a disabled button", async () => {
    await open({ perms: ["board.view"] });
    expect(correctButtons()).toHaveLength(0);
  });

  it("is offered on each bedside value that is not withdrawn and has an engine entry", async () => {
    const answer = (pid, hours) => {
      const base = readings(pid, hours);
      const sets2 = base.sets.map((s, i) => (i === 2 ? { ...s, readings: [{ ...s.readings[0], entry: null }] } : s));
      return { ...base, sets: sets2 };
    };
    await open({ answer });
    // 1 hand value + 3 of the round's 4 (one is withdrawn); the last set's value has no entry.
    expect(correctButtons()).toHaveLength(4);
  });

  it("is not offered on a value the bedside form does not chart", async () => {
    const answer = (pid, hours) => readings(pid, hours, { sets: [{ ...readings().sets[2],
      readings: [{ id: 91, code: "lactate", value: 2.1, unit: "mmol/L", origin: "device", source: "LAB", recorded_by: null, entry: 491, voided: null }] }] });
    await open({ answer });
    expect(sets()[0]).toHaveTextContent("2,1");
    expect(correctButtons()).toHaveLength(0);
  });
});

describe("«Düzelt» — the dialog", () => {
  async function openDialog(extra) {
    const mounted = await open(extra);
    await press(within(sets()[1].querySelector("[data-reading='21']")).getByRole("button", { name: "Düzəlt" }));
    return mounted;
  }
  const dialog = () => screen.getByRole("dialog");
  const reasonBox = () => within(dialog()).getByLabelText(/^Səbəb/);
  const valueBox = () => within(dialog()).getByLabelText(/^Düzgün dəyər · Nəbz/);
  const confirm = () => press(within(dialog()).getByRole("button", { name: "Düzəlt" }));

  it("says which value, of which source, before anything is sent", async () => {
    const { api } = await openDialog();
    expect(within(dialog()).getByRole("heading", { name: `Düzəlt · ${BED}` })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent(`Nəbz: 88 /dəq · ölçmə ${dayStamp(ROUND_AT, NOW)} · cihazdan · CONNEX-3A`);
    expect(dialog()).toHaveTextContent("üstündən xətt çəkilmiş");
    expect(api.retractEntry).not.toHaveBeenCalled();
  });

  it("withdraws first, then charts the right value by hand at the reading's own time", async () => {
    const { api, onWritten } = await openDialog();
    const order = [];
    api.retractEntry.mockImplementation(() => { order.push("retract"); return Promise.resolve({ retracted: 421, code: "heart_rate", alerts: [] }); });
    api.chart.mockImplementation(() => { order.push("chart"); return Promise.resolve({ patient_id: "S-001", charted: 1, alerts: [], entries: [] }); });
    await arm();
    await type(reasonBox(), WHY);
    await type(valueBox(), "78");
    await confirm();
    expect(order).toEqual(["retract", "chart"]);
    expect(api.retractEntry).toHaveBeenCalledWith("S-001", 421, WHY);
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "heart_rate", value: 78 }], new Date(ROUND_AT).toISOString());
    expect(toasted(`${BED}: Nəbz düzəldildi.`).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onWritten).toHaveBeenCalledWith("S-001");
    expect(api.patientReadings.mock.calls.length).toBeGreaterThan(1);   // the box read again
  });

  it("with no right value typed it only withdraws", async () => {
    const { api } = await openDialog();
    await arm();
    await type(reasonBox(), WHY);
    await confirm();
    expect(api.retractEntry).toHaveBeenCalledTimes(1);
    expect(api.chart).not.toHaveBeenCalled();
    expect(toasted(`${BED}: Nəbz səhv qeyd kimi işarələndi.`).length).toBeGreaterThan(0);
  });

  it("waits for a reason of ten characters and for the arming window, and holds back a value out of range", async () => {
    const { api } = await openDialog();
    await type(reasonBox(), WHY);
    await confirm();                                        // inside the arming window: ignored
    expect(api.retractEntry).not.toHaveBeenCalled();
    await arm();
    await type(reasonBox(), "kısa");
    await confirm();
    expect(api.retractEntry).not.toHaveBeenCalled();
    await type(reasonBox(), WHY);
    await type(valueBox(), "900");
    await confirm();
    expect(api.retractEntry).not.toHaveBeenCalled();
    expect(dialog()).toHaveTextContent("0–300 aralığında olmalıdır.");
  });

  it("a withdrawal that landed and a chart that did not says which half happened", async () => {
    const { api } = await openDialog({ setup: (a) => { a.chart.mockRejectedValue(refusal(400, "ölçüm saati en çok 24 saat geriye alınabilir")); } });
    await arm();
    await type(reasonBox(), WHY);
    await type(valueBox(), "78");
    await confirm();
    expect(api.retractEntry).toHaveBeenCalledTimes(1);
    const said = toasted(/^REA-01 · 2: səhv dəyər işarələndi, lakin düzgün dəyər yazılmadı — /);
    expect(said.length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a refused withdrawal charts nothing and says the engine's reason", async () => {
    const { api } = await openDialog({ setup: (a) => { a.retractEntry.mockRejectedValue(refusal(409, "taburcu edilmiş bir hastada değer geri alınamaz")); } });
    await arm();
    await type(reasonBox(), WHY);
    await type(valueBox(), "78");
    await confirm();
    expect(api.chart).not.toHaveBeenCalled();
    expect(toasted(/^REA-01 · 2: düzəldilmədi — /).length).toBeGreaterThan(0);
  });

  it("offers no right-value box for a reading older than 24 hours, and says why", async () => {
    const old = NOW - 26 * 60 * MIN;
    const answer = (pid, hours) => readings(pid, hours, { sets: [{ ...readings().sets[1], observed_at: new Date(old).toISOString() }] });
    const { api } = await open({ answer });
    await press(within(sets()[0].querySelector("[data-reading='21']")).getByRole("button", { name: "Düzəlt" }));
    expect(within(dialog()).queryByLabelText(/^Düzgün dəyər/)).toBeNull();
    expect(dialog()).toHaveTextContent("Ölçmə 24 saatdan köhnədir");
    await arm();
    await type(reasonBox(), WHY);
    await confirm();
    expect(api.retractEntry).toHaveBeenCalledTimes(1);
    expect(api.chart).not.toHaveBeenCalled();
  });
});

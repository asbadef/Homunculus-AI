// IsolationBox.test.jsx — the patient screen's «İzolyasiya» box (G4-05, spec D16 as §5 S2, A1, M2, M8 amend it): the
// state line in its three words and, while the board is not LIVE, none that says «yoxdur»; the last record's time; the
// four boxes seeded from the card and sent all four, in order, with no time; busy and announced; every answer — saved,
// a discharged number, a refusal naming the bed, no answer (and a board read again), the session changed, superseded;
// the draft kept on failure; a newer record holds the save; a move to another patient resets the box; no key, no box.
// The default language is az. Synthetic ids only.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { dayStamp } from "../../i18n/dates.js";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { NOW } from "../../data/board.testutil.js";
import { IsolationBox, seedOf } from "./IsolationBox.jsx";

const T1 = new Date(NOW - 80 * 60_000).toISOString();
const T2 = new Date(NOW - 5 * 60_000).toISOString();
const ISOLATED = { contact: true, droplet: true, airborne: false, protective: null, types: ["contact", "droplet"],
  state: "isolated", charted_at: T1 };
const NOT_ISOLATED = { contact: false, droplet: false, airborne: false, protective: false, types: [],
  state: "not_isolated", charted_at: T1 };
const ORDER = ["isolation_contact", "isolation_droplet", "isolation_airborne", "isolation_protective"];
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A host that can hand the box a new card or move it to another patient, as the shell does (it stays mounted). */
function Host({ initial, chart, refresh }) {
  const [props, setProps] = React.useState(initial);
  Host.set = setProps;
  return <IsolationBox bed="REA-01 · 2" canChart known nowMs={NOW} onChart={chart} onRefresh={refresh} {...props} />;
}

async function open({ isolation = ISOLATED, patientId = "S-001", known = true, canChart = true, chart, refresh } = {}) {
  const onChart = chart ?? vi.fn().mockResolvedValue({ patient_id: patientId, charted: 4, alerts: [] });
  const onRefresh = refresh ?? vi.fn();
  await mount(<Host initial={{ patientId, isolation, known, canChart }} chart={onChart} refresh={onRefresh} />, {
    access: token({ perms: ["board.view", "clinical.chart"] }), me: profile({ perms: ["board.view", "clinical.chart"] }),
  });
  await act(async () => { await settle(); });
  return { onChart, onRefresh };
}
const box = () => screen.getByRole("heading", { name: "İzolyasiya" }).closest("div.rounded-box");
const boxes = () => within(box()).queryAllByRole("checkbox");
const ticked = () => boxes().map((input) => input.checked);
const press = (name) => act(async () => { fireEvent.click(within(box()).getByRole("button", { name })); await settle(); });
const toasts = () => within(screen.getByRole("region", { name: "Bildirişlər" }));
const SAVE = "İzolyasiyanı yadda saxla";

beforeEach(() => { vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the state line and the last record", () => {
  it("says the types of an isolated patient, and when it was last recorded — never by whom (§5 S2)", async () => {
    await open();
    expect(within(box()).getByRole("note").textContent).toBe("İzolyasiya: Təmas · Damcı");
    expect(within(box()).getByText(`Son qeyd: ${dayStamp(Date.parse(T1), NOW)}`)).toBeInTheDocument();
  });

  it("tells «no isolation on record» from «nothing ever recorded», and says nothing of a last record without one", async () => {
    await open({ isolation: NOT_ISOLATED });
    expect(within(box()).getByRole("note").textContent).toBe("Açıq izolyasiya qeydi yoxdur: son qeyddə heç bir növ işarələnməyib.");
    cleanup();
    await open({ isolation: null });
    expect(within(box()).getByRole("note").textContent)
      .toBe("İzolyasiya qeydi yoxdur: bu xəstə üçün bu sistemə heç vaxt izolyasiya qeyd edilməyib.");
    expect(box().querySelector("[data-last-record]")).toBeNull();
  });

  it("says no «yoxdur» while the board is not LIVE, keeps an isolation's types, and holds the save", async () => {
    const { onChart } = await open({ isolation: NOT_ISOLATED, known: false });
    expect(within(box()).getByRole("note").textContent).toBe("İzolyasiya vəziyyəti göstərilə bilmir — panel aktual deyil.");
    expect(within(box()).getByText("Panel aktual deyil — qeyd üçün panelin yenidən qoşulmasını gözləyin.")).toBeInTheDocument();
    expect(within(box()).queryByRole("button", { name: SAVE })).toBeNull();
    expect(onChart).not.toHaveBeenCalled();
    cleanup();
    await open({ known: false });
    expect(within(box()).getByRole("note").textContent).toBe("İzolyasiya: Təmas · Damcı · panel aktual deyil");
  });
});

describe("the four boxes", () => {
  it("are seeded from the card: a flag charted true is ticked, false and never charted are not", async () => {
    await open();
    expect(within(box()).getAllByRole("checkbox").map((input) => input.closest("label").textContent))
      .toEqual(["Təmas", "Damcı", "Hava yolu", "Qoruyucu"]);
    expect(ticked()).toEqual([true, true, false, false]);
    expect(seedOf(null)).toEqual({ contact: false, droplet: false, airborne: false, protective: false });
  });

  it("send all four, in the engine's order, with no time", async () => {
    const { onChart } = await open();
    fireEvent.click(boxes()[2]);
    await press(SAVE);
    expect(onChart).toHaveBeenCalledTimes(1);
    expect(onChart).toHaveBeenCalledWith(ORDER.map((code, at) => ({ code, value: [1, 1, 1, 0][at] })));
    expect(toasts().getAllByText("İzolyasiya qeyd edildi.").length).toBeGreaterThan(0);
  });

  it("save four unticked boxes on a patient nobody recorded as «no isolation», and say so on the button", async () => {
    const { onChart } = await open({ isolation: null });
    await press("İzolyasiya yoxdur kimi yadda saxla");
    expect(onChart).toHaveBeenCalledWith(ORDER.map((code) => ({ code, value: 0 })));
    cleanup();
    await open({ isolation: NOT_ISOLATED });
    expect(within(box()).getByRole("button", { name: SAVE })).toBeInTheDocument();     // a record exists: plain «save»
  });

  it("are not drawn without clinical.chart, and the box says why", async () => {
    await open({ canChart: false });
    expect(boxes()).toEqual([]);
    expect(within(box()).getByText("Bu qeyd üçün səlahiyyətiniz çatmır (clinical.chart).")).toBeInTheDocument();
  });
});

describe("the answers (§5 M2)", () => {
  it("is busy while in flight, one save at a time, and says so", async () => {
    let land;
    const chart = vi.fn(() => new Promise((resolve) => { land = resolve; }));
    await open({ chart });
    await press(SAVE);
    await press(SAVE);
    expect(chart).toHaveBeenCalledTimes(1);
    expect(within(box()).getByRole("button", { name: SAVE }).getAttribute("aria-busy")).toBe("true");
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 700); }); });
    expect(within(box()).getByRole("status").textContent).toBe("İzolyasiya qeyd edilir…");
    await act(async () => { land({ charted: 4 }); await settle(); });
    expect(within(box()).getByRole("button", { name: SAVE }).getAttribute("aria-busy")).toBeNull();
  });

  it("names the bed, never the patient, on a refusal, and keeps the draft", async () => {
    const chart = vi.fn().mockRejectedValue(refusal(400, "isolation_contact: yalnız 0 veya 1 olabilir"));
    await open({ chart });
    fireEvent.click(boxes()[3]);
    await press(SAVE);
    expect(toasts().getAllByText(/^REA-01 · 2: izolyasiya qeyd edilmədi — /).length).toBeGreaterThan(0);
    expect(ticked()).toEqual([true, true, false, true]);
  });

  it("says a discharged number took nothing, and keeps the draft", async () => {
    await open({ chart: vi.fn().mockResolvedValue({ patient_id: "S-001", dropped: "discharged" }) });
    fireEvent.click(boxes()[3]);
    await press(SAVE);
    expect(toasts().getAllByText("REA-01 · 2 tərxis edilib; izolyasiya qeyd edilmədi.").length).toBeGreaterThan(0);
    expect(ticked()).toEqual([true, true, false, true]);
  });

  it("says a save with no answer may have landed, reads the board again once, and keeps the draft", async () => {
    for (const failure of [Object.assign(new Error("zaman aşımı"), { code: "REQUEST_TIMEOUT" }),
      Object.assign(new Error("Bad gateway"), { status: 503 }), new TypeError("Failed to fetch")]) {
      // eslint-disable-next-line no-await-in-loop
      const { onRefresh } = await open({ chart: vi.fn().mockRejectedValue(failure) });
      fireEvent.click(boxes()[3]);
      // eslint-disable-next-line no-await-in-loop
      await press(SAVE);
      expect(toasts().getAllByText(/^REA-01 · 2: cavab gəlmədi; qeyd edilmiş ola bilər/).length, failure.message).toBeGreaterThan(0);
      expect(onRefresh, failure.message).toHaveBeenCalledTimes(1);
      expect(ticked(), failure.message).toEqual([true, true, false, true]);
      cleanup();
    }
  });

  it("says nothing when the session changed or the request was superseded", async () => {
    for (const chart of [vi.fn().mockResolvedValue(null), vi.fn().mockRejectedValue(Object.assign(new Error("x"), { superseded: true }))]) {
      // eslint-disable-next-line no-await-in-loop
      await open({ chart });
      // eslint-disable-next-line no-await-in-loop
      await press(SAVE);
      expect(screen.getByRole("region", { name: "Bildirişlər" }).textContent).toBe("");
      cleanup();
    }
  });

  it("re-seeds from the reloaded card after a save, and not when the answer lands for a patient no longer shown", async () => {
    let land;
    const chart = vi.fn(() => new Promise((resolve) => { land = resolve; }));
    await open({ chart });
    fireEvent.click(boxes()[3]);
    await press(SAVE);
    act(() => { Host.set({ patientId: "S-002", isolation: NOT_ISOLATED, known: true, canChart: true }); });
    expect(ticked()).toEqual([false, false, false, false]);           // the next patient's own card
    fireEvent.click(boxes()[0]);
    await act(async () => { land({ charted: 4 }); await settle(); });
    expect(ticked()).toEqual([true, false, false, false]);            // her draft is untouched by the other's answer
  });
});

describe("no blind overwrite (§5 A1)", () => {
  it("holds a save when a newer record came after the boxes were touched, then sends it or starts again", async () => {
    const { onChart } = await open();
    fireEvent.click(boxes()[2]);
    act(() => { Host.set({ patientId: "S-001", isolation: { ...ISOLATED, charted_at: T2 }, known: true, canChart: true }); });
    await press(SAVE);
    expect(onChart).not.toHaveBeenCalled();
    expect(within(box()).getByText(`Bu arada yeni izolyasiya qeydi gəldi (${dayStamp(Date.parse(T2), NOW)}); seçiminiz ona baxılaraq edilməyib.`))
      .toBeInTheDocument();
    await press("Seçimdən imtina et");
    expect(ticked()).toEqual([true, true, false, false]);             // re-seeded from the card
    fireEvent.click(boxes()[2]);
    act(() => { Host.set({ patientId: "S-001", isolation: { ...ISOLATED, charted_at: T1 }, known: true, canChart: true }); });
    await press(SAVE);
    await press("Yenə də yadda saxla");
    expect(onChart).toHaveBeenCalledTimes(1);
  });

  it("follows the card while untouched: a newer record is no conflict", async () => {
    const { onChart } = await open();
    act(() => { Host.set({ patientId: "S-001", isolation: { ...NOT_ISOLATED, charted_at: T2 }, known: true, canChart: true }); });
    expect(ticked()).toEqual([false, false, false, false]);
    await press(SAVE);
    expect(onChart).toHaveBeenCalledTimes(1);
  });
});

// Review I1: the buttons a held save swaps never drop the keyboard to <body>, and the hold is said, not only shown.
describe("the keyboard and the screen reader through a held save", () => {
  const button = (name) => within(box()).getByRole("button", { name });
  const wait = (ms) => act(async () => { await new Promise((resolve) => { setTimeout(resolve, ms); }); });
  const NEWER = `Bu arada yeni izolyasiya qeydi gəldi (${dayStamp(Date.parse(T2), NOW)}); seçiminiz ona baxılaraq edilməyib.`;
  async function heldOpen() {
    const opened = await open();
    fireEvent.click(boxes()[2]);
    act(() => { Host.set({ patientId: "S-001", isolation: { ...ISOLATED, charted_at: T2 }, known: true, canChart: true }); });
    button(SAVE).focus();
    await press(SAVE);
    return opened;
  }

  it("moves the focus to «Yenə də yadda saxla» and says why in the live region, then back to the save once it is sent", async () => {
    const { onChart } = await heldOpen();
    expect(document.activeElement).toBe(button("Yenə də yadda saxla"));
    await wait(200);
    expect(within(box()).getByRole("status").textContent).toBe(NEWER);
    await press("Yenə də yadda saxla");
    expect(onChart).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(button(SAVE));
  });

  it("puts the focus back on the save button when the choice is discarded, held or not", async () => {
    await heldOpen();
    await press("Seçimdən imtina et");
    expect(document.activeElement).toBe(button(SAVE));
    fireEvent.click(boxes()[2]);                                      // a draft on the newer record: not held
    button("Seçimdən imtina et").focus();
    await press("Seçimdən imtina et");
    expect(document.activeElement).toBe(button(SAVE));
  });
});

// Review M2: the box is the patient's. Away and back during a save, the first save's answer neither ends the second's
// busy state nor wipes the draft made since.
describe("a save in flight across a move away and back", () => {
  it("leaves the second save busy and its draft in place when the first one lands", async () => {
    const lands = [];
    const chart = vi.fn(() => new Promise((resolve) => { lands.push(resolve); }));
    await open({ chart });
    fireEvent.click(boxes()[3]);
    await press(SAVE);                                                // the first save, out
    act(() => { Host.set({ patientId: "S-002", isolation: NOT_ISOLATED, known: true, canChart: true }); });
    act(() => { Host.set({ patientId: "S-001", isolation: ISOLATED, known: true, canChart: true }); });
    expect(ticked()).toEqual([true, true, false, false]);             // a new box: the card, no draft
    fireEvent.click(boxes()[2]);
    await press(SAVE);                                                // the second save, out
    expect(chart).toHaveBeenCalledTimes(2);
    await act(async () => { lands[0]({ charted: 4 }); await settle(); });
    expect(within(box()).getByRole("button", { name: SAVE }).getAttribute("aria-busy")).toBe("true");
    expect(ticked()).toEqual([true, true, true, false]);
    await act(async () => { lands[1]({ charted: 4 }); await settle(); });
    expect(within(box()).getByRole("button", { name: SAVE }).getAttribute("aria-busy")).toBeNull();
  });
});

// Review M3: while a save is out, its draft is what was sent — no tick is taken, and «Seçimdən imtina et» discards
// nothing — so a failure keeps exactly the draft it promises to keep.
describe("the draft while a save is out", () => {
  it("holds the boxes and «Seçimdən imtina et» until the answer, and keeps the sent draft on a failure", async () => {
    let fail;
    const chart = vi.fn(() => new Promise((resolve, reject) => { fail = reject; }));
    await open({ chart });
    fireEvent.click(boxes()[3]);
    await press(SAVE);
    expect(boxes().map((input) => input.disabled)).toEqual([true, true, true, true]);
    const discard = within(box()).getByRole("button", { name: "Seçimdən imtina et" });
    expect(discard.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(boxes()[0]);
    await press("Seçimdən imtina et");
    expect(ticked()).toEqual([true, true, false, true]);
    await act(async () => { fail(refusal(400, "isolation_contact: yalnız 0 veya 1 olabilir")); await settle(); });
    expect(ticked()).toEqual([true, true, false, true]);
    expect(boxes().map((input) => input.disabled)).toEqual([false, false, false, false]);
    expect(within(box()).getByRole("button", { name: "Seçimdən imtina et" }).getAttribute("aria-disabled")).toBeNull();
  });
});

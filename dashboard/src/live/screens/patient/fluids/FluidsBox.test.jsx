// src/live/screens/patient/fluids/FluidsBox.test.jsx — the patient screen's «Sıvı» box (G3-03 D7–D12).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW, board, entry } from "../../../data/board.testutil.js";
import { dayStamp, hhmm } from "../../../i18n/dates.js";
import { RETRACT_ARM_MS } from "../../common/RetractDialog.jsx";
import { fromLocalInput, toLocalInput } from "../meds/medsFields.js";
import { DAY_START, H, emptyFluids, fluids } from "./fluids.testutil.js";
import { FluidsBox } from "./FluidsBox.jsx";
import { FLUIDS_POLL_MS } from "./useFluids.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const CHART = ["board.view", "clinical.chart"];
const BED = "REA-01 · 2";

/** The box on its own, on a session holding `perms`, reading `answer` for whichever patient it is asked. */
async function open({ perms = CHART, answer = fluids, id = "S-001", host = null, setup } = {}) {
  const ui = host ?? <FluidsBox patientId={id} bed={BED} nowMs={NOW} canChart={perms.includes("clinical.chart")} />;
  const mounted = await mount(ui, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      api.boardPatients.mockResolvedValue(board([entry("S-001")]));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.patientFluids.mockImplementation((pid) => Promise.resolve(answer(pid)));
      setup?.(api);
    },
  });
  await act(async () => { await settle(); });
  return mounted;
}

const group = (name) => screen.getByRole("group", { name });
const todayName = () => `Bu gün (${hhmm(DAY_START)} → indi)`;

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the fluid box — what the engine summed", () => {
  it("reads the patient's ledger on mount and shows today's intake, output and signed balance", async () => {
    const { api } = await open();
    expect(api.patientFluids).toHaveBeenCalledWith("S-001");
    expect(screen.getByRole("heading", { level: 2, name: "Maye" })).toBeInTheDocument();
    const today = within(group(todayName()));
    expect(today.getByText("750 mL")).toBeInTheDocument();
    expect(today.getByText("320 mL")).toBeInTheDocument();
    expect(today.getByText("+430 mL")).toBeInTheDocument();
  });

  it("shows the two shift subtotals under their own times", async () => {
    await open();
    const a = within(group(`${hhmm(DAY_START)}–${hhmm(DAY_START + 12 * H)} növbəsi`));
    expect(a.getByText("750 mL")).toBeInTheDocument();
    expect(a.getByText("+430 mL")).toBeInTheDocument();
    const b = within(group(`${hhmm(DAY_START + 12 * H)}–${hhmm(DAY_START + 24 * H)} növbəsi`));
    expect(b.getAllByText("0 mL")).toHaveLength(3);
  });

  it("writes the last complete day with its urine total, the hours covered and the SOFA renal row as a reference", async () => {
    await open();
    const last = within(group("Son tamamlanmış 24 saat"));
    expect(last.getByText("1800 mL")).toBeInTheDocument();
    expect(last.getByText("+320 mL")).toBeInTheDocument();
    expect(last.getByText("24 saatlıq sidik: 1480 mL")).toBeInTheDocument();
    expect(last.getByText("24 saatın 18 saatında sidik qeydi var")).toBeInTheDocument();
    const reference = last.getByText(/^Sepsis-3 SOFA böyrək sətri: <500 mL\/gün 3 bal, <200 mL\/gün 4 bal\./);
    expect(reference.className).not.toMatch(/text-(crit|att)/);
  });

  it("writes mL/kg/h as a plain number with its window — never coloured", async () => {
    await open();
    const rate = screen.getByText("Sidik 0,74 mL/kq/saat (son 6 saat)");
    expect(rate.className).not.toMatch(/text-(crit|att|ok)/);
    expect(rate.closest("[class*='text-crit'], [class*='text-att']")).toBeNull();
  });

  it("says why there is no mL/kg/h when the engine sends none", async () => {
    await open({ answer: emptyFluids });
    expect(screen.getByText("mL/kq/saat: çəki və ya son 6 saatda sidik qeydi yoxdur")).toBeInTheDocument();
    expect(screen.getByText("Bu gün qeyd yoxdur.")).toBeInTheDocument();
  });

  it("draws the day's 24 hours from the day start, each column titled with the engine's volumes", async () => {
    await open();
    const chart = screen.getByRole("img", { name: "Saatlıq giriş/çıxış və kumulyativ balans" });
    const columns = chart.querySelectorAll("[data-hour]");
    expect(columns).toHaveLength(24);
    expect(columns[0].querySelector("title").textContent).toBe(`${hhmm(DAY_START)} · qəbul 0 mL · xaric 0 mL · balans 0 mL`);
    expect(columns[1].querySelector("title").textContent).toBe(`${hhmm(DAY_START + H)} · qəbul 250 mL · xaric 120 mL · balans +130 mL`);
    expect(columns[5].querySelector("title").textContent).toBe(`${hhmm(DAY_START + 5 * H)} · qəbul 0 mL · xaric 200 mL · balans +430 mL`);
    expect(chart.querySelector("polyline")).not.toBeNull();
  });

  it("lists today's entries newest first, a withdrawn one struck through and said as such", async () => {
    await open();
    const list = screen.getByRole("list", { name: "Bugünkü qeydlər" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(5);                           // the last day's entry is not today's
    expect(rows[0]).toHaveTextContent(`${dayStamp(DAY_START + 5 * H, NOW)} · Sidik · 200 mL · hem.ayse`);
    expect(rows[1].querySelector("s")).toHaveTextContent("80 mL");
    expect(rows[1]).toHaveTextContent("səhv qeyd");
    expect(rows[2]).toHaveTextContent("Kristalloid bolus (Dərman və antibiotik qutusundakı ilə eyni qeyd)");
    expect(rows[4]).toHaveTextContent("Venadaxili maye / infuziya · 250 mL");
  });

  it("offers «Giriş/çıxış əlavə et» only to a clinical.chart holder", async () => {
    await open({ perms: ["board.view"] });
    expect(screen.queryByRole("button", { name: "Giriş/çıxış əlavə et" })).toBeNull();
    cleanup();
    await open();
    expect(screen.getByRole("button", { name: "Giriş/çıxış əlavə et" })).toBeInTheDocument();
  });
});

describe("the fluid box — reading", () => {
  it("reads again once a minute", async () => {
    const { api } = await open();
    expect(api.patientFluids).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(FLUIDS_POLL_MS); await settle(); });
    expect(api.patientFluids).toHaveBeenCalledTimes(2);
  });

  it("keeps the last numbers and says so when a read fails", async () => {
    const { api } = await open();
    api.patientFluids.mockRejectedValueOnce(refusal(503, "kapsam şu anda okunamıyor"));
    await act(async () => { vi.advanceTimersByTime(FLUIDS_POLL_MS); await settle(); });
    expect(screen.getByText(/^Maye qeydləri oxuna bilmədi: /)).toBeInTheDocument();
    expect(within(group(todayName())).getByText("750 mL")).toBeInTheDocument();
  });

  it("never shows one patient's ledger on another's screen", async () => {
    function Host() {
      const [id, setId] = React.useState("S-001");
      return (
        <>
          <button type="button" onClick={() => setId("S-002")}>move</button>
          <FluidsBox patientId={id} bed={BED} nowMs={NOW} canChart />
        </>
      );
    }
    const { api } = await open({ host: <Host /> });
    expect(within(group(todayName())).getByText("750 mL")).toBeInTheDocument();
    api.patientFluids.mockImplementation(() => new Promise(() => {}));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "move" })); await settle(); });
    expect(api.patientFluids).toHaveBeenLastCalledWith("S-002");
    expect(screen.queryByText("750 mL")).toBeNull();
    expect(screen.getByText("Maye qeydləri oxunur…")).toBeInTheDocument();
  });

  it("drops an answer that is not this patient's ledger", async () => {
    await open({ answer: () => fluids("S-999") });
    expect(screen.queryByText("750 mL")).toBeNull();
    expect(screen.getByText(/^Maye qeydləri oxuna bilmədi: /)).toBeInTheDocument();
  });
});

const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
const wait = (ms) => act(async () => { vi.advanceTimersByTime(ms); await settle(); });
// The toasts on screen: the region also reads each one out in a hidden live region (ui/Toast.jsx), so a text is in
// the DOM twice; only the copies inside a toast (`data-toast`) are counted.
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text)
  .filter((el) => el.closest("[data-toast]"));
const dialog = () => screen.getByRole("dialog", { name: `Giriş/çıxış · ${BED}` });
const rowOf = (n) => within(dialog()).getByRole("group", { name: `Sətir ${n}` });
const typeInto = (el, value) => fireEvent.change(el, { target: { value } });
const openDialog = () => press(screen.getByRole("button", { name: "Giriş/çıxış əlavə et" }));
const saveDialog = () => press(within(dialog()).getByRole("button", { name: "Yadda saxla" }));
const todayRows = () => within(screen.getByRole("list", { name: "Bugünkü qeydlər" })).getAllByRole("listitem");

describe("the fluid box — writing (G3-03 D10, D11)", () => {
  it("saves rows with the same time in ONE chart request, says so on the toast and reads the ledger again", async () => {
    const { api } = await open({
      setup: (a) => a.chart.mockResolvedValue({ patient_id: "S-001", entries: [{ entry: 201, code: "urine_output_ml" }, { entry: 202, code: "iv_fluid_ml" }] }),
    });
    await openDialog();
    expect(within(rowOf(1)).getByLabelText("Növ")).toHaveValue("urine_output_ml");
    typeInto(within(rowOf(1)).getByLabelText("mL"), "120");
    await press(within(dialog()).getByRole("button", { name: "Sətir əlavə et" }));
    typeInto(within(rowOf(2)).getByLabelText("Növ"), "iv_fluid_ml");
    typeInto(within(rowOf(2)).getByLabelText("mL"), "250");
    const reads = api.patientFluids.mock.calls.length;
    await saveDialog();
    expect(api.chart).toHaveBeenCalledTimes(1);
    const [pid, entries, at] = api.chart.mock.calls[0];
    expect(pid).toBe("S-001");
    expect(entries).toEqual([{ code: "urine_output_ml", value: 120 }, { code: "iv_fluid_ml", value: 250 }]);
    expect(Math.abs(Date.now() - Date.parse(at))).toBeLessThan(120_000);   // an untouched time is the moment of saving
    expect(api.patientFluids.mock.calls.length).toBe(reads + 1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toasted(`${BED}: 2 qeyd yadda saxlanıldı.`)).toHaveLength(1);
  });

  it("holds a 5001 mL row back with the reason under it, takes the focus there and sends nothing", async () => {
    const { api } = await open();
    await openDialog();
    typeInto(within(rowOf(1)).getByLabelText("mL"), "5001");
    await saveDialog();
    expect(within(rowOf(1)).getByText("0–5000 mL arasında bir ədəd daxil edin.")).toBeInTheDocument();
    expect(within(rowOf(1)).getByLabelText("mL")).toHaveFocus();
    expect(api.chart).not.toHaveBeenCalled();
    typeInto(within(rowOf(1)).getByLabelText("Növ"), "crystalloid_bolus_ml");
    typeInto(within(rowOf(1)).getByLabelText("mL"), "10001");
    await saveDialog();
    expect(within(rowOf(1)).getByText("0–10000 mL arasında bir ədəd daxil edin.")).toBeInTheDocument();
    expect(api.chart).not.toHaveBeenCalled();
  });

  it("holds back a time more than 24 hours back", async () => {
    const { api } = await open();
    await openDialog();
    typeInto(within(rowOf(1)).getByLabelText("mL"), "100");
    typeInto(within(rowOf(1)).getByLabelText("Vaxt"), toLocalInput(NOW - 26 * H));
    await saveDialog();
    expect(within(rowOf(1)).getByText("Vaxt ən çox 24 saat geriyə ola bilər, irəli ola bilməz.")).toBeInTheDocument();
    expect(api.chart).not.toHaveBeenCalled();
  });

  it("sends rows with different times one request per time, in order, and stops at the first refusal saying what was saved", async () => {
    const { api } = await open({
      setup: (a) => a.chart
        .mockResolvedValueOnce({ patient_id: "S-001", entries: [{ entry: 201, code: "urine_output_ml" }] })
        .mockRejectedValueOnce(refusal(422, "value out of range")),
    });
    await openDialog();
    typeInto(within(rowOf(1)).getByLabelText("mL"), "120");
    await press(within(dialog()).getByRole("button", { name: "Sətir əlavə et" }));
    typeInto(within(rowOf(2)).getByLabelText("Növ"), "drain_output_ml");
    typeInto(within(rowOf(2)).getByLabelText("mL"), "40");
    const earlier = toLocalInput(NOW - 2 * H);
    typeInto(within(rowOf(2)).getByLabelText("Vaxt"), earlier);
    const reads = api.patientFluids.mock.calls.length;
    await saveDialog();
    expect(api.chart).toHaveBeenCalledTimes(2);
    expect(api.chart.mock.calls[0][1]).toEqual([{ code: "urine_output_ml", value: 120 }]);
    expect(api.chart.mock.calls[1][1]).toEqual([{ code: "drain_output_ml", value: 40 }]);
    expect(api.chart.mock.calls[1][2]).toBe(new Date(fromLocalInput(earlier)).toISOString());
    expect(toasted(/^REA-01 · 2: 1 sətir yadda saxlanıldı, 1 sətir saxlanılmadı — /)).toHaveLength(1);
    // The saved row leaves the dialog — a second press must not chart it twice — and the refused one stays.
    expect(within(dialog()).queryByRole("group", { name: "Sətir 2" })).toBeNull();
    expect(within(rowOf(1)).getByLabelText("Növ")).toHaveValue("drain_output_ml");
    expect(within(rowOf(1)).getByLabelText("mL")).toHaveValue("40");
    expect(api.patientFluids.mock.calls.length).toBe(reads + 1);
  });

  it("says a discharged patient's entry was not taken, and closes", async () => {
    const { api } = await open({ setup: (a) => a.chart.mockResolvedValue({ patient_id: "S-001", dropped: true }) });
    await openDialog();
    typeInto(within(rowOf(1)).getByLabelText("mL"), "120");
    await saveDialog();
    expect(api.chart).toHaveBeenCalledTimes(1);
    expect(toasted(`${BED} tərxis edilib; qeyd qəbul edilmədi.`)).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("withdraws a fluid entry through «Səhv qeyd» for the entry the ledger names, then reads the ledger again", async () => {
    const reason = "yanlış hastaya girildi";
    const { api } = await open({ setup: (a) => a.retractEntry.mockResolvedValue({ retracted: 105, code: "urine_output_ml", alerts: [] }) });
    expect(within(todayRows()[1]).queryByRole("button", { name: "Səhv qeyd" })).toBeNull();   // 104: already withdrawn
    await press(within(todayRows()[0]).getByRole("button", { name: "Səhv qeyd" }));
    const retract = screen.getByRole("dialog", { name: `Səhv qeyd · ${BED}` });
    expect(within(retract).getByText(`Sidik: 200 mL · ölçmə ${dayStamp(DAY_START + 5 * H, NOW)}`)).toBeInTheDocument();
    typeInto(within(retract).getByRole("textbox"), reason);
    await wait(RETRACT_ARM_MS + 50);
    const reads = api.patientFluids.mock.calls.length;
    await press(within(retract).getByRole("button", { name: "Səhv qeyd kimi işarələ" }));
    expect(api.retractEntry).toHaveBeenCalledTimes(1);
    expect(api.retractEntry).toHaveBeenCalledWith("S-001", 105, reason);
    expect(api.patientFluids.mock.calls.length).toBe(reads + 1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(todayRows()[0].querySelector("s")).toHaveTextContent("200 mL");
    expect(within(todayRows()[0]).queryByRole("button", { name: "Səhv qeyd" })).toBeNull();
  });

  it("offers no «Səhv qeyd» without clinical.chart", async () => {
    await open({ perms: ["board.view"] });
    for (const row of todayRows()) expect(within(row).queryByRole("button")).toBeNull();
  });
});

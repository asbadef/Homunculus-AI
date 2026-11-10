// src/live/screens/patient/fluids/FluidsBox.test.jsx — the patient screen's «Sıvı» box (G3-03 D7–D12).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW, board, entry } from "../../../data/board.testutil.js";
import { hhmm } from "../../../i18n/dates.js";
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
    expect(rows[0]).toHaveTextContent(`${hhmm(DAY_START + 5 * H)} · Sidik · 200 mL · hem.ayse`);
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

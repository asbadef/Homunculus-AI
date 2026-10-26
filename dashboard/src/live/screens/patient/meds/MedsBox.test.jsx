// MedsBox.test.jsx — the Meds box prints the engine's numbers and the engine's stamps (G2-A3, D5): each
// pressor with the time it was charted, the last charted entries newest first, the antibiotic as before;
// and it offers the charting form to a `clinical.chart` holder only (D4), as a dialog (X1). Synthetic values.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { MedsBox } from "./MedsBox.jsx";

const NOW = Date.parse("2026-10-26T09:00:00+04:00");
const CHARTABLE = ["board.view", "alerts.ack", "clinical.chart"];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const at = (ts) => hhmm(Date.parse(ts));

const MEDS = {
  pressors: { norepinephrine: 0.12, epinephrine: null, dopamine: 0, dobutamine: null },
  pressors_at: { norepinephrine: "2026-10-26T04:50:00+00:00", epinephrine: null, dopamine: "2026-10-26T04:30:00+00:00", dobutamine: null },
  on_pressor: true, antibiotic_given: null, antibiotic_at: null, antibiotic_clock: null, creatinine: null, weight_kg: 80,
  charted: [
    { code: "norepinephrine_rate", value: 0.12, unit: "ug/kg/min", ts: "2026-10-26T04:50:00+00:00" },
    { code: "dopamine_rate", value: 0, unit: "ug/kg/min", ts: "2026-10-26T04:30:00+00:00" },
    { code: "crystalloid_bolus_ml", value: 500, unit: "mL", ts: "2026-10-26T04:10:00+00:00" },
    { code: "antibiotic_administered", value: 1, unit: "bool", ts: "2026-10-26T04:00:00+00:00" },
  ],
};

describe("the Meds box", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  async function open({ meds = MEDS, canChart = false, onChart = vi.fn() } = {}) {
    vi.setSystemTime(NOW);
    const perms = canChart ? CHARTABLE : ["board.view", "alerts.ack"];
    const mounted = await mount(
      <MedsBox meds={meds} bed="REA-01 · 2" canChart={canChart} onChart={onChart} />,
      { access: token({ perms }), me: profile({ perms }) });
    return { ...mounted, onChart };
  }
  const box = () => screen.getByRole("heading", { level: 2, name: /Dərman və antibiotik/ }).closest(".rounded-box");
  const offer = () => screen.queryByRole("button", { name: "Qeyd əlavə et" });
  const dialog = () => screen.queryByRole("dialog", { name: /Dərman \/ maye qeydi/ });

  it("lists each running pressor with its time and says a 0 is stopped", async () => {
    await open();
    const text = box().textContent;
    expect(text).toContain(`noradrenalin 0.12 mkq/kq/dəq · ${at(MEDS.pressors_at.norepinephrine)}`);
    expect(text).toContain(`dopamin dayandırıldı · ${at(MEDS.pressors_at.dopamine)}`);
    // "adrenalin" is inside "noradrenalin": the two null drugs are looked for outside it.
    expect(text.replace(/noradrenalin/g, "")).not.toMatch(/adrenalin/);
    expect(text).not.toMatch(/dobutamin/);
    expect(within(box()).getByText("Çəki: 80 kq")).toBeInTheDocument();
  });

  it("lists the last entries newest first, the antibiotic as a sentence", async () => {
    await open();
    expect(within(box()).getByRole("heading", { name: "Son qeydlər" })).toBeInTheDocument();
    const items = within(within(box()).getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent(at(MEDS.charted[0].ts));
    expect(items[0]).toHaveTextContent(/noradrenalin/); expect(items[0]).toHaveTextContent(/0\.12/);
    expect(items[1]).toHaveTextContent(/dopamin/); expect(items[1]).toHaveTextContent(/\b0\b/);
    expect(items[2]).toHaveTextContent(/500/); expect(items[2]).toHaveTextContent(/mL/);
    expect(items[3]).toHaveTextContent(/antibiotik verilib/);
    cleanup();
    await open({ meds: { ...MEDS, charted: [] } });
    expect(within(box()).getByText("Hələ qeyd yoxdur.")).toBeInTheDocument();
    expect(within(box()).queryByRole("list")).toBeNull();
    cleanup();
    await open({ meds: null, canChart: true });
    expect(within(box()).getByText("Mühərrik bu xəstə üçün dərman məlumatı göndərməyib.")).toBeInTheDocument();
    expect(offer()).not.toBeNull();
  });

  it("a stamp from another day carries its day and month; today's is the time alone (final review M1)", async () => {
    // Charted up to 24 h back: "09:00" from yesterday must not read as this morning's.
    const yesterday = new Date(NOW - 24 * 3600_000).toISOString();
    const today = new Date(NOW).toISOString();
    const dated = `${ddmm(Date.parse(yesterday))} ${hhmm(Date.parse(yesterday))}`;
    await open({ meds: {
      ...MEDS,
      pressors: { ...MEDS.pressors, norepinephrine: 0.12, dopamine: 5 },
      pressors_at: { ...MEDS.pressors_at, norepinephrine: yesterday, dopamine: today },
      charted: [
        { code: "dopamine_rate", value: 5, unit: "ug/kg/min", ts: today },
        { code: "norepinephrine_rate", value: 0.12, unit: "ug/kg/min", ts: yesterday },
      ],
    } });
    const text = box().textContent;
    expect(text).toContain(`noradrenalin 0.12 mkq/kq/dəq · ${dated}`);
    expect(text).toContain(`dopamin 5 mkq/kq/dəq · ${hhmm(NOW)}`);
    expect(text).not.toContain(`dopamin 5 mkq/kq/dəq · ${ddmm(NOW)}`);
    const items = within(within(box()).getByRole("list")).getAllByRole("listitem");
    expect(items[0].textContent.startsWith(`${hhmm(NOW)} · `)).toBe(true);
    expect(items[1].textContent.startsWith(`${dated} · `)).toBe(true);
  });

  it("offers «Qeyd əlavə et» only with clinical.chart, and the dialog opens on it", async () => {
    await open();
    expect(offer()).toBeNull();          // not even a disabled one
    cleanup();
    const onChart = vi.fn(() => Promise.resolve({ patient_id: "S-001", charted: 1, alerts: [] }));
    await open({ canChart: true, onChart });
    expect(dialog()).toBeNull();
    fireEvent.click(offer());
    expect(dialog()).not.toBeNull();
    fireEvent.change(within(dialog()).getByLabelText(/Çəki/), { target: { value: "80" } });
    await act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Yadda saxla" })); await settle(); });
    expect(onChart).toHaveBeenCalledWith([{ code: "weight_kg", value: 80 }], new Date(NOW).toISOString());
    expect(dialog()).toBeNull();
  });

  it("the antibiotic line is unchanged", async () => {
    await open({ meds: { ...MEDS, antibiotic_given: null } });
    expect(within(box()).getByText("Antibiotik: heç kim qeyd etməyib — verilmədiyi anlamına gəlmir.")).toBeInTheDocument();
    cleanup();
    const ts = "2026-10-26T04:00:00+00:00";
    await open({ meds: { ...MEDS, antibiotic_given: true, antibiotic_at: ts } });
    expect(within(box()).getByText(`Antibiotik verilib: ${at(ts)}`)).toBeInTheDocument();
    cleanup();
    const deadline = "2026-10-26T05:15:00+00:00";
    await open({ meds: { ...MEDS, antibiotic_given: false, antibiotic_clock: { deadline, remaining_sec: 900 } } });
    expect(within(box()).getByText(`Antibiotik qeydi yoxdur; müddət ${at(deadline)} tarixində bitir.`)).toBeInTheDocument();
  });
});

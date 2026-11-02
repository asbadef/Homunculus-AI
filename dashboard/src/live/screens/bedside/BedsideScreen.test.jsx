// BedsideScreen.test.jsx — «Çarpayı başında ölçmə»: the board's patients by bed, who it is before the form, the
// form bound to the chosen patient through the board store, and the saved step (G3-01, D3, X9, X13). Synthetic
// cards only (board.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { NOW, ago, board, entry, identity, news2 } from "../../data/board.testutil.js";
import { dayStamp, hhmm } from "../../i18n/dates.js";
import { BedsideScreen } from "./BedsideScreen.jsx";
import { SAVE_ARM_MS } from "./VitalsForm.jsx";

const CHARTABLE = ["board.view", "clinical.chart"];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const AYSE = entry("S-001", [], { identity: identity({ birth_date: "1970-05-05" }), score: news2({ measured_at: { spo2: ago(600), pulse: null } }) });
const VUSAL = entry("S-002", [], { identity: identity({ patient_id: "S-002", display_name: "Vüsal Sınaq", bed_label: "REA-01 · 1",
  bed_id: "REA-01-1", bed_key: "REA^01^1" }) });
const PREVIEW = { patient_id: "S-001", preview: true, at: new Date(NOW).toISOString(), news2: news2({ total: 1, breakdown: { spo2: 1 } }) };
const SAVED = { patient_id: "S-001", charted: 1, alerts: [], entries: [{ code: "spo2", entry: 51 }] };

/** The page inside a real session and board store, the board LIVE with its first reload landed. */
async function open(cards = [AYSE, VUSAL]) {
  const mounted = await mount(<BedsideScreen />, {
    access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }),
    setup: (api) => {
      api.boardPatients.mockResolvedValue(board(cards));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.previewChart.mockResolvedValue(PREVIEW);
      api.chart.mockResolvedValue(SAVED);
    },
  });
  await act(async () => { await mounted.board.start(); });
  await act(async () => { mounted.stream.open(); await settle(); });
  return mounted;
}
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
const pick = (id) => press(document.querySelector(`[data-pick="${id}"]`));
const picks = () => [...document.querySelectorAll("[data-pick]")];
const button = (name) => screen.getByRole("button", { name });
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);

beforeEach(() => { vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the bedside page", () => {
  it("lists the board's patients by bed, each with name, age and when it was last measured", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1, name: "Çarpayı başında ölçmə" })).toBeInTheDocument();
    expect(picks().map((b) => b.getAttribute("data-pick"))).toEqual(["S-002", "S-001"]);
    expect(picks()[1]).toHaveTextContent("REA-01 · 2");
    expect(picks()[1]).toHaveTextContent("Ayşe Sentetik");
    expect(picks()[1]).toHaveTextContent(`56 yaşında · son ölçmə ${dayStamp(NOW - 600_000, NOW)}`);
    expect(picks()[0]).toHaveTextContent("ölçmə yoxdur");
  });

  it("asks who it is before the form; «Xeyr» cancels the choice and says to tell the charge nurse", async () => {
    const { api } = await open();
    await pick("S-001");
    expect(screen.getByRole("heading", { level: 2, name: "Şəxsiyyətin təsdiqi" })).toBeInTheDocument();
    expect(screen.getByText("Ayşe Sentetik")).toBeInTheDocument();
    expect(screen.getByText("1970")).toBeInTheDocument();
    await press(button("Xeyr, uyğun deyil"));
    expect(toasted("REA-01 · 2: şəxsiyyət uyğun gəlmədi, seçim ləğv edildi. Məsul tibb bacısına bildirin.").length).toBeGreaterThan(0);
    expect(picks()).toHaveLength(2);
    expect(api.previewChart).not.toHaveBeenCalled();
  });

  it("a patient with no birth date says so, and «Bəli» opens the form for that bed", async () => {
    await open();
    await pick("S-002");
    expect(screen.getByText("doğum tarixi qeyd edilməyib")).toBeInTheDocument();
    await press(button("Bəli, uyğundur"));
    expect(screen.getByRole("heading", { level: 2, name: "Ölçmə · REA-01 · 1" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Tənəffüs/ })).toBeInTheDocument();
  });

  it("previews and saves through the board store for the chosen patient, then shows what was saved", async () => {
    const { api } = await open();
    await pick("S-001");
    await press(button("Bəli, uyğundur"));
    fireEvent.change(screen.getByRole("textbox", { name: /^SpO2/ }), { target: { value: "95" } });
    await press(button("Öncədən baxın"));
    expect(api.previewChart).toHaveBeenCalledWith("S-001", [{ code: "spo2", value: 95 }], null);
    // «Yadda saxla» ignores a press in its arming window; real timers here (the board store's own), so wait it out.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, SAVE_ARM_MS + 50)); });
    await press(button("Yadda saxla"));
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "spo2", value: 95 }], null);
    expect(screen.getByRole("heading", { level: 2, name: `Yadda saxlanıldı · ${hhmm(NOW)}` })).toBeInTheDocument();
    expect(document.querySelector('[data-row="spo2"]')).toHaveTextContent("SpO2 95 %");
    expect(screen.getByRole("link", { name: "Xəstə ekranı" })).toHaveAttribute("href", "#/patients/S-001");
    await press(button("Növbəti xəstə"));
    expect(picks()).toHaveLength(2);
  });

  it("a patient who leaves the board while chosen is said, and the page goes back to the list", async () => {
    const { stream } = await open();
    await pick("S-001");
    await press(button("Bəli, uyğundur"));
    await act(async () => { stream.frame({ patient_id: "S-001", removed: true }); await settle(); });
    expect(screen.getByText("Seçilmiş xəstə artıq siyahıda deyil (evə yazılıb və ya əhatə xaricindədir). Yenidən seçin.")).toBeInTheDocument();
    expect(picks().map((b) => b.getAttribute("data-pick"))).toEqual(["S-002"]);
  });
});

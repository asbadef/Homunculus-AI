// KaliteScreen.test.jsx — «Keyfiyyət göstəriciləri» (G4-03, spec D5): one h1 and no patient anywhere; the coverage line;
// the cards; the units table with a quiet unit's zeros, «Şöbəsi bəlli olmayan» and «Cəmi»; a unit selected by its name;
// the snooze reasons and the alarms by kind for the selection; the period switch, the newest read winning, «Yenilə»; a
// truncated read; a period with no alarm episode; a scoped caller, a quiet one and one who reaches nothing; reading,
// 403, a failure, a malformed answer and another period's answer, each with its reason. The default language is az;
// one test reads English. Synthetic answers (kalite.testutil.js).
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { ddmmhhmm } from "../../i18n/dates.js";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { expectNoUuid } from "../kabul/kabul.testutil.js";
import { KaliteScreen } from "./KaliteScreen.jsx";
import { ANSWER, NOTHING, QUIET, QUIET_SCOPED, SCOPED, deferred } from "./kalite.testutil.js";

afterEach(() => { cleanup(); localStorage.clear(); });

const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });

/** Mount the page for a session holding `perms` (a hospital's own quality group by default: `quality.view` alone). */
async function mountKalite({ perms = ["quality.view"], setup } = {}) {
  const mounted = await mount(<KaliteScreen />, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => { api.qualityIndicators.mockResolvedValue(ANSWER); setup?.(api); },
  });
  await settle();
  return mounted;
}

const UNITS_TABLE = "Şöbələrə görə keyfiyyət göstəriciləri";
const cells = (row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent);
const card = (name) => screen.getByRole("heading", { level: 3, name }).closest("li");
const value = (name) => card(name).querySelector("[data-card-value]").textContent;
const rows = () => within(screen.getByRole("table", { name: UNITS_TABLE })).getAllByRole("row").slice(1).map(cells);
const snoozeRows = (name = "Təxirə salma səbəbləri") => within(screen.getByRole("table", { name })).getAllByRole("row").map(cells);
const coverage = () => document.querySelector("[data-coverage]");
const units = () => document.querySelector("[data-units]");
/** A listed unit, or the total, with nothing in the period: its real zeros, a «—» for each time and the rate. */
const QUIET_ROW = ["0", "—", "—", "— hələ yekunlaşan yoxdur", "0", "0 (0)", "0", "0", "0 / 0 / 0", "—"];

describe("the quality page", () => {
  it("has one h1, reads /quality for 7 days once on open, and shows no UUID", async () => {
    const { api } = await mountKalite();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Keyfiyyət göstəriciləri"]);
    expect(screen.getByText("Proses ölçülür, şəxs yox")).toBeInTheDocument();
    expect(api.qualityIndicators).toHaveBeenCalledTimes(1);
    expect(api.qualityIndicators).toHaveBeenCalledWith(7);
    expect(document.querySelector("[data-as-of]").textContent).toMatch(/^\d\d:\d\d vəziyyətinə görə$/);
    expectNoUuid();
  });

  it("says how many alarms could be tied to a unit, and why the rest could not", async () => {
    await mountKalite();
    expect(coverage()).toHaveTextContent(
      "Bu dövrdə 9 siqnal epizodundan 7 ədədi şöbəyə bağlana bildi. Şöbəyə bağlanmayanlar: bu sistemdə qəbul qeydi olmayan");
  });

  it("draws the hospital's cards from the answer", async () => {
    await mountKalite();
    expect(screen.getByRole("heading", { level: 2, name: "Bütün xəstəxana · son 7 gün" })).toBeInTheDocument();
    expect(value("Siqnala cavab müddəti (median)")).toBe("3 dəq 0 san");
    expect(value("Cavablanan siqnal")).toBe("63%");
    expect(card("Cavablanan siqnal")).toHaveTextContent("yekunlaşan 8 siqnal epizodundan 5 ədədi");
    expect(value("Eskalasiya edilən siqnal")).toBe("1");
    expect(value("Cavabsız qalan siqnal")).toBe("3");
    expect(card("Cavabsız qalan siqnal")).toHaveTextContent("1 ədədi öz-özünə düzəldi");
    expect(value("Təxirə salınan siqnal")).toBe("4");
    expect(card("Təxirə salınan siqnal")).toHaveTextContent("2 yüksək · 2 orta");
    expect(value("RRT çağırışı")).toBe("2");
    expect(value("Təhvilin əks-imza müddəti (median)")).toBe("5 dəq 0 san");
  });

  it("draws a row per unit — a quiet one with its zeros — then «Şöbəsi bəlli olmayan», then «Cəmi»", async () => {
    await mountKalite();
    expect(rows()).toEqual([
      ["Kardiyoloji", ...QUIET_ROW],
      ["Neonatal", "1", "4 dəq 0 san", "4 dəq 0 san", "100%", "0", "0 (0)", "1", "0", "1 / 1 / 0", "1 dəq 0 san"],
      ["Reanimasiya", "6", "3 dəq 0 san", "10 dəq 0 san", "60%", "1", "2 (1)", "2", "1", "6 / 2 / 1", "10 dəq 0 san"],
      // Every handover has a unit: the unplaced row's two handover cells are «—», never a 0 or a blank.
      ["Şöbəsi bəlli olmayan", "2", "1 dəq 0 san", "1 dəq 0 san", "50%", "0", "1 (0)", "1", "1", "—", "—"],
      ["Cəmi", "9", "3 dəq 0 san", "4 dəq 0 san", "63%", "1", "3 (1)", "4", "2", "7 / 3 / 1", "5 dəq 0 san"],
    ]);
  });

  it("selects a unit by its name: the snooze reasons gain its column, the kinds are its own", async () => {
    await mountKalite();
    expect(screen.getByRole("heading", { level: 2, name: "Növə görə siqnallar · Bütün xəstəxana" })).toBeInTheDocument();
    expect(snoozeRows()[0]).toEqual(["Səbəb", "Bütün xəstəxana"]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reanimasiya" })); });
    expect(screen.getByRole("button", { name: "Reanimasiya" })).toHaveAttribute("aria-pressed", "true");
    expect(snoozeRows()).toEqual([
      ["Səbəb", "Bütün xəstəxana", "Reanimasiya"],
      ["Klinik qərar verilib", "1", "1"],
      ["Artefakt və ya siqnal küyü", "1", "0"],
      ["Prosedur gedir", "1", "0"],
      ["Xəstənin öz norması", "0", "0"],
      ["Digər", "1", "1"],
      ["Cəmi", "4", "2"],
      ["Median müddət", "12,5 dəq", "12,5 dəq"],
    ]);
    expect(screen.getByRole("heading", { level: 2, name: "Növə görə siqnallar · Reanimasiya" })).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Növə görə siqnallar" })).getAllByRole("row").slice(1).map(cells))
      .toEqual([["news2", "3", "2", "0", "0", "2 dəq 0 san"], ["spo2_low", "2", "0", "0", "2", "—"],
        ["septic_shock", "1", "1", "1", "0", "10 dəq 0 san"]]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Şöbəsi bəlli olmayan" })); });
    expect(screen.getByRole("heading", { level: 2, name: "Növə görə siqnallar · Şöbəsi bəlli olmayan" })).toBeInTheDocument();
  });

  it("writes a half minute with a decimal point in English", async () => {
    localStorage.setItem("hmc.lang", "en");
    await mountKalite();
    expect(snoozeRows("Snooze reasons").at(-1)).toEqual(["Median length", "12.5 min"]);
  });

  it("says a truncated read is one, and from when the alarms are counted", async () => {
    const from = "2026-11-08T06:00:00+00:00";
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue({ ...ANSWER, truncated: true, window_from: from }) });
    expect(coverage()).toHaveTextContent(
      `Serverin oxuma həddi aşıldı: yalnız ən yeni qeydlər oxundu; siqnal, təxirə salma və RRT sayları ${ddmmhhmm(Date.parse(from))} ilə başlayır`);
  });
});

describe("a period with no alarm episode", () => {
  it("says so plainly, and still lists every unit with its zeros", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue(QUIET) });
    expect(coverage().textContent).toBe("Bu dövrdə siqnal epizodu yoxdur.");
    expect(rows().map((row) => row[0])).toEqual(["Kardiyoloji", "Neonatal", "Reanimasiya", "Şöbəsi bəlli olmayan", "Cəmi"]);
    expect(rows()[1]).toEqual(["Neonatal", ...QUIET_ROW]);
    expect(units()).not.toHaveTextContent("Əhatənizdə şöbə yoxdur.");
  });
});

describe("the period switch and «Yenilə»", () => {
  it("reads the chosen period, and the newest read wins", async () => {
    const week = deferred();
    const { api } = await mountKalite({ setup: (a) => a.qualityIndicators.mockImplementation(
      (days) => (days === 7 ? week.promise : Promise.resolve({ ...ANSWER, days }))) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "30 gün" })); });
    await settle();
    expect(api.qualityIndicators).toHaveBeenLastCalledWith(30);
    expect(screen.getByRole("button", { name: "30 gün" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Bütün xəstəxana · son 30 gün" })).toBeInTheDocument();
    await act(async () => { week.resolve({ ...ANSWER, coverage: { episodes: 1, placed: 1, unplaced: 0 } }); });
    await settle();
    expect(coverage()).toHaveTextContent("9 siqnal epizodundan 7 ədədi");
  });

  it("while the new period is read, shows «— oxunur…» — never the old period's numbers", async () => {
    const month = deferred();
    await mountKalite({ setup: (a) => a.qualityIndicators.mockImplementation(
      (days) => (days === 30 ? month.promise : Promise.resolve(ANSWER))) });
    expect(value("RRT çağırışı")).toBe("2");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "30 gün" })); });
    await settle();
    expect(value("RRT çağırışı")).toBe("— oxunur…");
    expect(units()).toHaveTextContent("Keyfiyyət göstəriciləri oxunur…");
    expect(screen.queryByRole("table", { name: UNITS_TABLE })).toBeNull();
    expect(coverage()).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Göstəricilər · son 30 gün" })).toBeInTheDocument();
  });

  it("«Yenilə» reads the same period again, and says «— oxunur…» until it lands", async () => {
    const again = deferred();
    const { api } = await mountKalite();
    api.qualityIndicators.mockImplementation(() => again.promise);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); });
    await settle();
    expect(api.qualityIndicators).toHaveBeenCalledTimes(2);
    expect(api.qualityIndicators).toHaveBeenLastCalledWith(7);
    expect(value("RRT çağırışı")).toBe("— oxunur…");
    await act(async () => { again.resolve(ANSWER); });
    await settle();
    expect(value("RRT çağırışı")).toBe("2");
  });

  it("a «Yenilə» that fails after an answer keeps nothing of it: «— oxunmadı», and no unit row", async () => {
    const { api } = await mountKalite();
    expect(rows()).toHaveLength(5);
    api.qualityIndicators.mockRejectedValue(refusal(503, "down"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); });
    await settle();
    expect(value("RRT çağırışı")).toBe("— oxunmadı");
    expect(screen.queryByRole("table", { name: UNITS_TABLE })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reanimasiya" })).toBeNull();
    expect(document.querySelector("[data-failed]")).toHaveTextContent("Keyfiyyət göstəriciləri oxunmadı:");
  });
});

describe("a caller whose scope is restricted", () => {
  it("reads only her units: no unplaced row, and the line says so", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue(SCOPED) });
    expect(coverage()).toHaveTextContent("Yalnız əhatənizdəki şöbələr: bu dövrdə bu şöbələrə 6 siqnal epizodu bağlandı.");
    expect(rows().map((row) => row[0])).toEqual(["Reanimasiya", "Cəmi"]);
    expect(screen.getByRole("heading", { level: 2, name: "Əhatənizdəki şöbələr · son 7 gün" })).toBeInTheDocument();
  });

  it("whose units were quiet: they are listed with their zeros, and the line says there was no alarm episode", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue(QUIET_SCOPED) });
    expect(coverage().textContent).toBe("Yalnız əhatənizdəki şöbələr: bu dövrdə bu şöbələrdə siqnal epizodu yoxdur.");
    expect(rows()).toEqual([["Reanimasiya", ...QUIET_ROW], ["Cəmi", ...QUIET_ROW]]);
    expect(units()).not.toHaveTextContent("Əhatənizdə şöbə yoxdur.");
  });

  it("with no unit in her reach: the page says so, once, and its zeros are the answer's own", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue(NOTHING) });
    expect(units()).toHaveTextContent("Əhatənizdə şöbə yoxdur.");
    expect(coverage()).toBeNull();                     // no «0 episodes» line beside «no unit»
    expect(screen.queryByRole("table", { name: UNITS_TABLE })).toBeNull();
    expect(value("Cavablanan siqnal")).toBe("— hələ yekunlaşan yoxdur");
    expect(value("Siqnala cavab müddəti (median)")).toBe("— cavablanan yoxdur");
    expect(value("Təhvilin əks-imza müddəti (median)")).toBe("— əks-imzalanan yoxdur");
    expect(value("Eskalasiya edilən siqnal")).toBe("0");
  });
});

describe("every number is real or says why not", () => {
  it("while reading: «—» and «oxunur…», never 0, under a heading that claims no reach", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockReturnValue(new Promise(() => {})) });
    expect(value("RRT çağırışı")).toBe("— oxunur…");
    expect(units()).toHaveTextContent("Keyfiyyət göstəriciləri oxunur…");
    expect(document.querySelector("[data-as-of]")).toHaveTextContent("Hələ oxunmayıb");
    expect(screen.getByRole("heading", { level: 2, name: "Göstəricilər · son 7 gün" })).toBeInTheDocument();
  });

  it("a refusal is no right; a failure and a malformed answer could not be read — each with its reason", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockRejectedValue(refusal(403, "permission required: quality.view")) });
    expect(value("RRT çağırışı")).toBe("— səlahiyyət yoxdur");
    expect(units()).toHaveTextContent("Cədvəl yazıla bilmir · səlahiyyət yoxdur");
    expect(document.querySelector("[data-failed]")).toBeNull();
    cleanup();
    await mountKalite({ setup: (api) => api.qualityIndicators.mockRejectedValue(refusal(503, "down")) });
    expect(document.querySelector("[data-failed]")).toHaveTextContent("Keyfiyyət göstəriciləri oxunmadı:");
    expect(value("RRT çağırışı")).toBe("— oxunmadı");
    cleanup();
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue(
      { ...ANSWER, units: [{ ...ANSWER.units[1], rrt: { count: "1" } }] }) });
    expect(document.querySelector("[data-failed]").textContent).toMatch(/Keyfiyyət göstəriciləri oxunmadı\.$/);
    expect(value("RRT çağırışı")).toBe("— oxunmadı");
  });

  it("another period's answer is no answer for this one: «— oxunmadı»", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue({ ...ANSWER, days: 30 }) });
    expect(document.querySelector("[data-failed]").textContent).toMatch(/Keyfiyyət göstəriciləri oxunmadı\.$/);
    expect(value("RRT çağırışı")).toBe("— oxunmadı");
    expect(screen.queryByRole("table", { name: UNITS_TABLE })).toBeNull();
  });
});

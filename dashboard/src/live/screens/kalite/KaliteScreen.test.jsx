// KaliteScreen.test.jsx — «Keyfiyyət göstəriciləri» (G4-03, spec D5): one h1 and no patient anywhere; the coverage line;
// the cards; the units table with «Şöbəsi bəlli olmayan» and «Cəmi»; a unit selected by its name; the snooze reasons
// and the alarms by kind for the selection; the period switch, the newest read winning, «Yenilə»; a truncated read; a
// scoped caller and one who reaches nothing; reading, 403, a failure and a malformed answer, each with its reason. The
// default language is az. Synthetic answers (kalite.testutil.js).
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { ddmmhhmm } from "../../i18n/dates.js";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { expectNoUuid } from "../kabul/kabul.testutil.js";
import { KaliteScreen } from "./KaliteScreen.jsx";
import { ANSWER, NOTHING, SCOPED, deferred } from "./kalite.testutil.js";

afterEach(() => { cleanup(); });

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

const cells = (row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent);
const card = (name) => screen.getByRole("heading", { level: 3, name }).closest("li");
const value = (name) => card(name).querySelector("[data-card-value]").textContent;
const rows = () => within(screen.getByRole("table", { name: "Şöbələrə görə keyfiyyət göstəriciləri" }))
  .getAllByRole("row").slice(1).map(cells);
const snoozeRows = () => within(screen.getByRole("table", { name: "Təxirə salma səbəbləri" })).getAllByRole("row").map(cells);
const coverage = () => document.querySelector("[data-coverage]");

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

  it("draws a row per unit, then «Şöbəsi bəlli olmayan», then «Cəmi»", async () => {
    await mountKalite();
    expect(rows()).toEqual([
      ["Neonatal", "1", "4 dəq 0 san", "4 dəq 0 san", "100%", "0", "0 (0)", "1", "0", "1 / 1 / 0", "1 dəq 0 san"],
      ["Reanimasiya", "6", "3 dəq 0 san", "10 dəq 0 san", "60%", "1", "2 (1)", "2", "1", "6 / 2 / 1", "10 dəq 0 san"],
      ["Şöbəsi bəlli olmayan", "2", "1 dəq 0 san", "1 dəq 0 san", "50%", "0", "1 (0)", "1", "1", "", ""],
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

  it("says a truncated read is one, and from when the alarms are counted", async () => {
    const from = "2026-11-08T06:00:00+00:00";
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue({ ...ANSWER, truncated: true, window_from: from }) });
    expect(coverage()).toHaveTextContent(
      `Serverin oxuma həddi aşıldı: yalnız ən yeni qeydlər oxundu; siqnal, təxirə salma və RRT sayları ${ddmmhhmm(Date.parse(from))} ilə başlayır`);
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

  it("«Yenilə» reads the same period again", async () => {
    const { api } = await mountKalite();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); });
    await settle();
    expect(api.qualityIndicators).toHaveBeenCalledTimes(2);
    expect(api.qualityIndicators).toHaveBeenLastCalledWith(7);
  });
});

describe("a caller whose scope is restricted", () => {
  it("reads only her units: no unplaced row, and the line says so", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue(SCOPED) });
    expect(coverage()).toHaveTextContent("Yalnız əhatənizdəki şöbələr: bu dövrdə bu şöbələrə 6 siqnal epizodu bağlandı.");
    expect(rows().map((row) => row[0])).toEqual(["Reanimasiya", "Cəmi"]);
    expect(screen.getByRole("heading", { level: 2, name: "Əhatənizdəki şöbələr · son 7 gün" })).toBeInTheDocument();
  });

  it("with no unit in her reach: the page says so, and its zeros are the answer's own", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue(NOTHING) });
    expect(document.querySelector("[data-units]")).toHaveTextContent("Əhatənizdə şöbə yoxdur.");
    expect(value("Cavablanan siqnal")).toBe("— hələ yekunlaşan yoxdur");
    expect(value("Siqnala cavab müddəti (median)")).toBe("— cavablanan yoxdur");
    expect(value("Təhvilin əks-imza müddəti (median)")).toBe("— əks-imzalanan yoxdur");
    expect(value("Eskalasiya edilən siqnal")).toBe("0");
  });
});

describe("every number is real or says why not", () => {
  it("while reading: «—» and «oxunur…», never 0", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockReturnValue(new Promise(() => {})) });
    expect(value("RRT çağırışı")).toBe("— oxunur…");
    expect(document.querySelector("[data-units]")).toHaveTextContent("Keyfiyyət göstəriciləri oxunur…");
    expect(document.querySelector("[data-as-of]")).toHaveTextContent("Hələ oxunmayıb");
  });

  it("a refusal is no right; a failure and a malformed answer could not be read — each with its reason", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockRejectedValue(refusal(403, "permission required: quality.view")) });
    expect(value("RRT çağırışı")).toBe("— səlahiyyət yoxdur");
    expect(document.querySelector("[data-units]")).toHaveTextContent("Cədvəl yazıla bilmir · səlahiyyət yoxdur");
    expect(document.querySelector("[data-failed]")).toBeNull();
    cleanup();
    await mountKalite({ setup: (api) => api.qualityIndicators.mockRejectedValue(refusal(503, "down")) });
    expect(document.querySelector("[data-failed]")).toHaveTextContent("Keyfiyyət göstəriciləri oxunmadı:");
    expect(value("RRT çağırışı")).toBe("— oxunmadı");
    cleanup();
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue(
      { ...ANSWER, units: [{ ...ANSWER.units[0], rrt: { count: "1" } }] }) });
    expect(document.querySelector("[data-failed]").textContent).toMatch(/Keyfiyyət göstəriciləri oxunmadı\.$/);
    expect(value("RRT çağırışı")).toBe("— oxunmadı");
  });
});

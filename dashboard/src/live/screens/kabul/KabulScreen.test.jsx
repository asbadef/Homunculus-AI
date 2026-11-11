// The Hasta Kabul screen (Group 2 · B1a, spec §5.1): one h1, the two tabs gated by the rights
// each acts with, and the route that opens it for whoever reads, admits, confirms or releases.
import { describe, it, expect } from "vitest";
import React from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { ROUTES, canReach } from "../../shell/routes.js";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { LANG_CODES } from "../../i18n/langs.js";
import { KABUL_TABS, KabulScreen, kabulTabs } from "./KabulScreen.jsx";
import { CHARGE, DOCTOR, NURSE, UUID_TEXT, mountKabul } from "./kabul.testutil.js";

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);

describe("KabulScreen", () => {
  it("is a route for the admission rights, and no other", () => {
    const route = ROUTES.find((r) => r.id === "kabul");
    expect(route.path).toBe("/kabul");
    for (const perms of [["admissions.view"], ["admissions.admit"], ["admissions.discharge.confirm"]]) {
      expect(canReach(route, perms), perms[0]).toBe(true);
    }
    expect(canReach(route, ["board.view", "alerts.ack"])).toBe(false);
    // G2-B3a (X7): the beds moved to Doluluk; a session that only releases beds lands there.
    expect(canReach(route, ["beds.release"])).toBe(false);
  });

  it("offers each tab to the rights it acts with", () => {
    expect(KABUL_TABS.map((tab) => tab.id)).toEqual(["admit", "discharge"]);
    expect(kabulTabs(["beds.release"]).map((tab) => tab.id)).toEqual([]);
    expect(kabulTabs(["admissions.admit"]).map((tab) => tab.id)).toEqual(["admit"]);
    expect(kabulTabs(["admissions.discharge.confirm"]).map((tab) => tab.id)).toEqual(["discharge"]);
    expect(kabulTabs([]).map((tab) => tab.id)).toEqual([]);
  });

  it("opens on Kabul for a nurse, with one h1, and moves between the tabs", async () => {
    await mountKabul(<KabulScreen />, { perms: NURSE });
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Xəstə qəbulu"]);
    expect(tabNames()).toEqual(["Qəbul", "Köçürmə / Evə yazılma"]);
    expect(screen.getByRole("tab", { name: "Qəbul" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Köçürmə / Evə yazılma" }));
    expect(screen.getByRole("tab", { name: "Köçürmə / Evə yazılma" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby"))
      .toBe(screen.getByRole("tab", { name: "Köçürmə / Evə yazılma" }).id);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  // G2-B3a (X7, the browser walk): the beds moved to Doluluk, so the subtitle names admission and
  // discharge only — in every language.
  it("says under its title that it is for admission and discharge, not the beds' state", async () => {
    await mountKabul(<KabulScreen />, { perms: NURSE });
    expect(screen.getByText("Qəbul və evə yazılma — öz şöbələriniz.")).toBeTruthy();
    expect(Object.fromEntries(LANG_CODES.map((lang) => [lang, DICTIONARIES[lang]["kabul.sub"]]))).toEqual({
      tr: "Kabul ve taburcu — kendi birimleriniz.",
      az: "Qəbul və evə yazılma — öz şöbələriniz.",
      ru: "Приём и выписка — ваши отделения.",
      en: "Admission and discharge — your own units.",
    });
  });

  it("shows a physician and a charge nurse both tabs", async () => {
    await mountKabul(<KabulScreen />, { perms: DOCTOR });
    expect(tabNames()).toEqual(["Qəbul", "Köçürmə / Evə yazılma"]);
    cleanup();
    await mountKabul(<KabulScreen />, { perms: CHARGE });
    expect(tabNames()).toEqual(["Qəbul", "Köçürmə / Evə yazılma"]);
  });

  it("says so to a session that may open none of them", async () => {
    await mountKabul(<KabulScreen />, { perms: ["board.view"] });
    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(screen.getByText("Bu ekranın heç bir bölməsinə səlahiyyətiniz yoxdur.")).toBeTruthy();
  });
});

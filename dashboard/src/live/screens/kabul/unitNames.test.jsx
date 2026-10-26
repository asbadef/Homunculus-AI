// The top bar's unit chooser and the bed board's unit selector name each unit from the structure —
// never its UUID (Group 2 · B1a, spec D9, §5.7). The engine's scope lists unit ids; since B1a they
// are the tenant's UUIDs.
//
// And while the structure is not known — still being read, or the read failed — a unit is a
// numbered placeholder ("Şöbə 1"), never «unknown»: "unknown" is a claim about a unit, and none can
// be made until the structure has been read (Task 12 review, I-1).
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { createTranslator } from "../../i18n/translate.js";
import { TopBar } from "../../shell/TopBar.jsx";
import { BedsScreen } from "../beds/BedsScreen.jsx";
import { ScopeEditor } from "../admin/ScopeEditor.jsx";
import { scopeFromApi } from "../admin/rules.js";
import { refusal } from "../../session/mount.testutil.jsx";
import { BED, NEO, REA, expectNoUuid, mountKabul, structure } from "./kabul.testutil.js";

const az = createTranslator("az", DICTIONARIES);
const PERMS = ["board.view", "admissions.view"];
const GHOST = "99999999-9999-4999-8999-999999999999";
const SHELL = { units: [REA, NEO] };

/** The two states in which the structure is not known. */
const NOT_KNOWN = {
  "still being read": (api) => api.structure.mockReturnValue(new Promise(() => {})),
  "unreadable (503)": (api) => api.structure.mockRejectedValue(refusal(503, "Sunucuya şu an ulaşılamıyor")),
};

const optionsOf = (select) => within(select).getAllByRole("option").map((o) => o.textContent);
const chip = () => screen.getByRole("button", { name: /^Göstərilən bölmə/ });
/** Open the chip's menu and read its items. */
function menuItems() {
  fireEvent.click(chip());
  return within(screen.getByRole("menu")).getAllByRole("menuitemradio").map((el) => el.textContent);
}

describe("the top bar's unit chooser", () => {
  it("names each unit from the structure, in the order of the names", async () => {
    await mountKabul(<TopBar title="Yataklar" />, { perms: PERMS, shell: SHELL });
    expect(menuItems()).toEqual(["Bütün bölmələrim", "Neonatal", "Reanimasiya"]);
    expectNoUuid();
  });

  it("shows, on the chip and in its name, the unit it shows", async () => {
    await mountKabul(<TopBar title="Yataklar" />, { perms: PERMS, shell: SHELL });
    expect(chip()).toHaveAccessibleName("Göstərilən bölmə");
    expect(chip()).toHaveTextContent("Bölmələrim · 2");
    menuItems();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Reanimasiya" }));
    expect(chip()).toHaveTextContent("Reanimasiya");
    expect(chip()).toHaveAccessibleName("Göstərilən bölmə: Reanimasiya");
    expectNoUuid();
  });

  it("numbers two units that share a name, so the chooser never offers two alike", async () => {
    const twins = structure();
    twins.sites[0].units[1].name = "Reanimasiya";
    await mountKabul(<TopBar title="Yataklar" />, {
      perms: PERMS, shell: SHELL, setup: (api) => api.structure.mockResolvedValue(twins) });
    expect(menuItems()).toEqual(["Bütün bölmələrim", "Reanimasiya (1)", "Reanimasiya (2)"]);
  });

  for (const [state, setup] of Object.entries(NOT_KNOWN)) {
    it(`tells the units apart by number while the structure is ${state}, and never says «unknown»`, async () => {
      await mountKabul(<TopBar title="Yataklar" />, { perms: PERMS, shell: SHELL, setup });
      expect(menuItems()).toEqual(["Bütün bölmələrim", "Şöbə 1", "Şöbə 2"]);
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Şöbə 2" }));
      expect(chip()).toHaveTextContent("Şöbə 2");
      expect(chip()).toHaveAccessibleName("Göstərilən bölmə: Şöbə 2");
      expect(document.body.textContent).not.toMatch(/Naməlum/);
      expectNoUuid();
    });
  }
});

describe("the bed board's own unit selector", () => {
  it("names each unit from the structure, in the order of the names, and the subtitle names the chosen one", async () => {
    await mountKabul(<BedsScreen />, { perms: PERMS, shell: SHELL });
    const select = screen.getByRole("combobox");
    expect(optionsOf(select)).toEqual(["Hamısı", "Neonatal", "Reanimasiya"]);
    fireEvent.change(select, { target: { value: REA } });
    expect(screen.getByText("Reanimasiya", { selector: "p" })).toBeTruthy();   // the subtitle itself
    expectNoUuid();
  });

  it("reads «unknown unit» for an id the structure, once known, does not hold — still never the UUID", async () => {
    await mountKabul(<BedsScreen />, { perms: PERMS, shell: { units: [REA, GHOST] } });
    expect(optionsOf(screen.getByRole("combobox"))).toEqual(["Hamısı", "Naməlum şöbə", "Reanimasiya"]);
    expectNoUuid();
  });

  for (const [state, setup] of Object.entries(NOT_KNOWN)) {
    it(`tells the units apart by number while the structure is ${state}, and never says «unknown»`, async () => {
      await mountKabul(<BedsScreen />, { perms: PERMS, shell: SHELL, setup });
      const select = screen.getByRole("combobox");
      expect(optionsOf(select)).toEqual(["Hamısı", "Şöbə 1", "Şöbə 2"]);
      fireEvent.change(select, { target: { value: NEO } });
      expect(screen.getByText("Şöbə 2", { selector: "p" })).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/Naməlum/);
      expectNoUuid();
    });
  }
});

describe("the administrator's scope editor", () => {
  const GRANTS = [{ unit_id: REA, bed_id: "" }, { unit_id: NEO, bed_id: "" }, { unit_id: "", bed_id: BED(5) },
    { unit_id: "", bed_id: GHOST }, { unit_id: "unit-adult", bed_id: "" }];
  const open = (options = {}) => mountKabul(
    <ScopeEditor user={{ username: "ayse", fullName: "Ayşe Sentetik" }} mayAssign
      scope={scopeFromApi({ user_id: "u-1", unrestricted: false, reason: "assigned", grants: GRANTS })}
      save={vi.fn()} reread={vi.fn()} onSaved={vi.fn()} onRefused={vi.fn()} onClose={vi.fn()} />,
    { perms: ["users.manage"], ...options });
  const choicesOf = (legend) => within(screen.getByRole("group", { name: legend })).getAllByRole("checkbox")
    .map((box) => box.closest("label").textContent);

  it("names the units and beds a grant holds, and offers them in the order of the names", async () => {
    await open();
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("rowheader", { name: "Reanimasiya" })).toBeTruthy();
    expect(table.getByText("5 · Reanimasiya")).toBeTruthy();
    expect(table.getByText("Naməlum çarpayı")).toBeTruthy();
    expect(table.getByRole("rowheader", { name: "unit-adult" })).toBeTruthy();   // a key typed by hand
    expect(choicesOf(az("admin.scopeUnits"))).toEqual(["Neonatal", "Reanimasiya", "unit-adult"]);
    expect(screen.queryByText(az("kabul.namesPending"))).toBeNull();
    expectNoUuid();
  });

  it("gives its icon-only Remove button the unit's name, not its key", async () => {
    await open();
    expect(screen.getByRole("button", { name: `${az("admin.remove")}: Reanimasiya` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${az("admin.remove")}: 5 · Reanimasiya` })).toBeTruthy();
    expectNoUuid();
  });

  for (const [state, setup] of Object.entries(NOT_KNOWN)) {
    it(`says names cannot be shown yet while the structure is ${state}, and does not call a grant «unknown»`, async () => {
      await open({ setup });
      expect(screen.getByText(az("kabul.namesPending"))).toBeTruthy();
      const table = within(screen.getByRole("table"));
      expect(table.getByRole("rowheader", { name: "Şöbə 1" })).toBeTruthy();   // the placeholder numbers the offered units
      expect(table.getByRole("rowheader", { name: "unit-adult" })).toBeTruthy();   // a key typed by hand stays
      expect(table.getByText("Çarpayı 1")).toBeTruthy();
      expect(table.getByText("Çarpayı 2")).toBeTruthy();
      expect(screen.getByRole("button", { name: `${az("admin.remove")}: Şöbə 1` })).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/Naməlum/);
      expectNoUuid();
    });
  }
});

// The top bar's unit chooser and the bed board's unit selector name each unit from the structure —
// never its UUID (Group 2 · B1a, spec D9, §5.7). The engine's scope lists unit ids; since B1a they
// are the tenant's UUIDs.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { ShellProvider } from "../../shell/ShellContext.jsx";
import { TopBar } from "../../shell/TopBar.jsx";
import { BedsScreen } from "../beds/BedsScreen.jsx";
import { ScopeEditor } from "../admin/ScopeEditor.jsx";
import { scopeFromApi } from "../admin/rules.js";
import { BED, NEO, REA, UUID_TEXT, mountKabul } from "./kabul.testutil.js";

const PERMS = ["board.view", "admissions.view"];

describe("a unit is named, never numbered", () => {
  it("in the top bar's chooser", async () => {
    await mountKabul(<ShellProvider units={[REA, NEO]} scope="known"><TopBar title="Yataklar" /></ShellProvider>,
      { perms: PERMS });
    fireEvent.click(screen.getByRole("button", { name: "Göstərilən bölmə" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitemradio", { name: "Reanimasiya" })).toBeTruthy();
    expect(within(menu).getByRole("menuitemradio", { name: "Neonatal" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("in the bed board's own selector", async () => {
    await mountKabul(<ShellProvider units={[REA, NEO]} scope="known"><BedsScreen /></ShellProvider>, { perms: PERMS });
    const select = screen.getByRole("combobox");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Hamısı", "Reanimasiya", "Neonatal"]);
    fireEvent.change(select, { target: { value: REA } });
    expect(document.body.textContent).toMatch(/Reanimasiya/);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("in the administrator's scope editor, the units and beds a grant names", async () => {
    const scope = scopeFromApi({ user_id: "u-1", unrestricted: false, reason: "assigned",
      grants: [{ unit_id: REA, bed_id: "" }, { unit_id: "", bed_id: BED(5) },
        { unit_id: "", bed_id: "99999999-9999-4999-8999-999999999999" }, { unit_id: "unit-adult", bed_id: "" }] });
    await mountKabul(<ScopeEditor user={{ username: "ayse", fullName: "Ayşe Sentetik" }} scope={scope} mayAssign
      save={vi.fn()} reread={vi.fn()} onSaved={vi.fn()} onRefused={vi.fn()} onClose={vi.fn()} />, { perms: ["users.manage"] });
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("rowheader", { name: "Reanimasiya" })).toBeTruthy();
    expect(table.getByText("5 · Reanimasiya")).toBeTruthy();
    expect(table.getByText("Naməlum çarpayı")).toBeTruthy();
    expect(table.getByRole("rowheader", { name: "unit-adult" })).toBeTruthy();   // a key typed by hand
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("an id the structure does not hold reads «unknown unit», still never the UUID", async () => {
    const ghost = "99999999-9999-4999-8999-999999999999";
    await mountKabul(<ShellProvider units={[REA, ghost]} scope="known"><BedsScreen /></ShellProvider>, { perms: PERMS });
    const options = within(screen.getByRole("combobox")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Hamısı", "Reanimasiya", "Naməlum şöbə"]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });
});

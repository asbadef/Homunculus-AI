// The top bar's unit chooser and the bed board's unit selector name each unit from the structure —
// never its UUID (Group 2 · B1a, spec D9, §5.7). The engine's scope lists unit ids; since B1a they
// are the tenant's UUIDs.
//
// And while the structure is not known — still being read, or the read failed — a unit is a
// numbered placeholder ("Şöbə 1"), never «unknown»: "unknown" is a claim about a unit, and none can
// be made until the structure has been read (Task 12 review, I-1).
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { createTranslator } from "../../i18n/translate.js";
import { TopBar } from "../../shell/TopBar.jsx";
import { BedsScreen } from "../beds/BedsScreen.jsx";
import { ScopeEditor } from "../admin/ScopeEditor.jsx";
import { ScopeNote } from "../common/BoardState.jsx";
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

/** The scope editor for a user holding these grants (as GET /scope/{id} answers them). */
const editorFor = (grants, save = vi.fn()) => (
  <ScopeEditor user={{ username: "ayse", fullName: "Ayşe Sentetik" }} mayAssign
    scope={scopeFromApi({ user_id: "u-1", unrestricted: false, reason: "assigned", grants })}
    save={save} reread={vi.fn()} onSaved={vi.fn()} onRefused={vi.fn()} onClose={vi.fn()} />
);
const rowHeaders = () => within(screen.getByRole("table")).getAllByRole("rowheader").map((th) => th.textContent);

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

  // The last read failed after one succeeded: the tree is the last answer, and a unit it lacks may
  // be one added since (the re-read it prompted is what failed) — it is numbered, not «unknown».
  it("keeps the names a stale tree holds and numbers a unit it lacks, never calling it «unknown»", async () => {
    await mountKabul(<TopBar title="Yataklar" />, {
      perms: PERMS, shell: { units: [REA, GHOST] },
      setup: (api) => api.structure.mockResolvedValueOnce(structure())
        .mockRejectedValue(refusal(503, "Sunucuya şu an ulaşılamıyor")),
    });
    // Its number is the one it had while the first read was out, when Reanimasiya was "Şöbə 1" and it
    // was "Şöbə 2": a number stays with its unit even after the other has been named.
    expect(menuItems()).toEqual(["Bütün bölmələrim", "Reanimasiya", "Şöbə 2"]);
    expect(document.body.textContent).not.toMatch(/Naməlum/);
    expectNoUuid();
  });

  // The scope lists a unit the tree lacks and the structure is being read again for it: until that
  // read lands the tree is no answer about that unit — a placeholder; after it, the claim.
  it("does not call a unit «unknown» while the read made for it is out, and does once that read has landed", async () => {
    let land;
    await mountKabul(<TopBar title="Yataklar" />, {
      perms: PERMS, shell: { units: [REA, GHOST] },
      setup: (api) => api.structure.mockResolvedValueOnce(structure())
        .mockReturnValueOnce(new Promise((resolve) => { land = resolve; })),
    });
    expect(menuItems()).toEqual(["Bütün bölmələrim", "Reanimasiya", "Şöbə 2"]);
    expect(document.body.textContent).not.toMatch(/Naməlum/);
    fireEvent.click(chip());                                    // shut the menu
    expect(screen.queryByRole("menu")).toBeNull();
    await act(async () => { land(structure()); });              // the read lands, still without the unit
    expect(menuItems()).toEqual(["Bütün bölmələrim", "Naməlum şöbə 2", "Reanimasiya"]);
    expectNoUuid();
  });
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
    expect(optionsOf(screen.getByRole("combobox"))).toEqual(["Hamısı", "Naməlum şöbə 2", "Reanimasiya"]);
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

// Walk I-1: the engine listed the grant keys no card matched inside a Turkish sentence, and since
// B1a those keys are UUIDs — one was printed on a nurse's board. The engine now sends them as data,
// units apart from beds, and the note says the sentence itself, in the reader's language.
describe("the board's scope note", () => {
  const UNMATCHED_AZ = "Əhatənizdəki bu şöbə və çarpayıların paneldə kartı yoxdur:";
  const note = (scope) => (
    <ScopeNote scope={{ unrestricted: false, reason: "assigned", hidden: 0, blind: false, ...scope }} scopeNote={null} />
  );

  it("names a granted unit and bed that have no card, in the reader's language, and never prints their UUIDs", async () => {
    await mountKabul(note({ unmatched_unit_ids: [NEO], unmatched_bed_ids: [BED(5)] }), { perms: PERMS });
    const box = screen.getByRole("note");
    expect(box).toHaveTextContent(`${UNMATCHED_AZ} Neonatal, 5 · Otaq 2 · Reanimasiya`);
    // The sentence is the screen's own now: no Turkish server prose, so no "the server wrote this".
    expect(box.querySelector('[lang="tr"]')).toBeNull();
    expect(box).not.toHaveTextContent(az("board.scopeNoteLang"));
    expect(box).not.toHaveTextContent(az("kabul.namesPending"));     // every name is a name
    expectNoUuid();
  });

  // A-43: a numbered placeholder is not a name, and the note says so, as the scope editor does.
  for (const [state, setup] of Object.entries(NOT_KNOWN)) {
    it(`numbers a key while the structure is ${state}, says the numbers are placeholders, and still never prints its UUID`, async () => {
      await mountKabul(note({ unmatched_unit_ids: [NEO], unmatched_bed_ids: [BED(5)] }), { perms: PERMS, setup });
      expect(screen.getByRole("note")).toHaveTextContent(`${UNMATCHED_AZ} Şöbə 1, Çarpayı 1`);
      expect(screen.getByRole("note")).toHaveTextContent(az("kabul.namesPending"));
      expectNoUuid();
    });
  }

  it("says the numbers are placeholders for a session the structure is not read for at all", async () => {
    // board.view alone opens no structure read (phase "unasked"): every key stays a number.
    await mountKabul(note({ unmatched_unit_ids: [NEO], unmatched_bed_ids: [BED(5)] }), { perms: ["board.view"] });
    expect(screen.getByRole("note")).toHaveTextContent(`${UNMATCHED_AZ} Şöbə 1, Çarpayı 1`);
    expect(screen.getByRole("note")).toHaveTextContent(az("kabul.namesPending"));
    expectNoUuid();
  });

  // A-43: the structure has been read and does not hold the key — that is a claim, «unknown unit N»,
  // not a placeholder, so nothing says a name is still to come.
  it("calls a key the structure, once read, does not hold «unknown unit N» — never its UUID, never a placeholder", async () => {
    await mountKabul(note({ unmatched_unit_ids: [GHOST], unmatched_bed_ids: [BED(5)] }), { perms: PERMS });
    const box = screen.getByRole("note");
    expect(box).toHaveTextContent(`${UNMATCHED_AZ} Naməlum şöbə 1, 5 · Otaq 2 · Reanimasiya`);
    expect(box).not.toHaveTextContent(az("kabul.namesPending"));
    expectNoUuid();
  });

  it("leaves a blind board to the engine's own sentence", async () => {
    // Nothing came through the scope at all: the engine says that (in Turkish, marked so), and the
    // list of keys would only repeat it.
    const blind = "Kapsamınızda panoda karşılığı olan hiçbir yatak yok — pano boş görünmesi koğuşun sakin olduğu anlamına GELMEZ.";
    await mountKabul(
      <ScopeNote scope={{ unrestricted: false, hidden: 0, blind: true, unmatched_unit_ids: [NEO] }} scopeNote={blind} />,
      { perms: PERMS },
    );
    expect(screen.getByRole("note")).toHaveTextContent(blind);
    expect(screen.getByRole("note")).not.toHaveTextContent(UNMATCHED_AZ);
    expectNoUuid();
  });

  it("says nothing of keys when every grant has a card", async () => {
    await mountKabul(note({ unmatched_unit_ids: [], unmatched_bed_ids: [] }), { perms: PERMS });
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("the administrator's scope editor", () => {
  const GRANTS = [{ unit_id: REA, bed_id: "" }, { unit_id: NEO, bed_id: "" }, { unit_id: "", bed_id: BED(5) },
    { unit_id: "", bed_id: GHOST }, { unit_id: "unit-adult", bed_id: "" }];
  const open = (options = {}) => mountKabul(editorFor(GRANTS), { perms: ["users.manage"], ...options });
  const choicesOf = (legend) => within(screen.getByRole("group", { name: legend })).getAllByRole("checkbox")
    .map((box) => box.closest("label").textContent);

  it("names the units and beds a grant holds, and offers them in the order of the names", async () => {
    await open();
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("rowheader", { name: "Reanimasiya" })).toBeTruthy();
    expect(table.getByText("5 · Otaq 2 · Reanimasiya")).toBeTruthy();       // one bed wording (A-17)
    expect(table.getByText("Naməlum çarpayı 2")).toBeTruthy();          // numbered as it was a placeholder: 1 is bed 5
    expect(table.getByRole("rowheader", { name: "unit-adult" })).toBeTruthy();   // a key typed by hand
    expect(choicesOf(az("admin.scopeUnits"))).toEqual(["Neonatal", "Reanimasiya", "unit-adult"]);
    expect(screen.queryByText(az("kabul.namesPending"))).toBeNull();
    expectNoUuid();
  });

  // Walk I-2: the editor offered only the units and beds that had a card on the board, or a grant
  // already — an empty unit could not be granted by name, and the typed-key box asked for a key
  // («e.g. REA-01») that has been a UUID since B1a. The structure offers every unit and bed now.
  it("offers every unit and bed of the structure by name, an empty one included, and grants it by name", async () => {
    const save = vi.fn().mockResolvedValue({});
    await mountKabul(editorFor([], save), { perms: ["users.manage"] });
    // No card stands on any bed here: the board offers nothing, the structure offers all of it —
    // a unit with its name, a bed as "label · room · unit", in the structure's own order.
    expect(choicesOf(az("admin.scopeUnits"))).toEqual(["Neonatal", "Reanimasiya"]);
    expect(choicesOf(az("admin.scopeBeds"))).toEqual([
      "1 · Otaq 1 · Reanimasiya", "2 · Otaq 1 · Reanimasiya", "3 · Otaq 1 · Reanimasiya", "4 · Otaq 1 · Reanimasiya",
      "5 · Otaq 2 · Reanimasiya", "N1 · N-1 · Neonatal",
    ]);
    expect(screen.getByText(/Seçimlər xəstəxananın strukturundan/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Neonatal" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "5 · Otaq 2 · Reanimasiya" }));
    expect(rowHeaders()).toEqual(["Neonatal", "—"]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: az("admin.scopeSave") })); });
    expect(save).toHaveBeenCalledWith([{ unit_id: NEO }, { bed_id: BED(5) }], []);
    expectNoUuid();
  });

  // A-43 (after the walk-fix review): keys are compared as the engine compares them (`normId`:
  // trimmed, case-folded). A grant the server holds in another case than the structure's id is the
  // same place: it shows ticked, the place is offered once, and it can never be granted twice.
  it("ticks a held grant whose key differs from the structure's only in case, and offers that place once", async () => {
    const UNIT = "abcdef00-0000-4000-8000-0000000000a1";
    const SPOT = "abcdef00-0000-4000-8000-0000000000b5";
    const tree = structure();
    tree.sites[0].units[0].id = UNIT;
    tree.sites[0].units[0].rooms[1].beds[0].id = SPOT;
    const save = vi.fn().mockResolvedValue({});
    await mountKabul(editorFor([{ unit_id: UNIT.toUpperCase(), bed_id: "" }, { unit_id: "", bed_id: SPOT.toUpperCase() }], save), {
      perms: ["users.manage"], setup: (api) => api.structure.mockResolvedValue(tree) });
    expect(choicesOf(az("admin.scopeUnits"))).toEqual(["Neonatal", "Reanimasiya"]);
    expect(choicesOf(az("admin.scopeBeds"))).toEqual([
      "1 · Otaq 1 · Reanimasiya", "2 · Otaq 1 · Reanimasiya", "3 · Otaq 1 · Reanimasiya", "4 · Otaq 1 · Reanimasiya",
      "5 · Otaq 2 · Reanimasiya", "N1 · N-1 · Neonatal",
    ]);
    expect(screen.getByRole("checkbox", { name: "Reanimasiya" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "5 · Otaq 2 · Reanimasiya" })).toBeChecked();
    // Unticking it removes the grant the server holds, whatever its case: nothing is left to save twice.
    fireEvent.click(screen.getByRole("checkbox", { name: "Reanimasiya" }));
    expect(rowHeaders()).toEqual(["—"]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: az("admin.scopeSave") })); });
    expect(save).toHaveBeenCalledWith([{ bed_id: SPOT.toUpperCase() }],
      [{ unit_id: UNIT.toUpperCase() }, { bed_id: SPOT.toUpperCase() }]);
    expectNoUuid();
  });

  it("has no box for typing a key: every key is a unit or a bed the structure names", async () => {
    await open();
    expect(within(screen.getByRole("dialog")).queryByRole("textbox")).toBeNull();
    expect(document.body.textContent).not.toMatch(/REA-01/);
  });

  it("gives its icon-only Remove button the unit's name, not its key", async () => {
    await open();
    expect(screen.getByRole("button", { name: `${az("admin.remove")}: Reanimasiya` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${az("admin.remove")}: 5 · Otaq 2 · Reanimasiya` })).toBeTruthy();
    expectNoUuid();
  });

  // The probe of the re-review: a stale tree names Reanimasiya, not the unit added since — and the
  // list read "Reanimasiya, Şöbə 2" with nothing saying the second was a placeholder.
  it("says so when only some of its names are placeholders: a stale tree names what it holds", async () => {
    await mountKabul(editorFor([REA, GHOST].map((id) => ({ unit_id: id, bed_id: "" }))), {
      perms: ["users.manage"], shell: { units: [REA, GHOST] },
      setup: (api) => api.structure.mockResolvedValueOnce(structure())
        .mockRejectedValue(refusal(503, "Sunucuya şu an ulaşılamıyor")),
    });
    expect(rowHeaders()).toEqual(["Reanimasiya", "Şöbə 2"]);
    expect(screen.getByText(az("kabul.namesPending"))).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Naməlum/);
    expectNoUuid();
  });

  for (const [state, setup] of Object.entries(NOT_KNOWN)) {
    it(`says names cannot be shown yet while the structure is ${state}, and does not call a grant «unknown»`, async () => {
      await open({ setup });
      expect(screen.getByText(az("kabul.namesPending"))).toBeTruthy();
      // Only what is known is offered, and the editor says why the list is short (walk I-2).
      expect(screen.getByText(/Xəstəxananın strukturu hələ oxunmayıb/)).toBeTruthy();
      const table = within(screen.getByRole("table"));
      expect(table.getByRole("rowheader", { name: "Şöbə 1" })).toBeTruthy();   // the placeholder numbers the offered units
      expect(table.getByRole("rowheader", { name: "Şöbə 2" })).toBeTruthy();   // ... each its own: Neonatal is not Reanimasiya
      expect(table.getByRole("rowheader", { name: "unit-adult" })).toBeTruthy();   // a key typed by hand stays
      expect(table.getByText("Çarpayı 1")).toBeTruthy();
      expect(table.getByText("Çarpayı 2")).toBeTruthy();
      expect(screen.getByRole("button", { name: `${az("admin.remove")}: Şöbə 1` })).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/Naməlum/);
      expectNoUuid();
    });
  }
});

// With the structure unreadable, a placeholder is the only thing that tells two units apart where
// an administrator may remove one: "Şöbə 1" must never come to mean another unit than it did a
// moment ago (Task 12 re-review, I-A) — whatever is removed, typed or shown elsewhere.
describe("a placeholder number in the scope editor", () => {
  const C = "33333333-3333-4333-8333-333333333303";
  const THREE = [REA, NEO, C].map((id) => ({ unit_id: id, bed_id: "" }));
  const down = NOT_KNOWN["unreadable (503)"];

  it("stays with its unit when the grant before it is removed", async () => {
    await mountKabul(editorFor(THREE), { perms: ["users.manage"], setup: down });
    expect(rowHeaders()).toEqual(["Şöbə 1", "Şöbə 2", "Şöbə 3"]);
    fireEvent.click(screen.getByRole("button", { name: `${az("admin.remove")}: Şöbə 1` }));
    expect(rowHeaders()).toEqual(["Şöbə 2", "Şöbə 3"]);                     // not 1 and 2
    const boxes = within(screen.getByRole("group", { name: az("admin.scopeUnits") })).getAllByRole("checkbox");
    expect(boxes.map((box) => box.closest("label").textContent)).toEqual(["Şöbə 2", "Şöbə 3"]);
  });

  it("is the number the top bar gave the same unit — one count for the whole shell", async () => {
    // The scope lists Neonatal first, so the top bar numbers it 1; the editor lists its keys in
    // another order (Reanimasiya's key sorts first) and must still call Neonatal "Şöbə 1".
    function Both() {
      const [editing, setEditing] = React.useState(false);
      return (
        <>
          <TopBar title="Yataklar" />
          <button type="button" onClick={() => setEditing(true)}>düzənlə</button>
          {editing ? editorFor([REA, NEO].map((id) => ({ unit_id: id, bed_id: "" }))) : null}
        </>
      );
    }
    await mountKabul(<Both />, { perms: ["board.view", "users.manage"], shell: { units: [NEO, REA] }, setup: down });
    expect(menuItems()).toEqual(["Bütün bölmələrim", "Şöbə 1", "Şöbə 2"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Şöbə 1" }));       // the bar's first: Neonatal
    fireEvent.click(screen.getByRole("button", { name: "düzənlə" }));
    expect(rowHeaders()).toEqual(["Şöbə 2", "Şöbə 1"]);                           // the grants' order: Reanimasiya, Neonatal
  });
});

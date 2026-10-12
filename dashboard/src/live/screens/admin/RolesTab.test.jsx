// The group × permission table (G1-13). Synthetic groups only (admin.testutil.js).
//
// Every write that SUCCEEDS asserts two things: the confirmation the administrator reads, and that
// no alert region carries anything — a success that also announces a refusal is the Critical the
// patient arm shipped, and a test that asserts the API call alone cannot see it. The toast's error
// region is mounted before the first toast (ui/Toast.jsx), so "no alert" is "every alert region
// is empty", never "no alert element".
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { LANG_CODES } from "../../i18n/langs.js";
import { createTranslator } from "../../i18n/translate.js";
import perms from "../../i18n/strings/perms.js";
import { PERMISSION_KEYS } from "./catalogue.js";
import {
  ADMIN_READS, CATALOGUE, GROUPS, NURSE_GROUP, SYSTEM_GROUP, WARD_GROUP, adminProp, group,
} from "./admin.testutil.js";
import { FIELD_MAX } from "./limits.js";
import { groupFromApi } from "./rules.js";
import {
  RolesTab, descriptionOf, isOn, listToSend, lockedBecause, pendingFor, undescribedKeys,
} from "./RolesTab.jsx";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const DESK = [...PERMISSION_KEYS];
/** A catalogue of four rows: the table is groups × catalogue, and twenty-one rows in a test is
 *  noise. The catalogue's own descriptions are the server's ENGLISH (admin.testutil.js); what the
 *  screen shows is the dashboard's text for the key (strings/perms.js), so the names the tests
 *  look cells up by come from that dictionary, not from the fixture. */
const FOUR = CATALOGUE.filter((row) => ["board.view", "alerts.ack", "users.manage", "groups.manage"].includes(row.key));
const AZ = perms.az;
const D = { boardView: AZ.board.view, alertsAck: AZ.alerts.ack, usersManage: AZ.users.manage, groupsManage: AZ.groups.manage };
const PENDING = "dəyişiklik gözləyir";
const rx = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
/** The same desk with no member in either ordinary group: a group with a KNOWN member count above
 *  zero offers no delete at all, so the delete tests use these. */
const EMPTY = [SYSTEM_GROUP, { ...NURSE_GROUP, member_count: 0 }, { ...WARD_GROUP, member_count: 0 }];
/** What `PATCH /admin/groups/{id}` answers: the group as the server now holds it (`GroupOut`). */
const answered = (id, body) => ({ ...GROUPS.find((g) => g.id === id), permissions: [...body.permissions].sort() });

/** The tab on its own. `admin` comes from `adminProp` — the one builder of what the frame hands a
 *  tab, in the shapes and the read states `useAdminData` produces: `catalogue: null` is a read that
 *  failed, `reads: { catalogue: "unasked" }` one this desk's rights do not allow, `reads: { groups:
 *  "stale" }` the last answer kept through a failed re-read. */
async function open({ perms: desk = DESK, groups = GROUPS, catalogue = FOUR, reads, setup } = {}) {
  const admin = adminProp({ users: [], groups, catalogue, unassigned: 0, reads });
  const { reload } = admin;
  const mounted = await mount(<RolesTab admin={admin} />, {
    access: token({ sub: "u-admin", perms: desk }),
    me: profile({ id: "u-admin", perms: desk }),
    setup: (api) => { ADMIN_READS(api); setup?.(api); },
  });
  return { ...mounted, admin, reload };
}

/** The checkbox at (group, permission), by the accessible name the cell carries — with or without
 *  the "· change pending" a changed cell appends to it. */
const cell = (groupName, description) => {
  const base = `${groupName} · ${description}`;
  return screen.getByRole("checkbox", { name: (name) => name === base || name === `${base} · ${PENDING}` });
};
const column = (name) => screen.getByRole("columnheader", { name });
const saveIn = async (col) => {
  await act(async () => { fireEvent.click(within(col).getByRole("button", { name: "Yadda saxla" })); await settle(); });
};
const alerts = () => screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
const notes = () => screen.getAllByRole("note").map((n) => n.textContent).join(" ");

/** What a write that LANDED must look like to the administrator: the confirmation, and no alert. */
function expectConfirmed(text) {
  expect(screen.getAllByText(text).length, `confirmation ${text}`).toBeGreaterThan(0);
  expect(alerts().trim()).toBe("");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the pure parts", () => {
  const nurse = groupFromApi(NURSE_GROUP);

  it("a pending change wins over what the server holds, and nothing else does", () => {
    expect(isOn(nurse, "board.view", {})).toBe(true);
    expect(isOn(nurse, "users.manage", {})).toBe(false);
    expect(isOn(nurse, "board.view", { [`${nurse.id}|board.view`]: false })).toBe(false);
    expect(isOn(nurse, "users.manage", { [`${nurse.id}|users.manage`]: true })).toBe(true);
  });

  it("the list a Save sends is the catalogue's order, which makes two saves comparable", () => {
    expect(listToSend(nurse, FOUR, { [`${nurse.id}|users.manage`]: true }))
      .toEqual(["board.view", "alerts.ack", "users.manage"]);
  });

  it("a checkbox clicked twice is not a pending change", () => {
    expect(pendingFor(nurse, { [`${nurse.id}|board.view`]: false })).toBe(1);
    expect(pendingFor(nurse, { [`${nurse.id}|board.view`]: true })).toBe(0);
    expect(pendingFor(nurse, { "g-other|board.view": false })).toBe(0);
  });

  it("the system group is locked first, a group beyond the desk's rights second, and one holding a key the catalogue does not describe third", () => {
    expect(lockedBecause(groupFromApi(SYSTEM_GROUP), DESK, FOUR)).toEqual({ key: "errors.systemGroupLocked", vars: {} });
    expect(lockedBecause(nurse, ["groups.manage"], FOUR)).toEqual({ key: "roles.cannotGrant", vars: {} });
    const ghostly = groupFromApi(group("gece_ekibi", { permissions: ["board.view", "ghost.key"] }));
    expect(undescribedKeys(ghostly, FOUR)).toEqual(["ghost.key"]);
    expect(lockedBecause(ghostly, DESK, FOUR)).toEqual({ key: "roles.undescribed", vars: { keys: "ghost.key" } });
    expect(lockedBecause(nurse, DESK, FOUR)).toBeNull();
  });

  it("describes every permission the dashboard knows in all four languages; the server's English is the fallback for a key this build does not know", () => {
    for (const lang of LANG_CODES) {
      const t = createTranslator(lang, DICTIONARIES);
      for (const key of PERMISSION_KEYS) {
        const shown = descriptionOf(t, { key, description: "the server's own words" });
        expect(shown.foreign, `${lang} ${key}`).toBe(false);
        expect(shown.text, `${lang} ${key}`).not.toBe("the server's own words");
        expect(shown.text, `${lang} ${key}`).not.toBe(`perms.${key}`);
      }
      expect(descriptionOf(t, { key: "ghost.key", description: "A right this build does not know" }))
        .toEqual({ text: "A right this build does not know", foreign: true });
    }
  });

  it("the pending count is a label, so it reads right for any number — in English and in Russian too", () => {
    // "1 pending changes" was the English for one; the Russian said the CELLS were awaiting a change.
    expect(createTranslator("en", DICTIONARIES)("roles.pending", { count: 1 })).toBe("Pending changes: 1");
    expect(createTranslator("ru", DICTIONARIES)("roles.pending", { count: 1 })).toBe("Несохранённые изменения: 1");
    expect(createTranslator("ru", DICTIONARIES)("roles.cellPending")).toBe("изменение не сохранено");
  });
});

describe("the table", () => {
  it("has the catalogue down the side in the reader's language with the key under it, and the groups across the top", async () => {
    await open();
    const table = screen.getByRole("table", { name: "Qruplar və səlahiyyətləri" });
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("Səlahiyyət");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent).join(" "))
      .toContain("Hemşire");
    const row = within(table).getByRole("rowheader", { name: rx(D.boardView) });
    expect(row).toHaveTextContent("board.view");          // the key as well as the description
    expect(within(table).getAllByRole("rowheader")).toHaveLength(FOUR.length);
    // The dashboard's own words, not the server's English — and not marked as English either.
    expect(screen.queryByText("See the live board, patient detail and the event stream")).toBeNull();
    expect(table.querySelector('[lang="en"]')).toBeNull();
  });

  it("a key this build does not know is shown in the server's own words, marked as English", async () => {
    await open({ catalogue: [...FOUR, { key: "ghost.key", description: "A right this build does not know" }] });
    const shown = screen.getByText("A right this build does not know");
    expect(shown).toHaveAttribute("lang", "en");
    expect(screen.getByRole("rowheader", { name: /A right this build does not know/ })).toHaveTextContent("ghost.key");
  });

  it("shows each group's member count and its two-step rule", async () => {
    await open();
    expect(screen.getByText("4 nəfər")).toBeInTheDocument();
    expect(screen.getAllByText("2FA məcburi").length).toBeGreaterThan(0);   // the system group
    expect(screen.getAllByText("2FA məcburi deyil").length).toBeGreaterThan(0);
  });

  it("a member count the API did not send is \"not read\", never a zero — and so is one from a stale read", async () => {
    // `member_count` absent is a different statement from `member_count: 0` — "nobody is in this
    // group" is a claim, and it would be false for a group the API simply did not count.
    await open({ groups: [SYSTEM_GROUP, group("nurse", { member_count: undefined }), WARD_GROUP] });
    const nurse = column(/Hemşire/);
    expect(within(nurse).getByText("Üzv sayı oxunmadı")).toBeInTheDocument();
    expect(within(nurse).queryByText(/nəfər/)).toBeNull();
    expect(within(column(/Gece ekibi/)).getByText("2 nəfər")).toBeInTheDocument();
    cleanup();
    // The last answer, kept through a failed re-read (`useAdminData` "stale"): the columns are
    // drawn from it, the COUNTS are not — "4 people" now is a claim nobody has just made.
    await open({ reads: { groups: "stale" } });
    expect(screen.queryByText(/nəfər/)).toBeNull();
    expect(screen.getAllByText("Üzv sayı oxunmadı")).toHaveLength(GROUPS.length);
  });

  it("a group list that could not be read says so — never a table with no columns", async () => {
    // A failed read is null, never `[]` (`useAdminData`); the frame's Alert carries the reason.
    await open({ groups: null });
    expect(screen.getByText("Heç bir qrup oxunmadı.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("a cell reads as \"<group> · <permission>\" to a screen reader", async () => {
    await open();
    expect(cell("Hemşire", D.boardView)).toBeChecked();
    expect(cell("Hemşire", D.usersManage)).not.toBeChecked();
  });

  it("the sticky rule for the first column is on the scrolling frame — the class is all jsdom can see", async () => {
    await open();
    // `Table` puts `className` on the scrolling FRAME, which is where a sticky rule has to live:
    // `position: sticky` is relative to the nearest scroll container, and the container is the
    // frame, not the <table>. jsdom does not lay out, so the assertion is on the class, not on
    // the effect; the effect is checked in a browser.
    const frame = screen.getByRole("table", { name: "Qruplar və səlahiyyətləri" }).closest("div");
    expect(frame.className).toMatch(/\[&_th:first-child\]:sticky/);
    expect(frame.className).toMatch(/\[&_td:first-child\]:sticky/);
  });

  it("without a catalogue says the read failed — and blames a missing right only on a read that was never asked", async () => {
    // A desk WITH groups.manage is without the catalogue only when the read failed: the frame's own
    // Alert carries the server's reason, and this sentence must not invent a different one. The
    // read's own state says which (`useAdminData`): "failed", or "unasked" for a desk whose rights
    // do not allow the call.
    await open({ catalogue: null });
    expect(screen.getByText("Səlahiyyət kataloqu oxunmadı; cədvəl çəkilə bilmir.")).toBeInTheDocument();
    expect(screen.queryByText(/groups\.manage/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    cleanup();
    await open({ catalogue: null, reads: { catalogue: "unasked" }, perms: ["board.view"] });
    expect(screen.getByText(/«groups\.manage» səlahiyyəti lazımdır/)).toBeInTheDocument();
  });
});

describe("collect and save", () => {
  it("a checkbox collects a change and sends nothing; the column says how many are pending, and the cell says so to a screen reader", async () => {
    const { api } = await open();
    fireEvent.click(cell("Hemşire", D.usersManage));
    expect(cell("Hemşire", D.usersManage)).toBeChecked();
    expect(screen.getByText("1 dəyişiklik gözləyir")).toBeInTheDocument();
    // The only visible marker of a pending cell is a tint, and a tint is not something a reader
    // is told: the cell's own name says it.
    expect(cell("Hemşire", D.usersManage)).toHaveAccessibleName(`Hemşire · ${D.usersManage} · ${PENDING}`);
    expect(cell("Hemşire", D.boardView)).toHaveAccessibleName(`Hemşire · ${D.boardView}`);
    expect(api.adminUpdateGroup).not.toHaveBeenCalled();
  });

  it("Save sends ONE PATCH with the whole list AND the list it believed the group held, reloads, and reads as done", async () => {
    const { api, reload } = await open();
    api.adminUpdateGroup.mockImplementation(async (id, body) => answered(id, body));
    fireEvent.click(cell("Hemşire", D.usersManage));
    await saveIn(column(/Hemşire/));
    expect(api.adminUpdateGroup).toHaveBeenCalledTimes(1);
    // `expected_permissions` is the column's last-read list, sorted: the server compares it with
    // what it holds, so a Save on a stale column is refused rather than undoing another change.
    expect(api.adminUpdateGroup).toHaveBeenCalledWith(NURSE_GROUP.id, {
      permissions: ["board.view", "alerts.ack", "users.manage"],
      expected_permissions: ["alerts.ack", "board.view"],
    });
    expectConfirmed(/Hemşire · səlahiyyətlər yadda saxlanıldı\./);
    expect(screen.queryByText("1 dəyişiklik gözləyir")).toBeNull();
    // The column shows what the PATCH answered — even though this reload is a spy that reads nothing.
    expect(cell("Hemşire", D.usersManage)).toBeChecked();
    expect(cell("Hemşire", D.usersManage)).toHaveAccessibleName(`Hemşire · ${D.usersManage}`);
    expect(reload).toHaveBeenCalled();
  });

  it("each group has its own Save, offered only when that column has something to save", async () => {
    // PATCH /admin/groups/{id} is atomic for ONE group and the API has no multi-group write, so a
    // single "save everything" button would promise atomicity the server cannot keep.
    await open();
    expect(screen.queryAllByRole("button", { name: "Yadda saxla" })).toHaveLength(0);
    fireEvent.click(cell("Hemşire", D.usersManage));
    fireEvent.click(cell("Gece ekibi", D.usersManage));
    // Every group but the system one (locked) has a Save of its own.
    expect(screen.getAllByRole("button", { name: "Yadda saxla" })).toHaveLength(GROUPS.length - 1);
    expect(within(column(/Hemşire/)).getByRole("button", { name: "Yadda saxla" })).toBeInTheDocument();
    expect(within(column(/Gece ekibi/)).getByRole("button", { name: "Yadda saxla" })).toBeInTheDocument();
    expect(screen.getByText(/Qruplar ayrı-ayrı yadda saxlanılır/)).toBeInTheDocument();
  });

  it("a save that lands hands the focus to the column's heading, not to <body>, when its buttons go", async () => {
    const { api } = await open();
    api.adminUpdateGroup.mockImplementation(async (id, body) => answered(id, body));
    fireEvent.click(cell("Hemşire", D.usersManage));
    const save = within(column(/Hemşire/)).getByRole("button", { name: "Yadda saxla" });
    save.focus();
    await act(async () => { fireEvent.click(save); await settle(); });
    expectConfirmed(/Hemşire · səlahiyyətlər yadda saxlanıldı\./);
    expect(within(column(/Hemşire/)).queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toHaveTextContent(/^Hemşire$/);
  });

  it("a 403 keeps the pending changes, names the group on the toast, and does not re-read", async () => {
    const { api, reload } = await open();
    api.adminUpdateGroup.mockRejectedValue(refusal(403, "Kendi yetkilerinizi aşan bir işlem yapılamaz: users.manage"));
    fireEvent.click(cell("Hemşire", D.usersManage));
    await saveIn(column(/Hemşire/));
    expect(alerts()).toContain("Hemşire");
    expect(alerts()).toMatch(/users\.manage/);
    // The decision survives the refusal: it is what the administrator chose, and the server did
    // not take it.
    expect(cell("Hemşire", D.usersManage)).toBeChecked();
    expect(screen.getByText("1 dəyişiklik gözləyir")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    expect(notes()).not.toMatch(/yenidən oxundu/);
  });

  it("a refusal canGrant could not foresee — a MEMBER holds more than this desk — keeps the ticks and names the group", async () => {
    // PATCH /admin/groups/{id} checks every current MEMBER's rights, before the change and after it
    // (`admin/service._members_within`). The screen has the group's rights and not its members', so
    // `canGrant` rightly offers this column to a desk whose rights cover the group — and the
    // server's 403 is the answer. It reads like any other refusal: named, ticks kept, nothing re-read.
    const { api, reload } = await open({ perms: ["groups.manage", "board.view", "alerts.ack"] });
    api.adminUpdateGroup.mockRejectedValue(refusal(403, "Kendi yetkilerinizi aşan bir işlem yapılamaz: audit.view, users.manage"));
    fireEvent.click(cell("Hemşire", D.alertsAck));                 // taking a right AWAY is checked too
    expect(within(column(/Hemşire/)).getByRole("button", { name: "Yadda saxla" })).toBeInTheDocument();
    await saveIn(column(/Hemşire/));
    expect(alerts()).toContain("Hemşire");
    expect(alerts()).toMatch(/audit\.view, users\.manage/);
    expect(cell("Hemşire", D.alertsAck)).not.toBeChecked();
    expect(screen.getByText("1 dəyişiklik gözləyir")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  // The 409 — a Save on a column another administrator changed meanwhile — is in
  // RolesTab.server.test.jsx: what it must be held to is what the RE-READ column shows, and that
  // needs a server whose state the re-read actually reads.

  it("the changes can be discarded without sending anything", async () => {
    const { api } = await open();
    fireEvent.click(cell("Hemşire", D.usersManage));
    fireEvent.click(screen.getByRole("button", { name: "Dəyişiklikləri geri al: Hemşire" }));
    expect(screen.queryByText("1 dəyişiklik gözləyir")).toBeNull();
    expect(cell("Hemşire", D.usersManage)).not.toBeChecked();
    expect(api.adminUpdateGroup).not.toHaveBeenCalled();
  });

  it("a second column's Save during the first's flight is a real request, and the announcement names both", async () => {
    // Each PATCH is atomic for its group and the server serialises them on the tenant lock; a
    // press that silently did nothing would be an offered control that does nothing.
    const releases = [];
    const { api } = await open();
    api.adminUpdateGroup.mockImplementation((id, body) => new Promise((resolve) => {
      releases.push(() => resolve(answered(id, body)));
    }));
    fireEvent.click(cell("Hemşire", D.usersManage));
    fireEvent.click(cell("Gece ekibi", D.usersManage));
    await saveIn(column(/Hemşire/));
    await saveIn(column(/Gece ekibi/));
    expect(api.adminUpdateGroup).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      const said = screen.getAllByRole("status").map((s) => s.textContent).join(" ");
      expect(said).toContain("Hemşire");
      expect(said).toContain("Gece ekibi");
    }, { timeout: 4000 });
    await act(async () => { releases.forEach((release) => release()); await settle(); });
    // Both landed, and both read as done — with no alert.
    expectConfirmed(/Hemşire · səlahiyyətlər yadda saxlanıldı\./);
    expectConfirmed(/Gece ekibi · səlahiyyətlər yadda saxlanıldı\./);
    expect(cell("Hemşire", D.usersManage)).toBeChecked();
    expect(cell("Gece ekibi", D.usersManage)).toBeChecked();
  });

  it("while a column's Save is in flight its cells are not editable — they say which group is being saved — and a success clears only what was sent", async () => {
    // A tick made during the flight could not be in the body already sent, and the success used to
    // clear it with the rest: the administrator's decision vanished, and the server never had it.
    let release;
    const { api } = await open();
    api.adminUpdateGroup.mockImplementation((id, body) => new Promise((resolve) => {
      release = () => resolve(answered(id, body));
    }));
    fireEvent.click(cell("Hemşire", D.usersManage));
    fireEvent.click(cell("Gece ekibi", D.alertsAck));               // another column's tick
    await saveIn(column(/Hemşire/));
    const box = cell("Hemşire", D.alertsAck);
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).not.toBeDisabled();
    expect(document.getElementById(box.getAttribute("aria-describedby"))).toHaveTextContent("Hemşire · yadda saxlanılır…");
    fireEvent.click(box);
    expect(box).toBeChecked();                                      // nothing collected in flight
    // The other column is not in flight, and stays editable.
    expect(cell("Gece ekibi", D.boardView)).not.toHaveAttribute("aria-disabled");
    await act(async () => { release(); await settle(); });
    expectConfirmed(/Hemşire · səlahiyyətlər yadda saxlanıldı\./);
    expect(api.adminUpdateGroup).toHaveBeenCalledWith(NURSE_GROUP.id, expect.objectContaining({
      permissions: ["board.view", "alerts.ack", "users.manage"],
    }));
    expect(cell("Hemşire", D.alertsAck)).not.toHaveAttribute("aria-disabled");
    expect(within(column(/Hemşire/)).queryByText(/dəyişiklik gözləyir/)).toBeNull();
    // The other column's tick was not sent, and is still there.
    expect(cell("Gece ekibi", D.alertsAck)).toBeChecked();
    expect(within(column(/Gece ekibi/)).getByText("1 dəyişiklik gözləyir")).toBeInTheDocument();
  });
});

describe("what cannot be edited", () => {
  it("the system group's column is read-only with the server's own reason, and its cells are reachable and say why", async () => {
    await open();
    const col = column(/Sistem yöneticisi/);
    expect(col).toHaveTextContent("Sistem qrupunun səlahiyyətləri və iki addımlı doğrulama qaydası dəyişdirilə bilməz.");
    expect(within(col).queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    const box = cell("Sistem yöneticisi", D.boardView);
    // `aria-disabled`, never `disabled`: a natively disabled checkbox is skipped in the Tab order
    // and tells a keyboard user nothing; this one is reached and points at the column's reason.
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).not.toBeDisabled();
    expect(document.getElementById(box.getAttribute("aria-describedby")))
      .toHaveTextContent("Sistem qrupunun səlahiyyətləri");
    // And it reads as holding EVERYTHING, which is what the API reports for it whatever is stored.
    for (const row of FOUR) expect(cell("Sistem yöneticisi", AZ[row.key.split(".")[0]][row.key.split(".")[1]])).toBeChecked();
    // A click on a locked cell changes nothing and collects nothing.
    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(screen.queryByText(/dəyişiklik gözləyir/)).toBeNull();
  });

  it("a group whose rights exceed the session's is read-only, with its own reason", async () => {
    const strong = group("gece_yonetim", { name: "Gecə idarə", permissions: ["users.manage"] });
    await open({ perms: ["groups.manage", "board.view"], groups: [NURSE_GROUP, strong] });
    const col = column(/Gecə idarə/);
    expect(col).toHaveTextContent("Bu qrupun səlahiyyətləri sizinkini aşır; dəyişdirə bilmərsiniz.");
    expect(within(col).queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    const box = cell("Gecə idarə", D.boardView);
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).not.toBeDisabled();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
  });

  it("a group holding a key the catalogue does not describe is read-only, and the column names the key", async () => {
    // A Save built from the catalogue would drop that key — revoke a right the screen never
    // showed, silently. It cannot happen while /admin/permissions serves the whole catalogue, and
    // nothing enforces that it always will.
    const ghostly = group("gece_ekibi", { name: "Gece ekibi", permissions: ["board.view", "ghost.key"] });
    await open({ groups: [NURSE_GROUP, ghostly] });
    const col = column(/Gece ekibi/);
    expect(col).toHaveTextContent("Bu qrup kataloqun təsvir etmədiyi bir səlahiyyət daşıyır (ghost.key)");
    expect(within(col).queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    expect(cell("Gece ekibi", D.boardView)).toHaveAttribute("aria-disabled", "true");
    expect(cell("Gece ekibi", D.boardView)).toBeChecked();
    // The other column is untouched by it.
    expect(cell("Hemşire", D.usersManage)).not.toHaveAttribute("aria-disabled");
    fireEvent.click(cell("Hemşire", D.usersManage));
    expect(within(column(/Hemşire/)).getByRole("button", { name: "Yadda saxla" })).toBeInTheDocument();
  });

  it("an unticked cell for a right this desk does not hold is not offered, and says why", async () => {
    // `update_group` checks the NEW list against the caller's rights (`_within(actor, new)`): the
    // tick is a certain 403. Shown, not offered, with its reason (Decision 11).
    await open({ perms: ["groups.manage", "board.view"], groups: [WARD_GROUP] });
    const box = cell("Gece ekibi", D.usersManage);
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).not.toBeDisabled();
    expect(document.getElementById(box.getAttribute("aria-describedby")))
      .toHaveTextContent("Bu səlahiyyət sizdə yoxdur; ona görə onu başqasına verə bilməzsiniz.");
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    expect(screen.queryByText(/dəyişiklik gözləyir/)).toBeNull();
    // What the desk holds stays offered — ticked or not — and so does taking a right away.
    expect(cell("Gece ekibi", D.groupsManage)).not.toHaveAttribute("aria-disabled");
    expect(cell("Gece ekibi", D.boardView)).not.toHaveAttribute("aria-disabled");
  });

  it("the new-group form does not offer a right this desk does not hold either", async () => {
    const { api } = await open({ perms: ["groups.manage", "board.view"] });
    api.adminCreateGroup.mockResolvedValue(WARD_GROUP);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qrup" })); });
    const form = within(screen.getByRole("dialog"));
    const box = form.getByRole("checkbox", { name: rx(D.usersManage) });
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(document.getElementById(box.getAttribute("aria-describedby")))
      .toHaveTextContent("Bu səlahiyyət sizdə yoxdur");
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    expect(form.getByRole("checkbox", { name: rx(D.boardView) })).not.toHaveAttribute("aria-disabled");
    fireEvent.change(form.getByLabelText(/Qısa ad/), { target: { value: "gece_ekibi" } });
    fireEvent.change(form.getByLabelText(/Görünən ad/), { target: { value: "Gecə ekibi" } });
    fireEvent.click(form.getByRole("checkbox", { name: rx(D.boardView) }));
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Qrupu yarat" })); await settle(); });
    expect(api.adminCreateGroup).toHaveBeenCalledWith(expect.objectContaining({ permissions: ["board.view"] }));
    expectConfirmed(/Gecə ekibi · yaradıldı\./);
  });

  it("a group whose known member count is above zero offers no delete, and says why; an unknown count leaves it to the server", async () => {
    await open();
    const trash = within(column(/Hemşire/)).getByRole("button", { name: "Qrupu sil: Hemşire" });
    expect(trash).toHaveAttribute("aria-disabled", "true");
    expect(trash).not.toBeDisabled();
    expect(document.getElementById(trash.getAttribute("aria-describedby"))).toHaveTextContent("Üzvü olan qrup silinə bilməz.");
    await act(async () => { fireEvent.click(trash); });
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    // A stale read's count is not known now: the delete is offered, and the server decides.
    await open({ reads: { groups: "stale" } });
    expect(within(column(/Hemşire/)).getByRole("button", { name: "Qrupu sil: Hemşire" })).not.toHaveAttribute("aria-disabled");
  });

  it("why a group with members cannot be deleted is written beside the dimmed trash, for a sighted reader too, and is its tooltip", async () => {
    await open();
    const col = column(/Hemşire/);
    const trash = within(col).getByRole("button", { name: "Qrupu sil: Hemşire" });
    const reason = document.getElementById(trash.getAttribute("aria-describedby"));
    // In the column's own header and not screen-reader-only. jsdom does not lay out, so the class is
    // what can be checked here; the look is checked in a browser.
    expect(col).toContainElement(reason);
    expect(reason).toHaveTextContent("Üzvü olan qrup silinə bilməz.");
    expect(reason.className).not.toMatch(/\bsr-only\b/);
    expect(trash).toHaveAttribute("title", "Üzvü olan qrup silinə bilməz.");
    cleanup();
    // A group that may be deleted keeps its own tooltip, and no such sentence.
    await open({ groups: EMPTY });
    const free = within(column(/Hemşire/)).getByRole("button", { name: "Qrupu sil: Hemşire" });
    expect(free).toHaveAttribute("title", "Qrupu sil: Hemşire");
    expect(within(column(/Hemşire/)).queryByText("Üzvü olan qrup silinə bilməz.")).toBeNull();
  });
});

describe("creating and deleting a group", () => {
  it("creating sends the slug, the name, the description, the MFA rule and the permissions — and reads as done", async () => {
    const { api, reload } = await open();
    api.adminCreateGroup.mockResolvedValue(WARD_GROUP);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qrup" })); });
    const form = within(screen.getByRole("dialog"));
    fireEvent.change(form.getByLabelText(/Qısa ad/), { target: { value: "gece_ekibi" } });
    fireEvent.change(form.getByLabelText(/Görünən ad/), { target: { value: "Gecə ekibi" } });
    fireEvent.change(form.getByLabelText(/Təsvir/), { target: { value: "Gecə növbəsi" } });
    fireEvent.click(form.getByLabelText(/iki addımlı doğrulama məcburidir/));
    fireEvent.click(form.getByRole("checkbox", { name: rx(D.boardView) }));
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Qrupu yarat" })); await settle(); });
    expect(api.adminCreateGroup).toHaveBeenCalledWith({
      slug: "gece_ekibi", name: "Gecə ekibi", description: "Gecə növbəsi",
      mfa_required: true, permissions: ["board.view"],
    });
    expectConfirmed(/Gecə ekibi · yaradıldı\./);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  it("a duplicate slug's 409 lands on the slug field, with the focus, and nowhere else", async () => {
    const { api } = await open();
    api.adminCreateGroup.mockRejectedValue(refusal(409, "Bu kısa ad zaten kullanılıyor"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qrup" })); });
    const form = within(screen.getByRole("dialog"));
    fireEvent.change(form.getByLabelText(/Qısa ad/), { target: { value: "nurse" } });
    fireEvent.change(form.getByLabelText(/Görünən ad/), { target: { value: "Hemşire" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Qrupu yarat" })); await settle(); });
    const slug = form.getByLabelText(/Qısa ad/);
    expect(slug).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(slug.getAttribute("aria-describedby").split(" ")[0]).textContent)
      .toMatch(/Bu qısa ad artıq istifadə olunur/);
    // Enabled again and focused: the refusal is where the administrator can act on it. (A field
    // still `disabled` from the write cannot take focus in a browser.)
    expect(slug).not.toBeDisabled();
    expect(slug).toHaveFocus();
    expect(alerts().trim()).toBe("");                              // on the field, not on the toast
    expect(screen.getByRole("dialog")).toBeInTheDocument();      // still open, to be corrected
  });

  it("a malformed slug's 422 lands on the slug field too", async () => {
    const BAD = "slug: 2-64 characters, lower-case letters, digits and _ only";
    const { api } = await open();
    api.adminCreateGroup.mockRejectedValue(refusal(422, `slug: ${BAD}`, {
      fieldErrors: [{ field: "slug", type: "value_error", message: BAD }],
    }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qrup" })); });
    const form = within(screen.getByRole("dialog"));
    fireEvent.change(form.getByLabelText(/Qısa ad/), { target: { value: "Gece-Ekibi" } });
    fireEvent.change(form.getByLabelText(/Görünən ad/), { target: { value: "Gecə ekibi" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Qrupu yarat" })); await settle(); });
    expect(form.getByLabelText(/Qısa ad/)).toHaveAttribute("aria-invalid", "true");
    expect(form.getByLabelText(/Qısa ad/)).toHaveFocus();
  });

  it("a 422 about something the form draws no field for goes to the toast, named after the group — never swallowed", async () => {
    // `fieldRefusals` is told which fields this form draws (slug, name, description). Anything else
    // — a permission entry, the body as a whole — used to come back keyed by its API path, under no
    // control and on no toast.
    const { api } = await open();
    api.adminCreateGroup.mockRejectedValue(refusal(422, "permissions.0: Input should be a valid string", {
      fieldErrors: [{ field: "permissions.0", type: "string_type", message: "Input should be a valid string" }],
    }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qrup" })); });
    const form = within(screen.getByRole("dialog"));
    fireEvent.change(form.getByLabelText(/Qısa ad/), { target: { value: "gece_ekibi" } });
    fireEvent.change(form.getByLabelText(/Görünən ad/), { target: { value: "Gecə ekibi" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Qrupu yarat" })); await settle(); });
    expect(alerts()).toContain("Gecə ekibi");
    expect(alerts()).toContain("Input should be a valid string");
    expect(form.getByLabelText(/Qısa ad/)).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("while the new group is being created, the busy words name it", async () => {
    // Decision 25: a busy control reads only "unavailable"; the words name the subject in flight.
    let release;
    const { api } = await open();
    api.adminCreateGroup.mockImplementation(() => new Promise((resolve) => { release = () => resolve(WARD_GROUP); }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qrup" })); });
    const form = within(screen.getByRole("dialog"));
    fireEvent.change(form.getByLabelText(/Qısa ad/), { target: { value: "gece_ekibi" } });
    fireEvent.change(form.getByLabelText(/Görünən ad/), { target: { value: "Gecə ekibi" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Qrupu yarat" })); await settle(); });
    await waitFor(() => expect(screen.getAllByRole("status").map((s) => s.textContent).join(" "))
      .toContain("Gecə ekibi · yadda saxlanılır…"), { timeout: 4000 });
    await act(async () => { release(); await settle(); });
    expectConfirmed(/Gecə ekibi · yaradıldı\./);
  });

  it("every field of the new-group form carries the server's own limit", async () => {
    await open();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qrup" })); });
    const form = within(screen.getByRole("dialog"));
    expect(form.getByLabelText(/Qısa ad/)).toHaveAttribute("maxlength", String(FIELD_MAX.slug));
    expect(form.getByLabelText(/Görünən ad/)).toHaveAttribute("maxlength", String(FIELD_MAX.group_name));
    expect(form.getByLabelText(/Təsvir/)).toHaveAttribute("maxlength", String(FIELD_MAX.description));
  });

  it("deleting confirms first, then shows the server's own refusal for each of its three cases", async () => {
    const CASES = [
      ["Sistem grubu silinemez", /Sistem qrupu silinə bilməz/],
      ["Üyesi olan grup silinemez", /Üzvü olan qrup silinə bilməz/],
      ["AD eşlemesi olan grup silinemez", /AD uyğunlaşdırması olan qrup silinə bilməz/],
    ];
    for (const [message, shown] of CASES) {
      // A count of zero when it was read: somebody may have joined since, and the server says so.
      // eslint-disable-next-line no-await-in-loop
      const { api } = await open({ groups: EMPTY });
      api.adminDeleteGroup.mockRejectedValue(refusal(409, message));
      const col = column(/Hemşire/);
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { fireEvent.click(within(col).getByRole("button", { name: "Qrupu sil: Hemşire" })); });
      expect(screen.getByText(/Hemşire silinəcək/)).toBeInTheDocument();
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Qrupu sil" }));
        await settle();
      });
      expect(alerts()).toMatch(shown);
      expect(alerts()).toContain("Hemşire");
      expect(screen.getByRole("dialog")).toBeInTheDocument();      // not dismissed on a refusal
      // `cleanup()`, never `document.body.innerHTML = ""`: the dialog and the toast stack are React
      // PORTALS under <body>, and blanking the body leaves React trying to unmount nodes that are
      // no longer its children ("The node to be removed is not a child of this node").
      cleanup();
    }
  });

  it("a delete that lands says so, naming the group, closes the dialog and reloads", async () => {
    const { api, reload } = await open({ groups: EMPTY });
    api.adminDeleteGroup.mockResolvedValue(null);
    const col = column(/Gece ekibi/);
    await act(async () => { fireEvent.click(within(col).getByRole("button", { name: "Qrupu sil: Gece ekibi" })); });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Qrupu sil" }));
      await settle();
    });
    expect(api.adminDeleteGroup).toHaveBeenCalledWith(WARD_GROUP.id);
    // A confirmation goes to the toast's POLITE region, which is an `aria-live` div and carries no
    // `role` — so it is found by its text, not by role. Twice on purpose: the visible toast and
    // the sr-only live region it is announced from.
    expectConfirmed(/Gece ekibi · silindi\./);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  // A dropped connection (fetch() rejecting with no response) is no answer, not a refusal: the
  // request may have reached the engine before the line went (refusal.js `mayHaveLanded`).
  const DROPPED = "Serverə qoşulmaq mümkün olmadı. Şəbəkə bağlantınızı yoxlayın.";
  const MAY_HAVE = "Dəyişiklik yenə də tətbiq olunmuş ola bilər: yenidən cəhd etməzdən əvvəl yoxlayın.";

  it("a delete whose connection dropped is not called refused: it may have gone through, the dialog closes, and the groups are read again", async () => {
    // A dialog left open over a group the engine may already have deleted asks to delete it again;
    // the re-read decides whether its column is still there.
    const { api, reload } = await open({ groups: EMPTY });
    api.adminDeleteGroup.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => { fireEvent.click(within(column(/Gece ekibi/)).getByRole("button", { name: "Qrupu sil: Gece ekibi" })); });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Qrupu sil" }));
      await settle();
    });
    expect(alerts()).toContain(`Gece ekibi: ${DROPPED} ${MAY_HAVE}`);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a new group whose connection dropped may have been created: it says so, and the groups are read again behind the form", async () => {
    const { api, reload } = await open();
    api.adminCreateGroup.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qrup" })); });
    const form = within(screen.getByRole("dialog"));
    fireEvent.change(form.getByLabelText(/Qısa ad/), { target: { value: "gece_ekibi" } });
    fireEvent.change(form.getByLabelText(/Görünən ad/), { target: { value: "Gecə ekibi" } });
    await act(async () => { fireEvent.click(form.getByRole("button", { name: "Qrupu yarat" })); await settle(); });
    expect(alerts()).toContain(`Gecə ekibi: ${DROPPED} ${MAY_HAVE}`);
    expect(reload).toHaveBeenCalledTimes(1);
    // The form stays, with what she typed: if the first press landed, a second one is answered
    // "this short name is taken", on the field — which is the check the toast asks for.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("the grid is a table: a caption, scope=col per group, scope=row per permission", async () => {
    await open();
    const table = screen.getByRole("table", { name: "Qruplar və səlahiyyətləri" });
    expect(table.querySelector("caption")).toHaveTextContent("Qruplar və səlahiyyətləri");
    for (const header of within(table).getAllByRole("columnheader")) expect(header.getAttribute("scope")).toBe("col");
    for (const header of within(table).getAllByRole("rowheader")) expect(header.getAttribute("scope")).toBe("row");
  });

  it("no control is natively disabled — a locked cell is aria-disabled, so a keyboard user reaches it and hears why", async () => {
    await open();
    for (const control of [...screen.getAllByRole("button"), ...screen.getAllByRole("checkbox")]) {
      expect(control.hasAttribute("disabled"), control.getAttribute("aria-label") || control.textContent).toBe(false);
    }
    const locked = screen.getAllByRole("checkbox").filter((box) => box.getAttribute("aria-disabled") === "true");
    expect(locked).toHaveLength(FOUR.length);                     // the system group's column
    for (const box of locked) expect(document.getElementById(box.getAttribute("aria-describedby"))).not.toBeNull();
  });

  it("says which group a save is in flight for", async () => {
    let release;
    const { api } = await open();
    api.adminUpdateGroup.mockImplementation((id, body) => new Promise((resolve) => {
      release = () => resolve(answered(id, body));
    }));
    fireEvent.click(cell("Hemşire", D.usersManage));
    await saveIn(column(/Hemşire/));
    await waitFor(() => expect(screen.getAllByRole("status").map((s) => s.textContent).join(" "))
      .toContain("Hemşire"), { timeout: 4000 });
    await act(async () => { release(); await settle(); });
    expectConfirmed(/Hemşire · səlahiyyətlər yadda saxlanıldı\./);
  });

  it("says what the table is and is not", async () => {
    await open();
    expect(screen.getByText(/Səlahiyyət yoxlanışı serverdə aparılır/)).toBeInTheDocument();
  });

  it("has no h1 of its own: the screen's heading is the frame's", async () => {
    await open();
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 2, name: "Rollar və səlahiyyətlər" })).toBeInTheDocument();
  });
});

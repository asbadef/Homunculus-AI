// dashboard/src/admin/GroupAdmin.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { GroupAdmin } from "./GroupAdmin.jsx";
import { cstrings } from "../clinicalI18n.js";
import { getTheme } from "../clinicalTheme.js";
import { PERMISSION_KEYS } from "../permissions.js";

const T = getTheme("icu");
const S = cstrings("tr");
const R = S.rbac;

const GROUPS = [
  // The API reports the whole catalogue for the system group; this row deliberately does not, so
  // the panel is seen to widen it by rule.
  { id: "g1", slug: "hospital_admin", name: "Sistem Yöneticisi", description: "", mfaRequired: true,
    isSystem: true, permissions: ["users.manage", "board.view"], memberCount: 1 },
  { id: "g2", slug: "nurse", name: "Hemşire", description: "Servis", mfaRequired: false,
    isSystem: false, permissions: ["board.view"], memberCount: 4 },
  { id: "g3", slug: "charge_nurse", name: "Sorumlu Hemşire", description: "", mfaRequired: false,
    isSystem: false, permissions: ["board.view", "shifts.manage"], memberCount: 2 },
  // "legacy.key" is no longer in the catalogue: the server ignores it.
  { id: "g4", slug: "archive", name: "Arşiv", description: "", mfaRequired: false,
    isSystem: false, permissions: ["board.view", "legacy.key"], memberCount: 0 },
];
const PERMS = [
  { key: "board.view", description: "See the board" },
  { key: "shifts.manage", description: "Shift schedules" },
  { key: "users.manage", description: "Manage users" },
  { key: "groups.manage", description: "Manage groups" },
];
// A groups desk that holds these but not shifts.manage, nor the whole catalogue.
const DESK = ["groups.manage", "users.manage", "board.view"];

function setup({ perms = DESK, store = {}, lang = "tr", groups = GROUPS, catalogue = PERMS } = {}) {
  const fakeStore = {
    adminSaveGroup: vi.fn(async () => ({})),
    adminDeleteGroup: vi.fn(async () => null),
    ...store,
  };
  const state = { user: { perms }, adminGroups: groups, adminPermissions: catalogue };
  render(<GroupAdmin T={T} S={cstrings(lang)} lang={lang} store={fakeStore} state={state} />);
  return fakeStore;
}

const row = (slug) => within(screen.getByTestId(`group-${slug}`));
const editor = () => within(screen.getByTestId("group-editor"));
const permBox = (label) => editor().getByLabelText(new RegExp(`^${label}`));
const refusal = (message, extra = {}) => Object.assign(new Error(message), extra);
/** A store call that stays pending until the test settles it. */
function pending() {
  const call = { fn: null, resolve: null, reject: null };
  call.fn = vi.fn(() => new Promise((res, rej) => { call.resolve = res; call.reject = rej; }));
  return call;
}
// What a groups desk (DESK) lacks of the whole catalogue, as the reason names it.
const SYSTEM_BEYOND = /^Yetkileriniz bu grubu vermeye yetmiyor\. Eksik yetkiler: .*Nöbet çizelgesi/;

describe("GroupAdmin — list", () => {
  it("lists groups with member counts, flags and translated permission labels", () => {
    setup();
    const nurse = row("nurse");
    expect(nurse.getByText("Hemşire")).toBeInTheDocument();
    expect(nurse.getByText(/4 üye/)).toBeInTheDocument();
    expect(nurse.getByText("Panoyu görme")).toBeInTheDocument();
    const admin = row("hospital_admin");
    expect(admin.getByText(/Sistem grubu/)).toBeInTheDocument();
    expect(admin.getByText("MFA")).toBeInTheDocument();
  });

  it("shows the system group holding the whole catalogue, whatever its rows say", () => {
    setup();
    const admin = row("hospital_admin");
    for (const key of PERMISSION_KEYS) expect(admin.getByText(R.perm[key])).toBeInTheDocument();
  });

  it("does not show a retired key as a right", () => {
    setup();
    expect(row("archive").queryByText("legacy.key")).toBeNull();
    expect(row("archive").getByText("Panoyu görme")).toBeInTheDocument();
  });

  it("is read-only without groups.manage: no new group, no edit, no delete", () => {
    setup({ perms: ["users.manage"], catalogue: [] });
    expect(screen.getByText("Hemşire")).toBeInTheDocument();
    expect(screen.queryByText("Yeni grup")).toBeNull();
    expect(screen.queryByLabelText("Grubu düzenle Hemşire")).toBeNull();
    expect(screen.queryByLabelText("Sil Hemşire")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("GroupAdmin — create and edit", () => {
  it("creates a group from the editor", async () => {
    const store = setup();
    fireEvent.click(screen.getByText("Yeni grup"));
    fireEvent.change(screen.getByLabelText("Grup adı"), { target: { value: "BT Destek" } });
    fireEvent.change(screen.getByLabelText(/^Kısa ad/), { target: { value: "IT_destek" } });
    fireEvent.click(screen.getByLabelText("İki adımlı doğrulama zorunlu"));
    fireEvent.click(permBox("Kullanıcı yönetimi"));
    fireEvent.click(screen.getByText("Kaydet"));
    await waitFor(() => expect(store.adminSaveGroup).toHaveBeenCalled());
    expect(store.adminSaveGroup.mock.calls[0][0]).toMatchObject({
      id: null, slug: "it_destek", name: "BT Destek", mfaRequired: true, permissions: ["users.manage"],
    });
    await waitFor(() => expect(screen.queryByTestId("group-editor")).toBeNull());
  });

  it("offers only the permissions the session holds; the others are disabled with a reason", () => {
    setup();
    fireEvent.click(screen.getByText("Yeni grup"));
    expect(permBox("Kullanıcı yönetimi")).toBeEnabled();
    expect(permBox("Panoyu görme")).toBeEnabled();
    const shifts = permBox("Nöbet çizelgesi");
    expect(shifts).toBeDisabled();
    expect(shifts).toHaveAccessibleDescription(R.err.beyondOwnRights);
    expect(editor().getByText(R.err.beyondOwnRights)).toBeInTheDocument();
  });

  it("edits an existing group without offering to change its slug", async () => {
    const store = setup();
    fireEvent.click(screen.getByLabelText("Grubu düzenle Hemşire"));
    expect(screen.queryByLabelText(/^Kısa ad/)).toBeNull();
    fireEvent.click(permBox("Kullanıcı yönetimi"));
    fireEvent.click(screen.getByText("Kaydet"));
    await waitFor(() => expect(store.adminSaveGroup).toHaveBeenCalled());
    expect(store.adminSaveGroup.mock.calls[0][0]).toMatchObject({
      id: "g2", isSystem: false, permissions: ["board.view", "users.manage"],
    });
  });

  it("a full-rights session can rename the system group; its rights and MFA stay read-only", async () => {
    const store = setup({ perms: PERMISSION_KEYS });
    fireEvent.click(screen.getByLabelText("Grubu düzenle Sistem Yöneticisi"));
    for (const p of PERMS) {
      const box = editor().getByLabelText(new RegExp(`^${R.perm[p.key]}`));
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
      expect(box).toHaveAccessibleDescription(R.err.systemGroupRights);
    }
    const mfa = screen.getByLabelText("İki adımlı doğrulama zorunlu");
    expect(mfa).toBeChecked();
    expect(mfa).toBeDisabled();
    expect(editor().getByText(R.err.systemGroupRights)).toBeInTheDocument();
    expect(screen.getByLabelText("Grup adı")).toBeEnabled();
    expect(screen.getByLabelText("Açıklama")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Grup adı"), { target: { value: "Yönetim" } });
    fireEvent.change(screen.getByLabelText("Açıklama"), { target: { value: "BT" } });
    fireEvent.click(screen.getByText("Kaydet"));
    await waitFor(() => expect(store.adminSaveGroup).toHaveBeenCalled());
    expect(store.adminSaveGroup.mock.calls[0][0]).toMatchObject({
      id: "g1", isSystem: true, name: "Yönetim", description: "BT", mfaRequired: true,
    });
  });

  it("a lesser session sees the system group read-only, labels included", () => {
    const store = setup();
    fireEvent.click(screen.getByLabelText("Grubu düzenle Sistem Yöneticisi"));
    expect(editor().getByText(SYSTEM_BEYOND)).toBeInTheDocument();
    for (const label of ["Grup adı", "Açıklama", "İki adımlı doğrulama zorunlu"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(SYSTEM_BEYOND);
    }
    for (const p of PERMS) expect(editor().getByLabelText(new RegExp(`^${R.perm[p.key]}`))).toBeDisabled();
    expect(screen.queryByText("Kaydet")).toBeNull();
    fireEvent.click(editor().getByRole("button", { name: "Vazgeç" }));
    expect(screen.queryByTestId("group-editor")).toBeNull();
    expect(store.adminSaveGroup).not.toHaveBeenCalled();
  });

  it("a lesser session cannot edit a group beyond its rights at all, nor delete it; the reason is shown once", () => {
    const store = setup();
    const reason = "Yetkileriniz bu grubu vermeye yetmiyor. Eksik yetkiler: Nöbet çizelgesi";
    const charge = row("charge_nurse");
    expect(charge.getByText(reason)).toBeInTheDocument();
    const del = charge.getByLabelText("Sil Sorumlu Hemşire");
    expect(del).toBeDisabled();
    expect(del).toHaveAccessibleDescription(reason);
    fireEvent.click(charge.getByLabelText("Grubu düzenle Sorumlu Hemşire"));
    expect(editor().getByText(reason)).toBeInTheDocument();          // once: getByText refuses two
    for (const label of ["Grup adı", "Açıklama", "İki adımlı doğrulama zorunlu"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(reason);
    }
    for (const label of ["Panoyu görme", "Nöbet çizelgesi", "Kullanıcı yönetimi"]) {
      expect(permBox(label)).toBeDisabled();
      expect(permBox(label)).toHaveAccessibleDescription(reason);
    }
    expect(permBox("Nöbet çizelgesi")).toBeChecked();
    expect(screen.queryByText("Kaydet")).toBeNull();
    expect(store.adminSaveGroup).not.toHaveBeenCalled();
  });

  it("a retired key does not make a group look beyond, and is not sent back", async () => {
    const store = setup();
    expect(row("archive").getByLabelText("Sil Arşiv")).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Grubu düzenle Arşiv"));
    expect(permBox("Kullanıcı yönetimi")).toBeEnabled();
    expect(screen.getByLabelText("İki adımlı doğrulama zorunlu")).toBeEnabled();
    fireEvent.click(screen.getByText("Kaydet"));
    await waitFor(() => expect(store.adminSaveGroup).toHaveBeenCalled());
    expect(store.adminSaveGroup.mock.calls[0][0].permissions).toEqual(["board.view"]);
  });

  it("without a catalogue the rights are read-only and sent back unchanged, never emptied", async () => {
    const store = setup({ catalogue: [] });
    fireEvent.click(screen.getByLabelText("Grubu düzenle Hemşire"));
    expect(editor().getByText(R.loadFailed)).toBeInTheDocument();
    const box = permBox("Panoyu görme");
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    fireEvent.click(screen.getByText("Kaydet"));
    await waitFor(() => expect(store.adminSaveGroup).toHaveBeenCalled());
    expect(store.adminSaveGroup.mock.calls[0][0].permissions).toEqual(["board.view"]);
  });

  it("a refused save keeps the editor open and shows the server's 403, translated", async () => {
    const save = vi.fn(async () => {
      throw refusal("Kendi yetkilerinizi aşan bir işlem yapılamaz: users.manage", { status: 403 });
    });
    setup({ lang: "en", store: { adminSaveGroup: save } });
    fireEvent.click(screen.getByLabelText("Edit group Hemşire"));
    fireEvent.click(screen.getByText("Save"));
    expect(await editor().findByText(
      "You cannot perform an action beyond your own permissions. Permissions you do not hold: Manage users",
    )).toBeInTheDocument();
    expect(screen.queryByText(/Kendi yetkilerinizi/)).toBeNull();
    expect(screen.getByTestId("group-editor")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeEnabled();
  });

  it("the editor cannot be closed while a save runs, so a late refusal is still shown", async () => {
    const save = pending();
    setup({ store: { adminSaveGroup: save.fn } });
    fireEvent.click(screen.getByLabelText("Grubu düzenle Hemşire"));
    fireEvent.click(screen.getByText("Kaydet"));
    const cancel = editor().getByRole("button", { name: "Vazgeç" });
    await waitFor(() => expect(cancel).toBeDisabled());
    expect(screen.getByText("Kaydet")).toBeDisabled();
    fireEvent.click(cancel);
    expect(screen.getByTestId("group-editor")).toBeInTheDocument();
    await act(async () => { save.reject(refusal("Group not found", { status: 404 })); });
    expect(editor().getByText(R.err.groupNotFound)).toBeInTheDocument();
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(screen.queryByTestId("group-editor")).toBeNull();
  });

  it("a 422 is shown field by field and the editor stays open", async () => {
    const save = vi.fn(async () => {
      throw refusal("slug: slug: 2-64 characters", {
        status: 422, fieldErrors: [{ field: "slug", type: "value_error", message: "slug: 2-64 characters" }],
      });
    });
    setup({ store: { adminSaveGroup: save } });
    fireEvent.click(screen.getByText("Yeni grup"));
    fireEvent.change(screen.getByLabelText("Grup adı"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/^Kısa ad/), { target: { value: "x" } });
    fireEvent.click(screen.getByText("Kaydet"));
    expect(await editor().findByText(R.err.slugInvalid)).toBeInTheDocument();
    expect(screen.getByLabelText("Grup adı")).toHaveValue("X");
  });
});

describe("GroupAdmin — delete", () => {
  it("never offers to delete a system group", () => {
    setup({ perms: PERMISSION_KEYS });
    expect(screen.queryByLabelText("Sil Sistem Yöneticisi")).toBeNull();
  });

  it("deletes only after confirmation", async () => {
    const store = setup();
    fireEvent.click(screen.getByLabelText("Sil Hemşire"));
    const dialog = within(screen.getByTestId("group-delete"));
    expect(dialog.getByText("Hemşire")).toBeInTheDocument();
    expect(store.adminDeleteGroup).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Sil" }));
    await waitFor(() => expect(store.adminDeleteGroup).toHaveBeenCalledWith("g2"));
    await waitFor(() => expect(screen.queryByTestId("group-delete")).toBeNull());
  });

  it("does nothing when the confirmation is declined", () => {
    const store = setup();
    fireEvent.click(screen.getByLabelText("Sil Hemşire"));
    fireEvent.click(within(screen.getByTestId("group-delete")).getByRole("button", { name: "Vazgeç" }));
    expect(screen.queryByTestId("group-delete")).toBeNull();
    expect(store.adminDeleteGroup).not.toHaveBeenCalled();
  });

  it("the confirmation cannot be closed while the delete runs", async () => {
    const del = pending();
    setup({ store: { adminDeleteGroup: del.fn } });
    fireEvent.click(screen.getByLabelText("Sil Hemşire"));
    const dialog = within(screen.getByTestId("group-delete"));
    fireEvent.click(dialog.getByRole("button", { name: "Sil" }));
    const cancel = dialog.getByRole("button", { name: "Vazgeç" });
    await waitFor(() => expect(cancel).toBeDisabled());
    fireEvent.click(cancel);
    expect(screen.getByTestId("group-delete")).toBeInTheDocument();
    await act(async () => { del.reject(refusal("Üyesi olan grup silinemez", { status: 409 })); });
    expect(dialog.getByText(R.err.groupHasMembers)).toBeInTheDocument();
  });

  it("surfaces the server's 409 translated, and keeps the confirmation open", async () => {
    setup({ store: { adminDeleteGroup: vi.fn(async () => {
      throw refusal("Üyesi olan grup silinemez", { status: 409 });
    }) } });
    fireEvent.click(screen.getByLabelText("Sil Hemşire"));
    fireEvent.click(within(screen.getByTestId("group-delete")).getByRole("button", { name: "Sil" }));
    expect(await screen.findByText(R.err.groupHasMembers)).toBeInTheDocument();
    expect(screen.getByTestId("group-delete")).toBeInTheDocument();
  });
});

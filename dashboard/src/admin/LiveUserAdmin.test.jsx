// dashboard/src/admin/LiveUserAdmin.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { LiveUserAdmin } from "./LiveUserAdmin.jsx";
import { LiveStaffTab } from "./LiveStaffTab.jsx";
import { cstrings, cannotGrantReason } from "../clinicalI18n.js";
import { getTheme } from "../clinicalTheme.js";

const T = getTheme("icu");
const S = cstrings("tr");
const R = S.rbac;

// Synthetic staff and groups only.
const GROUPS = [
  { id: "g0", slug: "hospital_admin", name: "Sistem Yöneticisi", description: "", mfaRequired: true,
    isSystem: true, permissions: [], memberCount: 1 },
  { id: "g1", slug: "nurse", name: "Hemşire", description: "", mfaRequired: false, isSystem: false,
    permissions: ["board.view", "alerts.ack"], memberCount: 2 },
  { id: "g2", slug: "charge_nurse", name: "Sorumlu Hemşire", description: "", mfaRequired: false,
    isSystem: false, permissions: ["board.view", "alerts.ack"], memberCount: 1 },
  { id: "g3", slug: "shift_lead", name: "Nöbet Amiri", description: "", mfaRequired: false,
    isSystem: false, permissions: ["board.view", "shifts.manage"], memberCount: 1 },
  // "legacy.key" is no longer in the catalogue: the server ignores it.
  { id: "g4", slug: "archive", name: "Arşiv", description: "", mfaRequired: false, isSystem: false,
    permissions: ["board.view", "legacy.key"], memberCount: 0 },
];
const CATALOGUE = ["board.view", "alerts.ack", "shifts.manage", "users.manage", "groups.manage"]
  .map((key) => ({ key, description: key }));
// A staff desk: users and groups, the nurses' rights, but not shifts.manage nor the whole catalogue.
const DESK = ["users.manage", "groups.manage", "board.view", "alerts.ack"];
const SELF = "u0";

const link = (g, source = "manual") => ({ id: g.id, slug: g.slug, name: g.name, source });
const user = (over) => ({
  email: null, authSource: "local", active: true, mfa: false, lastLoginAt: null, groups: [],
  manualGroupIds: [], ...over,
});
const USERS = [
  user({ id: SELF, username: "yonetici", full_name: "Deniz Yönetici",
    groups: [link(GROUPS[1])], manualGroupIds: ["g1"] }),
  user({ id: "u1", username: "ayse", email: "ayse@example.com", full_name: "Ayşe Demir",
    groups: [link(GROUPS[1])], manualGroupIds: ["g1"] }),
  user({ id: "u2", username: "ldapci", full_name: "AD Kullanıcı", authSource: "ldap", mfa: true,
    lastLoginAt: "2026-09-23T08:00:00Z", groups: [link(GROUPS[1], "ldap")] }),
  user({ id: "u3", username: "mehmet", full_name: "Mehmet Kaya",
    groups: [link(GROUPS[3])], manualGroupIds: ["g3"] }),
  user({ id: "u4", username: "pasif", full_name: "Pasif Hesap", active: false,
    groups: [link(GROUPS[2])], manualGroupIds: ["g2"] }),
  user({ id: "u5", username: "bilinmeyen", full_name: "Bilinmeyen Grup",
    groups: [{ id: "gX", slug: "gone", name: "Kaldırılmış", source: "manual" }], manualGroupIds: ["gX"] }),
  user({ id: "u6", username: "arsivci", full_name: "Arşiv Görevlisi",
    groups: [link(GROUPS[4])], manualGroupIds: ["g4"] }),
  user({ id: "u7", username: "eski.amir", full_name: "Eski Amir", active: false,
    groups: [link(GROUPS[3])], manualGroupIds: ["g3"] }),
];

function setup({ store = {}, users = USERS, perms = DESK, selfId = SELF, catalogue = CATALOGUE,
                 lang = "tr" } = {}) {
  const fakeStore = {
    adminCreateUser: vi.fn(async () => ({})),
    adminUpdateUser: vi.fn(async () => ({})),
    adminSetUserGroups: vi.fn(async () => ({})),
    adminResetPassword: vi.fn(async () => ({ ok: true })),
    adminResetMfa: vi.fn(async () => ({ ok: true })),
    ...store,
  };
  const state = { user: { id: selfId, perms }, adminUsers: users, adminGroups: GROUPS,
                  adminPermissions: catalogue };
  render(<LiveUserAdmin T={T} S={cstrings(lang)} lang={lang} store={fakeStore} state={state} />);
  return fakeStore;
}

const row = (username) => within(screen.getByTestId(`user-${username}`));
const refusal = (message, extra = {}) => Object.assign(new Error(message), extra);
const createForm = () => within(screen.getByTestId("create-user-form"));
const beyondReason = (...labels) => R.err.beyondOwnRightsList.replace("{perms}", labels.join(", "));

describe("LiveUserAdmin — list", () => {
  it("lists users with source, groups, MFA and activity", () => {
    setup();
    const ayse = row("ayse");
    expect(ayse.getByText("Ayşe Demir")).toBeInTheDocument();
    expect(ayse.getByText("Yerel")).toBeInTheDocument();
    expect(ayse.getByText("Hemşire")).toBeInTheDocument();
    expect(ayse.getByText(/Son giriş: Hiç/)).toBeInTheDocument();
    expect(ayse.getByText("Aktif")).toBeInTheDocument();
    const ad = row("ldapci");
    expect(ad.getByText("Active Directory")).toBeInTheDocument();
    expect(ad.getByText("MFA")).toBeInTheDocument();
    expect(ad.getByText("Hemşire (AD)")).toBeInTheDocument();
    expect(row("pasif").getByText("Pasif")).toBeInTheDocument();
  });
});

describe("LiveUserAdmin — create", () => {
  it("creates a local user with the chosen groups", async () => {
    const store = setup();
    fireEvent.change(screen.getByLabelText(/^Kullanıcı adı/), { target: { value: "Selin.Arslan" } });
    fireEvent.change(screen.getByLabelText("Ad Soyad"), { target: { value: "Selin Arslan" } });
    fireEvent.change(screen.getByLabelText(/^Geçici parola/), { target: { value: "Gecici-Parola-1" } });
    fireEvent.click(createForm().getByLabelText("Sorumlu Hemşire"));
    fireEvent.click(screen.getByText("Kullanıcı oluştur"));
    await waitFor(() => expect(store.adminCreateUser).toHaveBeenCalled());
    expect(store.adminCreateUser.mock.calls[0][0]).toEqual({
      username: "Selin.Arslan", email: null, full_name: "Selin Arslan",
      password: "Gecici-Parola-1", group_ids: ["g2"],
    });
    await waitFor(() => expect(screen.getByLabelText(/^Kullanıcı adı/)).toHaveValue(""));
    expect(screen.getByLabelText(/^Geçici parola/)).toHaveValue("");
  });

  it("never shows the temporary password", () => {
    setup();
    const pw = screen.getByLabelText(/^Geçici parola/);
    expect(pw).toHaveAttribute("type", "password");
    expect(pw).toHaveAttribute("autocomplete", "new-password");
    fireEvent.change(pw, { target: { value: "Gecici-Parola-1" } });
    expect(document.body.textContent).not.toContain("Gecici-Parola-1");
  });

  it("offers only the groups within the session's rights; the others say why", () => {
    setup();
    const form = createForm();
    expect(form.getByLabelText("Hemşire")).toBeEnabled();
    expect(form.getByLabelText("Sorumlu Hemşire")).toBeEnabled();
    const lead = form.getByLabelText("Nöbet Amiri");
    expect(lead).toBeDisabled();
    expect(lead).toHaveAccessibleDescription(cannotGrantReason(["shifts.manage"], "tr"));
    expect(form.getByLabelText("Sistem Yöneticisi")).toBeDisabled();
  });

  it("judges a custom group by the catalogue: a retired key is not a right", () => {
    setup();
    expect(createForm().getByLabelText("Arşiv")).toBeEnabled();
  });

  it("without a catalogue (a users.manage desk) judges a group with what is known", () => {
    setup({ perms: ["users.manage", "board.view", "alerts.ack"], catalogue: [] });
    const form = createForm();
    expect(form.getByLabelText("Hemşire")).toBeEnabled();
    const archive = form.getByLabelText("Arşiv");
    expect(archive).toBeDisabled();
    expect(archive).toHaveAccessibleDescription(cannotGrantReason(["legacy.key"], "tr"));
  });

  it("hints the username rule while typing, as the server will apply it", () => {
    setup();
    const field = screen.getByLabelText(/^Kullanıcı adı/);
    fireEvent.change(field, { target: { value: "şule.öz" } });
    expect(screen.getByText(R.err.usernameRule)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "İlker.Şen" } });
    expect(screen.getByText(R.err.usernameRule)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "İlker.Sen" } });   // İ folds to i, like the server
    expect(screen.queryByText(R.err.usernameRule)).toBeNull();
  });

  it("shows a 422 through translateApiError and keeps the form filled", async () => {
    const err = refusal("username: Value error, Kullanıcı adı 2-128 karakter olmalı", {
      status: 422, fieldErrors: [{ field: "username", type: "value_error", message: "Value error, …" }],
    });
    setup({ store: { adminCreateUser: vi.fn(async () => { throw err; }) } });
    fireEvent.change(screen.getByLabelText(/^Kullanıcı adı/), { target: { value: "ab" } });
    fireEvent.change(screen.getByLabelText("Ad Soyad"), { target: { value: "Selin Arslan" } });
    fireEvent.click(screen.getByText("Kullanıcı oluştur"));
    const alert = await createForm().findByRole("alert");
    expect(alert).toHaveTextContent(R.err.usernameRule);
    expect(screen.getByLabelText("Ad Soyad")).toHaveValue("Selin Arslan");
  });

  it("shows a 409 translated", async () => {
    setup({ store: { adminCreateUser: vi.fn(async () => {
      throw refusal("Bu kullanıcı adı veya e-posta zaten kayıtlı", { status: 409 });
    }) } });
    fireEvent.click(screen.getByText("Kullanıcı oluştur"));
    expect(await createForm().findByText(R.err.loginTaken)).toBeInTheDocument();
  });
});

describe("LiveUserAdmin — groups", () => {
  it("edits manual groups and shows AD-sourced ones as locked", async () => {
    const store = setup();
    fireEvent.click(row("ldapci").getByText("Grupları düzenle"));
    const dialog = screen.getByRole("dialog", { name: "Grupları düzenle" });
    expect(within(dialog).getByLabelText(/^Hemşire/)).toBeDisabled();        // ldap-sourced ("Hemşire AD")
    expect(within(dialog).getByLabelText(/^Hemşire/)).toBeChecked();
    fireEvent.click(within(dialog).getByLabelText("Sorumlu Hemşire"));
    fireEvent.click(within(dialog).getByText("Grupları kaydet"));
    await waitFor(() => expect(store.adminSetUserGroups).toHaveBeenCalledWith("u2", ["g2"]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers in the editor only the groups within the session's rights", () => {
    setup();
    fireEvent.click(row("ayse").getByText("Grupları düzenle"));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText("Hemşire")).toBeChecked();
    expect(dialog.getByLabelText("Hemşire")).toBeEnabled();
    const lead = dialog.getByLabelText("Nöbet Amiri");
    expect(lead).toBeDisabled();
    expect(lead).toHaveAccessibleDescription(cannotGrantReason(["shifts.manage"], "tr"));
  });

  it("cannot be dismissed while saving, so the refusal lands in the open editor", async () => {
    let fail;
    setup({ store: { adminSetUserGroups: vi.fn(() => new Promise((_, reject) => { fail = reject; })) } });
    fireEvent.click(row("ayse").getByText("Grupları düzenle"));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByText("Grupları kaydet"));
    await waitFor(() => expect(dialog.getByRole("button", { name: "Vazgeç" })).toBeDisabled());
    fireEvent.click(dialog.getByRole("button", { name: "Vazgeç" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fail(refusal("Son yönetici yetkisi kaldırılamaz", { status: 409 }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(R.err.lastAdmin);
    fireEvent.click(dialog.getByRole("button", { name: "Vazgeç" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the editor open and shows the server's refusal", async () => {
    setup({ store: { adminSetUserGroups: vi.fn(async () => {
      throw refusal("Kendi yetkilerinizi aşan bir işlem yapılamaz: shifts.manage", { status: 403 });
    }) } });
    fireEvent.click(row("ayse").getByText("Grupları düzenle"));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Grupları kaydet"));
    const dialog = within(screen.getByRole("dialog"));
    expect(await dialog.findByRole("alert")).toHaveTextContent(beyondReason("Nöbet çizelgesi"));
  });
});

describe("LiveUserAdmin — actions", () => {
  it("offers a password reset only for local accounts", () => {
    setup();
    expect(row("ayse").getByText("Parola sıfırla")).toBeInTheDocument();
    expect(row("ldapci").queryByText("Parola sıfırla")).toBeNull();
  });

  it("resets a password without ever showing it", async () => {
    const store = setup();
    fireEvent.click(row("ayse").getByText("Parola sıfırla"));
    const dialog = within(screen.getByRole("dialog", { name: "Parola sıfırla" }));
    const pw = dialog.getByLabelText(/^Yeni parola/);
    expect(pw).toHaveAttribute("type", "password");
    fireEvent.change(pw, { target: { value: "Yeni-Gecici-9" } });
    expect(document.body.textContent).not.toContain("Yeni-Gecici-9");
    fireEvent.click(dialog.getByRole("button", { name: /Parola sıfırla/ }));
    await waitFor(() => expect(store.adminResetPassword).toHaveBeenCalledWith("u1", "Yeni-Gecici-9"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("resets MFA through the store", async () => {
    const store = setup();
    fireEvent.click(row("ldapci").getByText("MFA sıfırla"));
    await waitFor(() => expect(store.adminResetMfa).toHaveBeenCalledWith("u2"));
  });

  it("deactivates and reactivates through the store", async () => {
    const store = setup();
    fireEvent.click(row("ayse").getByText("Pasifleştir"));
    await waitFor(() => expect(store.adminUpdateUser).toHaveBeenCalledWith("u1", { is_active: false }));
    fireEvent.click(row("pasif").getByText("Aktifleştir"));
    await waitFor(() => expect(store.adminUpdateUser).toHaveBeenCalledWith("u4", { is_active: true }));
  });

  it("surfaces a refusal from the server", async () => {
    setup({ store: { adminUpdateUser: vi.fn(async () => { throw new Error("Son yönetici pasifleştirilemez"); }) } });
    fireEvent.click(row("ayse").getByText("Pasifleştir"));
    expect(await row("ayse").findByText(R.err.lastAdminDeactivate)).toBeInTheDocument();
  });

  it("shows the refusals only the server can make (shared account, platform operator)", async () => {
    setup({ store: {
      adminResetMfa: vi.fn(async () => {
        throw refusal("Bu hesap başka bir kurumda da etkin; parola, MFA, e-posta, ad ve etkinlik buradan "
          + "değiştirilemez, yalnızca bu kurumdaki grupları ayarlanabilir", { status: 409 });
      }),
      adminUpdateUser: vi.fn(async () => {
        throw refusal("Platform operatörü hesabı kurum yönetiminden değiştirilemez; yalnızca bu kurumdaki "
          + "grupları ayarlanabilir", { status: 409 });
      }),
    } });
    fireEvent.click(row("ayse").getByText("MFA sıfırla"));
    expect(await row("ayse").findByText(R.err.sharedAccount)).toBeInTheDocument();
    fireEvent.click(row("ldapci").getByText("Pasifleştir"));
    expect(await row("ldapci").findByText(R.err.platformAccount)).toBeInTheDocument();
  });

  it("never offers a reset or deactivation on yourself, and says why", () => {
    setup();
    const me = row("yonetici");
    const reset = me.getByRole("button", { name: /Parola sıfırla/ });
    expect(reset).toBeDisabled();
    expect(reset).toHaveAccessibleDescription(R.err.selfCredentials);
    expect(me.getByRole("button", { name: /MFA sıfırla/ })).toBeDisabled();
    const off = me.getByRole("button", { name: /Pasifleştir/ });
    expect(off).toBeDisabled();
    expect(off).toHaveAccessibleDescription(R.err.selfDeactivate);
    expect(me.getByRole("button", { name: /Grupları düzenle/ })).toBeEnabled();
  });

  it("does not act on a user whose rights exceed the session's", () => {
    setup();
    const lead = row("mehmet");
    for (const name of [/Grupları düzenle/, /Parola sıfırla/, /MFA sıfırla/, /Pasifleştir/]) {
      const button = lead.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(beyondReason("Nöbet çizelgesi"));
    }
  });

  it("does not reactivate a user whose rights exceed the session's", () => {
    setup();
    const on = row("eski.amir").getByRole("button", { name: /Aktifleştir/ });
    expect(on).toBeDisabled();
    expect(on).toHaveAccessibleDescription(beyondReason("Nöbet çizelgesi"));
  });

  it("does not act on a user in a group it cannot see", () => {
    setup();
    const unknown = row("bilinmeyen");
    const button = unknown.getByRole("button", { name: /Pasifleştir/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(R.err.beyondOwnRights);
  });

  it("without the session's id, treats every account as possibly yourself", () => {
    setup({ selfId: null });
    expect(row("ayse").getByRole("button", { name: /Pasifleştir/ })).toBeDisabled();
    expect(row("ayse").getByRole("button", { name: /Grupları düzenle/ })).toBeEnabled();
  });

  it("speaks the given language", async () => {
    setup({ lang: "en", store: { adminUpdateUser: vi.fn(async () => {
      throw new Error("Son yönetici pasifleştirilemez");
    }) } });
    const E = cstrings("en").rbac;
    const ayse = row("ayse");
    expect(ayse.getByText(E.sourceLocal)).toBeInTheDocument();
    fireEvent.click(ayse.getByText(E.deactivate));
    expect(await ayse.findByText(E.err.lastAdminDeactivate)).toBeInTheDocument();
  });
});

describe("LiveStaffTab", () => {
  const loaded = () => waitFor(() => expect(screen.queryByText(R.loading)).toBeNull());
  const tabState = (over = {}) => ({
    user: { id: SELF, perms: ["users.manage", "groups.manage"] }, adminUsers: [], adminGroups: [],
    adminPermissions: [], adminError: null, ...over,
  });

  it("loads the administration data once on mount and renders both panels", async () => {
    const store = { loadAdmin: vi.fn(async () => {}) };
    render(<LiveStaffTab T={T} S={S} store={store} state={tabState()} />);
    await waitFor(() => expect(store.loadAdmin).toHaveBeenCalledTimes(1));
    await loaded();
    expect(screen.getAllByText("Kullanıcılar").length).toBeGreaterThan(0);
    expect(screen.getByText("Gruplar ve İzinler")).toBeInTheDocument();
  });

  it("says it is loading until the data arrives", async () => {
    let finish;
    const store = { loadAdmin: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
    render(<LiveStaffTab T={T} S={S} store={store} state={tabState()} />);
    expect(screen.getByText(R.loading)).toBeInTheDocument();
    await waitFor(() => expect(store.loadAdmin).toHaveBeenCalled());
    finish();
    await waitFor(() => expect(screen.queryByText(R.loading)).toBeNull());
  });

  it("shows the load error translated when the API refused", async () => {
    const store = { loadAdmin: vi.fn(async () => {}) };
    render(<LiveStaffTab T={T} S={S} store={store}
      state={tabState({ user: { perms: ["users.manage"] }, adminError: "permission required: groups.manage" })} />);
    await loaded();
    expect(screen.getByRole("alert")).toHaveTextContent(
      `${R.loadFailed}: ${R.err.permissionRequired.replace("{perms}", R.perm["groups.manage"])}`);
  });

  it("passes the language to both panels", async () => {
    const store = { loadAdmin: vi.fn(async () => {}) };
    const E = cstrings("en");
    render(<LiveStaffTab T={T} S={E} lang="en" store={store}
      state={tabState({ adminError: "Kendi yetkilerinizi aşan bir işlem yapılamaz: shifts.manage",
        adminGroups: [GROUPS[1]], adminPermissions: CATALOGUE })} />);
    await waitFor(() => expect(screen.queryByText(E.rbac.loading)).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent(E.rbac.perm["shifts.manage"]);
    expect(screen.getAllByText(E.rbac.usersTitle).length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("group-nurse")).getByText(E.rbac.perm["board.view"])).toBeInTheDocument();
  });

  it("a groups desk without users.manage sees only the groups panel", async () => {
    const store = { loadAdmin: vi.fn(async () => {}) };
    render(<LiveStaffTab T={T} S={S} store={store}
      state={tabState({ user: { id: SELF, perms: ["groups.manage"] }, adminGroups: [GROUPS[1]] })} />);
    await loaded();
    expect(screen.queryByTestId("create-user-form")).toBeNull();
    expect(screen.getByText("Gruplar ve İzinler")).toBeInTheDocument();
  });
});

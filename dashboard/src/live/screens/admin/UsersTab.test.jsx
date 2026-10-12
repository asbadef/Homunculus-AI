// The users and units tab (G1-12). Synthetic accounts only (admin.testutil.js).
//
// Every refusal is asserted where a reader meets it — on the toast, named after the account — and
// every count is asserted to be absent when the read behind it did not answer. Those two are the
// rules three arms and two reviews missed on the clinical screens. And every write that SUCCEEDS
// asserts two things: the confirmation the administrator reads, and that NO alert is on screen —
// because a success that also announces a refusal is exactly the Critical the patient arm shipped
// ("toast.show is not a function"), and a test that asserts the API call alone cannot see it.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { board, entry, identity } from "../../data/board.testutil.js";
import { PERMISSION_KEYS } from "./catalogue.js";
import {
  ADMIN_READS, CATALOGUE, GROUPS, NURSE_GROUP, SYSTEM_GROUP, USERS, adminProp, group, member, scopeView, user,
} from "./admin.testutil.js";
import { FIELD_MAX } from "./limits.js";
import { groupFromApi, userFromApi } from "./rules.js";
import { UsersTab, mfaState } from "./UsersTab.jsx";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const alerts = () => screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
/** A full administrator. It has to be the WHOLE catalogue by default, not a plausible three keys:
 *  `canManageUser` refuses a user whose own rights exceed the desk's, so a desk holding
 *  `users.manage` and `board.view` may not act on a nurse — the nurse holds `alerts.ack` — and
 *  every action test would have been asserting the refusal instead of the action. Narrow desks are
 *  passed explicitly by the tests that are about a refusal. */
const DESK = [...PERMISSION_KEYS];

/** The tab on its own, with the loader's answers already in `admin` — built by `adminProp`, the
 *  one builder of the object `AdminScreen` hands a tab, in the shapes AND the read states
 *  `useAdminData` produces, so a test cannot pass this tab a payload or a state the loader could
 *  not (`users: null` is a read that failed; `reads: { users: "stale" }` the last answer, kept).
 *  `reload` is a spy: every write must call it, because the screen then shows what the server
 *  holds rather than what it hoped.
 *
 *  `patients` puts cards on the BOARD (`board.testutil.js`), which is where the scope editor's unit
 *  and bed keys come from — there is no endpoint that lists them. */
async function open({ perms = DESK, users = USERS, groups = GROUPS, catalogue = CATALOGUE,
  unassigned = 2, reads, selfId = "u-admin", setup, patients = [] } = {}) {
  const admin = adminProp({ users, groups, catalogue, unassigned, reads });
  const { reload } = admin;
  const mounted = await mount(<UsersTab admin={admin} />, {
    access: token({ sub: selfId, perms }),
    me: profile({ id: selfId, perms }),
    setup: (api) => {
      ADMIN_READS(api);
      api.boardPatients.mockResolvedValue(board(patients));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      setup?.(api);
    },
  });
  if (patients.length > 0) {
    await act(async () => { await mounted.board.start(); });
    await act(async () => { mounted.stream.open(); await settle(); });
  }
  return { ...mounted, admin, reload };
}

/** What a write that LANDED must look like to the administrator: the confirmation, and no alert.
 *  The toast's error region is mounted before the first toast (ui/Toast.jsx), so "no alert" is
 *  "every alert region is empty", never "no alert element". */
function expectConfirmed(text) {
  expect(screen.getAllByText(text).length, `confirmation ${text}`).toBeGreaterThan(0);
  expect(screen.getAllByRole("alert").map((a) => a.textContent).join("").trim()).toBe("");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the list", () => {
  it("lists the users with every column, and the username under the name", async () => {
    await open();
    const table = screen.getByRole("table", { name: "İstifadəçilər və səlahiyyətləri" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Ad", "İstifadəçi adı", "Rol", "Şöbələr", "Vəziyyət", "2FA", "Son giriş", "Əməliyyatlar",
    ]);
    const row = within(table).getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(row).getByText("Ayşe Sentetik")).toBeInTheDocument();
    expect(within(row).getAllByText("hs.aygun").length).toBeGreaterThan(1);   // name cell + row header
    expect(within(row).getByText("Hemşire")).toBeInTheDocument();
  });

  it("a temporary password is a tag, not a silence; \"required · not set up\" is not \"off\"", async () => {
    await open({ groups: [SYSTEM_GROUP, group("nurse", { mfa_required: true, member_count: 4 })] });
    const nurse = screen.getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(nurse).getByText("növbəti girişdə şifrə")).toBeInTheDocument();
    expect(within(nurse).getByText("Məcburi · qurulmayıb")).toBeInTheDocument();
    expect(within(nurse).queryByText("Bağlı")).toBeNull();
  });

  it("the 2FA cell says \"unknown\" for the row whose group is not in the list — never \"off\"", async () => {
    // The same row's actions already read "rights unknown"; a confident "off" beside that would be
    // the screen claiming a rule it cannot see. `mfaState` is the one function behind the cell.
    await open();
    const stranger = screen.getByRole("rowheader", { name: /hs\.gece/ }).closest("tr");
    expect(within(stranger).getByText("Bilinmir · qrupu siyahıda yoxdur")).toBeInTheDocument();
    expect(within(stranger).queryByText("Bağlı")).toBeNull();
    const known = GROUPS.map(groupFromApi);
    expect(mfaState(userFromApi(USERS[2]), known)).toBe("unknown");
    expect(mfaState(userFromApi(USERS[0]), known)).toBe("off");
    expect(mfaState(userFromApi(USERS[1]), known)).toBe("on");
  });

  it("a user who has never signed in says so, and one who has gets the date", async () => {
    await open();
    const ad = screen.getByRole("rowheader", { name: /dr\.kamran/ }).closest("tr");
    expect(within(ad).getByText("Heç girməyib")).toBeInTheDocument();
    const nurse = screen.getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(nurse).getByText(/10\.10\.2026/)).toBeInTheDocument();
  });

  it("claims nothing about a user's units until that user's scope has been read", async () => {
    // There is NO bulk scope read: /scope/{id} is per user and /scope/unassigned answers a count.
    // So the cell must not say "no unit assigned" — which is a statement — for a scope nobody read.
    await open();
    const nurse = screen.getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(nurse).getByText("Oxunmayıb")).toBeInTheDocument();
    expect(within(nurse).queryByText("Şöbə təyin edilməyib")).toBeNull();
  });

  it("searches name and username, folding diacritics, and says how much it is hiding", async () => {
    await open();
    // Never sent: its limit is the longest "<name> <username>" a row can hold, from the server's two.
    expect(screen.getByLabelText("Ad və ya istifadəçi adı axtar"))
      .toHaveAttribute("maxlength", String(FIELD_MAX.full_name + 1 + FIELD_MAX.username));
    fireEvent.change(screen.getByLabelText("Ad və ya istifadəçi adı axtar"), { target: { value: "ayse" } });
    // The row header carries the login and, under it, where the account comes from.
    expect(screen.getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["hs.aygunLokal"]);
    expect(screen.getByText("3 hesabdan 1 göstərilir.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ad və ya istifadəçi adı axtar"), { target: { value: "gecə" } });
    expect(screen.getAllByRole("rowheader")).toHaveLength(1);
  });

  it("filters by role, read from the API's own kind", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Rol"), { target: { value: NURSE_GROUP.id } });
    expect(screen.getAllByRole("rowheader")).toHaveLength(2);         // the local nurse and the AD one
    expect(screen.queryByText("Gecə Sintetik")).toBeNull();
    // The filter offers ROLES only — `kind` as the server reports it, so a hospital-made group
    // (kind null) and a duty (charge_nurse) are not offered as a role.
    const options = [...screen.getByLabelText("Rol").querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toContain("Hemşire");
    expect(options).toContain("Sistem yöneticisi");
    expect(options).not.toContain("Gece ekibi");
  });

  it("says no user matches rather than showing an empty table", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Ad və ya istifadəçi adı axtar"), { target: { value: "zzz" } });
    expect(screen.getByText("Uyğun gələn istifadəçi yoxdur.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the count of users with no assignment only when its read answered — never a failed or a stale one", async () => {
    await open();
    expect(screen.getByText("Heç bir təyinatı olmayan istifadəçi: 2")).toBeInTheDocument();
    cleanup();
    await open({ unassigned: null });
    expect(screen.getByText("Heç bir təyinatı olmayan istifadəçilərin sayı oxunmadı.")).toBeInTheDocument();
    expect(screen.queryByText(/istifadəçi: 0/)).toBeNull();
    cleanup();
    // The last answer, kept through a failed re-read (`useAdminData` "stale"): a LIST may be drawn
    // from it, a COUNT may not — "2 right now" is a claim about now that nobody has made.
    await open({ reads: { unassigned: "stale" } });
    expect(screen.getByText("Heç bir təyinatı olmayan istifadəçilərin sayı oxunmadı.")).toBeInTheDocument();
    expect(screen.queryByText(/istifadəçi: 2/)).toBeNull();
  });

  it("a user list that could not be read says so — never \"no user matches\" over an empty table", async () => {
    // A failed read is null, never `[]` (`useAdminData`): `[]` is what "this hospital has no users"
    // looks like. The frame's Alert names the read and the reason; the tab says what it cannot show.
    await open({ users: null });
    expect(screen.getByText("İstifadəçi siyahısı oxunmadı; səbəbi yuxarıda yazılıb.")).toBeInTheDocument();
    expect(screen.queryByText("Uyğun gələn istifadəçi yoxdur.")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    cleanup();
    // A STALE list — the last answer, kept through a failed re-read — is drawn; the frame's Alert
    // says it is the last one received.
    await open({ reads: { users: "stale" } });
    expect(screen.getAllByRole("rowheader")).toHaveLength(USERS.length);
  });

  it("says out loud that it loaded the whole hospital once the list is large", async () => {
    const many = Array.from({ length: 200 }, (_, i) => user(`u-${i}`, { username: `hs.s${i}`, full_name: `Sintetik ${i}` }));
    await open({ users: many });
    expect(screen.getByText(/200 hesabın hamısını bir sorğuda yükləyir/)).toBeInTheDocument();
    // 50 rows at a time, not 200: the slow commit is the first symptom of an unpaginated list.
    expect(screen.getAllByRole("rowheader")).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "150 sətir daha göstər" }));
    expect(screen.getAllByRole("rowheader")).toHaveLength(100);
  });
});

describe("what a desk may not do", () => {
  it("draws no action the session may not take, and says why once per row", async () => {
    const admin = user("u-boss", { username: "mudur", full_name: "Müdür Sintetik", groups: [member(SYSTEM_GROUP)] });
    await open({ perms: ["users.manage"], users: [...USERS, admin] });
    const row = screen.getByRole("rowheader", { name: /mudur/ }).closest("tr");
    expect(within(row).getByText(/səlahiyyətləri sizinkini aşır/)).toBeInTheDocument();
    expect(within(row).queryAllByRole("button")).toEqual([]);
  });

  it("a user one of whose groups is unknown is not acted on, and the row says the rights are unknown", async () => {
    await open();
    const row = screen.getByRole("rowheader", { name: /hs\.gece/ }).closest("tr");
    expect(within(row).getByText(/qruplarından biri siyahıda yoxdur/)).toBeInTheDocument();
    expect(within(row).queryAllByRole("button")).toEqual([]);
  });

  it("your own account offers no password, no 2FA and no deactivation, and says why", async () => {
    const self = user("u-admin", { username: "mudur", full_name: "Müdür Sintetik", groups: [member(NURSE_GROUP)] });
    await open({ users: [self], selfId: "u-admin" });
    const row = screen.getByRole("rowheader", { name: /mudur/ }).closest("tr");
    expect(within(row).getByText(/Öz hesabınızın şifrəsini/)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Şifrəni sıfırla/ })).toBeNull();
    expect(within(row).queryByRole("button", { name: /2FA sıfırla/ })).toBeNull();
    expect(within(row).queryByRole("button", { name: /Passivləşdir/ })).toBeNull();
    expect(within(row).getByRole("button", { name: /Redaktə et/ })).toBeInTheDocument();
  });

  it("a directory account offers no password reset, and a local one no sign-in unlock", async () => {
    await open();
    const ad = screen.getByRole("rowheader", { name: /dr\.kamran/ }).closest("tr");
    expect(within(ad).queryByRole("button", { name: /Şifrəni sıfırla/ })).toBeNull();
    expect(within(ad).getByRole("button", { name: /Girişi aç/ })).toBeInTheDocument();
    const nurse = screen.getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(nurse).getByRole("button", { name: /Şifrəni sıfırla/ })).toBeInTheDocument();
    expect(within(nurse).queryByRole("button", { name: /Girişi aç/ })).toBeNull();
  });
});

describe("the form", () => {
  const openForm = async (over) => {
    const mounted = await open(over);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni istifadəçi" })); });
    return mounted;
  };

  it("creates a local user: the body carries the name, the login, the e-mail and every group id — and the administrator reads that it landed", async () => {
    const { api, reload } = await openForm();
    api.adminCreateUser.mockResolvedValue(user("u-new"));
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: " Ayşe Sentetik " } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.yeni" } });
    fireEvent.change(screen.getByLabelText(/E-poçt/), { target: { value: "hs.yeni@sentetik.local" } });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "gecici-1234" } });
    // Scoped to the dialog: jsdom does not implement `inert`, so the tab's own role FILTER — which
    // `admin.filterRole` names "Rol" too — is still queryable behind the open form.
    const form = within(screen.getByRole("dialog"));
    fireEvent.change(form.getByLabelText(/^Rol/), { target: { value: NURSE_GROUP.id } });
    fireEvent.click(form.getByLabelText("Gece ekibi"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "İstifadəçini yarat" })); await settle(); });
    expect(api.adminCreateUser).toHaveBeenCalledWith({
      username: "hs.yeni", email: "hs.yeni@sentetik.local", full_name: "Ayşe Sentetik",
      password: "gecici-1234", group_ids: [NURSE_GROUP.id, WARD_ID],
    });
    expectConfirmed(/İstifadəçi yaradıldı\./);
    expect(reload).toHaveBeenCalled();
  });

  it("the username cannot be edited, and the form says so", async () => {
    await open();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Redaktə et: hs\.aygun/ })[0]);
    });
    expect(screen.getByLabelText(/İstifadəçi adı/)).toBeDisabled();
    expect(screen.getByText(/sonradan dəyişdirilə bilməz/)).toBeInTheDocument();
  });

  it("a group beyond the session's rights is shown and disabled, not hidden", async () => {
    // A hospital-made group holding users.manage: a desk with board.view + users.manage may not
    // give it away, and must still be able to see that it exists.
    const strong = group("gece_yonetim", { name: "Gecə idarə", permissions: ["users.manage", "audit.view"] });
    const { api } = await openForm({ perms: ["users.manage"], groups: [...GROUPS, strong] });
    const form = within(screen.getByRole("dialog"));
    const box = form.getByLabelText(/Gecə idarə/);
    expect(box).toBeDisabled();
    // Said on the role <option> as well as under the checkbox: the group is visible in both places
    // and refused in both, which is the point — never hidden.
    expect(form.getAllByText(/səlahiyyətləri sizinkini aşır; verə bilmərsiniz/).length).toBeGreaterThan(0);
    expect(api.adminCreateUser).not.toHaveBeenCalled();
  });

  it("the directory's memberships are read-only and named", async () => {
    await open();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Redaktə et: dr\.kamran/ })[0]);
    });
    expect(screen.getByText(/AD-dən gələn qruplar burada dəyişdirilə bilməz: Hemşire/)).toBeInTheDocument();
  });

  it("a 422 on the username lands on the username field, in the reader's language, with the focus", async () => {
    const RULE = "Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.";
    const { api } = await openForm();
    api.adminCreateUser.mockRejectedValue(refusal(422, `username: ${RULE}`, {
      fieldErrors: [{ field: "username", type: "value_error", message: RULE }],
    }));
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik" } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.şə" } });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "gecici-1234" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "İstifadəçini yarat" })); await settle(); });
    expect(screen.getByText(/İstifadəçi adı 2-128 simvol olmalıdır/)).toBeInTheDocument();
    const field = screen.getByLabelText(/İstifadəçi adı/);
    expect(field).toHaveAttribute("aria-invalid", "true");
    // The field is ENABLED again and has the focus: the refusal is where the administrator can act
    // on it. (A field still `disabled` from the write cannot take focus in a browser.)
    expect(field).not.toBeDisabled();
    expect(field).toHaveFocus();
    // A 422 goes on the field and NOT on the toast — one refusal, announced once.
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join("").trim()).toBe("");
  });

  it("holds the form open while the write is in flight and keeps nothing afterwards", async () => {
    let release;
    const { api } = await openForm();
    api.adminCreateUser.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik" } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.yeni" } });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "gecici-1234" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "İstifadəçini yarat" })); });
    // Escape and the ✕ do nothing while busy: a refusal must land in an open dialog.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { release(user("u-new")); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expectConfirmed(/İstifadəçi yaradıldı\./);
    // A PASSWORD IS NEVER IN THE DOM AFTER ITS DIALOG CLOSES — not in a value, not in a title.
    expect(document.body.innerHTML).not.toContain("gecici-1234");
  });

  it("every field carries the server's own limit, so a limit is met at the keyboard", async () => {
    await openForm();
    const form = within(screen.getByRole("dialog"));
    expect(form.getByLabelText(/Ad soyad/)).toHaveAttribute("maxlength", String(FIELD_MAX.full_name));
    expect(form.getByLabelText(/İstifadəçi adı/)).toHaveAttribute("maxlength", String(FIELD_MAX.username));
    expect(form.getByLabelText(/E-poçt/)).toHaveAttribute("maxlength", String(FIELD_MAX.email));
    expect(form.getByLabelText(/Müvəqqəti şifrə/)).toHaveAttribute("maxlength", String(FIELD_MAX.password));
  });

  it("counts a password as the server counts it: four emoji are four characters, not eight", async () => {
    // `.length` counts UTF-16 units and the server's `len` code points, so "😀😀😀😀" is eight to the
    // first and four to the second: a dialog that counted `.length` sent it, and the server refused
    // it as shorter than eight. Both dialogs that take a password count as the server does.
    const { api } = await openForm();
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik" } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.yeni" } });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "😀😀😀😀" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "İstifadəçini yarat" })); await settle(); });
    expect(api.adminCreateUser).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Müvəqqəti şifrə/)).toHaveAttribute("aria-invalid", "true");

    cleanup();
    const second = await open();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Şifrəni sıfırla: hs\.aygun/ })[0]); });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "😀😀😀😀" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Şifrəni sıfırla" })); await settle(); });
    expect(second.api.adminResetPassword).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Müvəqqəti şifrə/)).toHaveAttribute("aria-invalid", "true");
  });

  it("a 422 about something no field shows goes to the toast, named after the account — never swallowed", async () => {
    // `fieldRefusals` is told which fields this dialog draws. A refusal on `group_ids.0` used to
    // come back keyed by its API path: the dialog saw "a field was named", put it under no control
    // and toasted nothing — a refusal the administrator never read.
    const { api } = await openForm();
    api.adminCreateUser.mockRejectedValue(refusal(422, "group_ids.0: Input should be a valid UUID", {
      fieldErrors: [{ field: "group_ids.0", type: "uuid_parsing", message: "Input should be a valid UUID" }],
    }));
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik" } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.yeni" } });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "gecici-1234" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "İstifadəçini yarat" })); await settle(); });
    expect(alerts()).toContain("Ayşe Sentetik");
    expect(alerts()).toContain("Input should be a valid UUID");
    for (const box of within(screen.getByRole("dialog")).getAllByRole("textbox")) {
      expect(box).not.toHaveAttribute("aria-invalid", "true");
    }
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("an edit sends the details and THEN the groups — never both at once — and reads as done", async () => {
    // PATCH (name, e-mail, active) and PUT groups are two writes, and no endpoint takes both. In
    // sequence, so the groups are never sent beside details the server is about to refuse.
    const { api, reload } = await open();
    let releasePatch;
    api.adminUpdateUser.mockImplementation(() => new Promise((resolve) => { releasePatch = resolve; }));
    api.adminSetUserGroups.mockResolvedValue({ ok: true });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Redaktə et: hs\.aygun/ })[0]); });
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik-Aygün" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); await settle(); });
    expect(api.adminUpdateUser).toHaveBeenCalledWith("u-nurse", {
      full_name: "Ayşe Sentetik-Aygün", email: "hs.aygun@sentetik.local", is_active: true,
    });
    expect(api.adminSetUserGroups).not.toHaveBeenCalled();           // not while the details are in flight
    await act(async () => { releasePatch(user("u-nurse", { full_name: "Ayşe Sentetik-Aygün" })); await settle(); });
    expect(api.adminSetUserGroups).toHaveBeenCalledWith("u-nurse", [NURSE_GROUP.id]);
    expectConfirmed(/Yadda saxlanıldı\./);
    expect(reload).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a refused edit sends no groups; groups refused after the details LANDED say which half landed, and reload", async () => {
    const { api, reload } = await open();
    api.adminUpdateUser.mockRejectedValue(refusal(403, "Kendi yetkilerinizi aşan bir işlem yapılamaz: audit.view"));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Redaktə et: hs\.aygun/ })[0]); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); await settle(); });
    expect(api.adminSetUserGroups).not.toHaveBeenCalled();
    expect(alerts()).toContain("Ayşe Sentetik");
    expect(alerts()).not.toMatch(/yadda saxlanıldı/);                  // nothing landed, and none is claimed
    expect(reload).not.toHaveBeenCalled();

    cleanup();
    // The details land, the groups do not: the account on the server HAS changed. A half-landed
    // edit reported as wholly refused, with no reload, left the list showing the old name.
    const second = await open();
    second.api.adminUpdateUser.mockResolvedValue(user("u-nurse", { full_name: "Ayşe Sentetik-Aygün" }));
    second.api.adminSetUserGroups.mockRejectedValue(refusal(403, "Kendi yetkilerinizi aşan bir işlem yapılamaz: audit.view"));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Redaktə et: hs\.aygun/ })[0]); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); await settle(); });
    expect(second.api.adminSetUserGroups).toHaveBeenCalledTimes(1);
    expect(alerts()).toContain("Ayşe Sentetik");
    expect(alerts()).toMatch(/Ad, e-poçt və aktivlik yadda saxlanıldı; qruplar saxlanılmadı: Öz səlahiyyətlərinizi aşan/);
    expect(second.reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();         // the groups can be sent again from here
  });
});

const WARD_ID = "g-gece_ekibi";

describe("the three confirmations and the unlock", () => {
  const press = async (name) => {
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name })[0]); });
  };

  it("resetting a password names the account and says the open sessions end — and reads as done", async () => {
    const { api, reload } = await open();
    api.adminResetPassword.mockResolvedValue({ ok: true });
    await press(/Şifrəni sıfırla: hs\.aygun/);
    expect(screen.getByText(/Ayşe Sentetik üçün yeni müvəqqəti şifrə təyin edin\. İstifadəçinin açıq sessiyaları bağlanır/))
      .toBeInTheDocument();
    expect(screen.getByLabelText(/Müvəqqəti şifrə/)).toHaveAttribute("maxlength", String(FIELD_MAX.password));
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "yeni-sifre-99" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Şifrəni sıfırla" })); await settle(); });
    expect(api.adminResetPassword).toHaveBeenCalledWith("u-nurse", "yeni-sifre-99");
    expectConfirmed(/Ayşe Sentetik · Müvəqqəti şifrə təyin edildi\./);
    expect(reload).toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain("yeni-sifre-99");
  });

  it("resetting two-step verification names the account and the consequence", async () => {
    const { api } = await open();
    api.adminResetMfa.mockResolvedValue({ ok: true });
    await press(/2FA sıfırla: hs\.aygun/);
    expect(screen.getByText(/Ayşe Sentetik istifadəçisinin iki addımlı doğrulaması sıfırlanacaq/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "2FA sıfırla" })); await settle(); });
    expect(api.adminResetMfa).toHaveBeenCalledWith("u-nurse");
    expectConfirmed(/Ayşe Sentetik · İki addımlı doğrulama sıfırlandı\./);
  });

  it("deactivating names the account and says it can no longer sign in", async () => {
    const { api } = await open();
    api.adminUpdateUser.mockResolvedValue(user("u-nurse", { is_active: false }));
    await press(/Passivləşdir: hs\.aygun/);
    expect(screen.getByText(/Ayşe Sentetik passivləşdiriləcək; açıq sessiyaları bağlanır/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Passivləşdir" })); await settle(); });
    expect(api.adminUpdateUser).toHaveBeenCalledWith("u-nurse", { is_active: false });
    expectConfirmed(/Ayşe Sentetik · Hesab passivləşdirildi\./);
  });

  it("the unlock asks for a reason, refuses an empty one before sending, and says it is audited", async () => {
    const { api } = await open();
    api.adminUnlockSignIn.mockResolvedValue({ ok: true });
    await press(/Girişi aç: dr\.kamran/);
    expect(screen.getByText(/Səbəb audit jurnalına yazılır/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Səbəb/)).toHaveAttribute("maxlength", String(FIELD_MAX.reason));
    fireEvent.change(screen.getByLabelText(/Səbəb/), { target: { value: "   " } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Girişi aç" })); await settle(); });
    expect(api.adminUnlockSignIn).not.toHaveBeenCalled();
    // On the FIELD, not merely somewhere: `admin.reasonHint` carries the same phrase, so the
    // assertion is that the control is marked invalid and names the refusal first.
    const reason = screen.getByLabelText(/Səbəb/);
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(reason.getAttribute("aria-describedby").split(" ")[0]).textContent)
      .toMatch(/ən azı bir hərf və ya rəqəm/);
    fireEvent.change(screen.getByLabelText(/Səbəb/), { target: { value: "telefonla kimliyi doğrulandı" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Girişi aç" })); await settle(); });
    expect(api.adminUnlockSignIn).toHaveBeenCalledWith("u-ad", "telefonla kimliyi doğrulandı");
    // No trailing full stop in the pattern: Task 14 appends the server's own count to this sentence.
    expectConfirmed(/Kamran Sintetik · Kataloq girişi bir dəfə açıldı/);
  });

  it("a refusal is on the TOAST, names the account, and the dialog stays open", async () => {
    const { api, reload } = await open();
    api.adminResetMfa.mockRejectedValue(refusal(409, "Kendi parolanızı veya MFA'nızı buradan sıfırlayamazsınız; parola için Hesabım > Parola değiştir'i kullanın"));
    await press(/2FA sıfırla: hs\.aygun/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "2FA sıfırla" })); await settle(); });
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
    expect(alerts).toContain("Ayşe Sentetik");
    expect(alerts).toContain("Öz şifrənizi");
    expect(screen.getByRole("dialog")).toBeInTheDocument();      // not dismissed on a refusal
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("the scope editor", () => {
  const openScope = async (over) => {
    const mounted = await open(over);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Şöbələr: hs\.aygun/ })[0]);
      await settle();
    });
    return mounted;
  };

  it("a user unrestricted BY ROLE gets no editor and the reason why", async () => {
    await openScope({ setup: (api) => api.userScope.mockResolvedValue(scopeView({ unrestricted: true, reason: "role" })) });
    expect(screen.getByText(/Bu istifadəçi rolu gərəyi bütün xəstələri görür \(administrator və ya platforma operatoru\)/))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Əhatəni yadda saxla" })).toBeNull();
  });

  it("an UNASSIGNED user gets the editor, is told she sees every patient until it is used, and receives her first unit", async () => {
    // The pilot's normal state for every non-administrator: SCOPE_ENFORCE_UNASSIGNED is off, so
    // /scope/{id} answers `unrestricted: true, reason: "unassigned"`. The first version read that
    // flag as "nothing to assign": no first assignment could be made from this screen, and the row
    // said "scope unrestricted" about a nurse nobody had assigned (`rules.scopeKind`).
    const { api } = await openScope({
      patients: [entry("S-001", [], { identity: identity({ unit_id: "REA-01" }) })],
      setup: (api2) => api2.userScope.mockResolvedValue(scopeView({ user_id: "u-nurse", unrestricted: true, reason: "unassigned" })),
    });
    expect(screen.getByText(/bu istifadəçi hazırda bütün xəstələri görür/)).toBeInTheDocument();
    expect(screen.queryByText(/rolu gərəyi bütün xəstələri görür/)).toBeNull();
    const row = screen.getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(row).getByText("Şöbə təyin edilməyib")).toBeInTheDocument();
    expect(within(row).queryByText("Əhatə məhdud deyil")).toBeNull();
    api.setScope.mockResolvedValue(scopeView({ user_id: "u-nurse", grants: [{ unit_id: "REA-01" }] }));
    api.userScope.mockResolvedValue(scopeView({ user_id: "u-nurse", grants: [{ unit_id: "REA-01" }] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "REA-01" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Əhatəni yadda saxla" })); await settle(); });
    expect(api.setScope).toHaveBeenCalledWith("u-nurse", [{ unit_id: "REA-01" }]);
    expectConfirmed(/Ayşe Sentetik · Əhatə yadda saxlanıldı\./);
    expect(within(row).getByText("1 şöbə")).toBeInTheDocument();
  });

  it("when the desk's OWN scope cannot be read, the toast names that read — not the user — and offers no Save", async () => {
    // /scope/me is the only source for "may this desk assign a scope at all" (`canAssignScope`).
    // Its failure is about the desk, not about the nurse the editor was opened for: a toast that
    // named her blamed the wrong record. Her scope WAS read, so the editor opens, and says the
    // right is unknown instead of offering a Save that may not work.
    await openScope({ setup: (api) => {
      api.myScope.mockRejectedValue(refusal(403, "permission required: users.manage"));
      api.userScope.mockResolvedValue(scopeView({ grants: [{ unit_id: "REA-01" }] }));
    } });
    expect(alerts()).toContain("Öz əhatəniz oxunmadı");
    expect(alerts()).not.toContain("Ayşe Sentetik");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Əhatə təyin etmək səlahiyyətiniz hələ oxunmadı/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Əhatəni yadda saxla" })).toBeNull();
  });

  it("offers the board's own keys and the user's own grants, and says where they come from", async () => {
    await openScope({
      patients: [
        entry("S-001", [], { identity: identity({ unit_id: "REA-01", bed_id: "REA-01-2" }) }),
        entry("S-002", [], { identity: identity({ patient_id: "S-002", unit_id: "NICU-01", bed_id: "NICU-01-1" }) }),
      ],
      setup: (api) => api.userScope.mockResolvedValue(scopeView({ grants: [{ unit_id: "REA-09" }] })),
    });
    expect(screen.getByText(/Seçimlər panelin hazırkı kartlarından/)).toBeInTheDocument();
    for (const key of ["REA-01", "NICU-01", "REA-09"]) {
      expect(screen.getByRole("checkbox", { name: key })).toBeInTheDocument();
    }
    expect(screen.getByRole("checkbox", { name: "REA-09" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "NICU-01" })).not.toBeChecked();
  });

  it("a key with no card on the board can be added by hand, and the screen says what that means", async () => {
    await openScope({ setup: (api) => api.userScope.mockResolvedValue(scopeView({ grants: [] })) });
    expect(screen.getByText(/Mühərrikdə bu açarla uyğun kart yoxdursa əhatə heç nə açmır/)).toBeInTheDocument();
    // The column's own limit: ScopeGrantIn states none, and a longer key is a database error.
    expect(screen.getByLabelText(/Şöbə və ya çarpayı açarı/)).toHaveAttribute("maxlength", String(FIELD_MAX.scope_key));
    fireEvent.change(screen.getByLabelText(/Şöbə və ya çarpayı açarı/), { target: { value: "REA-77" } });
    fireEvent.click(screen.getByRole("button", { name: "Əlavə et" }));
    expect(screen.getByRole("rowheader", { name: "REA-77" })).toBeInTheDocument();
  });

  it("saving sends the WHOLE list, as units and beds, reads it back, and reads as done", async () => {
    const { api } = await openScope({
      patients: [entry("S-001", [], { identity: identity({ unit_id: "REA-01", bed_id: "REA-01-2" }) })],
      setup: (api2) => api2.userScope.mockResolvedValue(scopeView({ grants: [{ unit_id: "REA-09" }] })),
    });
    api.setScope.mockResolvedValue(scopeView({ grants: [{ unit_id: "REA-09" }, { bed_id: "REA-01-2" }] }));
    fireEvent.click(screen.getByRole("checkbox", { name: "REA-01-2" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Əhatəni yadda saxla" })); await settle(); });
    expect(api.setScope).toHaveBeenCalledWith("u-nurse", [{ unit_id: "REA-09" }, { bed_id: "REA-01-2" }]);
    expect(api.userScope).toHaveBeenCalledTimes(2);                    // read back, not assumed
    expectConfirmed(/Ayşe Sentetik · Əhatə yadda saxlanıldı\./);
  });

  it("a refusal puts the previous list back, says so, and names the account on the toast", async () => {
    const { api } = await openScope({
      patients: [entry("S-001", [], { identity: identity({ unit_id: "REA-01" }) })],
      setup: (api2) => api2.userScope.mockResolvedValue(scopeView({ grants: [{ unit_id: "REA-09" }] })),
    });
    api.setScope.mockRejectedValue(refusal(403, "kapsam atamak için kapsamı sınırsız bir yönetici olmalısınız"));
    fireEvent.click(screen.getByRole("checkbox", { name: "REA-01" }));
    expect(screen.getByRole("checkbox", { name: "REA-01" })).toBeChecked();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Əhatəni yadda saxla" })); await settle(); });
    expect(screen.getByRole("checkbox", { name: "REA-01" })).not.toBeChecked();
    expect(screen.getByText("Mühərrik qəbul etmədi; ekrandakı əhatə geri alındı.")).toBeInTheDocument();
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain("Ayşe Sentetik");
  });

  it("offers no Save to a desk the server would refuse, and says which right is missing", async () => {
    // PUT /scope/{id} needs the CALLER's own scope to be unrestricted BY ROLE. A desk unrestricted
    // only because nobody has been assigned anything yet is refused — the pilot's normal state.
    await openScope({ setup: (api) => {
      api.myScope.mockResolvedValue(scopeView({ unrestricted: true, reason: "unassigned" }));
      api.userScope.mockResolvedValue(scopeView({ grants: [] }));
    } });
    expect(screen.queryByRole("button", { name: "Əhatəni yadda saxla" })).toBeNull();
    expect(screen.getByText(/kapsamı sınırsız bir yönetici olmalısınız|Əhatə təyin etmək üçün/)).toBeInTheDocument();
  });

  it("fills the row's units cell once that user's scope has been read", async () => {
    await openScope({ setup: (api) => api.userScope.mockResolvedValue(scopeView({ grants: [{ unit_id: "REA-01" }] })) });
    fireEvent.click(screen.getByRole("button", { name: "İmtina" }));
    const row = screen.getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(row).getByText("1 şöbə")).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("the list is a table with a caption, column headers and the username as the row header", async () => {
    await open();
    const table = screen.getByRole("table", { name: "İstifadəçilər və səlahiyyətləri" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(8);
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header.getAttribute("scope")).toBe("col");
    }
    for (const header of within(table).getAllByRole("rowheader")) {
      expect(header.getAttribute("scope")).toBe("row");
    }
  });

  it("has no h1 of its own: the screen's heading is the frame's", async () => {
    await open();
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
  });

  it("every control the tab draws is reachable from the keyboard", async () => {
    await open();
    for (const control of screen.getAllByRole("button")) {
      expect(control.tabIndex, control.getAttribute("aria-label") || control.textContent).toBeGreaterThanOrEqual(0);
      expect(control.hasAttribute("disabled")).toBe(false);     // busy, never disabled
    }
  });

  it("says which account a write is in flight for, once", async () => {
    let release;
    const { api } = await open();
    api.adminResetMfa.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /2FA sıfırla: hs\.aygun/ })[0]); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "2FA sıfırla" })); await settle(); });
    await waitFor(() => expect(screen.getAllByRole("status").map((s) => s.textContent).join(" "))
      .toContain("hs.aygun"), { timeout: 4000 });
    await act(async () => { release({ ok: true }); await settle(); });
    expectConfirmed(/Ayşe Sentetik · İki addımlı doğrulama sıfırlandı\./);
  });
});

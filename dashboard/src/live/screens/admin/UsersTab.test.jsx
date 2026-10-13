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
  ADMIN_READS, CATALOGUE, GROUPS, NURSE_GROUP, SYSTEM_GROUP, USERS, WARD_GROUP, adminProp, group, member, scopeView, user,
} from "./admin.testutil.js";
import { FIELD_MAX } from "./limits.js";
import { groupFromApi, userFromApi } from "./rules.js";
import { AdminScreen, onlyTabs, resetTabs } from "./AdminScreen.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import ADMIN_STRINGS from "../../i18n/strings/admin.js";
import { UsersTab, mfaState } from "./UsersTab.jsx";
import { splitGroups } from "./UserForm.jsx";

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

/** A deep copy: what the server holds is never the object the screen was handed. */
const copy = (value) => JSON.parse(JSON.stringify(value));

/** A server that REMEMBERS (the review round's harness): every read answers what the writes left
 *  behind, and "another desk" can change it between this screen's read and its write — which a
 *  `reload` spy cannot show, because the defect was what a stale write did TO THE SERVER. The
 *  memberships write follows Task 14e's contract (X1): a PUT carrying `expected_group_ids` that
 *  differ from the manual memberships it would replace is refused, 409 concurrentChange, and
 *  nothing is written. */
function rememberingServer(api) {
  const state = { users: copy(USERS) };
  const find = (id) => state.users.find((u) => u.id === id);
  // Compared as SETS, as `admin/router.set_user_groups` compares them (`set(expected) !=
  // set(manual)`): order and repetition say nothing about which memberships the screen read.
  const asSet = (ids) => [...new Set(ids)].sort().join();
  const manual = (u) => asSet(u.groups.filter((g) => g.source === "manual").map((g) => g.id));
  api.adminUsers.mockImplementation(async () => copy(state.users));
  api.adminUpdateUser.mockImplementation(async (id, patch) => {
    const row = find(id);
    if ("full_name" in patch) row.full_name = patch.full_name;
    if ("email" in patch) row.email = patch.email || null;
    if ("is_active" in patch) row.is_active = patch.is_active;
    return copy(row);
  });
  api.adminSetUserGroups.mockImplementation(async (id, ids, expected) => {
    const row = find(id);
    if (Array.isArray(expected) && asSet(expected) !== manual(row)) {
      throw refusal(409, "Kayıt aynı anda değiştirildi; lütfen tekrar deneyin");
    }
    const byId = new Map(GROUPS.map((g) => [g.id, g]));
    row.groups = [...row.groups.filter((g) => g.source !== "manual"), ...ids.map((g) => member(byId.get(g)))];
    return copy(row);
  });
  return state;
}

/** The tab inside its FRAME — `AdminScreen` and its loader, so a write's reload really re-reads —
 *  against `rememberingServer`. `tabs` pins this build's tabs (`onlyTabs`). */
async function openFrame({ tabs = { users: UsersTab }, setup } = {}) {
  onlyTabs(tabs);
  let server;
  const mounted = await mount(<AdminScreen />, {
    access: token({ sub: "u-admin", perms: DESK }),
    me: profile({ id: "u-admin", perms: DESK }),
    setup: (api) => {
      ADMIN_READS(api);
      api.boardPatients.mockResolvedValue(board([]));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      server = rememberingServer(api);
      setup?.(api);
    },
  });
  await act(async () => { await settle(); });
  return { ...mounted, server };
}

/** As the live shell has it: the tab exists only while a session does — signing out unmounts it. */
function Gate({ admin }) {
  const { user: me } = useSession();
  return me ? <UsersTab admin={admin} /> : <p>signed-out screen</p>;
}

/** The tab behind `Gate`, so a test can end the session under a write in flight. */
async function openGated({ setup } = {}) {
  const admin = adminProp();
  const mounted = await mount(<Gate admin={admin} />, {
    access: token({ sub: "u-admin", perms: DESK }),
    me: profile({ id: "u-admin", perms: DESK }),
    setup: (api) => {
      ADMIN_READS(api);
      api.boardPatients.mockResolvedValue(board([]));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      setup?.(api);
    },
  });
  return { ...mounted, admin };
}

/** Every polite region's text, joined: what a screen reader has been told. */
const spoken = () => screen.getAllByRole("status").map((s) => s.textContent).join(" ");

afterEach(() => {
  resetTabs();
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
    // "xəstəxanadakı", Azerbaijani — not the Turkish "-daki" the first version carried.
    expect(screen.getByText(/xəstəxanadakı 200 hesabın hamısını bir sorğuda yükləyir/)).toBeInTheDocument();
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
    // Named, as a refusal is: a confirmation that does not say which account it is about cannot
    // be told from the one before it.
    expectConfirmed(/Ayşe Sentetik · İstifadəçi yaradıldı\./);
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

  it("a hospital-made group the API calls an extra duty is an extra duty in the row AND in the form", async () => {
    // `GroupOut.kind` is the API's answer (Task 14c) and the role filter reads it through
    // `groupFromApi`. The form split its groups by the MIRROR (`groupKind(slug)`), which knows only
    // the eleven default slugs, and so did the row's role cell: a group the server describes as a
    // duty was a duty to the filter and an "other group" to the form and the row. One answer, read
    // everywhere; the mirror only for a group described without any kind.
    const duty = group("gece_ekibi", { name: "Gece ekibi", permissions: ["board.view"], kind: "extra" });
    const nurse = user("u-nurse", { groups: [member(NURSE_GROUP), member(duty)] });
    await open({ users: [nurse], groups: [SYSTEM_GROUP, NURSE_GROUP, duty] });
    const row = screen.getByRole("rowheader", { name: /hs\.aygun/ }).closest("tr");
    expect(within(row).getByText("Əlavə vəzifə: Gece ekibi")).toBeInTheDocument();
    expect(within(row).queryByText(/Digər qruplar/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Redaktə et: hs\.aygun/ })[0]); });
    const form = within(screen.getByRole("dialog"));
    expect(within(form.getByRole("group", { name: "Əlavə vəzifə" })).getByLabelText("Gece ekibi")).toBeChecked();
    expect(form.queryByRole("group", { name: "Digər qruplar" })).toBeNull();
    // The mirror answers only for a group the API described with no kind at all.
    expect(splitGroups([{ id: "x", slug: "charge_nurse" }]).extras.map((g) => g.id)).toEqual(["x"]);
    expect(splitGroups([{ id: "y", slug: "gece_ekibi", kind: "other" }]).others.map((g) => g.id)).toEqual(["y"]);
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
    expectConfirmed(/Ayşe Sentetik · İstifadəçi yaradıldı\./);
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

  it("a new account whose connection dropped may have been created: it says so, and the list is read again behind the form", async () => {
    // fetch() rejected with no response: the POST may have reached the engine before the line went
    // (refusal.js `mayHaveLanded`). If it did, a second press is refused as a login already taken,
    // on its field — the check the toast asks for — and the list behind the form already shows her.
    const { api, reload } = await openForm();
    api.adminCreateUser.mockRejectedValue(new TypeError("Failed to fetch"));
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik" } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.yeni" } });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "gecici-1234" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "İstifadəçini yarat" })); await settle(); });
    expect(alerts()).toContain("Ayşe Sentetik: Serverə qoşulmaq mümkün olmadı. Şəbəkə bağlantınızı yoxlayın. "
      + "Dəyişiklik yenə də tətbiq olunmuş ola bilər: yenidən cəhd etməzdən əvvəl yoxlayın.");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("an edit sends the details and THEN the groups — never both at once — each only as changed, and reads as done", async () => {
    // PATCH (name, e-mail, active) and PUT groups are two writes, and no endpoint takes both. In
    // sequence, so the groups are never sent beside details the server is about to refuse. And each
    // carries only what the administrator CHANGED (the review round's C1): the name and not the
    // untouched e-mail and active flag; the memberships WITH the ones the form opened with, so the
    // server can refuse a replacement built on a list it no longer holds (Task 14e).
    const { api, reload } = await open();
    let releasePatch;
    api.adminUpdateUser.mockImplementation(() => new Promise((resolve) => { releasePatch = resolve; }));
    api.adminSetUserGroups.mockResolvedValue({ ok: true });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Redaktə et: hs\.aygun/ })[0]); });
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik-Aygün" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByLabelText("Gece ekibi"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); await settle(); });
    expect(api.adminUpdateUser).toHaveBeenCalledWith("u-nurse", { full_name: "Ayşe Sentetik-Aygün" });
    expect(api.adminSetUserGroups).not.toHaveBeenCalled();           // not while the details are in flight
    await act(async () => { releasePatch(user("u-nurse", { full_name: "Ayşe Sentetik-Aygün" })); await settle(); });
    expect(api.adminSetUserGroups).toHaveBeenCalledWith("u-nurse", [NURSE_GROUP.id, WARD_ID], [NURSE_GROUP.id]);
    expectConfirmed(/Ayşe Sentetik-Aygün · Yadda saxlanıldı\./);
    expect(reload).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a refused edit sends no groups; groups refused after the details LANDED say which half landed, and reload", async () => {
    const edit = async () => {
      await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Redaktə et: hs\.aygun/ })[0]); });
      fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik-Aygün" } });
      fireEvent.click(within(screen.getByRole("dialog")).getByLabelText("Gece ekibi"));
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); await settle(); });
    };
    const { api, reload } = await open();
    api.adminUpdateUser.mockRejectedValue(refusal(403, "Kendi yetkilerinizi aşan bir işlem yapılamaz: audit.view"));
    await edit();
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
    await edit();
    expect(second.api.adminSetUserGroups).toHaveBeenCalledTimes(1);
    expect(alerts()).toContain("Ayşe Sentetik");
    expect(alerts()).toMatch(/Dəyişdirilən məlumatlar yadda saxlanıldı; qruplar saxlanılmadı: Öz səlahiyyətlərinizi aşan/);
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

  it("the unlock says what the server actually did, with the server's own number", async () => {
    // POST /unlock-sign-in answers 200 whether it let more binds through or found nothing to
    // clear; `granted` tells the two apart and `allowed_after - allowed_before` is how many it let
    // through. The screen used to claim "three more" for both — the one place in this surface it
    // said more than it was told.
    const { api } = await open();
    api.adminUnlockSignIn.mockResolvedValue({ ok: true, granted: true, allowed_before: 3, allowed_after: 6 });
    await press(/Girişi aç: dr\.kamran/);
    fireEvent.change(screen.getByLabelText(/Səbəb/), { target: { value: "telefonla doğrulandı" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Girişi aç" })); await settle(); });
    expectConfirmed(/Kamran Sintetik · Kataloq girişi bir dəfə açıldı: 3 cəhd daha\./);

    cleanup();
    const second = await open();
    second.api.adminUnlockSignIn.mockResolvedValue({ ok: true, granted: false, allowed_before: 3, allowed_after: 3 });
    await press(/Girişi aç: dr\.kamran/);
    fireEvent.change(screen.getByLabelText(/Səbəb/), { target: { value: "telefonla doğrulandı" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Girişi aç" })); await settle(); });
    expectConfirmed(/açılacaq hədd yox idi; heç nə dəyişmədi/);

    cleanup();
    // A server that reports `granted` without the numbers gets the cautious sentence: a count the
    // screen cannot verify is the over-claim this sentence exists to remove.
    const third = await open();
    third.api.adminUnlockSignIn.mockResolvedValue({ ok: true, granted: true });
    await press(/Girişi aç: dr\.kamran/);
    fireEvent.change(screen.getByLabelText(/Səbəb/), { target: { value: "telefonla doğrulandı" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Girişi aç" })); await settle(); });
    expectConfirmed(/açılacaq hədd yox idi; heç nə dəyişmədi/);
  });

  it("the unlock asks for a reason, refuses an empty one before sending, and says it is audited", async () => {
    const { api } = await open();
    api.adminUnlockSignIn.mockResolvedValue({ ok: true, granted: true, allowed_before: 3, allowed_after: 6 });
    await press(/Girişi aç: dr\.kamran/);
    expect(screen.getByText(/Səbəb audit jurnalına yazılır/)).toBeInTheDocument();
    // BEFORE the write the dialog promises no number and no lifted limit: how many more attempts an
    // unlock lets through is the server's answer (`allowed_after - allowed_before`), and with no
    // failed sign-in to clear it lets through none. "(three more attempts)" was that over-claim,
    // made before the server had said anything — in all four languages.
    expect(screen.getByText(/neçə cəhd daha verildiyini server deyir/i)).toBeInTheDocument();
    for (const lang of ["tr", "az", "ru", "en"]) {
      expect(ADMIN_STRINGS[lang].confirmUnlock, `${lang}.confirmUnlock`).not.toMatch(/üç (cəhd|deneme)|three more|ещё три|\d/i);
    }
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

  it("a deactivation whose connection dropped is not called refused: it may have gone through, and the list is read again", async () => {
    // fetch() rejected with no response: the PATCH may have reached the engine before the line went
    // (refusal.js `mayHaveLanded`), so the row is read again rather than left as it was.
    const { api, reload } = await open();
    api.adminUpdateUser.mockRejectedValue(new TypeError("Failed to fetch"));
    await press(/Passivləşdir: hs\.aygun/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Passivləşdir" })); await settle(); });
    expect(alerts()).toContain("Ayşe Sentetik: Serverə qoşulmaq mümkün olmadı. Şəbəkə bağlantınızı yoxlayın. "
      + "Dəyişiklik yenə də tətbiq olunmuş ola bilər: yenidən cəhd etməzdən əvvəl yoxlayın.");
    expect(reload).toHaveBeenCalledTimes(1);
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

// The review round (quality review of 95adfa6, proofs P1–P14). Each of these failed on that
// commit; the C1 pair runs through the FRAME against a server that remembers, because the defect
// was what a stale write did to the server, which a reload spy cannot show.
describe("the review round", () => {
  const editOf = async (login) => {
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: new RegExp(`Redaktə et: ${login}`) })[0]); });
    return within(screen.getByRole("dialog"));
  };
  const saveForm = async () => {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); await settle(); });
  };
  const rowOf = (login) => screen.getByRole("rowheader", { name: new RegExp(login) }).closest("tr");

  it("C1: fixing a name does not re-activate an account another desk deactivated since the list was read", async () => {
    const { api, server } = await openFrame();
    // Another administrator deactivates her AFTER this screen read the list.
    server.users.find((u) => u.id === "u-nurse").is_active = false;
    const form = await editOf("hs\\.aygun");
    fireEvent.change(form.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik-Aygün" } });
    await saveForm();
    // Only the name: not the e-mail, not the active flag, not the memberships the form merely read.
    expect(api.adminUpdateUser).toHaveBeenCalledWith("u-nurse", { full_name: "Ayşe Sentetik-Aygün" });
    expect(api.adminSetUserGroups).not.toHaveBeenCalled();
    expect(server.users.find((u) => u.id === "u-nurse").is_active).toBe(false);
    // The list was read again, and shows the server's account: renamed, and still deactivated.
    const row = rowOf("hs\\.aygun");
    expect(within(row).getByText("Ayşe Sentetik-Aygün")).toBeInTheDocument();
    expect(within(row).getByText("Passiv")).toBeInTheDocument();
    expectConfirmed(/Ayşe Sentetik-Aygün · Yadda saxlanıldı\./);
  });

  it("C1: memberships another desk changed since the read are not undone — refused, said, the form closes, and reopened it can land", async () => {
    const { api, server } = await openFrame();
    const nurse = () => server.users.find((u) => u.id === "u-nurse");
    // Another desk puts her on the night team after this screen's read.
    nurse().groups.push(member(WARD_GROUP));
    let form = await editOf("hs\\.aygun");
    fireEvent.change(form.getByLabelText(/^Rol/), { target: { value: SYSTEM_GROUP.id } });
    await saveForm();
    expect(api.adminUpdateUser).not.toHaveBeenCalled();
    expect(api.adminSetUserGroups).toHaveBeenCalledWith("u-nurse", [SYSTEM_GROUP.id], [NURSE_GROUP.id]);
    // Nothing of the other desk's was overwritten, and nothing of ours claimed.
    expect(nurse().groups.map((g) => g.id).sort()).toEqual([NURSE_GROUP.id, WARD_GROUP.id].sort());
    // A 409 here is a dead end from THIS form — its `expected` is the list it read, so "try again"
    // would be refused for ever (R2-3). It says why, and closes; the list was read again.
    expect(alerts()).toContain("Ayşe Sentetik: Bu hesab bu arada başqa masada dəyişdirilib; indiki vəziyyətini görmək üçün hesabı yenidən açın.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(rowOf("hs\\.aygun")).getByText(/Gece ekibi/)).toBeInTheDocument();
    // Reopened, the form reads the account as it is now, and the same change lands.
    form = await editOf("hs\\.aygun");
    expect(form.getByLabelText("Gece ekibi")).toBeChecked();
    fireEvent.change(form.getByLabelText(/^Rol/), { target: { value: SYSTEM_GROUP.id } });
    await saveForm();
    expect(api.adminSetUserGroups).toHaveBeenLastCalledWith("u-nurse", [SYSTEM_GROUP.id, WARD_GROUP.id],
      [NURSE_GROUP.id, WARD_GROUP.id].sort());
    expect(nurse().groups.map((g) => g.id).sort()).toEqual([SYSTEM_GROUP.id, WARD_GROUP.id].sort());
    // The confirmation — the first attempt's refusal is still, rightly, on its toast beside it, so
    // this is not `expectConfirmed`'s "no alert at all".
    expect(screen.getAllByText(/Ayşe Sentetik · Yadda saxlanıldı\./).length).toBeGreaterThan(0);
  });

  it("an edit that changes nothing sends nothing and claims nothing", async () => {
    const { api, reload } = await open();
    await editOf("hs\\.aygun");
    await saveForm();
    expect(api.adminUpdateUser).not.toHaveBeenCalled();
    expect(api.adminSetUserGroups).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Yadda saxlanıldı\./)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("P1: a scope read that lands after a form was opened does not replace it, and the form's refusal is read", async () => {
    let releaseScope;
    const { api } = await open({
      setup: (a) => a.userScope.mockImplementation(() => new Promise((r) => { releaseScope = r; })),
    });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Şöbələr: hs\.aygun/ })[0]); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();                    // the read is in flight, no dialog
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni istifadəçi" })); });
    let rejectCreate;
    api.adminCreateUser.mockImplementation(() => new Promise((_, rej) => { rejectCreate = rej; }));
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Yeni Sintetik" } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.yeni" } });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "gecici-1234" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "İstifadəçini yarat" })); await settle(); });
    expect(api.adminCreateUser).toHaveBeenCalledTimes(1);               // the create is in flight
    await act(async () => { releaseScope(scopeView({ grants: [] })); await settle(); });
    // The form is still the open dialog: the late read did not unmount it mid-write.
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "İstifadəçini yarat" })).toBeInTheDocument();
    await act(async () => { rejectCreate(refusal(409, "Bu kullanıcı adı veya e-posta zaten kullanılıyor")); await settle(); });
    expect(alerts()).toContain("Yeni Sintetik");
  });

  it("P1: while a scope read is out, every row's actions are busy and the tab names the account in flight; a press sends nothing", async () => {
    let releaseScope;
    const second = user("u-ad2", { username: "hs.ikinci", full_name: "İkinci Sintetik", groups: [member(NURSE_GROUP)] });
    const { api } = await open({
      users: [...USERS, second],
      setup: (a) => a.userScope.mockImplementation(() => new Promise((r) => { releaseScope = r; })),
    });
    api.adminResetMfa.mockResolvedValue({ ok: true });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Şöbələr: hs\.aygun/ })[0]); await settle(); });
    const other = screen.getAllByRole("button", { name: /2FA sıfırla: hs\.ikinci/ })[0];
    expect(other).toHaveAttribute("aria-busy", "true");
    await act(async () => { fireEvent.click(other); });
    expect(screen.queryByRole("dialog")).toBeNull();                    // a busy control opens nothing
    await waitFor(() => expect(spoken()).toContain("hs.aygun"), { timeout: 4000 });
    await act(async () => { releaseScope(scopeView({ grants: [] })); await settle(); });
    expect(api.adminResetMfa).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: /2FA sıfırla: hs\.ikinci/ })[0]).not.toHaveAttribute("aria-busy");
  });

  it("P2: the ACTIVATE confirmation says the account will be activated — not deactivated — and reads as done", async () => {
    const off = user("u-off", { username: "hs.passiv", full_name: "Passiv Sintetik", is_active: false, groups: [member(NURSE_GROUP)] });
    const { api } = await open({ users: [...USERS, off] });
    api.adminUpdateUser.mockResolvedValue(user("u-off", { is_active: true }));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Aktivləşdir: hs\.passiv/ })[0]); });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/Passiv Sintetik aktivləşdiriləcək; yenidən giriş edə biləcək\./);
    expect(dialog.textContent).not.toMatch(/passivləşdiriləcək/);
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Aktivləşdir" })); await settle(); });
    expect(api.adminUpdateUser).toHaveBeenCalledWith("u-off", { is_active: true });
    expectConfirmed(/Passiv Sintetik · Hesab aktivləşdirildi\./);
  });

  it("P3: an account holding two roles keeps both — the row lists both, the form keeps the second and says so, and a change sends both", async () => {
    const PHYS = group("physician", { name: "Hekim", permissions: ["board.view", "alerts.ack"] });
    const both = user("u-both", { username: "dr.iki", full_name: "İki Rol Sintetik", groups: [member(NURSE_GROUP), member(PHYS)] });
    const { api } = await open({ users: [both], groups: [SYSTEM_GROUP, NURSE_GROUP, PHYS, WARD_GROUP] });
    expect(within(rowOf("dr\\.iki")).getByText("Hemşire, Hekim")).toBeInTheDocument();
    api.adminSetUserGroups.mockResolvedValue(both);
    const form = await editOf("dr\\.iki");
    expect(form.getByText(/Bu hesabın birdən çox rolu var/)).toBeInTheDocument();
    expect(form.getByLabelText("Hekim")).toBeChecked();
    fireEvent.click(form.getByLabelText("Gece ekibi"));
    await saveForm();
    expect(api.adminUpdateUser).not.toHaveBeenCalled();
    const [id, sent, expected] = api.adminSetUserGroups.mock.calls[0];
    expect(id).toBe("u-both");
    expect([...sent].sort()).toEqual([NURSE_GROUP.id, PHYS.id, WARD_GROUP.id].sort());
    expect(expected).toEqual([NURSE_GROUP.id, PHYS.id].sort());
  });

  it("P5: the region that names the account during a write is inside its dialog, never in an inert subtree — for every dialog", async () => {
    // jsdom does not implement `inert`, so a region the browser would silence still "speaks" here;
    // the attribute is what says it would not. Each dialog names the account in its OWN region.
    const naming = () => screen.getAllByRole("status").filter((s) => s.textContent.includes("hs.aygun"));
    const heard = async () => {
      await waitFor(() => expect(naming().length).toBeGreaterThan(0), { timeout: 4000 });
      expect(naming().every((s) => s.closest("[inert]") === null)).toBe(true);
    };

    let release;
    const first = await open();
    first.api.adminResetMfa.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /2FA sıfırla: hs\.aygun/ })[0]); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "2FA sıfırla" })); await settle(); });
    await heard();
    await act(async () => { release({ ok: true }); await settle(); });

    cleanup();
    const second = await open();
    second.api.adminUpdateUser.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const form = await editOf("hs\\.aygun");
    fireEvent.change(form.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik-Aygün" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); await settle(); });
    await heard();
    await act(async () => { release(USERS[0]); await settle(); });

    cleanup();
    const third = await open();
    third.api.setScope.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Şöbələr: hs\.aygun/ })[0]); await settle(); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Əhatəni yadda saxla" })); await settle(); });
    await heard();
    await act(async () => { release(scopeView({ grants: [] })); await settle(); });
  });

  it("P6: while only READING a scope, the tab says it is reading that account's scope — never that something is being saved", async () => {
    let releaseScope;
    await open({ setup: (a) => a.userScope.mockImplementation(() => new Promise((r) => { releaseScope = r; })) });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Şöbələr: hs\.aygun/ })[0]); await settle(); });
    await waitFor(() => expect(spoken()).toContain("hs.aygun · əhatə oxunur…"), { timeout: 4000 });
    expect(spoken()).not.toMatch(/yadda saxlanılır/);
    await act(async () => { releaseScope(scopeView({ grants: [] })); await settle(); });
  });

  it("P8: your own account's form does not offer the active flag, says why, and a name fix sends no active state", async () => {
    const self = user("u-admin", { username: "mudur", full_name: "Müdür Sintetik", groups: [member(NURSE_GROUP)] });
    const { api } = await open({ users: [self], selfId: "u-admin" });
    api.adminUpdateUser.mockResolvedValue(self);
    const form = await editOf("mudur");
    expect(form.queryByRole("checkbox", { name: /Hesab aktivdir/ })).toBeNull();
    expect(form.getByText(/aktivliyini buradan dəyişə bilmərsiniz/)).toBeInTheDocument();
    fireEvent.change(form.getByLabelText(/Ad soyad/), { target: { value: "Müdür Sintetik-Yeni" } });
    await saveForm();
    expect(api.adminUpdateUser).toHaveBeenCalledWith("u-admin", { full_name: "Müdür Sintetik-Yeni" });
  });

  it("P9: a confirmation's own refusal takes the focus to its field, where the refusal is written", async () => {
    const { api } = await open();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Girişi aç: dr\.kamran/ })[0]); });
    fireEvent.change(screen.getByLabelText(/Səbəb/), { target: { value: "   " } });
    const unlock = screen.getByRole("button", { name: "Girişi aç" });
    unlock.focus();
    await act(async () => { fireEvent.click(unlock); await settle(); });
    expect(screen.getByLabelText(/Səbəb/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Səbəb/)).toHaveFocus();
    expect(api.adminUnlockSignIn).not.toHaveBeenCalled();

    cleanup();
    const second = await open();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Şifrəni sıfırla: hs\.aygun/ })[0]); });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "qisa" } });
    const reset = screen.getByRole("button", { name: "Şifrəni sıfırla" });
    reset.focus();
    await act(async () => { fireEvent.click(reset); await settle(); });
    expect(screen.getByLabelText(/Müvəqqəti şifrə/)).toHaveFocus();
    expect(second.api.adminResetPassword).not.toHaveBeenCalled();
  });

  it("P10: after an edit, the units cell no longer states the scope read before it", async () => {
    const { api } = await open({
      setup: (a) => a.userScope.mockResolvedValue(scopeView({ user_id: "u-nurse", unrestricted: true, reason: "unassigned" })),
    });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Şöbələr: hs\.aygun/ })[0]); await settle(); });
    fireEvent.click(screen.getByRole("button", { name: "İmtina" }));
    const row = rowOf("hs\\.aygun");
    expect(within(row).getByText("Şöbə təyin edilməyib")).toBeInTheDocument();
    api.adminSetUserGroups.mockResolvedValue(USERS[0]);
    const form = await editOf("hs\\.aygun");
    fireEvent.change(form.getByLabelText(/^Rol/), { target: { value: SYSTEM_GROUP.id } });
    await saveForm();
    expect(api.adminSetUserGroups).toHaveBeenCalledWith("u-nurse", [SYSTEM_GROUP.id], [NURSE_GROUP.id]);
    // She is the system group's now — scope reason "role" — so "no unit assigned" is no longer
    // what the server would say. The cell claims nothing until it is read again.
    expect(within(row).queryByText("Şöbə təyin edilməyib")).toBeNull();
    expect(within(row).getByText("Oxunmayıb")).toBeInTheDocument();
  });

  it("P12: a scope save with no answer is not called refused — nothing is put back, the scope is read back, and the editor says it may or may not have landed", async () => {
    const twoUnits = scopeView({ user_id: "u-nurse", grants: [{ unit_id: "REA-01" }, { unit_id: "REA-02" }] });
    const { api } = await open({ setup: (a) => a.userScope.mockResolvedValue(twoUnits) });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Şöbələr: hs\.aygun/ })[0]); await settle(); });
    api.setScope.mockRejectedValue(Object.assign(new Error("Sunucu yanıt vermedi"), { code: "REQUEST_TIMEOUT" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "REA-02" }));                 // remove REA-02
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Əhatəni yadda saxla" })); await settle(); });
    expect(alerts()).toMatch(/Ayşe Sentetik: .*yerinə yetirilmiş ola bilər/);
    expect(screen.queryByText("Mühərrik qəbul etmədi; ekrandakı əhatə geri alındı.")).toBeNull();
    expect(api.userScope).toHaveBeenCalledTimes(2);                                       // read back
    expect(screen.getByText(/Mühərrik cavab vermədi; əhatə yadda saxlanılmış da ola bilər, saxlanılmamış da\. Yenidən oxundu/))
      .toBeInTheDocument();
    // The list is what the engine holds now (here: the save never reached it), not what was sent.
    expect(screen.getByRole("checkbox", { name: "REA-02" })).toBeChecked();

    cleanup();
    // And when even the read-back fails, it says that too, and the row claims nothing.
    const second = await open({ setup: (a) => a.userScope.mockResolvedValueOnce(twoUnits) });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Şöbələr: hs\.aygun/ })[0]); await settle(); });
    second.api.setScope.mockRejectedValue(Object.assign(new Error("Sunucu yanıt vermedi"), { code: "REQUEST_TIMEOUT" }));
    second.api.userScope.mockRejectedValue(refusal(503, "upstream"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Əhatəni yadda saxla" })); await settle(); });
    expect(screen.getByText(/yenidən oxunmadı/)).toBeInTheDocument();
    expect(screen.queryByText("Mühərrik qəbul etmədi; ekrandakı əhatə geri alındı.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "İmtina" }));
    expect(within(rowOf("hs\\.aygun")).getByText("Oxunmayıb")).toBeInTheDocument();
  });

  it("P14: groups with no answer after the details landed are said as 'may not have been saved', and the list is read again", async () => {
    const { api, reload } = await open();
    api.adminUpdateUser.mockResolvedValue(USERS[0]);
    api.adminSetUserGroups.mockRejectedValue(Object.assign(new Error("timeout"), { code: "REQUEST_TIMEOUT" }));
    const form = await editOf("hs\\.aygun");
    fireEvent.change(form.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Sentetik-Aygün" } });
    fireEvent.click(form.getByLabelText("Gece ekibi"));
    await saveForm();
    expect(alerts()).toMatch(/Dəyişdirilən məlumatlar yadda saxlanıldı; qruplar saxlanılmamış ola bilər: .*yerinə yetirilmiş ola bilər/);
    expect(alerts()).not.toMatch(/qruplar saxlanılmadı/);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("note (b): while a write is out, the field Enter was pressed in keeps the focus — read-only, never disabled", async () => {
    const { api } = await open();
    let reject;
    api.adminCreateUser.mockImplementation(() => new Promise((_, rej) => { reject = rej; }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni istifadəçi" })); });
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Yeni Sintetik" } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.yeni" } });
    const pw = screen.getByLabelText(/Müvəqqəti şifrə/);
    fireEvent.change(pw, { target: { value: "gecici-1234" } });
    pw.focus();
    await act(async () => { fireEvent.submit(pw.closest("form")); await settle(); });
    expect(pw).not.toBeDisabled();
    expect(pw).toHaveAttribute("readonly");
    expect(pw).toHaveFocus();
    await act(async () => { reject(refusal(409, "Bu kullanıcı adı veya e-posta zaten kullanılıyor")); await settle(); });
  });

  it("a form's refusal that arrives after its tab was left still reaches the toast, named", async () => {
    let reject;
    const { api } = await openFrame({ tabs: { users: UsersTab, roles: () => <p>roles</p> } });
    api.adminCreateUser.mockImplementation(() => new Promise((_, rej) => { reject = rej; }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni istifadəçi" })); });
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Yeni Sintetik" } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.yeni" } });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "gecici-1234" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "İstifadəçini yarat" })); await settle(); });
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Rollar və səlahiyyətlər" })); });
    expect(screen.queryByRole("dialog")).toBeNull();                    // the tab, and its form, are gone
    await act(async () => { reject(refusal(409, "Bu kullanıcı adı veya e-posta zaten kullanılıyor")); await settle(); });
    expect(alerts()).toContain("Yeni Sintetik");
  });

  it("a scope refusal that arrives after its tab was left still reaches the toast, named", async () => {
    let reject;
    const { api } = await openFrame({ tabs: { users: UsersTab, roles: () => <p>roles</p> } });
    api.setScope.mockImplementation(() => new Promise((_, rej) => { reject = rej; }));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Şöbələr: hs\.aygun/ })[0]); await settle(); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Əhatəni yadda saxla" })); await settle(); });
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Rollar və səlahiyyətlər" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { reject(refusal(403, "kapsam atamak için kapsamı sınırsız bir yönetici olmalısınız")); await settle(); });
    expect(alerts()).toContain("Ayşe Sentetik");
  });

  // ---- the second pass (re-review of 9f49cb3, probes N1–N5) ----

  it("N1: after the details LANDED and the groups were refused, a detail changed back is still sent", async () => {
    // The form compared against the copy it opened with, which never moved: deactivate, groups
    // refused (the deactivation landed), re-activate — "nothing changed", and nothing was sent,
    // while the server held the deactivation. The details baseline moves with what landed; the
    // memberships' `held` does not (the compare-and-swap needs the list the form read).
    const { api, server } = await openFrame();
    api.adminSetUserGroups.mockRejectedValueOnce(refusal(403, "Kendi yetkilerinizi aşan bir işlem yapılamaz: audit.view"));
    const form = await editOf("hs\\.aygun");
    fireEvent.click(form.getByRole("checkbox", { name: /Hesab aktivdir/ }));          // deactivate…
    fireEvent.click(form.getByLabelText("Gece ekibi"));                                 // …and add a group
    await saveForm();
    expect(server.users.find((u) => u.id === "u-nurse").is_active).toBe(false);         // the PATCH landed
    expect(alerts()).toMatch(/qruplar saxlanılmadı/);
    // She changes her mind about the deactivation, and saves again from the same form.
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("checkbox", { name: /Hesab aktivdir/ }));
    await saveForm();
    expect(api.adminUpdateUser.mock.calls.map((c) => c[1])).toEqual([{ is_active: false }, { is_active: true }]);
    expect(server.users.find((u) => u.id === "u-nurse").is_active).toBe(true);
    // And the groups were sent again WITH the list the form read — the server's set had not moved.
    expect(api.adminSetUserGroups).toHaveBeenLastCalledWith("u-nurse", [NURSE_GROUP.id, WARD_GROUP.id], [NURSE_GROUP.id]);
  });

  it("N3a: nothing more is SENT for a session that ended mid-edit — not the groups after the details", async () => {
    const { api, store } = await openGated();
    let releasePatch;
    api.adminUpdateUser.mockImplementation(() => new Promise((resolve) => { releasePatch = resolve; }));
    api.adminSetUserGroups.mockResolvedValue(USERS[0]);
    const form = await editOf("hs\\.aygun");
    fireEvent.change(form.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Yeni" } });
    fireEvent.click(form.getByLabelText("Gece ekibi"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); await settle(); });
    await act(async () => { store.signOut(); await settle(); });
    await act(async () => { releasePatch(USERS[0]); await settle(); });
    expect(api.adminSetUserGroups).not.toHaveBeenCalled();
    expect(api.adminUsers).not.toHaveBeenCalled();                                     // nor a reload
  });

  it("N3b: a confirmed write that lands after its session ended says nothing into the screen that followed", async () => {
    const { api, admin, store } = await openGated();
    let release;
    api.adminResetMfa.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /2FA sıfırla: hs\.aygun/ })[0]); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "2FA sıfırla" })); await settle(); });
    await act(async () => { store.signOut(); await settle(); });
    await act(async () => { release({ ok: true }); await settle(); });
    await new Promise((resolve) => { setTimeout(resolve, 250); });                       // past ANNOUNCE_DELAY_MS
    expect(document.body.textContent).not.toMatch(/İki addımlı doğrulama sıfırlandı/);
    expect(admin.reload).not.toHaveBeenCalled();
  });

  it("N3c: a form's refusal that arrives after sign-out is not toasted onto the signed-out screen", async () => {
    const { api, store } = await openGated();
    let rejectCreate;
    api.adminCreateUser.mockImplementation(() => new Promise((_, rej) => { rejectCreate = rej; }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni istifadəçi" })); });
    fireEvent.change(screen.getByLabelText(/Ad soyad/), { target: { value: "Yeni Sintetik" } });
    fireEvent.change(screen.getByLabelText(/İstifadəçi adı/), { target: { value: "hs.yeni" } });
    fireEvent.change(screen.getByLabelText(/Müvəqqəti şifrə/), { target: { value: "gecici-1234" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "İstifadəçini yarat" })); await settle(); });
    await act(async () => { store.signOut(); await settle(); });
    expect(screen.getByText("signed-out screen")).toBeInTheDocument();
    await act(async () => { rejectCreate(refusal(409, "Bu kullanıcı adı veya e-posta zaten kullanılıyor")); await settle(); });
    expect(alerts()).not.toContain("Yeni Sintetik");
  });

  it("N4: a scope save whose connection dropped (no answer at all) is not called refused — read back, and said so", async () => {
    const twoUnits = scopeView({ user_id: "u-nurse", grants: [{ unit_id: "REA-01" }, { unit_id: "REA-02" }] });
    const { api } = await open({ setup: (a) => a.userScope.mockResolvedValue(twoUnits) });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Şöbələr: hs\.aygun/ })[0]); await settle(); });
    api.setScope.mockRejectedValue(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByRole("checkbox", { name: "REA-02" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Əhatəni yadda saxla" })); await settle(); });
    expect(screen.queryByText("Mühərrik qəbul etmədi; ekrandakı əhatə geri alındı.")).toBeNull();
    expect(api.userScope).toHaveBeenCalledTimes(2);                                       // read back
    expect(screen.getByText(/saxlanılmış da ola bilər, saxlanılmamış da\. Yenidən oxundu/)).toBeInTheDocument();
  });

  it("N4: groups whose connection dropped after the details landed 'may not have been saved'", async () => {
    const { api, reload } = await open();
    api.adminUpdateUser.mockResolvedValue(USERS[0]);
    api.adminSetUserGroups.mockRejectedValue(new TypeError("Failed to fetch"));
    const form = await editOf("hs\\.aygun");
    fireEvent.change(form.getByLabelText(/Ad soyad/), { target: { value: "Ayşe Yeni" } });
    fireEvent.click(form.getByLabelText("Gece ekibi"));
    await saveForm();
    expect(alerts()).toMatch(/qruplar saxlanılmamış ola bilər: Serverə qoşulmaq mümkün olmadı/);
    expect(alerts()).not.toMatch(/qruplar saxlanılmadı/);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("N5: an AD-held membership as the SERVER spells it (source \"ldap\") is named read-only in the form", async () => {
    const ad = user("u-ad", {
      username: "dr.kamran", full_name: "Kamran Sintetik", email: null, auth_source: "ldap",
      groups: [member(NURSE_GROUP, "ldap")],
    });
    await open({ users: [ad] });
    await editOf("dr\\.kamran");
    expect(screen.getByText(/AD-dən gələn qruplar burada dəyişdirilə bilməz: Hemşire/)).toBeInTheDocument();
  });

  it("a count is never set against a word that must agree with it: in ru and en the label comes first, then the number", () => {
    // "Показать ещё 1 строк", "Show 1 more rows": the number decides the noun's form in Russian and
    // English. Azerbaijani and Turkish keep a singular noun after any numeral, so theirs stand.
    for (const lang of ["ru", "en"]) {
      const s = ADMIN_STRINGS[lang];
      expect(s.showMore, `${lang}.showMore`).toMatch(/: \{count\}$/);
      expect(s.filtered, `${lang}.filtered`).toMatch(/: \{shown\} /);
      expect(s.wholeList, `${lang}.wholeList`).toMatch(/: \{count\}\)/);
      expect(s.unitCount, `${lang}.unitCount`).toMatch(/^[^{]+: \{count\}$/);
      expect(s.bedCount, `${lang}.bedCount`).toMatch(/^[^{]+: \{count\}$/);
    }
  });
});

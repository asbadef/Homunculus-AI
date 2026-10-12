// The login-source tab (G1-14). Synthetic directory objects only (admin.testutil.js): accounts
// under DC=sentetik,DC=local, never a real directory, a real export or a support capture.
//
// Every write that SUCCEEDS asserts the confirmation the administrator reads AND that no alert
// region carries anything. The toast's error region is mounted before the first toast
// (ui/Toast.jsx), so "no alert" is "every alert region is empty", never "no alert element".
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { LDAP_IMPORT_CHUNK, LDAP_QUERY_MAX, LDAP_SEARCH_CAP } from "../../../backendApi.js";
import { PERMISSION_KEYS } from "./catalogue.js";
import {
  ADMIN_READS, CATALOGUE, GROUPS, NURSE_GROUP, adminProp, guid, ldapGroup, ldapStatus, ldapUser, mapping,
} from "./admin.testutil.js";
import { FIELD_MAX } from "./limits.js";
import { SourceTab, chunksOf, markImported, skipReasonKey, testReasonKey } from "./SourceTab.jsx";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** `LdapTestOut` and `LdapImportOut` (admin/schemas.py), built HERE and not in admin.testutil.js:
 *  only this tab reads them, and the shared file belongs to no arm — an arm that adds to it meets
 *  the other two arms, and Task 14, in a file none of them owns. The shapes are the API's. */
const tested = (over = {}) => ({ ok: true, reason: null, checked_at: "2026-10-11T09:00:00Z", ...over });
const importedRow = (n) => ({ external_id: guid(n), id: guid(1000 + n), username: `hs.sintetik${n}`, groups: [] });
const skippedRow = (n, reason) => ({ external_id: guid(n), reason });
const answer = (imported = [], skipped = []) => ({ imported, skipped });
/** A full administrator: writing the AD group mapping needs EVERY permission key (the server's own
 *  rule, 403 `mappingAdminOnly`), so a narrower desk is the read-only case and is passed by name. */
const DESK = [...PERMISSION_KEYS];
/** The host, and only the host (`LdapStatusOut.url_host`: no scheme, no port, no DN). */
const HOST = "dc01.sentetik.local";
const MAPPED_DN = "CN=YB-Hemsire,OU=Gruplar,DC=sentetik,DC=local";

/** The tab on its own. `admin` comes from `adminProp` — the one builder of what the frame hands a
 *  tab, in the shapes and the read states `useAdminData` produces (`groups: null` is a read that
 *  failed; `reads: { catalogue: "unasked" }` one a `users.manage` desk is never asked for). */
async function open({ perms = DESK, groups = GROUPS, catalogue = CATALOGUE, reads, strict = false, setup } = {}) {
  const admin = adminProp({ users: [], groups, catalogue, unassigned: 0, reads });
  const { reload } = admin;
  const tab = <SourceTab admin={admin} />;
  const mounted = await mount(strict ? <React.StrictMode>{tab}</React.StrictMode> : tab, {
    access: token({ sub: "u-admin", perms }),
    me: profile({ id: "u-admin", perms }),
    setup: (api) => { ADMIN_READS(api); setup?.(api); },
  });
  await act(async () => { await settle(); });
  return { ...mounted, admin, reload };
}

const searchFor = async (text = "sintetik") => {
  fireEvent.change(screen.getByLabelText(/Ad və ya istifadəçi adı/), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Axtar" })); await settle(); });
};
const runTest = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Qoşulmanı yoxla" })); await settle(); });
};
/** Pick the one AD group the picker offers and the group it grants, and add the mapping. */
const addMapping = async () => {
  fireEvent.change(screen.getByLabelText(/AD qrupunu axtar/), { target: { value: "YB" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Qrupu axtar" })); await settle(); });
  fireEvent.change(screen.getByLabelText("AD qrupu"), { target: { value: ldapGroup().dn } });
  fireEvent.change(screen.getByLabelText(/Hansı qrup verilsin/), { target: { value: NURSE_GROUP.id } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Uyğunlaşdırmanı əlavə et" })); await settle(); });
};
const alerts = () => screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
const notes = () => screen.queryAllByRole("note").map((n) => n.textContent).join(" ");
const statuses = () => screen.getAllByRole("status").map((s) => s.textContent).join(" ");

/** What a write that LANDED must look like to the administrator: the confirmation, and no alert. */
function expectConfirmed(text) {
  expect(screen.getAllByText(text).length, `confirmation ${text}`).toBeGreaterThan(0);
  expect(alerts().trim()).toBe("");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the pure parts", () => {
  it("names a sentence for each of the test's five reasons, and for one it has never seen", () => {
    expect(["unreachable", "timeout", "tls", "service_bind_rejected", "protocol"].map(testReasonKey)).toEqual([
      "source.reasonUnreachable", "source.reasonTimeout", "source.reasonTls",
      "source.reasonServiceBindRejected", "source.reasonProtocol",
    ]);
    expect(testReasonKey("something_new")).toBe("source.reasonUnknown");
    expect(testReasonKey(null)).toBe("source.reasonUnknown");
  });

  it("names a sentence for each of the import's seven skip reasons", () => {
    expect(["exists", "not_found", "disabled", "expired", "login_taken", "no_username", "invalid_login"]
      .map(skipReasonKey)).toEqual([
      "source.skipExists", "source.skipNotFound", "source.skipDisabled", "source.skipExpired",
      "source.skipLoginTaken", "source.skipNoUsername", "source.skipInvalidLogin",
    ]);
    expect(skipReasonKey("whatever")).toBe("source.skipUnknown");
  });

  it("cuts an import into chunks of LDAP_IMPORT_CHUNK, never larger than the API's cap", () => {
    expect(LDAP_IMPORT_CHUNK).toBe(2);
    expect(chunksOf(["a", "b", "c", "d", "e"])).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(chunksOf([])).toEqual([]);
    expect(chunksOf(["a"], 0)).toEqual([["a"]]);          // never an endless loop
    expect(chunksOf(Array.from({ length: 60 }, (_, i) => i), 100)).toHaveLength(2);  // capped at 50
  });

  it("marks as imported what the server imported — and what it skipped because it was already here", () => {
    const found = [ldapUser(1), ldapUser(2), ldapUser(3)];
    const after = markImported(found, answer([importedRow(1)], [skippedRow(2, "exists"), skippedRow(3, "login_taken")]));
    expect(after.map((row) => row.already_imported)).toEqual([true, true, false]);
    expect(found.map((row) => row.already_imported)).toEqual([false, false, false]);   // not in place
    expect(markImported(null, answer())).toEqual([]);
    expect(markImported(found, null).map((row) => row.already_imported)).toEqual([false, false, false]);
  });
});

describe("an unconfigured directory", () => {
  it("says so, and the search, the import and the mapping are not drawn", async () => {
    const { api } = await open({ setup: (a) => a.ldapStatus.mockResolvedValue({ configured: false }) });
    expect(screen.getByText(/Kataloq konfiqurasiya olunmayıb/)).toBeInTheDocument();
    expect(screen.queryByText("Hesab axtar və idxal et")).toBeNull();
    expect(screen.queryByText("AD qrup uyğunlaşdırması")).toBeNull();
    // Every other route answers 409 when the directory is off, so none of them is asked.
    expect(api.ldapMappings).not.toHaveBeenCalled();
    expect(api.ldapSearch).not.toHaveBeenCalled();
  });

  it("says the configuration is the server's and cannot be changed here", async () => {
    await open({ setup: (a) => a.ldapStatus.mockResolvedValue({ configured: false }) });
    expect(screen.getByText(/LDAP_URL/)).toBeInTheDocument();
  });
});

describe("the status", () => {
  it("says the directory is configured and shows the host only — never the bind account or its password", async () => {
    await open();
    expect(screen.getByText("Kataloq konfiqurasiya olunub")).toBeInTheDocument();
    const panel = screen.getByText(HOST).closest("div.rounded-box");
    // `LdapStatusOut` carries configured / url_host / last_test_at / last_test_ok and nothing
    // else, by design on the server. The status panel must not acquire any of the rest either —
    // and a DN in this panel could only be the SERVICE account's.
    expect(panel.innerHTML).not.toMatch(/CN=|DC=|ou=/i);
    expect(panel.textContent).not.toMatch(/:636|ldaps?:\/\//);                   // the host, not a URL
    // The panel DOES contain the word "şifrə" — in its own sentence saying the bind account and
    // its password are in no response. That sentence is the claim; what must not be there is a
    // VALUE, and `LdapStatusOut` carries none.
    expect(screen.getByText(/qoşulma hesabı və şifrəsi heç bir cavabda yer almır/)).toBeInTheDocument();
    // Nothing anywhere on the tab puts a secret or the host in a title, including the mapping rows
    // — whose DNs are the AD GROUPS', which the table shows in the open and which identify the row.
    for (const el of document.querySelectorAll("[title]")) {
      expect(el.getAttribute("title").toLowerCase()).not.toMatch(/parol|şifr|password|sentetik\.local/);
    }
  });

  it("says when the directory was last tested, and says \"not since the server last started\" when it was not", async () => {
    // The last test lives in the server's process memory: "never" would be a claim it cannot make.
    await open();
    expect(screen.getByText(/11\.10\.2026 .* · Uğurlu/)).toBeInTheDocument();
    cleanup();
    await open({ setup: (a) => a.ldapStatus.mockResolvedValue(ldapStatus({ last_test_at: null, last_test_ok: null })) });
    expect(screen.getByText("Server son dəfə başladılandan bəri yoxlanmayıb")).toBeInTheDocument();
    expect(screen.queryByText(/Hələ yoxlanmayıb/)).toBeNull();
  });

  it("a test that succeeds says the service account was accepted, with no alert, and the result is announced", async () => {
    const { api } = await open();
    api.ldapTest.mockResolvedValue(tested());
    await runTest();
    expect(notes()).toMatch(/xidmət hesabı doğrulandı/);
    expect(alerts().trim()).toBe("");
    // The visible result is a Note, which is not live; the one live region says it too.
    await waitFor(() => expect(statuses()).toContain("xidmət hesabı doğrulandı"), { timeout: 4000 });
    // And the status line now carries the new test's time.
    expect(screen.getByText(/11\.10\.2026 .* · Uğurlu/)).toBeInTheDocument();
  });

  it("each of the test's five refusals gets its own sentence, saying what to check", async () => {
    const CASES = [
      ["unreachable", /firewall, 636\/TCP/],
      ["timeout", /Domen kontrolleri yavaş/],
      ["tls", /yalnız LDAPS istifadə olunur/],
      ["service_bind_rejected", /Xidmət hesabı qəbul edilmədi/],
      ["protocol", /bir LDAP serverinə aid olduğunu doğrulayın/],
    ];
    for (const [reason, shown] of CASES) {
      // eslint-disable-next-line no-await-in-loop
      const { api } = await open();
      api.ldapTest.mockResolvedValue(tested({ ok: false, reason }));
      // eslint-disable-next-line no-await-in-loop
      await runTest();
      expect(notes(), reason).toMatch(shown);
      cleanup();
    }
  });

  it("a test the server refuses clears the previous result: no stale green beside a fresh refusal", async () => {
    const { api } = await open();
    api.ldapTest
      .mockResolvedValueOnce(tested())
      .mockRejectedValueOnce(refusal(503, "Dizin sunucusuna ulaşılamıyor"));
    await runTest();
    expect(notes()).toMatch(/xidmət hesabı doğrulandı/);
    await runTest();
    expect(notes()).not.toMatch(/xidmət hesabı doğrulandı/);
    expect(alerts()).toContain(HOST);                              // the refusal names the host
    expect(alerts()).toMatch(/kataloq serverinə/);
  });

  it("says directory operations can take up to thirty seconds", async () => {
    await open();
    expect(screen.getByText(/30 saniyəyə qədər/)).toBeInTheDocument();
  });

  it("lands its reads under StrictMode, whose rehearsal unmounts and remounts every effect", async () => {
    // A `mounted` ref set true only at creation is set false by the rehearsal's cleanup and never
    // back: the status read's answer was dropped as "unmounted" and the tab said "loading" for ever
    // — the defect `useAdminData` had (`b976c6c`), in the one tab that reads on mount.
    await open({ strict: true });
    expect(screen.getByText("Kataloq konfiqurasiya olunub")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "AD qrupu və qarşılığı" })).toBeInTheDocument();
  });
});

describe("the search", () => {
  it("says which results are already imported and which accounts are disabled", async () => {
    await open();
    await searchFor();
    const table = screen.getByRole("table", { name: "Kataloq axtarışının nəticələri" });
    const first = within(table).getByRole("rowheader", { name: "hs.sintetik1" }).closest("tr");
    expect(within(first).getByText("İdxal edilə bilər")).toBeInTheDocument();
    const second = within(table).getByRole("rowheader", { name: "hs.sintetik2" }).closest("tr");
    expect(within(second).getByText("Kataloqda bağlıdır")).toBeInTheDocument();
    expect(within(second).getByRole("checkbox", { name: "hs.sintetik2" })).toBeDisabled();
  });

  it("an already-imported account is named as such and cannot be chosen again", async () => {
    await open({ setup: (a) => a.ldapSearch.mockResolvedValue([ldapUser(3, { already_imported: true })]) });
    await searchFor();
    expect(screen.getByText("Artıq idxal olunub")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "hs.sintetik3" })).toBeDisabled();
  });

  it("sends the query with no limit of its own, says what the server's cap is, and holds the field to the server's length", async () => {
    const { api } = await open();
    await searchFor("sintetik");
    expect(api.ldapSearch).toHaveBeenCalledWith("sintetik");
    expect(screen.getByText(new RegExp(`ən çox ${LDAP_SEARCH_CAP} sətirdir`))).toBeInTheDocument();
    expect(screen.getByLabelText(/Ad və ya istifadəçi adı/)).toHaveAttribute("maxlength", String(LDAP_QUERY_MAX));
    // From limits.js, where every administration field's limit lives; its test holds it to
    // ldap_router.SearchQuery and to backendApi's copy.
    expect(FIELD_MAX.ldap_query).toBe(LDAP_QUERY_MAX);
  });

  it("holds the search until the query is long enough to be accepted", async () => {
    const { api } = await open();
    fireEvent.change(screen.getByLabelText(/Ad və ya istifadəçi adı/), { target: { value: "a" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Axtar" })); await settle(); });
    expect(api.ldapSearch).not.toHaveBeenCalled();
  });

  it("says no account matched rather than showing an empty table", async () => {
    await open({ setup: (a) => a.ldapSearch.mockResolvedValue([]) });
    await searchFor();
    expect(screen.getByText("Uyğun gələn kataloq hesabı yoxdur.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Kataloq axtarışının nəticələri" })).toBeNull();
  });

  it("says when the answer is at the server's cap, so a narrower query is the next step", async () => {
    const many = Array.from({ length: LDAP_SEARCH_CAP }, (_, i) => ldapUser(i + 10));
    await open({ setup: (a) => a.ldapSearch.mockResolvedValue(many) });
    await searchFor();
    expect(screen.getByText(new RegExp(`Ən çox ${LDAP_SEARCH_CAP} nəticə`))).toBeInTheDocument();
  });

  it("a refused search names the query on the toast and takes the old query's rows away", async () => {
    const { api } = await open();
    await searchFor("sintetik");
    expect(screen.getByRole("table", { name: "Kataloq axtarışının nəticələri" })).toBeInTheDocument();
    api.ldapSearch.mockRejectedValue(refusal(503, "Dizin sunucusuna ulaşılamıyor"));
    await searchFor("sintetik2");
    expect(alerts()).toContain("sintetik2");
    expect(alerts()).toMatch(/kataloq serverinə/);
    // The old query's rows do not stay under the new query's text.
    expect(screen.queryByRole("table", { name: "Kataloq axtarışının nəticələri" })).toBeNull();
  });
});

describe("the import", () => {
  const chooseAndImport = async (api, count = 3, between) => {
    const rows = Array.from({ length: count }, (_, i) => ldapUser(i + 1));
    api.ldapSearch.mockResolvedValue(rows);
    await searchFor();
    for (const row of rows) fireEvent.click(screen.getByRole("checkbox", { name: row.username }));
    between?.(count);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `Seçilənləri idxal et (${count})` }));
      await settle();
    });
    return rows;
  };

  it("is sent in chunks of two, strictly sequentially, with the extra group on every call — and reads as done", async () => {
    const { api, reload } = await open();
    api.ldapImport.mockResolvedValue(answer());
    // The extra-group choice only exists once there are results to import, so it is set inside
    // the helper's flow rather than before the search.
    await chooseAndImport(api, 3, (count) => {
      fireEvent.change(screen.getByLabelText(/Əlavə qrup/), { target: { value: NURSE_GROUP.id } });
      return count;
    });
    expect(api.ldapImport).toHaveBeenCalledTimes(2);                 // 3 accounts, chunks of 2
    expect(api.ldapImport.mock.calls[0]).toEqual([[guid(1), guid(2)], [NURSE_GROUP.id]]);
    expect(api.ldapImport.mock.calls[1]).toEqual([[guid(3)], [NURSE_GROUP.id]]);
    expectConfirmed(new RegExp(`${HOST} · 0 hesab idxal olundu, 0 hesab buraxıldı\\.`));
    expect(reload).toHaveBeenCalled();
  });

  it("offers as the extra group only one this desk may grant — a group beyond its rights would 403 the whole import", async () => {
    await open({ perms: ["users.manage", "board.view", "alerts.ack"] });
    await searchFor();
    const options = [...screen.getByLabelText(/Əlavə qrup/).querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Əlavə qrup verilməsin", "Hemşire", "Gece ekibi"]);
    expect(options).not.toContain("Sistem yöneticisi");
  });

  it("shows how many accounts it has sent while it is sending them, and holds the search meanwhile", async () => {
    let release;
    const { api } = await open();
    api.ldapImport.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const rows = [ldapUser(1), ldapUser(2), ldapUser(3)];
    api.ldapSearch.mockResolvedValue(rows);
    await searchFor();
    for (const row of rows) fireEvent.click(screen.getByRole("checkbox", { name: row.username }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Seçilənləri idxal et (3)" })); });
    expect(screen.getByText("0 / 3 hesab göndərildi…")).toBeInTheDocument();
    // A new search would drop the chosen rows out from under the import: its button says busy
    // (never disabled) and a press sends nothing.
    const search = screen.getByRole("button", { name: "Axtar" });
    expect(search).toHaveAttribute("aria-busy", "true");
    expect(search).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Ad və ya istifadəçi adı/), { target: { value: "başqa biri" } });
    await act(async () => { fireEvent.click(search); await settle(); });
    expect(api.ldapSearch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox", { name: "hs.sintetik3" })).toBeChecked();
    // The other operations are NOT held: one busy slot for four operations is what made them
    // look live while silently doing nothing.
    expect(screen.getByRole("button", { name: /Uyğunlaşdırmanı sil/ })).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("button", { name: "Qoşulmanı yoxla" })).not.toHaveAttribute("aria-busy");
    await act(async () => { release(answer()); await settle(); });
  });

  it("reports both halves of the answer, translates every skip reason, and marks the imported rows in the results", async () => {
    const { api } = await open();
    // One answer per chunk: `mockResolvedValue` would answer every chunk with the same body, and
    // the screen would correctly add two identical answers together.
    api.ldapImport
      .mockResolvedValueOnce(answer([importedRow(1)], [skippedRow(2, "login_taken")]))
      .mockResolvedValueOnce(answer([], [skippedRow(3, "invalid_login")]));
    await chooseAndImport(api, 3);
    expectConfirmed(new RegExp(`${HOST} · 1 hesab idxal olundu, 2 hesab buraxıldı\\.`));
    expect(screen.getByText("İdxal olunanlar")).toBeInTheDocument();
    expect(screen.getByText("Buraxılanlar")).toBeInTheDocument();
    // Each skip reason reads under the account it belongs to, and the two an administrator can
    // act on say what to do about them.
    const skipped = screen.getByText("Buraxılanlar").closest("div");
    expect(within(skipped).getByText("hs.sintetik2")).toBeInTheDocument();
    expect(within(skipped).getByText(/AD-də adı dəyişin və ya buradaki hesabı passivləşdirin/)).toBeInTheDocument();
    expect(within(skipped).getByText(/sAMAccountName-i Latın qarşılığı ilə yazın/)).toBeInTheDocument();
    // The imported account's row now says so and cannot be chosen again; the skipped ones can.
    const table = screen.getByRole("table", { name: "Kataloq axtarışının nəticələri" });
    const first = within(table).getByRole("rowheader", { name: "hs.sintetik1" }).closest("tr");
    expect(within(first).getByText("Artıq idxal olunub")).toBeInTheDocument();
    expect(within(first).getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "hs.sintetik2" })).not.toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "hs.sintetik2" })).not.toBeChecked();
  });

  it("a failed chunk is named by its accounts, the rest stay chosen, and the accounts already sent keep their answer", async () => {
    const { api } = await open();
    api.ldapImport
      .mockResolvedValueOnce(answer([importedRow(1)]))
      .mockRejectedValueOnce(refusal(503, "Dizin sunucusuna ulaşılamıyor"));
    await chooseAndImport(api, 4);
    expect(api.ldapImport).toHaveBeenCalledTimes(2);                 // it stopped, it did not carry on
    // Named by the accounts, which is what the administrator sees in the table — not by an index
    // range into a column the table does not show.
    expect(alerts()).toMatch(/hs\.sintetik3, hs\.sintetik4: /);
    expect(alerts()).toMatch(/kataloq serverinə/);
    expect(notes()).toMatch(/hs\.sintetik3, hs\.sintetik4: göndərilə bilmədi; bu hesablar hələ seçilidir/);
    // The first chunk's accounts are imported now, no longer chosen; the failed chunk's still are.
    expect(screen.getByRole("checkbox", { name: "hs.sintetik1" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "hs.sintetik1" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "hs.sintetik3" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "hs.sintetik4" })).toBeChecked();
    // The first chunk's answer stands: its account is in the "imported" list as well as in the
    // search results it came from.
    const imported = screen.getByText("İdxal olunanlar").closest("div");
    expect(within(imported).getByText("hs.sintetik1")).toBeInTheDocument();
  });

  it("a timeout says the operation may have happened", async () => {
    const { api } = await open();
    api.ldapImport.mockRejectedValue(Object.assign(new Error("…"), { code: "REQUEST_TIMEOUT" }));
    await chooseAndImport(api, 2);
    expect(alerts()).toMatch(/Server cavab vermədi\. Əməliyyat yerinə yetirilmiş ola bilər/);
  });

  it("a group list that could not be read leaves the tab standing, with no extra group offered", async () => {
    // A failed read is null, never `[]` (`useAdminData`), and the frame's Alert names it. The
    // directory is still tested, searched and imported from; there is only no group to offer beside
    // an import — and none is invented.
    await open({ groups: null });
    expect(screen.getByText("Kataloq konfiqurasiya olunub")).toBeInTheDocument();
    await searchFor();
    const options = [...screen.getByLabelText(/Əlavə qrup/).querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Əlavə qrup verilməsin"]);
  });
});

describe("the group mapping", () => {
  it("lists the rows with the AD group and the group it grants", async () => {
    await open();
    const table = screen.getByRole("table", { name: "AD qrupu və qarşılığı" });
    expect(within(table).getByRole("rowheader", { name: /CN=YB-Hemsire/ })).toBeInTheDocument();
    expect(within(table).getByText("Hemşire")).toBeInTheDocument();
  });

  it("says of every row that its DN spelling may be out of date, and offers to re-create it", async () => {
    await open();
    expect(screen.getByText(/uyğunlaşmırsa silib siyahıdan yenidən seçin/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Uyğunlaşdırmanı sil: CN=YB-Hemsire/ })).toBeInTheDocument();
  });

  it("a table that could not be read says so, with the server's reason and a retry — never \"loading\" forever", async () => {
    const { api } = await open({ setup: (a) => a.ldapMappings.mockRejectedValueOnce(refusal(503, "Dizin sunucusuna ulaşılamıyor")) });
    expect(notes()).toMatch(/Uyğunlaşdırma cədvəli oxunmadı: .*kataloq serverinə/);
    expect(screen.queryByRole("table", { name: "AD qrupu və qarşılığı" })).toBeNull();
    expect(alerts().trim()).toBe("");                              // a read, not a refused write
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenidən oxu" })); await settle(); });
    expect(api.ldapMappings).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("table", { name: "AD qrupu və qarşılığı" })).toBeInTheDocument();
    expect(notes()).not.toMatch(/Uyğunlaşdırma cədvəli oxunmadı/);
  });

  it("is read-only without every permission, with the server's own reason", async () => {
    // As the frame really hands it to a users.manage desk: the catalogue is never asked for.
    await open({ perms: ["users.manage", "board.view"], catalogue: null, reads: { catalogue: "unasked" } });
    expect(screen.getByText(/AD qrup uyğunlaşdırmasını yalnız bütün səlahiyyətlərə sahib/)).toBeInTheDocument();
    expect(screen.getByText("Uyğunlaşdırma cədvəli yalnız oxunur.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Uyğunlaşdırmanı sil/ })).toBeNull();
    expect(screen.queryByLabelText(/AD qrupunu axtar/)).toBeNull();
  });

  it("a DN comes from the picker, the panel says why a typed one may not match, and the add reads as done", async () => {
    const { api } = await open();
    api.ldapCreateMapping.mockResolvedValue(mapping({ id: "m-2" }));
    expect(screen.getByText(/əl ilə yazılan DN-in Türk\/Azərbaycan hərfləri/)).toBeInTheDocument();
    expect(screen.getByLabelText(/AD qrupunu axtar/)).toHaveAttribute("maxlength", String(FIELD_MAX.ldap_query));
    await addMapping();
    expect(api.ldapGroups).toHaveBeenCalledWith("YB");
    // The DN is a <select> option, never an <input> the DN can be typed into.
    expect(screen.getByLabelText("AD qrupu").tagName).toBe("SELECT");
    expect(api.ldapCreateMapping).toHaveBeenCalledWith(ldapGroup().dn, NURSE_GROUP.id);
    expectConfirmed(/YB-Hemsire · Uyğunlaşdırma əlavə edildi\./);
    expect(api.ldapMappings).toHaveBeenCalledTimes(2);                 // read back, not assumed
  });

  it("a mapping that LANDED is never reported refused: a failed re-read is the table's own failure, with a retry", async () => {
    const { api } = await open({ setup: (a) => {
      a.ldapCreateMapping.mockResolvedValue(mapping({ id: "m-2" }));
      // The read on mount answers; the re-read after the write does not.
      a.ldapMappings.mockResolvedValueOnce([mapping()]).mockRejectedValueOnce(refusal(503, "Dizin sunucusuna ulaşılamıyor"));
    } });
    await addMapping();
    expect(api.ldapCreateMapping).toHaveBeenCalledTimes(1);
    expectConfirmed(/YB-Hemsire · Uyğunlaşdırma əlavə edildi\./);   // the write's own truth, and no alert
    expect(notes()).toMatch(/Uyğunlaşdırma cədvəli oxunmadı: .*kataloq serverinə/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenidən oxu" })); await settle(); });
    expect(screen.getByRole("table", { name: "AD qrupu və qarşılığı" })).toBeInTheDocument();
  });

  it("a refused mapping names the AD group on the toast", async () => {
    const { api } = await open();
    api.ldapCreateMapping.mockRejectedValue(refusal(409, "Bu AD grubu bu gruba zaten eşlenmiş"));
    await addMapping();
    expect(alerts()).toContain("YB-Hemsire");
    expect(alerts()).toMatch(/Bu AD qrupu bu qrupa artıq uyğunlaşdırılıb/);
  });

  it("deleting a mapping says the memberships it gave are removed with it, reads as done, and re-reads the list", async () => {
    const { api } = await open();
    api.ldapDeleteMapping.mockResolvedValue(null);
    expect(screen.getByText(/üzvlüklər də götürülür/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Uyğunlaşdırmanı sil: CN=YB-Hemsire/ }));
      await settle();
    });
    expect(api.ldapDeleteMapping).toHaveBeenCalledWith("m-1");
    expectConfirmed(new RegExp(`${MAPPED_DN} · Uyğunlaşdırma silindi\\.`));
    expect(api.ldapMappings).toHaveBeenCalledTimes(2);                 // read back, not assumed
  });
});

describe("accessibility", () => {
  it("the search results and the mapping are tables with captions and row headers", async () => {
    await open();
    await searchFor();
    for (const name of ["Kataloq axtarışının nəticələri", "AD qrupu və qarşılığı"]) {
      const table = screen.getByRole("table", { name });
      expect(table.querySelector("caption")).toHaveTextContent(name);
      for (const header of within(table).getAllByRole("columnheader")) expect(header.getAttribute("scope")).toBe("col");
      for (const header of within(table).getAllByRole("rowheader")) expect(header.getAttribute("scope")).toBe("row");
    }
  });

  it("every control is busy rather than natively disabled, except a row that cannot be chosen", async () => {
    await open();
    for (const control of screen.getAllByRole("button")) {
      expect(control.hasAttribute("disabled"), control.getAttribute("aria-label") || control.textContent).toBe(false);
    }
  });

  it("says what is in flight, once, while the directory is being tested — and names the row while a mapping is being deleted", async () => {
    let release;
    const { api } = await open();
    api.ldapTest.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Qoşulmanı yoxla" })); });
    await waitFor(() => expect(statuses()).toContain("Yoxlanılır…"), { timeout: 4000 });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await act(async () => { release(tested()); await settle(); });

    let releaseDelete;
    api.ldapDeleteMapping.mockImplementation(() => new Promise((resolve) => { releaseDelete = resolve; }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Uyğunlaşdırmanı sil: CN=YB-Hemsire/ })); });
    await waitFor(() => expect(statuses()).toContain(`${MAPPED_DN} · yadda saxlanılır…`), { timeout: 4000 });
    await act(async () => { releaseDelete(null); await settle(); });
  });

  it("has no h1 of its own: the screen's heading is the frame's", async () => {
    await open();
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 2, name: "Giriş mənbəyi" })).toBeInTheDocument();
  });
});

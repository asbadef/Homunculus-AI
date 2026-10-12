// src/live/screens/admin/SourceTab.jsx — the directory (G1-14): its status, a connection test, a
// search-and-import, and the AD group mapping.
//
// FOUR SECTIONS, AND THE FIRST ONE DECIDES WHETHER THE OTHER THREE EXIST. `GET /admin/ldap/status`
// is the only route that answers when the directory is off; every other one answers 409
// `Dizin yapılandırılmamış` (`ldap_router.configured_ldap`). A screen that drew a search box on an
// unconfigured deployment would be offering a 409, so when `configured` is false the other three
// sections are not drawn and one sentence says what that means and where it is configured.
//
// THE STATUS SHOWS THE HOST ONLY. `LdapStatusOut` carries `configured`, `url_host`, `last_test_at`
// and `last_test_ok` and nothing else: no bind DN, no password, by design on the server. This
// screen prints `url_host` and never puts it in a title either. The last test lives in the
// server's process memory, so "not tested" means "not since the server last started" and the
// sentence says that rather than "never".
//
// "NO" IS NOT AN ANSWER AN ADMINISTRATOR CAN ACT ON. The test's five reasons — `unreachable`,
// `timeout`, `tls`, `service_bind_rejected`, `protocol` — each get a sentence that says what to
// check. A sixth reason the server invents later falls back to "it gave no reason", which is at
// least true. A failed test clears the previous result: a stale green "connected" beside a fresh
// refusal is two answers to one question.
//
// THE IMPORT IS SENT IN CHUNKS OF `LDAP_IMPORT_CHUNK`, STRICTLY SEQUENTIALLY. The server runs
// `IMPORT_LOOKUPS` directory lookups at a time across EVERY request, out of `ADMIN_LANE_SLOTS`, so
// two concurrent imports would hold the whole admin lane and the administrator's own next search
// would wait a deadline and then answer 503. The chunk is 2, one wave of lookups, about 24 s on a
// slow controller — and nginx's `/admin` location has no `proxy_read_timeout`, so its 60 s default
// would 504 a larger chunk before the server finished. Each chunk's answer is kept, the rows it
// imported are marked imported in the results, a failed chunk is named by its accounts and leaves
// them chosen, and the import is idempotent: an account already here comes back as
// `skipped: "exists"`, so trying again costs nothing. While an import runs, the search is held —
// a new search would drop the chosen rows out from under it.
//
// A DN IS CHOSEN, NEVER TYPED. `canonical_dn` stores and compares a DN in a canonical spelling, and
// a hand-typed one whose Turkish or Azerbaijani letters differ in case from AD's will not match —
// silently, which is the worst kind (Wave 1A's F5 note). So the mapping's DN comes from a picker
// over `GET /admin/ldap/groups`, and a row stored before the canonicalisation may already be in
// that state: each row carries one sentence offering to delete it and choose again.
//
// WRITING THE MAPPING NEEDS EVERY PERMISSION. The server's own rule (403 `mappingAdminOnly`): a
// desk that may not regroup one nurse directly must not regroup every nurse at once through the
// mapping. `canMapGroups` decides what is drawn, and the sentence beside the read-only table is
// the server's own reason.
//
// A WRITE THAT LANDED IS NEVER REPORTED REFUSED. The mapping table is re-read after a write, and
// the re-read is a READ: it runs after the write's own try/catch, and its failure is shown as the
// table's own "could not be read", with a retry — not as a refusal of a mapping that now exists.
//
// EVERY OPERATION HAS ITS OWN "IN FLIGHT", AND THE ANNOUNCEMENT NAMES IT. One shared flag made the
// search, the add and the delete LOOK live during an import while silently doing nothing — a
// control that is offered and does nothing is rejected on the clinical screens in as many words.
//
// WHAT THE FRAME READ IS READ BY ITS STATE (`useAdminData`): each read is its last answer or
// null, and a failed read is never `[]`. A group list that failed leaves this tab standing — the
// directory is still tested, searched and imported from — with no group offered beside an import
// rather than an invented empty list; the frame's Alert names the read. The catalogue a
// `users.manage` desk is never asked for is null, and `canMapGroups` / `canGrant` then fall back
// to the mirrored keys, which only ever make a write look harder, never easier.
//
// BOTH SEARCH FIELDS CARRY THE SERVER'S OWN LIMITS (`limits.FIELD_MAX.ldap_query`, held to
// `ldap_router.SearchQuery` by its test) and count the minimum as the server does, in code points.
//
// A READ THAT TIMED OUT SAYS NOTHING WAS READ. The status, the mapping table and the two searches
// are reads, and their failures go through `readErrorText`: `errors.requestTimeout`'s "it may have
// happened" is the right warning for a write (the import, a mapping) and false for a read.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readErrorText } from "../../apiErrors.js";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { LDAP_IMPORT_CHUNK, LDAP_IMPORT_MAX, LDAP_SEARCH_CAP } from "../../../backendApi.js";
import { Announce, Box, Button, Empty, Field, Input, KV, KVList, Note, Pill, Select, Table, Tag, useToast } from "../../ui/index.js";
import { ddmmyyyy, hhmm } from "../../i18n/dates.js";
import { FIELD_MAX, FIELD_MIN, lengthOf } from "./limits.js";
import { canGrant, canMapGroups } from "./rules.js";
import { doneFor, refusedFor } from "./refusal.js";

/** The five reasons `POST /admin/ldap/test` can give, each as a sentence that says what to check. */
const TEST_REASON = {
  unreachable: "source.reasonUnreachable",
  timeout: "source.reasonTimeout",
  tls: "source.reasonTls",
  service_bind_rejected: "source.reasonServiceBindRejected",
  protocol: "source.reasonProtocol",
};
/** The seven reasons the import can skip an account (`ldap_service.SKIP_*`). */
const SKIP_REASON = {
  exists: "source.skipExists",
  not_found: "source.skipNotFound",
  disabled: "source.skipDisabled",
  expired: "source.skipExpired",
  login_taken: "source.skipLoginTaken",
  no_username: "source.skipNoUsername",
  invalid_login: "source.skipInvalidLogin",
};
export const testReasonKey = (reason) => TEST_REASON[reason] || "source.reasonUnknown";
export const skipReasonKey = (reason) => SKIP_REASON[reason] || "source.skipUnknown";

/** `[ids]` cut into chunks of `LDAP_IMPORT_CHUNK`, never more than `LDAP_IMPORT_MAX` in one call. */
export function chunksOf(ids, size = LDAP_IMPORT_CHUNK) {
  const step = Math.max(1, Math.min(size, LDAP_IMPORT_MAX));
  const out = [];
  for (let at = 0; at < ids.length; at += step) out.push(ids.slice(at, at + step));
  return out;
}

/** The search results after an import answer: every account the server says it imported, or
 *  skipped because it already existed, is now imported — so its row says so and cannot be chosen
 *  again. Pure, so a test can hold it without a directory. */
export function markImported(found, answer) {
  const done = new Set([
    ...(answer?.imported ?? []).map((row) => row.external_id),
    ...(answer?.skipped ?? []).filter((row) => row.reason === "exists").map((row) => row.external_id),
  ]);
  return (found ?? []).map((row) => (done.has(row.external_id) ? { ...row, already_imported: true } : row));
}

const stamp = (iso) => (iso ? `${ddmmyyyy(Date.parse(iso))} ${hhmm(Date.parse(iso))}` : null);

export function SourceTab({ admin }) {
  const { t } = useI18n();
  const { user: me, store } = useSession();
  const toast = useToast();
  const api = store.api;
  const groups = admin.data.groups ?? [];
  const catalogue = admin.data.catalogue ?? [];
  const mayMap = canMapGroups(me.perms, catalogue);

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  const [query, setQuery] = useState("");
  const [found, setFound] = useState(null);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState(() => new Set());
  const [extraGroup, setExtraGroup] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);
  const [chunkFailed, setChunkFailed] = useState(null);

  const [mappings, setMappings] = useState(null);
  const [mappingsError, setMappingsError] = useState(null);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [adQuery, setAdQuery] = useState("");
  const [adGroups, setAdGroups] = useState(null);
  const [groupSearching, setGroupSearching] = useState(false);
  const [adDn, setAdDn] = useState("");
  const [ourGroup, setOurGroup] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  // Set true INSIDE the effect (the house pattern, `useAdminData`), and declared before the effect
  // that reads: StrictMode's rehearsal runs the cleanup and then the effects again, and a ref set
  // true only at creation stayed false after it — every answer dropped as "unmounted".
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  /** The mapping table, read on its own: a read, with its own failure and its own retry. */
  const readMappings = useCallback(async () => {
    setMappingsLoading(true);
    setMappingsError(null);
    try {
      const rows = await store.track(() => api.ldapMappings());
      if (mounted.current) setMappings(Array.isArray(rows) ? rows : []);
    } catch (err) {
      if (mounted.current) setMappingsError(err);
    } finally {
      if (mounted.current) setMappingsLoading(false);
    }
  }, [api, store]);

  const read = useCallback(async () => {
    try {
      const answer = await store.track(() => api.ldapStatus());
      if (!mounted.current) return;
      setStatus(answer);
      setStatusError(null);
      if (answer?.configured) await readMappings();
    } catch (err) {
      if (mounted.current) setStatusError(err);
    }
  }, [api, store, readMappings]);

  useEffect(() => { read(); }, [read]);

  async function runTest() {
    if (testing) return;
    setTesting(true);
    setTest(null);
    try {
      const answer = await store.track(() => api.ldapTest());
      if (!mounted.current) return;
      setTest(answer);
      setStatus((was) => (was ? { ...was, last_test_at: answer?.checked_at, last_test_ok: answer?.ok } : was));
    } catch (err) {
      // No stale result beside a refusal: the previous answer was cleared when the test began.
      toast(refusedFor(t, status?.url_host ?? "", err), "error");
    } finally {
      if (mounted.current) setTesting(false);
    }
  }

  async function runSearch(event) {
    event?.preventDefault?.();
    // Held during an import: a new answer would drop the chosen rows out from under it.
    if (searching || importing || lengthOf(query.trim()) < FIELD_MIN.ldap_query) return;
    setSearching(true);
    setReport(null);
    setChunkFailed(null);
    try {
      const rows = await store.track(() => api.ldapSearch(query.trim()));
      if (!mounted.current) return;
      setFound(Array.isArray(rows) ? rows : []);
      setChosen(new Set());
    } catch (err) {
      if (!mounted.current) return;
      // The old query's rows do not stay under the new query's text.
      setFound(null);
      setChosen(new Set());
      toast(refusedFor(t, query.trim(), readErrorText(t, err)), "error");
    } finally {
      if (mounted.current) setSearching(false);
    }
  }

  const nameOf = (id) => found?.find((row) => row.external_id === id)?.username ?? id;

  /** Strictly sequential, chunk by chunk. A failed chunk stops the run, is named by its accounts,
   *  and leaves them chosen; the chunks already sent keep their answers. */
  async function runImport() {
    const ids = [...chosen];
    if (importing || ids.length === 0) return;
    setImporting(true);
    setChunkFailed(null);
    const chunks = chunksOf(ids);
    const imported = [];
    const skipped = [];
    let done = 0;
    try {
      for (const chunk of chunks) {
        setProgress({ done, total: ids.length });
        // eslint-disable-next-line no-await-in-loop
        const answer = await store.track(() => api.ldapImport(chunk, extraGroup ? [extraGroup] : []));
        if (!mounted.current) return;
        imported.push(...(answer?.imported ?? []));
        skipped.push(...(answer?.skipped ?? []));
        done += chunk.length;
        setChosen((was) => new Set([...was].filter((id) => !chunk.includes(id))));
        setFound((was) => markImported(was, answer));
      }
      setReport({ imported, skipped });
      toast(doneFor(t, status?.url_host ?? "", t("source.importDone", { imported: imported.length, skipped: skipped.length })));
      await admin.reload();
    } catch (err) {
      if (!mounted.current) return;
      setReport({ imported, skipped });
      const names = chunks[Math.floor(done / Math.max(1, LDAP_IMPORT_CHUNK))]?.map(nameOf).join(", ") ?? "";
      setChunkFailed(names);
      toast(refusedFor(t, names, err), "error");
    } finally {
      if (mounted.current) {
        setProgress(null);
        setImporting(false);
      }
    }
  }

  async function searchAdGroups(event) {
    event?.preventDefault?.();
    if (groupSearching || lengthOf(adQuery.trim()) < FIELD_MIN.ldap_query) return;
    setGroupSearching(true);
    try {
      const rows = await store.track(() => api.ldapGroups(adQuery.trim()));
      if (mounted.current) setAdGroups(Array.isArray(rows) ? rows : []);
    } catch (err) {
      if (!mounted.current) return;
      setAdGroups(null);
      setAdDn("");
      toast(refusedFor(t, adQuery.trim(), readErrorText(t, err)), "error");
    } finally {
      if (mounted.current) setGroupSearching(false);
    }
  }

  async function addMapping() {
    if (adding || !adDn || !ourGroup) return;
    setAdding(true);
    const name = adGroups?.find((g) => g.dn === adDn)?.name ?? adDn;
    let landed = false;
    try {
      await store.track(() => api.ldapCreateMapping(adDn, ourGroup));
      landed = true;
      toast(doneFor(t, name, t("source.mapAdded")));
      setAdDn("");
      setOurGroup("");
    } catch (err) {
      toast(refusedFor(t, name, err), "error");
    } finally {
      if (mounted.current) setAdding(false);
    }
    // After the write's own try: a re-read that fails is a READ failure, shown on the table with
    // its retry — never a refusal of a row that now exists.
    if (landed && mounted.current) await readMappings();
  }

  async function removeMapping(row) {
    if (removingId) return;
    setRemovingId(row.id);
    let landed = false;
    try {
      await store.track(() => api.ldapDeleteMapping(row.id));
      landed = true;
      toast(doneFor(t, row.ad_group_dn, t("source.mapRemoved")));
    } catch (err) {
      toast(refusedFor(t, row.ad_group_dn, err), "error");
    } finally {
      if (mounted.current) setRemovingId(null);
    }
    if (landed && mounted.current) await readMappings();
  }

  /** The extra group an import may give: only a group this desk may grant (`canGrant`) — the
   *  server refuses the WHOLE import otherwise (403 `_grantable`), and offering the system group
   *  here would make that the common case. */
  const grantable = useMemo(() => groups.filter((g) => canGrant(me.perms, g, catalogue)), [groups, me.perms, catalogue]);

  const stateOf = (row) => {
    if (row.already_imported) return <Tag>{t("source.alreadyImported")}</Tag>;
    if (row.disabled) return <Tag tone="warn">{t("source.disabled")}</Tag>;
    return <Pill icon="ok">{t("source.importable")}</Pill>;
  };

  // ONE live region, and it says WHICH operation is in flight — or, once a test has answered,
  // what it answered. The visible test result is a Note, which is not live.
  const removingDn = mappings?.find((row) => row.id === removingId)?.ad_group_dn ?? "";
  const announced = testing ? t("source.testing")
    : searching ? t("source.searchingFor", { query: query.trim() })
      : importing && progress ? t("source.importProgress", progress)
        : groupSearching ? t("source.searchingGroupsFor", { query: adQuery.trim() })
          : adding ? t("admin.savingFor", { subject: adGroups?.find((g) => g.dn === adDn)?.name ?? adDn })
            : removingId ? t("admin.savingFor", { subject: removingDn })
              : test ? (test.ok ? t("source.testOk") : t(testReasonKey(test.reason)))
                : "";

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 font-display text-17 font-bold">{t("source.title")}</h2>
        <p className="m-0 text-13 text-mute">{t("source.sub")}</p>
      </div>

      <Box title={t("source.statusTitle")} icon="key" level={3}>
        {statusError ? <Note tone="warn" icon="plug">{readErrorText(t, statusError)}</Note> : null}
        {status === null && !statusError ? <p className="m-0 text-13 text-mute">{t("admin.loading")}</p> : null}
        {status && !status.configured ? <Note tone="info" icon="plug">{t("source.notConfigured")}</Note> : null}
        {status?.configured ? (
          <>
            <p className="m-0 mb-2"><Pill icon="ok">{t("source.configured")}</Pill></p>
            <KVList>
              <KV label={t("source.host")}>
                {/* The host, and only the host. No bind DN and no password reach this screen. */}
                <span className="font-data">{status.url_host}</span>
              </KV>
              <KV label={t("source.lastTest")}>
                {status.last_test_at
                  ? `${stamp(status.last_test_at)} · ${t(status.last_test_ok === true ? "source.lastTestOk"
                    : status.last_test_ok === false ? "source.lastTestFail" : "source.lastTestUnknown")}`
                  : t("source.lastTestNever")}
              </KV>
            </KVList>
            <p className="m-0 mt-2 text-12 text-mute">{t("source.hostNote")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button icon="plug" busy={testing} onClick={runTest}>{t("source.test")}</Button>
              <span className="text-12 text-mute">{t("source.timeoutNote")}</span>
            </div>
            {test ? (
              test.ok
                ? <Note tone="info" icon="ok" className="mt-2">{t("source.testOk")}</Note>
                : <Note tone="warn" icon="alert" className="mt-2">{t(testReasonKey(test.reason))}</Note>
            ) : null}
          </>
        ) : null}
      </Box>

      {status?.configured ? (
        <Box title={t("source.searchTitle")} icon="search" level={3}>
          <form noValidate onSubmit={runSearch} className="flex flex-wrap items-end gap-2">
            <Field layout="col" label={t("source.searchLabel")} hint={t("source.searchHint", { cap: LDAP_SEARCH_CAP })}
              className="mb-0 min-w-[220px] flex-1">
              <Input value={query} maxLength={FIELD_MAX.ldap_query} disabled={searching} onChange={(e) => setQuery(e.target.value)} />
            </Field>
            {/* Busy while an import runs too: the search is held then (see runSearch), and a button
                that looks live and does nothing is the thing the clinical screens refuse. */}
            <Button icon="search" busy={searching || importing} onClick={runSearch}>{t("source.search")}</Button>
          </form>

          {found === null ? null : found.length === 0 ? (
            <Empty icon="users" className="mt-3">{t("source.searchNone")}</Empty>
          ) : (
            <>
              {found.length >= LDAP_SEARCH_CAP ? (
                <p className="m-0 mt-2 text-12.5 text-mute">{t("source.searchCapped", { cap: LDAP_SEARCH_CAP })}</p>
              ) : null}
              <Table caption={t("source.caption")} className="mt-3">
                <thead>
                  <tr>
                    <th scope="col">{t("source.colLogin")}</th>
                    <th scope="col">{t("source.colName")}</th>
                    <th scope="col">{t("source.colState")}</th>
                    <th scope="col">{t("source.colChoose")}</th>
                  </tr>
                </thead>
                <tbody>
                  {found.map((row) => (
                    <tr key={row.external_id}>
                      <th scope="row" className="font-data font-semibold">{row.username}</th>
                      <td>{row.display_name || row.upn || "—"}</td>
                      <td>{stateOf(row)}</td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={row.username}
                          checked={chosen.has(row.external_id)}
                          disabled={row.already_imported || row.disabled || importing}
                          onChange={(e) => setChosen((was) => {
                            const next = new Set(was);
                            if (e.target.checked) next.add(row.external_id);
                            else next.delete(row.external_id);
                            return next;
                          })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field layout="col" label={t("source.extraGroup")} hint={t("source.extraGroupHint")} className="mb-0">
                  <Select value={extraGroup} disabled={importing} onChange={(e) => setExtraGroup(e.target.value)}>
                    <option value="">{t("source.extraGroupNone")}</option>
                    {grantable.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </Select>
                </Field>
                <Button icon="userPlus" variant="primary" busy={importing} onClick={runImport}>
                  {t("source.importChosen", { count: chosen.size })}
                </Button>
              </div>
              {progress ? (
                <p className="m-0 mt-2 text-12.5 text-mute">{t("source.importProgress", progress)}</p>
              ) : null}
              {/* A Note, not an Alert: the chunk's refusal was announced once, on the toast, named
                  by its accounts; this is the visible explanation of what stays chosen and why a
                  retry is safe. */}
              {chunkFailed ? <Note tone="warn" icon="swap" className="mt-2">{t("source.importChunkFailed", { names: chunkFailed })}</Note> : null}
            </>
          )}

          {report ? (
            <div className="mt-3 flex flex-col gap-2">
              {report.imported.length > 0 ? (
                <div>
                  <h4 className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("source.importedTitle")}</h4>
                  <ul className="m-0 mt-1 list-none p-0 text-13">
                    {report.imported.map((row) => <li key={row.external_id} className="font-data">{row.username}</li>)}
                  </ul>
                </div>
              ) : null}
              {report.skipped.length > 0 ? (
                <div>
                  <h4 className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("source.skippedTitle")}</h4>
                  <ul className="m-0 mt-1 list-none p-0 text-13">
                    {report.skipped.map((row) => (
                      <li key={row.external_id}>
                        <span className="font-data">{nameOf(row.external_id)}</span>
                        {" — "}
                        {t(skipReasonKey(row.reason))}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </Box>
      ) : null}

      {status?.configured ? (
        <Box title={t("source.mapTitle")} icon="link" level={3}>
          <p className="m-0 mb-2 text-13 text-mute">{t("source.mapSub")}</p>
          {mayMap ? null : <Note tone="info" icon="shield">{t("errors.mappingAdminOnly")}</Note>}

          {mappingsError ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Note tone="warn" icon="plug">{refusedFor(t, t("source.mappingsFailed"), readErrorText(t, mappingsError))}</Note>
              <Button size="sm" icon="swap" busy={mappingsLoading} onClick={readMappings}>{t("source.mappingsRetry")}</Button>
            </div>
          ) : null}
          {mappings === null && !mappingsError ? <p className="m-0 text-13 text-mute">{t("admin.loading")}</p>
            : mappings !== null && mappings.length === 0 ? <Empty icon="link">{t("source.mapNone")}</Empty>
              : mappings !== null ? (
                <Table caption={t("source.mapCaption")}>
                  <thead>
                    <tr>
                      <th scope="col">{t("source.colAdGroup")}</th>
                      <th scope="col">{t("source.colOurGroup")}</th>
                      {mayMap ? <th scope="col">{t("admin.colActions")}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((row) => (
                      <tr key={row.id}>
                        <th scope="row" className="font-data font-normal">
                          {row.ad_group_dn}
                          {/* A row stored before the DNs were canonicalised may no longer match, and
                              it cannot be told apart from a good one here — so every row carries the
                              offer rather than a guess. */}
                          <span className="mt-0.5 block font-text text-10.5 text-mute">{t("source.mapStale")}</span>
                        </th>
                        <td>{row.group_name}</td>
                        {mayMap ? (
                          <td>
                            <Button size="sm" variant="ghost" icon="trash" busy={removingId === row.id}
                              label={`${t("source.mapRemove")}: ${row.ad_group_dn}`}
                              onClick={() => removeMapping(row)} />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : null}
          {mayMap ? null : <p className="m-0 mt-2 text-12 text-mute">{t("source.mapReadOnly")}</p>}

          {mayMap ? (
            <>
              <p className="m-0 mt-3 text-12 text-mute">{t("source.mapRemoveNote")}</p>
              <form noValidate onSubmit={searchAdGroups} className="mt-2 flex flex-wrap items-end gap-2">
                <Field layout="col" label={t("source.mapPickGroup")} hint={t("source.mapPickHint")}
                  className="mb-0 min-w-[220px] flex-1">
                  <Input value={adQuery} maxLength={FIELD_MAX.ldap_query} disabled={groupSearching} onChange={(e) => setAdQuery(e.target.value)} />
                </Field>
                {/* Its own words, not "Search": two buttons named identically on one panel are two
                    buttons a screen-reader user cannot tell apart, and this panel has two
                    searches — one over accounts and one over the directory's groups. */}
                <Button icon="search" busy={groupSearching} onClick={searchAdGroups}>{t("source.searchGroups")}</Button>
              </form>
              {adGroups === null ? null : (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Field layout="col" label={t("source.colAdGroup")} className="mb-0 min-w-[240px] flex-1">
                    <Select value={adDn} disabled={adding} onChange={(e) => setAdDn(e.target.value)}>
                      <option value="">—</option>
                      {adGroups.map((g) => <option key={g.dn} value={g.dn}>{`${g.name} — ${g.dn}`}</option>)}
                    </Select>
                  </Field>
                  <Field layout="col" label={t("source.mapOurGroup")} className="mb-0">
                    <Select value={ourGroup} disabled={adding} onChange={(e) => setOurGroup(e.target.value)}>
                      <option value="">—</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </Select>
                  </Field>
                  <Button icon="plus" variant="primary" busy={adding} onClick={addMapping}>
                    {t("source.mapAdd")}
                  </Button>
                </div>
              )}
            </>
          ) : null}
        </Box>
      ) : null}

      <Announce text={announced} />
    </div>
  );
}

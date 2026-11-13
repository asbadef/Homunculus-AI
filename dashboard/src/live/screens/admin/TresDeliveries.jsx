// src/live/screens/admin/TresDeliveries.jsx — Yönetim › TRƏS › «Gönderimler» (TRƏS-01 · phase F1, spec §6, §8, D9, D21,
// D25; plan F1, N15): the ledger, a stay found by its protocol number, «Şimdi gönder», «Yeniden dene» and the preview.
//
// THE LIST carries no platform words (the engine leaves `last_error` out): a row says its type, its stay's protocol
// number, its status, its skip reason in the catalogue's words and its attempts. A PARKED feed (the platform refused the
// login) is said at the top, as on the settings above (N15). «Daha fazla» reads the next page by the answer's cursor.
// The subtitle says WHICH ENVIRONMENT the list is of (`answer.environment`): the settings above can switch it, and the tab
// tells this panel to read again (`refresh`) whenever they were saved or a connection test lifted the parked feed.
//
// THE LIST IS NEVER OVERWRITTEN BY A LATE ANSWER. Every read takes a number; an answer that is not the latest request's is
// dropped — a slow page of the old filter never lands on the new filter's list, and a «Daha fazla» that was on its way
// when the filter changed appends nothing. A failed first read shows the refusal and «Yeniden dene»; a failed «Daha
// fazla» keeps the rows already read and says why beside its button.
//
// THE HAND. «Yatışı bul» reads one stay by its protocol number (and says its state: discharged with its time, transferred,
// still admitted …); «Şimdi gönder» sends its package now — never offered for a stay in DRAFT, which the engine refuses
// by hand (`tres_stay_draft`, final review 2026-11-13) — and «Önizle» shows what would be sent. «Yeniden dene» stands on a
// refused or stuck row: the engine forces its stay's package (D21). A refusal is said by its code (apiErrors.js
// `TRES_CODE_KEYS`) — `tres_busy` when a round holds the stay (N12), `tres_login_refused` at once when the feed is parked
// (the platform is not asked: the notice at the top stands for it), `tres_other_environment` for a row of the environment
// not selected, `tres_throttled` for a platform's 429 — which says how long to wait: the platform's own seconds from the
// body (`err.apiRetryAfter`, not capped), else the header's (`err.retryAfter`, capped at 15 minutes).
//
// A HAND'S RESULT IS TOLD BY ITS ROWS' STATUSES, never as «sent» (review, 2026-11-13: one failed row and one skipped row
// toasted «Gönderildi: 2»): «İşləndi: Göndərildi 3 · Uğursuz 1». A failed row makes it a warning. A hand that got no
// answer (a timeout, a dropped line, a 5xx) may have landed, and one whose login the platform refused parked the feed: the
// list is read again after both.
//
// ONE ACTION AT A TIME. The button that was pressed shows it is busy; every other action button is DISABLED, visibly — a
// second press is never silently dropped. Each row's buttons are named by the row, for a screen reader.
//
// THE PREVIEW holds patient data (the resources themselves, and the platform's last words for each): the engine audits
// every read of it (D25), the browser keeps no copy of it (`cache: no-store`), and the dialog says so and names the
// environment. Every open reads afresh. It judges as a send does (Task-12 review M5): a Patient the person's NEWER stay
// holds on the platform is `yielded` (no body, said as that stay's); a record type switched off is `type_off` (no body).
// An item with no `resource` shows no body, never a printed `null`.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { dayStamp } from "../../i18n/dates.js";
import { Box, Button, Empty, Field, Input, Modal, Note, Select, Table, useToast } from "../../ui/index.js";
import { mayHaveLanded, refusedFor } from "./refusal.js";
import {
  STATUSES, STAY_STATES, TYPES, countsText, environmentLabel, reasonLabel, statusLabel, typeLabel,
} from "./tresWords.js";
import { TresReadFailed } from "./TresReadFailed.jsx";

/** The statuses «Yeniden dene» stands on: a refused row, and one the ledger stopped trying (D21). */
export const RETRYABLE = Object.freeze(["failed", "stuck"]);
/** A found stay in this state is not offered «Şimdi gönder»: an unsigned draft is no stay to report, and the engine
 *  refuses it by hand (`tres_stay_draft`, final review 2026-11-13). Its preview stays: it sends and writes nothing. */
const DRAFT = "DRAFT";

/** A time as the reader's clock; a row with none reads as a dash. */
const stamp = (iso) => {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? "—" : dayStamp(ms, Date.now());
};

/** The seconds a throttled hand's refusal asks to wait: the platform's own, from the body, else the header's. */
const waitOf = (err) => [err?.apiRetryAfter, err?.retryAfter].find((s) => Number.isInteger(s) && s > 0);

/** A hand's refusal on the toast: by its code, and — for a platform's 429 that said how long to wait — with the wait. */
function handRefusal(t, subject, err) {
  const said = refusedFor(t, subject, err);
  const wait = err?.apiCode === "tres_throttled" ? waitOf(err) : undefined;
  return wait ? `${said} ${t("tres.deliveries.wait", { seconds: wait })}` : said;
}

/** Is the list stale after this failed hand? One that got no answer (a timeout, a dropped line, a 5xx) may have landed;
 *  a login the platform refused parked the feed, and the note at the top must say so. Every other refusal rolled back
 *  and touched nothing. */
const staleAfter = (err) => mayHaveLanded(err) || (Number.isInteger(err?.status) && err.status >= 500)
  || err?.apiCode === "tres_login_refused";

/** What the stay lookup says of a stay's state, in the catalogue's words: «taburcu 06.11 15:00», «transfer edildi» … A
 *  state this build does not know is said as the engine wrote it, never as an empty line. */
function stayWhen(t, stay) {
  if (stay.state === "ACTIVE") return t("tres.deliveries.stillAdmitted");
  if (stay.state === "DISCHARGED" && stay.discharge_at) return t("tres.deliveries.discharged", { time: stamp(stay.discharge_at) });
  if (STAY_STATES.has(stay.state)) return t(STAY_STATES.get(stay.state));
  if (typeof stay.state === "string" && stay.state) return stay.state;
  return stay.discharge_at ? t("tres.deliveries.discharged", { time: stamp(stay.discharge_at) }) : "—";
}

/** The row a button is about, in the words the row shows: «Vital göstəricilər · hmn-v-3.». */
const rowName = (t, row) => [typeLabel(t, row.resource_type), row.local_id].filter(Boolean).join(" · ");

function PreviewItems({ preview }) {
  const { t } = useI18n();
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {preview.items.map((item) => (
        <li key={`${item.resource_type} ${item.local_id}`} className="rounded-ctl border border-line px-3 py-2">
          <p className="m-0 font-text text-13.5">
            <strong>{typeLabel(t, item.resource_type)}</strong> · <code className="font-data text-12">{item.local_id}</code>
            {item.yielded === true ? (
              <>{" · "}{t("tres.deliveries.yielded")}</>
            ) : (
              <>
                {" · "}{item.held ? t("tres.deliveries.held") : t("tres.deliveries.notHeld")}
                {item.status ? ` · ${statusLabel(t, item.status)}` : ""}
                {item.reason ? ` · ${reasonLabel(t, item.reason)}` : ""}
              </>
            )}
          </p>
          {item.last_error ? (
            <p className="m-0 mt-1 text-12 text-mute">{t("tres.deliveries.lastError", { words: item.last_error })}</p>
          ) : null}
          {item.resource ? (
            // A scrollable body a keyboard must be able to reach: focusable, and named by the resource it holds.
            <pre tabIndex={0} role="region" aria-label={`${typeLabel(t, item.resource_type)} · ${item.local_id}`}
              className="m-0 mt-2 max-h-64 overflow-auto rounded-ctl bg-card2 p-2 font-data text-11">
              {JSON.stringify(item.resource, null, 2)}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** `refresh`: the tab's counter — it moves when the settings were saved or a connection test succeeded, and the panel
 *  reads again (keeping its filters and the number typed). */
export function TresDeliveries({ refresh = 0 }) {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [filters, setFilters] = useState({ status: "", type: "" });
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);          // the first page could not be read: no list to show
  const [moreError, setMoreError] = useState(null);  // a later page could not: the list stays, the button says why
  const [busy, setBusy] = useState(null);            // the name of the one action running
  const [key, setKey] = useState("");
  const [stay, setStay] = useState(null);
  const [preview, setPreview] = useState(null);
  const latest = useRef(0);                          // the number of the newest list read
  const running = useRef(false);                     // an action is running (state alone is a render late)

  const read = useCallback(async (cursor = null) => {
    latest.current += 1;
    const mine = latest.current;
    try {
      const got = await store.track(() => store.api.tresDeliveries({
        status: filters.status || null, type: filters.type || null, cursor }));
      if (!got || !Array.isArray(got.items)) throw new Error("no deliveries in the answer");
      if (mine !== latest.current) return;           // a newer read owns the list: this answer is the past's
      setAnswer((before) => (cursor && before ? { ...got, items: [...before.items, ...got.items] } : got));
      setError(null);
      setMoreError(null);
    } catch (err) {
      if (mine !== latest.current) return;
      if (cursor) setMoreError(err);
      else setError(err);
    }
  }, [store, filters]);
  useEffect(() => { read(); }, [read, refresh]);

  async function run(name, work) {
    if (running.current) return;
    running.current = true;
    setBusy(name);
    try {
      await work();
    } finally {
      running.current = false;
      setBusy(null);
    }
  }
  /** One action runs: every other action button is off, and says so. */
  const off = (name) => busy !== null && busy !== name;

  const find = (event) => {
    event.preventDefault();
    if (!key.trim()) return;
    run("find", async () => {
      try {
        setStay(await store.track(() => store.api.tresStay(key.trim())));
      } catch (err) {
        setStay(null);
        toast(refusedFor(t, t("tres.deliveries.find"), err), "error");
      }
    });
  };
  /** A hand: its result told by its rows' statuses; a failure by its code, and the list read again where it is stale. */
  const hand = (name, subject, call, headline) => run(name, async () => {
    try {
      const got = await store.track(call);
      const rows = Array.isArray(got?.rows) ? got.rows : [];
      toast(t(headline, { counts: countsText(t, rows) }), rows.some((r) => r?.status === "failed") ? "warn" : "ok");
      await read();
    } catch (err) {
      toast(handRefusal(t, subject, err), "error");
      if (staleAfter(err)) await read();
    }
  });
  const sendNow = () => hand("send", t("tres.deliveries.sendNow"), () => store.api.sendTresStay(stay.admission_id),
    "tres.deliveries.handled");
  const retry = (row) => hand(`retry:${row.id}`, t("tres.deliveries.retry"), () => store.api.retryTresDelivery(row.id),
    "tres.deliveries.retried");
  const open = (name, admissionId) => run(name, async () => {
    try {
      const got = await store.track(() => store.api.tresPreview(admissionId));
      if (!got || !Array.isArray(got.items)) throw new Error("no preview in the answer");
      setPreview(got);
    } catch (err) {
      toast(refusedFor(t, t("tres.deliveries.preview"), err), "error");
    }
  });

  const parked = typeof answer?.session_refused_at === "string" ? answer.session_refused_at : null;
  const items = answer?.items ?? [];
  const environment = environmentLabel(t, answer?.environment);
  const filtered = Boolean(filters.status || filters.type);
  return (
    <Box title={t("tres.deliveries.title")} level={2}>
      <div className="mb-3 grid gap-1 text-13">
        <p className="m-0 text-mute">{t("tres.deliveries.sub")}</p>
        {environment ? <p className="m-0 font-semibold text-ink">{t("tres.deliveries.inEnvironment", { environment })}</p> : null}
      </div>
      {parked ? <Note tone="warn" icon="alert" className="mb-3">{t("tres.deliveries.parked", { time: stamp(parked) })}</Note> : null}
      <form noValidate autoComplete="off" onSubmit={find} className="mb-2 flex flex-wrap items-end gap-2">
        <Field label={t("tres.deliveries.findLabel")}>
          <Input value={key} maxLength={16} autoComplete="off" onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Button type="submit" busy={busy === "find"} disabled={off("find")}>{t("tres.deliveries.find")}</Button>
      </form>
      <div role="status" className={stay ? "mb-3 flex flex-wrap items-center gap-2 font-text text-13.5" : undefined}>
        {stay ? (
          <>
            <span>{t("tres.deliveries.found", { key: stay.board_key, when: stayWhen(t, stay) })}</span>
            {stay.state === DRAFT ? null : (
              <Button variant="primary" busy={busy === "send"} disabled={off("send")} onClick={sendNow}>
                {t("tres.deliveries.sendNow")}
              </Button>
            )}
            <Button busy={busy === "preview:stay"} disabled={off("preview:stay")}
              onClick={() => open("preview:stay", stay.admission_id)}>{t("tres.deliveries.preview")}</Button>
          </>
        ) : null}
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        <Field label={t("tres.deliveries.filterStatus")}>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">{t("tres.deliveries.all")}</option>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </Select>
        </Field>
        <Field label={t("tres.deliveries.filterType")}>
          <Select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
            <option value="">{t("tres.deliveries.all")}</option>
            {TYPES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </Select>
        </Field>
      </div>
      {error ? (
        <TresReadFailed text={t("tres.deliveries.readFailed", { reason: readErrorText(t, error) })}
          busy={busy === "read"} onRetry={() => run("read", () => read())} />
      ) : answer === null ? (
        <p className="m-0 text-13 text-mute">{t("tres.deliveries.loading")}</p>
      ) : items.length === 0 ? (
        <Empty>{filtered ? t("tres.deliveries.emptyFiltered") : t("tres.deliveries.empty")}</Empty>
      ) : (
        <Table caption={t("tres.deliveries.caption")}>
          <thead>
            <tr>
              <th>{t("tres.deliveries.when")}</th><th>{t("tres.deliveries.type")}</th><th>{t("tres.deliveries.key")}</th>
              <th>{t("tres.deliveries.status")}</th><th>{t("tres.deliveries.reason")}</th>
              <th>{t("tres.deliveries.attempts")}</th><th>{t("tres.deliveries.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td>{stamp(row.updated_at)}</td>
                <td>{typeLabel(t, row.resource_type)}</td>
                <td className="font-data">{row.board_key ?? "—"}</td>
                <td>{statusLabel(t, row.status)}</td>
                <td>{reasonLabel(t, row.reason)}</td>
                <td className="font-data font-bold">{row.attempts}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {RETRYABLE.includes(row.status) && row.admission_id ? (
                      <Button size="sm" busy={busy === `retry:${row.id}`} disabled={off(`retry:${row.id}`)}
                        aria-label={`${t("tres.deliveries.retry")} · ${rowName(t, row)}`} onClick={() => retry(row)}>
                        {t("tres.deliveries.retry")}
                      </Button>
                    ) : null}
                    {row.admission_id ? (
                      <Button size="sm" busy={busy === `preview:${row.id}`} disabled={off(`preview:${row.id}`)}
                        aria-label={`${t("tres.deliveries.preview")} · ${rowName(t, row)}`}
                        onClick={() => open(`preview:${row.id}`, row.admission_id)}>
                        {t("tres.deliveries.preview")}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {answer?.next && !error ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button busy={busy === "more"} disabled={off("more")} onClick={() => run("more", () => read(answer.next))}>
            {t("tres.deliveries.more")}
          </Button>
          {moreError ? (
            <p role="alert" className="m-0 text-13 text-crit">
              {t("tres.deliveries.readFailed", { reason: readErrorText(t, moreError) })}
            </p>
          ) : null}
        </div>
      ) : null}
      <Modal open={preview !== null} wide title={preview ? t("tres.deliveries.previewTitle", { key: preview.board_key }) : ""}
        onClose={() => setPreview(null)}>
        {preview ? (
          <>
            <Note tone="warn" icon="lock" className="mb-3">{t("tres.deliveries.previewNote")}</Note>
            {environmentLabel(t, preview.environment) ? (
              <p className="m-0 mb-3 font-text text-13 font-semibold">
                {t("tres.deliveries.inEnvironment", { environment: environmentLabel(t, preview.environment) })}
              </p>
            ) : null}
            <PreviewItems preview={preview} />
          </>
        ) : null}
      </Modal>
    </Box>
  );
}

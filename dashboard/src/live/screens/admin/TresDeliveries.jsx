// src/live/screens/admin/TresDeliveries.jsx — Yönetim › TRƏS › «Gönderimler» (TRƏS-01 · phase F1, spec §6, §8, D9, D21,
// D25; plan F1, N15): the ledger, a stay found by its protocol number, «Şimdi gönder», «Yeniden dene» and the preview.
//
// THE LIST carries no platform words (the engine leaves `last_error` out): a row says its type, its stay's protocol
// number, its status, its skip reason in the catalogue's words and its attempts. A PARKED feed (the platform refused the
// login) is said at the top, as on the settings above (N15). «Daha fazla» reads the next page by the answer's cursor.
//
// THE HAND. «Yatışı bul» reads one stay by its protocol number; «Şimdi gönder» sends its package now, «Önizle» shows
// what would be sent. «Yeniden dene» stands on a refused or stuck row: the engine forces its stay's package (D21). A
// refusal is said by its code (apiErrors.js `TRES_CODE_KEYS`) — `tres_busy` when a round holds the stay (N12),
// `tres_login_refused` at once when the feed is parked (the platform is not asked: the notice at the top stands for it),
// `tres_other_environment` for a row of the environment not selected, `tres_throttled` for a platform's 429 — which
// says how long to wait when the answer carried the platform's `Retry-After` (`err.retryAfter`, seconds).
//
// THE PREVIEW holds patient data (the resources themselves, and the platform's last words for each): the engine audits
// every read of it (D25), and the dialog says so. It judges as a send does (Task-12 review M5): a Patient the person's
// NEWER stay holds on the platform is `yielded` (no body, said as that stay's); a record type switched off is `type_off`
// (no body). An item with no `resource` shows no body, never a printed `null`.
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { dayStamp } from "../../i18n/dates.js";
import { Box, Button, Empty, Field, Input, Modal, Note, Select, Table, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";
import { STATUSES, TYPES, reasonLabel, statusLabel, typeLabel } from "./tresWords.js";

/** The statuses «Yeniden dene» stands on: a refused row, and one the ledger stopped trying (D21). */
export const RETRYABLE = Object.freeze(["failed", "stuck"]);

/** A time as the reader's clock; a row with none reads as a dash. */
const stamp = (iso) => {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? "—" : dayStamp(ms, Date.now());
};

/** A hand's refusal on the toast: by its code, and — for a platform's 429 that said how long to wait — with the wait. */
function handRefusal(t, subject, err) {
  const said = refusedFor(t, subject, err);
  return err?.apiCode === "tres_throttled" && Number.isInteger(err?.retryAfter) && err.retryAfter > 0
    ? `${said} ${t("tres.deliveries.wait", { seconds: err.retryAfter })}`
    : said;
}

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
            <pre className="m-0 mt-2 max-h-64 overflow-auto rounded-ctl bg-card2 p-2 font-data text-11">
              {JSON.stringify(item.resource, null, 2)}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function TresDeliveries() {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [filters, setFilters] = useState({ status: "", type: "" });
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [key, setKey] = useState("");
  const [stay, setStay] = useState(null);
  const [preview, setPreview] = useState(null);

  const read = useCallback(async (cursor = null) => {
    try {
      const got = await store.track(() => store.api.tresDeliveries({
        status: filters.status || null, type: filters.type || null, cursor }));
      if (!got || !Array.isArray(got.items)) throw new Error("no deliveries in the answer");
      setAnswer((before) => (cursor && before ? { ...got, items: [...before.items, ...got.items] } : got));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [store, filters]);
  useEffect(() => { read(); }, [read]);

  async function run(name, work) {
    if (busy) return;
    setBusy(name);
    try {
      await work();
    } finally {
      setBusy(null);
    }
  }

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
  const sendNow = () => run("send", async () => {
    try {
      const got = await store.track(() => store.api.sendTresStay(stay.admission_id));
      toast(t("tres.deliveries.sent", { count: Array.isArray(got?.rows) ? got.rows.length : 0 }));
      await read();
    } catch (err) {
      toast(handRefusal(t, t("tres.deliveries.sendNow"), err), "error");
    }
  });
  const retry = (row) => run(row.id, async () => {
    try {
      const got = await store.track(() => store.api.retryTresDelivery(row.id));
      toast(t("tres.deliveries.retried", { count: Array.isArray(got?.rows) ? got.rows.length : 0 }));
      await read();
    } catch (err) {
      toast(handRefusal(t, t("tres.deliveries.retry"), err), "error");
    }
  });
  const open = (admissionId) => run("preview", async () => {
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
  return (
    <Box title={t("tres.deliveries.title")} level={2}>
      <p className="m-0 mb-3 text-13 text-mute">{t("tres.deliveries.sub")}</p>
      {parked ? <Note tone="warn" icon="alert" className="mb-3">{t("tres.deliveries.parked", { time: stamp(parked) })}</Note> : null}
      <form noValidate autoComplete="off" onSubmit={find} className="mb-2 flex flex-wrap items-end gap-2">
        <Field label={t("tres.deliveries.findLabel")}>
          <Input value={key} inputMode="numeric" maxLength={16} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Button type="submit" busy={busy === "find"}>{t("tres.deliveries.find")}</Button>
      </form>
      {stay ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 font-text text-13.5">
          <span>{t("tres.deliveries.found", { key: stay.board_key, when: stay.discharge_at
            ? t("tres.deliveries.discharged", { time: stamp(stay.discharge_at) }) : t("tres.deliveries.stillAdmitted") })}</span>
          <Button variant="primary" busy={busy === "send"} onClick={sendNow}>{t("tres.deliveries.sendNow")}</Button>
          <Button busy={busy === "preview"} onClick={() => open(stay.admission_id)}>{t("tres.deliveries.preview")}</Button>
        </div>
      ) : null}
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
        <p className="m-0 text-13 text-crit">{t("tres.deliveries.readFailed", { reason: readErrorText(t, error) })}</p>
      ) : answer === null ? (
        <p className="m-0 text-13 text-mute">{t("tres.deliveries.loading")}</p>
      ) : items.length === 0 ? (
        <Empty>{t("tres.deliveries.empty")}</Empty>
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
                      <Button size="sm" busy={busy === row.id} onClick={() => retry(row)}>{t("tres.deliveries.retry")}</Button>
                    ) : null}
                    {row.admission_id ? (
                      <Button size="sm" onClick={() => open(row.admission_id)}>{t("tres.deliveries.preview")}</Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {answer?.next ? (
        <Button className="mt-2" busy={busy === "more"} onClick={() => run("more", () => read(answer.next))}>
          {t("tres.deliveries.more")}
        </Button>
      ) : null}
      <Modal open={preview !== null} wide title={preview ? t("tres.deliveries.previewTitle", { key: preview.board_key }) : ""}
        onClose={() => setPreview(null)}>
        {preview ? (
          <>
            <Note tone="warn" icon="lock" className="mb-3">{t("tres.deliveries.previewNote")}</Note>
            <PreviewItems preview={preview} />
          </>
        ) : null}
      </Modal>
    </Box>
  );
}

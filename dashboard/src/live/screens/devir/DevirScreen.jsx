// src/live/screens/devir/DevirScreen.jsx — «Vardiya devri», the shift handover (G2-B3b, spec D9; owner D1: one
// patient per handover, with a D-Ö-D-Ö note and a system summary sealed at the outgoing signature; owner D2: the
// outgoing person chooses the receiver, and only that person countersigns).
//
// THREE LISTS, FROM MY TWO BOXES (GET /handovers?box=incoming|outgoing, D7; devir.js `groupHandovers`):
//   «Karşı imzanızı bekleyenler» — handed to me and signed, the one waiting longest first: the bed linked to the
//     patient, who handed over and when, the sealed note, the summary, and «Okudum, karşı imzala»;
//   «Benim devrettiklerim» — mine: OPEN (the signature was refused, or not given yet) with «İmzala», and signed ones
//     waiting for their receiver;
//   «Son 24 saat» — completed or expired, either box, newest first.
// They are read on arrival and again after every write — landed, refused or unanswered — and never on a timer: there
// is no rail badge in this slice (D9), so nothing polls.
//
// AN OPEN HANDOVER OF MINE. Its «İmzala» opens the note step (NewHandoverDialog with the row) — or, when the row
// already carries a note the server would take, signs with it as it is, the note on the row for her to see. While the
// live board shows the patient a critical alarm nobody acknowledged, the button is held and the row says why, with a
// way to the alarm (the prototype's «İmzalanamaz … Alarma git»). An OPEN row past its 30-minute bridge (S-24) is one
// the engine will turn EXPIRED at the first attempt: it says so on the server's clock (`useBoardNow`) and offers no
// signature — a new handover is the way on.
//
// THE SUMMARY IS THE SIGNATURE'S, NEVER THE PRESENT (D6): its title says so, its values are as the board had them
// then, and it carries a link to the patient for the current data. A patient never measured has only the moment.
//
// EVERY ANSWER IS ON THE TOAST, naming the bed and the unit — never the name (RrtCallDialog's rule). A write that got
// no answer may have gone through (`mayHaveLanded`), and its toast says so. A signature the server held for a
// critical alarm is said in this screen's words, not the discharge's (`kabul.err.criticalAlarmOpen`).
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { apiErrorText, readErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Empty, Note, StatusPill, riskStyle, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { dayStamp } from "../../i18n/dates.js";
import { useBoardNow } from "../common/BoardState.jsx";
import { msOf } from "../common/elapsed.js";
import { mayHaveLanded } from "../admin/refusal.js";
import {
  NOTE_PARTS, bridgeExpired, groupHandovers, noteBody, noteValid, openCriticalOnBoard, patientOf, subjectOf,
} from "./devir.js";
import { CRITICAL_ALARM_OPEN, NewHandoverDialog } from "./NewHandoverDialog.jsx";

/** The clock the bridge's end is read against: half a minute is close enough for a 30-minute window. */
const TICK_MS = 30_000;

/** A status this build has words for, as its key — any other is shown as the server's code. */
const STATUS_KEYS = { OPEN: "devir.status.OPEN", OUTGOING_SIGNED: "devir.status.OUTGOING_SIGNED",
  COMPLETED: "devir.status.COMPLETED", EXPIRED: "devir.status.EXPIRED" };
const STATUS_TONES = { OPEN: "att", OUTGOING_SIGNED: "neutral", COMPLETED: "ok", EXPIRED: "neutral" };

/** The five vitals the summary carries (D6), with the board's own units. */
const VITALS = [
  ["heart_rate", "devir.sum.hr", "board.unitBpm"],
  ["map", "devir.sum.map", "board.unitMmhg"],
  ["spo2", "devir.sum.spo2", "board.unitPct"],
  ["resp_rate", "devir.sum.rr", "board.unitBpm"],
  ["temperature", "devir.sum.temp", "board.unitC"],
];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** My two boxes, read together; the newest read wins. `phase`: "loading" (nothing read yet), "known", "failed"
 *  (nothing could be read), "stale" (a read again failed; the last lists stand). */
function useHandovers() {
  const { store } = useSession();
  const [state, setState] = useState({ phase: "loading", boxes: null, error: null });
  const [reading, setReading] = useState(false);
  const seq = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const reload = useCallback(async () => {
    seq.current += 1;
    const mine = seq.current;
    setReading(true);
    try {
      const [incoming, outgoing] = await Promise.all(
        ["incoming", "outgoing"].map((box) => store.track(() => store.api.handovers(box))),
      );
      if (mounted.current && mine === seq.current) setState({ phase: "known", boxes: { incoming, outgoing }, error: null });
    } catch (error) {
      if (mounted.current && mine === seq.current) {
        setState((prev) => ({ phase: prev.boxes ? "stale" : "failed", boxes: prev.boxes, error }));
      }
    } finally {
      if (mounted.current && mine === seq.current) setReading(false);
    }
  }, [store]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reading, reload };
}

/** The bed and the unit, linked to the patient (`#/patients/{board_key}`), then the name. */
function PatientLine({ row }) {
  const p = patientOf(row);
  const subject = subjectOf(row);
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-14">
      {p?.board_key ? (
        <a href={`#/patients/${encodeURIComponent(p.board_key)}`} className={`rounded-md font-data font-bold text-ink ${FOCUS_RING}`}>
          {subject}
        </a>
      ) : <span className="font-data font-bold">{subject}</span>}
      {p?.display_name ? <span className="font-semibold">{p.display_name}</span> : null}
    </p>
  );
}

/** Who handed over to whom, the row's state, and the moment that matters for it. */
function Meta({ row, nowMs, pill = true }) {
  const { t } = useI18n();
  const expired = bridgeExpired(row, nowMs);
  const status = expired ? "EXPIRED" : row.status;
  const signed = msOf(row.outgoing_signed_at);
  const countersigned = msOf(row.incoming_signed_at);
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-12.5 text-mute">
      {pill ? (
        <StatusPill tone={STATUS_TONES[status] ?? "att"}>
          {STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : <span className="font-data">{String(status ?? "—")}</span>}
        </StatusPill>
      ) : null}
      <span className="font-semibold text-ink">
        {t("devir.fromTo", { from: row.outgoing?.name || "—", to: row.incoming?.name || "—" })}
      </span>
      {row.status === "COMPLETED" && countersigned !== null ? (
        <span>{t("devir.countersignedAt", { time: dayStamp(countersigned, nowMs) })}</span>
      ) : row.status === "OUTGOING_SIGNED" && signed !== null ? (
        <span>{t("devir.signedAt", { time: dayStamp(signed, nowMs) })}</span>
      ) : null}
    </p>
  );
}

/** The sealed D-Ö-D-Ö note: each written part under its own label (D5). */
function NoteView({ note }) {
  const { t } = useI18n();
  const parts = NOTE_PARTS.filter((part) => typeof note?.[part] === "string" && note[part].trim() !== "");
  return (
    <section className="min-w-0 rounded-ctl border border-line bg-card2 px-3 py-2">
      <h3 className="m-0 mb-1.5 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("devir.noteLegend")}</h3>
      {parts.length === 0 ? <p className="m-0 text-13 text-mute">{t("devir.noNote")}</p> : (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-13">
          {parts.map((part) => (
            <React.Fragment key={part}>
              <dt className="whitespace-nowrap font-semibold text-mute">{t(`devir.part.${part}`)}</dt>
              <dd className="m-0 whitespace-pre-wrap break-words text-ink">{note[part]}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </section>
  );
}

/** One term of the summary and its value. */
function Item({ label, children }) {
  return (
    <>
      <dt className="whitespace-nowrap text-mute">{label}</dt>
      <dd className="m-0 text-ink">{children}</dd>
    </>
  );
}

/** A value of the summary with its unit, or a dash for one the board did not have. */
function Reading({ value, unit }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return <><b className="font-data">{value}</b> {unit}</>;
}

/** What the board showed at the outgoing signature (D6): plain values with their units, and the way to the present. */
function SummaryView({ summary, boardKey, nowMs }) {
  const { t } = useI18n();
  if (!isObject(summary)) return null;
  // A handover of several patients seals {patients: {key: summary}}; this slice hands over one (D1).
  const s = isObject(summary.patients) ? summary.patients[boardKey] : summary;
  if (!isObject(s)) return null;
  const at = msOf(s.captured_at);
  const latest = isObject(s.latest) ? s.latest : null;
  const measured = latest !== null || s.risk !== undefined;
  const risk = riskStyle(s.risk, { measured: true });
  const news2 = isObject(s.news2) ? s.news2 : {};
  const alerts = Array.isArray(s.open_alerts) ? s.open_alerts.filter(isObject) : [];
  return (
    <section className="min-w-0 rounded-ctl border border-line px-3 py-2">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <h3 className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("devir.summaryTitle")}</h3>
        {at !== null ? <span className="ml-auto text-11.5 text-mute">{t("devir.summaryAt", { time: dayStamp(at, nowMs) })}</span> : null}
      </div>
      {!measured ? <p className="m-0 text-13 text-mute">{t("devir.summaryNone")}</p> : (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-13">
          <Item label={t("devir.sum.risk")}>
            <StatusPill tone={risk.tone} icon={risk.icon}>{t(risk.labelKey, risk.labelVars)}</StatusPill>
          </Item>
          <Item label={t("devir.sum.news2")}>
            {typeof news2.total === "number" ? (
              <><b className="font-data">{news2.total}</b>{news2.partial === true ? ` · ${t("board.news2Partial")}` : ""}</>
            ) : "—"}
          </Item>
          {VITALS.map(([key, labelKey, unitKey]) => (
            <Item key={key} label={t(labelKey)}><Reading value={latest?.[key]} unit={t(unitKey)} /></Item>
          ))}
          <Item label={t("devir.sum.pressor")}>
            {typeof s.on_pressor === "boolean" ? t(s.on_pressor ? "devir.sum.on" : "devir.sum.off") : "—"}
          </Item>
          <Item label={t("devir.sum.alerts")}>
            {alerts.length === 0 ? t("devir.sum.alertsNone") : alerts.map((a, i) => {
              const severity = riskStyle(a.severity, { measured: true });
              return (
                // eslint-disable-next-line react/no-array-index-key
                <span key={i} className="block">
                  <span className="font-data">{String(a.kind ?? "—")}</span>
                  {` · ${t(severity.labelKey, severity.labelVars)} · ${t(a.acknowledged ? "devir.sum.acked" : "devir.sum.unacked")}`}
                </span>
              );
            })}
          </Item>
        </dl>
      )}
      {boardKey ? (
        <a href={`#/patients/${encodeURIComponent(boardKey)}`}
          className={`mt-1.5 inline-block rounded-md text-12.5 font-semibold text-pri underline ${FOCUS_RING}`}>
          {t("devir.summaryNow")}
        </a>
      ) : null}
    </section>
  );
}

/** Handed to me and signed: read the note and the summary, then countersign. */
function ToCountersignRow({ row, nowMs, busy, onCountersign }) {
  const { t } = useI18n();
  const p = patientOf(row);
  return (
    <li className="grid gap-2.5 border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <PatientLine row={row} />
          <Meta row={row} nowMs={nowMs} pill={false} />
        </div>
        <Button variant="primary" size="sm" icon="ok" busy={busy} onClick={() => onCountersign(row)}
          aria-label={t("devir.countersignLabel", { subject: subjectOf(row) })}>
          {t("devir.countersign")}
        </Button>
      </div>
      <div className="grid gap-2.5 min-[861px]:grid-cols-2">
        <NoteView note={row.note} />
        <SummaryView summary={row.summary} boardKey={p?.board_key} nowMs={nowMs} />
      </div>
    </li>
  );
}

/** Mine: OPEN — to sign, held by the board's lock, or past its bridge — or signed and waiting for its receiver. */
function MineRow({ row, nowMs, board, busy, onSign }) {
  const { t } = useI18n();
  const lockId = useId();
  const p = patientOf(row);
  const expired = bridgeExpired(row, nowMs);
  const signable = row.status === "OPEN" && !expired;
  const locked = signable && openCriticalOnBoard(board, p?.board_key) > 0;
  return (
    <li className="grid gap-2 border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <PatientLine row={row} />
          <Meta row={row} nowMs={nowMs} />
        </div>
        {signable ? (
          <Button variant="primary" size="sm" icon="edit" busy={busy}
            aria-disabled={locked ? "true" : undefined} aria-describedby={locked ? lockId : undefined}
            aria-label={t("devir.signLabel", { subject: subjectOf(row) })}
            onClick={() => { if (!locked) onSign(row); }}>
            {t("devir.sign")}
          </Button>
        ) : null}
      </div>
      {expired ? <p className="m-0 text-13 font-semibold text-att-ink">{t("devir.expiredOpen")}</p> : null}
      {locked ? (
        <Note icon="lock">
          <span id={lockId}>{t("devir.lock")}</span>{" "}
          <a href="#/alarms" className={`rounded-md underline ${FOCUS_RING}`}>{t("devir.toAlarms")}</a>
        </Note>
      ) : null}
      {/* A note the server already holds for an OPEN one is what «İmzala» will sign: she sees it first. */}
      {signable && noteValid(row.note) ? <NoteView note={row.note} /> : null}
    </li>
  );
}

/** Completed or expired, in the last 24 hours. */
function RecentRow({ row, nowMs }) {
  return (
    <li className="grid gap-1 border-t border-line py-2.5 first:border-t-0 first:pt-0">
      <PatientLine row={row} />
      <Meta row={row} nowMs={nowMs} />
    </li>
  );
}

/** One list under its own heading, named by it for a screen reader's landmarks. `items` null: not read yet. */
function Section({ titleKey, icon, items, emptyKey, renderRow }) {
  const { t } = useI18n();
  const titleId = useId();
  let body;
  if (items === null) body = <p className="m-0 text-13 text-mute">{t("devir.loading")}</p>;
  else if (items.length === 0) body = <Empty icon={icon}>{t(emptyKey)}</Empty>;
  else body = <ul className="m-0 list-none p-0">{items.map(renderRow)}</ul>;
  return (
    <section aria-labelledby={titleId}>
      <Box title={<span id={titleId}>{t(titleKey)}</span>} icon={icon} level={2}>{body}</Box>
    </section>
  );
}

export function DevirScreen() {
  const { t } = useI18n();
  const board = useBoard();
  const { store } = useSession();
  const toast = useToast();
  const nowMs = useBoardNow(TICK_MS);
  const { phase, boxes, error, reading, reload } = useHandovers();
  const [dialog, setDialog] = useState(null);           // null, or {handover}: null for «Yeni devir», a row to sign
  const [busyId, setBusyId] = useState(null);           // the handover a write is out for — one at a time
  const groups = useMemo(() => (boxes ? groupHandovers(boxes) : null), [boxes]);

  /** One write from a row: its answer on the toast, naming the bed, then the lists read again (held till then). */
  async function write(row, call, doneKey, refusedKey) {
    if (busyId !== null) return;
    const subject = subjectOf(row);
    setBusyId(row.id);
    let said = null;
    try {
      await store.track(call);
      said = [t(doneKey, { subject })];
    } catch (err) {
      if (err?.superseded) said = null;
      else if (mayHaveLanded(err)) said = [t("devir.mayHaveLanded", { subject }), "warn"];
      else {
        // The engine's hold for a critical alarm, in this screen's words — not the discharge's.
        const reason = err?.apiCode === CRITICAL_ALARM_OPEN ? t("devir.criticalReason") : apiErrorText(t, err);
        said = [t(refusedKey, { subject, reason }), "error"];
      }
    }
    if (said) toast(...said);
    try {
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  const countersign = (row) => write(row, () => store.api.countersignHandover(row.id),
    "devir.countersigned", "devir.countersignRefused");
  // A note the server would take is signed as it is; otherwise the note step.
  const sign = (row) => (noteValid(row.note)
    ? write(row, () => store.api.signHandover(row.id, noteBody(row.note)), "devir.signed", "devir.signRefused")
    : setDialog({ handover: row }));

  const rowBusy = (row) => busyId === row.id;
  return (
    <div className="flex min-h-0 max-w-[1000px] flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-23 font-bold">{t("devir.title")}</h1>
          <p className="m-0 text-13 text-mute">{t("devir.intro")}</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setDialog({ handover: null })}>{t("devir.newHandover")}</Button>
      </div>

      {error ? (
        <Alert tone="crit">
          <p className="m-0">{t(phase === "stale" ? "devir.readStale" : "devir.readFailed", { reason: readErrorText(t, error) })}</p>
          <Button size="sm" className="mt-2" busy={reading} onClick={reload}>{t("devir.retry")}</Button>
        </Alert>
      ) : null}

      {/* An unread list is not an empty one: after a failed first read there are no lists at all, only the alert. */}
      {phase === "failed" ? null : (
        <>
          <Section
            titleKey="devir.toCountersignTitle" icon="clip" items={groups?.toCountersign ?? null} emptyKey="devir.toCountersignEmpty"
            renderRow={(row) => <ToCountersignRow key={row.id} row={row} nowMs={nowMs} busy={rowBusy(row)} onCountersign={countersign} />}
          />
          <Section
            titleKey="devir.mineTitle" icon="swap" items={groups ? [...groups.mineOpen, ...groups.mineWaiting] : null}
            emptyKey="devir.mineEmpty"
            renderRow={(row) => <MineRow key={row.id} row={row} nowMs={nowMs} board={board} busy={rowBusy(row)} onSign={sign} />}
          />
          <Section
            titleKey="devir.recentTitle" icon="clock" items={groups?.recent ?? null} emptyKey="devir.recentEmpty"
            renderRow={(row) => <RecentRow key={row.id} row={row} nowMs={nowMs} />}
          />
        </>
      )}

      {/* A busy button reads only "unavailable"; the words come from here. */}
      <Announce text={busyId !== null ? t("devir.sending") : ""} />
      <NewHandoverDialog open={dialog !== null} handover={dialog?.handover ?? null} onClose={() => setDialog(null)} onWritten={reload} />
    </div>
  );
}

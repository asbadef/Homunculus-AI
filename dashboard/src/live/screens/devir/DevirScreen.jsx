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
// They are read on arrival, again after every write — landed, refused or unanswered — and on «Yenile», which shows
// when they were last read; never on a timer: there is no rail badge in this slice (D9), so nothing polls. A write
// that took away the button it was pressed on hands the focus to that row's list, never to <body>.
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
import { Alert, Announce, Button, Empty, Note, StatusPill, riskStyle, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { dayStamp } from "../../i18n/dates.js";
import { boardKnown, useBoardNow } from "../common/BoardState.jsx";
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
 *  (nothing could be read), "stale" (a read again failed; the last lists stand). `readAt`: when the lists on screen
 *  were read (this browser's clock), or null. */
function useHandovers() {
  const { store } = useSession();
  const [state, setState] = useState({ phase: "loading", boxes: null, error: null, readAt: null });
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
      if (mounted.current && mine === seq.current) {
        setState({ phase: "known", boxes: { incoming, outgoing }, error: null, readAt: Date.now() });
      }
    } catch (error) {
      if (mounted.current && mine === seq.current) {
        setState((prev) => ({ ...prev, phase: prev.boxes ? "stale" : "failed", error }));
      }
    } finally {
      if (mounted.current && mine === seq.current) setReading(false);
    }
  }, [store]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reading, reload };
}

/** The bed and the name as the prototype's card heads them: the bed in the brand colour (linked to the
 *  patient, `#/patients/{board_key}`), the name beside it. */
function PatientLine({ row }) {
  const p = patientOf(row);
  const subject = subjectOf(row);
  return (
    <p className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 leading-[normal]">
      {p?.board_key ? (
        <a href={`#/patients/${encodeURIComponent(p.board_key)}`} className={`rounded-md font-data text-15 font-bold text-pri hover:underline ${FOCUS_RING}`}>
          {subject}
        </a>
      ) : <span className="font-data text-15 font-bold text-pri">{subject}</span>}
      {p?.display_name ? <span className="font-display text-15 font-bold text-ink">{p.display_name}</span> : null}
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
    <p className="m-0 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-12.5 text-mute">
      {pill ? (
        <StatusPill tone={STATUS_TONES[status] ?? "att"}>
          {STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : <span className="font-data">{String(status ?? "—")}</span>}
        </StatusPill>
      ) : null}
      <span>{t("devir.fromTo", { from: row.outgoing?.name || "—", to: row.incoming?.name || "—" })}</span>
      {row.status === "COMPLETED" && countersigned !== null ? (
        <span>{t("devir.countersignedAt", { time: dayStamp(countersigned, nowMs) })}</span>
      ) : row.status === "OUTGOING_SIGNED" && signed !== null ? (
        <span>{t("devir.signedAt", { time: dayStamp(signed, nowMs) })}</span>
      ) : null}
    </p>
  );
}

/** The sealed D-Ö-D-Ö note as the prototype prints it: one line per written part, its initial in front
 *  (the page's foot says what the letters stand for), the full word kept for a screen reader (D5). */
function NoteView({ note }) {
  const { t } = useI18n();
  const parts = NOTE_PARTS.filter((part) => typeof note?.[part] === "string" && note[part].trim() !== "");
  if (parts.length === 0) return <p className="m-0 text-13 text-mute">{t("devir.noNote")}</p>;
  return (
    <dl aria-label={t("devir.noteLegend")} className="m-0 grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-13">
      {parts.map((part) => (
        <React.Fragment key={part}>
          <dt className="font-bold text-ink" title={t(`devir.part.${part}`)}>
            <span aria-hidden="true">{t(`devir.part.${part}`).charAt(0)}</span>
            <span className="sr-only">{t(`devir.part.${part}`)}</span>
          </dt>
          <dd className="m-0 whitespace-pre-wrap break-words text-ink">{note[part]}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** One term of the summary and its value, laid side by side (the prototype prints the summary as one line). */
function Item({ label, children }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="whitespace-nowrap text-mute">{label}</dt>
      <dd className="m-0 text-ink">{children}</dd>
    </div>
  );
}

/** A value of the summary with its unit, or a dash for one the board did not have. */
function Reading({ value, unit }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return <><b className="font-data">{value}</b> {unit}</>;
}

/** What the board showed at the outgoing signature (D6): each value under its own name — laid out as the
 *  prototype's one line, read as a list of terms — with the moment it was taken, and the way to the present. */
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
    <section className="min-w-0 text-13">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <h3 className="m-0 text-11 font-bold uppercase tracking-[.06em] text-mute">{t("devir.summaryTitle")}</h3>
        {at !== null ? <span className="text-11.5 text-mute">{t("devir.summaryAt", { time: dayStamp(at, nowMs) })}</span> : null}
      </div>
      {!measured ? <p className="m-0 text-13 text-mute">{t("devir.summaryNone")}</p> : (
        <dl className="m-0 flex flex-wrap gap-x-3.5 gap-y-1">
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
          className={`mt-1 inline-block rounded-md text-12.5 font-semibold text-pri underline ${FOCUS_RING}`}>
          {t("devir.summaryNow")}
        </a>
      ) : null}
    </section>
  );
}

/** «Hastayı aç»: the patient now (the summary above is the seal's moment). */
function OpenPatient({ boardKey }) {
  const { t } = useI18n();
  if (!boardKey) return null;
  return (
    <a href={`#/patients/${encodeURIComponent(boardKey)}`}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-line2 bg-card px-[9px] py-[5px] text-12 font-semibold leading-[normal] text-ink hover:border-pri ${FOCUS_RING}`}>
      {t("devir.openPatient")}
    </a>
  );
}

/** The prototype's handover card: the patient and, at the right, who hands over; then what is handed. */
function Card({ head, meta, children }) {
  return (
    <li className="rounded-[14px] border border-line bg-card px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">{head}</div>
        {meta}
      </div>
      <div className="grid gap-2">{children}</div>
    </li>
  );
}

/** Handed to me and signed: read the note and the summary, then countersign. */
function ToCountersignRow({ row, nowMs, busy, onCountersign }) {
  const { t } = useI18n();
  const p = patientOf(row);
  return (
    <Card head={<PatientLine row={row} />} meta={<Meta row={row} nowMs={nowMs} pill={false} />}>
      <SummaryView summary={row.summary} boardKey={p?.board_key} nowMs={nowMs} />
      <NoteView note={row.note} />
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Button variant="primary" size="sm" busy={busy} onClick={() => onCountersign(row)}
          aria-label={t("devir.countersignLabel", { subject: subjectOf(row) })}>
          {t("devir.countersign")}
        </Button>
      </div>
    </Card>
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
    <Card head={<PatientLine row={row} />} meta={<Meta row={row} nowMs={nowMs} />}>
      {expired ? <p className="m-0 text-13 font-semibold text-att-ink">{t("devir.expiredOpen")}</p> : null}
      {locked ? (
        <Note icon="lock">
          <span id={lockId}>{t("devir.lock")}</span>{" "}
          <a href="#/alarms" className={`rounded-md underline ${FOCUS_RING}`}>{t("devir.toAlarms")}</a>
        </Note>
      ) : null}
      {/* A note the server already holds for an OPEN one is what «İmzala» will sign: she sees it first. */}
      {signable && noteValid(row.note) ? <NoteView note={row.note} /> : null}
      {signable || p?.board_key ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {signable ? (
            <Button variant="primary" size="sm" busy={busy}
              aria-disabled={locked ? "true" : undefined} aria-describedby={locked ? lockId : undefined}
              aria-label={t("devir.signLabel", { subject: subjectOf(row) })}
              onClick={() => { if (!locked) onSign(row); }}>
              {t("devir.sign")}
            </Button>
          ) : null}
          <OpenPatient boardKey={p?.board_key} />
        </div>
      ) : null}
    </Card>
  );
}

/** Completed or expired, in the last 24 hours. */
function RecentRow({ row, nowMs }) {
  return <Card head={<PatientLine row={row} />} meta={<Meta row={row} nowMs={nowMs} />}>{null}</Card>;
}

/** One list under the prototype's .sec heading — the title at the left, how many at the right — named by
 *  it for a screen reader's landmarks. `items` null: not read yet. `sectionRef`: where the focus goes when
 *  a write took away the button it was on (it shows the ring, as Taburcu's list does). `note`: a line above
 *  the list. */
function Section({ titleKey, icon, items, emptyKey, renderRow, sectionRef, note = null, aside = null }) {
  const { t } = useI18n();
  const titleId = useId();
  let body;
  if (items === null) body = <p className="m-0 text-13 text-mute">{t("devir.loading")}</p>;
  else if (items.length === 0) body = <Empty icon={icon}>{t(emptyKey)}</Empty>;
  else body = <ul className="m-0 flex list-none flex-col gap-3 p-0">{items.map(renderRow)}</ul>;
  return (
    <section ref={sectionRef} tabIndex={sectionRef ? -1 : undefined} aria-labelledby={titleId}
      className={`min-w-0 ${sectionRef ? `rounded-box ${FOCUS_RING}` : ""}`}>
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h2 id={titleId} className="m-0 font-display text-14 font-bold leading-[normal]">{t(titleKey)}</h2>
        <small className="text-12 font-medium text-mute">
          {aside ?? (Array.isArray(items) && items.length ? t("devir.patientCount", { count: items.length }) : null)}
        </small>
      </div>
      {note}{body}
    </section>
  );
}

export function DevirScreen() {
  const { t } = useI18n();
  const board = useBoard();
  const { store } = useSession();
  const toast = useToast();
  const nowMs = useBoardNow(TICK_MS);
  const { phase, boxes, error, reading, readAt, reload } = useHandovers();
  const [dialog, setDialog] = useState(null);           // null, or {handover}: null for «Yeni devir», a row to sign
  const [busyId, setBusyId] = useState(null);           // the handover a write is out for — one at a time
  const groups = useMemo(() => (boxes ? groupHandovers(boxes) : null), [boxes]);
  // My OPEN handovers still inside their bridge: the ones a new handover of the same patient would duplicate.
  const signableOpen = (groups?.mineOpen ?? []).filter((row) => !bridgeExpired(row, nowMs));

  // A write that took away the button it was pressed on — a countersigned row leaves its list, a signed one loses
  // its «İmzala» — leaves the focus on <body>. It goes to that row's list instead, and only from there: a focus she
  // has moved on is hers (Taburcu's `refocus`, Hasta Kabul's `focusIsIdle`; review 7).
  const toCountersignRef = useRef(null);
  const mineRef = useRef(null);
  const [refocus, setRefocus] = useState(null);         // {to: "toCountersign" | "mine", n}
  useEffect(() => {
    if (!refocus) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    (refocus.to === "toCountersign" ? toCountersignRef : mineRef).current?.focus();
  }, [refocus]);
  const focusList = (to) => setRefocus((prev) => ({ to, n: (prev?.n ?? 0) + 1 }));

  /** One write from a row: its answer on the toast, naming the bed, then the lists read again (held till then), and
   *  the focus kept on the row's list. */
  async function write(row, call, doneKey, refusedKey, list) {
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
      focusList(list);
    }
  }

  const countersign = (row) => write(row, () => store.api.countersignHandover(row.id),
    "devir.countersigned", "devir.countersignRefused", "toCountersign");
  // A note the server would take is signed as it is; otherwise the note step.
  const sign = (row) => (noteValid(row.note)
    ? write(row, () => store.api.signHandover(row.id, noteBody(row.note)), "devir.signed", "devir.signRefused", "mine")
    : setDialog({ handover: row }));
  // Closed after its write, the dialog's opener may be gone with the row it was on: the focus goes to my list.
  const closeDialog = () => {
    setDialog(null);
    focusList("mine");
  };

  const rowBusy = (row) => busyId === row.id;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* The prototype's .ph. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 font-display text-23 font-bold leading-[1.1]">{t("devir.title")}</h1>
          <p className="m-0 mt-1 text-13 text-mute">{t("devir.intro")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* A refresh by hand, and when the lists were read: nothing reads them on a timer (no rail badge, D9). */}
          {readAt !== null ? <span className="text-12.5 text-mute">{t("devir.readAt", { time: dayStamp(readAt, nowMs) })}</span> : null}
          {readAt !== null ? <Button busy={reading} onClick={reload}>{t("devir.refresh")}</Button> : null}
          <Button variant="primary" icon="plus" onClick={() => setDialog({ handover: null })}>{t("devir.newHandover")}</Button>
        </div>
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
          {/* The prototype's two columns: what waits for me at the left, what I handed over at the right. */}
          <div className="mt-1 grid items-start gap-3 min-[1100px]:grid-cols-2">
          <Section
            titleKey="devir.toCountersignTitle" icon="clip" items={groups?.toCountersign ?? null} emptyKey="devir.toCountersignEmpty"
            sectionRef={toCountersignRef}
            renderRow={(row) => <ToCountersignRow key={row.id} row={row} nowMs={nowMs} busy={rowBusy(row)} onCountersign={countersign} />}
          />
          <Section
            titleKey="devir.mineTitle" icon="swap" items={groups ? [...groups.mineOpen, ...groups.mineWaiting] : null}
            emptyKey="devir.mineEmpty" sectionRef={mineRef}
            // The rows' lock reads the board: one that is not LIVE rules no alarm out (review 8).
            note={signableOpen.length > 0 && !boardKnown(board.connection)
              ? <Note tone="info" icon="eye" className="mb-2">{t("devir.boardNotLive")}</Note> : null}
            renderRow={(row) => <MineRow key={row.id} row={row} nowMs={nowMs} board={board} busy={rowBusy(row)} onSign={sign} />}
          />
          </div>
          <Section
            titleKey="devir.recentTitle" icon="clock" items={groups?.recent ?? null} emptyKey="devir.recentEmpty"
            renderRow={(row) => <RecentRow key={row.id} row={row} nowMs={nowMs} />}
          />
          {/* The prototype's legend for the note's letters. */}
          <p className="m-0 text-12 text-mute">
            {`${NOTE_PARTS.map((part) => t(`devir.part.${part}`).charAt(0)).join("-")}: ${NOTE_PARTS.map((part) => t(`devir.part.${part}`).split(" · ").pop()).join(" · ")}`}
          </p>
        </>
      )}

      {/* A busy button reads only "unavailable"; the words come from here. */}
      <Announce text={busyId !== null ? t("devir.sending") : ""} />
      <NewHandoverDialog open={dialog !== null} handover={dialog?.handover ?? null} mineOpen={signableOpen}
        onClose={closeDialog} onWritten={reload} />
    </div>
  );
}

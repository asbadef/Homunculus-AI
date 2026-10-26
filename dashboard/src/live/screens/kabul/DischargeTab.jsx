// src/live/screens/kabul/DischargeTab.jsx — "Taburcu" (Group 2 · B1a, spec §3.3, §5.3). Two lists
// of the caller's units: the discharges a physician has started, awaiting the charge nurse's
// "Hasta çıktı · onayla", and the patients lying in. A physician (`admissions.move.initiate`)
// starts a discharge from the second; a DRAFT is signed first (the strip on the patient screen).
//
// "Taburcuyu başlat" is held, with the reason in words, while the board shows this patient a
// critical alarm nobody acknowledged — and while the board has not loaded yet (connecting) or
// could not (unavailable): an empty board that never loaded rules no alarm out. A DEGRADED board
// holds by the alarms it last had. A session without `board.view` has no board to wait for, so it
// reads a note instead of a hold that would never lift. All of it is a hint read from the same
// board the clinician sees; the server refuses anyway (BoardLink.open_critical), on the toast.
//
// "Hasta çıktı · onayla" cannot be undone — the card leaves every screen, the bed goes to
// cleaning — so it asks once more, naming the bed and the patient number. The confirmation is held
// the same way as the start, and refused by the server the same way (the user's decision, A-32: an
// exitus too): a critical alarm nobody acknowledged must be acknowledged first, and the words say
// that — not that a discharge cannot START. The list is read again every minute while the tab is
// open, and after every write, landed or refused.
//
// WHAT A CONFIRMATION LEFT UNDONE (A-30, A-32). The discharge stands whatever its answer says beyond
// it, on the toast and in a note that stays: the card did not leave the board (`board: failed`;
// `alerts: failed` happens only with it, and reads the same), or the alarms' close-out record is
// incomplete (`alerts: incomplete` — the system administrator's). A card still on the board can be
// taken off it again from its note: the same confirmation for that admission, which the server runs
// again on a DISCHARGED one; one retry is out at a time, and the note goes when it lands.
//
// A write's dialog stays open and held until that re-read is in (A-17): until then the list still
// shows the admission as it was, and a press in the gap would send the same write twice. The bed is
// named as the slice names it, "label · room · unit" (A-17, A-22), on the dialog, the toast and the
// note. And when the re-read takes away the button the write was sent from — a started discharge
// moves up, a confirmed one goes — the focus that fell with it goes to the started discharges'
// list, never left on <body> (spec §5.7).
import React, { useEffect, useId, useRef, useState } from "react";
import { CONNECTION } from "../../../liveConnection.js";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Empty, Modal, Note, Tag, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { ddmm, hhmm } from "../../i18n/dates.js";
import { doneFor, reasonOf, refusedFor } from "../admin/refusal.js";
import { DISPOSITIONS, DischargeDialog } from "./DischargeDialog.jsx";
import { useAdmissions } from "./useAdmissions.js";

const STATES = ["DRAFT", "ACTIVE", "PENDING_DISCHARGE"];
const EVERY_MS = 60_000;
/** The bed as the slice names it — the subject of every toast, dialog and note here. */
const bedOf = (row) => `${row.bed_label} · ${row.room_name} · ${row.unit_name}`;
/** Why a step's button is held, by what the board shows: not loaded, or a critical alarm open. */
const HOLDS = {
  start: { unknown: "kabul.alarmStateUnknown", critical: "kabul.criticalOpen" },
  confirm: { unknown: "kabul.alarmStateUnknownConfirm", critical: "kabul.criticalOpenConfirm" },
};
const CRITICAL_HOLDS = new Set([HOLDS.start.critical, HOLDS.confirm.critical]);
/** What a confirmation's answer says beyond "discharged": `board` (the card did not leave it; the
 *  alarms' retirement fails only with it), `alerts` (their close-out record is incomplete), or `ok`. */
const outcomeOf = (answer) => (answer?.board === "failed" || answer?.alerts === "failed" ? "board"
  : answer?.alerts === "incomplete" ? "alerts" : "ok");
const OUTCOME_TEXT = { ok: "kabul.discharged", board: "kabul.dischargedBoardFailed", alerts: "kabul.dischargedAlertsIncomplete" };
const dispositionKey = (value) => DISPOSITIONS.find((d) => d.value === value)?.key ?? null;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
/** When a discharge was decided: its time, and its date as well unless that is today. */
const whenOf = (ms) => (sameDay(ms, Date.now()) ? hhmm(ms) : `${ddmm(ms)} ${hhmm(ms)}`);

/** One admission, its bed line first. `children(line)` draws the row's actions; each is described
 *  by `line`, the bed line's id, so a button named "start discharge" also says whose. */
function Row({ row, children }) {
  const { t } = useI18n();
  const line = useId();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-ctl border border-line bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p id={line} className="m-0 text-14 font-semibold">
          <span className="font-data">{row.bed_label}</span> · {row.room_name} · {row.unit_name}
        </p>
        <p className="m-0 text-13 text-mute">
          {row.display_name} · <span className="font-data">{row.patient_number}</span>
          {row.state === "DRAFT" ? <> · <Tag tone="warn">{t("kabul.badgeDraft")}</Tag></> : null}
        </p>
      </div>
      {children(line)}
    </li>
  );
}

/** A row's action, held while `hold` names a reason: aria-disabled, never disabled — it keeps its
 *  focus — and described by the row's bed line and the reason under it; a press then does nothing. */
function RowAction({ line, hold, onPress, children, ...button }) {
  const { t } = useI18n();
  return (
    <div className="grid justify-items-end gap-1">
      <Button {...button} aria-disabled={hold ? "true" : undefined}
        aria-describedby={hold ? `${line} ${line}-hold` : line}
        onClick={() => { if (!hold) onPress(); }}>
        {children}
      </Button>
      {hold ? (
        <p id={`${line}-hold`} className={`m-0 text-12 font-semibold ${CRITICAL_HOLDS.has(hold) ? "text-crit-ink" : "text-mute"}`}>
          {t(hold)}
        </p>
      ) : null}
    </div>
  );
}

/** What a confirmation left undone, kept until it is done; a card still on the board offers the
 *  retry (`onRetry`, for a holder of the confirmation's right), described by the note's own words —
 *  and, while another note's retry is out, held, described by `heldBy` too (the one being retried). */
function UndoneNote({ undone, retrying, heldBy, onRetry }) {
  const { t } = useI18n();
  const said = useId();
  const held = retrying !== null && retrying !== undone.id;
  return (
    <Note icon="alert">
      <span id={said}>{doneFor(t, undone.subject, t(OUTCOME_TEXT[undone.kind]))}</span>
      {undone.kind === "board" && onRetry ? (
        <span className="mt-1.5 block">
          <Button size="sm" aria-describedby={held ? `${said} ${heldBy}` : said} busy={retrying === undone.id}
            aria-disabled={held ? "true" : undefined} onClick={() => onRetry(undone)}>
            {t("kabul.retryBoard")}
          </Button>
        </span>
      ) : null}
    </Note>
  );
}

export function DischargeTab() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const board = useBoard();
  const { reload: reloadStructure } = useStructure();
  const toast = useToast();
  const { rows, phase, error, reload } = useAdmissions(STATES, { every: EVERY_MS });
  const [starting, setStarting] = useState(null);
  const [leaving, setLeaving] = useState(null);       // the started discharge being confirmed
  const [confirming, setConfirming] = useState(false);
  const [undone, setUndone] = useState([]);           // confirmed, with something left undone: {id, subject, kind}
  const [retrying, setRetrying] = useState(null);     // the admission whose card is being taken off the board again
  const [refocus, setRefocus] = useState(0);          // a write's dialog closed: where did its focus go?
  const pendingRef = useRef(null);
  const pendingTitle = useId();                       // each section is named by its Box's own heading
  const lyingTitle = useId();
  const retryHeld = useId();                          // why the other notes' retry waits
  useEffect(() => {
    if (!refocus) return;
    const active = document.activeElement;
    if (!active || active === document.body) pendingRef.current?.focus();
  }, [refocus]);
  const can = (key) => user?.perms?.includes(key) ?? false;
  const starts = can("admissions.move.initiate");
  const confirms = can("admissions.discharge.confirm");
  const seesBoard = can("board.view");
  // A board that never loaded, or whose load failed, is empty and rules no alarm out.
  const known = board.loaded === true && board.connection !== CONNECTION.UNAVAILABLE;
  const criticalOpen = (number) => board.alerts.some((a) => a.patientId === number
    && a.severity === "critical" && a.status !== "ACKNOWLEDGED");
  /** Why this patient's "Taburcuyu başlat" (`start`) or "Hasta çıktı · onayla" (`confirm`) is held,
   *  as a key — or null. */
  const holdOf = (number, step) => {
    if (!seesBoard) return null;
    if (!known) return HOLDS[step].unknown;
    return criticalOpen(number) ? HOLDS[step].critical : null;
  };
  /** A refused confirmation's reason: an open critical alarm is said as the confirmation's own. */
  const confirmReason = (err) => (err?.apiCode === "critical_alarm_open"
    ? t("kabul.err.criticalAlarmOpenAtConfirm") : reasonOf(t, err));
  /** Say what a confirmation's answer left undone, and keep it in a note until it is done. */
  function noteOutcome(id, subject, kind) {
    setUndone((prev) => [...prev.filter((n) => n.id !== id), ...(kind === "ok" ? [] : [{ id, subject, kind }])]);
  }

  async function confirm(row) {
    if (confirming) return;
    setConfirming(true);
    try {
      const outcome = outcomeOf(await store.track(() => store.api.confirmDischarge(row.id)));
      toast(doneFor(t, bedOf(row), t(OUTCOME_TEXT[outcome])), outcome === "ok" ? "ok" : "warn");
      noteOutcome(row.id, bedOf(row), outcome);
    } catch (err) {
      toast(refusedFor(t, bedOf(row), confirmReason(err)), "error");
    } finally {
      reloadStructure();
      await reload();                                 // held until the list says what the write did
      setConfirming(false);
      setLeaving(null);
      setRefocus((n) => n + 1);
    }
  }

  /** A card that did not leave the board, taken off it again: the same confirmation, which the server
   *  runs again on a DISCHARGED admission (A-32). Its note goes when the card has gone. */
  async function retry(n) {
    if (retrying !== null) return;
    setRetrying(n.id);
    try {
      const outcome = outcomeOf(await store.track(() => store.api.confirmDischarge(n.id)));
      toast(doneFor(t, n.subject, t(outcome === "ok" ? "kabul.boardCleared" : OUTCOME_TEXT[outcome])), outcome === "ok" ? "ok" : "warn");
      noteOutcome(n.id, n.subject, outcome);
    } catch (err) {
      toast(refusedFor(t, n.subject, confirmReason(err)), "error");
    } finally {
      await reload();                                 // a refusal says the list was read again: it is
      setRetrying(null);
      setRefocus((k) => k + 1);
    }
  }

  /** A discharge started from the dialog: the dialog stays held until the list is read again. */
  async function started() {
    reloadStructure();
    await reload();
    setStarting(null);
    setRefocus((n) => n + 1);
  }

  if (phase === "unasked") return <Note tone="info" icon="eye">{t("kabul.noView")}</Note>;
  const retried = undone.find((n) => n.id === retrying);
  const retryingText = retried ? t("kabul.retryingBoard", { bed: retried.subject }) : "";
  const pending = (rows ?? []).filter((r) => r.state === "PENDING_DISCHARGE");
  const lying = (rows ?? []).filter((r) => r.state === "DRAFT" || r.state === "ACTIVE");
  // "Loading" only while the first read is on its way: after a failed one the Alert says why.
  const loading = phase === "loading" ? <p className="m-0 text-13 text-mute">{t("kabul.loading")}</p> : null;
  return (
    <div className="grid gap-3">
      {error ? <Alert tone="crit">{t(phase === "stale" ? "kabul.listStale" : "kabul.listFailed", { reason: readErrorText(t, error) })}</Alert> : null}
      {undone.map((n) => <UndoneNote key={n.id} undone={n} retrying={retrying} heldBy={retryHeld} onRetry={confirms ? retry : null} />)}
      {retried ? <span id={retryHeld} className="sr-only">{retryingText}</span> : null}
      <Announce text={retryingText} />
      {/* Where the focus lands after a write (refocus): it shows the ring, as the strip's line does. */}
      <section ref={pendingRef} tabIndex={-1} aria-labelledby={pendingTitle} className={`rounded-box ${FOCUS_RING}`}>
      <Box title={<span id={pendingTitle}>{t("kabul.pendingTitle")}</span>} icon="out" level={2}>
        {confirms && !seesBoard ? <Note tone="info" icon="eye" className="mb-2">{t("kabul.alarmStateNoBoardConfirm")}</Note> : null}
        {rows === null ? loading : pending.length === 0 ? <Empty icon="out">{t("kabul.pendingNone")}</Empty> : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {pending.map((row) => (
              <Row key={row.id} row={row}>
                {(line) => (
                  <>
                    <p className="m-0 text-12.5 text-mute">
                      {dispositionKey(row.discharge_disposition) ? t(dispositionKey(row.discharge_disposition)) : ""}
                      {row.discharge_institution ? ` · ${row.discharge_institution}` : ""}
                      {row.discharge_at ? ` · ${whenOf(Date.parse(row.discharge_at))}` : ""}
                    </p>
                    {confirms ? (
                      <RowAction line={line} hold={holdOf(row.patient_number, "confirm")} variant="primary" icon="ok"
                        busy={confirming && leaving?.id === row.id} onPress={() => setLeaving(row)}>
                        {t("kabul.confirmLeft")}
                      </RowAction>
                    ) : null}
                  </>
                )}
              </Row>
            ))}
          </ul>
        )}
      </Box>
      </section>
      <section aria-labelledby={lyingTitle}>
      <Box title={<span id={lyingTitle}>{t("kabul.lyingTitle")}</span>} icon="bed" level={2}>
        {starts && !seesBoard ? <Note tone="info" icon="eye" className="mb-2">{t("kabul.alarmStateNoBoard")}</Note> : null}
        {rows === null ? loading : lying.length === 0 ? <Empty icon="bed">{t("kabul.lyingNone")}</Empty> : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {lying.map((row) => (
              <Row key={row.id} row={row}>
                {(line) => (row.state === "DRAFT" ? <p className="m-0 text-12.5 text-mute">{t("kabul.signFirst")}</p>
                  : starts ? (
                    <RowAction line={line} hold={holdOf(row.patient_number, "start")} icon="out" onPress={() => setStarting(row)}>
                      {t("kabul.startDischarge")}
                    </RowAction>
                  ) : null)}
              </Row>
            ))}
          </ul>
        )}
      </Box>
      </section>
      {starting ? (
        <DischargeDialog row={starting} subject={bedOf(starting)} onClose={() => setStarting(null)}
          onDone={started} onRefused={() => reload()} />
      ) : null}
      {leaving ? (
        <Modal open title={t("kabul.confirmLeftTitle")} onClose={() => setLeaving(null)} busy={confirming}
          actions={(
            <>
              <Button onClick={() => setLeaving(null)} busy={confirming}>{t("common.cancel")}</Button>
              <Button variant="primary" icon="ok" busy={confirming} onClick={() => confirm(leaving)}>{t("kabul.confirmLeft")}</Button>
            </>
          )}>
          <p className="m-0 text-14">{t("kabul.confirmLeftBody", { bed: bedOf(leaving), number: leaving.patient_number })}</p>
        </Modal>
      ) : null}
    </div>
  );
}

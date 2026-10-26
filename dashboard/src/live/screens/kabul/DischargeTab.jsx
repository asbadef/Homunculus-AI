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
// cleaning — so it asks once more, naming the bed and the patient number. A confirmation whose
// card did not leave the board says so on the toast and in a note that stays. The list is read
// again every minute while the tab is open, and after every write, landed or refused.
import React, { useId, useState } from "react";
import { CONNECTION } from "../../../liveConnection.js";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, Empty, Modal, Note, Tag, useToast } from "../../ui/index.js";
import { ddmm, hhmm } from "../../i18n/dates.js";
import { doneFor, reasonOf, refusedFor } from "../admin/refusal.js";
import { DISPOSITIONS, DischargeDialog } from "./DischargeDialog.jsx";
import { useAdmissions } from "./useAdmissions.js";

const STATES = ["DRAFT", "ACTIVE", "PENDING_DISCHARGE"];
const EVERY_MS = 60_000;
const subjectOf = (row) => `${row.bed_label} · ${row.unit_name}`;
const bedOf = (row) => `${row.bed_label} · ${row.room_name} · ${row.unit_name}`;
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
  const [notLeft, setNotLeft] = useState([]);         // confirmed, whose card did not leave the board
  const can = (key) => user?.perms?.includes(key) ?? false;
  const starts = can("admissions.move.initiate");
  const seesBoard = can("board.view");
  // A board that never loaded, or whose load failed, is empty and rules no alarm out.
  const known = board.loaded === true && board.connection !== CONNECTION.UNAVAILABLE;
  const criticalOpen = (number) => board.alerts.some((a) => a.patientId === number
    && a.severity === "critical" && a.status !== "ACKNOWLEDGED");
  /** Why this patient's "Taburcuyu başlat" is held, as a key — or null. */
  const holdOf = (number) => {
    if (!seesBoard) return null;
    if (!known) return "kabul.alarmStateUnknown";
    return criticalOpen(number) ? "kabul.criticalOpen" : null;
  };

  async function confirm(row) {
    if (confirming) return;
    setConfirming(true);
    try {
      const answer = await store.track(() => store.api.confirmDischarge(row.id));
      const failed = answer?.board === "failed";
      toast(doneFor(t, subjectOf(row), t(failed ? "kabul.dischargedBoardFailed" : "kabul.discharged")), failed ? "warn" : "ok");
      if (failed) setNotLeft((prev) => [...prev.filter((n) => n.id !== row.id), { id: row.id, subject: subjectOf(row) }]);
    } catch (err) {
      toast(refusedFor(t, subjectOf(row), reasonOf(t, err)), "error");
    } finally {
      setConfirming(false);
      setLeaving(null);
      reload();
      reloadStructure();
    }
  }

  if (phase === "unasked") return <Note tone="info" icon="eye">{t("kabul.noView")}</Note>;
  const pending = (rows ?? []).filter((r) => r.state === "PENDING_DISCHARGE");
  const lying = (rows ?? []).filter((r) => r.state === "DRAFT" || r.state === "ACTIVE");
  // "Loading" only while the first read is on its way: after a failed one the Alert says why.
  const loading = phase === "loading" ? <p className="m-0 text-13 text-mute">{t("kabul.loading")}</p> : null;
  return (
    <div className="grid gap-3">
      {error ? <Alert tone="crit">{t(phase === "stale" ? "kabul.listStale" : "kabul.listFailed", { reason: readErrorText(t, error) })}</Alert> : null}
      {notLeft.map((n) => <Note key={n.id} icon="alert">{doneFor(t, n.subject, t("kabul.dischargedBoardFailed"))}</Note>)}
      <section aria-label={t("kabul.pendingTitle")}>
      <Box title={t("kabul.pendingTitle")} icon="out" level={2}>
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
                    {can("admissions.discharge.confirm") ? (
                      <Button variant="primary" icon="ok" aria-describedby={line} busy={confirming && leaving?.id === row.id}
                        onClick={() => setLeaving(row)}>
                        {t("kabul.confirmLeft")}
                      </Button>
                    ) : null}
                  </>
                )}
              </Row>
            ))}
          </ul>
        )}
      </Box>
      </section>
      <section aria-label={t("kabul.lyingTitle")}>
      <Box title={t("kabul.lyingTitle")} icon="bed" level={2}>
        {starts && !seesBoard ? <Note tone="info" icon="eye" className="mb-2">{t("kabul.alarmStateNoBoard")}</Note> : null}
        {rows === null ? loading : lying.length === 0 ? <Empty icon="bed">{t("kabul.lyingNone")}</Empty> : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {lying.map((row) => {
              const hold = holdOf(row.patient_number);
              return (
                <Row key={row.id} row={row}>
                  {(line) => (row.state === "DRAFT" ? <p className="m-0 text-12.5 text-mute">{t("kabul.signFirst")}</p>
                    : starts ? (
                      <div className="grid justify-items-end gap-1">
                        <Button icon="out" aria-disabled={hold ? "true" : undefined}
                          aria-describedby={hold ? `${line} ${line}-hold` : line}
                          onClick={() => { if (!hold) setStarting(row); }}>
                          {t("kabul.startDischarge")}
                        </Button>
                        {hold ? (
                          <p id={`${line}-hold`} className={`m-0 text-12 font-semibold ${hold === "kabul.criticalOpen" ? "text-crit-ink" : "text-mute"}`}>
                            {t(hold)}
                          </p>
                        ) : null}
                      </div>
                    ) : null)}
                </Row>
              );
            })}
          </ul>
        )}
      </Box>
      </section>
      {starting ? (
        <DischargeDialog row={starting} subject={subjectOf(starting)} onClose={() => setStarting(null)}
          onDone={() => { setStarting(null); reload(); reloadStructure(); }} onRefused={() => reload()} />
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

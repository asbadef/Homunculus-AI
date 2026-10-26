// src/live/screens/kabul/DischargeTab.jsx — "Taburcu" (Group 2 · B1a, spec §3.3, §5.3). Two lists
// of the caller's units: the discharges a physician has started, awaiting the charge nurse's
// "Hasta çıktı · onayla", and the patients lying in. A physician (`admissions.move.initiate`)
// starts a discharge from the second; a DRAFT is signed first (the strip on the patient screen).
//
// "Taburcuyu başlat" is held, with the reason in words, while the board shows this patient a
// critical alarm nobody acknowledged — a hint read from the same board the clinician sees; the
// server refuses it anyway (BoardLink.open_critical) and that refusal goes on the toast.
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, Empty, Note, Tag, useToast } from "../../ui/index.js";
import { hhmm } from "../../i18n/dates.js";
import { doneFor } from "../admin/refusal.js";
import { DISPOSITIONS, DischargeDialog, refusedDischarge } from "./DischargeDialog.jsx";
import { useAdmissions } from "./useAdmissions.js";

const STATES = ["DRAFT", "ACTIVE", "PENDING_DISCHARGE"];
const subjectOf = (row) => `${row.bed_label} · ${row.unit_name}`;
const dispositionKey = (value) => DISPOSITIONS.find((d) => d.value === value)?.key ?? null;

function Row({ row, children }) {
  const { t } = useI18n();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-ctl border border-line bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-14 font-semibold">
          <span className="font-data">{row.bed_label}</span> · {row.room_name} · {row.unit_name}
        </p>
        <p className="m-0 text-13 text-mute">
          {row.display_name} · <span className="font-data">{row.patient_number}</span>
          {row.state === "DRAFT" ? <> · <Tag tone="warn">{t("kabul.badgeDraft")}</Tag></> : null}
        </p>
      </div>
      {children}
    </li>
  );
}

export function DischargeTab() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const board = useBoard();
  const { reload: reloadStructure } = useStructure();
  const toast = useToast();
  const { rows, phase, error, reload } = useAdmissions(STATES);
  const [starting, setStarting] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const can = (key) => user?.perms?.includes(key) ?? false;
  const criticalOpen = (number) => board.alerts.some((a) => a.patientId === number
    && a.severity === "critical" && a.status !== "ACKNOWLEDGED");

  async function confirm(row) {
    if (confirming) return;
    setConfirming(row.id);
    try {
      const answer = await store.track(() => store.api.confirmDischarge(row.id));
      toast(doneFor(t, subjectOf(row), t(answer?.board === "failed" ? "kabul.dischargedBoardFailed" : "kabul.discharged")),
        answer?.board === "failed" ? "warn" : "ok");
    } catch (err) {
      toast(refusedDischarge(t, subjectOf(row), err), "error");
    } finally {
      setConfirming(null);
      reload();
      reloadStructure();
    }
  }

  if (phase === "unasked") return <Note tone="info" icon="eye">{t("kabul.noView")}</Note>;
  const pending = (rows ?? []).filter((r) => r.state === "PENDING_DISCHARGE");
  const lying = (rows ?? []).filter((r) => r.state === "DRAFT" || r.state === "ACTIVE");
  return (
    <div className="grid gap-3">
      {error ? <Alert tone="crit">{t(phase === "stale" ? "kabul.listStale" : "kabul.listFailed", { reason: readErrorText(t, error) })}</Alert> : null}
      <section aria-label={t("kabul.pendingTitle")}>
      <Box title={t("kabul.pendingTitle")} icon="out" level={2}>
        {rows === null ? <p className="m-0 text-13 text-mute">{t("kabul.loading")}</p>
          : pending.length === 0 ? <Empty icon="out">{t("kabul.pendingNone")}</Empty> : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {pending.map((row) => (
                <Row key={row.id} row={row}>
                  <p className="m-0 text-12.5 text-mute">
                    {dispositionKey(row.discharge_disposition) ? t(dispositionKey(row.discharge_disposition)) : ""}
                    {row.discharge_institution ? ` · ${row.discharge_institution}` : ""}
                    {row.discharge_at ? ` · ${hhmm(Date.parse(row.discharge_at))}` : ""}
                  </p>
                  {can("admissions.discharge.confirm") ? (
                    <Button variant="primary" icon="ok" busy={confirming === row.id} onClick={() => confirm(row)}>
                      {t("kabul.confirmLeft")}
                    </Button>
                  ) : null}
                </Row>
              ))}
            </ul>
          )}
      </Box>
      </section>
      <section aria-label={t("kabul.lyingTitle")}>
      <Box title={t("kabul.lyingTitle")} icon="bed" level={2}>
        {rows === null ? <p className="m-0 text-13 text-mute">{t("kabul.loading")}</p>
          : lying.length === 0 ? <Empty icon="bed">{t("kabul.lyingNone")}</Empty> : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {lying.map((row) => {
                const blocked = criticalOpen(row.patient_number);
                return (
                  <Row key={row.id} row={row}>
                    {row.state === "DRAFT" ? <p className="m-0 text-12.5 text-mute">{t("kabul.signFirst")}</p>
                      : can("admissions.move.initiate") ? (
                        <div className="grid justify-items-end gap-1">
                          <Button icon="out" aria-disabled={blocked ? "true" : undefined}
                            aria-describedby={blocked ? `blocked-${row.id}` : undefined}
                            onClick={() => { if (!blocked) setStarting(row); }}>
                            {t("kabul.startDischarge")}
                          </Button>
                          {blocked ? <p id={`blocked-${row.id}`} className="m-0 text-12 font-semibold text-crit-ink">{t("kabul.criticalOpen")}</p> : null}
                        </div>
                      ) : null}
                  </Row>
                );
              })}
            </ul>
          )}
      </Box>
      </section>
      {starting ? (
        <DischargeDialog row={starting} subject={subjectOf(starting)} onClose={() => setStarting(null)}
          onDone={() => { setStarting(null); reload(); reloadStructure(); }} />
      ) : null}
    </div>
  );
}

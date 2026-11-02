// src/live/screens/patient/VitalsEntry.jsx — «Ölçüm gir» beside the patient screen's measured values (G3-01, D3b):
// the bedside form (bedside/VitalsForm.jsx) in a dialog, for whoever is already on the patient. No identity step:
// the screen's header names the patient. After a save the dialog shows the saved step — «hatalı giriş» per value
// — and «Kapat». The writes go through the board store, bound to the patient shown; the store reloads the board
// after a chart and after a withdrawal.
//
// The screen offers it only to a `clinical.chart` holder (MedsBox's rule: ABSENT, never disabled). The shell keeps
// this screen mounted across a move to another patient (no `key`), so the button remembers WHOSE dialog it opened:
// one opened on one patient is never shown on the next, and a late close from an earlier opening closes nothing
// of a new one. The dialog holds its ✕ while the form has a request in flight (`onBusy`).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { Button, Modal } from "../../ui/index.js";
import { useBoardNow } from "../common/BoardState.jsx";
import { SavedStep } from "../bedside/SavedStep.jsx";
import { VitalsForm } from "../bedside/VitalsForm.jsx";

const TICK_MS = 30_000;

/** `patientId` is the patient shown; `bed` names them in the title and on every toast. */
export function VitalsEntry({ patientId, bed }) {
  const { t } = useI18n();
  const board = useBoard();
  const nowMs = useBoardNow(TICK_MS);
  const [open, setOpen] = useState(null);      // { id, opening, saved? }: whose dialog, which opening, what was saved
  const [busy, setBusy] = useState(false);
  const openings = useRef(0);
  useEffect(() => { setOpen(null); }, [patientId]);
  const onBusy = useCallback((value) => setBusy(value), []);
  const mine = open && open.id === patientId ? open : null;
  const opening = mine?.opening;
  const close = () => setOpen((current) => (current?.opening === opening ? null : current));
  function start() {
    openings.current += 1;
    setBusy(false);
    setOpen({ id: patientId, opening: openings.current });
  }
  return (
    <>
      <Button size="sm" icon="plus" onClick={start}>{t("olcum.entryButton")}</Button>
      {mine ? (
        // `busy` is the FORM's request in flight: it ends with the form. A save that answers batches "no longer
        // busy" with "saved" into one render, in which the form is already gone and can no longer say so, so the
        // saved step would keep its ✕ (and Escape) held for good. Hence `&& !mine.saved`.
        <Modal open title={t("olcum.entryTitle", { bed })} onClose={close} busy={busy && !mine.saved}>
          {mine.saved ? (
            <SavedStep bed={bed} saved={mine.saved} nowMs={nowMs}
              onRetract={(entry, reason) => board.store.retract(patientId, entry, reason)}>
              <Button variant="primary" onClick={close}>{t("common.close")}</Button>
            </SavedStep>
          ) : (
            <VitalsForm
              key={mine.opening} bed={bed} nowMs={nowMs} onBusy={onBusy}
              onPreview={(entries, at) => board.store.chartPreview(patientId, entries, at)}
              onSave={(entries, at) => board.store.chart(patientId, entries, at)}
              onSaved={(saved) => setOpen((current) => (current?.opening === opening ? { ...current, saved } : current))}
              onCancel={close}
            />
          )}
        </Modal>
      ) : null}
    </>
  );
}

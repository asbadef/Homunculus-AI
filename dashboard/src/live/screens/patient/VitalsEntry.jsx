// src/live/screens/patient/VitalsEntry.jsx — «Ölçüm gir» beside the patient screen's measured values (G3-01, D3b):
// the bedside form (bedside/VitalsForm.jsx) in a dialog, for whoever is already on the patient. No identity step:
// the screen's header names the patient. After a save the dialog shows the saved step — «hatalı giriş» per value
// — and «Kapat». The writes go through the board store, bound to the patient shown; the store reloads the board
// after a chart and after a withdrawal.
//
// The screen offers it only to a `clinical.chart` holder (MedsBox's rule: ABSENT, never disabled). The shell keeps
// this screen mounted across a move to another patient (no `key`), so the button remembers WHOSE dialog it opened:
// one opened on one patient is never shown on the next, and a late close from an earlier opening closes nothing
// of a new one. The dialog holds its ✕ while the form has a request in flight (`onBusy`). When a save answers, the
// form gives way to the saved step and the button that had the focus goes with it, so the saved step takes the
// focus (it is the thing she must read next: what was saved, and the «hatalı giriş» per value).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { Button, Modal } from "../../ui/index.js";
import { SavedStep } from "../bedside/SavedStep.jsx";
import { VitalsForm } from "../bedside/VitalsForm.jsx";

/** `patientId` is the patient shown; `bed` names them in the title and on every toast; `nowMs` is the patient
 *  screen's clock (the server's), as MedsBox and SofaBox take it. `onWritten(patientId)` is told when a save or a
 *  withdrawal the engine took has answered, for the patient it was made for — the screen's SOFA box and its
 *  measurement record read again. */
export function VitalsEntry({ patientId, bed, nowMs, onWritten }) {
  const { t } = useI18n();
  const board = useBoard();
  const [open, setOpen] = useState(null);      // { id, opening, saved? }: whose dialog, which opening, what was saved
  const [busy, setBusy] = useState(false);
  const openings = useRef(0);
  const savedRef = useRef(null);
  useEffect(() => { setOpen(null); }, [patientId]);
  const onBusy = useCallback((value) => setBusy(value), []);
  const mine = open && open.id === patientId ? open : null;
  const opening = mine?.opening;
  const saved = mine?.saved ?? null;
  // Once, when the answer to a save first arrives: the form is gone, so is the button that had the focus.
  useEffect(() => { if (saved) savedRef.current?.focus(); }, [saved]);
  const close = () => setOpen((current) => (current?.opening === opening ? null : current));
  // A write that answered (not a refusal, and not an answer the store dropped: null) changed what the SOFA form reads.
  // Said from here, not from the form's `onSaved`: that is called only while the form is still shown.
  const written = (id) => (answer) => {
    if (answer !== null) onWritten?.(id);
    return answer;
  };
  function start() {
    openings.current += 1;
    setBusy(false);
    setOpen({ id: patientId, opening: openings.current });
  }
  return (
    <>
      <Button size="sm" icon="plus" onClick={start}>{t("olcum.entryButton")}</Button>
      {mine ? (
        // `busy` is the FORM's request in flight: it ends with the form. The form's own cleanup sends
        // `onBusy(false)` when it unmounts — a save's answer clears its `busy` in the same render in which this
        // swaps it for the saved step, and an effect of a form that is gone never runs — so a held ✕ is released
        // there. `&& !saved` stays as a belt-and-braces guard: the saved step has no request of the form's in flight.
        <Modal open title={t("olcum.entryTitle", { bed })} onClose={close} busy={busy && !saved}>
          {saved ? (
            // tabIndex -1: focusable by the effect above, not a stop of the tab order. Level 3, under the dialog's h2.
            <div ref={savedRef} tabIndex={-1} data-vitals-saved="" className="outline-none">
              <SavedStep bed={bed} saved={saved} nowMs={nowMs} level={3}
                onRetract={(entry, reason) => board.store.retract(patientId, entry, reason).then(written(patientId))}>
                <Button variant="primary" onClick={close}>{t("common.close")}</Button>
              </SavedStep>
            </div>
          ) : (
            <VitalsForm
              key={mine.opening} bed={bed} nowMs={nowMs} onBusy={onBusy}
              onPreview={(entries, at) => board.store.chartPreview(patientId, entries, at)}
              onSave={(entries, at) => board.store.chart(patientId, entries, at).then(written(patientId))}
              onSaved={(result) => setOpen((current) => (current?.opening === opening ? { ...current, saved: result } : current))}
              onCancel={close}
            />
          )}
        </Modal>
      ) : null}
    </>
  );
}

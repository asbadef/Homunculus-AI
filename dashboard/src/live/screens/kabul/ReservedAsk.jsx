// src/live/screens/kabul/ReservedAsk.jsx — the question before an admission into a reserved bed
// (Group 2 · B3a, spec D5, X1). The server refuses such an admission (`bed_reserved`) until the
// form says the nurse saw the reservation. The refusal names the bed and never the note, so the
// note is read here, from GET /tenant/occupancy, which the admitting nurse may read (D2). A note
// that cannot be read is said so; the nurse still decides.
import React, { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { normId } from "../../data/structure.js";
import { readErrorText } from "../../apiErrors.js";
import { Button, Modal } from "../../ui/index.js";

/** `bedId`, `bed` ("label · room · unit"); `onCancel` sends nothing, `onConfirm` sends with the flag. */
export function ReservedAsk({ bedId, bed, onCancel, onConfirm }) {
  const { t } = useI18n();
  const { store } = useSession();
  const [note, setNote] = useState({ phase: "loading" });
  useEffect(() => {
    let live = true;
    store.track(() => store.api.occupancy())
      .then((answer) => {
        if (!live) return;
        const about = (answer?.beds ?? []).find((b) => normId(b.bed_id) === normId(bedId));
        setNote({ phase: "known", text: about?.state_note ?? null });
      })
      .catch((err) => { if (live) setNote({ phase: "failed", err }); });
    return () => { live = false; };
  }, [store, bedId]);

  const said = note.phase === "loading" ? t("kabul.reservedAsk.noteLoading")
    : note.phase === "failed" ? t("kabul.reservedAsk.noteFailed", { reason: readErrorText(t, note.err) })
      : note.text ? t("kabul.reservedAsk.note", { note: note.text }) : t("kabul.reservedAsk.noNote");
  return (
    <Modal open title={t("kabul.reservedAsk.title", { bed })} onClose={onCancel}
      actions={(
        <>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button variant="primary" icon="ok" onClick={onConfirm}>{t("kabul.reservedAsk.confirm")}</Button>
        </>
      )}>
      <p className="m-0 mb-2 text-14">{t("kabul.reservedAsk.body")}</p>
      <p role="status" className="m-0 text-13.5">{said}</p>
    </Modal>
  );
}

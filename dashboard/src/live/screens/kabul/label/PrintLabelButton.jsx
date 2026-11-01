// src/live/screens/kabul/label/PrintLabelButton.jsx — «Etiketi yazdır» / «Etiketi yeniden yazdır»
// (Group 2 · B1d, spec §6). The admit box (the first print) and the patient screen (a reprint) show
// it, for an admission with a protocol, to a holder of `admissions.admit`.
//
// THE WINDOW OPENS IN THE CLICK, before the request: a window opened after an await is a pop-up the
// browser blocks. Then POST /admissions/{id}/label — every print is an audited act — and the page
// is written into it. A blocked window asks nothing; a refused label closes its window; both say so
// on the toast, by code, never the server's words.
import React, { useState } from "react";
import { apiErrorText } from "../../../apiErrors.js";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { useSession } from "../../../session/SessionProvider.jsx";
import { Button, useToast } from "../../../ui/index.js";
import { reasonOf } from "../../admin/refusal.js";
import { openLabelWindow, printLabel } from "./protocolLabel.js";

/** `win`: the window to open the print page from (a test's stand-in); the page's own by default. */
export function PrintLabelButton({ admissionId, reprint = false, win }) {
  const { t, lang } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function print() {
    if (busy) return;
    const popup = openLabelWindow(win ?? window);
    if (!popup) {
      toast(t("protokol.popupBlocked"), "error");
      return;
    }
    setBusy(true);
    try {
      const label = await store.track(() => store.api.admissionLabel(admissionId, reprint));
      printLabel(popup, label, { t, lang });
    } catch (err) {
      try {
        popup.close();
      } catch {
        /* gone already */
      }
      // `reasonOf` turns an uncoded 404 into the reader's words; `apiErrorText` maps a code.
      toast(t("protokol.printFailed", { reason: apiErrorText(t, reasonOf(t, err)) }), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button icon="print" busy={busy} onClick={print}>{t(reprint ? "protokol.reprint" : "protokol.print")}</Button>
  );
}

// src/live/screens/kabul/label/LabelReprint.jsx — the patient screen's «Etiketi yeniden yazdır»
// (Group 2 · B1d, spec §6).
//
// Only for a session holding `admissions.admit` — without it nothing is read and nothing shown. The
// open admissions are the caller's units' (GET /admissions scopes them; the label route scopes the
// print again), the one shown is the one whose card this screen is (`boardKeyOf`), and only an
// admission with a protocol has a label: one opened before G2-B1d has neither label nor button.
//
// When the admissions could not be read at all (`phase` "failed") one muted line says so, in the
// screen's language, instead of the button silently not being there (Task 16 review F-18). That is the
// only thing said: a session without `admissions.view` reads nothing and so fails nothing (phase
// "unasked"), an admission without a protocol is a plain absence, and a reload that failed over rows
// already read ("stale") keeps the button the last read justified.
//
// Two ways to find the admission (G2-B1c, Task 16 review). The patient screen reads the open admissions
// ONCE and hands this component the row of its card and the read's `phase`: nothing is read here. Without
// `admission` (undefined) it reads the open admissions itself, as it always did.
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { useSession } from "../../../session/SessionProvider.jsx";
import { useAdmissions } from "../useAdmissions.js";
import { boardKeyOf } from "../boardKey.js";
import { PrintLabelButton } from "./PrintLabelButton.jsx";

const OPEN = ["DRAFT", "ACTIVE", "PENDING_DISCHARGE"];

/** `patientId`: the patient screen's card key. `win`: a test's stand-in for the print window.
 *  `admission`: the row of that card from the patient screen's one read of the open admissions, or null;
 *  undefined = read them here. `phase`: that read's phase (`useAdmissions`), for the unread line. */
export function LabelReprint({ patientId, win, admission, phase }) {
  const { user } = useSession();
  if (!(user?.perms?.includes("admissions.admit") ?? false)) return null;
  if (admission !== undefined) return <Reprint row={admission} phase={phase} win={win} />;
  return <ReadsItself patientId={patientId} win={win} />;
}

function ReadsItself({ patientId, win }) {
  const { rows, phase } = useAdmissions(OPEN);
  const row = rows?.find((r) => boardKeyOf(r) === patientId && r.protocol_no) ?? null;
  return <Reprint row={row} phase={phase} win={win} />;
}

/** `row`: the card's open admission, or null; only one with a protocol has a label. */
function Reprint({ row: found, phase, win }) {
  const { t } = useI18n();
  const row = found?.protocol_no ? found : null;
  if (!row) {
    return phase === "failed" ? <p className="m-0 text-right text-13 text-mute">{t("protokol.reprintUnread")}</p> : null;
  }
  return (
    <div className="flex justify-end">
      <PrintLabelButton admissionId={row.id} reprint win={win} />
    </div>
  );
}

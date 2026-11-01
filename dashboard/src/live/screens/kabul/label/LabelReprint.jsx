// src/live/screens/kabul/label/LabelReprint.jsx — the patient screen's «Etiketi yeniden yazdır»
// (Group 2 · B1d, spec §6).
//
// Only for a session holding `admissions.admit` — without it nothing is read and nothing shown. The
// open admissions are the caller's units' (GET /admissions scopes them; the label route scopes the
// print again), the one shown is the one whose card this screen is (`boardKeyOf`), and only an
// admission with a protocol has a label: one opened before G2-B1d has neither label nor button.
import React from "react";
import { useSession } from "../../../session/SessionProvider.jsx";
import { useAdmissions } from "../useAdmissions.js";
import { boardKeyOf } from "../boardKey.js";
import { PrintLabelButton } from "./PrintLabelButton.jsx";

const OPEN = ["DRAFT", "ACTIVE", "PENDING_DISCHARGE"];

/** `patientId`: the patient screen's card key. `win`: a test's stand-in for the print window. */
export function LabelReprint({ patientId, win }) {
  const { user } = useSession();
  if (!(user?.perms?.includes("admissions.admit") ?? false)) return null;
  return <Reprint patientId={patientId} win={win} />;
}

function Reprint({ patientId, win }) {
  const { rows } = useAdmissions(OPEN);
  const row = rows?.find((r) => boardKeyOf(r) === patientId && r.protocol_no) ?? null;
  if (!row) return null;
  return (
    <div className="flex justify-end">
      <PrintLabelButton admissionId={row.id} reprint win={win} />
    </div>
  );
}

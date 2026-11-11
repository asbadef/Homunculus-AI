// src/live/screens/kabul/SignOffStrip.jsx — "Hekim imzası bekliyor" on the patient screen of a
// DRAFT admission (Group 2 · B1a, spec D3, §3.2, §5.5). The card and the monitoring started at
// admission; the signature is the physician's later step, and until it is given the screen says
// so. A holder of `admissions.sign_off` signs here (POST /admissions/{id}/sign-off) — when she is a
// physician, or the form already names one (G2-B1c, spec §5.3, T1): the signer must be a physician
// unless the form names one, and the server refuses otherwise (409 `care_team_not_physician`). The system
// administrator holds the right by rule but is no physician, so on a DRAFT naming nobody the strip says,
// in one muted line, that a physician signs — in place of a button that would only earn a refusal on a
// toast. The refusal keeps its words for a race (a role changed after the screen read). A session
// without `admissions.view` reads no admission and shows no strip (X61).
//
// The list is read again every minute, as the bed board's badge is: a signature given on another
// screen takes the strip away within the minute, instead of leaving it to say the patient still
// waits. After a press, signed or refused, it is read at once, and the button stays held until
// that read is in: until then the strip still shows the DRAFT, and a second press would sign an
// admission the server has already signed.
//
// The bed is named as the slice names it, "label · room · unit", from the admission row's own
// names — never a UUID, never the patient's name: on the toast, and in the button's accessible
// name, so a screen reader hears whose admission the button signs.
//
// Signed here, the strip leaves with the re-read, and its button with it: the focus that button had
// would fall to <body>, and the result would be said only on the toast. So where the strip stood a
// line says the signature, and takes the focus — when the focus fell with the button, never over
// a focus the physician has since moved (spec §5.7, A-22).
//
// Two ways to find the admission (G2-B1c, Task 16 review). The patient screen reads the open
// admissions ONCE and hands this strip the row of its card (`admission`, a row or null): the strip then
// reads nothing, shows only while that row is a DRAFT, and tells `onSigned` — the shared read's
// `reload` — after a press, so the care team's box beside it sees the signed admission at once instead
// of at its next minute. Without `admission` (undefined) the strip reads the DRAFT list itself, as it
// always did.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Announce, Button, Icon, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { doneFor, reasonOf, refusedFor } from "../admin/refusal.js";
import { useAdmissions } from "./useAdmissions.js";
import { boardKeyOf } from "./boardKey.js"; // G2-B1d
import { isPhysician } from "../patient/careTeam/careTeam.js"; // G2-B1c: T1, the session's role groups

const DRAFT = ["DRAFT"];
const EVERY_MS = 60_000;
/** The bed as the slice names it (DischargeTab's `bedOf`, DolulukScreen's subject). */
const bedOf = (row) => `${row.bed_label} · ${row.room_name} · ${row.unit_name}`;

/** `patientId`: the board's key — for a `kabul` patient, its admission's `board_key` (the protocol
 *  since G2-B1d; a legacy admission's H-number). `admission`: the row of that card from the patient
 *  screen's one read of the open admissions, or null; undefined = read the DRAFT list here. `onSigned`:
 *  the shared read's `reload`, awaited after a press. */
export function SignOffStrip({ patientId, admission, onSigned }) {
  if (admission !== undefined) {
    return <Strip row={admission?.state === "DRAFT" ? admission : null} reload={onSigned} />;
  }
  return <ReadsItself patientId={patientId} />;
}

function ReadsItself({ patientId }) {
  const { rows, reload } = useAdmissions(DRAFT, { every: EVERY_MS });
  const row = rows?.find((r) => boardKeyOf(r) === patientId) ?? null;
  return <Strip row={row} reload={reload} />;
}

/** `row`: the DRAFT admission of this card, or null. */
function Strip({ row, reload }) {
  const { t } = useI18n();
  const { user, store } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(null);       // the bed of the admission signed here
  const said = useRef(null);
  const gone = signed !== null && row === null;     // signed, and it is no longer a DRAFT on the list
  useEffect(() => {
    if (!gone) return;
    const active = document.activeElement;
    if (!active || active === document.body) said.current?.focus();
  }, [gone]);
  if (!row) {
    return gone ? (
      <p ref={said} tabIndex={-1} role="note"
        className={`m-0 flex items-center gap-2 rounded-ctl border border-line bg-card px-3 py-2 text-13 font-semibold ${FOCUS_RING}`}>
        <Icon name="ok" size={16} />
        <span className="min-w-0 flex-1">{doneFor(t, signed, t("kabul.signed"))}</span>
      </p>
    ) : null;
  }
  const hasRight = user?.perms?.includes("admissions.sign_off") ?? false;
  // The server refuses a non-physician's sign-off of a DRAFT that names no physician (§5.3); this only keeps the
  // button from offering what it knows will be refused — it checks again, and the 409 below still has its words.
  const canSign = hasRight && (isPhysician(user) || row.attending_physician_id != null);
  const subject = bedOf(row);

  async function sign() {
    if (busy) return;
    setBusy(true);
    let landed = false;
    try {
      await store.track(() => store.api.signOffAdmission(row.id));
      toast(doneFor(t, subject, t("kabul.signed")));
      landed = true;
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
    } finally {
      await reload?.();
      if (landed) setSigned(subject);
      setBusy(false);
    }
  }

  return (
    <div role="note" className="flex flex-wrap items-center gap-2 rounded-ctl border border-att-line bg-att px-3 py-2 text-13 font-semibold text-att-ink">
      <Icon name="edit" size={16} />
      <span className="min-w-0 flex-1">{t("kabul.awaitingSignature")}</span>
      {canSign ? (
        <Button size="sm" variant="primary" icon="ok" busy={busy} onClick={sign} aria-label={`${t("kabul.sign")}: ${subject}`}>
          {t("kabul.sign")}
        </Button>
      ) : (
        <span className="text-12 font-normal">{t(hasRight ? "kabul.signPhysician" : "kabul.signNoRight")}</span>
      )}
      {/* A busy Button reads only "unavailable" to a screen reader; the words come from here. */}
      <Announce text={busy ? t("kabul.signing") : ""} />
    </div>
  );
}

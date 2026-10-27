// src/live/screens/kabul/SignOffStrip.jsx — "Hekim imzası bekliyor" on the patient screen of a
// DRAFT admission (Group 2 · B1a, spec D3, §3.2, §5.5). The card and the monitoring started at
// admission; the signature is the physician's later step, and until it is given the screen says
// so. A holder of `admissions.sign_off` signs here (POST /admissions/{id}/sign-off): the server
// makes her the attending when none is set. A session without `admissions.view` reads no
// admission and shows no strip (X61).
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
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Announce, Button, Icon, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { doneFor, reasonOf, refusedFor } from "../admin/refusal.js";
import { useAdmissions } from "./useAdmissions.js";

const DRAFT = ["DRAFT"];
const EVERY_MS = 60_000;
/** The bed as the slice names it (DischargeTab's `bedOf`, BedsTab's subject). */
const bedOf = (row) => `${row.bed_label} · ${row.room_name} · ${row.unit_name}`;

/** `patientId`: the board's key — for a `kabul` patient, the patient number. */
export function SignOffStrip({ patientId }) {
  const { t } = useI18n();
  const { user, store } = useSession();
  const toast = useToast();
  const { rows, reload } = useAdmissions(DRAFT, { every: EVERY_MS });
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(null);       // the bed of the admission signed here
  const said = useRef(null);
  const row = rows?.find((r) => r.patient_number === patientId) ?? null;
  const gone = signed !== null && row === null;     // signed, and the list no longer holds it
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
  const canSign = user?.perms?.includes("admissions.sign_off") ?? false;
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
      await reload();
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
        <span className="text-12 font-normal">{t("kabul.signNoRight")}</span>
      )}
      {/* A busy Button reads only "unavailable" to a screen reader; the words come from here. */}
      <Announce text={busy ? t("kabul.signing") : ""} />
    </div>
  );
}

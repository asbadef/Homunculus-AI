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
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Announce, Button, Icon, useToast } from "../../ui/index.js";
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
  const row = rows?.find((r) => r.patient_number === patientId) ?? null;
  if (!row) return null;
  const canSign = user?.perms?.includes("admissions.sign_off") ?? false;
  const subject = bedOf(row);

  async function sign() {
    if (busy) return;
    setBusy(true);
    try {
      await store.track(() => store.api.signOffAdmission(row.id));
      toast(doneFor(t, subject, t("kabul.signed")));
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
    } finally {
      await reload();
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

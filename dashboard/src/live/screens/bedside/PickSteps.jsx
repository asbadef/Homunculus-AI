// src/live/screens/bedside/PickSteps.jsx — the bedside page's two steps that say WHO: the patient list and the
// identity question (G3-01, D3, X9, X13). Moved here unchanged from BedsideScreen.jsx (G3-05), so that the page's
// «Eşleşmeyen ölçümler» step asks the very same question before it links a reading (spec D11) instead of a copy.
//
// THE LIST is the board this session already has — the engine's scope filter decides who is on it — each patient by
// bed, name, age and when a NEWS2 input was last measured, by anything (the board carries no source per value).
// THE QUESTION (X9): the name and the year of birth the HIS sent, and the bed. A patient with no birth date says so;
// the question is asked all the same. The year is the HIS's, never one made up. The age of an infant is years,
// months and days (`ageOf`, `kabul.age`): whole years print «0 yaşında» for every baby on a NICU round.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { Box, Button, Note } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { nameOf } from "../common/BoardState.jsx";
import { bedNameOf } from "../beds/order.js";
import { ageOf } from "../kabul/admitForm.js";
import { birthYearOf, lastMeasuredMs } from "./vitalsFields.js";

export const bedOf = bedNameOf;

/** The board's day (YYYY-MM-DD, local, from the server-corrected clock): what `ageOf` counts to. */
const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** «56 yaşında»; an infant under a year, «0 yaş 2 ay 5 gün». null for an age the board does not have. */
function ageLine(t, patient, nowMs) {
  if (!Number.isInteger(patient.age)) return null;
  if (patient.age === 0) {
    const exact = ageOf(String(patient.birthDate ?? "").slice(0, 10), dayOf(nowMs));
    if (exact) return t("kabul.age", exact);
  }
  return t("olcum.pickAge", { years: patient.age });
}

/** `known`: the board may be spoken of as current (LIVE). An empty list on any other board is no statement
 *  about the ward — the strip above says why — so «yatan xəstə yoxdur» is not written under it. */
export function PickList({ patients, nowMs, known, onPick }) {
  const { t } = useI18n();
  if (patients.length === 0) return known ? <Note tone="info" icon="bed">{t("olcum.pickEmpty")}</Note> : null;
  return (
    // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
    <ul role="list" className="m-0 grid list-none gap-2 p-0 min-[640px]:grid-cols-2">
      {patients.map((p) => {
        const last = lastMeasuredMs(p);
        const facts = [
          ageLine(t, p, nowMs),
          last !== null ? t("olcum.pickLast", { time: dayStamp(last, nowMs) }) : t("olcum.pickNone"),
        ].filter(Boolean);
        return (
          <li key={p.patient_id}>
            <button
              type="button" data-pick={p.patient_id} onClick={() => onPick(p)}
              className={`block w-full rounded-box border border-line bg-card px-4 py-3 text-left ${FOCUS_RING}`}
            >
              <b className="block font-data text-17 font-bold text-ink">{bedOf(p)}</b>
              <span className={`block text-14.5 ${p.display_name ? "text-ink" : "italic text-mute"}`}>{nameOf(p, t)}</span>
              <span className="mt-1 block text-12 text-mute">{facts.join(" · ")}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** `title`, `ask`, `yes` and `no` are the bedside form's own words unless the host gives others (G3-05: the link of
 *  an unmatched reading asks its own question over the same three facts); `children` sit between the facts and the
 *  question (the reading being linked); `busy` holds the buttons while the host's write is out. */
export function IdentityStep({ patient, onYes, onNo, title, ask, yes, no, busy = false, children }) {
  const { t } = useI18n();
  const year = birthYearOf(patient.birthDate);
  const term = "font-semibold text-mute";
  return (
    <Box title={title ?? t("olcum.identityTitle")} icon="user" level={2}>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-14.5">
        <dt className={term}>{t("olcum.identityName")}</dt>
        <dd className={`m-0 font-bold ${patient.display_name ? "" : "italic text-mute"}`}>{nameOf(patient, t)}</dd>
        <dt className={term}>{t("olcum.identityYear")}</dt>
        <dd className="m-0">
          {year ? <b className="font-data">{year}</b> : <span className="italic text-mute">{t("olcum.identityNoBirth")}</span>}
        </dd>
        <dt className={term}>{t("olcum.identityBed")}</dt>
        <dd className="m-0 font-data font-bold">{bedOf(patient)}</dd>
      </dl>
      {children}
      <p className="m-0 mt-3 text-14.5 font-semibold">{ask ?? t("olcum.identityAsk")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="lg" variant="primary" icon="ok" onClick={onYes} busy={busy}>{yes ?? t("olcum.identityYes")}</Button>
        <Button size="lg" icon="x" onClick={onNo} busy={busy}>{no ?? t("olcum.identityNo")}</Button>
      </div>
    </Box>
  );
}

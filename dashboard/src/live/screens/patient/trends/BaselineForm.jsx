// src/live/screens/patient/trends/BaselineForm.jsx — "the patient's normal" (spec §3.3): the patient's
// own range for the five vitals the engine keeps a baseline for, written through the engine's profile
// door (PUT /clinical/{id}/profile) by a `clinical.chart` holder.
//
// THE ENGINE REPLACES THE WHOLE SET WITH WHAT IS SENT (api/clinical.py `profile_from_payload`). So the
// form opens with what is charted and sends every filled pair; an emptied pair is a deleted baseline,
// and the form says so under the fields. Only `baselines` is sent: the comorbidities and the baseline
// SOFA are not in the body, so the engine keeps them (`backendApi.putPatientProfile`, not `setProfile`).
//
// Held here before sending, in the reader's words, exactly what the engine would refuse: one side
// without the other, a bound that is not a number, low above high. Nothing else is judged — what a
// range means is the engine's, and anything this form lets through is the engine's to refuse.
//
// A refusal goes on the toast, named after the bed, and never also inline (amendments (a), (f)); a
// write that got no answer may have landed (`mayHaveLanded`, the one rule): the trends are read again
// and the clinician is told to look at the band. `busy` holds Save (never `disabled`, amendment (c))
// and the fields go read-only while the write is in flight.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { useSession } from "../../../session/SessionProvider.jsx";
import { apiErrorText } from "../../../apiErrors.js";
import { Announce, Button, Field, Input, Modal, Note, useToast } from "../../../ui/index.js";
import { VITALS } from "../../common/vitals.js";
import { mayHaveLanded } from "../../admin/refusal.js";

/** The vitals the engine keeps a baseline for, in the bed card's order. A mirror of api/clinical.py
 *  BASELINE_SIGNALS — BaselineForm.test.jsx reads that file and holds the two equal. MAP and lactate
 *  have none, so they are not offered (spec D4). */
export const BASELINE_KEYS = Object.freeze(["heart_rate", "resp_rate", "spo2", "sbp", "temperature"]);
const META = Object.fromEntries(VITALS.map((v) => [v.at, v]));

const shown = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");
/** A typed bound: "" when empty, its number (a decimal comma read as a point), NaN when not one. */
function bound(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (s === "") return "";
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
}

/** What the rows would send, and each row's problem as `{ side, key }`. */
export function checkBaselines(rows) {
  const errors = {};
  const baselines = {};
  for (const key of BASELINE_KEYS) {
    const low = bound(rows[key]?.low);
    const high = bound(rows[key]?.high);
    if (low === "" && high === "") continue;
    if (low === "" || high === "") errors[key] = { side: low === "" ? "low" : "high", key: "patient.baselineBothOrNeither" };
    else if (Number.isNaN(low) || Number.isNaN(high)) errors[key] = { side: Number.isNaN(low) ? "low" : "high", key: "patient.baselineNotNumber" };
    else if (low > high) errors[key] = { side: "low", key: "patient.baselineLowAboveHigh" };
    else baselines[key] = { low, high };
  }
  return { errors, baselines };
}

export function BaselineForm({ patient, bed, own, onClose, onSaved }) {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState(() => Object.fromEntries(
    BASELINE_KEYS.map((key) => [key, { low: shown(own?.[key]?.low), high: shown(own?.[key]?.high) }])));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const { errors, baselines } = checkBaselines(rows);
  const empty = Object.keys(baselines).length === 0 && Object.keys(errors).length === 0;
  // Every row empty over a set that IS charted is a clear: the engine reads `{baselines: {}}` over a
  // charted profile as "delete every range" (api/clinical.py). Over nothing there is nothing to clear.
  const clearing = empty && BASELINE_KEYS.some((key) => own?.[key]);
  const nothing = empty && !clearing;
  const errorOf = (key, side) => (tried && errors[key]?.side === side ? t(errors[key].key) : undefined);
  const edit = (key, side) => (event) => {
    const { value } = event.target;
    setRows((current) => ({ ...current, [key]: { ...current[key], [side]: value } }));
  };

  async function save() {
    if (busy || nothing) return;
    setTried(true);
    if (Object.keys(errors).length > 0) return;
    const epoch = store.epoch();
    setBusy(true);
    try {
      await store.track(() => store.api.putPatientProfile(patient.patient_id, { baselines }));
      if (epoch !== store.epoch()) return;
      toast(t(clearing ? "patient.baselineClearedAll" : "patient.baselineSaved"));
      onSaved();
      onClose();
    } catch (err) {
      if (err?.superseded || epoch !== store.epoch()) return;
      if (mayHaveLanded(err)) {
        toast(t("patient.baselineMayHaveLanded", { subject: bed }), "warn");
        onSaved();
        onClose();
      } else if (err?.status === 403) {
        toast(t("patient.baselineRefused", { subject: bed, reason: t("patient.baselineNoRight") }), "error");
        onClose();
      } else {
        toast(t("patient.baselineRefused", { subject: bed, reason: apiErrorText(t, err) }), "error");
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Modal
      open title={t("patient.baselineTitle")} onClose={onClose} busy={busy}
      actions={(
        <>
          <Button variant="ghost" onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} busy={busy} aria-disabled={nothing ? "true" : undefined}>{t("common.save")}</Button>
        </>
      )}
    >
      <Note tone="info" icon="user">{t("patient.baselineNotDeviceAlarm")}</Note>
      {BASELINE_KEYS.map((key) => (
        <fieldset key={key} data-baseline={key} className="m-0 mt-3 min-w-0 border-0 p-0">
          <legend className="mb-1 p-0 text-12.5 font-semibold">
            {t(META[key].labelKey)} <span className="font-normal text-mute">({t(META[key].unitKey)})</span>
          </legend>
          <div className="grid grid-cols-2 gap-x-2">
            <Field label={t("patient.baselineLow")} layout="col" error={errorOf(key, "low")}>
              <Input inputMode="decimal" autoComplete="off" value={rows[key].low} onChange={edit(key, "low")} readOnly={busy} />
            </Field>
            <Field label={t("patient.baselineHigh")} layout="col" error={errorOf(key, "high")}>
              <Input inputMode="decimal" autoComplete="off" value={rows[key].high} onChange={edit(key, "high")} readOnly={busy} />
            </Field>
          </div>
        </fieldset>
      ))}
      <p className="m-0 mt-2 text-12 text-mute">{t("patient.baselineClearsNote")}</p>
      {nothing ? <p className="m-0 mt-1 text-12 font-semibold text-att-ink">{t("patient.baselineNothingToSend")}</p> : null}
      {clearing ? <p className="m-0 mt-1 text-12 font-semibold text-att-ink">{t("patient.baselineClearsAll")}</p> : null}
      <Announce text={busy ? t("patient.baselineSaving") : ""} />
    </Modal>
  );
}

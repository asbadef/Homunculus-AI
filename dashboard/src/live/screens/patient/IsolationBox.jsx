// src/live/screens/patient/IsolationBox.jsx — G4-05 «Enfeksiyon kontrol» (spec D16 as §5 S2, A1, M2, M8 amend it): the
// patient's isolation precautions as charted, and — for a `clinical.chart` holder — the four flags to chart them.
//
// A CLINICAL RECORD, NOT A SUGGESTION. The system ticks nothing of its own: the boxes follow what was last charted (a
// flag charted true is ticked; false and never charted are not), and the save sends all four, 1 or 0, through the chart
// door with no time (the server's instant is the record's), where each is a `chart` row under the clinician's own name.
// Nothing is withdrawn: a new save is written over the last, and an isolation is ended by four unticked boxes saved.
// Four unticked boxes on a patient nobody recorded are saved as «no isolation», and the button says so (§5 M2).
//
// «UNRECORDED» IS NOT «NOT ISOLATED» (spec D16). The state line says which of the three the card holds — and, while the
// board is not LIVE, says no «yok» at all (Decision 18): an isolated card keeps its types with «pano güncel değil», the
// other two become one sentence that the state cannot be shown. Nothing is saved from a board that is not LIVE (§5 A1).
//
// NO BLIND OVERWRITE (§5 A1). Untouched, the boxes follow the card. Once touched they are a draft, seeded from the card's
// `charted_at` of that moment; if the card carries a newer record when the save is pressed, nothing is sent: the box says
// a new record came and offers «Yine de kaydet» or «Seçimden vazgeç» (which re-seeds from the card).
//
// THE ANSWERS (§5 M2, the fluid dialog's rules): busy while in flight, one at a time, the button never `disabled` — the
// boxes and «Seçimden vazgeç» are held meanwhile, so the draft out is the draft kept (review M3); a write the store
// dropped (`null`: the session changed) or a superseded one says nothing; a discharged number is a warn; a refusal names
// the bed (never the patient's name, Decision 14) and the reason; no answer (`mayHaveLanded`) may have written some of
// the four rows — the box says so and has the board read again (`onRefresh`). The draft stays on every failure; a
// success re-seeds it — in the patient's own box (keyed, review M2). The save button names what it saves: the patient screen has
// other «Kaydet» buttons (plan note N8 b).
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { apiErrorText } from "../../apiErrors.js";
import { Announce, Box, Button, Note, useToast } from "../../ui/index.js";
import { mayHaveLanded } from "../admin/refusal.js";
import { TYPES } from "../enfeksiyon/enfeksiyon.js";
import { msOf } from "../eczane/pharmacyModel.js";

/** The boxes a card's block seeds: a flag charted true is ticked; false and never charted are not. */
export const seedOf = (isolation) => Object.fromEntries(TYPES.map((type) => [type, isolation?.[type] === true]));

/** `isolation`: the card's block (api/board.py `_isolation`), or null — read as «unrecorded». `bed`: the toast's subject
 *  (the bed label, else the key). `known`: the board is LIVE. `onChart(entries)` saves for this patient and resolves to
 *  the store's answer; `onRefresh()` reads the board again.
 *
 *  Keyed by the patient (review M2), as the screen keys PatientAdmission: the shell keeps the patient screen mounted
 *  across a move to another patient, and the draft, the busy state and a save's answer are the patient's, not the
 *  box's. A move starts a new box — no draft of the last patient is painted, even for one frame — and a save still out
 *  for a patient left and come back to lands in the box it left from, never on a newer save's busy state or draft. */
export function IsolationBox(props) {
  return <PatientIsolationBox key={props.patientId} {...props} />;
}

function PatientIsolationBox({ isolation, bed, canChart, known, nowMs, onChart, onRefresh }) {
  const { t } = useI18n();
  const toast = useToast();
  const chartedAt = isolation?.charted_at ?? null;
  const state = isolation?.state ?? "unrecorded";
  const [draft, setDraft] = useState(null);           // null: untouched — the boxes follow the card
  const [seededAt, setSeededAt] = useState(null);     // the card's `charted_at` the draft was seeded from (§5 A1)
  const [held, setHeld] = useState(false);            // the save was pressed over a newer record (§5 A1)
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  // Review I1: a held save, «Yine de kaydet» and «Seçimden vazgeç» each swap the buttons under the keyboard; the focus
  // goes where the next step is (`focusTo`, read once the new buttons are in place), never to <body>.
  const saveRef = useRef(null);
  const anywayRef = useRef(null);
  const focusTo = useRef(null);                       // "anyway" | "save" | null
  useEffect(() => {
    const target = focusTo.current === "anyway" ? anywayRef.current : focusTo.current === "save" ? saveRef.current : null;
    focusTo.current = null;
    target?.focus();
  });
  const boxes = draft ?? seedOf(isolation);
  const stamp = (iso) => {
    const ms = msOf(iso);
    return ms === null ? "—" : dayStamp(ms, nowMs);
  };
  const typesText = (types) => (Array.isArray(types) ? types : [])
    .map((type) => (TYPES.includes(type) ? t(`enfeksiyon.type.${type}`) : String(type))).join(" · ");

  // Review M3: while a save is out its draft is what was sent — the boxes take no tick and «Seçimden vazgeç» discards
  // nothing — so a failure keeps exactly the draft it says it keeps.
  function touch(type) {
    if (busy) return;
    if (draft === null) setSeededAt(chartedAt);
    setDraft({ ...boxes, [type]: !boxes[type] });
    setHeld(false);
  }
  function discard() {
    if (busy) return;
    focusTo.current = "save";
    setDraft(null);
    setHeld(false);
  }
  async function send(chosen) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setHeld(false);
    const subject = bed;
    let say = null;
    try {
      const answer = await onChart(TYPES.map((type) => ({ code: `isolation_${type}`, value: chosen[type] ? 1 : 0 })));
      if (answer === null) return;                       // the session changed: nothing is said into the next one
      if (answer?.dropped) {
        say = [t("patient.isolation.dropped", { subject }), "warn"];
        return;
      }
      say = [t("patient.isolation.saved")];
      setDraft(null);                                    // the boxes follow the reloaded card again
    } catch (err) {
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        say = [t("patient.isolation.mayHaveLanded", { subject }), "warn"];
        onRefresh?.();
      } else {
        say = [t("patient.isolation.refused", { subject, reason: apiErrorText(t, err) }), "error"];
      }
    } finally {
      sending.current = false;                           // this patient's box: a box left behind is unmounted
      setBusy(false);
      if (say) toast(...say);
    }
  }
  function press() {
    if (draft !== null && chartedAt !== seededAt) {
      focusTo.current = "anyway";
      setHeld(true);                                     // a newer record came: nothing is sent (§5 A1)
      return;
    }
    send(boxes);
  }
  function sendAnyway() {
    focusTo.current = "save";
    send(boxes);
  }

  let line;
  let tone = "info";
  if (state === "isolated") {
    line = `${t("patient.isolation.isolated", { types: typesText(isolation?.types) })}${known ? "" : ` · ${t("patient.isolation.boardStale")}`}`;
    if (!known) tone = "warn";                         // review M9: «pano güncel değil» is a warning, as below
  } else if (!known) {
    line = t("patient.isolation.cannotShow");
    tone = "warn";
  } else if (state === "not_isolated") {
    line = t("patient.isolation.notIsolated");
  } else if (state === "unrecorded") {
    line = t("patient.isolation.unrecorded");
    tone = "warn";
  } else {
    line = t("enfeksiyon.unknown", { state: String(state) });
  }
  const recordNone = state === "unrecorded" && TYPES.every((type) => !boxes[type]);

  return (
    <Box title={t("patient.isolation.title")} icon="thermo" level={2}>
      <Note tone={tone} icon={tone === "warn" ? "alert" : "ok"}>{line}</Note>
      {chartedAt ? <p data-last-record className="m-0 mt-1 text-12 text-mute">{t("patient.isolation.lastRecord", { time: stamp(chartedAt) })}</p> : null}
      {canChart ? (
        <div className="mt-2.5 border-t border-line pt-2.5">
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="m-0 p-0 text-12.5 font-semibold">{t("patient.isolation.types")}</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {TYPES.map((type) => (
                <label key={type} className="inline-flex items-center gap-1.5 text-13">
                  <input type="checkbox" checked={boxes[type]} disabled={busy} onChange={() => touch(type)} />
                  {t(`enfeksiyon.type.${type}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="m-0 mt-1.5 text-11.5 text-mute">{t("patient.isolation.note")}</p>
          {!known ? (
            <p data-held className="m-0 mt-1.5 text-12.5 font-semibold text-att-ink">{t("patient.isolation.heldStale")}</p>
          ) : held ? (
            <div data-newer className="mt-1.5 grid gap-1.5">
              <p className="m-0 text-12.5 font-semibold text-att-ink">{t("patient.isolation.newer", { time: stamp(chartedAt) })}</p>
              <div className="flex flex-wrap gap-2">
                <Button ref={anywayRef} size="sm" busy={busy} onClick={sendAnyway}>{t("patient.isolation.saveAnyway")}</Button>
                <Button size="sm" variant="ghost" onClick={discard}>{t("patient.isolation.discard")}</Button>
              </div>
            </div>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Button ref={saveRef} size="sm" busy={busy} onClick={press}>{t(recordNone ? "patient.isolation.saveNone" : "patient.isolation.save")}</Button>
              {draft !== null ? (
                <Button size="sm" variant="ghost" aria-disabled={busy ? "true" : undefined} onClick={discard}>
                  {t("patient.isolation.discard")}
                </Button>
              ) : null}
            </div>
          )}
          {/* A busy Button reads only "unavailable" to a screen reader; the words come from here — and a held save's
              reason (review I1), which the sentence above only shows. */}
          <Announce text={busy ? t("patient.isolation.saving") : held ? t("patient.isolation.newer", { time: stamp(chartedAt) }) : ""} />
        </div>
      ) : <p className="m-0 mt-2 text-12 text-mute">{t("patient.isolation.noRight")}</p>}
    </Box>
  );
}

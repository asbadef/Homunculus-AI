// src/live/screens/bedside/BedsideScreen.jsx — «Yatak başı ölçüm» (G3-01, D3): the tablet and phone page for the
// round. Choose the patient, confirm who it is, enter the set, see what was saved.
//
// THE LIST is the board this session already has — the engine's scope filter decides who is on it, as on the
// beds screen — each patient by bed, name, age and when a NEWS2 input was last measured. Last measured by
// anything, not by hand: the board carries no source per value (X13), and «son ölçüm» is still what a nurse on
// a round needs. Sorted by bed, the way she walks the ward.
//
// WHO IT IS (D3, X9): the name and the year of birth the HIS sent, and the bed. «Hayır» cancels the choice and
// says to tell the charge nurse — on the toast, named after the bed — and nothing is charted. A patient with no
// birth date says so; the question is asked all the same. The year is the HIS's, never one made up.
//
// THE FORM is VitalsForm, bound to the chosen patient through the board store (`chartPreview`, `chart`); the
// saved step offers «hatalı giriş» per value (`retract`). The choice is held by id: should the card leave a LIVE
// board while she is on it (discharged, out of scope), the page says so and goes back to the list — a form for a
// patient who is no longer here is not left open. A board that is reconnecting is not "gone": its list is old,
// not empty. Each step takes the focus when it opens, so a keyboard and a screen reader follow the page.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { useBoard } from "../../data/BoardProvider.jsx";
import { Box, Button, Note, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { BoardStrip, ScopeNote, boardKnown, nameOf, useBoardNow } from "../common/BoardState.jsx";
import { SavedStep } from "./SavedStep.jsx";
import { VitalsForm } from "./VitalsForm.jsx";
import { birthYearOf, lastMeasuredMs } from "./vitalsFields.js";

const TICK_MS = 30_000;
const bedOf = (patient) => patient.bedLabel || patient.patient_id;
const byBed = (a, b) => String(bedOf(a)).localeCompare(String(bedOf(b)), "tr", { numeric: true });

function PickList({ patients, nowMs, onPick }) {
  const { t } = useI18n();
  if (patients.length === 0) return <Note tone="info" icon="bed">{t("olcum.pickEmpty")}</Note>;
  return (
    // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
    <ul role="list" className="m-0 grid list-none gap-2 p-0 min-[640px]:grid-cols-2">
      {patients.map((p) => {
        const last = lastMeasuredMs(p);
        const facts = [
          Number.isInteger(p.age) ? t("olcum.pickAge", { years: p.age }) : null,
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

function IdentityStep({ patient, onYes, onNo }) {
  const { t } = useI18n();
  const year = birthYearOf(patient.birthDate);
  const term = "font-semibold text-mute";
  return (
    <Box title={t("olcum.identityTitle")} icon="user" level={2}>
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
      <p className="m-0 mt-3 text-14.5 font-semibold">{t("olcum.identityAsk")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="lg" variant="primary" icon="ok" onClick={onYes}>{t("olcum.identityYes")}</Button>
        <Button size="lg" icon="x" onClick={onNo}>{t("olcum.identityNo")}</Button>
      </div>
    </Box>
  );
}

export function BedsideScreen() {
  const { t } = useI18n();
  const board = useBoard();
  const toast = useToast();
  const nowMs = useBoardNow(TICK_MS);
  // { name: "pick" | "identity" | "form" | "saved", id?, bed?, saved? }: the step, and the patient it is for.
  const [step, setStep] = useState({ name: "pick" });
  const [gone, setGone] = useState(false);
  const stepRef = useRef(null);
  const moved = useRef(false);
  const patients = useMemo(() => [...board.patients].sort(byBed), [board.patients]);
  const patient = step.id ? board.patients.find((p) => p.patient_id === step.id) ?? null : null;
  const known = boardKnown(board.connection);
  useEffect(() => {
    if ((step.name === "identity" || step.name === "form") && known && !patient) {
      setGone(true);
      setStep({ name: "pick" });
    }
  }, [step.name, known, patient]);
  // Not on the first render: the page opening is not a step the focus has to follow.
  useEffect(() => {
    if (moved.current) stepRef.current?.focus();
    moved.current = true;
  }, [step.name]);
  const { id, bed } = step;
  const choose = (p) => {
    setGone(false);
    setStep({ name: "identity", id: p.patient_id, bed: bedOf(p) });
  };
  const refuse = () => {
    toast(t("olcum.identityRefused", { subject: bed }), "warn");
    setStep({ name: "pick" });
  };
  return (
    <div className="flex min-h-0 max-w-[900px] flex-col gap-3">
      <h1 className="m-0 font-display text-23 font-bold">{t("olcum.title")}</h1>
      <p className="m-0 text-13 text-mute">{t("olcum.intro")}</p>
      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />
      {gone ? <Note tone="warn" icon="alert">{t("olcum.gone")}</Note> : null}
      <section ref={stepRef} tabIndex={-1} data-step={step.name} className="outline-none">
        {step.name === "pick" ? (
          <>
            <h2 className="m-0 mb-2 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("olcum.pickTitle")}</h2>
            <PickList patients={patients} nowMs={nowMs} onPick={choose} />
          </>
        ) : null}
        {step.name === "identity" && patient ? (
          <IdentityStep patient={patient} onYes={() => setStep({ name: "form", id, bed })} onNo={refuse} />
        ) : null}
        {step.name === "form" && patient ? (
          <Box title={t("olcum.formTitle", { bed })} icon="activity" level={2}>
            <VitalsForm
              key={id} bed={bed} nowMs={nowMs}
              onPreview={(entries, at) => board.store.chartPreview(id, entries, at)}
              onSave={(entries, at) => board.store.chart(id, entries, at)}
              onSaved={(saved) => setStep({ name: "saved", id, bed, saved })}
              onCancel={() => setStep({ name: "pick" })}
            />
          </Box>
        ) : null}
        {step.name === "saved" ? (
          <SavedStep bed={bed} saved={step.saved} nowMs={nowMs} onRetract={(entry, reason) => board.store.retract(id, entry, reason)}>
            <a href={`#/patients/${encodeURIComponent(id)}`}
              className={`inline-flex items-center gap-1.5 rounded-ctl border border-line px-4 py-2.5 text-14.5 font-semibold text-pri ${FOCUS_RING}`}>
              {t("olcum.savedOpen")}
            </a>
            <Button size="lg" variant="primary" icon="chevR" onClick={() => setStep({ name: "pick" })}>{t("olcum.savedNext")}</Button>
          </SavedStep>
        ) : null}
      </section>
    </div>
  );
}

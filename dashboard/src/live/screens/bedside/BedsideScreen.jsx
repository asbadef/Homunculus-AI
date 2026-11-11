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
// not empty. Nor is one whose load failed: its list is EMPTY, which says nothing about the patient, and the
// form needs only the id and the bed to go on (G3-01 review of Task 14), so what she typed is not thrown away
// with it. The notice lives in the step it was raised for, and is spoken as well as shown. Each step takes the
// focus when it opens, so a keyboard and a screen reader follow the page.
//
// «EŞLEŞMEYEN ÖLÇÜMLER» (G3-05, D17) is a step of this page too: a button on the first step — with how many sets
// wait — opens the list (UnmatchedStep.jsx), which reuses this page's patient list and identity question
// (PickSteps.jsx) before it links a reading. No route and no chunk of its own.
//
// THE ORDER is the beds screen's (`orderBeds`: by unit, a card the bed table does not place last, numbers as
// numbers). The AGE of an infant is years, months and days (`ageOf`, `kabul.age`), the admission form's: whole
// years print «0 yaşında» for every baby on a NICU round.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useUnmatched } from "../../data/UnmatchedProvider.jsx";   // G3-05
import { Announce, Box, Button, Note, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { BoardStrip, ScopeNote, boardKnown, useBoardNow } from "../common/BoardState.jsx";
import { orderBeds } from "../beds/order.js";
// G3-05: the patient list and the identity question live in PickSteps.jsx now — the «Eşleşmeyen ölçümler» step
// (UnmatchedStep.jsx) asks the same question before it links a reading.
import { IdentityStep, PickList, bedOf } from "./PickSteps.jsx";
import { SavedStep } from "./SavedStep.jsx";
import { UnmatchedStep } from "./UnmatchedStep.jsx";
import { VitalsForm } from "./VitalsForm.jsx";

const TICK_MS = 30_000;

export function BedsideScreen() {
  const { t } = useI18n();
  const board = useBoard();
  const toast = useToast();
  const nowMs = useBoardNow(TICK_MS);
  // { name: "pick" | "identity" | "form" | "saved" | "unmatched", id?, bed?, saved?, gone? }: the step, and the
  // patient it is for. `gone` belongs to the list step it was raised for: the next step the page takes has none.
  const waiting = useUnmatched();
  const [step, setStep] = useState({ name: "pick" });
  const stepRef = useRef(null);
  const seen = useRef(step.name);
  const patients = useMemo(() => orderBeds(board.patients), [board.patients]);
  const patient = step.id ? board.patients.find((p) => p.patient_id === step.id) ?? null : null;
  const known = boardKnown(board.connection);
  useEffect(() => {
    if ((step.name === "identity" || step.name === "form") && known && !patient) {
      setStep({ name: "pick", gone: true });
    }
  }, [step.name, known, patient]);
  // Only a CHANGE of step moves the focus: the page opening is not a step it has to follow (and a rehearsal
  // run of the effect, as StrictMode makes, finds nothing changed).
  useEffect(() => {
    if (seen.current !== step.name) {
      seen.current = step.name;
      stepRef.current?.focus();
    }
  }, [step.name]);
  const { id, bed } = step;
  // The step's own heading, so the group the focus lands on is named for what it holds.
  const stepLabel = step.name === "identity" ? t("olcum.identityTitle")
    : step.name === "form" ? t("olcum.formTitle", { bed })
    : step.name === "saved" ? t("olcum.saved", { time: dayStamp(step.saved.atMs, nowMs) })
    : step.name === "unmatched" ? t("kayit.umTitle")
    : t("olcum.pickTitle");
  const choose = (p) => setStep({ name: "identity", id: p.patient_id, bed: bedOf(p) });
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
      {step.gone ? <Note tone="warn" icon="alert">{t("olcum.gone")}</Note> : null}
      {/* The Note is a static aside: said here as well, politely, so a screen reader hears why the form closed. */}
      <Announce text={step.gone ? t("olcum.gone") : ""} />
      <section ref={stepRef} tabIndex={-1} role="group" aria-label={stepLabel} data-step={step.name} className="outline-none">
        {step.name === "pick" ? (
          <>
            {/* G3-05 (D17): the way into «Eşleşmeyen ölçümler», with the count when the last read gave one. */}
            <div className="mb-3">
              <Button icon="link" onClick={() => setStep({ name: "unmatched" })}>
                {waiting.count ? t("kayit.umOpenCount", { count: waiting.count }) : t("kayit.umOpen")}
              </Button>
            </div>
            <h2 className="m-0 mb-2 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("olcum.pickTitle")}</h2>
            <PickList patients={patients} nowMs={nowMs} known={known} onPick={choose} />
          </>
        ) : null}
        {step.name === "unmatched" ? (
          <UnmatchedStep patients={patients} nowMs={nowMs} known={known} onBack={() => setStep({ name: "pick" })} />
        ) : null}
        {step.name === "identity" && patient ? (
          <IdentityStep patient={patient} onYes={() => setStep({ name: "form", id, bed })} onNo={refuse} />
        ) : null}
        {/* Not `&& patient`: a board whose load failed has no list, and the form needs only the id and the bed. */}
        {step.name === "form" ? (
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

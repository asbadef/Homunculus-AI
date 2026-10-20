// src/live/screens/patient/PatientScreen.jsx — one patient, as the engine describes them (G1-11).
// It writes TWO things, and says so in as many words (`patient.onlyWrite`): whether an infection is
// suspected (Task 15B, Decision 27), and — since Group 2 · slice 1, from the trends box, for a
// `clinical.chart` holder — the patient's own normal ranges. Nothing else here reaches the record.
//
// Four things it shows, and one it refuses to:
//
//   1. WHO, and where that came from. The HIS's name or the statement that there is none; the bed
//      the board resolved, and the HIS location it could not resolve. No age, no body-surface
//      area, no hospital or protocol number: the prototype computed the first two in the browser
//      and MADE UP the last two from the patient id (`hnOf`, `protoOf`).
//   2. WHAT WAS MEASURED, AND HOW OLD IT IS. Every channel the engine has a value for, with the
//      age of that value beside it — the G1-11 criterion, and the gap the old workspace never
//      closed (`measuredAt` reached its state and no screen ever read it). The screen reports the
//      age; it does not decide that an age is too old. That is a clinical threshold, the engine
//      owns every one, and where the engine HAS judged an input stale it says so itself per
//      finding (`staleInputs`), which this screen shows as the engine's words.
//   3. WHAT THE ENGINE FOUND, and why. One card per open alarm: its severity, its summary, the
//      engine's own reasoning, the vault sources behind it, what it suggests considering, how
//      certain that is, whether the patient's charted chronic normal lowered it and which inputs
//      were already stale. Nothing is paraphrased — a screen that rewrote clinical reasoning
//      would be writing its own. The register is the product's: "review suggested, the decision
//      rests with the physician", never an instruction.
//   4. WHAT THE SCORE IS BEING JUDGED AGAINST. NEWS2 with its partial marking, SOFA, and the
//      Sepsis-3 context — above all `suspected_infection`, whose THREE values matter: nobody has
//      charted it (and then the sepsis branch never runs at all, so a quiet patient is not a
//      reassuring one), a physician charted yes, a physician charted no.
//
// The trends are the engine's (`trends/TrendsBox.jsx`, GET /patients/{id}/trends): the prototype
// drew a curve from the single latest value and a seeded random generator, a picture of nothing.
// The box draws the measurements the engine holds and the bands it scores with, and nothing else.
//
// `News2` and `nameOf` come from `../common/BoardState.jsx` with the rest of the shared board
// components. They were written on the bed card and moved there by the Wave 3 fix-up, because an
// import from `../beds/BedCard.jsx` is this arm reaching into another arm's file — and because the
// four `beds.*` / two `alarms.*` strings they read moved with them, to `board.*`. The two screens
// still have ONE NEWS2 and one "the HIS's name or the statement that there is none" between them,
// which is the point: a second copy of either is a second chance to get one of them wrong.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { apiErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Icon, KV, KVList, Note, RiskPill, StatusPill, riskStyle, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { hhmm } from "../../i18n/dates.js";
import {
  BoardStrip, News2, RAIL_LEFT, ScopeNote, boardKnown, nameOf, pillRisk, railOf, summaryOf,
  useBoardNow,
} from "../common/BoardState.jsx";
import { hasMeasurement } from "../common/freshness.js";
import { measuredVitals } from "../common/vitals.js";
import { useShadow } from "../../data/ShadowProvider.jsx";
import { MonitorStrip, readUnknown, stripOn } from "../common/MonitorStrip.jsx";
import { maxAgeOf } from "../common/monitor.js";
import { ageText } from "./ageText.js";
import { TrendsBox } from "./trends/TrendsBox.jsx";

const TICK_MS = 30_000;

/** Every channel the engine has a value for, with the instant and the age of each. A channel with
 *  no value is left out — not printed as a dash five times over (the wall board's rule). */
function Vitals({ patient, nowMs }) {
  const { t } = useI18n();
  const shown = measuredVitals(patient);
  if (shown.length === 0) return <p className="m-0 text-13 text-mute">{t("patient.vitalsNone")}</p>;
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
      {shown.map((v) => {
        const age = ageText(t, v.at_, nowMs);
        return (
          <div key={v.at} className="rounded-ctl border border-line bg-card px-2.5 py-2">
            <dt className={`text-10.5 font-bold uppercase leading-[normal] tracking-[.06em] ${v.color}`}>{t(v.labelKey)}</dt>
            <dd className="m-0">
              <b className="font-data text-20 font-bold text-ink">{v.value}</b>
              <small className="ml-1 font-text text-11 font-semibold text-mute">{t(v.unitKey)}</small>
              {/* The age of the value, always — a number with no age cannot be told from one that
                  stopped arriving an hour ago. */}
              <span className="mt-0.5 block text-11 text-mute">
                {v.at_ ? `${hhmm(Date.parse(v.at_))}${age ? ` · ${age}` : ""}` : t("board.notMeasured")}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** One of the engine's findings, with everything it rests on. `lang="en"` on the engine's own
 *  prose: it is written in English (reco/engine.py) and is not translated, so a screen reader
 *  should pronounce it as English rather than read English words with Azerbaijani phonetics. */
function Finding({ alarm }) {
  const { t } = useI18n();
  const severity = pillRisk(alarm.severity);
  const style = riskStyle(severity, { measured: true });
  return (
    <li className={`rounded-box border border-line bg-card px-3.5 py-3 border-l-4 ${railOf(style.tone, RAIL_LEFT)}`}>
      <div className="flex flex-wrap items-start gap-2">
        <RiskPill risk={severity} measured />
        <h3 lang="en" className="m-0 min-w-0 flex-1 font-display text-15 font-bold">{summaryOf(alarm) ?? t("board.findingUnnamed")}</h3>
        {alarm.escalated ? <StatusPill tone="att" icon="alert">{t("board.escalated")}</StatusPill> : null}
        {alarm.downgraded ? <StatusPill tone="neutral" icon="minus">{t("patient.recoDowngraded")}</StatusPill> : null}
      </div>
      <p className="m-0 mt-1 text-12.5 text-mute">{t("patient.recoDecision")}</p>
      {alarm.staleInputs.length > 0 ? (
        <p className="m-0 mt-1.5 text-12 font-semibold text-att-ink">
          {t("patient.recoStale", { list: alarm.staleInputs.join(", ") })}
        </p>
      ) : null}
      <KVList className="mt-2">
        {alarm.chronicContext ? <KV label={t("patient.recoChronic")} mono={false}>{alarm.chronicContext}</KV> : null}
        {alarm.clinicalReasoning ? (
          <KV label={t("patient.recoReasoning")} mono={false}><span lang="en">{alarm.clinicalReasoning}</span></KV>
        ) : null}
        {alarm.actions.length > 0 ? (
          <KV label={t("patient.recoActions")} mono={false}>
            <ul lang="en" className="m-0 list-disc ps-4 text-left">
              {alarm.actions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </KV>
        ) : null}
        {alarm.evidence.length > 0 ? (
          <KV label={t("patient.recoEvidence")}>{alarm.evidence.join(", ")}</KV>
        ) : null}
        {alarm.confidence ? (
          <KV label={t("patient.recoConfidence")} mono={false}><span lang="en">{alarm.confidence}</span></KV>
        ) : null}
        {alarm.ackBy ? <KV label={t("patient.seenBy", { who: alarm.ackBy })} mono={false}>{alarm.ackAtMs ? hhmm(alarm.ackAtMs) : "—"}</KV> : null}
      </KVList>
    </li>
  );
}

/** The one thing this screen writes, and the smallest write the system has: whether an infection
 *  is suspected (`POST /clinical/{id}`, one entry, permission `clinical.chart`).
 *
 *  It is here and not in Group 2 with the SOFA form because of what its absence does. Nothing in
 *  the engine's sepsis branch runs until something charts this — `septic_shock.evaluate` returns at
 *  its first line — so a septic patient on a ward where nobody can chart it is a patient the engine
 *  is silent about, and the screen that says "the sepsis rule does not run at all for this patient"
 *  would be stating a problem it was built unable to fix. One button closes that.
 *
 *  Three rules it keeps. The screen offers the clinician's judgement and never forms one: there is
 *  no default, no pre-selected answer and no suggestion of which to press, because Homunculus does
 *  not diagnose. Both answers are offered even once one has been charted — a judgement can change,
 *  and "no" after "yes" is a real clinical event, not an undo. And it says out loud, before it is
 *  pressed, that this goes into the audit trail under the clinician's own name and cannot be
 *  withdrawn: the engine keeps the latest charted value, so a correction supersedes rather than
 *  erases. Nothing here computes: the ENGINE decides what a charted "yes" means for this patient,
 *  and the board that comes back is what the screen then shows.
 *
 *  The current answer is not a disabled button or a tick: `Note` above already states it in a
 *  sentence, and a pressed-looking button would read as "this is what is true" rather than "this is
 *  what was charted, by a person, at a time". */
function Chart({ canChart, onChart, pending }) {
  const { t } = useI18n();
  if (!canChart) {
    // Why there is no button, rather than a screen that silently has fewer controls on it.
    return <p className="m-0 mt-2 text-12 text-mute">{t("patient.chartNoRight")}</p>;
  }
  // `pending` is the ANSWER in flight (`true`, `false`) or `null` — so only the button that was
  // pressed says it is working. Both going busy together told a clinician that something was
  // being charted without saying which judgement, which is the one thing that matters here.
  //
  // No `disabled`: `Button` already ignores clicks while busy and stays focusable deliberately,
  // because a natively disabled button drops the keyboard user's focus to <body> the moment it is
  // pressed — mid-write, on the only write this screen has. A second press is refused in `chart`.
  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      <p className="m-0 text-12.5 font-semibold">{t("patient.chartTitle")}</p>
      <p className="m-0 mt-0.5 text-11.5 text-mute">{t("patient.chartNote")}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <Button size="sm" icon="alert" busy={pending === true} onClick={() => onChart(true)}>
          {t("patient.chartYes")}
        </Button>
        <Button size="sm" icon="ok" busy={pending === false} onClick={() => onChart(false)}>
          {t("patient.chartNo")}
        </Button>
      </div>
      {/* A busy Button reads only "unavailable" to a screen reader; the words come from here. */}
      <Announce text={pending === null ? "" : t("patient.chartSaving")} />
    </div>
  );
}

/** What the Sepsis-3 criterion is being judged against. `suspected_infection` is THREE-valued and
 *  the difference is clinical: `null` means nobody has charted either way, and until somebody does
 *  the engine evaluates no sepsis rule at all (api/board.py `_sepsis_context`). */
function Sepsis({ sepsis, canChart, onChart, pending }) {
  const { t } = useI18n();
  // NOT `if (!sepsis) return null`. `identity_only_board` (api/board.py) omits the block
  // altogether — its comment claims "same keys as patient_board" and that is wrong — so an
  // admitted patient whose monitor has sent nothing has no context at all. Returning null there
  // took away the sentence saying the sepsis rule never ran AND the only control this screen has,
  // on exactly the card a clinician opens first. `POST /clinical/{id}` needs no sepsis block to
  // work, so the charting does not depend on one being present.
  const suspected = sepsis ? sepsis.suspected_infection : null;
  return (
    <Box title={t("patient.sepsis")} icon="flask" level={2}>
      {sepsis ? (
        <Note tone={suspected === null ? "warn" : "info"} icon={suspected === null ? "alert" : "ok"}>
          {t(suspected === null ? "patient.suspectedUnknown" : suspected ? "patient.suspectedYes" : "patient.suspectedNo")}
        </Note>
      ) : (
        <Note tone="warn" icon="alert">{t("patient.sepsisNone")}</Note>
      )}
      <Chart canChart={canChart} onChart={onChart} pending={pending} />
      {sepsis ? (
      <KVList className="mt-2">
        {/* Three numbers, three labels, one value under each. The rise is the one the criterion
            turns on — Sepsis-3 is an acute rise of ≥2 SOFA points over the patient's baseline, and
            `septic_shock.py` compares `rise`, not `sofa` — so it is the number a clinician must be
            able to read without arithmetic, and the number that must never appear under another
            number's name. It is printed, not computed: the browser does no clinical arithmetic
            (Decision 1: no screen computes a clinical value), so if the engine sends no rise this
            says "—" rather than `sofa - baseline`,
            which would be a different claim with the same shape. */}
        <KV label={t("patient.sofa")}>{sepsis.sofa ?? "—"}</KV>
        <KV label={t("patient.baseline")}>{sepsis.baseline_sofa ?? "—"}</KV>
        <KV label={t("patient.rise")}>{sepsis.rise ?? "—"}</KV>
      </KVList>
      ) : null}
      {sepsis?.baseline_assumed ? <p className="m-0 mt-1 text-12 text-att-ink">{t("patient.baselineAssumed")}</p> : null}
    </Box>
  );
}

/** The medication picture the engine publishes, with its three-valued antibiotic. `null` means
 *  nobody charted it either way; rendering that as "not given" would accuse a ward of missing a
 *  deadline it may well have met and simply not recorded here (api/board.py `_meds`). */
function Meds({ meds }) {
  const { t } = useI18n();
  if (!meds) return <Box title={t("patient.meds")} icon="syringe" level={2}><p className="m-0 text-13 text-mute">{t("patient.noMeds")}</p></Box>;
  const pressors = Object.entries(meds.pressors ?? {}).filter(([, v]) => v !== null && v !== undefined);
  const clock = meds.antibiotic_clock ?? null;
  const givenAt = meds.antibiotic_at ? Date.parse(meds.antibiotic_at) : NaN;
  const deadline = clock?.deadline ? Date.parse(clock.deadline) : NaN;
  let antibiotic;
  if (meds.antibiotic_given === null || meds.antibiotic_given === undefined) antibiotic = t("patient.antibioticUnknown");
  else if (meds.antibiotic_given && Number.isFinite(givenAt)) antibiotic = t("patient.antibioticGiven", { time: hhmm(givenAt) });
  else if (Number.isFinite(deadline)) {
    antibiotic = t(clock.remaining_sec !== null && clock.remaining_sec < 0 ? "patient.antibioticOverdue" : "patient.antibioticPending", { time: hhmm(deadline) });
  } else antibiotic = t("patient.antibioticUnknown");
  return (
    <Box title={t("patient.meds")} icon="syringe" level={2}>
      <p className="m-0 text-13">{antibiotic}</p>
      <p className="m-0 mt-1 text-13 text-mute">
        {pressors.length ? t("patient.pressors", { list: pressors.map(([k, v]) => `${k} ${v}`).join(", ") }) : t("patient.noPressors")}
      </p>
      {/* Plain lines, like the two above them, and NOT <KV> rows. `patient.weight` and
          `patient.creatinine` already carry their own number and unit inside one sentence, so as
          KV rows they were a <dt> with an empty <dd> — a definition list whose terms define
          nothing, which a screen reader reads as a label whose value is missing. */}
      {meds.weight_kg !== null && meds.weight_kg !== undefined ? (
        <p className="m-0 mt-1 text-13 text-mute">{t("patient.weight", { value: meds.weight_kg })}</p>
      ) : null}
      {meds.creatinine !== null && meds.creatinine !== undefined ? (
        <p className="m-0 mt-1 text-13 text-mute">{t("patient.creatinine", { value: meds.creatinine })}</p>
      ) : null}
    </Box>
  );
}

/** `params.id` comes from the address (shell/Shell.jsx). The patient is read from the board this
 *  session already has: there is no per-patient endpoint, and `/patients` is already filtered by
 *  the engine's scope — so a card this board does not hold is one this session may not see OR one
 *  that does not exist, and the server answers both the same way on purpose. */
export function PatientScreen({ params }) {
  const { t } = useI18n();
  const board = useBoard();
  const { user } = useSession();
  const toast = useToast();
  const nowMs = useBoardNow(TICK_MS);
  const id = params?.id ?? "";
  const patient = useMemo(() => board.patients.find((p) => p.patient_id === id) ?? null, [board.patients, id]);
  const alarms = useMemo(() => board.alerts.filter((a) => a.patientId === id), [board.alerts, id]);
  const known = boardKnown(board.connection);
  // Aşama A: the unvalidated monitor strip, ONLY for a patient the API links to exactly one monitor
  // (an admitted identity on the table's bed). No other patient gets a box, not even "no monitor":
  // the screen does not advertise monitors it cannot attribute.
  const shadow = useShadow();
  const monitor = stripOn(shadow.data)
    ? (shadow.data.beds ?? []).find((card) => card.link === "one" && card.patient_id === id) ?? null
    : null;

  // Record that a clinician opened this patient — the audit line an inspection asks for. Sent only
  // for a patient the screen actually SHOWS: the server logs a refusal as `scope_denied`, so
  // sending it for a stale bookmark would fill the trail with refusals for views that never
  // happened. Once per patient per mount; a failure is not the clinician's problem and the screen
  // carries on (the record of the board request itself is already in the trail).
  const recorded = useRef(null);
  useEffect(() => {
    if (!patient || recorded.current === id) return;
    recorded.current = id;
    board.store.view(id).catch(() => {});
  }, [patient, id, board.store]);

  const measured = hasMeasurement(patient?.measuredAt);
  // What this screen is allowed to call the patient: the bed the SERVER resolved, or the id. Never
  // `display_name` — a refusal naming a person is a claim we may not be sure of (Decision 14).
  // Declared above `chart` because its refusal names it.
  const bed = patient?.bedLabel || id;

  // Charting the suspected infection. `busy` while it is in flight (one at a time: the answer
  // reloads the board), the API's own refusal on the toast if it is refused, and nothing written
  // locally either way — a charted observation this screen showed and the server did not take
  // would be a lie with a clinician's name on it.
  // `charting` holds the ANSWER in flight (`true`/`false`) or `null`, so the screen can say which
  // judgement is being charted rather than only that something is.
  const [charting, setCharting] = useState(null);
  const canChart = user?.perms?.includes("clinical.chart") ?? false;
  // The shell renders <Screen params/> with no `key` (shell/Shell.jsx), so moving from one patient
  // to another keeps this component mounted and only changes `id` — a chart left in flight across
  // the move would otherwise leave the next patient's buttons reading as busy.
  useEffect(() => { setCharting(null); }, [id]);
  async function chart(suspected) {
    if (charting !== null) return;      // `false` is an answer, so never a truthiness test
    setCharting(suspected);
    try {
      await board.store.chart(id, [{ code: "suspected_infection", value: suspected ? 1 : 0 }]);
      // `useToast()` IS the function (ui/Toast.jsx `value={raise}`) — there is no `.show`.
      // Calling one threw inside this `try`, and the `catch` below then showed the TypeError's
      // message as a refusal for a chart the server had already taken.
      toast(t("patient.chartSaved"));
    } catch (err) {
      // ON THE TOAST, not in this screen's state. A refusal the screen owns dies with the screen,
      // so a clinician who walked away mid-write saw no error at all and would reasonably assume
      // her judgement was charted — while the engine's sepsis branch still never runs for this
      // patient. The toast's provider sits above the router, so the refusal outlives the move and
      // stays until it is dismissed. It is also the reason there is no longer any per-patient
      // error state to show on the wrong patient.
      //
      // AND IT NAMES THE PATIENT. Because it outlives the move, a refusal saying only "you do not
      // have permission" is read on someone else's screen attributed to nobody: it tells a
      // clinician that something failed and not which patient still has no suspected infection
      // charted, so she charts the wrong one or neither. The bed label when the board has one and
      // the id when it does not — never the patient's NAME, which is a claim about a person this
      // screen may not be sure of.
      toast(t("patient.chartRefused", { subject: bed, reason: apiErrorText(t, err) }), "error");
    } finally {
      setCharting(null);
    }
  }

  return (
    <div className="flex min-h-0 max-w-[1000px] flex-col gap-3">
      <p className="m-0">
        <a href="#/beds" className={`inline-flex items-center gap-1 rounded-md text-12.5 font-semibold text-pri ${FOCUS_RING}`}>
          <Icon name="chevL" size={14} />
          {t("patient.back")}
        </a>
      </p>
      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />

      {!patient ? (
        <>
          <h1 className="m-0 font-display text-23 font-bold">{t("patient.notFound")}</h1>
          <Alert tone="crit">{t(known ? "patient.notFoundHelp" : "patient.notFoundUnknown")}</Alert>
          <p className="m-0 font-data text-12.5 text-mute">{id}</p>
        </>
      ) : (
        <>
          <header className="flex flex-wrap items-start gap-3 rounded-box border border-line bg-card px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <b className="block font-data text-17 font-bold text-ink">{bed}</b>
              <h1 className={`m-0 font-display text-23 font-bold ${patient.display_name ? "" : "italic text-mute"}`}>
                {nameOf(patient, t)}
              </h1>
              {patient.bedKey && !patient.bedMatched ? (
                <p className="m-0 mt-1 text-12 font-semibold text-att-ink">{t("beds.unmatchedBed", { key: patient.bedKey })}</p>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <RiskPill risk={patient.risk} measured={measured} />
              <News2 news2={patient.news2} />
            </div>
          </header>
          <Note tone="info" icon="eye">{t("patient.onlyWrite")}</Note>

          <Box title={t("patient.vitals")} icon="activity" level={2}>
            <Vitals patient={patient} nowMs={nowMs} />
          </Box>

          {monitor ? (
            <MonitorStrip entry={monitor} variant="full" level={2} className="bg-card" nowMs={shadow.nowMs}
              fetchedAtMs={shadow.fetchedAtMs} maxAgeS={maxAgeOf(shadow.data)}
              feedOk={shadow.data.feed?.state === "ok"}
              unreadable={readUnknown(shadow, shadow.nowMs, maxAgeOf(shadow.data))} />
          ) : null}

          <section className="grid gap-2">
            <h2 className="m-0 font-text text-11 font-bold uppercase leading-[normal] tracking-[.08em] text-mute">{t("patient.reco")}</h2>
            {alarms.length === 0 ? (
              <Note tone={known ? "info" : "warn"} icon={known ? "ok" : "alert"}>
                {t(known ? "patient.recoNone" : "patient.recoNoneUnknown")}
              </Note>
            ) : (
              <>
                <ul className="m-0 grid list-none gap-2 p-0">
                  {alarms.map((a) => <Finding key={a.id} alarm={a} />)}
                </ul>
                <p className="m-0 text-11.5 text-mute">{t("patient.recoLanguage")}</p>
              </>
            )}
          </section>

          <div className="grid gap-2 min-[861px]:grid-cols-2">
            <Sepsis sepsis={patient.sepsis} canChart={canChart} onChart={chart} pending={charting} />
            <Meds meds={patient.meds} />
          </div>
          {/* The one seam left: the SOFA form is Group 3's, and the screen says so where it will go. */}
          <Note tone="info" icon="clock">{t("patient.formsSoon")}</Note>

          <TrendsBox patient={patient} nowMs={nowMs} />
        </>
      )}
    </div>
  );
}

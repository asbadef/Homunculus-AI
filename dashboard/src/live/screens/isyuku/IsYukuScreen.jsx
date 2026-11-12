// src/live/screens/isyuku/IsYukuScreen.jsx — G4-04 «İş yükü» (spec docs/superpowers/specs/2026-11-12-g4-is-yuku-design.md,
// D6 and §5), for `workload.view` or `shifts.manage`. Top to bottom: the header (the shift, «HH:MM itibarıyla», «Sayım,
// puan değil · kişiler sıralanmaz», «Yenile»), the units table for this shift, the unit picker with the nurse cards
// (alphabetical; beds, patients, «Kalan iş») and the unassigned beds, and — with `shifts.manage` only — «Nöbet ataması»
// for the chosen unit. The rules are isyuku.js's; this file words them. Every number is real or a «—» with its reason
// (Decision 18). No patient's name or id anywhere. Read on open, on «Yenile» and every 60 s while visible: G4-02's reads
// (useSummaryReads) with GET /shift-schedule and /tasks over its shift in the same round; the form reads its own unit
// and window.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { hhmm } from "../../i18n/dates.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { useSnoozeClock } from "../../data/useSnoozeClock.js";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, Field, Note, Seg, Select, Table } from "../../ui/index.js";
import { WHY, reachSource, readSource, structureSource } from "../ozet/ozet.js";
import { useSummaryReads } from "../ozet/useSummaryReads.js";
import {
  ALL, NO_NURSE, SHIFT_CHANGED, boardWork, formModel, isNursesAnswer, isScheduleAnswer, isWorkAnswer, meanOf, readWorkAlone,
  readWorkAndTasks, saveBody, workSources, workloadPage, workloadRights,
} from "./isyuku.js";

const COLUMNS = Object.freeze([
  "isyuku.units.colUnit", "isyuku.units.colPatients", "isyuku.units.colNurses", "isyuku.units.colRatio",
  "isyuku.units.colUnassigned", "isyuku.units.colLate", "isyuku.units.colRemaining", "isyuku.units.colWaiting",
]);

/** A number with one decimal as the reader writes it: a decimal comma in tr, az and ru, a point in en. */
const decimal = (lang, n) => (lang === "en" ? n.toFixed(1) : n.toFixed(1).replace(".", ","));

/** This page's own reasons (`isyuku.why.*`); every other is the summary page's (`ozet.why.*`). */
const OWN_REASONS = new Set([SHIFT_CHANGED, NO_NURSE]);
const whyText = (t, why) => t(OWN_REASONS.has(why) ? `isyuku.why.${why}` : `ozet.why.${why}`);

/** «—» and why (ozet's `Missing`, with this page's own reasons: «nöbet değişti», «atanmış hemşire yok»). */
function Gap({ t, why }) {
  return (
    <span data-missing={why}>
      <span className="font-data font-bold">—</span>{" "}
      <span className="text-12 font-normal text-mute">{whyText(t, why)}</span>
    </span>
  );
}

/** A cell's text, or «—» and why. */
const figure = (t, cell, render = (c) => c.value) => ("why" in cell ? <Gap t={t} why={cell.why} /> : render(cell));

function ShiftLine({ t, page }) {
  if (!page.shift) return <p className="m-0 text-13 font-semibold" data-shift>{t("isyuku.shift.label")} <Gap t={t} why={page.shiftWhy} /></p>;
  return (
    <p className="m-0 text-13 font-semibold" data-shift>
      {t("isyuku.shift.current", { from: hhmm(page.shift.startMs), to: hhmm(page.shift.endMs) })}
    </p>
  );
}

function UnitRow({ t, lang, row }) {
  const { patients, nurses, ratio, unassigned, late, remaining, waiting } = row.cells;
  const ratioText = (c) => (c.none ? <Gap t={t} why={NO_NURSE} /> : `${t("isyuku.units.ratio", { patients: c.patients, nurses: c.nurses })} · ${
    t("isyuku.units.mean", { mean: decimal(lang, meanOf(c.patients, c.nurses)) })}`);
  return (
    <tr>
      <th scope="row">{row.name}</th>
      <td className="font-data">{figure(t, patients)}</td>
      <td className="font-data">{figure(t, nurses, (c) => (c.none ? t("isyuku.units.noAssignment") : c.value))}</td>
      <td className="font-data">{figure(t, ratio, ratioText)}</td>
      <td className="font-data">{figure(t, unassigned)}</td>
      <td className="font-data">{figure(t, late)}</td>
      <td className="font-data">{figure(t, remaining)}</td>
      <td className="font-data">{figure(t, waiting)}</td>
    </tr>
  );
}

function UnitsBox({ t, lang, page }) {
  let body;
  if (page.rows === null) {
    body = page.why === WHY.loading ? <p className="m-0 text-13 text-mute">{t("isyuku.units.loading")}</p>
      : <Note tone="warn">{t("isyuku.units.missing", { why: whyText(t, page.why) })}</Note>;
  } else if (page.rows.length === 0) {
    body = <p className="m-0 text-13 text-mute">{t("isyuku.units.none")}</p>;
  } else {
    body = (
      <>
        {page.otherRows ? <Note tone="warn">{t("isyuku.units.otherRows")}</Note> : null}
        <Table caption={t("isyuku.units.caption")}>
          <thead><tr>{COLUMNS.map((key) => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
          <tbody>{page.rows.map((row) => <UnitRow key={row.key} t={t} lang={lang} row={row} />)}</tbody>
        </Table>
        <p className="m-0 text-12 text-mute">{t("isyuku.units.note")}</p>
      </>
    );
  }
  return (
    <Box title={t("isyuku.units.title")} icon="building" level={2}>
      <div className="flex flex-col gap-2" data-units>{body}</div>
    </Box>
  );
}

function NurseCard({ t, card }) {
  const line = (key, value) => <p className="m-0 text-12.5"><span className="text-mute">{t(key)}: </span>{value}</p>;
  return (
    <li className="flex min-w-[220px] flex-1 flex-col gap-1 rounded-box border border-line bg-card px-[14px] py-3" data-nurse>
      <h3 className="m-0 font-text text-13 font-semibold">{card.label}</h3>
      {line("isyuku.nurses.beds", card.beds.join(", "))}
      {line("isyuku.nurses.patients", figure(t, card.patients))}
      {line("isyuku.nurses.tasks", figure(t, card.tasks))}
    </li>
  );
}

function Unassigned({ t, unassigned }) {
  let body;
  if ("why" in unassigned) body = <Gap t={t} why={unassigned.why} />;
  else if (unassigned.beds.length === 0) body = <span className="text-mute">{t("isyuku.nurses.unassignedNone")}</span>;
  else body = unassigned.beds.join(", ");
  return (
    <div className="flex flex-col gap-1" data-unassigned>
      <h3 className="m-0 font-text text-13 font-semibold">{t("isyuku.nurses.unassigned")}</h3>
      <p className="m-0 text-13">{body}</p>
    </div>
  );
}

function NursesBox({ t, page, onSelect }) {
  const chosen = page.choices.find((row) => row.key === page.selected);
  let body;
  if (page.cards === null) body = <Note tone="warn">{t("isyuku.nurses.missing", { why: whyText(t, page.cardsWhy) })}</Note>;
  else {
    body = (
      <>
        <p className="m-0 text-12 font-semibold">{t("isyuku.nurses.note")}</p>
        {page.cards.length === 0 ? <p className="m-0 text-13 text-mute">{t("isyuku.nurses.none")}</p> : (
          <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
            {page.cards.map((card) => <NurseCard key={card.key} t={t} card={card} />)}
          </ul>
        )}
        <Unassigned t={t} unassigned={page.unassigned} />
      </>
    );
  }
  return (
    <Box title={t("isyuku.nurses.title", { unit: chosen ? chosen.name : t("isyuku.pick.all") })} icon="users" level={2}>
      <div className="flex flex-col gap-2" data-nurses>
        {page.choices.length > 0 ? (
          <Field label={t("isyuku.pick.label")} layout="col" className="max-w-[320px]">
            <Select value={page.selected} onChange={(event) => onSelect(event.target.value)}>
              <option value={ALL}>{t("isyuku.pick.all")}</option>
              {page.choices.map((row) => <option key={row.key} value={row.key}>{row.name}</option>)}
            </Select>
          </Field>
        ) : null}
        {body}
      </div>
    </Box>
  );
}

/** The form's two reads — the unit's rows of the window and the people offered — on open, on a change of window, and on
 *  `reload` (after a save, a 409, «Yeniden dene»). The newest read wins. */
function useAssignment(store, unitId, which) {
  const [state, setState] = useState({ phase: "loading", schedule: null, nurses: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => { setAttempt((n) => n + 1); }, []);
  useEffect(() => {
    let alive = true;
    setState({ phase: "loading", schedule: null, nurses: null, error: null });
    Promise.all([store.track(() => store.api.shiftSchedule(which, unitId)), store.track(() => store.api.shiftNurses(unitId))])
      .then(([schedule, nurses]) => {
        if (!alive) return;
        setState(isScheduleAnswer(schedule) && isNursesAnswer(nurses)
          ? { phase: "ok", schedule, nurses, error: null } : { phase: "failed", schedule: null, nurses: null, error: null });
      }, (error) => { if (alive) setState({ phase: "failed", schedule: null, nurses: null, error }); });
    return () => { alive = false; };
  }, [store, unitId, which, attempt]);
  return { ...state, reload };
}

function Outcome({ t, outcome }) {
  if (!outcome) return null;
  if (outcome.kind === "saved") {
    return (
      <div className="flex flex-col gap-1">
        <Note tone="info">{t("isyuku.form.saved")}</Note>
        {outcome.warnings.map((w) => (
          <Note key={w.nurse_id} tone="warn">{t("isyuku.form.warnUnreached", { name: w.name ?? t("isyuku.form.someone") })}</Note>
        ))}
      </div>
    );
  }
  const words = { conflict: t("isyuku.err.conflict"), shiftChanged: t("isyuku.err.shiftChanged"),
    refused: outcome.error ? t("isyuku.form.refused", { reason: readErrorText(t, outcome.error) }) : null };
  return <Alert tone="crit"><p className="m-0">{words[outcome.kind]}</p></Alert>;
}

/** «Nöbet ataması» for one listed unit (the parent keys it by the unit, so another unit starts afresh). Drawn only when
 *  its two reads and the structure have answered (§5 A6); the choices are built from the read once and kept — the poll
 *  does not rebase a form being edited (A7). */
function AssignmentBox({ t, lang, store, row, structure, onSaved }) {
  const [which, setWhich] = useState("current");
  const read = useAssignment(store, row.id, which);
  const [choices, setChoices] = useState(null);       // bed key → nurse id ("": nobody)
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const model = useMemo(() => (read.phase === "ok" ? formModel({ row, schedule: read.schedule, nurses: read.nurses, lang }) : null),
    // Only a new read rebuilds the model: a poll that redraws the beds must not undo what she picked.
    [read.phase, read.schedule, read.nurses, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setChoices(model ? new Map(model.beds.map((bed) => [bed.key, bed.held])) : null); }, [model]);

  const save = async () => {
    if (saving || !model || !choices) return;
    setSaving(true);
    setOutcome(null);
    const names = new Map(model.beds.flatMap((bed) => bed.people).map((person) => [person.key, person.name]));
    try {
      const answer = await store.track(() => store.api.saveShiftSchedule(saveBody(model, choices)));
      const warnings = Array.isArray(answer?.warnings) ? answer.warnings : [];
      setOutcome({ kind: "saved", warnings: warnings.map((w) => ({ ...w, name: names.get(w.nurse_id) ?? null })) });
      read.reload();
      onSaved();
    } catch (error) {
      if (error?.status === 409) {
        setOutcome({ kind: error.apiCode === "shift_changed" ? "shiftChanged" : "conflict" });
        read.reload();
        onSaved();
      } else setOutcome({ kind: "refused", error });
    } finally {
      setSaving(false);
    }
  };

  let body;
  if (!structure.ok) body = <Note tone="warn">{t("isyuku.form.missing", { why: whyText(t, structure.why) })}</Note>;
  else if (read.phase === "loading" || (read.phase === "ok" && choices === null)) {
    body = <p className="m-0 text-13 text-mute">{t("isyuku.form.loading")}</p>;
  } else if (read.phase === "failed") {
    body = (
      <Alert tone="crit">
        <p className="m-0">{read.error ? t("isyuku.form.failed", { reason: readErrorText(t, read.error) }) : t("isyuku.form.unreadable")}</p>
        <Button size="sm" onClick={read.reload}>{t("admin.retry")}</Button>
      </Alert>
    );
  } else if (model.beds.length === 0) {
    body = <p className="m-0 text-13 text-mute">{t("isyuku.form.noBeds")}</p>;
  } else {
    const note = (person) => (person.note ? ` — ${t(`isyuku.form.${person.note}`)}` : "");
    body = (
      <>
        <p className="m-0 text-13 font-semibold">
          {t(`isyuku.shift.${which}`, { from: hhmm(Date.parse(model.shift.start)), to: hhmm(Date.parse(model.shift.end)) })}
        </p>
        {model.otherRows > 0 ? <Note tone="warn">{t("isyuku.units.otherRows")}</Note> : null}
        {model.noneOffered ? <Note tone="warn">{t("isyuku.form.noNurses")}</Note> : null}
        <div className="grid gap-x-3 min-[861px]:grid-cols-2">
          {model.beds.map((bed) => (
            <Field key={bed.key} label={bed.label} layout="col">
              <Select value={choices.get(bed.key) ?? ""}
                onChange={(event) => { const next = new Map(choices); next.set(bed.key, event.target.value); setChoices(next); }}>
                <option value="">{t("isyuku.form.empty")}</option>
                {bed.people.map((person) => <option key={person.key} value={person.key}>{`${person.label}${note(person)}`}</option>)}
              </Select>
            </Field>
          ))}
        </div>
        <div><Button variant="primary" size="sm" busy={saving} onClick={save}>{t("isyuku.form.save")}</Button></div>
      </>
    );
  }
  const options = [{ value: "current", label: t("isyuku.form.current") }, { value: "next", label: t("isyuku.form.next") }];
  return (
    <Box title={t("isyuku.form.title", { unit: row.name })} icon="edit" level={2}
      right={<Seg label={t("isyuku.form.which")} options={options} value={which}
        onChange={(next) => { setWhich(next); setOutcome(null); }} />}>
      <div className="flex flex-col gap-2" data-form>
        {body}
        <Outcome t={t} outcome={outcome} />
      </div>
    </Box>
  );
}

export function IsYukuScreen() {
  const { t, lang } = useI18n();
  const { user, store } = useSession();
  const board = useBoard();
  const boardNowMs = useSnoozeClock();
  const tree = useStructure();
  const rights = useMemo(() => workloadRights(user?.perms), [user?.perms]);
  // G4-02's round without its own /tasks read (this page reads /tasks over the shift, in `extra`) or the handovers.
  const summaryRights = useMemo(() => ({ structure: rights.structure, tasks: false, pending: false }), [rights.structure]);
  const extra = useMemo(() => ({ may: rights.schedule, read: rights.tasks ? readWorkAndTasks : readWorkAlone,
    valid: isWorkAnswer }), [rights.schedule, rights.tasks]);
  const reads = useSummaryReads({ store, rights: summaryRights, reloadStructure: tree.reload, extra });
  const [selected, setSelected] = useState(ALL);
  const occupancy = structureSource(tree, rights.structure);
  const { schedule, tasks } = workSources(reads.extra, rights, Date.now());
  const page = workloadPage({
    tree: tree.known ? tree.structure : null, occupancy, reach: reachSource(readSource(reads.scope, true)),
    wholeTree: rights.wholeTree, schedule, tasks,
    board: boardWork({ connection: board.connection, patients: board.patients, alerts: board.alerts, nowMs: boardNowMs },
      rights.board),
  }, { selected, lang });
  const chosen = page.choices.find((row) => row.key === page.selected) ?? null;
  const formable = rights.manage && page.choices.length > 0;

  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-23 font-bold">{t("isyuku.title")}</h1>
          <ShiftLine t={t} page={page} />
          <p className="m-0 text-13 text-mute" data-as-of>
            {reads.fullAt ? t("ozet.asOf", { time: hhmm(reads.fullAt) }) : t("ozet.noFullRead")}
          </p>
          <p className="m-0 text-13 font-semibold">{t("isyuku.motto")}</p>
        </div>
        <Button size="sm" icon="clock" busy={reads.busy} onClick={reads.refresh}>{t("ozet.refresh")}</Button>
      </div>
      <p className="m-0 text-13 text-mute">{t("isyuku.intro")}</p>
      <UnitsBox t={t} lang={lang} page={page} />
      <NursesBox t={t} page={page} onSelect={setSelected} />
      {formable && chosen ? (
        <AssignmentBox key={chosen.key} t={t} lang={lang} store={store} row={chosen} structure={occupancy}
          onSaved={reads.refresh} />
      ) : null}
      {formable && !chosen ? (
        <Box title={t("isyuku.form.title", { unit: t("isyuku.pick.all") })} icon="edit" level={2}>
          <div className="flex flex-col gap-2" data-form><p className="m-0 text-13 text-mute">{t("isyuku.form.pickUnit")}</p></div>
        </Box>
      ) : null}
    </div>
  );
}

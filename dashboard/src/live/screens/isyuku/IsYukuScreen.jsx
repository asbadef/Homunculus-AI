// src/live/screens/isyuku/IsYukuScreen.jsx — G4-04 «İş yükü» (spec docs/superpowers/specs/2026-11-12-g4-is-yuku-design.md,
// D6 and §5), for `workload.view` or `shifts.manage`. Top to bottom: the header (the shift, «HH:MM itibarıyla», «Sayım,
// puan değil · kişiler sıralanmaz», «Yenile»), the units table for this shift, the unit picker with the nurse cards
// (alphabetical; beds, patients, «Kalan iş») and the unassigned beds, and — with `shifts.manage` only — «Nöbet ataması»
// for the chosen unit. The rules are isyuku.js's; this file words them. Every number is real or a «—» with its reason
// (Decision 18). No patient's name or id anywhere. Read on open, on «Yenile» and every 60 s while visible: G4-02's reads
// (useSummaryReads) with GET /shift-schedule and /tasks over its shift in the same round; the form reads its own unit
// and window.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { hhmm } from "../../i18n/dates.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { useSnoozeClock } from "../../data/useSnoozeClock.js";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Field, Note, Seg, Select, Table } from "../../ui/index.js";
import { WHY, boardReachSource, reachSource, readSource, structureSource } from "../ozet/ozet.js";
import { useSummaryReads } from "../ozet/useSummaryReads.js";
import { useShiftEnd } from "./useShiftEnd.js";
import {
  ALL, NO_NURSE, NO_UNITS, SHIFT_CHANGED, boardWork, formModel, isNursesAnswer, isScheduleAnswer, isWholeWork, isWorkAnswer,
  listedKeysOf, meanOf,
  readWorkAlone,
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

function NursesBox({ t, page, onSelect, locked }) {
  const chosen = page.choices.find((row) => row.key === page.selected);
  let body;
  if (page.cards === null && page.cardsWhy === NO_UNITS) {
    body = <p className="m-0 text-13 text-mute">{t("isyuku.units.none")}</p>;           // the table's own words
  } else if (page.cards === null) {
    body = <Note tone="warn">{t("isyuku.nurses.missing", { why: whyText(t, page.cardsWhy) })}</Note>;
  } else {
    body = (
      <>
        <p className="m-0 text-12 font-semibold">{t("isyuku.nurses.note")}</p>
        {page.partial ? <p className="m-0 text-12 text-mute" data-partial>{t("isyuku.nurses.partial")}</p> : null}
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
            <Select value={page.selected} disabled={locked} onChange={(event) => onSelect(event.target.value)}>
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

const FORM_LOADING = Object.freeze({ phase: "loading", schedule: null, nurses: null, error: null, busy: false });

/** The form's two reads — the unit's rows of the window and the people offered — on open, on a change of window, and on
 *  `reload` (after a save, a 409, «Yeniden dene»). The newest read wins. Another window starts afresh (what is held is
 *  not its own); the same window read again keeps what it holds on screen, `busy`, until the new answer lands — so the
 *  form, and the button she pressed, stay where they are (review 10). */
function useAssignment(store, unitId, which) {
  const [state, setState] = useState(FORM_LOADING);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => { setAttempt((n) => n + 1); }, []);
  const readFor = useRef(null);
  useEffect(() => {
    let alive = true;
    const again = readFor.current === which;
    readFor.current = which;
    setState((held) => (again && held.phase === "ok" ? { ...held, busy: true } : FORM_LOADING));
    Promise.all([store.track(() => store.api.shiftSchedule(which, unitId)), store.track(() => store.api.shiftNurses(unitId))])
      .then(([schedule, nurses]) => {
        if (!alive) return;
        setState(isScheduleAnswer(schedule) && isNursesAnswer(nurses)
          ? { phase: "ok", schedule, nurses, error: null, busy: false }
          : { phase: "failed", schedule: null, nurses: null, error: null, busy: false });
      }, (error) => { if (alive) setState({ phase: "failed", schedule: null, nurses: null, error, busy: false }); });
    return () => { alive = false; };
  }, [store, unitId, which, attempt]);
  return { ...state, reload };
}

function Outcome({ t, outcome }) {
  if (!outcome) return null;
  if (outcome.kind === "saved") {
    // What she sees: the confirmation and each soft warning in its own tone. What a screen reader says: all of it, once,
    // politely (review 10) — the boxes are hidden from it, as an info Alert's is, so nothing is read twice.
    const warnings = outcome.warnings.map((w) => ({ key: w.nurse_id,
      text: t("isyuku.form.warnUnreached", { name: w.name ?? t("isyuku.form.someone") }) }));
    return (
      <div className="flex flex-col gap-1" data-outcome>
        <div aria-hidden="true" className="flex flex-col gap-1">
          <Note tone="info">{t("isyuku.form.saved")}</Note>
          {warnings.map((w) => <Note key={w.key} tone="warn">{w.text}</Note>)}
        </div>
        <Announce text={[t("isyuku.form.saved"), ...warnings.map((w) => w.text)].join(" ")} />
      </div>
    );
  }
  const words = { conflict: t("isyuku.err.conflict"), shiftChanged: t("isyuku.err.shiftChanged"),
    refused: outcome.error ? t("isyuku.form.refused", { reason: readErrorText(t, outcome.error) }) : null };
  return <Alert tone="crit"><p className="m-0">{words[outcome.kind]}</p></Alert>;
}

/** «Nöbet ataması» for one listed unit (the parent keys it by the unit, so another unit starts afresh). Drawn only when
 *  its two reads and the structure have answered (§5 A6); the choices are built from the read once and kept — the poll
 *  does not rebase a form being edited (A7), nor does a change of language (it re-sorts the people only, review 6).
 *  While a save is on its way, or the form is read again after one, nothing she could change moves: the window, the
 *  pickers and — through `onLock` — the unit (review 5). */
function AssignmentBox({ t, lang, store, row, structure, onSaved, onLock }) {
  const [which, setWhich] = useState("current");
  const read = useAssignment(store, row.id, which);
  const [choices, setChoices] = useState(null);       // bed key → nurse id ("": nobody)
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const model = useMemo(() => (read.phase === "ok" ? formModel({ row, schedule: read.schedule, nurses: read.nurses, lang }) : null),
    // A poll that redraws the beds does not rebuild it; a new read or another language (the people's order) does.
    [read.phase, read.schedule, read.nurses, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  // The picks are reset to what is held only when a new read lands — never by another language's model (review 6).
  useEffect(() => { setChoices(model ? new Map(model.beds.map((bed) => [bed.key, bed.held])) : null); },
    [read.phase, read.schedule, read.nurses]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = saving || read.busy;
  // The unit too, through the read after the save: another unit then would unmount the box before its outcome is seen.
  useEffect(() => { onLock(locked); }, [onLock, locked]);
  useEffect(() => () => onLock(false), [onLock]);

  const save = async () => {
    if (locked || !model || !choices) return;
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
              <Select value={choices.get(bed.key) ?? ""} disabled={locked}
                onChange={(event) => { const next = new Map(choices); next.set(bed.key, event.target.value); setChoices(next); }}>
                <option value="">{t("isyuku.form.empty")}</option>
                {bed.people.map((person) => <option key={person.key} value={person.key}>{`${person.label}${note(person)}`}</option>)}
              </Select>
            </Field>
          ))}
        </div>
        <div><Button variant="primary" size="sm" busy={locked} onClick={save}>{t("isyuku.form.save")}</Button></div>
      </>
    );
  }
  const options = [{ value: "current", label: t("isyuku.form.current") }, { value: "next", label: t("isyuku.form.next") }];
  return (
    <Box title={t("isyuku.form.title", { unit: row.name })} icon="edit" level={2}
      right={<Seg label={t("isyuku.form.which")} options={options} value={which} disabled={locked}
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
    valid: isWorkAnswer, full: isWholeWork }), [rights.schedule, rights.tasks]);
  const reads = useSummaryReads({ store, rights: summaryRights, reloadStructure: tree.reload, extra });
  const [selected, setSelected] = useState(ALL);
  // A save on its way, and the form's read after it, hold the unit too: another unit would unmount the form and hide its
  // outcome (review 5).
  const [formLocked, setFormLocked] = useState(false);
  const occupancy = structureSource(tree, rights.structure);
  // The server decides which shift is current: an answer's end is judged on its clock — this browser's corrected by the
  // skew the API client measured on its latest answer (unknown is 0; renewed with every answer, the page's own reads
  // included, so it holds without board.view — the board's is measured only when it loads) — and the page reads again
  // when it comes (review 7, re-review 1).
  const apiSkewMs = typeof store.api?.serverClockSkewMs === "function" ? store.api.serverClockSkewMs() : null;
  const skewMs = Number.isFinite(apiSkewMs) ? apiSkewMs : 0;
  const { schedule, tasks } = workSources(reads.extra, rights, Date.now() + skewMs);
  const endMs = reads.extra.phase === "ok" && isWorkAnswer(reads.extra.data) ? Date.parse(reads.extra.data.schedule.shift.end)
    : null;
  useShiftEnd({ endMs, skewMs, onEnd: reads.refresh });
  // The units the last fresh answer listed, kept while a read fails or its shift ends, so the unit picker and the form
  // being edited stay (§5 A7, review 1). A text, so the effect runs only when the listing changes.
  const fresh = schedule.ok ? listedKeysOf(schedule.data) : null;
  const [keptKeys, setKeptKeys] = useState(null);
  useEffect(() => { if (fresh !== null) setKeptKeys(fresh); }, [fresh]);
  const kept = useMemo(() => (keptKeys === null ? null : new Set(keptKeys.split(" ").filter(Boolean))), [keptKeys]);
  const boardSrc = boardWork({ connection: board.connection, patients: board.patients, alerts: board.alerts, nowMs: boardNowMs },
    rights.board);
  const page = workloadPage({
    tree: tree.known ? tree.structure : null, occupancy, reach: reachSource(readSource(reads.scope, true)),
    // The alarm column and the cards' «Kalan iş» keep the scope the engine applied to her board, from the same answer
    // as its counts (as «Yönetici özeti»).
    boardReach: boardReachSource(board.scope, boardSrc),
    wholeTree: rights.wholeTree, schedule, tasks, board: boardSrc,
  }, { selected, lang, kept });
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
      <NursesBox t={t} page={page} onSelect={setSelected} locked={formLocked} />
      {formable && chosen ? (
        <AssignmentBox key={chosen.key} t={t} lang={lang} store={store} row={chosen} structure={occupancy}
          onSaved={reads.refresh} onLock={setFormLocked} />
      ) : null}
      {formable && !chosen ? (
        <Box title={t("isyuku.form.title", { unit: t("isyuku.pick.all") })} icon="edit" level={2}>
          <div className="flex flex-col gap-2" data-form><p className="m-0 text-13 text-mute">{t("isyuku.form.pickUnit")}</p></div>
        </Box>
      ) : null}
    </div>
  );
}

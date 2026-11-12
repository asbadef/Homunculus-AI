// src/live/screens/isyuku/isyuku.js — G4-04 «İş yükü» (spec docs/superpowers/specs/2026-11-12-g4-is-yuku-design.md D6,
// §5), pure: the page's sources once Decision 18 is applied, the per-unit join — the structure × the shift's nurse–bed
// assignment × the task queue × the live board — and the assignment form's model. IsYukuScreen.jsx only words it.
//
// THE READ. One round (useSummaryReads' `extra`): GET /shift-schedule for the current window, then /tasks over the week
// that ends with that shift (`from` = its end − 7 days, `to` = its end: the widest range /tasks takes, §5 A4) — so a task
// already late at the shift change is counted and tomorrow's are not. An answer whose shift has ended is «nöbet
// değişti, yenileniyor» until the next read, and so is the task read made over it (A6).
//
// THE ROWS are the tree's open units (a closed unit has no open bed: no patient, nothing to assign). A CELL is a count
// from its sources, or why not (ozet.js WHY, and this page's SHIFT_CHANGED):
//   «Hasta» — the tree (Doluluk's occupied beds: OCCUPIED and the two pending states, open beds only); «yetki yok» for a
//     unit outside the caller's reach unless the tree is the whole hospital's (`structure.manage`), as on the summary;
//   «Hemşire», «Hemşire başına hasta», «Atanmamış hasta» — the assignment (its rows on the unit's open beds only) and the
//     tree; «yetki yok» for a unit the GET does not list (out of her unit reach); «Bu nöbet için atama yok» only from a
//     fresh answer that lists the unit with no row;
//   «Geciken iş» — open hand tasks the server marks late and a vital task in state late (ozet.js `lateOf`); «Kalan iş» —
//     open hand tasks NOT late, due before the shift ends; vital tasks are not in it (A4); both by the card's unit;
//   «Yanıt bekleyen alarm» — the live board's `needsAnswer`, LIVE only (ozet.js `boardSource`);
//   a task cell is «yetki yok» for a unit outside her reach (GET /scope/me); the alarm column keeps the live board's
//     own scope (ozet.js `boardReachSource`), so its counts and their cut come from one answer — the board's scope is
//     renewed only with the board, and a unit granted since would read 0 under /scope/me's newer reach. As on the
//     summary.
//
// THE NURSE CARDS, for the selection (one listed unit, or all): one per nurse with a row on an open bed there,
// alphabetical in the reader's language (two of one name told apart by their user names, A11) — her beds by their
// structure name, her patients (the occupied ones) and «Kalan iş» of those patients; no late work and no alarm count
// (A13: late work belongs to the unit). /tasks names no bed, so a card's patients are found through the live board — an
// assigned bed → the board card on it → that patient's /tasks entry (A5); without a LIVE board the cell says why, and
// a card with a bed outside her reach or the board's scope says «yetki yok». Then the occupied beds nobody has
// («Atanmamış»).
//
// Counts only: no score, no target ratio. No patient's name or id: beds by their structure name, nurses by name.
import { bedLabel, indexStructure, normId } from "../../data/structure.js";
import { WITH_PATIENT, withOpen } from "../doluluk/occupancy.js";
import {
  WHY, boardSource, isObject, isTasksAnswer, lateOf, listOf, msOf, noSource, okSource, readSource, rightsOf,
} from "../ozet/ozet.js";

/** The selection «Tüm birimler». A unit's own key is its id (normId). */
export const ALL = "*";
/** This page's own reason (§5 A6): the answer's shift has ended; the next read is coming. */
export const SHIFT_CHANGED = "shiftChanged";
/** This page's own reason for the ratio's «—»: the unit has no nurse this shift, so there is nothing to divide by. */
export const NO_NURSE = "noNurse";
/** Why the cards and the unassigned beds are not drawn when the tree has no open unit: the table's own «Açık birim
 *  yok.», never «yetki yok» (re-review 3). */
export const NO_UNITS = "noUnits";
/** The widest range GET /tasks takes (api/tasks.py MAX_WINDOW). */
export const TASKS_SPAN_MS = 7 * 24 * 60 * 60_000;

const isCount = (value) => Number.isInteger(value) && value >= 0;

/** GET /shift-schedule as this page reads it: the window, the server's time, and units each with an id, a name, a count
 *  of other windows' rows and items each naming a bed and a nurse. Anything else is a failed read. */
export function isScheduleAnswer(answer) {
  return isObject(answer) && isObject(answer.shift) && msOf(answer.shift.start) !== null
    && msOf(answer.shift.end) !== null && (answer.shift.which === "A" || answer.shift.which === "B")
    && msOf(answer.generated_at) !== null && Array.isArray(answer.units)
    && answer.units.every((u) => isObject(u) && typeof u.unit_id === "string" && typeof u.unit_name === "string"
      && isCount(u.other_rows) && Array.isArray(u.items) && u.items.every((i) => isObject(i)
        && typeof i.bed_id === "string" && typeof i.nurse_id === "string" && typeof i.nurse_name === "string"
        && typeof i.nurse_username === "string"));
}

/** GET /shift-schedule/nurses: [{id, name, username, reaches_unit}]. */
export const isNursesAnswer = (answer) => Array.isArray(answer) && answer.every((person) => isObject(person)
  && typeof person.id === "string" && typeof person.name === "string" && typeof person.username === "string"
  && typeof person.reaches_unit === "boolean");

/** The round's read: the current shift, then — when the session may (`tasks.view`) — /tasks over the week ending with
 *  it. A failed task read keeps the schedule (its own reason, `tasks.ok: false`); a session that ended is not
 *  swallowed. */
export async function readWork(api, mayTasks) {
  const schedule = await api.shiftSchedule("current");
  if (!mayTasks || !isScheduleAnswer(schedule)) return { schedule, tasks: null };
  const end = schedule.shift.end;
  try {
    return { schedule, tasks: { ok: true, data: await api.tasks(new Date(Date.parse(end) - TASKS_SPAN_MS).toISOString(), end) } };
  } catch (error) {
    if (error?.sessionEnded) throw error;
    return { schedule, tasks: { ok: false, error } };
  }
}
/** The two forms of the read useSummaryReads takes as `extra.read` (module constants: a new function each render would
 *  read again each render). */
export const readWorkAndTasks = (api) => readWork(api, true);
export const readWorkAlone = (api) => readWork(api, false);
export const isWorkAnswer = (answer) => isScheduleAnswer(answer?.schedule);

/** What the page's sources need, by the API's own rules: the summary's (ozet.js `rightsOf`) without the waiting
 *  handovers; the shift's read for either key; the form for `shifts.manage`. */
export function workloadRights(perms) {
  const has = (key) => Array.isArray(perms) && perms.includes(key);
  return { ...rightsOf(perms), pending: false, schedule: has("workload.view") || has("shifts.manage"),
    manage: has("shifts.manage") };
}

/** The task answer for «Geciken iş» and «Kalan iş»: G4-02's shape (ozet.js `isTasksAnswer`) and each hand task's state
 *  and due time. */
const isWorkTasks = (answer) => isTasksAnswer(answer) && answer.patients.every((patient) => patient.tasks
  .every((task) => typeof task.state === "string" && msOf(task.due_at) !== null));

/** useSummaryReads' `extra.full`: the round's answer is whole when its task read answered in this page's shape, or was
 *  not to be made (no `tasks.view`). A failed one keeps «HH:MM itibarıyla» where it was (review 4). */
export const isWholeWork = (answer) => answer?.tasks === null
  || (answer?.tasks?.ok === true && isWorkTasks(answer.tasks.data));

/** The round's read (`readSource`-shaped, from useSummaryReads' `extra`) as the page's two sources at `nowMs`: the
 *  schedule, and the task queue read over it. An answer whose shift has ended is SHIFT_CHANGED, both of them (A6). */
export function workSources(read, rights, nowMs) {
  const work = readSource(read, rights.schedule);
  const noTasks = noSource(WHY.noRight);
  if (!work.ok) return { schedule: work, tasks: rights.tasks ? work : noTasks };
  const { schedule, tasks } = work.data;
  if (msOf(schedule.shift.end) <= nowMs) {
    const ended = noSource(SHIFT_CHANGED);
    return { schedule: ended, tasks: rights.tasks ? ended : noTasks };
  }
  let taskSource = noTasks;
  if (rights.tasks && tasks?.ok) taskSource = isWorkTasks(tasks.data) ? okSource(tasks.data, work.atMs) : noSource(WHY.failed);
  else if (rights.tasks) taskSource = noSource(tasks?.error?.status === 403 ? WHY.noRight : WHY.failed);
  return { schedule: okSource(schedule, work.atMs), tasks: taskSource };
}

/** The live board as the page counts it: ozet.js `boardSource` — LIVE only, its waiting alarms by the unit of their
 *  card — and the patients on each bed (the board card's `bedId`): how a nurse card finds its patients (A5). */
export function boardWork(board, mayRead) {
  const base = boardSource(board, mayRead);
  if (!base.ok) return base;
  const onBed = new Map();
  for (const patient of listOf(board.patients)) {
    if (!patient?.bedId) continue;
    const key = normId(patient.bedId);
    onBed.set(key, [...(onBed.get(key) ?? []), patient.patient_id]);
  }
  return okSource({ byUnit: base.data.byUnit, onBed });
}

/** One patient's «Kalan iş»: open hand tasks NOT late, due before the shift ends at `endMs` (A4). */
export const remainingOf = (patient, endMs) => listOf(patient?.tasks).filter((task) => {
  const due = msOf(task?.due_at);
  return task?.state === "open" && task.late !== true && due !== null && due < endMs;
}).length;

/** «Hemşire başına hasta»'s mean, to one decimal: 3 patients, 2 nurses → 1.5. */
export const meanOf = (patients, nurses) => Math.round((patients / nurses) * 10) / 10;

/** A11: people as shown — `label` is the name, and the user name in brackets beside it when another of the same list
 *  bears the same name. */
export function labelled(people) {
  const count = new Map();
  for (const person of people) count.set(person.name, (count.get(person.name) ?? 0) + 1);
  return people.map((person) => ({ ...person,
    label: count.get(person.name) > 1 ? `${person.name} (${person.username})` : person.name }));
}

/** One order everywhere (A11): the reader's language's collation of the label, then the key. */
export const byLabel = (lang) => (a, b) => a.label.localeCompare(b.label, lang) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** The units a fresh answer (GET /shift-schedule) lists, as one text of their keys (normId) in its order — what the
 *  page keeps (`workloadPage`'s `kept`) while its next read is not ok. A text, so it compares by value (review 1). */
export const listedKeysOf = (answer) => answer.units.map((unit) => normId(unit.unit_id)).join(" ");

/** The open units of the tree, in its order, each with its open beds: key, id, structure name («1 · Otaq 1 ·
 *  Reanimasiya»), whether a patient is in it (doluluk/occupancy.js WITH_PATIENT). Not ozet.js `unitsOf`, which lists
 *  every unit with its counts. */
function openUnitsOf(tree) {
  const index = indexStructure(tree);
  const out = [];
  for (const site of listOf(tree?.sites)) {
    for (const unit of listOf(site?.units)) {
      if (unit?.id == null || unit.is_active === false) continue;
      const beds = [];
      for (const room of listOf(unit.rooms)) {
        for (const raw of listOf(room?.beds)) {
          const bed = withOpen(unit, room, raw);
          if (!bed.open || bed.id == null) continue;
          beds.push({ key: normId(bed.id), id: bed.id, label: bedLabel(index, bed.id), occupied: WITH_PATIENT.has(bed.state) });
        }
      }
      out.push({ key: normId(unit.id), id: unit.id, name: unit.name ?? "", beds });
    }
  }
  return out;
}

/** The page. `tree`: the last tree held (null: none read yet); `occupancy`: the tree's own source (ozet.js
 *  `structureSource`); `reach`: the caller's (ozet.js `reachSource`, GET /scope/me); `boardReach`: the live board's own
 *  scope (ozet.js `boardReachSource`), for the alarm column and the cards' «Kalan iş»; `wholeTree`: the tree is the whole
 *  hospital's (`structure.manage`); `schedule`, `tasks` (`workSources`), `board` (`boardWork`): sources. `selected`: ALL
 *  or a listed unit's key — one the rows no longer hold falls back to ALL; `lang`: the cards' collation; `kept`: the
 *  keys (a Set) the last fresh answer listed, the choices while `schedule` is not ok (`listedKeysOf`).
 *
 *  { shift: {startMs, endMs, which} | null, shiftWhy, rows: [{key, id, name, beds, listed, items, cells}] | null, why,
 *    otherRows, selected, choices: [row], partial, cards: [{key, label, beds, patients, tasks}] | null, cardsWhy,
 *    unassigned: {beds: [name]} | {why} | null }
 *  `cards` null with NO_UNITS when the tree has no open unit, with «yetki yok» when the answer lists none of the open
 *  ones; `partial`: «Tüm birimler» while the
 *  answer leaves out an open unit — the cards and the unassigned beds are the listed units' only. */
export function workloadPage({ tree, occupancy, reach, boardReach = reach, wholeTree = false, schedule, tasks, board },
  { selected = ALL, lang, kept = null } = {}) {
  const shift = schedule.ok ? { startMs: msOf(schedule.data.shift.start), endMs: msOf(schedule.data.shift.end),
    which: schedule.data.shift.which } : null;
  const head = { shift, shiftWhy: schedule.ok ? null : schedule.why };
  if (!tree) {
    const why = occupancy.ok ? WHY.loading : occupancy.why;
    return { ...head, rows: null, why, otherRows: false, selected: ALL, choices: [], partial: false, cards: null, cardsWhy: why,
      unassigned: null };
  }

  // The units the GET lists, each with its rows by bed.
  const listed = new Map();
  if (schedule.ok) {
    for (const unit of schedule.data.units) {
      listed.set(normId(unit.unit_id), { otherRows: unit.other_rows, items: new Map(unit.items.map((i) => [normId(i.bed_id),
        { key: normId(i.nurse_id), name: i.nurse_name, username: i.nurse_username }])) });
    }
  }
  // «Geciken iş» and «Kalan iş» by the card's unit; «Kalan iş» by patient, for the cards.
  const late = new Map();
  const remaining = new Map();
  const remainingOfPatient = new Map();
  if (tasks.ok && shift) {
    for (const patient of tasks.data.patients) {
      const unit = normId(patient.unit_id);
      const n = remainingOf(patient, shift.endMs);
      late.set(unit, (late.get(unit) ?? 0) + lateOf(patient));
      remaining.set(unit, (remaining.get(unit) ?? 0) + n);
      remainingOfPatient.set(patient.patient_id, n);
    }
  }
  const outOf = (which, key) => which.ok && !which.data.all && !which.data.units.has(key);
  // The task columns: /tasks is cut to her own reach (GET /scope/me).
  const gate = (key, cell) => (outOf(reach, key) ? { why: WHY.noRight } : !reach.ok ? { why: reach.why } : cell);
  // The alarm column: the live board's own scope, from the same answer as its counts (ozet.js `summarise`).
  const gateBoard = (key, cell) => {
    if (outOf(boardReach, key)) return { why: WHY.noRight };
    if ("why" in cell) return cell;
    return boardReach.ok ? cell : { why: boardReach.why };
  };

  const rows = openUnitsOf(tree).map((unit) => {
    const mine = listed.get(unit.key);
    const items = mine ? unit.beds.filter((bed) => mine.items.has(bed.key)).map((bed) => ({ bed, ...mine.items.get(bed.key) })) : [];
    const nurses = new Set(items.map((i) => i.key));
    const assigned = new Set(items.map((i) => i.bed.key));
    const occupied = unit.beds.filter((bed) => bed.occupied);
    let patients = { value: occupied.length };
    if (!wholeTree && outOf(reach, unit.key)) patients = { why: WHY.noRight };
    else if (!occupancy.ok) patients = { why: occupancy.why };
    else if (!wholeTree && !reach.ok) patients = { why: reach.why };
    let held = null;                                            // why the assignment cells cannot be counted
    if (!schedule.ok) held = { why: schedule.why };
    else if (!mine) held = { why: WHY.noRight };                // out of her unit reach: the GET does not list it
    const withPatients = held ?? ("why" in patients ? patients : null);
    return {
      key: unit.key, id: unit.id, name: unit.name, beds: unit.beds, listed: Boolean(mine), items,
      cells: {
        patients,
        nurses: held ?? (nurses.size === 0 ? { none: true } : { value: nurses.size }),
        ratio: withPatients ?? (nurses.size === 0 ? { none: true }
          : { patients: occupied.filter((bed) => assigned.has(bed.key)).length, nurses: nurses.size }),
        unassigned: withPatients ?? { value: occupied.filter((bed) => !assigned.has(bed.key)).length },
        late: gate(unit.key, tasks.ok ? { value: late.get(unit.key) ?? 0 } : { why: tasks.why }),
        remaining: gate(unit.key, tasks.ok ? { value: remaining.get(unit.key) ?? 0 } : { why: tasks.why }),
        waiting: gateBoard(unit.key, board.ok ? { value: board.data.byUnit.get(unit.key)?.total ?? 0 } : { why: board.why }),
      },
    };
  });

  // The units to choose from: the fresh answer's; while the read is not ok (it failed, or its shift ended), those the
  // last fresh answer listed (`kept`), so a poll does not take away the form being edited (§5 A7, review 1). Only a
  // fresh answer that leaves the chosen unit out falls back to «Tüm birimler»; the form's own read, by the unit's id,
  // is refused by the server for a unit out of her reach.
  const choices = schedule.ok ? rows.filter((row) => row.listed) : rows.filter((row) => kept?.has(row.key) === true);
  const pick = selected !== ALL && choices.some((row) => row.key === selected) ? selected : ALL;
  const otherRows = [...listed.values()].some((unit) => unit.otherRows > 0);
  const page = { ...head, rows, why: null, otherRows, selected: pick, choices, partial: false };
  // No open unit: nothing to draw, for the reason the table gives («Açık birim yok.»), whatever the answer lists.
  if (rows.length === 0) return { ...page, cards: null, cardsWhy: NO_UNITS, unassigned: { why: NO_UNITS } };
  if (!schedule.ok) return { ...page, cards: null, cardsWhy: schedule.why, unassigned: null };
  // An answer that lists none of the open units (a bed-only grant; `structure.manage` without a unit grant) is no
  // answer about any nurse or bed here: «yetki yok», never «none» (§5 A6, review 2).
  if (choices.length === 0) return { ...page, cards: null, cardsWhy: WHY.noRight, unassigned: { why: WHY.noRight } };
  // «Tüm birimler» with a unit the answer leaves out: the cards and the unassigned beds cover the listed ones only.
  const partial = pick === ALL && rows.some((row) => !row.listed);

  const shown = choices.filter((row) => pick === ALL || row.key === pick);
  const byNurse = new Map();
  for (const row of shown) {
    for (const { bed, key, name, username } of row.items) {
      const card = byNurse.get(key) ?? { key, name, username, beds: [], units: new Set() };
      card.beds.push(bed);
      card.units.add(row.key);
      byNurse.set(key, card);
    }
  }
  const tasksOf = (beds) => beds.reduce((sum, bed) => sum + (board.data.onBed.get(bed.key) ?? [])
    .reduce((n, patient) => n + (remainingOfPatient.get(patient) ?? 0), 0), 0);
  // A card's «Kalan iş» is /tasks (her reach) read through the live board (its own scope): a bed outside either is no
  // answer about it — «yetki yok», never a 0 (review 3).
  const tasksCell = (card) => {
    if ([...card.units].some((key) => outOf(reach, key) || outOf(boardReach, key))) return { why: WHY.noRight };
    if (!tasks.ok) return { why: tasks.why };
    if (!board.ok) return { why: board.why };
    if (!reach.ok) return { why: reach.why };
    if (!boardReach.ok) return { why: boardReach.why };
    return { value: tasksOf(card.beds) };
  };
  const cards = labelled([...byNurse.values()]).map((card) => ({
    key: card.key, label: card.label, beds: card.beds.map((bed) => bed.label),
    patients: occupancy.ok ? { value: card.beds.filter((bed) => bed.occupied).length } : { why: occupancy.why },
    tasks: tasksCell(card),
  })).sort(byLabel(lang));
  const unassigned = occupancy.ok
    ? { beds: shown.flatMap((row) => row.beds.filter((bed) => bed.occupied && !row.items.some((i) => i.bed.key === bed.key))
      .map((bed) => bed.label)) }
    : { why: occupancy.why };
  return { ...page, partial, cards, cardsWhy: null, unassigned };
}

/** «Nöbet ataması»'s model for one row (a listed unit) from the form's own reads — `schedule` (GET for that unit and
 *  window) and `nurses` (GET …/nurses): one picker per open bed, its held nurse ("" for none) and its people — the
 *  offered ones (one whose scope does not reach the unit marked "unreached") and, on the bed she holds only, a person no
 *  longer offered (marked "gone", A10) — by label in the reader's language; `expected`: every row the read returned,
 *  a closed bed's and a no-longer-offered nurse's included (A7). */
export function formModel({ row, schedule, nurses, lang }) {
  const unit = schedule.units[0] ?? { items: [], other_rows: 0 };
  const offered = new Set(nurses.map((person) => person.id));
  const gone = new Map(unit.items.filter((i) => !offered.has(i.nurse_id))
    .map((i) => [i.nurse_id, { id: i.nurse_id, name: i.nurse_name, username: i.nurse_username }]));
  const everyone = labelled([...nurses.map((person) => ({ key: person.id, name: person.name, username: person.username,
    note: person.reaches_unit ? null : "unreached" })),
  ...[...gone.values()].map((person) => ({ key: person.id, name: person.name, username: person.username, note: "gone" }))]);
  const order = byLabel(lang);
  const heldOn = new Map(unit.items.map((i) => [normId(i.bed_id), i.nurse_id]));
  return {
    unitId: row.id, shiftStart: schedule.shift.start, shift: schedule.shift, otherRows: unit.other_rows,
    expected: unit.items.map((i) => ({ bed_id: i.bed_id, nurse_id: i.nurse_id })),
    noneOffered: nurses.length === 0,
    beds: row.beds.map((bed) => {
      const held = heldOn.get(bed.key) ?? "";
      return { key: bed.key, id: bed.id, label: bed.label, held,
        people: everyone.filter((person) => person.note !== "gone" || person.key === held).sort(order) };
    }),
  };
}

/** The PUT's body (§5 A1, A7): the window's key, the pickers with a nurse, and every row the form read. */
export function saveBody(model, choices) {
  return {
    unit_id: model.unitId, shift_start: model.shiftStart,
    items: model.beds.map((bed) => ({ bed_id: bed.id, nurse_id: choices.get(bed.key) ?? "" })).filter((item) => item.nurse_id),
    expected: model.expected,
  };
}

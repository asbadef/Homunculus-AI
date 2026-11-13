// src/live/screens/enfeksiyon/enfeksiyon.js — «Enfeksiyon kontrol» (G4-05, spec D10–D15 as §5 S1, A3, A4, M3, M4 amend
// them): what the page's cards, tables and tiles say, from the server's answer, the structure tree and the page's
// freshness. Pure: no React, no translator, no request, no clock of its own.
//
// THE SERVER DECIDES THE PATIENTS' WORDS; THE TREE DECIDES THE BEDS. Each row's isolation `state`, its antibiotic
// `state`, its alarms and the counts are the engine's (api/infection.py): nothing here recounts or judges them. The
// isolation beds are the tree's (§5 S1): every open bed of an open room with `is_isolation` in an open unit of the tree
// this session reads — `/tenant/structure`'s own reach — its tile decided here from the tree's bed state and the
// answer's `bed_occupants`, as Doluluk counts its beds from the same tree (occupancy.js). The ORDER of the two lists is
// decided here (§5 M4), by the unit and bed names a reader sees; `sort_group` is the server's.
//
// DECISION 18 (spec D15, §5 A4): never a 0 or a «yok» without a fresh answer. A count, a tile or an alarm cell that
// would say «nothing» from an answer that is not fresh says «—» and why instead. The tree has its own source (ozet.js
// `structureSource`): while it does not count, the bed cells name its reason (`why: "tree"`, worded by the screen).
// No colour judges: the tones are the engine's severities, as Eczane's.
import { BED_STATE_KEYS, normId } from "../../data/structure.js";
import { riskStyle } from "../../ui/riskStyle.js";
import { WITH_PATIENT } from "../doluluk/occupancy.js";
import { msOf } from "../eczane/pharmacyModel.js";

/** The unit filter's «Tüm birimler». A unit's own key is its normalised id. */
export const ALL = "*";
/** The isolation types, in the engine's one order (api/clinical.py ISOLATION_CODES). */
export const TYPES = Object.freeze(["contact", "droplet", "airborne", "protective"]);
/** The tiles this build has words for (spec D10's table; `conflict`, §5 A4 a). Any other is `unknown`. */
export const TILES = Object.freeze(["free", "isolated", "not_isolated", "unrecorded", "occupant_unseen", "conflict",
  "cleaning", "reserved", "out_of_service", "maintenance"]);
/** A bed state with no patient in it → its tile. */
const STATE_TILE = Object.freeze({ AVAILABLE: "free", HOUSEKEEPING: "cleaning", RESERVED: "reserved",
  BLOCKED: "out_of_service", MAINTENANCE: "maintenance" });
/** The three tiles that would say «free», «not isolated» or «nothing recorded»: «—» from an answer that is not fresh. */
const QUIET = new Set(["free", "not_isolated", "unrecorded"]);
const OCCUPANT_STATES = new Set(["isolated", "not_isolated", "unrecorded"]);
const KIND_KEYS = Object.freeze({ septic_shock: "enfeksiyon.kind.septicShock", sepsis: "enfeksiyon.kind.sepsis",
  under_resuscitated_sepsis: "enfeksiyon.kind.underResuscitated" });
const ZERO = Object.freeze({ patients: 0, isolated: 0, isolation_unrecorded: 0, suspected: 0, suspected_unrecorded: 0,
  clock_missed: 0, sepsis_open: 0 });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const listOf = (value) => (Array.isArray(value) ? value : []);

/** Who lies on each bed, by its normalised id (the answer's `bed_occupants`): `{patient_id, display_name, state, types}`. */
function occupantsByBed(answer) {
  const out = new Map();
  for (const occupant of listOf(answer?.bed_occupants)) {
    if (!isObject(occupant) || occupant.bed_id == null) continue;
    const key = normId(occupant.bed_id);
    out.set(key, [...(out.get(key) ?? []), { patient_id: occupant.patient_id ?? "", display_name: occupant.display_name ?? "",
      state: occupant.isolation?.state ?? null, types: listOf(occupant.isolation?.types) }]);
  }
  return out;
}

/** A tile from its bed's state in the tree and who the answer says lies on it (spec D10's table, §5 A4 a): a bed a
 *  patient is in is `isolated` if one of them is, `not_isolated` if every one is not, `unrecorded` otherwise, and
 *  `occupant_unseen` when none of them is on this list; a bed with a patient whose tree state has none is `conflict` —
 *  never «boş». A state or an occupant's word this build does not know is `unknown`. */
export function tileOf(state, occupants) {
  if (WITH_PATIENT.has(state)) {
    if (occupants.length === 0) return "occupant_unseen";
    if (occupants.some((o) => o.state === "isolated")) return "isolated";
    if (occupants.some((o) => !OCCUPANT_STATES.has(o.state))) return "unknown";
    return occupants.every((o) => o.state === "not_isolated") ? "not_isolated" : "unrecorded";
  }
  if (occupants.length > 0) return "conflict";
  return STATE_TILE[state] ?? "unknown";
}

/** The isolation beds (§5 S1): every open bed of an open room with `is_isolation` in an open unit, in the tree's own
 *  order (units, rooms and beds by name, as the server sorts them). `answer` names the occupants; with none every
 *  occupied bed is `occupant_unseen` (the page draws no tile without an answer). */
export function isolationBeds(tree, answer) {
  const occupants = occupantsByBed(answer);
  const out = [];
  for (const site of listOf(tree?.sites)) {
    for (const unit of listOf(site?.units)) {
      for (const room of listOf(unit?.rooms)) {
        if (room?.is_isolation !== true) continue;
        for (const bed of listOf(room?.beds)) {
          if (unit.is_active === false || room.is_active === false || bed?.is_active === false || bed?.id == null) continue;
          const on = occupants.get(normId(bed.id)) ?? [];
          const tile = tileOf(bed.state, on);
          // Review M1: a tile made `unknown` by an occupant's word names that word, not the bed's own state.
          const odd = tile === "unknown" ? on.find((o) => !OCCUPANT_STATES.has(o.state)) : undefined;
          out.push({ key: normId(bed.id), id: bed.id, label: String(bed.label ?? ""), roomName: String(room.name ?? ""),
            unitId: unit.id, unitKey: normId(unit.id), state: bed.state ?? null, tile, occupants: on,
            ...(odd ? { unknownWord: String(odd.state ?? "—") } : {}) });
        }
      }
    }
  }
  return out;
}

/** «{a} dolu · {b} boş» and «boş izolasyon yatağı» «{free} / {total}» (§5 S1): every tile, the free ones, and those
 *  whose bed state has a patient (OCCUPIED and the two pending states, occupancy.js `WITH_PATIENT`). A conflict tile is
 *  in the total and in neither of the two (§5 A4 a). */
export function bedTally(tiles) {
  return { total: tiles.length, free: tiles.filter((tile) => tile.tile === "free").length,
    occupied: tiles.filter((tile) => WITH_PATIENT.has(tile.state)).length };
}

/** Whether a unit lies inside the answer's board scope (its `scope`, /patients' own block): true when the scope is
 *  unrestricted, its grant names the unit, a scoped card is on it (the answer's `units`, its rows — an own patient off
 *  the grant included), or a granted bed is in it (placed by the tree's `index`); false when a restricted scope reaches
 *  it by none of these; null when the answer cannot tell — no answer, no scope block, or a granted bed the index does
 *  not place. Review (spec level): a unit outside the scope is not offered, so it never prints a fresh 0. */
export function unitInScope(answer, unitId, index = null) {
  const scope = answer?.scope;
  const key = normId(unitId);
  if (!isObject(scope) || !key) return null;
  if (scope.unrestricted === true) return true;
  if (scope.unrestricted !== false) return null;
  const on = (id) => normId(id) === key;
  if (listOf(scope.unit_ids).some(on)) return true;
  if (listOf(answer.units).some((unit) => on(unit?.unit_id))) return true;
  if ([...listOf(answer.isolated), ...listOf(answer.suspected)].some((r) => on(r?.unit_id))) return true;
  let unplaced = false;
  for (const bedId of listOf(scope.bed_ids)) {
    const bed = index?.beds?.get(normId(bedId));
    if (!bed) unplaced = true;
    else if (on(bed.unitId)) return true;
  }
  return unplaced ? null : false;
}

/** The unit filter's choices (§5 S1): the tree's open units inside the answer's scope (`unitInScope` not false), then
 *  any other unit the answer names (its `units`, its rows) — ids, each once by `normId`, for `useUnitNames` to name and
 *  sort. `index` (the tree's) places a scope's granted beds. */
export function unitChoices(tree, answer, index = null) {
  const out = [];
  const seen = new Set();
  const add = (id) => {
    const key = normId(id);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(id);
    }
  };
  for (const site of listOf(tree?.sites)) {
    for (const unit of listOf(site?.units)) {
      if (unit?.is_active !== false && unitInScope(answer, unit?.id, index) !== false) add(unit?.id);
    }
  }
  for (const unit of listOf(answer?.units)) add(unit?.unit_id);
  for (const r of [...listOf(answer?.isolated), ...listOf(answer?.suspected)]) add(r?.unit_id);
  return out;
}

/** The selection's counts and rows (spec D13 item 1, §5 S1, M4): «Tüm birimler» is the whole answer; a unit is its
 *  `units[]` entry and the rows whose own `unit_id` is it — a row with no `unit_id` stays under «Tüm birimler» only,
 *  where the server counts it. A unit the answer does not list has no scoped card: its counts are 0 (the page prints a 0
 *  only from a fresh answer). A unit it lists without counts has none to print (null: every card «—», review M6). */
export function selectionOf(answer, selected) {
  const mine = (r) => selected === ALL || normId(r?.unit_id) === selected;
  const entry = selected === ALL ? null : listOf(answer?.units).find((unit) => normId(unit?.unit_id) === selected);
  let counts;
  if (selected === ALL) counts = isObject(answer?.counts) ? answer.counts : null;
  else if (entry) counts = isObject(entry.counts) ? entry.counts : null;
  else counts = answer ? ZERO : null;
  return { counts, isolated: listOf(answer?.isolated).filter(mine), suspected: listOf(answer?.suspected).filter(mine) };
}

/** The unit a row is shown under in «Birim» (§5 M4): its own, else its bed's in the tree; null when neither says. */
export function unitOf(r, index) {
  if (r?.unit_id) return r.unit_id;
  const bed = r?.bed_id ? index?.beds?.get(normId(r.bed_id)) : null;
  return bed?.unitId ?? null;
}

const BOARD_ORDER = { numeric: true, sensitivity: "base" };

/** A list in the page's order (§5 M4): with `byGroup` (the suspected list) first the server's `sort_group` — 0 an open
 *  clock, least `remaining_sec` first; 1 a firing alarm; 2 the rest — then by the unit's name in the interface language
 *  (`unitOf`, `unitName`; a row on no unit last), the bed label as the board orders it (`localeCompare("en", {numeric:
 *  true, sensitivity: "base"})`; else the key), and the key. A new array. */
export function sortRows(rows, { unitOf: unitIdOf, unitName, lang, byGroup = false }) {
  const groupOf = (r) => (Number.isInteger(r?.sort_group) ? r.sort_group : 2);
  const leftOf = (r) => (Number.isFinite(r?.antibiotic?.remaining_sec) ? r.antibiotic.remaining_sec : 0);
  const bedOf = (r) => String(r?.bed_label || r?.patient_id || "");
  return [...rows].sort((a, b) => {
    if (byGroup) {
      const group = groupOf(a) - groupOf(b);
      if (group) return group;
      const left = groupOf(a) === 0 ? leftOf(a) - leftOf(b) : 0;
      if (left) return left;
    }
    const ua = unitIdOf(a);
    const ub = unitIdOf(b);
    if (!ua !== !ub) return ua ? -1 : 1;
    const unit = ua && ub ? String(unitName(ua)).localeCompare(String(unitName(ub)), lang, BOARD_ORDER) : 0;
    if (unit) return unit;
    const bed = bedOf(a).localeCompare(bedOf(b), "en", BOARD_ORDER);
    return bed || String(a?.patient_id ?? "").localeCompare(String(b?.patient_id ?? ""));
  });
}

/** «Oda» (§5 S1, A4 b): `{key}` — the row's bed is or is not in an isolation room — or `{why}` for a «—»: no bed, a bed
 *  the tree does not hold (never «izolasyon odasında değil»), or `"tree"` while the tree does not count (`treeOk`). */
export function roomCell(r, index, treeOk) {
  if (!treeOk) return { why: "tree" };
  if (!r?.bed_id) return { why: "enfeksiyon.room.noBed" };
  const bed = index?.beds?.get(normId(r.bed_id));
  if (!bed) return { why: "enfeksiyon.room.unknownBed" };
  return { key: bed.isIsolation ? "enfeksiyon.room.yes" : "enfeksiyon.room.no" };
}

/** A count card (spec D15, §5 A3): a fresh answer's number, 0 included; from an answer that is not fresh, a number above
 *  0 (`stale`: the page says as of when) and a 0 as «—» «liste güncel değil»; a value that is no count, «—». */
export function countCell(value, fresh) {
  if (!Number.isInteger(value) || value < 0) return { dash: true };
  if (fresh) return { value };
  return value > 0 ? { value, stale: true } : { dash: true, why: "enfeksiyon.notFresh" };
}

/** «boş izolasyon yatağı» (spec D15, §5 S1, A4 c): «{free} / {total}» from a fresh answer and a tree that counts; no
 *  isolation room: «—» «izolasyon odası tanımlı değil»; an answer that is not fresh: «—» «liste güncel değil»; a tree
 *  that does not count: «—» and the tree's reason (`why: "tree"`). */
export function freeBedsCell(tally, fresh, treeSource) {
  if (!treeSource?.ok) return { dash: true, why: "tree" };
  if (!fresh) return { dash: true, why: "enfeksiyon.notFresh" };
  if (!tally || tally.total === 0) return { dash: true, why: "enfeksiyon.count.noRooms" };
  return { free: tally.free, total: tally.total };
}

/** A tile's words (spec D10's table, D15, §5 A4): `{key}`; `isolated` and `conflict` say whether what they say of the
 *  board is the last answer's (`lastAnswer`); `occupant_unseen` adds the «—» reason; `conflict` names the tree's state
 *  (`stateKey`); an unknown tile names the occupant's word it does not know, else the bed's state (review M1). From an
 *  answer that is not fresh, the three quiet tiles and «dolu — hasta bu listede yok» are «—» «liste güncel değil»
 *  (§5 A4 c, review M5): «not on this list» is a claim about a list that is not current. */
export function tileWords(tile, fresh) {
  if (!fresh && (QUIET.has(tile.tile) || tile.tile === "occupant_unseen")) return { dash: true, why: "enfeksiyon.notFresh" };
  if (!TILES.includes(tile.tile)) return { key: "enfeksiyon.unknown", state: tile.unknownWord ?? tile.state ?? tile.tile };
  const key = `enfeksiyon.beds.tile.${tile.tile}`;
  if (tile.tile === "isolated") return { key, lastAnswer: !fresh };
  if (tile.tile === "occupant_unseen") return { key, why: "enfeksiyon.beds.tile.occupantUnseenWhy" };
  if (tile.tile === "conflict") return { key, stateKey: BED_STATE_KEYS[tile.state] ?? "kabul.bedOther", lastAnswer: !fresh };
  return { key };
}

/** The «Sepsis alarmı» cell's items (spec D13 item 6, §5 A6, M3), in the server's order: the kind's text key (null for a
 *  kind this build does not know: the screen prints the server's word), the tone of its severity (the engine's own,
 *  `riskStyle`), whether it is latched (`resolved_at` set), acknowledged, and the end of its snooze. */
export function alarmItems(r) {
  return listOf(r?.sepsis_alarms).filter(isObject).map((alarm) => ({
    kind: String(alarm.kind ?? ""), kindKey: KIND_KEYS[alarm.kind] ?? null, tone: riskStyle(alarm.severity).tone,
    latched: alarm.resolved_at != null, acknowledged: alarm.acknowledged === true, snoozeMs: msOf(alarm.snooze_until),
  }));
}

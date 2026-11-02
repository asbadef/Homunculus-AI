// src/live/data/structure.js — the ward's own units, rooms and beds, by name (Group 2 · B1a).
//
// `GET /tenant/structure` (homunculus-engine tenant/router.py) answers the caller's units with
// their rooms and beds: ids, names, labels, states, `is_active`. Since B1a every unit and bed id
// the screens meet — the engine's scope, a card's `unit_id`, a staff grant — is one of these
// UUIDs (spec D9), and NO SCREEN EVER SHOWS A UUID: it shows the name this tree gives it.
//
// Pure: StructureProvider.jsx holds the answer; these read it.

/** Ids compared as the engine compares them (scope `normalise_id`): trimmed, case-folded. */
export const normId = (id) => String(id ?? "").trim().toLowerCase();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Whether a text is a UUID — something a screen must never print. */
export const isUuid = (text) => UUID.test(String(text ?? "").trim());

/** Every unit, room and bed of an answer, flat, each with its parents' names:
 *  { units: Map(id -> {id, name, unitType, isActive, siteName}),
 *    rooms: Map(id -> {id, name, unitId, isActive}),
 *    beds:  Map(id -> {id, label, state, isActive, roomId, roomName, unitId, unitName, open}) }.
 *  `open`: the bed, its room and its unit are all open — only an open, AVAILABLE bed is offered to
 *  an admission. An answer that is not a tree is an empty index. */
export function indexStructure(structure) {
  const units = new Map();
  const rooms = new Map();
  const beds = new Map();
  for (const site of Array.isArray(structure?.sites) ? structure.sites : []) {
    for (const unit of site.units ?? []) {
      units.set(normId(unit.id), { id: unit.id, name: unit.name, unitType: unit.unit_type,
        isActive: unit.is_active !== false, siteName: site.name });
      for (const room of unit.rooms ?? []) {
        rooms.set(normId(room.id), { id: room.id, name: room.name, unitId: unit.id,
          isActive: room.is_active !== false });
        for (const bed of room.beds ?? []) {
          beds.set(normId(bed.id), {
            id: bed.id, label: bed.label, state: bed.state, isActive: bed.is_active !== false,
            roomId: room.id, roomName: room.name, unitId: unit.id, unitName: unit.name,
            open: bed.is_active !== false && room.is_active !== false && unit.is_active !== false,
          });
        }
      }
    }
  }
  return { units, rooms, beds };
}

export const EMPTY_INDEX = Object.freeze(indexStructure(null));

/** A bed as every screen of the slice names it: "label · room · unit" — the Kabul tabs, the
 *  sign-off strip and Yapı say it so (A-17); `null` when the tree does not hold it. */
export function bedLabel(index, id) {
  const bed = index.beds.get(normId(id));
  return bed ? `${bed.label} · ${bed.roomName} · ${bed.unitName}` : null;
}

/** The placeholder numbers of one shell: a unit or a bed that cannot yet be called by its name is
 *  "Şöbə 3" — and that 3 must stay with it. A number is taken the first time an id needs one, from
 *  a count that only grows: never given to another id, never taken back when the id leaves a list
 *  (a grant removed, a patient gone), the same on every screen that names it, and distinct for
 *  every id. A position in a list would move as soon as the list changed, and an administrator who
 *  removed "Şöbə 1" would find "Şöbə 1" now meant another unit. StructureProvider keeps one of
 *  these for as long as the shell is open. `kind`: "unit" or "bed"; an id whatever its case. */
export function ordinalRegistry() {
  const taken = { unit: new Map(), bed: new Map() };
  return {
    ordinalOf(kind, id) {
      const numbers = taken[kind];
      const key = normId(id);
      if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
      return numbers.get(key);
    },
  };
}

/** Names for a LIST of ids, as one screen shows them — the one way a unit or a bed is named, since
 *  a name depends on the whole list and on how far the structure has been read:
 *
 *   1. Only a successful read makes an id «unknown». `view` is `{ index, phase, ordinalOf,
 *      rereading }` (StructureProvider's own words and registry). The index names what it holds. An
 *      id it does not hold is «unknown unit 3» only in phase "known" — the last read succeeded —
 *      and when no read is out for that very id (`rereading`: the scope listed a unit the tree
 *      lacked, and the structure is being read again for it). In any other case (still being
 *      read, unreadable, "stale": the last read failed and a unit may have been added since) it is
 *      a placeholder, "Şöbə 3". Both carry the number `ordinalRegistry` gave the id, so the number
 *      is the same before and after the claim.
 *   2. Names that collide are numbered, in the list's order: "Reanimasiya (1)", "Reanimasiya (2)"
 *      — skipping a suffix some other unit already bears, so no two entries ever read alike.
 *   3. `sorted` is the ids in the order of the names a reader sees — numbers by value, case
 *      ignored — never in the order of their UUIDs.
 *   4. `placeholders` counts the listed ids shown as placeholders, so a screen can say, whenever
 *      there is one, that a numbered name is not a name.
 *
 *  A key someone typed by hand (an old free-text grant) is no UUID and is shown as typed, with no
 *  number. `labelFor(id)` answers `{ label, placeholder }` for one id. `nameOf` also answers for
 *  an id outside the list (its number is the registry's, the same each time). */
function namer(ids, locale, labelFor) {
  const distinct = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    const key = normId(id);
    if (key && !seen.has(key)) {
      seen.add(key);
      distinct.push(id);
    }
  }
  const named = distinct.map((id) => labelFor(id));
  const base = named.map((one) => one.label);
  const total = new Map();
  for (const label of base) total.set(label, (total.get(label) ?? 0) + 1);
  const used = new Set(base);
  const run = new Map();
  const labels = new Map();
  distinct.forEach((id, at) => {
    let label = base[at];
    if (total.get(label) > 1) {
      let n = run.get(label) ?? 0;
      let numbered;
      do {
        n += 1;
        numbered = `${label} (${n})`;
      } while (used.has(numbered));
      run.set(label, n);
      used.add(numbered);
      label = numbered;
    }
    labels.set(normId(id), label);
  });
  const order = (a, b) => labels.get(normId(a)).localeCompare(labels.get(normId(b)), locale, { numeric: true, sensitivity: "base" })
    || normId(a).localeCompare(normId(b));
  return {
    nameOf: (id) => labels.get(normId(id)) ?? labelFor(id).label,
    sorted: [...distinct].sort(order),
    placeholders: named.filter((one) => one.placeholder).length,
  };
}

/** The units of `ids` named — see `namer`. `t` is the translator, `locale` the language's code. */
export function unitNamer(t, view, ids, locale) {
  return namer(ids, locale, (id) => {
    const unit = view.index.units.get(normId(id));
    if (unit) return { label: unit.name, placeholder: false };
    if (!isUuid(id)) return { label: String(id ?? ""), placeholder: false };
    const n = view.ordinalOf("unit", id);
    if (view.phase === "known" && !view.rereading?.has(normId(id))) {
      return { label: `${t("kabul.unitUnknown")} ${n}`, placeholder: false };
    }
    return { label: t("kabul.unitOrdinal", { n }), placeholder: true };
  });
}

/** The beds of `ids` named — see `namer`. A bed reads "label · room · unit" once the structure holds it. */
export function bedNamer(t, view, ids, locale) {
  return namer(ids, locale, (id) => {
    const held = bedLabel(view.index, id);
    if (held) return { label: held, placeholder: false };
    if (!isUuid(id)) return { label: String(id ?? ""), placeholder: false };
    const n = view.ordinalOf("bed", id);
    if (view.phase === "known") return { label: `${t("kabul.bedUnknown")} ${n}`, placeholder: false };
    return { label: t("kabul.bedOrdinal", { n }), placeholder: true };
  });
}

/** Can an admission take this bed? Open, and AVAILABLE. */
export const admissible = (bed) => Boolean(bed?.open) && bed.state === "AVAILABLE";

/** Why a bed is not offered, as an i18n key — or null when it is. Closed wins over its state. */
export function unavailableKey(bed) {
  if (!bed) return null;
  if (!bed.open) return "kabul.bedClosed";
  if (bed.state === "AVAILABLE") return null;
  return BED_STATE_KEYS[bed.state] ?? "kabul.bedOther";
}

/** The bed lifecycle (homunculus-engine tenant/models.py BedState) in words. */
export const BED_STATE_KEYS = Object.freeze({
  AVAILABLE: "kabul.state.AVAILABLE",
  OCCUPIED: "kabul.state.OCCUPIED",
  PENDING_DISCHARGE: "kabul.state.PENDING_DISCHARGE",
  PENDING_TRANSFER_OUT: "kabul.state.PENDING_TRANSFER_OUT",
  HOUSEKEEPING: "kabul.state.HOUSEKEEPING",
  MAINTENANCE: "kabul.state.MAINTENANCE",
  BLOCKED: "kabul.state.BLOCKED",
});

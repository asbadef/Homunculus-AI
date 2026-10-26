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

/** A unit as a screen names it: its name; else, for an id the tree does not hold, the id itself
 *  when it is a key someone wrote (an old free-text grant), and `t("kabul.unitUnknown")` when it
 *  is a UUID — never the UUID. */
export function unitLabel(t, index, id) {
  const unit = index.units.get(normId(id));
  if (unit) return unit.name;
  return isUuid(id) ? t("kabul.unitUnknown") : String(id ?? "");
}

/** A bed as a screen names it: "label · unit"; `null` when the tree does not hold it. */
export function bedLabel(index, id) {
  const bed = index.beds.get(normId(id));
  return bed ? `${bed.label} · ${bed.unitName}` : null;
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

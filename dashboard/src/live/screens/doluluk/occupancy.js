// src/live/screens/doluluk/occupancy.js — what the Doluluk screen counts, offers and says about
// time (Group 2 · B3a, spec §3). Pure: no React, no request.

/** The out-of-service reasons, in the order the dialog offers them (tenant/models.py BedStateReason). */
export const REASONS = Object.freeze(["FAULT", "ISOLATION_CLEANING", "STAFFING", "OTHER"]);

/** A bed with `open`: it, its room and its unit are all open (closed wins over any state). */
export const withOpen = (unit, room, bed) => ({
  ...bed, open: unit.is_active !== false && room.is_active !== false && bed.is_active !== false,
});

/** A bed the ward can count on (spec §3, the "y" of "x / y dolu"): open, and neither out of
 *  service nor in maintenance. A reserved bed is usable — it waits for its patient. */
export const usable = (bed) => Boolean(bed?.open) && bed.state !== "BLOCKED" && bed.state !== "MAINTENANCE";

/** The unit header's numbers. `occupied` is every bed a patient is in: OCCUPIED and the two
 *  pending states, whose patient has not left yet. A closed bed counts nowhere. */
export function unitCounts(unit) {
  const out = { occupied: 0, usable: 0, free: 0, cleaning: 0, reserved: 0, outOfService: 0, maintenance: 0 };
  for (const room of unit.rooms ?? []) {
    for (const raw of room.beds ?? []) {
      const bed = withOpen(unit, room, raw);
      if (!bed.open) continue;
      if (usable(bed)) out.usable += 1;
      if (bed.state === "AVAILABLE") out.free += 1;
      else if (bed.state === "HOUSEKEEPING") out.cleaning += 1;
      else if (bed.state === "RESERVED") out.reserved += 1;
      else if (bed.state === "BLOCKED") out.outOfService += 1;
      else if (bed.state === "MAINTENANCE") out.maintenance += 1;
      else out.occupied += 1;
    }
  }
  return out;
}

/** The states of a bed a patient is in: OCCUPIED and the two pending states. */
const WITH_PATIENT = new Set(["OCCUPIED", "PENDING_DISCHARGE", "PENDING_TRANSFER_OUT"]);
const NOTHING_SHOWN = Object.freeze({ name: null, reason: null, note: null });

/** What a bed's tile says from the names read (`about`, GET /tenant/occupancy, R1), by the state
 *  the STRUCTURE shows (final review M-2). The two are read apart, and the structure is also read
 *  again on its own (StructureProvider: a retry, a unit added, another screen's write): a newer
 *  state must never stand under an older read's name, note or reason. So the short name goes only
 *  on a bed a patient is in, the note only on a reserved or out-of-service bed, and the reason only
 *  on an out-of-service bed. */
export function shownOf(bed, about) {
  if (!about) return NOTHING_SHOWN;
  return {
    name: WITH_PATIENT.has(bed?.state) ? about.occupant_short ?? null : null,
    reason: bed?.state === "BLOCKED" ? about.state_reason ?? null : null,
    note: bed?.state === "RESERVED" || bed?.state === "BLOCKED" ? about.state_note ?? null : null,
  };
}

const can = (perms, key) => Array.isArray(perms) && perms.includes(key);

/** The moves this session may offer on a bed, in the order they are shown. The server checks
 *  each again (tenant/router.py, admission/router.py). */
export function actionsFor(bed, perms) {
  if (!bed?.open) return [];
  const admit = can(perms, "admissions.admit") ? ["admit"] : [];
  const manage = can(perms, "beds.manage_state");
  switch (bed.state) {
    case "AVAILABLE": return [...admit, ...(manage ? ["reserve", "outOfService"] : [])];
    case "RESERVED": return [...admit, ...(manage ? ["unreserve"] : [])];             // X10
    case "HOUSEKEEPING": return can(perms, "beds.release") ? ["release"] : [];
    case "BLOCKED":
    case "MAINTENANCE": return manage ? ["returnToService"] : [];                     // R3
    default: return [];
  }
}

/** How long a bed has been in its state, as an i18n key and its numbers — or null when the
 *  server gave no instant (then nothing is said rather than an invented age). Never negative: a
 *  ward PC ahead of the server says "just now" (screens/common/elapsed.js has the same rule). */
export function sinceKey(fromMs, nowMs) {
  if (!Number.isFinite(fromMs)) return null;
  const minutes = Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
  if (minutes < 1) return { key: "doluluk.since.now", vars: {} };
  if (minutes < 60) return { key: "doluluk.since.min", vars: { n: minutes } };
  if (minutes < 48 * 60) return { key: "doluluk.since.hour", vars: { h: Math.floor(minutes / 60), m: minutes % 60 } };
  return { key: "doluluk.since.day", vars: { n: Math.floor(minutes / 1440) } };
}

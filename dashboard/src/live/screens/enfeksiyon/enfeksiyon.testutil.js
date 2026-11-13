// Test-only: a synthetic ward for «Enfeksiyon kontrol» (G4-05) — the kabul ward (Reanimasiya open, Neonatal closed)
// with an isolation room whose beds stand in every tile state, and GET /infection's answer in the shape the engine sends
// after spec §5: four patients in isolation (one in the isolation room, one outside it, one on a bed the structure
// calls free, one on no bed), four with suspected infection or a Sepsis-3 alarm (a missed clock with a firing septic
// shock, a running clock, a latched septic shock after the mark was charted 0), and who lies on each bed. The two lists
// come in the SERVER'S order (by patient key), which the page re-orders by name. Synthetic names and keys only
// (CLAUDE.md rule 6).
import { NOW } from "../../data/board.testutil.js";
import { BED, NEO, REA, ROOM1, SITE, T } from "../kabul/kabul.testutil.js";

export { BED, NEO, NOW, REA };
export const MIN = 60_000;
/** An ISO instant this many minutes before NOW (negative: after it). */
export const at = (minutesAgo) => new Date(NOW - minutesAgo * MIN).toISOString();
export const ISO_ROOM = "44444444-4444-4444-8444-444444444411";
export const ISO_ROOM_CLOSED = "44444444-4444-4444-8444-444444444412";
const NEO_ROOM = "44444444-4444-4444-8444-444444444413";

const bed = (n, label, state = "AVAILABLE", isActive = true) => ({ id: BED(n), label, state, is_active: isActive,
  state_since: at(60) });

/** GET /tenant/structure. Reanimasiya: «Otaq 1» (not an isolation room: beds 1 and 2 occupied, 3 free) and
 *  «İzolasyon 1» — beds İzo 1 … İzo 10 in every tile state, İzo 11 closed; «İzolasyon 2», a closed isolation room;
 *  Neonatal, a closed unit with an isolation room. `isolation: false` makes every room an ordinary one. */
export function tree({ isolation = true } = {}) {
  return {
    tenant_id: T,
    sites: [{ id: SITE, name: "Ana bina", is_active: true, units: [
      { id: REA, name: "Reanimasiya", unit_type: "ADULT_ICU", is_active: true, rooms: [
        { id: ROOM1, name: "Otaq 1", room_number: null, is_isolation: false, is_active: true,
          beds: [bed(1, "1", "OCCUPIED"), bed(2, "2", "OCCUPIED"), bed(3, "3", "OCCUPIED")] },
        { id: ISO_ROOM, name: "İzolasyon 1", room_number: null, is_isolation: isolation, is_active: true, beds: [
          bed(11, "İzo 1", "OCCUPIED"),             // Ayşe, in isolation                     → isolated
          bed(12, "İzo 2"),                         //                                        → free
          bed(13, "İzo 3", "OCCUPIED"),             // her patient is outside this list       → occupant_unseen
          bed(14, "İzo 4", "HOUSEKEEPING"),         //                                        → cleaning
          bed(15, "İzo 5", "RESERVED"),             //                                        → reserved
          bed(16, "İzo 6", "BLOCKED"),              //                                        → out_of_service
          bed(17, "İzo 7", "MAINTENANCE"),          //                                        → maintenance
          bed(18, "İzo 8", "PENDING_DISCHARGE"),    // Nigar, not in isolation                → not_isolated
          bed(19, "İzo 9", "OCCUPIED"),             // Leyla, nothing recorded                → unrecorded
          bed(20, "İzo 10"),                        // Kamran, placed by the HIS bed map      → conflict
          bed(21, "İzo 11", "AVAILABLE", false),    // closed: not drawn
        ] },
        { id: ISO_ROOM_CLOSED, name: "İzolasyon 2", room_number: null, is_isolation: isolation, is_active: false,
          beds: [bed(22, "İzo 12")] },
      ] },
      { id: NEO, name: "Neonatal", unit_type: "NICU", is_active: false, rooms: [
        { id: NEO_ROOM, name: "N-1", room_number: null, is_isolation: isolation, is_active: true, beds: [bed(6, "N1")] },
      ] },
    ] }],
  };
}

const NO_CLOCK = Object.freeze({ state: "none", given: null, given_at: null, recognized_at: null, deadline: null,
  remaining_sec: null });
/** A row's `isolation` (api/infection.py `isolation_of`). */
export const iso = (state, types = [], chartedAt = at(80)) => ({ state, types,
  charted_at: state === "unrecorded" ? null : chartedAt });
/** One of a row's `sepsis_alarms`; `over` replaces whole fields. */
export const alarmOf = (kind, severity, over = {}) => ({ kind, severity, first_seen_at: at(70), resolved_at: null,
  acknowledged: false, snooze_until: null, ...over });

/** One row; `over` replaces whole fields. */
export const row = (patientId, over = {}) => ({
  patient_id: patientId, bed_label: "", bed_id: null, unit_id: REA, display_name: "", isolation: iso("unrecorded"),
  suspected_infection: null, antibiotic: { ...NO_CLOCK }, sepsis_alarms: [], sort_group: 2, ...over,
});

export const AYSE = row("S-101", { bed_label: "İzo 1", bed_id: BED(11), display_name: "Ayşe Sentetik",
  isolation: iso("isolated", ["contact", "droplet"]), suspected_infection: true,
  antibiotic: { state: "met", given: true, given_at: at(170), recognized_at: at(210), deadline: at(150), remaining_sec: null } });
// Its deadline is half a minute off the whole minute (NOW + 20:30), so «20 dəq qalıb» holds whether the screen's clock
// stands on NOW or a few milliseconds past it (Eczane's fixture does the same).
export const ELIF = row("S-102", { bed_label: "3", bed_id: BED(3), display_name: "Elif Sentetik", suspected_infection: true,
  antibiotic: { state: "running", given: null, given_at: null, recognized_at: at(39.5), deadline: at(-20.5), remaining_sec: 1230 },
  sort_group: 0 });
export const ALI = row("S-103", { bed_label: "2", bed_id: BED(2), display_name: "Ali Sentetik", suspected_infection: true,
  antibiotic: { state: "missed", given: null, given_at: null, recognized_at: at(85), deadline: at(25), remaining_sec: -1500 },
  sepsis_alarms: [alarmOf("septic_shock", "critical")], sort_group: 0 });
/** In isolation outside an isolation room; the HIS has sent no name. */
export const UNNAMED = row("S-104", { bed_label: "1", bed_id: BED(1), isolation: iso("isolated", ["airborne"], at(700)) });
/** In isolation, on no bed and no unit (the bed table does not place her HIS location). */
export const MURAD = row("S-105", { unit_id: null, display_name: "Murad Sentetik", isolation: iso("isolated", ["protective"]) });
export const NIGAR = row("S-106", { bed_label: "İzo 8", bed_id: BED(18), display_name: "Nigar Sentetik",
  isolation: iso("not_isolated") });
/** A septic shock that stopped while nobody acknowledged it, after suspected infection was charted 0 (§5 M3). */
export const LEYLA = row("S-107", { bed_label: "İzo 9", bed_id: BED(19), display_name: "Leyla Sentetik",
  suspected_infection: false, sepsis_alarms: [alarmOf("septic_shock", "critical", { resolved_at: at(15) })] });
/** In isolation on a bed the structure calls free: the HIS bed map placed her there (§5 A4 a). */
export const KAMRAN = row("S-108", { bed_label: "İzo 10", bed_id: BED(20), display_name: "Kamran Sentetik",
  isolation: iso("isolated", ["airborne"]) });

/** The two lists as the server sends them: by patient key. */
export const ISOLATED = [AYSE, UNNAMED, MURAD, KAMRAN];
export const SUSPECTED = [AYSE, ELIF, ALI, LEYLA];
export const ROWS = [AYSE, ELIF, ALI, UNNAMED, MURAD, NIGAR, LEYLA, KAMRAN];
/** A row as `bed_occupants` carries it. */
export const occupantOf = (r) => ({ bed_id: r.bed_id, patient_id: r.patient_id, display_name: r.display_name,
  isolation: { state: r.isolation.state, types: [...r.isolation.types] } });
export const COUNTS = { patients: 8, isolated: 4, isolation_unrecorded: 3, suspected: 3, suspected_unrecorded: 4,
  clock_missed: 1, sepsis_open: 1 };
export const REA_COUNTS = { patients: 7, isolated: 3, isolation_unrecorded: 3, suspected: 3, suspected_unrecorded: 3,
  clock_missed: 1, sepsis_open: 1 };
export const SCOPE = { unrestricted: false, reason: "assigned", unit_ids: [REA], bed_ids: [], own_patients: 0, hidden: 0,
  unresolved_hidden: 0, unmatched_unit_ids: [], unmatched_bed_ids: [], blind: false };

/** GET /infection; `over` replaces whole top-level fields. */
export const answer = (over = {}) => ({
  now: at(0), antibiotic_window_min: 60, antibiotic_window_source: "surviving-sepsis-campaign-2026",
  counts: { ...COUNTS }, units: [{ unit_id: REA, counts: { ...REA_COUNTS } }],
  isolated: ISOLATED, suspected: SUSPECTED, bed_occupants: ROWS.filter((r) => r.bed_id).map(occupantOf),
  scope: SCOPE, scope_note: null, ...over,
});

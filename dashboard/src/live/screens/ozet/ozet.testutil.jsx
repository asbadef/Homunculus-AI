// Test-only: a synthetic hospital for «Yönetici özeti» (G4-02) — the kabul ward's structure (Reanimasiya open, Neonatal
// closed), a live board with a named patient and two waiting alarms, the task queue, the waiting handovers, the shadow
// board with G4-01's ledger, the alarm-quality report — and a mount of the page inside the shell's StructureProvider,
// the board LIVE and the strip started, as LiveApp nests them. Synthetic names and ids only; no screen may print the
// patient's name, its id or a UUID.
import React from "react";
import { act } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { StructureProvider } from "../../data/StructureProvider.jsx";
import { alarm, board, entry, identity } from "../../data/board.testutil.js";
import { AT, bed, strip } from "../../data/shadow.testutil.js";
import { PERMISSION_KEYS } from "../admin/catalogue.js";
import { SCOPE_ADMIN } from "../admin/admin.testutil.js";
import { NEO, REA, structure } from "../kabul/kabul.testutil.js";
import { OzetScreen } from "./OzetScreen.jsx";

/** The system administrator: the whole catalogue (the system group holds it by rule). */
export const ADMIN = [...PERMISSION_KEYS];
export const PATIENT_NAME = "Ayşe Sentetik";
export const PATIENT_ID = "S-001";

/** `/patients`: one card in Reanimasiya with a critical and a high alarm, both waiting. */
export const BOARD = board([
  entry(PATIENT_ID, [alarm("septic_shock", "critical"), alarm("news2", "high")],
    { identity: identity({ patient_id: PATIENT_ID, display_name: PATIENT_NAME, unit_id: REA, bed_id: null }) }),
]);
/** `/tasks`: a late vital and a late hand task in Reanimasiya. */
export const TASKS = {
  from: "2026-11-11T04:00:00Z", to: "2026-11-11T16:00:00Z", now: "2026-11-11T10:00:00Z",
  shift: { start: "2026-11-11T04:00:00Z", end: "2026-11-11T16:00:00Z" }, settings: { grace_min: 30, intervals: {} },
  patients: [{ patient_id: PATIENT_ID, bed_key: "REA^01^2", unit_id: REA, vital: { state: "late" },
    tasks: [{ id: "t1", late: true, state: "open" }] }],
};
/** `/handovers/pending`: two waiting in Reanimasiya, the oldest signed two days before the answer. */
export const PENDING = {
  generated_at: "2026-11-11T10:00:00+00:00",
  units: [{ unit_id: REA, unit_name: "Reanimasiya", pending: 2, oldest_outgoing_signed_at: "2026-11-09T09:00:00+00:00" }],
};
/** `/alarm-quality`: a week, two days of episodes, one kind; `noisiest_beds` names a patient the page must not show. */
export const REPORT = {
  episodes: 12, answered: 9, unanswered: 2, escalated: 1, pending: 1, answered_rate: 0.8182,
  median_response_sec: 42, p90_response_sec: 185, days: 7, truncated: false, window_from: "2026-11-05T08:00:00+00:00",
  per_kind: [{ kind: "news2", episodes: 8, answered: 6, escalated: 1, unanswered: 1, pending: 1, median_response_sec: 40 }],
  per_day: [{ date: "2026-11-09", episodes: 4 }, { date: "2026-11-10", episodes: 8 }],
  noisiest_beds: [{ patient_id: PATIENT_ID, episodes: 5 }], per_patient_hour: [],
};
const minutesBefore = (n) => new Date(Date.parse(AT) - n * 60_000).toISOString();
/** The shadow board with the ledger: Reanimasiya's monitor 1 silent for seven minutes, its monitor 2 sending. */
export const STRIP = {
  ...strip({ beds: [
    bed("REA-01 · 1", [], { unit_id: REA, status: "silent", last_packet_at: minutesBefore(7), silent_for_s: 420, channels_seen: [] }),
    bed("REA-01 · 2", [], { unit_id: REA, last_packet_at: minutesBefore(0), channels_seen: [] }),
  ] }),
  watching_since: minutesBefore(120), stale_list_after_s: 60, stale_list_until_s: 3600, vanished: [],
};

export const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });

/** Mount the page for a session holding `perms`; `live: false` leaves the board connecting (its stream never opens). */
export async function mountOzet({ perms = ADMIN, setup, live = true } = {}) {
  const mounted = await mount(<StructureProvider><OzetScreen /></StructureProvider>, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      api.structure.mockResolvedValue(structure());
      api.boardPatients.mockResolvedValue(BOARD);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.tasks.mockResolvedValue(TASKS);
      api.pendingHandovers.mockResolvedValue(PENDING);
      api.alarmQuality.mockResolvedValue(REPORT);
      api.shadowBoard.mockResolvedValue(STRIP);
      api.myScope.mockResolvedValue(SCOPE_ADMIN);   // GET /scope/me: the units table's reach — the administrator's, unrestricted
      setup?.(api);
    },
  });
  await settle();
  await act(async () => { await mounted.board.start(); });
  if (live) await act(async () => { mounted.stream.open(); await new Promise((resolve) => { setTimeout(resolve, 0); }); });
  await act(async () => { mounted.shadow.start(perms); await new Promise((resolve) => { setTimeout(resolve, 0); }); });
  await settle();
  return mounted;
}

export { NEO, REA };

// Test-only: synthetic answers of GET /infinity-shadow/board (Aşama A's unvalidated monitor
// strip), in the API's own shape (homunculus-engine api/infinity_shadow.py `board_view`).
//
// NO PATIENT DATA, EVER (CLAUDE.md, hard rule 6), and no real monitor: addresses are 192.0.2.x
// (TEST-NET-1), groups 239.20.1.x, bed labels "REA-01 · 2"-style, patient ids "S-001". Values are
// made up and say nothing about anyone.
//
// The convention of board.testutil.js: what a test varies is positional, everything else is a
// trailing override.
//
//     param("hr", 72)                       a fresh value, 2 s old
//     param("spo2", null, { state: "invalid" })
//     param("nbp", [118, 79, 92])           NBP, its value changed ten minutes before AT
//     param("nbp", null)                    NBP awaiting a change (none seen since the hub started)
//     bed("REA-01 · 2", [param("hr", 72)], { link: "one", patient_id: "S-001" })
//     unassigned("192.0.2.28", "table_unassigned")
//     strip({ beds: [...], unassigned: [...] })

export const UNIT = Object.freeze({
  hr: "bpm", pls: "bpm", spo2: "%", etco2: "mmHg", temperature: "C",
  art_systolic: "mmHg", art_diastolic: "mmHg", art_mean: "mmHg", respiration: "/min", nbp: "mmHg",
});
const EVIDENCE = Object.freeze({
  hr: "screen_match_two_devices", pls: "screen_match_two_devices", spo2: "screen_match_two_devices",
  etco2: "screen_match_two_devices", art_systolic: "screen_match", temperature: "screen_match_site_unknown",
  art_mean: "structural", art_diastolic: "structural_trend", respiration: "range_overlap", nbp: "screen_match",
});
const PARTIAL = new Set(["temperature", "art_mean", "art_diastolic", "respiration"]);

/** When a strip answer was generated in these fixtures. */
export const AT = "2026-10-08T10:00:00+00:00";

/** When the fixtures' NBP last changed: ten minutes before AT. */
export const NBP_CHANGED_AT = "2026-10-08T09:50:00+00:00";

/** One parameter as the API sends it. `value` null with no `state` override means "invalid". NBP is
 *  the API's ONE entry for its three readings (`param("nbp", [s, d, m])`, or `null` for "no change
 *  seen yet"); a wire name such as `nbp_systolic` never reaches the board and is refused here. */
export function param(name, value, over = {}) {
  if (!(name in UNIT)) throw new TypeError(`param(name, value, over): no such forwarded parameter ${name}`);
  if (name === "nbp") return nbpParam(value, over);
  return {
    parameter: name, state: value === null ? "invalid" : "value", value, unit: UNIT[name], age_s: 2,
    last_at: AT, evidence: EVIDENCE[name], partial: PARTIAL.has(name), ...over,
  };
}

function nbpParam(triple, over) {
  if (triple !== null && !(Array.isArray(triple) && triple.length === 3)) {
    throw new TypeError('param("nbp", [systolic, diastolic, mean] | null, over)');
  }
  const shown = triple !== null;
  return {
    parameter: "nbp", state: shown ? "value" : "old",
    systolic: shown ? triple[0] : null, diastolic: shown ? triple[1] : null, mean: shown ? triple[2] : null,
    unit: "mmHg", age_s: shown ? 2 : null, last_at: shown ? AT : null,
    changed_at: shown ? NBP_CHANGED_AT : null, measured_age_s: shown ? 600 : null,
    evidence: EVIDENCE.nbp, partial: false, ...over,
  };
}

/** A bed monitor card (a device the approved table places on a bed). */
export function bed(label, parameters = [], over = {}) {
  if (!Array.isArray(parameters)) throw new TypeError("bed(label, parameters, over): parameters is an array");
  const n = Number(/(\d+)\D*$/.exec(label)?.[1] ?? 10);
  return {
    bed_label: label, bed_id: `bed-${n}`, unit_id: "REA-01", method: "monitor_screen", verified_at: "2026-10-07",
    source: `192.0.2.${n}`, group: `239.20.1.${n}`, status: "streaming", status_age_s: 2, packet_age_ms: 120,
    parameters, link: "none", patient_id: null, link_reason: null, ...over,
  };
}

/** An "atanmamış cihaz" card. */
export function unassigned(source, reason = "table_unassigned", parameters = [], over = {}) {
  return {
    source, group: `239.20.1.${source.split(".").pop()}`, status: "standby", status_age_s: 2, packet_age_ms: 120,
    parameters, reason, note: reason === "table_unassigned" ? "unresolved: two lists disagree" : null, ...over,
  };
}

const COUNTED = ["streaming", "standby", "silent", "waiting", "unsupported", "unknown"];

/** A whole stage-shadow answer. The feed's device counts are computed from the cards, as the API
 *  computes them; `feed` overrides any of the feed's fields. */
export function strip({ beds = [], unassigned: devices = [], feed = {}, table = {} } = {}) {
  const shown = [...beds, ...devices];
  const counts = { total: shown.length };
  for (const s of COUNTED) counts[s] = shown.filter((c) => c.status === s).length;
  return {
    stage: "shadow", display_max_age_s: 15, generated_at: AT,
    table: { status: "ok", reason: null, version: 1, sha256: "ab12cd34ef56".padEnd(64, "0"),
      approved_at: "2026-10-07", site: "synthetic", ...table },
    feed: { state: "ok", last_post_at: AT, last_post_age_s: 2, collector_age_s: 1, collector_connected: true,
      posts: 12, forwarder: { interval_s: 5, sent: 11, failed: 0, decoder: "homunculus.infinity-preview.v3" },
      hub: { accepted_packets: 1000, old_or_duplicate_packets: 0 },
      rejected: { too_old: 0, clock: 0, unit: 0, range: 0, unknown_parameter: 0, duplicate: 0 },
      lag_ms: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], devices: counts, unassigned: devices.length, ...feed },
    beds, unassigned: devices,
  };
}

export const STAGE_OFF = Object.freeze({ stage: "off" });

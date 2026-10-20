// Test-only: synthetic GET /patients/{id}/trends answers, in the endpoint's own shape
// (homunculus-engine api/trends.py `patient_trends`), for the patient screen's trend charts.
//
// NO PATIENT DATA, EVER (CLAUDE.md, hard rule 6). Ids are `S-001`…, every value is invented, and
// every instant is relative to board.testutil's NOW, so an age a test prints is the age it wrote.
// Nothing here may be replaced by anything from a real ward, a capture or an export.
//
// The convention is board.testutil's: what a fixture almost always varies is POSITIONAL, the rest
// goes in a trailing override, and the builders THROW on the other shape rather than quietly
// building a fixture that does not hold what the test is about:
//
//     trends("S-001", [channel("heart_rate", [point(30, 84, 0), point(5, 132, 3)], { latest: … })])
import { NOW, ago } from "../../../data/board.testutil.js";

/** The channels the endpoint lists, in its order (api/board.py `_PUBLISHED_SIGNALS`). */
export const KEYS = Object.freeze(["heart_rate", "map", "sbp", "spo2", "temperature", "resp_rate", "lactate"]);

const UNITS = { heart_rate: "/min", map: "mmHg", sbp: "mmHg", spo2: "%", temperature: "°C", resp_rate: "/min", lactate: "mmol/L" };

/** The engine's NEWS2 rows as the endpoint serves them (rules/news2.py `NEWS2_BANDS`, Scale 1):
 *  `low < value <= high`, null for an open side. MAP and lactate have none. */
export const BANDS = Object.freeze({
  heart_rate: [{ low: null, high: 40, points: 3 }, { low: 40, high: 50, points: 1 }, { low: 50, high: 90, points: 0 },
    { low: 90, high: 110, points: 1 }, { low: 110, high: 130, points: 2 }, { low: 130, high: null, points: 3 }],
  resp_rate: [{ low: null, high: 8, points: 3 }, { low: 8, high: 11, points: 1 }, { low: 11, high: 20, points: 0 },
    { low: 20, high: 24, points: 2 }, { low: 24, high: null, points: 3 }],
  spo2: [{ low: null, high: 91, points: 3 }, { low: 91, high: 93, points: 2 }, { low: 93, high: 95, points: 1 },
    { low: 95, high: null, points: 0 }],
  sbp: [{ low: null, high: 90, points: 3 }, { low: 90, high: 100, points: 2 }, { low: 100, high: 110, points: 1 },
    { low: 110, high: 219, points: 0 }, { low: 219, high: null, points: 3 }],
  temperature: [{ low: null, high: 35, points: 3 }, { low: 35, high: 36, points: 1 }, { low: 36, high: 38, points: 0 },
    { low: 38, high: 39, points: 1 }, { low: 39, high: null, points: 2 }],
  map: null,
  lactate: null,
});

/** One reading: `[iso, value, the engine's NEWS2 points for it]`, `minutesAgo` before NOW. */
export const point = (minutesAgo, value, points = null) => [ago(minutesAgo * 60), value, points];

/** One mark on the time axis. */
export const marker = (minutesAgo, kind = "alarm", label = kind === "alarm" ? "news2" : "antibiotic_administered") => (
  { ts: ago(minutesAgo * 60), kind, label });

/** One channel. Its `latest` defaults to the last point with no delta and no own-normal judgement;
 *  a test about those states them in `over.latest`. */
export function channel(key, points = [], over = {}) {
  if (!KEYS.includes(key)) throw new TypeError(`channel(key, points, over): no channel "${key}"`);
  if (!Array.isArray(points)) throw new TypeError("channel(key, points, over): points is an array of point(…)");
  const last = points[points.length - 1];
  return {
    key,
    unit: UNITS[key],
    points,
    thinned: false,
    total_points: points.length,
    latest: last ? { ts: last[0], value: last[1], delta: null, news2_points: last[2], within_own_normal: null } : null,
    bands: { news2: BANDS[key], own_normal: null, device: null },
    ...over,
  };
}

/** One answer: every channel the endpoint lists, the given ones in place of empty ones. */
export function trends(patientId = "S-001", channels = [], over = {}) {
  if (typeof patientId !== "string") throw new TypeError("trends(patientId, channels, over): the id comes first");
  if (!Array.isArray(channels)) throw new TypeError("trends(patientId, channels, over): channels is an array of channel(…)");
  const byKey = Object.fromEntries(channels.map((c) => [c.key, c]));
  const hours = over.hours ?? 24;
  return {
    patient_id: patientId,
    hours,
    since: new Date(NOW - hours * 3_600_000).toISOString(),
    until: new Date(NOW).toISOString(),
    generated_at: new Date(NOW).toISOString(),
    bands_source: "news2-rcp-2017",
    news2_scale: 1,
    channels: KEYS.map((key) => byKey[key] ?? channel(key)),
    markers: [],
    ...over,
  };
}

/** `api.patientTrends` answering every patient and window with `build(patientId, hours)`. */
export const answering = (build = (pid, hours) => trends(pid, [], { hours })) => (pid, hours) => Promise.resolve(build(pid, hours));

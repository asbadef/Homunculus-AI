// src/live/screens/patient/trends/news2Tone.js — the ONE mapping from the engine's NEWS2 points for
// one parameter to the tone it is drawn in, on a card's frame and on a chart's band (spec D2):
// 0 → none, 1–2 → amber ("mid"), 3 → red ("crit").
//
// The points are the SERVER's (homunculus-engine api/trends.py: `latest.news2_points`, a band's
// `points`); nothing here looks at a value. One copy, with its test, for the reason `pillRisk` has
// one: a card framed red above a band drawn amber is two answers to one question on one screen.
// Anything that is not a number of at least 1 — MAP and lactate have no points — is no tone.
export function news2Tone(points) {
  if (typeof points !== "number" || !Number.isFinite(points) || points < 1) return null;
  return points >= 3 ? "crit" : "mid";
}

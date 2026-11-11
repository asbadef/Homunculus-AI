// src/live/screens/rrt/rrt.js — the RRT screen's lists, from the board (G2-B5, spec D6, D7). Owner D1: the RRT
// comes only when called by hand, so its own list is the open calls; the second list is what may yet need it —
// the unanswered urgent alarms, which the engine escalates to the doctor, not to the RRT.
import { waitingAlarms } from "../../data/boardStore.js";

/** {known, stale, called, waiting}: `called` the alarms with an open call that nobody has acknowledged, the
 *  oldest call first; `waiting` the alarms that wait for an answer (`waitingAlarms`, its order) — a snoozed one
 *  not, until its `until` by the board's `nowMs` (G2-B5b) — with urgency `immediate` and no call.
 *  `called`/`waiting` are null when the board cannot be read — never an empty list a reader would take for a
 *  quiet ward (Decision 18). */
export function rrtQueue(board) {
  const { known, stale, items } = waitingAlarms(board);
  if (items === null) return { known, stale, called: null, waiting: null };
  const alerts = Array.isArray(board?.alerts) ? board.alerts : [];
  const called = alerts.filter((a) => a.rrtCall && !a.ack)
    .sort((a, b) => (a.rrtCall.atMs ?? Infinity) - (b.rrtCall.atMs ?? Infinity));
  const waiting = items.filter((a) => !a.rrtCall && a.urgency === "immediate");
  return { known, stale, called, waiting };
}

import type { PatientBoard } from "../transport/types";
import { alertKey } from "./keys";

export { alertKey };

export interface EscalationArgs {
  boards: readonly PatientBoard[];
  /** Key -> the app's own first-seen stamp, in epoch ms. */
  firstSeen: Readonly<Record<string, number>>;
  acknowledged: ReadonlySet<string>;
  now: number;
  thresholdMs: number;
}

/**
 * Port of homunculus-engine/src/homunculus/api/escalation.py: an alert escalates when its urgency
 * is immediate, nobody has acknowledged it, and it has been visible for at least the threshold.
 *
 * The clock is the app's own. The recorded `first_seen_at` belongs to the recording session weeks
 * ago, so measuring against it would escalate the whole ward on launch. The store stamps its own
 * first-seen the moment an alert appears — which is exactly what the server does on /ingest, where
 * the stamp is deliberately wall-clock and not observation time.
 */
export function escalatedKeys(args: EscalationArgs): Set<string> {
  const escalated = new Set<string>();
  for (const board of args.boards) {
    for (const alert of board.alerts) {
      if (alert.urgency !== "immediate") continue;
      const key = alertKey(board.patient_id, alert.kind);
      if (alert.acknowledged || args.acknowledged.has(key)) continue;
      const seen = args.firstSeen[key];
      if (seen !== undefined && args.now - seen >= args.thresholdMs) escalated.add(key);
    }
  }
  return escalated;
}

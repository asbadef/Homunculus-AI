import type { BoardAlert, PatientBoard, Risk, Severity, Urgency } from "../transport/types";
import type { Tone } from "../theme/tokens";
import { alertKey } from "./keys";

const RISK_ORDER: Risk[] = ["none", "info", "low", "moderate", "high", "critical"];
const SEVERITY_ORDER: Severity[] = ["info", "low", "moderate", "high", "critical"];
const URGENCY_ORDER: Urgency[] = ["routine", "soon", "immediate"];

export function riskRank(risk: Risk): number {
  const index = RISK_ORDER.indexOf(risk);
  return index < 0 ? 0 : index;
}

export function riskTone(risk: Risk): Tone {
  if (risk === "critical") return "critical";
  if (risk === "high" || risk === "moderate") return "warning";
  if (risk === "none") return "muted";
  return "safe";
}

export function severityTone(severity: Severity): Tone {
  return riskTone(severity);
}

export function topAlert(board: PatientBoard): BoardAlert | null {
  let best: BoardAlert | null = null;
  for (const candidate of board.alerts) {
    if (best === null) {
      best = candidate;
      continue;
    }
    const bySeverity =
      SEVERITY_ORDER.indexOf(candidate.severity) - SEVERITY_ORDER.indexOf(best.severity);
    const byUrgency =
      URGENCY_ORDER.indexOf(candidate.urgency) - URGENCY_ORDER.indexOf(best.urgency);
    if (bySeverity > 0 || (bySeverity === 0 && byUrgency > 0)) best = candidate;
  }
  return best;
}

export function isAcknowledged(
  board: PatientBoard,
  alert: BoardAlert,
  locallyAcked: ReadonlySet<string>,
): boolean {
  return alert.acknowledged || locallyAcked.has(alertKey(board.patient_id, alert.kind));
}

export function hasUnacknowledged(board: PatientBoard, locallyAcked: ReadonlySet<string>): boolean {
  return board.alerts.some((a) => !isAcknowledged(board, a, locallyAcked));
}

/** Risk descending, then unacknowledged first, then bed id — the order a nurse triages in. */
export function sortWard(
  boards: readonly PatientBoard[],
  locallyAcked: ReadonlySet<string>,
): PatientBoard[] {
  return [...boards].sort((a, b) => {
    const byRisk = riskRank(b.risk) - riskRank(a.risk);
    if (byRisk !== 0) return byRisk;
    const openA = hasUnacknowledged(a, locallyAcked) ? 0 : 1;
    const openB = hasUnacknowledged(b, locallyAcked) ? 0 : 1;
    if (openA !== openB) return openA - openB;
    return a.patient_id.localeCompare(b.patient_id);
  });
}

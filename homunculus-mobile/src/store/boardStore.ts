import { escalatedKeys } from "../domain/escalation";
import { alertKey } from "../domain/keys";
import { hasUnacknowledged, riskTone, sortWard, topAlert } from "../domain/risk";
import type { Tone } from "../theme/tokens";
import type { BoardAlert, BoardNotification, PatientBoard, Role } from "../transport/types";

const SERIES_CAP = 120;
const NOTIFICATION_CAP = 50;

export interface VitalSeries {
  heart_rate: number[];
  map: number[];
  spo2: number[];
  temperature: number[];
  resp_rate: number[];
  lactate: number[];
  sofa: number[];
}

export interface BoardState {
  patients: Record<string, PatientBoard>;
  series: Record<string, VitalSeries>;
  /** Key -> the app's own first-seen stamp. See src/domain/escalation.ts for why. */
  firstSeen: Record<string, number>;
  acknowledged: string[];
  notifications: BoardNotification[];
}

export const initialBoardState: BoardState = {
  patients: {},
  series: {},
  firstSeen: {},
  acknowledged: [],
  notifications: [],
};

export type BoardAction =
  | { type: "board"; board: PatientBoard; now: number }
  | { type: "notification"; note: BoardNotification }
  | { type: "ack"; patientId: string; kind: string; role: Role; now: number }
  | { type: "loop" };

const emptySeries = (): VitalSeries => ({
  heart_rate: [], map: [], spo2: [], temperature: [], resp_rate: [], lactate: [], sofa: [],
});

const push = (series: number[], value: number | null): number[] =>
  value === null ? series : [...series, value].slice(-SERIES_CAP);

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "board": {
      const { board, now } = action;
      const firstSeen = { ...state.firstSeen };
      for (const alert of board.alerts) {
        const key = alertKey(board.patient_id, alert.kind);
        if (firstSeen[key] === undefined) firstSeen[key] = now;
      }
      const previous = state.series[board.patient_id] ?? emptySeries();
      return {
        ...state,
        patients: { ...state.patients, [board.patient_id]: board },
        firstSeen,
        series: {
          ...state.series,
          [board.patient_id]: {
            heart_rate: push(previous.heart_rate, board.latest.heart_rate),
            map: push(previous.map, board.latest.map),
            spo2: push(previous.spo2, board.latest.spo2),
            temperature: push(previous.temperature, board.latest.temperature),
            resp_rate: push(previous.resp_rate, board.latest.resp_rate),
            lactate: push(previous.lactate, board.latest.lactate),
            sofa: push(previous.sofa, board.latest.sofa),
          },
        },
      };
    }
    case "notification":
      return {
        ...state,
        notifications: [action.note, ...state.notifications].slice(0, NOTIFICATION_CAP),
      };
    case "ack": {
      const key = alertKey(action.patientId, action.kind);
      if (state.acknowledged.includes(key)) return state;
      return { ...state, acknowledged: [...state.acknowledged, key] };
    }
    case "loop":
      return initialBoardState;
  }
}

export interface PatientView {
  board: PatientBoard;
  top: BoardAlert | null;
  tone: Tone;
  escalated: boolean;
  unacknowledged: boolean;
  /** Whole-ward sets, shared by reference across every view — plumbing for the detail screen,
   *  which needs per-alert escalation/ack state. Do not "simplify" into per-patient copies. */
  escalatedKeys: ReadonlySet<string>;
  acknowledgedKeys: ReadonlySet<string>;
  series: VitalSeries;
}

export interface SelectOptions {
  now: number;
  thresholdMs: number;
}

function viewFor(
  board: PatientBoard,
  state: BoardState,
  acked: ReadonlySet<string>,
  escalated: ReadonlySet<string>,
): PatientView {
  // Recorded frames always carry `alert.escalated: false`, so the client-side rule (`escalated`,
  // keyed off the app's own first-seen clock) was the only signal in M1. Live frames set the
  // server's own escalation flag from its five-minute loop — that flag wins outright, merged with
  // (never overriding) the client rule, so replay behaviour is unchanged and M1's tests stay the
  // guard for it.
  const isEscalated = board.alerts.some(
    (a) => a.escalated || escalated.has(alertKey(board.patient_id, a.kind)),
  );
  return {
    board,
    top: topAlert(board),
    tone: isEscalated ? "critical" : riskTone(board.risk),
    escalated: isEscalated,
    unacknowledged: hasUnacknowledged(board, acked),
    escalatedKeys: escalated,
    acknowledgedKeys: acked,
    series: state.series[board.patient_id] ?? emptySeries(),
  };
}

export function selectWard(state: BoardState, options: SelectOptions): PatientView[] {
  const boards = Object.values(state.patients);
  const acked = new Set(state.acknowledged);
  const escalated = escalatedKeys({
    boards,
    firstSeen: state.firstSeen,
    acknowledged: acked,
    now: options.now,
    thresholdMs: options.thresholdMs,
  });
  // Ordering lives in the domain layer; the store only supplies the acknowledgement set.
  return sortWard(boards, acked).map((board) => viewFor(board, state, acked, escalated));
}

export function selectPatient(
  state: BoardState,
  patientId: string,
  options: SelectOptions,
): PatientView | undefined {
  const board = state.patients[patientId];
  if (!board) return undefined;
  return selectWard(state, options).find((view) => view.board.patient_id === patientId);
}

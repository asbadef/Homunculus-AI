// Hand-written from the payload api/board.py produces. The contract test in
// __tests__/recording.test.ts asserts the committed recording still matches, so a backend shape
// change fails a test here instead of silently blanking a screen.

export type Severity = "info" | "low" | "moderate" | "high" | "critical";
export type Risk = Severity | "none";
export type Urgency = "routine" | "soon" | "immediate";
export type Role = "nurse" | "doctor";

export interface BoardAlert {
  patient_id: string;
  kind: string;
  severity: Severity;
  urgency: Urgency;
  summary: string;
  clinical_reasoning: string;
  supporting_evidence: string[];
  recommended_actions: string[];
  confidence: string;
  source: "rule" | "model";
  downgraded: boolean;
  chronic_context: string;
  stale_inputs: string[];
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  first_seen_at: string | null;
  escalated: boolean;
}

export interface LatestVitals {
  heart_rate: number | null;
  map: number | null;
  spo2: number | null;
  temperature: number | null;
  resp_rate: number | null;
  lactate: number | null;
  sofa: number | null;
}

export interface PatientBoard {
  patient_id: string;
  risk: Risk;
  alerts: BoardAlert[];
  latest: LatestVitals;
}

export interface BoardNotification {
  tenant: string;
  patient_id: string;
  kind: string;
  severity: Severity;
  urgency: Urgency;
  audience: Role;
  trigger: "new" | "escalation";
  title: string;
  body: string;
  ts: string;
}

export interface RecordedFrame {
  t: number;
  boards: PatientBoard[];
  notifications: BoardNotification[];
}

export interface Recording {
  scenario: string;
  step_seconds: number;
  frames: RecordedFrame[];
  notification_history?: BoardNotification[];
}

export interface TransportListener {
  onBoard(board: PatientBoard): void;
  onNotification(note: BoardNotification): void;
  onLoop?(): void;
}

/** The seam: M1 replays a recording, M2 will read SSE. Screens never know which. */
export interface Transport {
  start(): void;
  stop(): void;
  /** Returns the unsubscribe function; call it to detach the listener. */
  subscribe(listener: TransportListener): () => void;
  ack(patientId: string, kind: string, role: Role): Promise<void>;
}

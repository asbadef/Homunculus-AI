/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { PatientCard } from "../src/ui/PatientCard";
import type { PatientView } from "../src/store/boardStore";
import type { BoardAlert, PatientBoard } from "../src/transport/types";

function alert(): BoardAlert {
  return {
    patient_id: "bed-3", kind: "septic_shock", severity: "critical", urgency: "immediate",
    summary: "Septic shock criteria met", clinical_reasoning: "", supporting_evidence: [],
    recommended_actions: [], confidence: "", source: "rule", downgraded: false,
    chronic_context: "", stale_inputs: [], acknowledged: false, acknowledged_by: null,
    acknowledged_at: null, first_seen_at: null, escalated: false,
  };
}

function view(overrides: Partial<PatientView> = {}): PatientView {
  const board: PatientBoard = {
    patient_id: "bed-3", risk: "critical", alerts: [alert()],
    latest: { heart_rate: null, map: 62, spo2: null, temperature: null, resp_rate: null, lactate: 3.4, sofa: 6 },
  };
  return {
    board, top: alert(), tone: "critical", escalated: false, unacknowledged: true,
    escalatedKeys: new Set(), acknowledgedKeys: new Set(),
    series: { heart_rate: [], map: [70, 66, 62], spo2: [], temperature: [], resp_rate: [], lactate: [], sofa: [] },
    ...overrides,
  };
}

describe("PatientCard", () => {
  it("identifies the patient only by bed", async () => {
    await render(<PatientCard view={view()} onPress={() => {}} />);
    expect(screen.getByText("YB Yatak 3")).toBeTruthy();
  });

  it("shows the most severe finding's summary", async () => {
    await render(<PatientCard view={view()} onPress={() => {}} />);
    expect(screen.getByText("Septic shock criteria met")).toBeTruthy();
  });

  it("marks an unacknowledged finding", async () => {
    await render(<PatientCard view={view()} onPress={() => {}} />);
    expect(screen.getByText("Onaylanmadı")).toBeTruthy();
  });

  it("shouts when the alert has escalated", async () => {
    await render(<PatientCard view={view({ escalated: true })} onPress={() => {}} />);
    expect(screen.getByText("ESKALE EDİLDİ")).toBeTruthy();
  });

  it("shows the SOFA total and a MAP trend", async () => {
    await render(<PatientCard view={view()} onPress={() => {}} />);
    expect(screen.getByText("SOFA 6")).toBeTruthy();
    expect(screen.getByLabelText("sparkline")).toBeTruthy();
  });

  it("exposes one accessible label describing the whole card", async () => {
    await render(<PatientCard view={view()} onPress={() => {}} />);
    expect(screen.getByLabelText("patient-card-bed-3")).toBeTruthy();
  });

  it("says a calm bed is calm", async () => {
    const calm = view({
      board: {
        patient_id: "bed-5", risk: "none", alerts: [],
        latest: { heart_rate: null, map: 80, spo2: null, temperature: null, resp_rate: null, lactate: 1.1, sofa: 0 },
      },
      top: null, tone: "muted", unacknowledged: false,
    });
    await render(<PatientCard view={calm} onPress={() => {}} />);
    expect(screen.getByText("Sakin")).toBeTruthy();
  });
});

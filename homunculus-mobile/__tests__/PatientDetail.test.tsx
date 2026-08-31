/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { PatientDetail } from "../src/ui/PatientDetail";
import type { PatientView } from "../src/store/boardStore";
import type { BoardAlert, PatientBoard } from "../src/transport/types";

function alert(): BoardAlert {
  return {
    patient_id: "bed-3", kind: "septic_shock", severity: "critical", urgency: "immediate",
    summary: "Septic shock criteria met", clinical_reasoning: "Vasopressor plus lactate.",
    supporting_evidence: ["sepsis-3-jama-2016"],
    recommended_actions: ["Review vasopressor titration against a MAP target of 65 mmHg."],
    confidence: "Criteria are deterministic (Sepsis-3).", source: "rule", downgraded: false,
    chronic_context: "", stale_inputs: [], acknowledged: false, acknowledged_by: null,
    acknowledged_at: null, first_seen_at: null, escalated: false,
  };
}

function view(): PatientView {
  const board: PatientBoard = {
    patient_id: "bed-3", risk: "critical", alerts: [alert()],
    latest: { heart_rate: null, map: 62, spo2: null, temperature: null, resp_rate: null, lactate: 3.4, sofa: 6 },
  };
  return {
    board, top: alert(), tone: "critical", escalated: false, unacknowledged: true,
    escalatedKeys: new Set(), acknowledgedKeys: new Set(),
    series: { heart_rate: [], map: [72, 66, 62], spo2: [], temperature: [], resp_rate: [], lactate: [1.8, 2.6, 3.4], sofa: [0, 4, 6] },
  };
}

describe("PatientDetail", () => {
  it("titles the screen with the bed and nothing else identifying", async () => {
    await render(<PatientDetail view={view()} onAcknowledge={() => {}} />);
    expect(screen.getByText("YB Yatak 3")).toBeTruthy();
  });

  it("renders the six-cell vitals slots", async () => {
    await render(<PatientDetail view={view()} onAcknowledge={() => {}} />);
    // OAB/LAKTAT/SOFA also label a trend-panel row below the slots, so they can appear twice —
    // NABIZ, SpO2 and Ateş are unique to the slot grid.
    for (const label of ["NABIZ", "OAB", "LAKTAT", "SpO2", "Ateş", "SOFA"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("says heart rate has no data: no waveform, an em dash in its cell", async () => {
    await render(<PatientDetail view={view()} onAcknowledge={() => {}} />);
    expect(screen.queryByLabelText("waveform")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows a waveform when heart rate is present", async () => {
    const withHr = { ...view(), board: { ...view().board, latest: { ...view().board.latest, heart_rate: 88 } } };
    await render(<PatientDetail view={withHr} onAcknowledge={() => {}} />);
    expect(screen.getByLabelText("waveform")).toBeTruthy();
  });

  it("shows no data for a trend series still too short to draw", async () => {
    const noTrend = {
      ...view(),
      series: { heart_rate: [], map: [], spo2: [], temperature: [], resp_rate: [], lactate: [], sofa: [] },
    };
    await render(<PatientDetail view={noTrend} onAcknowledge={() => {}} />);
    expect(screen.getAllByText("veri yok").length).toBe(3);
  });

  it("labels the trend as scenario time, not as a twelve-hour window", async () => {
    await render(<PatientDetail view={view()} onAcknowledge={() => {}} />);
    expect(screen.getByText("Senaryo zamanı eğilimi")).toBeTruthy();
  });

  it("renders the active alerts", async () => {
    await render(<PatientDetail view={view()} onAcknowledge={() => {}} />);
    expect(screen.getByLabelText("alert-septic_shock")).toBeTruthy();
  });

  it("says so when a bed has no active alert", async () => {
    const calm = {
      ...view(),
      board: {
        patient_id: "bed-5", risk: "none" as const, alerts: [],
        latest: { heart_rate: null, map: 80, spo2: null, temperature: null, resp_rate: null, lactate: 1.1, sofa: 0 },
      },
      top: null,
    };
    await render(<PatientDetail view={calm} onAcknowledge={() => {}} />);
    expect(screen.getByText("Aktif uyarı yok.")).toBeTruthy();
  });

  it("marks the alert escalated when the patient's escalated set names it", async () => {
    const escalated = { ...view(), escalatedKeys: new Set(["bed-3|septic_shock"]) };
    await render(<PatientDetail view={escalated} onAcknowledge={() => {}} />);
    expect(screen.getByText("ESKALE EDİLDİ")).toBeTruthy();
  });

  it("shows acknowledged state and hides the acknowledge button when the ack set names the alert", async () => {
    const acked = { ...view(), acknowledgedKeys: new Set(["bed-3|septic_shock"]) };
    await render(<PatientDetail view={acked} onAcknowledge={() => {}} />);
    expect(screen.getByText("Onaylandı")).toBeTruthy();
    expect(screen.queryByText("Onayla")).toBeNull();
  });
});

describe("citation wiring", () => {
  it("hands the drawer the tapped alert's own confidence, not another's", async () => {
    const { act, fireEvent, within } = require("@testing-library/react-native");
    const second: BoardAlert = {
      ...alert(), kind: "sepsis", summary: "Sepsis criteria met",
      supporting_evidence: ["surviving-sepsis-campaign-2026"],
      confidence: "Strong recommendation, very low certainty (SSC 2026).",
    };
    const two = view();
    two.board.alerts = [alert(), second];
    await render(<PatientDetail view={two} onAcknowledge={() => {}} />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText("citation-surviving-sepsis-campaign-2026"));
    });
    // Both confidences are on screen inside their cards — the assertion must scope to the drawer.
    const drawer = within(screen.getByLabelText("guideline-drawer"));
    expect(drawer.getByText("Strong recommendation, very low certainty (SSC 2026).")).toBeTruthy();
    expect(drawer.queryByText("Criteria are deterministic (Sepsis-3).")).toBeNull();
  });
});

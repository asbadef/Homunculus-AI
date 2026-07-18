import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PatientDetail } from "./PatientDetail.jsx";

const patient = {
  patient_id: "bed-3",
  risk: "critical",
  latest: { heart_rate: 118, map: 58, lactate: 3.1, sofa: 8 },
  alerts: [
    {
      kind: "septic_shock",
      severity: "critical",
      urgency: "immediate",
      summary: "Septik şok kriterleri karşılanıyor",
      clinical_reasoning: "Vazopresör + laktat 3.1 sonrası 30 mL/kg sıvı.",
      supporting_evidence: ["sepsis-3-jama-2016", "surviving-sepsis-campaign-2026"],
      recommended_actions: ["Consider repeat lactate to confirm the trend."],
      confidence: "strong recommendation, very low certainty (SSC 2026)",
    },
  ],
};

describe("PatientDetail", () => {
  it("shows the alert summary, reasoning, citations, actions and confidence", () => {
    render(<PatientDetail patient={patient} />);
    expect(screen.getByText(/Septik şok kriterleri/)).toBeInTheDocument();
    expect(screen.getByText(/Vazopresör \+ laktat/)).toBeInTheDocument();
    expect(screen.getByText("sepsis-3-jama-2016, surviving-sepsis-campaign-2026")).toBeInTheDocument();
    expect(screen.getByText(/Consider repeat lactate/)).toBeInTheDocument();
    expect(screen.getByText(/very low certainty/)).toBeInTheDocument();
  });

  it("shows the latest-values strip with SOFA", () => {
    render(<PatientDetail patient={patient} />);
    expect(screen.getByText("SOFA").parentElement).toHaveTextContent("SOFA 8");
  });

  it("renders recommended actions as recommendations, never orders", () => {
    render(<PatientDetail patient={patient} />);
    const action = screen.getByText(/Consider repeat lactate/).textContent.toLowerCase();
    expect(action).not.toMatch(/^(give |administer |start |order |prescribe )/);
  });

  it("shows a calm message when there are no active alerts", () => {
    render(<PatientDetail patient={{ ...patient, alerts: [] }} />);
    expect(screen.getByText(/aktif uyar/i)).toBeInTheDocument();
  });
});

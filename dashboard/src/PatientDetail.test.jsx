import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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


describe("PatientDetail acknowledge/escalation", () => {
  const escalated = {
    patient_id: "bed-3", risk: "critical", latest: { sofa: 8 },
    alerts: [{
      kind: "septic_shock", severity: "critical", urgency: "immediate",
      summary: "Septik şok", clinical_reasoning: "r", supporting_evidence: ["sepsis-3-jama-2016"],
      recommended_actions: ["Consider repeat lactate."], confidence: "c",
      acknowledged: false, acknowledged_by: null, acknowledged_at: null,
      first_seen_at: "2026-07-19T10:00:00+00:00", escalated: true,
    }],
  };

  it("shows the escalation banner and an Onayla button, and calls onAck", () => {
    const onAck = vi.fn();
    render(<PatientDetail patient={escalated} onAck={onAck} />);
    expect(screen.getByText("ESKALE EDİLDİ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Onayla/ }));
    expect(onAck).toHaveBeenCalledWith("septic_shock");
  });

  it("shows acknowledged text and no Onayla button once acknowledged", () => {
    const acked = { ...escalated, alerts: [{
      ...escalated.alerts[0], escalated: false,
      acknowledged: true, acknowledged_by: "hemşire", acknowledged_at: "2026-07-19T10:06:00+00:00",
    }] };
    render(<PatientDetail patient={acked} onAck={() => {}} />);
    expect(screen.getByText(/Onaylandı: hemşire/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Onayla/ })).toBeNull();
  });
});

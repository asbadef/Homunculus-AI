import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Board } from "./Board.jsx";

const p3 = { patient_id: "bed-3", risk: "none", alerts: [], latest: { sofa: 0 } };

describe("Board", () => {
  it("loads the snapshot and lists patients", async () => {
    const fetchBoard = vi.fn().mockResolvedValue([p3]);
    const openStream = vi.fn().mockReturnValue(() => {});
    render(<Board token="t" fetchBoard={fetchBoard} openStream={openStream} />);
    await waitFor(() => expect(screen.getByText("bed-3")).toBeInTheDocument());
  });

  it("merges a stream update into the board", async () => {
    const fetchBoard = vi.fn().mockResolvedValue([p3]);
    let push;
    const openStream = vi.fn().mockImplementation((_t, onUpdate) => { push = onUpdate; return () => {}; });
    render(<Board token="t" fetchBoard={fetchBoard} openStream={openStream} />);
    await waitFor(() => expect(screen.getByText("bed-3")).toBeInTheDocument());
    act(() => push({ patient_id: "bed-3", risk: "critical", alerts: [], latest: { sofa: 8 } }));
    await waitFor(() => expect(screen.getByText("Kritik")).toBeInTheDocument());
  });

  it("shows the selected patient's detail", async () => {
    const withAlert = {
      patient_id: "bed-7", risk: "high", latest: { sofa: 3 },
      alerts: [{
        kind: "sepsis", severity: "high", urgency: "soon",
        summary: "Sepsis kriterleri karşılanıyor", clinical_reasoning: "SOFA 3.",
        supporting_evidence: ["sepsis-3-jama-2016"], recommended_actions: ["Monitor lactate."],
        confidence: "consensus definition",
      }],
    };
    const fetchBoard = vi.fn().mockResolvedValue([withAlert]);
    const openStream = vi.fn().mockReturnValue(() => {});
    render(<Board token="t" fetchBoard={fetchBoard} openStream={openStream} />);
    await waitFor(() => expect(screen.getByText("bed-7")).toBeInTheDocument());
    fireEvent.click(screen.getByText("bed-7"));
    expect(screen.getByText(/Sepsis kriterleri/)).toBeInTheDocument();
    expect(screen.getByText("sepsis-3-jama-2016")).toBeInTheDocument();
  });
});

it("lists escalated alerts in the Eskale section", async () => {
  const escalatedPatient = {
    patient_id: "bed-3", risk: "critical", latest: { sofa: 8 },
    alerts: [{ kind: "septic_shock", severity: "critical", urgency: "immediate", summary: "Septik şok",
      clinical_reasoning: "r", supporting_evidence: ["sepsis-3-jama-2016"], recommended_actions: ["x"],
      confidence: "c", acknowledged: false, escalated: true, first_seen_at: "2026-07-19T10:00:00+00:00" }],
  };
  const fetchBoard = vi.fn().mockResolvedValue([escalatedPatient]);
  const openStream = vi.fn().mockReturnValue(() => {});
  render(<Board token="t" fetchBoard={fetchBoard} openStream={openStream} />);
  await waitFor(() => expect(screen.getByText(/Eskale/)).toBeInTheDocument());
  expect(screen.getAllByText("bed-3").length).toBeGreaterThan(0);
});

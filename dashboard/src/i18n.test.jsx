import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PatientDetail } from "./PatientDetail.jsx";
import { PatientList } from "./PatientList.jsx";
import { Board } from "./Board.jsx";
import { strings } from "./i18n.js";

describe("i18n", () => {
  it("defaults to Turkish", () => {
    expect(strings("tr").ack).toBe("Onayla");
    expect(strings().ack).toBe("Onayla");          // unknown lang falls back to tr
  });

  it("provides an Azerbaijani dictionary", () => {
    expect(strings("az").ack).toBe("Təsdiqlə");
    expect(strings("az").risk.high).toBe("Yüksək");
  });

  it("renders PatientDetail in Azerbaijani when lang=az", () => {
    const patient = {
      patient_id: "bed-3", risk: "high", latest: { sofa: 3 },
      alerts: [{
        kind: "sepsis", severity: "high", urgency: "soon", summary: "Sepsis",
        clinical_reasoning: "r", supporting_evidence: ["s"], recommended_actions: ["Monitor."],
        confidence: "c",
      }],
    };
    render(<PatientDetail patient={patient} lang="az" />);
    expect(screen.getByText("Təsdiqlə")).toBeInTheDocument();     // Onayla → Təsdiqlə
    expect(screen.getByText("Əsas:")).toBeInTheDocument();        // Gerekçe: → Əsas:
  });

  it("renders PatientList risk labels in Azerbaijani", () => {
    render(<PatientList patients={[{ patient_id: "bed-3", risk: "high", latest: {}, alerts: [] }]} lang="az" />);
    expect(screen.getByText("Yüksək")).toBeInTheDocument();
  });

  it("switching the language selector re-renders the board strings", async () => {
    const fetchBoard = vi.fn().mockResolvedValue([]);
    const openStream = vi.fn().mockReturnValue(() => {});
    render(<Board token="t" fetchBoard={fetchBoard} openStream={openStream} />);
    await waitFor(() => expect(screen.getByText("Bir hasta seçin.")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Dil:"), { target: { value: "az" } });
    expect(screen.getByText("Bir xəstə seçin.")).toBeInTheDocument();
  });
});

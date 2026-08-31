/// <reference types="jest" />
import { fireEvent, render, screen } from "@testing-library/react-native";

import { AlertCard } from "../src/ui/AlertCard";
import type { BoardAlert } from "../src/transport/types";

function alert(overrides: Partial<BoardAlert> = {}): BoardAlert {
  return {
    patient_id: "bed-7", kind: "under_resuscitated_sepsis", severity: "high", urgency: "immediate",
    summary: "Hypoperfusion before adequate fluid",
    clinical_reasoning: "Lactate 3.5 mmol/L with MAP 61.0 mmHg.",
    supporting_evidence: ["sepsis-3-jama-2016"],
    recommended_actions: ["Assess fluid responsiveness before escalating vasopressors."],
    confidence: "Fluid target: conditional recommendation, low certainty (SSC 2026).",
    source: "rule", downgraded: false, chronic_context: "", stale_inputs: [],
    acknowledged: false, acknowledged_by: null, acknowledged_at: null,
    first_seen_at: null, escalated: false,
    ...overrides,
  };
}

describe("AlertCard", () => {
  it("shows the finding's own severity pill, and escalation overrides it to critical", async () => {
    await render(<AlertCard alert={alert()} escalated={false} onAcknowledge={() => {}} onCite={() => {}} />);
    expect(screen.getByText("SIVI YETERSİZ")).toBeTruthy();
  });

  it("shows the summary, the reasoning and the confidence wording verbatim", async () => {
    await render(<AlertCard alert={alert()} escalated={false} onAcknowledge={() => {}} onCite={() => {}} />);
    expect(screen.getByText("Hypoperfusion before adequate fluid")).toBeTruthy();
    expect(screen.getByText("Lactate 3.5 mmol/L with MAP 61.0 mmHg.")).toBeTruthy();
    expect(
      screen.getByText("Fluid target: conditional recommendation, low certainty (SSC 2026)."),
    ).toBeTruthy();
  });

  it("lists the recommended actions as the engine phrased them", async () => {
    await render(<AlertCard alert={alert()} escalated={false} onAcknowledge={() => {}} onCite={() => {}} />);
    expect(
      screen.getByText("• Assess fluid responsiveness before escalating vasopressors."),
    ).toBeTruthy();
  });

  it("acknowledges on press", async () => {
    const onAcknowledge = jest.fn();
    await render(<AlertCard alert={alert()} escalated={false} onAcknowledge={onAcknowledge} onCite={() => {}} />);
    fireEvent.press(screen.getByText("Onayla"));
    expect(onAcknowledge).toHaveBeenCalled();
  });

  it("opens the drawer for the citation that was tapped", async () => {
    const onCite = jest.fn();
    await render(<AlertCard alert={alert()} escalated={false} onAcknowledge={() => {}} onCite={onCite} />);
    // M6: the per-citation chip no longer shows the source's own title — it's a "Kılavuz" ghost
    // pill, identified by its citation-scoped accessibility label (kept from the pre-kit anatomy).
    fireEvent.press(screen.getByLabelText("citation-sepsis-3-jama-2016"));
    expect(onCite).toHaveBeenCalledWith("sepsis-3-jama-2016");
  });

  it("renders one ghost pill per citation, so a two-source alert keeps both reachable", async () => {
    const onCite = jest.fn();
    await render(
      <AlertCard
        alert={alert({ supporting_evidence: ["sepsis-3-jama-2016", "surviving-sepsis-campaign-2026"] })}
        escalated={false}
        onAcknowledge={() => {}}
        onCite={onCite}
      />,
    );
    expect(screen.getAllByText("Kılavuz").length).toBe(2);
    fireEvent.press(screen.getByLabelText("citation-surviving-sepsis-campaign-2026"));
    expect(onCite).toHaveBeenCalledWith("surviving-sepsis-campaign-2026");
  });

  it("shows the acknowledged state instead of the button once acknowledged", async () => {
    await render(
      <AlertCard alert={alert({ acknowledged: true })} escalated={false} onAcknowledge={() => {}} onCite={() => {}} />,
    );
    expect(screen.getByText("Onaylandı")).toBeTruthy();
    expect(screen.queryByText("Onayla")).toBeNull();
  });

  it("surfaces the chronic context when the finding was downgraded", async () => {
    await render(
      <AlertCard
        alert={alert({ downgraded: true, chronic_context: "Kronik AF; HR 100-110 bu hasta için normal." })}
        escalated={false}
        onAcknowledge={() => {}}
        onCite={() => {}}
      />,
    );
    expect(screen.getByText("Kronik AF; HR 100-110 bu hasta için normal.")).toBeTruthy();
    expect(screen.getByText("Hastanın kendi bazaline göre indirgendi")).toBeTruthy();
  });
});

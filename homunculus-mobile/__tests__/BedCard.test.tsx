/// <reference types="jest" />
import { fireEvent, render, screen } from "@testing-library/react-native";

import { BedCard } from "../src/ui/BedCard";
import type { PatientView } from "../src/store/boardStore";
import type { BoardAlert, PatientBoard } from "../src/transport/types";

function alert(overrides: Partial<BoardAlert> = {}): BoardAlert {
  return {
    patient_id: "bed-3", kind: "septic_shock", severity: "critical", urgency: "immediate",
    summary: "Septic shock criteria met", clinical_reasoning: "", supporting_evidence: [],
    recommended_actions: [], confidence: "", source: "rule", downgraded: false,
    chronic_context: "", stale_inputs: [], acknowledged: false, acknowledged_by: null,
    acknowledged_at: null, first_seen_at: null, escalated: false,
    ...overrides,
  };
}

function view(overrides: Partial<PatientView> = {}): PatientView {
  const board: PatientBoard = {
    patient_id: "bed-3", risk: "critical", alerts: [alert()],
    latest: { heart_rate: null, map: 62, spo2: null, temperature: null, resp_rate: null, lactate: null, sofa: 6 },
  };
  return {
    board, top: alert(), tone: "critical", escalated: false, unacknowledged: true,
    escalatedKeys: new Set(), acknowledgedKeys: new Set(),
    series: { heart_rate: [], map: [70, 66, 62], spo2: [], temperature: [], resp_rate: [], lactate: [], sofa: [] },
    ...overrides,
  };
}

const noop = () => {};

describe("BedCard — behaviour carried over from MonitorTile (M5)", () => {
  it("identifies the patient only by bed", async () => {
    await render(<BedCard view={view()} onPress={noop} onAck={noop} />);
    expect(screen.getByText("YATAK 3")).toBeTruthy();
  });

  it("exposes one accessible label describing the whole card", async () => {
    await render(<BedCard view={view()} onPress={noop} onAck={noop} />);
    expect(screen.getByLabelText("patient-card-bed-3")).toBeTruthy();
  });

  it("reports the tapped bed via onPress", async () => {
    const onPress = jest.fn();
    await render(<BedCard view={view()} onPress={onPress} onAck={noop} />);
    fireEvent.press(screen.getByLabelText("patient-card-bed-3"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("also reaches the detail through the chevron circle", async () => {
    const onPress = jest.fn();
    await render(<BedCard view={view()} onPress={onPress} onAck={noop} />);
    fireEvent.press(screen.getByLabelText("patient-card-bed-3-chevron"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("marks an escalated bed with the ESKALE pill", async () => {
    await render(<BedCard view={view({ escalated: true })} onPress={noop} onAck={noop} />);
    expect(screen.getByText("ESKALE")).toBeTruthy();
  });

  it("shows no ESKALE pill on a non-escalated bed", async () => {
    await render(<BedCard view={view({ escalated: false })} onPress={noop} onAck={noop} />);
    expect(screen.queryByText("ESKALE")).toBeNull();
  });

  it("says a calm bed is STABİL", async () => {
    const calm = view({
      board: {
        patient_id: "bed-5", risk: "none", alerts: [],
        latest: { heart_rate: null, map: 80, spo2: null, temperature: null, resp_rate: null, lactate: 1.1, sofa: 0 },
      },
      top: null, tone: "muted", unacknowledged: false,
    });
    await render(<BedCard view={calm} onPress={noop} onAck={noop} />);
    expect(screen.getByText("STABİL")).toBeTruthy();
  });

  it("hides the waveform strip when there is no heart rate", async () => {
    await render(<BedCard view={view()} onPress={noop} onAck={noop} />);
    expect(screen.queryByLabelText("waveform")).toBeNull();
  });

  it("shows the waveform strip when a heart rate is present", async () => {
    const withHr = view({
      board: {
        patient_id: "bed-3", risk: "critical", alerts: [alert()],
        latest: { heart_rate: 82, map: 62, spo2: null, temperature: null, resp_rate: null, lactate: 3.4, sofa: 6 },
      },
    });
    await render(<BedCard view={withHr} onPress={noop} onAck={noop} />);
    expect(screen.getByLabelText("waveform")).toBeTruthy();
  });
});

describe("BedCard — stat pills (M6)", () => {
  it("shows the OAB / LAK / SOFA pill labels", async () => {
    await render(<BedCard view={view()} onPress={noop} onAck={noop} />);
    expect(screen.getByText("OAB")).toBeTruthy();
    expect(screen.getByText("LAK")).toBeTruthy();
    expect(screen.getByText("SOFA")).toBeTruthy();
  });

  it("renders a present value and a missing one as —", async () => {
    await render(<BedCard view={view()} onPress={noop} onAck={noop} />);
    // MAP and SOFA are populated (62, 6); lactate is null.
    expect(screen.getByText("62")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("BedCard — acknowledge circle (M6)", () => {
  it("acknowledges the top alert with its kind", async () => {
    const onAck = jest.fn();
    await render(<BedCard view={view()} onPress={noop} onAck={onAck} />);
    fireEvent.press(screen.getByLabelText("ack-bed-3"));
    expect(onAck).toHaveBeenCalledWith("bed-3", "septic_shock");
  });

  it("acknowledging does not also open the detail", async () => {
    const onPress = jest.fn();
    await render(<BedCard view={view()} onPress={onPress} onAck={noop} />);
    fireEvent.press(screen.getByLabelText("ack-bed-3"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("offers no acknowledge circle on a calm bed", async () => {
    const calm = view({
      board: {
        patient_id: "bed-5", risk: "none", alerts: [],
        latest: { heart_rate: null, map: 80, spo2: null, temperature: null, resp_rate: null, lactate: 1.1, sofa: 0 },
      },
      top: null, tone: "muted", unacknowledged: false,
    });
    await render(<BedCard view={calm} onPress={noop} onAck={noop} />);
    expect(screen.queryByLabelText(/^ack-/)).toBeNull();
  });

  it("marks an already-acknowledged top alert as settled", async () => {
    const acked = view({ acknowledgedKeys: new Set(["bed-3|septic_shock"]) });
    await render(<BedCard view={acked} onPress={noop} onAck={noop} />);
    expect(screen.getByLabelText("ack-bed-3").props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });
});

describe("BedCard — condition flag (carried from M5)", () => {
  it("names the top alert's kind", async () => {
    await render(
      <BedCard view={view({ top: alert({ kind: "septic_shock" }) })} onPress={noop} onAck={noop} />,
    );
    expect(screen.getByText("SEPTİK ŞOK")).toBeTruthy();
  });

  it("names every catalogued kind", async () => {
    const cases: Array<[string, string]> = [
      ["under_resuscitated_sepsis", "SIVI YETERSİZ"],
      ["sepsis", "SEPSİS"],
      ["antibiotic_due", "ANTİBİYOTİK PENCERESİ"],
      ["antibiotic_overdue", "ANTİBİYOTİK GECİKTİ"],
      ["news2", "NEWS2"],
      ["acute_change", "AKUT DEĞİŞİM"],
      ["sepsis_watch", "SEPSİS İZLEM"],
    ];
    for (const [kind, label] of cases) {
      const { unmount } = await render(
        <BedCard view={view({ top: alert({ kind }) })} onPress={noop} onAck={noop} />,
      );
      expect(screen.getByText(label)).toBeTruthy();
      await unmount();
    }
  });

  it("falls back to the severity's risk label when the kind has no catalogue entry", async () => {
    await render(
      <BedCard
        view={view({ top: alert({ kind: "some_future_finding", severity: "moderate" }) })}
        onPress={noop}
        onAck={noop}
      />,
    );
    expect(screen.getByText("Orta")).toBeTruthy();
  });
});

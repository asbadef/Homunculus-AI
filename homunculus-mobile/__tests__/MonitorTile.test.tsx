/// <reference types="jest" />
import { fireEvent, render, screen } from "@testing-library/react-native";

import { MonitorTile } from "../src/ui/MonitorTile";
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
    latest: { heart_rate: null, map: 62, spo2: null, temperature: null, resp_rate: null, lactate: 3.4, sofa: 6 },
  };
  return {
    board, top: alert(), tone: "critical", escalated: false, unacknowledged: true,
    escalatedKeys: new Set(), acknowledgedKeys: new Set(),
    series: { heart_rate: [], map: [70, 66, 62], spo2: [], temperature: [], resp_rate: [], lactate: [], sofa: [] },
    ...overrides,
  };
}

describe("MonitorTile — behaviour carried over from PatientCard (M4)", () => {
  it("identifies the patient only by bed", async () => {
    await render(<MonitorTile view={view()} onPress={() => {}} />);
    expect(screen.getByText("YATAK 3")).toBeTruthy();
  });

  it("exposes one accessible label describing the whole tile", async () => {
    await render(<MonitorTile view={view()} onPress={() => {}} />);
    expect(screen.getByLabelText("patient-card-bed-3")).toBeTruthy();
  });

  it("reports the tapped bed via onPress", async () => {
    const onPress = jest.fn();
    await render(<MonitorTile view={view()} onPress={onPress} />);
    fireEvent.press(screen.getByLabelText("patient-card-bed-3"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("marks an escalated bed on the SOFA line, not a card glow", async () => {
    await render(<MonitorTile view={view({ escalated: true })} onPress={() => {}} />);
    expect(screen.getByText(/eskalasyon: açık/)).toBeTruthy();
  });

  it("says a calm bed is STABİL", async () => {
    const calm = view({
      board: {
        patient_id: "bed-5", risk: "none", alerts: [],
        latest: { heart_rate: null, map: 80, spo2: null, temperature: null, resp_rate: null, lactate: 1.1, sofa: 0 },
      },
      top: null, tone: "muted", unacknowledged: false,
    });
    await render(<MonitorTile view={calm} onPress={() => {}} />);
    expect(screen.getByText("STABİL")).toBeTruthy();
  });

  it("hides the waveform strip when there is no heart rate", async () => {
    await render(<MonitorTile view={view()} onPress={() => {}} />);
    expect(screen.queryByLabelText("waveform")).toBeNull();
  });

  it("shows the waveform strip when a heart rate is present", async () => {
    const withHr = view({
      board: {
        patient_id: "bed-3", risk: "critical", alerts: [alert()],
        latest: { heart_rate: 82, map: 62, spo2: null, temperature: null, resp_rate: null, lactate: 3.4, sofa: 6 },
      },
    });
    await render(<MonitorTile view={withHr} onPress={() => {}} />);
    expect(screen.getByLabelText("waveform")).toBeTruthy();
  });
});

describe("MonitorTile — channels (M5)", () => {
  it("shows the three channel labels in NABIZ / OAB / LAKTAT order", async () => {
    await render(<MonitorTile view={view()} onPress={() => {}} />);
    expect(screen.getByText("NABIZ")).toBeTruthy();
    expect(screen.getByText("OAB")).toBeTruthy();
    expect(screen.getByText("LAKTAT")).toBeTruthy();
  });

  it("renders a present channel's value and a missing one as —", async () => {
    await render(<MonitorTile view={view()} onPress={() => {}} />);
    // MAP and lactate are populated (62, 3.4); heart_rate is null.
    expect(screen.getByText("62")).toBeTruthy();
    expect(screen.getByText("3.4")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("shows the SOFA total", async () => {
    await render(<MonitorTile view={view()} onPress={() => {}} />);
    expect(screen.getByText(/SOFA/)).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
  });

  it("marks an unacknowledged, non-escalated bed on the SOFA line", async () => {
    await render(
      <MonitorTile view={view({ escalated: false, unacknowledged: true })} onPress={() => {}} />,
    );
    expect(screen.getByText(/onaysız/)).toBeTruthy();
  });

  it("shows neither escalation nor unacknowledged marker for a settled bed", async () => {
    await render(
      <MonitorTile view={view({ escalated: false, unacknowledged: false })} onPress={() => {}} />,
    );
    expect(screen.queryByText(/eskalasyon/)).toBeNull();
    expect(screen.queryByText(/onaysız/)).toBeNull();
  });
});

describe("MonitorTile — condition flag (M5)", () => {
  it("names the top alert's kind", async () => {
    await render(<MonitorTile view={view({ top: alert({ kind: "septic_shock" }) })} onPress={() => {}} />);
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
        <MonitorTile view={view({ top: alert({ kind }) })} onPress={() => {}} />,
      );
      expect(screen.getByText(label)).toBeTruthy();
      await unmount();
    }
  });

  it("falls back to the severity's risk label when the kind has no catalogue entry", async () => {
    await render(
      <MonitorTile
        view={view({ top: alert({ kind: "some_future_finding", severity: "moderate" }) })}
        onPress={() => {}}
      />,
    );
    expect(screen.getByText("Orta")).toBeTruthy();
  });
});

describe("MonitorTile — channel identity", () => {
  it("paints each vital in its own channel colour, never a neighbour's", async () => {
    const { palettes } = { palettes: require("../src/theme/palette") };
    const v = view({});
    v.board.latest = { ...v.board.latest, heart_rate: 101, map: 62, lactate: 3.4 };
    await render(<MonitorTile view={v} onPress={() => {}} />);
    const icu = palettes.icu.channel;
    const coloursOf = (text: string) =>
      screen.getAllByText(text).map((node) => {
        const style = Array.isArray(node.props.style)
          ? Object.assign({}, ...node.props.style)
          : node.props.style;
        return style?.color;
      });
    // "101" renders twice — the HR channel numeral AND the waveform's bpm readout — so the HR
    // assertion checks membership; MAP and lactate are unique on the tile.
    expect(coloursOf("101")).toContain(icu.hr);
    expect(coloursOf("62")).toEqual([icu.map]);
    expect(coloursOf("3.4")).toEqual([icu.lactate]);
  });
});

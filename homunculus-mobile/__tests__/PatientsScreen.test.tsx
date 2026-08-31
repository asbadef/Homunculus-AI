/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { useBoard } from "../src/store/BoardProvider";
import PatientsScreen from "../app/(tabs)/index";
import type { PatientView } from "../src/store/boardStore";
import type { PatientBoard } from "../src/transport/types";

jest.mock("../src/store/BoardProvider", () => ({
  useBoard: jest.fn(),
}));

// The real expo-router pulls in "standard-navigation", which ships untranspiled ESM that the
// project's transformIgnorePatterns doesn't cover. This screen only calls useRouter() for a
// push() the gating tests never trigger, so a bare stub is enough.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const mockUseBoard = useBoard as jest.Mock;

describe("PatientsScreen — demo banner gating", () => {
  it("shows the demo banner while in replay mode", async () => {
    mockUseBoard.mockReturnValue({ ward: [], mode: "replay", connection: "demo" });
    await render(<PatientsScreen />);
    expect(screen.getByLabelText("demo-banner")).toBeTruthy();
  });

  it("hides the demo banner once live", async () => {
    mockUseBoard.mockReturnValue({ ward: [], mode: "live", connection: "open" });
    await render(<PatientsScreen />);
    expect(screen.queryByLabelText("demo-banner")).toBeNull();
  });
});

describe("PatientsScreen — empty and unreachable never look alike", () => {
  it("says it is reconnecting when the live connection is down and the ward is empty", async () => {
    mockUseBoard.mockReturnValue({ ward: [], mode: "live", connection: "reconnecting" });
    await render(<PatientsScreen />);
    expect(screen.getByText("Bağlantı koptu — yeniden bağlanıyor…")).toBeTruthy();
    expect(screen.queryByLabelText("skeleton")).toBeNull();
  });

  it("says an open live ward with no beds is empty, not loading", async () => {
    mockUseBoard.mockReturnValue({ ward: [], mode: "live", connection: "open" });
    await render(<PatientsScreen />);
    expect(screen.getByText("Koğuşta gösterilecek yatak yok.")).toBeTruthy();
    expect(screen.queryByLabelText("skeleton")).toBeNull();
  });

  it("still shows skeletons for the replay's first moments", async () => {
    mockUseBoard.mockReturnValue({ ward: [], mode: "replay", connection: "demo" });
    await render(<PatientsScreen />);
    expect(screen.getAllByLabelText("skeleton").length).toBeGreaterThan(0);
  });
});

// M6: the monitor header became the kit's chip row. The facts survive in chip form — the
// occupancy chip still carries the KAYIT/CANLI honesty label M5 introduced, and the counts
// chips carry the ward's critical/alert totals.
describe("PatientsScreen — kit header chips", () => {
  function view(id: string, risk: PatientBoard["risk"] = "none", alerts: PatientBoard["alerts"] = []): PatientView {
    const board: PatientBoard = {
      patient_id: id, risk, alerts,
      latest: { heart_rate: null, map: null, spo2: null, temperature: null, resp_rate: null, lactate: null, sofa: null },
    };
    return {
      board, top: alerts[0] ?? null, tone: "muted", escalated: false, unacknowledged: false,
      escalatedKeys: new Set(), acknowledgedKeys: new Set(),
      series: { heart_rate: [], map: [], spo2: [], temperature: [], resp_rate: [], lactate: [], sofa: [] },
    };
  }

  it("shows the title, the Tümü tab, and the occupancy chip honestly labelled KAYIT", async () => {
    mockUseBoard.mockReturnValue({
      ward: [view("bed-3"), view("bed-5"), view("bed-7")],
      mode: "replay",
      connection: "demo",
    });
    await render(<PatientsScreen />);
    expect(screen.getByText("Koğuş")).toBeTruthy();
    expect(screen.getByText("Tümü")).toBeTruthy();
    expect(screen.getByText("3/3 dolu · KAYIT")).toBeTruthy();
  });

  it("labels the occupancy chip CANLI once connected live", async () => {
    mockUseBoard.mockReturnValue({
      ward: [view("bed-3"), view("bed-5")],
      mode: "live",
      connection: "open",
    });
    await render(<PatientsScreen />);
    expect(screen.getByText("2/2 dolu · CANLI")).toBeTruthy();
  });

  it("counts critical beds and open alerts in the chips", async () => {
    const alert: PatientBoard["alerts"][number] = {
      patient_id: "bed-3", kind: "septic_shock", severity: "critical", urgency: "immediate",
      summary: "s", clinical_reasoning: "", supporting_evidence: [], recommended_actions: [],
      confidence: "", source: "rule", downgraded: false, chronic_context: "", stale_inputs: [],
      acknowledged: false, acknowledged_by: null, acknowledged_at: null, first_seen_at: null,
      escalated: false,
    };
    mockUseBoard.mockReturnValue({
      ward: [view("bed-3", "critical", [alert]), view("bed-5")],
      mode: "replay",
      connection: "demo",
    });
    await render(<PatientsScreen />);
    expect(screen.getByText("Kritik 1")).toBeTruthy();
    expect(screen.getByText("Uyarı 1")).toBeTruthy();
  });
});

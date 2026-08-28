/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { useBoard } from "../src/store/BoardProvider";
import PatientsScreen from "../app/(tabs)/index";

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

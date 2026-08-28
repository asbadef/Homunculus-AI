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
    mockUseBoard.mockReturnValue({ ward: [], mode: "replay" });
    await render(<PatientsScreen />);
    expect(screen.getByLabelText("demo-banner")).toBeTruthy();
  });

  it("hides the demo banner once live", async () => {
    mockUseBoard.mockReturnValue({ ward: [], mode: "live" });
    await render(<PatientsScreen />);
    expect(screen.queryByLabelText("demo-banner")).toBeNull();
  });
});

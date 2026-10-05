/// <reference types="jest" />
// The screen owns the error mapping the presentational ServerSection only renders. A mutation
// that routed MfaRequiredError into the generic failure line survived every earlier test — this
// file exists so it cannot again.
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { useBoard } from "../src/store/BoardProvider";
import { MfaRequiredError, PasswordChangeRequiredError } from "../src/transport/authClient";
import SettingsScreen from "../app/(tabs)/settings";

jest.mock("../src/store/BoardProvider", () => ({
  useBoard: jest.fn(),
}));

const mockUseBoard = useBoard as jest.Mock;

function boardValue(overrides: Record<string, unknown> = {}) {
  return {
    controls: { isPlaying: () => true, play: jest.fn(), pause: jest.fn(), restart: jest.fn() },
    settings: { role: "nurse", haptics: true, thresholdMs: 20_000, speed: 1 },
    setRole: jest.fn(),
    setHaptics: jest.fn(),
    setThresholdMs: jest.fn(),
    setSpeed: jest.fn(),
    mode: "replay",
    connection: "demo",
    sessionNotice: false,
    goLive: jest.fn(),
    goReplay: jest.fn(),
    serverUrl: "http://10.0.0.5",
    setServerUrl: jest.fn(),
    auth: {
      login: jest.fn(),
      logout: jest.fn(),
      hasSession: jest.fn(async () => false),
    },
    ...overrides,
  };
}

async function submitLogin() {
  await act(async () => {
    fireEvent(screen.getByLabelText("login-email"), "changeText", "dr@example.org");
  });
  await act(async () => {
    fireEvent(screen.getByLabelText("login-password"), "changeText", "s3cret");
  });
  await act(async () => {
    fireEvent.press(screen.getByText("Giriş yap"));
  });
}

describe("SettingsScreen — login error mapping", () => {
  it("maps MfaRequiredError to the honest TOTP line, not the generic failure", async () => {
    const value = boardValue();
    (value.auth.login as jest.Mock).mockRejectedValue(new MfaRequiredError("mfa"));
    mockUseBoard.mockReturnValue(value);
    await render(<SettingsScreen />);
    await submitLogin();
    expect(
      screen.getByText("Bu hesap doğrulama kodu istiyor; şimdilik panodan giriş yapın."),
    ).toBeTruthy();
    expect(screen.queryByText(/Giriş başarısız/)).toBeNull();
  });

  it("maps PasswordChangeRequiredError to the change-it-on-the-dashboard line", async () => {
    const value = boardValue();
    (value.auth.login as jest.Mock).mockRejectedValue(new PasswordChangeRequiredError("temp"));
    mockUseBoard.mockReturnValue(value);
    await render(<SettingsScreen />);
    await submitLogin();
    expect(
      screen.getByText(
        "Bu hesabın geçici parolası değiştirilmeli; önce panodan giriş yapıp kendi parolanızı belirleyin.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Giriş başarısız/)).toBeNull();
  });

  it("maps a plain failure to the generic line carrying the server detail", async () => {
    const value = boardValue();
    (value.auth.login as jest.Mock).mockRejectedValue(new Error("Invalid credentials"));
    mockUseBoard.mockReturnValue(value);
    await render(<SettingsScreen />);
    await submitLogin();
    expect(screen.getByText("Giriş başarısız: Invalid credentials")).toBeTruthy();
  });
});

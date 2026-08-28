/// <reference types="jest" />
import { fireEvent, render, screen } from "@testing-library/react-native";
import type React from "react";

import { t } from "../src/i18n";
import { ServerSection } from "../src/ui/ServerSection";

async function section(overrides: Partial<React.ComponentProps<typeof ServerSection>> = {}) {
  const props = {
    serverUrl: "http://10.0.0.5",
    mode: "replay" as const,
    connection: "demo" as const,
    sessionNotice: false,
    hasSession: false,
    onSaveUrl: jest.fn(),
    onLogin: jest.fn(async () => {}),
    onLogout: jest.fn(),
    onGoLive: jest.fn(),
    onGoReplay: jest.fn(),
    loginError: null,
    ...overrides,
  };
  await render(<ServerSection {...props} />);
  return props;
}

describe("ServerSection — address", () => {
  it("renders the stored address", async () => {
    await section({ serverUrl: "http://10.0.0.5" });
    expect(screen.getByLabelText("server-address").props.value).toBe("http://10.0.0.5");
  });

  it("reports the edited address on save", async () => {
    const props = await section({ serverUrl: "http://10.0.0.5" });
    await fireEvent(screen.getByLabelText("server-address"), "changeText", "http://10.0.0.7");
    fireEvent.press(screen.getByText(t("server.save")));
    expect(props.onSaveUrl).toHaveBeenCalledWith("http://10.0.0.7");
  });
});

describe("ServerSection — login", () => {
  it("submits the entered credentials", async () => {
    const props = await section({ hasSession: false });
    await fireEvent(screen.getByLabelText("login-email"), "changeText", "nurse@example.test");
    await fireEvent(screen.getByLabelText("login-password"), "changeText", "hunter2");
    fireEvent.press(screen.getByText(t("server.login.submit")));
    expect(props.onLogin).toHaveBeenCalledWith("nurse@example.test", "hunter2");
  });

  it("shows the honest MFA line when the screen reports it", async () => {
    await section({ loginError: t("login.mfaUnsupported") });
    expect(screen.getByText(t("login.mfaUnsupported"))).toBeTruthy();
  });

  it("hides the login form once a session exists", async () => {
    await section({ hasSession: true });
    expect(screen.queryByLabelText("login-email")).toBeNull();
  });
});

describe("ServerSection — session controls", () => {
  it("offers a logout chip once a session exists", async () => {
    const props = await section({ hasSession: true });
    fireEvent.press(screen.getByText(t("server.logout")));
    expect(props.onLogout).toHaveBeenCalled();
  });

  it("offers go-live only with a session in replay mode", async () => {
    await section({ hasSession: true, mode: "replay" });
    expect(screen.getByText(t("server.goLive"))).toBeTruthy();
  });

  it("hides go-live without a session", async () => {
    await section({ hasSession: false, mode: "replay" });
    expect(screen.queryByText(t("server.goLive"))).toBeNull();
  });

  it("hides go-live once already live", async () => {
    await section({ hasSession: true, mode: "live" });
    expect(screen.queryByText(t("server.goLive"))).toBeNull();
  });

  it("offers go-replay only in live mode", async () => {
    await section({ hasSession: true, mode: "live" });
    expect(screen.getByText(t("server.goReplay"))).toBeTruthy();
  });

  it("hides go-replay in replay mode", async () => {
    await section({ mode: "replay" });
    expect(screen.queryByText(t("server.goReplay"))).toBeNull();
  });
});

describe("ServerSection — status line", () => {
  it.each([
    ["demo", t("server.status.demo")],
    ["connecting", t("server.status.connecting")],
    ["open", t("server.status.open")],
    ["reconnecting", t("server.status.reconnecting")],
  ] as const)("shows the status line for %s", async (connection, expected) => {
    await section({ connection });
    expect(screen.getByText(expected)).toBeTruthy();
  });
});

describe("ServerSection — session notice", () => {
  it("renders the notice when a live session just expired", async () => {
    await section({ sessionNotice: true });
    expect(screen.getByText(t("server.sessionNotice"))).toBeTruthy();
  });

  it("renders nothing extra when there is no notice", async () => {
    await section({ sessionNotice: false });
    expect(screen.queryByText(t("server.sessionNotice"))).toBeNull();
  });
});

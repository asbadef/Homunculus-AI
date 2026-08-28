/// <reference types="jest" />
import { fireEvent, render, screen } from "@testing-library/react-native";
import type React from "react";

import { SettingsPanel } from "../src/ui/SettingsPanel";

async function panel(overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const props = {
    settings: { role: "nurse" as const, haptics: true, thresholdMs: 20_000, speed: 1 },
    playing: true,
    onPlay: jest.fn(),
    onPause: jest.fn(),
    onRestart: jest.fn(),
    onSpeed: jest.fn(),
    onRole: jest.fn(),
    onHaptics: jest.fn(),
    onThreshold: jest.fn(),
    version: "1.0.0",
    ...overrides,
  };
  await render(<SettingsPanel {...props} />);
  return props;
}

describe("SettingsPanel", () => {
  it("names the data source out loud", async () => {
    await panel();
    expect(screen.getByText("Kayıtlı senaryo — icu-ward.json")).toBeTruthy();
  });

  it("calls pause while playing", async () => {
    const props = await panel();
    fireEvent.press(screen.getByText("Duraklat"));
    expect(props.onPause).toHaveBeenCalled();
  });

  it("offers play when paused", async () => {
    const props = await panel({ playing: false });
    fireEvent.press(screen.getByText("Oynat"));
    expect(props.onPlay).toHaveBeenCalled();
  });

  it("restarts the scenario", async () => {
    const props = await panel();
    fireEvent.press(screen.getByText("Başa sar"));
    expect(props.onRestart).toHaveBeenCalled();
  });

  it("switches role", async () => {
    const props = await panel();
    fireEvent.press(screen.getByText("Hekim"));
    expect(props.onRole).toHaveBeenCalledWith("doctor");
  });

  it("changes the replay speed", async () => {
    const props = await panel();
    fireEvent.press(screen.getByText("2x"));
    expect(props.onSpeed).toHaveBeenCalledWith(2);
  });

  it("admits the escalation threshold is a demo acceleration", async () => {
    await panel();
    expect(
      screen.getByText(
        "Sunucudaki gerçek eşik 5 dakikadır. Buradaki kısa süre yalnızca gösterim hızlandırmasıdır.",
      ),
    ).toBeTruthy();
  });
});

describe("SettingsPanel — remaining controls", () => {
  it("reports a haptics toggle", async () => {
    const props = await panel();
    fireEvent(screen.getByRole("switch"), "valueChange", false);
    expect(props.onHaptics).toHaveBeenCalledWith(false);
  });

  it("reports a threshold choice in milliseconds", async () => {
    const props = await panel();
    fireEvent.press(screen.getByText("60s"));
    expect(props.onThreshold).toHaveBeenCalledWith(60_000);
  });
});

/// <reference types="jest" />
import { render } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { Text } from "react-native";

import { useAlertHaptics } from "../src/ui/useAlertHaptics";
import type { BoardNotification } from "../src/transport/types";

function note(overrides: Partial<BoardNotification> = {}): BoardNotification {
  return {
    tenant: "DEMO", patient_id: "bed-3", kind: "septic_shock", severity: "critical",
    urgency: "immediate", audience: "nurse", trigger: "new", title: "Yeni uyarı",
    body: "bed-3: shock", ts: "2026-07-26T17:23:25.878950+00:00",
    ...overrides,
  };
}

function Probe({ latest, enabled }: { latest: BoardNotification | null; enabled: boolean }) {
  useAlertHaptics(latest, enabled);
  return <Text>probe</Text>;
}

beforeEach(() => jest.clearAllMocks());

describe("useAlertHaptics", () => {
  it("fires a warning pattern for a new immediate alert", async () => {
    await render(<Probe latest={note()} enabled />);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Warning);
  });

  it("fires the heavier error pattern for an escalation", async () => {
    await render(<Probe latest={note({ trigger: "escalation" })} enabled />);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Error);
  });

  it("stays silent when the clinician turned haptics off", async () => {
    await render(<Probe latest={note()} enabled={false} />);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it("stays silent when there is nothing new", async () => {
    await render(<Probe latest={null} enabled />);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it("does not buzz twice for the same notification", async () => {
    const first = note();
    const { rerender } = await render(<Probe latest={first} enabled />);
    await rerender(<Probe latest={first} enabled />);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });
});

describe("useAlertHaptics — hardened cases", () => {
  it("stays silent for a routine or soon alert", async () => {
    await render(<Probe latest={note({ urgency: "soon" })} enabled />);
    await render(<Probe latest={note({ urgency: "routine", ts: "2026-07-26T17:24:00+00:00" })} enabled />);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it("dedupes on ts even when the notification object is rebuilt", async () => {
    const { rerender } = await render(<Probe latest={note()} enabled />);
    await rerender(<Probe latest={note()} enabled />); // fresh object, same ts
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });

  it("does not buzz on unmute for a notification that arrived while muted", async () => {
    const muted = note();
    const { rerender } = await render(<Probe latest={muted} enabled={false} />);
    await rerender(<Probe latest={muted} enabled />); // clinician unmutes later
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});

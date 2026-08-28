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

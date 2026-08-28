/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { NotificationFeed } from "../src/ui/NotificationFeed";
import type { BoardNotification } from "../src/transport/types";

function note(overrides: Partial<BoardNotification> = {}): BoardNotification {
  return {
    tenant: "DEMO", patient_id: "bed-3", kind: "septic_shock", severity: "critical",
    urgency: "immediate", audience: "nurse", trigger: "new", title: "Yeni uyarı",
    body: "bed-3: Septic shock criteria met", ts: "2026-07-26T17:23:25.878950+00:00",
    ...overrides,
  };
}

describe("NotificationFeed", () => {
  it("says the feed is empty rather than showing a blank screen", async () => {
    await render(<NotificationFeed notifications={[]} onSelect={() => {}} />);
    expect(screen.getByText("Henüz uyarı yok.")).toBeTruthy();
  });

  it("separates escalations from new alerts", async () => {
    await render(
      <NotificationFeed
        notifications={[note(), note({ trigger: "escalation", kind: "sepsis" })]}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("Eskale edilenler")).toBeTruthy();
    expect(screen.getByText("Yeni uyarılar")).toBeTruthy();
  });

  it("shows the PHI-minimal body the server composed", async () => {
    await render(<NotificationFeed notifications={[note()]} onSelect={() => {}} />);
    expect(screen.getByText("bed-3: Septic shock criteria met")).toBeTruthy();
  });
});

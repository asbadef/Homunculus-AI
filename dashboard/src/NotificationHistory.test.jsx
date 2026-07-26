import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotificationHistory } from "./NotificationHistory.jsx";

const rec = {
  id: 1, ts: "2026-07-25T10:00:00+00:00", patient_id: "bed-3", subject: "septic_shock",
  payload: { trigger: "escalation", audience: "doctor" },
};

describe("NotificationHistory", () => {
  it("lists notification history fetched from the audit", async () => {
    const fetchAudit = vi.fn().mockResolvedValue([rec]);
    render(<NotificationHistory token="t" fetchAudit={fetchAudit} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByText(/septic_shock/)).toBeInTheDocument());
    expect(fetchAudit).toHaveBeenCalledWith("t", { eventType: "notification", limit: 50 });
  });

  it("selects the patient when a history row is clicked", async () => {
    const fetchAudit = vi.fn().mockResolvedValue([rec]);
    const onSelect = vi.fn();
    render(<NotificationHistory token="t" fetchAudit={fetchAudit} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText(/septic_shock/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/septic_shock/));
    expect(onSelect).toHaveBeenCalledWith("bed-3");
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DemoApp } from "./demo.jsx";

const timeline = { scenario: "t", step_seconds: 0.01,
  frames: [{ t: 0, boards: [{ patient_id: "bed-3", risk: "none", latest: { sofa: 0 }, alerts: [] }], notifications: [] }],
  notification_history: [] };

afterEach(() => vi.restoreAllMocks());

describe("DemoApp", () => {
  it("loads the timeline and renders the board with a DEMO banner", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => timeline }));
    render(<DemoApp scenario="septic_shock" />);
    await waitFor(() => expect(screen.getByText("bed-3")).toBeInTheDocument());
    expect(screen.getByText(/DEMO/)).toBeInTheDocument();
  });
});

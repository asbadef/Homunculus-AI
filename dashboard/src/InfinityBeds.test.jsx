/**
 * The research panel must tell six situations apart, because each sends the engineer to a
 * different place. Synthetic data only — no monitor traffic, no patient values.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { InfinityBeds, classify, Sparkline, bedTitle } from "./InfinityBeds.jsx";

const T = { border: "b", card: "c", muted: "m", faint: "f", heading: "h" };

function parameter(value, extra = {}) {
  return { value, status: "candidate", unit: "bpm", age_ms: 500, alarm_low: 45, alarm_high: 130,
           evidence: "display_verified", capture_epoch: 1, history: [[1, 70], [2, 72], [3, 71]], ...extra };
}

function state(devices) {
  return { schema: "homunculus.infinity-preview.v3", accepted_packets: 10, rejected_packets: 0,
           old_or_duplicate_packets: 0, stale_after_ms: 3000, history_seconds: 180, devices };
}

async function renderWith(researchState) {
  const store = { researchState };
  await act(async () => { render(<InfinityBeds T={T} store={store} pollMs={100000} />); });
  return store;
}

describe("InfinityBeds", () => {
  it("renders nothing on a store without a research window, so the simulation is untouched", async () => {
    const { container } = render(<InfinityBeds T={T} store={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a bed's parameters with unit, alarm limits and a trend", async () => {
    await renderWith(async () => state([{ device_id: "infinity-monitor-26", source_ip: "10.10.203.26",
      status: "streaming", packets: 50, packet_age_ms: 300, parameters: { hr: parameter(72) } }]));
    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("alarm 45–130")).toBeInTheDocument();
    expect(screen.getByText("yayında")).toBeInTheDocument();
    expect(screen.getByLabelText("trend")).toBeInTheDocument();
    cleanup();
  });

  it("shows a device-flagged invalid value as invalid, never as a number", async () => {
    await renderWith(async () => state([{ device_id: "d", source_ip: "10.10.203.25", status: "streaming",
      packets: 1, packet_age_ms: 100, parameters: { spo2: parameter(null, { status: "device_reports_invalid", unit: "%" }) } }]));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("cihaz: geçersiz")).toBeInTheDocument();
    cleanup();
  });

  it("says standby-shaped traffic is transmitting with no parameters, not silence", async () => {
    await renderWith(async () => state([{ device_id: "d", source_ip: "10.10.203.28", status: "no_parameters",
      packets: 40, packet_age_ms: 200, parameters: {} }]));
    expect(screen.getByText(/parametre yok/)).toBeInTheDocument();
    cleanup();
  });

  it("marks the one id that was never checked against a screen", async () => {
    await renderWith(async () => state([{ device_id: "d", source_ip: "10.10.203.29", status: "streaming",
      packets: 1, packet_age_ms: 100, parameters: { respiration_airway: parameter(18, { evidence: "unverified_layout", unit: "/min" }) } }]));
    expect(screen.getByText("doğrulanmadı")).toBeInTheDocument();
    cleanup();
  });

  it("drops the old numbers and names the failure when the request fails", async () => {
    // The outage is switched on by the test, not by a timer racing the first assertion.
    let failing = false;
    const store = { researchState: vi.fn(async () => {
      if (failing) throw Object.assign(new Error("x"), { status: 503, detail: { reason: "upstream_unreachable" } });
      return state([{ device_id: "d", source_ip: "10.10.203.26", status: "streaming",
        packets: 1, packet_age_ms: 100, parameters: { hr: parameter(72) } }]);
    }) };
    await act(async () => { render(<InfinityBeds T={T} store={store} pollMs={10} />); });
    expect(screen.getByText("72")).toBeInTheDocument();
    failing = true;
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(screen.queryByText("72")).not.toBeInTheDocument();
    expect(screen.getByText(/ulaşılamıyor/)).toBeInTheDocument();
    cleanup();
  });
});

describe("bed title", () => {
  it("shows a verified bed label, and says so when there is none instead of inventing one", async () => {
    expect(bedTitle({ device_id: "BED09" })).toBe("BED09");
    expect(bedTitle({ device_id: "bed06" })).toBe("BED06");
    expect(bedTitle({ device_id: "infinity-monitor-23" })).toBeNull();
    await renderWith(async () => state([
      { device_id: "BED09", source_ip: "10.10.203.26", status: "streaming", packets: 1, packet_age_ms: 100, parameters: {} },
      { device_id: "infinity-monitor-23", source_ip: "10.10.203.23", status: "no_parameters", packets: 1, packet_age_ms: 100, parameters: {} },
    ]));
    expect(screen.getByText("BED09")).toBeInTheDocument();
    expect(screen.getByText("Yatak eşlenmedi")).toBeInTheDocument();
    expect(screen.queryByText("infinity-monitor-23")).not.toBeInTheDocument();
    cleanup();
  });
});

describe("classify", () => {
  it("tells the six situations apart", () => {
    expect(classify({ reason: "not_configured" }, null).kind).toBe("not_configured");
    expect(classify({ status: 403 }, null).kind).toBe("forbidden");
    expect(classify({ status: 401 }, null).kind).toBe("unauthorized");
    expect(classify({ reason: "upstream_timeout" }, null).kind).toBe("hub_down");
    expect(classify({ status: 500 }, null).kind).toBe("api_error");
    expect(classify(null, null).kind).toBe("loading");
    expect(classify(null, state([])).kind).toBe("empty");
    expect(classify(null, state([{ device_id: "d", parameters: {} }]))).toBeNull();
  });
});

describe("Sparkline", () => {
  it("needs at least two points and otherwise draws one polyline", () => {
    const { container: none } = render(<Sparkline points={[[1, 70]]} />);
    expect(none.querySelector("svg")).toBeNull();
    const { container } = render(<Sparkline points={[[1, 70], [2, 80], [3, 75]]} />);
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
  });
});

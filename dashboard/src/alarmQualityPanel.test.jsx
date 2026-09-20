/**
 * The alarm-quality panel, and the three ways it could flatter the product (E4).
 *
 * Homunculus exists to reduce alarm fatigue. A panel that measures it can only be trusted if it is
 * as willing to report a bad number as a good one — and if it refuses to invent a good one when it
 * has nothing to report.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AlarmQualityPanel } from "./clinicalAdmin.jsx";
import { getTheme } from "./clinicalTheme.js";
import { cstrings } from "./clinicalI18n.js";

const T = getTheme("dark");
const S = cstrings("tr");

const show = (data) =>
  render(<AlarmQualityPanel T={T} S={S} store={{ alarmQuality: vi.fn(async () => data) }} />);

const BASE = {
  episodes: 0, answered: 0, unanswered: 0, escalated: 0, pending: 0,
  answered_rate: null, median_response_sec: null, p90_response_sec: null,
  repeats: 0, per_kind: [], per_day: [], noisiest_beds: [],
};

describe("it reports a bad number as a bad number", () => {
  it("shows the answered rate and the response times", async () => {
    show({ ...BASE, episodes: 10, answered: 9, unanswered: 1, answered_rate: 0.9,
           median_response_sec: 45, p90_response_sec: 240 });
    await waitFor(() => expect(screen.getByText("90%")).toBeInTheDocument());
    expect(screen.getByText(/45 sn/)).toBeInTheDocument();
    expect(screen.getByText(/4 dk/)).toBeInTheDocument();
  });

  it("does not soften a ward that ignores most alarms", async () => {
    show({ ...BASE, episodes: 10, answered: 3, unanswered: 7, answered_rate: 0.3 });
    await waitFor(() => expect(screen.getByText("30%")).toBeInTheDocument());
    // Never-answered alarms are the finding, so they are shown as one.
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});

describe("it does not invent a number it does not have", () => {
  it("renders an unknown rate as unknown, never as 0%", async () => {
    show({ ...BASE, episodes: 3, pending: 3, answered_rate: null });
    await waitFor(() => expect(screen.getByText(/Henüz ölçülecek kadar veri yok/)).toBeInTheDocument());
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("keeps open alarms out of the rate instead of counting them as ignored", async () => {
    // 1 answered, 1 still in flight: the rate is 100% of what has settled, not 50%.
    show({ ...BASE, episodes: 2, answered: 1, pending: 1, answered_rate: 1.0 });
    await waitFor(() => expect(screen.getByText("100%")).toBeInTheDocument());
    expect(screen.getByText(/Orana dahil edilmez/)).toBeInTheDocument();
  });
});

describe("it shows the noise the ward actually experiences", () => {
  it("reports repeat emissions even though they are not episodes", async () => {
    show({ ...BASE, episodes: 2, answered: 2, answered_rate: 1.0, repeats: 137 });
    await waitFor(() => expect(screen.getByText("137")).toBeInTheDocument());
  });

  it("names the beds raising the most alarms", async () => {
    show({ ...BASE, episodes: 4, answered: 4, answered_rate: 1.0,
           noisiest_beds: [{ patient_id: "bed-3", episodes: 3 }] });
    await waitFor(() => expect(screen.getByText(/bed-3 · 3/)).toBeInTheDocument());
  });
});

describe("failure is reported as failure", () => {
  it("says the data could not be loaded rather than showing an empty ward", async () => {
    render(<AlarmQualityPanel T={T} S={S}
             store={{ alarmQuality: vi.fn(async () => { throw new Error("network"); }) }} />);
    await waitFor(() => expect(screen.getByText(/alınamadı/)).toBeInTheDocument());
    expect(screen.queryByText(/Zincir/)).toBeNull();
  });
});

// UnmatchedProvider.test.jsx — G3-05 (D17): the shell-wide read of the unmatched readings, for the rail's badge and
// the bedside page's step. Synthetic sets only.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, screen } from "@testing-library/react";
import { mount, refusal } from "../session/mount.testutil.jsx";
import { profile, token } from "../session/testTokens.testutil.js";
import { NOW } from "./board.testutil.js";
import { UNMATCHED_POLL_MS, UnmatchedProvider, useUnmatched } from "./UnmatchedProvider.jsx";
import { unmatched } from "../screens/bedside/unmatched.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const CHART = ["board.view", "clinical.chart"];

function Probe() {
  const { count, sets, phase, truncated } = useUnmatched();
  return <p data-probe="">{`${phase}:${count === null ? "null" : count}:${sets.length}${truncated ? ":cut" : ""}`}</p>;
}
const probe = () => document.querySelector("[data-probe]").textContent;

async function open({ perms = CHART, setup } = {}) {
  const mounted = await mount(<UnmatchedProvider><Probe /></UnmatchedProvider>, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => { api.unmatchedReadings.mockResolvedValue(unmatched()); setup?.(api); },
  });
  await act(async () => { await settle(); });
  return mounted;
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the unmatched readings, read once for the shell", () => {
  it("reads the list for a clinical.chart holder and counts its sets", async () => {
    const { api } = await open();
    expect(api.unmatchedReadings).toHaveBeenCalledTimes(1);
    expect(probe()).toBe("known:2:2");
  });

  it("asks nothing without clinical.chart", async () => {
    const { api } = await open({ perms: ["board.view"] });
    expect(api.unmatchedReadings).not.toHaveBeenCalled();
    expect(probe()).toBe("unasked:null:0");
  });

  it("reads again every 60 seconds", async () => {
    const { api } = await open();
    await act(async () => { vi.advanceTimersByTime(UNMATCHED_POLL_MS); await settle(); });
    expect(api.unmatchedReadings).toHaveBeenCalledTimes(2);
    expect(UNMATCHED_POLL_MS).toBe(60_000);
  });

  it("stops reading when the shell goes away", async () => {
    const { api } = await open();
    cleanup();
    await act(async () => { vi.advanceTimersByTime(UNMATCHED_POLL_MS * 3); await settle(); });
    expect(api.unmatchedReadings).toHaveBeenCalledTimes(1);
  });

  it("a failed read keeps the last sets but no count: a number that may be old is not a count", async () => {
    const { api } = await open();
    api.unmatchedReadings.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor"));
    await act(async () => { vi.advanceTimersByTime(UNMATCHED_POLL_MS); await settle(); });
    expect(probe()).toBe("stale:null:2");
  });

  // Final review (minor 7): the engine answers at most its newest 200 sets; `count` is its own count of what waits.
  it("counts the sets the engine's way, and says when the answer was cut", async () => {
    const { api } = await open({ setup: (a) => a.unmatchedReadings.mockResolvedValue({ ...unmatched(), count: 250, truncated: true }) });
    expect(probe()).toBe("known:250:2:cut");
    api.unmatchedReadings.mockResolvedValue(unmatched());
    await act(async () => { vi.advanceTimersByTime(UNMATCHED_POLL_MS); await settle(); });
    expect(probe()).toBe("known:2:2");
  });

  it("an answer with no count of its own is counted by its sets", async () => {
    await open({ setup: (a) => a.unmatchedReadings.mockResolvedValue({ sets: unmatched().sets }) });
    expect(probe()).toBe("known:2:2");
  });

  it("a failed read after a cut answer keeps the word on the sets it keeps, but no count", async () => {
    const { api } = await open({ setup: (a) => a.unmatchedReadings.mockResolvedValue({ ...unmatched(), count: 250, truncated: true }) });
    api.unmatchedReadings.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor"));
    await act(async () => { vi.advanceTimersByTime(UNMATCHED_POLL_MS); await settle(); });
    expect(probe()).toBe("stale:null:2:cut");
  });

  it("an answer that is not a list is a failed read", async () => {
    await open({ setup: (api) => api.unmatchedReadings.mockResolvedValue({ nope: true }) });
    expect(probe()).toBe("failed:null:0");
  });

  it("outside a provider nothing is asked and nothing is counted", async () => {
    const mounted = await mount(<Probe />, { access: token({ perms: CHART }), me: profile({ perms: CHART }) });
    expect(mounted.api.unmatchedReadings).not.toHaveBeenCalled();
    expect(screen.getByText("unasked:null:0")).toBeInTheDocument();
  });
});

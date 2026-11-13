// useInfection.test.jsx — «Enfeksiyon kontrol» (G4-05, spec D14 as §5 M9 and S1 amend it): the page's own read, with
// usePharmacy's rules — on mount and every 30 s, nothing from a hidden tab and a read when it is shown, the sequence
// guard, a refused read drops the held answer and any other failure keeps it, a malformed answer is a failed read, the
// skew of each answer — and the structure tree read with it, for a session that may read the tree.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PHARMACY_TICK_MS } from "../eczane/usePharmacy.js";
import { INFECTION_TICK_MS, isInfectionAnswer, useInfection } from "./useInfection.js";
import { MIN, NOW, answer } from "./enfeksiyon.testutil.js";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const pass = (ms) => act(async () => { vi.advanceTimersByTime(ms); await settle(); });
const storeWith = (infection, api = {}) => ({ track: (call) => call(), api: { infection, ...api } });
async function mountHook(infection, { api, reloadStructure } = {}) {
  const store = storeWith(infection, api);
  const rendered = renderHook(() => useInfection(store, { reloadStructure }));
  await act(async () => { await settle(); });
  return rendered;
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe("useInfection", () => {
  it("reads on mount and every 30 s — Eczane's tempo", async () => {
    const infection = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(infection);
    expect(INFECTION_TICK_MS).toBe(PHARMACY_TICK_MS);
    expect(INFECTION_TICK_MS).toBe(30_000);
    expect(infection).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(answer());
    expect(result.current.error).toBeNull();
    await pass(29_000);
    expect(infection).toHaveBeenCalledTimes(1);
    await pass(1_000);
    expect(infection).toHaveBeenCalledTimes(2);
  });

  it("keeps the last answer and reports the error when a read fails, and clears the error when one lands", async () => {
    const infection = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(infection);
    const failure = Object.assign(new Error("kapsam şu anda okunamıyor"), { status: 503 });
    infection.mockRejectedValueOnce(failure);
    await pass(30_000);
    expect(result.current.data).toEqual(answer());
    expect(result.current.error).toBe(failure);
    await pass(30_000);
    expect(result.current.error).toBeNull();
  });

  it("drops the held answer when the read is refused, and keeps it through a 5xx, a timeout and a network failure", async () => {
    for (const [failure, kept] of [
      [Object.assign(new Error("permission required: infection.view"), { status: 403 }), false],
      [Object.assign(new Error("unknown credential"), { status: 401 }), false],
      [Object.assign(new Error("boom"), { status: 500 }), true],
      [Object.assign(new Error("zaman aşımı"), { code: "REQUEST_TIMEOUT" }), true],
      [new TypeError("Failed to fetch"), true],
    ]) {
      const infection = vi.fn().mockResolvedValue(answer());
      // eslint-disable-next-line no-await-in-loop
      const { result, unmount } = await mountHook(infection);
      infection.mockRejectedValueOnce(failure);
      // eslint-disable-next-line no-await-in-loop
      await pass(30_000);
      expect(result.current.data, failure.message).toEqual(kept ? answer() : null);
      expect(result.current.error, failure.message).toBe(failure);
      unmount();
    }
  });

  it("takes an answer of another shape for a failed read, never for an empty ward (§5 M9)", async () => {
    const whole = answer();
    const bad = [undefined, null, {}, { rows: [] }, { ...whole, counts: null }, { ...whole, counts: [] },
      { ...whole, isolated: null }, { ...whole, suspected: "none" }, { ...whole, bed_occupants: undefined },
      { ...whole, units: {} }];
    for (const value of bad) {
      expect(isInfectionAnswer(value), JSON.stringify(value)?.slice(0, 60)).toBe(false);
      // eslint-disable-next-line no-await-in-loop
      const { result, unmount } = await mountHook(vi.fn().mockResolvedValue(value));
      expect(result.current.data).toBeNull();
      expect(result.current.error?.malformed).toBe(true);
      unmount();
    }
    expect(isInfectionAnswer(answer({ isolated: [], suspected: [], bed_occupants: [], units: [] }))).toBe(true);
  });

  it("drops the answer to an earlier read that lands after a newer one", async () => {
    let releaseSlow;
    const slow = new Promise((resolve) => { releaseSlow = resolve; });
    const newer = answer({ isolated: [] });
    const infection = vi.fn().mockReturnValueOnce(slow).mockResolvedValue(newer);
    const { result } = await mountHook(infection);
    await pass(30_000);
    expect(result.current.data).toEqual(newer);
    await act(async () => { releaseSlow(answer()); await settle(); });
    expect(result.current.data).toEqual(newer);
  });

  it("reads nothing from a hidden tab, at once when it is shown again, and nothing after the page is left", async () => {
    const infection = vi.fn().mockResolvedValue(answer());
    const { unmount } = await mountHook(infection);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      await pass(95_000);
      expect(infection).toHaveBeenCalledTimes(1);
      visibility.mockReturnValue("visible");
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
      expect(infection).toHaveBeenCalledTimes(2);
    } finally {
      visibility.mockRestore();
    }
    unmount();
    await pass(90_000);
    expect(infection).toHaveBeenCalledTimes(2);
  });

  it("`refresh` reads again on request", async () => {
    const infection = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(infection);
    await act(async () => { await result.current.refresh(); });
    expect(infection).toHaveBeenCalledTimes(2);
  });

  it("takes each answer's clock skew: the client's measure, else the answer's own `now`", async () => {
    const { result, unmount } = await mountHook(vi.fn().mockResolvedValue(answer()), { api: { serverClockSkewMs: () => 300_000 } });
    expect(result.current.skewMs).toBe(300_000);
    unmount();
    vi.setSystemTime(NOW - 5 * MIN);                                  // the workstation five minutes slow
    const slow = await mountHook(vi.fn().mockResolvedValue(answer()));
    expect(Math.abs(slow.result.current.skewMs - 5 * MIN)).toBeLessThan(1_000);
  });
});

// §5 S1: the isolation beds are the structure tree's; the tree is read again with each read of the list.
describe("the structure tree, read with the list", () => {
  it("is read on mount and with every tick, never from a hidden tab", async () => {
    const reloadStructure = vi.fn().mockResolvedValue({ sites: [] });
    const infection = vi.fn().mockResolvedValue(answer());
    await mountHook(infection, { reloadStructure });
    expect(reloadStructure).toHaveBeenCalledTimes(1);
    await pass(30_000);
    expect(reloadStructure).toHaveBeenCalledTimes(2);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      await pass(60_000);
      expect(reloadStructure).toHaveBeenCalledTimes(2);
    } finally {
      visibility.mockRestore();
    }
  });

  it("does not hold the list back when the tree's read fails", async () => {
    const reloadStructure = vi.fn().mockRejectedValue(new Error("down"));
    const { result } = await mountHook(vi.fn().mockResolvedValue(answer()), { reloadStructure });
    expect(result.current.data).toEqual(answer());
    expect(result.current.error).toBeNull();
  });

  it("is not read for a session that may not read it (no reload given)", async () => {
    const infection = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(infection);
    await pass(30_000);
    expect(infection).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(answer());
  });
});

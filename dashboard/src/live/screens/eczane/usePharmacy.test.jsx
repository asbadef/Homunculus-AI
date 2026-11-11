// usePharmacy.test.jsx — «Eczane» (G3-04, spec D17, D18): the page's one read. On mount and every 30 s; a failed read
// keeps the last answer and reports the error; an answer without its rows is a failed read; an answer to an earlier
// read never lands over a newer one; the tab shown again reads at once; nothing is read after the page is left.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PHARMACY_TICK_MS, usePharmacy } from "./usePharmacy.js";
import { MIN, NOW, answer } from "./eczane.testutil.js";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const pass = (ms) => act(async () => { vi.advanceTimersByTime(ms); await settle(); });
/** A session store as the hook uses it: `track` runs the call, `api.pharmacy` is the read. */
const storeWith = (pharmacy, api = {}) => ({ track: (call) => call(), api: { pharmacy, ...api } });
async function mountHook(pharmacy, api) {
  const store = storeWith(pharmacy, api);     // one store for the hook's whole life, as the session's is
  const rendered = renderHook(() => usePharmacy(store));
  await act(async () => { await settle(); });
  return rendered;
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe("usePharmacy", () => {
  it("reads on mount and every 30 s", async () => {
    const pharmacy = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(pharmacy);
    expect(PHARMACY_TICK_MS).toBe(30_000);
    expect(pharmacy).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(answer());
    expect(result.current.error).toBeNull();
    await pass(29_000);
    expect(pharmacy).toHaveBeenCalledTimes(1);
    await pass(1_000);
    expect(pharmacy).toHaveBeenCalledTimes(2);
    await pass(60_000);
    expect(pharmacy).toHaveBeenCalledTimes(4);
  });

  it("starts with no answer and no error", async () => {
    const { result } = await mountHook(() => new Promise(() => {}));
    expect(result.current).toMatchObject({ data: null, error: null });
  });

  it("keeps the last answer and reports the error when a read fails, and clears the error when one lands", async () => {
    const pharmacy = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(pharmacy);
    const failure = Object.assign(new Error("kapsam şu anda okunamıyor"), { status: 503 });
    pharmacy.mockRejectedValueOnce(failure);
    await pass(30_000);
    expect(result.current.data).toEqual(answer());
    expect(result.current.error).toBe(failure);
    await pass(30_000);
    expect(result.current.error).toBeNull();
  });

  // Review F6: a failed read keeps the last answer — but not when the failure says the caller may no longer see it.
  it("drops the held answer when the read is refused: 401 and 403 are a right withdrawn, not a list gone stale", async () => {
    for (const status of [401, 403]) {
      const pharmacy = vi.fn().mockResolvedValue(answer());
      // eslint-disable-next-line no-await-in-loop
      const { result, unmount } = await mountHook(pharmacy);
      expect(result.current.data, String(status)).toEqual(answer());
      const refused = Object.assign(new Error("permission required: pharmacy.view"), { status });
      pharmacy.mockRejectedValueOnce(refused);
      // eslint-disable-next-line no-await-in-loop
      await pass(30_000);
      expect(result.current.data, String(status)).toBeNull();
      expect(result.current.error, String(status)).toBe(refused);
      // eslint-disable-next-line no-await-in-loop
      await pass(30_000);                                 // the right is back: the next answer is shown
      expect(result.current.data, String(status)).toEqual(answer());
      expect(result.current.error, String(status)).toBeNull();
      unmount();
    }
  });

  it("keeps the held answer through a server error, a timeout and a network failure", async () => {
    const failures = [Object.assign(new Error("boom"), { status: 500 }), Object.assign(new Error("kapsam şu anda okunamıyor"), { status: 503 }),
      Object.assign(new Error("zaman aşımı"), { code: "REQUEST_TIMEOUT" }), new TypeError("Failed to fetch")];
    for (const failure of failures) {
      const pharmacy = vi.fn().mockResolvedValue(answer());
      // eslint-disable-next-line no-await-in-loop
      const { result, unmount } = await mountHook(pharmacy);
      pharmacy.mockRejectedValueOnce(failure);
      // eslint-disable-next-line no-await-in-loop
      await pass(30_000);
      expect(result.current.data, failure.message).toEqual(answer());
      expect(result.current.error, failure.message).toBe(failure);
      unmount();
    }
  });

  it("reports a failed first read with no answer", async () => {
    const failure = Object.assign(new Error("permission required: pharmacy.view"), { status: 403 });
    const { result } = await mountHook(vi.fn().mockRejectedValue(failure));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe(failure);
  });

  it("takes an answer without a rows array for a failed read", async () => {
    for (const bad of [undefined, null, {}, { rows: null }, { rows: "none" }, { counts: { patients: 0 } }]) {
      // eslint-disable-next-line no-await-in-loop
      const { result, unmount } = await mountHook(vi.fn().mockResolvedValue(bad));
      expect(result.current.data, JSON.stringify(bad)).toBeNull();
      expect(result.current.error?.malformed, JSON.stringify(bad)).toBe(true);
      unmount();
    }
  });

  it("keeps the last good answer when a later one is malformed", async () => {
    const pharmacy = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(pharmacy);
    pharmacy.mockResolvedValueOnce({ now: "2026-10-08T10:00:30Z" });
    await pass(30_000);
    expect(result.current.data).toEqual(answer());
    expect(result.current.error.malformed).toBe(true);
  });

  it("drops the answer to an earlier read that lands after a newer one", async () => {
    let releaseSlow;
    const slow = new Promise((resolve) => { releaseSlow = resolve; });
    const newer = answer({ counts: { patients: 1 }, rows: [] });
    const pharmacy = vi.fn().mockReturnValueOnce(slow).mockResolvedValue(newer);
    const { result } = await mountHook(pharmacy);
    expect(result.current.data).toBeNull();
    await pass(30_000);                                  // the second read lands first
    expect(result.current.data).toEqual(newer);
    await act(async () => { releaseSlow(answer()); await settle(); });
    expect(result.current.data).toEqual(newer);          // the first read's answer is not shown over it
  });

  it("reads at once when the tab is shown again", async () => {
    const pharmacy = vi.fn().mockResolvedValue(answer());
    await mountHook(pharmacy);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
    expect(pharmacy).toHaveBeenCalledTimes(2);
  });

  // Review F7: a tab nobody is looking at asks the server for nothing; the read on `visibilitychange` brings today's
  // list the moment it is shown again.
  it("reads nothing from a hidden tab, and at once when it is shown again", async () => {
    const pharmacy = vi.fn().mockResolvedValue(answer());
    await mountHook(pharmacy);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      await pass(95_000);                                 // three ticks pass unseen
      expect(pharmacy).toHaveBeenCalledTimes(1);
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
      expect(pharmacy).toHaveBeenCalledTimes(1);          // still hidden: the event alone reads nothing
      visibility.mockReturnValue("visible");
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
      expect(pharmacy).toHaveBeenCalledTimes(2);
      await pass(30_000);                                 // and the ticks read again
      expect(pharmacy).toHaveBeenCalledTimes(3);
    } finally {
      visibility.mockRestore();
    }
  });

  it("reads nothing after the page is left", async () => {
    const pharmacy = vi.fn().mockResolvedValue(answer());
    const { unmount } = await mountHook(pharmacy);
    unmount();
    await pass(90_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(pharmacy).toHaveBeenCalledTimes(1);
  });

  it("`refresh` reads again on request", async () => {
    const pharmacy = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(pharmacy);
    await act(async () => { await result.current.refresh(); });
    expect(pharmacy).toHaveBeenCalledTimes(2);
  });
});

// Review F1: the page's clock must be the server's for EVERY session. The board store, whose skew `useBoardNow`
// reads, only starts for a `board.view` holder; so the hook hands on the skew of its own answers (server minus
// browser, ms), taken at the moment an answer lands.
describe("the clock skew of the page's own answers", () => {
  it("is unknown before the first answer", async () => {
    const { result } = await mountHook(() => new Promise(() => {}), { serverClockSkewMs: () => 300_000 });
    expect(result.current.skewMs).toBeNull();
  });

  it("is the one the API client measured from the answer's `Date` header, read when the answer lands", async () => {
    let measured = null;                                  // nothing measured until an answer has been seen
    const pharmacy = vi.fn(async () => { measured = 300_000; return answer(); });
    const { result } = await mountHook(pharmacy, { serverClockSkewMs: () => measured });
    expect(result.current.skewMs).toBe(300_000);
    pharmacy.mockImplementation(async () => { measured = -120_000; return answer(); });
    await pass(30_000);
    expect(result.current.skewMs).toBe(-120_000);
    pharmacy.mockImplementation(async () => { measured = 0; return answer(); });
    await pass(30_000);
    expect(result.current.skewMs).toBe(0);                // «no skew» is a measurement too
  });

  it("is taken from the answer's own `now` when the client measured none (a proxy stripped the header)", async () => {
    for (const api of [{ serverClockSkewMs: () => null }, {}]) {
      for (const offset of [-5 * MIN, 2 * MIN]) {         // the workstation 5 minutes slow, then 2 minutes fast
        vi.setSystemTime(NOW + offset);
        // eslint-disable-next-line no-await-in-loop
        const { result, unmount } = await mountHook(vi.fn().mockResolvedValue(answer()), api);     // the server says NOW
        expect(Math.abs(result.current.skewMs + offset), String(offset)).toBeLessThan(1_000);
        unmount();
      }
    }
  });

  // The client's own rule for the `Date` header (backendApi): a right clock measures minus the latency, and that
  // jitter must not move the instant the durations are counted against — a minute would flicker at its boundary.
  it("reads the answer's `now` with the client's noise floor: under 2 s is no skew, above it whole seconds", async () => {
    for (const [offset, skew] of [[800, 0], [-1_600, 0], [0, 0], [-300_400, 300_000], [2_600, -3_000]]) {
      vi.setSystemTime(NOW + offset);
      // eslint-disable-next-line no-await-in-loop
      const { result, unmount } = await mountHook(vi.fn().mockResolvedValue(answer()));
      expect(result.current.skewMs, String(offset)).toBe(skew);
      unmount();
    }
  });

  it("is unknown for an answer whose `now` does not read, when the client measured none", async () => {
    const { result } = await mountHook(vi.fn().mockResolvedValue(answer({ now: "dün" })));
    expect(result.current.data).not.toBeNull();
    expect(result.current.skewMs).toBeNull();
  });

  it("stays the last answer's through a failed read", async () => {
    const pharmacy = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(pharmacy, { serverClockSkewMs: () => 300_000 });
    for (const status of [503, 403]) {
      pharmacy.mockRejectedValueOnce(Object.assign(new Error("x"), { status }));
      // eslint-disable-next-line no-await-in-loop
      await pass(30_000);
      expect(result.current.error.status).toBe(status);
      expect(result.current.skewMs, String(status)).toBe(300_000);
      // eslint-disable-next-line no-await-in-loop
      await pass(30_000);
    }
  });
});

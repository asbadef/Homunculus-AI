// usePharmacy.test.jsx — «Eczane» (G3-04, spec D17, D18): the page's one read. On mount and every 30 s; a failed read
// keeps the last answer and reports the error; an answer without its rows is a failed read; an answer to an earlier
// read never lands over a newer one; the tab shown again reads at once; nothing is read after the page is left.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PHARMACY_TICK_MS, usePharmacy } from "./usePharmacy.js";
import { answer } from "./eczane.testutil.js";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const pass = (ms) => act(async () => { vi.advanceTimersByTime(ms); await settle(); });
/** A session store as the hook uses it: `track` runs the call, `api.pharmacy` is the read. */
const storeWith = (pharmacy) => ({ track: (call) => call(), api: { pharmacy } });
async function mountHook(pharmacy) {
  const store = storeWith(pharmacy);          // one store for the hook's whole life, as the session's is
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

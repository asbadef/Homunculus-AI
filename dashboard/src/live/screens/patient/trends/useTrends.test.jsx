// useTrends: when the patient screen reads the trend charts, and what it keeps when it cannot.
// Fake timers are installed BEFORE mount (the house recipe), and `flush()` yields one real turn of
// the event loop inside act() instead of waitFor.
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { useState } from "react";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { TRENDS_POLL_MS, measuredKeyOf, useTrends } from "./useTrends.js";
import { answering, channel, point, trends } from "./trends.testutil.js";

const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const flush = () => act(() => new Promise((resolve) => { realSetTimeout(resolve, 0); }));

let setProps;
function Probe(initial) {
  const [props, set] = useState(initial);
  setProps = set;
  const read = useTrends(props.id, props.hours, props.measuredKey);
  const hr = read.data?.channels.find((c) => c.key === "heart_rate")?.latest?.value;
  return (
    <>
      <output data-testid="probe" data-loading={String(read.loading)} data-unreadable={String(read.unreadable)}
        data-patient={read.data?.patient_id ?? ""} data-last={read.lastOkAt ?? ""}>{hr ?? ""}</output>
      <button type="button" onClick={read.reload}>again</button>
    </>
  );
}
const probe = () => screen.getByTestId("probe");
const withHr = (value) => (pid, hours) => trends(pid, [channel("heart_rate", [point(5, value, 0)])], { hours });

async function start({ id = "S-001", hours = 24, measuredKey = "k1", answer = answering(withHr(84)) } = {}) {
  vi.useFakeTimers(FAKE_TIMERS);
  vi.setSystemTime(NOW);
  const mounted = await mount(<Probe id={id} hours={hours} measuredKey={measuredKey} />, {
    access: token(), me: profile(), setup: (api) => api.patientTrends.mockImplementation(answer),
  });
  await flush();
  return mounted;
}

function visibility(state) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  cleanup();
  delete document.visibilityState;
  vi.useRealTimers();
  localStorage.clear();          // a lock is written to storage (`hmc.lock`) and would lock the next test
});

describe("useTrends", () => {
  it("reads the patient's window once on mount and gives the answer", async () => {
    const { api } = await start();
    expect(api.patientTrends.mock.calls).toEqual([["S-001", 24]]);
    expect(probe()).toHaveTextContent("84");
    expect(probe().dataset).toMatchObject({ loading: "false", unreadable: "false", patient: "S-001", last: String(NOW) });
  });

  it("reads again when a new measurement reaches the board, and not on a render that changed nothing", async () => {
    const { api } = await start();
    act(() => setProps((p) => ({ ...p })));
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(1);
    act(() => setProps((p) => ({ ...p, measuredKey: "k2" })));
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
  });

  it("reads once a minute while the page is visible, not while it is hidden, and at once on return", async () => {
    const { api } = await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(TRENDS_POLL_MS); });
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
    act(() => visibility("hidden"));
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * TRENDS_POLL_MS); });
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
    act(() => visibility("visible"));
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(3);
  });

  it("a failed read keeps the last answer and says when that answer came", async () => {
    const { api } = await start();
    api.patientTrends.mockImplementationOnce(() => Promise.reject(Object.assign(new Error("down"), { status: 503 })));
    await act(async () => { await vi.advanceTimersByTimeAsync(TRENDS_POLL_MS); });
    expect(probe()).toHaveTextContent("84");
    expect(probe().dataset).toMatchObject({ unreadable: "true", last: String(NOW) });
    api.patientTrends.mockImplementation(answering(withHr(90)));
    await act(async () => { await vi.advanceTimersByTimeAsync(TRENDS_POLL_MS); });
    expect(probe()).toHaveTextContent("90");
    expect(probe().dataset).toMatchObject({ unreadable: "false", last: String(NOW + 2 * TRENDS_POLL_MS) });
  });

  it("an answer that is not this patient's trends is no answer", async () => {
    for (const bad of [() => Promise.resolve(undefined), answering((_pid, h) => trends("S-002", [], { hours: h })),
      answering((pid) => trends(pid, [], { hours: 72 }))]) {
      await start({ answer: bad });
      expect(probe().dataset).toMatchObject({ loading: "false", unreadable: "true", patient: "" });
      cleanup();
      vi.useRealTimers();
    }
  });

  it("never shows another patient's answer: a move clears the screen, and a late answer is dropped", async () => {
    let late;
    const answer = (pid, hours) => (pid === "S-001"
      ? new Promise((resolve) => { late = () => resolve(withHr(84)(pid, hours)); })
      : Promise.resolve(withHr(70)(pid, hours)));
    await start({ answer });
    expect(probe().dataset.loading).toBe("true");
    act(() => setProps((p) => ({ ...p, id: "S-002" })));
    expect(probe().dataset).toMatchObject({ patient: "", loading: "true" });
    await flush();
    expect(probe().dataset.patient).toBe("S-002");
    await act(async () => { late(); });
    await flush();
    expect(probe().dataset.patient).toBe("S-002");
    expect(probe()).toHaveTextContent("70");
  });

  it("stops at the lock: nothing is read while locked, and an answer that lands after it is dropped", async () => {
    let late;
    const { api, store } = await start();
    api.patientTrends.mockImplementationOnce((pid, hours) => new Promise((resolve) => { late = () => resolve(withHr(99)(pid, hours)); }));
    await act(async () => { await vi.advanceTimersByTimeAsync(TRENDS_POLL_MS); });
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
    act(() => { store.lock(); });
    await act(async () => { late(); });
    await flush();
    expect(probe()).toHaveTextContent("84");
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * TRENDS_POLL_MS); });
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
  });

  it("reload() reads now", async () => {
    const { api } = await start();
    fireEvent.click(screen.getByRole("button", { name: "again" }));
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
  });
});

describe("measuredKeyOf", () => {
  it("changes exactly when one of the card's measured instants does", () => {
    expect(measuredKeyOf({ spo2: "2026-10-08T09:58:00Z", heart_rate: "2026-10-08T09:59:00Z", map: null }))
      .toBe(measuredKeyOf({ heart_rate: "2026-10-08T09:59:00Z", spo2: "2026-10-08T09:58:00Z" }));
    expect(measuredKeyOf({ heart_rate: "2026-10-08T09:59:00Z" })).not.toBe(measuredKeyOf({ heart_rate: "2026-10-08T10:00:00Z" }));
    expect(measuredKeyOf(undefined)).toBe("");
  });
});

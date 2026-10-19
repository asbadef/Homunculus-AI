// Aşama A's monitor strip never reaches the alarm path — proved on the page, in the spirit of the
// API's equivalence gate (homunculus-engine tests/test_infinity_shadow_equivalence.py).
//
// The same LIVE ward (a critical and a high alarm, a quiet bed) is shown on the beds screen twice:
// A with the strip OFF, B with a strip whose linked beds read HR 180 / SpO2 70 — values that would
// raise every alarm if they were clinical — polled ten times. The alarm sound is on and the page
// goes to the background, so the sound and the critical-alarm notification are both in play.
// Everything the alarm path reads or says must be identical: what sounded, every notification
// (title, body, tag), the signals' state, alarmsToSignal / waitingAlarms / alarmCounts /
// lockSummary (the sound, the bell, the rail badge, the lock screen), the board's own state, the
// cards' risk order and the waiting line. A negative control — one more critical alarm in A —
// shows the harness can see a difference. Synthetic only.
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { NOW, alarm, board, entry, identity, measured } from "../../data/board.testutil.js";
import { STAGE_OFF, bed as monitorBed, param, strip, unassigned } from "../../data/shadow.testutil.js";
import { alarmCounts, alarmsToSignal, lockSummary, waitingAlarms } from "../../data/boardStore.js";
import { ShellProvider } from "../../shell/ShellContext.jsx";
import { resetScreens } from "../../shell/routes.js";
import { onlyScreens } from "../../shell/screens.testutil.js";
import { useAlarmSignals } from "../../signals/AlarmSignals.jsx";
import { fakeAudio, fakeNotifications, onPage } from "../../signals/fakeAudio.testutil.js";
import { BedsScreen } from "./BedsScreen.jsx";

const realSetTimeout = globalThis.setTimeout;
const flush = () => act(() => new Promise((resolve) => { realSetTimeout(resolve, 0); }));
const WAITING = "Siqnal səsi gözləmədədir — açmaq üçün klikləyin";
const PERMS = ["board.view", "alerts.ack"];

let page = null;
afterEach(() => {
  page?.undo();
  page = null;
  resetScreens();
  vi.useRealTimers();
  localStorage.clear();
});

function Probe() {
  const { sound, notify } = useAlarmSignals();
  return <p data-testid="signals">{`${sound} ${notify}`}</p>;
}

const reaBed = (id, bedLabel, alarms) => entry(id, alarms, {
  identity: identity({ patient_id: id, bed_label: bedLabel, bed_id: bedLabel.replace(" · ", "-") }), at: measured(30),
});
const WARD = [
  reaBed("S-001", "REA-01 · 1", [alarm("septic_shock", "critical")]),
  reaBed("S-002", "REA-01 · 2", [alarm("news2", "high")]),
  reaBed("S-003", "REA-01 · 3", []),
];
const ALARMING = strip({
  beds: [
    monitorBed("REA-01 · 1", [param("hr", 180), param("spo2", 70), param("respiration", 40), param("art_systolic", 70)],
      { link: "one", patient_id: "S-001" }),
    monitorBed("REA-01 · 3", [param("hr", 180), param("spo2", 70)], { link: "one", patient_id: "S-003" }),
    monitorBed("REA-01 · 9", [param("hr", 180)]),
  ],
  unassigned: [unassigned("192.0.2.28", "table_unassigned", [param("hr", 180)])],
});

/** One run of the ward. Returns everything the alarm path reads or says. */
async function run({ patients = WARD, shadow = STAGE_OFF } = {}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(NOW);
  localStorage.setItem("hmc.alarmSound", "on");
  const audio = fakeAudio();
  const notes = fakeNotifications("granted");
  page = onPage({ AudioContext: audio.AudioContext, Notification: notes.Notification });
  onlyScreens({}, { keep: [] });
  const view = await mount(
    <>
      <Probe />
      <ShellProvider units={[]} scope="known"><BedsScreen /></ShellProvider>
    </>,
    { setup: (api) => {
      api.boardPatients.mockResolvedValue(board(patients));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.shadowBoard.mockResolvedValue(shadow);
    } },
  );
  await act(async () => { view.board.start(); });
  await flush();
  await act(async () => { view.stream.open(); });
  await flush();
  await act(async () => { view.shadow.start(PERMS); });
  await flush();
  // A click is the gesture the browser wants before it plays anything: this one also starts the sound.
  fireEvent.click(screen.getByRole("button", { name: "Risk sırası" }));
  await flush();
  expect(screen.queryByRole("button", { name: WAITING })).toBeNull();
  const boardBefore = view.board.getState();
  for (let i = 0; i < 9; i += 1) {
    act(() => { vi.advanceTimersByTime(5000); view.stream.heartbeat(); });
    await flush();
  }
  act(() => { page.setHidden(true); });
  await flush();

  const state = view.board.getState();
  const cardsInOrder = screen.getAllByRole("link", { name: /xəstəsini aç$/ }).map((a) => a.getAttribute("aria-label"));
  const waitingLine = screen.getByText(/Cavab gözləyən siqnal/).textContent;
  const out = {
    pulses: audio.pulses(),
    audible: audio.audible().length,
    notifications: notes.shown.map((n) => [n.title, n.body, n.options.tag, n.closed]),
    signals: screen.getByTestId("signals").textContent,
    alarmsToSignal: alarmsToSignal(state),
    waitingAlarms: waitingAlarms(state),
    alarmCounts: alarmCounts(state),
    lockSummary: lockSummary(state),
    board: JSON.stringify({ patients: state.patients, alerts: state.alerts, connection: state.connection, loaded: state.loaded }),
    boardUntouchedByPolls: state === boardBefore,
    cardsInOrder,
    waitingLine,
    shadowAsked: view.api.shadowBoard.mock.calls.length,
    strips: document.querySelectorAll("[data-monitor-strip]").length,
  };
  cleanup();
  page.undo();
  page = null;
  resetScreens();
  vi.useRealTimers();
  localStorage.clear();
  return out;
}

describe("the monitor strip never reaches the alarm path", () => {
  it("gives the alarm path identical inputs and outputs with the strip off or full of alarming values", async () => {
    const off = await run({ shadow: STAGE_OFF });
    const on = await run({ shadow: ALARMING });
    // Not vacuous: the alarm sounded, a notification was raised, the board was LIVE with two waiting
    // alarms, and in B the strip was really polled and drawn.
    expect(off.pulses.length).toBeGreaterThan(0);
    expect(off.notifications.length).toBeGreaterThan(0);
    expect(off.waitingAlarms.known).toBe(true);
    expect(off.waitingAlarms.items).toHaveLength(2);
    expect(on.shadowAsked).toBe(10);
    expect(on.strips).toBe(4);
    expect(off.strips).toBe(0);
    expect(on.boardUntouchedByPolls).toBe(true);
    for (const key of ["pulses", "audible", "notifications", "signals", "alarmsToSignal", "waitingAlarms", "alarmCounts",
      "lockSummary", "board", "cardsInOrder", "waitingLine"]) {
      expect(on[key], key).toEqual(off[key]);
    }
  });

  it("the harness sees a real difference: one more critical alarm changes what the alarm path says", async () => {
    const off = await run({ shadow: STAGE_OFF });
    const more = await run({
      shadow: STAGE_OFF,
      patients: [...WARD, reaBed("S-004", "REA-01 · 4", [alarm("septic_shock", "critical")])],
    });
    expect(more.waitingAlarms).not.toEqual(off.waitingAlarms);
    expect(more.alarmCounts).not.toEqual(off.alarmCounts);
    expect(more.notifications).not.toEqual(off.notifications);
    expect(more.cardsInOrder).not.toEqual(off.cardsInOrder);
  });
});

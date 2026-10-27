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
import { NOW, ago, alarm, board, entry, identity, measured } from "../../data/board.testutil.js";
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

const reaBed = (id, bedLabel, alarms, shadow) => entry(id, alarms, {
  identity: identity({ patient_id: id, bed_label: bedLabel, bed_id: bedLabel.replace(" · ", "-") }), at: measured(30),
  ...(shadow === undefined ? {} : { shadow }),
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

// Aşama B: the shadow engine's picture of a monitor-linked patient, as alarming as it gets — a NEWS2 of
// 13 and two CRITICAL findings that only the shadow opened, on the monitor's HR 180 / SpO2 70. It is
// advice with every alarm off: none of it may reach the sound, the notification, the bell or the lock.
const SHADOW_FINDING = (kind) => ({
  kind, severity: "critical", urgency: "immediate", summary: `${kind} on the monitor's inputs`, evidence: [],
  relation: "shadow_only", stale_inputs: [], downgraded: false, since: ago(120),
});
const ALARMING_SHADOW = {
  news2: { total: 13, partial: true, missing: ["respiration_rate", "temperature"], stale: [], assumed: ["air_or_oxygen", "consciousness"],
    breakdown: { pulse: 3, spo2: 3 }, red_param: true, measured_at: { pulse: ago(5), spo2: ago(5) }, fresh_until: {} },
  vitals: {
    heart_rate: { value: 180, unit: "bpm", at: ago(5), source: "monitor", via: "hr" },
    spo2: { value: 70, unit: "%", at: ago(5), source: "monitor", via: "spo2" },
  },
  findings: [SHADOW_FINDING("septic_shock"), SHADOW_FINDING("news2")],
};
const SHADOWED_WARD = [
  reaBed("S-001", "REA-01 · 1", [alarm("septic_shock", "critical")], ALARMING_SHADOW),
  reaBed("S-002", "REA-01 · 2", [alarm("news2", "high")]),
  reaBed("S-003", "REA-01 · 3", [], ALARMING_SHADOW),
];

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
  // What every patient card SHOWS — its risk pill, its rail, its alarms, its vitals, its NEWS2 —
  // as markup, with the monitor's own slot taken out (B has one on a linked card, A none) and the
  // per-mount ids React's useId hands out (they differ between two mounts) set aside.
  const cards = screen.getAllByRole("link", { name: /xəstəsini aç$/ }).map((a) => {
    const card = a.closest("li").cloneNode(true);
    for (const slot of card.querySelectorAll("[data-monitor-slot]")) slot.remove();
    for (const el of [card, ...card.querySelectorAll("*")]) {
      for (const attr of ["id", "aria-labelledby", "aria-describedby", "aria-controls"]) el.removeAttribute(attr);
    }
    return card.outerHTML;
  });
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
    // The board with each card's shadow taken out: what the alarm path could read besides it.
    boardSansShadow: JSON.stringify({
      patients: state.patients.map(({ shadow: _shadow, ...rest }) => rest),
      alerts: state.alerts, connection: state.connection, loaded: state.loaded,
    }),
    shadowCards: state.patients.filter((p) => p.shadow).length,
    shadowTags: document.querySelectorAll("[data-shadow-tag]").length,
    boardUntouchedByPolls: state === boardBefore,
    cardsInOrder,
    cards,
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
      "lockSummary", "board", "cardsInOrder", "cards", "waitingLine"]) {
      expect(on[key], key).toEqual(off[key]);
    }
    expect(on.cards).toHaveLength(3);
    expect(on.cards[0]).toMatch(/data-rail=/);                 // the comparison holds the rail and the pill
  });

  it("gives the alarm path identical inputs and outputs with or without the shadow engine's critical shadow-only findings", async () => {
    const plain = await run({ shadow: STAGE_OFF });
    const shadowed = await run({ patients: SHADOWED_WARD, shadow: { ...ALARMING, stage: "rules" } });
    // Not vacuous: the shadow reached the board's cards and was drawn on two beds, beside a strip that
    // was polled at the rules stage.
    expect(plain.shadowCards).toBe(0);
    expect(shadowed.shadowCards).toBe(2);
    expect(plain.shadowTags).toBe(0);
    expect(shadowed.shadowTags).toBe(2);
    expect(shadowed.shadowAsked).toBe(10);
    expect(plain.pulses.length).toBeGreaterThan(0);
    expect(plain.notifications.length).toBeGreaterThan(0);
    expect(plain.waitingAlarms.items).toHaveLength(2);
    for (const key of ["pulses", "audible", "notifications", "signals", "alarmsToSignal", "waitingAlarms", "alarmCounts",
      "lockSummary", "boardSansShadow", "cardsInOrder", "cards", "waitingLine"]) {
      expect(shadowed[key], key).toEqual(plain[key]);
    }
    expect(shadowed.board).not.toEqual(plain.board);            // the harness does see the shadow on the board
    expect(shadowed.boardUntouchedByPolls).toBe(true);
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

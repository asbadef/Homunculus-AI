// The alarm sound and the critical-alarm notification on the page, over a real session store and a
// real board store on a fake API (mount.testutil.jsx). What the previous workspace did is the
// reference (ClinicalDemo.jsx 4242-4320 and clinicalAudio.js, e4cdf15); what it never had to do —
// sound through a lock, stop at sign-out — is new, and is held here. jsdom has no Web Audio and no
// Notification: fakeAudio.testutil.js records what was asked of them. Synthetic patients only.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { mount } from "../session/mount.testutil.jsx";
import { alarm, board, entry, identity } from "../data/board.testutil.js";
import { useAlarmSignals } from "./AlarmSignals.jsx";
import { fakeAudio, fakeNotifications, onPage } from "./fakeAudio.testutil.js";

const realSetTimeout = globalThis.setTimeout;
const flush = () => act(() => new Promise((resolve) => { realSetTimeout(resolve, 0); }));
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const WAITING = "Siqnal səsi gözləmədədir — açmaq üçün klikləyin";

let page = null;
afterEach(() => {
  page?.undo();
  page = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

function Probe() {
  const { sound, notify, askNotify } = useAlarmSignals();
  return (
    <>
      <p data-testid="signals">{`${sound} ${notify}`}</p>
      <button type="button" onClick={askNotify}>ask</button>
    </>
  );
}

const reaBed = (id, alarms, over = {}) => entry(id, alarms, { identity: identity({ patient_id: id, bed_label: "REA-01 · 2" }), ...over });

/** A LIVE ward, with the sound wanted (or not) and notifications allowed (or not). Fake timers are
 *  installed first, as the house recipe says (amendments, useRetryHold), so the repeat is driven. */
async function ward(patients, { sound = true, permission = "granted", secure = true, load } = {}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  if (sound) localStorage.setItem("hmc.alarmSound", "on");
  const audio = fakeAudio();
  const notes = fakeNotifications(permission);
  page = onPage({ AudioContext: audio.AudioContext, Notification: notes.Notification, secure });
  const view = await mount(<Probe />, { setup: (api) => {
    if (load) load(api);
    else api.boardPatients.mockResolvedValue(board(patients));
    api.streamTicket.mockResolvedValue({ ticket: "t-1" });
  } });
  await act(async () => { view.board.start(); });
  await flush();
  await act(async () => { view.stream.open(); });
  await flush();
  return { ...view, audio, notes };
}

const state = () => screen.getByTestId("signals").textContent;

describe("the alarm sound", () => {
  it("is off unless someone turned it on — a critical alarm plays nothing", async () => {
    const { audio } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])], { sound: false });
    fireEvent.click(document.body);
    await flush();
    expect(state()).toBe("off granted");
    expect(audio.pulses()).toEqual([]);
    expect(screen.queryByRole("button", { name: WAITING })).toBeNull();
  });

  it("waits for a click, says so, then plays the worst waiting pattern", async () => {
    const { audio } = await ward([
      reaBed("S-001", [alarm("news2", "high")]), reaBed("S-002", [alarm("septic_shock", "critical")]),
    ]);
    expect(state()).toBe("waiting granted");
    expect(audio.pulses()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: WAITING }));
    await flush();
    expect(state()).toBe("on granted");
    expect(audio.pulses()).toEqual(Array(10).fill(960));
    expect(screen.queryByRole("button", { name: WAITING })).toBeNull();
  });

  it("is started by any key press too — typing the unlock password counts", async () => {
    const { audio } = await ward([reaBed("S-001", [alarm("news2", "high")])]);
    fireEvent.keyDown(document.body, { key: "a" });
    await flush();
    expect(audio.pulses()).toEqual([640, 640, 640]);
  });

  it("stops when the alarm is answered", async () => {
    const { audio, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical", { acknowledged: true, acknowledged_by: "ayse" })])); });
    tick(10000);
    expect(audio.pulses()).toHaveLength(10);
  });

  it("goes on through a lock — the shell is gone, the alarm is not", async () => {
    const { audio, store } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    await act(async () => { store.lock(); });
    tick(2500);
    expect(audio.pulses()).toHaveLength(20);
  });

  it("stops when the session ends", async () => {
    const { audio, store } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    await act(async () => { store.signOut(); });
    await flush();
    tick(10000);
    expect(audio.pulses()).toHaveLength(10);
  });

  it("goes on with what the board last had when the stream drops — as the old store did", async () => {
    const { audio, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    act(() => { stream.drop(); });
    tick(2500);
    expect(audio.pulses()).toHaveLength(20);
  });

  it("plays nothing for a board that cannot say what is open", async () => {
    const { audio } = await ward([], { load: (api) => api.boardPatients.mockRejectedValue(new Error("down")) });
    fireEvent.click(document.body);
    await flush();
    expect(state()).toBe("on granted");
    expect(audio.pulses()).toEqual([]);
  });

  it("follows another tab of this browser turning it off", async () => {
    const { audio } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    localStorage.setItem("hmc.alarmSound", "off");
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "hmc.alarmSound", newValue: "off" })); });
    tick(10000);
    expect(state()).toBe("off granted");
    expect(audio.pulses()).toHaveLength(10);
  });
});

describe("the critical-alarm notification", () => {
  it("is raised once per critical alarm while the page is in the background, naming its bed", async () => {
    const { notes, stream } = await ward([
      reaBed("S-001", [alarm("septic_shock", "critical")]), reaBed("S-002", [alarm("news2", "high")]),
    ], { sound: false });
    expect(notes.shown).toHaveLength(0);                 // the page is in front: the screen says it
    act(() => { page.setHidden(true); });
    expect(notes.shown).toHaveLength(1);
    expect(notes.shown[0].title).toBe("Kritik siqnal");
    expect(notes.shown[0].body).toBe("REA-01 · 2 — cavab gözləyən kritik siqnal");
    expect(notes.shown[0].options.requireInteraction).toBe(true);
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical")], { risk: "critical" })); });
    expect(notes.shown).toHaveLength(1);                 // the same alarm: not again
  });

  // Over a board whose stream has dropped: a LIVE board would close the bed's notification anyway
  // (the alarm's key is not wanted while locked), so only a DEGRADED one shows that the LOCK does it.
  it("names no bed while the screen is locked — the one that did is closed at the lock", async () => {
    const { notes, store, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])], { sound: false });
    act(() => { page.setHidden(true); });
    act(() => { stream.drop(); });
    await act(async () => { store.lock(); });
    expect(notes.shown[0].closed).toBe(true);
    expect(notes.open()).toHaveLength(1);
    expect(notes.open()[0].body).toBe("Cavab gözləyən kritik siqnal var. Ətraflı məlumat üçün ekranın kilidini açın.");
    expect(document.body).not.toHaveTextContent("REA-01");
  });

  it("is closed when a LIVE board says the alarm was answered, and all of them when the session ends", async () => {
    const { notes, stream, store } = await ward([
      reaBed("S-001", [alarm("septic_shock", "critical")]), reaBed("S-002", [alarm("septic_shock", "critical")]),
    ], { sound: false });
    act(() => { page.setHidden(true); });
    expect(notes.open()).toHaveLength(2);
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical", { acknowledged: true })])); });
    expect(notes.open()).toHaveLength(1);
    await act(async () => { store.signOut(); });
    expect(notes.open()).toHaveLength(0);
  });

  it("asks for permission only when asked, and says what the browser answered", async () => {
    const { notes } = await ward([], { sound: false, permission: "default" });
    expect(state()).toBe("off default");
    expect(notes.Notification.requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    await flush();
    expect(state()).toBe("off granted");
  });

  it("says so when the page is not on a secure address, where the browser refuses notifications", async () => {
    await ward([], { sound: false, permission: "default", secure: false });
    expect(state()).toBe("off insecure");
  });
});

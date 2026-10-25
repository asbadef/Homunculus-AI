// The alarm sound and the critical-alarm notification on the page, over a real session store and a
// real board store on a fake API (mount.testutil.jsx). What the previous workspace did is the
// reference (ClinicalDemo.jsx 4242-4320 and clinicalAudio.js, e4cdf15); what it never had to do —
// sound through a lock, stop at sign-out — is new, and is held here. jsdom has no Web Audio and no
// Notification: fakeAudio.testutil.js records what was asked of them. Synthetic patients only.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { mount } from "../session/mount.testutil.jsx";
import { ago, alarm, board, entry, identity } from "../data/board.testutil.js";
import { ANNOUNCE_DELAY_MS, Modal } from "../ui/index.js";
import { alarmTag, useAlarmSignals } from "./AlarmSignals.jsx";
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

/** The provider's state, and a stand-in for the shell's `<main id="main">` (Shell.jsx), where
 *  focus goes when the waiting button it had is gone. */
function Probe() {
  const { sound, notify, askNotify } = useAlarmSignals();
  return (
    <main id="main" tabIndex={-1}>
      <p data-testid="signals">{`${sound} ${notify}`}</p>
      <button type="button" onClick={askNotify}>ask</button>
    </main>
  );
}

const reaBed = (id, alarms, over = {}) => entry(id, alarms, { identity: identity({ patient_id: id, bed_label: "REA-01 · 2" }), ...over });

/** A LIVE ward, with the sound wanted (or not) and notifications allowed (or not). Fake timers are
 *  installed first, as the house recipe says (amendments, useRetryHold), so the repeat is driven.
 *  `open: false` leaves the stream unopened: the board has loaded and is still CONNECTING.
 *  `notifications: false` is a browser with no Notification at all. `dialog: true` opens a Modal
 *  over the page (which makes the rest of it inert). */
async function ward(patients, {
  sound = true, permission = "granted", secure = true, load, open = true, notifications = true, dialog = false,
} = {}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  if (sound) localStorage.setItem("hmc.alarmSound", "on");
  const audio = fakeAudio();
  const notes = fakeNotifications(permission);
  page = onPage({ AudioContext: audio.AudioContext, Notification: notifications ? notes.Notification : undefined, secure });
  const ui = (
    <>
      <Probe />
      {dialog ? <Modal open title="Pəncərə" onClose={() => {}}><p>sintetik</p></Modal> : null}
    </>
  );
  const view = await mount(ui, { setup: (api) => {
    if (load) load(api);
    else api.boardPatients.mockResolvedValue(board(patients));
    api.streamTicket.mockResolvedValue({ ticket: "t-1" });
  } });
  await act(async () => { view.board.start(); });
  await flush();
  if (open) {
    await act(async () => { view.stream.open(); });
    await flush();
  }
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

  // G2-A1 (O17): the condition passed, nobody has acknowledged it yet — the screens keep it, the
  // speaker does not.
  it("stops when the alarm's condition passes, though it still waits for an answer", async () => {
    const { audio, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical", { resolved_at: ago(1) })])); });
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

  // An audio-device change (a headset plugged in, a USB speaker gone) or Safari's "interrupted"
  // suspends the context and resumes it — possibly within one React batch, so the page sees no
  // change at all. The pill went on saying "ready" over a silent critical alarm.
  it("sounds again when the browser suspends and resumes the audio in one go", async () => {
    const { audio } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    const context = audio.contexts[0];
    act(() => { context.suspend(); context.resume(); });
    tick(10000);
    expect(state()).toBe("on granted");
    expect(audio.pulses()).toHaveLength(60);
  });

  // The old build sounded its first load; this board loads, then opens its stream, and is
  // CONNECTING until the stream's reload lands — one round trip, or 45 s if the stream never opens.
  it("sounds and notifies the first load, before the stream has opened", async () => {
    const { audio, notes, board: store } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])], { open: false });
    expect(store.getState().connection).toBe("connecting");
    fireEvent.click(document.body);
    await flush();
    expect(audio.pulses()).toEqual(Array(10).fill(960));
    act(() => { page.setHidden(true); });
    expect(notes.shown.map((n) => n.body)).toEqual(["REA-01 · 2 — cavab gözləyən kritik siqnal"]);
  });

  it("says out loud that the sound is waiting, and leaves focus somewhere sensible when its button goes", async () => {
    await ward([reaBed("S-001", [alarm("news2", "high")])]);
    tick(ANNOUNCE_DELAY_MS);
    expect(screen.getAllByRole("status").map((el) => el.textContent)).toContain(WAITING);
    const button = screen.getByRole("button", { name: WAITING });
    button.focus();
    fireEvent.click(button);
    await flush();
    expect(screen.queryByRole("button", { name: WAITING })).toBeNull();
    expect(document.activeElement).toBe(document.getElementById("main"));
  });

  // A modal makes the rest of the page inert (ui/Modal.jsx), the button with it: drawn above the
  // scrim it would be a control nobody can use. It hides while a dialog is open, as the toasts move
  // (ui/Toast.jsx, the same body attribute). jsdom applies no CSS, so the rule itself is pinned.
  it("hides the waiting button while a dialog is open", async () => {
    await ward([reaBed("S-001", [alarm("news2", "high")])]);
    const holder = screen.getByRole("button", { name: WAITING }).parentElement;
    expect(holder.className.split(/\s+/)).toContain("[body[data-modal-open]_&]:hidden");
  });

  // ...but its words are still said: an inert region is dropped from the accessibility tree, so the
  // line lives where the toasts do — outside the page, exempt from the dialog's inert.
  it("keeps saying the sound is waiting while a dialog holds the page inert", async () => {
    await ward([reaBed("S-001", [alarm("news2", "high")])], { dialog: true });
    tick(ANNOUNCE_DELAY_MS);
    const region = screen.getAllByRole("status").find((el) => el.textContent === WAITING);
    expect(region).toBeDefined();
    expect(region.closest("[inert]")).toBeNull();
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

  // Two tabs of the ward PC each raise their own: the tag makes the browser replace one with the
  // other instead of stacking them, as the old build's did. The locked one has a tag of its own,
  // which names no alarm.
  it("tags each notification so the browser replaces it rather than repeating it", async () => {
    const { notes, store, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])], { sound: false });
    act(() => { page.setHidden(true); });
    expect(notes.shown[0].options.tag).toBe(alarmTag(`S-001::septic_shock::${ago(247)}`));   // its episode (G2-A1)
    act(() => { stream.drop(); });
    await act(async () => { store.lock(); });
    expect(notes.open().map((n) => n.options.tag)).toEqual(["homunculus-alarm:locked"]);
  });

  // The tag is the same in every tab (so they still collapse to one), but it is a hash of the
  // alarm's key, never the key: the key carries the patient id (`<patient_id>::<kind>`), and
  // Decision 21 kept the patient id out of what the page hands the operating system.
  it("gives the tag no patient id: a hash of the alarm's key, the same in every tab", () => {
    const tag = alarmTag("S-001::septic_shock");
    expect(tag).toMatch(/^homunculus-alarm:[0-9a-f]{8}$/);
    expect(tag).not.toContain("S-001");
    expect(alarmTag("S-001::septic_shock")).toBe(tag);
    expect(alarmTag("S-002::septic_shock")).not.toBe(tag);
  });

  // G2-A1 (O17): a critical whose condition passed still waits for its answer — the notification it
  // has stays — but it vibrates no more, so it raises none of its own.
  it("keeps the notification of an alarm whose condition passed, and raises none for one that passed unseen", async () => {
    const { notes, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])], { sound: false });
    act(() => { page.setHidden(true); });
    expect(notes.open()).toHaveLength(1);
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical", { resolved_at: ago(1) })])); });
    expect(notes.open()).toHaveLength(1);
    act(() => { stream.frame(reaBed("S-002", [alarm("septic_shock", "critical", { resolved_at: ago(1) })])); });
    expect(notes.shown).toHaveLength(1);
  });

  // The lock screen's one generic notification is raised for what still rings, not for what merely
  // waits: a locked ward whose only alarm passed unacknowledged says nothing — and goes on to say it
  // the moment a critical fires.
  it("raises no locked-screen notification for a ward whose only alarm passed unacknowledged", async () => {
    const { notes, store, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical", { resolved_at: ago(1) })])], { sound: false });
    act(() => { page.setHidden(true); });
    await act(async () => { store.lock(); });
    expect(notes.shown).toHaveLength(0);
    act(() => { stream.frame(reaBed("S-002", [alarm("septic_shock", "critical")])); });
    expect(notes.open().map((n) => n.options.tag)).toEqual(["homunculus-alarm:locked"]);
  });

  // A critical that cleared and fired again is a new episode: a new notification under a tag of its
  // own, so the browser shows it again instead of replacing the old one without a sound.
  it("raises a new notification, under a tag of its own, when an alarm fires again as a new episode", async () => {
    const { notes, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])], { sound: false });
    act(() => { page.setHidden(true); });
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical", { first_seen_at: ago(5) })])); });
    expect(notes.shown).toHaveLength(2);
    expect(notes.shown[0].closed).toBe(true);
    expect(notes.shown[1].options.tag).not.toBe(notes.shown[0].options.tag);
  });

  // Closed from outside — the user, the operating system, another tab closing the same tag as it
  // went: the page forgets it raised it, so an alarm still waiting is raised again on the board's
  // next change while the page is in the background.
  it("raises a notification again on the next change when something else closed it and the alarm still waits", async () => {
    const { notes, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])], { sound: false });
    act(() => { page.setHidden(true); });
    expect(notes.shown).toHaveLength(1);
    act(() => { notes.shown[0].dismiss(); });
    expect(notes.open()).toHaveLength(0);
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical")], { risk: "critical" })); });
    expect(notes.shown).toHaveLength(2);
    expect(notes.open()).toHaveLength(1);
  });

  it("closes every notification it raised when the page goes away — none outlives it", async () => {
    const { notes } = await ward([
      reaBed("S-001", [alarm("septic_shock", "critical")]), reaBed("S-002", [alarm("septic_shock", "critical")]),
    ], { sound: false });
    act(() => { page.setHidden(true); });
    expect(notes.open()).toHaveLength(2);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(notes.open()).toHaveLength(0);
  });

  it("reads the browser's permission again when the page comes back to the front", async () => {
    const { notes } = await ward([], { sound: false, permission: "default" });
    expect(state()).toBe("off default");
    notes.Notification.permission = "denied";              // changed in the browser's site settings
    act(() => { page.setHidden(true); });
    act(() => { page.setHidden(false); });
    expect(state()).toBe("off denied");
  });

  it("says the address is not secure, not that the browser cannot, on a plain-HTTP page", async () => {
    await ward([], { sound: false, secure: false, notifications: false });
    expect(state()).toBe("off insecure");
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

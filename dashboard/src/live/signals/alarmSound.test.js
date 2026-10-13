// The alarm sound, ported from the previous workspace's clinicalAudio.js (e4cdf15) with its numbers
// unchanged — what a ward has been hearing on the VM's build. jsdom has no Web Audio: a fake context
// records every tone (fakeAudio.testutil.js), and fake timers stand in for the repeat.
import { describe, it, expect, vi, afterEach } from "vitest";
import { PROFILES, createAlarmSound } from "./alarmSound.js";
import { fakeAudio } from "./fakeAudio.testutil.js";

afterEach(() => {
  vi.useRealTimers();
});

const timers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });

async function running() {
  const audio = fakeAudio();
  const sound = createAlarmSound({ win: { AudioContext: audio.AudioContext } });
  await sound.resume();
  return { audio, sound };
}

describe("the three patterns", () => {
  it("are the previous workspace's, number for number", () => {
    expect(PROFILES.critical).toEqual({ freq: 960, pulses: 10, pulseMs: 150, gapMs: 100, repeatMs: 2500, vol: 0.5, groupAfter: 5, groupGapMs: 350 });
    expect(PROFILES.high).toEqual({ freq: 640, pulses: 3, pulseMs: 180, gapMs: 150, repeatMs: 12000, vol: 0.4, groupAfter: 0, groupGapMs: 0 });
    expect(PROFILES.moderate).toEqual({ freq: 500, pulses: 3, pulseMs: 200, gapMs: 220, repeatMs: 20000, vol: 0.3, groupAfter: 0, groupGapMs: 0 });
    expect(Object.isFrozen(PROFILES) && Object.isFrozen(PROFILES.critical)).toBe(true);
  });
});

describe("createAlarmSound", () => {
  it("says so when the browser has no Web Audio, and does nothing", async () => {
    const sound = createAlarmSound({ win: {} });
    expect(sound.state()).toBe("unsupported");
    expect(await sound.resume()).toBe(false);
    expect(sound.play("critical")).toBe(false);
    expect(sound.playing()).toBeNull();
  });

  it("plays nothing before a gesture has started the audio: the context is suspended", () => {
    const audio = fakeAudio();
    const sound = createAlarmSound({ win: { AudioContext: audio.AudioContext } });
    expect(sound.state()).toBe("suspended");
    expect(sound.play("critical")).toBe(false);
    expect(audio.pulses()).toEqual([]);
  });

  it("plays a critical burst of ten pulses at 960 Hz, five and five, and repeats it every 2.5 s", async () => {
    timers();
    const { audio, sound } = await running();
    expect(sound.play("critical")).toBe(true);
    expect(sound.playing()).toBe("critical");
    expect(audio.pulses()).toEqual(Array(10).fill(960));
    const starts = audio.contexts[0].oscillators.map((o) => o.startAt);
    // 250 ms apart, and the old build's group gap (350 ms more) after the fifth.
    expect(starts[1] - starts[0]).toBeCloseTo(0.25);
    expect(starts[5] - starts[4]).toBeCloseTo(0.6);
    vi.advanceTimersByTime(2499);
    expect(audio.pulses()).toHaveLength(10);
    vi.advanceTimersByTime(1);
    expect(audio.pulses()).toHaveLength(20);
  });

  it("does not restart a pattern already playing, and switches to another one", async () => {
    timers();
    const { audio, sound } = await running();
    sound.play("high");
    sound.play("high");
    expect(audio.pulses()).toEqual([640, 640, 640]);
    sound.play("moderate");
    expect(audio.pulses()).toEqual([640, 640, 640, 500, 500, 500]);
    vi.advanceTimersByTime(12000);                     // the old high repeat is gone
    expect(audio.pulses()).toHaveLength(6);
    vi.advanceTimersByTime(8000);                      // the moderate one comes every 20 s
    expect(audio.pulses()).toHaveLength(9);
  });

  it("stops: no more bursts", async () => {
    timers();
    const { audio, sound } = await running();
    sound.play("critical");
    sound.stop();
    expect(sound.playing()).toBeNull();
    vi.advanceTimersByTime(10000);
    expect(audio.pulses()).toHaveLength(10);
  });

  it("treats a pattern it does not know as silence, and stops what was playing", async () => {
    const { audio, sound } = await running();
    sound.play("critical");
    expect(sound.play("loud")).toBe(false);
    expect(sound.playing()).toBeNull();
    expect(audio.pulses()).toHaveLength(10);
  });

  it("tells the page when the browser suspends the audio, and stops", async () => {
    const audio = fakeAudio();
    const changes = [];
    const sound = createAlarmSound({ win: { AudioContext: audio.AudioContext }, onState: (s) => changes.push(s) });
    await sound.resume();
    sound.play("high");
    await audio.contexts[0].suspend();
    expect(changes).toEqual(["running", "suspended"]);
    expect(sound.playing()).toBeNull();
  });

  // An audio-device change, or Safari's "interrupted", suspends the context and gives it back. The
  // page may see both in one React batch — nothing changed, as far as it can tell — so the engine
  // itself must remember what it was asked to play and sound it again.
  it("sounds the wanted pattern again when the browser gives the audio back", async () => {
    timers();
    const { audio, sound } = await running();
    sound.play("critical");
    const context = audio.contexts[0];
    context.suspend();
    expect(sound.playing()).toBeNull();
    context.resume();
    expect(sound.playing()).toBe("critical");
    expect(audio.pulses()).toHaveLength(20);
    vi.advanceTimersByTime(2500);
    expect(audio.pulses()).toHaveLength(30);
  });

  it("does not bring back a pattern it was told to stop", async () => {
    timers();
    const { audio, sound } = await running();
    sound.play("critical");
    sound.stop();
    audio.contexts[0].suspend();
    audio.contexts[0].resume();
    vi.advanceTimersByTime(10000);
    expect(audio.pulses()).toHaveLength(10);
    expect(sound.playing()).toBeNull();
  });

  // A burst is scheduled ahead (a critical one lasts ~2.8 s): clearing the timer alone left the
  // pulses already scheduled to play on after an acknowledgement or a sign-out.
  it("stops at once: the pulses already scheduled are cut off too", async () => {
    timers();
    const { audio, sound } = await running();
    sound.play("critical");
    expect(audio.audible()).toHaveLength(10);
    sound.stop();
    expect(audio.audible()).toHaveLength(0);
    sound.play("high");
    expect(audio.audible()).toHaveLength(3);
    sound.play("moderate");                            // a switch cuts the old pattern's pulses too
    expect(audio.audible().map((o) => o.frequency.value)).toEqual([500, 500, 500]);
  });

  // A browser fires "statechange" when a closed context reaches "closed" — after `close()` has let
  // the context go. That late event must find nothing to do, not a null to read.
  it("ignores the state changes of a context it has closed", async () => {
    const audio = fakeAudio();
    const changes = [];
    const sound = createAlarmSound({ win: { AudioContext: audio.AudioContext }, onState: (s) => changes.push(s) });
    await sound.resume();
    const context = audio.contexts[0];
    sound.close();
    context.state = "closed";
    expect(() => context.onstatechange()).not.toThrow();
    expect(changes).toEqual(["running"]);                // nothing reported for a context let go
  });

  it("plays one burst on request — the settings screen's test — and nothing after it", async () => {
    timers();
    const { audio, sound } = await running();
    expect(sound.test()).toBe(true);
    expect(audio.pulses()).toEqual(Array(10).fill(960));
    vi.advanceTimersByTime(10000);
    expect(audio.pulses()).toHaveLength(10);
    expect(sound.playing()).toBeNull();
  });
});

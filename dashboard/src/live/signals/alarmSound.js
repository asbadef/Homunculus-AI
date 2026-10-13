// src/live/signals/alarmSound.js — the alarm sound, synthesised in the browser (Web Audio).
//
// A port of the previous workspace's clinicalAudio.js (G1-16 removed it; readable at e4cdf15), with
// its numbers unchanged: it is what a ward has been hearing on the VM's build. No sound file — each
// pattern is square-wave pulses in IEC 60601-1-8's burst structure: critical, ten pulses (five and
// five) every 2.5 s; high, three every 12 s; moderate, three every 20 s. Which pattern plays, and
// when, is decided elsewhere (signals.js, AlarmSignals.jsx); this only makes the noise.
//
// Two differences from the old module, both about saying what is true. It is an instance, not
// module state, so a test or a second page cannot inherit another's context. And it reports the
// context's state ("unsupported" | "suspended" | "running"): a browser starts audio only after a
// click or a key press, and a page that believed it was sounding while its context sat suspended
// would be the quietest failure this feature has.

export const PROFILES = Object.freeze({
  critical: Object.freeze({ freq: 960, pulses: 10, pulseMs: 150, gapMs: 100, repeatMs: 2500, vol: 0.5, groupAfter: 5, groupGapMs: 350 }),
  high: Object.freeze({ freq: 640, pulses: 3, pulseMs: 180, gapMs: 150, repeatMs: 12000, vol: 0.4, groupAfter: 0, groupGapMs: 0 }),
  moderate: Object.freeze({ freq: 500, pulses: 3, pulseMs: 200, gapMs: 220, repeatMs: 20000, vol: 0.3, groupAfter: 0, groupGapMs: 0 }),
});

/** `win` is the page's window (a test passes its own); `onState` hears the context's state change —
 *  a gesture started it, or the browser suspended it. */
export function createAlarmSound({ win = typeof window === "undefined" ? undefined : window, onState } = {}) {
  const AudioContextImpl = win?.AudioContext || win?.webkitAudioContext;
  let ctx = null;
  let master = null;
  let current = null;
  let timer = null;

  function state() {
    if (!AudioContextImpl) return "unsupported";
    return ctx?.state === "running" ? "running" : "suspended";
  }

  function context() {
    if (!AudioContextImpl) return null;
    if (!ctx) {
      ctx = new AudioContextImpl();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      ctx.onstatechange = () => {
        if (ctx.state !== "running") stop();
        onState?.(state());
      };
    }
    return ctx;
  }

  // One pulse: a fast attack, a short hold, a decay (the old module's envelope, unchanged).
  function pulse(at, profile) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = profile.freq;
    const duration = profile.pulseMs / 1000;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(profile.vol, at + 0.01);
    gain.gain.setValueAtTime(profile.vol, at + duration - 0.03);
    gain.gain.linearRampToValueAtTime(0, at + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  function burst(profile) {
    let at = ctx.currentTime + 0.02;
    for (let i = 0; i < profile.pulses; i += 1) {
      pulse(at, profile);
      at += (profile.pulseMs + profile.gapMs) / 1000;
      if (profile.groupAfter && i + 1 === profile.groupAfter) at += profile.groupGapMs / 1000;
    }
  }

  function stop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    current = null;
  }

  return {
    state,

    /** Start the audio. Call it from a click or a key press: browsers refuse it otherwise.
     *  Resolves true once the context is running. */
    async resume() {
      const c = context();
      if (!c) return false;
      try {
        await c.resume();
      } catch {
        // Refused (no gesture): the state says so.
      }
      return state() === "running";
    },

    /** Play a pattern until told otherwise; the same pattern again changes nothing. Returns whether
     *  it is sounding: never while the context is suspended, never for a pattern it does not know. */
    play(pattern) {
      const profile = PROFILES[pattern];
      if (!profile || state() !== "running") {
        stop();
        return false;
      }
      if (current === pattern) return true;
      stop();
      current = pattern;
      burst(profile);
      const again = () => {
        burst(profile);
        timer = setTimeout(again, profile.repeatMs);
      };
      timer = setTimeout(again, profile.repeatMs);
      return true;
    },

    stop,

    /** One critical burst and nothing after it: the settings screen's "test the sound". */
    test() {
      if (state() !== "running") return false;
      burst(PROFILES.critical);
      return true;
    },

    /** The pattern sounding now, or null. */
    playing: () => current,

    close() {
      stop();
      ctx?.close?.();
      ctx = null;
    },
  };
}

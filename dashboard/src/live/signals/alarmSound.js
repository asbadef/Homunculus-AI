// src/live/signals/alarmSound.js — the alarm sound, synthesised in the browser (Web Audio).
//
// A port of the previous workspace's clinicalAudio.js (G1-16 removed it; readable at e4cdf15), with
// its numbers unchanged: it is what a ward has been hearing on the VM's build. No sound file — each
// pattern is square-wave pulses in bursts: critical, ten pulses (five and five) every 2.5 s; high,
// three every 12 s; moderate, three every 20 s. The pattern is the PREVIOUS WORKSPACE'S, kept for
// parity; it was modelled on IEC 60601-1-8's burst structure but is not that standard's pattern and
// has not been reviewed against it (a critical burst lasts ~2.8 s and repeats every 2.5 s, so two
// bursts overlap) — a clinician or biomedical engineer's review is Group 2's (deferred.md). Which
// pattern plays, and when, is decided elsewhere (signals.js, AlarmSignals.jsx); this only makes the
// noise.
//
// Differences from the old module, each about saying what is true or stopping when told:
//   * It is an instance, not module state, so a test or a second page cannot inherit another's
//     context.
//   * It reports the context's state ("unsupported" | "suspended" | "running"): a browser starts
//     audio only after a click or a key press, and a page that believed it was sounding while its
//     context sat suspended would be the quietest failure this feature has.
//   * It remembers the pattern it was asked for (`wanted`) apart from what is sounding: when the
//     browser suspends the audio (an audio device changed, Safari's "interrupted") and gives it
//     back, the wanted pattern sounds again by itself — the page may see both changes in one React
//     batch, i.e. no change at all.
//   * Each play sounds through a gain node of its own, cut off when it stops: a burst is scheduled
//     ahead, and clearing the timer alone left up to ~2.8 s of pulses playing on after an
//     acknowledgement or a sign-out.

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
  let wanted = null;   // the pattern asked for, kept while the browser has the audio suspended
  let current = null;  // the pattern sounding now
  let voice = null;    // the gain node the current pattern's pulses go through
  let timer = null;

  function state() {
    if (!AudioContextImpl) return "unsupported";
    return ctx?.state === "running" ? "running" : "suspended";
  }

  function context() {
    if (!AudioContextImpl) return null;
    if (!ctx) {
      const created = new AudioContextImpl();
      ctx = created;
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      created.onstatechange = () => {
        // A context this engine has let go (`close`) still reports its way to "closed", later:
        // nothing here is about it any more.
        if (ctx !== created) return;
        if (created.state === "running") sound();
        else silence();
        onState?.(state());
      };
    }
    return ctx;
  }

  // One pulse: a fast attack, a short hold, a decay (the old module's envelope, unchanged).
  function pulse(at, profile, out) {
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
    gain.connect(out);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  function burst(profile, out) {
    let at = ctx.currentTime + 0.02;
    for (let i = 0; i < profile.pulses; i += 1) {
      pulse(at, profile, out);
      at += (profile.pulseMs + profile.gapMs) / 1000;
      if (profile.groupAfter && i + 1 === profile.groupAfter) at += profile.groupGapMs / 1000;
    }
  }

  /** Stop sounding — the pulses already scheduled included — and keep what was wanted. */
  function silence() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    current = null;
    voice?.disconnect();
    voice = null;
  }

  /** Sound the wanted pattern if the audio is running and it is not sounding already. Returns
   *  whether it is sounding. */
  function sound() {
    const profile = PROFILES[wanted];
    if (!profile || state() !== "running") return false;
    if (current === wanted) return true;
    silence();
    current = wanted;
    voice = ctx.createGain();
    voice.gain.value = 1;
    voice.connect(master);
    const out = voice;
    burst(profile, out);
    const again = () => {
      burst(profile, out);
      timer = setTimeout(again, profile.repeatMs);
    };
    timer = setTimeout(again, profile.repeatMs);
    return true;
  }

  /** Stop, and forget what was wanted: nothing comes back until something is played again. */
  function stop() {
    wanted = null;
    silence();
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
     *  it is sounding: never while the context is suspended (it is kept, and sounds once the
     *  browser runs the audio again), never for a pattern it does not know (that stops it). */
    play(pattern) {
      if (!PROFILES[pattern]) {
        stop();
        return false;
      }
      wanted = pattern;
      return sound();
    },

    stop,

    /** One critical burst and nothing after it: the settings screen's "test the sound". */
    test() {
      if (state() !== "running") return false;
      burst(PROFILES.critical, master);
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

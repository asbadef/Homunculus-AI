// Test-only: a Web Audio and a Notification that record what the page asked of them — jsdom has
// neither — and the window/document switches the alarm signals read. Synthetic; nothing plays.
import { vi } from "vitest";

/** A Web Audio stand-in. Every context starts "suspended", as a browser's does before a gesture;
 *  `resume()` makes it "running" — unless `refuse`, a browser that has seen no real gesture yet
 *  (a test's synthetic click is not one to a real browser). `pulses()` is the frequency of every
 *  tone scheduled so far, in order; `contexts` every context created. Each node records what it is
 *  connected to, so `audible()` is the tones that would still reach the speakers: the ones whose
 *  chain of connections ends at the context's destination (a disconnected node cuts it). */
export function fakeAudio({ refuse = false } = {}) {
  const contexts = [];
  const node = (extra = {}) => {
    const self = {
      target: null,
      connect(target) { self.target = target; },
      disconnect() { self.target = null; },
      ...extra,
    };
    return self;
  };
  const reaches = (start, destination) => {
    let at = start;
    for (let hop = 0; at && hop < 16; hop += 1) {
      if (at === destination) return true;
      at = at.target;
    }
    return false;
  };
  class FakeAudioContext {
    constructor() {
      this.state = "suspended";
      this.currentTime = 0;
      this.destination = { kind: "destination" };
      this.oscillators = [];
      this.onstatechange = null;
      contexts.push(this);
    }

    createGain() {
      return node({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} } });
    }

    createOscillator() {
      const osc = node({
        type: "sine",
        frequency: { value: 0 },
        start(at) { osc.startAt = at; },
        stop(at) { osc.stopAt = at; },
      });
      this.oscillators.push(osc);
      return osc;
    }

    resume() {
      if (refuse) return Promise.resolve();
      this.state = "running";
      this.onstatechange?.();
      return Promise.resolve();
    }

    suspend() {
      this.state = "suspended";
      this.onstatechange?.();
      return Promise.resolve();
    }

    close() {
      this.state = "closed";
      return Promise.resolve();
    }
  }
  return {
    AudioContext: FakeAudioContext,
    contexts,
    pulses: () => contexts.flatMap((c) => c.oscillators.map((o) => o.frequency.value)),
    audible: () => contexts.flatMap((c) => c.oscillators.filter((o) => reaches(o, c.destination))),
  };
}

/** A Notification stand-in with the browser's static `permission` and `requestPermission`.
 *  `shown` is every notification raised, `open()` those not closed since. Closing one fires its
 *  `onclose`, as a browser's does; `dismiss()` is a close from OUTSIDE the page — the user, the
 *  operating system, or another tab closing a notification of the same tag. */
export function fakeNotifications(permission = "granted", answer = "granted") {
  const shown = [];
  class FakeNotification {
    constructor(title, options = {}) {
      this.title = title;
      this.body = options.body;
      this.options = options;
      this.closed = false;
      this.onclose = null;
      shown.push(this);
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.onclose?.({ target: this });
    }

    dismiss() {
      this.close();
    }
  }
  FakeNotification.permission = permission;
  FakeNotification.requestPermission = vi.fn(async () => {
    FakeNotification.permission = answer;
    return answer;
  });
  return { Notification: FakeNotification, shown, open: () => shown.filter((n) => !n.closed) };
}

/** Put them on the page for one test; the returned function takes them off again. `hidden` is
 *  `document.hidden` — set it with `setHidden(true)` and a `visibilitychange` is dispatched, as the
 *  browser does when another window or tab comes to the front. */
export function onPage({ AudioContext, Notification, secure = true } = {}) {
  const had = {
    AudioContext: Object.getOwnPropertyDescriptor(window, "AudioContext"),
    Notification: Object.getOwnPropertyDescriptor(window, "Notification"),
    isSecureContext: Object.getOwnPropertyDescriptor(window, "isSecureContext"),
  };
  const put = (name, value) => Object.defineProperty(window, name, { configurable: true, writable: true, value });
  if (AudioContext) put("AudioContext", AudioContext);
  if (Notification) put("Notification", Notification);
  put("isSecureContext", secure);
  let hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  return {
    setHidden(value) {
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    undo() {
      for (const [name, descriptor] of Object.entries(had)) {
        if (descriptor) Object.defineProperty(window, name, descriptor);
        else delete window[name];
      }
      delete document.hidden;
    },
  };
}

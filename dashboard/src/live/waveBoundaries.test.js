// Dalga (live waveforms): the wave modules feed no alarm, make no sound and store nothing.
//
// This rule has its own file beside boundaries.test.js (the monitor strip's rule, which Lane A
// edits). It uses the same import reader (imports.testutil.js) and the same walk.
//
// THE ALARM PATH is every module that raises, answers, sounds or counts an alarm:
//   * signals/: the alarm sound and the critical-alarm notification;
//   * shell/: the bell, the rail badge and the menu. The screen registry shell/routes.js is the one
//     exception, for the reason given below;
//   * auth/LockScreen.jsx: the lock screen's counts;
//   * data/boardStore.js and data/BoardProvider.jsx: the board all of the above read, and
//     `acknowledge`;
//   * screens/alarms/: the alarms screen, where an alarm is acknowledged. The plan's first list
//     left this out. A wave module could not reach it unseen, since it imports the board's
//     provider, but the old list would not have seen it import a wave module.
//
// THE WAVE MODULES are the five below, and their words i18n/strings/waves.js. Every module under
// src/live/ whose name starts with "wave" must be listed here, so a new one cannot slip past.
//
// Both directions hold through any chain of imports:
//   * No alarm-path module reaches a wave module. This walk stops at the registry: the registry
//     imports every screen, including the patient and device screens that show the waves, only so
//     that the router can draw them.
//   * No wave module reaches an alarm-path module. This walk does NOT stop at the registry: a wave
//     module that imported it would reach every screen and the board behind them.
//   * The words are the one exception. Every module reaches them through the i18n catalogue, so
//     they must import nothing, only the catalogue may import them, and no alarm-path module may
//     name a `waves.` key.
//
// What the wave modules hold gives two ways into the alarm path that no import shows. The panel
// holds the session store (`useSession`), and the wave store holds the session's API client:
//   * the client acknowledges alarms (`acknowledge`, POST /ack);
//   * the session's `signOut` and `cancel` end the session, which stops the alarm sound at once;
//   * its `lock` closes the notifications that name a bed;
//   * the alarm sound's on/off is a browser preference (prefs.js, `hmc.alarmSound`).
// So, read as text (comments are skipped, so a comment may say "no sound"), the wave modules name:
//   * no sound, speech, vibration or notification API (spec §5.4, §5.8);
//   * no browser storage, and no way to save a picture of the canvas (§5.6);
//   * none of those actions, and no request but a read;
//   * no event or message to a listener they do not import (AlarmSignals listens on `window`).
// They also import no package but React, nothing outside src/live/, and neither of the browser's
// stores (prefs.js, session/browserState.js).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importsOf } from "./imports.testutil.js";

const LIVE = path.dirname(fileURLToPath(import.meta.url));
const rel = (file) => path.relative(LIVE, file).replace(/\\/g, "/");
const read = (file) => fs.readFileSync(path.join(LIVE, file), "utf8");

const WAVES = ["data/waveStore.js", "screens/common/waveGeometry.js", "screens/common/WaveRows.jsx",
  "screens/common/WavePanel.jsx", "screens/common/WaveFullscreen.jsx"];
const WORDS = "i18n/strings/waves.js";
const CATALOGUE = "i18n/catalog.js";
const isWave = (target) => WAVES.includes(target);

const REGISTRY = "shell/routes.js";
const ALARM_DIRS = ["signals/", "shell/", "screens/alarms/"];
const ALARM_FILES = ["auth/LockScreen.jsx", "data/boardStore.js", "data/BoardProvider.jsx"];
const isAlarm = (target) => target !== REGISTRY
  && (ALARM_DIRS.some((dir) => target.startsWith(dir)) || ALARM_FILES.includes(target));

const PACKAGES = new Set(["react", "react-dom"]);
const STORES = ["prefs.js", "session/browserState.js"];

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\.|\.testutil\./.test(entry.name) ? [full] : [];
  });
}

const resolveSpec = (from, spec) => {
  const base = path.resolve(path.dirname(from), spec);
  return [base, `${base}.js`, `${base}.jsx`, path.join(base, "index.js"), path.join(base, "index.jsx")]
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
};

/** Every module under src/live/ that `root` reaches through relative imports, each with the chain
 *  that reached it ("a -> b -> c"). `pastRegistry`: follow the registry's own imports too. */
function reached(root, { pastRegistry }) {
  const via = new Map([[root, null]]);
  const queue = [root];
  while (queue.length > 0) {
    const file = queue.shift();
    if (!pastRegistry && file !== root && rel(file) === REGISTRY) continue;
    for (const spec of importsOf(fs.readFileSync(file, "utf8")).specs) {
      if (!spec.startsWith(".")) continue;
      const target = resolveSpec(file, spec);
      if (!target || via.has(target) || !target.startsWith(LIVE + path.sep)) continue;
      via.set(target, file);
      queue.push(target);
    }
  }
  return [...via.keys()].filter((file) => file !== root).map((file) => {
    const chain = [];
    for (let at = file; at; at = via.get(at)) chain.unshift(rel(at));
    return { target: rel(file), chain: chain.join(" -> ") };
  });
}

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// Browser APIs the wave modules may not name, by what they would do.
const FORBIDDEN = [
  ["sound", /\b(Audio|AudioContext|webkitAudioContext|OfflineAudioContext)\b|<\s*(audio|video)\b|createElement\(\s*["'`](audio|video)\b|\.play\s*\(/],
  ["speech", /\b(speechSynthesis|SpeechSynthesisUtterance)\b/],
  ["vibration", /\bvibrate\b/],
  // A tab that changes its title is how a page calls from the background.
  ["notification", /\b(Notification|showNotification|setAppBadge)\b|\bdocument\.title\b/],
  ["storage", /\b(localStorage|sessionStorage|indexedDB|caches)\b|\bdocument\.cookie\b/],
  ["canvas export", /\b(toDataURL|toBlob|convertToBlob|captureStream|createObjectURL)\b|\bprint\s*\(/],
];
const forbiddenIn = (text) => {
  const code = withoutComments(text);
  return FORBIDDEN.filter(([, pattern]) => pattern.test(code)).map(([kind]) => kind);
};

// Ways into the alarm path through what the wave modules hold rather than import (see the top).
const ACTIONS = /\b(acknowledge|signOut|dispatchEvent|postMessage|BroadcastChannel)\b|\.\s*(lock|cancel)\s*\(|["'`]\/ack\b|\bmethod\s*:/;

const guarded = sources(LIVE).filter((file) => isAlarm(rel(file)));

describe("the waveform modules", () => {
  it("exist, and so does the alarm path, so no rule here can pass by an absence", () => {
    for (const file of [...WAVES, WORDS, CATALOGUE, ...ALARM_FILES, ...STORES]) {
      expect(fs.existsSync(path.join(LIVE, file)), file).toBe(true);
    }
    for (const dir of ALARM_DIRS) {
      const full = path.join(LIVE, dir);
      expect(fs.existsSync(full) && sources(full).length > 0, dir).toBe(true);
    }
    expect(guarded.length).toBeGreaterThan(8);
  });

  it("are every module named for waves, so a new one cannot slip past these rules", () => {
    const named = sources(LIVE).map(rel).filter((file) => /^wave/i.test(path.posix.basename(file)));
    expect(named.sort()).toEqual([...WAVES, WORDS].sort());
  });

  it("are reached by no alarm-path module, through any chain of imports", () => {
    let followed = 0;
    const leaks = guarded.flatMap((root) => {
      const found = reached(root, { pastRegistry: false });
      followed += found.length;
      return found.filter((r) => isWave(r.target)).map((r) => r.chain);
    });
    expect(followed, "the walk followed no import at all").toBeGreaterThan(guarded.length);
    expect(leaks).toEqual([]);
  });

  it("reach no alarm-path module, through any chain of imports, the registry's included", () => {
    let followed = 0;
    const leaks = WAVES.flatMap((file) => {
      const found = reached(path.join(LIVE, file), { pastRegistry: true });
      followed += found.length;
      return found.filter((r) => isAlarm(r.target)).map((r) => r.chain);
    });
    expect(followed, "the walk followed no import at all").toBeGreaterThan(WAVES.length);
    expect(leaks).toEqual([]);
  });

  it("keep their words inert: they import nothing, only the catalogue imports them, no alarm-path module names one", () => {
    expect(importsOf(read(WORDS))).toEqual({ specs: [], unreadable: [] });
    const importers = sources(LIVE).filter((file) => importsOf(fs.readFileSync(file, "utf8")).specs
      .some((spec) => spec.startsWith(".") && rel(resolveSpec(file, spec) ?? "") === WORDS)).map(rel);
    expect(importers).toEqual([CATALOGUE]);
    const naming = guarded.filter((file) => /["'`]waves\./.test(withoutComments(fs.readFileSync(file, "utf8"))));
    expect(naming.map(rel)).toEqual([]);
  });

  it("import no package but React, nothing outside src/live/, no browser store, and nothing they cannot read", () => {
    const wrong = [];
    for (const file of [...WAVES, WORDS]) {
      const full = path.join(LIVE, file);
      const { specs, unreadable } = importsOf(fs.readFileSync(full, "utf8"));
      for (const what of unreadable) wrong.push(`${file} -> ${what} (cannot be checked)`);
      for (const spec of specs) {
        if (!spec.startsWith(".")) {
          if (!PACKAGES.has(spec)) wrong.push(`${file} -> ${spec}`);
          continue;
        }
        const target = resolveSpec(full, spec);
        if (!target || !target.startsWith(LIVE + path.sep)) wrong.push(`${file} -> ${spec} (not under src/live/)`);
        else if (STORES.includes(rel(target))) wrong.push(`${file} -> ${rel(target)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("name no sound, speech, vibration, notification, storage or canvas-export API", () => {
    const named = [...WAVES, WORDS].flatMap((file) => forbiddenIn(read(file)).map((kind) => `${file}: ${kind}`));
    expect(named).toEqual([]);
  });

  it("act on no alarm through what they hold: no acknowledgement, no session ended or locked, no write, no event", () => {
    const acting = WAVES.flatMap((file) => {
      const found = withoutComments(read(file)).match(ACTIONS);
      return found ? [`${file}: ${found[0]}`] : [];
    });
    expect(acting).toEqual([]);
  });

  it("the rules see a leak when there is one", () => {
    // The sets.
    expect(isWave("screens/common/WavePanel.jsx")).toBe(true);
    expect(isWave(WORDS)).toBe(false);   // held by its own rule above
    for (const target of ["signals/AlarmSignals.jsx", "signals/alarmSound.js", "shell/TopBar.jsx",
      "shell/Sidebar.jsx", "screens/alarms/AlarmsScreen.jsx", "auth/LockScreen.jsx", "data/boardStore.js",
      "data/BoardProvider.jsx"]) expect(isAlarm(target), target).toBe(true);
    for (const target of [REGISTRY, "screens/patient/PatientScreen.jsx", "screens/devices/DevicesScreen.jsx",
      "screens/common/MonitorStrip.jsx", "data/shadowStore.js", "prefs.js"]) expect(isAlarm(target), target).toBe(false);

    // The walk reports a whole chain, and only the wave modules' walk goes past the registry.
    const sound = reached(path.join(LIVE, "signals", "AlarmSignals.jsx"), { pastRegistry: false });
    expect(sound.some((r) => r.target === "data/boardStore.js" && r.chain.startsWith("signals/AlarmSignals.jsx -> ")
      && r.chain.endsWith(" -> data/boardStore.js"))).toBe(true);
    const shell = path.join(LIVE, "shell", "Shell.jsx");
    const stopped = reached(shell, { pastRegistry: false }).map((r) => r.target);
    expect(stopped).toContain(REGISTRY);
    expect(stopped).not.toContain("screens/patient/PatientScreen.jsx");
    expect(reached(shell, { pastRegistry: true }).map((r) => r.target)).toContain("screens/patient/PatientScreen.jsx");

    // The text rules, each kind, and comments read past.
    expect(forbiddenIn("const a = new AudioContext(); // ok")).toEqual(["sound"]);
    expect(forbiddenIn('return <audio src="beep.wav" autoPlay />;')).toEqual(["sound"]);
    expect(forbiddenIn("speechSynthesis.speak(said);")).toEqual(["speech"]);
    expect(forbiddenIn("navigator.vibrate?.([200, 100, 200]);")).toEqual(["vibration"]);
    expect(forbiddenIn("registration.showNotification(title);")).toEqual(["notification"]);
    expect(forbiddenIn("window.localStorage.setItem(key, value);")).toEqual(["storage"]);
    expect(forbiddenIn("canvas.toBlob(save);")).toEqual(["canvas export"]);
    expect(forbiddenIn("// no AudioContext, no localStorage\n/* nor toDataURL */\nconst a = 1;")).toEqual([]);
    expect(ACTIONS.test("session.api.acknowledge(patientId, kind);")).toBe(true);
    expect(ACTIONS.test('api.request("/ack", { method: "POST", body });')).toBe(true);
    expect(ACTIONS.test("session.signOut();")).toBe(true);
    expect(ACTIONS.test("session.lock();")).toBe(true);
    expect(ACTIONS.test("track(() => api.request(wavesPath(source, cursor, started)));")).toBe(false);
  });
});

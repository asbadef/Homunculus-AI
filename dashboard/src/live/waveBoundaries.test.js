// Dalga (live waveforms): the wave modules feed no alarm, make no sound and store nothing.
//
// This rule has its own file beside boundaries.test.js (the monitor strip's rule, which Lane A
// edits). It uses the same import reader (imports.testutil.js) and the same walk.
//
// THE ALARM PATH is every module that raises, answers, sounds or counts an alarm, or that ends,
// locks or wakes the session the alarm sound lives in:
//   * signals/: the alarm sound and the critical-alarm notification;
//   * shell/: the bell, the rail badge and the menu. The screen registry shell/routes.js is the one
//     exception, for the reason given below;
//   * auth/LockScreen.jsx: the lock screen's counts;
//   * data/boardStore.js and data/BoardProvider.jsx: the board all of the above read, and
//     `acknowledge`;
//   * screens/alarms/: the alarms screen, where an alarm is acknowledged;
//   * LiveApp.jsx, session/sessionStore.js, session/useIdleLock.js and session/IdleWarning.jsx: the
//     root that mounts the alarm signals, the session (its ending stops the sound at once), and the
//     idle lock and its warning, which close the notifications that name a bed (Lane A, M2).
//
// THE WAVE MODULES are the six below, and their words i18n/strings/waves.js. Every module under
// src/live/ whose name starts with "wave" must be listed here, so a new one cannot slip past.
//
// Both directions hold through any chain of imports:
//   * No alarm-path module reaches a wave module. This walk stops at the registry: the registry
//     imports every screen, including the patient and device screens that show the waves, only so
//     that the router can draw them. (Those screens hold the session and import session/feeds.js
//     to make the feed they hand the panel: that is the screens' side of the line, see below.)
//   * No wave module reaches an alarm-path module. This walk does NOT stop at the registry: a wave
//     module that imported it would reach every screen and the board behind them.
//   * The words are the one exception. Every module reaches them through the i18n catalogue, so
//     they must import nothing, only the catalogue may import them, and no alarm-path module may
//     name a `waves.` key.
//
// WHAT THE WAVE MODULES HOLD (Lane A, I1). Nothing of the session. The screens that draw waves turn
// the session into a wave feed (session/feeds.js `waveFeedFor`): a frozen `{ getWaves(path) }`, a
// GET of the waves route and nothing else, made inside the session's `track`. The panel takes the
// feed as a prop (`feed`), and the wave store keeps its one function (`createWaveStore({ getWaves })`).
// Two layers keep it so:
//   * By import. No wave module reaches, through any chain, a module under session/ (feeds.js
//     included: the screens build the feed, never a wave module), backendApi.js, or anything
//     outside src/live/.
//   * By name. Neither the wave modules nor anything they reach names a capability of the session
//     store, the API client or the board store, or anything the session side, backendApi.js or the
//     board exports (useSession, SessionProvider, useBoard, waveFeedFor, createSessionStore…). The
//     names are DERIVED, not written out: the three objects are built here from their real
//     factories with stubs and their keys taken, and the modules' exports read, so a capability
//     added there is banned here at once. A name is caught as a member (`.lock`, `?.lock`), a key
//     (`lock:`), destructured (`{ lock }`), declared or called (`lock(`), and as a string of its own
//     ("lock"). A computed member whose key is a string, a template, a call or a concatenation
//     (`obj["unl" + "ock"]`) is refused outright; a plain index (`list[i]`, `path[i + 1]`) is not.
//     ALLOW names the few generic names the wave code defines itself, and in which forms; it is
//     pinned, and each entry must still be used.
// And read as text (comments skipped, so a comment may say "no sound"), they name:
//   * no sound, speech, vibration or notification API (spec §5.4, §5.8);
//   * no browser storage, and no way to save a picture of the canvas (§5.6);
//   * no request of their own (fetch, XMLHttpRequest, sendBeacon, WebSocket, EventSource, a worker,
//     a dynamic import), no `method:`, no "/ack";
//   * no event or message to a listener they do not import (AlarmSignals listens on `window`).
// They also import no package but React, nothing outside src/live/, and neither of the browser's
// stores (prefs.js, which holds the alarm sound's on/off; session/browserState.js).
//
// WHAT THEY REACH (Lane A, I2). Every rule above that reads text, and the import rule, runs over
// EVERY module the wave modules reach, not only the wave modules: a helper a wave module imports is
// held as the wave module is. That set is pinned (REACHED), each entry with its reason, so a newly
// reached module fails here until someone has read it and added it. What a shared module does
// legitimately is EXEMPT — by file, rule and exact text, each with its reason — and every
// exemption must still be needed. The dictionaries (i18n/strings/) are one entry: they are data,
// held by a rule of their own, so their words ("Kilidi aç", a `cancel:` key) are not read as code.
//
// READING (Lane A, M1). Text is read by a small lexer that knows strings ('…', "…", `…` and its
// ${…}), comments and regular expressions, so a `//` inside a string hides nothing after it. A
// module it cannot read to the end — a string or regular expression still open at the end of its
// line, a template or comment never closed — fails, rather than be read wrong.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { importsOf } from "./imports.testutil.js";
import { createSessionStore } from "./session/sessionStore.js";
import { createBoardStore } from "./data/boardStore.js";
import { createBackendApi } from "../backendApi.js";

const LIVE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.dirname(LIVE);
const rel = (file) => path.relative(LIVE, file).replace(/\\/g, "/");
const read = (file) => fs.readFileSync(path.join(LIVE, file), "utf8");

const WAVES = ["data/waveStore.js", "screens/common/waveGeometry.js", "screens/common/WaveRows.jsx",
  "screens/common/WavePanel.jsx", "screens/common/WaveFullscreen.jsx", "screens/common/WaveErrorBoundary.jsx"];
const WORDS = "i18n/strings/waves.js";
const CATALOGUE = "i18n/catalog.js";
const isWave = (target) => WAVES.includes(target);

const REGISTRY = "shell/routes.js";
const ALARM_DIRS = ["signals/", "shell/", "screens/alarms/"];
const ALARM_FILES = ["auth/LockScreen.jsx", "data/boardStore.js", "data/BoardProvider.jsx", "LiveApp.jsx",
  "session/sessionStore.js", "session/useIdleLock.js", "session/IdleWarning.jsx"];
const isAlarm = (target) => target !== REGISTRY
  && (ALARM_DIRS.some((dir) => target.startsWith(dir)) || ALARM_FILES.includes(target));

// The session's side of the line (I1): no wave module reaches any of it.
const SESSION_DIR = "session/";
const BACKEND_API = "../backendApi.js";
const isSessionSide = (target) => target.startsWith(SESSION_DIR) || target === BACKEND_API;

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

/** Every module that `roots` reach through relative imports, each with the chain that reached it
 *  ("a -> b -> c"). Modules under src/live/ are followed; one outside it is listed ("../x.js") and
 *  not followed. `pastRegistry`: follow the registry's own imports too. */
function reached(roots, { pastRegistry }) {
  const starts = [roots].flat();
  const via = new Map(starts.map((root) => [root, null]));
  const queue = [...starts];
  while (queue.length > 0) {
    const file = queue.shift();
    if (!pastRegistry && !starts.includes(file) && rel(file) === REGISTRY) continue;
    for (const spec of importsOf(fs.readFileSync(file, "utf8")).specs) {
      if (!spec.startsWith(".")) continue;
      const target = resolveSpec(file, spec);
      if (!target || via.has(target)) continue;
      via.set(target, file);
      if (target.startsWith(LIVE + path.sep)) queue.push(target);
    }
  }
  return [...via.keys()].filter((file) => !starts.includes(file)).map((file) => {
    const chain = [];
    for (let at = file; at; at = via.get(at)) chain.unshift(rel(at));
    return { target: rel(file), chain: chain.join(" -> ") };
  });
}

// ------------------------------------------------------------------------------------------------
// Reading (M1). `readJs` splits a source into code, comments, strings, templates and regular
// expressions. A template's ${…} is read as code, so code hidden in one is still code.

const WORD = /[A-Za-z0-9_$]/;
// After one of these a `/` starts a regular expression; after anything else (a name, a number, `)`,
// `]`, `}`, a string, `<` as in JSX's `</p>`) it divides.
const REGEX_AFTER = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "+", "-", "*", "%", "~", "^", ">"]);
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void",
  "throw", "instanceof", "yield", "await"]);

/** { parts: [kind, text][], open: [what was left open] }, kind one of code, comment, string,
 *  template, regex. The parts joined give the text back. */
function readJs(text) {
  const parts = [];
  const open = [];
  let i = 0;
  const lineOf = (at) => text.slice(0, at).split("\n").length;

  function quoted(quote) {
    const from = i;
    i += 1;
    while (i < text.length && text[i] !== quote && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
    if (text[i] === quote) i += 1;
    else open.push(`a string left open on line ${lineOf(from)}`);
    parts.push(["string", text.slice(from, i)]);
  }

  function regex() {
    const from = i;
    let inClass = false;
    i += 1;
    while (i < text.length && text[i] !== "\n" && (inClass || text[i] !== "/")) {
      if (text[i] === "\\") i += 1;
      else if (text[i] === "[") inClass = true;
      else if (text[i] === "]") inClass = false;
      i += 1;
    }
    if (text[i] === "/") {
      i += 1;
      while (i < text.length && /[a-z]/.test(text[i])) i += 1;
    } else open.push(`a regular expression left open on line ${lineOf(from)}`);
    parts.push(["regex", text.slice(from, i)]);
  }

  function template() {
    let from = i;
    i += 1;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
      } else if (text[i] === "`") {
        i += 1;
        parts.push(["template", text.slice(from, i)]);
        return;
      } else if (text[i] === "$" && text[i + 1] === "{") {
        i += 2;
        parts.push(["template", text.slice(from, i)]);
        code(true);
        from = i;
        if (text[i] === "}") i += 1;
      } else {
        i += 1;
      }
    }
    open.push(`a template left open from line ${lineOf(from)}`);
    parts.push(["template", text.slice(from, i)]);
  }

  /** Code up to the end, or (`inTemplate`) up to the `}` that closes a template's ${. */
  function code(inTemplate) {
    let from = i;
    let depth = 0;
    let prev = "";      // the last thing read that tells a regex from a division: a sign, or "w"
    let word = "";      // ... and when that was a word, the word
    const flush = () => {
      if (i > from) parts.push(["code", text.slice(from, i)]);
    };
    while (i < text.length) {
      const c = text[i];
      const next = text[i + 1];
      if (c === "/" && (next === "/" || next === "*")) {
        flush();
        const start = i;
        const end = text.indexOf(next === "/" ? "\n" : "*/", i + 2);
        if (end === -1 && next === "*") open.push(`a comment left open from line ${lineOf(start)}`);
        i = end === -1 ? text.length : next === "/" ? end : end + 2;
        parts.push(["comment", text.slice(start, i)]);
        from = i;
        continue;
      }
      const regexHere = c === "/" && (prev === "" || REGEX_AFTER.has(prev) || (prev === "w" && REGEX_AFTER_WORD.has(word)));
      if (c === "'" || c === '"' || c === "`" || regexHere) {
        flush();
        if (c === "`") template();
        else if (regexHere) regex();
        else quoted(c);
        prev = "w";
        word = "";
        from = i;
        continue;
      }
      if (inTemplate && c === "{") depth += 1;
      if (inTemplate && c === "}") {
        if (depth === 0) {
          flush();
          return;
        }
        depth -= 1;
      }
      if (WORD.test(c)) {
        const start = i;
        while (i < text.length && WORD.test(text[i])) i += 1;
        word = text.slice(start, i);
        prev = "w";
        continue;
      }
      if (!/\s/.test(c)) {
        prev = c;
        word = "";
      }
      i += 1;
    }
    flush();
    if (inTemplate) open.push("a template's ${ left open");
  }

  code(false);
  return { parts, open };
}

const rebuilt = (text, as) => readJs(text).parts.map(([kind, part]) => as(kind, part)).join("");
/** The source without its comments; strings, templates and regular expressions as they are. */
const withoutComments = (text) => rebuilt(text, (kind, part) => (kind !== "comment" ? part : part.startsWith("/*") ? " " : ""));
/** The code alone: comments gone, every string, template text and regex emptied ("", ``, /re/). */
const codeOnly = (text) => rebuilt(text, (kind, part) => {
  if (kind === "code") return part;
  if (kind === "comment") return " ";
  if (kind === "string") return '""';
  if (kind === "regex") return "/re/";
  // A template's text: its opening, its ${ and } around each expression, and its close, alone.
  return `${part.startsWith("`") ? "`" : "}"}${part.endsWith("${") ? "${" : "`"}`;
});
/** The code with its strings, templates and regexes kept, but their brackets made inert (‹ ›), so
 *  a `[` in a string is never taken for a member access. */
const bracketsOnly = (text) => rebuilt(text, (kind, part) => {
  if (kind === "comment") return " ";
  return kind === "code" ? part : part.replace(/\[/g, "‹").replace(/\]/g, "›");
});

// ------------------------------------------------------------------------------------------------
// The capabilities no wave module may name (I1), derived from the real code.

const refuse = () => Promise.reject(new Error("waveBoundaries.test.js asks nothing"));
const OBJECTS = {
  "the session store": Object.keys(createSessionStore({ api: {}, events: null })),
  "the API client": Object.keys(createBackendApi({ baseUrl: "", fetchImpl: refuse })),
  "the board store": Object.keys(createBoardStore({ api: {}, openStream: () => () => {} })),
};
const EXPORTERS = [...sources(path.join(LIVE, "session")), path.join(SRC, "backendApi.js"),
  path.join(LIVE, "data", "boardStore.js"), path.join(LIVE, "data", "BoardProvider.jsx")];
const EXPORTS = {};
for (const file of EXPORTERS) {
  EXPORTS[rel(file)] = Object.keys(await import(pathToFileURL(file).href)).filter((name) => name !== "default");
}
/** name -> where it comes from, for the message. */
const BANNED = new Map();
for (const [where, names] of [...Object.entries(OBJECTS), ...Object.entries(EXPORTS)]) {
  for (const name of names) if (!BANNED.has(name)) BANNED.set(name, where);
}

// The banned names the wave code legitimately defines itself, and the forms in which it may use
// them: `name` (declared, called or read as its own), `.name` (a member). Pinned below; each entry
// must still be used by a wave module.
const ALLOW = new Map([
  // The wave store's own `subscribe(fn)` (data/waveStore.js), read by the panel as `store.subscribe`.
  // It adds a listener to the wave store and nothing else.
  ["subscribe", ["subscribe", ".subscribe"]],
  // waveStore.js's own `cancel(entry)`, which clears a poll timer. `.cancel` stays banned: the
  // session's `cancel` ends the session.
  ["cancel", ["cancel"]],
  // WaveRows' own `view`, rowView's answer for one row. `.view` stays banned (the API's `view`).
  ["view", ["view"]],
]);

/** Every banned name `text` uses, in the form it uses it: `.name`, `name:`, `{ name }`, `name`,
 *  or `"name"` for a string that is the name. ALLOW's forms are left out. */
function capabilitiesIn(text) {
  const code = codeOnly(text);
  const found = new Set();
  for (const m of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const name = m[0];
    if (!BANNED.has(name) || WORD.test(code[m.index - 1] ?? "")) continue;
    const before = code.slice(0, m.index).trimEnd();
    const after = code.slice(m.index + name.length).trimStart();
    let form = name;
    if (before.endsWith(".") && !before.endsWith("...")) form = `.${name}`;
    else if (after.startsWith(":") && !before.endsWith("?")) form = `${name}:`;
    else if (/[{,]$/.test(before) && /^(?:[,}]|=(?![=>]))/.test(after)) form = `{ ${name} }`;
    if (!ALLOW.get(name)?.includes(form)) found.add(form);
  }
  for (const [kind, part] of readJs(text).parts) {
    const quotedName = kind === "string" || (kind === "template" && /^`[^`]*`$/.test(part) && !part.includes("${"))
      ? unescaped(part.slice(1, -1)) : null;
    if (quotedName !== null && BANNED.has(quotedName)) found.add(`"${quotedName}"`);
  }
  return [...found];
}
/** A string's text as the program sees it: each escape (unicode, hex or plain) read as its letter. */
const unescaped = (raw) => raw.replace(/\\(?:u\{([0-9A-Fa-f]+)\}|u([0-9A-Fa-f]{4})|x([0-9A-Fa-f]{2})|([\s\S]))/g,
  (all, braced, four, two, other) => (other !== undefined ? other
    : String.fromCodePoint(parseInt(braced ?? four ?? two, 16))));

// Not an object before a `[`: an array literal or a pattern follows these.
const NOT_AN_OBJECT = new Set(["return", "typeof", "case", "in", "of", "new", "delete", "void", "throw", "yield",
  "await", "else", "do", "instanceof", "const", "let", "var", "export", "default", "extends"]);
const isNumber = (token) => /^\d/.test(token ?? "");
/** A `+` inside an index with no number beside it: a concatenation, not an array step. */
function concatenates(inner) {
  const tokens = inner.match(/\d+(?:\.\d+)?|[\w$]+(?:\.[\w$]+)*|\+\+|\+=|\S/g) ?? [];
  return tokens.some((token, k) => token === "+" && !isNumber(tokens[k - 1]) && !isNumber(tokens[k + 1]));
}
/** Every computed member access whose key is a string, a template, a call or a concatenation:
 *  `obj["lock"]`, `obj[`${a}`]`, `obj[name()]`, `obj[a + b]`. A plain index is not one. */
function computedIn(text) {
  const code = bracketsOnly(text);
  const found = [];
  for (let at = code.indexOf("["); at !== -1; at = code.indexOf("[", at + 1)) {
    const owner = code.slice(0, at).trimEnd().match(/(?:[A-Za-z_$][\w$]*|\)|\]|\?\.)$/);
    if (!owner || NOT_AN_OBJECT.has(owner[0])) continue;
    let end = at;
    for (let depth = 0; end < code.length; end += 1) {
      if (code[end] === "[") depth += 1;
      else if (code[end] === "]" && (depth -= 1) === 0) break;
    }
    const inner = code.slice(at + 1, end);
    if (/["'`(]/.test(inner) || concatenates(inner)) found.push(`${owner[0]}[${inner}]`);
  }
  return found;
}

// ------------------------------------------------------------------------------------------------
// The text rules.

// Browser APIs the wave modules may not name, by what they would do. Read with strings (a
// createElement("audio") is in one), comments skipped.
const FORBIDDEN = [
  ["sound", /\b(Audio|AudioContext|webkitAudioContext|OfflineAudioContext)\b|<\s*(audio|video)\b|createElement\(\s*["'`](audio|video)\b|\.play\s*\(/g],
  ["speech", /\b(speechSynthesis|SpeechSynthesisUtterance)\b/g],
  ["vibration", /\bvibrate\b/g],
  // A tab that changes its title is how a page calls from the background.
  ["notification", /\b(Notification|showNotification|setAppBadge)\b|\bdocument\.title\b/g],
  ["storage", /\b(localStorage|sessionStorage|indexedDB|caches)\b|\bdocument\.cookie\b/g],
  ["canvas export", /\b(toDataURL|toBlob|convertToBlob|captureStream|createObjectURL)\b|\bprint\s*\(/g],
  // Ways into the alarm path through what is held rather than imported: an event or a message to a
  // listener (AlarmSignals listens on `window`), a write, the acknowledgement route.
  ["event or write", /\b(dispatchEvent|postMessage|BroadcastChannel)\b|["'`]\/ack\b|\bmethod\s*:/g],
];
// A request of their own. Read in the code alone: a word in a string asks nothing.
const NETWORK = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|serviceWorker)\b|\b(?:Shared)?Worker\s*\(|\bimport\s*\(/g;
// What would get past the names: code made from text (`eval`, `new Function("…")`), and a name
// spelt with a unicode escape, which the language reads as the letter it stands for (the test
// below spells `lock` so). In the code alone.
const UNNAMED = /\beval\b|\bFunction\s*\(|\\u\{?[0-9A-Fa-f]*\}?/g;

/** Every rule `text` breaks, as "kind: what", each once, in a fixed order. */
function brokenIn(text) {
  const broken = [];
  const prose = withoutComments(text);
  for (const [kind, pattern] of FORBIDDEN) for (const m of prose.matchAll(pattern)) broken.push(`${kind}: ${m[0]}`);
  const code = codeOnly(text);
  for (const m of code.matchAll(NETWORK)) broken.push(`network: ${m[0]}`);
  for (const m of code.matchAll(UNNAMED)) broken.push(`capability: ${m[0]}`);
  for (const what of capabilitiesIn(text)) broken.push(`capability: ${what}`);
  for (const what of computedIn(text)) broken.push(`computed access: ${what}`);
  return [...new Set(broken)];
}
const kindsIn = (text) => [...new Set(brokenIn(text).map((entry) => entry.split(":")[0]))];

// ------------------------------------------------------------------------------------------------
// What the wave modules reach (I2), pinned. A module reached and not listed here fails, until
// someone has read it and listed it with its reason.

const REACHED = {
  "i18n/I18nProvider.jsx": "useI18n: the `t` of every word the panel shows",
  "i18n/catalog.js": "the dictionaries behind `t` (the provider's)",
  "i18n/langs.js": "the language list (the provider's)",
  "i18n/translate.js": "the translator behind `t` (the provider's)",
  "i18n/dates.js": "MonitorStrip's clock times (hhmm), in the full screen",
  "prefs.js": "the language and theme preference, read and written by the two providers only",
  "theme/ThemeProvider.jsx": "restoreAttribute, which the i18n provider borrows",
  "data/ShadowProvider.jsx": "useShadow: the strip's numbers beside the waves in the full screen",
  "screens/common/MonitorStrip.jsx": "the strip's card for this monitor, drawn in the full screen",
  "screens/common/monitor.js": "maxAgeOf: how old a strip value may be (the full screen)",
  "screens/common/feedHealth.js": "ageParts, through monitor.js",
  "screens/common/useNow.js": "ShadowProvider's clock",
  "ui/index.js": "Button, Note and Tag, the shared controls",
  ...Object.fromEntries(["Icon.jsx", "icons.js", "focus.js", "Button.jsx", "Box.jsx", "Note.jsx", "Alert.jsx",
    "CapsLock.jsx", "Empty.jsx", "KV.jsx", "Tag.jsx", "riskStyle.js", "RiskPill.jsx", "Seg.jsx", "Tabs.jsx",
    "Field.jsx", "Table.jsx", "Modal.jsx", "Toast.jsx"].map((file) => [`ui/${file}`, "re-exported by ui/index.js"])),
};
// The dictionaries, one entry: every module reaches them through the catalogue, and a new one is
// added there by whoever adds words. They are data (the rule "are data only" below), so the text
// rules do not read them as code.
const DICTIONARIES = "i18n/strings/";

// What a reached module does that a rule would refuse, and may: by file, rule and exact text.
const EXEMPT = {
  "prefs.js: storage: localStorage": "it IS the browser's preference store; only the i18n and theme providers import it",
  "data/ShadowProvider.jsx: capability: .getState": "it reads its own shadow store (`store.getState`), the one LiveApp hands it",
  "ui/icons.js: capability: chart:": "an icon's name, a key of the icon table",
  "ui/icons.js: capability: lock:": "an icon's name, a key of the icon table",
  "ui/Modal.jsx: capability: restore": "its own `restore`, which puts the focus back",
  "ui/Toast.jsx: capability: start": "its own `start(id)`, a toast's timer",
  "ui/Toast.jsx: capability: dispose": "its own toast list's `dispose()`",
  "ui/Toast.jsx: capability: .dispose": "its own toast list's `dispose()`, called on unmount",
  "ui/Toast.jsx: capability: .clear": "a Map's `clear()` (its timers)",
  'ui/Button.jsx: computed access: rest["aria-busy"]': "an ARIA prop read by its hyphenated name",
  'ui/Button.jsx: computed access: rest["aria-disabled"]': "an ARIA prop read by its hyphenated name",
  'ui/Field.jsx: computed access: props["aria-describedby"]': "an ARIA prop read by its hyphenated name",
  'ui/Field.jsx: computed access: props["aria-required"]': "an ARIA prop read by its hyphenated name",
  'ui/Field.jsx: computed access: props["aria-invalid"]': "an ARIA prop read by its hyphenated name",
  "i18n/catalog.js: capability: lock": "the lock screen's dictionary, imported under that name",
  "i18n/catalog.js: capability: { lock }": "the lock screen's dictionary, listed with the others",
  "i18n/catalog.js: computed access: out[`${prefix}${key}`]": "a dictionary's nested keys, flattened",
  "i18n/I18nProvider.jsx -> prefs.js": "the language preference (prefs.js's own keys)",
  "theme/ThemeProvider.jsx -> prefs.js": "the theme preference (prefs.js's own keys)",
};

const WAVE_FILES = WAVES.map((file) => path.join(LIVE, file));
const REACH = reached(WAVE_FILES, { pastRegistry: true });
const isDictionary = (file) => file.startsWith(DICTIONARIES);
/** Every module the text rules read: the wave modules and all they reach, but the dictionaries. */
const READ = [...WAVES, ...REACH.map((r) => r.target).filter((file) => !file.startsWith("../") && !isDictionary(file))];

const unexempted = (entries) => entries.filter((entry) => !(entry in EXEMPT));
const broken = READ.flatMap((file) => brokenIn(read(file)).map((entry) => `${file}: ${entry}`));
const guarded = sources(LIVE).filter((file) => isAlarm(rel(file)));

describe("the waveform modules", () => {
  it("exist, and so does the alarm path, so no rule here can pass by an absence", () => {
    for (const file of [...WAVES, WORDS, CATALOGUE, ...ALARM_FILES, ...STORES, ...Object.keys(REACHED)]) {
      expect(fs.existsSync(path.join(LIVE, file)), file).toBe(true);
    }
    for (const dir of [...ALARM_DIRS, SESSION_DIR, DICTIONARIES]) {
      const full = path.join(LIVE, dir);
      expect(fs.existsSync(full) && sources(full).length > 0, dir).toBe(true);
    }
    expect(fs.existsSync(path.join(LIVE, BACKEND_API)), BACKEND_API).toBe(true);
    expect(guarded.length).toBeGreaterThan(12);
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

  it("reach nothing of the session's side: no module under session/ (feeds.js included), no backendApi.js, nothing outside src/live/", () => {
    const leaks = REACH.filter((r) => isSessionSide(r.target) || r.target.startsWith("../")).map((r) => r.chain);
    expect(leaks).toEqual([]);
  });

  it("reach exactly the modules listed, each read and given its reason", () => {
    const shared = [...new Set(REACH.map((r) => r.target))].filter((file) => !isWave(file) && !isDictionary(file));
    expect(shared.filter((file) => !(file in REACHED)), "reached, not listed: read it, then list it").toEqual([]);
    expect(Object.keys(REACHED).filter((file) => !shared.includes(file)), "listed, no longer reached").toEqual([]);
    expect(REACH.some((r) => r.target === WORDS)).toBe(true);
  });

  it("keep their words inert: they import nothing, only the catalogue imports them, no alarm-path module names one", () => {
    expect(importsOf(read(WORDS))).toEqual({ specs: [], unreadable: [] });
    const importers = sources(LIVE).filter((file) => importsOf(fs.readFileSync(file, "utf8")).specs
      .some((spec) => spec.startsWith(".") && rel(resolveSpec(file, spec) ?? "") === WORDS)).map(rel);
    expect(importers).toEqual([CATALOGUE]);
    const naming = guarded.filter((file) => /["'`]waves\./.test(withoutComments(fs.readFileSync(file, "utf8"))));
    expect(naming.map(rel)).toEqual([]);
  });

  // A dictionary's code, its words aside, is braces, keys, commas, `export default` and at most a
  // `const NAME = {…}` of shared labels (monitor.js's `p`): no call, member, spread, operator or
  // template, so nothing in it can run.
  const isData = (text) => {
    const shape = codeOnly(text);
    return /^[\s\w$:,{}";=]*$/.test(shape) && /\bexport\s+default\s*\{/.test(shape)
      && (shape.match(/=/g) ?? []).length === (shape.match(/\bconst\s+[\w$]+\s*=\s*\{/g) ?? []).length;
  };

  it("reach dictionaries that are data only: no import, nothing but keys and words", () => {
    const dictionaries = REACH.map((r) => r.target).filter(isDictionary);
    expect(dictionaries.length).toBeGreaterThan(20);
    const wrong = dictionaries.filter((file) => {
      const text = read(file);
      return importsOf(text).specs.length > 0 || readJs(text).open.length > 0 || !isData(text);
    });
    expect(wrong).toEqual([]);
    // The shape rule refuses what could run.
    expect(isData('export default { tr: { a: "x" }, en: { a: "y" } };')).toBe(true);
    expect(isData('const p = { hr: "HR" };\nexport default { tr: { p } };')).toBe(true);
    for (const text of ['export default { tr: { a: lock() } };', 'export default { tr: { a: "x" + y } };',
      "export default { tr: { a: `x${y}` } };", "export default { tr: { ...session } };",
      'export default { get a() { return "x"; } };', 'window.x = 1; export default {};', 'x = { a: "b" }; export default {};']) {
      expect(isData(text), text).toBe(false);
    }
  });

  it("import, with all they reach, no package but React, nothing outside src/live/, no browser store, and nothing they cannot read", () => {
    const wrong = [];
    for (const file of READ) {
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
    expect(unexempted(wrong)).toEqual([]);
  });

  it("are read to the end by the lexer, with all they reach: nothing left open", () => {
    const unread = READ.flatMap((file) => readJs(read(file)).open.map((what) => `${file}: ${what}`));
    expect(unread).toEqual([]);
  });

  it("name no sound, speech, vibration, notification, storage or canvas-export API, with all they reach", () => {
    const kinds = new Set(FORBIDDEN.map(([kind]) => kind).filter((kind) => kind !== "event or write"));
    expect(unexempted(broken.filter((entry) => kinds.has(entry.split(": ")[1])))).toEqual([]);
  });

  it("send nothing of their own, with all they reach: no request, no write, no event or message", () => {
    expect(unexempted(broken.filter((entry) => /: (network|event or write): /.test(entry)))).toEqual([]);
  });

  it("hold no capability of the session, the API client or the board, with all they reach", () => {
    expect(unexempted(broken.filter((entry) => entry.includes(": capability: ")))).toEqual([]);
  });

  it("reach no member by a computed string, template, call or concatenation, with all they reach", () => {
    expect(unexempted(broken.filter((entry) => entry.includes(": computed access: ")))).toEqual([]);
  });

  it("exempt only what is still needed, and ALLOW only what the wave code still uses (pinned)", () => {
    const found = new Set(broken);
    for (const file of READ) {
      for (const spec of importsOf(read(file)).specs) {
        const target = spec.startsWith(".") ? resolveSpec(path.join(LIVE, file), spec) : null;
        if (target && STORES.includes(rel(target))) found.add(`${file} -> ${rel(target)}`);
      }
    }
    expect(Object.keys(EXEMPT).filter((entry) => !found.has(entry)), "exempt, but nothing needs it").toEqual([]);
    // No exemption for a wave module itself: what a wave module needs goes through ALLOW.
    expect(Object.keys(EXEMPT).filter((entry) => WAVES.some((file) => entry.startsWith(`${file}:`)))).toEqual([]);

    expect(Object.fromEntries(ALLOW)).toEqual({
      subscribe: ["subscribe", ".subscribe"],
      cancel: ["cancel"],
      view: ["view"],
    });
    const used = new Set();
    for (const file of WAVES) {
      const code = codeOnly(read(file));
      for (const [name, forms] of ALLOW) {
        for (const form of forms) {
          const pattern = form.startsWith(".") ? new RegExp(`\\.\\s*${name}\\b`) : new RegExp(`(?<![.\\w$])${name}\\b`);
          if (pattern.test(code)) used.add(form);
        }
      }
    }
    expect([...ALLOW.values()].flat().filter((form) => !used.has(form)), "allowed, but no wave module uses it").toEqual([]);
    for (const name of ALLOW.keys()) expect(BANNED.has(name), `${name} is not banned: drop it`).toBe(true);
  });

  it("ban names derived from the real session store, API client and board store, and their modules' exports", () => {
    expect(OBJECTS["the session store"]).toEqual(expect.arrayContaining(["lock", "unlock", "dispose", "changePassword",
      "track", "api", "cancel", "signOut", "restore"]));
    expect(OBJECTS["the API client"]).toEqual(expect.arrayContaining(["logout", "admit", "chart", "confirmDischarge",
      "releaseBed", "acknowledge", "request", "changePassword"]));
    expect(OBJECTS["the board store"]).toEqual(expect.arrayContaining(["acknowledge", "refresh"]));
    expect(OBJECTS["the API client"].length).toBeGreaterThan(50);
    for (const name of ["useSession", "SessionProvider", "waveFeedFor", "createSessionStore", "useIdleLock",
      "createBackendApi", "backendApi", "useBoard", "BoardProvider", "createBoardStore"]) {
      expect(BANNED.has(name), name).toBe(true);
    }
    // Each comes from where it is defined: the derivation reads the modules, it is not a list.
    expect(BANNED.get("lock")).toBe("the session store");
    expect(BANNED.get("releaseBed")).toBe("the API client");
    expect(BANNED.get("waveFeedFor")).toBe("session/feeds.js");
    expect(BANNED.get("useBoard")).toBe("data/BoardProvider.jsx");
    // What the wave code legitimately calls is not banned.
    for (const name of ["get", "watch", "getWaves", "waveStoreFor", "createWaveStore", "useI18n", "useShadow"]) {
      expect(BANNED.has(name), name).toBe(false);
    }
  });

  it("read text as code: a `//` or `/*` in a string, template or regex hides nothing (M1)", () => {
    expect(withoutComments('const u = "http://x"; fetch(u); // gone')).toBe('const u = "http://x"; fetch(u); ');
    expect(withoutComments("const s = 'a // b'; session.lock();")).toBe("const s = 'a // b'; session.lock();");
    expect(withoutComments('const q = "say \\"// not\\""; lock(); /* gone */ x();')).toBe('const q = "say \\"// not\\""; lock();   x();');
    expect(withoutComments("const t = `/* ${a /* c */ + b} // */`; x.unlock(); // gone"))
      .toBe("const t = `/* ${a   + b} // */`; x.unlock(); ");
    expect(withoutComments("const t = `a\\`// b`; lock();")).toBe("const t = `a\\`// b`; lock();");
    expect(withoutComments("const r = /\\/\\/[\"'/]/g; navigator.sendBeacon(u); // gone"))
      .toBe("const r = /\\/\\/[\"'/]/g; navigator.sendBeacon(u); ");
    expect(withoutComments("const half = a / 2; // gone /x/")).toBe("const half = a / 2; ");
    expect(withoutComments('<p>{t("x")}</p> // gone')).toBe('<p>{t("x")}</p> ');
    expect(withoutComments("<Button onClick={go} />{/* gone */}")).toBe("<Button onClick={go} />{ }");
    expect(withoutComments("const u = 'http://x' // gone\nlock();")).toBe("const u = 'http://x' \nlock();");
    // A code in a template's ${…} is code; the template's own text is not.
    expect(codeOnly("const t = `lock ${session.lock()} fetch`;")).toBe("const t = `${session.lock()}`;");
    // What it cannot read to the end, it says so.
    expect(readJs("const s = 'oops\nlock();").open).toEqual(["a string left open on line 1"]);
    expect(readJs("const t = `oops").open).toEqual(["a template left open from line 1"]);
    expect(readJs("/* oops").open).toEqual(["a comment left open from line 1"]);
    expect(readJs("x = /oops\n").open).toEqual(["a regular expression left open on line 1"]);
    const sample = "const a = `x${b ? \"[\" : '/'}y`; // c\nconst d = /[/]/.test(e) / 2;";
    expect(readJs(sample).parts.map(([, part]) => part).join("")).toBe(sample);
    expect(readJs(sample).open).toEqual([]);
  });

  it("the rules see a leak when there is one", () => {
    // The sets.
    expect(isWave("screens/common/WavePanel.jsx")).toBe(true);
    expect(isWave("screens/common/WaveErrorBoundary.jsx")).toBe(true);
    expect(isWave(WORDS)).toBe(false);   // held by its own rule above
    for (const target of ["signals/AlarmSignals.jsx", "signals/alarmSound.js", "shell/TopBar.jsx",
      "shell/Sidebar.jsx", "screens/alarms/AlarmsScreen.jsx", "auth/LockScreen.jsx", "data/boardStore.js",
      "data/BoardProvider.jsx", "LiveApp.jsx", "session/sessionStore.js", "session/useIdleLock.js",
      "session/IdleWarning.jsx"]) expect(isAlarm(target), target).toBe(true);
    for (const target of [REGISTRY, "screens/patient/PatientScreen.jsx", "screens/devices/DevicesScreen.jsx",
      "screens/common/MonitorStrip.jsx", "data/shadowStore.js", "prefs.js", "session/feeds.js"]) {
      expect(isAlarm(target), target).toBe(false);
    }
    for (const target of ["session/feeds.js", "session/SessionProvider.jsx", "session/browserState.js", BACKEND_API]) {
      expect(isSessionSide(target), target).toBe(true);
    }
    expect(isSessionSide("data/waveStore.js")).toBe(false);

    // The walk reports a whole chain, and only the wave modules' walk goes past the registry.
    const sound = reached(path.join(LIVE, "signals", "AlarmSignals.jsx"), { pastRegistry: false });
    expect(sound.some((r) => r.target === "data/boardStore.js" && r.chain.startsWith("signals/AlarmSignals.jsx -> ")
      && r.chain.endsWith(" -> data/boardStore.js"))).toBe(true);
    const shell = path.join(LIVE, "shell", "Shell.jsx");
    const stopped = reached(shell, { pastRegistry: false }).map((r) => r.target);
    expect(stopped).toContain(REGISTRY);
    expect(stopped).not.toContain("screens/patient/PatientScreen.jsx");
    expect(reached(shell, { pastRegistry: true }).map((r) => r.target)).toContain("screens/patient/PatientScreen.jsx");
    // The screens that draw waves reach the session through feeds.js: their side of the line.
    const patient = reached(path.join(LIVE, "screens", "patient", "PatientScreen.jsx"), { pastRegistry: true });
    expect(patient.map((r) => r.target)).toEqual(expect.arrayContaining(["session/feeds.js", "screens/common/WavePanel.jsx"]));
    // A module outside src/live/ is listed, not followed.
    expect(reached(path.join(LIVE, "LiveApp.jsx"), { pastRegistry: false }).map((r) => r.target)).toContain(BACKEND_API);

    // The API rules, each kind, comments read past.
    expect(kindsIn("const a = new AudioContext(); // ok")).toEqual(["sound"]);
    expect(kindsIn('return <audio src="beep.wav" autoPlay />;')).toEqual(["sound"]);
    expect(kindsIn("speechSynthesis.speak(said);")).toEqual(["speech"]);
    expect(kindsIn("navigator.vibrate?.([200, 100, 200]);")).toEqual(["vibration"]);
    expect(kindsIn("registration.showNotification(title);")).toEqual(["notification"]);
    expect(kindsIn("window.localStorage.setItem(key, value);")).toEqual(["storage"]);
    expect(kindsIn("canvas.toBlob(save);")).toEqual(["canvas export"]);
    expect(kindsIn("// no AudioContext, no localStorage\n/* nor toDataURL */\nconst a = 1;")).toEqual([]);
    expect(kindsIn("window.dispatchEvent(new Event(type));")).toEqual(["event or write"]);
    expect(kindsIn('getWaves("/ack");')).toEqual(["event or write"]);
    expect(kindsIn('feed.getWaves(path, { method: "POST" });')).toEqual(["event or write"]);
    // Requests: each one, and a word in a string is not one.
    for (const line of ['fetch("/x");', "window.fetch(url);", "const f = fetch;", "new XMLHttpRequest();",
      "navigator.sendBeacon(url, body);", "new WebSocket(url);", "new EventSource(url);", "importScripts(url);",
      "new Worker(url);", "new SharedWorker(url);", "navigator.serviceWorker.ready;", 'import("./x.js");']) {
      expect(kindsIn(line), line).toEqual(["network"]);
    }
    expect(kindsIn('t("waves.fetch"); const s = "new Worker(";')).toEqual([]);
    // Capabilities, in every form.
    const named = (text) => brokenIn(text).filter((entry) => entry.startsWith("capability: "));
    expect(named("session.lock();")).toEqual(["capability: .lock"]);
    expect(named("session.lock?.();")).toEqual(["capability: .lock"]);
    expect(named("const { lock } = session; lock();")).toEqual(["capability: { lock }", "capability: lock"]);
    expect(named("const { unlock: open } = session;")).toEqual(["capability: unlock:"]);
    expect(named("function f({ a, signOut = noop }) {}")).toEqual(["capability: { signOut }"]);
    expect(named("api.request(wavesPath(source, cursor, started));")).toEqual(["capability: api", "capability: .request"]);
    expect(named("const s = useSession(); waveFeedFor(s);")).toEqual(["capability: useSession", "capability: waveFeedFor"]);
    expect(named('const key = "unlock";')).toEqual(['capability: "unlock"']);
    expect(named("session.cancel?.();")).toEqual(["capability: .cancel"]);
    expect(named("const { cancel } = session;")).toEqual(["capability: { cancel }"]);
    expect(named("api.view(id);")).toEqual(["capability: api", "capability: .view"]);
    expect(named("const { lo\\u0063k } = session;")).toEqual(["capability: \\u0063"]);
    expect(named('eval(text); new Function("return 1");')).toEqual(["capability: eval", "capability: Function("]);
    expect(named('const s = "lo\\u0063k is a word";')).toEqual([]);
    expect(named('Reflect.get(session, "\\u006cock");')).toEqual(['capability: "lock"']);
    // ... and not what the wave code is: its own names, ALLOW's forms, a word in a string or comment.
    expect(named("getWaves(wavesPath(source, cursor, started)); cancel(entry); store.subscribe; const view = 1;")).toEqual([]);
    expect(named('t("lock.title"); // session.lock()\nconst clearLock2 = relock;')).toEqual([]);
    // Computed access: a literal, a template, a call or a concatenation; a plain index is not one.
    const computed = (text) => brokenIn(text).filter((entry) => entry.startsWith("computed access: "));
    expect(computed('obj["unl" + "ock"]();')).toEqual(['computed access: obj["unl" + "ock"]']);
    expect(computed("obj[`un${k}`]();")).toEqual(["computed access: obj[`un${k}`]"]);
    expect(computed("obj[a + b]();")).toEqual(["computed access: obj[a + b]"]);
    expect(computed("obj[name.concat(rest)]();")).toEqual(["computed access: obj[name.concat(rest)]"]);
    expect(computed("f()['lock'];")).toEqual(["computed access: )['lock']"]);
    expect(computed('obj?.["lock"]();')).toEqual(['computed access: ?.["lock"]']);
    expect(computed('blocks[id]; path[i + 1]; list[list.length - 1]; catalogue?.[row.id]?.label; const [a, b] = c; return ["x"]; f(["y"]); x = { ["k"]: 1 };'))
      .toEqual([]);
  });
});

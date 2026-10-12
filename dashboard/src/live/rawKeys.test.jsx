// Cross-cutting: NO SCREEN OF THIS BUILD PRINTS A TRANSLATION KEY WHERE ITS TEXT SHOULD BE.
//
// `createTranslator` returns the key itself when a key is missing (translate.js, deliberately: a
// gap must be visible, not silently Turkish). That is the right fallback and it is also a failure
// nothing else catches — it throws nothing, logs nothing in a test run, and renders a plausible
// looking `beds.identityPending` into a clinical card. Wave 3 met it twice. The foundation moved
// the unit names out of `beds.*` because "the alarms and patient screens, built on their own
// branches, would have rendered the raw key" (strings/board.js), and then six more keys were found
// in the same position — `board.identityPending`, `board.news2*`, `board.escalated*`, which the bed
// card, the alarms row and the patient screen all say. `escalated` had no test on any branch at
// all, so on a branch without the alarms arm the screen printed the literal key and the suite was
// green.
//
// So this test is not about those six: it is the systemic version, and it follows THE BUILD rather
// than a pinned registry (the one place that rule is right: the subject is a property every built
// screen must have, not which screens exist). An arm that lands a screen in `shell/routes.js`
// SCREENS is swept by it without editing this file, and its address's parameters are filled from
// the fixture below — `/patients/:id` is opened on the card this payload carries.
//
// What it cannot see: a key inside a `{variable}` the engine supplied (that is data, never
// translated), and a key rendered only on a state this payload does not reach. The second test
// below is the anchor against that — a sweep over screens that rendered nothing would pass
// vacuously, so the six keys the fix-up moved are asserted present, in Azerbaijani, on the screens
// that draw them.
//
// Synthetic accounts and synthetic cards only (board.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { ThemeProvider } from "./theme/ThemeProvider.jsx";
import { mount } from "./session/mount.testutil.jsx";
import { profile, token } from "./session/testTokens.testutil.js";
import { DICTIONARIES, NAMESPACES } from "./i18n/catalog.js";
import { LANG_CODES } from "./i18n/langs.js";
import { ROUTES, hashPath, resetScreens, screenOf } from "./shell/routes.js";
import { Shell } from "./shell/Shell.jsx";
import { PERMISSION_KEYS } from "./screens/admin/catalogue.js";
import { NOW, ago, alarm, board, entry, identity, news2, reading } from "./data/board.testutil.js";
import { ADMIN_READS } from "./screens/admin/admin.testutil.js";

/** `src/live/` on disk. (Paths with node:path: under jsdom the global URL is jsdom's, which
 *  fileURLToPath refuses — the note apiErrors.test.js carries.) */
const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Every right Group 1 knows — the mirrored catalogue itself, not a list written out here — so the
 *  sweep is not stopped at a screen by a missing permission, and so no CONTROL a right unlocks is
 *  left outside the net. `clinical.chart` was missing once, and the patient screen then rendered
 *  only the "you may not chart this" sentence while the five strings of the charting control
 *  (`patient.chartTitle|chartNote|chartYes|chartNo|chartSaving`) were never swept: a permission
 *  omitted here is a whole region of the UI this file silently does not cover, which is the
 *  opposite of what it exists for.
 *
 *  The administration surface made the list itself the only safe answer. Its group-mapping
 *  controls are drawn only for a desk that holds the WHOLE catalogue (the server's own rule,
 *  `admin/ldap_service._full_administrator`, 403 otherwise) — so `users.manage` and
 *  `groups.manage` are not enough, and no fixed list of three or five rights ever would be: a
 *  right added to `auth/permissions.py` would silently close the mapping panel to this sweep. */
const PERMS = [...PERMISSION_KEYS];
/** The card a parameterised address is opened on. */
const FIXTURE_ID = "S-001";

// The shape of a key as `t()` returns it when it is missing: one of THIS build's own namespaces, a
// dot, then the key's own camelCase or dotted path, with no spaces. The namespaces come from the
// catalogue rather than being written out, so a namespace an arm adds is included the day it lands.
//
// Restricting the first word to the catalogue's namespaces is what makes the check usable: the bare
// `word.word` shape also matches text a screen is RIGHT to print — `«alerts.ack»` is a permission
// key quoted inside `alarms.noAckPerm`, and a file name, a decimal or an abbreviation ending in a
// full stop would each match too. Those are not namespaces, so they are not flagged, while every
// raw key of every namespace is. The detector's own test below states both halves.
const KEY_SHAPE = new RegExp(
  `\\b(?:${Object.keys(NAMESPACES).join("|")})\\.[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)*\\b`,
  "g",
);
/** The attributes a reader meets that are not in the text: an accessible name is as much a place
 *  for a raw key as a paragraph, and `aria-label` is where a card's whole name lives. */
const LABELS = ["aria-label", "aria-description", "title", "placeholder", "alt"];
/** Not markup a reader is ever shown. A stylesheet in particular is full of `nav.something`. */
const NOT_TEXT = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
/** A file this interface names is not a key, whatever its first word is (`api/board.py`). */
const A_FILE = /\.(?:js|jsx|ts|tsx|py|json|md|css|html)$/i;
/** A PERMISSION key is not a translation key, and two of them are namespace-shaped: `board.view`
 *  and `board.py` share a first word with the `board` namespace. The roles table prints every key
 *  of the catalogue on purpose, under the server's own description — it is what an administrator
 *  searches that table by and what a support call quotes, which is why `apiErrors.js` leaves them
 *  untranslated inside `errors.permissionRequired` and `admin.beyond` too. Only the EXACT keys of
 *  the catalogue are exempt, so a real `board.news2` left raw is still caught. Found by this
 *  file's own tab-walking sweep the first time the roles tab was built. */
const PERMISSION_KEY = new Set(PERMISSION_KEYS);

/** Every key-shaped string this subtree shows a reader, text and accessible names alike.
 *
 *  Each text NODE is read on its own rather than through `textContent`, which concatenates
 *  neighbouring elements with nothing between them: two keys in two adjacent cells came back as
 *  one unsearchable `beds.identityPendingnews2.missing.spo2`, and a report a reviewer cannot paste
 *  into a grep is half a report. */
export function rawKeys(root) {
  const texts = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode: (node) => (NOT_TEXT.has(node.parentNode?.nodeName) ? 2 /* REJECT */ : 1 /* ACCEPT */),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node.data);
  for (const el of root.querySelectorAll(LABELS.map((a) => `[${a}]`).join(","))) {
    for (const attr of LABELS) {
      const value = el.getAttribute(attr);
      if (value) texts.push(value);
    }
  }
  const found = new Set();
  for (const text of texts) {
    for (const match of text.matchAll(KEY_SHAPE)) {
      if (!A_FILE.test(match[0]) && !PERMISSION_KEY.has(match[0])) found.add(match[0]);
    }
  }
  return [...found];
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** One card with a name, a measured channel, the engine's NEWS2 at its loudest (partial, with a
 *  red parameter) and an escalated alarm; one card the HIS has not named. Between them they reach
 *  every string the three clinical screens share.
 *
 *  The first card carries a MEDS block on purpose. With `meds: null` — `entry`'s default — the
 *  patient screen drew only `patient.noMeds`, so the four antibiotic strings and the two
 *  pressor/weight/creatinine ones were outside the sweep. A fixture that does not reach a branch
 *  makes this file quietly smaller than it reads, and the branches it was not reaching were the
 *  three-valued antibiotic: the one place on that screen where a missing record must not be
 *  rendered as a deadline the ward missed. */
const PAYLOAD = board([
  entry(FIXTURE_ID, [alarm("news2", "high", { escalated: true })], {
    identity: identity(),
    score: news2({ partial: true, missing: ["spo2"], red_param: true }),
    ...reading({ heart_rate: 96, spo2: 91 }, 30),
    meds: {
      pressors: { norepinephrine: 0.08 }, antibiotic_given: true, antibiotic_at: ago(600),
      antibiotic_clock: null, weight_kg: 72, creatinine: 1.9,
    },
  }),
  entry("S-002", [], reading({ heart_rate: 88 }, 30)),
]);

/** The shell on one address, as LiveApp nests it, with the board LIVE and its first reload landed. */
async function openAt(path) {
  window.location.hash = `#${path}`;
  const mounted = await mount(<ThemeProvider><Shell resume={hashPath(`#${path}`)} /></ThemeProvider>, {
    access: token({ perms: PERMS }),
    me: profile({ perms: PERMS }),
    setup: (api) => {
      api.boardPatients.mockResolvedValue(PAYLOAD);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      // The administration screen reads four more routes before it draws a row. Unstubbed they
      // resolve `undefined`, every list comes out empty, and the sweep walks three tabs that each
      // say only "nothing matches" — green, and covering none of the strings this file exists for.
      ADMIN_READS(api);
    },
  });
  await act(async () => { await mounted.board.start(); });
  await act(async () => { mounted.stream.open(); await settle(); });
  return mounted;
}

/** The address of a route, with its parameters on the fixture's card. */
const addressOf = (route) => route.path.replace(/:\w+/g, FIXTURE_ID);

beforeEach(() => {
  window.location.hash = "";
  vi.setSystemTime(NOW);
});
afterEach(() => {
  resetScreens();
  vi.useRealTimers();
  localStorage.clear();
});

describe("no screen shows a reader a translation key", () => {
  it("catches a raw key, and leaves text a screen is right to print alone", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      "<p>beds.identityPending</p>",
      "<p>news2.missing.spo2</p>",
      "<p lang=\"ru\">«alerts.ack» · 4.07 · 09:58 · мм рт. ст. · board.py</p>",
      // The roles table's own cells: the catalogue's keys, printed on purpose. `board.view` is
      // namespace-shaped and still not a translation key; `board.news2` is one and is caught.
      "<span>board.view</span><span>clinical.chart</span><span>board.news2</span>",
      "<button aria-label=\"board.escalated\">·</button>",
    ].join("");
    expect(rawKeys(root).sort()).toEqual([
      "beds.identityPending", "board.escalated", "board.news2", "news2.missing.spo2",
    ]);
  });

  it("every screen this build has renders its texts, on every address the rail can reach", async () => {
    const offenders = [];
    const visited = [];
    for (const route of ROUTES.filter((r) => screenOf(r))) {
      const path = addressOf(route);
      const mounted = await openAt(path);
      // The screen itself, not the router's "no access" or "no such page" — both of which carry an
      // h1 of their own and no screen's text at all, and would have made this sweep vacuous.
      expect(document.querySelectorAll("h1"), `${route.id} (${path})`).toHaveLength(1);
      for (const key of rawKeys(document.body)) offenders.push(`${route.id} (${path}) → ${key}`);
      // A TABBED screen shows one panel at a time, so arriving at it sweeps the FIRST tab and
      // nothing else: the administration screen's roles and login-source tabs — two whole
      // namespaces, built on their own branches — would have sat outside this net while it
      // reported the screen covered. Every tab is clicked and its panel swept. `role="tab"` is
      // read again after each click: the list may be rebuilt.
      for (let at = 0; at < screen.queryAllByRole("tab").length; at += 1) {
        const tab = screen.queryAllByRole("tab")[at];
        const name = tab.textContent;
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { fireEvent.click(tab); await settle(); });
        for (const key of rawKeys(document.body)) offenders.push(`${route.id} (${path}) · ${name} → ${key}`);
        visited.push(`${route.id}:${at}`);
      }
      visited.push(route.id);
      act(() => { mounted.board.clear(); });
      cleanup();
    }
    expect(offenders, `a screen printed a key instead of its text:\n${offenders.join("\n")}`).toEqual([]);
    // Not WHICH screens exist (that is the build's business and this file does not pin it), only
    // that the sweep had screens to sweep: a build whose routes were all unbuilt would otherwise
    // report a clean board having rendered nothing.
    expect(visited.length, `swept: ${visited.join(", ")}`).toBeGreaterThan(1);
  });

  // The anchor for the sweep above, and the regression test for the six keys the Wave 3 fix-up
  // moved into `board.*`: each is asserted as the reader meets it, so a payload that stopped
  // reaching one of them fails here rather than quietly weakening the sweep.
  it("the keys three screens share resolve on each screen that draws them", async () => {
    await openAt("/beds");
    expect(screen.getByText("kimlik gözlənilir")).toBeInTheDocument();      // board.identityPending
    expect(screen.getByText("NEWS2:")).toBeInTheDocument();                 // board.news2
    expect(screen.getByText("qismən")).toBeInTheDocument();                 // board.news2Partial
    expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument(); // board.news2Red
    cleanup();
    const mounted = await openAt("/alarms");
    expect(screen.getByText("Eskalasiya edilib")).toBeInTheDocument();      // board.escalated
    expect(screen.getByText(/Eskalasiyanı mühərrik yürüdür/)).toBeInTheDocument(); // board.escalatedHelp
    act(() => { mounted.board.clear(); });
  });
});

// ── The same guarantee for the text the sweep above cannot reach ───────────────────────────────
//
// The sweep renders; it therefore covers only what a payload and a few clicks reach. A dialog's
// title, a confirmation's sentence, the words under a refused field — the administration tabs put
// a great deal of their copy exactly there, and no fixture opens every dialog of every tab. So the
// keys are checked WITHOUT rendering: every `t("ns.key")` a live source names as a plain string
// literal must exist in all four languages. It cannot see a key built at run time (`t(\`x.${y}\`)`
// — which is why the live code does not build them), and it says nothing about whether the text is
// RIGHT; it catches the whole class of "this key was renamed, moved or never written", which is
// what printed `beds.identityPending` into a clinical card twice in Wave 3.
//
// WHICH LITERALS. The first version read only a key written straight into `t("…")` or after
// `labelKey:` / `textKey:`, and it missed 80 of the 386 key literals the live sources held
// (measured by the review): every `t(open ? "x.a" : "x.b")`, and every lookup table or
// `{ key: "x.y" }` object — exactly where the administration tabs keep their dialogs' titles and
// their reason maps. So now EVERY string literal outside a comment whose first word is one of this
// build's namespaces is a key, and must exist in all four languages — the permission keys excepted
// (`board.view` is a permission that happens to be namespace-shaped; the roles table prints it on
// purpose) and file names excepted. And a literal in KEY POSITION — anywhere in `t(…)`'s first
// argument, ternary branches included, or after `labelKey:` / `textKey:` — whose first word is
// NOT a namespace fails as well: that is a mistyped namespace, which the first version skipped as
// "not one of ours". Outside key position an unknown first word is not a key — `hmc.lock` is a
// storage key, `hs.ornek` an example login — and is left alone. A key built at run time, or one
// inside a template literal's `${…}`, is still out of reach; the live code does not build them.
const NAMESPACE = new Set(Object.keys(NAMESPACES));
/** A whole string literal that is key-shaped: `"ns.key"`, `'ns.key'` or `` `ns.key` ``. */
const KEY_LITERAL = /(["'`])([a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)\1/g;
/** The characters after which a `/` starts a regular expression rather than a division. */
const REGEX_AFTER = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", ";", "{", "+", "-", "*", "%", "~", "^"]);

/** The source with its comments taken out and every string kept whole. A small scanner, not a
 *  parser: it knows the three quotes, both comment forms and a regular-expression literal — which
 *  can hold a quote (`/["']/`) that would otherwise open a "string" swallowing the code after it. */
export function codeOf(text) {
  let out = "";
  let at = 0;
  while (at < text.length) {
    const c = text[at];
    const next = text[at + 1];
    if (c === "/" && next === "/") {
      while (at < text.length && text[at] !== "\n") at += 1;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", at + 2);
      at = end === -1 ? text.length : end + 2;
      out += " ";
    } else if (c === "/" && (REGEX_AFTER.has(out.trimEnd().slice(-1)) || /(?:=>|\breturn)$/.test(out.trimEnd()))) {
      let inClass = false;
      at += 1;
      while (at < text.length && text[at] !== "\n" && (inClass || text[at] !== "/")) {
        if (text[at] === "\\") at += 1;
        else if (text[at] === "[") inClass = true;
        else if (text[at] === "]") inClass = false;
        at += 1;
      }
      at += 1;
      while (at < text.length && /[a-z]/i.test(text[at])) at += 1;
      out += " ";
    } else if (c === "\"" || c === "'" || c === "`") {
      let literal = c;
      at += 1;
      while (at < text.length && text[at] !== c) {
        literal += text[at] === "\\" ? text.slice(at, at + 2) : text[at];
        at += text[at] === "\\" ? 2 : 1;
      }
      out += `${literal}${c}`;
      at += 1;
    } else {
      out += c;
      at += 1;
    }
  }
  return out;
}

/** The text of every key position in `code`: each `t(` call's first argument, read to its
 *  top-level `,` or `)` with strings skipped, and the literal after each `labelKey:` / `textKey:`. */
function keyPositions(code) {
  const out = [];
  for (const call of code.matchAll(/(?<![\w$.])t\(/g)) {
    let depth = 0;
    let at = call.index + call[0].length;
    const start = at;
    for (; at < code.length; at += 1) {
      const ch = code[at];
      if (ch === "\"" || ch === "'" || ch === "`") {
        at = code.indexOf(ch, at + 1);
        if (at === -1) break;
      } else if ("([{".includes(ch)) depth += 1;
      else if (")]}".includes(ch)) {
        if (depth === 0) break;
        depth -= 1;
      } else if (ch === "," && depth === 0) break;
    }
    out.push(code.slice(start, at === -1 ? code.length : at));
  }
  for (const named of code.matchAll(/\b(?:labelKey|textKey):\s*(["'`][^"'`]*["'`])/g)) out.push(named[1]);
  return out;
}

/** Every problem with the keys one source names, as `"<file> → <key> …"` lines. */
export function keyProblems(text, file) {
  const code = codeOf(text);
  const problems = [];
  for (const [, , key] of code.matchAll(KEY_LITERAL)) {
    if (!NAMESPACE.has(key.split(".")[0]) || PERMISSION_KEY.has(key) || A_FILE.test(key)) continue;
    const missing = LANG_CODES.filter((lang) => !(key in DICTIONARIES[lang]));
    if (missing.length > 0) problems.push(`${file} → ${key} (${missing.join(", ")})`);
  }
  for (const position of keyPositions(code)) {
    for (const [, , key] of position.matchAll(KEY_LITERAL)) {
      if (!NAMESPACE.has(key.split(".")[0]) && !A_FILE.test(key)) problems.push(`${file} → ${key}: not a namespace`);
    }
  }
  return problems;
}

describe("every key the live sources name exists in all four languages", () => {
  const LIVE = path.join(HERE, "live");
  /** Every `.js`/`.jsx` under src/live/ that ships — tests and test utilities excluded (a test may
   *  name a key that does not exist; this file's own detector fixtures do), and the dictionaries
   *  themselves, which DEFINE keys and whose values are prose. */
  function sources(dir) {
    const out = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) out.push(...sources(full));
      else if (/\.jsx?$/.test(item.name) && !/\.test\.jsx?$/.test(item.name) && !/\.testutil\.jsx?$/.test(item.name)) out.push(full);
    }
    return out;
  }
  const FILES = sources(LIVE).filter((file) => !file.includes(path.join("i18n", "strings")));
  const ALL = LANG_CODES.join(", ");

  it("found sources to read, and reads every way a key is named — and nothing a comment says", () => {
    expect(FILES.length).toBeGreaterThan(40);
    const sample = [
      'const a = t(open ? "admin.title" : "admin.nopeOne");',                  // a ternary
      'const LABEL = { users: "admin.readUsers", other: "admin.nopeTwo" };',   // a lookup table
      'const b = { labelKey: "admin.tabUsers" }; const c = t("adimn.title");', // a mistyped namespace
      '// t("admin.nopeInAComment") is prose, and so is /* labelKey: "admin.nopeInABlock" */',
      "{/* t(\"admin.nopeInJsx\") */}",
      'const re = /["\']/g; const d = t("admin.nopeAfterARegex");',             // a quote in a regex
      'const store = "hmc.lock"; const perm = "board.view"; const file = "api/board.py";',
      "const built = `admin.${kind}`;",                                         // run time: out of reach
    ].join("\n");
    expect(keyProblems(sample, "sample.jsx").sort()).toEqual([
      "sample.jsx → adimn.title: not a namespace",
      `sample.jsx → admin.nopeAfterARegex (${ALL})`,
      `sample.jsx → admin.nopeOne (${ALL})`,
      `sample.jsx → admin.nopeTwo (${ALL})`,
    ]);
  });

  it("names no key the dictionaries do not have, and no namespace this build does not have", () => {
    const problems = FILES.flatMap((file) => keyProblems(fs.readFileSync(file, "utf8"), path.relative(LIVE, file)));
    expect(problems, `a live source names a key no dictionary has:\n${problems.join("\n")}`).toEqual([]);
  });
});

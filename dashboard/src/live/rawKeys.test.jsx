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
import React from "react";
import { act, cleanup, screen } from "@testing-library/react";
import { ThemeProvider } from "./theme/ThemeProvider.jsx";
import { mount } from "./session/mount.testutil.jsx";
import { profile, token } from "./session/testTokens.testutil.js";
import { NAMESPACES } from "./i18n/catalog.js";
import { ROUTES, hashPath, resetScreens, screenOf } from "./shell/routes.js";
import { Shell } from "./shell/Shell.jsx";
import { NOW, alarm, board, entry, identity, news2, reading } from "./data/board.testutil.js";

/** Every right Group 1 knows, so the sweep is not stopped at a screen by a missing permission. */
const PERMS = ["board.view", "alerts.ack", "users.manage", "groups.manage"];
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
    for (const match of text.matchAll(KEY_SHAPE)) if (!A_FILE.test(match[0])) found.add(match[0]);
  }
  return [...found];
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** One card with a name, a measured channel, the engine's NEWS2 at its loudest (partial, with a
 *  red parameter) and an escalated alarm; one card the HIS has not named. Between them they reach
 *  every string the three clinical screens share. */
const PAYLOAD = board([
  entry(FIXTURE_ID, [alarm("news2", "high", { escalated: true })], {
    identity: identity(),
    score: news2({ partial: true, missing: ["spo2"], red_param: true }),
    ...reading({ heart_rate: 96, spo2: 91 }, 30),
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
      "<button aria-label=\"board.escalated\">·</button>",
    ].join("");
    expect(rawKeys(root).sort()).toEqual(["beds.identityPending", "board.escalated", "news2.missing.spo2"]);
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

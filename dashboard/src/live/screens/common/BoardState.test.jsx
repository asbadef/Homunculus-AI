import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { CONNECTION } from "../../../liveConnection.js";
import { ENGINE_RISKS, riskStyle } from "../../ui/index.js";
import { BoardProvider } from "../../data/BoardProvider.jsx";
import {
  BoardStrip, ChronicExpected, FeedHealth, RAIL, RAIL_LEFT, ScopeNote, boardKnown, boardStale, railOf, useBoardNow,
} from "./BoardState.jsx";

const NOW = Date.parse("2026-10-08T10:00:00Z");
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();
const show = (ui) => render(<I18nProvider>{ui}</I18nProvider>);

describe("what a screen may say about its own board", () => {
  it("only a LIVE board is known; only a DEGRADED one is stale", () => {
    expect(boardKnown(CONNECTION.LIVE)).toBe(true);
    for (const c of [CONNECTION.DEGRADED, CONNECTION.UNAVAILABLE, CONNECTION.CONNECTING]) {
      expect(boardKnown(c), c).toBe(false);
    }
    expect(boardStale(CONNECTION.DEGRADED)).toBe(true);
    expect(boardStale(CONNECTION.LIVE)).toBe(false);
  });
});

describe("BoardStrip", () => {
  it("a working board draws nothing", () => {
    const { container } = show(<BoardStrip connection={CONNECTION.LIVE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("an unreachable server is announced, and says an empty list is not an empty ward", () => {
    show(<BoardStrip connection={CONNECTION.UNAVAILABLE} />);
    const box = screen.getByRole("alert");
    expect(box).toHaveTextContent("Serverlə bağlantı yoxdur");
    expect(box).toHaveTextContent("GƏLMİR");
  });

  it("a lost stream is a static note, not something that speaks on every flicker", () => {
    show(<BoardStrip connection={CONNECTION.DEGRADED} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("güncəl olmaya bilər");
  });

  it("a board still loading says so", () => {
    show(<BoardStrip connection={CONNECTION.CONNECTING} />);
    expect(screen.getByRole("note")).toHaveTextContent("Panel yüklənir");
  });
});

describe("ScopeNote", () => {
  it("writes the engine's own sentence, untranslated", () => {
    // The server knows what it filtered and why; the screen does not paraphrase it.
    const note = "Kapsamınızda panoda karşılığı olan hiçbir yatak yok.";
    show(<ScopeNote scope={{ unrestricted: false, hidden: 0 }} scopeNote={note} />);
    expect(screen.getByRole("note")).toHaveTextContent(note);
  });

  it("marks that sentence as Turkish, and says in the reader's language where it came from", () => {
    // The engine writes `scope_note` in Turkish whatever language was asked for. Unmarked, a
    // Russian synthesiser reads Turkish letters as Russian ones, and the reader is never told why
    // one sentence on the screen is not in their language.
    const note = "Kapsamınızda panoda karşılığı olan hiçbir yatak yok.";
    const { container } = show(<ScopeNote scope={{ hidden: 0 }} scopeNote={note} />);
    const marked = container.querySelector('[lang="tr"]');
    expect(marked).not.toBeNull();
    expect(marked).toHaveTextContent(note);
    expect(screen.getByRole("note")).toHaveTextContent("Bu cümləni server yazıb; dili türkcədir.");
  });

  it("adds the counts the engine sent with it", () => {
    show(<ScopeNote scope={{ hidden: 4, unresolved_hidden: 2 }} scopeNote={null} />);
    const box = screen.getByRole("note");
    expect(box).toHaveTextContent("Əhatənizdən kənarda qalan kart: 4.");
    expect(box).toHaveTextContent("Bunlardan 2 ədədi heç bir çarpayıya uyğun gəlmir.");
  });

  it("an unrestricted session with nothing hidden is told nothing", () => {
    const { container } = show(<ScopeNote scope={{ unrestricted: true, hidden: 0 }} scopeNote={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a load that failed carries no scope, so nothing is drawn", () => {
    // A stale scope block would explain an empty board as "this is your scope" when the reason
    // was the connection (boardStore drops the scope with the patients).
    const { container } = show(<ScopeNote scope={null} scopeNote={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FeedHealth", () => {
  const measured = { heart_rate: ago(30), spo2: ago(30), sbp: ago(30), map: ago(30), temperature: ago(30), resp_rate: ago(30) };
  const LIVE = CONNECTION.LIVE;

  it("says how many beds have gone quiet, and when the quietest one last spoke", () => {
    show(<FeedHealth connection={LIVE} nowMs={NOW} patients={[
      { patient_id: "S-001", measuredAt: measured },
      { patient_id: "S-002", measuredAt: { heart_rate: ago(4_000) } },
    ]} />);
    expect(screen.getByText(/Səssiz çarpayı: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Ən köhnə ölçmə:/)).toBeInTheDocument();
  });

  it("says so when every bed is reporting — but only a LIVE board should show it at all", () => {
    show(<FeedHealth connection={LIVE} nowMs={NOW} patients={[{ patient_id: "S-001", measuredAt: measured }]} />);
    expect(screen.getByText(/Bütün çarpayılardan məlumat gəlir/)).toBeInTheDocument();
  });

  // The failure this gate exists for. On a board that is not LIVE the snapshot is never reloaded
  // (only the stream's `onOpen` reloads it), so these timestamps go on ageing against a clock that
  // is still moving: for the first minutes of an outage the chip says "data is arriving from every
  // bed", and a quarter of an hour later it says every bed has gone quiet — blaming the ward's
  // monitors for our own lost connection. Neither sentence is knowable, so neither is said.
  it("says nothing about the feed on a board it cannot know", () => {
    for (const connection of [CONNECTION.DEGRADED, CONNECTION.UNAVAILABLE, CONNECTION.CONNECTING, undefined]) {
      const { container } = show(<FeedHealth connection={connection} nowMs={NOW} patients={[
        { patient_id: "S-001", measuredAt: measured },
      ]} />);
      expect(container, String(connection)).toBeEmptyDOMElement();
    }
  });

  it("never blames the monitors for our own outage, however long it lasts", () => {
    // The same cards, aged a quarter of an hour past every bed-alive window: LIVE this is a real
    // "silent beds" count, and DEGRADED it is our connection and must not be reported as theirs.
    const stale = [{ patient_id: "S-001", measuredAt: measured }];
    const later = NOW + 15 * 60 * 1000;
    show(<FeedHealth connection={LIVE} nowMs={later} patients={stale} />);
    expect(screen.getByText(/Səssiz çarpayı: 1/)).toBeInTheDocument();
    const degraded = show(<FeedHealth connection={CONNECTION.DEGRADED} nowMs={later} patients={stale} />);
    expect(degraded.container).toBeEmptyDOMElement();
  });

  it("names itself before it names a number", () => {
    show(<FeedHealth connection={LIVE} nowMs={NOW} patients={[{ patient_id: "S-001", measuredAt: measured }]} />);
    expect(screen.getByText("Cihaz və məlumat axını:")).toBeInTheDocument();
  });

  it("an empty board has no feed to report on", () => {
    const { container } = show(<FeedHealth connection={LIVE} nowMs={NOW} patients={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts a bed that was never wired apart from one that has stopped", () => {
    // Two different problems needing two different people (feedHealth.js, `absent` vs `stale`): a
    // bed the bridge never connected has sent nothing ever, and a bed that stopped sending was
    // working an hour ago. Counting them in one number told a biomedical engineer to go and look
    // at a monitor that is not plugged in to anything.
    show(<FeedHealth connection={LIVE} nowMs={NOW} patients={[
      { patient_id: "S-001", measuredAt: measured },
      { patient_id: "S-002", measuredAt: { heart_rate: ago(4_000) } },
      { patient_id: "S-003", measuredAt: {} },
    ]} />);
    expect(screen.getByText(/Səssiz çarpayı: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Heç ölçülməmiş çarpayı: 1/)).toBeInTheDocument();
  });

  it("a bed that has never been measured has no oldest instant to name", () => {
    show(<FeedHealth connection={LIVE} nowMs={NOW} patients={[{ patient_id: "S-002", measuredAt: {} }]} />);
    expect(screen.getByText(/Heç ölçülməmiş çarpayı: 1/)).toBeInTheDocument();
    expect(screen.queryByText(/Ən köhnə ölçmə:/)).toBeNull();
  });
});

describe("ChronicExpected", () => {
  it("says a downgraded finding is expected for this patient, in the reader's language", () => {
    show(<ChronicExpected alarm={{ downgraded: true, chronicContext: "Chronic COPD: baseline SpO2 88%." }} />);
    expect(screen.getByText(/Xəstənin öz normasına görə gözlənilən/)).toBeInTheDocument();
  });

  it("carries the engine's English reason in the accessible name, marked as English", () => {
    const reason = "Chronic COPD: baseline SpO2 88%.";
    const { container } = show(<ChronicExpected alarm={{ downgraded: true, chronicContext: reason }} />);
    const marked = container.querySelector('[lang="en"]');
    expect(marked).not.toBeNull();
    expect(marked.textContent).toContain(reason);
    // Visually hidden: the pill is read at a glance, the reason is for the clinician who asks.
    expect(marked.className).toContain("sr-only");
  });

  it("draws nothing for a finding the engine did not downgrade, and nothing for no finding", () => {
    for (const alarm of [{ downgraded: false }, { downgraded: "true" }, {}, null, undefined]) {
      const { container } = show(<ChronicExpected alarm={alarm} />);
      expect(container, JSON.stringify(alarm)).toBeEmptyDOMElement();
    }
  });
});

describe("useBoardNow", () => {
  // One frozen snapshot, returned by reference: `useSyncExternalStore` compares snapshots by
  // identity, and a `getState` that builds a fresh object every call renders forever (the real
  // store keeps one `state` object and replaces it only in `set`).
  const fakeBoard = (clockSkewMs) => {
    const state = Object.freeze({ patients: [], alerts: [], clockSkewMs });
    return { subscribe: () => () => {}, getState: () => state };
  };
  function Probe() {
    const now = useBoardNow(30_000);
    return <output>{String(now)}</output>;
  }
  const atBoard = (skew) => render(
    <I18nProvider><BoardProvider store={fakeBoard(skew)}><Probe /></BoardProvider></I18nProvider>,
  );

  it("moves the clock the screens age against onto the server's", () => {
    // Eight minutes behind: without this, every reading on every screen reads eight minutes
    // fresher than the engine believes it is.
    const skew = 8 * 60 * 1000;
    atBoard(skew);
    const shown = Number(screen.getByRole("status").textContent);
    expect(shown - Date.now()).toBeGreaterThan(skew - 2000);
    expect(shown - Date.now()).toBeLessThanOrEqual(skew);
  });

  it("corrects by nothing at all when no skew has been measured", () => {
    for (const unknown of [null, undefined, NaN, "600000"]) {
      const { unmount } = atBoard(unknown);
      const shown = Number(screen.getByRole("status").textContent);
      expect(Math.abs(shown - Date.now()), String(unknown)).toBeLessThan(2000);
      unmount();
    }
  });
});

describe("the accent colour of a risk tone", () => {
  it("covers every tone the engine's risks produce, in both tables", () => {
    // The card draws a fill and the patient screen a left border. If one table knows a tone the
    // other does not, the same finding is two colours on two screens.
    const tones = new Set(ENGINE_RISKS.map((r) => riskStyle(r, { measured: true }).tone));
    tones.add(riskStyle("something-new", { measured: true }).tone);     // the unvouchable case
    for (const tone of tones) {
      expect(RAIL[tone], `RAIL ${tone}`).toBeDefined();
      expect(RAIL_LEFT[tone], `RAIL_LEFT ${tone}`).toBeDefined();
    }
    expect(Object.keys(RAIL).sort()).toEqual(Object.keys(RAIL_LEFT).sort());
  });

  it("gives an `info` finding the QUIET colour on both, not the attention one", () => {
    // The bug this table replaced: `info` maps to `neutral`, and the patient screen's ternary
    // fell through to amber — which in this interface means "the screen cannot vouch for this".
    const { tone } = riskStyle("info", { measured: true });
    expect(tone).toBe("neutral");
    expect(railOf(tone)).toBe(RAIL.neutral);
    expect(railOf(tone, RAIL_LEFT)).toBe(RAIL_LEFT.neutral);
    expect(railOf(tone, RAIL_LEFT)).not.toBe(RAIL_LEFT.att);
  });

  it("an unknown tone reads as unvouchable, never as quiet", () => {
    expect(railOf("not-a-tone")).toBe(RAIL.att);
    expect(railOf(undefined, RAIL_LEFT)).toBe(RAIL_LEFT.att);
  });

  it("is never green", () => {
    for (const cls of [...Object.values(RAIL), ...Object.values(RAIL_LEFT)]) {
      expect(cls).not.toMatch(/ok|green|success/);
    }
  });
});

// The trend card prints the engine's facts and judges none of them. Every test here hands the card a
// fact that CONTRADICTS what the browser could have worked out for itself — points of 3 on a value
// that looks normal, a delta that is not the difference of the points drawn — and asserts the card
// shows the engine's, which is the only way to prove a browser did not judge.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../../../i18n/I18nProvider.jsx";
import { NOW, ago } from "../../../data/board.testutil.js";
import { CARDS, channelsOf } from "./cards.js";
import { TrendCard, deltaText } from "./TrendCard.jsx";
import { channel, point, trends } from "./trends.testutil.js";

const HR = CARDS.find((c) => c.id === "heart_rate");
const PRESSURE = CARDS.find((c) => c.id === "pressure");
const LACTATE = CARDS.find((c) => c.id === "lactate");

// `nowMs` is the screen's `useBoardNow` instant; a test about a card handed no clock passes `nowMs: undefined`.
function show(card, channels, { onOpen, ...clock } = {}) {
  render(
    <I18nProvider>
      <ul>
        <TrendCard card={card} channels={channelsOf(trends("S-001", channels))}
          nowMs={"nowMs" in clock ? clock.nowMs : NOW} onOpen={onOpen} />
      </ul>
    </I18nProvider>,
  );
  return document.querySelector("[data-frame]");
}

const latest = (over) => ({ ts: ago(300), value: 72, delta: null, news2_points: 0, within_own_normal: null, ...over });

describe("the trend card", () => {
  it("frames red and says NEWS2 +3 from the engine's points — for a value the browser would call normal", () => {
    const card = show(HR, [channel("heart_rate", [point(5, 72, 3)], { latest: latest({ news2_points: 3 }) })]);
    expect(card.dataset.frame).toBe("crit");
    expect(card).toHaveClass("border-crit");
    expect(screen.getByText("NEWS2 +3")).toBeInTheDocument();
  });

  it("frames amber for 1–2 points and not at all for 0", () => {
    const amber = show(HR, [channel("heart_rate", [point(5, 72, 2)], { latest: latest({ news2_points: 2 }) })]);
    expect(amber.dataset.frame).toBe("mid");
    expect(screen.getByText("NEWS2 +2")).toBeInTheDocument();
    document.body.innerHTML = "";
    const calm = show(HR, [channel("heart_rate", [point(5, 132, 0)], { latest: latest({ value: 132, news2_points: 0 }) })]);
    expect(calm.dataset.frame).toBe("none");
    expect(screen.queryByText(/NEWS2 \+/)).toBeNull();
  });

  it("frames nothing on a channel the engine gives no points (lactate, MAP)", () => {
    const card = show(LACTATE, [channel("lactate", [point(5, 9.9)], { latest: latest({ value: 9.9, news2_points: null }) })]);
    expect(card.dataset.frame).toBe("none");
    expect(screen.queryByText(/NEWS2/)).toBeNull();
  });

  it("shows the own-normal pill from the engine's verdict, beside the frame and not instead of it", () => {
    const card = show(HR, [channel("heart_rate", [point(5, 108, 1)],
      { latest: latest({ value: 108, news2_points: 1, within_own_normal: true }) })]);
    expect(screen.getByText("Xəstənin normasında")).toBeInTheDocument();
    expect(card.dataset.frame).toBe("mid");
    document.body.innerHTML = "";
    show(HR, [channel("heart_rate", [point(5, 108, 1)], { latest: latest({ value: 108, within_own_normal: false }) })]);
    expect(screen.queryByText("Xəstənin normasında")).toBeNull();
    document.body.innerHTML = "";
    show(HR, [channel("heart_rate", [point(5, 108, 1)], { latest: latest({ value: 108, within_own_normal: null }) })]);
    expect(screen.queryByText("Xəstənin normasında")).toBeNull();
  });

  it("prints the engine's delta — not the difference of the points it was given", () => {
    show(HR, [channel("heart_rate", [point(60, 84, 0), point(5, 90, 0)], { latest: latest({ value: 90, delta: 2 }) })]);
    expect(screen.getByText("↑ +2 (əvvəlkinə görə)")).toBeInTheDocument();
    expect(screen.queryByText(/\+6/)).toBeNull();
  });

  it("says rose, fell or unchanged to a screen reader, and hides the arrow it is drawn with", () => {
    const cases = [
      [2, "↑ +2 (əvvəlkinə görə)", "yüksəldi +2 (əvvəlkinə görə)"],
      [-3, "↓ −3 (əvvəlkinə görə)", "düşdü −3 (əvvəlkinə görə)"],
      [0, "→ 0 (əvvəlkinə görə)", "eyni (əvvəlkinə görə)"],
    ];
    for (const [delta, drawn, spoken] of cases) {
      document.body.innerHTML = "";
      show(HR, [channel("heart_rate", [point(5, 90, 0)], { latest: latest({ value: 90, delta }) })]);
      expect(screen.getByText(drawn), String(delta)).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByText(spoken), String(delta)).toHaveClass("sr-only");
    }
  });

  it("says when there was no previous measurement, and when there is none at all", () => {
    show(HR, [channel("heart_rate", [point(5, 84, 0)])]);
    expect(screen.getByText("tək ölçmə")).toBeInTheDocument();
    document.body.innerHTML = "";
    show(HR, []);
    expect(screen.getByText("Bu kanal üçün ölçmə yoxdur")).toBeInTheDocument();
  });

  it("says 'one measurement' only for a delta of null — any other non-number prints no delta at all", () => {
    for (const nothing of [undefined, Number.NaN, "2"]) {
      document.body.innerHTML = "";
      show(HR, [channel("heart_rate", [point(5, 84, 0)], { latest: latest({ value: 84, delta: nothing }) })]);
      expect(screen.queryByText("tək ölçmə"), String(nothing)).toBeNull();
      expect(screen.queryByText(/əvvəlkinə/), String(nothing)).toBeNull();
      expect(screen.getByText("84"), String(nothing)).toBeInTheDocument();
    }
  });

  it("says how long ago, against the clock it is handed", () => {
    show(HR, [channel("heart_rate", [point(5, 84, 0)])]);
    expect(screen.getByText("5 dəq əvvəl")).toBeInTheDocument();
  });

  it("prints no age at all when it is handed no clock — never the browser's own", () => {
    for (const none of [undefined, Number.NaN, null]) {
      document.body.innerHTML = "";
      const card = show(HR, [channel("heart_rate", [point(5, 84, 0)])], { nowMs: none });
      expect(card, String(none)).not.toHaveTextContent(/əvvəl/);
      expect(card, String(none)).toHaveTextContent("84");
    }
  });

  it("keeps the parts of a reading apart, so a reader does not hear '84/dəq↑ +2' as one word", () => {
    const card = show(HR, [channel("heart_rate", [point(5, 84, 0)], { latest: latest({ value: 84, delta: 2 }) })]);
    const text = card.querySelector("[data-series='heart_rate']").textContent;
    expect(text).toMatch(/84 \/dəq ↑ \+2 /);
    expect(text).toMatch(/ 5 dəq əvvəl$/);
  });

  it("prints the value in ink and keeps the channel's identity colour on the title", () => {
    const card = show(HR, [channel("heart_rate", [point(5, 84, 0)])]);
    expect(card.querySelector("[data-series='heart_rate'] b")).toHaveClass("text-ink");
    expect(card.querySelector("[data-series='heart_rate'] b")).not.toHaveClass("text-v-hr");
    expect(card.querySelector("[data-title]")).toHaveClass("text-v-hr");
  });

  it("keeps the frame the same width in every tone, so nothing moves when the tone does", () => {
    for (const points of [0, 2, 3]) {
      document.body.innerHTML = "";
      const card = show(HR, [channel("heart_rate", [point(5, 72, points)], { latest: latest({ news2_points: points }) })]);
      expect(card, String(points)).toHaveClass("border-2");
    }
  });

  it("says out loud that a NEWS2 channel was not scored — and frames nothing", () => {
    for (const points of [null, undefined, "3"]) {
      document.body.innerHTML = "";
      const card = show(HR, [channel("heart_rate", [point(5, 132, null)], { latest: latest({ value: 132, news2_points: points }) })]);
      expect(card.dataset.frame, String(points)).toBe("none");
      expect(screen.getByText("NEWS2: —"), String(points)).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByText("NEWS2: —").closest("[data-tone]"), String(points)).toHaveAttribute("data-tone", "warn");
      expect(screen.getByText("NEWS2 balı yoxdur: son ölçmə qiymətləndirilməyib"), String(points)).toHaveClass("sr-only");
      expect(screen.queryByText(/NEWS2 \+/), String(points)).toBeNull();
    }
  });

  it("says nothing about points where the engine has none to give (MAP, lactate)", () => {
    const card = show(PRESSURE, [
      channel("sbp", [point(5, 120, 0)], { latest: latest({ value: 120, news2_points: 0 }) }),
      channel("map", [point(5, 90)], { latest: latest({ value: 90, news2_points: null }) }),
    ]);
    expect(card.dataset.frame).toBe("none");
    expect(screen.queryByText(/NEWS2/)).toBeNull();
    document.body.innerHTML = "";
    show(LACTATE, [channel("lactate", [point(5, 2.1)], { latest: latest({ value: 2.1, news2_points: undefined }) })]);
    expect(screen.queryByText(/NEWS2/)).toBeNull();
  });

  it("puts systolic and MAP on one card, each named, framed by systolic's points", () => {
    const card = show(PRESSURE, [
      channel("sbp", [point(5, 88, 3)], { latest: latest({ value: 88, news2_points: 3 }) }),
      channel("map", [point(5, 58)], { latest: latest({ value: 58, news2_points: null }) }),
    ]);
    expect(card.dataset.frame).toBe("crit");
    expect(card.querySelector("[data-series='sbp']")).toHaveTextContent(/Sistolik AT\s*88/);
    expect(card.querySelector("[data-series='map']")).toHaveTextContent(/MAP\s*58/);
  });

  it("carries the badge on systolic's row, so the reader sees whose points they are — MAP's row has none", () => {
    const card = show(PRESSURE, [
      channel("sbp", [point(5, 88, 3)], { latest: latest({ value: 88, news2_points: 3 }) }),
      channel("map", [point(5, 58)], { latest: latest({ value: 58, news2_points: null }) }),
    ]);
    expect(card.querySelector("[data-series='sbp']")).toHaveTextContent("NEWS2 +3");
    expect(card.querySelector("[data-series='map']")).not.toHaveTextContent(/NEWS2/);
    expect(card.querySelector("[data-title]")).not.toHaveTextContent(/NEWS2/);
    document.body.innerHTML = "";
    const unscored = show(PRESSURE, [
      channel("sbp", [point(5, 88, null)], { latest: latest({ value: 88, news2_points: null }) }),
      channel("map", [point(5, 58)], { latest: latest({ value: 58, news2_points: null }) }),
    ]);
    expect(unscored.querySelector("[data-series='sbp']")).toHaveTextContent("NEWS2: —");
    expect(unscored.querySelector("[data-series='map']")).not.toHaveTextContent(/NEWS2/);
    expect(screen.getAllByText("NEWS2: —")).toHaveLength(1);
  });

  it("never frames a card from MAP — whatever points it is handed", () => {
    const card = show(PRESSURE, [
      channel("sbp", [point(5, 120, 0)], { latest: latest({ value: 120, news2_points: 0 }) }),
      channel("map", [point(5, 58)], { latest: latest({ value: 58, news2_points: 3 }) }),
    ]);
    expect(card.dataset.frame).toBe("none");
    expect(card).not.toHaveClass("border-crit");
    expect(screen.queryByText(/NEWS2/)).toBeNull();
  });

  it("is a button naming the chart it opens only when it can open one", () => {
    show(HR, [channel("heart_rate", [point(5, 84, 0)])]);
    expect(screen.queryByRole("button")).toBeNull();
    document.body.innerHTML = "";
    const onOpen = vi.fn();
    show(HR, [channel("heart_rate", [point(5, 84, 0)])], { onOpen });
    fireEvent.click(screen.getByRole("button", { name: /Nəbz: böyük qrafiki aç/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("deltaText", () => {
  it("writes the engine's number with an arrow for its sign, and nothing for no number", () => {
    expect([6, -3, 0, 0.3].map(deltaText)).toEqual(["↑ +6", "↓ −3", "→ 0", "↑ +0.3"]);
    expect([null, undefined, Number.NaN].map(deltaText)).toEqual([null, null, null]);
  });
});

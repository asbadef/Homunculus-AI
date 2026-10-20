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

function show(card, channels, { onOpen } = {}) {
  render(
    <I18nProvider>
      <ul><TrendCard card={card} channels={channelsOf(trends("S-001", channels))} nowMs={NOW} onOpen={onOpen} /></ul>
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
  });

  it("prints the engine's delta — not the difference of the points it was given", () => {
    show(HR, [channel("heart_rate", [point(60, 84, 0), point(5, 90, 0)], { latest: latest({ value: 90, delta: 2 }) })]);
    expect(screen.getByText("↑ +2 (əvvəlkinə görə)")).toBeInTheDocument();
    expect(screen.queryByText(/\+6/)).toBeNull();
  });

  it("says when there was no previous measurement, and when there is none at all", () => {
    show(HR, [channel("heart_rate", [point(5, 84, 0)])]);
    expect(screen.getByText("tək ölçmə")).toBeInTheDocument();
    document.body.innerHTML = "";
    show(HR, []);
    expect(screen.getByText("Bu kanal üçün ölçmə yoxdur")).toBeInTheDocument();
  });

  it("says how long ago, against the clock it is handed", () => {
    show(HR, [channel("heart_rate", [point(5, 84, 0)])]);
    expect(screen.getByText("5 dəq əvvəl")).toBeInTheDocument();
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

// The big chart: its window, its readout, its legend — read as the clinician reads them.
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { useState } from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { RETRACT_ALREADY } from "../../common/RetractDialog.jsx";
import { CARDS } from "./cards.js";
import { TrendModal } from "./TrendModal.jsx";
import { TrendsBox } from "./TrendsBox.jsx";
import { plotFrame, timeScale } from "./trendGeometry.js";
import { answering, channel, hand, marker, point, trends } from "./trends.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const card = (id) => CARDS.find((c) => c.id === id);
const HR_ANSWER = answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])],
  { hours, markers: [marker(60, "alarm", "news2")] }));
const down = () => Promise.reject(Object.assign(new Error("down"), { status: 503 }));
const HOUR = 3_600_000;

// The host stands in for the patient screen: a new measurement of the patient changes `measuredAt`,
// and the dialog re-reads the SAME window (useTrends' own rule).
let bump;
function Host({ id, bed, onClose, ...rest }) {
  const [n, setN] = useState(0);
  bump = () => setN((v) => v + 1);
  return <TrendModal card={card(id)} patient={{ ...PATIENT, measuredAt: { heart_rate: `r${n}` } }} bed={bed} onClose={onClose} {...rest} />;
}
const reread = () => act(async () => { bump(); await settle(); });

async function open(id = "heart_rate", answer = HR_ANSWER, { bed = "REA-01 · 2", onClose = () => {}, ...rest } = {}) {
  vi.setSystemTime(NOW);
  const mounted = await mount(<Host id={id} bed={bed} onClose={onClose} {...rest} />, {
    access: token(), me: profile(), setup: (api) => api.patientTrends.mockImplementation(answer),
  });
  await act(async () => { await settle(); });
  return mounted;
}
const dialog = () => screen.getByRole("dialog");
// The big chart takes the arrow keys, so it is an application to a screen reader, not an image (an
// image keeps NVDA and JAWS in browse mode, where the keys never reach the page). With nothing to step
// over it takes no keys and is the image it looks like.
const chart = () => within(dialog()).getByRole("application");
const quietChart = () => within(dialog()).getByRole("img");
const readout = () => dialog().querySelector("[data-readout]");
const legend = () => dialog().querySelector("[data-legend]");
const choose = (name) => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name })); await settle(); });
const xOf = (minutesAgo, hours = 24) => {
  const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
  return timeScale(NOW - hours * HOUR, NOW, frame.left, frame.right)(NOW - minutesAgo * 60_000);
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the big chart", () => {
  it("is titled with the bed, the patient and the channel", async () => {
    await open();
    expect(screen.getByRole("dialog", { name: "REA-01 · 2 · Ayşe Sentetik · Nəbz" })).toBeInTheDocument();
  });

  it("is titled without a leading separator when the bed's label is missing", async () => {
    await open("heart_rate", HR_ANSWER, { bed: "" });
    expect(screen.getByRole("dialog", { name: "Ayşe Sentetik · Nəbz" })).toBeInTheDocument();
  });

  it("reads 24 hours on open, and each window it is switched to", async () => {
    const { api } = await open();
    await choose("6 saat");
    await choose("3 gün");
    expect(api.patientTrends.mock.calls).toEqual([["S-001", 24], ["S-001", 6], ["S-001", 72]]);
    expect(within(dialog()).getByRole("button", { name: "3 gün" })).toHaveAttribute("aria-pressed", "true");
  });

  it("names the chart for a reader: what it shows and how many points it draws", async () => {
    await open();
    expect(chart()).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 2");
  });

  it("is an application to a screen reader, not an image — an image keeps NVDA and JAWS in browse mode, where ← → never arrive — and says what it is", async () => {
    await open();
    expect(chart()).toHaveAttribute("role", "application");
    expect(chart()).toHaveAttribute("aria-roledescription", "qrafik");
    expect(chart()).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 2");     // the name stays
    expect(within(dialog()).queryByRole("img")).toBeNull();
    expect(chart()).toHaveClass("rounded-ctl");                                           // the ring has a shape to follow
  });

  it("is a tab stop only while there is something to step over — no tabindex, no key hint, no keys described", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [], { hours })));
    expect(quietChart()).not.toHaveAttribute("tabindex");
    expect(quietChart()).not.toHaveAttribute("aria-describedby");
    expect(quietChart()).not.toHaveAttribute("aria-roledescription");
    expect(quietChart()).not.toHaveClass("rounded-ctl");                                  // no ring, no shape for it
    expect(dialog()).not.toHaveTextContent("← → əvvəlki / növbəti ölçmə");
  });

  it("is no tab stop on a pressure card with only MAP readings either — the cursor follows the first series, so there is no stop", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [channel("map", [point(60, 64)])], { hours })));
    expect(quietChart()).not.toHaveAttribute("tabindex");
    expect(quietChart()).not.toHaveAttribute("aria-describedby");
    expect(dialog()).not.toHaveTextContent("← → əvvəlki / növbəti ölçmə");
  });
});

describe("the big chart while it reads", () => {
  it("keeps its height while a window is read — an empty frame with the loading line in it, no chart", async () => {
    // Without the frame the dialog shrinks, the window buttons jump, and a second click lands on the backdrop.
    let release;
    await open("heart_rate", (pid, hours) => (hours === 6
      ? new Promise((resolve) => { release = () => resolve(trends(pid, [channel("heart_rate", [point(30, 90, 0)])], { hours })); })
      : HR_ANSWER(pid, hours)));
    await choose("6 saat");
    const frame = dialog().querySelector("[data-chart-frame]");
    expect(frame).not.toBeNull();
    expect(frame).toHaveClass("h-[280px]");                              // the plot's own height
    expect(frame).toHaveTextContent("Vital qrafikləri oxunur…");
    expect(within(dialog()).queryByRole("application")).toBeNull();
    expect(within(dialog()).queryByRole("img")).toBeNull();
    expect(within(dialog()).getByRole("button", { name: "6 saat" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => { release(); await settle(); });
    expect(chart()).toHaveAttribute("aria-label", "Nəbz: son 6 saat, çəkilən nöqtə 1");
    expect(dialog().querySelector("[data-chart-frame]")).toBeNull();
  });

  it("keeps the chart, and says since when, when a re-read of the same window fails", async () => {
    let fail = false;
    await open("heart_rate", (pid, hours) => (fail ? down() : HR_ANSWER(pid, hours)));
    fail = true;
    await reread();
    expect(dialog()).toHaveTextContent(`Vital qrafikləri oxuna bilmir (son: ${hhmm(NOW)})`);
    expect(chart()).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 2");
  });

  it("says it cannot read a window it never read — 'son: —' — and draws no chart, but keeps its height", async () => {
    await open("heart_rate", (pid, hours) => (hours === 6 ? down() : HR_ANSWER(pid, hours)));
    await choose("6 saat");
    expect(dialog()).toHaveTextContent("Vital qrafikləri oxuna bilmir (son: —)");
    expect(within(dialog()).queryByRole("application")).toBeNull();
    expect(within(dialog()).queryByRole("img")).toBeNull();
    expect(dialog().querySelector("[data-chart-frame]")).toHaveClass("h-[280px]");
    expect(dialog()).not.toHaveTextContent("Vital qrafikləri oxunur…");
  });
});

describe("the big chart's readout", () => {
  it("reads out the measurement under the mouse — its time, value and unit, and a mark in the same pixel column", async () => {
    await open();
    const svg = chart();
    expect(readout()).toHaveAttribute("aria-hidden", "true");
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
    fireEvent.mouseMove(svg, { clientX: xOf(60) });
    expect(readout()).toHaveTextContent(`${hhmm(NOW - HOUR)} · 132 /dəq · NEWS2 +3 · siqnal: news2`);
    fireEvent.mouseMove(svg, { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · 84 /dəq`);
    fireEvent.mouseLeave(svg);
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
  });

  it("names every mark at the instant under the cursor — two kinds first detected on one reading", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])],
      { hours, markers: [marker(60, "alarm", "news2"), marker(60, "alarm", "sepsis")] })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · 132 /dəq · NEWS2 +3 · siqnal: news2 · siqnal: sepsis`);
  });

  it("writes the date as well over three days, as the chart's own time labels do", async () => {
    await open();
    await choose("3 gün");
    fireEvent.mouseMove(chart(), { clientX: xOf(60, 72) });
    expect(readout().textContent).toBe(`${ddmm(NOW - HOUR)} ${hhmm(NOW - HOUR)} · 132 /dəq · NEWS2 +3 · siqnal: news2`);
  });

  it("reads MAP beside the systolic at the same instant on the pressure card — the vasopressor target", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]), channel("map", [point(120, 80), point(60, 64)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 · MAP 64 mmHg · NEWS2 +2`);
    fireEvent.mouseMove(chart(), { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · Sistolik AT 118 · MAP 80 mmHg`);
  });

  it("says MAP was not measured at that instant instead of leaving it out", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]), channel("map", [point(120, 80)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 · MAP — mmHg · NEWS2 +2`);
  });

  it("reads a MAP stamped seconds from the systolic beside it — the same pixel column — and takes the nearer one", async () => {
    // A 24-hour chart is about 150 s to a pixel: a MAP half a minute from the systolic is, on the
    // chart, the same moment, and "MAP —" beside a MAP the chart draws there would say it was not measured.
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]),
      channel("map", [point(119.8, 78), point(60.5, 70), point(59.8, 64)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 · MAP 64 mmHg · NEWS2 +2`);
    fireEvent.mouseMove(chart(), { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · Sistolik AT 118 · MAP 78 mmHg`);
  });

  it("gives a MAP read beside the systolic its own time when that reads differently — it does not borrow the systolic's", async () => {
    // 75 s before the systolic: inside the chart's pixel column (so it is read beside it), but another minute.
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]), channel("map", [point(120, 80), point(61.25, 70)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 mmHg · MAP 70 mmHg (${hhmm(NOW - 61.25 * 60_000)}) · NEWS2 +2`);
    fireEvent.mouseMove(chart(), { clientX: xOf(120) });                        // the same minute: no time of its own
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · Sistolik AT 118 · MAP 80 mmHg`);
  });

  it("stays on the instant it was reading when a re-read slides the window — not on the reading that took its index", async () => {
    let slid = false;
    const shift = 10 * 60_000;
    await open("heart_rate", answering((pid, hours) => (slid
      ? trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3), point(10, 90, 0)])],
        { hours, since: new Date(NOW - 24 * HOUR + shift).toISOString(), until: new Date(NOW + shift).toISOString() })
      : trends(pid, [channel("heart_rate", [point(180, 70, 0), point(120, 84, 0), point(60, 132, 3)])], { hours }))));
    fireEvent.mouseMove(chart(), { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · 84 /dəq`);
    slid = true;                                    // the 70 slid out of the front: index 1 is now the 132
    await reread();
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · 84 /dəq`);
    const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
    const x = timeScale(NOW - 24 * HOUR + shift, NOW + shift, frame.left, frame.right);
    expect(Number(dialog().querySelector("[data-cursor] line").getAttribute("x1"))).toBeCloseTo(x(NOW - 2 * HOUR));
  });

  it("lets the cursor go when the reading it was on slid out of the window", async () => {
    let slid = false;
    await open("heart_rate", answering((pid, hours) => (slid
      ? trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])], { hours })
      : trends(pid, [channel("heart_rate", [point(180, 70, 0), point(120, 84, 0), point(60, 132, 3)])], { hours }))));
    fireEvent.mouseMove(chart(), { clientX: xOf(180) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 3 * HOUR)} · 70 /dəq`);
    slid = true;
    await reread();
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
    expect(dialog().querySelector("[data-cursor]")).toBeNull();
  });

  it("prints no value for a reading that arrives without one — never 'NaN'", async () => {
    let blank = false;
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(120, 84, 0), blank ? point(60, null) : point(60, 132, 3)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · 132 /dəq · NEWS2 +3`);
    blank = true;
    await reread();
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · —`);
    expect(readout().textContent).not.toMatch(/NaN/);
  });

  it("names the reading's NEWS2 points between its value and its marks — the card's own badge text, the engine's number", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(180, 84, 0), point(120, 118, 2), point(60, 132, 3), point(30, 96, null)])],
    { hours, markers: [marker(120, "alarm", "news2")] })));
    fireEvent.mouseMove(chart(), { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · 118 /dəq · NEWS2 +2 · siqnal: news2`);
    // Where the engine scored the reading 0 the card wears no badge, and the readout adds nothing either.
    fireEvent.mouseMove(chart(), { clientX: xOf(180) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 3 * HOUR)} · 84 /dəq`);
    // Where the engine sent no points there is nothing to name, and nothing is worked out here.
    fireEvent.mouseMove(chart(), { clientX: xOf(30) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 30 * 60_000)} · 96 /dəq`);
  });

  it("names no points for lactate — a channel NEWS2 does not score", async () => {
    await open("lactate", answering((pid, hours) => trends(pid, [channel("lactate", [point(60, 4.1)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · 4.1 mmol/L`);
  });

  it("names no points for a MAP beside a systolic the engine sent none for — MAP is not scored either", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95)]), channel("map", [point(120, 80), point(60, 64)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 · MAP 64 mmHg`);
    fireEvent.mouseMove(chart(), { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · Sistolik AT 118 · MAP 80 mmHg`);
  });

  it("names no points for a reading that arrived without a value — a score with no measurement behind it", async () => {
    let blank = false;
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(120, 84, 0), blank ? point(60, null, 3) : point(60, 132, 3)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · 132 /dəq · NEWS2 +3`);
    blank = true;
    await reread();
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · —`);
  });

  it("says so — and gives no prompt to hover — when the window holds no reading to read", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [], { hours })));
    expect(readout()).toBeNull();
    expect(dialog().querySelector("[data-no-data]")).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");
    expect(dialog()).not.toHaveTextContent("Ölçməni oxumaq üçün");
    expect(quietChart()).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 0");
    expect(legend()).not.toBeNull();                                      // what the chart's marks mean still stands
  });

  it("counts a reading with no value as no reading", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(60, null), point(30, null)])], { hours })));
    expect(dialog().querySelector("[data-no-data]")).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");
    expect(quietChart()).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 0");
  });
});

describe("the big chart's legend", () => {
  it("is a list, so a screen reader that drops a bare list-style still counts its items", async () => {
    await open();
    expect(legend()).toHaveAttribute("role", "list");
  });

  it("explains every mark in words: the server's NEWS2 source, both band tones, both marks, the dashed line", async () => {
    await open();
    expect(legend()).toHaveTextContent("NEWS2 zolağı (yetkin) · mənbə news2-rcp-2017");
    // ▲ is where an alarm episode began (G2-A1, O17): one mark per episode.
    for (const words of ["1–2 bal", "3 bal", "siqnalın başladığı an", "antibiotik", "nöqtələr ölçmədir; aralarındakı qırıq xətt ölçmə deyil"]) {
      expect(legend()).toHaveTextContent(words);
    }
    expect(legend()).not.toHaveTextContent("xəstənin norması");            // none charted
    expect(legend()).not.toHaveTextContent("işarələrin hamısı");           // the server read every mark
  });

  it("leaves out what does not apply: nothing thinned, and no 'MAP is not scored' line without a second series", async () => {
    await open();
    expect(legend()).not.toHaveTextContent("seyrəldildi");
    expect(legend()).not.toHaveTextContent("qiymətləndirilmir");
  });

  it("says a channel was thinned, and from how many", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(90, 84, 0), point(60, 90, 0), point(30, 96, 1)], { thinned: true, total_points: 2500 })], { hours })));
    expect(legend()).toHaveTextContent("Nəbz seyrəldildi: 2500 nöqtədən 3");
  });

  it("draws systolic and MAP as two series of one chart, named in the legend", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(60, 118, 0)]), channel("map", [point(60, 80)])], { hours })));
    const svg = chart();
    expect(svg.querySelector("[data-series='sbp']")).not.toBeNull();
    // Hollow on the dialog's own ground (bg-app), not a card's: a card-coloured disc would show on it.
    expect(svg.querySelector("[data-series='map'] circle")).toHaveClass("fill-app");
    expect(legend().querySelector("circle.fill-app")).not.toBeNull();
    expect(legend()).toHaveTextContent(/Sistolik AT.*MAP/);
    // MAP is drawn over the systolic rows but is not a NEWS2 parameter: the legend says so in words.
    expect(legend()).toHaveTextContent("MAP NEWS2-də qiymətləndirilmir; zolaqlar Sistolik AT üçündür");
    expect(legend()).not.toHaveTextContent("seyrəldildi");
  });

  it("says when the server's read of the marks stopped at its limit", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(60, 84, 0)])],
      { hours, markers_truncated: true })));
    expect(legend()).toHaveTextContent("işarələrin hamısı oxunmadı: ən yeniləri çatışmaya bilər");
  });

  it("shows no NEWS2 band in the legend of a channel the engine scores none for", async () => {
    await open("lactate", answering((pid, hours) => trends(pid, [channel("lactate", [point(60, 4.1)])], { hours })));
    expect(legend()).not.toHaveTextContent("NEWS2");
  });
});

describe("the big chart's value labels", () => {
  it("label a lone reading with its own value, so the chart has a number on it", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(60, 85, 0)])], { hours })));
    const labels = [...chart().querySelectorAll("[data-tick='value'] text")].map((t) => t.textContent);
    expect(labels).toEqual(["85"]);
  });

  it("write a lactate to the tenth, not to the step", async () => {
    await open("lactate", answering((pid, hours) => trends(pid, [channel("lactate", [point(60, 4.1)])], { hours })));
    const labels = [...chart().querySelectorAll("[data-tick='value'] text")].map((t) => t.textContent);
    expect(labels).toEqual(["4.1"]);
  });
});

describe("the big chart by keyboard", () => {
  const THREE = answering((pid, hours) => trends(pid, [channel("heart_rate",
    [point(180, 80, 0), point(120, 84, 0), point(60, 132, 3)])], { hours }));
  const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

  it("is one tab stop, its keys described in words", async () => {
    await open("heart_rate", THREE);
    const svg = chart();
    expect(svg).toHaveAttribute("tabindex", "0");
    expect(document.getElementById(svg.getAttribute("aria-describedby")))
      .toHaveTextContent("Qrafik seçiləndə ← → əvvəlki / növbəti ölçmə, Home/End ilk / son ölçmə.");
  });

  it("walks the measurements with ← → Home End, and the readout follows", async () => {
    await open("heart_rate", THREE);
    const svg = chart();
    svg.focus();                                                        // keys go to the focused chart, as for a user
    expect(document.activeElement).toBe(svg);
    const readout = () => dialog().querySelector("[data-readout]").textContent;
    const press = (key) => fireEvent.keyDown(svg, { key });
    press("ArrowRight");
    expect(readout()).toBe(`${hhmm(NOW - 3 * 3_600_000)} · 80 /dəq`);
    press("ArrowRight");
    expect(readout()).toBe(`${hhmm(NOW - 2 * 3_600_000)} · 84 /dəq`);
    press("End");
    expect(readout()).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq · NEWS2 +3`);
    press("ArrowRight");                                                // stays on the last
    expect(readout()).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq · NEWS2 +3`);
    press("Home");
    press("ArrowLeft");                                                 // stays on the first
    expect(readout()).toBe(`${hhmm(NOW - 3 * 3_600_000)} · 80 /dəq`);
    expect(svg.querySelector("[data-cursor]")).not.toBeNull();
  });

  it("says the readout once after a keyboard move, and nothing after the mouse", async () => {
    await open("heart_rate", THREE);
    const svg = chart();
    svg.focus();
    const region = within(dialog()).getByRole("status");
    fireEvent.mouseMove(svg, { clientX: xOf(60) });
    await wait(200);
    expect(region).toHaveTextContent("");
    fireEvent.keyDown(svg, { key: "End" });
    await wait(200);
    expect(region.textContent).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq · NEWS2 +3`);
    fireEvent.mouseMove(svg, { clientX: xOf(120) });
    await wait(200);
    expect(region.textContent).toBe("");
  });

  it("says the reading's NEWS2 points once per move, in the one announcement — the readout's own words", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(180, 80, 0), point(120, 118, 2), point(60, 96, null)])], { hours })));
    const svg = chart();
    svg.focus();
    const region = within(dialog()).getByRole("status");
    fireEvent.keyDown(svg, { key: "ArrowRight" });                      // scored 0: nothing to add
    await wait(200);
    expect(region.textContent).toBe(`${hhmm(NOW - 3 * 3_600_000)} · 80 /dəq`);
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    await wait(200);
    expect(region.textContent).toBe(`${hhmm(NOW - 2 * 3_600_000)} · 118 /dəq · NEWS2 +2`);
    expect(region.textContent.match(/NEWS2/g)).toHaveLength(1);
    expect(dialog().querySelector("[data-readout]").textContent).toBe(region.textContent);
    fireEvent.keyDown(svg, { key: "ArrowRight" });                      // the engine sent no points: none are made up
    await wait(200);
    expect(region.textContent).toBe(`${hhmm(NOW - 3_600_000)} · 96 /dəq`);
  });

  it("says nothing for a chart nobody can see: switching to the table lets the cursor go, and the announcement with it", async () => {
    await open("heart_rate", THREE);
    const region = within(dialog()).getByRole("status");
    chart().focus();
    fireEvent.keyDown(chart(), { key: "End" });
    await wait(200);
    expect(region.textContent).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq · NEWS2 +3`);
    await act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Cədvəl" })); await settle(); });
    expect(region.textContent).toBe("");                                // emptied at once, not said again
    await act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Qrafik" })); await settle(); });
    await wait(200);
    expect(region.textContent).toBe("");                                // back on the chart: no cursor, nothing to say
    expect(chart().querySelector("[data-cursor]")).toBeNull();
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
  });

  it("closes on Escape pressed on the focused chart — the keys it takes do not swallow that one", async () => {
    const onClose = vi.fn();
    await open("heart_rate", THREE, { onClose });
    chart().focus();
    fireEvent.keyDown(chart(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves a key pressed with Alt, Ctrl or Meta to the browser — Alt+← is Back, Ctrl+Home is the top of the page", async () => {
    await open("heart_rate", THREE);
    const svg = chart();
    svg.focus();
    for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
      for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
        // fireEvent returns false when the handler called preventDefault.
        expect(fireEvent.keyDown(svg, { key, [modifier]: true }), `${modifier} ${key}`).toBe(true);
      }
    }
    expect(svg.querySelector("[data-cursor]")).toBeNull();
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
    expect(fireEvent.keyDown(svg, { key: "End" })).toBe(false);          // the plain key is the chart's
  });
});

describe("the big chart as a table", () => {
  const MIXED = answering((pid, hours) => trends(pid, [channel("heart_rate",
    [point(180, 80, 0), point(120, 72, 3), point(60, 132, 3)])], { hours, markers: [marker(90, "antibiotic")] }));
  const toTable = () => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Cədvəl" })); await settle(); });
  const table = async (title = "Nəbz") => {
    await toTable();
    return within(dialog()).getByRole("table", { name: `${title} — ölçmələr, ən yenisi yuxarıda` });
  };
  const PRESSURE = answering((pid, hours) => trends(pid, [
    channel("sbp", [point(180, 118, 0), point(120, 95, null), point(60, 101, 1)]),
    channel("map", [point(180, 80), point(120, 64), point(60, 70)])], { hours }));

  it("holds exactly what the chart draws, newest first", async () => {
    await open("heart_rate", MIXED);
    const drawn = [...chart().querySelectorAll("circle[data-value]")]
      .map((c) => [c.dataset.ts, c.dataset.value]);
    const listed = [...(await table()).querySelectorAll("tr[data-value]")].map((r) => [r.dataset.ts, r.dataset.value]);
    expect(listed).toEqual([...drawn].reverse());
  });

  it("prints the engine's points for each reading — 72 with +3 because the server said 3", async () => {
    await open("heart_rate", MIXED);
    const row = (await table()).querySelector("tr[data-value='72']");
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["72", "/dəq", "+3", ""]);
  });

  it("gives each mark a row of its own, in time order with the readings", async () => {
    await open("heart_rate", MIXED);
    const rows = [...(await table()).querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.dataset.value ?? r.dataset.mark)).toEqual(["132", "antibiotic", "72", "80"]);
    expect(rows[1]).toHaveTextContent("antibiotik");
  });

  it("lists two readings at one instant as two rows — each its own, not two under one repeated key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
        [point(120, 84, 0), point(60, 130, 2), point(60, 132, 3)])], { hours })));
      const values = [...(await table()).querySelectorAll("tr[data-value]")].map((r) => r.dataset.value);
      // Newest first: at one instant the later reading — the one the chart and the readout take — is on top.
      expect(values).toEqual(["132", "130", "84"]);
      expect(error.mock.calls.filter(([message]) => /same key/.test(String(message)))).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });

  it("adds a row for a newer reading and leaves the rows already there alone — the same elements, not a body rebuilt at each poll", async () => {
    let newer = false;
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(180, 80, 0), point(120, 84, 0), ...(newer ? [point(30, 90, 1)] : [])])], { hours })));
    await table();
    const oldest = dialog().querySelector("tr[data-value='80']");
    const middle = dialog().querySelector("tr[data-value='84']");
    newer = true;
    await reread();
    expect(dialog().querySelectorAll("tbody tr")).toHaveLength(3);
    expect(dialog().querySelector("tr[data-value='90']")).not.toBeNull();
    // Newest first, so the new row is added at the top: a key by position would hand every row its
    // neighbour's element instead.
    expect(dialog().querySelector("tr[data-value='80']")).toBe(oldest);
    expect(dialog().querySelector("tr[data-value='84']")).toBe(middle);
  });

  it("has no row for a reading that arrived without a value — the chart draws no dot for it, so the table lists none", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, null)])], { hours })));
    const rows = [...(await table()).querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.dataset.value)).toEqual(["84"]);
    expect(dialog().querySelector("[data-value='NaN']")).toBeNull();
  });

  it("holds what the chart draws on the pressure card too — both series, every reading once, newest first", async () => {
    await open("pressure", PRESSURE);
    const drawn = [...chart().querySelectorAll("circle[data-value]")]
      .map((c) => [c.closest("[data-series]").dataset.series, c.dataset.ts, c.dataset.value]);
    const listed = [...(await table("Sistolik AT · MAP")).querySelectorAll("tr[data-value]")]
      .map((r) => [r.dataset.series, r.dataset.ts, r.dataset.value]);
    const keyed = (rows) => rows.map((row) => row.join("|")).sort();
    expect(drawn).toHaveLength(6);
    expect(keyed(listed)).toEqual(keyed(drawn));
    const instants = listed.map(([, ts]) => Date.parse(ts));
    expect(instants).toEqual([...instants].sort((a, b) => b - a));
  });

  it("prints the engine's points for a NEWS2 channel, a reason for one it sent none for, and nothing for MAP", async () => {
    await open("pressure", PRESSURE);
    const grid = await table("Sistolik AT · MAP");
    const cells = (series, value) => within(grid.querySelector(`tr[data-series='${series}'][data-value='${value}']`)).getAllByRole("cell");
    expect(cells("sbp", 118).map((c) => c.textContent)).toEqual(["Sistolik AT", "118", "mmHg", "0", ""]);
    expect(cells("sbp", 101)[3]).toHaveTextContent("+1");
    // The engine sent no points for this systolic reading: a dash, and the reason for a screen reader.
    const unscored = cells("sbp", 95)[3];
    expect(within(unscored).getByText("—")).toHaveAttribute("aria-hidden", "true");
    // Worded for the row it is in: this reading, not "the last one" (that is the card's sentence).
    expect(unscored).toHaveTextContent("NEWS2 balı yoxdur: bu ölçmə qiymətləndirilməyib");
    expect(unscored).not.toHaveTextContent("son ölçmə");
    // MAP is not a NEWS2 parameter: its cell is empty — not a dash that reads as a missing score.
    for (const value of [80, 64, 70]) expect(cells("map", value)[3].textContent).toBe("");
  });

  it("carries the legend's notes into the table — thinned, marks cut short, when an alarm began — but not the chart's swatches", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(90, 84, 0), point(60, 90, 0), point(30, 96, 1)], { thinned: true, total_points: 2500 })], { hours, markers_truncated: true })));
    await table();
    const notes = dialog().querySelector("[data-notes]");
    expect(notes).toHaveAttribute("role", "list");
    expect(notes).toHaveTextContent("Nəbz seyrəldildi: 2500 nöqtədən 3");
    expect(notes).toHaveTextContent("işarələrin hamısı oxunmadı: ən yeniləri çatışmaya bilər");
    expect(notes).toHaveTextContent("siqnalın başladığı an");
    expect(dialog().querySelector("[data-legend]")).toBeNull();
  });

  it("says MAP is not scored by NEWS2 under the pressure table too, and leaves out what does not apply", async () => {
    await open("pressure", PRESSURE);
    await table("Sistolik AT · MAP");
    const notes = dialog().querySelector("[data-notes]");
    expect(notes).toHaveTextContent("MAP NEWS2-də qiymətləndirilmir; zolaqlar Sistolik AT üçündür");
    expect(notes).not.toHaveTextContent("seyrəldildi");
    expect(notes).not.toHaveTextContent("işarələrin hamısı");
  });

  it("says there is no measurement instead of showing an empty captioned table", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [], { hours })));
    await toTable();
    expect(dialog().querySelector("[data-no-data]")).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");
    expect(within(dialog()).queryByRole("table")).toBeNull();
    expect(dialog().querySelector("[data-notes]")).not.toBeNull();         // what the marks mean still stands
  });

  it("lists the marks when there is no reading, under the same no-measurement line", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [], { hours, markers: [marker(90, "antibiotic")] })));
    await toTable();
    expect(dialog().querySelector("[data-no-data]")).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");
    const rows = [...within(dialog()).getByRole("table").querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.dataset.mark)).toEqual(["antibiotic"]);
  });

  it("is a real table: a caption, column headers, and the time heading each row", async () => {
    await open("heart_rate", MIXED);
    const grid = await table();
    expect(within(grid).getAllByRole("columnheader").map((h) => h.textContent))
      .toEqual(["Vaxt", "Dəyər", "Vahid", "NEWS2 balı", "Hadisə"]);
    expect(within(grid).getAllByRole("rowheader")).toHaveLength(4);
  });
});

describe("the big chart, opening and reading", () => {
  it("opens with focus on the pressed window option — what the dialog shows — not on the first control", async () => {
    await open();
    expect(document.activeElement).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toHaveTextContent("24 saat");
  });

  it("names a mark beside a reading with its own time when that reads differently", async () => {
    // 61 minutes ago is within one pixel column of the 60-minute reading on a 24-hour chart, but not
    // its minute: the readout must not give the mark the reading's time.
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])],
      { hours, markers: [marker(61, "alarm", "news2")] })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(dialog().querySelector("[data-readout]").textContent)
      .toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq · NEWS2 +3 · siqnal: news2 (${hhmm(NOW - 61 * 60_000)})`);
  });

  it("takes two readings at one instant as one keyboard stop, read as the later one", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(120, 84, 0), point(60, 130, 2), point(60, 132, 3)])], { hours })));
    const svg = chart();
    const readout = () => dialog().querySelector("[data-readout]").textContent;
    fireEvent.keyDown(svg, { key: "Home" });
    expect(readout()).toBe(`${hhmm(NOW - 7_200_000)} · 84 /dəq`);
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(readout()).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq · NEWS2 +3`);
    fireEvent.keyDown(svg, { key: "ArrowRight" });                     // no third stop
    expect(readout()).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq · NEWS2 +3`);
  });
});

// G3-01 (D1, D13, X13): what was typed by hand, and what was withdrawn as «hatalı giriş».
const BY_HAND = answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)], {
  manual: [hand(41, 60, 132), hand(42, 30, 182, { retracted: { reason: "yanlış hasta seçilmişti", minutesAgo: 20 } })],
})], { hours }));
const named = (name) => screen.getByRole("dialog", { name });

describe("the big chart, by hand", () => {
  it("says «əl ilə» on a hand reading in the readout and the table, and lists a withdrawn one struck through", async () => {
    await open("heart_rate", BY_HAND);
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq · əl ilə · NEWS2 +3`);
    await choose("Cədvəl");
    const typed = dialog().querySelector(`tr[data-ts="${point(60, 0)[0]}"]`);
    expect(typed).toHaveTextContent("əl ilə");
    expect(within(typed).queryByRole("button")).toBeNull();          // no withdrawal without the right
    const withdrawn = dialog().querySelector('tr[data-withdrawn="42"]');
    expect(withdrawn.querySelector("s")).toHaveTextContent("182");
    // A screen reader does not read <s> as struck: the row says it in words beside the number.
    expect(withdrawn.querySelector("s + .sr-only")).toHaveTextContent("səhv qeyd kimi işarələndi");
    expect(withdrawn).toHaveTextContent(`səhv qeyd — yanlış hasta seçilmişti · hem.ayse · ${hhmm(NOW - 20 * 60_000)}`);
  });

  it("draws a withdrawn value crossed in the muted ink — never at an opacity the charts' contrast test cannot see — and says what the cross means", async () => {
    await open("heart_rate", BY_HAND);
    const cross = chart().querySelector('[data-withdrawn="42"]');
    expect(cross).not.toBeNull();
    expect(cross).toHaveClass("text-mute");
    expect(cross).not.toHaveAttribute("opacity");
    expect(dialog()).toHaveTextContent("Üstüxətli nöqtə: səhv qeyd — bala daxil edilmir; səbəbi cədvəldədir.");
  });

  it("holds the withdrawn value on the big chart's value axis (X16)", async () => {
    await open("heart_rate", BY_HAND);
    // 84, 132 and the withdrawn 182: domain 69.3–196.7, step 50 → 100, 150. Without the 182 it would be 100, 120.
    const labels = [...chart().querySelectorAll("[data-tick='value'] text")].map((t) => t.textContent);
    expect(labels).toEqual(["100", "150"]);
    const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
    const cy = Number(chart().querySelector('[data-withdrawn="42"] circle').getAttribute("cy"));
    expect(cy).toBeGreaterThanOrEqual(frame.top);
    expect(cy).toBeLessThanOrEqual(frame.bottom);
  });

  it("offers «Səhv qeyd» on a hand row to a clinical.chart holder, withdraws through the host and reads again", async () => {
    const onRetract = vi.fn(() => Promise.resolve({ retracted: 41, code: "heart_rate", alerts: [] }));
    const { api } = await open("heart_rate", BY_HAND, { canRetract: true, onRetract });
    await choose("Cədvəl");
    const reads = api.patientTrends.mock.calls.length;
    const typed = named("REA-01 · 2 · Ayşe Sentetik · Nəbz").querySelector(`tr[data-ts="${point(60, 0)[0]}"]`);
    await act(async () => { fireEvent.click(within(typed).getByRole("button", { name: "Səhv qeyd" })); await settle(); });
    const retract = named("Səhv qeyd · REA-01 · 2");
    expect(retract).toHaveTextContent("Nəbz: 132 /dəq · ölçmə");
    fireEvent.change(within(retract).getByRole("textbox"), { target: { value: "monitör başka hastadaydı" } });
    // The dialog ignores a press for its first RETRACT_ARM_MS (real timers in this file): wait it out.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    await act(async () => { fireEvent.click(within(retract).getByRole("button", { name: "Səhv qeyd kimi işarələ" })); await settle(); });
    expect(onRetract).toHaveBeenCalledWith(41, "monitör başka hastadaydı");
    expect(api.patientTrends.mock.calls.length).toBeGreaterThan(reads);
  });
});

// G3-01, review of Task 16: who may withdraw what, the re-read on every ending, where focus goes, and the box's wiring.
const CHARTABLE = ["board.view", "alerts.ack", "clinical.chart"];
const REASON = "monitör başka hastadaydı";
const typedRow = () => named("REA-01 · 2 · Ayşe Sentetik · Nəbz").querySelector(`tr[data-ts="${point(60, 0)[0]}"]`);
const typedButton = () => within(typedRow()).getByRole("button", { name: "Səhv qeyd" });

/** «Səhv qeyd» on the hand row of 60 minutes ago, pressed as a user does (it takes focus, so the dialog's opener is
 *  the button), then a reason, the arming window waited out (real timers in this file), the confirm, the re-read. */
async function withdrawTyped() {
  const button = typedButton();
  button.focus();
  await act(async () => { fireEvent.click(button); await settle(); });
  const retract = named("Səhv qeyd · REA-01 · 2");
  fireEvent.change(within(retract).getByRole("textbox"), { target: { value: REASON } });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
  await act(async () => { fireEvent.click(within(retract).getByRole("button", { name: "Səhv qeyd kimi işarələ" })); await settle(); });
  await act(async () => { await settle(); });
}

/** The heart rate with the hand entry 41 at 60 minutes ago — until `state.after` says what the re-read shows:
 *  "struck" (the engine withdrew it: no point, the entry retracted), "gone" (neither the point nor a struck row). */
function changing(state) {
  return answering((pid, hours) => {
    if (state.after === "struck") {
      return trends(pid, [channel("heart_rate", [point(120, 84, 0)], {
        manual: [hand(41, 60, 132, { retracted: { reason: REASON, minutesAgo: 1 } })],
      })], { hours });
    }
    if (state.after === "gone") return trends(pid, [channel("heart_rate", [point(120, 84, 0)])], { hours });
    return trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)], { manual: [hand(41, 60, 132)] })], { hours });
  });
}

describe("the big chart, withdrawing", () => {
  it("offers no «Səhv qeyd» on a device's reading, even to a clinical.chart holder", async () => {
    await open("heart_rate", BY_HAND, { canRetract: true, onRetract: vi.fn() });
    await choose("Cədvəl");
    const device = dialog().querySelector(`tr[data-ts="${point(120, 0)[0]}"]`);
    expect(device).not.toHaveTextContent("əl ilə");
    expect(within(device).queryByRole("button")).toBeNull();
    expect(within(typedRow()).getByRole("button", { name: "Səhv qeyd" })).toBeInTheDocument();
  });

  it("describes each «Səhv qeyd» by its row — the time and the value — so a screen reader tells them apart", async () => {
    await open("heart_rate", BY_HAND, { canRetract: true, onRetract: vi.fn() });
    await choose("Cədvəl");
    expect(typedButton()).toHaveAccessibleDescription(`${hhmm(NOW - HOUR)} 132`);
  });

  it("reads the window again when the engine says another desk withdrew it first («already»)", async () => {
    const onRetract = vi.fn(() => Promise.reject(refusal(409, RETRACT_ALREADY)));
    const { api } = await open("heart_rate", BY_HAND, { canRetract: true, onRetract });
    await choose("Cədvəl");
    const reads = api.patientTrends.mock.calls.length;
    await withdrawTyped();
    expect(onRetract).toHaveBeenCalledWith(41, REASON);
    expect(api.patientTrends.mock.calls.length).toBe(reads + 1);
  });

  it("reads the window again when the withdrawal had no answer — it may have landed («uncertain»)", async () => {
    const onRetract = vi.fn(() => Promise.reject(refusal(503, "down")));
    const { api } = await open("heart_rate", BY_HAND, { canRetract: true, onRetract });
    await choose("Cədvəl");
    const reads = api.patientTrends.mock.calls.length;
    await withdrawTyped();
    expect(api.patientTrends.mock.calls.length).toBe(reads + 1);
  });

  it("gives focus to the struck row once the re-read shows it — the button that had it has left the page", async () => {
    const state = { after: null };
    const onRetract = vi.fn(() => {
      state.after = "struck";
      return Promise.resolve({ retracted: 41, code: "heart_rate", alerts: [] });
    });
    await open("heart_rate", changing(state), { canRetract: true, onRetract });
    await choose("Cədvəl");
    await withdrawTyped();
    const struck = dialog().querySelector('tr[data-withdrawn="41"]');
    expect(struck).not.toBeNull();
    expect(struck).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(struck);
  });

  it("leaves focus on the row's button when the withdrawal had no answer and the value still stands", async () => {
    const onRetract = vi.fn(() => Promise.reject(refusal(503, "down")));
    await open("heart_rate", changing({ after: null }), { canRetract: true, onRetract });
    await choose("Cədvəl");
    await withdrawTyped();
    expect(document.activeElement).toBe(typedButton());
  });

  it("gives focus to the pressed «Cədvəl» when the re-read shows neither the row nor a struck one", async () => {
    const state = { after: null };
    const onRetract = vi.fn(() => {
      state.after = "gone";
      return Promise.reject(refusal(503, "down"));
    });
    await open("heart_rate", changing(state), { canRetract: true, onRetract });
    await choose("Cədvəl");
    await withdrawTyped();
    expect(dialog().querySelector(`tr[data-ts="${point(60, 0)[0]}"]`)).toBeNull();
    expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "Cədvəl" }));
  });

  it("closes «Səhv qeyd» when the dialog is handed another patient — the withdrawal was opened for the first", async () => {
    let move;
    function Moving({ onRetract }) {
      const [id, setId] = useState("S-001");
      move = () => setId("S-002");
      return (
        <TrendModal card={card("heart_rate")} patient={{ ...PATIENT, patient_id: id }} bed="REA-01 · 2" onClose={() => {}}
          canRetract onRetract={onRetract} />
      );
    }
    const onRetract = vi.fn();
    vi.setSystemTime(NOW);
    await mount(<Moving onRetract={onRetract} />, {
      access: token(), me: profile(), setup: (api) => api.patientTrends.mockImplementation(BY_HAND),
    });
    await act(async () => { await settle(); });
    await choose("Cədvəl");
    await act(async () => { fireEvent.click(typedButton()); await settle(); });
    expect(screen.getByRole("dialog", { name: "Səhv qeyd · REA-01 · 2" })).toBeInTheDocument();
    await act(async () => { move(); await settle(); });
    expect(screen.queryByRole("dialog", { name: "Səhv qeyd · REA-01 · 2" })).toBeNull();
    expect(onRetract).not.toHaveBeenCalled();
  });
});

describe("the big chart, by hand, on the pressure card", () => {
  it("says «əl ilə» after the value that was typed by hand — the MAP's or the systolic's, each its own", async () => {
    let typed = "map";
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)], { manual: typed === "sbp" ? [hand(51, 60, 95)] : [] }),
      channel("map", [point(120, 80), point(60, 64)], { manual: typed === "map" ? [hand(52, 60, 64)] : [] })], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 mmHg · MAP 64 mmHg əl ilə · NEWS2 +2`);
    fireEvent.mouseMove(chart(), { clientX: xOf(120) });                     // neither by hand: as before
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · Sistolik AT 118 · MAP 80 mmHg`);
    typed = "sbp";
    await reread();
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 mmHg əl ilə · MAP 64 mmHg · NEWS2 +2`);
  });
});

describe("the trends box, withdrawing", () => {
  it("offers «Səhv qeyd» to a clinical.chart holder, withdraws through the board's store, and reads the box's own 24 hours again", async () => {
    vi.setSystemTime(NOW);
    const { api } = await mount(<TrendsBox patient={PATIENT} bed="REA-01 · 2" nowMs={NOW} />, {
      access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }),
      setup: (a) => {
        a.patientTrends.mockImplementation(BY_HAND);
        a.retractEntry.mockResolvedValue({ retracted: 41, code: "heart_rate", alerts: [] });
      },
    });
    await act(async () => { await settle(); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Nəbz: böyük qrafiki aç/ })); await settle(); });
    await choose("6 saat");             // the dialog reads its own window; the box's cards keep reading 24 hours
    await choose("Cədvəl");
    const day = () => api.patientTrends.mock.calls.filter(([, hours]) => hours === 24).length;
    const before = day();
    await withdrawTyped();
    expect(api.retractEntry).toHaveBeenCalledWith("S-001", 41, REASON);
    // The card's delta and mini chart are the box's read: a withdrawn value that was not the latest moves no
    // measured instant, so without this read the card would keep it for up to a minute.
    expect(day()).toBe(before + 1);
  });
});

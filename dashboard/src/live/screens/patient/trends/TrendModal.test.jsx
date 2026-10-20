// The big chart: its window, its readout, its legend — read as the clinician reads them.
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { useState } from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { CARDS } from "./cards.js";
import { TrendModal } from "./TrendModal.jsx";
import { plotFrame, timeScale } from "./trendGeometry.js";
import { answering, channel, marker, point, trends } from "./trends.testutil.js";

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
function Host({ id, bed }) {
  const [n, setN] = useState(0);
  bump = () => setN((v) => v + 1);
  return <TrendModal card={card(id)} patient={{ ...PATIENT, measuredAt: { heart_rate: `r${n}` } }} bed={bed} onClose={() => {}} />;
}
const reread = () => act(async () => { bump(); await settle(); });

async function open(id = "heart_rate", answer = HR_ANSWER, { bed = "REA-01 · 2" } = {}) {
  vi.setSystemTime(NOW);
  const mounted = await mount(<Host id={id} bed={bed} />, {
    access: token(), me: profile(), setup: (api) => api.patientTrends.mockImplementation(answer),
  });
  await act(async () => { await settle(); });
  return mounted;
}
const dialog = () => screen.getByRole("dialog");
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
    expect(within(dialog()).getByRole("img")).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 2");
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
    expect(within(dialog()).queryByRole("img")).toBeNull();
    expect(within(dialog()).getByRole("button", { name: "6 saat" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => { release(); await settle(); });
    expect(within(dialog()).getByRole("img")).toHaveAttribute("aria-label", "Nəbz: son 6 saat, çəkilən nöqtə 1");
    expect(dialog().querySelector("[data-chart-frame]")).toBeNull();
  });

  it("keeps the chart, and says since when, when a re-read of the same window fails", async () => {
    let fail = false;
    await open("heart_rate", (pid, hours) => (fail ? down() : HR_ANSWER(pid, hours)));
    fail = true;
    await reread();
    expect(dialog()).toHaveTextContent(`Vital qrafikləri oxuna bilmir (son: ${hhmm(NOW)})`);
    expect(within(dialog()).getByRole("img")).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 2");
  });

  it("says it cannot read a window it never read — 'son: —' — and draws no chart, but keeps its height", async () => {
    await open("heart_rate", (pid, hours) => (hours === 6 ? down() : HR_ANSWER(pid, hours)));
    await choose("6 saat");
    expect(dialog()).toHaveTextContent("Vital qrafikləri oxuna bilmir (son: —)");
    expect(within(dialog()).queryByRole("img")).toBeNull();
    expect(dialog().querySelector("[data-chart-frame]")).toHaveClass("h-[280px]");
    expect(dialog()).not.toHaveTextContent("Vital qrafikləri oxunur…");
  });
});

describe("the big chart's readout", () => {
  it("reads out the measurement under the mouse — its time, value and unit, and a mark in the same pixel column", async () => {
    await open();
    const svg = within(dialog()).getByRole("img");
    expect(readout()).toHaveAttribute("aria-hidden", "true");
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
    fireEvent.mouseMove(svg, { clientX: xOf(60) });
    expect(readout()).toHaveTextContent(`${hhmm(NOW - HOUR)} · 132 /dəq · siqnal: news2`);
    fireEvent.mouseMove(svg, { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · 84 /dəq`);
    fireEvent.mouseLeave(svg);
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
  });

  it("names every mark at the instant under the cursor — two kinds first detected on one reading", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])],
      { hours, markers: [marker(60, "alarm", "news2"), marker(60, "alarm", "sepsis")] })));
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · 132 /dəq · siqnal: news2 · siqnal: sepsis`);
  });

  it("writes the date as well over three days, as the chart's own time labels do", async () => {
    await open();
    await choose("3 gün");
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60, 72) });
    expect(readout().textContent).toBe(`${ddmm(NOW - HOUR)} ${hhmm(NOW - HOUR)} · 132 /dəq · siqnal: news2`);
  });

  it("reads MAP beside the systolic at the same instant on the pressure card — the vasopressor target", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]), channel("map", [point(120, 80), point(60, 64)])], { hours })));
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 · MAP 64 mmHg`);
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · Sistolik AT 118 · MAP 80 mmHg`);
  });

  it("says MAP was not measured at that instant instead of leaving it out", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]), channel("map", [point(120, 80)])], { hours })));
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 · MAP — mmHg`);
  });

  it("reads a MAP stamped seconds from the systolic beside it — the same pixel column — and takes the nearer one", async () => {
    // A 24-hour chart is about 150 s to a pixel: a MAP half a minute from the systolic is, on the
    // chart, the same moment, and "MAP —" beside a MAP the chart draws there would say it was not measured.
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]),
      channel("map", [point(120.5, 78), point(60.5, 70), point(59.8, 64)])], { hours })));
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 · MAP 64 mmHg`);
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · Sistolik AT 118 · MAP 78 mmHg`);
  });

  it("stays on the instant it was reading when a re-read slides the window — not on the reading that took its index", async () => {
    let slid = false;
    const shift = 10 * 60_000;
    await open("heart_rate", answering((pid, hours) => (slid
      ? trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3), point(10, 90, 0)])],
        { hours, since: new Date(NOW - 24 * HOUR + shift).toISOString(), until: new Date(NOW + shift).toISOString() })
      : trends(pid, [channel("heart_rate", [point(180, 70, 0), point(120, 84, 0), point(60, 132, 3)])], { hours }))));
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(120) });
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
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(180) });
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
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · 132 /dəq`);
    blank = true;
    await reread();
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · —`);
    expect(readout().textContent).not.toMatch(/NaN/);
  });

  it("says so — and gives no prompt to hover — when the window holds no reading to read", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [], { hours })));
    expect(readout()).toBeNull();
    expect(dialog().querySelector("[data-no-data]")).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");
    expect(dialog()).not.toHaveTextContent("Ölçməni oxumaq üçün");
    expect(within(dialog()).getByRole("img")).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 0");
    expect(legend()).not.toBeNull();                                      // what the chart's marks mean still stands
  });

  it("counts a reading with no value as no reading", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(60, null), point(30, null)])], { hours })));
    expect(dialog().querySelector("[data-no-data]")).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");
    expect(within(dialog()).getByRole("img")).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 0");
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
    // ▲ is the finding's first detection for this patient, not every episode (O17).
    for (const words of ["1–2 bal", "3 bal", "siqnalın ilk aşkarlanması", "antibiotik", "nöqtələr ölçmədir; aralarındakı qırıq xətt ölçmə deyil"]) {
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
    const svg = within(dialog()).getByRole("img");
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
    const labels = [...within(dialog()).getByRole("img").querySelectorAll("[data-tick='value'] text")].map((t) => t.textContent);
    expect(labels).toEqual(["85"]);
  });

  it("write a lactate to the tenth, not to the step", async () => {
    await open("lactate", answering((pid, hours) => trends(pid, [channel("lactate", [point(60, 4.1)])], { hours })));
    const labels = [...within(dialog()).getByRole("img").querySelectorAll("[data-tick='value'] text")].map((t) => t.textContent);
    expect(labels).toEqual(["4.1"]);
  });
});

describe("the big chart by keyboard", () => {
  const THREE = answering((pid, hours) => trends(pid, [channel("heart_rate",
    [point(180, 80, 0), point(120, 84, 0), point(60, 132, 3)])], { hours }));
  const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

  it("is one tab stop, its keys described in words", async () => {
    await open("heart_rate", THREE);
    const svg = within(dialog()).getByRole("img");
    expect(svg).toHaveAttribute("tabindex", "0");
    expect(document.getElementById(svg.getAttribute("aria-describedby")))
      .toHaveTextContent("Qrafik seçiləndə ← → əvvəlki / növbəti ölçmə, Home/End ilk / son ölçmə.");
  });

  it("walks the measurements with ← → Home End, and the readout follows", async () => {
    await open("heart_rate", THREE);
    const svg = within(dialog()).getByRole("img");
    const readout = () => dialog().querySelector("[data-readout]").textContent;
    const press = (key) => fireEvent.keyDown(svg, { key });
    press("ArrowRight");
    expect(readout()).toBe(`${hhmm(NOW - 3 * 3_600_000)} · 80 /dəq`);
    press("ArrowRight");
    expect(readout()).toBe(`${hhmm(NOW - 2 * 3_600_000)} · 84 /dəq`);
    press("End");
    expect(readout()).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq`);
    press("ArrowRight");                                                // stays on the last
    expect(readout()).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq`);
    press("Home");
    press("ArrowLeft");                                                 // stays on the first
    expect(readout()).toBe(`${hhmm(NOW - 3 * 3_600_000)} · 80 /dəq`);
    expect(svg.querySelector("[data-cursor]")).not.toBeNull();
  });

  it("says the readout once after a keyboard move, and nothing after the mouse", async () => {
    await open("heart_rate", THREE);
    const svg = within(dialog()).getByRole("img");
    const region = within(dialog()).getByRole("status");
    fireEvent.mouseMove(svg, { clientX: xOf(60) });
    await wait(200);
    expect(region).toHaveTextContent("");
    fireEvent.keyDown(svg, { key: "End" });
    await wait(200);
    expect(region).toHaveTextContent(`${hhmm(NOW - 3_600_000)} · 132 /dəq`);
    fireEvent.mouseMove(svg, { clientX: xOf(120) });
    await wait(200);
    expect(region.textContent).toBe("");
  });
});

describe("the big chart as a table", () => {
  const MIXED = answering((pid, hours) => trends(pid, [channel("heart_rate",
    [point(180, 80, 0), point(120, 72, 3), point(60, 132, 3)])], { hours, markers: [marker(90, "antibiotic")] }));
  const table = async () => {
    await act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Cədvəl" })); await settle(); });
    return within(dialog()).getByRole("table", { name: "Nəbz — ölçmələr, ən yenisi yuxarıda" });
  };

  it("holds exactly what the chart draws, newest first", async () => {
    await open("heart_rate", MIXED);
    const drawn = [...within(dialog()).getByRole("img").querySelectorAll("circle[data-value]")]
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
      expect([...values].sort()).toEqual(["130", "132", "84"]);
      expect(values[2]).toBe("84");                                       // the older instant is last
      expect(error.mock.calls.filter(([message]) => /same key/.test(String(message)))).toEqual([]);
    } finally {
      error.mockRestore();
    }
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
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60) });
    expect(dialog().querySelector("[data-readout]").textContent)
      .toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq · siqnal: news2 (${hhmm(NOW - 61 * 60_000)})`);
  });

  it("takes two readings at one instant as one keyboard stop, read as the later one", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(120, 84, 0), point(60, 130, 2), point(60, 132, 3)])], { hours })));
    const svg = within(dialog()).getByRole("img");
    const readout = () => dialog().querySelector("[data-readout]").textContent;
    fireEvent.keyDown(svg, { key: "Home" });
    expect(readout()).toBe(`${hhmm(NOW - 7_200_000)} · 84 /dəq`);
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(readout()).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq`);
    fireEvent.keyDown(svg, { key: "ArrowRight" });                     // no third stop
    expect(readout()).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq`);
  });
});

// The big chart: its window, its readout, its legend — read as the clinician reads them.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { hhmm } from "../../../i18n/dates.js";
import { CARDS } from "./cards.js";
import { TrendModal } from "./TrendModal.jsx";
import { plotFrame, timeScale } from "./trendGeometry.js";
import { answering, channel, marker, point, trends } from "./trends.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const card = (id) => CARDS.find((c) => c.id === id);
const HR_ANSWER = answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])],
  { hours, markers: [marker(60, "alarm", "news2")] }));

async function open(id = "heart_rate", answer = HR_ANSWER) {
  vi.setSystemTime(NOW);
  const mounted = await mount(<TrendModal card={card(id)} patient={PATIENT} bed="REA-01 · 2" onClose={() => {}} />, {
    access: token(), me: profile(), setup: (api) => api.patientTrends.mockImplementation(answer),
  });
  await act(async () => { await settle(); });
  return mounted;
}
const dialog = () => screen.getByRole("dialog");
const xOf = (minutesAgo, hours = 24) => {
  const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
  return timeScale(NOW - hours * 3_600_000, NOW, frame.left, frame.right)(NOW - minutesAgo * 60_000);
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

  it("reads 24 hours on open, and each window it is switched to", async () => {
    const { api } = await open();
    await act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "6 saat" })); await settle(); });
    await act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "3 gün" })); await settle(); });
    expect(api.patientTrends.mock.calls).toEqual([["S-001", 24], ["S-001", 6], ["S-001", 72]]);
    expect(within(dialog()).getByRole("button", { name: "3 gün" })).toHaveAttribute("aria-pressed", "true");
  });

  it("names the chart for a reader: what it shows and how many points it draws", async () => {
    await open();
    expect(within(dialog()).getByRole("img")).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 2");
  });

  it("reads out the measurement under the mouse — its time, value and unit, and a mark in the same pixel column", async () => {
    await open();
    const svg = within(dialog()).getByRole("img");
    const readout = dialog().querySelector("[data-readout]");
    expect(readout).toHaveAttribute("aria-hidden", "true");
    expect(readout).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
    fireEvent.mouseMove(svg, { clientX: xOf(60) });
    expect(readout).toHaveTextContent(`${hhmm(NOW - 3_600_000)} · 132 /dəq · siqnal: news2`);
    fireEvent.mouseMove(svg, { clientX: xOf(120) });
    expect(readout.textContent).toBe(`${hhmm(NOW - 7_200_000)} · 84 /dəq`);
    fireEvent.mouseLeave(svg);
    expect(readout).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
  });

  it("names every mark at the instant under the cursor — two kinds first detected on one reading", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])],
      { hours, markers: [marker(60, "alarm", "news2"), marker(60, "alarm", "sepsis")] })));
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60) });
    expect(dialog().querySelector("[data-readout]").textContent)
      .toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq · siqnal: news2 · siqnal: sepsis`);
  });

  it("explains every mark in words: the server's NEWS2 source, both band tones, both marks, the dashed line", async () => {
    await open();
    const legend = dialog().querySelector("[data-legend]");
    expect(legend).toHaveTextContent("NEWS2 zolağı (yetkin) · mənbə news2-rcp-2017");
    // ▲ is the finding's first detection for this patient, not every episode (O17).
    for (const words of ["1–2 bal", "3 bal", "siqnalın ilk aşkarlanması", "antibiotik", "nöqtələr ölçmədir; aralarındakı qırıq xətt ölçmə deyil"]) {
      expect(legend).toHaveTextContent(words);
    }
    expect(legend).not.toHaveTextContent("xəstənin norması");            // none charted
    expect(legend).not.toHaveTextContent("işarələrin hamısı");           // the server read every mark
  });

  it("says a channel was thinned, and from how many", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(90, 84, 0), point(60, 90, 0), point(30, 96, 1)], { thinned: true, total_points: 2500 })], { hours })));
    expect(dialog().querySelector("[data-legend]")).toHaveTextContent("Nəbz seyrəldildi: 2500 nöqtədən 3");
  });

  it("draws systolic and MAP as two series of one chart, named in the legend", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(60, 118, 0)]), channel("map", [point(60, 80)])], { hours })));
    const svg = within(dialog()).getByRole("img");
    expect(svg.querySelector("[data-series='sbp']")).not.toBeNull();
    // Hollow on the dialog's own ground (bg-app), not a card's: a card-coloured disc would show on it.
    expect(svg.querySelector("[data-series='map'] circle")).toHaveClass("fill-app");
    expect(dialog().querySelector("[data-legend] circle.fill-app")).not.toBeNull();
    expect(dialog().querySelector("[data-legend]")).toHaveTextContent(/Sistolik AT.*MAP/);
    // MAP is drawn over the systolic rows but is not a NEWS2 parameter: the legend says so in words.
    expect(dialog().querySelector("[data-legend]")).toHaveTextContent("MAP NEWS2-də qiymətləndirilmir; zolaqlar Sistolik AT üçündür");
  });

  it("says when the server's read of the marks stopped at its limit", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(60, 84, 0)])],
      { hours, markers_truncated: true })));
    expect(dialog().querySelector("[data-legend]")).toHaveTextContent("işarələrin hamısı oxunmadı: ən yeniləri çatışmaya bilər");
  });

  it("shows no NEWS2 band in the legend of a channel the engine scores none for", async () => {
    await open("lactate", answering((pid, hours) => trends(pid, [channel("lactate", [point(60, 4.1)])], { hours })));
    expect(dialog().querySelector("[data-legend]")).not.toHaveTextContent("NEWS2");
  });
});

// The monitor strip and its feed chip (Aşama A), as a clinician and a screen reader meet them:
// labelled unvalidated in her language, every value with its age, nothing coloured by a value, no
// live region, no alert. Synthetic cards only (data/shadow.testutil.js).
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { hhmm } from "../../i18n/dates.js";
import { AT, STAGE_OFF, bed, param, strip, unassigned } from "../../data/shadow.testutil.js";
import { MonitorFeedChip, MonitorStrip } from "./MonitorStrip.jsx";

const NOW = Date.parse("2026-10-08T10:00:05Z");

function show(ui, lang) {
  if (lang) localStorage.setItem("hmc.lang", lang);
  return render(<I18nProvider>{ui}</I18nProvider>);
}
afterEach(() => localStorage.clear());

const HR = param("hr", 72);
const card = (parameters = [HR], over = {}) => bed("REA-01 · 2", parameters, over);
const Strip = (props) => (
  <MonitorStrip entry={card()} variant="compact" nowMs={NOW} fetchedAtMs={NOW} maxAgeS={15} {...props} />
);
const region = (name = "Monitor · təsdiqlənməyib") => screen.getByRole("region", { name });

describe("the strip says what it is", () => {
  it("is headed unvalidated in the default language and in Turkish", () => {
    const { unmount } = show(<Strip />);
    expect(screen.getByRole("heading", { name: "Monitor · təsdiqlənməyib" })).toBeInTheDocument();
    expect(region()).toBeInTheDocument();
    unmount();
    show(<Strip />, "tr");
    expect(screen.getByRole("region", { name: "Monitör · doğrulanmamış" })).toBeInTheDocument();
    expect(screen.getByText("DOĞRULANMAMIŞ")).toBeInTheDocument();
  });

  it("carries the tag, the short note when compact and the whole note when full", () => {
    const { unmount } = show(<Strip />);
    expect(within(region()).getByText("TƏSDİQLƏNMƏYİB")).toBeInTheDocument();
    expect(within(region()).getByText("Tədqiqat deşifrəsi · qərar üçün ölçmə deyil · siqnal yaratmır")).toBeInTheDocument();
    unmount();
    show(<Strip variant="full" />);
    expect(within(region()).getByText(/tədqiqat məqsədilə deşifrə olunur və təsdiqlənməyib/)).toBeInTheDocument();
    expect(within(region()).queryByText("Tədqiqat deşifrəsi · qərar üçün ölçmə deyil · siqnal yaratmır")).toBeNull();
  });

  it("shows the evidence of each parameter in the full variant", () => {
    show(<Strip variant="full" entry={card([HR, param("art_mean", 84)])} />);
    expect(within(region()).getByText("İki cihazda monitor ekranı ilə eynidir")).toBeInTheDocument();
    expect(within(region()).getByText("Yalnız struktur yoxlama (MAP əlaqəsi); ekranla müqayisə edilməyib")).toBeInTheDocument();
  });
});

describe("every value with its age, and nothing it cannot vouch for", () => {
  it("shows a fresh value, its unit and its age", () => {
    show(<Strip />);
    const hr = within(region()).getByRole("definition");
    expect(hr).toHaveTextContent("72");
    expect(hr).toHaveTextContent("/dəq");
    expect(hr).toHaveTextContent("2 san");
    expect(within(region()).getByRole("term")).toHaveTextContent("HR");
  });

  it("withholds an old number: a dash and «köhnə» with its age", () => {
    show(<Strip entry={card([param("hr", 72, { age_s: 25 })])} />);
    const hr = within(region()).getByRole("definition");
    expect(hr).not.toHaveTextContent("72");
    expect(hr).toHaveTextContent("—");
    expect(hr).toHaveTextContent("köhnə · 25 san");
  });

  it("ages a value on screen between polls", () => {
    show(<Strip entry={card([param("hr", 72, { age_s: 12 })])} nowMs={NOW + 4000} />);
    expect(within(region()).getByRole("definition")).not.toHaveTextContent("72");
  });

  it("shows the monitor's *** with the sentence a screen reader says", () => {
    show(<Strip entry={card([param("spo2", null)])} />);
    const spo2 = within(region()).getByRole("definition");
    expect(spo2).toHaveTextContent("***");
    expect(within(spo2).getByText("monitor etibarlı dəyər göstərmir")).toHaveClass("sr-only");
  });

  it("shows every cell as a dash when the feed is not ok", () => {
    show(<Strip feedOk={false} />);
    expect(within(region()).getByRole("definition")).not.toHaveTextContent("72");
  });

  it.each([
    ["standby", "Monitor gözləmə rejimindədir"],
    ["waiting", "Məlumat gözlənilir"],
    ["unknown", "Bu monitordan xəbər yoxdur"],
    ["unsupported", "Deşifrə olunmayan məlumat"],
  ])("replaces the values with what a %s device is doing", (status, sentence) => {
    show(<Strip entry={card([HR], { status })} />);
    expect(within(region()).getByText(sentence)).toBeInTheDocument();
    expect(within(region()).queryByRole("definition")).toBeNull();
    expect(region()).not.toHaveTextContent("72");
  });

  it("says when a silent monitor last sent", () => {
    show(<Strip entry={card([param("hr", 72, { last_at: AT })], { status: "silent" })} />);
    expect(within(region()).getByText(`Monitor susur · son məlumat ${hhmm(Date.parse(AT))}`)).toBeInTheDocument();
  });

  it("marks a partly checked parameter, and only that one", () => {
    show(<Strip entry={card([HR, param("art_mean", 84)])} />);
    const [hr, artMean] = within(region()).getAllByRole("term");
    expect(artMean).toHaveTextContent("ART M");
    expect(within(artMean).getByText("qismən")).toBeInTheDocument();
    expect(within(hr).queryByText("qismən")).toBeNull();
  });
});

describe("nothing on it can be taken for an alarm", () => {
  const RISKY = ["bg-crit", "text-crit", "bg-high", "text-high", "bg-mid", "bg-low", "bg-ok", "text-ok",
    "text-v-hr", "text-v-map", "text-v-spo", "text-v-rr", "text-v-t"];

  it("carries no risk or vital-identity colour, no live region and no alert", () => {
    const { container } = show(
      <>
        <Strip entry={card([HR, param("spo2", null), param("art_mean", 84), param("hr", 72, { age_s: 40 })])} variant="full" />
        <MonitorFeedChip data={strip({ beds: [card()] })} phase="ok" />
        <MonitorFeedChip data={strip({ beds: [card()], feed: { state: "forwarder_silent" } })} phase="ok" />
      </>,
    );
    for (const cls of RISKY) expect(container.querySelector(`.${cls}`), cls).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(container.querySelector("[role='status']")).toBeNull();
  });

  it("draws nothing from a stage-off board, nor a strip for no card", () => {
    const { container } = show(
      <>
        <MonitorStrip entry={null} variant="compact" nowMs={NOW} fetchedAtMs={NOW} />
        <MonitorFeedChip data={STAGE_OFF} phase="ok" />
        <MonitorFeedChip data={null} phase="idle" />
        <MonitorFeedChip data={null} phase="loading" />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the feed chip", () => {
  const ward = strip({
    beds: [card(), bed("REA-01 · 3", [], { status: "silent" }), bed("REA-01 · 4", [], { status: "standby" })],
    unassigned: [unassigned("192.0.2.28")],
  });

  it("counts what it saw, by the server's own counts", () => {
    show(<MonitorFeedChip data={ward} phase="ok" />);
    const chip = screen.getByText(/məlumat göndərir/).closest("span");
    expect(chip).toHaveTextContent("Monitor (təsdiqlənməyib):");
    expect(chip).toHaveTextContent("1/4 məlumat göndərir · 1 susur · 2 gözləmədə · 1 təyin edilməyib");
  });

  it("says the feed's trouble instead of counts, as a static note", () => {
    show(<MonitorFeedChip data={{ ...ward, feed: { ...ward.feed, state: "forwarder_silent" } }} phase="ok" />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(`Monitor məlumatı gəlmir (son: ${hhmm(Date.parse(AT))})`);
    expect(screen.queryByText(/məlumat göndərir/)).toBeNull();
  });

  it("says it cannot read the strip rather than counting the last answer", () => {
    show(<MonitorFeedChip data={ward} phase="unreadable" />);
    expect(screen.getByRole("note")).toHaveTextContent("Monitor zolağı oxunmur");
    expect(screen.queryByText(/məlumat göndərir/)).toBeNull();
  });

  it("says the table is missing, beside the counts", () => {
    show(<MonitorFeedChip data={{ ...ward, table: { ...ward.table, status: "missing", reason: "dosya yok" } }} phase="ok" />);
    expect(screen.getByRole("note")).toHaveTextContent("Cihaz→çarpayı cədvəli yoxdur və ya etibarsızdır");
  });
});

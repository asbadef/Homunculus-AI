// ShadowFindingsBox.test.jsx — the patient screen's «Gölge öneri · alarm kapalı» box (Aşama B, D7):
// the shadow engine's NEWS2, the monitor inputs it read and its findings, dressed as advice that
// cannot be vouched for — an amber tag, relation pills, no risk pill, no live region, no button — and
// worded in the reader's language. Synthetic values only; the tests read the box as a clinician and a
// screen reader meet it.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../../i18n/I18nProvider.jsx";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { LANG_CODES } from "../../../i18n/langs.js";
import { ShadowFindingsBox } from "./ShadowFindingsBox.jsx";

// The language is read from this browser's storage (the house way, as MonitorStrip.test.jsx does);
// the default is Azerbaijani, and the Turkish source is the one the words below are written in.
function show(ui, lang) {
  if (lang) localStorage.setItem("hmc.lang", lang);
  return render(<I18nProvider>{ui}</I18nProvider>);
}
// The screen's clock: half an hour after the first input, so T0 and T1 are «today» in every zone.
const NOW = Date.parse("2026-10-27T05:30:00+00:00");
beforeEach(() => { vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

const T0 = "2026-10-27T05:01:00+00:00";
const T1 = "2026-10-27T05:07:00+00:00";
const finding = (over = {}) => ({
  kind: "news2", severity: "high", urgency: "immediate", summary: "NEWS2 6 on the monitor's inputs",
  evidence: [], relation: "shadow_only", stale_inputs: [], downgraded: false, since: T0, ...over,
});
const SHADOW = {
  news2: {
    total: 6, partial: false, missing: [], stale: [], assumed: [], breakdown: { heart_rate: 2, spo2: 1 },
    red_param: false, measured_at: T0, fresh_until: "2026-10-27T05:16:00+00:00",
  },
  vitals: {
    heart_rate: { value: 140, unit: "bpm", at: T0, source: "monitor", via: "hr" },
    spo2: { value: 93, unit: "%", at: T0, source: "monitor", via: "spo2" },
    sbp: { value: 88, unit: "mmHg", at: T1, source: "monitor", via: "art" },
    map: { value: 62, unit: "mmHg", at: T1, source: "monitor", via: "nbp" },
  },
  findings: [
    finding(),
    finding({ kind: "hypotension", severity: "moderate", summary: "Systolic pressure 88 on the arterial line", relation: "same", since: null }),
    finding({ kind: "sepsis", severity: "critical", summary: "Sepsis screen positive on the monitor's inputs", relation: "level_differs", since: T1 }),
  ],
};
const box = () => document.querySelector("[data-shadow-box]");

describe("the shadow box is absent without a shadow", () => {
  it("renders nothing for null and for undefined", () => {
    const { container, rerender } = show(<ShadowFindingsBox shadow={null} />);
    expect(container.innerHTML).toBe("");
    rerender(<I18nProvider><ShadowFindingsBox shadow={undefined} /></I18nProvider>);
    expect(container.innerHTML).toBe("");
    rerender(<I18nProvider><ShadowFindingsBox /></I18nProvider>);
    expect(container.innerHTML).toBe("");
  });
});

describe("the shadow box says what it is", () => {
  it("is headed «Gölge öneri» with the amber tag «alarm kapalı» and the intro sentence", () => {
    show(<ShadowFindingsBox shadow={SHADOW} />, "tr");
    expect(screen.getByRole("heading", { level: 2, name: "Gölge öneri" })).toBeInTheDocument();
    const tag = within(box()).getByText("alarm kapalı");
    expect(tag).toHaveAttribute("data-tone", "warn");
    expect(within(box()).getByText(/^Monitörün doğrulanmamış değerleriyle kurallar şunu söylerdi\./)).toHaveTextContent(
      "Zil çalmaz, bildirim gitmez, sayaçlara girmez; başucu monitörü birincil alarmdır.");
  });

  it("is dashed — the house signal for «cannot vouch» — and takes the heading level it is given", () => {
    show(<ShadowFindingsBox shadow={SHADOW} level={3} />, "tr");
    // The Box's own border made dashed the house way (AlarmsScreen, Settings), not a second frame around it.
    expect(box().querySelector(".rounded-box").className).toContain("!border-dashed");
    expect(screen.getByRole("heading", { level: 3, name: "Gölge öneri" })).toBeInTheDocument();
  });

  it("has no live region, no button and no risk pill: it never announces, never asks, never rates", () => {
    show(<ShadowFindingsBox shadow={SHADOW} />, "tr");
    expect(box().querySelector("[aria-live], [role='alert'], [role='status'], [role='log'], [role='timer']")).toBeNull();
    expect(within(box()).queryAllByRole("button")).toHaveLength(0);
    expect(within(box()).queryAllByRole("link")).toHaveLength(0);
    // The only tagged things are the amber tag and one relation pill per finding: no pill carries a
    // risk label, and the severity is plain text on the finding's line.
    const tagged = [...box().querySelectorAll("[data-tone]")].filter((el) => el.getAttribute("role") !== "note");
    expect(tagged.map((el) => el.textContent)).toEqual(["alarm kapalı", "yalnız gölgede", "gerçek bulguyla aynı", "düzey farklı"]);
    expect(box().querySelectorAll("svg")).toHaveLength(1); // the heading's eye; a RiskPill would add its own icon
  });
});

describe("the shadow NEWS2", () => {
  it("prints the engine's total, and «kısmi» only when the score is partial", () => {
    const { unmount } = show(<ShadowFindingsBox shadow={SHADOW} />, "tr");
    expect(within(box()).getByText("Gölge NEWS2: 6")).toBeInTheDocument();
    expect(within(box()).queryByText("kısmi")).toBeNull();
    unmount();
    show(<ShadowFindingsBox shadow={{ ...SHADOW, news2: { ...SHADOW.news2, partial: true } }} />, "tr");
    expect(within(box()).getByText("Gölge NEWS2: 6")).toBeInTheDocument();
    expect(within(box()).getByText("kısmi")).toHaveAttribute("data-tone", "neutral");
  });

  it("keeps a total of 0 and a missing score apart: 0 is a score, «—» is none", () => {
    const { unmount } = show(<ShadowFindingsBox shadow={{ ...SHADOW, news2: { ...SHADOW.news2, total: 0 } }} />, "tr");
    expect(within(box()).getByText("Gölge NEWS2: 0")).toBeInTheDocument();
    unmount();
    show(<ShadowFindingsBox shadow={{ ...SHADOW, news2: null }} />, "tr");
    expect(within(box()).getByText("Gölge NEWS2: —")).toBeInTheDocument();
  });
});

describe("the monitor inputs the shadow engine read", () => {
  const item = (label) => screen.getByText(label, { selector: "dt" }).closest("div");

  it("shows each input with its channel, value, the screen's own unit word, its source and its time", () => {
    show(<ShadowFindingsBox shadow={SHADOW} />, "tr");
    const hr = item("Nabız");
    expect(hr).toHaveTextContent("140");
    expect(hr).toHaveTextContent("/dk");
    expect(hr).toHaveTextContent("monitör · HR");
    expect(hr).toHaveTextContent(hhmm(Date.parse(T0)));
    expect(item("SpO2")).toHaveTextContent("93");
    expect(item("SpO2")).toHaveTextContent("%");
    expect(item("SpO2")).toHaveTextContent("monitör · SpO₂");
    expect(item("Sistolik TA")).toHaveTextContent("88");
    expect(item("Sistolik TA")).toHaveTextContent("mmHg");
    expect(item("Sistolik TA")).toHaveTextContent("monitör · ART");
    expect(item("Sistolik TA")).toHaveTextContent(hhmm(Date.parse(T1)));
    expect(item("MAP")).toHaveTextContent("62");
    expect(item("MAP")).toHaveTextContent("monitör · NBP");
  });

  it("writes the unit by channel code, never the wire's own string: «bpm» is «/dk» on this screen", () => {
    show(<ShadowFindingsBox shadow={SHADOW} />, "tr");
    expect(box().textContent).not.toContain("bpm");
    cleanup();
    show(<ShadowFindingsBox shadow={SHADOW} />, "en");
    expect(item("Pulse")).toHaveTextContent("/min");
    expect(box().textContent).not.toContain("bpm");
    cleanup();
    show(<ShadowFindingsBox shadow={SHADOW} />, "ru");
    expect(item("Систолическое АД")).toHaveTextContent("мм рт. ст.");
  });

  it("names the monitor's label for every source it can come through", () => {
    const vitals = Object.fromEntries(["hr", "pls", "spo2", "art", "nbp"].map((via) => [
      `v_${via}`, { value: 1, unit: "x", at: T0, source: "monitor", via }]));
    // Channel codes the box does not know print as the code itself; the sources are the point here.
    show(<ShadowFindingsBox shadow={{ ...SHADOW, vitals }} />, "tr");
    for (const word of ["HR", "PLS", "SpO₂", "ART", "NBP"]) expect(box().textContent).toContain(`monitör · ${word}`);
  });

  it("never invents a source or a time: an unknown source prints as sent, an unreadable time as a dash", () => {
    const vitals = { heart_rate: { value: 140, unit: "bpm", at: "not a time", source: "monitor", via: "bogus" } };
    show(<ShadowFindingsBox shadow={{ ...SHADOW, vitals }} />, "tr");
    const hr = item("Nabız");
    expect(hr).toHaveTextContent("monitör · bogus · —");
    expect(hr.textContent).not.toMatch(/NaN/);
    expect(hr.textContent).not.toContain("monitör · HR");
  });

  it("prints a measured 0 as 0", () => {
    show(<ShadowFindingsBox shadow={{ ...SHADOW, vitals: { spo2: { value: 0, unit: "%", at: T0, source: "monitor", via: "spo2" } } }} />, "tr");
    expect(item("SpO2")).toHaveTextContent(/^SpO2\s*0%/);
  });

  it("omits the list when the shadow read no input", () => {
    show(<ShadowFindingsBox shadow={{ ...SHADOW, vitals: {} }} />, "tr");
    expect(box().querySelector("dl")).toBeNull();
    expect(within(box()).getByText("Gölge NEWS2: 6")).toBeInTheDocument();
  });
});

describe("the shadow findings", () => {
  const items = () => within(within(box()).getByRole("list")).getAllByRole("listitem");

  it("lists each finding with its relation pill, its English summary, its severity and since when", () => {
    show(<ShadowFindingsBox shadow={SHADOW} />, "tr");
    const [a, b, c] = items();
    expect(items()).toHaveLength(3);

    // StatusPill's amber is `att` (it has no `warn`): both relations that call for a look wear it.
    expect(within(a).getByText("yalnız gölgede")).toHaveAttribute("data-tone", "att");
    const summary = within(a).getByText("NEWS2 6 on the monitor's inputs");
    expect(summary).toHaveAttribute("lang", "en");
    expect(a).toHaveTextContent("Yüksek");
    expect(a).toHaveTextContent(`açılış ${hhmm(Date.parse(T0))}`);

    expect(within(b).getByText("gerçek bulguyla aynı")).toHaveAttribute("data-tone", "neutral");
    expect(within(b).getByText("Systolic pressure 88 on the arterial line")).toHaveAttribute("lang", "en");
    expect(b).toHaveTextContent("Orta");
    expect(b.textContent).not.toContain("açılış"); // no `since`, no «since when»

    expect(within(c).getByText("düzey farklı")).toHaveAttribute("data-tone", "att");
    expect(c).toHaveTextContent("Kritik");
    expect(c).toHaveTextContent(`açılış ${hhmm(Date.parse(T1))}`);
  });

  it("writes the day and month of a finding or an input that is not from today (the Meds box's M1 rule)", () => {
    const yesterday = new Date(NOW - 24 * 3600_000).toISOString();
    const dated = `${ddmm(Date.parse(yesterday))} ${hhmm(Date.parse(yesterday))}`;
    show(<ShadowFindingsBox shadow={{
      ...SHADOW,
      vitals: { heart_rate: { value: 140, unit: "bpm", at: yesterday, source: "monitor", via: "hr" } },
      findings: [finding({ since: yesterday }), finding({ kind: "sepsis", since: T0 })],
    }} />, "tr");
    const [old, fresh] = items();
    expect(old).toHaveTextContent(`açılış ${dated}`);
    expect(fresh).toHaveTextContent(`açılış ${hhmm(Date.parse(T0))}`);
    expect(fresh.textContent).not.toContain(ddmm(Date.parse(T0)));
    expect(screen.getByText("Nabız", { selector: "dt" }).closest("div")).toHaveTextContent(`monitör · HR · ${dated}`);
  });

  it("leaves «since» out when the engine's stamp does not parse, rather than print a made-up time", () => {
    show(<ShadowFindingsBox shadow={{ ...SHADOW, findings: [finding({ since: "not a time" })] }} />, "tr");
    const [only] = items();
    expect(only).toHaveTextContent("Yüksek");
    expect(only.textContent).not.toContain("açılış");
    expect(only.textContent).not.toMatch(/NaN/);
  });

  it("says the finding is the shadow's even when its relation is one this build does not know", () => {
    show(<ShadowFindingsBox shadow={{ ...SHADOW, findings: [finding({ relation: "bogus", severity: "odd" })] }} />, "tr");
    const [only] = items();
    // Not «yalnız gölgede»: that would assert a relation nobody computed. The pill takes the
    // attention look and prints what the engine sent; the severity likewise.
    expect(within(only).getByText("bogus")).toHaveAttribute("data-tone", "att");
    expect(only.textContent).not.toContain("yalnız gölgede");
    expect(only).toHaveTextContent("Tanımsız risk: odd");
  });

  it("says so, in a note, when the monitor's inputs open no finding", () => {
    show(<ShadowFindingsBox shadow={{ ...SHADOW, findings: [] }} />, "tr");
    expect(within(box()).queryByRole("list")).toBeNull();
    expect(within(box()).getByRole("note")).toHaveTextContent("Monitör girdileriyle açık bulgu yok.");
    // …and the NEWS2 and the inputs are still there: an empty list is not an empty box.
    expect(within(box()).getByText("Gölge NEWS2: 6")).toBeInTheDocument();
    expect(box().querySelector("dl")).not.toBeNull();
  });

  it("keeps a box that carries no findings key at all, as one with none", () => {
    const { findings, ...bare } = SHADOW;
    expect(findings).toHaveLength(3);
    show(<ShadowFindingsBox shadow={bare} />, "tr");
    expect(within(box()).getByRole("note")).toHaveTextContent("Monitör girdileriyle açık bulgu yok.");
  });
});

describe("the shadow box in every language", () => {
  const WORDS = {
    tr: { title: "Gölge öneri", tag: "alarm kapalı", rel: ["yalnız gölgede", "gerçek bulguyla aynı", "düzey farklı"], since: `açılış ${hhmm(Date.parse(T0))}`, news2: "Gölge NEWS2: 6", none: "Monitör girdileriyle açık bulgu yok." },
    az: { title: "Kölgə tövsiyə", tag: "siqnal söndürülüb", rel: ["yalnız kölgədə", "həqiqi tapıntı ilə eyni", "səviyyə fərqlidir"], since: `açılış ${hhmm(Date.parse(T0))}`, news2: "Kölgə NEWS2: 6", none: "Monitor girişləri ilə açıq tapıntı yoxdur." },
    ru: { title: "Теневая рекомендация", tag: "тревога выключена", rel: ["только в тени", "совпадает с реальной", "уровень отличается"], since: `с ${hhmm(Date.parse(T0))}`, news2: "Теневой NEWS2: 6", none: "По входам монитора открытых находок нет." },
    en: { title: "Shadow advice", tag: "alarm off", rel: ["shadow only", "same as the real finding", "level differs"], since: `since ${hhmm(Date.parse(T0))}`, news2: "Shadow NEWS2: 6", none: "No open finding on the monitor's inputs." },
  };

  it("covers the four languages the dictionaries have", () => {
    expect(Object.keys(WORDS).sort()).toEqual([...LANG_CODES].sort());
  });

  for (const lang of LANG_CODES) {
    it(`words the heading, the tag, the NEWS2, the relations and «since» in ${lang}`, () => {
      const w = WORDS[lang];
      show(<ShadowFindingsBox shadow={SHADOW} />, lang);
      expect(screen.getByRole("heading", { level: 2, name: w.title })).toBeInTheDocument();
      expect(within(box()).getByText(w.tag)).toHaveAttribute("data-tone", "warn");
      expect(within(box()).getByText(w.news2)).toBeInTheDocument();
      const [a, b, c] = within(within(box()).getByRole("list")).getAllByRole("listitem");
      expect(within(a).getByText(w.rel[0])).toHaveAttribute("data-tone", "att");
      expect(within(b).getByText(w.rel[1])).toHaveAttribute("data-tone", "neutral");
      expect(within(c).getByText(w.rel[2])).toHaveAttribute("data-tone", "att");
      expect(a).toHaveTextContent(w.since);
      // The summary is the engine's English, whatever the reader's language.
      expect(within(a).getByText("NEWS2 6 on the monitor's inputs")).toHaveAttribute("lang", "en");
    });

    it(`words the empty case in ${lang}`, () => {
      show(<ShadowFindingsBox shadow={{ ...SHADOW, findings: [] }} />, lang);
      expect(within(box()).getByRole("note")).toHaveTextContent(WORDS[lang].none);
    });
  }
});

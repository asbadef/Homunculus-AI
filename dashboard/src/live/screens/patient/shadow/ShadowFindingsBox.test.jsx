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
// The shadow NEWS2 as api/infinity_rules.py sends it — per-input stamps — and as it almost always is:
// partial (respiration and temperature are not read from the monitor, D2) and scored on room air and
// Alert, because nothing current is charted for either.
const SHADOW = {
  news2: {
    total: 6, partial: true, missing: ["respiration_rate", "temperature"], stale: [], assumed: ["air_or_oxygen", "consciousness"],
    breakdown: { pulse: 2, spo2: 1 }, red_param: false,
    measured_at: { pulse: T0, spo2: T0, systolic_bp: T1 },
    fresh_until: { pulse: "2026-10-27T05:16:00+00:00", spo2: "2026-10-27T05:16:00+00:00", systolic_bp: "2026-10-27T05:22:00+00:00" },
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
const news2Line = () => box().querySelector("[data-shadow-news2]");

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
    show(<ShadowFindingsBox shadow={SHADOW} known nowMs={NOW} />, "tr");
    expect(box().querySelector("[aria-live], [role='alert'], [role='status'], [role='log'], [role='timer']")).toBeNull();
    expect(within(box()).queryAllByRole("button")).toHaveLength(0);
    expect(within(box()).queryAllByRole("link")).toHaveLength(0);
    // Outside the NEWS2 line the only tagged things are the amber tag and one relation pill per
    // finding; the severity is plain text on the finding's line.
    const tagged = [...box().querySelectorAll("[data-tone]")]
      .filter((el) => el.getAttribute("role") !== "note" && !news2Line().contains(el));
    expect(tagged.map((el) => el.textContent)).toEqual(["alarm kapalı", "yalnız gölgede", "gerçek bulguyla aynı", "düzey farklı"]);
    // Inside it, only the house NEWS2's own caveat pills: no pill anywhere wears a risk level's tone,
    // and none carries RiskPill's visually hidden «Risk:».
    const tones = [...box().querySelectorAll("[data-tone]")].map((el) => el.getAttribute("data-tone"));
    expect(tones.filter((tone) => ["crit", "high", "mid", "low", "ok"].includes(tone))).toEqual([]);
    expect(box().textContent).not.toMatch(/Risk:/);
    // The heading's eye is the one icon outside the NEWS2 line (whose caveat pills carry their own);
    // a RiskPill would add one.
    expect([...box().querySelectorAll("svg")].filter((svg) => !news2Line().contains(svg))).toHaveLength(1);
  });
});

describe("the shadow NEWS2 — the house NEWS2, with the engine's caveats", () => {
  it("prints the engine's total under the label «Gölge NEWS2», in the house component's own look", () => {
    show(<ShadowFindingsBox shadow={SHADOW} known nowMs={NOW} />, "tr");
    expect(news2Line()).toHaveTextContent(/^Gölge NEWS2:\s*6/);
    // The total in the data face the bed card and the header draw it in: the same component, not a copy.
    expect(within(news2Line()).getByText("6").tagName).toBe("B");
    expect(news2Line().textContent).not.toMatch(/^NEWS2:/);
  });

  it("carries every caveat the engine sent: partial and what is missing, room air and Alert assumed, a red parameter, a stale input with its age", () => {
    const news2 = { ...SHADOW.news2, red_param: true, stale: ["pulse"] };
    show(<ShadowFindingsBox shadow={{ ...SHADOW, news2 }} known nowMs={NOW} />, "tr");
    const line = news2Line();
    expect(within(line).getByText("kısmi").closest("[data-tone]")).toHaveAttribute("data-tone", "att");
    // What is missing, said to a screen reader inside the pill (BoardState's News2).
    expect(line).toHaveTextContent("Kısmi skor — solunum hızı, ateş ölçülmedi; gerçek toplam daha yüksek olabilir.");
    expect(line).toHaveTextContent(/varsayıldı: oda havası.*uyanık/);
    expect(line).toHaveTextContent("Bir parametre 3 puan aldı");
    expect(line).toHaveTextContent("eski veri: nabız · 29 dk önce");          // T0 against the screen's clock
  });

  it("says «kısmi» only when the score is partial", () => {
    show(<ShadowFindingsBox shadow={{ ...SHADOW, news2: { ...SHADOW.news2, partial: false, missing: [] } }} known nowMs={NOW} />, "tr");
    expect(news2Line()).toHaveTextContent(/^Gölge NEWS2:\s*6/);
    expect(within(news2Line()).queryByText("kısmi")).toBeNull();
  });

  it("keeps a total of 0 and a missing score apart: 0 is a score, «—» is none", () => {
    const { unmount } = show(<ShadowFindingsBox shadow={{ ...SHADOW, news2: { ...SHADOW.news2, total: 0 } }} />, "tr");
    expect(news2Line()).toHaveTextContent(/^Gölge NEWS2:\s*0/);
    unmount();
    show(<ShadowFindingsBox shadow={{ ...SHADOW, news2: null }} />, "tr");
    expect(within(news2Line()).getByText("Gölge NEWS2: —")).toBeInTheDocument();
  });

  it("ages the score by its newest input, on the screen's clock — a held score is never undated", () => {
    show(<ShadowFindingsBox shadow={SHADOW} known nowMs={NOW} />, "tr");
    expect(news2Line()).toHaveTextContent("· 23 dk önce");                    // T1, the newest of the four
  });

  it("skips an input whose stamp does not parse, and prints no age when no input has one", () => {
    const vitals = (...ats) => Object.fromEntries(ats.map((at, i) => [`c${i}`, { value: 1, unit: "x", at, source: "monitor", via: "hr" }]));
    const { unmount } = show(<ShadowFindingsBox shadow={{ ...SHADOW, vitals: vitals("not a time", T0, null) }} known nowMs={NOW} />, "tr");
    expect(news2Line()).toHaveTextContent("· 29 dk önce");
    expect(news2Line().textContent).not.toMatch(/NaN/);
    unmount();
    show(<ShadowFindingsBox shadow={{ ...SHADOW, vitals: vitals("not a time") }} known nowMs={NOW} />, "tr");
    expect(news2Line().textContent).not.toMatch(/önce/);
  });

  it("prints no age with no input at all, and none without the screen's clock (no clock, no age)", () => {
    const { unmount } = show(<ShadowFindingsBox shadow={{ ...SHADOW, vitals: {} }} known nowMs={NOW} />, "tr");
    expect(news2Line().textContent).not.toMatch(/önce/);
    unmount();
    show(<ShadowFindingsBox shadow={SHADOW} known />, "tr");
    expect(news2Line()).toHaveTextContent(/^Gölge NEWS2:\s*6/);
    expect(news2Line().textContent).not.toMatch(/önce/);
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

  it("is a list named «Girdiler», with the name on screen", () => {
    show(<ShadowFindingsBox shadow={SHADOW} />, "tr");
    const group = within(box()).getByRole("group", { name: "Girdiler" });
    expect(group.querySelector("dl")).not.toBeNull();
    expect(within(group).getByText("Girdiler")).toBeVisible();
    expect(within(group).getByText("Nabız", { selector: "dt" })).toBeInTheDocument();
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
    expect(within(box()).queryByRole("group", { name: "Girdiler" })).toBeNull();
    expect(news2Line()).toHaveTextContent(/^Gölge NEWS2:\s*6/);
  });

  it("writes its stamps on the screen's clock, not this browser's: a day that is not the screen's today carries its date", () => {
    // The browser says 05:30 on the 27th; the screen's (server-corrected) clock says a day later.
    show(<ShadowFindingsBox shadow={SHADOW} known nowMs={NOW + 24 * 3600_000} />, "tr");
    expect(item("Nabız")).toHaveTextContent(`monitör · HR · ${ddmm(Date.parse(T0))} ${hhmm(Date.parse(T0))}`);
    const [first] = within(within(box()).getByRole("list")).getAllByRole("listitem");
    expect(first).toHaveTextContent(`açılış ${ddmm(Date.parse(T0))} ${hhmm(Date.parse(T0))}`);
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

  it("says so, in a note, when the monitor's inputs open no finding on a live board", () => {
    show(<ShadowFindingsBox shadow={{ ...SHADOW, findings: [] }} known nowMs={NOW} />, "tr");
    expect(within(box()).queryByRole("list")).toBeNull();
    const note = within(box()).getByRole("note");
    expect(note).toHaveTextContent("Monitör girdileriyle açık bulgu yok.");
    expect(note).toHaveAttribute("data-tone", "info");
    // …and the NEWS2 and the inputs are still there: an empty list is not an empty box.
    expect(news2Line()).toHaveTextContent(/^Gölge NEWS2:\s*6/);
    expect(box().querySelector("dl")).not.toBeNull();
  });

  it("never says there is none from a board that is not live: it says it cannot know, in amber", () => {
    for (const props of [{ known: false }, {}]) {
      show(<ShadowFindingsBox shadow={{ ...SHADOW, findings: [] }} nowMs={NOW} {...props} />, "tr");
      const note = within(box()).getByRole("note");
      expect(note).toHaveTextContent("Pano güncel değil; gölge bulgu olup olmadığı bilinemez.");
      expect(note).toHaveAttribute("data-tone", "warn");
      expect(box().textContent).not.toContain("açık bulgu yok");
      cleanup();
    }
  });

  it("lists the findings it has whatever the board's state: only «none» needs a live read", () => {
    show(<ShadowFindingsBox shadow={SHADOW} known={false} nowMs={NOW} />, "tr");
    expect(items()).toHaveLength(3);
    expect(within(box()).queryByRole("note")).toBeNull();
  });

  it("keeps a box that carries no findings key at all, as one with none", () => {
    const { findings, ...bare } = SHADOW;
    expect(findings).toHaveLength(3);
    show(<ShadowFindingsBox shadow={bare} known />, "tr");
    expect(within(box()).getByRole("note")).toHaveTextContent("Monitör girdileriyle açık bulgu yok.");
  });
});

describe("the shadow box in every language", () => {
  const WORDS = {
    tr: { title: "Gölge öneri", tag: "alarm kapalı", rel: ["yalnız gölgede", "gerçek bulguyla aynı", "düzey farklı"], since: `açılış ${hhmm(Date.parse(T0))}`, news2: /^Gölge NEWS2:\s*6/, inputs: "Girdiler", age: "23 dk önce", none: "Monitör girdileriyle açık bulgu yok.", unknown: "Pano güncel değil; gölge bulgu olup olmadığı bilinemez." },
    az: { title: "Kölgə tövsiyə", tag: "siqnal söndürülüb", rel: ["yalnız kölgədə", "həqiqi tapıntı ilə eyni", "səviyyə fərqlidir"], since: `açılış ${hhmm(Date.parse(T0))}`, news2: /^Kölgə NEWS2:\s*6/, inputs: "Girişlər", age: "23 dəq əvvəl", none: "Monitor girişləri ilə açıq tapıntı yoxdur.", unknown: "Panel güncəl deyil; kölgə tapıntının olub-olmadığı bilinmir." },
    ru: { title: "Теневая рекомендация", tag: "тревога выключена", rel: ["только в тени", "совпадает с реальной", "уровень отличается"], since: `с ${hhmm(Date.parse(T0))}`, news2: /^Теневой NEWS2:\s*6/, inputs: "Входы", age: "23 мин назад", none: "По входам монитора открытых находок нет.", unknown: "Панель неактуальна; есть ли теневые находки, неизвестно." },
    en: { title: "Shadow advice", tag: "alarm off", rel: ["shadow only", "same as the real finding", "level differs"], since: `since ${hhmm(Date.parse(T0))}`, news2: /^Shadow NEWS2:\s*6/, inputs: "Inputs", age: "23 min ago", none: "No open finding on the monitor's inputs.", unknown: "The board is out of date; whether there is a shadow finding cannot be known." },
  };

  it("covers the four languages the dictionaries have", () => {
    expect(Object.keys(WORDS).sort()).toEqual([...LANG_CODES].sort());
  });

  for (const lang of LANG_CODES) {
    it(`words the heading, the tag, the NEWS2 and its age, the inputs, the relations and «since» in ${lang}`, () => {
      const w = WORDS[lang];
      show(<ShadowFindingsBox shadow={SHADOW} known nowMs={NOW} />, lang);
      expect(screen.getByRole("heading", { level: 2, name: w.title })).toBeInTheDocument();
      expect(within(box()).getByText(w.tag)).toHaveAttribute("data-tone", "warn");
      expect(news2Line()).toHaveTextContent(w.news2);
      expect(news2Line()).toHaveTextContent(w.age);
      expect(within(box()).getByRole("group", { name: w.inputs })).toBeInTheDocument();
      const [a, b, c] = within(within(box()).getByRole("list")).getAllByRole("listitem");
      expect(within(a).getByText(w.rel[0])).toHaveAttribute("data-tone", "att");
      expect(within(b).getByText(w.rel[1])).toHaveAttribute("data-tone", "neutral");
      expect(within(c).getByText(w.rel[2])).toHaveAttribute("data-tone", "att");
      expect(a).toHaveTextContent(w.since);
      // The summary is the engine's English, whatever the reader's language.
      expect(within(a).getByText("NEWS2 6 on the monitor's inputs")).toHaveAttribute("lang", "en");
    });

    it(`words the empty case, live and not, in ${lang}`, () => {
      const { unmount } = show(<ShadowFindingsBox shadow={{ ...SHADOW, findings: [] }} known nowMs={NOW} />, lang);
      expect(within(box()).getByRole("note")).toHaveTextContent(WORDS[lang].none);
      unmount();
      show(<ShadowFindingsBox shadow={{ ...SHADOW, findings: [] }} known={false} nowMs={NOW} />, lang);
      expect(within(box()).getByRole("note")).toHaveTextContent(WORDS[lang].unknown);
    });
  }
});

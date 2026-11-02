// The monitor strip and its feed chip (Aşama A), as a clinician and a screen reader meet them:
// labelled unvalidated in her language, every value with its age, nothing coloured by a value, no
// live region, no alert. Synthetic cards only (data/shadow.testutil.js).
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { hhmm } from "../../i18n/dates.js";
import { LANG_CODES } from "../../i18n/langs.js";
import { AT, NBP_CHANGED_AT, STAGE_OFF, bed, param, strip, unassigned } from "../../data/shadow.testutil.js";
import { MonitorFeedChip, MonitorStrip, stripOn } from "./MonitorStrip.jsx";

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
const region = (name = "Monitor · təsdiqlənməmiş") => screen.getByRole("region", { name });

describe("the strip says what it is", () => {
  it("is a positioned box, so its screen-reader-only text cannot stretch the page", () => {
    // Each cell carries `sr-only` text (`position: absolute`). With fifteen monitors the lowest
    // ones sit thousands of pixels down; without a positioned ancestor they are placed against
    // the viewport and the document grows below the shell (the ward's board, 2026-10-21: root
    // 730 px, document 9375 px).
    show(<Strip />);
    expect(region().className.split(/\s+/)).toContain("relative");
  });

  it("is headed unvalidated in the default language and in Turkish", () => {
    const { unmount } = show(<Strip />);
    expect(screen.getByRole("heading", { name: "Monitor · təsdiqlənməmiş" })).toBeInTheDocument();
    expect(region()).toBeInTheDocument();
    unmount();
    show(<Strip />, "tr");
    expect(screen.getByRole("region", { name: "Monitör · doğrulanmamış" })).toBeInTheDocument();
    expect(screen.getByText("DOĞRULANMAMIŞ")).toBeInTheDocument();
  });

  it("carries the tag, the short note when compact and the whole note when full", () => {
    const { unmount } = show(<Strip />);
    expect(within(region()).getByText("TƏSDİQLƏNMƏMİŞ")).toBeInTheDocument();
    expect(within(region()).getByText("Tədqiqat deşifrəsi · qərar üçün ölçmə deyil · siqnal yaratmır")).toBeInTheDocument();
    unmount();
    show(<Strip variant="full" />);
    expect(within(region()).getByText(/tədqiqat məqsədilə deşifrə olunur və təsdiqlənməyib/)).toBeInTheDocument();
    expect(within(region()).queryByText("Tədqiqat deşifrəsi · qərar üçün ölçmə deyil · siqnal yaratmır")).toBeNull();
  });

  // Aşama B: at «rules» the shadow engine scores these values — advice, alarm off — so the whole note
  // says that instead of «no score»; the stage is the board answer's, handed down by the screen.
  it("says in its whole note what the stage makes of the values: no score at «shadow», an advisory shadow score at «rules»", () => {
    for (const stage of ["shadow", undefined]) {
      const { unmount } = show(<Strip variant="full" stage={stage} />);
      expect(region(), String(stage)).toHaveTextContent("heç bir siqnal, bal (NEWS2 daxil olmaqla), bildiriş və ya səs yaradılmır");
      expect(region().textContent, String(stage)).not.toContain("kölgə bal");
      unmount();
    }
    const { unmount } = show(<Strip variant="full" stage="rules" />);
    expect(region()).toHaveTextContent(/tədqiqat məqsədilə deşifrə olunur və təsdiqlənməyib/);
    expect(region()).toHaveTextContent("heç bir siqnal, bildiriş və ya səs yaradılmır və heç bir sayğaca daxil olmur");
    expect(region()).toHaveTextContent("yalnız tövsiyə xarakterli kölgə bal hesablanır");
    expect(region()).toHaveTextContent("«Kölgə tövsiyə · siqnal söndürülüb»");
    expect(region()).not.toHaveTextContent("bal (NEWS2 daxil olmaqla)");
    unmount();
    // The short note says nothing about a score, at either stage.
    show(<Strip stage="rules" />);
    expect(within(region()).getByText("Tədqiqat deşifrəsi · qərar üçün ölçmə deyil · siqnal yaratmır")).toBeInTheDocument();
    expect(region().textContent).not.toContain("kölgə bal");
  });

  it("words the rules stage's whole note in every language", () => {
    const words = { tr: "«Gölge öneri · alarm kapalı»", az: "«Kölgə tövsiyə · siqnal söndürülüb»",
      ru: "«Теневая рекомендация · тревога выключена»", en: "«Shadow advice · alarm off»" };
    expect(Object.keys(words).sort()).toEqual([...LANG_CODES].sort());
    for (const lang of LANG_CODES) {
      const { unmount } = show(<Strip variant="full" stage="rules" />, lang);
      expect(screen.getByRole("region").textContent, lang).toContain(words[lang]);
      expect(screen.getByRole("region").textContent, lang).not.toMatch(/\(NEWS2/);
      unmount();
    }
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

  it("draws no values for a status this build does not know — it is read as unknown", () => {
    show(<Strip entry={card([HR], { status: "rebooting" })} />);
    expect(within(region()).getByText("Bu monitordan xəbər yoxdur")).toBeInTheDocument();
    expect(region()).not.toHaveTextContent("72");
  });

  it("says a streaming monitor with nothing to show has nothing to show, rather than an empty box", () => {
    show(<Strip entry={card([])} />);
    expect(within(region()).getByText("Monitor məlumat göndərir; göstəriləcək dəyər yoxdur")).toBeInTheDocument();
  });

  it("says the strip cannot be read when it is told so, and still ages the last values", () => {
    show(<Strip unreadable />);
    expect(within(region()).getByText("Monitor zolağı oxunmur")).toBeInTheDocument();
    expect(within(region()).getByRole("definition")).toHaveTextContent("72");   // 2 s old: still a value
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

describe("NBP, with the time its value last changed", () => {
  const NBP = param("nbp", [118, 79, 92]);                 // changed ten minutes before AT
  const TIME = hhmm(Date.parse(NBP_CHANGED_AT));
  const NBSP = String.fromCharCode(0xa0);                  // U+00A0, the no-break space — not a plain space

  it("shows S/D (M), the unit, and «ölçmə ≤ HH:MM» with how long ago", () => {
    show(<Strip entry={card([HR, NBP])} />);
    const [, nbp] = within(region()).getAllByRole("definition");
    expect(within(region()).getAllByRole("term")[1]).toHaveTextContent("NBP");
    expect(nbp).toHaveTextContent("118/79 (92)");
    expect(nbp).toHaveTextContent("mmHg");
    expect(nbp).toHaveTextContent(`ölçmə ≤ ${TIME} (10 dəq)`);
  });

  it("tells a screen reader the numbers and that the cuff measured at or before that time", () => {
    const { unmount } = show(<Strip entry={card([NBP])} />);
    expect(within(region()).getByText(`118 bölü 79, orta 92 mmHg; ölçmə ${TIME} və ya daha əvvəl, ən azı 10 dəq əvvəl`))
      .toHaveClass("sr-only");
    unmount();
    show(<Strip entry={card([NBP])} />, "en");
    expect(screen.getByText(`118 over 79, mean 92 mmHg; measured at or before ${TIME}, at least 10 min ago`)).toHaveClass("sr-only");
    expect(screen.getByRole("definition")).toHaveTextContent(`measured ≤ ${TIME} (10 min)`);
  });

  it("takes two columns of the strip's grid, and nothing else does", () => {
    show(<Strip entry={card([HR, NBP])} />);
    const [hr, nbp] = within(region()).getAllByRole("term").map((term) => term.parentElement);
    expect(nbp.className.split(/\s+/)).toContain("col-span-2");
    expect(hr.className.split(/\s+/)).not.toContain("col-span-2");
  });

  it("awaits a measurement when no change was seen since the hub started: a dash, no number, no age", () => {
    show(<Strip entry={card([HR, param("nbp", null)])} />);
    const [, nbp] = within(region()).getAllByRole("definition");
    expect(nbp).toHaveTextContent("—");
    expect(nbp).toHaveTextContent("ölçmə gözlənilir");
    expect(nbp).not.toHaveTextContent("köhnə");
    expect(nbp).not.toHaveTextContent(/\d/);
  });

  it("withholds the numbers when the server does, and says how long ago the value changed", () => {
    const withheld = param("nbp", null, { changed_at: NBP_CHANGED_AT, last_at: NBP_CHANGED_AT, age_s: 7300, measured_age_s: 7300 });
    show(<Strip entry={card([withheld])} />);
    const nbp = within(region()).getByRole("definition");
    expect(nbp).toHaveTextContent("—");
    expect(nbp).toHaveTextContent("köhnə · 3 saat");                // 2 h 1 min 40 s, rounded up
    expect(nbp).not.toHaveTextContent("ölçmə");
  });

  it("draws no NBP number off a dead feed, and still says how long ago it changed", () => {
    show(<Strip entry={card([NBP])} feedOk={false} />);
    const nbp = within(region()).getByRole("definition");
    expect(nbp).not.toHaveTextContent("118");
    expect(nbp).toHaveTextContent("köhnə · 10 dəq");
  });

  it("names its evidence in the full variant", () => {
    show(<Strip variant="full" entry={card([NBP])} />);
    expect(within(region()).getByText("Monitor ekranı ilə eynidir")).toBeInTheDocument();
  });

  // Measured in Chrome with the real fonts: at 390 px the line broke as «118/79 (92) mmHg ölçmə ≤ /
  // 13:50 (10 dəq)», at 320 px as «118/79 / (92) mmHg …», in Russian as «мм рт. / ст. …». The bound's
  // "≤" must stay with its time, and the numbers and the unit must not break; the measured words
  // themselves may wrap (the Russian ones are wider than the cell at 320 px).
  it("never breaks the numbers or the unit across lines, but lets the measured words wrap", () => {
    show(<Strip entry={card([NBP])} />, "ru");
    const [numbers, unit, measured] = screen.getByRole("definition").children;   // the numbers, the unit, the measured words
    expect(numbers.className.split(/\s+/)).toContain("whitespace-nowrap");
    expect(unit.className.split(/\s+/)).toContain("whitespace-nowrap");
    expect(measured.className.split(/\s+/)).not.toContain("whitespace-nowrap");
  });

  it("keeps «≤» and its time together with a no-break space, in every language", () => {
    for (const lang of LANG_CODES) {
      const { unmount } = show(<Strip entry={card([NBP])} />, lang);
      const measured = within(screen.getByRole("definition")).getByText(/≤/);
      expect(measured.textContent, lang).toContain(`≤${NBSP}${TIME} (`);
      unmount();
    }
  });

  it("hides the numbers, the unit and the time from a screen reader, which gets the one sentence", () => {
    show(<Strip entry={card([NBP])} />);
    const nbp = screen.getByRole("definition");
    for (const part of ["118/79 (92)", "mmHg", `ölçmə ≤ ${TIME} (10 dəq)`]) {
      expect(within(nbp).getByText(part), part).toHaveAttribute("aria-hidden", "true");
    }
    const said = within(nbp).getByText(/^118 bölü 79/);
    expect(said).toHaveClass("sr-only");
    expect(said).not.toHaveAttribute("aria-hidden");
  });

  it("writes «ölçmə gözlənilir» in the muted colour: nothing went old, so no attention colour", () => {
    show(<Strip entry={card([param("nbp", null)])} />);
    const waiting = screen.getByText("ölçmə gözlənilir");
    expect(waiting).toHaveClass("text-mute");
    expect(waiting).not.toHaveClass("text-att-ink");
  });
});

// NBP-2 (D4): the monitor's current NBP whose change the hub has not seen, drawn apart from a timed one —
// the numbers and the unit as every strip value, the note in the attention tone (this interface's "cannot
// vouch", Decision 14), no «≤» and no age of measurement. The next poll that carries the change draws the
// timed form.
describe("NBP whose measurement time is unknown", () => {
  const UNTIMED = param("nbp", [118, 79, 92], { state: "value_untimed", changed_at: null, measured_age_s: null });
  const TIMED = { ...UNTIMED, state: "value", changed_at: NBP_CHANGED_AT, measured_age_s: 600 };
  const TIME = hhmm(Date.parse(NBP_CHANGED_AT));
  const WORDS = {
    tr: "ölçüm zamanı bilinmiyor", az: "ölçmə vaxtı məlum deyil", ru: "время измерения неизвестно",
    en: "measurement time unknown",
  };
  const SAID = {
    tr: "118 bölü 79, ortalama 92 mmHg; ölçüm zamanı bilinmiyor",
    az: "118 bölü 79, orta 92 mmHg; ölçmə vaxtı məlum deyil",
    ru: "118 на 79, среднее 92 мм рт. ст.; время измерения неизвестно",
    en: "118 over 79, mean 92 mmHg; measurement time unknown",
  };
  const UNIT = { tr: "mmHg", az: "mmHg", ru: "мм рт. ст.", en: "mmHg" };

  it("shows S/D (M), the unit and that the measurement time is unknown, in every language", () => {
    expect(Object.keys(WORDS).sort()).toEqual([...LANG_CODES].sort());
    for (const lang of LANG_CODES) {
      const { unmount } = show(<Strip entry={card([HR, UNTIMED])} />, lang);
      const nbp = screen.getAllByRole("definition")[1];
      expect(nbp, lang).toHaveTextContent("118/79 (92)");
      expect(within(nbp).getByText(UNIT[lang]), lang).toHaveAttribute("aria-hidden", "true");
      expect(within(nbp).getByText(WORDS[lang]), lang).toHaveAttribute("aria-hidden", "true");
      expect(within(nbp).getByText(SAID[lang]), lang).toHaveClass("sr-only");
      unmount();
    }
  });

  it("writes the note in the attention tone, not the muted one, and the numbers in plain ink", () => {
    show(<Strip entry={card([UNTIMED])} />);
    const nbp = screen.getByRole("definition");
    const note = within(nbp).getByText("ölçmə vaxtı məlum deyil");
    expect(note).toHaveClass("text-att-ink");
    expect(note).not.toHaveClass("text-mute");
    expect(nbp).toHaveClass("text-ink");
    const numbers = within(nbp).getByText("118/79 (92)");
    expect(numbers.className).not.toMatch(/text-(?:att|mute|crit|high|mid|low|ok|v-)/);
  });

  it("shows no «≤», no time and no age: neither the measurement's nor the packet's", () => {
    show(<Strip entry={card([UNTIMED])} />);
    const nbp = screen.getByRole("definition");
    expect(nbp).not.toHaveTextContent("≤");
    expect(nbp).not.toHaveTextContent(/\d{2}:\d{2}/);
    expect(nbp).not.toHaveTextContent(/\b(?:san|dəq|saat)\b/);
    expect(nbp).not.toHaveTextContent("ölçmə ≤");
    expect(nbp).not.toHaveTextContent("ölçmə gözlənilir");
  });

  it("hides the numbers, the unit and the note from a screen reader, which gets the one sentence", () => {
    show(<Strip entry={card([UNTIMED])} />);
    const nbp = screen.getByRole("definition");
    for (const part of ["118/79 (92)", "mmHg", "ölçmə vaxtı məlum deyil"]) {
      expect(within(nbp).getByText(part), part).toHaveAttribute("aria-hidden", "true");
    }
    const said = within(nbp).getByText(/^118 bölü 79/);
    expect(said).toHaveClass("sr-only");
    expect(said).not.toHaveAttribute("aria-hidden");
    expect(said).toHaveTextContent("ölçmə vaxtı məlum deyil");
  });

  it("takes two columns of the grid, as the timed form does", () => {
    show(<Strip entry={card([HR, UNTIMED])} />);
    const [, nbp] = within(region()).getAllByRole("term").map((term) => term.parentElement);
    expect(nbp.className.split(/\s+/)).toContain("col-span-2");
  });

  it("is the timed form on the next poll that carries the change: the same entry, «value» with its time", () => {
    const { rerender } = show(<Strip entry={card([UNTIMED])} />);
    expect(screen.getByRole("definition")).toHaveTextContent("ölçmə vaxtı məlum deyil");
    rerender(<I18nProvider><Strip entry={card([TIMED])} /></I18nProvider>);
    const nbp = screen.getByRole("definition");
    expect(nbp).toHaveTextContent("118/79 (92)");
    expect(nbp).toHaveTextContent(`ölçmə ≤ ${TIME} (10 dəq)`);
    expect(nbp).not.toHaveTextContent("ölçmə vaxtı məlum deyil");
  });

  it("goes old with its packet: a dash and «köhnə» with the packet's age, never the number", () => {
    show(<Strip entry={card([UNTIMED])} nowMs={NOW + 14_000} />);
    const nbp = screen.getByRole("definition");
    expect(nbp).toHaveTextContent("—");
    expect(nbp).toHaveTextContent("köhnə · 16 san");
    expect(nbp).not.toHaveTextContent("118");
    expect(nbp).not.toHaveTextContent("ölçmə vaxtı məlum deyil");
  });

  it("draws no number off a dead feed", () => {
    show(<Strip entry={card([UNTIMED])} feedOk={false} />);
    const nbp = screen.getByRole("definition");
    expect(nbp).not.toHaveTextContent("118");
    expect(nbp).toHaveTextContent("köhnə · 2 san");
  });

  it("carries no live region, no alert and no colour of a value", () => {
    const { container } = show(<Strip entry={card([HR, UNTIMED])} variant="full" />);
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(container.querySelector("[role='status']")).toBeNull();
    expect(container.querySelector("[class*='text-v-'], [class*='bg-crit'], [class*='text-crit'], [class*='bg-ok']")).toBeNull();
  });
});

describe("nothing on it can be taken for an alarm", () => {
  const RISKY = ["bg-crit", "text-crit", "bg-high", "text-high", "bg-mid", "bg-low", "bg-ok", "text-ok",
    "text-v-hr", "text-v-map", "text-v-spo", "text-v-rr", "text-v-t"];

  it("carries no risk or vital-identity colour, no live region and no alert", () => {
    const { container } = show(
      <>
        <Strip entry={card([HR, param("spo2", null), param("art_mean", 84), param("hr", 72, { age_s: 40 }),
          param("nbp", [118, 79, 92])])} variant="full" />
        <MonitorFeedChip data={strip({ beds: [card()] })} phase="ok" nowMs={NOW} fetchedAtMs={NOW} />
        <MonitorFeedChip data={strip({ beds: [card()], feed: { state: "forwarder_silent" } })} phase="ok" nowMs={NOW} fetchedAtMs={NOW} />
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

  it("says it cannot read the strip once its last answer is older than the display limit", () => {
    // One good answer, then a poll that hangs (or a hidden tab, a sleeping PC): 18 s later the
    // counts are not today's.
    show(<MonitorFeedChip data={ward} phase="ok" nowMs={NOW} fetchedAtMs={NOW - 18_000} maxAgeS={15} />);
    expect(screen.getByRole("note")).toHaveTextContent("Monitor zolağı oxunmur");
    expect(screen.queryByText(/məlumat göndərir/)).toBeNull();
  });

  it("says it cannot read the strip when this browser's clock is before the answer", () => {
    show(<MonitorFeedChip data={ward} phase="ok" nowMs={NOW - 1000} fetchedAtMs={NOW} maxAgeS={15} />);
    expect(screen.getByRole("note")).toHaveTextContent("Monitor zolağı oxunmur");
  });

  it("says it cannot read the strip when the first read failed, before any answer", () => {
    show(<MonitorFeedChip data={null} phase="unreadable" />);
    expect(screen.getByRole("note")).toHaveTextContent("Monitor zolağı oxunmur");
  });

  it("wraps its words: the az and ru counts do not fit one line at 390 px", () => {
    show(<MonitorFeedChip data={ward} phase="ok" nowMs={NOW} fetchedAtMs={NOW} />);
    expect(screen.getByText(/məlumat göndərir/).closest("span")).toHaveClass("!whitespace-normal");
  });

  it("counts what it saw, by the server's own counts", () => {
    show(<MonitorFeedChip data={ward} phase="ok" nowMs={NOW} fetchedAtMs={NOW} />);
    const chip = screen.getByText(/məlumat göndərir/).closest("span");
    expect(chip).toHaveTextContent("Monitor (təsdiqlənməmiş):");
    expect(chip).toHaveTextContent("1/4 məlumat göndərir · 1 susur · 2 gözləmədə · 1 təyin edilməyib");
  });

  it("says the feed's trouble instead of counts, as a static note", () => {
    show(<MonitorFeedChip data={{ ...ward, feed: { ...ward.feed, state: "forwarder_silent" } }} phase="ok" nowMs={NOW} fetchedAtMs={NOW} />);
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
    show(<MonitorFeedChip data={{ ...ward, table: { ...ward.table, status: "missing", reason: "dosya yok" } }} phase="ok" nowMs={NOW} fetchedAtMs={NOW} />);
    expect(screen.getByRole("note")).toHaveTextContent("Cihaz→çarpayı cədvəli yoxdur və ya etibarsızdır");
  });
});

// Aşama B (D7): with the rules switched on the API answers `stage: "rules"` (the route overwrites
// board_view's "shadow" with the running stage). The strip is the same strip in both.
describe("stripOn — the answers that are a strip that is on", () => {
  it("accepts «shadow» and «rules», and nothing else", () => {
    expect(stripOn({ stage: "shadow" })).toBe(true);
    expect(stripOn({ stage: "rules" })).toBe(true);
    for (const data of [STAGE_OFF, { stage: "alarms" }, { stage: "Rules" }, { stage: "" }, {}, null, undefined, "rules"]) {
      expect(stripOn(data), JSON.stringify(data)).toBe(false);
    }
  });

  it("the feed chip counts at the rules stage as at the shadow one, and draws nothing for «off»", () => {
    const ward = { ...strip({ beds: [card(), bed("REA-01 · 3", [], { status: "silent" })] }), stage: "rules" };
    const { container, rerender } = show(<MonitorFeedChip data={ward} phase="ok" nowMs={NOW} fetchedAtMs={NOW} />);
    expect(screen.getByText(/məlumat göndərir/).closest("span")).toHaveTextContent("1/2 məlumat göndərir · 1 susur");
    rerender(<I18nProvider><MonitorFeedChip data={{ ...ward, stage: "off" }} phase="ok" nowMs={NOW} fetchedAtMs={NOW} /></I18nProvider>);
    expect(container.innerHTML).toBe("");
  });
});

// EczaneScreen.test.jsx — «Aptek» (G3-04, spec D5–D19, §5, §6): the counters and the rows in the SERVER'S order; the
// six states with the engine's two tones; «Kayıt yok», never «verilmedi»; the vasopressor lines, creatinine and the
// fluid balance with no tone; the link only with `board.view`; the notes of D8, D9 and D19; the durations between
// polls; a list that is not fresh, a failed first read, a malformed answer, an empty one. The default language is az.
// Synthetic ward (eczane.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, screen, within } from "@testing-library/react";
import { board as wardOf } from "../../data/board.testutil.js";
import { dayStamp } from "../../i18n/dates.js";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { EczaneScreen } from "./EczaneScreen.jsx";
import { MIN, NOW, ROWS, SCOPE, answer, at, row } from "./eczane.testutil.js";

const PHARMACIST = ["board.view", "admissions.view", "pharmacy.view"];
const KEY_ONLY = ["pharmacy.view"];
const NOTE = "“Qeyd yoxdur” və “tətbiq qeydi yoxdur” bu sistemə antibiotik tətbiqinin qeyd edilmədiyini bildirir; verilmədiyi anlamına gəlmir.";
const SOURCE = "Antibiotik müddəti: mühərrikin sepsis və ya septik şok qaydasının ilk dəfə işə düşdüyü andan etibarən 1 saat — Surviving Sepsis Campaign 2026 (güclü tövsiyə, çox aşağı əminlikli sübut).";
const FOOTER = "Bu səhifədə yoxdur: təyinatlar, allergiyalar, kultura nəticələri, dərman qarşılıqlı təsiri sorğusu, antibiotik müalicə günü, doza tövsiyəsi. Homunculus diaqnoz qoymur, təyinat vermir.";
const CUT = "Maye cəmləri göstərilə bilmir: günün qeydləri oxuma həddini aşıb.";
/** An instant as the page writes it, in the test host's own zone (the page formats, it does not compute). */
const clock = (minutesAgo) => dayStamp(NOW - minutesAgo * MIN, NOW);
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
/** A read that never answers: the page stays as it was (a hidden tab's poll, a slow network). */
const never = () => new Promise(() => {});

async function open({ perms = PHARMACIST, setup } = {}) {
  const mounted = await mount(<EczaneScreen />, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      api.pharmacy.mockResolvedValue(answer());
      setup?.(api);
    },
  });
  await act(async () => { await settle(); });
  return mounted;
}
/** Move the clock (and every timer due in it) on, then let the reads it started land. */
const pass = (ms) => act(async () => { vi.advanceTimersByTime(ms); await settle(); });
const table = () => screen.getByRole("table");
const bodyRows = () => [...table().querySelectorAll("tbody tr")];
const rowOf = (patientId) => table().querySelector(`tbody tr[data-patient="${patientId}"]`);
const cell = (patientId, name) => rowOf(patientId).querySelector(`[data-cell="${name}"]`);
const tile = (field) => screen.getByTestId(`count-${field}`).textContent;
/** The page's own alert (ui/Alert, tone crit). By its tone: the shell keeps other `role="alert"` regions mounted
 *  empty (the alarm signals', the toasts'), so the role alone names more than one element. */
const alertBox = () => document.querySelector('[role="alert"][data-tone="crit"]');

// Fake timers that keep moving with the wall clock: `settle()` still resolves on its own, and a test may jump the
// 30 s poll and the clock's tick with `advanceTimersByTime` (the task screen's own setup).
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the pharmacy page", () => {
  it("has one h1, says what it is for, and reads the list once on open", async () => {
    const { api } = await open();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Aptek"]);
    expect(screen.getByText("Bu ekran izləmə üçündür; doza tövsiyə etmir, təyinat vermir.")).toBeInTheDocument();
    expect(api.pharmacy).toHaveBeenCalledTimes(1);
    expect(api.pharmacy).toHaveBeenCalledWith();
    expect(api.boardPatients).not.toHaveBeenCalled();           // its source is its own read, not the board store
    expect(alertBox()).toBeNull();
  });

  it("shows the server's four counters, and the part of the fourth", async () => {
    await open();
    expect(["clock_running", "clock_missed", "on_pressor", "recognized"].map(tile)).toEqual(["1", "1", "1", "4"]);
    expect(tile("recognized_no_record")).toBe("antibiotik qeydi yoxdur: 2");
    const labels = [...document.querySelectorAll("[data-counters] [data-testid]")].map((el) => el.nextElementSibling?.textContent);
    expect(labels.slice(0, 4)).toEqual(["Müddət gedir", "Müddət keçib", "Vazopressor / inotrop alan", "Sepsis aşkar edilən"]);
    expect(document.querySelector("[data-as-of]")).toBeNull();
  });

  it("colours a counter only by the engine's two severities, and only above zero", async () => {
    const { api } = await open();
    expect(screen.getByTestId("count-clock_missed").className).toContain("text-crit-ink");
    expect(screen.getByTestId("count-clock_running").className).toContain("text-high-ink");
    expect(screen.getByTestId("count-on_pressor").className).not.toMatch(/crit|high|ok/);
    expect(screen.getByTestId("count-recognized").className).not.toMatch(/crit|high|ok/);
    api.pharmacy.mockResolvedValue(answer({ counts: { patients: 6, clock_running: 0, clock_missed: 0, on_pressor: 0, recognized: 0, recognized_no_record: 0 } }));
    await pass(30_000);
    expect(["clock_running", "clock_missed"].map(tile)).toEqual(["0", "0"]);
    for (const field of ["clock_running", "clock_missed"]) expect(screen.getByTestId(`count-${field}`).className).not.toMatch(/crit|high|ok/);
  });

  it("draws the rows in the server's order, never its own", async () => {
    await open();
    expect(table()).toHaveAccessibleName("Aptek siyahısı: 6 xəstə");
    expect(bodyRows().map((tr) => tr.dataset.patient)).toEqual(ROWS.map((r) => r.patient_id));
    expect(bodyRows().map((tr) => tr.dataset.patient)).toEqual(["S-003", "S-004", "S-001", "S-005", "S-006", "S-002"]);
    expect([...table().querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(
      ["Çarpayı · xəstə", "Vazopressor / inotrop", "Antibiotik", "Kreatinin", `Bugünkü maye balansıgünün başlanğıcı ${clock(360)}`]);
  });

  // Review F3: «today» is the ward's fluid day (from the first shift's start, in the hospital's zone), and the
  // column says when it began — the server's `fluid_day.start`, written as every other instant on the page.
  it("says when the fluid day began, under the fluid column's heading", async () => {
    await open();
    const started = document.querySelector("[data-fluid-day]");
    expect(started.textContent).toBe(`günün başlanğıcı ${clock(360)}`);
    expect(started.closest("th")).toBe(table().querySelectorAll("thead th")[4]);
    expect(document.querySelectorAll("[data-fluid-day]")).toHaveLength(1);
  });

  it("writes the fluid day's start with its date when it began on another day", async () => {
    await open({ setup: (api) => api.pharmacy.mockResolvedValue(answer({ fluid_day: { start: at(26 * 60), end: at(2 * 60) } })) });
    expect(document.querySelector("[data-fluid-day]").textContent).toBe(`günün başlanğıcı ${clock(26 * 60)}`);
    expect(clock(26 * 60)).toMatch(/^\d\d\.\d\d \d\d:\d\d$/);
  });

  it.each([
    ["no fluid day", { fluid_day: undefined }],
    ["a null fluid day", { fluid_day: null }],
    ["a fluid day without its start", { fluid_day: { end: at(-1080) } }],
    ["a start that does not read", { fluid_day: { start: "dün", end: at(-1080) } }],
    ["a fluid day that is no object", { fluid_day: "bugün" }],
  ])("prints nothing beside the fluid heading for %s", async (_name, over) => {
    await open({ setup: (api) => api.pharmacy.mockResolvedValue(answer(over)) });
    expect(document.querySelector("[data-fluid-day]")).toBeNull();
    expect(table().querySelectorAll("thead th")[4].textContent).toBe("Bugünkü maye balansı");
    expect(cell("S-003", "fluid")).toHaveTextContent("+350 mL");          // the cells are untouched
  });

  it("words the six states as the server sent them, with the engine's two tones and no other", async () => {
    await open();
    expect(cell("S-003", "antibiotic")).toHaveTextContent(`Müddət keçib · 25 dəqaşkarlanma ${clock(85)} · tətbiq qeydi yoxdur`);
    expect(cell("S-003", "antibiotic").querySelector("[data-tone]").dataset.tone).toBe("crit");
    // S-004's record is `false` — something was charted that the rule does not count — so its second line says what
    // is missing (review F5); the state word and the tone are those of a row with no record at all.
    expect(cell("S-004", "antibiotic")).toHaveTextContent(`Müddət gedir · 20 dəq qalıbaşkarlanma ${clock(39.5)} · aşkarlanmadan sonra sayılan tətbiq qeydi yoxdur`);
    expect(cell("S-004", "antibiotic").querySelector("[data-tone]").dataset.tone).toBe("high");
    expect(cell("S-003", "antibiotic").textContent).not.toContain("sayılan");          // `given` null: nothing was charted
    expect(cell("S-001", "antibiotic").textContent).toBe(`Yerinə yetirilib · ${clock(170)}`);
    expect(cell("S-005", "antibiotic").textContent).toBe(`Gec verilib · ${clock(100)}`);
    expect(cell("S-006", "antibiotic").textContent).toBe(`Verilib · ${clock(50)}`);
    expect(cell("S-002", "antibiotic").textContent).toBe("Qeyd yoxdur");
    for (const id of ["S-001", "S-005", "S-006", "S-002"]) expect(cell(id, "antibiotic").querySelector("[data-tone]"), id).toBeNull();
    expect(bodyRows().map((tr) => tr.dataset.state)).toEqual(["missed", "running", "met", "late", "given", "none"]);
    expect([...document.querySelectorAll("[data-tone]")].map((el) => el.dataset.tone)).not.toContain("ok");
  });

  it("never says «not given»: no cell, no counter, in no state", async () => {
    await open();
    const NOT_GIVEN = /verilmədi|verilməyib|verilmedi|not given|не введ/i;
    expect(table().textContent).not.toMatch(NOT_GIVEN);
    expect(document.querySelector("[data-counters]").textContent).not.toMatch(NOT_GIVEN);
    expect(document.body.textContent.replace(NOTE, "")).not.toMatch(NOT_GIVEN);       // the note alone names the word, to deny it
  });

  it("prints each vasopressor in the Meds box's own sentence, with its charted time as an age", async () => {
    await open();
    expect([...cell("S-001", "pressors").children].map((el) => el.textContent)).toEqual([
      "noradrenalin 0.12 mkq/kq/dəq · 20 dəq əvvəl", "dopamin dayandırıldı · 3 saat əvvəl"]);
    expect(cell("S-003", "pressors").textContent).toBe("Qeyd yoxdur");
    expect(cell("S-002", "pressors").textContent).toBe("Qeyd yoxdur");
  });

  it("prints creatinine and the fluid balance as a number and its time, with no tone", async () => {
    await open();
    expect(cell("S-003", "creatinine").textContent).toBe(`2.1 mq/dL · ${clock(260)}`);
    expect(cell("S-004", "creatinine").textContent).toBe("Qeyd yoxdur");
    expect(cell("S-003", "fluid")).toHaveTextContent(`+350 mLqəbul etdiyi 1250 mL · xaric etdiyi 900 mL · son qeyd ${clock(30)}`);
    expect(cell("S-004", "fluid")).toHaveTextContent(`−450,5 mLqəbul etdiyi 200 mL · xaric etdiyi 650,5 mL · son qeyd ${clock(90)}`);
    expect(cell("S-001", "fluid").textContent).toBe("Bu gün qeyd yoxdur");           // never «0 mL»
    for (const id of ROWS.map((r) => r.patient_id)) {
      for (const name of ["creatinine", "fluid", "pressors"]) {
        expect(cell(id, name).querySelector("[data-tone]"), `${id} ${name}`).toBeNull();
        expect(cell(id, name).innerHTML, `${id} ${name}`).not.toMatch(/text-(crit|high|ok|att)/);
      }
    }
  });

  it("links the bed and the name, as one link, to the patient screen — for a session that holds board.view", async () => {
    await open();
    const link = within(rowOf("S-003")).getByRole("link");
    expect(link).toHaveAttribute("href", "#/patients/S-003");
    expect(link).toHaveTextContent("YBU 1-3Örnek Hasta Üç");
    expect(within(table()).getAllByRole("link")).toHaveLength(6);
    // The board's own two rules: the patient key where the HIS sent no bed label, and «identity pending» for no name.
    expect(within(rowOf("S-002")).getByRole("link")).toHaveTextContent("S-002kimlik gözlənilir");
    expect(within(rowOf("S-002")).getByRole("link")).toHaveAttribute("href", "#/patients/S-002");
    expect(rowOf("S-003").getAttribute("onclick")).toBeNull();
  });

  it("draws no link for a session that holds pharmacy.view alone", async () => {
    await open({ perms: KEY_ONLY });
    expect(within(table()).queryAllByRole("link")).toHaveLength(0);
    expect(within(rowOf("S-003")).getByRole("rowheader")).toHaveTextContent("YBU 1-3Örnek Hasta Üç");
  });

  it("carries the three notes: what «no record» means, the window's source with both halves, what is not here", async () => {
    await open();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(document.querySelector("[data-source]").textContent).toBe(SOURCE);
    expect(document.querySelector("[data-footer]").textContent).toBe(FOOTER);
  });

  it("prints the server's own window when it is not the one the source sentence states", async () => {
    await open({ setup: (api) => api.pharmacy.mockResolvedValue(answer({ antibiotic_window_min: 45 })) });
    expect(document.querySelector("[data-source]").textContent).toBe(
      "Antibiotik müddəti: mühərrikin sepsis və ya septik şok qaydasının ilk dəfə işə düşdüyü andan etibarən 45 dəq — mənbə: surviving-sepsis-campaign-2026.");
    expect(document.body.textContent).not.toContain("1 saat — Surviving");
  });

  // Review F2: a cut read lost the day's OLDEST rows, so a balance may be understated and a `fluid: null` may be a
  // patient WITH entries. Neither may be printed as if it were known: every fluid cell is a dash, and the note says why.
  it("prints no fluid number and no «no entry today» when the fluid read had to cut — a dash in every row, and the note", async () => {
    const { api } = await open({ setup: (a) => a.pharmacy.mockResolvedValue(answer({ fluid_truncated: true })) });
    expect(screen.getByText(CUT)).toBeInTheDocument();
    expect(ROWS.map((r) => cell(r.patient_id, "fluid").textContent)).toEqual(["—", "—", "—", "—", "—", "—"]);
    expect(table().textContent).not.toMatch(/Bu gün qeyd yoxdur|\d\s*mL|qəbul etdiyi|xaric etdiyi|son qeyd/);
    expect(document.querySelector("[data-fluid-day]").textContent).toBe(`günün başlanğıcı ${clock(360)}`);
    expect(cell("S-003", "creatinine").textContent).toBe(`2.1 mq/dL · ${clock(260)}`);          // the other columns stand
    expect(cell("S-001", "pressors")).toHaveTextContent("noradrenalin 0.12 mkq/kq/dəq · 20 dəq əvvəl");
    // …and a list that is no longer fresh does not bring the numbers back
    api.pharmacy.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor"));
    await pass(30_000);
    expect(alertBox()).toHaveTextContent("Aptek siyahısı aktual deyil");
    expect(ROWS.map((r) => cell(r.patient_id, "fluid").textContent)).toEqual(["—", "—", "—", "—", "—", "—"]);
    expect(screen.getByText(CUT)).toBeInTheDocument();
  });

  it("an answer that was not cut prints the balances and «no entry today», with no note about a cut", async () => {
    for (const flag of [false, undefined, null]) {
      // eslint-disable-next-line no-await-in-loop
      await open({ setup: (api) => api.pharmacy.mockResolvedValue(answer({ fluid_truncated: flag })) });
      expect(screen.queryByText(CUT), String(flag)).toBeNull();
      expect(cell("S-003", "fluid"), String(flag)).toHaveTextContent(`+350 mLqəbul etdiyi 1250 mL · xaric etdiyi 900 mL · son qeyd ${clock(30)}`);
      expect(cell("S-001", "fluid").textContent, String(flag)).toBe("Bu gün qeyd yoxdur");
      cleanup();
    }
  });

  it("shows the answer's own scope note, in the engine's words", async () => {
    await open({ setup: (api) => api.pharmacy.mockResolvedValue(answer({ scope_note: "Kapsamınız dışında 4 kart var." })) });
    expect(screen.getByText("Kapsamınız dışında 4 kart var.")).toHaveAttribute("lang", "tr");
    expect(screen.getByText(/^Əhatənizdən kənarda qalan kart: 4\./)).toBeInTheDocument();
  });

  it("prints a state this build does not know as the server's word, never as no record", async () => {
    const odd = row("S-009", { bed_label: "YBU 1-9", antibiotic: { state: "paused", given: null, given_at: null, recognized_at: null, deadline: null, remaining_sec: null } });
    await open({ setup: (api) => api.pharmacy.mockResolvedValue(answer({ rows: [odd] })) });
    expect(cell("S-009", "antibiotic").textContent).toBe("Bu versiyanın tanımadığı vəziyyət: paused");
  });
});

describe("between two polls", () => {
  it("reads again every 30 s, and at once when the tab is shown again", async () => {
    const { api } = await open();
    await pass(30_000);
    expect(api.pharmacy).toHaveBeenCalledTimes(2);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
    expect(api.pharmacy).toHaveBeenCalledTimes(3);
  });

  it("moves the durations and the ages with the clock, while the state word stays the server's", async () => {
    // A server that answers now, with the same clocks: the list stays fresh while the screen's clock moves.
    await open({ setup: (api) => api.pharmacy.mockImplementation(() => Promise.resolve(answer({ now: new Date().toISOString() }))) });
    await pass(3 * MIN);
    expect(cell("S-003", "antibiotic")).toHaveTextContent("Müddət keçib · 28 dəq");
    expect(cell("S-004", "antibiotic")).toHaveTextContent("Müddət gedir · 17 dəq qalıb");
    expect(cell("S-001", "pressors")).toHaveTextContent("noradrenalin 0.12 mkq/kq/dəq · 23 dəq əvvəl");
    await pass(18 * MIN);                                       // the running row's deadline has passed by half a minute
    expect(cell("S-004", "antibiotic")).toHaveTextContent("Müddət gedir · <1 dəq qalıb");
    expect(rowOf("S-004").dataset.state).toBe("running");
    expect(alertBox()).toBeNull();
  });
});

describe("a list that is not fresh", () => {
  it("keeps the last answer under an alert with its time and the read's reason, and stops counting", async () => {
    const { api } = await open();
    api.pharmacy.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor"));
    await pass(30_000);
    const alert = alertBox();
    expect(alert).toHaveTextContent(`Aptek siyahısı aktual deyil · son cavab ${clock(0)}`);
    expect(alert).toHaveTextContent("Giriş əhatəniz hazırda oxuna bilmir; bir az sonra yenidən cəhd edin.");
    expect(["clock_running", "clock_missed", "on_pressor", "recognized"].map(tile)).toEqual(["1", "1", "1", "4"]);
    expect(document.querySelector("[data-as-of]").textContent).toBe(`son cavab ${clock(0)} vəziyyətinə görə`);
    expect(bodyRows()).toHaveLength(6);
    expect(cell("S-003", "antibiotic")).toHaveTextContent(`Son cavabda müddət keçmişdi · bitmə ${clock(25)}`);
    expect(cell("S-004", "antibiotic")).toHaveTextContent(`Son cavabda müddət gedirdi · bitmə ${clock(-20.5)}`);
    // the second lines stand as they were: the plain one for no record at all, the qualified one for a `false` record (F5)
    expect(cell("S-003", "antibiotic").lastElementChild.textContent).toBe(`aşkarlanma ${clock(85)} · tətbiq qeydi yoxdur`);
    expect(cell("S-004", "antibiotic").lastElementChild.textContent).toBe(`aşkarlanma ${clock(39.5)} · aşkarlanmadan sonra sayılan tətbiq qeydi yoxdur`);
    expect(table().textContent).not.toMatch(/Müddət keçib ·|Müddət gedir ·|dəq qalıb|əvvəl/);
    expect([...cell("S-001", "pressors").children].map((el) => el.textContent)).toEqual([
      `noradrenalin 0.12 mkq/kq/dəq · ${clock(20)}`, `dopamin dayandırıldı · ${clock(180)}`]);
    expect(cell("S-001", "antibiotic").textContent).toBe(`Yerinə yetirilib · ${clock(170)}`);     // a record stands as it is
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it("is not fresh either when no answer has landed for three polls, and says no reason it does not have", async () => {
    const { api } = await open();
    api.pharmacy.mockImplementation(never);
    await pass(101_000);          // past 90 s, on the page's next 10 s clock tick
    const alert = alertBox();
    expect(alert.textContent).toBe(`Aptek siyahısı aktual deyil · son cavab ${clock(0)}`);
    expect(cell("S-003", "antibiotic")).toHaveTextContent("Son cavabda müddət keçmişdi");
  });

  it("is fresh again when a read lands", async () => {
    const { api } = await open();
    api.pharmacy.mockRejectedValueOnce(refusal(503, "kapsam şu anda okunamıyor"));
    await pass(30_000);
    expect(alertBox()).toBeInTheDocument();
    api.pharmacy.mockImplementation(() => Promise.resolve(answer({ now: new Date().toISOString() })));
    await pass(30_000);
    expect(alertBox()).toBeNull();
    expect(cell("S-003", "antibiotic")).toHaveTextContent("Müddət keçib · 26 dəq");
    expect(document.querySelector("[data-as-of]")).toBeNull();
  });

  it("with no rows says only that it is not fresh — never that nobody is in view", async () => {
    const { api } = await open({ setup: (a) => a.pharmacy.mockResolvedValue(answer({ rows: [], scope: { ...SCOPE, blind: true },
      scope_note: "Atanmış birimlerinizde yatan hasta görünmüyor.", counts: { patients: 0, clock_running: 0, clock_missed: 0, on_pressor: 0, recognized: 0, recognized_no_record: 0 } })) });
    expect(screen.getByText("Görünüşünüzdə yatan xəstə yoxdur.")).toBeInTheDocument();
    expect(screen.getByText("Atanmış birimlerinizde yatan hasta görünmüyor.")).toBeInTheDocument();
    expect(["clock_running", "clock_missed", "on_pressor", "recognized"].map(tile)).toEqual(["0", "0", "0", "0"]);     // fresh: the server's zeros
    api.pharmacy.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor"));
    await pass(30_000);
    expect(alertBox()).toHaveTextContent("Aptek siyahısı aktual deyil");
    expect(screen.queryByText("Görünüşünüzdə yatan xəstə yoxdur.")).toBeNull();
    expect(screen.queryByText("Atanmış birimlerinizde yatan hasta görünmüyor.")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    // Review F4 (spec §6): …and so no counter either — four «0» tiles under the alert would read as a quiet ward.
    expect(document.querySelector("[data-counters]")).toBeNull();
    expect(document.querySelectorAll('[data-testid^="count-"]')).toHaveLength(0);
    expect(document.querySelector("[data-as-of]")).toBeNull();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  // F4's other side: the counters of a held list WITH rows stay, under «as of the last answer» (unchanged).
  it("with rows keeps its counters under the time of the last answer", async () => {
    const { api } = await open();
    api.pharmacy.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor"));
    await pass(30_000);
    expect(["clock_running", "clock_missed", "on_pressor", "recognized"].map(tile)).toEqual(["1", "1", "1", "4"]);
    expect(document.querySelector("[data-as-of]").textContent).toBe(`son cavab ${clock(0)} vəziyyətinə görə`);
  });

  // Review F6: 401 and 403 are not a list gone stale — the caller may no longer see it. The held answer is dropped:
  // the page says only that the list could not be read, and why.
  it.each([
    [403, "permission required: pharmacy.view", "Aptek siyahısı oxuna bilmədi: Bu əməliyyat üçün səlahiyyətiniz yoxdur (pharmacy.view)."],
    [401, "oturum geçersiz", null],
  ])("drops the list when the read is refused with %i: no table, no counter, no name left on the page", async (status, detail, text) => {
    const { api } = await open();
    expect(bodyRows()).toHaveLength(6);
    api.pharmacy.mockRejectedValue(refusal(status, detail));
    await pass(30_000);
    expect(alertBox()).toHaveTextContent("Aptek siyahısı oxuna bilmədi: ");
    if (text) expect(alertBox().textContent).toBe(text);
    expect(alertBox().textContent).not.toContain("aktual deyil");
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.querySelector("[data-counters]")).toBeNull();
    expect(document.querySelector("[data-source]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Örnek Hasta|YBU 1-|S-00\d/);
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it("keeps the list through a server error and a network failure, as before", async () => {
    for (const failure of [refusal(500, "boom"), new TypeError("Failed to fetch")]) {
      // eslint-disable-next-line no-await-in-loop
      const { api } = await open();
      api.pharmacy.mockRejectedValue(failure);
      // eslint-disable-next-line no-await-in-loop
      await pass(30_000);
      expect(alertBox(), failure.message).toHaveTextContent("Aptek siyahısı aktual deyil");
      expect(bodyRows(), failure.message).toHaveLength(6);
      expect(["clock_running", "clock_missed", "on_pressor", "recognized"].map(tile), failure.message).toEqual(["1", "1", "1", "4"]);
      cleanup();
    }
  });
});

describe("with no answer at all", () => {
  it("says the list is being read, with no counter and no table", async () => {
    await open({ setup: (api) => api.pharmacy.mockImplementation(never) });
    expect(screen.getByText("Aptek siyahısı oxunur…")).toBeInTheDocument();
    expect(document.querySelector("[data-counters]")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(alertBox()).toBeNull();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(document.querySelector("[data-footer]").textContent).toBe(FOOTER);
  });

  it("says a failed first read with its reason — no counter, no table, never zeros", async () => {
    await open({ setup: (api) => api.pharmacy.mockRejectedValue(refusal(403, "permission required: pharmacy.view")) });
    expect(alertBox().textContent).toBe(
      "Aptek siyahısı oxuna bilmədi: Bu əməliyyat üçün səlahiyyətiniz yoxdur (pharmacy.view).");
    expect(document.querySelector("[data-counters]")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Görünüşünüzdə yatan xəstə yoxdur.")).toBeNull();
    expect(document.querySelector("[data-source]")).toBeNull();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/(^|\D)0(\D|$)/);
  });

  it("takes an answer without its rows for a failed read, not for an empty ward", async () => {
    await open({ setup: (api) => api.pharmacy.mockResolvedValue({ now: at(0), counts: { patients: 0 } }) });
    expect(alertBox().textContent).toBe(
      "Aptek siyahısı oxuna bilmədi: serverin cavabı bu səhifənin oxuduğu formada deyil");
    expect(screen.queryByText("Görünüşünüzdə yatan xəstə yoxdur.")).toBeNull();
    expect(document.querySelector("[data-counters]")).toBeNull();
  });

  it("recovers when a later read lands", async () => {
    const { api } = await open({ setup: (a) => a.pharmacy.mockRejectedValueOnce(refusal(503, "kapsam şu anda okunamıyor")) });
    expect(alertBox()).toHaveTextContent("Aptek siyahısı oxuna bilmədi");
    api.pharmacy.mockImplementation(() => Promise.resolve(answer({ now: new Date().toISOString() })));
    await pass(30_000);
    expect(alertBox()).toBeNull();
    expect(bodyRows()).toHaveLength(6);
  });
});

// Review F1: the page's clock is the SERVER'S for every session. `useBoardNow` takes its correction from the board
// store, which only starts for a `board.view` holder; a session that holds `pharmacy.view` alone used to judge the
// durations and the freshness on the workstation's raw clock — a fast clock read «güncel değil» for ever, a slow one
// let a dead list read fresh and overstated «n dk kaldı». In every test below the SERVER'S clock stands on NOW (the
// answers say so) and the workstation's is wrong.
describe("the page's clock, on a workstation whose clock is wrong", () => {
  const slow = -5 * MIN;
  const fast = 2 * MIN;
  /** What a right clock shows 10 s after the answer (the server's NOW + 10 s): a list that is fresh, the deadline
   *  passed 25:10 ago, 20:20 left on the other, and a rate charted 20:10 ago — an AGE rounds up (`ageParts`). On the
   *  slow workstation's raw clock these would read 20, 25 and 16; on the fast one's the list is «not fresh» for ever. */
  function expectTheServersMinutes() {
    expect(alertBox()).toBeNull();
    expect(cell("S-003", "antibiotic")).toHaveTextContent("Müddət keçib · 25 dəq");
    expect(cell("S-004", "antibiotic")).toHaveTextContent("Müddət gedir · 20 dəq qalıb");
    expect(cell("S-001", "pressors")).toHaveTextContent("noradrenalin 0.12 mkq/kq/dəq · 21 dəq əvvəl");
    expect(document.querySelector("[data-as-of]")).toBeNull();
  }

  it.each([
    ["5 minutes slow", slow], ["2 minutes fast", fast],
  ])("pharmacy.view alone, %s: the minutes and the freshness are the server's — from the answer's own `now`", async (_name, offset) => {
    vi.setSystemTime(NOW + offset);
    const { api, board } = await open({ perms: KEY_ONLY });      // the fake client measured no skew (null)
    expect(board.getState().clockSkewMs).toBeNull();             // no board store behind this session
    await pass(10_000);                                          // the page's 10 s clock tick
    expectTheServersMinutes();
    api.pharmacy.mockImplementation(never);                      // …and the list dies: no answer for three polls
    await pass(101_000);
    expect(alertBox().textContent).toBe(`Aptek siyahısı aktual deyil · son cavab ${clock(0)}`);
    expect(cell("S-003", "antibiotic")).toHaveTextContent("Son cavabda müddət keçmişdi");
  });

  it.each([
    ["5 minutes slow", slow], ["2 minutes fast", fast],
  ])("pharmacy.view alone, %s: …and from the skew the API client measured on the answer, when it has one", async (_name, offset) => {
    vi.setSystemTime(NOW + offset);
    const { api } = await open({ perms: KEY_ONLY, setup: (a) => a.serverClockSkewMs.mockReturnValue(-offset) });
    await pass(10_000);
    expectTheServersMinutes();
    api.pharmacy.mockImplementation(never);
    await pass(101_000);
    expect(alertBox().textContent).toBe(`Aptek siyahısı aktual deyil · son cavab ${clock(0)}`);
  });

  it("a board.view holder's clock is the board's, as before", async () => {
    vi.setSystemTime(NOW + slow);
    const { api, board } = await open({ setup: (a) => {
      a.serverClockSkewMs.mockReturnValue(-slow);
      a.boardPatients.mockResolvedValue(wardOf([]));
    } });
    await act(async () => { await board.start(); });
    expect(board.getState().clockSkewMs).toBe(-slow);
    await pass(10_000);
    expectTheServersMinutes();
    // The board's skew wins over the page's own while the board has one: a later answer that measured another skew
    // (here a minute less) moves nothing until the board itself says so.
    api.serverClockSkewMs.mockReturnValue(-slow - MIN);
    api.pharmacy.mockImplementation(() => Promise.resolve(answer({ now: new Date(Date.now() - slow).toISOString() })));
    await pass(30_000);
    expect(alertBox()).toBeNull();
    expect(cell("S-003", "antibiotic")).toHaveTextContent("Müddət keçib · 25 dəq");      // 25:40 on the board's clock; 24:40 on the other
    act(() => { board.clear(); });
  });
});

describe("an empty list", () => {
  it("a fresh answer with no rows says nobody is in view, under the scope note, with the server's zeros", async () => {
    await open({ setup: (api) => api.pharmacy.mockResolvedValue(answer({ rows: [], scope: { ...SCOPE, blind: true },
      scope_note: "Atanmış birimlerinizde yatan hasta görünmüyor.", counts: { patients: 0, clock_running: 0, clock_missed: 0, on_pressor: 0, recognized: 0, recognized_no_record: 0 } })) });
    const note = screen.getByText("Atanmış birimlerinizde yatan hasta görünmüyor.");
    const empty = screen.getByText("Görünüşünüzdə yatan xəstə yoxdur.");
    expect(note.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(["clock_running", "clock_missed", "on_pressor", "recognized"].map(tile)).toEqual(["0", "0", "0", "0"]);
    expect(screen.getByText(NOTE)).toBeInTheDocument();          // a 0 is a number the server sent, not a reassurance
  });
});

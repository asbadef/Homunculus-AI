// EnfeksiyonScreen.test.jsx — «İnfeksiya nəzarəti» (G4-05, spec D13–D15 as §5 S1, A3, A4, M3, M4, M7 amend them): the
// header and the unit filter (and its fallback), the five cards with their second lines, both tables in the page's
// order, the isolation beds drawn from the tree in every tile state, the notes; the links only with `board.view`; the
// bed section without a structure key and with a failed tree while the rest stands; an answer that is not fresh, a
// failed first read, a refused read, a malformed answer. The default language is az. Synthetic ward
// (enfeksiyon.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { dayStamp } from "../../i18n/dates.js";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { StructureProvider } from "../../data/StructureProvider.jsx";
import { UUID_TEXT } from "../kabul/kabul.testutil.js";
import { EnfeksiyonScreen } from "./EnfeksiyonScreen.jsx";
import { COUNTS, NOW, REA, answer, iso, row, tree } from "./enfeksiyon.testutil.js";

/** The default nurse group, as the engine seeds it since G4-05 (auth/permissions.py). */
const NURSE = ["board.view", "alerts.ack", "admissions.view", "admissions.admit", "admissions.transfer.confirm",
  "handover.sign", "clinical.chart", "beds.release", "tasks.view", "tasks.manage", "infection.view"];
const KEY_ONLY = ["infection.view"];
const HONESTY = "Bu səhifədə yoxdur: cihaz günləri (mərkəzi kateter, sidik kateteri, ventilyator), cihazdan istifadə "
  + "nisbəti, infeksiya nisbətləri, antibiotik günü və kultura nəticələri — heç birinin bu sistemdə mənbə qeydi yoxdur; "
  + "heç biri hesablanmayıb. İnfeksiya tərifi və hadisə sayı bu sistemin işi deyil; sistem hədd və ya tərif yaratmır. "
  + "Homunculus diaqnoz qoymur, təyinat vermir.";
const ISOLATION_NOTE = "İzolyasiya klinisistin xəstə ekranından bu sistemə qeyd etdiyi tədbir növləridir; sistem "
  + "izolyasiya tövsiyə etmir, növünü seçmir. “İzolyasiya qeydi yoxdur” qeydin edilmədiyini bildirir; xəstənin "
  + "izolyasiyada olmadığı anlamına gəlmir.";
const ECZANE_NOTE = "“Qeyd yoxdur” və “tətbiq qeydi yoxdur” bu sistemə antibiotik tətbiqinin qeyd edilmədiyini bildirir; "
  + "verilmədiyi anlamına gəlmir.";
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const pass = (ms) => act(async () => { vi.advanceTimersByTime(ms); await settle(); });
const clock = (ms) => dayStamp(ms, NOW);

async function open({ perms = NURSE, setup } = {}) {
  const mounted = await mount(<StructureProvider><EnfeksiyonScreen /></StructureProvider>, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      api.structure.mockResolvedValue(tree());
      api.infection.mockResolvedValue(answer());
      setup?.(api);
    },
  });
  await act(async () => { await settle(); });
  await act(async () => { await settle(); });
  return mounted;
}
const card = (field) => screen.getByTestId(`count-${field}`).textContent;
const tableOf = (name) => screen.getByRole("table", { name });
const rowIds = (name) => [...tableOf(name).querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-patient"));
const cell = (name, patientId, column) => tableOf(name).querySelector(`tr[data-patient="${patientId}"] [data-cell="${column}"]`);
const tiles = () => [...document.querySelectorAll("[data-beds] li[data-tile]")];
const tile = (label) => tiles().find((li) => li.querySelector("b").textContent === label);
const tally = () => document.querySelector("[data-tally]")?.textContent ?? null;
/** The page's own alert (ui/Alert, tone crit): the shell keeps other `role="alert"` regions mounted empty. */
const alertBox = () => document.querySelector('[role="alert"][data-tone="crit"]');
const ISOLATED = "İzolyasiyadakı xəstələr: 4";
const SUSPECTED = "Şübhəli infeksiya və ya sepsis siqnalı: 4 xəstə";

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the infection-control page", () => {
  it("has one h1, says what it shows and as of when, and reads the list and the tree once on open", async () => {
    const { api } = await open();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["İnfeksiya nəzarəti"]);
    expect(screen.getByText("İzolyasiya, şübhəli infeksiya, antibiotik müddəti və sepsis siqnalları")).toBeInTheDocument();
    expect(document.querySelector("[data-as-of]").textContent).toBe(`${clock(NOW)} vəziyyətinə görə`);
    expect(api.infection).toHaveBeenCalledTimes(1);
    expect(api.infection).toHaveBeenCalledWith();
    expect(api.boardPatients).not.toHaveBeenCalled();             // its patients are its own read
    expect(alertBox()).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); await settle(); });
    expect(api.infection).toHaveBeenCalledTimes(2);
  });

  it("shows the five cards with the server's numbers, the two «no record» lines and the free isolation beds", async () => {
    await open();
    expect(["isolated", "free_beds", "suspected", "clock_missed", "sepsis_open"].map(card)).toEqual(["4", "1 / 10", "3", "1", "1"]);
    expect(card("isolation_unrecorded")).toBe("3 xəstədə izolyasiya qeydi yoxdur");
    expect(card("suspected_unrecorded")).toBe("4 xəstədə işarə yoxdur");
    const counters = document.querySelector("[data-counters]");
    for (const label of ["izolyasiyada qeydə alınmış xəstə", "boş izolyasiya çarpayısı", "şübhəli infeksiya işarələnmiş xəstə",
      "antibiotik müddəti keçən", "sepsis siqnalı davam edən xəstə", "cavablandırılmış və ya cavablandırılmamış"]) {
      expect(within(counters).getByText(label)).toBeInTheDocument();
    }
  });

  it("lists the isolated by unit and bed name, a patient on no unit last, with the types, the record's time and the room", async () => {
    await open();
    expect(rowIds(ISOLATED)).toEqual(["S-104", "S-101", "S-108", "S-105"]);
    expect(cell(ISOLATED, "S-101", "unit").textContent).toBe("Reanimasiya");
    expect(within(cell(ISOLATED, "S-101", "isolation")).getByText("Təmas")).toBeInTheDocument();
    expect(within(cell(ISOLATED, "S-101", "isolation")).getByText("Damcı")).toBeInTheDocument();
    expect(cell(ISOLATED, "S-101", "isolation").textContent).toContain(`son qeyd ${clock(NOW - 80 * 60_000)}`);
    expect(cell(ISOLATED, "S-101", "room").textContent).toBe("izolyasiya otağı");
    expect(cell(ISOLATED, "S-104", "room").textContent).toBe("izolyasiya otağında deyil");
    expect(cell(ISOLATED, "S-105", "unit").textContent).toBe("— şöbəsi bəlli deyil");
    expect(cell(ISOLATED, "S-105", "room").textContent).toBe("— çarpayısı bəlli deyil");
    const s104 = tableOf(ISOLATED).querySelector('tr[data-patient="S-104"] th');
    expect(s104.textContent).toBe("1kimlik gözlənilir");                  // the bed, and no name from the HIS
  });

  it("lists the suspected by the server's group — the passed clock first — with Eczane's cell and the alarms by kind", async () => {
    await open();
    expect(rowIds(SUSPECTED)).toEqual(["S-103", "S-102", "S-101", "S-107"]);
    expect(cell(SUSPECTED, "S-103", "antibiotic").textContent).toContain("Müddət keçib · 25 dəq");
    expect(cell(SUSPECTED, "S-102", "antibiotic").textContent).toContain("Müddət gedir · 20 dəq qalıb");
    expect(cell(SUSPECTED, "S-107", "antibiotic").textContent).toBe("Qeyd yoxdur");
    expect(cell(SUSPECTED, "S-103", "sepsis").textContent).toBe("Septik şok meyarları ödənilib");
    expect(cell(SUSPECTED, "S-107", "sepsis").textContent).toBe("Septik şok meyarları ödənilib keçdi · təsdiqlənməyib");
    expect(cell(SUSPECTED, "S-102", "sepsis").textContent).toBe("Açıq sepsis siqnalı yoxdur");
    expect(cell(SUSPECTED, "S-103", "sepsis").querySelector("[data-tone]").getAttribute("data-tone")).toBe("crit");
  });

  it("draws the isolation beds from the tree in every state, with who lies on them and the tally", async () => {
    await open();
    expect(tiles().map((li) => [li.querySelector("b").textContent, li.getAttribute("data-tile")])).toEqual([
      ["İzo 1", "isolated"], ["İzo 2", "free"], ["İzo 3", "occupant_unseen"], ["İzo 4", "cleaning"], ["İzo 5", "reserved"],
      ["İzo 6", "out_of_service"], ["İzo 7", "maintenance"], ["İzo 8", "not_isolated"], ["İzo 9", "unrecorded"],
      ["İzo 10", "conflict"]]);
    const words = (label) => tile(label).querySelector("[data-words]").textContent;
    expect(words("İzo 1")).toBe("izolyasiyalı xəstə");
    expect(within(tile("İzo 1")).getByText("Ayşe Sentetik")).toBeInTheDocument();
    expect(within(tile("İzo 1")).getByText("Təmas")).toBeInTheDocument();
    expect(words("İzo 2")).toBe("boşdur");
    expect(words("İzo 3")).toBe("doludur — xəstə bu siyahıda yoxdur");
    expect(words("İzo 6")).toBe("istifadədən kənardır");                   // no reason: it is Doluluk's read (§5 S1)
    expect(words("İzo 8")).toBe("izolyasiyasız xəstə");
    expect(words("İzo 9")).toBe("izolyasiya qeydi yoxdur");
    expect(words("İzo 10")).toBe("strukturda boş · paneldə xəstə var");     // §5 A4 a: never «boşdur» over a patient
    expect(within(tile("İzo 10")).getByText("Kamran Sentetik")).toBeInTheDocument();
    expect(tally()).toBe("4 doludur · 1 boşdur");
    for (const li of tiles()) expect(li.querySelector("[data-tone]:not([data-tone='warn'])"), li.textContent).toBeNull();
  });

  it("says what the page does not have, what isolation is, and what Eczane's lines say, in every state", async () => {
    await open();
    expect(screen.getByText(HONESTY)).toBeInTheDocument();
    expect(screen.getByText(ISOLATION_NOTE)).toBeInTheDocument();
    expect(screen.getByText(ECZANE_NOTE)).toBeInTheDocument();
    expect(document.querySelector("[data-source]").textContent).toMatch(/^Antibiotik müddəti: .* 1 saat — Surviving Sepsis Campaign 2026/);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("opens a patient from the bed and the name only for a session that may see the board", async () => {
    await open();
    expect(within(tableOf(ISOLATED)).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "#/patients/S-104", "#/patients/S-101", "#/patients/S-108", "#/patients/S-105"]);
    cleanup();
    await open({ perms: KEY_ONLY });
    expect(screen.queryAllByRole("link")).toEqual([]);
  });
});

describe("the unit filter (spec D13 item 1, §5 S1)", () => {
  it("offers every unit of the tree and the answer, and narrows the cards, the rows and the tiles to one", async () => {
    await open();
    const select = screen.getByLabelText("Şöbə");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Bütün şöbələr", "Reanimasiya"]);
    await act(async () => { fireEvent.change(select, { target: { value: REA } }); await settle(); });
    expect(rowIds("İzolyasiyadakı xəstələr: 3")).toEqual(["S-104", "S-101", "S-108"]);      // S-105 is on no unit
    expect(card("suspected_unrecorded")).toBe("3 xəstədə işarə yoxdur");
    expect(tiles()).toHaveLength(10);
  });

  it("falls back to «Bütün şöbələr» when a new read no longer lists the chosen unit, and says so", async () => {
    const { api } = await open();
    await act(async () => { fireEvent.change(screen.getByLabelText("Şöbə"), { target: { value: REA } }); await settle(); });
    api.structure.mockResolvedValue({ tenant_id: null, sites: [] });
    api.infection.mockResolvedValue(answer({ units: [], isolated: [], suspected: [], bed_occupants: [],
      counts: { ...COUNTS, patients: 0, isolated: 0, suspected: 0 } }));
    await pass(30_000);
    expect(screen.getByLabelText("Şöbə").value).toBe("*");
    expect(screen.getByText("Seçilmiş şöbə artıq əhatənizdə deyil.")).toBeInTheDocument();
  });
});

describe("Decision 18 (spec D15, §5 A3, A4)", () => {
  it("says a ward is empty only from a fresh answer — and a ward nobody recorded reads 0 with the count of unrecorded", async () => {
    const quiet = answer({ isolated: [], suspected: [], bed_occupants: [], units: [],
      counts: { patients: 5, isolated: 0, isolation_unrecorded: 5, suspected: 0, suspected_unrecorded: 5, clock_missed: 0, sepsis_open: 0 } });
    await open({ setup: (api) => api.infection.mockResolvedValue(quiet) });
    expect(card("isolated")).toBe("0");
    expect(card("isolation_unrecorded")).toBe("5 xəstədə izolyasiya qeydi yoxdur");
    expect(screen.getByText("Əhatənizdə izolyasiyada qeydə alınmış xəstə yoxdur.")).toBeInTheDocument();
    expect(screen.getByText("Əhatənizdə şübhəli infeksiya işarələnmiş və ya sepsis siqnalı olan xəstə yoxdur.")).toBeInTheDocument();
  });

  it("holds a list that is no longer fresh under a crit alert: a 0 and every «none» turn into «—»", async () => {
    const { api } = await open({ setup: (a) => a.infection.mockResolvedValue(answer({ counts: { ...COUNTS, clock_missed: 0 } })) });
    api.infection.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor"));
    await pass(30_000);
    await pass(30_000);
    await pass(30_000);
    await pass(10_000);
    expect(alertBox().textContent).toMatch(/^İnfeksiya siyahısı aktual deyil · son cavab /);
    expect(card("isolated")).toBe("4");                                    // a number above 0 stays
    expect(card("clock_missed")).toBe("— siyahı aktual deyil");           // a 0 does not
    expect(card("free_beds")).toBe("— siyahı aktual deyil");
    expect(document.querySelector("[data-as-of-stale]").textContent).toMatch(/^son cavab .* vəziyyətinə görə$/);
    expect(document.querySelector("[data-as-of]")).toBeNull();
    expect(tally()).toBe("— siyahı aktual deyil");
    expect(tile("İzo 2").querySelector("[data-words]").textContent).toBe("— siyahı aktual deyil");
    expect(tile("İzo 8").querySelector("[data-words]").textContent).toBe("— siyahı aktual deyil");
    expect(tile("İzo 1").querySelector("[data-words]").textContent).toBe("son cavabda · izolyasiyalı xəstə");
    // Review M5: the board's facts on a tile are the last answer's too.
    expect(tile("İzo 10").querySelector("[data-words]").textContent).toBe("son cavabda · strukturda boş · paneldə xəstə var");
    expect(tile("İzo 3").querySelector("[data-words]").textContent).toBe("— siyahı aktual deyil");
    expect(cell(SUSPECTED, "S-103", "sepsis").textContent).toBe("son cavabda: Septik şok meyarları ödənilib");
    expect(cell(SUSPECTED, "S-102", "sepsis").textContent).toBe("— siyahı aktual deyil");
    expect(cell(SUSPECTED, "S-103", "antibiotic").textContent).toMatch(/^Son cavabda müddət keçmişdi · bitmə /);
  });

  it("draws no card, table, tile or name when the first read fails", async () => {
    await open({ setup: (api) => api.infection.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor")) });
    expect(alertBox().textContent).toMatch(/^İnfeksiya siyahısı oxunmadı: /);
    expect(document.querySelector("[data-counters]")).toBeNull();
    expect(screen.queryAllByRole("table")).toEqual([]);
    expect(tiles()).toEqual([]);
    expect(document.body.textContent).not.toContain("Sentetik");
    expect(screen.getByText(HONESTY)).toBeInTheDocument();
    expect(screen.getByText(ISOLATION_NOTE)).toBeInTheDocument();
  });

  it("leaves no name on the page once a read is refused", async () => {
    const { api } = await open();
    expect(document.body.textContent).toContain("Ayşe Sentetik");
    api.infection.mockRejectedValue(refusal(403, "permission required: infection.view"));
    await pass(30_000);
    expect(document.body.textContent).not.toContain("Sentetik");
    expect(screen.queryAllByRole("table")).toEqual([]);
  });

  it("takes an answer of another shape for a failed read", async () => {
    await open({ setup: (api) => api.infection.mockResolvedValue({ rows: [] }) });
    expect(alertBox().textContent).toBe("İnfeksiya siyahısı oxunmadı: serverin cavabı bu səhifənin oxuduğu formada deyil");
  });

  it("prints a bed state or an isolation type this build does not know as the server's own word, never «boşdur»", async () => {
    const odd = row("S-120", { bed_label: "1", isolation: iso("isolated", ["quarantine"]) });
    await open({ setup: (api) => {
      const ward = tree();
      ward.sites[0].units[0].rooms[1].beds[1].state = "NEW_STATE";
      api.structure.mockResolvedValue(ward);
      api.infection.mockResolvedValue(answer({ isolated: [odd] }));
    } });
    expect(tile("İzo 2").querySelector("[data-words]").textContent).toBe("Bu versiyanın tanımadığı vəziyyət: NEW_STATE");
    expect(cell("İzolyasiyadakı xəstələr: 1", "S-120", "isolation").textContent).toContain("quarantine");
  });
});

describe("the bed section's own source: the structure tree (§5 S1)", () => {
  it("says the tree cannot be read without a structure key, and the rest of the page stands", async () => {
    const { api } = await open({ perms: KEY_ONLY });
    expect(api.structure).not.toHaveBeenCalled();
    expect(tally()).toBe("— struktur oxuna bilmir");
    expect(document.querySelector("[data-beds]").textContent).toBe("— struktur oxuna bilmir");
    expect(card("free_beds")).toBe("— struktur oxuna bilmir");
    expect(cell(ISOLATED, "S-101", "room").textContent).toBe("— struktur oxuna bilmir");
    expect(card("isolated")).toBe("4");
    expect(rowIds(SUSPECTED)).toEqual(["S-103", "S-102", "S-101", "S-107"]);
  });

  it("says the tree could not be read, and why, when its read fails", async () => {
    await open({ setup: (api) => api.structure.mockRejectedValue(refusal(500, "boom")) });
    expect(tally()).toMatch(/^— struktur oxunmadı: /);
    expect(cell(ISOLATED, "S-101", "room").textContent).toMatch(/^— struktur oxunmadı: /);
    expect(card("isolated")).toBe("4");
  });

  it("reads the tree again with every tick, for a session that may read it", async () => {
    const { api } = await open();
    const before = api.structure.mock.calls.length;
    await pass(30_000);
    expect(api.infection).toHaveBeenCalledTimes(2);
    expect(api.structure.mock.calls.length).toBe(before + 1);
  });
});

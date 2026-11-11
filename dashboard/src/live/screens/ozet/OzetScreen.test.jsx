// OzetScreen.test.jsx — «Rəhbər xülasəsi» (G4-02, spec D5): one h1 and no patient anywhere; the four cards and the units
// table from their sources; the period switch driving the quality box and card 1, read on open and on a change, never
// with «Yenile»; a truncated read; a null answered_rate; «yetki yok»; Decision 18; the caller's reach; the daily bars
// in proportion; «Yeniden dene»; a failed, refused or malformed source of its own each with its reason. The default
// language is az. Synthetic hospital (ozet.testutil.jsx).
import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { ddmmhhmm } from "../../i18n/dates.js";
import { refusal } from "../../session/mount.testutil.jsx";
import { scopedTo } from "../../data/board.testutil.js";
import { scopeView } from "../admin/admin.testutil.js";
import { expectNoUuid } from "../kabul/kabul.testutil.js";
import { ADMIN, BOARD, PATIENT_ID, PATIENT_NAME, REA, REPORT, mountOzet, settle } from "./ozet.testutil.jsx";

afterEach(() => { cleanup(); });

/** A card, by its heading. */
const card = (name) => screen.getByRole("heading", { level: 3, name }).closest("li");
/** The units table's body rows, each as its cells' text. */
const unitRows = () => within(screen.getByRole("table", { name: "Şöbələr, indi" })).getAllByRole("row").slice(1)
  .map((row) => [...row.querySelectorAll("th, td")].map((c) => c.textContent));
const quality = () => document.querySelector("[data-quality]");

describe("the summary page", () => {
  it("has one h1, reads each source on open, and shows no patient's name, id or a UUID", async () => {
    const { api, board } = await mountOzet();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Rəhbər xülasəsi"]);
    expect(api.tasks).toHaveBeenCalledTimes(1);
    expect(api.pendingHandovers).toHaveBeenCalledTimes(1);
    expect(api.alarmQuality).toHaveBeenCalledTimes(1);
    expect(api.alarmQuality).toHaveBeenCalledWith(7);
    expect(document.querySelector("[data-as-of]").textContent).toMatch(/^\d\d:\d\d vəziyyətinə görə$/);
    expect(document.body.textContent).not.toContain(PATIENT_NAME);
    expect(document.body.textContent).not.toContain(PATIENT_ID);
    expectNoUuid();
    act(() => { board.clear(); });
  });

  it("counts the four «Unutulan işlər» from their sources", async () => {
    const { board } = await mountOzet();
    expect(card("Cavabsız qalan siqnal · son 7 gün").querySelector("[data-card-value]").textContent).toBe("2");
    expect(card("Cavabsız qalan siqnal · son 7 gün")).toHaveTextContent("10 dəqiqə sistemin hesabat həddidir");
    expect(card("Əks-imza gözləyən təhvil")).toHaveTextContent("2ən köhnəsi 2 gün əvvəl");
    expect(card("Gecikən iş").querySelector("[data-card-value]").textContent).toBe("2");
    expect(card("Səssiz monitor")).toHaveTextContent("1ən uzunu 7 dəq");
    expect(document.body.textContent).not.toContain("əhatənizdəkilər");    // an unrestricted caller's counts are the hospital's
    expect(card("Cavabsız qalan siqnal · son 7 gün")).not.toHaveTextContent("natamam oxunuş");
    act(() => { board.clear(); });
  });

  it("joins every source per unit, a closed unit said closed", async () => {
    const { board } = await mountOzet();
    expect(unitRows()).toEqual([
      ["Reanimasiya", "1 / 4 doludur", "2 (1 kritik · 1 yüksək)", "2", "2 · ən köhnəsi 2 gün əvvəl", "1"],
      ["Neonatal · bağlıdır", "0 / 0 doludur", "0", "0", "0", "0"],
    ]);
    act(() => { board.clear(); });
  });

  it("draws the quality box's figures, its days and its kinds — and none of the report's patients", async () => {
    const { board } = await mountOzet();
    const box = quality();
    expect(box).toHaveTextContent("Siqnal epizodu12");
    expect(box).toHaveTextContent("Cavablanan9 · nisbət 82%");
    expect(box).toHaveTextContent("Cavab müddəti (median)42 san");
    expect(box).toHaveTextContent("Cavab müddəti (p90)3 dəq 5 san");
    expect(within(box).getByText("09.11: 4 epizod")).toBeInTheDocument();
    expect(within(box).getByText("10.11: 8 epizod")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Növə görə" })).getByRole("rowheader")).toHaveTextContent("news2");
    expect(box.textContent).not.toMatch(/3 dəq içində|Səhv kimi/);   // the prototype's numbers with no source
    act(() => { board.clear(); });
  });

  it("draws each day's bar in proportion to its count, with no cap — a busier day is always longer", async () => {
    const { board } = await mountOzet({ setup: (api) => api.alarmQuality.mockResolvedValue({ ...REPORT, per_day: [
      { date: "2026-11-08", episodes: 4 }, { date: "2026-11-09", episodes: 8 }, { date: "2026-11-10", episodes: 5 }] }) });
    const bars = [...quality().querySelectorAll("[data-daily] [data-bar]")];
    expect(bars.map((bar) => parseFloat(bar.style.width))).toEqual([50, 100, 62.5]);
    for (const bar of bars) expect(bar.style.maxWidth).toBe("");
    act(() => { board.clear(); });
  });
});

// The rows are the tree's, and the tree is the whole hospital's for structure.manage; every other source is cut to
// the caller's reach by the server. So a unit outside her unit grants says «yetki yok», never 0 (Decision 18).
describe("a caller whose scope is restricted", () => {
  // Her /scope/me and her board's scope, built alike by the engine: one unit granted.
  const scopedBoard = (api) => {
    api.boardPatients.mockResolvedValue({ ...BOARD, scope: scopedTo([REA]) });
    api.myScope.mockResolvedValue(scopeView({ grants: [{ unit_id: REA }] }));
  };
  const NO_RIGHT = "— səlahiyyət yoxdur";

  it("sees «yetki yok» for a unit outside her reach — its beds still counted from the whole tree — and cards said to be hers", async () => {
    const { board } = await mountOzet({ setup: scopedBoard });
    expect(unitRows()).toEqual([
      ["Reanimasiya", "1 / 4 doludur", "2 (1 kritik · 1 yüksək)", "2", "2 · ən köhnəsi 2 gün əvvəl", "1"],
      ["Neonatal · bağlıdır", "0 / 0 doludur", NO_RIGHT, NO_RIGHT, NO_RIGHT, NO_RIGHT],
    ]);
    for (const name of ["Əks-imza gözləyən təhvil", "Gecikən iş", "Səssiz monitor"]) {
      expect(card(name), name).toHaveTextContent("yalnız əhatənizdəkilər, bütün xəstəxana deyil");
    }
    expect(card("Cavabsız qalan siqnal · son 7 gün")).not.toHaveTextContent("əhatənizdəkilər");   // the server's whole-hospital report
    act(() => { board.clear(); });
  });

  it("without structure.manage the tree lists only her granted beds there, so their count is not hers either", async () => {
    const { board } = await mountOzet({ perms: ADMIN.filter((key) => key !== "structure.manage"), setup: scopedBoard });
    expect(unitRows()[1]).toEqual(["Neonatal · bağlıdır", NO_RIGHT, NO_RIGHT, NO_RIGHT, NO_RIGHT, NO_RIGHT]);
    act(() => { board.clear(); });
  });
});

// The reach is the caller's own /scope/me, read with the page's reads — not the live board's scope, which only the
// alarm column (its own source) depends on.
describe("the reach, from /scope/me", () => {
  const CAVEATS = /əhatənizdəkilər|əhatəniz oxunmadı/;

  it("without board.view, tasks and handovers are real numbers: only the alarm column says «yetki yok»", async () => {
    const { board } = await mountOzet({ perms: ADMIN.filter((key) => key !== "board.view") });
    expect(unitRows()).toEqual([
      ["Reanimasiya", "1 / 4 doludur", "— səlahiyyət yoxdur", "2", "2 · ən köhnəsi 2 gün əvvəl", "1"],
      ["Neonatal · bağlıdır", "0 / 0 doludur", "— səlahiyyət yoxdur", "0", "0", "0"],
    ]);
    expect(card("Gecikən iş").querySelector("[data-card-value]").textContent).toBe("2");
    expect(card("Əks-imza gözləyən təhvil").querySelector("[data-card-value]").textContent).toBe("2");
    expect(document.body.textContent).not.toMatch(CAVEATS);
    act(() => { board.clear(); });
  });

  it("the live board unavailable for an unrestricted administrator: only the alarm column says why", async () => {
    const { board } = await mountOzet({ setup: (api) => api.boardPatients.mockRejectedValue(refusal(503, "down")) });
    expect(unitRows()).toEqual([
      ["Reanimasiya", "1 / 4 doludur", "— oxunmadı", "2", "2 · ən köhnəsi 2 gün əvvəl", "1"],
      ["Neonatal · bağlıdır", "0 / 0 doludur", "— oxunmadı", "0", "0", "0"],
    ]);
    expect(card("Gecikən iş").querySelector("[data-card-value]").textContent).toBe("2");
    expect(card("Əks-imza gözləyən təhvil").querySelector("[data-card-value]").textContent).toBe("2");
    expect(document.body.textContent).not.toMatch(CAVEATS);
    act(() => { board.clear(); });
  });

  it("before /scope/me answers: no caveat on the cards, and the cells it decides say «okunur…»", async () => {
    const { board } = await mountOzet({ perms: ADMIN.filter((key) => key !== "structure.manage"),
      setup: (api) => api.myScope.mockReturnValue(new Promise(() => {})) });
    expect(document.body.textContent).not.toMatch(CAVEATS);
    expect(unitRows()[0]).toEqual(["Reanimasiya", "— oxunur…", "2 (1 kritik · 1 yüksək)", "— oxunur…", "— oxunur…", "— oxunur…"]);
    expect(card("Gecikən iş").querySelector("[data-card-value]").textContent).toBe("2");
    expect(document.querySelector("[data-as-of]")).toHaveTextContent("Hələ tam oxunuş yoxdur");
    act(() => { board.clear(); });
  });

  it("when /scope/me fails: its own reason in those cells, and a neutral caveat on cards 2–4", async () => {
    const { board } = await mountOzet({ setup: (api) => api.myScope.mockRejectedValue(refusal(503, "down")) });
    expect(unitRows()[0]).toEqual(["Reanimasiya", "1 / 4 doludur", "2 (1 kritik · 1 yüksək)", "— oxunmadı", "— oxunmadı", "— oxunmadı"]);
    for (const name of ["Əks-imza gözləyən təhvil", "Gecikən iş", "Səssiz monitor"]) {
      expect(card(name), name).toHaveTextContent("əhatəniz oxunmadı: bütün xəstəxana olmaya bilər");
    }
    expect(card("Cavabsız qalan siqnal · son 7 gün")).not.toHaveTextContent("əhatəniz");
    act(() => { board.clear(); });
  });
});

describe("the period switch", () => {
  it("drives the quality box and card 1, and reads the report again only then", async () => {
    const { api, board } = await mountOzet();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "30 gün" })); });
    await settle();
    expect(api.alarmQuality).toHaveBeenLastCalledWith(30);
    expect(screen.getByRole("button", { name: "30 gün" })).toHaveAttribute("aria-pressed", "true");
    expect(card("Cavabsız qalan siqnal · son 30 gün")).toBeInTheDocument();
    expect(quality()).toHaveTextContent("son 30 gün");
    act(() => { board.clear(); });
  });

  it("«Yenile» reads the tree, the tasks and the handovers again — not the alarm quality", async () => {
    const { api, board } = await mountOzet();
    const structureReads = api.structure.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); });
    await settle();
    expect(api.tasks).toHaveBeenCalledTimes(2);
    expect(api.pendingHandovers).toHaveBeenCalledTimes(2);
    expect(api.structure.mock.calls.length).toBe(structureReads + 1);
    expect(api.alarmQuality).toHaveBeenCalledTimes(1);
    act(() => { board.clear(); });
  });
});

describe("the quality box says what it read", () => {
  it("says a truncated read is one, and from when it counts", async () => {
    const from = "2026-11-08T06:00:00+00:00";
    const { board } = await mountOzet({ setup: (api) => api.alarmQuality.mockResolvedValue({ ...REPORT, truncated: true, window_from: from }) });
    expect(quality()).toHaveTextContent(
      `Serverin oxuma həddi aşıldı: yalnız ən yeni qeydlər oxundu; sayılan dövr ${ddmmhhmm(Date.parse(from))} ilə başlayır`);
    // …and card 1, which counts from the same read, does not pass its count off as complete.
    expect(card("Cavabsız qalan siqnal · son 7 gün")).toHaveTextContent("natamam oxunuş: yalnız ən yeni qeydlər sayıldı");
    act(() => { board.clear(); });
  });

  it("says nothing has settled rather than a rate of 0 %", async () => {
    const { board } = await mountOzet({ setup: (api) => api.alarmQuality.mockResolvedValue({
      ...REPORT, episodes: 2, answered: 0, unanswered: 0, pending: 2, answered_rate: null, median_response_sec: null,
      p90_response_sec: null, per_day: [{ date: "2026-11-10", episodes: 2 }], per_kind: [] }) });
    expect(quality()).toHaveTextContent("Cavablanan0 · hələ yekunlaşan yoxdur");
    expect(quality()).toHaveTextContent("Cavab müddəti (median)cavablanan yoxdur");
    expect(quality().textContent).not.toMatch(/0%/);
    act(() => { board.clear(); });
  });

  it("says a scoped refusal is no right, and a failure is a failure", async () => {
    let mounted = await mountOzet({ setup: (api) => api.alarmQuality.mockRejectedValue(refusal(403, "alarm kalitesi raporunun tamamı kapsam dışı")) });
    expect(quality()).toHaveTextContent("audit.view");
    expect(card("Cavabsız qalan siqnal · son 7 gün")).toHaveTextContent("— səlahiyyət yoxdur");
    // No period switch: another period would only be refused again.
    expect(screen.queryByRole("button", { name: "30 gün" })).toBeNull();
    act(() => { mounted.board.clear(); });
    cleanup();
    mounted = await mountOzet({ setup: (api) => api.alarmQuality.mockRejectedValue(refusal(503, "down")) });
    expect(within(quality()).getByRole("alert")).toHaveTextContent("Siqnal keyfiyyəti oxunmadı");
    expect(card("Cavabsız qalan siqnal · son 7 gün")).toHaveTextContent("— oxunmadı");
    expect(screen.getByRole("button", { name: "30 gün" })).toBeInTheDocument();
    act(() => { mounted.board.clear(); });
  });

  it("reads the report again on «Yeniden dene» after a failure — a user's action, not a timer", async () => {
    const { api, board } = await mountOzet({ setup: (a) => a.alarmQuality.mockRejectedValueOnce(refusal(503, "down")) });
    expect(api.alarmQuality).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(within(quality()).getByRole("button", { name: "Yenidən cəhd et" })); });
    await settle();
    expect(api.alarmQuality).toHaveBeenCalledTimes(2);
    expect(api.alarmQuality).toHaveBeenLastCalledWith(7);
    expect(quality()).toHaveTextContent("Siqnal epizodu12");
    expect(card("Cavabsız qalan siqnal · son 7 gün").querySelector("[data-card-value]").textContent).toBe("2");
    act(() => { board.clear(); });
  });

  it("says an answer that is not a report could not be read — once, with no reason it does not have", async () => {
    const { board } = await mountOzet({ setup: (api) => api.alarmQuality.mockResolvedValue({ episodes: "12" }) });
    const alert = within(quality()).getByRole("alert");
    expect(alert).toHaveTextContent("Siqnal keyfiyyəti oxunmadı.");
    expect(alert.textContent).not.toMatch(/oxunmadı: /);
    act(() => { board.clear(); });
  });
});

describe("the page's own sources, each with its reason", () => {
  it("a failed, refused or malformed /handovers/pending read: «—» and why on its card and its column", async () => {
    const cases = [
      [(api) => api.pendingHandovers.mockRejectedValue(refusal(503, "down")), "— oxunmadı"],
      [(api) => api.pendingHandovers.mockRejectedValue(refusal(403, "no")), "— səlahiyyət yoxdur"],
      [(api) => api.pendingHandovers.mockResolvedValue({ generated_at: "2026-11-11T10:00:00+00:00",
        units: [{ unit_id: REA, unit_name: "Reanimasiya", pending: "2", oldest_outgoing_signed_at: null }] }), "— oxunmadı"],
    ];
    for (const [setup, said] of cases) {
      const { board } = await mountOzet({ setup });
      expect(card("Əks-imza gözləyən təhvil")).toHaveTextContent(said);
      expect(unitRows().map((row) => row[4])).toEqual([said, said]);
      act(() => { board.clear(); });
      cleanup();
    }
  });

  it("a monitor strip that stops answering: the strip's own reason, not the live board's", async () => {
    const { api, board, shadow } = await mountOzet();
    expect(card("Səssiz monitor").querySelector("[data-card-value]").textContent).toBe("1");
    api.shadowBoard.mockRejectedValue(refusal(503, "down"));
    // The page is the strip's one consumer: let it go and take it again, which polls at once — and fails.
    await act(async () => { shadow.release(); shadow.acquire(); await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(card("Səssiz monitor")).toHaveTextContent("— monitor məlumatı yenilənməyib");
    expect(unitRows().map((row) => row[5])).toEqual(["— monitor məlumatı yenilənməyib", "— monitor məlumatı yenilənməyib"]);
    expect(document.body.textContent).not.toContain("lövhə yenilənməyib");
    act(() => { board.clear(); });
  });

  it("while the tree is still being read the table says so plainly; a refused tree is no right", async () => {
    let mounted = await mountOzet({ setup: (api) => api.structure.mockReturnValue(new Promise(() => {})) });
    expect(document.querySelector("[data-units]")).toHaveTextContent("Şöbələr oxunur…");
    expect(document.querySelector("[data-units]")).not.toHaveTextContent("yazıla bilmir");
    act(() => { mounted.board.clear(); });
    cleanup();
    mounted = await mountOzet({ setup: (api) => api.structure.mockRejectedValue(refusal(403, "no")) });
    expect(document.querySelector("[data-units]")).toHaveTextContent("Şöbə sətirləri yazıla bilmir · səlahiyyət yoxdur");
    act(() => { mounted.board.clear(); });
  });
});

describe("«yetki yok»: the key without a source's own right", () => {
  it("says so on each card and column the session may not read, and reads none of them", async () => {
    const { api, board } = await mountOzet({ perms: ["summary.view"] });
    expect(card("Cavabsız qalan siqnal · son 7 gün")).toHaveTextContent("— səlahiyyət yoxdur");
    expect(card("Gecikən iş")).toHaveTextContent("— səlahiyyət yoxdur");
    expect(card("Səssiz monitor")).toHaveTextContent("— səlahiyyət yoxdur");
    expect(card("Əks-imza gözləyən təhvil").querySelector("[data-card-value]").textContent).toBe("2");
    expect(document.querySelector("[data-units]")).toHaveTextContent("Şöbə sətirləri yazıla bilmir · səlahiyyət yoxdur");
    expect(quality()).toHaveTextContent("audit.view");
    for (const read of [api.structure, api.tasks, api.alarmQuality, api.shadowBoard]) expect(read).not.toHaveBeenCalled();
    act(() => { board.clear(); });
  });
});

describe("Decision 18: a zero only from a fresh answer", () => {
  it("never counts a board that is not LIVE: connecting, then dropped", async () => {
    const { board, stream } = await mountOzet({ live: false });
    expect(unitRows()[0][2]).toBe("— oxunur…");
    expect(unitRows()[1][2]).toBe("— oxunur…");
    await act(async () => { stream.open(); await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(unitRows()[1][2]).toBe("0");
    act(() => { stream.drop(); });
    expect(unitRows()[0][2]).toBe("— lövhə yenilənməyib");
    expect(unitRows()[1][2]).toBe("— lövhə yenilənməyib");
    act(() => { board.clear(); });
  });

  it("drops a source's last number when its read fails: «—» and why, never the old count or a 0", async () => {
    const { api, board } = await mountOzet();
    api.tasks.mockRejectedValue(refusal(503, "down"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); });
    await settle();
    expect(card("Gecikən iş")).toHaveTextContent("— oxunmadı");
    expect(unitRows().map((row) => row[3])).toEqual(["— oxunmadı", "— oxunmadı"]);
    act(() => { board.clear(); });
  });
});

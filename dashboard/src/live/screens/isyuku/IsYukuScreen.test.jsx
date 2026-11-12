// IsYukuScreen.test.jsx — «İş yükü» (G4-04, spec D6 and §5): one h1, the shift and no patient anywhere; the units table
// from its sources, «Bu nöbet için atama yok»; the nurse cards (alphabetical, beds, patients, «Kalan iş») and the
// unassigned beds; a unit chosen; Decision 18 (a board not LIVE, a refused assignment, an ended shift, a failed queue);
// «Nöbet ataması» for `shifts.manage` — one picker per open bed, a save with the window's key and `expected`, the soft
// warning by name, a 409 read again, the next shift, a refusal keeping the choices — and none for a viewer. The
// default language is az. A fixed clock; synthetic ward (isyuku.testutil.js).
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { hhmm } from "../../i18n/dates.js";
import { PREF_PREFIX } from "../../prefs.js";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { StructureProvider } from "../../data/StructureProvider.jsx";
import { PERMISSION_KEYS } from "../admin/catalogue.js";
import { SCOPE_ADMIN } from "../admin/admin.testutil.js";
import { expectNoUuid } from "../kabul/kabul.testutil.js";
import { IsYukuScreen } from "./IsYukuScreen.jsx";
import { PAST_THE_END_MS } from "./useShiftEnd.js";
import {
  BED, BOARD, NEXT, NOW_MS, NURSE, NURSES, PATIENT_NAME, REA, SHIFT, boardScopedTo, schedule, tasks, tree, unitSchedule,
} from "./isyuku.testutil.js";

const ADMIN = [...PERMISSION_KEYS];
const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });

/** Mount the page for a session holding `perms`, the board LIVE unless `live` is false (its stream never opens). */
async function mountIsYuku({ perms = ADMIN, setup, live = true } = {}) {
  const mounted = await mount(<StructureProvider><IsYukuScreen /></StructureProvider>, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      api.structure.mockResolvedValue(tree());
      api.boardPatients.mockResolvedValue(BOARD);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.tasks.mockResolvedValue(tasks());
      api.myScope.mockResolvedValue(SCOPE_ADMIN);
      api.shiftSchedule.mockImplementation((shift = "current", unitId = null) =>
        Promise.resolve(unitId ? unitSchedule(shift, unitId) : schedule()));
      api.shiftNurses.mockResolvedValue([...NURSES]);
      setup?.(api);
    },
  });
  await settle();
  await act(async () => { await mounted.board.start(); });
  if (live) await act(async () => { mounted.stream.open(); await new Promise((resolve) => { setTimeout(resolve, 0); }); });
  await settle();
  return mounted;
}

beforeEach(() => { vi.setSystemTime(NOW_MS); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** The units table's body rows, each as its cells' text. */
const unitRows = () => within(screen.getByRole("table", { name: "Şöbələrə görə iş yükü, bu növbə" })).getAllByRole("row")
  .slice(1).map((row) => [...row.querySelectorAll("th, td")].map((c) => c.textContent));
const nursesBox = () => document.querySelector("[data-nurses]");
const cardNames = () => [...nursesBox().querySelectorAll("[data-nurse] h3")].map((h) => h.textContent);
const formBox = () => document.querySelector("[data-form]");
const pick = async (name) => {
  const select = screen.getByLabelText("Şöbə");
  const option = [...select.options].find((o) => o.textContent === name);
  await act(async () => { fireEvent.change(select, { target: { value: option.value } }); });
  await settle();
};
const bedLabels = () => [...formBox().querySelectorAll("label")].map((label) => label.textContent);
const save = async () => {
  await act(async () => { fireEvent.click(within(formBox()).getByRole("button", { name: "Yadda saxla" })); });
  await settle();
};

describe("the workload page", () => {
  it("has one h1, reads its sources on open — /tasks over the shift's week — says the shift, and shows no patient", async () => {
    const { api, board } = await mountIsYuku();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["İş yükü"]);
    expect(api.shiftSchedule).toHaveBeenCalledWith("current");
    expect(api.tasks).toHaveBeenCalledWith("2026-11-05T20:00:00.000Z", "2026-11-12T20:00:00Z");
    expect(api.myScope).toHaveBeenCalledTimes(1);
    expect(api.pendingHandovers).not.toHaveBeenCalled();
    expect(document.querySelector("[data-shift]").textContent)
      .toBe(`Bu növbə · ${hhmm(Date.parse(SHIFT.start))}–${hhmm(Date.parse(SHIFT.end))}`);
    expect(document.querySelector("[data-as-of]").textContent).toMatch(/^\d\d:\d\d vəziyyətinə görə$/);
    expect(screen.getByText("Sayma, bal deyil · şəxslər sıralanmır")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(PATIENT_NAME);
    expect(document.body.textContent).not.toMatch(/S-1\d\d/);
    expectNoUuid();
    act(() => { board.clear(); });
  });

  it("counts each open unit for this shift, and says a listed unit has no assignment", async () => {
    const { board } = await mountIsYuku();
    expect(unitRows()).toEqual([
      ["Reanimasiya", "4", "2", "3 xəstə / 2 tibb bacısı · orta 1,5", "1", "2", "2", "2"],
      ["Neonatal", "1", "Bu növbə üçün təyinat yoxdur", "— təyin olunmuş tibb bacısı yoxdur", "1", "0", "1", "0"],
    ]);
    // Review 8: the ratio's «—» says why, as every other «—» does.
    const neonatal = within(screen.getByRole("table", { name: "Şöbələrə görə iş yükü, bu növbə" })).getAllByRole("row")[2];
    expect(neonatal.querySelectorAll("td")[2].querySelector("[data-missing]")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Növbə saatları dəyişdi");
    act(() => { board.clear(); });
  });

  it("draws one card per nurse, alphabetical: beds, patients and «Qalan iş» only; then the unassigned beds; a unit chosen narrows both", async () => {
    const { board } = await mountIsYuku();
    expect(nursesBox()).toHaveTextContent("Əlifba sırası ilə; reytinq deyil");
    expect(cardNames()).toEqual(["Aysel Sentetik", "Leyla Sentetik"]);
    const leyla = nursesBox().querySelectorAll("[data-nurse]")[1];
    expect(leyla).toHaveTextContent("Çarpayılar: 1 · Otaq 1 · Reanimasiya, 2 · Otaq 1 · Reanimasiya");
    expect(leyla).toHaveTextContent("Xəstə: 2");
    expect(leyla).toHaveTextContent("Qalan iş: 2");
    expect(nursesBox().textContent).not.toMatch(/Gecikən|siqnal/);
    expect(nursesBox().querySelector("[data-unassigned]")).toHaveTextContent("3 · Otaq 1 · Reanimasiya, N1 · N-1 · Neonatal");
    await pick("Neonatal");
    expect(screen.getByRole("heading", { level: 2, name: "Tibb bacıları · Neonatal" })).toBeInTheDocument();
    expect(cardNames()).toEqual([]);
    expect(nursesBox()).toHaveTextContent("Bu seçimdə bu növbə üçün təyinat yoxdur.");
    expect(nursesBox().querySelector("[data-unassigned]")).toHaveTextContent("N1 · N-1 · Neonatal");
    act(() => { board.clear(); });
  });

  // Review 2: no unit listed is no answer about the cards or the beds; «Bütün şöbələr» with some unlisted says so.
  it("says «səlahiyyət yoxdur» for the cards when the answer lists no unit, never «yoxdur»", async () => {
    const { board } = await mountIsYuku({ setup: (api) => api.shiftSchedule.mockResolvedValue(schedule({ units: [] })) });
    expect(nursesBox()).toHaveTextContent("Tibb bacısı kartları yazıla bilmir · səlahiyyət yoxdur");
    expect(nursesBox().textContent).not.toMatch(/Təyinatsız xəstə yoxdur|təyinat yoxdur\./);
    expect(nursesBox().querySelector("[data-unassigned]")).toBeNull();
    act(() => { board.clear(); });
  });

  // Re-review 3: no open unit in the tree: the nurse box says what the table says.
  it("says «Açıq şöbə yoxdur.» in the nurse box too when the tree has no open unit", async () => {
    const closed = tree();
    closed.sites[0].units = closed.sites[0].units.filter((unit) => unit.is_active === false);
    const { board } = await mountIsYuku({ setup: (api) => api.structure.mockResolvedValue(closed) });
    expect(document.querySelector("[data-units]")).toHaveTextContent("Açıq şöbə yoxdur.");
    expect(nursesBox()).toHaveTextContent("Açıq şöbə yoxdur.");
    expect(nursesBox().textContent).not.toMatch(/yazıla bilmir|səlahiyyət yoxdur/);
    act(() => { board.clear(); });
  });

  it("says the cards leave out the units she cannot see, under «Bütün şöbələr» only", async () => {
    const onlyRea = schedule({ units: [schedule().units[1]] });
    const { board } = await mountIsYuku({ setup: (api) => api.shiftSchedule.mockImplementation((shift = "current", unitId = null) =>
      Promise.resolve(unitId ? unitSchedule(shift, unitId) : onlyRea)) });
    expect(nursesBox()).toHaveTextContent("Görünməyən şöbələr daxil deyil");
    await pick("Reanimasiya");
    expect(nursesBox().textContent).not.toContain("Görünməyən şöbələr daxil deyil");
    act(() => { board.clear(); });
  });

  it("says when the shift hours changed meanwhile", async () => {
    const changed = schedule();
    changed.units[1].other_rows = 2;
    const { board } = await mountIsYuku({ setup: (api) => api.shiftSchedule.mockResolvedValue(changed) });
    expect(screen.getByText("Növbə saatları dəyişdi; bu növbənin təyinatı yenidən edilməlidir.")).toBeInTheDocument();
    act(() => { board.clear(); });
  });
});

describe("Decision 18: a zero only from a fresh answer", () => {
  it("never counts a board that is not LIVE: connecting, then dropped — a card's «Qalan iş» too", async () => {
    const { board, stream } = await mountIsYuku({ live: false });
    expect(unitRows().map((row) => row[7])).toEqual(["— oxunur…", "— oxunur…"]);
    await act(async () => { stream.open(); await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(unitRows().map((row) => row[7])).toEqual(["2", "0"]);
    act(() => { stream.drop(); });
    expect(unitRows().map((row) => row[7])).toEqual(["— lövhə yenilənməyib", "— lövhə yenilənməyib"]);
    expect(nursesBox().querySelectorAll("[data-nurse]")[1]).toHaveTextContent("Qalan iş: — lövhə yenilənməyib");
    act(() => { board.clear(); });
  });

  it("keeps the board's own scope for the alarm column: a unit it does not reach yet says «səlahiyyət yoxdur» (review 3)", async () => {
    const { board } = await mountIsYuku({ setup: (api) => api.boardPatients.mockResolvedValue(boardScopedTo([REA])) });
    expect(unitRows().map((row) => row[7])).toEqual(["2", "— səlahiyyət yoxdur"]);
    expect(unitRows()[1][6]).toBe("1");                                   // «Qalan iş»: /tasks, her own reach
    act(() => { board.clear(); });
  });

  it("a refused assignment: the shift, the nurse columns, the task columns and the cards say why — the rest is counted", async () => {
    const { board } = await mountIsYuku({ setup: (api) => api.shiftSchedule.mockRejectedValue(refusal(403, "no")) });
    expect(document.querySelector("[data-shift]").textContent).toBe("Bu növbə — səlahiyyət yoxdur");
    expect(unitRows()[0]).toEqual(["Reanimasiya", "4", "— səlahiyyət yoxdur", "— səlahiyyət yoxdur",
      "— səlahiyyət yoxdur", "— səlahiyyət yoxdur", "— səlahiyyət yoxdur", "2"]);
    expect(nursesBox()).toHaveTextContent("Tibb bacısı kartları yazıla bilmir · səlahiyyət yoxdur");
    act(() => { board.clear(); });
  });

  it("an answer whose shift has ended: «növbə dəyişdi, yenilənir» until the next read", async () => {
    vi.setSystemTime(Date.parse("2026-11-12T20:00:30Z"));
    const { board } = await mountIsYuku();
    expect(document.querySelector("[data-shift]").textContent).toBe("Bu növbə — növbə dəyişdi, yenilənir");
    expect(unitRows()[0].slice(2, 7)).toEqual(Array(5).fill("— növbə dəyişdi, yenilənir"));
    act(() => { board.clear(); });
  });

  // Review 7: the shift's end is judged on the server's clock (the board's skew), and the page reads again once it is
  // over (one timer, useShiftEnd.test.js times it).
  it("judges the shift's end on the server's clock, and reads again just past it", async () => {
    vi.useRealTimers();                                                   // drop beforeEach's date mock, then fake the clock
    vi.useFakeTimers({ shouldAdvanceTime: true });                        // real time still moves the mount along
    vi.setSystemTime(NOW_MS);
    const skew = 10 * 60 * 60_000 + 30_000;                               // the server says 20:00:30; this browser 10:00
    const { api, board } = await mountIsYuku({ setup: (a) => a.serverClockSkewMs.mockReturnValue(skew) });
    expect(document.querySelector("[data-shift]").textContent).toBe("Bu növbə — növbə dəyişdi, yenilənir");
    const reads = () => api.shiftSchedule.mock.calls.filter((call) => call.length === 1).length;
    const before = reads();
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_THE_END_MS); });
    await settle();
    expect(reads()).toBeGreaterThan(before);
    act(() => { board.clear(); });
  });

  // Re-review 1: the server's clock is the API client's, renewed with every answer — not the board's, measured once
  // when it loaded (and never for a session without board.view).
  it("takes the server's clock from the API client's latest answer, not from the board's load", async () => {
    const { api, board } = await mountIsYuku();                           // no skew known when the board loaded
    expect(document.querySelector("[data-shift]").textContent).toMatch(/^Bu növbə · /);
    api.serverClockSkewMs.mockReturnValue(10 * 60 * 60_000 + 30_000);     // a later answer: the server says 20:00:30
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); });
    await settle();
    expect(document.querySelector("[data-shift]").textContent).toBe("Bu növbə — növbə dəyişdi, yenilənir");
    act(() => { board.clear(); });
  });

  it("a failed task queue, or one without the tasks' due times: late and remaining work say «oxunmadı»", async () => {
    let mounted = await mountIsYuku({ setup: (api) => api.tasks.mockRejectedValue(refusal(503, "down")) });
    expect(unitRows().map((row) => [row[5], row[6]])).toEqual([["— oxunmadı", "— oxunmadı"], ["— oxunmadı", "— oxunmadı"]]);
    expect(unitRows()[0][2]).toBe("2");                                   // the assignment is still counted
    expect(document.querySelector("[data-as-of]").textContent).toBe("Hələ tam oxunuş yoxdur");   // review 4: not whole
    act(() => { mounted.board.clear(); });
    cleanup();
    const short = { ...tasks(), patients: [{ patient_id: "S-101", bed_key: null, unit_id: REA, vital: null,
      tasks: [{ id: "t1", late: false }] }] };
    mounted = await mountIsYuku({ setup: (api) => api.tasks.mockResolvedValue(short) });
    expect(unitRows()[0][6]).toBe("— oxunmadı");
    act(() => { mounted.board.clear(); });
  });
});

describe("«Nöbet ataması»", () => {
  it("asks for a unit first, then offers one picker per open bed with the rows held chosen and the people marked", async () => {
    const { api, board } = await mountIsYuku();
    expect(formBox()).toHaveTextContent("Təyinat üçün yuxarıdan bir şöbə seçin.");
    expect(api.shiftNurses).not.toHaveBeenCalled();
    await pick("Reanimasiya");
    expect(screen.getByRole("heading", { level: 2, name: "Növbə təyinatı · Reanimasiya" })).toBeInTheDocument();
    expect(api.shiftSchedule).toHaveBeenLastCalledWith("current", REA);
    expect(api.shiftNurses).toHaveBeenCalledWith(REA);
    expect(bedLabels()).toEqual(["1 · Otaq 1 · Reanimasiya", "2 · Otaq 1 · Reanimasiya", "3 · Otaq 1 · Reanimasiya",
      "4 · Otaq 1 · Reanimasiya", "5 · Otaq 2 · Reanimasiya"]);
    const form = within(formBox());
    expect(form.getByLabelText("1 · Otaq 1 · Reanimasiya")).toHaveValue(NURSE.leyla);
    expect(form.getByLabelText("5 · Otaq 2 · Reanimasiya")).toHaveValue(NURSE.aysel);
    expect(form.getByLabelText("3 · Otaq 1 · Reanimasiya")).toHaveValue("");
    expect([...form.getByLabelText("3 · Otaq 1 · Reanimasiya").options].map((o) => o.textContent))
      .toEqual(["— təyin olunmayıb —", "Aysel Sentetik", "Leyla Sentetik", "Nigar Sentetik — bu şöbəni görə bilməz"]);
    expectNoUuid();
    act(() => { board.clear(); });
  });

  it("saves the window by its key with every row read as `expected`, and names the soft warning", async () => {
    const saved = { ...unitSchedule("current", REA), warnings: [{ code: "unit_not_reached", nurse_id: NURSE.nigar }] };
    const { api, board } = await mountIsYuku({ setup: (a) => a.saveShiftSchedule.mockResolvedValue(saved) });
    await pick("Reanimasiya");
    fireEvent.change(within(formBox()).getByLabelText("3 · Otaq 1 · Reanimasiya"), { target: { value: NURSE.nigar } });
    await save();
    expect(api.saveShiftSchedule).toHaveBeenCalledWith({
      unit_id: REA, shift_start: SHIFT.start,
      items: [{ bed_id: BED(1), nurse_id: NURSE.leyla }, { bed_id: BED(2), nurse_id: NURSE.leyla },
        { bed_id: BED(3), nurse_id: NURSE.nigar }, { bed_id: BED(5), nurse_id: NURSE.aysel }],
      expected: [{ bed_id: BED(1), nurse_id: NURSE.leyla }, { bed_id: BED(2), nurse_id: NURSE.leyla },
        { bed_id: BED(5), nurse_id: NURSE.aysel }, { bed_id: BED(6), nurse_id: NURSE.zaur }],
    });
    expect(formBox()).toHaveTextContent("Təyinat yadda saxlanıldı.");
    expect(formBox()).toHaveTextContent("Nigar Sentetik bu şöbəni görə bilməz: öz lövhəsində bu çarpayıların xəstələri görünməyəcək (xəbərdarlıq, qadağa deyil).");
    act(() => { board.clear(); });
  });

  it("a save on an old read, or across the shift change, says so and reads the form and the page again", async () => {
    for (const [error, words] of [
      [refusal(409, "Kayıt aynı anda değiştirildi; lütfen tekrar deneyin"), "Bu arada başqası dəyişdi — siyahı yeniləndi; yenidən baxın."],
      [refusal(409, "That shift is no longer the current or the next one.", { apiCode: "shift_changed" }),
        "Növbə bu arada dəyişdi — siyahı yeniləndi; yeni növbəyə yenidən baxın."],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const { api, board } = await mountIsYuku({ setup: (a) => a.saveShiftSchedule.mockRejectedValue(error) });
      await pick("Reanimasiya");                                          // eslint-disable-line no-await-in-loop
      const before = api.shiftSchedule.mock.calls.length;
      await save();                                                       // eslint-disable-line no-await-in-loop
      expect(formBox()).toHaveTextContent(words);
      const after = api.shiftSchedule.mock.calls.slice(before).map((call) => call.join(","));
      expect(after).toEqual(expect.arrayContaining(["current", `current,${REA}`]));
      act(() => { board.clear(); });
      cleanup();
    }
  });

  // Review 1 (§5 A7): the form and the picks she made survive a poll that fails and a shift that ends meanwhile.
  it("keeps the form and its picks when the page's next read fails, and when the shift ends", async () => {
    const { api, board } = await mountIsYuku();
    await pick("Reanimasiya");
    const three = () => within(formBox()).getByLabelText("3 · Otaq 1 · Reanimasiya");
    fireEvent.change(three(), { target: { value: NURSE.nigar } });
    api.shiftSchedule.mockImplementation((shift = "current", unitId = null) =>
      (unitId ? Promise.resolve(unitSchedule(shift, unitId)) : Promise.reject(refusal(503, "down"))));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); });
    await settle();
    expect(document.querySelector("[data-shift]").textContent).toBe("Bu növbə — oxunmadı");
    expect(screen.getByRole("heading", { level: 2, name: "Növbə təyinatı · Reanimasiya" })).toBeInTheDocument();
    expect(three()).toHaveValue(NURSE.nigar);
    expect(screen.getByLabelText("Şöbə")).toHaveValue(REA.toLowerCase());

    api.shiftSchedule.mockImplementation((shift = "current", unitId = null) =>
      Promise.resolve(unitId ? unitSchedule(shift, unitId) : schedule()));
    vi.setSystemTime(Date.parse("2026-11-12T20:00:30Z"));                 // the answer's shift has ended
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); });
    await settle();
    expect(document.querySelector("[data-shift]").textContent).toBe("Bu növbə — növbə dəyişdi, yenilənir");
    expect(three()).toHaveValue(NURSE.nigar);
    act(() => { board.clear(); });
  });

  // Review 5: nothing she could change moves while a save is on its way — the window, the pickers, the unit.
  it("locks the window, the pickers and the unit while a save is on its way", async () => {
    let finish;
    const { board } = await mountIsYuku({ setup: (a) => a.saveShiftSchedule.mockImplementation(() =>
      new Promise((resolve) => { finish = resolve; })) });
    await pick("Reanimasiya");
    const controls = () => [screen.getByRole("button", { name: "Bu növbə" }), screen.getByRole("button", { name: "Növbəti növbə" }),
      ...formBox().querySelectorAll("select"), screen.getByLabelText("Şöbə")];
    expect(controls().every((control) => !control.disabled)).toBe(true);
    await act(async () => { fireEvent.click(within(formBox()).getByRole("button", { name: "Yadda saxla" })); });
    expect(controls().map((control) => control.disabled)).toEqual(Array(controls().length).fill(true));
    await act(async () => { finish({ ...unitSchedule("current", REA), warnings: [] }); });
    await settle();
    expect(controls().every((control) => !control.disabled)).toBe(true);
    act(() => { board.clear(); });
  });

  // Re-review 2: the unit stays locked through the form's read after the save, so the box — and «yadda saxlanıldı» —
  // are not unmounted by another unit in that moment.
  it("keeps the unit locked until the form is read again after a save", async () => {
    const { api, board } = await mountIsYuku({ setup: (a) => a.saveShiftSchedule.mockResolvedValue(
      { ...unitSchedule("current", REA), warnings: [] }) });
    await pick("Reanimasiya");
    let land = null;
    api.shiftSchedule.mockImplementation((shift = "current", unitId = null) => (unitId
      ? new Promise((resolve) => { land = () => resolve(unitSchedule(shift, unitId)); }) : Promise.resolve(schedule())));
    await save();
    expect(land).not.toBeNull();                                          // the form is being read again
    expect(screen.getByLabelText("Şöbə")).toBeDisabled();
    await act(async () => { land(); });
    await settle();
    expect(screen.getByLabelText("Şöbə")).not.toBeDisabled();
    expect(formBox()).toHaveTextContent("Təyinat yadda saxlanıldı.");
    act(() => { board.clear(); });
  });

  // Review 6: a change of language re-sorts the people and keeps what she picked; only a new read resets the picks.
  it("keeps the picks when the language changes", async () => {
    const { board } = await mountIsYuku();
    await pick("Reanimasiya");
    fireEvent.change(within(formBox()).getByLabelText("3 · Otaq 1 · Reanimasiya"), { target: { value: NURSE.nigar } });
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: `${PREF_PREFIX}lang`, newValue: "en" })); });
    await settle();
    expect(within(formBox()).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(formBox()).getByLabelText("3 · Otaq 1 · Reanimasiya")).toHaveValue(NURSE.nigar);
    act(() => { board.clear(); });
  });

  // Review 10: read again after a save, the form stays (busy) so the focused button does not vanish under her; the
  // outcome — saved, and the soft warning — is said in a polite live region.
  it("keeps the form and the focused button while it is read again after a save, and says the outcome politely", async () => {
    const saved = { ...unitSchedule("current", REA), warnings: [{ code: "unit_not_reached", nurse_id: NURSE.nigar }] };
    const { api, board } = await mountIsYuku({ setup: (a) => a.saveShiftSchedule.mockResolvedValue(saved) });
    await pick("Reanimasiya");
    fireEvent.change(within(formBox()).getByLabelText("3 · Otaq 1 · Reanimasiya"), { target: { value: NURSE.nigar } });
    let land = null;
    api.shiftSchedule.mockImplementation((shift = "current", unitId = null) => (unitId
      ? new Promise((resolve) => { land = () => resolve(unitSchedule(shift, unitId)); }) : Promise.resolve(schedule())));
    const button = within(formBox()).getByRole("button", { name: "Yadda saxla" });
    button.focus();
    await act(async () => { fireEvent.click(button); });
    await settle();
    expect(land).not.toBeNull();                                          // the form is being read again
    expect(document.activeElement).toBe(button);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(bedLabels()).toHaveLength(5);
    expect(formBox()).not.toHaveTextContent("Təyinat oxunur…");
    await act(async () => { land(); });
    await settle();
    expect(document.activeElement).toBe(button);
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 200); }); });
    const said = screen.getAllByRole("status").map((region) => region.textContent).join(" ");
    expect(said).toContain("Təyinat yadda saxlanıldı.");
    expect(said).toContain("Nigar Sentetik bu şöbəni görə bilməz");
    act(() => { board.clear(); });
  });

  it("another refusal keeps the choices and says «Yadda saxlanılmadı»", async () => {
    const { board } = await mountIsYuku({ setup: (a) => a.saveShiftSchedule.mockRejectedValue(refusal(503, "down")) });
    await pick("Reanimasiya");
    fireEvent.change(within(formBox()).getByLabelText("3 · Otaq 1 · Reanimasiya"), { target: { value: NURSE.aysel } });
    await save();
    expect(formBox()).toHaveTextContent(/^.*Yadda saxlanılmadı: /);
    expect(within(formBox()).getByLabelText("3 · Otaq 1 · Reanimasiya")).toHaveValue(NURSE.aysel);
    act(() => { board.clear(); });
  });

  it("«Növbəti növbə» reads and saves the next window", async () => {
    const { api, board } = await mountIsYuku({ setup: (a) => a.saveShiftSchedule.mockResolvedValue(
      { ...unitSchedule("next", REA), warnings: [] }) });
    await pick("Reanimasiya");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Növbəti növbə" })); });   // the box's header
    await settle();
    expect(api.shiftSchedule).toHaveBeenLastCalledWith("next", REA);
    expect(formBox()).toHaveTextContent(`Növbəti növbə · ${hhmm(Date.parse(NEXT.start))}–${hhmm(Date.parse(NEXT.end))}`);
    expect(within(formBox()).getByLabelText("1 · Otaq 1 · Reanimasiya")).toHaveValue("");
    await save();
    expect(api.saveShiftSchedule).toHaveBeenCalledWith({ unit_id: REA, shift_start: NEXT.start, items: [], expected: [] });
    act(() => { board.clear(); });
  });

  it("is drawn only when the structure was read; and not at all for a viewer without shifts.manage", async () => {
    let mounted = await mountIsYuku({ perms: ADMIN.filter((key) => key !== "shifts.manage") });
    await pick("Reanimasiya");
    expect(formBox()).toBeNull();
    expect(mounted.api.shiftNurses).not.toHaveBeenCalled();
    expect(cardNames()).toEqual(["Aysel Sentetik", "Leyla Sentetik"]);
    act(() => { mounted.board.clear(); });
    cleanup();
    mounted = await mountIsYuku();
    await pick("Reanimasiya");
    mounted.api.structure.mockRejectedValue(refusal(503, "down"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); });
    await settle();
    expect(formBox()).toHaveTextContent("Təyinat forması yazıla bilmir · oxunmadı");
    act(() => { mounted.board.clear(); });
  });
});

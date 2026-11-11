// UnmatchedStep.test.jsx — G3-05 (D10, D11, D17): «Eşleşmeyen ölçümler» inside the bedside page — the waiting sets,
// the link through the page's own patient list and identity question, the rejection with its reason — and the
// rail's count. Synthetic cards and sets only (board.testutil.js, unmatched.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { NOW, board, entry, identity } from "../../data/board.testutil.js";
import { UnmatchedProvider } from "../../data/UnmatchedProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { Sidebar } from "../../shell/Sidebar.jsx";
import { BedsideScreen } from "./BedsideScreen.jsx";
import { GONE, OLD, OLD_AT, ROUND, ROUND_AT, TYPO, unmatched } from "./unmatched.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const CHART = ["board.view", "clinical.chart"];
const AYSE = entry("S-001", [], { identity: identity({ birth_date: "1970-05-05" }) });
const VUSAL = entry("S-002", [], { identity: identity({ patient_id: "S-002", display_name: "Vüsal Sınaq", bed_label: "REA-01 · 1",
  bed_id: "REA-01-1", bed_key: "REA^01^1" }) });
const WHY = "yanlış numara girilmiş, hasta bulunamadı";
// A 403 on a link or a rejection: the missing right is said in the link's own words (never the correction's), but the
// engine's person-only refusal keeps its own sentence — it says why, and no right of hers would mend it.
const FORBIDDEN = [
  ["a missing right", "permission required: clinical.chart", "Bu ölçməni bağlamaq və ya rədd etmək hüququnuz yoxdur."],
  ["the person-only refusal", "a person links or rejects a reading: this credential names no actor", "Bu işi bir şəxs görür; bu kimlik bir şəxsi göstərmir."],
];

/** The page inside the shell's provider, the board LIVE, the list answering `sets`. */
async function open({ sets = [ROUND, OLD], perms = CHART, rail = false, setup } = {}) {
  const mounted = await mount(
    <UnmatchedProvider>{rail ? <Sidebar perms={perms} current="olcum" /> : null}<BedsideScreen /></UnmatchedProvider>, {
      access: token({ perms }), me: profile({ perms }),
      setup: (api) => {
        api.boardPatients.mockResolvedValue(board([AYSE, VUSAL]));
        api.streamTicket.mockResolvedValue({ ticket: "t-1" });
        api.unmatchedReadings.mockResolvedValue(unmatched(sets));
        api.assignReadings.mockResolvedValue({ assigned: [7, 8], patient_id: "S-001", alerts: [] });
        api.rejectReadings.mockResolvedValue({ rejected: [7, 8] });
        setup?.(api);
      },
    });
  await act(async () => { await mounted.board.start(); });
  await act(async () => { mounted.stream.open(); await settle(); });
  return mounted;
}
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
const button = (name) => screen.getByRole("button", { name });
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);
const setRows = () => [...document.querySelectorAll("[data-um-set]")];
const openList = () => press(button(/^Uyğunlaşmayan ölçmələr/));

beforeEach(() => { vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the way in", () => {
  it("the page's first step offers the list, with how many sets wait", async () => {
    await open();
    expect(button("Uyğunlaşmayan ölçmələr · 2")).toBeInTheDocument();
  });

  it("with nothing waiting the button carries no number", async () => {
    await open({ sets: [] });
    expect(button("Uyğunlaşmayan ölçmələr")).toBeInTheDocument();
    await openList();
    expect(screen.getByText("Gözləyən uyğunlaşmayan ölçmə yoxdur.")).toBeInTheDocument();
  });
});

describe("the list", () => {
  it("shows each set: the number as typed, why it matched nobody, the device, the time and the values", async () => {
    await open();
    await openList();
    expect(screen.getByRole("heading", { level: 2, name: "Uyğunlaşmayan ölçmələr" })).toBeInTheDocument();
    expect(setRows().map((r) => r.getAttribute("data-um-set"))).toEqual([TYPO, GONE]);
    const [round, old] = setRows();
    expect(round).toHaveTextContent(`Daxil edilən nömrə ${TYPO}`);
    expect(round).toHaveTextContent("nömrə heç bir yatışla uyğun gəlmədi");
    expect(round).toHaveTextContent("cihaz CONNEX-3A");
    expect(round).toHaveTextContent(`ölçmə ${dayStamp(ROUND_AT, NOW)}`);
    expect(round).toHaveTextContent("Nəbz 88 /dəq");
    expect(round).toHaveTextContent("SpO2 97 %");
    expect(old).toHaveTextContent("evə yazılmış xəstənin nömrəsi");
    expect(old).toHaveTextContent(`ölçmə ${dayStamp(OLD_AT, NOW)}`);
  });

  it("a set the engine marks as not linkable offers only the rejection, and says why", async () => {
    await open();
    await openList();
    const [round, old] = setRows();
    expect(within(round).getByRole("button", { name: "Xəstəyə bağla" })).toBeInTheDocument();
    expect(within(old).queryByRole("button", { name: "Xəstəyə bağla" })).toBeNull();
    expect(old).toHaveTextContent("24 saatdan köhnədir: bağlana bilməz, yalnız rədd edilir.");
    expect(within(old).getByRole("button", { name: "Rədd et" })).toBeInTheDocument();
  });

  it("«Geri» goes back to the patient list", async () => {
    await open();
    await openList();
    await press(button("Geriyə"));
    expect(document.querySelectorAll("[data-pick]")).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 2, name: "Xəstəni seçin" })).toBeInTheDocument();
  });

  it("says why when the list cannot be read", async () => {
    await open({ setup: (api) => api.unmatchedReadings.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor")) });
    await press(button("Uyğunlaşmayan ölçmələr"));
    expect(screen.getByText(/^Uyğunlaşmayan ölçmələr oxunmadı: /)).toBeInTheDocument();
  });
});

describe("linking a set to a patient", () => {
  async function toConfirm(extra) {
    const mounted = await open(extra);
    await openList();
    await press(within(setRows()[0]).getByRole("button", { name: "Xəstəyə bağla" }));
    expect(screen.getByRole("heading", { level: 2, name: "Bu ölçmə hansı xəstənindir?" })).toBeInTheDocument();
    await press(document.querySelector("[data-pick='S-001']"));
    return mounted;
  }

  it("asks the page's identity question, with the set's values, before anything is sent", async () => {
    const { api } = await toConfirm();
    expect(screen.getByRole("heading", { level: 2, name: "Bağlamanı təsdiqləyin" })).toBeInTheDocument();
    expect(screen.getByText("Ayşe Sentetik")).toBeInTheDocument();
    expect(screen.getByText("1970")).toBeInTheDocument();
    expect(screen.getByText("Bu ölçmə bu xəstəyə aiddirmi? Soyad, ad və doğum ili xəstə ilə uyğun gəlirmi?")).toBeInTheDocument();
    expect(document.querySelector("[data-um-values]")).toHaveTextContent("Nəbz 88 /dəq");
    expect(api.assignReadings).not.toHaveBeenCalled();
  });

  it("«Bəli, bağla» sends the set's ids and the patient, says so, and reads the list again", async () => {
    const { api } = await toConfirm();
    api.unmatchedReadings.mockResolvedValue(unmatched([OLD]));
    await press(button("Bəli, bağla"));
    expect(api.assignReadings).toHaveBeenCalledWith([7, 8], "S-001");
    expect(toasted("REA-01 · 2: ölçmə xəstəyə bağlandı.").length).toBeGreaterThan(0);
    expect(setRows().map((r) => r.getAttribute("data-um-set"))).toEqual([GONE]);
    expect(api.boardPatients.mock.calls.length).toBeGreaterThan(1);       // the card changed: the board reloaded
  });

  it("«Xeyr, imtina» goes back to the list and sends nothing", async () => {
    const { api } = await toConfirm();
    await press(button("Xeyr, imtina"));
    expect(api.assignReadings).not.toHaveBeenCalled();
    expect(setRows()).toHaveLength(2);
  });

  it("a refusal is said in the reader's words, named after the bed, and the list is read again", async () => {
    const { api } = await toConfirm({ setup: (a) => a.assignReadings.mockRejectedValue(
      refusal(409, "The reading is no longer waiting: it was linked or rejected already.", { apiCode: "reading_not_unmatched" })) });
    const reads = api.unmatchedReadings.mock.calls.length;
    await press(button("Bəli, bağla"));
    expect(toasted("REA-01 · 2: xəstəyə bağlanmadı — Bu ölçmə artıq gözləmir: bağlanıb və ya rədd edilib.").length).toBeGreaterThan(0);
    expect(api.unmatchedReadings.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.getByRole("heading", { level: 2, name: "Uyğunlaşmayan ölçmələr" })).toBeInTheDocument();
  });

  it.each(FORBIDDEN)("a 403 for %s is said in the link's words, named after the bed", async (_what, message, said) => {
    const { api } = await toConfirm({ setup: (a) => a.assignReadings.mockRejectedValue(refusal(403, message)) });
    await press(button("Bəli, bağla"));
    expect(toasted(`REA-01 · 2: xəstəyə bağlanmadı — ${said}`).length).toBeGreaterThan(0);
    expect(api.assignReadings).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/ölçməni düzəltmək hüququnuz yoxdur/)).toBeNull();      // never the correction's right
  });

  it("a second press while the link is in flight sends nothing more", async () => {
    let finish;
    const { api } = await toConfirm({ setup: (a) => a.assignReadings.mockImplementation(() => new Promise((resolve) => { finish = resolve; })) });
    fireEvent.click(button("Bəli, bağla"));
    fireEvent.click(button("Bəli, bağla"));
    await act(async () => { finish({ assigned: [7, 8], patient_id: "S-001", alerts: [] }); await settle(); });
    expect(api.assignReadings).toHaveBeenCalledTimes(1);
  });
});

describe("rejecting a set", () => {
  const dialog = () => screen.getByRole("dialog");
  async function toDialog(extra) {
    const mounted = await open(extra);
    await openList();
    await press(within(setRows()[0]).getByRole("button", { name: "Rədd et" }));
    return mounted;
  }
  const type = (text) => act(async () => { fireEvent.change(within(dialog()).getByLabelText(/^Səbəb/), { target: { value: text } }); await settle(); });

  it("asks for a reason and says the values are kept", async () => {
    const { api } = await toDialog();
    expect(within(dialog()).getByRole("heading", { name: `Ölçməni rədd et · ${TYPO}` })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("qeyddə qalır");
    await type("qısa");
    await press(within(dialog()).getByRole("button", { name: "Rədd et" }));
    expect(api.rejectReadings).not.toHaveBeenCalled();
  });

  it("sends the set's ids with the reason, says so, and reads the list again", async () => {
    const { api } = await toDialog();
    api.unmatchedReadings.mockResolvedValue(unmatched([OLD]));
    await type(`  ${WHY}  `);
    await press(within(dialog()).getByRole("button", { name: "Rədd et" }));
    expect(api.rejectReadings).toHaveBeenCalledWith([7, 8], WHY);
    expect(toasted(`Nömrə ${TYPO}: ölçmə rədd edildi.`).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(setRows().map((r) => r.getAttribute("data-um-set"))).toEqual([GONE]);
  });

  it("a refusal is said, and the dialog closes on anything but a reason the engine finds wrong", async () => {
    const { api } = await toDialog({ setup: (a) => a.rejectReadings.mockRejectedValue(
      refusal(409, "The reading is no longer waiting: it was linked or rejected already.", { apiCode: "reading_not_unmatched" })) });
    await type(WHY);
    await press(within(dialog()).getByRole("button", { name: "Rədd et" }));
    expect(api.rejectReadings).toHaveBeenCalledTimes(1);
    expect(toasted(`Nömrə ${TYPO}: rədd edilmədi — Bu ölçmə artıq gözləmir: bağlanıb və ya rədd edilib.`).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("rejecting a set — a 403", () => {
  it.each(FORBIDDEN)("for %s is said in the rejection's words, named after the number", async (_what, message, said) => {
    const mounted = await open({ setup: (a) => a.rejectReadings.mockRejectedValue(refusal(403, message)) });
    await openList();
    await press(within(setRows()[0]).getByRole("button", { name: "Rədd et" }));
    const dialog = screen.getByRole("dialog");
    await act(async () => { fireEvent.change(within(dialog).getByLabelText(/^Səbəb/), { target: { value: WHY } }); await settle(); });
    await press(within(dialog).getByRole("button", { name: "Rədd et" }));
    expect(mounted.api.rejectReadings).toHaveBeenCalledTimes(1);
    expect(toasted(`Nömrə ${TYPO}: rədd edilmədi — ${said}`).length).toBeGreaterThan(0);
    expect(screen.queryByText(/ölçməni düzəltmək hüququnuz yoxdur/)).toBeNull();      // never the correction's right
  });
});

describe("the rail's badge", () => {
  const entryOf = () => document.querySelector("nav a[href='#/olcum']");

  it("shows how many sets wait, in a neutral tone, and says it in words", async () => {
    await open({ rail: true });
    const badge = entryOf().querySelector("[data-rail-badge='unmatched']");
    expect(badge).toHaveTextContent("2");
    expect(badge.className).not.toMatch(/bg-crit|bg-mid/);
    expect(entryOf()).toHaveTextContent("2 uyğunlaşmayan ölçmə");
  });

  it("shows nothing when nothing waits, and nothing when the list could not be read", async () => {
    await open({ rail: true, sets: [] });
    expect(entryOf().querySelector("[data-rail-badge]")).toBeNull();
    cleanup();
    await open({ rail: true, setup: (api) => api.unmatchedReadings.mockRejectedValue(refusal(503, "down")) });
    expect(entryOf().querySelector("[data-rail-badge]")).toBeNull();
  });
});

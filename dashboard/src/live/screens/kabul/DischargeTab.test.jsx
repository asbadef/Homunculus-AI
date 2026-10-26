// The Taburcu tab (Group 2 · B1a, spec §3.3, §5.3): the discharges started, awaiting the charge
// nurse; the patients in, a physician's "Taburcuyu başlat" — held with its reason while the board
// shows a critical alarm nobody acknowledged, or while the alarm state is not known yet — the
// decision's dialog, and the charge nurse's confirmation, asked once more before it is sent.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { CONNECTION } from "../../../liveConnection.js";
import { refusal } from "../../session/mount.testutil.jsx";
import { FOCUS_RING } from "../../ui/focus.js";
import { alarm, board, entry } from "../../data/board.testutil.js";
import { ddmm, hhmm } from "../../i18n/dates.js";
import { DischargeTab } from "./DischargeTab.jsx";
import { fromLocalInput, localInput } from "./DischargeDialog.jsx";
import { CHARGE, DOCTOR, UUID_TEXT, mountKabul, row, settle, toasts } from "./kabul.testutil.js";

const ROWS = [
  row({ id: "a-1", patient_number: "H2600001", bed_label: "2", state: "ACTIVE" }),
  row({ id: "a-2", patient_number: "H2600002", bed_label: "5", room_name: "Otaq 2", state: "DRAFT", display_name: "Sentetik İki" }),
  row({ id: "a-3", patient_number: "H2600003", bed_label: "1", state: "PENDING_DISCHARGE", display_name: "Sentetik Üç",
    discharge_disposition: "OTHER_INSTITUTION", discharge_institution: "Sentetik Klinika", discharge_at: "2026-10-25T09:30:00Z" }),
];
const START = "Evə yazılmanı başlat";
const LEFT = "Xəstə çıxdı · təsdiqlə";
const UNKNOWN = "Alarm vəziyyəti hələ oxunmayıb — evə yazılmanı başlatmaq üçün gözləyin.";
const section = (name) => within(screen.getByRole("region", { name }));

/** Mount the tab on a session holding `perms`. The board is started and LIVE — loaded, with no
 *  alarm — unless `setup` answers `boardPatients` otherwise, or `start: false` leaves it as a
 *  session finds it before its first load: CONNECTING, nothing loaded. */
async function open(perms, setup, { start = true } = {}) {
  const mounted = await mountKabul(<DischargeTab />, { perms, setup: (api) => {
    api.admissions.mockResolvedValue(ROWS);
    api.boardPatients.mockResolvedValue(board([]));
    api.streamTicket.mockResolvedValue({ ticket: "t-1" });
    setup?.(api);
  } });
  if (start) {
    await act(async () => { await mounted.board.start(); mounted.stream.open(); });
    await settle();
  }
  return mounted;
}

/** The physician's start, through its dialog, as it opens: home, now, no note. */
async function sendStart() {
  fireEvent.click(screen.getByRole("button", { name: START }));
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: START })); });
  await settle();
}

/** The charge nurse's confirmation, through the question it asks first. */
async function confirmLeft() {
  fireEvent.click(screen.getByRole("button", { name: LEFT }));
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: LEFT })); });
  await settle();
}

/** «Taburcuyu başlat» is held: aria-disabled, described by its reason in words, and a press opens
 *  nothing and sends nothing. */
function expectHeld(api, reason) {
  const start = screen.getByRole("button", { name: START });
  expect(start.getAttribute("aria-disabled")).toBe("true");
  expect(start.getAttribute("aria-describedby").split(" ")).toContain(screen.getByText(reason).id);
  fireEvent.click(start);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(api.startDischarge).not.toHaveBeenCalled();
}

const startAllowed = () => screen.getByRole("button", { name: START }).getAttribute("aria-disabled") === null;

describe("DischargeTab", () => {
  it("reads the three open states and lists them in two sections, by name and bed, never by UUID", async () => {
    const { api } = await open(DOCTOR);
    expect(api.admissions).toHaveBeenCalledWith(["DRAFT", "ACTIVE", "PENDING_DISCHARGE"]);
    expect(section("Evə yazılması başladılanlar").getByText(/Sentetik Üç/)).toBeTruthy();
    expect(section("Evə yazılması başladılanlar").getByText(/Başqa müəssisəyə göndəriş · Sentetik Klinika/)).toBeTruthy();
    const lying = section("Yatan xəstələr");
    expect(lying.getByText(/Sentetik Hasta/)).toBeTruthy();
    expect(lying.getByText("Həkim imzası gözlənilir")).toBeTruthy();
    expect(lying.getByText("Əvvəlcə qəbul imzalanmalıdır (xəstə ekranı).")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("gives a physician «Taburcuyu başlat» on an admitted patient only, and the charge nurse «Hasta çıktı · onayla»", async () => {
    await open(DOCTOR);
    expect(screen.getAllByRole("button", { name: START })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: LEFT })).toBeNull();
  });

  it("gives the charge nurse no «Taburcuyu başlat»: starting a discharge is the physician's", async () => {
    await open(CHARGE);
    expect(screen.queryByRole("button", { name: START })).toBeNull();
    expect(screen.getAllByRole("button", { name: LEFT })).toHaveLength(1);
  });

  it("describes each row's button by that row's bed line", async () => {
    await open([...DOCTOR, "admissions.discharge.confirm"]);
    const described = (name) => screen.getByRole("button", { name }).getAttribute("aria-describedby").split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(described(START)).toContain("2 · Otaq 1 · Reanimasiya");
    expect(described(LEFT)).toContain("1 · Otaq 1 · Reanimasiya");
  });

  it.each([
    ["firing", {}],
    ["latched — resolved, nobody acknowledged it (G2-A1)", { resolved_at: "2026-10-25T09:00:00Z" }],
  ])("holds «Taburcuyu başlat», saying why, while a critical alarm is %s", async (_shape, over) => {
    const { api } = await open(DOCTOR, (a) => {
      a.boardPatients.mockResolvedValue(board([entry("H2600001", [alarm("septic_shock", "critical", over)])]));
    });
    expectHeld(api, "Təsdiqlənməmiş kritik siqnal var: əvvəlcə siqnala baxın.");
  });

  it("does not hold it for an acknowledged critical alarm or a high one", async () => {
    await open(DOCTOR, (a) => {
      a.boardPatients.mockResolvedValue(board([entry("H2600001", [
        alarm("septic_shock", "critical", { acknowledged: true, acknowledged_by: "hekim" }), alarm("news2", "high")])]));
    });
    expect(startAllowed()).toBe(true);
  });

  it("does not hold it for a critical alarm on another patient", async () => {
    const { board: store } = await open(DOCTOR, (a) => {
      a.boardPatients.mockResolvedValue(board([entry("H2600001", []), entry("H2600009", [alarm("septic_shock", "critical")])]));
    });
    expect(store.getState().alerts.some((a) => a.patientId === "H2600009" && a.severity === "critical")).toBe(true);
    expect(startAllowed()).toBe(true);
  });

  it("does not hold it on a loaded board with no alarm", async () => {
    await open(DOCTOR, (a) => a.boardPatients.mockResolvedValue(board([entry("H2600001", [])])));
    expect(startAllowed()).toBe(true);
    expect(screen.queryByText(UNKNOWN)).toBeNull();
  });

  it("holds it while the board is still connecting: nothing loaded yet rules no alarm out", async () => {
    const { api, board: store } = await open(DOCTOR, undefined, { start: false });
    expect(store.getState()).toMatchObject({ connection: CONNECTION.CONNECTING, loaded: false });
    expectHeld(api, UNKNOWN);
  });

  it("holds it while the board is unavailable: its load failed", async () => {
    const { api, board: store } = await open(DOCTOR, (a) => a.boardPatients.mockRejectedValue(refusal(503, "Service Unavailable")),
      { start: false });
    await act(async () => { await store.start(); });
    await settle();
    expect(store.getState().connection).toBe(CONNECTION.UNAVAILABLE);
    expectHeld(api, UNKNOWN);
  });

  it("a physician without the board's right gets a note, not a hold that would never lift", async () => {
    await open(DOCTOR.filter((p) => p !== "board.view"), undefined, { start: false });
    expect(startAllowed()).toBe(true);
    expect(screen.getByText(/Paneli görmək səlahiyyətiniz yoxdur/)).toBeTruthy();
  });

  it("starts a discharge from the dialog: home, now, with the note", async () => {
    const { api } = await open(DOCTOR, (a) => a.startDischarge.mockResolvedValue({ id: "a-1", state: "PENDING_DISCHARGE" }));
    const before = Date.now();
    fireEvent.click(screen.getByRole("button", { name: START }));
    const dialog = within(screen.getByRole("dialog", { name: "Evə yazılma · 2 · Otaq 1 · Reanimasiya" }));
    fireEvent.change(dialog.getByLabelText("Qeyd"), { target: { value: "Sentetik qeyd" } });
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: START })); });
    await settle();
    expect(api.startDischarge).toHaveBeenCalledTimes(1);
    const [id, body] = api.startDischarge.mock.calls[0];
    expect(id).toBe("a-1");
    expect(body).toMatchObject({ disposition: "HOME", institution: null, reported_by: null, note: "Sentetik qeyd" });
    expect(body.discharge_at).toMatch(/Z$/);
    expect(Date.parse(body.discharge_at)).toBeGreaterThan(before - 60_000);
    expect(Date.parse(body.discharge_at)).toBeLessThanOrEqual(Date.now());
    expect(toasts().getAllByText(/^2 · Otaq 1 · Reanimasiya · evə yazılma başladıldı/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for the institution before it sends a transfer to another one", async () => {
    const { api } = await open(DOCTOR);
    fireEvent.click(screen.getByRole("button", { name: START }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByLabelText("Başqa müəssisəyə göndəriş"));
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: START })); });
    expect(api.startDischarge).not.toHaveBeenCalled();
    expect(dialog.getByText("Göndərilən müəssisəni yazın.")).toBeTruthy();
  });

  it.each([
    ["empty — the physician herself", "", null],
    ["a name written in", "Sentetik Həkim", "Sentetik Həkim"],
  ])("sends an exitus with the reporting physician %s", async (_case, typed, sent) => {
    const { api } = await open(DOCTOR, (a) => a.startDischarge.mockResolvedValue({ id: "a-1", state: "PENDING_DISCHARGE" }));
    fireEvent.click(screen.getByRole("button", { name: START }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByLabelText("Vəfat (exitus)"));
    if (typed) fireEvent.change(dialog.getByLabelText("Bildirən həkim"), { target: { value: typed } });
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: START })); });
    await settle();
    expect(api.startDischarge).toHaveBeenCalledTimes(1);
    expect(api.startDischarge.mock.calls[0][1]).toMatchObject({ disposition: "EXITUS", institution: null, reported_by: sent });
  });

  it("refuses a discharge time in the future and sends nothing", async () => {
    const { api } = await open(DOCTOR);
    fireEvent.click(screen.getByRole("button", { name: START }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText(/^Çıxış vaxtı/), { target: { value: localInput(Date.now() + 2 * 3_600_000) } });
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: START })); });
    expect(api.startDischarge).not.toHaveBeenCalled();
    expect(dialog.getByText("Çıxış vaxtı düzgün deyil (gələcəkdə və ya qəbuldan əvvəl ola bilməz).")).toBeTruthy();
  });

  it("puts the server's refusal on the toast by its code, never in its English, and reads the list again", async () => {
    const { api } = await open(DOCTOR, (a) => a.startDischarge.mockRejectedValue(
      refusal(409, "Discharge blocked: 1 unacknowledged CRITICAL alert(s)…", { apiCode: "critical_alarm_open" })));
    const reads = api.admissions.mock.calls.length;
    await sendStart();
    expect(toasts().getAllByText(/^2 · Otaq 1 · Reanimasiya: Təsdiqlənməmiş kritik siqnal var; evə yazılma başladıla bilməz/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Discharge blocked/);
    expect(api.admissions.mock.calls.length).toBeGreaterThan(reads);
  });

  it("reads the list again every minute while it is open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { api } = await open(DOCTOR);
      const reads = api.admissions.mock.calls.length;
      await act(async () => { vi.advanceTimersByTime(59_999); });
      expect(api.admissions.mock.calls.length).toBe(reads);
      await act(async () => { vi.advanceTimersByTime(1); });
      await settle();
      expect(api.admissions.mock.calls.length).toBe(reads + 1);
      expect(api.admissions).toHaveBeenLastCalledWith(["DRAFT", "ACTIVE", "PENDING_DISCHARGE"]);
    } finally {
      vi.useRealTimers();
    }
  });

  // A-30: a list the server cut at its cap is not the whole of the units' admissions.
  it("says the list was cut at the server's cap, and to narrow it by unit — and nothing of it when the list is whole", async () => {
    const CUT = /^Siyahı kəsilib: yalnız ən yeni qəbullar göstərilir/;
    const { api } = await open(CHARGE, (a) => a.admissions.mockResolvedValue(Object.assign([...ROWS], { truncated: true })));
    expect(screen.getByText(CUT).textContent).toMatch(/şöbəyə görə daraldın/);
    api.admissions.mockResolvedValue([...ROWS]);
    await confirmLeft();                                                    // any write reads the list again
    expect(screen.queryByText(CUT)).toBeNull();
  });

  it("says a failed first read, and does not go on saying it is loading", async () => {
    await open(DOCTOR, (a) => a.admissions.mockRejectedValue(refusal(503, "Service Unavailable")));
    expect(screen.getByText(/Siyahı oxunmadı/)).toBeTruthy();
    expect(screen.queryByText("Yüklənir…")).toBeNull();
  });

  it("dates a started discharge's time when it is not today's", async () => {
    const earlier = Date.now() - 3 * 86_400_000;
    const now = Date.now();
    await open(CHARGE, (a) => a.admissions.mockResolvedValue([
      row({ id: "a-3", patient_number: "H2600003", bed_label: "1", state: "PENDING_DISCHARGE",
        discharge_disposition: "OTHER_INSTITUTION", discharge_institution: "Sentetik Klinika", discharge_at: new Date(earlier).toISOString() }),
      row({ id: "a-4", patient_number: "H2600004", bed_label: "5", room_name: "Otaq 2", state: "PENDING_DISCHARGE",
        discharge_disposition: "HOME", discharge_at: new Date(now).toISOString() }),
    ]));
    const pending = section("Evə yazılması başladılanlar");
    expect(pending.getByText(`Başqa müəssisəyə göndəriş · Sentetik Klinika · ${ddmm(earlier)} ${hhmm(earlier)}`)).toBeTruthy();
    expect(pending.getByText(`Evə yazılma · ${hhmm(now)}`)).toBeTruthy();
  });

  it("asks before it confirms that a patient left, naming the bed and the number; cancelling sends nothing", async () => {
    const { api } = await open(CHARGE);
    fireEvent.click(screen.getByRole("button", { name: LEFT }));
    const dialog = within(screen.getByRole("dialog", { name: "Xəstənin çıxışını təsdiqləyin" }));
    expect(dialog.getByText(/Çarpayı: 1 · Otaq 1 · Reanimasiya · Xəstə nömrəsi: H2600003\./)).toBeTruthy();
    expect(dialog.getByText(/geri qaytarıla bilməz/)).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "İmtina" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.confirmDischarge).not.toHaveBeenCalled();
  });

  it("sends a confirmation once, however often it is pressed", async () => {
    const { api } = await open(CHARGE, (a) => a.confirmDischarge.mockResolvedValue({ id: "a-3", state: "DISCHARGED", board: "ok" }));
    fireEvent.click(screen.getByRole("button", { name: LEFT }));
    const yes = within(screen.getByRole("dialog")).getByRole("button", { name: LEFT });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await settle();
    expect(api.confirmDischarge).toHaveBeenCalledTimes(1);
    expect(api.confirmDischarge).toHaveBeenCalledWith("a-3");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the charge nurse confirms a started discharge; the list and the beds are read again", async () => {
    const { api } = await open(CHARGE, (a) => a.confirmDischarge.mockResolvedValue({ id: "a-3", state: "DISCHARGED", board: "ok" }));
    const reads = api.admissions.mock.calls.length;
    const beds = api.structure.mock.calls.length;
    await confirmLeft();
    expect(api.confirmDischarge).toHaveBeenCalledWith("a-3");
    expect(toasts().getAllByText("1 · Otaq 1 · Reanimasiya · evə yazılma təsdiqləndi; çarpayı təmizliyə verildi").length).toBeGreaterThan(0);
    expect(api.admissions.mock.calls.length).toBeGreaterThan(reads);
    expect(api.structure.mock.calls.length).toBeGreaterThan(beds);
  });

  it("says so when the card did not leave the board, on the toast and in a note that stays", async () => {
    await open(CHARGE, (a) => a.confirmDischarge.mockResolvedValue({ id: "a-3", state: "DISCHARGED", board: "failed" }));
    await confirmLeft();
    expect(toasts().getAllByText(/kart paneldən götürülmədi/).length).toBeGreaterThan(0);
    const region = screen.getByRole("region", { name: "Bildirişlər" });
    const notes = screen.getAllByRole("note").filter((n) => !region.contains(n) && /kart paneldən götürülmədi/.test(n.textContent));
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toContain("1 · Otaq 1 · Reanimasiya");
  });

  // A-17: a write's buttons are held until the list is read again — until then it still shows the
  // admission as it was, and a press in that gap would send the same write twice.
  it.each([
    ["the discharge dialog", DOCTOR, "startDischarge", START, { id: "a-1", state: "PENDING_DISCHARGE" }],
    ["the confirmation", CHARGE, "confirmDischarge", LEFT, { id: "a-3", state: "DISCHARGED", board: "ok" }],
  ])("keeps %s held until the list is read again, so a second press sends nothing", async (_what, perms, call, name, answer) => {
    let reread;
    const { api } = await open(perms, (a) => a[call].mockResolvedValue(answer));
    api.admissions.mockImplementationOnce(() => new Promise((resolve) => { reread = resolve; }));
    fireEvent.click(screen.getByRole("button", { name }));
    const send = () => within(screen.getByRole("dialog")).getByRole("button", { name });
    await act(async () => { fireEvent.click(send()); });
    await settle();
    expect(api[call]).toHaveBeenCalledTimes(1);
    expect(send()).toHaveAttribute("aria-busy", "true");                    // landed, the list not read yet
    await act(async () => { fireEvent.click(send()); });
    expect(api[call]).toHaveBeenCalledTimes(1);
    await act(async () => { reread(ROWS); });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api[call]).toHaveBeenCalledTimes(1);
  });

  // A-22, spec §5.7: the button a write was sent from leaves the list with the re-read (a started
  // discharge moves up, a confirmed one goes) — its focus must not fall to <body>.
  it.each([
    ["a started discharge", DOCTOR, sendStart, START, "startDischarge", { id: "a-1", state: "PENDING_DISCHARGE" },
      [{ ...ROWS[0], state: "PENDING_DISCHARGE", discharge_disposition: "HOME", discharge_at: "2026-10-25T09:30:00Z" }, ROWS[1], ROWS[2]]],
    ["a confirmation", CHARGE, confirmLeft, LEFT, "confirmDischarge", { id: "a-3", state: "DISCHARGED", board: "ok" }, [ROWS[0], ROWS[1]]],
  ])("after %s the focus goes to the started discharges, not to <body>", async (_what, perms, send, name, call, answer, after) => {
    const { api } = await open(perms, (a) => a[call].mockResolvedValue(answer));
    api.admissions.mockResolvedValue(after);
    screen.getByRole("button", { name }).focus();                           // a keyboard user's press
    await send();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Evə yazılması başladılanlar" }));
  });

  // Re-review M-3: the place the focus lands shows it, as the strip's line and a freed bed do, and
  // is named by its own heading rather than by a copy of its words.
  it("draws the focus ring on the started discharges' list, which its own heading names", async () => {
    await open(CHARGE);
    for (const name of ["Evə yazılması başladılanlar", "Yatan xəstələr"]) {
      const region = screen.getByRole("region", { name });
      expect(region.hasAttribute("aria-label"), name).toBe(false);
      const heading = document.getElementById(region.getAttribute("aria-labelledby")).closest("h2");
      expect(heading, name).toHaveTextContent(name);
      expect(region.contains(heading), name).toBe(true);
    }
    const pending = screen.getByRole("region", { name: "Evə yazılması başladılanlar" });
    expect(pending.getAttribute("tabindex")).toBe("-1");
    expect(pending).toHaveClass(...FOCUS_RING.split(" "));
    expect(pending).not.toHaveClass("outline-none");
  });

  it("leaves the focus on the button when the write was refused and the row stays", async () => {
    await open(CHARGE, (a) => a.confirmDischarge.mockRejectedValue(
      refusal(409, "Only a PENDING_DISCHARGE admission can be confirmed.", { apiCode: "invalid_transition" })));
    const left = screen.getByRole("button", { name: LEFT });
    left.focus();
    await confirmLeft();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: LEFT }));
  });

  // Amendment A-9: an uncoded 404 ("Admission not found.") is said by its status, in the reader's
  // words — never the server's English.
  it.each([
    ["a started discharge", DOCTOR, "startDischarge", sendStart, "2 · Otaq 1 · Reanimasiya: Sorğu uğursuz oldu (404)."],
    ["a confirmation", CHARGE, "confirmDischarge", confirmLeft, "1 · Otaq 1 · Reanimasiya: Sorğu uğursuz oldu (404)."],
  ])("says an admission the server no longer finds by its status on %s, never in the server's English", async (_write, perms, call, press, said) => {
    await open(perms, (a) => a[call].mockRejectedValue(refusal(404, "Admission not found.")));
    await press();
    expect(toasts().getAllByText(said).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/not found/i);
  });
});

// A-30, A-32: the confirmation answers how the alarms' retirement went (`alerts`), refuses while a
// critical alarm is open (the user's decision: the confirm checks too, an exitus included), and a
// card that did not leave the board can be taken off it again by the same confirmation.
describe("the confirmation (A-30, A-32)", () => {
  const SUBJECT = "1 · Otaq 1 · Reanimasiya";
  const CRITICAL = "Təsdiqlənməmiş kritik siqnal var: çıxışı təsdiqləməzdən əvvəl siqnal təsdiqlənməlidir.";
  const UNKNOWN_HERE = "Alarm vəziyyəti hələ oxunmayıb — çıxışı təsdiqləmək üçün gözləyin.";
  const REFUSED = `${SUBJECT}: Təsdiqlənməmiş kritik siqnal var; çıxış təsdiqlənə bilməz. Əvvəlcə siqnal təsdiqlənməlidir.`;
  const BOARD_FAILED = "evə yazılma təsdiqləndi; kart paneldən götürülmədi — paneli yoxlayın";
  const INCOMPLETE = "evə yazılma təsdiqləndi; siqnalların bağlanma qeydi natamamdır — sistem administratoruna bildirin";
  const RETRY = "Paneldən yenidən götür";
  const region = () => screen.getByRole("region", { name: "Bildirişlər" });
  /** The notes the tab keeps (the toasts' are the region's). */
  const kept = () => screen.queryAllByRole("note").filter((n) => !region().contains(n));

  function expectConfirmHeld(api, reason) {
    const left = screen.getByRole("button", { name: LEFT });
    expect(left.getAttribute("aria-disabled")).toBe("true");
    expect(left.getAttribute("aria-describedby").split(" ")).toContain(screen.getByText(reason).id);
    fireEvent.click(left);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.confirmDischarge).not.toHaveBeenCalled();
  }

  it.each([
    ["firing", {}],
    ["latched — resolved, nobody acknowledged it (G2-A1)", { resolved_at: "2026-10-25T09:00:00Z" }],
  ])("holds «Hasta çıktı · onayla», saying the alarm must be acknowledged first, while a critical alarm is %s", async (_shape, over) => {
    const { api } = await open(CHARGE, (a) => {
      a.boardPatients.mockResolvedValue(board([entry("H2600003", [alarm("septic_shock", "critical", over)])]));
    });
    expectConfirmHeld(api, CRITICAL);
  });

  // Review I-2: the row's button is not the last door — the question it opens has its own
  // «Hasta çıktı · onayla», which a critical alarm firing while it is open must hold too.
  it("holds the question's own «Hasta çıktı · onayla» the moment a critical alarm fires while it is open, saying why, and sends nothing", async () => {
    const { api, stream } = await open(CHARGE);
    fireEvent.click(screen.getByRole("button", { name: LEFT }));
    const dialog = () => within(screen.getByRole("dialog", { name: "Xəstənin çıxışını təsdiqləyin" }));
    const yes = () => dialog().getByRole("button", { name: LEFT });
    expect(yes().getAttribute("aria-disabled")).toBeNull();

    act(() => { stream.frame(entry("H2600003", [alarm("septic_shock", "critical")])); });
    await settle();
    expect(yes().getAttribute("aria-disabled")).toBe("true");
    expect(yes().getAttribute("aria-describedby").split(" ")).toContain(dialog().getByText(CRITICAL).id);
    await act(async () => { fireEvent.click(yes()); });
    await settle();
    expect(api.confirmDischarge).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();                       // still asking

    // acknowledged meanwhile: the hold lifts, the question still open
    act(() => { stream.frame(entry("H2600003", [alarm("septic_shock", "critical", { acknowledged: true, acknowledged_by: "hemsire" })])); });
    await settle();
    expect(yes().getAttribute("aria-disabled")).toBeNull();
    expect(dialog().queryByText(CRITICAL)).toBeNull();
  });

  it("does not hold it for an acknowledged critical alarm, nor for one on another patient", async () => {
    await open(CHARGE, (a) => a.boardPatients.mockResolvedValue(board([
      entry("H2600003", [alarm("septic_shock", "critical", { acknowledged: true, acknowledged_by: "hemsire" })]),
      entry("H2600001", [alarm("septic_shock", "critical")]),
    ])));
    expect(screen.getByRole("button", { name: LEFT }).getAttribute("aria-disabled")).toBeNull();
  });

  it("holds it while the board has not loaded: nothing loaded yet rules no alarm out", async () => {
    const { api } = await open(CHARGE, undefined, { start: false });
    expectConfirmHeld(api, UNKNOWN_HERE);
  });

  it("a charge nurse without the board's right gets a note, not a hold that would never lift", async () => {
    await open(CHARGE.filter((p) => p !== "board.view"), undefined, { start: false });
    expect(screen.getByRole("button", { name: LEFT }).getAttribute("aria-disabled")).toBeNull();
    // What the engine does (A-32's confirm re-check): it refuses the confirmation, and says so.
    expect(section("Evə yazılması başladılanlar")
      .getByText(/Təsdiqlənməmiş kritik siqnal varkən mühərrik çıxışın təsdiqini rədd edir və bunu bildirir\./)).toBeTruthy();
  });

  it("says the server's critical_alarm_open at the confirm as the confirm's: acknowledge the alarm first — never that the discharge cannot start", async () => {
    await open(CHARGE, (a) => a.confirmDischarge.mockRejectedValue(
      refusal(409, "Discharge blocked: 1 unacknowledged CRITICAL alert(s)…", { apiCode: "critical_alarm_open" })));
    await confirmLeft();
    expect(toasts().getAllByText(REFUSED).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/başladıla bilməz|Discharge blocked/);
  });

  it.each([
    ["the alarms' close-out record is incomplete", { board: "ok", alerts: "incomplete" }, INCOMPLETE, false],
    ["the card did not leave the board", { board: "failed", alerts: "failed" }, BOARD_FAILED, true],
    ["the alarms were not retired", { board: "ok", alerts: "failed" }, BOARD_FAILED, true],
  ])("says when %s, on the toast and in a note that stays — offering the retry only for the board", async (_what, answer, text, retry) => {
    await open(CHARGE, (a) => a.confirmDischarge.mockResolvedValue({ id: "a-3", state: "DISCHARGED", ...answer }));
    await confirmLeft();
    const told = toasts().getAllByText(`${SUBJECT} · ${text}`);
    expect(told[0].closest("[data-tone]").getAttribute("data-tone")).toBe("warn");
    expect(kept().map((n) => n.textContent)).toEqual([expect.stringContaining(`${SUBJECT} · ${text}`)]);
    expect(Boolean(screen.queryByRole("button", { name: RETRY }))).toBe(retry);
    if (text !== INCOMPLETE) expect(document.body.textContent).not.toContain(INCOMPLETE);
  });

  it("takes a card that did not leave the board off it again: the same confirmation for that admission, and the note goes", async () => {
    const { api } = await open(CHARGE, (a) => a.confirmDischarge
      .mockResolvedValueOnce({ id: "a-3", state: "DISCHARGED", board: "failed", alerts: "failed" })
      .mockResolvedValueOnce({ id: "a-3", state: "DISCHARGED", board: "ok", alerts: "ok" }));
    api.admissions.mockResolvedValue([ROWS[0], ROWS[1]]);                  // the discharged admission has left the list
    await confirmLeft();
    const retry = screen.getByRole("button", { name: RETRY });
    expect(retry.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain(`${SUBJECT} · ${BOARD_FAILED}`);
    retry.focus();
    await act(async () => { fireEvent.click(retry); });
    await settle();

    expect(api.confirmDischarge.mock.calls).toEqual([["a-3"], ["a-3"]]);
    expect(toasts().getAllByText(`${SUBJECT} · kart paneldən götürüldü`).length).toBeGreaterThan(0);
    expect(kept()).toEqual([]);
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Evə yazılması başladılanlar" }));
  });

  it("keeps the note, and says why, when the retry fails again or is refused — and sends one retry however often it is pressed", async () => {
    let answer;
    const { api } = await open(CHARGE, (a) => a.confirmDischarge
      .mockResolvedValueOnce({ id: "a-3", state: "DISCHARGED", board: "failed", alerts: "failed" })
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }))
      .mockRejectedValueOnce(refusal(409, "Only a PENDING_DISCHARGE admission can be confirmed.", { apiCode: "invalid_transition" })));
    await confirmLeft();
    const retry = () => screen.getByRole("button", { name: RETRY });
    await act(async () => { fireEvent.click(retry()); });
    await act(async () => { fireEvent.click(retry()); });                   // on its way: nothing more is sent
    expect(api.confirmDischarge).toHaveBeenCalledTimes(2);
    expect(retry()).toHaveAttribute("aria-busy", "true");
    await act(async () => { answer({ id: "a-3", state: "DISCHARGED", board: "failed", alerts: "failed" }); });
    await settle();
    expect(kept()).toHaveLength(1);
    expect(toasts().getAllByText(`${SUBJECT} · ${BOARD_FAILED}`).length).toBeGreaterThan(1);

    await act(async () => { fireEvent.click(retry()); });
    await settle();
    expect(api.confirmDischarge).toHaveBeenCalledTimes(3);
    expect(toasts().getAllByText(`${SUBJECT}: Qeyd bu əməliyyat üçün uyğun vəziyyətdə deyil; siyahı yeniləndi.`).length).toBeGreaterThan(0);
    expect(kept()).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/PENDING_DISCHARGE admission/);
  });

  it("holds every other note's retry, saying so, while one is out", async () => {
    let answer;
    const second = row({ id: "a-4", patient_number: "H2600004", bed_label: "5", room_name: "Otaq 2", state: "PENDING_DISCHARGE",
      discharge_disposition: "HOME", discharge_at: "2026-10-25T09:40:00Z" });
    const { api } = await open(CHARGE, (a) => {
      a.admissions.mockResolvedValue([...ROWS, second]);
      a.confirmDischarge.mockResolvedValueOnce({ id: "a-3", state: "DISCHARGED", board: "failed", alerts: "failed" })
        .mockResolvedValueOnce({ id: "a-4", state: "DISCHARGED", board: "failed", alerts: "failed" })
        .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    });
    for (const at of [0, 1]) {                                              // a-3, then a-4: neither card left
      fireEvent.click(screen.getAllByRole("button", { name: LEFT })[at]);
      await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: LEFT })); });
      await settle();
    }
    const [first, other] = screen.getAllByRole("button", { name: RETRY });
    await act(async () => { fireEvent.click(first); });
    expect(other.getAttribute("aria-disabled")).toBe("true");
    expect(other.getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain(`${SUBJECT} · kart paneldən yenidən götürülür…`);
    await act(async () => { fireEvent.click(other); });
    expect(api.confirmDischarge).toHaveBeenCalledTimes(3);                 // two confirmations, one retry
    await act(async () => { answer({ id: "a-3", state: "DISCHARGED", board: "ok", alerts: "ok" }); });
    await settle();
    expect(screen.getAllByRole("button", { name: RETRY })).toHaveLength(1);
    expect(screen.getByRole("button", { name: RETRY }).getAttribute("aria-disabled")).toBeNull();
  });
});

// A-30: the default discharge time is never before the admission. A datetime-local holds minutes;
// read back, its value is the minute's start — before an admission made within that minute, which
// the server refused (`field_invalid:discharge_at`). The default keeps its seconds, and is the
// admission's time when this browser's clock is behind it.
describe("the discharge time's default (A-30)", () => {
  const at = (h, m, s = 0) => new Date(2026, 9, 25, h, m, s).getTime();
  /** An instant as the server writes it: with microseconds, which Date.parse drops (review I-1). */
  const micro = (ms) => new Date(ms).toISOString().replace(/Z$/, "456Z");
  /** Open the dialog for an admission made at `admitted` (ms, or the server's own string), the
   *  clock at `nowMs`. */
  async function dialogAt(nowMs, admitted) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(nowMs);
    const written = typeof admitted === "string" ? admitted : new Date(admitted).toISOString();
    const mounted = await open(DOCTOR, (a) => {
      a.admissions.mockResolvedValue([{ ...ROWS[0], admission_datetime: written }, ROWS[1], ROWS[2]]);
      a.startDischarge.mockResolvedValue({ id: "a-1", state: "PENDING_DISCHARGE" });
    });
    fireEvent.click(screen.getByRole("button", { name: START }));
    return { ...mounted, dialog: within(screen.getByRole("dialog")) };
  }
  const send = async (dialog) => {
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: START })); });
    await settle();
  };
  const sentAt = (api) => Date.parse(api.startDischarge.mock.calls[0][1].discharge_at);

  it("is now, its seconds kept, for a discharge within the admission's own minute", async () => {
    try {
      const { api, dialog } = await dialogAt(at(10, 0, 45), at(10, 0, 30));
      expect(dialog.getByLabelText(/^Çıxış vaxtı/).value).toBe("2026-10-25T10:00");
      await send(dialog);
      expect(sentAt(api)).toBe(at(10, 0, 45));
    } finally {
      vi.useRealTimers();
    }
  });

  it("is the admission's time when this browser's clock is behind it — shown, sent, and not called the future", async () => {
    try {
      const { api, dialog } = await dialogAt(at(10, 0, 10), at(10, 0, 40));
      await send(dialog);
      expect(api.startDischarge).toHaveBeenCalledTimes(1);
      expect(sentAt(api)).toBe(at(10, 0, 40));
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends the admission's time for a minute chosen within the admission's own, and refuses one before it", async () => {
    try {
      const { api, dialog } = await dialogAt(at(10, 30), at(10, 0, 30));
      const field = dialog.getByLabelText(/^Çıxış vaxtı/);
      expect(field.getAttribute("min")).toBe("2026-10-25T10:00");
      fireEvent.change(field, { target: { value: "2026-10-25T09:59" } });
      await send(dialog);
      expect(api.startDischarge).not.toHaveBeenCalled();
      expect(dialog.getByText("Çıxış vaxtı düzgün deyil (gələcəkdə və ya qəbuldan əvvəl ola bilməz).")).toBeTruthy();
      fireEvent.change(field, { target: { value: "2026-10-25T10:00" } });
      await send(dialog);
      expect(sentAt(api)).toBe(at(10, 0, 30));
    } finally {
      vi.useRealTimers();
    }
  });

  // Review I-1: the server writes `…:40.123456Z`; read back to the millisecond and sent as
  // `…:40.123Z`, the admission's own time is before the stored one, and form.py refuses it. Whenever
  // the time sent is the admission's to the millisecond, it goes out as the server wrote it.
  it.each([
    ["this browser's clock is behind it", () => at(10, 0, 10), null],
    ["a minute is chosen within its own", () => at(10, 30), "2026-10-25T10:00"],
    ["the dialog opened in its very millisecond", () => at(10, 0, 40) + 123, null],
  ])("sends the admission's time exactly as the server wrote it, microseconds and all, when %s", async (_case, now, pick) => {
    const exact = micro(at(10, 0, 40) + 123);
    try {
      const { api, dialog } = await dialogAt(now(), exact);
      if (pick) fireEvent.change(dialog.getByLabelText(/^Çıxış vaxtı/), { target: { value: pick } });
      await send(dialog);
      expect(api.startDischarge.mock.calls[0][1].discharge_at).toBe(exact);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a later time to the millisecond, never the admission's string", async () => {
    try {
      const { api, dialog } = await dialogAt(at(10, 0, 41), micro(at(10, 0, 40) + 123));
      await send(dialog);
      expect(api.startDischarge.mock.calls[0][1].discharge_at).toBe(new Date(at(10, 0, 41)).toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it("is still now when the admission was long before", async () => {
    try {
      const { api, dialog } = await dialogAt(at(10, 30, 20), at(8, 0));
      await send(dialog);
      expect(sentAt(api)).toBe(at(10, 30, 20));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DischargeDialog's local time", () => {
  it("reads a datetime-local value from its parts, in this browser's time, and nothing that is not one", () => {
    const ms = new Date(2026, 9, 25, 13, 30).getTime();
    expect(localInput(ms)).toBe("2026-10-25T13:30");
    expect(fromLocalInput("2026-10-25T13:30")).toBe(ms);
    expect(fromLocalInput(localInput(ms))).toBe(ms);
    for (const wrong of ["", "2026-02-30T10:00", "2026-13-01T10:00", "2026-10-25T24:00", "2026-10-25 13:30", "2026-10-25T13:30Z"]) {
      expect(fromLocalInput(wrong), wrong).toBeNaN();
    }
  });
});

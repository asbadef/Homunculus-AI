// The Taburcu tab (Group 2 · B1a, spec §3.3, §5.3): the discharges started, awaiting the charge
// nurse; the patients in, a physician's "Taburcuyu başlat" — held with its reason while the board
// shows a critical alarm nobody acknowledged — and the decision's dialog.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { alarm, board, entry } from "../../data/board.testutil.js";
import { DischargeTab } from "./DischargeTab.jsx";
import { CHARGE, DOCTOR, UUID_TEXT, mountKabul, row, settle, toasts } from "./kabul.testutil.js";

const ROWS = [
  row({ id: "a-1", patient_number: "H2600001", bed_label: "2", state: "ACTIVE" }),
  row({ id: "a-2", patient_number: "H2600002", bed_label: "5", room_name: "Otaq 2", state: "DRAFT", display_name: "Sentetik İki" }),
  row({ id: "a-3", patient_number: "H2600003", bed_label: "1", state: "PENDING_DISCHARGE", display_name: "Sentetik Üç",
    discharge_disposition: "OTHER_INSTITUTION", discharge_institution: "Sentetik Klinika", discharge_at: "2026-10-25T09:30:00Z" }),
];
const section = (name) => within(screen.getByRole("region", { name }));

async function open(perms, setup) {
  const mounted = await mountKabul(<DischargeTab />, { perms, setup: (api) => { api.admissions.mockResolvedValue(ROWS); setup?.(api); } });
  return mounted;
}

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
    expect(screen.getAllByRole("button", { name: "Evə yazılmanı başlat" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Xəstə çıxdı · təsdiqlə" })).toBeNull();
  });

  it.each([
    ["firing", {}],
    ["latched — resolved, nobody acknowledged it (G2-A1)", { resolved_at: "2026-10-25T09:00:00Z" }],
  ])("holds «Taburcuyu başlat», saying why, while a critical alarm is %s", async (_shape, over) => {
    const { api, board: store, stream } = await open(DOCTOR, (a) => {
      a.boardPatients.mockResolvedValue(board([entry("H2600001", [alarm("septic_shock", "critical", over)])]));
      a.streamTicket.mockResolvedValue({ ticket: "t-1" });
    });
    await act(async () => { await store.start(); stream.open(); });
    await settle();
    const start = screen.getByRole("button", { name: "Evə yazılmanı başlat" });
    expect(start.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Təsdiqlənməmiş kritik siqnal var: əvvəlcə siqnala baxın.")).toBeTruthy();
    fireEvent.click(start);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.startDischarge).not.toHaveBeenCalled();
  });

  it("does not hold it for an acknowledged critical alarm or a high one", async () => {
    const { board: store, stream } = await open(DOCTOR, (a) => {
      a.boardPatients.mockResolvedValue(board([entry("H2600001", [
        alarm("septic_shock", "critical", { acknowledged: true, acknowledged_by: "hekim" }), alarm("news2", "high")])]));
      a.streamTicket.mockResolvedValue({ ticket: "t-1" });
    });
    await act(async () => { await store.start(); stream.open(); });
    await settle();
    expect(screen.getByRole("button", { name: "Evə yazılmanı başlat" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("starts a discharge from the dialog: home, now, with the note", async () => {
    const { api } = await open(DOCTOR, (a) => a.startDischarge.mockResolvedValue({ id: "a-1", state: "PENDING_DISCHARGE" }));
    fireEvent.click(screen.getByRole("button", { name: "Evə yazılmanı başlat" }));
    const dialog = within(screen.getByRole("dialog", { name: "Evə yazılma · 2 · Reanimasiya" }));
    fireEvent.change(dialog.getByLabelText("Qeyd"), { target: { value: "Sentetik qeyd" } });
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Evə yazılmanı başlat" })); });
    await settle();
    expect(api.startDischarge).toHaveBeenCalledTimes(1);
    const [id, body] = api.startDischarge.mock.calls[0];
    expect(id).toBe("a-1");
    expect(body).toMatchObject({ disposition: "HOME", institution: null, reported_by: null, note: "Sentetik qeyd" });
    expect(Date.parse(body.discharge_at)).toBeLessThanOrEqual(Date.now());
    expect(toasts().getAllByText(/2 · Reanimasiya · evə yazılma başladıldı/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for the institution before it sends a transfer to another one", async () => {
    const { api } = await open(DOCTOR);
    fireEvent.click(screen.getByRole("button", { name: "Evə yazılmanı başlat" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByLabelText("Başqa müəssisəyə göndəriş"));
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Evə yazılmanı başlat" })); });
    expect(api.startDischarge).not.toHaveBeenCalled();
    expect(dialog.getByText("Göndərilən müəssisəni yazın.")).toBeTruthy();
  });

  it("puts the server's refusal on the toast by its code — an open critical alarm", async () => {
    await open(DOCTOR, (a) => a.startDischarge.mockRejectedValue(
      refusal(409, "Discharge blocked: 1 unacknowledged CRITICAL alert(s)…", { apiCode: "critical_alarm_open" })));
    fireEvent.click(screen.getByRole("button", { name: "Evə yazılmanı başlat" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Evə yazılmanı başlat" })); });
    await settle();
    expect(toasts().getAllByText(/2 · Reanimasiya: Təsdiqlənməmiş kritik siqnal var; evə yazılma başladıla bilməz/).length).toBeGreaterThan(0);
  });

  it("the charge nurse confirms a started discharge; the list and the beds are read again", async () => {
    const { api } = await open(CHARGE, (a) => a.confirmDischarge.mockResolvedValue({ id: "a-3", state: "DISCHARGED", board: "ok" }));
    const reads = api.admissions.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xəstə çıxdı · təsdiqlə" })); });
    await settle();
    expect(api.confirmDischarge).toHaveBeenCalledWith("a-3");
    expect(toasts().getAllByText("1 · Reanimasiya · evə yazılma təsdiqləndi; çarpayı təmizliyə verildi").length).toBeGreaterThan(0);
    expect(api.admissions.mock.calls.length).toBeGreaterThan(reads);
  });

  it("says so when the card did not leave the board", async () => {
    await open(CHARGE, (a) => a.confirmDischarge.mockResolvedValue({ id: "a-3", state: "DISCHARGED", board: "failed" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xəstə çıxdı · təsdiqlə" })); });
    await settle();
    expect(toasts().getAllByText(/kart paneldən götürülmədi/).length).toBeGreaterThan(0);
  });

  // Amendment A-9: an uncoded 404 ("Admission not found.") is said by its status, in the reader's
  // words — never the server's English.
  it.each([
    ["a started discharge", DOCTOR, "startDischarge", async () => {
      fireEvent.click(screen.getByRole("button", { name: "Evə yazılmanı başlat" }));
      await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Evə yazılmanı başlat" })); });
    }, "2 · Reanimasiya: Sorğu uğursuz oldu (404)."],
    ["a confirmation", CHARGE, "confirmDischarge", async () => {
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xəstə çıxdı · təsdiqlə" })); });
    }, "1 · Reanimasiya: Sorğu uğursuz oldu (404)."],
  ])("says an admission the server no longer finds by its status on %s, never in the server's English", async (_write, perms, call, press, said) => {
    await open(perms, (a) => a[call].mockRejectedValue(refusal(404, "Admission not found.")));
    await press();
    await settle();
    expect(toasts().getAllByText(said).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/not found/i);
  });
});

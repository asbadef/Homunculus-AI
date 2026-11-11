// The patient screen's reprint (G2-B1d, spec §6): only for `admissions.admit`, only for an open
// admission of the caller's units whose card this is, only when it has a protocol — a reprint, said
// so to the route. When the admissions could not be read at all, one muted line says so (Task 16
// review F-18) rather than the screen leaving the reader to wonder where the button went. Synthetic
// data only.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { refusal } from "../../../session/mount.testutil.jsx";
import { board, entry, identity, measured } from "../../../data/board.testutil.js";
import { answering } from "../../patient/trends/trends.testutil.js";
import { PatientScreen } from "../../patient/PatientScreen.jsx";
import { BED, DOCTOR, NURSE, REA, expectNoUuid, mountKabul, row, settle } from "../kabul.testutil.js";
import { LabelReprint } from "./LabelReprint.jsx";

const PROTOCOL = "202600000007";
const OPEN = [row({ id: "a-7", patient_number: "H2600007", protocol_no: PROTOCOL, board_key: PROTOCOL, state: "ACTIVE" })];
const LEGACY = [row({ id: "a-8", patient_number: "H2600008", state: "ACTIVE" })];
const REPRINT = "Etiketi yenidən çap et";
const UNREAD = "Etiketin yenidən çapı indi təklif oluna bilmir: qəbul siyahısı oxunmadı.";
const NAME = "Sentetik Hasta";
const LABEL = { protocol_no: PROTOCOL, display_name: NAME, date_of_birth: "1970-05-05", sex: "female",
  unit_name: "Reanimasiya", bed_label: "2", label: { width_mm: 50, height_mm: 30, printer_dpi: 203 } };

/** A stand-in for the print window: `written` is whatever page was written into it. */
function fakeWindow() {
  const written = [];
  const popup = { document: { open() {}, write: (html) => written.push(html), close() {} }, focus() {}, print() {}, close() {} };
  return { open: () => popup, written };
}

describe("LabelReprint", () => {
  it("offers the reprint of the card's own open admission, and asks for it as a reprint", async () => {
    const win = fakeWindow();
    const { api } = await mountKabul(<LabelReprint patientId={PROTOCOL} win={win} />, {
      perms: NURSE,
      setup: (a) => { a.admissions.mockResolvedValue(OPEN); a.admissionLabel.mockResolvedValue(LABEL); },
    });
    expect(api.admissions).toHaveBeenCalledWith(["DRAFT", "ACTIVE", "PENDING_DISCHARGE"]);
    expect(screen.queryByText(UNREAD)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: REPRINT })); });
    await settle();
    expect(api.admissionLabel).toHaveBeenCalledWith("a-7", true);
    // The name went to the print window and only there: not onto the screen the reprint stands on.
    expect(win.written.join("")).toContain(NAME);
    expect(document.body.textContent).not.toContain(NAME);
  });

  it("offers nothing for an admission without a protocol, nor for another card", async () => {
    await mountKabul(<LabelReprint patientId="H2600008" />, { perms: NURSE, setup: (a) => a.admissions.mockResolvedValue(LEGACY) });
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
    expect(screen.queryByText(UNREAD)).toBeNull();
    cleanup();                                     // the second mount stands alone, not beside the first
    await mountKabul(<LabelReprint patientId="202600000099" />, { perms: NURSE, setup: (a) => a.admissions.mockResolvedValue(OPEN) });
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
    expect(screen.queryByText(UNREAD)).toBeNull();
  });

  it("asks nothing and offers nothing to a session without admissions.admit", async () => {
    const { api } = await mountKabul(<LabelReprint patientId={PROTOCOL} />, {
      perms: DOCTOR, setup: (a) => a.admissions.mockResolvedValue(OPEN) });
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
    expect(api.admissions.mock.calls.some(([states]) => states?.includes("PENDING_DISCHARGE"))).toBe(false);
  });

  it("says in one muted line that the admissions could not be read — and offers no button it cannot back", async () => {
    await mountKabul(<LabelReprint patientId={PROTOCOL} />, {
      perms: NURSE, setup: (a) => a.admissions.mockRejectedValue(refusal(503, "Service Unavailable")) });
    const line = screen.getByText(UNREAD);
    expect(line.className).toContain("text-mute");
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
    expect(document.body.textContent).not.toContain("Service Unavailable");   // the server's words stay off the screen
    expectNoUuid();
  });

  it("says nothing to a session that may not read admissions — the read is not made, so none failed", async () => {
    const { api } = await mountKabul(<LabelReprint patientId={PROTOCOL} />, {
      perms: ["board.view", "admissions.admit"],
      setup: (a) => a.admissions.mockRejectedValue(refusal(503, "Service Unavailable")) });
    expect(api.admissions).not.toHaveBeenCalled();
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
  });

  // G2-B1c, Task 16 review: the patient screen reads the open admissions ONCE and hands the row of its card
  // and the read's phase; nothing is read here.
  it("reads nothing itself when handed the card's row: the reprint for one with a protocol, nothing for one without", async () => {
    const { api } = await mountKabul(<LabelReprint patientId={PROTOCOL} admission={OPEN[0]} phase="known" />, { perms: NURSE });
    expect(screen.getByRole("button", { name: REPRINT })).toBeTruthy();
    expect(api.admissions).not.toHaveBeenCalled();
    cleanup();
    await mountKabul(<LabelReprint patientId="H2600008" admission={LEGACY[0]} phase="known" />, { perms: NURSE });
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
    expect(screen.queryByText(UNREAD)).toBeNull();
    cleanup();
    await mountKabul(<LabelReprint patientId={PROTOCOL} admission={null} phase="known" />, { perms: NURSE });
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
    expect(screen.queryByText(UNREAD)).toBeNull();
  });

  it("says the unread line when the read it is handed failed outright, and not when it only went stale", async () => {
    await mountKabul(<LabelReprint patientId={PROTOCOL} admission={null} phase="failed" />, { perms: NURSE });
    expect(screen.getByText(UNREAD).className).toContain("text-mute");
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
    cleanup();
    await mountKabul(<LabelReprint patientId={PROTOCOL} admission={OPEN[0]} phase="stale" />, { perms: NURSE });
    expect(screen.queryByText(UNREAD)).toBeNull();
    expect(screen.getByRole("button", { name: REPRINT })).toBeTruthy();
  });

  it("asks nothing and offers nothing, handed a row, to a session without admissions.admit", async () => {
    await mountKabul(<LabelReprint patientId={PROTOCOL} admission={OPEN[0]} phase="known" />, { perms: DOCTOR });
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
  });

  it("stands on the patient screen of a protocol-keyed card", async () => {
    const card = entry(PROTOCOL, [], {
      identity: identity({ patient_id: PROTOCOL, display_name: "Sentetik Hasta", bed_label: "2", source: "kabul",
        bed_id: BED(2), unit_id: REA, bed_key: null }),
      at: measured(30),
    });
    const mounted = await mountKabul(<PatientScreen params={{ id: PROTOCOL }} />, {
      perms: NURSE,
      setup: (api) => {
        api.boardPatients.mockResolvedValue(board([card]));
        api.streamTicket.mockResolvedValue({ ticket: "t-1" });
        api.view.mockResolvedValue({ ok: true });
        api.patientTrends.mockImplementation(answering());
        api.admissions.mockResolvedValue(OPEN);
      },
    });
    await act(async () => { await mounted.board.start(); mounted.stream.open(); });
    await settle();
    expect(screen.getByRole("heading", { level: 1, name: "Sentetik Hasta" })).toBeTruthy();
    expect(screen.getByRole("button", { name: REPRINT })).toBeTruthy();
    expectNoUuid();
  });
});

// The patient screen's reprint (G2-B1d, spec §6): only for `admissions.admit`, only for an open
// admission of the caller's units whose card this is, only when it has a protocol — a reprint, said
// so to the route. Synthetic data only.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { board, entry, identity, measured } from "../../../data/board.testutil.js";
import { answering } from "../../patient/trends/trends.testutil.js";
import { PatientScreen } from "../../patient/PatientScreen.jsx";
import { BED, DOCTOR, NURSE, REA, expectNoUuid, mountKabul, row, settle } from "../kabul.testutil.js";
import { LabelReprint } from "./LabelReprint.jsx";

const PROTOCOL = "202600000007";
const OPEN = [row({ id: "a-7", patient_number: "H2600007", protocol_no: PROTOCOL, board_key: PROTOCOL, state: "ACTIVE" })];
const LEGACY = [row({ id: "a-8", patient_number: "H2600008", state: "ACTIVE" })];
const REPRINT = "Etiketi yenidən çap et";
const LABEL = { protocol_no: PROTOCOL, display_name: "Sentetik Hasta", date_of_birth: "1970-05-05", sex: "female",
  unit_name: "Reanimasiya", bed_label: "2", label: { width_mm: 50, height_mm: 30, printer_dpi: 203 } };

function fakeWindow() {
  const popup = { document: { open() {}, write() {}, close() {} }, focus() {}, print() {}, close() {} };
  return { open: () => popup };
}

describe("LabelReprint", () => {
  it("offers the reprint of the card's own open admission, and asks for it as a reprint", async () => {
    const { api } = await mountKabul(<LabelReprint patientId={PROTOCOL} win={fakeWindow()} />, {
      perms: NURSE,
      setup: (a) => { a.admissions.mockResolvedValue(OPEN); a.admissionLabel.mockResolvedValue(LABEL); },
    });
    expect(api.admissions).toHaveBeenCalledWith(["DRAFT", "ACTIVE", "PENDING_DISCHARGE"]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: REPRINT })); });
    await settle();
    expect(api.admissionLabel).toHaveBeenCalledWith("a-7", true);
  });

  it("offers nothing for an admission without a protocol, nor for another card", async () => {
    await mountKabul(<LabelReprint patientId="H2600008" />, { perms: NURSE, setup: (a) => a.admissions.mockResolvedValue(LEGACY) });
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
    await mountKabul(<LabelReprint patientId="202600000099" />, { perms: NURSE, setup: (a) => a.admissions.mockResolvedValue(OPEN) });
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
  });

  it("asks nothing and offers nothing to a session without admissions.admit", async () => {
    const { api } = await mountKabul(<LabelReprint patientId={PROTOCOL} />, {
      perms: DOCTOR, setup: (a) => a.admissions.mockResolvedValue(OPEN) });
    expect(screen.queryByRole("button", { name: REPRINT })).toBeNull();
    expect(api.admissions.mock.calls.some(([states]) => states?.includes("PENDING_DISCHARGE"))).toBe(false);
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

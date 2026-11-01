// SofaBox.test.jsx — the patient screen's SOFA box (G2-A4, D1, D7): the form's total, the organs it has no
// measurement for and the last signature, read through the board store for the patient shown; «Formanı açın»
// opens the form for THIS patient, and a signature is followed by a read that shows it. Synthetic values; the
// az texts.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { dayStamp } from "../../../i18n/dates.js";
import { SofaBox } from "./SofaBox.jsx";
import { SIGN_ARM_MS } from "./SofaFormModal.jsx";
import { LAST_SIGNED, WHY, previewAnswer, signedAnswer, sofaForm } from "./sofa.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ALL = ["board.view", "alerts.ack", "clinical.chart", "scores.sign"];
const SIGNED_AT = () => dayStamp(Date.parse(LAST_SIGNED.at), NOW);

async function open({ perms = ALL, setup, ui } = {}) {
  vi.setSystemTime(NOW);
  const mounted = await mount(ui ?? <SofaBox patientId="S-001" bed="REA-01 · 2" nowMs={NOW} />,
    { access: token({ perms }), me: profile({ perms }), setup });
  await act(async () => { await settle(); });
  return mounted;
}
const box = () => screen.getByRole("heading", { level: 2, name: "SOFA forması" }).closest(".rounded-box");
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });

describe("the SOFA box (D1)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("shows the form's total, the organs with no measurement and «İmzalanmayıb», and says it is not the Sepsis-3 SOFA", async () => {
    const { api } = await open({ setup: (a) => a.severityForm.mockResolvedValue(sofaForm()) });
    expect(api.severityForm).toHaveBeenCalledWith("S-001");
    expect(box()).toHaveTextContent("Forma cəmi 5 · 4 / 6 orqanda ölçmə yoxdur");
    expect(box()).toHaveTextContent("İmzalanmayıb.");
    expect(box()).toHaveTextContent("Sepsis-3 qutusundakı SOFA son dəyərlərlə hesablanır; ikisi eyni ədəd olmaya bilər.");
    expect(box()).toHaveTextContent(`${dayStamp(Date.parse("2026-10-08T10:00:00+00:00"), NOW)} oxunuşu.`);
  });

  it("names the last signature: who, when, the total, and how many corrections (D7)", async () => {
    await open({ setup: (a) => a.severityForm.mockResolvedValue(sofaForm({ last_signed: LAST_SIGNED })) });
    expect(box()).toHaveTextContent(`İmzalanıb · dr.elif · ${SIGNED_AT()} · cəmi 4 · 1 düzəlişlə`);
    cleanup();
    await open({ setup: (a) => a.severityForm.mockResolvedValue(sofaForm({ last_signed: { ...LAST_SIGNED, corrections: 0 } })) });
    expect(box()).toHaveTextContent(`İmzalanıb · dr.elif · ${SIGNED_AT()} · cəmi 4`);
    expect(box()).not.toHaveTextContent("düzəlişlə");
    cleanup();
    const { last_signed: _signed, ...older } = sofaForm();            // an engine older than G2-A4 (X15)
    await open({ setup: (a) => a.severityForm.mockResolvedValue(older) });
    expect(box()).not.toHaveTextContent("İmzalanmayıb");
    expect(box()).not.toHaveTextContent("İmzalanıb");
  });

  it("says when the engine sent no form and when it could not be read, and reads again on «Yenidən cəhd edin»", async () => {
    await open();                                                     // severityForm set up by nobody: it answers nothing
    expect(box()).toHaveTextContent("Mühərrik bu xəstə üçün SOFA forması göndərmədi.");
    cleanup();
    const { api } = await open({ setup: (a) => a.severityForm.mockRejectedValueOnce(refusal(500, "boom")).mockResolvedValueOnce(sofaForm()) });
    expect(box()).toHaveTextContent(/SOFA forması oxuna bilmədi: /);
    await press(within(box()).getByRole("button", { name: "Yenidən cəhd edin" }));
    expect(api.severityForm).toHaveBeenCalledTimes(2);
    expect(box()).toHaveTextContent("Forma cəmi 5");
  });

  it("opens the form for this patient, titled with the bed — for a board.view holder too, read-only (X10)", async () => {
    const { api } = await open({ perms: ["board.view", "alerts.ack"], setup: (a) => a.severityForm.mockResolvedValue(sofaForm()) });
    await press(within(box()).getByRole("button", { name: "Formanı açın" }));
    const dialog = screen.getByRole("dialog", { name: "SOFA forması · REA-01 · 2" });
    expect(api.severityForm).toHaveBeenCalledTimes(2);               // the box's read and the form's own (X9)
    expect(within(dialog).queryByRole("button", { name: "Öncədən baxın" })).toBeNull();
    expect(within(dialog).queryAllByRole("button", { name: /^Ölçmə daxil edin/ })).toHaveLength(0);
  });

  it("after a signature the box reads its form again and shows the new line", async () => {
    const { api } = await open({
      setup: (a) => {
        a.severityForm.mockResolvedValueOnce(sofaForm()).mockResolvedValueOnce(sofaForm())
          .mockResolvedValue(sofaForm({ last_signed: LAST_SIGNED }));
        a.signSeverityForm.mockImplementation((_id, { preview }) => Promise.resolve(preview ? previewAnswer() : signedAnswer()));
      },
    });
    await press(within(box()).getByRole("button", { name: "Formanı açın" }));
    const dialog = screen.getByRole("dialog", { name: "SOFA forması · REA-01 · 2" });
    await press(within(dialog).getByRole("button", { name: "Düzəldin: Trombosit sayı" }));
    const entry = within(dialog).getByRole("form", { name: "Trombosit sayı — düzəliş" });
    fireEvent.change(within(entry).getByLabelText(/Düzgün dəyər/), { target: { value: "80" } });
    fireEvent.change(within(entry).getByLabelText("Əsaslandırma"), { target: { value: WHY } });
    await press(within(entry).getByRole("button", { name: "Düzəlişi saxlayın" }));
    await press(within(dialog).getByRole("button", { name: "Öncədən baxın" }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, SIGN_ARM_MS)); });   // «İmzalayın» is armed
    await press(within(dialog).getByRole("button", { name: "İmzalayın" }));
    expect(api.signSeverityForm).toHaveBeenLastCalledWith("S-001", { overrides: [{ code: "platelets", value: 80, reason: WHY }] });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.severityForm).toHaveBeenCalledTimes(3);
    expect(box()).toHaveTextContent(`İmzalanıb · dr.elif · ${SIGNED_AT()} · cəmi 4`);
  });

  it("follows the patient shown: a form open on one is gone on the next, and a late read never lands on it", async () => {
    let go;
    function Harness() {
      const [id, setId] = React.useState("S-001");
      go = setId;
      return <SofaBox patientId={id} bed={id === "S-001" ? "REA-01 · 2" : "REA-01 · 3"} nowMs={NOW} />;
    }
    const late = [];
    await open({
      ui: <Harness />,
      setup: (a) => a.severityForm.mockImplementation((id) => (id === "S-001"
        ? new Promise((resolve) => { late.push(() => resolve(sofaForm({ total: 9 }))); })
        : Promise.resolve(sofaForm({ patient_id: "S-002", total: 2 })))),
    });
    await press(within(box()).getByRole("button", { name: "Formanı açın" }));
    expect(screen.getByRole("dialog", { name: "SOFA forması · REA-01 · 2" })).toBeInTheDocument();
    await act(async () => { go("S-002"); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(box()).toHaveTextContent("Forma cəmi 2");
    await act(async () => { late.forEach((release) => release()); await settle(); });
    expect(box()).toHaveTextContent("Forma cəmi 2");
    expect(box()).not.toHaveTextContent("Forma cəmi 9");
  });
});

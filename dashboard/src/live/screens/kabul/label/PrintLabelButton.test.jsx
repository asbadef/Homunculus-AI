// «Etiketi çap et» (G2-B1d, spec §6): the window opens in the click, before the request — a window
// opened after an await is a pop-up the browser blocks — then the label's route is asked, a first
// print or a reprint, and the page written into it. A blocked window or a refusal says so on the
// toast; a refused label closes its window. Synthetic data only.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NURSE, settle, toasts } from "../kabul.testutil.js";
import { PrintLabelButton } from "./PrintLabelButton.jsx";

const LABEL = {
  protocol_no: "202600000001", display_name: "Test Hasta", date_of_birth: "1970-05-05", sex: "female",
  unit_name: "Reanimasiya", bed_label: "1", label: { width_mm: 50, height_mm: 30, printer_dpi: 203 },
};

// A browser window that has been closed answers `closed: true`, and reading its `document` is a
// TypeError (the engine's English text, if it ever reached a toast) — the fake does both.
function fakeWindow() {
  const doc = { open: vi.fn(), write(s) { popup.html += s; }, close: vi.fn() };
  const popup = { html: "", closed: false, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
  Object.defineProperty(popup, "document", {
    configurable: true,
    get() {
      if (popup.closed) throw new TypeError("Cannot read properties of null (reading 'open')");
      return doc;
    },
  });
  return { popup, win: { open: vi.fn(() => popup) } };
}

async function mounted(ui, setup) {
  const m = await mount(ui, { access: token({ perms: NURSE }), me: profile({ perms: NURSE }), setup });
  await settle();
  return m;
}

describe("PrintLabelButton", () => {
  it("opens the window first, asks the label, and prints it", async () => {
    const { popup, win } = fakeWindow();
    const { api } = await mounted(<PrintLabelButton admissionId="a-1" win={win} />,
      (a) => a.admissionLabel.mockResolvedValue(LABEL));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Etiketi çap et" })); });
    await settle();
    expect(win.open).toHaveBeenCalledTimes(1);
    expect(win.open.mock.invocationCallOrder[0]).toBeLessThan(api.admissionLabel.mock.invocationCallOrder[0]);
    expect(api.admissionLabel).toHaveBeenCalledWith("a-1", false);
    expect(popup.html).toContain("Test Hasta");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(popup.print).toHaveBeenCalledTimes(1);
  });

  it("a reprint says so, to the reader and to the route", async () => {
    const { win } = fakeWindow();
    const { api } = await mounted(<PrintLabelButton admissionId="a-1" reprint win={win} />,
      (a) => a.admissionLabel.mockResolvedValue(LABEL));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Etiketi yenidən çap et" })); });
    await settle();
    expect(api.admissionLabel).toHaveBeenCalledWith("a-1", true);
  });

  it("a blocked window asks nothing and says how to allow it", async () => {
    const { api } = await mounted(<PrintLabelButton admissionId="a-1" win={{ open: () => null }} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Etiketi çap et" })); });
    await settle();
    expect(api.admissionLabel).not.toHaveBeenCalled();
    expect(toasts().getAllByText("Çap pəncərəsi açılmadı; brauzerdə bu saytın açılan pəncərələrinə icazə verin.").length)
      .toBeGreaterThan(0);
  });

  // Task 13 review F-10: the label's route is audited when it answers; a window the reader closed while
  // it was on its way must not be written to (a TypeError, and its English text on the toast).
  it("a window closed while the label was on its way is not printed to, and says so in the reader's words", async () => {
    const { popup, win } = fakeWindow();
    const { api } = await mounted(<PrintLabelButton admissionId="a-1" win={win} />,
      (a) => a.admissionLabel.mockImplementation(async () => { popup.closed = true; return LABEL; }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Etiketi çap et" })); });
    await settle();
    expect(api.admissionLabel).toHaveBeenCalledTimes(1);
    expect(popup.html).toBe("");
    expect(popup.print).not.toHaveBeenCalled();
    expect(toasts().getAllByText("Çap pəncərəsi etiket gələnədək bağlandı; etiket çap olunmadı. Düyməni yenidən basın.").length)
      .toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Cannot read|TypeError|Etiket alınmadı/);
    // …and the button is usable again.
    expect(screen.getByRole("button", { name: "Etiketi çap et" }).getAttribute("aria-busy")).not.toBe("true");
  });

  it("a window that fails after the label arrived says the same, in the reader's words", async () => {
    const { popup, win } = fakeWindow();
    popup.print = vi.fn();
    Object.defineProperty(popup, "document", { get() { throw new TypeError("Cannot read properties of null (reading 'open')"); } });
    await mounted(<PrintLabelButton admissionId="a-1" win={win} />, (a) => a.admissionLabel.mockResolvedValue(LABEL));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Etiketi çap et" })); });
    await settle();
    expect(toasts().getAllByText("Çap pəncərəsi etiket gələnədək bağlandı; etiket çap olunmadı. Düyməni yenidən basın.").length)
      .toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Cannot read|TypeError/);
  });

  it("a refused label closes its window and says why, in the reader's words", async () => {
    const { popup, win } = fakeWindow();
    await mounted(<PrintLabelButton admissionId="a-1" win={win} />, (a) => a.admissionLabel.mockRejectedValue(
      refusal(409, "This admission has no protocol number, so no label.", { apiCode: "no_protocol" })));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Etiketi çap et" })); });
    await settle();
    expect(popup.close).toHaveBeenCalled();
    expect(toasts().getAllByText("Etiket alınmadı: Bu qəbulun protokol nömrəsi yoxdur: etiket çap oluna bilməz.").length)
      .toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/no protocol number/);
  });
});

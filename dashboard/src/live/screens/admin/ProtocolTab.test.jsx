// Yönetim › Protokol ve etiket (G2-B1d, spec §3, §6, D5): the start number set, forward only; the
// label's size and dpi held to the barcode's fit before anything is sent; a refusal said by its
// code and the settings read again; the test label synthetic and sent nowhere. The start number is
// held to the engine's own case table (A-1: twelve ASCII digits, and not 000000000000 — the number
// the test label prints). Synthetic data only.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { ADMIN, UUID_TEXT, settle, toasts } from "../kabul/kabul.testutil.js";
import { ProtocolTab } from "./ProtocolTab.jsx";

// (Paths built with node:path: under jsdom the global URL is jsdom's — apiErrors.test.js.)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLE = JSON.parse(fs.readFileSync(
  path.resolve(HERE, "../../../../../homunculus-engine/tests/label_fit_cases.json"), "utf8"));

const UNSET = { configured: false, next_no: null, last_issued: null, label_width_mm: 50, label_height_mm: 30,
  printer_dpi: 203, updated_at: null };
const SET = { ...UNSET, configured: true, next_no: "202600000042", last_issued: "202600000041",
  updated_at: "2026-11-01T08:00:00Z" };

async function mounted(setup, props = {}) {
  const m = await mount(<ProtocolTab {...props} />, {
    access: token({ perms: ADMIN }), me: profile({ perms: ADMIN }), setup,
  });
  await settle();
  return m;
}

const nextNo = () => screen.getByLabelText(/^Növbəti protokol nömrəsi/);
const width = () => screen.getByLabelText(/^Etiketin eni/);
const save = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); });
  await settle();
};

describe("ProtocolTab", () => {
  it("says no admission can be made until a start number is set", async () => {
    await mounted((a) => a.protocolSettings.mockResolvedValue(UNSET));
    expect(screen.getByText("Başlanğıc nömrəsi daxil edilməyib: daxil edilənədək heç bir qəbul aparıla bilməz.")).toBeTruthy();
    expect(screen.getByText("Hələ nömrə verilməyib.")).toBeTruthy();
    expect(nextNo().value).toBe("");
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("sets the start number and the label, and says so", async () => {
    const { api } = await mounted((a) => {
      a.protocolSettings.mockResolvedValue(UNSET);
      a.saveProtocolSettings.mockResolvedValue({ ...UNSET, configured: true, next_no: "202600000001" });
    });
    fireEvent.change(nextNo(), { target: { value: "202600000001" } });
    await save();
    expect(api.saveProtocolSettings).toHaveBeenCalledWith(
      { next_no: "202600000001", label_width_mm: 50, label_height_mm: 30, printer_dpi: 203 });
    expect(toasts().getAllByText("Protokol və etiket ayarları yadda saxlanıldı.").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Başlanğıc nömrəsi daxil edilməyib/)).toBeNull();
  });

  it("shows the last number issued and the number the next admission takes", async () => {
    await mounted((a) => a.protocolSettings.mockResolvedValue(SET));
    expect(screen.getByText("Verilən son nömrə: 202600000041")).toBeTruthy();
    expect(nextNo().value).toBe("202600000042");
  });

  it("sends nothing until the number is twelve digits, and says what it takes", async () => {
    const { api } = await mounted((a) => a.protocolSettings.mockResolvedValue(UNSET));
    for (const typed of ["2026", "20260000000A", "２０２６００００００１"]) {
      fireEvent.change(nextNo(), { target: { value: typed } });
      await save();
    }
    expect(api.saveProtocolSettings).not.toHaveBeenCalled();
    expect(screen.getByText("12 rəqəm daxil edin.")).toBeTruthy();
  });

  it("holds a label the barcode does not fit, by the engine's own rule, and names the narrowest", async () => {
    const { api } = await mounted((a) => a.protocolSettings.mockResolvedValue(SET));
    expect(screen.getByText("Barkod sığır: bu ayırdetmədə ən azı 49 mm en lazımdır.")).toBeTruthy();
    fireEvent.change(width(), { target: { value: "48" } });
    expect(screen.getByText("Barkod bu enə sığmır: ən azı 49 mm lazımdır.")).toBeTruthy();
    await save();
    expect(api.saveProtocolSettings).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Printerin ayırdetməsi/), { target: { value: "300" } });
    expect(screen.getByText("Barkod sığır: bu ayırdetmədə ən azı 44 mm en lazımdır.")).toBeTruthy();
  });

  it("says a forward-only refusal by its code and reads the settings again", async () => {
    const { api } = await mounted((a) => {
      a.protocolSettings.mockResolvedValue(SET);
      a.saveProtocolSettings.mockRejectedValue(refusal(409, "The next protocol number must be greater than the last one issued.",
        { apiCode: "protocol_not_forward" }));
    });
    fireEvent.change(nextNo(), { target: { value: "202600000040" } });
    await save();
    expect(toasts().getAllByText(/Bu nömrə geri gedir: verilən son nömrədən böyük olmalıdır/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/must be greater/);
    expect(api.protocolSettings).toHaveBeenCalledTimes(2);
    expect(nextNo().value).toBe("202600000042");
  });

  it("prints a synthetic test label in the size on screen, and asks the server nothing", async () => {
    let html = "";
    const popup = { document: { open() {}, write(s) { html += s; }, close() {} }, focus() {}, print: vi.fn() };
    const { api } = await mounted((a) => a.protocolSettings.mockResolvedValue(SET), { win: { open: () => popup } });
    fireEvent.change(width(), { target: { value: "60" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sınaq etiketi çap et" })); });
    await settle();
    expect(html).toContain("000000000000");
    expect(html).toContain("SINAQ ETİKETİ");
    expect(html).toContain("@page { size: 60mm 30mm; margin: 0; }");
    expect(api.admissionLabel).not.toHaveBeenCalled();
    expect(api.saveProtocolSettings).not.toHaveBeenCalled();
  });

  it("says the settings could not be read, in the reader's words", async () => {
    await mounted((a) => a.protocolSettings.mockRejectedValue(refusal(503, "Service Unavailable")));
    expect(screen.getByText(/^Ayarlar oxunmadı: /)).toBeTruthy();
  });
});

// A-1: the client holds the server's rule before it sends, and one table pins both — the engine's
// tests/label_fit_cases.json `next_no_cases`.
describe("ProtocolTab — the start number, on the engine's own case table (A-1)", () => {
  it("is read: the table holds the start-number cases, 000000000000 refused among them", () => {
    expect(TABLE.next_no_cases.length).toBeGreaterThanOrEqual(10);
    expect(TABLE.next_no_cases.find((c) => c.next_no === "000000000000")?.answer).toBe("protocol_format");
    expect(TABLE.next_no_cases.find((c) => c.next_no === "000000000001")?.answer).toBeNull();
  });

  it.each(TABLE.next_no_cases.map((c) => [JSON.stringify(c.next_no), c]))("%s", async (_name, c) => {
    const { api } = await mounted((a) => {
      a.protocolSettings.mockResolvedValue(UNSET);
      a.saveProtocolSettings.mockResolvedValue({ ...UNSET, configured: true, next_no: c.next_no });
    });
    fireEvent.change(nextNo(), { target: { value: c.next_no } });
    await save();
    if (c.answer === null) {
      expect(api.saveProtocolSettings).toHaveBeenCalledTimes(1);
      expect(api.saveProtocolSettings).toHaveBeenCalledWith(expect.objectContaining({ next_no: c.next_no }));
    } else {
      expect(c.answer).toBe("protocol_format");
      expect(api.saveProtocolSettings).not.toHaveBeenCalled();
      expect(document.querySelector("[id$='-error']")).not.toBeNull();
    }
  });

  it("says twelve zeros are not enough: the number must be at least 000000000001", async () => {
    const { api } = await mounted((a) => a.protocolSettings.mockResolvedValue(UNSET));
    fireEvent.change(nextNo(), { target: { value: "000000000000" } });
    await save();
    expect(api.saveProtocolSettings).not.toHaveBeenCalled();
    expect(screen.getByText("Başlanğıc nömrəsi ən azı 000000000001 olmalıdır.")).toBeTruthy();
    expect(screen.queryByText("12 rəqəm daxil edin.")).toBeNull();
  });
});

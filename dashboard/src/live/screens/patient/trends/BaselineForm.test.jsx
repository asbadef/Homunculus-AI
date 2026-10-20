// The patient's own normal: what the form holds back, what it sends, and what the clinician reads
// after — the confirmation AND the absence of any alert on success (amendments (a)), the bed-named
// refusal on the toast and never inline, the may-have-landed rule on no answer.
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { BASELINE_KEYS, BaselineForm } from "./BaselineForm.jsx";

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../homunculus-engine/src/homunculus");
const CHARTABLE = ["board.view", "alerts.ack", "clinical.chart"];
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

async function open({ own = {}, answer } = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const mounted = await mount(<BaselineForm patient={PATIENT} bed="REA-01 · 2" own={own} onClose={onClose} onSaved={onSaved} />, {
    access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }),
    setup: (api) => api.putPatientProfile.mockImplementation(answer ?? (() => Promise.resolve({ patient_id: "S-001" }))),
  });
  return { ...mounted, onClose, onSaved };
}
const dialog = () => screen.getByRole("dialog", { name: "Xəstənin norması" });
const row = (key) => dialog().querySelector(`[data-baseline='${key}']`);
const type = (key, side, value) => fireEvent.change(within(row(key)).getByLabelText(side === "low" ? "alt" : "üst"), { target: { value } });
const save = () => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Yadda saxla" })); await settle(); });
const toastText = () => document.body.textContent;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the patient's own normal", () => {
  it("offers exactly the vitals the engine keeps a baseline for (api/clinical.py BASELINE_SIGNALS)", () => {
    const source = fs.readFileSync(path.join(ENGINE, "api", "clinical.py"), "utf8");
    const block = /BASELINE_SIGNALS[^{]*\{([^}]*)\}/.exec(source)[1];
    expect([...block.matchAll(/"(\w+)":/g)].map((m) => m[1]).sort()).toEqual([...BASELINE_KEYS].sort());
  });

  it("opens with what is charted, says it is not a monitor alarm, and says an emptied range is deleted", async () => {
    await open({ own: { heart_rate: { low: 100, high: 115 } } });
    expect(within(row("heart_rate")).getByLabelText("alt")).toHaveValue("100");
    expect(within(row("heart_rate")).getByLabelText("üst")).toHaveValue("115");
    expect(within(row("spo2")).getByLabelText("alt")).toHaveValue("");
    expect(dialog()).toHaveTextContent("Bu aralıqlar monitorun siqnal həddi deyil");
    expect(dialog()).toHaveTextContent("Boş saxlanılan aralıq silinir. Yanaşı xəstəliklər və bazal SOFA dəyişmir.");
  });

  it("holds one side without the other, in words, and sends nothing", async () => {
    const { api } = await open();
    type("spo2", "low", "88");
    await save();
    expect(within(row("spo2")).getByText("hər iki hədd lazımdır")).toBeInTheDocument();
    expect(api.putPatientProfile).not.toHaveBeenCalled();
  });

  it("holds low above high and a bound that is not a number, as the engine would refuse them", async () => {
    const { api } = await open();
    type("heart_rate", "low", "120");
    type("heart_rate", "high", "100");
    type("temperature", "low", "otuz");
    type("temperature", "high", "37");
    await save();
    expect(within(row("heart_rate")).getByText("alt hədd üst həddən böyükdür")).toBeInTheDocument();
    expect(within(row("temperature")).getByText("ədəd daxil edin")).toBeInTheDocument();
    expect(api.putPatientProfile).not.toHaveBeenCalled();
  });

  it("sends the whole filled set — the charted pairs too, a decimal comma as a point — and nothing but baselines", async () => {
    const { api } = await open({ own: { heart_rate: { low: 100, high: 115 } } });
    type("temperature", "low", "36,0");
    type("temperature", "high", "37.5");
    await save();
    expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", {
      baselines: { heart_rate: { low: 100, high: 115 }, temperature: { low: 36, high: 37.5 } },
    });
  });

  it("does not send an emptied pair: the engine deletes it", async () => {
    const { api } = await open({ own: { heart_rate: { low: 100, high: 115 }, resp_rate: { low: 12, high: 22 } } });
    type("heart_rate", "low", "");
    type("heart_rate", "high", "");
    await save();
    expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", { baselines: { resp_rate: { low: 12, high: 22 } } });
  });

  it("with nothing to send, Save says why, stays focusable and sends nothing", async () => {
    const { api } = await open();
    const button = within(dialog()).getByRole("button", { name: "Yadda saxla" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(dialog()).toHaveTextContent("Göndəriləcək aralıq yoxdur");
    await save();
    expect(api.putPatientProfile).not.toHaveBeenCalled();
  });

  it("every row emptied over a charted set: Save is offered, says it deletes every range, and sends an empty set", async () => {
    const { api } = await open({ own: { heart_rate: { low: 100, high: 115 } } });
    type("heart_rate", "low", "");
    type("heart_rate", "high", "");
    const button = within(dialog()).getByRole("button", { name: "Yadda saxla" });
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(dialog()).toHaveTextContent("Bütün sətirlər boşdur: «Yadda saxla» bu xəstənin daxil edilmiş bütün aralıqlarını silir.");
    expect(dialog()).not.toHaveTextContent("Göndəriləcək aralıq yoxdur");
    await save();
    expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", { baselines: {} });
  });

  it("a clear the engine took: the confirmation says every range is deleted, the trends are read again, the form closes", async () => {
    const { onClose, onSaved } = await open({ own: { heart_rate: { low: 100, high: 115 } } });
    type("heart_rate", "low", "");
    type("heart_rate", "high", "");
    await save();
    expect(screen.getAllByText("Xəstənin bütün aralıqları silindi; növbəti ölçmə onlarsız qiymətləndiriləcək.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Xəstənin norması yadda saxlanıldı; mühərrik yenidən qiymətləndirdi.")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("with nothing charted, a row typed and emptied again leaves nothing to clear: Save stays aria-disabled", async () => {
    const { api } = await open({ own: { heart_rate: null, spo2: null } });
    type("spo2", "low", "88");
    type("spo2", "low", "");
    const button = within(dialog()).getByRole("button", { name: "Yadda saxla" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(dialog()).toHaveTextContent("Göndəriləcək aralıq yoxdur");
    expect(dialog()).not.toHaveTextContent("bütün aralıqlarını silir");
    await save();
    expect(api.putPatientProfile).not.toHaveBeenCalled();
  });

  it("a save the engine took: the confirmation, the trends read again, the form closed — and no alert", async () => {
    const { onClose, onSaved } = await open({ own: { heart_rate: { low: 100, high: 115 } } });
    await save();
    expect(screen.getAllByText("Xəstənin norması yadda saxlanıldı; mühərrik yenidən qiymətləndirdi.").length).toBeGreaterThan(0);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("alert").map((a) => a.textContent).join(" ").trim()).toBe("");
  });

  it("a refusal goes on the toast, named after the bed and never inline, and the form stays open", async () => {
    const refused = Object.assign(new Error("profil boş olamaz — komorbidite, bazal aralık veya bazal SOFA gerekir"), { status: 400 });
    const { onClose, onSaved } = await open({ own: { heart_rate: { low: 100, high: 115 } }, answer: () => Promise.reject(refused) });
    await save();
    expect(toastText()).toContain("REA-01 · 2: xəstənin norması yadda saxlanılmadı — profil boş olamaz");
    expect(within(dialog()).queryAllByRole("alert")).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a right taken away meanwhile (403): the toast says so, and the form closes", async () => {
    const refused = Object.assign(new Error("permission required: clinical.chart"), { status: 403 });
    const { onClose } = await open({ own: { heart_rate: { low: 100, high: 115 } }, answer: () => Promise.reject(refused) });
    await save();
    expect(toastText()).toContain("REA-01 · 2: xəstənin norması yadda saxlanılmadı — bu əməliyyat üçün artıq səlahiyyətiniz yoxdur (clinical.chart)");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("no answer: it may have landed — the trends are read again and the clinician is told to look at the band", async () => {
    const silent = Object.assign(new Error("Sunucu yanıt vermedi."), { code: "REQUEST_TIMEOUT" });
    const { onClose, onSaved } = await open({ own: { heart_rate: { low: 100, high: 115 } }, answer: () => Promise.reject(silent) });
    await save();
    expect(toastText()).toContain("REA-01 · 2: server cavab vermədi; xəstənin norması yadda saxlanılmış ola bilər — qrafikdəki zolağı yoxlayın.");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("while in flight: Save is busy and says so, the fields are read-only, and the dialog will not close", async () => {
    const { onClose } = await open({ own: { heart_rate: { low: 100, high: 115 } }, answer: () => new Promise(() => {}) });
    await save();
    const button = within(dialog()).getByRole("button", { name: "Yadda saxla" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(within(row("heart_rate")).getByLabelText("alt")).toHaveAttribute("readonly");
    await wait(200);
    expect(within(dialog()).getAllByRole("status").map((s) => s.textContent)).toContain("Xəstənin norması yadda saxlanılır…");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

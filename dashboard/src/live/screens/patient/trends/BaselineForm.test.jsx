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
import { BASELINE_KEYS, BaselineForm, checkBaselines } from "./BaselineForm.jsx";

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../homunculus-engine/src/homunculus");
const CHARTABLE = ["board.view", "alerts.ack", "clinical.chart"];
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const HR = { heart_rate: { low: 100, high: 115 } };
// What the clinician hears for each vital, in front of "alt" / "üst" (the fieldset's legend is not
// read in a screen reader's list of fields, so every field's own name says whose range it is).
const NAMES = { heart_rate: "Nəbz", resp_rate: "Tənəffüs", spo2: "SpO2", sbp: "Sistolik AT", temperature: "Bədən hərarəti" };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

/** The form on a session that may chart. `setOwn` plays the trends poll handing it a new set. */
async function open({ own = {}, answer } = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  let change;
  function Harness() {
    const [current, setCurrent] = React.useState(own);
    change = setCurrent;
    return <BaselineForm patient={PATIENT} bed="REA-01 · 2" own={current} onClose={onClose} onSaved={onSaved} />;
  }
  const mounted = await mount(<Harness />, {
    access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }),
    setup: (api) => api.putPatientProfile.mockImplementation(answer ?? (() => Promise.resolve({ patient_id: "S-001" }))),
  });
  return { ...mounted, onClose, onSaved, setOwn: (next) => act(async () => { change(next); await settle(); }) };
}
const dialog = () => screen.getByRole("dialog", { name: "Xəstənin norması · REA-01 · 2" });
const row = (key) => dialog().querySelector(`[data-baseline='${key}']`);
const input = (key, side) => within(row(key)).getByLabelText(`${NAMES[key]} ${side === "low" ? "alt" : "üst"}`);
const type = (key, side, value) => fireEvent.change(input(key, side), { target: { value } });
const saveButton = () => within(dialog()).getByRole("button", { name: "Yadda saxla" });
const save = () => act(async () => { fireEvent.click(saveButton()); await settle(); });
const toastText = () => document.body.textContent;
const emptyRow = (key) => { type(key, "low", ""); type(key, "high", ""); };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("what the form holds back (checkBaselines)", () => {
  const rows = (low, high, key = "heart_rate") => ({ [key]: { low, high } });
  const problem = (low, high) => checkBaselines(rows(low, high)).errors.heart_rate;

  it("reads a decimal comma as a point, and ignores the whitespace around a number", () => {
    expect(checkBaselines(rows("36,5", " 37.5 ", "temperature")).baselines).toEqual({ temperature: { low: 36.5, high: 37.5 } });
  });

  it("refuses a number with a space inside it, an exponent, a plus sign, a bare point and a Unicode minus", () => {
    for (const bad of ["1 00", "1e3", "+5", ".5", "5.", "−5", "0x10", "12abc", "1,2,3"]) {
      expect(problem(bad, "200"), bad).toEqual({ side: "low", key: "patient.baselineNotNumber" });
    }
  });

  it("tells an empty bound from a zero: 0 is a bound, an empty string is none", () => {
    expect(checkBaselines(rows("0", "5")).baselines).toEqual({ heart_rate: { low: 0, high: 5 } });
    expect(checkBaselines(rows("", "5")).errors.heart_rate).toEqual({ side: "low", key: "patient.baselineBothOrNeither" });
    expect(checkBaselines(rows("5", "  ")).errors.heart_rate).toEqual({ side: "high", key: "patient.baselineBothOrNeither" });
    expect(checkBaselines(rows("", "  "))).toEqual({ errors: {}, baselines: {} });
  });

  it("takes low equal to high, and negatives, and holds low above high", () => {
    expect(checkBaselines(rows("90", "90")).baselines).toEqual({ heart_rate: { low: 90, high: 90 } });
    expect(checkBaselines(rows("-5", "-2")).baselines).toEqual({ heart_rate: { low: -5, high: -2 } });
    expect(problem("-2", "-5")).toEqual({ side: "low", key: "patient.baselineLowAboveHigh" });
    expect(problem("91", "90")).toEqual({ side: "low", key: "patient.baselineLowAboveHigh" });
  });

  it("refuses a number too large to be one: it would travel as null and reach the engine as a refusal in another tongue", () => {
    const huge = "9".repeat(400);
    expect(problem(huge, "5")).toEqual({ side: "low", key: "patient.baselineNotNumber" });
    expect(problem("5", huge)).toEqual({ side: "high", key: "patient.baselineNotNumber" });
  });
});

describe("the patient's own normal", () => {
  it("offers exactly the vitals the engine keeps a baseline for (api/clinical.py BASELINE_SIGNALS)", () => {
    const source = fs.readFileSync(path.join(ENGINE, "api", "clinical.py"), "utf8");
    const block = /BASELINE_SIGNALS[^{]*\{([^}]*)\}/.exec(source)[1];
    expect([...block.matchAll(/"(\w+)":/g)].map((m) => m[1]).sort()).toEqual([...BASELINE_KEYS].sort());
  });

  it("names the bed in its title, so a form that outlives a glance still says whose ranges these are", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 2, name: "Xəstənin norması · REA-01 · 2" })).toBeInTheDocument();
  });

  it("opens with what is charted, says it is not a monitor alarm, and says an emptied range is deleted", async () => {
    await open({ own: HR });
    expect(input("heart_rate", "low")).toHaveValue("100");
    expect(input("heart_rate", "high")).toHaveValue("115");
    expect(input("spo2", "low")).toHaveValue("");
    expect(dialog()).toHaveTextContent("Bu aralıqlar monitorun siqnal həddi deyil");
    expect(dialog()).toHaveTextContent("Boş saxlanılan aralıq silinir. Yanaşı xəstəliklər və bazal SOFA dəyişmir.");
  });

  it("names the vital in each field, so a list of fields or a voice command can tell ten of them apart", async () => {
    await open();
    expect(within(dialog()).getAllByLabelText(/ alt$/)).toHaveLength(5);
    expect(within(dialog()).getAllByLabelText(/ üst$/)).toHaveLength(5);
    expect(within(dialog()).queryAllByLabelText(/^(alt|üst)$/)).toHaveLength(0);
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

  it("after a held submit, focus is on the side that is wrong and a screen reader is told what is wrong with it", async () => {
    await open();
    type("spo2", "low", "88");
    await save();
    expect(document.activeElement).toBe(input("spo2", "high"));
    expect(input("spo2", "high")).toHaveAccessibleDescription("hər iki hədd lazımdır");
    expect(input("spo2", "high")).toHaveAttribute("aria-invalid", "true");
  });

  it("puts focus on the FIRST wrong row in the order the form lists them, not the first one typed", async () => {
    await open();
    type("temperature", "low", "otuz");
    type("temperature", "high", "37");
    type("heart_rate", "low", "120");
    type("heart_rate", "high", "100");
    await save();
    expect(document.activeElement).toBe(input("heart_rate", "low"));
    expect(input("heart_rate", "low")).toHaveAccessibleDescription("alt hədd üst həddən böyükdür");
  });

  it("sends the whole filled set — the charted pairs too, a decimal comma as a point — and nothing but baselines", async () => {
    const { api } = await open({ own: HR });
    type("temperature", "low", "36,0");
    type("temperature", "high", "37.5");
    await save();
    expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", {
      baselines: { heart_rate: { low: 100, high: 115 }, temperature: { low: 36, high: 37.5 } },
    });
  });

  it("does not send an emptied pair: the engine deletes it", async () => {
    const { api } = await open({ own: { heart_rate: { low: 100, high: 115 }, resp_rate: { low: 12, high: 22 } } });
    emptyRow("heart_rate");
    await save();
    expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", { baselines: { resp_rate: { low: 12, high: 22 } } });
  });

  it("saves on Enter: the fields are a form, with a submit of its own that a browser presses for Enter", async () => {
    const { api } = await open({ own: HR });
    const form = dialog().querySelector("form");
    expect(form).not.toBeNull();
    expect(form.querySelector("button[type='submit']")).not.toBeNull();
    await act(async () => { fireEvent.submit(form); await settle(); });
    expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", { baselines: HR });
  });

  it("sends once however fast Save is pressed twice", async () => {
    const { api } = await open({ own: HR, answer: () => new Promise(() => {}) });
    const button = saveButton();
    await act(async () => { fireEvent.click(button); fireEvent.click(button); await settle(); });
    expect(api.putPatientProfile).toHaveBeenCalledTimes(1);
  });

  describe("what Save is about to do, in the footer beside it", () => {
    it("with nothing to send, Save says why — in its description — stays focusable and sends nothing", async () => {
      const { api } = await open();
      const button = saveButton();
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
      expect(button).toHaveAccessibleDescription(/Göndəriləcək aralıq yoxdur/);
      expect(button.parentElement).toContainElement(screen.getByText(/Göndəriləcək aralıq yoxdur/));
      await save();
      expect(api.putPatientProfile).not.toHaveBeenCalled();
    });

    it("the reason is quiet until Save has been pressed, and then it is the attention tone", async () => {
      await open();
      expect(screen.getByText(/Göndəriləcək aralıq yoxdur/)).toHaveClass("text-mute");
      await save();
      expect(screen.getByText(/Göndəriləcək aralıq yoxdur/)).toHaveClass("text-att-ink");
    });

    it("every row emptied over a charted set: Save is offered, is the danger button, and says in its description that it deletes every range", async () => {
      const { api } = await open({ own: HR });
      expect(saveButton().classList.contains("bg-pri")).toBe(true);
      expect(saveButton()).not.toHaveAccessibleDescription(/silir/);
      emptyRow("heart_rate");
      const button = saveButton();
      expect(button).not.toHaveAttribute("aria-disabled");
      expect(button.classList.contains("bg-crit")).toBe(true);
      expect(button).toHaveAccessibleDescription("Bütün sətirlər boşdur: «Yadda saxla» bu xəstənin daxil edilmiş bütün aralıqlarını silir.");
      expect(button.parentElement).toContainElement(screen.getByText(/bütün aralıqlarını silir/));
      expect(dialog()).not.toHaveTextContent("Göndəriləcək aralıq yoxdur");
      await save();
      expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", { baselines: {} });
    });

    it("says that it deletes every range once, to a screen reader, the moment the last row is emptied", async () => {
      await open({ own: HR });
      expect(within(dialog()).getAllByRole("status").map((s) => s.textContent).join(" ")).not.toMatch(/silir/);
      emptyRow("heart_rate");
      await wait(200);
      expect(within(dialog()).getAllByRole("status").map((s) => s.textContent))
        .toContain("Bütün sətirlər boşdur: «Yadda saxla» bu xəstənin daxil edilmiş bütün aralıqlarını silir.");
    });
  });

  it("with nothing charted, a row typed and emptied again leaves nothing to clear: Save stays aria-disabled", async () => {
    const { api } = await open({ own: { heart_rate: null, spo2: null } });
    type("spo2", "low", "88");
    type("spo2", "low", "");
    const button = saveButton();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription(/Göndəriləcək aralıq yoxdur/);
    expect(dialog()).not.toHaveTextContent("bütün aralıqlarını silir");
    await save();
    expect(api.putPatientProfile).not.toHaveBeenCalled();
  });

  describe("when the ranges change under an open form", () => {
    it("says so, holds Save with that sentence as its reason, and keeps what the clinician typed", async () => {
      const { api, setOwn } = await open({ own: HR });
      type("temperature", "low", "36");
      type("temperature", "high", "37.5");
      await setOwn({ heart_rate: { low: 90, high: 120 } });
      const sentence = "Bu xəstənin aralıqları forma açıq ikən dəyişdi: formu bağlayıb yenidən açın.";
      expect(within(dialog()).getAllByRole("note").map((n) => n.textContent)).toContain(sentence);
      expect(saveButton()).toHaveAttribute("aria-disabled", "true");
      expect(saveButton()).toHaveAccessibleDescription(sentence);
      expect(input("heart_rate", "low")).toHaveValue("100");        // the snapshot she was editing, not the new set
      expect(input("temperature", "low")).toHaveValue("36");
      await save();
      expect(api.putPatientProfile).not.toHaveBeenCalled();
      await wait(200);
      expect(within(dialog()).getAllByRole("status").map((s) => s.textContent)).toContain(sentence);
    });

    it("says nothing when a poll hands it the same ranges again", async () => {
      const { api, setOwn } = await open({ own: HR });
      await setOwn({ heart_rate: { low: 100, high: 115 } });
      expect(dialog()).not.toHaveTextContent("forma açıq ikən dəyişdi");
      expect(saveButton()).not.toHaveAttribute("aria-disabled");
      await save();
      expect(api.putPatientProfile).toHaveBeenCalledTimes(1);
    });

    it("a range cleared or added by someone else is a change too", async () => {
      const { setOwn } = await open({ own: HR });
      await setOwn({});
      expect(dialog()).toHaveTextContent("forma açıq ikən dəyişdi");
    });
  });

  it("a clear the engine took: the confirmation names the patient and says every range is deleted, the trends are read again, the form closes — and no alert", async () => {
    const { onClose, onSaved } = await open({ own: HR });
    emptyRow("heart_rate");
    await save();
    expect(screen.getAllByText("REA-01 · 2: xəstənin bütün aralıqları silindi; növbəti ölçmə onlarsız qiymətləndiriləcək.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Xəstənin norması yadda saxlanıldı; mühərrik yenidən qiymətləndirdi.")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("alert").map((a) => a.textContent).join(" ").trim()).toBe("");
  });

  it("a save the engine took: the confirmation, the trends read again, the form closed — and no alert", async () => {
    const { onClose, onSaved } = await open({ own: HR });
    await save();
    expect(screen.getAllByText("Xəstənin norması yadda saxlanıldı; mühərrik yenidən qiymətləndirdi.").length).toBeGreaterThan(0);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("alert").map((a) => a.textContent).join(" ").trim()).toBe("");
  });

  it("a refusal goes on the toast, named after the bed and never inline, and the form stays open", async () => {
    const refused = Object.assign(new Error("profil boş olamaz — komorbidite, bazal aralık veya bazal SOFA gerekir"), { status: 400 });
    const { onClose, onSaved } = await open({ own: HR, answer: () => Promise.reject(refused) });
    await save();
    expect(toastText()).toContain("REA-01 · 2: xəstənin norması yadda saxlanılmadı — profil boş olamaz");
    expect(within(dialog()).queryAllByRole("alert")).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(saveButton()).not.toHaveAttribute("aria-busy");      // released, so she can correct it and send again
  });

  it("a right taken away meanwhile (403): the toast says so, and the form closes", async () => {
    const refused = Object.assign(new Error("permission required: clinical.chart"), { status: 403 });
    const { onClose, onSaved } = await open({ own: HR, answer: () => Promise.reject(refused) });
    await save();
    expect(toastText()).toContain("REA-01 · 2: xəstənin norması yadda saxlanılmadı — bu əməliyyat üçün artıq səlahiyyətiniz yoxdur (clinical.chart)");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it.each([
    ["the client's own timeout", () => Object.assign(new Error("Sunucu yanıt vermedi."), { code: "REQUEST_TIMEOUT" })],
    ["a gateway that could not answer (502)", () => Object.assign(new Error("Bad Gateway"), { status: 502 })],
    ["a connection that dropped", () => new TypeError("Failed to fetch")],
  ])("no answer, %s: it may have landed — the trends are read again and the clinician is told to look at the band", async (_what, make) => {
    const { onClose, onSaved } = await open({ own: HR, answer: () => Promise.reject(make()) });
    await save();
    expect(toastText()).toContain("REA-01 · 2: server cavab vermədi; xəstənin norması yadda saxlanılmış ola bilər — qrafikdəki zolağı yoxlayın.");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("while in flight: Save is busy and says so, the fields are read-only, and the dialog will not close", async () => {
    const { onClose } = await open({ own: HR, answer: () => new Promise(() => {}) });
    await save();
    expect(saveButton()).toHaveAttribute("aria-busy", "true");
    expect(input("heart_rate", "low")).toHaveAttribute("readonly");
    await wait(200);
    expect(within(dialog()).getAllByRole("status").map((s) => s.textContent)).toContain("Xəstənin norması yadda saxlanılır…");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

// SofaFormModal.test.jsx — the SOFA form prints the engine's form in the source's order and never a 0 for an
// organ it has no measurement for (D2); a clinical.chart holder completes a row through the door and the form is
// read again (D3); a scores.sign holder corrects a measured value with a reason counted against the engine's
// length (D5), previews and then signs exactly that (D6). Every control is absent without its right, and every
// refusal is said on the toast, named after the bed, and in the footer (X4). Synthetic values; the az texts.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { dayStamp } from "../../../i18n/dates.js";
import { SIGN_ARM_MS, SofaFormModal } from "./SofaFormModal.jsx";
import { toLocalInput } from "./sofaFields.js";
import { MEASURED_AT, WHY, cell, previewAnswer, signedAnswer, sofaForm } from "./sofa.testutil.js";

// The fake-timer recipe of the earlier waves (meds/MedsChartForm.test.jsx): installed BEFORE the mount, `Date`
// faked with them, nothing advancing on its own — so «İmzalayın»'s arming window is crossed only when a test
// says so; `settle` yields one turn of the REAL event loop.
const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));
const BED = "REA-01 · 2";
const ALL = ["board.view", "alerts.ack", "clinical.chart", "scores.sign"];
const AT = () => dayStamp(Date.parse(MEASURED_AT), NOW);

async function open({ canChart = true, canSign = true, form = sofaForm(), api: over = {} } = {}) {
  vi.useFakeTimers(FAKE_TIMERS);
  vi.setSystemTime(NOW);
  const api = {
    read: vi.fn(() => Promise.resolve(form)),
    chart: vi.fn(() => Promise.resolve({ patient_id: "S-001", charted: 1, alerts: [] })),
    preview: vi.fn(() => Promise.resolve(previewAnswer())),
    sign: vi.fn(() => Promise.resolve(signedAnswer())),
    ...over,
  };
  const onClose = vi.fn();
  await mount(
    <SofaFormModal bed={BED} nowMs={NOW} canChart={canChart} canSign={canSign} api={api} onClose={onClose} />,
    { access: token({ perms: ALL }), me: profile({ perms: ALL }) });
  await act(async () => { await settle(); });
  return { api, onClose };
}
const dialog = () => screen.getByRole("dialog", { name: `SOFA forması · ${BED}` });
const organ = (name) => within(dialog()).getByRole("heading", { level: 3, name }).closest("li");
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
const button = (name) => within(dialog()).getByRole("button", { name });
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);
/** The tone of the toast card that says `text` (its visible copy carries `data-tone`). */
const toneOf = (text) => toasted(text).map((el) => el.closest("[data-tone]")?.getAttribute("data-tone")).find(Boolean);
const footer = () => dialog().querySelector("[data-sofa-footer]");
/** «İmzalayın» is held for SIGN_ARM_MS after a preview: the time a double click's second press takes. */
const armed = () => act(() => { vi.advanceTimersByTime(SIGN_ARM_MS); });
/** «Öncədən baxın», and the arming window let pass. */
async function previewed() {
  await press(button("Öncədən baxın"));
  await armed();
}
/** A click as the browser counts it: `detail` is the click's place in a run of clicks (2 for a double click's second). */
const click = (el, detail) => act(async () => { fireEvent.click(el, { detail }); await settle(); });

async function correctPlatelets(value = "80") {
  await press(within(organ("Laxtalanma")).getByRole("button", { name: "Düzəldin: Trombosit sayı" }));
  const entry = within(dialog()).getByRole("form", { name: "Trombosit sayı — düzəliş" });
  fireEvent.change(within(entry).getByLabelText(/Düzgün dəyər/), { target: { value } });
  fireEvent.change(within(entry).getByLabelText("Əsaslandırma"), { target: { value: WHY } });
  await press(within(entry).getByRole("button", { name: "Düzəlişi saxlayın" }));
}

describe("the SOFA form (D2)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("lists the six organs in the source's order, not the engine's", async () => {
    await open();
    const names = within(dialog()).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names.slice(0, 6)).toEqual(["Tənəffüs", "Laxtalanma", "Qaraciyər", "Ürək-damar", "Mərkəzi sinir sistemi", "Böyrək"]);
  });

  it("prints the engine's points, «ölçülməyib» — never a 0 — for an organ with no measurement, and the failure mark", async () => {
    await open();
    expect(organ("Laxtalanma")).toHaveTextContent("3 bal");
    expect(within(organ("Laxtalanma")).getByText("orqan çatışmazlığı")).toBeInTheDocument();
    expect(organ("Tənəffüs")).toHaveTextContent("2 bal");
    expect(within(organ("Tənəffüs")).queryByText("orqan çatışmazlığı")).toBeNull();
    for (const name of ["Qaraciyər", "Ürək-damar", "Mərkəzi sinir sistemi", "Böyrək"]) {
      expect(organ(name)).toHaveTextContent("ölçülməyib");
      expect(organ(name)).not.toHaveTextContent(/\b0 bal/);
    }
    expect(within(dialog()).getByText("Cəmi: 5")).toBeInTheDocument();
  });

  it("gives each value its unit, its time and where it came from; one from before the window says so", async () => {
    const form = sofaForm();
    form.rows[2] = { ...form.rows[2], inputs: [cell("platelets", 45, { points: 3, outside_window: true, source: "nce" })] };
    await open({ form });
    expect(organ("Laxtalanma")).toHaveTextContent(`Trombosit sayı: 45 ×10³/mkl · ${AT()} · nce`);
    expect(organ("Laxtalanma")).toHaveTextContent("Pəncərədə ölçmə yoxdur: bu, pəncərədən əvvəlki ən yaxın ölçmədir.");
    expect(organ("Tənəffüs")).toHaveTextContent(`PaO₂/FiO₂ nisbəti: 250 mmHg · ${AT()} · klinisist qeydi`);
  });

  it("says the window and a stay shorter than it, and the renal, cardiovascular and respiratory notes (D8, D9)", async () => {
    await open();
    expect(within(dialog()).getByText(/^Pəncərə: son 24 saat · /)).toBeInTheDocument();
    expect(organ("Böyrək")).toHaveTextContent("Sidik ifrazı bu formada bala daxil edilmir.");
    expect(organ("Ürək-damar")).toHaveTextContent("MAP qeyddən gəlir, bu formadan daxil edilmir");
    expect(organ("Tənəffüs")).toHaveTextContent("yalnız tənəffüs dəstəyində keçərlidir");
    cleanup();
    await open({ form: sofaForm({ covers_full_window: false }) });
    expect(within(dialog()).getByText(/xəstə 24 saatdan az müddətdir buradadır/)).toBeInTheDocument();
  });

  it("a form that cannot be read says so, and is asked again", async () => {
    const read = vi.fn().mockRejectedValueOnce(refusal(503, "kapsam şu anda okunamıyor")).mockResolvedValueOnce(sofaForm());
    const { api } = await open({ api: { read } });
    expect(within(dialog()).getByText(/^SOFA forması oxuna bilmədi: /)).toBeInTheDocument();
    await press(button("Yenidən cəhd edin"));
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(within(dialog()).getByText("Cəmi: 5")).toBeInTheDocument();
  });
});

describe("completing a row (clinical.chart, D3)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const entryFor = (input) => within(dialog()).getByRole("form", { name: `${input} — yeni ölçmə` });
  const save = (entry) => press(within(entry).getByRole("button", { name: "Yadda saxla" }));

  it("enters a bilirubin with its time, charts it through the door, and reads the form again", async () => {
    const { api } = await open();
    await press(within(organ("Qaraciyər")).getByRole("button", { name: "Ölçmə daxil edin: Bilirubin səviyyəsi" }));
    const entry = entryFor("Bilirubin səviyyəsi");
    fireEvent.change(within(entry).getByLabelText(/Bilirubin səviyyəsi/), { target: { value: "2,4" } });
    await save(entry);
    expect(api.chart).toHaveBeenCalledWith([{ code: "bilirubin", value: 2.4 }], new Date(NOW).toISOString());
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(toasted(`${BED}: Bilirubin səviyyəsi qeyd olundu; forma yenidən oxunur.`).length).toBeGreaterThan(0);
    expect(within(dialog()).queryByRole("form", { name: /yeni ölçmə$/ })).toBeNull();
  });

  it("charts respiratory support as 1 or 0, from under the respiration row", async () => {
    const { api } = await open();
    await press(within(organ("Tənəffüs")).getByRole("button", { name: "Dəstək vəziyyətini qeyd edin" }));
    const entry = entryFor("Tənəffüs dəstəyi");
    await save(entry);
    expect(api.chart).not.toHaveBeenCalled();
    expect(within(entry).getByText("Bəli və ya xeyr seçin.")).toBeInTheDocument();
    fireEvent.change(within(entry).getByLabelText("Tənəffüs dəstəyi"), { target: { value: "1" } });
    await save(entry);
    expect(api.chart).toHaveBeenCalledWith([{ code: "on_resp_support", value: 1 }], new Date(NOW).toISOString());
  });

  it("holds a slipped digit or a time ahead before anything is sent, and takes the focus there", async () => {
    const { api } = await open();
    await press(within(organ("Böyrək")).getByRole("button", { name: "Ölçmə daxil edin: Kreatinin səviyyəsi" }));
    const entry = entryFor("Kreatinin səviyyəsi");
    const value = within(entry).getByLabelText(/Kreatinin səviyyəsi/);
    fireEvent.change(value, { target: { value: "150" } });                  // a µmol/L creatinine (D11)
    await save(entry);
    expect(api.chart).not.toHaveBeenCalled();
    expect(within(entry).getByText("Gözlənilən aralıqdan (0–30) kənardadır — vahid və ya onluq vergül səhvi ola bilər.")).toBeInTheDocument();
    expect(document.activeElement).toBe(value);
    fireEvent.change(value, { target: { value: "1.4" } });
    const time = within(entry).getByLabelText("Ölçmə saatı");
    fireEvent.change(time, { target: { value: toLocalInput(NOW + 10 * 60_000) } });
    await save(entry);
    expect(api.chart).not.toHaveBeenCalled();
    expect(within(entry).getByText("Ölçmə saatı gələcəkdə ola bilməz.")).toBeInTheDocument();
    expect(document.activeElement).toBe(time);
  });

  it("a refusal is said on the toast, named after the bed, and in the footer; the entry and its draft stay", async () => {
    const { api } = await open({ api: { chart: vi.fn(() => Promise.reject(refusal(400, "platelets: geçersiz sayı"))) } });
    await press(within(organ("Laxtalanma")).getByRole("button", { name: "Ölçmə daxil edin: Trombosit sayı" }));
    const entry = entryFor("Trombosit sayı");
    fireEvent.change(within(entry).getByLabelText(/Trombosit sayı/), { target: { value: "150" } });
    await save(entry);
    const said = `${BED} üçün ölçmə rədd edildi: platelets: geçersiz sayı`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(footer()).toHaveTextContent(said);
    expect(within(entryFor("Trombosit sayı")).getByLabelText(/Trombosit sayı/)).toHaveValue("150");
    expect(api.read).toHaveBeenCalledTimes(1);
  });

  it("a measurement with no answer may have landed: said so, and the form is read again", async () => {
    const { api } = await open({ api: { chart: vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) } });
    await press(within(organ("Mərkəzi sinir sistemi")).getByRole("button", { name: "Ölçmə daxil edin: GCS (Qlazqo koma şkalası)" }));
    const entry = entryFor("GCS (Qlazqo koma şkalası)");
    fireEvent.change(within(entry).getByLabelText(/GCS/), { target: { value: "11" } });
    await save(entry);
    expect(toasted(`${BED} üçün ölçmə cavab almadı; yadda saxlanılmış ola bilər — forma yenidən oxunur.`).length).toBeGreaterThan(0);
    expect(api.read).toHaveBeenCalledTimes(2);
  });

  it("without clinical.chart there is no way to enter a measurement, and the form says why", async () => {
    await open({ canChart: false });
    expect(within(dialog()).queryAllByRole("button", { name: /^Ölçmə daxil edin/ })).toHaveLength(0);
    expect(within(dialog()).queryByRole("button", { name: "Dəstək vəziyyətini qeyd edin" })).toBeNull();
    expect(within(dialog()).getByText("Ölçmə daxil etmək clinical.chart səlahiyyəti tələb edir.")).toBeInTheDocument();
  });
});

describe("correcting a measured value (scores.sign, D5)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("is offered for a measured value only, counts the reason, and holds the correction without sending it", async () => {
    const { api } = await open();
    expect(within(organ("Qaraciyər")).queryByRole("button", { name: /^Düzəldin/ })).toBeNull();   // unmeasured: completed, not corrected
    await press(within(organ("Laxtalanma")).getByRole("button", { name: "Düzəldin: Trombosit sayı" }));
    const entry = within(dialog()).getByRole("form", { name: "Trombosit sayı — düzəliş" });
    expect(entry).toHaveTextContent("Qeyddəki dəyər: 45 ×10³/mkl.");
    fireEvent.change(within(entry).getByLabelText(/Düzgün dəyər/), { target: { value: "80" } });
    fireEvent.change(within(entry).getByLabelText("Əsaslandırma"), { target: { value: "qısa" } });
    expect(within(entry).getByText("4 / 20 simvol")).toBeInTheDocument();
    fireEvent.change(within(entry).getByLabelText("Əsaslandırma"), { target: { value: WHY } });
    await press(within(entry).getByRole("button", { name: "Düzəlişi saxlayın" }));
    expect(within(dialog()).queryByRole("form", { name: /düzəliş$/ })).toBeNull();
    expect(organ("Laxtalanma")).toHaveTextContent("Gözləyən düzəliş: 80 ×10³/mkl");
    expect(within(dialog()).getByText(`Trombosit sayı: 45 → 80 · əsaslandırma: «${WHY}»`)).toBeInTheDocument();
    expect(document.activeElement).toBe(within(organ("Laxtalanma")).getByRole("button", { name: "Düzəlişi dəyişin: Trombosit sayı" }));
    expect(api.preview).not.toHaveBeenCalled();
    expect(api.sign).not.toHaveBeenCalled();
  });
});

describe("preview, then sign (D6)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("previews the held corrections, shows the engine's total and rows, and signs exactly the same list", async () => {
    const { api, onClose } = await open();
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();          // never before a preview
    expect(footer()).toHaveTextContent("İmzalamazdan əvvəl öncədən baxın");
    await correctPlatelets();
    await previewed();
    const overrides = [{ code: "platelets", value: 80, reason: WHY }];
    expect(api.preview).toHaveBeenCalledWith(overrides);
    expect(within(dialog()).getByText("Öncədən baxış: cəmi 4 (qeyddən: 5) — hələ imzalanmayıb")).toBeInTheDocument();
    expect(organ("Laxtalanma")).toHaveTextContent("2 bal");
    expect(organ("Laxtalanma")).toHaveTextContent("Düzəldilib — qeyddəki dəyər: 45");
    await press(button("İmzalayın"));
    expect(api.sign).toHaveBeenCalledWith(overrides);
    expect(toasted(`${BED}: SOFA forması imzalandı · cəmi 4.`).length).toBeGreaterThan(0);
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("a correction changed after the preview makes it stale: no «İmzalayın» until it is previewed again", async () => {
    await open();
    await correctPlatelets();
    await press(button("Öncədən baxın"));
    expect(button("İmzalayın")).toBeInTheDocument();
    await press(within(organ("Laxtalanma")).getByRole("button", { name: "Düzəlişi götürün: Trombosit sayı" }));
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
    expect(footer()).toHaveTextContent("Düzəlişlər öncədən baxışdan sonra dəyişib; imzalamazdan əvvəl yenidən baxın.");
  });

  it("says so when the signed total is not the previewed one: the record moved in between (X11)", async () => {
    await open({ api: { sign: vi.fn(() => Promise.resolve(signedAnswer({ total: 6 }))) } });
    await correctPlatelets();
    await previewed();
    await press(button("İmzalayın"));
    const said = `${BED}: SOFA forması cəmi 6 ilə imzalandı — öncədən baxışda 4 idi; qeyd arada dəyişib.`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(toneOf(said)).toBe("warn");
  });

  it("says so when the total held but the record under a correction moved: another original, or an organ's points (X11)", async () => {
    const moved = signedAnswer();
    moved.overrides = [{ ...moved.overrides[0], original: 50 }];                // the window slid: 50 is under her 80 now
    await open({ api: { sign: vi.fn(() => Promise.resolve(moved)) } });
    await correctPlatelets();
    await previewed();
    await press(button("İmzalayın"));
    const said = `${BED}: SOFA forması cəmi 4 ilə imzalandı — amma qeyd öncədən baxışdan sonra dəyişib: formanı yenidən açıb yoxlayın.`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(toneOf(said)).toBe("warn");
    expect(toasted(`${BED}: SOFA forması imzalandı · cəmi 4.`)).toHaveLength(0);
    cleanup();
    const shifted = signedAnswer();                                              // 4 still, but from other organs
    shifted.form = { ...shifted.form, rows: shifted.form.rows.map((row) => (
      row.organ === "respiration" ? { ...row, points: 1 } : row.organ === "liver" ? { ...row, points: 1, measured: true } : row)) };
    await open({ api: { sign: vi.fn(() => Promise.resolve(shifted)) } });
    await correctPlatelets();
    await previewed();
    await press(button("İmzalayın"));
    expect(toasted(said).length).toBeGreaterThan(0);
  });

  it("an answer to «Öncədən baxın» that SIGNED — an engine older than G2-A4 — is said on the toast and in the footer, the box reads again, and nothing more is offered (X13)", async () => {
    const { api, onClose } = await open({ api: { preview: vi.fn(() => Promise.resolve(signedAnswer())) } });
    await correctPlatelets();
    await previewed();
    const said = `${BED}: mühərrik öncədən baxış etmədi, formanı imzaladı — imza qeyddədir. SOFA qutusundakı son imza sətrinə baxın.`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(toneOf(said)).toBe("warn");
    expect(footer()).toHaveTextContent(said);
    expect(onClose).toHaveBeenCalledWith(true);
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
    expect(within(dialog()).queryByText(/^Öncədən baxış: cəmi/)).toBeNull();
    expect(api.sign).not.toHaveBeenCalled();
  });

  it("an answer to «Öncədən baxın» that is not a preview is a refused preview: nothing is shown as previewed, nothing offered to sign", async () => {
    const { preview: _flag, ...unflagged } = previewAnswer();
    const { onClose } = await open({ api: { preview: vi.fn(() => Promise.resolve(unflagged)) } });
    await correctPlatelets();
    await previewed();
    const said = `${BED} üçün öncədən baxış alınmadı: mühərrikin cavabı öncədən baxış deyildi`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(footer()).toHaveTextContent(said);
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
    expect(within(dialog()).queryByText(/^Öncədən baxış: cəmi/)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a double click on «Öncədən baxın» never signs: «İmzalayın», where it lands, is held for SIGN_ARM_MS", async () => {
    const { api } = await open();
    await correctPlatelets();
    await click(button("Öncədən baxın"), 1);
    const sign = button("İmzalayın");                                            // where the second press lands
    expect(sign).toHaveAttribute("aria-disabled", "true");
    await click(sign, 2);
    await click(sign, 1);                                                        // even a single press, inside the window
    expect(api.sign).not.toHaveBeenCalled();
    await armed();
    expect(button("İmzalayın")).not.toHaveAttribute("aria-disabled");
    await click(button("İmzalayın"), 1);
    expect(api.sign).toHaveBeenCalledTimes(1);
  });

  it("a refused signature is said on the toast and in the footer, and the form stays open with its corrections", async () => {
    const reason = "platelets: düzeltme gerekçesi en az 20 karakter olmalı — bu sayı hastane raporlamasına giriyor ve neden değiştirildiği kayda geçmeli";
    const { onClose } = await open({ api: { sign: vi.fn(() => Promise.reject(refusal(400, reason))) } });
    await correctPlatelets();
    await previewed();
    await press(button("İmzalayın"));
    const said = `${BED} üçün imza rədd edildi: ${reason}`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(footer()).toHaveTextContent(said);
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog()).getByText(`Trombosit sayı: 45 → 80 · əsaslandırma: «${WHY}»`)).toBeInTheDocument();
  });

  it("a right taken away (403) closes the form; a signature with no answer may have gone through, and closes it too", async () => {
    let { onClose } = await open({ api: { sign: vi.fn(() => Promise.reject(refusal(403, "permission required: scores.sign"))) } });
    await correctPlatelets();
    await previewed();
    await press(button("İmzalayın"));
    expect(toasted(`${BED} üçün imza rədd edildi: Bu hesabın imza səlahiyyəti yoxdur.`).length).toBeGreaterThan(0);
    expect(onClose).toHaveBeenCalledWith(false);
    cleanup();
    ({ onClose } = await open({ api: { sign: vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) } }));
    await correctPlatelets();
    await previewed();
    await press(button("İmzalayın"));
    expect(toasted(`${BED} üçün imza cavab almadı; atılmış ola bilər — SOFA qutusundakı son imza sətrinə baxın.`).length).toBeGreaterThan(0);
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("without scores.sign — or against an engine that cannot preview — no correction, no preview, no signature, and the footer says why", async () => {
    await open({ canSign: false });
    expect(within(dialog()).queryAllByRole("button", { name: /^Düzəldin/ })).toHaveLength(0);
    expect(within(dialog()).queryByRole("button", { name: "Öncədən baxın" })).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
    expect(footer()).toHaveTextContent("Düzəltmək və imzalamaq scores.sign səlahiyyəti tələb edir.");
    cleanup();
    const { min_reason_chars: _min, ...older } = sofaForm();      // an engine older than G2-A4 (X13)
    await open({ form: older });
    expect(within(dialog()).queryAllByRole("button", { name: /^Düzəldin/ })).toHaveLength(0);
    expect(within(dialog()).queryByRole("button", { name: "Öncədən baxın" })).toBeNull();
    expect(footer()).toHaveTextContent("Mühərrikin bu versiyası öncədən baxışı bilmir: düzəliş və imza bu ekrandan bağlıdır.");
  });
});

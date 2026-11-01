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
import { ANNOUNCE_DELAY_MS } from "../../../ui/Alert.jsx";
import { SIGN_ARM_MS, SofaFormModal } from "./SofaFormModal.jsx";
import { toLocalInput } from "./sofaFields.js";
import { EXPECT, MEASURED_AT, SUPPORT_AT, WHY, cell, previewAnswer, signedAnswer, sofaForm } from "./sofa.testutil.js";

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
  // One act() for the mount and the form's first read, which lands in a later turn.
  await act(async () => {
    await mount(
      <SofaFormModal bed={BED} nowMs={NOW} canChart={canChart} canSign={canSign} api={api} onClose={onClose} />,
      { access: token({ perms: ALL }), me: profile({ perms: ALL }) });
    await settle();
  });
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
/** Everything the toast region says now. */
const toastText = () => screen.getByRole("region", { name: "Bildirişlər" }).textContent;
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
    // The mark on the engine's `failure` flag says the points only (review 2, S6a): no "organ failure", no "threshold".
    expect(within(organ("Laxtalanma")).getByText("≥3 bal")).toBeInTheDocument();
    expect(dialog()).not.toHaveTextContent(/orqan çatışmazlığı|həddi/);
    expect(organ("Tənəffüs")).toHaveTextContent("2 bal");
    expect(within(organ("Tənəffüs")).queryByText("≥3 bal")).toBeNull();
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

  it("says the form itself raises no alert — and that a measurement entered here is in the record the alerting rules read (review 2, S4)", async () => {
    await open();
    expect(within(dialog()).getByText(/Formanın özü siqnal yaratmır; buradan daxil edilən ölçmə xəstə qeydinə yazılır və xəbərdarlıq qaydaları \(Sepsis-3 qutusu\) da onu oxuyur\./)).toBeInTheDocument();
    expect(dialog()).not.toHaveTextContent("Forma siqnal yaratmır;");
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

  it("prints the support state the ratio was scored on, from the engine's respiration row — to a reader without clinical.chart too (C3)", async () => {
    const at = dayStamp(Date.parse(SUPPORT_AT), NOW);
    const withSupport = (support) => {
      const form = sofaForm();
      form.rows[0] = { ...form.rows[0], support };
      return form;
    };
    await open({ canChart: false });
    expect(organ("Tənəffüs")).toHaveTextContent(`Tənəffüs dəstəyi: bəli (qeyd ${at})`);
    cleanup();
    await open({ form: withSupport({ on_support: false, at: SUPPORT_AT }) });
    expect(organ("Tənəffüs")).toHaveTextContent(`Tənəffüs dəstəyi: xeyr (qeyd ${at})`);
    cleanup();
    await open({ form: withSupport({ on_support: false, at: null }) });
    expect(organ("Tənəffüs")).toHaveTextContent("Tənəffüs dəstəyi qeydi yoxdur");
    cleanup();
    await open({ form: withSupport(null) });                                     // a row with no ratio: nothing said
    expect(organ("Tənəffüs")).not.toHaveTextContent(/Tənəffüs dəstəyi: |Tənəffüs dəstəyi qeydi/);
    expect(organ("Laxtalanma")).not.toHaveTextContent(/Tənəffüs dəstəyi/);       // only under the respiration row
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
    expect(api.chart).toHaveBeenCalledWith([{ code: "bilirubin", value: 2.4 }], null);    // untouched: the server's clock (review 2)
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(toasted(`${BED}: Bilirubin səviyyəsi qeyd olundu; forma yenidən oxunur.`).length).toBeGreaterThan(0);
    expect(within(dialog()).queryByRole("form", { name: /yeni ölçmə$/ })).toBeNull();
  });

  it("charts respiratory support as 1 or 0, from under the respiration row", async () => {
    const { api } = await open();
    await press(within(organ("Tənəffüs")).getByRole("button", { name: "Dəstək vəziyyətini qeyd edin" }));
    const entry = entryFor("Tənəffüs dəstəyi");
    // The engine's rule (review 2, C3): the state as of the worst reading — the latest entry at or before it.
    expect(entry).toHaveTextContent("PaO₂/FiO₂ ən pis oxunduğu andakı tənəffüs dəstəyi vəziyyəti ilə qiymətləndirilir");
    expect(entry).toHaveTextContent("qeydi həmin saata geri tarixləyərək daxil edə bilərsiniz");
    expect(entry).not.toHaveTextContent("«xeyr» onu geri almır");                // the old "any yes in 24 h" rule
    await save(entry);
    expect(api.chart).not.toHaveBeenCalled();
    expect(within(entry).getByText("Bəli və ya xeyr seçin.")).toBeInTheDocument();
    fireEvent.change(within(entry).getByLabelText("Tənəffüs dəstəyi"), { target: { value: "1" } });
    await save(entry);
    expect(api.chart).toHaveBeenCalledWith([{ code: "on_resp_support", value: 1 }], null);
  });

  it("a «xeyr» back-dated to before the worst reading is charted with its time: the support entry keeps its time field (C3)", async () => {
    const { api } = await open();
    await press(within(organ("Tənəffüs")).getByRole("button", { name: "Dəstək vəziyyətini qeyd edin" }));
    const entry = entryFor("Tənəffüs dəstəyi");
    fireEvent.change(within(entry).getByLabelText("Tənəffüs dəstəyi"), { target: { value: "0" } });
    const before = Date.parse(MEASURED_AT) - 60 * 60_000;                       // an hour before the ratio's reading
    fireEvent.change(within(entry).getByLabelText("Ölçmə saatı"), { target: { value: toLocalInput(before) } });
    await save(entry);
    expect(api.chart).toHaveBeenCalledWith([{ code: "on_resp_support", value: 0 }], new Date(before).toISOString());
  });

  it("holds a slipped digit or a time ahead before anything is sent, and takes the focus there", async () => {
    const { api } = await open();
    await press(within(organ("Böyrək")).getByRole("button", { name: "Ölçmə daxil edin: Kreatinin səviyyəsi" }));
    const entry = entryFor("Kreatinin səviyyəsi");
    const value = within(entry).getByLabelText(/Kreatinin səviyyəsi/);
    fireEvent.change(value, { target: { value: "150" } });                  // a µmol/L creatinine (D11)
    await save(entry);
    expect(api.chart).not.toHaveBeenCalled();
    expect(within(entry).getByText("Gözlənilən aralıqdan (0–40) kənardadır — vahid və ya onluq vergül səhvi ola bilər.")).toBeInTheDocument();
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

  it("a right taken away (403) is said in the form's words, never with the permission key, and the entry closes", async () => {
    const { api } = await open({ api: { chart: vi.fn(() => Promise.reject(refusal(403, "permission required: clinical.chart"))) } });
    await press(within(organ("Laxtalanma")).getByRole("button", { name: "Ölçmə daxil edin: Trombosit sayı" }));
    const entry = entryFor("Trombosit sayı");
    fireEvent.change(within(entry).getByLabelText(/Trombosit sayı/), { target: { value: "150" } });
    await save(entry);
    const said = `${BED} üçün ölçmə rədd edildi: Bu hesabın qeyd etmə səlahiyyəti yoxdur.`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(footer()).toHaveTextContent(said);
    expect(toasted(/clinical\.chart/)).toHaveLength(0);
    expect(within(dialog()).queryByRole("form", { name: /yeni ölçmə$/ })).toBeNull();
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

  it("a measurement the engine dropped (the patient was discharged meanwhile) is said, its entry closes, and nothing is read again", async () => {
    const { api } = await open({ api: { chart: vi.fn(() => Promise.resolve({ patient_id: "S-001", dropped: true })) } });
    await press(within(organ("Qaraciyər")).getByRole("button", { name: "Ölçmə daxil edin: Bilirubin səviyyəsi" }));
    const entry = entryFor("Bilirubin səviyyəsi");
    fireEvent.change(within(entry).getByLabelText(/Bilirubin səviyyəsi/), { target: { value: "2,4" } });
    await save(entry);
    const said = `${BED} tərxis edilib; ölçmə qəbul edilmədi.`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(toneOf(said)).toBe("warn");
    expect(footer()).toHaveTextContent(said);
    expect(within(dialog()).queryByRole("form", { name: /yeni ölçmə$/ })).toBeNull();
    expect(api.read).toHaveBeenCalledTimes(1);
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
    expect(footer()).toHaveTextContent("«İmzalayın» bu düzəlişləri imzalayır; mühərrik imza anında yenidən hesablayır.");   // not "this number"
    expect(organ("Laxtalanma")).toHaveTextContent("2 bal");
    expect(organ("Laxtalanma")).toHaveTextContent("Düzəldilib — qeyddəki dəyər: 45");
    await press(button("İmzalayın"));
    expect(api.sign).toHaveBeenCalledWith(overrides, EXPECT);                   // with the preview's fingerprint (C2)
    expect(toasted(`${BED}: SOFA forması imzalandı · cəmi 4.`).length).toBeGreaterThan(0);
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("a server that does not know the preview route (404, 405) is a refused preview, said so: nothing to sign, nothing closed (C1)", async () => {
    for (const err of [refusal(404, "Not Found"), refusal(405, "Method Not Allowed"), refusal(404, "İstek başarısız (404)")]) {
      const { api, onClose } = await open({ api: { preview: vi.fn(() => Promise.reject(err)) } });
      await correctPlatelets();
      await previewed();
      const said = `${BED} üçün öncədən baxış alınmadı: Server öncədən baxışı tanımır; imza təklif edilmir.`;
      expect(toasted(said).length, err.message).toBeGreaterThan(0);
      expect(toneOf(said)).toBe("error");
      expect(footer()).toHaveTextContent(said);
      expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
      expect(api.sign).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("a 404 in the engine's own words — the patient is not in her scope — is that refusal, not an unknown route (C1)", async () => {
    await open({ api: { preview: vi.fn(() => Promise.reject(refusal(404, "hasta bulunamadı"))) } });
    await correctPlatelets();
    await previewed();
    expect(toasted(`${BED} üçün öncədən baxış alınmadı: Bu xəstə panelinizdə yoxdur: ya belə bir qeyd yoxdur, ya da əhatənizdən kənardır.`).length).toBeGreaterThan(0);
    expect(toasted(/tanımır/)).toHaveLength(0);
  });

  it("a preview with no fingerprint to sign it by — or a malformed one — is a refused preview, never something to sign (C2)", async () => {
    for (const fingerprint of [undefined, null, "ABC", EXPECT.toUpperCase(), EXPECT.slice(1), `${EXPECT}0`]) {
      const { expect: _given, ...rest } = previewAnswer();
      const answer = fingerprint === undefined ? rest : { ...rest, expect: fingerprint };
      const { api } = await open({ api: { preview: vi.fn(() => Promise.resolve(answer)) } });
      await correctPlatelets();
      await previewed();
      expect(toasted(`${BED} üçün öncədən baxış alınmadı: mühərrikin cavabı öncədən baxış deyildi`).length, String(fingerprint)).toBeGreaterThan(0);
      expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
      expect(within(dialog()).queryByText(/^Öncədən baxış: cəmi/)).toBeNull();
      expect(api.sign).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("a 409 — the record moved since the preview — signed nothing: the preview is let go, the form read again, and it is said (C2)", async () => {
    const reason = "kayıt önizlemeden sonra değişti — formu yeniden önizleyin";
    const { api, onClose } = await open({ api: { sign: vi.fn(() => Promise.reject(refusal(409, reason))) } });
    await correctPlatelets();
    await previewed();
    await press(button("İmzalayın"));
    expect(api.sign).toHaveBeenCalledWith([{ code: "platelets", value: 80, reason: WHY }], EXPECT);
    const said = `${BED}: qeyd öncədən baxışdan sonra dəyişib; heç nə imzalanmayıb. Formaya yenidən öncədən baxın.`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(toneOf(said)).toBe("warn");
    expect(footer()).toHaveTextContent(said);
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
    expect(within(dialog()).getByText("Cəmi: 5")).toBeInTheDocument();                 // the record's form, not the preview's
    expect(footer()).toHaveTextContent("İmzalamazdan əvvəl öncədən baxın");
    // Her corrections stay, to be previewed again.
    expect(within(dialog()).getByText(`Trombosit sayı: 45 → 80 · əsaslandırma: «${WHY}»`)).toBeInTheDocument();
    expect(button("Öncədən baxın")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await press(within(dialog()).getAllByRole("button", { name: "Bağla" }).at(-1));
    expect(onClose).toHaveBeenCalledWith(false);                                        // nothing was signed: nothing changed
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

  it("a correction EDITED after the preview makes it stale as well: «İmzalayın» is gone and the footer says so", async () => {
    await open();
    await correctPlatelets();
    await previewed();
    expect(button("İmzalayın")).toBeInTheDocument();
    await press(within(organ("Laxtalanma")).getByRole("button", { name: "Düzəlişi dəyişin: Trombosit sayı" }));
    const entry = within(dialog()).getByRole("form", { name: "Trombosit sayı — düzəliş" });
    fireEvent.change(within(entry).getByLabelText(/Düzgün dəyər/), { target: { value: "90" } });
    await press(within(entry).getByRole("button", { name: "Düzəlişi saxlayın" }));
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
    expect(footer()).toHaveTextContent("Düzəlişlər öncədən baxışdan sonra dəyişib; imzalamazdan əvvəl yenidən baxın.");
  });

  it("a measurement charted after the preview lets the preview go: «İmzalayın» is gone and the form is read again", async () => {
    const { api } = await open();
    await correctPlatelets();
    await previewed();
    expect(button("İmzalayın")).toBeInTheDocument();
    await press(within(organ("Qaraciyər")).getByRole("button", { name: "Ölçmə daxil edin: Bilirubin səviyyəsi" }));
    const entry = within(dialog()).getByRole("form", { name: "Bilirubin səviyyəsi — yeni ölçmə" });
    fireEvent.change(within(entry).getByLabelText(/Bilirubin səviyyəsi/), { target: { value: "2,4" } });
    await press(within(entry).getByRole("button", { name: "Yadda saxla" }));
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
    expect(within(dialog()).getByText("Cəmi: 5")).toBeInTheDocument();             // the record's form again, not the preview's
    expect(footer()).toHaveTextContent("İmzalamazdan əvvəl öncədən baxın");
  });

  it("a double click on «İmzalayın» signs once", async () => {
    const { api } = await open();
    await correctPlatelets();
    await previewed();
    const sign = button("İmzalayın");
    await click(sign, 1);
    await click(sign, 2);                                                        // the same double click's second press
    expect(api.sign).toHaveBeenCalledTimes(1);
  });

  it("a refused preview says the engine's own sentence on the toast and once in the footer, and offers nothing to sign", async () => {
    const reason = "platelets: 18000 beklenen aralığın (0–5000) dışında — birim veya ondalık hatası olabilir";
    const { onClose } = await open({ api: { preview: vi.fn(() => Promise.reject(refusal(400, reason))) } });
    await correctPlatelets();
    await press(button("Öncədən baxın"));
    const said = `${BED} üçün öncədən baxış alınmadı: ${reason}`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(toneOf(said)).toBe("error");
    expect(footer().textContent.split(said)).toHaveLength(2);                    // once, beside the standing note
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("an answer for a session that was replaced says nothing into this one — not on the toast, not in the footer", async () => {
    const superseded = () => Promise.reject(Object.assign(
      new Error("Bu istek önceki oturuma aitti; sonucu uygulanmadı."), { superseded: true, code: "SESSION_SUPERSEDED" }));
    let { onClose } = await open({ api: { preview: vi.fn(superseded) } });
    await correctPlatelets();
    const before = footer().textContent;
    await press(button("Öncədən baxın"));
    expect(toastText()).toBe("");
    expect(footer().textContent).toBe(before);
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
    ({ onClose } = await open({ api: { sign: vi.fn(superseded) } }));
    await correctPlatelets();
    await previewed();
    const previewedSaid = footer().textContent;
    await press(button("İmzalayın"));
    expect(toastText()).toBe("");
    expect(footer().textContent).toBe(previewedSaid);
    expect(onClose).not.toHaveBeenCalled();
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

  it("an answer to «Öncədən baxın» that says it SIGNED — which the preview route never does — is said on the toast and in the footer, the box reads again, and nothing more is offered (X13)", async () => {
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
    expect(toasted(/scores\.sign/)).toHaveLength(0);                            // a permission key is no clinician's word
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

describe("the footer, the announcement, the editors and the close (review minors)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const chartEntry = (input) => within(dialog()).getByRole("form", { name: `${input} — yeni ölçmə` });
  async function chartBilirubin() {
    await press(within(organ("Qaraciyər")).getByRole("button", { name: "Ölçmə daxil edin: Bilirubin səviyyəsi" }));
    fireEvent.change(within(chartEntry("Bilirubin səviyyəsi")).getByLabelText(/Bilirubin səviyyəsi/), { target: { value: "2,4" } });
    await press(within(chartEntry("Bilirubin səviyyəsi")).getByRole("button", { name: "Yadda saxla" }));
  }

  it("the footer says the last outcome AND why a control is absent: the standing note is never hidden by it", async () => {
    await open({ canSign: false });
    await chartBilirubin();
    expect(footer()).toHaveTextContent(`${BED}: Bilirubin səviyyəsi qeyd olundu; forma yenidən oxunur.`);
    expect(footer()).toHaveTextContent("Düzəltmək və imzalamaq scores.sign səlahiyyəti tələb edir.");
    cleanup();
    const { min_reason_chars: _min, ...older } = sofaForm();
    await open({ form: older });
    await chartBilirubin();
    expect(footer()).toHaveTextContent(`${BED}: Bilirubin səviyyəsi qeyd olundu; forma yenidən oxunur.`);
    expect(footer()).toHaveTextContent("Mühərrikin bu versiyası öncədən baxışı bilmir");
  });

  it("a signature whose answer carries no total claims none", async () => {
    const { onClose } = await open({ api: { sign: vi.fn(() => Promise.resolve({ signed: true })) } });
    await correctPlatelets();
    await previewed();
    await press(button("İmzalayın"));
    const said = `${BED}: SOFA forması imzalandı; mühərrik cəmi göndərmədi — SOFA qutusundakı son imza sətrinə baxın.`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(toneOf(said)).toBe("warn");
    expect(toasted(/cəmi 4/)).toHaveLength(0);
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("a chart that lands closes its own editor, not the one she opened while it was in flight", async () => {
    let land;
    const chart = vi.fn(() => new Promise((resolve) => { land = resolve; }));
    await open({ api: { chart } });
    await chartBilirubin();
    expect(chart).toHaveBeenCalledTimes(1);
    expect(button("Öncədən baxın")).toHaveAttribute("aria-busy", "true");           // one request at a time, said
    await press(within(organ("Laxtalanma")).getByRole("button", { name: "Düzəldin: Trombosit sayı" }));
    await act(async () => { land({ patient_id: "S-001", charted: 1, alerts: [] }); await settle(); });
    expect(within(dialog()).getByRole("form", { name: "Trombosit sayı — düzəliş" })).toBeInTheDocument();
    expect(button("Öncədən baxın")).not.toHaveAttribute("aria-busy");
  });

  it("while a preview is in flight «Öncədən baxın» is busy, and a preview that lands is announced with its total", async () => {
    let land;
    await open({ api: { preview: vi.fn(() => new Promise((resolve) => { land = resolve; })) } });
    await correctPlatelets();
    await press(button("Öncədən baxın"));
    expect(button("Öncədən baxın")).toHaveAttribute("aria-busy", "true");
    await act(async () => { land(previewAnswer()); await settle(); });
    act(() => { vi.advanceTimersByTime(ANNOUNCE_DELAY_MS); });
    const spoken = within(dialog()).getAllByRole("status").map((el) => el.textContent);
    expect(spoken.some((text) => /^Öncədən baxış hazırdır: cəmi 4\./.test(text))).toBe(true);
  });

  it("a 403 on the preview closes the form, as one on the signature does, and says the engine's own reason when it sent one", async () => {
    let { onClose } = await open({ api: { preview: vi.fn(() => Promise.reject(refusal(403, "skor formunu yalnız bir kişi imzalayabilir"))) } });
    await correctPlatelets();
    await press(button("Öncədən baxın"));
    expect(toasted(`${BED} üçün öncədən baxış alınmadı: Bal formasını yalnız bir nəfər imzalaya bilər.`).length).toBeGreaterThan(0);
    expect(onClose).toHaveBeenCalledWith(false);
    cleanup();
    ({ onClose } = await open({ api: { sign: vi.fn(() => Promise.reject(refusal(403, "İstek başarısız (403)"))) } }));
    await correctPlatelets();
    await previewed();
    await press(button("İmzalayın"));
    expect(toasted(`${BED} üçün imza rədd edildi: Bu hesabın imza səlahiyyəti yoxdur.`).length).toBeGreaterThan(0);   // no reason sent: the right
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("a 403 that is not a missing right — a scope's refusal — is said in the engine's words, not as \"no right\"", async () => {
    // No SOFA route sends a scope 403 today (a patient out of scope is a 404, an unreadable scope a 503): the
    // engine's own scope sentence (scope/router.py) stands in for one, as it would arrive.
    const scope = "kapsam atamak için kapsamı sınırsız bir yönetici olmalısınız";
    const { onClose } = await open({ api: { sign: vi.fn(() => Promise.reject(refusal(403, scope))) } });
    await correctPlatelets();
    await previewed();
    await press(button("İmzalayın"));
    expect(toasted(`${BED} üçün imza rədd edildi: Əhatə təyin etmək üçün əhatəsi məhdud olmayan administrator olmalısınız.`).length).toBeGreaterThan(0);
    expect(toasted(/Bu hesabın imza səlahiyyəti yoxdur/)).toHaveLength(0);
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("a Save during a preview is held visibly — «Yadda saxla» says it is busy, nothing is sent — and goes once the preview has landed", async () => {
    let land;
    const { api } = await open({ api: { preview: vi.fn(() => new Promise((resolve) => { land = resolve; })) } });
    await correctPlatelets();
    await press(within(organ("Qaraciyər")).getByRole("button", { name: "Ölçmə daxil edin: Bilirubin səviyyəsi" }));
    fireEvent.change(within(chartEntry("Bilirubin səviyyəsi")).getByLabelText(/Bilirubin səviyyəsi/), { target: { value: "2,4" } });
    await press(button("Öncədən baxın"));
    const save = within(chartEntry("Bilirubin səviyyəsi")).getByRole("button", { name: "Yadda saxla" });
    expect(save).toHaveAttribute("aria-busy", "true");
    await press(save);
    expect(api.chart).not.toHaveBeenCalled();
    await act(async () => { land(previewAnswer()); await settle(); });
    await press(within(chartEntry("Bilirubin səviyyəsi")).getByRole("button", { name: "Yadda saxla" }));
    expect(api.chart).toHaveBeenCalledTimes(1);
  });

  it("a null answer — the store dropped it after the session ended — says nothing and closes nothing, for a preview and a signature alike", async () => {
    let { onClose } = await open({ api: { preview: vi.fn(() => Promise.resolve(null)) } });
    await correctPlatelets();
    const before = footer().textContent;
    await previewed();
    expect(toastText()).toBe("");
    expect(footer().textContent).toBe(before);
    expect(within(dialog()).queryByRole("button", { name: "İmzalayın" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
    ({ onClose } = await open({ api: { sign: vi.fn(() => Promise.resolve(null)) } }));
    await correctPlatelets();
    await previewed();
    const previewedSaid = footer().textContent;
    await press(button("İmzalayın"));
    expect(toastText()).toBe("");
    expect(footer().textContent).toBe(previewedSaid);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a read answered with null — dropped after the session ended — lands nothing: the form shown stays, and «no form» is never said", async () => {
    const read = vi.fn().mockResolvedValueOnce(sofaForm()).mockResolvedValueOnce(null);
    await open({ api: { read } });
    await chartBilirubin();
    expect(read).toHaveBeenCalledTimes(2);
    expect(within(dialog()).getByText("Cəmi: 5")).toBeInTheDocument();
    expect(dialog()).not.toHaveTextContent("göndərmədi");
    cleanup();
    await open({ api: { read: vi.fn(() => Promise.resolve(null)) } });
    expect(within(dialog()).getByText("SOFA forması oxunur…")).toBeInTheDocument();
    expect(dialog()).not.toHaveTextContent("göndərmədi");
  });

  it("a close with corrections held says they were dropped, and closes all the same; a close with none says nothing", async () => {
    let { onClose } = await open();
    await correctPlatelets();
    await press(within(dialog()).getAllByRole("button", { name: "Bağla" })[0]);          // the ✕
    const said = `${BED}: forma bağlandı, imzalanmamış düzəlişlər ləğv edildi.`;
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(toneOf(said)).toBe("warn");
    expect(onClose).toHaveBeenCalledWith(false);
    cleanup();
    ({ onClose } = await open());
    await correctPlatelets();
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); await settle(); });
    expect(toasted(said).length).toBeGreaterThan(0);
    expect(onClose).toHaveBeenCalledWith(false);
    cleanup();
    ({ onClose } = await open());
    await press(within(dialog()).getAllByRole("button", { name: "Bağla" }).at(-1));       // the footer's
    expect(toasted(said)).toHaveLength(0);
    expect(onClose).toHaveBeenCalledWith(false);
  });
});

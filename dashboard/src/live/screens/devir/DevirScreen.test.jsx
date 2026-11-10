// DevirScreen.test.jsx — «Vardiya devri» (G2-B3b, spec D9; owner D1: one patient per handover with a D-Ö-D-Ö note
// and a sealed system summary; D2: the outgoing person chooses the receiver). The screen's three lists, the
// countersignature, an OPEN handover's signature, and the «Yeni devir» dialog with the live critical check. Rendered
// in Azerbaijani. Synthetic patients, accounts and cards only.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { NOW, ago, alarm, board, entry, identity, measured } from "../../data/board.testutil.js";
import { REA, row as admissionRow } from "../kabul/kabul.testutil.js";
import { hhmm } from "../../i18n/dates.js";
import { DevirScreen } from "./DevirScreen.jsx";

const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });

/** A nurse as the engine seeds one (auth/permissions.py `nurse`): she reads admissions and signs handovers. */
const NURSE = ["board.view", "alerts.ack", "admissions.view", "admissions.admit", "handover.sign", "clinical.chart"];

const ME = { id: "u-ayse", name: "Ayşe Sentetik" };
const LEYLA = { id: "u-leyla", name: "Leyla Sentetik" };
const PATIENT = { admission_id: "a-2", board_key: "S-001", display_name: "Kamran Sentetik", bed_label: "REA-01 · 2", unit_name: "Reanimasiya" };
const SUBJECT = "REA-01 · 2 · Reanimasiya";
const NOTE = {
  situation: "Stabil, postoperatif 2. gün",
  background: "Batın cerrahisi, alerji yok",
  assessment: "Vitaller normal bantta",
  recommendation: "Sabah mobilizasyon, dren takibi",
};
const SUMMARY = {
  risk: "moderate", news2: { total: 5, partial: true },
  latest: { heart_rate: 96, map: 72, spo2: 91, resp_rate: 22, temperature: 38.2 },
  on_pressor: true, open_alerts: [{ kind: "news2", severity: "high", acknowledged: false }], captured_at: ago(300),
};
const LATER = new Date(NOW + 20 * 60_000).toISOString();          // a bridge still open

/** One handover as GET /handovers answers it (spec D7). */
const handover = (id, status, over = {}) => ({
  id, status, created_at: ago(900), bridge_expires_at: LATER, outgoing_signed_at: null, incoming_signed_at: null,
  outgoing: LEYLA, incoming: ME, patients: [PATIENT], note: null, summary: null, ...over,
});
/** Handed to me by Leyla, signed five minutes ago, waiting for my countersignature. */
const TO_ME = handover("h-in", "OUTGOING_SIGNED", { outgoing_signed_at: ago(300), note: NOTE, summary: SUMMARY });
/** Mine, opened, not yet signed. */
const MINE_OPEN = handover("h-open", "OPEN", { outgoing: ME, incoming: LEYLA });

/** An admission of my unit as GET /admissions answers it, keyed on the board as S-001. */
const ADMISSION = admissionRow({ id: "a-2", board_key: "S-001", bed_label: "2", unit_name: "Reanimasiya", display_name: "Kamran Sentetik" });
const NEW_SUBJECT = "2 · Reanimasiya";

const CARD = { identity: identity(), at: measured(30) };
const CRITICAL = board([entry("S-001", [alarm("sepsis", "critical", { summary: "Sepsis criteria met" })], { ...CARD, risk: "critical" })]);
const QUIET = board([entry("S-001", [], CARD)]);

/** The screen in a real session and board store. `boxes` is what GET /handovers answers, by box — a function to
 *  answer differently once something was written. `payload` the board's cards. */
async function open({ boxes = { incoming: [TO_ME], outgoing: [MINE_OPEN] }, payload = QUIET, perms = NURSE, setup } = {}) {
  const answer = typeof boxes === "function" ? boxes : () => boxes;
  const mounted = await mount(<DevirScreen />, {
    access: token({ perms }),
    me: profile({ perms }),
    setup: (api) => {
      api.boardPatients.mockResolvedValue(payload);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.handovers.mockImplementation((box) => Promise.resolve(answer()[box] ?? []));
      api.handoverColleagues.mockResolvedValue([LEYLA, { id: "u-murad", name: "Murad Sentetik" }]);
      api.admissions.mockResolvedValue([ADMISSION]);
      setup?.(api);
    },
  });
  await act(async () => { await mounted.board.start(); });
  await act(async () => { mounted.stream.open(); await new Promise((resolve) => { setTimeout(resolve, 0); }); });
  await settle();
  return mounted;
}

const TO_COUNTERSIGN = "Əks-imzanızı gözləyənlər";
const MINE = "Mənim təhvil verdiklərim";
const RECENT = "Son 24 saat ərzində";
const listOf = (name) => screen.getByRole("region", { name });
const toasts = () => within(screen.getByRole("region", { name: "Bildirişlər" }));
// The toast host keeps an empty sr-only role="alert" live region mounted (ui/Toast.jsx): the page's own alerts are
// the visible ones.
const pageAlerts = () => screen.queryAllByRole("alert").filter((el) => !el.classList.contains("sr-only"));
const theAlert = () => {
  const found = pageAlerts();
  expect(found).toHaveLength(1);
  return found[0];
};
const press = async (el) => { await act(async () => { fireEvent.click(el); }); await settle(); };
const dialog = () => screen.getByRole("dialog");
/** A description list's value under the term `label`, as one line of text. */
const valueOf = (root, label) => {
  const term = [...root.querySelectorAll("dt")].find((dt) => dt.textContent === label);
  expect(term, label).toBeTruthy();
  return term.nextElementSibling.textContent.replace(/\s+/g, " ").trim();
};
const COUNTERSIGN = /^Oxudum, əks-imza at/;
const SIGN = /^İmza at/;

beforeEach(() => vi.setSystemTime(NOW));
afterEach(() => {
  resetScreens();
  vi.useRealTimers();
});

describe("«Vardiya devri»", () => {
  it("names itself once, says a handover takes two signatures, and reads both of my boxes", async () => {
    const { api } = await open();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Növbə təhvili"]);
    expect(screen.getByText(/^Təhvil iki imzalıdır: gedən imzalayır, gələn əks-imza atır\./)).toBeInTheDocument();
    expect(api.handovers).toHaveBeenCalledWith("incoming");
    expect(api.handovers).toHaveBeenCalledWith("outgoing");
    for (const name of [TO_COUNTERSIGN, MINE, RECENT]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    // Nothing is fetched for the dialog until it is opened.
    expect(api.admissions).not.toHaveBeenCalled();
    expect(api.handoverColleagues).not.toHaveBeenCalled();
  });

  it("a handover to countersign shows the bed linked to the patient, who handed over and when, the note and the summary", async () => {
    await open();
    const list = listOf(TO_COUNTERSIGN);
    const link = within(list).getByRole("link", { name: SUBJECT });
    expect(link).toHaveAttribute("href", "#/patients/S-001");
    const row = link.closest("li");
    expect(row).toHaveTextContent("Kamran Sentetik");
    expect(row).toHaveTextContent("Leyla Sentetik → Ayşe Sentetik");
    expect(row).toHaveTextContent(`imzalanıb: ${hhmm(NOW - 300_000)}`);
    // The sealed D-Ö-D-Ö note, each part under its own label.
    expect(row).toHaveTextContent("V · Vəziyyət");
    expect(row).toHaveTextContent("Stabil, postoperatif 2. gün");
    expect(row).toHaveTextContent("T · Tövsiyə");
    expect(row).toHaveTextContent("Sabah mobilizasyon, dren takibi");
    // The system summary, as the board had it at the signature — plain values with their units.
    const summary = within(row).getByText("Sistem xülasəsi · imza anındakı məlumat").closest("section");
    expect(summary).toHaveTextContent(`oxunub: ${hhmm(NOW - 300_000)}`);
    expect(valueOf(summary, "Risk")).toBe("Orta");
    expect(valueOf(summary, "NEWS2")).toBe("5 · qismən");
    expect(valueOf(summary, "Nəbz")).toBe("96 /dəq");
    expect(valueOf(summary, "OAT")).toBe("72 mmHg");
    expect(valueOf(summary, "SpO₂")).toBe("91 %");
    expect(valueOf(summary, "Tənəffüs")).toBe("22 /dəq");
    expect(valueOf(summary, "Hərarət")).toBe("38.2 °C");
    expect(valueOf(summary, "Vazopressor")).toBe("bəli");
    expect(valueOf(summary, "Açıq siqnallar")).toBe("news2 · Yüksək · təsdiqlənməyib");
    expect(within(summary).getByRole("link", { name: "Cari məlumat: xəstəni aç" })).toHaveAttribute("href", "#/patients/S-001");
    expect(within(row).getByRole("button", { name: COUNTERSIGN })).toHaveAccessibleName(`Oxudum, əks-imza at: ${SUBJECT}`);
  });

  it("a summary taken before the patient was ever measured says so", async () => {
    await open({ boxes: { incoming: [{ ...TO_ME, summary: { captured_at: ago(300) } }], outgoing: [] } });
    expect(within(listOf(TO_COUNTERSIGN)).getByText("İmza anında lövhədə bu xəstənin ölçməsi yox idi.")).toBeInTheDocument();
  });

  it("«Okudum, karşı imzala» countersigns, says so naming the bed, and reads both boxes again", async () => {
    let signed = false;
    const done = { ...TO_ME, status: "COMPLETED", incoming_signed_at: ago(0) };
    const { api } = await open({
      boxes: () => ({ incoming: [signed ? done : TO_ME], outgoing: [] }),
      setup: (fake) => fake.countersignHandover.mockImplementation(async () => { signed = true; return { id: "h-in" }; }),
    });
    await press(within(listOf(TO_COUNTERSIGN)).getByRole("button", { name: COUNTERSIGN }));
    expect(api.countersignHandover).toHaveBeenCalledWith("h-in");
    expect(toasts().getAllByText(`${SUBJECT}: əks-imza atıldı; təhvil tamamlandı.`).length).toBeGreaterThan(0);
    expect(api.handovers).toHaveBeenCalledTimes(4);
    expect(within(listOf(TO_COUNTERSIGN)).getByText("Əks-imzanızı gözləyən təhvil yoxdur.")).toBeInTheDocument();
    const recent = within(listOf(RECENT)).getByRole("link", { name: SUBJECT }).closest("li");
    expect(recent).toHaveTextContent("Tamamlanıb");
    expect(recent).toHaveTextContent(`əks-imza: ${hhmm(NOW)}`);
  });

  it("a refused countersignature is a toast naming the bed, and the handover stays to be countersigned", async () => {
    const { api } = await open({
      setup: (fake) => fake.countersignHandover.mockRejectedValue(
        refusal(409, "Outgoing clinician must sign before countersignature.", { apiCode: "invalid_transition" })),
    });
    await press(within(listOf(TO_COUNTERSIGN)).getByRole("button", { name: COUNTERSIGN }));
    expect(api.countersignHandover).toHaveBeenCalledWith("h-in");
    const said = toasts().getAllByText(new RegExp(`^${SUBJECT}: əks-imza atılmadı — `));
    expect(said.map((n) => n.textContent).join(" ")).toContain("Qeyd bu əməliyyat üçün uyğun vəziyyətdə deyil");
    expect(within(listOf(TO_COUNTERSIGN)).getByRole("button", { name: COUNTERSIGN })).toBeInTheDocument();
    expect(within(listOf(TO_COUNTERSIGN)).getByText("Stabil, postoperatif 2. gün")).toBeInTheDocument();
  });

  it("a countersignature that got no answer may have gone through: a warning, not a refusal", async () => {
    await open({
      setup: (fake) => fake.countersignHandover.mockRejectedValue(Object.assign(new Error("…"), { code: "REQUEST_TIMEOUT" })),
    });
    await press(within(listOf(TO_COUNTERSIGN)).getByRole("button", { name: COUNTERSIGN }));
    const said = toasts().getAllByText(`${SUBJECT}: cavab gəlmədi — əməliyyat qeydə alınmış ola bilər. Siyahıya baxın.`);
    expect(said.map((n) => n.closest("[data-tone]")?.getAttribute("data-tone"))).toContain("warn");
    expect(toasts().queryAllByText(/əks-imza atılmadı/)).toHaveLength(0);
  });

  describe("an OPEN handover of mine", () => {
    it("waits for my signature; «İmzala» opens the note step and signs with what I wrote", async () => {
      let sent = false;
      const signedRow = { ...MINE_OPEN, status: "OUTGOING_SIGNED", outgoing_signed_at: ago(0) };
      const { api } = await open({
        boxes: () => ({ incoming: [], outgoing: [sent ? signedRow : MINE_OPEN] }),
        setup: (fake) => fake.signHandover.mockImplementation(async () => { sent = true; return { id: "h-open" }; }),
      });
      const row = within(listOf(MINE)).getByRole("link", { name: SUBJECT }).closest("li");
      expect(row).toHaveTextContent("İmza gözlənilir");
      expect(row).toHaveTextContent("Ayşe Sentetik → Leyla Sentetik");
      await press(within(row).getByRole("button", { name: SIGN }));
      expect(api.signHandover).not.toHaveBeenCalled();
      expect(dialog()).toHaveAccessibleName(`Təhvili imzala · ${SUBJECT}`);
      fireEvent.change(within(dialog()).getByRole("textbox", { name: "V · Vəziyyət" }), { target: { value: "  Stabil gecə  " } });
      await press(within(dialog()).getByRole("button", { name: "İmza at" }));
      expect(api.signHandover).toHaveBeenCalledWith("h-open", {
        situation: "Stabil gecə", background: null, assessment: null, recommendation: null,
      });
      expect(api.openHandover).not.toHaveBeenCalled();
      expect(toasts().getAllByText(`${SUBJECT}: təhvil imzalandı; əks-imza gözlənilir.`).length).toBeGreaterThan(0);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(within(listOf(MINE)).getByText("Əks-imza gözlənilir")).toBeInTheDocument();
    });

    it("with a note already stored, «İmzala» signs it as it is", async () => {
      const { api } = await open({
        boxes: { incoming: [], outgoing: [{ ...MINE_OPEN, note: NOTE }] },
        setup: (fake) => fake.signHandover.mockResolvedValue({ id: "h-open" }),
      });
      await press(within(listOf(MINE)).getByRole("button", { name: SIGN }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(api.signHandover).toHaveBeenCalledWith("h-open", NOTE);
    });

    it("past its 30-minute bridge, it says so and offers no signature", async () => {
      await open({ boxes: { incoming: [], outgoing: [{ ...MINE_OPEN, bridge_expires_at: ago(60) }] } });
      const row = within(listOf(MINE)).getByRole("link", { name: SUBJECT }).closest("li");
      expect(row).toHaveTextContent("Müddəti bitib — yeni təhvil açın.");
      expect(within(row).queryByRole("button", { name: SIGN })).toBeNull();
    });

    it("whose patient the board shows an unanswered critical alarm is locked, with a way to the alarm", async () => {
      const { api } = await open({ boxes: { incoming: [], outgoing: [MINE_OPEN] }, payload: CRITICAL });
      const row = within(listOf(MINE)).getByRole("link", { name: SUBJECT }).closest("li");
      expect(row).toHaveTextContent("İmzalana bilməz: bu xəstədə cavablanmamış kritik siqnal var.");
      expect(within(row).getByRole("link", { name: "Siqnala keç" })).toHaveAttribute("href", "#/alarms");
      const sign = within(row).getByRole("button", { name: SIGN });
      expect(sign).toHaveAttribute("aria-disabled", "true");
      await press(sign);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(api.signHandover).not.toHaveBeenCalled();
    });

    // The engine holds the signature by the live board (D3); the discharge's sentence (`kabul.err.criticalAlarmOpen`)
    // would say a DISCHARGE cannot start.
    it("a signature the server holds for a critical alarm is said in the handover's own words", async () => {
      await open({
        boxes: { incoming: [], outgoing: [{ ...MINE_OPEN, note: NOTE }] },
        setup: (fake) => fake.signHandover.mockRejectedValue(
          refusal(409, "Handover blocked: 1 unacknowledged CRITICAL alert(s).", { apiCode: "critical_alarm_open" })),
      });
      await press(within(listOf(MINE)).getByRole("button", { name: SIGN }));
      expect(toasts().getAllByText(`${SUBJECT}: təhvil imzalanmadı — bu xəstədə cavablanmamış kritik siqnal var`).length)
        .toBeGreaterThan(0);
      expect(toasts().queryAllByText(/evə yazılma/)).toHaveLength(0);
      expect(within(listOf(MINE)).getByText("İmza gözlənilir")).toBeInTheDocument();
    });
  });

  it("a handover waiting for its receiver says so, and offers nothing to press", async () => {
    await open({ boxes: { incoming: [], outgoing: [{ ...MINE_OPEN, status: "OUTGOING_SIGNED", outgoing_signed_at: ago(120) }] } });
    const row = within(listOf(MINE)).getByRole("link", { name: SUBJECT }).closest("li");
    expect(row).toHaveTextContent("Əks-imza gözlənilir");
    expect(row).toHaveTextContent(`imzalanıb: ${hhmm(NOW - 120_000)}`);
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });

  // The engine reports an OPEN handover past its bridge as EXPIRED (D7): it is in the last 24 hours, said as lapsed.
  it("a handover the server reports EXPIRED is in the last 24 hours, said as lapsed, with nothing to press", async () => {
    await open({ boxes: { incoming: [], outgoing: [{ ...MINE_OPEN, status: "EXPIRED", bridge_expires_at: ago(600) }] } });
    expect(within(listOf(MINE)).getByText("İmza və ya əks-imza gözləyən təhviliniz yoxdur.")).toBeInTheDocument();
    const row = within(listOf(RECENT)).getByRole("link", { name: SUBJECT }).closest("li");
    expect(row).toHaveTextContent("Müddəti bitib");
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });

  it("each list says when it is empty", async () => {
    await open({ boxes: { incoming: [], outgoing: [] } });
    expect(within(listOf(TO_COUNTERSIGN)).getByText("Əks-imzanızı gözləyən təhvil yoxdur.")).toBeInTheDocument();
    expect(within(listOf(MINE)).getByText("İmza və ya əks-imza gözləyən təhviliniz yoxdur.")).toBeInTheDocument();
    expect(within(listOf(RECENT)).getByText("Son 24 saatda tamamlanan və ya müddəti bitən təhvil yoxdur.")).toBeInTheDocument();
  });

  it("a read failure is an alert with a retry, which reads both boxes again", async () => {
    let fail = true;
    const { api } = await open({
      setup: (fake) => fake.handovers.mockImplementation((box) => (fail
        ? Promise.reject(refusal(403, "permission required: handover.sign"))
        : Promise.resolve(box === "incoming" ? [TO_ME] : []))),
    });
    expect(theAlert()).toHaveTextContent("Təhvillər oxunmadı:");
    expect(screen.queryByText("Əks-imzanızı gözləyən təhvil yoxdur.")).toBeNull();     // an unread list is not an empty one
    fail = false;
    await press(within(theAlert()).getByRole("button", { name: "Yenidən cəhd et" }));
    expect(api.handovers).toHaveBeenCalledTimes(4);
    expect(pageAlerts()).toHaveLength(0);
    expect(within(listOf(TO_COUNTERSIGN)).getByRole("link", { name: SUBJECT })).toBeInTheDocument();
  });
});

describe("«Yeni devir»", () => {
  const openDialog = async () => { await press(screen.getByRole("button", { name: "Yeni təhvil" })); };
  const choose = (name, value) => fireEvent.change(within(dialog()).getByRole("combobox", { name }), { target: { value } });
  const write = (name, value) => fireEvent.change(within(dialog()).getByRole("textbox", { name }), { target: { value } });
  const SEND = "Təhvil ver və imzala";
  /** Patient, receiver and a valid note — everything a send needs. */
  const fill = () => {
    choose("Xəstə", "a-2");
    choose("Təhvil alacaq şəxs", "u-leyla");
    write("V · Vəziyyət", "Stabil, postoperatif 2. gün");
    write("T · Tövsiyə", "Sabah mobilizasyon");
  };

  it("offers the open admissions of my units and the colleagues I can hand over to, and the four parts of the note", async () => {
    const { api } = await open();
    await openDialog();
    expect(dialog()).toHaveAccessibleName("Yeni təhvil");
    expect(api.admissions).toHaveBeenCalledWith(["ACTIVE", "PENDING_DISCHARGE", "PENDING_TRANSFER"]);
    expect(api.handoverColleagues).toHaveBeenCalled();
    const patients = within(within(dialog()).getByRole("combobox", { name: "Xəstə" })).getAllByRole("option").map((o) => o.textContent);
    expect(patients).toContain(`${NEW_SUBJECT} · Kamran Sentetik`);
    const people = within(within(dialog()).getByRole("combobox", { name: "Təhvil alacaq şəxs" })).getAllByRole("option").map((o) => o.textContent);
    expect(people).toEqual(expect.arrayContaining(["Leyla Sentetik", "Murad Sentetik"]));
    for (const part of ["V · Vəziyyət", "A · Anamnez", "Q · Qiymətləndirmə", "T · Tövsiyə"]) {
      expect(within(dialog()).getByRole("textbox", { name: part })).toHaveAccessibleDescription(/ad və ya şəxsiyyət nömrəsi yazmayın/);
    }
  });

  it("a patient the board shows an unanswered critical alarm cannot be handed over: the lock, a way to the alarm, nothing sent", async () => {
    const { api } = await open({ payload: CRITICAL });
    await openDialog();
    fill();
    expect(within(dialog()).getByText("İmzalana bilməz: bu xəstədə cavablanmamış kritik siqnal var.")).toBeInTheDocument();
    expect(within(dialog()).getByRole("link", { name: "Siqnala keç" })).toHaveAttribute("href", "#/alarms");
    await press(within(dialog()).getByRole("button", { name: SEND }));
    expect(api.openHandover).not.toHaveBeenCalled();
    expect(api.signHandover).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it("a note with nothing written says so and takes the focus to its first part", async () => {
    const { api } = await open();
    await openDialog();
    choose("Xəstə", "a-2");
    choose("Təhvil alacaq şəxs", "u-leyla");
    write("Q · Qiymətləndirmə", " ab ");
    await press(within(dialog()).getByRole("button", { name: SEND }));
    expect(api.openHandover).not.toHaveBeenCalled();
    const first = within(dialog()).getByRole("textbox", { name: "V · Vəziyyət" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-invalid", "true");
    expect(first).toHaveAccessibleDescription(/^Qeydin ən azı bir bölməsində 3 simvol yazın\./);
  });

  it("a patient and a receiver are asked for before anything is sent", async () => {
    const { api } = await open();
    await openDialog();
    write("V · Vəziyyət", "Stabil gecə");
    await press(within(dialog()).getByRole("button", { name: SEND }));
    expect(api.openHandover).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole("combobox", { name: "Xəstə" })).toHaveFocus();
    expect(within(dialog()).getByText("Xəstəni seçin.")).toBeInTheDocument();
    expect(within(dialog()).getByText("Təhvil alacaq şəxsi seçin.")).toBeInTheDocument();
  });

  it("a valid send opens the handover, signs it with the note, says so naming the bed and reads the boxes again", async () => {
    const { api } = await open({
      setup: (fake) => {
        fake.openHandover.mockResolvedValue({ id: "h-new", status: "OPEN" });
        fake.signHandover.mockResolvedValue({ id: "h-new", status: "OUTGOING_SIGNED" });
      },
    });
    await openDialog();
    fill();
    await press(within(dialog()).getByRole("button", { name: SEND }));
    expect(api.openHandover).toHaveBeenCalledWith({ unitId: REA, incomingUserId: "u-leyla", admissionId: "a-2" });
    expect(api.signHandover).toHaveBeenCalledWith("h-new", {
      situation: "Stabil, postoperatif 2. gün", background: null, assessment: null, recommendation: "Sabah mobilizasyon",
    });
    expect(toasts().getAllByText(`${NEW_SUBJECT}: təhvil verildi və imzalandı; əks-imza gözlənilir.`).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.handovers).toHaveBeenCalledTimes(4);
  });

  it("a signature the server holds for a critical alarm leaves the handover OPEN, and the dialog says so in its own words", async () => {
    const { api } = await open({
      setup: (fake) => {
        fake.openHandover.mockResolvedValue({ id: "h-new", status: "OPEN" });
        fake.signHandover.mockRejectedValue(
          refusal(409, "Handover blocked: 1 unacknowledged CRITICAL alert(s).", { apiCode: "critical_alarm_open" }));
      },
    });
    await openDialog();
    fill();
    await press(within(dialog()).getByRole("button", { name: SEND }));
    expect(dialog()).toHaveTextContent(/^.*Təhvil açıldı, amma imzalanmadı: bu xəstədə cavablanmamış kritik siqnal var\./);
    expect(within(dialog()).getByRole("link", { name: "Siqnala keç" })).toHaveAttribute("href", "#/alarms");
    expect(dialog()).not.toHaveTextContent("evə yazılma");                 // not the discharge's sentence
    expect(api.handovers).toHaveBeenCalledTimes(4);                         // the OPEN one is on the list behind it
    // Pressed again, it signs the handover already opened — it opens no second one.
    await press(within(dialog()).getByRole("button", { name: "İmza at" }));
    expect(api.openHandover).toHaveBeenCalledTimes(1);
    expect(api.signHandover).toHaveBeenCalledTimes(2);
    expect(api.signHandover.mock.calls.map((call) => call[0])).toEqual(["h-new", "h-new"]);
  });

  // A refused note (D5: a control character in a part — a coded 422) is the note's to fix: the handover is OPEN, the
  // dialog keeps the note, and the next press signs the one already opened.
  it("a note the server refuses keeps the dialog and the note; the handover opened is the one signed next", async () => {
    const { api } = await open({
      setup: (fake) => {
        fake.openHandover.mockResolvedValue({ id: "h-new", status: "OPEN" });
        fake.signHandover.mockRejectedValueOnce(
          refusal(422, "situation: Value error", { apiCode: "field_invalid:situation" })).mockResolvedValue({ id: "h-new" });
      },
    });
    await openDialog();
    fill();
    await press(within(dialog()).getByRole("button", { name: SEND }));
    expect(toasts().getAllByText(`${NEW_SUBJECT}: təhvil imzalanmadı — Qeydin «V · Vəziyyət» bölməsində istifadə oluna bilməyən simvol var.`)
      .length).toBeGreaterThan(0);
    expect(within(dialog()).getByRole("textbox", { name: "V · Vəziyyət" })).toHaveValue("Stabil, postoperatif 2. gün");
    write("V · Vəziyyət", "Stabil");
    await press(within(dialog()).getByRole("button", { name: "İmza at" }));
    expect(api.openHandover).toHaveBeenCalledTimes(1);
    expect(api.signHandover).toHaveBeenLastCalledWith("h-new", expect.objectContaining({ situation: "Stabil" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["a timeout", () => Object.assign(new Error("…"), { code: "REQUEST_TIMEOUT" })],
    ["a 502", () => refusal(502, "Bad Gateway")],
  ])("a send that got no answer (%s) may have gone through: a warning, the dialog closes, the boxes are read again", async (_, failure) => {
    const { api } = await open({
      setup: (fake) => {
        fake.openHandover.mockResolvedValue({ id: "h-new", status: "OPEN" });
        fake.signHandover.mockRejectedValue(failure());
      },
    });
    await openDialog();
    fill();
    await press(within(dialog()).getByRole("button", { name: SEND }));
    const said = toasts().getAllByText(`${NEW_SUBJECT}: cavab gəlmədi — əməliyyat qeydə alınmış ola bilər. Siyahıya baxın.`);
    expect(said.map((n) => n.closest("[data-tone]")?.getAttribute("data-tone"))).toContain("warn");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.handovers).toHaveBeenCalledTimes(4);
  });

  it("an opening the server refuses keeps the dialog and the note, and names the bed", async () => {
    const { api } = await open({
      setup: (fake) => fake.openHandover.mockRejectedValue(
        refusal(403, "Admission is outside your units.", { apiCode: "out_of_scope" })),
    });
    await openDialog();
    fill();
    await press(within(dialog()).getByRole("button", { name: SEND }));
    expect(api.signHandover).not.toHaveBeenCalled();
    expect(toasts().getAllByText(new RegExp(`^${NEW_SUBJECT}: təhvil açılmadı — Bu çarpayı sizin şöbələrinizdən birində deyil\\.`)).length)
      .toBeGreaterThan(0);
    expect(within(dialog()).getByRole("textbox", { name: "V · Vəziyyət" })).toHaveValue("Stabil, postoperatif 2. gün");
  });

  it("a patient or colleague list that cannot be read says so, with a retry", async () => {
    let fail = true;
    const { api } = await open({
      setup: (fake) => fake.handoverColleagues.mockImplementation(() => (fail
        ? Promise.reject(refusal(500, "Internal Server Error")) : Promise.resolve([LEYLA]))),
    });
    await openDialog();
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("Xəstə və ya şəxs siyahısı oxunmadı:");
    fail = false;
    await press(within(dialog()).getByRole("button", { name: "Yenidən cəhd et" }));
    expect(api.handoverColleagues).toHaveBeenCalledTimes(2);
    expect(within(dialog()).queryByRole("alert")).toBeNull();
    expect(within(within(dialog()).getByRole("combobox", { name: "Təhvil alacaq şəxs" })).getAllByRole("option").map((o) => o.textContent))
      .toContain("Leyla Sentetik");
  });
});

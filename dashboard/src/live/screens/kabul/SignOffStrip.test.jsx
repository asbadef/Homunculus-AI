// "Hekim imzası bekliyor" on the patient screen and the bed card (Group 2 · B1a, spec D3, §3.2,
// §5.5, X60, X61): shown for a DRAFT admission only; a physician signs from the strip; the bed
// board reads the DRAFT admissions every minute while it is open — and never without
// `admissions.view`. The bed is named as the slice names it, "label · room · unit", never by a UUID.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { patientFromBoard } from "../../../liveAdapters.js";
import { board, entry, identity, measured } from "../../data/board.testutil.js";
import { answering } from "../patient/trends/trends.testutil.js";
import { BedCard } from "../beds/BedCard.jsx";
import { BedsScreen } from "../beds/BedsScreen.jsx";
import { PatientScreen } from "../patient/PatientScreen.jsx";
import { SignOffStrip } from "./SignOffStrip.jsx";
import { BED, DOCTOR, NURSE, REA, expectNoUuid, mountKabul, row, settle, toasts } from "./kabul.testutil.js";

const DRAFT = [row({ id: "a-7", patient_number: "H2600007", state: "DRAFT" })];
const BED_2 = "2 · Otaq 1 · Reanimasiya";
const SIGN = `Qəbulu imzala: ${BED_2}`;
const WAITS = /^Həkim imzası gözlənilir —/;
const BADGE = "Həkim imzası gözlənilir";

/** A `kabul` card as the board sends it: placed by its own bed, named, measured. */
const kabulCard = (id, label) => entry(id, [], {
  identity: identity({ patient_id: id, display_name: "Sentetik Hasta", bed_label: label, source: "kabul",
    bed_id: BED(2), unit_id: REA, bed_key: null }),
  at: measured(30),
});

describe("SignOffStrip", () => {
  it("reads the DRAFT admissions and says the patient waits for a signature", async () => {
    const { api } = await mountKabul(<SignOffStrip patientId="H2600007" />,
      { perms: NURSE, setup: (a) => a.admissions.mockResolvedValue(DRAFT) });
    expect(api.admissions).toHaveBeenCalledWith(["DRAFT"]);
    expect(screen.getByText(WAITS)).toBeTruthy();
    // A nurse cannot sign: the strip says who can, rather than showing one control fewer in silence.
    expect(screen.queryByRole("button", { name: /Qəbulu imzala/ })).toBeNull();
    expect(screen.getByText("İmzanı yalnız qəbulu təsdiqləmək səlahiyyəti olan həkim atır.")).toBeTruthy();
    expectNoUuid();
  });

  it("is not there for a patient whose admission is signed", async () => {
    await mountKabul(<SignOffStrip patientId="H2600001" />,
      { perms: DOCTOR, setup: (a) => a.admissions.mockResolvedValue(DRAFT) });
    expect(screen.queryByText(WAITS)).toBeNull();
    expect(screen.queryByRole("button", { name: /Qəbulu imzala/ })).toBeNull();
  });

  it("reads nothing and shows nothing in a session without admissions.view", async () => {
    const { api } = await mountKabul(<SignOffStrip patientId="H2600007" />,
      { perms: ["board.view", "clinical.chart"], setup: (a) => a.admissions.mockResolvedValue(DRAFT) });
    expect(api.admissions).not.toHaveBeenCalled();
    expect(screen.queryByText(WAITS)).toBeNull();
  });

  it("lets a physician sign: the button and the toast name the bed, and the strip goes", async () => {
    const { api } = await mountKabul(<SignOffStrip patientId="H2600007" />, {
      perms: DOCTOR,
      setup: (a) => {
        a.admissions.mockResolvedValueOnce(DRAFT).mockResolvedValue([]);
        a.signOffAdmission.mockResolvedValue({ id: "a-7", state: "ACTIVE" });
      },
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: SIGN })); });
    await settle();
    expect(api.signOffAdmission).toHaveBeenCalledWith("a-7");
    expect(toasts().getAllByText(`${BED_2} · qəbul imzalandı`).length).toBeGreaterThan(0);
    expect(screen.queryByText(WAITS)).toBeNull();
    expectNoUuid();
  });

  it("sends one signature however often it is pressed, and holds the button until the list is read again", async () => {
    let answer;
    let reread;
    const { api } = await mountKabul(<SignOffStrip patientId="H2600007" />, {
      perms: DOCTOR,
      setup: (a) => {
        a.admissions.mockResolvedValueOnce(DRAFT).mockImplementation(() => new Promise((resolve) => { reread = resolve; }));
        a.signOffAdmission.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
      },
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: SIGN })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: SIGN })); });
    expect(api.signOffAdmission).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: SIGN })).toHaveAttribute("aria-busy", "true");
    await act(async () => { answer({ id: "a-7", state: "ACTIVE" }); });
    await settle();
    // Signed, but the list on screen still holds the DRAFT: a press now would sign it twice.
    expect(screen.getByRole("button", { name: SIGN })).toHaveAttribute("aria-busy", "true");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: SIGN })); });
    expect(api.signOffAdmission).toHaveBeenCalledTimes(1);
    await act(async () => { reread([]); });
    await settle();
    expect(screen.queryByText(WAITS)).toBeNull();
  });

  it("puts a refusal on the toast by its code, never in the server's English, and reads the list again", async () => {
    const { api } = await mountKabul(<SignOffStrip patientId="H2600007" />, {
      perms: DOCTOR,
      setup: (a) => {
        a.admissions.mockResolvedValue(DRAFT);
        a.signOffAdmission.mockRejectedValue(refusal(403, "This bed is not in one of your units.", { apiCode: "out_of_scope" }));
      },
    });
    const reads = api.admissions.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: SIGN })); });
    await settle();
    expect(toasts().getAllByText(`${BED_2}: Bu çarpayı sizin şöbələrinizdən birində deyil.`).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/not in one of your units/);
    expect(api.admissions.mock.calls.length).toBeGreaterThan(reads);
  });

  it("says an uncoded 404 by its status in the reader's words, never the server's English (A-9)", async () => {
    await mountKabul(<SignOffStrip patientId="H2600007" />, {
      perms: DOCTOR,
      setup: (a) => {
        a.admissions.mockResolvedValue(DRAFT);
        a.signOffAdmission.mockRejectedValue(refusal(404, "Admission not found."));
      },
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: SIGN })); });
    await settle();
    expect(toasts().getAllByText(`${BED_2}: Sorğu uğursuz oldu (404).`).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Admission not found/);
  });

  it("reads the list again every minute: a signature given elsewhere takes the strip away", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      await mountKabul(<SignOffStrip patientId="H2600007" />,
        { perms: NURSE, setup: (a) => a.admissions.mockResolvedValueOnce(DRAFT).mockResolvedValue([]) });
      expect(screen.getByText(WAITS)).toBeTruthy();
      await act(async () => { vi.advanceTimersByTime(60_000); });
      await settle();
      expect(screen.queryByText(WAITS)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the patient screen's strip", () => {
  it("stands on the screen of a patient whose admission waits, with the button naming the bed", async () => {
    const mounted = await mountKabul(<PatientScreen params={{ id: "H2600007" }} />, {
      perms: DOCTOR,
      setup: (api) => {
        api.boardPatients.mockResolvedValue(board([kabulCard("H2600007", "2")]));
        api.streamTicket.mockResolvedValue({ ticket: "t-1" });
        api.view.mockResolvedValue({ ok: true });
        api.patientTrends.mockImplementation(answering());
        api.admissions.mockResolvedValue(DRAFT);
      },
    });
    await act(async () => { await mounted.board.start(); mounted.stream.open(); });
    await settle();
    expect(screen.getByRole("heading", { level: 1, name: "Sentetik Hasta" })).toBeTruthy();
    expect(screen.getByText(WAITS)).toBeTruthy();
    expect(screen.getByRole("button", { name: SIGN })).toBeTruthy();
    expectNoUuid();
  });
});

describe("the bed card's badge", () => {
  const card = (draft) => render(
    <I18nProvider><ul><BedCard patient={patientFromBoard(kabulCard("H2600007", "2"))} draft={draft} /></ul></I18nProvider>);

  it("says the admission waits for the physician's signature, and the card's link says it of that bed", () => {
    card(true);
    expect(screen.getByText(BADGE)).toBeTruthy();
    expect(screen.getByRole("link", { name: `2 xəstəsini aç · ${BADGE}` })).toHaveAttribute("href", "#/patients/H2600007");
  });

  it("says nothing of a signed one", () => {
    card(false);
    expect(screen.queryByText(BADGE)).toBeNull();
    expect(screen.getByRole("link", { name: "2 xəstəsini aç" })).toBeTruthy();
  });
});

describe("the bed board's read of the DRAFT admissions", () => {
  /** The board, LIVE, with two `kabul` cards; the one in bed 2 (H2600007) waits for a signature. */
  async function openBoard(perms) {
    const mounted = await mountKabul(<BedsScreen />, {
      perms,
      shell: { units: [] },
      setup: (api) => {
        api.boardPatients.mockResolvedValue(board([kabulCard("H2600007", "2"), kabulCard("H2600001", "1")]));
        api.streamTicket.mockResolvedValue({ ticket: "t-1" });
        api.admissions.mockResolvedValue(DRAFT);
      },
    });
    await act(async () => { await mounted.board.start(); mounted.stream.open(); });
    await settle();
    return mounted;
  }

  it("marks the card whose admission waits for a signature, and no other", async () => {
    const { api } = await openBoard(["board.view", "admissions.view"]);
    expect(api.admissions).toHaveBeenCalledWith(["DRAFT"]);
    expect(screen.getByRole("link", { name: `2 xəstəsini aç · ${BADGE}` })).toBeTruthy();
    expect(screen.getByRole("link", { name: "1 xəstəsini aç" })).toBeTruthy();
    expect(screen.getAllByText(BADGE)).toHaveLength(1);
    expectNoUuid();
  });

  it("reads them again every minute while it is open, and stops when it closes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { api } = await openBoard(["board.view", "admissions.view"]);
      const reads = api.admissions.mock.calls.length;
      await act(async () => { vi.advanceTimersByTime(59_999); });
      expect(api.admissions.mock.calls.length).toBe(reads);
      await act(async () => { vi.advanceTimersByTime(1); });
      await settle();
      expect(api.admissions.mock.calls.length).toBe(reads + 1);
      expect(api.admissions).toHaveBeenLastCalledWith(["DRAFT"]);
      cleanup();
      await act(async () => { vi.advanceTimersByTime(180_000); });
      expect(api.admissions.mock.calls.length).toBe(reads + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for no admission in a session without admissions.view, and marks no card", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { api } = await openBoard(["board.view"]);
      await act(async () => { vi.advanceTimersByTime(120_000); });
      await settle();
      expect(api.admissions).not.toHaveBeenCalled();
      expect(screen.queryByText(BADGE)).toBeNull();
      expect(screen.getByRole("link", { name: "2 xəstəsini aç" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

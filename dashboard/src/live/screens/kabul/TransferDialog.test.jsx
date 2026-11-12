// The «Nakil» dialog (Group 2 · B1b, spec §4): where the patient lies, a reason from the six, a
// note (required for «Diğer»), the new bed from the picker opened on her unit — her own bed not
// offered — B3a's question before a reserved bed, the warning that holds nothing, and the refusals
// in words. Toasts are drawn twice (B3a lesson 3): their texts are read with getAllByText.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { ANNOUNCE_DELAY_MS } from "../../ui/index.js";
import { TRANSFER_REASONS, TransferDialog, transferBody } from "./TransferDialog.jsx";
import { BED, CHARGE, expectNoUuid, mountKabul, row, settle, structure } from "./kabul.testutil.js";

const MOVER = [...CHARGE, "admissions.transfer.confirm"];
const FROM = "2 · Otaq 1 · Reanimasiya";
const TO = "1 · Otaq 1 · Reanimasiya";
const TITLE = `Köçürmə · ${FROM}`;
const WARNING = "Bu xəstədə təsdiqlənməmiş kritik siqnal var. Köçürmə dayandırılmır; siqnallar xəstə ilə birlikdə yeni çarpayıya keçir.";
const YES = "Yenə də bu çarpayıya köçür";
const dialog = () => within(screen.getByRole("dialog", { name: TITLE }));
const ask = () => screen.queryByRole("dialog", { name: /^Rezerv edilmiş çarpayı · / });
const reasonBox = () => dialog().getByRole("combobox", { name: "Səbəb" });
const noteBox = () => dialog().getByRole("textbox", { name: "Qeyd" });
const send = async () => {
  await act(async () => { fireEvent.click(dialog().getByRole("button", { name: "Köçür" })); });
  await settle();
};
const arrived = (over = {}) => ({ ...row({ id: "a-9", bed_id: BED(1), bed_label: "1" }), board: "ok", critical_alarm_open: false, ...over });
/** The ward with bed 1 reserved. */
const reservedOne = () => {
  const tree = structure();
  tree.sites[0].units[0].rooms[0].beds[0].state = "RESERVED";
  return tree;
};
/** The ward with bed 1 taken: what a re-read shows after someone — or she herself — is there. */
const occupiedOne = () => {
  const tree = structure();
  tree.sites[0].units[0].rooms[0].beds[0].state = "OCCUPIED";
  return tree;
};

/** The dialog for the default row — bed 2, Otaq 1, Reanimasiya — on a nurse's session. */
async function openDialog({ critical = false, setup } = {}) {
  const props = { onClose: vi.fn(), onDone: vi.fn(async () => {}), onRefused: vi.fn() };
  const mounted = await mountKabul(<TransferDialog row={row()} subject={FROM} critical={critical} {...props} />,
    { perms: MOVER, setup });
  return { ...mounted, ...props };
}

describe("TransferDialog", () => {
  it("builds the body: the bed, the reason, the trimmed note or none, and confirm_reserved only after a yes", () => {
    expect(transferBody({ bedId: "b-1", reason: "OTHER", note: "  Sentetik nakil notu  " }))
      .toEqual({ target_bed_id: "b-1", reason: "OTHER", note: "Sentetik nakil notu" });
    expect(transferBody({ bedId: "b-1", reason: "ISOLATION", note: "   " }))
      .toEqual({ target_bed_id: "b-1", reason: "ISOLATION", note: null });
    expect(transferBody({ bedId: "b-1", reason: "ISOLATION", note: "", confirmReserved: true }).confirm_reserved).toBe(true);
    expect(TRANSFER_REASONS).toEqual(["CLINICAL_NEED", "TO_ICU", "ICU_TO_WARD", "ISOLATION", "PATIENT_OR_FAMILY_REQUEST", "OTHER"]);
  });

  it("says where the patient lies, offers the six reasons, and opens the picker on her unit with her own bed not offered", async () => {
    await openDialog();
    expect(dialog().getByText(`Hazırda: ${FROM}. Əvvəlki çarpayı təmizliyə verilir.`)).toBeTruthy();
    expect(within(reasonBox()).getAllByRole("option").map((o) => o.value)).toEqual(["", ...TRANSFER_REASONS]);
    expect(dialog().getByRole("button", { name: TO })).toBeTruthy();                  // the unit is open
    expect(dialog().getByRole("button", { name: /^2 · Otaq 1 · Reanimasiya · / }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText(WARNING)).toBeNull();
    expectNoUuid();
  });

  it("sends the bed, the reason and the trimmed note, and stays held until the tab has read again (A-17)", async () => {
    let finish;
    const { api, onDone } = await openDialog({ setup: (a) => a.transfer.mockResolvedValue(arrived()) });
    onDone.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.change(reasonBox(), { target: { value: "ISOLATION" } });
    fireEvent.change(noteBox(), { target: { value: "  Sentetik nakil notu  " } });
    expect(dialog().getByText("23 / 200")).toBeTruthy();
    fireEvent.click(dialog().getByRole("button", { name: TO }));
    await send();
    expect(api.transfer).toHaveBeenCalledWith("a-1", { target_bed_id: BED(1), reason: "ISOLATION", note: "Sentetik nakil notu" });
    expect(onDone).toHaveBeenCalledWith({ answer: arrived(), body: api.transfer.mock.calls[0][1], to: TO });
    expect(screen.getAllByText(`${FROM} → ${TO}; ${FROM} təmizliyə verildi`).length).toBeGreaterThan(0);
    await send();                                                        // pressed again while held
    expect(api.transfer).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
  });

  it("asks for a reason and a bed, and for «Digər» a note, before it sends anything", async () => {
    const { api } = await openDialog();
    await send();
    expect(dialog().getByText("Səbəb seçin.")).toBeTruthy();
    expect(dialog().getByText("Yeni çarpayını seçin.")).toBeTruthy();
    fireEvent.change(reasonBox(), { target: { value: "OTHER" } });
    fireEvent.click(dialog().getByRole("button", { name: TO }));
    await send();
    expect(dialog().getByText("«Digər» üçün qeyd yazın.")).toBeTruthy();
    expect(api.transfer).not.toHaveBeenCalled();
  });

  it("asks before a reserved bed, with its note, and sends confirm_reserved after the yes (B3a R5)", async () => {
    const { api } = await openDialog({ setup: (a) => {
      a.structure.mockResolvedValue(reservedOne());
      a.occupancy.mockResolvedValue({ beds: [{ bed_id: BED(1), occupant_short: null, state_reason: null, state_note: "Sentetik planlı kabul" }] });
      a.transfer.mockResolvedValue(arrived());
    } });
    fireEvent.change(reasonBox(), { target: { value: "CLINICAL_NEED" } });
    fireEvent.click(dialog().getByRole("button", { name: `${TO} · Rezervdədir` }));
    await send();
    expect(api.transfer).not.toHaveBeenCalled();
    expect(within(ask()).getByText("Rezerv qeydi: Sentetik planlı kabul")).toBeTruthy();
    await act(async () => { fireEvent.click(within(ask()).getByRole("button", { name: YES })); });
    await settle();
    expect(api.transfer).toHaveBeenCalledWith("a-1", { target_bed_id: BED(1), reason: "CLINICAL_NEED", note: null, confirm_reserved: true });
  });

  it("reads the beds again and asks when the server says the bed was reserved meanwhile", async () => {
    const { api } = await openDialog({ setup: (a) => {
      a.occupancy.mockResolvedValue({ beds: [] });
      a.transfer
        .mockRejectedValueOnce(refusal(409, "The bed is reserved: the transfer must confirm it.", { apiCode: "bed_reserved" }))
        .mockResolvedValue(arrived());
    } });
    const reads = api.structure.mock.calls.length;
    fireEvent.change(reasonBox(), { target: { value: "CLINICAL_NEED" } });
    fireEvent.click(dialog().getByRole("button", { name: TO }));
    await send();
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
    expect(ask()).toBeTruthy();
    expect("confirm_reserved" in api.transfer.mock.calls[0][1]).toBe(false);
    await settle();                                     // X16: the yes waits for the note's read
    expect(within(ask()).getByText("Rezervin qeydi yoxdur.")).toBeTruthy();
    await act(async () => { fireEvent.click(within(ask()).getByRole("button", { name: YES })); });
    await settle();
    expect(api.transfer.mock.calls[1][1].confirm_reserved).toBe(true);
  });

  it("warns of a critical alarm nobody acknowledged and holds nothing (D7)", async () => {
    const { api } = await openDialog({ critical: true, setup: (a) => a.transfer.mockResolvedValue(arrived({ critical_alarm_open: true })) });
    expect(dialog().getByText(WARNING)).toBeTruthy();
    fireEvent.change(reasonBox(), { target: { value: "TO_ICU" } });
    fireEvent.click(dialog().getByRole("button", { name: TO }));
    await send();
    expect(api.transfer).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["field_invalid:note", 422, "Köçürmə qeydi yanlışdır"],
    ["bed_not_available", 409, "Bu çarpayı artıq boş deyil"],
    ["out_of_scope", 403, "Bu çarpayı sizin şöbələrinizdən birində deyil"],
    ["bed_closed", 409, "Bu çarpayı, onun otağı və ya şöbəsi bağlıdır"],
    ["invalid_transition", 409, "Qeyd bu əməliyyat üçün uyğun vəziyyətdə deyil"],
  ])("says a %s refusal in words on the toast, and lets the tab read again", async (code, status, words) => {
    const { onRefused } = await openDialog({ setup: (a) => a.transfer.mockRejectedValue(refusal(status, "English words", { apiCode: code })) });
    fireEvent.change(reasonBox(), { target: { value: "ISOLATION" } });
    fireEvent.click(dialog().getByRole("button", { name: TO }));
    await send();
    expect(screen.getAllByText((text) => text.startsWith(`${FROM}: ${words}`)).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/English words/)).toHaveLength(0);
    expect(onRefused).toHaveBeenCalled();
  });
});

// What B1c's dialog (AddMemberDialog) taught, held here too (Task 9 lessons).
describe("TransferDialog: what B1c's dialog taught", () => {
  it("moves the focus to the first control at fault: the reason, then the note, then the bed", async () => {
    await openDialog();
    await send();
    expect(document.activeElement).toBe(reasonBox());
    fireEvent.change(reasonBox(), { target: { value: "OTHER" } });
    fireEvent.click(dialog().getByRole("button", { name: TO }));
    await send();
    expect(document.activeElement).toBe(noteBox());
    expect(noteBox().getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(noteBox(), { target: { value: "Sentetik nakil notu" } });
    fireEvent.change(reasonBox(), { target: { value: "ISOLATION" } });
    fireEvent.click(dialog().getByRole("button", { name: /^Neonatal · / }));       // another unit: the pick goes
    await send();
    // Neonatal has no free bed, so the picker's focus point is its own unit button.
    expect(document.activeElement).toBe(dialog().getByRole("button", { name: /^Neonatal · / }));
    expect(document.activeElement.getAttribute("aria-describedby")).toBe("transfer-bed-error");
    expect(document.getElementById("transfer-bed-error").textContent).toBe("Yeni çarpayını seçin.");
  });

  it("drops the pick when the unit changes, so a bed no longer in view is never sent", async () => {
    const { api } = await openDialog({ setup: (a) => a.transfer.mockResolvedValue(arrived()) });
    fireEvent.change(reasonBox(), { target: { value: "ISOLATION" } });
    fireEvent.click(dialog().getByRole("button", { name: TO }));
    expect(dialog().getByRole("button", { name: TO }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(dialog().getByRole("button", { name: /^Neonatal · / }));
    await send();
    expect(api.transfer).not.toHaveBeenCalled();
    expect(dialog().getByText("Yeni çarpayını seçin.")).toBeTruthy();
  });

  it("does not send a bed that a re-read shows taken, and says the bed is needed", async () => {
    const { api } = await openDialog({ setup: (a) => {
      a.transfer.mockRejectedValue(refusal(409, "English words", { apiCode: "bed_not_available" }));
    } });
    fireEvent.change(reasonBox(), { target: { value: "ISOLATION" } });
    fireEvent.click(dialog().getByRole("button", { name: TO }));
    api.structure.mockResolvedValue(occupiedOne());     // someone took bed 1 meanwhile; the refusal's re-read shows it
    await send();
    expect(api.transfer).toHaveBeenCalledTimes(1);
    expect(dialog().getByRole("button", { name: /^1 · Otaq 1 · Reanimasiya · / }).getAttribute("aria-pressed")).toBe("false");
    await send();
    expect(api.transfer).toHaveBeenCalledTimes(1);      // the taken bed went nowhere
    expect(dialog().getByText("Yeni çarpayını seçin.")).toBeTruthy();
    expect(document.activeElement.id).toBe("transfer-bed");     // the first free bed the picker can give
  });

  it("reads the beds again after a refusal that is not about a field, and not after the note's", async () => {
    const { api } = await openDialog({ setup: (a) => a.transfer
      .mockRejectedValueOnce(refusal(409, "English words", { apiCode: "bed_not_available" }))
      .mockRejectedValueOnce(refusal(422, "English words", { apiCode: "field_invalid:note" }))
      .mockResolvedValue(arrived()) });
    fireEvent.change(reasonBox(), { target: { value: "ISOLATION" } });
    fireEvent.click(dialog().getByRole("button", { name: TO }));
    const before = api.structure.mock.calls.length;
    await send();
    expect(api.structure.mock.calls.length).toBe(before + 1);
    await send();                                       // the note's refusal: the picker is not out of date
    expect(api.transfer).toHaveBeenCalledTimes(2);
    expect(api.structure.mock.calls.length).toBe(before + 1);
  });

  it("describes the button that moves her by what it does", async () => {
    await openDialog();
    expect(dialog().getByRole("button", { name: "Köçür" }))
      .toHaveAccessibleDescription(`Hazırda: ${FROM}. Əvvəlki çarpayı təmizliyə verilir.`);
  });

  it("describes the button by the critical warning too, when it shows", async () => {
    await openDialog({ critical: true });
    expect(dialog().getByRole("button", { name: "Köçür" }))
      .toHaveAccessibleDescription(`Hazırda: ${FROM}. Əvvəlki çarpayı təmizliyə verilir. ${WARNING}`);
  });

  it("holds the picker with the write, and hands the tab a card that did not move as a warning", async () => {
    let finish;
    const { onDone } = await openDialog({ setup: (a) => a.transfer.mockResolvedValue(arrived({ board: "failed" })) });
    onDone.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.change(reasonBox(), { target: { value: "ISOLATION" } });
    fireEvent.click(dialog().getByRole("button", { name: TO }));
    await send();
    expect(dialog().getByRole("group", { name: "Yeni çarpayı" }).disabled).toBe(true);
    expect(screen.getAllByText(`${FROM} → ${TO}; kart yeni çarpayıya keçirilmədi`).length).toBeGreaterThan(0);
    await act(async () => { finish(); });
    expect(dialog().getByRole("group", { name: "Yeni çarpayı" }).disabled).toBe(false);
  });

  it("says a move that landed once and calls nothing a refusal; the tab is handed the answer once", async () => {
    // onDone sits outside the write's try (AddMemberDialog's lesson): only the write's own failure is a refusal.
    // Its throwing is driven in the review's tests below.
    const { api, onDone, onRefused } = await openDialog({ setup: (a) => a.transfer.mockResolvedValue(arrived()) });
    fireEvent.change(reasonBox(), { target: { value: "ISOLATION" } });
    fireEvent.click(dialog().getByRole("button", { name: TO }));
    await send();
    expect(api.transfer).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onRefused).not.toHaveBeenCalled();
    expect(screen.queryAllByText(/^2 · Otaq 1 · Reanimasiya: /)).toHaveLength(0);
  });
});

// The review of Task 9: a send with no answer goes again as it was, the reserved yes is for its bed, the
// beds are read again before the buttons are given back, and a failing tab read is nobody's refusal.
describe("TransferDialog: the review of Task 9", () => {
  const RESEND = "Son göndərişə cavab alınmadı; köçürmə baş vermiş ola bilər. Düyməyə basılsa, eyni köçürmə bir daha göndərilir; forma buna görə kilidlənib.";
  const bedGroup = () => dialog().getByRole("group", { name: "Yeni çarpayı" });
  const pick = (reasonValue = "ISOLATION") => {
    fireEvent.change(reasonBox(), { target: { value: reasonValue } });
    fireEvent.click(dialog().getByRole("button", { name: TO }));
  };

  it("bounds the note at 200 characters", async () => {
    await openDialog();
    expect(noteBox().maxLength).toBe(200);
  });

  it("sends nothing when the reserved question is cancelled, and gives the focus back to the button", async () => {
    const { api } = await openDialog({ setup: (a) => {
      a.structure.mockResolvedValue(reservedOne());
      a.occupancy.mockResolvedValue({ beds: [] });
    } });
    fireEvent.change(reasonBox(), { target: { value: "CLINICAL_NEED" } });
    fireEvent.click(dialog().getByRole("button", { name: `${TO} · Rezervdədir` }));
    const button = dialog().getByRole("button", { name: "Köçür" });
    button.focus();                                      // a press leaves the focus on the button; a bare click event does not
    await send();
    expect(ask()).toBeTruthy();
    await act(async () => { fireEvent.click(within(ask()).getByRole("button", { name: "İmtina" })); });
    await settle();
    expect(ask()).toBeNull();
    expect(api.transfer).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it("sends the same body again after a send that got no answer, with the form locked and her pick on show, whatever the re-read says", async () => {
    const { api, onDone } = await openDialog({ setup: (a) => a.transfer
      .mockRejectedValueOnce(refusal(504, "Gateway Timeout"))
      .mockResolvedValue(arrived()) });
    pick();
    fireEvent.change(noteBox(), { target: { value: "Sentetik nakil notu" } });
    api.structure.mockResolvedValue(occupiedOne());      // she is at bed 1 by now: the re-read shows it taken
    await send();
    expect(api.transfer).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText((text) => text.startsWith(`${FROM}: `) && text.includes("Dəyişiklik yenə də tətbiq olunmuş ola bilər")).length).toBeGreaterThan(0);
    expect(dialog().getByText(RESEND)).toBeTruthy();
    expect(dialog().getByRole("button", { name: "Köçür" })).toHaveAccessibleDescription(expect.stringContaining(RESEND));
    expect(reasonBox().disabled).toBe(true);
    expect(noteBox().readOnly).toBe(true);
    expect(bedGroup().disabled).toBe(true);
    // The re-read has shown bed 1 taken, and it stays on show as hers.
    expect(dialog().getByRole("button", { name: /^1 · Otaq 1 · Reanimasiya · / }).getAttribute("aria-pressed")).toBe("true");
    await send();
    expect(api.transfer).toHaveBeenCalledTimes(2);
    expect(api.transfer.mock.calls[1]).toEqual(api.transfer.mock.calls[0]);
    expect(api.transfer.mock.calls[1][1]).toEqual({ target_bed_id: BED(1), reason: "ISOLATION", note: "Sentetik nakil notu" });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("resends her yes to a reserved bed as it went, without asking again", async () => {
    const { api } = await openDialog({ setup: (a) => {
      a.structure.mockResolvedValue(reservedOne());
      a.occupancy.mockResolvedValue({ beds: [] });
      a.transfer
        .mockRejectedValueOnce(refusal(504, "Gateway Timeout"))
        .mockResolvedValue(arrived());
    } });
    fireEvent.change(reasonBox(), { target: { value: "CLINICAL_NEED" } });
    fireEvent.click(dialog().getByRole("button", { name: `${TO} · Rezervdədir` }));
    await send();
    await settle();                                      // the note's read: the yes waits for it (X16)
    await act(async () => { fireEvent.click(within(ask()).getByRole("button", { name: YES })); });
    await settle();
    expect(api.transfer).toHaveBeenCalledTimes(1);
    expect(api.transfer.mock.calls[0][1].confirm_reserved).toBe(true);
    await send();                                        // the bed is still reserved on the screen: the question is not asked twice
    expect(ask()).toBeNull();
    expect(api.transfer).toHaveBeenCalledTimes(2);
    expect(api.transfer.mock.calls[1]).toEqual(api.transfer.mock.calls[0]);
  });

  it("ends the lock when the resent move is answered with a refusal, and asks for a bed again", async () => {
    const { api } = await openDialog({ setup: (a) => a.transfer
      .mockRejectedValueOnce(refusal(504, "Gateway Timeout"))
      .mockRejectedValueOnce(refusal(409, "English words", { apiCode: "invalid_transition" }))
      .mockResolvedValue(arrived()) });
    pick();
    api.structure.mockResolvedValue(occupiedOne());
    await send();
    expect(bedGroup().disabled).toBe(true);
    await send();                                        // answered: the first move did not land
    expect(api.transfer).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(RESEND)).toBeNull();
    expect(reasonBox().disabled).toBe(false);
    expect(bedGroup().disabled).toBe(false);
    await send();                                        // bed 1 shows taken now: it is not sent
    expect(api.transfer).toHaveBeenCalledTimes(2);
    expect(dialog().getByText("Yeni çarpayını seçin.")).toBeTruthy();
  });

  it("keeps a resend when the resent move gets no answer either", async () => {
    const { api } = await openDialog({ setup: (a) => a.transfer
      .mockRejectedValueOnce(refusal(504, "Gateway Timeout"))
      .mockRejectedValueOnce(refusal(502, "Bad Gateway"))
      .mockResolvedValue(arrived()) });
    pick();
    await send();
    await send();
    expect(dialog().getByText(RESEND)).toBeTruthy();
    await send();
    expect(api.transfer).toHaveBeenCalledTimes(3);
    expect(new Set(api.transfer.mock.calls.map((c) => JSON.stringify(c))).size).toBe(1);
  });

  it("takes her yes for the bed the question named: another reserved bed is asked about, not sent with it (I-1)", async () => {
    const tree = reservedOne();
    tree.sites[0].units[0].rooms[1].beds[0].state = "RESERVED";       // bed 5 as well
    const { api } = await openDialog({ setup: (a) => {
      a.structure.mockResolvedValue(tree);
      a.occupancy.mockResolvedValue({ beds: [] });
      a.transfer.mockResolvedValue(arrived());
    } });
    fireEvent.change(reasonBox(), { target: { value: "CLINICAL_NEED" } });
    fireEvent.click(dialog().getByRole("button", { name: `${TO} · Rezervdədir` }));
    await send();
    expect(ask()).toBeTruthy();
    // Under the question the form is inert for a user; a stray press on another reserved bed is what this models.
    fireEvent.click(dialog().getByRole("button", { name: "5 · Otaq 2 · Reanimasiya · Rezervdədir" }));
    await settle();
    await settle();
    await act(async () => { fireEvent.click(within(ask()).getByRole("button", { name: YES })); });
    await settle();
    expect(api.transfer).not.toHaveBeenCalled();         // her yes was for bed 1
    expect(screen.getByRole("dialog", { name: /^Rezerv edilmiş çarpayı · 5 · / })).toBeTruthy();
  });

  it("does not ask after bed_reserved when the re-read shows the bed taken: it says so and takes her to the bed", async () => {
    const { api, onRefused } = await openDialog({ setup: (a) => a.transfer
      .mockRejectedValue(refusal(409, "English words", { apiCode: "bed_reserved" })) });
    pick();
    api.structure.mockResolvedValue(occupiedOne());
    await send();
    expect(ask()).toBeNull();
    expect(api.transfer).toHaveBeenCalledTimes(1);
    expect(onRefused).toHaveBeenCalled();
    expect(screen.getAllByText((text) => text.startsWith(`${FROM}: Bu çarpayı artıq boş deyil`)).length).toBeGreaterThan(0);
    expect(dialog().getByText("Yeni çarpayını seçin.")).toBeTruthy();
    expect(document.activeElement.id).toBe("transfer-bed");
  });

  it("asks after bed_reserved when the re-read itself fails: it cannot say the bed is gone", async () => {
    const { api } = await openDialog({ setup: (a) => {
      a.occupancy.mockResolvedValue({ beds: [] });
      a.transfer.mockRejectedValueOnce(refusal(409, "English words", { apiCode: "bed_reserved" }));
    } });
    pick("CLINICAL_NEED");
    api.structure.mockRejectedValue(new Error("down"));
    await send();
    expect(ask()).toBeTruthy();
  });

  it("holds the buttons until the beds have been read again after a refusal", async () => {
    let land;
    const { api } = await openDialog({ setup: (a) => a.transfer
      .mockRejectedValue(refusal(409, "English words", { apiCode: "bed_not_available" })) });
    pick();
    api.structure.mockImplementationOnce(() => new Promise((resolve) => { land = () => resolve(structure()); }));
    await send();
    expect(screen.getAllByText((text) => text.startsWith(`${FROM}: Bu çarpayı artıq boş deyil`)).length).toBeGreaterThan(0);
    expect(dialog().getByRole("button", { name: "Köçür" }).getAttribute("aria-busy")).toBe("true");
    expect(bedGroup().disabled).toBe(true);              // the beds are being read: nothing is given back yet
    await act(async () => { land(); });
    await settle();
    expect(dialog().getByRole("button", { name: "Köçür" }).getAttribute("aria-busy")).toBeNull();
    expect(bedGroup().disabled).toBe(false);
  });

  it("takes a rejection from onDone as the tab's own: no refusal, no unhandled rejection, and the dialog is given back", async () => {
    const { api, onDone, onRefused } = await openDialog({ setup: (a) => a.transfer.mockResolvedValue(arrived()) });
    onDone.mockRejectedValue(new Error("Sentetik okuma hatası"));
    pick();
    await send();
    expect(api.transfer).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onRefused).not.toHaveBeenCalled();
    expect(screen.queryAllByText(/Sentetik okuma hatası/)).toHaveLength(0);
    expect(screen.getAllByText(`${FROM} → ${TO}; ${FROM} təmizliyə verildi`).length).toBeGreaterThan(0);
    expect(bedGroup().disabled).toBe(false);
    expect(dialog().getByRole("button", { name: "Köçür" }).getAttribute("aria-busy")).toBeNull();
  });

  it("announces the wait politely while the move is held", async () => {
    let finish;
    const { onDone } = await openDialog({ setup: (a) => a.transfer.mockResolvedValue(arrived()) });
    onDone.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    pick();
    const said = () => screen.getAllByRole("status").map((el) => el.textContent);
    expect(said()).not.toContain("Köçürmə qeyd olunur…");
    await send();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ANNOUNCE_DELAY_MS + 60)); });
    expect(said()).toContain("Köçürmə qeyd olunur…");
    await act(async () => { finish(); });
    expect(said()).not.toContain("Köçürmə qeyd olunur…");
  });
});

// The Kabul tab (Group 2 · B1a, spec §3.1, §5.2): the side panel names every missing field and
// "Kabul et" is held until it is empty; one request admits; the patient number is shown large with
// what to do with it, and any engine part that did not land; a refusal goes on the toast, named
// after the bed, and the bed picker is read again. A send that got no answer never invites a
// second admission of the same patient: what it may have left is looked for first. And none of
// that is the tab's to lose: the form, the hold and the sends with no answer are the session's
// (A-21) — another tab, another screen and a send answering meanwhile leave them where they were.
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { useStructure } from "../../data/StructureProvider.jsx";
import { ThemeProvider } from "../../theme/ThemeProvider.jsx";
import { Shell } from "../../shell/Shell.jsx";
import { ANNOUNCE_DELAY_MS } from "../../ui/index.js";
import { AdmitTab } from "./AdmitTab.jsx";
import { admitDraftOf } from "./admitDraft.js";
import { KabulScreen } from "./KabulScreen.jsx";
import { BED, DOCTOR, NURSE, REA, UUID_TEXT, mountKabul, row, settle, structure, toasts } from "./kabul.testutil.js";

/** The side panel: the missing fields, «Qəbul et», and the hold's reason under it — the form's own
 *  reason, apart from the toast that says a hold too (m-2). */
const panel = () => within(screen.getByRole("complementary", { name: "Çatışmayan sahələr" }));
const missingNow = () => panel().queryAllByRole("listitem").map((li) => li.textContent);
const admitButton = () => screen.getByRole("button", { name: "Qəbul et" });
const press = async () => {
  await act(async () => { fireEvent.click(admitButton()); });
  await settle();
};
const timedOut = () => Object.assign(new Error("…"), { code: "REQUEST_TIMEOUT" });
const admitted = (engine = { weight: "ok", profile: "ok", board: "ok" }, number = "H2600042") => ({
  id: "a-1", patient_number: number, state: "DRAFT", engine,
});
const pickBed5 = () => fireEvent.click(within(screen.getByRole("group", { name: "Otaq 2" })).getByRole("button", { name: "5" }));
/** The DRAFT the first send left on bed 1, under the name it sent. */
const firstDraft = () => row({ state: "DRAFT", bed_id: BED(1), patient_number: "H2600042" });

// The words the tab says, as dashboard/src/live/i18n/strings/kabul.js (az) has them (A-7).
const BED1 = "1 · Otaq 1 · Reanimasiya";
const EVERY_MISSING = ["Ad soyad", "Cins", "Doğum tarixi", "Qəbul növü", "Qəbul diaqnozu",
  "Allergiya və ya «məlum allergiyası yoxdur» — ikisindən biri", "Razılıq", "Çarpayı"];
const ALLERGY_MISSING = "Allergiya və ya «məlum allergiyası yoxdur» — ikisindən biri";
const TIMEOUT = "Server cavab vermədi. Əməliyyat yerinə yetirilmiş ola bilər; yoxlayın və lazım olsa yenidən cəhd edin.";
const WEIGHT_FAILED = "Çəki mühərrikə çatmadı — qəbul yazılıb; sistem administratoruna bildirin.";
const PROFILE_FAILED = "Müşayiət edən xəstəliklər mühərrikə çatmadı — qəbul yazılıb; sistem administratoruna bildirin.";
const BOARD_FAILED = "Kart paneldə görünmürsə, sistem administratoruna bildirin — qəbul yazılıb.";
const RECORDED = "Serverin cavabı gəlmədi, amma qəbul yazılıb. Kartın panelə, çəki və müşayiət edən xəstəliklərin mühərrikə çatıb-çatmadığı bilinmir; kart paneldə görünmürsə, sistem administratoruna bildirin.";
const HELD = `${BED1} üçün göndərilən qəbula cavab gəlmədi; yazılıb-yazılmadığı bilinmir. Yenidən göndərməzdən əvvəl «Evə yazılma › Yatan xəstələr» siyahısına baxın.`;
const GO_ON = "Yoxladım, qəbul yoxdur — davam et";
const EARLIER = `Bu nömrə formadakı xəstəyə aid deyil: Sentetik Hasta (${BED1}) üçün əvvəl göndərilən, cavabı gəlməyən qəbul yazılıb. Formadakı qəbul hələ göndərilməyib.`;
const EARLIER_TITLE = "Başqa xəstənin qəbulu yazılıb";
const EARLIER_TOAST = `${BED1} · əvvəl göndərilən qəbul yazılıb, xəstə nömrəsi H2600042 — formadakı xəstənin deyil`;
const BACK = "Formaya qayıt";
const TAKEN = `${BED1}: Bu çarpayı artıq boş deyil; başqa çarpayı seçin.`;
const bedTaken = () => refusal(409, "Bed is not AVAILABLE (current state: OCCUPIED); cannot admit.", { apiCode: "bed_not_available" });
const nameField = () => screen.getByLabelText(/^Ad soyad/);

/** Another tab of the Hasta Kabul screen, and what it reads on opening. */
async function openTab(name) {
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name })); });
  await settle();
}

/** The shell's router moved — by the menu, a link, Back — and what the new screen reads. */
async function go(hash) {
  await act(async () => {
    window.location.hash = hash;
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  });
  await settle();
}

/** Another nurse signs in at the same browser — the session store's own sign-in, as the form does it. */
async function signInAs(api, store, id) {
  const access = token({ sub: id, perms: NURSE });
  api.login.mockImplementation(async () => { api.store(access); return { access_token: access, refresh_token: "r" }; });
  api.me.mockResolvedValue(profile({ id, username: id, full_name: "Leyla Sentetik", perms: NURSE }));
  await act(async () => { await store.signIn(id, "Gizli-Sifre-1"); });
  await settle();
}

/** Fill every required field — bed 1 of Otaq 1 in Reanimasiya — except those named. */
function fillRequired(except = []) {
  const steps = {
    name: () => fireEvent.change(screen.getByLabelText(/^Ad soyad/), { target: { value: "Sentetik Hasta" } }),
    sex: () => fireEvent.click(screen.getByLabelText("Qadın")),
    dob: () => fireEvent.change(screen.getByLabelText(/^Doğum tarixi/), { target: { value: "1970-05-05" } }),
    type: () => fireEvent.change(screen.getByLabelText(/^Qəbul növü/), { target: { value: "ICU" } }),
    diagnosis: () => fireEvent.change(screen.getByLabelText(/^Qəbul diaqnozu/), { target: { value: "Sentetik tanı" } }),
    allergy: () => fireEvent.click(screen.getByLabelText("Məlum allergiyası yoxdur")),
    consent: () => fireEvent.click(screen.getByLabelText("Fərdi məlumatlara razılıq imzalandı")),
    bed: () => {
      fireEvent.click(screen.getByRole("button", { name: /^Reanimasiya/ }));
      fireEvent.click(screen.getByRole("button", { name: "1" }));
    },
  };
  for (const [field, step] of Object.entries(steps)) if (!except.includes(field)) step();
}

/** The structure with bed `n` changed by `patch` — what a re-read shows once someone took it. */
function withBed(n, patch) {
  const tree = structure();
  for (const unit of tree.sites[0].units) {
    for (const room of unit.rooms) for (const bed of room.beds) if (bed.id === BED(n)) Object.assign(bed, patch);
  }
  return tree;
}

/** The text a control's error says: the first id of its aria-describedby (Field puts it first). */
const errorOf = (control) => document.getElementById(control.getAttribute("aria-describedby").split(" ")[0]).textContent;

/** What the polite live regions hold once `Announce` has had its delay. */
async function said() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ANNOUNCE_DELAY_MS + 30)); });
  return screen.getAllByRole("status").map((node) => node.textContent);
}

/** A re-read of the structure that no write of this tab asked for (another screen's, a timer's). */
function Reread() {
  const { reload } = useStructure();
  return <button type="button" onClick={() => reload()}>reread</button>;
}

describe("AdmitTab", () => {
  it("shows a physician the read-only note and no form", async () => {
    await mountKabul(<AdmitTab />, { perms: DOCTOR });
    expect(screen.getByText(/Baxış səlahiyyəti ilə açmısınız/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Qəbul et" })).toBeNull();
  });

  it("names every missing required field, and holds «Qəbul et» until there is none", async () => {
    const { api } = await mountKabul(<AdmitTab />, { perms: NURSE });
    expect(missingNow()).toEqual(EVERY_MISSING);
    expect(admitButton().getAttribute("aria-disabled")).toBe("true");

    fillRequired();
    expect(panel().getByText("Bütün məcburi sahələr doludur.")).toBeTruthy();
    expect(admitButton().getAttribute("aria-disabled")).toBeNull();
    expect(api.admit).not.toHaveBeenCalled();
  });

  it("pressed while held, sends nothing, marks each missing field and takes the focus to the first", async () => {
    const { api } = await mountKabul(<AdmitTab />, { perms: NURSE });
    const name = screen.getByLabelText(/^Ad soyad/);
    const sex = screen.getByRole("radiogroup", { name: "Cins" });
    const consent = screen.getByRole("radiogroup", { name: "Razılıq" });
    expect(name.getAttribute("aria-invalid")).toBeNull();
    expect(sex.getAttribute("aria-required")).toBe("true");
    expect(consent.getAttribute("aria-required")).toBe("true");
    expect(sex.getAttribute("aria-invalid")).toBeNull();

    await press();
    expect(api.admit).not.toHaveBeenCalled();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(errorOf(name)).toBe("Ad soyad");
    expect(document.activeElement).toBe(name);
    expect(sex.getAttribute("aria-invalid")).toBe("true");
    expect(errorOf(sex)).toBe("Cins");
    expect(consent.getAttribute("aria-invalid")).toBe("true");
    expect(errorOf(consent)).toBe("Razılıq");
  });

  it("takes the focus to the first missing field in the form's order — a radio group's first choice", async () => {
    await mountKabul(<AdmitTab />, { perms: NURSE });
    fillRequired(["consent"]);
    await press();
    expect(document.activeElement).toBe(screen.getByLabelText("Fərdi məlumatlara razılıq imzalandı"));
  });

  it("takes the focus to the bed picker when the bed is all that is missing", async () => {
    await mountKabul(<AdmitTab />, { perms: NURSE });
    fillRequired(["bed"]);
    await press();
    expect(document.activeElement.textContent).toMatch(/^Reanimasiya/);
  });

  // Final review M-3: the control a "the bed is missing" press focuses says what is wrong — it is
  // described by the bed's error, by id, as every other field is by its own.
  it("describes the control the missing bed focuses by the bed's error: a unit, then the chosen unit's first free bed (M-3)", async () => {
    await mountKabul(<AdmitTab />, { perms: NURSE });
    const described = (control) => (control.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent);
    fillRequired(["bed"]);
    const unit = screen.getByRole("button", { name: /^Reanimasiya/ });
    expect(described(unit)).toEqual([]);                                     // nothing is wrong yet
    await press();
    expect(document.activeElement).toBe(unit);
    expect(described(unit)).toEqual(["Çarpayı"]);

    fireEvent.click(unit);                                                   // the unit chosen, no bed yet
    await press();
    const bed = screen.getByRole("button", { name: "1" });
    expect(document.activeElement).toBe(bed);
    expect(described(bed)).toEqual(["Çarpayı"]);
    expect(described(unit)).toEqual([]);                                     // only the control the press focuses
  });

  it("admits with one request, shows the patient number with what to do with it, and takes the focus there", async () => {
    const { api } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockResolvedValue(admitted({ weight: "failed", profile: "skipped", board: "ok" })),
    });
    fillRequired();
    const reads = api.structure.mock.calls.length;
    await press();

    expect(api.admit).toHaveBeenCalledTimes(1);
    const body = api.admit.mock.calls[0][0];
    expect(body.note).toMatchObject({ bed_id: BED(1), admitting_unit_id: REA, admission_type: "ICU", no_known_allergy: true });
    expect(body.patient).toMatchObject({ display_name: "Sentetik Hasta", sex: "female", consent: "KVKK_SIGNED", nationality: null });

    expect(screen.getByText("H2600042")).toBeTruthy();
    expect(screen.getByText("Çarpayı yanındakı cihaza bu nömrəni daxil edin.")).toBeTruthy();
    expect(screen.getByText(WEIGHT_FAILED)).toBeTruthy();
    expect(screen.queryByText(PROFILE_FAILED)).toBeNull();                     // "skipped" is not a failure
    expect(screen.getByRole("link", { name: "Paneldə bax" }).getAttribute("href")).toBe("#/patients/H2600042");
    const heading = screen.getByRole("heading", { name: "Qəbul edildi" });
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(heading);
    expect(toasts().getAllByText(`${BED1} · qəbul edildi, xəstə nömrəsi H2600042`).length).toBeGreaterThan(0);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);           // the picker is read again
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    expect(await said()).toContain(WEIGHT_FAILED);
  });

  it("shows no part the engine skipped", async () => {
    await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockResolvedValue(admitted({ weight: "skipped", profile: "skipped", board: "skipped" })),
    });
    fillRequired();
    await press();
    expect(screen.getByText("H2600042")).toBeTruthy();
    expect(screen.queryAllByRole("note")).toEqual([]);
    expect(screen.getByRole("link", { name: "Paneldə bax" })).toBeTruthy();
    expect((await said()).filter((text) => /mühərrik|panel/.test(text))).toEqual([]);
  });

  it("names a board and a profile that did not land, and offers no board link when the card did not reach it", async () => {
    await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockResolvedValue(admitted({ weight: "ok", profile: "failed", board: "failed" })),
    });
    fillRequired();
    await press();
    expect(screen.getByText(BOARD_FAILED)).toBeTruthy();
    expect(screen.getByText(PROFILE_FAILED)).toBeTruthy();
    expect(screen.queryByText(WEIGHT_FAILED)).toBeNull();
    expect(screen.queryByRole("link", { name: "Paneldə bax" })).toBeNull();
    expect(await said()).toContain(`${BOARD_FAILED} ${PROFILE_FAILED}`);
  });

  it("sends one request however often «Qəbul et» is pressed while it runs", async () => {
    let answer;
    const { api } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockReturnValue(new Promise((resolve) => { answer = resolve; })),
    });
    fillRequired();
    await act(async () => {
      fireEvent.click(admitButton());
      fireEvent.click(admitButton());
      fireEvent.submit(admitButton().closest("form"));                    // Enter in a field
    });
    expect(api.admit).toHaveBeenCalledTimes(1);
    expect(admitButton().getAttribute("aria-busy")).toBe("true");
    await act(async () => { answer(admitted()); });
    await settle();
    expect(screen.getByText("H2600042")).toBeTruthy();
    expect(api.admit).toHaveBeenCalledTimes(1);
  });

  it("opens an empty form on «Yeni qəbul», focused on its first field", async () => {
    await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => a.admit.mockResolvedValue(admitted()) });
    fillRequired();
    await press();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qəbul" })); });
    const name = screen.getByLabelText(/^Ad soyad/);
    expect(name.value).toBe("");
    expect(name.getAttribute("aria-invalid")).toBeNull();
    expect(missingNow()).toEqual(EVERY_MISSING);
    expect(screen.queryByText(/^Seçilən:/)).toBeNull();
    expect(document.activeElement).toBe(name);
  });

  it("puts a refusal on the toast named after the bed, by its code, and reads the beds again", async () => {
    const { api } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockRejectedValue(refusal(409, "Bed is not AVAILABLE (current state: OCCUPIED); cannot admit.",
        { apiCode: "bed_not_available" })),
    });
    fillRequired();
    const reads = api.structure.mock.calls.length;
    await press();
    expect(toasts().getAllByText(`${BED1}: Bu çarpayı artıq boş deyil; başqa çarpayı seçin.`).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/current state/);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.queryByText("H2600042")).toBeNull();
    expect(api.admissions).not.toHaveBeenCalled();                            // nothing went unanswered
  });

  it("says an uncoded 404 by its status in the reader's words, never the server's English (A-9)", async () => {
    const { api } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockRejectedValue(refusal(404, "Bed not found.")),
    });
    fillRequired();
    const reads = api.structure.mock.calls.length;
    await press();
    expect(toasts().getAllByText(`${BED1}: Sorğu uğursuz oldu (404).`).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/not found/i);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
  });

  it("lets go of a bed a re-read shows taken, so the panel names the bed missing again", async () => {
    const { api } = await mountKabul(<><AdmitTab /><Reread /></>, { perms: NURSE });
    fillRequired();
    expect(missingNow()).toEqual([]);
    api.structure.mockResolvedValue(withBed(1, { state: "OCCUPIED" }));
    await act(async () => { fireEvent.click(screen.getByText("reread")); });
    await settle();
    expect(missingNow()).toEqual(["Çarpayı"]);
    expect(screen.queryByText(/^Seçilən:/)).toBeNull();
    expect(admitButton().getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps a typed allergy when «Məlum allergiyası yoxdur» is ticked and unticked, and holds the form while both stand", async () => {
    await mountKabul(<AdmitTab />, { perms: NURSE });
    const allergy = screen.getByLabelText(/^Məlum allergiya( \*)?$/);
    const none = screen.getByLabelText("Məlum allergiyası yoxdur");
    fireEvent.change(allergy, { target: { value: "Penisilin" } });
    expect(missingNow()).not.toContain(ALLERGY_MISSING);
    fireEvent.click(none);
    expect(allergy.value).toBe("Penisilin");
    expect(missingNow()).toContain(ALLERGY_MISSING);
    fireEvent.click(none);
    expect(allergy.value).toBe("Penisilin");
    expect(missingNow()).not.toContain(ALLERGY_MISSING);
  });

  it("shows the age beside the date of birth, not as a field, and none for a year before 1900", async () => {
    await mountKabul(<AdmitTab />, { perms: NURSE });
    const dob = screen.getByLabelText(/^Doğum tarixi/);
    fireEvent.change(dob, { target: { value: "2000-01-01" } });
    expect(screen.getByText(/^\d+ yaş \d+ ay \d+ gün$/)).toBeTruthy();
    fireEvent.change(dob, { target: { value: "0050-01-01" } });
    expect(screen.queryByText(/yaş/)).toBeNull();
    expect(missingNow()).toContain("Doğum tarixi düzgün deyil");
    expect(dob.getAttribute("min")).toBe("1900-01-01");
  });

  it("starts with no nationality chosen, offers no autocomplete, marks the bed required and bounds each text as the server does", async () => {
    await mountKabul(<AdmitTab />, { perms: NURSE });
    const nationality = screen.getByLabelText(/^Vətəndaşlıq/);
    expect(nationality.value).toBe("");
    expect(nationality.selectedOptions[0].textContent).toBe("Seçin…");
    expect(admitButton().closest("form").getAttribute("autocomplete")).toBe("off");
    expect(screen.getByRole("heading", { name: "Çarpayı" }).textContent).toBe("Çarpayı *");

    const here = path.dirname(fileURLToPath(import.meta.url));
    const schemas = fs.readFileSync(path.resolve(here, "../../../../../homunculus-engine/src/homunculus/admission/schemas.py"), "utf8");
    const bound = (field) => Number(new RegExp(`^\\s+${field}: [^\\n]*max_length=(\\d+)`, "m").exec(schemas)[1]);
    for (const [label, field] of [
      [/^Ad soyad( \*)?$/, "display_name"], [/^Ata adı$/, "father_name"], [/^Pasport nömrəsi$/, "passport_no"],
      [/^Telefon$/, "phone"], [/^Qəbul diaqnozu( \*)?$/, "admission_diagnosis_free_text"],
      [/^Məlum allergiya( \*)?$/, "allergies_text"], [/^Digər müşayiət edən xəstəliklər$/, "comorbidities_text"],
      [/^XİS protokol nömrəsi$/, "his_patient_reference"], [/^Yaxınının adı$/, "relative_name"],
      [/^Yaxınının telefonu$/, "relative_phone"], [/^Müşayiətçi$/, "companion_name"],
    ]) {
      expect(screen.getByLabelText(label).maxLength, field).toBe(bound(field));
    }
    // FİN's own format is seven letters or digits — tighter than the column.
    expect(screen.getByLabelText(/^FİN$/).maxLength).toBe(7);
    expect(bound("national_id")).toBeGreaterThanOrEqual(7);
  });

  it("says the beds could not be read when the first read failed — not that the scope holds none — and reads again on request", async () => {
    const { api } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.structure.mockRejectedValue(refusal(500, "Internal Server Error")),
    });
    expect(screen.getByText(/^Siyahı oxunmadı: /)).toBeTruthy();
    expect(screen.queryByText("Səlahiyyət dairənizdə təyin olunmuş şöbə və ya çarpayı yoxdur.")).toBeNull();
    api.structure.mockResolvedValue(structure());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" })); });
    await settle();
    expect(screen.getByRole("button", { name: /^Reanimasiya/ })).toBeTruthy();
  });

  describe("after a send that got no answer", () => {
    it("says it may have gone through, and lets the nurse send again when the re-read shows the bed still free", async () => {
      const { api } = await mountKabul(<AdmitTab />, {
        perms: NURSE,
        setup: (a) => a.admit.mockRejectedValueOnce(timedOut()).mockResolvedValueOnce(admitted()),
      });
      fillRequired();
      const reads = api.structure.mock.calls.length;
      await press();
      expect(toasts().getAllByText(`${BED1}: ${TIMEOUT}`).length).toBeGreaterThan(0);
      expect(api.structure.mock.calls.length).toBeGreaterThan(reads);         // the bed's state is read again
      expect(admitButton().getAttribute("aria-disabled")).toBeNull();
      expect(screen.getByText(`Seçilən: ${BED1}`)).toBeTruthy();
      expect(screen.queryByText(GO_ON)).toBeNull();

      await press();
      expect(api.admissions).toHaveBeenCalledWith(["DRAFT", "ACTIVE"]);    // the first is looked for first
      expect(api.admit).toHaveBeenCalledTimes(2);
      expect(screen.getByText("H2600042")).toBeTruthy();
    });

    it("shows the number of the admission it left when the bed is taken and that DRAFT is on it", async () => {
      const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => a.admit.mockRejectedValue(timedOut()) });
      fillRequired();
      api.structure.mockResolvedValue(withBed(1, { state: "OCCUPIED" }));
      api.admissions.mockResolvedValue([row({ id: "a-9", state: "DRAFT", bed_id: BED(1), patient_number: "H2600042" })]);
      await press();

      expect(api.admit).toHaveBeenCalledTimes(1);
      expect(api.admissions).toHaveBeenCalledWith(["DRAFT", "ACTIVE"]);
      expect(screen.getByText("H2600042")).toBeTruthy();
      expect(screen.getByText(`Çarpayı: ${BED1}`)).toBeTruthy();
      expect(screen.getByText(RECORDED)).toBeTruthy();
      expect(toasts().getAllByText(`${BED1} · qəbul edildi, xəstə nömrəsi H2600042`).length).toBeGreaterThan(0);
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Qəbul edildi" }));
      expect(document.body.textContent).not.toMatch(UUID_TEXT);
    });

    // Final review M-1: the physician may sign the admission the first send left before the nurse
    // looks for it. Signed, it is ACTIVE — no longer a DRAFT, and still that send's admission.
    it("finds the send that landed when a physician has already signed it: an ACTIVE admission, not only a DRAFT (M-1)", async () => {
      const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => a.admit.mockRejectedValue(timedOut()) });
      fillRequired();
      api.structure.mockResolvedValue(withBed(1, { state: "OCCUPIED" }));
      const signed = row({ id: "a-9", state: "ACTIVE", bed_id: BED(1), patient_number: "H2600042" });
      // The server answers the states asked for, and no other.
      api.admissions.mockImplementation(async (states) => [signed].filter((r) => [].concat(states).includes(r.state)));
      await press();

      expect(api.admit).toHaveBeenCalledTimes(1);
      expect(screen.getByText("H2600042")).toBeTruthy();
      expect(screen.getByText(`Çarpayı: ${BED1}`)).toBeTruthy();
      expect(screen.getByText(RECORDED)).toBeTruthy();
      expect(screen.queryByText(HELD)).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Qəbul edildi" }));
    });

    it("holds «Qəbul et», naming the bed and where to look, when the bed is taken and no DRAFT of this patient shows", async () => {
      const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => a.admit.mockRejectedValue(timedOut()) });
      fillRequired();
      api.structure.mockResolvedValue(withBed(1, { state: "OCCUPIED" }));
      api.admissions.mockResolvedValue([row({ state: "DRAFT", bed_id: BED(1), display_name: "Sentetik Başqası", patient_number: "H2600077" })]);
      await press();

      expect(screen.queryByText("H2600077")).toBeNull();                      // another patient's number is never offered
      expect(toasts().getAllByText(`${BED1}: ${TIMEOUT}`).length).toBeGreaterThan(0);
      const reason = panel().getByText(HELD);
      expect(admitButton().getAttribute("aria-describedby").split(" ")).toContain(reason.id);
      expect(missingNow()).toEqual(["Çarpayı"]);                              // the taken bed is no longer the form's

      pickBed5();
      expect(missingNow()).toEqual([]);
      expect(admitButton().getAttribute("aria-disabled")).toBe("true");       // held all the same
      admitButton().focus();                                                 // where a keyboard press comes from
      await press();
      expect(api.admit).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(panel().getByText(HELD));           // a held press is told why (M-4)

      await act(async () => { fireEvent.click(screen.getByRole("button", { name: GO_ON })); });
      expect(panel().queryByText(HELD)).toBeNull();
      expect(admitButton().getAttribute("aria-disabled")).toBeNull();
    });

    it("says only that the outcome is not known — never that the bed is taken — when the re-read fails (M-1)", async () => {
      const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => a.admit.mockRejectedValue(timedOut()) });
      fillRequired();
      api.structure.mockRejectedValue(refusal(503, "Service Unavailable"));
      api.admissions.mockRejectedValue(refusal(503, "Service Unavailable"));
      await press();
      expect(panel().getByText(HELD)).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/artıq boş deyil/);
      expect(admitButton().getAttribute("aria-disabled")).toBe("true");
    });

    it("holds a send to another bed while the first is unanswered, naming the first's bed — and keeps looking after «go on» (R1, R2)", async () => {
      const { api } = await mountKabul(<AdmitTab />, {
        perms: NURSE,
        setup: (a) => a.admit.mockRejectedValueOnce(timedOut()).mockResolvedValueOnce(admitted(undefined, "H2600050")),
      });
      fillRequired();
      await press();                                                         // no answer; bed 1 still free
      pickBed5();                                                            // the same patient, another bed
      await press();                                                         // the first has not landed yet
      expect(api.admit).toHaveBeenCalledTimes(1);
      expect(api.admissions).toHaveBeenCalledTimes(1);
      expect(panel().getByText(HELD)).toBeTruthy();
      expect(document.activeElement).toBe(panel().getByText(HELD));
      expect(admitButton().getAttribute("aria-disabled")).toBe("true");

      await act(async () => { fireEvent.click(screen.getByRole("button", { name: GO_ON })); });
      await press();                                                         // looked for again, still nothing: sent
      expect(api.admissions).toHaveBeenCalledTimes(2);
      expect(api.admit).toHaveBeenCalledTimes(2);
      expect(api.admit.mock.calls[1][0].note.bed_id).toBe(BED(5));
      expect(screen.getByText("H2600050")).toBeTruthy();
    });

    it("holds a send under another name to the same bed while the first is unanswered (R1)", async () => {
      const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => a.admit.mockRejectedValue(timedOut()) });
      fillRequired();
      await press();
      fireEvent.change(screen.getByLabelText(/^Ad soyad/), { target: { value: "Sentetik Başqası" } });
      await press();
      expect(api.admit).toHaveBeenCalledTimes(1);
      expect(panel().getByText(HELD)).toBeTruthy();
    });

    it("finds the first send after «go on» when its DRAFT shows only then, and sends nothing more (R2)", async () => {
      const { api } = await mountKabul(<AdmitTab />, {
        perms: NURSE,
        setup: (a) => a.admit.mockRejectedValueOnce(timedOut()).mockResolvedValueOnce(admitted(undefined, "H2600050")),
      });
      fillRequired();
      api.structure.mockResolvedValue(withBed(1, { state: "OCCUPIED" }));
      api.admissions.mockRejectedValueOnce(refusal(503, "Service Unavailable"));
      await press();                                                         // bed taken, the list unreadable: held
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: GO_ON })); });
      pickBed5();
      const lookups = api.admissions.mock.calls.length;
      api.admissions.mockResolvedValue([firstDraft()]);
      await press();

      expect(api.admissions.mock.calls.length - lookups).toBe(1);
      expect(api.admit).toHaveBeenCalledTimes(1);
      expect(screen.getByText("H2600042")).toBeTruthy();
      expect(screen.getByText(`Çarpayı: ${BED1}`)).toBeTruthy();
      expect(screen.queryByText("H2600050")).toBeNull();
    });

    it("shows an earlier patient's admission as that patient's — never as the form's — and keeps the form (R3)", async () => {
      const { api } = await mountKabul(<AdmitTab />, {
        perms: NURSE,
        setup: (a) => a.admit.mockRejectedValueOnce(timedOut()).mockResolvedValueOnce(admitted(undefined, "H2600099")),
      });
      fillRequired();
      await press();                                                         // no answer for Sentetik Hasta, bed 1
      fireEvent.change(screen.getByLabelText(/^Ad soyad/), { target: { value: "Sentetik Başqası" } });
      pickBed5();
      api.admissions.mockResolvedValue([firstDraft()]);
      await press();

      expect(api.admit).toHaveBeenCalledTimes(1);                            // the form's patient is not sent
      expect(screen.getByText("H2600042")).toBeTruthy();
      expect(screen.getByText(`Çarpayı: ${BED1}`)).toBeTruthy();
      expect(screen.getByText(EARLIER)).toBeTruthy();
      expect(screen.getByText(RECORDED)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Yeni qəbul" })).toBeNull();
      // Whose number it is, before the number: the heading says another patient's, and the note
      // names her and her bed above the number — never "Qəbul edildi" as if for the form (M-c).
      const heading = screen.getByRole("heading", { level: 2, name: EARLIER_TITLE });
      expect(document.activeElement).toBe(heading);
      expect(screen.queryByRole("heading", { name: "Qəbul edildi" })).toBeNull();
      const whose = screen.getByText(EARLIER);
      const number = screen.getByText("H2600042");
      expect(heading.compareDocumentPosition(whose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(whose.compareDocumentPosition(number) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(await said()).toContain(`${EARLIER} ${RECORDED}`);
      // The toast says the same: an earlier send's admission — a warning, never the form's own
      // success under the form's bed (m-1).
      const told = toasts().getAllByText(EARLIER_TOAST);
      expect(told[0].closest("[data-tone]").getAttribute("data-tone")).toBe("warn");
      expect(toasts().queryByText(`${BED1} · qəbul edildi, xəstə nömrəsi H2600042`)).toBeNull();

      await act(async () => { fireEvent.click(screen.getByRole("button", { name: BACK })); });
      expect(screen.getByLabelText(/^Ad soyad/).value).toBe("Sentetik Başqası");
      expect(screen.getByText("Seçilən: 5 · Otaq 2 · Reanimasiya")).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByLabelText(/^Ad soyad/));
      await press();
      expect(api.admit).toHaveBeenCalledTimes(2);
      expect(api.admit.mock.calls[1][0].patient.display_name).toBe("Sentetik Başqası");
      expect(screen.getByText("H2600099")).toBeTruthy();
    });

    it("finds the first send's DRAFT when a second send to its bed is refused as taken", async () => {
      const { api } = await mountKabul(<AdmitTab />, {
        perms: NURSE,
        setup: (a) => a.admit.mockRejectedValueOnce(timedOut()).mockRejectedValueOnce(
          refusal(409, "Bed is not AVAILABLE (current state: OCCUPIED); cannot admit.", { apiCode: "bed_not_available" })),
      });
      fillRequired();
      await press();                                                         // no answer; the bed is still free
      api.structure.mockResolvedValue(withBed(1, { state: "OCCUPIED" }));
      api.admissions.mockResolvedValueOnce([])
        .mockResolvedValueOnce([row({ state: "DRAFT", bed_id: BED(1), patient_number: "H2600042" })]);
      await press();                                                         // the first landed meanwhile

      expect(api.admit).toHaveBeenCalledTimes(2);
      expect(api.admissions).toHaveBeenCalledTimes(2);
      expect(screen.getByText("H2600042")).toBeTruthy();
      expect(screen.getByText(RECORDED)).toBeTruthy();
    });

    it("holds nothing after a definite refusal when the earlier send's DRAFT is found and no outcome is left unknown (M-b)", async () => {
      const { api } = await mountKabul(<AdmitTab />, {
        perms: NURSE,
        setup: (a) => a.admit.mockRejectedValueOnce(timedOut()).mockRejectedValueOnce(bedTaken()),
      });
      fillRequired();
      await press();                                                         // Sentetik Hasta: no answer; bed 1 still free
      fireEvent.change(nameField(), { target: { value: "Sentetik Başqası" } });
      await press();                                                         // another name, the same bed: held (R1)
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: GO_ON })); });
      api.structure.mockResolvedValue(withBed(1, { state: "OCCUPIED" }));
      api.admissions.mockResolvedValueOnce([])                               // looked for before the send: not there yet
        .mockResolvedValueOnce([firstDraft()]);                              // looked for after the refusal: there
      await press();                                                         // refused: the first took the bed meanwhile

      expect(api.admit).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("heading", { level: 2, name: EARLIER_TITLE })).toBeTruthy();
      expect(screen.getByText(EARLIER)).toBeTruthy();
      expect(screen.getByText("H2600042")).toBeTruthy();
      expect(toasts().getAllByText(TAKEN).length).toBeGreaterThan(0);        // the form's own refusal, by its code
      expect(document.body.textContent).not.toMatch(/current state/);

      await act(async () => { fireEvent.click(screen.getByRole("button", { name: BACK })); });
      expect(nameField().value).toBe("Sentetik Başqası");
      expect(panel().queryByText(HELD)).toBeNull();                           // nothing is unknown: nothing to wait for
      expect(missingNow()).toEqual(["Çarpayı"]);                             // the taken bed is no longer the form's
      pickBed5();
      expect(admitButton().getAttribute("aria-disabled")).toBeNull();
    });
  });

  // A-19: every send of one filled form carries its request id; the server answers a second send of
  // the same form with the first's admission (200, the same body), and refuses another form under
  // the same id `request_conflict` — naming the earlier admission's number when its bed is hers.
  describe("the request id (A-19)", () => {
    const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const CONFLICT = "Bu forma ilə artıq qəbul yazılıb (xəstə nömrəsi H2600042); forma yenidən göndərilmədi. "
      + "«Evə yazılma › Yatan xəstələr» siyahısına baxın.";
    const conflict = () => refusal(409, "This request id came before with another admission form.",
      { apiCode: "request_conflict", patientNumber: "H2600042" });

    it("sends a resend after a timeout under the same id, and takes the server's replayed answer as the admission", async () => {
      const { api } = await mountKabul(<AdmitTab />, {
        perms: NURSE,
        setup: (a) => a.admit.mockRejectedValueOnce(timedOut()).mockResolvedValueOnce(admitted()),
      });
      fillRequired();
      await press();                                                         // no answer; bed 1 still free
      await press();                                                         // the server answers the first's admission
      const [first, second] = api.admit.mock.calls.map(([body]) => body.request_id);
      expect(first).toMatch(UUID4);
      expect(second).toBe(first);
      expect(screen.getByText("H2600042")).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Qəbul edildi" }));
      expect(document.body.innerHTML).not.toContain(first);
    });

    it("stops at a request_conflict: says an admission exists under this form with its number, holds «Qəbul et», sends nothing more — and «Yeni qəbul» starts afresh", async () => {
      const { api, store } = await mountKabul(<AdmitTab />, {
        perms: NURSE,
        setup: (a) => a.admit.mockRejectedValueOnce(timedOut()).mockRejectedValueOnce(conflict()),
      });
      fillRequired();
      await press();                                                         // no answer; bed 1 still free
      fireEvent.change(screen.getByLabelText(/^Qəbul diaqnozu/), { target: { value: "Sentetik tanı, düzəldilmiş" } });
      await press();                                                         // the first had landed: another form, the same id
      expect(api.admit).toHaveBeenCalledTimes(2);
      const spent = api.admit.mock.calls[0][0].request_id;
      expect(api.admit.mock.calls[1][0].request_id).toBe(spent);

      expect(toasts().getAllByText(`${BED1}: ${CONFLICT}`).length).toBeGreaterThan(0);
      const reason = panel().getByText(CONFLICT);
      expect(admitButton().getAttribute("aria-disabled")).toBe("true");
      expect(admitButton().getAttribute("aria-describedby").split(" ")).toContain(reason.id);
      expect(panel().queryByRole("button", { name: GO_ON })).toBeNull();    // nothing to go on to: it exists
      // The send that got no answer is kept under its id, and looked for until its admission is
      // found (R2, review I-3): an admission exists under the id, not known where.
      const kept = () => admitDraftOf(store).get().unanswered.map((s) => [s.bed, s.requestId, s.checked]);
      expect(kept()).toEqual([[BED1, spent, false]]);
      expect(document.body.textContent).not.toMatch(/request id|another admission form/);

      admitButton().focus();
      await press();                                                         // never sent again
      expect(api.admit).toHaveBeenCalledTimes(2);
      expect(document.activeElement).toBe(reason);

      await act(async () => { fireEvent.click(panel().getByRole("button", { name: "Yeni qəbul" })); });
      expect(nameField().value).toBe("");
      expect(document.activeElement).toBe(nameField());
      expect(panel().queryByText(CONFLICT)).toBeNull();
      expect(admitDraftOf(store).get().requestId).toMatch(UUID4);
      expect(admitDraftOf(store).get().requestId).not.toBe(spent);
      expect(kept()).toEqual([[BED1, spent, false]]);                        // «Yeni qəbul» keeps it too (R2)
      expect(document.body.innerHTML).not.toContain(spent);
    });

    // Review I-3: X to bed A under id1 gets no answer but lands; she looked and found nothing, goes
    // on to bed B under id1 — refused `request_conflict`. Had the conflict dropped the bed A send,
    // «Yeni qəbul» and X typed again to bed B would admit X a second time.
    it("keeps the unanswered send through a request_conflict, so the same patient sent again after «Yeni qəbul» is held, never sent (R1, review I-3)", async () => {
      const { api, store } = await mountKabul(<AdmitTab />, {
        perms: NURSE,
        setup: (a) => a.admit.mockRejectedValueOnce(timedOut()).mockRejectedValueOnce(conflict()),
      });
      fillRequired();                                                        // X to bed 1, under id1
      api.structure.mockResolvedValue(withBed(1, { state: "OCCUPIED" }));     // it landed: the bed is taken …
      api.admissions.mockResolvedValue([]);                                  // … and no DRAFT of it shows
      await press();
      expect(panel().getByText(HELD)).toBeTruthy();
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: GO_ON })); });
      pickBed5();
      await press();                                                         // X to bed 5, under id1: refused
      expect(api.admit).toHaveBeenCalledTimes(2);
      const id1 = api.admit.mock.calls[0][0].request_id;
      expect(api.admit.mock.calls[1][0].request_id).toBe(id1);
      // The admission under id1 is the bed 1 send's: the toast names that bed, never bed 5 (minor).
      expect(toasts().getAllByText(`${BED1}: ${CONFLICT}`).length).toBeGreaterThan(0);
      expect(toasts().queryByText(`5 · Otaq 2 · Reanimasiya: ${CONFLICT}`)).toBeNull();
      // Kept under its id, and no longer "looked at, nothing": an admission exists under it.
      expect(admitDraftOf(store).get().unanswered.map((s) => [s.bed, s.requestId, s.checked])).toEqual([[BED1, id1, false]]);

      await act(async () => { fireEvent.click(panel().getByRole("button", { name: "Yeni qəbul" })); });
      fillRequired(["bed"]);                                                 // X typed again …
      fireEvent.click(screen.getByRole("button", { name: /^Reanimasiya/ })); // (a new form: its unit first)
      pickBed5();                                                            // … to bed 5
      await press();
      expect(api.admit).toHaveBeenCalledTimes(2);                            // never sent
      expect(panel().getByText(HELD)).toBeTruthy();                          // held, naming bed 1 (R1)
      expect(admitButton().getAttribute("aria-disabled")).toBe("true");
    });

    it("names no bed on a request_conflict whose earlier send it does not hold — never the form's own", async () => {
      const { api, store } = await mountKabul(<AdmitTab />, {
        perms: NURSE, setup: (a) => a.admit.mockRejectedValueOnce(conflict()),
      });
      fillRequired();
      await press();
      expect(api.admit).toHaveBeenCalledTimes(1);
      expect(toasts().getAllByText(CONFLICT).length).toBeGreaterThan(0);
      expect(toasts().queryByText(`${BED1}: ${CONFLICT}`)).toBeNull();
      expect(admitDraftOf(store).get().held).toMatchObject({ conflict: { key: "kabul.err.requestConflictNumber" } });
    });
  });

  // A-37: the server refuses a second OPEN admission of the same person — her name and birth date,
  // in the hospital — whatever the form's id: `duplicate_open_admission`, with the open admission's
  // number when the nurse's units hold its bed. Nothing was written; that admission is discharged
  // first. The form is held, never sent again, and nothing is retried.
  describe("a second open admission of the same person (A-37)", () => {
    const DUPLICATE = "Bu xəstənin artıq açıq qəbulu var (xəstə nömrəsi H2600042); əvvəlcə evə yazılmalıdır. Forma göndərilmədi.";
    const duplicate = () => refusal(409, "An open admission already exists for this patient.",
      { apiCode: "duplicate_open_admission", patientNumber: "H2600042" });

    it("holds «Qəbul et» with words of its own, sends nothing more and retries nothing — and «Yeni qəbul» starts afresh", async () => {
      const { api, store } = await mountKabul(<AdmitTab />, {
        perms: NURSE, setup: (a) => a.admit.mockRejectedValueOnce(duplicate()).mockResolvedValue(admitted()),
      });
      fillRequired();
      const spent = admitDraftOf(store).get().requestId;
      await press();
      expect(api.admit).toHaveBeenCalledTimes(1);

      const reason = panel().getByText(DUPLICATE);
      expect(admitButton().getAttribute("aria-disabled")).toBe("true");
      expect(admitButton().getAttribute("aria-describedby").split(" ")).toContain(reason.id);
      expect(document.activeElement).toBe(reason);                           // the hold is news
      expect(admitDraftOf(store).get().held).toEqual({
        bed: null, duplicate: { key: "kabul.err.duplicateOpenAdmissionNumber", vars: { number: "H2600042" } },
      });
      expect(panel().queryByRole("button", { name: GO_ON })).toBeNull();    // nothing to go on to: it exists
      // The toast names no bed: the open admission's is not known here, and the form's is not it.
      expect(toasts().getAllByText(DUPLICATE).length).toBeGreaterThan(0);
      expect(toasts().queryByText(`${BED1}: ${DUPLICATE}`)).toBeNull();
      expect(document.body.textContent).not.toMatch(/already exists/);
      expect(api.admissions).not.toHaveBeenCalled();                         // a refusal, not a send with no answer
      expect(admitDraftOf(store).get().unanswered).toEqual([]);

      admitButton().focus();
      await press();                                                         // never sent again
      await settle();
      expect(api.admit).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(reason);

      await act(async () => { fireEvent.click(panel().getByRole("button", { name: "Yeni qəbul" })); });
      expect(nameField().value).toBe("");
      expect(document.activeElement).toBe(nameField());
      expect(panel().queryByText(DUPLICATE)).toBeNull();
      expect(admitDraftOf(store).get().requestId).not.toBe(spent);
      expect(api.admit).toHaveBeenCalledTimes(1);
    });
  });

  describe("the form's memory — the session's, not the tab's (A-21)", () => {
    afterEach(() => {
      window.location.hash = "";
      localStorage.clear();
    });

    it("lands a send's answer while another tab is open: back on Qəbul the number box is there, and nothing more was sent", async () => {
      let answer;
      const { api } = await mountKabul(<KabulScreen />, {
        perms: NURSE,
        setup: (a) => a.admit.mockReturnValue(new Promise((resolve) => { answer = resolve; })),
      });
      fillRequired();
      await act(async () => { fireEvent.click(admitButton()); });           // on its way
      await openTab("Evə yazılma");                                          // where the hold's text sends her
      await openTab("Qəbul");                                                // back while it is still on its way
      expect(nameField().value).toBe("Sentetik Hasta");
      expect(admitButton().getAttribute("aria-busy")).toBe("true");
      await press();
      expect(api.admit).toHaveBeenCalledTimes(1);                            // a press meanwhile sends nothing

      await openTab("Evə yazılma");
      await act(async () => { answer(admitted()); });                        // the answer lands with the tab closed
      await settle();
      await openTab("Qəbul");
      expect(screen.getByText("H2600042")).toBeTruthy();
      expect(screen.getByRole("heading", { level: 2, name: "Qəbul edildi" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Qəbul et" })).toBeNull(); // no second admission from here
      expect(api.admit).toHaveBeenCalledTimes(1);
    });

    it("still holds a send to another bed under another name after a tab change, while the first is unanswered (R1)", async () => {
      const { api } = await mountKabul(<KabulScreen />, { perms: NURSE, setup: (a) => a.admit.mockRejectedValue(timedOut()) });
      fillRequired();
      await press();                                                         // no answer; bed 1 still free: no hold
      expect(panel().queryByText(HELD)).toBeNull();
      await openTab("Evə yazılma");
      await openTab("Qəbul");
      expect(nameField().value).toBe("Sentetik Hasta");                      // the form is where she left it
      expect(screen.getByText(`Seçilən: ${BED1}`)).toBeTruthy();

      fireEvent.change(nameField(), { target: { value: "Sentetik Başqası" } });
      pickBed5();
      await press();
      expect(api.admit).toHaveBeenCalledTimes(1);                            // the first may still land: nothing sent
      expect(panel().getByText(HELD)).toBeTruthy();
      expect(document.activeElement).toBe(panel().getByText(HELD));
    });

    it("says a hold its send's lookup reached on the toast, and takes the focus to its reason on the tab mounted now (m-2)", async () => {
      let looked;
      const { api } = await mountKabul(<KabulScreen />, { perms: NURSE, setup: (a) => a.admit.mockRejectedValue(timedOut()) });
      fillRequired();
      await press();                                                         // no answer; bed 1 still free: no hold
      fireEvent.change(nameField(), { target: { value: "Sentetik Başqası" } });
      pickBed5();
      // The form's lookup is held in flight; Taburcu's own read (the started discharges too) answers at once.
      api.admissions.mockImplementation((states) => (!states.includes("PENDING_DISCHARGE")
        ? new Promise((resolve) => { looked = resolve; }) : Promise.resolve([])));
      await act(async () => { fireEvent.click(admitButton()); });           // looking for the first send
      await openTab("Evə yazılma");
      const tab = screen.getByRole("tab", { name: "Qəbul" });
      tab.focus();                                                           // by the keyboard, onto the tab
      await act(async () => { fireEvent.click(tab); });                      // another instance of the tab
      await settle();
      expect(panel().queryByText(HELD)).toBeNull();
      await act(async () => { looked([]); });                                // not found: held (R1)
      await settle();

      expect(api.admit).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(panel().getByText(HELD));         // on the tab she is on
      const told = toasts().getAllByText(HELD);                              // and said, wherever she is
      expect(told[0].closest("[data-tone]").getAttribute("data-tone")).toBe("warn");
    });

    it("leaves the focus in the field she moved on to when the hold arrives: the toast says it (re-review M-2)", async () => {
      let looked;
      const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => a.admit.mockRejectedValue(timedOut()) });
      fillRequired();
      await press();                                                         // no answer; bed 1 still free
      fireEvent.change(nameField(), { target: { value: "Sentetik Başqası" } });
      pickBed5();
      api.admissions.mockImplementation(() => new Promise((resolve) => { looked = resolve; }));
      await act(async () => { fireEvent.click(admitButton()); });           // looking for the first send
      const phone = screen.getByLabelText(/^Telefon$/);
      phone.focus();                                                         // she types on meanwhile
      await act(async () => { looked([]); });                                // not found: held (R1)
      await settle();
      expect(panel().getByText(HELD)).toBeTruthy();
      expect(document.activeElement).toBe(phone);                           // her keystrokes stay hers
      expect(toasts().getAllByText(HELD).length).toBeGreaterThan(0);
      expect(api.admit).toHaveBeenCalledTimes(1);
    });

    it("takes the focus to the hold's reason from «Qəbul et» itself, where her press left it (re-review M-2)", async () => {
      let looked;
      const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => a.admit.mockRejectedValue(timedOut()) });
      fillRequired();
      await press();
      fireEvent.change(nameField(), { target: { value: "Sentetik Başqası" } });
      pickBed5();
      api.admissions.mockImplementation(() => new Promise((resolve) => { looked = resolve; }));
      admitButton().focus();
      await act(async () => { fireEvent.click(admitButton()); });
      await act(async () => { looked([]); });
      await settle();
      expect(document.activeElement).toBe(panel().getByText(HELD));
    });

    it("says a hold reached while she is on another tab, and takes no focus when she comes back to it (m-2)", async () => {
      let looked;
      const { api } = await mountKabul(<KabulScreen />, { perms: NURSE, setup: (a) => a.admit.mockRejectedValue(timedOut()) });
      fillRequired();
      await press();
      fireEvent.change(nameField(), { target: { value: "Sentetik Başqası" } });
      pickBed5();
      api.admissions.mockImplementation((states) => (!states.includes("PENDING_DISCHARGE")
        ? new Promise((resolve) => { looked = resolve; }) : Promise.resolve([])));
      await act(async () => { fireEvent.click(admitButton()); });
      await openTab("Evə yazılma");
      await act(async () => { looked([]); });                                // held while no Qəbul tab is mounted
      await settle();
      expect(toasts().getAllByText(HELD).length).toBeGreaterThan(0);

      const tab = screen.getByRole("tab", { name: "Qəbul" });
      tab.focus();
      await act(async () => { fireEvent.click(tab); });
      await settle();
      expect(panel().getByText(HELD)).toBeTruthy();                          // the hold is the session's
      expect(document.activeElement).toBe(tab);                              // coming back is not news
      expect(api.admit).toHaveBeenCalledTimes(1);
    });

    it("keeps the form and its unanswered send when the nurse leaves the screen by the menu and comes back", async () => {
      window.location.hash = "#/kabul";
      const { api } = await mount(<ThemeProvider><Shell resume="/kabul" /></ThemeProvider>, {
        access: token({ perms: NURSE }), me: profile({ perms: NURSE }),
        setup: (a) => {
          a.structure.mockResolvedValue(structure());
          a.admissions.mockResolvedValue([]);
          a.admit.mockRejectedValue(timedOut());
        },
      });
      await settle();
      fillRequired();
      await press();                                                         // no answer; bed 1 still free
      await go("#/settings");
      expect(screen.queryByRole("tab", { name: "Qəbul" })).toBeNull();       // the screen is gone
      await go("#/kabul");
      expect(nameField().value).toBe("Sentetik Hasta");
      expect(screen.getByText(`Seçilən: ${BED1}`)).toBeTruthy();
      expect(missingNow()).toEqual([]);

      pickBed5();
      await press();
      expect(api.admit).toHaveBeenCalledTimes(1);                            // the send with no answer is still minded (R1)
      expect(panel().getByText(HELD)).toBeTruthy();
    });

    it("forgets the form and its sends when the session ends — a send answering afterwards included — and the next nurse starts empty", async () => {
      let answer;
      const { api, store } = await mountKabul(<AdmitTab />, {
        perms: NURSE,
        setup: (a) => a.admit.mockRejectedValueOnce(timedOut())
          .mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }))
          .mockResolvedValue(admitted(undefined, "H2600060")),
      });
      fillRequired();
      await press();                                                         // no answer; bed 1 still free
      await act(async () => { fireEvent.click(admitButton()); });           // sent again, still on its way
      expect(api.admit).toHaveBeenCalledTimes(2);

      await act(async () => { store.signOut(); });
      await act(async () => { answer(admitted()); });                        // her send answers after she has gone
      await settle();
      await signInAs(api, store, "u-leyla");

      expect(nameField().value).toBe("");
      expect(missingNow()).toEqual(EVERY_MISSING);
      expect(panel().queryByText(HELD)).toBeNull();
      expect(document.body.textContent).not.toMatch(/Sentetik Hasta|H2600042/);

      // Nothing of the first nurse's sends is looked for or held on: they went with her session.
      const lookups = api.admissions.mock.calls.length;
      fillRequired();
      fireEvent.change(nameField(), { target: { value: "Sentetik Yeni" } });
      pickBed5();
      await press();
      expect(api.admissions.mock.calls.length).toBe(lookups);
      expect(api.admit).toHaveBeenCalledTimes(3);
      expect(screen.getByText("H2600060")).toBeTruthy();
    });
  });

  // Final review M-2: the number box is news as a hold is. It takes the focus when it comes while
  // the tab is mounted, and only from where a press or a return leaves it — <body>, «Qəbul et», a
  // tab. A box already standing when the tab mounts is not news.
  describe("the number box's focus (M-2)", () => {
    const doneHeading = () => screen.getByRole("heading", { level: 2, name: "Qəbul edildi" });

    it("leaves the focus in the tab list when she arrows onto «Qəbul» while a box stands", async () => {
      await mountKabul(<KabulScreen />, { perms: NURSE, setup: (a) => a.admit.mockResolvedValue(admitted()) });
      fillRequired();
      await press();
      expect(document.activeElement).toBe(doneHeading());                   // news: the box takes the focus
      await openTab("Evə yazılma");
      const away = screen.getByRole("tab", { name: "Evə yazılma" });
      away.focus();
      await act(async () => { fireEvent.keyDown(away, { key: "ArrowLeft" }); });
      await settle();

      const tab = screen.getByRole("tab", { name: "Qəbul" });
      expect(tab.getAttribute("aria-selected")).toBe("true");
      expect(doneHeading()).toBeTruthy();                                    // the box is there …
      expect(document.activeElement).toBe(tab);                              // … and the focus stays on the tab
    });

    it("leaves the focus where she moved it, outside the form, when the box comes", async () => {
      let answer;
      await mountKabul(<><AdmitTab /><button type="button">elsewhere</button></>, {
        perms: NURSE,
        setup: (a) => a.admit.mockReturnValue(new Promise((resolve) => { answer = resolve; })),
      });
      fillRequired();
      await act(async () => { fireEvent.click(admitButton()); });           // on its way
      const elsewhere = screen.getByRole("button", { name: "elsewhere" });
      elsewhere.focus();
      await act(async () => { answer(admitted()); });
      await settle();

      expect(screen.getByText("H2600042")).toBeTruthy();
      expect(document.activeElement).toBe(elsewhere);
      expect(toasts().getAllByText(`${BED1} · qəbul edildi, xəstə nömrəsi H2600042`).length).toBeGreaterThan(0);
    });

    it("takes the focus to the box when the answer comes while the focus is on «Qəbul»'s own tab", async () => {
      let answer;
      await mountKabul(<KabulScreen />, {
        perms: NURSE,
        setup: (a) => a.admit.mockReturnValue(new Promise((resolve) => { answer = resolve; })),
      });
      fillRequired();
      await act(async () => { fireEvent.click(admitButton()); });           // on its way
      screen.getByRole("tab", { name: "Qəbul" }).focus();                    // she went back up to the tab list
      await act(async () => { answer(admitted()); });
      await settle();
      expect(document.activeElement).toBe(doneHeading());
    });
  });
});

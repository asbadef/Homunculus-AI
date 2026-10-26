// The Kabul tab (Group 2 · B1a, spec §3.1, §5.2): the side panel names every missing field and
// "Kabul et" is held until it is empty; one request admits; the patient number is shown large with
// what to do with it, and any engine part that did not land; a refusal goes on the toast, named
// after the bed, and the bed picker is read again. A send that got no answer never invites a
// second admission of the same patient: what it may have left is looked for first.
import { describe, it, expect } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { ANNOUNCE_DELAY_MS } from "../../ui/index.js";
import { AdmitTab } from "./AdmitTab.jsx";
import { BED, DOCTOR, NURSE, REA, UUID_TEXT, mountKabul, row, settle, structure, toasts } from "./kabul.testutil.js";

const panel = () => within(screen.getByRole("complementary", { name: "Çatışmayan sahələr" }));
const missingNow = () => panel().queryAllByRole("listitem").map((li) => li.textContent);
const admitButton = () => screen.getByRole("button", { name: "Qəbul et" });
const press = async () => {
  await act(async () => { fireEvent.click(admitButton()); });
  await settle();
};
const timedOut = () => Object.assign(new Error("…"), { code: "REQUEST_TIMEOUT" });
const admitted = (engine = { weight: "ok", profile: "ok", board: "ok" }) => ({
  id: "a-1", patient_number: "H2600042", state: "DRAFT", engine,
});

// The words the tab says, as dashboard/src/live/i18n/strings/kabul.js (az) has them (A-7).
const BED1 = "1 · Otaq 1 · Reanimasiya";
const EVERY_MISSING = ["Ad soyad", "Cins", "Doğum tarixi", "Qəbul növü", "Qəbul diaqnozu",
  "Allergiya və ya «məlum allergiyası yoxdur» — ikisindən biri", "Razılıq", "Çarpayı"];
const ALLERGY_MISSING = "Allergiya və ya «məlum allergiyası yoxdur» — ikisindən biri";
const TIMEOUT = "Server cavab vermədi. Əməliyyat yerinə yetirilmiş ola bilər; yoxlayın və lazım olsa yenidən cəhd edin.";
const WEIGHT_FAILED = "Çəki mühərrikə çatmadı — qəbul yazılıb; sistem administratoruna bildirin.";
const PROFILE_FAILED = "Müşayiət edən xəstəliklər mühərrikə çatmadı — qəbul yazılıb; sistem administratoruna bildirin.";
const BOARD_FAILED = "Kart paneldə görünmürsə, sistem administratoruna bildirin — qəbul yazılıb.";
const RECORDED = "Serverin cavabı gəlmədi, amma qəbul yazılıb. Kart paneldə görünmürsə, sistem administratoruna bildirin.";
const HELD = `${BED1} artıq boş deyil və qəbulun yazılıb-yazılmadığı bilinmir. Təkrarlamadan əvvəl «Evə yazılma › Yatan xəstələr» siyahısına baxın.`;
const GO_ON = "Yoxladım, qəbul yoxdur — davam et";

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
      expect(api.admissions).toHaveBeenCalledWith(["DRAFT"]);              // the first is looked for first
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
      expect(api.admissions).toHaveBeenCalledWith(["DRAFT"]);
      expect(screen.getByText("H2600042")).toBeTruthy();
      expect(screen.getByText(`Çarpayı: ${BED1}`)).toBeTruthy();
      expect(screen.getByText(RECORDED)).toBeTruthy();
      expect(toasts().getAllByText(`${BED1} · qəbul edildi, xəstə nömrəsi H2600042`).length).toBeGreaterThan(0);
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Qəbul edildi" }));
      expect(document.body.textContent).not.toMatch(UUID_TEXT);
    });

    it("holds «Qəbul et», naming the bed and where to look, when the bed is taken and no DRAFT of this patient shows", async () => {
      const { api } = await mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => a.admit.mockRejectedValue(timedOut()) });
      fillRequired();
      api.structure.mockResolvedValue(withBed(1, { state: "OCCUPIED" }));
      api.admissions.mockResolvedValue([row({ state: "DRAFT", bed_id: BED(1), display_name: "Sentetik Başqası", patient_number: "H2600077" })]);
      await press();

      expect(screen.queryByText("H2600077")).toBeNull();                      // another patient's number is never offered
      expect(toasts().getAllByText(`${BED1}: ${TIMEOUT}`).length).toBeGreaterThan(0);
      const reason = screen.getByText(HELD);
      expect(admitButton().getAttribute("aria-describedby").split(" ")).toContain(reason.id);
      expect(missingNow()).toEqual(["Çarpayı"]);                              // the taken bed is no longer the form's

      fireEvent.click(within(screen.getByRole("group", { name: "Otaq 2" })).getByRole("button", { name: "5" }));
      expect(missingNow()).toEqual([]);
      expect(admitButton().getAttribute("aria-disabled")).toBe("true");       // held all the same
      await press();
      expect(api.admit).toHaveBeenCalledTimes(1);

      await act(async () => { fireEvent.click(screen.getByRole("button", { name: GO_ON })); });
      expect(screen.queryByText(HELD)).toBeNull();
      expect(admitButton().getAttribute("aria-disabled")).toBeNull();
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
  });
});

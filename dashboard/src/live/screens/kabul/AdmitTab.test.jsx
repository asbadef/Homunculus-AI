// The Kabul tab (Group 2 · B1a, spec §3.1, §5.2): the side panel names every missing field and
// "Kabul et" is held until it is empty; one request admits; the patient number is shown large with
// what to do with it, and any engine part that did not land; a refusal goes on the toast, named
// after the bed, and the bed picker is read again.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { AdmitTab } from "./AdmitTab.jsx";
import { BED, DOCTOR, NURSE, REA, UUID_TEXT, mountKabul, settle, toasts } from "./kabul.testutil.js";

const panel = () => within(screen.getByRole("complementary", { name: "Çatışmayan sahələr" }));
const admitButton = () => screen.getByRole("button", { name: "Qəbul et" });

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/^Ad soyad/), { target: { value: "Sentetik Hasta" } });
  fireEvent.click(screen.getByLabelText("Qadın"));
  fireEvent.change(screen.getByLabelText(/^Doğum tarixi/), { target: { value: "1970-05-05" } });
  fireEvent.change(screen.getByLabelText(/^Qəbul növü/), { target: { value: "ICU" } });
  fireEvent.change(screen.getByLabelText(/^Qəbul diaqnozu/), { target: { value: "Sentetik tanı" } });
  fireEvent.click(screen.getByLabelText("Məlum allergiyası yoxdur"));
  fireEvent.click(screen.getByLabelText("Fərdi məlumatlara razılıq imzalandı"));
  fireEvent.click(screen.getByRole("button", { name: /^Reanimasiya/ }));
  fireEvent.click(screen.getByRole("button", { name: "1" }));
}

describe("AdmitTab", () => {
  it("shows a physician the read-only note and no form", async () => {
    await mountKabul(<AdmitTab />, { perms: DOCTOR });
    expect(screen.getByText(/Baxış səlahiyyəti ilə açmısınız/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Qəbul et" })).toBeNull();
  });

  it("names every missing required field, and holds «Qəbul et» until there is none", async () => {
    const { api } = await mountKabul(<AdmitTab />, { perms: NURSE });
    expect(panel().getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Ad soyad", "Cins", "Doğum tarixi", "Qəbul növü", "Qəbul diaqnozu",
      "Allergiya və ya «məlum allergiyası yoxdur» — ikisindən biri", "Razılıq", "Çarpayı"]);
    expect(admitButton().getAttribute("aria-disabled")).toBe("true");
    await act(async () => { fireEvent.click(admitButton()); });
    expect(api.admit).not.toHaveBeenCalled();
    expect(screen.getAllByText("Ad soyad").length).toBeGreaterThan(1);       // said under the field too

    fillRequired();
    expect(panel().getByText("Bütün məcburi sahələr doludur.")).toBeTruthy();
    expect(admitButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("admits with one request and shows the patient number with what to do with it", async () => {
    const { api } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockResolvedValue({ id: "a-1", patient_number: "H2600042", state: "DRAFT",
        engine: { weight: "failed", profile: "skipped", board: "ok" } }),
    });
    fillRequired();
    await act(async () => { fireEvent.click(admitButton()); });
    await settle();

    expect(api.admit).toHaveBeenCalledTimes(1);
    const body = api.admit.mock.calls[0][0];
    expect(body.note).toMatchObject({ bed_id: BED(1), admitting_unit_id: REA, admission_type: "ICU", no_known_allergy: true });
    expect(body.patient).toMatchObject({ display_name: "Sentetik Hasta", sex: "female", consent: "KVKK_SIGNED" });

    expect(screen.getByText("H2600042")).toBeTruthy();
    expect(screen.getByText("Çarpayı yanındakı cihaza bu nömrəni daxil edin.")).toBeTruthy();
    expect(screen.getByText("Çəki mühərrikə çatmadı — xəstə ekranından daxil edin.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Paneldə bax" }).getAttribute("href")).toBe("#/patients/H2600042");
    expect(toasts().getAllByText("1 · Otaq 1 · Reanimasiya · qəbul edildi, xəstə nömrəsi H2600042").length).toBeGreaterThan(0);
    expect(api.structure.mock.calls.length).toBeGreaterThan(1);               // the picker is read again
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("puts a refusal on the toast named after the bed, by its code, and reads the beds again", async () => {
    const { api } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockRejectedValue(refusal(409, "Bed is not AVAILABLE (current state: OCCUPIED); cannot admit.",
        { apiCode: "bed_not_available" })),
    });
    fillRequired();
    const reads = api.structure.mock.calls.length;
    await act(async () => { fireEvent.click(admitButton()); });
    await settle();
    expect(toasts().getAllByText("1 · Otaq 1 · Reanimasiya: Bu çarpayı artıq boş deyil; başqa çarpayı seçin.").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/current state/);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.queryByText("H2600042")).toBeNull();
  });

  it("says an uncoded 404 by its status in the reader's words, never the server's English (A-9)", async () => {
    const { api } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockRejectedValue(refusal(404, "Bed not found.")),
    });
    fillRequired();
    const reads = api.structure.mock.calls.length;
    await act(async () => { fireEvent.click(admitButton()); });
    await settle();
    expect(toasts().getAllByText("1 · Otaq 1 · Reanimasiya: Sorğu uğursuz oldu (404).").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/not found/i);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
  });

  it("says a timed-out admission may have gone through, to be checked before it is repeated (A-9)", async () => {
    const { api } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockRejectedValue(Object.assign(new Error("…"), { code: "REQUEST_TIMEOUT" })),
    });
    fillRequired();
    const reads = api.structure.mock.calls.length;
    await act(async () => { fireEvent.click(admitButton()); });
    await settle();
    expect(toasts().getAllByText("1 · Otaq 1 · Reanimasiya: Server cavab vermədi. Əməliyyat yerinə yetirilmiş ola bilər; yoxlayın və lazım olsa yenidən cəhd edin.").length).toBeGreaterThan(0);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);           // the bed's state is read again
  });

  it("shows the age beside the date of birth, not as a field", async () => {
    await mountKabul(<AdmitTab />, { perms: NURSE });
    fireEvent.change(screen.getByLabelText(/^Doğum tarixi/), { target: { value: "2000-01-01" } });
    expect(screen.getByText(/^\d+ yaş \d+ ay \d+ gün$/)).toBeTruthy();
  });
});

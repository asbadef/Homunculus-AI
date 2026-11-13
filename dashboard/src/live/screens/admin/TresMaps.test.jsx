// src/live/screens/admin/TresMaps.test.jsx — Yönetim › TRƏS › «Bölüm eşleme» and «Hekim kimlikleri» (TRƏS-01 · F1, spec
// §6, D16, D17): the department map saved whole, a half-filled row held on the screen; a practitioner's FİN write-only —
// never shown, left out unless typed, cleared only when asked — and a malformed one held. Synthetic ward only.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { settle, toasts } from "../kabul/kabul.testutil.js";
import { TresDepartments, half, mapOf } from "./TresDepartments.jsx";
import { TresPractitioners, identityBody, wrong } from "./TresPractitioners.jsx";

const PERMS = ["tres.manage"];
const REA = "33333333-3333-4333-8333-333333333301";
const NEO = "33333333-3333-4333-8333-333333333302";
const DOCTOR = "88888888-8888-4888-8888-888888888801";
const NEW_DOCTOR = "88888888-8888-4888-8888-888888888802";
const UNITS = [{ unit_id: NEO, unit_name: "Neonatal", unit_active: false, code: null, display: null, updated_at: null },
  { unit_id: REA, unit_name: "Reanimasiya", unit_active: true, code: "RE-01", display: "Reanimasiya", updated_at: null }];
const DOCTORS = [{ user_id: DOCTOR, full_name: "Sentetik Hekim", fin_set: true, family_name: "Sentetikov",
  given_name: "Elçin", updated_at: "2026-11-11T08:00:00Z" }];

async function mounted(node, setup) {
  const m = await mount(node, { access: token({ perms: PERMS }), me: profile({ perms: PERMS }), setup });
  await settle();
  return m;
}
const click = async (el) => {
  await act(async () => { fireEvent.click(el); });
  await settle();
};
const shown = (text) => toasts().getAllByText(text).filter((el) => el.closest("[data-toast]"));
const deferred = () => {
  let resolve;
  const promise = new Promise((ok) => { resolve = ok; });
  return { promise, resolve };
};
const SECOND_DOCTOR = "88888888-8888-4888-8888-888888888803";
const TWO_DOCTORS = [...DOCTORS, { user_id: SECOND_DOCTOR, full_name: "Sentetik Üçüncü", fin_set: false, family_name: "Üçünçüyev",
  given_name: "Rəşad", updated_at: null }];

describe("TresDepartments", () => {
  it("lists every unit, closed ones said so, and saves the whole map trimmed", async () => {
    const { api } = await mounted(<TresDepartments />, (a) => {
      a.tresDepartments.mockResolvedValue(UNITS);
      a.saveTresDepartments.mockResolvedValue(UNITS.map((u) => ({ ...u, code: "X", display: "Y" })));
    });
    expect(screen.getByText("Neonatal (bağlı)")).toBeInTheDocument();
    expect(screen.getByLabelText("Şöbə kodu · Reanimasiya").value).toBe("RE-01");
    fireEvent.change(screen.getByLabelText("Şöbə kodu · Neonatal"), { target: { value: " NEO-01 " } });
    fireEvent.change(screen.getByLabelText("Şöbənin adı · Neonatal"), { target: { value: "Neonatal " } });
    await click(screen.getByRole("button", { name: "Uyğunlaşdırmanı yadda saxla" }));
    expect(api.saveTresDepartments).toHaveBeenCalledWith([
      { unit_id: NEO, code: "NEO-01", display: "Neonatal" }, { unit_id: REA, code: "RE-01", display: "Reanimasiya" }]);
    expect(shown("Şöbə uyğunlaşdırması yadda saxlanıldı.")).toHaveLength(1);
  });

  it("holds a row with a code and no name, and says a refusal by its code", async () => {
    const { api } = await mounted(<TresDepartments />, (a) => {
      a.tresDepartments.mockResolvedValue(UNITS);
      a.saveTresDepartments.mockRejectedValue(refusal(422, "x", { apiCode: "tres_unit_unknown" }));
    });
    fireEvent.change(screen.getByLabelText("Şöbə kodu · Neonatal"), { target: { value: "NEO-01" } });
    await click(screen.getByRole("button", { name: "Uyğunlaşdırmanı yadda saxla" }));
    expect(api.saveTresDepartments).not.toHaveBeenCalled();
    expect(screen.getByText("Kod və ad birlikdə yazılır və ya birlikdə boş saxlanılır.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Şöbə kodu · Neonatal"), { target: { value: "" } });
    await click(screen.getByRole("button", { name: "Uyğunlaşdırmanı yadda saxla" }));
    expect(api.saveTresDepartments).toHaveBeenCalledWith([{ unit_id: REA, code: "RE-01", display: "Reanimasiya" }]);
    expect(toasts().getAllByText(/Uyğunlaşdırmadakı bölmələrdən biri bu xəstəxanaya aid deyil/).length).toBeGreaterThan(0);
  });

  it("tells a half row and builds the map from the whole ones", () => {
    expect(half({ code: "A", display: " " })).toBe(true);
    expect(half({ code: " ", display: "" })).toBe(false);
    expect(mapOf([{ unit_id: "u", code: " A ", display: " B " }, { unit_id: "v", code: "", display: "" }]))
      .toEqual([{ unit_id: "u", code: "A", display: "B" }]);
  });

  it("shows an unmapped unit's fields (code, name and time all null) as empty inputs", async () => {
    await mounted(<TresDepartments />, (a) => a.tresDepartments.mockResolvedValue([UNITS[0]]));
    expect(screen.getByLabelText("Şöbə kodu · Neonatal").value).toBe("");
    expect(screen.getByLabelText("Şöbənin adı · Neonatal").value).toBe("");
  });

  it("says when the read failed and reads again on «Yenidən cəhd et» — no table on nothing it read", async () => {
    const { api } = await mounted(<TresDepartments />, (a) => {
      a.tresDepartments.mockRejectedValueOnce(refusal(503, "down")).mockResolvedValue(UNITS);
    });
    expect(screen.getByText(/^Şöbə uyğunlaşdırması oxunmadı: /).closest("[role='alert']")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Uyğunlaşdırmanı yadda saxla" })).toBeNull();
    await click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    expect(api.tresDepartments).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Şöbə kodu · Reanimasiya").value).toBe("RE-01");
    expect(screen.queryByText(/^Şöbə uyğunlaşdırması oxunmadı: /)).toBeNull();
  });

  it("says when the hospital has no unit, and offers no save", async () => {
    await mounted(<TresDepartments />, (a) => a.tresDepartments.mockResolvedValue([]));
    expect(screen.getByText("Bu xəstəxanada bölmə yoxdur.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Uyğunlaşdırmanı yadda saxla" })).toBeNull();
  });

  it("ties a held half row's inputs to the sentence that says what is wrong", async () => {
    await mounted(<TresDepartments />, (a) => a.tresDepartments.mockResolvedValue(UNITS));
    fireEvent.change(screen.getByLabelText("Şöbə kodu · Neonatal"), { target: { value: "NEO-01" } });
    expect(screen.getByLabelText("Şöbə kodu · Neonatal")).not.toHaveAttribute("aria-invalid");   // not before it was tried
    await click(screen.getByRole("button", { name: "Uyğunlaşdırmanı yadda saxla" }));
    const said = "Kod və ad birlikdə yazılır və ya birlikdə boş saxlanılır.";
    for (const label of ["Şöbə kodu · Neonatal", "Şöbənin adı · Neonatal"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(said);
    }
    for (const label of ["Şöbə kodu · Reanimasiya", "Şöbənin adı · Reanimasiya"]) {       // a whole row is not named in it
      expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-invalid");
      expect(screen.getByLabelText(label)).not.toHaveAccessibleDescription(said);
    }
  });

  it("shows the save busy and ignores a second press while the map is on its way", async () => {
    const pending = deferred();
    const { api } = await mounted(<TresDepartments />, (a) => {
      a.tresDepartments.mockResolvedValue(UNITS);
      a.saveTresDepartments.mockImplementation(() => pending.promise);
    });
    const save = screen.getByRole("button", { name: "Uyğunlaşdırmanı yadda saxla" });
    await click(save);
    expect(save).toHaveAttribute("aria-busy", "true");
    await click(save);
    expect(api.saveTresDepartments).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(UNITS); });
    await settle();
    expect(save).not.toHaveAttribute("aria-busy", "true");
  });
});

describe("TresPractitioners", () => {
  it("never shows a stored FİN, leaves it out untouched, and clears it only when asked", async () => {
    const { api } = await mounted(<TresPractitioners />, (a) => {
      a.tresPractitioners.mockResolvedValue(DOCTORS);
      a.saveTresPractitioner.mockResolvedValue(DOCTORS[0]);
    });
    const fin = screen.getByLabelText("FİN · Sentetik Hekim");
    expect(fin.value).toBe("");
    expect(fin.placeholder).toBe("qeyd olunub");
    expect(fin).toHaveAttribute("spellcheck", "false");                          // an identity number is no word to correct
    expect(fin).toHaveAttribute("autocomplete", "off");
    fireEvent.change(screen.getByLabelText("Ad · Sentetik Hekim"), { target: { value: "Elçin Rəşad" } });
    await click(screen.getByRole("button", { name: "Yadda saxla · Sentetik Hekim" }));
    expect(api.saveTresPractitioner).toHaveBeenLastCalledWith(DOCTOR, { family_name: "Sentetikov", given_name: "Elçin Rəşad" });
    expect(shown("Sentetik Hekim: şəxsiyyət məlumatları yadda saxlanıldı.")).toHaveLength(1);
    await click(screen.getByRole("checkbox", { name: "Qeyd olunmuş FİN-i sil · Sentetik Hekim" }));
    await click(screen.getByRole("button", { name: "Yadda saxla · Sentetik Hekim" }));
    expect(api.saveTresPractitioner).toHaveBeenLastCalledWith(DOCTOR, { family_name: "Sentetikov", given_name: "Elçin", fin: "" });
  });

  it("holds a FİN of another shape before anything is sent", async () => {
    const { api } = await mounted(<TresPractitioners />, (a) => a.tresPractitioners.mockResolvedValue(DOCTORS));
    fireEvent.change(screen.getByLabelText("FİN · Sentetik Hekim"), { target: { value: "ZZ99" } });
    await click(screen.getByRole("button", { name: "Yadda saxla · Sentetik Hekim" }));
    expect(api.saveTresPractitioner).not.toHaveBeenCalled();
    expect(screen.getByText(/^FİN 7 latın böyük hərfi və ya rəqəmdir/)).toBeInTheDocument();
  });

  it("says when the hospital has no physician", async () => {
    await mounted(<TresPractitioners />, (a) => a.tresPractitioners.mockResolvedValue([]));
    expect(screen.getByText("Bu xəstəxanada həkim yoxdur.")).toBeInTheDocument();
  });

  it("builds the body: the FİN only when typed, an empty one to clear", () => {
    const row = { fin: " zz99yy8 ", clearFin: false, family: " S ", given: "E" };
    expect(identityBody(row)).toEqual({ family_name: "S", given_name: "E", fin: "zz99yy8" });
    expect(identityBody({ ...row, fin: "" })).toEqual({ family_name: "S", given_name: "E" });
    expect(identityBody({ ...row, clearFin: true })).toEqual({ family_name: "S", given_name: "E", fin: "" });
    expect(wrong({ ...row, fin: "ZZ9" })).toBe(true);
    expect(wrong({ ...row, given: " " })).toBe(true);
    expect(wrong(row)).toBe(false);
  });

  it("shows a physician with no identity yet (no names, no time, no FİN) as empty fields, and holds the save until names are typed", async () => {
    const { api } = await mounted(<TresPractitioners />, (a) => {
      a.tresPractitioners.mockResolvedValue([{ user_id: NEW_DOCTOR, full_name: "Sentetik Yeni", fin_set: false,
        family_name: null, given_name: null, updated_at: null }]);
      a.saveTresPractitioner.mockResolvedValue({ user_id: NEW_DOCTOR, full_name: "Sentetik Yeni", fin_set: true,
        family_name: "Sentetikov", given_name: "Leyla", updated_at: "2026-11-11T08:00:00Z" });
    });
    const fin = screen.getByLabelText("FİN · Sentetik Yeni");
    expect(fin.value).toBe("");
    expect(fin.placeholder).toBe("");                                           // nothing stored: no «qeyd olunub»
    expect(screen.queryByRole("checkbox", { name: /^Qeyd olunmuş FİN-i sil/ })).toBeNull();
    expect(screen.getByLabelText("Soyad · Sentetik Yeni").value).toBe("");
    await click(screen.getByRole("button", { name: "Yadda saxla · Sentetik Yeni" }));
    expect(api.saveTresPractitioner).not.toHaveBeenCalled();
    expect(screen.getByText(/soyad və ad tələb olunur/)).toBeInTheDocument();
    // the sentence is tied to the inputs it is about: the two names are empty, the (unset) FİN is not wrong
    for (const label of ["Soyad · Sentetik Yeni", "Ad · Sentetik Yeni"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(/soyad və ad tələb olunur/);
    }
    expect(screen.getByLabelText("FİN · Sentetik Yeni")).not.toHaveAttribute("aria-invalid");
    fireEvent.change(screen.getByLabelText("Soyad · Sentetik Yeni"), { target: { value: "Sentetikov" } });
    fireEvent.change(screen.getByLabelText("Ad · Sentetik Yeni"), { target: { value: "Leyla" } });
    fireEvent.change(screen.getByLabelText("FİN · Sentetik Yeni"), { target: { value: "AB12C3D" } });
    await click(screen.getByRole("button", { name: "Yadda saxla · Sentetik Yeni" }));
    expect(api.saveTresPractitioner).toHaveBeenCalledWith(NEW_DOCTOR,
      { family_name: "Sentetikov", given_name: "Leyla", fin: "AB12C3D" });
    expect(screen.getByLabelText("FİN · Sentetik Yeni").value).toBe("");           // the saved FİN is never read back
  });

  it("ties a malformed FİN to the sentence, and no name — which are whole — to it", async () => {
    await mounted(<TresPractitioners />, (a) => a.tresPractitioners.mockResolvedValue(DOCTORS));
    fireEvent.change(screen.getByLabelText("FİN · Sentetik Hekim"), { target: { value: "ZZ99" } });
    await click(screen.getByRole("button", { name: "Yadda saxla · Sentetik Hekim" }));
    expect(screen.getByLabelText("FİN · Sentetik Hekim")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("FİN · Sentetik Hekim")).toHaveAccessibleDescription(/^FİN 7 latın böyük hərfi/);
    expect(screen.getByLabelText("Soyad · Sentetik Hekim")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Ad · Sentetik Hekim")).not.toHaveAttribute("aria-invalid");
  });

  it("names the actions column, which has no visible heading", async () => {
    await mounted(<TresPractitioners />, (a) => a.tresPractitioners.mockResolvedValue(DOCTORS));
    const header = screen.getByRole("columnheader", { name: "Əməliyyat" });
    expect(header).toBeInTheDocument();
    expect(header.textContent).toBe("Əməliyyat");
    expect(header.querySelector(".sr-only")).not.toBeNull();                        // said to a screen reader, not drawn
  });

  it("says when the read failed and reads again on «Yenidən cəhd et»", async () => {
    const { api } = await mounted(<TresPractitioners />, (a) => {
      a.tresPractitioners.mockRejectedValueOnce(refusal(503, "down")).mockResolvedValue(DOCTORS);
    });
    expect(screen.getByText(/^Həkimlərin şəxsiyyət məlumatları oxunmadı: /).closest("[role='alert']")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    await click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    expect(api.tresPractitioners).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Ad · Sentetik Hekim").value).toBe("Elçin");
    expect(screen.queryByText(/oxunmadı: /)).toBeNull();
  });

  it("says the server's refusals of an identity as words, by their codes, and keeps what was typed", async () => {
    const { api } = await mounted(<TresPractitioners />, (a) => {
      a.tresPractitioners.mockResolvedValue(DOCTORS);
      a.saveTresPractitioner
        .mockRejectedValueOnce(refusal(422, "A FİN is seven Latin capital letters or digits.", { apiCode: "tres_fin_format" }))
        .mockRejectedValueOnce(refusal(404, "This hospital has no active member with that id.", { apiCode: "tres_user_unknown" }));
    });
    fireEvent.change(screen.getByLabelText("FİN · Sentetik Hekim"), { target: { value: "AB12C3D" } });   // well-formed here; the server refuses
    await click(screen.getByRole("button", { name: "Yadda saxla · Sentetik Hekim" }));
    expect(shown("Sentetik Hekim: FİN yeddi latın böyük hərfi və ya rəqəmdən ibarətdir.")).toHaveLength(1);
    await click(screen.getByRole("button", { name: "Yadda saxla · Sentetik Hekim" }));
    expect(shown("Sentetik Hekim: Bu identifikatorla xəstəxananın aktiv üzvü yoxdur.")).toHaveLength(1);
    expect(api.saveTresPractitioner).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toMatch(/Latin capital letters|no active member/);
    expect(screen.getByLabelText("FİN · Sentetik Hekim").value).toBe("AB12C3D");
  });

  it("gives each row's save its own busy mark, and holds the other rows' off while one saves", async () => {
    const pending = deferred();
    const { api } = await mounted(<TresPractitioners />, (a) => {
      a.tresPractitioners.mockResolvedValue(TWO_DOCTORS);
      a.saveTresPractitioner.mockImplementation(() => pending.promise);
    });
    const first = screen.getByRole("button", { name: "Yadda saxla · Sentetik Hekim" });
    const second = screen.getByRole("button", { name: "Yadda saxla · Sentetik Üçüncü" });
    await click(first);
    expect(first).toHaveAttribute("aria-busy", "true");
    expect(second).toBeDisabled();                                                  // visibly off, not silently ignored
    expect(second).not.toHaveAttribute("aria-busy", "true");
    await click(second);
    await click(first);                                                             // nor does a second press on the busy one
    expect(api.saveTresPractitioner).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(DOCTORS[0]); });
    await settle();
    expect(first).not.toHaveAttribute("aria-busy", "true");
    expect(second).toBeEnabled();
  });
});

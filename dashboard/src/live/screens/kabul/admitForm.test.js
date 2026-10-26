// The admission form's own rules (Group 2 · B1a, spec §5.2): what is still missing, in the form's
// order; the age beside the date of birth; the body POST /admissions takes.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMORBIDITIES, ageOf, emptyForm, missing, positive, toBody } from "./admitForm.js";

const TODAY = "2026-10-25";
const complete = () => ({
  ...emptyForm(), name: "Sentetik Hasta", sex: "female", dob: "1970-05-05", type: "ICU",
  diagnosis: "Sentetik tanı", noAllergy: true, consent: "KVKK_SIGNED", bedId: "b-1", unitId: "u-1",
});
const fields = (form) => missing(form, TODAY).map((m) => m.field);

describe("what the form still lacks", () => {
  it("names every required field of an empty form, in the form's order", () => {
    expect(fields(emptyForm())).toEqual(["name", "sex", "dob", "type", "diagnosis", "allergy", "consent", "bed"]);
  });

  it("is nothing once every required field is filled", () => {
    expect(fields(complete())).toEqual([]);
  });

  it("wants an allergy OR «none known», never both and never neither", () => {
    expect(fields({ ...complete(), noAllergy: false })).toEqual(["allergy"]);
    expect(fields({ ...complete(), allergy: "Penisilin" })).toEqual(["allergy"]);
    expect(fields({ ...complete(), noAllergy: false, allergy: "Penisilin" })).toEqual([]);
  });

  it("refuses a FİN that is not seven letters or digits, a date of birth after today, a weight that is no number", () => {
    expect(fields({ ...complete(), fin: "5AB12C" })).toEqual(["fin"]);
    expect(fields({ ...complete(), fin: "5ab12cd" })).toEqual([]);
    expect(fields({ ...complete(), dob: "2026-10-26" })).toEqual(["dob"]);
    expect(missing({ ...complete(), dob: "2026-10-26" }, TODAY)[0].key).toBe("kabul.miss.dobWrong");
    expect(fields({ ...complete(), weight: "yetmiş" })).toEqual(["weight"]);
    expect(fields({ ...complete(), weight: "72,5", height: "171" })).toEqual([]);
  });

  it("refuses a date of birth before 1900, as the server does (admission/form.py EARLIEST_BIRTH)", () => {
    expect(missing({ ...complete(), dob: "0050-01-01" }, TODAY)).toEqual([{ field: "dob", key: "kabul.miss.dobWrong" }]);
    expect(fields({ ...complete(), dob: "1899-12-31" })).toEqual(["dob"]);
    expect(fields({ ...complete(), dob: "1900-01-01" })).toEqual([]);
  });
});

describe("the age shown beside the date of birth", () => {
  it("is whole years, months and days", () => {
    expect(ageOf("1970-05-05", TODAY)).toEqual({ years: 56, months: 5, days: 20 });
    expect(ageOf("2026-10-01", TODAY)).toEqual({ years: 0, months: 0, days: 24 });
    expect(ageOf("2025-10-26", TODAY)).toEqual({ years: 0, months: 11, days: 29 });
  });

  it("counts a month from a day the next month does not have to that month's last day", () => {
    expect(ageOf("2026-01-31", "2026-03-01")).toEqual({ years: 0, months: 1, days: 1 });
    expect(ageOf("2026-03-31", "2026-05-01")).toEqual({ years: 0, months: 1, days: 1 });
    expect(ageOf("2024-02-29", "2025-02-28")).toEqual({ years: 1, months: 0, days: 0 });
    expect(ageOf("2024-02-29", "2025-03-01")).toEqual({ years: 1, months: 0, days: 1 });
  });

  it("is never negative, and the birth date plus the age is today, for every birth over two years", () => {
    const DAY = 86_400_000;
    const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
    const plusMonths = (ms, months) => {
      const born = new Date(ms);
      const total = born.getUTCMonth() + months;
      const year = born.getUTCFullYear() + Math.floor(total / 12);
      const month = total % 12;
      const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      return Date.UTC(year, month, Math.min(born.getUTCDate(), last));
    };
    let checked = 0;
    const wrong = [];
    for (let born = Date.UTC(2024, 0, 1); born <= Date.UTC(2025, 11, 31); born += DAY) {
      for (let on = born; on <= born + 400 * DAY; on += DAY) {
        const age = ageOf(iso(born), iso(on));
        checked += 1;
        if (!age || age.years < 0 || age.months < 0 || age.months > 11 || age.days < 0 || age.days > 30
          || plusMonths(born, age.years * 12 + age.months) + age.days * DAY !== on) {
          if (wrong.length < 5) wrong.push(`${iso(born)} → ${iso(on)}: ${JSON.stringify(age)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBe(731 * 401);
  });

  it("is nothing for a date that is not one, is in the future, or is before 1900", () => {
    for (const dob of ["", "2026-02-30", "26-10-2026", "2026-10-26", "0050-01-01", "1899-12-31"]) {
      expect(ageOf(dob, TODAY), dob).toBeNull();
    }
  });
});

describe("the body POST /admissions takes", () => {
  it("carries the form as the API names it, numbers as numbers and the FİN upper-case", () => {
    const body = toBody({ ...complete(), fin: " 5ab12cd ", weight: "72,5", height: "171", phone: " +994 50 123 45 67 ",
      comorbidities: ["copd"], comorbiditiesText: "  ", blood: "A_POS" });
    expect(body.patient).toMatchObject({ display_name: "Sentetik Hasta", date_of_birth: "1970-05-05", sex: "female",
      national_id: "5AB12CD", phone: "+994 50 123 45 67", consent: "KVKK_SIGNED", sms_permitted: false, father_name: null });
    expect(body.note).toEqual({
      admitting_unit_id: "u-1", bed_id: "b-1", admission_type: "ICU", source_of_admission: null,
      admission_diagnosis_free_text: "Sentetik tanı", weight_kg: 72.5, height_cm: 171, blood_group: "A_POS",
      allergies_text: null, no_known_allergy: true, comorbidity_codes: ["copd"], comorbidities_text: null,
    });
  });

  it("sends no nationality until one is chosen", () => {
    expect(emptyForm().nationality).toBe("");
    expect(toBody(complete()).patient.nationality).toBeNull();
    expect(toBody({ ...complete(), nationality: "az" }).patient.nationality).toBe("az");
  });

  it("reads a decimal comma as a point, and nothing else as a number", () => {
    expect(positive("72,5")).toBe(72.5);
    expect(positive("0")).toBeNull();
    expect(positive("1e3")).toBeNull();
    expect(positive("")).toBeNull();
  });

  it("offers only comorbidity codes the server's form takes (admission/form.py)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const form = fs.readFileSync(path.resolve(here, "../../../../../homunculus-engine/src/homunculus/admission/form.py"), "utf8");
    const server = /COMORBIDITY_CODES = \(([^)]*)\)/.exec(form)[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
    for (const { value } of COMORBIDITIES) expect(server, value).toContain(value);
  });
});

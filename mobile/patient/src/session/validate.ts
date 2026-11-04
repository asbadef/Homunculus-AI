// Pure identity validation for first-time registration. No RN imports.
// Phone is NOT entered by the patient — it comes from HBYS by FİN/passport, and the SMS
// code is sent to that registered number. So login only needs identity + birthdate.
export type IdentityInput = {
  country: "az" | "foreign";
  fin?: string;
  passport?: string;
  birthdate?: string;
};
export type ValidationResult = { ok: boolean; field?: "fin" | "passport" | "birthdate"; hint?: string };

export function validateIdentity(i: IdentityInput): ValidationResult {
  if (i.country === "az") {
    if (!i.fin || i.fin.trim().length !== 7) return { ok: false, field: "fin", hint: "FİN 7 simvoldan ibarət olmalıdır" };
  } else {
    if (!i.passport || i.passport.trim().length < 3) return { ok: false, field: "passport", hint: "Pasport nömrəsini daxil et" };
  }
  if (!i.birthdate || i.birthdate.trim().length === 0) return { ok: false, field: "birthdate", hint: "Doğum tarixini seç" };
  return { ok: true };
}

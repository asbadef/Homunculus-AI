// Pure identity validation for first-time registration. No RN imports.
export type IdentityInput = {
  country: "az" | "foreign";
  fin?: string;
  passport?: string;
  birthdate?: string;
  phone?: string;
};
export type ValidationResult = { ok: boolean; field?: "fin" | "passport" | "birthdate" | "phone"; hint?: string };

export function validateIdentity(i: IdentityInput): ValidationResult {
  if (i.country === "az") {
    if (!i.fin || i.fin.trim().length !== 7) return { ok: false, field: "fin", hint: "FİN 7 simvoldan ibarət olmalıdır" };
  } else {
    if (!i.passport || i.passport.trim().length < 3) return { ok: false, field: "passport", hint: "Pasport nömrəsini daxil et" };
  }
  if (!i.birthdate || i.birthdate.trim().length === 0) return { ok: false, field: "birthdate", hint: "Doğum tarixini daxil et" };
  if (!i.phone || i.phone.trim().length < 7) return { ok: false, field: "phone", hint: "Telefon nömrəsini daxil et" };
  return { ok: true };
}

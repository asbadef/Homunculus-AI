import { validateIdentity } from "./validate";

test("empty FİN blocks for az", () => {
  const r = validateIdentity({ country: "az", fin: "", birthdate: "1990-01-01" });
  expect(r.ok).toBe(false);
  expect(r.field).toBe("fin");
});

test("az FİN must be 7 chars", () => {
  expect(validateIdentity({ country: "az", fin: "5AB12", birthdate: "1990" }).ok).toBe(false);
  expect(validateIdentity({ country: "az", fin: "6449004", birthdate: "1990" }).ok).toBe(true);
});

test("foreign requires passport, not FİN", () => {
  expect(validateIdentity({ country: "foreign", passport: "", birthdate: "1990" }).ok).toBe(false);
  expect(validateIdentity({ country: "foreign", passport: "A1234567", birthdate: "1990" }).ok).toBe(true);
});

test("birthdate is required (phone is NOT entered — it comes from HBYS)", () => {
  expect(validateIdentity({ country: "az", fin: "6449004", birthdate: "" }).field).toBe("birthdate");
});

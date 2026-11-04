import { doctors, departments } from "./db";

function inDept(id: string) {
  return doctors.filter((d) => d.departmentIds.includes(id)).map((d) => d.name);
}

test("Daxili (dax) lists Emil + Aynur, not Samir or Günel", () => {
  const dax = inDept("dax");
  expect(dax.some((n) => n.includes("Emil"))).toBe(true);
  expect(dax.some((n) => n.includes("Aynur"))).toBe(true);
  expect(dax.some((n) => n.includes("Samir"))).toBe(false);
  expect(dax.some((n) => n.includes("Günel"))).toBe(false);
});

test("Cərrahiyyə (cer) lists Samir, not pure-internist Aynur", () => {
  const cer = inDept("cer");
  expect(cer.some((n) => n.includes("Samir"))).toBe(true);
  expect(cer.some((n) => n.includes("Aynur"))).toBe(false);
});

test("every bookable department has at least one assigned doctor", () => {
  for (const d of departments) {
    expect(doctors.some((doc) => doc.departmentIds.includes(d.id))).toBe(true);
  }
});

import { doctors, departments, branches } from "./db";

function inDept(id: string) {
  return doctors.filter((d) => d.departmentIds.includes(id)).map((d) => d.name);
}

// Patient booking filters doctors by the chosen branch's specialty (not the HBYS unit).
function inBranch(branchId: string) {
  const b = branches.find((x) => x.id === branchId)!;
  return doctors.filter((d) => d.specialty === b.specialty).map((d) => d.name);
}

test("Kardiologiya branch lists both cardiologists (Elçin + Nigar)", () => {
  const k = inBranch("b-kardioloji");
  expect(k.some((n) => n.includes("Elçin"))).toBe(true);
  expect(k.some((n) => n.includes("Nigar"))).toBe(true);
  expect(k.some((n) => n.includes("Samir"))).toBe(false);
});

test("Uşaq branch lists the paediatrician, not the neonatologist", () => {
  const u = inBranch("b-usaq");
  expect(u.some((n) => n.includes("Günel"))).toBe(true);
  expect(u.some((n) => n.includes("Validə"))).toBe(false);
});

test("every patient branch has at least one doctor", () => {
  for (const b of branches) {
    expect(doctors.some((d) => d.specialty === b.specialty)).toBe(true);
  }
});

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

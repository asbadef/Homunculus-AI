import { canContinue, initialWizard } from "./useWizard";

test("each step's guard blocks until its field is set", () => {
  let s = { ...initialWizard };
  expect(canContinue("tip", s)).toBe(false);
  s = { ...s, type: "inperson" };
  expect(canContinue("tip", s)).toBe(true);
  expect(canContinue("hastane", s)).toBe(false);
  s = { ...s, hospitalId: "skip" }; // "seçmeden devam et" counts as set
  expect(canContinue("hastane", s)).toBe(true);
  s = { ...s, departmentId: "d1", doctorId: "dr1", date: "4 Noyabr", time: null };
  expect(canContinue("tarix", s)).toBe(false);
  s = { ...s, time: "13:10" };
  expect(canContinue("tarix", s)).toBe(true);
  expect(canContinue("ozet", s)).toBe(true);
});

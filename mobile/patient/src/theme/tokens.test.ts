import { tokens } from "./tokens";

test("every token key exists in both light and dark, brand is Homunculus turquoise", () => {
  const keys = Object.keys(tokens.light).sort();
  expect(Object.keys(tokens.dark).sort()).toEqual(keys);
  expect(tokens.light.brand).toBe("#0891b2");
  expect(tokens.dark.brand).toBe("#22d3ee");
});

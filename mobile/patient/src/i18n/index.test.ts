import { translate, DEFAULT_LANG, LANGS } from "./core";

test("default lang is az, known key translates and differs by lang, unknown key echoes", () => {
  expect(DEFAULT_LANG).toBe("az");
  expect(LANGS).toEqual(expect.arrayContaining(["az", "tr", "ru", "en"]));
  const az = translate("az", "tab.home");
  const tr = translate("tr", "tab.home");
  expect(az).not.toBe("tab.home"); // defined for az
  expect(tr).not.toBe(az); // differs across languages
  expect(translate("az", "__missing__")).toBe("__missing__"); // echo unknown
});

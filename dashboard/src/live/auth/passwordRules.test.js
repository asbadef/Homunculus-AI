import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PASSWORD_MIN, fieldOfRefusal, passwordProblem } from "./passwordRules.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = fs.readFileSync(
  path.resolve(HERE, "../../../../homunculus-engine/src/homunculus/auth/service.py"), "utf8");

describe("the new-password rules", () => {
  it("are the server's: the same minimum length", () => {
    const m = /^PASSWORD_MIN_LENGTH = (\d+)$/m.exec(SERVICE);
    expect(m, "PASSWORD_MIN_LENGTH in auth/service.py").not.toBeNull();
    expect(PASSWORD_MIN).toBe(Number(m[1]));
  });

  it.each([
    [{ current: "", next: "Yeni-Sifre-1", repeat: "Yeni-Sifre-1" }, { field: "current", key: "errors.passwordRequired" }],
    [{ current: "Gecici-1", next: "kisa", repeat: "kisa" }, { field: "next", key: "errors.passwordTooShort" }],
    [{ current: "Gecici-123", next: "Gecici-123", repeat: "Gecici-123" }, { field: "next", key: "errors.passwordUnchanged" }],
    [{ current: "Gecici-1", next: "Yeni-Sifre-1", repeat: "Yeni-Sifre-2" }, { field: "repeat", key: "auth.mismatch" }],
    [{ current: "Gecici-1", next: "Yeni-Sifre-1", repeat: "Yeni-Sifre-1" }, null],
  ])("%j -> %j", (form, problem) => {
    expect(passwordProblem(form)).toEqual(problem);
  });

  it("puts a server refusal on the field it is about", () => {
    expect(fieldOfRefusal("errors.wrongCurrentPassword")).toBe("current");
    expect(fieldOfRefusal("errors.passwordUnchanged")).toBe("next");
    expect(fieldOfRefusal("errors.network")).toBeNull();
  });

  it("puts a 422 on the field its detail names, else where the key says", () => {
    const tooLong = (field) => [{ field, type: "string_too_long", message: "…" }];
    expect(fieldOfRefusal("errors.passwordTooLong", tooLong("current_password"))).toBe("current");
    expect(fieldOfRefusal("errors.passwordTooLong", tooLong("new_password"))).toBe("next");
    expect(fieldOfRefusal("errors.passwordRequired", [{ field: "current_password", type: "missing", message: "…" }])).toBe("current");
    expect(fieldOfRefusal("errors.passwordRequired", [{ field: "new_password", type: "string_too_short", message: "…" }])).toBe("next");
    expect(fieldOfRefusal("errors.passwordTooLong")).toBe("next");           // no detail: the new one, as before
    expect(fieldOfRefusal("errors.passwordRequired")).toBeNull();            // no detail: the whole form
    expect(fieldOfRefusal("errors.wrongCurrentPassword", tooLong("new_password"))).toBe("current"); // the key's, not a stray detail's
  });
});

// The limits are only worth having if they are the server's: this reads the backend's own schemas
// and models as text and fails when the two drift, the way `catalogue.test.js` holds the permission
// mirror. (A test may read outside `src/live/` — boundaries.test.js checks the sources, not tests.)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PASSWORD_MIN } from "../../auth/passwordRules.js";
import { FIELD_MAX, FIELD_MIN, lengthOf } from "./limits.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, "../../../../../homunculus-engine/src/homunculus");
const SCHEMAS = fs.readFileSync(path.join(ENGINE, "admin/schemas.py"), "utf8");
const SCOPE_MODELS = fs.readFileSync(path.join(ENGINE, "scope/models.py"), "utf8");

/** `NAME = 123` at module level. */
const constant = (name) => Number(new RegExp(`^${name} = (\\d+)$`, "m").exec(SCHEMAS)?.[1]);
/** `field: str = Field(min_length=…, max_length=…)` inside `class Model(BaseModel):`. */
function fieldOf(model, field) {
  const body = new RegExp(`^class ${model}\\(BaseModel\\):([\\s\\S]*?)(?=^class |(?![\\s\\S]))`, "m").exec(SCHEMAS)?.[1] ?? "";
  const line = new RegExp(`^\\s+${field}: [^\\n]*Field\\(([^\\n]*)\\)`, "m").exec(body)?.[1] ?? "";
  const number = (name) => {
    const raw = new RegExp(`${name}=([\\w]+)`).exec(line)?.[1];
    return raw === undefined ? undefined : /^\d+$/.test(raw) ? Number(raw) : constant(raw);
  };
  return { min: number("min_length"), max: number("max_length") };
}

describe("the administration forms' limits are the server's", () => {
  it("the reader found the schemas it reads", () => {
    expect(constant("_EMAIL_MAX")).toBeGreaterThan(0);
    expect(fieldOf("UserCreate", "username").max).toBeGreaterThan(0);
  });

  it("the account form: username, e-mail, full name, password", () => {
    expect(FIELD_MAX.username).toBe(fieldOf("UserCreate", "username").max);
    expect(FIELD_MIN.username).toBe(fieldOf("UserCreate", "username").min);
    expect(FIELD_MAX.email).toBe(constant("_EMAIL_MAX"));
    expect(FIELD_MAX.email).toBe(fieldOf("UserPatch", "email").max);
    expect(FIELD_MAX.full_name).toBe(fieldOf("UserCreate", "full_name").max);
    expect(FIELD_MAX.full_name).toBe(fieldOf("UserPatch", "full_name").max);
    expect(FIELD_MAX.password).toBe(fieldOf("PasswordResetIn", "password").max);
    expect(FIELD_MAX.password).toBe(fieldOf("UserCreate", "password").max);
    // The minimum is the auth package's PASSWORD_MIN_LENGTH, which passwordRules.test.js holds.
    expect(FIELD_MIN.password).toBe(PASSWORD_MIN);
  });

  it("the unlock's reason and the group form: name, description, slug", () => {
    expect(FIELD_MAX.reason).toBe(fieldOf("SignInUnlockIn", "reason").max);
    expect(FIELD_MAX.group_name).toBe(fieldOf("GroupCreate", "name").max);
    expect(FIELD_MAX.group_name).toBe(fieldOf("GroupPatch", "name").max);
    expect(FIELD_MAX.description).toBe(fieldOf("GroupCreate", "description").max);
    const slug = /^_SLUG = re\.compile\(r"\[a-z0-9_\]\{(\d+),(\d+)\}"\)$/m.exec(SCHEMAS);
    expect(slug, "_SLUG").not.toBeNull();
    expect([FIELD_MIN.slug, FIELD_MAX.slug]).toEqual([Number(slug[1]), Number(slug[2])]);
  });

  it("the mapping's DN, and a scope key — whose only limit is its column", () => {
    expect(FIELD_MAX.ad_group_dn).toBe(fieldOf("LdapMappingIn", "ad_group_dn").max);
    expect(FIELD_MIN.ad_group_dn).toBe(fieldOf("LdapMappingIn", "ad_group_dn").min);
    // `ScopeGrantIn` states no length at all; the column is String(100), so a longer key is a
    // database error rather than a 422. The field holds to the column.
    for (const column of ["unit_id", "bed_id"]) {
      expect(new RegExp(`${column}: Mapped\\[str\\] = mapped_column\\(String\\((\\d+)\\)`).exec(SCOPE_MODELS)?.[1], column)
        .toBe(String(FIELD_MAX.scope_key));
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(FIELD_MAX)).toBe(true);
    expect(Object.isFrozen(FIELD_MIN)).toBe(true);
  });
});

describe("lengthOf counts what the server counts", () => {
  it("code points, as Python's len does — not UTF-16 units, as JavaScript's .length does", () => {
    // Four emoji: eight to `.length`, four to the server. A form that counted `.length` let this
    // through as long enough, and the server refused it as shorter than eight.
    expect("😀😀😀😀".length).toBe(8);
    expect(lengthOf("😀😀😀😀")).toBe(4);
    expect(lengthOf("şəğ")).toBe(3);
    expect(lengthOf("")).toBe(0);
    expect(lengthOf(null)).toBe(0);
  });
});

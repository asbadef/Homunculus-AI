// dashboard/src/i18n.rbac.test.js
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cstrings, LANGS, apiErrorKey, translateApiError, permLabel, cannotGrantReason,
  detectClang, storedClang,
} from "./clinicalI18n.js";
import { PERMISSION_KEYS } from "./permissions.js";
import { NO_PERMISSIONS, NO_BOARD_ACCESS } from "./liveAuth.js";
import { SESSION_UNREACHABLE, LIVE_UNAVAILABLE } from "./liveStore.js";
import { REQUEST_TIMEOUT } from "./backendApi.js";

const langs = LANGS.map((l) => l[0]);          // LANGS entries are [key, label, flag]

describe("rbac strings", () => {
  it("every language has the rbac block with a label for every permission key", () => {
    for (const lang of langs) {
      const R = cstrings(lang).rbac;
      expect(R, lang).toBeDefined();
      for (const key of PERMISSION_KEYS) expect(R.perm[key], `${lang} ${key}`).toBeTruthy();
      for (const k of ["groupsTitle", "usersTitle", "newGroup", "save", "delete", "deleteConfirm",
                       "username", "tempPassword", "editGroups", "resetPassword", "resetMfa",
                       "sourceLdap", "mfaManualKey", "passwordManagedByAd"]) {
        expect(R[k], `${lang} ${k}`).toBeTruthy();
      }
    }
  });

  // Every key Turkish has, every language has — as a non-empty string, with the same
  // placeholders — and no language has a key Turkish lacks.
  const leaves = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) =>
    (v && typeof v === "object" ? leaves(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
  const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it("every rbac key exists in all four languages, non-empty, with the same placeholders", () => {
    const tr = new Map(leaves(cstrings("tr").rbac));
    expect(tr.size).toBeGreaterThan(100);
    for (const lang of langs) {
      const own = new Map(leaves(cstrings(lang).rbac));
      expect([...own.keys()].sort(), lang).toEqual([...tr.keys()].sort());
      for (const [key, value] of own) {
        expect(typeof value === "string" && value.trim() !== "", `${lang} rbac.${key}`).toBe(true);
        expect(placeholders(value), `${lang} rbac.${key} placeholders`)
          .toEqual(placeholders(tr.get(key)));
      }
    }
  });

  it("writes Azerbaijani in Latin script and Russian in Cyrillic", () => {
    const text = (lang) => leaves(cstrings(lang).rbac).map(([, v]) => v).join(" ");
    expect(text("az")).not.toMatch(/[Ѐ-ӿ]/);
    expect(text("az")).toMatch(/ə/);
    // Russian may carry Latin product names and keys (Active Directory, MFA, AD, QR, a-z),
    // never a Latin sentence: every Russian error message contains Cyrillic.
    for (const [key, v] of leaves(cstrings("ru").rbac.err)) {
      expect(v, `ru rbac.err.${key}`).toMatch(/[Ѐ-ӿ]/);
    }
  });
});

// ------------------------------------------------------------------ server and client messages
// The messages are read from the sources as TEXT (never executed), so a message changed or added
// there fails here until clinicalI18n.js maps it.
// (Built with node:path: under jsdom the global URL is jsdom's, which fileURLToPath refuses.)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, "../../homunculus-engine/src/homunculus");
const py = (rel) => fs.readFileSync(path.join(ENGINE, rel), "utf8");
const js = (rel) => fs.readFileSync(path.join(HERE, rel), "utf8");

const STR = String.raw`"((?:[^"\\\n]|\\.)*)"`;
const unquote = (s) => {
  if (s.includes("\\")) throw new Error(`escape sequence in ${JSON.stringify(s)}: extend the reader`);
  return s;
};

/** Module-level string constants: `NAME = "…"` or `NAME = ("…" "…")` (adjacent literals join). */
function pyConstants(src) {
  const out = new Map();
  const re = new RegExp(String.raw`^(_?[A-Z][A-Z0-9_]*) = (?:${STR}|\(((?:\s*${STR})+)\s*\))`, "gm");
  for (const m of src.matchAll(re)) {
    const value = m[2] !== undefined
      ? unquote(m[2])
      : [...m[3].matchAll(new RegExp(STR, "g"))].map((p) => unquote(p[1])).join("");
    out.set(m[1], value);
  }
  return out;
}

/** The first capture group of every match of `pattern` (whose group 1 is a string body). */
function literals(src, pattern) {
  return [...src.matchAll(new RegExp(pattern, "g"))].map((m) => unquote(m[1]));
}

const DEPS = py("auth/dependencies.py");
const ROUTER = py("auth/router.py");
const AUTH_SERVICE = py("auth/service.py");
const ADMIN_SERVICE = py("admin/service.py");
const GROUPS = py("auth/groups.py");
const PERMISSIONS = py("auth/permissions.py");
const ADMIN_SCHEMAS = py("admin/schemas.py");
const AUTH_SCHEMAS = py("auth/schemas.py");
const BACKEND_API = js("backendApi.js");
const LIVE_STORE = js("liveStore.js");

const ADMIN_CONST = pyConstants(ADMIN_SERVICE);

/** Every plain (unparameterised) message, with where it comes from. */
const PLAIN = [
  ...[...pyConstants(DEPS).values()].map((m) => ["auth/dependencies.py constant", m]),
  ...literals(DEPS, String.raw`detail=${STR}`).map((m) => ["auth/dependencies.py detail", m]),
  ...literals(DEPS, String.raw`_unauthorized\(${STR}\)`).map((m) => ["auth/dependencies.py 401", m]),
  ...literals(DEPS, String.raw`def _unauthorized\(detail: str = ${STR}\)`)
    .map((m) => ["auth/dependencies.py 401 default", m]),
  ...[...pyConstants(ROUTER).values()].map((m) => ["auth/router.py constant", m]),
  ...literals(ROUTER, String.raw`detail=${STR}`).map((m) => ["auth/router.py detail", m]),
  ...literals(AUTH_SERVICE, String.raw`PasswordError\(${STR}`).map((m) => ["auth/service.py", m]),
  ...[...ADMIN_CONST.values()].map((m) => ["admin/service.py constant", m]),
  ...literals(ADMIN_SERVICE, String.raw`AdminError\(\d+, ${STR}\)`)
    .map((m) => ["admin/service.py literal", m]),
  ...literals(GROUPS, String.raw`GroupError\(${STR}\)`).map((m) => ["auth/groups.py", m]),
  ...literals(AUTH_SCHEMAS, String.raw`ValueError\(${STR}\)`).map((m) => ["auth/schemas.py", m]),
  ...literals(BACKEND_API, String.raw`failure\(\w+,\s*${STR}\)`).map((m) => ["backendApi.js", m]),
  ...literals(BACKEND_API, String.raw`TIMEOUT_MESSAGE = ${STR}`).map((m) => ["backendApi.js timeout", m]),
  ...literals(BACKEND_API, String.raw`SUPERSEDED_MESSAGE = ${STR}`).map((m) => ["backendApi.js superseded", m]),
  ...literals(LIVE_STORE, String.raw`\[NO_[A-Z_]+, ${STR}\]`).map((m) => ["liveStore.js refusal", m]),
  ...literals(LIVE_STORE, String.raw`REFUSED_GENERIC = ${STR}`).map((m) => ["liveStore.js", m]),
  ...literals(LIVE_STORE, String.raw`LIVE_UNAVAILABLE_MESSAGE = ${STR}`).map((m) => ["liveStore.js live mode", m]),
  ...literals(LIVE_STORE, String.raw`code: SESSION_UNREACHABLE,\s*message: ${STR}`)
    .map((m) => ["liveStore.js sessionError", m]),
  ["browser (Chrome, Edge)", "Failed to fetch"],
  ["browser (Firefox)", "NetworkError when attempting to fetch resource."],
  ["browser (Safari)", "Load failed"],
];

describe("server and client messages are mapped", () => {
  it("the readers found the messages the sources hold", () => {
    const has = (m) => PLAIN.some(([, text]) => text === m);
    // One anchor per source, so a reader that silently stopped matching fails here.
    for (const m of [
      "Hesabınıza kurum tanımlanmamış", "mfa_required", "mfa_reset_required", "token_version", "tenant",
      "Invalid or missing authentication credentials", "Çok fazla hatalı kod. 5 dakika sonra tekrar deneyin.",
      "Dizin sunucusuna ulaşılamıyor", "Invalid credentials", "Invalid or expired refresh token",
      "Mevcut parola yanlış", "Son yönetici yetkisi kaldırılamaz", "Sistem grubu silinemez",
      "unknown group for this tenant", "login is required", "Giriş başarısız.",
      "Panoya erişim yetkiniz yok. Sistem yöneticinizle görüşün.",
      "Sunucuya ulaşılamıyor; oturumunuz korunuyor. Biraz sonra tekrar deneyin.",
      "Sunucuya şu an ulaşılamıyor; oturumunuz açık, biraz sonra tekrar deneyin.",
    ]) expect(has(m), m).toBe(true);
    expect(PLAIN.some(([where]) => where === "backendApi.js timeout"), "the timeout message").toBe(true);
    expect(PLAIN.some(([where]) => where === "liveStore.js live mode"), "the live-mode refusal").toBe(true);
    expect(PLAIN.some(([where]) => where === "backendApi.js superseded"), "the superseded request").toBe(true);
    expect(ADMIN_CONST.get("SHARED_ACCOUNT")).toMatch(/^Bu hesap başka bir kurumda da etkin; .+ayarlanabilir$/);
    expect(ADMIN_CONST.get("SELF_CREDENTIALS")).toContain("MFA'nızı");
    expect(PLAIN.length).toBeGreaterThan(45);
  });

  it.each(PLAIN)("%s: %s", (_where, message) => {
    expect(apiErrorKey(message), message).not.toBeNull();
    expect(apiErrorKey(new Error(message)), message).not.toBeNull();
    for (const lang of langs) {
      const text = translateApiError(new Error(message), lang);
      expect(text, `${lang}: ${message}`).toBe(cstrings(lang).rbac.err[apiErrorKey(message).key]);
    }
  });

  it("maps a message whatever surrounds it: whitespace is ignored", () => {
    expect(apiErrorKey("  Son yönetici pasifleştirilemez \n")?.key).toBe("lastAdminDeactivate");
  });

  it("names the right entry for the admin guards", () => {
    expect(apiErrorKey(ADMIN_CONST.get("LAST_ADMIN")).key).toBe("lastAdmin");
    expect(apiErrorKey(ADMIN_CONST.get("LAST_ADMIN_DEACTIVATE")).key).toBe("lastAdminDeactivate");
    expect(apiErrorKey(ADMIN_CONST.get("SLUG_TAKEN")).key).toBe("slugTaken");
    expect(apiErrorKey(ADMIN_CONST.get("LOGIN_TAKEN")).key).toBe("loginTaken");
    expect(apiErrorKey(ADMIN_CONST.get("CONCURRENT_CHANGE")).key).toBe("concurrentChange");
    expect(apiErrorKey(ADMIN_CONST.get("DIRECTORY_PASSWORD")).key).toBe("directoryPassword");
    expect(apiErrorKey(ADMIN_CONST.get("SELF_DEACTIVATE")).key).toBe("selfDeactivate");
    expect(apiErrorKey(ADMIN_CONST.get("SELF_CREDENTIALS")).key).toBe("selfCredentials");
    expect(apiErrorKey(ADMIN_CONST.get("SHARED_ACCOUNT")).key).toBe("sharedAccount");
    expect(apiErrorKey(ADMIN_CONST.get("PLATFORM_ACCOUNT")).key).toBe("platformAccount");
  });
});

describe("parameterised messages keep their parameters", () => {
  it("the sources still build them this way", () => {
    expect(DEPS).toContain(`detail=f"permission required: {' or '.join(sorted(wanted))}"`);
    expect(ADMIN_SERVICE).toContain(`f"{BEYOND_OWN_RIGHTS}: {', '.join(sorted(beyond))}"`);
    expect(PERMISSIONS).toContain(`f"unknown permission(s): {', '.join(unknown)}"`);
    expect(BACKEND_API).toContain("`İstek başarısız (${res.status})`");
  });

  it("permission required: the keys, by their names, joined by the language's 'or'", () => {
    const msg = "permission required: alerts.ack or board.view";
    expect(apiErrorKey(msg)).toMatchObject({ key: "permissionRequired",
                                            params: { perms: ["alerts.ack", "board.view"] } });
    const en = translateApiError(new Error(msg), "en");
    expect(en).toContain("Acknowledge alerts or View the board");
    expect(translateApiError(msg, "ru")).toContain(
      `${permLabel("alerts.ack", "ru")} или ${permLabel("board.view", "ru")}`);
    expect(translateApiError(msg, "az")).toContain(" və ya ");
    expect(translateApiError(msg, "tr")).toContain(" veya ");
    // A single key, as `require_permission("groups.manage")` sends it.
    expect(translateApiError("permission required: groups.manage", "en"))
      .toContain("Manage groups and permissions");
  });

  it("beyond your own rights: the keys the caller lacks, by their names", () => {
    const msg = `${ADMIN_CONST.get("BEYOND_OWN_RIGHTS")}: groups.manage, users.manage`;
    expect(apiErrorKey(msg)).toMatchObject({ key: "beyondOwnRightsList",
                                            params: { perms: ["groups.manage", "users.manage"] } });
    for (const lang of langs) {
      const text = translateApiError({ message: msg, status: 403 }, lang);
      expect(text, lang).toContain(permLabel("groups.manage", lang));
      expect(text, lang).toContain(permLabel("users.manage", lang));
      expect(text, lang).not.toContain("{perms}");
    }
    expect(translateApiError(msg, "en")).toContain("Manage groups and permissions, Manage users");
    // Without a list it is the plain sentence.
    expect(apiErrorKey(ADMIN_CONST.get("BEYOND_OWN_RIGHTS")).key).toBe("beyondOwnRights");
  });

  it("a key the catalogue does not know is shown as it came", () => {
    expect(translateApiError("permission required: devices.calibrate", "en"))
      .toContain("devices.calibrate");
    const unknown = translateApiError("unknown permission(s): a.b, c.d", "ru");
    expect(unknown).toContain("a.b, c.d");
    expect(unknown).toMatch(/[Ѐ-ӿ]/);
    expect(permLabel("constructor", "en")).toBe("constructor");     // no prototype keys
  });

  it("a failed request keeps its status", () => {
    expect(apiErrorKey("İstek başarısız (502)")).toMatchObject({ key: "requestFailed",
                                                                params: { status: "502" } });
    for (const lang of langs) {
      expect(translateApiError(new Error("İstek başarısız (502)"), lang), lang).toContain("502");
    }
  });
});

describe("codes", () => {
  it("uses the codes liveAuth.js and liveStore.js export", () => {
    expect([NO_PERMISSIONS, NO_BOARD_ACCESS, SESSION_UNREACHABLE])
      .toEqual(["NO_PERMISSIONS", "NO_BOARD_ACCESS", "SESSION_UNREACHABLE"]);
  });

  it("translates a refused session by its code, before its message", () => {
    const err = Object.assign(new Error("whatever the store wrote"), { code: NO_BOARD_ACCESS });
    expect(apiErrorKey(err).key).toBe("noBoardAccess");
    expect(translateApiError(err, "en")).toBe(cstrings("en").rbac.err.noBoardAccess);
    expect(apiErrorKey({ code: NO_PERMISSIONS }).key).toBe("noPermissions");
  });

  it("translates the store's sessionError object", () => {
    const sessionError = { code: SESSION_UNREACHABLE, message: "x", detail: "Failed to fetch" };
    for (const lang of langs) {
      expect(translateApiError(sessionError, lang)).toBe(cstrings(lang).rbac.err.sessionUnreachable);
    }
  });

  it("an unknown code falls back to the message", () => {
    const err = Object.assign(new Error("Mevcut parola yanlış"), { code: "SOMETHING_NEW" });
    expect(apiErrorKey(err).key).toBe("wrongCurrentPassword");
  });

  it("translates a simulation action refused in live mode, by its code", () => {
    for (const lang of langs) {
      const err = Object.assign(new Error("whatever"), { code: LIVE_UNAVAILABLE });
      expect(translateApiError(err, lang), lang).toBe(cstrings(lang).rbac.err.liveUnavailable);
    }
  });

  it("translates a request the server did not answer in time, by its code", () => {
    for (const lang of langs) {
      const err = Object.assign(new Error("whatever"), { code: REQUEST_TIMEOUT });
      expect(translateApiError(err, lang), lang).toBe(cstrings(lang).rbac.err.requestTimeout);
    }
    expect(REQUEST_TIMEOUT).toBe("REQUEST_TIMEOUT");
  });

  it("translates the network failure", () => {
    expect(translateApiError(new TypeError("Failed to fetch"), "az"))
      .toBe(cstrings("az").rbac.err.network);
  });
});

describe("field errors (422)", () => {
  const USERNAME_RULE = pyConstants(ADMIN_SCHEMAS).get("USERNAME_RULE");
  // admin/schemas.py's validator messages -> the fields they are raised for and the entry.
  const FIELDS = [
    [/^Kullanıcı adı 2-128 karakter/, ["username"], "usernameRule"],
    [/^e-mail: /, ["email"], "emailInvalid"],
    [/^slug: /, ["slug"], "slugInvalid"],
    [/^must not be blank$/, ["name", "full_name"], null],
  ];
  const EXPECTED_FOR = { name: "groupNameRequired", full_name: "fullNameRequired" };
  const messages = [USERNAME_RULE,
    ...literals(ADMIN_SCHEMAS, String.raw`raise ValueError\(${STR}\)`)];
  const err = (field, type, message) => {
    const e = new Error(`${field}: ${message}`);
    e.status = 422;
    e.fieldErrors = [{ field, type, message }];
    return e;
  };

  it("the username rule is Turkish, with the transliteration hint", () => {
    expect(USERNAME_RULE).toMatch(/^Kullanıcı adı 2-128 karakter olmalı; .* ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e\.$/);
  });

  it.each(messages)("recognises the validator message: %s", (message) => {
    const row = FIELDS.find(([re]) => re.test(message));
    expect(row, `admin/schemas.py has a validator message nobody maps: ${message}`).toBeDefined();
    const [, fields, entry] = row;
    for (const field of fields) {
      for (const lang of langs) {
        expect(translateApiError(err(field, "value_error", message), lang), `${lang} ${field}`)
          .toBe(cstrings(lang).rbac.err[entry ?? EXPECTED_FOR[field]]);
      }
    }
  });

  it("translates the username error by field and type, the length refusals included", () => {
    for (const type of ["value_error", "string_too_short", "string_too_long"]) {
      expect(translateApiError(err("username", type, "String should have at least 2 characters"), "en"))
        .toBe(cstrings("en").rbac.err.usernameRule);
    }
    expect(translateApiError(err("password", "string_too_short", "String should have at least 8 characters"), "ru"))
      .toBe(cstrings("ru").rbac.err.passwordTooShort);
  });

  it("translates a password over the length limit, the user's own change included", () => {
    // auth/schemas.py PasswordChangeRequest and admin/schemas.py cap passwords at 1024.
    expect(AUTH_SCHEMAS).toContain("current_password: str = Field(max_length=_PASSWORD_MAX)");
    expect(AUTH_SCHEMAS).toContain("new_password: str = Field(max_length=_PASSWORD_MAX)");
    for (const field of ["current_password", "new_password", "password"]) {
      for (const lang of langs) {
        expect(translateApiError(err(field, "string_too_long", "String should have at most 1024 characters"), lang),
          `${lang} ${field}`).toBe(cstrings(lang).rbac.err.passwordTooLong);
      }
    }
  });

  it("a model-level error with no field is read by its message", () => {
    expect(translateApiError(err(null, "value_error", "login is required"), "en"))
      .toBe(cstrings("en").rbac.err.loginRequired);
  });

  it("several field errors are each translated; an unknown one stays as the server wrote it", () => {
    const e = new Error("…");
    e.fieldErrors = [
      { field: "username", type: "value_error", message: USERNAME_RULE },
      { field: "group_ids.0", type: "uuid_parsing", message: "Input should be a valid UUID" },
    ];
    expect(translateApiError(e, "en")).toBe(
      `${cstrings("en").rbac.err.usernameRule}; group_ids.0: Input should be a valid UUID`);
  });
});

describe("unknown messages fall back to the raw text", () => {
  it("keeps what the server wrote", () => {
    expect(apiErrorKey("Bambaşka bir hata")).toBeNull();
    expect(translateApiError(new Error("Bambaşka bir hata"), "en")).toBe("Bambaşka bir hata");
    expect(translateApiError("An alert requires a patient_id or admission_id.", "az"))
      .toBe("An alert requires a patient_id or admission_id.");
    // A prefix with nothing after it is not a parameterised message.
    expect(translateApiError("permission required: ", "en")).toBe("permission required:");
  });

  it("never returns an empty string", () => {
    for (const lang of langs) {
      for (const e of [null, undefined, "", "   ", new Error(""), {}, { fieldErrors: [] },
                       { fieldErrors: [{ field: "x", type: "y", message: "" }] }]) {
        const text = translateApiError(e, lang);
        expect(typeof text === "string" && text.trim() !== "", `${lang} ${JSON.stringify(e)}`).toBe(true);
      }
      expect(translateApiError(null, lang)).toBe(cstrings(lang).rbac.err.unknown);
    }
  });

  it("an unknown language falls back to Turkish", () => {
    expect(translateApiError("Invalid credentials", "xx")).toBe(cstrings("tr").rbac.err.invalidCredentials);
  });
});

describe("the greyed-out group", () => {
  it("says why, with the rights the session lacks by their names", () => {
    for (const lang of langs) {
      const text = cannotGrantReason(["users.manage", "audit.view"], lang);
      expect(text, lang).toContain(permLabel("users.manage", lang));
      expect(text, lang).toContain(permLabel("audit.view", lang));
      expect(text, lang).not.toContain("{perms}");
      expect(cannotGrantReason([], lang), lang).toBe(cstrings(lang).rbac.cannotGrant);
      expect(cannotGrantReason(null, lang), lang).toBe(cstrings(lang).rbac.cannotGrant);
    }
    expect(cannotGrantReason(["users.manage"], "tr").toLowerCase())
      .toContain("yetkileriniz bu grubu vermeye yetmiyor");
  });
});

describe("the UI language a ward opens in (from main's simulationGating)", () => {
  // Current behaviour, pinned as shipped: auto-detection knows only TR and AZ and falls back to
  // TR. The pilot's ward PCs run an English-locale Chrome over Turkish patient data, and detecting
  // EN landed every clinician on an English UI. This is the OLD workspace (ClinicalDemo, removed in
  // G1-16). The new shell follows roadmap D2 — Azerbaijani by default, no locale detection, the
  // stored choice wins — pinned in src/live/i18n/I18nProvider.test.jsx.
  const locale = (languages) => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
    vi.spyOn(navigator, "language", "get").mockReturnValue(languages[0]);
  };
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("an English-locale browser still opens in Turkish", () => {
    locale(["en-US", "en"]);
    expect(detectClang()).toBe("tr");
    localStorage.clear();
    expect(storedClang()).toBe("tr");
  });

  it("an Azerbaijani device is greeted in Azerbaijani", () => {
    locale(["az-AZ", "az"]);
    expect(detectClang()).toBe("az");
    localStorage.clear();
    expect(storedClang()).toBe("az");
  });

  it("a language the user chose wins over the device's", () => {
    locale(["az-AZ", "az"]);
    localStorage.setItem("homunculus-clang", "en");
    expect(storedClang()).toBe("en");
  });
});

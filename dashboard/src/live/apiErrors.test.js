// Every refusal the sign-in, MFA, password, lock-screen and session surface can show is mapped
// to a translated text. The messages are read from their sources as TEXT (never executed), so a
// message added or changed on the server fails here until apiErrors.js maps it — the same
// guarantee i18n.rbac.test.js gives the old workspace.
// (Paths built with node:path: under jsdom the global URL is jsdom's, which fileURLToPath refuses.)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_MESSAGE_KEYS, apiErrorKey, apiErrorText } from "./apiErrors.js";
import { DICTIONARIES } from "./i18n/catalog.js";
import { LANG_CODES } from "./i18n/langs.js";
import { createTranslator } from "./i18n/translate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, "../../../homunculus-engine/src/homunculus");
const py = (rel) => fs.readFileSync(path.join(ENGINE, rel), "utf8");
const js = (rel) => fs.readFileSync(path.resolve(HERE, "..", rel), "utf8");

const STR = String.raw`"((?:[^"\\\n]|\\.)*)"`;
const unquote = (s) => {
  if (s.includes("\\")) throw new Error(`escape sequence in ${JSON.stringify(s)}: extend the reader`);
  return s;
};
/** Module-level string constants: `NAME = "…"` or `NAME = ("…" "…")`. */
function pyConstants(src) {
  const out = new Map();
  const re = new RegExp(String.raw`^(_?[A-Z][A-Z0-9_]*) = (?:${STR}|\(((?:\s*${STR})+)\s*\))`, "gm");
  for (const m of src.matchAll(re)) {
    out.set(m[1], m[2] !== undefined ? unquote(m[2])
      : [...m[3].matchAll(new RegExp(STR, "g"))].map((p) => unquote(p[1])).join(""));
  }
  return out;
}
const literals = (src, pattern) => [...src.matchAll(new RegExp(pattern, "g"))].map((m) => unquote(m[1]));

const DEPS = py("auth/dependencies.py");
const ROUTER = py("auth/router.py");
const LDAP = pyConstants(py("auth/ldap.py"));
const BACKEND_API = js("backendApi.js");
const NGINX = fs.readFileSync(path.resolve(HERE, "../../../deploy/local/web/nginx.conf"), "utf8");
const nginxLimit = (name) => new RegExp(String.raw`^\s*location @${name} \{[^]*?^\s*return 429 '([^']*)';`, "m").exec(NGINX);
const nginxLimited = nginxLimit("login_limited");
const nginxReauthLimited = nginxLimit("reauth_limited");

/** Every message the auth surface can answer with, and where it comes from. */
const SOURCES = [
  ...[...pyConstants(DEPS).values()].map((m) => ["auth/dependencies.py constant", m]),
  ...literals(DEPS, String.raw`detail=${STR}`).map((m) => ["auth/dependencies.py detail", m]),
  ...literals(DEPS, String.raw`_unauthorized\(${STR}\)`).map((m) => ["auth/dependencies.py 401", m]),
  ...literals(DEPS, String.raw`def _unauthorized\(detail: str = ${STR}\)`).map((m) => ["auth/dependencies.py 401", m]),
  ...[...pyConstants(ROUTER).values()].map((m) => ["auth/router.py constant", m]),
  ...literals(ROUTER, String.raw`detail=${STR}`).map((m) => ["auth/router.py detail", m]),
  ...literals(py("auth/service.py"), String.raw`PasswordError\(${STR}`).map((m) => ["auth/service.py", m]),
  ...literals(py("auth/schemas.py"), String.raw`ValueError\(${STR}\)`).map((m) => ["auth/schemas.py", m]),
  ["auth/ldap.py DIRECTORY_DOWN", LDAP.get("DIRECTORY_DOWN")],
  ["auth/ldap.py NOT_CONFIGURED", LDAP.get("NOT_CONFIGURED")],
  ["nginx.conf 429", nginxLimited ? JSON.parse(nginxLimited[1]).detail : undefined],
  ["nginx.conf reauth 429", nginxReauthLimited ? JSON.parse(nginxReauthLimited[1]).detail : undefined],
  ...literals(BACKEND_API, String.raw`failure\(\w+,\s*${STR}\)`).map((m) => ["backendApi.js", m]),
  ...literals(BACKEND_API, String.raw`TIMEOUT_MESSAGE = ${STR}`).map((m) => ["backendApi.js timeout", m]),
  ...literals(BACKEND_API, String.raw`SUPERSEDED_MESSAGE = ${STR}`).map((m) => ["backendApi.js superseded", m]),
];

describe("the auth surface's messages are translated", () => {
  it("the readers found the messages the sources hold", () => {
    const texts = SOURCES.map(([, text]) => text);
    for (const anchor of ["password_change_required", "mfa_required", "Parola hatalı", "Invalid credentials",
      "Yeni parola mevcut paroladan farklı olmalı", "Dizin sunucusuna ulaşılamıyor", "login is required",
      "Çok fazla giriş denemesi; bir dakika sonra tekrar deneyin", "Giriş başarısız.",
      "Çok fazla deneme. Bir dakika sonra yeniden deneyin."]) {
      expect(texts, anchor).toContain(anchor);
    }
    expect(SOURCES.length).toBeGreaterThan(25);
  });

  it.each(SOURCES)("%s: %s", (_where, message) => {
    const hit = apiErrorKey(new Error(message));
    expect(hit, message).not.toBeNull();
    for (const lang of LANG_CODES) expect(DICTIONARIES[lang][hit.key], `${lang} ${hit.key}`).toBeTruthy();
  });

  it("every mapped key has its text in the four languages", () => {
    for (const key of new Set(API_MESSAGE_KEYS.values())) {
      for (const lang of LANG_CODES) expect(DICTIONARIES[lang][`errors.${key}`], `${lang} ${key}`).toBeTruthy();
    }
  });
});

describe("apiErrorText", () => {
  const az = createTranslator("az", DICTIONARIES);
  const en = createTranslator("en", DICTIONARIES);

  it("translates a known message, whatever whitespace surrounds it", () => {
    expect(apiErrorText(az, new Error("  Invalid credentials \n"))).toBe("İstifadəçi adı və ya şifrə səhvdir.");
    expect(apiErrorText(en, "Parola hatalı")).toBe("Incorrect password.");
  });

  it("prefers the client's code to the text", () => {
    const err = Object.assign(new Error("anything"), { code: "REQUEST_TIMEOUT" });
    expect(apiErrorText(en, err)).toMatch(/^The server did not answer/);
  });

  it("keeps the status of a request that failed without a message of its own", () => {
    expect(apiErrorText(en, new Error("İstek başarısız (502)"))).toBe("The request failed (502).");
  });

  it("names a password that is too long, from the 422's items, never echoing the input", () => {
    const err = Object.assign(new Error("new_password: String should have at most 1024 characters"), {
      status: 422, fieldErrors: [{ field: "new_password", type: "string_too_long", message: "…" }],
    });
    expect(apiErrorText(en, err)).toBe("The password can be at most 1024 characters.");
  });

  it("shows an unknown message as the server wrote it, and never an empty string", () => {
    expect(apiErrorText(en, new Error("Beklenmeyen bir durum"))).toBe("Beklenmeyen bir durum");
    expect(apiErrorText(en, new Error(""))).toBe("The action could not be completed.");
    expect(apiErrorText(en, null)).toBe("The action could not be completed.");
  });
});

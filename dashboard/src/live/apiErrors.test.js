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
  // An alias of one of them (`_PASSWORD_CHECKS_THROTTLED = _DIRECTORY_THROTTLED`) is that text.
  for (const m of src.matchAll(/^(_?[A-Z][A-Z0-9_]*) = (_?[A-Z][A-Z0-9_]*)$/gm)) {
    if (out.has(m[2])) out.set(m[1], out.get(m[2]));
  }
  return out;
}
const literals = (src, pattern) => [...src.matchAll(new RegExp(pattern, "g"))].map((m) => unquote(m[1]));
/** The first argument of every call or keyword `opener` opens (to the end of its line), whether it
 *  starts on the opener's line or on the next. */
const sites = (src, opener) => [...src.matchAll(new RegExp(opener, "g"))]
  .map((m) => src.slice(m.index + m[0].length).trimStart().split("\n")[0].trim());
/** The text of the call whose "(" is at `open`, to its matching ")" (strings skipped). */
function callBody(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const close = src.indexOf(c, i + 1);
      i = close < 0 ? src.length : close;
    } else if (c === "(") depth += 1;
    else if (c === ")" && (depth -= 1) === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

const DEPS = py("auth/dependencies.py");
const ROUTER = py("auth/router.py");
const SERVICE = py("auth/service.py");
const SCHEMAS = py("auth/schemas.py");
const LDAP = pyConstants(py("auth/ldap.py"));
const BACKEND_API = js("backendApi.js");
const NGINX = fs.readFileSync(path.resolve(HERE, "../../../deploy/local/web/nginx.conf"), "utf8");
const nginxLimit = (name) => new RegExp(String.raw`^\s*location @${name} \{[^}]*?^\s*return 429 '([^']*)';`, "m").exec(NGINX);
const nginxLimited = nginxLimit("login_limited");
const nginxReauthLimited = nginxLimit("reauth_limited");

/** Every message the auth surface can answer with, and where it comes from. */
const SOURCES = [
  ...[...pyConstants(DEPS).values()].map((m) => ["auth/dependencies.py constant", m]),
  ...literals(DEPS, String.raw`detail=\s*${STR}`).map((m) => ["auth/dependencies.py detail", m]),
  ...literals(DEPS, String.raw`_unauthorized\(\s*${STR}\s*\)`).map((m) => ["auth/dependencies.py 401", m]),
  ...literals(DEPS, String.raw`def _unauthorized\(detail: str = ${STR}\)`).map((m) => ["auth/dependencies.py 401 default", m]),
  ...[...pyConstants(ROUTER).values()].map((m) => ["auth/router.py constant", m]),
  ...literals(ROUTER, String.raw`detail=\s*${STR}`).map((m) => ["auth/router.py detail", m]),
  ...literals(SERVICE, String.raw`PasswordError\(\s*${STR}`).map((m) => ["auth/service.py", m]),
  ...literals(SCHEMAS, String.raw`ValueError\(\s*${STR}\s*\)`).map((m) => ["auth/schemas.py", m]),
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

// The readers above capture string LITERALS. A message the server builds some other way would pass
// them unseen, so every site that sets a message is accounted for: a literal (captured, and counted
// against the readers), a named constant (read above), or a dynamic one listed here with its reason.
describe("no message site escapes the readers", () => {
  const CONSTANTS = new Set([...pyConstants(DEPS).keys(), ...pyConstants(ROUTER).keys(), ...LDAP.keys()]);
  const DYNAMIC = [
    ["auth/dependencies.py", /^detail,/, "_unauthorized's own parameter: every call's literal is read above"],
    ["auth/dependencies.py", /^\)/, "_unauthorized() with no argument: its default literal is read above"],
    ["auth/dependencies.py", /^f"permission required:/, "a permission key of the route, not a sign-in message; shown as the server wrote it"],
    ["auth/router.py", /^str\(exc\)/, "PasswordError's message: its literals are read from service.py"],
  ];
  const DETAIL = String.raw`\bdetail=`;
  const UNAUTHORIZED = String.raw`(?<!def )\b_unauthorized\(`;
  const FILES = [
    ["auth/dependencies.py", DEPS, [DETAIL, UNAUTHORIZED]],
    ["auth/router.py", ROUTER, [DETAIL]],
    ["auth/service.py", SERVICE, [String.raw`(?<!class )\bPasswordError\(`]],
    ["auth/schemas.py", SCHEMAS, [String.raw`\bValueError\(`]],
  ];
  const literalSites = (src, openers) => openers.flatMap((o) => sites(src, o)).filter((s) => s.startsWith('"')).length;

  it.each(FILES)("%s: every site is a literal read above, a known constant, or listed", (file, src, openers) => {
    const found = openers.flatMap((opener) => sites(src, opener));
    expect(found.length, `${file} has message sites`).toBeGreaterThan(0);
    const unaccounted = found.filter((site) => {
      if (site.startsWith('"')) return false;
      const name = /^([A-Za-z_]\w*)\s*[,)]/.exec(site);
      if (name && CONSTANTS.has(name[1])) return false;
      return !DYNAMIC.some(([f, pattern]) => f === file && pattern.test(site));
    });
    expect(unaccounted, `${file}: a message the readers cannot see`).toEqual([]);
  });

  it("the literal sites are as many as the literals the readers captured", () => {
    expect(literalSites(DEPS, FILES[0][2])).toBe(
      literals(DEPS, String.raw`detail=\s*${STR}`).length + literals(DEPS, String.raw`_unauthorized\(\s*${STR}\s*\)`).length);
    expect(literalSites(ROUTER, FILES[1][2])).toBe(literals(ROUTER, String.raw`detail=\s*${STR}`).length);
    expect(literalSites(SERVICE, FILES[2][2])).toBe(literals(SERVICE, String.raw`PasswordError\(\s*${STR}`).length);
    expect(literalSites(SCHEMAS, FILES[3][2])).toBe(literals(SCHEMAS, String.raw`ValueError\(\s*${STR}\s*\)`).length);
  });

  it("every HTTPException states its detail", () => {
    for (const [file, src] of [["auth/dependencies.py", DEPS], ["auth/router.py", ROUTER]]) {
      for (const m of src.matchAll(/\bHTTPException\(/g)) {
        expect(callBody(src, m.index + m[0].length - 1), `${file}: HTTPException with no detail`).toMatch(/\bdetail=/);
      }
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

  it("a 401 that ended the session is not read as a wrong username or password", () => {
    const ended = Object.assign(new Error("Invalid credentials"), { status: 401, sessionEnded: true });
    expect(apiErrorText(en, ended)).toBe("Your session has expired; please sign in again.");
    expect(apiErrorText(az, ended)).toBe(az("errors.sessionExpired"));
    expect(apiErrorText(en, Object.assign(new Error("Invalid credentials"), { status: 401 })))
      .toBe("Incorrect username or password.");
  });

  it("a server that could not answer is not read as wrong credentials", () => {
    for (const status of [500, 502, 503]) {
      const err = Object.assign(new Error("Giriş başarısız."), { status });
      expect(apiErrorText(en, err), String(status)).toBe("The server cannot be reached right now. Try again shortly.");
    }
    const html = Object.assign(new Error("Doğrulama kodu geçersiz."), { status: 502 });
    expect(apiErrorText(en, html)).toBe("The server cannot be reached right now. Try again shortly.");
    // its own, more specific answers stay
    expect(apiErrorText(en, Object.assign(new Error("Dizin sunucusuna ulaşılamıyor"), { status: 503 })))
      .toMatch(/directory server/);
    expect(apiErrorText(en, Object.assign(new Error("Giriş başarısız."), { status: 401 }))).toBe("Sign-in failed.");
    for (const lang of LANG_CODES) expect(DICTIONARIES[lang]["errors.serverUnreachable"], lang).toBeTruthy();
  });

  it("the lock and the password's throttle do not claim the account is the hospital's", () => {
    for (const lang of LANG_CODES) {
      expect(DICTIONARIES[lang]["errors.directoryThrottled"], lang).not.toMatch(/hospital|больнич|xəstəxana|hastane/i);
      expect(DICTIONARIES[lang]["errors.tokenVersion"], lang).toBeTruthy();
    }
    expect(en("errors.directoryThrottled")).toBe("Too many attempts for this account. Try again in 15 minutes.");
    expect(en("errors.tokenVersion")).toBe("Your account has changed; please sign in again.");
  });

  it("shows an unknown message as the server wrote it, and never an empty string", () => {
    expect(apiErrorText(en, new Error("Beklenmeyen bir durum"))).toBe("Beklenmeyen bir durum");
    expect(apiErrorText(en, new Error(""))).toBe("The action could not be completed.");
    expect(apiErrorText(en, null)).toBe("The action could not be completed.");
  });
});

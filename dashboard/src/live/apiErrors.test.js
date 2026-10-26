// Every refusal the sign-in, MFA, password, lock-screen and session surface can show is mapped
// to a translated text. The messages are read from their sources as TEXT (never executed), so a
// message added or changed on the server fails here until apiErrors.js maps it — the guarantee
// i18n.rbac.test.js gave the old workspace until G1-16 removed both.
// (Paths built with node:path: under jsdom the global URL is jsdom's, which fileURLToPath refuses.)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMISSION_CODE_KEYS, API_MESSAGE_KEYS, INVALID_FIELD_KEYS, apiErrorKey, apiErrorText, fieldRefusals, readErrorText,
} from "./apiErrors.js";
import { DICTIONARIES } from "./i18n/catalog.js";
import { LANG_CODES } from "./i18n/langs.js";
import { createTranslator } from "./i18n/translate.js";
import { emptyForm, toBody } from "./screens/kabul/admitForm.js";
import { dischargeBody } from "./screens/kabul/DischargeDialog.jsx";

/** What the discharge dialog sends (every key, whichever the disposition). */
const DISCHARGE_FIELDS = Object.keys(dischargeBody({
  disposition: "EXITUS", institution: "Sentetik", reportedBy: "Sentetik", dischargeAt: "2026-10-25T08:00:00Z", note: "Sentetik",
}));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, "../../../homunculus-engine/src/homunculus");
const py = (rel) => fs.readFileSync(path.join(ENGINE, rel), "utf8");
/** Every module of the auth package, by glob: a new one is scanned without anyone remembering to add it. */
const AUTH_MODULES = fs.readdirSync(path.join(ENGINE, "auth")).filter((f) => f.endsWith(".py")).sort();
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

const APP = py("api/app.py");
const ADMIN_ROUTER = py("admin/router.py");
const ADMIN_SERVICE = py("admin/service.py");
const ADMIN_SCHEMAS = py("admin/schemas.py");
const LDAP_SERVICE = py("admin/ldap_service.py");
const LDAP_ROUTER = py("admin/ldap_router.py");
const SCOPE_ROUTER = py("scope/router.py");
const SCOPE_SCHEMAS = py("scope/schemas.py");
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

/** ldap.py's string constants that are not messages (an LDAP search filter); every other one is. */
const LDAP_NOT_MESSAGES = new Set(["DEFAULT_USER_FILTER"]);
/** admin/ldap_service.py constants that are not messages: the SKIP_* values are the reason an
 *  import gives per account (`LdapSkippedOut.reason`), which the login-source screen translates
 *  itself, and the rest are column or attribute names. */
const LDAP_SERVICE_NOT_MESSAGES = (name) => name.startsWith("SKIP_");

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
  ...[...LDAP].filter(([name]) => !LDAP_NOT_MESSAGES.has(name)).map(([name, text]) => [`auth/ldap.py ${name}`, text]),
  ["nginx.conf 429", nginxLimited ? JSON.parse(nginxLimited[1]).detail : undefined],
  ["nginx.conf reauth 429", nginxReauthLimited ? JSON.parse(nginxReauthLimited[1]).detail : undefined],
  ...literals(BACKEND_API, String.raw`failure\(\w+,\s*${STR}\)`).map((m) => ["backendApi.js", m]),
  ...literals(BACKEND_API, String.raw`TIMEOUT_MESSAGE = ${STR}`).map((m) => ["backendApi.js timeout", m]),
  ...literals(BACKEND_API, String.raw`SUPERSEDED_MESSAGE = ${STR}`).map((m) => ["backendApi.js superseded", m]),
  // Wave 3's screens (the beds, the alarms, the patient, and the three administration tabs) talk
  // to the board, /admin, /scope and /admin/ldap, so those refusals have to be translated too.
  ...literals(APP, String.raw`detail=\s*${STR}`).map((m) => ["api/app.py detail", m]),
  ...[...pyConstants(ADMIN_SERVICE).values()].map((m) => ["admin/service.py constant", m]),
  ...literals(ADMIN_SERVICE, String.raw`AdminError\(\d+,\s*${STR}`).map((m) => ["admin/service.py AdminError", m]),
  ...[...pyConstants(ADMIN_SCHEMAS).values()].map((m) => ["admin/schemas.py constant", m]),
  ...literals(ADMIN_SCHEMAS, String.raw`ValueError\(\s*${STR}`).map((m) => ["admin/schemas.py", m]),
  ...[...pyConstants(LDAP_SERVICE)].filter(([name]) => !LDAP_SERVICE_NOT_MESSAGES(name))
    .map(([name, text]) => [`admin/ldap_service.py ${name}`, text]),
  ...literals(LDAP_ROUTER, String.raw`detail=\s*${STR}`).map((m) => ["admin/ldap_router.py detail", m]),
  ...literals(SCOPE_ROUTER, String.raw`detail=\s*${STR}`).map((m) => ["scope/router.py detail", m]),
  ...literals(SCOPE_SCHEMAS, String.raw`ValueError\(\s*${STR}`).map((m) => ["scope/schemas.py", m]),
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
  const CONSTANTS = new Set([...pyConstants(DEPS).keys(), ...pyConstants(ROUTER).keys(), ...LDAP.keys(),
    ...pyConstants(ADMIN_SERVICE).keys(), ...pyConstants(ADMIN_SCHEMAS).keys(),
    ...pyConstants(LDAP_SERVICE).keys()]);
  const DYNAMIC = [
    // [file, the first argument, how many sites, why]
    ["auth/dependencies.py", /^detail,/, 1, "_unauthorized's own parameter: every call's literal is read above"],
    ["auth/dependencies.py", /^\)/, 5, "_unauthorized() with no argument: its default literal is read above"],
    ["auth/dependencies.py", /^f"permission required:/, 1, "a permission key of the route, not a sign-in message; shown as the server wrote it"],
    ["auth/router.py", /^str\(exc\)/, 1, "PasswordError's message: its literals are read from service.py"],
    // Wave 3's files.
    ["api/app.py", /^f"permission required:/, 1, "a permission key of the route; the key is not translated, the sentence around it is"],
    ["api/app.py", /^str\(exc\)/, 6, "ClinicalEntryError / GatewayError / ScoreError: the engine's own validation text, shown as the engine wrote it"],
    ["api/app.py", /^\{"reason": "/, 5, "Aşama A's forwarder lane (POST /infinity-shadow/readings): the hub reads these by status; no screen calls the route or shows them"],
    ["admin/service.py", /^f"\{BEYOND_OWN_RIGHTS\}/, 1, "the constant plus the keys it lacks; matched by shape (BEYOND_OWN_RIGHTS in apiErrors.js)"],
    ["admin/service.py", /^detail\) from None/, 1, "_flush's own parameter: every caller passes a constant read above"],
    ["admin/service.py", /^str\(exc\)\)/, 2, "the ORM's own message for a bad id or a group of another tenant, shown as it arrived"],
    ["admin/router.py", /^exc\.detail,/, 1, "AdminError's own detail: its literals are read from service.py"],
  ];
  const DETAIL = String.raw`\bdetail=`;
  const UNAUTHORIZED = String.raw`(?<!def )\b_unauthorized\(`;
  // scope/router.py raises with the status positionally: `HTTPException(status.HTTP_404…, "…")`.
  // `(?!\s*detail=)` sits right after the comma: a lookahead placed after `\s*` is defeated by
  // backtracking (the engine simply consumes less whitespace).
  const POSITIONAL = String.raw`HTTPException\(status\.HTTP_\w+,(?!\s*detail=)\s*`;
  const FILES = [
    ["auth/dependencies.py", DEPS, [DETAIL, UNAUTHORIZED]],
    ["auth/router.py", ROUTER, [DETAIL]],
    ["auth/service.py", SERVICE, [String.raw`(?<!class )\bPasswordError\(`]],
    ["auth/schemas.py", SCHEMAS, [String.raw`\bValueError\(`]],
    // Wave 3's screens: the board (/patients, /ack, /view), /admin, /admin/ldap and /scope.
    ["api/app.py", APP, [DETAIL]],
    ["admin/router.py", ADMIN_ROUTER, [DETAIL]],
    ["admin/service.py", ADMIN_SERVICE, [String.raw`(?<!class )\bAdminError\(\d+, `]],
    ["admin/schemas.py", ADMIN_SCHEMAS, [String.raw`\bValueError\(`]],
    ["admin/ldap_router.py", LDAP_ROUTER, [DETAIL]],
    ["admin/ldap_service.py", LDAP_SERVICE, [String.raw`\bAdminError\(\d+, `]],
    ["scope/router.py", SCOPE_ROUTER, [DETAIL, POSITIONAL]],
    ["scope/schemas.py", SCOPE_SCHEMAS, [String.raw`\bValueError\(`]],
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

  it.each(DYNAMIC.map(([file, pattern, count]) => [file, String(pattern), pattern, count]))(
    "%s: the listed dynamic sites %s are exactly as many as expected", (file, _label, pattern, count) => {
      const [, src, openers] = FILES.find(([name]) => name === file);
      const found = openers.flatMap((opener) => sites(src, opener)).filter((site) => pattern.test(site));
      expect(found.length, `${file}: ${pattern}`).toBe(count);
    });

  it("every module of the auth package that sets a message is scanned", () => {
    const scanned = new Set(FILES.map(([name]) => name.replace("auth/", "")));
    const setters = AUTH_MODULES.filter((f) => /\bHTTPException\(|\bdetail=|\bPasswordError\(|\b_unauthorized\(/.test(py(`auth/${f}`)));
    expect(setters.filter((f) => !scanned.has(f)), "a module that sets a message but is not in FILES").toEqual([]);
  });

  // The same completeness check for the packages Wave 3's screens talk to. Without it the readers
  // cover the files somebody remembered to name: a `detail=` added to `admin/router.py` — which
  // sets none today — would reach a ward untranslated and nothing here would notice, which is the
  // one thing this whole file exists to prevent.
  it.each(["admin", "scope"])("every module of the %s package that sets a message is scanned", (pkg) => {
    const scanned = new Set(FILES.map(([name]) => name));
    const modules = fs.readdirSync(path.join(ENGINE, pkg)).filter((f) => f.endsWith(".py")).sort();
    const setters = modules.filter((f) => /\bHTTPException\(|\bdetail=|\bAdminError\(|\bValueError\(/.test(py(`${pkg}/${f}`)));
    expect(setters.filter((f) => !scanned.has(`${pkg}/${f}`)),
      `a ${pkg} module that sets a message but is not in FILES`).toEqual([]);
  });

  it("every string constant of ldap.py is a message read above, or listed as not one", () => {
    expect([...LDAP.keys()].sort()).toEqual(["DEFAULT_USER_FILTER", "DIRECTORY_DOWN", "NOT_CONFIGURED"]);
  });

  it("the literal sites are as many as the literals the readers captured", () => {
    expect(literalSites(DEPS, FILES[0][2])).toBe(
      literals(DEPS, String.raw`detail=\s*${STR}`).length + literals(DEPS, String.raw`_unauthorized\(\s*${STR}\s*\)`).length);
    expect(literalSites(ROUTER, FILES[1][2])).toBe(literals(ROUTER, String.raw`detail=\s*${STR}`).length);
    expect(literalSites(SERVICE, FILES[2][2])).toBe(literals(SERVICE, String.raw`PasswordError\(\s*${STR}`).length);
    expect(literalSites(SCHEMAS, FILES[3][2])).toBe(literals(SCHEMAS, String.raw`ValueError\(\s*${STR}\s*\)`).length);
  });

  it("every HTTPException states its detail", () => {
    for (const [file, src] of AUTH_MODULES.map((f) => [`auth/${f}`, py(`auth/${f}`)])) {
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

  it("names the permission a route asks for, and both when either opens it", () => {
    expect(apiErrorText(en, "permission required: board.view")).toBe("You do not have the right for this (board.view).");
    // GET /infinity-shadow/board (Aşama A) opens for either of two rights.
    expect(apiErrorText(en, "permission required: board.view or devices.manage"))
      .toBe("You do not have the right for this (board.view or devices.manage).");
    expect(apiErrorText(en, "permission required: board.view or")).not.toMatch(/^You do not have the right/);
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

  it("a 503 that says the scope could not be read stays that answer, not 'the server cannot be reached'", () => {
    // /stream-ticket and GET /patients/{id}/trends answer 503 "kapsam şu anda okunamıyor": the
    // server IS reachable, only the look-up of what the caller may see failed.
    const err = Object.assign(new Error("kapsam şu anda okunamıyor"), { status: 503 });
    expect(apiErrorKey(err)).toEqual({ key: "errors.scopeUnreadable", vars: {} });
    for (const lang of LANG_CODES) {
      const t = createTranslator(lang, DICTIONARIES);
      expect(apiErrorText(t, err), lang).toBe(t("errors.scopeUnreadable"));
      expect(apiErrorText(t, err), lang).not.toBe(t("errors.serverUnreachable"));
    }
    // and a 5xx that says nothing of the scope is still the generic one
    expect(apiErrorKey(Object.assign(new Error("Beklenmeyen"), { status: 503 })))
      .toEqual({ key: "errors.serverUnreachable", vars: {} });
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

describe("a 422 from pydantic's own length checks", () => {
  const en = createTranslator("en", DICTIONARIES);
  const az = createTranslator("az", DICTIONARIES);
  /** What backendApi.failure() builds from a FastAPI 422: field, type, message — and since this
   *  fix, the two lengths of `ctx`. */
  const e422 = (...items) => Object.assign(
    new Error(items.map((i) => `${i.field}: ${i.message}`).join("; ")), { status: 422, fieldErrors: items },
  );
  const short = (field, min) => ({
    field, type: "string_too_short", message: `String should have at least ${min} character${min === 1 ? "" : "s"}`, ctx: { min_length: min },
  });
  const long = (field, max) => ({
    field, type: "string_too_long", message: `String should have at most ${max} characters`, ctx: { max_length: max },
  });

  it("say the server's own number, in the reader's language — never pydantic's English", () => {
    // Measured by the review on every limit the administration forms carry: each reached the
    // administrator as "String should have at most 128 characters", in all four languages.
    const CASES = [
      [long("username", 128), "At most 128 characters."],
      [long("email", 254), "At most 254 characters."],
      [long("full_name", 200), "At most 200 characters."],
      [long("name", 120), "At most 120 characters."],
      [long("description", 500), "At most 500 characters."],
      [long("reason", 200), "At most 200 characters."],
      [short("ad_group_dn", 3), "At least 3 characters."],
      [short("query.q", 2), "At least 2 characters."],
    ];
    for (const [item, text] of CASES) {
      expect(apiErrorText(en, e422(item)), item.field).toBe(text);
      expect(fieldRefusals(en, e422(item), [item.field]).fields[item.field], item.field).toBe(text);
    }
    expect(apiErrorText(az, e422(long("username", 128)))).toBe("Ən çoxu 128 simvol ola bilər.");
  });

  it("an empty field is a blank one, not \"at least 1 characters\"", () => {
    expect(apiErrorText(en, e422(short("full_name", 1)))).toBe(en("errors.mustNotBeBlank"));
    expect(apiErrorText(en, e422(short("reason", 1)))).toBe(en("errors.mustNotBeBlank"));
  });

  it("a password below its minimum says the minimum — \"enter your password\" only when the minimum is one", () => {
    // Reachable with a password the screen counted as long enough: four emoji are eight UTF-16
    // units to JavaScript's `.length` and four characters to Python's `len`.
    expect(apiErrorText(en, e422(short("password", 8)))).toBe("At least 8 characters.");
    expect(apiErrorText(en, e422(short("password", 1)))).toBe(en("errors.passwordRequired"));
    expect(apiErrorText(en, e422({ field: "current_password", type: "missing", message: "Field required" })))
      .toBe(en("errors.passwordRequired"));
    // A password that is too long keeps its own sentence, which already names the server's 1024.
    expect(apiErrorText(en, e422(long("new_password", 1024)))).toBe("The password can be at most 1024 characters.");
  });

  it("reads the number from pydantic's own sentence when ctx did not come with it", () => {
    const bare = { field: "username", type: "string_too_long", message: "String should have at most 128 characters" };
    expect(apiErrorText(en, e422(bare))).toBe("At most 128 characters.");
  });

  it("a list over its cap says how many at a time", () => {
    const item = { field: "external_ids", type: "too_long", message: "List should have at most 50 items after validation, not 51", ctx: { max_length: 50 } };
    expect(apiErrorText(en, e422(item))).toBe("At most 50 at a time.");
  });

  it("every length sentence exists in the four languages with its number", () => {
    for (const lang of LANG_CODES) {
      expect(DICTIONARIES[lang]["errors.fieldTooShort"], lang).toContain("{min}");
      expect(DICTIONARIES[lang]["errors.fieldTooLong"], lang).toContain("{max}");
      expect(DICTIONARIES[lang]["errors.listTooShort"], lang).toContain("{min}");
      expect(DICTIONARIES[lang]["errors.listTooLong"], lang).toContain("{max}");
    }
  });
});

describe("fieldRefusals", () => {
  const en = createTranslator("en", DICTIONARIES);
  const e422 = (...items) => Object.assign(new Error("…"), { status: 422, fieldErrors: items });

  it("puts each refusal under the control the form draws for it, and everything else in `others`", () => {
    // A 422 about a field the form does not render — `group_ids.0`, a scope's `grants.0`, a
    // model-level item with no field — used to come back keyed by its API path, the form found
    // "some field" was named, and the refusal went under no control and onto no toast.
    const err = e422(
      { field: "username", type: "string_too_long", message: "String should have at most 128 characters", ctx: { max_length: 128 } },
      { field: "group_ids.0", type: "uuid_parsing", message: "Input should be a valid UUID" },
      { field: "grants.0", type: "value_error", message: "bir atama ya bir ünite ya bir yatak belirtir, ikisi birden değil" },
      { field: null, type: "value_error", message: "something about the whole body" },
    );
    const split = fieldRefusals(en, err, ["username", "email", "full_name", "password"]);
    expect(split.fields).toEqual({ username: "At most 128 characters." });
    expect(split.others).toEqual([
      "Input should be a valid UUID",
      "One grant names either a unit or a bed, never both.",
      "something about the whole body",
    ]);
  });

  it("with no rendered field named, everything is `others` — the toast's", () => {
    const err = e422({ field: "reason", type: "value_error", message: "reason: at least one letter or digit" });
    expect(fieldRefusals(en, err, [])).toEqual({ fields: {}, others: [en("errors.reasonNeedsText")] });
    expect(fieldRefusals(en, err)).toEqual({ fields: {}, others: [en("errors.reasonNeedsText")] });
  });

  it("anything that is not a 422 with items is neither", () => {
    expect(fieldRefusals(en, Object.assign(new Error("Bu kısa ad zaten kullanılıyor"), { status: 409 }), ["slug"]))
      .toEqual({ fields: {}, others: [] });
    expect(fieldRefusals(en, null, ["slug"])).toEqual({ fields: {}, others: [] });
  });
});

describe("readErrorText", () => {
  const en = createTranslator("en", DICTIONARIES);

  it("a READ that timed out says nothing was read — never a write's \"it may have happened\"", () => {
    const timedOut = Object.assign(new Error("…"), { code: "REQUEST_TIMEOUT" });
    expect(readErrorText(en, timedOut)).toBe("The server did not answer in time; nothing was read. Try again shortly.");
    expect(readErrorText(en, timedOut)).not.toMatch(/may have gone through/);
    for (const lang of LANG_CODES) expect(DICTIONARIES[lang]["errors.readTimeout"], lang).toBeTruthy();
  });

  it("anything else reads exactly as apiErrorText says it", () => {
    for (const err of [new Error("Parola hatalı"), Object.assign(new Error("x"), { status: 503 }), new Error("Beklenmeyen")]) {
      expect(readErrorText(en, err)).toBe(apiErrorText(en, err));
    }
  });
});

// G2-B1a — the admission and structure routes' coded refusals, read from the engine's sources.
describe("a coded refusal (Hasta Kabul) is mapped by its code, never its words", () => {
  const ERRORS_PY = py("admission/errors.py");
  /** The codes: every `NAME = "code"` constant of errors.py but FIELD_INVALID's prefix. */
  const CODES = [...ERRORS_PY.matchAll(/^([A-Z_]+) = "([a-z_]+)"/gm)]
    .filter(([, name]) => name !== "FIELD_INVALID").map(([, , code]) => code);
  const FORM_PY = py("admission/form.py");
  /** Fields form.py refuses in a loop — `for name in ("phone", "relative_phone"): … field_invalid(name, …)` —
   *  read from the loop's own tuple, so a name added to it is seen without anyone listing it. */
  const LOOPED = [...FORM_PY.matchAll(/for (\w+) in \(([^)]*)\):\r?\n(?:[^\n]*\n){0,6}?[^\n]*field_invalid\(\1\b/g)]
    .flatMap((m) => [...m[2].matchAll(/"(\w+)"/g)].map((name) => name[1]));
  /** Fields the request models refuse while the body is read (A-10, A-16): every text and JSON list
   *  of the form and the discharge is a `FormText`, `OptionalFormText`, `list[FormText]` or `FormJson`,
   *  whose validator answers `field_invalid:<the field's own name>` (admission/schemas.py `_refusal`). */
  const SCHEMA_RAISED = [...py("admission/schemas.py")
    .matchAll(/^\s+(\w+): (?:(?:OptionalFormText|FormText|FormJson)\b|list\[FormText\])/gm)].map((m) => m[1]);
  /** Every field a `field_invalid("<field>", …)` names, in the three files that raise one, and the
   *  two kinds above. */
  const FIELDS = [...new Set([...["admission/form.py", "admission/router.py", "tenant/router.py"]
    .flatMap((file) => [...py(file).matchAll(/field_invalid\(\s*"(\w+)"/g)].map((m) => m[1])), ...LOOPED, ...SCHEMA_RAISED])];
  const coded = (apiCode) => Object.assign(new Error("English words a screen must not show"), { status: 409, apiCode });

  it("the readers found the codes and the fields the engine raises", () => {
    expect(CODES).toEqual(expect.arrayContaining(["bed_not_available", "critical_alarm_open", "out_of_scope"]));
    // The eleven of Task 2, `bed_label_taken` (A-5, Task 7), `request_conflict` (A-19, Task 8) and
    // `board_not_cleared` (A-32, Task 9's review).
    expect(CODES).toHaveLength(14);
    // admission/form.py's; the routers' own (`label`, `admitting_unit_id`) are read the same way.
    expect(FIELDS).toEqual(expect.arrayContaining(["consent", "allergies_text", "institution", "admission_datetime", "reported_by"]));
    // The two loops of form.py: the names, and the phones.
    expect([...LOOPED].sort()).toEqual(["companion_name", "father_name", "phone", "relative_name", "relative_phone"]);
    // Both request models' texts, a JSON list, and the discharge's note.
    expect(SCHEMA_RAISED).toEqual(expect.arrayContaining(["display_name", "his_patient_reference", "icd10_codes",
      "known_allergies", "comorbidities_text", "institution", "reported_by", "note"]));
    // 11 of the patient, 15 of the note, 3 of the discharge (a new one fails below until it is mapped)
    expect(SCHEMA_RAISED.length).toBeGreaterThanOrEqual(29);
  });

  it("every text either map points at, and the generic field sentence, exists in the four languages (A-9)", () => {
    const keys = [...ADMISSION_CODE_KEYS.values(), ...INVALID_FIELD_KEYS.values(), "kabul.invalid.other"];
    expect(keys.length).toBe(ADMISSION_CODE_KEYS.size + INVALID_FIELD_KEYS.size + 1);
    for (const key of keys) {
      for (const lang of LANG_CODES) expect(DICTIONARIES[lang][key], `${lang} ${key}`).toBeTruthy();
    }
  });

  it("the map holds every code errors.py raises, and nothing else", () => {
    expect([...ADMISSION_CODE_KEYS.keys()].sort()).toEqual([...CODES].sort());
  });

  it.each(CODES)("%s has a text in the four languages", (code) => {
    const hit = apiErrorKey(coded(code));
    expect(hit.key).toMatch(/^kabul\.err\./);
    for (const lang of LANG_CODES) expect(DICTIONARIES[lang][hit.key], `${lang} ${hit.key}`).toBeTruthy();
  });

  it.each(FIELDS)("field_invalid:%s names its field in the four languages", (field) => {
    const hit = apiErrorKey(coded(`field_invalid:${field}`));
    expect(hit.key).not.toBe("kabul.invalid.other");
    for (const lang of LANG_CODES) expect(DICTIONARIES[lang][hit.key], `${lang} ${hit.key}`).toBeTruthy();
  });

  it("an unknown field still reads a sentence, and the server's English never reaches the reader", () => {
    const en = createTranslator("en", DICTIONARIES);
    expect(apiErrorKey(coded("field_invalid:something_new")).key).toBe("kabul.invalid.other");
    expect(apiErrorText(en, coded("bed_not_available"))).not.toMatch(/English words/);
    expect(apiErrorText(en, coded("bed_not_available"))).toBe(en("kabul.err.bedNotAvailable"));
  });

  it("a code wins over a message that happens to be mapped", () => {
    const both = Object.assign(new Error("hasta bulunamadı"), { status: 403, apiCode: "out_of_scope" });
    expect(apiErrorKey(both).key).toBe("kabul.err.outOfScope");
  });

  // A-19, A-29: the form's request id came before with another form. An admission exists under it;
  // the nurse is sent to the list, with the earlier admission's number when the server gave it (its
  // bed is in her units). Nothing is said of a retry: there is none.
  it("request_conflict says an admission exists under this form, sends the nurse to the list, and names its number when given", () => {
    const withNumber = Object.assign(coded("request_conflict"), { patientNumber: "H2600042" });
    expect(apiErrorKey(withNumber)).toEqual({ key: "kabul.err.requestConflictNumber", vars: { number: "H2600042" } });
    expect(apiErrorKey(coded("request_conflict"))).toEqual({ key: "kabul.err.requestConflict", vars: {} });
    expect(apiErrorKey(Object.assign(coded("request_conflict"), { patientNumber: "  " })).key).toBe("kabul.err.requestConflict");
    for (const lang of LANG_CODES) {
      const t = createTranslator(lang, DICTIONARIES);
      const list = `${t("kabul.tabDischarge")} › ${t("kabul.lyingTitle")}`;
      expect(apiErrorText(t, withNumber), lang).toContain("H2600042");
      expect(apiErrorText(t, withNumber), lang).toContain(list);
      expect(apiErrorText(t, coded("request_conflict")), lang).toContain(list);
      expect(apiErrorText(t, coded("request_conflict")), lang).not.toMatch(/\{number\}|English words/);
    }
  });

  // A-32: a bed's release refused while its last patient's card is still on the board. The server
  // names that patient's number (tenant/router.py `_last_card_off`; the caller's units hold the bed),
  // so the nurse knows whose card stands; without one, the sentence without it. A number on a code
  // that has no such sentence is not shown.
  it("board_not_cleared names the patient whose card still stands when the server gives the number", () => {
    const withNumber = Object.assign(coded("board_not_cleared"), { patientNumber: "H2600042" });
    expect(apiErrorKey(withNumber)).toEqual({ key: "kabul.err.boardNotClearedNumber", vars: { number: "H2600042" } });
    expect(apiErrorKey(coded("board_not_cleared"))).toEqual({ key: "kabul.err.boardNotCleared", vars: {} });
    expect(apiErrorKey(Object.assign(coded("board_not_cleared"), { patientNumber: "  " })).key).toBe("kabul.err.boardNotCleared");
    expect(apiErrorKey(Object.assign(coded("bed_not_available"), { patientNumber: "H2600042" })))
      .toEqual({ key: "kabul.err.bedNotAvailable", vars: {} });
    for (const lang of LANG_CODES) {
      const t = createTranslator(lang, DICTIONARIES);
      expect(apiErrorText(t, withNumber), lang).toContain("H2600042");
      expect(apiErrorText(t, withNumber), lang).not.toMatch(/\{number\}|English words/);
      expect(apiErrorText(t, coded("board_not_cleared")), lang).not.toMatch(/\{number\}|English words/);
    }
  });

  // The fields no screen sends today read one sentence that says so — and the guard that they are
  // still not sent: the day a screen sends one, it needs its own sentence here.
  it("a field this screen never sends reads that it was not the screen's, and the form's body indeed holds none of them", () => {
    const body = toBody({ ...emptyForm(), name: "Sentetik", fin: "AB12C34" }, "11111111-1111-4111-8111-111111111111");
    const sent = new Set([...Object.keys(body), ...Object.keys(body.patient), ...Object.keys(body.note),
      ...DISCHARGE_FIELDS]);
    const unsent = FIELDS.filter((field) => INVALID_FIELD_KEYS.get(field) === "kabul.invalid.notOnScreen");
    expect(unsent).toEqual(expect.arrayContaining(["icd10_codes", "known_allergies", "baseline_spo2_range", "admission_note_narrative"]));
    for (const field of unsent) expect(sent.has(field), field).toBe(false);
    // and every field the screens do send names itself
    for (const field of FIELDS.filter((f) => sent.has(f))) {
      expect(INVALID_FIELD_KEYS.get(field), field).toBeDefined();
      expect(INVALID_FIELD_KEYS.get(field), field).not.toBe("kabul.invalid.notOnScreen");
    }
  });
});

// A-10, A-16: the request models refuse a field they do not have (`extra="forbid"`) and a number
// that is not one (`strict=True`); pydantic answers those as a 422 list, not a code.
describe("a 422 for a field the server does not take, or a number that is not one", () => {
  const en = createTranslator("en", DICTIONARIES);
  const e422 = (...items) => Object.assign(
    new Error(items.map((i) => `${i.field}: ${i.message}`).join("; ")), { status: 422, fieldErrors: items },
  );

  it("extra_forbidden says the server does not know a field the screen sent — never pydantic's English", () => {
    const err = e422({ field: "request_id", type: "extra_forbidden", message: "Extra inputs are not permitted" });
    expect(apiErrorKey(err)).toEqual({ key: "kabul.invalid.extraField", vars: {} });
    expect(apiErrorText(en, err)).not.toMatch(/Extra inputs/);
    expect(fieldRefusals(en, err, []).others).toEqual([en("kabul.invalid.extraField")]);
  });

  it("float_type names the weight and the height, and any other field as a number expected", () => {
    const item = (field) => ({ field, type: "float_type", message: "Input should be a valid number" });
    expect(apiErrorText(en, e422(item("note.weight_kg")))).toBe(en("kabul.miss.weight"));
    expect(apiErrorText(en, e422(item("note.height_cm")))).toBe(en("kabul.miss.height"));
    expect(apiErrorText(en, e422(item("note.gestational_age_weeks")))).toBe(en("kabul.invalid.number"));
    expect(apiErrorText(en, e422({ ...item("note.postnatal_day"), type: "int_type" }))).toBe(en("kabul.invalid.number"));
    expect(apiErrorText(en, e422(item("note.weight_kg")))).not.toMatch(/valid number/);
  });

  it("both texts exist in the four languages", () => {
    for (const lang of LANG_CODES) {
      for (const key of ["kabul.invalid.extraField", "kabul.invalid.number"]) {
        expect(DICTIONARIES[lang][key], `${lang} ${key}`).toBeTruthy();
      }
    }
  });
});

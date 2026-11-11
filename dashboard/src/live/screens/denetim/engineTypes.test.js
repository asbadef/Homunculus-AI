// engineTypes.test.js — G2-B4 follow-up D3 (spec 2026-11-11-g2b-b4-denetim-adlar-design.md): every audit event type
// the engine writes has a label on «Denetim bütünlüğü» and a place in its filter. The engine's sources are read as
// TEXT (never executed), as apiErrors.test.js reads them, so a type added to the engine fails here until EVENT_TYPES
// names it — the next new type cannot slip through to the page as a bare code.
// (Paths built with node:path: under jsdom the global URL is jsdom's, which fileURLToPath refuses.)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_TYPES } from "./denetim.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, "../../../../../homunculus-engine/src/homunculus");

/** Where the string literal that opens at `i` ends (just past its closing quote); triple quotes included. */
function stringEnd(text, i) {
  const c = text[i];
  const quote = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
  let j = i + quote.length;
  while (j < text.length && !text.startsWith(quote, j)) j += text[j] === "\\" ? 2 : 1;
  return j + quote.length;
}

/** The source with its comments dropped and its triple-quoted strings (docstrings) blanked, newlines kept: neither
 *  writes a row, and a call quoted in either must not be read as one. */
function codeOf(src) {
  let out = "";
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const end = stringEnd(src, i);
      const text = src.slice(i, end);
      out += src.startsWith(c.repeat(3), i) ? text.replace(/[^\n]/g, " ") : text;
      i = end - 1;
    } else if (c === "#") {
      while (i + 1 < src.length && src[i + 1] !== "\n") i += 1;
    } else {
      out += c;
    }
  }
  return out;
}

/** Every module of the engine, by walking it: a new package is read without anyone remembering to add it. */
function pyFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__pycache__" ? [] : pyFiles(full);
    return entry.name.endsWith(".py") ? [full] : [];
  });
}
const SOURCES = pyFiles(ENGINE).map((file) => ({
  rel: path.relative(ENGINE, file).split(path.sep).join("/"),
  code: codeOf(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")),
}));

/** The calls that write an audit row, and which argument carries the event type: a position, or the `event_type=`
 *  keyword (which wins wherever it is given). A wrapper is read only in the module that defines it — `_audit` is
 *  three different functions: tenant/router.py's takes a type; admin/router.py's takes a SUBJECT of the `admin`
 *  type (`user.update`, `ldap.test`, …, written through append_audit); scope/router.py's takes none. */
const WRITERS = [
  { call: "AuditEvent", arg: 1 },                                   // api/audit.py (tenant, event_type, patient_id, subject, payload)
  { call: "trail.record", arg: 2 },                                 // admission/trail.py record(request, hospital, event_type, …)
  { call: "append_audit", arg: null },                              // auth/audit.py: event_type is keyword-only
  { call: "_audit", arg: 2, file: "tenant/router.py" },             // the structure.* rows
  { call: "_state_written", arg: 6, file: "tenant/router.py" },     // Doluluk's four bed moves
  { call: "_event", arg: 1, file: "api/tasks.py" },                 // G3-02 «Görevlerim»
];

/** Where the type is a variable, the call cannot say which: each such variable is listed here by hand with the
 *  types it carries — [] for a wrapper's own parameter, whose callers are read through WRITERS. A listed type must
 *  still be written as a literal in that module, and every entry must still be met, so this list cannot go stale. */
const VARIABLES = {
  "admission/trail.py:event_type": [],     // record()'s parameter
  "auth/audit.py:event_type": [],          // append_audit()'s parameter
  "api/tasks.py:kind": [],                 // _event()'s parameter
  // `_audit` and `_state_written` pass their parameter on; a PATCH writes the rows `_changes()` builds — a rename,
  // and a close or a reopen chosen in a conditional expression.
  "tenant/router.py:event_type": ["structure.rename", "structure.close", "structure.reopen"],
  // `_audit`: kind = "device_bed.bind" if ask.bed_id is not None else "device_bed.unbind"
  "devicebeds/service.py:kind": ["device_bed.bind", "device_bed.unbind"],
};

/** A type the engine no longer writes keeps its label for the rows it wrote: list it here, with the version. */
const RETIRED = new Set([]);

/** The text of a call's arguments, from just after its "(" to its matching ")". */
function argsText(code, open) {
  let depth = 1;
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (c === '"' || c === "'") i = stringEnd(code, i) - 1;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) {
      depth -= 1;
      if (depth === 0) return code.slice(open, i);
    }
  }
  throw new Error("unbalanced call");
}

/** A call's top-level arguments, split on the commas between them (not on one inside a string or a bracket). */
function splitArgs(text) {
  const out = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'") i = stringEnd(text, i) - 1;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (c === "," && depth === 0) {
      out.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  const last = text.slice(from).trim();
  if (last) out.push(last);
  return out;
}

const STRING = String.raw`(?:"([^"\\\n]*)"|'([^'\\\n]*)')`;
const LITERAL = new RegExp(`^${STRING}$`);
const CONDITIONAL = new RegExp(`^${STRING}\\s+if\\s+.+\\s+else\\s+${STRING}$`, "s");
const literalOf = (m, at) => m[at] ?? m[at + 1];

/** A module's string constants: `NAME = "…"` and `A, B = "…", "…"`, at the start of a line. */
function constantsOf(code) {
  const out = new Map();
  for (const m of code.matchAll(/^([A-Z_][A-Z0-9_]*(?:\s*,\s*[A-Z_][A-Z0-9_]*)*)\s*=\s*(.+)$/gm)) {
    const names = m[1].split(",").map((s) => s.trim());
    const values = splitArgs(m[2]).map((v) => v.match(LITERAL));
    if (values.length === names.length && values.every(Boolean)) names.forEach((name, i) => out.set(name, literalOf(values[i], 1)));
  }
  return out;
}
const CONSTANTS = new Map(SOURCES.map(({ rel, code }) => [rel, constantsOf(code)]));

/** A constant's value: its own module's, else the one value every module that defines it agrees on (an import);
 *  never a guess between two. */
function constant(rel, name) {
  if (CONSTANTS.get(rel).has(name)) return CONSTANTS.get(rel).get(name);
  const found = new Set([...CONSTANTS.values()].filter((m) => m.has(name)).map((m) => m.get(name)));
  return found.size === 1 ? [...found][0] : null;
}

/** Every type the engine writes (with where it was read first), the variables met, and every argument the reader
 *  could not resolve. */
function readEngine() {
  const types = new Map();
  const met = new Set();
  const unread = [];
  const add = (type, where) => { if (!types.has(type)) types.set(type, where); };
  for (const { rel, code } of SOURCES) {
    for (const writer of WRITERS) {
      if (writer.file && writer.file !== rel) continue;
      const name = writer.call.replace(".", "\\.");
      for (const m of code.matchAll(new RegExp(`(?<![\\w.])${name}\\(`, "g"))) {
        if (/\bdef\s+$/.test(code.slice(Math.max(0, m.index - 8), m.index))) continue;       // its definition
        const where = `${rel}:${code.slice(0, m.index).split("\n").length}`;
        const args = splitArgs(argsText(code, m.index + m[0].length));
        const keyword = args.find((a) => /^event_type\s*=[^=]/.test(a));
        const expr = keyword ? keyword.replace(/^event_type\s*=\s*/, "") : writer.arg == null ? null : args[writer.arg];
        let hit;
        if (expr == null) unread.push(`${where} ${writer.call}: no event type found`);
        else if ((hit = expr.match(LITERAL))) add(literalOf(hit, 1), where);
        else if ((hit = expr.match(CONDITIONAL))) { add(literalOf(hit, 1), where); add(literalOf(hit, 3), where); }
        else if (/^[A-Z_][A-Z0-9_]*$/.test(expr) && constant(rel, expr) != null) add(constant(rel, expr), where);
        else if (/^[a-z_][a-z0-9_]*$/.test(expr) && `${rel}:${expr}` in VARIABLES) {
          met.add(`${rel}:${expr}`);
          for (const type of VARIABLES[`${rel}:${expr}`]) add(type, `${where} (${expr}, listed by hand)`);
        } else unread.push(`${where} ${writer.call}: ${expr}`);
      }
    }
  }
  return { types, met, unread };
}

const ENGINE_READ = readEngine();
const ENGINE_TYPES = new Set(ENGINE_READ.types.keys());

describe("the reader of the engine's audit writes", () => {
  it("reads a call's arguments across lines, past a bracket or a comma in a string, and no comment or docstring", () => {
    const sample = codeOf('f(AuditEvent(  # a comment (with an open bracket\n    slug, "scope", "", str(user_id),\n    {"by": "a, b)", "x": ("(", ")")}))\n"""AuditEvent(x, "not", it)"""\n');
    const open = sample.indexOf("AuditEvent(") + "AuditEvent(".length;
    expect(splitArgs(argsText(sample, open))).toEqual(["slug", '"scope"', '""', "str(user_id)", '{"by": "a, b)", "x": ("(", ")")}']);
    expect(sample.split("AuditEvent(")).toHaveLength(2);                                  // the docstring's is blanked
    expect('"structure.reopen" if is_active else "structure.close"'.match(CONDITIONAL)?.slice(1).filter(Boolean))
      .toEqual(["structure.reopen", "structure.close"]);
    expect(constantsOf(codeOf('A, B = "shadow_alert", "shadow_alert_cleared"\nRETRACT = "chart_retract"  # note\nX = f("no")\n')))
      .toEqual(new Map([["A", "shadow_alert"], ["B", "shadow_alert_cleared"], ["RETRACT", "chart_retract"]]));
  });

  it("finds every way the engine writes a type, and reads a subject of the `admin` type as no type", () => {
    for (const anchor of [
      "scope", "ack", "view",                                       // AuditEvent(…, "<type>", …), on one line and on several
      "auth", "admin",                                              // append_audit(…, event_type="<type>", …)
      "admission.admit", "protocol.settings", "bed.release",        // trail.record(request, hospital, "<type>", …)
      "structure.create", "structure.reopen", "structure.close",    // tenant/router.py _audit, and _changes() by hand
      "bed.reserve", "bed.return_to_service",                       // tenant/router.py _state_written
      "task_created", "task_settings_changed", "vital_skipped",     // api/tasks.py _event: literals and a constant
      "chart_retract", "reading_dropped_discharged",                // an imported constant
      "shadow_alert", "shadow_alert_cleared",                       // a tuple of constants
      "device_bed.bind", "device_bed.unbind", "device_bed.import",  // a variable by hand, a literal, the seed
    ]) expect(ENGINE_TYPES.has(anchor), anchor).toBe(true);
    for (const subject of ["user.update", "ldap.test", "login.ok", "group.create"]) expect(ENGINE_TYPES.has(subject), subject).toBe(false);
  });

  it("reads every write: an argument it cannot resolve is listed in VARIABLES by hand, with its types", () => {
    expect(ENGINE_READ.unread).toEqual([]);
  });

  it("meets every variable listed by hand, and each listed type is still written as a literal in its module", () => {
    expect(Object.keys(VARIABLES).filter((key) => !ENGINE_READ.met.has(key))).toEqual([]);
    for (const [key, types] of Object.entries(VARIABLES)) {
      const { code } = SOURCES.find((s) => s.rel === key.split(":")[0]);
      for (const type of types) expect(code.includes(`"${type}"`), `${key} ${type}`).toBe(true);
    }
  });
});

describe("a label for every type the engine writes (follow-up D3)", () => {
  const named = new Set(EVENT_TYPES.map((e) => e.code));

  it("names every type the engine writes", () => {
    const missing = [...ENGINE_READ.types].filter(([type]) => !named.has(type)).map(([type, where]) => `${type} (${where})`);
    expect(missing).toEqual([]);
  });

  it("names no type the engine does not write — a mistyped code would be a filter that never matches", () => {
    expect([...named].filter((code) => !ENGINE_TYPES.has(code) && !RETIRED.has(code))).toEqual([]);
  });
});

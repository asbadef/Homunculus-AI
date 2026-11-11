// engineTypes.test.js — G2-B4 follow-up D3 (spec 2026-11-11-g2b-b4-denetim-adlar-design.md): every audit event type
// the engine writes has a label on «Denetim bütünlüğü» and a place in its filter. The engine's sources are read as
// TEXT (never executed), as apiErrors.test.js reads them.
//
// What it guarantees. Every call that writes a row is found — AuditEvent(…) anywhere, and the functions declared in
// WRAPPERS that pass a type on to one — and its type argument is read as one of:
//   - a literal, or a conditional between two literals (`"a" if … else "b"`, with no string in its condition);
//   - a module constant (its own module's, or the one value every module defining it agrees on);
//   - a declared wrapper's own type parameter, inside that wrapper: its callers are then read instead;
//   - a variable its function assigns only plainly (`name = …`), from the forms above;
//   - a variable named in VARIABLES by module, function and name, whose types are read from the source.
// Anything else — a parameter of a function that is not a declared wrapper, a nested conditional, a variable bound in
// a loop or unpacked, a call — FAILS the test as unread rather than being skipped. So a new type, a new wrapper or a
// new way of choosing a type fails here until EVENT_TYPES names it (or this reader learns to read it). As a belt, in
// each module where a type comes through a variable, every literal with that module's type prefix must be a named
// type. A writer called under another name (an alias, a by-name import of trail's `record`) is refused outright.
// (Paths built with node:path: under jsdom the global URL is jsdom's, which fileURLToPath refuses.)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_TYPES } from "./denetim.js";
import { PERMISSION_KEYS } from "../admin/catalogue.js";

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

/** The text of a call's (or a signature's) arguments, from just after its "(" to its matching ")". */
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

const lineAt = (code, index) => code.slice(0, index).split("\n").length;          // 1-based
const indentOf = (line) => line.match(/^[ \t]*/)[0].length;

/** A module's functions: name, parameters (a bare `*` kept, so a keyword-only one can be told), and the lines of its
 *  body. A nested function lies inside its parent's lines; the innermost one encloses a call. */
function functionsOf(code) {
  const lines = code.split("\n");
  const out = [];
  for (const m of code.matchAll(/^([ \t]*)(?:async[ \t]+)?def[ \t]+(\w+)[ \t]*\(/gm)) {
    const open = m.index + m[0].length;
    const signature = argsText(code, open);
    const params = splitArgs(signature).map((p) => (p === "*" ? "*" : p.replace(/^\*+/, "").split(/[:=]/)[0].trim()));
    const first = lineAt(code, m.index);
    const bodyFrom = lineAt(code, open + signature.length) + 1;
    let last = lines.length;
    for (let n = bodyFrom; n <= lines.length; n += 1) {
      if (lines[n - 1].trim() && indentOf(lines[n - 1]) <= m[1].length) { last = n - 1; break; }
    }
    while (last > first && !lines[last - 1].trim()) last -= 1;                     // trailing blank lines are no one's
    out.push({ name: m[2], params, first, last, body: lines.slice(bodyFrom - 1, last).join("\n") });
  }
  return out;
}
const enclosing = (fns, line) => fns.filter((f) => f.first < line && line <= f.last)
  .reduce((inner, f) => (inner && inner.first > f.first ? inner : f), null);

/** Every module of the engine, by walking it: a new package is read without anyone remembering to add it. */
function pyFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__pycache__" ? [] : pyFiles(full);
    return entry.name.endsWith(".py") ? [full] : [];
  });
}
const SOURCES = pyFiles(ENGINE).map((file) => {
  const code = codeOf(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
  return { rel: path.relative(ENGINE, file).split(path.sep).join("/"), code, fns: functionsOf(code) };
});
const source = (rel) => SOURCES.find((s) => s.rel === rel);

/** The functions that pass a type on to a row, read at their callers: where each is defined, the parameter that
 *  carries the type, the name its callers use and the argument they pass it in (null: keyword-only, `event_type=`).
 *  `local`: called only in its own module, where the name means this function — `_audit` is three different
 *  functions: tenant/router.py's takes a type; admin/router.py's takes a SUBJECT of the `admin` type (`user.update`,
 *  `ldap.test`, …, written through append_audit); scope/router.py's takes none. */
const WRAPPERS = [
  { file: "admission/trail.py", def: "record", param: "event_type", call: "trail.record", arg: 2 },
  { file: "auth/audit.py", def: "append_audit", param: "event_type", call: "append_audit", arg: null },
  { file: "tenant/router.py", def: "_audit", param: "event_type", call: "_audit", arg: 2, local: true },             // structure.*
  { file: "tenant/router.py", def: "_state_written", param: "event_type", call: "_state_written", arg: 6, local: true },   // Doluluk
  { file: "api/tasks.py", def: "_event", param: "kind", call: "_event", arg: 1, local: true },                        // Görevlerim
];
const WRITERS = [{ call: "AuditEvent", arg: 1 }, ...WRAPPERS];

const STRING = String.raw`(?:"([^"\\\n]*)"|'([^'\\\n]*)')`;
const STRINGS = new RegExp(STRING, "g");
const LITERAL = new RegExp(`^${STRING}$`);
/** `"a" if cond else "b"`: two literals, a condition with no string and no other `else` in it. A nested conditional,
 *  or a condition that compares with a string, does not match — it is reported as unread, never half read. */
const CONDITIONAL = new RegExp(`^${STRING}\\s+if\\s+(?:(?!\\belse\\b)[^"'])+?\\s+else\\s+${STRING}$`, "s");
const literalOf = (m, at) => m[at] ?? m[at + 1];
const literalsIn = (text) => [...text.matchAll(STRINGS)].map((m) => literalOf(m, 1));

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

/** A value with no variable in it: a literal, a conditional between two, a module constant. Null otherwise. */
function valueOf(expr, rel) {
  let hit;
  if ((hit = expr.match(LITERAL))) return [literalOf(hit, 1)];
  if ((hit = expr.match(CONDITIONAL))) return [literalOf(hit, 1), literalOf(hit, 3)];
  if (/^[A-Z_][A-Z0-9_]*$/.test(expr) && constant(rel, expr) != null) return [constant(rel, expr)];
  return null;
}

const ASSIGNMENT = /^[ \t]*([\w \t,()*]+?)[ \t]*(\*\*|\/\/|>>|<<|[-+*/%|&^@])?=(?!=)[ \t]*(.*)$/gm;
const words = (text) => text.split(/\W+/).filter(Boolean);

/** A variable its function binds only by plain `name = <value>` statements: every value read, or the reason it is
 *  unread — no assignment at all, an unpacking or an augmented one, a loop, a `with`/`except … as`, a `:=`. */
function assignedIn(fn, name, rel) {
  const types = [];
  for (const m of fn.body.matchAll(ASSIGNMENT)) {
    if (!words(m[1]).includes(name)) continue;
    if (m[2] || m[1].trim() !== name) return { unread: `${name} is bound by «${m[0].trim()}»` };
    let rhs = m[3].trim();
    const at = m.index + m[0].length - m[3].length;
    if (rhs.startsWith("(")) {
      const inner = argsText(fn.body, at + 1);
      if (fn.body.slice(at + 1 + inner.length + 1).split("\n")[0].trim()) return { unread: `${name} = ${rhs}` };
      rhs = inner.trim();
    }
    const value = valueOf(rhs, rel);
    if (!value) return { unread: `${name} = ${rhs}` };
    types.push(...value);
  }
  for (const m of fn.body.matchAll(/\bfor[ \t]+([\w \t,()]*?)[ \t]+in\b/g)) {
    if (words(m[1]).includes(name)) return { unread: `${name} is a loop variable` };
  }
  if (new RegExp(`\\bas[ \\t]+${name}\\b|\\b${name}[ \\t]*:=|\\b(?:global|nonlocal)\\b[^\\n]*\\b${name}\\b`).test(fn.body)) {
    return { unread: `${name} is bound by a with, an except, a := or a global` };
  }
  return types.length ? { types } : { unread: `${name} is never assigned in ${fn.name}` };
}

/** A variable a loop takes from what a builder function returns — `for name, … in it:` after `it = builder(…)` — read
 *  from the builder: the first item of every tuple it appends (a literal, or a conditional between two), and every
 *  literal in it that starts with `prefix`. An appended item it cannot read is unread. */
const loopOver = (builder, prefix) => ({ rel, fn, name }) => {
  const loop = fn.body.match(new RegExp(`\\bfor[ \\t]+${name}[ \\t]*,[^\\n]*?[ \\t]in[ \\t]+(\\w+)[ \\t]*:`));
  if (!loop || !new RegExp(`\\b${loop[1]}[ \\t]*=[ \\t]*${builder}\\(`).test(fn.body)) {
    return { unread: `${name} in ${fn.name} is no longer a loop over ${builder}()` };
  }
  const def = source(rel).fns.find((f) => f.name === builder);
  if (!def) return { unread: `${builder}() is gone from ${rel}` };
  const types = [];
  for (const m of def.body.matchAll(/\.append\(/g)) {
    const item = argsText(def.body, m.index + m[0].length).trim();
    const first = item.startsWith("(") ? splitArgs(argsText(item, 1))[0] : null;
    const value = first == null ? null : valueOf(first, rel);
    if (!value) return { unread: `${builder}() appends ${item.split("\n")[0]}` };
    types.push(...value);
  }
  types.push(...literalsIn(def.body).filter((s) => s.startsWith(prefix)));
  return types.length ? { types } : { unread: `${builder}() names no «${prefix}» type` };
};

/** A variable the reader cannot follow on its own, named by module, FUNCTION and name — a new function is unread
 *  until it is named here — with how its types are read from the source (never a list typed by hand). */
const VARIABLES = {
  // A PATCH writes one row per change `_changes()` builds: a rename, and a close or a reopen.
  "tenant/router.py:patch_unit:event_type": loopOver("_changes", "structure."),
  "tenant/router.py:patch_room:event_type": loopOver("_changes", "structure."),
  "tenant/router.py:patch_bed:event_type": loopOver("_changes", "structure."),
};

/** The belt: in a module where a type comes through a variable, every literal with the module's type prefix is a
 *  type the page names (a permission key, `structure.manage`, excepted). Every such module must have one. */
const BELT = { "tenant/router.py": "structure.", "devicebeds/service.py": "device_bed." };

/** A type a writer's argument names: { types } or { unread } with the reason. */
function resolve(expr, ctx) {
  const value = valueOf(expr, ctx.rel);
  if (value) return { types: value };
  if (!/^[a-z_]\w*$/.test(expr)) return { unread: expr };
  if (!ctx.fn) return { unread: `${expr}, a module-level name` };
  const wrapper = WRAPPERS.find((w) => w.file === ctx.rel && w.def === ctx.fn.name && w.param === expr);
  if (wrapper) {
    ctx.passedOn.add(wrapper);
    return { types: [] };
  }
  const key = `${ctx.rel}:${ctx.fn.name}:${expr}`;
  if (!(key in VARIABLES) && ctx.fn.params.includes(expr)) {
    return { unread: `${expr} is a parameter of ${ctx.fn.name}, which is not a declared wrapper` };
  }
  ctx.viaVariable.add(ctx.rel);                                // this module's types come through a variable: belt it
  if (key in VARIABLES) {
    ctx.met.add(key);
    return VARIABLES[key]({ rel: ctx.rel, fn: ctx.fn, name: expr });
  }
  return assignedIn(ctx.fn, expr, ctx.rel);
}

/** Every type the engine writes (with where it was read first), and what the reader met and could not read. */
function readEngine() {
  const types = new Map();
  const shared = { met: new Set(), passedOn: new Set(), viaVariable: new Set() };
  const unread = [];
  for (const { rel, code, fns } of SOURCES) {
    for (const writer of WRITERS) {
      if (writer.local && writer.file !== rel) continue;
      for (const m of code.matchAll(new RegExp(`(?<!\\w)${writer.call.replace(".", "\\.")}\\(`, "g"))) {
        if (/\bdef\s+$/.test(code.slice(Math.max(0, m.index - 8), m.index))) continue;       // its definition
        const line = lineAt(code, m.index);
        const fn = enclosing(fns, line);
        const where = `${rel}:${line} ${fn ? fn.name : "<module>"}`;
        const args = splitArgs(argsText(code, m.index + m[0].length));
        const keyword = args.find((a) => /^event_type\s*=[^=]/.test(a));
        const expr = keyword ? keyword.replace(/^event_type\s*=\s*/, "") : writer.arg == null ? null : args[writer.arg];
        const read = expr == null ? { unread: "no event type argument" } : resolve(expr, { ...shared, rel, fn });
        if (read.unread) unread.push(`${where} ${writer.call}: ${read.unread}`);
        else for (const type of read.types) if (!types.has(type)) types.set(type, where);
      }
    }
  }
  return { types, unread, ...shared };
}

const ENGINE_READ = readEngine();
const ENGINE_TYPES = new Set(ENGINE_READ.types.keys());
const NAMED = new Set(EVENT_TYPES.map((e) => e.code));

/** A type the engine no longer writes keeps its label for the rows it wrote: list it here, with the version. */
const RETIRED = new Set([]);

describe("the reader of the engine's audit writes", () => {
  it("reads a call's arguments across lines, past a bracket or a comma in a string, and no comment or docstring", () => {
    const sample = codeOf('f(AuditEvent(  # a comment (with an open bracket\n    slug, "scope", "", str(user_id),\n    {"by": "a, b)", "x": ("(", ")")}))\n"""AuditEvent(x, "not", it)"""\n');
    const open = sample.indexOf("AuditEvent(") + "AuditEvent(".length;
    expect(splitArgs(argsText(sample, open))).toEqual(["slug", '"scope"', '""', "str(user_id)", '{"by": "a, b)", "x": ("(", ")")}']);
    expect(sample.split("AuditEvent(")).toHaveLength(2);                                  // the docstring's is blanked
    expect(constantsOf(codeOf('A, B = "shadow_alert", "shadow_alert_cleared"\nRETRACT = "chart_retract"  # note\nX = f("no")\n')))
      .toEqual(new Map([["A", "shadow_alert"], ["B", "shadow_alert_cleared"], ["RETRACT", "chart_retract"]]));
  });

  it("reads a conditional between two literals, and refuses a nested one or one whose condition holds a string", () => {
    expect(valueOf('"structure.reopen" if is_active else "structure.close"', "x")).toEqual(["structure.reopen", "structure.close"]);
    for (const half of ['"a" if x else ("b" if y else "c")', '"a" if x else "b" if y else "c"', '"a" if x == "y" else "b"', "kind", "f(x)"]) {
      expect(valueOf(half, "x"), half).toBeNull();
    }
  });

  it("knows a call's innermost function, and reads a variable only from plain assignments of values", () => {
    const code = codeOf([
      "def outer(a, *, b=1):",
      "    def inner(kind):",
      "        audit.append(AuditEvent(h, kind))",
      "    kind = \"x.one\" if a else \"x.two\"",
      "    nested = \"x.a\" if a else (\"x.b\" if b else \"x.c\")",
      "    for looped, _ in pairs:",
      "        pass",
      "    a, unpacked = 1, \"x.d\"",
      "    grown = \"x.e\"",
      "    grown += \"f\"",
      "",
      "def after():",
      "    pass",
    ].join("\n"));
    const fns = functionsOf(code);
    expect(fns.map((f) => [f.name, f.first, f.last, f.params])).toEqual([
      ["outer", 1, 10, ["a", "*", "b"]], ["inner", 2, 3, ["kind"]], ["after", 12, 13, []]]);
    expect(enclosing(fns, 3).name).toBe("inner");
    expect(enclosing(fns, 4).name).toBe("outer");
    const outer = fns[0];
    expect(assignedIn(outer, "kind", "x")).toEqual({ types: ["x.one", "x.two"] });
    for (const name of ["nested", "looped", "unpacked", "grown", "missing"]) expect(assignedIn(outer, name, "x").unread, name).toBeTruthy();
  });

  it("finds every way the engine writes a type, and reads a subject of the `admin` type as no type", () => {
    for (const anchor of [
      "scope", "ack", "view",                                       // AuditEvent(…, "<type>", …), on one line and on several
      "auth", "admin",                                              // append_audit(…, event_type="<type>", …)
      "admission.admit", "protocol.settings", "bed.release",        // trail.record(request, hospital, "<type>", …)
      "structure.create",                                           // tenant/router.py _audit
      "structure.rename", "structure.reopen", "structure.close",    // a PATCH's loop over _changes()
      "bed.reserve", "bed.return_to_service",                       // tenant/router.py _state_written
      "task_created", "task_settings_changed", "vital_skipped",     // api/tasks.py _event: literals and a constant
      "chart_retract", "reading_dropped_discharged",                // an imported constant
      "shadow_alert", "shadow_alert_cleared",                       // a tuple of constants
      "device_bed.bind", "device_bed.unbind",                       // devicebeds/service.py: kind = "…" if … else "…"
      "device_bed.import",                                          // the seed
    ]) expect(ENGINE_TYPES.has(anchor), anchor).toBe(true);
    for (const subject of ["user.update", "ldap.test", "login.ok", "group.create"]) expect(ENGINE_TYPES.has(subject), subject).toBe(false);
  });

  it("reads every write: an argument it cannot read fails here, it is never skipped", () => {
    expect(ENGINE_READ.unread).toEqual([]);
  });

  it("declares only wrappers that exist, take the type where their callers pass it, and pass it on", () => {
    for (const w of WRAPPERS) {
      const fn = source(w.file).fns.find((f) => f.name === w.def);
      expect(fn, `${w.file} ${w.def}`).toBeTruthy();
      const at = fn.params.indexOf(w.param);
      const star = fn.params.indexOf("*");
      if (w.arg == null) expect(star >= 0 && at > star, `${w.def}: ${w.param} keyword-only`).toBe(true);
      else expect([at, star < 0 || at < star], `${w.def}: ${w.param} at ${w.arg}`).toEqual([w.arg, true]);
      expect(ENGINE_READ.passedOn.has(w), `${w.def} passes ${w.param} on`).toBe(true);
    }
  });

  it("meets every variable named in VARIABLES", () => {
    expect(Object.keys(VARIABLES).filter((key) => !ENGINE_READ.met.has(key))).toEqual([]);
  });

  it("finds every writer by the name it scans: no alias, no by-name import of trail's record or of a local wrapper", () => {
    const local = WRAPPERS.filter((w) => w.local);
    for (const { rel, code } of SOURCES) {
      expect(code, rel).not.toMatch(/\bimport\b[^\n]*\b(?:AuditEvent|append_audit|trail|record)[ \t]+as\b/);
      expect(code, rel).not.toMatch(/\bfrom[ \t]+homunculus\.admission\.trail[ \t]+import\b/);
      expect(code, rel).not.toMatch(/\btrail\.record\b(?!\()/);
      for (const w of local.filter((x) => x.file !== rel)) {
        const dotted = `homunculus.${w.file.replace(/\.py$/, "").split("/").join(".")}`.replace(/\./g, "\\.");
        for (const m of code.matchAll(new RegExp(`\\bfrom[ \\t]+${dotted}[ \\t]+import[ \\t]+(\\([^)]*\\)|[^\\n]*)`, "g"))) {
          expect(words(m[1]), `${rel} imports ${w.def}`).not.toContain(w.def);
        }
      }
    }
  });
});

describe("a label for every type the engine writes (follow-up D3)", () => {
  it("names every type the engine writes", () => {
    const missing = [...ENGINE_READ.types].filter(([type]) => !NAMED.has(type)).map(([type, where]) => `${type} (${where})`);
    expect(missing).toEqual([]);
  });

  it("names no type the engine does not write — a mistyped code would be a filter that never matches", () => {
    expect([...NAMED].filter((code) => !ENGINE_TYPES.has(code) && !RETIRED.has(code))).toEqual([]);
  });

  it("the belt: where a type comes through a variable, every literal with the module's type prefix is a named type", () => {
    expect([...ENGINE_READ.viaVariable].filter((rel) => !(rel in BELT))).toEqual([]);
    const permissions = new Set(PERMISSION_KEYS);
    for (const [rel, prefix] of Object.entries(BELT)) {
      const loose = literalsIn(source(rel).code).filter((s) => s.startsWith(prefix) && !NAMED.has(s) && !permissions.has(s));
      expect(loose, rel).toEqual([]);
    }
  });
});

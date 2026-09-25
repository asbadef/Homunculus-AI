// dashboard/src/permissions.test.js
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PERMISSION_KEYS, DEFAULT_GROUPS, DEMO_ROLE_TO_GROUP,
  permsForRole, hasPerm, hasAny, uiRoleFromPerms,
} from "./permissions.js";
import { createDemoStore, buildRealisticState, ROLE } from "./clinicalDemo.js";

describe("permission keys", () => {
  it("mirrors the backend catalogue (19 keys)", () => {
    expect(PERMISSION_KEYS).toHaveLength(19);
    expect(PERMISSION_KEYS).toContain("board.view");
    expect(PERMISSION_KEYS).toContain("devices.manage");
  });

  it("gives each demo role the spec's default set", () => {
    expect(permsForRole("HOSPITAL_ADMIN")).toEqual(PERMISSION_KEYS);
    expect(permsForRole("ATTENDING")).toContain("admissions.sign_off");
    expect(permsForRole("ATTENDING")).toContain("care_team.assign");
    expect(permsForRole("CHARGE_NURSE")).toContain("admissions.admit");
    expect(permsForRole("CHARGE_NURSE")).not.toContain("admissions.sign_off");
    expect(permsForRole("RRT")).toContain("alerts.escalate");
    expect(permsForRole("PHARMACIST")).toEqual(["board.view", "admissions.view"]);
    expect(permsForRole("BIOMEDICAL")).toEqual(["devices.manage"]);
    expect(permsForRole("NOPE")).toEqual([]);
    expect(permsForRole("constructor")).toEqual([]);   // no prototype keys
  });

  it("maps every demo role to a default group", () => {
    expect(Object.keys(DEMO_ROLE_TO_GROUP).sort()).toEqual(Object.values(ROLE).sort());
  });

  it("returns a copy, so a caller cannot change the shared table", () => {
    const perms = permsForRole("PHARMACIST");
    perms.push("users.manage");
    expect(permsForRole("PHARMACIST")).toEqual(["board.view", "admissions.view"]);
  });

  it("hasPerm / hasAny fail closed on bad input", () => {
    expect(hasPerm(["board.view"], "board.view")).toBe(true);
    expect(hasPerm(null, "board.view")).toBe(false);
    expect(hasAny(["alerts.ack"], ["alerts.ack", "alerts.escalate"])).toBe(true);
    expect(hasAny(["board.view"], ["alerts.ack"])).toBe(false);
    expect(hasAny(undefined, ["alerts.ack"])).toBe(false);
    expect(hasAny([], null)).toBe(true);           // no requirement = open
  });

  it("derives a display role from permissions, most privileged first", () => {
    expect(uiRoleFromPerms(["users.manage", "board.view"])).toBe(ROLE.HOSPITAL_ADMIN);
    expect(uiRoleFromPerms(["admissions.sign_off"])).toBe(ROLE.ATTENDING);
    expect(uiRoleFromPerms(["admissions.admit"])).toBe(ROLE.CHARGE_NURSE);
    expect(uiRoleFromPerms(["alerts.escalate"])).toBe(ROLE.RRT);
    expect(uiRoleFromPerms(["devices.manage"])).toBe(ROLE.BIOMEDICAL);
    expect(uiRoleFromPerms(["admissions.view"])).toBe(ROLE.PHARMACIST);
    expect(uiRoleFromPerms([])).toBeNull();
  });
});

describe("demo sessions carry perms", () => {
  it("loginAs attaches the role's permissions to the session user", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.CHARGE_NURSE);
    expect(store.getState().user.perms).toContain("admissions.admit");
    expect(store.getState().user.perms).not.toContain("users.manage");
  });

  it("a PIN switch re-derives perms for the new user", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.CHARGE_NURSE);
    store.switchUserByPin("9999");           // Sistem Yöneticisi
    expect(store.getState().user.perms).toContain("users.manage");
  });
});

// ------------------------------------------------------------ parity with the backend catalogue
// permissions.py is the source of truth. It is read as TEXT, never executed, by a small reader for
// the Python subset the catalogue is written in: string literals (adjacent ones concatenate),
// True/False/None, dicts, tuples, lists, module-level names, tuple(EXPR) and
// tuple(x for x in EXPR if [not] x.startswith("…")). Whitespace, line breaks, comments and trailing
// commas do not matter. Any other syntax fails loudly with the line number, never silently.
// (Built with node:path: under jsdom the global URL is jsdom's, which fileURLToPath refuses.)
const PERMISSIONS_PY = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../../homunculus-engine/src/homunculus/auth/permissions.py");

const READER_HELP = "The parity reader in dashboard/src/permissions.test.js understands string, "
  + "True/False/None, dict, tuple and list literals, module-level names, tuple(EXPR) and "
  + "tuple(x for x in EXPR if [not] x.startswith(\"…\")); extend it for the new syntax.";

function readPython(src) {
  const toks = [];
  const re = /(\s+|#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|([A-Za-z_]\w*)|(\S)/g;
  for (const m of src.matchAll(re)) {
    if (m[1] !== undefined) continue;
    const lineStart = m.index === 0 || src[m.index - 1] === "\n";
    if (m[2] !== undefined) {
      const q = m[2].startsWith('"""') || m[2].startsWith("'''") ? 3 : 1;
      toks.push({ kind: "str", v: m[2].slice(q, -q), at: m.index, lineStart });
    } else {
      toks.push({ kind: m[3] !== undefined ? "name" : "op", v: m[3] ?? m[4], at: m.index, lineStart });
    }
  }
  const isOp = (t, v) => t?.kind === "op" && t.v === v;
  const isName = (t, v) => t?.kind === "name" && t.v === v;

  // Module-level assignments: `NAME = …` or `NAME: annotation = …`, starting in column 0.
  const defs = new Map();
  toks.forEach((t, i) => {
    if (t.kind !== "name" || !t.lineStart) return;
    let j = i + 1;
    if (isOp(toks[j], ":")) while (toks[j] && !toks[j].lineStart && !isOp(toks[j], "=")) j++;
    if (isOp(toks[j], "=") && !toks[j].lineStart) defs.set(t.v, j + 1);
  });

  let pos = 0;
  const fail = (what) => {
    const t = toks[pos];
    const where = t ? `line ${src.slice(0, t.at).split("\n").length} near ${JSON.stringify(t.v)}` : "end of file";
    throw new Error(`permissions.py, ${where}: ${what}. ${READER_HELP}`);
  };
  const eat = (v) => { if (!isOp(toks[pos], v)) fail(`expected "${v}"`); pos++; };
  const eatName = (v) => { if (!isName(toks[pos], v)) fail(`expected "${v}"`); pos++; };

  const cache = new Map();
  function resolve(name) {
    if (!cache.has(name)) {
      if (!defs.has(name)) fail(`no module-level assignment to ${name}`);
      const saved = pos;
      pos = defs.get(name);
      cache.set(name, expr());
      pos = saved;
    }
    return cache.get(name);
  }
  function keysOf(v) {
    if (v instanceof Map) return [...v.keys()];
    if (Array.isArray(v)) return v;
    return fail("tuple() of something that is not a dict, tuple or list");
  }
  function expr() {
    const t = toks[pos];
    if (t?.kind === "str") {
      let s = "";
      while (toks[pos]?.kind === "str") s += toks[pos++].v;
      return s;
    }
    if (isOp(t, "{")) return dict();
    if (isOp(t, "(") || isOp(t, "[")) return seq();
    if (t?.kind !== "name") return fail("unsupported syntax");
    if (["True", "False", "None"].includes(t.v)) { pos++; return { True: true, False: false, None: null }[t.v]; }
    if (isOp(toks[pos + 1], "(")) {
      if (t.v !== "tuple") return fail(`unsupported call ${t.v}(…)`);
      pos++;
      return tupleCall();
    }
    pos++;
    return resolve(t.v);
  }
  function dict() {
    eat("{");
    const out = new Map();
    while (!isOp(toks[pos], "}")) {
      const key = expr();
      eat(":");
      out.set(key, expr());
      if (isOp(toks[pos], ",")) pos++; else break;
    }
    eat("}");
    return out;
  }
  function seq() {
    const close = toks[pos].v === "(" ? ")" : "]";
    pos++;
    const items = [];
    let comma = false;
    while (!isOp(toks[pos], close)) {
      items.push(expr());
      if (isOp(toks[pos], ",")) { pos++; comma = true; } else break;
    }
    eat(close);
    return close === ")" && items.length === 1 && !comma ? items[0] : items;   // (x) is just x
  }
  function tupleCall() {
    eat("(");
    let items;
    if (toks[pos]?.kind === "name" && isName(toks[pos + 1], "for")) {
      const v = toks[pos].v;
      pos += 2;
      eatName(v);
      eatName("in");
      items = keysOf(expr());
      if (isName(toks[pos], "if")) {
        pos++;
        const negate = isName(toks[pos], "not");
        if (negate) pos++;
        eatName(v); eat("."); eatName("startswith"); eat("(");
        const prefix = expr();
        if (typeof prefix !== "string") fail("startswith() needs a string");
        eat(")");
        items = items.filter((k) => k.startsWith(prefix) !== negate);
      }
    } else {
      items = keysOf(expr());
    }
    eat(")");
    return items;
  }
  return { resolve };
}

const isStr = (v) => typeof v === "string";
const isBool = (v) => typeof v === "boolean";
const isStrList = (v) => Array.isArray(v) && v.every(isStr);

function backendCatalogue() {
  let src;
  try {
    src = fs.readFileSync(PERMISSIONS_PY, "utf8");
  } catch (e) {
    throw new Error(`cannot read the backend catalogue at ${PERMISSIONS_PY} (${e.code}); `
      + "this test needs the whole repository, not dashboard/ alone");
  }
  const py = readPython(src);
  const perms = py.resolve("PERMISSIONS");
  if (!(perms instanceof Map)) throw new Error("permissions.py: PERMISSIONS is not a dict");
  const groups = py.resolve("DEFAULT_GROUPS");
  if (!Array.isArray(groups)) throw new Error("permissions.py: DEFAULT_GROUPS is not a tuple");
  const legacy = py.resolve("LEGACY_ROLE_TO_GROUP");
  if (!(legacy instanceof Map)) throw new Error("permissions.py: LEGACY_ROLE_TO_GROUP is not a dict");
  return {
    keys: [...perms.keys()],
    groups: groups.map((g, i) => {
      const get = (k, ok) => {
        const v = g instanceof Map ? g.get(k) : undefined;
        if (!ok(v)) throw new Error(`permissions.py: DEFAULT_GROUPS[${i}] has no well-formed "${k}"`);
        return v;
      };
      return {
        slug: get("slug", isStr),
        mfaRequired: get("mfa_required", isBool),
        isSystem: get("is_system", isBool),
        permissions: get("permissions", isStrList),
      };
    }),
    legacy: Object.fromEntries(legacy),
  };
}

describe("parity reader", () => {
  it("is indifferent to formatting", () => {
    const { resolve } = readPython([
      "K: dict[str, str] = {",
      "    'a.one': 'x',  # comment",
      '    "a.two":',
      '        "long " "text",',
      "}",
      "BASE = ('a.one', 'b.one',)",
      "G = ({'k': tuple(K), 'm': True},",
      "     {'k': tuple(p for p in BASE if not p.startswith('b.'))})",
    ].join("\n"));
    expect(resolve("K")).toEqual(new Map([["a.one", "x"], ["a.two", "long text"]]));
    expect(resolve("G")).toEqual([new Map([["k", ["a.one", "a.two"]], ["m", true]]),
                                  new Map([["k", ["a.one"]]])]);
  });

  it("fails loudly, naming the line, on syntax it does not understand", () => {
    const { resolve } = readPython("X = 1\nY = sorted(X)\n");
    expect(() => resolve("Y")).toThrow(/line 2 near "sorted": unsupported call sorted/);
  });
});

describe("frontend catalogue = backend catalogue (auth/permissions.py)", () => {
  let cached;
  const backend = () => (cached ??= backendCatalogue());   // read inside the tests, so a failure is reported per test

  it("PERMISSION_KEYS equals PERMISSIONS, in order", () => {
    expect(PERMISSION_KEYS, "dashboard PERMISSION_KEYS drifted from permissions.py PERMISSIONS")
      .toEqual(backend().keys);
  });

  it("DEFAULT_GROUPS equals the backend's: slug, MFA flag, system flag and rights, in order", () => {
    expect(backend().groups).toHaveLength(11);
    expect(DEFAULT_GROUPS, "dashboard DEFAULT_GROUPS drifted from permissions.py DEFAULT_GROUPS")
      .toEqual(backend().groups);
  });

  it("the demo roles land in the group the migration gives the same legacy role", () => {
    const { legacy, groups } = backend();
    const shared = Object.keys(DEMO_ROLE_TO_GROUP).filter((r) => r in legacy);
    expect(shared.length).toBeGreaterThan(0);
    for (const role of shared) {
      expect(DEMO_ROLE_TO_GROUP[role], `demo role ${role}`).toBe(legacy[role]);
    }
    const slugs = groups.map((g) => g.slug);
    for (const slug of Object.values(DEMO_ROLE_TO_GROUP)) expect(slugs).toContain(slug);
  });
});

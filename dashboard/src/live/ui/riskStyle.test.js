// Roadmap G1-09 acceptance: the engine's risk values are mapped explicitly — moderate amber,
// none/info neutral ("no finding / not measured") — and none of them falls back to green.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { riskStyle, ENGINE_RISKS } from "./riskStyle.js";
import { DICTIONARIES } from "../i18n/catalog.js";
import { LANG_CODES } from "../i18n/langs.js";

describe("riskStyle", () => {
  it.each([
    ["critical", "crit", "risk.critical"],
    ["high", "high", "risk.high"],
    ["moderate", "mid", "risk.moderate"],
    ["low", "low", "risk.low"],
    ["info", "neutral", "risk.info"],
    ["none", "neutral", "risk.none"],
  ])("maps %s to the %s tone, on a measured card", (risk, tone, labelKey) => {
    expect(riskStyle(risk, { measured: true })).toMatchObject({ tone, labelKey });
  });

  it("knows exactly the engine's six levels", () => {
    expect([...ENGINE_RISKS].sort()).toEqual(["critical", "high", "info", "low", "moderate", "none"]);
  });

  it("never falls back to green", () => {
    const anything = [...ENGINE_RISKS, "stable", "ok", "", null, undefined, "CRITICAL", 3];
    for (const risk of anything) {
      expect(riskStyle(risk).tone, String(risk)).not.toBe("ok");
      expect(riskStyle(risk, { measured: false }).tone, String(risk)).not.toBe("ok");
    }
  });

  it("says 'not measured' instead of 'no finding' when nothing was measured", () => {
    expect(riskStyle("none", { measured: false })).toMatchObject({ tone: "neutral", labelKey: "risk.unmeasured" });
  });

  // "info" is an alert's severity: an info-level alert exists, so there is an observation behind
  // it and "not measured" would be false.
  it("reads 'info' as Info whatever `measured` says", () => {
    for (const measured of [undefined, false, true, null, "true"]) {
      expect(riskStyle("info", { measured }), String(measured)).toEqual({ tone: "neutral", icon: "eye", labelKey: "risk.info" });
    }
    expect(riskStyle("info")).toMatchObject({ labelKey: "risk.info" });
  });

  // Clinical safety: an identity-only card (admitted, never measured) gets risk "none" from the
  // engine. "No finding" is a claim about observations, so only a caller that has them may make it.
  it("claims 'no finding' only when told explicitly that the card was measured", () => {
    expect(riskStyle("none")).toMatchObject({ tone: "neutral", labelKey: "risk.unmeasured" });
    expect(riskStyle("none", {})).toMatchObject({ labelKey: "risk.unmeasured" });
    for (const measured of [undefined, null, 1, "true", "yes", {}, []]) {
      expect(riskStyle("none", { measured }).labelKey, String(measured)).toBe("risk.unmeasured");
    }
    expect(riskStyle("none", { measured: true }).labelKey).toBe("risk.none");
  });

  it("never lets 'not measured' hide a real finding", () => {
    expect(riskStyle("high", { measured: false })).toMatchObject({ tone: "high", labelKey: "risk.high" });
    for (const risk of ["critical", "high", "moderate", "low"]) {
      expect(riskStyle(risk).labelKey, risk).toBe(`risk.${risk}`);
    }
  });

  it("reads the engine's value case- and space-insensitively", () => {
    expect(riskStyle("CRITICAL")).toMatchObject({ tone: "crit", labelKey: "risk.critical" });
    expect(riskStyle(" High ")).toMatchObject({ tone: "high", labelKey: "risk.high" });
    expect(riskStyle("Moderate" + String.fromCharCode(10))).toMatchObject({ tone: "mid", labelKey: "risk.moderate" });
    expect(riskStyle(" None", { measured: true })).toMatchObject({ labelKey: "risk.none" });
    expect(riskStyle("NONE")).toMatchObject({ labelKey: "risk.unmeasured" });
  });

  it.each([null, undefined, "", "   "])(
    "draws attention, never calm, when the engine sent no risk at all (%j)",
    (risk) => {
      for (const measured of [undefined, true, false]) {
        expect(riskStyle(risk, { measured })).toEqual({ tone: "att", icon: "alert", labelKey: "risk.unreported" });
      }
    },
  );

  it("keeps an unrecognised value visible, with its raw text, in the attention look", () => {
    expect(riskStyle("stable")).toEqual({
      tone: "att", icon: "alert", labelKey: "risk.unknown", labelVars: { value: "stable" },
    });
    expect(riskStyle("severe", { measured: true })).toMatchObject({ tone: "att", labelVars: { value: "severe" } });
    expect(riskStyle(3)).toMatchObject({ tone: "att", labelVars: { value: "3" } });
  });

  // The engine sends a string. Anything else is shown as unknown — never coerced into a level
  // (String(["high"]) is "high") and never by calling the value's own toString, which an object
  // may lack (a null-prototype object makes String() throw) or override.
  it("never coerces a value that is not a string into a level", () => {
    const lying = { toString: () => "critical" };
    for (const risk of [["high"], ["none"], [], {}, lying, Object.create(null), true, Symbol("high")]) {
      const style = riskStyle(risk, { measured: true });
      expect(style, String(typeof risk)).toMatchObject({ tone: "att", icon: "alert", labelKey: "risk.unknown" });
      expect(typeof style.labelVars.value).toBe("string");
    }
    expect(riskStyle(["high"]).labelVars.value).toBe("[object Array]");
    expect(riskStyle(Object.create(null)).labelVars.value).toBe("[object Object]");
    expect(riskStyle(lying).labelVars.value).toBe("[object Object]");
  });

  it("does not take inherited names for engine levels", () => {
    for (const risk of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(riskStyle(risk), risk).toMatchObject({ tone: "att", labelKey: "risk.unknown", labelVars: { value: risk } });
    }
  });

  it("is never neutral grey for a value it cannot vouch for", () => {
    for (const risk of [null, undefined, "", "stable", "ok", "green", "severe", 0, 3, "constructor"]) {
      expect(riskStyle(risk).tone, String(risk)).toBe("att");
      expect(riskStyle(risk, { measured: true }).tone, String(risk)).toBe("att");
    }
  });

  it("names every label in all four languages", () => {
    const keys = [...ENGINE_RISKS.map((r) => riskStyle(r).labelKey), "risk.none", "risk.unmeasured", "risk.unknown", "risk.unreported"];
    for (const lang of LANG_CODES) for (const key of keys) expect(DICTIONARIES[lang][key], `${lang} ${key}`).toBeTruthy();
  });
});


// ------------------------------------------------------------------ engine contract
// The engine's levels, read from its sources as TEXT (never executed) — the permissions parity
// test's pattern. Alert severities are reco/engine.py's _SEVERITY_NAME; the board's risk is the
// highest of them by api/board.py's _SEVERITY_ORDER, or "none" (_risk). A level added there
// fails here until riskStyle maps it, instead of reaching a ward as "unknown risk".
// (node:path, not new URL(): under jsdom the global URL is jsdom's, which fileURLToPath refuses.)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, "../../../../homunculus-engine/src/homunculus");

function py(rel) {
  try {
    return fs.readFileSync(path.join(ENGINE, rel), "utf8");
  } catch (e) {
    throw new Error(`cannot read ${rel} under ${ENGINE} (${e.code}); `
      + "this test needs the whole repository, not dashboard/ alone");
  }
}

const quoted = (text) => [...text.matchAll(/["'](\w+)["']/g)].map((m) => m[1]);

/** The levels the engine can put on a board card, from the two modules' source text. */
function engineLevels(recoSrc, boardSrc) {
  const names = /^_SEVERITY_NAME\b[^=\n]*=\s*\{([^}]*)\}/m.exec(recoSrc);
  if (!names) throw new Error("reco/engine.py has no module-level _SEVERITY_NAME = {…}");
  const order = /^_SEVERITY_ORDER\b[^=\n]*=\s*\[([^\]]*)\]/m.exec(boardSrc);
  if (!order) throw new Error("api/board.py has no module-level _SEVERITY_ORDER = […]");
  const risk = /^def _risk\b[^\n]*\n((?:[ \t]+[^\n]*\n|[ \t]*\n)*)/m.exec(boardSrc);
  if (!risk) throw new Error("api/board.py has no def _risk(…)");
  return {
    named: [...names[1].matchAll(/:\s*["'](\w+)["']/g)].map((m) => m[1]),
    order: quoted(order[1]),
    empty: [...risk[1].matchAll(/return\s+["'](\w+)["']/g)].map((m) => m[1]),
  };
}

describe("engine contract", () => {
  it("the reader sees a level added to the engine", () => {
    const reco = '_SEVERITY_NAME = {\n    Severity.INFO: "info", Severity.URGENT: "urgent",\n}\n';
    const board = '_SEVERITY_ORDER: list[str] = ["info", \'urgent\']\n\n\n'
      + "def _risk(alerts: list[Alert]) -> str:\n"
      + '    if not alerts:\n        return "none"\n\n    return max(alerts)\n\n\ndef other():\n    return "x"\n';
    expect(engineLevels(reco, board)).toEqual({ named: ["info", "urgent"], order: ["info", "urgent"], empty: ["none"] });
  });

  const { named, order, empty } = engineLevels(py("reco/engine.py"), py("api/board.py"));

  it("reads the engine's levels: _risk answers \"none\" when there is no alert", () => {
    expect(named.length).toBeGreaterThan(0);
    expect(empty).toEqual(["none"]);
  });

  it("the board orders exactly the severities the alert engine emits", () => {
    expect([...order].sort()).toEqual([...named].sort());
  });

  it("riskStyle maps exactly \"none\" and the engine's severities", () => {
    expect([...ENGINE_RISKS].sort()).toEqual([...new Set([...empty, ...order])].sort());
  });
});

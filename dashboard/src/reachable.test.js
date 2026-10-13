// Every module under src/ is one the page can reach, and nothing is kept that it cannot.
//
// This project's own name for its worst recurring failure is "written, tested, never connected"
// (patientScope.js says it of itself: an assignment matrix that existed for years and changed no
// screen). Thirteen modules were in exactly that state when G1-16 began — each with a green test
// file, none reachable from the page — and the demo's removal would have added two dozen more had
// it deleted only the files it named. A module the page cannot import is not part of the product,
// however green its tests: it is either wired in, or it is deleted (git keeps it).
//
// The walk starts where the browser does — index.html loads main.jsx and nothing else — and
// follows every import the shared reader can see (live/imports.testutil.js, the one boundaries.test.js
// and routing.test.js use): static, re-exported, side-effect-only and `import("…")`. Anything it
// cannot follow fails here, as there: an import this test cannot see is a module it cannot vouch for.
// Tests and test utilities are not the product and are not walked or required.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importsOf } from "./live/imports.testutil.js";

const SRC = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(SRC, "main.jsx");
const rel = (file) => path.relative(SRC, file).split(path.sep).join("/");
const isProduct = (name) => /\.(js|jsx)$/.test(name) && !/\.test\.|\.testutil\./.test(name) && name !== "setupTests.js";

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return isProduct(entry.name) ? [full] : [];
  });
}

/** Every product module the page reaches from `entry`, and what the walk could not follow. */
function walk(entry) {
  const reached = new Set();
  const problems = [];
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    const { specs, unreadable } = importsOf(fs.readFileSync(file, "utf8"));
    for (const what of unreadable) problems.push(`${rel(file)} -> ${what} (cannot be followed)`);
    for (const spec of specs) {
      if (!spec.startsWith(".")) continue;                       // a package
      const target = path.resolve(path.dirname(file), spec);
      if (!/\.(js|jsx)$/.test(target)) continue;                 // a stylesheet, an asset
      if (!fs.existsSync(target)) problems.push(`${rel(file)} -> ${spec} (no such file)`);
      else stack.push(target);
    }
  }
  return { reached, problems };
}

describe("the page reaches every module under src/", () => {
  const { reached, problems } = walk(ENTRY);

  it("can follow every import from main.jsx", () => {
    expect(problems).toEqual([]);
  });

  it("finds the page's own modules", () => {
    expect(reached.size).toBeGreaterThan(80);
    expect([...reached].map(rel)).toEqual(expect.arrayContaining(["main.jsx", "live/LiveApp.jsx", "backendApi.js"]));
  });

  it("keeps no module the page cannot reach", () => {
    expect(sources(SRC).filter((file) => !reached.has(file)).map(rel).sort()).toEqual([]);
  });
});

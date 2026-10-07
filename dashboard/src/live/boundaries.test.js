// Roadmap D1: the new shell does not rest on the demo. Nothing under src/live/ may import the old
// workspace — ClinicalDemo.jsx, clinicalDemo.js, liveStore.js (built over the simulation),
// clinicalI18n.js, ui.jsx… — so G1-16 can delete it without touching a line here. What it may use
// from outside is the framework-free client of the real API: listed below, nothing else.
// (Tests may read more — permissions.js for the catalogue — so test files are not checked.)
//
// Every way a module can pull another in is read: `import … from`, `export … from`, a bare
// `import "x"` (side effects only), each over several lines, and `import("x")`. What cannot be
// followed by reading — `import(` with anything but a quoted path, `import.meta.glob` — fails
// here outright: an import this test cannot see is an import it cannot check.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIVE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.dirname(LIVE);
const ALLOWED = new Set(["backendApi.js", "liveAuth.js", "liveAdapters.js", "liveConnection.js"]);

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(js|jsx)$/.test(entry.name) && !/\.test\.|\.testutil\./.test(entry.name) ? [full] : [];
  });
}

const STATIC = /(?:^|[;}\s])(?:import|export)(?:\s+[^;'"`]*?\bfrom\s*|\s*)["']([^"']+)["']/g;
const DYNAMIC = /\bimport\s*\(\s*(?:["']([^"']+)["']\s*\))?/g;

/** What a source imports ({specs}), and what it pulls in that reading cannot follow ({unreadable}). */
export function importsOf(text) {
  const specs = [...text.matchAll(STATIC)].map((m) => m[1]);
  const unreadable = [];
  for (const m of text.matchAll(DYNAMIC)) {
    if (m[1]) specs.push(m[1]);
    else unreadable.push(m[0].trim());
  }
  if (/\bimport\.meta\.glob/.test(text)) unreadable.push("import.meta.glob");
  return { specs, unreadable };
}

describe("reading a module's imports", () => {
  it("reads every form: from, side effects only, re-exports, several lines, import()", () => {
    const text = [
      'import React, { useState } from "react";',
      'import "./theme/assets.js";',
      "import {",
      "  liveStore,",
      "  other,",
      '} from "../liveStore.js";',
      'export { thing } from "./thing.js";',
      'export * from "../clinicalDemo.js";',
      'const Lazy = React.lazy(() => import("../ClinicalDemo.jsx"));',
      "import'./no-space.js';",
    ].join("\n");
    expect(importsOf(text)).toEqual({
      specs: ["react", "./theme/assets.js", "../liveStore.js", "./thing.js", "../clinicalDemo.js",
        "./no-space.js", "../ClinicalDemo.jsx"],
      unreadable: [],
    });
  });

  it("refuses what it cannot follow: import() of a computed path, import.meta.glob", () => {
    const text = [
      "const a = import(name);",
      "const b = import(`../${file}`);",
      'const c = import.meta.glob("../*.js");',
      "if (import.meta.env.DEV) {}",
    ].join("\n");
    expect(importsOf(text).unreadable).toEqual(["import(", "import(", "import.meta.glob"]);
  });
});

describe("src/live/ stands on its own", () => {
  const files = sources(LIVE);

  it("finds the live UI's sources", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.endsWith("LiveApp.jsx"))).toBe(true);
  });

  it("imports nothing from the old workspace but the API client, and nothing it cannot read", () => {
    const outside = [];
    for (const file of files) {
      const name = path.relative(SRC, file).replace(/\\/g, "/");
      const { specs, unreadable } = importsOf(fs.readFileSync(file, "utf8"));
      for (const what of unreadable) outside.push(`${name} -> ${what} (cannot be checked)`);
      for (const spec of specs) {
        if (!spec.startsWith(".")) continue;                   // a package
        const target = path.resolve(path.dirname(file), spec);
        if (target.startsWith(LIVE + path.sep)) continue;
        const rel = path.relative(SRC, target).replace(/\\/g, "/");
        if (!ALLOWED.has(rel)) outside.push(`${name} -> ${rel}`);
      }
    }
    expect(outside).toEqual([]);
  });
});

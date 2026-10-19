// Roadmap D1: the new shell does not rest on the demo. Nothing under src/live/ imported the old
// workspace — ClinicalDemo.jsx, clinicalDemo.js, liveStore.js (built over the simulation),
// clinicalI18n.js, ui.jsx… — so G1-16 deleted it without touching a line here. What it may use
// from outside is the framework-free client of the real API: listed below, nothing else.
// (Tests may read more — the engine's own sources, for one — so test files are not checked.)
//
// Every way a module can pull another in is read (imports.testutil.js, shared with
// routing.test.js): `import … from`, `export … from`, a bare `import "x"` (side effects only),
// each over several lines, and `import("x")`. What cannot be followed by reading — `import(` with
// anything but a quoted path, `import.meta.glob` — fails here outright: an import this test
// cannot see is an import it cannot check.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importsOf } from "./imports.testutil.js";

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

// Aşama A: the unvalidated monitor strip feeds nothing. Its values must never reach what alarms —
// the sound, the notification (signals/), the bell, the rail badge and the menu (shell/), the lock
// screen's counts (auth/LockScreen.jsx) or the board those all read (data/boardStore.js and its
// provider). Read by direct import, every relative spec resolved: none of those modules may name a
// strip module. The ONE exception is `shell/routes.js`, the screen registry: it imports every
// screen — the beds screen that draws the strip, the device screen — so that the router can show
// them, and it reads nothing from any of them but the component.
describe("the monitor strip never reaches an alarm path", () => {
  const STRIP = ["data/shadowStore.js", "data/ShadowProvider.jsx"];
  const STRIP_PREFIXES = ["screens/devices/"];
  const STRIP_ALSO = ["screens/common/monitor.js", "screens/common/MonitorStrip.jsx"];   // later tasks
  const REGISTRY = "shell/routes.js";
  const rel = (file) => path.relative(LIVE, file).replace(/\\/g, "/");
  const guarded = [
    ...sources(path.join(LIVE, "signals")),
    ...sources(path.join(LIVE, "shell")).filter((f) => rel(f) !== REGISTRY),
    path.join(LIVE, "auth", "LockScreen.jsx"),
    path.join(LIVE, "data", "boardStore.js"),
    path.join(LIVE, "data", "BoardProvider.jsx"),
  ];
  const isStrip = (target) => STRIP.includes(target) || STRIP_ALSO.includes(target)
    || STRIP_PREFIXES.some((p) => target.startsWith(p));

  it("the strip's own modules exist, so the rule cannot pass by their absence", () => {
    for (const file of STRIP) expect(fs.existsSync(path.join(LIVE, file)), file).toBe(true);
    expect(guarded.length).toBeGreaterThan(8);
    for (const file of guarded) expect(fs.existsSync(file), rel(file)).toBe(true);
  });

  it("no signal, shell, lock-screen or board-store module imports it", () => {
    const leaks = [];
    for (const file of guarded) {
      for (const spec of importsOf(fs.readFileSync(file, "utf8")).specs) {
        if (!spec.startsWith(".")) continue;
        const target = rel(path.resolve(path.dirname(file), spec));
        if (isStrip(target)) leaks.push(`${rel(file)} -> ${target}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("the rule sees a leak when there is one", () => {
    // The reader, the resolution and the match, on a module that WOULD leak.
    const leaking = 'import { useShadow } from "../data/ShadowProvider.jsx";';
    const target = rel(path.resolve(path.join(LIVE, "shell"), importsOf(leaking).specs[0]));
    expect(isStrip(target)).toBe(true);
    expect(isStrip("screens/devices/DevicesScreen.jsx")).toBe(true);
    expect(isStrip("data/boardStore.js")).toBe(false);
  });
});

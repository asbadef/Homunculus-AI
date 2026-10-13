import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importsOf, staticImportsOf } from "./live/imports.testutil.js";
import { chooseMode, withoutRetired, AppShell } from "./main.jsx";

/** An address as `window.location` carries it: `{pathname, search, hash}`. */
const at = (url) => new URL(url, "http://localhost:3000");

describe("chooseMode", () => {
  it("defaults to live — the address a clinician types is the real system", () => {
    expect(chooseMode(new URLSearchParams(""))).toBe("live");
  });

  it("keeps the simulation on ?demo=1", () => {
    expect(chooseMode(new URLSearchParams("demo=1"))).toBe("demo");
  });

  it("still honours ?live=1 for anyone with an old link", () => {
    expect(chooseMode(new URLSearchParams("live=1"))).toBe("live");
  });

  // G1-16 removed the roots that were not the live system. Their addresses are still in
  // bookmarks and in links in old messages: each opens what the bare URL opens — never a blank
  // page, and never a simulation.
  it.each(["mode=replay", "scenario=septic_shock", "board=1", "board=1&token=abc"])(
    "opens the live system on the retired ?%s", (query) => {
      expect(chooseMode(new URLSearchParams(query))).toBe("live");
    },
  );

  it("lets an explicit demo flag win over nothing", () => {
    // ?demo=1&live=1 is contradictory; live wins because showing simulated data by accident is
    // the worse failure. Document the decision either way with this assertion.
    expect(chooseMode(new URLSearchParams("demo=1&live=1"))).toBe("live");
  });
});

describe("the address an old bookmark is left with", () => {
  // The page it opens is the live system, so the address must stop saying otherwise: a bar that
  // reads ?mode=replay above real patients is a claim, and ?board=1&token=… kept a tenant token in
  // the address, the history and every bookmark made from it.
  it("is not rewritten when it carries nothing retired", () => {
    for (const url of ["/", "/?live=1", "/?tasarim=1", "/#/alarms", "/?mode=kiosk", "/#/demographics"]) {
      expect(withoutRetired(at(url)), url).toBeNull();
    }
  });

  it("loses the legacy board's parameter, and the tenant token it carried", () => {
    expect(withoutRetired(at("/?board=1&token=abc"))).toBe("/");
    expect(withoutRetired(at("/?token=abc"))).toBe("/");
  });

  it("loses the replay's", () => {
    expect(withoutRetired(at("/?mode=replay&scenario=nec"))).toBe("/");
    expect(withoutRetired(at("/?scenario=nec"))).toBe("/");
  });

  it("keeps everything else, the path and the deep link included", () => {
    expect(withoutRetired(at("/panel/?board=1&live=1#/alarms"))).toBe("/panel/?live=1#/alarms");
  });
});

describe("the page as it loads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  // main.jsx does this once, at load, before anything renders: LiveApp keeps `location.search`
  // whenever it clears the hash, so a retired parameter left in the bar would stay there for the
  // whole session.
  it("rewrites an old bookmark's address before anything renders", async () => {
    window.history.replaceState(null, "", "/?board=1&token=abc#/alarms");
    vi.resetModules();
    await import("./main.jsx");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#/alarms");
  });

  it("leaves an address with nothing retired untouched — a reload keeps its place", async () => {
    window.history.replaceState(null, "", "/?live=1#/patients/P-1");
    const replace = vi.spyOn(window.history, "replaceState");
    vi.resetModules();
    await import("./main.jsx");
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/patients/P-1");
  });
});

describe("AppShell", () => {
  // jsdom does no layout, so this pins the structure instead of measuring it. The frame is one
  // screen tall with overflow hidden: if the app's wrapper did not scroll, everything below the
  // first screen (a bed below the fold) would be unreachable. Measured in Chrome at 1366x768
  // before the fix: 3032 px of board in a 672 px window, no scrollbar anywhere.
  it("lets the app scroll inside the one-screen frame, in live mode", () => {
    render(createElement(AppShell, { mode: "live" }, createElement("p", null, "uygulama")));
    const wrapper = screen.getByText("uygulama").parentElement;
    expect(wrapper.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["min-h-0", "flex-1", "overflow-y-auto"]));
    expect(wrapper.parentElement.className).toContain("overflow-hidden");
  });

  it("shows the demo banner only for the simulation", () => {
    const { container, unmount } = render(createElement(AppShell, { mode: "live" }, "x"));
    expect(container.firstChild.children).toHaveLength(1);
    unmount();
    const demo = render(createElement(AppShell, { mode: "demo" }, "x"));
    expect(demo.container.firstChild.children).toHaveLength(2);
  });
});

describe("design gallery (?tasarim=1)", () => {
  it("opens the new UI's design gallery", () => {
    expect(chooseMode(new URLSearchParams("tasarim=1"))).toBe("tasarim");
  });

  it("never wins over an explicit ?live=1", () => {
    expect(chooseMode(new URLSearchParams("tasarim=1&live=1"))).toBe("live");
  });

  it("gets no demo banner: it shows no data", () => {
    const { container } = render(createElement(AppShell, { mode: "tasarim" }, "x"));
    expect(container.firstChild.children).toHaveLength(1);
  });
});

describe("the new live shell (G1-07) and the previous workspace (?eski=1, until G1-16)", () => {
  it("opens the new shell on the bare URL and on ?live=1", () => {
    expect(chooseMode(new URLSearchParams(""))).toBe("live");
    expect(chooseMode(new URLSearchParams("live=1"))).toBe("live");
  });

  it("keeps the previous live workspace on ?eski=1", () => {
    expect(chooseMode(new URLSearchParams("eski=1"))).toBe("eski");
  });

  it("lets an explicit ?live=1 win over ?eski=1", () => {
    expect(chooseMode(new URLSearchParams("eski=1&live=1"))).toBe("live");
  });

  it("gives the previous workspace no demo banner: it talks to the real API", () => {
    const { container } = render(createElement(AppShell, { mode: "eski" }, "x"));
    expect(container.firstChild.children).toHaveLength(1);
  });
});

describe("what the live page downloads", () => {
  const MAIN = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "main.jsx"), "utf8");
  // The same reader boundaries.test.js uses, so a multi-line import, a re-export or a bare
  // `import "x"` cannot slip past this check either.
  const all = importsOf(MAIN);
  const statics = staticImportsOf(MAIN);
  const lazily = all.specs.filter((spec) => !statics.includes(spec));

  // The simulation, its data builder and the previous workspace are the bulk of the bundle, and
  // the live page renders none of them: a ward PC opening the real system was fetching every byte
  // of a simulation it never shows (710 kB in one chunk). They are reachable only lazily.
  it("reaches the simulation and the previous workspace through a dynamic import only", () => {
    expect(all.unreadable).toEqual([]);                  // nothing this check cannot follow
    for (const heavy of ["./ClinicalDemo.jsx", "./clinicalDemo.js", "./liveStore.js", "./Board.jsx",
      "./demo.jsx", "./legacyRoots.jsx", "./live/LiveApp.jsx", "./live/gallery/DesignGallery.jsx"]) {
      expect(statics, heavy).not.toContain(heavy);
    }
    expect(lazily).toEqual(expect.arrayContaining(["./legacyRoots.jsx", "./live/LiveApp.jsx"]));
  });
});

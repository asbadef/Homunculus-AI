// A screen whose code is fetched the first time it is opened (lazyScreen.js).
//
// Every lazy screen here is made INSIDE its test: the registry `preloadScreens` walks is the
// module's own, and setupTests.js preloads it before the first test of every file — a stand-in made
// at the top of this file would be fetched by that hook before the test that means to hold it back.
import { describe, it, expect, vi } from "vitest";
import React, { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { lazyScreen, preloadScreens } from "./lazyScreen.js";

/** A chunk on its way: it arrives (or fails) when the test says so. */
function inFlight() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Probe({ who }) {
  return <h1>Ekran · {who}</h1>;
}

const LOADING = <p>yüklənir</p>;

describe("a screen fetched the first time it is opened", () => {
  it("shows the export its module names, once the module has arrived — and the loading note until then", async () => {
    const chunk = inFlight();
    const Screen = lazyScreen(() => chunk.promise, "Probe");
    render(<Suspense fallback={LOADING}><Screen who="çarpayılar" /></Suspense>);
    expect(screen.getByText("yüklənir")).toBeInTheDocument();
    await act(async () => { chunk.resolve({ Probe, Other: () => null }); await chunk.promise; });
    expect(screen.getByRole("heading")).toHaveTextContent("Ekran · çarpayılar");
    expect(screen.queryByText("yüklənir")).toBeNull();
  });

  it("opens AT ONCE when its module has already arrived: no loading note flashes", async () => {
    const load = vi.fn(() => Promise.resolve({ Probe }));
    const Screen = lazyScreen(load, "Probe");
    expect(await Screen.preload()).toBe(Probe);            // the component the screen shows
    render(<Suspense fallback={LOADING}><Screen who="siqnallar" /></Suspense>);
    expect(screen.queryByText("yüklənir")).toBeNull();
    expect(screen.getByRole("heading")).toHaveTextContent("Ekran · siqnallar");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("fetches its module once, however often and from wherever it is asked", async () => {
    const chunk = inFlight();
    const load = vi.fn(() => chunk.promise);
    const Screen = lazyScreen(load, "Probe");
    const first = Screen.preload();
    render(<Suspense fallback={LOADING}><Screen who="x" /></Suspense>);
    const again = Screen.preload();
    await act(async () => { chunk.resolve({ Probe }); await Promise.all([first, again]); });
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading")).toHaveTextContent("Ekran · x");
  });

  // A preload that failed (the network was down a moment) must not be the answer the screen gets
  // when it is opened later, with the network back: the next ask fetches again.
  it("does not remember a fetch that failed: the next ask fetches again", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
      .mockResolvedValue({ Probe });
    const Screen = lazyScreen(load, "Probe");
    await expect(Screen.preload()).rejects.toThrow("Failed to fetch dynamically imported module");
    await expect(Screen.preload()).resolves.toBe(Probe);
    expect(load).toHaveBeenCalledTimes(2);
  });

  // The chunk did not arrive when the screen was opened (offline, or a deploy replaced the hashed
  // file): React throws it during render, for the nearest error boundary to say so (Shell.jsx).
  it("hands a fetch that failed while it was on screen to the nearest error boundary", async () => {
    const chunk = inFlight();
    const Screen = lazyScreen(() => chunk.promise, "Probe");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    class Catch extends React.Component {
      constructor(props) { super(props); this.state = { error: null }; }
      static getDerivedStateFromError(error) { return { error }; }
      render() { return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children; }
    }
    render(<Catch><Suspense fallback={LOADING}><Screen who="x" /></Suspense></Catch>);
    await act(async () => {
      chunk.reject(new TypeError("Failed to fetch dynamically imported module"));
      await chunk.promise.catch(() => {});
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to fetch dynamically imported module");
    logged.mockRestore();
  });
});

describe("preloadScreens", () => {
  it("fetches every lazy screen made so far, and those a fetched module makes in turn", async () => {
    const tab = vi.fn(() => Promise.resolve({ Probe }));
    const page = vi.fn(() => {
      // What AdminScreen.jsx does when its chunk is evaluated: it makes its own tabs' lazy screens.
      lazyScreen(tab, "Probe");
      return Promise.resolve({ Probe });
    });
    lazyScreen(page, "Probe");
    await preloadScreens();
    expect(page).toHaveBeenCalledTimes(1);
    expect(tab).toHaveBeenCalledTimes(1);
  });

  // It runs in the background (Shell.jsx): a screen whose code cannot be fetched now is reported
  // when someone opens it, by that screen's own boundary — not here, where nobody is looking.
  it("is not stopped by a screen that cannot be fetched, and never rejects", async () => {
    const broken = vi.fn(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    const fine = vi.fn(() => Promise.resolve({ Probe }));
    const thrower = vi.fn(() => { throw new Error("not a promise"); });
    lazyScreen(broken, "Probe");
    lazyScreen(thrower, "Probe");
    const Fine = lazyScreen(fine, "Probe");
    await expect(preloadScreens()).resolves.toBeUndefined();
    expect(fine).toHaveBeenCalledTimes(1);
    render(<Suspense fallback={LOADING}><Fine who="hazır" /></Suspense>);
    expect(screen.getByRole("heading")).toHaveTextContent("Ekran · hazır");
  });
});

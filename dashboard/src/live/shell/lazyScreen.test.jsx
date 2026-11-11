// A screen whose code is fetched the first time it is opened (lazyScreen.js).
//
// Every lazy screen here is made INSIDE its test: the registry `preloadScreens` walks is the
// module's own, and setupTests.js preloads it before the first test of every file — a stand-in made
// at the top of this file would be fetched by that hook before the test that means to hold it back.
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { isChunkFailure, lazyScreen, preloadScreens, retryFailedScreens } from "./lazyScreen.js";

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

/** The nearest error boundary, as the shell's ScreenBoundary is: it shows what it caught. */
class Catch extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children; }
}

afterEach(() => {
  vi.restoreAllMocks();
});

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
    render(<Catch><Suspense fallback={LOADING}><Screen who="x" /></Suspense></Catch>);
    await act(async () => {
      chunk.reject(new TypeError("Failed to fetch dynamically imported module"));
      await chunk.promise.catch(() => {});
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to fetch dynamically imported module");
    logged.mockRestore();
  });

  // React.lazy remembers a rejected import for good: re-rendered, it throws the same error again
  // and fetches nothing, so a screen whose chunk failed once would stay failed until a reload, long
  // after the network came back. Once the failure has been SHOWN (the shell's boundary calls
  // `retryFailedScreens` when it catches one), the next render fetches again.
  it("fetches again on the next render after a failure that was shown, and not before", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module: /assets/Probe-x.js"))
      .mockResolvedValue({ Probe });
    const Screen = lazyScreen(load, "Probe");
    const first = render(<Catch><Suspense fallback={LOADING}><Screen who="x" /></Suspense></Catch>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch dynamically imported module");
    expect(load).toHaveBeenCalledTimes(1);                     // React tried once, and did not loop
    first.unmount();
    retryFailedScreens();
    render(<Catch><Suspense fallback={LOADING}><Screen who="yenə" /></Suspense></Catch>);
    expect(await screen.findByRole("heading")).toHaveTextContent("Ekran · yenə");
    expect(load).toHaveBeenCalledTimes(2);
  });

  // The shell says "check your connection" only of a chunk that did not come; anything else a
  // screen throws is a bug, and gets its own sentence (Shell.jsx ScreenFailed).
  it("tells a chunk that did not come from any other error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Whatever the browser calls it: a lazy screen's own failed fetch is marked as one.
    const odd = new Error("a browser's own wording");
    const Screen = lazyScreen(() => Promise.reject(odd), "Probe");
    render(<Catch><Suspense fallback={LOADING}><Screen who="x" /></Suspense></Catch>);
    await screen.findByRole("alert");
    expect(isChunkFailure(odd)).toBe(true);
    // A plain React.lazy (main.jsx's roots, the tests' stand-ins): the browsers' own words.
    expect(isChunkFailure(new TypeError("Failed to fetch dynamically imported module: https://x/a.js"))).toBe(true);
    expect(isChunkFailure(new TypeError("error loading dynamically imported module: https://x/a.js"))).toBe(true);
    expect(isChunkFailure(new TypeError("Importing a module script failed."))).toBe(true);
    // A bug is not.
    expect(isChunkFailure(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isChunkFailure(new Error("a bug"))).toBe(false);
    expect(isChunkFailure(null)).toBe(false);
  });
});

describe("preloadScreens", () => {
  it("fetches every lazy screen made so far, and those a fetched module makes in turn", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});   // the earlier tests' failed screens
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

  // It runs in the background (LiveApp.jsx): a screen whose code cannot be fetched now is shown as
  // a failure when someone opens it, by the shell's boundary — not here, where nobody is looking. It
  // leaves one warning per screen on the console, so the cause can be found afterwards.
  it("is not stopped by a screen that cannot be fetched, never rejects, and warns once naming it", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = vi.fn(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    const fine = vi.fn(() => Promise.resolve({ Probe }));
    const thrower = vi.fn(() => { throw new Error("not a promise"); });
    lazyScreen(broken, "BrokenScreen");
    lazyScreen(thrower, "ThrowerScreen");
    const Fine = lazyScreen(fine, "Probe");
    await expect(preloadScreens()).resolves.toBeUndefined();
    expect(fine).toHaveBeenCalledTimes(1);
    const named = (name) => warned.mock.calls.filter(([text]) => String(text).includes(name));
    expect(named("BrokenScreen")).toHaveLength(1);
    expect(named("ThrowerScreen")).toHaveLength(1);
    expect(named("BrokenScreen")[0][1]).toBeInstanceOf(TypeError);
    render(<Suspense fallback={LOADING}><Fine who="hazır" /></Suspense>);
    expect(screen.getByRole("heading")).toHaveTextContent("Ekran · hazır");
  });
});

// The signed-in frame: the rail (built screens only, names never icons alone), the router's three
// answers (a screen, "no access", "no such page"), focus, the skip link, the idle lock, the unit
// chip and the language menu. Synthetic accounts only.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import React from "react";
import { ThemeProvider } from "../theme/ThemeProvider.jsx";
import { PHASE } from "../session/sessionStore.js";
import { mount } from "../session/mount.testutil.jsx";
import { profile, token } from "../session/testTokens.testutil.js";
import { ANNOUNCE_DELAY_MS } from "../ui/index.js";
import { hashPath, homePath, resetScreens, stubScreens } from "./routes.js";
import { onlyScreens } from "./screens.testutil.js";
import { BELL_LIST_MAX } from "./TopBar.jsx";
import { IDLE_SPOKEN_AGAIN_AT, Shell } from "./Shell.jsx";
import { lazyScreen } from "./lazyScreen.js";
import { useShell } from "./ShellContext.jsx";

const NURSE_PERMS = ["board.view", "alerts.ack"];

// What Wave 3 will do: give a route its screen. The table itself is frozen, so a test stands in
// through the registry's own seam (routes.js stubScreens) and puts the build's screens back.
function AdminProbe() {
  return <h1>İdarə ekranı</h1>;
}
function BedsProbe() {
  const { unit } = useShell();
  return <h1>Çarpayı ekranı · {unit ?? "hamısı"}</h1>;
}
function PatientProbe({ params }) {
  return <h1>Xəstə {params.id}</h1>;
}
function AlarmsProbe() {
  return <h1>Siqnal ekranı</h1>;
}
function RrtProbe() {
  return <h1>RRT ekranı</h1>;
}
// `built` adds a screen to whatever this build has; `only` pins the registry to a known set, for
// a test whose subject IS which screens exist (the rail's list, where an empty address lands,
// "no such page"). Without `only`, those tests assert a property of the build and break in this
// file every time a Wave-3 branch builds a screen (screens.testutil.js).
const built = (screens) => stubScreens(screens);
const only = (screens) => onlyScreens(screens);

// The board store of the test on screen: emptied afterwards, so no stream timer of a finished test
// reconnects during the next one.
let running = null;

/** Everything already queued: the board's reload after the stream opened, and the renders it
 *  causes. Inside act(), so nothing updates React behind the test's back. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** The shell as LiveApp nests it (mount.testutil), with the board started unless a test asks it not
 *  to be: `start: false` leaves the stream alone, which a fake-timer test wants. */
async function renderShell({
  perms = NURSE_PERMS, scope = { unrestricted: true, unit_ids: [] }, minutes = 10,
  hash = "#/settings", start = true, patients = [],
} = {}) {
  window.location.hash = hash;
  // `resume` as LiveApp hands it over: the shell settles its own first screen and does not read
  // the address bar at mount (Shell.jsx), so a test that opens on an address says so here.
  const { api, store, board, stream } = await mount(
    <ThemeProvider><Shell resume={hashPath(hash)} /></ThemeProvider>, {
    access: token({ perms }),
    me: profile({ perms, lock_idle_minutes: minutes }),
    setup: (fake) => {
      fake.boardPatients.mockResolvedValue({ patients, scope });
      fake.streamTicket.mockResolvedValue({ ticket: "t" });
    },
  });
  running = board;
  if (start) await act(async () => { await board.start(); });
  return { api, session: store, board, stream };
}

beforeEach(() => {
  window.location.hash = "";
});
afterEach(() => {
  if (running) act(() => running.clear());      // still mounted here: React's own cleanup is next
  running = null;
  resetScreens();
  vi.useRealTimers();
  localStorage.clear();
});

describe("the rail", () => {
  it("lists the built screens this session may open, each with its name — not an icon alone", async () => {
    only({ admin: AdminProbe });
    await renderShell();
    const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
    const links = within(rail).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#/settings", "#/settings"]);   // home, settings
    const settings = links[1];
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(within(settings).getAllByText("Ayarlar")).toHaveLength(2);                          // full + short (phone)
    expect(within(rail).queryByText("İdarə")).toBeNull();                                       // not the nurse's
  });

  // The count of unanswered alarms on the rail's own entry (deferred from Wave 2 to G1-10), under
  // the bell's rule: a number only from a LIVE board.
  describe("the alarms entry's count", () => {
    const waitingPatients = (n) => Array.from({ length: n }, (_, i) => ({
      patient_id: `P-${i}`, risk: "high", vitals: {},
      alerts: [{ kind: "news2", severity: "high", summary: `NEWS2 ${i}`, acknowledged: false }],
    }));

    it("counts what is waiting on a LIVE board, in a badge AND in the entry's name", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe });
      const { stream } = await renderShell({ patients: waitingPatients(3) });
      await act(async () => { stream.open(); await settle(); });
      const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
      const entry = within(rail).getByRole("link", { name: /Siqnallar/ });
      expect(entry).toHaveTextContent("3");
      expect(entry).toHaveAccessibleName(/3 siqnal cavab gözləyir/);
    });

    it("a board that may be out of date shows a dot, never a number", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe });
      const { stream } = await renderShell({ patients: waitingPatients(3) });
      await act(async () => { stream.open(); await settle(); });
      act(() => { stream.drop(); });
      const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
      expect(within(rail).queryByText("3")).toBeNull();
      expect(rail.querySelector("[data-rail-badge='stale']")).toBeInTheDocument();
    });

    it("a board that cannot know shows nothing", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe });
      const rail = (await renderShell({ patients: waitingPatients(3), start: false }),
        screen.getByRole("navigation", { name: "Əsas menyu" }));
      expect(rail.querySelector("[data-rail-badge]")).toBeNull();
    });

    it("a LIVE board with nothing waiting shows no badge either", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe });
      const { stream } = await renderShell({ patients: [] });
      await act(async () => { stream.open(); await settle(); });
      const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
      expect(rail.querySelector("[data-rail-badge]")).toBeNull();
    });
  });

  // G2-B5 (spec D7): the RRT entry counts the open calls, under the alarms entry's rule — a number only from a
  // LIVE board, a dot from a stale one — and an answered call drops out. Its words are its own.
  describe("the RRT entry's count", () => {
    const RRT_PERMS = ["board.view", "alerts.ack", "alerts.escalate"];
    const card = (alert) => ({ patient_id: "P-0", risk: "high", vitals: {}, alerts: [alert] });
    const CALLED = { kind: "news2", severity: "high", urgency: "immediate", summary: "NEWS2 7", acknowledged: false,
      rrt_call: { by: "leyla", at: "2026-11-09T10:00:00Z", reason: "Solunum güçlüğü" } };
    // What `/ack` answers with: acknowledged, and the call gone with it (spec D4).
    const ANSWERED = { ...CALLED, acknowledged: true, acknowledged_by: "leyla", rrt_call: null };
    const rrtEntry = () => within(screen.getByRole("navigation", { name: "Əsas menyu" }))
      .getByRole("link", { name: /Sürətli cavab/ });

    it("counts the open calls on a LIVE board, in a badge AND in the entry's name; an answered call drops out", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe, rrt: RrtProbe });
      const { stream } = await renderShell({ perms: RRT_PERMS, patients: [card(CALLED)] });
      await act(async () => { stream.open(); await settle(); });
      expect(rrtEntry().querySelector("[data-rail-badge='count']")).toHaveTextContent("1");
      expect(rrtEntry()).toHaveAccessibleName(/1 açıq RRT çağırışı/);
      act(() => { stream.frame(card(ANSWERED)); });
      expect(rrtEntry().querySelector("[data-rail-badge]")).toBeNull();
      expect(rrtEntry()).not.toHaveAccessibleName(/çağırışı/);
    });

    it("a board that may be out of date shows a dot, never a number", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe, rrt: RrtProbe });
      const { stream } = await renderShell({ perms: RRT_PERMS, patients: [card(CALLED)] });
      await act(async () => { stream.open(); await settle(); });
      act(() => { stream.drop(); });
      expect(rrtEntry().querySelector("[data-rail-badge='count']")).toBeNull();
      expect(rrtEntry().querySelector("[data-rail-badge='stale']")).toBeInTheDocument();
      expect(rrtEntry()).toHaveAccessibleName(/RRT çağırışları yenilənməmiş ola bilər/);
    });

    it("a board that cannot know shows nothing", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe, rrt: RrtProbe });
      await renderShell({ perms: RRT_PERMS, patients: [card(CALLED)], start: false });
      expect(rrtEntry().querySelector("[data-rail-badge]")).toBeNull();
    });
  });

  // G2-B5b (spec D4): a snoozed alarm is out of the count until its time — the rail's badge and the bell — and back after.
  describe("a snoozed alarm", () => {
    const card = (untilMs) => ({ patient_id: "P-0", risk: "high", vitals: {}, alerts: [{ kind: "news2", severity: "high",
      urgency: "immediate", summary: "NEWS2 7", acknowledged: false,
      snooze: { by: "leyla", at: new Date(untilMs - 15 * 60_000).toISOString(), until: new Date(untilMs).toISOString(),
        minutes: 15, reason: "PATIENT_BASELINE", reason_text: null } }] });

    it("is out of the alarms entry's count and the bell while it is snoozed", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe });
      const { stream } = await renderShell({ patients: [card(Date.now() + 10 * 60_000)] });
      await act(async () => { stream.open(); await settle(); });
      const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
      expect(rail.querySelector("[data-rail-badge]")).toBeNull();
      expect(screen.getByRole("button", { name: /Cavab gözləyən siqnal yoxdur/ })).toBeInTheDocument();
    });

    it("is counted again once its time has passed", async () => {
      only({ beds: BedsProbe, alarms: AlarmsProbe });
      const { stream } = await renderShell({ patients: [card(Date.now() - 60_000)] });
      await act(async () => { stream.open(); await settle(); });
      const entry = within(screen.getByRole("navigation", { name: "Əsas menyu" })).getByRole("link", { name: /Siqnallar/ });
      expect(entry).toHaveAccessibleName(/1 siqnal cavab gözləyir/);
    });
  });

  it("shows an administrator the built admin screen", async () => {
    built({ admin: AdminProbe });
    await renderShell({ perms: ["users.manage"] });
    const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
    expect(within(rail).getByRole("link", { name: /İdarə/ })).toHaveAttribute("href", "#/admin");
  });
});

describe("the router", () => {
  it("lands an empty address on the session's home", async () => {
    only({});                                     // nothing built: a nurse's home is her settings
    await renderShell({ hash: "" });
    await waitFor(() => expect(window.location.hash).toBe("#/settings"));
    expect(homePath(NURSE_PERMS)).toBe("/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
  });

  it("answers an unknown address, or a screen not built yet, with 'no such page' — never a blank", async () => {
    only({});                                     // the beds route has no screen in this test
    await renderShell({ hash: "#/yok" });
    expect(screen.getByRole("heading", { level: 1, name: "Belə səhifə yoxdur." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ana səhifəyə qayıt" })).toHaveAttribute("href", "#/settings");
    act(() => { window.location.hash = "#/beds"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(await screen.findByRole("heading", { level: 1, name: "Belə səhifə yoxdur." })).toBeInTheDocument();
  });

  it("answers a screen the session may not open with 'no access'", async () => {
    built({ admin: AdminProbe });
    await renderShell({ hash: "#/admin" });
    expect(screen.getByRole("heading", { level: 1, name: "Bu səhifəyə icazəniz yoxdur" })).toBeInTheDocument();
    expect(screen.queryByText("İdarə ekranı")).toBeNull();
  });

  // The same picture for both would read a mistyped address as "you are not allowed in here".
  it("draws its two refusals differently", async () => {
    built({ admin: AdminProbe });
    const { session } = await renderShell({ hash: "#/yok" });
    const iconOf = () => screen.getByRole("main").querySelector("svg")?.getAttribute("data-icon");
    expect(iconOf()).toBe("file");
    act(() => { window.location.hash = "#/admin"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await screen.findByRole("heading", { level: 1, name: "Bu səhifəyə icazəniz yoxdur" });
    expect(iconOf()).toBe("shield");
    expect(session.getState().phase).toBe(PHASE.READY);
  });

  // A query or an anchor inside the hash belongs to the screen, not to the route.
  it("opens the route named before a query or a second hash, and hands the screen the id whole", async () => {
    built({ beds: BedsProbe, patient: PatientProbe });
    await renderShell({ hash: "#/patients/P-001?tab=vitals" });
    expect(await screen.findByRole("heading", { level: 1, name: "Xəstə P-001" })).toBeInTheDocument();
    act(() => { window.location.hash = "#/beds?unit=NICU"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(await screen.findByRole("heading", { level: 1, name: /Çarpayı ekranı/ })).toBeInTheDocument();
  });

  // Wave 2 left no entry current here and said the next wave should change it on purpose. G1-11
  // did: a screen the rail does not list is open UNDER the entry it was reached from
  // (routes.js `under`), because a clinician spends most of her time on a patient and a rail with
  // nothing current says "you are nowhere" for all of it.
  it("marks the entry a screen sits under while that screen is open", async () => {
    only({ beds: BedsProbe, patient: PatientProbe });
    await renderShell({ hash: "#/patients/P-001" });
    await screen.findByRole("heading", { level: 1, name: "Xəstə P-001" });
    const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
    const current = within(rail).getAllByRole("link").filter((a) => a.getAttribute("aria-current"));
    expect(current.map((a) => a.getAttribute("href"))).toEqual(["#/beds"]);
  });

  it("marks nothing current when the entry it sits under is not in the rail", async () => {
    // A session that may open a patient but whose beds screen this build has not built: saying
    // "you are here" of an entry that is not there would be false.
    only({ patient: PatientProbe });
    await renderShell({ hash: "#/patients/P-001" });
    await screen.findByRole("heading", { level: 1, name: "Xəstə P-001" });
    const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
    expect(within(rail).getAllByRole("link").filter((a) => a.getAttribute("aria-current"))).toEqual([]);
  });

  it("names the screen in the page's title", async () => {
    await renderShell();
    expect(document.title).toBe("Ayarlar · Homunculus");
  });

  it("moves focus to the new screen after a move, and the skip link goes there too", async () => {
    built({ beds: BedsProbe });
    await renderShell();
    act(() => { window.location.hash = "#/beds"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await screen.findByRole("heading", { level: 1, name: /Çarpayı ekranı/ });
    const main = screen.getByRole("main");
    expect(document.activeElement).toBe(main);
    act(() => screen.getByRole("link", { name: "Əsas məzmuna keç" }).focus());
    fireEvent.click(screen.getByRole("link", { name: "Əsas məzmuna keç" }));
    expect(document.activeElement).toBe(main);
    expect(window.location.hash).toBe("#/beds");                        // the skip link is no route
    act(() => screen.getByRole("link", { name: "Əsas məzmuna keç" }).focus());
    act(() => { window.location.hash = "#/settings"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
    expect(document.activeElement).toBe(main);                          // back to the first screen too
  });

  // The layout contract jsdom can pin: <main> scrolls its screen and is the containing block for
  // every absolutely positioned descendant — the screen-reader-only spans above all. Without
  // `relative`, a span at 1400 px of a long screen sat inside the app scroller (main.jsx) instead,
  // which then scrolled the whole shell up and showed the dark page background below it (the
  // ward, 2026-10-26, on every patient screen; measured headless: 1525 px of scroller for 635).
  it("scrolls its own screen and contains its screen-reader-only text (the black band of 26.10)", async () => {
    built({ beds: BedsProbe });
    await renderShell();
    const main = screen.getByRole("main");
    for (const cls of ["relative", "min-h-0", "overflow-auto"]) expect(main.classList.contains(cls), cls).toBe(true);
  });
});

// Each screen's code is its own chunk, fetched the first time the screen is opened (lazyScreen.js,
// routes.js SCREENS). While it travels the page SAYS it is loading — never an empty <main>, and
// never words a clinician could read as "there is nothing here"; a chunk that does not come
// (offline, or a deploy replaced the hashed file) is said as well, with a reload, and the rail and
// the other screens stay usable.
describe("a screen whose code is fetched on first use", () => {
  /** A screen's chunk in flight: it arrives, or fails, when the test says so. */
  function inFlight() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }
  const go = (hash) => act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });

  it("says the page is loading, in the person's language, under the screen's own name — then shows it", async () => {
    const chunk = inFlight();
    built({ beds: React.lazy(() => chunk.promise) });
    await renderShell({ hash: "#/beds" });
    const main = screen.getByRole("main");
    expect(main).toHaveTextContent("Səhifə yüklənir…");
    expect(document.title).toBe("Çarpayılar · Homunculus");
    expect(within(main).queryByRole("alert")).toBeNull();
    await act(async () => { chunk.resolve({ default: BedsProbe }); await chunk.promise; });
    expect(screen.getByRole("heading", { level: 1, name: /Çarpayı ekranı/ })).toBeInTheDocument();
    expect(main).not.toHaveTextContent("Səhifə yüklənir…");
  });

  it("in Russian too: the note is the dictionary's, not a word written into the shell", async () => {
    localStorage.setItem("hmc.lang", "ru");
    built({ beds: React.lazy(() => new Promise(() => {})) });
    await renderShell({ hash: "#/beds" });
    expect(screen.getByRole("main")).toHaveTextContent("Страница загружается…");
  });

  it("says a chunk that did not come could not be loaded, offers a reload, and leaves the rail and the other screens working", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const chunk = inFlight();
    built({ beds: React.lazy(() => chunk.promise), alarms: AlarmsProbe });
    await renderShell({ hash: "#/beds" });
    await act(async () => {
      chunk.reject(new TypeError("Failed to fetch dynamically imported module: /assets/BedsScreen-x.js"));
      await chunk.promise.catch(() => {});
    });
    const main = screen.getByRole("main");
    const alert = within(main).getByRole("alert");
    expect(alert).toHaveTextContent("Səhifə yüklənə bilmədi");
    expect(alert).toHaveTextContent(/Bağlantınızı yoxlayıb səhifəni yenidən yükləyin/);
    expect(main).not.toHaveTextContent("Səhifə yüklənir…");
    // The real error reaches the console, named after the screen it stopped: only that line tells a
    // chunk a deploy replaced from a bug that throws, afterwards.
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('the screen "beds" could not be rendered'), expect.any(TypeError));

    // The reload is what fixes it: a fresh page asks for the files this deploy has.
    const reload = vi.fn();
    const where = vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload });
    fireEvent.click(within(alert).getByRole("button", { name: "Yenidən yüklə" }));
    expect(reload).toHaveBeenCalledTimes(1);
    where.mockRestore();

    // The rest of the page is untouched by one screen's chunk.
    expect(screen.getByRole("navigation", { name: "Əsas menyu" })).toBeInTheDocument();
    go("#/alarms");
    expect(await screen.findByRole("heading", { level: 1, name: "Siqnal ekranı" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).queryByRole("alert")).toBeNull();
    logged.mockRestore();
  });

  // The note is SAID as well as shown: a polite region that is always on the page (outside the
  // Suspense, so it is not born holding its text — ui/Alert.jsx) receives it while the fallback is
  // up, and is emptied when the screen arrives. Focus is the shell's business, unchanged.
  it("says the loading note politely while it is up, and goes quiet when the screen arrives", async () => {
    const chunk = inFlight();
    built({ beds: React.lazy(() => chunk.promise) });
    await renderShell({ hash: "#/beds" });
    const said = () => screen.getAllByRole("status").map((el) => el.textContent).filter(Boolean);
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, ANNOUNCE_DELAY_MS + 20); }); });
    expect(said()).toContain("Səhifə yüklənir…");
    await act(async () => { chunk.resolve({ default: BedsProbe }); await chunk.promise; });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, ANNOUNCE_DELAY_MS + 20); }); });
    expect(said()).not.toContain("Səhifə yüklənir…");
  });

  // A screen that THROWS is not a chunk that did not come: "check your connection, no data was
  // lost" would be false of a bug in a screen with a half-filled form. It gets its own sentence.
  // And the card belongs to the ADDRESS: a move from one patient to the next (the bell, a link)
  // is the same screen, and must not keep the first patient's failure.
  it("says a screen that stopped with an error so, and leaves the failure behind on the next patient", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    function Fragile({ params }) {
      if (params.id === "P-1") throw new Error("a bug on P-1's data");
      return <h1>Xəstə {params.id}</h1>;
    }
    built({ patient: Fragile });
    await renderShell({ hash: "#/patients/P-1" });
    const alert = within(screen.getByRole("main")).getByRole("alert");
    expect(alert).toHaveTextContent("Səhifə yüklənə bilmədi");
    expect(alert).toHaveTextContent("Bu ekran xəta ilə dayandı. Səhifəni yenidən yükləyin; yadda saxlanmamış daxiletmələr itə bilər.");
    expect(alert).not.toHaveTextContent(/Bağlantınızı yoxlayıb/);
    expect(within(alert).getByRole("button", { name: "Yenidən yüklə" })).toBeInTheDocument();
    go("#/patients/P-2");
    expect(await screen.findByRole("heading", { level: 1, name: "Xəstə P-2" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).queryByRole("alert")).toBeNull();

    // And the other way round: a screen that fails AT the new address shows its card, once — the
    // move that brought it there does not reset it and render it again.
    logged.mockClear();
    go("#/patients/P-1");
    expect(await within(screen.getByRole("main")).findByRole("alert")).toHaveTextContent("Bu ekran xəta ilə dayandı.");
    await act(async () => { await settle(); });
    expect(logged.mock.calls.filter(([text]) => String(text).includes("could not be rendered"))).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 1, name: "Xəstə P-1" })).toBeNull();
    logged.mockRestore();
  });

  // React.lazy remembers a rejected import for good, so without help the card would come back on
  // every visit, with no fetch, long after the network is back. A lazy screen whose chunk failed is
  // fetched again the next time it is opened (lazyScreen.js): Reload is no longer the only way out.
  it("fetches a failed screen's code again the next time it is opened", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module: /assets/BedsScreen-x.js"))
      .mockResolvedValue({ BedsProbe });
    built({ beds: lazyScreen(load, "BedsProbe"), alarms: AlarmsProbe });
    await renderShell({ hash: "#/beds" });
    const alert = await within(screen.getByRole("main")).findByRole("alert");
    expect(alert).toHaveTextContent(/Bağlantınızı yoxlayıb səhifəni yenidən yükləyin/);
    go("#/alarms");
    await screen.findByRole("heading", { level: 1, name: "Siqnal ekranı" });
    go("#/beds");
    expect(await screen.findByRole("heading", { level: 1, name: /Çarpayı ekranı/ })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});

// The rights come from the token, and a refreshed one carries the CURRENT groups: an
// administrator's change reaches an open session through the next call it makes (the board's
// included, now that mount.testutil wires `track` as LiveApp does).
describe("rights that change under a session", () => {
  it("re-filters the rail and re-checks the screen on display when a permission goes", async () => {
    built({ admin: AdminProbe, beds: BedsProbe });
    const { api, board } = await renderShell({ perms: ["board.view", "users.manage"], hash: "#/admin" });
    await screen.findByRole("heading", { level: 1, name: "İdarə ekranı" });
    api.store(token({ perms: ["board.view"] }));
    await act(async () => { await board.refresh(); });
    expect(await screen.findByRole("heading", { level: 1, name: "Bu səhifəyə icazəniz yoxdur" })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
    expect(within(rail).queryByRole("link", { name: /İdarə/ })).toBeNull();
    expect(within(rail).getByRole("link", { name: /Çarpayı/ })).toBeInTheDocument();
  });
});

describe("locking", () => {
  it.each([["l"], ["д"], ["¬"]])("locks on Alt+L, whatever the layout writes (%s)", async (key) => {
    const { session } = await renderShell({ start: false });
    fireEvent.keyDown(document, { key, code: "KeyL", altKey: true });
    expect(session.getState().phase).toBe(PHASE.LOCKED);
  });

  it("does not lock for another key that writes an l", async () => {
    const { session } = await renderShell({ start: false });
    fireEvent.keyDown(document, { key: "l", code: "KeyK", altKey: true });
    expect(session.getState().phase).toBe(PHASE.READY);
  });

  it("warns for the last minute of the hospital's idle time, then locks", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const { session } = await renderShell({ minutes: 2, start: false });
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByText("Ekran kilidlənəcək")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Davam et" }));
    expect(screen.queryByText("Ekran kilidlənəcək")).toBeNull();
    act(() => { vi.advanceTimersByTime(121_000); });
    expect(session.getState()).toMatchObject({ phase: PHASE.LOCKED, lock: { why: "idle" } });
  });

  it("says the warning when it opens and once more near the end — not every second", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    await renderShell({ minutes: 2, start: false });
    // A screen may hold more than one polite region (every "say this once" has its own, empty
    // until it speaks): what was SAID is the text in any of them.
    const said = () => screen.getAllByRole("status").map((el) => el.textContent).filter(Boolean);
    // The clock, then the announcement's own delay: a live region speaks only for text that
    // arrives after it (ui/Alert.jsx ANNOUNCE_DELAY_MS).
    const after = (ms) => {
      act(() => { vi.advanceTimersByTime(ms); });
      act(() => { vi.advanceTimersByTime(ANNOUNCE_DELAY_MS); });
    };
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByText("Hərəkət olmadığı üçün · 59 san")).toBeInTheDocument();
    expect(said()).toEqual([]);                                                     // not before the delay
    act(() => { vi.advanceTimersByTime(ANNOUNCE_DELAY_MS); });
    const first = said()[0];
    expect(first).toMatch(/Ekran \d+ saniyə ərzində kilidlənəcək/);
    after(30_000);
    expect(screen.getByText("Hərəkət olmadığı üçün · 29 san")).toBeInTheDocument();  // moved on screen
    expect(said()).toEqual([first]);                                                 // but said once
    after(20_000);
    expect(said()[0]).toContain(`Ekran ${IDLE_SPOKEN_AGAIN_AT} saniyə ərzində`);
  });
});

const TWO_UNITS = { unrestricted: false, unit_ids: ["NICU", "REA"] };

/** Pick a unit from the top bar's chip. */
function chooseUnit(name) {
  fireEvent.click(screen.getByRole("button", { name: "Göstərilən bölmə" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
}

describe("the top bar", () => {
  it("offers the units of a restricted scope, and the screen reads the choice", async () => {
    built({ beds: BedsProbe });
    await renderShell({ hash: "#/beds", scope: TWO_UNITS });
    expect(screen.getByRole("button", { name: "Göstərilən bölmə" })).toHaveTextContent("Bölmələrim · 2");
    chooseUnit("NICU");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Çarpayı ekranı · NICU");
  });

  // The wave full screen (screens/common/WaveFullscreen.jsx) finds this bar by its landmark — it may
  // import nothing from shell/ — and starts below it, so the bell is never covered.
  it("is the page's one banner landmark, and the bell is in it", async () => {
    await renderShell();
    const [banner, ...others] = screen.getAllByRole("banner");
    expect(others).toHaveLength(0);
    expect(within(banner).getByRole("button", { name: /Cavab gözləyən siqnal|Siqnal məlumatı/ })).toBeInTheDocument();
  });

  it("has no unit chip for an unrestricted scope", async () => {
    await renderShell();
    expect(screen.queryByRole("button", { name: "Göstərilən bölmə" })).toBeNull();
  });

  // A /patients load that fails leaves the engine's scope UNKNOWN — it says nothing about which
  // units this session has. Read as "no units", it emptied the chip and took the choice away:
  // in Wave 3 a five-second hiccup would silently widen a one-unit bed board to the whole scope.
  it("keeps the chosen unit while the scope is merely unknown", async () => {
    built({ beds: BedsProbe });
    const { api, board } = await renderShell({ hash: "#/beds", scope: TWO_UNITS });
    chooseUnit("NICU");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Çarpayı ekranı · NICU");
    api.boardPatients.mockRejectedValue(Object.assign(new Error("boom"), { status: 503 }));
    await act(async () => { await board.refresh(); });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Çarpayı ekranı · NICU");
    expect(screen.getByRole("button", { name: /Göstərilən bölmə/ })).toHaveTextContent("NICU");
  });

  // Keeping it is only honest if the chip says the list may be out of date: under repeated
  // failures a unit the engine has since revoked must not stand there with nothing said.
  it("marks the chip while the scope is unknown, as the bell marks a stale board", async () => {
    built({ beds: BedsProbe });
    const { api, board } = await renderShell({ hash: "#/beds", scope: TWO_UNITS });
    chooseUnit("NICU");
    const chip = () => screen.getByRole("button", { name: /Göstərilən bölmə/ });
    expect(chip().querySelector('[data-unit="stale"]')).toBeNull();
    api.boardPatients.mockRejectedValue(Object.assign(new Error("boom"), { status: 503 }));
    await act(async () => { await board.refresh(); });
    expect(chip()).toHaveAccessibleName(/Bölmə siyahısı köhnə ola bilər/);
    expect(chip().querySelector('[data-unit="stale"]')).not.toBeNull();
  });

  // A session that may not see the board at all has its board emptied under the open shell: the
  // old scope's units must not go on being offered.
  it("offers nothing once the board has been emptied under it", async () => {
    built({ beds: BedsProbe });
    const { board } = await renderShell({ hash: "#/beds", scope: TWO_UNITS });
    chooseUnit("NICU");
    await act(async () => { board.clear(); });
    expect(screen.queryByRole("button", { name: /Göstərilən bölmə/ })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Çarpayı ekranı · hamısı");
  });

  it("drops it only when a scope the engine did send no longer lists it", async () => {
    built({ beds: BedsProbe });
    const { api, board } = await renderShell({ hash: "#/beds", scope: TWO_UNITS });
    chooseUnit("NICU");
    api.boardPatients.mockResolvedValue({ patients: [], scope: { unrestricted: false, unit_ids: ["REA", "CCU"] } });
    await act(async () => { await board.refresh(); });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Çarpayı ekranı · hamısı");
    expect(screen.getByRole("button", { name: "Göstərilən bölmə" })).toHaveTextContent("Bölmələrim · 2");
  });

  it("never says 'none' for a board that stopped updating: it shows what it had, marked", async () => {
    const { stream } = await renderShell();
    // Loaded, but no stream yet: it cannot know, and says so rather than "no alarms".
    expect(screen.getByRole("button", { name: /Siqnal məlumatı yüklənir/ })).toBeInTheDocument();
    await act(async () => { stream.open(); await settle(); });
    expect(screen.getByRole("button", { name: /Cavab gözləyən siqnal yoxdur/ })).toBeInTheDocument();
    act(() => { stream.drop(); });
    const bell = screen.getByRole("button", { name: /Cavab gözləyən siqnallar · Cavab gözləyən: 0 — köhnə ola bilər/ });
    expect(bell).not.toHaveAccessibleName(/yoxdur/);
  });

  // The name is honest in all three states; the glance was not. A board that stopped updating
  // with nothing waiting looked exactly like a calm ward: no badge, and the only marker was a
  // grey dot that also meant "connecting" and "no connection".
  it("tells its three states apart on screen, not only in its name", async () => {
    const { stream } = await renderShell();
    const bell = () => screen.getByRole("button", { name: /Cavab gözləyən siqnallar/ });
    const mark = () => bell().querySelector('[data-bell="stale"], [data-bell="unknown"]')
      ?.getAttribute("data-bell") ?? null;
    expect(mark()).toBe("unknown");                              // it cannot know
    await act(async () => { stream.open(); await settle(); });
    expect(mark()).toBeNull();                                   // LIVE: nothing to warn about
    act(() => { stream.drop(); });
    expect(mark()).toBe("stale");                                // its own mark, not the grey dot
  });

  // Deferred from Wave 2 to G1-10: a list of alarms nobody can reach from is a list nobody can
  // act on.
  it("links each row to the patient it is about, and the panel to the alarms screen", async () => {
    only({ beds: BedsProbe, alarms: AlarmsProbe, patient: PatientProbe });
    const patients = [{ patient_id: "P-001", risk: "high", vitals: {},
      alerts: [{ kind: "news2", severity: "high", summary: "NEWS2 7", acknowledged: false }],
      identity: { bed_label: "REA-01" } }];
    const { stream } = await renderShell({ patients });
    await act(async () => { stream.open(); await settle(); });
    fireEvent.click(screen.getByRole("button", { name: /1 siqnal cavab gözləyir/ }));
    const panel = screen.getByRole("region", { name: /Cavab gözləyən siqnallar/ });
    expect(within(panel).getByRole("link", { name: /REA-01/ })).toHaveAttribute("href", "#/patients/P-001");
    expect(within(panel).getByRole("link", { name: /Siqnallar/ })).toHaveAttribute("href", "#/alarms");
  });

  it("does not offer a way to a screen this build has not built", async () => {
    only({ beds: BedsProbe });
    const patients = [{ patient_id: "P-001", risk: "high", vitals: {},
      alerts: [{ kind: "news2", severity: "high", summary: "NEWS2 7", acknowledged: false }] }];
    const { stream } = await renderShell({ patients });
    await act(async () => { stream.open(); await settle(); });
    fireEvent.click(screen.getByRole("button", { name: /1 siqnal cavab gözləyir/ }));
    const panel = screen.getByRole("region", { name: /Cavab gözləyən siqnallar/ });
    expect(within(panel).queryByRole("link", { name: /^Siqnallar/ })).toBeNull();
  });

  // G2-A1 (O17): a critical whose condition passed still waits for its acknowledgement, so the bell
  // lists it — and says so on the row, because the card behind it is drawn calm.
  it("marks a critical that passed unacknowledged on its row, and no other row", async () => {
    const patients = [
      { patient_id: "P-001", risk: "high", vitals: {}, identity: { bed_label: "REA-01" },
        alerts: [{ kind: "news2", severity: "high", summary: "NEWS2 7", acknowledged: false }] },
      { patient_id: "P-002", risk: "none", vitals: {}, identity: { bed_label: "REA-02" },
        alerts: [{ kind: "septic_shock", severity: "critical", summary: "Septic shock criteria met",
          acknowledged: false, resolved_at: "2026-10-07T08:00:00Z" }] },
    ];
    const { stream } = await renderShell({ patients });
    await act(async () => { stream.open(); await settle(); });
    fireEvent.click(screen.getByRole("button", { name: /2 siqnal cavab gözləyir/ }));
    const panel = screen.getByRole("region", { name: /Cavab gözləyən siqnallar/ });
    const passed = within(panel).getByText("Septic shock criteria met").closest("li");
    expect(within(passed).getByText("keçdi · təsdiqlənməyib")).toBeInTheDocument();
    expect(within(panel).getAllByText("keçdi · təsdiqlənməyib")).toHaveLength(1);
  });

  it("lists the worst alarms and says how many more are waiting", async () => {
    const patients = Array.from({ length: BELL_LIST_MAX + 2 }, (_, i) => ({
      patient_id: `P-${i}`, risk: "high", vitals: {},
      alerts: [{ kind: "news2", severity: "high", summary: `NEWS2 ${i}`, acknowledged: false }],
    }));
    const { stream } = await renderShell({ patients });
    await act(async () => { stream.open(); await settle(); });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`${BELL_LIST_MAX + 2} siqnal cavab gözləyir`) }));
    const panel = screen.getByRole("region", { name: /Cavab gözləyən siqnallar/ });
    expect(within(panel).getAllByRole("listitem")).toHaveLength(BELL_LIST_MAX);
    expect(panel).toHaveTextContent("və daha 2 siqnal");
  });

  // Clinical safety: "none" is a PATIENT's risk, never an alarm's severity. Shown as one it would
  // read "Tapıntı yoxdur" — "no finding" — beside an alarm nobody has answered.
  it("never shows an alarm as a finding-free one, whatever severity the engine sent", async () => {
    const patients = [{ patient_id: "P-9", risk: "none", vitals: {},
      alerts: [{ kind: "x", severity: "none", summary: "Mənbə naməlum", acknowledged: false }] }];
    const { stream } = await renderShell({ patients });
    await act(async () => { stream.open(); await settle(); });
    fireEvent.click(screen.getByRole("button", { name: /1 siqnal cavab gözləyir/ }));
    const panel = screen.getByRole("region", { name: /Cavab gözləyən siqnallar/ });
    expect(panel).toHaveTextContent("Mənbə naməlum");
    expect(panel).not.toHaveTextContent("Tapıntı yoxdur");
    expect(panel).toHaveTextContent("Risk bildirilməyib");
  });

  it("moves the clock on at the minute, not every 15 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
      now: new Date(2026, 9, 7, 8, 30, 20) });
    await renderShell({ start: false });
    expect(screen.getByText("08:30")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(39_000); });                 // 08:30:59 — the same minute
    expect(screen.getByText("08:30")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1_100); });                  // past the boundary
    expect(screen.getByText("08:31")).toBeInTheDocument();
  });

  it("has no full-screen button where the browser has no full screen", async () => {
    await renderShell({ start: false });
    expect(screen.queryByRole("button", { name: "Tam ekran" })).toBeNull();
  });

  it("asks the browser for full screen, and survives one that answers with no promise", async () => {
    const request = vi.fn(() => undefined);                         // an older browser
    document.documentElement.requestFullscreen = request;
    const failures = [];
    const onError = (event) => { failures.push(event.error ?? event.message); event.preventDefault(); };
    window.addEventListener("error", onError);
    try {
      await renderShell({ start: false });
      const button = screen.getByRole("button", { name: "Tam ekran" });
      expect(button).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(button);
      expect(request).toHaveBeenCalledTimes(1);
      expect(failures).toEqual([]);
    } finally {
      window.removeEventListener("error", onError);
      delete document.documentElement.requestFullscreen;
    }
  });

  it("shows the keyboard shortcuts, and Escape gives the button its focus back", async () => {
    await renderShell({ start: false });
    const keys = screen.getByRole("button", { name: "Klaviatura qısayolları" });
    fireEvent.click(keys);
    const panel = screen.getByRole("region", { name: "Klaviatura qısayolları" });
    expect(panel).toHaveTextContent("Alt L");
    expect(panel).toHaveTextContent("Ekranı kilidlə");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Klaviatura qısayolları" })).toBeNull();
    expect(document.activeElement).toBe(keys);
  });

  it("names the language menu by what it shows first", async () => {
    await renderShell();
    expect(screen.getByRole("button", { name: "AZ · Dil" })).toHaveTextContent("AZ");
  });

  it("switches the language for the whole shell", async () => {
    await renderShell();
    fireEvent.click(screen.getByRole("button", { name: "AZ · Dil" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /English/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main menu" })).toBeInTheDocument();
  });
});

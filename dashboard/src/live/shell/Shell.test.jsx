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
import { stubScreens } from "./routes.js";
import { BELL_LIST_MAX } from "./TopBar.jsx";
import { IDLE_SPOKEN_AGAIN_AT, Shell } from "./Shell.jsx";
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
let unstub = null;
const built = (screens) => { unstub = stubScreens(screens); };

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
  const { api, store, board, stream } = await mount(<ThemeProvider><Shell /></ThemeProvider>, {
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
  unstub?.();
  unstub = null;
  vi.useRealTimers();
  localStorage.clear();
});

describe("the rail", () => {
  it("lists the built screens this session may open, each with its name — not an icon alone", async () => {
    built({ admin: AdminProbe });
    await renderShell();
    const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
    const links = within(rail).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#/settings", "#/settings"]);   // home, settings
    const settings = links[1];
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(within(settings).getAllByText("Ayarlar")).toHaveLength(2);                          // full + short (phone)
    expect(within(rail).queryByText("İdarə")).toBeNull();                                       // not the nurse's
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
    await renderShell({ hash: "" });
    await waitFor(() => expect(window.location.hash).toBe("#/settings"));
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
  });

  it("answers an unknown address, or a screen not built yet, with 'no such page' — never a blank", async () => {
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

  // Pinned on purpose (Sidebar.jsx): no entry says "you are here" of a page it does not lead to.
  it("marks no rail entry current while a screen the rail does not list is open", async () => {
    built({ beds: BedsProbe, patient: PatientProbe });
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
    expect(screen.getByRole("button", { name: "Göstərilən bölmə" })).toHaveTextContent("NICU");
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

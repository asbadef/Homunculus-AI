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
import { ROUTES } from "./routes.js";
import { IDLE_SPOKEN_AGAIN_AT, Shell } from "./Shell.jsx";
import { useShell } from "./ShellContext.jsx";

const NURSE_PERMS = ["board.view", "alerts.ack"];

// What Wave 3 will do: give a route its screen. Undone after each test.
function AdminProbe() {
  return <h1>İdarə ekranı</h1>;
}
function BedsProbe() {
  const { unit } = useShell();
  return <h1>Çarpayı ekranı · {unit ?? "hamısı"}</h1>;
}
const built = (id, screen2) => { ROUTES.find((r) => r.id === id).screen = screen2; };

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
  hash = "#/settings", start = true,
} = {}) {
  window.location.hash = hash;
  const { api, store, board, stream } = await mount(<ThemeProvider><Shell /></ThemeProvider>, {
    access: token({ perms }),
    me: profile({ perms, lock_idle_minutes: minutes }),
    setup: (fake) => {
      fake.boardPatients.mockResolvedValue({ patients: [], scope });
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
  built("admin", null);
  built("beds", null);
  vi.useRealTimers();
  localStorage.clear();
});

describe("the rail", () => {
  it("lists the built screens this session may open, each with its name — not an icon alone", async () => {
    built("admin", AdminProbe);
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
    built("admin", AdminProbe);
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
    built("admin", AdminProbe);
    await renderShell({ hash: "#/admin" });
    expect(screen.getByRole("heading", { level: 1, name: "Bu səhifəyə icazəniz yoxdur" })).toBeInTheDocument();
    expect(screen.queryByText("İdarə ekranı")).toBeNull();
  });

  it("names the screen in the page's title", async () => {
    await renderShell();
    expect(document.title).toBe("Ayarlar · Homunculus");
  });

  it("moves focus to the new screen after a move, and the skip link goes there too", async () => {
    built("beds", BedsProbe);
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

describe("the top bar", () => {
  it("offers the units of a restricted scope, and the screen reads the choice", async () => {
    built("beds", BedsProbe);
    await renderShell({ hash: "#/beds", scope: { unrestricted: false, unit_ids: ["NICU", "REA"] } });
    const chip = screen.getByRole("button", { name: "Göstərilən bölmə" });
    expect(chip).toHaveTextContent("Bölmələrim · 2");
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "NICU" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Çarpayı ekranı · NICU");
  });

  it("has no unit chip for an unrestricted scope", async () => {
    await renderShell();
    expect(screen.queryByRole("button", { name: "Göstərilən bölmə" })).toBeNull();
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

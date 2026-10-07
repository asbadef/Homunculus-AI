import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nProvider.jsx";
import { ToastProvider } from "../ui/index.js";
import { mount, refusal } from "../session/mount.testutil.jsx";
import { SessionProvider } from "../session/SessionProvider.jsx";
import { NOTICE, PHASE, createSessionStore } from "../session/sessionStore.js";
import { fakeApi, profile, token } from "../session/testTokens.testutil.js";
import { BoardProvider } from "../data/BoardProvider.jsx";
import { createBoardStore } from "../data/boardStore.js";
import { LockScreen } from "./LockScreen.jsx";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const REGION = "Bölmələrinizdəki açıq siqnalların sayı";
const counts = () => screen.getByRole("region", { name: REGION });
const password = () => screen.getByLabelText("Şifrə");
const unlock = () => fireEvent.click(screen.getByRole("button", { name: "Kilidi aç" }));

// Synthetic board entries in the API's /patients shape (api/board.py). No real patient data.
const entry = (id, alerts = []) => ({
  patient_id: id, risk: "moderate", vitals: {}, alerts, last_update: "2026-10-04T08:00:00Z",
});
const alarm = (severity, acknowledged = false) => ({
  kind: `olcut-${severity}`, severity, summary: "sintetik ölçüt", acknowledged,
  first_seen_at: "2026-10-04T07:58:00Z",
});
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A board whose stream this test opens by hand: jsdom has no EventSource, so the board of the
 *  shared mount() can never reach LIVE — the only state that may say "no alarms" (Decision 18). */
async function mountLive(patients) {
  const api = fakeApi(vi, { access: token() });
  api.me.mockResolvedValue(profile());
  api.boardPatients.mockResolvedValue({ patients, scope: { unrestricted: true, unit_ids: [] } });
  api.streamTicket.mockResolvedValue({ ticket: "t-1" });
  let stream = null;
  const store = createSessionStore({ api, events: new EventTarget() });
  await store.restore();
  const board = createBoardStore({ api, openStream: (url, handlers) => { stream = handlers; return () => {}; } });
  render(
    <I18nProvider><ToastProvider>
      <SessionProvider store={store}><BoardProvider store={board}><LockScreen /></BoardProvider></SessionProvider>
    </ToastProvider></I18nProvider>,
  );
  await act(async () => { store.lock(); await board.start(); });
  await act(async () => { stream.onopen(); await settle(); });   // the open reloads: LIVE once it lands
  return { api, store, board };
}

describe("LockScreen", () => {
  it("counts nothing for a 503 — it says what the server said", async () => {
    const { api, store } = await mount(<LockScreen />);
    await act(async () => { store.lock(); });
    api.reauth.mockRejectedValue(refusal(503, "Dizin sunucusuna ulaşılamıyor"));
    fireEvent.change(password(), { target: { value: "Gizli" } });
    unlock();
    expect(await screen.findByText(/Xəstəxananın kataloq serverinə/)).toBeInTheDocument();
    expect(store.getState().unlockFailures).toBe(0);
  });

  it("asks for the password before sending anything", async () => {
    const { api, store } = await mount(<LockScreen />);
    await act(async () => { store.lock(); });
    unlock();
    expect(await screen.findByText("Şifrənizi daxil edin.")).toBeInTheDocument();
    expect(api.reauth).not.toHaveBeenCalled();
  });

  // The shell replaces this screen on the next render; nothing of the password may wait in it.
  it("keeps no password once the request settled, right one or wrong", async () => {
    const { api, store } = await mount(<LockScreen />);
    await act(async () => { store.lock(); });
    api.reauth.mockResolvedValue({});
    fireEvent.change(password(), { target: { value: "Gizli-Sifre-1" } });
    await act(async () => { unlock(); await settle(); });
    expect(store.getState().phase).toBe(PHASE.READY);
    expect(password()).toHaveValue("");
  });

  it("says how many tries are left, and the third wrong password signs out", async () => {
    const { api, store } = await mount(<LockScreen />);
    await act(async () => { store.lock(); });
    api.reauth.mockRejectedValue(refusal(403, "Parola hatalı"));
    for (const left of [2, 1]) {
      fireEvent.change(password(), { target: { value: "yanlis" } });
      unlock();
      expect(await screen.findByText(`Şifrə səhvdir. Qalan cəhd: ${left}; sonra sessiya bağlanır.`))
        .toBeInTheDocument();
      expect(document.activeElement).toBe(password());
      expect(password()).toHaveValue("");
    }
    fireEvent.change(password(), { target: { value: "yanlis" } });
    unlock();
    await act(async () => { await settle(); });
    expect(store.getState().phase).toBe(PHASE.SIGNED_OUT);
    expect(store.getState().notice).toEqual({ code: NOTICE.LOCKED_OUT });
    expect(api.reauth).toHaveBeenCalledTimes(3);
  });

  it("signs out at once for someone else's shift — leaving needs no password", async () => {
    const { api, store } = await mount(<LockScreen />);
    await act(async () => { store.lock(); });
    fireEvent.click(screen.getByRole("button", { name: "Başqa istifadəçi ilə giriş" }));
    expect(store.getState().phase).toBe(PHASE.SIGNED_OUT);
    expect(store.getState().notice).toEqual({ code: NOTICE.SIGNED_OUT });
    expect(api.reauth).not.toHaveBeenCalled();
    expect(api.logout).toHaveBeenCalled();
  });

  it("shows a board that stopped updating as possibly out of date — its counts, never 'none'", async () => {
    const { store, board } = await mount(<LockScreen />, { setup: (api) => {
      api.boardPatients.mockResolvedValue({ patients: [], scope: { unrestricted: true, unit_ids: [] } });
      api.streamTicket.mockRejectedValue(new Error("Failed to fetch"));
    } });
    await act(async () => { store.lock(); await board.start(); });
    expect(counts()).toHaveTextContent("Bölmələrinizdəki açıq siqnal: 0");
    expect(counts()).toHaveTextContent("Təsdiqlənməmiş: 0");
    expect(counts()).toHaveTextContent("Köhnə ola bilər");
    expect(counts()).not.toHaveTextContent("yoxdur");
    act(() => { board.clear(); });
  });

  it("says it cannot know when the board could not be read — never a 0", async () => {
    const { store, board } = await mount(<LockScreen />, { setup: (api) => {
      api.boardPatients.mockRejectedValue(refusal(503, "İstek başarısız (503)"));
      api.streamTicket.mockRejectedValue(new Error("Failed to fetch"));
    } });
    await act(async () => { store.lock(); await board.start(); });
    expect(counts()).toHaveTextContent("Siqnal məlumatı alına bilmir. Bu, siqnal olmadığı demək deyil.");
    expect(counts()).not.toHaveTextContent("0");
    expect(counts()).not.toHaveTextContent("yoxdur");
    act(() => { board.clear(); });
  });

  it("says 'none' only from a LIVE board", async () => {
    const { board } = await mountLive([entry("S-001"), entry("S-002")]);
    expect(counts()).toHaveTextContent("Bölmələrinizdə açıq siqnal yoxdur");
    expect(counts()).not.toHaveTextContent("Köhnə ola bilər");
    act(() => { board.clear(); });
  });

  it("counts the open alarms by severity, a severity it does not know first — and no patient", async () => {
    const { board } = await mountLive([
      entry("S-001", [alarm("critical"), alarm("plasma-storm")]),
      entry("S-002", [alarm("moderate", true)]),
    ]);
    expect(counts()).toHaveTextContent("Bölmələrinizdəki açıq siqnal: 3");
    expect(counts()).toHaveTextContent("Təsdiqlənməmiş: 2");
    // The count stands after the label everywhere (Decision 13), and the unknown severity first.
    expect(counts().textContent).toMatch(/bilinməyən: 1.*kritik: 1.*orta: 1/);
    expect(counts()).not.toHaveTextContent("S-001");          // no bed, no name, no value
    expect(counts()).not.toHaveTextContent("sintetik ölçüt");
    act(() => { board.clear(); });
  });

  it("shows no alarm counts to an account that cannot see the board", async () => {
    const { store } = await mount(<LockScreen />, { access: token({ perms: ["users.manage"] }) });
    await act(async () => { store.lock(); });
    expect(screen.queryByRole("region", { name: REGION })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Ekran kilidlənib" })).toBeInTheDocument();
  });
});

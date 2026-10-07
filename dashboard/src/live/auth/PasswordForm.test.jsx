import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nProvider.jsx";
import { ToastProvider } from "../ui/index.js";
import { mount, refusal } from "../session/mount.testutil.jsx";
import { SessionProvider } from "../session/SessionProvider.jsx";
import { fakeApi, profile, token } from "../session/testTokens.testutil.js";
import { PHASE, createSessionStore } from "../session/sessionStore.js";
import { ANNOUNCE_DELAY_MS } from "../ui/Alert.jsx";
import { PasswordForm } from "./PasswordForm.jsx";
import { PasswordStep } from "./PasswordStep.jsx";
import { SessionWait } from "./SessionWait.jsx";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

const fill = (current, next, repeat) => {
  fireEvent.change(screen.getByLabelText(/^Cari şifrə/), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^Yeni şifrə \*/), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(/Yeni şifrə \(təkrar\)/), { target: { value: repeat } });
  fireEvent.click(screen.getByRole("button", { name: "Saxla" }));
};

// Fake timers installed BEFORE mount, so the hold's timers are the fake ones and its clock (Date)
// can be moved; nothing advances on its own, so no timer fires outside act(). The promise chain of
// a refused request needs no timer: `flush` yields one turn of the real event loop inside act(),
// after which every pending promise has settled (waitFor would wait on the fake clock).
const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const flush = () => act(() => new Promise((resolve) => { realSetTimeout(resolve, 0); }));
const TOO_MANY = "Çok fazla deneme. Bir dakika sonra yeniden deneyin.";
const TOO_MANY_AZ = "Həddindən artıq cəhd edildi. Bir dəqiqədən sonra yenidən cəhd edin.";
const retryIn = (s) => `${s} saniyədən sonra yenidən cəhd edə bilərsiniz.`;
// What the polite regions of the form hold. There is more than one now: every Announce region is
// mounted empty and always there (the hold's, the Caps Lock warning's — ui/Alert.jsx), so what is
// being said is the text across them, not "the" status region.
const said = () => screen.getAllByRole("status").map((region) => region.textContent).join("");

describe("PasswordForm", () => {
  it("checks the server's rules before sending, and points at the field", async () => {
    const { api } = await mount(<PasswordForm submitLabel="Saxla" />);
    fill("Gizli-Sifre-1", "Yeni-Sifre-22", "Yeni-Sifre-23");
    const repeat = screen.getByLabelText(/Yeni şifrə \(təkrar\)/);
    expect(repeat).toHaveAccessibleDescription("İki şifrə eyni deyil.");
    expect(document.activeElement).toBe(repeat);
    fill("Gizli-Sifre-1", "kisa", "kisa");
    expect(screen.getByLabelText(/^Yeni şifrə \*/)).toHaveAccessibleDescription(/Yeni şifrə ən azı 8 simvol olmalıdır/);
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("puts the server's refusal of the current password on its field", async () => {
    const { api } = await mount(<PasswordForm submitLabel="Saxla" />);
    api.changePassword.mockRejectedValue(refusal(400, "Mevcut parola yanlış"));
    fill("yanlis-1", "Yeni-Sifre-22", "Yeni-Sifre-22");
    await waitFor(() => expect(screen.getByLabelText(/^Cari şifrə/)).toHaveAccessibleDescription("Cari şifrə səhvdir."));
    expect(document.activeElement).toBe(screen.getByLabelText(/^Cari şifrə/));
  });

  it("puts a 422 on the field it names: a too-long CURRENT password is the current field's", async () => {
    const { api } = await mount(<PasswordForm submitLabel="Saxla" />);
    api.changePassword.mockRejectedValue(refusal(422, "İstek başarısız (422)", {
      fieldErrors: [{ field: "current_password", type: "string_too_long", message: "…" }],
    }));
    fill("Gizli-Sifre-1", "Yeni-Sifre-22", "Yeni-Sifre-22");
    await waitFor(() => expect(screen.getByLabelText(/^Cari şifrə/)).toHaveAccessibleDescription("Şifrə ən çoxu 1024 simvol ola bilər."));
    expect(screen.getByLabelText(/^Yeni şifrə \*/)).not.toHaveAttribute("aria-invalid");
    expect(document.activeElement).toBe(screen.getByLabelText(/^Cari şifrə/));
  });

  // A second submit while the first is on its way would meet the fresh pair the first one wrote
  // and be answered 401 — a spurious sign-out (amendments: Tasks 1–5 review).
  it("sends once: submit is held while the request is in flight, a second press sends nothing", async () => {
    const onDone = vi.fn();
    let settle;
    const { api } = await mount(<PasswordForm submitLabel="Saxla" onDone={onDone} />);
    api.changePassword.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    fill("Gizli-Sifre-1", "Yeni-Sifre-22", "Yeni-Sifre-22");
    const button = screen.getByRole("button", { name: "Saxla" });
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    fireEvent.submit(button.closest("form"));
    expect(api.changePassword).toHaveBeenCalledTimes(1);
    expect(api.changePassword).toHaveBeenCalledWith("Gizli-Sifre-1", "Yeni-Sifre-22");
    await act(async () => { settle({}); });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(button).not.toHaveAttribute("aria-busy");
    expect(screen.getByLabelText(/^Cari şifrə/)).toHaveValue("");
  });

  it("never calls onDone for an answer that arrives after the form is gone", async () => {
    const onDone = vi.fn();
    let settle;
    const { api } = await mount(<PasswordForm submitLabel="Saxla" onDone={onDone} />);
    api.changePassword.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    fill("Gizli-Sifre-1", "Yeni-Sifre-22", "Yeni-Sifre-22");
    await waitFor(() => expect(screen.getByRole("button", { name: "Saxla" })).toHaveAttribute("aria-busy", "true"));
    cleanup();                                           // the screen moved on
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { settle({}); });
    await waitFor(() => expect(api.me).toHaveBeenCalledTimes(2));   // the store still settled the session
    expect(onDone).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it("holds the button for Retry-After after a 429: the count moves each second, is said once after the refusal, and releases at 0", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const { api } = await mount(<PasswordForm submitLabel="Saxla" />);
    api.changePassword.mockRejectedValue(refusal(429, TOO_MANY, { retryAfter: 3 }));
    fill("Gizli-Sifre-1", "Yeni-Sifre-22", "Yeni-Sifre-22");
    await flush();
    const button = screen.getByRole("button", { name: "Saxla" });
    expect(button).toBeDisabled();
    expect(screen.getByText(TOO_MANY_AZ)).toBeInTheDocument();          // the refusal, role="alert", at once
    expect(document.activeElement).toBe(screen.getByLabelText(/^Cari şifrə/));
    const counter = screen.getByText(retryIn(3));
    expect(counter).toHaveAttribute("aria-hidden", "true");             // the ticking number is not read
    expect(said()).toBe("");                                            // the regions are mounted empty
    tick(ANNOUNCE_DELAY_MS);
    expect(said()).toBe(retryIn(3));                                    // said once, after the alert
    tick(1000 - ANNOUNCE_DELAY_MS);                                     // the first second is up
    expect(screen.getByText(retryIn(2))).toHaveAttribute("aria-hidden", "true");
    expect(said()).toBe(retryIn(3));                                    // not again
    fireEvent.submit(button.closest("form"));                           // Enter in a field meanwhile
    expect(api.changePassword).toHaveBeenCalledTimes(1);
    tick(1000);
    expect(screen.getByText(retryIn(1))).toBeInTheDocument();
    tick(1000);
    expect(button).not.toBeDisabled();                                  // released at 0
    expect(screen.queryByText(/saniyədən sonra/)).toBeNull();
    expect(said()).toBe("");                                            // empty again for the next hold
    fireEvent.submit(button.closest("form"));
    await flush();
    expect(api.changePassword).toHaveBeenCalledTimes(2);
    expect(button).toBeDisabled();                                      // refused again: a new hold
    expect(said()).toBe("");
    tick(ANNOUNCE_DELAY_MS);
    expect(said()).toBe(retryIn(3));                                    // said again, as a change
  });

  it("counts the clock, not its ticks: a throttled or sleeping tab catches up when it wakes", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const { api } = await mount(<PasswordForm submitLabel="Saxla" />);
    api.changePassword.mockRejectedValue(refusal(429, TOO_MANY, { retryAfter: 60 }));
    fill("Gizli-Sifre-1", "Yeni-Sifre-22", "Yeni-Sifre-22");
    await flush();
    expect(screen.getByText(retryIn(60))).toBeInTheDocument();
    tick(ANNOUNCE_DELAY_MS);                                            // the announcement; the count's tick is next
    // 10 s of wall clock pass with no timer at all (a sleeping tab); the page becomes visible again.
    vi.setSystemTime(Date.now() + 10_000);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByText(retryIn(50))).toBeInTheDocument();          // the clock's 10 s, not a tick's 1
    // The one pending tick fires, due a second on (the fake clock moves to it): one more second.
    act(() => { vi.advanceTimersToNextTimer(); });
    expect(screen.getByText(retryIn(49))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saxla" })).toBeDisabled();
    // Past the deadline while asleep: released on waking, no tick needed.
    vi.setSystemTime(Date.now() + 60_000);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByRole("button", { name: "Saxla" })).not.toBeDisabled();
    expect(screen.queryByText(/saniyədən sonra/)).toBeNull();
    cleanup();
    expect(vi.getTimerCount()).toBe(0);                                 // nothing left running
  });

  // The clock is the hospital's PC clock: NTP may step it backwards mid-hold. The count must not
  // grow past the hold the server asked for, or a 60-second refusal would hold the button minutes.
  it("never counts past the hold's own seconds when the clock is stepped backwards", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const { api } = await mount(<PasswordForm submitLabel="Saxla" />);
    api.changePassword.mockRejectedValue(refusal(429, TOO_MANY, { retryAfter: 60 }));
    fill("Gizli-Sifre-1", "Yeni-Sifre-22", "Yeni-Sifre-22");
    await flush();
    expect(screen.getByText(retryIn(60))).toBeInTheDocument();
    vi.setSystemTime(Date.now() - 300_000);                             // NTP steps back 5 minutes
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByText(retryIn(60))).toBeInTheDocument();          // not 360
    expect(screen.getByRole("button", { name: "Saxla" })).toBeDisabled();
    // Stepped back to the right time (the hold's 60 s are not yet up: 20 s left of them).
    vi.setSystemTime(Date.now() + 340_000);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByText(retryIn(20))).toBeInTheDocument();
    vi.setSystemTime(Date.now() + 20_000);                              // and past the deadline
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByRole("button", { name: "Saxla" })).not.toBeDisabled();
  });

  it("starts no hold for a Retry-After of zero or less: nothing is held, nothing is said", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const { api } = await mount(<PasswordForm submitLabel="Saxla" />);
    api.changePassword.mockRejectedValue(refusal(429, TOO_MANY, { retryAfter: 0 }));
    fill("Gizli-Sifre-1", "Yeni-Sifre-22", "Yeni-Sifre-22");
    await flush();
    expect(screen.getByText(TOO_MANY_AZ)).toBeInTheDocument();          // the refusal is still said
    expect(screen.getByRole("button", { name: "Saxla" })).not.toBeDisabled();
    expect(screen.queryByText(/saniyədən sonra/)).toBeNull();
    tick(ANNOUNCE_DELAY_MS);
    expect(said()).toBe("");
  });

  it("drops a hold's timer with the form: a request held and unmounted leaves nothing ticking", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const { api } = await mount(<PasswordForm submitLabel="Saxla" />);
    api.changePassword.mockRejectedValue(refusal(429, TOO_MANY, { retryAfter: 60 }));
    fill("Gizli-Sifre-1", "Yeni-Sifre-22", "Yeni-Sifre-22");
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(0);                      // the count's tick (and the announcement)
    cleanup();
    vi.advanceTimersByTime(0);           // jsdom's own 0 ms selectionchange timer, from the focus move
    expect(vi.getTimerCount()).toBe(0);  // the tick (1000 ms) and the announcement (150 ms) are gone
  });

  it("shows a refusal that belongs to no field as an alert, the fields kept", async () => {
    const { api } = await mount(<PasswordForm submitLabel="Saxla" />);
    api.changePassword.mockRejectedValue(refusal(503, "Dizin sunucusuna ulaşılamıyor"));
    fill("Gizli-Sifre-1", "Yeni-Sifre-22", "Yeni-Sifre-22");
    await waitFor(() => expect(screen.getByText(/Active Directory\) qoşulmaq mümkün deyil/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Saxla" })).not.toBeDisabled();
    expect(screen.getByLabelText(/^Yeni şifrə \*/)).toHaveValue("Yeni-Sifre-22");
    expect(screen.getByLabelText(/^Cari şifrə/)).not.toHaveAttribute("aria-invalid");
  });
});

describe("PasswordStep", () => {
  it("is the last step, names the temporary password, and leaving signs out", async () => {
    const { api, store } = await mount(<PasswordStep />, { me: profile({ must_change_password: true }) });
    expect(store.getState().phase).toBe(PHASE.PASSWORD);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Yeni şifrə təyin edin");
    expect(screen.getByText("Addım 2/2")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Sizə verilən müvəqqəti şifrə/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Çıxış et" }));
    expect(store.getState().phase).toBe(PHASE.SIGNED_OUT);
    expect(api.logout).toHaveBeenCalled();
  });
});

describe("SessionWait", () => {
  it("keeps a session the server could not check, with the reason, retry and sign-out", async () => {
    const { api, store } = await mount(<SessionWait />, {
      setup: (a) => a.me.mockRejectedValue(refusal(503, "Service Unavailable")),
    });
    expect(store.getState().phase).toBe(PHASE.UNREACHABLE);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Serverə qoşulmaq mümkün deyil");
    expect(screen.getByText("Server hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin.")).toBeInTheDocument();
    expect(api.logout).not.toHaveBeenCalled();
    api.me.mockResolvedValue(profile());
    fireEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    await waitFor(() => expect(store.getState().phase).toBe(PHASE.READY));
    expect(api.me).toHaveBeenCalledTimes(2);
  });

  it("says a stored session is being checked politely, as a notice, not a region born with its text", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    // Not mount(): it awaits restore(), and this is the screen shown while that check is on its way.
    const api = fakeApi(vi, { access: token() });
    let answer;
    api.me.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const store = createSessionStore({ api, events: new EventTarget() });
    const checking = store.restore();
    render(
      <I18nProvider><ToastProvider><SessionProvider store={store}><SessionWait /></SessionProvider></ToastProvider></I18nProvider>,
    );
    expect(store.getState().phase).toBe(PHASE.RESTORING);
    expect(screen.getByText("Sessiya yoxlanılır…")).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("");
    tick(ANNOUNCE_DELAY_MS);
    expect(status).toHaveTextContent("Sessiya yoxlanılır…");
    await act(async () => { answer(profile()); await checking; });
    expect(store.getState().phase).toBe(PHASE.READY);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, screen, fireEvent, waitFor } from "@testing-library/react";
import { mount, refusal } from "../session/mount.testutil.jsx";
import { token } from "../session/testTokens.testutil.js";
import { NOTICE } from "../session/sessionStore.js";
import { ANNOUNCE_DELAY_MS } from "../ui/Alert.jsx";
import { SignIn } from "./SignIn.jsx";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

// The hold's own test recipe (PasswordForm.test.jsx): fake timers installed BEFORE the mount, so
// the hold's timers are the fake ones and its clock can be moved, and nothing advances by itself.
// `flush` yields one turn of the real event loop inside act(), after which a refused request's
// promise chain has settled (waitFor would wait on the fake clock).
const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const flush = () => act(() => new Promise((resolve) => { realSetTimeout(resolve, 0); }));
const TOO_MANY = "Çok fazla giriş denemesi; bir dakika sonra tekrar deneyin";
const TOO_MANY_AZ = "Həddindən artıq giriş cəhdi edildi. Bir dəqiqədən sonra yenidən cəhd edin.";
const retryIn = (s) => `${s} saniyədən sonra yenidən cəhd edə bilərsiniz.`;

const loginField = () => screen.getByLabelText(/^İstifadəçi adı \*$/);
const passwordField = () => screen.getByLabelText(/^Şifrə \*$/);
const fill = (login, password) => {
  fireEvent.change(loginField(), { target: { value: login } });
  fireEvent.change(passwordField(), { target: { value: password } });
};
const send = () => fireEvent.submit(screen.getByRole("button", { name: /Daxil ol|Yoxlanılır/ }).closest("form"));

describe("SignIn", () => {
  it("shows a password on request and warns about Caps Lock", async () => {
    await mount(<SignIn />, { access: null });
    const password = passwordField();
    expect(password).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "Şifrəni göstər" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");               // the state; the name stays
    expect(toggle).toHaveAccessibleName("Şifrəni göstər");
    fireEvent.keyDown(password, { key: "A", modifierCapsLock: true });
    // Said when it appears. Asked for by its text, not by its role: the form keeps one more
    // role="status" region mounted for the hold's announcement (amendments, Task 19).
    expect(screen.getByText("Caps Lock açıqdır")).toHaveAttribute("role", "status");
  });

  it("fills in a remembered username and starts at the password", async () => {
    localStorage.setItem("hmc.rememberUser", "ayse");
    await mount(<SignIn />, { access: null });
    expect(loginField()).toHaveValue("ayse");
    expect(screen.getByLabelText("İstifadəçi adını xatırla")).toBeChecked();
    expect(document.activeElement).toBe(passwordField());
  });

  it("says why it opened: a sign-out politely, a lock-out as a refusal", async () => {
    const { api, store } = await mount(<SignIn />);
    await act(async () => { store.signOut(); });
    const out = screen.getByText("Təhlükəsiz çıxış edildi.");
    expect(out.closest("[data-tone]")).toHaveAttribute("data-tone", "info");     // ui/Alert's polite notice
    // Its live region is filled after the delay, not born with the text (ui/Alert).
    await waitFor(() => expect(screen.getAllByRole("status").map((r) => r.textContent))
      .toContain("Təhlükəsiz çıxış edildi."));

    api.store(token());
    api.reauth.mockRejectedValue(refusal(403, "Parola hatalı"));
    await act(async () => { await store.restore(); });
    await act(async () => {
      store.lock();
      for (let i = 0; i < 3; i += 1) await store.unlock("yanlis").catch(() => {});
    });
    expect(store.getState().notice).toEqual({ code: NOTICE.LOCKED_OUT });
    const locked = screen.getByText(/Kilid ekranında 3 dəfə səhv şifrə daxil edildi/);
    expect(locked.closest("[role]")).toHaveAttribute("role", "alert");
  });

  it("says an administrator's password reset behind the lock, as a refusal", async () => {
    const { api, store } = await mount(<SignIn />);
    api.reauth.mockRejectedValue(refusal(403, "password_change_required"));
    await act(async () => {
      store.lock();
      await store.unlock("Gizli-Sifre-1").catch(() => {});
    });
    expect(store.getState().notice).toEqual({ code: NOTICE.PASSWORD_RESET });
    const said = screen.getByText(/Şifrəniz administrator tərəfindən sıfırlanıb/);
    expect(said.closest("[role]")).toHaveAttribute("role", "alert");
  });

  it("says a missing field on the field, focuses it, and sends nothing", async () => {
    const { api } = await mount(<SignIn />, { access: null });
    send();
    expect(loginField()).toHaveAccessibleDescription(/^İstifadəçi adınızı və ya e-poçtunuzu daxil edin\./);
    expect(document.activeElement).toBe(loginField());
    fireEvent.change(loginField(), { target: { value: "ayse" } });
    send();
    expect(passwordField()).toHaveAccessibleDescription("Şifrənizi daxil edin.");
    expect(document.activeElement).toBe(passwordField());
    expect(api.login).not.toHaveBeenCalled();
  });

  it("sends once: submit is held while the request is in flight", async () => {
    const { api } = await mount(<SignIn />, { access: null });
    api.login.mockReturnValue(new Promise(() => {}));
    fill("ayse", "Gizli-Sifre-1");
    const button = screen.getByRole("button", { name: "Daxil ol" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    send();
    expect(api.login).toHaveBeenCalledTimes(1);
    expect(api.login).toHaveBeenCalledWith("ayse", "Gizli-Sifre-1");
  });

  it("shows a refusal as an alert, empties the password and goes back to the field", async () => {
    const { api } = await mount(<SignIn />, { access: null });
    api.login.mockRejectedValue(refusal(401, "Invalid credentials"));
    fill("ayse", "yanlis");
    send();
    const said = await screen.findByText("İstifadəçi adı və ya şifrə səhvdir.");
    expect(said.closest("[role]")).toHaveAttribute("role", "alert");
    expect(passwordField()).toHaveValue("");
    expect(document.activeElement).toBe(passwordField());
    expect(screen.getByRole("button", { name: "Daxil ol" })).not.toBeDisabled();
  });

  // Decision 14: a count that spoke every second would talk over everything else.
  it("holds the button for Retry-After after a 429, says the wait once, and releases at 0", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const { api } = await mount(<SignIn />, { access: null });
    api.login.mockRejectedValue(refusal(429, TOO_MANY, { retryAfter: 3 }));
    fill("ayse", "Gizli-Sifre-1");
    send();
    await flush();
    const button = screen.getByRole("button", { name: "Daxil ol" });
    expect(button).toBeDisabled();
    expect(screen.getByText(TOO_MANY_AZ).closest("[role]")).toHaveAttribute("role", "alert");
    expect(document.activeElement).toBe(passwordField());
    expect(screen.getByText(retryIn(3))).toHaveAttribute("aria-hidden", "true");
    const status = screen.getByText(retryIn(3)).parentElement.querySelector("[role=status]");
    expect(status).toHaveTextContent("");
    tick(ANNOUNCE_DELAY_MS);
    expect(status).toHaveTextContent(retryIn(3));
    tick(1000 - ANNOUNCE_DELAY_MS);
    expect(screen.getByText(retryIn(2))).toHaveAttribute("aria-hidden", "true");
    expect(status).toHaveTextContent(retryIn(3));                      // not again, every second
    send();
    expect(api.login).toHaveBeenCalledTimes(1);                        // held: nothing sent
    tick(2000);
    expect(button).not.toBeDisabled();
    expect(screen.queryByText(/saniyədən sonra/)).toBeNull();
    expect(status).toHaveTextContent("");                              // empty again for the next hold
  });
});

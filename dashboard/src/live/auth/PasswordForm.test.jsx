import { describe, it, expect, vi, afterEach } from "vitest";
import { act, screen, fireEvent, waitFor } from "@testing-library/react";
import { mount, refusal } from "../session/mount.testutil.jsx";
import { profile } from "../session/testTokens.testutil.js";
import { PHASE } from "../session/sessionStore.js";
import { PasswordForm } from "./PasswordForm.jsx";
import { PasswordStep } from "./PasswordStep.jsx";
import { SessionWait } from "./SessionWait.jsx";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const fill = (current, next, repeat) => {
  fireEvent.change(screen.getByLabelText(/^Cari şifrə/), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^Yeni şifrə \*/), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(/Yeni şifrə \(təkrar\)/), { target: { value: repeat } });
  fireEvent.click(screen.getByRole("button", { name: "Saxla" }));
};

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

  it("holds the button for Retry-After after a 429, says for how long, and sends nothing meanwhile", async () => {
    const { api } = await mount(<PasswordForm submitLabel="Saxla" />);
    api.changePassword.mockRejectedValue(
      refusal(429, "Çok fazla deneme. Bir dakika sonra yeniden deneyin.", { retryAfter: 60 }),
    );
    fill("Gizli-Sifre-1", "Yeni-Sifre-22", "Yeni-Sifre-22");
    const button = screen.getByRole("button", { name: "Saxla" });
    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByText("Həddindən artıq cəhd edildi. Bir dəqiqədən sonra yenidən cəhd edin.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("60 saniyədən sonra yenidən cəhd edə bilərsiniz.");
    expect(document.activeElement).toBe(screen.getByLabelText(/^Cari şifrə/));
    fireEvent.submit(button.closest("form"));
    expect(api.changePassword).toHaveBeenCalledTimes(1);
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
});

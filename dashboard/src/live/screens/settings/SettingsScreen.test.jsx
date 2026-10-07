import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { SettingsScreen } from "./SettingsScreen.jsx";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const tab = (name) => fireEvent.click(screen.getByRole("tab", { name }));

describe("SettingsScreen", () => {
  it("changes a local account's password and says so", async () => {
    const { api } = await mount(<SettingsScreen />);
    tab("Təhlükəsizlik");
    api.changePassword.mockResolvedValue({ access_token: token() });
    fireEvent.change(screen.getByLabelText(/^Cari şifrə/), { target: { value: "Gizli-Sifre-1" } });
    fireEvent.change(screen.getByLabelText(/^Yeni şifrə \*/), { target: { value: "Yeni-Sifre-22" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifrə \(təkrar\)/), { target: { value: "Yeni-Sifre-22" } });
    fireEvent.click(screen.getByRole("button", { name: "Şifrəni dəyiş" }));
    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith("Gizli-Sifre-1", "Yeni-Sifre-22"));
    expect(await screen.findByText("Şifrəniz dəyişdi.", { selector: "span" })).toBeInTheDocument();
  });

  it("sends an AD account to the hospital's own way of changing it", async () => {
    await mount(<SettingsScreen />, { me: profile({ auth_source: "ldap" }) });
    tab("Təhlükəsizlik");
    expect(screen.getByRole("note")).toHaveTextContent(/xəstəxana hesabınızla idarə olunur/);
    expect(screen.queryByLabelText(/^Cari şifrə/)).toBeNull();
  });

  it("shows the hospital's lock time, the two-step state, and the profile the server reports", async () => {
    await mount(<SettingsScreen />, { me: profile({ lock_idle_minutes: 7, totp_enabled: true }) });
    expect(screen.getByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
    tab("Təhlükəsizlik");
    expect(screen.getByText("7 dəq hərəkətsizlikdən sonra")).toBeInTheDocument();
    expect(screen.getByText("Açıq")).toBeInTheDocument();
    tab("Profil");
    expect(screen.getByText("Sentetik Hastane")).toBeInTheDocument();
    expect(screen.getByText("Hemşire")).toBeInTheDocument();
    expect(screen.getByText("Yerli hesab")).toBeInTheDocument();
  });

  it("changes the language of this browser from the appearance tab", async () => {
    await mount(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });
});

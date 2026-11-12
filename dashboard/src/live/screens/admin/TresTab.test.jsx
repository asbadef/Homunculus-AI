// src/live/screens/admin/TresTab.test.jsx — Yönetim › TRƏS (TRƏS-01 · F0, spec §6, §8, D2, D3): the tab says
// which lock is closed; the form stands on what it read; the password is never shown and is left out of the body
// unless typed; a bad value is held before anything is sent; a refusal is said by its code and the form keeps what
// was typed; the connection test tells the platform's words. Synthetic account only.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { settle, toasts } from "../kabul/kabul.testutil.js";
import { TYPES, TresTab, accountBody, bodyOf, invalid } from "./TresTab.jsx";

const PERMS = ["tres.manage"];
const EMPTY = { base_url: null, username: null, password_set: false, provider_id: null, organization_id: null, organization_name: null };
const ALL = TYPES.map(([key]) => key);
const UNSET = { mode: "off", environment: "test", settle_hours: 24, enabled_types: ALL, test: EMPTY, live: EMPTY,
  egress: false, updated_at: null };
const SANDBOX = { base_url: "https://ehr-sandbox.example.az", username: "sentetik", password_set: true,
  provider_id: "PRV-0001", organization_id: "ORG-0001", organization_name: "Sentetik Hastane" };
const SET = { ...UNSET, mode: "validate", test: SANDBOX, egress: true, updated_at: "2026-11-11T08:00:00Z" };
const NO_ACCOUNT = { base_url: null, username: null, provider_id: null, organization_id: null, organization_name: null };

async function mounted(setup) {
  const m = await mount(<TresTab />, { access: token({ perms: PERMS }), me: profile({ perms: PERMS }), setup });
  await settle();
  return m;
}
const sandbox = () => within(screen.getByRole("group", { name: "Sınaq mühitinin hesabı" }));
const live = () => within(screen.getByRole("group", { name: "Canlı mühitin hesabı" }));
const save = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); });
  await settle();
};
const testButton = () => screen.getByRole("button", { name: "Bağlantını yoxla" });
const pressTest = async () => {
  await act(async () => { fireEvent.click(testButton()); });
  await settle();
};
/** The toasts on screen: the region also reads each one out in a hidden live region, so only the copies inside a
 *  toast (`data-toast`) are counted (TasksTab.test.jsx). */
const shown = (text) => toasts().getAllByText(text).filter((el) => el.closest("[data-toast]"));

describe("TresTab — the two locks", () => {
  it("says nothing leaves the server while the install's lock is closed, and offers no connection test", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue(UNSET));
    expect(screen.getByText(/^Bu quraşdırmada xaricə göndəriş bağlıdır: buradakı ayar nə olursa olsun, serverdən heç bir məlumat çıxmır\./)).toBeInTheDocument();
    expect(testButton()).toBeDisabled();
    expect(screen.getByText("Xaricə göndəriş bağlı ikən bağlantı yoxlanıla bilməz.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Rejim/).value).toBe("off");
    expect(screen.getByLabelText(/^Mühit/).value).toBe("test");
    expect(screen.getByLabelText(/^Evə yazılmadan sonra gözləmə/).value).toBe("24");
    for (const name of ["Xəstə", "Həkim", "Xəstəxanaya yatış", "Diaqnoz", "Prosedur", "Vital göstəricilər",
      "Laboratoriya nəticələri", "Evə yazılma epikrizi"]) {
      expect(screen.getByRole("checkbox", { name })).toBeChecked();
    }
  });

  it("says the lock is open when it is, and then offers the test", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue(SET));
    expect(screen.getByText("Bu quraşdırmada xaricə göndəriş açıqdır: aşağıdakı rejim və hesab qüvvədədir.")).toBeInTheDocument();
    expect(testButton()).not.toBeDisabled();
    expect(screen.getByText(/^Yoxlama qeyd olunmuş hesabla aparılır/)).toBeInTheDocument();
  });

  it("says the selected environment's account is incomplete when the feed is on without one", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue({ ...SET, environment: "live" }));
    expect(screen.getByText(/^Seçilmiş mühitin hesabı natamamdır/)).toBeInTheDocument();
  });

  it("says nothing of the account while the feed is off, or when the account is whole", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue(SET));
    expect(screen.queryByText(/^Seçilmiş mühitin hesabı natamamdır/)).toBeNull();
  });
});

describe("TresTab — the form", () => {
  it("saves a whole body and says so", async () => {
    const saved = { ...UNSET, mode: "validate", settle_hours: 48, enabled_types: ALL.filter((k) => k !== "lab"),
      test: { ...SANDBOX, organization_id: null, organization_name: null }, updated_at: "2026-11-11T08:00:00Z" };
    const { api } = await mounted((a) => {
      a.tresSettings.mockResolvedValue(UNSET);
      a.saveTresSettings.mockResolvedValue(saved);
    });
    fireEvent.change(screen.getByLabelText(/^Rejim/), { target: { value: "validate" } });
    fireEvent.change(screen.getByLabelText(/^Evə yazılmadan sonra gözləmə/), { target: { value: "48" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Laboratoriya nəticələri" }));
    fireEvent.change(sandbox().getByLabelText(/^Server ünvanı/), { target: { value: " https://ehr-sandbox.example.az " } });
    fireEvent.change(sandbox().getByLabelText(/^İstifadəçi adı/), { target: { value: "sentetik" } });
    fireEvent.change(sandbox().getByLabelText(/^Parol/), { target: { value: "gizli-parola" } });
    fireEvent.change(sandbox().getByLabelText(/^Səhiyyə müəssisəsinin identifikatoru/), { target: { value: "PRV-0001" } });
    await save();
    expect(api.saveTresSettings).toHaveBeenCalledWith({
      mode: "validate", environment: "test", settle_hours: 48, enabled_types: ALL.filter((k) => k !== "lab"),
      test: { ...NO_ACCOUNT, base_url: "https://ehr-sandbox.example.az", username: "sentetik", provider_id: "PRV-0001",
        password: "gizli-parola" },
      live: NO_ACCOUNT,
    });
    expect(shown("TRƏS ayarları yadda saxlanıldı.")).toHaveLength(1);
    // the form now stands on the answer: the password field is empty again and says one is stored
    expect(sandbox().getByLabelText(/^Parol/).value).toBe("");
    expect(sandbox().getByLabelText(/^Parol/).placeholder).toBe("qeyd olunub");
    expect(screen.getByText(/^Son dəyişiklik: /)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("gizli-parola");
  });

  it("never shows a stored password, leaves it out of the body untouched, and clears it only when asked", async () => {
    const { api } = await mounted((a) => {
      a.tresSettings.mockResolvedValue(SET);
      a.saveTresSettings.mockResolvedValue(SET);
    });
    expect(sandbox().getByLabelText(/^Parol/).value).toBe("");
    expect(sandbox().getByText(/^Parol qeyd olunub\./)).toBeInTheDocument();
    expect(live().getByText("Parol daxil edilməyib.")).toBeInTheDocument();
    expect(live().queryByRole("checkbox", { name: "Qeyd olunmuş parolu sil" })).toBeNull();
    await save();
    expect("password" in api.saveTresSettings.mock.calls[0][0].test).toBe(false);
    expect("password" in api.saveTresSettings.mock.calls[0][0].live).toBe(false);
    fireEvent.click(sandbox().getByRole("checkbox", { name: "Qeyd olunmuş parolu sil" }));
    expect(sandbox().getByLabelText(/^Parol/)).toBeDisabled();
    await save();
    expect(api.saveTresSettings.mock.calls[1][0].test.password).toBe("");
  });

  it("says under each address that changing it removes the stored password", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue(SET));
    const said = "https:// ilə başlamalıdır. Ünvanı dəyişmək qeyd olunmuş parolu silir; yeni parolu eyni yadda saxlamada yazın.";
    for (const account of [sandbox(), live()]) {
      expect(account.getByText(said)).toBeInTheDocument();
      expect(account.getByLabelText(/^Server ünvanı/)).toHaveAccessibleDescription(said);
    }
  });

  it("says by its code that the installation does not allow the address", async () => {
    await mounted((a) => {
      a.tresSettings.mockResolvedValue(UNSET);
      a.saveTresSettings.mockRejectedValue(refusal(422, "The base URL's host is not allowed on this installation.",
        { apiCode: "tres_host_not_allowed" }));
    });
    fireEvent.change(sandbox().getByLabelText(/^Server ünvanı/), { target: { value: "https://ehr.example.az" } });
    await save();
    expect(shown(/Bu ünvana bu quraşdırmada icazə verilmir \(TRES_HOSTS\)\./)).toHaveLength(1);
    expect(sandbox().getByLabelText(/^Server ünvanı/).value).toBe("https://ehr.example.az");
  });

  it("holds a bad wait and an address that is not https before anything is sent", async () => {
    const { api } = await mounted((a) => a.tresSettings.mockResolvedValue(UNSET));
    for (const typed of ["169", "-1", "2.5", ""]) {
      fireEvent.change(screen.getByLabelText(/^Evə yazılmadan sonra gözləmə/), { target: { value: typed } });
      await save();
    }
    expect(api.saveTresSettings).not.toHaveBeenCalled();
    expect(screen.getByText("0 ilə 168 arasında tam ədəd daxil edin.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Evə yazılmadan sonra gözləmə/), { target: { value: "0" } });
    fireEvent.change(live().getByLabelText(/^Server ünvanı/), { target: { value: "http://ehr.example.az" } });
    await save();
    expect(api.saveTresSettings).not.toHaveBeenCalled();
    expect(live().getByText("Ünvan https:// ilə başlamalıdır.")).toBeInTheDocument();
    expect(sandbox().queryByText("Ünvan https:// ilə başlamalıdır.")).toBeNull();
  });

  it("says a refusal by its code, keeps what was typed and does not read again", async () => {
    const { api } = await mounted((a) => {
      a.tresSettings.mockResolvedValue(UNSET);
      a.saveTresSettings.mockRejectedValue(refusal(422, "A base URL starts with https://, names a host, carries no "
        + "credentials and is at most 200 characters.", { apiCode: "tres_base_url" }));
    });
    fireEvent.change(sandbox().getByLabelText(/^Server ünvanı/), { target: { value: "https://u:p@ehr.example.az" } });
    await save();
    expect(shown(/Server ünvanı https:\/\/ ilə başlamalı, istifadəçi adı və ya parol daşımamalı/)).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/carries no credentials/);
    expect(sandbox().getByLabelText(/^Server ünvanı/).value).toBe("https://u:p@ehr.example.az");
    expect(api.tresSettings).toHaveBeenCalledTimes(1);
  });

  it("offers no form while no read has answered, and reads again on «Yenidən cəhd et»", async () => {
    const { api } = await mounted((a) => {
      a.tresSettings.mockRejectedValueOnce(refusal(503, "Service Unavailable")).mockResolvedValueOnce(SET);
    });
    expect(screen.getByText(/^Ayarlar oxunmadı: /).closest("[role='alert']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    expect(screen.queryByLabelText(/^Rejim/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" })); });
    await settle();
    expect(screen.getByLabelText(/^Rejim/).value).toBe("validate");
    expect(screen.queryByText(/^Ayarlar oxunmadı: /)).toBeNull();
    expect(api.tresSettings).toHaveBeenCalledTimes(2);
  });

  it("an answer that is no settings object is a failed read, never a form on defaults", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue(undefined));
    expect(screen.getByText(/^Ayarlar oxunmadı: /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yadda saxla" })).toBeNull();
  });
});

describe("TresTab — «Bağlantını yoxla»", () => {
  it("says the platform opened a session", async () => {
    const { api } = await mounted((a) => {
      a.tresSettings.mockResolvedValue(SET);
      a.testTres.mockResolvedValue({ ok: true, message: null });
    });
    await pressTest();
    expect(api.testTres).toHaveBeenCalledTimes(1);
    expect(shown("Bağlantı quruldu: platforma sessiya açdı.")).toHaveLength(1);
  });

  it("says the rounds wait while the platform's refusal of the login stands, until a test succeeds", async () => {
    const { api } = await mounted((a) => {
      a.tresSettings.mockResolvedValue({ ...SET, session_refused_at: "2026-11-11T08:00:00Z" });
      a.testTres.mockResolvedValue({ ok: true, message: null });
    });
    const parked = /^Platforma giriş rədd edildi \(.+\); hesab məlumatları düzəldilib yadda saxlanılana və ya bağlantı yoxlaması uğurlu olana qədər avtomatik göndəriş aparılmır\.$/;
    expect(screen.getByText(parked)).toBeInTheDocument();
    await pressTest();
    expect(api.testTres).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(parked)).toBeNull();
  });

  it("says nothing of a refused login while none stands", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue({ ...SET, session_refused_at: null }));
    expect(screen.queryByText(/^Platforma giriş rədd edildi/)).toBeNull();
  });

  it("tells the platform's own words when it refuses, and says so when it gave none", async () => {
    await mounted((a) => {
      a.tresSettings.mockResolvedValue(SET);
      a.testTres.mockResolvedValueOnce({ ok: false, message: "Invalid credentials" })
        .mockResolvedValueOnce({ ok: false, message: null });
    });
    await pressTest();
    expect(shown("Bağlantı qurulmadı: Invalid credentials")).toHaveLength(1);
    await pressTest();
    expect(shown("Bağlantı qurulmadı: platforma izahat vermədi")).toHaveLength(1);
  });

  it("says the server's refusal by its code", async () => {
    await mounted((a) => {
      a.tresSettings.mockResolvedValue(SET);
      a.testTres.mockRejectedValue(refusal(409, "The selected environment's account is incomplete: the base URL, the "
        + "username, the password and the provider id are all needed.", { apiCode: "tres_account_incomplete" }));
    });
    await pressTest();
    expect(shown(/Seçilmiş mühitin hesabı natamamdır; bağlantı yoxlanılmadı\./)).toHaveLength(1);
  });
});

describe("TresTab — the body's rules", () => {
  const account = { base_url: "", username: "", provider_id: "", organization_id: "", organization_name: "", password: "", clearPassword: false };

  it("an account's empty text is null, and its password is left out unless typed", () => {
    expect(accountBody(account)).toEqual(NO_ACCOUNT);
    expect(accountBody({ ...account, username: "  sentetik ", password: "x" })).toEqual({ ...NO_ACCOUNT, username: "sentetik", password: "x" });
    expect(accountBody({ ...account, password: "x", clearPassword: true })).toEqual({ ...NO_ACCOUNT, password: "" });
  });

  it("the types go in the package's order, whatever order they were ticked in", () => {
    const form = { mode: "send", environment: "live", settle: "0", types: ["lab", "patient"], test: account, live: account };
    expect(bodyOf(form)).toEqual({ mode: "send", environment: "live", settle_hours: 0, enabled_types: ["patient", "lab"],
      test: NO_ACCOUNT, live: NO_ACCOUNT });
  });

  it("the wait is a whole number from 0 to 168, and an address is https or empty", () => {
    const form = (settle, url = "") => ({ settle, test: { ...account, base_url: url }, live: account });
    for (const ok of ["0", "24", "168"]) expect(invalid(form(ok)).settle, ok).toBe(false);
    for (const no of ["", "169", "-1", "1.5", "24h", " 24"]) expect(invalid(form(no)).settle, no).toBe(true);
    expect(invalid(form("24", "https://ehr.example.az"))).toEqual({ settle: false, test: false, live: false });
    expect(invalid(form("24", "ehr.example.az")).test).toBe(true);
    expect(invalid(form("24", "   ")).test).toBe(false);
  });

  it("names the eight types of the engine, in its order", () => {
    expect(ALL).toEqual(["patient", "practitioner", "encounter", "condition", "procedure", "vital", "lab", "composition"]);
  });
});

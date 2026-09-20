/**
 * "Beni hatırla" bir klinik sistemde ne hatırlamalı.
 *
 * Koğuş bilgisayarı ortak kullanılır. Açık bırakılmış bir oturum, bir sonraki kişinin başkasının
 * adıyla hasta verisi görmesi ve denetim kaydında o kişinin adının yazması demektir. Kolaylığın
 * tamamı e-postayı yeniden yazmamakta; kimlik doğrulaması her girişte istenir.
 *
 * Bu testler o sınırı tutar: e-posta hatırlanır, kimlik bilgisi asla.
 */
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ClinicalDemo from "./ClinicalDemo.jsx";
import { createDemoStore, buildRealisticState } from "./clinicalDemo.js";
import { cstrings } from "./clinicalI18n.js";

const S = cstrings("tr");
const KEY = "homunculus-remember-email";

function renderLogin() {
  const store = createDemoStore(buildRealisticState());
  render(<ClinicalDemo store={store} simulation />);
  return store;
}

describe("e-postamı hatırla", () => {
  beforeEach(() => { localStorage.clear(); });

  it("işaretliyken e-postayı saklar, kimlik bilgisini saklamaz", async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText(S.email), { target: { value: "dr.can.ozturk@homunculus.health" } });
    fireEvent.change(screen.getByLabelText(S.pr7.loginPinLabel), { target: { value: "3333" } });
    fireEvent.click(screen.getByLabelText(new RegExp(S.pr9.rememberEmail)));

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: new RegExp(S.signIn) })); });

    expect(localStorage.getItem(KEY)).toBe("dr.can.ozturk@homunculus.health");
    // Saklanan tek şey e-posta: PIN hiçbir anahtarda geçmiyor.
    const all = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join("|");
    expect(all).not.toContain("3333");
  });

  it("bir sonraki açılışta e-posta dolu gelir", () => {
    localStorage.setItem(KEY, "ayse.demir@homunculus.health");
    renderLogin();
    expect(screen.getByLabelText(S.email).value).toBe("ayse.demir@homunculus.health");
    expect(screen.getByLabelText(new RegExp(S.pr9.rememberEmail)).checked).toBe(true);
  });

  it("işaret kaldırılınca hatırlanan e-posta silinir", async () => {
    localStorage.setItem(KEY, "ayse.demir@homunculus.health");
    renderLogin();
    fireEvent.click(screen.getByLabelText(new RegExp(S.pr9.rememberEmail)));   // kapat
    fireEvent.change(screen.getByLabelText(S.pr7.loginPinLabel), { target: { value: "2222" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: new RegExp(S.signIn) })); });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("hatırlanan e-posta oturum açmaz — giriş ekranı yine gelir", () => {
    localStorage.setItem(KEY, "ayse.demir@homunculus.health");
    renderLogin();
    expect(screen.getByRole("button", { name: new RegExp(S.signIn) })).toBeTruthy();
  });
});

/**
 * RRT ekranı **bağlı mı**.
 *
 * Bu projenin baskın kusuru eksik kod değil, ulaşılamayan kod: yetenek yazılır, testleri geçer,
 * onu çağıran hiçbir ekran olmaz. `rrtQueue` kendi testlerinde doğru sıralıyor olabilir — bu
 * dosya başka bir soruyu sorar: **hızlı yanıt ekibi giriş yaptığında bunu görüyor mu.**
 *
 * Üç soru (CLAUDE.md): hangi ekran çağırıyor, hangi rol görüyor, yeniden başlatmada hayatta
 * kalıyor mu. İlk ikisi burada; üçüncüsü alarmın kendi denetim kaydının işidir.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import ClinicalDemo from "./ClinicalDemo.jsx";
import { createDemoStore, buildRealisticState, ROLE, TIER, ESCALATION_STEP } from "./clinicalDemo.js";
import { cstrings } from "./clinicalI18n.js";

const S = cstrings("tr");
const P = S.pr19;

/** Bir alarm çıkar ve onu RRT'ye kadar yükselt. */
function storeWithRrtAlert(role = ROLE.RRT) {
  const store = createDemoStore(buildRealisticState());
  store.loginAs(role);
  const pid = store.getState().patients[0].patient_id;
  store.fireAlert({ patientId: pid, tier: TIER.CRITICAL, summary: "SpO2 düşüşü" });
  const id = store.getState().alerts[0].id;
  store.escalateToRRT(id);
  return { store, id };
}

function renderWith(store) {
  render(<ClinicalDemo store={store} simulation />);
}

describe("RRT ekranı menüden ulaşılabilir", () => {
  it("hızlı yanıt ekibi menüde kendi ekranını görür", () => {
    const { store } = storeWithRrtAlert();
    renderWith(store);
    expect(screen.getAllByText(P.rrtTitle).length).toBeGreaterThan(0);
  });

  it("hemşire bu ekranı görmez — zincirin o durağı onun değil", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.CHARGE_NURSE);
    renderWith(store);
    expect(screen.queryByRole("button", { name: new RegExp(S.navShort.rrt) })).toBeNull();
  });

  it("yönetici de görür: zincirin sonuna ne düştüğü onun işi", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.HOSPITAL_ADMIN);
    store.completeTenantSetup();   // simülasyonda admin girişi önce kurulum sihirbazına düşer
    renderWith(store);
    expect(screen.getAllByTitle(S.nav.rrt).length).toBeGreaterThan(0);
  });
});

describe("ekran ne gösteriyor", () => {
  it("kendisine eskale edilmiş alarm listede, elle çağrıldığı yazılı", async () => {
    const { store } = storeWithRrtAlert();
    renderWith(store);
    await act(async () => { screen.getAllByTitle(S.nav.rrt)[0].click(); });
    expect(screen.getByText(P.rrtMine)).toBeTruthy();
    expect(screen.getByText(P.rrtManual)).toBeTruthy();
  });

  it("eskale edilmiş alarm yoksa boş durum söylenir, sahte liste çizilmez", async () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.RRT);
    renderWith(store);
    await act(async () => { screen.getAllByTitle(S.nav.rrt)[0].click(); });
    expect(screen.getByText(P.rrtEmpty)).toBeTruthy();
  });

  it("pilotta kademenin kapalı olduğu ekranda yazılı — boşluk gizlenmez", async () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.RRT);
    renderWith(store);
    await act(async () => { screen.getAllByTitle(S.nav.rrt)[0].click(); });
    expect(screen.getByText(P.rrtPilotNote)).toBeTruthy();
  });

  it("cevapsız duran ama henüz ulaşmamış alarm 'yolda' bölümünde görünür", async () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.RRT);
    const pid = store.getState().patients[0].patient_id;
    store.fireAlert({ patientId: pid, tier: TIER.CRITICAL, summary: "MAP düşüşü" });
    renderWith(store);
    await act(async () => { screen.getAllByTitle(S.nav.rrt)[0].click(); });
    expect(screen.getByText(P.rrtIncoming)).toBeTruthy();
    expect(screen.getByText("MAP düşüşü")).toBeTruthy();
  });
});

describe("menü rozeti", () => {
  it("cevapsız eskalasyon sayısı menüde görünür", () => {
    const { store } = storeWithRrtAlert();
    renderWith(store);
    const nav = screen.getAllByTitle(S.nav.rrt)[0];
    expect(within(nav).getByText("1")).toBeTruthy();
  });

  it("cevaplanan alarm rozetten düşer — kırmızı sayı hep bekleyen iş demek", async () => {
    const { store, id } = storeWithRrtAlert();
    await act(async () => {
      store.acknowledgeAlert(id, { reason: "at_bedside", note: "Ekip yatak başında, hasta değerlendiriliyor." });
    });
    renderWith(store);
    const nav = screen.getAllByTitle(S.nav.rrt)[0];
    expect(within(nav).queryByText("1")).toBeNull();
  });
});

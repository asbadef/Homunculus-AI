/**
 * Canlı koğuşta gösterilmeyecek tek sayı: ekranın kendi uydurduğu NEWS2.
 *
 * 20.09.2026'da pilot panelde görüldü: motor `news2` yayınlamıyordu (eski sürüm), panel yerel
 * hesabına düşüyordu ve koğuşun monitörleri solunum hızı göndermediği için ekranda sakin, yeşil
 * bir **"NEWS2 Skoru: 0"** duruyordu — kimsenin skorlamadığı hastada. NEWS2 ölçülmeyen
 * parametreyi 0 puanlar; yani eksik veri, düşük skor olarak görünür.
 *
 * Buradaki üç test o davranışı kalıcı olarak kapatır.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import ClinicalDemo from "./ClinicalDemo.jsx";
import { createDemoStore, buildRealisticState, ROLE } from "./clinicalDemo.js";
import { cstrings } from "./clinicalI18n.js";

const S = cstrings("tr");

/** Motorun news2 yayınlamadığı bir pano — pilotun bugünkü hâli. */
function storeWithoutEngineNews2() {
  const state = buildRealisticState();
  state.patients = state.patients.map((p) => ({ ...p, news2: null }));
  const store = createDemoStore(state);
  store.loginAs(ROLE.ATTENDING);
  return store;
}

describe("motor NEWS2 göndermiyorsa", () => {
  it("canlı modda sayı yerine — gösterir", async () => {
    render(<ClinicalDemo store={storeWithoutEngineNews2()} />);
    await act(async () => { await Promise.resolve(); });

    const pills = screen.getAllByText(new RegExp(`${S.pr6.news2}:`));
    expect(pills.length).toBeGreaterThan(0);
    // Hiçbir rozet sayı taşımıyor: iki nokta üstünden sonrası "—" (etiketteki "NEWS2"nin
    // kendi rakamı sayılmasın diye değer kısmına bakılıyor).
    pills.forEach((el) => {
      const value = el.textContent.split(":").pop();
      expect(value).toMatch(/—/);
      expect(value).not.toMatch(/\d/);
    });
  });

  it("neden boş olduğunu söyler — sessizce boş bırakmaz", async () => {
    render(<ClinicalDemo store={storeWithoutEngineNews2()} />);
    await act(async () => { await Promise.resolve(); });

    const pill = screen.getAllByText(new RegExp(`${S.pr6.news2}:`))[0];
    expect(pill.getAttribute("title") || pill.closest("[title]")?.getAttribute("title") || "")
      .toMatch(/Motor/);
  });

  it("simülasyonda yerel hesap kalır — orada karşısında motor yok", async () => {
    render(<ClinicalDemo store={storeWithoutEngineNews2()} simulation />);
    await act(async () => { await Promise.resolve(); });

    const pills = screen.getAllByText(new RegExp(`${S.pr6.news2}:`));
    const withNumber = pills.filter((el) => /\d/.test(el.textContent));
    expect(withNumber.length).toBeGreaterThan(0);
  });
});

describe("eksik vital kısmi skordur", () => {
  it("simülasyonda ölçülmeyen parametre yıldızla işaretlenir", async () => {
    const state = buildRealisticState();
    // Koğuşun bugünkü hâli: solunum hızı gelmiyor.
    state.patients = state.patients.map((p) => ({
      ...p, news2: null, vitals: { ...p.vitals, rr: null },
    }));
    const store = createDemoStore(state);
    store.loginAs(ROLE.ATTENDING);

    render(<ClinicalDemo store={store} simulation />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getAllByLabelText("kısmi skor").length).toBeGreaterThan(0);
  });
});

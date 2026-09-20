/**
 * Eskalasyon saati: canlı koğuşta gerçek zaman, simülasyonda hızlandırılmış.
 *
 * 21.09.2026'da ölçüldü: `speed: 60` simülasyonun varsayılanıydı (1 gerçek saniye = 1 simüle
 * dakika, böylece 3 dakikalık kademe demoda 3 saniyede geliyor) ve canlı store onu
 * değiştirmiyordu. Canlıda bir dakikadır cevapsız bir alarm ekranda **bir saat** görünüyor,
 * eskalasyon kademeleri saniyeler içinde tükeniyordu. Alarm yorgunluğunu ölçtüğünü söyleyen bir
 * sistemde cevap süresinin altmış kat yanlış olması, ölçümün kendisini geçersiz kılar.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import ClinicalDemo from "./ClinicalDemo.jsx";
import { createDemoStore, buildRealisticState, ROLE } from "./clinicalDemo.js";
import { fmtClock } from "./clinicalUi.jsx";

function freshStore() {
  const store = createDemoStore(buildRealisticState());
  store.loginAs(ROLE.ATTENDING);
  return store;
}

describe("saat biçimi", () => {
  it("bir saatin altında dakika:saniye", () => {
    expect(fmtClock(90)).toBe("1:30");
    expect(fmtClock(3599)).toBe("59:59");
  });

  it("bir saati geçince saat alanı açılır — 318:30 diye yazılmaz", () => {
    expect(fmtClock(3600)).toBe("1:00:00");
    expect(fmtClock(19110)).toBe("5:18:30");
  });

  it("negatif süre sıfırdır", () => {
    expect(fmtClock(-5)).toBe("0:00");
  });
});

describe("eskalasyon saati", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const advance = async (ms) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

  it("canlıda gerçek zamanla ilerler — hızlandırma uygulanmaz", async () => {
    const store = freshStore();
    store.setSpeed(60);           // simülasyonun varsayılanı; canlıda uygulanmamalı
    const before = store.getState().clockSec;
    render(<ClinicalDemo store={store} />);
    await advance(4000);          // 4 saniye
    const grew = store.getState().clockSec - before;
    // 4 saniyede ~4 saniye ilerler; 60× olsaydı ~240 olurdu.
    expect(grew).toBeGreaterThan(3);
    expect(grew).toBeLessThan(8);
  });

  it("simülasyonda hızlandırma çalışır — demo 3 dakikalık kademeyi 3 saniyede geçer", async () => {
    const store = freshStore();
    store.setSpeed(60);
    const before = store.getState().clockSec;
    render(<ClinicalDemo store={store} simulation />);
    await advance(4000);
    const grew = store.getState().clockSec - before;
    expect(grew).toBeGreaterThan(180);
  });
});

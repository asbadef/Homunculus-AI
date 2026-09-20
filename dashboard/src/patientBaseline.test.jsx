/**
 * "Alarm Eşikleri" kutusunun bağlı olduğu yer.
 *
 * 21.09.2026'da ölçüldü: kutu hiçbir yere bağlı değildi. `setThresholds` yalnız simülasyon
 * store'unda vardı; canlıda hekimin girdiği değer tarayıcı belleğinde kalıyor, sayfa
 * yenilenince kayboluyor ve motorun alarmlarını hiç etkilemiyordu. Motor ise tam bu bilgiyi
 * bekliyordu (`PUT /clinical/{id}/profile` · `baselines`).
 *
 * Bu testler kutunun motora gittiğini ve ters aralığın yazılmadan reddedildiğini sabitler.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { getTheme } from "./clinicalTheme.js";
import { cstrings } from "./clinicalI18n.js";
import { createDemoStore, buildRealisticState, ROLE } from "./clinicalDemo.js";
import ClinicalDemo from "./ClinicalDemo.jsx";

const S = cstrings("tr");

/** Kokpiti açıp "Alarm Eşikleri" kutusunu getirir; store'un setProfile çağrısını yakalar. */
async function openBaselineBox({ setProfile } = {}) {
  const base = createDemoStore(buildRealisticState());
  base.loginAs(ROLE.ATTENDING);
  const calls = [];
  const store = {
    ...base,
    getState: base.getState,
    subscribe: base.subscribe,
    setProfile: setProfile || vi.fn(async (patientId, body) => { calls.push({ patientId, body }); return {}; }),
  };
  render(<ClinicalDemo store={store} />);
  await act(async () => { await Promise.resolve(); });

  // İlk hasta kartı → çekmece → eşikler
  const card = screen.getAllByRole("button").find((b) => /NEWS2/.test(b.textContent) && /\d{3}/.test(b.textContent));
  await act(async () => { fireEvent.click(card); });
  const thBtn = screen.getAllByRole("button").find((b) => b.textContent.trim() === S.pr6.thresholds);
  await act(async () => { fireEvent.click(thBtn); });
  return { store, calls };
}

describe("hastaya göre alarm ayarı", () => {
  it("motora gider — tarayıcıda kalmaz", async () => {
    const { store, calls } = await openBaselineBox();

    const low = screen.getAllByPlaceholderText("—")[0];      // nabız · alt
    const high = screen.getAllByPlaceholderText("—")[1];     // nabız · üst
    fireEvent.change(low, { target: { value: "95" } });
    fireEvent.change(high, { target: { value: "120" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(S.pr6.saveBaseline) }));
    });

    expect(store.setProfile).toHaveBeenCalled();
    expect(calls[0].body.baselines.heart_rate).toEqual({ low: 95, high: 120 });
  });

  it("girilmeyen parametre gönderilmez — boş, 'sıfır' demek değildir", async () => {
    const { calls } = await openBaselineBox();
    const low = screen.getAllByPlaceholderText("—")[0];
    fireEvent.change(low, { target: { value: "95" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(S.pr6.saveBaseline) }));
    });
    const sent = calls[0].body.baselines;
    expect(Object.keys(sent)).toEqual(["heart_rate"]);
    expect(sent.heart_rate).toEqual({ low: 95 });
  });

  it("ters aralık yazılmadan reddedilir", async () => {
    const { store } = await openBaselineBox();
    const low = screen.getAllByPlaceholderText("—")[0];
    const high = screen.getAllByPlaceholderText("—")[1];
    fireEvent.change(low, { target: { value: "130" } });
    fireEvent.change(high, { target: { value: "60" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(S.pr6.saveBaseline) }));
    });
    expect(store.setProfile).not.toHaveBeenCalled();
    expect(screen.getByText(new RegExp(S.pr6.invertedRange))).toBeTruthy();
  });

  it("cihaz alarmı olmadığını ekranda söyler", async () => {
    await openBaselineBox();
    expect(screen.getByText(new RegExp(S.pr6.baselineSub))).toBeTruthy();
  });
});

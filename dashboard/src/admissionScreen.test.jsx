/**
 * Kabul ekranının KAPISI — "yazıldı, test edildi, bağlanmadı" hatasının bu iş için panzehiri.
 *
 * Bu dosya özellikle üç soruyu sorar (bkz. Homunculus/CLAUDE.md):
 *   1. Bunu hangi ekran çağırıyor?  → menüdeki Hasta Kabul maddesi, üç sekmesiyle birlikte.
 *   2. Hangi rol görüyor?           → hekim; bakım ekibi ataması menüden kalktı, işi kalkmadı.
 *   3. Kayda düşüyor mu?            → doğum tarihi hasta kaydına yazılır ve etikete basılır.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import ClinicalDemo from "./ClinicalDemo.jsx";
import { AdmitForm } from "./admissionPage.jsx";
import { createDemoStore, buildRealisticState, ROLE } from "./clinicalDemo.js";
import { getTheme } from "./clinicalTheme.js";
import { cstrings } from "./clinicalI18n.js";

const T = getTheme("icu");
const S = cstrings("tr");

function freshStore() {
  const store = createDemoStore(buildRealisticState());
  store.loginAs(ROLE.ATTENDING);
  return store;
}

describe("kabul ekranı menüden açılıyor", () => {
  it("üç sekmeyi de sunar — bakım ekibi menüden kalktı, işi kalkmadı", async () => {
    const store = freshStore();
    render(<ClinicalDemo store={store} simulation />);
    await act(async () => { await Promise.resolve(); });

    const nav = Array.from(document.querySelectorAll("aside button[title]"));
    const admission = nav.find((b) => b.title === S.nav.admission);
    expect(admission).toBeTruthy();
    // Bakım ekibi artık kendi menü maddesi değil.
    expect(nav.find((b) => b.title === S.nav.care)).toBeUndefined();

    await act(async () => { admission.click(); await Promise.resolve(); });
    // Sekme adları tam eşleşmeyle aranır: "Kabul" ile "Kabulü Onayla" aynı şey değildir.
    expect(screen.getByRole("button", { name: S.pr19.tabAdmit })).toBeTruthy();
    expect(screen.getByRole("button", { name: S.pr19.tabTransfer })).toBeTruthy();

    // …ve bakım ekibi sekmesi gerçekten o ekranı açıyor.
    const careTab = screen.getByRole("button", { name: S.pr19.tabCare });
    await act(async () => { fireEvent.click(careTab); await Promise.resolve(); });
    expect(screen.getByText(S.shiftRoster)).toBeTruthy();
  });

  it("daraltılmış sol panelde kısa ad görünür — yalnız ikon bırakmaz", async () => {
    const store = freshStore();
    render(<ClinicalDemo store={store} simulation />);
    await act(async () => { await Promise.resolve(); });

    const aside = document.querySelector("aside");
    const toggle = within(aside).getByLabelText(S.collapse);
    await act(async () => { fireEvent.click(toggle); await Promise.resolve(); });

    expect(within(aside).getByText(S.navShort.admission)).toBeTruthy();
    expect(within(aside).getByText(S.navShort.alarms)).toBeTruthy();
  });
});

describe("kabul formu", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  const fillAndAdmit = (store) => {
    fireEvent.change(screen.getByLabelText(S.fName), { target: { value: "Bərxudar Zeynalov" } });
    fireEvent.change(screen.getByLabelText(S.pr19.birthDate), { target: { value: "1963-10-22" } });
    fireEvent.change(screen.getByLabelText(S.fDx), { target: { value: "Toplum kökenli pnömoni" } });
    const bedSelect = screen.getByLabelText(S.fBed);
    const option = Array.from(bedSelect.querySelectorAll("option")).find((o) => o.value);
    fireEvent.change(bedSelect, { target: { value: option.value } });
    return option;
  };

  it("doğum tarihinden yaşı hesaplar ve yaşı elle değiştirtmez", () => {
    render(<AdmitForm T={T} S={S} store={freshStore()} state={freshStore().getState()} />);
    fireEvent.change(screen.getByLabelText(S.pr19.birthDate), { target: { value: "1963-10-22" } });
    const age = screen.getByLabelText(S.fAge);
    const expected = new Date().getFullYear() - 1963 - (new Date() < new Date(`${new Date().getFullYear()}-10-22`) ? 1 : 0);
    expect(age.value).toBe(String(expected));
    expect(age.readOnly).toBe(true);
  });

  it("eksik zorunlu alan varken kabul düğmesi kapalıdır ve eksiği adıyla söyler", () => {
    const store = freshStore();
    render(<AdmitForm T={T} S={S} store={store} state={store.getState()} />);
    const submit = screen.getByRole("button", { name: new RegExp(S.admitBtn) });
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(S.pr19.missingRequired)).toBeTruthy();
    expect(screen.getByText(`· ${S.fBed}`)).toBeTruthy();
  });

  it("kabul edilince protokol numarası ve barkod etiketi oluşur", async () => {
    const store = freshStore();
    const { rerender } = render(<AdmitForm T={T} S={S} store={store} state={store.getState()} />);
    fillAndAdmit(store);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(S.admitBtn) }));
    });
    rerender(<AdmitForm T={T} S={S} store={store} state={store.getState()} />);

    const admitted = store.getState().patients.at(-1);
    expect(admitted.display_name).toBe("Bərxudar Zeynalov");
    // Doğum tarihi kayda düştü — etiketteki "Doğum Tarihi" satırı buradan gelir.
    expect(admitted.birthDate).toBe("1963-10-22");
    // Etiket önizlemesi gerçek protokol numarasını ve bir barkodu gösteriyor.
    expect(screen.getAllByText(admitted.protocolNo).length).toBeGreaterThan(0);
    expect(document.querySelector("svg[aria-label]")).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(S.pr19.printLabel) })).toBeTruthy();
  });

  it("kabul onaylanmadan barkod uydurulmaz", () => {
    const store = freshStore();
    render(<AdmitForm T={T} S={S} store={store} state={store.getState()} />);
    expect(screen.getByText(S.pr19.labelBeforeAdmit)).toBeTruthy();
  });
});

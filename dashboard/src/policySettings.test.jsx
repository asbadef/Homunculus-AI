/**
 * Kurum politikası **bağlı mı**.
 *
 * Denetimde çıkan bulgu: adı "Sistem Ayarları" olan ekranın on sekmesinde tek bir ayar yoktu.
 * Ayarı eklemek yetmez — bu projenin imza hatası tam burada doğar: ayar yazılır, testi geçer,
 * hiçbir şey onu okumaz. Bu dosya ayarın ekranda değil, **davranışta** karşılığı olduğunu tutar:
 * eskalasyon tick'i, duvar ekranı maskelemesi, vardiya sınırı.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  createDemoStore, buildRealisticState, defaultSettings, escalationChain, lastChainStep,
  computeEscalationStep, secondsToNextStep, ESCALATION_STEP, TIER, ROLE,
} from "./clinicalDemo.js";
import { rrtQueue } from "./rrtQueue.js";
import { WallBoard } from "./wallBoard.jsx";
import { getTheme } from "./clinicalTheme.js";
import { cstrings } from "./clinicalI18n.js";

const S = cstrings("tr");
const T = getTheme("icu");

describe("eskalasyon zinciri ayardan gelir", () => {
  it("ayar verilmezse bugünkü davranış aynen sürer — üç kademe, 3/5/10 dk", () => {
    expect(escalationChain(null).map((t) => t.thresholdSec)).toEqual([180, 300, 600]);
    expect(computeEscalationStep(650, TIER.CRITICAL)).toBe(ESCALATION_STEP.TIER_3_RRT);
  });

  it("varsayılan kurulumda 3. kademe kapalı — pilot kararının gereği", () => {
    const chain = escalationChain(defaultSettings());
    expect(chain.map((t) => t.step)).toEqual([
      ESCALATION_STEP.TIER_1_CHARGE_NURSE, ESCALATION_STEP.TIER_2_PHYSICIAN,
    ]);
    expect(lastChainStep(defaultSettings()).step).toBe(ESCALATION_STEP.TIER_2_PHYSICIAN);
  });

  it("kapalı kademe atlanmaz: zincir bir öncekinde biter, alarm orada kalır", () => {
    const st = defaultSettings();
    // 20 dakika cevapsız kalsa bile RRT'ye çıkmaz; hekim kademesinde durur.
    expect(computeEscalationStep(1200, TIER.CRITICAL, st)).toBe(ESCALATION_STEP.TIER_2_PHYSICIAN);
    expect(secondsToNextStep(1200, TIER.CRITICAL, st)).toBeNull();
  });

  it("eşik değişince geri sayım da değişir", () => {
    const st = { escalation: { tiers: { TIER_1_CHARGE_NURSE: { enabled: true, thresholdSec: 60 } } } };
    expect(secondsToNextStep(10, TIER.CRITICAL, st)).toBe(50);
  });

  it("hiçbir kademe açık değilse alarm hiç yükselmez ve bu söylenir", () => {
    const st = { escalation: { tiers: {
      TIER_1_CHARGE_NURSE: { enabled: false }, TIER_2_PHYSICIAN: { enabled: false },
      TIER_3_RRT: { enabled: false } } } };
    expect(escalationChain(st)).toEqual([]);
    expect(lastChainStep(st)).toBeNull();
    expect(computeEscalationStep(99999, TIER.CRITICAL, st)).toBe(ESCALATION_STEP.NONE);
  });
});

describe("motorun tick'i ayarı gerçekten okuyor", () => {
  it("kapalı kademe denetim olayına yazılmaz — gitmeyen adım 'gitti' diye kaydedilmez", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.ATTENDING);
    const pid = store.getState().patients[0].patient_id;
    store.fireAlert({ patientId: pid, tier: TIER.CRITICAL, summary: "SpO2" });
    store.reconcile(1200);        // 20 dk cevapsız: zincirin sonunu rahatça geç
    const a = store.getState().alerts[0];
    expect(a.events.some((e) => e.step === ESCALATION_STEP.TIER_3_RRT)).toBe(false);
    expect(a.currentStep).toBe(ESCALATION_STEP.TIER_2_PHYSICIAN);
  });

  it("kademe açılınca alarm oraya yükselir", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.HOSPITAL_ADMIN);
    store.setEscalationTier(ESCALATION_STEP.TIER_3_RRT, { enabled: true });
    const pid = store.getState().patients[0].patient_id;
    store.fireAlert({ patientId: pid, tier: TIER.CRITICAL, summary: "SpO2" });
    store.reconcile(1200);
    expect(store.getState().alerts[0].currentStep).toBe(ESCALATION_STEP.TIER_3_RRT);
  });

  it("kapalı kademeye elle çağrı reddedilir — gidecek yeri olmayan çağrı yapılmaz", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.ATTENDING);
    const pid = store.getState().patients[0].patient_id;
    store.fireAlert({ patientId: pid, tier: TIER.CRITICAL, summary: "SpO2" });
    const id = store.getState().alerts[0].id;
    expect(() => store.escalateToRRT(id)).toThrow(/kapalı/i);
  });

  it("politika değişikliği denetime düşer", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.HOSPITAL_ADMIN);
    store.setEscalationTier(ESCALATION_STEP.TIER_3_RRT, { enabled: true });
    store.setPrivacyPolicy({ maskOnWall: false });
    store.setShiftPattern("12h", 8);
    const actions = store.getState().auditLog.map((e) => e.action);
    expect(actions).toContain("SETTINGS_ESCALATION");
    expect(actions).toContain("SETTINGS_PRIVACY");
    expect(actions).toContain("SETTINGS_SHIFT");
  });
});

describe("RRT kuyruğu kapalı kademeyi biliyor", () => {
  it("kademe kapalıyken 'yolda' listesi boştur — gelmeyecek çağrı için geri sayım olmaz", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.RRT);
    const pid = store.getState().patients[0].patient_id;
    store.fireAlert({ patientId: pid, tier: TIER.CRITICAL, summary: "SpO2" });
    const q = rrtQueue(store.getState());
    expect(q.tierEnabled).toBe(false);
    expect(q.incoming).toEqual([]);
  });

  it("kademe açıkken cevapsız alarm yolda görünür", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.HOSPITAL_ADMIN);
    store.setEscalationTier(ESCALATION_STEP.TIER_3_RRT, { enabled: true });
    const pid = store.getState().patients[0].patient_id;
    store.fireAlert({ patientId: pid, tier: TIER.CRITICAL, summary: "SpO2" });
    const q = rrtQueue(store.getState());
    expect(q.tierEnabled).toBe(true);
    expect(q.incoming.length).toBe(1);
    expect(q.incoming[0].etaSec).toBe(600);
  });
});

describe("duvar ekranı kurum politikasını uygular", () => {
  const nameOf = (store) => store.getState().patients.find((p) => p.bedLabel)?.display_name;

  it("politika açıkken kullanıcı maskeyi kapatsa bile duvarda isim açılmaz", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.CHARGE_NURSE);
    const state = { ...store.getState(), maskNames: false };   // kullanıcı tercihi: maske kapalı
    render(<WallBoard S={S} state={state} onExit={() => {}} simulation />);
    expect(screen.queryByText(nameOf(store))).toBeNull();
  });

  it("politika kapatılırsa isim görünür — ayar gerçekten okunuyor", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.HOSPITAL_ADMIN);
    store.setPrivacyPolicy({ maskOnWall: false });
    const state = { ...store.getState(), maskNames: false };
    render(<WallBoard S={S} state={state} onExit={() => {}} simulation />);
    expect(screen.getAllByText(nameOf(store)).length).toBeGreaterThan(0);
  });
});

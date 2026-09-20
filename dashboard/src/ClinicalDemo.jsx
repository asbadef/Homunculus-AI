// src/ClinicalDemo.jsx — Homunculus clinical workspace (HBYS-grade shell).
// A production-fidelity operator UI over the in-browser clinical engine (clinicalDemo.js).
// Three runtime themes (clinicalTheme.js), four UI languages (clinicalI18n.js). All data is
// SYNTHETIC and every national ID is masked. The system never diagnoses — machine-generated
// alert text always reads "…kriterleri değerlendirilecek".

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, LayoutGrid, UserPlus, Users, Bell, Settings, ArrowLeftRight, Stethoscope,
  HeartPulse, Building2, ShieldAlert, Sun, Moon, Monitor, ChevronDown, LogOut, Check, BellOff,
  ArrowUpCircle, Play, Pause, Clock, AlertTriangle, Plus, PenLine, Thermometer, Wind, Droplets,
  Gauge, Heart, ClipboardList, Siren, PanelLeftClose, PanelLeft, CheckCircle2, Circle, X,
  FileText, Pill, Droplet, Sliders, Eye, EyeOff, ScrollText, Volume2, VolumeX, TrendingUp,
  StopCircle, Syringe, KeyRound, Wifi, WifiOff, Radio, Network, CloudOff, Cloud, ShieldCheck,
  DoorOpen, BellRing, BarChart3, Bed, Download, Lock, Shield, Fingerprint, Mail, ArrowRight,
  QrCode, MapPin, ArrowLeft, Archive, Sunset, FlaskConical, ScanLine, Grid3x3, RefreshCw,
  PlugZap, Upload, Inbox, HeartHandshake,
} from "lucide-react";
import {
  createDemoStore, buildRealisticState, ROLE, TIER, ESCALATION_STEP, secondsToNextStep,
  canSnooze, snoozeCapMinutes, ACK_REASON_MIN_CHARS, searchIcd10, MED_CATALOG,
  PROCEDURE_CATALOG, computeNews2, maskName, DEFAULT_THRESHOLDS, computeAnalytics,
  profileForPatient,
} from "./clinicalDemo.js";
import { getTheme, storedTheme, persistTheme, THEME_KEYS } from "./clinicalTheme.js";
// Hasta kabul / transfer / bakım ekibi kendi dosyasında: tek ekran düzeni, barkod etiketi ve
// bakım ekibi ataması birlikte durur (bkz. admissionPage.jsx dosya başı).
import { AdmissionPage } from "./admissionPage.jsx";
import { WallBoard } from "./wallBoard.jsx";
import { awaitingLocalAdmission } from "./liveAdapters.js";
import {
  SCOPE_REASON, scopeForUser, visibleAlerts, visibleBeds, visiblePatients, visibleUnits,
} from "./patientScope.js";
import { SeverityScorePanel } from "./severityScore.jsx";
import { formatAge, wardFeedHealth } from "./feedHealth.js";
import {
  Bar, Empty, Field, Flag, HomunculusMark, KpiCard, LangPills, Menu, ModalShell, Row, Section,
  Collapsible, SectionHeader, Sparkline, THEME_ICON, VitrinStat, Waveform, btnCls, fmtClock, inputCls,
  maskedName, riskUi, tierUi, useStore,
} from "./clinicalUi.jsx";
import {
  AlarmQualityPanel, ArchiveManagement, AuditLog, BreakGlassReview, DeviceAdmin, HierarchyTree,
  InviteManagement,
  SessionManagement, StaffMatrix, StructureAdmin, UserAdmin,
} from "./clinicalAdmin.jsx";

import { cstrings, storedClang, persistClang, LANGS } from "./clinicalI18n.js";
import { enableAudio, isAudioEnabled, syncAlarm } from "./clinicalAudio.js";



// Neutral machine-generated alert text (never a diagnosis).
const ALERT_TXT = {
  tr: "Klinik kötüleşme kriterleri değerlendirilecek",
  az: "Klinik pisləşmə kriterləri dəyərləndiriləcək",
  en: "Clinical deterioration criteria to be assessed",
  ru: "Критерии клинического ухудшения будут оценены",
};


function losText(admittedAtMs, S) {
  if (!admittedAtMs) return "—";
  const h = Math.floor((Date.now() - admittedAtMs) / 3600000);
  if (h < 24) return `${h} sa`;
  return `${Math.floor(h / 24)} ${S.dayUnit}`;
}
function ageText(p, S) {
  if (p.isNeonate) return `${p.ageDays ?? 0} ${S.dayUnit}`;
  return `${p.age ?? "—"}`;
}






function Login({ T, S, store, lang, setLang }) {
  const [email, setEmail] = useState("");
  const [credential, setCredential] = useState("");
  const [err, setErr] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    // Kurumsal e-posta + parola. Rol DB'den gelir; panel role göre otomatik yönlenir.
    // attemptLogin: rol MFA gerektiriyorsa oturumu açmadan MFA kapısına yönlendirir (mfaPending).
    // `await` hem simülasyonun senkron sürümünü hem canlı backend'in async sürümünü karşılar.
    setErr("");
    setBusy(true);
    try { await store.attemptLogin(email.trim(), credential.trim()); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  const iconInput = (icon, node) => (
    <div className="relative">
      <span className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${T.faint}`}>{icon}</span>
      {node}
    </div>
  );

  return (
    <div className={`relative min-h-screen ${T.app} flex overflow-hidden`}>
      {/* ============ SOL: Marka vitrini (yalnızca geniş ekran / web) ============ */}
      <aside className="relative hidden w-[46%] max-w-[640px] flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-brand/30 p-10 text-white lg:flex xl:p-12">
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand/40 blur-3xl animate-pulse" />
        <div className="pointer-events-none absolute -bottom-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-cyan-500/30 blur-3xl animate-pulse" style={{ animationDelay: "1.4s" }} />
        <svg className="pointer-events-none absolute inset-x-0 top-1/2 h-48 w-full -translate-y-1/2 opacity-[0.12]" preserveAspectRatio="none" viewBox="0 0 1200 120">
          <polyline fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400"
            points="0,60 180,60 210,60 225,18 240,102 255,60 420,60 450,60 465,24 480,96 495,60 660,60 690,60 705,18 720,102 735,60 900,60 930,60 945,24 960,96 975,60 1200,60" />
        </svg>

        {/* Logo + wordmark */}
        <div className="relative z-10 flex items-center gap-3">
          <HomunculusMark size={48} />
          <div>
            <div className="text-xl font-black tracking-tight">{S.appName}</div>
            <div className="text-xs font-medium text-white/70">{S.tagline}</div>
          </div>
        </div>

        {/* Headline + değer önermeleri */}
        <div className="relative z-10 max-w-md">
          <h2 className="mb-3 text-3xl font-black leading-tight xl:text-[2.6rem]">{S.pr9.brandHeadline}</h2>
          <p className="mb-8 text-sm leading-relaxed text-white/75">{S.pr9.brandSub}</p>
          <ul className="space-y-4">
            {S.pr9.props.map(([title, desc], i) => {
              const Icon = [TrendingUp, Siren, Network][i] || Activity;
              return (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
                    <Icon size={17} className="text-cyan-300" />
                  </span>
                  <div>
                    <div className="text-sm font-bold">{title}</div>
                    <div className="text-xs leading-snug text-white/60">{desc}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ⚠️ Burada "12.480 alarm · 8 sn · %99,9" yazan üç kutu vardı ve hiçbiri ölçülmüş
            değildi — giriş ekranı henüz kimseyi tanımadığı için ölçemez de. Sahte bir rakam,
            uydurma veri göstermeyeceğini söyleyen bir ürünün ilk ekranında duruyordu; hastane
            IT'si ilk sorduğunda savunulacak bir tarafı da yok.
            Yerine ürünün gerçekten taahhüt ettiği üç şey kondu: ikisi anayasası, biri dağıtım
            modeli. Hepsi doğrulanabilir. */}
        <div className="relative z-10 space-y-3">
          <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 backdrop-blur">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-cyan-300/80">
              {S.pr9.promiseTitle}
            </div>
            <ul className="space-y-2 text-xs leading-relaxed text-white/70">
              <li className="flex gap-2"><span className="text-cyan-300">·</span>{S.pr9.promiseNoDiagnosis}</li>
              <li className="flex gap-2"><span className="text-cyan-300">·</span>{S.pr9.promiseNoOrders}</li>
              <li className="flex gap-2"><span className="text-cyan-300">·</span>{S.pr9.promiseOnPrem}</li>
            </ul>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-medium text-white/50">
            <ShieldCheck size={13} className="text-emerald-400" /> {S.pr8.loginBrandLine}
          </div>
        </div>
      </aside>

      {/* ============ SAĞ: Giriş formu ============ */}
      <main className="relative flex flex-1 flex-col items-center justify-center p-6 sm:p-10">
        {/* Dekoratif arka plan — ince ızgara + yumuşak ışıma (sağ taraf artık boş durmuyor) */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand/10 via-transparent to-cyan-500/10 lg:from-brand/[0.06] lg:to-cyan-500/[0.06]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.4] dark:opacity-[0.25]"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(13,148,136,0.18) 1px, transparent 0)", backgroundSize: "26px 26px" }} />
        <div className="pointer-events-none absolute -right-20 top-1/4 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
        {/* Üst-sağ dil seçici */}
        <div className="absolute right-5 top-5 z-20">
          <LangPills T={T} lang={lang} setLang={setLang} />
        </div>

        <div className="relative z-10 w-full max-w-sm">
          {/* Mobil logo (marka paneli gizliyken) */}
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <HomunculusMark size={44} />
            <div>
              <div className={`text-lg font-black ${T.heading}`}>{S.appName}</div>
              <div className={`text-xs ${T.muted}`}>{S.pr8.loginWelcome}</div>
            </div>
          </div>

          <h1 className={`mb-1 text-2xl font-black ${T.heading}`}>{S.loginTitle}</h1>
          <p className={`mb-6 text-sm ${T.muted}`}>{S.loginSub}</p>

          <form onSubmit={submit} className="space-y-4">
            <Field T={T} label={S.email}>
              {iconInput(<Mail size={16} />,
                <input className={`${inputCls(T)} pl-9`} value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="ad.soyad@kurum.health" autoComplete="username" />)}
            </Field>
            <Field T={T} label={S.pr7.loginPinLabel}>
              {iconInput(<Lock size={16} />,
                <input type="password" className={`${inputCls(T)} pl-9`} value={credential}
                  onChange={(e) => setCredential(e.target.value)} placeholder="••••••••" autoComplete="current-password" />)}
            </Field>
            {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
            <button type="submit" className={`${btnCls(T, "primary")} group w-full`}>
              {S.signIn}
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </form>

          <div className="mt-3 text-center">
            <button type="button" onClick={() => setShowForgot((v) => !v)}
              className={`text-xs font-medium ${T.accent} hover:underline`}>{S.pr9.forgot}</button>
            {showForgot && (
              <div className={`mt-2 rounded-lg ${T.glassSubtle} px-3 py-2 text-xs ${T.muted}`}>{S.pr9.forgotHelp}</div>
            )}
          </div>

          <p className={`mt-6 text-center text-[11px] leading-snug ${T.faint}`}>{S.pr9.kvkkNote}</p>

          {/* Uyum & standart rozetleri — sağ tarafı doldurur, kurumsal güven verir */}
          <div className="mt-7">
            <div className={`mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider ${T.faint}`}>
              <span className={`h-px flex-1 ${T.border} border-t`} />
              {S.pr19.loginStandards}
              <span className={`h-px flex-1 ${T.border} border-t`} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[[ShieldCheck, S.pr19.loginTrustKvkk], [Lock, S.pr19.loginTrustIso],
                [Network, S.pr19.loginTrustHl7], [Radio, S.pr19.loginTrustDevice]].map(([Icon, label], i) => (
                <div key={i} className={`flex items-center gap-2 rounded-lg border ${T.border} ${T.glassSubtle} px-2.5 py-2`}>
                  <Icon size={15} className="shrink-0 text-brand" />
                  <span className={`text-[11px] font-medium leading-tight ${T.muted}`}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Alt bilgi — imza satırı */}
        <div className={`relative z-10 mt-8 text-center text-[11px] ${T.faint}`}>
          <div className="italic">{S.pr19.loginQuote}</div>
          <div className="mt-1 flex items-center justify-center gap-1.5">
            <Activity size={12} className="text-brand" /> {S.appName} · {S.pr19.loginSince}
          </div>
        </div>
      </main>
    </div>
  );
}


// ---------------------------------------------------------------- MFA kapısı (Madde 6)
// Şifre girişi sonrası, rol iki adımlı doğrulama gerektiriyorsa gösterilir (state.mfaPending).
// Kayıtlı değilse önce TOTP kurulumu (QR + gizli anahtar) yapılır, sonra 6 haneli kod doğrulanır.
function MfaGate({ T, S, store, pending, lang, setLang }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [setup, setSetup] = useState(null); // { provisioningUri, secret } — kayıtsız kullanıcılar için
  const enrolled = pending.enrolled;

  // Kayıtlı değilse TOTP kurulumunu bir kez başlat (QR + secret üret).
  useEffect(() => {
    if (!enrolled) {
      try { setSetup(store.setupMfa({ userId: pending.userId })); } catch { /* ignore */ }
    }
  }, [enrolled, pending.userId]);

  const verify = async (e) => {
    e.preventDefault();
    // `await` karşılar: simülasyon senkron, canlı backend async.
    setErr("");
    try { await store.completeMfaLogin(code.trim()); } catch (ex) { setErr(ex.message); }
  };

  return (
    <div className={`relative flex min-h-screen items-center justify-center overflow-hidden ${T.app} p-6`}>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand/10 via-transparent to-cyan-500/10" />
      <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand/20 blur-3xl" />
      <div className="absolute right-5 top-5 z-20"><LangPills T={T} lang={lang} setLang={setLang} /></div>

      <div className={`relative z-10 w-full max-w-md rounded-3xl border ${T.border} ${T.card} p-7 shadow-2xl`}>
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand to-cyan-500 text-white shadow-lg">
            <Fingerprint size={24} />
          </span>
          <div>
            <h1 className={`text-xl font-black ${T.heading}`}>{S.pr11.mfaGateTitle}</h1>
            <p className={`text-xs ${T.muted}`}>{pending.full_name} · {S.roleName[pending.role]}</p>
          </div>
        </div>

        <p className={`mb-4 text-sm ${T.muted}`}>{enrolled ? S.pr11.mfaGateSub : S.pr11.mfaGateSetupSub}</p>

        {/* Kayıtsız kullanıcı: QR + gizli anahtar göster */}
        {!enrolled && setup && (
          <div className={`mb-4 rounded-2xl border ${T.border} ${T.glassSubtle} p-4`}>
            <div className={`mx-auto mb-3 grid h-32 w-32 place-items-center rounded-xl ${T.subtle}`}>
              <QrCode size={104} className={T.faint} />
            </div>
            <div className={`text-center text-[11px] ${T.faint}`}>
              {S.pr11.mfaSecretLabel}: <code className="font-mono">{setup.secret.slice(0, 16)}…</code>
            </div>
          </div>
        )}

        <form onSubmit={verify} className="space-y-3">
          <Field T={T} label={S.pr11.mfaCodeLabel}>
            <input inputMode="numeric" maxLength={6} autoFocus value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setErr(""); }}
              placeholder={S.pr11.mfaCodePlaceholder}
              className={`${inputCls(T)} text-center text-2xl font-black tracking-[0.5em]`} />
          </Field>
          {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
          <button type="submit" className={`${btnCls(T, "primary")} group w-full`}>
            <ShieldCheck size={16} /> {S.pr11.mfaVerifyCta}
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </button>
        </form>

        <div className="mt-3 flex items-center justify-between">
          <button onClick={() => store.cancelMfaLogin()}
            className={`inline-flex items-center gap-1 text-xs font-medium ${T.accent} hover:underline`}>
            <ArrowLeft size={13} /> {S.pr11.mfaBack}
          </button>
          <span className={`text-[11px] ${T.faint}`}>{S.pr11.mfaDemoHint}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Kurum kurulum sihirbazı (Madde 5)
// Platform ilk kez kuruluyorsa (state.tenantSetup=false) yönetici girişinde gösterilir.
// Adımlar: Kurum (tenant) → Kampüs (site) → Tamamlandı. "Şimdilik atla" ile geçilebilir.
function SetupWizard({ T, S, store, lang, setLang }) {
  const [step, setStep] = useState(0); // 0=tenant, 1=site, 2=done
  const [err, setErr] = useState("");
  const [tenant, setTenant] = useState(null);
  const [tf, setTf] = useState({ name: "", slug: "", countryCode: "TR", timezone: "Europe/Istanbul" });
  const [sf, setSf] = useState({ name: "", address: "" });

  const slugify = (s) => s.toLowerCase().trim()
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" }[c] || c))
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const steps = [S.pr11.wizStepTenant, S.pr11.wizStepSite, S.pr11.wizStepDone];
  const stepIcons = [Building2, MapPin, CheckCircle2];

  const nextFromTenant = (e) => {
    e.preventDefault();
    try {
      const t = store.createTenant({ name: tf.name, slug: tf.slug || slugify(tf.name),
        countryCode: tf.countryCode, timezone: tf.timezone });
      setTenant(t); setErr(""); setStep(1);
    } catch (ex) { setErr(ex.message); }
  };
  const finishSite = (e) => {
    e.preventDefault();
    try {
      store.createSite({ tenantId: tenant.id, name: sf.name, address: sf.address || null });
      store.completeTenantSetup();
      setErr(""); setStep(2);
    } catch (ex) { setErr(ex.message); }
  };
  const skip = () => { try { store.completeTenantSetup(); } catch { /* ignore */ } };

  return (
    <div className={`relative flex min-h-screen items-center justify-center overflow-hidden ${T.app} p-6`}>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand/10 via-transparent to-cyan-500/10" />
      <div className="absolute right-5 top-5 z-20"><LangPills T={T} lang={lang} setLang={setLang} /></div>

      <div className={`relative z-10 w-full max-w-lg rounded-3xl border ${T.border} ${T.card} p-7 shadow-2xl`}>
        <div className="mb-5 flex items-center gap-3">
          <HomunculusMark size={44} />
          <div>
            <h1 className={`text-xl font-black ${T.heading}`}>{S.pr11.wizTitle}</h1>
            <p className={`text-xs ${T.muted}`}>{S.pr11.wizSub}</p>
          </div>
        </div>

        {/* Adım göstergesi */}
        <div className="mb-6 flex items-center gap-2">
          {steps.map((label, i) => {
            const I = stepIcons[i]; const done = i < step; const active = i === step;
            return (
              <React.Fragment key={i}>
                <div className="flex items-center gap-2">
                  <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold transition
                    ${active ? "bg-brand text-white shadow" : done ? "bg-emerald-500 text-white" : `${T.subtle} ${T.faint}`}`}>
                    {done ? <Check size={15} /> : <I size={15} />}
                  </span>
                  <span className={`text-xs font-semibold ${active ? T.heading : T.faint}`}>{label}</span>
                </div>
                {i < steps.length - 1 && <span className={`h-px flex-1 ${done ? "bg-emerald-500" : T.divide}`} />}
              </React.Fragment>
            );
          })}
        </div>

        {err && <div className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}

        {/* Adım 1 — Kurum */}
        {step === 0 && (
          <form onSubmit={nextFromTenant} className="space-y-3">
            <Field T={T} label={S.pr11.wizTenantName}>
              <input className={inputCls(T)} value={tf.name} autoFocus
                onChange={(e) => setTf((s) => ({ ...s, name: e.target.value, slug: slugify(e.target.value) }))}
                placeholder="Örn. Acıbadem Sağlık Grubu" />
            </Field>
            <Field T={T} label={S.pr11.wizTenantSlug}>
              <input className={inputCls(T)} value={tf.slug}
                onChange={(e) => setTf((s) => ({ ...s, slug: slugify(e.target.value) }))}
                placeholder="acibadem" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field T={T} label={S.pr11.wizCountry}>
                <select className={inputCls(T)} value={tf.countryCode}
                  onChange={(e) => setTf((s) => ({ ...s, countryCode: e.target.value,
                    timezone: e.target.value === "AZ" ? "Asia/Baku" : "Europe/Istanbul" }))}>
                  <option value="TR">Türkiye (TR)</option>
                  <option value="AZ">Azərbaycan (AZ)</option>
                </select>
              </Field>
              <Field T={T} label={S.pr11.wizTimezone}>
                <select className={inputCls(T)} value={tf.timezone}
                  onChange={(e) => setTf((s) => ({ ...s, timezone: e.target.value }))}>
                  <option value="Europe/Istanbul">Europe/Istanbul</option>
                  <option value="Asia/Baku">Asia/Baku</option>
                </select>
              </Field>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={skip} className={`${btnCls(T, "ghost")} text-sm`}>{S.pr11.wizSkip}</button>
              <button type="submit" className={`${btnCls(T, "primary")} group ml-auto`}>
                {S.pr11.wizNext} <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </form>
        )}

        {/* Adım 2 — Kampüs */}
        {step === 1 && (
          <form onSubmit={finishSite} className="space-y-3">
            <div className={`rounded-xl ${T.glassSubtle} px-3 py-2 text-xs ${T.muted}`}>
              <Check size={13} className="mr-1 inline text-emerald-500" />{S.pr11.wizCreatedTenant}: <b>{tenant?.name}</b>
            </div>
            <Field T={T} label={S.pr11.wizSiteName}>
              <input className={inputCls(T)} value={sf.name} autoFocus
                onChange={(e) => setSf((s) => ({ ...s, name: e.target.value }))}
                placeholder="Örn. Merkez Kampüs" />
            </Field>
            <Field T={T} label={S.pr11.wizSiteAddress}>
              <input className={inputCls(T)} value={sf.address}
                onChange={(e) => setSf((s) => ({ ...s, address: e.target.value }))} />
            </Field>
            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={() => { setStep(0); setErr(""); }} className={`${btnCls(T, "ghost")} text-sm`}>
                <ArrowLeft size={15} /> {S.pr11.wizBack}
              </button>
              <button type="submit" className={`${btnCls(T, "primary")} ml-auto`}>
                <Check size={16} /> {S.pr11.wizFinish}
              </button>
            </div>
          </form>
        )}

        {/* Adım 3 — Tamamlandı */}
        {step === 2 && (
          <div className="py-4 text-center">
            <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
              <CheckCircle2 size={40} />
            </span>
            <h2 className={`mb-1 text-lg font-black ${T.heading}`}>{S.pr11.wizDoneTitle}</h2>
            <p className={`mx-auto mb-5 max-w-sm text-sm ${T.muted}`}>{S.pr11.wizDoneSub}</p>
            <button onClick={skip} className={`${btnCls(T, "primary")} group mx-auto`}>
              {S.pr11.wizGoDashboard} <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Fast PIN switcher modal (3-sec shift change)
function PinSwitchModal({ T, S, store, onClose }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const submit = (e) => {
    e.preventDefault();
    try { store.switchUserByPin(pin); onClose(); } catch (ex) { setErr(ex.message); }
  };
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div className={`absolute inset-0 ${T.overlay}`} onClick={onClose} />
      <div className={`relative w-full max-w-sm rounded-2xl border ${T.border} ${T.card} p-6`}>
        <div className="mb-3 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand/15 text-brand"><KeyRound size={18} /></div>
          <div>
            <div className={`font-bold ${T.heading}`}>{S.pr7.pinSwitchTitle}</div>
            <div className={`text-xs ${T.faint}`}>{S.pr7.pinSwitchInfo}</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input autoFocus inputMode="numeric" maxLength={4} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            className={`${inputCls(T)} text-center text-2xl tracking-[0.6em]`} placeholder="••••" />
          {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={`${btnCls(T, "ghost")} flex-1`}>{S.pr7.pinCancel}</button>
            <button type="submit" className={`${btnCls(T, "primary")} flex-1`}>{S.pr7.pinConfirm}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ================================================================ SHIFT MENU
// Sağ üst vardiya göstergesi — saate göre otomatik algılanır (Gündüz/Akşam/Gece),
// menüden elle sabitlenebilir. İmzalanmamış devir varsa rozetle uyarır.
const SHIFT_DEFS = [
  { key: "morning", icon: Sun, from: 8, to: 16 },
  { key: "evening", icon: Sunset, from: 16, to: 24 },
  { key: "night", icon: Moon, from: 0, to: 8 },
];
function autoShiftKey(h) { return h < 8 ? "night" : h < 16 ? "morning" : "evening"; }
function shiftLabel(S, key) {
  return key === "morning" ? S.pr19.shiftMorning : key === "evening" ? S.pr19.shiftEvening : S.pr19.shiftNightHrs;
}
function ShiftMenu({ T, S, state }) {
  const [pin, setPin] = useState(null);
  const hour = new Date().getHours();
  const active = pin || autoShiftKey(hour);
  const ActiveIcon = (SHIFT_DEFS.find((s) => s.key === active) || SHIFT_DEFS[0]).icon;
  const unsigned = (state.shiftHandovers || []).filter((h) => !h.signedBy).length;
  return (
    <Menu T={T} align="right"
      triggerClass={`hidden items-center gap-2 rounded-lg px-3 py-1.5 md:flex ${T.chip} relative`}
      trigger={<>
        <ActiveIcon size={15} className="text-brand" />
        <div className="leading-tight text-left">
          <div className="text-xs font-semibold">{shiftLabel(S, active).split(" (")[0]}</div>
          <div className="text-[10px] opacity-70">{S.onDuty}</div>
        </div>
        <ChevronDown size={13} className="opacity-60" />
        {unsigned > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">{unsigned}</span>}
      </>}>
      {({ close }) => (
        <div className="w-60">
          <div className={`px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide ${T.faint}`}>{S.pr19.shiftMenuTitle}</div>
          {SHIFT_DEFS.map((s) => {
            const I = s.icon; const isActive = s.key === active; const isAuto = s.key === autoShiftKey(hour);
            return (
              <button key={s.key} onClick={() => { setPin(s.key); close(); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${T.navIdle} ${T.sizes.nav}`}>
                <I size={16} className={isActive ? "text-brand" : T.faint} />
                <span className="flex-1">{shiftLabel(S, s.key)}</span>
                {isAuto && <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${T.subtle} ${T.faint}`}>auto</span>}
                {isActive && <Check size={15} className="text-brand" />}
              </button>
            );
          })}
          {pin && (
            <button onClick={() => { setPin(null); close(); }}
              className={`mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle} ${T.sizes.nav}`}>
              <RefreshCw size={14} /> {S.pr19.switchShift} (auto)
            </button>
          )}
          {unsigned > 0 && (
            <div className={`mt-1 flex items-center gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs font-medium text-amber-600 dark:text-amber-400`}>
              <PenLine size={14} /> {unsigned} {S.pr19.handoverPending}
            </div>
          )}
        </div>
      )}
    </Menu>
  );
}

// ================================================================ TOP BAR
/**
 * Üst bar — üç bölge: NEREDEYİM · NE OLUYOR · BEN.
 *
 * Eskisi on iki ikonu yan yana aynı ağırlıkta diziyordu: bulut, ses, bildirim, test, siren,
 * göz, tema, dört bayrak, vardiya, çıkış. Hangisinin durum göstergesi hangisinin düğme olduğu
 * belli değildi ve dört bayrak kalıcı olarak 150 piksel yer tutuyordu.
 *
 * Yeni düzende ayrım şu: bir şeyin üst barda sürekli yeri olması için **koğuşun o andaki
 * durumunu** söylemesi gerekir. Cihaz akışı ve açık alarm sayısı bunu yapar — ikisi de
 * tıklanınca ilgili ekrana götürür. Ses, bildirim, tema, dil, maskeleme birer tercihtir ve
 * kullanıcı menüsüne iner; ama **bozulduklarında** (ses kapalı, bildirim kapalı, çevrimdışı)
 * durum çipi olarak geri çıkarlar — sessiz bir alarm sisteminin sessiz kaldığını söylemesi
 * bir tercih değil, güvenlik bilgisidir.
 */
function StatusChip({ T, tone = "neutral", icon: Icon, label, onClick, title }) {
  const tones = {
    good: "bg-emerald-500/12 text-emerald-500 ring-1 ring-emerald-500/25",
    warn: "bg-amber-500/12 text-amber-500 ring-1 ring-amber-500/25",
    bad: "bg-red-500/12 text-red-500 ring-1 ring-red-500/25",
    neutral: `${T.subtle} ${T.muted}`,
  };
  const cls = `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${tones[tone] || tones.neutral}`;
  if (!onClick) return <span className={cls} title={title}>{Icon && <Icon size={13} />}{label}</span>;
  return (
    <button type="button" onClick={onClick} title={title} className={`${cls} transition hover:opacity-80`}>
      {Icon && <Icon size={13} />}{label}
    </button>
  );
}

function TopBar({ T, S, store, state, page, lang, setLang, theme, setTheme, onMenu, setPage, onWallMode,
                 soundOn, onEnableSound, notifyPerm, onEnableNotify, onTestPush, notifyBlocked }) {
  const user = state.user;
  const P = S.top || {};
  const [pinOpen, setPinOpen] = useState(false);
  const RoleIcon = user?.role === ROLE.HOSPITAL_ADMIN ? ShieldAlert
    : user?.role === ROLE.CHARGE_NURSE ? HeartPulse : Stethoscope;
  const online = state.online !== false;
  const topScope = scopeForUser(state, UNRESTRICTED_SCOPE_ROLES);
  const openAlarms = visibleAlerts(state, topScope).filter((a) => a.status === "FIRED").length;
  // Besleme sağlığı: "sessiz" yatak, cihazı hiç konuşmayan yataktır. On-prem'de köprüye
  // dışarıdan bakılamadığı için bu sayı üst barın taşıdığı en pahalı bilgidir.
  //
  // ⚠️ Ölçüm saati hiç taşımayan bir pano (simülasyon, ya da `latest.at` yayınlamayan eski bir
  // motor) her yatağı "sessiz" gösterirdi — kartında "CANLI" yazan yatağı bile. Bilinmeyeni
  // kötü haber diye göstermek, gerçek bir kesintiyi de inandırıcılıktan düşürür: saat yoksa
  // çip hiç çıkmaz.
  const patients = state.patients || [];
  const hasFeedClock = patients.some((p) => p?.measuredAt && Object.keys(p.measuredAt).length > 0);
  const feeds = wardFeedHealth(patients);
  const feedTone = feeds.silentCount > 0 ? "bad" : feeds.staleCount > 0 ? "warn" : "good";
  const initials = (user?.full_name || "")
    .split(" ").filter(Boolean).slice(-2).map((w) => w[0]).join("").toUpperCase() || "?";

  return (
    <header className={`sticky top-0 z-30 flex items-center gap-3 border-b ${T.border} ${T.topbar} px-4 py-2.5 backdrop-blur`}>
      {/* --- NEREDEYİM --- */}
      <button onClick={onMenu} aria-label={S.expand} className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${T.ghost} lg:hidden`}>
        <PanelLeft size={18} />
      </button>
      <div className="min-w-0 shrink">
        <div className={`truncate font-bold ${T.heading} ${T.sizes.name}`}>{S.nav[page]}</div>
        <div className={`truncate text-xs ${T.faint}`}>{state.structure.tenant} · {state.structure.site}</div>
      </div>

      {/* --- NE OLUYOR --- */}
      <div className="ml-4 hidden items-center gap-2 md:flex">
        {hasFeedClock && (
          <StatusChip T={T} tone={feedTone} icon={Radio}
            label={feeds.silentCount > 0
              ? `${feeds.silentCount} ${P.feedSilent || "yatak sessiz"}`
              : `${feeds.healthyCount + feeds.staleCount} ${P.feedLive || "yatak akıyor"}`}
            title={P.feedTitle} onClick={() => setPage("tech")} />
        )}
        <StatusChip T={T} tone={openAlarms > 0 ? "bad" : "neutral"} icon={Bell}
          label={`${openAlarms} ${P.openAlarms || "açık alarm"}`}
          onClick={() => setPage("alarms")} />
        {/* Yalnız bozukken görünenler */}
        {!online && <StatusChip T={T} tone="warn" icon={CloudOff} label={S.pr7.offlineBanner} onClick={() => store.setOnline(true)} />}
        {!soundOn && <StatusChip T={T} tone="warn" icon={VolumeX} label={P.soundOff || "Ses kapalı"} onClick={onEnableSound} />}
        {notifyPerm !== "granted" && (
          <StatusChip T={T} tone="warn" icon={BellOff} label={P.notifyOff || "Bildirim kapalı"}
            title={notifyBlocked ? S.pr8.notifyNeedsHttps : undefined} onClick={onEnableNotify} />
        )}
      </div>

      {/* --- BEN --- */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <ShiftMenu T={T} S={S} state={state} />
        <Menu T={T}
          triggerClass={`inline-flex items-center gap-2 rounded-xl border ${T.border} ${T.subtle} py-1.5 pl-1.5 pr-2.5`}
          trigger={<>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/15 text-[11px] font-bold text-brand">{initials}</span>
            <span className="hidden flex-col items-start leading-tight sm:flex">
              <span className={`text-xs font-semibold ${T.text}`}>{user?.full_name}</span>
              <span className={`text-[10px] ${T.faint}`}>{S.roleName[user?.role]} · {lang.toUpperCase()}</span>
            </span>
            <ChevronDown size={13} className={T.faint} />
          </>}>
          {({ close }) => (
            <div className="min-w-[17rem]">
              <div className={`flex items-center gap-2.5 px-2.5 pb-2 pt-1`}>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand/15 text-brand"><RoleIcon size={17} /></span>
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-semibold ${T.text}`}>{user?.full_name}</span>
                  <span className={`block truncate text-xs ${T.faint}`}>{S.roleName[user?.role]}</span>
                </span>
              </div>
              <div className={`my-1 border-t ${T.border}`} />

              <button onClick={() => { setPinOpen(true); close(); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${T.navIdle} ${T.sizes.nav}`}>
                <KeyRound size={15} className="text-brand" /> {S.pr7.fastSwitch}
              </button>

              <div className={`px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide ${T.faint}`}>{P.display || S.themeLabel}</div>
              <div className="flex flex-wrap gap-1 px-2 pb-1">
                {THEME_KEYS.map((k) => { const I = THEME_ICON[k]; return (
                  <button key={k} onClick={() => setTheme(k)} title={S.theme[k]} aria-label={S.theme[k]}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs ${theme === k ? T.navActive : T.navIdle}`}>
                    <I size={14} /> {S.theme[k]}
                  </button>
                ); })}
              </div>
              <div className="flex flex-wrap gap-1 px-2 pb-1 pt-1">
                {LANGS.map(([code, label]) => (
                  <button key={code} onClick={() => setLang(code)} title={label} aria-label={label}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 ${lang === code ? T.navActive : T.navIdle}`}>
                    <Flag code={code} className="h-3 w-4" />
                    <span className="text-[11px] font-bold uppercase">{code}</span>
                  </button>
                ))}
              </div>

              {/* Banko ekranı: kabuk kalkar, ekranın tamamı yataklar olur. Tam ekran isteği
                  kullanıcı hareketine bağlı olmak zorunda — bu yüzden burada, tıklamanın
                  içinde yapılıyor. */}
              <button onClick={() => {
                  document.documentElement.requestFullscreen?.().catch(() => { /* tarayıcı reddedebilir */ });
                  onWallMode?.();
                  close();
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${T.navIdle} ${T.sizes.nav}`}>
                <Monitor size={15} className={T.faint} />
                <span className="flex-grow">{P.wallMode || "Duvar ekranı"}</span>
              </button>

              <div className={`px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide ${T.faint}`}>{P.alarmsAndPrivacy || S.alarmsTitle}</div>
              <button onClick={onEnableSound}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${T.navIdle} ${T.sizes.nav}`}>
                {soundOn ? <Volume2 size={15} className="text-brand" /> : <VolumeX size={15} className="text-amber-500" />}
                <span className="flex-grow">{soundOn ? S.pr7.soundOn : S.pr7.soundOff}</span>
              </button>
              <button onClick={onEnableNotify}
                title={notifyBlocked ? S.pr8.notifyNeedsHttps : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${T.navIdle} ${T.sizes.nav}`}>
                {notifyPerm === "granted" ? <Bell size={15} className="text-brand" /> : <BellOff size={15} className="text-amber-500" />}
                <span className="flex-grow">{notifyPerm === "granted" ? S.pr7.notifyOn : S.pr7.notifyEnable}</span>
              </button>
              {notifyPerm === "granted" && (
                <button onClick={onTestPush}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${T.navIdle} ${T.sizes.nav}`}>
                  <Radio size={15} className="text-emerald-500" /> {S.pr8.sendTestPush}
                </button>
              )}
              <button onClick={() => store.setAutoAlarm(!state.autoAlarm)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${T.navIdle} ${T.sizes.nav}`}>
                {state.autoAlarm ? <Siren size={15} className="text-red-500" /> : <BellOff size={15} className={T.faint} />}
                <span className="flex-grow">{state.autoAlarm ? S.pr6.autoAlarmOn : S.pr6.autoAlarmOff}</span>
              </button>
              <button onClick={() => store.toggleMaskNames()}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${T.navIdle} ${T.sizes.nav}`}>
                {state.maskNames ? <EyeOff size={15} className="text-brand" /> : <Eye size={15} className={T.faint} />}
                <span className="flex-grow">{S.pr6.maskNames}</span>
              </button>
              <button onClick={() => store.setOnline(!online)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${T.navIdle} ${T.sizes.nav}`}>
                {online ? <Cloud size={15} className="text-emerald-500" /> : <CloudOff size={15} className="text-amber-500" />}
                <span className="flex-grow">{online ? S.pr7.goOffline : S.pr7.goOnline}</span>
              </button>

              <div className={`my-1 border-t ${T.border}`} />
              <button onClick={() => store.logout()}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-red-500 hover:bg-red-500/10 ${T.sizes.nav}`}>
                <LogOut size={15} /> {S.logout}
              </button>
            </div>
          )}
        </Menu>
      </div>
      {pinOpen && <PinSwitchModal T={T} S={S} store={store} onClose={() => setPinOpen(false)} />}
    </header>
  );
}

// ================================================================ SIDEBAR
const NAV_ITEMS = [
  { key: "board", icon: LayoutGrid, roles: "all", group: "clinical" },
  // Bakım ekibi ataması bu ekranın üçüncü sekmesi. Kendi menü maddesiyken aynı üç rolü
  // ilgilendiriyor ve kabul formundaki "sorumlu hekim / hemşire" alanlarının aynısını yapıyordu.
  { key: "admission", icon: UserPlus, roles: [ROLE.ATTENDING, ROLE.CHARGE_NURSE, ROLE.HOSPITAL_ADMIN], group: "clinical" },
  { key: "alarms", icon: Bell, roles: "all", group: "clinical" },
  { key: "results", icon: Inbox, roles: [ROLE.ATTENDING, ROLE.CHARGE_NURSE, ROLE.HOSPITAL_ADMIN], group: "ops" },
  // ⚠️ Isı haritası buradan kaldırıldı: yatak paneliyle aynı veriyi (NEWS2 + açık alarm)
  // daha azıyla gösteriyordu — isim yok, vital yok, alarm metni yok. İki ekranın aynı soruya
  // cevap vermesi, hangisine bakılacağını da belirsizleştiriyordu. Ünite düzeyinde yoğunluk
  // bir yönetim sorusudur; ekran yönetici panelinde sekme olarak duruyor.
  // Biomedical could reach no screen of its own: DeviceAdmin was written, but locked inside the
  // admin page, which only HOSPITAL_ADMIN can open. So the role responsible for the devices was
  // the one role that could not see them. This page is theirs — device inventory plus the feed
  // health that on-prem makes impossible to check from anywhere else.
  { key: "tech", icon: Radio, roles: [ROLE.BIOMEDICAL, ROLE.HOSPITAL_ADMIN], group: "ops" },
  // The pharmacist's own page. Until now PHARMACIST, RAPID_RESPONSE and BIOMEDICAL saw the same
  // three screens and none of them appeared here — "rol var, işi yok". The antibiotic clock is
  // this role's work, and it was reachable only as an alert that had already fired.
  { key: "pharmacy", icon: Pill, roles: [ROLE.PHARMACIST, ROLE.ATTENDING, ROLE.HOSPITAL_ADMIN], group: "clinical" },
  { key: "admin", icon: Settings, roles: [ROLE.HOSPITAL_ADMIN], group: "admin" },
];
const NAV_GROUPS = [
  { id: "clinical", label: "navGroupClinical" },
  { id: "ops", label: "navGroupOps" },
  { id: "admin", label: "navGroupAdmin" },
];
function canSee(item, role) { return item.roles === "all" || item.roles.includes(role); }

// Hasta listesi kısıtlanmayan roller: biri kurumu yönetir, diğeri cihaz envanterini —
// ikisi de koğuşun tamamına bakar. (Biyomedikalin hasta *adını* görmemesi ayrı bir iş.)
const UNRESTRICTED_SCOPE_ROLES = [ROLE.HOSPITAL_ADMIN, ROLE.BIOMEDICAL];

/**
 * Menüdeki sayı rozeti — işin nerede biriktiğini menüden okutur.
 *
 * Yalnız **bekleyen iş** sayılır: açık alarm, görülmemiş sonuç, yatağa alınmayı bekleyen HBYS
 * hastası. Toplam sayı (kaç hasta, kaç cihaz) rozete girmez; rozet kırmızıdır ve kırmızı bir
 * sayı her zaman "burada bekleyen bir şey var" demek zorundadır, yoksa okunmaz olur.
 */
function navBadge(key, state) {
  const scope = scopeForUser(state, UNRESTRICTED_SCOPE_ROLES);
  if (key === "alarms") return visibleAlerts(state, scope).filter((a) => a.status === "FIRED").length;
  if (key === "results") {
    const ids = new Set(visiblePatients(state, scope).map((p) => p.patient_id));
    return (state.results || []).filter((r) => r.status !== "reviewed" && ids.has(r.patientId)).length;
  }
  if (key === "admission") return awaitingLocalAdmission(visiblePatients(state, scope)).length;
  return 0;
}

/**
 * Sol panel — iki genişlik, ikisi de okunabilir.
 *
 * Daraltılmış hâl artık yalnız ikon değildir: ikonun altında kısa ad durur (S.navShort). Yalnız
 * ikon bırakan menü, ikonu ezberlememiş herkes için tahmin oyunudur ve vardiyaya yeni başlayan
 * hemşire tam olarak o kişidir. Kısa ad ayrı bir dizedir, uzun başlığın kırpılmışı değil —
 * "Hasta Kabul / Tra…" hiçbir dilde okunmuyordu.
 */
function Sidebar({ T, S, state, page, setPage, collapsed, setCollapsed, mobileOpen, setMobileOpen }) {
  const role = state.user?.role;
  const visible = NAV_ITEMS.filter((i) => canSee(i, role));
  const width = collapsed ? "w-[88px]" : "w-64";
  const navLabel = (key) => (collapsed ? (S.navShort?.[key] || S.nav[key]) : S.nav[key]);
  const body = (
    <div className={`flex h-full flex-col border-r ${T.border} ${T.sidebar}`}>
      <div className={`flex items-center gap-2.5 px-3 py-4 ${collapsed ? "flex-col" : ""}`}>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand text-white">
          <Activity size={20} />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className={`truncate font-bold ${T.heading}`}>{S.appName}</div>
            <div className={`truncate text-[10px] ${T.faint}`}>{S.tagline}</div>
          </div>
        )}
        <button onClick={() => setCollapsed((c) => !c)} title={collapsed ? S.expand : S.collapse}
          aria-label={collapsed ? S.expand : S.collapse}
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${T.navIdle}`}>
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {NAV_GROUPS.map((g) => {
          const items = visible.filter((i) => (i.group || "clinical") === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id} className="mb-1.5">
              {collapsed
                ? <div className={`mx-3 my-2 border-t ${T.border}`} />
                : <div className={`px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider ${T.faint}`}>{S[g.label]}</div>}
              {items.map((item) => {
                const Icon = item.icon;
                const active = page === item.key;
                const badge = navBadge(item.key, state);
                return (
                  <button key={item.key} title={S.nav[item.key]}
                    onClick={() => { setPage(item.key); setMobileOpen(false); }}
                    className={collapsed
                      ? `relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2.5 font-medium transition ${active ? T.navActive : T.navIdle}`
                      : `relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 font-medium transition ${T.sizes.nav} ${active ? T.navActive : T.navIdle}`}>
                    {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" />}
                    <Icon size={20} className="shrink-0" />
                    <span className={collapsed
                      ? "line-clamp-2 text-center text-[10px] font-semibold leading-tight"
                      : "flex-1 truncate text-left"}>{navLabel(item.key)}</span>
                    {badge > 0 && (
                      <span className={collapsed
                        ? "absolute right-2 top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
                        : "grid h-[19px] min-w-[19px] shrink-0 place-items-center rounded-full bg-red-500 px-1.5 text-[10.5px] font-bold text-white"}>
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className={`border-t ${T.border} px-2 py-2`}>
        <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${collapsed ? "flex-col text-center" : ""}`}>
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/15 text-brand">
            <Stethoscope size={14} />
          </div>
          <div className="min-w-0">
            <div className={`truncate text-[11px] font-semibold ${T.text}`}>
              {state.maskNames ? maskName(state.user?.full_name || "") : state.user?.full_name}
            </div>
            {!collapsed && <div className={`truncate text-[10px] ${T.faint}`}>{S.roleName[role]}</div>}
          </div>
        </div>
      </div>
    </div>
  );
  return (
    <>
      <aside className={`hidden shrink-0 lg:block ${width} transition-all`} data-testid="sidebar">{body}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className={`absolute inset-0 ${T.overlay}`} onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64">{body}</div>
        </div>
      )}
    </>
  );
}

/**
 * Mobil alt bar — telefonda sol menünün yerini alır.
 *
 * Bir hemşire koğuşta tek elle, çoğu zaman eldivenle çalışıyor: menüyü açıp içinden seçmek
 * iki dokunuş ve iki saniyedir. Alt bar en çok kullanılan dördü doğrudan verir, kalanı
 * "Menü"nün arkasında durur. Dokunma hedefleri 44 pikselden küçük değildir.
 */
function MobileTabBar({ T, S, state, page, setPage, setMobileOpen }) {
  const role = state.user?.role;
  const visible = NAV_ITEMS.filter((i) => canSee(i, role));
  const primary = visible.slice(0, 4);
  const openAlarms = visibleAlerts(state, scopeForUser(state, UNRESTRICTED_SCOPE_ROLES))
    .filter((a) => a.status === "FIRED").length;
  const label = (key) => S.navShort?.[key] || S.nav[key];
  return (
    <nav className={`fixed inset-x-0 bottom-0 z-40 flex border-t ${T.border} ${T.sidebar} px-1 pb-[env(safe-area-inset-bottom)] lg:hidden`}>
      {primary.map((item) => {
        const Icon = item.icon;
        const active = page === item.key;
        return (
          <button key={item.key} onClick={() => setPage(item.key)} title={S.nav[item.key]}
            className={`relative flex min-h-[54px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 ${active ? "text-brand" : T.navIdle}`}>
            <Icon size={20} />
            <span className="line-clamp-1 text-[10px] font-semibold leading-none">{label(item.key)}</span>
            {item.key === "alarms" && openAlarms > 0 && (
              <span className="absolute right-[18%] top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{openAlarms}</span>
            )}
          </button>
        );
      })}
      <button onClick={() => setMobileOpen(true)} title={S.expand}
        className={`flex min-h-[54px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 ${T.navIdle}`}>
        <PanelLeft size={20} />
        <span className="text-[10px] font-semibold leading-none">{S.top?.more || S.expand}</span>
      </button>
    </nav>
  );
}

// ================================================================ VITALS
const VITALS = [
  { key: "hr", icon: Heart, unit: "bpm" },
  { key: "map", icon: Gauge, unit: "mmHg", label: "MAP" },
  { key: "spo2", icon: Droplets, unit: "%", label: "SpO2" },
  { key: "temp", icon: Thermometer, unit: "°C" },
  { key: "rr", icon: Wind, unit: "/dk", label: "RR" },
];
function VitalsGrid({ T, vitals, compact }) {
  if (!vitals) return null;
  return (
    <div className={`grid grid-cols-5 gap-1.5 ${compact ? "" : "mt-3"}`}>
      {VITALS.map((v) => {
        const Icon = v.icon;
        const val = vitals[v.key];
        return (
          <div key={v.key} className={`rounded-lg px-1.5 py-1.5 text-center ${T.vitalCell}`}>
            <div className={`flex items-center justify-center gap-1 text-[10px] font-semibold uppercase ${T.faint}`}>
              <Icon size={11} /> {v.label || v.key.toUpperCase()}
            </div>
            <div className={`font-bold leading-none tracking-tight tabular-nums ${T.text} ${T.sizes.vital}`}>{val ?? "—"}</div>
            <div className={`text-[9px] ${T.faint}`}>{v.unit}</div>
          </div>
        );
      })}
    </div>
  );
}


/**
 * Kapsam bildirimi.
 *
 * Üç durum aynı görünemez: atanmış bir kapsamla bakmak, kapsamı hiç atanmamış olmak ve
 * break-glass ile geçici olarak her şeyi görmek. Ortadaki, yöneticinin yapacak bir işi
 * olduğunu söyler; sonuncusu, kullanıcının şu anda kayda geçen bir yetkiyle baktığını.
 * Atanmış kapsamda hiçbir şey yazılmaz — normal durum bildirim gerektirmez.
 */
function ScopeNotice({ T, S, scope }) {
  const P = S.pr8 || {};
  if (!scope || scope.reason === SCOPE_REASON.ASSIGNED) return null;
  if (scope.reason === SCOPE_REASON.UNRESTRICTED_ROLE) return null;
  const isBg = scope.reason === SCOPE_REASON.BREAK_GLASS;
  return (
    <div className={`flex items-start gap-2.5 rounded-xl px-3 py-2 text-xs ${
      isBg ? "bg-amber-500/12 text-amber-500" : `${T.subtle} ${T.muted}`}`}>
      {isBg ? <ShieldAlert size={14} className="mt-px shrink-0" /> : <Users size={14} className="mt-px shrink-0" />}
      <span>{isBg ? (P.scopeBreakGlass || "Acil erişim açık — kapsam dışındaki yataklar da görünüyor, bu erişim kayda geçiyor.")
                  : (P.scopeUnassigned || "Kapsam atanmamış: tüm koğuş görünüyor. Yönetici, Sistem Ayarları → Personel-Yatak matrisinden atama yapabilir.")}</span>
    </div>
  );
}

function BedBoard({ T, S, state, onOpenPatient, lang }) {
  // Kapsam: kullanıcının gördüğü yatak kümesi (bkz. patientScope.js). Sekme listesi de
  // kapsamdan üretilir — görünmeyen bir sekmeye basılamaz, yetki arayüzde saklanmaz.
  const scope = scopeForUser(state, UNRESTRICTED_SCOPE_ROLES);
  const units = visibleUnits(state, scope);
  const scopedBeds = visibleBeds(state, scope);
  const [unitId, setUnitId] = useState("all");
  const beds = unitId === "all" ? scopedBeds : scopedBeds.filter((b) => b.unitId === unitId);
  const occupied = beds.filter((b) => b.state === "OCCUPIED").length;
  const patientOf = (id) => state.patients.find((p) => p.patient_id === id);

  return (
    <div className="space-y-4">
      {/* Ünite sekmeleri: telefonda altı ünite iki satıra taşıyor ve ekranın üçte birini
          yiyordu. Tek satır, yatay kaydırmalı. */}
      <div className="flex items-center gap-2">
        <div className="-mx-1 flex flex-1 gap-2 overflow-x-auto px-1 pb-1">
          <button onClick={() => setUnitId("all")}
            className={`shrink-0 rounded-lg px-3 py-2 font-medium ${T.sizes.nav} ${unitId === "all" ? T.navActive : T.ghost}`}>
            {S.allUnits}
          </button>
          {units.map((u) => (
            <button key={u.id} onClick={() => setUnitId(u.id)}
              className={`shrink-0 rounded-lg px-3 py-2 font-medium ${T.sizes.nav} ${unitId === u.id ? T.navActive : T.ghost}`}>
              {u.name}
            </button>
          ))}
        </div>
        <div className={`shrink-0 rounded-lg px-3 py-2 ${T.chip} ${T.sizes.nav}`}>
          <b>{occupied}</b>/{beds.length}
        </div>
      </div>
      <ScopeNotice T={T} S={S} scope={scope} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {beds.map((bed) => {
          const p = bed.patientId ? patientOf(bed.patientId) : null;
          // Boş yatak dolu yatakla aynı alanı kaplıyordu; 16 yataklı bir koğuşta bu, ekranın
          // yarısının "boş" yazmasıydı. Artık ince bir satır ve doğrudan kabule götürüyor.
          if (!p) {
            return (
              <div key={bed.id} className={`flex items-center gap-2.5 rounded-xl border border-dashed ${T.border} px-3 py-2.5`}>
                <Bed size={15} className={T.faint} />
                <span className={`font-bold ${T.muted}`}>{bed.label}</span>
                <span className={`text-xs ${T.faint}`}>{S.available}</span>
              </div>
            );
          }
          const ru = riskUi(p.risk);
          const dev = state.devices?.find((d) => d.bedId === bed.id && d.connected);
          const openAlarm = (state.alerts || []).find((a) => a.patientId === p.patient_id && a.status === "FIRED");
          return (
            <button key={bed.id} onClick={() => onOpenPatient(p.patient_id)}
              className={`group flex overflow-hidden rounded-xl border ${T.border} ${T.card} ${T.hoverRing} text-left ring-1 transition`}>
              {/* Kritiklik şeridi: rozetten önce görülen tek şey. Üç metre öteden okunur. */}
              <span className={`w-1.5 shrink-0 ${ru.bar}`} aria-hidden="true" />
              <div className="min-w-0 flex-1 p-3.5">
                <div className="flex items-start gap-2.5">
                  <span className={`shrink-0 font-mono text-lg font-bold leading-none ${ru.text}`}>{bed.label}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-bold ${T.heading} ${T.sizes.name}`}>
                      {maskedName(state, p.display_name) || `${S.bed} ${bed.label}`}
                    </span>
                    <span className={`block truncate text-xs ${T.faint}`}>
                      {[p.age != null || p.ageDays != null ? `${ageText(p, S)}${!p.isNeonate ? "y" : ""}` : null,
                        p.sex ? (p.sex === "male" ? S.male : S.female) : null,
                        p.admittedAtMs ? losText(p.admittedAtMs, S) : null,
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right leading-none">
                    <News2Pill S={S} vitals={p.vitals} news2={p.news2} />
                  </span>
                </div>

                {/* Vitaller tek satır: kutu yerine sayı. Yalnız ölçülmüş olan gösterilir. */}
                <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                  {VITALS.map((v) => {
                    const val = p.vitals?.[v.key];
                    if (val == null) return null;
                    return (
                      <span key={v.key} className="inline-flex items-baseline gap-1">
                        <span className={`font-mono text-lg font-semibold tabular-nums ${T.text}`}>{val}</span>
                        <span className={`text-[10px] uppercase ${T.faint}`}>{v.label || v.key}</span>
                      </span>
                    );
                  })}
                  {!VITALS.some((v) => p.vitals?.[v.key] != null) && (
                    <span className={`text-xs ${T.faint}`}>{S.pr7.offlineDev}</span>
                  )}
                </div>

                {/* Açık alarm kartın kendisinde: alarm ekranına gitmeden görülür. */}
                {openAlarm && (
                  <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-red-500/10 px-2.5 py-1.5">
                    <AlertTriangle size={13} className="shrink-0 text-red-500" />
                    {/* Alarmın kendi gerekçesi (`summary`) yazılır — makine metni hiçbir zaman
                        tanı koymaz, "…kriterleri değerlendirilecek" biçimindedir. */}
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-red-500">
                      {openAlarm.summary || ALERT_TXT[lang] || ALERT_TXT.tr}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-red-500">{fmtClock(state.clockSec - openAlarm.firedAtSec)}</span>
                  </div>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <BranchProfileBadge S={S} lang={lang} profile={profileForPatient(state, p)} size="sm" />
                  {/* Cihazın markası ve IP'si hekimi ilgilendirmiyor — akıp akmadığı ilgilendiriyor.
                      Model ve adres biyomedikalin ekranında duruyor. */}
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${dev ? "bg-emerald-500/12 text-emerald-500" : `${T.chip} ${T.faint}`}`}>
                    {dev ? <Radio size={11} /> : <WifiOff size={11} />} {dev ? S.pr7.live : S.pr7.offlineDev}
                  </span>
                  <IdentityStatus p={p} S={S} className={`text-[11px] ${T.faint}`} />
                </div>

                {p.diagnosis && (
                  <div className={`mt-2 line-clamp-1 text-xs ${T.muted}`}>{p.diagnosis}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Madde 26: PHI alan gösterimi — default masked, reveal butonu ile açılır, audit kaydı oluşur.
function PhiField({ T, S, store, state, patient, field, label }) {
  const value = patient[field];
  const revealed = state.phiReveals[patient.patient_id]?.[field] || false;
  const [err, setErr] = useState("");
  const maskValue = (f, v) => {
    if (!v) return "—";
    if (f === "tc_no") return v.slice(0, 2) + "*".repeat(7) + v.slice(-2);
    if (f === "phone") return v.slice(0, 5) + " *** ** " + v.slice(-2);
    if (f === "address") return v.split(" ").slice(0, 2).join(" ") + " ···";
    return v;
  };
  const reveal = () => {
    try { store.revealPhiField({ patientId: patient.patient_id, field }); setErr(""); }
    catch (ex) { setErr(ex.message); }
  };
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className={`text-xs ${T.muted}`}>{label}</span>
        {!revealed && value && (
          <button onClick={reveal} className={`inline-flex items-center gap-1 text-xs ${T.accent}`}>
            <Eye size={12} /> {S.pr13.reveal}
          </button>
        )}
      </div>
      <div className={`mt-0.5 font-mono text-sm ${T.text}`}>{revealed ? (value || "—") : maskValue(field, value)}</div>
      {err && <div className="mt-1 text-xs text-red-500">{err}</div>}
    </div>
  );
}

// ================================================================ PATIENT DRAWER
// pr19 #4 — sonuç türü ikon/etiket eşlemesi
function resultTypeMeta(type, S) {
  const P = S.pr19;
  if (type === "radiology") return { icon: ScanLine, label: P.typeRadiology };
  if (type === "epicrisis") return { icon: FileText, label: P.typeEpicrisis };
  return { icon: FlaskConical, label: P.typeLab };
}
function resultStatusMeta(status, S) {
  const P = S.pr19;
  if (status === "reviewed") return { label: P.statusReviewed, cls: "bg-emerald-500/15 text-emerald-500" };
  if (status === "resulted") return { label: P.statusResulted, cls: "bg-sky-500/15 text-sky-500" };
  return { label: P.statusPending, cls: "bg-amber-500/15 text-amber-500" };
}

// pr19 #4 — bir hastaya ait sonuçların listesi (drawer içi)
function PatientResults({ T, S, store, state, patientId }) {
  const P = S.pr19;
  const results = (state.results || []).filter((r) => r.patientId === patientId)
    .sort((a, b) => b.atMs - a.atMs);
  return (
    <div className="mt-4">
      <div className={`mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase ${T.faint}`}>
        <Inbox size={13} /> {P.results}
      </div>
      {results.length === 0 ? (
        <div className={`rounded-xl border ${T.border} ${T.subtle} p-3 text-sm ${T.muted}`}>{P.noResults}</div>
      ) : (
        <div className="space-y-2">
          {results.map((r) => {
            const tm = resultTypeMeta(r.type, S); const sm = resultStatusMeta(r.status, S);
            const Icon = tm.icon;
            return (
              <div key={r.id} className={`rounded-xl border ${r.critical ? "border-red-500/40" : T.border} ${T.subtle} p-3 text-sm`}>
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${T.chip}`}><Icon size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${T.text}`}>{r.title}</span>
                      {r.critical && <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-500">{P.criticalValue}</span>}
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${sm.cls}`}>{sm.label}</span>
                    </div>
                    <div className={`mt-0.5 text-xs ${T.faint}`}>
                      {tm.label} · {r.source === "hl7" ? P.sourceHl7 : P.sourceManual} · {new Date(r.atMs).toLocaleString()}
                    </div>
                    {r.summary && <div className={`mt-1 ${T.muted}`}>{r.summary}</div>}
                    {r.status !== "reviewed" && (
                      <button onClick={() => store.markResultReviewed({ resultId: r.id })}
                        className={`mt-2 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold ${T.primary}`}>
                        <Check size={13} /> {P.markReviewed}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PatientDrawer({ T, S, state, store, patientId, onClose, onTransfer, onExpand, lang, simulation = false }) {
  const p = state.patients.find((x) => x.patient_id === patientId);
  const [ho, setHo] = useState(false);
  if (!p) return null;
  const ru = riskUi(p.risk);
  const profile = profileForPatient(state, p);
  const team = state.careTeam[p.patient_id] || {};
  const userName = (id) => state.users.find((u) => u.id === id)?.full_name || S.none;
  return (
    <div className="fixed inset-0 z-50">
      <div className={`absolute inset-0 ${T.overlay}`} onClick={onClose} />
      <div className={`absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l ${T.border} ${T.sidebar} p-5`}>
        <div className="flex items-start justify-between">
          <div>
            <div className={`text-xs ${T.faint}`}>{S.patientDetail}</div>
            <h2 className={`text-xl font-bold ${T.heading}`}>{maskedName(state, p.display_name) || p.patient_id}</h2>
            <IdentityStatus p={p} S={S} className={`text-xs ${T.faint}`} />
          </div>
          <div className="flex items-center gap-1.5">
            {/* Madde 8 — dar panelden geniş iki sütunlu tam ekran kokpite geç */}
            <button onClick={() => onExpand(p.patient_id)} title={S.pr14.cockpitOpen}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold ${T.primary}`}>
              <LayoutGrid size={15} /> <span className="hidden sm:inline">{S.pr14.cockpit}</span>
            </button>
            <button onClick={onClose} className={`grid h-9 w-9 place-items-center rounded-lg ${T.ghost}`}><X size={18} /></button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${ru.ring} ${ru.text}`}>
            <span className={`h-2 w-2 rounded-full ${ru.dot}`} /> {S.riskLevel}: {S.risk[p.risk]}
          </span>
          <BranchProfileBadge S={S} lang={lang} profile={profile} />
        </div>

        <dl className={`mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border ${T.border} ${T.subtle} p-4 text-sm`}>
          {[[S.protocolNo, p.protocolNo], [S.mrn, p.mrn],
            [S.age, `${ageText(p, S)}${p.isNeonate ? "" : ""}`], [S.sex, p.sex === "male" ? S.male : S.female],
            [S.bed, p.bedLabel], [S.admittedBy, p.admittedBy], [S.lengthOfStay, losText(p.admittedAtMs, S)]].map(([k, v]) => (
            <div key={k}><dt className={`text-xs ${T.faint}`}>{k}</dt><dd className={`font-semibold ${T.text}`}>{v}</dd></div>
          ))}
        </dl>

        {/* Madde 26: PHI alanları (TC, Telefon, Adres) — varsayılan masked, reveal butonu ile açılır */}
        <div className={`mt-4 space-y-2 rounded-xl border ${T.border} ${T.subtle} p-4 text-sm`}>
          <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.pr13.phiFields}</div>
          <PhiField T={T} S={S} store={store} state={state} patient={p} field="tc_no" label={S.tcno} />
          <PhiField T={T} S={S} store={store} state={state} patient={p} field="phone" label={S.pr13.phone} />
          <PhiField T={T} S={S} store={store} state={state} patient={p} field="address" label={S.pr13.address} />
        </div>

        <div className="mt-4">
          <div className={`mb-1 text-xs font-semibold uppercase ${T.faint}`}>{S.admissionDx}</div>
          <div className={`rounded-xl border ${T.border} ${T.card} p-3 text-sm ${T.text}`}>{p.diagnosis}</div>
        </div>

        <div className="mt-4">
          <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.vitals}</div>
          <VitalsGrid T={T} vitals={p.vitals} compact />
        </div>

        {/* pr19 #3 — bakım ekibi ataması doğrudan hasta/yatak ekranından yapılabilir */}
        <div className="mt-4">
          <div className={`mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase ${T.faint}`}>
            <Users size={13} /> {S.careTeamLabel} · {S.pr19.assignFromBed}
          </div>
          <div className={`grid grid-cols-1 gap-3 rounded-xl border ${T.border} ${T.subtle} p-3 sm:grid-cols-2`}>
            <Field T={T} label={S.pr19.assignAttending}>
              <select className={inputCls(T)} value={team.attendingId || ""}
                onChange={(e) => store.assignCareTeam({ patientId: p.patient_id, attendingId: e.target.value })}>
                <option value="">{S.none}</option>
                {state.users.filter((u) => u.role === ROLE.ATTENDING).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </Field>
            <Field T={T} label={S.pr19.assignNurse}>
              <select className={inputCls(T)} value={team.nurseId || ""}
                onChange={(e) => store.assignCareTeam({ patientId: p.patient_id, nurseId: e.target.value })}>
                <option value="">{S.none}</option>
                {state.users.filter((u) => u.role === ROLE.CHARGE_NURSE).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </Field>
          </div>
        </div>

        {/* pr19 #4 — hastaya ait lab/radyoloji/epikriz sonuçları */}
        <PatientResults T={T} S={S} store={store} state={state} patientId={p.patient_id} />

        {/* PR#6 — clinical data entry & treatment module */}
        <div className="mt-5">
          <ClinicalModule T={T} S={S} store={store} state={state} patientId={p.patient_id} lang={lang} simulation={simulation} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={() => setHo(true)} className={btnCls(T, "ghost")}><PenLine size={16} /> {S.handover}</button>
          <button onClick={() => { onClose(); onTransfer(p.patient_id); }} className={btnCls(T, "ghost")}><ArrowLeftRight size={16} /> {S.transfer}</button>
        </div>

        {/* signed handovers list */}
        {state.handovers.filter((h) => h.patientId === p.patient_id).map((h) => (
          <div key={h.id} className={`mt-3 rounded-xl border ${T.border} ${T.subtle} p-3 text-sm`}>
            <div className="flex items-center gap-2 text-emerald-500"><CheckCircle2 size={15} /> <span className="font-semibold">{S.signed}</span>
              <span className={`ml-auto text-xs ${T.faint}`}>{new Date(h.signedAtMs).toLocaleString()}</span></div>
            <div className={`mt-1 text-xs ${T.muted}`}>{h.fromName} → {h.toName}</div>
            <div className={`mt-1 ${T.text}`}>{h.note}</div>
          </div>
        ))}

        {ho && <HandoverModal T={T} S={S} store={store} state={state} patientId={p.patient_id} onClose={() => setHo(false)} />}
      </div>
    </div>
  );
}

// ================================================================ HANDOVER MODAL
function HandoverModal({ T, S, store, state, patientId, onClose }) {
  const [toName, setToName] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  // PR#7 — a handover cannot be signed while un-acknowledged CRITICAL alarms are open.
  const blockingAlerts = store.openCriticalAlerts(patientId);
  const blocked = blockingAlerts.length > 0;
  const submit = () => {
    try { store.createHandover({ patientId, fromName: state.user?.full_name, toName, note }); onClose(); }
    catch (ex) {
      if (ex.code === "HANDOVER_BLOCKED_CRITICAL") setErr(S.pr7.handoverBlocked);
      else setErr(ex.message);
    }
  };
  return (
    <ModalShell T={T} title={S.handoverTitle} sub={S.handoverSub} onClose={onClose}>
      {blocked && (
        <div className="mb-1 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2.5 text-sm text-red-500">
          <Siren size={17} className="mt-0.5 shrink-0 animate-pulse" />
          <div>
            <div className="font-semibold">{S.pr7.handoverBlocked}</div>
            <div className="mt-0.5 text-xs opacity-90">{S.pr7.handoverBlockedHint}</div>
            <div className="mt-1.5 space-y-0.5">
              {blockingAlerts.map((a) => (
                <div key={a.id} className="text-xs font-medium">• {S.pr7.bed} {a.bedLabel} · {a.summary}</div>
              ))}
            </div>
          </div>
        </div>
      )}
      <Field T={T} label={S.handoverFrom}><input className={inputCls(T)} value={state.user?.full_name || ""} readOnly /></Field>
      <Field T={T} label={S.handoverTo}><input className={inputCls(T)} value={toName} onChange={(e) => setToName(e.target.value)} /></Field>
      <Field T={T} label={S.handoverNote} hint={`${S.required} · ≥ ${ACK_REASON_MIN_CHARS}`}>
        <textarea rows={4} className={inputCls(T)} value={note} onChange={(e) => setNote(e.target.value)} placeholder={S.handoverPlaceholder} />
      </Field>
      {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className={btnCls(T, "ghost")}>{S.cancel}</button>
        <button onClick={submit} disabled={blocked}
          className={`${btnCls(T, "primary")} ${blocked ? "cursor-not-allowed opacity-50" : ""}`}>
          <PenLine size={16} /> {S.signBtn}
        </button>
      </div>
    </ModalShell>
  );
}


// ================================================================ RESULTS INBOX (pr19 #4)
function ResultsInbox({ T, S, store, state, simulation = false }) {
  const P = S.pr19;
  const patients = state.patients;
  const [f, setF] = useState({ patientId: patients[0]?.patient_id || "", type: "lab", title: "", summary: "", critical: false, fileName: "" });
  const [filter, setFilter] = useState("all"); // all | lab | radiology | epicrisis
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const upd = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const his = state.hisIntegration || { connected: false, lastSyncMs: null };
  const allResults = [...(state.results || [])].sort((a, b) => b.atMs - a.atMs);
  const results = filter === "all" ? allResults : allResults.filter((r) => r.type === filter);
  const pendingCount = allResults.filter((r) => r.status !== "reviewed").length;
  const patientName = (id) => { const p = patients.find((x) => x.patient_id === id); return p ? `${p.bedLabel} · ${maskedName(state, p.display_name)}` : "—"; };

  const submit = (e) => {
    e.preventDefault(); setErr(""); setMsg("");
    if (!f.patientId) { setErr(P.selectPatientFirst); return; }
    try {
      store.addResult({ patientId: f.patientId, type: f.type, title: f.title, summary: f.summary, source: "manual", critical: f.critical, status: "resulted", fileName: f.fileName || null });
      setMsg(P.resultAdded);
      setF((s) => ({ ...s, title: "", summary: "", critical: false, fileName: "" }));
    } catch (ex) { setErr(ex.message); }
  };
  const doSimulate = () => {
    setErr(""); setMsg("");
    try { store.simulateInboundResult({}); setMsg(P.resultAdded); }
    catch (ex) { setErr(ex.message); }
  };
  const typeOpts = [["lab", P.typeLab], ["radiology", P.typeRadiology], ["epicrisis", P.typeEpicrisis]];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* Sol: sonuç listesi */}
      <div className="space-y-4 xl:col-span-2">
        {/* HBYS entegrasyon kartı */}
        <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
          <div className="flex items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${his.connected ? "bg-emerald-500/15 text-emerald-500" : T.chip}`}>
              <PlugZap size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className={`font-semibold ${T.heading}`}>{P.integrationTitle}</div>
              <div className={`mt-0.5 text-sm ${T.muted}`}>{his.connected ? P.integrationConnected : P.integrationDemo}</div>
              {his.connected && his.lastSyncMs && (
                <div className={`mt-1 text-xs ${T.faint}`}>{P.lastSync}: {new Date(his.lastSyncMs).toLocaleString()}</div>
              )}
            </div>
            {simulation && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-500">DEMO</span>
            )}
          </div>
          {/* The toggle and the fabricated inbound result are simulation tooling; a fabricated lab
              value on a live ward is written to the record and cannot afterwards be told from a
              real one. The pending count is real and stays in both modes. */}
          <div className="mt-4 flex flex-wrap gap-2">
            {simulation && (
              <>
                <button onClick={() => store.toggleHisIntegration()}
                  className={btnCls(T, his.connected ? "ghost" : "primary")}>
                  <RefreshCw size={15} /> {P.integrationToggle}
                </button>
                <button onClick={doSimulate} disabled={!his.connected}
                  className={`${btnCls(T, "ghost")} ${!his.connected ? "cursor-not-allowed opacity-50" : ""}`}>
                  <Download size={15} /> {P.simulateInbound}
                </button>
              </>
            )}
            <span className={`ml-auto self-center text-xs ${T.faint}`}>{pendingCount} {P.pendingCount}</span>
          </div>
        </div>

        {/* Filtre sekmeleri */}
        <div className="flex flex-wrap gap-2">
          {[["all", P.results], ...typeOpts].map(([k, lbl]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${filter === k ? T.navActive : T.ghost}`}>{lbl}</button>
          ))}
        </div>

        {/* Liste */}
        <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
          {results.length === 0 ? (
            <div className={`py-8 text-center text-sm ${T.muted}`}>{P.noResults}</div>
          ) : (
            <div className="space-y-2">
              {results.map((r) => {
                const tm = resultTypeMeta(r.type, S); const sm = resultStatusMeta(r.status, S); const Icon = tm.icon;
                return (
                  <div key={r.id} className={`rounded-xl border ${r.critical ? "border-red-500/40" : T.border} ${T.subtle} p-3 text-sm`}>
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${T.chip}`}><Icon size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`font-semibold ${T.text}`}>{r.title}</span>
                          {r.critical && <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-500">{P.criticalValue}</span>}
                          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${sm.cls}`}>{sm.label}</span>
                        </div>
                        <div className={`mt-0.5 text-xs ${T.faint}`}>
                          {patientName(r.patientId)} · {tm.label} · {r.source === "hl7" ? P.sourceHl7 : P.sourceManual} · {new Date(r.atMs).toLocaleString()}
                        </div>
                        {r.summary && <div className={`mt-1 ${T.muted}`}>{r.summary}</div>}
                        {r.status !== "reviewed" && (
                          <button onClick={() => store.markResultReviewed({ resultId: r.id })}
                            className={`mt-2 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold ${T.primary}`}>
                            <Check size={13} /> {P.markReviewed}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sağ: manuel yükleme formu */}
      <div>
        <form onSubmit={submit} className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
          <div className={`mb-3 flex items-center gap-2 font-semibold ${T.heading}`}><Upload size={17} /> {P.uploadResult}</div>
          <div className="space-y-3">
            <Field T={T} label={S.selectPatient}>
              <select className={inputCls(T)} value={f.patientId} onChange={(e) => upd("patientId", e.target.value)} required>
                {patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.bedLabel} · {maskedName(state, p.display_name)}</option>)}
              </select>
            </Field>
            <Field T={T} label={P.resultType}>
              <select className={inputCls(T)} value={f.type} onChange={(e) => upd("type", e.target.value)}>
                {typeOpts.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select>
            </Field>
            <Field T={T} label={P.resultTitle}><input className={inputCls(T)} value={f.title} onChange={(e) => upd("title", e.target.value)} placeholder={P.resultTitlePh} required /></Field>
            <Field T={T} label={P.resultSummary}><textarea rows={3} className={inputCls(T)} value={f.summary} onChange={(e) => upd("summary", e.target.value)} placeholder={P.resultSummaryPh} /></Field>
            <Field T={T} label={`${P.attachFile} (${P.optional})`}>
              <input type="file" className={`${inputCls(T)} file:mr-2 file:rounded file:border-0 file:bg-brand/15 file:px-2 file:py-1 file:text-brand`}
                onChange={(e) => upd("fileName", e.target.files?.[0]?.name || "")} />
            </Field>
            <label className={`flex items-center gap-2 ${T.sizes.nav} ${T.text}`}>
              <input type="checkbox" checked={f.critical} onChange={(e) => upd("critical", e.target.checked)} /> {P.criticalValue}
            </label>
          </div>
          {err && <div className="mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
          {msg && <div className="mt-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-500">{msg}</div>}
          <div className="mt-4 flex justify-end">
            <button type="submit" className={btnCls(T, "primary")}><Plus size={16} /> {P.uploadResult}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ================================================================ UNIT HEATMAP (pr19 #2/#4)
function HeatmapPage({ T, S, store, state }) {
  const P = S.pr19;
  const units = state.structure.units;
  const [unitId, setUnitId] = useState("all");
  const [grid, setGrid] = useState([]);
  useEffect(() => {
    const heat = store.computeHeatmap(unitId === "all" ? {} : { unitId });
    setGrid(heat.grid || []);
    // recompute when patients/alerts/beds/unit change
  }, [unitId, state.patients, state.alerts, state.beds]); // eslint-disable-line react-hooks/exhaustive-deps
  const riskCls = (risk, occupied) => {
    if (!occupied) return `${T.subtle} ${T.faint}`;
    if (risk === "HIGH") return "bg-red-500/20 text-red-600 ring-1 ring-red-500/40";
    if (risk === "MEDIUM") return "bg-amber-500/20 text-amber-600 ring-1 ring-amber-500/40";
    return "bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/30";
  };
  const counts = grid.reduce((a, g) => { if (g.occupied) a[g.risk] = (a[g.risk] || 0) + 1; return a; }, {});
  const legend = [["HIGH", "bg-red-500/60", S.risk.critical], ["MEDIUM", "bg-amber-500/60", S.risk.high], ["LOW", "bg-emerald-500/50", S.risk.stable]];
  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className={`flex items-center gap-2 font-bold ${T.heading}`}><Grid3x3 size={18} /> {P.heatmapTitle}</div>
            <div className={`mt-0.5 text-sm ${T.muted}`}>{P.heatmapSub}</div>
          </div>
          <select className={`${inputCls(T)} max-w-[220px]`} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="all">{S.allUnits || S.nav.board}</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          {legend.map(([k, dot, lbl]) => (
            <div key={k} className={`flex items-center gap-1.5 text-xs ${T.muted}`}>
              <span className={`h-3 w-3 rounded ${dot}`} /> {lbl} · {counts[k] || 0}
            </div>
          ))}
        </div>
      </div>
      <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {grid.map((g) => (
            <div key={g.bedId} title={`${g.unitName} · ${g.roomLabel} · ${g.bedLabel}`}
              className={`rounded-xl p-2.5 text-center ${riskCls(g.risk, g.occupied)}`}>
              <div className="truncate text-[11px] font-bold">{g.bedLabel}</div>
              {g.occupied ? (
                <>
                  <div className="mt-1 text-lg font-black leading-none tabular-nums">{g.news2}</div>
                  <div className="text-[9px] font-semibold uppercase opacity-80">NEWS2</div>
                  {g.alertCount > 0 && <div className="mt-0.5 text-[9px] font-bold">⚠ {g.alertCount}</div>}
                </>
              ) : (
                <div className="mt-2 text-[10px] font-semibold uppercase opacity-70">{P.empty}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ================================================================ ALARM MANAGEMENT
/**
 * Alarm yönetimi — cevapsız alarmın bulunduğu değil, **cevaplandığı** ekran.
 *
 * Eski düzende her alarm kartı eskalasyon çizelgesini baştan çiziyordu: kart başına ~280 piksel
 * ve beş alarmda beşincisi ekranın dışında kalıyordu. Alarm yorgunluğunu azaltmak için yazılmış
 * bir sistemde, açık alarmı bulmak için kaydırmak gerekiyordu.
 *
 * Yeni düzen üç şey yapar:
 *   • **En uzun cevapsız üstte ve açık durur** — sıralama "en yeni" değil "en çok bekleyen".
 *   • Diğerleri tek satır; tıklanınca açılır. Beş alarm tek ekrana sığar.
 *   • Cevaplanmış olanlar listeden düşmez, soluklaşır — kimin, ne zaman, hangi gerekçeyle
 *     kapattığı bu ekranın asıl kaydıdır.
 */
function AlarmPage({ T, S, store, state, lang, simulation = false }) {
  // Alarm da kapsamla süzülür: kapsamı dışındaki bir yatağın alarmını cevaplayacak kişi,
  // o yatağı zaten göremeyen kişi değildir.
  const scope = scopeForUser(state, UNRESTRICTED_SCOPE_ROLES);
  const all = visibleAlerts(state, scope).filter((a) => a.status !== "CLOSED");
  const elapsedOf = (a) => (a.status === "FIRED" ? state.clockSec - a.firedAtSec : -1);
  const open = all.filter((a) => a.status === "FIRED").sort((x, y) => elapsedOf(y) - elapsedOf(x));
  const handled = all.filter((a) => a.status !== "FIRED");
  const [filter, setFilter] = useState("open");   // open | handled
  const [openId, setOpenId] = useState(null);
  const [fp, setFp] = useState(state.patients[0]?.patient_id || "");
  const [ft, setFt] = useState(TIER.CRITICAL);
  const fire = () => { if (fp) store.fireAlert({ patientId: fp, tier: ft, summary: ALERT_TXT[lang] || ALERT_TXT.tr }); };
  const [ackFor, setAckFor] = useState(null);
  const [snzFor, setSnzFor] = useState(null);

  const shown = filter === "open" ? open : handled;
  // İlk kart açık gelir: en uzun cevapsız alarm, kimsenin tıklamasını beklemeden görünür.
  const expandedId = openId || (filter === "open" ? open[0]?.id : null);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
      <div className="space-y-3 xl:col-span-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { setFilter("open"); setOpenId(null); }}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 font-semibold ${T.sizes.nav} ${filter === "open" ? "bg-red-500/15 text-red-500 ring-1 ring-red-500/30" : T.navIdle}`}>
            {S.pr6.unanswered || S.statusFired}
            <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{open.length}</span>
          </button>
          <button onClick={() => { setFilter("handled"); setOpenId(null); }}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 font-semibold ${T.sizes.nav} ${filter === "handled" ? T.navActive : T.navIdle}`}>
            {S.statusAck} · {S.statusSnoozed}
            <span className={`rounded-full px-1.5 text-[11px] font-bold ${T.chip}`}>{handled.length}</span>
          </button>
          <span className={`ml-auto text-xs ${T.faint}`}>{S.pr6.sortedByWait || "En uzun cevapsız üstte"}</span>
        </div>

        {shown.length === 0 ? (
          <div className={`rounded-2xl border border-dashed ${T.border} py-12 text-center text-sm ${T.faint}`}>{S.noAlerts}</div>
        ) : (
          <div className="space-y-2">
            {shown.map((a) => (
              <AlertCard key={a.id} T={T} S={S} state={state} alert={a}
                expanded={a.id === expandedId}
                onToggle={() => setOpenId(a.id === expandedId ? "none" : a.id)}
                onAck={() => setAckFor(a)} onSnooze={() => setSnzFor(a)}
                onEscalate={() => store.escalateToRRT(a.id)} onMute={() => store.muteAlert(a.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Sağ kolon: acil erişim her modda; alarm tetikleme ve saat yalnız simülasyonda. */}
      <div className="space-y-4">
        <BreakGlass T={T} S={S} store={store} state={state} />
        {simulation && (
          <div className={`rounded-2xl border ${T.border} ${T.card} p-4`}>
            <h3 className={`mb-1 font-bold ${T.heading}`}>{S.fireAlert}</h3>
            <p className={`mb-3 text-xs ${T.muted}`}>{S.alarmsSub}</p>
            <div className="space-y-2.5">
              <Field T={T} label={S.viewDetail}>
                <select className={`${inputCls(T)} px-2.5 py-2`} value={fp} onChange={(e) => setFp(e.target.value)}>
                  {state.patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.bedLabel} · {maskedName(state, p.display_name)}</option>)}
                </select>
              </Field>
              <Field T={T} label={S.alertTier}>
                <select className={`${inputCls(T)} px-2.5 py-2`} value={ft} onChange={(e) => setFt(e.target.value)}>
                  {[TIER.CRITICAL, TIER.HIGH, TIER.MEDIUM, TIER.LOW].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <button onClick={fire} className={`${btnCls(T, "danger")} w-full`}><Siren size={16} /> {S.fireBtn}</button>
            </div>
          </div>
        )}
        {simulation && <TimeScale T={T} S={S} store={store} state={state} />}
      </div>

      {ackFor && <AckModal T={T} S={S} store={store} alert={ackFor} onClose={() => setAckFor(null)} />}
      {snzFor && <SnoozeModal T={T} S={S} store={store} alert={snzFor} onClose={() => setSnzFor(null)} />}
    </div>
  );
}

/**
 * Bir alarm satırı. Kapalıyken tek satır, açıkken eskalasyonu ve eylemleri gösterir.
 *
 * Eskalasyon üç ayrı kutu olarak çiziliyordu ve her kartta baştan tekrarlanıyordu; oysa okunan
 * şey tek bir cümle: **kim, saat kaçta bildirildi, şu an nerede.** Tek şerit onu söyler ve
 * kartın yüksekliğinin yarısını geri verir.
 */
function AlertCard({ T, S, state, alert, expanded, onToggle, onAck, onSnooze, onEscalate, onMute }) {
  const ui = tierUi(alert.tier);
  const patient = state.patients.find((p) => p.patient_id === alert.patientId);
  const isMuted = alert.mutedUntil != null && alert.mutedUntil > state.clockSec;
  const fired = alert.status === "FIRED";
  const elapsed = fired ? state.clockSec - alert.firedAtSec : 0;
  const toNext = fired ? secondsToNextStep(elapsed, alert.tier) : null;
  const statusTxt = { FIRED: S.statusFired, ACKNOWLEDGED: S.statusAck, SNOOZED: S.statusSnoozed, CLOSED: S.statusClosed }[alert.status];
  const reached = (step) => alert.events.some((e) => e.step === step);
  const steps = [
    { step: ESCALATION_STEP.TIER_1_CHARGE_NURSE, label: S.step1 },
    { step: ESCALATION_STEP.TIER_2_PHYSICIAN, label: S.step2 },
    { step: ESCALATION_STEP.TIER_3_RRT, label: S.step3 },
  ];
  const atStep = steps.filter((x) => reached(x.step)).length;

  return (
    <div className={`overflow-hidden rounded-xl border ${fired ? "border-red-500/40" : T.border} ${T.card} ${fired ? "" : "opacity-75"}`}>
      {/* --- her zaman görünen satır --- */}
      <button type="button" onClick={onToggle}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
        <span className={`h-9 w-1.5 shrink-0 rounded-full ${fired ? ui.dot : T.chip}`} aria-hidden="true" />
        <span className={`shrink-0 font-mono text-lg font-bold leading-none ${fired ? ui.text : T.faint}`}>
          {patient?.bedLabel || "—"}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold ${T.text}`}>
            {maskedName(state, patient?.display_name) || patient?.patient_id || "—"}
            {alert.trigger && <span className={`ml-2 text-xs font-normal ${ui.text}`}>{alert.trigger}</span>}
          </span>
          <span className={`block truncate text-xs ${T.muted}`}>{alert.summary}</span>
        </span>
        {alert.auto && (
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand sm:inline-flex">
            <Siren size={10} /> {S.pr6.autoBadge}
          </span>
        )}
        {isMuted && <VolumeX size={14} className={`shrink-0 ${T.faint}`} />}
        {fired ? (
          <>
            <span className={`shrink-0 font-mono text-sm font-bold tabular-nums ${ui.text}`}>{fmtClock(elapsed)}</span>
            <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold sm:inline ${ui.chip}`}>
              {atStep > 0 ? `${S.pr6.tierShort || "Kademe"} ${atStep}` : alert.tier}
            </span>
          </>
        ) : (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            alert.status === "ACKNOWLEDGED" ? "bg-emerald-500/15 text-emerald-500" : T.chip}`}>{statusTxt}</span>
        )}
        <ChevronDown size={15} className={`shrink-0 transition ${T.faint} ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className={`border-t ${T.border} px-3.5 py-3`}>
          {/* --- eskalasyon: üç kutu değil tek şerit ---
              Telefonda şerit 549 pikselde taşıyordu (ekran 390) ve kademe adları birbirinin
              üstüne biniyordu: dar ekranda alt alta diziliyor, aradaki bağlantı çizgileri
              yalnız yer olduğunda çiziliyor. */}
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
            {steps.map((st, i) => {
              const on = reached(st.step);
              const event = alert.events.find((e) => e.step === st.step);
              return (
                <React.Fragment key={st.step}>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${on ? "bg-red-500" : T.chip} ${on && i === atStep - 1 ? "ring-4 ring-red-500/25" : ""}`} />
                    <span className={`text-[11px] ${on ? T.text : T.faint}`}>
                      {st.label}{event ? ` · ${fmtClock(event.atSec - alert.firedAtSec)}` : ""}
                    </span>
                  </span>
                  {i < steps.length - 1 && (
                    <span className={`hidden h-px flex-1 sm:block ${reached(steps[i + 1].step) ? "bg-red-500" : T.chip}`} />
                  )}
                </React.Fragment>
              );
            })}
            {fired && alert.source !== "device" && (
              <span className={`shrink-0 text-[11px] sm:ml-2 ${T.faint}`}>
                {toNext != null ? `${S.nextStep}: ${fmtClock(toNext)}` : S.atTier3}
              </span>
            )}
          </div>

          {alert.status === "SNOOZED" && alert.snooze && (
            <div className={`mt-2 text-xs ${T.faint}`}>{S.snoozedUntil}: {fmtClock(alert.snooze.until)}</div>
          )}
          {alert.ack && (
            <div className={`mt-2 rounded-lg ${T.subtle} p-2.5 text-xs ${T.muted}`}>
              <span className="font-semibold text-emerald-500">{S.statusAck}</span> · {alert.ack.by} · {S.reasonOptions[alert.ack.reason] || alert.ack.reason}
              {alert.ack.note && <div className={`mt-0.5 ${T.text}`}>{alert.ack.note}</div>}
            </div>
          )}

          {fired && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={onAck} className={`${btnCls(T, "primary")} px-3 py-2`}><Check size={15} /> {S.ack}</button>
              {canSnooze(alert.tier) && (
                <button onClick={onSnooze} className={`${btnCls(T, "ghost")} px-3 py-2`}><BellOff size={15} /> {S.snooze}</button>
              )}
              <button onClick={onMute} disabled={isMuted} className={`${btnCls(T, "ghost")} px-3 py-2 ${isMuted ? "opacity-50" : ""}`}>
                {isMuted ? <Volume2 size={15} /> : <VolumeX size={15} />} {isMuted ? S.pr6.muted : S.pr6.mute}
              </button>
              <button onClick={onEscalate} className={`${btnCls(T, "warn")} px-3 py-2`}><ArrowUpCircle size={15} /> {S.escalateRRT}</button>
              {/* Uyarı, düğme değil: eskiden düğmelerin arasında duruyor ve tıklanacak sanılıyordu. */}
              {!canSnooze(alert.tier) && (
                <span className={`ml-auto inline-flex items-center gap-1.5 text-[11px] ${T.faint}`}>
                  <AlertTriangle size={12} /> {S.critNoSnooze}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AckModal({ T, S, store, alert, onClose }) {
  const crit = alert.tier === TIER.CRITICAL;
  const [reason, setReason] = useState("clinically_reviewed");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const submit = () => {
    try { store.acknowledgeAlert(alert.id, { reason, note }); onClose(); }
    catch (ex) { setErr(ex.message); }
  };
  return (
    <ModalShell T={T} title={S.ackTitle} onClose={onClose}>
      <Field T={T} label={S.ackReason}>
        <select className={inputCls(T)} value={reason} onChange={(e) => setReason(e.target.value)}>
          {Object.keys(S.reasonOptions).map((k) => <option key={k} value={k}>{S.reasonOptions[k]}</option>)}
        </select>
      </Field>
      <Field T={T} label={S.ackNote} hint={crit ? S.ackNoteHintCrit : S.optional}>
        <textarea rows={3} className={inputCls(T)} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className={btnCls(T, "ghost")}>{S.cancel}</button>
        <button onClick={submit} className={btnCls(T, "primary")}><Check size={16} /> {S.confirm}</button>
      </div>
    </ModalShell>
  );
}

function SnoozeModal({ T, S, store, alert, onClose }) {
  const cap = snoozeCapMinutes(alert.tier) || 30;
  const [minutes, setMinutes] = useState(Math.min(10, cap));
  const [reason, setReason] = useState("clinically_expected");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const submit = () => {
    try { store.snoozeAlert(alert.id, { minutes: Number(minutes), reason, note }); onClose(); }
    catch (ex) { setErr(ex.message); }
  };
  return (
    <ModalShell T={T} title={S.snoozeTitle} onClose={onClose}>
      <Field T={T} label={`${S.snoozeMinutes} (≤ ${cap})`}>
        <input type="number" min="1" max={cap} className={inputCls(T)} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </Field>
      <Field T={T} label={S.snoozeReason}>
        <select className={inputCls(T)} value={reason} onChange={(e) => setReason(e.target.value)}>
          {Object.keys(S.reasonOptions).map((k) => <option key={k} value={k}>{S.reasonOptions[k]}</option>)}
        </select>
      </Field>
      <Field T={T} label={S.ackNote}><textarea rows={2} className={inputCls(T)} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className={btnCls(T, "ghost")}>{S.cancel}</button>
        <button onClick={submit} className={btnCls(T, "primary")}><BellOff size={16} /> {S.snooze}</button>
      </div>
    </ModalShell>
  );
}

function TimeScale({ T, S, store, state }) {
  const speeds = [1, 30, 60, 120];
  // Gerçek saat de burada durur: hızlandırılmış bir saatin yanında gerçek zamanın görünmemesi,
  // demoyu izleyenin "şu an saat kaç" diye başka yere bakmasına yol açıyordu.
  const [wall, setWall] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setWall(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hhmm = `${String(wall.getHours()).padStart(2, "0")}:${String(wall.getMinutes()).padStart(2, "0")}`;
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={`font-bold ${T.heading}`}>{S.timeScale}</h3>
        {/* Bu sayının ne olduğu yazmıyordu ve 60× hızda saatlere çıkıyordu: "318:30" gören
            kimse onu "simülasyon başladığından beri geçen süre" diye okumaz. */}
        <span className="flex flex-col items-end gap-0.5">
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums ${T.text}`}>
            <Clock size={13} className={T.faint} /> {hhmm}
          </span>
          <span className={`text-[10px] tabular-nums ${T.faint}`}
            title={S.pr6?.simClockHint || "Simülasyon başladığından beri geçen süre"}>
            {S.pr6?.simClock || "Simülasyon saati"}: {fmtClock(state.clockSec)}
          </span>
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {speeds.map((s) => (
          <button key={s} onClick={() => store.setSpeed(s)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${state.speed === s ? T.navActive : T.ghost}`}>
            {s === 1 ? S.realtime : `${s}×`}
          </button>
        ))}
      </div>
      <button onClick={() => store.setRunning(!state.running)} className={`${btnCls(T, "ghost")} w-full`}>
        {state.running ? <><Pause size={16} /> {S.pause}</> : <><Play size={16} /> {S.resume}</>}
      </button>
    </div>
  );
}

function BreakGlass({ T, S, store, state }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const active = !!state.breakGlass && state.clockSec < state.breakGlass.expiresAtSec;
  const submit = () => { try { store.activateBreakGlass(reason); setReason(""); setErr(""); } catch (ex) { setErr(ex.message); } };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <div className="mb-1 flex items-center gap-2">
        <ShieldAlert size={17} className="text-amber-500" />
        <h3 className={`font-bold ${T.heading}`}>{S.breakGlass}</h3>
        {active && <span className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">{S.bgActive}</span>}
      </div>
      <p className={`mb-3 text-xs ${T.faint}`}>{S.bgInfo}</p>
      {active ? (
        <div className="space-y-2">
          <div className={`rounded-lg ${T.subtle} px-3 py-2 text-sm ${T.text}`}>
            {S.bgExpires}: <b className="tabular-nums">{fmtClock(state.breakGlass.expiresAtSec)}</b>
          </div>
          <button onClick={() => store.extendBreakGlass()} className={`${btnCls(T, "ghost")} w-full`}>{S.bgExtend}</button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea rows={2} className={inputCls(T)} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={`${S.bgReason} (≥ ${ACK_REASON_MIN_CHARS})`} />
          {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}
          <button onClick={submit} className={`${btnCls(T, "warn")} w-full`}>{S.bgActivate}</button>
        </div>
      )}
    </div>
  );
}

function AnalyticsPanel({ T, S, state }) {
  const a = useMemo(() => computeAnalytics(state), [state]);
  const p8 = S.pr8;

  const exportCsv = () => {
    const rows = [
      [p8.kpiOccupancy, `${a.overallOccupancyPct}%`],
      [p8.kpiAvgLos, `${a.avgLosHours} ${p8.hoursShort}`],
      [p8.kpiAdmits, a.admitsToday],
      [p8.kpiDischarges, a.dischargesToday],
      [p8.avgTimeToAck, `${a.avgTimeToAckSec} ${p8.secShort}`],
      [p8.tier1c, a.escalationCounts.tier1],
      [p8.tier2c, a.escalationCounts.tier2],
      [p8.tier3c, a.escalationCounts.tier3],
      [p8.openAlertsK, a.openAlerts],
      [p8.criticalOpenK, a.criticalOpen],
      [p8.dhOnline, a.deviceHealth.online],
      [p8.dhOffline, a.deviceHealth.offline],
      [p8.dhStale, a.deviceHealth.stale],
    ];
    const head = [p8.reportTitle, `${p8.generatedAt}: ${new Date(a.generatedAtMs).toLocaleString()}`];
    const csv = [head.join(","), "", ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `homunculus-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportPdf = () => window.print();

  const escMax = Math.max(1, a.escalationCounts.tier1, a.escalationCounts.tier2, a.escalationCounts.tier3);
  return (
    <div className="space-y-4">
      {/* header + export */}
      <div className={`flex flex-wrap items-center gap-3 rounded-2xl border ${T.border} ${T.card} p-5`}>
        <div className="min-w-0">
          <h3 className={`flex items-center gap-2 font-bold ${T.heading}`}><BarChart3 size={18} /> {p8.reportTitle}</h3>
          <p className={`text-sm ${T.muted}`}>{p8.analyticsSub} · {p8.generatedAt}: {new Date(a.generatedAtMs).toLocaleString()}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={exportCsv} className={btnCls(T, "ghost")}><Download size={15} /> {p8.exportCsv}</button>
          <button onClick={exportPdf} className={btnCls(T, "primary")}><FileText size={15} /> {p8.exportPdf}</button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard T={T} icon={Bed} label={p8.kpiOccupancy} value={`${a.overallOccupancyPct}%`} sub={`${a.totalOccupied}/${a.totalBeds}`} accent="text-brand" />
        <KpiCard T={T} icon={Clock} label={p8.kpiAvgLos} value={a.avgLosHours} sub={p8.hoursShort} accent="text-cyan-500" />
        <KpiCard T={T} icon={DoorOpen} label={p8.kpiAdmits} value={a.admitsToday} accent="text-emerald-500" />
        <KpiCard T={T} icon={LogOut} label={p8.kpiDischarges} value={a.dischargesToday} accent="text-amber-500" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* per-unit occupancy */}
        <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
          <h4 className={`mb-3 flex items-center gap-2 font-bold ${T.heading}`}><Building2 size={16} /> {p8.perUnit}</h4>
          <div className="space-y-3">
            {a.occupancyByUnit.length === 0 && <div className={`text-sm ${T.faint}`}>{p8.noUnits}</div>}
            {a.occupancyByUnit.map((u) => (
              <Bar key={u.unitId} T={T} label={`${u.unitName} (${u.occupied}/${u.total})`} value={u.occupancyPct} max={100} suffix="%" accent="bg-brand" />
            ))}
          </div>
        </div>

        {/* alarm performance */}
        <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
          <h4 className={`mb-3 flex items-center gap-2 font-bold ${T.heading}`}><Siren size={16} /> {p8.alarmPerf}</h4>
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            <div className={`rounded-xl ${T.subtle} p-2.5`}>
              <div className={`text-xl font-bold ${T.heading}`}>{a.avgTimeToAckSec}<span className="text-xs font-normal">{p8.secShort}</span></div>
              <div className={`text-[10px] ${T.faint}`}>{p8.avgTimeToAck}</div>
            </div>
            <div className={`rounded-xl ${T.subtle} p-2.5`}>
              <div className={`text-xl font-bold ${T.heading}`}>{a.openAlerts}</div>
              <div className={`text-[10px] ${T.faint}`}>{p8.openAlertsK}</div>
            </div>
            <div className={`rounded-xl ${T.subtle} p-2.5`}>
              <div className="text-xl font-bold text-red-500">{a.criticalOpen}</div>
              <div className={`text-[10px] ${T.faint}`}>{p8.criticalOpenK}</div>
            </div>
          </div>
          <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{p8.escalationCascade}</div>
          <div className="space-y-2.5">
            <Bar T={T} label={p8.tier1c} value={a.escalationCounts.tier1} max={escMax} accent="bg-amber-500" />
            <Bar T={T} label={p8.tier2c} value={a.escalationCounts.tier2} max={escMax} accent="bg-orange-500" />
            <Bar T={T} label={p8.tier3c} value={a.escalationCounts.tier3} max={escMax} accent="bg-red-500" />
          </div>
        </div>
      </div>

      {/* device health */}
      <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h4 className={`flex items-center gap-2 font-bold ${T.heading}`}><Radio size={16} /> {p8.deviceHealthTitle}</h4>
          <p className={`text-xs ${T.muted}`}>{p8.deviceHealthSub}</p>
          <div className="ml-auto flex gap-2 text-xs font-semibold">
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-500">{p8.dhOnline}: {a.deviceHealth.online}</span>
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-500">{p8.dhStale}: {a.deviceHealth.stale}</span>
            <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-red-500">{p8.dhOffline}: {a.deviceHealth.offline}</span>
          </div>
        </div>
        <div className={`divide-y ${T.divide} rounded-xl border ${T.border}`}>
          {a.deviceRows.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              {d.status === "online" ? <Radio size={15} className="shrink-0 animate-pulse text-emerald-500" />
                : d.status === "stale" ? <Wifi size={15} className="shrink-0 text-amber-500" />
                : <WifiOff size={15} className="shrink-0 text-red-500" />}
              <div className="min-w-0">
                <div className={`truncate font-semibold ${T.text}`}>{d.bedLabel} · {d.model}</div>
                <div className={`truncate text-xs ${T.faint}`}>{d.vendor} · {d.ip}</div>
              </div>
              <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${d.status === "online" ? "bg-emerald-500/15 text-emerald-500" : d.status === "stale" ? "bg-amber-500/15 text-amber-500" : "bg-red-500/15 text-red-500"}`}>
                {d.status === "online" ? p8.dhOnline : d.status === "stale" ? p8.dhStale : p8.dhOffline}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ================================================================ ADMIN
/**
 * Devices and data flow — the biomedical engineer's page.
 *
 * On an on-prem deployment nobody can look at the bridge from outside the hospital, so the
 * question "is anything still arriving?" has to be answerable from inside the product. A ward
 * with no alarms and a ward whose monitors stopped an hour ago look identical on a board that
 * shows only values, and the second one is the dangerous one: everybody believes the bed is
 * being watched.
 */
function TechPage({ T, S, store, state }) {
  const health = wardFeedHealth(state.patients);
  const pill = (status) => ({
    live: "text-emerald-500 ring-emerald-500/40",
    stale: "text-amber-500 ring-amber-500/50",
    absent: `${T.faint} ring-current/20`,
  }[status]);

  return (
    <div className="space-y-4">
      {/* One line an engineer can read from the doorway. */}
      <div className={`grid grid-cols-3 gap-3`}>
        {[
          ["Sessiz yatak", health.silentCount, "text-red-500"],
          ["Bayat kanal", health.staleCount, "text-amber-500"],
          ["Sağlıklı", health.healthyCount, "text-emerald-500"],
        ].map(([label, value, tone]) => (
          <div key={label} className={`rounded-2xl border ${T.border} ${T.card} p-4`}>
            <div className={`text-2xl font-bold ${tone}`}>{value}</div>
            <div className={`text-xs ${T.muted}`}>{label}</div>
          </div>
        ))}
      </div>

      <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
        <SectionHeader T={T} icon={Activity} title="Veri akışı"
                       hint="Her yatak için hangi kanal geliyor, en son ne zaman geldi. Sessiz yataklar üstte." />
        {health.beds.length === 0 && <Empty T={T} text="Yatak yok." />}
        <div className="space-y-2">
          {health.beds.map((bed) => (
            <div key={bed.patientId}
                 className={`rounded-xl border p-3 ${bed.silent ? "border-red-500/40" : T.border}`}>
              <div className="mb-2 flex items-center justify-between">
                <div className={`font-semibold ${T.heading}`}>{bed.bedLabel || bed.patientId}</div>
                {bed.silent && (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-red-500">
                    veri gelmiyor
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {bed.channels.map((c) => (
                  <span key={c.key}
                        title={`${c.source} · ${c.status === "absent" ? "hiç gelmedi" : formatAge(c.age) + " önce"}`}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${pill(c.status)}`}>
                    {c.label} · {c.status === "absent" ? "—" : formatAge(c.age)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* The inventory screen that already existed, now reachable by the role that needs it. */}
      <DeviceAdmin T={T} S={S} store={store} state={state} />
    </div>
  );
}

/**
 * Çalışan sürüm.
 *
 * Panelde hiçbir yerde yazmıyordu: 20.09.2026'da pilotta hangi sürümün canlı olduğu ancak
 * dosya adındaki karma değere bakarak anlaşıldı. Bir hastane sisteminde "sizde hangi sürüm
 * var" sorusunun cevabı ekranda olmalı. Derleme `.git` olmadan yapıldıysa uydurulmaz.
 */
function BuildInfo({ T, S, className = "" }) {
  const sha = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "";
  const at = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";
  const when = at ? new Date(at).toLocaleString() : "";
  const P = S.pr8 || {};
  return (
    <div className={`text-[11px] tabular-nums ${T.faint} ${className}`}>
      {P.buildLabel || "Sürüm"}: <span className="font-mono">{sha || (P.buildUnknown || "bilinmiyor")}</span>
      {when ? ` · ${when}` : ""}
    </div>
  );
}

/**
 * "Dikkat gerekenler" — yöneticinin panosu bir rakam tablosuyla değil, **bekleyen işle** açılır.
 *
 * Dört büyük KPI (doluluk, ortalama yatış, kabul, taburcu) bir yöneticiyi hiçbir işe götürmüyordu:
 * hepsi doğruydu, hiçbiri bir eylem gerektirmiyordu. Buradaki dördü ise yalnızca **birinin bir
 * şey yapması gerektiğinde** görünür ve tıklanınca o işin yapılacağı ekrana götürür.
 *
 * Hepsi mevcut durumdan hesaplanır; hiçbiri yeni bir kayıt ya da yeni bir uç gerektirmez.
 * Sayılacak bir şey yoksa şerit hiç çıkmaz — boş bir "0" satırı, bakılacak bir şey varmış gibi
 * duran bir gürültüdür.
 */
function AttentionStrip({ T, S, state }) {
  const P = S.pr8 || {};
  const openAlarms = (state.alerts || []).filter((a) => a.status === "FIRED");
  const oldest = openAlarms.reduce((m, a) => Math.max(m, state.clockSec - a.firedAtSec), 0);
  const feeds = wardFeedHealth(state.patients || []);
  const hasFeedClock = (state.patients || []).some((p) => p?.measuredAt && Object.keys(p.measuredAt).length > 0);
  const waitingHis = awaitingLocalAdmission(state.patients || []).length;
  const unseenResults = (state.results || []).filter((r) => r.status !== "reviewed").length;

  const items = [
    openAlarms.length > 0 && {
      key: "alarms", tone: "bad", icon: Bell, n: openAlarms.length,
      text: P.attnAlarms || "cevapsız alarm", hint: oldest > 0 ? `${P.attnOldest || "en eskisi"} ${fmtClock(oldest)}` : null,
    },
    hasFeedClock && feeds.silentCount > 0 && {
      key: "feeds", tone: "warn", icon: Radio, n: feeds.silentCount,
      text: P.attnSilent || "yatakta cihaz susmuş", hint: null,
    },
    unseenResults > 0 && {
      key: "results", tone: "neutral", icon: Inbox, n: unseenResults,
      text: P.attnResults || "sonuç görülmedi", hint: null,
    },
    waitingHis > 0 && {
      key: "his", tone: "neutral", icon: PlugZap, n: waitingHis,
      text: P.attnWaiting || "HBYS hastası yatağa alınmadı", hint: null,
    },
  ].filter(Boolean);

  if (items.length === 0) return null;

  const tones = {
    bad: "border-red-500/35 bg-red-500/[0.06] text-red-500",
    warn: "border-amber-500/35 bg-amber-500/[0.06] text-amber-500",
    neutral: `${T.border} ${T.card} ${T.faint}`,
  };
  return (
    <div>
      <div className={`mb-2 text-xs font-semibold uppercase tracking-wide ${T.faint}`}>
        {P.attnTitle || "Dikkat gerekenler"}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map(({ key, tone, icon: Icon, n, text, hint }) => (
          <div key={key} className={`flex items-start gap-3 rounded-2xl border p-4 ${tones[tone]}`}>
            <span className="mt-0.5 shrink-0"><Icon size={18} /></span>
            <span className="min-w-0">
              <span className={`block text-2xl font-bold leading-none ${T.heading}`}>{n}</span>
              <span className={`mt-1 block text-xs leading-snug ${T.muted}`}>{text}</span>
              {hint && <span className={`mt-0.5 block text-[11px] ${T.faint}`}>{hint}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminPage({ T, S, store, state }) {
  const [tab, setTab] = useState("reports");
  const TABS = [
    { key: "reports", label: S.pr8.reports, icon: BarChart3 },
    { key: "structure", label: S.pr7.hierarchy, icon: Building2 },
    { key: "staff", label: S.pr7.staffMatrix, icon: Users },
    { key: "security", label: S.pr10.inviteTitle, icon: Shield },
    { key: "devices", label: S.pr7.devices, icon: Radio },
    { key: "alarms", label: S.pr7.alarmQuality, icon: BellRing },
    { key: "audit", label: S.pr7.auditSearch, icon: ScrollText },
    { key: "archive", label: S.pr13.archiveTitle, icon: Archive },
    { key: "sessions", label: S.pr13.sessionsTitle, icon: Monitor },
    { key: "heatmap", label: S.nav.heatmap, icon: Grid3x3 },
  ];
  return (
    <div className="space-y-4">
      <AttentionStrip T={T} S={S} state={state} />
      {/* section tabs */}
      <div className={`flex flex-wrap gap-1.5 rounded-2xl border ${T.border} ${T.card} p-1.5`}>
        {TABS.map((t) => {
          const I = t.icon; const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${active ? T.navActive : T.navIdle}`}>
              <I size={16} /> <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === "reports" && <AnalyticsPanel T={T} S={S} state={state} />}
      {tab === "structure" && (
        <div className="space-y-4">
          <HierarchyTree T={T} S={S} state={state} />
          <StructureAdmin T={T} S={S} store={store} state={state} />
        </div>
      )}
      {tab === "staff" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <UserAdmin T={T} S={S} store={store} state={state} />
          <StaffMatrix T={T} S={S} store={store} state={state} />
        </div>
      )}
      {tab === "security" && <InviteManagement T={T} S={S} store={store} state={state} />}
      {tab === "devices" && <DeviceAdmin T={T} S={S} store={store} state={state} />}
      {tab === "alarms" && <AlarmQualityPanel T={T} S={S} store={store} />}
      {tab === "audit" && (
        <div className="space-y-4">
          <BreakGlassReview T={T} S={S} store={store} state={state} />
          <AuditLog T={T} S={S} state={state} store={store} />
        </div>
      )}
      {tab === "archive" && <ArchiveManagement T={T} S={S} store={store} state={state} />}
      {tab === "sessions" && <SessionManagement T={T} S={S} store={store} state={state} />}
      {tab === "heatmap" && <HeatmapPage T={T} S={S} store={store} state={state} />}

      <BuildInfo T={T} S={S} className="pt-1 text-right" />
    </div>
  );
}












// Yatak durum kartı — dolu yataklar kilitli (hasta çıkışı olmadan durum değiştirilemez).
const BED_STATE_BADGE = {
  AVAILABLE: "bg-emerald-500/15 text-emerald-500",
  OCCUPIED: "bg-brand/15 text-brand",
  HOUSEKEEPING: "bg-cyan-500/15 text-cyan-500",
  FAULTY: "bg-amber-500/15 text-amber-500",
  OUT_OF_SERVICE: "bg-red-500/15 text-red-500",
};

// ================================================================ PR#6 · shared clinical UI
// KVKK name masking helper — applied at the render layer so the store keeps the real synthetic name.
function IdentityStatus({ p, S, className }) {
  if (!p.identityState && p.source !== "device") return null;
  if (!p.identityState) return <div className={className}>{S.identity.missing}</div>;
  const stamp = p.identityUpdatedAt ? new Date(p.identityUpdatedAt) : null;
  return <div className={className}>
    {p.source === "comed" ? "Comed" : S.identity.manual}
    {stamp && !Number.isNaN(stamp.getTime()) ? ` · ${stamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
    {p.identityState === "discharged" ? ` · ${S.identity.discharged}` : ""}
  </div>;
}
function news2Level(score) {
  if (score >= 7) return { text: "text-red-500", ring: "ring-red-500/50" };
  if (score >= 5) return { text: "text-amber-500", ring: "ring-amber-500/50" };
  return { text: "text-emerald-500", ring: "ring-emerald-500/40" };
}
// Short labels for the NEWS2 parameters the engine reports as unmeasured.
const NEWS2_MISSING_LABEL = {
  respiration_rate: "solunum hızı", spo2: "SpO2", systolic_bp: "sistolik TA",
  pulse: "nabız", temperature: "ateş",
};

/**
 * The NEWS2 badge.
 *
 * `news2` is the engine's own score — {total, partial, missing[]} — and is preferred whenever
 * it is there. The local `computeNews2(vitals)` is a simplified stand-in that substitutes mean
 * arterial pressure for systolic and drops the oxygen and consciousness terms; it exists for
 * the simulation, which has no engine behind it, and must never be what a ward reads. Showing
 * two different numbers under one name is the failure this signature exists to prevent.
 *
 * ⚠️ 20.09.2026 — the fallback WAS what the ward read. On the pilot, the engine predates the
 * board payload that carries `news2`, so every card fell through to the local sum; and because
 * NEWS2 scores an unmeasured parameter as 0 and the ward's monitors send no respiratory rate,
 * the screen showed a calm green **"NEWS2: 0"** on patients nobody had scored. A number the
 * system cannot stand behind is worse than no number: the blank prompts someone to look, the
 * zero tells them not to. Live mode now shows "—" and says why; the local sum is confined to
 * the simulation, where there is no engine to disagree with.
 *
 * A partial score is marked, not hidden, for the same reason.
 */
const SimulationContext = React.createContext(false);

function News2Pill({ S, vitals, news2 = null }) {
  const simulation = React.useContext(SimulationContext);
  const fromEngine = news2 && typeof news2.total === "number";

  if (!fromEngine && !simulation) {
    // Canlı mod, motor skoru yok: hesabı ekran yapmaz.
    return (
      <span title={S.pr6?.news2NoEngine || "Motor bu hasta için NEWS2 göndermiyor — ekran kendi hesabını yapmaz."}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-slate-400 ring-1 ring-slate-400/40">
        <TrendingUp size={13} /> {S.pr6.news2}: —
      </span>
    );
  }
  if (!fromEngine && !vitals) return null;

  const score = fromEngine ? news2.total : computeNews2(vitals);
  // Simülasyonda da eksik vital kısmi skordur: ölçülmeyeni 0 saymak hastayı olduğundan iyi gösterir.
  const localMissing = fromEngine ? [] : ["hr", "map", "spo2", "temp", "rr"].filter((k) => vitals?.[k] == null);
  const partial = fromEngine ? Boolean(news2.partial) : localMissing.length > 0;
  const lv = news2Level(score);
  const missing = fromEngine
    ? (news2.missing || []).map((m) => NEWS2_MISSING_LABEL[m] || m).join(", ")
    : localMissing.map((m) => NEWS2_MISSING_LABEL[{ rr: "respiration_rate", spo2: "spo2", hr: "pulse", temp: "temperature", map: "systolic_bp" }[m]] || m).join(", ");

  return (
    <span
      title={partial ? `Kısmi skor — ${missing} ölçülmedi; gerçek toplam daha yüksek olabilir.` : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${lv.ring} ${lv.text}`}>
      <TrendingUp size={13} /> {S.pr6.news2}: {score}
      {partial && <span className="opacity-80" aria-label="kısmi skor">*</span>}
    </span>
  );
}

// Visual escalation timeline (0–3 / 3–5 / 5–10 min) — the three notification tiers of S-05.
function EscalationTimeline({ T, S, alert, state }) {
  const elapsed = alert.status === "FIRED" ? state.clockSec - alert.firedAtSec
    : alert.status === "CLOSED" || alert.status === "ACKNOWLEDGED" ? 99999 : 0;
  const stages = [
    { key: "t1", from: 0, label: S.pr6.escT1, who: S.pr6.escT1Who },
    { key: "t2", from: 180, label: S.pr6.escT2, who: S.pr6.escT2Who },
    { key: "t3", from: 300, label: S.pr6.escT3, who: S.pr6.escT3Who },
  ];
  return (
    <div className="mt-3">
      <div className={`mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${T.faint}`}>
        <TrendingUp size={12} /> {S.pr6.escTimeline}
      </div>
      <div className="flex items-stretch gap-1.5">
        {stages.map((st, i) => {
          const next = stages[i + 1];
          const active = alert.status === "FIRED" && elapsed >= st.from && (!next || elapsed < next.from);
          const done = next ? elapsed >= next.from : elapsed >= st.from && alert.status !== "FIRED";
          const tone = done ? "bg-red-500/20 text-red-500 ring-red-500/40"
            : active ? "bg-amber-500/20 text-amber-500 ring-amber-500/50 animate-pulse"
            : `${T.chip} ring-transparent`;
          return (
            <div key={st.key} className={`flex-1 rounded-lg px-2 py-1.5 ring-1 ${tone}`}>
              <div className="flex items-center gap-1 text-[11px] font-bold">
                {done ? <CheckCircle2 size={12} /> : active ? <Siren size={12} /> : <Circle size={12} />} {st.label}
              </div>
              <div className={`mt-0.5 text-[10px] leading-tight ${done || active ? "" : T.faint}`}>{st.who}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ICD-10 auto-complete search. Codes are the international standard and never translated.
function Icd10Search({ T, S, lang, onPick }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = q.trim().length >= 2 ? searchIcd10(q).slice(0, 6) : [];
  return (
    <div className="relative">
      <input className={inputCls(T)} value={q} placeholder={S.pr6.searchDiagnosis}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && results.length > 0 && (
        <div className={`absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border ${T.border} ${T.card} p-1 shadow-2xl`}>
          {results.map((r) => (
            <button key={r.code} type="button"
              onClick={() => { onPick(r); setQ(""); setOpen(false); }}
              className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${T.navIdle}`}>
              <span className="shrink-0 rounded bg-brand/15 px-1.5 py-0.5 text-xs font-bold text-brand">{r.code}</span>
              <span className={`text-xs ${T.text}`}>{r[lang] || r.tr}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ================================================================ FAZ C — branş profili rozeti (Madde 7)
// Hastanın bağlı olduğu ünitenin branş klinik profilini (Erişkin/Pediatri/Yenidoğan/KVC/Koroner/
// Acil/Ameliyathane/Palyatif) renk + isim + skorlama modeli ile gösterir.
function BranchProfileBadge({ S, lang, profile, size = "sm" }) {
  if (!profile) return null;
  const name = profile.names[lang] || profile.names.tr;
  const pad = size === "lg" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[11px]";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ${pad} ${profile.tone}`}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: profile.accent }} />
      {name}
      <span className="opacity-70">· {profile.score}</span>
    </span>
  );
}

// ================================================================ FAZ C — çok parametreli trend (Madde 18)
// Tek zaman ekseni üzerinde HR / SpO₂ / MAP / Temp / RR eğrilerini üst üste çizer. Seri aç/kapa,
// zaman aralığı yakınlaştırma (1s/3s/6s) ve ilaç başlangıç olay işaretleri içerir. Harici grafik
// kütüphanesi kullanılmaz — saf SVG (Sparkline ile aynı yaklaşım).
const TREND_SERIES = [
  { key: "hr",   label: "HR",   color: "#f472b6", unit: "/dk" },
  { key: "spo2", label: "SpO₂", color: "#38bdf8", unit: "%" },
  { key: "map",  label: "MAP",  color: "#a3e635", unit: "mmHg" },
  { key: "temp", label: "Temp", color: "#fb923c", unit: "°C" },
  { key: "rr",   label: "RR",   color: "#c084fc", unit: "/dk" },
];
function MultiTrendChart({ T, S, hist, medications }) {
  const [enabled, setEnabled] = useState({ hr: true, spo2: true, map: true, temp: false, rr: false });
  const [rangeH, setRangeH] = useState(6);
  const toggle = (k) => setEnabled((s) => ({ ...s, [k]: !s[k] }));
  const now = Date.now();
  const t0 = now - rangeH * 3600 * 1000;
  const pts = (hist || []).filter((h) => h.tMs >= t0);
  if (pts.length < 2) return <Empty T={T} text={S.pr14.noTrend} />;

  const W = 680, H = 230, padL = 8, padR = 8, padT = 22, padB = 20;
  const tMin = pts[0].tMs, tMax = pts[pts.length - 1].tMs;
  const tSpan = (tMax - tMin) || 1;
  const xFor = (tMs) => padL + ((tMs - tMin) / tSpan) * (W - padL - padR);
  const seriesPath = (key) => {
    const vals = pts.map((p) => p[key]).filter((v) => v != null);
    if (vals.length < 2) return null;
    const mn = Math.min(...vals), mx = Math.max(...vals), sp = (mx - mn) || 1;
    const yFor = (v) => padT + (1 - (v - mn) / sp) * (H - padT - padB);
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.tMs).toFixed(1)},${yFor(p[key]).toFixed(1)}`).join(" ");
    return { d, last: vals[vals.length - 1] };
  };
  // İlaç başlangıç olay işaretleri (pencere içindeki startMs).
  const events = (medications || []).filter((m) => m.startMs != null && m.startMs >= tMin && m.startMs <= tMax);
  const fmtT = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      {/* seri aç/kapa + latest değer + zaman aralığı */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {TREND_SERIES.map((s) => {
          const sp = seriesPath(s.key);
          const on = enabled[s.key];
          return (
            <button key={s.key} onClick={() => toggle(s.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition ${on ? "ring-transparent" : `${T.chip} opacity-50`}`}
              style={on ? { backgroundColor: `${s.color}22`, color: s.color } : undefined}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}{sp && <span className="tabular-nums opacity-80">{sp.last}</span>}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1">
          <span className={`text-[10px] uppercase ${T.faint}`}>{S.pr14.trendZoom}</span>
          {[1, 3, 6].map((h) => (
            <button key={h} onClick={() => setRangeH(h)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${rangeH === h ? "bg-brand text-white" : T.ghost}`}>{h}s</button>
          ))}
        </div>
      </div>
      <div className={`rounded-xl border ${T.border} ${T.subtle} p-2`}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
          {/* olay işaretleri: dikey kesikli çizgi + üçgen */}
          {events.map((m, i) => {
            const x = xFor(m.startMs);
            return (
              <g key={m.id || i}>
                <line x1={x} y1={padT} x2={x} y2={H - padB} stroke={T.trendEvent || "#94a3b8"} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
                <polygon points={`${x - 4},${padT - 6} ${x + 4},${padT - 6} ${x},${padT}`} fill="#eab308" />
              </g>
            );
          })}
          {TREND_SERIES.filter((s) => enabled[s.key]).map((s) => {
            const sp = seriesPath(s.key);
            if (!sp) return null;
            return <path key={s.key} d={sp.d} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />;
          })}
        </svg>
        <div className={`mt-1 flex items-center justify-between text-[10px] tabular-nums ${T.faint}`}>
          <span>{fmtT(tMin)}</span>
          {events.length > 0 && <span className="inline-flex items-center gap-1"><Pill size={10} /> {S.pr14.events}</span>}
          <span>{fmtT(tMax)} · {S.pr14.now}</span>
        </div>
      </div>
    </div>
  );
}

// ================================================================ FAZ C — sıvı dengesi zaman çizelgesi (Madde 21)
// Kronolojik sıvı olaylarından kümülatif alınan/çıkan ve anlık dengeyi çizer. Denge eşik dışına
// çıkarsa uyarı rozeti gösterir (sistem asla tanı koymaz — "yeniden değerlendirilecek").
function FluidBalanceTimeline({ T, S, fluids }) {
  const evs = [...(fluids || [])].sort((a, b) => a.atMs - b.atMs);
  if (evs.length === 0) return <Empty T={T} text={S.pr14.noFluids} />;
  let cin = 0, cout = 0;
  const rows = evs.map((f) => {
    if (f.kind === "in") cin += f.ml; else cout += f.ml;
    return { ...f, cin, cout, bal: cin - cout };
  });
  const totalIn = cin, totalOut = cout, balance = cin - cout;
  const maxCum = Math.max(cin, cout, 1);
  const WARN = 1500; // ± eşik (mL) — demo amaçlı
  const warn = Math.abs(balance) >= WARN;
  const fmtT = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div>
      <div className="mb-2 grid grid-cols-3 gap-2 text-center">
        <div className={`rounded-lg border ${T.border} ${T.subtle} p-2`}>
          <div className={`text-[10px] uppercase ${T.faint}`}>{S.pr14.cumulativeIn}</div>
          <div className="text-sm font-bold tabular-nums text-sky-500">{totalIn} mL</div>
        </div>
        <div className={`rounded-lg border ${T.border} ${T.subtle} p-2`}>
          <div className={`text-[10px] uppercase ${T.faint}`}>{S.pr14.cumulativeOut}</div>
          <div className="text-sm font-bold tabular-nums text-amber-500">{totalOut} mL</div>
        </div>
        <div className={`rounded-lg border ${T.border} ${T.subtle} p-2`}>
          <div className={`text-[10px] uppercase ${T.faint}`}>{S.pr14.runningBalance}</div>
          <div className={`text-sm font-bold tabular-nums ${balance >= 0 ? "text-emerald-500" : "text-red-500"}`}>{balance > 0 ? "+" : ""}{balance} mL</div>
        </div>
      </div>
      {warn && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle size={14} /> {S.pr14.balanceWarn}
        </div>
      )}
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <span className={`w-10 shrink-0 text-[10px] tabular-nums ${T.faint}`}>{fmtT(r.atMs)}</span>
            <div className="flex h-4 flex-1 items-center overflow-hidden rounded bg-slate-500/10">
              <div className="h-full" style={{ width: `${(r.cin / maxCum) * 100}%`, backgroundColor: "#38bdf8aa" }} />
              <div className="h-full" style={{ width: `${(r.cout / maxCum) * 100}%`, backgroundColor: "#f59e0baa" }} />
            </div>
            <span className={`w-24 shrink-0 truncate text-[11px] ${T.text}`}>{r.label || (r.kind === "in" ? S.pr6.intake : S.pr6.output)}</span>
            <span className={`w-12 shrink-0 text-right text-[11px] font-semibold tabular-nums ${r.bal >= 0 ? "text-emerald-500" : "text-red-500"}`}>{r.bal > 0 ? "+" : ""}{r.bal}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ================================================================ FAZ C — ilaç/infüzyon zaman çizelgesi (Madde 21)
// Son 24 saatlik pencerede her ilaç/infüzyonu yatay Gantt çubuğu olarak gösterir (başlangıç→bitiş
// veya "devam ediyor"). Aktif infüzyonlar canlı renkle vurgulanır.
function MedicationTimeline({ T, S, medications }) {
  const meds = medications || [];
  if (meds.length === 0) return <Empty T={T} text={S.pr14.noMeds} />;
  const now = Date.now();
  const windowH = 24;
  const t0 = now - windowH * 3600 * 1000;
  const span = now - t0;
  const fmtT = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="space-y-1.5">
      <div className={`flex justify-between text-[10px] tabular-nums ${T.faint}`}>
        <span>-{windowH}s</span><span>{S.pr14.now}</span>
      </div>
      {meds.map((m) => {
        const start = Math.max(m.startMs || t0, t0);
        const end = m.endMs || now;
        const left = ((start - t0) / span) * 100;
        const width = Math.max(2, ((Math.min(end, now) - start) / span) * 100);
        const ongoing = !m.endMs;
        return (
          <div key={m.id} className="flex items-center gap-2">
            <span className={`w-28 shrink-0 truncate text-[11px] font-medium ${T.text}`} title={m.name}>{m.name}</span>
            <div className="relative h-4 flex-1 rounded bg-slate-500/10">
              <div className={`absolute top-0 h-full rounded ${ongoing ? "bg-emerald-500/70" : "bg-slate-400/60"}`}
                style={{ left: `${left}%`, width: `${width}%` }} title={`${fmtT(start)} → ${ongoing ? S.pr14.ongoing : fmtT(end)}`} />
            </div>
            <span className={`w-16 shrink-0 text-right text-[10px] tabular-nums ${ongoing ? "text-emerald-500" : T.faint}`}>{m.dose} {m.unit}</span>
          </div>
        );
      })}
    </div>
  );
}

// ================================================================ FAZ C — tam ekran hasta kokpiti (Madde 8)
// Dar sürgü panelinin ("2. görsel") yarattığı sıkışıklığı çözer: geniş iki sütunlu, satır içi
// düzenlenebilir kokpit. Sol sütun = izlem (branş profili, vitaller, NEWS2, çok parametreli trend,
// sıvı/ilaç zaman çizelgeleri); sağ sütun = klinik veri girişi (ICD-10/ilaç/işlem/sıvı/eşik).
function PatientCockpit({ T, S, state, store, patientId, onClose, lang, simulation = false }) {
  const p = state.patients.find((x) => x.patient_id === patientId);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!p) return null;
  const ru = riskUi(p.risk);
  const profile = profileForPatient(state, p);
  const rec = state.clinical[patientId] || { diagnoses: [], medications: [], procedures: [], fluids: [], vitalHistory: [] };
  const team = state.careTeam[p.patient_id] || {};
  const userName = (id) => state.users.find((u) => u.id === id)?.full_name || S.none;
  return (
    <div className="fixed inset-0 z-[60]">
      <div className={`absolute inset-0 ${T.overlay}`} onClick={onClose} />
      <div className={`absolute inset-0 sm:inset-3 lg:inset-6 flex flex-col overflow-hidden rounded-none sm:rounded-2xl border ${T.border} ${T.card} shadow-2xl`}>
        {/* başlık şeridi */}
        <div className={`flex items-center gap-3 border-b ${T.border} ${T.sidebar} px-4 py-3`}
          style={{ boxShadow: `inset 4px 0 0 ${profile.accent}` }}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {/* Kimliği olmayan hasta: pilotta HBYS beslemesi yokken kart adsız açılıyor ve
                  başlık "· — ·" diye görünüyordu. Adın yerine yatağı koymak, ekranın hangi
                  hastadan söz ettiğini her durumda söyler. */}
              <h2 className={`truncate text-lg font-bold ${T.heading}`}>
                {maskedName(state, p.display_name) || `${S.bed} ${p.bedLabel || "—"}`}
              </h2>
              {!p.display_name && (
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${T.chip}`}>{S.pr14.identityPending || "kimlik bekleniyor"}</span>
              )}
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${ru.ring} ${ru.text}`}>
                <span className={`h-2 w-2 rounded-full ${ru.dot}`} /> {S.risk[p.risk]}
              </span>
              <BranchProfileBadge S={S} lang={lang} profile={profile} />
            </div>
            <div className={`mt-0.5 flex flex-wrap gap-x-2 truncate text-xs ${T.faint}`}>
              {/* Boş kimlik alanı yazılmaz: "Protokol No —" bilinmeyen ile yok olanı karıştırır. */}
              {[p.display_name ? p.bedLabel : null,
                p.mrn ? `${S.mrn} ${p.mrn}` : null,
                p.protocolNo ? `${S.protocolNo} ${p.protocolNo}` : null,
                p.age != null || p.ageDays != null ? ageText(p, S) : null,
                p.admittedAtMs ? losText(p.admittedAtMs, S) : null,
              ].filter(Boolean).map((bit, i, arr) => (
                <span key={bit}>{bit}{i < arr.length - 1 ? " ·" : ""}</span>
              ))}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <News2Pill S={S} vitals={p.vitals} news2={p.news2} />
            <button onClick={onClose} className={`grid h-9 w-9 place-items-center rounded-lg ${T.ghost}`} title={S.close || "Kapat"}><X size={18} /></button>
          </div>
        </div>
        {/* iki sütunlu gövde */}
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
          {/* SOL — izlem.
              Bölüm sırası bilinçli: ölçülen en üstte, kaydedilen altında, boş olan hiç yok.
              Eski düzende trend/sıvı/ilaç/ekip başlıkları kayıt olmasa da basılıyordu ve ekranın
              yarısı dört ayrı "yok" kutusuna gidiyordu — bakan kişi hiçbirini okumuyor, ama
              vitallerin altındaki boşluk onları ekranın dışına itiyordu. */}
          <div className="space-y-4">
            <div>
              <div className={`mb-2 flex items-center gap-2 text-xs font-semibold uppercase ${T.faint}`}>
                {S.vitals}
                <span className="h-px flex-1 bg-current opacity-20" />
                <span className="normal-case">{profile.names[lang] || profile.names.tr} · {profile.focus[lang] || profile.focus.tr}</span>
              </div>
              <VitalsGrid T={T} vitals={p.vitals} />
            </div>

            {/* Katlama hastanın durumundan hesaplanır, sabit bir tercih değil: vazopresör
                akan hastada ilaç satırı açık gelir, akmayan hastada kapalı ve tek satır özet.
                Kapalı bölüm boş bir başlık değildir — içindekini özetler. */}
            {rec.vitalHistory?.length > 1 && (
              <Collapsible T={T} icon={TrendingUp} title={S.pr14.trendTitle} defaultOpen
                summary={`${rec.vitalHistory.length} ${S.pr6.measurement || "ölçüm"}`}>
                <MultiTrendChart T={T} S={S} hist={rec.vitalHistory} medications={rec.medications} />
              </Collapsible>
            )}
            {rec.medications?.length > 0 && (() => {
              const active = rec.medications.filter((m) => !m.endMs);
              const pressor = active.some((m) => /noradrenalin|adrenalin|dopamin|dobutamin/i.test(m.name));
              return (
                <Collapsible T={T} icon={Pill} title={S.pr14.medTimeline}
                  tone={pressor ? "warn" : undefined}
                  defaultOpen={pressor}
                  summary={active.length
                    ? active.map((m) => `${m.name} ${m.dose}${m.unit ? " " + m.unit : ""}`).join(" · ")
                    : S.pr6.noMedications}>
                  <MedicationTimeline T={T} S={S} medications={rec.medications} />
                </Collapsible>
              );
            })()}
            {rec.fluids?.length > 0 && (() => {
              const inMl = rec.fluids.filter((f) => f.kind === "in").reduce((a, f) => a + f.ml, 0);
              const outMl = rec.fluids.filter((f) => f.kind === "out").reduce((a, f) => a + f.ml, 0);
              const bal = inMl - outMl;
              return (
                <Collapsible T={T} icon={Droplet} title={S.pr14.fluidTimeline}
                  summary={`${S.pr6.balance}: ${bal > 0 ? "+" : ""}${bal} mL`}>
                  <FluidBalanceTimeline T={T} S={S} fluids={rec.fluids} />
                </Collapsible>
              );
            })()}

            {/* Kayıt yoksa gizlemek değil, tek satırda söylemek: "boş" da bir bulgudur —
                ama dört kutu yerine bir cümle kadar yer tutar. */}
            {!(rec.vitalHistory?.length > 1) && !(rec.fluids?.length) && !(rec.medications?.length) && (
              <div className={`rounded-xl border border-dashed ${T.border} px-3 py-2.5 text-xs ${T.faint}`}>
                {S.pr14.noChartYet || "Bu hastada henüz trend, sıvı ve ilaç kaydı yok — sağdaki alanlardan girilir."}
              </div>
            )}

            <Collapsible T={T} icon={Users} title={S.careTeamLabel}
              summary={`${userName(team.attendingId)} · ${userName(team.nurseId)}`}>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className="flex items-center gap-2"><span className={T.muted}>{S.attending}</span><span className={`font-semibold ${T.text}`}>{userName(team.attendingId)}</span></span>
                <span className="flex items-center gap-2"><span className={T.muted}>{S.nurse}</span><span className={`font-semibold ${T.text}`}>{userName(team.nurseId)}</span></span>
              </div>
            </Collapsible>
          </div>
          {/* SAĞ — klinik veri girişi (satır içi düzenlenebilir) */}
          <div className={`rounded-xl border ${T.border} ${T.subtle} p-3`}>
            <ClinicalModule T={T} S={S} store={store} state={state} patientId={patientId} lang={lang} simulation={simulation} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Full clinical data-entry module (physician): diagnoses, drugs/infusions, procedures, fluid balance,
// mini vital trends, NEWS2, per-patient thresholds and one-click epicrisis/handover report.
/**
 * The pharmacy view (E9).
 *
 * PHARMACIST existed as a role and could reach no screen this system did not also show to
 * everyone else — "rol var, işi yok". This page is its work.
 *
 * What belongs to a pharmacist in this engine is the **1-hour antibiotic window** after sepsis
 * recognition. Until now that was reachable only as an alert that had already fired, which is
 * precisely too late to be useful to the person who could have stopped it firing. Here the clock
 * is visible while it is still running.
 *
 * Two lines this screen does not cross:
 *   - **It suggests no dose.** Creatinine and weight are shown because a pharmacist reads a
 *     regimen against them; turning them into a number would be an order, and the register
 *     forbids one. The system states facts; the pharmacist and the physician decide.
 *   - **It never renders "nothing charted" as "not given".** Those are different situations and
 *     one of them is an accusation.
 */
function PharmacyPage({ T, S, state }) {
  const patients = state.patients || [];
  const withClock = patients.filter((p) => p?.meds?.antibiotic_clock);
  const onInfusion = patients.filter((p) => p?.meds?.on_pressor && !p?.meds?.antibiotic_clock);

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border ${T.border} ${T.card} ${T.lift} p-5`}>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Pill size={17} className={T.accent} />
          <h3 className={`font-bold ${T.heading}`}>{S.pr7.pharmacyTitle}</h3>
        </div>
        <p className={`text-xs ${T.muted}`}>{S.pr7.pharmacySubtitle}</p>
        <p className={`mt-1 text-[11px] ${T.faint}`}>{S.pr7.pxOrderWarning}</p>
      </div>

      {withClock.length === 0 && onInfusion.length === 0 && (
        <div className={`rounded-2xl border ${T.border} ${T.card} p-5 text-sm ${T.muted}`}>
          {S.pr7.pxEmpty}
        </div>
      )}

      {withClock.length > 0 && (
        <div>
          <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.pr7.pxUrgent}</div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {withClock.map((p) => <PharmacyCard key={p.patient_id} T={T} S={S} p={p} />)}
          </div>
        </div>
      )}

      {onInfusion.length > 0 && (
        <div>
          <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.pr7.pxOther}</div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {onInfusion.map((p) => <PharmacyCard key={p.patient_id} T={T} S={S} p={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}

/** One bed, from the pharmacy's point of view: the clock, what is running, and the renal context. */
function PharmacyCard({ T, S, p }) {
  const meds = p.meds || {};
  const clock = meds.antibiotic_clock;
  const mins = (sec) => Math.round(Math.abs(sec) / 60);

  // Three states, never collapsed into two. `null` is the one that matters: it means nobody
  // charted an antibiotic either way, and calling that a missed dose accuses a ward of something
  // it may not have done.
  let clockTone = T.muted, clockText = S.pr7.pxNoClock, hint = "";
  if (clock) {
    if (meds.antibiotic_given === true) {
      clockTone = clock.met ? "text-emerald-500" : "text-amber-500";
      clockText = clock.met ? S.pr7.pxGiven : S.pr7.pxGivenLate;
    } else if (meds.antibiotic_given === false) {
      clockTone = "text-amber-500";
      clockText = S.pr7.pxNoneCharted;
    } else if (clock.remaining_sec != null && clock.remaining_sec < 0) {
      clockTone = "text-red-500";
      clockText = `${S.pr7.pxOverdue} · ${mins(clock.remaining_sec)} dk`;
      hint = S.pr7.pxNotChartedHint;
    } else {
      clockTone = "text-amber-500";
      clockText = `${mins(clock.remaining_sec ?? 0)} dk ${S.pr7.pxRemaining}`;
      hint = S.pr7.pxNotChartedHint;
    }
  }

  const running = Object.entries(meds.pressors || {})
    .filter(([, rate]) => rate != null && rate > 0);

  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} ${T.lift} p-4`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`font-bold ${T.heading}`}>{p.bedLabel || p.patient_id}</span>
        {p.display_name && <span className={`text-xs ${T.muted}`}>{p.display_name}</span>}
      </div>

      <div className={`rounded-xl border ${T.border} ${T.subtle} p-2.5`}>
        <div className={`text-[10px] font-semibold uppercase ${T.faint}`}>{S.pr7.pxClock}</div>
        <div className={`text-sm font-bold ${clockTone}`}>{clockText}</div>
        {clock && (
          <div className={`mt-0.5 text-[11px] ${T.faint}`}>
            {S.pr7.pxRecognized}: {new Date(clock.recognized_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
        {hint && <div className={`mt-1 text-[11px] leading-snug ${T.faint}`}>{hint}</div>}
      </div>

      <div className={`mt-2 rounded-xl border ${T.border} ${T.subtle} p-2.5`}>
        <div className={`text-[10px] font-semibold uppercase ${T.faint}`}>{S.pr7.pxInfusions}</div>
        {running.length === 0
          ? <div className={`text-xs ${T.muted}`}>{S.pr7.pxNoInfusion}</div>
          : (
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              {running.map(([name, rate]) => (
                <span key={name} className={`rounded-full px-2.5 py-0.5 text-xs ${T.chip}`}>
                  {name} {rate} mcg/kg/dk
                </span>
              ))}
            </div>
          )}
      </div>

      {/* Facts, not a dose. The pharmacist reads a regimen against these; the system does not. */}
      <div className={`mt-2 flex flex-wrap items-baseline gap-x-3 text-xs ${T.muted}`}>
        <span className={`text-[10px] font-semibold uppercase ${T.faint}`}>{S.pr7.pxRenal}</span>
        <span>kreatinin {meds.creatinine ?? "—"} mg/dL</span>
        <span>{meds.weight_kg ?? "—"} kg</span>
      </div>
    </div>
  );
}

/**
 * The two facts the whole sepsis branch depends on, and neither had a control anywhere.
 *
 * `suspected_infection` is a gate: the engine's `septic_shock.evaluate` returns at its first line
 * until a clinician charts it, so a bed with no sepsis alert may simply be a bed nobody assessed.
 * `store.setSuspectedInfection` existed and was called from nothing — the branch was unreachable
 * from the ward.
 *
 * `baseline_sofa` is what the score is compared against. Sepsis-3 asks for a RISE of 2 points, so
 * on a chronic-dialysis patient carrying 3 renal points every day of their life, the absolute
 * total says "sepsis" forever. The physician is the only person who knows that patient's normal,
 * so this is where they say it.
 *
 * Rendered only where the store can actually reach the engine — in the simulation it is absent
 * rather than a button that pretends.
 */
function SepsisPanel({ T, S, store, patient, patientId }) {
  const sep = patient?.sepsis || null;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const charted = sep?.baseline_sofa;
  useEffect(() => { setDraft(charted === null || charted === undefined ? "" : String(charted)); },
            [charted]);

  const run = async (tag, fn) => {
    setBusy(tag); setErr("");
    try { await fn(); } catch (ex) { setErr(ex?.message || String(ex)); }
    finally { setBusy(""); }
  };

  const suspected = sep?.suspected_infection;   // true | false | null (never charted)
  const gateText = suspected === true ? S.pr6.sepsisGateYes
    : suspected === false ? S.pr6.sepsisGateNo : S.pr6.sepsisGateNone;
  const gateTone = suspected === true ? "text-amber-500"
    : suspected === false ? T.muted : "text-sky-500";

  return (
    <Section T={T} icon={Activity} title={S.pr6.sepsisTitle}>
      <div className={`rounded-lg border ${T.border} ${T.subtle} p-2.5`}>
        <div className={`text-[11px] font-semibold uppercase ${T.faint}`}>{S.pr6.sepsisGate}</div>
        <div className={`mt-0.5 text-xs ${gateTone}`}>{gateText}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            disabled={!!busy}
            onClick={() => run("yes", () => store.setSuspectedInfection(patientId, true))}
            className={`${btnCls(T, suspected === true ? "primary" : "ghost")} px-2.5 py-1.5 text-xs`}>
            {S.pr6.sepsisMark}
          </button>
          <button
            disabled={!!busy}
            onClick={() => run("no", () => store.setSuspectedInfection(patientId, false))}
            className={`${btnCls(T, "ghost")} px-2.5 py-1.5 text-xs`}>
            {S.pr6.sepsisClear}
          </button>
        </div>
      </div>

      <div className={`mt-2 rounded-lg border ${T.border} ${T.subtle} p-2.5`}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`text-[11px] font-semibold uppercase ${T.faint}`}>{S.pr6.sepsisSofa}</span>
          <span className={`text-sm font-bold tabular-nums ${T.text}`}>{sep?.sofa ?? "—"}</span>
          {sep && sep.baseline_assumed === false && (
            <>
              <span className={`text-[11px] font-semibold uppercase ${T.faint}`}>{S.pr6.sepsisRise}</span>
              <span className={`text-sm font-bold tabular-nums ${sep.rise >= 2 ? "text-amber-500" : T.muted}`}>
                +{sep.rise}
              </span>
            </>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <label className={`text-xs ${T.muted}`} htmlFor={`bsofa-${patientId}`}>{S.pr6.sepsisBaseline}</label>
          <input
            id={`bsofa-${patientId}`} type="number" min="0" max="24" step="1"
            className={`${inputCls(T)} w-20`} value={draft}
            onChange={(e) => setDraft(e.target.value)} />
          <button
            disabled={!!busy || draft === ""}
            onClick={() => run("baseline", () =>
              store.setProfile(patientId, { baselineSofa: Number(draft) }))}
            className={`${btnCls(T, "primary")} px-2.5 py-1.5 text-xs`}>
            {S.pr6.sepsisSave}
          </button>
        </div>
        <div className={`mt-1 text-[11px] leading-snug ${T.faint}`}>{S.pr6.sepsisBaselineHint}</div>
        {sep?.baseline_assumed && (
          <div className="mt-1 text-[11px] leading-snug text-sky-500">{S.pr6.sepsisAssumed}</div>
        )}
      </div>

      {err && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}
    </Section>
  );
}

function ClinicalModule({ T, S, store, state, patientId, lang, simulation = false }) {
  const p = state.patients.find((x) => x.patient_id === patientId);
  const rec = state.clinical[patientId] || { diagnoses: [], medications: [], procedures: [], fluids: [],
    thresholds: { ...DEFAULT_THRESHOLDS }, vitalHistory: [] };
  const [thOpen, setThOpen] = useState(false);
  const [tab, setTab] = useState("clinical");
  const [med, setMed] = useState({ name: MED_CATALOG[0]?.name || "", dose: "", unit: MED_CATALOG[0]?.unit || "" });
  const [proc, setProc] = useState(PROCEDURE_CATALOG[0] || "");
  const [fluid, setFluid] = useState({ kind: "in", label: "", ml: "" });
  const [err, setErr] = useState("");
  const wrap = (fn) => { try { fn(); setErr(""); } catch (ex) { setErr(ex.message); } };
  const pickMed = (name) => { const m = MED_CATALOG.find((x) => x.name === name); setMed((s) => ({ ...s, name, unit: m?.unit || "" })); };

  const intake = rec.fluids.filter((f) => f.kind === "in").reduce((a, f) => a + f.ml, 0);
  const output = rec.fluids.filter((f) => f.kind === "out").reduce((a, f) => a + f.ml, 0);
  const balance = intake - output;
  const hist = rec.vitalHistory || [];

  // Sağ kolon altı bölümü alt alta diziyordu ve hepsi aynı ağırlıktaydı: sepsis kutusu, skor,
  // tanı, ilaç, prosedür, sıvı. Hekim tek bir iş için geliyor ve o işi bulmak için kaydırıyordu.
  // Sekmeler işi ayırır: değerlendirme · tedavi · skor · sonuç.
  const tabs = [
    { key: "clinical", label: S.pr6.tabClinical || S.admissionDx, icon: Activity },
    { key: "treatment", label: S.pr6.tabTreatment || S.pr6.medications, icon: Pill },
    { key: "scores", label: S.pr6.tabScores || S.pr6.severityTitle, icon: ClipboardList },
    { key: "results", label: S.pr19.results, icon: Inbox },
  ];
  const patientResults = (state.results || [])
    .filter((r) => r.patientId === patientId)
    .sort((a, b) => b.atMs - a.atMs);
  const unseenResults = patientResults.filter((r) => r.status !== "reviewed").length;

  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className={`text-xs font-semibold uppercase ${T.faint}`}>{S.pr6.clinicalModule}</div>
        <News2Pill S={S} vitals={p?.vitals} news2={p?.news2} />
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => setThOpen(true)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${T.ghost}`}>
            <Sliders size={13} /> {S.pr6.thresholds}
          </button>
          <button onClick={() => printEpicrisis(S, p, rec, state)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${T.primary}`}>
            <FileText size={13} /> {S.pr6.epicrisis}
          </button>
        </div>
      </div>

      <div className={`mb-3 flex flex-wrap gap-1 rounded-xl border ${T.border} ${T.subtle} p-1`}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition ${tab === key ? T.navActive : T.navIdle}`}>
            <Icon size={14} /> {label}
            {key === "results" && unseenResults > 0 && (
              <span className="grid h-[17px] min-w-[17px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unseenResults}</span>
            )}
          </button>
        ))}
      </div>

      {err && <div className="mb-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}

      {hist.length >= 2 && (
        <div className={`mb-3 grid grid-cols-3 gap-2 rounded-xl border ${T.border} ${T.subtle} p-3`}>
          {[["SpO2", hist.map((h) => h.spo2), "#38bdf8"], ["HR", hist.map((h) => h.hr), "#f472b6"],
            ["MAP", hist.map((h) => h.map), "#a3e635"]].map(([lbl, series, col]) => (
            <div key={lbl}>
              <div className={`mb-0.5 text-[10px] font-semibold uppercase ${T.faint}`}>{lbl}</div>
              <Sparkline points={series} stroke={col} />
              <div className={`text-right text-[10px] tabular-nums ${T.muted}`}>{series[series.length - 1]}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "clinical" && typeof store.setSuspectedInfection === "function" && typeof store.setProfile === "function" && (
        <SepsisPanel T={T} S={S} store={store} patient={p} patientId={patientId} />
      )}

      {tab === "scores" && (
        typeof store.severityForm === "function" ? (
          <Section T={T} icon={ClipboardList} title={S.pr6.severityTitle}>
            <SeverityScorePanel
              T={T} S={S} store={store} patient={p} patientId={patientId}
              onPrint={(payload) => printSeverityForm(S, payload, state)} />
          </Section>
        ) : (
          <Empty T={T} text={S.pr6.severityNoEngine || "Şiddet skoru motordan gelir — bu kurulumda skor ucu yok."} />
        )
      )}

      {tab === "clinical" && (
      <Section T={T} icon={ClipboardList} title={S.pr6.diagnoses}>
        {rec.diagnoses.length === 0 && <Empty T={T} text={S.pr6.noDiagnoses} />}
        {rec.diagnoses.map((d) => (
          <Row key={d.id} T={T}>
            <span className="shrink-0 rounded bg-brand/15 px-1.5 py-0.5 text-xs font-bold text-brand">{d.code}</span>
            <span className={`text-sm ${T.text}`}>{d.text}</span>
            <span className={`ml-auto shrink-0 text-[10px] ${T.faint}`}>{new Date(d.atMs).toLocaleDateString()}</span>
          </Row>
        ))}
        <Icd10Search T={T} S={S} lang={lang} onPick={(r) => wrap(() => store.addDiagnosis({ patientId, code: r.code, text: r[lang] || r.tr }))} />
      </Section>
      )}

      {tab === "treatment" && (<>
      <Section T={T} icon={Pill} title={S.pr6.medications}>
        {rec.medications.length === 0 && <Empty T={T} text={S.pr6.noMedications} />}
        {rec.medications.map((m) => (
          <Row key={m.id} T={T}>
            <Pill size={13} className={T.faint} />
            <span className={`text-sm font-medium ${T.text}`}>{m.name}</span>
            <span className={`text-xs tabular-nums ${T.muted}`}>{m.dose} {m.unit}</span>
            {m.endMs
              ? <span className="ml-auto rounded-full bg-slate-400/15 px-2 py-0.5 text-[10px] font-semibold text-slate-400">{S.pr6.stopped}</span>
              : <>
                  <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">{S.pr6.ongoing}</span>
                  <button onClick={() => wrap(() => store.stopMedication({ patientId, medId: m.id }))} title={S.pr6.stopMed} className="shrink-0 text-red-500"><StopCircle size={15} /></button>
                </>}
          </Row>
        ))}
        <div className="flex flex-wrap gap-1.5">
          <select className={`${inputCls(T)} flex-1`} value={med.name} onChange={(e) => pickMed(e.target.value)}>
            {MED_CATALOG.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
          <input className={`${inputCls(T)} w-20`} placeholder={S.pr6.dose} value={med.dose} onChange={(e) => setMed((s) => ({ ...s, dose: e.target.value }))} />
          <span className={`self-center text-xs ${T.faint}`}>{med.unit}</span>
          <button onClick={() => wrap(() => { store.addMedication({ patientId, name: med.name, dose: med.dose, unit: med.unit }); setMed((s) => ({ ...s, dose: "" })); })} className={`${btnCls(T, "primary")} px-3 py-2`}><Plus size={15} /></button>
        </div>
      </Section>

      <Section T={T} icon={Syringe} title={S.pr6.procedures}>
        {rec.procedures.length === 0 && <Empty T={T} text={S.pr6.noProcedures} />}
        {rec.procedures.map((pr) => (
          <Row key={pr.id} T={T}>
            <Syringe size={13} className={T.faint} />
            <span className={`text-sm ${T.text}`}>{pr.name}</span>
            <span className={`ml-auto shrink-0 text-[10px] tabular-nums ${T.faint}`}>{new Date(pr.atMs).toLocaleString()}</span>
          </Row>
        ))}
        <div className="flex flex-wrap gap-1.5">
          <select className={`${inputCls(T)} flex-1`} value={proc} onChange={(e) => setProc(e.target.value)}>
            {PROCEDURE_CATALOG.map((pc) => <option key={pc} value={pc}>{pc}</option>)}
          </select>
          <button onClick={() => wrap(() => store.addProcedure({ patientId, name: proc }))} className={`${btnCls(T, "primary")} px-3 py-2`}><Plus size={15} /></button>
        </div>
      </Section>

      <Section T={T} icon={Droplet} title={S.pr6.fluidBalance}>
        <div className={`grid grid-cols-3 gap-2 rounded-xl border ${T.border} ${T.subtle} p-2 text-center`}>
          <div><div className={`text-[10px] uppercase ${T.faint}`}>{S.pr6.intake}</div><div className="text-sm font-bold tabular-nums text-sky-500">{intake}</div></div>
          <div><div className={`text-[10px] uppercase ${T.faint}`}>{S.pr6.output}</div><div className="text-sm font-bold tabular-nums text-amber-500">{output}</div></div>
          <div><div className={`text-[10px] uppercase ${T.faint}`}>{S.pr6.balance}</div><div className={`text-sm font-bold tabular-nums ${balance >= 0 ? "text-emerald-500" : "text-red-500"}`}>{balance > 0 ? "+" : ""}{balance}</div></div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <select className={inputCls(T)} value={fluid.kind} onChange={(e) => setFluid((s) => ({ ...s, kind: e.target.value }))}>
            <option value="in">{S.pr6.intake}</option><option value="out">{S.pr6.output}</option>
          </select>
          <input className={`${inputCls(T)} flex-1`} type="number" placeholder={S.pr6.volumeMl} value={fluid.ml} onChange={(e) => setFluid((s) => ({ ...s, ml: e.target.value }))} />
          <button onClick={() => wrap(() => { store.addFluid({ patientId, kind: fluid.kind, label: fluid.label, ml: fluid.ml }); setFluid((s) => ({ ...s, ml: "" })); })} className={`${btnCls(T, "primary")} px-3 py-2`}><Plus size={15} /></button>
        </div>
      </Section>
      </>)}

      {/* Sonuçlar — hastanın kendi laboratuvar, radyoloji ve patoloji sonuçları.
          Aynı veri Sonuçlar modülünde de durur: orada "koğuşta görülmemiş ne var", burada
          "bu hastada ne çıktı". Boş liste **hiçbir zaman** "sonuç yok" demek değildir; besleme
          bağlı değilse bunu açıkça söyler, çünkü ikisi aynı ekranda aynı görünürdü. */}
      {tab === "results" && (
        <div className="space-y-2">
          {!state.hisIntegration?.connected && (
            <div className={`flex items-start gap-2.5 rounded-xl border border-dashed ${T.border} p-3`}>
              <PlugZap size={15} className={`mt-0.5 shrink-0 ${T.faint}`} />
              <div className={`text-xs leading-relaxed ${T.muted}`}>
                {S.pr19.resultsFeedOff || "HBYS sonuç beslemesi bağlı değil — aşağıdaki liste yalnız elle yüklenenleri gösterir."}
              </div>
            </div>
          )}
          {patientResults.length === 0 ? (
            <Empty T={T} text={S.pr19.noResults} />
          ) : patientResults.map((r) => (
            <div key={r.id} className={`rounded-xl border ${r.critical ? "border-red-500/40" : T.border} ${T.subtle} p-3`}>
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  r.type === "lab" ? "bg-sky-500/15 text-sky-500"
                  : r.type === "radiology" ? "bg-violet-500/15 text-violet-500"
                  : `${T.chip}`}`}>
                  {r.type === "lab" ? S.pr19.typeLab : r.type === "radiology" ? S.pr19.typeRadiology : S.pr19.typeEpicrisis}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-semibold ${T.text}`}>{r.title}</span>
                  <span className={`block text-xs ${T.muted}`}>{r.summary}</span>
                </span>
                {r.critical && (
                  <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-500">
                    {S.pr19.criticalValue}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`text-[11px] tabular-nums ${T.faint}`}>{new Date(r.atMs).toLocaleString()}</span>
                <span className={`text-[11px] ${T.faint}`}>· {r.source === "manual" ? S.pr19.sourceManual : S.pr19.sourceHl7}</span>
                {r.status !== "reviewed" ? (
                  <button onClick={() => wrap(() => store.markResultReviewed({ resultId: r.id }))}
                    className={`ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] ${T.ghost}`}>
                    <Check size={12} /> {S.pr19.markReviewed}
                  </button>
                ) : (
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-500">
                    <Check size={12} /> {S.pr19.statusReviewed}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {thOpen && <ThresholdModal T={T} S={S} store={store} state={state} patientId={patientId}
        simulation={simulation} onClose={() => setThOpen(false)} />}
    </div>
  );
}

/**
 * Hastaya göre alarm ayarı.
 *
 * ⚠️ 21.09.2026'da ölçüldü: bu kutu **hiçbir yere bağlı değildi.** `setThresholds` yalnız
 * simülasyon store'unda vardı; canlıda hekimin girdiği eşik tarayıcı belleğinde kalıyor,
 * sayfa yenilenince kayboluyor ve motorun ürettiği alarmları hiç etkilemiyordu. Motor ise
 * tam bu bilgiyi bekliyordu: `PUT /clinical/{id}/profile` · `baselines`.
 *
 * Kutunun anlamı da belirsizdi. İki ayrı şey aynı başlık altında duruyordu:
 *   1. **Cihazın alarm eşiği** — "SpO₂ 90'ın altına inince öt". Bu monitörün işi, bizim değil;
 *      buradan değiştirilemez ve değiştirilmemeli.
 *   2. **Hastanın kendi normali** — kronik AF hastası 105 bpm'de yaşıyorsa, nüfus eşiğine göre
 *      her ölçümde alarm üretmek o hastayı izlemeyi bırakmanın en hızlı yoludur.
 *
 * Bu ekran ikincisidir ve artık onu söylüyor.
 */
function ThresholdModal({ T, S, store, state, patientId, onClose, simulation = false }) {
  const P = S.pr6;
  const rec = state.clinical[patientId];
  const [base, setBase] = useState(() => {
    const b = rec?.baselines || {};
    const val = (k) => ({ low: b[k]?.low ?? "", high: b[k]?.high ?? "" });
    return { heart_rate: val("heart_rate"), resp_rate: val("resp_rate"), spo2: val("spo2"),
             sbp: val("sbp"), temperature: val("temperature") };
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");

  const rows = [
    ["heart_rate", P.hrLabel || "Nabız", "bpm"],
    ["resp_rate", P.rrLabel || "Solunum", "/dk"],
    ["spo2", "SpO₂", "%"],
    ["sbp", P.sbpLabel || "Sistolik TA", "mmHg"],
    ["temperature", P.tempLabel || "Ateş", "°C"],
  ];
  const setCell = (k, side, v) => setBase((s) => ({ ...s, [k]: { ...s[k], [side]: v } }));

  // Ters aralık motorda reddediliyor; burada da yazılmadan önce söylenir — çevirmek, bir yazım
  // hatasını kasıtlı görünen bir aralığın arkasına gizlerdi.
  const inverted = rows.filter(([k]) => {
    const { low, high } = base[k];
    return low !== "" && high !== "" && Number(low) > Number(high);
  }).map(([, label]) => label);

  const save = async () => {
    setErr(""); setOk("");
    if (inverted.length) { setErr(`${P.invertedRange || "Alt sınır üst sınırdan büyük"}: ${inverted.join(", ")}`); return; }
    const baselines = {};
    rows.forEach(([k]) => {
      const { low, high } = base[k];
      if (low === "" && high === "") return;         // girilmeyen parametre gönderilmez
      baselines[k] = {};
      if (low !== "") baselines[k].low = Number(low);
      if (high !== "") baselines[k].high = Number(high);
    });
    try {
      setBusy(true);
      if (typeof store.setProfile === "function") {
        await store.setProfile(patientId, { baselines });
        setOk(P.baselineSaved || "Hastanın bazali motora yazıldı.");
      } else {
        // Motor yoksa bunu söyler. Sessizce "kaydedildi" demek, bu kutunun bugüne kadarki
        // hatasının ta kendisiydi: hekim kaydettiğini sanıyor, hiçbir yere gitmiyordu.
        setErr(P.baselineNoEngine || "Bu kurulumda motor bağlı değil — değer kaydedilmedi.");
        setBusy(false);
        return;
      }
      setTimeout(onClose, 600);
    } catch (ex) {
      setErr(ex.message || String(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell T={T} title={P.baselineTitle || "Hastaya Göre Alarm Ayarı"}
      sub={P.baselineSub || "Hastanın kendi normali — cihaz alarmı değil"} onClose={onClose}>
      <div className={`rounded-lg ${T.subtle} p-3 text-xs leading-relaxed ${T.muted}`}>
        {P.baselineExplain || "Bu değerler cihazın kendi alarmını değiştirmez. Sistemin bu hastayı nüfus eşiğine göre değil, kendi normaline göre değerlendirmesini sağlar. Boş bırakılan parametre için nüfus eşiği geçerli kalır."}
      </div>

      <div className="space-y-2">
        <div className={`grid grid-cols-[1fr_5rem_5rem] gap-2 px-1 text-[10px] font-semibold uppercase ${T.faint}`}>
          <span>{P.parameter || "Parametre"}</span><span>{P.lowLabel || "Alt"}</span><span>{P.highLabel || "Üst"}</span>
        </div>
        {rows.map(([k, label, unit]) => (
          <div key={k} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2">
            <span className={`text-sm ${T.text}`}>{label} <span className={`text-xs ${T.faint}`}>{unit}</span></span>
            <input type="number" className={`${inputCls(T)} px-2 py-1.5`} value={base[k].low}
              onChange={(e) => setCell(k, "low", e.target.value)} placeholder="—" />
            <input type="number" className={`${inputCls(T)} px-2 py-1.5`} value={base[k].high}
              onChange={(e) => setCell(k, "high", e.target.value)} placeholder="—" />
          </div>
        ))}
      </div>

      {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      {ok && <div className="rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-500">{ok}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className={btnCls(T, "ghost")}>{S.cancel}</button>
        <button onClick={save} disabled={busy} className={btnCls(T, "primary")}>
          <Check size={16} /> {busy ? (P.saving || "Kaydediliyor…") : (P.saveBaseline || "Bazali Kaydet")}
        </button>
      </div>
    </ModalShell>
  );
}

// One-click epicrisis / handover report → printable window (browser print → PDF). ICD-10 codes and
// active-ingredient names are printed verbatim; the report never contains a machine diagnosis.
/**
 * The printable severity form — the document the hospital's own screen produces at the end.
 *
 * Two things it prints that the paper version cannot, and both are the point of the module:
 * the TIMESTAMP behind every value, so the physician signing it can find the measurement in the
 * chart; and an explicit mark on any cell a clinician corrected, with what the record originally
 * held. A printout that hid corrections would make a reviewed form and an unreviewed one look
 * identical, which is the opposite of what a signature is for.
 *
 * An unsigned form prints with the signature line EMPTY rather than omitted. A severity score on
 * paper with no space for a name invites someone to treat it as already authorised.
 */
function printSeverityForm(S, { form, signed, patient, hours, score }, state) {
  if (!form) return;
  const P = S.pr6;
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const nm = state?.maskNames ? maskName(patient?.display_name) : (patient?.display_name || "");
  const when = (iso) => (iso ? new Date(iso).toLocaleString("tr-TR") : "—");
  const organName = (k) => (P.sevOrgans && P.sevOrgans[k]) || k;

  const rows = (form.rows || []).map((r) => {
    const cells = (r.inputs || []).map((c) => {
      const flags = [
        c.overridden ? `${esc(P.sevCorrected)} (${esc(c.original)})` : "",
        c.outside_window ? esc(P.sevOutside) : "",
        !c.measured ? esc(P.sevNotMeasured) : "",
      ].filter(Boolean).join(", ");
      return `<div class="cell"><b>${esc(c.code)}</b> ${esc(c.value ?? "—")}
        <span class="t">${esc(when(c.at))}${c.source ? " · " + esc(c.source) : ""}</span>
        ${flags ? `<span class="f">${flags}</span>` : ""}</div>`;
    }).join("");
    return `<tr><td>${esc(organName(r.organ))}</td><td class="n">${esc(r.points)}</td>
      <td>${cells || "—"}</td></tr>`;
  }).join("");

  const corrections = (signed?.overrides || []).map((o) =>
    `<tr><td>${esc(o.code)}</td><td class="n">${esc(o.original ?? "—")} → ${esc(o.value)}</td>
     <td>${esc(o.reason)}</td></tr>`).join("");

  const w = window.open("", "_blank", "width=820,height=920");
  if (!w) return;
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>${esc(score)} — ${esc(P.severityTitle)}</title>
<style>*{box-sizing:border-box}body{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;padding:34px;max-width:770px;margin:auto}
h1{font-size:20px;margin:0 0 2px}.sub{font-size:12px;color:#64748b;margin-bottom:12px}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:12px}
th,td{border:1px solid #cbd5e1;padding:5px 7px;text-align:left;vertical-align:top}
th{background:#f1f5f9}.n{text-align:right;font-variant-numeric:tabular-nums;width:56px}
.cell{margin-bottom:2px}.t{color:#64748b}.f{color:#b45309;margin-left:4px}
.tot{font-size:16px;font-weight:700;margin:8px 0}
.note{font-size:11px;color:#64748b;margin-top:10px;line-height:1.5}
.sig{margin-top:26px;border-top:1px solid #cbd5e1;padding-top:10px;font-size:12px}
.sig .line{display:inline-block;min-width:240px;border-bottom:1px solid #94a3b8;height:20px}</style></head><body>
<h1>${esc(score)} — ${esc(P.severityTitle)}</h1>
<div class="sub">${esc(nm)} ${patient?.patient_id ? "· " + esc(patient.patient_id) : ""}
 · ${esc(P.sevWindow)}: ${esc(hours)} ${esc(String(form.window_hours ? "" : ""))}h
 · ${esc(when(form.window_from))} – ${esc(when(form.window_to))}</div>
<div class="tot">${esc(P.sevTotal)}: ${esc(form.total)}${
  form.auto_total != null && form.auto_total !== form.total
    ? ` <span class="t">(${esc(P.sevAuto)}: ${esc(form.auto_total)})</span>` : ""}</div>
${form.covers_full_window === false ? `<div class="f">${esc(P.sevPartialWindow)}</div>` : ""}
<table><thead><tr><th>${esc(P.sevOrgan)}</th><th class="n">${esc(P.sevPoints)}</th>
<th>${esc(P.sevValue)} · ${esc(P.sevWhen)}</th></tr></thead><tbody>${rows}</tbody></table>
${corrections ? `<h3 style="font-size:13px;margin:14px 0 4px">${esc(P.sevCorrected)}</h3>
<table><thead><tr><th>${esc(P.sevOrgan)}</th><th>${esc(P.sevValue)}</th>
<th>${esc(P.sevReason)}</th></tr></thead><tbody>${corrections}</tbody></table>` : ""}
<div class="note">${esc(P.severitySub).replace("{h}", esc(hours))}<br>${esc(P.sevNotMeasuredHint)}<br>
${esc(P.sevSource)}: ${esc(form.source || "")}</div>
<div class="sig">${esc(P.sevSign)}: ${
  signed ? `<b>${esc(signed.signed_by)}</b> · ${esc(when(signed.signed_at))}`
         : `<span class="line"></span>`}</div>
</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

function printEpicrisis(S, patient, rec, state) {
  if (!patient) return;
  const P = S.pr6;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const nm = state.maskNames ? maskName(patient.display_name) : patient.display_name;
  const dxRows = rec.diagnoses.map((d) => `<tr><td>${esc(d.code)}</td><td>${esc(d.text)}</td><td>${esc(new Date(d.atMs).toLocaleString())}</td></tr>`).join("") || `<tr><td colspan="3">—</td></tr>`;
  const medRows = rec.medications.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.dose)} ${esc(m.unit)}</td><td>${m.endMs ? esc(P.stopped) : esc(P.ongoing)}</td></tr>`).join("") || `<tr><td colspan="3">—</td></tr>`;
  const prRows = rec.procedures.map((pr) => `<tr><td>${esc(pr.name)}</td><td>${esc(new Date(pr.atMs).toLocaleString())}</td></tr>`).join("") || `<tr><td colspan="2">—</td></tr>`;
  const intake = rec.fluids.filter((f) => f.kind === "in").reduce((a, f) => a + f.ml, 0);
  const output = rec.fluids.filter((f) => f.kind === "out").reduce((a, f) => a + f.ml, 0);
  const hist = rec.vitalHistory || [];
  const news2vals = hist.map((h) => computeNews2(h));
  const nMin = news2vals.length ? Math.min(...news2vals) : "—";
  const nMax = news2vals.length ? Math.max(...news2vals) : "—";
  const nNow = patient.vitals ? computeNews2(patient.vitals) : "—";
  const preparedBy = state.maskNames ? maskName(state.user?.full_name || "") : (state.user?.full_name || "");
  const w = window.open("", "_blank", "width=820,height=920");
  if (!w) return;
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(P.reportTitle)}</title>
<style>*{box-sizing:border-box}body{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;padding:34px;max-width:770px;margin:auto}
h1{font-size:21px;margin:0 0 4px}.sub{font-size:12px;color:#64748b;margin-bottom:8px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#475569;margin:22px 0 6px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{border:1px solid #e2e8f0;padding:6px 9px;text-align:left}th{background:#f8fafc}
.grid{display:flex;flex-wrap:wrap;gap:22px;font-size:13px}.badge{display:inline-block;background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:2px 9px;font-weight:700}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:14px}.dot{width:34px;height:34px;border-radius:9px;background:#2563eb;color:#fff;display:grid;place-items:center;font-weight:800}
.foot{margin-top:30px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:8px}@media print{body{padding:12px}}</style></head><body>
<div class="brand"><div class="dot">H</div><div><div style="font-weight:800">${esc(S.appName)}</div><div class="sub" style="margin:0">${esc(S.tagline)}</div></div></div>
<h1>${esc(P.reportTitle)}</h1>
<div class="sub">${esc(nm)} · ${esc(patient.bedLabel || "")} · ${esc(S.protocolNo)} ${esc(patient.protocolNo || "")} · ${esc(S.mrn)} ${esc(patient.mrn || "")} · ${esc(S.tcno)} ${esc(patient.tcMasked || "")}</div>
<h2>${esc(P.admissionDiagnosis)}</h2>
<table><tr><th>ICD-10</th><th>${esc(S.admissionDx)}</th><th>${esc(P.auditTime)}</th></tr>${dxRows}</table>
<h2>${esc(P.vitalTrendSummary)}</h2>
<div class="grid"><div>${esc(P.last24h)}: <span class="badge">min ${nMin} / max ${nMax}</span></div><div>${esc(S.lastUpdate)}: <span class="badge">${nNow}</span></div></div>
<h2>${esc(P.medsGiven)}</h2>
<table><tr><th>${esc(P.drug)}</th><th>${esc(P.dose)}</th><th></th></tr>${medRows}</table>
<h2>${esc(P.proceduresDone)}</h2>
<table><tr><th>${esc(P.procedureType)}</th><th>${esc(P.auditTime)}</th></tr>${prRows}</table>
<h2>${esc(P.fluidBalanceR)}</h2>
<div class="grid"><div>${esc(P.intake)}: <b>${intake} mL</b></div><div>${esc(P.output)}: <b>${output} mL</b></div><div>${esc(P.balance)}: <b>${intake - output} mL</b></div></div>
<div class="foot">${esc(P.generatedBy)}: ${esc(preparedBy)} · ${esc(P.generatedAt)}: ${esc(new Date().toLocaleString())}</div>
</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) { /* ignore */ } }, 400);
}




// KVKK / cookie & disclosure banner (dismiss persisted to localStorage).
function KvkkBanner({ T, S }) {
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem("homunculus-kvkk") === "1"; } catch { return false; } });
  if (dismissed) return null;
  const accept = () => { try { localStorage.setItem("homunculus-kvkk", "1"); } catch { /* ignore */ } setDismissed(true); };
  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] p-3 sm:p-4">
      <div className={`mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border ${T.border} ${T.glass} p-4 sm:flex-row sm:items-center`}>
        <ShieldAlert size={22} className="shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-bold ${T.heading}`}>{S.pr6.cookieTitle}</div>
          <div className={`mt-0.5 text-xs ${T.muted}`}>{S.pr6.cookieText}</div>
        </div>
        <button onClick={accept} className={`${btnCls(T, "primary")} shrink-0`}>{S.pr6.cookieAccept}</button>
      </div>
    </div>
  );
}

// ================================================================ ROOT
// `store` is injectable so the same UI can run against the in-browser simulation (default) or a
// live store backed by the real API (see liveStore.js).
/**
 * `simulation` — true only in the fabricated-data modes (`?demo=1`, replay).
 *
 * The simulation controls (fire an alarm by hand, run the clock at 30×/60×/120× or pause it,
 * fabricate an inbound result) are demonstration tooling. On a live ward they are worse than
 * useless: what they produce is written to the audit log and is then indistinguishable from a
 * real alarm or a real lab result, which corrupts both the statutory record and the quality
 * figures drawn from it. "Pause" is the worst of them — on a monitoring screen it reads as
 * "monitoring has stopped".
 *
 * Default false: a mode that forgets to declare itself gets the safe behaviour.
 */
export function ClinicalDemo({ store: injectedStore = null, simulation = false }) {
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = injectedStore || createDemoStore(buildRealisticState());
  const store = storeRef.current;
  const state = useStore(store);

  const [theme, setThemeState] = useState(storedTheme);
  const [lang, setLangState] = useState(storedClang);
  const [page, setPage] = useState("board");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [drawerPatient, setDrawerPatient] = useState(null);
  const [cockpitPatient, setCockpitPatient] = useState(null); // Madde 8 — tam ekran kokpit
  // Duvar ekranı: banko/koridor ekranı için kabuğu tamamen kaldıran mod (bkz. wallBoard.jsx).
  const [wallMode, setWallMode] = useState(false);
  const [transferPatient, setTransferPatient] = useState(null);
  const [soundOn, setSoundOn] = useState(false);
  const [notifyPerm, setNotifyPerm] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const notifiedRef = useRef(new Set());

  const setTheme = (k) => { setThemeState(k); persistTheme(k); };
  const setLang = (l) => { setLangState(l); persistClang(l); };

  const onEnableSound = () => {
    if (soundOn) { setSoundOn(false); syncAlarm(null); return; }
    if (enableAudio()) setSoundOn(true);
  };
  const [notifyBannerDismissed, setNotifyBannerDismissed] = useState(false);
  // Chrome disables the Notification API entirely on a plain-HTTP origin: the permission prompt
  // never opens, so the enable button looks dead. Detect the insecure context and SAY it — a
  // silently dead button already cost one ward visit's worth of confusion.
  const notifyBlocked =
    typeof window !== "undefined" && window.isSecureContext === false;
  const onEnableNotify = async () => {
    if (typeof Notification === "undefined" || notifyBlocked) return;
    if (Notification.permission === "granted") { setNotifyPerm("granted"); return; }
    try { const p = await Notification.requestPermission(); setNotifyPerm(p); } catch { /* ignore */ }
  };

  // Bildirim sistemini test et — kısa titreşim + sesli bir örnek Web Push gönderir.
  const onTestPush = () => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      new Notification(S.pr8.testPushTitle, {
        body: S.pr8.testPushBody,
        tag: "notify-test",
        vibrate: [200, 100, 200],
      });
    } catch { /* ignore */ }
    try { if (navigator?.vibrate) navigator.vibrate([200, 100, 200]); } catch { /* ignore */ }
    try { store.recordTestPush(`Test bildirimi · ${state.user?.full_name || "—"}`); } catch { /* ignore */ }
  };

  const T = useMemo(() => getTheme(theme), [theme]);
  const S = useMemo(() => cstrings(lang), [lang]);

  // active (open, un-muted) alarms sorted by tier severity → drives audio + push.
  const TIER_RANK = { CRITICAL: 3, HIGH: 2, MEDIUM: 1 };
  const openAlerts = (state.alerts || []).filter(
    (a) => a.status === "FIRED" && !(a.mutedUntil && a.mutedUntil > state.clockSec)
  );
  const topTier = openAlerts.reduce(
    (acc, a) => (TIER_RANK[a.tier] > TIER_RANK[acc] ? a.tier : acc),
    null
  );

  // audio: mirror the highest active alarm tier into the WebAudio engine.
  useEffect(() => {
    if (soundOn && isAudioEnabled()) syncAlarm(topTier || null);
    else syncAlarm(null);
  }, [soundOn, topTier]);

  // web push: notify for new CRITICAL alarms while the tab is hidden.
  useEffect(() => {
    if (notifyPerm !== "granted" || typeof Notification === "undefined") return;
    if (!document.hidden) return;
    for (const a of openAlerts) {
      if (a.tier !== "CRITICAL") continue;
      if (notifiedRef.current.has(a.id)) continue;
      notifiedRef.current.add(a.id);
      try {
        new Notification(S.pr7.notifyTitle, {
          body: `${a.bedLabel || ""} · ${S.pr7.notifyBody}`,
          tag: a.id,
          vibrate: [300, 120, 300, 120, 300],
          requireInteraction: true,
        });
        if (navigator?.vibrate) navigator.vibrate([300, 120, 300, 120, 300]);
      } catch { /* ignore */ }
    }
  });

  // The ONE live-wiring line in this file: once a clinician is signed in, ask the store to start
  // fetching/streaming real patients. Everything about HOW that happens — the /patients fetch, the
  // SSE handlers, synthesizing beds/alerts from live patients — lives in liveStore.js; this effect
  // only decides WHEN to call it. The ref (not just the state.user dependency) stops a
  // login→logout→login cycle from opening a second stream on top of one still starting.
  const liveStartedRef = useRef(false);
  useEffect(() => {
    if (!state.user || typeof store.startLive !== "function" || liveStartedRef.current) return;
    liveStartedRef.current = true;
    let cancelled = false;
    let close = null;
    store.startLive().then((fn) => {
      close = typeof fn === "function" ? fn : null;
      if (cancelled) close?.();
    });
    return () => {
      cancelled = true;
      liveStartedRef.current = false;
      close?.();
    };
  }, [state.user, store]);

  // Eskalasyon saati.
  //
  // ⚠️ 21.09.2026 — canlıda bu saat 60× hızla koşuyordu. `speed: 60` simülasyonun varsayılanı
  // (1 gerçek saniye = 1 simüle dakika, böylece 3 dakikalık kademe demoda 3 saniyede geliyor) ve
  // canlı store onu değiştirmiyordu. Sonucu: bir dakikadır cevapsız olan alarm ekranda bir saat
  // görünüyor, eskalasyon kademeleri saniyeler içinde tükeniyordu — yani koğuşun **cevap süresi**
  // ölçüsü altmış kat yanlıştı. Canlıda saat gerçek zamanla ilerler; hızlandırma yalnız
  // simülasyonun oyuncağıdır.
  useEffect(() => {
    const id = setInterval(() => {
      const st = store.getState();
      if (!st.running) return;
      const step = simulation ? st.speed * 0.25 : 0.25;
      store.reconcile(st.clockSec + step);
    }, 250);
    return () => clearInterval(id);
  }, [store, simulation]);

  // apply dark class for any global dark-mode CSS hooks.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") root.classList.remove("dark"); else root.classList.add("dark");
  }, [theme]);

  // MFA kapısı: şifre doğru ama rol iki adımlı doğrulama gerektiriyor (Madde 6).
  if (state.mfaPending) return <MfaGate T={T} S={S} store={store} pending={state.mfaPending} lang={lang} setLang={setLang} />;
  if (!state.user) return <Login T={T} S={S} store={store} lang={lang} setLang={setLang} />;

  // Kurum kurulum sihirbazı: platform ilk kez kuruluyorsa yönetici girişinde gösterilir (Madde 5).
  // The setup wizard belongs to the simulation, where creating a tenant is the only way one
  // comes into existence.
  //
  // A real deployment already has its tenant before anyone logs in: seed_admin.py creates it at
  // first boot from SEED_TENANT_SLUG, and docker-compose.yml goes to some length to keep that
  // slug identical to the one in TENANTS — because if the two ever name different hospitals,
  // login succeeds and the board stays silently empty. Showing the wizard there asks the
  // administrator to create something that exists, writes their answer to browser memory only,
  // and reappears on the next machine. If they type a different name they then believe the
  // system is configured as they wrote it, which is that same silent divergence arriving by a
  // different door.
  if (simulation && state.user.role === ROLE.HOSPITAL_ADMIN && !state.tenantSetup) {
    return <SetupWizard T={T} S={S} store={store} lang={lang} setLang={setLang} />;
  }

  // guard: page not permitted for the current role → fall back to board.
  const role = state.user.role;
  const activeItem = NAV_ITEMS.find((i) => i.key === page);
  const effectivePage = activeItem && canSee(activeItem, role) ? page : "board";

  const openTransfer = (pid) => { setTransferPatient(pid); setPage("admission"); };

  // Duvar ekranı modu kabuğun tamamının yerine geçer: menü, üst bar ve banner'lar çizilmez.
  // Tam ekran isteği burada değil, onu açan düğmede yapılır — tarayıcı bunu kullanıcı
  // hareketine bağlı ister ve bir render sırasında verilen istek sessizce reddedilir.
  if (wallMode) {
    return (
      <SimulationContext.Provider value={simulation}>
        <WallBoard S={S} state={state} cycleSeconds={0} simulation={simulation}
          scope={scopeForUser(state, UNRESTRICTED_SCOPE_ROLES)}
          onExit={() => { setWallMode(false); if (document.fullscreenElement) document.exitFullscreen?.(); }} />
      </SimulationContext.Provider>
    );
  }

  return (
    <SimulationContext.Provider value={simulation}>
    <div className={`flex min-h-screen ${T.app} ${T.decor || ""}`}>
      <Sidebar T={T} S={S} state={state} page={effectivePage} setPage={setPage}
        collapsed={collapsed} setCollapsed={setCollapsed} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar T={T} S={S} store={store} state={state} page={effectivePage} lang={lang} setLang={setLang}
          theme={theme} setTheme={setTheme} onMenu={() => setMobileOpen(true)} setPage={setPage}
          onWallMode={() => setWallMode(true)}
          soundOn={soundOn} onEnableSound={onEnableSound} notifyPerm={notifyPerm} onEnableNotify={onEnableNotify}
          onTestPush={onTestPush} notifyBlocked={notifyBlocked} />
        {notifyPerm !== "granted" && !notifyBannerDismissed && (
          <div className="flex items-center gap-3 border-b border-brand/30 bg-gradient-to-r from-brand/15 to-cyan-500/10 px-4 py-2.5 text-sm">
            <BellRing className="h-5 w-5 shrink-0 animate-pulse text-brand" />
            <div className="min-w-0 flex-1">
              <div className={`font-semibold ${T.heading}`}>{S.pr8.notifyBannerTitle}</div>
              <div className={`truncate text-xs ${T.faint}`}>
                {notifyBlocked ? S.pr8.notifyNeedsHttps : S.pr8.notifyBannerBody}
              </div>
            </div>
            {/* HTTPS engeli bir kullanıcı hatası değil, yanlış adres: aynı sunucu 8443'te
                TLS ile de duruyor. Banner'ın "HTTPS gerekir" demesi tek başına kimseyi
                oraya götürmüyordu — 20.09.2026'da pilotta bildirimlerin hiç çalışmadığı,
                kimsenin de bunu fark etmediği böyle görüldü. */}
            {notifyBlocked ? (
              <a href={`https://${window.location.hostname}:8443${window.location.pathname}${window.location.search}`}
                className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow hover:opacity-90">
                {S.pr8.notifyGoHttps || "Güvenli adrese geç"}
              </a>
            ) : (
              <button onClick={onEnableNotify}
                className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow hover:opacity-90">
                {S.pr8.notifyBannerEnable}
              </button>
            )}
            <button onClick={() => setNotifyBannerDismissed(true)}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium ${T.ghost}`}>
              {S.pr8.notifyBannerLater}
            </button>
          </div>
        )}
        {state.online === false && (
          <div className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-600 dark:text-amber-400">
            <CloudOff className="h-4 w-4 shrink-0" />
            <span>{S.pr7.offlineBanner}</span>
            {state.syncQueue?.length > 0 && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs">
                {state.syncQueue.length} {S.pr7.queued}
              </span>
            )}
          </div>
        )}
        {/* pb-20: mobil alt bar içeriğin son satırını kapatmasın */}
        <main className="flex-1 overflow-x-hidden p-4 pb-20 lg:p-6 lg:pb-6">
          {effectivePage === "board" && <BedBoard T={T} S={S} state={state} onOpenPatient={setDrawerPatient} lang={lang} />}
          {effectivePage === "admission" && <AdmissionPage T={T} S={S} store={store} state={state} lang={lang}
            preselectTransfer={transferPatient} clearPreselect={() => setTransferPatient(null)} />}
          {effectivePage === "alarms" && <AlarmPage T={T} S={S} store={store} state={state} lang={lang} simulation={simulation} />}
          {effectivePage === "results" && <ResultsInbox T={T} S={S} store={store} state={state} simulation={simulation} />}
          {effectivePage === "tech" && <TechPage T={T} S={S} store={store} state={state} />}
          {effectivePage === "pharmacy" && <PharmacyPage T={T} S={S} state={state} />}
          {effectivePage === "admin" && <AdminPage T={T} S={S} store={store} state={state} />}
        </main>
      </div>
      <MobileTabBar T={T} S={S} state={state} page={effectivePage} setPage={setPage} setMobileOpen={setMobileOpen} />
      {drawerPatient && (
        <PatientDrawer T={T} S={S} state={state} store={store} patientId={drawerPatient} lang={lang} simulation={simulation}
          onClose={() => setDrawerPatient(null)} onTransfer={openTransfer}
          onExpand={(pid) => { setDrawerPatient(null); setCockpitPatient(pid); }} />
      )}
      {cockpitPatient && (
        <PatientCockpit T={T} S={S} state={state} store={store} patientId={cockpitPatient} lang={lang} simulation={simulation}
          onClose={() => setCockpitPatient(null)} />
      )}
      <KvkkBanner T={T} S={S} />
    </div>
    </SimulationContext.Provider>
  );
}

export default ClinicalDemo;

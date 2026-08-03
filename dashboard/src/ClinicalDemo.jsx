// src/ClinicalDemo.jsx — Homunculus clinical workspace (HBYS-grade shell).
// A production-fidelity operator UI over the in-browser clinical engine (clinicalDemo.js).
// Three runtime themes (clinicalTheme.js), four UI languages (clinicalI18n.js). All data is
// SYNTHETIC and every national ID is masked. The system never diagnoses — machine-generated
// alert text always reads "…kriterleri değerlendirilecek".

import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Activity, LayoutGrid, UserPlus, Users, Bell, Settings, ArrowLeftRight, Stethoscope,
  HeartPulse, Building2, ShieldAlert, Sun, Moon, Monitor, Globe, ChevronDown, LogOut, Check,
  BellOff, ArrowUpCircle, Play, Pause, Clock, AlertTriangle, Plus, PenLine, Thermometer, Wind,
  Droplets, Gauge, Heart, UserCog, ClipboardList, Siren, PanelLeftClose, PanelLeft, CheckCircle2,
  Circle, X, FileText, Pill, Droplet, Sliders, Eye, EyeOff, ScrollText, Volume2, VolumeX,
  TrendingUp, StopCircle, Syringe,
  KeyRound, Wifi, WifiOff, Radio, Network, CloudOff, Cloud, Search, ShieldCheck, DoorOpen,
  BellRing, BarChart3, Wrench, Pencil, Bed, Download, Power, Lock, Shield,
  Contrast, Fingerprint, Mail, ArrowRight, QrCode, Send, RotateCcw, XCircle,
  MapPin, ArrowLeft, Archive,
  Sunset, FlaskConical, ScanLine, Grid3x3, RefreshCw, PlugZap, Upload, Inbox, HeartHandshake,
} from "lucide-react";
import {
  createDemoStore, buildRealisticState, ROLE, TIER, ESCALATION_STEP, STEP_TARGET_ROLE,
  secondsToNextStep, canSnooze, snoozeCapMinutes, ACK_REASON_MIN_CHARS,
  searchIcd10, MED_CATALOG, PROCEDURE_CATALOG, computeNews2, maskName, evaluateThresholds,
  NEWS2_ALARM_THRESHOLD, DEFAULT_THRESHOLDS,
  computeAnalytics, BED_STATES, BED_ADMIN_STATES, BED_STATE_LABEL,
  CLINICAL_PROFILES, profileForPatient, profileForUnitType,
} from "./clinicalDemo.js";
import {
  getTheme, storedTheme, persistTheme, THEME_KEYS,
} from "./clinicalTheme.js";
import { cstrings, storedClang, persistClang, LANGS } from "./clinicalI18n.js";
import { enableAudio, isAudioEnabled, syncAlarm } from "./clinicalAudio.js";

// ---------------------------------------------------------------- shared visual maps
// Fixed, theme-independent accent colours (present verbatim in source so Tailwind JIT keeps them).
const RISK_UI = {
  stable:   { dot: "bg-emerald-500", text: "text-emerald-500", ring: "ring-emerald-500/40", bar: "bg-emerald-500" },
  low:      { dot: "bg-sky-500",     text: "text-sky-500",     ring: "ring-sky-500/40",     bar: "bg-sky-500" },
  high:     { dot: "bg-amber-500",   text: "text-amber-500",   ring: "ring-amber-500/40",   bar: "bg-amber-500" },
  critical: { dot: "bg-red-500",     text: "text-red-500",     ring: "ring-red-500/60",     bar: "bg-red-500" },
};
const riskUi = (r) => RISK_UI[r] || RISK_UI.stable;

const TIER_UI = {
  CRITICAL: { text: "text-red-500",    dot: "bg-red-500",    chip: "bg-red-500/15 text-red-500" },
  HIGH:     { text: "text-amber-500",  dot: "bg-amber-500",  chip: "bg-amber-500/15 text-amber-500" },
  MEDIUM:   { text: "text-yellow-500", dot: "bg-yellow-500", chip: "bg-yellow-500/15 text-yellow-500" },
  LOW:      { text: "text-sky-500",    dot: "bg-sky-500",    chip: "bg-sky-500/15 text-sky-500" },
  INFO:     { text: "text-slate-400",  dot: "bg-slate-400",  chip: "bg-slate-400/15 text-slate-400" },
};
const tierUi = (t) => TIER_UI[t] || TIER_UI.INFO;

// Neutral machine-generated alert text (never a diagnosis).
const ALERT_TXT = {
  tr: "Klinik kötüleşme kriterleri değerlendirilecek",
  az: "Klinik pisləşmə kriterləri dəyərləndiriləcək",
  en: "Clinical deterioration criteria to be assessed",
  ru: "Критерии клинического ухудшения будут оценены",
};

const THEME_ICON = { icu: Moon, light: Sun, contrast: Contrast, wall: Monitor };

// ---------------------------------------------------------------- small helpers
function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
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
function useStore(store) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => store.subscribe(force), [store]);
  return store.getState();
}

// ---------------------------------------------------------------- generic dropdown menu
function Menu({ T, triggerClass, trigger, align = "right", children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={triggerClass}>
        {trigger}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute z-50 mt-2 min-w-[15rem] rounded-xl border ${T.border} ${T.card} p-1.5 shadow-2xl ${align === "right" ? "right-0" : "left-0"}`}>
            {children({ close: () => setOpen(false) })}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- form primitives
function Field({ T, label, hint, children }) {
  return (
    <label className="block">
      <div className={`mb-1 font-medium ${T.sizes.label} ${T.muted}`}>{label}</div>
      {children}
      {hint && <div className={`mt-1 text-xs ${T.faint}`}>{hint}</div>}
    </label>
  );
}
const inputCls = (T) => `w-full rounded-lg border px-3 py-2.5 outline-none transition focus:ring-2 focus:ring-brand/40 ${T.input} ${T.sizes.nav}`;
function btnCls(T, kind = "primary") {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed";
  const map = { primary: T.primary, ghost: T.ghost, danger: T.danger, warn: T.warn };
  return `${base} ${map[kind] || T.primary} ${T.sizes.nav}`;
}

// ================================================================ LOGIN
// ---------------------------------------------------------------- Brand mark (bespoke SVG logo)
// Yeni nesil marka işareti: yumuşak köşeli teal→cyan rozet içinde beyaz EKG/nabız çizgisi.
// Tek bir "H" hissi veren dikey vuruşlar + kalp atışı. Kütüphane değil, saf SVG.
function HomunculusMark({ size = 44, glow = true }) {
  const id = useMemo(() => "hm" + Math.random().toString(36).slice(2, 7), []);
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none"
      className={glow ? "drop-shadow-[0_6px_16px_rgba(13,148,136,0.45)]" : ""} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0d9488" />
          <stop offset="0.55" stopColor="#0891b2" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="45" height="45" rx="13" fill={`url(#${id})`} />
      <rect x="1.5" y="1.5" width="45" height="45" rx="13" fill="white" fillOpacity="0.04" />
      {/* H omuzları: iki dikey vuruş */}
      <rect x="11" y="13" width="3.2" height="22" rx="1.6" fill="white" fillOpacity="0.9" />
      <rect x="33.8" y="13" width="3.2" height="22" rx="1.6" fill="white" fillOpacity="0.9" />
      {/* Kalp atışı / EKG köprüsü */}
      <path d="M11 24 H17 L19.5 17 L23 31 L26 21 L28.5 24 H37"
        stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Gerçek SVG bayraklar — emoji bayrakları Windows'ta "TR/AZ/GB/RU" harf çifti olarak
// gösterildiği için (regional-indicator desteklenmez) her platformda görünen vektör bayraklar.
const FLAG_SVG = {
  tr: (
    <svg viewBox="0 0 30 20" className="h-full w-full">
      <rect width="30" height="20" fill="#E30A17" />
      <circle cx="12" cy="10" r="5" fill="#fff" />
      <circle cx="13.5" cy="10" r="4" fill="#E30A17" />
      <path fill="#fff" d="M18 10l4.7-1.5-2.9 4v-5l2.9 4z" />
    </svg>
  ),
  az: (
    <svg viewBox="0 0 30 20" className="h-full w-full">
      <rect width="30" height="6.67" fill="#00B5E2" />
      <rect y="6.67" width="30" height="6.67" fill="#EF3340" />
      <rect y="13.33" width="30" height="6.67" fill="#509E2F" />
      <circle cx="15" cy="10" r="2.6" fill="#fff" />
      <circle cx="15.8" cy="10" r="2.1" fill="#EF3340" />
      <path fill="#fff" d="M18.4 10l2.4-.8-1.5 2v-2.5l1.5 2z" />
    </svg>
  ),
  en: (
    <svg viewBox="0 0 30 20" className="h-full w-full">
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0l30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0l30 20M30 0L0 20" stroke="#C8102E" strokeWidth="2" />
      <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0v20M0 10h30" stroke="#C8102E" strokeWidth="3.5" />
    </svg>
  ),
  ru: (
    <svg viewBox="0 0 30 20" className="h-full w-full">
      <rect width="30" height="6.67" fill="#fff" />
      <rect y="6.67" width="30" height="6.67" fill="#0039A6" />
      <rect y="13.33" width="30" height="6.67" fill="#D52B1E" />
    </svg>
  ),
};
function Flag({ code, className = "" }) {
  return (
    <span className={`inline-block overflow-hidden rounded-[3px] ring-1 ring-black/10 ${className}`}>
      {FLAG_SVG[code] || null}
    </span>
  );
}

// Kompakt bayrak dil seçici — giriş ekranı ve gerektiğinde her yerde kullanılabilir.
function LangPills({ T, lang, setLang }) {
  return (
    <div className={`inline-flex items-center gap-0.5 rounded-xl border ${T.border} ${T.glassSubtle} p-0.5`}>
      {LANGS.map(([code, label]) => (
        <button key={code} type="button" onClick={() => setLang(code)} title={label} aria-label={label}
          className={`flex h-8 items-center gap-1.5 rounded-lg px-2 transition ${lang === code ? "bg-brand/25 ring-1 ring-brand/50" : "opacity-55 hover:opacity-100"}`}>
          <Flag code={code} className="h-3.5 w-5" />
          <span className="text-[11px] font-bold uppercase">{code}</span>
        </button>
      ))}
    </div>
  );
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

        {/* Canlı vitrin istatistikleri */}
        <div className="relative z-10">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            {S.pr9.vitrinTitle}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <VitrinStat value="12.480" label={S.pr9.statAlarms} />
            <VitrinStat value="8 sn" label={S.pr9.statAck} />
            <VitrinStat value="%99,9" label={S.pr9.statUptime} />
          </div>
          <div className="mt-6 flex items-center gap-2 text-[11px] font-medium text-white/50">
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

// Canlı vitrin sayaç kutusu (giriş marka panelinde).
function VitrinStat({ value, label }) {
  return (
    <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10 backdrop-blur">
      <div className="text-lg font-black text-white">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium leading-tight text-white/55">{label}</div>
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
function TopBar({ T, S, store, state, page, lang, setLang, theme, setTheme, onMenu,
                 soundOn, onEnableSound, notifyPerm, onEnableNotify, onTestPush }) {
  const user = state.user;
  const [pinOpen, setPinOpen] = useState(false);
  const RoleIcon = user?.role === ROLE.HOSPITAL_ADMIN ? ShieldAlert
    : user?.role === ROLE.CHARGE_NURSE ? HeartPulse : Stethoscope;
  const online = state.online !== false;
  return (
    <header className={`sticky top-0 z-30 flex items-center gap-3 border-b ${T.border} ${T.topbar} px-4 py-3 backdrop-blur`}>
      <button onClick={onMenu} className={`grid h-9 w-9 place-items-center rounded-lg ${T.ghost} lg:hidden`}>
        <PanelLeft size={18} />
      </button>
      <div className="min-w-0">
        <div className={`truncate font-bold ${T.heading} ${T.sizes.name}`}>{S.nav[page]}</div>
        <div className={`truncate text-xs ${T.faint}`}>{state.structure.tenant} · {state.structure.site}</div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Fast PIN switcher — 3-second shift/user change on shared screens */}
        <button onClick={() => setPinOpen(true)}
          title={S.pr7.fastSwitch}
          className={`hidden items-center gap-2 rounded-lg px-3 py-2 sm:inline-flex ${T.ghost} ${T.sizes.nav}`}>
          <RoleIcon size={16} /><span className="max-w-[9rem] truncate">{user?.full_name}</span>
          <KeyRound size={14} className="text-brand" />
        </button>
        {pinOpen && <PinSwitchModal T={T} S={S} store={store} onClose={() => setPinOpen(false)} />}

        {/* Offline / online toggle (PWA resilience) */}
        <button onClick={() => store.setOnline(!online)}
          title={online ? S.pr7.goOffline : S.pr7.goOnline}
          className={`grid h-9 w-9 place-items-center rounded-lg ${T.ghost} ${online ? "text-emerald-500" : "text-amber-500"}`}>
          {online ? <Cloud size={17} /> : <CloudOff size={17} />}
        </button>

        {/* Alarm sound (IEC 60601-1-8) enable */}
        <button onClick={onEnableSound}
          title={soundOn ? S.pr7.soundOn : S.pr7.soundOff}
          className={`grid h-9 w-9 place-items-center rounded-lg ${T.ghost} ${soundOn ? "text-brand" : T.faint}`}>
          {soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
        </button>

        {/* Web push / notification enable */}
        <button onClick={onEnableNotify}
          title={notifyPerm === "granted" ? S.pr7.notifyOn : S.pr7.notifyEnable}
          className={`grid h-9 w-9 place-items-center rounded-lg ${T.ghost} ${notifyPerm === "granted" ? "text-brand" : T.faint}`}>
          {notifyPerm === "granted" ? <Bell size={17} /> : <BellOff size={17} />}
        </button>

        {/* Bildirim Sistemini Test Et — only when notifications are granted */}
        {notifyPerm === "granted" && (
          <button onClick={onTestPush}
            title={S.pr8.sendTestPush}
            className={`hidden h-9 w-9 place-items-center rounded-lg sm:grid ${T.ghost} text-emerald-500`}>
            <Radio size={17} />
          </button>
        )}

        {/* Auto-alarm toggle */}
        <button
          onClick={() => store.setAutoAlarm(!state.autoAlarm)}
          title={state.autoAlarm ? S.pr6.autoAlarmOn : S.pr6.autoAlarmOff}
          className={`grid h-9 w-9 place-items-center rounded-lg ${T.ghost} ${state.autoAlarm ? "text-red-500" : T.faint}`}>
          {state.autoAlarm ? <Siren size={17} /> : <BellOff size={17} />}
        </button>

        {/* KVKK name-mask toggle */}
        <button
          onClick={() => store.toggleMaskNames()}
          title={S.pr6.maskNames}
          className={`grid h-9 w-9 place-items-center rounded-lg ${T.ghost} ${state.maskNames ? "text-brand" : T.faint}`}>
          {state.maskNames ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>

        {/* Theme selector */}
        <Menu T={T} triggerClass={`grid h-9 w-9 place-items-center rounded-lg ${T.ghost}`}
          trigger={(() => { const I = THEME_ICON[theme] || Moon; return <I size={17} />; })()}>
          {({ close }) => (
            <div>
              <div className={`px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide ${T.faint}`}>{S.themeLabel}</div>
              {THEME_KEYS.map((k) => { const I = THEME_ICON[k]; return (
                <button key={k} onClick={() => { setTheme(k); close(); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle} ${T.sizes.nav}`}>
                  <I size={15} /> {S.theme[k]}
                  {theme === k && <Check size={15} className="ml-auto text-brand" />}
                </button>
              ); })}
            </div>
          )}
        </Menu>

        {/* Language selector — gerçek SVG bayraklar (Windows emoji bayrak sorununa dayanıklı) */}
        <div className={`hidden items-center gap-0.5 rounded-xl border ${T.border} ${T.subtle} p-0.5 sm:flex`} title={S.langLabel}>
          {LANGS.map(([code, label]) => (
            <button key={code} onClick={() => setLang(code)} title={label} aria-label={label}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2 transition ${lang === code ? "bg-brand/20 ring-1 ring-brand/50" : "opacity-55 hover:opacity-100"}`}>
              <Flag code={code} className="h-3.5 w-5" />
              <span className={`text-[11px] font-bold uppercase ${lang === code ? "text-brand" : ""}`}>{code}</span>
            </button>
          ))}
        </div>
        {/* Compact flag dropdown for narrow screens */}
        <Menu T={T} triggerClass={`inline-flex items-center gap-1 rounded-lg px-2 py-2 sm:hidden ${T.ghost} ${T.sizes.nav}`}
          trigger={<><Flag code={lang} className="h-3.5 w-5" /><ChevronDown size={13} /></>}>
          {({ close }) => (
            <div>
              <div className={`px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide ${T.faint}`}>{S.langLabel}</div>
              {LANGS.map(([code, label]) => (
                <button key={code} onClick={() => { setLang(code); close(); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle} ${T.sizes.nav}`}>
                  <Flag code={code} className="h-3.5 w-5" /> {label}
                  {lang === code && <Check size={15} className="ml-auto text-brand" />}
                </button>
              ))}
            </div>
          )}
        </Menu>

        {/* Shift — çalışır vardiya menüsü: saate göre otomatik algılanır, elle değiştirilebilir */}
        <ShiftMenu T={T} S={S} state={state} />
        {/* logout */}
        <button onClick={() => store.logout()} className={`grid h-9 w-9 place-items-center rounded-lg ${T.ghost}`} title={S.logout}>
          <LogOut size={17} />
        </button>
      </div>
    </header>
  );
}

// ================================================================ SIDEBAR
const NAV_ITEMS = [
  { key: "board", icon: LayoutGrid, roles: "all", group: "clinical" },
  { key: "admission", icon: UserPlus, roles: [ROLE.ATTENDING, ROLE.CHARGE_NURSE, ROLE.HOSPITAL_ADMIN], group: "clinical" },
  { key: "care", icon: Users, roles: [ROLE.ATTENDING, ROLE.CHARGE_NURSE, ROLE.HOSPITAL_ADMIN], group: "clinical" },
  { key: "alarms", icon: Bell, roles: "all", group: "clinical" },
  { key: "results", icon: Inbox, roles: [ROLE.ATTENDING, ROLE.CHARGE_NURSE, ROLE.HOSPITAL_ADMIN], group: "ops" },
  { key: "heatmap", icon: Grid3x3, roles: "all", group: "ops" },
  { key: "admin", icon: Settings, roles: [ROLE.HOSPITAL_ADMIN], group: "admin" },
];
const NAV_GROUPS = [
  { id: "clinical", label: "navGroupClinical" },
  { id: "ops", label: "navGroupOps" },
  { id: "admin", label: "navGroupAdmin" },
];
function canSee(item, role) { return item.roles === "all" || item.roles.includes(role); }

function Sidebar({ T, S, state, page, setPage, collapsed, setCollapsed, mobileOpen, setMobileOpen }) {
  const role = state.user?.role;
  const visible = NAV_ITEMS.filter((i) => canSee(i, role));
  const width = collapsed ? "w-16" : "w-64";
  const body = (
    <div className={`flex h-full flex-col border-r ${T.border} ${T.sidebar}`}>
      <div className={`flex items-center gap-2.5 px-4 py-4 ${collapsed ? "justify-center" : ""}`}>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand text-white">
          <Activity size={20} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className={`truncate font-bold ${T.heading}`}>{S.appName}</div>
            <div className={`truncate text-[10px] ${T.faint}`}>{S.tagline}</div>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2.5 py-2">
        {NAV_GROUPS.map((g) => {
          const items = visible.filter((i) => (i.group || "clinical") === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id} className="mb-1.5">
              {!collapsed && <div className={`px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider ${T.faint}`}>{S[g.label]}</div>}
              {collapsed && <div className={`mx-2 my-1.5 border-t ${T.border}`} />}
              {items.map((item) => {
                const Icon = item.icon;
                const active = page === item.key;
                return (
                  <button key={item.key} title={S.nav[item.key]}
                    onClick={() => { setPage(item.key); setMobileOpen(false); }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 font-medium transition ${T.sizes.nav} ${active ? T.navActive : T.navIdle} ${collapsed ? "justify-center" : ""}`}>
                    <Icon size={20} className="shrink-0" />
                    {!collapsed && <span className="truncate">{S.nav[item.key]}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className={`border-t ${T.border} p-2.5`}>
        <button onClick={() => setCollapsed((c) => !c)}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 ${T.navIdle} ${T.sizes.nav} ${collapsed ? "justify-center" : ""}`}>
          {collapsed ? <PanelLeft size={18} /> : <><PanelLeftClose size={18} /><span>{S.collapse}</span></>}
        </button>
      </div>
    </div>
  );
  return (
    <>
      <aside className={`hidden shrink-0 lg:block ${width} transition-all`}>{body}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className={`absolute inset-0 ${T.overlay}`} onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64">{body}</div>
        </div>
      )}
    </>
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

// ================================================================ BED BOARD
// Canlı EKG / SpO₂ dalga formu — akan yeşil çizgi + nabızla senkron parlama.
// Saf SVG + SMIL animasyonu (harici kütüphane yok); hasta-başı monitör hissi verir.
function ekgBeatPath(beats, beatW, mid, amp) {
  // Tek bir vuruş şablonu (P–QRS–T), midline'a göre y ofsetleri.
  const tpl = [[0, 0], [9, 0], [12, -0.18], [15, 0], [18, 0], [19, 0.5], [21, -0.95],
    [23, 0.6], [25, 0], [30, 0], [33, -0.32], [36, 0], [40, 0]];
  let d = "";
  for (let b = 0; b < beats; b++) {
    for (let i = 0; i < tpl.length; i++) {
      const [rx, ry] = tpl[i];
      const x = b * beatW + (rx / 40) * beatW;
      const y = mid + ry * amp;
      d += `${i === 0 && b === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)} `;
    }
  }
  return d.trim();
}
function Waveform({ hr = 80, height = 34, stroke = "#10b981" }) {
  const beats = 4, beatW = 46, mid = height / 2, amp = height * 0.38;
  const period = beats * beatW;
  // İki periyot yan yana → kesintisiz kayar. HR'a bağlı süre (daha hızlı kalp = daha hızlı akış).
  const path = useMemo(() => ekgBeatPath(beats * 2, beatW, mid, amp), [beatW, mid, amp]);
  const dur = Math.max(2, (beats * 60) / Math.max(40, hr));
  return (
    <div className="relative w-full overflow-hidden rounded-lg" style={{ height }} aria-hidden="true">
      <svg width="100%" height={height} viewBox={`0 0 ${period} ${height}`} preserveAspectRatio="none">
        <g>
          <path d={path} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
          <animateTransform attributeName="transform" type="translate" from="0" to={`-${period}`} dur={`${dur}s`} repeatCount="indefinite" />
        </g>
      </svg>
    </div>
  );
}

function BedBoard({ T, S, state, onOpenPatient, lang }) {
  const units = state.structure.units;
  const [unitId, setUnitId] = useState("all");
  const beds = unitId === "all" ? state.beds : state.beds.filter((b) => b.unitId === unitId);
  const occupied = beds.filter((b) => b.state === "OCCUPIED").length;
  const patientOf = (id) => state.patients.find((p) => p.patient_id === id);

  return (
    <div className="space-y-4">
      {/* unit tabs + occupancy */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setUnitId("all")}
          className={`rounded-lg px-3 py-2 font-medium ${T.sizes.nav} ${unitId === "all" ? T.navActive : T.ghost}`}>
          {S.allUnits}
        </button>
        {units.map((u) => (
          <button key={u.id} onClick={() => setUnitId(u.id)}
            className={`rounded-lg px-3 py-2 font-medium ${T.sizes.nav} ${unitId === u.id ? T.navActive : T.ghost}`}>
            {u.name}
          </button>
        ))}
        <div className={`ml-auto rounded-lg px-3 py-2 ${T.chip} ${T.sizes.nav}`}>
          {S.occupancy}: <b>{occupied}</b> / {beds.length}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {beds.map((bed) => {
          const p = bed.patientId ? patientOf(bed.patientId) : null;
          if (!p) {
            return (
              <div key={bed.id} className={`rounded-xl border border-dashed ${T.border} ${T.subtle} p-4 opacity-70`}>
                <div className="flex items-center justify-between">
                  <span className={`font-bold ${T.muted} ${T.sizes.name}`}>{bed.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${T.chip}`}>{S.available}</span>
                </div>
                <div className={`mt-6 text-center text-sm ${T.faint}`}>{S.noPatientBed}</div>
              </div>
            );
          }
          const ru = riskUi(p.risk);
          const dev = state.devices?.find((d) => d.bedId === bed.id && d.connected);
          return (
            <button key={bed.id} onClick={() => onOpenPatient(p.patient_id)}
              className={`group rounded-xl border ${T.border} ${T.card} ${T.hoverRing} p-4 text-left ring-1 transition`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-md ${T.subtle} px-2 py-0.5 text-xs font-bold ${T.muted}`}>{bed.label}</span>
                    <span className={`truncate font-bold ${T.heading} ${T.sizes.name}`}>{maskedName(state, p.display_name)}</span>
                  </div>
                  <div className={`mt-0.5 text-xs ${T.faint}`}>
                    {ageText(p, S)}{!p.isNeonate ? "y" : ""} · {p.sex === "male" ? S.male : S.female} · {S.protocolNo} {p.protocolNo}
                  </div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${ru.ring} ${ru.text}`}>
                  <span className={`h-2 w-2 rounded-full ${ru.dot}`} /> {S.risk[p.risk]}
                </span>
              </div>
              <div className={`mt-2 line-clamp-2 text-sm ${T.muted}`}>
                <span className={`font-medium ${T.faint}`}>{S.admissionDx}: </span>{p.diagnosis}
              </div>
              <VitalsGrid T={T} vitals={p.vitals} />
              {dev && (
                <div className="relative mt-2 rounded-lg bg-emerald-500/5 ring-1 ring-emerald-500/20">
                  <span className="pointer-events-none absolute inset-0 rounded-lg bg-emerald-500/10 blur-md animate-pulse" aria-hidden="true" />
                  <div className="relative flex items-center gap-2 px-2 py-1">
                    <Heart size={12} className="shrink-0 text-emerald-500 animate-pulse" />
                    <div className="min-w-0 flex-1"><Waveform hr={p.vitals?.hr || 80} height={30} /></div>
                    <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-emerald-500">{p.vitals?.hr ?? "—"}<span className="text-[8px] font-normal"> bpm</span></span>
                  </div>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <News2Pill S={S} vitals={p.vitals} />
                <BranchProfileBadge S={S} lang={lang} profile={profileForPatient(state, p)} size="sm" />
                {dev ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-500 ring-1 ring-emerald-500/30">
                    <Radio size={11} className="animate-pulse" /> {S.pr7.live} · {dev.model} · {dev.ip}
                  </span>
                ) : (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${T.chip} ${T.faint}`}>
                    <WifiOff size={11} /> {S.pr7.offlineDev}
                  </span>
                )}
              </div>
              <div className={`mt-3 flex items-center justify-between text-xs ${T.faint}`}>
                <span>{S.mrn} {p.mrn}</span>
                <span>{S.lengthOfStay}: {losText(p.admittedAtMs, S)}</span>
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

function PatientDrawer({ T, S, state, store, patientId, onClose, onTransfer, onExpand, lang }) {
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
            <h2 className={`text-xl font-bold ${T.heading}`}>{maskedName(state, p.display_name)}</h2>
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
          <ClinicalModule T={T} S={S} store={store} state={state} patientId={p.patient_id} lang={lang} />
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

function ModalShell({ T, title, sub, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className={`absolute inset-0 ${T.overlay}`} onClick={onClose} />
      <div className={`relative w-full max-w-md rounded-2xl border ${T.border} ${T.card} p-5`}>
        <div className="mb-4">
          <h3 className={`text-lg font-bold ${T.heading}`}>{title}</h3>
          {sub && <p className={`text-sm ${T.muted}`}>{sub}</p>}
        </div>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}

// ================================================================ ADMISSION / TRANSFER
function AdmissionPage({ T, S, store, state, preselectTransfer, clearPreselect }) {
  const [tab, setTab] = useState(preselectTransfer ? "transfer" : "admit");
  useEffect(() => { if (preselectTransfer) setTab("transfer"); }, [preselectTransfer]);
  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setTab("admit")} className={`rounded-lg px-4 py-2.5 font-semibold ${T.sizes.nav} ${tab === "admit" ? T.navActive : T.ghost}`}>
          <UserPlus size={16} className="mr-2 inline" />{S.admissionTitle}
        </button>
        <button onClick={() => setTab("transfer")} className={`rounded-lg px-4 py-2.5 font-semibold ${T.sizes.nav} ${tab === "transfer" ? T.navActive : T.ghost}`}>
          <ArrowLeftRight size={16} className="mr-2 inline" />{S.transferTitle}
        </button>
      </div>
      {tab === "admit"
        ? <AdmitForm T={T} S={S} store={store} state={state} />
        : <TransferForm T={T} S={S} store={store} state={state} preselect={preselectTransfer} clearPreselect={clearPreselect} />}
    </div>
  );
}

function SectionHeader({ T, icon: Icon, title, hint }) {
  return (
    <div className="mb-3 mt-1 flex items-center gap-2">
      {Icon && <span className={`grid h-7 w-7 place-items-center rounded-lg ${T.chip}`}><Icon size={15} /></span>}
      <div>
        <div className={`font-semibold ${T.heading}`}>{title}</div>
        {hint && <div className={`text-xs ${T.faint}`}>{hint}</div>}
      </div>
    </div>
  );
}

function AdmitForm({ T, S, store, state }) {
  const units = state.structure.units;
  const P = S.pr19;
  const attendings = state.users.filter((u) => u.role === ROLE.ATTENDING);
  const nurses = state.users.filter((u) => u.role === ROLE.CHARGE_NURSE);
  const [f, setF] = useState({
    name: "", age: "", sex: "male", isNeonate: false, unitId: units[0]?.id || "",
    bedId: "", source: "emergency", risk: "stable", dx: "",
    triage: "standard", admittingComplaint: "", allergies: "", comorbidities: "",
    codeStatus: "full", isolation: "none", weight: "", height: "", bloodType: "",
    insurance: "", emergencyContact: "", emergencyPhone: "", attendingId: "", nurseId: "",
  });
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const upd = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const availBeds = state.beds.filter((b) => b.unitId === f.unitId && b.state === "AVAILABLE");
  const triageOpts = [
    ["resus", P.triageResus], ["emergent", P.triageEmergent], ["urgent", P.triageUrgent],
    ["standard", P.triageStandard], ["nonurgent", P.triageNonurgent],
  ];
  const codeOpts = [["full", P.codeFull], ["dnr", P.codeDnr], ["limited", P.codeLimited]];
  const isoOpts = [["none", P.isoNone], ["contact", P.isoContact], ["droplet", P.isoDroplet], ["airborne", P.isoAirborne]];
  const submit = (e) => {
    e.preventDefault(); setErr(""); setMsg("");
    try {
      const p = store.admitPatient({
        displayName: f.name, sex: f.sex, bedId: f.bedId, diagnosisText: f.dx,
        age: f.isNeonate ? 0 : Number(f.age) || null, isNeonate: f.isNeonate, ageDays: f.isNeonate ? Number(f.age) || 0 : null,
        source: f.source, risk: f.risk,
        triage: f.triage, admittingComplaint: f.admittingComplaint,
        allergies: f.allergies, comorbidities: f.comorbidities, codeStatus: f.codeStatus, isolation: f.isolation,
        weight: Number(f.weight) || null, height: Number(f.height) || null, bloodType: f.bloodType,
        insurance: f.insurance, emergencyContact: f.emergencyContact, emergencyPhone: f.emergencyPhone,
        attendingId: f.attendingId || null, nurseId: f.nurseId || null,
      });
      setMsg(`${S.admittedOk} (${p.protocolNo})`);
      setF((s) => ({ ...s, name: "", age: "", dx: "", bedId: "", admittingComplaint: "", allergies: "", comorbidities: "",
        weight: "", height: "", bloodType: "", insurance: "", emergencyContact: "", emergencyPhone: "", attendingId: "", nurseId: "" }));
    } catch (ex) { setErr(ex.message); }
  };
  const cardCls = `rounded-2xl border ${T.border} ${T.card} p-5`;
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className={`text-sm ${T.muted}`}>{S.admissionSub}</p>

      {/* Bölüm 1 — Hasta Kimliği */}
      <div className={cardCls}>
        <SectionHeader T={T} icon={UserPlus} title={P.secIdentity} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field T={T} label={S.fName}><input className={inputCls(T)} value={f.name} onChange={(e) => upd("name", e.target.value)} required /></Field>
          <Field T={T} label={f.isNeonate ? `${S.fAge} (${S.dayUnit})` : S.fAge}><input type="number" min="0" className={inputCls(T)} value={f.age} onChange={(e) => upd("age", e.target.value)} /></Field>
          <Field T={T} label={S.fSex}>
            <select className={inputCls(T)} value={f.sex} onChange={(e) => upd("sex", e.target.value)}>
              <option value="male">{S.male}</option><option value="female">{S.female}</option>
            </select>
          </Field>
          <Field T={T} label={`${P.bloodType} (${P.optional})`}>
            <select className={inputCls(T)} value={f.bloodType} onChange={(e) => upd("bloodType", e.target.value)}>
              <option value="">—</option>
              {["0 Rh+", "0 Rh−", "A Rh+", "A Rh−", "B Rh+", "B Rh−", "AB Rh+", "AB Rh−"].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field T={T} label={`${P.weight} (${P.optional})`}><input type="number" min="0" step="0.1" className={inputCls(T)} value={f.weight} onChange={(e) => upd("weight", e.target.value)} /></Field>
          <Field T={T} label={`${P.height} (${P.optional})`}><input type="number" min="0" className={inputCls(T)} value={f.height} onChange={(e) => upd("height", e.target.value)} /></Field>
        </div>
        <label className={`mt-3 flex items-center gap-2 ${T.sizes.nav} ${T.text}`}>
          <input type="checkbox" checked={f.isNeonate} onChange={(e) => upd("isNeonate", e.target.checked)} /> {S.unitNicu}
        </label>
      </div>

      {/* Bölüm 2 — Klinik Değerlendirme & Triyaj */}
      <div className={cardCls}>
        <SectionHeader T={T} icon={Activity} title={P.secClinical} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field T={T} label={P.triage}>
            <select className={inputCls(T)} value={f.triage} onChange={(e) => upd("triage", e.target.value)}>
              {triageOpts.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
            </select>
          </Field>
          <Field T={T} label={S.riskLevel}>
            <select className={inputCls(T)} value={f.risk} onChange={(e) => upd("risk", e.target.value)}>
              {["stable", "low", "high", "critical"].map((r) => <option key={r} value={r}>{S.risk[r]}</option>)}
            </select>
          </Field>
          <Field T={T} label={P.codeStatus}>
            <select className={inputCls(T)} value={f.codeStatus} onChange={(e) => upd("codeStatus", e.target.value)}>
              {codeOpts.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
            </select>
          </Field>
          <Field T={T} label={P.isolation}>
            <select className={inputCls(T)} value={f.isolation} onChange={(e) => upd("isolation", e.target.value)}>
              {isoOpts.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-4">
          <Field T={T} label={P.admittingComplaint}>
            <input className={inputCls(T)} value={f.admittingComplaint} onChange={(e) => upd("admittingComplaint", e.target.value)} placeholder={P.complaintPlaceholder} />
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field T={T} label={`${P.allergies} (${P.optional})`}>
            <input className={inputCls(T)} value={f.allergies} onChange={(e) => upd("allergies", e.target.value)} placeholder={P.allergyPlaceholder} />
          </Field>
          <Field T={T} label={`${P.comorbidities} (${P.optional})`}>
            <input className={inputCls(T)} value={f.comorbidities} onChange={(e) => upd("comorbidities", e.target.value)} placeholder={P.comorbidPlaceholder} />
          </Field>
        </div>
        <div className="mt-4">
          <Field T={T} label={S.fDx}>
            <textarea rows={3} className={inputCls(T)} value={f.dx} onChange={(e) => upd("dx", e.target.value)} placeholder={S.dxPlaceholder} required />
          </Field>
        </div>
      </div>

      {/* Bölüm 3 — Yatak & Bakım Ekibi */}
      <div className={cardCls}>
        <SectionHeader T={T} icon={Bed} title={P.secBedTeam} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field T={T} label={S.fUnit}>
            <select className={inputCls(T)} value={f.unitId} onChange={(e) => { upd("unitId", e.target.value); upd("bedId", ""); }}>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field T={T} label={S.fBed}>
            <select className={inputCls(T)} value={f.bedId} onChange={(e) => upd("bedId", e.target.value)} required>
              <option value="">{availBeds.length ? S.selectTargetBed : S.noAvailableBed}</option>
              {availBeds.map((b) => <option key={b.id} value={b.id}>{b.roomLabel} · {b.label}</option>)}
            </select>
          </Field>
          <Field T={T} label={S.fSource}>
            <select className={inputCls(T)} value={f.source} onChange={(e) => upd("source", e.target.value)}>
              {Object.keys(S.source).map((k) => <option key={k} value={k}>{S.source[k]}</option>)}
            </select>
          </Field>
          <Field T={T} label={`${P.assignAttending} (${P.optional})`}>
            <select className={inputCls(T)} value={f.attendingId} onChange={(e) => upd("attendingId", e.target.value)}>
              <option value="">{S.none}</option>
              {attendings.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
          <Field T={T} label={`${P.assignNurse} (${P.optional})`}>
            <select className={inputCls(T)} value={f.nurseId} onChange={(e) => upd("nurseId", e.target.value)}>
              <option value="">{S.none}</option>
              {nurses.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {/* Bölüm 4 — İletişim & Güvence */}
      <div className={cardCls}>
        <SectionHeader T={T} icon={HeartHandshake} title={P.secContact} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field T={T} label={`${P.insurance} (${P.optional})`}><input className={inputCls(T)} value={f.insurance} onChange={(e) => upd("insurance", e.target.value)} /></Field>
          <Field T={T} label={`${P.emergencyContact} (${P.optional})`}><input className={inputCls(T)} value={f.emergencyContact} onChange={(e) => upd("emergencyContact", e.target.value)} /></Field>
          <Field T={T} label={`${P.emergencyPhone} (${P.optional})`}><input className={inputCls(T)} value={f.emergencyPhone} onChange={(e) => upd("emergencyPhone", e.target.value)} /></Field>
        </div>
        <p className={`mt-3 text-xs ${T.faint}`}>{P.docsAfterAdmit || ""}</p>
      </div>

      {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      {msg && <div className="rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-500">{msg}</div>}
      <div className="flex justify-end">
        <button type="submit" className={btnCls(T, "primary")}><Check size={16} /> {S.admitBtn}</button>
      </div>
    </form>
  );
}

function TransferForm({ T, S, store, state, preselect, clearPreselect }) {
  const [patientId, setPatientId] = useState(preselect || "");
  const [bedId, setBedId] = useState("");
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  useEffect(() => { if (preselect) setPatientId(preselect); }, [preselect]);
  const availBeds = state.beds.filter((b) => b.state === "AVAILABLE");
  const submit = (e) => {
    e.preventDefault(); setErr(""); setMsg("");
    try { store.transferPatient({ patientId, targetBedId: bedId }); setMsg(S.transferredOk); setBedId(""); if (clearPreselect) clearPreselect(); }
    catch (ex) { setErr(ex.message); }
  };
  return (
    <form onSubmit={submit} className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <p className={`mb-4 text-sm ${T.muted}`}>{S.transferSub}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field T={T} label={S.selectPatient}>
          <select className={inputCls(T)} value={patientId} onChange={(e) => setPatientId(e.target.value)} required>
            <option value="">{S.selectPatient}</option>
            {state.patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.bedLabel} · {p.display_name}</option>)}
          </select>
        </Field>
        <Field T={T} label={S.selectTargetBed}>
          <select className={inputCls(T)} value={bedId} onChange={(e) => setBedId(e.target.value)} required>
            <option value="">{availBeds.length ? S.selectTargetBed : S.noAvailableBed}</option>
            {availBeds.map((b) => <option key={b.id} value={b.id}>{b.unitName} · {b.roomLabel} · {b.label}</option>)}
          </select>
        </Field>
      </div>
      {err && <div className="mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      {msg && <div className="mt-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-500">{msg}</div>}
      <div className="mt-4 flex justify-end">
        <button type="submit" className={btnCls(T, "primary")}><ArrowLeftRight size={16} /> {S.transferBtn}</button>
      </div>
    </form>
  );
}

// ================================================================ CARE TEAM
function CareTeamPage({ T, S, store, state }) {
  const attendings = state.users.filter((u) => u.role === ROLE.ATTENDING);
  const nurses = state.users.filter((u) => u.role === ROLE.CHARGE_NURSE);
  const userName = (id) => state.users.find((u) => u.id === id)?.full_name || S.none;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
          <p className={`mb-4 text-sm ${T.muted}`}>{S.careSub}</p>
          <div className="space-y-3">
            {state.patients.map((p) => {
              const team = state.careTeam[p.patient_id] || {};
              return (
                <div key={p.patient_id} className={`rounded-xl border ${T.border} ${T.subtle} p-4`}>
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{p.bedLabel} · {maskedName(state, p.display_name)}</div>
                    <span className={`text-xs ${T.faint}`}>{p.diagnosis}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field T={T} label={S.attending}>
                      <select className={inputCls(T)} value={team.attendingId || ""}
                        onChange={(e) => store.assignCareTeam({ patientId: p.patient_id, attendingId: e.target.value })}>
                        <option value="">{S.none}</option>
                        {attendings.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                    </Field>
                    <Field T={T} label={S.nurse}>
                      <select className={inputCls(T)} value={team.nurseId || ""}
                        onChange={(e) => store.assignCareTeam({ patientId: p.patient_id, nurseId: e.target.value })}>
                        <option value="">{S.none}</option>
                        {nurses.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div>
        <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
          <h3 className={`mb-3 font-bold ${T.heading}`}>{S.shiftRoster}</h3>
          <div className="space-y-2">
            {state.users.map((u) => (
              <div key={u.id} className={`flex items-center gap-3 rounded-lg ${T.subtle} px-3 py-2.5`}>
                <div className="grid h-8 w-8 place-items-center rounded-full bg-brand/15 text-brand">
                  {u.role === ROLE.HOSPITAL_ADMIN ? <ShieldAlert size={15} /> : u.role === ROLE.CHARGE_NURSE ? <HeartPulse size={15} /> : <Stethoscope size={15} />}
                </div>
                <div className="min-w-0">
                  <div className={`truncate text-sm font-semibold ${T.text}`}>{u.full_name}</div>
                  <div className={`truncate text-xs ${T.faint}`}>{S.roleName[u.role]}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ================================================================ RESULTS INBOX (pr19 #4)
function ResultsInbox({ T, S, store, state }) {
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
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-500">DEMO</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => store.toggleHisIntegration()}
              className={btnCls(T, his.connected ? "ghost" : "primary")}>
              <RefreshCw size={15} /> {P.integrationToggle}
            </button>
            <button onClick={doSimulate} disabled={!his.connected}
              className={`${btnCls(T, "ghost")} ${!his.connected ? "cursor-not-allowed opacity-50" : ""}`}>
              <Download size={15} /> {P.simulateInbound}
            </button>
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
function AlarmPage({ T, S, store, state, lang }) {
  const alerts = [...state.alerts].filter((a) => a.status !== "CLOSED").reverse();
  const [fp, setFp] = useState(state.patients[0]?.patient_id || "");
  const [ft, setFt] = useState(TIER.CRITICAL);
  const fire = () => { if (fp) store.fireAlert({ patientId: fp, tier: ft, summary: ALERT_TXT[lang] || ALERT_TXT.tr }); };
  const [ackFor, setAckFor] = useState(null);
  const [snzFor, setSnzFor] = useState(null);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* left: controls */}
      <div className="space-y-4">
        <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
          <h3 className={`mb-1 font-bold ${T.heading}`}>{S.fireAlert}</h3>
          <p className={`mb-3 text-sm ${T.muted}`}>{S.alarmsSub}</p>
          <div className="space-y-3">
            <Field T={T} label={S.viewDetail}>
              <select className={inputCls(T)} value={fp} onChange={(e) => setFp(e.target.value)}>
                {state.patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.bedLabel} · {maskedName(state, p.display_name)}</option>)}
              </select>
            </Field>
            <Field T={T} label={S.alertTier}>
              <select className={inputCls(T)} value={ft} onChange={(e) => setFt(e.target.value)}>
                {[TIER.CRITICAL, TIER.HIGH, TIER.MEDIUM, TIER.LOW].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <button onClick={fire} className={`${btnCls(T, "danger")} w-full`}><Siren size={16} /> {S.fireBtn}</button>
          </div>
        </div>

        <TimeScale T={T} S={S} store={store} state={state} />
        <BreakGlass T={T} S={S} store={store} state={state} />
      </div>

      {/* right: active alerts */}
      <div className="xl:col-span-2">
        <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className={`font-bold ${T.heading}`}>{S.activeAlerts}</h3>
            <span className={`rounded-full px-2.5 py-0.5 text-xs ${T.chip}`}>{alerts.length}</span>
          </div>
          {alerts.length === 0
            ? <div className={`py-10 text-center text-sm ${T.faint}`}>{S.noAlerts}</div>
            : <div className="space-y-3">{alerts.map((a) => (
                <AlertCard key={a.id} T={T} S={S} state={state} alert={a} onAck={() => setAckFor(a)} onSnooze={() => setSnzFor(a)}
                  onEscalate={() => store.escalateToRRT(a.id)} onMute={() => store.muteAlert(a.id)} />
              ))}</div>}
        </div>
      </div>

      {ackFor && <AckModal T={T} S={S} store={store} alert={ackFor} onClose={() => setAckFor(null)} />}
      {snzFor && <SnoozeModal T={T} S={S} store={store} alert={snzFor} onClose={() => setSnzFor(null)} />}
    </div>
  );
}

function AlertCard({ T, S, state, alert, onAck, onSnooze, onEscalate, onMute }) {
  const ui = tierUi(alert.tier);
  const patient = state.patients.find((p) => p.patient_id === alert.patientId);
  const isMuted = alert.mutedUntil != null && alert.mutedUntil > state.clockSec;
  const elapsed = alert.status === "FIRED" ? state.clockSec - alert.firedAtSec : 0;
  const toNext = alert.status === "FIRED" ? secondsToNextStep(elapsed, alert.tier) : null;
  const statusTxt = { FIRED: S.statusFired, ACKNOWLEDGED: S.statusAck, SNOOZED: S.statusSnoozed, CLOSED: S.statusClosed }[alert.status];
  const reached = (step) => alert.events.some((e) => e.step === step);
  const steps = [
    { step: ESCALATION_STEP.TIER_1_CHARGE_NURSE, label: S.step1 },
    { step: ESCALATION_STEP.TIER_2_PHYSICIAN, label: S.step2 },
    { step: ESCALATION_STEP.TIER_3_RRT, label: S.step3 },
  ];
  return (
    <div className={`rounded-xl border ${T.border} ${T.subtle} p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold ${ui.chip}`}>
              <span className={`h-2 w-2 rounded-full ${ui.dot}`} /> {alert.tier}
            </span>
            {alert.auto && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-bold text-brand">
                <Siren size={11} /> {S.pr6.autoBadge}
              </span>
            )}
            <span className={`text-sm font-semibold ${T.text}`}>{patient?.bedLabel} · {maskedName(state, patient?.display_name)}</span>
          </div>
          <div className={`mt-1 text-sm ${T.muted}`}>{alert.summary}</div>
          {alert.trigger && <div className={`mt-0.5 text-xs ${ui.text}`}>{alert.trigger}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs ${T.chip}`}>{statusTxt}</span>
          {isMuted && <span className="inline-flex items-center gap-1 rounded-full bg-slate-400/15 px-2 py-0.5 text-[11px] text-slate-400"><VolumeX size={11} /> {S.pr6.muted}</span>}
        </div>
      </div>

      {alert.status === "FIRED" && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className={`inline-flex items-center gap-1 tabular-nums ${ui.text}`}><Clock size={13} /> {S.elapsed}: {fmtClock(elapsed)}</span>
          <span className={T.faint}>{toNext != null ? `${S.nextStep}: ${fmtClock(toNext)}` : S.atTier3}</span>
        </div>
      )}
      {alert.status === "SNOOZED" && alert.snooze && (
        <div className={`mt-2 text-xs ${T.faint}`}>{S.snoozedUntil}: {fmtClock(alert.snooze.until)}</div>
      )}

      {/* escalation chain */}
      <div className="mt-3 flex items-center gap-1.5">
        {steps.map((s, i) => {
          const on = reached(s.step);
          return (
            <React.Fragment key={s.step}>
              <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium ${on ? "bg-red-500/15 text-red-500" : T.chip}`}>
                {on ? <CheckCircle2 size={12} /> : <Circle size={12} />} {s.label}
              </div>
              {i < steps.length - 1 && <div className={`h-px w-3 ${T.border} border-t`} />}
            </React.Fragment>
          );
        })}
      </div>

      {/* PR#6 — visual escalation timeline (0-3 / 3-5 / 5-10 min) */}
      {alert.status === "FIRED" && <EscalationTimeline T={T} S={S} alert={alert} state={state} />}

      {alert.ack && (
        <div className={`mt-3 rounded-lg ${T.card} border ${T.border} p-2 text-xs ${T.muted}`}>
          <span className="font-semibold text-emerald-500">{S.statusAck}</span> · {alert.ack.by} · {S.reasonOptions[alert.ack.reason] || alert.ack.reason}
          {alert.ack.note && <div className={`mt-0.5 ${T.text}`}>{alert.ack.note}</div>}
        </div>
      )}

      {alert.status === "FIRED" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={onAck} className={`${btnCls(T, "primary")} px-3 py-2`}><Check size={15} /> {S.ack}</button>
          {canSnooze(alert.tier)
            ? <button onClick={onSnooze} className={`${btnCls(T, "ghost")} px-3 py-2`}><BellOff size={15} /> {S.snooze}</button>
            : <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs ${ui.chip}`}><AlertTriangle size={14} /> {S.critNoSnooze}</span>}
          <button onClick={onMute} disabled={isMuted} className={`${btnCls(T, "ghost")} px-3 py-2 ${isMuted ? "opacity-50" : ""}`}>
            {isMuted ? <Volume2 size={15} /> : <VolumeX size={15} />} {isMuted ? S.pr6.muted : S.pr6.mute}
          </button>
          <button onClick={onEscalate} className={`${btnCls(T, "warn")} px-3 py-2`}><ArrowUpCircle size={15} /> {S.escalateRRT}</button>
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
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={`font-bold ${T.heading}`}>{S.timeScale}</h3>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs tabular-nums ${T.chip}`}>
          <Clock size={13} /> {fmtClock(state.clockSec)}
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

// ================================================================ EXECUTIVE ANALYTICS (§PR8)
// Canlı KPI'lar, alarm kalitesi ve cihaz sağlığı — hepsi computeAnalytics(state) saf fonksiyonundan.
function KpiCard({ T, icon: Icon, label, value, sub, accent = "text-brand" }) {
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-4`}>
      <div className="flex items-center gap-2">
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${T.subtle} ${accent}`}><Icon size={17} /></span>
        <span className={`text-xs font-semibold uppercase tracking-wide ${T.faint}`}>{label}</span>
      </div>
      <div className={`mt-2 text-3xl font-bold ${T.heading}`}>{value}</div>
      {sub && <div className={`mt-0.5 text-xs ${T.muted}`}>{sub}</div>}
    </div>
  );
}
function Bar({ T, label, value, max, accent = "bg-brand", suffix = "" }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className={T.muted}>{label}</span>
        <span className={`font-semibold ${T.text}`}>{value}{suffix}</span>
      </div>
      <div className={`h-2.5 w-full overflow-hidden rounded-full ${T.subtle}`}>
        <div className={`h-full rounded-full ${accent}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
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
function AdminPage({ T, S, store, state }) {
  const [tab, setTab] = useState("reports");
  const TABS = [
    { key: "reports", label: S.pr8.reports, icon: BarChart3 },
    { key: "structure", label: S.pr7.hierarchy, icon: Building2 },
    { key: "staff", label: S.pr7.staffMatrix, icon: Users },
    { key: "security", label: S.pr10.inviteTitle, icon: Shield },
    { key: "devices", label: S.pr7.devices, icon: Radio },
    { key: "audit", label: S.pr7.auditSearch, icon: ScrollText },
    { key: "archive", label: S.pr13.archiveTitle, icon: Archive },
    { key: "sessions", label: S.pr13.sessionsTitle, icon: Monitor },
  ];
  return (
    <div className="space-y-4">
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
      {tab === "audit" && (
        <div className="space-y-4">
          <BreakGlassReview T={T} S={S} store={store} state={state} />
          <AuditLog T={T} S={S} state={state} />
        </div>
      )}
      {tab === "archive" && <ArchiveManagement T={T} S={S} store={store} state={state} />}
      {tab === "sessions" && <SessionManagement T={T} S={S} store={store} state={state} />}
    </div>
  );
}

// Hospital → Unit → Room → Bed tree with live device status per bed.
function HierarchyTree({ T, S, state }) {
  const units = state.structure.units;
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <h3 className={`mb-1 flex items-center gap-2 font-bold ${T.heading}`}>
        <Building2 size={18} /> {S.pr7.hierarchy}
      </h3>
      <p className={`mb-4 text-sm ${T.muted}`}>{state.structure.tenant} · {state.structure.site}</p>
      <div className="space-y-3">
        {units.map((u) => {
          const rooms = u.rooms || [];
          const unitBeds = state.beds.filter((b) => b.unitId === u.id);
          return (
            <div key={u.id} className={`rounded-xl border ${T.border} ${T.subtle} p-3`}>
              <div className={`mb-2 flex items-center gap-2 font-semibold ${T.text}`}>
                <Network size={15} className="text-brand" /> {u.name}
                <span className={`ml-auto text-xs font-normal ${T.faint}`}>{rooms.length} {S.pr7.room} · {unitBeds.length} {S.pr7.beds}</span>
              </div>
              <div className="space-y-2 pl-4">
                {rooms.map((r) => {
                  const roomBeds = unitBeds.filter((b) => b.roomId === r.id);
                  return (
                    <div key={r.id}>
                      <div className={`mb-1 flex items-center gap-1.5 text-sm font-medium ${T.muted}`}>
                        <DoorOpen size={14} /> {r.label}
                      </div>
                      <div className="flex flex-wrap gap-1.5 pl-5">
                        {roomBeds.length === 0 && <span className={`text-xs ${T.faint}`}>—</span>}
                        {roomBeds.map((b) => {
                          const dev = state.devices?.find((d) => d.bedId === b.id && d.connected);
                          const occ = b.state === "OCCUPIED";
                          return (
                            <span key={b.id}
                              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ${occ ? "bg-brand/10 text-brand" : `${T.chip}`}`}>
                              {S.pr7.bed} {b.label}
                              {dev
                                ? <Radio size={11} className="animate-pulse text-emerald-500" />
                                : occ && <WifiOff size={11} className={T.faint} />}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Visual staff → bed assignment matrix (rows = staff, columns = beds).
function StaffMatrix({ T, S, store, state }) {
  const staff = state.users.filter((u) => u.role === ROLE.ATTENDING || u.role === ROLE.CHARGE_NURSE);
  const beds = state.beds;
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <h3 className={`mb-1 flex items-center gap-2 font-bold ${T.heading}`}>
        <Users size={18} /> {S.pr7.staffMatrix}
      </h3>
      <p className={`mb-4 text-sm ${T.muted}`}>{S.pr7.staffMatrixInfo}</p>
      {staff.length === 0 ? (
        <div className={`text-sm ${T.faint}`}>{S.pr7.noStaff}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={`sticky left-0 z-10 ${T.card} px-2 py-1.5 text-left font-semibold ${T.muted}`}>{S.pr7.staff}</th>
                {beds.map((b) => (
                  <th key={b.id} className={`px-1 py-1.5 text-center font-medium ${T.faint}`} title={`${b.unitName} · ${b.roomLabel}`}>
                    {b.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => {
                const a = state.staffAssignments?.[u.id] || { bedIds: [], unitIds: [] };
                return (
                  <tr key={u.id} className={`border-t ${T.border}`}>
                    <td className={`sticky left-0 z-10 ${T.card} px-2 py-1.5`}>
                      <div className={`font-semibold ${T.text}`}>{u.full_name}</div>
                      <div className={`text-[10px] ${T.faint}`}>{S.roleName[u.role]}</div>
                      {a.unitIds?.length > 0 && (
                        <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-brand/10 px-1.5 py-0.5 text-[9px] font-semibold text-brand">
                          <Network size={9} /> {S.pr7.wholeUnit}
                        </span>
                      )}
                    </td>
                    {beds.map((b) => {
                      const viaUnit = a.unitIds?.includes(b.unitId);
                      const direct = a.bedIds?.includes(b.id);
                      const on = viaUnit || direct;
                      return (
                        <td key={b.id} className="p-0.5 text-center">
                          <button
                            disabled={viaUnit}
                            onClick={() => store.toggleStaffBed({ userId: u.id, bedId: b.id })}
                            title={b.label}
                            className={`h-7 w-7 rounded-md transition ${
                              viaUnit ? "cursor-not-allowed bg-brand/40" :
                              direct ? "bg-brand text-white hover:bg-brand/80" :
                              `${T.subtle} hover:ring-2 hover:ring-brand/40`
                            }`}>
                            {on ? <Check size={13} className="mx-auto" /> : ""}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Mindray / GE bedside-monitor simulator admin — add device & assign to a bed.
// Düzenlenebilir cihaz satırı — IP, Port, Protokol (HL7 / IEEE 11073) ve seri numarası.
function DeviceRow({ T, S, store, state, d, occupiedBeds }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ vendor: d.vendor, model: d.model, ip: d.ip, port: d.port ?? "", protocol: d.protocol, serial: d.serial || "" });
  const [err, setErr] = useState("");
  const start = () => { setF({ vendor: d.vendor, model: d.model, ip: d.ip, port: d.port ?? "", protocol: d.protocol, serial: d.serial || "" }); setErr(""); setEdit(true); };
  const save = () => { try { store.updateDevice({ deviceId: d.id, ...f }); setErr(""); setEdit(false); } catch (ex) { setErr(ex.message); } };

  if (edit) {
    return (
      <div className={`space-y-2 px-3 py-3 ${T.subtle}`}>
        {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}
        <div className="grid grid-cols-2 gap-2">
          <select className={`${inputCls(T)} py-1.5 text-xs`} value={f.vendor} onChange={(e) => setF((s) => ({ ...s, vendor: e.target.value }))}>
            <option value="Mindray">Mindray</option><option value="GE Healthcare">GE Healthcare</option>
            <option value="Philips">Philips</option><option value="Dräger">Dräger</option>
          </select>
          <input className={`${inputCls(T)} py-1.5 text-xs`} placeholder={S.pr7.model} value={f.model} onChange={(e) => setF((s) => ({ ...s, model: e.target.value }))} />
          <input className={`${inputCls(T)} py-1.5 text-xs`} placeholder="192.168.1.50" value={f.ip} onChange={(e) => setF((s) => ({ ...s, ip: e.target.value }))} />
          <input className={`${inputCls(T)} py-1.5 text-xs`} placeholder={S.pr8.devicePort} value={f.port} onChange={(e) => setF((s) => ({ ...s, port: e.target.value }))} />
          <input className={`${inputCls(T)} py-1.5 text-xs`} placeholder={S.pr7.protocol} value={f.protocol} onChange={(e) => setF((s) => ({ ...s, protocol: e.target.value }))} />
          <input className={`${inputCls(T)} py-1.5 text-xs`} placeholder={S.pr8.deviceSerial} value={f.serial} onChange={(e) => setF((s) => ({ ...s, serial: e.target.value }))} />
        </div>
        <div className="flex gap-2">
          <button onClick={save} className={`${btnCls(T, "primary")} flex-1 py-1.5 text-xs`}><Check size={14} /> {S.pr8.saveDevice}</button>
          <button onClick={() => setEdit(false)} className={`${btnCls(T, "ghost")} py-1.5 text-xs`}><X size={14} /> {S.pr8.cancelEdit}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${d.connected ? "bg-emerald-500/15 text-emerald-500" : `${T.subtle} ${T.faint}`}`}>
        {d.connected ? <Radio size={17} className="animate-pulse" /> : <WifiOff size={17} />}
      </div>
      <div className="min-w-0">
        <div className={`truncate text-sm font-semibold ${T.text}`}>{d.vendor} {d.model}</div>
        <div className={`truncate text-xs ${T.faint}`}>{d.ip}:{d.port ?? "—"} · {d.protocol}</div>
        {d.serial && <div className={`truncate text-[10px] ${T.faint}`}>{S.pr8.deviceSerial}: {d.serial}</div>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div className="text-right">
          <select value={d.bedId || ""} onChange={(e) => store.assignDeviceToBed({ deviceId: d.id, bedId: e.target.value })}
            className={`${inputCls(T)} mb-1 py-1 text-xs`}>
            <option value="">{S.pr7.unassigned}</option>
            {occupiedBeds.map((b) => <option key={b.id} value={b.id}>{S.pr7.bed} {b.label}</option>)}
          </select>
          {d.connected
            ? <div className="text-[10px] font-semibold text-emerald-500">{S.pr7.live} · {d.packets} {S.pr7.packets}</div>
            : <div className={`text-[10px] ${T.faint}`}>{S.pr7.disconnected}</div>}
        </div>
        <button onClick={start} title={S.pr8.editDevice} className={`grid h-8 w-8 place-items-center rounded-lg ${T.ghost}`}><Pencil size={14} /></button>
      </div>
    </div>
  );
}

function DeviceAdmin({ T, S, store, state }) {
  const occupiedBeds = state.beds.filter((b) => b.state === "OCCUPIED");
  const [f, setF] = useState({ vendor: "Mindray", model: "BeneVision N17", ip: "", port: "6002", protocol: "HL7 / IEEE 11073", serial: "", bedId: "" });
  const [err, setErr] = useState("");
  const submit = (e) => {
    e.preventDefault();
    try { store.addDevice(f); setF({ vendor: "Mindray", model: "", ip: "", port: "6002", protocol: "HL7 / IEEE 11073", serial: "", bedId: "" }); setErr(""); }
    catch (ex) { setErr(ex.message); }
  };
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
        <h3 className={`mb-1 flex items-center gap-2 font-bold ${T.heading}`}><Radio size={18} /> {S.pr7.addDevice}</h3>
        <p className={`mb-4 text-sm ${T.muted}`}>{S.pr7.deviceInfo}</p>
        {err && <div className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
        <form onSubmit={submit} className="space-y-3">
          <Field T={T} label={S.pr7.vendor}>
            <select className={inputCls(T)} value={f.vendor} onChange={(e) => setF((s) => ({ ...s, vendor: e.target.value }))}>
              <option value="Mindray">Mindray</option><option value="GE Healthcare">GE Healthcare</option>
              <option value="Philips">Philips</option><option value="Dräger">Dräger</option>
            </select>
          </Field>
          <Field T={T} label={S.pr7.model}><input className={inputCls(T)} value={f.model} placeholder="BeneVision N17" onChange={(e) => setF((s) => ({ ...s, model: e.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field T={T} label={S.pr7.ipAddress}><input className={inputCls(T)} value={f.ip} placeholder="192.168.1.50" onChange={(e) => setF((s) => ({ ...s, ip: e.target.value }))} /></Field>
            <Field T={T} label={S.pr8.devicePort} hint={S.pr8.portRange}><input className={inputCls(T)} value={f.port} placeholder="6002" onChange={(e) => setF((s) => ({ ...s, port: e.target.value }))} /></Field>
          </div>
          <Field T={T} label={S.pr7.protocol}><input className={inputCls(T)} value={f.protocol} onChange={(e) => setF((s) => ({ ...s, protocol: e.target.value }))} /></Field>
          <Field T={T} label={S.pr8.deviceSerial}><input className={inputCls(T)} value={f.serial} placeholder="MR-N17-000421" onChange={(e) => setF((s) => ({ ...s, serial: e.target.value }))} /></Field>
          <Field T={T} label={S.pr7.assignToBed}>
            <select className={inputCls(T)} value={f.bedId} onChange={(e) => setF((s) => ({ ...s, bedId: e.target.value }))}>
              <option value="">{S.pr7.unassigned}</option>
              {occupiedBeds.map((b) => <option key={b.id} value={b.id}>{b.unitName} · {S.pr7.bed} {b.label}</option>)}
            </select>
          </Field>
          <button type="submit" className={`${btnCls(T, "primary")} w-full`}><Plus size={16} /> {S.pr7.addDevice}</button>
        </form>
      </div>

      <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
        <h3 className={`mb-4 flex items-center gap-2 font-bold ${T.heading}`}><Network size={18} /> {S.pr7.devices}</h3>
        {(!state.devices || state.devices.length === 0) ? (
          <div className={`text-sm ${T.faint}`}>{S.pr7.noDevices}</div>
        ) : (
          <div className={`divide-y ${T.divide} rounded-xl border ${T.border}`}>
            {state.devices.map((d) => (
              <DeviceRow key={d.id} T={T} S={S} store={store} state={state} d={d} occupiedBeds={occupiedBeds} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Break-glass emergency-access review workflow (approve / reject with note).
function BreakGlassReview({ T, S, store, state }) {
  const bg = state.breakGlass;
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const review = (approve) => { try { store.reviewBreakGlass({ approve, note }); setNote(""); setErr(""); } catch (ex) { setErr(ex.message); } };
  const statusUi = {
    pending: { text: "text-amber-500", label: S.pr7.bgPending },
    approved: { text: "text-emerald-500", label: S.pr7.bgApproved },
    rejected: { text: "text-red-500", label: S.pr7.bgRejected },
  };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <h3 className={`mb-1 flex items-center gap-2 font-bold ${T.heading}`}><ShieldCheck size={18} /> {S.pr7.breakGlassReview}</h3>
      {!bg ? (
        <p className={`mt-2 text-sm ${T.faint}`}>{S.pr7.bgNone}</p>
      ) : (
        <div className={`mt-3 rounded-xl border ${T.border} ${T.subtle} p-4`}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div><div className={`text-[10px] font-semibold uppercase ${T.faint}`}>{S.pr7.bgActivatedBy}</div><div className={`text-sm ${T.text}`}>{bg.by}{bg.role ? ` · ${S.roleName[bg.role] || bg.role}` : ""}</div></div>
            <div><div className={`text-[10px] font-semibold uppercase ${T.faint}`}>{S.pr7.bgStatus}</div><div className={`text-sm font-semibold ${(statusUi[bg.reviewStatus] || {}).text || T.text}`}>{(statusUi[bg.reviewStatus] || {}).label || bg.reviewStatus}</div></div>
          </div>
          <div className="mt-3"><div className={`text-[10px] font-semibold uppercase ${T.faint}`}>{S.pr7.bgReason}</div><div className={`text-sm ${T.text}`}>{bg.reason}</div></div>
          {bg.reviewNote && <div className="mt-2 text-xs italic text-brand">“{bg.reviewNote}”</div>}
          {bg.reviewStatus === "pending" && (
            <div className="mt-4 space-y-2">
              {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
              <input className={inputCls(T)} placeholder={S.pr7.bgReviewNote} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => review(true)} className={`${btnCls(T, "primary")} flex-1`}><Check size={15} /> {S.pr7.bgApprove}</button>
                <button onClick={() => review(false)} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-500 hover:bg-red-500/25`}><X size={15} /> {S.pr7.bgReject}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Küçük merkezi modal kabuğu — kullanıcı eylemleri (parola/PIN/birim) için.
function ActionOverlay({ T, title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className={`absolute inset-0 ${T.overlay}`} onClick={onClose} />
      <div className={`relative w-full max-w-sm rounded-2xl border ${T.border} ${T.card} p-5 shadow-2xl`}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className={`font-bold ${T.heading}`}>{title}</h4>
          <button onClick={onClose} className={`grid h-8 w-8 place-items-center rounded-lg ${T.ghost}`}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Tek bir kullanıcı satırı + tam yönetim eylemleri menüsü (parola sıfırlama, geçici PIN,
// aktif/pasif, MFA yönetimi, birim & vardiya erişimi).
function UserRow({ T, S, store, state, u }) {
  const units = state.structure.units;
  const [modal, setModal] = useState(null); // "password" | "pin" | "units" | "role"
  const [pw, setPw] = useState("");
  const [pinResult, setPinResult] = useState("");
  const [copied, setCopied] = useState(false);
  const [selUnits, setSelUnits] = useState(u.unitIds || []);
  const [selRole, setSelRole] = useState(u.role);
  const [err, setErr] = useState("");
  const wrap = (fn) => { try { fn(); setErr(""); } catch (ex) { setErr(ex.message); } };
  const active = u.active !== false;

  const doRole = () => wrap(() => { store.setUserRole({ userId: u.id, role: selRole }); setModal(null); });
  const doPassword = () => wrap(() => { store.setUserPassword({ userId: u.id, password: pw }); setModal(null); setPw(""); });
  const doPin = () => wrap(() => { const pin = store.resetUserPin({ userId: u.id }); setPinResult(pin); setModal("pin"); });
  const doUnits = () => wrap(() => { store.setUserUnits({ userId: u.id, unitIds: selUnits }); setModal(null); });
  const copyPin = () => { try { navigator.clipboard?.writeText(pinResult); } catch { /* ignore */ } setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const toggleUnit = (id) => setSelUnits((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <div className={`truncate text-sm font-semibold ${T.text}`}>{u.full_name}</div>
          <div className={`truncate text-xs ${T.faint}`}>{u.email}</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${T.chip}`}>{S.roleName[u.role]}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"}`}>
            {active ? S.pr8.activeYes : S.pr8.passiveNo}
          </span>
          {u.mfaRequired && <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500">{S.pr8.mfaRequired}</span>}
          {u.mfa && <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">{S.mfa}</span>}
          <Menu T={T} triggerClass={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 ${T.ghost} ${T.sizes.nav}`}
            trigger={<><Settings size={14} /><span className="hidden sm:inline">{S.pr8.userActions}</span><ChevronDown size={13} /></>}>
            {({ close }) => (
              <div className="text-sm">
                <button onClick={() => { setSelRole(u.role); setModal("role"); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><Shield size={14} /> {S.pr12.roleChange}</button>
                <div className={`my-1 border-t ${T.border}`} />
                <button onClick={() => { setModal("password"); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><KeyRound size={14} /> {S.pr8.resetPassword}</button>
                <button onClick={() => { doPin(); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><Lock size={14} /> {S.pr8.setTempPin}</button>
                <button onClick={() => { wrap(() => store.toggleUserActive(u.id)); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><Power size={14} /> {active ? S.pr8.deactivate : S.pr8.activate}</button>
                <div className={`my-1 border-t ${T.border}`} />
                <button onClick={() => { wrap(() => store.resetUserMfa(u.id)); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><ShieldAlert size={14} /> {S.pr8.resetMfa}</button>
                <button onClick={() => { wrap(() => store.setUserMfaRequired({ userId: u.id, required: !u.mfaRequired })); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><ShieldCheck size={14} /> {u.mfaRequired ? S.pr8.mfaEnforceOff : S.pr8.mfaEnforceOn}</button>
                <div className={`my-1 border-t ${T.border}`} />
                <button onClick={() => { setSelUnits(u.unitIds || []); setModal("units"); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><Building2 size={14} /> {S.pr8.unitAccess}</button>
              </div>
            )}
          </Menu>
        </div>
      </div>
      {err && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}

      {modal === "role" && (
        <ActionOverlay T={T} title={S.pr12.roleChangeTitle} onClose={() => setModal(null)}>
          <p className={`mb-2 text-sm ${T.muted}`}>{S.pr12.roleChangeHint}</p>
          <Field T={T} label={S.pr12.roleLabel}>
            <select className={inputCls(T)} value={selRole} onChange={(e) => setSelRole(e.target.value)} autoFocus>
              {Object.values(ROLE).map((r) => (
                <option key={r} value={r}>{S.roleName[r]}</option>
              ))}
            </select>
          </Field>
          {err && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}
          <button onClick={doRole} className={`${btnCls(T, "primary")} mt-3 w-full`}><Check size={15} /> {S.pr12.roleChangeSave}</button>
        </ActionOverlay>
      )}

      {modal === "password" && (
        <ActionOverlay T={T} title={S.pr8.resetPassword} onClose={() => { setModal(null); setPw(""); }}>
          <Field T={T} label={S.pr8.newPasswordLabel}>
            <input type="text" className={inputCls(T)} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </Field>
          {err && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}
          <button onClick={doPassword} className={`${btnCls(T, "primary")} mt-3 w-full`}><Check size={15} /> {S.pr8.resetPassword}</button>
        </ActionOverlay>
      )}

      {modal === "pin" && (
        <ActionOverlay T={T} title={S.pr8.setTempPin} onClose={() => { setModal(null); setPinResult(""); }}>
          <p className={`mb-2 text-sm ${T.muted}`}>{S.pr8.tempPinIssued}</p>
          <div className={`flex items-center justify-between gap-2 rounded-xl border ${T.border} ${T.subtle} px-4 py-3`}>
            <span className={`font-mono text-2xl font-bold tracking-[0.3em] ${T.heading}`}>{pinResult}</span>
            <button onClick={copyPin} className={btnCls(T, "ghost")}><Check size={14} className={copied ? "text-emerald-500" : ""} /> {copied ? S.pr8.copied : S.pr8.copyPin}</button>
          </div>
        </ActionOverlay>
      )}

      {modal === "units" && (
        <ActionOverlay T={T} title={S.pr8.unitAccess} onClose={() => setModal(null)}>
          <p className={`mb-2 text-sm ${T.muted}`}>{S.pr8.selectUnits}</p>
          <div className="space-y-1.5">
            {units.length === 0 && <div className={`text-sm ${T.faint}`}>{S.pr8.noUnits}</div>}
            {units.map((un) => (
              <label key={un.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border ${T.border} ${T.subtle} px-3 py-2 text-sm`}>
                <input type="checkbox" className="h-4 w-4 accent-current text-brand" checked={selUnits.includes(un.id)} onChange={() => toggleUnit(un.id)} />
                <Building2 size={14} /> <span className={T.text}>{un.name}</span>
              </label>
            ))}
          </div>
          <button onClick={doUnits} className={`${btnCls(T, "primary")} mt-3 w-full`}><Check size={15} /> {S.pr8.saveUnits}</button>
        </ActionOverlay>
      )}
    </div>
  );
}

// ================================================================ INVITE & MFA MANAGEMENT (Madde 6)
function InviteManagement({ T, S, store, state }) {
  const [f, setF] = useState({ email: "", fullName: "", role: ROLE.ATTENDING });
  const [err, setErr] = useState("");
  const [mfaModal, setMfaModal] = useState(null); // { userId, email, provisioning, secret } or null

  const submitInvite = (e) => {
    e.preventDefault();
    try {
      store.inviteUser({ email: f.email, fullName: f.fullName, role: f.role });
      setF({ email: "", fullName: "", role: ROLE.ATTENDING });
      setErr("");
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const pendingInvites = state.invites.filter((i) => i.status === "PENDING");

  return (
    <div className="space-y-4">
      {/* Invite form */}
      <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
        <h3 className={`mb-1 flex items-center gap-2 font-bold ${T.heading}`}>
          <Send size={18} /> {S.pr10.inviteTitle}
        </h3>
        <p className={`mb-4 text-sm ${T.muted}`}>E-posta ile davet gönderin</p>
        <form onSubmit={submitInvite} className="space-y-3">
          <Field T={T} label={S.pr10.inviteEmail}>
            <input className={inputCls(T)} type="email" value={f.email}
              onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} />
          </Field>
          <Field T={T} label={S.pr10.inviteFullName}>
            <input className={inputCls(T)} value={f.fullName}
              onChange={(e) => setF((s) => ({ ...s, fullName: e.target.value }))} />
          </Field>
          <Field T={T} label={S.pr10.inviteRole}>
            <select className={inputCls(T)} value={f.role}
              onChange={(e) => setF((s) => ({ ...s, role: e.target.value }))}>
              {Object.values(ROLE).map((r) => (
                <option key={r} value={r}>{S.roleName[r]}</option>
              ))}
            </select>
          </Field>
          {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
          <button type="submit" className={`${btnCls(T, "primary")} w-full`}>
            <Send size={16} /> {S.pr10.inviteButton}
          </button>
        </form>
      </div>

      {/* Pending invites list */}
      {pendingInvites.length > 0 && (
        <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
          <h3 className={`mb-1 flex items-center gap-2 font-bold ${T.heading}`}>
            <Clock size={18} /> {S.pr10.inviteListTitle}
          </h3>
          <div className={`mt-3 divide-y ${T.divide}`}>
            {pendingInvites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex-1">
                  <div className={`font-semibold ${T.text}`}>{inv.fullName}</div>
                  <div className={`text-sm ${T.muted}`}>{inv.email} · {S.roleName[inv.role]}</div>
                  <div className={`text-xs ${T.faint}`}>
                    {S.pr10.inviteStatus[inv.status]} · {new Date(inv.invitedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => store.resendInvite(inv.id)}
                    className={`${btnCls(T, "ghost")} text-xs`}>
                    <RotateCcw size={14} /> {S.pr10.inviteResend}
                  </button>
                  <button onClick={() => store.cancelInvite(inv.id)}
                    className={`${btnCls(T, "danger")} text-xs`}>
                    <XCircle size={14} /> {S.pr10.inviteCancel}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MFA modal (if active) */}
      {mfaModal && (
        <MfaModal T={T} S={S} store={store} mfaModal={mfaModal} onClose={() => setMfaModal(null)} />
      )}
    </div>
  );
}

// MFA setup modal (QR code + verification)
function MfaModal({ T, S, store, mfaModal, onClose }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [verified, setVerified] = useState(false);

  const verify = () => {
    try {
      store.verifyMfa({ userId: mfaModal.userId, code });
      setVerified(true);
      setErr("");
      setTimeout(onClose, 2000);
    } catch (ex) {
      setErr(ex.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className={`w-full max-w-md rounded-2xl border ${T.border} ${T.card} p-6`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className={`font-bold ${T.heading}`}>{S.pr10.mfaSetupTitle}</h3>
          <button onClick={onClose} className={`rounded-lg p-1 ${T.ghost}`}><X size={20} /></button>
        </div>

        {!verified && (
          <>
            <p className={`mb-3 text-sm ${T.muted}`}>{S.pr10.mfaScanQR}</p>
            {/* QR code (placeholder - in production this would be a real QR) */}
            <div className={`mb-4 flex items-center justify-center rounded-xl ${T.subtle} p-6`}>
              <QrCode size={120} className={T.faint} />
            </div>
            <p className={`mb-2 text-xs ${T.faint}`}>Secret: <code>{mfaModal.secret}</code></p>

            <Field T={T} label={S.pr10.mfaEnterCode}>
              <input className={inputCls(T)} type="text" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            </Field>
            {err && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
            <button onClick={verify} className={`${btnCls(T, "primary")} mt-3 w-full`}>
              <Check size={16} /> {S.pr10.mfaVerifyButton}
            </button>
          </>
        )}

        {verified && (
          <div className="flex items-center gap-3 rounded-xl bg-green-500/15 px-4 py-3 text-green-500">
            <CheckCircle2 size={20} /> <span className="font-semibold">{S.pr10.mfaVerified}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function UserAdmin({ T, S, store, state }) {
  const [f, setF] = useState({ full_name: "", email: "", role: ROLE.ATTENDING, password: "" });
  const [err, setErr] = useState("");
  const submit = (e) => { e.preventDefault(); try { store.createUser(f); setF({ full_name: "", email: "", role: ROLE.ATTENDING, password: "" }); setErr(""); } catch (ex) { setErr(ex.message); } };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <h3 className={`mb-1 font-bold ${T.heading}`}>{S.usersSection}</h3>
      <p className={`mb-4 text-sm ${T.muted}`}>{S.createUser}</p>
      <form onSubmit={submit} className="space-y-3">
        <Field T={T} label={S.uName}><input className={inputCls(T)} value={f.full_name} onChange={(e) => setF((s) => ({ ...s, full_name: e.target.value }))} /></Field>
        <Field T={T} label={S.uEmail}><input className={inputCls(T)} value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} /></Field>
        <Field T={T} label={S.uRole}>
          <select className={inputCls(T)} value={f.role} onChange={(e) => setF((s) => ({ ...s, role: e.target.value }))}>
            {Object.values(ROLE).map((r) => <option key={r} value={r}>{S.roleName[r]}</option>)}
          </select>
        </Field>
        <Field T={T} label={S.pr12.initialPassword}>
          <input className={inputCls(T)} type="text" placeholder={S.pr12.initialPasswordHint} value={f.password} onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))} />
        </Field>
        {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
        <button type="submit" className={`${btnCls(T, "primary")} w-full`}><Plus size={16} /> {S.addUser}</button>
      </form>
      <div className={`mt-4 text-xs font-semibold uppercase ${T.faint}`}>{S.userList}</div>
      <div className={`mt-2 divide-y ${T.divide} rounded-xl border ${T.border}`}>
        {state.users.map((u) => (
          <UserRow key={u.id} T={T} S={S} store={store} state={state} u={u} />
        ))}
      </div>
    </div>
  );
}

function StructureAdmin({ T, S, store, state }) {
  const units = state.structure.units;
  const [unitName, setUnitName] = useState(""); const [unitType, setUnitType] = useState("ADULT_ICU");
  const [roomUnit, setRoomUnit] = useState(units[0]?.id || ""); const [roomName, setRoomName] = useState("");
  const [bedUnit, setBedUnit] = useState(units[0]?.id || ""); const [bedRoom, setBedRoom] = useState(""); const [bedLabel, setBedLabel] = useState("");
  const [err, setErr] = useState("");
  const bedUnitRooms = units.find((u) => u.id === bedUnit)?.rooms || [];
  const wrap = (fn) => { try { fn(); setErr(""); } catch (ex) { setErr(ex.message); } };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <h3 className={`mb-1 font-bold ${T.heading}`}>{S.structureSection}</h3>
      <p className={`mb-4 text-sm ${T.muted}`}>{S.adminSub}</p>
      {err && <div className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}

      {/* add unit */}
      <div className={`mb-3 rounded-xl border ${T.border} ${T.subtle} p-3`}>
        <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.addUnit}</div>
        <div className="flex flex-wrap gap-2">
          <input className={`${inputCls(T)} flex-1`} placeholder={S.unitName} value={unitName} onChange={(e) => setUnitName(e.target.value)} />
          <select className={inputCls(T)} value={unitType} onChange={(e) => setUnitType(e.target.value)}>
            <option value="ADULT_ICU">{S.unitAdult}</option><option value="NICU">{S.unitNicu}</option>
          </select>
          <button onClick={() => wrap(() => { store.addUnit({ name: unitName, type: unitType }); setUnitName(""); })} className={btnCls(T, "primary")}><Plus size={15} /></button>
        </div>
      </div>

      {/* add room */}
      <div className={`mb-3 rounded-xl border ${T.border} ${T.subtle} p-3`}>
        <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.addRoom}</div>
        <div className="flex flex-wrap gap-2">
          <select className={inputCls(T)} value={roomUnit} onChange={(e) => setRoomUnit(e.target.value)}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input className={`${inputCls(T)} flex-1`} placeholder={S.roomName} value={roomName} onChange={(e) => setRoomName(e.target.value)} />
          <button onClick={() => wrap(() => { store.addRoom({ unitId: roomUnit, label: roomName }); setRoomName(""); })} className={btnCls(T, "primary")}><Plus size={15} /></button>
        </div>
      </div>

      {/* add bed */}
      <div className={`rounded-xl border ${T.border} ${T.subtle} p-3`}>
        <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.addBed}</div>
        <div className="flex flex-wrap gap-2">
          <select className={inputCls(T)} value={bedUnit} onChange={(e) => { setBedUnit(e.target.value); setBedRoom(""); }}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className={inputCls(T)} value={bedRoom} onChange={(e) => setBedRoom(e.target.value)}>
            <option value="">{S.selectRoom}</option>
            {bedUnitRooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <input className={`${inputCls(T)} flex-1`} placeholder={S.bedLabel} value={bedLabel} onChange={(e) => setBedLabel(e.target.value)} />
          <button onClick={() => wrap(() => { store.addBed({ unitId: bedUnit, roomId: bedRoom, label: bedLabel }); setBedLabel(""); })} className={btnCls(T, "primary")}><Plus size={15} /></button>
        </div>
      </div>

      {/* structure summary */}
      <div className="mt-4 space-y-2">
        {units.map((u) => {
          const unitBeds = state.beds.filter((b) => b.unitId === u.id);
          return (
            <div key={u.id} className={`rounded-lg ${T.subtle} px-3 py-2 text-sm`}>
              <div className="flex items-center justify-between">
                <span className={`font-semibold ${T.text}`}><Building2 size={14} className="mr-1.5 inline" />{u.name}</span>
                <span className={`text-xs ${T.faint}`}>{(u.rooms || []).length} {S.room} · {unitBeds.length} {S.bed}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* PR#8 · bed operations — durum yönetimi (Boş / Dolu / Dezenfeksiyonda / Teknik Arızalı / Kullanım Dışı) */}
      <div className="mt-5">
        <div className={`mb-2 flex items-center gap-2 text-xs font-semibold uppercase ${T.faint}`}><Bed size={14} /> {S.pr8.bedOps}</div>
        <div className={`divide-y ${T.divide} rounded-xl border ${T.border}`}>
          {state.beds.map((b) => <BedStateRow key={b.id} T={T} S={S} store={store} bed={b} />)}
        </div>
      </div>
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
function BedStateRow({ T, S, store, bed }) {
  const [err, setErr] = useState("");
  const occupied = bed.state === "OCCUPIED";
  const change = (e) => { try { store.setBedState({ bedId: bed.id, state: e.target.value }); setErr(""); } catch (ex) { setErr(ex.message); } };
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
      <Bed size={15} className={T.faint} />
      <span className={`font-semibold ${T.text}`}>{bed.unitName ? `${bed.unitName} · ` : ""}{S.bed} {bed.label}</span>
      <span className={`ml-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${BED_STATE_BADGE[bed.state] || T.chip}`}>
        {S.pr8.bedStateLabels[bed.state] || bed.state}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {occupied ? (
          <span className={`inline-flex items-center gap-1 text-[11px] ${T.faint}`}><Lock size={12} /> {S.pr8.occupiedLock}</span>
        ) : (
          <select value={bed.state} onChange={change} className={`${inputCls(T)} py-1 text-xs`}>
            {BED_ADMIN_STATES.map((s) => <option key={s} value={s}>{S.pr8.bedStateLabels[s] || s}</option>)}
          </select>
        )}
      </div>
      {err && <div className="w-full rounded-lg bg-red-500/15 px-3 py-1.5 text-xs text-red-500">{err}</div>}
    </div>
  );
}

// ================================================================ PR#6 · shared clinical UI
// KVKK name masking helper — applied at the render layer so the store keeps the real synthetic name.
function maskedName(state, name) {
  return state && state.maskNames && name ? maskName(name) : name;
}
function news2Level(score) {
  if (score >= 7) return { text: "text-red-500", ring: "ring-red-500/50" };
  if (score >= 5) return { text: "text-amber-500", ring: "ring-amber-500/50" };
  return { text: "text-emerald-500", ring: "ring-emerald-500/40" };
}
function News2Pill({ S, vitals }) {
  if (!vitals) return null;
  const score = computeNews2(vitals);
  const lv = news2Level(score);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${lv.ring} ${lv.text}`}>
      <TrendingUp size={13} /> {S.pr6.news2}: {score}
    </span>
  );
}
// Lightweight inline SVG sparkline (no chart library needed).
function Sparkline({ points, stroke = "currentColor", height = 26 }) {
  if (!points || points.length < 2) return null;
  const w = 120;
  const min = Math.min(...points), max = Math.max(...points);
  const span = (max - min) || 1;
  const step = w / (points.length - 1);
  const d = points.map((v, i) =>
    `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
function Section({ T, icon: Icon, title, children }) {
  return (
    <div className="mb-3">
      <div className={`mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${T.faint}`}>
        {Icon && <Icon size={13} />} {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}
function Row({ T, children }) {
  return <div className={`flex items-center gap-2 rounded-lg ${T.subtle} px-2.5 py-1.5`}>{children}</div>;
}
function Empty({ T, text }) {
  return <div className={`rounded-lg border border-dashed ${T.border} px-3 py-2 text-center text-xs ${T.faint}`}>{text}</div>;
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
function PatientCockpit({ T, S, state, store, patientId, onClose, lang }) {
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
              <h2 className={`truncate text-lg font-bold ${T.heading}`}>{maskedName(state, p.display_name)}</h2>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${ru.ring} ${ru.text}`}>
                <span className={`h-2 w-2 rounded-full ${ru.dot}`} /> {S.risk[p.risk]}
              </span>
              <BranchProfileBadge S={S} lang={lang} profile={profile} />
            </div>
            <div className={`mt-0.5 truncate text-xs ${T.faint}`}>
              {p.bedLabel} · {S.mrn} {p.mrn} · {S.protocolNo} {p.protocolNo} · {ageText(p, S)} · {losText(p.admittedAtMs, S)}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <News2Pill S={S} vitals={p.vitals} />
            <button onClick={onClose} className={`grid h-9 w-9 place-items-center rounded-lg ${T.ghost}`} title={S.close || "Kapat"}><X size={18} /></button>
          </div>
        </div>
        {/* iki sütunlu gövde */}
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
          {/* SOL — izlem */}
          <div className="space-y-4">
            <div className={`rounded-xl border ${T.border} ${T.subtle} p-3`}>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: profile.accent }} />
                <span className={`text-xs font-semibold ${T.heading}`}>{profile.names[lang] || profile.names.tr}</span>
                <span className={`ml-auto text-[11px] ${T.faint}`}>{S.pr14.clinicalFocus}: {profile.focus[lang] || profile.focus.tr}</span>
              </div>
              <div className={`text-[11px] ${profile.mode === "comfort" ? "text-emerald-500" : T.muted}`}>
                {profile.mode === "comfort" ? S.pr14.comfortMode : S.pr14.standardMode}
              </div>
            </div>
            <div>
              <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.vitals}</div>
              <VitalsGrid T={T} vitals={p.vitals} />
            </div>
            <div>
              <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.pr14.trendTitle}</div>
              <MultiTrendChart T={T} S={S} hist={rec.vitalHistory} medications={rec.medications} />
            </div>
            <div>
              <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.pr14.fluidTimeline}</div>
              <FluidBalanceTimeline T={T} S={S} fluids={rec.fluids} />
            </div>
            <div>
              <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.pr14.medTimeline}</div>
              <MedicationTimeline T={T} S={S} medications={rec.medications} />
            </div>
            <div>
              <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.careTeamLabel}</div>
              <div className={`space-y-1 rounded-xl border ${T.border} ${T.subtle} p-3 text-sm`}>
                <div className="flex justify-between"><span className={T.muted}>{S.attending}</span><span className={`font-semibold ${T.text}`}>{userName(team.attendingId)}</span></div>
                <div className="flex justify-between"><span className={T.muted}>{S.nurse}</span><span className={`font-semibold ${T.text}`}>{userName(team.nurseId)}</span></div>
              </div>
            </div>
          </div>
          {/* SAĞ — klinik veri girişi (satır içi düzenlenebilir) */}
          <div className={`rounded-xl border ${T.border} ${T.subtle} p-3`}>
            <ClinicalModule T={T} S={S} store={store} state={state} patientId={patientId} lang={lang} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Full clinical data-entry module (physician): diagnoses, drugs/infusions, procedures, fluid balance,
// mini vital trends, NEWS2, per-patient thresholds and one-click epicrisis/handover report.
function ClinicalModule({ T, S, store, state, patientId, lang }) {
  const p = state.patients.find((x) => x.patient_id === patientId);
  const rec = state.clinical[patientId] || { diagnoses: [], medications: [], procedures: [], fluids: [],
    thresholds: { ...DEFAULT_THRESHOLDS }, vitalHistory: [] };
  const [thOpen, setThOpen] = useState(false);
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

  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className={`text-xs font-semibold uppercase ${T.faint}`}>{S.pr6.clinicalModule}</div>
        <News2Pill S={S} vitals={p?.vitals} />
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => setThOpen(true)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${T.ghost}`}>
            <Sliders size={13} /> {S.pr6.thresholds}
          </button>
          <button onClick={() => printEpicrisis(S, p, rec, state)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${T.primary}`}>
            <FileText size={13} /> {S.pr6.epicrisis}
          </button>
        </div>
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

      {thOpen && <ThresholdModal T={T} S={S} store={store} state={state} patientId={patientId} onClose={() => setThOpen(false)} />}
    </div>
  );
}

function ThresholdModal({ T, S, store, state, patientId, onClose }) {
  const rec = state.clinical[patientId];
  const [th, setTh] = useState({ ...DEFAULT_THRESHOLDS, ...(rec?.thresholds || {}) });
  const [err, setErr] = useState("");
  const upd = (k, v) => setTh((s) => ({ ...s, [k]: Number(v) }));
  const save = () => { try { store.setThresholds({ patientId, thresholds: th }); onClose(); } catch (ex) { setErr(ex.message); } };
  const fields = [["spo2Min", S.pr6.spo2Min], ["hrMin", S.pr6.hrMin], ["hrMax", S.pr6.hrMax], ["mapMin", S.pr6.mapMin], ["mapMax", S.pr6.mapMax]];
  return (
    <ModalShell T={T} title={S.pr6.thresholdSettings} sub={S.pr6.thresholdInfo} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([k, lbl]) => (
          <Field key={k} T={T} label={lbl}><input type="number" className={inputCls(T)} value={th[k]} onChange={(e) => upd(k, e.target.value)} /></Field>
        ))}
      </div>
      {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className={btnCls(T, "ghost")}>{S.cancel}</button>
        <button onClick={save} className={btnCls(T, "primary")}><Check size={16} /> {S.pr6.saveThresholds}</button>
      </div>
    </ModalShell>
  );
}

// One-click epicrisis / handover report → printable window (browser print → PDF). ICD-10 codes and
// active-ingredient names are printed verbatim; the report never contains a machine diagnosis.
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

// Madde 27: Arşiv Yönetimi — arşivlenmiş hastalar listesi + anonimizasyon.
function ArchiveManagement({ T, S, store, state }) {
  const [err, setErr] = useState("");
  const wrap = (fn) => { try { fn(); setErr(""); } catch (ex) { setErr(ex.message); } };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <div className="mb-3 flex items-center gap-2">
        <Archive size={17} className={T.accent} />
        <h3 className={`font-bold ${T.heading}`}>{S.pr13.archiveTitle}</h3>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs ${T.chip}`}>{state.archivedPatients.length} {S.pr13.archived}</span>
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      <div className={`divide-y ${T.divide} rounded-xl border ${T.border}`}>
        {state.archivedPatients.length === 0 && <div className={`px-3 py-6 text-center text-sm ${T.faint}`}>{S.pr13.noArchived}</div>}
        {state.archivedPatients.map((p) => (
          <div key={p.patient_id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className={`truncate font-semibold ${T.text}`}>{p.display_name}</div>
              <div className={`truncate text-xs ${T.faint}`}>{p.mrn} · {new Date(p.archivedAtMs).toLocaleDateString()}</div>
            </div>
            {!p.anonymizedAtMs && (
              <button onClick={() => wrap(() => store.anonymizePatient({ patientId: p.patient_id }))} className={`${btnCls(T, "ghost")} shrink-0 text-xs`}>
                <XCircle size={14} /> {S.pr13.anonymize}
              </button>
            )}
            {p.anonymizedAtMs && <span className={`shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500`}>{S.pr13.anonymized}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Madde 12: Oturum Yönetimi — aktif oturumlar listesi + sonlandırma.
function SessionManagement({ T, S, store, state }) {
  const [err, setErr] = useState("");
  const wrap = (fn) => { try { fn(); setErr(""); } catch (ex) { setErr(ex.message); } };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <div className="mb-3 flex items-center gap-2">
        <Monitor size={17} className={T.accent} />
        <h3 className={`font-bold ${T.heading}`}>{S.pr13.sessionsTitle}</h3>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs ${T.chip}`}>{state.activeSessions.length} {S.pr13.active}</span>
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      <div className={`divide-y ${T.divide} rounded-xl border ${T.border}`}>
        {state.activeSessions.length === 0 && <div className={`px-3 py-6 text-center text-sm ${T.faint}`}>{S.pr13.noSessions}</div>}
        {state.activeSessions.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
            <Monitor size={15} className="shrink-0 text-emerald-500" />
            <div className="min-w-0 flex-1">
              <div className={`truncate font-semibold ${T.text}`}>{s.email}</div>
              <div className={`truncate text-xs ${T.faint}`}>{s.device} · {s.ip} · {new Date(s.startedAtMs).toLocaleString()}</div>
            </div>
            <button onClick={() => wrap(() => store.terminateSession({ sessionId: s.id }))} className={`${btnCls(T, "ghost")} shrink-0 text-xs`}>
              <Power size={14} /> {S.pr13.terminate}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Append-only audit log viewer + search panel (S-15/C2). Text search + action filter + date range.
// Actor names honour the KVKK mask toggle.
function AuditLog({ T, S, state }) {
  const label = (a) => (S.pr6.actions && S.pr6.actions[a]) || a;
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const all = state.auditLog || [];
  // Distinct actions present in the log (for the filter dropdown).
  const actions = useMemo(() => Array.from(new Set(all.map((r) => r.action))), [all]);
  const rows = useMemo(() => {
    const ql = q.trim().toLocaleLowerCase("tr");
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(to).getTime() + 24 * 3600 * 1000 : null; // inclusive end-of-day
    return all.filter((r) => {
      if (action && r.action !== action) return false;
      if (fromMs && r.atMs < fromMs) return false;
      if (toMs && r.atMs > toMs) return false;
      if (ql) {
        const hay = `${label(r.action)} ${r.actor || ""} ${r.target || ""} ${r.detail || ""}`.toLocaleLowerCase("tr");
        if (!hay.includes(ql)) return false;
      }
      return true;
    }).reverse();
  }, [all, q, action, from, to]);
  const clear = () => { setQ(""); setAction(""); setFrom(""); setTo(""); };
  const exportCSV = () => {
    const headers = ["Tarih/Saat", "İşlem", "Kullanıcı", "Rol", "Hedef", "Detay"];
    const csvRows = rows.map((r) => [
      new Date(r.atMs).toLocaleString("tr-TR"),
      label(r.action),
      r.actor || "—",
      r.role || "—",
      r.target || "—",
      (r.detail || "").replace(/"/g, '""'),
    ]);
    const csvContent = [headers, ...csvRows].map((row) => row.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `denetim-kaydi-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} ${T.lift} p-5`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ScrollText size={17} className={T.accent} />
        <h3 className={`font-bold ${T.heading}`}>{S.pr7.auditSearch}</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${T.chip}`}>{rows.length} {S.pr7.resultCount}</span>
        <button onClick={exportCSV} disabled={rows.length === 0} className={`ml-auto inline-flex items-center gap-1.5 ${btnCls(T, "ghost")} disabled:opacity-40 disabled:cursor-not-allowed`}>
          <Download size={14} /> {S.pr13.exportCSV}
        </button>
      </div>
      {/* search + filters */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={14} className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ${T.faint}`} />
          <input className={`${inputCls(T)} pl-8`} placeholder={S.pr7.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={inputCls(T)} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">{S.pr7.allActions}</option>
          {actions.map((a) => <option key={a} value={a}>{label(a)}</option>)}
        </select>
        <input type="date" className={inputCls(T)} value={from} onChange={(e) => setFrom(e.target.value)} aria-label={S.pr7.dateFrom} />
        <input type="date" className={inputCls(T)} value={to} onChange={(e) => setTo(e.target.value)} aria-label={S.pr7.dateTo} />
      </div>
      {(q || action || from || to) && (
        <button onClick={clear} className={`mt-2 inline-flex items-center gap-1.5 text-xs ${T.accent}`}>
          <X size={12} /> {S.pr7.clearFilters}
        </button>
      )}
      <div className={`mt-3 max-h-[28rem] divide-y ${T.divide} overflow-y-auto rounded-xl border ${T.border}`}>
        {rows.length === 0 && <div className={`px-3 py-6 text-center text-sm ${T.faint}`}>{S.pr6.noAudit}</div>}
        {rows.map((r) => (
          <div key={r.id} className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`shrink-0 rounded-md ${T.subtle} px-1.5 py-0.5 text-[11px] font-semibold ${T.muted}`}>{label(r.action)}</span>
              <span className={`truncate text-xs ${T.text}`}>{maskedName(state, r.actor)}</span>
              <span className={`ml-auto shrink-0 text-[10px] tabular-nums ${T.faint}`}>{new Date(r.atMs).toLocaleString()}</span>
            </div>
            {(r.target || r.detail) && <div className={`mt-0.5 truncate text-xs ${T.faint}`}>{r.target ? `${r.target} · ` : ""}{r.detail}</div>}
          </div>
        ))}
      </div>
    </div>
  );
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
export function ClinicalDemo({ store: injectedStore = null }) {
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
  const onEnableNotify = async () => {
    if (typeof Notification === "undefined") return;
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

  // simulated clock: advance escalation for all open alarms.
  useEffect(() => {
    const id = setInterval(() => {
      const st = store.getState();
      if (st.running) store.reconcile(st.clockSec + st.speed * 0.25);
    }, 250);
    return () => clearInterval(id);
  }, [store]);

  // apply dark class for any global dark-mode CSS hooks.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") root.classList.remove("dark"); else root.classList.add("dark");
  }, [theme]);

  // MFA kapısı: şifre doğru ama rol iki adımlı doğrulama gerektiriyor (Madde 6).
  if (state.mfaPending) return <MfaGate T={T} S={S} store={store} pending={state.mfaPending} lang={lang} setLang={setLang} />;
  if (!state.user) return <Login T={T} S={S} store={store} lang={lang} setLang={setLang} />;

  // Kurum kurulum sihirbazı: platform ilk kez kuruluyorsa yönetici girişinde gösterilir (Madde 5).
  if (state.user.role === ROLE.HOSPITAL_ADMIN && !state.tenantSetup) {
    return <SetupWizard T={T} S={S} store={store} lang={lang} setLang={setLang} />;
  }

  // guard: page not permitted for the current role → fall back to board.
  const role = state.user.role;
  const activeItem = NAV_ITEMS.find((i) => i.key === page);
  const effectivePage = activeItem && canSee(activeItem, role) ? page : "board";

  const openTransfer = (pid) => { setTransferPatient(pid); setPage("admission"); };

  return (
    <div className={`flex min-h-screen ${T.app}`}>
      <Sidebar T={T} S={S} state={state} page={effectivePage} setPage={setPage}
        collapsed={collapsed} setCollapsed={setCollapsed} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar T={T} S={S} store={store} state={state} page={effectivePage} lang={lang} setLang={setLang}
          theme={theme} setTheme={setTheme} onMenu={() => setMobileOpen(true)}
          soundOn={soundOn} onEnableSound={onEnableSound} notifyPerm={notifyPerm} onEnableNotify={onEnableNotify}
          onTestPush={onTestPush} />
        {notifyPerm !== "granted" && !notifyBannerDismissed && (
          <div className="flex items-center gap-3 border-b border-brand/30 bg-gradient-to-r from-brand/15 to-cyan-500/10 px-4 py-2.5 text-sm">
            <BellRing className="h-5 w-5 shrink-0 animate-pulse text-brand" />
            <div className="min-w-0 flex-1">
              <div className={`font-semibold ${T.heading}`}>{S.pr8.notifyBannerTitle}</div>
              <div className={`truncate text-xs ${T.faint}`}>{S.pr8.notifyBannerBody}</div>
            </div>
            <button onClick={onEnableNotify}
              className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow hover:opacity-90">
              {S.pr8.notifyBannerEnable}
            </button>
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
        <main className="flex-1 overflow-x-hidden p-4 lg:p-6">
          {effectivePage === "board" && <BedBoard T={T} S={S} state={state} onOpenPatient={setDrawerPatient} lang={lang} />}
          {effectivePage === "admission" && <AdmissionPage T={T} S={S} store={store} state={state}
            preselectTransfer={transferPatient} clearPreselect={() => setTransferPatient(null)} />}
          {effectivePage === "care" && <CareTeamPage T={T} S={S} store={store} state={state} />}
          {effectivePage === "alarms" && <AlarmPage T={T} S={S} store={store} state={state} lang={lang} />}
          {effectivePage === "results" && <ResultsInbox T={T} S={S} store={store} state={state} />}
          {effectivePage === "heatmap" && <HeatmapPage T={T} S={S} store={store} state={state} />}
          {effectivePage === "admin" && <AdminPage T={T} S={S} store={store} state={state} />}
        </main>
      </div>
      {drawerPatient && (
        <PatientDrawer T={T} S={S} state={state} store={store} patientId={drawerPatient} lang={lang}
          onClose={() => setDrawerPatient(null)} onTransfer={openTransfer}
          onExpand={(pid) => { setDrawerPatient(null); setCockpitPatient(pid); }} />
      )}
      {cockpitPatient && (
        <PatientCockpit T={T} S={S} state={state} store={store} patientId={cockpitPatient} lang={lang}
          onClose={() => setCockpitPatient(null)} />
      )}
      <KvkkBanner T={T} S={S} />
    </div>
  );
}

export default ClinicalDemo;

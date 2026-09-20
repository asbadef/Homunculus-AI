// src/clinicalUi.jsx — the shared visual vocabulary and the leaf pieces built on it.
//
// Split out of ClinicalDemo.jsx, which had grown to 4,243 lines and ~60 components in one file.
// Nothing here knows about a patient, an alert or the store's shape: these are the colours, the
// class helpers and the small primitives everything else is assembled from. Keeping them
// separate is what makes the design work in the phase plan possible — a constitution cannot be
// applied to a file nobody can hold in their head.
//
// The colour maps are written out verbatim rather than composed, because Tailwind's JIT scans
// source text: a class name built at runtime is a class name that never ships.

import React, { useEffect, useMemo, useReducer, useState } from "react";
import { Contrast, Monitor, Moon, Sun, X } from "lucide-react";
import { LANGS } from "./clinicalI18n.js";
import { maskName } from "./clinicalDemo.js";

// ---------------------------------------------------------------- shared visual maps
// Fixed, theme-independent accent colours (present verbatim in source so Tailwind JIT keeps them).
export const RISK_UI = {
  stable:   { dot: "bg-emerald-500", text: "text-emerald-500", ring: "ring-emerald-500/40", bar: "bg-emerald-500" },
  low:      { dot: "bg-sky-500",     text: "text-sky-500",     ring: "ring-sky-500/40",     bar: "bg-sky-500" },
  high:     { dot: "bg-amber-500",   text: "text-amber-500",   ring: "ring-amber-500/40",   bar: "bg-amber-500" },
  critical: { dot: "bg-red-500",     text: "text-red-500",     ring: "ring-red-500/60",     bar: "bg-red-500" },
};

export const riskUi = (r) => RISK_UI[r] || RISK_UI.stable;

export const TIER_UI = {
  CRITICAL: { text: "text-red-500",    dot: "bg-red-500",    chip: "bg-red-500/15 text-red-500" },
  HIGH:     { text: "text-amber-500",  dot: "bg-amber-500",  chip: "bg-amber-500/15 text-amber-500" },
  MEDIUM:   { text: "text-yellow-500", dot: "bg-yellow-500", chip: "bg-yellow-500/15 text-yellow-500" },
  LOW:      { text: "text-sky-500",    dot: "bg-sky-500",    chip: "bg-sky-500/15 text-sky-500" },
  INFO:     { text: "text-slate-400",  dot: "bg-slate-400",  chip: "bg-slate-400/15 text-slate-400" },
};

export const tierUi = (t) => TIER_UI[t] || TIER_UI.INFO;

export const THEME_ICON = { icu: Moon, light: Sun, contrast: Contrast, wall: Monitor };

// ---------------------------------------------------------------- small helpers
/**
 * Saniyeyi saat göstergesine çevirir.
 *
 * Bir saati geçince saat alanı açılır: cevapsız bir alarmın süresi "318:30" diye yazıldığında
 * kimse onu beş buçuk saat diye okumuyor — sayı büyüdükçe anlamı kayboluyor. Bir alarmın kaç
 * saattir açık olduğu, alarm yorgunluğunun ölçüldüğü yerde okunması gereken ilk şeydir.
 */
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

export function useStore(store) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => store.subscribe(force), [store]);
  return store.getState();
}

// ---------------------------------------------------------------- generic dropdown menu
export function Menu({ T, triggerClass, trigger, align = "right", children }) {
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
export function Field({ T, label, hint, children }) {
  return (
    <label className="block">
      <div className={`mb-1 font-medium ${T.sizes.label} ${T.muted}`}>{label}</div>
      {children}
      {hint && <div className={`mt-1 text-xs ${T.faint}`}>{hint}</div>}
    </label>
  );
}

export const inputCls = (T) => `w-full rounded-lg border px-3 py-2.5 outline-none transition focus:ring-2 focus:ring-brand/40 ${T.input} ${T.sizes.nav}`;

export function btnCls(T, kind = "primary") {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed";
  const map = { primary: T.primary, ghost: T.ghost, danger: T.danger, warn: T.warn };
  return `${base} ${map[kind] || T.primary} ${T.sizes.nav}`;
}

// PHI on screen: the administrator's name-masking preference decides whether a patient's name
// is shown or reduced. A display concern, so it lives with the other display helpers.
export function maskedName(state, name) {
  return state && state.maskNames && name ? maskName(name) : name;
}

// ---------------------------------------------------------------- brand and flags
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
// Marka işareti: yumuşak köşeli teal→cyan rozet içinde beyaz EKG/nabız çizgisi.
// Tek bir "H" hissi veren dikey vuruşlar + kalp atışı. Kütüphane değil, saf SVG.
export function HomunculusMark({ size = 44, glow = true }) {
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

export function Flag({ code, className = "" }) {
  return (
    <span className={`inline-block overflow-hidden rounded-[3px] ring-1 ring-black/10 ${className}`}>
      {FLAG_SVG[code] || null}
    </span>
  );
}

// Kompakt bayrak dil seçici — giriş ekranı ve gerektiğinde her yerde kullanılabilir.
export function LangPills({ T, lang, setLang }) {
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

// Canlı vitrin sayaç kutusu (giriş marka panelinde).
export function VitrinStat({ value, label }) {
  return (
    <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10 backdrop-blur">
      <div className="text-lg font-black text-white">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium leading-tight text-white/55">{label}</div>
    </div>
  );
}

// ================================================================ BED BOARD
// Canlı EKG / SpO₂ dalga formu — akan yeşil çizgi + nabızla senkron parlama.
// Saf SVG + SMIL animasyonu (harici kütüphane yok); hasta-başı monitör hissi verir.
export function ekgBeatPath(beats, beatW, mid, amp) {
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

export function Waveform({ hr = 80, height = 34, stroke = "#10b981" }) {
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

export function ModalShell({ T, title, sub, onClose, children }) {
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

export function SectionHeader({ T, icon: Icon, title, hint }) {
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

// ================================================================ EXECUTIVE ANALYTICS (§PR8)
// Canlı KPI'lar, alarm kalitesi ve cihaz sağlığı — hepsi computeAnalytics(state) saf fonksiyonundan.
export function KpiCard({ T, icon: Icon, label, value, sub, accent = "text-brand" }) {
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

export function Bar({ T, label, value, max, accent = "bg-brand", suffix = "" }) {
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

// Küçük merkezi modal kabuğu — kullanıcı eylemleri (parola/PIN/birim) için.
export function ActionOverlay({ T, title, onClose, children }) {
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

// Lightweight inline SVG sparkline (no chart library needed).
export function Sparkline({ points, stroke = "currentColor", height = 26 }) {
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

/**
 * Katlanabilir bölüm — kapalıyken bile konuşur.
 *
 * Klinik bir ekranda "neyin önemli olduğu" sabit değildir: vazopresör alan hastada ilaç
 * satırı, sepsis şüphesi işaretlenmiş hastada sepsis kutusu, kritik sonucu olan hastada
 * sonuçlar önemlidir. Bu yüzden `defaultOpen` sabit bir tercih değil, **hastanın durumundan
 * hesaplanan** bir değerdir; çağıran onu duruma göre verir.
 *
 * `summary` katlamanın bedelini öder: kapalı bir bölüm boş bir başlık değildir, içindekinin
 * tek satırlık özetini taşır ("Noradrenalin 0,08"). Bilgiyi gizleyen değil, sıkıştıran bir
 * katlama; açmak ayrıntı içindir, varlığını öğrenmek için değil.
 */
export function Collapsible({ T, icon: Icon, title, summary, defaultOpen = false, tone, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const toneCls = tone === "alert" ? "text-red-500" : tone === "warn" ? "text-amber-500" : T.faint;
  return (
    <div className={`rounded-xl border ${T.border} ${open ? T.subtle : ""}`}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        {Icon && <Icon size={14} className={`shrink-0 ${toneCls}`} />}
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${T.faint}`}>{title}</span>
        {!open && summary && (
          <span className={`min-w-0 flex-1 truncate text-xs ${T.muted}`}>{summary}</span>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className={`ml-auto shrink-0 transition ${T.faint} ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function Section({ T, icon: Icon, title, children }) {
  return (
    <div className="mb-3">
      <div className={`mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${T.faint}`}>
        {Icon && <Icon size={13} />} {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export function Row({ T, children }) {
  return <div className={`flex items-center gap-2 rounded-lg ${T.subtle} px-2.5 py-1.5`}>{children}</div>;
}

export function Empty({ T, text }) {
  return <div className={`rounded-lg border border-dashed ${T.border} px-3 py-2 text-center text-xs ${T.faint}`}>{text}</div>;
}

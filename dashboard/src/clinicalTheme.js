// src/clinicalTheme.js — theme engine for the clinical workspace.
// Four production-grade skins selectable at runtime:
//   • light    → "Gündüz Klinik Modu" (clean white/medical)
//   • icu      → "Gece / Nöbet Modu" (dark, low-brightness night mode; default)
//   • contrast → "Yüksek Kontrast" (WCAG-driven accessibility: pure black/white + bold rings)
//   • wall     → "Duvar Ekranı / Wallboard" (very high-contrast, oversized type for distant reading)
// Every token is a full Tailwind class string so the JIT scanner (content: ./src/**/*.{js,jsx})
// keeps them in the build. Components consume semantic tokens (T.card, T.text …) instead of
// hard-coding slate colours, which is what makes all four skins possible from one component tree.

export const THEME_KEYS = ["light", "icu", "contrast", "wall"];

// i18n-independent, machine keys; display names come from clinicalI18n (theme.icu / theme.light …).
export const THEMES = {
  // ---------------------------------------------------------------- Dark ICU (default)
  icu: {
    key: "icu",
    app: "bg-slate-950 text-slate-100",
    // Gece nöbeti: sağ üstten inen soluk teal parıltı — koğuş karanlığında ekranın
    // düz siyah bir dikdörtgen olmasını engeller, parlaklığı artırmaz.
    decor: "bg-[radial-gradient(1200px_600px_at_88%_-12%,rgba(13,148,136,0.12),transparent_62%)]",
    sidebar: "bg-slate-900 border-slate-800",
    topbar: "bg-slate-900/95 border-slate-800",
    card: "bg-slate-900 ring-1 ring-slate-800",
    cardRing: "ring-slate-800",
    hoverRing: "hover:ring-brand/50",
    subtle: "bg-slate-800",
    chip: "bg-slate-800 text-slate-300",
    border: "border-slate-800",
    divide: "divide-slate-800",
    text: "text-slate-100",
    muted: "text-slate-400",
    faint: "text-slate-500",
    heading: "text-slate-100",
    input: "bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500",
    navActive: "bg-brand/15 text-brand ring-1 ring-brand/30",
    navIdle: "text-slate-400 hover:bg-slate-800 hover:text-slate-100",
    primary: "bg-brand text-white hover:bg-brand/90",
    ghost: "border border-slate-700 text-slate-200 hover:bg-slate-800",
    danger: "bg-sev-critical text-white hover:opacity-90",
    warn: "bg-amber-500 text-slate-900 hover:bg-amber-400",
    vitalCell: "bg-slate-950/60 ring-1 ring-slate-800",
    overlay: "bg-black/70 backdrop-blur-sm",
    glass: "bg-slate-900/60 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl shadow-black/40",
    glassSubtle: "bg-white/5 backdrop-blur-md ring-1 ring-white/10",
    hero: "bg-gradient-to-br from-slate-900 via-slate-900 to-brand/20",
    anim: "transition-all duration-200 ease-out",
    lift: "transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40",
    accent: "text-brand",
    sizes: { vital: "text-xl", name: "text-base", label: "text-xs", nav: "text-sm" },
  },
  // ---------------------------------------------------------------- Light Medical
  light: {
    key: "light",
    app: "bg-slate-100 text-slate-900",
    decor: "bg-[radial-gradient(1000px_520px_at_100%_-8%,rgba(13,148,136,0.09),transparent_60%)]",
    sidebar: "bg-white border-slate-200",
    topbar: "bg-white/95 border-slate-200",
    card: "bg-white ring-1 ring-slate-200 shadow-sm",
    cardRing: "ring-slate-200",
    hoverRing: "hover:ring-brand/40",
    subtle: "bg-slate-100",
    chip: "bg-slate-100 text-slate-600",
    border: "border-slate-200",
    divide: "divide-slate-200",
    text: "text-slate-900",
    muted: "text-slate-500",
    faint: "text-slate-400",
    heading: "text-slate-900",
    input: "bg-white border-slate-300 text-slate-900 placeholder-slate-400",
    navActive: "bg-brand/10 text-brand ring-1 ring-brand/20",
    navIdle: "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
    primary: "bg-brand text-white hover:bg-brand/90",
    ghost: "border border-slate-300 text-slate-700 hover:bg-slate-100",
    danger: "bg-sev-critical text-white hover:opacity-90",
    warn: "bg-amber-500 text-white hover:bg-amber-600",
    vitalCell: "bg-slate-50 ring-1 ring-slate-200",
    overlay: "bg-slate-900/40 backdrop-blur-sm",
    glass: "bg-white/70 backdrop-blur-xl ring-1 ring-slate-900/5 shadow-xl shadow-slate-300/40",
    glassSubtle: "bg-white/60 backdrop-blur-md ring-1 ring-slate-900/5",
    hero: "bg-gradient-to-br from-white via-white to-brand/10",
    anim: "transition-all duration-200 ease-out",
    lift: "transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-300/50",
    accent: "text-brand",
    sizes: { vital: "text-xl", name: "text-base", label: "text-xs", nav: "text-sm" },
  },
  // ---------------------------------------------------------------- Wall Display
  wall: {
    key: "wall",
    app: "bg-black text-white",
    // Duvar ekranı: uzaktan bakıldığında panonun nerede bittiğini gösteren soğuk vurgu.
    decor: "bg-[radial-gradient(1100px_620px_at_50%_-18%,rgba(34,211,238,0.10),transparent_65%)]",
    sidebar: "bg-neutral-950 border-neutral-800",
    topbar: "bg-black border-neutral-800",
    card: "bg-neutral-950 ring-2 ring-neutral-700",
    cardRing: "ring-neutral-700",
    hoverRing: "hover:ring-cyan-400/60",
    subtle: "bg-neutral-900",
    chip: "bg-neutral-900 text-neutral-200",
    border: "border-neutral-800",
    divide: "divide-neutral-800",
    text: "text-white",
    muted: "text-neutral-300",
    faint: "text-neutral-400",
    heading: "text-white",
    input: "bg-neutral-900 border-neutral-700 text-white placeholder-neutral-500",
    navActive: "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400/40",
    navIdle: "text-neutral-300 hover:bg-neutral-900 hover:text-white",
    primary: "bg-cyan-500 text-black hover:bg-cyan-400",
    ghost: "border border-neutral-700 text-neutral-100 hover:bg-neutral-900",
    danger: "bg-red-600 text-white hover:bg-red-500",
    warn: "bg-amber-400 text-black hover:bg-amber-300",
    vitalCell: "bg-black ring-2 ring-neutral-700",
    overlay: "bg-black/80 backdrop-blur-sm",
    glass: "bg-neutral-950/70 backdrop-blur-md ring-2 ring-white/10 shadow-2xl shadow-black/60",
    glassSubtle: "bg-white/5 backdrop-blur-md ring-1 ring-white/10",
    hero: "bg-gradient-to-br from-black via-neutral-950 to-cyan-500/10",
    anim: "transition-all duration-200 ease-out",
    lift: "transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-black/60",
    accent: "text-cyan-300",
    // Oversized type so names/labels read from across the nurses' station. Vitals stay at xl so
    // 3-digit (HR 112) and decimal (Temp 36.8) values never clip inside the compact bed-card cells.
    sizes: { vital: "text-xl", name: "text-2xl", label: "text-sm", nav: "text-base" },
  },
  // ---------------------------------------------------------------- High Contrast (accessibility, WCAG)
  // Pure black background, pure white text, bright yellow primary + bold rings/borders so the UI
  // stays legible for low-vision users and under harsh clinical lighting. Distinct from `wall`
  // (which is about oversized distant-reading type, not maximal contrast).
  contrast: {
    key: "contrast",
    app: "bg-black text-white",
    // Yüksek kontrast: dekor YOK. Zemindeki her ek ton, bu temanın var olma sebebi
    // olan kontrast oranını düşürür.
    decor: "",
    sidebar: "bg-black border-white",
    topbar: "bg-black border-white",
    card: "bg-black ring-2 ring-white",
    cardRing: "ring-white",
    hoverRing: "hover:ring-yellow-300",
    subtle: "bg-neutral-900",
    chip: "bg-white text-black",
    border: "border-white",
    divide: "divide-white",
    text: "text-white",
    muted: "text-neutral-200",
    faint: "text-neutral-300",
    heading: "text-white",
    input: "bg-black border-2 border-white text-white placeholder-neutral-400",
    navActive: "bg-yellow-300 text-black ring-2 ring-yellow-300 font-bold",
    navIdle: "text-white underline-offset-4 hover:bg-white hover:text-black hover:underline",
    primary: "bg-yellow-300 text-black font-bold hover:bg-yellow-200 ring-2 ring-yellow-300",
    ghost: "border-2 border-white text-white hover:bg-white hover:text-black",
    danger: "bg-red-600 text-white font-bold hover:bg-red-500 ring-2 ring-red-400",
    warn: "bg-amber-400 text-black font-bold hover:bg-amber-300",
    vitalCell: "bg-black ring-2 ring-white",
    overlay: "bg-black/85 backdrop-blur-sm",
    glass: "bg-black/90 backdrop-blur-md ring-2 ring-white shadow-2xl shadow-black/80",
    glassSubtle: "bg-black ring-2 ring-white",
    hero: "bg-gradient-to-br from-black via-black to-yellow-300/10",
    anim: "transition-all duration-200 ease-out",
    lift: "transition-all duration-200 ease-out hover:-translate-y-0.5",
    accent: "text-yellow-300",
    sizes: { vital: "text-xl", name: "text-base", label: "text-xs", nav: "text-sm" },
  },
};

export function getTheme(key) {
  return THEMES[key] || THEMES.icu;
}

const STORAGE_KEY = "homunculus-theme";
export function storedTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return THEME_KEYS.includes(v) ? v : "icu";
  } catch {
    return "icu";
  }
}
export function persistTheme(key) {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* ignore */
  }
}

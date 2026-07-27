// src/i18n.js — UI string localization. Turkish (default) + Azerbaijani.
// The `tr` values are byte-identical to the strings the components used before i18n, so the default
// language reproduces the exact prior UI (and keeps the existing tests green). Clinical alert text
// (summary / reasoning / actions) comes from the engine and is not translated here.
const STRINGS = {
  tr: {
    langLabel: "Dil:",
    role: "Rol:", nurse: "hemşire", doctor: "doktor",
    notifHistory: "Bildirim geçmişi", noNotifs: "Henüz bildirim yok.",
    escalated: "Eskale", selectPatient: "Bir hasta seçin.", noPatients: "Hasta yok.",
    reason: "Gerekçe:", recommended: "Önerilen:", source: "Kaynak:", confidence: "Güven:",
    ack: "Onayla", acked: "Onaylandı:", chronic: "Beklenen (kronik)",
    escBadge: "ESKALE EDİLDİ", stale: "Bayat veri:", noAlerts: "Aktif uyarı yok.",
    toastEsc: "Eskalasyon", toastNew: "Yeni uyarı", close: "kapat",
    demoLoading: "Demo yükleniyor…", demoBanner: "DEMO · sentetik veri",
    risk: { none: "Stabil", low: "Düşük", high: "Yüksek", critical: "Kritik" },
  },
  az: {
    langLabel: "Dil:",
    role: "Rol:", nurse: "tibb bacısı", doctor: "həkim",
    notifHistory: "Bildiriş tarixçəsi", noNotifs: "Hələ bildiriş yoxdur.",
    escalated: "Eskalasiya", selectPatient: "Bir xəstə seçin.", noPatients: "Xəstə yoxdur.",
    reason: "Əsas:", recommended: "Tövsiyə:", source: "Mənbə:", confidence: "Etibar:",
    ack: "Təsdiqlə", acked: "Təsdiqləndi:", chronic: "Gözlənilən (xroniki)",
    escBadge: "ESKALASİYA EDİLDİ", stale: "Köhnə məlumat:", noAlerts: "Aktiv xəbərdarlıq yoxdur.",
    toastEsc: "Eskalasiya", toastNew: "Yeni xəbərdarlıq", close: "bağla",
    demoLoading: "Demo yüklənir…", demoBanner: "DEMO · sintetik məlumat",
    risk: { none: "Stabil", low: "Aşağı", high: "Yüksək", critical: "Kritik" },
  },
};

// [value, label] pairs for the language selector.
export const LANGS = [["tr", "Türkçe"], ["az", "Azərbaycan"]];

export function strings(lang) {
  return STRINGS[lang] || STRINGS.tr;
}

// Read/write the persisted language choice (falls back to "tr" in environments without localStorage).
export function storedLang() {
  try {
    return localStorage.getItem("homunculus-lang") || "tr";
  } catch {
    return "tr";
  }
}
export function persistLang(lang) {
  try {
    localStorage.setItem("homunculus-lang", lang);
  } catch {
    /* ignore */
  }
}

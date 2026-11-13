// src/live/auth/legalPages.js — the prototype's legal and support pages (privacy, terms, data
// notice, cookies, support), run as they are: public/legal/legal.js is the prototype's legal.js,
// unchanged. It talks to a global `H`; this file gives it the few parts it uses (t, addT, esc, icon,
// flagBox, LANGS, state, data) and loads it once, on the first link pressed.
//
// The prototype's support form only thanks the user and sends nothing. On a live system that would
// tell someone their report reached IT when it did not, so its thank-you is replaced (seeded before
// legal.js, whose addT never overwrites a key) by a line that says to call IT.
import { ICONS } from "../ui/icons.js";
import { flagSvg } from "../ui/Flag.jsx";

const SCRIPT = "/legal/legal.js";
const LANGS = [["AZ", "Azərbaycan"], ["TR", "Türkçe"], ["RU", "Русский"], ["EN", "English"]];

const HONEST = {
  lgl_f_thx_h: { AZ: "Bildiriş hələ göndərilmir", TR: "Bildirim henüz gönderilmiyor", RU: "Сообщение пока не отправляется", EN: "Reports are not sent yet" },
  lgl_f_thx_p: {
    AZ: "Bu forma hələ heç yerə qoşulmayıb. Problemi birbaşa xəstəxananın İT şöbəsinə bildirin.",
    TR: "Bu form henüz hiçbir yere bağlı değil. Sorunu doğrudan hastanenin bilgi işlem birimine bildirin.",
    RU: "Эта форма пока никуда не подключена. Сообщите о проблеме напрямую в ИТ-отдел больницы.",
    EN: "This form is not connected yet. Please report the problem to the hospital IT department directly.",
  },
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const kebab = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const iconSvg = (name) => {
  const shapes = ICONS[name] || ICONS.grid;
  const body = shapes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${kebab(k)}="${esc(v)}"`).join(" ")}/>`).join("");
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
};

let loading = null;
let onLangChange = () => {};

function shim(hospital) {
  if (window.H && window.H.__live) return window.H;
  const T = { ...HONEST };
  const H = {
    __live: true,
    state: { lang: "AZ" },
    data: { hospital: { name: hospital } },
    LANGS,
    TR: "TR",
    esc,
    t: (k) => (T[k] && (T[k][H.state.lang] || T[k].TR)) || k,
    addT: (dict) => { Object.keys(dict).forEach((k) => { if (!T[k]) T[k] = dict[k]; }); },
    icon: (k) => iconSvg(k),
    flagBox: (l, cls = "") => `<span class="flagbox ${cls}" style="display:inline-block;width:22px;height:15px;border-radius:3px;overflow:hidden;vertical-align:middle">${flagSvg(l)}</span>`,
    savePref: () => {},
    // legal.js calls this on close when its own language menu changed the language.
    renderApp: () => onLangChange(H.state.lang.toLowerCase()),
  };
  window.H = H;
  return H;
}

function load() {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.onload = () => (window.H?.legal ? resolve(window.H.legal) : reject(new Error("legal.js did not register")));
      s.onerror = () => { loading = null; reject(new Error(`could not load ${SCRIPT}`)); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** Opens one page ("privacy" | "terms" | "notice" | "cookies" | "support") in the UI language;
 *  `setLang` follows a language picked inside the pages. */
export async function openLegal(key, { lang, hospital, setLang }) {
  const H = shim(hospital);
  H.state.lang = String(lang).toUpperCase();
  onLangChange = setLang || (() => {});
  const legal = await load();
  legal.open(key);
}

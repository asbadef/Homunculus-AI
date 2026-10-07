// src/LoadFailed.jsx — the page's last resort when a root will not load.
//
// Every root but the first is fetched on demand (main.jsx: the live shell, the design gallery, the
// previous workspace and the simulation). A tablet whose network has gone — or one that was
// installed before a deploy and whose service worker no longer holds the chunk the new index.html
// asks for — can fail that fetch, and React answers a failed lazy import by THROWING during
// render. Without a boundary a ward sees a blank white page: nothing said, nothing to press. It
// also catches anything else the roots throw while rendering, which is a worse failure still and
// deserves the same honest answer rather than nothing at all.
//
// Its four texts live HERE and not in live/i18n/: the dictionary is inside the chunk that has just
// failed to load. They are the only user-visible strings written inside a component in this app,
// and this is why. The language is the one the person chose (live/prefs.js, the same key the live
// UI reads), so the message is in their own — the whole of i18n would have to be in the first
// chunk otherwise.
import React from "react";
import { DEFAULT_LANG, LANG_CODES } from "./live/i18n/langs.js";
import { readPref } from "./live/prefs.js";

const TEXTS = {
  tr: { title: "Sayfa yüklenemedi",
    body: "Bağlantınızı kontrol edip sayfayı yeniden yükleyin. Veriler kaybolmadı.",
    again: "Yeniden yükle" },
  az: { title: "Səhifə yüklənə bilmədi",
    body: "Bağlantınızı yoxlayıb səhifəni yenidən yükləyin. Məlumatlar itməyib.",
    again: "Yenidən yüklə" },
  ru: { title: "Страница не загрузилась",
    body: "Проверьте подключение и перезагрузите страницу. Данные не потеряны.",
    again: "Перезагрузить" },
  en: { title: "The page could not be loaded",
    body: "Check your connection and reload the page. No data has been lost.",
    again: "Reload" },
};

// It wears NO design token: `--page`, `--ink`, `--pri` and the rest are defined in the live UI's
// own stylesheet, which ships with the chunk that has just failed to load, so `bg-page` and
// `text-onpri` would resolve to nothing — a white label on a colourless button, unreadable
// exactly when it is needed. Everything here is laid out with the classes that need no variable
// and coloured with `currentColor`, so it is legible against the page's default and still right
// when the tokens did load (only another root failed).
function Message() {
  const t = TEXTS[readPref("lang", LANG_CODES, DEFAULT_LANG)] ?? TEXTS[DEFAULT_LANG];
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <h1 className="m-0 text-20 font-bold">{t.title}</h1>
      <p className="m-0 max-w-[420px] text-14">{t.body}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{ border: "1px solid currentColor", borderRadius: "10px", background: "transparent", color: "inherit" }}
        className="px-[13px] py-2 text-13 font-semibold"
      >
        {t.again}
      </button>
    </div>
  );
}

/** Wraps the roots. A render that throws is shown as a message with a reload, never as a blank
 *  page; the error itself goes to the console, which is where a support call starts. */
export class LoadBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // Not swallowed: a chunk that will not load and a bug that throws look the same to the ward,
    // and only this line tells them apart afterwards.
    console.error("Homunculus: the page's root could not be rendered", error);   // eslint-disable-line no-console
  }

  render() {
    return this.state.failed ? <Message /> : this.props.children;
  }
}

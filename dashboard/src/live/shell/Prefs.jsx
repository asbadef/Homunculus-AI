// src/live/shell/Prefs.jsx — the language menu and the theme switch: on the top bar and on the
// sign-in screen (the prototype's .lsel and its sun/moon button).
//
// Languages are named by their code and in their own language — no flags: a flag names a country,
// not a language, and the wards speak more than one language of each.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useTheme } from "../theme/ThemeProvider.jsx";
import { Icon } from "../ui/Icon.jsx";
import { FOCUS_RING } from "../ui/focus.js";
import { MenuButton, TOOL_BUTTON } from "./Menu.jsx";

const LANG_BUTTON =
  `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-ctl border border-line bg-card2 px-2.5 font-text text-12.5 font-bold text-ink hover:border-pri ${FOCUS_RING}`;

export function LanguageMenu() {
  const { t, lang, setLang, langs } = useI18n();
  return (
    <MenuButton
      // The name starts with what the button shows ("AZ"), so a voice command that says what it
      // sees reaches it (WCAG 2.5.3, label in name).
      label={`${lang.toUpperCase()} · ${t("prefs.lang")}`}
      buttonClassName={LANG_BUTTON}
      button={(
        <>
          <span className="font-data">{lang.toUpperCase()}</span>
          <Icon name="chevD" size={14} className="text-mute" />
        </>
      )}
      items={langs.map((l) => ({
        key: l.code,
        label: <span lang={l.code}>{l.native} <span className="font-data text-11 text-mute">{l.code.toUpperCase()}</span></span>,
        checked: l.code === lang,
        onSelect: () => setLang(l.code),
      }))}
    />
  );
}

export function ThemeToggle({ className = "" }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const toDay = theme === "gece";
  const label = t(toDay ? "shell.lightTheme" : "shell.darkTheme");
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(toDay ? "gun" : "gece")}
      className={`${TOOL_BUTTON} ${className}`}
    >
      <Icon name={toDay ? "sun" : "moon"} size={19} />
    </button>
  );
}

/** The prototype's mark (.mk) and name. */
export function Brand({ subtitle, className = "" }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl bg-ink font-display text-20 font-bold text-app">h</span>
      <div className="min-w-0">
        <b className="block font-display text-20 font-bold leading-tight">homunculus</b>
        {subtitle ? <small className="block truncate text-12 text-mute">{subtitle}</small> : null}
      </div>
    </div>
  );
}

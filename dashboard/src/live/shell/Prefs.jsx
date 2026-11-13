// src/live/shell/Prefs.jsx — the language menu and the theme switch: on the top bar and on the
// sign-in screen (the prototype's .lsel and its sun/moon button).
//
// Languages are named by their code and in their own language; the prototype's flag sits beside
// the code as decoration (owner, 2026-11-13) — the code and the native name stay the label.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useTheme } from "../theme/ThemeProvider.jsx";
import { Icon } from "../ui/Icon.jsx";
import { Flag } from "../ui/Flag.jsx";
import markUrl from "../assets/homunculus-mark.png";
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
          <Flag code={lang} className="h-[15px] w-[22px]" />
          <span className="font-data">{lang.toUpperCase()}</span>
          <Icon name="chevD" size={14} className="text-mute" />
        </>
      )}
      items={langs.map((l) => ({
        key: l.code,
        label: (
          <span lang={l.code} className="inline-flex items-center gap-2.5">
            <Flag code={l.code} />
            <span>{l.native} <span className="font-data text-11 text-mute">{l.code.toUpperCase()}</span></span>
          </span>
        ),
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

/** The Homunculus mark: the logo's symbol on a transparent ground (assets/homunculus-mark.png). */
export function Mark({ className = "h-10 w-10" }) {
  return <img src={markUrl} alt="" aria-hidden="true" className={`shrink-0 object-contain ${className}`} />;
}

/** The prototype's mark (.mk) and name. */
export function Brand({ subtitle, className = "" }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Mark />
      <div className="min-w-0">
        <b className="block font-display text-20 font-bold leading-tight">homunculus</b>
        {subtitle ? <small className="block truncate text-12 text-mute">{subtitle}</small> : null}
      </div>
    </div>
  );
}

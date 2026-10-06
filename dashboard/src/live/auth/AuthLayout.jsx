// src/live/auth/AuthLayout.jsx — the frame of every screen before the shell: sign-in, the TOTP step,
// the forced password change, the session check. The prototype's .login.lg2 (shell.js authScreen):
// a dark hero on the left (hidden under 861 px), the form on the right, language and theme in the
// corner.
//
// The hero is decoration (aria-hidden; the form's title is the page's h1). It is always dark, as in
// the prototype: it carries data-theme="gece", so it takes the Gece
// tokens whatever the page's theme (contrast-tested there). It shows no invented ward: the
// prototype's animated scene ("REA03 · SpO₂ 86") would put fabricated clinical events on the door
// of a live system.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Icon } from "../ui/Icon.jsx";
import { Brand, LanguageMenu, ThemeToggle } from "../shell/Prefs.jsx";

/** `step`: {current, total} for the "Step 2/3" line, or nothing. */
export function AuthLayout({ step, children }) {
  const { t } = useI18n();
  return (
    <div className="grid min-h-full bg-app font-text text-14.5 text-ink min-[861px]:grid-cols-[1.1fr_1fr]">
      <section
        data-theme="gece"
        aria-hidden="true"
        className="relative hidden flex-col overflow-hidden bg-[radial-gradient(120%_90%_at_10%_0%,color-mix(in_srgb,var(--pri)_25%,var(--page)),var(--page)_60%)] px-12 pb-7 pt-9 text-ink min-[861px]:flex"
      >
        <Brand />
        <div className="my-auto max-w-[540px] py-8">
          <span className="mb-[18px] inline-flex items-center gap-2 rounded-full border border-[color:color-mix(in_srgb,var(--pri)_35%,transparent)] bg-pri-soft px-3 py-1.5 text-12 font-bold text-ink">
            <i className="h-1.5 w-1.5 rounded-full bg-pri" />
            {t("auth.pill")}
          </span>
          <p className="m-0 mb-3 font-display text-40 font-bold leading-[1.08]">{t("auth.headline")}</p>
          <p className="m-0 max-w-[500px] text-mute">{t("auth.lead")}</p>
        </div>
        <div className="flex flex-wrap gap-[18px] border-t border-line pt-3.5 text-12.5 text-mute">
          <span className="flex items-center gap-1.5"><Icon name="shield" size={15} className="text-pri" />{t("auth.trustDecides")}</span>
          <span className="flex items-center gap-1.5"><Icon name="building" size={15} className="text-pri" />{t("auth.trustOnSite")}</span>
        </div>
      </section>
      <div className="relative flex items-center justify-center px-5 py-16">
        <div className="absolute right-5 top-[18px] z-[5] flex items-center gap-2">
          <LanguageMenu />
          <ThemeToggle className="border border-line2 bg-card" />
        </div>
        <main className="w-full max-w-[410px]">
          <Brand className="mb-[22px] min-[861px]:hidden" />
          {step ? (
            <p className="mb-7 flex items-center gap-2 text-11.5 font-bold tracking-[.04em] text-mute">
              {t("auth.step", step)}
              <span aria-hidden="true" className="flex gap-1">
                {Array.from({ length: step.total }, (_, i) => (
                  <em key={i} className={`h-1 w-[18px] rounded-sm ${i < step.current ? "bg-pri" : "bg-line2"}`} />
                ))}
              </span>
            </p>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

/** The step a session is on, for AuthLayout: sign-in is step 1, then TOTP, then the password. */
export function stepOf(phase, steps) {
  const total = 1 + (steps.mfa ? 1 : 0) + (steps.password ? 1 : 0);
  if (total === 1) return undefined;
  if (phase === "mfa") return { current: 2, total };
  if (phase === "password") return { current: total, total };
  return undefined;
}

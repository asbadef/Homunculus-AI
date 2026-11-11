// src/live/auth/AuthLayout.jsx — the frame of every screen before the shell: sign-in, the TOTP step,
// the forced password change, the session check. The prototype's .login.lg2 (shell.js authScreen):
// a dark hero on the left (hidden under 861 px), the form on the right, language and theme in the
// corner.
//
// The hero is decoration (aria-hidden; the form's title is the page's h1). It is always dark, as in
// the prototype: it carries data-theme="gece", so it takes the Gece tokens whatever the page's
// theme (contrast-tested there).
//
// The hero carries a SAMPLE ward preview (sign-in is the product's shop window, not a clinical
// screen). Beds are numbered REA01–08 with NO patient names, and the whole scene wears a
// "Sample view" tag (sceneTag) so no one mistakes it for live data — the honest middle between a
// richer shop window and the earlier concern about fabricated clinical events at a live system's door.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Icon } from "../ui/Icon.jsx";
import { LanguageMenu, ThemeToggle } from "../shell/Prefs.jsx";
import logoUrl from "../assets/homunculus-logo.png";

// The Homunculus wordmark logo. Light-backed PNG, so it sits in a light capsule on the dark hero.
function Logo({ className = "" }) {
  return (
    <img
      src={logoUrl}
      alt="Homunculus"
      className={`h-11 w-auto max-w-[220px] self-start rounded-lg bg-white/95 px-3 py-1.5 ${className}`}
    />
  );
}

// Eight sample beds (no names), one in alarm — the prototype's login scene, de-identified.
const BEDS = [
  { id: "REA01", spo2: 97, w: "0,9 8,7 16,10 24,6 32,8 40,5 48,7 56,6" },
  { id: "REA02", spo2: 95, w: "0,8 8,9 16,7 24,9 32,6 40,8 48,7 56,8" },
  { id: "REA03", spo2: 88, alarm: true, w: "0,5 8,6 16,8 24,9 32,11 40,10 48,13 56,14" },
  { id: "REA04", spo2: 98, w: "0,7 8,6 16,8 24,5 32,7 40,6 48,5 56,6" },
  { id: "REA05", spo2: 96, w: "0,9 8,8 16,6 24,8 32,7 40,9 48,6 56,8" },
  { id: "REA06", spo2: 97, w: "0,7 8,9 16,8 24,6 32,8 40,7 48,9 56,7" },
  { id: "REA07", spo2: 99, w: "0,6 8,5 16,7 24,5 32,6 40,4 48,6 56,5" },
  { id: "REA08", spo2: 96, w: "0,8 8,7 16,9 24,7 32,8 40,6 48,8 56,7" },
];

function SampleScene() {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur">
      <style>{`.hom-spark{stroke-dasharray:140;stroke-dashoffset:140;animation:homDraw 1.5s ease forwards}@keyframes homDraw{to{stroke-dashoffset:0}}@media (prefers-reduced-motion:reduce){.hom-spark{animation:none;stroke-dashoffset:0}}`}</style>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-11.5 font-semibold text-mute">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          {t("auth.sceneCap")}
        </span>
        <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-10.5 font-bold uppercase tracking-wider text-mute">
          {t("auth.sceneTag")}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {BEDS.map((b, i) => (
          <div
            key={b.id}
            className={`rounded-lg border px-2 py-2 ${b.alarm ? "border-red-400/50 bg-red-500/10" : "border-white/10 bg-white/[0.03]"}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-10.5 font-bold text-ink/80">{b.id}</span>
              <span className={`h-1.5 w-1.5 rounded-full ${b.alarm ? "bg-red-400 animate-pulse" : "bg-emerald-400"}`} />
            </div>
            <svg viewBox="0 0 56 16" preserveAspectRatio="none" aria-hidden="true" className="mt-1.5 h-4 w-full">
              <polyline
                points={b.w}
                fill="none"
                stroke={b.alarm ? "#f87171" : "#5eead4"}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="hom-spark"
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            </svg>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className={`text-17 font-bold ${b.alarm ? "text-red-300" : "text-ink"}`}>{b.spo2}</span>
              <span className="text-10 text-mute">SpO₂</span>
            </div>
          </div>
        ))}
      </div>
      {/* Escalation strip — the motor's 3 / 5 min steps, shown as a flow, not live events. */}
      <div className="mt-3 flex items-center gap-1.5 text-10.5">
        {[
          { label: t("auth.escNurse"), at: "00:00", on: true },
          { label: t("auth.escCharge"), at: "+3 dk" },
          { label: t("auth.escDoctor"), at: "+5 dk" },
        ].map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && <span className="h-px flex-1 bg-white/15" />}
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-semibold ${s.on ? "border-red-400/40 bg-red-500/10 text-red-300" : "border-white/12 bg-white/[0.03] text-mute"}`}>
              {s.label} <span className="opacity-70">{s.at}</span>
            </span>
          </React.Fragment>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-10.5 font-semibold text-red-300">
        <Icon name="bell" size={12} />{t("auth.escNotified")}
      </div>
    </div>
  );
}

/** `step`: {current, total} for the "Step 2/3" line, or nothing. */
export function AuthLayout({ step, children }) {
  const { t } = useI18n();
  const footLinks = [
    ["footPrivacy", "/gizlilik"],
    ["footTerms", "/kosullar"],
    ["footKvkk", "/aydinlatma"],
    ["footContact", "/iletisim"],
  ];
  return (
    <div className="grid min-h-full bg-app font-text text-14.5 text-ink min-[861px]:grid-cols-[1.1fr_1fr]">
      <section
        data-theme="gece"
        aria-hidden="true"
        className="relative hidden flex-col overflow-hidden bg-[radial-gradient(120%_90%_at_10%_0%,color-mix(in_srgb,var(--pri)_25%,var(--page)),var(--page)_60%)] px-12 pb-7 pt-9 text-ink min-[861px]:flex"
      >
        <Logo />
        <div className="my-auto max-w-[540px] py-6">
          <span className="mb-[18px] inline-flex items-center gap-2 rounded-full border border-[color:color-mix(in_srgb,var(--pri)_35%,transparent)] bg-pri-soft px-3 py-1.5 text-12 font-bold text-ink">
            <i className="h-1.5 w-1.5 rounded-full bg-pri" />
            {t("auth.pill")}
          </span>
          <p className="m-0 mb-3 font-display text-40 font-bold leading-[1.08]">{t("auth.headline")}</p>
          <p className="m-0 mb-5 max-w-[500px] text-mute">{t("auth.lead")}</p>
          <SampleScene />
        </div>
        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 border-t border-line pt-3.5 text-12.5 text-mute">
          <span className="flex items-center gap-1.5"><Icon name="shield" size={15} className="text-pri" />{t("auth.trustDecides")}</span>
          <span className="flex items-center gap-1.5"><Icon name="building" size={15} className="text-pri" />{t("auth.trustOnSite")}</span>
          <span className="flex-1" />
          {footLinks.map(([key, href]) => (
            <a key={key} href={href} className="hover:text-ink hover:underline">{t(`auth.${key}`)}</a>
          ))}
        </div>
      </section>
      <div className="relative flex items-center justify-center px-5 py-16">
        <div className="absolute right-5 top-[18px] z-[5] flex items-center gap-2">
          <LanguageMenu />
          <ThemeToggle className="border border-line2 bg-card" />
        </div>
        <main className="w-full max-w-[410px]">
          <Logo className="mb-[22px] min-[861px]:hidden" />
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

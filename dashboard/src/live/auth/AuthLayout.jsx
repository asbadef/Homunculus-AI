// src/live/auth/AuthLayout.jsx — the frame of every screen before the shell: sign-in, the TOTP step,
// the forced password change, the session check. A copy of the prototype's .login.lg2
// (shell.js authScreen + ek.css .lg2/.lg-scene rules): the hero on the left (hidden under 861 px),
// the form on the right, language and theme in the corner. The hero follows the page theme, as in
// the prototype (Gün: light gradient with a dot grid; Gece: dark with blurred glows).
//
// The hero is decoration (aria-hidden; the form's title is the page's h1). Its ward preview is a
// SAMPLE: beds REA01–08 with NO patient names, and the scene wears a "Sample view" tag (sceneTag)
// so no one mistakes it for live data at a live system's door.
import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Icon } from "../ui/Icon.jsx";
import { FOCUS_RING } from "../ui/focus.js";
import { LanguageMenu, ThemeToggle } from "../shell/Prefs.jsx";
import logoUrl from "../assets/homunculus-logo.png";
import { openLegal } from "./legalPages.js";

// The prototype's social icons (sosyal.js): no accounts yet, so every one is faded and inert.
const SOCIAL = [
  ["WhatsApp", '<path d="M20 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.2A8.5 8.5 0 1 1 20 11.5Z"/><path d="M9 8.5c.3 2.6 2.4 4.9 5 5.5l1.2-1.2 1.8.8-.4 1.6c-3.8.2-7.8-3.6-7.6-7.6l1.6-.4.8 1.8Z"/>'],
  ["Instagram", '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>'],
  ["YouTube", '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10 9 5 3-5 3Z"/>'],
  ["LinkedIn", '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/>'],
  ["X", '<path d="M4 4l16 16M20 4 4 20"/>'],
  ["Web", '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'],
];

const CSS = `
.hom-auth{--hx:#e8eef7}
.hom-hero{position:relative;isolation:isolate;overflow:hidden;background:#050b16;color:#e8eef7}
.hom-bg{position:absolute;inset:0;z-index:-1;overflow:hidden}
.hom-bg i{position:absolute;border-radius:50%;filter:blur(60px);opacity:.55;animation:homFloat 18s ease-in-out infinite alternate}
.hom-bg i:nth-child(1){width:420px;height:420px;left:-120px;top:-140px;background:#0e7490}
.hom-bg i:nth-child(2){width:360px;height:360px;right:-140px;top:30%;background:#1d4ed8;opacity:.35;animation-duration:23s}
.hom-bg i:nth-child(3){width:300px;height:300px;left:20%;bottom:-160px;background:#22b8d6;opacity:.25;animation-duration:27s}
@keyframes homFloat{to{transform:translate(40px,30px) scale(1.08)}}
.hom-mk{width:44px;height:44px;border-radius:13px;flex:none;background:#fff no-repeat 20% center;background-size:auto 150%;box-shadow:0 8px 18px rgba(14,116,144,.25)}
.hom-brand b{font:700 20px "Space Grotesk",system-ui,sans-serif;display:block;line-height:1.2}
.hom-brand small{font-size:12px;color:#8fa1ba}
.hom-pill{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;border:1px solid rgba(125,211,230,.35);background:rgba(34,184,214,.08);color:#7dd3e6;font-weight:700;font-size:12px;margin-bottom:18px}
.hom-pill i{width:6px;height:6px;border-radius:50%;background:currentColor}
.hom-h1{margin:0 0 12px;font:700 clamp(30px,3.2vw,46px)/1.1 "Space Grotesk",system-ui,sans-serif}
.hom-rot{color:#7dd3e6;display:inline-block}
.hom-rot.in{animation:homRot .45s ease-out}
@keyframes homRot{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.hom-lead{color:#a9bccf;max-width:500px;margin:0 0 22px}
.hom-scene{background:rgba(4,10,20,.78);backdrop-filter:blur(10px);border:1px solid #1f3150;border-radius:20px;padding:14px;box-shadow:0 24px 60px rgba(0,0,0,.45);max-width:600px}
.hom-sch{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:12px;color:#8fa1ba;margin-bottom:10px;gap:8px}
.hom-dot{width:7px;height:7px;border-radius:50%;background:#22e05a;animation:homDot 1.6s ease-out infinite}
@keyframes homDot{0%{box-shadow:0 0 0 0 rgba(34,224,90,.6)}100%{box-shadow:0 0 0 8px rgba(34,224,90,0)}}
.hom-tag{border:1px solid #1f3150;border-radius:999px;padding:1px 8px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}
.hom-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.hom-bed{background:#07101f;border:1px solid #1c2c45;border-radius:12px;padding:8px 9px 7px;transition:border-color .4s,box-shadow .4s,background .4s}
.hom-no{display:flex;justify-content:space-between;align-items:center}.hom-no b{font:700 11.5px "JetBrains Mono",ui-monospace,monospace;color:#a9bccf}
.hom-no i{width:7px;height:7px;border-radius:50%;background:#22c55e;transition:background .4s}
.hom-bed svg{width:100%;height:22px;display:block;margin:4px 0 2px}
.hom-bed polyline{fill:none;stroke:#22b8d6;stroke-width:1.6;vector-effect:non-scaling-stroke;opacity:.75;transition:stroke .4s}
.hom-v{display:flex;justify-content:space-between;align-items:baseline}.hom-v small{font-weight:700;font-size:9.5px;color:#5b6f8a}.hom-v b{font:700 16px "JetBrains Mono",ui-monospace,monospace;color:#ffe14a;transition:color .4s}
.hom-bed.warn{border-color:#eab308}.hom-bed.warn .hom-no i{background:#eab308}.hom-bed.warn polyline{stroke:#eab308}
.hom-bed.crit{border-color:#ef4444;background:#1a0a0e;animation:homCrit 1s steps(2,jump-none) infinite}.hom-bed.crit .hom-no i{background:#ef4444}.hom-bed.crit polyline{stroke:#ef4444}.hom-bed.crit .hom-v b{color:#fca5a5}
@keyframes homCrit{0%{box-shadow:0 0 0 1px #ef4444,0 0 22px rgba(239,68,68,.45)}100%{box-shadow:none}}
.hom-bed.ok{border-color:#22c55e}.hom-bed.ok .hom-v b{color:#86efac}
.hom-chain{display:flex;align-items:center;gap:6px;margin-top:12px}
.hom-ln{flex:1;height:2px;background:#1c2c45;border-radius:2px}
.hom-st{display:flex;align-items:center;gap:8px;padding:7px 10px 7px 7px;border-radius:999px;border:1px solid #1c2c45;background:#07101f;transition:all .35s;white-space:nowrap}
.hom-st .ic{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#0f1b2e;color:#5b6f8a;transition:all .35s}
.hom-st b{font-weight:700;font-size:12px;color:#8fa1ba}.hom-st small{font:10.5px "JetBrains Mono",ui-monospace,monospace;color:#5b6f8a}
.hom-st.on{border-color:#ef4444;background:#1a0a0e}.hom-st.on .ic{background:#ef4444;color:#fff;box-shadow:0 0 0 5px rgba(239,68,68,.18)}.hom-st.on b{color:#fff}
.hom-st.done{border-color:#1f6b3a}.hom-st.done .ic{background:#16a34a;color:#fff}.hom-st.done b{color:#86efac}
.hom-cap{margin-top:12px;font-weight:700;font-size:14px;color:#a9bccf;min-height:20px}
.hom-cap.in{animation:homRot .4s ease-out}.hom-cap.c{color:#fca5a5}.hom-cap.g{color:#86efac}
.hom-trust{display:flex;gap:18px;flex-wrap:wrap;font-size:12.5px;color:#8fa1ba;border-top:1px solid rgba(143,161,186,.15);padding-top:14px}
.hom-trust span{display:flex;align-items:center;gap:6px}.hom-trust svg{color:#22c55e}
[data-theme="gun"] .hom-hero{background:linear-gradient(135deg,#e9f4f8 0%,#f5f8fb 55%,#eaf2fb 100%);color:var(--ink)}
[data-theme="gun"] .hom-bg{background-image:radial-gradient(rgba(14,116,144,.14) 1px,transparent 1px);background-size:26px 26px}
[data-theme="gun"] .hom-bg i{opacity:.18}
[data-theme="gun"] .hom-brand small,[data-theme="gun"] .hom-trust{color:var(--mute)}
[data-theme="gun"] .hom-lead{color:#4a5b6e}
[data-theme="gun"] .hom-pill{color:#0e7490;border-color:rgba(14,116,144,.3);background:#fff}
[data-theme="gun"] .hom-rot{color:#0e7490}
[data-theme="gun"] .hom-scene{background:#fff;border-color:#e1e6ee;box-shadow:0 24px 60px rgba(20,30,50,.12)}
[data-theme="gun"] .hom-sch{color:var(--mute)}[data-theme="gun"] .hom-tag{border-color:#e1e6ee}
[data-theme="gun"] .hom-bed,[data-theme="gun"] .hom-st{background:#f6f8fb;border-color:#e1e6ee}[data-theme="gun"] .hom-no b{color:var(--ink)}[data-theme="gun"] .hom-v b{color:#a16207}
[data-theme="gun"] .hom-bed.crit,[data-theme="gun"] .hom-st.on{background:#fdecec}[data-theme="gun"] .hom-st.on b{color:#b91c1c}[data-theme="gun"] .hom-st .ic{background:#e9eef5}
[data-theme="gun"] .hom-st.done .ic{background:#16a34a}[data-theme="gun"] .hom-st.on .ic{background:#ef4444}
[data-theme="gun"] .hom-cap{color:var(--ink)}[data-theme="gun"] .hom-cap.c{color:#b91c1c}[data-theme="gun"] .hom-cap.g{color:#15803d}[data-theme="gun"] .hom-ln{background:#e1e6ee}
[data-theme="gun"] .hom-trust{border-color:#e1e6ee}
@keyframes homUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes homShake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(3px)}30%,50%,70%{transform:translateX(-6px)}40%,60%{transform:translateX(6px)}}
@keyframes homSweep{to{transform:translateX(100%)}}
.hom-form>*{animation:homUp .45s ease-out both}
.hom-form>*:nth-child(2){animation-delay:.06s}.hom-form>*:nth-child(3){animation-delay:.1s}.hom-form>*:nth-child(n+4){animation-delay:.16s}
.hom-hero>*{animation:homUp .6s ease-out both}.hom-hero>*:nth-child(3){animation-delay:.12s}.hom-hero>*:nth-child(4){animation-delay:.24s}
.hom-shake{animation:homShake .42s cubic-bezier(.36,.07,.19,.97)}
.hom-go{position:relative;overflow:hidden;transition:transform .12s,box-shadow .2s,filter .2s}
.hom-go:hover{box-shadow:0 10px 24px color-mix(in srgb,var(--pri) 35%,transparent);filter:brightness(1.05)}
.hom-go:active{transform:scale(.985)}
.hom-go svg{transition:transform .2s}.hom-go:hover svg{transform:translateX(3px)}
.hom-go::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.28) 50%,transparent 65%);transform:translateX(-100%);pointer-events:none}
.hom-go:hover::after{animation:homSweep .8s ease-out}
.hom-form input:not([type=checkbox]){transition:border-color .15s,box-shadow .15s,background .15s}
.hom-form label[for]{text-transform:uppercase;letter-spacing:.06em;font-size:11.5px;font-weight:700}
.hom-form label[for] [aria-hidden]{display:none}
.hom-form input:not([type=checkbox]){border-radius:12px}
@media (max-height:820px){.hom-bed svg{display:none}.hom-chain{margin-top:8px}}
@media (max-width:1250px){.hom-st small{display:none}}
@media (prefers-reduced-motion:reduce){.hom-bg i,.hom-dot,.hom-bed.crit,.hom-rot.in,.hom-cap.in,.hom-form>*,.hom-hero>*,.hom-shake,.hom-go:hover::after{animation:none}.hom-go,.hom-go svg{transition:none}}
`;

// Eight sample beds (no names) with a 12-point wave each — the prototype's SC_BEDS.
const BEDS = [96, 94, 97, 98, 95, 97, 99, 96].map((v, k) => ({
  id: `REA0${k + 1}`,
  v,
  pts: Array.from({ length: 12 }, (_, x) => `${((x / 11) * 100).toFixed(1)},${(12 + Math.sin(x * 1.3 + k) * 4 + ((k * 7 + x * 3) % 5) - 2).toFixed(1)}`).join(" "),
}));
// The scene's six phases on REA03: calm, falling, nurse, charge nurse (+3 min), physician (+5 min), seen.
const SPO = [97, 91, 88, 87, 86, 93];
const CLOCK = ["21:38", "21:39", "21:40", "21:43", "21:45", "21:46"];
const ROT = ["rot1", "rot2", "rot3"];
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function useTicker(ms, n) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced()) return undefined;
    const id = setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => clearInterval(id);
  }, [ms, n]);
  return i;
}

function SampleScene() {
  const { t } = useI18n();
  const ph = useTicker(2300, 6);
  const bedClass = ph === 1 ? " warn" : ph >= 2 && ph <= 4 ? " crit" : ph === 5 ? " ok" : "";
  const steps = [
    ["bell", "escNurse", "00:00"],
    ["userPlus", "escCharge", "+3 dk"],
    ["heart", "escDoctor", "+5 dk"],
  ];
  return (
    <div className="hom-scene">
      <div className="hom-sch">
        <span className="flex items-center gap-2"><span className="hom-dot" />{t("auth.sceneCap")}</span>
        <span className="flex items-center gap-2">
          <span className="hom-tag">{t("auth.sceneTag")}</span>
          <span className="font-data">{CLOCK[ph]}</span>
        </span>
      </div>
      <div className="hom-grid">
        {BEDS.map((b, k) => (
          <div key={b.id} className={`hom-bed${k === 2 ? bedClass : ""}`}>
            <div className="hom-no"><b>{b.id}</b><i /></div>
            <svg viewBox="0 0 100 24" preserveAspectRatio="none"><polyline points={b.pts} /></svg>
            <div className="hom-v"><small>SpO₂</small><b>{k === 2 ? SPO[ph] : b.v}</b></div>
          </div>
        ))}
      </div>
      <div className="hom-chain">
        {steps.map(([ic, key, at], n) => (
          <React.Fragment key={key}>
            {n > 0 && <i className="hom-ln" />}
            <div className={`hom-st${ph >= 2 && ph <= 4 && n === ph - 2 ? " on" : ""}${ph === 5 || (ph >= 3 && n < ph - 2) ? " done" : ""}`}>
              <span className="ic"><Icon name={ic} size={14} /></span>
              <b>{t(`auth.${key}`)}</b>
              <small>{at}</small>
            </div>
          </React.Fragment>
        ))}
      </div>
      <div key={ph} className={`hom-cap in${ph >= 2 && ph <= 4 ? " c" : ""}${ph === 5 ? " g" : ""}`}>{t(`auth.sc${ph}`)}</div>
    </div>
  );
}

function Brand({ className = "" }) {
  const { t } = useI18n();
  return (
    <div className={`hom-brand flex items-center gap-3 ${className}`}>
      <span className="hom-mk" style={{ backgroundImage: `url(${logoUrl})` }} />
      <div><b>homunculus</b><small>{t("auth.brandSub")}</small></div>
    </div>
  );
}

/** `step`: {current, total} for the "Step 2/3" line, or nothing. */
export function AuthLayout({ step, children }) {
  const { t, lang, setLang } = useI18n();
  const rot = useTicker(3200, ROT.length);
  const footLinks = [
    ["footPrivacy", "privacy"],
    ["footTerms", "terms"],
    ["footKvkk", "notice"],
    ["footCookies", "cookies"],
    ["footContact", "support"],
  ];
  const showLegal = (key) => {
    openLegal(key, { lang, hospital: t("auth.brandSub"), setLang }).catch(() => {});
  };
  return (
    <div className="hom-auth grid min-h-full bg-app font-text text-14.5 text-ink min-[861px]:h-screen min-[861px]:grid-cols-[1.1fr_1fr]">
      <style>{CSS}</style>
      <section aria-hidden="true" className="hom-hero hidden flex-col px-[52px] pb-[26px] pt-[34px] min-[861px]:flex">
        <div className="hom-bg"><i /><i /><i /></div>
        <Brand />
        <div className="my-auto max-w-[640px] pb-[18px] pt-7">
          <span className="hom-pill"><i />{t("auth.pill")}</span>
          <p className="hom-h1">
            {t("auth.headline1")}<br />
            <span key={rot} className="hom-rot in">{t(`auth.${ROT[rot]}`)}</span>
          </p>
          <p className="hom-lead">{t("auth.lead")}</p>
          <SampleScene />
        </div>
        <div className="hom-trust">
          <span><Icon name="shield" size={15} />{t("auth.trustDecides")}</span>
          <span><Icon name="lock" size={15} />{t("auth.trustSecure")}</span>
          <span><Icon name="building" size={15} />{t("auth.trustOnSite")}</span>
        </div>
      </section>
      <div className="relative flex items-center justify-center overflow-y-auto px-5 py-16">
        <div className="absolute right-5 top-[18px] z-[5] flex items-center gap-2">
          <LanguageMenu />
          <ThemeToggle className="border border-line2 bg-card" />
        </div>
        <main className="hom-form w-full max-w-[420px]">
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
          <div className="mt-[22px] flex flex-wrap justify-center gap-x-2 gap-y-1.5 border-t border-line pt-4 text-12 text-mute">
            {footLinks.map(([key, page], i) => (
              <React.Fragment key={key}>
                {i > 0 && <span aria-hidden="true" className="text-line2">·</span>}
                <button type="button" onClick={() => showLegal(page)} className={`rounded text-mute hover:text-ink ${FOCUS_RING}`}>
                  {t(`auth.${key}`)}
                </button>
              </React.Fragment>
            ))}
          </div>
          <div aria-hidden="true" className="mt-3.5 flex justify-center gap-2">
            {SOCIAL.map(([name, d]) => (
              <span
                key={name}
                title={name}
                className="grid h-9 w-9 place-items-center rounded-full border border-line text-mute opacity-40"
                dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>` }}
              />
            ))}
          </div>
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

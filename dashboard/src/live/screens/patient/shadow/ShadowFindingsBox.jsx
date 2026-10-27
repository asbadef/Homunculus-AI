// src/live/screens/patient/shadow/ShadowFindingsBox.jsx — Aşama B's «Gölge öneri · alarm kapalı».
// The shadow ENGINE's picture of a monitor-linked patient (api/infinity_rules.py `findings`):
// its NEWS2, the monitor inputs it read, its findings and how each stands to the real ones.
// Dressed as advice that cannot be vouched for: amber tag, no risk pill, no rail, no live region,
// nothing that could be mistaken for the Alarmlar screen's rows (spec D7).
//
// WHAT IT PRINTS is the engine's, word for word, and the browser does no clinical arithmetic
// (Decision 1): the total, the values, the summaries (English, `lang="en"` — the engine's own text,
// never translated) and the relation each finding bears to the real engine's findings. The unit of an
// input is written BY CHANNEL CODE with the `board.unit*` word the rest of the screen uses — the wire's
// own unit string ("bpm") is never shown, so a heart rate does not read «/dk» on one card and «bpm»
// on the next.
//
// A word this build does not know is shown as the engine sent it, never as a guess: an unknown source
// prints as that string (not as «HR»), an unknown relation takes the attention look and prints as sent
// (not as «yalnız gölgede», which would assert a relation nobody computed), an unknown severity reads
// «Tanımsız risk: …» (riskStyle). Times are the reader's clock: `hhmm` for one of today, `dd.MM hh:mm`
// for any other day — an input or a finding may be hours old, and «since 23:40» read the next morning
// is a time from last night that looks like one from an hour ago (the Meds box's rule, final review M1).
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../../i18n/dates.js";
import { Box, Note, StatusPill, Tag, riskStyle } from "../../../ui/index.js";
import { CODE_LABEL, CODE_UNIT, VIA_KEY, own } from "./shadowVitals.js";

// StatusPill has no `warn` (that is Tag's tone; ui/index.js lists each component's own): the same amber,
// «the warning tag's look for a value the screen cannot vouch for», is its `att`. A relation this build
// does not know takes it too.
const REL_TONE = { same: "neutral", shadow_only: "att", level_differs: "att" };
const REL_KEY = { same: "shadow.relSame", shadow_only: "shadow.relShadowOnly", level_differs: "shadow.relLevel" };

/** An engine stamp as the reader's clock — the time alone for today, with its day and month for any
 *  other day — or null for one that does not parse. The two dates are compared as written. */
function stamp(iso, nowMs) {
  const ms = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  return dayStamp(ms, nowMs);
}

export function ShadowFindingsBox({ shadow, level = 2 }) {
  const { t } = useI18n();
  if (!shadow) return null;
  const nowMs = Date.now();
  const inputs = Object.entries(shadow.vitals ?? {});
  const findings = shadow.findings ?? [];
  return (
    <div data-shadow-box="">
      <Box title={t("shadow.title")} icon="eye" level={level} className="!border-dashed !border-line2" right={<Tag tone="warn">{t("shadow.tag")}</Tag>}>
        <p className="m-0 text-12.5 text-mute">{t("shadow.intro")}</p>
        <p className="m-0 mt-2 text-13 font-semibold">
          {t("shadow.news2", { total: shadow.news2?.total ?? "—" })}
          {shadow.news2?.partial ? <StatusPill tone="neutral" className="ml-1.5">{t("shadow.news2Partial")}</StatusPill> : null}
        </p>
        {inputs.length > 0 ? (
          <dl className="m-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-1 min-[641px]:grid-cols-4">
            {inputs.map(([code, v]) => {
              const label = own(CODE_LABEL, code);
              const unit = own(CODE_UNIT, code);
              const via = own(VIA_KEY, v?.via);
              return (
                <div key={code} className="min-w-0">
                  <dt className="font-text text-10 font-bold uppercase tracking-[.06em] text-mute">{label ? t(label) : code}</dt>
                  <dd className="m-0 font-data text-14 font-bold text-ink">
                    {v?.value}<small className="ml-0.5 font-text text-10.5 font-semibold text-mute">{unit ? t(unit) : v?.unit}</small>
                    <small className="ml-1 font-text text-10.5 text-mute">
                      {t("shadow.via", { via: via ? t(via) : String(v?.via ?? "—") })} · {stamp(v?.at, nowMs) ?? "—"}
                    </small>
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : null}
        {findings.length === 0 ? (
          <Note tone="info" className="mt-2">{t("shadow.none")}</Note>
        ) : (
          <ul className="m-0 mt-2 grid list-none gap-1.5 p-0">
            {findings.map((f, i) => {
              const relKey = own(REL_KEY, f.relation);
              const severity = riskStyle(f.severity, { measured: true });
              const since = stamp(f.since, nowMs);
              return (
                <li key={`${f.kind}:${i}`} className="flex flex-wrap items-start gap-x-2 gap-y-1">
                  <StatusPill tone={own(REL_TONE, f.relation) ?? "att"}>{relKey ? t(relKey) : String(f.relation ?? "—")}</StatusPill>
                  <span lang="en" className="min-w-0 flex-1 text-12.5 text-ink">{f.summary}</span>
                  <span className="text-11 text-mute">
                    {t(severity.labelKey, severity.labelVars)}{since ? ` · ${t("shadow.since", { time: since })}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Box>
    </div>
  );
}

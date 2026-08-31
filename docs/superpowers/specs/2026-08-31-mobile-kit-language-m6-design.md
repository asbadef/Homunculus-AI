# Mobile M6 — the kit's language: the app the user pointed at

**Date:** 2026-08-31
**Status:** design approved (user supplied the Figma "Medical Health Mobile App / Doctor Mobile App"
community kit as THE reference — file `SuWADe79K41YSG3vazdHNK`, duplicated to their drafts — and
approved the adaptation mockup `homunculus-kit-uyarlama` with "bu mükemmel". The shown state is the
contract: ECG line in kit blue, light theme default. This supersedes M5's monitor look.)

## The source language (measured, not guessed)

Sampled from the kit's own frames (`Home` 37:626, `Doctors` 44:468, `Schedule` 13:752):

- **`#2260FF`** — the one vivid blue: headings, selected states, solid pill buttons, the floating
  nav bar. **Blue text sits only on white** — the kit always gives blue type a white inner panel.
- **`#CAD6FF`** — the pale wash: cards and section grounds. Body text on wash is dark, never blue
  (blue on wash measures 3.48:1 — the kit's own layering rule exists for a reason).
- Soft tints `#ECF1FF`/`#F3F6FF` for chip and icon-circle fills; white ground; near-black body.
- **Everything is a pill or a large radius**: 99px chips/buttons/nav, ~22px cards, ~14px inner
  panels; circular icon buttons; avatar circles.
- **League Spartan** (500–800) — the kit's rounded geometric face, on Google Fonts.
- Floating solid-blue pill nav bar with white icons, hovering above the content.

## Clinical additions the kit lacks

Severity must stay visible: **kritik `#e8505b` · uyarı `#df8f1f` · stabil `#2fae7d`** — soft
enough to sit in this language, used ONLY for severity (dots, rings, pills); everything else stays
in the blue family. Exact shades bend to arithmetic: the contrast test decides final values (e.g. a
white-text critical pill needs the red darkened toward `#d13440`; the warning pill takes dark text
on amber because no AA-passing white-on-amber looks like this kit). The rule is fixed here — kit
hue, AA-decided value — so implementation cannot drift into taste.

## What each surface becomes (per the approved mockup)

| Surface | Kit anatomy applied |
| --- | --- |
| Ward header | Centred blue title "Koğuş" + tinted circle buttons; below it a chip row: `Tümü` (solid), `Kritik n`, `Uyarı n`, right-aligned `n/n dolu` — variant A's KPI facts in kit-chip form. |
| Bed card (`BedCard`, replaces `MonitorTile`) | Pale-wash rounded card: severity-ringed white circle with the bed number (the kit's avatar slot); white inner panel with the bed name (blue only on white) + top-finding summary; pill stat row — severity pill (kind name from `flags.ts`, unchanged) then `OAB` `LAK` `SOFA` white pills; right-side circle actions — `✓` acknowledge (solid when unacked) and `›` detail. Escalated = critical ring + ESKALE pill; MotiPressable press-scale stays. |
| Nav | The kit's floating solid-blue pill bar (custom `tabBar` on the existing Tabs), three white icons. |
| Detail | Wash panel "VİTAL BULGULAR": six white slots (NABIZ/OAB/LAKTAT/SpO2/ATEŞ/SOFA, "—" nulls) + white wave strip with the ECG in **kit blue** (only when HR exists); then blue section heading "Aktif Uyarılar"; alert cards on `#F3F6FF` with severity pill, verbatim engine text, `Onayla` solid pill + `Kılavuz` ghost pill (opens the existing drawer). Trend sparklines live inside the wash panel below the slots, blue. |
| Alerts & Settings & Sunucu & toast & theme picker | Same forms: chips, pills, wash cards, circle buttons. No behaviour change anywhere. |
| Theme | Light IS the kit and becomes the **default**. The night skin stays (machinery untouched): same shapes on a navy ground with an AA-lifted blue — derived, arithmetic-checked, no separate approval loop. |

## What does not change

Transports, store, domain (flags/risk/escalation/citations/no-orders), i18n mechanics, charter
tests, navigation, the waveform-only-with-HR honesty, bed-only identity, the `tintFor` idiom
(re-tuned to the new hues), the composited-contrast test discipline — which now also enforces the
kit's own layering law: blue type on white only.

## Testing

Existing behavioural suites survive (text/label assertions). New/updated: BedCard mirrors the
MonitorTile behavioural set (flags, ack, tap, escalation, waveform gating) plus the stat pills;
contrast test re-parameterised for both new skins including white-on-severity-pill and blue-on-white
pairs; channel-identity test retires with the channel palette (the kit language has no per-vital
colour — the wave is blue; values are dark on white) — noted as a deliberate reversal, not a loss:
vital identity is carried by position and label here, as the kit does.

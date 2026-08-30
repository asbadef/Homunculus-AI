# Mobile M5 — the bedside monitor: variant B

**Date:** 2026-08-30
**Status:** design approved (user picked variant B from the four-way mockup
`homunculus-mobil-secki` after rejecting A mid-flight; B supersedes M4's card board as the ward
screen's language)

## The direction

The ward tab stops looking like a dashboard of cards and starts looking like the instrument
clinicians already trust: a bedside monitor. Full-width tiles separated by hairlines — no card
frames — each carrying channel-coloured, oversized tabular numerals for the vitals the data
actually charts (MAP, lactate; HR when live), a flowing ECG strip when a heart rate exists, a
condition flag, and a one-line SOFA/escalation status.

## What changes

| Piece | Change |
| --- | --- |
| Header | "KOĞUŞ" + right-aligned mono status: `{n} YATAK · KAYIT` in replay, `· CANLI` in live (honesty carried into the chrome). DemoBanner unchanged above it. |
| `PatientCard` → `MonitorTile` | Full-width, `border-b` hairline, no rounded card. Row 1: `YATAK {n}` (stale, uppercase) + condition flag chip. Row 2: three channels — NABIZ, OAB, LAKTAT — label 8–9px uppercase tracked, value ~30px bold `tabular-nums` in the CHANNEL colour, unit tiny. Null → "—" in stale. Row 3: full-width `Waveform` when HR present. Row 4: `SOFA {n}` plus `· eskalasyon: açık` (critical tone) when escalated or `· onaysız` (warning tone) when unacknowledged. Press = same `MotiPressable` scale; tap → detail as before. Escalated glow becomes a left-edge critical bar (a monitor has no card to glow). |
| Condition flag | The top alert's KIND, named in Turkish via new i18n `kind.*` keys (finding NAMES, nouns — `septic_shock` "SEPTİK ŞOK", `under_resuscitated_sepsis` "SIVI YETERSİZ", `sepsis` "SEPSİS", `antibiotic_due` "ANTİBİYOTİK PENCERESİ", `antibiotic_overdue` "ANTİBİYOTİK GECİKTİ", `news2` "NEWS2", `acute_change` "AKUT DEĞİŞİM", `sepsis_watch` "SEPSİS İZLEM"); unknown kind or no alert → the risk label (`risk.*`, "STABİL" for none → reuse "Sakin"? No: add `flag.stable` "STABİL" to match the monitor register). Flag styling = tinted chip in the tone colour (severityTone of the top alert / muted for none), uppercase, tracked. The charter scan covers the new strings automatically. |
| Channel colours | New per-skin palette block `channel: { hr, map, lactate }` — night: `#4be9b6` / `#5cc8ff` / `#f5c964`; day: darkened for white ground, AA-verified arithmetically (contrast test gains the channel-on-surface pairs, both skins). Channel colour = vital identity (ECG-green convention), independent of severity. |
| KPI/topbar of variant A | Not built (A was rejected). The header stays minimal per B. |
| Detail screen | Untouched this slice — M4's cells+waveform+trend stay. Aligning it to channel colours is a follow-up once B is confirmed on the phone. |

## What does not change

Transports, store, domain, i18n mechanics, theme system (B renders in both skins — the monitor
look is dark-native, the day skin gets the same structure on light ground with darkened channels),
DemoBanner semantics, charter tests, detail/alerts/settings screens, all navigation and behaviour.

## Testing

MonitorTile: flag per kind + stable fallback; channels render values and "—"; waveform only with
HR; SOFA line states escalation/unacknowledged; tap reports the bed. Header: replay says KAYIT,
live says CANLI (mock useBoard). Contrast: six new channel pairs (3 channels × 2 skins) plus flag
tints via the existing composited helpers. Existing PatientCard tests are replaced by MonitorTile
tests — assertions carried over where the behaviour is the same (bed identity, escalation, tap).

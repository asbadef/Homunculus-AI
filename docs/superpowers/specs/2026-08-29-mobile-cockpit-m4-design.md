# Mobile M4 — the cockpit in your hand: layout parity with the web

**Date:** 2026-08-29
**Status:** design approved (user direction: "redesign it the same as the web" — M3 matched the
colours; M4 matches the layout and component language of `dashboard/src/ClinicalDemo.jsx`)

## The vocabulary being adopted (read from the cockpit's own markup)

- **Bed card** (`BedBoard`): `rounded-xl` card with a hairline border; header row = small bold bed
  chip (subtle bg, rounded-md) + right-aligned **risk pill with a status dot** (`rounded-full`,
  tinted bg, coloured ring/border, `h-2 w-2` dot); one-line summary under the header
  (`line-clamp-2`, muted); then the vitals grid; then a chip row; then a faint meta footer.
- **Vitals grid**: FIVE cells in one row — HR, MAP, SpO2, Temp, RR — each a `rounded-lg` cell on a
  darker inset surface, containing a 10px uppercase icon+label line, a bold `tabular-nums` value,
  and a 9px unit line. A missing value renders "—" (the cockpit does exactly this).
- **Waveform strip**: an emerald EKG line flowing right-to-left inside a tinted
  (`emerald 5–15% alpha`) rounded box with a pulsing heart icon and a mono bpm readout, shown only
  when a heart rate exists. The web animates via SMIL; native uses a Reanimated translateX loop
  over the same P–QRS–T path template (port `ekgBeatPath` verbatim — it is pure geometry).
- **Header row above the board**: unit-tab ghost buttons + an occupancy chip on the right
  ("Doluluk: n/m"); sticky, hairline bottom border, blurred backdrop feel.
- **Type scale**: vital value ~xl bold, name base bold, labels xs, micro-labels 10–11px uppercase
  tracking-wide.

## What changes on mobile

| Surface | Change |
| --- | --- |
| Patients tab | Header becomes cockpit-style (title + "Tümü" ghost tab + occupancy chip `Doluluk: n/n`). `PatientCard` is rebuilt as the bed card: bed chip + dotted risk pill, top-alert summary line, the five-cell `VitalsRow`, the waveform strip when `heart_rate` is present, a chip row (SOFA chip, `ESKALE EDİLDİ`/`Onaylanmadı` chips in the pill language), faint footer (risk text · scenario time). The MAP sparkline moves out of the card (the waveform takes its slot); trends stay on the detail screen. |
| Patient detail | Vitals section becomes the same five-cell `VitalsRow` + a full-width waveform strip + the existing trend sparklines (MAP/Laktat/SOFA) beneath, cockpit-panel styled. Alert cards keep their content but adopt the ring-pill/chip vocabulary for their badges. |
| RiskPill | Gains the status dot and tinted-ring look everywhere it appears. |
| Alerts + Settings tabs | Headers aligned to the cockpit header style; rows/chips already match after M3. |
| SpO2 / Temp / RR | Get cells at last (typed since M2) — rendering "—" on the recording, live values in M2 mode, exactly like the cockpit's empty cells. This supersedes M1's "no tiles for them" decision: the cockpit's five-cell row IS the design now, and "—" is its own honest empty state. |

## What does not change

Behaviour, navigation, transports, store, i18n mechanics, charter tests, the M3 two-skin palette
(the cockpit look is built FROM those tokens — emerald=safe, amber=warning, the tinted-chip alpha
suffixes from the existing hex+alpha helper). `MotiPressable` press-scale and the shared `SPRING`
stay — they are the touch feel, which the web cannot match anyway.

## Honesty notes

- The waveform is a **visual rhythm indicator driven by the latest HR number**, not a real ECG
  trace — same as the web's. It appears only when a heart rate exists (never on the recording,
  which charts no HR; live mode shows it when the feed does). No fabricated waveforms over "—".
- Bed identity only, as ever: the cockpit's name/age/protocol line is NOT ported (charter).

## Testing

Existing suites stay green (they assert text/labels, which survive). New: VitalsRow renders five
cells with "—" for nulls; waveform absent when HR null, present with HR; occupancy chip counts the
ward; RiskPill dot present. Contrast: any new tinted-chip text/backgrounds checked in the existing
arithmetic test if they introduce new pairs (tinted backgrounds keep the same foreground tokens).

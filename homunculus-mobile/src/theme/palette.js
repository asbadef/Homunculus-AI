// The Homunculus clinical palette — two runtime-switchable skins, translated from the web
// cockpit's `dashboard/src/clinicalTheme.js`. CommonJS because tailwind.config.js requires it,
// and the palette must not exist twice — a colour that drifts between config and code is a bug
// that only shows up on a ward at night.
//
// M6: the app adopts the user's chosen Figma "Medical Health Mobile App" kit language (see
// docs/superpowers/specs/2026-08-31-mobile-kit-language-m6-design.md). Light is now the kit and
// is the DEFAULT skin (see ThemeContext.tsx's DEFAULT_KEY) — the night skin is the same shapes
// derived onto a navy ground, not a separately-approved design.
//
// Two new surfaces exist per skin, on top of `background`/`card`:
//   - `panel` — the kit's white inner panel. THE KIT'S OWN LAYERING LAW: blue (accent) text sits
//     ONLY on `panel`, never on `card`. Measured directly off the kit: accent-on-card is 3.48:1 —
//     under the 4.5:1 body-text bar — while accent-on-panel clears it easily. See
//     __tests__/contrast.test.ts, which asserts both halves of that law as arithmetic.
//   - `soft` — the chip/icon-circle fill tint (a fixed light wash, not an alpha composite).
//
// `sevSolid` is new too: the solid pill fill for a severity badge (as opposed to `clinical.*`,
// which is severity as TEXT/border colour on a light surface). A solid pill's fill only has to
// support ONE specific text colour painted on top of it — not a skin-relative one — so
// `sevSolid` and `sevSolidText` are the same in both skins by design (see the values below and
// their comments). `sevSolidText` lives outside `icu`/`light` for exactly that reason.
//
// Severity text-variants (`clinical.critical/warning/safe`) differ per skin where the raw kit
// hues (crit #e8505b · warn #df8f1f · safe #2fae7d — see the spec's "Clinical additions" table)
// fail WCAG AA as TEXT on that skin's surfaces — arithmetic in __tests__/contrast.test.ts
// decides the exact value, not taste. The margin also has to survive the tinted-chip idiom
// (src/theme/tint.ts) compositing that same colour's own tint underneath it — a colour tuned to
// juuust clear 4.5:1 solid fails once its own faint tint is behind it, so these are darkened
// (light) / lightened (icu) with real margin, not to the bare minimum.
module.exports = {
  light: {
    background: "#ffffff",
    card: "#CAD6FF", // the kit's pale wash — cards/sections. Body text on it is dark, never blue.
    panel: "#ffffff", // the kit's white inner panel — the only surface blue text may sit on.
    soft: "#ECF1FF", // chip / icon-circle fill.
    foreground: "#16232e",
    accent: "#2260FF", // the kit's one vivid blue.
    clinical: {
      border: "#dde5ec",
      // Kit safe hue #2fae7d measures 2.81:1 on white as text — darkened for real margin (5.41:1
      // solid, 5.00:1 once its own tint sits behind it — see contrast.test.ts's tint-idiom block).
      safe: "#207856",
      // Kit warning hue #df8f1f measures 2.60:1 on white as text — darkened the same way
      // (5.30:1 solid, 4.91:1 tinted).
      warning: "#956015",
      // Kit critical hue #e8505b measures 3.67:1 on white as text — darkened the same way
      // (5.36:1 solid, 4.93:1 tinted).
      critical: "#ba4049",
      // Card (the wash) is the binding surface, not background (white) — a mid-tone gray reads
      // with LESS contrast against the wash than against pure white. 4.98:1 on card, 7.17:1 on
      // background.
      stale: "#4c5966",
    },
    // Solid pill fills (BedCard's severity pill, ESKALE mini-pill, ...). critical/safe pair with
    // literal white text (`sevSolidText`, below); warning pairs with dark ink — no white-on-amber
    // clears AA at a colour that still reads as this kit's amber, so the pill keeps dark text
    // instead of darkening the fill into a different colour family (see sevSolidText's comment).
    sevSolid: {
      critical: "#d13440", // white text: 4.91:1.
      warning: "#df8f1f", // the kit's own amber, unmodified — dark ink text: 6.15:1.
      safe: "#207856", // same value as clinical.safe above — white text: 5.41:1.
    },
  },
  icu: {
    background: "#0b1220",
    card: "#16233a",
    panel: "#101a2c", // between background and card in luminance — the dark skin's own "white
    // panel" analogue: the one surface accent text is guaranteed to clear 4.5:1 on.
    soft: "#1a2745",
    foreground: "#e8eef5",
    // AA-lifted from the kit's #2260FF (arithmetic, not eyeballed): light enough to clear 4.5:1
    // as TEXT on `panel` (4.86:1) and `background` (5.22:1), dark enough that a WHITE icon drawn
    // on it as a solid fill (the floating nav pill) still clears the 3:1 chrome bar (3.59:1) — a
    // real tension (lighter helps the first, hurts the second); this value sits in the narrow
    // band where both hold with margin. See __tests__/contrast.test.ts.
    accent: "#4e80ff",
    clinical: {
      border: "#22314c",
      // Kit hues need no darkening on a night ground — the dark skin's usual asymmetry (compare
      // the old channel-colour comment this replaces). Raw hues clear AA directly as text: safe
      // 6.19:1 on panel / 6.66:1 on background; still 5.35:1 once tinted behind itself.
      safe: "#2fae7d",
      // warning 6.70:1 / 7.21:1; 5.82:1 tinted.
      warning: "#df8f1f",
      // critical is the one exception: the raw hue (#e8505b) clears panel/background solid
      // (4.75:1 / 5.11:1) but not with enough margin to survive its own tint underneath it
      // (4.32:1, under 4.5). Lightened further for margin: 5.49:1 / 5.91:1 solid, 4.89:1 tinted.
      critical: "#eb656f",
      stale: "#94a3b8", // unchanged from the pre-kit palette — already clears both surfaces
      // (6.13:1 on card, 7.30:1 on background) with room to spare.
    },
    // Same fills as light — see the top-of-file note on why sevSolid isn't skin-relative.
    sevSolid: {
      critical: "#d13440",
      warning: "#df8f1f",
      safe: "#207856",
    },
  },
  // Fixed severity-pill text colours — NOT nested under a skin, because a solid pill's fill is
  // chosen to support one specific text colour, independent of which skin is active (e.g. icu's
  // own near-white `foreground` measures only 2.22:1 on the kit's amber — using the skin's own
  // foreground token here would silently fail AA in the dark skin). See __tests__/contrast.test.ts.
  sevSolidText: {
    critical: "#ffffff",
    warning: "#16232e",
    safe: "#ffffff",
  },
};

// The static single-palette `tokens`/`toneColor` exports that used to live here are gone on
// purpose (M3). Colours are now theme-dependent — there are two skins (icu/light), not one — so
// every consumer must read them from `useTheme()` (src/theme/ThemeContext.tsx) instead of a
// module-level constant. Deleting the old exports here is what makes the compiler enumerate
// every call site that still needs migrating.

/** Every severity in the app collapses to one of four visual tones. */
export type Tone = "safe" | "warning" | "critical" | "muted";

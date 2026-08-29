import type { ThemeKey } from "./ThemeContext";

/**
 * The tinted-chip idiom used throughout the UI (RiskPill, PatientCard's escalated/unacknowledged
 * chips, Waveform's tinted box, the ward header's active tab): a colour's own hex with an alpha
 * suffix appended, painted as a background behind that same colour's text.
 *
 * One alpha does not serve both skins. icu's parents (card `#0f172a`, background `#020617`) are
 * dark enough that even a 10% wash barely moves the composited background, so the pair's contrast
 * stays close to the *solid* colour's own contrast against that parent. The light skin's parents
 * are the opposite: a wash mixes toward near-white, which *narrows* the gap between a mid-tone
 * clinical colour and its background — 10% pushes several real pairs (critical/warning chips on
 * card, the waveform's bpm readout on background, the ward tab's accent pair) under their bar.
 * A fainter wash keeps the composited background closer to the parent's own (lighter) colour,
 * which *widens* the gap for the same dark text — so light gets a reduced alpha rather than a
 * different colour. See __tests__/contrast.test.ts for the composited numbers this was computed
 * against; if a new colour or surface pairing doesn't clear its bar, compute the new alpha there
 * rather than guessing one here.
 */
export function tintFor(colorHex: string, theme: ThemeKey): string {
  return theme === "icu" ? `${colorHex}1A` : `${colorHex}0F`;
}

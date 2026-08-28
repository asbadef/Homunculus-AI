import palette from "./palette";

export const tokens = palette;

/** Every severity in the app collapses to one of four visual tones. */
export type Tone = "safe" | "warning" | "critical" | "muted";

export function toneColor(tone: Tone): string {
  switch (tone) {
    case "critical":
      return tokens.clinical.critical;
    case "warning":
      return tokens.clinical.warning;
    case "safe":
      return tokens.clinical.safe;
    case "muted":
      return tokens.clinical.stale;
  }
}

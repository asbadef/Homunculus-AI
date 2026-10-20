// src/live/screens/patient/ageText.js — how old a value is, in the reader's own language: "3 dk önce".
// The number and the unit stay apart, so neither ends up inside a word that would need a suffix
// fitted to it. Shared by the measured-values box and the trend cards, so the two never word one
// age two ways. The instant it ages against is the caller's `useBoardNow` (the server's clock).
import { ageOf } from "../common/freshness.js";
import { ageParts } from "../common/feedHealth.js";

export function ageText(t, iso, nowMs) {
  const ms = ageOf(iso, nowMs);
  if (ms === null) return null;
  const parts = ageParts(ms / 1000);
  const key = parts.unit === "s" ? "board.ageS" : parts.unit === "m" ? "board.ageM" : "board.ageH";
  return t("patient.vitalAge", { age: t(key, { count: parts.value }) });
}

// src/live/screens/common/skewAtReceipt.js — the clock skew of a page's own answer (server minus browser, ms), taken the
// moment the answer lands. Written for «Eczane» (G3-04, eczane/usePharmacy.js) and moved here unchanged when «Enfeksiyon
// kontrol» (G4-05, spec §5 M9) came to read its own answers the same way: two copies of one rule would drift.
//
// A page whose session holds no `board.view` has no board store, so no board skew; its clock is corrected by this one
// (pharmacyModel `clockSkewOf`), so a workstation whose clock is wrong neither reads a dead list as fresh nor a live
// one as stale.

/** backendApi's own floor for a measured skew: under it the honest answer is 0. */
export const SKEW_NOISE_MS = 2_000;

/** Server minus browser, in ms, at the moment `answer` landed; null when neither the client nor the answer says.
 *  The answer's own `now` is read the way the client reads the `Date` header (backendApi `noteServerDate`): the
 *  route stamped it before the answer travelled, so a right clock measures minus the latency — under the noise
 *  floor that is 0, and above it the figure is rounded to the second. Injected raw, the jitter would move the
 *  instant every duration is counted against on every answer, and a minute would flicker at its boundary. */
export function skewAtReceipt(api, answer) {
  const measured = typeof api?.serverClockSkewMs === "function" ? api.serverClockSkewMs() : null;
  if (Number.isFinite(measured)) return measured;
  const at = typeof answer?.now === "string" ? Date.parse(answer.now) : Number.NaN;
  if (!Number.isFinite(at)) return null;
  const raw = at - Date.now();
  return Math.abs(raw) < SKEW_NOISE_MS ? 0 : Math.round(raw / 1000) * 1000;
}

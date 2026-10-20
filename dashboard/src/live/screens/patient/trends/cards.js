// src/live/screens/patient/trends/cards.js — the six trend cards and the channels each one draws.
//
// Names, units and identity colours are the bed card's own (`../../common/vitals.js`), so a channel
// is called the same thing on every screen. Systolic and MAP share one card: one chart, two series,
// told apart by label and by the dot — MAP's is hollow — and never by colour alone (they share
// `--v-map`, vitals.js says why).
import { VITALS } from "../../common/vitals.js";

const META = Object.fromEntries(VITALS.map((v) => [v.at, v]));

const series = (key, hollow = false) => Object.freeze({
  key, labelKey: META[key].labelKey, unitKey: META[key].unitKey, color: META[key].color, hollow,
});

export const CARDS = Object.freeze([
  Object.freeze({ id: "heart_rate", series: Object.freeze([series("heart_rate")]) }),
  Object.freeze({ id: "resp_rate", series: Object.freeze([series("resp_rate")]) }),
  Object.freeze({ id: "spo2", series: Object.freeze([series("spo2")]) }),
  Object.freeze({ id: "pressure", series: Object.freeze([series("sbp"), series("map", true)]) }),
  Object.freeze({ id: "temperature", series: Object.freeze([series("temperature")]) }),
  Object.freeze({ id: "lactate", series: Object.freeze([series("lactate")]) }),
]);

/** A card's title: its channels' names, in its order. */
export const cardTitle = (t, card) => card.series.map((s) => t(s.labelKey)).join(" · ");

/** An answer's channels by key; empty before there is an answer. */
export const channelsOf = (data) => Object.fromEntries((data?.channels ?? []).map((c) => [c.key, c]));

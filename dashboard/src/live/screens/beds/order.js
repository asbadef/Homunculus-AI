// src/live/screens/beds/order.js — the bed board's ordering and filtering. Pure.
//
// TWO ORDERS, AND THE DEFAULT IS THE BED'S. A nurse learns where a bed sits on the screen; a board
// that re-sorts itself makes her search for it again at the very moment she is reacting to an
// alarm. The old wall board wrote the rule down: "an alarm HIGHLIGHTS a bed, it does not re-order
// the list." So risk is carried by the card's pill and stripe and by the attention line above the
// board, and the list keeps still — unless the clinician asks for risk order, which the roadmap
// requires the screen to offer (G1-09, "risk sırası") and which this module provides.
//
// RISK ORDER PUTS WHAT IT CANNOT VOUCH FOR FIRST. A card whose risk the engine did not send, or
// sent as a level this build does not know, is sorted above `critical` — the same rule the bell
// follows for an unknown severity ("it may be the worst", boardStore `waitingAlarms`). It is never
// sorted down among the quiet cards.
//
// NOTHING HERE IS A CLINICAL JUDGEMENT. The rank is the engine's own severity list, in the engine's
// own order; no number is read, no threshold applied, nothing re-scored.
import { ENGINE_RISKS } from "../../ui/riskStyle.js";

export const VIEWS = Object.freeze(["kart", "liste"]);
export const ORDERS = Object.freeze(["yatak", "risk"]);

// ENGINE_RISKS is `critical, high, moderate, low, info, none` (ui/riskStyle.js, which reads the
// engine's own list). A risk not in it ranks -1: above everything.
const rankOf = (risk) => {
  const key = typeof risk === "string" ? risk.trim().toLowerCase() : "";
  const at = ENGINE_RISKS.indexOf(key);
  return at === -1 ? -1 : at;
};

/** What a card is called where a bed order is concerned: the hospital's bed label if the HIS sent
 *  one, else the identifier the feed keys the patient by. Never invented. */
export const bedNameOf = (p) => String(p?.bedLabel || p?.patient_id || "");

/** Bed order: by unit (a card the bed table does not place goes last — it belongs to no unit and
 *  no scope grant can reach it), then by bed label with numbers compared as numbers, so REA-2
 *  comes before REA-10. */
function byBed(a, b) {
  const ua = a?.unitId || "";
  const ub = b?.unitId || "";
  if (ua !== ub) {
    if (!ua) return 1;
    if (!ub) return -1;
    return ua < ub ? -1 : 1;
  }
  return bedNameOf(a).localeCompare(bedNameOf(b), "en", { numeric: true, sensitivity: "base" });
}

/** `patients` in the chosen order. A new array; the input is left alone. */
export function orderBeds(patients, order = "yatak") {
  const list = Array.isArray(patients) ? [...patients] : [];
  if (order !== "risk") return list.sort(byBed);
  return list.sort((a, b) => rankOf(a?.risk) - rankOf(b?.risk) || byBed(a, b));
}

/** Case- and diacritic-insensitive form, for matching what someone typed against a name or a bed.
 *  NFD then strip the combining marks, as the prototype's admin search does, plus the two letters
 *  decomposition does not cover: Azerbaijani `ə` and Turkish/Azerbaijani `ı`, which a ward PC's
 *  keyboard and the HIS do not always agree on. */
export function norm(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ə/gi, "e")
    .replace(/[ıİ]/g, "i")
    .toLowerCase()
    .trim();
}

/** The cards this unit holds. `unit` null: all of them. A card the bed table does not place has no
 *  unit, so a unit filter hides it — and the screen says how many it hid. */
export function inUnit(patients, unit) {
  const list = Array.isArray(patients) ? patients : [];
  if (!unit) return list;
  return list.filter((p) => p?.unitId === unit);
}

/** The cards whose bed, id or HIS name contains what was typed. An empty query matches all. */
export function matching(patients, query) {
  const list = Array.isArray(patients) ? patients : [];
  const q = norm(query);
  if (!q) return list;
  return list.filter((p) => norm(p?.bedLabel).includes(q)
    || norm(p?.patient_id).includes(q)
    || norm(p?.display_name).includes(q));
}

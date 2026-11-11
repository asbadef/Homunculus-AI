// src/live/screens/denetim/denetim.js — the «Denetim bütünlüğü» page's rules, apart from React (G2-B4, spec
// docs/superpowers/specs/2026-11-09-g2b-b4-denetim-design.md): the masked patient id (owner D2), who did it
// (D6), what one `/audit/verify` answer reads as (D4), the event types the page names (§4), and the order
// the events are shown in (D5).

/** The most records one verification asks for: the server's own cap (`AUDIT_VERIFY_LIMIT_MAX`, D4). */
export const VERIFY_LIMIT = 50000;
/** The newest events the page reads (D5). */
export const EVENTS_LIMIT = 200;
export const MASK = "••••";

/** Owner D2: four dots and the id's last four characters; four characters or fewer, the dots alone; none, «—». */
export function maskPatient(id) {
  const text = typeof id === "string" ? id.trim() : "";
  if (!text) return "—";
  return text.length <= 4 ? MASK : `${MASK}${text.slice(-4)}`;
}

/** D6: the payload keys the engine's writers use for who did it, in the order they are read. */
export const ACTOR_KEYS = Object.freeze([
  "actor", "charted_by", "read_by", "signed_by", "retracted_by", "by", "user", "device", "login",
]);

export function actorOf(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  for (const key of ACTOR_KEYS) {
    const value = p[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "—";
}

/** §4: the engine's event types the page has a label for. Any other code shows as itself and is not offered
 *  in the filter. */
export const EVENT_TYPES = Object.freeze([
  ["auth", "auth"], ["admin", "admin"], ["scope", "scope"], ["scope_denied", "scopeDenied"],
  ["ack", "ack"], ["view", "view"],
  ["chart", "chart"], ["chart_retract", "chartRetract"], ["profile", "profile"],
  ["score", "score"], ["score_signed", "scoreSigned"],
  ["alert", "alert"], ["first_seen", "firstSeen"], ["alert_cleared", "alertCleared"],
  ["escalation", "escalation"], ["rrt_call", "rrtCall"], ["notification", "notification"],   // rrt_call: G2-B5 (spec D9)
  ["identity", "identity"], ["ingest", "ingest"], ["reading_dropped_discharged", "readingDropped"],
  ["shadow_alert", "shadowAlert"], ["shadow_alert_cleared", "shadowCleared"],
  ["admission.admit", "admit"], ["admission.sign_off", "signOff"],
  ["admission.discharge_start", "dischargeStart"], ["admission.discharge_confirm", "dischargeConfirm"],
  ["bed.release", "bedRelease"], ["device_bed.bind", "deviceBind"], ["device_bed.unbind", "deviceUnbind"],
  ["protocol.settings", "protocolSettings"],
  // G2-B3a (Doluluk, final review M-7): the four bed moves (tenant/router.py).
  ["bed.reserve", "bedReserve"], ["bed.unreserve", "bedUnreserve"],
  ["bed.out_of_service", "bedOutOfService"], ["bed.return_to_service", "bedReturnToService"],
  // G2-B3b (spec D8): «Vardiya devri» — opened, signed by the outgoing person, countersigned by the receiver.
  ["handover.open", "handoverOpen"], ["handover.sign_outgoing", "handoverSign"], ["handover.countersign", "handoverCountersign"],
].map(([code, key]) => Object.freeze({ code, key: `denetim.type.${key}` })));

const TYPE_KEYS = new Map(EVENT_TYPES.map((e) => [e.code, e.key]));

/** The label key of a type the page names, or null — the table then shows the code itself. */
export const typeKey = (code) => TYPE_KEYS.get(code) ?? null;

/** The engine's two reasons (`api/audit.py` verify_chain, fixed Turkish sentences), each to the page's own
 *  key; anything else is «no reason given». The server's words are never shown: they are in one language. */
const REASONS = Object.freeze([
  ["önceki kayda bağlanmıyor", "denetim.reasonDeleted"],
  ["mührüyle uyuşmuyor", "denetim.reasonAltered"],
]);

export function reasonKey(reason) {
  const text = typeof reason === "string" ? reason : "";
  const hit = REASONS.find(([needle]) => text.includes(needle));
  return hit ? hit[1] : "denetim.reasonOther";
}

const count = (value) => (Number.isFinite(value) ? value : 0);

/** D4: what one `/audit/verify` answer reads as — `kind` broken | unreadable | empty | partial | ok, with
 *  `unsealed` (records written before the seal existed) riding along. An answer without a boolean `ok` is
 *  `unreadable`: never "intact", never "empty". */
export function verdictOf(report) {
  const r = report && typeof report === "object" ? report : {};
  const unsealed = count(r.unsealed);
  if (r.ok === false) return { kind: "broken", brokenAt: r.broken_at ?? null, reasonKey: reasonKey(r.reason), unsealed };
  if (r.ok !== true) return { kind: "unreadable", unsealed };
  // `ok: true` alone is not a verdict: without how many records it covered, and whether that was all of them, it
  // can be neither «intact» nor «empty».
  if (!Number.isFinite(r.records) || typeof r.complete !== "boolean") return { kind: "unreadable", unsealed };
  if (count(r.records) === 0) return { kind: "empty", unsealed };
  if (r.complete === false) return { kind: "partial", records: count(r.records), unsealed };
  return { kind: "ok", checked: count(r.checked), unsealed };
}

/** D5: the server sends the newest rows oldest-first; the page shows them by id, newest first. Any other
 *  answer is none. */
export function newestFirst(answer) {
  const records = Array.isArray(answer?.records) ? answer.records : [];
  return [...records].sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0));
}

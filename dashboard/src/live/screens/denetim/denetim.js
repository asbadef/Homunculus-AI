// src/live/screens/denetim/denetim.js — the «Denetim bütünlüğü» page's rules, apart from React (G2-B4, spec
// docs/superpowers/specs/2026-11-09-g2b-b4-denetim-design.md): the masked patient id (owner D2), who did it
// (D6), what one `/audit/verify` answer reads as (D4), the event types the page names (§4), and the order
// the events are shown in (D5). Follow-up 2026-11-11 (docs/superpowers/specs/2026-11-11-g2b-b4-denetim-adlar-design.md):
// a user id is masked (D2), and every type the engine writes has a label (D3).

/** The newest events the page reads (D5). */
export const EVENTS_LIMIT = 200;
export const MASK = "••••";

/** Owner D2: four dots and the id's last four characters; four characters or fewer, the dots alone; none, «—». */
export function maskPatient(id) {
  const text = typeof id === "string" ? id.trim() : "";
  if (!text) return "—";
  return text.length <= 4 ? MASK : `${MASK}${text.slice(-4)}`;
}

/** The engine's ids are UUIDs. Where one stands in for a person (a scope row written before the follow-up's D1
 *  holds nothing else), the page masks it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === "string" && UUID.test(value.trim());

/** G2-B4 follow-up D2 (owner «Ad yaz, eskiyi maskele»): a user id is never printed — «kullanıcı ••••» and its last
 *  four characters, the patient id's mask with the word that says whose id it is. `t`, the page's translator, is
 *  required; without one the plain mask is shown — the id still never is, and nothing throws. */
export const maskUser = (t, id) => (typeof t === "function" ? t("denetim.maskedUser", { id: maskPatient(id) }) : maskPatient(id));

const nameOrMask = (t, value) => (isUuid(value) ? maskUser(t, value) : value.trim());

/** D6: the payload keys the engine's writers use for who did it, in the order they are read. */
export const ACTOR_KEYS = Object.freeze([
  "actor", "charted_by", "read_by", "signed_by", "retracted_by", "by", "user", "device", "login",
]);

/** The actor key that names no person: a monitor. A UUID under it is masked as an id, without «kullanıcı». */
const DEVICE_KEY = "device";

/** Who did it: the first non-empty key's value — a name as it is, a UUID masked (follow-up D2): a person's with
 *  «kullanıcı», a device's as an id. A scope row names its administrator in `actor` since D1, read before `by`, its
 *  id; an older one shows the mask. `t` is required (see maskUser). */
export function actorOf(payload, t) {
  const p = payload && typeof payload === "object" ? payload : {};
  for (const key of ACTOR_KEYS) {
    const value = p[key];
    if (typeof value !== "string" || !value.trim()) continue;
    return key === DEVICE_KEY && isUuid(value) ? maskPatient(value) : nameOrMask(t, value);
  }
  return "—";
}

/** The «Konu» cell (follow-up D2). A scope row's subject is the id of the user whose access changed: the page shows
 *  that user's name from the payload (written since D1), else the id masked as a user's. A UUID subject of any other
 *  type is masked as an id, without the word — the page cannot tell whose id it is (a task's, say). Anything else
 *  shows as it is. G4-04 (spec D4: names are read at display): a nurse–bed assignment's subject is its unit, named by
 *  `unitName(id)` — the structure the shell already holds — when it knows the unit; else masked as any other id. */
export function subjectOf(rec, t, unitName = () => null) {
  const subject = typeof rec?.subject === "string" ? rec.subject.trim() : "";
  if (rec?.event_type === "scope") {
    const user = rec?.payload?.user;
    if (typeof user === "string" && user.trim()) return nameOrMask(t, user);
    return subject ? maskUser(t, subject) : "—";
  }
  if (rec?.event_type === "shift.assign" && isUuid(subject)) {
    const name = unitName(subject);
    if (typeof name === "string" && name.trim()) return name;
  }
  return isUuid(subject) ? maskPatient(subject) : rec?.subject || "—";
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
  ["alert_snooze", "alertSnooze"],   // G2-B5b (spec D4): «Ertele»
  ["identity", "identity"], ["ingest", "ingest"], ["reading_dropped_discharged", "readingDropped"],
  // G3-05 (spec §4): a device reading that matched nobody (kept, with its value), and a set a person linked or rejected.
  ["reading_unmatched", "readingUnmatched"], ["reading_assigned", "readingAssigned"], ["reading_rejected", "readingRejected"],
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
  // Follow-up 2026-11-11 D3: every other type the engine writes (engineTypes.test.js reads the engine and fails on
  // one this list does not name). Yapı's four (tenant/router.py), in the Yapı tab's own words:
  ["structure.create", "structureCreate"], ["structure.rename", "structureRename"],
  ["structure.close", "structureClose"], ["structure.reopen", "structureReopen"],
  // G4-05 (spec §5 O1): an existing room marked or unmarked as an isolation room — Yapı's fifth.
  ["structure.isolation", "structureIsolation"],
  // the admission's label and its board retry (admission/router.py, tenant/router.py):
  ["admission.label_print", "labelPrint"], ["admission.discharge_board_retry", "dischargeBoardRetry"],
  // the monitor–bed table: a bed's new label followed, and its one-time seed from the approved file (devicebeds/seed.py):
  ["device_bed.relabel", "deviceRelabel"], ["device_bed.import", "deviceImport"],
  // G3-02 «Görevlerim» (api/tasks.py), in its own words:
  ["task_created", "taskCreated"], ["task_claimed", "taskClaimed"], ["task_done", "taskDone"],
  ["task_skipped", "taskSkipped"], ["vital_skipped", "vitalSkipped"], ["task_settings_changed", "taskSettings"],
  // G2-B1c (spec §5.5): the care team — an attending made (at sign-off, by a claim or an add), a member added, a row ended.
  ["care_team.attending", "careTeamAttending"], ["care_team.add", "careTeamAdd"], ["care_team.end", "careTeamEnd"],
  // G2-B1b (spec §5.6, X14): a patient moved to another bed in one step, and the retry of her card's move
  // (`admission.transfer_board_retry`: from the transfer's own resend, `via: "transfer"`, or when a bed is freed —
  // `bed.release`, `bed.transition`, `bed.return_to_service`) — named, as the discharge's retry above is, because
  // engineTypes.test.js fails on any type the engine writes that this list does not name.
  ["admission.transfer", "transfer"], ["admission.transfer_board_retry", "transferBoardRetry"],
  // G4-04 (spec D4): «İş yükü» — a unit's nurse–bed assignment for a shift saved (admission/shifts.py).
  ["shift.assign", "shiftAssign"],
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
 *  `unreadable`: never "intact", never "empty". Since G2 borç 3 the engine walks the whole chain and every
 *  answer is `complete: true`; `partial` stays for an answer that says otherwise, never worded as a whole. */
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

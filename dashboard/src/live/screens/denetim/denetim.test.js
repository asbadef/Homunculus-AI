// denetim.test.js — the «Denetim bütünlüğü» page's rules (G2-B4, spec 2026-11-09): the masked patient id
// (owner D2), who did it (D6), what a verification answer reads as (D4), the labelled types (§4), the order.
import { describe, it, expect } from "vitest";
import {
  ACTOR_KEYS, EVENTS_LIMIT, EVENT_TYPES, MASK, actorOf, isUuid, maskPatient, maskUser, newestFirst, reasonKey, subjectOf,
  typeKey, verdictOf,
} from "./denetim.js";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { LANG_CODES } from "../../i18n/langs.js";
import { createTranslator } from "../../i18n/translate.js";

const tr = createTranslator("tr", DICTIONARIES);
const ADMIN_ID = "11111111-1111-4111-8111-11111111ad01";    // synthetic user ids
const NURSE_ID = "22222222-2222-4222-8222-2222222261a2";

describe("the masked patient id (owner D2)", () => {
  it("shows four dots and the id's last four characters", () => {
    expect(maskPatient("260109004821")).toBe("••••4821");
    expect(maskPatient("yatak-04")).toBe("••••k-04");
  });

  it("shows the dots alone for four characters or fewer, and «—» for none", () => {
    expect(maskPatient("P-1")).toBe(MASK);
    expect(maskPatient("4821")).toBe(MASK);
    for (const none of ["", "  ", null, undefined, 42]) expect(maskPatient(none)).toBe("—");
  });
});

describe("who did it (D6)", () => {
  it("reads the payload's actor keys in their order", () => {
    expect(ACTOR_KEYS).toEqual(["actor", "charted_by", "read_by", "signed_by", "retracted_by", "by", "user", "device", "login"]);
    expect(actorOf({ actor: "ayse", charted_by: "x" })).toBe("ayse");
    expect(actorOf({ charted_by: "dr.kerimov" })).toBe("dr.kerimov");
    expect(actorOf({ read_by: "a", signed_by: "b" })).toBe("a");
    expect(actorOf({ signed_by: "b" })).toBe("b");
    expect(actorOf({ retracted_by: "h1" })).toBe("h1");
    expect(actorOf({ by: "admin-1" })).toBe("admin-1");
    expect(actorOf({ user: "u-1" })).toBe("u-1");
    expect(actorOf({ device: "bed05-mon" })).toBe("bed05-mon");
    expect(actorOf({ login: "deneme" })).toBe("deneme");
  });

  it("skips an empty or non-text value, and says «—» when nobody is named", () => {
    expect(actorOf({ actor: null, charted_by: "", read_by: 7, user: "u-2" })).toBe("u-2");
    expect(actorOf({})).toBe("—");
    expect(actorOf(undefined)).toBe("—");
  });

  // G2-B4 follow-up D2 (owner «Ad yaz, eskiyi maskele»): a user id is never printed.
  it("masks a user id as «kullanıcı ••••» and its last four characters, and keeps a username as it is", () => {
    expect(actorOf({ by: ADMIN_ID, before: [], after: [] }, tr)).toBe("kullanıcı ••••ad01");      // a scope row before D1
    expect(actorOf({ actor: "admin", user: "ayse.sentetik", by: ADMIN_ID }, tr)).toBe("admin");   // a scope row since D1
    expect(actorOf({ by: ` ${ADMIN_ID.toUpperCase()} ` }, tr)).toBe("kullanıcı ••••AD01");
    expect(actorOf({ actor: "ayse.sentetik" }, tr)).toBe("ayse.sentetik");
    expect(maskUser(tr, NURSE_ID)).toBe(`kullanıcı ${MASK}61a2`);
  });

  // review: «kullanıcı» says whose id it is, so only a key that names a person carries it; `device` names a monitor.
  it("masks a UUID under `device` as an id, without the word — a monitor is not a user", () => {
    expect(actorOf({ device: NURSE_ID }, tr)).toBe(`${MASK}61a2`);
    expect(actorOf({ device: "bed05-mon" }, tr)).toBe("bed05-mon");
    for (const person of ACTOR_KEYS.filter((key) => key !== "device")) {
      expect(actorOf({ [person]: NURSE_ID }, tr), person).toBe(`kullanıcı ${MASK}61a2`);
    }
  });

  // review: `t` is required; a caller that forgets it still never prints the id, and never throws.
  it("falls back to the plain mask without a translator, and never throws", () => {
    expect(actorOf({ by: ADMIN_ID })).toBe(`${MASK}ad01`);
    expect(maskUser(undefined, NURSE_ID)).toBe(`${MASK}61a2`);
    expect(subjectOf({ event_type: "scope", subject: NURSE_ID, payload: {} })).toBe(`${MASK}61a2`);
  });
});

describe("a user id (follow-up D2)", () => {
  it("is a UUID; a username, a code or anything else is not", () => {
    expect(isUuid(ADMIN_ID)).toBe(true);
    expect(isUuid(` ${NURSE_ID.toUpperCase()} `)).toBe(true);
    for (const other of ["admin", "ayse.sentetik", "user.update", "news2_high", "260109004821", "", null, undefined, 42,
      "11111111-1111-4111-8111-11111111ad0", "11111111111141118111111111111ad01", `${ADMIN_ID}x`]) {
      expect(isUuid(other), String(other)).toBe(false);
    }
  });

  it("says the masked user in every language, with the mask itself in it", () => {
    for (const lang of LANG_CODES) {
      const said = maskUser(createTranslator(lang, DICTIONARIES), ADMIN_ID);
      expect(said, lang).toContain(`${MASK}ad01`);
      expect(said, lang).not.toContain(ADMIN_ID);
      expect(said.length, lang).toBeGreaterThan(`${MASK}ad01`.length);
    }
  });
});

describe("the subject (follow-up D2)", () => {
  const row = (over) => ({ id: 1, event_type: "scope", patient_id: "", subject: NURSE_ID, payload: {}, ...over });

  it("names whose access a scope row changed: the payload's user since D1, else the subject masked as a user", () => {
    expect(subjectOf(row({ payload: { actor: "admin", user: "ayse.sentetik", by: ADMIN_ID } }), tr)).toBe("ayse.sentetik");
    expect(subjectOf(row({ payload: { by: ADMIN_ID, before: [], after: ["unit-adult"] } }), tr)).toBe("kullanıcı ••••61a2");
    expect(subjectOf(row({ payload: { user: "  " } }), tr)).toBe("kullanıcı ••••61a2");
    expect(subjectOf(row({ payload: { user: 7 } }), tr)).toBe("kullanıcı ••••61a2");
    expect(subjectOf(row({ payload: undefined }), tr)).toBe("kullanıcı ••••61a2");
    expect(subjectOf(row({ payload: { user: NURSE_ID } }), tr)).toBe("kullanıcı ••••61a2");     // an id where the name goes
    expect(subjectOf(row({ subject: "", payload: {} }), tr)).toBe("—");
  });

  // G4-04 review 11 (spec D4: names are read at display): a nurse–bed assignment's subject is its unit — named from the
  // structure the shell already holds, else masked as any other id.
  it("names a shift assignment's unit from the structure held, else masks its id as an id", () => {
    const UNIT = "33333333-3333-4333-8333-333333333301";
    const assign = row({ event_type: "shift.assign", subject: UNIT, payload: { unit_id: UNIT, actor: "charge" } });
    expect(subjectOf(assign, tr, (id) => (id === UNIT ? "Reanimasiya" : null))).toBe("Reanimasiya");
    expect(subjectOf(assign, tr, () => null)).toBe(`${MASK}3301`);
    expect(subjectOf(assign, tr)).toBe(`${MASK}3301`);
    expect(subjectOf(row({ event_type: "task_done", subject: UNIT }), tr, () => "Reanimasiya")).toBe(`${MASK}3301`);
  });

  it("masks a UUID subject of any other type as an id — the page cannot tell whose it is — and shows any other as it is", () => {
    expect(subjectOf(row({ event_type: "task_done", subject: NURSE_ID }), tr)).toBe(`${MASK}61a2`);
    expect(subjectOf(row({ event_type: "admin", subject: "user.update" }), tr)).toBe("user.update");
    expect(subjectOf(row({ event_type: "ack", subject: "news2_high" }), tr)).toBe("news2_high");
    expect(subjectOf(row({ event_type: "view", subject: "" }), tr)).toBe("—");
    expect(subjectOf(undefined, tr)).toBe("—");
  });
});

describe("what one verification answer reads as (D4)", () => {
  const answer = (over = {}) => ({ ok: true, checked: 120, unsealed: 0, broken_at: null, reason: "", records: 120, complete: true, ...over });

  it("intact and whole", () => {
    expect(verdictOf(answer())).toEqual({ kind: "ok", checked: 120, unsealed: 0 });
  });

  it("intact but partial — never read as whole", () => {
    expect(verdictOf(answer({ records: 50000, checked: 50000, complete: false })))
      .toEqual({ kind: "partial", records: 50000, unsealed: 0 });
  });

  it("broken — the first broken record and the engine's reason, mapped to the page's own key", () => {
    expect(verdictOf(answer({ ok: false, broken_at: 77, reason: "önceki kayda bağlanmıyor — arada kayıt silinmiş olabilir" })))
      .toEqual({ kind: "broken", brokenAt: 77, reasonKey: "denetim.reasonDeleted", unsealed: 0 });
    expect(verdictOf(answer({ ok: false, broken_at: 78, reason: "kaydın içeriği mührüyle uyuşmuyor — sonradan değiştirilmiş" })).reasonKey)
      .toBe("denetim.reasonAltered");
  });

  it("an empty trail; records written before the seal ride along with any verdict", () => {
    expect(verdictOf(answer({ records: 0, checked: 0 }))).toEqual({ kind: "empty", unsealed: 0 });
    expect(verdictOf(answer({ unsealed: 3, checked: 117 }))).toEqual({ kind: "ok", checked: 117, unsealed: 3 });
  });

  it("an answer it cannot read is said to be one — never intact, never empty", () => {
    expect(verdictOf(undefined)).toEqual({ kind: "unreadable", unsealed: 0 });
    expect(verdictOf({ checked: 5 })).toEqual({ kind: "unreadable", unsealed: 0 });
  });

  it("an answer that says ok but not how many records or whether it is whole is unreadable too — not «empty», not «intact»", () => {
    expect(verdictOf({ ok: true })).toEqual({ kind: "unreadable", unsealed: 0 });
    expect(verdictOf({ ok: true, records: 5, checked: 5 })).toEqual({ kind: "unreadable", unsealed: 0 });
    expect(verdictOf({ ok: true, records: "5", complete: true, unsealed: 2 })).toEqual({ kind: "unreadable", unsealed: 2 });
    expect(verdictOf({ ok: true, records: Number.NaN, complete: true })).toEqual({ kind: "unreadable", unsealed: 0 });
  });
});

describe("the reason (D4)", () => {
  it("maps the engine's two sentences, and anything else to «no reason given»", () => {
    expect(reasonKey("önceki kayda bağlanmıyor — arada kayıt silinmiş olabilir")).toBe("denetim.reasonDeleted");
    expect(reasonKey("kaydın içeriği mührüyle uyuşmuyor — sonradan değiştirilmiş")).toBe("denetim.reasonAltered");
    expect(reasonKey("başka bir şey")).toBe("denetim.reasonOther");
    expect(reasonKey(undefined)).toBe("denetim.reasonOther");
  });
});

describe("the labelled types (§4)", () => {
  it("names the engine's codes and leaves every other code to show as itself", () => {
    expect(EVENT_TYPES).toHaveLength(61);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js); + G2-B1b's move and its board retry; + G4-04's shift.assign; + G3-05's three
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(61);
    expect(typeKey("admission.transfer")).toBe("denetim.type.transfer");                           // G2-B1b (spec §5.6, X14)
    expect(typeKey("admission.transfer_board_retry")).toBe("denetim.type.transferBoardRetry");     // named too, as the discharge's retry is (engineTypes.test.js, D3)
    expect(typeKey("shift.assign")).toBe("denetim.type.shiftAssign");                 // G4-04 (spec D4): «Nöbet ataması»
    expect(typeKey("reading_unmatched")).toBe("denetim.type.readingUnmatched");   // G3-05 (spec §4)
    expect(typeKey("reading_assigned")).toBe("denetim.type.readingAssigned");
    expect(typeKey("reading_rejected")).toBe("denetim.type.readingRejected");
    expect(typeKey("care_team.attending")).toBe("denetim.type.careTeamAttending");   // G2-B1c (spec §5.5)
    expect(typeKey("care_team.add")).toBe("denetim.type.careTeamAdd");
    expect(typeKey("care_team.end")).toBe("denetim.type.careTeamEnd");
    expect(typeKey("rrt_call")).toBe("denetim.type.rrtCall");   // G2-B5 (spec D9)
    expect(typeKey("alert_snooze")).toBe("denetim.type.alertSnooze");   // G2-B5b (spec D4)
    expect(typeKey("handover.open")).toBe("denetim.type.handoverOpen");                 // G2-B3b (spec D8)
    expect(typeKey("handover.sign_outgoing")).toBe("denetim.type.handoverSign");
    expect(typeKey("handover.countersign")).toBe("denetim.type.handoverCountersign");
    expect(typeKey("ack")).toBe("denetim.type.ack");
    // G2-B3a (final review M-7): Doluluk's four bed moves.
    expect(typeKey("bed.reserve")).toBe("denetim.type.bedReserve");
    expect(typeKey("bed.unreserve")).toBe("denetim.type.bedUnreserve");
    expect(typeKey("bed.out_of_service")).toBe("denetim.type.bedOutOfService");
    expect(typeKey("bed.return_to_service")).toBe("denetim.type.bedReturnToService");
    expect(typeKey("admission.admit")).toBe("denetim.type.admit");
    expect(typeKey("reading_dropped_discharged")).toBe("denetim.type.readingDropped");
    // Follow-up D3: every type the engine writes is named — Yapı's four, the admission's two, the monitor table's two,
    // and «Görevlerim»'s six.
    expect(typeKey("structure.create")).toBe("denetim.type.structureCreate");
    expect(typeKey("structure.rename")).toBe("denetim.type.structureRename");
    expect(typeKey("structure.close")).toBe("denetim.type.structureClose");
    expect(typeKey("structure.reopen")).toBe("denetim.type.structureReopen");
    expect(typeKey("admission.label_print")).toBe("denetim.type.labelPrint");
    expect(typeKey("admission.discharge_board_retry")).toBe("denetim.type.dischargeBoardRetry");
    expect(typeKey("device_bed.relabel")).toBe("denetim.type.deviceRelabel");
    expect(typeKey("device_bed.import")).toBe("denetim.type.deviceImport");
    expect(typeKey("task_created")).toBe("denetim.type.taskCreated");
    expect(typeKey("task_claimed")).toBe("denetim.type.taskClaimed");
    expect(typeKey("task_done")).toBe("denetim.type.taskDone");
    expect(typeKey("task_skipped")).toBe("denetim.type.taskSkipped");
    expect(typeKey("vital_skipped")).toBe("denetim.type.vitalSkipped");
    expect(typeKey("task_settings_changed")).toBe("denetim.type.taskSettings");
    // A code the page does not name (a row an older version wrote) shows as itself.
    expect(typeKey("legacy.made_up")).toBeNull();
    expect(typeKey(undefined)).toBeNull();
  });
});

describe("the events, newest first (D5)", () => {
  it("orders by id, newest first, and reads a missing answer as none", () => {
    expect(newestFirst({ records: [{ id: 3 }, { id: 5 }, { id: 4 }] }).map((r) => r.id)).toEqual([5, 4, 3]);
    expect(newestFirst(undefined)).toEqual([]);
    expect(newestFirst({ records: "x" })).toEqual([]);
  });

  // G2 borç 3: the verification has no cap to ask for any more — the server walks the whole chain.
  it("asks for the server's own cap of events", () => {
    expect(EVENTS_LIMIT).toBe(200);
  });
});

describe("the page's words", () => {
  it("has every type label, reason and verdict in every language", () => {
    const keys = [...EVENT_TYPES.map((e) => e.key), "denetim.reasonDeleted", "denetim.reasonAltered", "denetim.reasonOther",
      "denetim.verdictOk", "denetim.verdictPartial", "denetim.verdictBroken", "denetim.verdictEmpty", "denetim.verdictUnreadable",
      "denetim.maskedUser"];
    for (const lang of LANG_CODES) for (const key of keys) expect(DICTIONARIES[lang][key], `${lang} ${key}`).toBeTruthy();
  });
});

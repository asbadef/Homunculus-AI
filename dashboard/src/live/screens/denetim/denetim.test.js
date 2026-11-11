// denetim.test.js — the «Denetim bütünlüğü» page's rules (G2-B4, spec 2026-11-09): the masked patient id
// (owner D2), who did it (D6), what a verification answer reads as (D4), the labelled types (§4), the order.
import { describe, it, expect } from "vitest";
import {
  ACTOR_KEYS, EVENTS_LIMIT, EVENT_TYPES, MASK, VERIFY_LIMIT, actorOf, maskPatient, newestFirst, reasonKey, typeKey, verdictOf,
} from "./denetim.js";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { LANG_CODES } from "../../i18n/langs.js";

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
    expect(EVENT_TYPES).toHaveLength(40);   // G2-B3a's four bed moves + G2-B5's rrt_call + G2-B3b's three handover events + G2-B1c's three care-team events
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(40);
    expect(typeKey("care_team.attending")).toBe("denetim.type.careTeamAttending");   // G2-B1c (spec §5.5)
    expect(typeKey("care_team.add")).toBe("denetim.type.careTeamAdd");
    expect(typeKey("care_team.end")).toBe("denetim.type.careTeamEnd");
    expect(typeKey("rrt_call")).toBe("denetim.type.rrtCall");   // G2-B5 (spec D9)
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
    expect(typeKey("structure.create")).toBeNull();
    expect(typeKey(undefined)).toBeNull();
  });
});

describe("the events, newest first (D5)", () => {
  it("orders by id, newest first, and reads a missing answer as none", () => {
    expect(newestFirst({ records: [{ id: 3 }, { id: 5 }, { id: 4 }] }).map((r) => r.id)).toEqual([5, 4, 3]);
    expect(newestFirst(undefined)).toEqual([]);
    expect(newestFirst({ records: "x" })).toEqual([]);
  });

  it("asks for the server's own caps", () => {
    expect(VERIFY_LIMIT).toBe(50000);   // AUDIT_VERIFY_LIMIT_MAX
    expect(EVENTS_LIMIT).toBe(200);
  });
});

describe("the page's words", () => {
  it("has every type label, reason and verdict in every language", () => {
    const keys = [...EVENT_TYPES.map((e) => e.key), "denetim.reasonDeleted", "denetim.reasonAltered", "denetim.reasonOther",
      "denetim.verdictOk", "denetim.verdictPartial", "denetim.verdictBroken", "denetim.verdictEmpty", "denetim.verdictUnreadable"];
    for (const lang of LANG_CODES) for (const key of keys) expect(DICTIONARIES[lang][key], `${lang} ${key}`).toBeTruthy();
  });
});

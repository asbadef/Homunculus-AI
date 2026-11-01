import { describe, it, expect } from "vitest";
import { bedText, canSeeMapping, monitorName, occupiedNames, shortName, verifiedText, visibility } from "./deviceMap.js";

const t = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

// The expected local time comes from the same Date getters the screen is meant to use, so these asserts
// hold in any time zone the suite runs in.
const pad = (n) => String(n).padStart(2, "0");
const clockOf = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const stampOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clockOf(iso)}`; };

describe("the editor's pure rules", () => {
  // Amendment A-1 (O61 resolved): display_name is one free-text «ad soyad» field, so the word order is
  // whatever the clerk typed; Baku writes «soyad ad ata adı». The first word stays whole, each later
  // word is an initial, and a trailing patronymic marker is dropped.
  it.each([
    ["Ahmet Yılmaz", "Ahmet Y."],
    ["Məmmədov Əli Həsən oğlu", "Məmmədov Ə. H."],
    ["Ali", "Ali"],
    ["  ", null],
    ["Иванов Иван Иванович", "Иванов И. И."],
    ["Aliyeva Leyla Rəşid qızı", "Aliyeva L. R."],
  ])("short name of %j is %j (A-1's table)", (input, expected) => {
    expect(shortName(input)).toBe(expected);
  });

  it("keeps at most three initials after the first word", () => {
    expect(shortName("A B C D E")).toBe("A B. C. D.");
  });

  it("gives null for a blank, null or undefined name, and tolerates stray whitespace", () => {
    expect([shortName(""), shortName(null), shortName(undefined), shortName(" \t\n ")]).toEqual([null, null, null, null]);
    expect(shortName("  Ayşe  Nur   Kaya ")).toBe("Ayşe N. K.");
  });

  it("drops every trailing patronymic marker, in either case, in each script — and only trailing ones", () => {
    for (const marker of ["oğlu", "qızı", "kızı", "оглы", "кызы", "oglu", "qizi"]) {
      expect(shortName(`Soyad Ad ${marker}`), marker).toBe("Soyad A.");
      expect(shortName(`Soyad Ad ${marker.toLocaleUpperCase()}`), marker.toLocaleUpperCase()).toBe("Soyad A.");
    }
    expect(shortName("Soyad Ad oğlu oğlu")).toBe("Soyad A.");
    expect(shortName("Soyad oğlu Ad")).toBe("Soyad o. A.");        // a marker in the middle is a name
    expect(shortName("Əli oğlu")).toBe("Əli");                      // the first word is never dropped
    expect(shortName("oğlu")).toBe("oğlu");
  });

  // Amendment A-18: the initial is exactly the letter typed. `toLocaleUpperCase()` with no argument follows
  // the browser's locale, so «ilkin» would be «İ.» on an az/tr browser and «I.» on an en one, and the same
  // patient would read differently on two screens. Names are typed capitalised.
  it("keeps each initial exactly as typed: a lower-case dotted i stays i, whatever the browser's locale", () => {
    expect(shortName("Məmmədov ilkin")).toBe("Məmmədov i.");
    expect(shortName("Məmmədov Ilkin")).toBe("Məmmədov I.");
    expect(shortName("Soyad əli həsən")).toBe("Soyad ə. h.");
    expect(shortName("ömer şahin")).toBe("ömer ş.");
  });

  it("takes the initial by code point, so a surrogate pair is not split", () => {
    expect(shortName("Ali 😀x")).toBe("Ali 😀.");
  });

  it("finds each occupied bed's patient on the session's own board, and never prints a number", () => {
    const patients = [{ patient_id: "H2600042", display_name: "Ahmet Yılmaz" }, { patient_id: "H2600043", display_name: null }];
    expect(occupiedNames([{ bed_id: "b1", patient_id: "H2600042" }, { bed_id: "b2", patient_id: "H2600043" },
      { bed_id: "b3" }, { bed_id: "b4", patient_id: "H2600099" }], patients))
      .toEqual([{ bedId: "b1", name: "Ahmet Y." }, { bedId: "b2", name: null }, { bedId: "b3", name: null }, { bedId: "b4", name: null }]);
    expect(occupiedNames(undefined, undefined)).toEqual([]);
    expect(occupiedNames([{ bed_id: "b1", patient_id: "H2600042" }], undefined)).toEqual([{ bedId: "b1", name: null }]);
  });

  it("names a monitor by its address and central station name", () => {
    expect(monitorName({ source: "10.10.203.37", device_bed_label: "BED08" })).toBe("10.10.203.37 (BED08)");
    expect(monitorName({ source: "10.10.203.40", device_bed_label: null })).toBe("10.10.203.40");
  });

  it("says where a monitor sits in the structure's words, or why it cannot", () => {
    expect(bedText(t, { bed: null })).toBe("esleme.unbound");
    expect(bedText(t, { bed: { id: "x", in_scope: false } })).toBe("esleme.otherUnit");
    expect(bedText(t, { bed: { id: "x", in_scope: true, label: "bed08", room: "Otaq 08", unit: "Reanimasiya" } }))
      .toBe("bed08 · Otaq 08 · Reanimasiya");
  });

  it("says whether a monitor is seen, and since when it is not", () => {
    expect(visibility({ seen: true })).toEqual({ key: "esleme.seen", vars: undefined });
    expect(visibility({ seen: false, last_seen_at: null })).toEqual({ key: "esleme.unseenUnknown", vars: undefined });
    expect(visibility({ seen: false, last_seen_at: "bozuk" })).toEqual({ key: "esleme.unseenUnknown", vars: undefined });
    const at = visibility({ seen: false, last_seen_at: "2026-10-30T09:02:00+00:00" });
    expect(at.key).toBe("esleme.unseenAt");
    expect(at.vars).toEqual({ time: clockOf("2026-10-30T09:02:00+00:00") });
  });

  it("prints a v2 date as written and an editor row's time in local time", () => {
    expect(verifiedText("2026-09-22")).toBe("2026-09-22");
    expect(verifiedText("2026-10-30T09:12:03.120000+00:00")).toBe(stampOf("2026-10-30T09:12:03.120000+00:00"));
    expect(verifiedText("2026-10-30T09:12:03+00:00")).toBe(stampOf("2026-10-30T09:12:03+00:00"));
  });

  // Amendment A-18: «—» reads as "never verified", so it is only for a missing value. Anything the screen
  // cannot read as a date or a time is printed as it was written, never hidden.
  it("prints a value it cannot read as it was written; «—» is only for a missing one", () => {
    expect([verifiedText(null), verifiedText(undefined), verifiedText(42), verifiedText({})]).toEqual(["—", "—", "—", "—"]);
    expect(verifiedText("bozuk")).toBe("bozuk");
    expect(verifiedText("elle doğrulandı, 22 Eylül 2026")).toBe("elle doğrulandı, 22 Eylül 2026");
    expect(verifiedText("2026-09-22 ekranda görüldü")).toBe("2026-09-22 ekranda görüldü");
    expect(verifiedText("2026-13-45T99:99:00Z")).toBe("2026-13-45T99:99:00Z");     // ISO-shaped, not a date
    expect(verifiedText("foo 1")).toBe("foo 1");                                    // V8's lenient parser would make a date of it
  });

  it("shows the section to a holder of either key", () => {
    expect([canSeeMapping(["devices.map_beds"]), canSeeMapping(["devices.manage"]), canSeeMapping(["board.view"]), canSeeMapping(undefined)])
      .toEqual([true, true, false, false]);
  });
});

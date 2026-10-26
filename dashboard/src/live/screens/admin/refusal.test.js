// One copy of "a refusal names its subject", so the three tabs cannot word it three ways.
// Synthetic accounts only.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { createTranslator } from "../../i18n/translate.js";
import { doneFor, mayHaveLanded, reasonOf, refusedFor } from "./refusal.js";

const az = createTranslator("az", DICTIONARIES);
const en = createTranslator("en", DICTIONARIES);
const refusal = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
/** The three ways a write gets no answer, as backendApi rejects them: its own timeout (a `code`),
 *  a 5xx from the proxy in front of the engine, and fetch() rejecting with no response at all. */
const timedOut = () => Object.assign(new Error("Sunucu yanıt vermedi. İşlem gerçekleşmiş olabilir; listeyi kontrol edip gerekirse tekrar deneyin."), { code: "REQUEST_TIMEOUT" });
const badGateway = () => refusal(502, "İstek başarısız (502)");
const dropped = () => new TypeError("Failed to fetch");

describe("mayHaveLanded", () => {
  it("is true for the three answers that are no answer: a timeout, a server that could not answer, a dropped connection", () => {
    expect(mayHaveLanded(timedOut())).toBe(true);
    expect(mayHaveLanded(badGateway())).toBe(true);
    expect(mayHaveLanded(refusal(504, "<html>Gateway Time-out</html>"))).toBe(true);
    expect(mayHaveLanded(dropped())).toBe(true);
    expect(mayHaveLanded(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(mayHaveLanded(new TypeError("Load failed"))).toBe(true);
  });

  it("is false for the server's own refusal: it answered, and nothing landed", () => {
    expect(mayHaveLanded(refusal(403, "Kendi yetkilerinizi aşan bir işlem yapılamaz"))).toBe(false);
    expect(mayHaveLanded(refusal(422, "username: must not be blank", {
      fieldErrors: [{ field: "username", type: "value_error", message: "must not be blank" }],
    }))).toBe(false);
    expect(mayHaveLanded(refusal(409, "Kayıt aynı anda değiştirildi; lütfen tekrar deneyin"))).toBe(false);
    // A 5xx that says exactly what went wrong is the engine's answer, not a missing one.
    expect(mayHaveLanded(refusal(503, "Dizin sunucusuna ulaşılamıyor"))).toBe(false);
  });

  it("is false for text already in the reader's words — even text that names a dropped connection", () => {
    // Callers pass a 422's `others`, or a read's `readErrorText`, as a string: words, not a failure.
    expect(mayHaveLanded("Failed to fetch")).toBe(false);
    expect(mayHaveLanded(en("errors.network"))).toBe(false);
    expect(mayHaveLanded(en("errors.requestTimeout"))).toBe(false);
  });

  it("is false for a superseded request, read BEFORE anything else: its session is gone, and nobody is told", () => {
    const superseded = (err) => Object.assign(err, { superseded: true, code: "SESSION_SUPERSEDED" });
    expect(mayHaveLanded(superseded(refusal(401, "Bu istek önceki oturuma aitti; sonucu uygulanmadı.")))).toBe(false);
    // The flag wins over a status or a message that would otherwise read as "no answer".
    expect(mayHaveLanded(Object.assign(badGateway(), { superseded: true }))).toBe(false);
    expect(mayHaveLanded(Object.assign(dropped(), { superseded: true }))).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(mayHaveLanded(null)).toBe(false);
    expect(mayHaveLanded(undefined)).toBe(false);
  });
});

describe("refusedFor", () => {
  it("names the account in front of the server's own reason", () => {
    const err = refusal(409, "Bu hesap başka bir kurumda da etkin; parola, MFA, e-posta, ad ve etkinlik buradan değiştirilemez, yalnızca bu kurumdaki grupları ayarlanabilir");
    const text = refusedFor(az, "Ayşe Sentetik", err);
    expect(text.startsWith("Ayşe Sentetik")).toBe(true);
    expect(text).toContain(az("errors.sharedAccount"));
  });

  it("translates a 422's own field message, which the raw message no longer matches", () => {
    // backendApi builds the Error's message as "<field>: <text>", so the whole string is in no
    // table; the item's own message is. Before this, every validator refusal in the
    // administration forms reached the administrator as the server's raw Turkish.
    const err = refusal(422, "username: Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.", {
      fieldErrors: [{ field: "username", type: "value_error", message: "Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e." }],
    });
    expect(refusedFor(en, "hs.aygun", err)).toBe(en("admin.refusedFor", {
      subject: "hs.aygun", reason: en("errors.usernameRule"),
    }));
  });

  it("with no subject it is the reason alone, never an empty prefix", () => {
    const err = refusal(503, "Dizin sunucusuna ulaşılamıyor");
    expect(refusedFor(az, "", err)).toBe(az("errors.directoryUnreachable"));
    expect(refusedFor(az, null, err)).toBe(az("errors.directoryUnreachable"));
  });

  it("an unknown refusal keeps the server's words rather than inventing one", () => {
    expect(refusedFor(az, "Gecə ekibi", refusal(400, "something new"))).toContain("something new");
  });

  it("a reason already in the reader's words — a 422's `others`, which no control shows — is used as it is", () => {
    // fieldRefusals(t, err, rendered).others: refusals about fields the form does not draw, already
    // translated. They go to the toast through here, named, rather than nowhere.
    expect(refusedFor(az, "Ayşe Sentetik", "Bir dəfəyə ən çoxu 50 ədəd."))
      .toBe(az("admin.refusedFor", { subject: "Ayşe Sentetik", reason: "Bir dəfəyə ən çoxu 50 ədəd." }));
  });

  it("a write with no answer says it may have gone through — a dropped connection and a server that could not answer are not refusals", () => {
    // "Could not connect to the server" alone reads as "nothing happened"; the request may have
    // reached the engine before the line went, and a proxy's 502 may sit in front of a commit.
    for (const [err, key] of [[dropped(), "errors.network"], [badGateway(), "errors.serverUnreachable"]]) {
      expect(refusedFor(en, "Night team", err)).toBe(en("admin.refusedFor", {
        subject: "Night team", reason: `${en(key)} ${en("admin.mayHaveLanded")}`,
      }));
    }
    expect(refusedFor(az, "", dropped())).toBe(`${az("errors.network")} ${az("admin.mayHaveLanded")}`);
  });

  it("a timeout says it once: its own sentence already says the operation may have happened", () => {
    expect(refusedFor(en, "Night team", timedOut()))
      .toBe(en("admin.refusedFor", { subject: "Night team", reason: en("errors.requestTimeout") }));
  });

  it("a refusal, and words already said, never claim the write may have gone through", () => {
    expect(refusedFor(en, "Night team", refusal(403, "Kendi yetkilerinizi aşan bir işlem yapılamaz")))
      .not.toContain(en("admin.mayHaveLanded"));
    // A READ's failure reaches here as `readErrorText`'s words: a read never "may have gone through".
    expect(refusedFor(en, "sintetik", en("errors.network"))).toBe(en("admin.refusedFor", {
      subject: "sintetik", reason: en("errors.network"),
    }));
  });
});

describe("reasonOf", () => {
  it("says a 404 no map knows by its status, in the reader's words — never the server's English (A-14)", () => {
    // "Bed not found.", "Admission not found.", "Room not found": a place gone from under the screen.
    for (const words of ["Bed not found.", "Admission not found.", "Room not found"]) {
      expect(reasonOf(az, refusal(404, words))).toBe(az("errors.requestFailed", { status: 404 }));
      expect(refusedFor(az, "3 · Otaq 1 · Reanimasiya", reasonOf(az, refusal(404, words))))
        .toBe("3 · Otaq 1 · Reanimasiya: Sorğu uğursuz oldu (404).");
    }
  });

  it("leaves a 404 that a code or a known message already names to refusedFor", () => {
    const coded = refusal(404, "English words", { apiCode: "invalid_transition" });
    expect(reasonOf(az, coded)).toBe(coded);
    // Words a map knows say more than the status does: "kullanıcı bulunamadı" (apiErrors.js).
    const known = refusal(404, "kullanıcı bulunamadı");
    expect(reasonOf(az, known)).toBe(known);
    expect(refusedFor(az, "Ayşe Sentetik", reasonOf(az, known))).toContain(az("errors.userNotFound"));
  });

  it("passes every other failure, words already said and nothing at all through as they are", () => {
    for (const err of [refusal(409, "Bed not found."), timedOut(), dropped()]) expect(reasonOf(az, err)).toBe(err);
    expect(reasonOf(az, "Bir dəfəyə ən çoxu 50 ədəd.")).toBe("Bir dəfəyə ən çoxu 50 ədəd.");
    expect(reasonOf(az, null)).toBeNull();
    expect(reasonOf(az, undefined)).toBeUndefined();
  });
});

describe("doneFor", () => {
  it("names the subject of a confirmation too", () => {
    expect(doneFor(az, "Ayşe Sentetik", az("admin.passwordReset")))
      .toBe(az("admin.doneFor", { subject: "Ayşe Sentetik", text: az("admin.passwordReset") }));
    expect(doneFor(az, "", "x")).toBe("x");
  });
});

// One copy of "a refusal names its subject", so the three tabs cannot word it three ways.
// Synthetic accounts only.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { createTranslator } from "../../i18n/translate.js";
import { doneFor, refusedFor } from "./refusal.js";

const az = createTranslator("az", DICTIONARIES);
const en = createTranslator("en", DICTIONARIES);
const refusal = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

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
});

describe("doneFor", () => {
  it("names the subject of a confirmation too", () => {
    expect(doneFor(az, "Ayşe Sentetik", az("admin.passwordReset")))
      .toBe(az("admin.doneFor", { subject: "Ayşe Sentetik", text: az("admin.passwordReset") }));
    expect(doneFor(az, "", "x")).toBe("x");
  });
});

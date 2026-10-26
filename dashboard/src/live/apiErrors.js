// src/live/apiErrors.js — an API failure, in the user's language.
//
// The API writes its refusals as fixed texts, mostly Turkish, some English or a bare code
// (homunculus-engine auth/*.py), nginx answers a sign-in over its limit itself, and the client
// adds its own (backendApi.js). Each known text maps to a key of the `errors` namespace;
// apiErrors.test.js reads those sources as TEXT and fails when one of their messages is not
// mapped here, so a message added on the server cannot reach a ward untranslated.
//
// This covers the sign-in, MFA, password, lock-screen and session surface (Wave 2). A screen
// that talks to more of the API (G1-12's /admin) adds its own sources to the test and its own
// messages below.
//
// Not translated, ever: anything the message carries about a patient. These texts carry none.

/** Exact text (trimmed) -> key in the `errors` namespace. */
export const API_MESSAGE_KEYS = new Map([
  // auth/dependencies.py
  ["Hesabınıza kurum tanımlanmamış", "noTenant"],
  ["Bu kurumdaki üyeliğiniz etkin değil", "membershipInactive"],
  ["Platform operatörü yetkisi gerekli", "platformOnly"],
  ["password_change_required", "passwordChangeRequired"],
  ["mfa_required", "mfaRequired"],
  ["mfa_reset_required", "mfaResetRequired"],
  ["Invalid or missing authentication credentials", "notAuthenticated"],
  // auth/dependencies.py, and POST /auth/password answering a session an administrator ended
  ["token_version", "tokenVersion"],
  ["tenant", "tenantChanged"],
  // auth/router.py
  ["Çok fazla hatalı kod. 5 dakika sonra tekrar deneyin.", "totpLocked"],
  ["Bu kod zaten kullanıldı; yeni kodu bekleyin.", "totpReplayed"],
  ["TOTP not set up", "totpNotSetUp"],
  ["Invalid TOTP code", "invalidTotp"],
  // _DIRECTORY_THROTTLED, which _PASSWORD_CHECKS_THROTTLED repeats word for word
  ["Çok fazla hatalı deneme; 15 dakika sonra tekrar deneyin", "directoryThrottled"],
  ["Parola hatalı", "reauthRefused"],
  ["Invalid credentials", "invalidCredentials"],
  ["Invalid or expired refresh token", "sessionExpired"],
  // auth/ldap.py
  ["Dizin sunucusuna ulaşılamıyor", "directoryUnreachable"],
  ["Dizin yapılandırılmamış", "directoryNotConfigured"],
  // auth/service.py (own password change)
  ["Parola Active Directory tarafından yönetiliyor", "directoryPassword"],
  ["Yeni parola en az 8 karakter olmalı", "passwordTooShort"],
  ["Yeni parola mevcut paroladan farklı olmalı", "passwordUnchanged"],
  ["Mevcut parola yanlış", "wrongCurrentPassword"],
  // auth/schemas.py
  ["login is required", "loginRequired"],
  // deploy/local/web/nginx.conf: a sign-in over the per-address limit (location @login_limited)
  ["Çok fazla giriş denemesi; bir dakika sonra tekrar deneyin", "loginRateLimited"],
  // the same, for an unlock or a password change over its limit (location @reauth_limited)
  ["Çok fazla deneme. Bir dakika sonra yeniden deneyin.", "reauthRateLimited"],
  // backendApi.js
  ["Oturum süresi doldu, tekrar giriş yapın.", "sessionExpired"],
  ["Sunucuya şu an ulaşılamıyor; oturumunuz açık, biraz sonra tekrar deneyin.", "sessionUnreachable"],
  ["Giriş başarısız.", "loginFailed"],
  ["Doğrulama kodu geçersiz.", "invalidTotp"],
  ["Sunucu yanıt vermedi. İşlem gerçekleşmiş olabilir; listeyi kontrol edip gerekirse tekrar deneyin.",
    "requestTimeout"],
  ["Bu istek önceki oturuma aitti; sonucu uygulanmadı.", "sessionSuperseded"],
  // fetch() rejecting with no response: Chrome/Edge, Firefox, Safari
  ["Failed to fetch", "network"],
  ["NetworkError when attempting to fetch resource.", "network"],
  ["Load failed", "network"],

  // ---------------------------------------------------------------- Wave 3 (G1-09 … G1-14)
  // api/board.py has no messages; these are api/app.py's. The board's own three credential
  // refusals mean "this is not a credential we know", which is what notAuthenticated says.
  ["unknown tenant token", "notAuthenticated"],
  ["missing bearer token", "notAuthenticated"],
  ["unknown credential", "notAuthenticated"],
  ["invalid or expired ticket", "streamTicketExpired"],
  // The SAME answer for a patient who does not exist and for one outside the caller's scope: a
  // 403 would confirm that the patient exists and is under care here, which is the fact being
  // withheld (api/app.py `_require_patient`). The text says both, so no screen implies one.
  ["hasta bulunamadı", "patientNotFound"],
  ["geçersiz patient_id", "badPatientId"],
  ["geçersiz recorded_at", "badRecordedAt"],
  ["geçersiz kind", "badAlarmKind"],
  ["no such active alert", "alarmNoLongerOpen"],
  ["kapsam şu anda okunamıyor", "scopeUnreadable"],
  ["ingest requires a device token", "deviceTokenOnly"],
  ["malformed identity resource", "badIdentityResource"],
  ["identity source 'kabul' is reserved for the admission", "kabulSourceReserved"],
  ["denetim kaydının tamamı kapsam dışı; bir patient_id verin", "auditScoped"],
  ["alarm kalitesi raporunun tamamı kapsam dışı", "alarmQualityScoped"],
  ["skor formunu yalnız bir kişi imzalayabilir", "scoreSignedByOne"],
  // GET /patients/{id}/trends (Group 2's trend charts): a window other than 6, 24 or 72 hours.
  ["geçersiz hours: 6, 24 veya 72 olmalı", "badTrendHours"],

  // admin/service.py — its module constants and the AdminError literals.
  ["Son yönetici yetkisi kaldırılamaz", "lastAdmin"],
  ["Son yönetici pasifleştirilemez", "lastAdminDeactivate"],
  ["Group not found", "groupNotFound"],
  ["User not found", "userNotFound"],
  ["unknown group for this tenant", "unknownGroup"],
  ["Bu kısa ad zaten kullanılıyor", "slugTaken"],
  ["Bu kullanıcı adı veya e-posta zaten kayıtlı", "loginTaken"],
  ["Kayıt aynı anda değiştirildi; lütfen tekrar deneyin", "concurrentChange"],
  ["Kendi yetkilerinizi aşan bir işlem yapılamaz", "beyondOwnRights"],
  ["Platform operatörü hesabı kurum yönetiminden değiştirilemez; yalnızca bu kurumdaki grupları ayarlanabilir", "platformAccount"],
  ["Bu hesap başka bir kurumda da etkin; parola, MFA, e-posta, ad ve etkinlik buradan değiştirilemez, yalnızca bu kurumdaki grupları ayarlanabilir", "sharedAccount"],
  ["Kendi parolanızı veya MFA'nızı buradan sıfırlayamazsınız; parola için Hesabım > Parola değiştir'i kullanın", "selfCredentials"],
  ["Kendi hesabınızı pasifleştiremezsiniz", "selfDeactivate"],
  ["Bu hesabın bu hatalı giriş dizisi için tek kilit açma hakkı kullanıldı; 15 dakika hatalı parola girilmezse giriş kendiliğinden açılır", "unlockCooldown"],
  ["Sistem grubunun izinleri ve MFA kuralı değiştirilemez", "systemGroupLocked"],
  ["Sistem grubu silinemez", "systemGroupUndeletable"],
  ["Üyesi olan grup silinemez", "groupHasMembers"],
  ["AD eşlemesi olan grup silinemez", "groupHasMapping"],
  ["Kullanıcı adı zorunludur", "usernameRequired"],

  // admin/schemas.py — what a 422 says about a field of the user or group form.
  ["Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.", "usernameRule"],
  ["must not be blank", "mustNotBeBlank"],
  ["e-mail: one '@' with text on both sides, no spaces", "badEmail"],
  ["slug: 2-64 characters, lower-case letters, digits and _ only", "badSlug"],
  ["reason: one line of text, no control or formatting characters", "reasonOneLine"],
  ["reason: at least one letter or digit", "reasonNeedsText"],
  ["ad_group_dn must be a distinguished name (CN=…,DC=…)", "badGroupDn"],

  // admin/ldap_service.py — the group mapping. (Its SKIP_* values are not messages: they are the
  // reasons an import gives per account, and the login-source screen translates them itself.)
  ["Bu AD grubu bu gruba zaten eşlenmiş", "mappingExists"],
  ["Mapping not found", "mappingNotFound"],
  ["AD grup eşlemesini yalnız tüm yetkilere sahip bir yönetici değiştirebilir", "mappingAdminOnly"],

  // scope/router.py and scope/schemas.py — assigning a unit or a bed.
  ["kullanıcı bulunamadı", "userNotFound"],
  ["kapsam atamak için kapsamı sınırsız bir yönetici olmalısınız", "scopeAdminOnly"],
  ["bir atama ya bir ünite ya bir yatak belirtir, ikisi birden değil", "scopeGrantShape"],
]);

/** backendApi.js `err.code`s; they win over the text. */
export const API_CODE_KEYS = new Map([
  ["REQUEST_TIMEOUT", "requestTimeout"],
  ["SESSION_SUPERSEDED", "sessionSuperseded"],
]);

// G2-B1a — Hasta Kabul. The admission and structure routes answer a stable CODE beside English
// words (homunculus-engine admission/errors.py; backendApi.js puts it on `err.apiCode`). The code
// is mapped, never the words. apiErrors.test.js reads errors.py and the three files that name a
// field, and fails when a code or a field below is missing. Full keys: their texts live in the
// `kabul` namespace with the rest of the slice.
export const ADMISSION_CODE_KEYS = new Map([
  ["bed_not_available", "kabul.err.bedNotAvailable"],
  ["bed_closed", "kabul.err.bedClosed"],
  ["out_of_scope", "kabul.err.outOfScope"],
  ["critical_alarm_open", "kabul.err.criticalAlarmOpen"],
  ["patient_number_exhausted", "kabul.err.numberExhausted"],
  ["invalid_transition", "kabul.err.invalidTransition"],
  ["missing_attending", "kabul.err.missingAttending"],
  ["open_admission", "kabul.err.openAdmission"],
  ["bed_in_use", "kabul.err.bedInUse"],
  ["has_open_beds", "kabul.err.hasOpenBeds"],
  ["name_taken", "kabul.err.nameTaken"],
  ["bed_label_taken", "kabul.err.bedLabelTaken"],      // A-5: a bed label is unique within its unit
  // A-19: the form's request id came before with another form — an admission exists under it. The
  // text sends the nurse to the list; with the earlier admission's number when the detail carries
  // it (`err.patientNumber`, its bed in her units), `kabul.err.requestConflictNumber`.
  ["request_conflict", "kabul.err.requestConflict"],
  // A-32: a bed's release while its last patient's card is still on the board; with that patient's
  // number when the detail carries it (`err.patientNumber`), `kabul.err.boardNotClearedNumber`.
  ["board_not_cleared", "kabul.err.boardNotCleared"],
]);
/** The coded refusals whose detail names a patient's number, each with the sentence that says it.
 *  A number beside any other code is not shown. */
const WITH_NUMBER = new Map([
  ["request_conflict", "kabul.err.requestConflictNumber"],
  ["board_not_cleared", "kabul.err.boardNotClearedNumber"],
]);

/** The fields no screen sends today (admission/schemas.py AdmissionNoteFields): one sentence says a
 *  field the screen does not send was refused. apiErrors.test.js checks the form's body indeed holds
 *  none of them — a screen that starts sending one gives it its own sentence. */
const NOT_ON_SCREEN = "kabul.invalid.notOnScreen";

/** `field_invalid:<field>` -> the sentence naming that field. A field not listed reads the
 *  generic sentence: the refusal is still said, only less exactly. A field is refused by
 *  admission/form.py's rules (by its literal, or in a loop over names), by the request model while
 *  the body is read (a control character in a text, a JSON list it cannot keep — A-10, A-16), or by
 *  a router; apiErrors.test.js reads all four. */
export const INVALID_FIELD_KEYS = new Map([
  ["display_name", "kabul.invalid.displayName"],
  ["father_name", "kabul.invalid.father"],
  ["date_of_birth", "kabul.invalid.dateOfBirth"],
  ["nationality", "kabul.invalid.nationality"],
  ["national_id", "kabul.invalid.nationalId"],
  ["passport_no", "kabul.invalid.passport"],
  ["phone", "kabul.invalid.phone"],
  ["his_patient_reference", "kabul.invalid.his"],
  ["relative_name", "kabul.invalid.relativeName"],
  ["relative_relation", "kabul.invalid.relativeRelation"],
  ["relative_phone", "kabul.invalid.relativePhone"],
  ["companion_name", "kabul.invalid.companion"],
  ["admission_datetime", "kabul.invalid.admissionDatetime"],
  ["admission_type", "kabul.invalid.admissionType"],
  ["admission_diagnosis_free_text", "kabul.invalid.diagnosis"],
  ["weight_kg", "kabul.invalid.weight"],
  ["height_cm", "kabul.invalid.height"],
  ["allergies_text", "kabul.invalid.allergy"],
  ["comorbidity_codes", "kabul.invalid.comorbidities"],
  ["comorbidities_text", "kabul.invalid.comorbiditiesText"],
  ["consent", "kabul.invalid.consent"],
  ["admitting_unit_id", "kabul.invalid.unit"],
  ["institution", "kabul.invalid.institution"],
  ["reported_by", "kabul.invalid.reportedBy"],
  ["discharge_at", "kabul.invalid.dischargeAt"],
  ["note", "kabul.invalid.note"],
  ["name", "kabul.invalid.name"],
  ["label", "kabul.invalid.label"],
  ["icd10_codes", NOT_ON_SCREEN],
  ["active_comorbidities", NOT_ON_SCREEN],
  ["active_medications_on_admission", NOT_ON_SCREEN],
  ["known_allergies", NOT_ON_SCREEN],
  ["baseline_spo2_range", NOT_ON_SCREEN],
  ["baseline_heart_rate_range", NOT_ON_SCREEN],
  ["baseline_blood_pressure_range", NOT_ON_SCREEN],
  ["baseline_respiratory_rate_range", NOT_ON_SCREEN],
  ["baseline_temperature_range", NOT_ON_SCREEN],
  ["cardiac_surgery_name", NOT_ON_SCREEN],
  ["admission_note_narrative", NOT_ON_SCREEN],
]);
const FIELD_INVALID = "field_invalid:";

/** A coded refusal as {key, vars}, or null when it carries no code this map knows. */
function admissionCodeKey(err) {
  const code = typeof err?.apiCode === "string" ? err.apiCode : "";
  const number = typeof err?.patientNumber === "string" ? err.patientNumber.trim() : "";
  if (number && WITH_NUMBER.has(code)) return { key: WITH_NUMBER.get(code), vars: { number } };
  if (ADMISSION_CODE_KEYS.has(code)) return { key: ADMISSION_CODE_KEYS.get(code), vars: {} };
  if (code.startsWith(FIELD_INVALID)) {
    return { key: INVALID_FIELD_KEYS.get(code.slice(FIELD_INVALID.length)) ?? "kabul.invalid.other", vars: {} };
  }
  return null;
}

/** What a 5xx may say that is more exact than "the server cannot be reached". `scopeUnreadable` is
 *  the 503 of POST /stream-ticket and GET /patients/{id}/trends: the server answered, only the
 *  look-up of what the caller may see failed. The server also sends it for the acknowledge,
 *  clinical and profile writes, so the `scopeUnreadable` text is route-neutral (it names no live
 *  stream). Besides the live stream it is printed by the alarms acknowledge toast, the patient
 *  chart and the baseline profile form. */
const SERVER_ANSWERS = new Set(["errors.directoryUnreachable", "errors.directoryNotConfigured", "errors.sessionUnreachable", "errors.scopeUnreadable"]);
const REQUEST_FAILED = /^İstek başarısız \((\d{3})\)$/; // backendApi.js
// Two messages the server BUILDS rather than writes out, so they are matched by shape and their
// own tail is carried into the text. Both name permission keys — the catalogue's own identifiers
// (`alerts.ack`), which are not translated: they are what an administrator searches the
// permission table for and what a support call quotes.
// "a or b": a route either of two rights opens (GET /infinity-shadow/board: board.view or devices.manage).
const PERMISSION_REQUIRED = /^permission required: ([\w.]+(?: or [\w.]+)?)$/; // api/app.py, auth/dependencies.py
const BEYOND_OWN_RIGHTS = /^Kendi yetkilerinizi aşan bir işlem yapılamaz: (.+)$/; // admin/service.py
const PASSWORD_FIELDS = new Set(["password", "current_password", "new_password"]);

const messageOf = (err) => (typeof err === "string" ? err : typeof err?.message === "string" ? err.message : "");

/** The number a length check states: `ctx` first (backendApi keeps `min_length` / `max_length`),
 *  else pydantic's own sentence ("String should have at least 8 characters", "List should have at
 *  most 50 items after validation"). null when neither says. */
function lengthOf(item, name) {
  const stated = item?.ctx?.[name];
  if (Number.isInteger(stated)) return stated;
  const said = new RegExp(`\\bat ${name === "min_length" ? "least" : "most"} (\\d+) `).exec(String(item?.message ?? ""));
  return said ? Number(said[1]) : null;
}

/** One 422 item ({field, type, message[, ctx]}, backendApi.js) as {key, vars}, or null: pydantic's
 *  OWN checks, recognised by their type rather than by their English, with the server's number.
 *
 *  WHY ALL FIELDS, AND THE NUMBER. This used to recognise only the password fields of the auth
 *  forms, on the theory that a screen's own checks catch the rest first. The administration forms
 *  showed the theory false: every `min_length` / `max_length` on a Field (a username over 128, an
 *  e-mail over 254, a name over 200, a group name over 120, a description over 500, an empty
 *  reason, a DN under 3, a directory query under 2) reached the administrator as pydantic's English,
 *  in all four languages. And a password under its minimum of eight read "Enter your password" —
 *  reachable with a password the screen had counted as long enough (four emoji are eight UTF-16
 *  units to JavaScript and four characters to Python). "Enter your password" is now said only when
 *  the minimum is one; an empty required field is "cannot be blank", never "at least 1 characters". */
function fieldErrorKey(item) {
  if (!item) return null;
  const password = PASSWORD_FIELDS.has(item.field);
  const blank = { key: password ? "errors.passwordRequired" : "errors.mustNotBeBlank", vars: {} };
  if (item.type === "missing") return blank;
  if (item.type === "string_too_short") {
    const min = lengthOf(item, "min_length");
    return min === null || min <= 1 ? blank : { key: "errors.fieldTooShort", vars: { min } };
  }
  if (item.type === "string_too_long") {
    // A password's own sentence already names the server's limit (1024, auth/schemas.py).
    if (password) return { key: "errors.passwordTooLong", vars: {} };
    const max = lengthOf(item, "max_length");
    return max === null ? null : { key: "errors.fieldTooLong", vars: { max } };
  }
  if (item.type === "too_short") {
    const min = lengthOf(item, "min_length");
    return min === null ? null : { key: "errors.listTooShort", vars: { min } };
  }
  if (item.type === "too_long") {
    const max = lengthOf(item, "max_length");
    return max === null ? null : { key: "errors.listTooLong", vars: { max } };
  }
  // G2-B1a (A-10, A-16): the admission and discharge models refuse a field they do not have — a
  // screen and a server of two releases — and a number that is not one (`strict=True`). The weight
  // and the height say which; any other field that a number is expected.
  if (item.type === "extra_forbidden") return { key: "kabul.invalid.extraField", vars: {} };
  if (item.type === "float_type" || item.type === "int_type") {
    const field = String(item.field ?? "").split(".").at(-1);
    return { key: NUMBER_FIELDS[field] ?? "kabul.invalid.number", vars: {} };
  }
  return null;
}
/** The two number fields the admission form draws, by the sentence its own panel says for them. */
const NUMBER_FIELDS = Object.freeze({ weight_kg: "kabul.miss.weight", height_cm: "kabul.miss.height" });

/** One 422 item's own message, looked up as a message in its own right.
 *
 *  WHY THIS EXISTS. `backendApi.failure()` builds a 422's `Error.message` by joining its items as
 *  `"<field>: <message>"`, so the whole string no longer equals anything in `API_MESSAGE_KEYS` —
 *  and every validator text the administration forms can earn (`usernameRule`, `badEmail`,
 *  `mustNotBeBlank`, `badSlug`, `reasonOneLine`, `reasonNeedsText`, `badGroupDn`) was reaching the
 *  administrator as the server's raw Turkish, in all four languages, although all seven are
 *  translated. Measured, not reasoned: `apiErrorText` on a real username 422 printed
 *  `username: Kullanıcı adı 2-128 karakter olmalı; …`. The item's own `message` has no prefix, so
 *  it matches. */
function fieldMessageKey(item) {
  const key = API_MESSAGE_KEYS.get(String(item?.message ?? "").trim());
  return key ? { key: `errors.${key}`, vars: {} } : null;
}

/** A 422 split between the controls a form DRAWS and everything else, in the reader's language:
 *  `{ fields: {field: text}, others: [text] }`.
 *
 *  `rendered` is the list of API field names the form has a control for (`username`, `email`,
 *  `full_name`, `password`, `slug`, `name`, `description`, `reason`, `ad_group_dn`…); a form maps
 *  them to its own controls. `fields` goes under those controls. `others` is every refusal about
 *  something the form does not draw — an API path (`group_ids.0`, a scope's `grants.0`), a
 *  model-level item with no field, a field the server added — and it goes to the TOAST, named after
 *  the write's subject. The first version returned every item keyed by its API path, a form saw
 *  that "some field" was named and showed nothing under any control and nothing on the toast: the
 *  refusal was swallowed. An item whose message is not a known one keeps the server's words, which
 *  is still better than nothing. Both empty when the failure is not a 422 with items. */
export function fieldRefusals(t, err, rendered = []) {
  const drawn = new Set(Array.isArray(rendered) ? rendered : []);
  const fields = {};
  const others = [];
  for (const item of Array.isArray(err?.fieldErrors) ? err.fieldErrors : []) {
    if (!item) continue;
    const hit = fieldErrorKey(item) || fieldMessageKey(item);
    const text = hit ? t(hit.key, hit.vars) : String(item.message ?? "").trim();
    if (!text) continue;
    if (typeof item.field === "string" && drawn.has(item.field)) {
      if (!fields[item.field]) fields[item.field] = text;
    } else if (!others.includes(text)) {
      others.push(text);
    }
  }
  return { fields, others };
}

/** Which `errors.*` text an API failure is — {key, vars} — or null when it is not a known one.
 *  Takes an Error from backendApi (its `code` first, then its 422 items, then its message), or
 *  the message itself. */
export function apiErrorKey(err) {
  if (err && typeof err === "object" && API_CODE_KEYS.has(err.code)) {
    return { key: `errors.${API_CODE_KEYS.get(err.code)}`, vars: {} };
  }
  const coded = admissionCodeKey(err);       // G2-B1a: a coded refusal is mapped by its code
  if (coded) return coded;
  if (err && Array.isArray(err.fieldErrors)) {
    const hit = err.fieldErrors.map(fieldErrorKey).find(Boolean)
      || err.fieldErrors.map(fieldMessageKey).find(Boolean);
    if (hit) return hit;
  }
  const text = messageOf(err).trim();
  let hit = null;
  if (API_MESSAGE_KEYS.has(text)) hit = { key: `errors.${API_MESSAGE_KEYS.get(text)}`, vars: {} };
  else {
    const failed = REQUEST_FAILED.exec(text);
    const permission = PERMISSION_REQUIRED.exec(text);
    const beyond = BEYOND_OWN_RIGHTS.exec(text);
    if (failed) hit = { key: "errors.requestFailed", vars: { status: failed[1] } };
    else if (permission) hit = { key: "errors.permissionRequired", vars: { permission: permission[1] } };
    else if (beyond) hit = { key: "errors.beyondOwnRightsKeys", vars: { keys: beyond[1] } };
  }
  // A 401 that ended the session (an unlock refused because the account is gone) is not a wrong
  // username or password, whatever the server's words for it.
  if (err?.sessionEnded && hit?.key === "errors.invalidCredentials") return { key: "errors.sessionExpired", vars: {} };
  // A server that could not answer (a 5xx, an HTML error page behind the proxy during a restart)
  // is not a refusal of the credentials, whatever fallback text the client put on it. Its own
  // specific answers stay.
  if (typeof err?.status === "number" && err.status >= 500 && !(hit && SERVER_ANSWERS.has(hit.key))) {
    return { key: "errors.serverUnreachable", vars: {} };
  }
  return hit;
}

/** The failure as the user reads it: a known message translated; anything else as the server
 *  wrote it (better than nothing, and what a support call needs); nothing at all, a generic
 *  sentence. Never an empty string. */
export function apiErrorText(t, err) {
  const hit = apiErrorKey(err);
  if (hit) return t(hit.key, hit.vars);
  return messageOf(err).trim() || t("errors.unknown");
}

/** A failed READ as the user reads it: `apiErrorText`, except a timeout. `errors.requestTimeout`
 *  says the operation "may have happened; check before repeating it", which is the right warning
 *  for a write and false for a read — nothing happens when a list is not read — so a read's
 *  timeout says that nothing was read. */
export function readErrorText(t, err) {
  return apiErrorKey(err)?.key === "errors.requestTimeout" ? t("errors.readTimeout") : apiErrorText(t, err);
}

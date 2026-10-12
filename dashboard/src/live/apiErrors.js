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
  ["denetim kaydının tamamı kapsam dışı; bir patient_id verin", "auditScoped"],
  ["alarm kalitesi raporunun tamamı kapsam dışı", "alarmQualityScoped"],
  ["skor formunu yalnız bir kişi imzalayabilir", "scoreSignedByOne"],

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

/** What a 5xx may say that is more exact than "the server cannot be reached". */
const SERVER_ANSWERS = new Set(["errors.directoryUnreachable", "errors.directoryNotConfigured", "errors.sessionUnreachable"]);
const REQUEST_FAILED = /^İstek başarısız \((\d{3})\)$/; // backendApi.js
// Two messages the server BUILDS rather than writes out, so they are matched by shape and their
// own tail is carried into the text. Both name permission keys — the catalogue's own identifiers
// (`alerts.ack`), which are not translated: they are what an administrator searches the
// permission table for and what a support call quotes.
const PERMISSION_REQUIRED = /^permission required: ([\w.]+)$/;           // api/app.py, auth/dependencies.py
const BEYOND_OWN_RIGHTS = /^Kendi yetkilerinizi aşan bir işlem yapılamaz: (.+)$/; // admin/service.py
const PASSWORD_FIELDS = new Set(["password", "current_password", "new_password"]);

const messageOf = (err) => (typeof err === "string" ? err : typeof err?.message === "string" ? err.message : "");

/** One 422 item ({field, type, message}, backendApi.js) as {key, vars}, or null. Only the password
 *  fields of the auth forms: the screens' own checks catch the rest before a request is sent. */
function fieldErrorKey(item) {
  if (!item || !PASSWORD_FIELDS.has(item.field)) return null;
  if (item.type === "string_too_long") return { key: "errors.passwordTooLong", vars: {} };
  if (item.type === "string_too_short" || item.type === "missing") return { key: "errors.passwordRequired", vars: {} };
  return null;
}

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

/** Which of a form's fields a 422 is about, and what to print under it — `{field: text}`, in the
 *  reader's language. The field names are the API's (`username`, `email`, `full_name`, `password`,
 *  `slug`, `name`, `reason`, `ad_group_dn`); a form maps them to its own controls. An item whose
 *  message is not a known one keeps the server's words, which is still better under the field it is
 *  about than nowhere. Empty when the failure is not a 422 with fields. */
export function fieldRefusals(t, err) {
  const out = {};
  for (const item of Array.isArray(err?.fieldErrors) ? err.fieldErrors : []) {
    if (!item || typeof item.field !== "string" || item.field === "" || out[item.field]) continue;
    const hit = fieldErrorKey(item) || fieldMessageKey(item);
    const text = hit ? t(hit.key, hit.vars) : String(item.message ?? "").trim();
    if (text) out[item.field] = text;
  }
  return out;
}

/** Which `errors.*` text an API failure is — {key, vars} — or null when it is not a known one.
 *  Takes an Error from backendApi (its `code` first, then its 422 items, then its message), or
 *  the message itself. */
export function apiErrorKey(err) {
  if (err && typeof err === "object" && API_CODE_KEYS.has(err.code)) {
    return { key: `errors.${API_CODE_KEYS.get(err.code)}`, vars: {} };
  }
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

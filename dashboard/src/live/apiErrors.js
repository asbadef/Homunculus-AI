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
]);

/** backendApi.js `err.code`s; they win over the text. */
export const API_CODE_KEYS = new Map([
  ["REQUEST_TIMEOUT", "requestTimeout"],
  ["SESSION_SUPERSEDED", "sessionSuperseded"],
]);

/** What a 5xx may say that is more exact than "the server cannot be reached". */
const SERVER_ANSWERS = new Set(["errors.directoryUnreachable", "errors.directoryNotConfigured", "errors.sessionUnreachable"]);
const REQUEST_FAILED = /^İstek başarısız \((\d{3})\)$/; // backendApi.js
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

/** Which `errors.*` text an API failure is — {key, vars} — or null when it is not a known one.
 *  Takes an Error from backendApi (its `code` first, then its 422 items, then its message), or
 *  the message itself. */
export function apiErrorKey(err) {
  if (err && typeof err === "object" && API_CODE_KEYS.has(err.code)) {
    return { key: `errors.${API_CODE_KEYS.get(err.code)}`, vars: {} };
  }
  if (err && Array.isArray(err.fieldErrors)) {
    const hit = err.fieldErrors.map(fieldErrorKey).find(Boolean);
    if (hit) return hit;
  }
  const text = messageOf(err).trim();
  let hit = null;
  if (API_MESSAGE_KEYS.has(text)) hit = { key: `errors.${API_MESSAGE_KEYS.get(text)}`, vars: {} };
  else {
    const failed = REQUEST_FAILED.exec(text);
    if (failed) hit = { key: "errors.requestFailed", vars: { status: failed[1] } };
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

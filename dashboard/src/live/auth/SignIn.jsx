// src/live/auth/SignIn.jsx — the sign-in form (the prototype's VIEWS.login).
//
// Username or e-mail and password; an AD account signs in with the same form (spec §4). "Remember
// my username" keeps the name only — never the password — and opens nothing (roadmap:
// loginRemember). A refusal is an announced alert in the user's language; a 429 that says how long
// to wait holds the button that long. "Forgot password" says whom to ask (roadmap D4: no SMS, no
// e-mail). Nothing here is clinical data.
//
// Submit is held while a request is on its way (`busy`): the store answers a second sign-in with
// the first one's promise, but a form that still looked ready would invite the press. The hold
// after a 429 and the way it is said are the password form's (PasswordForm.jsx, useRetryHold.js):
// the refusal is the role="alert" box, read at once; the count that ticks is aria-hidden; one
// sr-only role="status" region, always mounted, is filled ONCE per hold and emptied when it ends.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { NOTICE } from "../session/sessionStore.js";
import { readRememberedUser } from "../session/browserState.js";
import { apiErrorText } from "../apiErrors.js";
import { Alert, Announce, Button, CapsWarning, Field, Icon, Input, Note, useCapsLock } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { AuthLayout } from "./AuthLayout.jsx";
import { useRetryHold } from "./useRetryHold.js";

// How the reason the form opened is shown: a plain fact, or a refusal.
const NOTICE_TONE = {
  [NOTICE.SIGNED_OUT]: "info",
  [NOTICE.ELSEWHERE]: "info",
  [NOTICE.SESSION_ENDED]: "crit",
  [NOTICE.LOCKED_OUT]: "crit",
  [NOTICE.LOCK_EXPIRED]: "info",
  [NOTICE.PASSWORD_RESET]: "crit",
  [NOTICE.NO_PERMISSIONS]: "crit",
  [NOTICE.NO_SCREEN]: "crit",
};

export function SignIn() {
  const { t } = useI18n();
  const { store, notice } = useSession();
  const [remembered] = useState(readRememberedUser);
  const [login, setLogin] = useState(remembered);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(Boolean(remembered));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const caps = useCapsLock();
  const { wait, holding, hold, current: holdNow } = useRetryHold();
  const loginRef = useRef(null);
  const passwordRef = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    (remembered ? passwordRef : loginRef).current?.focus();
  }, [remembered]);

  // Said once per hold: the text is the hold's OWN length, which does not change while it runs,
  // and it is emptied when the hold ends, so the next hold says it again (ui/Alert.jsx Announce).
  const heldFor = holding && holdNow ? t("auth.retryIn", { seconds: holdNow.seconds }) : "";

  const submit = async (event) => {
    event.preventDefault();
    if (busy || holding) return;
    setFailure(null);
    if (!login.trim()) {
      setErrors({ login: t("errors.loginRequired") });
      loginRef.current?.focus();
      return;
    }
    if (!password) {
      setErrors({ password: t("errors.passwordRequired") });
      passwordRef.current?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await store.signIn(login.trim(), password, { remember });
    } catch (err) {
      if (!mounted.current) return;
      setFailure(apiErrorText(t, err));
      if (Number.isInteger(err?.retryAfter)) hold(err.retryAfter);
      // The alert says what happened; focus goes back to the field the next attempt starts in,
      // and never stays on a submit button a hold is about to disable.
      passwordRef.current?.focus();
    } finally {
      if (mounted.current) {
        setBusy(false);
        // The password goes when the request settles, however it settled — not only on a failure.
        // A sign-in the API ACCEPTED can still be refused entry (no rights, no screen: Decision 8
        // and `noPermissions` / `noScreen`), and that leaves this form on screen at a ward
        // keyboard with the plaintext in it, one press of the show-password toggle from the next
        // person's eyes.
        setPassword("");
      }
    }
  };

  return (
    <AuthLayout>
      <h1 className="m-0 mb-1 font-display text-28 font-bold">{t("auth.title")}</h1>
      <p className="m-0 mb-5 text-14 text-mute">{t("auth.sub")}</p>
      {notice ? (
        <Alert tone={NOTICE_TONE[notice.code] ?? "crit"} className="mb-3">{t(`auth.notice.${notice.code}`)}</Alert>
      ) : null}
      {failure ? <Alert className="mb-3">{failure}</Alert> : null}
      <form noValidate onSubmit={submit}>
        <Field layout="col" required label={t("auth.username")} hint={t("auth.usernameHint")} error={errors.login}>
          <Input
            ref={loginRef}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={login}
            onChange={(e) => { setLogin(e.target.value); setErrors({}); }}
            className="h-[46px]"
          />
        </Field>
        <Field layout="col" required label={t("auth.password")} error={errors.password}>
          <Input
            ref={passwordRef}
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setErrors({}); }}
            {...caps.keys}
            className="h-[46px]"
          />
        </Field>
        <div className="-mt-1 mb-2 flex items-center justify-between gap-2">
          {/* A toggle: one name, its state in aria-pressed (a name that changes as well would
              say the state twice, and the two can disagree). */}
          <button
            type="button"
            aria-pressed={show}
            onClick={() => setShow((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-1 text-12.5 font-semibold text-pri aria-pressed:underline ${FOCUS_RING}`}
          >
            <Icon name="eye" size={15} />
            {t("auth.show")}
          </button>
          <CapsWarning shown={caps.shown} />
        </div>
        <label className="mb-[18px] mt-1.5 flex cursor-pointer select-none items-center gap-2.5 text-13">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className={`h-4 w-4 accent-[var(--pri)] ${FOCUS_RING}`}
          />
          {t("auth.remember")}
        </label>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          busy={busy}
          disabled={holding}
          className="w-full justify-center"
        >
          {busy ? t("auth.busy") : t("auth.submit")}
          {busy ? null : <Icon name="chevR" size={16} />}
        </Button>
        {holding ? <p aria-hidden="true" className="mt-2 text-12.5 text-mute">{t("auth.retryIn", { seconds: wait })}</p> : null}
        <Announce text={heldFor} />
      </form>
      <div className="mt-4">
        <button
          type="button"
          aria-expanded={helpOpen}
          aria-controls="sign-in-help"
          onClick={() => setHelpOpen((v) => !v)}
          className={`rounded-lg px-1 text-12.5 font-semibold text-pri ${FOCUS_RING}`}
        >
          {t("auth.forgot")}
        </button>
        {/* On the page while it is closed, `hidden`: a button's aria-controls must name an element
            that is there, and a disclosure that appears from nowhere names nothing. */}
        <div id="sign-in-help" hidden={!helpOpen} className="mt-2">
          <Note tone="info" icon="key">{t("auth.forgotHelp")}</Note>
        </div>
      </div>
    </AuthLayout>
  );
}

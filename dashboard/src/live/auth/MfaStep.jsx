// src/live/auth/MfaStep.jsx — the TOTP step (spec §4 "MFA enforcement", §8 "MFA enrolment").
//
// Whether it is asked at all is the server's: the groups' `mfa_required` (and the platform
// operator rule) make `requires_mfa`; nothing here assumes which groups need it (the roadmap's
// open user decision 3 can change them without touching this screen).
//
// Not enrolled: the API mints the secret (POST /auth/totp/setup) ONCE per showing — every call
// rotates it and retires the refresh tokens issued before it — so the call is kept in a ref that
// survives StrictMode's rehearsal remount. The QR is drawn here, by the `qrcode` package, with no
// network call: the secret never leaves the browser. A failure with no answer (network, 5xx) can
// be retried; a refusal (403 mfa_reset_required) cannot. The code goes to /auth/totp/verify as a
// plain request — a wrong code is a 401 that must not go through refresh-and-retry.
import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { apiErrorText } from "../apiErrors.js";
import { Alert, Announce, Button, Field, Input } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { AuthLayout, stepOf } from "./AuthLayout.jsx";

const canCopy = () => typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";

function Enrolment() {
  const { t } = useI18n();
  const { store, user } = useSession();
  const [attempt, setAttempt] = useState(0);
  const [setup, setSetup] = useState(null);
  const [failure, setFailure] = useState(null);
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);
  const call = useRef(null);
  const copyTimer = useRef(null);
  const key = `${user?.id ?? ""}|${attempt}`;

  // "Copied" fades by itself; the timer goes with the step, which is replaced the moment the
  // session moves on.
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  useEffect(() => {
    if (!call.current || call.current.key !== key) {
      setSetup(null); setFailure(null); setQr(null); setCopied(false);
      call.current = { key, promise: Promise.resolve().then(() => store.setupMfa()) };
    }
    let current = true;
    call.current.promise.then(
      (s) => {
        if (!current) return;
        setSetup(s);
        QRCode.toDataURL(s.provisioningUri, { margin: 1 })
          .then((url) => { if (current) setQr(url); })
          .catch(() => {});                     // the key below still works
      },
      (err) => { if (current) setFailure(err); },
    );
    return () => { current = false; };
  }, [key, store]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(setup?.secret || "");
    } catch {
      return;                                    // refused: do not claim it was copied
    }
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  if (failure) {
    const retryable = failure.status == null || failure.status >= 500;
    return (
      <div className="mb-4">
        <Alert className="mb-2">{apiErrorText(t, failure)}</Alert>
        {retryable ? <Button icon="swap" onClick={() => setAttempt((n) => n + 1)}>{t("auth.retry")}</Button> : null}
      </div>
    );
  }
  // A notice, not a region born with its text: ui/Alert's polite path is the only one a screen
  // reader hears (the same wait SessionWait shows for a session being checked).
  if (!setup) return <Alert tone="info" icon="clock" className="mb-4">{t("auth.loading")}</Alert>;
  return (
    <div className="mb-4 rounded-box border border-line bg-card2 p-4 text-center">
      {/* White behind the QR in both themes: a scanner needs a light quiet zone around it. */}
      {qr ? (
        <img src={qr} alt={t("auth.qrAlt")} className="mx-auto mb-3 h-36 w-36 rounded-ctl bg-[white] p-1" />
      ) : (
        <p className="mb-2 text-12 text-mute">{t("auth.qrUnavailable")}</p>
      )}
      <p className="m-0 text-11.5 text-mute">{t("auth.manualKey")}</p>
      <div className="mt-1 flex items-center justify-center gap-2">
        <code className="font-data text-14 tracking-widest">{(setup.secret || "").replace(/(.{4})/g, "$1 ").trim()}</code>
        {canCopy() ? (
          <>
            {/* The button keeps its name: a control that renames itself to "Copied" tells the
                screen reader its focus has a new label, not that anything happened — and for a
                moment its name is not an action. The confirmation stands beside it and is said
                in its own region. */}
            <button type="button" onClick={copy} className={`rounded-lg px-2 py-1 text-12 font-semibold text-pri hover:bg-card ${FOCUS_RING}`}>
              {t("auth.copy")}
            </button>
            {copied ? <span aria-hidden="true" className="text-12 font-semibold text-ok-ink">{t("auth.copied")}</span> : null}
            <Announce text={copied ? t("auth.copied") : ""} />
          </>
        ) : null}
      </div>
    </div>
  );
}

export function MfaStep() {
  const { t } = useI18n();
  const { store, mfa, steps, user } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const mounted = useRef(false);
  const enrolled = mfa?.enrolled === true;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    if (!/^\d{6}$/.test(code)) {
      setError(t("errors.invalidTotp"));
      input.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await store.verifyMfa(code);
    } catch (err) {
      if (!mounted.current) return;              // the session moved on: its answer is nobody's
      setFailure(apiErrorText(t, err));
      setCode("");
      input.current?.focus();
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <AuthLayout step={stepOf("mfa", steps)}>
      <h1 className="m-0 mb-1 font-display text-28 font-bold">{t(enrolled ? "auth.mfaTitle" : "auth.enrolTitle")}</h1>
      <p className="m-0 mb-5 text-14 text-mute">
        {user?.fullName ? <b className="text-ink">{user.fullName} · </b> : null}
        {t(enrolled ? "auth.mfaSub" : "auth.enrolSub")}
      </p>
      {enrolled ? null : <Enrolment />}
      {failure ? <Alert className="mb-3">{failure}</Alert> : null}
      <form noValidate onSubmit={submit}>
        <Field layout="col" required label={t("auth.code")} error={error}>
          <Input
            ref={input}
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
            className="h-[54px] text-center font-data text-23 font-bold tracking-[.5em]"
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" busy={busy} className="mt-2 w-full justify-center">
          {t("auth.verify")}
        </Button>
      </form>
      <button
        type="button"
        onClick={() => store.cancel()}
        disabled={busy}
        className={`mt-4 rounded-lg px-1 text-13 font-semibold text-pri disabled:opacity-45 ${FOCUS_RING}`}
      >
        ← {t("auth.back")}
      </button>
    </AuthLayout>
  );
}

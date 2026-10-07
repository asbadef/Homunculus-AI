// src/live/auth/PasswordForm.jsx — the user's own password change: the forced one after a temporary
// password (PasswordStep) and the voluntary one in Settings. One form, the server's rules
// (passwordRules.js), the server's refusals translated and put on the field they are about.
//
// Submit is held while a request is on its way: the server answers the first change with a fresh
// pair of tokens, and a second submit sent meanwhile would meet it as a stale session (401) and
// sign the user out. A 429 that says how long to wait (nginx's Retry-After; `err.retryAfter`,
// seconds) holds the button that long and says so.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { apiErrorKey, apiErrorText } from "../apiErrors.js";
import { Alert, Button, Field, Input } from "../ui/index.js";
import { PASSWORD_MIN, fieldOfRefusal, passwordProblem } from "./passwordRules.js";

const EMPTY = { current: "", next: "", repeat: "" };

/** `temporary`: the current password is the one an administrator gave (its label says so).
 *  `onDone` runs after the server took the change. */
export function PasswordForm({ temporary = false, submitLabel, onDone }) {
  const { t } = useI18n();
  const { store } = useSession();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const refs = { current: useRef(null), next: useRef(null), repeat: useRef(null) };

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const edit = (field) => (event) => {
    setForm((f) => ({ ...f, [field]: event.target.value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy || wait > 0) return;
    setFailure(null);
    const problem = passwordProblem(form);
    if (problem) {
      setErrors({ [problem.field]: t(problem.key) });
      refs[problem.field].current?.focus();     // the error is read with the field (Field)
      return;
    }
    setBusy(true);
    try {
      await store.changePassword(form.current, form.next);
      setForm(EMPTY);
      setErrors({});
      onDone?.();
    } catch (err) {
      const field = fieldOfRefusal(apiErrorKey(err)?.key);
      if (field) {
        setErrors({ [field]: apiErrorText(t, err) });
        refs[field].current?.focus();
      } else {
        setFailure(apiErrorText(t, err));
        if (Number.isInteger(err?.retryAfter)) setWait(err.retryAfter);
        // The alert says what happened; focus goes back to the first field, where the next attempt
        // starts — and never stays on a submit button a hold is about to disable.
        refs.current.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit}>
      {failure ? <Alert className="mb-3">{failure}</Alert> : null}
      <Field layout="col" required label={t(temporary ? "auth.currentTemporary" : "auth.current")} error={errors.current}>
        <Input ref={refs.current} type="password" autoComplete="current-password" value={form.current} onChange={edit("current")} />
      </Field>
      <Field layout="col" required label={t("auth.newPassword")} hint={t("auth.rule", { min: PASSWORD_MIN })} error={errors.next}>
        <Input ref={refs.next} type="password" autoComplete="new-password" value={form.next} onChange={edit("next")} />
      </Field>
      <Field layout="col" required label={t("auth.repeat")} error={errors.repeat}>
        <Input ref={refs.repeat} type="password" autoComplete="new-password" value={form.repeat} onChange={edit("repeat")} />
      </Field>
      <Button type="submit" variant="primary" size="lg" busy={busy} disabled={wait > 0} className="mt-2 w-full justify-center">
        {submitLabel}
      </Button>
      {wait > 0 ? <p role="status" className="mt-2 text-12.5 text-mute">{t("auth.retryIn", { seconds: wait })}</p> : null}
    </form>
  );
}

// src/live/auth/PasswordForm.jsx — the user's own password change: the forced one after a temporary
// password (PasswordStep) and the voluntary one in Settings. One form, the server's rules
// (passwordRules.js), the server's refusals translated and put on the field they are about.
//
// Submit is held while a request is on its way: the server answers the first change with a fresh
// pair of tokens, and a second submit sent meanwhile would meet it as a stale session (401) and
// sign the user out. A 429 that says how long to wait (nginx's Retry-After; `err.retryAfter`,
// seconds) holds the button that long (useRetryHold.js).
//
// How the hold is said — the pattern the sign-in form (Task 19) copies: the refusal itself is the
// role="alert" box, read at once. The visible count ("You can try again in 59 s") ticks every
// second and is aria-hidden: a live region that changed every second would talk over everything
// else (Decision 14: the idle warning speaks twice, not sixty times). One sr-only role="status"
// region is always mounted, empty, and is filled ONCE per hold with the hold's length — after
// ANNOUNCE_DELAY_MS, so it follows the alert instead of racing it — and emptied when the hold
// ends, so the next hold's text is a change the region announces again.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { apiErrorKey, apiErrorText } from "../apiErrors.js";
import { Alert, Button, Field, Input } from "../ui/index.js";
import { ANNOUNCE_DELAY_MS } from "../ui/Alert.jsx";
import { PASSWORD_MIN, fieldOfRefusal, passwordProblem } from "./passwordRules.js";
import { useRetryHold } from "./useRetryHold.js";

const EMPTY = { current: "", next: "", repeat: "" };

/** `temporary`: the current password is the one an administrator gave (its label says so).
 *  `onDone` runs after the server took the change — never once the form has unmounted (the step
 *  is replaced by the shell the moment the session moves on). */
export function PasswordForm({ temporary = false, submitLabel, onDone }) {
  const { t } = useI18n();
  const { store } = useSession();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const { wait, holding, hold, current: holdNow } = useRetryHold();
  const [said, setSaid] = useState("");
  const refs = { current: useRef(null), next: useRef(null), repeat: useRef(null) };
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Said once per hold, after the alert; emptied when the hold ends (see the header).
  useEffect(() => {
    if (!holdNow) return undefined;
    const timer = setTimeout(() => setSaid(t("auth.retryIn", { seconds: holdNow.seconds })), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [holdNow, t]);
  useEffect(() => {
    if (!holding) setSaid("");
  }, [holding]);

  const edit = (field) => (event) => {
    setForm((f) => ({ ...f, [field]: event.target.value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy || holding) return;
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
      if (!mounted.current) return;
      setForm(EMPTY);
      setErrors({});
      onDone?.();
    } catch (err) {
      if (!mounted.current) return;
      const field = fieldOfRefusal(apiErrorKey(err)?.key, err?.fieldErrors);
      if (field) {
        setErrors({ [field]: apiErrorText(t, err) });
        refs[field].current?.focus();
      } else {
        setFailure(apiErrorText(t, err));
        if (Number.isInteger(err?.retryAfter)) hold(err.retryAfter);
        // The alert says what happened; focus goes back to the first field, where the next attempt
        // starts — and never stays on a submit button a hold is about to disable.
        refs.current.current?.focus();
      }
    } finally {
      if (mounted.current) setBusy(false);
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
      <Button type="submit" variant="primary" size="lg" busy={busy} disabled={holding} className="mt-2 w-full justify-center">
        {submitLabel}
      </Button>
      {holding ? <p aria-hidden="true" className="mt-2 text-12.5 text-mute">{t("auth.retryIn", { seconds: wait })}</p> : null}
      <div role="status" className="sr-only">{said}</div>
    </form>
  );
}

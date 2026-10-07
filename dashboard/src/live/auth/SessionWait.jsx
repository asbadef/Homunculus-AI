// src/live/auth/SessionWait.jsx — while a stored session is checked (a page load), and when the
// server did not answer that check. The tokens are kept in the second case: an outage never signs
// a clinician out (liveStore.js's rule). Retry, or sign out by choice.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { PHASE } from "../session/sessionStore.js";
import { apiErrorText } from "../apiErrors.js";
import { Alert, Button } from "../ui/index.js";
import { AuthLayout } from "./AuthLayout.jsx";

export function SessionWait() {
  const { t } = useI18n();
  const { phase, error, store } = useSession();
  if (phase === PHASE.RESTORING) {
    return (
      <AuthLayout>
        <h1 className="sr-only">{t("auth.title")}</h1>
        <p role="status" className="text-14 text-mute">{t("auth.restoring")}</p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <h1 className="m-0 mb-1 font-display text-28 font-bold">{t("auth.unreachableTitle")}</h1>
      <p className="m-0 mb-4 text-14 text-mute">{t("auth.unreachableBody")}</p>
      {error ? <Alert className="mb-4">{apiErrorText(t, error)}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon="swap" onClick={() => store.retry()}>{t("auth.retry")}</Button>
        <Button variant="ghost" icon="out" onClick={() => store.signOut()}>{t("auth.leave")}</Button>
      </div>
    </AuthLayout>
  );
}

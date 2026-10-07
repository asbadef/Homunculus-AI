// src/live/auth/PasswordStep.jsx — a temporary password is replaced before anything else (roadmap
// D4; the server holds every other route at 403 `password_change_required` meanwhile). After the
// TOTP step when both are due. Leaving signs out: nothing of the session is kept.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { FOCUS_RING } from "../ui/focus.js";
import { AuthLayout, stepOf } from "./AuthLayout.jsx";
import { PasswordForm } from "./PasswordForm.jsx";

export function PasswordStep() {
  const { t } = useI18n();
  const { store, steps } = useSession();
  return (
    <AuthLayout step={stepOf("password", steps)}>
      <h1 className="m-0 mb-1 font-display text-28 font-bold">{t("auth.passwordTitle")}</h1>
      <p className="m-0 mb-5 text-14 text-mute">{t("auth.passwordSub")}</p>
      <PasswordForm temporary submitLabel={t("auth.saveAndContinue")} />
      <button
        type="button"
        onClick={() => store.cancel()}
        className={`mt-4 rounded-lg px-1 text-13 font-semibold text-pri ${FOCUS_RING}`}
      >
        {t("auth.leave")}
      </button>
    </AuthLayout>
  );
}

// src/live/screens/admin/TresReadFailed.jsx — a TRƏS panel whose read failed (review of the F1 panels, 2026-11-13): the
// refusal in words and a button to read again, as ProtocolTab and the settings form do (`admin.retry`). A panel that
// stood on nothing it had read says so and offers the retry — it never draws a form or a list on defaults.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { Alert, Button } from "../../ui/index.js";

export function TresReadFailed({ text, busy = false, onRetry }) {
  const { t } = useI18n();
  return (
    <Alert tone="crit">
      <p className="m-0">{text}</p>
      <Button size="sm" className="mt-2" busy={busy} onClick={onRetry}>{t("admin.retry")}</Button>
    </Alert>
  );
}

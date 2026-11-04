import React from "react";
import { Screen, Placeholder } from "../../src/ui/base";
import { useI18n } from "../../src/i18n";

export default function ResultsScreen() {
  const { t } = useI18n();
  return (
    <Screen>
      <Placeholder title={t("results.title")} note={t("demo.badge")} />
    </Screen>
  );
}

import React from "react";
import { Screen, Placeholder } from "../../src/ui/base";
import { useI18n } from "../../src/i18n";

export default function HomeScreen() {
  const { t } = useI18n();
  return (
    <Screen>
      <Placeholder title={t("tab.home")} note={t("demo.badge")} />
    </Screen>
  );
}

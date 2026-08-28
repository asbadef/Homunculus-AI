import { Text, View } from "react-native";

import { t } from "../i18n";

export function DemoBanner() {
  return (
    <View
      accessibilityLabel="demo-banner"
      className="border-b border-clinical-border bg-card px-4 py-1.5"
    >
      <Text className="text-clinical-stale text-center text-[11px] font-semibold tracking-wide">
        {t("app.demoBanner")}
      </Text>
    </View>
  );
}

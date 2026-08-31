import { Text, View } from "react-native";

import { t } from "../i18n";

// M6/Task 4: the kit's wash card, laid flat against the top of the screen — a rounded-bottom
// strip rather than M5's hard-edged, bordered bar. Same `bg-card`/`text-clinical-stale` pairing
// as every other wash surface (already AA-tested), just without the border stroke the kit never
// uses on a plain wash.
export function DemoBanner() {
  return (
    <View accessibilityLabel="demo-banner" className="bg-card rounded-b-[22px] px-4 py-2">
      <Text className="text-clinical-stale text-center text-[11px] font-semibold tracking-wide">
        {t("app.demoBanner")}
      </Text>
    </View>
  );
}

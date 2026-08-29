import { View } from "react-native";

import { t } from "../i18n";
import { useTheme } from "../theme/ThemeContext";
import { Chip, Row } from "./SettingsPanel";

// The theme picker is the one screen-level piece of UI allowed to reach into useTheme()
// directly: there is no screen logic above it to own the setting, the skin IS the setting.
export function ThemeSection() {
  const { key, setTheme } = useTheme();
  return (
    <Row title={t("theme.title")}>
      <View className="flex-row gap-2">
        <Chip label={t("theme.icu")} active={key === "icu"} onPress={() => setTheme("icu")} />
        <Chip
          label={t("theme.light")}
          active={key === "light"}
          onPress={() => setTheme("light")}
        />
      </View>
    </Row>
  );
}

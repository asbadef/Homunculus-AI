import { useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useBoard } from "../../src/store/BoardProvider";
import { DemoBanner } from "../../src/ui/DemoBanner";
import { SettingsPanel } from "../../src/ui/SettingsPanel";

export default function SettingsScreen() {
  const { controls, settings, setRole, setHaptics, setThresholdMs, setSpeed } = useBoard();
  const [playing, setPlaying] = useState(() => controls.isPlaying());

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <DemoBanner />
      <View className="px-4 pb-1 pt-3">
        <Text className="text-foreground text-2xl font-semibold">{t("settings.title")}</Text>
      </View>
      <SettingsPanel
        settings={settings}
        playing={playing}
        onPlay={() => {
          controls.play();
          setPlaying(true);
        }}
        onPause={() => {
          controls.pause();
          setPlaying(false);
        }}
        onRestart={() => controls.restart()}
        onSpeed={setSpeed}
        onRole={setRole}
        onHaptics={setHaptics}
        onThreshold={setThresholdMs}
        version="1.0.0"
      />
    </SafeAreaView>
  );
}

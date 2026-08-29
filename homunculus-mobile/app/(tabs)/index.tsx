import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useBoard } from "../../src/store/BoardProvider";
import { tintFor } from "../../src/theme/tint";
import { useTheme } from "../../src/theme/ThemeContext";
import { DemoBanner } from "../../src/ui/DemoBanner";
import { WardList } from "../../src/ui/WardList";

export default function PatientsScreen() {
  const { ward, mode, connection } = useBoard();
  const { key, palette } = useTheme();
  const router = useRouter();

  // The spec's locked rule: empty and unreachable must never look alike. In live mode a ward is
  // only honestly "empty" while the connection is open; anything else is the connection's state,
  // said out loud instead of skeletons forever.
  const liveDisconnected = mode === "live" && connection !== "open";

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      {mode === "replay" ? <DemoBanner /> : null}
      <View className="px-4 pb-2 pt-3">
        <Text className="text-foreground text-2xl font-semibold">{t("ward.title")}</Text>
        <Text className="text-clinical-stale text-xs">{t("ward.subtitle")}</Text>

        {/* Cockpit-style bar: a single "Tümü" unit tab (only one ward exists on mobile, so it is
            always active) + a right-aligned occupancy chip. Every recorded bed is occupied, so
            occupied === total for now — honest rather than inventing a vacancy concept. Active
            tab reuses the tinted-chip idiom (accent text on a faint accent wash, src/theme/
            tint.ts) rather than a solid accent fill: accent is chrome-only in this palette, so
            this pair only has to clear the 3:1 chrome bar, not the 4.5:1 body-text one — see the
            composited case in __tests__/contrast.test.ts. */}
        <View className="mt-3 flex-row items-center gap-2">
          <View
            className="rounded-lg border px-3 py-1.5"
            style={{ borderColor: palette.accent, backgroundColor: tintFor(palette.accent, key) }}
          >
            <Text className="text-xs font-semibold" style={{ color: palette.accent }}>
              {t("ward.allUnits")}
            </Text>
          </View>
          <View className="border-clinical-border ml-auto rounded-lg border px-3 py-1.5">
            <Text className="text-clinical-stale text-xs font-medium">
              {t("ward.occupancy", { occupied: ward.length, total: ward.length })}
            </Text>
          </View>
        </View>
      </View>
      {liveDisconnected && ward.length === 0 ? (
        <View className="flex-1 items-center justify-center p-8">
          <Text
            accessibilityLabel="connection-state"
            className="text-clinical-warning text-center"
          >
            {t(connection === "reconnecting" ? "server.status.reconnecting" : "server.status.connecting")}
          </Text>
        </View>
      ) : (
        <WardList
          ward={ward}
          // Replay: the recording never empties mid-run, so "no beds yet" and "loading" coincide.
          // Live: an open connection with zero beds is a genuinely empty ward — show the empty
          // text, not skeletons.
          loading={mode === "replay" && ward.length === 0}
          onSelect={(patientId) => router.push(`/patient/${patientId}`)}
        />
      )}
    </SafeAreaView>
  );
}

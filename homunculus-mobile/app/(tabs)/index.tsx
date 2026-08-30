import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useBoard } from "../../src/store/BoardProvider";
import { DemoBanner } from "../../src/ui/DemoBanner";
import { WardList } from "../../src/ui/WardList";

export default function PatientsScreen() {
  const { ward, mode, connection } = useBoard();
  const router = useRouter();

  // The spec's locked rule: empty and unreachable must never look alike. In live mode a ward is
  // only honestly "empty" while the connection is open; anything else is the connection's state,
  // said out loud instead of skeletons forever.
  const liveDisconnected = mode === "live" && connection !== "open";

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      {mode === "replay" ? <DemoBanner /> : null}
      {/* M5: the cockpit-style title/subtitle + Tümü/Doluluk bar is gone — the ward reads as a
          bedside monitor now, and a monitor's chrome is minimal: the unit name and one honest
          status line (bed count, and whether what's on screen is live or recorded). */}
      <View className="flex-row items-baseline justify-between px-3 pb-2 pt-3">
        <Text className="text-foreground text-[15px] font-bold tracking-wide">
          {t("ward.monitorTitle")}
        </Text>
        <Text className="text-clinical-stale text-[10px] tabular-nums">
          {t(mode === "live" ? "ward.monitorStatus.live" : "ward.monitorStatus.replay", {
            n: ward.length,
          })}
        </Text>
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

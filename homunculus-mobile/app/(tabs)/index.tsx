import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useBoard } from "../../src/store/BoardProvider";
import { useTheme } from "../../src/theme/ThemeContext";
import { DemoBanner } from "../../src/ui/DemoBanner";
import { WardList } from "../../src/ui/WardList";

function Chip({
  label,
  solid,
  alignEnd,
}: {
  label: string;
  solid?: boolean;
  alignEnd?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <View
      className="rounded-full px-3 py-1.5"
      style={{
        backgroundColor: solid ? palette.accent : palette.soft,
        marginLeft: alignEnd ? "auto" : undefined,
      }}
    >
      <Text
        className="text-[11px] font-bold"
        style={{ color: solid ? "#ffffff" : palette.accent }}
      >
        {label}
      </Text>
    </View>
  );
}

export default function PatientsScreen() {
  const { ward, mode, connection, acknowledge } = useBoard();
  const router = useRouter();

  // The spec's locked rule: empty and unreachable must never look alike. In live mode a ward is
  // only honestly "empty" while the connection is open; anything else is the connection's state,
  // said out loud instead of skeletons forever.
  const liveDisconnected = mode === "live" && connection !== "open";

  const criticalCount = ward.filter((v) => v.board.risk === "critical").length;
  const alertCount = ward.reduce((sum, v) => sum + v.board.alerts.length, 0);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      {mode === "replay" ? <DemoBanner /> : null}
      {/* M6: the kit's ward chrome — a centred blue title (blue on the white ground, which IS the
          panel surface here) and a chip row carrying the ward's facts: the single-unit "Tümü" tab,
          critical/alert counts, occupancy, and the KAYIT/CANLI honesty chip that M5 introduced. */}
      <View className="px-4 pb-1 pt-2">
        <Text className="text-accent text-center text-[19px] font-bold">{t("ward.title")}</Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-1.5 px-4 pb-2">
        <Chip label={t("ward.allUnits")} solid />
        <Chip label={t("ward.criticalCount", { n: criticalCount })} />
        <Chip label={t("ward.warningCount", { n: alertCount })} />
        <Chip
          alignEnd
          label={`${t("ward.occupancy", { occupied: ward.length, total: ward.length })} · ${t(
            mode === "live" ? "ward.sourceLive" : "ward.sourceReplay",
          )}`}
        />
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
          onAck={(patientId, kind) => acknowledge(patientId, kind)}
        />
      )}
    </SafeAreaView>
  );
}

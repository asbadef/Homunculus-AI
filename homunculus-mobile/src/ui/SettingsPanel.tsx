import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import type { ReactNode } from "react";

import { t } from "../i18n";
import type { Settings } from "../store/BoardProvider";
import { tokens } from "../theme/tokens";
import type { Role } from "../transport/types";

const SPEEDS = [1, 2, 4];
const THRESHOLDS_MS = [10_000, 20_000, 60_000];

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mb-4 rounded-xl border border-clinical-border bg-card p-4">
      <Text className="text-clinical-stale text-[11px] font-semibold uppercase tracking-wide">
        {title}
      </Text>
      <View className="mt-2">{children}</View>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-lg border px-3 py-1.5"
      style={{ borderColor: active ? tokens.clinical.safe : tokens.clinical.border }}
    >
      <Text
        className="text-sm"
        style={{ color: active ? tokens.clinical.safe : tokens.clinical.stale }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function SettingsPanel({
  settings,
  playing,
  onPlay,
  onPause,
  onRestart,
  onSpeed,
  onRole,
  onHaptics,
  onThreshold,
  version,
}: {
  settings: Settings;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onRestart: () => void;
  onSpeed: (speed: number) => void;
  onRole: (role: Role) => void;
  onHaptics: (enabled: boolean) => void;
  onThreshold: (ms: number) => void;
  version: string;
}) {
  return (
    <ScrollView contentContainerClassName="p-4">
      <Row title={t("settings.playback")}>
        <View className="flex-row gap-2">
          <Chip
            label={playing ? t("settings.pause") : t("settings.play")}
            active
            onPress={playing ? onPause : onPlay}
          />
          <Chip label={t("settings.restart")} active={false} onPress={onRestart} />
        </View>
        <View className="mt-3 flex-row items-center gap-2">
          <Text className="text-clinical-stale text-sm">{t("settings.speed")}</Text>
          {SPEEDS.map((speed) => (
            <Chip
              key={speed}
              label={`${speed}x`}
              active={settings.speed === speed}
              onPress={() => onSpeed(speed)}
            />
          ))}
        </View>
      </Row>

      <Row title={t("settings.role")}>
        <View className="flex-row gap-2">
          <Chip
            label={t("settings.role.nurse")}
            active={settings.role === "nurse"}
            onPress={() => onRole("nurse")}
          />
          <Chip
            label={t("settings.role.doctor")}
            active={settings.role === "doctor"}
            onPress={() => onRole("doctor")}
          />
        </View>
      </Row>

      <Row title={t("settings.haptics")}>
        <Switch value={settings.haptics} onValueChange={onHaptics} />
      </Row>

      <Row title={t("settings.threshold")}>
        <View className="flex-row gap-2">
          {THRESHOLDS_MS.map((ms) => (
            <Chip
              key={ms}
              label={`${ms / 1000}s`}
              active={settings.thresholdMs === ms}
              onPress={() => onThreshold(ms)}
            />
          ))}
        </View>
        <Text className="text-clinical-stale mt-2 text-[11px]">{t("settings.thresholdNote")}</Text>
      </Row>

      <Row title={t("settings.dataSource")}>
        <Text className="text-foreground text-sm">{t("settings.dataSourceValue")}</Text>
      </Row>

      <Row title={t("settings.version")}>
        <Text className="text-clinical-stale text-sm">{version}</Text>
      </Row>
    </ScrollView>
  );
}

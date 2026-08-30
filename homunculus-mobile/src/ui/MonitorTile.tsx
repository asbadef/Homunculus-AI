import { MotiPressable } from "moti/interactions";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { MotiView } from "moti";

import { flagKeyFor } from "../domain/flags";
import { severityTone } from "../domain/risk";
import { t } from "../i18n";
import type { PatientView } from "../store/boardStore";
import { bedNumber } from "./bed";
import { GLOW_DURATION_MS, PRESS_SCALE, SPRING } from "../theme/motion";
import { tintFor } from "../theme/tint";
import { useTheme } from "../theme/ThemeContext";
import { Waveform } from "./Waveform";

interface ChannelSpec {
  latestKey: "heart_rate" | "map" | "lactate";
  paletteKey: "hr" | "map" | "lactate";
  labelKey: "channel.hr" | "channel.map" | "channel.lactate";
  unit: string;
}

// NABIZ / OAB / LAKTAT, in that order — the three vitals the mockup charts as oversized channel
// numerals. Heart rate also drives row 3's waveform when present; it stays a channel cell too
// (mostly "—" today, since the recording never populates HR) rather than being special-cased out.
const CHANNELS: ChannelSpec[] = [
  { latestKey: "heart_rate", paletteKey: "hr", labelKey: "channel.hr", unit: "/dk" },
  { latestKey: "map", paletteKey: "map", labelKey: "channel.map", unit: "mmHg" },
  { latestKey: "lactate", paletteKey: "lactate", labelKey: "channel.lactate", unit: "mmol/L" },
];

// M5: variant B — the ward stops looking like a dashboard of cards and starts looking like the
// instrument clinicians already trust. Replaces PatientCard (see docs/superpowers/specs/
// 2026-08-30-mobile-monitor-m5-design.md): full-width, hairline-separated, no card frame, channel-
// coloured oversized numerals instead of the five-cell grid. The mockup's summary line is
// deliberately omitted — variant B carries reasoning on the detail screen, not the tile; the tile
// is scan speed, not explanation.
export function MonitorTile({ view, onPress }: { view: PatientView; onPress: () => void }) {
  const { key, palette, toneColor } = useTheme();
  const { board, top } = view;
  const bedLabel = t("bed.tileLabel", { bed: bedNumber(board.patient_id) });
  const hr = board.latest.heart_rate;
  const sofa = board.latest.sofa;

  const flagTone = top ? severityTone(top.severity) : "muted";
  const flagColor = toneColor(flagTone);
  const flagTint = tintFor(flagColor, key);
  const flagText = t(flagKeyFor(top));

  const criticalColor = toneColor("critical");
  const warningColor = toneColor("warning");

  const animate = useMemo(
    () =>
      ({ pressed }: { pressed: boolean }) => {
        "worklet";
        return { scale: pressed ? PRESS_SCALE : 1 };
      },
    [],
  );

  return (
    <MotiPressable
      accessibilityLabel={`patient-card-${board.patient_id}`}
      onPress={onPress}
      animate={animate}
      transition={{ type: "spring", ...SPRING }}
    >
      <View className="border-clinical-border relative border-b px-3 py-3">
        {/* A monitor has no card to glow, so escalation is a left-edge bar instead of the old
            card-wide glow — pulsing on its own, not the whole tile. Absolutely positioned so its
            presence/absence never shifts row content, which sits inside the same left padding
            either way. */}
        {view.escalated ? (
          <MotiView
            from={{ opacity: 0.55 }}
            animate={{ opacity: 1 }}
            transition={{ type: "timing", duration: GLOW_DURATION_MS, loop: true }}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 3,
              backgroundColor: palette.clinical.critical,
            }}
          />
        ) : null}

        <View className="flex-row items-center justify-between">
          <Text className="text-clinical-stale text-[10px] font-bold uppercase tracking-wide">
            {bedLabel}
          </Text>
          <View
            className="rounded border px-2 py-0.5"
            style={{ borderColor: flagColor, backgroundColor: flagTint }}
          >
            <Text
              className="text-[9px] font-bold uppercase tracking-widest"
              style={{ color: flagColor }}
            >
              {flagText}
            </Text>
          </View>
        </View>

        <View className="mt-2 flex-row items-end gap-3">
          {CHANNELS.map(({ latestKey, paletteKey, labelKey, unit }) => {
            const value = board.latest[latestKey];
            const channelColor = palette.channel[paletteKey];
            return (
              <View key={latestKey} className="flex-1">
                <Text
                  className="text-[8.5px] font-bold uppercase tracking-wide"
                  style={{ color: channelColor }}
                >
                  {t(labelKey)}
                </Text>
                <Text
                  className="text-[30px] font-bold leading-tight tabular-nums"
                  style={{ color: value === null ? palette.clinical.stale : channelColor }}
                >
                  {value ?? "—"}
                </Text>
                <Text className="text-clinical-stale text-[8px]">{unit}</Text>
              </View>
            );
          })}
        </View>

        {hr != null ? (
          <View className="mt-2">
            <Waveform hr={hr} height={30} stroke={palette.channel.hr} />
          </View>
        ) : null}

        <Text className="text-clinical-stale mt-2 text-[10px]">
          {t("vital.sofa")}{" "}
          <Text className="text-foreground font-bold tabular-nums">{sofa ?? "—"}</Text>
          {view.escalated ? (
            <Text style={{ color: criticalColor }} className="font-bold">
              {" "}
              · {t("tile.escalated")}
            </Text>
          ) : view.unacknowledged ? (
            <Text style={{ color: warningColor }} className="font-semibold">
              {" "}
              · {t("tile.unacknowledged")}
            </Text>
          ) : null}
        </Text>
      </View>
    </MotiPressable>
  );
}

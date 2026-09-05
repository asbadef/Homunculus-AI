import { Check, ChevronRight } from "lucide-react-native";
import { MotiPressable } from "moti/interactions";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { MotiView } from "moti";

import { flagKeyFor } from "../domain/flags";
import { isAcknowledged, severityTone } from "../domain/risk";
import { t } from "../i18n";
import type { PatientView } from "../store/boardStore";
import { bedNumber } from "./bed";
import { GLOW_DURATION_MS, PRESS_SCALE, SPRING } from "../theme/motion";
import palettes from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";
import { Waveform } from "./Waveform";

/** A severity pill / ring never renders "muted" here — a bed with no open alert is drawn as
 *  calm/"stabil" green, not grey, per the approved mockup (see the M6 spec's BedCard row). */
type SevTone = "safe" | "warning" | "critical";

function StatPill({ label, value }: { label: string; value: number | string | null }) {
  const { palette } = useTheme();
  return (
    <View
      className="bg-panel flex-row items-center gap-1 rounded-full px-2 py-1"
      style={{ borderWidth: 1, borderColor: palette.clinical.border }}
    >
      <Text className="text-clinical-stale text-[9px] font-bold uppercase tracking-wide">
        {label}
      </Text>
      <Text className="text-foreground text-[11px] font-bold tabular-nums">{value ?? "—"}</Text>
    </View>
  );
}

// M6: BedCard replaces MonitorTile (M5) — the ward now speaks the Figma kit's own anatomy: a
// pale-wash card holding a severity-ringed avatar circle, a white inner panel for the bed's
// identity (blue text's only legal surface — see src/theme/palette.js), a pill stat row, and a
// column of circular actions. See docs/superpowers/specs/2026-08-31-mobile-kit-language-m6-
// design.md's "Bed card" row for the anatomy this mirrors.
export function BedCard({
  view,
  onPress,
  onAck,
}: {
  view: PatientView;
  onPress: () => void;
  /** (patientId, alertKind) — only ever called for the bed's top alert, and only wired up when
   *  one exists (see the `✓` button below). */
  onAck: (patientId: string, kind: string) => void;
}) {
  const { palette, toneColor } = useTheme();
  const { board, top } = view;
  const bedLabel = board.identity?.bed_label || t("bed.tileLabel", { bed: bedNumber(board.patient_id) });

  const alertTone = top === null ? "safe" : view.escalated ? "critical" : severityTone(top.severity);
  // severityTone's type admits "muted" (it shares riskTone), but a real alert severity never
  // maps there; the calm-green fallback keeps the type honest either way.
  const sevTone: SevTone = alertTone === "muted" ? "safe" : alertTone;
  const ringColor = toneColor(sevTone);
  const pillFill = palette.sevSolid[sevTone];
  const pillText = palettes.sevSolidText[sevTone];
  const flagLabel = t(flagKeyFor(top));

  const acked = top !== null && isAcknowledged(board, top, view.acknowledgedKeys);

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
      <View className="bg-card mb-3 rounded-[22px] p-3" style={{ position: "relative" }}>
        {view.escalated ? (
          <MotiView
            from={{ opacity: 0.55 }}
            animate={{ opacity: 1 }}
            transition={{ type: "timing", duration: GLOW_DURATION_MS, loop: true }}
            style={{
              position: "absolute",
              left: 10,
              right: 10,
              top: 6,
              height: 3,
              borderRadius: 2,
              backgroundColor: palette.clinical.critical,
            }}
          />
        ) : null}

        <View className="flex-row items-start gap-3">
          {/* The avatar slot: the kit's white-panel circle (this skin's "white"), ringed in the
              bed's current severity colour. */}
          <View
            className="bg-panel h-12 w-12 items-center justify-center rounded-full"
            style={{ borderWidth: 3, borderColor: ringColor }}
          >
            <Text className="text-foreground text-[15px] font-extrabold tabular-nums">
              {bedNumber(board.patient_id)}
            </Text>
          </View>

          <View className="flex-1 gap-2">
            {/* The kit's white inner panel — the only surface bed name (blue) may sit on. */}
            <View className="bg-panel rounded-[14px] px-3 py-2">
              <Text className="text-accent text-[13px] font-extrabold">{bedLabel}</Text>
              {board.identity?.display_name ? (
                <Text className="text-foreground text-[13px] font-semibold" numberOfLines={1}>
                  {board.identity.display_name}
                </Text>
              ) : (
                <Text className="text-clinical-stale text-[11px]">{t("identity.missing")}</Text>
              )}
              {board.identity ? (
                <Text className="text-clinical-stale text-[11px]">
                  {board.identity.source === "comed" ? "Comed" : t("identity.manual")}
                  {board.identity.updated_at ? ` · ${new Date(board.identity.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                  {board.identity.state === "discharged" ? ` · ${t("identity.discharged")}` : ""}
                </Text>
              ) : null}
              {top !== null ? (
                <Text className="text-foreground mt-0.5 text-[11px] leading-4" numberOfLines={2}>
                  {top.summary}
                </Text>
              ) : null}
            </View>

            <View className="flex-row flex-wrap items-center gap-1.5">
              <View
                className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
                style={{ backgroundColor: pillFill }}
              >
                <Text
                  className="text-[9px] font-bold uppercase tracking-widest"
                  style={{ color: pillText }}
                >
                  {flagLabel}
                </Text>
              </View>
              {view.escalated ? (
                <View
                  className="rounded-full px-2.5 py-1"
                  style={{ backgroundColor: palette.sevSolid.critical }}
                >
                  <Text
                    className="text-[9px] font-bold uppercase tracking-widest"
                    style={{ color: palettes.sevSolidText.critical }}
                  >
                    {t("tile.escalatedPill")}
                  </Text>
                </View>
              ) : null}
              <StatPill label={t("vital.map")} value={board.latest.map} />
              <StatPill label={t("vital.lactateShort")} value={board.latest.lactate} />
              <StatPill label={t("vital.sofa")} value={board.latest.sofa} />
            </View>

            {board.latest.heart_rate != null ? (
              <Waveform hr={board.latest.heart_rate} height={26} />
            ) : null}
          </View>

          <View className="items-center gap-2">
            {top !== null ? (
              <Pressable
                accessibilityLabel={`ack-${board.patient_id}`}
                accessibilityState={{ disabled: acked }}
                onPress={(e) => {
                  e.stopPropagation();
                  onAck(board.patient_id, top.kind);
                }}
                className="h-9 w-9 items-center justify-center rounded-full"
                style={{ backgroundColor: acked ? palette.soft : palette.accent }}
              >
                <Check size={16} color={acked ? palette.accent : "#ffffff"} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel={`patient-card-${board.patient_id}-chevron`}
              onPress={onPress}
              className="h-9 w-9 items-center justify-center rounded-full"
              style={{ backgroundColor: palette.soft }}
            >
              <ChevronRight size={16} color={palette.accent} />
            </Pressable>
          </View>
        </View>
      </View>
    </MotiPressable>
  );
}

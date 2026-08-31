import { MotiView } from "moti";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { flagKeyForKind } from "../domain/flags";
import { severityTone } from "../domain/risk";
import { t } from "../i18n";
import { SPRING } from "../theme/motion";
import palettes from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";
import type { BoardNotification } from "../transport/types";

/** Mirrors BedCard/AlertCard/NotificationFeed's own SevTone note. */
type SevTone = "safe" | "warning" | "critical";

// This file is deliberately expo-router-free. `useRouter` pulls in expo-router's
// `standard-navigation` dependency, which ships ESM the project's jest transformIgnorePatterns
// does not cover — importing it here would break every test that touches this module, including
// the presentational/hook tests that never need routing. The root layout (a route file, already
// outside the unit-tested surface) owns the `useRouter` + `useBoard` wiring instead.

const DISMISS_MS = 5000;

/** Same shape as an escalation: a routine/soon alert never earns a toast. */
function isToastable(note: BoardNotification): boolean {
  return note.trigger === "escalation" || note.urgency === "immediate";
}

/**
 * Tracks the newest toastable notification and auto-clears it after `dismissMs`.
 *
 * The seen-ts ref advances before the toastable check, matching useAlertHaptics' shape for
 * consistency. Unlike the haptics hook — where the gate (`enabled`) can change later and the
 * ordering is load-bearing — `isToastable` is a pure function of the note, so for any given ts
 * the ordering is not observable. It is kept this way so the two hooks read identically, not
 * because this one needs it.
 */
export function useToastQueue(
  latest: BoardNotification | null,
  dismissMs: number = DISMISS_MS,
): { visible: BoardNotification | null; dismiss: () => void } {
  const lastTs = useRef<string | null>(null);
  const [visible, setVisible] = useState<BoardNotification | null>(null);

  useEffect(() => {
    if (latest === null) return;
    if (latest.ts === lastTs.current) return;
    lastTs.current = latest.ts;
    if (!isToastable(latest)) return;
    setVisible(latest);
  }, [latest]);

  useEffect(() => {
    if (visible === null) return;
    const id = setTimeout(() => setVisible(null), dismissMs);
    return () => clearTimeout(id);
  }, [visible, dismissMs]);

  return { visible, dismiss: () => setVisible(null) };
}

// M6/Task 4: the kit's card anatomy — white panel ground (the toast floats over the ward/detail
// screen the same way the kit's own cards sit on white), a solid severity pill carrying the
// finding's own name (the same lookup NotificationFeed/AlertCard/BedCard use), then the server's
// title/body verbatim. No separate dismiss/ack pill exists here (there never was one — the whole
// card is the tap target, and it still auto-clears on the same timer), so none is added.
/** Presentational banner for one notification. Purely a function of its props — no store access. */
export function AlertToast({
  note,
  onPress,
  onDismiss,
}: {
  note: BoardNotification;
  onPress: (patientId: string) => void;
  onDismiss: () => void;
}) {
  const { palette } = useTheme();
  const sevTone: SevTone = severityTone(note.severity) as SevTone;
  const pillFill = palette.sevSolid[sevTone];
  const pillText = palettes.sevSolidText[sevTone];

  return (
    <MotiView
      from={{ opacity: 0, translateY: -24 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: "spring", ...SPRING }}
      style={{ borderWidth: 1, borderColor: palette.clinical.border }}
      className="bg-panel mx-4 overflow-hidden rounded-[22px] p-3"
    >
      <Pressable
        accessibilityLabel="alert-toast"
        accessibilityRole="button"
        onPress={() => {
          onDismiss();
          onPress(note.patient_id);
        }}
      >
        <View
          className="flex-row items-center gap-1 self-start rounded-full px-2.5 py-1"
          style={{ backgroundColor: pillFill }}
        >
          <Text
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color: pillText }}
          >
            {t(flagKeyForKind(note.kind, note.severity))}
          </Text>
        </View>
        <Text className="text-foreground mt-2 text-xs font-semibold">{note.title}</Text>
        <Text className="text-foreground mt-1 text-sm">{note.body}</Text>
      </Pressable>
    </MotiView>
  );
}

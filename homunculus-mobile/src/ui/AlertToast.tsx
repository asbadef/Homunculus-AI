import { MotiView } from "moti";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text } from "react-native";

import { severityTone } from "../domain/risk";
import { SPRING } from "../theme/motion";
import { useTheme } from "../theme/ThemeContext";
import type { BoardNotification } from "../transport/types";

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
  const { toneColor } = useTheme();
  const color = toneColor(severityTone(note.severity));

  return (
    <MotiView
      from={{ opacity: 0, translateY: -24 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: "spring", ...SPRING }}
      style={{ borderColor: color }}
      className="mx-4 overflow-hidden rounded-2xl border bg-card p-3"
    >
      <Pressable
        accessibilityLabel="alert-toast"
        accessibilityRole="button"
        onPress={() => {
          onDismiss();
          onPress(note.patient_id);
        }}
      >
        <Text className="text-xs font-semibold" style={{ color }}>
          {note.title}
        </Text>
        <Text className="text-foreground mt-1 text-sm">{note.body}</Text>
      </Pressable>
    </MotiView>
  );
}

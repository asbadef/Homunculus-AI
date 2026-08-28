import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";

import type { BoardNotification } from "../transport/types";

/**
 * Urgency should be felt, not only read. An escalation gets the heavier pattern than a new alert,
 * so a pocket buzz alone distinguishes "something new" from "nobody answered".
 */
export function useAlertHaptics(latest: BoardNotification | null, enabled: boolean): void {
  const lastTs = useRef<string | null>(null);

  useEffect(() => {
    if (latest === null) return;
    if (latest.ts === lastTs.current) return;
    // Track BEFORE the enabled gate: a notification that arrived while haptics were muted must
    // not buzz later when the clinician unmutes — a stale buzz reads as "something just
    // happened", which is the wrong signal on a clinical surface.
    lastTs.current = latest.ts;
    if (!enabled) return;
    if (latest.trigger === "escalation") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (latest.urgency === "immediate") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [latest, enabled]);
}

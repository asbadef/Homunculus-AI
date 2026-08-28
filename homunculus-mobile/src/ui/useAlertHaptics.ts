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
    if (!enabled || latest === null) return;
    if (latest.ts === lastTs.current) return;
    lastTs.current = latest.ts;
    if (latest.trigger === "escalation") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (latest.urgency === "immediate") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [latest, enabled]);
}

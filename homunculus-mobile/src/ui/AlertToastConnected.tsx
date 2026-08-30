import { useRouter } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useBoard } from "../store/BoardProvider";
import { AlertToast, useToastQueue } from "./AlertToast";
import { useAlertHaptics } from "./useAlertHaptics";

/**
 * The mounted instance: reads the board, renders nothing when there is nothing to show. Mounted
 * once in the root layout, above the Stack, so it floats over every screen — the alerts tab
 * already shows the feed; the toast exists for the clinician who is on Patients or a detail
 * screen when an immediate alert lands.
 *
 * Lives in its own module, loaded lazily (see app/_layout.tsx), for a build reason rather than a
 * design one: `expo export --platform web` prerenders every route through a Node-conditioned
 * bundle that resolves `moti`'s re-export of `framer-motion` to a build that crashes at module
 * load ("Cannot destructure property '__extends' of ... undefined") the moment anything pulling
 * moti sits in the root layout's *eagerly*-required graph — confirmed by bisection: the same
 * import is harmless from a leaf route (e.g. MonitorTile already imports moti there and exports
 * fine), and swapping this file for a `React.lazy` + dynamic `import()` from `_layout.tsx` makes
 * the crash disappear because that bundle stage never has to evaluate it. AlertToast.tsx itself
 * stays a plain, eagerly-importable module — the jest tests import it directly with no
 * workaround needed.
 */
export default function AlertToastConnected() {
  const { latestNotification, settings } = useBoard();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { visible, dismiss } = useToastQueue(latestNotification);
  // The haptic lives here, not on the alerts tab: the spec pairs "a haptic and a toast" for an
  // arriving immediate alert, and both should reach a clinician on ANY screen. One mount point
  // also means one seen-ts ref — mounting the hook on a tab as well would buzz twice.
  useAlertHaptics(latestNotification, settings.haptics);

  if (visible === null) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top: insets.top + 8, left: 0, right: 0 }}
    >
      <AlertToast
        note={visible}
        onDismiss={dismiss}
        onPress={(patientId) => router.push(`/patient/${patientId}`)}
      />
    </View>
  );
}

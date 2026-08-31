import { MotiView } from "moti";

import { useTheme } from "../theme/ThemeContext";

// The shimmer is the one sanctioned timing loop in the app (see src/theme/motion.ts): a spring
// would make a loading placeholder bounce, which reads as a bug rather than as "still loading".
// M6/Task 4: default radius matches BedCard's own `rounded-[22px]` wash card — a skeleton should
// preview the shape of the card it stands in for, not a smaller M5-era radius.
export function Skeleton({ height, radius = 22 }: { height: number; radius?: number }) {
  const { palette } = useTheme();
  return (
    <MotiView
      accessibilityLabel="skeleton"
      from={{ opacity: 0.35 }}
      animate={{ opacity: 0.7 }}
      transition={{ type: "timing", duration: 900, loop: true }}
      style={{ height, borderRadius: radius, backgroundColor: palette.card }}
    />
  );
}

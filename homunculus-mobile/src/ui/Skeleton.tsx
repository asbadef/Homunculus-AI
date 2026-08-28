import { MotiView } from "moti";

import { tokens } from "../theme/tokens";

// The shimmer is the one sanctioned timing loop in the app (see src/theme/motion.ts): a spring
// would make a loading placeholder bounce, which reads as a bug rather than as "still loading".
export function Skeleton({ height, radius = 12 }: { height: number; radius?: number }) {
  return (
    <MotiView
      accessibilityLabel="skeleton"
      from={{ opacity: 0.35 }}
      animate={{ opacity: 0.7 }}
      transition={{ type: "timing", duration: 900, loop: true }}
      style={{ height, borderRadius: radius, backgroundColor: tokens.card }}
    />
  );
}

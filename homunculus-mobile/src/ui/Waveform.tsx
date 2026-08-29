import { Heart } from "lucide-react-native";
import { MotiView } from "moti";
import { useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { G, Path } from "react-native-svg";

import { GLOW_DURATION_MS } from "../theme/motion";
import { tintFor } from "../theme/tint";
import { useTheme } from "../theme/ThemeContext";

const AnimatedG = Animated.createAnimatedComponent(G);

/**
 * Ported verbatim from dashboard/src/ClinicalDemo.jsx `ekgBeatPath` (~line 967) — a single
 * P-QRS-T beat template as relative (x, y-offset) pairs. It is pure geometry, so it is copied
 * unchanged rather than re-derived: the native strip should draw the exact same beat shape the
 * web cockpit does.
 */
function ekgBeatPath(beats: number, beatW: number, mid: number, amp: number): string {
  const tpl: Array<[number, number]> = [
    [0, 0], [9, 0], [12, -0.18], [15, 0], [18, 0], [19, 0.5], [21, -0.95],
    [23, 0.6], [25, 0], [30, 0], [33, -0.32], [36, 0], [40, 0],
  ];
  let d = "";
  for (let b = 0; b < beats; b++) {
    for (let i = 0; i < tpl.length; i++) {
      const [rx, ry] = tpl[i];
      const x = b * beatW + (rx / 40) * beatW;
      const y = mid + ry * amp;
      d += `${i === 0 && b === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)} `;
    }
  }
  return d.trim();
}

/**
 * A visual rhythm indicator driven by the latest HR number — not a real ECG trace, same honesty
 * scope as the web's SMIL version. Only rendered by callers when a heart rate exists.
 */
export function Waveform({ hr, height = 34 }: { hr: number; height?: number }) {
  const { key, palette } = useTheme();
  const beats = 4;
  const beatW = 46;
  const mid = height / 2;
  const amp = height * 0.38;
  const period = beats * beatW;
  const path = useMemo(() => ekgBeatPath(beats * 2, beatW, mid, amp), [beatW, mid, amp]);
  const dur = Math.max(2, (beats * 60) / Math.max(40, hr));

  const offset = useSharedValue(0);
  useEffect(() => {
    // A monitor strip has to scroll at a constant rate, or it visibly speeds up and slows down
    // each loop — a stutter, not a heartbeat — so this breaks from the app's spring-only default
    // on purpose. It is one of two sanctioned non-spring motions; see src/theme/motion.ts for the
    // other (Skeleton's timing pulse) and why both are exceptions.
    offset.value = 0;
    offset.value = withRepeat(
      withTiming(-period, { duration: dur * 1000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [period, dur, offset]);

  const animatedProps = useAnimatedProps(() => ({ translateX: offset.value }));

  const stroke = palette.clinical.safe;
  // The bpm readout sits on `tint`, so it is a real text/background contrast pair — the tinted-
  // chip idiom applies (src/theme/tint.ts). `ring` is a decorative border only, not text, so it
  // keeps its own fixed alpha.
  const tint = tintFor(stroke, key);
  const ring = `${stroke}33`; // ~20% alpha border

  return (
    <View
      accessibilityLabel="waveform"
      className="flex-row items-center gap-2 rounded-lg px-2 py-1"
      style={{ backgroundColor: tint, borderWidth: 1, borderColor: ring }}
    >
      <MotiView
        from={{ opacity: 0.5 }}
        animate={{ opacity: 1 }}
        transition={{ type: "timing", duration: GLOW_DURATION_MS, loop: true }}
      >
        <Heart size={12} color={stroke} />
      </MotiView>
      <View className="flex-1 overflow-hidden rounded" style={{ height }}>
        <Svg width="100%" height={height} viewBox={`0 0 ${period} ${height}`} preserveAspectRatio="none">
          <AnimatedG animatedProps={animatedProps}>
            <Path
              d={path}
              fill="none"
              stroke={stroke}
              strokeWidth={1.6}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.9}
            />
          </AnimatedG>
        </Svg>
      </View>
      <Text className="text-xs font-bold tabular-nums" style={{ color: stroke }}>
        {hr}
      </Text>
    </View>
  );
}

import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import * as ScreenCapture from "expo-screen-capture";

// Blocks screenshots/recording while a sensitive screen is focused (results, prescriptions,
// health card, family-follow); releases it on blur. No-ops where unsupported (e.g. web).
export function useScreenGuard() {
  useFocusEffect(
    useCallback(() => {
      ScreenCapture.preventScreenCaptureAsync().catch(() => {});
      return () => {
        ScreenCapture.allowScreenCaptureAsync().catch(() => {});
      };
    }, [])
  );
}

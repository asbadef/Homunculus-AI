import React from "react";
import { Stack } from "expo-router";
import { WizardProvider } from "../../src/appointment/useWizard";
import { useTheme } from "../../src/theme/ThemeProvider";

export default function WizardLayout() {
  const { t } = useTheme();
  return (
    <WizardProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
    </WizardProvider>
  );
}

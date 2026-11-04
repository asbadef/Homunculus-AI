import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader, StatusPill } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { useScreenGuard } from "../src/security/useScreenGuard";

// Our differentiator: family follow for ICU / newborn (masked, consent-gated).
const FOLLOW = [
  { id: "f1", name: "NA•••• HÜ••••", unit: "Yenidoğan (YBŞ)", since: "04.11.2026, 09:08", doctor: "Dr. Kamran Nağıyev" },
];

export default function FamilyFollow() {
  useScreenGuard();
  const { t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <Screen scroll>
      <StackHeader title={tr("feat.followup")} />
      <Card style={{ marginBottom: 14, backgroundColor: t.brandSoft, borderColor: t.brand + "44", flexDirection: "row", gap: 10 }}>
        <Ionicons name="shield-checkmark" size={18} color={t.brand} />
        <AppText style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 }}>{tr("ft.consent")}</AppText>
      </Card>
      {FOLLOW.map((f) => (
        <Card key={f.id} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AppText weight="bold">{f.name}</AppText>
            <StatusPill kind="ok" label={tr("ft.stable")} />
          </View>
          <Muted style={{ marginTop: 6 }}>{f.unit}</Muted>
          <Muted style={{ marginTop: 2 }}>{f.doctor}</Muted>
          <Muted style={{ marginTop: 2 }}>
            {tr("ft.status")}: {f.since}
          </Muted>
        </Card>
      ))}
    </Screen>
  );
}

import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { useScreenGuard } from "../src/security/useScreenGuard";

export default function HealthCard() {
  useScreenGuard();
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const rows = [
    { icon: "water-outline", label: tr("hc.blood"), value: "A Rh+" },
    { icon: "alert-circle-outline", label: tr("hc.allergies"), value: "Penisilin" },
    { icon: "fitness-outline", label: tr("hc.chronic"), value: "—" },
  ];
  return (
    <Screen scroll>
      <StackHeader title={tr("feat.healthcard")} />
      {rows.map((r, i) => (
        <Card key={i} style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={r.icon as any} size={20} color={t.brand} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Muted style={{ fontSize: 12 }}>{r.label}</Muted>
            <AppText weight="semibold" style={{ marginTop: 2 }}>
              {r.value}
            </AppText>
          </View>
          <AppText weight="semibold" color={t.brand} style={{ fontSize: 12 }}>
            {tr("hc.edit")}
          </AppText>
        </Card>
      ))}
    </Screen>
  );
}

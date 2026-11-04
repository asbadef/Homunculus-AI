import React from "react";
import { View, Pressable } from "react-native";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";

const PACKAGES = [
  { id: "c1", name: "Əsas Check-up", items: "Qan, ürək, görüntüləmə", price: "120 AZN" },
  { id: "c2", name: "Qadın sağlamlığı", items: "Hormon, USM, müayinə", price: "180 AZN" },
  { id: "c3", name: "Ürək paketi", items: "EKG, exokardiyoqrafiya", price: "150 AZN" },
];

export default function Checkup() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <Screen scroll>
      <StackHeader title={tr("feat.checkup")} />
      {PACKAGES.map((p) => (
        <Card key={p.id} style={{ marginBottom: 12 }}>
          <AppText weight="bold" style={{ fontSize: 15 }}>
            {p.name}
          </AppText>
          <Muted style={{ marginTop: 4 }}>{p.items}</Muted>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
            <AppText weight="bold" color={t.brand} style={{ fontSize: 16 }}>
              {p.price}
            </AppText>
            <Pressable style={{ backgroundColor: t.brand, borderRadius: 11, paddingHorizontal: 20, paddingVertical: 9 }}>
              <AppText weight="bold" color="#ffffff">
                {tr("chk.buy")}
              </AppText>
            </Pressable>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

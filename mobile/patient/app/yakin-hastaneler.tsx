import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { transport } from "../src/demo/transport";
import { Hospital } from "../src/demo/types";

export default function NearbyHospitals() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [list, setList] = useState<Hospital[]>([]);
  useEffect(() => {
    transport.getHospitals().then(setList);
  }, []);
  return (
    <Screen scroll>
      <StackHeader title={tr("feat.nearby")} />
      {list.map((h) => (
        <Card key={h.id} style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="business" size={20} color={t.brand} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText weight="semibold" numberOfLines={1}>
              {h.name}
            </AppText>
            <Muted style={{ marginTop: 2 }}>
              {h.distanceKm} {tr("wiz.km")}
            </Muted>
          </View>
          <Ionicons name="navigate-outline" size={20} color={t.brand} />
        </Card>
      ))}
    </Screen>
  );
}

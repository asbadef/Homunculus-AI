import React from "react";
import { View, Pressable, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";

// On-duty pharmacies (demo). Phone is selectable + tappable (opens dialer).
const PHARMACIES = [
  { id: "p1", name: "Zəfər Aptek", address: "Nizami küç. 45, Bakı", phone: "+994 12 555 11 22", km: "0.6 km" },
  { id: "p2", name: "Sağlam Aptek", address: "Azadlıq pr. 112, Bakı", phone: "+994 12 555 33 44", km: "1.3 km" },
  { id: "p3", name: "Mərkəz Aptek 24/7", address: "Fizuli küç. 7, Bakı", phone: "+994 12 555 55 66", km: "2.1 km" },
];

export default function OnDutyPharmacy() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <Screen scroll>
      <StackHeader title={tr("feat.pharmacy")} />
      <Muted style={{ fontSize: 12, marginBottom: 12 }}>{tr("pharm.hint")}</Muted>
      {PHARMACIES.map((p) => (
        <Card key={p.id} style={{ marginBottom: 10, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="medkit-outline" size={21} color={t.brand} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText weight="semibold" numberOfLines={1}>{p.name}</AppText>
              <Muted style={{ fontSize: 12 }} numberOfLines={1}>{p.address} · {p.km}</Muted>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={() => Linking.openURL(`tel:${p.phone.replace(/\s/g, "")}`).catch(() => {})} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: t.border, borderRadius: 11, paddingVertical: 11 }}>
              <Ionicons name="call-outline" size={16} color={t.brand} />
              <AppText weight="semibold" selectable style={{ fontSize: 13 }}>{p.phone}</AppText>
            </Pressable>
            <Pressable onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + " " + p.address)}`).catch(() => {})} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: t.border, borderRadius: 11, paddingVertical: 11, paddingHorizontal: 14 }}>
              <Ionicons name="navigate-outline" size={16} color={t.brand} />
            </Pressable>
          </View>
        </Card>
      ))}
      <View style={{ height: 16 }} />
    </Screen>
  );
}

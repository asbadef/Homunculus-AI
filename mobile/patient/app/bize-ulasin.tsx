import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";

// Klinik iletişim bilgileri — sabit, telefon/e-posta seçilebilir metin olarak gösterilir.
const ROWS = [
  { icon: "call-outline", labelKey: "contact.phone", value: "+994 12 310 00 00" },
  { icon: "logo-whatsapp", labelKey: "contact.whatsapp", value: "+994 50 310 00 00" },
  { icon: "mail-outline", labelKey: "contact.email", value: "info@merkeziklinika.az" },
  { icon: "location-outline", labelKey: "contact.address", value: "Nizami küç. 203, Bakı" },
  { icon: "time-outline", labelKey: "contact.hours", value: "B.e–Şən 08:00–20:00" },
];

export default function ContactUs() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <Screen scroll>
      <StackHeader title={tr("menu.contact")} />
      <View style={{ gap: 10, paddingTop: 6 }}>
        {ROWS.map((r) => (
          <Card key={r.labelKey} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={r.icon as any} size={21} color={t.brand} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Muted style={{ fontSize: 12 }}>{tr(r.labelKey)}</Muted>
              <AppText weight="semibold" selectable style={{ marginTop: 2 }}>{r.value}</AppText>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

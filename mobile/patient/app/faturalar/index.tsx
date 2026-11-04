import React, { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Card, StackHeader } from "../../src/ui/widgets";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { Invoice } from "../../src/demo/types";
import { demoAlert } from "../../src/ui/demo";

export default function Invoices() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [list, setList] = useState<Invoice[]>([]);
  useEffect(() => {
    transport.getInvoices().then(setList);
  }, []);
  return (
    <Screen scroll>
      <StackHeader title={tr("feat.invoices")} />
      {list.map((inv) => (
        <Card key={inv.id} style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText weight="semibold" numberOfLines={1}>
              {inv.title}
            </AppText>
            <Muted style={{ marginTop: 2 }}>{inv.date}</Muted>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <AppText weight="bold">
              {inv.amount} {inv.currency}
            </AppText>
            <AppText style={{ fontSize: 11, color: inv.status === "unpaid" ? t.wait : t.ok }}>
              {inv.status === "unpaid" ? tr("inv.unpaid") : tr("inv.paid")}
            </AppText>
          </View>
        </Card>
      ))}
      <Pressable onPress={() => demoAlert(tr)} style={{ marginTop: 6, borderWidth: 1, borderColor: t.border, borderRadius: 13, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Ionicons name="card-outline" size={18} color={t.brand} />
        <AppText weight="semibold">{tr("inv.addCard")}</AppText>
      </Pressable>
    </Screen>
  );
}

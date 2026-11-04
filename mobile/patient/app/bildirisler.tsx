import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader, EmptyState } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { NOTIFS, getReadIds, markAllRead } from "../src/demo/notifications";

export default function Notifications() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [readIds, setReadIds] = useState<string[]>([]);

  useEffect(() => {
    // Show current read-state, then mark everything read so the badge clears.
    getReadIds().then(setReadIds);
    markAllRead();
  }, []);

  return (
    <Screen scroll>
      <StackHeader title={tr("notif.title")} />
      {NOTIFS.length === 0 ? (
        <EmptyState icon="notifications-outline" title={tr("notif.title")} />
      ) : (
        NOTIFS.map((n) => {
          const unread = !readIds.includes(n.id);
          return (
            <Card key={n.id} style={{ marginBottom: 10, flexDirection: "row", gap: 12, backgroundColor: unread ? t.brandSoft : t.surface, borderColor: unread ? t.brand + "40" : t.border }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: unread ? t.brand : t.brandSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={n.icon as any} size={20} color={unread ? "#ffffff" : t.brand} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <AppText weight="semibold" style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>{tr(n.titleKey)}</AppText>
                  {unread ? <View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: t.brand }} /> : null}
                </View>
                <Muted style={{ marginTop: 2 }}>{tr(n.bodyKey)}</Muted>
                <Muted style={{ marginTop: 2, fontSize: 11 }}>{tr(n.timeKey)}</Muted>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

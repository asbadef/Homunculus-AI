import React, { useEffect, useState } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted, Title } from "../../src/ui/base";
import { Card, StatusPill, Chip } from "../../src/ui/widgets";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { Result, ResultType } from "../../src/demo/types";

const TYPE_ICON: Record<ResultType, any> = { lab: "flask-outline", radiology: "scan-outline", pathology: "cellular-outline" };
type Filter = "all" | ResultType;

export default function ResultsTab() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [list, setList] = useState<Result[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    transport.getResults().then(setList);
  }, []);

  const filtered = (list ?? []).filter((r) => filter === "all" || r.type === filter);
  const filters: Filter[] = ["all", "lab", "radiology", "pathology"];

  return (
    <Screen scroll>
      <View style={{ paddingTop: 6, paddingBottom: 12 }}>
        <Title>{tr("results.title")}</Title>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 14 }}>
        {filters.map((f) => (
          <Chip key={f} label={tr(`res.filter.${f}`)} selected={filter === f} onPress={() => setFilter(f)} />
        ))}
      </ScrollView>

      {list && filtered.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: 50, gap: 8 }}>
          <Ionicons name="document-text-outline" size={40} color={t.faint} />
          <Muted>{tr("results.empty")}</Muted>
        </View>
      ) : (
        filtered.map((r) => (
          <Pressable key={r.id} onPress={() => router.push(`/netice/${r.id}`)}>
            <Card style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name={TYPE_ICON[r.type]} size={20} color={t.brand} />
                <AppText weight="semibold" style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                  {r.title}
                </AppText>
                <StatusPill kind={r.status === "ready" ? "ok" : "wait"} label={r.status === "ready" ? tr("status.confirmed") : tr("status.pending")} />
              </View>
              <Muted style={{ marginTop: 8 }}>
                {r.date} · {tr("res.protocol")}: {r.protocol}
              </Muted>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

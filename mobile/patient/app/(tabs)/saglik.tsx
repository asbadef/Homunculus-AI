import React, { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted, Title } from "../../src/ui/base";
import { Card, SectionTitle } from "../../src/ui/widgets";
import { NewsStrip } from "../../src/components/home";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { NewsItem } from "../../src/demo/types";

export default function HealthHub() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [news, setNews] = useState<NewsItem[]>([]);
  useEffect(() => {
    transport.getNews().then(setNews);
  }, []);

  const kozlar = [
    { icon: "heart-circle", label: tr("feat.followup"), route: "/yakin-takip" },
    { icon: "sparkles", label: tr("results.explain"), route: "/neticeler" },
    { icon: "bandage", label: tr("feat.vaccine"), route: "/asi-karti" },
  ];

  return (
    <Screen scroll>
      <View style={{ paddingTop: 6, paddingBottom: 12 }}>
        <Title>{tr("tab.health")}</Title>
      </View>

      <View style={{ gap: 10 }}>
        {kozlar.map((k) => (
          <Pressable key={k.route} onPress={() => router.push(k.route as any)}>
            <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={k.icon as any} size={22} color={t.brand} />
              </View>
              <AppText weight="semibold" style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                {k.label}
              </AppText>
              <Ionicons name="chevron-forward" size={18} color={t.faint} />
            </Card>
          </Pressable>
        ))}
      </View>

      <Card style={{ marginTop: 14, flexDirection: "row", gap: 10, backgroundColor: t.surface2, borderColor: t.border }}>
        <Ionicons name="pulse" size={18} color={t.muted} />
        <Muted style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 }}>{tr("saglik.soon")}</Muted>
      </Card>

      <SectionTitle>📰 {tr("home.news")}</SectionTitle>
      <NewsStrip data={news} />
      <View style={{ height: 16 }} />
    </Screen>
  );
}

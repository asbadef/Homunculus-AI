import React, { useEffect, useState } from "react";
import { View, Image, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { StackHeader } from "../../src/ui/widgets";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { newsImages } from "../../src/demo/images";
import { NewsItem } from "../../src/demo/types";

export default function NewsDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [n, setN] = useState<NewsItem | null>(null);

  useEffect(() => {
    transport.getNews().then((rows) => setN(rows.find((x) => x.id === id) ?? null));
  }, [id]);

  if (!n) return <Screen />;

  return (
    <Screen scroll>
      <StackHeader title={tr("home.news")} />
      {newsImages[n.id] ? (
        <Image source={newsImages[n.id]} style={{ width: "100%", height: 170, borderRadius: 18 }} resizeMode="cover" />
      ) : (
        <View style={{ height: 120, borderRadius: 18, backgroundColor: n.tint + "22" }} />
      )}
      <AppText weight="extrabold" style={{ fontSize: 20, marginTop: 14 }}>{n.title}</AppText>
      {n.date ? <Muted style={{ fontSize: 12, marginTop: 4 }}>{n.date}</Muted> : null}
      <AppText style={{ fontSize: 15, lineHeight: 23, marginTop: 12, color: t.fg }}>{n.body ?? n.summary}</AppText>

      <Pressable onPress={() => router.push("/randevu-al/tip")} style={{ marginTop: 20, backgroundColor: t.brand, borderRadius: 14, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <Ionicons name="calendar" size={18} color="#ffffff" />
        <AppText weight="bold" color="#ffffff" style={{ fontSize: 15 }}>{tr("appointments.new")}</AppText>
      </Pressable>
      <View style={{ height: 16 }} />
    </Screen>
  );
}

import React from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../theme/ThemeProvider";
import { layout } from "../theme/tokens";
import { AppText } from "../ui/base";
import { Card } from "../ui/widgets";
import { Banner, NewsItem, Story } from "../demo/types";
import { Feature } from "../config/features";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

export function Stories({ data }: { data: Story[] }) {
  const { t } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 4 }}>
      {data.map((s) => (
        <View key={s.id} style={{ alignItems: "center", width: 72 }}>
          <View style={{ width: 62, height: 62, borderRadius: 99, borderWidth: 2, borderColor: s.tint, alignItems: "center", justifyContent: "center", backgroundColor: s.tint + "1f" }}>
            <Ionicons name="sparkles" size={22} color={s.tint} />
          </View>
          <AppText numberOfLines={2} style={{ fontSize: 10, textAlign: "center", marginTop: 5, color: t.muted }}>
            {s.title}
          </AppText>
        </View>
      ))}
    </ScrollView>
  );
}

export function BannerCarousel({ data }: { data: Banner[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
      {data.map((b) => (
        <View key={b.id} style={{ width: 300, borderRadius: layout.radius, padding: 16, backgroundColor: b.tint, justifyContent: "center" }}>
          <AppText weight="extrabold" color="#ffffff" style={{ fontSize: 17 }}>
            {b.title}
          </AppText>
          <AppText color="#ffffff" style={{ opacity: 0.9, marginTop: 6, fontSize: 12 }}>
            {b.subtitle}
          </AppText>
        </View>
      ))}
    </ScrollView>
  );
}

function go(route: string) {
  try {
    router.push(route as never);
  } catch {
    /* route built in a later task */
  }
}

export function Shortcuts({ items, label }: { items: Feature[]; label: (f: Feature) => string }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: layout.gap }}>
      {items.map((f) => (
        <Pressable key={f.key} onPress={() => go(f.route)} style={{ width: "48%" }}>
          <Card style={{ padding: 15, gap: 9 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={(f.icon + "-outline") as IconName} size={22} color={t.brand} />
            </View>
            <AppText weight="semibold" numberOfLines={2} style={{ fontSize: 14 }}>
              {label(f)}
            </AppText>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

export function QuickServices({ items, label }: { items: Feature[]; label: (f: Feature) => string }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: layout.gap }}>
      {items.map((f) => (
        <Pressable key={f.key} onPress={() => go(f.route)} style={{ width: "31%", alignItems: "center" }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={(f.icon + "-outline") as IconName} size={24} color={t.brand} />
          </View>
          <AppText numberOfLines={2} style={{ fontSize: 11, textAlign: "center", marginTop: 6, color: t.muted }}>
            {label(f)}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

export function NewsStrip({ data }: { data: NewsItem[] }) {
  const { t } = useTheme();
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {data.map((n, i) => (
        <View key={n.id} style={{ flexDirection: "row", gap: 11, padding: 13, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: t.border }}>
          <View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: n.tint, marginTop: 6 }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText weight="semibold" style={{ fontSize: 13 }}>
              {n.title}
            </AppText>
            <AppText style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>{n.summary}</AppText>
          </View>
        </View>
      ))}
    </Card>
  );
}

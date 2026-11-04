import React from "react";
import { View, ScrollView, Pressable, StyleSheet, ImageBackground, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { bannerImages, newsImages, storyImages } from "../demo/images";
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
      {data.map((s, i) => (
        <View key={s.id} style={{ alignItems: "center", width: 74 }}>
          <View style={{ width: 66, height: 66, borderRadius: 99, borderWidth: 2, borderColor: t.brand, padding: 2 }}>
            <Image source={storyImages[i % storyImages.length]} style={{ width: "100%", height: "100%", borderRadius: 99 }} resizeMode="cover" />
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
      {data.map((b, i) => (
        <ImageBackground key={b.id} source={bannerImages[i % bannerImages.length]} resizeMode="cover" style={{ width: 300, height: 128, borderRadius: layout.radius, overflow: "hidden", justifyContent: "flex-end" }}>
          <LinearGradient colors={["#00000000", "#00000066"]} style={{ padding: 14 }}>
            <AppText weight="extrabold" color="#ffffff" style={{ fontSize: 17 }}>
              {b.title}
            </AppText>
            <AppText color="#ffffff" style={{ opacity: 0.95, marginTop: 4, fontSize: 12 }}>
              {b.subtitle}
            </AppText>
          </LinearGradient>
        </ImageBackground>
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
          <Card style={{ padding: 15, flexDirection: "row", alignItems: "center", gap: 11 }}>
            <LinearGradient colors={[t.brand, t.brandGrad2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={(f.icon + "-outline") as IconName} size={22} color="#ffffff" />
            </LinearGradient>
            <AppText weight="semibold" numberOfLines={2} style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
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
          <View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={(f.icon + "-outline") as IconName} size={26} color={t.brand} />
          </View>
          <AppText numberOfLines={2} style={{ fontSize: 11, textAlign: "center", marginTop: 7, color: t.muted }}>
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
        <View key={n.id} style={{ flexDirection: "row", gap: 12, padding: 12, alignItems: "center", borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: t.border }}>
          {newsImages[n.id] ? (
            <Image source={newsImages[n.id]} style={{ width: 56, height: 56, borderRadius: 12 }} resizeMode="cover" />
          ) : (
            <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: n.tint + "33" }} />
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText weight="semibold" style={{ fontSize: 13 }} numberOfLines={2}>
              {n.title}
            </AppText>
            <AppText style={{ fontSize: 11, color: t.muted, marginTop: 2 }} numberOfLines={1}>{n.summary}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={t.faint} />
        </View>
      ))}
    </Card>
  );
}

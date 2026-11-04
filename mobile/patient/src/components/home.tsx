import React from "react";
import { View, ScrollView, Pressable, StyleSheet, ImageBackground, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { bannerImages, newsImages, storyImages } from "../demo/images";
import { useI18n } from "../i18n";
import { useTheme } from "../theme/ThemeProvider";
import { layout } from "../theme/tokens";
import { AppText } from "../ui/base";
import { Card } from "../ui/widgets";
import { greetKey } from "../ui/greeting";
import { openDirections, addToCalendar, scheduleReminder } from "../appointment/apptActions";
import { Appointment, Banner, NewsItem, Story } from "../demo/types";
import { Feature } from "../config/features";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

export function Stories({ data, light }: { data: Story[]; light?: boolean }) {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 4 }}>
      {data.map((s, i) => (
        <Pressable key={s.id} onPress={() => router.push("/kampanyalar")} style={{ alignItems: "center", width: 74 }}>
          <View style={{ width: 66, height: 66, borderRadius: 99, borderWidth: 2, borderColor: light ? "#ffffffcc" : s.tint, padding: 2 }}>
            <Image source={storyImages[i % storyImages.length]} style={{ width: "100%", height: "100%", borderRadius: 99 }} resizeMode="cover" />
          </View>
          <AppText numberOfLines={2} style={{ fontSize: 10, textAlign: "center", marginTop: 5, color: light ? "#ffffff" : t.muted }}>
            {s.title}
          </AppText>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// Branded gradient header: time-aware greeting, avatar (opens menu), notification bell
// with unread badge, search bar, and the stories row — all on one turquoise band.
export function HomeHero({ name, unread, stories, onMenu, onBell, onSearch }: {
  name: string; unread: number; stories: Story[]; onMenu: () => void; onBell: () => void; onSearch: () => void;
}) {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();
  return (
    <LinearGradient
      colors={[t.brand, t.brandGrad2]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ marginHorizontal: -layout.pad, marginTop: -insets.top, paddingTop: insets.top + 12, paddingHorizontal: layout.pad, paddingBottom: 18, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
        <Pressable onPress={onMenu} hitSlop={8} style={{ width: 42, height: 42, borderRadius: 99, backgroundColor: "#ffffff33", alignItems: "center", justifyContent: "center" }}>
          <AppText weight="extrabold" color="#ffffff" style={{ fontSize: 18 }}>{initial}</AppText>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText color="#ffffff" style={{ fontSize: 12.5, opacity: 0.92 }} numberOfLines={1}>{tr(greetKey())} 👋</AppText>
          <AppText weight="extrabold" color="#ffffff" style={{ fontSize: 21 }} numberOfLines={1}>{name}</AppText>
        </View>
        <Pressable onPress={onBell} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#ffffff2e", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="notifications-outline" size={20} color="#ffffff" />
          {unread > 0 ? (
            <View style={{ position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 99, backgroundColor: t.danger, borderWidth: 2, borderColor: t.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
              <AppText weight="bold" color="#ffffff" style={{ fontSize: 10 }}>{unread}</AppText>
            </View>
          ) : null}
        </Pressable>
      </View>

      <Pressable onPress={onSearch} style={{ marginTop: 14, backgroundColor: "#ffffff", borderRadius: 13, paddingHorizontal: 13, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 9 }}>
        <Ionicons name="search" size={17} color={t.brand} />
        <AppText style={{ fontSize: 13, color: t.faint, flex: 1, minWidth: 0 }} numberOfLines={1}>{tr("home.search")}</AppText>
      </Pressable>

      <View style={{ marginTop: 14 }}>
        <Stories data={stories} light />
      </View>
    </LinearGradient>
  );
}

// Next-appointment card: doctor avatar, name/specialty/time, real quick actions
// (open maps, add to calendar, schedule a local reminder).
export function NextAppointmentCard({ appt }: { appt: Appointment }) {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [msg, setMsg] = React.useState("");
  const initials = appt.doctor.replace(/^Dr\.\s*/, "").slice(0, 1);
  const chip = { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, borderRadius: 11, paddingVertical: 9, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 5 };

  async function remind() {
    const ok = await scheduleReminder(appt, tr("appt.remindTitle"), `${appt.doctor} · ${appt.date}, ${appt.time}`);
    setMsg(ok ? tr("appt.reminderSet") : tr("appt.remOnPhone"));
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <LinearGradient colors={[t.brand, t.brandGrad2]} style={{ width: 46, height: 46, borderRadius: 99, alignItems: "center", justifyContent: "center" }}>
          <AppText weight="bold" color="#ffffff" style={{ fontSize: 18 }}>{initials}</AppText>
        </LinearGradient>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText weight="bold" numberOfLines={1}>{appt.doctor}</AppText>
          <AppText style={{ fontSize: 12, color: t.muted }} numberOfLines={1}>{appt.specialty} · {appt.hospital}</AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            <Ionicons name="time-outline" size={13} color={t.brand} />
            <AppText weight="semibold" color={t.brand} style={{ fontSize: 12 }}>{appt.date}, {appt.time}</AppText>
          </View>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 9, marginTop: 12 }}>
        <Pressable onPress={() => openDirections(appt.hospital)} style={chip}><Ionicons name="navigate-outline" size={15} color={t.brand} /><AppText weight="semibold" style={{ fontSize: 12 }}>{tr("appt.directions")}</AppText></Pressable>
        <Pressable onPress={remind} style={chip}><Ionicons name="alarm-outline" size={15} color={t.brand} /><AppText weight="semibold" style={{ fontSize: 12 }}>{tr("appt.remindMe")}</AppText></Pressable>
        <Pressable onPress={() => addToCalendar(appt)} style={chip}><Ionicons name="calendar-outline" size={15} color={t.brand} /><AppText weight="semibold" style={{ fontSize: 12 }}>{tr("appt.calendar")}</AppText></Pressable>
      </View>
      {msg ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
          <Ionicons name="checkmark-circle" size={15} color={t.ok} />
          <AppText color={t.ok} style={{ fontSize: 12 }}>{msg}</AppText>
        </View>
      ) : null}
    </Card>
  );
}

export function BannerCarousel({ data }: { data: Banner[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
      {data.map((b, i) => (
        <Pressable key={b.id} onPress={() => go(i === 0 ? "/randevu-al/tip" : "/neticeler")}>
          <ImageBackground source={bannerImages[i % bannerImages.length]} resizeMode="cover" style={{ width: 300, height: 128, borderRadius: layout.radius, overflow: "hidden", justifyContent: "flex-end" }}>
            <LinearGradient colors={["#00000000", "#00000066"]} style={{ padding: 14 }}>
              <AppText weight="extrabold" color="#ffffff" style={{ fontSize: 17 }}>
                {b.title}
              </AppText>
              <AppText color="#ffffff" style={{ opacity: 0.95, marginTop: 4, fontSize: 12 }}>
                {b.subtitle}
              </AppText>
            </LinearGradient>
          </ImageBackground>
        </Pressable>
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

export type SummaryItem = { key: string; title: string; value: string; icon: IconName; image: any; route: string };

// Büyük görselli özet kartları — ana ekranın üstünde hastanın durumunu özetler.
export function SummaryCards({ items }: { items: SummaryItem[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: layout.gap }}>
      {items.map((it) => (
        <Pressable key={it.key} onPress={() => go(it.route)} style={{ width: "48%" }}>
          <ImageBackground source={it.image} resizeMode="cover" style={{ height: 118, borderRadius: layout.radius, overflow: "hidden" }}>
            <LinearGradient colors={["#00000022", "#000000bb"]} style={{ flex: 1, padding: 13, justifyContent: "space-between" }}>
              <Ionicons name={it.icon} size={22} color="#ffffff" />
              <View>
                <AppText weight="extrabold" color="#ffffff" style={{ fontSize: 15 }} numberOfLines={1}>
                  {it.title}
                </AppText>
                <AppText color="#ffffff" style={{ fontSize: 11, opacity: 0.92, marginTop: 1 }} numberOfLines={1}>
                  {it.value}
                </AppText>
              </View>
            </LinearGradient>
          </ImageBackground>
        </Pressable>
      ))}
    </View>
  );
}

export function Shortcuts({ items, label }: { items: Feature[]; label: (f: Feature) => string }) {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: layout.gap }}>
      {items.map((f) => {
        const subKey = f.titleKey + ".sub";
        const sub = tr(subKey);
        return (
          <Pressable key={f.key} onPress={() => go(f.route)} style={{ width: "48%" }}>
            <Card style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 11 }}>
              <LinearGradient colors={[t.brand, t.brandGrad2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={(f.icon + "-outline") as IconName} size={22} color="#ffffff" />
              </LinearGradient>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText weight="semibold" numberOfLines={1} style={{ fontSize: 14 }}>
                  {label(f)}
                </AppText>
                {sub !== subKey ? (
                  <AppText numberOfLines={1} style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>
                    {sub}
                  </AppText>
                ) : null}
              </View>
            </Card>
          </Pressable>
        );
      })}
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
  const { t: tr } = useI18n();
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {data.map((n, i) => (
        <Pressable key={n.id} onPress={() => router.push(`/haber/${n.id}`)} style={{ flexDirection: "row", gap: 12, padding: 12, alignItems: "center", borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: t.border }}>
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
        </Pressable>
      ))}
    </Card>
  );
}

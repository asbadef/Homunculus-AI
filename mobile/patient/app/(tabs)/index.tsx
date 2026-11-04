import React, { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { demoAlert } from "../../src/ui/demo";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Card, SectionTitle } from "../../src/ui/widgets";
import { Stories, BannerCarousel, HomeHero, SummaryCards, NextAppointmentCard, Shortcuts, QuickServices, NewsStrip } from "../../src/components/home";
import { bannerImages } from "../../src/demo/images";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { visibleFeatures, Feature, FEATURES as FEATURE_LIST } from "../../src/config/features";
import { Appointment, Banner, Invoice, NewsItem, Result, Story } from "../../src/demo/types";
import { askNotificationPermissionOnce } from "../../src/notifications/ask";
import { useSession } from "../../src/session/SessionProvider";
import { MenuDrawer } from "../../src/components/MenuDrawer";

export default function HomeScreen() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const { user } = useSession();
  const firstName = (user?.name ?? "").split(" ")[0] || "—";
  const [stories, setStories] = useState<Story[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [next, setNext] = useState<Appointment | null>(null);
  const [unpaid, setUnpaid] = useState<Invoice | null>(null);
  const [lastResult, setLastResult] = useState<Result | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    askNotificationPermissionOnce();
    transport.getStories().then(setStories);
    transport.getBanners().then(setBanners);
    transport.getNews().then(setNews);
    transport.getAppointments().then((a) => setNext(a.find((x) => x.status !== "completed" && x.status !== "cancelled") ?? a[0] ?? null));
    transport.getInvoices().then((i) => setUnpaid(i.find((x) => x.status === "unpaid") ?? null));
    transport.getResults().then((r) => setLastResult(r.find((x) => x.status === "ready") ?? null));
  }, []);

  const label = (f: Feature) => tr(f.titleKey);
  const unread = (next ? 1 : 0) + (unpaid ? 1 : 0) + (lastResult ? 1 : 0);

  const summary = [
    { key: "appt", title: tr("feat.appointments"), value: next ? `${next.date} · ${next.time}` : tr("appointments.empty"), icon: "calendar" as const, image: bannerImages[0], route: "/randevu" },
    { key: "res", title: tr("feat.results"), value: lastResult ? lastResult.title : tr("results.empty"), icon: "document-text" as const, image: bannerImages[1], route: "/neticeler" },
  ];

  return (
    <Screen scroll>
      <HomeHero
        name={firstName}
        unread={unread}
        stories={stories}
        onMenu={() => setMenuOpen(true)}
        onBell={() => router.push("/bildirisler")}
        onSearch={() => demoAlert(tr)}
      />
      <MenuDrawer visible={menuOpen} onClose={() => setMenuOpen(false)} />

      <View style={{ height: 16 }} />
      <SummaryCards items={summary} />

      <SectionTitle>{tr("home.nextAppointment")}</SectionTitle>
      {next ? (
        <NextAppointmentCard appt={next} />
      ) : (
        <Card><Muted>{tr("appointments.empty")}</Muted></Card>
      )}

      <SectionTitle>{tr("home.shortcuts")}</SectionTitle>
      <Shortcuts items={visibleFeatures(FEATURE_LIST, "shortcut")} label={label} />

      {unpaid ? (
        <>
          <SectionTitle>{tr("home.balance")}</SectionTitle>
          <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.wait + "22", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="card-outline" size={20} color={t.wait} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Muted style={{ textTransform: "uppercase", fontSize: 10, letterSpacing: 0.4 }} numberOfLines={1}>{unpaid.title}</Muted>
                <AppText weight="bold" style={{ fontSize: 17, marginTop: 1 }}>
                  {unpaid.amount} {unpaid.currency}
                </AppText>
              </View>
            </View>
            <Pressable onPress={() => demoAlert(tr)} style={{ backgroundColor: t.wait, borderRadius: 11, paddingHorizontal: 16, paddingVertical: 10 }}>
              <AppText weight="bold" color="#ffffff">{tr("action.pay")}</AppText>
            </Pressable>
          </Card>
        </>
      ) : null}

      <SectionTitle>{tr("home.services")}</SectionTitle>
      <QuickServices items={visibleFeatures(FEATURE_LIST, "service")} label={label} />

      <SectionTitle>{tr("home.news")}</SectionTitle>
      <BannerCarousel data={banners} />
      <View style={{ height: 12 }} />
      <NewsStrip data={news} />
      <View style={{ height: 16 }} />
    </Screen>
  );
}

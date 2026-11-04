import React, { useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { demoAlert } from "../../src/ui/demo";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Card, SectionTitle, LangThemeControls, BrandGradient } from "../../src/ui/widgets";
import { layout } from "../../src/theme/tokens";
import { Stories, BannerCarousel, SummaryCards, Shortcuts, QuickServices, NewsStrip } from "../../src/components/home";
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
  const firstName = (user?.name ?? "").split(" ")[0];
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
    transport.getAppointments().then((a) => setNext(a[0] ?? null));
    transport.getInvoices().then((i) => setUnpaid(i.find((x) => x.status === "unpaid") ?? null));
    transport.getResults().then((r) => setLastResult(r.find((x) => x.status === "ready") ?? null));
  }, []);

  const label = (f: Feature) => tr(f.titleKey);

  const summary = [
    { key: "appt", title: tr("feat.appointments"), value: next ? `${next.date} · ${next.time}` : tr("appointments.empty"), icon: "calendar" as const, image: bannerImages[0], route: "/randevu" },
    { key: "res", title: tr("feat.results"), value: lastResult ? lastResult.title : tr("results.empty"), icon: "document-text" as const, image: bannerImages[1], route: "/neticeler" },
  ];

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 6, paddingBottom: 10 }}>
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={10}>
          <Ionicons name="menu" size={26} color={t.fg} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText weight="extrabold" style={{ fontSize: 19 }} numberOfLines={1}>
            {tr("greeting")}, {firstName} 👋
          </AppText>
        </View>
        <LangThemeControls />
      </View>
      <MenuDrawer visible={menuOpen} onClose={() => setMenuOpen(false)} />

      <Stories data={stories} />
      <View style={{ height: 14 }} />
      <SummaryCards items={summary} />
      <View style={{ height: 14 }} />
      <BannerCarousel data={banners} />

      <SectionTitle>{tr("home.shortcuts")}</SectionTitle>
      <Shortcuts items={visibleFeatures(FEATURE_LIST, "shortcut")} label={label} />

      <SectionTitle>{tr("home.nextAppointment")}</SectionTitle>
      <BrandGradient style={{ borderRadius: layout.radius, padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {next ? (
            <>
              <AppText color="#ffffff" style={{ opacity: 0.9, fontSize: 12 }}>
                {next.date} · {next.time}
              </AppText>
              <AppText weight="bold" color="#ffffff" style={{ fontSize: 16, marginTop: 2 }}>
                {next.doctor}
              </AppText>
              <AppText color="#ffffff" style={{ opacity: 0.9, fontSize: 12 }}>
                {next.specialty}
              </AppText>
            </>
          ) : (
            <AppText color="#ffffff">{tr("appointments.empty")}</AppText>
          )}
        </View>
        <Ionicons name="calendar" size={30} color="#ffffff" style={{ opacity: 0.9 }} />
      </BrandGradient>

      {unpaid ? (
        <>
          <SectionTitle>{tr("home.balance")}</SectionTitle>
          <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View>
              <Muted style={{ textTransform: "uppercase", fontSize: 11, letterSpacing: 0.5 }}>{unpaid.title}</Muted>
              <AppText weight="bold" style={{ fontSize: 18, marginTop: 2 }}>
                {unpaid.amount} {unpaid.currency}
              </AppText>
            </View>
            <Pressable onPress={() => demoAlert(tr)} style={{ backgroundColor: t.brand, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 }}>
              <AppText weight="bold" color="#ffffff">
                {tr("action.pay")}
              </AppText>
            </Pressable>
          </Card>
        </>
      ) : null}

      <SectionTitle>{tr("home.services")}</SectionTitle>
      <QuickServices items={visibleFeatures(FEATURE_LIST, "service")} label={label} />

      <SectionTitle>{tr("home.news")}</SectionTitle>
      <NewsStrip data={news} />
      <View style={{ height: 16 }} />
    </Screen>
  );
}

import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AppText, Muted } from "../../src/ui/base";
import { Card, SectionTitle, LangThemeControls } from "../../src/ui/widgets";
import { Stories, BannerCarousel, Shortcuts, QuickServices, NewsStrip } from "../../src/components/home";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { transport } from "../../src/demo/transport";
import { visibleFeatures, Feature, FEATURES as FEATURE_LIST } from "../../src/config/features";
import { Appointment, Banner, Invoice, NewsItem, Story } from "../../src/demo/types";

export default function HomeScreen() {
  const { t } = useTheme();
  const { t: tr } = useI18n();
  const [stories, setStories] = useState<Story[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [next, setNext] = useState<Appointment | null>(null);
  const [unpaid, setUnpaid] = useState<Invoice | null>(null);

  useEffect(() => {
    transport.getStories().then(setStories);
    transport.getBanners().then(setBanners);
    transport.getNews().then(setNews);
    transport.getAppointments().then((a) => setNext(a[0] ?? null));
    transport.getInvoices().then((i) => setUnpaid(i.find((x) => x.status === "unpaid") ?? null));
  }, []);

  const label = (f: Feature) => tr(f.titleKey);

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 6, paddingBottom: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText weight="extrabold" style={{ fontSize: 19 }}>
            {tr("greeting")}, Aysel 👋
          </AppText>
          <Muted>Bakı · Mərkəzi Klinika</Muted>
        </View>
        <LangThemeControls />
      </View>

      <Stories data={stories} />
      <View style={{ height: 12 }} />
      <BannerCarousel data={banners} />

      <SectionTitle>{tr("home.shortcuts")}</SectionTitle>
      <Shortcuts items={visibleFeatures(FEATURE_LIST, "shortcut")} label={label} />

      <SectionTitle>{tr("home.nextAppointment")}</SectionTitle>
      <Card style={{ backgroundColor: t.brand, borderWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
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
      </Card>

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
            <View style={{ backgroundColor: t.brand, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 }}>
              <AppText weight="bold" color="#ffffff">
                {tr("action.pay")}
              </AppText>
            </View>
          </Card>
        </>
      ) : null}

      <SectionTitle>{tr("home.services")}</SectionTitle>
      <QuickServices items={visibleFeatures(FEATURE_LIST, "service")} label={label} />

      <SectionTitle>📰 {tr("home.news")}</SectionTitle>
      <NewsStrip data={news} />
      <View style={{ height: 16 }} />
    </Screen>
  );
}

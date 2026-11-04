import React from "react";
import { View, ViewProps, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useTheme } from "../theme/ThemeProvider";
import { layout } from "../theme/tokens";
import { useI18n } from "../i18n";
import { LANGS } from "../i18n/core";
import { AppText } from "./base";

// Back + title header for stack (non-tab) screens.
export function StackHeader({ title }: { title: string }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 6, paddingBottom: 14 }}>
      <Pressable onPress={() => router.back()} hitSlop={10}>
        <Ionicons name="chevron-back" size={24} color={t.fg} />
      </Pressable>
      <AppText weight="bold" style={{ fontSize: 18, flex: 1, minWidth: 0 }} numberOfLines={1}>
        {title}
      </AppText>
    </View>
  );
}

// Elevated surface card.
export function Card({ style, children, ...rest }: ViewProps) {
  const { t } = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: t.surface,
          borderRadius: layout.radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.border,
          padding: 14,
          shadowColor: "#0f172a",
          shadowOpacity: 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// Brand-colored gradient surface (banners, hero cards).
export function BrandGradient({ style, children }: ViewProps & { children?: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <LinearGradient colors={[t.brand, t.brandGrad2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style as any}>
      {children}
    </LinearGradient>
  );
}

export function StatusPill({ kind, label }: { kind: "ok" | "wait"; label: string }) {
  const { t } = useTheme();
  const color = kind === "ok" ? t.ok : t.wait;
  return (
    <View style={{ backgroundColor: color + "28", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99 }}>
      <AppText weight="bold" color={color} style={{ fontSize: 11 }}>
        {label}
      </AppText>
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <AppText weight="bold" color={t.fg} style={{ fontSize: 14, marginTop: 18, marginBottom: 10, marginLeft: 2 }}>
      {children}
    </AppText>
  );
}

// Pill-style selectable chip (filters, choices).
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const { t } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 99,
        backgroundColor: selected ? t.brand : t.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? t.brand : t.border,
      }}
    >
      <AppText weight="semibold" color={selected ? "#ffffff" : t.fg} style={{ fontSize: 13 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

// Language cycle + theme toggle chips for the home top bar.
export function LangThemeControls() {
  const { t, mode, toggle } = useTheme();
  const { t: tr, lang, setLang } = useI18n();
  const chip = {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
    backgroundColor: t.surface,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 5,
  };
  function cycleLang() {
    const i = LANGS.indexOf(lang);
    setLang(LANGS[(i + 1) % LANGS.length]);
  }
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Pressable onPress={cycleLang} style={chip} accessibilityRole="button">
        <Ionicons name="globe-outline" size={14} color={t.fg} />
        <AppText weight="semibold" style={{ fontSize: 12 }}>
          {tr("lang.code")}
        </AppText>
      </Pressable>
      <Pressable onPress={toggle} style={chip} accessibilityRole="button">
        <Ionicons name={mode === "dark" ? "moon" : "sunny"} size={14} color={t.fg} />
      </Pressable>
    </View>
  );
}

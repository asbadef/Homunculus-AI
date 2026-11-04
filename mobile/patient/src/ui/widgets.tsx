import React from "react";
import { View, ViewProps, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme/ThemeProvider";
import { layout } from "../theme/tokens";
import { useI18n } from "../i18n";
import { LANGS } from "../i18n/core";
import { AppText } from "./base";

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

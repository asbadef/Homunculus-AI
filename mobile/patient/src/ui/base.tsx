import React from "react";
import { Text, TextProps, View, ViewProps, ScrollView, ScrollViewProps, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { layout } from "../theme/tokens";

// Themed text. Figtree with a system fallback (fallback kicks in if fonts fail to load).
export function AppText({ style, weight, color, ...rest }: TextProps & { weight?: "regular" | "medium" | "semibold" | "bold" | "extrabold"; color?: string }) {
  const { t } = useTheme();
  const family = {
    regular: layout.fontFamily,
    medium: layout.fontMedium,
    semibold: layout.fontSemiBold,
    bold: layout.fontBold,
    extrabold: layout.fontExtraBold,
  }[weight ?? "regular"];
  return <Text {...rest} style={[{ color: color ?? t.fg, fontFamily: family }, style]} />;
}

export function Title({ style, ...rest }: TextProps) {
  return <AppText weight="bold" style={[{ fontSize: 20 }, style]} {...rest} />;
}
export function Muted({ style, ...rest }: TextProps) {
  const { t } = useTheme();
  return <AppText style={[{ color: t.muted, fontSize: 13 }, style]} {...rest} />;
}

// Screen wrapper: themed background, top safe-area inset, side gutter.
export function Screen({ children, scroll, style, ...rest }: ViewProps & ScrollViewProps & { scroll?: boolean }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const pad = { paddingTop: insets.top, paddingLeft: Math.max(layout.pad, insets.left), paddingRight: Math.max(layout.pad, insets.right) };
  if (scroll) {
    return (
      <ScrollView {...rest} style={[{ flex: 1, backgroundColor: t.bg }]} contentContainerStyle={[pad, { paddingBottom: 24 }, style]}>
        {children}
      </ScrollView>
    );
  }
  return <View {...rest} style={[{ flex: 1, backgroundColor: t.bg }, pad, style]}>{children}</View>;
}

// Centered placeholder for screens not built yet.
export function Placeholder({ title, note }: { title: string; note?: string }) {
  const { t } = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
      <Title style={{ textAlign: "center" }}>{title}</Title>
      {note ? <Muted style={{ textAlign: "center", marginTop: 8 }}>{note}</Muted> : null}
    </View>
  );
}

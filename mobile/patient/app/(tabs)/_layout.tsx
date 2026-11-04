import React from "react";
import { View } from "react-native";
import { Tabs } from "expo-router";
import { TabBar } from "../../src/components/TabBar";
import { ViewingBanner } from "../../src/components/ViewingBanner";

const SCREENS = ["index", "randevu", "neticeler", "saglik", "profil"];

export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
        {SCREENS.map((name) => (
          <Tabs.Screen key={name} name={name} />
        ))}
      </Tabs>
      <ViewingBanner />
    </View>
  );
}

import React from "react";
import { Tabs } from "expo-router";
import { TabBar } from "../../src/components/TabBar";

const SCREENS = ["index", "randevu", "neticeler", "saglik", "profil"];

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      {SCREENS.map((name) => (
        <Tabs.Screen key={name} name={name} />
      ))}
    </Tabs>
  );
}

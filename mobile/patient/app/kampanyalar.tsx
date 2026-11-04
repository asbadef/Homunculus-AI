import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Screen, AppText, Muted } from "../src/ui/base";
import { Card, StackHeader } from "../src/ui/widgets";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n";
import { transport } from "../src/demo/transport";
import { Banner } from "../src/demo/types";

export default function Campaigns() {
  const { t: tr } = useI18n();
  const [list, setList] = useState<Banner[]>([]);
  useEffect(() => {
    transport.getBanners().then(setList);
  }, []);

  return (
    <Screen scroll>
      <StackHeader title={tr("menu.campaigns")} />
      <View style={{ gap: 12, paddingTop: 6 }}>
        {list.map((b) => (
          <Card key={b.id} style={{ backgroundColor: b.tint, borderColor: b.tint }}>
            <AppText weight="bold" color="#ffffff" style={{ fontSize: 16 }}>{b.title}</AppText>
            <Muted style={{ color: "#ffffff", opacity: 0.9, marginTop: 4 }}>{b.subtitle}</Muted>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

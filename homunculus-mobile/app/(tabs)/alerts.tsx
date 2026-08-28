import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useBoard } from "../../src/store/BoardProvider";
import { DemoBanner } from "../../src/ui/DemoBanner";
import { NotificationFeed } from "../../src/ui/NotificationFeed";

export default function AlertsScreen() {
  const { notifications } = useBoard();
  const router = useRouter();

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <DemoBanner />
      <View className="px-4 pb-1 pt-3">
        <Text className="text-foreground text-2xl font-semibold">{t("alerts.title")}</Text>
      </View>
      <NotificationFeed
        notifications={notifications}
        onSelect={(patientId) => router.push(`/patient/${patientId}`)}
      />
    </SafeAreaView>
  );
}

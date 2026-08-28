import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useBoard } from "../../src/store/BoardProvider";
import { DemoBanner } from "../../src/ui/DemoBanner";
import { WardList } from "../../src/ui/WardList";

export default function PatientsScreen() {
  const { ward } = useBoard();
  const router = useRouter();

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <DemoBanner />
      <View className="px-4 pb-2 pt-3">
        <Text className="text-foreground text-2xl font-semibold">{t("ward.title")}</Text>
        <Text className="text-clinical-stale text-xs">{t("ward.subtitle")}</Text>
      </View>
      <WardList
        ward={ward}
        // M1: the recording never empties mid-run, so "no beds yet" and "loading" coincide. A live
        // M2 feed can legitimately empty the ward — split this into a real has-loaded flag then.
        loading={ward.length === 0}
        onSelect={(patientId) => router.push(`/patient/${patientId}`)}
      />
    </SafeAreaView>
  );
}

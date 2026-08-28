import { Text, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";

import { t } from "../i18n";
import type { PatientView } from "../store/boardStore";
import { SPRING } from "../theme/motion";
import { PatientCard } from "./PatientCard";
import { Skeleton } from "./Skeleton";

export function WardList({
  ward,
  loading,
  onSelect,
}: {
  ward: PatientView[];
  loading: boolean;
  onSelect: (patientId: string) => void;
}) {
  if (loading && ward.length === 0) {
    return (
      <View className="gap-3 p-4">
        <Skeleton height={104} />
        <Skeleton height={104} />
        <Skeleton height={104} />
      </View>
    );
  }

  if (ward.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-8">
        <Text className="text-clinical-stale text-center">{t("ward.empty")}</Text>
      </View>
    );
  }

  // Animated.FlatList, not createAnimatedComponent(FlatList): only the former honours
  // itemLayoutAnimation, which is what makes a reordering ward spring instead of jump.
  return (
    <Animated.FlatList
      data={ward}
      itemLayoutAnimation={LinearTransition.springify()
        .damping(SPRING.damping)
        .mass(SPRING.mass)
        .stiffness(SPRING.stiffness)}
      keyExtractor={(item: PatientView) => item.board.patient_id}
      contentContainerClassName="p-4"
      renderItem={({ item }: { item: PatientView }) => (
        <PatientCard view={item} onPress={() => onSelect(item.board.patient_id)} />
      )}
    />
  );
}

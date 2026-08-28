/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { MotiView } from "moti";

import { SPRING_TRANSITION } from "../src/theme/motion";

describe("test harness", () => {
  it("renders a Reanimated view with an entering animation", async () => {
    await render(
      <Animated.View entering={FadeIn} accessibilityLabel="reanimated-probe">
        <Text>ok</Text>
      </Animated.View>,
    );
    expect(screen.getByLabelText("reanimated-probe")).toBeTruthy();
  });

  it("renders a Moti view with the shared spring transition", async () => {
    await render(
      <MotiView
        from={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={SPRING_TRANSITION}
        accessibilityLabel="moti-probe"
      >
        <Text>ok</Text>
      </MotiView>,
    );
    expect(screen.getByLabelText("moti-probe")).toBeTruthy();
  });
});

/// <reference types="jest" />
// The provider: defaults to the night skin, persists a switch, and hands out theme-correct
// colours. Component-level colour migration (Task 2) is exercised where it matters — e.g.
// RiskPill rendering the day palette after a switch — in that component's own test file; this
// file is about the provider/hook contract itself.
import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import * as SecureStore from "expo-secure-store";

import { ThemeProvider, useTheme } from "../src/theme/ThemeContext";
import palettes from "../src/theme/palette";

type MockedStore = typeof SecureStore & { __reset(): void };

beforeEach(() => {
  (SecureStore as MockedStore).__reset();
});

function Probe() {
  const { key, palette, toneColor, setTheme } = useTheme();
  return (
    <>
      <Text accessibilityLabel="key">{key}</Text>
      <Text accessibilityLabel="card">{palette.card}</Text>
      <Text accessibilityLabel="critical">{toneColor("critical")}</Text>
      <Text accessibilityLabel="flip" onPress={() => setTheme("icu")}>
        flip
      </Text>
    </>
  );
}

describe("ThemeProvider / useTheme", () => {
  // M6: light IS the kit (see src/theme/palette.js) and is now the default — the night skin is a
  // derived, arithmetic-checked variant a clinician opts into, not the app's resting state.
  it("defaults to the light (kit) skin", async () => {
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText("key").props.children).toBe("light");
    expect(screen.getByLabelText("card").props.children).toBe(palettes.light.card);
  });

  it("setTheme('icu') flips the palette and persists the choice", async () => {
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await act(async () => {
      screen.getByLabelText("flip").props.onPress();
    });

    expect(screen.getByLabelText("key").props.children).toBe("icu");
    expect(screen.getByLabelText("card").props.children).toBe(palettes.icu.card);

    expect(await SecureStore.getItemAsync("homunculus.theme")).toBe("icu");
  });

  it("toneColor('critical') differs between skins", async () => {
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    const before = screen.getByLabelText("critical").props.children;
    expect(before).toBe(palettes.light.clinical.critical);

    await act(async () => {
      screen.getByLabelText("flip").props.onPress();
    });

    const after = screen.getByLabelText("critical").props.children;
    expect(after).toBe(palettes.icu.clinical.critical);
    expect(after).not.toBe(before);
  });
});

/// <reference types="jest" />
// Task 3 of M3: the theme picker itself. It renders inside a real ThemeProvider (unlike most
// SettingsPanel-family tests) because flipping the skin and persisting the choice are the whole
// point of this component.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";

import { ThemeProvider } from "../src/theme/ThemeContext";
import { ThemeSection } from "../src/ui/ThemeSection";

type MockedStore = typeof SecureStore & { __reset(): void };

beforeEach(() => {
  (SecureStore as MockedStore).__reset();
});

async function section() {
  await render(
    <ThemeProvider>
      <ThemeSection />
    </ThemeProvider>,
  );
}

describe("ThemeSection", () => {
  it("shows both skin labels", async () => {
    await section();
    expect(screen.getByText("Gece / Nöbet")).toBeTruthy();
    expect(screen.getByText("Gündüz Klinik")).toBeTruthy();
  });

  it("is on the night skin by default", async () => {
    await section();
    expect(screen.getByText("Gece / Nöbet").parent?.props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByText("Gündüz Klinik").parent?.props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it("flips to the day skin on press", async () => {
    await section();

    await act(async () => {
      fireEvent.press(screen.getByText("Gündüz Klinik"));
    });

    expect(screen.getByText("Gündüz Klinik").parent?.props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByText("Gece / Nöbet").parent?.props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it("persists the choice under homunculus.theme", async () => {
    await section();

    await act(async () => {
      fireEvent.press(screen.getByText("Gündüz Klinik"));
    });

    expect(await SecureStore.getItemAsync("homunculus.theme")).toBe("light");
  });
});

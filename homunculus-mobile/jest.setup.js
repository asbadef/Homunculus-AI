require("react-native-gesture-handler/jestSetup");

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

// M6: the root layout gates first paint on useFonts (League Spartan) — see app/_layout.tsx.
// jest-expo's auto-mocked native ExpoFontLoader.loadAsync (see node_modules/jest-expo/src/preset/
// moduleMocks/expoModules.js — its `loadAsync` entry has no `functionType: 'promise'`, so the
// generic mock returns a bare `jest.fn()`, not a Promise) makes the real @expo-google-fonts
// useFonts hook throw on `.then` the instant any component calls it. Every component test in this
// suite renders in isolation (no <RootLayout>), so this mock only has to make `useFonts` behave
// like "already loaded" — no test should ever sit behind a font-loading gate.
jest.mock("expo-font", () => ({
  useFonts: () => [true, null],
  loadAsync: jest.fn(() => Promise.resolve()),
  isLoaded: () => true,
}));

// expo-secure-store wraps the platform keychain/keystore, which doesn't exist under Jest.
// In-memory Map stands in for it — good enough to exercise get/set/delete semantics without
// a native module. __reset lets tests start each case from an empty store.
jest.mock("expo-secure-store", () => {
  let store = new Map();
  return {
    getItemAsync: jest.fn((key) => Promise.resolve(store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn((key, value) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key) => {
      store.delete(key);
      return Promise.resolve();
    }),
    __reset: () => {
      store = new Map();
    },
  };
});

// react-native-worklets (Reanimated 4's native worklets runtime, a separate package as of
// Reanimated 4) eagerly initializes a native TurboModule the moment it is imported, and there is
// no such native module under Jest — it throws immediately. react-native-reanimated's own
// top-level mock (`react-native-reanimated/mock`) does not avoid this: it still imports the real
// `./index`, which imports `react-native-worklets`, so it crashes too.
//
// The fix, per react-native-worklets' own testing docs
// (https://docs.swmansion.com/react-native-worklets/docs/guides/testing/), is to mock
// react-native-worklets itself with its shipped mock. Reanimated's real code then runs on top of
// that mock substrate instead of the native runtime, so Animated.View, entering/exiting
// animations, etc. are the real Reanimated implementations — only the native worklets runtime is
// swapped out.
// SDK 54 note: react-native-worklets 0.5 ships no `src/mock` (that arrived with the 0.10 line for
// Reanimated 4.5). Under jest-expo 54 + Reanimated ~4.1 the worklets runtime is expected to run in
// its JS/jest fallback mode, so no module-level mock is needed here.

// Reanimated's own testing guide (https://docs.swmansion.com/react-native-reanimated/docs/guides/testing/):
// sets up its Jest-mode animation clock on top of the (now-mocked) worklets runtime.
require("react-native-reanimated").setUpTests();

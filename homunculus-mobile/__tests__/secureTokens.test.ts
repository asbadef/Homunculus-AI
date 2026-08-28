/// <reference types="jest" />
// The one module that actually touches expo-secure-store — tested against the real code, not a
// fake store, so the key names and the both-halves-or-null rule are pinned.
import * as SecureStore from "expo-secure-store";

import {
  clearTokens,
  getServerUrl,
  getTokens,
  setServerUrl,
  setTokens,
} from "../src/store/secureTokens";

type MockedStore = typeof SecureStore & { __reset(): void };

beforeEach(() => {
  (SecureStore as MockedStore).__reset();
});

describe("secureTokens", () => {
  it("round-trips a token pair", async () => {
    await setTokens({ access: "a1", refresh: "r1" });
    expect(await getTokens()).toEqual({ access: "a1", refresh: "r1" });
  });

  it("returns null when either half is missing", async () => {
    expect(await getTokens()).toBeNull();
    await SecureStore.setItemAsync("homunculus.access-token", "a1");
    expect(await getTokens()).toBeNull();
  });

  it("clears both halves", async () => {
    await setTokens({ access: "a1", refresh: "r1" });
    await clearTokens();
    expect(await getTokens()).toBeNull();
  });

  it("stores under homunculus-prefixed keys, nowhere else", async () => {
    await setTokens({ access: "a1", refresh: "r1" });
    expect(await SecureStore.getItemAsync("homunculus.access-token")).toBe("a1");
    expect(await SecureStore.getItemAsync("homunculus.refresh-token")).toBe("r1");
  });

  it("round-trips the server address", async () => {
    expect(await getServerUrl()).toBeNull();
    await setServerUrl("http://10.0.0.5");
    expect(await getServerUrl()).toBe("http://10.0.0.5");
  });
});

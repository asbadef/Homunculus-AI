// Session storage for the mobile app: the access/refresh token pair, the clinician-entered
// server address, and the chosen theme skin. Backed by expo-secure-store (iOS Keychain / Android
// Keystore) — never AsyncStorage, which is plaintext on disk. These tokens authorise clinical
// data, so they get the same handling the dashboard gives cookies-would-if-it-had-them: encrypted
// at rest, cleared on logout, never mixed with the app's ordinary (non-sensitive) local state.
// (The theme key is not sensitive — it lives here anyway, alongside the server-url pair, rather
// than starting a second, non-secure storage module for one small preference.)
import * as SecureStore from "expo-secure-store";

const ACCESS_KEY = "homunculus.access-token";
const REFRESH_KEY = "homunculus.refresh-token";
const SERVER_URL_KEY = "homunculus.server-url";
const THEME_KEY = "homunculus.theme";

export interface TokenPair {
  access: string;
  refresh: string;
}

export async function getTokens(): Promise<TokenPair | null> {
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  if (!access || !refresh) return null;
  return { access, refresh };
}

export async function setTokens(pair: TokenPair): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, pair.access),
    SecureStore.setItemAsync(REFRESH_KEY, pair.refresh),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}

export async function getServerUrl(): Promise<string | null> {
  return SecureStore.getItemAsync(SERVER_URL_KEY);
}

export async function setServerUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(SERVER_URL_KEY, url);
}

export async function getThemeKey(): Promise<string | null> {
  return SecureStore.getItemAsync(THEME_KEY);
}

export async function setThemeKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(THEME_KEY, key);
}

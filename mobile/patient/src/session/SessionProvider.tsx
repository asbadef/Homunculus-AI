import React, { createContext, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

export type SessionUser = { name: string; finMasked: string; phone: string };

type SessionCtx = {
  ready: boolean;
  signedIn: boolean;
  user: SessionUser | null;
  signIn: (user: SessionUser, persist?: boolean) => void;
  signOut: () => void;
};

const KEY = "hm-session";
const Ctx = createContext<SessionCtx>({ ready: false, signedIn: false, user: null, signIn: () => {}, signOut: () => {} });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((raw) => {
        if (raw) setUser(JSON.parse(raw));
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  function signIn(u: SessionUser, persist: boolean = true) {
    setUser(u);
    // "Remember me": only persist across restarts when asked; otherwise keep in memory only.
    if (persist) SecureStore.setItemAsync(KEY, JSON.stringify(u)).catch(() => {});
    else SecureStore.deleteItemAsync(KEY).catch(() => {});
  }
  function signOut() {
    setUser(null);
    SecureStore.deleteItemAsync(KEY).catch(() => {});
  }

  return <Ctx.Provider value={{ ready, signedIn: !!user, user, signIn, signOut }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

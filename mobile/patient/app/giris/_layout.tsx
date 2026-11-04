import React, { createContext, useContext, useState } from "react";
import { Stack } from "expo-router";
import { useTheme } from "../../src/theme/ThemeProvider";

export type AuthDraft = { country: "az" | "foreign"; id: string; birthdate: string; phone: string; remember: boolean };
type Ctx = { draft: AuthDraft; set: (p: Partial<AuthDraft>) => void };
const INITIAL: AuthDraft = { country: "az", id: "", birthdate: "", phone: "", remember: true };
const AuthCtx = createContext<Ctx>({ draft: INITIAL, set: () => {} });
export const useAuthDraft = () => useContext(AuthCtx);

export default function AuthLayout() {
  const { t } = useTheme();
  const [draft, setDraft] = useState<AuthDraft>(INITIAL);
  const set = (p: Partial<AuthDraft>) => setDraft((d) => ({ ...d, ...p }));
  return (
    <AuthCtx.Provider value={{ draft, set }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
    </AuthCtx.Provider>
  );
}

import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { useTheme } from "../theme/ThemeContext";
import { Chip, Row } from "./SettingsPanel";

type Connection = "demo" | "connecting" | "open" | "reconnecting";

/** Presentational — the screen owns useBoard(), auth.hasSession() resolution, and error
 * mapping. This component only renders what it is handed and reports intent upward. */
export function ServerSection({
  serverUrl,
  mode,
  connection,
  sessionNotice,
  hasSession,
  onSaveUrl,
  onLogin,
  onLogout,
  onGoLive,
  onGoReplay,
  loginError,
}: {
  serverUrl: string | null;
  mode: "replay" | "live";
  connection: Connection;
  sessionNotice: boolean;
  hasSession: boolean;
  onSaveUrl: (url: string) => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onLogout: () => void;
  onGoLive: () => void;
  onGoReplay: () => void;
  loginError: string | null;
}) {
  const { toneColor } = useTheme();
  const [address, setAddress] = useState(serverUrl ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // The stored address can arrive after this component mounts — BoardProvider loads it from
  // secure storage asynchronously. Sync the buffer whenever the source of truth changes.
  useEffect(() => {
    setAddress(serverUrl ?? "");
  }, [serverUrl]);

  return (
    <Row title={t("server.title")}>
      <Text className="text-clinical-stale text-sm">{t("server.address")}</Text>
      <View className="mt-1 flex-row items-center gap-2">
        <TextInput
          accessibilityLabel="server-address"
          value={address}
          onChangeText={setAddress}
          placeholder={t("server.addressPlaceholder")}
          placeholderTextColor={toneColor("muted")}
          autoCapitalize="none"
          autoCorrect={false}
          className="text-foreground border-clinical-border flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <Chip label={t("server.save")} active onPress={() => onSaveUrl(address)} />
      </View>

      {hasSession ? (
        <View className="mt-3 flex-row flex-wrap gap-2">
          <Chip label={t("server.logout")} active onPress={onLogout} />
          {mode === "replay" ? (
            <Chip label={t("server.goLive")} active onPress={onGoLive} />
          ) : null}
        </View>
      ) : (
        <View className="mt-3">
          <Text className="text-clinical-stale text-sm">{t("server.login.email")}</Text>
          <TextInput
            accessibilityLabel="login-email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            className="text-foreground border-clinical-border mt-1 rounded-lg border px-3 py-2 text-sm"
          />
          <Text className="text-clinical-stale mt-2 text-sm">{t("server.login.password")}</Text>
          <TextInput
            accessibilityLabel="login-password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            className="text-foreground border-clinical-border mt-1 rounded-lg border px-3 py-2 text-sm"
          />
          <View className="mt-2 flex-row">
            <Chip
              label={t("server.login.submit")}
              active
              onPress={() => void onLogin(email, password)}
            />
          </View>
        </View>
      )}

      {mode === "live" ? (
        <View className="mt-3 flex-row gap-2">
          <Chip label={t("server.goReplay")} active onPress={onGoReplay} />
        </View>
      ) : null}

      <Text className="text-clinical-stale mt-3 text-xs">
        {t(`server.status.${connection}` as MessageKey)}
      </Text>

      {sessionNotice ? (
        <Text className="mt-2 text-xs" style={{ color: toneColor("warning") }}>
          {t("server.sessionNotice")}
        </Text>
      ) : null}

      {loginError ? (
        <Text className="mt-2 text-xs" style={{ color: toneColor("critical") }}>
          {loginError}
        </Text>
      ) : null}
    </Row>
  );
}

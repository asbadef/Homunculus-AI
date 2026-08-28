import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useBoard } from "../../src/store/BoardProvider";
import { MfaRequiredError } from "../../src/transport/authClient";
import { DemoBanner } from "../../src/ui/DemoBanner";
import { ServerSection } from "../../src/ui/ServerSection";
import { SettingsPanel } from "../../src/ui/SettingsPanel";

export default function SettingsScreen() {
  const {
    controls,
    settings,
    setRole,
    setHaptics,
    setThresholdMs,
    setSpeed,
    mode,
    connection,
    sessionNotice,
    goLive,
    goReplay,
    serverUrl,
    setServerUrl,
    auth,
  } = useBoard();
  const [playing, setPlaying] = useState(() => controls.isPlaying());
  const [hasSession, setHasSession] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  async function refreshSession(): Promise<void> {
    setHasSession(await auth.hasSession());
  }

  useEffect(() => {
    void refreshSession();
    // Mount-only: hasSession is re-queried explicitly after login/logout below, not on every
    // render of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      {mode === "replay" ? <DemoBanner /> : null}
      <View className="px-4 pb-1 pt-3">
        <Text className="text-foreground text-2xl font-semibold">{t("settings.title")}</Text>
      </View>
      <SettingsPanel
        settings={settings}
        playing={playing}
        onPlay={() => {
          controls.play();
          setPlaying(true);
        }}
        onPause={() => {
          controls.pause();
          setPlaying(false);
        }}
        onRestart={() => controls.restart()}
        onSpeed={setSpeed}
        onRole={setRole}
        onHaptics={setHaptics}
        onThreshold={setThresholdMs}
        version="1.0.0"
        hidePlayback={mode === "live"}
      />
      <ServerSection
        serverUrl={serverUrl}
        mode={mode}
        connection={connection}
        sessionNotice={sessionNotice}
        hasSession={hasSession}
        onSaveUrl={(url) => void setServerUrl(url)}
        onLogin={async (email, password) => {
          setLoginError(null);
          try {
            await auth.login(email, password);
            await refreshSession();
          } catch (err) {
            if (err instanceof MfaRequiredError) {
              setLoginError(t("login.mfaUnsupported"));
            } else if (err instanceof Error) {
              setLoginError(t("login.failed", { detail: err.message }));
            } else {
              setLoginError(t("login.failed", { detail: String(err) }));
            }
          }
        }}
        onLogout={() => {
          void auth.logout().then(refreshSession);
        }}
        onGoLive={() => void goLive()}
        onGoReplay={goReplay}
        loginError={loginError}
      />
    </SafeAreaView>
  );
}

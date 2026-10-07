// src/live/screens/settings/SettingsScreen.jsx — the person's own settings (the prototype's
// ayarlar.js), trimmed to what Group 1 can back: how this browser shows the UI, who the server
// says you are, your password (local accounts) and what the hospital decided about two-step
// verification and the screen lock. Every signed-in user reaches it; it is the home of a session
// whose work screens a later wave builds.
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useTheme } from "../../theme/ThemeProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { PasswordForm } from "../../auth/PasswordForm.jsx";
import { Box, KV, KVList, Note, Seg, StatusPill, TabPanel, Tabs, useToast } from "../../ui/index.js";

const BUILD_SHA = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "";
const TAB_ID = "settings";

/** One setting: its name, then its choices (the prototype's .st-row). */
function Row({ label, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <b className="text-13.5">{label}</b>
      {children}
    </div>
  );
}

function Look() {
  const { t, lang, setLang, langs } = useI18n();
  const { theme, setTheme, size, setSize } = useTheme();
  return (
    <Box>
      <Row label={t("prefs.lang")}>
        <Seg label={t("prefs.lang")} value={lang} onChange={setLang} className="max-w-full flex-wrap"
          options={langs.map((l) => ({ value: l.code, label: l.native, lang: l.code }))} />
      </Row>
      <Row label={t("prefs.theme")}>
        <Seg label={t("prefs.theme")} value={theme} onChange={setTheme} options={[
          { value: "gece", label: t("prefs.themeGece"), icon: "moon" },
          { value: "gun", label: t("prefs.themeGun"), icon: "sun" },
        ]} />
      </Row>
      <Row label={t("prefs.size")}>
        <Seg label={t("prefs.size")} value={size} onChange={setSize} options={[
          { value: "normal", label: t("prefs.sizeNormal") },
          { value: "buyuk", label: t("prefs.sizeBuyuk") },
        ]} />
      </Row>
    </Box>
  );
}

function Profile() {
  const { t } = useI18n();
  const { user } = useSession();
  return (
    <Box>
      <KVList>
        <KV label={t("account.fullName")} mono={false}>{user.fullName}</KV>
        <KV label={t("account.username")}>{user.username}</KV>
        <KV label={t("account.email")}>{user.email ?? "—"}</KV>
        <KV label={t("account.hospital")} mono={false}>{user.tenantName || user.tenant}</KV>
        <KV label={t("account.groups")} mono={false}>{user.groups.map((g) => g.name).join(", ") || "—"}</KV>
        <KV label={t("account.source")} mono={false}>{t(user.authSource === "ldap" ? "account.sourceLdap" : "account.sourceLocal")}</KV>
        <KV label={t("account.version")}>{BUILD_SHA || "—"}</KV>
      </KVList>
    </Box>
  );
}

function Security() {
  const { t } = useI18n();
  const { user } = useSession();
  const toast = useToast();
  return (
    <div className="grid gap-3">
      <Box title={t("account.passwordTitle")} icon="key" level={2}>
        {user.authSource === "ldap" ? (
          <Note tone="info">{t("account.ldapPassword")}</Note>
        ) : (
          <div className="max-w-[420px]">
            <PasswordForm submitLabel={t("account.passwordSave")} onDone={() => toast(t("account.passwordChanged"))} />
          </div>
        )}
      </Box>
      <Box title={t("account.mfa")} icon="shield" level={2}
        right={<StatusPill tone={user.totpEnabled ? "ok" : "neutral"}>{t(user.totpEnabled ? "account.mfaOn" : "account.mfaOff")}</StatusPill>}>
        <p className="m-0 text-13 text-mute">{t("account.mfaHelp")}</p>
      </Box>
      <Box title={t("account.lock")} icon="lock" level={2}>
        <p className="m-0 mb-1 text-13 font-semibold">{t("account.lockValue", { minutes: user.lockIdleMinutes })}</p>
        <p className="m-0 text-13 text-mute">{t("account.lockHelp")}</p>
      </Box>
    </div>
  );
}

export function SettingsScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState("look");
  const tabs = [
    { value: "look", label: t("account.look") },
    { value: "profile", label: t("account.profile") },
    { value: "security", label: t("account.security") },
  ];
  return (
    <div className="max-w-[860px]">
      <h1 className="m-0 font-display text-23 font-bold">{t("nav.settings")}</h1>
      <p className="m-0 mb-4 text-13 text-mute">{t("account.sub")}</p>
      <Tabs id={TAB_ID} label={t("account.sections")} tabs={tabs} value={tab} onChange={setTab} className="mb-3" />
      <TabPanel id={TAB_ID} tabs={tabs} value={tab}>
        {tab === "look" ? <Look /> : tab === "profile" ? <Profile /> : <Security />}
      </TabPanel>
    </div>
  );
}

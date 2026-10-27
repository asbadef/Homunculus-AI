// src/live/screens/settings/SettingsScreen.jsx — the person's own settings (the prototype's
// ayarlar.js), trimmed to what Group 1 can back: how this browser shows the UI, who the server
// says you are, your password (local accounts) and what the hospital decided about two-step
// verification and the screen lock. Every signed-in user reaches it; it is the home of a session
// whose work screens a later wave builds.
import React, { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { ddmmhhmm } from "../../i18n/dates.js";
import { useTheme } from "../../theme/ThemeProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { PasswordForm } from "../../auth/PasswordForm.jsx";
import { useAlarmSignals } from "../../signals/AlarmSignals.jsx";
import { Box, Button, KV, KVList, Note, Seg, StatusPill, TabPanel, Table, Tabs, riskStyle, useToast } from "../../ui/index.js";
import { useShadow } from "../../data/ShadowProvider.jsx";
import { stripOn } from "../common/MonitorStrip.jsx";
import { EVIDENCE, PARAM_ORDER, PARTIAL } from "../common/monitor.js";

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

const SOUND_PILL = {
  off: ["neutral", "signals.soundOff"],
  waiting: ["att", "signals.soundStateWaiting"],
  on: ["ok", "signals.soundStateRunning"],
  unsupported: ["neutral", "signals.soundStateUnsupported"],
};
const NOTIFY_PILL = {
  granted: ["ok", "signals.notifyStateGranted"],
  default: ["neutral", "signals.notifyStateDefault"],
  denied: ["att", "signals.notifyStateDenied"],
  insecure: ["neutral", "signals.notifyStateUnavailable"],
  unsupported: ["neutral", "signals.notifyStateUnavailable"],
};
const NOTIFY_NOTE = {
  denied: "signals.notifyDenied",
  insecure: "signals.notifyInsecure",
  unsupported: "signals.notifyUnsupported",
};

/** Aşama A: what the unvalidated monitor strip is, beside the sound and the notifications it never
 *  makes — shown only while the hospital has it on. The evidence table is every parameter the
 *  strip can show, in the API's order, with the four only partly checked marked. */
function MonitorLegend() {
  const { t } = useI18n();
  const { data } = useShadow();
  if (!stripOn(data)) return null;
  return (
    <Box title={t("monitor.legendTitle")} icon="activity" level={2} className="!border-dashed">
      <p className="m-0 text-13">{t("monitor.full")}</p>
      <p className="m-0 mt-2 text-13 font-semibold">{t("monitor.noSound")}</p>
      <p className="m-0 mt-2 text-13 text-mute">{t("monitor.legendAges")}</p>
      <p className="m-0 mt-2 text-13 text-mute">{t("monitor.legendNbp")}</p>
      <div className="mt-3 overflow-x-auto">
        <Table caption={t("monitor.legendEvidence")}>
          <thead>
            <tr>
              <th scope="col">{t("monitor.legendParameter")}</th>
              <th scope="col">{t("monitor.legendEvidence")}</th>
            </tr>
          </thead>
          <tbody>
            {PARAM_ORDER.map((name) => (
              <tr key={name}>
                <th scope="row" className="font-data">
                  {t(`monitor.p.${name}`)}
                  {PARTIAL.has(name) ? <StatusPill tone="neutral" className="ml-1.5">{t("monitor.partial")}</StatusPill> : null}
                </th>
                <td>{t(`monitor.ev.${EVIDENCE[name]}`)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <p className="m-0 mt-2 text-12.5 text-mute">{t("monitor.legendN")}</p>
    </Box>
  );
}

/** An engine stamp as `dd.MM hh:mm` in the reader's clock, or a dash for one that does not parse — the
 *  week's list spans days, so every stamp carries its day and month. */
function whenOf(iso) {
  const ms = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ddmmhhmm(ms) : "—";
}

/** Aşama B (D7): «Uyarsaydı — son 7 gün» — every finding the shadow engine opened in the last week, with
 *  when it cleared: the ones that would not have appeared without the monitor's unvalidated inputs. It is
 *  the material of the weekly review, nothing more: no row opens a patient, nothing rings, nothing in it
 *  is coloured by its severity (the word carries it), and it is read when the reader opens this tab —
 *  fetched once per opening, never polled, never live. Only while the hospital runs the rules (`stage`
 *  «rules»): at «shadow» or «off» there is no shadow engine to ask, and nothing is asked. A list that
 *  could not be read says so; it never reads as an empty week. */
function ShadowWeek() {
  const { t } = useI18n();
  const shadow = useShadow();
  const { store } = shadow;
  const rules = shadow.data?.stage === "rules";
  const [week, setWeek] = useState({ phase: "loading", findings: [] });
  useEffect(() => {
    if (!rules) return undefined;
    let current = true;
    setWeek({ phase: "loading", findings: [] });
    store.findings(7).then(
      (body) => { if (current) setWeek({ phase: "ok", findings: body.findings }); },
      () => { if (current) setWeek({ phase: "failed", findings: [] }); },
    );
    return () => { current = false; };
  }, [rules, store]);
  if (!rules) return null;
  return (
    <div data-shadow-week="">
      <Box title={t("shadow.week")} icon="clock" level={2} className="!border-dashed">
        <p className="m-0 text-13 text-mute">{t("shadow.weekHelp")}</p>
        {week.phase === "loading" ? (
          <p className="m-0 mt-2 text-13 text-mute">{t("shadow.weekLoading")}</p>
        ) : week.phase === "failed" ? (
          <Note tone="warn" className="mt-2">{t("shadow.weekUnavailable")}</Note>
        ) : week.findings.length === 0 ? (
          <p className="m-0 mt-2 text-13">{t("shadow.weekNone")}</p>
        ) : (
          <div className="mt-2">
            <Table caption={t("shadow.week")}>
              <thead>
                <tr>
                  <th scope="col">{t("shadow.colPatient")}</th>
                  <th scope="col">{t("shadow.colKind")}</th>
                  <th scope="col">{t("shadow.colSeverity")}</th>
                  <th scope="col">{t("shadow.colOpened")}</th>
                  <th scope="col">{t("shadow.colCleared")}</th>
                </tr>
              </thead>
              <tbody>
                {week.findings.map((f, i) => {
                  const severity = riskStyle(f.severity, { measured: true });
                  return (
                    <tr key={`${f.patient_id}:${f.kind}:${f.opened_at}:${i}`}>
                      <th scope="row" className="font-data">{f.patient_id}</th>
                      <td className="font-data">{f.kind}</td>
                      <td>{t(severity.labelKey, severity.labelVars)}</td>
                      <td className="whitespace-nowrap">{whenOf(f.opened_at)}</td>
                      <td className="whitespace-nowrap">{f.cleared_at ? whenOf(f.cleared_at) : t("shadow.weekOpen")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Box>
    </div>
  );
}

/** The alarm sound and the critical-alarm notification for this browser (signals/AlarmSignals.jsx):
 *  what the previous workspace's two top-bar buttons did, with what each state means said out loud. */
function Signals() {
  const { t } = useI18n();
  const { sound, setSound, testSound, notify, askNotify, testNotify } = useAlarmSignals();
  const [soundTone, soundLabel] = SOUND_PILL[sound];
  const [notifyTone, notifyLabel] = NOTIFY_PILL[notify] ?? NOTIFY_PILL.unsupported;
  return (
    <div className="grid gap-3">
      <Box title={t("signals.sound")} icon="bell" level={2} right={<StatusPill tone={soundTone}>{t(soundLabel)}</StatusPill>}>
        <Seg label={t("signals.sound")} value={sound === "off" ? "off" : "on"} onChange={(value) => setSound(value === "on")}
          options={[{ value: "off", label: t("signals.soundOff") }, { value: "on", label: t("signals.soundOn") }]} />
        <p className="m-0 mt-2 text-13 text-mute">{t("signals.soundHelp")}</p>
        {sound === "waiting" ? <Note className="mt-2">{t("signals.soundWaitingHelp")}</Note> : null}
        {sound === "unsupported" ? <Note className="mt-2">{t("signals.soundUnsupported")}</Note> : null}
        {sound === "on" ? <Button className="mt-2" icon="bell" onClick={testSound}>{t("signals.soundTest")}</Button> : null}
      </Box>
      <Box title={t("signals.notify")} icon="alert" level={2} right={<StatusPill tone={notifyTone}>{t(notifyLabel)}</StatusPill>}>
        <p className="m-0 text-13 text-mute">{t("signals.notifyHelp")}</p>
        {NOTIFY_NOTE[notify] ? <Note className="mt-2">{t(NOTIFY_NOTE[notify])}</Note> : null}
        {notify === "default" ? <Button className="mt-2" variant="primary" onClick={askNotify}>{t("signals.notifyAsk")}</Button> : null}
        {notify === "granted" ? <Button className="mt-2" onClick={testNotify}>{t("signals.notifyTest")}</Button> : null}
      </Box>
      <MonitorLegend />
      <ShadowWeek />
    </div>
  );
}

export function SettingsScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState("look");
  const tabs = [
    { value: "look", label: t("account.look") },
    { value: "signals", label: t("signals.tab") },
    { value: "profile", label: t("account.profile") },
    { value: "security", label: t("account.security") },
  ];
  return (
    <div className="max-w-[860px]">
      <h1 className="m-0 font-display text-23 font-bold">{t("nav.settings")}</h1>
      <p className="m-0 mb-4 text-13 text-mute">{t("account.sub")}</p>
      <Tabs id={TAB_ID} label={t("account.sections")} tabs={tabs} value={tab} onChange={setTab} className="mb-3" />
      <TabPanel id={TAB_ID} tabs={tabs} value={tab}>
        {tab === "look" ? <Look /> : tab === "signals" ? <Signals /> : tab === "profile" ? <Profile /> : <Security />}
      </TabPanel>
    </div>
  );
}

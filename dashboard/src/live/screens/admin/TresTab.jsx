// src/live/screens/admin/TresTab.jsx — Yönetim › TRƏS (TRƏS-01 · phase F0, spec §6, §8, D2, D3): the hospital's
// settings for the national e-health feed, and a test of the connection. `tres.manage`.
//
// TWO LOCKS, AND THE TAB SAYS WHICH IS CLOSED (D2). The hospital's own is the mode on this form («Kapalı» by
// default). The install's is `TRES_EGRESS`, which only whoever runs the server can set: while it is closed the tab
// says, above everything else, that nothing leaves the server whatever is set here — and «Bağlantıyı sına» is
// disabled, because the server would refuse it.
//
// THE PASSWORD IS WRITE-ONLY (D3). The server never sends one back, only `password_set`; the field is always empty
// when the form opens and shows «kayıtlı» as its placeholder when one is stored. Left empty it is left OUT of the
// body, and the server keeps what it has; «Kayıtlı parolayı sil» sends an empty string, which clears it. A changed
// server address clears it too, unless a new one is typed in the same save (the engine's rule; the address's hint says
// so): a stored password never follows the hospital's account to another server.
//
// A FORM NEVER STANDS ON DEFAULTS IT DID NOT READ (ProtocolTab's rule): while no read has answered, the tab shows
// the refusal and a retry, not the form. A refused save keeps what was typed — an account is six fields.
//
// «Bağlantıyı sına» uses the STORED account of the selected environment, not what is on screen; the note under the
// buttons says so. The platform's own words for a refused sign-in are shown as it wrote them.
//
// A REFUSED LOGIN PARKS THE FEED (engine worker.py, review I3): while `session_refused_at` is set the tab says, under the
// lock, that nothing is sent until the account is corrected and saved or a test succeeds; a successful test lifts it.
//
// PHASE F1. The automatic rounds' start (`send_from`, open item O15 — a PROPOSED rule, awaiting the owner's word): shown
// and movable here; left as read it is left OUT of the body, and the server keeps it. It is a `datetime-local` in the
// READER's zone, and the field says which (the browser's, by name), is bounded as the server bounds it (2020-01-01 to a
// year and a day from now) and, emptied, says it cannot be emptied here: nothing is sent for it and the stored start stays.
// The live platform is closed in this version (O5, O11): with the live environment and a mode other than «Kapalı» the
// form says so before the server refuses it. Under the settings, the three panels of F1: «Gönderimler», «Bölüm eşleme»,
// «Hekim kimlikleri».
//
// THE LEDGER IS NEVER STALE AGAINST THE SETTINGS (review, 2026-11-13). `ledger` counts the moments the ledger's own answer
// may have changed under it — a save (the environment may have switched) and a connection test that succeeded (the parked
// feed was lifted: the panel's note goes with the tab's) — and `<TresDeliveries refresh>` reads again each
// time, keeping its filters and the number typed. A failed test parks and lifts nothing: no read.
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { dayStamp } from "../../i18n/dates.js";
import { Box, Button, Field, Input, Note, Select, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";
import { TYPES } from "./tresWords.js";
import { TresDeliveries } from "./TresDeliveries.jsx";
import { TresDepartments } from "./TresDepartments.jsx";
import { TresPractitioners } from "./TresPractitioners.jsx";
import { TresReadFailed } from "./TresReadFailed.jsx";

export { TYPES };
export const MODES = Object.freeze([["off", "tres.modeOff"], ["validate", "tres.modeValidate"], ["send", "tres.modeSend"]]);
/** [environment, its name in the select, its account's heading]. */
export const ENVIRONMENTS = Object.freeze([
  ["test", "tres.envTest", "tres.accountTest"], ["live", "tres.envLive", "tres.accountLive"],
]);
const TEXT_FIELDS = Object.freeze(["base_url", "username", "provider_id", "organization_id", "organization_name"]);
const SETTLE = /^\d{1,3}$/;
/** The cut-off's bounds, as the server holds them (`tres_send_from`): 2020-01-01 to a year and a day from now. */
const SEND_FROM_MIN = "2020-01-01T00:00";
const SEND_FROM_MAX_DAYS = 366;

const accountForm = (a) => ({
  ...Object.fromEntries(TEXT_FIELDS.map((name) => [name, a?.[name] ?? ""])), password: "", clearPassword: false,
});
const pad = (n) => String(n).padStart(2, "0");
/** An instant as a `datetime-local` value in the reader's own zone ("" for none). */
export function localInput(iso) {
  const at = typeof iso === "string" ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return "";
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
/** The browser's time zone by name («Asia/Baku»), or "" when it will not say. */
function zoneName() {
  try {
    return String(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
  } catch {
    return "";
  }
}
const formOf = (s) => ({
  mode: s?.mode ?? "off", environment: s?.environment ?? "test", settle: String(s?.settle_hours ?? 24),
  types: Array.isArray(s?.enabled_types) ? [...s.enabled_types] : TYPES.map(([key]) => key),
  test: accountForm(s?.test), live: accountForm(s?.live),
  sendFrom: localInput(s?.send_from), sendFromRead: localInput(s?.send_from),
});

/** One account as the server takes it: empty text is null; the password is left out unless typed, "" to clear. */
export function accountBody(account) {
  const body = Object.fromEntries(TEXT_FIELDS.map((name) => [name, account[name].trim() === "" ? null : account[name].trim()]));
  if (account.clearPassword) body.password = "";
  else if (account.password !== "") body.password = account.password;
  return body;
}

export function bodyOf(form) {
  const body = {
    mode: form.mode, environment: form.environment, settle_hours: Number(form.settle),
    enabled_types: TYPES.map(([key]) => key).filter((key) => form.types.includes(key)),
    test: accountBody(form.test), live: accountBody(form.live),
  };
  // O15 (proposed): the cut-off goes only when moved — the server keeps the stored one otherwise.
  const moved = form.sendFrom !== undefined && form.sendFrom !== form.sendFromRead && form.sendFrom !== "";
  if (moved && !Number.isNaN(new Date(form.sendFrom).getTime())) body.send_from = new Date(form.sendFrom).toISOString();
  return body;
}

/** What the form holds that the server would refuse: the wait, and each account's address. */
export function invalid(form) {
  const badUrl = (account) => account.base_url.trim() !== "" && !account.base_url.trim().startsWith("https://");
  const settle = !SETTLE.test(form.settle) || Number(form.settle) > 168;
  return { settle, test: badUrl(form.test), live: badUrl(form.live) };
}

/** Is the stored account of the selected environment whole? (What the server needs to open a session.) */
const accountWhole = (account) => Boolean(account?.base_url && account?.username && account?.password_set && account?.provider_id);

function AccountFields({ title, account, stored, error, onChange }) {
  const { t } = useI18n();
  const set = (patch) => onChange({ ...account, ...patch });
  return (
    <fieldset className="mb-3 rounded-ctl border border-line px-3 pb-1 pt-2">
      <legend className="px-1 font-text text-13.5 font-semibold text-mute">{title}</legend>
      <Field label={t("tres.baseUrl")} hint={`${t("tres.baseUrlHint")} ${t("tres.baseUrlClears")}`}
        error={error ? t("tres.invalid.baseUrl") : undefined}>
        <Input value={account.base_url} maxLength={200} inputMode="url" onChange={(e) => set({ base_url: e.target.value })} />
      </Field>
      <Field label={t("tres.username")}>
        <Input value={account.username} maxLength={120} autoComplete="off" onChange={(e) => set({ username: e.target.value })} />
      </Field>
      <Field label={t("tres.password")} hint={stored ? t("tres.passwordSet") : t("tres.passwordUnset")}>
        <Input type="password" value={account.password} maxLength={200} autoComplete="new-password"
          disabled={account.clearPassword} placeholder={stored ? t("tres.passwordStored") : undefined}
          onChange={(e) => set({ password: e.target.value })} />
      </Field>
      {stored ? (
        <label className="mb-2.5 flex items-center gap-2 font-text text-13.5">
          <input type="checkbox" checked={account.clearPassword}
            onChange={(e) => set({ clearPassword: e.target.checked, password: "" })} />
          {t("tres.passwordClear")}
        </label>
      ) : null}
      <Field label={t("tres.providerId")}>
        <Input value={account.provider_id} maxLength={64} onChange={(e) => set({ provider_id: e.target.value })} />
      </Field>
      <Field label={t("tres.organizationId")}>
        <Input value={account.organization_id} maxLength={64} onChange={(e) => set({ organization_id: e.target.value })} />
      </Field>
      <Field label={t("tres.organizationName")}>
        <Input value={account.organization_name} maxLength={200} onChange={(e) => set({ organization_name: e.target.value })} />
      </Field>
    </fieldset>
  );
}

export function TresTab() {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(() => formOf(null));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [ledger, setLedger] = useState(0);
  const staleLedger = () => setLedger((n) => n + 1);

  const read = useCallback(async () => {
    try {
      const got = await store.track(() => store.api.tresSettings());
      if (!got || typeof got !== "object") throw new Error("no settings in the answer");
      setSettings(got);
      setForm(formOf(got));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [store]);
  useEffect(() => { read(); }, [read]);

  const bad = invalid(form);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggle = (key, on) => set({ types: on ? [...form.types, key] : form.types.filter((k) => k !== key) });

  async function retry() {
    setBusy(true);
    try {
      await read();
    } finally {
      setBusy(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    if (bad.settle || bad.test || bad.live) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      const got = await store.track(() => store.api.saveTresSettings(bodyOf(form)));
      setSettings(got);
      setForm(formOf(got));
      setTried(false);
      staleLedger();
      toast(t("tres.saved"));
    } catch (err) {
      toast(refusedFor(t, t("tres.tab"), err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    if (testing) return;
    setTesting(true);
    try {
      const got = await store.track(() => store.api.testTres());
      if (got?.ok === true) {
        toast(t("tres.testOk"));
        // The server let the rounds go on (it cleared `session_refused_at`): so does the tab.
        setSettings((s) => (s ? { ...s, session_refused_at: null } : s));
        staleLedger();
      } else {
        const said = typeof got?.message === "string" && got.message.trim() ? got.message.trim() : t("tres.testNoWords");
        toast(t("tres.testFailed", { reason: said }), "error");
      }
    } catch (err) {
      toast(refusedFor(t, t("tres.test"), err), "error");
    } finally {
      setTesting(false);
    }
  }

  if (settings === null && error === null) {
    return <Box><p className="m-0 text-13 text-mute">{t("tres.loading")}</p></Box>;
  }
  if (settings === null) {
    return (
      <div className="grid max-w-[760px] gap-3">
        <TresReadFailed text={t("tres.readFailed", { reason: readErrorText(t, error) })} busy={busy} onRetry={retry} />
      </div>
    );
  }
  const open = settings.egress === true;
  const refusedAt = typeof settings.session_refused_at === "string" ? settings.session_refused_at : null;
  const incomplete = settings.mode !== "off" && !accountWhole(settings[settings.environment]);
  const zone = zoneName();
  const sendFromMax = localInput(new Date(Date.now() + SEND_FROM_MAX_DAYS * 86_400_000).toISOString());
  // A stored cut-off with the field emptied: the body leaves it out and the server keeps what it has — said, not silent.
  const sendFromCleared = form.sendFromRead !== "" && form.sendFrom === "";
  return (
    <div className="grid max-w-[760px] gap-3">
      {open
        ? <Note tone="info" icon="globe">{t("tres.egressOn")}</Note>
        : <Note tone="warn" icon="lock">{t("tres.egressOff")}</Note>}
      {refusedAt ? (
        <Note tone="warn" icon="alert">
          {t("tres.sessionRefused", { time: dayStamp(Date.parse(refusedAt), Date.now()) })}
        </Note>
      ) : null}
      <Box title={t("tres.title")} icon="globe" level={2}>
        <p className="m-0 mb-3 text-13 text-mute">{t("tres.sub")}</p>
        <form noValidate autoComplete="off" onSubmit={save}>
          <Field label={t("tres.mode")} hint={t("tres.modeHint")}>
            <Select value={form.mode} onChange={(e) => set({ mode: e.target.value })}>
              {MODES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </Select>
          </Field>
          <Field label={t("tres.environment")}>
            <Select value={form.environment} onChange={(e) => set({ environment: e.target.value })}>
              {ENVIRONMENTS.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </Select>
          </Field>
          {incomplete ? <Note tone="warn" icon="alert" className="mb-3">{t("tres.incomplete")}</Note> : null}
          {form.environment === "live" && form.mode !== "off"
            ? <Note tone="warn" icon="lock" className="mb-3">{t("tres.liveNote")}</Note> : null}
          <Field label={t("tres.sendFrom")} hint={(
            <>
              <span>{settings.send_from ? t("tres.sendFromHint") : t("tres.sendFromUnset")}</span>
              {zone ? <span className="block">{t("tres.sendFromZone", { zone })}</span> : null}
              {sendFromCleared ? <span className="block font-semibold text-ink">{t("tres.sendFromCleared")}</span> : null}
            </>
          )}>
            <Input type="datetime-local" value={form.sendFrom} min={SEND_FROM_MIN} max={sendFromMax}
              onChange={(e) => set({ sendFrom: e.target.value })} />
          </Field>
          <Field label={t("tres.settleHours")} hint={t("tres.settleHint")}
            error={tried && bad.settle ? t("tres.invalid.settle") : undefined}>
            <Input value={form.settle} inputMode="numeric" maxLength={3} onChange={(e) => set({ settle: e.target.value })} />
          </Field>
          <fieldset className="mb-3 border-0 p-0">
            <legend className="mb-1 font-text text-13.5 font-semibold text-mute">{t("tres.types")}</legend>
            {TYPES.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 py-0.5 font-text text-13.5">
                <input type="checkbox" checked={form.types.includes(key)} onChange={(e) => toggle(key, e.target.checked)} />
                <span>{t(label)}</span>
              </label>
            ))}
          </fieldset>
          {ENVIRONMENTS.map(([env, , heading]) => (
            <AccountFields key={env} title={t(heading)} account={form[env]} stored={settings[env]?.password_set === true}
              error={tried && bad[env]} onChange={(next) => set({ [env]: next })} />
          ))}
          {settings.updated_at ? (
            <p className="m-0 mb-2 text-12 text-mute">
              {t("tres.updated", { time: dayStamp(Date.parse(settings.updated_at), Date.now()) })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={busy}>{t("tres.save")}</Button>
            <Button icon="plug" busy={testing} disabled={!open} onClick={testConnection}>{t("tres.test")}</Button>
          </div>
          <p className="m-0 mt-2 text-12 text-mute">{open ? t("tres.testHint") : t("tres.testEgressOff")}</p>
        </form>
      </Box>
      <TresDeliveries refresh={ledger} />
      <TresDepartments />
      <TresPractitioners />
    </div>
  );
}

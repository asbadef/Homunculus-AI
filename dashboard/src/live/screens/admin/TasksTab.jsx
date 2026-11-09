// src/live/screens/admin/TasksTab.jsx — Yönetim › Görevler (G3-02 D10): the two shift starts, the grace, the
// vital interval per NEWS2 band. Only band 0 has a vault-sourced default (news2-rcp-2017); the others are
// the hospital's protocol and start empty — an empty band produces no task. Pattern: ProtocolTab.
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { dayStamp } from "../../i18n/dates.js";
import { Alert, Box, Button, Field, Input, Note, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";

export const BANDS = Object.freeze([["b0", "gorevler.bandB0"], ["b1_4", "gorevler.bandB1_4"], ["b3_single", "gorevler.bandB3single"], ["b5_6", "gorevler.bandB5_6"], ["b7", "gorevler.bandB7"]]);
const formOf = (s) => ({ a: String(s?.shift_start_a ?? 8), b: String(s?.shift_start_b ?? 20), grace: String(s?.grace_min ?? 30),
  ...Object.fromEntries(BANDS.map(([k]) => [k, s?.intervals?.[k] == null ? "" : String(s.intervals[k])])) });
const int = (text) => (/^\d+$/.test(text) ? Number(text) : NaN);
export function bodyOf(form) {
  return { shift_start_a: int(form.a), shift_start_b: int(form.b), grace_min: int(form.grace),
    intervals: Object.fromEntries(BANDS.map(([k]) => [k, form[k].trim() === "" ? null : int(form[k])])) };
}
export function invalid(body) {
  const hour = (h) => Number.isInteger(h) && h >= 0 && h <= 23;
  if (!hour(body.shift_start_a) || !hour(body.shift_start_b) || body.shift_start_a === body.shift_start_b) return true;
  if (!Number.isInteger(body.grace_min) || body.grace_min < 0 || body.grace_min > 240) return true;
  return Object.values(body.intervals).some((v) => v !== null && (!Number.isInteger(v) || v < 5 || v > 1440));
}

export function TasksTab() {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(() => formOf(null));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const read = useCallback(async () => {
    try { const got = await store.track(() => store.api.taskSettings()); setSettings(got); setForm(formOf(got)); setError(null); }
    catch (err) { setError(err); }
  }, [store]);
  useEffect(() => { read(); }, [read]);
  const body = bodyOf(form);
  const bad = invalid(body);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    if (bad) { setTried(true); return; }
    setBusy(true);
    try { const got = await store.track(() => store.api.saveTaskSettings(body)); setSettings(got); setForm(formOf(got)); setTried(false); toast(t("gorevler.settingsSaved")); }
    catch (err) { toast(refusedFor(t, t("gorevler.settingsTab"), err), "error"); await read(); }
    finally { setBusy(false); }
  }
  if (settings === null && error === null) return <Box><p className="m-0 text-13 text-mute">{t("gorevler.settingsLoading")}</p></Box>;
  if (settings === null) return <Alert tone="crit"><p className="m-0">{t("gorevler.settingsReadFailed", { reason: readErrorText(t, error) })}</p><Button size="sm" onClick={read}>{t("admin.retry")}</Button></Alert>;
  const onlyB0 = BANDS.every(([k]) => k === "b0" || settings.intervals?.[k] == null);
  return (
    <div className="grid max-w-[760px] gap-3">
      <Box title={t("gorevler.settingsTitle")} icon="clip" level={2}>
        <p className="m-0 mb-3 text-13 text-mute">{t("gorevler.settingsIntro")}</p>
        {onlyB0 ? <Note tone="info" icon="clock" className="mb-3">{t("gorevler.settingsUnset")}</Note> : null}
        <form noValidate autoComplete="off" onSubmit={save} className="grid gap-2">
          <Field label={t("gorevler.shiftA")}><Input inputMode="numeric" value={form.a} onChange={(e) => set({ a: e.target.value })} /></Field>
          <Field label={t("gorevler.shiftB")}><Input inputMode="numeric" value={form.b} onChange={(e) => set({ b: e.target.value })} /></Field>
          <Field label={t("gorevler.grace")}><Input inputMode="numeric" value={form.grace} onChange={(e) => set({ grace: e.target.value })} /></Field>
          <h3 className="m-0 mt-2 text-14.5 font-bold">{t("gorevler.intervalsTitle")}</h3>
          {BANDS.map(([k, label]) => (
            <Field key={k} label={t(label)} hint={k === "b0" ? undefined : t("gorevler.bandEmpty")}>
              <Input inputMode="numeric" value={form[k]} placeholder={k === "b0" ? "" : "—"} onChange={(e) => set({ [k]: e.target.value })} />
            </Field>
          ))}
          <p className="m-0 text-12 text-mute">{t("gorevler.sourceNote")}</p>
          {tried && bad ? <Alert tone="crit"><p className="m-0">{t("gorevler.settingsInvalid")}</p></Alert> : null}
          {settings.updated_by ? <p className="m-0 text-12 text-mute">{t("gorevler.settingsUpdated", { who: settings.updated_by, time: dayStamp(Date.parse(settings.updated_at), Date.now()) })}</p> : null}
          <div><Button type="submit" variant="primary" busy={busy}>{t("gorevler.save")}</Button></div>
        </form>
      </Box>
    </div>
  );
}

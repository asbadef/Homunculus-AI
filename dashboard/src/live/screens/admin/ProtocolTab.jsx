// src/live/screens/admin/ProtocolTab.jsx — Yönetim › Protokol ve etiket (Group 2 · B1d, spec §3,
// §6, D5, D6, D11): the protocol number the next admission takes, and the label it prints on.
// `structure.manage`.
//
// NO ADMISSION UNTIL A START NUMBER IS SET (D5): a range Homunculus picked by itself could collide
// with the old HBYS's protocols, so the tab says so while none is set. The number moves FORWARD only:
// the server refuses one not above the last issued (`protocol_not_forward`) — said on the toast by its
// code, and the settings read again (a number may have been issued since this screen read them).
//
// THE CLIENT HOLDS THE SERVER'S RULES BEFORE IT SENDS: twelve ASCII digits, and not 000000000000 (A-1:
// it is the number the test label prints, so no real protocol may equal it — the engine's case table
// `label_fit_cases.json` `next_no_cases` pins both sides); the size and the fit by the engine's own
// rule (`labelRefusal`, one case table pins both), the narrowest width named in whole millimetres —
// the width is whole millimetres too. «Deneme etiketi yazdır» prints the synthetic test label in the
// size on screen (the saved one while the screen's does not fit): no request, no patient.
//
// A FORM NEVER STANDS ON DEFAULTS IT DID NOT READ: while no read has answered, the tab shows the
// refusal and a retry, not the form — saving 50 × 30 mm over a stored 100 × 60 mm because one read
// failed would be a write the administrator never chose.
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, Field, Input, Note, Select, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";
import {
  DOTS_PER_MODULE, TEST_PROTOCOL, labelRefusal, minWidthMm, openLabelWindow, printLabel, testLabel,
} from "../kabul/label/protocolLabel.js";

const DPIS = Object.keys(DOTS_PER_MODULE).map(Number);
const TWELVE = /^[0-9]{12}$/;
/** What the fit paragraph says for each of the rule's answers (`label_dpi` cannot be chosen here). */
const UNFIT = Object.freeze({
  label_size: "protokol.invalid.size", label_too_narrow: "protokol.invalid.tooNarrow", label_dpi: "protokol.err.dpi",
});

/** The start number's rule, the server's `protocol_format`: twelve ASCII digits, at least 000000000001. */
const nextNoOk = (text) => TWELVE.test(text) && text !== TEST_PROTOCOL;

const formOf = (s) => ({
  nextNo: s?.next_no ?? "", width: String(s?.label_width_mm ?? 50), height: String(s?.label_height_mm ?? 30),
  dpi: s?.printer_dpi ?? 203,
});

/** `win`: the window to open the test print from (a test's stand-in); the page's own by default. */
export function ProtocolTab({ win }) {
  const { t, lang } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(() => formOf(null));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    try {
      const got = await store.track(() => store.api.protocolSettings());
      setSettings(got);
      setForm(formOf(got));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [store]);
  useEffect(() => { read(); }, [read]);

  const width = Number(form.width);
  const height = Number(form.height);
  const dpi = Number(form.dpi);
  const fit = labelRefusal(width, height, dpi);
  const badNumber = !nextNoOk(form.nextNo);
  const narrowest = DPIS.includes(dpi) ? Math.ceil(minWidthMm(dpi)) : null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

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
    if (badNumber || fit) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      const got = await store.track(() => store.api.saveProtocolSettings({
        next_no: form.nextNo, label_width_mm: width, label_height_mm: height, printer_dpi: dpi,
      }));
      setSettings(got);
      setForm(formOf(got));
      setTried(false);
      toast(t("protokol.saved"));
    } catch (err) {
      toast(refusedFor(t, t("protokol.tab"), err), "error");
      await read();
    } finally {
      setBusy(false);
    }
  }

  function testPrint() {
    const popup = openLabelWindow(win ?? window);
    if (!popup) {
      toast(t("protokol.popupBlocked"), "error");
      return;
    }
    const size = fit
      ? { width_mm: settings?.label_width_mm ?? 50, height_mm: settings?.label_height_mm ?? 30,
        printer_dpi: settings?.printer_dpi ?? 203 }
      : { width_mm: width, height_mm: height, printer_dpi: dpi };
    printLabel(popup, testLabel(t, size), { t, lang });
  }

  if (settings === null && error === null) {
    return <Box><p className="m-0 text-13 text-mute">{t("protokol.loading")}</p></Box>;
  }
  if (settings === null) {
    return (
      <div className="grid max-w-[720px] gap-3">
        <Alert tone="crit">
          <p className="m-0">{t("protokol.readFailed", { reason: readErrorText(t, error) })}</p>
          <Button size="sm" busy={busy} onClick={retry}>{t("admin.retry")}</Button>
        </Alert>
      </div>
    );
  }
  return (
    <div className="grid max-w-[720px] gap-3">
      {error ? <Alert tone="crit">{t("protokol.readFailed", { reason: readErrorText(t, error) })}</Alert> : null}
      <Box title={t("protokol.title")} icon="qr" level={2}>
        <p className="m-0 mb-3 text-13 text-mute">{t("protokol.sub")}</p>
        {settings && !settings.configured ? (
          <Note tone="warn" icon="alert" className="mb-3">{t("protokol.notConfigured")}</Note>
        ) : null}
        <p className="m-0 mb-3 text-13">
          {settings?.last_issued ? t("protokol.lastIssued", { number: settings.last_issued }) : t("protokol.noneIssued")}
        </p>
        <form noValidate autoComplete="off" onSubmit={save}>
          <Field label={t("protokol.nextNo")} hint={t("protokol.nextNoHint")} required
            error={tried && badNumber
              ? t(form.nextNo === TEST_PROTOCOL ? "protokol.invalid.nextNoZero" : "protokol.invalid.nextNo")
              : undefined}>
            <Input value={form.nextNo} inputMode="numeric" maxLength={12} className="font-data"
              onChange={(e) => set({ nextNo: e.target.value })} />
          </Field>
          <Field label={t("protokol.width")}>
            <Input type="number" min={30} max={110} step={1} value={form.width}
              onChange={(e) => set({ width: e.target.value })} />
          </Field>
          <Field label={t("protokol.height")}>
            <Input type="number" min={20} max={80} step={1} value={form.height}
              onChange={(e) => set({ height: e.target.value })} />
          </Field>
          <Field label={t("protokol.dpi")}>
            <Select value={String(form.dpi)} onChange={(e) => set({ dpi: Number(e.target.value) })}>
              {DPIS.map((d) => <option key={d} value={String(d)}>{`${d} dpi`}</option>)}
            </Select>
          </Field>
          <p aria-live="polite" className={`m-0 mb-2 text-13 font-semibold ${fit ? "text-crit-ink" : "text-mute"}`}>
            {fit ? t(UNFIT[fit], { min: narrowest ?? "" }) : t("protokol.fits", { min: narrowest })}
          </p>
          <Note tone="info" icon="print" className="mb-3">{t("protokol.setupNote")}</Note>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={busy}>{t("protokol.save")}</Button>
            <Button icon="print" onClick={testPrint}>{t("protokol.testPrint")}</Button>
          </div>
        </form>
      </Box>
    </div>
  );
}

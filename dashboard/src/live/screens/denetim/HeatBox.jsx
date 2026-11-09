// src/live/screens/denetim/HeatBox.jsx — «Alarm yoğunluğu — son 7 gün» (G2-B6, spec
// docs/superpowers/specs/2026-11-09-g2b-b6-alarm-isi-haritasi-design.md), on the audit page (owner D1). Patients
// (masked, B4 D2) by the local hour of the day; each cell the alarm episodes that began in that hour over the
// window — a count, shaded relative to this table's largest cell, never a clinical threshold. Loaded on its button
// only (D4): `/alarm-quality` rebuilds every episode of the window on the API.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { hhmm, pad2 } from "../../i18n/dates.js";
import { Alert, Box, Button, Note, Table } from "../../ui/index.js";
import { HEAT_DAYS, HOURS, heatRows, heatStep } from "./heat.js";

/** The four steps' backgrounds — the primary colour at rising strength; the number is always the cell's text. */
const SHADE = [
  "",
  "color-mix(in srgb, var(--pri) 14%, transparent)",
  "color-mix(in srgb, var(--pri) 30%, transparent)",
  "color-mix(in srgb, var(--pri) 50%, transparent)",
];

function HeatTable({ heat }) {
  const { t } = useI18n();
  return (
    <Table caption={t("denetim.heat.caption", { days: HEAT_DAYS })}>
      <thead>
        <tr>
          <th scope="col">{t("denetim.heat.colPatient")}</th>
          {HOURS.map((h) => <th key={h} scope="col" className="font-data">{pad2(h)}</th>)}
          <th scope="col">{t("denetim.heat.colTotal")}</th>
        </tr>
      </thead>
      <tbody>
        {heat.rows.map((row) => (
          <tr key={row.patient}>
            <th scope="row" className="font-data">{row.label}</th>
            {row.counts.map((n, h) => {
              const step = heatStep(n, heat.max);
              return (
                <td key={h} data-step={step} className="text-center font-data"
                  style={step ? { backgroundColor: SHADE[step] } : undefined}>
                  {n > 0 ? n : ""}
                </td>
              );
            })}
            <td className="font-data font-bold">{row.total}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function HeatBox() {
  const { t } = useI18n();
  const { store } = useSession();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);       // { report, heat, at } | { error }
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = async () => {
    setBusy(true);
    try {
      const report = await store.track(() => store.api.alarmQuality(HEAT_DAYS));
      if (alive.current) setResult({ report, heat: heatRows(report), at: Date.now() });
    } catch (error) {
      if (alive.current) setResult({ error });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  let body = null;
  if (result?.error) {
    body = (
      <Alert tone="crit">
        <p className="m-0">{t("denetim.heat.failed", { reason: readErrorText(t, result.error) })}</p>
      </Alert>
    );
  } else if (result && result.heat === null) {
    body = <Note tone="warn">{t("denetim.heat.unreadable")}</Note>;
  } else if (result) {
    const { heat, report } = result;
    body = (
      <>
        {report?.truncated === true ? <Note tone="warn">{t("denetim.heat.truncated")}</Note> : null}
        {heat.rows.length === 0 ? (
          <Note tone="info">{t("denetim.heat.none", { days: HEAT_DAYS })}</Note>
        ) : (
          <>
            {heat.total > heat.rows.length ? (
              <Note tone="info">{t("denetim.heat.capped", { shown: heat.rows.length, total: heat.total })}</Note>
            ) : null}
            <HeatTable heat={heat} />
            <p className="m-0 text-12 text-mute">{t("denetim.heat.legend")}</p>
          </>
        )}
        <p className="m-0 text-12 text-mute">{t("denetim.heat.asOf", { time: hhmm(result.at) })}</p>
      </>
    );
  }

  return (
    <Box title={t("denetim.heat.title", { days: HEAT_DAYS })} icon="chart" level={2}
      right={<Button size="sm" busy={busy} onClick={run}>{t("denetim.heat.show")}</Button>}>
      <div className="flex flex-col gap-2">
        <p className="m-0 text-13 text-mute">{t("denetim.heat.intro", { days: HEAT_DAYS })}</p>
        {body}
      </div>
    </Box>
  );
}

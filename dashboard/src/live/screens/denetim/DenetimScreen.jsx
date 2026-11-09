// src/live/screens/denetim/DenetimScreen.jsx — «Denetim bütünlüğü» (G2-B4, spec
// docs/superpowers/specs/2026-11-09-g2b-b4-denetim-design.md), for `audit.view`. Three boxes:
//   - the chain's verification, ON ITS BUTTON ONLY (owner D1): it re-hashes up to 50 000 records on the API's
//     event loop, and that load is asked for, never paid on every visit. The verdict stays with the local time it
//     was taken, in this component only — a verdict from an earlier visit shown as current is the one thing this
//     page must never do; a failed run replaces it rather than sitting beside it;
//   - the alarm heatmap (G2-B6, HeatBox.jsx), also on its button: masked patients by hour of day, last 7 days;
//   - the newest events, newest first, the patient id MASKED (owner D2), a type filter that asks the server (D7).
//     No payload, no hashes (D5). Nothing here writes.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { ddmmhhmm, hhmm } from "../../i18n/dates.js";
import { Alert, Box, Button, Field, Note, Select, Table } from "../../ui/index.js";
import {
  EVENTS_LIMIT, EVENT_TYPES, VERIFY_LIMIT, actorOf, maskPatient, newestFirst, typeKey, verdictOf,
} from "./denetim.js";
import { HeatBox } from "./HeatBox.jsx";

const timeText = (ts) => {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ddmmhhmm(ms) : "—";
};

/** One verdict (D4). A broken chain is the page's only alarm (role="alert"); a partial or unreadable answer
 *  is a warning; records written before the seal are noted with any verdict. */
function Verdict({ verdict }) {
  const { t } = useI18n();
  let main;
  if (verdict.kind === "broken") {
    main = (
      <Alert tone="crit">
        <p className="m-0">{t("denetim.verdictBroken", { id: verdict.brokenAt ?? "—" })}</p>
        <p className="m-0 font-normal">{t(verdict.reasonKey)}</p>
      </Alert>
    );
  } else if (verdict.kind === "partial") {
    main = <Note tone="warn">{t("denetim.verdictPartial", { records: verdict.records })}</Note>;
  } else if (verdict.kind === "ok") {
    main = <Note tone="info" icon="ok">{t("denetim.verdictOk", { checked: verdict.checked })}</Note>;
  } else if (verdict.kind === "empty") {
    main = <Note tone="info">{t("denetim.verdictEmpty")}</Note>;
  } else {
    main = <Note tone="warn">{t("denetim.verdictUnreadable")}</Note>;
  }
  return (
    <>
      {main}
      {verdict.unsealed > 0 ? <Note tone="info">{t("denetim.unsealed", { unsealed: verdict.unsealed })}</Note> : null}
    </>
  );
}

function VerifyBox() {
  const { t } = useI18n();
  const { store } = useSession();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);       // { verdict, at } | { error }
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = async () => {
    setBusy(true);
    try {
      const answer = await store.track(() => store.api.verifyAudit(VERIFY_LIMIT));
      if (alive.current) setResult({ verdict: verdictOf(answer), at: Date.now() });
    } catch (error) {
      if (alive.current) setResult({ error });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <Box title={t("denetim.verifyTitle")} icon="lock" level={2}
      right={<Button size="sm" variant="primary" busy={busy} onClick={run}>{t("denetim.verifyButton")}</Button>}>
      <div className="flex flex-col gap-2">
        <p className="m-0 text-13 text-mute">{t("denetim.verifyIntro")}</p>
        {result?.error ? (
          <Alert tone="crit">
            <p className="m-0">{t("denetim.verifyFailed", { reason: readErrorText(t, result.error) })}</p>
          </Alert>
        ) : null}
        {result?.verdict ? (
          <>
            <Verdict verdict={result.verdict} />
            <p className="m-0 text-12 text-mute">{t("denetim.lastVerified", { time: hhmm(result.at) })}</p>
          </>
        ) : null}
      </div>
    </Box>
  );
}

function EventsBox() {
  const { t } = useI18n();
  const { store } = useSession();
  const [type, setType] = useState("");
  const [state, setState] = useState({ phase: "loading", rows: [], error: null });
  const seq = useRef(0);

  // The newest read wins: a filter changed twice quickly must not show the first type's rows under the second.
  const read = useCallback(async (eventType) => {
    seq.current += 1;
    const mine = seq.current;
    setState({ phase: "loading", rows: [], error: null });
    try {
      const answer = await store.track(() => store.api.audit({ limit: EVENTS_LIMIT, eventType: eventType || null }));
      if (mine === seq.current) setState({ phase: "ready", rows: newestFirst(answer), error: null });
    } catch (error) {
      if (mine === seq.current) setState({ phase: "failed", rows: [], error });
    }
  }, [store]);

  useEffect(() => { read(type); }, [read, type]);
  const loading = state.phase === "loading";

  let body;
  if (state.phase === "failed") {
    body = (
      <Alert tone="crit">
        <p className="m-0">{t("denetim.readFailed", { reason: readErrorText(t, state.error) })}</p>
        <Button size="sm" className="mt-2" onClick={() => read(type)}>{t("denetim.retry")}</Button>
      </Alert>
    );
  } else if (state.rows.length === 0) {
    body = <p className="m-0 text-13 text-mute">{t(loading ? "denetim.loading" : "denetim.empty")}</p>;
  } else {
    body = (
      <Table caption={t("denetim.caption")}>
        <thead>
          <tr>
            <th scope="col">{t("denetim.colNo")}</th>
            <th scope="col">{t("denetim.colTime")}</th>
            <th scope="col">{t("denetim.colType")}</th>
            <th scope="col">{t("denetim.colActor")}</th>
            <th scope="col">{t("denetim.colPatient")}</th>
            <th scope="col">{t("denetim.colSubject")}</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((rec, i) => {
            const label = typeKey(rec?.event_type);
            return (
              <tr key={rec?.id ?? `row-${i}`}>
                <td className="font-data">{rec?.id != null ? `#${rec.id}` : "—"}</td>
                <td className="font-data">{timeText(rec?.ts)}</td>
                <td>{label ? t(label) : <code>{rec?.event_type || "—"}</code>}</td>
                <td>{actorOf(rec?.payload)}</td>
                <td className="font-data">{maskPatient(rec?.patient_id)}</td>
                <td>{rec?.subject || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    );
  }

  return (
    <Box title={t("denetim.eventsTitle")} icon="list" level={2}
      right={<Button size="sm" busy={loading} onClick={() => read(type)}>{t("denetim.refresh")}</Button>}>
      <div className="flex flex-col gap-2">
        <p className="m-0 text-13 text-mute">{t("denetim.eventsIntro", { limit: EVENTS_LIMIT })}</p>
        <Field label={t("denetim.filter")} layout="col" className="max-w-[320px]">
          <Select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">{t("denetim.filterAll")}</option>
            {EVENT_TYPES.map((e) => <option key={e.code} value={e.code}>{t(e.key)}</option>)}
          </Select>
        </Field>
        {body}
      </div>
    </Box>
  );
}

export function DenetimScreen() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div>
        <h1 className="m-0 font-display text-23 font-bold">{t("denetim.title")}</h1>
        <p className="m-0 text-13 text-mute">{t("denetim.intro")}</p>
      </div>
      <VerifyBox />
      <HeatBox />
      <EventsBox />
    </div>
  );
}

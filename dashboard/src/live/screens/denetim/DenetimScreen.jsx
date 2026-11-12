// src/live/screens/denetim/DenetimScreen.jsx — «Denetim bütünlüğü» (G2-B4, spec
// docs/superpowers/specs/2026-11-09-g2b-b4-denetim-design.md), for `audit.view`. Three boxes:
//   - the chain's verification, ON ITS BUTTON ONLY (owner D1): it re-hashes the WHOLE chain, page by page off the
//     API's event loop (G2 borç 3), and that load is asked for, never paid on every visit. The verdict stays with the local time it
//     was taken, in this component only — a verdict from an earlier visit shown as current is the one thing this
//     page must never do; a failed run replaces it rather than sitting beside it;
//   - the alarm heatmap (G2-B6, HeatBox.jsx), also on its button: masked patients by hour of day, last 7 days;
//   - the newest events, newest first, the patient id MASKED (owner D2) and a user id too (follow-up 2026-11-11 D2),
//     a type filter that asks the server (D7).
//     No payload, no hashes (D5). Nothing here writes.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { ddmmhhmm } from "../../i18n/dates.js";
import { useStructure } from "../../data/StructureProvider.jsx";
import { normId } from "../../data/structure.js";
import { Alert, Announce, Box, Button, Field, Note, Select, Table } from "../../ui/index.js";
import {
  EVENTS_LIMIT, EVENT_TYPES, actorOf, maskPatient, newestFirst, subjectOf, typeKey, verdictOf,
} from "./denetim.js";
import { HeatBox } from "./HeatBox.jsx";

const timeText = (ts) => {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ddmmhhmm(ms) : "—";
};

/** The sentence of a verdict that is a Note, with the Note's look — null for a broken chain, which is an Alert
 *  of its own. One place for the words: the Notes show them and the status region speaks them (`saidOf`), so the
 *  two cannot drift apart. */
function noteOf(t, verdict) {
  if (verdict.kind === "partial") return { tone: "warn", text: t("denetim.verdictPartial", { records: verdict.records }) };
  if (verdict.kind === "ok") return { tone: "info", icon: "ok", text: t("denetim.verdictOk", { checked: verdict.checked }) };
  if (verdict.kind === "empty") return { tone: "info", text: t("denetim.verdictEmpty") };
  if (verdict.kind === "unreadable") return { tone: "warn", text: t("denetim.verdictUnreadable") };
  return null;
}

const unsealedOf = (t, verdict) => (verdict.unsealed > 0 ? t("denetim.unsealed", { unsealed: verdict.unsealed }) : "");

/** What a screen reader is told about a verdict. A Note is static and never announced, so the verdict's
 *  sentence (with the unsealed one) goes to a polite status region. A broken chain says nothing here: it is
 *  already a role="alert" box, and a failed run is an Alert too. */
function saidOf(t, verdict) {
  const note = noteOf(t, verdict);
  return note ? [note.text, unsealedOf(t, verdict)].filter(Boolean).join(" ") : "";
}

/** One verdict (D4). A broken chain is the page's only alarm (role="alert"); a partial or unreadable answer
 *  is a warning; records written before the seal are noted with any verdict. */
function Verdict({ verdict }) {
  const { t } = useI18n();
  const note = noteOf(t, verdict);
  const unsealed = unsealedOf(t, verdict);
  return (
    <>
      {note ? (
        <Note tone={note.tone} icon={note.icon}>{note.text}</Note>
      ) : (
        <Alert tone="crit">
          <p className="m-0">{t("denetim.verdictBroken", { id: verdict.brokenAt ?? "—" })}</p>
          <p className="m-0 font-normal">{t(verdict.reasonKey)}</p>
        </Alert>
      )}
      {unsealed ? <Note tone="info">{unsealed}</Note> : null}
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
    // review: a stale verdict never sits beside a busy button; and the live region hears a change, so a repeated
    // verdict is announced again
    setResult(null);
    try {
      const answer = await store.track(() => store.api.verifyAudit());
      if (alive.current) setResult({ verdict: verdictOf(answer), at: Date.now() });
    } catch (error) {
      if (alive.current) setResult({ error });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const said = result?.verdict ? saidOf(t, result.verdict) : "";

  return (
    <Box title={t("denetim.verifyTitle")} icon="lock" level={2}
      right={<Button size="sm" variant="primary" busy={busy} onClick={run}>{t("denetim.verifyButton")}</Button>}>
      <div className="flex flex-col gap-2">
        <Announce text={said} />
        <p className="m-0 text-13 text-mute">{t("denetim.verifyIntro")}</p>
        {result?.error ? (
          <Alert tone="crit">
            <p className="m-0">{t("denetim.verifyFailed", { reason: readErrorText(t, result.error) })}</p>
          </Alert>
        ) : null}
        {result?.verdict ? (
          <>
            <Verdict verdict={result.verdict} />
            {/* day and month with the time: a screen left open overnight; none for an answer nobody could read —
                no verification completed */}
            {result.verdict.kind === "unreadable" ? null : (
              <p className="m-0 text-12 text-mute">{t("denetim.lastVerified", { time: ddmmhhmm(result.at) })}</p>
            )}
          </>
        ) : null}
      </div>
    </Box>
  );
}

function EventsBox() {
  const { t } = useI18n();
  const { store } = useSession();
  // G4-04: a nurse–bed assignment names its unit from the structure the shell already reads for every screen — no read
  // of this page's own; without it (a session with no structure right) the id stays masked.
  const { index } = useStructure();
  const unitName = useCallback((id) => index.units.get(normId(id))?.name ?? null, [index]);
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
                <td>{actorOf(rec?.payload, t)}</td>
                <td className="font-data">{maskPatient(rec?.patient_id)}</td>
                <td>{subjectOf(rec, t, unitName)}</td>
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

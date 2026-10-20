// src/live/screens/patient/trends/TrendsBox.jsx — the patient's vital trends (Group 2 · slice 1),
// where the dashed "Vital eğrileri" placeholder stood.
//
// THE BROWSER DRAWS; IT NEVER SCORES. Every fact this box shows about a value — its NEWS2 points,
// the band it sits in, whether it is inside the patient's charted normal, how it moved — is the
// engine's (GET /patients/{id}/trends, homunculus-engine api/trends.py), printed or drawn as it
// came. Nothing here or below it computes a band, a threshold, a delta or a point.
//
// It never says less than it knows: an unreadable read keeps the last answer on screen and says so
// in a warn `Note` — the first line of the box's body, as the monitor strip says the same state —
// with the time that answer came. A `Note` is `role="note"`, not a live region, and not an alert:
// nothing the clinician did was refused, and a poll that fails once a minute must not interrupt.
//
// `nowMs` is REQUIRED: the patient screen's `useBoardNow` instant (the server's clock), which the
// cards age their values against. Without a finite one a card prints no age — never the browser's.
import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { useSession } from "../../../session/SessionProvider.jsx";
import { Box, Button, Note } from "../../../ui/index.js";
import { BASELINE_KEYS, BaselineForm } from "./BaselineForm.jsx";
import { CARDS, channelsOf } from "./cards.js";
import { TrendCard } from "./TrendCard.jsx";
import { TrendModal } from "./TrendModal.jsx";
import { measuredKeyOf, useTrends } from "./useTrends.js";

export function TrendsBox({ patient, bed, nowMs }) {
  const { t } = useI18n();
  const { user } = useSession();
  const trends = useTrends(patient.patient_id, 24, measuredKeyOf(patient.measuredAt));
  // The id of the card whose big chart is open. Like `editing` it survives a move to another patient (the
  // shell mounts this screen with no `key`), but the chart is read-only and reads for the patient it is given.
  const [open, setOpen] = useState(null);
  // The patient_id the form was opened FOR, or null. The shell renders the screen with no `key`, so a move to
  // another patient (browser Back under the inert page) keeps this box and its state: the form is shown only
  // to the patient it was opened for — rows read from one patient are never written under another — and the
  // move forgets it, so that coming back does not reopen it.
  const [editing, setEditing] = useState(null);
  useEffect(() => { setEditing(null); }, [patient.patient_id]);
  const shownFor = useRef(patient.patient_id);
  shownFor.current = patient.patient_id;
  const reasonId = useId();
  const channels = channelsOf(trends.data);
  const sinceMs = Date.parse(trends.data?.since);
  const untilMs = Date.parse(trends.data?.until);
  const card = CARDS.find((c) => c.id === open) ?? null;
  const unreadableText = t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" });
  // The form replaces the whole baseline set, so it opens only on a set this box has READ: offered to a
  // `clinical.chart` holder once the trends answered. While they cannot be read the button stays — a button
  // that unmounts under an open form leaves focus on <body> when it closes — but dimmed, with the reason.
  const offered = (user?.perms?.includes("clinical.chart") ?? false) && Boolean(trends.data);
  const own = Object.fromEntries(BASELINE_KEYS.map((key) => [key, channels[key]?.bands?.own_normal ?? null]));
  function openForm() {
    if (trends.unreadable) return;
    trends.reload();      // the set it replaces must not be a minute old (the form says if it changed since)
    setEditing(patient.patient_id);
  }
  const right = (
    <>
      <span>{t("patient.trendsNote")}</span>
      {offered ? (
        <Button
          size="sm" icon="edit" className="ml-2" onClick={openForm}
          aria-disabled={trends.unreadable ? "true" : undefined} aria-describedby={trends.unreadable ? reasonId : undefined}
        >
          {t("patient.baselineOpen")}
        </Button>
      ) : null}
      {offered && trends.unreadable ? <span id={reasonId} className="sr-only">{unreadableText}</span> : null}
    </>
  );
  return (
    <Box title={t("patient.trends")} icon="chart" level={2} right={right}>
      <div data-trends-box="">
        {trends.unreadable ? (
          <Note tone="warn" icon="alert" className="mb-2">
            {unreadableText}
          </Note>
        ) : null}
        {trends.loading ? <p className="m-0 text-12.5 text-mute">{t("patient.trendsLoading")}</p> : null}
        {trends.data ? (
          // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
          <ul role="list" className="m-0 grid list-none grid-cols-1 gap-2 p-0 min-[861px]:grid-cols-2 min-[1200px]:grid-cols-3">
            {CARDS.map((c) => (
              <TrendCard key={c.id} card={c} channels={channels} nowMs={nowMs} sinceMs={sinceMs} untilMs={untilMs}
                onOpen={() => setOpen(c.id)} />
            ))}
          </ul>
        ) : null}
      </div>
      {card ? <TrendModal card={card} patient={patient} bed={bed} onClose={() => setOpen(null)} /> : null}
      {editing === patient.patient_id ? (
        <BaselineForm
          key={editing} patient={patient} bed={bed} own={own}
          // A save that lands after a move closes nothing of the next patient's and reads nothing for her.
          onClose={() => setEditing((current) => (current === patient.patient_id ? null : current))}
          onSaved={() => { if (shownFor.current === patient.patient_id) trends.reload(); }}
        />
      ) : null}
    </Box>
  );
}

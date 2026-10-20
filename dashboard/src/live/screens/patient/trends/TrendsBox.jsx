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
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Box, Note } from "../../../ui/index.js";
import { CARDS, channelsOf } from "./cards.js";
import { TrendCard } from "./TrendCard.jsx";
import { measuredKeyOf, useTrends } from "./useTrends.js";

export function TrendsBox({ patient, nowMs }) {
  const { t } = useI18n();
  const trends = useTrends(patient.patient_id, 24, measuredKeyOf(patient.measuredAt));
  const channels = channelsOf(trends.data);
  return (
    <Box title={t("patient.trends")} icon="chart" level={2} right={t("patient.trendsNote")}>
      <div data-trends-box="">
        {trends.unreadable ? (
          <Note tone="warn" icon="alert" className="mb-2">
            {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
          </Note>
        ) : null}
        {trends.loading ? <p className="m-0 text-12.5 text-mute">{t("patient.trendsLoading")}</p> : null}
        {trends.data ? (
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 min-[861px]:grid-cols-2 min-[1200px]:grid-cols-3">
            {CARDS.map((card) => (
              <TrendCard key={card.id} card={card} channels={channels} nowMs={nowMs} />
            ))}
          </ul>
        ) : null}
      </div>
    </Box>
  );
}

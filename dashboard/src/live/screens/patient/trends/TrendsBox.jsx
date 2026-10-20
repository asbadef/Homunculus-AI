// src/live/screens/patient/trends/TrendsBox.jsx — the patient's vital trends (Group 2 · slice 1),
// where the dashed "Vital eğrileri" placeholder stood.
//
// THE BROWSER DRAWS; IT NEVER SCORES. Every fact this box shows about a value — its NEWS2 points,
// the band it sits in, whether it is inside the patient's charted normal, how it moved — is the
// engine's (GET /patients/{id}/trends, homunculus-engine api/trends.py), printed or drawn as it
// came. Nothing here or below it computes a band, a threshold, a delta or a point.
//
// It never says less than it knows: an unreadable read keeps the last answer on screen and says so
// in the header, with the time that answer came (the monitor strip's rule), and it is a plain line,
// not an alert — nothing the clinician did was refused.
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Box } from "../../../ui/index.js";
import { measuredKeyOf, useTrends } from "./useTrends.js";

export function TrendsBox({ patient }) {
  const { t } = useI18n();
  const trends = useTrends(patient.patient_id, 24, measuredKeyOf(patient.measuredAt));
  return (
    <Box title={t("patient.trends")} icon="chart" level={2} right={t("patient.trendsNote")}>
      <div data-trends-box="">
        {trends.unreadable ? (
          <p className="m-0 mb-2 text-12 font-semibold text-att-ink">
            {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
          </p>
        ) : null}
        {trends.loading ? <p className="m-0 text-12.5 text-mute">{t("patient.trendsLoading")}</p> : null}
      </div>
    </Box>
  );
}

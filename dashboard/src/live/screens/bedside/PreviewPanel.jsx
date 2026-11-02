// src/live/screens/bedside/PreviewPanel.jsx — what the engine would score for the values in the form (G3-01, D4,
// D8, X10). The preview route answers the card's own NEWS2 shape, and the panel draws it with the card's own
// component (`News2`: the total, «partial», the red parameter, what is past its window, what was assumed). Under
// it, in words, two things that component says only to a screen reader or not at all: what is missing or not
// current (D4: «NEWS2 kısmi: … girilmedi»), and the points each parameter brought. Every number is the engine's
// (Decision 1); the panel adds no threshold, no band and no response — the decision is the physician's.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { Box, Note } from "../../ui/index.js";
import { News2 } from "../common/BoardState.jsx";
import { NEWS2_PARAMETERS } from "./vitalsFields.js";

/** `answer` is the preview route's (`{preview, news2}`), or `{dropped}` for a discharged number; `nowMs` the
 *  screen's clock (the server's), which ages what is past its window. */
export function PreviewPanel({ answer, nowMs }) {
  const { t } = useI18n();
  if (answer?.dropped) return <Note tone="warn" icon="alert" className="mt-3">{t("olcum.previewDropped")}</Note>;
  const news2 = answer.news2;
  // Missing, or past its window: both leave the total, and the sentence names both.
  const absent = new Set([...(Array.isArray(news2.missing) ? news2.missing : []), ...(Array.isArray(news2.stale) ? news2.stale : [])]);
  const names = NEWS2_PARAMETERS.filter((p) => p.missingKey && absent.has(p.name)).map((p) => t(p.missingKey));
  const breakdown = news2.breakdown && typeof news2.breakdown === "object" ? news2.breakdown : {};
  const scored = NEWS2_PARAMETERS.filter((p) => Number.isInteger(breakdown[p.name]) && breakdown[p.name] > 0);
  return (
    <Box title={t("olcum.previewTitle")} icon="activity" className="mt-3">
      <div data-preview="">
        <News2 news2={news2} nowMs={nowMs} label={t("olcum.previewLabel")} />
        {names.length ? (
          <p className="m-0 mt-2 text-13 font-semibold text-att-ink">{t("olcum.previewPartial", { missing: names.join(", ") })}</p>
        ) : !news2.partial ? (
          <p className="m-0 mt-2 text-13 text-mute">{t("olcum.previewComplete")}</p>
        ) : null}
        {scored.length ? (
          // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
          <ul role="list" className="m-0 mt-1.5 list-none p-0 text-13">
            {scored.map((p) => <li key={p.name}>{t("olcum.previewPoints", { name: t(p.labelKey), points: breakdown[p.name] })}</li>)}
          </ul>
        ) : (
          <p className="m-0 mt-1.5 text-13 text-mute">{t("olcum.previewNoPoints")}</p>
        )}
        <p className="m-0 mt-2 text-11.5 text-mute">{t("olcum.previewNote")}</p>
      </div>
    </Box>
  );
}

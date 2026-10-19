// src/live/screens/devices/DevicesScreen.jsx — biomedical's monitor screen (Aşama A, Decision 12).
//
// Every device the hub forwards: where the APPROVED device→bed table puts it (or why it puts it
// nowhere), its address, its status, its values with their ages and their evidence, the table's
// version and sha256, and the feed's counters. It is for the people who own the table and sign the
// validation — biomedical, the vendor's support group, a hospital administrator — so it says what
// the hub says and nothing about any person: NO patient id or name, and no word about whether a
// patient is linked, even to a session that also holds board.view (the API sends no patient to a
// devices.manage-only caller; this screen drops the link for everyone).
//
// The values are UNVALIDATED research decoding, labelled so on every strip (MonitorStrip.jsx), and
// feed nothing. A count is printed only from a read the screen can vouch for (the last poll
// answered); an unreadable or not-yet-read strip says so in its own words.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useShadow } from "../../data/ShadowProvider.jsx";
import { SHADOW_PHASE } from "../../data/shadowStore.js";
import { Note } from "../../ui/index.js";
import { MonitorFeedChip, MonitorStrip, readUnknown, stripOn } from "../common/MonitorStrip.jsx";
import { maxAgeOf, reasonKey } from "../common/monitor.js";

/** A device with no patient in it: whatever the answer carried about a link is not drawn here. */
const withoutPatient = (card) => ({ ...card, patient_id: null, link: "hidden", link_reason: null });

function Device({ card, assigned, view }) {
  const { t } = useI18n();
  const title = assigned ? card.bed_label : t("monitor.unassignedTitle", { source: card.source });
  return (
    <li className="rounded-box bg-card">
      <MonitorStrip entry={withoutPatient(card)} variant="full" title={title} {...view}>
        <p className="m-0 mt-1 font-data text-11.5 text-mute">{t("monitor.deviceAddress", { source: card.source, group: card.group })}</p>
        {assigned ? (
          <p className="m-0 text-11.5 text-mute">
            {t("monitor.deviceRow", { method: t(`monitor.method.${card.method}`), verified: card.verified_at ?? "—" })}
          </p>
        ) : (
          <p className="m-0 text-11.5 font-semibold text-att-ink">{t(reasonKey(card.reason))}</p>
        )}
      </MonitorStrip>
    </li>
  );
}

function Strip({ shadow }) {
  const { t } = useI18n();
  const { data, phase } = shadow;
  // The server's display limit, never longer than this build's own; a read older than it, or one
  // this browser's clock puts in the future, is not today's — no counter is printed from it.
  const maxAgeS = maxAgeOf(data);
  const unreadable = readUnknown(shadow, shadow.nowMs, maxAgeS);
  const known = phase === SHADOW_PHASE.OK && !unreadable;
  const view = {
    nowMs: shadow.nowMs, fetchedAtMs: shadow.fetchedAtMs, maxAgeS,
    feedOk: data.feed?.state === "ok", unreadable, level: 2,
  };
  const table = data.table ?? {};
  const rejected = data.feed?.rejected;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <MonitorFeedChip data={data} phase={phase} nowMs={shadow.nowMs} fetchedAtMs={shadow.fetchedAtMs} maxAgeS={maxAgeS} />
      </div>
      {table.status === "ok" ? (
        <p className="m-0 font-data text-12.5 text-mute">
          {t("monitor.tableVersion", { version: table.version, sha: String(table.sha256 ?? "").slice(0, 12) })}
        </p>
      ) : (
        // The table's own reason is the API's sentence (Turkish, api/infinity_device_beds.py): shown
        // as it was written, marked as Turkish for a screen reader.
        <p className="m-0 font-data text-12.5 text-att-ink" lang="tr">{table.reason ?? "—"}</p>
      )}
      {known && data.feed?.forwarder ? (
        <p className="m-0 text-12.5 text-mute">
          {t("monitor.feedPosts", { posts: data.feed.posts, sent: data.feed.forwarder.sent, failed: data.feed.forwarder.failed })}
        </p>
      ) : null}
      {known && rejected ? <p className="m-0 text-12.5 text-mute">{t("monitor.feedRejected", rejected)}</p> : null}
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-2.5 p-0 max-[640px]:grid-cols-1">
        {(data.beds ?? []).map((card) => <Device key={card.source} card={card} assigned view={view} />)}
        {(data.unassigned ?? []).map((card) => <Device key={card.source} card={card} assigned={false} view={view} />)}
      </ul>
    </>
  );
}

export function DevicesScreen() {
  const { t } = useI18n();
  const shadow = useShadow();
  const { data, phase } = shadow;
  let body = null;
  if (stripOn(data)) body = <Strip shadow={shadow} />;
  else if (data) {
    body = <Note tone="info">{data.problem ? t("monitor.offProblem", { problem: data.problem }) : t("monitor.off")}</Note>;
  } else if (phase === SHADOW_PHASE.UNREADABLE) body = <Note>{t("monitor.unreadable")}</Note>;
  else if (phase === SHADOW_PHASE.LOADING) body = <p className="m-0 text-13 text-mute">{t("monitor.loading")}</p>;
  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div>
        <h1 className="m-0 font-display text-23 font-bold">{t("nav.devices")}</h1>
        <p className="m-0 text-13 text-mute">{t("monitor.devicesSub")}</p>
      </div>
      {body}
    </div>
  );
}

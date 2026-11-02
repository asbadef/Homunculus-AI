// src/live/screens/kabul/BedsTab.jsx — "Yataklar" (Group 2 · B1a, spec §3.4, §5.4): the caller's
// beds by unit and room with their state, and "Temizlik bitti · boş" on a bed in cleaning for a
// holder of `beds.release` — the ward turns its beds over without an administrator (D8). A small
// precursor of B3's occupancy screen.
//
// One release is out at a time; while it is, every other bed's button is held, and the reason it
// points at names the bed being released (A-17). A release that lands takes its button away with
// the re-read (the bed is free now): the focus that button had goes to the bed's own entry, which
// says so — never left on <body> (spec §5.7, A-22).
import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Empty, Tag, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { BED_STATE_KEYS } from "../../data/structure.js";
import { doneFor, reasonOf, refusedFor } from "../admin/refusal.js";

// Red is for alarms: an occupied bed is the ward's ordinary state, so it stays neutral. Only a bed
// waiting for something (cleaning, a discharge) is warned.
const TONE = { HOUSEKEEPING: "warn", PENDING_DISCHARGE: "warn" };

export function BedsTab() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { structure, phase, error, reload } = useStructure();
  const toast = useToast();
  const uid = useId();
  const [releasing, setReleasing] = useState(null);  // {id, subject} of the release that is out
  const [refocus, setRefocus] = useState(null);      // the bed whose release just ended
  const entries = useRef(new Map());                 // bed id -> its <li>
  const canRelease = user?.perms?.includes("beds.release") ?? false;
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (refocus === null) return;
    setRefocus(null);
    const active = document.activeElement;
    if (!active || active === document.body) entries.current.get(refocus)?.focus();
  }, [refocus]);

  const heldId = `${uid}-held`;

  async function release(bed, subject) {
    if (releasing) return;
    setReleasing({ id: bed.id, subject });
    try {
      await store.track(() => store.api.releaseBed(bed.id));
      toast(doneFor(t, subject, t("kabul.released")));
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
    } finally {
      // Held until the beds are read again: until then the list still shows this bed in cleaning,
      // and a press in that gap would repeat a release the server has already done.
      await reload();
      setReleasing(null);
      setRefocus(bed.id);
    }
  }
  const saying = releasing ? t("kabul.releasing", { bed: releasing.subject }) : "";

  const units = (structure?.sites ?? []).flatMap((site) => site.units ?? []);
  return (
    <div className="grid gap-3">
      {error ? (
        <div className="grid justify-items-start gap-2">
          <Alert tone="crit">{t(phase === "stale" ? "kabul.listStale" : "kabul.listFailed", { reason: readErrorText(t, error) })}</Alert>
          <Button size="sm" onClick={() => reload()}>{t("admin.retry")}</Button>
        </div>
      ) : null}
      {structure === null && !error ? <p role="status" className="m-0 text-13 text-mute">{t("kabul.loading")}</p> : null}
      {structure !== null && units.length === 0 ? <Empty icon="bed">{t("kabul.pickerNone")}</Empty> : null}
      {units.map((unit, unitIndex) => (
        <Box key={unit.id} title={unit.is_active === false ? `${unit.name} · ${t("kabul.unitClosed")}` : unit.name} icon="building" level={2}>
          {(unit.rooms ?? []).length === 0 ? <p className="m-0 text-13 text-mute">{t("kabul.noRooms")}</p> : null}
          {(unit.rooms ?? []).map((room, roomIndex) => {
            // The landmark is named "unit · room": two units may each have an "Otaq 1".
            const headingId = `${uid}-room-${unitIndex}-${roomIndex}`;
            return (
              <section key={room.id} aria-labelledby={headingId} className="mb-2.5 last:mb-0">
                <h3 id={headingId} className="m-0 mb-1 text-12.5 font-semibold text-mute">
                  <span className="sr-only">{unit.name} · </span>
                  {room.name}{room.is_active === false ? ` · ${t("kabul.roomClosed")}` : ""}
                </h3>
                {(room.beds ?? []).length === 0 ? (
                  <p className="m-0 text-13 text-mute">{t("kabul.noBeds")}</p>
                ) : (
                  <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 p-0">
                    {(room.beds ?? []).map((bed) => {
                      const subject = `${bed.label} · ${room.name} · ${unit.name}`;
                      // A bed, its room and its unit must all be open for the ward to free the bed.
                      const open = bed.is_active !== false && room.is_active !== false && unit.is_active !== false;
                      const held = releasing !== null && releasing.id !== bed.id;
                      return (
                        <li key={bed.id} tabIndex={-1}
                          ref={(el) => { if (el) entries.current.set(bed.id, el); else entries.current.delete(bed.id); }}
                          className={`flex items-center justify-between gap-2 rounded-ctl border border-line bg-card px-2.5 py-2 ${FOCUS_RING}`}>
                          <span className="grid">
                            <b className="font-data text-15">{bed.label}</b>
                            <span>
                              <Tag tone={bed.is_active === false ? "neutral" : TONE[bed.state] ?? "neutral"}>
                                {bed.is_active === false ? t("kabul.bedClosed") : t(BED_STATE_KEYS[bed.state] ?? "kabul.bedOther")}
                              </Tag>
                            </span>
                          </span>
                          {canRelease && open && bed.state === "HOUSEKEEPING" ? (
                            <Button size="sm" icon="ok" busy={releasing?.id === bed.id} aria-label={`${t("kabul.release")}: ${subject}`}
                              aria-disabled={held ? "true" : undefined} aria-describedby={held ? heldId : undefined}
                              onClick={() => release(bed, subject)}>
                              {t("kabul.release")}
                            </Button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </Box>
      ))}
      {releasing !== null ? <span id={heldId} className="sr-only">{saying}</span> : null}
      <Announce text={saying} />
    </div>
  );
}

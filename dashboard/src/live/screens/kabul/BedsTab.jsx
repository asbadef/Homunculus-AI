// src/live/screens/kabul/BedsTab.jsx — "Yataklar" (Group 2 · B1a, spec §3.4, §5.4): the caller's
// beds by unit and room with their state, and "Temizlik bitti · boş" on a bed in cleaning for a
// holder of `beds.release` — the ward turns its beds over without an administrator (D8). A small
// precursor of B3's occupancy screen.
import React, { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, Empty, Tag, useToast } from "../../ui/index.js";
import { BED_STATE_KEYS } from "../../data/structure.js";
import { doneFor, refusedFor } from "../admin/refusal.js";

const TONE = { AVAILABLE: "neutral", HOUSEKEEPING: "warn", OCCUPIED: "crit", PENDING_DISCHARGE: "warn" };

/** What the toast says of a refused release. An uncoded 404 ("Bed not found.") has no code to map
 *  and English words, so it is said by its status, in the reader's language (amendments A-9).
 *  Everything else is `refusedFor`'s, by its code. */
const reasonOf = (t, err) => (err?.status === 404 && !err.apiCode ? t("errors.requestFailed", { status: 404 }) : err);

export function BedsTab() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { structure, phase, error, reload } = useStructure();
  const toast = useToast();
  const [releasing, setReleasing] = useState(null);
  const canRelease = user?.perms?.includes("beds.release") ?? false;
  useEffect(() => { reload(); }, [reload]);

  async function release(bed, unit, room) {
    if (releasing) return;
    const subject = `${bed.label} · ${room.name} · ${unit.name}`;
    setReleasing(bed.id);
    try {
      await store.track(() => store.api.releaseBed(bed.id));
      toast(doneFor(t, subject, t("kabul.released")));
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
    } finally {
      setReleasing(null);
      reload();
    }
  }

  const units = (structure?.sites ?? []).flatMap((site) => site.units ?? []);
  return (
    <div className="grid gap-3">
      {error ? <Alert tone="crit">{t(phase === "stale" ? "kabul.listStale" : "kabul.listFailed", { reason: readErrorText(t, error) })}</Alert> : null}
      {structure === null && !error ? <p className="m-0 text-13 text-mute">{t("kabul.loading")}</p> : null}
      {structure !== null && units.length === 0 ? <Empty icon="bed">{t("kabul.pickerNone")}</Empty> : null}
      {units.map((unit) => (
        <Box key={unit.id} title={unit.is_active === false ? `${unit.name} · ${t("kabul.unitClosed")}` : unit.name} icon="building" level={2}>
          {(unit.rooms ?? []).map((room) => (
            <section key={room.id} aria-label={room.name} className="mb-2.5 last:mb-0">
              <h3 className="m-0 mb-1 text-12.5 font-semibold text-mute">
                {room.name}{room.is_active === false ? ` · ${t("kabul.roomClosed")}` : ""}
              </h3>
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 p-0">
                {(room.beds ?? []).map((bed) => (
                  <li key={bed.id} className="flex items-center justify-between gap-2 rounded-ctl border border-line bg-card px-2.5 py-2">
                    <span className="grid">
                      <b className="font-data text-15">{bed.label}</b>
                      <span>
                        <Tag tone={bed.is_active === false ? "neutral" : TONE[bed.state] ?? "neutral"}>
                          {bed.is_active === false ? t("kabul.bedClosed") : t(BED_STATE_KEYS[bed.state] ?? "kabul.bedOther")}
                        </Tag>
                      </span>
                    </span>
                    {canRelease && bed.state === "HOUSEKEEPING" ? (
                      <Button size="sm" icon="ok" busy={releasing === bed.id} onClick={() => release(bed, unit, room)}>
                        {t("kabul.release")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Box>
      ))}
    </div>
  );
}

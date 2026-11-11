// src/live/screens/doluluk/DolulukScreen.jsx — «Doluluk» (Group 2 · B3a, spec §3): the caller's
// beds by unit and room. Each bed shows:
// - its state, as colour and words, and for how long;
// - the short name of the patient in an occupied bed;
// - a reserved or out-of-service bed's note and reason.
// It also offers the moves between the states, each gated by its right; the server checks all
// again. It replaces Hasta Kabul's «Yataklar» tab (X7).
//
// Names and notes come from GET /tenant/occupancy (R1), never from the structure. A failed read
// leaves the beds on screen without them and says so: a stale name on a bed whose patient has
// moved would be worse than none. For the same reason a tile shows them only where the state the
// structure shows has them (`shownOf`, M-2), and both are read again every minute while the
// screen is seen.
//
// One move is out at a time (the old tab's rule, A-17): while it is, every other bed's buttons
// are held and say why. Every move, landed or refused, is followed by a re-read of the beds and
// the names.
//
// Each move's result is said on the toast and stays on the screen, under the title, until the
// next move starts (§3): a toast goes, and the nurse who looked away must still find what became
// of her press. A move that takes its button away — the bed is in another state now — leaves the
// focus on the bed's own tile, which says that state, never on <body> (the old tab's A-22).
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { BED_STATE_KEYS, UNIT_TYPE_KEYS, normId } from "../../data/structure.js";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Empty, Seg, Tag, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { useNow } from "../common/useNow.js";
import { msOf } from "../common/elapsed.js";
import { doneFor, reasonOf, refusedFor } from "../admin/refusal.js";
import { freshForm, useAdmitDraft } from "../kabul/admitDraft.js";
import { BedStateDialog } from "./BedStateDialog.jsx";
import { actionsFor, shownOf, sinceKey, unitCounts, withOpen } from "./occupancy.js";

// The owner's colours (2026-11-10): a free bed is green, an occupied bed red, tag and tile edge.
// A bed waiting for something (cleaning, a discharge, a transfer) is warned. A reserved,
// out-of-service or maintenance bed says so in words, and its tile's edge marks it. The colour
// is never the only signal: the tag says the state in words. A closed bed takes no colour.
const TONE = { AVAILABLE: "ok", OCCUPIED: "crit", HOUSEKEEPING: "warn", PENDING_DISCHARGE: "warn", PENDING_TRANSFER_OUT: "warn" };
const EDGE = {
  AVAILABLE: "border-l-4 border-l-ok", OCCUPIED: "border-l-4 border-l-crit",
  RESERVED: "border-l-4 border-l-pri", BLOCKED: "border-l-4 border-l-line2", MAINTENANCE: "border-l-4 border-l-line2",
};
const COUNT_TONE = { free: "ok", cleaning: "warn" };
const ICON = { admit: "userPlus", reserve: "clock", outOfService: "x", unreserve: "x", returnToService: "ok", release: "ok" };
const COUNT_KEYS = ["free", "cleaning", "reserved", "outOfService", "maintenance"];
const NO_NAMES = new Map();
/** How often the beds and the names are read again while the screen is seen: DischargeTab's minute. */
export const REREAD_MS = 60_000;
// Either says hidden, it is hidden (the shadow store's rule; useTrends, MappingSection).
const hidden = () => typeof document !== "undefined"
  && (document.visibilityState === "hidden" || document.hidden === true);

export function DolulukScreen() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { structure, error, reload } = useStructure();
  const [, draft] = useAdmitDraft();
  const toast = useToast();
  const uid = useId();
  const now = useNow(30_000);
  const [names, setNames] = useState({ byBed: NO_NAMES, error: null });
  const [chosen, setChosen] = useState("all");
  const [working, setWorking] = useState(null);       // {id, subject} of the move that is out
  const [dialog, setDialog] = useState(null);         // {mode, bed, subject}
  const [said, setSaid] = useState(null);             // {text, refused}: the last move's result (§3)
  const [refocus, setRefocus] = useState(null);       // the bed whose move just ended (A-22)
  const tiles = useRef(new Map());                    // bed id -> its tile's <li>
  const namesSeq = useRef(0);
  const perms = user?.perms ?? [];

  // A move's button may be gone with the re-read (the bed is in another state): the focus it had
  // fell to <body>, and goes to the bed's tile instead. A focus anywhere else is hers, and stays.
  useEffect(() => {
    if (refocus === null) return;
    setRefocus(null);
    const active = document.activeElement;
    if (!active || active === document.body) tiles.current.get(refocus)?.focus();
  }, [refocus]);

  const readNames = useCallback(async () => {
    // Each read takes a number: an older read that answers after a newer one is dropped, or it
    // would put back a name the newer one no longer shows.
    const mine = namesSeq.current + 1;
    namesSeq.current = mine;
    try {
      const answer = await store.track(() => store.api.occupancy());
      if (namesSeq.current !== mine) return;
      setNames({ byBed: new Map((answer?.beds ?? []).map((b) => [normId(b.bed_id), b])), error: null });
    } catch (err) {
      if (namesSeq.current !== mine) return;
      setNames({ byBed: NO_NAMES, error: err });     // never a stale name on a bed that changed
    }
  }, [store]);
  const rereadAll = useCallback(() => Promise.all([reload(), readNames()]), [reload, readNames]);
  useEffect(() => { rereadAll(); }, [rereadAll]);

  // G2-B3a (final review M-2): another nurse's admission, discharge or reservation shows without a
  // press. Every minute while the page is seen, the beds and the names are read again. Hidden: no
  // timer at all. Seen again: one read now, and the minute starts from then (useTrends' rule). A
  // read still out is not stacked on.
  const polling = useRef(false);
  useEffect(() => {
    let timer = 0;
    const stop = () => {
      clearTimeout(timer);
      timer = 0;
    };
    const read = () => {
      if (polling.current) return;
      polling.current = true;
      rereadAll().finally(() => { polling.current = false; });
    };
    const arm = () => {
      stop();
      if (!hidden()) timer = setTimeout(tick, REREAD_MS);
    };
    const tick = () => {
      timer = 0;
      read();
      arm();
    };
    const onVisibility = () => {
      if (hidden()) {
        stop();
        return;
      }
      read();
      arm();
    };
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [rereadAll]);

  const heldId = `${uid}-held`;
  const units = (structure?.sites ?? []).flatMap((site) => site.units ?? []);
  const shown = chosen === "all" ? units : units.filter((u) => u.id === chosen);

  async function direct(bed, subject, action) {
    const call = {
      unreserve: () => store.api.unreserveBed(bed.id),
      returnToService: () => store.api.bedReturnToService(bed.id),
      release: () => store.api.releaseBed(bed.id),
    }[action];
    setWorking({ id: bed.id, subject });
    try {
      await store.track(call);
      const text = doneFor(t, subject, t(`doluluk.done.${action}`));
      toast(text);
      setSaid({ text, refused: false });
    } catch (err) {
      const text = refusedFor(t, subject, reasonOf(t, err));
      toast(text, "error");
      setSaid({ text, refused: true });
    } finally {
      // Held until the beds are read again: until then the tile still shows the old state, and a
      // press in that gap would repeat a move the server has already made.
      await rereadAll();
      setWorking(null);
      setRefocus(bed.id);
    }
  }

  /** «Bu çarpayıya xəstə qəbul et» (X10): the session's admission form takes this bed, and the
   *  Kabul screen opens on it. A form with a send in flight, held, or waiting for an answer is
   *  not touched — its bed is the one that send went to (admitDraft.js).
   *  After a finished admission the draft holds its number box: that patient is done with, and
   *  this bed goes into a fresh form, with the box closed (review I-1). Left open, Kabul showed
   *  the old number, and its «Yeni qəbul» emptied the bed again. An earlier patient's box
   *  (`done.earlier`) stays, to be read: the form under it is kept for its own send, and takes
   *  the bed. */
  function admitHere(unit, bed, subject) {
    let taken = false;
    draft.update((s) => {
      if (s.sending || s.held || (s.unanswered?.length ?? 0) > 0) return null;
      taken = true;
      const finished = Boolean(s.done) && !s.done.earlier;
      const base = finished ? { ...freshForm(), done: null } : { form: s.form };
      return { ...base, form: { ...base.form, unitId: unit.id, bedId: bed.id, bedLabel: subject } };
    });
    if (!taken) {
      toast(t("doluluk.admitBusy"), "error");
      return;
    }
    window.location.hash = "#/kabul";
  }

  function press(unit, bed, subject, action) {
    if (working) return;
    setSaid(null);                                    // a new move: the last one's result goes
    if (action === "admit") admitHere(unit, bed, subject);
    else if (action === "reserve" || action === "outOfService") setDialog({ mode: action, bed, subject });
    else direct(bed, subject, action);
  }

  const saying = working ? t("doluluk.working", { bed: working.subject }) : "";
  const options = [{ value: "all", label: t("doluluk.all") }, ...units.map((u) => ({ value: u.id, label: u.name }))];

  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div>
        <h1 className="m-0 font-display text-23 font-bold">{t("doluluk.title")}</h1>
        <p className="m-0 text-13 text-mute">{t("doluluk.sub")}</p>
        {/* G2-B3a (§3): the last move's result, on the screen as well as on the toast. Mounted with
            its text — keyed on it, so a new result is a new line — and so the toast alone says it
            aloud (Alert.jsx: a region mounted with its text is not announced); it stays to be read
            after the toast goes. */}
        {said ? (
          <p key={`${said.refused}:${said.text}`} role="status"
            className={`m-0 mt-1.5 text-13 font-semibold ${said.refused ? "text-crit-ink" : "text-ok-ink"}`}>
            {said.text}
          </p>
        ) : null}
      </div>
      {error ? (
        <div className="grid justify-items-start gap-2">
          <Alert tone="crit">{t("doluluk.readFailed", { reason: readErrorText(t, error) })}</Alert>
          <Button size="sm" onClick={() => rereadAll()}>{t("admin.retry")}</Button>
        </div>
      ) : null}
      {names.error ? <Alert tone="warn">{t("doluluk.namesFailed", { reason: readErrorText(t, names.error) })}</Alert> : null}
      {structure === null && !error ? <p role="status" className="m-0 text-13 text-mute">{t("doluluk.loading")}</p> : null}
      {structure !== null && units.length === 0 ? <Empty icon="bed">{t("doluluk.noUnits")}</Empty> : null}
      {units.length > 1 ? <Seg label={t("doluluk.unitChooser")} options={options} value={chosen} onChange={setChosen} /> : null}
      {shown.map((unit, unitIndex) => {
        const counts = unitCounts(unit);
        // G2-B3a (§3): the unit's type beside its name, in words — never the raw key.
        const typeKey = UNIT_TYPE_KEYS[unit.unit_type];
        return (
          <Box key={unit.id} title={unit.is_active === false ? `${unit.name} · ${t("doluluk.unitClosed")}` : unit.name} icon="building" level={2}
            right={typeKey ? <Tag>{t(typeKey)}</Tag> : null}>
            <p className="m-0 mb-2 flex flex-wrap items-center gap-2 text-13">
              <b className="font-data">{t("doluluk.occupied", { occupied: counts.occupied, usable: counts.usable })}</b>
              {COUNT_KEYS.filter((key) => counts[key] > 0).map((key) => (
                <Tag key={key} tone={COUNT_TONE[key] ?? "neutral"}>{t(`doluluk.counts.${key}`, { n: counts[key] })}</Tag>
              ))}
            </p>
            {(unit.rooms ?? []).length === 0 ? <p className="m-0 text-13 text-mute">{t("doluluk.noRooms")}</p> : null}
            {(unit.rooms ?? []).map((room, roomIndex) => {
              // The landmark is named "unit · room": two units may each have an "Otaq 1".
              const headingId = `${uid}-room-${unitIndex}-${roomIndex}`;
              return (
                <section key={room.id} aria-labelledby={headingId} className="mb-2.5 last:mb-0">
                  <h3 className="m-0 mb-1 flex items-center gap-2 text-12.5 font-semibold text-mute">
                    <span id={headingId}>
                      <span className="sr-only">{unit.name} · </span>
                      {room.name}{room.is_active === false ? ` · ${t("doluluk.roomClosed")}` : ""}
                    </span>
                    {room.is_isolation ? <Tag tone="warn">{t("doluluk.isolation")}</Tag> : null}
                  </h3>
                  {(room.beds ?? []).length === 0 ? <p className="m-0 text-13 text-mute">{t("doluluk.noBeds")}</p> : (
                    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 p-0">
                      {(room.beds ?? []).map((raw) => {
                        const bed = withOpen(unit, room, raw);
                        const subject = `${bed.label} · ${room.name} · ${unit.name}`;
                        // By the state the structure shows, never the names read's (M-2).
                        const shown = shownOf(bed, names.byBed.get(normId(bed.id)));
                        const since = bed.open ? sinceKey(msOf(bed.state_since), now) : null;
                        const held = working !== null && working.id !== bed.id;
                        const actions = actionsFor(bed, perms);
                        const stateText = bed.open ? t(BED_STATE_KEYS[bed.state] ?? "kabul.bedOther") : t("doluluk.bedClosed");
                        return (
                          <li key={bed.id} tabIndex={-1}
                            ref={(el) => { if (el) tiles.current.set(bed.id, el); else tiles.current.delete(bed.id); }}
                            className={`grid gap-1.5 rounded-ctl border border-line bg-card px-2.5 py-2 ${bed.open ? EDGE[bed.state] ?? "" : "opacity-70"} ${FOCUS_RING}`}>
                            <span className="flex items-center justify-between gap-2">
                              <b className="font-data text-15">{bed.label}</b>
                              <Tag tone={bed.open ? TONE[bed.state] ?? "neutral" : "neutral"}>{stateText}</Tag>
                            </span>
                            {since ? <span className="text-12 text-mute">{t(since.key, since.vars)}</span> : null}
                            {shown.name ? <span className="text-14 font-semibold">{shown.name}</span> : null}
                            {shown.reason ? <span className="text-12.5">{t(`doluluk.reason.${shown.reason}`)}</span> : null}
                            {shown.note ? <span className="text-12.5 text-mute">{shown.note}</span> : null}
                            {actions.length > 0 ? (
                              <span className="flex flex-wrap gap-1.5">
                                {actions.map((action) => (
                                  <Button key={action} size="sm" icon={ICON[action]} busy={working?.id === bed.id}
                                    aria-label={`${t(`doluluk.action.${action}`)}: ${subject}`}
                                    aria-disabled={held ? "true" : undefined} aria-describedby={held ? heldId : undefined}
                                    onClick={() => press(unit, bed, subject, action)}>
                                    {t(`doluluk.action.${action}`)}
                                  </Button>
                                ))}
                              </span>
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
        );
      })}
      {working !== null ? <span id={heldId} className="sr-only">{saying}</span> : null}
      <Announce text={saying} />
      {/* A dialog's move is read again FIRST, with the dialog's buttons held: closed before, it gave
          the focus back to its button, which the re-read then took away — and the focus fell to
          <body>. Then the focus goes to the bed's tile, if it is nowhere else (A-22). */}
      {dialog ? (
        <BedStateDialog mode={dialog.mode} bed={dialog.bed} subject={dialog.subject}
          onClose={() => setDialog(null)}
          onDone={async (text) => {
            setSaid({ text, refused: false });
            await rereadAll();
            setDialog(null);
            setRefocus(dialog.bed.id);
          }}
          onRefused={(text) => { setSaid({ text, refused: true }); rereadAll(); }} />
      ) : null}
    </div>
  );
}

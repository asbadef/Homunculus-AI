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
import { Alert, Announce, Button, Empty, Icon, Tag, useToast } from "../../ui/index.js";
import { ROUTES, canReach, screenOf } from "../../shell/routes.js";
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
// The tile's own fill, the prototype's small bed boxes (.oc-bed): the state's tint, the edge above
// kept as the second signal and the tag as the words.
const FILL = {
  AVAILABLE: "bg-[color:color-mix(in_srgb,var(--ok)_9%,var(--card))]",
  OCCUPIED: "bg-[color:color-mix(in_srgb,var(--crit)_7%,var(--card))]",
  HOUSEKEEPING: "bg-att", PENDING_DISCHARGE: "bg-att", PENDING_TRANSFER_OUT: "bg-att",
  RESERVED: "bg-[color:color-mix(in_srgb,var(--low)_10%,var(--card))]",
  BLOCKED: "bg-card2", MAINTENANCE: "bg-card2",
};
// The prototype's four tiles over the board: free, cleaning, reserved, out of use — each the sum of the
// units on screen (occupancy.js unitCounts), the hospital's own beds.
const TILES = [
  ["free", "bed", "doluluk.tile.free"], ["cleaning", "clock", "doluluk.tile.cleaning"],
  ["reserved", "star", "doluluk.tile.reserved"], ["out", "x", "doluluk.tile.out"],
];
const TILE_LOOK = {
  free: ["border-line bg-card", "bg-card2 text-ok"],
  cleaning: ["border-att-line bg-att", "bg-att-ico text-att-ink"],
  reserved: ["border-att-line bg-att", "bg-att-ico text-att-ink"],
  out: ["border-[color:color-mix(in_srgb,var(--crit)_45%,transparent)] bg-crit-soft", "bg-[color:color-mix(in_srgb,var(--crit)_18%,transparent)] text-crit"],
};
const LEGEND = [
  ["doluluk.legend.free", "border-[color:var(--ok)] bg-[color:color-mix(in_srgb,var(--ok)_20%,transparent)]"],
  ["doluluk.legend.occupied", "border-[color:var(--crit)] bg-[color:color-mix(in_srgb,var(--crit)_18%,transparent)]"],
  ["doluluk.legend.cleaning", "border-att-line bg-att"],
  ["doluluk.legend.out", "border-line2 bg-card2"],
  ["doluluk.legend.reserved", "border-[color:var(--low)] bg-[color:color-mix(in_srgb,var(--low)_20%,transparent)]"],
];
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
  const totals = shown.reduce((sum, unit) => {
    const c = unitCounts(unit);
    return { free: sum.free + c.free, cleaning: sum.cleaning + c.cleaning, reserved: sum.reserved + c.reserved,
      out: sum.out + c.outOfService + c.maintenance };
  }, { free: 0, cleaning: 0, reserved: 0, out: 0 });
  const kabulRoute = ROUTES.find((r) => r.id === "kabul");
  const kabulHref = kabulRoute && screenOf(kabulRoute) && canReach(kabulRoute, perms) ? `#${kabulRoute.path}` : null;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* The prototype's .ph: the title, its line, «Doluluğu yazdır» and «Hasta kabul» at the right. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 font-display text-23 font-bold leading-[1.1]">{t("doluluk.title")}</h1>
        <p className="m-0 mt-1 text-13 text-mute">{t("doluluk.sub")}</p>
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
      <div className="flex flex-wrap items-center gap-2">
        <Button icon="print" onClick={() => window.print()}>{t("doluluk.print")}</Button>
        {kabulHref ? (
          <a href={kabulHref} className={`inline-flex h-[34px] items-center gap-1.5 rounded-[10px] bg-pri px-[13px] text-13 font-semibold leading-[normal] text-onpri hover:brightness-105 ${FOCUS_RING}`}>
            <Icon name="userPlus" size={16} />{t("doluluk.admit")}
          </a>
        ) : null}
      </div>
      </div>
      {structure !== null && units.length > 0 ? (
        <div className="grid gap-3 min-[861px]:grid-cols-2 min-[1180px]:grid-cols-4">
          {TILES.map(([key, icon, label]) => {
            const n = totals[key];
            const [box, ico] = n || key === "free" ? TILE_LOOK[key] : ["border-line bg-card", "bg-card2 text-mute"];
            return (
              <div key={key} data-tile={key} className={`grid min-w-0 grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-[3px] rounded-[14px] border px-[13px] py-3 ${box}`}>
                <span className={`row-span-2 grid h-10 w-10 place-items-center rounded-[10px] ${ico}`}><Icon name={icon} size={20} /></span>
                <b className="font-display text-[calc(24px*var(--fs))] font-bold leading-none text-ink">{n}</b>
                <span className="min-w-0 text-12.5 text-mute">{t(label)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      {error ? (
        <div className="grid justify-items-start gap-2">
          <Alert tone="crit">{t("doluluk.readFailed", { reason: readErrorText(t, error) })}</Alert>
          <Button size="sm" onClick={() => rereadAll()}>{t("admin.retry")}</Button>
        </div>
      ) : null}
      {names.error ? <Alert tone="warn">{t("doluluk.namesFailed", { reason: readErrorText(t, names.error) })}</Alert> : null}
      {structure === null && !error ? <p role="status" className="m-0 text-13 text-mute">{t("doluluk.loading")}</p> : null}
      {structure !== null && units.length === 0 ? <Empty icon="bed">{t("doluluk.noUnits")}</Empty> : null}
      {units.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {units.length > 1 ? (
            <label className="flex items-center gap-2">
              <span className="sr-only">{t("doluluk.unitChooser")}</span>
              {/* The options carry their place in the list, never a unit's UUID: no id is written into the page. */}
              <select value={chosen === "all" ? "all" : String(units.findIndex((u) => u.id === chosen))}
                onChange={(e) => setChosen(e.target.value === "all" ? "all" : units[Number(e.target.value)]?.id ?? "all")}
                className={`h-10 min-w-[240px] rounded-xl border border-line bg-card px-3 text-14 text-ink ${FOCUS_RING}`}>
                <option value="all">{t("doluluk.allUnits", { count: units.length })}</option>
                {units.map((u, i) => <option key={u.id} value={String(i)}>{u.name}</option>)}
              </select>
            </label>
          ) : null}
          {/* The prototype's legend: the state's colour beside its word. */}
          <ul aria-label={t("doluluk.legendTitle")} className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 text-12.5 text-mute">
            {LEGEND.map(([key, look]) => (
              <li key={key} className="flex items-center gap-1.5"><i aria-hidden="true" className={`h-3 w-3 rounded-[3px] border ${look}`} />{t(key)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {shown.map((unit, unitIndex) => {
        const counts = unitCounts(unit);
        // G2-B3a (§3): the unit's type beside its name, in words — never the raw key.
        const typeKey = UNIT_TYPE_KEYS[unit.unit_type];
        return (
          // One block per unit — its .sec head across the top, its rooms as cards under it.
          <div key={unit.id} className="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] items-start gap-3">
            <div className="col-span-full mt-[18px] flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h2 className="m-0 flex items-center gap-2 font-display text-14 font-bold leading-[normal]">
                {unit.is_active === false ? `${unit.name} · ${t("doluluk.unitClosed")}` : unit.name}
              </h2>
              {typeKey ? <span className="rounded-full bg-card2 px-2 py-[3px] text-11.5 font-semibold leading-[normal] text-mute">{t(typeKey)}</span> : null}
              <p className="m-0 ml-auto flex flex-wrap items-center gap-1.5 text-12 font-medium text-mute">
                <span>{t("doluluk.occupied", { occupied: counts.occupied, usable: counts.usable })}</span>
                {COUNT_KEYS.filter((key) => counts[key] > 0).map((key) => (
                  <Tag key={key} tone={COUNT_TONE[key] ?? "neutral"}>{t(`doluluk.counts.${key}`, { n: counts[key] })}</Tag>
                ))}
              </p>
            </div>
            {(unit.rooms ?? []).length === 0 ? <p className="col-span-full m-0 text-13 text-mute">{t("doluluk.noRooms")}</p> : null}
            {(unit.rooms ?? []).map((room, roomIndex) => {
              // The landmark is named "unit · room": two units may each have an "Otaq 1".
              const headingId = `${uid}-room-${unitIndex}-${roomIndex}`;
              const many = (room.beds ?? []).length > 1;
              return (
                <section key={room.id} aria-labelledby={headingId}
                  className={`rounded-[14px] border border-line bg-card px-2 pb-2 pt-2.5 ${many ? "[grid-column:span_1]" : ""}`}>
                  <h3 className="m-0 mb-1.5 flex items-center gap-2 px-0.5 text-11 font-bold uppercase leading-[normal] tracking-[.06em] text-mute">
                    <span id={headingId}>
                      <span className="sr-only">{unit.name} · </span>
                      {room.name}{room.is_active === false ? ` · ${t("doluluk.roomClosed")}` : ""}
                    </span>
                    {room.is_isolation ? <Tag tone="warn">{t("doluluk.isolation")}</Tag> : null}
                  </h3>
                  {(room.beds ?? []).length === 0 ? <p className="m-0 text-13 text-mute">{t("doluluk.noBeds")}</p> : (
                    <ul className={`m-0 grid list-none gap-1.5 p-0 ${many ? "grid-cols-2" : "grid-cols-1"}`}>
                      {(room.beds ?? []).map((raw) => {
                        const bed = withOpen(unit, room, raw);
                        const subject = `${bed.label} · ${room.name} · ${unit.name}`;
                        // By the state the structure shows, never the names read's (M-2).
                        const shownBed = shownOf(bed, names.byBed.get(normId(bed.id)));
                        const since = bed.open ? sinceKey(msOf(bed.state_since), now) : null;
                        const held = working !== null && working.id !== bed.id;
                        const actions = actionsFor(bed, perms);
                        const stateText = bed.open ? t(BED_STATE_KEYS[bed.state] ?? "kabul.bedOther") : t("doluluk.bedClosed");
                        return (
                          <li key={bed.id} tabIndex={-1}
                            ref={(el) => { if (el) tiles.current.set(bed.id, el); else tiles.current.delete(bed.id); }}
                            className={`group relative grid min-w-0 gap-0.5 rounded-[10px] border border-line px-2 py-1.5 ${bed.open ? `${EDGE[bed.state] ?? ""} ${FILL[bed.state] ?? "bg-card"}` : "bg-card2 opacity-70"} ${FOCUS_RING}`}>
                            <span className="flex min-w-0 items-center justify-between gap-1">
                              <b className="truncate font-data text-12.5 font-bold text-ink">{bed.label}</b>
                              <Tag tone={bed.open ? TONE[bed.state] ?? "neutral" : "neutral"}>{stateText}</Tag>
                            </span>
                            {shownBed.name ? <span className="truncate text-11.5 font-semibold text-ink">{shownBed.name}</span> : null}
                            {since ? <span className="truncate text-11 text-mute">{t(since.key, since.vars)}</span> : null}
                            {shownBed.reason ? <span className="text-11.5">{t(`doluluk.reason.${shownBed.reason}`)}</span> : null}
                            {shownBed.note ? <span className="truncate text-11.5 text-mute">{shownBed.note}</span> : null}
                            {actions.length > 0 ? (
                              // The moves open from the tile — on the pointer, or the keyboard's focus inside it —
                              // as a small card under it (the prototype's bed menu). Always in the document.
                              <span className="absolute left-0 top-[calc(100%+4px)] z-20 hidden min-w-full flex-col gap-1 rounded-[10px] border border-line2 bg-card p-1.5 shadow-pop group-focus-within:flex group-hover:flex">
                                {actions.map((action) => (
                                  <Button key={action} size="sm" icon={ICON[action]} busy={working?.id === bed.id} className="justify-start"
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
          </div>
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

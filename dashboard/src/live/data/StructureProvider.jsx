// src/live/data/StructureProvider.jsx — the ward's structure, read once for the whole shell
// (Group 2 · B1a). The top bar and the bed board read a unit's NAME from it, the admission screen
// its beds and their states, the administrator's Yapı tab the whole tree.
//
//   const { structure, index, phase, known, reload } = useStructure();
//
// `phase`: "unasked" (this session holds none of the rights `GET /tenant/structure` opens to, so
// it is not called), "loading", "known", "stale" (a reload failed; the last answer stands), or
// "failed" (none has answered). Every call goes through the session's `track`, as the board's do.
// `reload()` resolves to the tree it read — null when that read failed or was not asked — so a
// screen that must decide on a FRESH answer (Kabul, after a write that got no answer) decides on
// that one, not on whatever its next render happens to hold.
// Outside a provider (a screen mounted alone in a test) the context is empty: nothing is called,
// and `useUnitNames` / `useBedNames` name every unit and bed by a placeholder.
//
// `known`: the provider holds a tree — "known" or "stale" — whose names may be shown. «Unknown» is
// a stronger claim: it is made only in phase "known" (the last read succeeded), and for a unit the
// scope lists only once the read made for that very unit has landed (`rereading` holds the ids that
// read is for). In every other case the index is empty or out of date, which is not the ward
// lacking the unit, and `useUnitNames` / `useBedNames` give a numbered placeholder instead.
//
// A read that fails is tried again, waiting 2, 4, 8 … s up to 30 s, for as long as the shell is
// open and the session may read it (the ward's network drops for a minute; the names must come
// back without a reload). A refusal — a 4xx other than 408 and 429: a 403, or a 404 from a server
// not yet carrying the route — is no hiccup and is asked again only every 5 minutes, in case it
// is mended. A scope that lists a unit the tree lacks — one added since it was read — makes the
// structure be read once more, once for each such gap, not in a loop.
//
// `ordinalOf(kind, id)`: the number of a unit or bed that is shown as a placeholder or as
// «unknown». One registry for as long as the shell is open, so a number stays with its unit on
// every screen and is never reused (structure.js `ordinalRegistry`).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { useShell } from "../shell/ShellContext.jsx";
import { EMPTY_INDEX, bedNamer, indexStructure, normId, ordinalRegistry, unitNamer } from "./structure.js";

/** The rights GET /tenant/structure opens to (tenant/router.py) — the scope editor's
 *  `users.manage` among them. */
export const STRUCTURE_PERMS = Object.freeze(["admissions.view", "admissions.admit", "beds.release", "structure.manage", "users.manage"]);

/** The wait before the first retry of a failed read, doubled after each failure, and its ceiling. */
export const RETRY_FIRST_MS = 2_000;
export const RETRY_MAX_MS = 30_000;
/** The wait before asking again after a refusal (a 4xx other than 408 and 429). */
export const RETRY_REFUSED_MS = 300_000;

/** A server's refusal — it answered, and said no — as against a time-out, throttling, a fault or
 *  no answer at all, which are the hiccups the quick retries are for. */
function refused(error) {
  const status = error?.status;
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

const NONE = Object.freeze({
  structure: null, index: EMPTY_INDEX, phase: "unasked", known: false, error: null, reload: async () => null,
  ordinalOf: null, rereading: Object.freeze(new Set()),
});
const StructureContext = createContext(NONE);

export function StructureProvider({ children }) {
  const { user, store } = useSession();
  const { units } = useShell();
  const may = STRUCTURE_PERMS.some((key) => user?.perms?.includes(key));
  const [state, setState] = useState(() => ({ structure: null, phase: may ? "loading" : "unasked", error: null }));
  const seq = useRef(0);
  const mounted = useRef(false);
  const retryTimer = useRef(0);
  const failures = useRef(0);
  const triggered = useRef("");
  const [settledGap, setSettledGap] = useState("");
  const ordinals = useRef(null);
  if (ordinals.current === null) ordinals.current = ordinalRegistry();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(retryTimer.current);
    };
  }, []);

  const reload = useCallback(async () => {
    // Every call takes a number first, whatever it goes on to do: an answer that lands after a
    // later call — a right lost in between, a retry — is dropped, and a retry waiting is not wanted.
    const mine = seq.current + 1;
    seq.current = mine;
    clearTimeout(retryTimer.current);
    if (!may) {
      failures.current = 0;
      setState({ structure: null, phase: "unasked", error: null });
      return null;
    }
    // The right was gained under an open shell: the read is out, which is not "unasked".
    setState((prev) => (prev.phase === "unasked" ? { structure: null, phase: "loading", error: null } : prev));
    try {
      const answer = await store.track(() => store.api.structure());
      // An answer that is not a tree is an empty one, still "known": the server answered.
      const tree = Array.isArray(answer?.sites) ? answer : { tenant_id: answer?.tenant_id ?? null, sites: [] };
      if (mounted.current && seq.current === mine) {
        failures.current = 0;
        setState({ structure: tree, phase: "known", error: null });
      }
      return tree;
    } catch (error) {
      if (mounted.current && seq.current === mine) {
        setState((prev) => ({ structure: prev.structure, phase: prev.structure ? "stale" : "failed", error }));
        const wait = refused(error) ? RETRY_REFUSED_MS : Math.min(RETRY_FIRST_MS * 2 ** failures.current, RETRY_MAX_MS);
        failures.current += 1;
        retryTimer.current = setTimeout(() => { reload(); }, wait);
      }
      return null;
    }
  }, [may, store]);

  useEffect(() => { reload(); }, [reload]);

  const index = useMemo(() => indexStructure(state.structure), [state.structure]);
  const known = state.phase === "known" || state.phase === "stale";

  // A unit the shell's scope lists and the tree lacks was added since the tree was read: read it
  // once more. Once per such gap — a unit the new read still lacks is simply unknown. Until that
  // read has landed the tree is no answer about those units: `rereading` names them, and no screen
  // calls them «unknown» meanwhile. The gap is worked out while rendering, so there is no
  // render in between in which a unit the effect has yet to read for is already called unknown.
  const gap = useMemo(
    () => (known ? units.filter((id) => !index.units.has(normId(id))).map(normId).sort() : []),
    [known, units, index],
  );
  const gapKey = gap.join("|");
  useEffect(() => {
    if (gapKey === "") {
      triggered.current = "";
      setSettledGap("");
      return;
    }
    if (triggered.current === gapKey) return;
    triggered.current = gapKey;
    reload().then(() => { if (mounted.current) setSettledGap(gapKey); });
  }, [gapKey, reload]);
  const awaiting = gapKey !== "" && settledGap !== gapKey;
  const rereading = useMemo(() => new Set(awaiting ? gap : []), [awaiting, gapKey]);   // `gap` is gapKey's array

  const value = useMemo(() => ({
    structure: state.structure, index, phase: state.phase, known, error: state.error, reload,
    ordinalOf: ordinals.current.ordinalOf, rereading,
  }), [state, index, known, reload, rereading]);
  return <StructureContext.Provider value={value}>{children}</StructureContext.Provider>;
}

export function useStructure() {
  return useContext(StructureContext);
}

/** The registry the placeholder numbers come from: the shell's own, or — for a screen mounted
 *  outside a provider — one of that screen's own. */
function useOrdinalOf() {
  const { ordinalOf } = useStructure();
  const own = useRef(null);
  if (ordinalOf) return ordinalOf;
  if (own.current === null) own.current = ordinalRegistry().ordinalOf;
  return own.current;
}

/** The units of `ids` as a screen names them (structure.js `unitNamer`): `{ nameOf(id), sorted,
 *  placeholders }`. Keep `ids` the same array between renders (a memo, a context's list). */
export function useUnitNames(ids) {
  const { index, phase, rereading } = useStructure();
  const { t, lang } = useI18n();
  const ordinalOf = useOrdinalOf();
  return useMemo(
    () => unitNamer(t, { index, phase, ordinalOf, rereading }, ids, lang),
    [t, index, phase, ordinalOf, rereading, ids, lang],
  );
}

/** The beds of `ids` as a screen names them (structure.js `bedNamer`). */
export function useBedNames(ids) {
  const { index, phase } = useStructure();
  const { t, lang } = useI18n();
  const ordinalOf = useOrdinalOf();
  return useMemo(() => bedNamer(t, { index, phase, ordinalOf }, ids, lang), [t, index, phase, ordinalOf, ids, lang]);
}

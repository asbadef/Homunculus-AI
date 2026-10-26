// src/live/screens/kabul/admitDraft.js — the admission form's memory, owned by the signed-in
// session (Group 2 · B1a, amendments A-21).
//
//   const [state, draft] = useAdmitDraft();    // in the Kabul tab; write with draft.update(…)
//   admitDraftOf(session)                      // the same draft, outside React (the tests)
//
// WHY IT IS NOT THE TAB'S. The Hasta Kabul screen mounts only the open tab, and the shell only the
// open screen: a tab change, «Paneldə bax» or the menu unmounted the form, and with it the sends
// that got no answer and the hold. A send answering later then had nowhere to land, and the nurse
// came back to an empty form that looked for nothing — so the same patient could be admitted
// twice. Here the form, `tried`, the send on its way, the hold, the sends with no answer (and their
// «looked at» marks) and the open box (the number box, or an earlier patient's) belong to the
// session: they outlive the tab and the route, a send's continuation writes here whatever is
// mounted by then, and the tab that comes back reads them.
//
// WHY IT ENDS WITH THE SESSION. A ward workstation is shared, and the draft holds a patient's name:
// it must not outlive the session that typed it. One draft per session — keyed by the session
// store's `epoch` (moved whenever a session begins or ends, sessionStore.js) and the user's id — and
// the moment the session store says that key moved (a sign-out, a session the server ended, another
// account in another tab), the draft is WIPED and dead: a send of that session answering afterwards
// writes into a draft that keeps nothing, and the next session gets a new, empty one. A lock, its
// unlock and a forced password change are the same session: the draft stays. With no one signed in
// there is no draft that keeps anything. The drafts hang off the session store itself (a WeakMap),
// so a page has one set, gone with its store.
//
// THE REQUEST ID IS THE PATIENT'S SEND'S (A-19, A-24 I-1). One per filled form, kept for a resend of
// the same patient so the server can take two sends for one admission. Every send with no answer
// keeps the id it went with. The form must never go out under the id of an unanswered send of
// ANOTHER patient — the server would answer the new patient's send with the old one's admission —
// so the moment the form's name moves away from the name of an unanswered send that carries the
// form's id, the form takes a new one (`ownId`, on every write). The old send keeps its own. Typed
// back to a patient with a send still unanswered, the form takes that send's id again. Every send
// carries it as the body's `request_id` (Task 19b, AdmitTab.jsx); it is never shown.
import { useSyncExternalStore } from "react";
import { useSession } from "../../session/SessionProvider.jsx";
import { emptyForm } from "./admitForm.js";

/** Two names as a nurse reads them alike: spaces collapsed, case folded. */
export function sameName(a, b) {
  const plain = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return plain(a) === plain(b);
}

/** A version-4 UUID from `crypto.getRandomValues` — not `randomUUID`, which a page served over
 *  plain HTTP (the ward's VM) does not have: it is for secure contexts only. */
export function newRequestId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A new patient's form: empty, no error shown yet, and its own request id. */
export function freshForm() {
  return {
    form: emptyForm(),
    tried: false,
    // A-19/A-21/A-24: one per filled form, kept across resends, new after an admission, «Yeni qəbul» or a turn to another patient (`ownId`); sent as `request_id`.
    requestId: newRequestId(),
  };
}

/** What a session's draft holds. `unanswered`: every send with no answer whose DRAFT is not found
 *  yet, `{bedId, bed, name, checked, requestId}`; `held`: `{bed}` while a send waits on one of them,
 *  or `{bed, conflict: {key, vars}}` once the server said an admission exists under the form's id
 *  (`request_conflict`, until «Yeni qəbul»; `bed` the earlier send's, or null when that is not one
 *  bed); `done`: the box open in place of the form,
 *  `{number, bed, engine, recovered?, earlier?}`. */
const fresh = () => ({ ...freshForm(), sending: false, held: null, unanswered: [], done: null });

/** `state`, its form under the id that is its patient's:
 *   - an unanswered send of the form's patient carries the form's id: kept, for a resend;
 *   - else, when unanswered sends of the form's patient — her name — carry another id, the
 *     newest one's: a detour through another name (typed Y, then back to X) must not leave X under
 *     a fresh id, or a send of X to another bed would be a second admission when the first lands,
 *     where under X's own id the server answers it `request_conflict` (re-review M-1);
 *   - else, when an unanswered send of ANOTHER patient carries the form's id: a new one;
 *   - else the form's own, as it is. */
function ownId(state) {
  const { unanswered, requestId, form } = state;
  const carriers = unanswered.filter((s) => s.requestId === requestId);
  const another = carriers.some((s) => !sameName(s.name, form.name));
  if (carriers.length > 0 && !another) return state;
  const hers = unanswered.filter((s) => s.requestId && sameName(s.name, form.name)).at(-1);
  if (hers) return { ...state, requestId: hers.requestId };
  return another ? { ...state, requestId: newRequestId() } : state;
}

/** A draft that keeps nothing: an ended session's, or the one handed out while nobody is signed in. */
const EMPTY = Object.freeze({
  form: Object.freeze(emptyForm()), tried: false, requestId: null, sending: false, held: null,
  unanswered: Object.freeze([]), done: null,
});
const NO_DRAFT = Object.freeze({
  live: false,
  get: () => EMPTY,
  subscribe: () => () => {},
  update() {},
});

function createDraft() {
  let state = fresh();
  let live = true;
  const listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(); };
  return {
    /** False once its session has ended: nothing is kept, and every write is dropped. */
    get live() { return live; },
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Merge `patch` — or what `patch(state)` returns; null changes nothing — into the draft. */
    update(patch) {
      if (!live) return;
      const next = typeof patch === "function" ? patch(state) : patch;
      if (!next) return;
      state = ownId({ ...state, ...next });
      emit();
    },
    end() {
      live = false;
      state = EMPTY;
      emit();
    },
  };
}

/** The session's key: its epoch and its user, or null when nobody is signed in. */
function ownerOf(session) {
  const user = session.getState().user;
  return user ? `${session.epoch()} ${user.id}` : null;
}

function createDrafts(session) {
  let owner = ownerOf(session);
  let draft = null;
  const listeners = new Set();
  // Every change of the session is looked at; only a new key ends the draft — synchronously, inside
  // the session store's own emit, before React draws anything of the next session.
  session.subscribe(() => {
    const next = ownerOf(session);
    if (next === owner) return;
    owner = next;
    draft?.end();
    draft = null;
    for (const fn of [...listeners]) fn();
  });
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    current() {
      if (owner === null) return NO_DRAFT;
      if (draft === null) draft = createDraft();
      return draft;
    },
  };
}

const bySession = new WeakMap();

function draftsOf(session) {
  let drafts = bySession.get(session);
  if (!drafts) {
    drafts = createDrafts(session);
    bySession.set(session, drafts);
  }
  return drafts;
}

/** The signed-in session's admission draft (a dead, empty one when nobody is signed in). */
export function admitDraftOf(session) {
  return draftsOf(session).current();
}

/** `[state, draft]` for the session on screen; the component re-renders when either moves. Write
 *  with `draft.update` — from a send's continuation too, which holds THIS session's draft. */
export function useAdmitDraft() {
  const { store } = useSession();
  const drafts = draftsOf(store);
  const draft = useSyncExternalStore(drafts.subscribe, drafts.current);
  const state = useSyncExternalStore(draft.subscribe, draft.get);
  return [state, draft];
}

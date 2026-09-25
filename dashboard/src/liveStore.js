// src/liveStore.js — the seam that puts the real backend behind the clinical UI.
//
// The design (ClinicalDemo) drives a simulation store. This wraps that store and replaces ONLY the
// authentication actions with real API calls, overlaying the resulting session on top of the
// simulated state. Everything the backend does not implement yet keeps working exactly as before,
// so the UI stays whole while the real system grows underneath it, domain by domain.

import {
  sessionFromToken, accessProblem, secretFromProvisioningUri, NO_PERMISSIONS, NO_BOARD_ACCESS,
} from "./liveAuth.js";
import { uiRoleFromPerms } from "./permissions.js";
import { patientFromBoard, patientsFromBoard, bedsFromPatients, alertsFromPatients } from "./liveAdapters.js";
import { CONNECTION, nextConnection } from "./liveConnection.js";

// How long to wait before the ONE reconnect attempt after the stream drops. Not a retry loop:
// each disconnect gets a single scheduled retry, which itself gets a fresh ticket (see connect()
// in startLive() below) — the whole point being that the OLD ticket is spent and cannot be reused.
const RECONNECT_DELAY_MS = 5000;

/** `state.sessionError.code` when a stored session could not be checked because the server did
 *  not answer. The tokens are kept; calling restoreSession() again retries. */
export const SESSION_UNREACHABLE = "SESSION_UNREACHABLE";

// Why a session was refused, per accessProblem() reason. A reason missing here still refuses
// (resolveSession fails closed), with the generic message.
const REFUSAL_MESSAGES = new Map([
  [NO_PERMISSIONS, "Hesabınıza kurum yetkisi tanımlanmamış. Sistem yöneticinizle görüşün."],
  [NO_BOARD_ACCESS, "Panoya erişim yetkiniz yok. Sistem yöneticinizle görüşün."],
]);
const REFUSED_GENERIC = "Bu hesapla oturum açılamıyor. Sistem yöneticinizle görüşün.";

/** True when an API failure means the server REFUSED the session: a refresh it turned down
 *  (backendApi marks the error `sessionEnded`), or a 401/403 on the call itself. Anything else —
 *  a 5xx, no network — means it did not answer, and the session may be perfectly good. */
function sessionRefused(err) {
  return err?.sessionEnded === true || err?.status === 401 || err?.status === 403;
}

/** Real SSE opener. `ticket` is a short-lived, single-use credential — never a JWT — because
 *  EventSource cannot send headers and a bearer token in the URL would leak into server logs,
 *  browser history and any Referer header the browser sends onward.
 *
 *  `handlers` is {onopen, onmessage, onerror} — the store owns the EventSource lifecycle so it can
 *  merge frames into state and react to drops; this function only wires the plumbing. */
function defaultOpenStream(url, handlers = {}) {
  if (typeof EventSource === "undefined") return () => {};   // no SSE (e.g. jsdom) -> no-op
  const source = new EventSource(url);
  if (handlers.onopen) source.onopen = handlers.onopen;
  if (handlers.onmessage) source.onmessage = handlers.onmessage;
  if (handlers.onerror) source.onerror = handlers.onerror;
  return () => source.close();
}

/** Upsert `patient` into `patients` by patient_id — replace the matching entry, or append. Never
 *  mutates the array it's given: every overlay update has to look like a fresh object to whatever
 *  is watching, or subscribers relying on reference equality could miss the change. */
function mergePatient(patients, patient) {
  const idx = patients.findIndex((p) => p.patient_id === patient.patient_id);
  if (idx === -1) return [...patients, patient];
  const next = patients.slice();
  next[idx] = patient;
  return next;
}

export function createLiveStore({ api, base, openStream = defaultOpenStream }) {
  // Session + board state owned by us; the rest of the state still comes from the simulation.
  // beds/alerts/devices are seeded empty (not omitted) from the start: getState() spreads overlay
  // over the base's state, and until the first refreshBoard() resolves, an omitted key here would
  // let the base's fabricated ward show through — a clinician briefly seeing a fake ward right
  // after login.
  let overlay = {
    user: null, mfaPending: null, patients: [], beds: [], alerts: [], devices: [],
    connection: CONNECTION.CONNECTING,
    // The simulation greets a first-time admin with its tenant-setup wizard — but on a live
    // deployment the tenant already exists (created by the backend seed), and the wizard writes
    // only to the in-browser simulation. Left unset, its in-memory flag resets on every page
    // load and the wizard re-asks a real clinician for the hospital name on every refresh.
    tenantSetup: true,
    // Tells the UI it is talking to the real backend: simulation-only controls hide on it.
    live: true,
    // Set by restoreSession() when the server could not be reached ({code, message, detail});
    // null otherwise. See SESSION_UNREACHABLE.
    sessionError: null,
  };
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };

  // Every overlay update MUST merge, never replace: `getState()` spreads `overlay` over the
  // base's state, so if an unrelated update (e.g. a login) ever reassigned `overlay` to an
  // object missing `patients`, the base store's SIMULATED patients would win the spread on the
  // very next read. That is the exact defect this store exists to prevent.
  const setOverlay = (patch) => { overlay = { ...overlay, ...patch }; };

  const getState = () => ({ ...base.getState(), ...overlay });

  const subscribe = (fn) => {
    listeners.add(fn);
    const offBase = base.subscribe(fn);
    return () => { listeners.delete(fn); if (typeof offBase === "function") offBase(); };
  };

  /** The session in a token, refusing anything that cannot open the clinical UI.
   *
   *  Fails closed: ANY answer from accessProblem() other than null refuses, including a reason
   *  code added there later and never listed in REFUSAL_MESSAGES. A refusal drops the tokens, and
   *  its error says so (`sessionEnded`, `code`), like a refresh the server turned down. */
  function resolveSession(accessToken) {
    const session = sessionFromToken(accessToken);
    const problem = accessProblem(session);
    if (problem !== null) {
      api.logout();
      const err = new Error(REFUSAL_MESSAGES.get(problem) ?? REFUSED_GENERIC);
      err.code = problem;
      err.sessionEnded = true;
      throw err;
    }
    return session;
  }

  /** The UI's user object. `role` is DISPLAY ONLY (icons, labels); gating uses `perms`. */
  function sessionUser(me, session) {
    const groups = Array.isArray(me.groups) ? me.groups : [];
    return {
      email: me.email, username: me.username, full_name: me.full_name,
      role: uiRoleFromPerms(session.perms),
      perms: session.perms, groups: session.groups,
      groupNames: groups.map((g) => g.name),
    };
  }

  function pendingMfa(login, me, session, enrolled) {
    return {
      email: login, full_name: me.full_name, role: uiRoleFromPerms(session.perms),
      groupNames: (Array.isArray(me.groups) ? me.groups : []).map((g) => g.name),
      enrolled, live: true,
    };
  }

  /** Fetch the profile and open the session. */
  async function openSession(session) {
    const me = await api.me();
    setOverlay({ user: sessionUser(me, session), mfaPending: null, sessionError: null });
    emit();
    return { mfaRequired: false };
  }

  /** Load the board. On failure the patient list is emptied — NEVER left showing whatever the
   *  wrapped simulation store happens to hold. A clinician who logged in with real hospital
   *  credentials must see "no data" on a failed fetch, not invented patients.
   *
   *  `beds`/`alerts` are synthesized from the SAME patients (see liveAdapters.js) so BedBoard and
   *  AlarmPage — written against the simulation's shapes — render real data unmodified. `devices`
   *  is forced empty: the simulated device inventory (MDI/HL7 status badges) has no live source
   *  yet, and showing it would be exactly the kind of fabricated-but-plausible data this store
   *  exists to prevent. */
  async function refreshBoard() {
    try {
      const board = await api.boardPatients();
      const patients = patientsFromBoard(board);
      setOverlay({
        patients,
        beds: bedsFromPatients(patients),
        alerts: alertsFromPatients(patients, base.getState().clockSec ?? 0),
        devices: [],
        connection: nextConnection(overlay.connection, { type: "loaded" }),
      });
    } catch {
      setOverlay({
        patients: [],
        beds: [],
        alerts: [],
        devices: [],
        connection: nextConnection(overlay.connection, { type: "failed" }),
      });
    }
    emit();
  }

  /** AckModal calls this as `store.acknowledgeAlert(alert.id, {reason, note})` and must not
   *  change — alert.id is "<patient_id>::<kind>" (alertsFromPatients). `reason`/`note` are not
   *  forwarded: the backend's AckStore keeps only {by, at} in this slice, so there is nowhere for
   *  them to go yet. The actor is attributed by the API from the signed token, never sent from
   *  here. A refusal (403 "permission required: alerts.ack") rejects with the API's message for
   *  the caller to show; the board is not reloaded, since nothing was acknowledged. */
  async function acknowledgeAlert(alertId, { reason, note } = {}) {
    const id = String(alertId);
    const sep = id.indexOf("::");
    const patientId = sep === -1 ? id : id.slice(0, sep);
    const kind = sep === -1 ? "" : id.slice(sep + 2);
    await api.acknowledge(patientId, kind);
    await refreshBoard();
  }

  /** Open the live stream with a ticket, so no long-lived credential enters a URL. The store owns
   *  the EventSource lifecycle from here: onopen/onmessage/onerror all update overlay state, and a
   *  dropped stream gets exactly one scheduled reconnect — with a FRESH ticket, because tickets are
   *  single-use and the one that opened the dead connection cannot open another. */
  async function startLive() {
    await refreshBoard();

    let closed = false;
    let reconnectTimer = null;
    let closeSource = () => {};

    function handleMessage(event) {
      let patient;
      let removed;
      try {
        const entry = JSON.parse(event.data);
        removed = entry.removed === true;
        patient = patientFromBoard(entry);
      } catch {
        return; // malformed frame: never crash, never touch the board
      }
      if (patient.patient_id == null) return; // no identity to key on — drop, don't corrupt the list
      const patients = removed
        ? overlay.patients.filter((p) => p.patient_id !== patient.patient_id)
        : mergePatient(overlay.patients, patient);
      setOverlay({
        patients, beds: bedsFromPatients(patients),
        alerts: alertsFromPatients(patients, base.getState().clockSec ?? 0),
      });
      emit();
    }

    function handleError() {
      // Close the dropped source before scheduling the reconnect: a native EventSource auto-retries
      // on its own, with its original — already spent — single-use ticket. Left open, that
      // abandoned connection keeps hitting /stream with a dead ticket (401 noise, a held
      // connection) alongside the fresh one connect() is about to open below.
      closeSource();
      setOverlay({ connection: nextConnection(overlay.connection, { type: "stream-lost" }) });
      emit();
      if (closed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!closed) connect();
      }, RECONNECT_DELAY_MS);
    }

    function handleOpen() {
      setOverlay({ connection: nextConnection(overlay.connection, { type: "stream-open" }) });
      emit();
    }

    async function connect() {
      // A fresh ticket every time: the previous one (if any) is single-use and already spent.
      const { ticket } = await api.streamTicket();
      closeSource = openStream(`/stream?ticket=${encodeURIComponent(ticket)}`, {
        onopen: handleOpen, onmessage: handleMessage, onerror: handleError,
      });
    }

    await connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      closeSource();
    };
  }

  return {
    ...base,
    getState,
    subscribe,
    refreshBoard,
    acknowledgeAlert,
    startLive,

    /** Password step. Resolves to {mfaRequired, enrolled?} — the UI shows the TOTP gate when
     *  mfaRequired, and the enrolment (QR) flow inside it when not yet enrolled. */
    async attemptLogin(login, credential) {
      const tokens = await api.login(login, credential);
      const session = resolveSession(tokens.access_token);
      if (tokens.requires_mfa) {
        // The profile is readable before the MFA step; the gate shows who is enrolling.
        const me = await api.me();
        const enrolled = tokens.mfa_enrolled === true;
        setOverlay({ user: null, mfaPending: pendingMfa(login, me, session, enrolled),
                     sessionError: null });
        emit();
        return { mfaRequired: true, enrolled };
      }
      return openSession(session);
    },

    /** Authenticator step of the LOGIN flow — exchanges the 6-digit code for MFA-verified tokens.
     *  A refused code (401 wrong or replayed, 429 locked) rejects with the API's message and
     *  leaves the gate and the tokens as they are. (`verifyMfa` stays delegated to the
     *  simulation: only its admin-panel MfaModal uses it, never the login flow.) */
    async completeMfaLogin(code) {
      const tokens = await api.verifyTotp(String(code).trim());
      return openSession(resolveSession(tokens.access_token));
    },

    /** Live MFA enrolment: the API mints the secret; the gate shows the QR and the manual key.
     *  Each call ROTATES the secret and ends every refresh token issued before it, so the gate
     *  calls it once per showing (MfaGate's effect does); after a reload the user scans again.
     *  `verifyTotp` stays a plain POST: a wrong code is 401 and must never go through the
     *  refresh-and-retry path, which would spend the now-dead refresh token and log the user out.
     *  429 means the code limit was hit — show the API's message. An enrolled user on a
     *  pending-MFA session gets 403 `mfa_reset_required`; that rejects to the caller too. */
    async setupMfa() {
      const res = await api.setupTotp();
      return {
        provisioningUri: res.provisioning_uri,
        secret: secretFromProvisioningUri(res.provisioning_uri),
      };
    },

    /** Back out of the MFA gate. Overrides the simulation's version, which writes to the base
     *  store — leaving OUR overlay's mfaPending set and the gate stuck on screen. */
    cancelMfaLogin() {
      api.logout();
      setOverlay({ user: null, mfaPending: null, sessionError: null });
      emit();
    },

    changePassword(current, next) {
      return api.changePassword(current, next);
    },

    /** Reopen the session from tokens a previous page load left in storage. A token whose MFA
     *  step is still pending lands on the gate, never in the app. Never rejects.
     *
     *  A browser reload must not sign a clinician out mid-shift, and above all not during an
     *  outage. So the failures are told apart:
     *  - REFUSED (a refresh the server turned down, a 401/403, or a session the UI cannot open):
     *    the tokens are dead. Clear them and leave the login screen — quietly, because "you were
     *    not signed in" is a state, not a fault worth an error banner.
     *  - NOT ANSWERED (5xx, no network): the session may be perfectly good. Keep the tokens, set
     *    `sessionError` (SESSION_UNREACHABLE) for the UI to show; calling this again retries. */
    async restoreSession() {
      if (typeof api.accessToken !== "function" || !api.accessToken()) return false;
      try {
        const me = await api.me();
        const session = resolveSession(api.accessToken());  // reread: me() may have refreshed
        if (session.mfaRequired && !session.mfaVerified) {
          setOverlay({ user: null, sessionError: null,
                       mfaPending: pendingMfa(me.email || me.username, me, session,
                                              me.totp_enabled === true) });
        } else {
          setOverlay({ user: sessionUser(me, session), mfaPending: null, sessionError: null });
        }
        emit();
        return true;
      } catch (err) {
        if (sessionRefused(err)) {
          api.logout();
          setOverlay({ user: null, mfaPending: null, sessionError: null });
        } else {
          setOverlay({ sessionError: {
            code: SESSION_UNREACHABLE,
            message: "Sunucuya ulaşılamıyor; oturumunuz korunuyor. Biraz sonra tekrar deneyin.",
            detail: typeof err?.message === "string" ? err.message : null,
          } });
        }
        emit();
        return false;
      }
    },

    logout() {
      api.logout();
      setOverlay({ user: null, mfaPending: null, sessionError: null });
      emit();
      if (typeof base.logout === "function") base.logout();
    },
  };
}

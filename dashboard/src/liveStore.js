// src/liveStore.js — the seam that puts the real backend behind the clinical UI.
//
// The design (ClinicalDemo) drives a simulation store. This wraps that store and replaces ONLY the
// authentication actions with real API calls, overlaying the resulting session on top of the
// simulated state. Everything the backend does not implement yet keeps working exactly as before,
// so the UI stays whole while the real system grows underneath it, domain by domain.

import { roleFromToken, UNSUPPORTED_ROLE } from "./liveAuth.js";
import { patientFromBoard, patientsFromBoard, bedsFromPatients, alertsFromPatients } from "./liveAdapters.js";
import { CONNECTION, nextConnection } from "./liveConnection.js";

// How long to wait before the ONE reconnect attempt after the stream drops. Not a retry loop:
// each disconnect gets a single scheduled retry, which itself gets a fresh ticket (see connect()
// in startLive() below) — the whole point being that the OLD ticket is spent and cannot be reused.
const RECONNECT_DELAY_MS = 5000;

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
  let overlay = { user: null, mfaPending: null, patients: [], connection: CONNECTION.CONNECTING };
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

  /** Resolve the UI role for a token, refusing anything we cannot represent safely. */
  function resolveRole(accessToken) {
    const role = roleFromToken(accessToken);
    if (role === UNSUPPORTED_ROLE) {
      api.logout();
      throw new Error("Bu hesabın rolü bu arayüzde desteklenmiyor. Sistem yöneticinizle görüşün.");
    }
    if (!role) {
      api.logout();
      throw new Error("Hesabınıza kurum yetkisi tanımlanmamış. Sistem yöneticinizle görüşün.");
    }
    return role;
  }

  /** Fetch the profile and open the session. */
  async function openSession(role) {
    const me = await api.me();
    setOverlay({
      user: { email: me.email, full_name: me.full_name, role },
      mfaPending: null,
    });
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
        alerts: alertsFromPatients(patients),
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
   *  them to go yet. The role is whoever is actually signed in, never invented. */
  async function acknowledgeAlert(alertId, { reason, note } = {}) {
    const id = String(alertId);
    const sep = id.indexOf("::");
    const patientId = sep === -1 ? id : id.slice(0, sep);
    const kind = sep === -1 ? "" : id.slice(sep + 2);
    const role = overlay.user?.role ?? "unknown";
    await api.acknowledge(patientId, kind, role);
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
      try {
        patient = patientFromBoard(JSON.parse(event.data));
      } catch {
        return; // malformed frame: never crash, never touch the board
      }
      if (patient.patient_id == null) return; // no identity to key on — drop, don't corrupt the list
      const patients = mergePatient(overlay.patients, patient);
      setOverlay({ patients, beds: bedsFromPatients(patients), alerts: alertsFromPatients(patients) });
      emit();
    }

    function handleError() {
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

    /** Password step. Resolves to {mfaRequired} — the UI shows the TOTP gate when true. */
    async attemptLogin(email, credential) {
      const tokens = await api.login(email, credential);
      const role = resolveRole(tokens.access_token);

      if (tokens.requires_mfa) {
        // Hold the session closed until the authenticator code verifies.
        setOverlay({ user: null, mfaPending: { email, role, enrolled: true } });
        emit();
        return { mfaRequired: true, enrolled: true };
      }
      return openSession(role);
    },

    /** Authenticator step of the LOGIN flow (the MFA gate) — exchanges the 6-digit code for
     *  MFA-verified tokens. (`verifyMfa` stays delegated to the simulation: that is the admin's
     *  MFA *enrolment* flow, which the backend does not expose yet.) */
    async completeMfaLogin(code) {
      const tokens = await api.verifyTotp(String(code).trim());
      return openSession(resolveRole(tokens.access_token));
    },

    logout() {
      api.logout();
      setOverlay({ user: null, mfaPending: null });
      emit();
      if (typeof base.logout === "function") base.logout();
    },
  };
}

// src/liveStore.js — the seam that puts the real backend behind the clinical UI.
//
// The design (ClinicalDemo) drives a simulation store. This wraps that store and replaces ONLY the
// authentication actions with real API calls, overlaying the resulting session on top of the
// simulated state. Everything the backend does not implement yet keeps working exactly as before,
// so the UI stays whole while the real system grows underneath it, domain by domain.

import { roleFromToken, UNSUPPORTED_ROLE } from "./liveAuth.js";
import { patientsFromBoard } from "./liveAdapters.js";
import { CONNECTION, nextConnection } from "./liveConnection.js";

/** Real SSE opener. `ticket` is a short-lived, single-use credential — never a JWT — because
 *  EventSource cannot send headers and a bearer token in the URL would leak into server logs,
 *  browser history and any Referer header the browser sends onward. */
function defaultOpenStream(url) {
  if (typeof EventSource === "undefined") return () => {};   // no SSE (e.g. jsdom) -> no-op
  const source = new EventSource(url);
  return () => source.close();
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
   *  credentials must see "no data" on a failed fetch, not invented patients. */
  async function refreshBoard() {
    try {
      const board = await api.boardPatients();
      setOverlay({
        patients: patientsFromBoard(board),
        connection: nextConnection(overlay.connection, { type: "loaded" }),
      });
    } catch {
      setOverlay({
        patients: [],
        connection: nextConnection(overlay.connection, { type: "failed" }),
      });
    }
    emit();
  }

  async function acknowledgeAlert(patientId, kind, role) {
    await api.acknowledge(patientId, kind, role);
    await refreshBoard();
  }

  /** Open the live stream with a ticket, so no long-lived credential enters a URL. */
  async function startLive() {
    await refreshBoard();
    const { ticket } = await api.streamTicket();
    return openStream(`/stream?ticket=${encodeURIComponent(ticket)}`);
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

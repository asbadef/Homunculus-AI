// src/liveStore.js — the seam that puts the real backend behind the clinical UI.
//
// The design (ClinicalDemo) drives a simulation store. This wraps that store and replaces ONLY the
// authentication actions with real API calls, overlaying the resulting session on top of the
// simulated state. Everything the backend does not implement yet keeps working exactly as before,
// so the UI stays whole while the real system grows underneath it, domain by domain.

import { roleFromToken, UNSUPPORTED_ROLE } from "./liveAuth.js";

export function createLiveStore({ api, base }) {
  // Session state owned by us; the rest of the state still comes from the simulation.
  let overlay = { user: null, mfaPending: null };
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };

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
    overlay = {
      user: { email: me.email, full_name: me.full_name, role },
      mfaPending: null,
    };
    emit();
    return { mfaRequired: false };
  }

  return {
    ...base,
    getState,
    subscribe,

    /** Password step. Resolves to {mfaRequired} — the UI shows the TOTP gate when true. */
    async attemptLogin(email, credential) {
      const tokens = await api.login(email, credential);
      const role = resolveRole(tokens.access_token);

      if (tokens.requires_mfa) {
        // Hold the session closed until the authenticator code verifies.
        overlay = { user: null, mfaPending: { email, role, enrolled: true } };
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
      overlay = { user: null, mfaPending: null };
      emit();
      if (typeof base.logout === "function") base.logout();
    },
  };
}

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

  /**
   * Send a charted clinical fact to the engine, then refresh so the board shows what it did.
   *
   * The simulation's versions of these write to the local store and stop there — which is what
   * they were for. On a live ward that silence was the bug: a physician charted noradrenaline,
   * the engine never saw it, and the cardiovascular limb of SOFA stayed at zero on a patient
   * who was on pressors. `base` is still updated so the screen the clinician is looking at
   * responds immediately; the board then arrives with the engine's own view.
   */
  /**
   * "DM, HT, KOAH" -> ["dm", "ht", "koah"].
   *
   * The admission form's comorbidity box is free text, and it is worth taking seriously: only
   * some of what a clinician writes there maps to a rule (COPD explains a standing +2 for
   * oxygen), but the rest is context for whoever reads the card next. Splitting on commas and
   * semicolons keeps both, and drops neither.
   */
  function splitComorbidities(raw) {
    if (Array.isArray(raw)) raw = raw.join(",");
    return String(raw || "")
      .split(/[,;/]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * One engine audit record in the shape the existing audit screen renders.
   *
   * The screen was already written, with filters and CSV export, reading the simulation's own
   * `auditLog`. On a live ward that meant the audit page showed what had happened in THIS
   * BROWSER while the real append-only record sat unreachable — which is worse than no page at
   * all, because it implies the record is what you are looking at.
   */
  function auditRowFromRecord(record) {
    const payload = record?.payload ?? {};
    // Who did it, when the record names someone. `charted_by` is a clinician; `by` comes from
    // an acknowledgement; ingest is a device and has neither.
    const actor = payload.charted_by || payload.by || payload.device || "—";
    const detail = Object.entries(payload)
      .filter(([key]) => !["charted_by", "by", "device"].includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .join(" · ");
    return {
      atMs: Date.parse(record?.ts) || 0,
      action: record?.event_type || "—",
      actor,
      role: "",
      target: [record?.patient_id, record?.subject].filter(Boolean).join(" · "),
      detail,
      id: record?.id,
    };
  }

  /**
   * Replace the audit view with the engine's record.
   *
   * Replaces rather than merges: mixing browser-local events into a legal record would make it
   * impossible to say afterwards which rows the engine actually holds.
   */
  async function refreshAudit(filters = {}) {
    if (typeof api.audit !== "function") return null;
    const { records } = await api.audit(filters);
    const rows = (records || []).map(auditRowFromRecord).sort((a, b) => a.atMs - b.atMs);
    setOverlay({ auditLog: rows });
    emit();
    return rows;
  }

  async function chart(patientId, entries) {
    if (!patientId || !entries?.length) return null;
    const result = await api.chart(patientId, entries);
    await refreshBoard();
    return result;
  }

  return {
    ...base,
    getState,
    subscribe,
    refreshBoard,
    acknowledgeAlert,
    startLive,
    chart,
    refreshAudit,

    /** The severity form, filled from the engine's record. Unsigned. */
    async severityForm(patientId, options) {
      return api.severityForm(patientId, options);
    },

    /** Sign it. The engine refuses an unidentified signer and a correction with no reason. */
    async signSeverityForm(patientId, options) {
      return api.signSeverityForm(patientId, options);
    },

    /** Alarm fatigue, measured. Passed through unchanged — including `answered_rate: null`,
     *  which means "nothing has settled yet" and must never be rendered as 0%. */
    async alarmQuality(days = 7) {
      return api.alarmQuality(days);
    },

    /** The integrity check an inspection actually asks for. Passes the engine's verdict through
     *  untouched — a UI that softened "broken" into "warning" would be the wrong kind of help. */
    async verifyAudit(limit = 10000) {
      return api.verifyAudit(limit);
    },

    /** Charted by the physician: infection suspected, or no longer suspected. */
    async setSuspectedInfection(patientId, suspected = true) {
      return chart(patientId, [{ code: "suspected_infection", value: suspected ? 1 : 0 }]);
    },

    /** A vasopressor/inotrope rate in ug/kg/min. Also updates the simulation's own timeline so
     *  the medication list the clinician just typed into does not appear to forget it. */
    async addMedication(entry) {
      const RATES = {
        noradrenalin: "norepinephrine_rate", norepinefrin: "norepinephrine_rate",
        adrenalin: "epinephrine_rate", epinefrin: "epinephrine_rate",
        dopamin: "dopamine_rate", dobutamin: "dobutamine_rate",
      };
      const code = RATES[String(entry?.name || "").trim().toLowerCase()];
      if (typeof base.addMedication === "function") base.addMedication(entry);
      if (!code || entry?.dose == null) return null;   // not a rate we score; charted locally only
      return chart(entry.patientId, [{ code, value: Number(entry.dose) }]);
    },

    /**
     * Admission. The form already asks for the two things the rules have been missing —
     * weight, and the chronic conditions — and until now both stopped at the browser. Weight
     * is charted as an observation (nothing can evaluate "30 mL/kg" without it); the chronic
     * conditions become the patient's profile, which is what stops a chronic-AF patient
     * alarming on every measurement.
     *
     * The admission itself still runs locally: the API has no admission endpoint wired yet.
     * A failure to chart must not lose the admission the clinician just completed, so each
     * side-channel is attempted independently and its failure reported, not thrown.
     */
    admitPatient(form = {}) {
      // SYNCHRONOUS on purpose. The admission form reads `p.protocolNo` off the return value
      // and catches "bed unavailable" in a try/catch on the same tick; returning a promise
      // would blank the confirmation and turn a validation error into an unhandled rejection.
      // The admission is also the clinician's, not the network's — it must not wait on a POST.
      const patient = typeof base.admitPatient === "function" ? base.admitPatient(form) : null;
      const patientId = patient?.patient_id || form.patient_id;
      if (!patientId) return patient;

      // Side channels, fired and not awaited. Each failure is swallowed on purpose: the
      // admission has already succeeded and must not be undone by a POST that did not, and
      // both of these can be charted again from the patient's own screen.
      if (form.weight != null && form.weight !== "") {
        Promise.resolve()
          .then(() => chart(patientId, [{ code: "weight_kg", value: Number(form.weight) }]))
          .catch(() => {});
      }
      const comorbidities = splitComorbidities(form.comorbidities);
      if (comorbidities.length) {
        Promise.resolve()
          .then(() => api.setProfile(patientId, { comorbidities }))
          .catch(() => {});
      }
      return patient;
    },

    /** The patient's own normal — charted ranges and chronic conditions. */
    async setProfile(patientId, profile) {
      const result = await api.setProfile(patientId, profile);
      await refreshBoard();
      return result;
    },

    /** Fluid in. Only intake reaches the engine: "30 mL/kg given" is what the shock rule asks. */
    async addFluid(entry) {
      if (typeof base.addFluid === "function") base.addFluid(entry);
      if (entry?.kind !== "in" || entry?.ml == null) return null;
      return chart(entry.patientId, [{ code: "crystalloid_bolus_ml", value: Number(entry.ml) }]);
    },

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

    /** Reopen the session from tokens a previous page load left in storage. A browser refresh
     *  must not log a clinician out mid-shift: `api.me()` rides the stored access token (and
     *  backendApi refreshes it once if it has expired); any failure clears the stale tokens and
     *  leaves the login screen showing — quietly, because "you were not signed in" is a state,
     *  not a fault worth an error banner. */
    async restoreSession() {
      if (typeof api.accessToken !== "function" || !api.accessToken()) return false;
      try {
        const me = await api.me();
        const role = resolveRole(api.accessToken());  // reread: me() may have refreshed the token
        setOverlay({ user: { email: me.email, full_name: me.full_name, role }, mfaPending: null });
        emit();
        return true;
      } catch {
        api.logout();
        return false;
      }
    },

    logout() {
      api.logout();
      setOverlay({ user: null, mfaPending: null });
      emit();
      if (typeof base.logout === "function") base.logout();
    },
  };
}

// src/liveStore.js — the seam that puts the real backend behind the clinical UI.
//
// The design (ClinicalDemo) drives a simulation store. This wraps that store and replaces the
// actions the backend implements (authentication, the board, acknowledgements, administration,
// clinical charting, the audit) with real API calls, overlaying the resulting state on top of
// the simulated state. The simulation's other actions are REFUSED here (LIVE_UNAVAILABLE): in
// live mode nothing may write to the simulation as if it were the ward, and the UI hides the
// controls that would call them.
// Only a few reads and a display preference pass through (LIVE_SAFE_SIMULATION).

import {
  sessionFromToken, accessProblem, secretFromProvisioningUri, NO_PERMISSIONS, NO_BOARD_ACCESS,
} from "./liveAuth.js";
import { uiRoleFromPerms, hasAny } from "./permissions.js";
import { patientFromBoard, patientsFromBoard, bedsFromPatients, alertsFromPatients } from "./liveAdapters.js";
import { userFromApi, groupFromApi } from "./liveAdmin.js";
import { CONNECTION, nextConnection } from "./liveConnection.js";

// How long to wait before the ONE reconnect attempt after the stream drops. Not a retry loop:
// each disconnect gets a single scheduled retry, which itself gets a fresh ticket (see connect()
// in startLive() below) — the whole point being that the OLD ticket is spent and cannot be reused.
const RECONNECT_DELAY_MS = 5000;

/** `state.sessionError.code` when a stored session could not be checked because the server did
 *  not answer. The tokens are kept; calling restoreSession() again retries. */
export const SESSION_UNREACHABLE = "SESSION_UNREACHABLE";

/** `err.code` of a simulation action called in live mode. */
export const LIVE_UNAVAILABLE = "LIVE_UNAVAILABLE";
const LIVE_UNAVAILABLE_MESSAGE = "Bu işlem canlı sistemde henüz yok; yalnızca simülasyonda çalışır.";

/** The simulation's actions that write only to the simulation. In live mode each one throws
 *  LIVE_UNAVAILABLE instead: a screen that calls one shows the translated reason, and nothing is
 *  written to the simulated ward. liveStore.test.js fails when the simulation gains a function
 *  that is in neither this list nor LIVE_SAFE_SIMULATION, nor one the live store implements. */
export const SIMULATION_ONLY = Object.freeze([
  // sessions and staff of the simulation
  "login", "loginAs", "switchUserByPin", "createUser", "setUserRole", "setUserPassword",
  "resetUserPin", "toggleUserActive", "resetUserMfa", "setUserMfaRequired", "setUserUnits",
  "verifyMfa", "inviteUser", "acceptInvite", "resendInvite", "cancelInvite",
  "terminateSession", "terminateAllUserSessions", "assignStaffToBeds", "toggleStaffBed",
  // hospital structure and devices
  "createTenant", "createSite", "completeTenantSetup", "addUnit", "addRoom", "addBed",
  "setBedState", "updateDevice", "addDevice", "assignDeviceToBed",
  // patients, admission, transfer, care team, handover
  "admitPatient", "transferPatient", "assignCareTeam", "createHandover", "initiateDischarge",
  "confirmDischarge", "initiateTransfer", "acceptTransfer", "completeTransfer",
  "archivePatient", "anonymizePatient", "revealPhiField",
  "generateShiftHandover", "signShiftHandover",
  // clinical record and results
  "addDiagnosis", "addMedication", "stopMedication", "addProcedure", "addFluid", "setThresholds",
  "addResult", "markResultReviewed", "toggleHisIntegration", "simulateInboundResult",
  // alarms, call for help, break-glass
  "fireAlert", "muteAlert", "snoozeAlert", "escalateToRRT", "activateRRT", "resolveRRT",
  "classifyAlert", "logNotification", "markNotificationRead",
  "activateBreakGlass", "extendBreakGlass", "reviewBreakGlass",
  // the simulation's own machinery
  "setOnline", "queueOffline", "flushSyncQueue", "setAutoAlarm", "setSpeed", "setRunning", "reset",
  "recordTestPush", "createReportTemplate", "generateReport", "captureKpiSnapshot",
  "recordQualityMetric",
  // institution policy (main's Sistem Ayarları): written to the simulation's settings only
  "setEscalationTier", "setShiftPattern", "setPrivacyPolicy",
]);

/** The simulation's functions the live store passes through unchanged: reads a hidden screen
 *  may still render (they must never throw during a render), and the name-masking display
 *  preference, which changes only what this screen shows. */
export const LIVE_SAFE_SIMULATION = Object.freeze([
  "openCriticalAlerts", "deviceForBed", "rrtHasAccess", "breakGlassActive", "computeHeatmap",
  "toggleMaskNames",
]);

function refusedInLive(name) {
  return () => {
    const err = new Error(LIVE_UNAVAILABLE_MESSAGE);
    err.code = LIVE_UNAVAILABLE;
    err.action = name;
    throw err;
  };
}

// Why a session was refused, per accessProblem() reason. A reason missing here still refuses
// (resolveSession fails closed), with the generic message.
const REFUSAL_MESSAGES = new Map([
  [NO_PERMISSIONS, "Hesabınıza kurum yetkisi tanımlanmamış. Sistem yöneticinizle görüşün."],
  [NO_BOARD_ACCESS, "Panoya erişim yetkiniz yok. Sistem yöneticinizle görüşün."],
]);
const REFUSED_GENERIC = "Bu hesapla oturum açılamıyor. Sistem yöneticinizle görüşün.";

// Administration state lives under its own keys so the simulation's `users` is untouched (the
// simulated admission/care pickers still read it in live mode; they are not backed). Empty until
// loadAdmin(), and emptied again when the session ends: a shared ward workstation must not show
// the previous administrator's staff list to whoever signs in next.
const ADMIN_EMPTY = Object.freeze({
  adminUsers: [], adminGroups: [], adminPermissions: [], adminError: null,
});

// The clinical data a session loaded, emptied when it ends for the same reason: on a shared ward
// workstation the next person to sign in — or the login screen in between — must not see the
// previous session's patients, its scope note or the engine audit it read.
const SESSION_DATA_EMPTY = Object.freeze({
  patients: [], beds: [], alerts: [], devices: [], engineScope: null, scopeNote: null, auditLog: [],
});

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
    // The simulation's clock (60x) and its automatic alarm engine are stopped: a real alarm's age
    // is wall-clock time (alertsFromPatients), and every alarm on screen is the backend's. The
    // store's reconcile() is a no-op for the same reason (see the returned object).
    running: false,
    autoAlarm: false,
    // Set by restoreSession() when the server could not be reached ({code, message, detail});
    // null otherwise. See SESSION_UNREACHABLE.
    sessionError: null,
    // True while restoreSession() checks a stored session: the login form waits, since a sign-in
    // made meanwhile would race it for the tokens.
    sessionRestoring: false,
    ...ADMIN_EMPTY,
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

  /** The UI's user object. `role` is DISPLAY ONLY (icons, labels); gating uses `perms`. `id` is
   *  the account's, for the admin rules that never let you reset or deactivate yourself. `email`
   *  can be null (UserMeResponse.email); the UI shows the username then. */
  function sessionUser(me, session) {
    const groups = Array.isArray(me.groups) ? me.groups : [];
    return {
      id: me.id, email: me.email, username: me.username, full_name: me.full_name,
      role: uiRoleFromPerms(session.perms),
      perms: session.perms, groups: session.groups,
      groupNames: groups.map((g) => g.name),
      // The hospital the session is in (the token's slug): the top bar shows it in live mode.
      tenant: typeof me.tenant === "string" && me.tenant.trim() ? me.tenant : session.tenant,
    };
  }

  // ---------------------------------------------------------------- the session's lifetime
  // Bumped whenever a session begins or ends. A call that started under an older session drops
  // its answer instead of applying it: a restore that finishes after a new sign-in must neither
  // show the old account's name nor wipe the new session's tokens.
  let sessionEpoch = 0;
  const nextEpoch = () => { sessionEpoch += 1; return sessionEpoch; };

  /** Sign out locally: tokens, the session, the administration and clinical data. */
  function endSession() {
    nextEpoch();
    api.logout();
    clearAdmin();
    setOverlay({ user: null, mfaPending: null, sessionError: null, ...SESSION_DATA_EMPTY });
    emit();
    if (typeof base.logout === "function") base.logout();
  }

  // ---------------------------------------------------------------- the session's rights
  // `user.perms` is a HINT for the UI (navigation, the admin panels); the server decides every
  // call. It must not outlive what it was read from, though. backendApi refreshes the access
  // token transparently (a 401, /auth/refresh, a retry), and a refreshed token carries the
  // rights of the CURRENT groups; syncRights() re-reads them after every call the store makes.
  // refreshRights() reads the database's rights from /auth/me, which the admin rules check.

  // The access token `user.perms` was last read from; null = not yet (the next call reads it).
  let rightsToken = null;
  // Group names by slug, from the last profile: a token names groups by slug only.
  let groupNameBySlug = new Map();

  const currentToken = () => (typeof api.accessToken === "function" ? api.accessToken() : null);
  const sameList = (a, b) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

  /** Remember the profile's group names and read the rights from the current token again. */
  function rememberProfile(me) {
    const groups = Array.isArray(me?.groups) ? me.groups : [];
    groupNameBySlug = new Map(groups.filter((g) => g && typeof g.slug === "string")
      .map((g) => [g.slug, g.name]));
    rightsToken = null;
  }

  /** The user with these rights, or the same object when nothing changed (a new object would
   *  look like a new session to whatever watches `state.user`). */
  function withRights(user, perms, groups, names) {
    const nextNames = names ?? groups.map((slug) => groupNameBySlug.get(slug) ?? slug);
    if (sameList(user.perms ?? [], perms) && sameList(user.groups ?? [], groups)
        && (user.groupNames ?? []).join("\n") === nextNames.join("\n")) {
      return user;
    }
    return { ...user, role: uiRoleFromPerms(perms), perms, groups, groupNames: nextNames };
  }

  /** Re-read the rights when the access token changed since they were read. True if the user
   *  changed (the caller emits). A token the UI cannot read changes nothing: the server still
   *  checks every request, so this fails closed either way. */
  function syncRights() {
    const token = currentToken();
    if (!overlay.user || !token || token === rightsToken) return false;
    const session = sessionFromToken(token);
    if (!session) return false;
    rightsToken = token;
    const user = withRights(overlay.user, session.perms, session.groups);
    if (user === overlay.user) return false;
    setOverlay({ user });
    return true;
  }

  /** Run one API call, then re-read the rights: a 401 inside it may have refreshed the token.
   *  Also after a refusal, whose refresh may have brought narrower rights. A refresh the server
   *  REFUSED (`sessionEnded`: backendApi has already dropped the tokens) ends the session here,
   *  so the clinician lands on the login screen rather than in a tokenless app that only ever
   *  says "reconnecting". A server that did not answer (5xx, network, REQUEST_TIMEOUT) never
   *  ends it. The error still reaches the caller. */
  async function tracked(call) {
    const epoch = sessionEpoch;
    try {
      return await call();
    } catch (err) {
      // Only the session the call was made under: a stale call's end is not a newer session's.
      if (err?.sessionEnded === true && epoch === sessionEpoch && (overlay.user || overlay.mfaPending)) {
        endSession();
      }
      throw err;
    } finally {
      if (syncRights()) emit();
    }
  }

  function pendingMfa(login, me, session, enrolled) {
    return {
      email: login, full_name: me.full_name, role: uiRoleFromPerms(session.perms),
      groupNames: (Array.isArray(me.groups) ? me.groups : []).map((g) => g.name),
      enrolled, live: true,
    };
  }

  /** Fetch the profile and open the session, unless another session began or ended meanwhile. */
  async function openSession(session, epoch = sessionEpoch) {
    const me = await api.me();
    if (epoch !== sessionEpoch) return { mfaRequired: false, superseded: true };
    clearAdmin();
    rememberProfile(me);
    setOverlay({ user: sessionUser(me, session), mfaPending: null, sessionError: null });
    syncRights();                  // me() may have refreshed the token the session came from
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
   *  exists to prevent.
   *
   *  An answer that arrives after the session changed (signed out, or someone else signed in on
   *  this workstation) belongs to the old session and is dropped, whatever it says. */
  async function refreshBoard() {
    const epoch = sessionEpoch;
    let board;
    let patients = null;          // null: the load failed (the adapter included)
    try {
      board = await tracked(() => api.boardPatients());
      patients = patientsFromBoard(board);
    } catch { /* patients stays null */ }
    if (epoch !== sessionEpoch) return;
    if (patients) {
      setOverlay({
        patients,
        beds: bedsFromPatients(patients),
        alerts: alertsFromPatients(patients),
        devices: [],
        // Motorun uyguladığı kapsam, listeyle birlikte. Bu blok olmadan boş bir pano ile sakin
        // bir koğuş aynı görünür — ve bu ikisini ayırt edemeyen bir hemşire, kapsam işinin
        // önlemek için var olduğu tehlikenin ta kendisidir.
        engineScope: board?.scope ?? null,
        scopeNote: board?.scope_note ?? null,
        connection: nextConnection(overlay.connection, { type: "loaded" }),
      });
    } else {
      setOverlay({
        patients: [],
        beds: [],
        alerts: [],
        devices: [],
        // Başarısız bir istekte kapsam da düşer. Eski bir kapsam bloğu, boş bir panoyu
        // "kapsamınız bu kadar" diye açıklardı — oysa sebep bağlantının kopmuş olması.
        engineScope: null,
        scopeNote: null,
        connection: nextConnection(overlay.connection, { type: "failed" }),
      });
    }
    syncRights();
    emit();
  }

  /** AckModal calls this as `store.acknowledgeAlert(alert.id, {reason, note})` and must not
   *  change — alert.id is "<patient_id>::<kind>" (alertsFromPatients). `reason`/`note` are not
   *  forwarded: the backend's AckStore keeps only {by, at} in this slice, so there is nowhere for
   *  them to go yet, and in live mode the dialog does not ask for them. The actor is attributed by the API from the signed token, never sent from
   *  here. A refusal (403 "permission required: alerts.ack") rejects with the API's message for
   *  the caller to show; the board is not reloaded, since nothing was acknowledged.
   *
   *  It resolves as soon as the API took the acknowledgement; the board reload that follows is
   *  not awaited, so a slow reload never keeps the dialog waiting on an ack already recorded.
   *  refreshBoard() never rejects. */
  async function acknowledgeAlert(alertId, { reason, note } = {}) {
    const id = String(alertId);
    const sep = id.indexOf("::");
    const patientId = sep === -1 ? id : id.slice(0, sep);
    const kind = sep === -1 ? "" : id.slice(sep + 2);
    await tracked(() => api.acknowledge(patientId, kind));
    void refreshBoard();
  }

  /** Open the live stream with a ticket, so no long-lived credential enters a URL. The store owns
   *  the EventSource lifecycle from here: onopen/onmessage/onerror all update overlay state, and a
   *  dropped stream gets exactly one scheduled reconnect — with a FRESH ticket, because tickets are
   *  single-use and the one that opened the dead connection cannot open another. */
  async function startLive() {
    const epoch = sessionEpoch;
    await refreshBoard();
    // The board load found the session ended (and signed out): there is nothing to stream.
    if (epoch !== sessionEpoch) return () => {};

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
        alerts: alertsFromPatients(patients),
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
        // connect() handles its own failures; the catch only keeps a surprise from becoming an
        // unhandled rejection in a timer nobody awaits.
        if (!closed) connect().catch(() => {});
      }, RECONNECT_DELAY_MS);
    }

    function handleOpen() {
      setOverlay({ connection: nextConnection(overlay.connection, { type: "stream-open" }) });
      emit();
    }

    /** Never rejects. A ticket that cannot be had (a 5xx; 503 when the server cannot read the
     *  caller's scope; no network) means no stream: the board loaded a moment ago is about to
     *  freeze, so it must not keep saying LIVE. It goes the dropped-stream way instead —
     *  DEGRADED, and the single scheduled reconnect with a fresh ticket. Not when the stream was
     *  closed meanwhile, or the session it was opened for has ended (tracked() signs out on a
     *  refused refresh): there is nothing to reconnect for then. */
    async function connect() {
      try {
        // A fresh ticket every time: the previous one (if any) is single-use and already spent.
        const { ticket } = await tracked(() => api.streamTicket());
        if (closed) return;          // closed while the ticket was on its way: open nothing
        closeSource = openStream(`/stream?ticket=${encodeURIComponent(ticket)}`, {
          onopen: handleOpen, onmessage: handleMessage, onerror: handleError,
        });
      } catch {
        if (closed || epoch !== sessionEpoch) return;
        handleError();
      }
    }

    await connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      closeSource();
    };
  }

  // ---------------------------------------------------------------- administration (/admin)

  // Bumped by every load and by clearAdmin(): a load that finishes after a newer one started, or
  // after the session ended, is dropped instead of overwriting what is on screen.
  let adminLoadSeq = 0;

  function clearAdmin() {
    adminLoadSeq += 1;
    setOverlay(ADMIN_EMPTY);
  }

  /** Load users, groups and the catalogue. Never rejects. A refused call (403) leaves the others
   *  loaded and the reason in `adminError`. It asks only for what the session's perms cover (the
   *  routes in admin/router.py): the users with users.manage, the groups with users.manage or
   *  groups.manage, the catalogue with groups.manage. So a user desk sees users and groups, and
   *  no refusal for the catalogue it may not read. Without a session it asks for all three and
   *  lets the server answer. */
  async function loadAdmin() {
    const seq = ++adminLoadSeq;
    const perms = overlay.user?.perms;
    const may = (...keys) => !Array.isArray(perms) || hasAny(perms, keys);
    // Not asked: an empty list, no error. Promise.resolve().then turns a synchronous throw into
    // a rejection, so allSettled sees every failure.
    const ask = (allowed, call) => (allowed ? Promise.resolve().then(call) : Promise.resolve([]));
    const [users, groups, catalogue] = await Promise.allSettled([
      ask(may("users.manage"), () => tracked(() => api.adminUsers())),
      ask(may("users.manage", "groups.manage"), () => tracked(() => api.adminGroups())),
      ask(may("groups.manage"), () => tracked(() => api.adminPermissions())),
    ]);
    if (seq !== adminLoadSeq) return;           // superseded by a newer load or a sign-out
    syncRights();
    const list = (r, adapt) => (r.status === "fulfilled" && Array.isArray(r.value)
      ? (adapt ? r.value.map(adapt) : r.value) : []);
    const failed = [users, groups, catalogue].find((r) => r.status === "rejected");
    setOverlay({
      adminUsers: list(users, userFromApi),
      adminGroups: list(groups, groupFromApi),
      adminPermissions: list(catalogue),
      adminError: failed ? (failed.reason?.message || String(failed.reason)) : null,
    });
    emit();
  }

  /** Run an admin call, then reload so the screen shows what the server now holds. A refusal
   *  (403 beyond your rights; 409 last administrator, shared account, yourself, system group;
   *  422 validation; 404) rejects with the API's error as it is, its message and `status`, for
   *  the panel to show. Nothing is reloaded then, since nothing changed. backendApi has already
   *  refreshed once on a 401 (a request queued behind the caller's own demotion) and never
   *  refreshes on a 403 or 409. */
  const thenReload = async (call) => {
    const result = await tracked(call);
    await loadAdmin();
    return result;
  };

  /** A group from the editor ({id?, slug, name, description, mfaRequired, isSystem, permissions})
   *  onto the API. The system group's rights and MFA rule are fixed (409), so only its name and
   *  description are sent. The slug is set at creation and never changes. */
  function saveGroup(g) {
    if (!g.id) {
      return api.adminCreateGroup({ slug: g.slug, name: g.name, description: g.description,
                                    mfa_required: g.mfaRequired, permissions: g.permissions });
    }
    const labels = { name: g.name, description: g.description };
    return api.adminUpdateGroup(g.id, g.isSystem === true ? labels
      : { ...labels, mfa_required: g.mfaRequired, permissions: g.permissions });
  }

  // Restores in flight (a newer one may start while an older one still waits for its answer).
  let restoresInFlight = 0;

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
    const epoch = sessionEpoch;
    const { records } = await tracked(() => api.audit(filters));
    if (epoch !== sessionEpoch) return null;     // the old session's record: not shown to the next
    const rows = (records || []).map(auditRowFromRecord).sort((a, b) => a.atMs - b.atMs);
    setOverlay({ auditLog: rows });
    emit();
    return rows;
  }

  /**
   * Send a charted clinical fact to the engine, then refresh so the board shows what it did.
   *
   * The simulation's versions of these write to the local store and stop there — which is what
   * they were for. On a live ward that silence was the bug: a physician charted noradrenaline,
   * the engine never saw it, and the cardiovascular limb of SOFA stayed at zero on a patient
   * who was on pressors. The board is reloaded afterwards, so the screen shows the engine's
   * own view. The simulation's medication, fluid and admission actions stay refused here
   * (SIMULATION_ONLY): they wrote to the simulated ward, and the new shell charts through this.
   */
  async function chart(patientId, entries) {
    if (!patientId || !entries?.length) return null;
    const result = await tracked(() => api.chart(patientId, entries));
    await refreshBoard();
    return result;
  }

  return {
    ...base,
    ...Object.fromEntries(SIMULATION_ONLY.map((name) => [name, refusedInLive(name)])),
    getState,
    subscribe,
    /** The simulation's clock does not run against the real backend (see `running`). */
    reconcile() {},
    refreshBoard,
    acknowledgeAlert,
    startLive,
    chart,
    refreshAudit,

    /** The severity form, filled from the engine's record. Unsigned. */
    async severityForm(patientId, options) {
      return tracked(() => api.severityForm(patientId, options));
    },

    /** Sign it. The engine refuses an unidentified signer and a correction with no reason. */
    async signSeverityForm(patientId, options) {
      return tracked(() => api.signSeverityForm(patientId, options));
    },

    /** Alarm fatigue, measured. Passed through unchanged — including `answered_rate: null`,
     *  which means "nothing has settled yet" and must never be rendered as 0%. */
    async alarmQuality(days = 7) {
      return tracked(() => api.alarmQuality(days));
    },

    /** The integrity check an inspection actually asks for. Passes the engine's verdict through
     *  untouched — a UI that softened "broken" into "warning" would be the wrong kind of help. */
    async verifyAudit(limit = 10000) {
      return tracked(() => api.verifyAudit(limit));
    },

    /** Kapsamı atanmamış kaç kullanıcı var — yöneticinin yapacak işi olduğunu söyleyen sayı. */
    async unassignedScopes() {
      return tracked(() => api.unassignedScopes());
    },

    /** The Infinity research window: every monitored bed's decoded parameter records, with
     *  the device's own validity flag and alarm limits. Candidate values, never observations —
     *  passed through untouched so the page can show "device reports invalid" as exactly that. */
    async researchState() {
      return tracked(() => api.request("/infinity-research/state"));
    },

    /** Charted by the physician: infection suspected, or no longer suspected. */
    async setSuspectedInfection(patientId, suspected = true) {
      return chart(patientId, [{ code: "suspected_infection", value: suspected ? 1 : 0 }]);
    },

    /** The patient's own normal — charted ranges and chronic conditions. */
    async setProfile(patientId, profile) {
      const result = await tracked(() => api.setProfile(patientId, profile));
      await refreshBoard();
      return result;
    },

    loadAdmin,
    adminCreateUser: (body) => thenReload(() => api.adminCreateUser(body)),
    adminUpdateUser: (id, body) => thenReload(() => api.adminUpdateUser(id, body)),
    adminSetUserGroups: (id, groupIds) => thenReload(() => api.adminSetUserGroups(id, groupIds)),
    /** Nothing on screen changes with a password, so nothing is reloaded. */
    adminResetPassword: (id, password) => tracked(() => api.adminResetPassword(id, password)),
    adminResetMfa: (id) => thenReload(() => api.adminResetMfa(id)),
    adminSaveGroup: (g) => thenReload(() => saveGroup(g)),
    adminDeleteGroup: (id) => thenReload(() => api.adminDeleteGroup(id)),

    /** Password step. Resolves to {mfaRequired, enrolled?} — the UI shows the TOTP gate when
     *  mfaRequired, and the enrolment (QR) flow inside it when not yet enrolled. */
    async attemptLogin(login, credential) {
      const epoch = nextEpoch();          // a restore still in flight drops its answer
      const tokens = await api.login(login, credential);
      const session = resolveSession(tokens.access_token);
      if (tokens.requires_mfa) {
        // The profile is readable before the MFA step; the gate shows who is enrolling.
        const me = await api.me();
        if (epoch !== sessionEpoch) return { mfaRequired: true, superseded: true };
        const enrolled = tokens.mfa_enrolled === true;
        setOverlay({ user: null, mfaPending: pendingMfa(login, me, session, enrolled),
                     sessionError: null });
        emit();
        return { mfaRequired: true, enrolled };
      }
      return openSession(session, epoch);
    },

    /** Authenticator step of the LOGIN flow — exchanges the 6-digit code for MFA-verified tokens.
     *  A refused code (401 wrong or replayed, 429 locked) rejects with the API's message and
     *  leaves the gate and the tokens as they are. (`verifyMfa` stays delegated to the
     *  simulation: only its admin-panel MfaModal uses it, never the login flow.) */
    async completeMfaLogin(code) {
      const epoch = sessionEpoch;
      const tokens = await api.verifyTotp(String(code).trim());
      if (epoch !== sessionEpoch) return { mfaRequired: false, superseded: true };
      return openSession(resolveSession(tokens.access_token), epoch);
    },

    /** Live MFA enrolment: the API mints the secret; the gate shows the QR and the manual key.
     *  Each call ROTATES the secret and ends every refresh token issued before it, so the gate
     *  calls it once per showing (MfaGate's effect does); after a reload the user scans again.
     *  `verifyTotp` stays a plain POST: a wrong code is 401 and must never go through the
     *  refresh-and-retry path, which would spend the now-dead refresh token and log the user out.
     *  429 means the code limit was hit — show the API's message. An enrolled user on a
     *  pending-MFA session gets 403 `mfa_reset_required`; that rejects to the caller too. */
    async setupMfa() {
      const res = await tracked(() => api.setupTotp());
      return {
        provisioningUri: res.provisioning_uri,
        secret: secretFromProvisioningUri(res.provisioning_uri),
      };
    },

    /** Back out of the MFA gate. Overrides the simulation's version, which writes to the base
     *  store — leaving OUR overlay's mfaPending set and the gate stuck on screen. */
    cancelMfaLogin() {
      nextEpoch();
      api.logout();
      clearAdmin();
      setOverlay({ user: null, mfaPending: null, sessionError: null, ...SESSION_DATA_EMPTY });
      emit();
    },

    /** The user's own password. The API answers with a fresh token pair (backendApi stores it),
     *  whose rights are read here. A refusal — the current password wrong, the new one too short,
     *  an Active Directory account — rejects with the API's message for the dialog to show. */
    changePassword(current, next) {
      return tracked(() => api.changePassword(current, next));
    },

    /** Re-read the signed-in user's rights from /auth/me: the DATABASE's rights, which the admin
     *  rules check. A token minted before a deploy that added a key under-reports them until it
     *  refreshes, and the admin panels' hints would then refuse what the server allows.
     *  LiveStaffTab calls this when it opens. Resolves to true when the profile was applied.
     *  Never rejects: on a failure the rights stay as they were, and the server still decides. */
    async refreshRights() {
      if (!overlay.user) return false;
      let me;
      try {
        me = await tracked(() => api.me());
      } catch {
        return false;
      }
      const user = overlay.user;
      // The session may have ended, or another begun, while the profile was on its way.
      if (!user || !me || me.id !== user.id || !Array.isArray(me.perms)) {
        if (syncRights()) emit();
        return false;
      }
      const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
      const groups = Array.isArray(me.groups) ? me.groups.filter((g) => g && typeof g.slug === "string") : [];
      rememberProfile(me);
      rightsToken = currentToken();  // read now: the same token must not undo the database's answer
      const next = withRights(user, strings(me.perms), groups.map((g) => g.slug), groups.map((g) => g.name));
      if (next !== user) {
        setOverlay({ user: next });
        emit();
      }
      return true;
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
      // A sign-in, sign-out or newer restore while this one waits supersedes it: its answer is
      // dropped, whatever it is, so it neither shows this account with another's rights nor
      // clears the tokens a new sign-in just stored.
      const epoch = nextEpoch();
      restoresInFlight += 1;
      setOverlay({ sessionRestoring: true });
      emit();
      try {
        const me = await api.me();
        if (epoch !== sessionEpoch) return false;
        const session = resolveSession(api.accessToken());  // reread: me() may have refreshed
        if (session.mfaRequired && !session.mfaVerified) {
          setOverlay({ user: null, sessionError: null,
                       mfaPending: pendingMfa(me.email || me.username, me, session,
                                              me.totp_enabled === true) });
        } else {
          rememberProfile(me);
          setOverlay({ user: sessionUser(me, session), mfaPending: null, sessionError: null });
          syncRights();
        }
        emit();
        return true;
      } catch (err) {
        if (epoch !== sessionEpoch) return false;
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
      } finally {
        restoresInFlight -= 1;
        if (restoresInFlight === 0) {
          setOverlay({ sessionRestoring: false });
          emit();
        }
      }
    },

    logout() {
      endSession();
    },
  };
}

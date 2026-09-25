// dashboard/src/ClinicalDemo.rbac.test.jsx — the clinical workspace against a live store (the real
// createLiveStore over a fake API) and against the simulation: navigation by permission, the MFA
// enrolment gate, alarm acknowledgement, the session error on the login screen, the user's own
// password change and the live staff tab. Synthetic data only; no real account, token or secret.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { ClinicalDemo } from "./ClinicalDemo.jsx";
import { createLiveStore } from "./liveStore.js";
import { createDemoStore, buildRealisticState, ROLE, TIER } from "./clinicalDemo.js";
import { cstrings } from "./clinicalI18n.js";
import { PERMISSION_KEYS } from "./permissions.js";

const S = cstrings("tr");
const R = S.rbac;

beforeEach(() => { localStorage.setItem("homunculus-clang", "tr"); });
afterEach(() => { localStorage.clear(); });

/** An unsigned JWT-shaped token — the client only decodes the payload. */
function tokenWith(payload) {
  const b64 = (o) => {
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}
const apiError = (message, status) => Object.assign(new Error(message), { status });

const ADMIN = { tenant: "t1", groups: ["hospital_admin"], perms: [...PERMISSION_KEYS],
                mfa_required: true, mfa_verified: true };
const NURSE = { tenant: "t1", groups: ["nurse"], perms: ["board.view", "alerts.ack", "admissions.view"] };
// The API may answer `email: null` (UserMeResponse.email is optional).
const ME = { id: "u-1", username: "deniz", email: null, full_name: "Deniz Yönetici", auth_source: "local",
             totp_enabled: true, groups: [{ slug: "hospital_admin", name: "Sistem Yöneticisi" }],
             perms: [...PERMISSION_KEYS] };
const SECRET = "JBSWY3DPEHPK3PXP";
const ALERT_BOARD = { patients: [{ patient_id: "bed-3", risk: "high", latest: {},
  alerts: [{ kind: "sepsis", severity: "high", summary: "Canlı test alarmı" }] }] };
const TWO_ALERTS = { patients: [{ patient_id: "bed-3", risk: "critical", latest: {},
  alerts: [{ kind: "sepsis", severity: "high", summary: "Canlı test alarmı" },
           { kind: "shock", severity: "critical", summary: "Canlı kritik alarm" }] }] };

/** A fake backendApi: it hands out `token` the way the real client stores its pair. */
function liveApi({ session = ADMIN } = {}) {
  let token = null;
  const api = {
    setToken: (payload) => { token = payload ? tokenWith(payload) : null; },
    accessToken: vi.fn(() => token),
    login: vi.fn(async () => { token = tokenWith(session); return { access_token: token, requires_mfa: false }; }),
    logout: vi.fn(() => { token = null; }),
    me: vi.fn(async () => ME),
    verifyTotp: vi.fn(async () => { token = tokenWith(session); return { access_token: token }; }),
    setupTotp: vi.fn(async () => ({ provisioning_uri: `otpauth://totp/Homunculus:deniz?secret=${SECRET}&issuer=Homunculus` })),
    boardPatients: vi.fn(async () => ({ patients: [] })),
    streamTicket: vi.fn(async () => ({ ticket: "t" })),
    acknowledge: vi.fn(async () => ({})),
    changePassword: vi.fn(async () => ({ access_token: token })),
    adminUsers: vi.fn(async () => []),
    adminGroups: vi.fn(async () => []),
    adminPermissions: vi.fn(async () => []),
  };
  return api;
}
const liveStore = (api) => createLiveStore({ api, base: createDemoStore(buildRealisticState()),
                                             openStream: () => () => {} });

/** A live session waiting at the MFA gate. */
async function atGate({ enrolled }) {
  const api = liveApi();
  api.login.mockImplementation(async () => {
    api.setToken({ ...ADMIN, mfa_verified: false });
    return { access_token: api.accessToken(), requires_mfa: true, mfa_enrolled: enrolled };
  });
  const store = liveStore(api);
  await store.attemptLogin("deniz", "gizli-parola");
  return { api, store };
}

async function signedIn(options) {
  const api = liveApi(options);
  const store = liveStore(api);
  await store.attemptLogin("deniz", "gizli-parola");
  return { api, store };
}

/** Render a signed-in live workspace and let its board load and stream start (outside of which
 *  the store's updates would land after the test). */
async function renderLive(store, api) {
  const view = render(<ClinicalDemo store={store} />);
  await waitFor(() => expect(api.streamTicket).toHaveBeenCalled());
  return view;
}

const navButton = (key) => screen.getByRole("button", { name: S.nav[key] });
const cardOf = (text) => screen.getByText(text).closest(".rounded-xl");

// ------------------------------------------------------------------------------ render in both modes
describe("the workspace renders in both modes", () => {
  it("simulation: the login screen, then the attending's permitted pages", () => {
    const { unmount } = render(<ClinicalDemo />);
    expect(screen.getByRole("heading", { name: S.loginTitle })).toBeInTheDocument();
    unmount();

    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.ATTENDING);
    render(<ClinicalDemo store={store} />);
    for (const key of ["board", "admission", "care", "alarms", "results", "heatmap"]) {
      expect(navButton(key)).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: S.nav.admin })).toBeNull();
    // The simulation keeps its fast PIN switch.
    expect(screen.getByTitle(S.pr7.fastSwitch)).toBeInTheDocument();
  });

  it("live: only the pages the API backs, as the token's permissions allow", async () => {
    const { api, store } = await signedIn({ session: NURSE });
    await renderLive(store, api);
    expect(navButton("board")).toBeInTheDocument();
    expect(navButton("alarms")).toBeInTheDocument();
    // Simulation-backed: results (despite admissions.view), admission, care team, heatmap.
    for (const key of ["results", "admission", "care", "heatmap", "admin"]) {
      expect(screen.queryByRole("button", { name: S.nav[key] }), key).toBeNull();
    }
    // The simulation-only PIN switch is not offered against the real backend.
    expect(screen.queryByTitle(S.pr7.fastSwitch)).toBeNull();
  });
});

// ------------------------------------------------------------------------------ MFA gate
describe("the MFA gate", () => {
  it("enrols once per showing, even under StrictMode, with the QR drawn locally and the manual key", async () => {
    const { api, store } = await atGate({ enrolled: false });
    render(<React.StrictMode><ClinicalDemo store={store} /></React.StrictMode>);

    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(screen.getByText(R.mfaManualKey)).toBeInTheDocument();
    const qr = await screen.findByAltText(R.mfaQrAlt);
    expect(qr.getAttribute("src")).toMatch(/^data:image\//);   // rendered in the page, not fetched
    // setupMfa ROTATES the secret: a second call would make the key on screen stale.
    expect(api.setupTotp).toHaveBeenCalledTimes(1);
    // The simulation's demo hint is not shown against the real backend.
    expect(screen.queryByText(S.pr11.mfaDemoHint)).toBeNull();
  });

  it("shows the API's refusal to enrol, translated", async () => {
    const { api, store } = await atGate({ enrolled: false });
    api.setupTotp.mockRejectedValueOnce(apiError("mfa_reset_required", 403));
    render(<ClinicalDemo store={store} />);
    expect(await screen.findByText(R.err.mfaResetRequired)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: S.pr11.mfaGateTitle })).toBeInTheDocument();
    // A refusal is an answer: asking again would get the same one.
    expect(screen.queryByRole("button", { name: R.retry })).toBeNull();
  });

  it.each([
    ["no network", () => new TypeError("Failed to fetch"), "network"],
    ["a server error", () => apiError("İstek başarısız (503)", 503), null],
    ["no answer in time", () => Object.assign(new Error("x"), { code: "REQUEST_TIMEOUT" }), "requestTimeout"],
  ])("an enrolment that failed on %s can be retried", async (_label, makeError, key) => {
    const { api, store } = await atGate({ enrolled: false });
    api.setupTotp.mockRejectedValueOnce(makeError());
    render(<ClinicalDemo store={store} />);
    const alert = await screen.findByRole("alert");
    if (key) expect(alert).toHaveTextContent(R.err[key]);
    fireEvent.click(screen.getByRole("button", { name: R.retry }));
    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(api.setupTotp).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers to copy the key only where the clipboard exists, and says 'copied' only once it wrote", async () => {
    const { store } = await atGate({ enrolled: false });
    // jsdom, like a plain-HTTP origin, has no navigator.clipboard.
    const { unmount } = render(<ClinicalDemo store={store} />);
    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: R.mfaCopy })).toBeNull();
    unmount();

    const writeText = vi.fn()
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      const again = await atGate({ enrolled: false });
      render(<ClinicalDemo store={again.store} />);
      const copy = await screen.findByRole("button", { name: R.mfaCopy });
      fireEvent.click(copy);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
      await act(async () => {});
      expect(screen.queryByText(R.copied)).toBeNull();          // the write was refused
      fireEvent.click(copy);
      expect(await screen.findByText(R.copied)).toBeInTheDocument();
    } finally {
      delete window.navigator.clipboard;
    }
  });

  it("an enrolled user is not enrolled again", async () => {
    const { api, store } = await atGate({ enrolled: true });
    render(<ClinicalDemo store={store} />);
    expect(screen.getByRole("heading", { name: S.pr11.mfaGateTitle })).toBeInTheDocument();
    await act(async () => {});
    expect(api.setupTotp).not.toHaveBeenCalled();
    expect(screen.queryByText(R.mfaManualKey)).toBeNull();
  });

  it.each([
    [401, "Invalid TOTP code", "invalidTotp"],
    [401, "Bu kod zaten kullanıldı; yeni kodu bekleyin.", "totpReplayed"],
    [429, "Çok fazla hatalı kod. 5 dakika sonra tekrar deneyin.", "totpLocked"],
  ])("a refused code (%i) is shown translated and the gate stays open", async (status, message, key) => {
    const { api, store } = await atGate({ enrolled: true });
    api.verifyTotp.mockRejectedValueOnce(apiError(message, status));
    localStorage.setItem("homunculus-clang", "en");
    const E = cstrings("en");
    render(<ClinicalDemo store={store} />);

    fireEvent.change(screen.getByLabelText(E.pr11.mfaCodeLabel), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: E.pr11.mfaVerifyCta }));

    expect(await screen.findByText(E.rbac.err[key])).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: E.pr11.mfaGateTitle })).toBeInTheDocument();
    expect(store.getState().user).toBeNull();
  });

  it("a verified code opens the workspace", async () => {
    const { api, store } = await atGate({ enrolled: true });
    render(<ClinicalDemo store={store} />);
    fireEvent.change(screen.getByLabelText(S.pr11.mfaCodeLabel), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: S.pr11.mfaVerifyCta }));
    expect(await screen.findByRole("button", { name: S.nav.admin })).toBeInTheDocument();
    expect(api.verifyTotp).toHaveBeenCalledWith("123456");
  });

  it("the simulation's enrolment still works, synchronously", async () => {
    const store = createDemoStore(buildRealisticState());
    store.attemptLogin("dr.can.ozturk@homunculus.health", "Hekim.Can2025!");   // MFA required, not enrolled
    render(<ClinicalDemo store={store} />);
    expect(await screen.findByText(R.mfaManualKey)).toBeInTheDocument();
    expect(screen.getByText(S.pr11.mfaDemoHint)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(S.pr11.mfaCodeLabel), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: S.pr11.mfaVerifyCta }));
    expect(await screen.findByRole("button", { name: S.nav.alarms })).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------------------ acknowledgement
describe("acknowledging an alarm", () => {
  const openAck = async (summary) => {
    fireEvent.click(navButton("alarms"));
    fireEvent.click(within(await waitFor(() => cardOf(summary))).getByRole("button", { name: S.ack }));
    return screen.getByRole("dialog", { name: S.ackTitle });
  };

  it("live: a refusal keeps the dialog open and says which right is missing", async () => {
    const { api, store } = await signedIn();
    api.boardPatients.mockResolvedValue(ALERT_BOARD);
    let answer;
    api.acknowledge
      .mockRejectedValueOnce(apiError("permission required: alerts.ack", 403))
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    render(<ClinicalDemo store={store} />);

    const dialog = await openAck("Canlı test alarmı");
    fireEvent.click(within(dialog).getByRole("button", { name: S.confirm }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      R.err.permissionRequired.replace("{perms}", R.perm["alerts.ack"]));
    expect(screen.getByRole("dialog", { name: S.ackTitle })).toBeInTheDocument();

    // A second try: Confirm waits while the request is in flight, then the dialog closes.
    fireEvent.click(within(dialog).getByRole("button", { name: S.confirm }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: S.confirm })).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: S.cancel })).toBeEnabled();
    await act(async () => { answer({}); });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: S.ackTitle })).toBeNull());
    expect(api.acknowledge).toHaveBeenCalledWith("bed-3", "sepsis");
  });

  it("live: the dialog can be left while a request hangs, and a late answer touches no other dialog", async () => {
    const { api, store } = await signedIn();
    api.boardPatients.mockResolvedValue(TWO_ALERTS);
    let answer;
    api.acknowledge.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    render(<ClinicalDemo store={store} />);

    const first = await openAck("Canlı test alarmı");
    fireEvent.click(within(first).getByRole("button", { name: S.confirm }));
    await waitFor(() => expect(within(first).getByRole("button", { name: S.confirm })).toBeDisabled());
    // The board and every other alarm stay reachable: Cancel closes the waiting dialog.
    fireEvent.click(within(first).getByRole("button", { name: S.cancel }));
    expect(screen.queryByRole("dialog")).toBeNull();

    const second = await openAck("Canlı kritik alarm");
    await act(async () => { answer({}); });
    expect(screen.getByRole("dialog", { name: S.ackTitle })).toBe(second);
  });

  it("live: a request the server did not answer says so, translated, and signs nobody out", async () => {
    const { api, store } = await signedIn();
    api.boardPatients.mockResolvedValue(ALERT_BOARD);
    api.acknowledge.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "REQUEST_TIMEOUT" }));
    render(<ClinicalDemo store={store} />);
    const dialog = await openAck("Canlı test alarmı");
    fireEvent.click(within(dialog).getByRole("button", { name: S.confirm }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(R.err.requestTimeout);
    expect(store.getState().user).not.toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
  });

  it("live: no reason or note is asked for, since the server keeps neither", async () => {
    const { api, store } = await signedIn();
    api.boardPatients.mockResolvedValue(ALERT_BOARD);
    render(<ClinicalDemo store={store} />);
    const dialog = await openAck("Canlı test alarmı");
    expect(within(dialog).queryByLabelText(S.ackReason)).toBeNull();
    expect(within(dialog).queryByLabelText(S.ackNote, { exact: false })).toBeNull();
    expect(within(dialog).getByText(R.ackLiveHint)).toBeInTheDocument();
  });

  it("the dialog takes the focus and closes on Escape", async () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.ATTENDING);
    store.fireAlert({ patientId: store.getState().patients[0].patient_id, tier: TIER.HIGH, summary: "Odak alarmı" });
    render(<ClinicalDemo store={store} />);
    const dialog = await openAck("Odak alarmı");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("simulation: an acknowledgement closes the dialog; a refused one keeps it open", async () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.ATTENDING);
    const patientId = store.getState().patients[0].patient_id;
    store.fireAlert({ patientId, tier: TIER.CRITICAL, summary: "Kritik test alarmı" });
    store.fireAlert({ patientId, tier: TIER.HIGH, summary: "Yüksek test alarmı" });
    render(<ClinicalDemo store={store} />);

    // The simulation keeps its escalation stages and its own controls.
    fireEvent.click(navButton("alarms"));
    const card = await waitFor(() => cardOf("Yüksek test alarmı"));
    expect(card).toHaveTextContent(S.pr6.escTimeline);
    for (const name of [S.escalateRRT, S.pr6.mute, S.snooze]) {
      expect(within(card).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByText(S.fireAlert)).toBeInTheDocument();

    // CRITICAL needs a note: the simulation refuses synchronously, and the dialog stays.
    let dialog = await openAck("Kritik test alarmı");
    expect(within(dialog).getByLabelText(S.ackReason)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: S.confirm }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/Kritik alarm onayı/);
    fireEvent.click(within(dialog).getByRole("button", { name: S.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = await openAck("Yüksek test alarmı");
    fireEvent.click(within(dialog).getByRole("button", { name: S.confirm }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const acked = store.getState().alerts.find((a) => a.summary === "Yüksek test alarmı");
    expect(acked.status).toBe("ACKNOWLEDGED");
  });
});

// ------------------------------------------------------------------------------ session error
describe("the session error on the login screen", () => {
  it("says the server is unreachable and the session is kept, and retries once at a time", async () => {
    const api = liveApi();
    api.setToken(ADMIN);                                   // a stored session from an earlier load
    api.me.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const store = liveStore(api);
    await store.restoreSession();
    let answer;
    api.me.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    render(<ClinicalDemo store={store} />);

    expect(screen.getByRole("alert")).toHaveTextContent(R.err.sessionUnreachable);
    const retry = screen.getByRole("button", { name: R.retry });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(api.me).toHaveBeenCalledTimes(2);               // the first load and ONE retry
    expect(retry).toBeDisabled();
    // A sign-in now would race the retry for the session: it waits.
    expect(screen.getByRole("button", { name: S.signIn })).toBeDisabled();

    await act(async () => { answer(ME); });
    expect(await screen.findByRole("button", { name: S.nav.admin })).toBeInTheDocument();
    expect(api.logout).not.toHaveBeenCalled();
  });

  it("a sign-in error is shown translated", async () => {
    const api = liveApi();
    api.login.mockRejectedValueOnce(apiError("Invalid credentials", 401));
    localStorage.setItem("homunculus-clang", "ru");
    const RU = cstrings("ru");
    render(<ClinicalDemo store={liveStore(api)} />);
    fireEvent.change(screen.getByLabelText(RU.email), { target: { value: "deniz" } });
    fireEvent.change(screen.getByLabelText(RU.pr7.loginPinLabel), { target: { value: "yanlis" } });
    fireEvent.click(screen.getByRole("button", { name: RU.signIn }));
    expect(await screen.findByText(RU.rbac.err.invalidCredentials)).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------------------ own account
describe("the user menu (live)", () => {
  const openPasswordDialog = () => {
    fireEvent.click(screen.getByRole("button", { name: /Deniz Yönetici/ }));
    fireEvent.click(screen.getByRole("button", { name: R.changeOwnPassword }));
    const dialog = screen.getByRole("dialog", { name: R.changeOwnPassword });
    const field = (label) => within(dialog).getByLabelText(label);
    return { dialog, current: field(R.currentPassword), next: field(R.newPassword), again: field(R.repeatPassword),
             save: within(dialog).getByRole("button", { name: R.save }) };
  };
  const type = (el, value) => fireEvent.change(el, { target: { value } });

  it("shows the username when the account has no e-mail, and the groups", async () => {
    const { api, store } = await signedIn();
    await renderLive(store, api);
    fireEvent.click(screen.getByRole("button", { name: /Deniz Yönetici/ }));
    expect(screen.getByText("deniz")).toBeInTheDocument();
    expect(screen.getByText("Sistem Yöneticisi")).toBeInTheDocument();
  });

  it("changes the user's own password with masked fields that are cleared after use", async () => {
    const { api, store } = await signedIn();
    await renderLive(store, api);
    const { dialog, current, next, again, save } = openPasswordDialog();
    for (const el of [current, next, again]) expect(el).toHaveAttribute("type", "password");

    type(current, "eski-parola"); type(next, "yeni-parola-1"); type(again, "yeni-parola-2");
    fireEvent.click(save);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(R.passwordMismatch);
    expect(api.changePassword).not.toHaveBeenCalled();

    type(again, "yeni-parola-1");
    fireEvent.click(save);
    expect(await within(dialog).findByText(R.passwordChanged)).toBeInTheDocument();
    expect(api.changePassword).toHaveBeenCalledWith("eski-parola", "yeni-parola-1");
    for (const el of [current, next, again]) expect(el).toHaveValue("");
  });

  it("an Active Directory account gets the translated refusal", async () => {
    const { api, store } = await signedIn();
    api.changePassword.mockRejectedValueOnce(apiError("Parola Active Directory tarafından yönetiliyor", 400));
    render(<ClinicalDemo store={store} />);
    const { dialog, current, next, again, save } = openPasswordDialog();
    type(current, "eski-parola"); type(next, "yeni-parola-1"); type(again, "yeni-parola-1");
    fireEvent.click(save);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(R.err.directoryPassword);
    for (const el of [current, next, again]) expect(el).toHaveValue("");
  });

  it("the dialog's close button is named in the UI language", async () => {
    const { api, store } = await signedIn();
    await renderLive(store, api);
    const { dialog } = openPasswordDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: S.close }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ------------------------------------------------------------------------------ live staff tab
describe("the admin page (live)", () => {
  it("shows the live staff tab, re-reads the rights and hides simulation-only tabs", async () => {
    const { api, store } = await signedIn();
    await renderLive(store, api);
    fireEvent.click(navButton("admin"));
    // Every other tab shows only the simulation's data or writes only to it.
    for (const name of [S.pr10.inviteTitle, S.pr8.reports, S.pr7.hierarchy, S.pr7.devices,
                        S.pr7.auditSearch, S.pr13.archiveTitle, S.pr13.sessionsTitle]) {
      expect(screen.queryByRole("button", { name }), name).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: S.pr7.staffMatrix }));

    await waitFor(() => expect(api.adminUsers).toHaveBeenCalledTimes(1));
    expect(api.me).toHaveBeenCalledTimes(2);              // sign-in, then the rights re-read
    expect((await screen.findAllByText(R.usersTitle)).length).toBeGreaterThan(0);
    expect(screen.getByText(R.groupsTitle)).toBeInTheDocument();
  });

  it("a devices-only session has no admin page in live mode", async () => {
    const { api, store } = await signedIn({ session: { tenant: "t1", groups: ["biomedical"],
      perms: ["board.view", "devices.manage", "audit.view", "structure.manage"] } });
    await renderLive(store, api);
    expect(screen.queryByRole("button", { name: S.nav.admin })).toBeNull();
  });

  it("the simulation keeps its own staff screens", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.HOSPITAL_ADMIN);
    store.completeTenantSetup();
    render(<ClinicalDemo store={store} />);
    fireEvent.click(navButton("admin"));
    expect(screen.getByRole("button", { name: S.pr10.inviteTitle })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: S.pr7.staffMatrix }));
    expect(screen.queryByText(R.groupsTitle)).toBeNull();      // no live panels in the simulation
  });
});

// ------------------------------------------------------------------------------ live mode shows nothing simulated
describe("live mode: nothing simulated looks real", () => {
  it("a real alarm's age follows the wall clock, and no simulated escalation stage lights", async () => {
    // The simulation's clock runs at 60x: a real alarm used to read "elapsed 310 s" five seconds
    // after it was first seen 10 s ago, with its 3- and 5-minute stages lit.
    const t0 = Date.parse("2026-09-25T10:00:10Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(t0);
      const { api, store } = await signedIn();
      api.boardPatients.mockResolvedValue({ patients: [{ patient_id: "bed-3", risk: "high", latest: {},
        alerts: [{ kind: "sepsis", severity: "high", summary: "Canlı test alarmı",
                   first_seen_at: "2026-09-25T10:00:00Z" }] }] });
      await renderLive(store, api);
      fireEvent.click(navButton("alarms"));
      const card = await waitFor(() => cardOf("Canlı test alarmı"));
      expect(card).toHaveTextContent(`${S.elapsed}: 0:10`);
      const clock = store.getState().clockSec;

      vi.setSystemTime(t0 + 5_000);
      await waitFor(() => expect(cardOf("Canlı test alarmı")).toHaveTextContent(`${S.elapsed}: 0:15`),
        { timeout: 3_000 });

      expect(store.getState().clockSec).toBe(clock);          // the simulation's clock stands still
      for (const text of [S.pr6.escTimeline, S.step1, S.nextStep]) {
        expect(cardOf("Canlı test alarmı")).not.toHaveTextContent(text);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("an alarm the backend did not date shows no age rather than an invented one", async () => {
    const { api, store } = await signedIn();
    api.boardPatients.mockResolvedValue(ALERT_BOARD);             // no first_seen_at
    await renderLive(store, api);
    fireEvent.click(navButton("alarms"));
    const card = await waitFor(() => cardOf("Canlı test alarmı"));
    expect(card).not.toHaveTextContent(S.elapsed);
  });

  it("no call-for-help or simulation control that would silently do nothing", async () => {
    const { api, store } = await signedIn();
    api.boardPatients.mockResolvedValue(TWO_ALERTS);
    store.setOnline(false);             // the simulation's own flag: it must not show in live mode
    await renderLive(store, api);
    fireEvent.click(navButton("alarms"));
    for (const summary of ["Canlı test alarmı", "Canlı kritik alarm"]) {
      const card = await waitFor(() => cardOf(summary));
      expect(within(card).getByRole("button", { name: S.ack })).toBeInTheDocument();
      for (const name of [S.escalateRRT, S.pr6.mute, S.snooze]) {
        expect(within(card).queryByRole("button", { name }), name).toBeNull();
      }
      expect(card).not.toHaveTextContent(S.critNoSnooze);
    }
    for (const text of [S.fireAlert, S.timeScale, S.breakGlass, S.pr7.offlineBanner]) {
      expect(screen.queryByText(text), text).toBeNull();
    }
    for (const title of [S.pr7.goOffline, S.pr7.goOnline, S.pr6.autoAlarmOn, S.pr6.autoAlarmOff]) {
      expect(screen.queryByTitle(title), title).toBeNull();
    }
  });

  it("the simulation keeps those controls", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.ATTENDING);
    render(<ClinicalDemo store={store} />);
    expect(screen.getByTitle(S.pr7.goOffline)).toBeInTheDocument();
    expect(screen.getByTitle(store.getState().autoAlarm ? S.pr6.autoAlarmOn : S.pr6.autoAlarmOff)).toBeInTheDocument();
    fireEvent.click(navButton("alarms"));
    for (const text of [S.fireAlert, S.timeScale, S.breakGlass]) expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("the top bar names the session's hospital, not the simulated one", async () => {
    const { api, store } = await signedIn();
    await renderLive(store, api);
    const simulated = store.getState().structure.tenant;
    expect(screen.queryByText(new RegExp(simulated))).toBeNull();
    expect(screen.getByText("t1")).toBeInTheDocument();
  });

  it("the board and the patient drawer show only what the backend sent", async () => {
    const { api, store } = await signedIn();
    api.boardPatients.mockResolvedValue(ALERT_BOARD);
    await renderLive(store, api);
    await waitFor(() => expect(screen.getAllByText("bed-3").length).toBeGreaterThan(0));
    // Simulated units, an invented sex, a "not connected" device badge on device data: none.
    expect(screen.queryByRole("button", { name: S.allUnits })).toBeNull();
    for (const text of [S.female, S.male, S.pr7.offlineDev, S.admissionDx]) {
      expect(screen.queryByText(new RegExp(text)), text).toBeNull();
    }

    fireEvent.click(screen.getAllByText("bed-3")[0].closest("button"));
    expect(screen.getByText(S.patientDetail)).toBeInTheDocument();
    for (const text of [S.pr14.cockpit, S.pr13.phiFields, S.careTeamLabel, S.handover, S.transfer]) {
      expect(screen.queryByText(new RegExp(text)), text).toBeNull();
    }
  });
});

describe("the patient drawer (simulation)", () => {
  const openDrawer = (store) => {
    const p = store.getState().patients[0];
    fireEvent.click(screen.getAllByText(new RegExp(p.protocolNo))[0].closest("button"));
    return screen.getByText(S.patientDetail).closest("div.overflow-y-auto");
  };

  it("offers a transfer only to a session that may start one", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.ATTENDING);                         // admissions.move.initiate
    const { unmount } = render(<ClinicalDemo store={store} />);
    expect(within(openDrawer(store)).getByRole("button", { name: S.transfer })).toBeInTheDocument();
    unmount();

    const nurse = createDemoStore(buildRealisticState());
    nurse.loginAs(ROLE.CHARGE_NURSE);                      // confirms transfers, does not start them
    render(<ClinicalDemo store={nurse} />);
    expect(within(openDrawer(nurse)).queryByRole("button", { name: S.transfer })).toBeNull();
  });

  it("is closed for whoever signs in next", async () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.ATTENDING);
    render(<ClinicalDemo store={store} />);
    openDrawer(store);
    fireEvent.click(screen.getByTitle(S.logout));
    expect(screen.getByRole("heading", { name: S.loginTitle })).toBeInTheDocument();
    act(() => { store.loginAs(ROLE.CHARGE_NURSE); });
    expect(screen.queryByText(S.patientDetail)).toBeNull();
  });
});

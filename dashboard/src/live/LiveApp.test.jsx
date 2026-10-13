// The live mode end to end, on a fake API: sign-in, the TOTP step, the forced password change, the
// shell, the lock, sign-out. Azerbaijani by default (roadmap D2). Synthetic accounts only.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import React from "react";
import LiveApp from "./LiveApp.jsx";
import { fakeApi, profile, token } from "./session/testTokens.testutil.js";
import { writeLock } from "./session/browserState.js";
import { resetScreens, stubScreens } from "./shell/routes.js";
import { onlyScreens } from "./shell/screens.testutil.js";
import { PRODUCT } from "./shell/Shell.jsx";
import { ANNOUNCE_DELAY_MS, useToast } from "./ui/index.js";
import { fakeAudio, onPage } from "./signals/fakeAudio.testutil.js";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,QR") } }));

const NURSE = token();
const PENDING = token({ sub: "u-kaya", groups: ["attending"], perms: ["board.view"], mfaRequired: true });
const VERIFIED = token({ sub: "u-kaya", groups: ["attending"], perms: ["board.view"], mfaRequired: true, mfaVerified: true });

// Synthetic board: two patients, one alarm nobody has acknowledged yet.
const BOARD = {
  patients: [
    { patient_id: "P-001", risk: "high", vitals: {}, alerts: [{ kind: "news2", severity: "high", summary: "NEWS2 7", first_seen_at: "2026-10-04T07:58:00Z", acknowledged: false }], identity: { bed_label: "REA-01" } },
    { patient_id: "P-002", risk: "none", vitals: {}, alerts: [] },
  ],
  scope: { unrestricted: true, unit_ids: [] },
};

/** A refusal: read at once, so the element with this text sits inside a role="alert" box. */
async function refused(text) {
  const el = await screen.findByText(text, { exact: false });
  return el.closest("[role='alert']");
}

/** A notice: the box everyone sees is aria-hidden, and the same words reach a screen reader from a
 *  polite region that was already on the page and is filled afterwards (ui/Alert.jsx). */
async function spoken(text) {
  await waitFor(() => expect(screen.getAllByRole("status").map((el) => el.textContent)).toContain(text));
}

/** Everything already queued — including the history move jsdom reports asynchronously. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function refusal(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function app({ access = null, board = BOARD, me = null, setup, strict = false } = {}) {
  const api = fakeApi(vi, { access });
  if (me) api.me.mockResolvedValue(me);
  setup?.(api);
  if (board instanceof Error) api.boardPatients.mockRejectedValue(board);
  else api.boardPatients.mockResolvedValue(board);
  api.streamTicket.mockResolvedValue({ ticket: "t-1" });
  // A stream that opens, as EventSource does once the server answers: the board reloads, then is LIVE.
  const openStream = vi.fn((url, handlers) => {
    Promise.resolve().then(() => handlers.onopen());
    return () => {};
  });
  const app_ = <LiveApp api={api} openStream={openStream} />;
  render(strict ? <React.StrictMode>{app_}</React.StrictMode> : app_);
  return api;
}

async function signIn(api, { tokens = { access_token: NURSE }, me = profile(), login = "ayse", password = "Gizli-Sifre-1" } = {}) {
  api.login.mockImplementation(async () => { api.store(tokens.access_token); return tokens; });
  api.me.mockResolvedValue(me);
  fireEvent.change(await screen.findByLabelText(/^İstifadəçi adı \*$/), { target: { value: login } });
  fireEvent.change(screen.getByLabelText(/^Şifrə \*$/), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /Daxil ol/ }));
}

/** A screen of a later wave, while a test needs one (routes.js: the table itself is frozen). */
function PatientProbe({ params }) {
  return <h1>Xəstə {params.id}</h1>;
}
function BedsProbe() {
  return <h1>Çarpayı ekranı</h1>;
}
function AlarmsProbe() {
  return <h1>Siqnal ekranı</h1>;
}
const built = (screens) => stubScreens(screens);

/** A screen with a write in flight, as the alarm acknowledgement and the patient chart have: each
 *  press starts one, its answer comes whenever the test sends it (`answers[i](text)`), and the
 *  refusal goes on the toast — from the closure the screen had, mounted or not by then. */
function writer() {
  const answers = [];
  function WriteProbe() {
    const toast = useToast();
    async function write() {
      const refusal = await new Promise((resolve) => { answers.push(resolve); });
      toast(refusal, "error");
    }
    return (
      <>
        <h1>Siqnal ekranı</h1>
        <button type="button" onClick={write}>Yaz</button>
      </>
    );
  }
  return { WriteProbe, answers };
}

beforeEach(() => {
  window.location.hash = "";
  // This file's subject is the session's life — sign-in, the steps, the lock, sign-out — not which
  // work screens exist, and several of its tests name the screen a session lands on. So the
  // registry is pinned to the settings screen alone, and a test that needs another one stands it in
  // itself (`built`). Written against the build instead, every one of those tests would break here
  // the moment a Wave-3 branch built a screen — in a file none of them owns.
  onlyScreens({});
});
afterEach(() => {
  resetScreens();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  document.title = "";
});

describe("signing in", () => {
  it("opens on the sign-in form, in Azerbaijani", async () => {
    const api = app();
    expect(await screen.findByRole("heading", { level: 1, name: "Daxil olun" })).toBeInTheDocument();
    expect(api.me).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe("az");
  });

  it("says what is missing, on the field, before anything is sent", async () => {
    const api = app();
    fireEvent.click(await screen.findByRole("button", { name: /Daxil ol/ }));
    const login = screen.getByLabelText(/^İstifadəçi adı \*$/);
    expect(login).toHaveAttribute("aria-invalid", "true");
    expect(login).toHaveAccessibleDescription(/İstifadəçi adınızı və ya e-poçtunuzu daxil edin/);
    expect(document.activeElement).toBe(login);
    expect(api.login).not.toHaveBeenCalled();
  });

  it("lands an account straight in the product, on its home — no setup wizard", async () => {
    const api = app();
    await signIn(api);
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Əsas menyu" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Sentetik Hastane");
    await waitFor(() => expect(window.location.hash).toBe("#/settings"));
    expect(document.title).toBe("Ayarlar · Homunculus");
    expect(api.boardPatients).toHaveBeenCalled();
  });

  it("announces a refusal in the user's language and empties the password", async () => {
    const api = app();
    api.login.mockRejectedValue(refusal(401, "Invalid credentials"));
    fireEvent.change(await screen.findByLabelText(/^İstifadəçi adı \*$/), { target: { value: "ayse" } });
    fireEvent.change(screen.getByLabelText(/^Şifrə \*$/), { target: { value: "yanlis" } });
    fireEvent.click(screen.getByRole("button", { name: /Daxil ol/ }));
    expect(await refused("İstifadəçi adı və ya şifrə səhvdir.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Şifrə \*$/)).toHaveValue("");
    expect(document.activeElement).toBe(screen.getByLabelText(/^Şifrə \*$/));
  });

  it("holds the button as long as a 429 says", async () => {
    const api = app();
    api.login.mockRejectedValue(refusal(429, "Çok fazla giriş denemesi; bir dakika sonra tekrar deneyin", { retryAfter: 60 }));
    fireEvent.change(await screen.findByLabelText(/^İstifadəçi adı \*$/), { target: { value: "ayse" } });
    fireEvent.change(screen.getByLabelText(/^Şifrə \*$/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Daxil ol/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Daxil ol/ })).toBeDisabled());
    // The count is on screen (aria-hidden, ticking) and said once from the polite region: two
    // places hold the same words, so the text is asserted without demanding a single match.
    expect(screen.getAllByText("60 saniyədən sonra yenidən cəhd edə bilərsiniz.").length).toBeGreaterThan(0);
  });

  it("remembers the username — only it — and fills it in next time", async () => {
    const api = app();
    fireEvent.click(await screen.findByLabelText("İstifadəçi adını xatırla"));
    await signIn(api);
    await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
    expect(localStorage.getItem("hmc.rememberUser")).toBe("ayse");
    expect(Object.values(localStorage).join(" ")).not.toContain("Gizli-Sifre-1");
  });

  it("says whom to ask when the password is forgotten — no SMS, no e-mail", async () => {
    app();
    const forgot = await screen.findByRole("button", { name: "Şifrəni unutmusunuz?" });
    expect(forgot).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(forgot);
    expect(screen.getByRole("note")).toHaveTextContent(/İT şöbəsinə müraciət edin/);
  });
});

describe("a page load", () => {
  it("keeps a session the server could not check, and retries on request", async () => {
    const api = app({ access: NURSE,
      setup: (a) => a.me.mockRejectedValueOnce(refusal(503, "upstream")).mockResolvedValueOnce(profile()) });
    expect(await screen.findByRole("heading", { level: 1, name: "Serverə qoşulmaq mümkün deyil" })).toBeInTheDocument();
    expect(api.logout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
  });
});

describe("the TOTP step and the forced password change", () => {
  it("enrols an authenticator (QR and key drawn here), then checks the code", async () => {
    const api = app();
    api.setupTotp.mockResolvedValue({ provisioning_uri: "otpauth://totp/Homunculus:dr.kaya?secret=JBSWY3DPEHPK3PXP&issuer=Homunculus" });
    await signIn(api, { tokens: { access_token: PENDING, requires_mfa: true, mfa_enrolled: false },
                        me: profile({ id: "u-kaya", full_name: "Dr. Sentetik", totp_enabled: false }) });
    expect(await screen.findByRole("heading", { level: 1, name: "Autentifikatoru quraşdırın" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Autentifikator tətbiqi üçün QR kod" })).toBeInTheDocument();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(screen.getByText("Addım 2/2")).toBeInTheDocument();
    expect(api.setupTotp).toHaveBeenCalledTimes(1);
    api.verifyTotp.mockImplementation(async () => { api.store(VERIFIED); return { access_token: VERIFIED }; });
    fireEvent.change(screen.getByLabelText(/6 rəqəmli kod/), { target: { value: "12a3456" } });
    fireEvent.click(screen.getByRole("button", { name: "Təsdiqlə" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
    expect(api.verifyTotp).toHaveBeenCalledWith("123456");
  });

  it("shows a wrong code's refusal and stays", async () => {
    const api = app();
    await signIn(api, { tokens: { access_token: PENDING, requires_mfa: true, mfa_enrolled: true },
                        me: profile({ id: "u-kaya", totp_enabled: true }) });
    await screen.findByRole("heading", { level: 1, name: "İki addımlı doğrulama" });
    api.verifyTotp.mockRejectedValue(refusal(401, "Invalid TOTP code"));
    fireEvent.change(screen.getByLabelText(/6 rəqəmli kod/), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Təsdiqlə" }));
    expect(await refused("Kod səhvdir və ya vaxtı bitib.")).toBeInTheDocument();
    expect(api.setupTotp).not.toHaveBeenCalled();
  });

  it("makes a temporary password be replaced before the shell opens", async () => {
    const api = app();
    await signIn(api, { tokens: { access_token: NURSE, password_change_required: true },
                        me: profile({ must_change_password: true }) });
    expect(await screen.findByRole("heading", { level: 1, name: "Yeni şifrə təyin edin" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Sizə verilən müvəqqəti şifrə/), { target: { value: "Gecici-1" } });
    fireEvent.change(screen.getByLabelText(/^Yeni şifrə \*/), { target: { value: "Gecici-1" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifrə \(təkrar\)/), { target: { value: "Gecici-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Şifrəni yadda saxla və davam et" }));
    expect(screen.getByLabelText(/^Yeni şifrə \*/)).toHaveAccessibleDescription(/Yeni şifrə cari şifrədən fərqli olmalıdır/);
    expect(api.changePassword).not.toHaveBeenCalled();
    // The refused attempt emptied the temporary password's field — it never survives one — so it
    // is typed again, as the clinician would from the slip of paper she was given.
    expect(screen.getByLabelText(/Sizə verilən müvəqqəti şifrə/)).toHaveValue("");
    fireEvent.change(screen.getByLabelText(/Sizə verilən müvəqqəti şifrə/), { target: { value: "Gecici-1" } });
    fireEvent.change(screen.getByLabelText(/^Yeni şifrə \*/), { target: { value: "Kendi-Sifrem-9" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifrə \(təkrar\)/), { target: { value: "Kendi-Sifrem-9" } });
    api.changePassword.mockResolvedValue({ access_token: NURSE });
    api.me.mockResolvedValue(profile());
    fireEvent.click(screen.getByRole("button", { name: "Şifrəni yadda saxla və davam et" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
    expect(api.changePassword).toHaveBeenCalledWith("Gecici-1", "Kendi-Sifrem-9");
  });
});

describe("the lock", () => {
  async function ready() {
    const api = app();
    await signIn(api);
    await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
    await waitFor(() => expect(api.streamTicket).toHaveBeenCalled());
    return api;
  }

  it("replaces the whole shell — nothing of the session stays on the page — and unlocks with the password", async () => {
    const api = await ready();
    fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Ekranı kilidlə" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ekran kilidlənib" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(document.body).not.toHaveTextContent("REA-01");
    const counts = screen.getByRole("region", { name: "Bölmələrinizdəki açıq siqnalların sayı" });
    await waitFor(() => expect(counts).toHaveTextContent("Bölmələrinizdəki açıq siqnal: 1"));
    expect(counts).toHaveTextContent("Təsdiqlənməmiş: 1");
    expect(counts).toHaveTextContent("yüksək: 1");

    api.reauth.mockRejectedValueOnce(refusal(403, "Parola hatalı"));
    fireEvent.change(screen.getByLabelText("Şifrə"), { target: { value: "yanlis" } });
    fireEvent.click(screen.getByRole("button", { name: "Kilidi aç" }));
    expect(await refused("Şifrə səhvdir. Qalan cəhd: 2")).toBeInTheDocument();
    api.reauth.mockResolvedValueOnce({ ok: true });
    fireEvent.change(screen.getByLabelText("Şifrə"), { target: { value: "Gizli-Sifre-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Kilidi aç" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
    expect(api.reauth).toHaveBeenLastCalledWith("Gizli-Sifre-1");
  });

  // The alarm sound sits outside the phases (signals/AlarmSignals.jsx): the shell is unmounted at the
  // lock, and a locked ward PC must still alert. Proved on the whole page: an alarm that arrives
  // while the screen is locked changes what plays.
  it("keeps the alarm sound going through the lock — a critical alarm arriving then is heard", async () => {
    localStorage.setItem("hmc.alarmSound", "on");
    const audio = fakeAudio();
    const page = onPage({ AudioContext: audio.AudioContext });
    try {
      const api = fakeApi(vi, { access: null });
      api.boardPatients.mockResolvedValue(BOARD);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      let stream = null;
      const openStream = vi.fn((url, handlers) => {
        stream = handlers;
        Promise.resolve().then(() => handlers.onopen());
        return () => {};
      });
      render(<LiveApp api={api} openStream={openStream} />);
      await signIn(api);                                  // its click is the gesture that starts the audio
      await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
      await waitFor(() => expect(audio.pulses()).toEqual([640, 640, 640]));   // REA-01's high alarm
      fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Ekranı kilidlə" }));
      await screen.findByRole("heading", { level: 1, name: "Ekran kilidlənib" });
      act(() => {
        stream.onmessage({ data: JSON.stringify({ patient_id: "P-002", risk: "critical", vitals: {}, alerts: [
          { kind: "septic_shock", severity: "critical", summary: "sintetik", first_seen_at: "2026-10-04T08:01:00Z", acknowledged: false },
        ] }) });
      });
      await waitFor(() => expect(audio.pulses().slice(3)).toEqual(Array(10).fill(960)));
    } finally {
      page.undo();
    }
  });

  it("lets someone else sign in instead, with no password", async () => {
    const api = await ready();
    act(() => { fireEvent.keyDown(document, { key: "l", code: "KeyL", altKey: true }); });
    fireEvent.click(await screen.findByRole("button", { name: "Başqa istifadəçi ilə giriş" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Daxil olun" })).toBeInTheDocument();
    expect(api.logout).toHaveBeenCalled();
  });

  it("opens on the lock screen after a reload when this browser is locked", async () => {
    writeLock({ user: "u-ayse", at: Date.now(), why: "idle" });
    app({ access: NURSE, me: profile() });
    expect(await screen.findByRole("heading", { level: 1, name: "Ekran kilidlənib" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("says it cannot know rather than 'no open alarms' when the board is unreachable", async () => {
    writeLock({ user: "u-ayse", at: Date.now(), why: "manual" });
    const api = app({ access: NURSE, me: profile(), board: new Error("Failed to fetch") });
    const counts = await screen.findByRole("region", { name: "Bölmələrinizdəki açıq siqnalların sayı" });
    await waitFor(() => expect(counts).toHaveTextContent("Siqnal məlumatı alına bilmir"));
    await waitFor(() => expect(api.boardPatients).toHaveBeenCalledTimes(2));        // the stream opened: reloaded
    expect(counts).toHaveTextContent("Siqnal məlumatı alına bilmir");               // and still cannot know
    expect(counts).not.toHaveTextContent("yoxdur");
  });
});

// A ward PC is shared. The hash names a patient, and the browser keeps it in its history and in
// the window's title: both must go with the session, or the next person who signs in is taken
// straight to the last one's patient.
describe("what the next person at the workstation finds", () => {
  async function onPatient() {
    const api = app();
    built({ patient: PatientProbe });
    await signIn(api);
    await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
    await act(async () => {
      window.location.hash = "#/patients/P-001";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await screen.findByRole("heading", { level: 1, name: "Xəstə P-001" });
    expect(document.title).toBe(`Xəstə · ${PRODUCT}`);
    return api;
  }

  it("neither the address nor the title, after a sign-out", async () => {
    const api = await onPatient();
    fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Çıxış" }));
    await screen.findByRole("heading", { level: 1, name: "Daxil olun" });
    expect(window.location.hash).toBe("");
    expect(document.title).toBe(PRODUCT);
    expect(api.logout).toHaveBeenCalled();
  });

  it("neither after a lock — and unlocking opens the home screen, not the patient", async () => {
    const api = await onPatient();
    act(() => { fireEvent.keyDown(document, { key: "l", code: "KeyL", altKey: true }); });
    await screen.findByRole("heading", { level: 1, name: "Ekran kilidlənib" });
    expect(window.location.hash).toBe("");
    expect(document.title).toBe(PRODUCT);
    expect(document.body).not.toHaveTextContent("P-001");
    api.reauth.mockResolvedValueOnce({ ok: true });
    fireEvent.change(screen.getByLabelText("Şifrə"), { target: { value: "Gizli-Sifre-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Kilidi aç" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/settings"));
  });

  // The one address that stays: a session being CHECKED is still this clinician's, so a reload
  // (F5 on a ward PC) leaves her where she was.
  it("but a reload keeps the screen the clinician was on", async () => {
    built({ beds: BedsProbe });
    window.location.hash = "#/beds";
    app({ access: NURSE, me: profile() });
    expect(await screen.findByRole("heading", { level: 1, name: "Çarpayı ekranı" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/beds");
  });
});

// The address is cleared while the shell is gone, but the clinician's place is not lost: the same
// session comes back to the screen it left. Kept outside the URL, so neither a reload nor the next
// person at the keyboard can reach it, and never across a session.
describe("coming back to the screen she left", () => {
  async function lockedOn(path, screens) {
    const api = app();
    built(screens);
    await signIn(api);
    await screen.findByRole("heading", { level: 1, name: "Çarpayı ekranı" });   // home: /beds
    await act(async () => {
      window.location.hash = `#${path}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    act(() => { fireEvent.keyDown(document, { key: "l", code: "KeyL", altKey: true }); });
    await screen.findByRole("heading", { level: 1, name: "Ekran kilidlənib" });
    expect(window.location.hash).toBe("");                                      // throughout the lock
    return api;
  }

  async function unlock(api) {
    api.reauth.mockResolvedValueOnce({ ok: true });
    fireEvent.change(screen.getByLabelText("Şifrə"), { target: { value: "Gizli-Sifre-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Kilidi aç" }));
  }

  it("unlocks onto the screen that was locked", async () => {
    const api = await lockedOn("/alarms", { beds: BedsProbe, alarms: AlarmsProbe });
    await unlock(api);
    expect(await screen.findByRole("heading", { level: 1, name: "Siqnal ekranı" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/alarms"));
  });

  // A patient is the one screen it does not reopen: the lock exists so that what was on it is
  // gone, and nobody unlocking at a shared station should be handed a patient back.
  it("unlocks onto the home screen when a patient was open", async () => {
    const api = await lockedOn("/patients/P-001", { beds: BedsProbe, patient: PatientProbe });
    await unlock(api);
    expect(await screen.findByRole("heading", { level: 1, name: "Çarpayı ekranı" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/beds"));
    expect(screen.queryByText(/P-001/)).toBeNull();
  });

  it("forgets it at a sign-out: the next session starts at its own home", async () => {
    const api = app();
    built({ beds: BedsProbe, alarms: AlarmsProbe });
    await signIn(api);
    await screen.findByRole("heading", { level: 1, name: "Çarpayı ekranı" });
    await act(async () => {
      window.location.hash = "#/alarms";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await screen.findByRole("heading", { level: 1, name: "Siqnal ekranı" });
    fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Çıxış" }));
    await screen.findByRole("heading", { level: 1, name: "Daxil olun" });
    expect(window.location.hash).toBe("");
    await signIn(api);
    expect(await screen.findByRole("heading", { level: 1, name: "Çarpayı ekranı" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/beds"));
  });

  // A shell's rail links PUSH history entries, and a sign-out replaces only the entry the page is
  // on: the previous session's screens stay in the browser's history. One press of Back at the
  // sign-in screen puts the last person's screen back into the address bar — and a shell that
  // honoured the bar would open there. With G1-11 built, two presses reach her patient.
  it("ignores the address bar when a Back press has filled it with the last session's screen", async () => {
    const api = app();
    built({ beds: BedsProbe, alarms: AlarmsProbe, patient: PatientProbe });
    await signIn(api);
    await screen.findByRole("heading", { level: 1, name: "Çarpayı ekranı" });
    // As her rail links would, two screens deep.
    for (const to of ["#/alarms", "#/patients/P-001"]) {
      await act(async () => {
        window.history.pushState(null, "", to);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
    }
    await screen.findByRole("heading", { level: 1, name: "Xəstə P-001" });
    const depth = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Çıxış" }));
    await screen.findByRole("heading", { level: 1, name: "Daxil olun" });
    expect(window.location.hash).toBe("");
    // The entries her rail links pushed are still in the history: a sign-out replaces only the
    // entry the page is on, so Back at the sign-in screen does reach her screens.
    expect(window.history.length).toBe(depth);
    // What such a press leaves behind — the previous session's address, in the bar, with the
    // sign-in screen up. Set here rather than traversed: jsdom needs two back() calls to move one
    // entry past a hash-less replaceState, which would test jsdom and not this shell.
    await act(async () => {
      window.location.hash = "#/alarms";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await signIn(api, { me: profile({ id: "u-bahar", username: "bahar", full_name: "Bahar Sentetik" }) });
    expect(await screen.findByRole("heading", { level: 1, name: "Çarpayı ekranı" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/beds"));
    expect(screen.queryByText(/P-001/)).toBeNull();
  });

  it("opens a bookmarked address after the sign-in it asked for", async () => {
    built({ beds: BedsProbe, alarms: AlarmsProbe });
    window.location.hash = "#/alarms";
    const api = app();
    await screen.findByRole("heading", { level: 1, name: "Daxil olun" });
    expect(window.location.hash).toBe("");                     // not left in the address meanwhile
    await signIn(api);
    expect(await screen.findByRole("heading", { level: 1, name: "Siqnal ekranı" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/alarms"));
  });

  // StrictMode mounts, unmounts and mounts again; the entry address must not be read away by the
  // rehearsal and then be gone for the real one.
  it("opens a bookmarked address under StrictMode's rehearsal mount too", async () => {
    built({ beds: BedsProbe, alarms: AlarmsProbe });
    window.location.hash = "#/alarms";
    const api = app({ strict: true });
    await screen.findByRole("heading", { level: 1, name: "Daxil olun" });
    await signIn(api);
    expect(await screen.findByRole("heading", { level: 1, name: "Siqnal ekranı" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/alarms"));
  });

  it("keeps her place across an outage she retries", async () => {
    built({ beds: BedsProbe, alarms: AlarmsProbe });
    window.location.hash = "#/alarms";
    app({ access: NURSE,
      setup: (a) => a.me.mockRejectedValueOnce(refusal(503, "upstream")).mockResolvedValue(profile()) });
    await screen.findByRole("heading", { level: 1, name: "Serverə qoşulmaq mümkün deyil" });
    fireEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Siqnal ekranı" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe("#/alarms"));
  });
});

// A personal session always locks (the user's standing decision; there is no "never"). The step
// screens have no shell to lock behind — nothing of a session is open yet — so an idle one ENDS,
// and the warning says so. Without it, the forced password change sat on a ward keyboard for as
// long as nobody touched it: migration 0011 sends every local account to it at its first sign-in.
describe("a step screen nobody touches", () => {
  // The fake-timer recipe: installed BEFORE mount, nothing advancing on its own, and `flush` —
  // one turn of the REAL event loop inside act() — in place of waitFor, which would wait on the
  // fake clock and never return.
  const realSetTimeout = globalThis.setTimeout;
  const FAKE = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
  const flush = () => act(() => new Promise((resolve) => { realSetTimeout(resolve, 0); }));

  /** Sign in with fake timers running: the same keys as `signIn`, without any findBy. */
  async function stepIn(api, tokens, me) {
    api.login.mockImplementation(async () => { api.store(tokens.access_token); return tokens; });
    api.me.mockResolvedValue(me);
    await flush();
    fireEvent.change(screen.getByLabelText(/^İstifadəçi adı \*$/), { target: { value: "ayse" } });
    fireEvent.change(screen.getByLabelText(/^Şifrə \*$/), { target: { value: "Gizli-Sifre-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Daxil ol/ }));
    await flush();
  }

  it("warns that the session will end — not that the screen will lock — and then ends it", async () => {
    vi.useFakeTimers(FAKE);
    const api = app();
    await stepIn(api, { access_token: NURSE, password_change_required: true },
      profile({ must_change_password: true, lock_idle_minutes: 2 }));
    expect(screen.getByRole("heading", { level: 1, name: "Yeni şifrə təyin edin" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByText("Sessiya bağlanacaq")).toBeInTheDocument();
    expect(screen.queryByText("Ekran kilidlənəcək")).toBeNull();
    act(() => { vi.advanceTimersByTime(ANNOUNCE_DELAY_MS); });
    expect(screen.getAllByRole("status").map((el) => el.textContent).filter(Boolean)[0])
      .toMatch(/Sessiya \d+ saniyə ərzində bağlanacaq/);
    // "Davam et" keeps her there, as it does in the shell.
    fireEvent.click(screen.getByRole("button", { name: "Davam et" }));
    expect(screen.queryByText("Sessiya bağlanacaq")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Yeni şifrə təyin edin" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(121_000); });
    await flush();
    expect(screen.getByRole("heading", { level: 1, name: "Daxil olun" })).toBeInTheDocument();
    expect(api.logout).toHaveBeenCalled();
  });

  it("ends an idle TOTP step too", async () => {
    vi.useFakeTimers(FAKE);
    const api = app();
    await stepIn(api, { access_token: PENDING, requires_mfa: true, mfa_enrolled: true },
      profile({ id: "u-kaya", totp_enabled: true, lock_idle_minutes: 2 }));
    expect(screen.getByRole("heading", { level: 1, name: "İki addımlı doğrulama" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(121_000); });
    await flush();
    expect(screen.getByRole("heading", { level: 1, name: "Daxil olun" })).toBeInTheDocument();
  });

  // The sign-in form holds no session to end, and the shell locks instead (Shell.jsx).
  it("leaves the sign-in form alone, however long nobody touches it", async () => {
    vi.useFakeTimers(FAKE);
    const api = app();
    await flush();
    act(() => { vi.advanceTimersByTime(600_000); });
    await flush();
    expect(screen.getByRole("heading", { level: 1, name: "Daxil olun" })).toBeInTheDocument();
    expect(api.logout).not.toHaveBeenCalled();
  });
});

describe("signing out", () => {
  it("empties the session: the form, a notice, no board, no tokens", async () => {
    const api = app();
    await signIn(api);
    await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
    fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Çıxış" }));
    await spoken("Təhlükəsiz çıxış edildi.");
    expect(api.logout).toHaveBeenCalled();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

// A write that began before a lock or a sign-out answers whenever the server does, and its refusal
// names a bed or an account. The lock screen names no one; but the clinician who unlocks must still
// learn the outcome — a refusal is never swallowed — and nobody else ever may.
describe("a write that answers while the shell is gone", () => {
  const notes = () => screen.getByRole("region", { name: "Bildirişlər" });

  async function onWriter() {
    const probe = writer();
    const api = app();
    built({ beds: BedsProbe, alarms: probe.WriteProbe });
    await signIn(api);
    await screen.findByRole("heading", { level: 1, name: "Çarpayı ekranı" });
    await act(async () => {
      window.location.hash = "#/alarms";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await screen.findByRole("heading", { level: 1, name: "Siqnal ekranı" });
    return { api, answers: probe.answers };
  }

  it("is held off the lock screen and shown at the unlock", async () => {
    const { api, answers } = await onWriter();
    fireEvent.click(screen.getByRole("button", { name: "Yaz" }));
    act(() => { fireEvent.keyDown(document, { key: "l", code: "KeyL", altKey: true }); });
    await screen.findByRole("heading", { level: 1, name: "Ekran kilidlənib" });
    await act(async () => { answers[0]("Çarpayı 4 · news2: icazə yoxdur"); });
    await act(settle);
    expect(document.body).not.toHaveTextContent("Çarpayı 4");
    api.reauth.mockResolvedValueOnce({ ok: true });
    fireEvent.change(screen.getByLabelText("Şifrə"), { target: { value: "Gizli-Sifre-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Kilidi aç" }));
    await screen.findByRole("heading", { level: 1, name: "Siqnal ekranı" });
    expect(within(notes()).getByRole("alert")).toHaveTextContent(/^Xəta: Çarpayı 4 · news2: icazə yoxdur$/);
  });

  it("never appears once its session has ended — not held for the next one, not after its sign-in", async () => {
    const { api, answers } = await onWriter();
    fireEvent.click(screen.getByRole("button", { name: "Yaz" }));
    fireEvent.click(screen.getByRole("button", { name: "Yaz" }));
    fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Çıxış" }));
    await screen.findByRole("heading", { level: 1, name: "Daxil olun" });
    await act(async () => { answers[0]("Çarpayı 4 · birinci"); });
    await act(settle);
    expect(document.body).not.toHaveTextContent("Çarpayı 4");
    await signIn(api);
    await screen.findByRole("heading", { level: 1, name: "Çarpayı ekranı" });
    expect(document.body).not.toHaveTextContent("Çarpayı 4");
    await act(async () => { answers[1]("Çarpayı 4 · ikinci"); });
    await act(settle);
    expect(document.body).not.toHaveTextContent("Çarpayı 4");
    expect(within(notes()).getByRole("alert")).toBeEmptyDOMElement();
  });
});

describe("the bell", () => {
  it("lists the alarms nobody has acknowledged", async () => {
    const api = app();
    await signIn(api);
    const bell = await screen.findByRole("button", { name: /Cavab gözləyən siqnallar · 1 siqnal cavab gözləyir/ });
    fireEvent.click(bell);
    const panel = screen.getByRole("region", { name: /Cavab gözləyən siqnallar/ });
    expect(within(panel).getByText("REA-01")).toBeInTheDocument();
    expect(within(panel).getByText("NEWS2 7")).toBeInTheDocument();
  });

  it("never shows 'none' when it cannot know — not even once the stream opened", async () => {
    const api = app({ board: new Error("Failed to fetch") });
    await signIn(api);
    expect(await screen.findByRole("button", { name: /Siqnal məlumatı alına bilmir/ })).toBeInTheDocument();
    await waitFor(() => expect(api.boardPatients).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /Siqnal məlumatı alına bilmir/ })).toBeInTheDocument();
  });

  it("takes the shell to the password step when the board answers that the password was reset", async () => {
    const api = app({ board: Object.assign(new Error("password_change_required"), { status: 403 }) });
    await signIn(api);
    expect(await screen.findByRole("heading", { level: 1, name: "Yeni şifrə təyin edin" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("is not there for an account that cannot see the board", async () => {
    const admin = token({ sub: "u-admin", groups: ["user_desk"], perms: ["users.manage"] });
    const api = app();
    await signIn(api, { tokens: { access_token: admin }, me: profile({ id: "u-admin" }) });
    await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
    expect(screen.queryByRole("button", { name: /Cavab gözləyən siqnallar/ })).toBeNull();
    expect(api.boardPatients).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { fakeAudio, fakeNotifications, onPage } from "../../signals/fakeAudio.testutil.js";
import { SettingsScreen } from "./SettingsScreen.jsx";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const tab = (name) => fireEvent.click(screen.getByRole("tab", { name }));

describe("SettingsScreen", () => {
  it("changes a local account's password and says so", async () => {
    const { api } = await mount(<SettingsScreen />);
    tab("Təhlükəsizlik");
    api.changePassword.mockResolvedValue({ access_token: token() });
    fireEvent.change(screen.getByLabelText(/^Cari şifrə/), { target: { value: "Gizli-Sifre-1" } });
    fireEvent.change(screen.getByLabelText(/^Yeni şifrə \*/), { target: { value: "Yeni-Sifre-22" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifrə \(təkrar\)/), { target: { value: "Yeni-Sifre-22" } });
    fireEvent.click(screen.getByRole("button", { name: "Şifrəni dəyiş" }));
    await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith("Gizli-Sifre-1", "Yeni-Sifre-22"));
    expect(await screen.findByText("Şifrəniz dəyişdi.", { selector: "span" })).toBeInTheDocument();
  });

  it("sends an AD account to the hospital's own way of changing it", async () => {
    await mount(<SettingsScreen />, { me: profile({ auth_source: "ldap" }) });
    tab("Təhlükəsizlik");
    expect(screen.getByRole("note")).toHaveTextContent(/xəstəxana hesabınızla idarə olunur/);
    expect(screen.queryByLabelText(/^Cari şifrə/)).toBeNull();
  });

  it("shows the hospital's lock time, the two-step state, and the profile the server reports", async () => {
    await mount(<SettingsScreen />, { me: profile({ lock_idle_minutes: 7, totp_enabled: true }) });
    expect(screen.getByRole("heading", { level: 1, name: "Ayarlar" })).toBeInTheDocument();
    tab("Təhlükəsizlik");
    expect(screen.getByText("7 dəq hərəkətsizlikdən sonra")).toBeInTheDocument();
    expect(screen.getByText("Açıq")).toBeInTheDocument();
    tab("Profil");
    expect(screen.getByText("Sentetik Hastane")).toBeInTheDocument();
    expect(screen.getByText("Hemşire")).toBeInTheDocument();
    expect(screen.getByText("Yerli hesab")).toBeInTheDocument();
  });

  it("changes the language of this browser from the appearance tab", async () => {
    await mount(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });
});

// The alarm sound and the critical-alarm notification (signals/AlarmSignals.jsx). The previous
// workspace had two top-bar buttons for them; here they are this browser's settings.
describe("SettingsScreen · sound and notifications", () => {
  let page = null;
  afterEach(() => {
    page?.undo();
    page = null;
  });
  const flush = () => act(() => new Promise((resolve) => { setTimeout(resolve, 0); }));
  const sound = () => screen.getByRole("group", { name: "Siqnal səsi" });

  it("turns the sound on for this browser — the click that does it starts the audio — and offers a test", async () => {
    const audio = fakeAudio();
    page = onPage({ AudioContext: audio.AudioContext });
    await mount(<SettingsScreen />);
    tab("Səs və bildiriş");
    expect(within(sound()).getByRole("button", { name: "Bağlı" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(sound()).getByRole("button", { name: "Açıq" }));
    await flush();
    expect(localStorage.getItem("hmc.alarmSound")).toBe("on");
    expect(screen.getByText("Hazırdır")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Səsi yoxla" }));
    expect(audio.pulses()).toEqual(Array(10).fill(960));
  });

  // A browser that has not let the audio start yet: what a ward PC shows after a reload nobody has
  // touched (here the tab's own click would start it, so the fake refuses).
  it("says a wanted sound is waiting for a click after a reload, and why", async () => {
    localStorage.setItem("hmc.alarmSound", "on");
    page = onPage({ AudioContext: fakeAudio({ refuse: true }).AudioContext });
    await mount(<SettingsScreen />);
    tab("Səs və bildiriş");
    expect(screen.getByText("Bir klik gözləyir")).toBeInTheDocument();
    expect(screen.getByText(/kimsə səhifəyə toxunana qədər səs çıxmır/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siqnal səsi gözləmədədir — açmaq üçün klikləyin" })).toBeInTheDocument();
  });

  it("asks the browser for notifications only on a click, says what it answered, and offers a test", async () => {
    const notes = fakeNotifications("default");
    page = onPage({ Notification: notes.Notification });
    await mount(<SettingsScreen />);
    tab("Səs və bildiriş");
    expect(screen.getByText("İcazə verilməyib")).toBeInTheDocument();
    expect(notes.Notification.requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "İcazə ver" }));
    await flush();
    expect(screen.getByText("İcazə verilib")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bildirişi yoxla" }));
    expect(notes.shown.map((n) => [n.title, n.options.requireInteraction])).toEqual([["Homunculus · yoxlama", false]]);
  });

  // A plain-HTTP page: the browser refuses notifications there (it may not even expose the API),
  // and the screen says why — not that this browser cannot.
  it("says notifications are unavailable on an address that is not secure, and why", async () => {
    page = onPage({ secure: false });
    await mount(<SettingsScreen />);
    tab("Səs və bildiriş");
    expect(screen.getByText("Əlçatan deyil")).toBeInTheDocument();
    expect(screen.getByText("Brauzer bildirişləri yalnız təhlükəsiz (HTTPS) ünvanda işləyir.")).toBeInTheDocument();
  });

  // The pattern is the previous workspace's, ported number for number. It is not IEC 60601-1-8's
  // (its critical burst outlasts its own repeat), and nobody has reviewed it against the standard:
  // the screen claims no standard.
  it("claims no clinical standard for the sound's pattern", async () => {
    await mount(<SettingsScreen />);
    tab("Səs və bildiriş");
    expect(screen.getByText(/Cavab gözləyən siqnal olanda bu kompüterdə çalınır/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/IEC/);
  });

  it("says what is missing: no Web Audio, a permission the browser has blocked", async () => {
    page = onPage({ Notification: fakeNotifications("denied").Notification });
    await mount(<SettingsScreen />);
    tab("Səs və bildiriş");
    fireEvent.click(within(sound()).getByRole("button", { name: "Açıq" }));
    await flush();
    expect(screen.getByText(/Bu brauzer səs çala bilmir/)).toBeInTheDocument();
    expect(screen.getByText("Bloklanıb")).toBeInTheDocument();
    expect(screen.getByText(/Brauzer bildirişləri bloklayıb/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "İcazə ver" })).toBeNull();
  });
});

// Aşama A: what the unvalidated monitor strip is, said where the sound and the notifications are —
// and only while the hospital has it on.
describe("SettingsScreen — the monitor strip's legend", () => {
  async function legend(answer) {
    const mounted = await mount(<SettingsScreen />);
    mounted.api.shadowBoard.mockResolvedValue(answer);
    await act(async () => { mounted.shadow.start(["board.view", "alerts.ack"]); });
    tab("Səs və bildiriş");
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    return mounted;
  }

  it("with the stage on explains it: the note, never a sound, the ages, NIBP, the evidence, no sample count", async () => {
    await legend({ stage: "shadow", beds: [], unassigned: [], feed: { state: "ok" } });
    const box = screen.getByRole("heading", { level: 2, name: "Monitor zolağı (təsdiqlənməmiş)" }).closest("div.rounded-box");
    expect(box).toHaveTextContent(/tədqiqat məqsədilə deşifrə olunur və təsdiqlənməyib/);
    expect(box).toHaveTextContent("Bu zolaq heç vaxt səs çıxarmır, bildiriş göndərmir, siqnal siyahısına və «Cavab gözləyən siqnallar» siyahısına düşmür.");
    expect(box).toHaveTextContent(/15 saniyədən köhnə dəyər göstərilmir/);
    expect(box).toHaveTextContent(/NIBP bu mərhələdə göstərilmir/);
    expect(box).toHaveTextContent("Heç bir parametr üçün nümunə sayı qeydə alınmayıb.");
    expect(box).toHaveTextContent("əvəzində «köhnə» və son dəyərin yaşı yazılır");     // the cell shows an age
    const table = within(box).getByRole("table", { name: "Hər parametr üzrə bugünkü sübut" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Parametr", "Hər parametr üzrə bugünkü sübut"]);
    const rows = within(table).getAllByRole("row").slice(1);
    const labels = rows.map((r) => within(r).getByRole("rowheader").textContent);
    expect(labels).toEqual(["HR", "PLS", "SpO₂", "etCO₂", "Ta", "ART S", "ART D", "ART M", "RESP", "NBP"]
      .map((p) => expect.stringContaining(p)));
    const partial = labels.filter((label) => label.includes("qismən")).map((label) => label.replace("qismən", ""));
    expect(partial).toEqual(["Ta", "ART D", "ART M", "RESP"]);
    expect(within(rows[0]).getByText("İki cihazda monitor ekranı ilə eynidir")).toBeInTheDocument();
  });

  it("with the stage off shows no legend", async () => {
    await legend({ stage: "off" });
    expect(screen.queryByRole("heading", { name: "Monitor zolağı (təsdiqlənməmiş)" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Siqnal səsi" })).toBeInTheDocument();
  });
});

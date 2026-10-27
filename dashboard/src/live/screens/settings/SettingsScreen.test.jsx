import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ddmm, hhmm } from "../../i18n/dates.js";
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

  it("with the stage on explains it: the note, never a sound, the ages, NBP's time, the evidence, no sample count", async () => {
    await legend({ stage: "shadow", beds: [], unassigned: [], feed: { state: "ok" } });
    const box = screen.getByRole("heading", { level: 2, name: "Monitor zolağı (təsdiqlənməmiş)" }).closest("div.rounded-box");
    expect(box).toHaveTextContent(/tədqiqat məqsədilə deşifrə olunur və təsdiqlənməyib/);
    expect(box).toHaveTextContent("heç bir siqnal, bal (NEWS2 daxil olmaqla), bildiriş və ya səs yaradılmır");
    expect(box).not.toHaveTextContent("kölgə bal");
    expect(box).toHaveTextContent("Bu zolaq heç vaxt səs çıxarmır, bildiriş göndərmir, siqnal siyahısına və «Cavab gözləyən siqnallar» siyahısına düşmür.");
    expect(box).toHaveTextContent(/15 saniyədən köhnə dəyər göstərilmir/);
    expect(box).toHaveTextContent(/NBP dəyərinin son dəyişdiyi saatla göstərilir/);
    expect(box).toHaveTextContent(/ən gec 10:42-də ölçdüyü deməkdir: dəyər ən azı/);   // the example and the bound are one sentence (X49): the NBSP after "≤" is inside the «» quote, not here
    expect(box).toHaveTextContent(/ən azı bu qədər köhnədir/);   // the time is a bound: the value is at least this old (X49)
    expect(box).toHaveTextContent(/Dəyəri 2 saatdan çox dəyişməyən NBP göstərilmir/);
    expect(box).toHaveTextContent(/monitorun məlumatı kəsik ikən dəyər dəyişibsə dəyişiklik fərq edilməyib/);   // a value that CHANGED during the interruption is untimed (X48, final review M-4; NBP-2)
    // NBP-2 (D4): no change seen — the monitor's current value, with «ölçmə vaxtı məlum deyil» until the
    // next cuff measurement that changes it; no 2-hour limit can apply to it, and a triple that is not
    // complete and valid still waits.
    expect(box).toHaveTextContent(/dəyəri dəyişən növbəti manjet ölçməsinə qədər «ölçmə vaxtı məlum deyil» qeydi ilə göstərilir/);
    expect(box).toHaveTextContent(/monitorun hazırda göstərdiyi dəyərdir, nə vaxt ölçüldüyü məlum deyil və 2 saat həddi ona tətbiq edilə bilməz/);
    expect(box).toHaveTextContent(/üç NBP dəyəri tam və etibarlı deyilsə NBP heç göstərilmir \(«ölçmə gözlənilir»\)/);
    expect(box).not.toHaveTextContent(/dəyəri dəyişən növbəti ölçməyə qədər göstərilmir/);   // the R4 sentence: an untimed NBP is shown now
    expect(box).toHaveTextContent(/əvvəlki xəstənin ola bilər \(ən çox 2 saat; ölçmə vaxtı məlum deyilsə daha uzun\)/);   // a changed patient's bed (X49); untimed, longer (NBP-2 O2)
    expect(box).not.toHaveTextContent(/bu mərhələdə göstərilmir/);
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
    expect(within(rows[9]).getByText("Monitor ekranı ilə eynidir")).toBeInTheDocument();          // NBP
  });

  // Aşama B: at «rules» the shadow engine scores these values (advice, alarm off) — the «shadow» stage's
  // sentence that no score comes from them would be false, so the legend says what the rules do instead.
  it("at the rules stage says an advisory shadow score is computed from the values — and still no alarm, no sound", async () => {
    await legend({ stage: "rules", beds: [], unassigned: [], feed: { state: "ok" } });
    const box = screen.getByRole("heading", { level: 2, name: "Monitor zolağı (təsdiqlənməmiş)" }).closest("div.rounded-box");
    expect(box).toHaveTextContent(/tədqiqat məqsədilə deşifrə olunur və təsdiqlənməyib/);
    expect(box).toHaveTextContent("heç bir siqnal, bildiriş və ya səs yaradılmır və heç bir sayğaca daxil olmur");
    expect(box).toHaveTextContent("yalnız tövsiyə xarakterli kölgə bal hesablanır");
    expect(box).toHaveTextContent("«Kölgə tövsiyə · siqnal söndürülüb»");
    expect(box).not.toHaveTextContent("bal (NEWS2 daxil olmaqla)");
    expect(box).toHaveTextContent("Bu zolaq heç vaxt səs çıxarmır, bildiriş göndərmir, siqnal siyahısına və «Cavab gözləyən siqnallar» siyahısına düşmür.");
  });

  it("with the stage off shows no legend", async () => {
    await legend({ stage: "off" });
    expect(screen.queryByRole("heading", { name: "Monitor zolağı (təsdiqlənməmiş)" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Siqnal səsi" })).toBeInTheDocument();
  });
});

// Aşama B (D7): the week's list of what the shadow engine would have alerted on — Settings, in the tab
// that holds the monitor legend, and only while the hospital runs the rules.
describe("SettingsScreen — «Uyarsaydı — son 7 gün» (Aşama B)", () => {
  const OPENED_A = "2026-10-27T05:10:00+00:00";
  const OPENED_B = "2026-10-26T09:00:00+00:00";
  const CLEARED_B = "2026-10-26T09:40:00+00:00";
  // Every row the API sends carries its `relation` to the real engine's findings (D6); the week is the
  // `shadow_only` ones — what would have alerted that nothing else did.
  const row = (over) => ({ relation: "shadow_only", cleared_at: null, ...over });
  const WEEK = { days: 7, findings: [
    row({ patient_id: "S-002", kind: "sepsis", severity: "critical", opened_at: OPENED_A }),
    row({ patient_id: "S-001", kind: "news2", severity: "high", opened_at: OPENED_B, cleared_at: CLEARED_B }),
  ] };
  const RULES = { stage: "rules", beds: [], unassigned: [], feed: { state: "ok" } };
  const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
  const stamp = (iso) => `${ddmm(Date.parse(iso))} ${hhmm(Date.parse(iso))}`;
  const section = () => document.querySelector("[data-shadow-week]");
  const rowheaders = () => within(within(section()).getByRole("table")).getAllByRole("rowheader").map((h) => h.textContent);

  async function week(answer, list, perms = ["board.view", "alerts.ack"]) {
    const mounted = await mount(<SettingsScreen />, { access: token({ perms }), me: profile({ perms }) });
    mounted.api.shadowBoard.mockResolvedValue(answer);
    if (typeof list === "function") mounted.api.shadowFindings.mockImplementation(list);
    else if (list instanceof Error) mounted.api.shadowFindings.mockRejectedValue(list);
    else mounted.api.shadowFindings.mockResolvedValue(list);
    await act(async () => { mounted.shadow.start(perms); });
    tab("Səs və bildiriş");
    await settle();
    await settle();
    return mounted;
  }

  it("lists the week: five columns, the API's order, the opening and closing stamps as dd.MM hh:mm, «açıq» for an open one", async () => {
    const { api } = await week(RULES, WEEK);
    expect(api.shadowFindings).toHaveBeenCalledWith(7);
    expect(screen.getByRole("heading", { level: 2, name: "Xəbərdarlıq edərdi — son 7 gün" })).toBeInTheDocument();
    expect(section()).toHaveTextContent(/Yalnız kölgədə açılan tapıntılar/);
    const table = within(section()).getByRole("table", { name: "Xəbərdarlıq edərdi — son 7 gün" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Xəstə", "Tapıntı", "Səviyyə", "Açılış", "Bağlanış"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => [within(r).getByRole("rowheader").textContent, ...within(r).getAllByRole("cell").map((c) => c.textContent)])).toEqual([
      ["S-002", "sepsis", "Kritik", stamp(OPENED_A), "açıq"],
      ["S-001", "news2", "Yüksək", stamp(OPENED_B), stamp(CLEARED_B)],
    ]);
  });

  it("is a dashed box in the legend's tab, after the legend, and says it is for the weekly review", async () => {
    await week(RULES, WEEK);
    const legend = screen.getByRole("heading", { level: 2, name: "Monitor zolağı (təsdiqlənməmiş)" });
    expect(legend.compareDocumentPosition(section()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section().querySelector(".rounded-box").className).toContain("!border-dashed");
    expect(screen.getByRole("tabpanel")).toContainElement(section());
  });

  it("says there is nothing when the list is empty", async () => {
    await week(RULES, { days: 7, findings: [] });
    expect(section()).toHaveTextContent("Son 7 gündə kölgə tapıntı yoxdur.");
    expect(within(section()).queryByRole("table")).toBeNull();
  });

  it("lists only what the shadow alone opened: a finding the real engine also had, or had at another level, would not have alerted", async () => {
    await week(RULES, { days: 7, findings: [
      row({ patient_id: "S-004", kind: "news2", severity: "high", relation: "same", opened_at: OPENED_A }),
      row({ patient_id: "S-005", kind: "sepsis", severity: "critical", relation: "level_differs", opened_at: OPENED_A }),
      row({ patient_id: "S-006", kind: "hypotension", severity: "moderate", opened_at: OPENED_B, cleared_at: CLEARED_B }),
    ] });
    expect(rowheaders()).toEqual(["S-006"]);
    expect(section()).not.toHaveTextContent("S-004");
    expect(section()).not.toHaveTextContent("S-005");
  });

  it("says there is nothing when no row of the list is shadow-only", async () => {
    await week(RULES, { days: 7, findings: [
      row({ patient_id: "S-004", kind: "news2", severity: "high", relation: "same", opened_at: OPENED_A }),
      row({ patient_id: "S-005", kind: "sepsis", severity: "critical", relation: "level_differs", opened_at: OPENED_A }),
    ] });
    expect(section()).toHaveTextContent("Son 7 gündə kölgə tapıntı yoxdur.");
    expect(within(section()).queryByRole("table")).toBeNull();
    expect(section()).not.toHaveTextContent("S-004");
  });

  // Measured at 390 px: the box is an item of the Signals grid, and a grid item's `min-width: auto`
  // let the five-column table widen the page to 431–558 px instead of scrolling inside its own frame.
  // jsdom has no layout, so the class that makes the frame work is what is held here.
  it("may shrink below its table's width, so the table scrolls in its own frame at 390 px", async () => {
    await week(RULES, WEEK);
    expect(section().className.split(/\s+/)).toContain("min-w-0");
    expect(section().parentElement.className.split(/\s+/)).toContain("grid");   // the Signals grid it is an item of
    expect(within(section()).getByRole("table").closest(".overflow-x-auto")).not.toBeNull();   // Table's own frame
  });

  // The route is `board.view`'s: a session holding only `devices.manage` reaches this tab (and the legend,
  // whose strip it may read) but would be refused the list every time.
  it("is not drawn, and the list is not asked for, for a session that may not read the board", async () => {
    const { api } = await week(RULES, WEEK, ["devices.manage"]);
    expect(screen.getByRole("heading", { level: 2, name: "Monitor zolağı (təsdiqlənməmiş)" })).toBeInTheDocument();
    expect(section()).toBeNull();
    expect(screen.queryByText(/son 7 gün/)).toBeNull();
    expect(api.shadowFindings).not.toHaveBeenCalled();
    cleanup();
    const both = await week(RULES, WEEK, ["devices.manage", "board.view"]);
    expect(section()).not.toBeNull();
    expect(both.api.shadowFindings).toHaveBeenCalledWith(7);
  });

  it("says the list is unavailable when it cannot be read — a refusal, an outage, or a body that is not a list", async () => {
    for (const list of [Object.assign(new Error("forbidden"), { status: 403 }), new Error("down"), { days: 7 }]) {
      await week(RULES, list);
      expect(within(section()).getByRole("note")).toHaveTextContent("Kölgə siyahı oxuna bilmədi.");
      expect(within(section()).queryByRole("table")).toBeNull();
      expect(section()).not.toHaveTextContent("Son 7 gündə kölgə tapıntı yoxdur.");   // an unread list is not an empty one
      cleanup();
    }
  });

  it("says it is reading while the list is on its way, and nothing about it being empty", async () => {
    let release;
    await week(RULES, () => new Promise((resolve) => { release = resolve; }));
    expect(section()).toHaveTextContent("Siyahı oxunur…");
    expect(section()).not.toHaveTextContent("kölgə tapıntı yoxdur");
    await act(async () => { release(WEEK); });
    expect(section()).not.toHaveTextContent("Siyahı oxunur…");
    expect(within(section()).getByRole("table")).toBeInTheDocument();
  });

  it("is not there at the shadow stage or with the stage off — and the list is never asked for", async () => {
    for (const answer of [{ stage: "shadow", beds: [], unassigned: [], feed: { state: "ok" } }, { stage: "off" }]) {
      const { api } = await week(answer, WEEK);
      expect(section(), answer.stage).toBeNull();
      expect(screen.queryByText(/son 7 gün/)).toBeNull();
      expect(api.shadowFindings, answer.stage).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("asks again when the tab is opened again, and not on every poll of the strip", async () => {
    const { api } = await week(RULES, WEEK);
    expect(api.shadowFindings).toHaveBeenCalledTimes(1);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expect(api.shadowFindings).toHaveBeenCalledTimes(1);
    tab("Görünüş");
    expect(section()).toBeNull();
    tab("Səs və bildiriş");
    await settle();
    expect(api.shadowFindings).toHaveBeenCalledTimes(2);
  });

  it("writes a dash for a stamp that does not parse, never a made-up time", async () => {
    await week(RULES, { days: 7, findings: [row({ patient_id: "S-003", kind: "news2", severity: "high", opened_at: "not a time", cleared_at: "also not" })] });
    const cells = within(within(section()).getAllByRole("row")[1]).getAllByRole("cell").map((c) => c.textContent);
    expect(cells.slice(-2)).toEqual(["—", "—"]);          // the opening and the closing stamp
  });

  it("reads a severity this build does not know as the engine sent it, in the attention words, never as a calm one", async () => {
    await week(RULES, { days: 7, findings: [row({ patient_id: "S-003", kind: "news2", severity: "extreme", opened_at: OPENED_A })] });
    expect(section()).toHaveTextContent("Naməlum risk: extreme");
  });

  it("has no live region and no colour of its own: it is read when the reader goes there", async () => {
    await week(RULES, WEEK);
    expect(section().querySelector("[aria-live], [role='alert'], [role='status']")).toBeNull();
    expect(section().outerHTML).not.toMatch(/text-(crit|high|mid|low|ok)\b/);
  });

  // The tab is left and opened again while the first list is still on its way: the box on screen is the
  // second opening's, and the first answer — landing late, with a row of its own — must not be shown in it.
  it("drops the answer of a list that lands after the tab was left, and shows the one the new opening asked for", async () => {
    const releases = [];
    const { api } = await week(RULES, () => new Promise((resolve) => { releases.push(resolve); }));
    tab("Görünüş");
    tab("Səs və bildiriş");
    await settle();
    expect(api.shadowFindings).toHaveBeenCalledTimes(2);
    expect(section()).toHaveTextContent("Siyahı oxunur…");
    const LATE = { days: 7, findings: [row({ patient_id: "S-009", kind: "news2", severity: "high", opened_at: OPENED_A })] };
    await act(async () => { releases[0](LATE); });
    await settle();
    expect(section()).not.toHaveTextContent("S-009");
    expect(section()).toHaveTextContent("Siyahı oxunur…");     // still the second opening's, still waiting
    await act(async () => { releases[1](WEEK); });
    await settle();
    expect(rowheaders()).toEqual(["S-002", "S-001"]);
    expect(section()).not.toHaveTextContent("S-009");
  });
});

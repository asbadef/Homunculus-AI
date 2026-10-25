import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { token, profile } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { onlyScreens } from "../../shell/screens.testutil.js";
import { ShellProvider } from "../../shell/ShellContext.jsx";
import { NOW, ago, alarm, board, entry, identity, measured, news2, scopedTo } from "../../data/board.testutil.js";
import { STAGE_OFF, bed as monitorBed, param, strip, unassigned } from "../../data/shadow.testutil.js";
import { BedsScreen } from "./BedsScreen.jsx";

/** Let every answer already given land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The screen inside a real session and board store, with the shell's unit context around it.
 *  `connection`: "live" opens the stream and lets its reload land; "degraded" opens it and drops
 *  it; "unavailable" refuses the load; "connecting" leaves it pending. */
async function open({ payload = board(), units = [], connection = "live", perms, screens = {} } = {}) {
  // Pinned, not inherited: this screen asks the registry whether the alarms screen exists (its
  // attention line links there only when it does), and a test that read the BUILD instead would
  // change its answer the moment another branch built that screen — in a file that branch does not
  // own. `screens` is this test's own build. The beds screen itself is the component under test
  // and does not need to be in the registry at all.
  onlyScreens(screens, { keep: [] });
  const access = perms ? token({ perms }) : token({ perms: ["board.view", "alerts.ack"] });
  const me = profile({ perms: perms ?? ["board.view", "alerts.ack"] });
  const mounted = await mount(
    <ShellProvider units={units} scope="known"><BedsScreen /></ShellProvider>,
    {
      access,
      me,
      setup: (api) => {
        if (connection === "unavailable") api.boardPatients.mockRejectedValue(new Error("down"));
        else api.boardPatients.mockResolvedValue(payload);
        api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      },
    },
  );
  const { board: store, stream } = mounted;
  if (connection === "connecting") return mounted;
  await act(async () => { await store.start(); });
  if (connection !== "unavailable") {
    await act(async () => { stream.open(); await settle(); });
    if (connection === "degraded") act(() => { stream.drop(); });
  }
  return mounted;
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  window.localStorage.clear();
});
afterEach(() => {
  resetScreens();
  vi.useRealTimers();
  window.localStorage.clear();
});

const CARD = { identity: identity(), at: measured(30), vitals: { heart_rate: 96, spo2: 97 } };

describe("the bed board", () => {
  it("names itself and counts the beds it shows", async () => {
    await open({ payload: board([entry("S-001", [], CARD), entry("S-002", [], { at: measured(30) })]) });
    expect(screen.getByRole("heading", { level: 1, name: "Çarpayılar" })).toBeInTheDocument();
    // One h1 and no more: the shell moves focus to <main> after every move, and the screen's own
    // heading is what a reader lands on.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("2 çarpayı")).toBeInTheDocument();
  });

  it("an empty LIVE board says the connection is working — that is the only state that may", async () => {
    await open({ payload: board([]) });
    expect(screen.getByText("Hazırda izlənən xəstə yoxdur. Bağlantı işləyir.")).toBeInTheDocument();
  });

  it("a load that FAILED says the list is not shown, and never that the ward is quiet", async () => {
    await open({ connection: "unavailable" });
    // `getAllByRole`: the toast region keeps an empty role="alert" of its own mounted (ui/Toast).
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain("GƏLMİR");
    expect(screen.queryByText("Hazırda izlənən xəstə yoxdur. Bağlantı işləyir.")).toBeNull();
  });

  it("counts no beds before a read has put any on screen — never '0' for a ward it cannot see", async () => {
    await open({ connection: "unavailable" });
    expect(screen.getByRole("heading", { level: 1, name: "Çarpayılar" })).toBeInTheDocument();
    expect(screen.queryByText(/\d+ çarpayı/)).toBeNull();
  });

  it("a board that lost its stream shows what it has, marked out of date", async () => {
    await open({ payload: board([entry("S-001", [], CARD)]), connection: "degraded" });
    expect(screen.getByText("REA-01 · 2")).toBeInTheDocument();
    expect(screen.getAllByRole("note").some((n) => n.textContent.includes("güncəl olmaya bilər"))).toBe(true);
    expect(screen.getByText("1 çarpayı")).toBeInTheDocument(); // the cards kept on screen, counted
  });

  it("writes the engine's own scope sentence, and how many cards it withheld", async () => {
    const note = "Kapsamınızdaki şu anahtarların panoda karşılığı yok: NICU-01";
    await open({
      payload: board([entry("S-001", [], CARD)], {
        scope: scopedTo(["REA-01"], { hidden: 3, unresolved_hidden: 1 }), scope_note: note,
      }),
    });
    const notes = screen.getAllByRole("note").map((n) => n.textContent).join(" ");
    expect(notes).toContain(note);
    expect(notes).toContain("Əhatənizdən kənarda qalan kart: 3.");
    expect(notes).toContain("Bunlardan 1 ədədi heç bir çarpayıya uyğun gəlmir.");
  });

  describe("what is waiting", () => {
    it("counts the unanswered alarms and how long the oldest has been open", async () => {
      await open({
        payload: board([
          entry("S-001", [alarm("news2", "high", { first_seen_at: ago(247) })], { ...CARD, risk: "high" }),
          entry("S-002", [alarm("acute_change", "moderate")], { at: measured(30), risk: "moderate" }),
        ]),
      });
      expect(screen.getByText("Cavab gözləyən siqnal: 2")).toBeInTheDocument();
      expect(screen.getByText("Ən köhnəsi 4:07 əvvəl açılıb")).toBeInTheDocument();
    });

    it("only a LIVE board says nothing is waiting", async () => {
      await open({ payload: board([entry("S-001", [], CARD)]) });
      expect(screen.getByText("Cavab gözləyən siqnal yoxdur")).toBeInTheDocument();
    });

    it("a board that may be out of date does NOT say nothing is waiting", async () => {
      await open({ payload: board([entry("S-001", [], CARD)]), connection: "degraded" });
      expect(screen.queryByText("Cavab gözləyən siqnal yoxdur")).toBeNull();
      expect(screen.getByText("Cavab gözləyən siqnal bilinmir — panel güncəl deyil")).toBeInTheDocument();
    });

    it("a board that could not be loaded says it cannot know", async () => {
      await open({ connection: "unavailable" });
      expect(screen.getByText("Cavab gözləyən siqnal bilinmir — panel güncəl deyil")).toBeInTheDocument();
    });

    it("leads to the alarms screen when this build has it", async () => {
      await open({ payload: board([entry("S-001", [], CARD)]), screens: { alarms: () => null } });
      expect(screen.getByRole("link", { name: /siqnal/i })).toHaveAttribute("href", "#/alarms");
    });

    it("leads nowhere when it does not — never a dead link", async () => {
      await open({ payload: board([entry("S-001", [], CARD)]) });
      expect(screen.queryByRole("link", { name: /siqnal/i })).toBeNull();
    });

    it("leads nowhere for a session that may not open the alarms screen", async () => {
      await open({
        payload: board([entry("S-001", [], CARD)]), perms: ["board.view"],
        screens: { alarms: () => null },
      });
      // `board.view` DOES open the alarms route; a session without it cannot see this screen at
      // all, so the case the link guards against is an unbuilt screen. Pinned here so the rule
      // itself — `canReach` as well as `screenOf` — is exercised.
      expect(screen.getByRole("link", { name: /siqnal/i })).toHaveAttribute("href", "#/alarms");
    });
  });

  it("says how many beds have gone quiet", async () => {
    await open({
      payload: board([
        entry("S-001", [], CARD),
        entry("S-002", [], { at: { heart_rate: ago(4_000) }, vitals: { heart_rate: 70 } }),
      ]),
    });
    expect(screen.getByText(/Səssiz çarpayı: 1/)).toBeInTheDocument();
  });

  describe("the view and the order", () => {
    it("switches to the list, and the list names every column", async () => {
      await open({ payload: board([entry("S-001", [], CARD)]) });
      fireEvent.click(screen.getByRole("button", { name: "Siyahı" }));
      const table = screen.getByRole("table", { name: "Çarpayılar və son ölçülən dəyərləri" });
      const heads = within(table).getAllByRole("columnheader").map((th) => th.textContent);
      expect(heads).toEqual(["Çarpayı", "Xəstə", "Vəziyyət", "Nəbz", "Sistolik AT", "SpO2", "Tənəffüs", "Bədən hərarəti", "Bal", "Son ölçmə"]);
    });

    it("the list prints an unmeasured channel as a dash a screen reader can read", async () => {
      await open({ payload: board([entry("S-001", [], { ...CARD, vitals: { heart_rate: 96 } })]) });
      fireEvent.click(screen.getByRole("button", { name: "Siyahı" }));
      expect(screen.getAllByText("Ölçülməyib").length).toBeGreaterThan(0);
    });

    // G2-A1 (O17): the list shows one alarm line under the name; a critical that passed
    // unacknowledged is drawn on a calm row, so the line carries the badge that says why.
    it("the list marks a critical that passed unacknowledged beside its line", async () => {
      await open({
        payload: board([entry("S-001", [alarm("septic_shock", "critical", { summary: "Septic shock criteria met", resolved_at: ago(60) })], CARD)]),
      });
      fireEvent.click(screen.getByRole("button", { name: "Siyahı" }));
      const row = screen.getByText("Septic shock criteria met").closest("tr");
      expect(within(row).getByText("keçdi · təsdiqlənməyib")).toBeInTheDocument();
    });

    it("keeps the chosen view in this browser", async () => {
      await open({ payload: board([entry("S-001", [], CARD)]) });
      fireEvent.click(screen.getByRole("button", { name: "Siyahı" }));
      expect(window.localStorage.getItem("hmc.bedView")).toBe("liste");
    });

    it("bed order is the default, and says that an alarm does not re-order the list", async () => {
      await open({ payload: board([entry("S-001", [], CARD)]) });
      expect(screen.getByRole("button", { name: "Çarpayı sırası" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(/siyahını yenidən düzmür/)).toBeInTheDocument();
    });

    it("risk order puts the worst first, and the note goes away", async () => {
      await open({
        payload: board([
          entry("REA-1", [], { identity: identity({ bed_label: "REA-1" }), at: measured(30), risk: "low" }),
          entry("REA-2", [], { identity: identity({ bed_label: "REA-2" }), at: measured(30), risk: "critical" }),
        ]),
      });
      fireEvent.click(screen.getByRole("button", { name: "Risk sırası" }));
      const cards = screen.getByRole("list");
      const beds = within(cards).getAllByRole("link").map((a) => a.getAttribute("href"));
      expect(beds).toEqual(["#/patients/REA-2", "#/patients/REA-1"]);
      expect(screen.queryByText(/siyahını yenidən düzmür/)).toBeNull();
    });
  });

  describe("the unit filter and the search", () => {
    it("offers the engine's units at every width, and writes the shell's choice", async () => {
      await open({
        units: ["NICU-01", "REA-01"],
        payload: board([
          entry("S-001", [], CARD),
          entry("S-002", [], { identity: identity({ unit_id: "NICU-01", bed_label: "NICU-01 · 1" }), at: measured(30) }),
        ]),
      });
      const select = screen.getByRole("combobox");
      expect(within(select).getAllByRole("option").map((o) => o.textContent))
        .toEqual(["Hamısı", "NICU-01", "REA-01"]);
      fireEvent.change(select, { target: { value: "NICU-01" } });
      expect(screen.getByText("NICU-01 · 1 çarpayı")).toBeInTheDocument();
    });

    it("a filter is never silent: it says how many cards it is hiding", async () => {
      await open({
        units: ["NICU-01", "REA-01"],
        payload: board([
          entry("S-001", [], CARD),
          entry("S-002", [], { identity: identity({ unit_id: "NICU-01", bed_label: "NICU-01 · 1" }), at: measured(30) }),
        ]),
      });
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "NICU-01" } });
      expect(screen.getByText("Süzgəc 1 kartı gizlədir.")).toBeInTheDocument();
    });

    it("no selector when the engine scoped the session to fewer than two units", async () => {
      await open({ units: [], payload: board([entry("S-001", [], CARD)]) });
      expect(screen.queryByRole("combobox")).toBeNull();
    });

    it("searches the bed, the id and the HIS name, and says what it hid", async () => {
      await open({
        payload: board([
          entry("S-001", [], CARD),
          entry("S-002", [], { identity: identity({ display_name: "Kamran Sentetik", bed_label: "REA-01 · 3" }), at: measured(30) }),
        ]),
      });
      fireEvent.change(screen.getByLabelText("Çarpayı və ya xəstə axtar"), { target: { value: "kamran" } });
      expect(screen.getByText("REA-01 · 3")).toBeInTheDocument();
      expect(screen.queryByText("REA-01 · 2")).toBeNull();
      expect(screen.getByText("Axtarış 1 kartı gizlədir.")).toBeInTheDocument();
    });

    it("a search that matches nothing says so with what was typed", async () => {
      await open({ payload: board([entry("S-001", [], CARD)]) });
      fireEvent.change(screen.getByLabelText("Çarpayı və ya xəstə axtar"), { target: { value: "zzz" } });
      expect(screen.getByText("\"zzz\" ilə uyğun gələn kart yoxdur.")).toBeInTheDocument();
    });
  });
});

// Aşama A: the unvalidated monitor strip on the beds screen. The shadow store is started as LiveApp
// starts it for a READY session, with the strip's answer the test gives.
async function openStrip(answer, options = {}) {
  const mounted = await open({
    ...options,
    screens: options.screens,
  });
  mounted.api.shadowBoard.mockImplementation(async () => (answer instanceof Error ? Promise.reject(answer) : answer));
  await act(async () => { mounted.shadow.start(["board.view", "alerts.ack"]); await settle(); });
  return mounted;
}

describe("the monitor strip (Aşama A)", () => {
  it("with the stage off draws nothing: no chip, no monitor card", async () => {
    const { api } = await openStrip(STAGE_OFF, { payload: board([entry("S-001", [], CARD)]) });
    expect(api.shadowBoard).toHaveBeenCalled();
    expect(screen.queryByText(/Monitor \(təsdiqlənməmiş\)/)).toBeNull();
    expect(document.querySelector("[data-monitor], [data-monitor-strip]")).toBeNull();
  });

  it("puts its chip in the feed row, separately labelled, with the server's counts", async () => {
    const answer = strip({
      beds: [monitorBed("REA-01 · 4", [param("hr", 72)]), monitorBed("REA-01 · 5", [], { status: "standby" })],
      unassigned: [unassigned("192.0.2.28")],
    });
    await openStrip(answer, { payload: board([entry("S-001", [], CARD)]) });
    const chip = screen.getByText(/məlumat göndərir/).closest("span");
    expect(chip).toHaveTextContent("Monitor (təsdiqlənməmiş): 1/3 məlumat göndərir · 2 gözləmədə · 1 təyin edilməyib");
    // the existing feed chip's row: the one beside the attention line, two columns from 861 px
    expect(chip.closest(".min-\\[861px\\]\\:grid-cols-2")).not.toBeNull();
  });

  // Two patient cards (one REA-01, one NICU-01); three assigned monitor beds, one linked to S-001;
  // two devices on no bed.
  const WARD = board([
    entry("S-001", [], CARD),
    entry("S-002", [], { identity: identity({ patient_id: "S-002", display_name: "Kamran Sentetik",
      bed_label: "NICU-01 · 1", bed_id: "NICU-01-1", unit_id: "NICU-01" }), at: measured(30) }),
  ]);
  const MONITORS = (over = {}) => strip({
    beds: [
      monitorBed("REA-01 · 2", [param("hr", 72)], { bed_id: "REA-01-2", unit_id: "REA-01", link: "one", patient_id: "S-001" }),
      monitorBed("REA-01 · 5", [param("hr", 64)], { unit_id: "REA-01" }),
      monitorBed("NICU-01 · 7", [param("spo2", 95)], { unit_id: "NICU-01" }),
    ],
    unassigned: [unassigned("192.0.2.28"), unassigned("192.0.2.34", "not_in_table")],
    ...over,
  });
  const section = () => screen.getByRole("region", { name: "Monitorlar — təsdiqlənməmiş" });
  const cards = () => [...section().querySelectorAll("li[data-monitor]")];

  it("puts the strip of a linked patient on that patient's card, outside its link", async () => {
    await openStrip(MONITORS(), { payload: WARD });
    const link = screen.getByRole("link", { name: "REA-01 · 2 xəstəsini aç" });
    const strip = within(link.closest("li")).getByRole("region", { name: "Monitor · təsdiqlənməmiş" });
    expect(strip).toHaveTextContent("72");
    expect(link.contains(strip)).toBe(false);
  });

  it("lists the unlinked beds and the unassigned devices in their own section, after the patients", async () => {
    await openStrip(MONITORS(), { payload: WARD });
    expect(screen.getByRole("heading", { level: 2, name: "Monitorlar — təsdiqlənməmiş" })).toBeInTheDocument();
    expect(cards()).toHaveLength(4);
    expect(section()).not.toHaveTextContent("72");                           // the linked one is on its card
    expect(within(section()).queryAllByRole("link")).toEqual([]);            // monitor cards open nothing
    expect(within(section()).getByRole("region", { name: "REA-01 · 5 · Monitor · təsdiqlənməmiş" })).toHaveTextContent("64");
    expect(section()).toHaveTextContent("Bu çarpayıya bağlı xəstə qeydi yoxdur");
    expect(within(section()).getByRole("region", { name: "Təyin edilməmiş cihaz · 192.0.2.28 · Monitor · təsdiqlənməmiş" }))
      .toHaveTextContent("Cihaz→çarpayı cədvəlində çarpayısı müəyyənləşdirilməyib");
    expect(section()).toHaveTextContent("Cihaz→çarpayı cədvəlində yoxdur");
    const patients = screen.getByRole("link", { name: "REA-01 · 2 xəstəsini aç" }).closest("ul");
    expect(patients.compareDocumentPosition(section()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the beds grid's own layout, one column at 640 px and below
    expect(section().querySelector("ul")).toHaveClass("max-[640px]:grid-cols-1");
  });

  it("a unit filter hides another unit's monitors and every unassigned device, and says how many", async () => {
    await openStrip(MONITORS(), { payload: WARD, units: ["REA-01", "NICU-01"] });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "NICU-01" } });
    expect(cards()).toHaveLength(1);
    expect(section()).toHaveTextContent("NICU-01 · 7");
    // S-001's card (with its monitor), REA-01 · 5 and the two unassigned devices
    expect(screen.getByText("Süzgəc 4 kartı gizlədir.")).toBeInTheDocument();
  });

  it("the search finds a monitor by its bed", async () => {
    await openStrip(MONITORS(), { payload: WARD });
    fireEvent.change(screen.getByLabelText("Çarpayı və ya xəstə axtar"), { target: { value: "nicu-01 · 7" } });
    expect(cards()).toHaveLength(1);
    expect(section()).toHaveTextContent("NICU-01 · 7");
    expect(screen.getByText("Axtarış 5 kartı gizlədir.")).toBeInTheDocument();
  });

  it("with the forwarder silent says so instead of counting, and shows no number anywhere", async () => {
    await openStrip(MONITORS({ feed: { state: "forwarder_silent" } }), { payload: WARD });
    expect(screen.getAllByRole("note").some((n) => n.textContent.startsWith("Monitor məlumatı gəlmir"))).toBe(true);
    expect(screen.queryByText(/məlumat göndərir/)).toBeNull();
    for (const strip of document.querySelectorAll("[data-monitor-strip]")) {
      expect(strip).not.toHaveTextContent(/\b(72|64|95)\b/);
    }
  });

  it("says it cannot read the strip when a poll fails, and keeps the last cards ageing", async () => {
    const mounted = await openStrip(MONITORS(), { payload: WARD });
    mounted.api.shadowBoard.mockRejectedValue(new Error("down"));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
    expect(screen.getAllByRole("note").some((n) => n.textContent === "Monitor zolağı oxunmur")).toBe(true);
    expect(cards()).toHaveLength(4);
    // …and every strip says so itself: the linked card's and each card in the section.
    const strips = [...document.querySelectorAll("[data-monitor-strip]")];
    expect(strips).toHaveLength(5);
    for (const strip of strips) expect(strip).toHaveTextContent("Monitor zolağı oxunmur");
  });

  it("says it cannot read the strip when the first read after sign-in fails", async () => {
    await openStrip(new Error("down"), { payload: WARD });
    expect(screen.getAllByRole("note").some((n) => n.textContent === "Monitor zolağı oxunmur")).toBe(true);
    expect(document.querySelector("[data-monitor-strip]")).toBeNull();
  });

  it("in the list view says a linked bed's monitor is in the card view, rather than dropping it", async () => {
    await openStrip(MONITORS(), { payload: WARD });
    fireEvent.click(screen.getByRole("button", { name: "Siyahı" }));
    const row = screen.getByRole("link", { name: "REA-01 · 2" }).closest("tr");
    expect(row).toHaveTextContent("Bu çarpayının təsdiqlənməmiş monitor zolağı «Kart» görünüşündədir");
    expect(row).not.toHaveTextContent("72");
  });

  it("takes the server's display limit, but never longer than 15 s", async () => {
    const answer = MONITORS();
    answer.display_max_age_s = 60;
    answer.beds[1].parameters = [param("hr", 64, { age_s: 20 })];
    await openStrip(answer, { payload: WARD });
    const strip = within(section()).getByRole("region", { name: "REA-01 · 5 · Monitor · təsdiqlənməmiş" });
    expect(strip).not.toHaveTextContent("64");
    expect(strip).toHaveTextContent("köhnə · 20 san");
  });
});

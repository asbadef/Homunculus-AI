import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { token, profile } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { onlyScreens } from "../../shell/screens.testutil.js";
import { ShellProvider } from "../../shell/ShellContext.jsx";
import { NOW, ago, alarm, board, entry, identity, measured, news2, scopedTo } from "../../data/board.testutil.js";
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

  it("a board that lost its stream shows what it has, marked out of date", async () => {
    await open({ payload: board([entry("S-001", [], CARD)]), connection: "degraded" });
    expect(screen.getByText("REA-01 · 2")).toBeInTheDocument();
    expect(screen.getAllByRole("note").some((n) => n.textContent.includes("güncəl olmaya bilər"))).toBe(true);
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

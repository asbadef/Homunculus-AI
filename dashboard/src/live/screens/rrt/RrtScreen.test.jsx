// RrtScreen.test.jsx — the RRT screen (G2-B5, spec D6; owner D1: the RRT comes only when called by hand, and the
// screen says so). Synthetic cards and accounts only (board.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { NOW, ago, alarm, board, entry, identity, measured } from "../../data/board.testutil.js";
import { hhmm } from "../../i18n/dates.js";
import { RrtScreen } from "./RrtScreen.jsx";

// The real setTimeout, taken before any test fakes the timers: a test that drives the clock still lets answers land.
const realSetTimeout = globalThis.setTimeout;
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));

/** The rapid-response team's rights (catalogue `rapid_response`): it may answer an alarm and call the team. */
const RRT = ["board.view", "alerts.ack", "alerts.escalate"];

/** The screen inside a real session and board store, as AlarmsScreen.test.jsx mounts its own. `connection`:
 *  "live" | "degraded" | "unavailable". */
async function open({ payload = board(), connection = "live", perms = RRT, setup } = {}) {
  const mounted = await mount(<RrtScreen />, {
    access: token({ perms }),
    me: profile({ perms }),
    setup: (api) => {
      if (connection === "unavailable") api.boardPatients.mockRejectedValue(new Error("down"));
      else api.boardPatients.mockResolvedValue(payload);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      setup?.(api);
    },
  });
  const { board: store, stream } = mounted;
  await act(async () => { await store.start(); });
  if (connection !== "unavailable") {
    await act(async () => { stream.open(); await settle(); });
    if (connection === "degraded") act(() => { stream.drop(); });
  }
  return mounted;
}

const CARD = { identity: identity(), at: measured(30) };
const withAlarms = (...alarms) => board([entry("S-001", alarms, { ...CARD, risk: "high" })]);
/** An alarm somebody called the RRT to, two minutes ago, as the card carries it (spec D4). */
const CALL = { by: "leyla", at: ago(120), reason: "Solunum güçlüğü artıyor" };
const called = (over = {}) => alarm("news2", "high", { summary: "NEWS2 7", rrt_call: CALL, ...over });

const CALLS = "RRT çağırışları";
const WAITING = "Yoldakı cavabsız təcili siqnallar";
const listOf = (name) => screen.getByRole("region", { name });
/** The acknowledge button: its accessible name also names the bed and the kind, so it is found by the word. */
const SEEN = /gördüm/i;
const toasts = () => screen.getByRole("region", { name: "Bildirişlər" });

beforeEach(() => vi.setSystemTime(NOW));
afterEach(() => {
  resetScreens();
  vi.useRealTimers();
});

describe("the RRT screen", () => {
  it("names itself once, and says plainly that the automatic RRT step is off (owner D1)", async () => {
    await open({ payload: withAlarms(called()) });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Sürətli cavab komandası (RRT)" })).toBeInTheDocument();
    // Charge nurses and physicians read it too: the intro speaks of the team, not to it.
    expect(screen.getByText("Komandanın əl ilə çağırıldığı siqnallar və cavab gözləyən təcili siqnallar. Siyahı lövhədən canlı gəlir."))
      .toBeInTheDocument();
    const note = screen.getAllByRole("note").find((n) => n.textContent.includes("Avtomatik RRT pilləsi bağlıdır"));
    expect(note).toHaveTextContent("cavabsız təcili siqnal 5 dəq sonra həkimə eskalasiya olunur");
    expect(note).toHaveTextContent("RRT yalnız əl ilə çağırılanda gəlir");
    expect(screen.getByRole("heading", { level: 2, name: CALLS })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: WAITING })).toBeInTheDocument();
  });

  it("lists a called, unanswered alarm under the calls: who called, why, and how long ago", async () => {
    await open({ payload: withAlarms(called()) });
    const row = within(listOf(CALLS)).getByText("NEWS2 7").closest("li");
    expect(row).toHaveTextContent("Əl ilə çağırılıb · leyla");
    expect(row).toHaveTextContent("Səbəb: Solunum güçlüğü artıyor");
    expect(row).toHaveTextContent("2:00 əvvəl çağırılıb");
    expect(within(row).getByRole("link", { name: /REA-01 · 2/ })).toHaveAttribute("href", "#/patients/S-001");
    // A called alarm is not also «on its way»: the second list is what has no call yet.
    expect(within(listOf(WAITING)).queryByText("NEWS2 7")).toBeNull();
    expect(within(listOf(WAITING)).getByText("Çağırışsız, cavab gözləyən təcili siqnal yoxdur.")).toBeInTheDocument();
  });

  it("lists the unanswered urgent alarms with no call; an escalated one says it went to the doctor", async () => {
    await open({
      payload: withAlarms(
        alarm("news2", "high", { summary: "Quiet one", first_seen_at: ago(247) }),
        alarm("sepsis", "critical", { summary: "Escalated one", escalated: true }),
        alarm("trend", "moderate", { summary: "Not immediate", urgency: "urgent" }),
        alarm("map", "high", { summary: "Answered one", acknowledged: true, acknowledged_by: "ayse", acknowledged_at: ago(10) }),
      ),
    });
    const waiting = listOf(WAITING);
    const quiet = within(waiting).getByText("Quiet one").closest("li");
    expect(quiet).toHaveTextContent("4:07 cavabsız");
    expect(within(quiet).queryByText("Həkimə eskalasiya olunub")).toBeNull();
    const escalated = within(waiting).getByText("Escalated one").closest("li");
    expect(within(escalated).getByText("Həkimə eskalasiya olunub")).toBeInTheDocument();
    // Only urgency `immediate` is on its way, and an answered alarm waits for nobody.
    expect(screen.queryByText("Not immediate")).toBeNull();
    expect(screen.queryByText("Answered one")).toBeNull();
    expect(within(listOf(CALLS)).getByText("Açıq RRT çağırışı yoxdur.")).toBeInTheDocument();
  });

  // G2-B5b (spec §2; review): a snoozed alarm is not «on its way» until its until — and is from that moment, by the
  // screen's own clock, with no frame from the server.
  it("leaves a snoozed alarm off the list on its way until its snooze ends, and lists it from then", async () => {
    vi.useRealTimers();                                 // beforeEach mocked the date alone
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    await open({
      payload: withAlarms(alarm("news2", "high", { summary: "Snoozed one", snooze: { by: "leyla", at: ago(295),
        until: new Date(NOW + 5_000).toISOString(), minutes: 5, reason: "PATIENT_BASELINE", reason_text: null } })),
    });
    expect(within(listOf(WAITING)).queryByText("Snoozed one")).toBeNull();
    act(() => { vi.advanceTimersByTime(5_100); });
    expect(within(listOf(WAITING)).getByText("Snoozed one")).toBeInTheDocument();
  });

  // G2-A1 (O17): a critical whose rule stopped before anyone answered stays, latched, until someone does. A called
  // one must say so, as the alarm screen's row does — its sound has stopped, and the team should know why.
  it("a called alarm whose condition passed unanswered says so, with the time it passed", async () => {
    await open({
      payload: withAlarms(alarm("septic_shock", "critical", {
        summary: "Septic shock criteria met", rrt_call: CALL, resolved_at: ago(60),
      })),
    });
    const row = within(listOf(CALLS)).getByText("Septic shock criteria met").closest("li");
    expect(within(row).getByText("keçdi · təsdiqlənməyib")).toBeInTheDocument();
    expect(row).toHaveTextContent(`keçdiyi saat: ${hhmm(NOW - 60_000)}`);
    expect(row).toHaveTextContent("Əl ilə çağırılıb · leyla");
    // Still answerable: latched is not answered.
    expect(within(row).getByRole("button", { name: SEEN })).toBeInTheDocument();
  });

  it("a called alarm that still fires carries no such badge", async () => {
    await open({ payload: withAlarms(called()) });
    expect(screen.queryByText("keçdi · təsdiqlənməyib")).toBeNull();
  });

  it("each list says it is empty, on a LIVE board", async () => {
    await open({ payload: board([entry("S-001", [], CARD)]) });
    expect(within(listOf(CALLS)).getByText("Açıq RRT çağırışı yoxdur.")).toBeInTheDocument();
    expect(within(listOf(WAITING)).getByText("Çağırışsız, cavab gözləyən təcili siqnal yoxdur.")).toBeInTheDocument();
  });

  describe("«Gördüm»", () => {
    it("is the alarm screen's acknowledgement: the answered call leaves the list", async () => {
      const answered = entry("S-001", [alarm("news2", "high", {
        summary: "NEWS2 7", acknowledged: true, acknowledged_by: "leyla", acknowledged_at: ago(1),
      })], { ...CARD, risk: "high" });
      const { api } = await open({
        payload: withAlarms(called()),
        setup: (fake) => fake.acknowledge.mockResolvedValue(answered),
      });
      const button = within(listOf(CALLS)).getByRole("button", { name: SEEN });
      expect(button).toHaveTextContent("Gördüm");
      expect(button).toHaveAccessibleName(/REA-01 · 2/);
      expect(button).toHaveAccessibleName(/news2/);
      await act(async () => {
        fireEvent.click(button);
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalledWith("S-001", "news2");
      expect(screen.queryByText("NEWS2 7")).toBeNull();
      expect(within(listOf(CALLS)).getByText("Açıq RRT çağırışı yoxdur.")).toBeInTheDocument();
      expect(within(toasts()).getAllByText("Siqnal görüldü kimi işarələndi.").length).toBeGreaterThan(0);
    });

    it("a refusal is shown, naming the alarm, and the row stays — nothing was acknowledged", async () => {
      const { api } = await open({
        payload: withAlarms(called()),
        setup: (fake) => fake.acknowledge.mockRejectedValue(refusal(403, "permission required: alerts.ack")),
      });
      await act(async () => {
        fireEvent.click(within(listOf(CALLS)).getByRole("button", { name: SEEN }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalled();
      const said = within(toasts()).getAllByText(/REA-01 · 2 · news2/);
      expect(said.map((n) => n.textContent).join(" ")).toContain("səlahiyyətiniz yoxdur");
      expect(within(listOf(CALLS)).getByText("NEWS2 7")).toBeInTheDocument();
      expect(within(listOf(CALLS)).getByRole("button", { name: SEEN })).toBeInTheDocument();
    });

    it("answers an alarm on its way too", async () => {
      const { api } = await open({
        payload: withAlarms(alarm("sepsis", "critical", { summary: "Escalated one", escalated: true })),
        setup: (fake) => fake.acknowledge.mockResolvedValue(entry("S-001", [], CARD)),
      });
      await act(async () => {
        fireEvent.click(within(listOf(WAITING)).getByRole("button", { name: SEEN }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalledWith("S-001", "sepsis");
      expect(screen.queryByText("Escalated one")).toBeNull();
    });

    it("is not offered without alerts.ack, and the reason is on the screen", async () => {
      await open({
        payload: withAlarms(called(), alarm("sepsis", "critical", { summary: "Escalated one", escalated: true })),
        perms: ["board.view", "alerts.escalate"],
      });
      expect(within(listOf(CALLS)).getByText("NEWS2 7")).toBeInTheDocument();
      expect(within(listOf(WAITING)).getByText("Escalated one")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: SEEN })).toBeNull();
      expect(screen.getByText(/«alerts.ack» səlahiyyəti lazımdır/)).toBeInTheDocument();
    });
  });

  describe("what it refuses to imply (Decision 18)", () => {
    const STALE = "Lövhə yenilənməmiş ola bilər; siyahılar son məlum vəziyyətdir.";
    const UNREAD = "Lövhə oxunmur; RRT siyahıları göstərilə bilmir.";

    it("a board that may be out of date keeps what it last had, and never says a list is empty", async () => {
      await open({ payload: withAlarms(called()), connection: "degraded" });
      expect(within(listOf(CALLS)).getByText("NEWS2 7")).toBeInTheDocument();
      expect(within(listOf(WAITING)).getByText(STALE)).toBeInTheDocument();
      expect(screen.queryByText("Çağırışsız, cavab gözləyən təcili siqnal yoxdur.")).toBeNull();
      expect(screen.getAllByRole("note").map((n) => n.textContent).join(" ")).toContain("Canlı axın kəsildi");
    });

    it("a stale board with nothing on it says it may be out of date, in both lists", async () => {
      await open({ payload: board([entry("S-001", [], CARD)]), connection: "degraded" });
      expect(within(listOf(CALLS)).getByText(STALE)).toBeInTheDocument();
      expect(within(listOf(WAITING)).getByText(STALE)).toBeInTheDocument();
      expect(screen.queryByText("Açıq RRT çağırışı yoxdur.")).toBeNull();
      expect(screen.queryByText("Çağırışsız, cavab gözləyən təcili siqnal yoxdur.")).toBeNull();
    });

    it("a board that cannot be read says so, in both lists, and nowhere that the ward is quiet", async () => {
      await open({ connection: "unavailable" });
      expect(within(listOf(CALLS)).getByText(UNREAD)).toBeInTheDocument();
      expect(within(listOf(WAITING)).getByText(UNREAD)).toBeInTheDocument();
      expect(screen.queryByText("Açıq RRT çağırışı yoxdur.")).toBeNull();
      expect(screen.queryByText("Çağırışsız, cavab gözləyən təcili siqnal yoxdur.")).toBeNull();
      const alerts = screen.getAllByRole("alert").filter((el) => !el.classList.contains("sr-only"));
      expect(alerts.map((a) => a.textContent).join(" ")).toContain("GƏLMİR");
    });
  });
});

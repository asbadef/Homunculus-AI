import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { NOW, ago, alarm, board, entry, identity, measured } from "../../data/board.testutil.js";
import { AlarmsScreen } from "./AlarmsScreen.jsx";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The screen inside a real session and board store. `connection`: "live" | "degraded" |
 *  "unavailable"; `perms` decides whether the acknowledge button exists at all. */
async function open({ payload = board(), connection = "live", perms = ["board.view", "alerts.ack"], setup } = {}) {
  const mounted = await mount(<AlarmsScreen />, {
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

beforeEach(() => vi.setSystemTime(NOW));
afterEach(() => {
  resetScreens();
  vi.useRealTimers();
});

describe("the alarms screen", () => {
  it("names itself and shows the two sections the board can answer for", async () => {
    await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })) });
    expect(screen.getByRole("heading", { level: 1, name: "Siqnallar" })).toBeInTheDocument();
    // One h1 and no more: the shell moves focus to <main> after every move, and the screen's own
    // heading is what a reader lands on.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: /Cavab gözləyir/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2, name: /Qiymətləndirilir/ }).length).toBeGreaterThan(0);
  });

  it("says where a closed alarm went, instead of an empty \"closed today\" section", async () => {
    // The board carries the engine's ACTIVE alarms only: an empty third section would read as
    // "nothing was closed today", which is a different and false statement.
    await open({ payload: withAlarms(alarm("news2")) });
    expect(screen.getByText(/Bağlanan siqnal paneldən düşür/)).toBeInTheDocument();
  });

  it("says whose business escalation is, and shows only the flag the engine sent", async () => {
    await open({ payload: withAlarms(alarm("news2", "high", { escalated: true })) });
    expect(screen.getByText("Eskalasiya edilib")).toBeInTheDocument();
    expect(screen.getByText(/Eskalasiyanı mühərrik yürüdür/)).toBeInTheDocument();
    // No 3 / 5 / 10-minute ladder: nothing behind the live API has that shape.
    expect(screen.queryByText(/3\. dəq|5\. dəq|10\. dəq/)).toBeNull();
  });

  describe("how long an alarm has been open", () => {
    it("writes minutes and seconds under an hour", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: ago(247) })) });
      expect(screen.getByText("4:07")).toBeInTheDocument();
    });

    it("opens the hour field past an hour — never \"318:30\"", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: ago(19_110) })) });
      expect(screen.getByText("5:18:30")).toBeInTheDocument();
      expect(screen.queryByText("318:30")).toBeNull();
    });

    it("shows NO duration when the engine sent no first-seen time", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: null })) });
      expect(screen.getByText("Mühərrik ilk görülmə vaxtını göndərməyib; müddət göstərilmir.")).toBeInTheDocument();
    });

    it("counts from the server's instant against this browser's clock", async () => {
      // How often it is re-read is useNow's business (screens/common/useNow.test.jsx).
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: ago(60) })) });
      expect(screen.getByText("1:00")).toBeInTheDocument();
    });

    it("an instant that has not arrived yet reads 0:00, not a negative age", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: ago(-90) })) });
      expect(screen.getByText("0:00")).toBeInTheDocument();
    });
  });

  describe("the order", () => {
    it("worst first, then oldest, among the alarms awaiting a response", async () => {
      await open({
        payload: board([
          entry("S-001", [alarm("a", "moderate", { first_seen_at: ago(900) })], { ...CARD }),
          entry("S-002", [alarm("b", "critical", { first_seen_at: ago(60) })], { ...CARD }),
          entry("S-003", [alarm("c", "critical", { first_seen_at: ago(600) })], { ...CARD }),
        ]),
      });
      const waiting = screen.getByRole("heading", { level: 2, name: /Cavab gözləyir/ }).parentElement;
      expect(within(waiting).getAllByRole("link").map((a) => a.textContent))
        .toEqual(["REA-01 · 2", "REA-01 · 2", "REA-01 · 2"]);
      expect(within(waiting).getAllByText(/ölçütü karşılandı/).map((p) => p.textContent))
        .toEqual(["c ölçütü karşılandı", "b ölçütü karşılandı", "a ölçütü karşılandı"]);
    });

    it("the critical filter narrows both sections", async () => {
      await open({
        payload: board([
          entry("S-001", [alarm("a", "moderate")], { ...CARD }),
          entry("S-002", [alarm("b", "critical")], { ...CARD }),
        ]),
      });
      fireEvent.click(screen.getByRole("button", { name: "Yalnız kritik" }));
      expect(screen.getByText("b ölçütü karşılandı")).toBeInTheDocument();
      expect(screen.queryByText("a ölçütü karşılandı")).toBeNull();
    });
  });

  describe("acknowledging", () => {
    it("sends patient and kind, and shows the board the server answered with", async () => {
      const acked = entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7", acknowledged: true, acknowledged_by: "ayse", acknowledged_at: ago(1) })], { ...CARD, risk: "high" });
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        setup: (fake) => fake.acknowledge.mockResolvedValue(acked),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Gördüm" }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalledWith("S-001", "news2");
      expect(screen.getByText("Gördü: ayse")).toBeInTheDocument();
      // It moved to the second section: the button for it is gone.
      expect(screen.queryByRole("button", { name: "Gördüm" })).toBeNull();
    });

    it("a refusal is shown and the list is NOT changed — nothing was acknowledged", async () => {
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        setup: (fake) => fake.acknowledge.mockRejectedValue(refusal(403, "permission required: alerts.ack")),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Gördüm" }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalled();
      const alerts = screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
      expect(alerts).toContain("səlahiyyətiniz yoxdur (alerts.ack)");
      expect(screen.getByRole("button", { name: "Gördüm" })).toBeInTheDocument();
    });

    it("an alarm somebody else answered says so", async () => {
      await open({
        payload: withAlarms(alarm("news2")),
        setup: (fake) => fake.acknowledge.mockRejectedValue(refusal(404, "no such active alert")),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Gördüm" }));
        await settle();
      });
      expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" "))
        .toContain("Bu siqnal artıq açıq deyil");
    });

    it("says it is saving, in words a screen reader hears", async () => {
      let release;
      await open({
        payload: withAlarms(alarm("news2")),
        setup: (fake) => fake.acknowledge.mockImplementation(() => new Promise((resolve) => { release = resolve; })),
      });
      const button = screen.getByRole("button", { name: "Gördüm" });
      await act(async () => { fireEvent.click(button); await settle(); });
      expect(button).toHaveAttribute("aria-busy", "true");
      await waitFor(
        () => expect(screen.getAllByRole("status").map((s) => s.textContent)).toContain("Yadda saxlanılır…"),
        // ANNOUNCE_DELAY_MS is 150 ms of REAL time; the default 1 s wait can be missed when the
        // whole suite runs its files in parallel on a loaded machine.
        { timeout: 4000 },
      );
      await act(async () => { release(entry("S-001", [], CARD)); await settle(); });
    });

    it("no button at all without the right, and the reason is on the screen", async () => {
      await open({ payload: withAlarms(alarm("news2")), perms: ["board.view"] });
      expect(screen.queryByRole("button", { name: "Gördüm" })).toBeNull();
      expect(screen.getByText(/«alerts.ack» səlahiyyəti lazımdır/)).toBeInTheDocument();
    });
  });

  describe("what it refuses to imply", () => {
    it("a board that could not be loaded does not read as \"no alarms\"", async () => {
      await open({ connection: "unavailable" });
      const said = screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
      expect(said).toContain("GƏLMİR");
      expect(screen.queryByText("Cavab gözləyən həyəcan siqnalı yoxdur.")).toBeNull();
    });

    it("a board that may be out of date says so, and warns before an acknowledgement", async () => {
      await open({ payload: withAlarms(alarm("news2")), connection: "degraded" });
      const notes = screen.getAllByRole("note").map((n) => n.textContent).join(" ");
      expect(notes).toContain("açıq siqnalların hamısı göstərilməyə bilər");
      expect(notes).toContain("siyahı köhnə ola bilər");
    });

    it("only a LIVE board says nothing is waiting", async () => {
      await open({ payload: board([entry("S-001", [], CARD)]) });
      expect(screen.getByText("Cavab gözləyən həyəcan siqnalı yoxdur.")).toBeInTheDocument();
    });

    it("an alarm whose severity is \"none\" can never read \"no finding\"", async () => {
      await open({ payload: withAlarms(alarm("other", "none")) });
      expect(screen.queryByText("Tapıntı yoxdur")).toBeNull();
      expect(screen.getByText("Risk bildirilməyib")).toBeInTheDocument();
    });
  });
});

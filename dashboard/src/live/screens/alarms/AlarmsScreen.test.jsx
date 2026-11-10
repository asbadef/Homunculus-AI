import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { NOW, ago, alarm, board, entry, identity, measured } from "../../data/board.testutil.js";
import { hhmm } from "../../i18n/dates.js";
import { AlarmsScreen } from "./AlarmsScreen.jsx";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The acknowledge button. Its accessible name is "<bed> · <kind> siqnalı: gördüm" (it names the
 *  alarm it answers), so it is found by the word and not by the whole name. */
const SEEN = /gördüm/i;

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

    it("the filter says how much it is hiding, and the count still speaks for the ward", async () => {
      // The count was computed from the FILTERED list, so turning the filter on made the group's
      // accessible name understate the ward — while the rail badge and the bell went on reporting
      // the truth from the same board. One page contradicting itself about how many alarms are
      // open is worse than either number alone. And a silent filter is the bed board's own
      // lesson: it says how many cards it hides, every time.
      await open({
        payload: board([
          entry("S-001", [alarm("a", "moderate")], { ...CARD }),
          entry("S-002", [alarm("b", "critical")], { ...CARD }),
        ]),
      });
      fireEvent.click(screen.getByRole("button", { name: "Yalnız kritik" }));
      expect(screen.getByText("Süzgəc 1 siqnalı gizlədir.")).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Açıq · 2" })).toBeInTheDocument();
    });

    it("the section headings carry no number the board cannot know either", async () => {
      // The same defect one level down, on the two LARGEST numbers on the screen. The group
      // label was gated and these were not, so an unreadable board — where refresh() has
      // emptied it — printed a bold 0 beside "Cavab gözləyir" and "Qiymətləndirilir", inches
      // from a group label correctly saying "Açıq · bilinmir". A stale number is defensible, as
      // the bell already shows one; a zero the board cannot know is not.
      await open({ connection: "unavailable" });
      for (const name of [/Cavab gözləyir/, /Qiymətləndirilir/]) {
        expect(screen.getByRole("heading", { name })).toHaveTextContent(/^[^0-9]*$/);
      }
    });

    it("a board that cannot be read offers no number at all", async () => {
      // The one count on this screen that was not behind a `known` guard: it read "Açıq · 0" on a
      // board that could not be loaded, directly beside the crit alert saying so. Zero is the most
      // reassuring thing this screen can print, and it was printing it for a ward it knew nothing
      // about. Plan-verbatim, which is why it survived three arms and two reviews.
      await open({ connection: "unavailable" });
      expect(screen.queryByRole("group", { name: /Açıq · 0/ })).toBeNull();
      expect(screen.getByRole("group", { name: "Açıq · bilinmir" })).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole("button", { name: SEEN }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalledWith("S-001", "news2");
      expect(screen.getByText("Gördü: ayse")).toBeInTheDocument();
      // It moved to the second section: the button for it is gone.
      expect(screen.queryByRole("button", { name: SEEN })).toBeNull();
    });

    // G2-A1 (O17): a critical whose condition passed before anyone acknowledged it.
    it("keeps a critical whose condition passed waiting, with its badge, and still asks for the acknowledgement", async () => {
      const passed = alarm("septic_shock", "critical", { summary: "Septic shock criteria met", resolved_at: ago(60) });
      const { api } = await open({
        payload: withAlarms(passed),
        setup: (fake) => fake.acknowledge.mockResolvedValue(entry("S-001", [], { ...CARD })),
      });
      const waiting = screen.getByRole("heading", { level: 2, name: /Cavab gözləyir/ }).parentElement;
      const row = within(waiting).getByText("Septic shock criteria met").closest("li");
      expect(within(row).getByText("keçdi · təsdiqlənməyib")).toBeInTheDocument();
      expect(row).toHaveTextContent(`keçdiyi saat: ${hhmm(NOW - 60_000)}`);
      await act(async () => {
        fireEvent.click(within(row).getByRole("button", { name: SEEN }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalledWith("S-001", "septic_shock");
      expect(screen.queryByText("Septic shock criteria met")).toBeNull();     // the ack removed it
    });

    // After severity, an alarm that still fires comes first — even when the one that passed is older.
    it("lists a critical that still fires above one that passed, though the latter is older", async () => {
      await open({
        payload: withAlarms(
          alarm("septic_shock", "critical", { summary: "Passed critical", first_seen_at: ago(900), resolved_at: ago(60) }),
          alarm("sepsis", "critical", { summary: "Firing critical", first_seen_at: ago(120) }),
        ),
      });
      const waiting = screen.getByRole("heading", { level: 2, name: /Cavab gözləyir/ }).parentElement;
      const rows = within(waiting).getAllByRole("listitem");
      expect(rows[0]).toHaveTextContent("Firing critical");
      expect(rows[1]).toHaveTextContent("Passed critical");
    });

    it("shows no such badge on an alarm that still fires", async () => {
      await open({ payload: withAlarms(alarm("septic_shock", "critical")) });
      expect(screen.queryByText("keçdi · təsdiqlənməyib")).toBeNull();
    });

    // Several rows carry the same button; read alone, "Gördüm" says nothing about WHICH alarm it
    // answers. The name carries the bed and the kind (the words the refusal toast uses), and still
    // contains the visible word, so a voice-control user who says it is understood.
    it("names the alarm its acknowledge button answers — the bed and the kind — and keeps the visible word", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })) });
      const button = screen.getByRole("button", { name: /gördüm/i });
      expect(button).toHaveAccessibleName(/REA-01 · 2/);
      expect(button).toHaveAccessibleName(/news2/);
      expect(button).toHaveTextContent("Gördüm");
    });

    it("a refusal is shown and the list is NOT changed — nothing was acknowledged", async () => {
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        setup: (fake) => fake.acknowledge.mockRejectedValue(refusal(403, "permission required: alerts.ack")),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: SEEN }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalled();
      const alerts = screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
      expect(alerts).toContain("səlahiyyətiniz yoxdur (alerts.ack)");
      expect(screen.getByRole("button", { name: SEEN })).toBeInTheDocument();
    });

    it("an alarm somebody else answered says so", async () => {
      await open({
        payload: withAlarms(alarm("news2")),
        setup: (fake) => fake.acknowledge.mockRejectedValue(refusal(404, "no such active alert")),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: SEEN }));
        await settle();
      });
      expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" "))
        .toContain("Bu siqnal artıq açıq deyil");
    });

    it("names the alarm a refused acknowledgement was for", async () => {
      // Same rule as the charting's refusal, and for the same reason: a nurse who reads only
      // "you do not have permission" cannot tell which alarm is still unanswered. The bed and
      // the kind, in the vocabulary the row itself uses.
      await open({
        payload: withAlarms(alarm("news2")),
        setup: (fake) => fake.acknowledge.mockRejectedValue(refusal(403, "permission required: alerts.ack")),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: SEEN }));
        await settle();
      });
      const said = within(screen.getByRole("region", { name: "Bildirişlər" })).getAllByText(/REA-01 · 2 · news2/);
      expect(said.length).toBeGreaterThan(0);
      expect(said.map((n) => n.textContent).join(" ")).toContain("səlahiyyətiniz yoxdur");
    });

    it("a refusal survives the clinician leaving the screen", async () => {
      // The same rule as the patient screen's charting, and the consistency is the point: the two
      // clinical writes this build has must behave alike when the server says no. A refusal held
      // in the screen's own state is lost the moment she moves, and a nurse who saw no error
      // believes the alarm is answered when nobody has answered it.
      let leave;
      function Away() {
        const [here, setHere] = React.useState(true);
        leave = () => setHere(false);
        return here ? <AlarmsScreen /> : null;
      }
      const mounted = await mount(<Away />, {
        access: token({ perms: ["board.view", "alerts.ack"] }),
        me: profile({ perms: ["board.view", "alerts.ack"] }),
        setup: (fake) => {
          fake.boardPatients.mockResolvedValue(withAlarms(alarm("news2")));
          fake.streamTicket.mockResolvedValue({ ticket: "t-1" });
          fake.acknowledge.mockRejectedValue(refusal(403, "permission required: alerts.ack"));
        },
      });
      await act(async () => { await mounted.board.start(); });
      await act(async () => { mounted.stream.open(); await settle(); });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: SEEN }));
        await settle();
      });
      const said = () => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(/səlahiyyətiniz yoxdur/);
      expect(said().length).toBeGreaterThan(0);
      await act(async () => { leave(); await settle(); });
      expect(screen.queryByRole("button", { name: SEEN })).toBeNull();   // the screen is gone
      expect(said().length).toBeGreaterThan(0);                              // the refusal is not
    });

    it("says it is saving, in words a screen reader hears", async () => {
      let release;
      await open({
        payload: withAlarms(alarm("news2")),
        setup: (fake) => fake.acknowledge.mockImplementation(() => new Promise((resolve) => { release = resolve; })),
      });
      const button = screen.getByRole("button", { name: SEEN });
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
      expect(screen.queryByRole("button", { name: SEEN })).toBeNull();
      expect(screen.getByText(/«alerts.ack» səlahiyyəti lazımdır/)).toBeInTheDocument();
    });
  });

  // G2-B5 (spec D8): «RRT çağır» — a holder of alerts.escalate calls the rapid-response team to an alarm that
  // waits for an answer, with a reason. Synthetic accounts and reasons only.
  describe("calling the RRT", () => {
    /** The rapid-response team's rights (catalogue `rapid_response`). */
    const CALLER = ["board.view", "alerts.ack", "alerts.escalate"];
    /** The row's button. Its accessible name also names the bed and the kind, so it is found by the words. */
    const CALL = /RRT-ni çağır/;
    const REASON = "Tənəffüs çətinləşir";
    const ANSWERED = "Bu siqnal artıq cavablandırılıb; RRT çağırışı açılmadı.";
    const dialog = () => screen.getByRole("dialog", { name: "RRT-ni çağır · REA-01 · 2" });
    const toasts = () => within(screen.getByRole("region", { name: "Bildirişlər" }));
    const rowOf = (summary) => screen.getByText(summary, { selector: "p" }).closest("li");

    /** Opens the dialog from the row, writes `reason`, and presses «Çağır». */
    async function callWith(reason) {
      fireEvent.click(screen.getByRole("button", { name: CALL }));
      fireEvent.change(within(dialog()).getByRole("textbox", { name: /Səbəb/ }), { target: { value: reason } });
      await act(async () => {
        fireEvent.click(within(dialog()).getByRole("button", { name: "Çağır" }));
        await settle();
      });
    }

    it("is offered on an alarm that waits for an answer, naming it — not on an answered one", async () => {
      await open({
        payload: withAlarms(
          alarm("news2", "high", { summary: "NEWS2 7" }),
          alarm("map", "high", { summary: "Answered", acknowledged: true, acknowledged_by: "ayse", acknowledged_at: ago(10) }),
        ),
        perms: CALLER,
      });
      const button = screen.getByRole("button", { name: CALL });       // one: the answered alarm has none
      expect(button).toHaveTextContent("RRT-ni çağır");
      expect(button).toHaveAccessibleName("RRT-ni çağır: REA-01 · 2, news2");
      expect(within(rowOf("NEWS2 7")).getByRole("button", { name: CALL })).toBe(button);
    });

    it("is not offered without alerts.escalate", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })) });
      expect(screen.getByRole("button", { name: SEEN })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: CALL })).toBeNull();
    });

    it("refuses a reason shorter than 3 characters without asking the server", async () => {
      const { api } = await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })), perms: CALLER });
      await callWith("  ab  ");
      expect(within(dialog()).getByText("Səbəb ən azı 3 simvol olmalıdır.")).toBeInTheDocument();
      expect(within(dialog()).getByRole("textbox", { name: /Səbəb/ })).toHaveAttribute("aria-invalid", "true");
      expect(api.callRrt).not.toHaveBeenCalled();
    });

    it("sends the reason, puts the card the server answered with on the board, and says so", async () => {
      // The session's own account (profile(): «ayse») made this call: the engine records the caller's username.
      const answered = entry("S-001", [alarm("news2", "high", {
        summary: "NEWS2 7", rrt_call: { by: "ayse", at: ago(0), reason: REASON },
      })], { ...CARD, risk: "high" });
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        perms: CALLER,
        setup: (fake) => fake.callRrt.mockResolvedValue(answered),
      });
      await callWith(`  ${REASON} `);
      expect(api.callRrt).toHaveBeenCalledWith("S-001", "news2", REASON);
      expect(screen.queryByRole("dialog")).toBeNull();
      const row = rowOf("NEWS2 7");
      expect(row).toHaveTextContent(`RRT çağırılıb · ayse · ${hhmm(NOW)}`);
      expect(within(row).queryByRole("button", { name: CALL })).toBeNull();
      expect(toasts().getAllByText("REA-01 · 2 · news2: RRT çağırıldı.").length).toBeGreaterThan(0);
    });

    it("Enter in the reason box sends the call", async () => {
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        perms: CALLER,
        setup: (fake) => fake.callRrt.mockResolvedValue(entry("S-001", [alarm("news2", "high", {
          summary: "NEWS2 7", rrt_call: { by: "ayse", at: ago(0), reason: REASON },
        })], { ...CARD, risk: "high" })),
      });
      fireEvent.click(screen.getByRole("button", { name: CALL }));
      const box = within(dialog()).getByRole("textbox", { name: /Səbəb/ });
      fireEvent.change(box, { target: { value: REASON } });
      // The form's submit: user-event is not installed here, and jsdom has no implicit submission
      // (RetractDialog.test.jsx does the same).
      await act(async () => {
        fireEvent.submit(box.closest("form"));
        await settle();
      });
      expect(api.callRrt).toHaveBeenCalledWith("S-001", "news2", REASON);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("asks for no names or identity numbers in the reason, which goes to the audit trail", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })), perms: CALLER });
      fireEvent.click(screen.getByRole("button", { name: CALL }));
      const box = within(dialog()).getByRole("textbox", { name: /Səbəb/ });
      expect(within(dialog()).getByText(/ad və ya şəxsiyyət nömrəsi yazmayın/)).toBeInTheDocument();
      expect(box).toHaveAccessibleDescription(/ad və ya şəxsiyyət nömrəsi yazmayın/);
    });

    it("a short reason takes the focus back to the box, where the problem is read first", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })), perms: CALLER });
      fireEvent.click(screen.getByRole("button", { name: CALL }));
      const box = within(dialog()).getByRole("textbox", { name: /Səbəb/ });
      fireEvent.change(box, { target: { value: "ab" } });
      // A real press puts the focus on the button first; fireEvent.click does not, and the box would keep the
      // focus its autoFocus gave it whatever the dialog did.
      const send = within(dialog()).getByRole("button", { name: "Çağır" });
      send.focus();
      expect(document.activeElement).toBe(send);
      await act(async () => {
        fireEvent.click(send);
        await settle();
      });
      expect(document.activeElement).toBe(box);
      expect(box).toHaveAccessibleDescription(/^Səbəb ən azı 3 simvol olmalıdır\./);
    });

    // G2-A1 (O17): a critical whose rule stopped before anyone answered it still waits — and may still need the team.
    it("a critical whose condition passed unanswered can be called", async () => {
      const passed = { summary: "Septic shock criteria met", resolved_at: ago(60) };
      const { api } = await open({
        payload: withAlarms(alarm("septic_shock", "critical", passed)),
        perms: CALLER,
        setup: (fake) => fake.callRrt.mockResolvedValue(entry("S-001", [alarm("septic_shock", "critical", {
          ...passed, rrt_call: { by: "ayse", at: ago(0), reason: REASON },
        })], { ...CARD })),
      });
      await callWith(REASON);
      expect(api.callRrt).toHaveBeenCalledWith("S-001", "septic_shock", REASON);
      const row = rowOf("Septic shock criteria met");
      expect(within(row).getByText("keçdi · təsdiqlənməyib")).toBeInTheDocument();
      expect(row).toHaveTextContent(`RRT çağırılıb · ayse · ${hhmm(NOW)}`);
      expect(toasts().getAllByText("REA-01 · 2 · septic_shock: RRT çağırıldı.").length).toBeGreaterThan(0);
    });

    // The engine keeps the FIRST call and writes nothing for a second one: a call another desk made a moment
    // earlier must not be reported as hers, with her reason.
    it("an earlier call is said: the engine kept it, and her reason was not added", async () => {
      await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        perms: CALLER,
        setup: (fake) => fake.callRrt.mockResolvedValue(entry("S-001", [alarm("news2", "high", {
          summary: "NEWS2 7", rrt_call: { by: "leyla", at: ago(30), reason: "Saturasiya düşür" },
        })], { ...CARD, risk: "high" })),
      });
      await callWith(REASON);
      expect(toasts().getAllByText("REA-01 · 2 · news2: RRT artıq çağırılıb (leyla); səbəbiniz əlavə edilmədi.").length)
        .toBeGreaterThan(0);
      expect(toasts().queryByText("REA-01 · 2 · news2: RRT çağırıldı.")).toBeNull();
      expect(rowOf("NEWS2 7")).toHaveTextContent(`RRT çağırılıb · leyla · ${hhmm(NOW - 30_000)}`);
    });

    // A write with no answer is not a refusal (screens/admin/refusal.js `mayHaveLanded`): the engine may have
    // recorded the call before the line went, and «RRT çağırılmadı» would be false.
    it("a call that got no answer may have been made: a warning, not a refusal", async () => {
      const timedOut = Object.assign(new Error("…"), { code: "REQUEST_TIMEOUT" });
      await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        perms: CALLER,
        setup: (fake) => fake.callRrt.mockRejectedValue(timedOut),
      });
      await callWith(REASON);
      const said = toasts().getAllByText(
        "REA-01 · 2 · news2: cavab gəlmədi — RRT çağırılmış ola bilər. Sətrə baxın; yenidən çağırmaq zərərsizdir.",
      );
      expect(said.map((n) => n.closest("[data-tone]")?.getAttribute("data-tone"))).toContain("warn");
      expect(toasts().queryAllByText(/RRT çağırılmadı/)).toHaveLength(0);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("a refusal is a toast naming the alarm, in the reader's words — and nothing changes", async () => {
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        perms: CALLER,
        setup: (fake) => fake.callRrt.mockRejectedValue(refusal(409, "alarm zaten yanıtlandı; RRT çağrısı açılmaz")),
      });
      await callWith(REASON);
      expect(api.callRrt).toHaveBeenCalledWith("S-001", "news2", REASON);
      expect(toasts().getAllByText(`REA-01 · 2 · news2: RRT çağırılmadı — ${ANSWERED}`).length).toBeGreaterThan(0);
      expect(screen.queryByRole("dialog")).toBeNull();
      const row = rowOf("NEWS2 7");
      expect(row).not.toHaveTextContent("RRT çağırılıb");
      expect(within(row).getByRole("button", { name: CALL })).toBeInTheDocument();
    });

    it("an alarm already called says who called it and when, and offers no second call", async () => {
      await open({
        payload: withAlarms(alarm("news2", "high", {
          summary: "NEWS2 7", rrt_call: { by: "leyla", at: ago(120), reason: REASON },
        })),
        perms: CALLER,
      });
      const row = rowOf("NEWS2 7");
      expect(row).toHaveTextContent(`RRT çağırılıb · leyla · ${hhmm(NOW - 120_000)}`);
      expect(screen.queryByRole("button", { name: CALL })).toBeNull();
      // A call is not an answer: the alarm still waits for its acknowledgement (spec D4).
      expect(within(row).getByRole("button", { name: SEEN })).toBeInTheDocument();
    });
  });

  describe("snoozing («Ertele», G2-B5b)", () => {
    /** The row's button. Its accessible name also names the bed and the kind, so it is found by the words and the colon. */
    const SNOOZE = /Təxirə sal:/;
    const dialog = () => screen.getByRole("dialog", { name: "Təxirə sal · REA-01 · 2" });
    const toasts = () => within(screen.getByRole("region", { name: "Bildirişlər" }));
    const rowOf = (summary) => screen.getByText(summary, { selector: "p" }).closest("li");
    const sectionOf = (name) => screen.getByRole("heading", { level: 2, name }).closest("section");
    const send = async () => {
      await act(async () => {
        fireEvent.click(within(dialog()).getByRole("button", { name: "Təxirə sal" }));
        await settle();
      });
    };
    const snoozedFor = (minutesLeft, over = {}) => ({ by: "leyla", at: ago(300),
      until: new Date(NOW + minutesLeft * 60_000).toISOString(), minutes: 5 + minutesLeft,
      reason: "ARTEFACT_OR_SIGNAL_NOISE", reason_text: null, ...over });

    it("is offered on an unanswered high or moderate alarm — not on a critical, an answered or a low one", async () => {
      await open({ payload: withAlarms(
        alarm("news2", "high", { summary: "NEWS2 7" }),
        alarm("acute_change", "moderate", { summary: "Moderate one" }),
        alarm("septic_shock", "critical", { summary: "Shock" }),
        alarm("map", "high", { summary: "Answered", acknowledged: true, acknowledged_by: "ayse", acknowledged_at: ago(10) }),
        alarm("hr_low", "low", { summary: "Low one" }),
      ) });
      expect(within(rowOf("NEWS2 7")).getByRole("button", { name: SNOOZE }))
        .toHaveAccessibleName("Təxirə sal: REA-01 · 2, news2");
      expect(within(rowOf("Moderate one")).getByRole("button", { name: SNOOZE })).toBeInTheDocument();
      expect(within(rowOf("Shock")).queryByRole("button", { name: SNOOZE })).toBeNull();
      expect(within(rowOf("Answered")).queryByRole("button", { name: SNOOZE })).toBeNull();
      expect(within(rowOf("Low one")).queryByRole("button", { name: SNOOZE })).toBeNull();
    });

    it("says once that a critical alarm cannot be snoozed, beside the first critical one", async () => {
      await open({ payload: withAlarms(
        alarm("septic_shock", "critical", { summary: "Shock" }),
        alarm("antibiotic_overdue", "critical", { summary: "Overdue" }),
      ) });
      expect(screen.getAllByText("Kritik siqnal təxirə salına bilməz.")).toHaveLength(1);
    });

    it("is not offered without alerts.ack, and the critical note is not said either", async () => {
      await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" }), alarm("septic_shock", "critical", { summary: "Shock" })),
        perms: ["board.view"],
      });
      expect(screen.queryByRole("button", { name: SNOOZE })).toBeNull();
      expect(screen.queryByText("Kritik siqnal təxirə salına bilməz.")).toBeNull();
    });

    it("offers a high alarm the durations within 30 minutes, the reasons, and says when it sounds again", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })) });
      fireEvent.click(screen.getByRole("button", { name: SNOOZE }));
      const durations = within(dialog()).getByRole("group", { name: "Müddət" });
      expect(within(durations).getAllByRole("button").map((b) => b.textContent)).toEqual(["5 dəq", "10 dəq", "15 dəq", "30 dəq"]);
      expect(within(durations).getByRole("button", { name: "5 dəq" })).toHaveAttribute("aria-pressed", "true");
      const reasons = within(dialog()).getByRole("combobox", { name: /Səbəb/ });
      expect([...reasons.options].map((o) => o.textContent)).toEqual(["Səbəb seçin", "Klinik qərar verilib",
        "Artefakt və ya siqnal küyü", "Prosedur gedir", "Xəstənin öz norması", "Digər"]);
      expect(within(dialog()).getByText(`Siqnal yenidən səslənəcək: ${hhmm(NOW + 5 * 60_000)}`)).toBeInTheDocument();
      fireEvent.click(within(durations).getByRole("button", { name: "30 dəq" }));
      expect(within(dialog()).getByText(`Siqnal yenidən səslənəcək: ${hhmm(NOW + 30 * 60_000)}`)).toBeInTheDocument();
    });

    it("offers a moderate alarm up to 120 minutes", async () => {
      await open({ payload: withAlarms(alarm("acute_change", "moderate", { summary: "Moderate one" })) });
      fireEvent.click(screen.getByRole("button", { name: SNOOZE }));
      const durations = within(dialog()).getByRole("group", { name: "Müddət" });
      expect(within(durations).getAllByRole("button").map((b) => b.textContent)).toEqual(["15 dəq", "30 dəq", "60 dəq", "120 dəq"]);
    });

    it("asks for a reason, and for «Digər» at least 15 characters, without asking the server", async () => {
      const { api } = await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })) });
      fireEvent.click(screen.getByRole("button", { name: SNOOZE }));
      await send();
      expect(within(dialog()).getByText("Siyahıdan bir səbəb seçin.")).toBeInTheDocument();
      expect(document.activeElement).toBe(within(dialog()).getByRole("combobox", { name: /Səbəb/ }));
      fireEvent.change(within(dialog()).getByRole("combobox", { name: /Səbəb/ }), { target: { value: "OTHER" } });
      const text = within(dialog()).getByRole("textbox", { name: /İzah/ });
      expect(text).toHaveAccessibleDescription(/şəxsiyyət nömrəsi yazmayın/);
      fireEvent.change(text, { target: { value: "  qısa izah  " } });
      await send();
      expect(within(dialog()).getByText("İzah ən azı 15 simvol olmalıdır.")).toBeInTheDocument();
      expect(document.activeElement).toBe(text);
      expect(api.snoozeAlert).not.toHaveBeenCalled();
    });

    it("sends the snooze, puts the card the server answered with on the board, and moves the alarm to «Təxirə salınanlar»", async () => {
      const until = new Date(NOW + 15 * 60_000).toISOString();
      const answered = entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7",
        snooze: { by: "ayse", at: ago(0), until, minutes: 15, reason: "PATIENT_BASELINE", reason_text: null } })],
      { ...CARD, risk: "high" });
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        setup: (fake) => fake.snoozeAlert.mockResolvedValue(answered),
      });
      fireEvent.click(screen.getByRole("button", { name: SNOOZE }));
      fireEvent.click(within(within(dialog()).getByRole("group", { name: "Müddət" })).getByRole("button", { name: "15 dəq" }));
      fireEvent.change(within(dialog()).getByRole("combobox", { name: /Səbəb/ }), { target: { value: "PATIENT_BASELINE" } });
      await send();
      expect(api.snoozeAlert).toHaveBeenCalledWith("S-001", "news2", 15, "PATIENT_BASELINE", null, "high");
      expect(screen.queryByRole("dialog")).toBeNull();
      const row = within(sectionOf(/Təxirə salınanlar/)).getByText("NEWS2 7", { selector: "p" }).closest("li");
      expect(row).toHaveTextContent(`Təxirə salınıb · bitmə ${hhmm(NOW + 15 * 60_000)} · ayse · Xəstənin öz norması`);
      expect(within(sectionOf(/Cavab gözləyir/)).queryByText("NEWS2 7")).toBeNull();
      expect(toasts().getAllByText(`REA-01 · 2 · news2: təxirə salındı, bitmə ${hhmm(NOW + 15 * 60_000)}.`).length)
        .toBeGreaterThan(0);
    });

    it("sends «Digər» with its explanation, trimmed", async () => {
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        setup: (fake) => fake.snoozeAlert.mockResolvedValue(entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7" })], { ...CARD, risk: "high" })),
      });
      fireEvent.click(screen.getByRole("button", { name: SNOOZE }));
      fireEvent.change(within(dialog()).getByRole("combobox", { name: /Səbəb/ }), { target: { value: "OTHER" } });
      fireEvent.change(within(dialog()).getByRole("textbox", { name: /İzah/ }), { target: { value: "  Xəstə yuyulur, sensor çıxıb " } });
      await send();
      expect(api.snoozeAlert).toHaveBeenCalledWith("S-001", "news2", 5, "OTHER", "Xəstə yuyulur, sensor çıxıb", "high");
    });

    it("a snoozed alarm says until when, by whom and why, and can still be answered or snoozed again", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7",
        snooze: snoozedFor(10, { reason: "OTHER", reason_text: "Xəstə yuyulur, sensor çıxıb" }) })) });
      const row = rowOf("NEWS2 7");
      expect(row).toHaveTextContent(`Təxirə salınıb · bitmə ${hhmm(NOW + 10 * 60_000)} · leyla · Xəstə yuyulur, sensor çıxıb`);
      expect(within(sectionOf(/Təxirə salınanlar/)).getByText("NEWS2 7", { selector: "p" })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: SEEN })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: SNOOZE })).toBeInTheDocument();
    });

    it("a snooze whose time has passed is back among the waiting, with no snooze line", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7", snooze: snoozedFor(-1) })) });
      expect(screen.queryByRole("heading", { level: 2, name: /Təxirə salınanlar/ })).toBeNull();
      expect(within(sectionOf(/Cavab gözləyir/)).getByText("NEWS2 7", { selector: "p" })).toBeInTheDocument();
      expect(rowOf("NEWS2 7")).not.toHaveTextContent("Təxirə salınıb");
    });

    it("a refusal is a toast naming the alarm, in the reader's words — and nothing changes", async () => {
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        setup: (fake) => fake.snoozeAlert.mockRejectedValue(refusal(409, "alarm zaten yanıtlandı; ertelenmez")),
      });
      fireEvent.click(screen.getByRole("button", { name: SNOOZE }));
      fireEvent.change(within(dialog()).getByRole("combobox", { name: /Səbəb/ }), { target: { value: "CLINICAL_DECISION_MADE" } });
      await send();
      expect(api.snoozeAlert).toHaveBeenCalledWith("S-001", "news2", 5, "CLINICAL_DECISION_MADE", null, "high");
      expect(toasts().getAllByText("REA-01 · 2 · news2: təxirə salınmadı — Bu siqnal artıq cavablandırılıb; təxirə salınmadı.").length)
        .toBeGreaterThan(0);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByRole("heading", { level: 2, name: /Təxirə salınanlar/ })).toBeNull();
    });

    it("a snooze that got no answer may have landed: a warning, not a refusal", async () => {
      const timedOut = Object.assign(new Error("…"), { code: "REQUEST_TIMEOUT" });
      await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        setup: (fake) => fake.snoozeAlert.mockRejectedValue(timedOut),
      });
      fireEvent.click(screen.getByRole("button", { name: SNOOZE }));
      fireEvent.change(within(dialog()).getByRole("combobox", { name: /Səbəb/ }), { target: { value: "PROCEDURE_IN_PROGRESS" } });
      await send();
      const said = toasts().getAllByText(
        "REA-01 · 2 · news2: cavab gəlmədi — siqnal təxirə salınmış ola bilər. Sətrə baxın; yenidən təxirə salmaq zərərsizdir.",
      );
      expect(said.map((n) => n.closest("[data-tone]")?.getAttribute("data-tone"))).toContain("warn");
      expect(toasts().queryAllByText(/təxirə salınmadı —/)).toHaveLength(0);
    });

    // Review (G2-B5b): the dialog acts on the alarm as the board holds it NOW, not on the picture it opened with. A
    // moderate alarm that turns high while it is open must not be snoozed for a moderate's minutes; one answered or
    // gone is not snoozed at all. «Ertele» is held, saying why, and nothing is sent.
    const CHANGED = "Bu siqnal pəncərə açıq ikən dəyişdi; buradan təxirə salına bilməz. Pəncərəni bağlayıb siqnala yenidən baxın.";
    const sendButton = () => within(dialog()).getByRole("button", { name: "Təxirə sal" });
    const durationsOf = () => within(within(dialog()).getByRole("group", { name: "Müddət" })).getAllByRole("button")
      .map((b) => b.textContent);

    it("an alarm that worsens while the dialog is open is shown as it is now, and «Ertele» is held, saying why", async () => {
      const { api, stream } = await open({ payload: withAlarms(alarm("acute_change", "moderate", { summary: "Moderate one" })) });
      fireEvent.click(screen.getByRole("button", { name: SNOOZE }));
      expect(durationsOf()).toEqual(["15 dəq", "30 dəq", "60 dəq", "120 dəq"]);
      fireEvent.click(within(within(dialog()).getByRole("group", { name: "Müddət" })).getByRole("button", { name: "120 dəq" }));
      fireEvent.change(within(dialog()).getByRole("combobox", { name: /Səbəb/ }), { target: { value: "PATIENT_BASELINE" } });
      expect(sendButton()).not.toHaveAttribute("aria-disabled");
      act(() => { stream.frame(entry("S-001", [alarm("acute_change", "high", { summary: "Worse one" })], { ...CARD, risk: "high" })); });
      expect(within(dialog()).getByText("Worse one")).toBeInTheDocument();
      expect(durationsOf()).toEqual(["5 dəq", "10 dəq", "15 dəq", "30 dəq"]);
      expect(sendButton()).toHaveAttribute("aria-disabled", "true");
      expect(sendButton()).toHaveAccessibleDescription(CHANGED);
      expect(within(dialog()).queryByText(/Siqnal yenidən səslənəcək/)).toBeNull();
      await send();
      expect(api.snoozeAlert).not.toHaveBeenCalled();
      expect(dialog()).toBeInTheDocument();
    });

    it("an alarm answered while the dialog is open is not snoozed: «Ertele» is held, saying why", async () => {
      const { api, stream } = await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })) });
      fireEvent.click(screen.getByRole("button", { name: SNOOZE }));
      fireEvent.change(within(dialog()).getByRole("combobox", { name: /Səbəb/ }), { target: { value: "PATIENT_BASELINE" } });
      act(() => {
        stream.frame(entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7", acknowledged: true, acknowledged_by: "ayse",
          acknowledged_at: ago(0) })], { ...CARD, risk: "high" }));
      });
      expect(sendButton()).toHaveAttribute("aria-disabled", "true");
      expect(sendButton()).toHaveAccessibleDescription(CHANGED);
      await send();
      expect(api.snoozeAlert).not.toHaveBeenCalled();
    });

    it("an alarm gone from the board while the dialog is open is not snoozed either", async () => {
      const { api, stream } = await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })) });
      fireEvent.click(screen.getByRole("button", { name: SNOOZE }));
      fireEvent.change(within(dialog()).getByRole("combobox", { name: /Səbəb/ }), { target: { value: "PATIENT_BASELINE" } });
      act(() => { stream.frame(entry("S-001", [], CARD)); });
      expect(within(dialog()).getByText("NEWS2 7")).toBeInTheDocument();   // the alarm it was, for the reader
      expect(sendButton()).toHaveAttribute("aria-disabled", "true");
      await send();
      expect(api.snoozeAlert).not.toHaveBeenCalled();
    });

    it("the engine's refusal of a severity that changed under the request is said in the reader's words", async () => {
      await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        setup: (fake) => fake.snoozeAlert.mockRejectedValue(refusal(409, "alarmın önemi değişti; ertelemeyi yeniden seçin")),
      });
      fireEvent.click(screen.getByRole("button", { name: SNOOZE }));
      fireEvent.change(within(dialog()).getByRole("combobox", { name: /Səbəb/ }), { target: { value: "PATIENT_BASELINE" } });
      await send();
      expect(toasts().getAllByText("REA-01 · 2 · news2: təxirə salınmadı — Siqnalın ağırlıq dərəcəsi dəyişdi; təxirə "
        + "salınmadı. Siqnala yenidən baxıb təxirə salmanı yenidən seçin.").length).toBeGreaterThan(0);
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

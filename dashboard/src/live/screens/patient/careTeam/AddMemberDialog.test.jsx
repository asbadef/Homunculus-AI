// «Ekibe ekle» (G2-B1c, spec §4, D8, T8, X6, X9): the candidates by name, a search over them, the role,
// and for an on-call physician her window — an end after the start, in the future, at most 48 hours
// later. Making a new attending says who leaves. The server checks it all again; a refusal goes on the
// toast, named after the bed, and the box reads the team again.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { expectNoUuid, settle, toasts } from "../../kabul/kabul.testutil.js";
import { fromLocalInput, localInput } from "../../kabul/DischargeDialog.jsx";
import { AddMemberDialog } from "./AddMemberDialog.jsx";

const ADM = "77777777-7777-4777-8777-777777777701";
const ONC = "66666666-6666-4666-8666-666666666602";
const ASC = "66666666-6666-4666-8666-666666666603";
const SUBJECT = "2 · Otaq 1 · Reanimasiya";
const HOUR = 3_600_000;
const ASSIGN = ["board.view", "admissions.view", "care_team.assign"];
const CANDIDATES = [{ user_id: ASC, full_name: "Sentetik Köməkçi" }, { user_id: ONC, full_name: "Sentetik Növbətçi" }];
const ATTENDING = { user_id: "66666666-6666-4666-8666-666666666601", full_name: "Sentetik Həkim" };

const dialog = () => screen.getByRole("dialog");
const submit = () => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Əlavə et" })); });
const pick = (name) => fireEvent.click(within(dialog()).getByRole("radio", { name }));

async function open({ candidates = CANDIDATES, attending = ATTENDING, setup } = {}) {
  const done = vi.fn(async () => {});
  const refused = vi.fn();
  const closed = vi.fn();
  const mounted = await mount(
    <AddMemberDialog admissionId={ADM} subject={SUBJECT} attending={attending} onClose={closed} onDone={done}
      onRefused={refused} />,
    {
      access: token({ perms: ASSIGN }), me: profile({ perms: ASSIGN }),
      setup: (api) => {
        if (candidates instanceof Error) api.careTeamCandidates.mockRejectedValue(candidates);
        else api.careTeamCandidates.mockResolvedValue(candidates);
        setup?.(api);
      },
    });
  await settle();
  return { ...mounted, done, refused, closed };
}

const search = () => within(dialog()).getByLabelText("Həkim axtar");
const typeSearch = (value) => fireEvent.change(search(), { target: { value } });
const START_LABEL = /^Başlanğıc/;
const END_LABEL = /^Son/;
const setWindow = (label, ms) => fireEvent.change(within(dialog()).getByLabelText(label),
  { target: { value: ms === null ? "" : localInput(ms) } });

describe("AddMemberDialog", () => {
  it("lists the candidates by name, narrows them as the search is typed, and shows no id", async () => {
    const { api } = await open();
    expect(api.careTeamCandidates).toHaveBeenCalledWith(ADM);
    expect(within(dialog()).getByRole("radio", { name: "Sentetik Köməkçi" })).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText("Həkim axtar"), { target: { value: "növ" } });
    expect(within(dialog()).queryByRole("radio", { name: "Sentetik Köməkçi" })).toBeNull();
    expect(within(dialog()).getByRole("radio", { name: "Sentetik Növbətçi" })).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText("Həkim axtar"), { target: { value: "xyz" } });
    expect(within(dialog()).getByText("Bu adla həkim yoxdur.")).toBeTruthy();
    expectNoUuid();
  });

  it("adds an associate by default, says so, and hands the words back to the box", async () => {
    const { api, done } = await open({ setup: (a) => a.addCareTeamMember.mockResolvedValue({}) });
    pick("Sentetik Köməkçi");
    expect(within(dialog()).getByRole("radio", { name: "Köməkçi həkim" })).toBeChecked();
    await submit();
    await settle();
    expect(api.addCareTeamMember).toHaveBeenCalledWith(ADM, { user_id: ASC, role: "ASSOCIATE_PHYSICIAN" });
    expect(toasts().getAllByText(`${SUBJECT} · Sentetik Köməkçi komandaya əlavə edildi.`).length).toBeGreaterThan(0);
    expect(done).toHaveBeenCalledWith("Sentetik Köməkçi komandaya əlavə edildi.");
  });

  it("asks for a physician before it sends anything", async () => {
    const { api } = await open();
    await submit();
    expect(within(dialog()).getByText("Həkim seçin.")).toBeTruthy();
    expect(api.addCareTeamMember).not.toHaveBeenCalled();
  });

  it("asks an on-call window for an end after its start, in the future and within 48 hours", async () => {
    const { api } = await open({ setup: (a) => a.addCareTeamMember.mockResolvedValue({}) });
    pick("Sentetik Növbətçi");
    pick("Növbətçi həkim");
    const set = (label, ms) => fireEvent.change(within(dialog()).getByLabelText(label), { target: { value: localInput(ms) } });
    const START = /^Başlanğıc/;
    const END = /^Son/;
    const now = Date.now();
    await submit();
    expect(within(dialog()).getByText("Sonu seçin.")).toBeTruthy();
    set(START, now);
    set(END, now - HOUR);
    await submit();
    expect(within(dialog()).getByText("Son başlanğıcdan sonra olmalıdır.")).toBeTruthy();
    set(START, now - 10 * HOUR);
    set(END, now - 2 * HOUR);
    await submit();
    expect(within(dialog()).getByText("Son gələcəkdə olmalıdır.")).toBeTruthy();
    set(START, now);
    set(END, now + 49 * HOUR);
    await submit();
    // The hint under the end says it, and so does the refusal.
    expect(within(dialog()).getAllByText("Növbə ən çox 48 saat davam edir.")).toHaveLength(2);
    expect(api.addCareTeamMember).not.toHaveBeenCalled();
    set(END, now + 12 * HOUR);
    await submit();
    await settle();
    expect(api.addCareTeamMember).toHaveBeenCalledWith(ADM, {
      user_id: ONC, role: "ONCALL_PHYSICIAN",
      window_start: new Date(fromLocalInput(localInput(now))).toISOString(),
      window_end: new Date(fromLocalInput(localInput(now + 12 * HOUR))).toISOString(),
    });
  });

  it("says who leaves before a new attending is made, and sends the role", async () => {
    const { api, done } = await open({ setup: (a) => a.addCareTeamMember.mockResolvedValue({}) });
    pick("Sentetik Köməkçi");
    pick("Məsul həkim");
    expect(within(dialog()).getByText("Sentetik Köməkçi məsul həkim olur; Sentetik Həkim komandadan çıxır.")).toBeTruthy();
    await submit();
    await settle();
    expect(api.addCareTeamMember).toHaveBeenCalledWith(ADM, { user_id: ASC, role: "ATTENDING" });
    expect(done).toHaveBeenCalledWith("Sentetik Köməkçi məsul həkim oldu.");
  });

  it("puts a refusal on the toast by its code, named after the bed, and tells the box", async () => {
    const { done, refused } = await open({ setup: (a) => a.addCareTeamMember.mockRejectedValue(
      refusal(409, "English words", { apiCode: "care_team_not_physician" })) });
    pick("Sentetik Köməkçi");
    await submit();
    await settle();
    expect(toasts().getAllByText(`${SUBJECT}: Baxım komandasına yalnız həkimlər daxil olur.`).length).toBeGreaterThan(0);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
  });

  it("says when the physicians cannot be read", async () => {
    await open({ candidates: refusal(503, "down") });
    expect(within(dialog()).getByText(/^Həkimlər oxunmadı: /)).toBeTruthy();
  });

  it("says when nobody can be added", async () => {
    await open({ candidates: [] });
    expect(within(dialog()).getByText("Əlavə edilə biləcək həkim yoxdur.")).toBeTruthy();
  });

  // ── The review of Tasks 14–15 ────────────────────────────────────────────────────────────────────────

  it("keeps the physician she picked on the list when the search would hide her, and Enter in the search sends nothing", async () => {
    const { api } = await open({ setup: (a) => a.addCareTeamMember.mockResolvedValue({}) });
    pick("Sentetik Köməkçi");
    typeSearch("növ");
    // What is sent is always what is seen: the picked row stays, checked, beside the name that matches.
    expect(within(dialog()).getByRole("radio", { name: "Sentetik Köməkçi" })).toBeChecked();
    expect(within(dialog()).getByRole("radio", { name: "Sentetik Növbətçi" })).not.toBeChecked();
    // Enter in a text box submits its form in a browser; fireEvent returns false when the default was stopped.
    expect(fireEvent.keyDown(search(), { key: "Enter" })).toBe(false);
    await settle();
    expect(api.addCareTeamMember).not.toHaveBeenCalled();
  });

  it("clears the search on Escape, and closes the dialog on Escape only when the search is empty", async () => {
    const { closed } = await open();
    typeSearch("növ");
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(search()).toHaveValue("");
    expect(closed).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole("radio", { name: "Sentetik Köməkçi" })).toBeTruthy();
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("finds «Həkim» when «hekim» is typed", async () => {
    await open({ candidates: [{ user_id: ASC, full_name: "Sentetik Həkim" }, CANDIDATES[1]] });
    typeSearch("hekim");
    expect(within(dialog()).getByRole("radio", { name: "Sentetik Həkim" })).toBeTruthy();
    expect(within(dialog()).queryByRole("radio", { name: "Sentetik Növbətçi" })).toBeNull();
  });

  it("names only the new attending when nobody is the attending now", async () => {
    await open({ attending: null });
    pick("Sentetik Köməkçi");
    pick("Məsul həkim");
    expect(within(dialog()).getByText("Sentetik Köməkçi məsul həkim olur.")).toBeTruthy();
    expect(within(dialog()).queryByText(/komandadan çıxır/)).toBeNull();
  });

  it("ties the sentence about who leaves to the button that answers it", async () => {
    await open();
    pick("Sentetik Köməkçi");
    const button = within(dialog()).getByRole("button", { name: "Əlavə et" });
    expect(button).not.toHaveAttribute("aria-describedby");
    pick("Məsul həkim");
    const note = document.getElementById(button.getAttribute("aria-describedby"));
    expect(note.textContent).toContain("Sentetik Köməkçi məsul həkim olur; Sentetik Həkim komandadan çıxır.");
    pick("Köməkçi həkim");
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("says a missing start, marks that field alone and moves the focus to it", async () => {
    await open();
    pick("Sentetik Növbətçi");
    pick("Növbətçi həkim");
    setWindow(START_LABEL, null);
    setWindow(END_LABEL, Date.now() + 12 * HOUR);
    await submit();
    expect(within(dialog()).getByText("Başlanğıcı seçin.")).toBeTruthy();
    const start = within(dialog()).getByLabelText(START_LABEL);
    expect(start).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog()).getByLabelText(END_LABEL)).not.toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(start);
  });

  it("marks a bad end, and moves the focus to it", async () => {
    await open();
    pick("Sentetik Növbətçi");
    pick("Növbətçi həkim");
    await submit();
    const end = within(dialog()).getByLabelText(END_LABEL);
    expect(end).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog()).getByLabelText(START_LABEL)).not.toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(end);
  });

  it("moves the focus to the first physician when none is picked, and to the search when none is listed", async () => {
    await open();
    await submit();
    expect(document.activeElement).toBe(within(dialog()).getByRole("radio", { name: "Sentetik Köməkçi" }));
    typeSearch("xyz");
    await submit();
    expect(document.activeElement).toBe(search());
  });

  it("checks the window at the moment of the press, not at the last draw", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now");
    try {
      const { api } = await open({ setup: (a) => a.addCareTeamMember.mockResolvedValue({}) });
      pick("Sentetik Növbətçi");
      pick("Növbətçi həkim");
      setWindow(START_LABEL, now);
      setWindow(END_LABEL, now + 5 * 60_000);       // still ahead at the last draw
      clock.mockReturnValue(now + 10 * 60_000);     // …and behind by the time she presses
      await submit();
      expect(within(dialog()).getByText("Son gələcəkdə olmalıdır.")).toBeTruthy();
      expect(api.addCareTeamMember).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it("sends no window when the role is changed back from on-call, whatever was typed in it", async () => {
    const { api } = await open({ setup: (a) => a.addCareTeamMember.mockResolvedValue({}) });
    pick("Sentetik Köməkçi");
    pick("Növbətçi həkim");
    setWindow(START_LABEL, Date.now());
    setWindow(END_LABEL, Date.now() - 5 * HOUR);   // a bad end: it must not hold an associate back
    pick("Köməkçi həkim");
    expect(within(dialog()).queryByLabelText(END_LABEL)).toBeNull();
    await submit();
    await settle();
    expect(api.addCareTeamMember).toHaveBeenCalledTimes(1);
    expect(api.addCareTeamMember.mock.calls[0][1]).toStrictEqual({ user_id: ASC, role: "ASSOCIATE_PHYSICIAN" });
  });

  it("sends once however often it is pressed while the add is in flight", async () => {
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const { api, done } = await open({ setup: (a) => a.addCareTeamMember.mockReturnValue(pending) });
    pick("Sentetik Köməkçi");
    const button = within(dialog()).getByRole("button", { name: "Əlavə et" });
    await act(async () => { fireEvent.click(button); });
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      fireEvent.click(button);
      fireEvent.submit(dialog().querySelector("form"));
    });
    expect(api.addCareTeamMember).toHaveBeenCalledTimes(1);
    await act(async () => { finish({}); });
    await settle();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("says the add landed even when the box's own re-read is slow, and tells the box of no refusal", async () => {
    let release;
    const slow = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const refused = vi.fn();
    await mount(
      <AddMemberDialog admissionId={ADM} subject={SUBJECT} attending={ATTENDING} onClose={() => {}} onDone={slow}
        onRefused={refused} />,
      {
        access: token({ perms: ASSIGN }), me: profile({ perms: ASSIGN }),
        setup: (api) => {
          api.careTeamCandidates.mockResolvedValue(CANDIDATES);
          api.addCareTeamMember.mockResolvedValue({});
        },
      });
    await settle();
    pick("Sentetik Köməkçi");
    await submit();
    await settle();
    // The success is on the toast before the box has finished reading, and the buttons are held until it has.
    expect(toasts().getAllByText(`${SUBJECT} · Sentetik Köməkçi komandaya əlavə edildi.`).length).toBeGreaterThan(0);
    expect(within(dialog()).getByRole("button", { name: "Əlavə et" })).toHaveAttribute("aria-busy", "true");
    await act(async () => { release(); });
    await settle();
    expect(within(dialog()).getByRole("button", { name: "Əlavə et" })).not.toHaveAttribute("aria-busy", "true");
    expect(refused).not.toHaveBeenCalled();
  });

  it("reads the physicians again after a refusal that is not about a field, and not after one that is", async () => {
    const { api, refused } = await open({ setup: (a) => {
      a.careTeamCandidates.mockResolvedValueOnce(CANDIDATES).mockResolvedValue([CANDIDATES[1]]);
      a.addCareTeamMember.mockRejectedValue(refusal(409, "English words", { apiCode: "care_team_conflict" }));
    } });
    pick("Sentetik Köməkçi");
    await submit();
    await settle();
    expect(refused).toHaveBeenCalledTimes(1);
    expect(api.careTeamCandidates).toHaveBeenCalledTimes(2);
    // She is no longer a candidate: her row is gone and nobody is picked.
    expect(within(dialog()).queryByRole("radio", { name: "Sentetik Köməkçi" })).toBeNull();
    expect(within(dialog()).getByRole("radio", { name: "Sentetik Növbətçi" })).not.toBeChecked();

    api.addCareTeamMember.mockRejectedValue(refusal(422, "Unprocessable"));
    pick("Sentetik Növbətçi");
    await submit();
    await settle();
    expect(api.careTeamCandidates).toHaveBeenCalledTimes(2);
  });
});

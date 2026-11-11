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

async function open({ candidates = CANDIDATES, setup } = {}) {
  const done = vi.fn(async () => {});
  const refused = vi.fn();
  const mounted = await mount(
    <AddMemberDialog admissionId={ADM} subject={SUBJECT} attending={ATTENDING} onClose={() => {}} onDone={done}
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
  return { ...mounted, done, refused };
}

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
});

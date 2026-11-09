// The reserve and out-of-service dialog (G2-B3a, spec §3, D4, X3): a note for whom and why,
// trimmed and at most 200 characters; out of service needs a reason, and «Digər» a note too.
// The server checks again; a refusal goes on the toast, named after the bed.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { BED, CHARGE, mountKabul, settle, structure, toasts } from "../kabul/kabul.testutil.js";
import { BedStateDialog } from "./BedStateDialog.jsx";

const SUBJECT = "1 · Otaq 1 · Reanimasiya";
const bed = () => structure().sites[0].units[0].rooms[0].beds[0];
const PERMS = [...CHARGE, "beds.manage_state"];
const dialog = () => screen.getByRole("dialog");
const submit = (name) => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name })); });

async function open(mode, setup) {
  const done = vi.fn(async () => {});
  const refused = vi.fn();
  const mounted = await mountKabul(
    <BedStateDialog mode={mode} bed={bed()} subject={SUBJECT} onClose={() => {}} onDone={done} onRefused={refused} />,
    { perms: PERMS, setup });
  return { ...mounted, done, refused };
}

describe("BedStateDialog", () => {
  it("reserves with the trimmed note, says so, and hands back", async () => {
    const { api, done } = await open("reserve", (a) => a.reserveBed.mockResolvedValue({ state: "RESERVED" }));
    expect(dialog().getAttribute("aria-label") ?? screen.getByRole("heading", { name: `Rezerv et · ${SUBJECT}` })).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText(/^Qeyd/), { target: { value: "  Sentetik planlı kabul  " } });
    await submit("Rezerv et");
    await settle();
    expect(api.reserveBed).toHaveBeenCalledWith(BED(1), { note: "Sentetik planlı kabul" });
    // A toast is in the DOM twice (the sr-only live region and the visible one), as in the admin tests.
    expect(toasts().getAllByText(`${SUBJECT} · Rezerv edildi.`).length).toBeGreaterThan(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("sends no note as null, and holds a note to 200 characters", async () => {
    const { api } = await open("reserve", (a) => a.reserveBed.mockResolvedValue({}));
    expect(within(dialog()).getByLabelText(/^Qeyd/).getAttribute("maxlength")).toBe("200");
    await submit("Rezerv et");
    await settle();
    expect(api.reserveBed).toHaveBeenCalledWith(BED(1), { note: null });
  });

  it("asks for a reason, and a note for «Digər», before it sends anything", async () => {
    const { api } = await open("outOfService", (a) => a.bedOutOfService.mockResolvedValue({}));
    await submit("İstifadədən çıxar");
    expect(within(dialog()).getByText("Səbəb seçin.")).toBeTruthy();
    fireEvent.click(within(dialog()).getByLabelText("Digər"));
    await submit("İstifadədən çıxar");
    expect(within(dialog()).getByText("«Digər» üçün qeyd yazın.")).toBeTruthy();
    expect(api.bedOutOfService).not.toHaveBeenCalled();
    fireEvent.change(within(dialog()).getByLabelText(/^Qeyd/), { target: { value: "Sentetik arıza" } });
    await submit("İstifadədən çıxar");
    await settle();
    expect(api.bedOutOfService).toHaveBeenCalledWith(BED(1), { reason: "OTHER", note: "Sentetik arıza" });
  });

  it("takes a bed out of service with a reason alone", async () => {
    const { api } = await open("outOfService", (a) => a.bedOutOfService.mockResolvedValue({}));
    fireEvent.click(within(dialog()).getByLabelText("Nasazlıq"));
    await submit("İstifadədən çıxar");
    await settle();
    expect(api.bedOutOfService).toHaveBeenCalledWith(BED(1), { reason: "FAULT", note: null });
  });

  it("says a refusal on the toast, named after the bed, and tells the screen", async () => {
    const { refused, done } = await open("reserve", (a) => a.reserveBed.mockRejectedValue(
      refusal(409, "Only a free bed can be reserved (it is OCCUPIED).", { apiCode: "invalid_transition" })));
    await submit("Rezerv et");
    await settle();
    expect(toasts().getByText(new RegExp(`^${SUBJECT}: `))).toBeTruthy();
    expect(refused).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
  });
});

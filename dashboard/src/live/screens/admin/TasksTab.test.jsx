// src/live/screens/admin/TasksTab.test.jsx — Yönetim › Görevler (G3-02 D10)
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { ADMIN, settle, toasts } from "../kabul/kabul.testutil.js";
import { TasksTab } from "./TasksTab.jsx";

const UNSET = { configured: false, shift_start_a: 8, shift_start_b: 20, grace_min: 30,
  intervals: { b0: 720, b1_4: null, b3_single: null, b5_6: null, b7: null }, updated_at: null, updated_by: null, default_source: { b0: "news2-rcp-2017" } };

async function mounted(setup) {
  const m = await mount(<TasksTab />, { access: token({ perms: ADMIN }), me: profile({ perms: ADMIN }), setup });
  await settle();
  return m;
}
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); }); await settle(); };
// The toasts on screen: the region also reads each one out in a hidden live region (ui/Toast.jsx), so only
// the copies inside a toast (`data-toast`) are counted.
const shown = (text) => toasts().getAllByText(text).filter((el) => el.closest("[data-toast]"));

describe("TasksTab", () => {
  it("shows the defaults, names the one sourced band and says the others are the hospital's", async () => {
    await mounted((a) => a.taskSettings.mockResolvedValue(UNSET));
    expect(screen.getByLabelText(/^NEWS2 0 balı/).value).toBe("720");
    expect(screen.getByLabelText(/^NEWS2 1–4 bal/).value).toBe("");
    expect(screen.getByText(/RCP 2017/)).toBeInTheDocument();
    expect(screen.getByText("Yalnız «NEWS2 0» zolağının intervalı təyin edilib; digər zolaqlardakı xəstələr üçün vital tapşırığı düşmür.")).toBeInTheDocument();
  });
  it("saves whole bodies and toasts", async () => {
    const m = await mounted((a) => { a.taskSettings.mockResolvedValue(UNSET); a.saveTaskSettings.mockResolvedValue({ ...UNSET, configured: true, grace_min: 45, intervals: { ...UNSET.intervals, b1_4: 360 }, updated_by: "admin", updated_at: "2026-11-09T10:00:00Z" }); });
    fireEvent.change(screen.getByLabelText(/^Gecikmə payı/), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText(/^NEWS2 1–4 bal/), { target: { value: "360" } });
    await save();
    expect(m.api.saveTaskSettings).toHaveBeenCalledWith({ shift_start_a: 8, shift_start_b: 20, grace_min: 45, intervals: { b0: 720, b1_4: 360, b3_single: null, b5_6: null, b7: null } });
    expect(shown("Tapşırıq ayarları yadda saxlanıldı.")).toHaveLength(1);
  });
  it("refuses out-of-range values before sending, and names the server's refusal", async () => {
    const m = await mounted((a) => { a.taskSettings.mockResolvedValue(UNSET); a.saveTaskSettings.mockRejectedValue(refusal(422, "Intervals are 5–1440 minutes, the grace 0–240 minutes, shift hours 0–23 and different.", { apiCode: "task_settings_range" })); });
    fireEvent.change(screen.getByLabelText(/^Gecikmə payı/), { target: { value: "500" } });
    await save();
    expect(m.api.saveTaskSettings).not.toHaveBeenCalled();
    expect(screen.getByText("Dəyərləri yoxlayın: interval 5–1440, pay 0–240, saatlar 0–23 və fərqli.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Gecikmə payı/), { target: { value: "40" } });
    await save();
    expect(shown(/İntervallar 5–1440 dəq/)).toHaveLength(1);
  });
});

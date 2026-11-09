// HeatBox.test.jsx — «Siqnal sıxlığı» (G2-B6): loaded on its button only (D4), masked patients by local hour with a
// total (D3, D5), the relative legend, the truncated / empty / unreadable / refused states (D6). Synthetic ids.
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { localHour } from "./heat.js";
import { HeatBox } from "./HeatBox.jsx";

const AUDITOR = ["board.view", "audit.view"];
const H10 = "2026-11-09T10:00:00+00:00";
const H11 = "2026-11-09T11:00:00+00:00";
const REPORT = { episodes: 4, truncated: false, days: 7, per_patient_hour: [
  { patient_id: "260109004821", hour: H10, episodes: 3 },
  { patient_id: "260109007777", hour: H11, episodes: 1 },
] };

const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
async function open(setup) {
  const mounted = await mount(<HeatBox />, {
    access: token({ perms: AUDITOR }), me: profile({ perms: AUDITOR }), setup,
  });
  await settle();
  return mounted;
}
const show = async () => { fireEvent.click(screen.getByRole("button", { name: "Xəritəni göstər" })); await settle(); };
// The mount harness's ToastProvider keeps an always-mounted, empty sr-only role="alert" live region: the page's own
// alerts are the others (the same helper as DenetimScreen.test.jsx).
const pageAlerts = () => screen.queryAllByRole("alert").filter((el) => !el.classList.contains("sr-only"));
const theAlert = () => {
  const found = pageAlerts();
  expect(found).toHaveLength(1);
  return found[0];
};

afterEach(() => { cleanup(); });

describe("the alarm heatmap box", () => {
  it("loads nothing on its own; the button asks for seven days", async () => {
    const { api } = await open((a) => a.alarmQuality.mockResolvedValue(REPORT));
    expect(api.alarmQuality).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
    await show();
    expect(api.alarmQuality).toHaveBeenCalledWith(7);
    expect(screen.getByText(/^Saat \d\d:\d\d vəziyyətinə$/)).toBeInTheDocument();
  });

  it("shows masked patients, highest total first, each count in its local hour, the total and the relative legend", async () => {
    await open((a) => a.alarmQuality.mockResolvedValue(REPORT));
    await show();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("••••4821");
    expect(rows[1]).toHaveTextContent("••••7777");
    const first = rows[0].querySelectorAll("td");
    expect(first).toHaveLength(25);
    expect(first[localHour(H10)].textContent).toBe("3");
    expect(first[localHour(H10)].getAttribute("data-step")).toBe("3");
    expect(first[24].textContent).toBe("3");
    expect(rows[1].querySelectorAll("td")[localHour(H11)].getAttribute("data-step")).toBe("1");
    expect(screen.getByText("Rəng tonu yalnız bu cədvəldəki ən böyük saya görədir; klinik hədd deyil.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("260109004821");
  });

  it("says a truncated window is incomplete", async () => {
    await open((a) => a.alarmQuality.mockResolvedValue({ ...REPORT, truncated: true }));
    await show();
    expect(screen.getByText(/rəqəmlər natamamdır/)).toBeInTheDocument();
  });

  it("says when the window had no alarms, and when the report cannot be read", async () => {
    const { api } = await open((a) => a.alarmQuality
      .mockResolvedValueOnce({ episodes: 0, truncated: false, per_patient_hour: [] })
      .mockResolvedValueOnce(undefined));
    await show();
    expect(screen.getByText("Son 7 gündə siqnal olmayıb.")).toBeInTheDocument();
    await show();
    expect(api.alarmQuality).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Hesabat oxunmadı.")).toBeInTheDocument();
    expect(screen.queryByText("Son 7 gündə siqnal olmayıb.")).toBeNull();
  });

  it("names the cap when more than 30 patients had alarms", async () => {
    const cells = Array.from({ length: 31 }, (_, i) => ({ patient_id: `SYN-${String(i).padStart(4, "0")}`, hour: H10, episodes: 1 }));
    await open((a) => a.alarmQuality.mockResolvedValue({ episodes: 31, truncated: false, per_patient_hour: cells }));
    await show();
    expect(screen.getByText("Ən çox siqnallı 30 xəstə göstərilir (31 xəstədən).")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(31);   // header + 30
  });

  it("tells a unit-scoped account the whole report is outside its scope", async () => {
    await open((a) => a.alarmQuality.mockRejectedValue(refusal(403, "alarm kalitesi raporunun tamamı kapsam dışı")));
    await show();
    expect(theAlert()).toHaveTextContent("Siqnal keyfiyyəti hesabatının hamısı əhatənizdən kənardır.");
  });
});

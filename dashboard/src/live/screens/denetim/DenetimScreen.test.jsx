// DenetimScreen.test.jsx — «Audit bütövlüyü» (G2-B4): the verification on its button only (owner D1), the newest
// events with the patient id masked (owner D2), the filter asking the server (D7), the scoped refusal (D8). Synthetic.
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { ddmmhhmm } from "../../i18n/dates.js";
import { DenetimScreen } from "./DenetimScreen.jsx";

const AUDITOR = ["board.view", "audit.view"];
const SYNTHETIC_ID = "260109004821";
const rec = (id, over = {}) => ({
  id, ts: `2026-11-09T10:0${id}:00+00:00`, tenant: "demo-hastanesi", event_type: "ack", patient_id: SYNTHETIC_ID,
  subject: "news2_high", payload: { actor: "ayse" }, prev_hash: "", hash: "", ...over,
});
const ROWS = [
  rec(1, { event_type: "chart", payload: { charted_by: "dr.kerimov" } }),
  rec(2),
  rec(3, { event_type: "structure.create", patient_id: "", subject: "", payload: { actor: "admin" } }),
];
const INTACT = { ok: true, checked: 3, unsealed: 0, broken_at: null, reason: "", records: 3, complete: true };

const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
async function open(setup) {
  const mounted = await mount(<DenetimScreen />, {
    access: token({ perms: AUDITOR }), me: profile({ perms: AUDITOR }),
    setup: (api) => { api.audit.mockResolvedValue({ records: ROWS }); setup?.(api); },
  });
  await settle();
  return mounted;
}
const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
const press = async (name) => { fireEvent.click(screen.getByRole("button", { name })); await settle(); };
// The toast host keeps an empty sr-only role="alert" live region mounted (ui/Toast.jsx), so the page's own alerts are
// the visible ones: exactly one when something is wrong, none otherwise.
const pageAlerts = () => screen.queryAllByRole("alert").filter((el) => !el.classList.contains("sr-only"));
const theAlert = () => {
  const found = pageAlerts();
  expect(found).toHaveLength(1);
  return found[0];
};

afterEach(() => { cleanup(); });

describe("the audit page's events", () => {
  it("has one h1, shows the newest events first, masked, with who and the type's label — and verifies nothing on its own", async () => {
    const { api } = await open();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Audit bütövlüyü"]);
    expect(api.audit).toHaveBeenCalledWith({ limit: 200, eventType: null });
    expect(api.verifyAudit).not.toHaveBeenCalled();
    const [first, second, third] = bodyRows();
    expect(first).toHaveTextContent("#3");
    expect(first).toHaveTextContent("structure.create");               // no label: the code itself
    expect(second).toHaveTextContent("Siqnalın təsdiqi");
    expect(second).toHaveTextContent("ayse");
    expect(second).toHaveTextContent("••••4821");
    expect(second).toHaveTextContent(ddmmhhmm(Date.parse(ROWS[1].ts)));
    expect(third).toHaveTextContent("Qeyd daxil edilməsi");
    expect(third).toHaveTextContent("dr.kerimov");
    expect(document.body).not.toHaveTextContent(SYNTHETIC_ID);
  });

  it("asks the server for the chosen type, and reads again on «Yenilə»", async () => {
    const { api } = await open();
    fireEvent.change(screen.getByLabelText("Növ"), { target: { value: "admission.admit" } });
    await settle();
    expect(api.audit).toHaveBeenLastCalledWith({ limit: 200, eventType: "admission.admit" });
    const calls = api.audit.mock.calls.length;
    await press("Yenilə");
    expect(api.audit).toHaveBeenCalledTimes(calls + 1);
    expect(api.audit).toHaveBeenLastCalledWith({ limit: 200, eventType: "admission.admit" });
  });

  it("an empty answer and an unset one both read as no records", async () => {
    await open((api) => api.audit.mockResolvedValue(undefined));
    expect(screen.getByText("Bu filtrlə qeyd yoxdur.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("tells a unit-scoped auditor the whole trail is outside their scope, retries, and still lets them verify", async () => {
    const { api } = await open((a) => {
      a.audit.mockRejectedValue(refusal(403, "denetim kaydının tamamı kapsam dışı; bir patient_id verin"));
      a.verifyAudit.mockResolvedValue(INTACT);
    });
    expect(theAlert()).toHaveTextContent("Audit jurnalının hamısı əhatənizdən kənardır");
    await press("Yenidən cəhd et");
    expect(api.audit).toHaveBeenCalledTimes(2);
    await press("Zənciri yoxla");
    expect(api.verifyAudit).toHaveBeenCalledWith(50000);
    expect(screen.getByText("Zəncir bütövdür — 3 qeyd yoxlanıldı.")).toBeInTheDocument();
  });
});

describe("the chain's verification (owner D1, D4)", () => {
  it("says a broken chain loudly, names the first broken record and the reason in the page's own words, with the time", async () => {
    await open((a) => a.verifyAudit.mockResolvedValue({
      ...INTACT, ok: false, broken_at: 77, reason: "kaydın içeriği mührüyle uyuşmuyor — sonradan değiştirilmiş",
    }));
    await press("Zənciri yoxla");
    const alert = theAlert();
    expect(alert).toHaveTextContent("Zəncir qırılıb — ilk qırıq halqa: qeyd #77.");
    expect(alert).toHaveTextContent("Qeydin məzmunu möhürü ilə uyğun gəlmir");
    expect(alert).not.toHaveTextContent("mührüyle");                    // the server's own words are not shown
    expect(screen.getByText(/^Son yoxlama \d\d:\d\d$/)).toBeInTheDocument();
  });

  it.each([
    [{ ...INTACT, records: 50000, checked: 50000, complete: false }, "İlk 50000 qeyddə zəncir bütövdür"],
    [{ ...INTACT, records: 0, checked: 0 }, "Audit jurnalında hələ qeyd yoxdur."],
    [{ ...INTACT, unsealed: 2 }, "2 qeyd möhürdən əvvəl yazılıb"],
    [undefined, "Yoxlama cavabı oxunmadı."],
  ])("reads %j as its own verdict", async (answer, text) => {
    await open((a) => a.verifyAudit.mockResolvedValue(answer));
    await press("Zənciri yoxla");
    expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    expect(pageAlerts()).toHaveLength(0);
  });

  it("says why a verification failed, and the button tries again", async () => {
    const { api } = await open((a) => a.verifyAudit.mockRejectedValueOnce(refusal(503, "x")).mockResolvedValueOnce(INTACT));
    await press("Zənciri yoxla");
    expect(theAlert()).toHaveTextContent("Yoxlama aparılmadı:");
    expect(screen.queryByText(/^Son yoxlama/)).toBeNull();
    await press("Zənciri yoxla");
    expect(api.verifyAudit).toHaveBeenCalledTimes(2);
    expect(pageAlerts()).toHaveLength(0);
    expect(screen.getByText("Zəncir bütövdür — 3 qeyd yoxlanıldı.")).toBeInTheDocument();
  });
});

// DenetimScreen.test.jsx — «Audit bütövlüyü» (G2-B4): the verification on its button only (owner D1), the newest
// events with the patient id masked (owner D2), the filter asking the server (D7), the scoped refusal (D8). Synthetic.
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { ddmmhhmm } from "../../i18n/dates.js";
import { ANNOUNCE_DELAY_MS } from "../../ui/index.js";
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
    expect(api.alarmQuality).not.toHaveBeenCalled();                  // G2-B6 D4: the heatmap waits for its button
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

  it("labels «view» as a patient opened (not an alarm seen) and «bed.release» as a bed ready after cleaning (not emptied)", async () => {
    await open((a) => a.audit.mockResolvedValue({ records: [
      rec(1, { event_type: "view", subject: "", payload: { actor: "ayse" } }),
      rec(2, { event_type: "bed.release", patient_id: "", subject: "BED05", payload: { actor: "admin" } }),
    ] }));
    const [bedRow, viewRow] = bodyRows();                              // newest first
    expect(viewRow).toHaveTextContent("Xəstə açıldı");
    expect(bedRow).toHaveTextContent("Çarpayı hazırdır (təmizlik bitdi)");
    expect(document.body).not.toHaveTextContent("Siqnal görüldü");
    expect(document.body).not.toHaveTextContent("Çarpayı boşaldıldı");
  });

  // G2-B3a (final review M-7): Doluluk's four bed moves are named in the reader's words, never as
  // their codes, and each can be chosen in the filter.
  it("labels Doluluk's four bed moves, and offers each in the filter", async () => {
    const MOVES = [
      ["bed.reserve", "Çarpayı rezerv edildi"],
      ["bed.unreserve", "Çarpayının rezervi ləğv edildi"],
      ["bed.out_of_service", "Çarpayı istifadədən çıxarıldı"],
      ["bed.return_to_service", "Çarpayı istifadəyə verildi"],
    ];
    await open((a) => a.audit.mockResolvedValue({ records: MOVES.map(([code], at) => rec(at + 1, {
      event_type: code, patient_id: "", subject: "", payload: { actor: "charge", reason: null, note: true } })) }));
    const rows = bodyRows().reverse();                                 // newest first: back to the moves' order
    MOVES.forEach(([code, label], at) => {
      expect(rows[at], code).toHaveTextContent(label);
      expect(rows[at], code).not.toHaveTextContent(code);
    });
    const offered = within(screen.getByLabelText("Növ")).getAllByRole("option");
    for (const [code, label] of MOVES) {
      expect(offered.find((o) => o.value === code)?.textContent, code).toBe(label);
    }
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

  it("drops an older read that answers last: a filter changed twice shows only the newest filter's rows", async () => {
    let releaseAck;
    const { api } = await open((a) => a.audit
      .mockResolvedValueOnce({ records: ROWS })                                              // the mount read
      .mockImplementationOnce(() => new Promise((resolve) => { releaseAck = () => resolve({ records: [rec(9)] }); }))   // «ack», held
      .mockResolvedValueOnce({ records: [rec(8, { event_type: "chart", payload: { charted_by: "dr.kerimov" } })] }));   // «chart»
    fireEvent.change(screen.getByLabelText("Növ"), { target: { value: "ack" } });
    await settle();
    fireEvent.change(screen.getByLabelText("Növ"), { target: { value: "chart" } });
    await settle();
    expect(api.audit).toHaveBeenLastCalledWith({ limit: 200, eventType: "chart" });
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("#8");
    await act(async () => { releaseAck(); });                                              // the older answer arrives last
    await settle();
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("#8");
    expect(bodyRows()[0]).toHaveTextContent("dr.kerimov");
    expect(document.body).not.toHaveTextContent("#9");
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
    expect(api.verifyAudit).toHaveBeenCalledWith();                    // G2 borç 3: the whole chain, no limit
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
    // the day and month ride with the time: a screen left open overnight must not show «last night's» run as today's
    expect(screen.getByText(/^Son yoxlama \d\d\.\d\d \d\d:\d\d$/)).toBeInTheDocument();
  });

  // A verification that completed is dated; an answer nobody could read is not a verification at all.
  it.each([
    [{ ...INTACT, records: 50000, checked: 50000, complete: false }, "İlk 50000 qeyddə zəncir bütövdür", true],
    [{ ...INTACT, records: 0, checked: 0 }, "Audit jurnalında hələ qeyd yoxdur.", true],
    [{ ...INTACT, unsealed: 2 }, "2 qeyd möhürdən əvvəl yazılıb", true],
    [undefined, "Yoxlama cavabı oxunmadı.", false],
  ])("reads %j as its own verdict", async (answer, text, dated) => {
    await open((a) => a.verifyAudit.mockResolvedValue(answer));
    await press("Zənciri yoxla");
    expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    expect(pageAlerts()).toHaveLength(0);
    if (dated) expect(screen.getByText(/^Son yoxlama /)).toBeInTheDocument();
    else expect(screen.queryByText(/^Son yoxlama/)).toBeNull();
  });

  it("never leaves the previous verdict beside a new run: it goes the moment the next run starts", async () => {
    let release;
    await open((a) => a.verifyAudit
      .mockResolvedValueOnce(INTACT)
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ...INTACT, records: 4, checked: 4 }); })));
    await press("Zənciri yoxla");
    expect(screen.getByText("Zəncir bütövdür — 3 qeyd yoxlanıldı.")).toBeInTheDocument();
    expect(screen.getByText(/^Son yoxlama /)).toBeInTheDocument();
    await press("Zənciri yoxla");                                     // held: the second run is under way
    expect(screen.queryByText(/Zəncir bütövdür/)).toBeNull();
    expect(screen.queryByText(/^Son yoxlama/)).toBeNull();
    await act(async () => { release(); });
    await settle();
    expect(screen.getByText("Zəncir bütövdür — 4 qeyd yoxlanıldı.")).toBeInTheDocument();
    expect(screen.getByText(/^Son yoxlama /)).toBeInTheDocument();
  });

  it("says the verdict to a screen reader in a polite status region, and says a repeated verdict again", async () => {
    let release;
    await open((a) => a.verifyAudit
      .mockResolvedValueOnce(INTACT)
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(INTACT); })));
    const said = () => screen.getAllByRole("status").some((el) => el.textContent === "Zəncir bütövdür — 3 qeyd yoxlanıldı.");
    const wait = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, ANNOUNCE_DELAY_MS + 20); }); });
    await press("Zənciri yoxla");
    expect(said()).toBe(false);                                       // not at once: a region filled with its mount is not spoken
    await wait();
    expect(said()).toBe(true);
    await press("Zənciri yoxla");                                     // the same verdict again: the region empties first ...
    await wait();
    expect(said()).toBe(false);
    await act(async () => { release(); });
    await settle();
    await wait();
    expect(said()).toBe(true);                                        // ... so the identical sentence is a change, and is said again
  });

  it("says the unsealed sentence with an intact verdict, and a broken one only through its alert", async () => {
    await open((a) => a.verifyAudit.mockResolvedValueOnce({ ...INTACT, unsealed: 2 }).mockResolvedValueOnce({ ...INTACT, ok: false, broken_at: 5, unsealed: 2 }));
    const statuses = () => screen.getAllByRole("status").map((el) => el.textContent);
    await press("Zənciri yoxla");
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, ANNOUNCE_DELAY_MS + 20); }); });
    expect(statuses()).toContain("Zəncir bütövdür — 3 qeyd yoxlanıldı. 2 qeyd möhürdən əvvəl yazılıb; yoxlanıla bilməz, qırıq sayılmır.");
    await press("Zənciri yoxla");
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, ANNOUNCE_DELAY_MS + 20); }); });
    expect(theAlert()).toHaveTextContent("Zəncir qırılıb");
    expect(statuses().filter(Boolean)).toEqual([]);                   // nothing else speaks for a broken verdict
  });

  // G2 borç 3: one whole-chain verification per hospital at a time; another person's press while one runs is
  // refused (409) in a fixed sentence, said here in the page's language.
  it("says, in the reader's language, that a verification is already running", async () => {
    await open((a) => a.verifyAudit.mockRejectedValueOnce(refusal(409, "denetim doğrulaması zaten sürüyor")));
    await press("Zənciri yoxla");
    expect(theAlert()).toHaveTextContent("Yoxlama aparılmadı: Bu xəstəxana üçün audit yoxlaması artıq gedir");
    expect(theAlert()).not.toHaveTextContent("zaten sürüyor");
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

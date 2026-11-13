// src/live/screens/admin/TresDeliveries.test.jsx — Yönetim › TRƏS › «Gönderimler» (TRƏS-01 · F1, spec §6, D9, D21, D25;
// plan F1, N12, N15): the ledger in the catalogue's words and never the platform's; a parked feed said at the top; the
// filters and «Daha çox» read again; a stay found by its protocol number and sent now; a refusal by its code;
// «Yenidən cəhd et» only on a refused or stuck row; the preview's dialog. Synthetic stays only.
//
// The review of 2026-11-13 added: a hand's result told by its rows' statuses (never «sent» for a failed row), the
// environment the list is of, the wait a throttled hand names, a list that is never overwritten by a late answer, a
// failed read that can be read again, one action at a time with the others visibly off, and the row buttons'
// names. The zone is pinned: a literal time on the found line holds in any zone.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { settle, toasts } from "../kabul/kabul.testutil.js";
import { pinZone } from "../devices/zone.testutil.js";
import { TresDeliveries } from "./TresDeliveries.jsx";

pinZone();

const PERMS = ["tres.manage"];
const STAY = "66666666-6666-4666-8666-666666666601";
const row = (id, over = {}) => ({ id, resource_type: "patient", local_id: `hmn-p-${id}.`, status: "sent", reason: null,
  attempts: 0, operation: "create", remote_id: "7001", next_attempt_at: null, updated_at: "2026-11-11T08:00:00Z",
  admission_id: STAY, board_key: "202600000101", ...over });
const PAGE = { environment: "test", session_refused_at: null, next: null, items: [
  row("r1"), row("r2", { resource_type: "encounter", status: "skipped", reason: "unit_unmapped" }),
  row("r3", { resource_type: "vital", status: "stuck", attempts: 5, remote_id: null })] };
const FOUND = { admission_id: STAY, board_key: "202600000101", state: "ACTIVE", discharge_at: null };
const handRow = (status, type = "patient", n = 1) => ({ resource_type: type, local_id: `hmn-${type[0]}-${n}.`, status, reason: null });
const hand = (...rows) => ({ admission_id: STAY, counts: {}, rows });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
};

async function mounted(setup, node = <TresDeliveries />) {
  const m = await mount(node, { access: token({ perms: PERMS }), me: profile({ perms: PERMS }), setup });
  await settle();
  return m;
}
const click = async (el) => {
  await act(async () => { fireEvent.click(el); });
  await settle();
};
const shown = (text) => toasts().getAllByText(text).filter((el) => el.closest("[data-toast]"));
const toneOf = (el) => el.closest("[data-toast]").dataset.tone;
const table = () => within(screen.getByRole("table"));
const finder = () => screen.getByLabelText(/^Protokol nömrəsi/);
const find = async (key = "202600000101") => {
  fireEvent.change(finder(), { target: { value: key } });
  await click(screen.getByRole("button", { name: "Yatışı tap" }));
};
/** A stay found and its package sent; the toast's words and tone are what the cases read. */
async function sendAnswering(answer) {
  const { api } = await mounted((a) => {
    a.tresDeliveries.mockResolvedValue(PAGE);
    a.tresStay.mockResolvedValue(FOUND);
    a.sendTresStay.mockResolvedValue(answer);
  });
  await find();
  await click(screen.getByRole("button", { name: "İndi göndər" }));
  return api;
}

describe("TresDeliveries — the list", () => {
  it("says each row in the catalogue's words, the stay's number, and no platform words", async () => {
    const { api } = await mounted((a) => a.tresDeliveries.mockResolvedValue(PAGE));
    expect(api.tresDeliveries).toHaveBeenCalledWith({ status: null, type: null, cursor: null });
    expect(table().getAllByText("202600000101")).toHaveLength(3);
    expect(table().getByText("Bölmə şöbəyə uyğunlaşdırılmayıb")).toBeInTheDocument();
    expect(table().getByText("İlişib qaldı")).toBeInTheDocument();
    expect(table().getAllByText("Göndərildi")).toHaveLength(1);
    expect(screen.queryByText(/Platforma bu xəstəxananın girişini rədd etdi/)).toBeNull();
  });

  it("says a skipped row «Göndərilmədi» and a failed one «Uğursuz» — never a word that reads as delivered", async () => {
    await mounted((a) => a.tresDeliveries.mockResolvedValue({ ...PAGE, items: [
      row("r2", { status: "skipped", reason: "patient_unheld" }), row("r4", { status: "failed" })] }));
    expect(table().getByText("Göndərilmədi")).toBeInTheDocument();
    expect(table().getByText("Uğursuz")).toBeInTheDocument();
    expect(table().getByText("Xəstə qeydi platformada yoxdur: yatış qeydi də göndərilmədi")).toBeInTheDocument();
  });

  it("says which environment the list is of — the subtitle's line — and follows the answer", async () => {
    await mounted((a) => a.tresDeliveries.mockResolvedValueOnce(PAGE)
      .mockResolvedValue({ ...PAGE, environment: "live" }));
    expect(screen.getByText("Mühit: Sınaq mühiti (sandbox)")).toBeInTheDocument();
    await act(async () => { fireEvent.change(screen.getByLabelText(/^Vəziyyət/), { target: { value: "stuck" } }); });
    await settle();
    expect(screen.getByText("Mühit: Canlı mühit")).toBeInTheDocument();
    expect(screen.queryByText("Mühit: Sınaq mühiti (sandbox)")).toBeNull();
  });

  it("says nothing of an environment the answer does not name", async () => {
    await mounted((a) => a.tresDeliveries.mockResolvedValue({ ...PAGE, environment: undefined }));
    expect(screen.queryByText(/^Mühit: /)).toBeNull();
  });

  it("says a parked feed at the top (N15)", async () => {
    await mounted((a) => a.tresDeliveries.mockResolvedValue({ ...PAGE, session_refused_at: "2026-11-11T07:00:00Z" }));
    expect(screen.getByText(/^Platforma bu xəstəxananın girişini rədd etdi/)).toBeInTheDocument();
  });

  it("reads again on a filter, and reads the next page by its cursor", async () => {
    const { api } = await mounted((a) => a.tresDeliveries
      .mockResolvedValueOnce({ ...PAGE, next: "c-2" })
      .mockResolvedValueOnce({ ...PAGE, next: null, items: [row("r4")] })
      .mockResolvedValue({ ...PAGE, items: [row("r3", { status: "stuck" })] }));
    await click(screen.getByRole("button", { name: "Daha çox" }));
    expect(api.tresDeliveries).toHaveBeenLastCalledWith({ status: null, type: null, cursor: "c-2" });
    expect(table().getAllByRole("row")).toHaveLength(5);                       // the header and four rows
    expect(screen.queryByRole("button", { name: "Daha çox" })).toBeNull();
    await act(async () => { fireEvent.change(screen.getByLabelText(/^Vəziyyət/), { target: { value: "stuck" } }); });
    await settle();
    expect(api.tresDeliveries).toHaveBeenLastCalledWith({ status: "stuck", type: null, cursor: null });
  });

  it("sends the record type's filter, alone and with the status", async () => {
    const { api } = await mounted((a) => a.tresDeliveries.mockResolvedValue(PAGE));
    await act(async () => { fireEvent.change(screen.getByLabelText(/^Qeyd növü/), { target: { value: "lab" } }); });
    await settle();
    expect(api.tresDeliveries).toHaveBeenLastCalledWith({ status: null, type: "lab", cursor: null });
    await act(async () => { fireEvent.change(screen.getByLabelText(/^Vəziyyət/), { target: { value: "failed" } }); });
    await settle();
    expect(api.tresDeliveries).toHaveBeenLastCalledWith({ status: "failed", type: "lab", cursor: null });
  });

  it("says when the ledger could not be read, and reads it again on «Yenidən cəhd et»", async () => {
    const { api } = await mounted((a) => a.tresDeliveries.mockRejectedValueOnce(refusal(503, "down")).mockResolvedValue(PAGE));
    expect(screen.getByText(/^Göndərişlər oxunmadı: /).closest("[role='alert']")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    await click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    expect(api.tresDeliveries).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/^Göndərişlər oxunmadı: /)).toBeNull();
    expect(table().getAllByRole("row")).toHaveLength(4);
  });

  it("keeps the rows it has when «Daha çox» fails, says why beside the button, and reads the page on a second press", async () => {
    const { api } = await mounted((a) => a.tresDeliveries
      .mockResolvedValueOnce({ ...PAGE, next: "c-2" })
      .mockRejectedValueOnce(refusal(503, "down"))
      .mockResolvedValue({ ...PAGE, next: null, items: [row("r4")] }));
    await click(screen.getByRole("button", { name: "Daha çox" }));
    expect(table().getAllByRole("row")).toHaveLength(4);                       // the header and the three rows it had
    expect(screen.getByText(/^Göndərişlər oxunmadı: /)).toBeInTheDocument();
    const more = screen.getByRole("button", { name: "Daha çox" });
    expect(more.parentElement).toContainElement(screen.getByText(/^Göndərişlər oxunmadı: /));   // beside the button
    await click(more);
    expect(api.tresDeliveries).toHaveBeenLastCalledWith({ status: null, type: null, cursor: "c-2" });
    expect(table().getAllByRole("row")).toHaveLength(5);
    expect(screen.queryByText(/^Göndərişlər oxunmadı: /)).toBeNull();
  });

  it("says a filter's empty result as the filter's, and an empty ledger as the environment's", async () => {
    await mounted((a) => a.tresDeliveries.mockResolvedValueOnce(PAGE).mockResolvedValue({ ...PAGE, items: [] }));
    await act(async () => { fireEvent.change(screen.getByLabelText(/^Vəziyyət/), { target: { value: "deleted" } }); });
    await settle();
    expect(screen.getByText("Süzgəcə uyğun göndəriş qeydi yoxdur.")).toBeInTheDocument();
    expect(screen.queryByText("Bu mühitdə hələ göndəriş qeydi yoxdur.")).toBeNull();
    await act(async () => { fireEvent.change(screen.getByLabelText(/^Vəziyyət/), { target: { value: "" } }); });
    await settle();
    expect(screen.getByText("Bu mühitdə hələ göndəriş qeydi yoxdur.")).toBeInTheDocument();   // no filter: the plain words
    expect(screen.queryByText("Süzgəcə uyğun göndəriş qeydi yoxdur.")).toBeNull();
  });

  it("never lets a late answer overwrite the list of the filter now chosen", async () => {
    const first = deferred();
    const second = deferred();
    const { api } = await mounted((a) => a.tresDeliveries
      .mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise));
    await act(async () => { fireEvent.change(screen.getByLabelText(/^Vəziyyət/), { target: { value: "stuck" } }); });
    await act(async () => { second.resolve({ ...PAGE, items: [row("r7", { status: "stuck", resource_type: "lab" })] }); });
    await settle();
    expect(table().getAllByRole("row")).toHaveLength(2);
    await act(async () => { first.resolve(PAGE); });                           // the unfiltered answer, late
    await settle();
    expect(api.tresDeliveries).toHaveBeenCalledTimes(2);
    expect(table().getAllByRole("row")).toHaveLength(2);                       // still the filtered list: one row
    expect(table().getByText("Laboratoriya nəticələri")).toBeInTheDocument();
  });

  it("never appends a page that was on its way when the filter changed to the new list", async () => {
    const page2 = deferred();
    await mounted((a) => a.tresDeliveries
      .mockResolvedValueOnce({ ...PAGE, next: "c-2" })
      .mockImplementationOnce(() => page2.promise)
      .mockResolvedValue({ ...PAGE, next: null, items: [row("r7", { status: "stuck" })] }));
    await click(screen.getByRole("button", { name: "Daha çox" }));             // in flight
    await act(async () => { fireEvent.change(screen.getByLabelText(/^Vəziyyət/), { target: { value: "stuck" } }); });
    await settle();
    expect(table().getAllByRole("row")).toHaveLength(2);                       // the new filter's list: one row
    await act(async () => { page2.resolve({ ...PAGE, next: null, items: [row("r8"), row("r9")] }); });
    await settle();
    expect(table().getAllByRole("row")).toHaveLength(2);                       // the old filter's page 2 is not appended
    expect(screen.queryByText(/^Göndərişlər oxunmadı: /)).toBeNull();
  });

  it("says a row with no stay, no number and no time without breaking (a null reads as a dash)", async () => {
    await mounted((a) => a.tresDeliveries.mockResolvedValue({ ...PAGE, items: [
      row("r9", { admission_id: null, board_key: null, updated_at: null })] }));
    expect(table().getAllByText("—").length).toBeGreaterThan(0);
    expect(table().queryByRole("button", { name: /^İlkin baxış/ })).toBeNull();     // no stay, nothing to preview
  });

  it("re-reads when the tab says the settings moved (its `refresh` changes), keeping the filter and the typed number", async () => {
    function Tab() {
      const [n, setN] = React.useState(0);
      return <><button type="button" onClick={() => setN(n + 1)}>settings moved</button><TresDeliveries refresh={n} /></>;
    }
    const { api } = await mounted((a) => a.tresDeliveries.mockResolvedValue(PAGE), <Tab />);
    fireEvent.change(finder(), { target: { value: "2026" } });
    await act(async () => { fireEvent.change(screen.getByLabelText(/^Vəziyyət/), { target: { value: "stuck" } }); });
    await settle();
    expect(api.tresDeliveries).toHaveBeenCalledTimes(2);
    await click(screen.getByRole("button", { name: "settings moved" }));
    expect(api.tresDeliveries).toHaveBeenCalledTimes(3);
    expect(api.tresDeliveries).toHaveBeenLastCalledWith({ status: "stuck", type: null, cursor: null });
    expect(finder().value).toBe("2026");
  });
});

describe("TresDeliveries — the hand", () => {
  it("finds a stay by its protocol number and sends it now", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValue(FOUND);
      a.sendTresStay.mockResolvedValue(hand(handRow("sent"), handRow("sent", "encounter")));
    });
    await find(" 202600000101 ");
    expect(api.tresStay).toHaveBeenCalledWith("202600000101");
    expect(screen.getByText("Yatış 202600000101 · evə yazılmayıb")).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(api.sendTresStay).toHaveBeenCalledWith(STAY);
    expect(shown("İşləndi: Göndərildi 2")).toHaveLength(1);
    expect(api.tresDeliveries).toHaveBeenCalledTimes(2);                        // read again after the send
  });

  it("takes any protocol number — the legacy ones start with «H» — and asks for no numeric keyboard", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValue({ ...FOUND, board_key: "H2600042" });
    });
    expect(finder()).not.toHaveAttribute("inputmode");
    await find("H2600042");
    expect(api.tresStay).toHaveBeenCalledWith("H2600042");
    expect(screen.getByText("Yatış H2600042 · evə yazılmayıb")).toBeInTheDocument();
  });

  it("tells a hand's result by its rows' statuses — a failed and a skipped row are not «sent»", async () => {
    await sendAnswering(hand(handRow("failed"), handRow("skipped", "encounter"), handRow("sent", "vital"),
      handRow("sent", "lab"), handRow("sent", "condition")));
    const said = shown("İşləndi: Göndərildi 3 · Uğursuz 1 · Göndərilmədi 1");
    expect(said).toHaveLength(1);
    expect(toneOf(said[0])).toBe("warn");                                       // a failed row: not the confirmation's tone
    expect(document.body.textContent).not.toMatch(/Göndərildi: \d/);
  });

  it("tells an all-sent result as a confirmation", async () => {
    await sendAnswering(hand(handRow("sent"), handRow("sent", "encounter")));
    const said = shown("İşləndi: Göndərildi 2");
    expect(toneOf(said[0])).toBe("ok");
  });

  it("tells a validate-mode result as «Yoxlanıldı», not as sent", async () => {
    await sendAnswering(hand(handRow("validated"), handRow("validated", "encounter"), handRow("skipped", "vital")));
    const said = shown("İşləndi: Yoxlanıldı 2 · Göndərilmədi 1");
    expect(said).toHaveLength(1);
    expect(toneOf(said[0])).toBe("warn");                                       // a skipped row: not a confirmation
    expect(document.body.textContent).not.toMatch(/Göndərildi \d/);
  });

  // Final review (2026-11-13): the tone tells the truth — a confirmation only when every row the hand touched is on the
  // platform (`sent`) or was checked by it (`validated`); any other row — refused, stuck, not sent, waiting — warns.
  it.each([["failed", "Uğursuz"], ["stuck", "İlişib qaldı"], ["skipped", "Göndərilmədi"], ["pending", "Gözləyir"]])(
    "warns when a row is %s", async (status, word) => {
      await sendAnswering(hand(handRow("sent"), handRow(status, "encounter")));
      const said = shown(`İşləndi: ${word === "Gözləyir" ? "Gözləyir 1 · Göndərildi 1" : `Göndərildi 1 · ${word} 1`}`);
      expect(said).toHaveLength(1);
      expect(toneOf(said[0])).toBe("warn");
    });

  it("confirms when every row is sent or validated", async () => {
    await sendAnswering(hand(handRow("sent"), handRow("validated", "encounter")));
    const said = shown("İşləndi: Göndərildi 1 · Yoxlanıldı 1");
    expect(said).toHaveLength(1);
    expect(toneOf(said[0])).toBe("ok");
  });

  it("says «qeyd yoxdur» when the hand touched no row", async () => {
    await sendAnswering(hand());
    expect(shown("İşləndi: qeyd yoxdur")).toHaveLength(1);
  });

  it("puts a status the map does not name last, as the engine's code", async () => {
    await sendAnswering(hand(handRow("sent"), handRow("weird", "encounter")));
    expect(shown("İşləndi: Göndərildi 1 · weird 1")).toHaveLength(1);
  });

  it("says a refusal by its code — a round holding the stay is «busy» (N12)", async () => {
    await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValue({ ...FOUND, state: "DISCHARGED", discharge_at: "2026-11-06T11:00:00Z" });
      a.sendTresStay.mockRejectedValue(refusal(409, "A round is sending this stay right now.", { apiCode: "tres_busy" }));
    });
    await find();
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(toasts().getAllByText(/Bu yatış üçün başqa bir göndəriş davam edir/).length).toBeGreaterThan(0);
  });

  it("says a parked tenant's refusal by its code, and a platform 429 with how long to wait", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValue(FOUND);
      a.sendTresStay
        .mockRejectedValueOnce(refusal(409, "The platform refused the login.", { apiCode: "tres_login_refused" }))
        .mockRejectedValueOnce(refusal(429, "Wait.", { apiCode: "tres_throttled", retryAfter: 45 }))
        .mockRejectedValue(refusal(429, "Wait.", { apiCode: "tres_throttled" }));
    });
    await find();
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(toasts().getAllByText(/Platforma girişi rədd etdi/).length).toBeGreaterThan(0);
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(toasts().getAllByText(/Platforma gözləməyi xahiş etdi.*Gözləmə müddəti: 45 san\./).length).toBeGreaterThan(0);
    await click(screen.getByRole("button", { name: "İndi göndər" }));            // a 429 with no wait said: no «Gözləmə müddəti»
    expect(api.sendTresStay).toHaveBeenCalledTimes(3);
    expect(toasts().getAllByText(/Platforma gözləməyi xahiş etdi/).filter((el) => !/Gözləmə müddəti/.test(el.textContent)).length)
      .toBeGreaterThan(0);
  });

  it("says the platform's own wait from the body — whole seconds, over the header's 15-minute cap — before the header's", async () => {
    await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValue(FOUND);
      a.sendTresStay
        .mockRejectedValueOnce(refusal(429, "Wait.", { apiCode: "tres_throttled", apiRetryAfter: 1800, retryAfter: 900 }))
        .mockRejectedValue(refusal(429, "Wait.", { apiCode: "tres_throttled", retryAfter: 45 }));
    });
    await find();
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(toasts().getAllByText(/Platforma gözləməyi xahiş etdi.*Gözləmə müddəti: 1800 san\./).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Gözləmə müddəti: 900 san/);
    await click(screen.getByRole("button", { name: "İndi göndər" }));            // no body wait: the header's
    expect(toasts().getAllByText(/Gözləmə müddəti: 45 san\./).length).toBeGreaterThan(0);
  });

  it("says «Yenidən cəhd et» of a row of the other environment by its code", async () => {
    await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.retryTresDelivery.mockRejectedValue(refusal(409, "other", { apiCode: "tres_other_environment" }));
    });
    await click(table().getAllByRole("button", { name: /^Yenidən cəhd et · / })[0]);
    expect(toasts().getAllByText(/Bu qeyd seçilməmiş mühitə aiddir/).length).toBeGreaterThan(0);
  });

  it("offers «Yenidən cəhd et» on a refused or stuck row only, and retries it", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.retryTresDelivery.mockResolvedValue(hand(handRow("sent", "vital"), handRow("failed", "encounter")));
    });
    const retries = table().getAllByRole("button", { name: /^Yenidən cəhd et · / });
    expect(retries).toHaveLength(1);                                            // the stuck vital alone
    await click(retries[0]);
    expect(api.retryTresDelivery).toHaveBeenCalledWith("r3");
    const said = shown("Yenidən cəhd edildi: Göndərildi 1 · Uğursuz 1");
    expect(said).toHaveLength(1);
    expect(toneOf(said[0])).toBe("warn");
  });

  it("names each row's buttons by the row, so a screen reader hears which record they are about", async () => {
    await mounted((a) => a.tresDeliveries.mockResolvedValue(PAGE));
    expect(table().getByRole("button", { name: "Yenidən cəhd et · Vital göstəricilər · hmn-p-r3." })).toBeInTheDocument();
    for (const [type, id] of [["Xəstə", "r1"], ["Xəstəxanaya yatış", "r2"], ["Vital göstəricilər", "r3"]]) {
      expect(table().getByRole("button", { name: `İlkin baxış · ${type} · hmn-p-${id}.` })).toBeInTheDocument();
    }
  });

  it("re-reads the list after a hand that got no answer (it may have landed), and after a login the platform refused", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValue(FOUND);
      a.sendTresStay
        .mockRejectedValueOnce(refusal(408, "timed out", { code: "REQUEST_TIMEOUT" }))
        .mockRejectedValueOnce(refusal(502, "bad gateway"))
        .mockRejectedValueOnce(refusal(409, "The platform refused the login.", { apiCode: "tres_login_refused" }))
        .mockRejectedValue(refusal(409, "busy", { apiCode: "tres_busy" }));
    });
    await find();
    const send = () => click(screen.getByRole("button", { name: "İndi göndər" }));
    await send();
    expect(api.tresDeliveries).toHaveBeenCalledTimes(2);                        // a timeout
    await send();
    expect(api.tresDeliveries).toHaveBeenCalledTimes(3);                        // a 502
    await send();
    expect(api.tresDeliveries).toHaveBeenCalledTimes(4);                        // the feed was parked by it
    await send();
    expect(api.tresDeliveries).toHaveBeenCalledTimes(4);                        // «busy»: nothing was touched, nothing re-read
  });

  it("shows the parked note after a hand's refused login parked the feed", async () => {
    await mounted((a) => {
      a.tresDeliveries.mockResolvedValueOnce(PAGE)
        .mockResolvedValue({ ...PAGE, session_refused_at: "2026-11-11T09:00:00Z" });
      a.tresStay.mockResolvedValue(FOUND);
      a.sendTresStay.mockRejectedValue(refusal(409, "The platform refused the login.", { apiCode: "tres_login_refused" }));
    });
    expect(screen.queryByText(/^Platforma bu xəstəxananın girişini rədd etdi/)).toBeNull();
    await find();
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(screen.getByText(/^Platforma bu xəstəxananın girişini rədd etdi/)).toBeInTheDocument();
  });

  it("opens the preview with its note, its environment, each resource and the platform's last words", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresPreview.mockResolvedValue({ admission_id: STAY, board_key: "202600000101", environment: "test", items: [
        { resource_type: "patient", local_id: "hmn-p-1.", held: true, reason: null, status: "sent", last_error: null,
          resource: { resourceType: "Patient", birthDate: "1980-01-31" } },
        { resource_type: "encounter", local_id: "hmn-e-1.", held: false, reason: "unit_unmapped", status: "failed",
          last_error: "Encounter.serviceType: minimum required = 1", resource: null }] });
    });
    await click(table().getAllByRole("button", { name: /^İlkin baxış · / })[0]);
    expect(api.tresPreview).toHaveBeenCalledWith(STAY);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Göndərişin ilkin baxışı · 202600000101")).toBeInTheDocument();
    expect(dialog.getByText(/^İlkin baxış xəstə məlumatlarını ehtiva edir/)).toBeInTheDocument();
    expect(dialog.getByText("Mühit: Sınaq mühiti (sandbox)")).toBeInTheDocument();
    expect(dialog.getByText(/"birthDate": "1980-01-31"/)).toBeInTheDocument();
    expect(dialog.getByText("Platformanın son mesajı: Encounter.serviceType: minimum required = 1")).toBeInTheDocument();
    await click(dialog.getByRole("button", { name: "Bağla" }));          // the dialog's own close
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("puts the preview's long bodies in a region a keyboard can reach and scroll", async () => {
    await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresPreview.mockResolvedValue({ admission_id: STAY, board_key: "202600000101", environment: "live", items: [
        { resource_type: "patient", local_id: "hmn-p-1.", held: true, reason: null, status: "sent", last_error: null,
          resource: { resourceType: "Patient" } }] });
    });
    await click(table().getAllByRole("button", { name: /^İlkin baxış · / })[0]);
    const body = within(screen.getByRole("dialog")).getByText(/"resourceType": "Patient"/);
    expect(body).toHaveAttribute("tabindex", "0");
    expect(body).toHaveAccessibleName("Xəstə · hmn-p-1.");
    expect(within(screen.getByRole("dialog")).getByText("Mühit: Canlı mühit")).toBeInTheDocument();
  });

  it("reads the preview afresh on each open — closing it keeps nothing, the second open asks again", async () => {
    const body = (birthDate) => ({ admission_id: STAY, board_key: "202600000101", environment: "test", items: [
      { resource_type: "patient", local_id: "hmn-p-1.", held: true, reason: null, status: "sent", last_error: null,
        resource: { resourceType: "Patient", birthDate } }] });
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresPreview.mockResolvedValueOnce(body("1980-01-31")).mockResolvedValueOnce(body("1981-02-01"));
    });
    const open = () => click(table().getAllByRole("button", { name: /^İlkin baxış · / })[0]);
    await open();
    expect(screen.getByText(/"birthDate": "1980-01-31"/)).toBeInTheDocument();
    await click(within(screen.getByRole("dialog")).getByRole("button", { name: "Bağla" }));
    expect(document.body.textContent).not.toContain("1980-01-31");              // nothing of it left on the page
    await open();
    expect(api.tresPreview).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/"birthDate": "1981-02-01"/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("1980-01-31");
  });

  it("shows a yielded Patient as the newer stay's and a type switched off with no body, without breaking", async () => {
    await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresPreview.mockResolvedValue({ admission_id: STAY, board_key: "202600000101", environment: "test", items: [
        { resource_type: "patient", local_id: "hmn-p-1.", held: true, reason: null, status: null, last_error: null,
          resource: null, yielded: true },
        { resource_type: "lab", local_id: "hmn-l-1.", held: false, reason: "type_off", status: null, last_error: null,
          resource: null, yielded: false },
        { resource_type: "encounter", local_id: "hmn-e-1.", held: false, reason: null, status: null, last_error: null,
          resource: { resourceType: "Encounter" }, yielded: false }] });
    });
    await click(table().getAllByRole("button", { name: /^İlkin baxış · / })[0]);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getAllByText(/bu qeydi platformada xəstənin daha yeni yatışı saxlayır/)).toHaveLength(1);
    expect(dialog.getByText(/Bu qeyd növü bağlıdır/)).toBeInTheDocument();
    expect(dialog.getByText(/"resourceType": "Encounter"/)).toBeInTheDocument();
    expect(dialog.queryByText("null")).toBeNull();                              // no body printed for a null resource
  });
});

describe("TresDeliveries — the found stay, by its state", () => {
  const found = async (stay) => {
    await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValue({ admission_id: STAY, board_key: "202600000101", discharge_at: null, ...stay });
    });
    await find();
  };

  it("says a discharged stay with its time", async () => {
    await found({ state: "DISCHARGED", discharge_at: "2026-11-06T11:00:00Z" });
    expect(screen.getByText("Yatış 202600000101 · evə yazılıb 06.11 15:00")).toBeInTheDocument();
  });

  it("says a stay transferred out in its own words — never «not discharged», which is the open stay's", async () => {
    await found({ state: "TRANSFERRED" });
    expect(screen.getByText("Yatış 202600000101 · köçürülüb")).toBeInTheDocument();
    expect(screen.queryByText(/evə yazılmayıb/)).toBeNull();
  });

  it.each([
    ["DRAFT", "qaralama"], ["PENDING_DISCHARGE", "evə yazılma gözləyir"], ["PENDING_TRANSFER", "köçürmə gözləyir"],
    ["DISCHARGED", "evə yazılıb"],
  ])("says %s in its own words", async (state, words) => {
    await found({ state });
    expect(screen.getByText(`Yatış 202600000101 · ${words}`)).toBeInTheDocument();
  });

  // Final review (2026-11-13): an unsigned draft (often with no attending) is no stay to report — the engine refuses
  // it by hand (`tres_stay_draft`); the panel does not offer the send. The preview writes nothing and stays.
  it("offers no «İndi göndər» for a stay in draft, and still offers its preview", async () => {
    await found({ state: "DRAFT" });
    expect(screen.getByText("Yatış 202600000101 · qaralama")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "İndi göndər" })).toBeNull();
    expect(screen.getByRole("button", { name: "İlkin baxış" })).toBeEnabled();
  });

  it.each(["ACTIVE", "PENDING_DISCHARGE", "PENDING_TRANSFER", "TRANSFERRED", "DISCHARGED", "ARCHIVED"])(
    "offers «İndi göndər» for a stay %s", async (state) => {
      await found({ state });
      expect(screen.getByRole("button", { name: "İndi göndər" })).toBeEnabled();
    });

  it("says a draft's refusal by its code", async () => {
    await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.retryTresDelivery.mockRejectedValue(refusal(409, "draft", { apiCode: "tres_stay_draft" }));
    });
    await click(table().getAllByRole("button", { name: /^Yenidən cəhd et · / })[0]);
    expect(toasts().getAllByText(/Bu yatış hələ qaralamadır \(imzalanmayıb\); əl ilə göndərilmir\./).length)
      .toBeGreaterThan(0);
  });

  it("says a state this build does not know by the engine's own word, never an empty line", async () => {
    await found({ state: "ARCHIVED" });
    expect(screen.getByText("Yatış 202600000101 · ARCHIVED")).toBeInTheDocument();
  });

  it("is a status region, so the line it puts up is said", async () => {
    await found({ state: "ACTIVE" });
    expect(screen.getByText(/^Yatış 202600000101/).closest("[role='status']")).not.toBeNull();
  });

  it("says a stay not found by its code and leaves no line behind", async () => {
    await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValueOnce(FOUND).mockRejectedValueOnce(refusal(404, "no", { apiCode: "tres_stay_unknown" }));
    });
    await find();
    expect(screen.getByText(/^Yatış 202600000101/)).toBeInTheDocument();
    await find("999");
    expect(screen.queryByText(/^Yatış 202600000101/)).toBeNull();
    expect(toasts().getAllByText(/Bu nömrə ilə bu xəstəxanada yatış yoxdur/).length).toBeGreaterThan(0);
  });
});

describe("TresDeliveries — one action at a time", () => {
  const stayAndRows = (a) => {
    a.tresDeliveries.mockResolvedValue(PAGE);
    a.tresStay.mockResolvedValue(FOUND);
  };
  const buttons = () => screen.getAllByRole("button").filter((b) => !b.closest("[data-toast]"));

  it("shows every other button off while «İndi göndər» runs, and a second click does nothing", async () => {
    const pending = deferred();
    const { api } = await mounted((a) => {
      stayAndRows(a);
      a.sendTresStay.mockImplementation(() => pending.promise);
      a.retryTresDelivery.mockResolvedValue(hand());
      a.tresPreview.mockResolvedValue({ admission_id: STAY, board_key: "x", environment: "test", items: [] });
    });
    await find();
    const send = screen.getByRole("button", { name: "İndi göndər" });
    await click(send);
    expect(send).toHaveAttribute("aria-busy", "true");                          // the clicked one says so
    const others = buttons().filter((b) => b !== send);
    expect(others.length).toBeGreaterThan(3);                                   // find, preview, the rows' buttons
    for (const other of others) {
      expect(other, other.textContent).toBeDisabled();                          // visibly off, not silently ignored
      expect(other).not.toHaveAttribute("aria-busy", "true");                   // and no spinner of their own
    }
    await click(send);                                                          // a second click on it
    await click(table().getAllByRole("button", { name: /^Yenidən cəhd et · / })[0]);
    await click(screen.getByRole("button", { name: "İlkin baxış" }));
    expect(api.sendTresStay).toHaveBeenCalledTimes(1);
    expect(api.retryTresDelivery).not.toHaveBeenCalled();
    expect(api.tresPreview).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(hand(handRow("sent"))); });
    await settle();
    for (const b of buttons()) expect(b, b.textContent).toBeEnabled();
    expect(send).not.toHaveAttribute("aria-busy", "true");
  });

  it("puts the busy mark on the clicked row's button alone", async () => {
    const pending = deferred();
    const { api } = await mounted((a) => {
      stayAndRows(a);
      a.retryTresDelivery.mockImplementation(() => pending.promise);
    });
    const mine = table().getByRole("button", { name: /^Yenidən cəhd et · / });
    await click(mine);
    expect(mine).toHaveAttribute("aria-busy", "true");
    const previews = table().getAllByRole("button", { name: /^İlkin baxış · / });
    expect(previews).toHaveLength(3);
    for (const preview of previews) {
      expect(preview).toBeDisabled();
      expect(preview).not.toHaveAttribute("aria-busy", "true");                 // a row's preview does not wear this row's spinner
    }
    await click(previews[0]);
    expect(api.tresPreview).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(hand()); });
    await settle();
    expect(mine).not.toHaveAttribute("aria-busy", "true");
  });

  it("puts a row's preview busy on that row's preview alone, the found line's own on its own", async () => {
    const pending = deferred();
    await mounted((a) => {
      stayAndRows(a);
      a.tresPreview.mockImplementation(() => pending.promise);
    });
    await find();
    const [first, second] = table().getAllByRole("button", { name: /^İlkin baxış · / });
    await click(first);
    expect(first).toHaveAttribute("aria-busy", "true");
    expect(second).not.toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "İlkin baxış" })).not.toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "İlkin baxış" })).toBeDisabled();
    await act(async () => { pending.resolve({ admission_id: STAY, board_key: "202600000101", environment: "test", items: [] }); });
    await settle();
  });

  it("holds «Yatışı tap» off while a hand runs, so the number cannot be searched under it", async () => {
    const pending = deferred();
    const { api } = await mounted((a) => {
      stayAndRows(a);
      a.sendTresStay.mockImplementation(() => pending.promise);
    });
    await find();
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(screen.getByRole("button", { name: "Yatışı tap" })).toBeDisabled();
    await act(async () => { fireEvent.submit(finder().closest("form")); });
    expect(api.tresStay).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(hand()); });
    await settle();
  });

  it("holds «Daha çox» and the others while a page is read", async () => {
    const pending = deferred();
    await mounted((a) => a.tresDeliveries.mockResolvedValueOnce({ ...PAGE, next: "c-2" })
      .mockImplementationOnce(() => pending.promise));
    const more = screen.getByRole("button", { name: "Daha çox" });
    await click(more);
    expect(more).toHaveAttribute("aria-busy", "true");
    for (const b of table().getAllByRole("button")) expect(b).toBeDisabled();
    await act(async () => { pending.resolve({ ...PAGE, next: null, items: [] }); });
    await settle();
  });
});

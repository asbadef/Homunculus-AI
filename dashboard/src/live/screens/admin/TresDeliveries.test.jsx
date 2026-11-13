// src/live/screens/admin/TresDeliveries.test.jsx — Yönetim › TRƏS › «Gönderimler» (TRƏS-01 · F1, spec §6, D9, D21, D25;
// plan F1, N12, N15): the ledger in the catalogue's words and never the platform's; a parked feed said at the top; the
// filters and «Daha çox» read again; a stay found by its protocol number and sent now; a refusal by its code;
// «Yenidən cəhd et» only on a refused or stuck row; the preview's dialog. Synthetic stays only.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { settle, toasts } from "../kabul/kabul.testutil.js";
import { TresDeliveries } from "./TresDeliveries.jsx";

const PERMS = ["tres.manage"];
const STAY = "66666666-6666-4666-8666-666666666601";
const row = (id, over = {}) => ({ id, resource_type: "patient", local_id: `hmn-p-${id}.`, status: "sent", reason: null,
  attempts: 0, operation: "create", remote_id: "7001", next_attempt_at: null, updated_at: "2026-11-11T08:00:00Z",
  admission_id: STAY, board_key: "202600000101", ...over });
const PAGE = { environment: "test", session_refused_at: null, next: null, items: [
  row("r1"), row("r2", { resource_type: "encounter", status: "skipped", reason: "unit_unmapped" }),
  row("r3", { resource_type: "vital", status: "stuck", attempts: 5, remote_id: null })] };

async function mounted(setup) {
  const m = await mount(<TresDeliveries />, { access: token({ perms: PERMS }), me: profile({ perms: PERMS }), setup });
  await settle();
  return m;
}
const click = async (el) => {
  await act(async () => { fireEvent.click(el); });
  await settle();
};
const shown = (text) => toasts().getAllByText(text).filter((el) => el.closest("[data-toast]"));
const table = () => within(screen.getByRole("table"));

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

  it("says when the ledger could not be read", async () => {
    await mounted((a) => a.tresDeliveries.mockRejectedValue(refusal(503, "down")));
    expect(screen.getByText(/^Göndərişlər oxunmadı: /)).toBeInTheDocument();
  });

  it("says a row with no stay, no number and no time without breaking (a null reads as a dash)", async () => {
    await mounted((a) => a.tresDeliveries.mockResolvedValue({ ...PAGE, items: [
      row("r9", { admission_id: null, board_key: null, updated_at: null })] }));
    expect(table().getAllByText("—").length).toBeGreaterThan(0);
    expect(table().queryByRole("button", { name: "İlkin baxış" })).toBeNull();     // no stay, nothing to preview
  });
});

describe("TresDeliveries — the hand", () => {
  it("finds a stay by its protocol number and sends it now", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValue({ admission_id: STAY, board_key: "202600000101", state: "ACTIVE", discharge_at: null });
      a.sendTresStay.mockResolvedValue({ admission_id: STAY, counts: {}, rows: [
        { resource_type: "patient", local_id: "hmn-p-1.", status: "sent", reason: null },
        { resource_type: "encounter", local_id: "hmn-e-1.", status: "sent", reason: null }] });
    });
    fireEvent.change(screen.getByLabelText(/^Protokol nömrəsi/), { target: { value: " 202600000101 " } });
    await click(screen.getByRole("button", { name: "Yatışı tap" }));
    expect(api.tresStay).toHaveBeenCalledWith("202600000101");
    expect(screen.getByText("Yatış 202600000101 · evə yazılmayıb")).toBeInTheDocument();
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(api.sendTresStay).toHaveBeenCalledWith(STAY);
    expect(shown("Göndərildi: 2 qeyd işləndi.")).toHaveLength(1);
    expect(api.tresDeliveries).toHaveBeenCalledTimes(2);                        // read again after the send
  });

  it("says a refusal by its code — a round holding the stay is «busy» (N12)", async () => {
    await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValue({ admission_id: STAY, board_key: "202600000101", state: "DISCHARGED",
        discharge_at: "2026-11-06T11:00:00Z" });
      a.sendTresStay.mockRejectedValue(refusal(409, "A round is sending this stay right now.", { apiCode: "tres_busy" }));
    });
    fireEvent.change(screen.getByLabelText(/^Protokol nömrəsi/), { target: { value: "202600000101" } });
    await click(screen.getByRole("button", { name: "Yatışı tap" }));
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(toasts().getAllByText(/Bu yatış üçün başqa bir göndəriş davam edir/).length).toBeGreaterThan(0);
  });

  it("says a parked tenant's refusal by its code, and a platform 429 with how long to wait", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresStay.mockResolvedValue({ admission_id: STAY, board_key: "202600000101", state: "ACTIVE", discharge_at: null });
      a.sendTresStay
        .mockRejectedValueOnce(refusal(409, "The platform refused the login.", { apiCode: "tres_login_refused" }))
        .mockRejectedValueOnce(refusal(429, "Wait.", { apiCode: "tres_throttled", retryAfter: 45 }))
        .mockRejectedValue(refusal(429, "Wait.", { apiCode: "tres_throttled" }));
    });
    fireEvent.change(screen.getByLabelText(/^Protokol nömrəsi/), { target: { value: "202600000101" } });
    await click(screen.getByRole("button", { name: "Yatışı tap" }));
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(toasts().getAllByText(/Platforma girişi rədd etdi/).length).toBeGreaterThan(0);
    await click(screen.getByRole("button", { name: "İndi göndər" }));
    expect(toasts().getAllByText(/Platforma gözləməyi xahiş etdi.*Gözləmə müddəti: 45 san\./).length).toBeGreaterThan(0);
    await click(screen.getByRole("button", { name: "İndi göndər" }));            // a 429 with no wait said: no «Gözləmə müddəti»
    expect(api.sendTresStay).toHaveBeenCalledTimes(3);
    expect(toasts().getAllByText(/Platforma gözləməyi xahiş etdi/).filter((el) => !/Gözləmə müddəti/.test(el.textContent)).length)
      .toBeGreaterThan(0);
  });

  it("says «Yenidən cəhd et» of a row of the other environment by its code", async () => {
    await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.retryTresDelivery.mockRejectedValue(refusal(409, "other", { apiCode: "tres_other_environment" }));
    });
    await click(table().getAllByRole("button", { name: "Yenidən cəhd et" })[0]);
    expect(toasts().getAllByText(/Bu qeyd seçilməmiş mühitə aiddir/).length).toBeGreaterThan(0);
  });

  it("offers «Yenidən cəhd et» on a refused or stuck row only, and retries it", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.retryTresDelivery.mockResolvedValue({ admission_id: STAY, counts: {}, rows: [] });
    });
    const retries = table().getAllByRole("button", { name: "Yenidən cəhd et" });
    expect(retries).toHaveLength(1);                                            // the stuck vital alone
    await click(retries[0]);
    expect(api.retryTresDelivery).toHaveBeenCalledWith("r3");
    expect(shown("Yenidən cəhd edildi: 0 qeyd işləndi.")).toHaveLength(1);
  });

  it("opens the preview with its note, each resource and the platform's last words", async () => {
    const { api } = await mounted((a) => {
      a.tresDeliveries.mockResolvedValue(PAGE);
      a.tresPreview.mockResolvedValue({ admission_id: STAY, board_key: "202600000101", environment: "test", items: [
        { resource_type: "patient", local_id: "hmn-p-1.", held: true, reason: null, status: "sent", last_error: null,
          resource: { resourceType: "Patient", birthDate: "1980-01-31" } },
        { resource_type: "encounter", local_id: "hmn-e-1.", held: false, reason: "unit_unmapped", status: "failed",
          last_error: "Encounter.serviceType: minimum required = 1", resource: null }] });
    });
    await click(table().getAllByRole("button", { name: "İlkin baxış" })[0]);
    expect(api.tresPreview).toHaveBeenCalledWith(STAY);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Göndərişin ilkin baxışı · 202600000101")).toBeInTheDocument();
    expect(dialog.getByText(/^İlkin baxış xəstə məlumatlarını ehtiva edir/)).toBeInTheDocument();
    expect(dialog.getByText(/"birthDate": "1980-01-31"/)).toBeInTheDocument();
    expect(dialog.getByText("Platformanın son mesajı: Encounter.serviceType: minimum required = 1")).toBeInTheDocument();
    await click(dialog.getByRole("button", { name: "Bağla" }));          // the dialog's own close
    expect(screen.queryByRole("dialog")).toBeNull();
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
    await click(table().getAllByRole("button", { name: "İlkin baxış" })[0]);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getAllByText(/bu qeydi platformada xəstənin daha yeni yatışı saxlayır/)).toHaveLength(1);
    expect(dialog.getByText(/Bu qeyd növü bağlıdır/)).toBeInTheDocument();
    expect(dialog.getByText(/"resourceType": "Encounter"/)).toBeInTheDocument();
    expect(dialog.queryByText("null")).toBeNull();                              // no body printed for a null resource
  });
});

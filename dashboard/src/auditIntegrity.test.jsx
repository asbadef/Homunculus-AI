/**
 * The audit chain's verdict on screen (G2).
 *
 * The engine can prove a record was not altered; that proof is worth nothing if the screen that
 * shows it rounds a broken chain up to something reassuring. These tests hold the three ways this
 * panel could lie: a green verdict over a partial check, a green verdict over unsealed rows, and a
 * softened word for "broken".
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuditLog } from "./clinicalAdmin.jsx";
import { getTheme } from "./clinicalTheme.js";
import { cstrings } from "./clinicalI18n.js";

const T = getTheme("dark");
const S = cstrings("tr");

function renderAudit(verifyAudit) {
  const store = { refreshAudit: vi.fn(async () => ({})), verifyAudit };
  return render(<AuditLog T={T} S={S} state={{ auditLog: [] }} store={store} />);
}

const press = () => fireEvent.click(screen.getByRole("button", { name: /Bütünlüğü doğrula/i }));

describe("the audit integrity verdict", () => {
  it("says the chain is intact and how many records it actually checked", async () => {
    renderAudit(vi.fn(async () => ({ ok: true, checked: 42, unsealed: 0, records: 42, complete: true })));
    press();
    await waitFor(() => expect(screen.getByText(/Zincir sağlam/)).toBeInTheDocument());
    expect(screen.getByText(/42 kayıt mühürlü/)).toBeInTheDocument();
  });

  it("names the first broken record rather than only saying something is wrong", async () => {
    renderAudit(vi.fn(async () => ({
      ok: false, checked: 3, unsealed: 0, broken_at: 17, records: 20, complete: true,
      reason: "kaydın içeriği mührüyle uyuşmuyor — sonradan değiştirilmiş",
    })));
    press();
    await waitFor(() => expect(screen.getByText(/ZİNCİR KIRIK/)).toBeInTheDocument());
    expect(screen.getByText(/#17/)).toBeInTheDocument();
    expect(screen.getByText(/değiştirilmiş/)).toBeInTheDocument();
  });

  it("does not let a partial verification read as a whole one", async () => {
    renderAudit(vi.fn(async () => ({ ok: true, checked: 100, unsealed: 0, records: 100, complete: false })));
    press();
    await waitFor(() => expect(screen.getByText(/Yalnız ilk 100 kayıt doğrulandı/)).toBeInTheDocument());
  });

  it("declares records that predate the seal instead of counting them as verified", async () => {
    renderAudit(vi.fn(async () => ({ ok: true, checked: 5, unsealed: 9, records: 14, complete: true })));
    press();
    await waitFor(() => expect(screen.getByText(/9 kayıt mühür öncesinden/)).toBeInTheDocument());
    // The intact message must report only what was actually sealed and checked.
    expect(screen.getByText(/5 kayıt mühürlü/)).toBeInTheDocument();
  });

  it("reports a failed check as failed, not as a clean chain", async () => {
    renderAudit(vi.fn(async () => { throw new Error("network"); }));
    press();
    await waitFor(() => expect(screen.getByText(/Doğrulama yapılamadı/)).toBeInTheDocument());
    expect(screen.queryByText(/Zincir sağlam/)).toBeNull();
  });

  it("offers no verify button when the store cannot reach an engine", () => {
    render(<AuditLog T={T} S={S} state={{ auditLog: [] }} store={{ refreshAudit: vi.fn(async () => ({})) }} />);
    expect(screen.queryByRole("button", { name: /Bütünlüğü doğrula/i })).toBeNull();
  });
});

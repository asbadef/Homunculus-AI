/**
 * The severity-score form on screen (M2).
 *
 * The form arrives pre-filled, which is the product's value and also its risk: a number that
 * appeared on its own is a number nobody checked. These tests hold the four refusals that make a
 * pre-filled clinical form safe to sign.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { SeverityScorePanel } from "./severityScore.jsx";
import { getTheme } from "./clinicalTheme.js";
import { cstrings } from "./clinicalI18n.js";

const T = getTheme("dark");
const S = cstrings("tr");

const FORM = {
  score: "SOFA",
  source: "sepsis-3-jama-2016",
  total: 3,
  signed: false,
  covers_full_window: true,
  window_from: "2026-09-12T12:00:00+00:00",
  window_to: "2026-09-13T12:00:00+00:00",
  unmeasured_organs: ["liver", "cns"],
  corrected_cells: [],
  organ_failures: ["coagulation"],
  rows: [
    {
      organ: "coagulation", points: 3, measured: true, failure: true,
      inputs: [{ code: "platelets", value: 45, at: "2026-09-13T06:00:00+00:00", points: 3,
                 source: "lab", considered: 3, measured: true, outside_window: false,
                 overridden: false, original: null }],
    },
    {
      organ: "liver", points: 0, measured: false, failure: false,
      inputs: [{ code: "bilirubin", value: null, at: null, points: 0, source: "",
                 considered: 0, measured: false, outside_window: false,
                 overridden: false, original: null }],
    },
  ],
};

function show({ form = FORM, sign } = {}) {
  const store = {
    severityForm: vi.fn(async () => form),
    signSeverityForm: sign || vi.fn(async () => ({
      signed: true, signed_by: "dr.elif", signed_at: "2026-09-13T12:05:00+00:00",
      total: 3, overrides: [], form: { ...form, signed: true, auto_total: 3 },
    })),
  };
  render(<SeverityScorePanel T={T} S={S} store={store} patientId="yatak-1" />);
  return store;
}

describe("the form arrives filled and says where each number came from", () => {
  it("shows the total and the measurement behind a row", async () => {
    show();
    await waitFor(() => expect(screen.getByText("45")).toBeInTheDocument());
    // The total and the row both read 3 here; the headline is the one rendered large.
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.getByText("platelets")).toBeInTheDocument();
    // The timestamp is the point: a physician has to be able to find the measurement in the
    // chart. Matched as a time rather than an exact string — the rendered format depends on the
    // runtime's locale data, and pinning it would make this test about Node's ICU build.
    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();
  });

  it("names its source rather than presenting the bands as ours", async () => {
    show();
    await waitFor(() => expect(screen.getByText(/sepsis-3-jama-2016/)).toBeInTheDocument());
  });
});

describe("it never renders an unmeasured organ as a healthy one", () => {
  it("marks the organ nobody measured", async () => {
    show();
    await waitFor(() => expect(screen.getByText("ölçülmedi")).toBeInTheDocument());
  });

  it("explains why a zero there is not reassurance", async () => {
    show();
    await waitFor(() => expect(screen.getByText(/eksik organı 0 puanlar/)).toBeInTheDocument());
  });
});

describe("a correction needs a reason and never sets the points", () => {
  const openEditor = async () => {
    show();
    await waitFor(() => expect(screen.getByText("45")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /Düzelt/ })[0]);
  };

  it("offers a value field and a reason, not a points field", async () => {
    await openEditor();
    expect(screen.getByText(/Doğru değer/)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();          // the reason
    expect(document.querySelector('input[type="number"]')).not.toBeNull();
    // The clinician corrects the measurement; the engine re-scores the row. There is deliberately
    // nowhere to type a point value — an unbanded number must not reach quality reporting.
    expect(screen.queryByText(/^Puan$/)).toBeNull();
  });

  it("keeps the correction disabled until the reason is long enough", async () => {
    await openEditor();
    const save = screen.getAllByRole("button", { name: /Düzelt/ }).pop();
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "kısa" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Laboratuvar sonucu cihazdan farkli geldi, tekrar bakildi" } });
    expect(save).not.toBeDisabled();
  });
});

describe("a form is signed only when the engine says so", () => {
  it("sends the pending corrections and then shows who signed", async () => {
    const sign = vi.fn(async () => ({
      signed: true, signed_by: "dr.elif", signed_at: "2026-09-13T12:05:00+00:00",
      total: 0, overrides: [], form: { ...FORM, total: 0, signed: true, auto_total: 3 },
    }));
    show({ sign });
    await waitFor(() => expect(screen.getByText("45")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Onayla ve İmzala/ }));
    await waitFor(() => expect(screen.getByText(/dr\.elif/)).toBeInTheDocument());
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("does not claim a signature when the engine refused", async () => {
    const sign = vi.fn(async () => { throw new Error("gerekçe en az 20 karakter olmalı"); });
    show({ sign });
    await waitFor(() => expect(screen.getByText("45")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Onayla ve İmzala/ }));
    await waitFor(() => expect(screen.getByText(/en az 20 karakter/)).toBeInTheDocument());
    expect(screen.queryByText(/imzalandı/)).toBeNull();
  });
});

describe("a score with no sourced table says so instead of showing an empty tab", () => {
  it("APACHE II is declared as awaiting its table", async () => {
    show();
    await waitFor(() => expect(screen.getByText("45")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /APACHE II/ }));
    expect(screen.getByText(/Tablo bekleniyor/)).toBeInTheDocument();
    expect(screen.getByText(/Kaynaksız bant yazılmaz/)).toBeInTheDocument();
  });
});

describe("a shorter stay is declared", () => {
  it("a window the patient was not here for is flagged", async () => {
    show({ form: { ...FORM, covers_full_window: false } });
    await waitFor(() =>
      expect(screen.getByText(/tamamı boyunca yatmadı/)).toBeInTheDocument());
  });
});

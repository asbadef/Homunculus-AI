import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { CONNECTION } from "../../../liveConnection.js";
import { patientFromBoard, alertsFromPatients } from "../../../liveAdapters.js";
import { NOW, ago, alarm, entry, identity, measured, news2, reading } from "../../data/board.testutil.js";
import { bed as monitorBed, param as monitorParam } from "../../data/shadow.testutil.js";
import { BedCard, sparkPoints } from "./BedCard.jsx";

/** The card as the screen builds it: the adapter's record, and that patient's flattened alarms.
 *  `connection` defaults to LIVE because that is the state nearly every one of these tests is
 *  about; the one test that is about the others passes its own. */
function card(raw, connection = CONNECTION.LIVE) {
  const patient = patientFromBoard(raw);
  return render(
    <I18nProvider>
      <ul>
        <BedCard patient={patient} alerts={alertsFromPatients([patient])} nowMs={NOW} connection={connection} />
      </ul>
    </I18nProvider>,
  );
}

describe("the bed card — what it says, and what it refuses to", () => {
  it("names the bed and the patient, and links to the patient", () => {
    card(entry("S-001", [], { identity: identity(), at: measured(30) }));
    const link = screen.getByRole("link", { name: "REA-01 · 2 xəstəsini aç" });
    expect(link).toHaveAttribute("href", "#/patients/S-001");
    expect(screen.getByText("REA-01 · 2")).toBeInTheDocument();
    expect(screen.getByText("Ayşe Sentetik")).toBeInTheDocument();
  });

  it("a card with no HIS name says what is missing — it does not print the device's id as a name", () => {
    card(entry("S-002", [], { at: measured(30) }));
    expect(screen.getByText("kimlik gözlənilir")).toBeInTheDocument();
    // The id is the bed slot's business, and appears there once.
    expect(screen.getAllByText("S-002")).toHaveLength(1);
  });

  it("an escaped id reaches the link intact", () => {
    card(entry("S 001/A", [], { at: measured(30) }));
    expect(screen.getByRole("link")).toHaveAttribute("href", "#/patients/S%20001%2FA");
  });

  describe("risk", () => {
    it("risk none on a MEASURED card reads \"no finding\"", () => {
      card(entry("S-001", [], { risk: "none", at: measured(30), vitals: { heart_rate: 78 } }));
      expect(screen.getByText("Tapıntı yoxdur")).toBeInTheDocument();
    });

    it("risk none on a card with NO observation reads \"not measured\"", () => {
      // The claim "no finding" is about observations, and this card has none.
      card(entry("S-002", [], { risk: "none" }));
      expect(screen.getByText("Ölçülməyib")).toBeInTheDocument();
    });

    it("moderate is amber, never a green \"stable\"", () => {
      const { container } = card(entry("S-001", [], { risk: "moderate", at: measured(30) }));
      expect(screen.getByText("Orta")).toBeInTheDocument();
      expect(container.querySelector("[data-rail]")).toHaveAttribute("data-rail", "mid");
      expect(container.querySelector("[data-tone='ok']")).toBeNull();
    });

    it("a risk the engine did not send takes the attention look, not a quiet one", () => {
      const { container } = card(entry("S-001", [], { risk: null, at: measured(30) }));
      expect(screen.getByText("Risk bildirilməyib")).toBeInTheDocument();
      expect(container.querySelector("[data-rail]")).toHaveAttribute("data-rail", "att");
    });

    it("the stripe's colour is never the only signal: the pill's word is beside it", () => {
      const { container } = card(entry("S-001", [], { risk: "critical", at: measured(30) }));
      expect(container.querySelector("[data-rail='crit']")).toBeInTheDocument();
      expect(screen.getByText("Kritik")).toBeInTheDocument();
    });
  });

  describe("the measured channels", () => {
    it("shows the prototype's five columns — HR, MAP, SpO2, RR, temperature — with their values", () => {
      const { container } = card(entry("S-001", [], { ...reading({ heart_rate: 118, spo2: 91, resp_rate: 26, map: 58, sbp: 92, temperature: 38.4 }, 30) }));
      expect(screen.getByText("118")).toBeInTheDocument();
      expect(screen.getByText("91")).toBeInTheDocument();
      expect(screen.getByText("58")).toBeInTheDocument();
      expect([...container.querySelectorAll("dl dt")].map((d) => d.textContent)).toEqual(["HR", "MAP", "SpO₂", "RR", "Hərarət"]);
    });

    it("a measured 0 is a finding, not a missing value", () => {
      card(entry("S-001", [], { at: measured(30), vitals: { resp_rate: 0 } }));
      expect(screen.getByText("0")).toBeInTheDocument();
    });

    it("a channel with no value keeps its column: a dash, read out as not measured", () => {
      const { container } = card(entry("S-001", [], { at: measured(30), vitals: { heart_rate: 78 } }));
      const cells = container.querySelectorAll("dl dd");
      expect(cells).toHaveLength(5);
      expect(cells[2].textContent).toMatch(/^—/);
      expect(cells[2].querySelector(".sr-only")).not.toBeNull();
    });

    it("a card with nothing measured says that once, in a sentence", () => {
      card(entry("S-002"));
      expect(screen.getByText("Bu çarpayıdan heç bir ölçmə gəlməyib.")).toBeInTheDocument();
    });

    it("says when the card was last measured, and how many channels are overdue", () => {
      card(entry("S-001", [], {
        at: { heart_rate: ago(30), spo2: ago(4_000) },
        vitals: { heart_rate: 78, spo2: 96 },
      }));
      expect(screen.getByText(/Son ölçmə: /)).toBeInTheDocument();
      expect(screen.getByText("Gecikmiş kanal: 1")).toBeInTheDocument();
    });

    it("counts no overdue channel on a board that is not LIVE", () => {
      // The count is the snapshot's timestamps aged against a clock that keeps moving, and off
      // LIVE the snapshot is never reloaded (only the stream's onOpen reloads it). So through an
      // outage every card would grow an amber "Gecikmiş kanal: N" and go on growing it —
      // reporting OUR lost connection as the ward's dead monitors, which is the one way a
      // feed-health indicator can do harm. `FeedHealth` suppresses the ward chip off LIVE for
      // exactly this reason (screens/common/BoardState.jsx); the per-card count was not gated at
      // all. `BoardStrip` is what speaks about the connection.
      const raw = entry("S-001", [], {
        at: { heart_rate: ago(30), spo2: ago(4_000) },
        vitals: { heart_rate: 78, spo2: 96 },
      });
      card(raw, CONNECTION.DEGRADED);
      expect(screen.queryByText(/Gecikmiş kanal/)).toBeNull();
      // The last-measured instant is a fact the server sent and stays: it is not aged against
      // anything, so an outage cannot make it drift.
      expect(screen.getByText(/Son ölçmə: /)).toBeInTheDocument();
    });
  });

  // The board's card carries the score line and the flags; NEWS2's caveats, the alarms' own words and
  // the shadow's tag are the patient page's (owner, 2026-11-14: no details on the card).
  describe("the score line and the flags", () => {
    it("shows the engine's total in the foot line", () => {
      card(entry("S-001", [], { at: measured(30), score: news2({ total: 7 }) }));
      expect(screen.getByText("NEWS2 7")).toBeInTheDocument();
    });

    it("no engine score says so — never a score of the screen's own", () => {
      card(entry("S-001", [], { at: measured(30), vitals: { heart_rate: 78, spo2: 96 } }));
      expect(screen.queryByText(/NEWS2 \d/)).toBeNull();
    });

    it("a partial score is marked", () => {
      card(entry("S-001", [], { at: measured(30), score: news2({ total: 4, partial: true, missing: ["respiration_rate"] }) }));
      expect(screen.getByText("NEWS2 4 · qismən")).toBeInTheDocument();
    });

    it("a red parameter is stated as a fact and does NOT change the engine's level", () => {
      const { container } = card(entry("S-001", [], { risk: "low", at: measured(30), score: news2({ total: 5, red_param: true }) }));
      expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument();
      expect(container.querySelector("[data-rail]")).toHaveAttribute("data-rail", "low");
    });

    it("counts the open alarms in a flag, and an acknowledged one leaves it", () => {
      card(entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7" })], { at: measured(30), risk: "high" }));
      expect(screen.getByText("1 siqnal")).toBeInTheDocument();
      cleanup();
      card(entry("S-001", [alarm("news2", "high", { acknowledged: true, acknowledged_by: "ayse" })], { at: measured(30) }));
      expect(screen.queryByText(/siqnal/)).toBeNull();
    });

    // G2-A1 (O17): the engine computes `risk` from the alarms that still FIRE, so a bed whose only
    // alarm is a critical that passed unacknowledged is drawn calm; the flag says why.
    it("flags a critical that passed unacknowledged, with the alarms screen's words", () => {
      card(entry("S-001", [alarm("septic_shock", "critical", { summary: "Septic shock criteria met", resolved_at: ago(60) })], { at: measured(30) }));
      expect(screen.getByText("keçdi · təsdiqlənməyib")).toBeInTheDocument();
    });

    it("draws neither the alarms' words nor NEWS2's caveats — the patient page does", () => {
      card(entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7" })], {
        at: measured(30), score: news2({ total: 4, partial: true, stale: ["spo2"], measured_at: { spo2: ago(7200) } }),
      }));
      expect(screen.queryByText("NEWS2 7")).toBeNull();
      expect(screen.queryByText(/köhnə məlumat/)).toBeNull();
      expect(document.querySelector("details")).toBeNull();
    });
  });

  describe("where the identity came from", () => {
    it("says the HIS sent it, and when", () => {
      card(entry("S-001", [], { identity: identity({ updated_at: ago(600) }), at: measured(30) }));
      expect(screen.getByText("XMİS")).toBeInTheDocument();
    });

    it("says there is no identity record for a device-only card", () => {
      card(entry("S-002", [], { at: measured(30) }));
      expect(screen.getByText("Kimlik qeydi yoxdur")).toBeInTheDocument();
    });

    it("says a discharged patient is discharged", () => {
      card(entry("S-001", [], { identity: identity({ state: "discharged" }), at: measured(30) }));
      expect(screen.getByText(/Evə yazılıb/)).toBeInTheDocument();
    });

    it("names the HIS location a bed table does not cover — the line an operator must add", () => {
      card(entry("S-001", [], {
        identity: identity({ bed_id: null, unit_id: null, bed_matched: false, bed_key: "REA^999^9" }),
        at: measured(30),
      }));
      expect(screen.getByText("Çarpayı uyğunlaşmadı · REA^999^9")).toBeInTheDocument();
    });

    it("a matched bed says nothing about matching", () => {
      card(entry("S-001", [], { identity: identity(), at: measured(30) }));
      expect(screen.queryByText(/uyğunlaşmadı/)).toBeNull();
    });
  });
});

describe("the bed card — the monitor strip", () => {
  const STRIP = { entry: monitorBed("REA-01 · 2", [monitorParam("hr", 72)], { link: "one", patient_id: "S-001" }),
    nowMs: NOW, fetchedAtMs: NOW, maxAgeS: 15, feedOk: true };

  function withStrip(monitor) {
    const patient = patientFromBoard(entry("S-001", [], { identity: identity(), at: measured(30) }));
    return render(
      <I18nProvider>
        <ul><BedCard patient={patient} alerts={[]} nowMs={NOW} connection={CONNECTION.LIVE} monitor={monitor} /></ul>
      </I18nProvider>,
    );
  }

  // Owner, 2026-11-14: the monitor's numbers on the card's row, as the prototype shows them — marked M,
  // hidden from what the link says, and never in place of a validated value.
  it("fills the row's empty channels with the monitor's values, marked M, outside what the link says", () => {
    withStrip(STRIP);
    const link = screen.getByRole("link", { name: "REA-01 · 2 xəstəsini aç" });
    const marked = link.querySelector("[data-monitor-value]");
    expect(marked).toHaveTextContent("72M");
    expect(marked.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("keeps a validated value over the monitor's", () => {
    const patient = patientFromBoard(entry("S-001", [], { identity: identity(), ...reading({ heart_rate: 88 }, 30) }));
    render(<I18nProvider><ul><BedCard patient={patient} alerts={[]} nowMs={NOW} connection={CONNECTION.LIVE} monitor={STRIP} /></ul></I18nProvider>);
    const link = screen.getByRole("link", { name: "REA-01 · 2 xəstəsini aç" });
    const hr = within(link).getByText("HR").nextElementSibling;
    expect(hr).toHaveTextContent(/^88$/);
    expect(hr.querySelector("[data-monitor-value]")).toBeNull();
  });

  it("draws none without one", () => {
    const { container } = withStrip(undefined);
    expect(container.querySelector("[data-monitor-strip]")).toBeNull();
  });

  it("draws no strip on the card — its values are on the row, the strip is the patient page's", () => {
    withStrip(STRIP);
    expect(document.querySelector("[data-monitor-strip]")).toBeNull();
  });
});

// Aşama B (D7): the shadow engine's one-line answer on a monitor-linked bed — an amber tag in the monitor
// slot, outside the patient link, never a risk pill, never a row among the alarms.
describe("the card's line (sparkPoints)", () => {
  const trail = [{ ms: 1, value: 80 }, { ms: 2, value: 92 }];
  it("takes the monitor's trail when the engine has fewer than two readings, and says so", () => {
    expect(sparkPoints([{ ms: 1, value: 70 }], trail)).toEqual({ pts: trail, fromMonitor: true });
  });
  it("keeps the validated trend over the monitor's trail", () => {
    const valid = [{ ms: 1, value: 70 }, { ms: 2, value: 75 }];
    expect(sparkPoints(valid, trail)).toEqual({ pts: valid, fromMonitor: false });
  });
});

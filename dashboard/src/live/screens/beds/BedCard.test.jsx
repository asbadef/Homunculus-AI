import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { CONNECTION } from "../../../liveConnection.js";
import { patientFromBoard, alertsFromPatients } from "../../../liveAdapters.js";
import { NOW, ago, alarm, entry, identity, measured, news2, reading } from "../../data/board.testutil.js";
import { bed as monitorBed, param as monitorParam } from "../../data/shadow.testutil.js";
import { BedCard } from "./BedCard.jsx";

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
    it("shows the channels that have a value, with their units", () => {
      card(entry("S-001", [], { ...reading({ heart_rate: 118, spo2: 91, resp_rate: 26, map: 58, sbp: 92, temperature: 38.4 }, 30) }));
      expect(screen.getByText("118")).toBeInTheDocument();
      expect(screen.getByText("91")).toBeInTheDocument();
      expect(screen.getByText("Nəbz")).toBeInTheDocument();
      expect(screen.getAllByText("mmHg")).toHaveLength(2);     // systolic and mean
    });

    it("a measured 0 is a finding, not a missing value", () => {
      card(entry("S-001", [], { at: measured(30), vitals: { resp_rate: 0 } }));
      expect(screen.getByText("0")).toBeInTheDocument();
    });

    it("a channel with no value is left out rather than printed as a dash", () => {
      const { container } = card(entry("S-001", [], { at: measured(30), vitals: { heart_rate: 78 } }));
      expect(container.querySelectorAll("dl dt")).toHaveLength(1);
      expect(screen.queryByText("SpO2")).toBeNull();
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

  describe("NEWS2", () => {
    it("shows the engine's total", () => {
      card(entry("S-001", [], { at: measured(30), score: news2({ total: 7 }) }));
      expect(screen.getByText("NEWS2:")).toBeInTheDocument();
      expect(screen.getByText("7")).toBeInTheDocument();
    });

    it("no engine score is a dash with the reason — never a score of the screen's own", () => {
      card(entry("S-001", [], { at: measured(30), vitals: { heart_rate: 78, spo2: 96 } }));
      expect(screen.getByText("NEWS2: —")).toBeInTheDocument();
      expect(screen.getByText(/ekran öz hesabını aparmır/)).toBeInTheDocument();
    });

    it("a partial score is marked, with the unmeasured parameters read out", () => {
      card(entry("S-001", [], {
        at: measured(30),
        score: news2({ total: 4, partial: true, missing: ["respiration_rate", "temperature"] }),
      }));
      expect(screen.getByText(/qismən/)).toBeInTheDocument();
      expect(screen.getByText(/tənəffüs tezliyi, temperatur/)).toBeInTheDocument();
    });

    it("a red parameter is stated as a fact and does NOT change the engine's level", () => {
      // The engine may legitimately send "low" with red_param true (patient_relative lowers a
      // NEWS2 alert the patient's charted chronic normal explains). The screen reports both.
      const { container } = card(entry("S-001", [], {
        risk: "low", at: measured(30), score: news2({ total: 5, red_param: true }),
      }));
      expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument();
      expect(screen.getByText("Aşağı")).toBeInTheDocument();
      expect(container.querySelector("[data-rail]")).toHaveAttribute("data-rail", "low");
    });

    // G2-A2 (D10): the engine names what it left out of the total (`stale`) and what it scored as
    // room air and Alert (`assumed`). The card prints each stale input's age from the engine's
    // stamp (`measured_at`) and judges nothing itself.
    it("names a stale input with its age, from the engine's stamp", () => {
      card(entry("S-001", [], {
        at: measured(30),
        score: news2({ total: 4, partial: true, stale: ["spo2", "temperature"],
          measured_at: { spo2: ago(7200), temperature: ago(7500) } }),
      }));
      expect(screen.getByText("köhnə məlumat: SpO2 · 2 saat əvvəl, temperatur · 3 saat əvvəl")).toBeInTheDocument();
      expect(screen.getByText(/Pəncərəsini keçmiş ölçmə bala daxil edilmir/)).toBeInTheDocument();
    });

    it("marks the assumed inputs, and names an expired chart's last value and when it was made", () => {
      // X11: «assumed: room air» alone hid that the patient was last charted on oxygen.
      card(entry("S-001", [], {
        at: measured(30),
        score: news2({ assumed: ["air_or_oxygen", "consciousness"], measured_at: { air_or_oxygen: ago(9 * 3600) },
          last_charted: { air_or_oxygen: 1, consciousness: null } }),
      }));
      const pill = screen.getByText("fərz edildi: otaq havası (son qeyd: oksigendə, 9 saat əvvəl), oyaq");
      expect(screen.getByText("(heç qeyd edilməyib)")).toBeInTheDocument();   // consciousness, read out
      // The whole sentence as a reader gets it: the assumed values, the screen-reader-only «never
      // charted», and the hint that says why this is not a warning.
      expect(pill).toHaveTextContent(
        "fərz edildi: otaq havası (son qeyd: oksigendə, 9 saat əvvəl), oyaq (heç qeyd edilməyib) · "
        + "Cari qeyd yoxdur; bal bu girişi standart dəyərlə hesabladı və bunu qismən saymır.",
      );
      expect(pill).toHaveAttribute("data-tone", "neutral");
      // StatusPill is nowrap + uppercase and the bed card clips its overflow: on a 290 px card an
      // unwrapped pill cuts off the assumed consciousness, the very mark D10 asks for.
      expect(pill).toHaveClass("!whitespace-normal");
      expect(screen.queryByText("qismən")).toBeNull();                         // an assumption is not partial
    });

    it("names an expired ACVPU by its letter — in Turkish, the owner's wording", () => {
      localStorage.setItem("hmc.lang", "tr");
      try {
        card(entry("S-001", [], {
          at: measured(30),
          score: news2({ assumed: ["air_or_oxygen", "consciousness"],
            measured_at: { air_or_oxygen: ago(9 * 3600), consciousness: ago(9 * 3600) },
            last_charted: { air_or_oxygen: 1, consciousness: "U" } }),
        }));
        expect(screen.getByText(
          "varsayıldı: oda havası (son kayıt: oksijende, 9 sa önce), uyanık (son kayıt: U, 9 sa önce)",
        )).toBeInTheDocument();
      } finally {
        localStorage.removeItem("hmc.lang");
      }
    });

    it("an expired chart whose last value the payload lacks still says when it was made", () => {
      card(entry("S-001", [], {
        at: measured(30),
        score: news2({ assumed: ["air_or_oxygen"], measured_at: { air_or_oxygen: ago(9 * 3600) },
          last_charted: undefined }),
      }));
      expect(screen.getByText("fərz edildi: otaq havası (son qeyd 9 saat əvvəl)")).toBeInTheDocument();
    });

    it("says nothing more when nothing is stale or assumed", () => {
      card(entry("S-001", [], { at: measured(30), score: news2({ total: 2 }) }));
      expect(screen.queryByText(/köhnə məlumat/)).toBeNull();
      expect(screen.queryByText(/fərz edildi/)).toBeNull();
    });
  });

  describe("the open alarms", () => {
    it("puts the open alarms on the card, with the engine's own summary", () => {
      card(entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7" })], { at: measured(30), risk: "high" }));
      expect(screen.getByText("NEWS2 7")).toBeInTheDocument();
    });

    it("an acknowledged alarm leaves the card's own list", () => {
      card(entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7", acknowledged: true, acknowledged_by: "ayse" })], { at: measured(30) }));
      expect(screen.queryByText("NEWS2 7")).toBeNull();
    });

    // G2-A1 (O17): the engine computes `risk` from the alarms that still FIRE, so a bed whose only
    // alarm is a critical that passed unacknowledged is drawn calm — and its card still lists the
    // critical line. The badge is what says why; without it the card contradicts itself.
    it("keeps a critical that passed unacknowledged on the card, with the badge the alarms screen gives it", () => {
      card(entry("S-001", [
        alarm("news2", "high", { summary: "NEWS2 7" }),
        alarm("septic_shock", "critical", { summary: "Septic shock criteria met", resolved_at: ago(60) }),
      ], { at: measured(30) }));
      const line = screen.getByText("Septic shock criteria met").closest("li");
      expect(within(line).getByText("keçdi · təsdiqlənməyib")).toBeInTheDocument();
      // Only the latched line carries it: the one that still fires does not.
      expect(screen.getAllByText("keçdi · təsdiqlənməyib")).toHaveLength(1);
      expect(within(screen.getByText("NEWS2 7").closest("li")).queryByText("keçdi · təsdiqlənməyib")).toBeNull();
    });

    it("an alarm with severity \"none\" can never read \"no finding\"", () => {
      // "none" is a PATIENT's risk — "no alarm at all" — and never an alarm's own severity.
      card(entry("S-001", [alarm("other", "none", { summary: "ölçüt" })], { risk: "info", at: measured(30) }));
      expect(screen.queryByText("Tapıntı yoxdur")).toBeNull();
      expect(screen.getByText("Risk bildirilməyib")).toBeInTheDocument();
      expect(screen.getByText("Məlumat")).toBeInTheDocument();
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

describe("the bed card reconciles a downgraded level at a glance", () => {
  // The hazard this closes: the engine can send risk "low" with red_param true, because
  // patient_relative lowers a NEWS2 alert when the patient's charted chronic normal explains every
  // contributor. Before this, the card showed "Aşağı" beside "a parameter scored 3" with nothing
  // reconciling them, so a clinician had to open the patient to tell a justified low from an
  // engine fault.
  it("marks a downgraded finding chronic-expected, with the engine's reason in its name", () => {
    card(entry("S-001", [alarm("news2", "low", { downgraded: true,
        chronic_context: "Chronic oxygen therapy explains the SpO2." })], { risk: "low", at: measured(30), score: news2({ total: 5, red_param: true }) }));
    expect(screen.getByText("Xəstənin öz normasına görə gözlənilən")).toBeInTheDocument();
    expect(screen.getByText(/Chronic oxygen therapy explains the SpO2/)).toBeInTheDocument();
    // Both facts still stand, and neither is overridden. (Two pills read "Aşağı": the patient's
    // own risk and the finding's severity.)
    expect(screen.getAllByText("Aşağı")).toHaveLength(2);
    expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument();
  });

  it("the pill is NEUTRAL, not the attention look — it is an explanation, not a warning", () => {
    const { container } = card(entry("S-001", [alarm("news2", "low", { downgraded: true, chronic_context: "Chronic AF." })], { risk: "low", at: measured(30) }));
    const pill = screen.getByText("Xəstənin öz normasına görə gözlənilən").closest("[data-tone]");
    expect(pill).toHaveAttribute("data-tone", "neutral");
    expect(container.querySelector("[data-tone='att']")).toBeNull();
  });

  it("an ordinary finding carries no such pill", () => {
    card(entry("S-001", [alarm("news2")], { risk: "high", at: measured(30) }));
    expect(screen.queryByText("Xəstənin öz normasına görə gözlənilən")).toBeNull();
  });

  it("marks the engine's summary as English, and says so once", () => {
    card(entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7" })], { risk: "high", at: measured(30) }));
    expect(screen.getByText("NEWS2 7")).toHaveAttribute("lang", "en");
    expect(screen.getByText("Mühərrikin mətnləri İngiliscədir; tərcümə olunmayıb.")).toBeInTheDocument();
  });

  it("a card with no alarm says nothing about English", () => {
    card(entry("S-001", [], { at: measured(30) }));
    expect(screen.queryByText(/İngiliscədir/)).toBeNull();
  });
});

// Aşama A: a strip only on a card the API links to this patient (`link: "one"`), drawn after the
// card's link so that a monitor value is never part of what opening the patient reads out.
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

  it("draws none without one", () => {
    const { container } = withStrip(undefined);
    expect(container.querySelector("[data-monitor-strip]")).toBeNull();
  });

  it("draws the compact strip after the patient link, outside it", () => {
    withStrip(STRIP);
    const strip = screen.getByRole("region", { name: "Monitor · təsdiqlənməmiş" });
    const link = screen.getByRole("link", { name: "REA-01 · 2 xəstəsini aç" });
    expect(link.contains(strip)).toBe(false);
    expect(link.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip).toHaveTextContent("72");
    expect(strip).toHaveTextContent("Tədqiqat deşifrəsi · qərar üçün ölçmə deyil · siqnal yaratmır");
  });
});

// Aşama B (D7): the shadow engine's one-line answer on a monitor-linked bed — an amber tag in the monitor
// slot, outside the patient link, never a risk pill, never a row among the alarms.
describe("the bed card — the shadow tag", () => {
  const FINDING = { kind: "news2", severity: "high", urgency: "immediate", summary: "NEWS2 6 on the monitor's inputs",
    evidence: [], relation: "shadow_only", stale_inputs: [], downgraded: false, since: null };
  const shadowOf = (over = {}) => ({ news2: { total: 6, partial: false }, vitals: {}, findings: [FINDING], ...over });
  const STRIP = { entry: monitorBed("REA-01 · 2", [monitorParam("hr", 72)], { link: "one", patient_id: "S-001" }),
    nowMs: NOW, fetchedAtMs: NOW, maxAgeS: 15, feedOk: true };

  function withShadow(shadow, { monitor, alarms = [], connection = CONNECTION.LIVE, nowMs = NOW } = {}) {
    const patient = patientFromBoard(entry("S-001", alarms, { identity: identity(), at: measured(30), shadow }));
    return render(
      <I18nProvider>
        <ul><BedCard patient={patient} alerts={alertsFromPatients([patient])} nowMs={nowMs} connection={connection} monitor={monitor} /></ul>
      </I18nProvider>,
    );
  }
  const input = (at, via = "hr") => ({ value: 140, unit: "bpm", at, source: "monitor", via });
  const tag = () => document.querySelector("[data-shadow-tag]");
  afterEach(() => localStorage.clear());

  it("says «shadow advice · NEWS2 n» in amber when the shadow has a finding", () => {
    withShadow(shadowOf(), { monitor: STRIP });
    expect(tag()).toHaveTextContent("kölgə tövsiyə · NEWS2 6");
    expect(tag().querySelector("[data-tone]")).toHaveAttribute("data-tone", "warn");
  });

  it("says «no shadow advice», in the same amber, when it has none", () => {
    withShadow(shadowOf({ findings: [] }), { monitor: STRIP });
    expect(tag()).toHaveTextContent("kölgə tövsiyə yoxdur");
    expect(tag().querySelector("[data-tone]")).toHaveAttribute("data-tone", "warn");
    expect(tag()).not.toHaveTextContent("NEWS2");
  });

  it("writes a dash for a NEWS2 total the engine did not send, never a made-up number", () => {
    withShadow(shadowOf({ news2: null }));
    expect(tag()).toHaveTextContent("kölgə tövsiyə · NEWS2 —");
    cleanup();
    withShadow(shadowOf({ news2: { total: 0, partial: false } }));
    expect(tag()).toHaveTextContent("kölgə tövsiyə · NEWS2 0");       // a measured 0 is a number
  });

  it("treats a shadow with no findings key as having none", () => {
    withShadow({ news2: { total: 3 }, vitals: {} });
    expect(tag()).toHaveTextContent("kölgə tövsiyə yoxdur");
  });

  it("sits in the monitor slot, after the strip and outside the patient link", () => {
    withShadow(shadowOf(), { monitor: STRIP });
    const slot = document.querySelector("[data-monitor-slot]");
    const strip = screen.getByRole("region", { name: "Monitor · təsdiqlənməmiş" });
    const link = screen.getByRole("link", { name: "REA-01 · 2 xəstəsini aç" });
    expect(slot.contains(strip)).toBe(true);
    expect(slot.contains(tag())).toBe(true);
    expect(strip.compareDocumentPosition(tag()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.contains(tag())).toBe(false);
    expect(strip.contains(tag())).toBe(false);
  });

  it("still shows the tag, in the slot, when the strip is momentarily not there", () => {
    withShadow(shadowOf(), { monitor: undefined });
    expect(tag()).toHaveTextContent("kölgə tövsiyə · NEWS2 6");
    expect(document.querySelector("[data-monitor-slot]").contains(tag())).toBe(true);
    expect(document.querySelector("[data-monitor-strip]")).toBeNull();
  });

  it("shows nothing — no tag and no empty slot — without a shadow", () => {
    for (const shadow of [null, undefined]) {
      withShadow(shadow);
      expect(tag()).toBeNull();
      expect(document.querySelector("[data-monitor-slot]")).toBeNull();
      cleanup();
    }
    withShadow(null, { monitor: STRIP });
    expect(tag()).toBeNull();
    expect(document.querySelector("[data-monitor-slot]")).not.toBeNull();     // the strip's own slot, as before
  });

  it("changes nothing the card says about the patient: the risk pill, the alarm rows and the NEWS2 are the same with or without it", () => {
    const alarms = [alarm("septic_shock", "critical", { summary: "Septik şok ölçütləri qarşılandı" })];
    const link = () => screen.getByRole("link", { name: "REA-01 · 2 xəstəsini aç" });
    withShadow(null, { alarms });
    const without = link().textContent;
    const rail = document.querySelector("[data-rail]").getAttribute("data-rail");
    cleanup();
    withShadow(shadowOf(), { monitor: STRIP, alarms });
    expect(link().textContent).toBe(without);
    expect(document.querySelector("[data-rail]").getAttribute("data-rail")).toBe(rail);
    expect(without).toContain("Kritik");
    expect(within(link()).getByText("Septik şok ölçütləri qarşılandı")).toHaveAttribute("lang", "en");
    // The shadow's own finding is not a row among the alarms, nor a pill.
    expect(screen.queryByText("NEWS2 6 on the monitor's inputs")).toBeNull();
    expect(tag().closest("a")).toBeNull();
  });

  it("is worded in each language", () => {
    withShadow(shadowOf());
    const az = tag().textContent;
    cleanup();
    localStorage.setItem("hmc.lang", "ru");
    withShadow(shadowOf());
    expect(tag()).toHaveTextContent("теневая рекомендация · NEWS2 6");
    expect(tag().textContent).not.toBe(az);
    cleanup();
    withShadow(shadowOf({ vitals: { heart_rate: input(ago(120)) } }));
    expect(tag()).toHaveTextContent("теневая рекомендация · NEWS2 6 · 2 мин назад");
    cleanup();
    withShadow(shadowOf({ findings: [] }), { connection: CONNECTION.DEGRADED });
    expect(tag()).toHaveTextContent("теневая рекомендация · неизвестно");
    localStorage.clear();
  });

  // A held score: the API republishes a patient only when a sample is taken or a link ends, so with a
  // silent forwarder the tag would read the same number for as long as nobody looks. Its newest input's
  // age goes with it, on the card's own clock.
  it("ages the score by its newest input — «… · NEWS2 n · age» — and prints no age with no input", () => {
    withShadow(shadowOf({ vitals: { heart_rate: input(ago(300)), sbp: input(ago(120), "art"), spo2: input("not a time", "spo2") } }));
    expect(tag()).toHaveTextContent("kölgə tövsiyə · NEWS2 6 · 2 dəq əvvəl");
    expect(tag().textContent).not.toMatch(/NaN/);
    cleanup();
    withShadow(shadowOf({ vitals: { heart_rate: input(ago(300)) } }), { nowMs: NOW + 3_600_000 });
    expect(tag()).toHaveTextContent("kölgə tövsiyə · NEWS2 6 · 65 dəq əvvəl");   // the card's clock, not a frozen stamp
    cleanup();
    withShadow(shadowOf({ vitals: {} }));
    expect(tag()).toHaveTextContent("kölgə tövsiyə · NEWS2 6");
    expect(tag().textContent).not.toMatch(/əvvəl|·\s*$/);
  });

  it("says «unknown», never «no shadow advice», when the board is not live — and still shows a score it holds", () => {
    for (const connection of [CONNECTION.DEGRADED, CONNECTION.CONNECTING, CONNECTION.UNAVAILABLE]) {
      withShadow(shadowOf({ findings: [] }), { connection });
      expect(tag(), connection).toHaveTextContent("kölgə tövsiyə · bilinmir");
      expect(tag().textContent, connection).not.toContain("yoxdur");
      expect(tag().querySelector("[data-tone]")).toHaveAttribute("data-tone", "warn");
      cleanup();
    }
    withShadow(shadowOf({ vitals: { heart_rate: input(ago(120)) } }), { connection: CONNECTION.DEGRADED });
    expect(tag()).toHaveTextContent("kölgə tövsiyə · NEWS2 6 · 2 dəq əvvəl");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { onlyScreens } from "../../shell/screens.testutil.js";
import { NOW, ago, alarm, board, entry, identity, measured, news2 } from "../../data/board.testutil.js";
import { STAGE_OFF, bed as monitorBed, param as monitorParam, strip } from "../../data/shadow.testutil.js";
import { hhmm } from "../../i18n/dates.js";
import { answering, channel, point, trends } from "./trends/trends.testutil.js";
import { PatientScreen } from "./PatientScreen.jsx";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function open({ payload = board(), id = "S-001", connection = "live", setup,
                      perms = ["board.view", "alerts.ack"] } = {}) {
  onlyScreens({ beds: () => null }, { keep: [] });
  const mounted = await mount(<PatientScreen params={{ id }} />, {
    access: token({ perms }),
    me: profile({ perms }),
    setup: (api) => {
      if (connection === "unavailable") api.boardPatients.mockRejectedValue(new Error("down"));
      else api.boardPatients.mockResolvedValue(payload);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.view.mockResolvedValue({ ok: true });
      api.patientTrends.mockImplementation(answering());     // empty channels, for whoever is asked
      setup?.(api);
    },
  });
  const { board: store, stream } = mounted;
  await act(async () => { await store.start(); });
  if (connection !== "unavailable") {
    await act(async () => { stream.open(); await settle(); });
    if (connection === "degraded") act(() => { stream.drop(); });
  }
  await act(async () => { await settle(); });
  return mounted;
}

const FULL = {
  identity: identity(),
  at: measured(90),
  vitals: { heart_rate: 118, spo2: 91, resp_rate: 26, sbp: 92, map: 58, temperature: 38.4 },
  lactate: 4.1,
  sofa: 7,
  score: news2({ total: 9, red_param: true }),
  risk: "critical",
};

beforeEach(() => vi.setSystemTime(NOW));
afterEach(() => {
  resetScreens();
  vi.useRealTimers();
});

describe("the patient screen", () => {
  it("names the bed and the patient, and says the two things it writes", async () => {
    await open({ payload: board([entry("S-001", [], FULL)]) });
    expect(screen.getByRole("heading", { level: 1, name: "Ayşe Sentetik" })).toBeInTheDocument();
    // One h1 and no more: the shell moves focus to <main> after every move, and the screen's own
    // heading is what a reader lands on.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("REA-01 · 2")).toBeInTheDocument();
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/şübhəli infeksiya işarəsi və xəstənin norması/);
  });

  it("offers the way back to the board it was opened from", async () => {
    await open({ payload: board([entry("S-001", [], FULL)]) });
    expect(screen.getByRole("link", { name: /Çarpayılara qayıt/ })).toHaveAttribute("href", "#/beds");
  });

  it("a patient the HIS has not named says what is missing", async () => {
    await open({ payload: board([entry("S-001", [], { at: measured(30) })]) });
    expect(screen.getByRole("heading", { level: 1, name: "kimlik gözlənilir" })).toBeInTheDocument();
  });

  describe("the measured values", () => {
    // The trend cards below name the same channels, so these read the measured-values box only.
    const vitalsBox = () => within(screen.getByRole("heading", { level: 2, name: "Ölçülən dəyərlər" }).closest(".rounded-box"));

    it("shows each channel with its value, its unit, its clock time and its age", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(vitalsBox().getByText("118")).toBeInTheDocument();
      expect(vitalsBox().getByText("Nəbz")).toBeInTheDocument();
      // Every vital's age is visible — the gap the old workspace never closed.
      expect(vitalsBox().getAllByText(/2 dəq əvvəl/).length).toBeGreaterThan(0);
    });

    it("a channel with no value is left out, and a card with none says so once", async () => {
      await open({ payload: board([entry("S-001", [], { identity: identity() })]) });
      expect(vitalsBox().getByText("Bu çarpayıdan heç bir ölçmə gəlməyib.")).toBeInTheDocument();
      expect(vitalsBox().queryByText("Nəbz")).toBeNull();
    });

    it("ages a reading against the SERVER's clock, not this browser's", async () => {
      // The screen must call `useBoardNow`, never `useNow` (Decision 10): the engine timestamps a
      // reading by its own clock, so a ward tablet with a wrong one ages every reading wrongly —
      // and for half of all wrong clocks it ages them DOWNWARDS, drawing a four-hour-old pressure
      // as "6 dəq". Nothing failed if the two were swapped, which left a safety property resting
      // on the import line being right.
      //
      // Here the server is ten minutes ahead of the browser, so a reading taken 90 s before the
      // BROWSER's now is 11.5 minutes old by the SERVER's, and `ageParts` ceils to 12.
      await open({
        payload: board([entry("S-001", [], FULL)]),
        setup: (api) => api.serverClockSkewMs.mockReturnValue(10 * 60_000),
      });
      expect(screen.getAllByText(/12 dəq əvvəl/).length).toBeGreaterThan(0);
      // `\b`, because an unanchored /2 dəq/ matches inside "12 dəq" and the negative assertion
      // would have passed for the very state it is meant to rule out.
      expect(screen.queryByText(/\b2 dəq əvvəl/)).toBeNull();
    });

    it("a lactate is shown with the monitor channels — septic shock turns on it", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(vitalsBox().getByText("4.1")).toBeInTheDocument();
      expect(vitalsBox().getByText("Laktat")).toBeInTheDocument();
    });
  });

  describe("what the engine found", () => {
    const reasoned = alarm("septic_shock", "critical", { summary: "Septik şok ölçütleri karşılandı",
      clinical_reasoning: "MAP 58 on a vasopressor with lactate 4.1 mmol/L after fluids.",
      supporting_evidence: ["sepsis-3-jama-2016", "surviving-sepsis-campaign-2021"],
      recommended_actions: ["Review the patient and the supporting evidence."],
      confidence: "Criteria are deterministic (Sepsis-3).",
      stale_inputs: ["lactate"] });

    it("shows the engine's reasoning, its sources, its suggestions and its certainty", async () => {
      await open({ payload: board([entry("S-001", [reasoned], { ...FULL })]) });
      const card = screen.getByRole("heading", { level: 3, name: "Septik şok ölçütleri karşılandı" }).closest("li");
      expect(card).toHaveTextContent("MAP 58 on a vasopressor");
      expect(card).toHaveTextContent("sepsis-3-jama-2016, surviving-sepsis-campaign-2021");
      expect(card).toHaveTextContent("Review the patient and the supporting evidence.");
      expect(card).toHaveTextContent("Criteria are deterministic (Sepsis-3).");
    });

    it("keeps the product's register: a review is suggested, the decision is the physician's", async () => {
      await open({ payload: board([entry("S-001", [reasoned], { ...FULL })]) });
      expect(screen.getByText("Qiymətləndirmə tövsiyə olunur · qərar həkimindir.")).toBeInTheDocument();
    });

    it("marks the engine's own prose as English, since it is not translated", async () => {
      await open({ payload: board([entry("S-001", [reasoned], { ...FULL })]) });
      const card = screen.getByRole("heading", { level: 3, name: /Septik şok/ }).closest("li");
      expect(card.querySelector('[lang="en"]')).toBeInTheDocument();
      expect(screen.getByText(/İngiliscədir; tərcümə olunmayıb/)).toBeInTheDocument();
    });

    it("says which inputs the engine already judged stale", async () => {
      await open({ payload: board([entry("S-001", [reasoned], { ...FULL })]) });
      expect(screen.getByText("Köhnə giriş: lactate")).toBeInTheDocument();
    });

    // The escalation pill's TEXT, not merely its presence. `board.escalated` was covered by no test
    // on any branch (../w3-fixup.md): while it lived in the alarms arm's namespace this screen
    // printed the literal key "alarms.escalated" on a branch without that arm, and every suite
    // stayed green — `t()` returns the key when it is missing, which throws and logs nothing. The
    // systemic sweep is `src/live/rawKeys.test.jsx`; this is the one assertion that pins the pill a
    // reader actually meets here.
    it("says a finding was escalated, in words rather than in a key", async () => {
      await open({ payload: board([entry("S-001", [alarm("news2", "high", { escalated: true })], { ...FULL })]) });
      expect(screen.getByText("Eskalasiya edilib")).toBeInTheDocument();
    });

    it("says when the patient's own charted normal lowered a finding, and why", async () => {
      await open({ payload: board([entry("S-001", [alarm("news2", "low", { downgraded: true, chronic_context: "Chronic oxygen therapy explains the SpO2." })], { ...FULL, risk: "low" })]) });
      expect(screen.getByText("Xəstənin öz normasına görə aşağı salınıb")).toBeInTheDocument();
      expect(screen.getByText("Chronic oxygen therapy explains the SpO2.")).toBeInTheDocument();
    });

    it("only a LIVE board says the engine found nothing", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText("Mühərrik bu xəstə üçün açıq tapıntı bildirmir.")).toBeInTheDocument();
    });

    it("a board that may be out of date does NOT say the engine found nothing", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]), connection: "degraded" });
      expect(screen.queryByText("Mühərrik bu xəstə üçün açıq tapıntı bildirmir.")).toBeNull();
      expect(screen.getByText("Panel güncəl deyil; mühərrikin tapıntıları natamam ola bilər.")).toBeInTheDocument();
    });

    it("a finding whose severity is \"none\" can never read \"no finding\"", async () => {
      await open({ payload: board([entry("S-001", [alarm("x", "none")], { ...FULL })]) });
      expect(screen.queryByText("Tapıntı yoxdur")).toBeNull();
    });
  });

  describe("NEWS2 and the Sepsis-3 context", () => {
    it("shows the engine's NEWS2 and states a red parameter as a fact", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText("9")).toBeInTheDocument();
      expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument();
    });

    it("says nobody has charted a suspected infection — the sepsis rule then never runs", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText(/heç kim işarələməyib/)).toBeInTheDocument();
    });

    it("tells a charted \"no\" from an unanswered one", async () => {
      await open({ payload: board([entry("S-001", [], {
        ...FULL, sepsis: { suspected_infection: false, sofa: 7, baseline_sofa: 2, baseline_assumed: false, rise: 5 },
      })]) });
      expect(screen.getByText("Şübhəli infeksiya: yoxdur (həkim işarələyib).")).toBeInTheDocument();
      expect(screen.queryByText(/heç kim işarələməyib/)).toBeNull();
      expect(screen.queryByText(/mühərrik 0 fərz edir/)).toBeNull();
    });

    it("puts the SOFA, the baseline and the RISE each under its own label", async () => {
      // The rise is what the Sepsis-3 criterion turns on (≥2 points over baseline), so reading it
      // as the baseline, or the baseline as the rise, is a clinical misreading and not a layout
      // nit. Asserting the <dd> that belongs to each <dt> is the only way to catch it: a test that
      // only looked for the text "5" would pass with all three numbers in one row.
      await open({ payload: board([entry("S-001", [], {
        ...FULL, sepsis: { suspected_infection: true, sofa: 7, baseline_sofa: 2, baseline_assumed: false, rise: 5 },
      })]) });
      const valueFor = (label) => {
        const dt = screen.getByText(label);
        return dt.parentElement.querySelector("dd").textContent;
      };
      expect(valueFor("SOFA")).toBe("7");
      expect(valueFor("Bazal SOFA")).toBe("2");
      expect(valueFor("Artım")).toBe("5");
    });

    it("prints a rise the engine did not send as \"—\", never as sofa minus baseline", async () => {
      // The browser does no clinical arithmetic (Decision 2): 7 − 2 would be the screen's claim,
      // not the engine's, and it would look exactly like the engine's.
      await open({ payload: board([entry("S-001", [], {
        ...FULL, sepsis: { suspected_infection: true, sofa: 7, baseline_sofa: 2, baseline_assumed: false, rise: null },
      })]) });
      const dt = screen.getByText("Artım");
      expect(dt.parentElement.querySelector("dd").textContent).toBe("—");
      expect(screen.queryByText("5")).toBeNull();
    });

    it("says when the baseline SOFA is an assumption rather than a charted number", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText(/mühərrik 0 fərz edir/)).toBeInTheDocument();
    });
  });

  describe("medication and the antibiotic clock", () => {
    it("an unrecorded antibiotic is not shown as one that was not given", async () => {
      await open({ payload: board([entry("S-001", [], {
        ...FULL, meds: { pressors: {}, antibiotic_given: null, antibiotic_at: null, antibiotic_clock: null, weight_kg: null, creatinine: null },
      })]) });
      expect(screen.getByText(/verilmədiyi anlamına gəlmir/)).toBeInTheDocument();
    });

    it("shows when it was given", async () => {
      await open({ payload: board([entry("S-001", [], {
        ...FULL,
        meds: { pressors: { norepinephrine: 0.08 }, antibiotic_given: true, antibiotic_at: ago(600), antibiotic_clock: null, weight_kg: 72, creatinine: 1.9 },
      })]) });
      expect(screen.getByText(/Antibiotik verilib:/)).toBeInTheDocument();
      expect(screen.getByText("Vazopressor/inotrop: norepinephrine 0.08")).toBeInTheDocument();
    });

    // The two branches of the four-valued antibiotic that nothing asserted and the raw-key sweep
    // cannot reach — its fixture takes the "given" arm — even though these are the two that make
    // a claim about a DEADLINE: one says there is still time, the other that it has passed. A key
    // that stopped resolving in either would have printed itself onto a clinical screen.
    const clocked = (clock) => board([entry("S-001", [], {
      ...FULL,
      meds: { pressors: {}, antibiotic_given: false, antibiotic_at: null, antibiotic_clock: clock, weight_kg: null, creatinine: null },
    })]);

    it("says when the antibiotic window is still open", async () => {
      await open({ payload: clocked({ deadline: ago(-900), remaining_sec: 900 }) });
      expect(screen.getByText(/müddət .* tarixində bitir/)).toBeInTheDocument();
      expect(screen.queryByText(/müddəti bitib/)).toBeNull();
    });

    it("says when the antibiotic window has closed", async () => {
      await open({ payload: clocked({ deadline: ago(300), remaining_sec: -300 }) });
      expect(screen.getByText(/Antibiotik müddəti bitib:/)).toBeInTheDocument();
      expect(screen.queryByText(/tarixində bitir/)).toBeNull();
    });

    it("says so when the engine sent no medication block at all", async () => {
      await open({ payload: board([entry("S-001", [], { ...FULL, meds: null })]) });
      expect(screen.getByText("Mühərrik bu xəstə üçün dərman məlumatı göndərməyib.")).toBeInTheDocument();
    });
  });

  describe("the trend charts (Group 2 · slice 1)", () => {
    it("stand where the placeholder stood, after the Sepsis and medication row", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      const trends = screen.getByRole("heading", { level: 2, name: "Vital qrafikləri" });
      const meds = screen.getByRole("heading", { level: 2, name: /Dərman/ });
      expect(meds.compareDocumentPosition(trends) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByText(/Brauzer öz qrafikini uydurmur/)).toBeNull();
      expect(document.querySelector("[data-trends-box]")).not.toBeNull();
    });

    it("keep the forms seam as one note, which no longer promises the patient's normal", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      const seam = screen.getByText(/növbəti qrupda əlavə olunacaq/).closest("[role='note']");
      expect(seam).not.toBeNull();
      expect(seam).toHaveTextContent(/SOFA/);
      expect(seam).not.toHaveTextContent(/norma/);
    });

    it("read the 24-hour trends of the patient the screen shows", async () => {
      const { api } = await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(api.patientTrends).toHaveBeenCalledWith("S-001", 24);
    });

    it("read nothing for a patient the board does not hold", async () => {
      const { api } = await open({ payload: board([entry("S-001", [], FULL)]), id: "S-999" });
      expect(api.patientTrends).not.toHaveBeenCalled();
    });

    it("show six cards, in the bed card's channel order, one list", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      const list = document.querySelector("[data-trends-box] ul");
      expect([...list.children].map((li) => li.querySelector("[data-title]").textContent))
        .toEqual(["Nəbz", "Tənəffüs", "SpO2", "Sistolik AT · MAP", "Bədən hərarəti", "Laktat"]);
      // `list-none` drops the list for VoiceOver unless the role is written out.
      expect(list).toHaveAttribute("role", "list");
    });

    it("frame a card from the engine's points, and age its value against the server's clock", async () => {
      await open({
        payload: board([entry("S-001", [], FULL)]),
        setup: (api) => api.patientTrends.mockImplementation(answering((pid, hours) =>
          trends(pid, [channel("heart_rate", [point(4, 72, 3)])], { hours }))),
      });
      const hr = document.querySelector("[data-trends-box] li [data-frame]");
      expect(hr.dataset.frame).toBe("crit");
      expect(hr).toHaveTextContent("NEWS2 +3");
      expect(hr).toHaveTextContent("4 dəq əvvəl");
    });

    it("open a card's big chart from the card, and give the focus back to it when Escape closes it", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      const hr = screen.getByRole("button", { name: /Nəbz: böyük qrafiki aç/ });
      hr.focus();
      await act(async () => { fireEvent.click(hr); await settle(); });
      expect(screen.getByRole("dialog", { name: "REA-01 · 2 · Ayşe Sentetik · Nəbz" })).toBeInTheDocument();
      await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await settle(); });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(hr);
    });

    // The patient's normal (Task 14): the box offers it, and the form it opens writes through the profile door.
    const CHART = ["board.view", "alerts.ack", "clinical.chart"];
    const FORM = "Xəstənin norması · REA-01 · 2";
    const withNormal = (pid, hours) => trends(pid, [channel("heart_rate", [point(5, 108, 1)],
      { bands: { news2: null, own_normal: { low: 100, high: 115 }, device: null } })], { hours });
    const openNormal = (more) => open({
      payload: board([entry("S-001", [], FULL)]), perms: CHART,
      setup: (api) => {
        api.patientTrends.mockImplementation(answering(withNormal));
        api.putPatientProfile.mockResolvedValue({ patient_id: "S-001" });
        more?.(api);
      },
    });
    const offer = () => screen.getByRole("button", { name: "Xəstənin norması…" });
    const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
    const formButton = (name) => within(screen.getByRole("dialog", { name: FORM })).getByRole("button", { name });
    const toasts = () => within(screen.getByRole("region", { name: "Bildirişlər" }));
    const down = () => Object.assign(new Error("down"), { status: 503 });

    it("offer the patient's normal to nobody without clinical.chart", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.queryByRole("button", { name: "Xəstənin norması…" })).toBeNull();
    });

    it("offer the patient's normal only once the trends have answered: the form replaces the set it was opened on", async () => {
      let release;
      await open({
        payload: board([entry("S-001", [], FULL)]), perms: CHART,
        setup: (api) => api.patientTrends.mockImplementation(() => new Promise((resolve) => { release = resolve; })),
      });
      expect(screen.queryByRole("button", { name: "Xəstənin norması…" })).toBeNull();
      await act(async () => { release(withNormal("S-001", 24)); await settle(); });
      expect(offer()).not.toHaveAttribute("aria-disabled");
    });

    it("offer it to nobody when the first read of the trends failed: there is no set to replace", async () => {
      await open({
        payload: board([entry("S-001", [], FULL)]), perms: CHART,
        setup: (api) => api.patientTrends.mockRejectedValue(down()),
      });
      expect(screen.queryByRole("button", { name: "Xəstənin norması…" })).toBeNull();
    });

    it("open the patient's normal from the box, prefilled from the trends, read them on opening and again after a save", async () => {
      const { api } = await openNormal();
      const before = api.patientTrends.mock.calls.length;
      await press(offer());
      const form = screen.getByRole("dialog", { name: FORM });
      expect(within(form.querySelector("[data-baseline='heart_rate']")).getByLabelText("Nəbz alt")).toHaveValue("100");
      // Opening it reads the trends again: the set it replaces must not be a minute old.
      expect(api.patientTrends.mock.calls.length).toBe(before + 1);
      await press(within(form).getByRole("button", { name: "Yadda saxla" }));
      expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", { baselines: { heart_rate: { low: 100, high: 115 } } });
      expect(api.patientTrends.mock.calls.length).toBe(before + 2);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(toasts().getAllByText("Xəstənin norması yadda saxlanıldı; mühərrik yenidən qiymətləndirdi.").length).toBeGreaterThan(0);
    });

    it("clear every range from the box: an empty set is sent, the toast names the bed, the trends are read again", async () => {
      const { api } = await openNormal();
      await press(offer());
      const form = screen.getByRole("dialog", { name: FORM });
      const row = form.querySelector("[data-baseline='heart_rate']");
      fireEvent.change(within(row).getByLabelText("Nəbz alt"), { target: { value: "" } });
      fireEvent.change(within(row).getByLabelText("Nəbz üst"), { target: { value: "" } });
      const reads = api.patientTrends.mock.calls.length;
      await press(within(form).getByRole("button", { name: "Yadda saxla" }));
      expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", { baselines: {} });
      expect(toasts().getAllByText("REA-01 · 2: xəstənin bütün aralıqları silindi; növbəti ölçmə onlarsız qiymətləndiriləcək.").length).toBeGreaterThan(0);
      expect(api.patientTrends.mock.calls.length).toBe(reads + 1);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryAllByRole("alert").map((a) => a.textContent).join(" ").trim()).toBe("");
    });

    it("a right taken away meanwhile closes the form and says so, named after the bed, without reading the trends again", async () => {
      const { api } = await openNormal((api) => api.putPatientProfile.mockRejectedValue(
        Object.assign(new Error("permission required: clinical.chart"), { status: 403 })));
      await press(offer());
      const reads = api.patientTrends.mock.calls.length;
      await press(formButton("Yadda saxla"));
      expect(toasts().getAllByText(/REA-01 · 2: xəstənin norması yadda saxlanılmadı — bu əməliyyat üçün artıq səlahiyyətiniz yoxdur/).length).toBeGreaterThan(0);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(api.patientTrends.mock.calls.length).toBe(reads);
    });

    it("keep the offer, dimmed and with its reason, when the trends turn unreadable under an open form — and give focus back to it", async () => {
      const { api, stream } = await openNormal();
      offer().focus();
      await press(offer());
      api.patientTrends.mockRejectedValue(down());
      await act(async () => { stream.frame(entry("S-001", [], { ...FULL, at: measured(10) })); await settle(); });
      await press(formButton("İmtina"));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(offer()).toHaveAttribute("aria-disabled", "true");
      expect(offer()).toHaveAccessibleDescription(/Vital qrafikləri oxuna bilmir/);
      expect(document.activeElement).toBe(offer());
      await press(offer());
      expect(screen.queryByRole("dialog")).toBeNull();        // dimmed means it opens nothing: the set it would replace is not known
    });

    it("keep the offer, and focus on it, when the read after a save fails", async () => {
      const { api } = await openNormal();
      offer().focus();
      await press(offer());
      api.patientTrends.mockRejectedValue(down());
      await press(formButton("Yadda saxla"));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(offer()).toHaveAttribute("aria-disabled", "true");
      expect(document.activeElement).toBe(offer());
    });

    // The screen mounted the way the shell mounts it: the same element with NO `key`, so /patients/S-001 ->
    // /patients/S-002 keeps this screen, the box and its state mounted and only the props change (browser Back,
    // Alt+← or a mouse's back button move the address under the inert page while a form is open). `leave` takes
    // the whole screen away, as a move to another screen does.
    async function mover() {
      onlyScreens({ beds: () => null }, { keep: [] });
      let go;
      let away;
      function Harness() {
        const [id, setId] = React.useState("S-001");
        const [here, setHere] = React.useState(true);
        go = setId;
        away = () => setHere(false);
        return here ? <PatientScreen params={{ id }} /> : null;
      }
      const mounted = await mount(<Harness />, {
        access: token({ perms: CHART }), me: profile({ perms: CHART }),
        setup: (api) => {
          api.boardPatients.mockResolvedValue(board([entry("S-001", [], FULL), entry("S-002", [], FULL)]));
          api.streamTicket.mockResolvedValue({ ticket: "t-1" });
          api.view.mockResolvedValue({ ok: true });
          api.patientTrends.mockImplementation(answering(withNormal));
          api.putPatientProfile.mockResolvedValue({ patient_id: "x" });
        },
      });
      await act(async () => { await mounted.board.start(); });
      await act(async () => { mounted.stream.open(); await settle(); });
      return {
        ...mounted,
        move: (id) => act(async () => { go(id); await settle(); }),
        leave: () => act(async () => { away(); await settle(); }),
      };
    }
    // A write that has not been answered yet, and the way to answer it later.
    const pending = (api) => {
      const held = {};
      api.putPatientProfile.mockImplementationOnce(() => new Promise((resolve) => { held.release = resolve; }));
      return () => act(async () => { held.release({ patient_id: "S-001" }); await settle(); });
    };

    it("a form left open while she moves to another patient does not follow her, and writes nothing to the next one", async () => {
      // Rows read from S-001 must never be written under S-002.
      const { api, move } = await mover();
      await press(offer());
      expect(screen.getByRole("dialog", { name: FORM })).toBeInTheDocument();
      await move("S-002");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(api.putPatientProfile).not.toHaveBeenCalled();
      await move("S-001");                                                 // and Forward does not bring the old form back
      expect(screen.queryByRole("dialog")).toBeNull();
      await move("S-002");
      await press(offer());                                                // a new form for S-002 writes to S-002
      await press(formButton("Yadda saxla"));
      expect(api.putPatientProfile).toHaveBeenCalledTimes(1);
      expect(api.putPatientProfile).toHaveBeenCalledWith("S-002", { baselines: { heart_rate: { low: 100, high: 115 } } });
    });

    it("a save that lands after she has moved on is told to her, and touches nothing of the next patient's: no read for her, her form still open", async () => {
      const { api, move } = await mover();
      const answer = pending(api);
      await press(offer());
      await press(formButton("Yadda saxla"));                               // S-001's save, unanswered
      await move("S-002");
      await press(offer());                                                // S-002's own form, open
      const reads = api.patientTrends.mock.calls.length;
      await answer();                                                      // S-001's write lands now
      expect(toasts().getAllByText("Xəstənin norması yadda saxlanıldı; mühərrik yenidən qiymətləndirdi.").length).toBeGreaterThan(0);
      expect(api.patientTrends.mock.calls.length).toBe(reads);
      expect(screen.getByRole("dialog", { name: FORM })).toBeInTheDocument();
      expect(api.putPatientProfile).toHaveBeenCalledTimes(1);              // nothing was sent for S-002
    });

    it("an old save does not close the form she has reopened for the same patient since", async () => {
      const { api, move } = await mover();
      const answer = pending(api);
      await press(offer());
      await press(formButton("Yadda saxla"));
      await move("S-002");
      await move("S-001");
      await press(offer());                                                // the second form for S-001
      expect(screen.getByRole("dialog", { name: FORM })).toBeInTheDocument();
      await answer();                                                      // the FIRST form's write lands
      expect(screen.getByRole("dialog", { name: FORM })).toBeInTheDocument();
      expect(within(screen.getByRole("dialog", { name: FORM })).getByRole("button", { name: "Yadda saxla" })).not.toHaveAttribute("aria-busy");
      expect(api.putPatientProfile).toHaveBeenCalledTimes(1);
    });

    it("a save that lands after she has left the patient screen reads nothing", async () => {
      const { api, leave } = await mover();
      const answer = pending(api);
      await press(offer());
      await press(formButton("Yadda saxla"));
      await leave();
      expect(screen.queryByRole("dialog")).toBeNull();
      const reads = api.patientTrends.mock.calls.length;
      await answer();
      expect(api.patientTrends.mock.calls.length).toBe(reads);
      expect(toasts().getAllByText("Xəstənin norması yadda saxlanıldı; mühərrik yenidən qiymətləndirdi.").length).toBeGreaterThan(0);
    });

    it("say they cannot be read, and since when, without raising an alert", async () => {
      await open({
        payload: board([entry("S-001", [], FULL)]),
        setup: (api) => api.patientTrends.mockRejectedValue(Object.assign(new Error("down"), { status: 503 })),
      });
      const said = screen.getByText("Vital qrafikləri oxuna bilmir (son: —)");
      expect(said.closest("[role='note']")).not.toBeNull();          // a note, as the monitor strip says it; not a live region
      expect(screen.queryAllByRole("alert").map((a) => a.textContent).join(" ")).not.toMatch(/Vital qrafikləri/);
    });

    it("say since when once a later read fails, after one that worked", async () => {
      const { api, stream } = await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.queryByText(/oxuna bilmir/)).toBeNull();
      api.patientTrends.mockRejectedValue(Object.assign(new Error("down"), { status: 503 }));
      await act(async () => { stream.frame(entry("S-001", [], { ...FULL, at: measured(10) })); await settle(); });
      // The time of the last read that worked (the browser's clock, pinned to NOW), not "—" and not the failure's.
      expect(screen.getByText(`Vital qrafikləri oxuna bilmir (son: ${hhmm(NOW)})`)).toBeInTheDocument();
      expect(screen.queryAllByRole("alert").map((a) => a.textContent).join(" ")).not.toMatch(/Vital qrafikləri/);
    });
  });

  describe("a patient this board does not hold", () => {
    it("says it cannot tell a missing record from one outside the scope", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]), id: "S-999" });
      expect(screen.getByRole("heading", { level: 1, name: "Bu xəstə göstərilə bilmir" })).toBeInTheDocument();
      expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" "))
        .toContain("server ikisinə də eyni cavabı verir");
      expect(screen.getByText("S-999")).toBeInTheDocument();
    });

    it("a board that could not be read says THAT instead", async () => {
      await open({ connection: "unavailable", id: "S-001" });
      expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" "))
        .toContain("panelinizdə olub-olmadığını deyə bilmirik");
    });
  });

  describe("recording that the patient was opened", () => {
    it("records it once for a patient the screen shows", async () => {
      const { api } = await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(api.view).toHaveBeenCalledTimes(1);
      expect(api.view).toHaveBeenCalledWith("S-001");
    });

    it("records NOTHING for a patient the board does not hold", async () => {
      // The server logs a refusal as `scope_denied`; a stale bookmark must not fill the audit
      // trail with refusals for views that never happened.
      const { api } = await open({ payload: board([entry("S-001", [], FULL)]), id: "S-999" });
      expect(api.view).not.toHaveBeenCalled();
    });

    it("a failed record does not stop the screen", async () => {
      await open({
        payload: board([entry("S-001", [], FULL)]),
        setup: (api) => api.view.mockRejectedValue(Object.assign(new Error("down"), { status: 503 })),
      });
      expect(screen.getByRole("heading", { level: 1, name: "Ayşe Sentetik" })).toBeInTheDocument();
    });
  });
});

// The one write this screen makes. It exists because of what its absence does: nothing in the
// engine's sepsis branch runs until something charts `suspected_infection` (septic_shock.evaluate
// returns at its first line), so a ward where nobody can chart it is a ward the engine is silent
// about for sepsis.
describe("charting a suspected infection", () => {
  const CHARTABLE = ["board.view", "alerts.ack", "clinical.chart"];
  const SEPSIS = { ...FULL, sepsis: { suspected_infection: null, sofa: 7, baseline_sofa: 2, baseline_assumed: false, rise: 5 } };
  const openChartable = ({ setup, ...over } = {}) => open({
    payload: board([entry("S-001", [], SEPSIS)]), perms: CHARTABLE,
    ...over,
    setup: (api) => {
      api.chart.mockResolvedValue({ patient_id: "S-001", charted: 1, alerts: [] });
      setup?.(api);                                   // a test's own mock wins over that default
    },
  });

  it("offers both answers, with neither chosen for the clinician", async () => {
    // No default, no pre-selection, no hint which to press: the screen takes a judgement and never
    // forms one. Both stay offered after one has been charted — "no" after "yes" is a clinical
    // event, not an undo.
    await openChartable();
    const yes = screen.getByRole("button", { name: "Var kimi işarələ" });
    const no = screen.getByRole("button", { name: "Yoxdur kimi işarələ" });
    for (const b of [yes, no]) {
      expect(b).toBeEnabled();
      expect(b.getAttribute("aria-pressed")).toBeNull();
    }
  });

  it("says, before anything is pressed, that this goes into the audit trail and cannot be withdrawn", async () => {
    await openChartable();
    expect(screen.getByText(/audit qeydinə yazılır/)).toBeInTheDocument();
    expect(screen.getByText(/Geri alınmır/)).toBeInTheDocument();
  });

  it("charts one entry, in the engine's own code and value", async () => {
    const { api } = await openChartable();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Var kimi işarələ" }));
      await settle();
    });
    expect(api.chart).toHaveBeenCalledTimes(1);
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "suspected_infection", value: 1 }]);
  });

  it("a chart the server took shows the confirmation and nothing that reads as a refusal", async () => {
    // The assertion the other success tests were missing. They checked the CALLS — `api.chart`
    // once, the board reloaded — and a call count cannot tell a chart that landed from one the
    // screen then told the clinician had failed.
    //
    // `useToast()` returns a FUNCTION (ui/Toast.jsx `value={raise}`), so `toast.show(...)`
    // threw a TypeError INSIDE the chart's own `try`. Its `catch` set that TypeError as
    // `chartError`, and `apiErrorText` fell back to the error's message — so a chart the server
    // had taken, on a board that had already reloaded with the engine's re-evaluation, rendered
    // "toast.show is not a function" as a crit Alert. The clinician reads a refusal for the one
    // write this screen has and charts the same judgement again.
    await openChartable();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Var kimi işarələ" }));
      await settle();
    });
    // `getAllByText`, not `getByText`: the toast says it once visibly and once in its sr-only
    // polite region (ui/Toast.jsx), and how many times is that component's business, not this
    // screen's.
    expect(screen.getAllByText("İşarələndi; mühərrik bu xəstəni yenidən qiymətləndirdi.").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("alert").map((a) => a.textContent).join(" ").trim()).toBe("");
  });

  it("charts a \"no\" as 0, not as nothing at all", async () => {
    // A charted "no" is a fact about this patient; sending nothing would leave the engine in the
    // state where it evaluates no sepsis rule, which is a different thing entirely.
    const { api } = await openChartable();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yoxdur kimi işarələ" }));
      await settle();
    });
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "suspected_infection", value: 0 }]);
  });

  it("reloads the board afterwards: the engine may now have a finding it did not have", async () => {
    const { api } = await openChartable();
    const before = api.boardPatients.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Var kimi işarələ" }));
      await settle();
    });
    expect(api.boardPatients.mock.calls.length).toBeGreaterThan(before);
  });

  it("shows a refusal and claims nothing was charted", async () => {
    const { api } = await openChartable({
      setup: (api) => api.chart.mockRejectedValue(Object.assign(new Error("no"), { status: 403, code: "permission_required" })),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Var kimi işarələ" }));
      await settle();
    });
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ").trim()).not.toBe("");
    // Nothing says it was charted, and the board was not reloaded: the load and the stream's
    // reload are the only two calls. The button comes back, so the clinician can try again.
    expect(screen.queryByText(/İşarələndi/)).toBeNull();
    expect(api.boardPatients).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Var kimi işarələ" })).toBeEnabled();
  });

  it("says which answer is in flight, and disables neither button natively", async () => {
    // Both buttons used to go busy together, so neither said which answer was being charted. And
    // both carried `disabled={busy}` on top of `busy`: ui/Button ignores clicks while busy and
    // stays FOCUSABLE on purpose — "a natively disabled button would drop the keyboard user's
    // focus to <body> the moment it was pressed" — but `disabled` reaches the native attribute
    // through `...rest`, so a keyboard user charting was dumped to <body> mid-write.
    let release;
    await openChartable({ setup: (api) => api.chart.mockImplementation(() => new Promise((r) => { release = r; })) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Var kimi işarələ" }));
      await settle();
    });
    const yes = screen.getByRole("button", { name: "Var kimi işarələ" });
    const no = screen.getByRole("button", { name: "Yoxdur kimi işarələ" });
    expect(yes).toHaveAttribute("aria-busy", "true");
    expect(no).not.toHaveAttribute("aria-busy", "true");
    expect(yes).not.toBeDisabled();
    expect(no).not.toBeDisabled();
    await act(async () => { release({ patient_id: "S-001", charted: 1, alerts: [] }); await settle(); });
  });

  it("names the patient a refused charting was for", async () => {
    // A refusal that says only "you do not have permission" tells a clinician that something
    // failed and not WHICH patient still has no suspected infection charted — so she charts the
    // wrong one, or neither. Read on another patient's screen, which it now outlives, it is
    // attributed by nothing at all. The bed label when the board has one, the id when it does
    // not — never a name we are not sure of.
    await openChartable({ setup: (api) => api.chart.mockRejectedValue(refusal(403, "permission required: clinical.chart")) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Var kimi işarələ" }));
      await settle();
    });
    const said = within(screen.getByRole("region", { name: "Bildirişlər" })).getAllByText(/REA-01 · 2/);
    expect(said.length).toBeGreaterThan(0);
    // The reason survives in front of nothing: the subject goes before it, not instead of it.
    expect(said.map((n) => n.textContent).join(" ")).toContain("səlahiyyətiniz yoxdur");
  });

  it("a refusal survives the clinician walking away from the patient", async () => {
    // A refusal shown only by the screen that made it VANISHES when the clinician leaves
    // mid-write: she saw no error, assumes the judgement is charted, and the engine's sepsis
    // branch still never runs. That is the Critical from the other side, and this project does
    // not let a clinician believe something happened when it did not. So the refusal is carried
    // on the toast, whose provider sits above the router and which lives until dismissed — not in
    // this screen's own state, which the move throws away.
    //
    // Shell renders <Screen params/> with NO `key` (shell/Shell.jsx), so moving
    // /patients/S-001 -> /patients/S-002 keeps this component mounted and only changes its props.
    // This mounts it the way the shell does: same element, no key, new params.
    onlyScreens({ beds: () => null }, { keep: [] });
    let move;
    function Mover() {
      const [id, setId] = React.useState("S-001");
      move = setId;
      return <PatientScreen params={{ id }} />;
    }
    const mounted = await mount(<Mover />, {
      access: token({ perms: CHARTABLE }),
      me: profile({ perms: CHARTABLE }),
      setup: (api) => {
        api.boardPatients.mockResolvedValue(board([entry("S-001", [], SEPSIS), entry("S-002", [], SEPSIS)]));
        api.streamTicket.mockResolvedValue({ ticket: "t-1" });
        api.view.mockResolvedValue({ ok: true });
        api.chart.mockRejectedValue(refusal(403, "permission required: clinical.chart"));
      },
    });
    await act(async () => { await mounted.board.start(); });
    await act(async () => { mounted.stream.open(); await settle(); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Var kimi işarələ" }));
      await settle();
    });
    const said = () => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(/səlahiyyətiniz yoxdur/);
    expect(said().length).toBeGreaterThan(0);
    await act(async () => { move("S-002"); await settle(); });
    // Still there on the next patient's screen, because the clinician still has to know her
    // charting on S-001 did not land.
    expect(said().length).toBeGreaterThan(0);
    // And it is the TOAST saying it, not a leftover of the previous patient's screen state: with
    // the refusal held above the router there is no per-patient error left to show on the wrong
    // patient, which is the whole class of fault rather than one frame of it.
    expect(screen.queryAllByRole("alert").filter((el) => !el.closest('[role="region"]'))).toEqual([]);
  });

  it("says it is charting, in words a screen reader hears", async () => {
    let release;
    await openChartable({ setup: (api) => api.chart.mockImplementation(() => new Promise((r) => { release = r; })) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Var kimi işarələ" }));
      await settle();
    });
    await vi.waitFor(
      () => expect(screen.getAllByRole("status").map((s) => s.textContent)).toContain("İşarələnir…"),
      { timeout: 4000 },      // 150 ms of real time, under a suite running 99 files in parallel
    );
    await act(async () => { release({ patient_id: "S-001", charted: 1, alerts: [] }); await settle(); });
  });

  it("a card the engine sent no Sepsis-3 context for still offers the charting", async () => {
    // `identity_only_board` (api/board.py) omits `sepsis` altogether — its comment claims "same
    // keys as patient_board" and that is wrong. So an admitted patient whose monitor has sent
    // nothing has no block at all, and the box used to return null for that card: no sentence
    // saying the sepsis rule never ran, and NO CHART BUTTON, on exactly the card a clinician
    // opens first. Decision 27's write has to be reachable there most of all.
    await openChartable({ payload: board([entry("S-001", [], { ...SEPSIS, sepsis: null })]) });
    expect(screen.getByText(/Sepsis-3 konteksti göndərməyib/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Var kimi işarələ" })).toBeEnabled();
  });

  it("no button at all without clinical.chart, and the reason is on the screen", async () => {
    await open({ payload: board([entry("S-001", [], SEPSIS)]) });
    expect(screen.queryByRole("button", { name: "Var kimi işarələ" })).toBeNull();
    expect(screen.getByText(/səlahiyyətiniz yoxdur \(clinical.chart\)/)).toBeInTheDocument();
  });
});

// Aşama A: the unvalidated monitor strip, for a patient the API links to one monitor — and only then.
describe("the monitor strip on the patient screen", () => {
  async function withStrip(answer) {
    const mounted = await open({ payload: board([entry("S-001", [], FULL)]) });
    mounted.api.shadowBoard.mockResolvedValue(answer);
    await act(async () => { mounted.shadow.start(["board.view", "alerts.ack"]); await settle(); });
    return mounted;
  }
  const linked = (link = "one", patientId = "S-001") => strip({
    beds: [monitorBed("REA-01 · 2", [monitorParam("hr", 72), monitorParam("art_mean", 84)], { link, patient_id: patientId })],
  });

  it("gives a linked patient the whole strip right after the vitals, with the evidence per parameter", async () => {
    await withStrip(linked());
    const region = screen.getByRole("region", { name: "Monitor · təsdiqlənməmiş" });
    expect(region).toHaveTextContent("72");
    expect(within(region).getByText("İki cihazda monitor ekranı ilə eynidir")).toBeInTheDocument();
    expect(within(region).getByText(/tədqiqat məqsədilə deşifrə olunur və təsdiqlənməyib/)).toBeInTheDocument();
    expect(within(region).getByRole("heading", { level: 2 })).toBeInTheDocument();
    const vitals = screen.getByRole("heading", { level: 2, name: "Ölçülən dəyərlər" });
    const findings = screen.getByRole("heading", { level: 2, name: "Mühərrikin tapıntıları" });
    expect(vitals.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(findings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("gives an unlinked patient none — and no 'no monitor' box: it does not advertise what it cannot attribute", async () => {
    for (const answer of [linked("none", null), linked("ambiguous", null), linked("one", "S-999")]) {
      await withStrip(answer);
      expect(document.querySelector("[data-monitor-strip]"), answer.beds[0].link).toBeNull();
      expect(screen.queryByText(/Bu çarpayıya bağlı xəstə qeydi yoxdur|bir neçə aktiv xəstə qeydi/)).toBeNull();
      cleanup();
    }
  });

  it("gives none with the stage off", async () => {
    await withStrip(STAGE_OFF);
    expect(document.querySelector("[data-monitor-strip]")).toBeNull();
  });

  it("says on the strip that it cannot be read when a poll fails, while its values age out", async () => {
    const mounted = await withStrip(linked());
    mounted.api.shadowBoard.mockRejectedValue(new Error("down"));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
    expect(screen.getByRole("region", { name: "Monitor · təsdiqlənməmiş" })).toHaveTextContent("Monitor zolağı oxunmur");
  });
});

// «Bakım ekibi» on the patient screen (G2-B1c, spec §4, D1–D8, X6, X7): the team by name, with roles,
// windows, «müddəti bitib» and who added each member; the history folded; each action behind its gate;
// one write at a time, held until its re-read is in; the focus kept when a row leaves; no id on screen.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { ddmmhhmm } from "../../../i18n/dates.js";
import { board, entry, identity, measured } from "../../../data/board.testutil.js";
import { answering } from "../trends/trends.testutil.js";
import { emptyFluids } from "../fluids/fluids.testutil.js";
import { BED, REA, expectNoUuid, mountKabul, row as admissionRow, settle, toasts } from "../../kabul/kabul.testutil.js";
import { PatientScreen } from "../PatientScreen.jsx";
import { CareTeamBox } from "./CareTeamBox.jsx";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const KEY = "202600000001";
const ADM = "77777777-7777-4777-8777-777777777701";
const DOC = "66666666-6666-4666-8666-666666666601";
const ONC = "66666666-6666-4666-8666-666666666602";
const ASC = "66666666-6666-4666-8666-666666666603";
const ROW = (n) => `88888888-8888-4888-8888-8888888888${String(n).padStart(2, "0")}`;
const BED_2 = "2 · Otaq 1 · Reanimasiya";
const W0 = "2026-11-09T00:00:00Z";
const W1 = "2026-11-09T08:00:00Z";
const ENDED = "2026-11-08T08:00:00Z";
const ACTIVE = admissionRow({ id: ADM, state: "ACTIVE", board_key: KEY, protocol_no: KEY });
const DRAFT_ROW = { ...ACTIVE, state: "DRAFT" };
const DRAFT_LINE = "Məsul həkim qəbul imzalandıqda təyin olunur.";
const UNREAD = "Yatış məlumatı oxunmadı; baxım komandası göstərilə bilmir.";
const member = (over) => ({
  id: ROW(1), admission_id: ADM, user_id: DOC, full_name: "Sentetik Həkim", role: "ATTENDING",
  granted_by_id: DOC, granted_by_name: "Sentetik Həkim", window_start: null, window_end: null,
  is_active: true, in_force: true, created_at: "2026-11-09T06:00:00Z", closed_at: null, ...over,
});
const ATTENDING = member();
const ONCALL = member({ id: ROW(2), user_id: ONC, full_name: "Sentetik Növbətçi", role: "ONCALL_PHYSICIAN",
  window_start: W0, window_end: W1, in_force: false });
const ASSOCIATE = member({ id: ROW(3), user_id: ASC, full_name: "Sentetik Köməkçi", role: "ASSOCIATE_PHYSICIAN" });
const CLOSED = member({ id: ROW(4), user_id: ASC, full_name: "Sentetik Köməkçi", role: "ONCALL_PHYSICIAN",
  is_active: false, in_force: false, closed_at: ENDED });
const TEAM = [ONCALL, ASSOCIATE, ATTENDING, CLOSED];

const ASSIGNER = ["board.view", "admissions.view", "care_team.claim", "care_team.assign"];
const READER = ["board.view", "admissions.view"];
const ATTENDING_GROUP = [{ slug: "attending", name: "Sorumlu Hekim" }];
const PHYSICIAN_GROUP = [{ slug: "physician", name: "Hekim" }];
const CHARGE_GROUP = [{ slug: "nurse", name: "Hemşire" }, { slug: "charge_nurse", name: "Sorumlu Hemşire" }];

async function open({ perms = ASSIGNER, groups = ATTENDING_GROUP, admissions = [ACTIVE], team = TEAM, setup } = {}) {
  const mounted = await mount(<CareTeamBox patientId={KEY} nowMs={NOW} />, {
    access: token({ perms }), me: profile({ perms, groups }),
    setup: (api) => {
      api.admissions.mockResolvedValue(admissions);
      api.careTeam.mockResolvedValue(team);
      setup?.(api);
    },
  });
  await settle();
  return mounted;
}

const heading = () => screen.getByRole("heading", { name: "Baxım komandası" });
/** The active row of `name` (its name is the row's `<b>`). */
const item = (name) => screen.getAllByRole("listitem").find((li) => within(li).queryByText(name, { selector: "b" }));
/** «Komandaya əlavə et», focused as a click focuses it in a browser (fireEvent.click does not), then pressed. */
async function pressAdd() {
  const opener = screen.getByRole("button", { name: "Komandaya əlavə et" });
  opener.focus();
  await act(async () => { fireEvent.click(opener); });
  await settle();
  return { opener, dialog: screen.getByRole("dialog", { name: `Komandaya əlavə et · ${BED_2}` }) };
}
/** Picks the on-call physician in the open dialog and presses «Əlavə et». */
async function pickAndAdd(dialog) {
  fireEvent.click(within(dialog).getByRole("radio", { name: "Sentetik Növbətçi" }));
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Əlavə et" })); });
  await settle();
}
const addSetup = (a) => {
  a.careTeamCandidates.mockResolvedValue([{ user_id: ONC, full_name: "Sentetik Növbətçi" }]);
  a.addCareTeamMember.mockResolvedValue({});
};
/** What the error toasts say (the toast region's role="alert"): nothing, when nothing was refused. */
const alerts = () => screen.queryAllByRole("alert").map((node) => node.textContent).join("");
/** The minute's read of the admissions is `useAdmissions`' setInterval: fake it, and nothing else, and step it. */
async function withClock(run) {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    await run();
  } finally {
    vi.useRealTimers();
  }
}
const minute = async () => {
  await act(async () => { vi.advanceTimersByTime(60_000); });
  await settle();
};
const press = (name) => act(async () => { fireEvent.click(screen.getByRole("button", { name })); });

describe("CareTeamBox", () => {
  it("reads nothing and shows nothing without admissions.view", async () => {
    const { api } = await open({ perms: ["board.view"] });
    expect(api.admissions).not.toHaveBeenCalled();
    expect(api.careTeam).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Baxım komandası" })).toBeNull();
  });

  it("shows nothing for a patient whose admission the list does not hold", async () => {
    const { api } = await open({ admissions: [] });
    expect(api.careTeam).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Baxım komandası" })).toBeNull();
  });

  it("says on a DRAFT that the attending comes with the signature, and reads no team", async () => {
    const { api } = await open({ admissions: [{ ...ACTIVE, state: "DRAFT" }] });
    expect(heading()).toBeTruthy();
    expect(screen.getByText("Məsul həkim qəbul imzalandıqda təyin olunur.")).toBeTruthy();
    expect(api.careTeam).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Komandaya əlavə et" })).toBeNull();
  });

  it("names each member with her role, her window, its expiry and who added her, and folds the history", async () => {
    const { api } = await open();
    expect(api.careTeam).toHaveBeenCalledWith(ADM);
    expect(item("Sentetik Növbətçi")).toHaveTextContent(
      `Növbətçi həkim · ${ddmmhhmm(Date.parse(W0))} – ${ddmmhhmm(Date.parse(W1))} · müddəti bitib · əlavə edən: Sentetik Həkim`);
    expect(item("Sentetik Köməkçi")).toHaveTextContent("Köməkçi həkim · əlavə edən: Sentetik Həkim");
    expect(item("Sentetik Həkim")).toHaveTextContent("Məsul həkim");
    expect(item("Sentetik Həkim")).toHaveTextContent("Yeni məsul həkim təyin olunanda bitir.");
    const history = screen.getByRole("button", { name: "Əvvəlki üzvlər (1)" });
    expect(history).toHaveAttribute("aria-expanded", "false");
    const ended = `bitdi: ${ddmmhhmm(Date.parse(ENDED))}`;
    expect(screen.queryByText(ended, { exact: false })).toBeNull();
    fireEvent.click(history);
    expect(history).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(ended, { exact: false })).toBeTruthy();
    // `list-none` takes the list's semantics away in Safari: both lists say what they are (house rule).
    expect([...document.querySelectorAll("section ul")].map((ul) => ul.getAttribute("role"))).toEqual(["list", "list"]);
    expectNoUuid();
  });

  it("offers an assigner «Komandaya əlavə et», and «Məsul həkim təyin et» and «Komandadan çıxar» on another's row — never on the attending's", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Komandaya əlavə et" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Komandadan çıxar: Sentetik Köməkçi" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Məsul həkim təyin et: Sentetik Köməkçi" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Komandadan çıxar: Sentetik Həkim" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Məsul həkim təyin et: Sentetik Həkim" })).toBeNull();
  });

  it("lets a member without care_team.assign leave her own row, and do nothing else", async () => {
    const own = member({ id: ROW(5), user_id: "u-ayse", full_name: "Ayşe Sentetik", role: "ASSOCIATE_PHYSICIAN" });
    await open({ perms: READER, groups: PHYSICIAN_GROUP, team: [own, ASSOCIATE, ATTENDING] });
    expect(screen.getByRole("button", { name: "Komandadan ayrıl: Ayşe Sentetik" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Komandadan çıxar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Məsul həkim təyin et/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Komandaya əlavə et" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Məsul həkim ol" })).toBeNull();
  });

  it("offers «Məsul həkim ol» to a physician holding the claim who is not the attending", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Məsul həkim ol" })).toBeTruthy();
  });

  it("offers no claim to the attending herself", async () => {
    await open({ team: [member({ user_id: "u-ayse", full_name: "Ayşe Sentetik" })] });
    expect(screen.queryByRole("button", { name: "Məsul həkim ol" })).toBeNull();
  });

  it("offers no claim to a charge nurse whose token still carries the key (D7, T1)", async () => {
    await open({ perms: ["board.view", "admissions.view", "care_team.claim"], groups: CHARGE_GROUP });
    expect(screen.queryByRole("button", { name: "Məsul həkim ol" })).toBeNull();
  });

  it("claims after one question that names who leaves, says it, and reads the team again", async () => {
    const { api } = await open({ setup: (a) => a.claimAttending.mockResolvedValue(member({ user_id: "u-ayse", full_name: "Ayşe Sentetik" })) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Məsul həkim ol" })); });
    const ask = screen.getByRole("dialog", { name: "Yeni məsul həkim" });
    expect(within(ask).getByText("Ayşe Sentetik məsul həkim olur; Sentetik Həkim komandadan çıxır.")).toBeTruthy();
    expect(api.claimAttending).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(ask).getByRole("button", { name: "Təsdiqlə" })); });
    await settle();
    expect(api.claimAttending).toHaveBeenCalledWith(ADM);
    expect(toasts().getAllByText(`${BED_2} · Ayşe Sentetik məsul həkim oldu.`).length).toBeGreaterThan(0);
    expect(api.careTeam).toHaveBeenCalledTimes(2);
  });

  it("makes an associate the attending after the same question", async () => {
    const { api } = await open({ setup: (a) => a.addCareTeamMember.mockResolvedValue({}) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Məsul həkim təyin et: Sentetik Köməkçi" })); });
    const ask = screen.getByRole("dialog", { name: "Yeni məsul həkim" });
    expect(within(ask).getByText("Sentetik Köməkçi məsul həkim olur; Sentetik Həkim komandadan çıxır.")).toBeTruthy();
    await act(async () => { fireEvent.click(within(ask).getByRole("button", { name: "Təsdiqlə" })); });
    await settle();
    expect(api.addCareTeamMember).toHaveBeenCalledWith(ADM, { user_id: ASC, role: "ATTENDING" });
  });

  it("holds the pressed button until the write and the re-read are in, and gives the heading the focus when the row leaves", async () => {
    let answer;
    let reread;
    const { api } = await open({
      setup: (a) => {
        a.careTeam.mockResolvedValueOnce(TEAM).mockImplementation(() => new Promise((resolve) => { reread = resolve; }));
        a.endCareTeamMember.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
      },
    });
    const name = "Komandadan çıxar: Sentetik Köməkçi";
    screen.getByRole("button", { name }).focus();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
    expect(api.endCareTeamMember).toHaveBeenCalledTimes(1);
    expect(api.endCareTeamMember).toHaveBeenCalledWith(ADM, ROW(3));
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-busy", "true");
    await act(async () => { answer({ ...ASSOCIATE, is_active: false }); });
    await settle();
    // Ended, but the list on screen is still the old one: a press now would end it twice.
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-busy", "true");
    await act(async () => { reread([ONCALL, ATTENDING, { ...ASSOCIATE, is_active: false, closed_at: ENDED }, CLOSED]); });
    await settle();
    expect(screen.queryByRole("button", { name })).toBeNull();
    expect(document.activeElement).toBe(heading());
    expect(toasts().getAllByText(`${BED_2} · Sentetik Köməkçi komandadan çıxarıldı.`).length).toBeGreaterThan(0);
  });

  it("says a refusal on the toast by its code, and reads the team again", async () => {
    const { api } = await open({ setup: (a) => a.endCareTeamMember.mockRejectedValue(
      refusal(409, "English words", { apiCode: "care_team_conflict" })) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Komandadan çıxar: Sentetik Köməkçi" })); });
    await settle();
    expect(toasts().getAllByText(`${BED_2}: Bu həkim artıq komandadadır və ya komanda eyni anda dəyişdi; komanda yenidən oxundu.`).length).toBeGreaterThan(0);
    expect(api.careTeam).toHaveBeenCalledTimes(2);
  });

  it("says when the team cannot be read", async () => {
    await open({ setup: (a) => a.careTeam.mockRejectedValue(refusal(503, "down")) });
    expect(screen.getByText(/^Baxım komandası oxunmadı: /)).toBeTruthy();
  });

  it("adds through the dialog, reads the team again, and says it under the list", async () => {
    const { api } = await open({ setup: addSetup });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Komandaya əlavə et" })); });
    await settle();
    const dialog = screen.getByRole("dialog", { name: `Komandaya əlavə et · ${BED_2}` });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Sentetik Növbətçi" }));
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Əlavə et" })); });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.careTeam).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Sentetik Növbətçi komandaya əlavə edildi.")).toBeTruthy();
  });

  // The dialog awaits `onDone` inside the try of its add call: a throw from the box's re-read would be
  // told to the reader as a refusal of an add that had landed (Task 15's note).
  it("says the add, and that the team could not be read again — never a refusal — when the re-read after an add fails", async () => {
    const { api } = await open({
      setup: (a) => {
        addSetup(a);
        a.careTeam.mockResolvedValueOnce(TEAM).mockRejectedValue(refusal(503, "down"));
      },
    });
    const { dialog } = await pressAdd();
    await pickAndAdd(dialog);
    expect(api.addCareTeamMember).toHaveBeenCalledTimes(1);
    expect(api.careTeam).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toasts().getAllByText(`${BED_2} · Sentetik Növbətçi komandaya əlavə edildi.`).length).toBeGreaterThan(0);
    expect(screen.getByText("Sentetik Növbətçi komandaya əlavə edildi.")).toBeTruthy();
    expect(screen.getByText(/^Baxım komandası oxunmadı: /)).toBeTruthy();
    expect(alerts()).toBe("");
  });

  it("gives the focus back to «Komandaya əlavə et» when the dialog is cancelled", async () => {
    await open({ setup: addSetup });
    const { opener, dialog } = await pressAdd();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "İmtina" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("gives the focus back to «Komandaya əlavə et» after an add", async () => {
    await open({ setup: addSetup });
    const { opener, dialog } = await pressAdd();
    await pickAndAdd(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("gives the heading the focus after an add when «Komandaya əlavə et» is gone by then", async () => {
    // The rights follow the token after each call (sessionStore `syncRights`): the add is answered, and the
    // token the session now holds no longer carries care_team.assign.
    await open({
      setup: (a) => {
        a.careTeamCandidates.mockResolvedValue([{ user_id: ONC, full_name: "Sentetik Növbətçi" }]);
        a.addCareTeamMember.mockImplementation(async () => {
          a.accessToken.mockReturnValue(token({ perms: READER }));
          return {};
        });
      },
    });
    const { dialog } = await pressAdd();
    await pickAndAdd(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Komandaya əlavə et" })).toBeNull();
    expect(document.activeElement).toBe(heading());
  });

  // ── Task 16 review ──────────────────────────────────────────────────────────────────────────────────────

  it("gives the heading the focus when a REFUSED write's re-read shows the pressed row gone (someone ended it first)", async () => {
    await open({
      setup: (a) => {
        a.careTeam.mockResolvedValueOnce(TEAM).mockResolvedValue([ONCALL, ATTENDING, CLOSED]);
        a.endCareTeamMember.mockRejectedValue(refusal(409, "English words", { apiCode: "invalid_transition" }));
      },
    });
    const name = "Komandadan çıxar: Sentetik Köməkçi";
    screen.getByRole("button", { name }).focus();
    await press(name);
    await settle();
    expect(screen.queryByRole("button", { name })).toBeNull();
    expect(document.activeElement).toBe(heading());
  });

  it("turns a DRAFT's line into the team when the minute's read finds the admission signed", async () => {
    await withClock(async () => {
      const { api } = await open({ setup: (a) => a.admissions.mockResolvedValueOnce([DRAFT_ROW]).mockResolvedValue([ACTIVE]) });
      expect(screen.getByText(DRAFT_LINE)).toBeTruthy();
      expect(api.careTeam).not.toHaveBeenCalled();
      await minute();
      expect(screen.queryByText(DRAFT_LINE)).toBeNull();
      expect(api.careTeam).toHaveBeenCalledWith(ADM);
      expect(item("Sentetik Həkim")).toBeTruthy();
    });
  });

  it("reads the team again when the minute's read shows the attending moved elsewhere", async () => {
    await withClock(async () => {
      const { api } = await open({
        setup: (a) => {
          a.admissions.mockResolvedValueOnce([ACTIVE]).mockResolvedValue([{ ...ACTIVE, attending_physician_id: DOC }]);
          a.careTeam.mockResolvedValueOnce([ASSOCIATE]).mockResolvedValue(TEAM);
        },
      });
      expect(api.careTeam).toHaveBeenCalledTimes(1);
      expect(item("Sentetik Həkim")).toBeUndefined();
      await minute();
      expect(api.careTeam).toHaveBeenCalledTimes(2);
      expect(item("Sentetik Həkim")).toBeTruthy();
    });
  });

  it("keeps the newer team read when an older one answers after it", async () => {
    await withClock(async () => {
      const reads = [];
      await open({
        setup: (a) => {
          a.admissions.mockResolvedValueOnce([ACTIVE]).mockResolvedValue([{ ...ACTIVE, attending_physician_id: DOC }]);
          a.careTeam.mockImplementation(() => new Promise((resolve) => { reads.push(resolve); }));
        },
      });
      expect(reads).toHaveLength(1);                     // the read at open, still out
      await minute();                                    // the attending moved: a second read
      expect(reads).toHaveLength(2);
      await act(async () => { reads[1]([ATTENDING]); });   // the newer answers first ...
      await settle();
      expect(item("Sentetik Həkim")).toBeTruthy();
      await act(async () => { reads[0]([ASSOCIATE]); });   // ... and the older after it is dropped
      await settle();
      expect(item("Sentetik Həkim")).toBeTruthy();
      expect(item("Sentetik Köməkçi")).toBeUndefined();
    });
  });

  it("holds the pressed button until the NEWEST team read is in, when the minute's read overtakes the write's re-read", async () => {
    await withClock(async () => {
      const reads = [];
      let answer;
      await open({
        setup: (a) => {
          a.admissions.mockResolvedValueOnce([ACTIVE]).mockResolvedValue([{ ...ACTIVE, attending_physician_id: DOC }]);
          a.careTeam.mockResolvedValueOnce(TEAM).mockImplementation(() => new Promise((resolve) => { reads.push(resolve); }));
          a.endCareTeamMember.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
        },
      });
      const name = "Komandadan çıxar: Sentetik Köməkçi";
      await press(name);
      await act(async () => { answer({}); });
      await settle();
      expect(reads).toHaveLength(1);                     // the write is in; its re-read is out
      await minute();                                    // the attending moved: a newer read
      expect(reads).toHaveLength(2);
      const gone = [ONCALL, ATTENDING, { ...ASSOCIATE, is_active: false, closed_at: ENDED }];
      await act(async () => { reads[0](gone); });          // the write's own re-read answers, overtaken: dropped
      await settle();
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-busy", "true");
      await act(async () => { reads[1](gone); });
      await settle();
      expect(screen.queryByRole("button", { name })).toBeNull();
    });
  });

  it("lets one write at a time through: another row's button pressed during the hold writes nothing", async () => {
    let answer;
    const { api } = await open({
      setup: (a) => a.endCareTeamMember.mockImplementation(() => new Promise((resolve) => { answer = resolve; })),
    });
    await press("Komandadan çıxar: Sentetik Köməkçi");
    await press("Komandadan çıxar: Sentetik Növbətçi");
    expect(api.endCareTeamMember).toHaveBeenCalledTimes(1);
    expect(api.endCareTeamMember).toHaveBeenCalledWith(ADM, ROW(3));
    await act(async () => { answer({}); });
    await settle();
  });

  it("says no success line for a refused write, and takes the last write's line away when the next one starts", async () => {
    await open({
      setup: (a) => {
        a.careTeam.mockResolvedValueOnce(TEAM).mockResolvedValue([ONCALL, ATTENDING, CLOSED]);
        a.endCareTeamMember.mockResolvedValueOnce({})
          .mockRejectedValueOnce(refusal(409, "English words", { apiCode: "care_team_conflict" }));
      },
    });
    await press("Komandadan çıxar: Sentetik Köməkçi");
    await settle();
    const box = () => within(screen.getByRole("region", { name: "Baxım komandası" }));     // the box, not the toasts
    expect(box().getByText("Sentetik Köməkçi komandadan çıxarıldı.")).toBeTruthy();       // under the list
    await press("Komandadan çıxar: Sentetik Növbətçi");
    await settle();
    expect(box().queryByText(/komandadan çıxarıldı\.$/)).toBeNull();
    expect(alerts()).toContain("Bu həkim artıq komandadadır");
  });

  it("asks only who becomes the attending when the team has none", async () => {
    await open({ team: [ASSOCIATE] });
    await press("Məsul həkim təyin et: Sentetik Köməkçi");
    const ask = screen.getByRole("dialog", { name: "Yeni məsul həkim" });
    expect(within(ask).getByText("Sentetik Köməkçi məsul həkim olur.")).toBeTruthy();
  });

  it("writes nothing when the new-attending question is cancelled", async () => {
    const { api } = await open({
      setup: (a) => { a.addCareTeamMember.mockResolvedValue({}); a.claimAttending.mockResolvedValue({}); },
    });
    await press("Məsul həkim təyin et: Sentetik Köməkçi");
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog", { name: "Yeni məsul həkim" })).getByRole("button", { name: "İmtina" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    await press("Məsul həkim ol");
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog", { name: "Yeni məsul həkim" })).getByRole("button", { name: "İmtina" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    await settle();
    expect(api.addCareTeamMember).not.toHaveBeenCalled();
    expect(api.claimAttending).not.toHaveBeenCalled();
    expect(api.careTeam).toHaveBeenCalledTimes(1);
  });

  it("ends her own row behind «Komandadan ayrıl», and says it", async () => {
    const own = member({ id: ROW(5), user_id: "u-ayse", full_name: "Ayşe Sentetik", role: "ASSOCIATE_PHYSICIAN" });
    const { api } = await open({
      perms: READER, groups: PHYSICIAN_GROUP, team: [own, ASSOCIATE, ATTENDING],
      setup: (a) => a.endCareTeamMember.mockResolvedValue({}),
    });
    await press("Komandadan ayrıl: Ayşe Sentetik");
    await settle();
    expect(api.endCareTeamMember).toHaveBeenCalledWith(ADM, ROW(5));
    expect(toasts().getAllByText(`${BED_2} · Ayşe Sentetik komandadan ayrıldı.`).length).toBeGreaterThan(0);
    expect(api.careTeam).toHaveBeenCalledTimes(2);
  });

  it("says in one muted line that the admissions could not be read, in place of a box that is silently not there", async () => {
    const { api } = await open({ setup: (a) => a.admissions.mockRejectedValue(refusal(503, "Service Unavailable")) });
    expect(screen.getByText(UNREAD).className).toContain("text-mute");
    expect(screen.queryByRole("heading", { name: "Baxım komandası" })).toBeNull();
    expect(api.careTeam).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Service Unavailable");   // the server's words stay off the screen
  });

  it("keeps the box when only the minute's re-read of the admissions fails (the list already read stands)", async () => {
    await withClock(async () => {
      await open({
        setup: (a) => a.admissions.mockResolvedValueOnce([ACTIVE]).mockRejectedValue(refusal(503, "Service Unavailable")),
      });
      await minute();
      expect(heading()).toBeTruthy();
      expect(screen.queryByText(UNREAD)).toBeNull();
    });
  });
});

const kabulCard = () => entry(KEY, [], {
  identity: identity({ patient_id: KEY, display_name: "Sentetik Hasta", bed_label: "2", source: "kabul",
    bed_id: BED(2), unit_id: REA, bed_key: null }),
  at: measured(30),
});

/** The patient screen of KEY, with its sign-off strip, label reprint and care team over ONE read of the open
 *  admissions (Task 16 review). */
async function openScreen({ perms = READER, setup } = {}) {
  const mounted = await mountKabul(<PatientScreen params={{ id: KEY }} />, {
    perms,
    setup: (api) => {
      api.boardPatients.mockResolvedValue(board([kabulCard()]));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.view.mockResolvedValue({ ok: true });
      api.patientTrends.mockImplementation(answering());
      api.patientFluids.mockImplementation((pid) => Promise.resolve(emptyFluids(pid)));   // G3-03's box, an empty ledger (X13)
      api.admissions.mockResolvedValue([ACTIVE]);
      api.careTeam.mockResolvedValue([ATTENDING]);
      setup?.(api);
    },
  });
  await act(async () => { await mounted.board.start(); mounted.stream.open(); });
  await settle();
  return mounted;
}

describe("the patient screen", () => {
  it("holds the care team of the patient it shows", async () => {
    const mounted = await openScreen();
    expect(screen.getByRole("heading", { level: 2, name: "Baxım komandası" })).toBeTruthy();
    expect(screen.getByText("Sentetik Həkim", { selector: "b" })).toBeTruthy();
    expect(mounted.api.careTeam).toHaveBeenCalledWith(ADM);
    expectNoUuid();
  });

  it("reads the open admissions ONCE at open, for the sign-off, the label and the care team together", async () => {
    const { api } = await openScreen({ perms: [...READER, "admissions.admit", "admissions.sign_off"] });
    expect(api.admissions).toHaveBeenCalledTimes(1);
    expect(api.admissions).toHaveBeenCalledWith(["DRAFT", "ACTIVE", "PENDING_DISCHARGE"]);
    // ... and all three are there, each from that read.
    expect(screen.getByRole("button", { name: "Etiketi yenidən çap et" })).toBeTruthy();
    expect(heading()).toBeTruthy();
    expect(screen.queryByText(/^Həkim imzası gözlənilir —/)).toBeNull();
  });

  it("turns the box's DRAFT line into the team the moment a signature given here is in, without the minute's wait", async () => {
    await withClock(async () => {
      const { api } = await openScreen({
        perms: [...READER, "admissions.sign_off"],
        setup: (a) => {
          a.admissions.mockResolvedValueOnce([DRAFT_ROW]).mockResolvedValue([ACTIVE]);
          a.signOffAdmission.mockResolvedValue({ id: ADM, state: "ACTIVE" });
        },
      });
      expect(screen.getByText(DRAFT_LINE)).toBeTruthy();
      expect(api.careTeam).not.toHaveBeenCalled();
      await press(`Qəbulu imzala: ${BED_2}`);
      await settle();                                      // the minute is never stepped: only the press re-reads
      expect(api.signOffAdmission).toHaveBeenCalledWith(ADM);
      expect(screen.queryByText(DRAFT_LINE)).toBeNull();
      expect(api.careTeam).toHaveBeenCalledWith(ADM);
      expect(screen.getByText("Sentetik Həkim", { selector: "b" })).toBeTruthy();
      expect(api.admissions).toHaveBeenCalledTimes(2);     // the read at open, and the one after the press
    });
  });

  it("says in one line each — the label's and the box's — that the admissions could not be read, after ONE failed read", async () => {
    const { api } = await openScreen({
      perms: [...READER, "admissions.admit"],
      setup: (a) => a.admissions.mockRejectedValue(refusal(503, "Service Unavailable")),
    });
    expect(api.admissions).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(UNREAD)).toHaveLength(1);
    expect(screen.getByText("Etiketin yenidən çapı indi təklif oluna bilmir: qəbul siyahısı oxunmadı.")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: "Baxım komandası" })).toBeNull();
  });
});

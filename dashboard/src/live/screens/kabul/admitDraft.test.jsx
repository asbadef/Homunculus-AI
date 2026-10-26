// The admission form's memory (Group 2 · B1a, A-21): the signed-in session's own, not the tab's.
// One draft per session, the same for every screen that asks; wiped the moment the session ends or
// another account takes this browser, and deaf to a send of that session answering afterwards;
// kept through a lock and its unlock, which are the same session. «Yeni qəbul» empties it for the
// next patient. Its request id is one per filled form (A-19). Synthetic patients and accounts only.
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { TOKEN_KEYS } from "../../../backendApi.js";
import { createSessionStore } from "../../session/sessionStore.js";
import { fakeApi, profile, token } from "../../session/testTokens.testutil.js";
import { AdmitTab } from "./AdmitTab.jsx";
import { admitDraftOf } from "./admitDraft.js";
import { emptyForm } from "./admitForm.js";
import { BED, NURSE, REA, mountKabul, settle } from "./kabul.testutil.js";

const NAME = "Sentetik Hasta";
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Whether anything of `text` is left anywhere in the draft. */
const keeps = (draft, text) => JSON.stringify(draft.get()).includes(text);

/** A session store on a fake API, signed in as `sub` — as LiveApp's is after a page load. */
async function signedIn(sub = "u-ayse") {
  const api = fakeApi(vi, { access: token({ sub, perms: NURSE }) });
  api.me.mockResolvedValue(profile({ id: sub, perms: NURSE }));
  const events = new EventTarget();
  const session = createSessionStore({ api, events });
  await session.restore();
  return { api, session, events };
}

/** Every part of the draft holding something of one patient. */
function filledIn(draft) {
  draft.update({
    form: { ...emptyForm(), name: NAME },
    tried: true,
    held: { bed: "1 · Otaq 1 · Reanimasiya" },
    unanswered: [{ bedId: BED(1), bed: "1 · Otaq 1 · Reanimasiya", name: NAME, checked: false }],
    done: { number: "H2600042", bed: "1 · Otaq 1 · Reanimasiya", engine: null, recovered: true, earlier: NAME },
  });
}

/** The form filled in for bed 1 of Otaq 1 in Reanimasiya. */
const filled = () => ({
  ...emptyForm(), name: NAME, sex: "female", dob: "1970-05-05", type: "ICU", diagnosis: "Sentetik tanı",
  noAllergy: true, consent: "KVKK_SIGNED", bedId: BED(1), unitId: REA, bedLabel: "1 · Otaq 1 · Reanimasiya",
});

const timedOut = () => Object.assign(new Error("…"), { code: "REQUEST_TIMEOUT" });
const admitted = (number = "H2600042") => ({ id: "a-1", patient_number: number, state: "DRAFT", engine: { weight: "ok", profile: "ok", board: "ok" } });
const press = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Qəbul et" })); });
  await settle();
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("admitDraftOf", () => {
  it("gives a signed-in session one draft — the same however often, and from whichever screen, it is asked", async () => {
    const { session } = await signedIn();
    const draft = admitDraftOf(session);
    expect(admitDraftOf(session)).toBe(draft);
    expect(draft.live).toBe(true);
    expect(draft.get()).toMatchObject({ form: emptyForm(), tried: false, sending: false, held: null, unanswered: [], done: null });
    expect(draft.get().requestId).toMatch(UUID4);
  });

  it("wipes the draft when the session ends, and takes no write of that session afterwards", async () => {
    const { session } = await signedIn();
    const draft = admitDraftOf(session);
    filledIn(draft);
    expect(keeps(draft, NAME)).toBe(true);

    session.signOut();
    expect(draft.live).toBe(false);
    expect(keeps(draft, "Sentetik")).toBe(false);
    expect(keeps(draft, "H2600042")).toBe(false);
    expect(keeps(draft, "Otaq")).toBe(false);

    // A send of that session answering late writes into the draft it began in: nothing stays.
    draft.update({ done: { number: "H2600042", bed: "1 · Otaq 1 · Reanimasiya" }, form: { ...emptyForm(), name: NAME } });
    expect(keeps(draft, "H2600042")).toBe(false);
    expect(keeps(draft, "Sentetik")).toBe(false);

    // Signed out, there is no draft that keeps anything.
    const none = admitDraftOf(session);
    expect(none).not.toBe(draft);
    expect(none.live).toBe(false);
    none.update({ form: { ...emptyForm(), name: NAME } });
    expect(keeps(none, "Sentetik")).toBe(false);
  });

  it("starts the next account's session on an empty draft of its own", async () => {
    const { api, session } = await signedIn();
    const first = admitDraftOf(session);
    filledIn(first);
    session.signOut();
    const access = token({ sub: "u-leyla", perms: NURSE });
    api.login.mockImplementation(async () => { api.store(access); return { access_token: access, refresh_token: "r" }; });
    api.me.mockResolvedValue(profile({ id: "u-leyla", username: "leyla", perms: NURSE }));
    await session.signIn("leyla", "Gizli-Sifre-1");

    const next = admitDraftOf(session);
    expect(next).not.toBe(first);
    expect(next.live).toBe(true);
    expect(keeps(next, "Sentetik")).toBe(false);
    expect(next.get()).toMatchObject({ form: emptyForm(), held: null, unanswered: [], done: null });
    first.update({ form: { ...emptyForm(), name: NAME } });                 // the old session's late write
    expect(keeps(next, "Sentetik")).toBe(false);
  });

  it("wipes the draft when another account signs in in another tab of this browser", async () => {
    const { api, session, events } = await signedIn();
    const draft = admitDraftOf(session);
    filledIn(draft);
    api.me.mockResolvedValue(profile({ id: "u-leyla", perms: NURSE }));
    api.store(token({ sub: "u-leyla", perms: NURSE }));
    const event = new Event("storage");
    Object.assign(event, { key: TOKEN_KEYS.access, newValue: "another" });
    events.dispatchEvent(event);

    expect(draft.live).toBe(false);
    expect(keeps(draft, "Sentetik")).toBe(false);
    await settle();
    expect(session.getState().user?.id).toBe("u-leyla");
    expect(admitDraftOf(session)).not.toBe(draft);
    expect(keeps(admitDraftOf(session), "Sentetik")).toBe(false);
  });

  it("keeps the draft through a lock and its unlock — the same session", async () => {
    const { api, session } = await signedIn();
    const draft = admitDraftOf(session);
    filledIn(draft);
    session.lock();
    expect(session.getState().phase).toBe("locked");
    api.reauth.mockResolvedValue({});
    await session.unlock("Gizli-Sifre-1");
    expect(session.getState().phase).toBe("ready");
    expect(admitDraftOf(session)).toBe(draft);
    expect(draft.live).toBe(true);
    expect(draft.get().form.name).toBe(NAME);
    expect(draft.get().unanswered).toHaveLength(1);
  });
});

describe("the admission form's draft", () => {
  it("is emptied by «Yeni qəbul» — the form, the box, the hold — while a send still unanswered stays looked for (R2)", async () => {
    const { api, store } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockRejectedValueOnce(timedOut()).mockResolvedValueOnce(admitted("H2600050")),
    });
    const draft = admitDraftOf(store);
    act(() => { draft.update({ form: filled() }); });
    await press();                                                           // Sentetik Hasta: no answer, bed 1 free
    act(() => { draft.update({ form: { ...filled(), name: "Sentetik Başqası", bedId: BED(5), bedLabel: "5 · Otaq 2 · Reanimasiya" } }); });
    await press();                                                           // held: the first is not looked at (R1)
    expect(draft.get().held).not.toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yoxladım, qəbul yoxdur — davam et" })); });
    await press();                                                           // looked for, not found: admitted
    expect(screen.getByText("H2600050")).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qəbul" })); });
    expect(draft.get()).toMatchObject({ form: emptyForm(), tried: false, held: null, done: null, sending: false });
    expect(keeps(draft, "Sentetik Başqası")).toBe(false);
    // The first send's outcome is still not known: it is looked for before the next send (R2).
    expect(draft.get().unanswered.map((s) => [s.name, s.checked])).toEqual([[NAME, true]]);
    expect(api.admit).toHaveBeenCalledTimes(2);
  });

  it("holds one request id per filled form: kept for a resend after no answer, new after the admission and after «Yeni qəbul» — and sends none yet (A-19)", async () => {
    const { api, store } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockRejectedValueOnce(timedOut()).mockResolvedValueOnce(admitted()),
    });
    const draft = admitDraftOf(store);
    const first = draft.get().requestId;
    expect(first).toMatch(UUID4);
    act(() => { draft.update({ form: filled() }); });
    await press();                                                           // no answer; bed 1 still free
    expect(draft.get().requestId).toBe(first);                               // the resend is the same form's
    await press();                                                           // admitted
    expect(screen.getByText("H2600042")).toBeTruthy();
    const second = draft.get().requestId;
    expect(second).toMatch(UUID4);
    expect(second).not.toBe(first);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qəbul" })); });
    expect(draft.get().requestId).toMatch(UUID4);
    expect(draft.get().requestId).not.toBe(second);
    // Not on the wire until the server takes it (Task 8; the Task 19 sweep sends it).
    for (const [body] of api.admit.mock.calls) expect(JSON.stringify(body)).not.toMatch(/request_id|requestId/);
    expect(document.body.textContent).not.toContain(first);
  });
});

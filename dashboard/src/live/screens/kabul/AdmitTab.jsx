// src/live/screens/kabul/AdmitTab.jsx — "Kabul": the admission form (Group 2 · B1a, spec §3.1,
// §5.2). The prototype's "Elle kayıt", grouped Kimlik · Kabul · İletişim ve onam · Yatak, with a
// side panel naming every required field still missing. "Kabul et" is held (aria-disabled, never
// disabled: it keeps its focus, and pressed it says why — the first missing field takes the focus,
// its error under it) until that panel is empty.
//
// One request writes the admission (POST /admissions). The answer's patient number is shown large,
// with what the nurse does with it — she enters it on the bedside device — and any part of the
// engine write that did not land, named; the number box takes the focus and says those parts
// aloud. A refusal goes on the toast, named after the bed (amendments (a), (f)), and the structure
// is read again; a bed any re-read shows taken, closed or gone stops being the form's choice, so the
// panel names the bed missing again.
//
// A SEND THAT GOT NO ANSWER (`mayHaveLanded`) MUST NOT BECOME A SECOND ADMISSION. The server makes
// a new patient for every POST, so the one thing that ties two sends of the same nurse together is
// the BED: the server locks it and gives it to one admission only. After no answer the structure
// is read again (and waited for: "Kabul et" stays busy until then):
//   * the bed is still free — nothing landed yet; she may send again, to the same bed, and the
//     server takes one of the two;
//   * the bed is taken, or its state could not be read — the DRAFT admissions are read: one on
//     that bed under the name she sent is the send that landed, and its number box is shown; none,
//     and "Kabul et" is held, with the bed and the list to look in ("Evə yazılma › Yatan
//     xəstələr"), until she says she has looked. The hold says only that the outcome is not known.
// Every send that got no answer is remembered until its DRAFT is found (A-19):
//   * before EVERY later send its DRAFT is looked for — also after «go on», which only marks the
//     send as looked at (R2);
//   * while one is unanswered and not looked at, a send to ANOTHER bed or under ANOTHER name is
//     held, naming the unanswered send's bed (R1): only the same bed lets the server take one of two;
//   * a DRAFT found is the form's admission only under the form's own name (R3). Another name's is
//     an earlier patient's: its number box says so, and the form is kept for its own send — never is
//     another patient's number shown as the form's, the number the nurse enters on the device;
//   * a later send refused because that same bed is taken is read the same way — the first may
//     have landed while the second was on its way. That refusal is definite, though: when the
//     first's DRAFT is found and no send's outcome is left unknown, nothing is held (M-b).
//
// NONE OF THIS IS THE TAB'S (A-21). The screen mounts only the open tab and the shell only the open
// screen, so the form, `tried`, the send on its way, the hold, the sends with no answer and the box
// live in the session's admission draft (admitDraft.js): a tab change or another screen loses none
// of them, a send answering meanwhile writes there, and the session's end wipes them. Only the
// focus is this component's.
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { admissible, indexStructure, normId } from "../../data/structure.js";
import { Announce, Box, Button, Field, Icon, Input, Note, Select, Tag, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { doneFor, mayHaveLanded, reasonOf, refusedFor } from "../admin/refusal.js";
import {
  ADMISSION_TYPES, BLOOD_GROUPS, COMORBIDITIES, CONSENTS, EARLIEST_BIRTH, ENGINE_FAILED, NATIONALITIES,
  RELATIONS, SEXES, SOURCES, ageOf, missing, toBody,
} from "./admitForm.js";
import { freshForm, newRequestId, useAdmitDraft } from "./admitDraft.js";
import { BedPicker } from "./BedPicker.jsx";

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Two names as a nurse reads them alike: spaces collapsed, case folded. */
const sameName = (a, b) => {
  const plain = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return plain(a) === plain(b);
};

/** Two sends for the same bed under the same name — the one pair the server's bed lock keeps to one admission. */
const sameSend = (a, b) => normId(a.bedId) === normId(b.bedId) && sameName(a.name, b.name);

/** The engine parts the number box names when they did not land, in the order it names them. */
const PARTS = ["board", "weight", "profile"];

/** A required one-of choice: a radio group (role, required, invalid, its error by id), its words
 *  from `options[].key`. `id` goes on the first choice — what a "missing" press focuses. */
function Choice({ id, name, legend, options, value, onChange, error }) {
  const { t } = useI18n();
  const legendId = `${id}-legend`;
  const errorId = `${id}-error`;
  return (
    <fieldset role="radiogroup" aria-labelledby={legendId} aria-required="true"
      aria-invalid={error ? "true" : undefined} aria-describedby={error ? errorId : undefined}
      className="mb-2.5 min-w-0 border-0 p-0">
      <legend id={legendId} className="mb-1.5 text-13.5 font-semibold text-mute">{legend}<span aria-hidden="true" className="text-crit-ink"> *</span></legend>
      <div className="flex flex-wrap gap-3">
        {options.map((option, at) => (
          <label key={option.value} className="inline-flex items-center gap-1.5 text-13.5">
            <input id={at === 0 ? id : undefined} type="radio" name={name} value={option.value}
              checked={value === option.value} onChange={() => onChange(option.value)} className={FOCUS_RING} />
            {t(option.key)}
          </label>
        ))}
      </div>
      {error ? <p id={errorId} className="m-0 mt-1 text-12 font-semibold text-crit-ink">{error}</p> : null}
    </fieldset>
  );
}

/** The admission written: its number, what to do with it, and what did not land. Its heading takes
 *  the focus (the form it replaces is out of sight), and what did not land is said aloud once.
 *  `done.earlier` (a name): the admission is an EARLIER send's, of another patient than the form's
 *  — the box says so, and its button goes back to the form, which is kept. Whose number it is
 *  comes BEFORE the number (M-c): the heading says another patient's, and the note under it names
 *  her and her bed, so the number cannot be read as the form's — it is entered on a device. */
function NumberBox({ done, onNext }) {
  const { t } = useI18n();
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const failed = PARTS.filter((part) => done.engine?.[part] === "failed");
  const whose = done.earlier ? t("kabul.earlierSend", { name: done.earlier, bed: done.bed }) : null;
  const notes = [
    ...(done.recovered ? [t("kabul.recordedNoAnswer")] : []),
    ...failed.map((part) => t(ENGINE_FAILED[part])),
  ];
  return (
    <Box>
      <h2 ref={heading} tabIndex={-1}
        className={`m-0 mb-2.5 flex items-center gap-2 font-text text-11 font-bold uppercase leading-[normal] tracking-[.08em] text-mute ${FOCUS_RING}`}>
        <Icon name={whose ? "alert" : "ok"} size={15} />
        {whose ? t("kabul.earlierTitle") : t("kabul.doneTitle")}
      </h2>
      {whose ? <Note tone="warn" icon="alert" className="mb-2">{whose}</Note> : null}
      <p className="m-0 text-13 text-mute">{t("kabul.doneBed", { bed: done.bed })}</p>
      <p className="m-0 my-2 font-data text-34 font-bold tracking-[.06em] text-ink">{done.number}</p>
      <p className="m-0 text-14 font-semibold">{t("kabul.enterOnDevice")}</p>
      {notes.map((text) => (
        <Note key={text} tone="warn" icon="alert" className="mt-2">{text}</Note>
      ))}
      <div className="mt-3 flex flex-wrap gap-2">
        {/* A card that did not reach the board is not there to be seen. */}
        {done.engine?.board === "failed" ? null : (
          <a href={`#/patients/${encodeURIComponent(done.number)}`}
            className={`inline-flex items-center gap-1.5 rounded-ctl bg-pri px-[13px] py-2 text-13 font-semibold text-onpri ${FOCUS_RING}`}>
            {t("kabul.seeOnBoard")}
          </a>
        )}
        <Button onClick={onNext}>{done.earlier ? t("kabul.backToForm") : t("kabul.next")}</Button>
      </div>
      <Announce text={[...(whose ? [whose] : []), ...notes].join(" ")} />
    </Box>
  );
}

export function AdmitTab() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { structure, index, phase, error, reload } = useStructure();
  const toast = useToast();
  const canAdmit = user?.perms?.includes("admissions.admit") ?? false;
  // The session's (admitDraft.js): `sending` is read from the draft at once, so a second press in
  // the same tick — or in a tab mounted while the first is on its way — sees it; `held` ({bed}): a
  // send got no answer, and nothing is sent until she has looked; `unanswered`: every send with no
  // answer whose DRAFT is not found yet ({bedId, bed, name, checked}); `done`: the box.
  const [draftState, draft] = useAdmitDraft();
  const { form, tried, sending: busy, held, done } = draftState;
  const [focusTo, setFocusTo] = useState(null);     // {field}: focused once the render it asks for is drawn
  const uid = useId();
  const idOf = (field) => `${uid}-${field}`;
  const panelId = `${uid}-panel`;
  const heldId = `${uid}-held`;
  const today = localToday();
  const gaps = useMemo(() => missing(form, today), [form, today]);
  const wrong = (field) => (tried ? gaps.find((g) => g.field === field) : null);
  const errorOf = (field) => (wrong(field) ? t(wrong(field).key) : undefined);
  const set = (patch) => draft.update((s) => ({ form: { ...s.form, ...patch } }));
  const age = ageOf(form.dob, today);

  useEffect(() => { reload(); }, [reload]);

  // A bed a re-read shows taken, closed or gone is no longer the form's: the panel names it missing.
  useEffect(() => {
    if (structure === null || form.bedId === null) return;
    if (admissible(index.beds.get(normId(form.bedId)))) return;
    draft.update((s) => (s.form.bedId === form.bedId ? { form: { ...s.form, bedId: null, bedLabel: null } } : null));
  }, [structure, index, form.bedId, draft]);

  useEffect(() => {
    if (focusTo) document.getElementById(`${uid}-${focusTo.field}`)?.focus();
  }, [focusTo, uid]);

  if (!canAdmit) return <Note tone="info" icon="eye">{t("kabul.readOnly")}</Note>;
  if (done) {
    // «Yeni qəbul» empties the draft for the next patient: the form, the box, the hold, and a new
    // request id. A send whose outcome is still not known stays looked for (R2). «Formaya qayıt»
    // (an earlier patient's box) keeps the form for its own send.
    const onNext = () => {
      draft.update(done.earlier ? { done: null } : { ...freshForm(), done: null, held: null });
      setFocusTo({ field: "name" });
    };
    return <NumberBox done={done} onNext={onNext} />;
  }

  const bedText = form.bedLabel ?? "";

  /** The form's patient admitted — by this send's answer, or found after one that got none. Every
   *  send under that name is done with, and the form is emptied for the next patient. */
  function admitted(next, name) {
    draft.update((s) => ({
      ...freshForm(),
      done: next,
      held: null,
      unanswered: s.unanswered.filter((x) => !sameName(x.name, name)),
    }));
    toast(doneFor(t, next.bed, t("kabul.admitted", { number: next.number })));
  }

  /** "Kabul et" waits — the reason names the unanswered send's bed and takes the focus. */
  function hold(bed) {
    draft.update({ held: { bed } });
    setFocusTo({ field: "held" });
  }

  /** The DRAFTs sends with no answer left after all — on their bed, under the name they sent —
   *  the one under `name` (the form's) first; null when none shows, undefined when the list could
   *  not be read. */
  async function findLanded(name) {
    let rows;
    try {
      rows = await store.track(() => store.api.admissions(["DRAFT"]));
    } catch {
      return undefined;
    }
    const found = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const send = draft.get().unanswered.find((s) => normId(s.bedId) === normId(row.bed_id) && sameName(s.name, row.display_name));
      if (send) found.push({ row, send });
    }
    return found.find((f) => sameName(f.send.name, name)) ?? found[0] ?? null;
  }

  /** A send's DRAFT found. Under the form's name (`name`) it is the form's admission; under
   *  another it is an earlier patient's (R3): shown as that patient's, and the form is kept — under
   *  a new request id, the found one being that patient's (A-19). Answers whether it was the form's. */
  function landedFound({ row, send }, name) {
    const next = { number: row.patient_number, bed: send.bed, engine: null, recovered: true };
    if (sameName(send.name, name)) {
      admitted(next, name);
      return true;
    }
    draft.update((s) => ({
      unanswered: s.unanswered.filter((x) => !sameSend(x, send)),
      done: { ...next, earlier: String(send.name).trim() },
      requestId: newRequestId(),
    }));
    toast(doneFor(t, send.bed, t("kabul.admitted", { number: row.patient_number })));
    return false;
  }

  /** The bed of a send is taken, or its state is not known: a DRAFT of the form's patient is the
   *  admission; else "Kabul et" waits until the nurse has looked — unless nothing is left unknown:
   *  this send was refused outright and the earlier send it met was found (M-b). */
  async function bedTaken(err, sent) {
    const landed = await findLanded(sent.name);
    if (!draft.live) return;
    if (landed && landedFound(landed, sent.name)) return;
    // Nothing found — or only an earlier patient's, with this send's own outcome, or another's,
    // still not known: wait.
    const unknown = mayHaveLanded(err) || draft.get().unanswered.some((s) => !s.checked);
    if (!landed || unknown) hold(sent.bed);
    toast(refusedFor(t, sent.bed, reasonOf(t, err)), "error");
  }

  // Every step after an `await` first asks whether the draft is still live: a send of a session
  // that has ended says nothing, reads nothing more and writes nothing (admitDraft.js).
  async function failed(err, sent) {
    if (mayHaveLanded(err)) {
      draft.update((s) => ({ unanswered: [...s.unanswered.filter((x) => !sameSend(x, sent)), sent] }));
      const tree = await reload();
      if (!draft.live) return;
      if (admissible(indexStructure(tree).beds.get(normId(sent.bedId)))) {
        // Nothing landed yet. Sent again to this bed, the server gives it to one of the two.
        toast(refusedFor(t, sent.bed, reasonOf(t, err)), "error");
        return;
      }
      await bedTaken(err, sent);
      return;
    }
    if (err?.apiCode === "bed_not_available" && draft.get().unanswered.some((s) => normId(s.bedId) === normId(sent.bedId))) {
      // Taken — perhaps by the send to this bed that got no answer.
      await reload();
      if (!draft.live) return;
      await bedTaken(err, sent);
      return;
    }
    toast(refusedFor(t, sent.bed, reasonOf(t, err)), "error");
    await reload();
  }

  async function submit(event) {
    event.preventDefault();
    const now = draft.get();
    if (now.sending) return;
    if (now.held) {
      setFocusTo({ field: "held" });                // pressed while held: the reason is read (M-4)
      return;
    }
    if (gaps.length > 0) {
      draft.update({ tried: true });
      setFocusTo({ field: gaps[0].field });
      return;
    }
    const sent = { bedId: form.bedId, bed: bedText, name: form.name, checked: false };
    const body = toBody(form);
    draft.update({ sending: true });
    try {
      if (draft.get().unanswered.length > 0) {
        // A send got no answer: looked for before every send until it is found, «go on» or not (R2).
        const landed = await findLanded(sent.name);
        if (!draft.live) return;
        if (landed) {
          landedFound(landed, sent.name);
          reload();
          return;
        }
        // Not found yet: only the same bed under the same name may go — the server takes one of the
        // two. Another bed or name would be a second admission if the first lands later (R1).
        const other = draft.get().unanswered.find((s) => !s.checked && !sameSend(s, sent));
        if (other) {
          hold(other.bed);
          return;
        }
      }
      const answer = await store.track(() => store.api.admit(body));
      if (!draft.live) return;
      admitted({ number: answer.patient_number, bed: sent.bed, engine: answer.engine }, sent.name);
      reload();
    } catch (err) {
      if (draft.live) await failed(err, sent);
    } finally {
      draft.update({ sending: false });
    }
  }

  const where = `${t("kabul.tabDischarge")} › ${t("kabul.lyingTitle")}`;
  return (
    <form noValidate autoComplete="off" onSubmit={submit} className="grid gap-3 min-[1100px]:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-w-0 gap-3">
        <Box title={t("kabul.groupIdentity")} icon="user" level={2}>
          <Field label={t("kabul.f.name")} required error={errorOf("name")}>
            <Input id={idOf("name")} value={form.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.father")}>
            <Input value={form.father} maxLength={100} onChange={(e) => set({ father: e.target.value })} autoComplete="off" />
          </Field>
          <Choice id={idOf("sex")} name="sex" legend={t("kabul.f.sex")} options={SEXES} value={form.sex}
            onChange={(sex) => set({ sex })} error={errorOf("sex")} />
          <Field label={t("kabul.f.dob")} required error={errorOf("dob")}
            hint={age ? t("kabul.age", age) : undefined}>
            <Input id={idOf("dob")} type="date" min={EARLIEST_BIRTH} max={today} value={form.dob}
              onChange={(e) => set({ dob: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.nationality")}>
            <Select value={form.nationality} onChange={(e) => set({ nationality: e.target.value })}>
              <option value="">{t("kabul.choose")}</option>
              {NATIONALITIES.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.fin")} hint={t("kabul.finHint")} error={errorOf("fin")}>
            <Input id={idOf("fin")} value={form.fin} maxLength={7} onChange={(e) => set({ fin: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.passport")}>
            <Input value={form.passport} maxLength={32} onChange={(e) => set({ passport: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.phone")} hint={t("kabul.phoneHint")}>
            <Input type="tel" value={form.phone} maxLength={32} onChange={(e) => set({ phone: e.target.value })} autoComplete="off" />
          </Field>
        </Box>

        <Box title={t("kabul.groupAdmission")} icon="clip" level={2}>
          <Field label={t("kabul.f.type")} required error={errorOf("type")}>
            <Select id={idOf("type")} value={form.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="">{t("kabul.choose")}</option>
              {ADMISSION_TYPES.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.source")}>
            <Select value={form.source} onChange={(e) => set({ source: e.target.value })}>
              <option value="">{t("kabul.choose")}</option>
              {SOURCES.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.diagnosis")} required error={errorOf("diagnosis")}>
            <Input id={idOf("diagnosis")} value={form.diagnosis} maxLength={500} onChange={(e) => set({ diagnosis: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.weight")} error={errorOf("weight")}>
            <Input id={idOf("weight")} inputMode="decimal" value={form.weight} onChange={(e) => set({ weight: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.height")} error={errorOf("height")}>
            <Input id={idOf("height")} inputMode="numeric" value={form.height} onChange={(e) => set({ height: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.blood")}>
            <Select value={form.blood} onChange={(e) => set({ blood: e.target.value })}>
              {BLOOD_GROUPS.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.allergy")} required error={errorOf("allergy")}>
            <Input id={idOf("allergy")} value={form.allergy} maxLength={500} onChange={(e) => set({ allergy: e.target.value })} />
          </Field>
          <label className="mb-2.5 flex items-center gap-2 text-13.5">
            {/* Ticking it never erases a typed allergy: both standing is said in the panel, and the nurse removes one. */}
            <input type="checkbox" checked={form.noAllergy} className={FOCUS_RING}
              onChange={(e) => set({ noAllergy: e.target.checked })} />
            {t("kabul.noAllergy")}
          </label>
          <fieldset className="mb-2.5 min-w-0 border-0 p-0">
            <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("kabul.f.comorbidities")}</legend>
            <div className="flex flex-wrap gap-3">
              {COMORBIDITIES.map(({ value: code, key }) => (
                <label key={code} className="inline-flex items-center gap-1.5 text-13.5">
                  <input type="checkbox" checked={form.comorbidities.includes(code)} className={FOCUS_RING}
                    onChange={(e) => set({ comorbidities: e.target.checked
                      ? [...form.comorbidities, code] : form.comorbidities.filter((c) => c !== code) })} />
                  {t(key)}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={t("kabul.f.comorbiditiesText")} hint={t("kabul.comorbiditiesTextHint")}>
            <Input value={form.comorbiditiesText} maxLength={500} onChange={(e) => set({ comorbiditiesText: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.his")}>
            <Input value={form.his} maxLength={64} onChange={(e) => set({ his: e.target.value })} autoComplete="off" />
          </Field>
        </Box>

        <Box title={t("kabul.groupContact")} icon="users" level={2}>
          <Field label={t("kabul.f.relativeName")}>
            <Input value={form.relativeName} maxLength={100} onChange={(e) => set({ relativeName: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.relativeRelation")}>
            <Select value={form.relativeRelation} onChange={(e) => set({ relativeRelation: e.target.value })}>
              <option value="">{t("kabul.choose")}</option>
              {RELATIONS.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.relativePhone")}>
            <Input type="tel" value={form.relativePhone} maxLength={32} onChange={(e) => set({ relativePhone: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.companion")}>
            <Input value={form.companion} maxLength={100} onChange={(e) => set({ companion: e.target.value })} autoComplete="off" />
          </Field>
          <Choice id={idOf("consent")} name="consent" legend={t("kabul.f.consent")} options={CONSENTS} value={form.consent}
            onChange={(consent) => set({ consent })} error={errorOf("consent")} />
          <label className="flex items-center gap-2 text-13.5">
            <input type="checkbox" checked={form.sms} className={FOCUS_RING} onChange={(e) => set({ sms: e.target.checked })} />
            {t("kabul.sms")}
          </label>
        </Box>

        <Box title={<>{t("kabul.groupBed")}<span aria-hidden="true" className="text-crit-ink"> *</span></>} icon="bed" level={2}>
          <BedPicker structure={structure} phase={phase} error={error} onRetry={reload} focusId={idOf("bed")}
            unitId={form.unitId} bedId={form.bedId} invalid={Boolean(wrong("bed"))}
            onUnit={(unitId) => set({ unitId, bedId: null, bedLabel: null })}
            onBed={(bed) => set({ bedId: bed.id, unitId: bed.unitId, bedLabel: bed.label })} />
          {errorOf("bed") ? <p className="m-0 mt-1 text-12 font-semibold text-crit-ink">{errorOf("bed")}</p> : null}
        </Box>
      </div>

      <aside aria-labelledby={`${panelId}-title`} className="h-fit rounded-box border border-line bg-card px-3.5 py-3 min-[1100px]:sticky min-[1100px]:top-0">
        <h2 id={`${panelId}-title`} className="m-0 text-14 font-bold">{t("kabul.missingTitle")}</h2>
        <div id={panelId}>
          {gaps.length === 0 ? (
            <p className="m-0 mt-1.5 text-13 text-mute">{t("kabul.missingNone")}</p>
          ) : (
            <ul className="m-0 mt-1.5 grid gap-1 ps-4 text-13">
              {gaps.map((g) => <li key={g.field}>{t(g.key)}</li>)}
            </ul>
          )}
        </div>
        <Button type="submit" variant="primary" icon="ok" busy={busy} className="mt-3 w-full justify-center"
          aria-disabled={gaps.length > 0 || held ? "true" : undefined}
          aria-describedby={held ? `${heldId} ${panelId}` : panelId}>
          {t("kabul.admit")}
        </Button>
        {held ? (
          <div className="mt-2 grid justify-items-start gap-2">
            <p id={heldId} tabIndex={-1} className={`m-0 text-12.5 font-semibold text-crit-ink ${FOCUS_RING}`}>
              {t("kabul.heldNoAnswer", { bed: held.bed, where })}
            </p>
            {/* She has looked: the hold goes, the search does not — every send still looks first (R2). */}
            <Button size="sm" onClick={() => draft.update((s) => ({
              unanswered: s.unanswered.map((x) => ({ ...x, checked: true })),
              held: null,
            }))}>{t("kabul.heldGoOn")}</Button>
          </div>
        ) : null}
        {form.bedId ? <p className="m-0 mt-2"><Tag icon="bed">{bedText}</Tag></p> : null}
        <Announce text={busy ? t("kabul.admitting") : ""} />
      </aside>
    </form>
  );
}

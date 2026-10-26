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
//   * the bed is taken — the DRAFT admissions are read: one on that bed under the name she sent is
//     the send that landed, and its number box is shown (never another patient's number: that is
//     the number she would enter on the device); none, and "Kabul et" is held, with the bed and
//     the list to look in ("Evə yazılma › Yatan xəstələr"), until she says she has looked.
// Every send of this form that got no answer is remembered until an answer comes: before the next
// send its DRAFT is looked for, and a later send refused because that same bed is taken is read
// the same way — the first may have landed while the second was on its way.
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { admissible, indexStructure, normId } from "../../data/structure.js";
import { Announce, Box, Button, Field, Icon, Input, Note, Select, Tag, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { doneFor, mayHaveLanded, refusedFor } from "../admin/refusal.js";
import {
  ADMISSION_TYPES, BLOOD_GROUPS, COMORBIDITIES, CONSENTS, EARLIEST_BIRTH, ENGINE_FAILED, NATIONALITIES,
  RELATIONS, SEXES, SOURCES, ageOf, emptyForm, missing, toBody,
} from "./admitForm.js";
import { BedPicker } from "./BedPicker.jsx";

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** What the toast says of a failed admission. An uncoded 404 ("Unit not found.", "Bed not found.":
 *  the unit or bed named is not the caller's hospital's) has no code to map and English words, so
 *  it is said by its status, in the reader's language (amendments A-9). Everything else is
 *  `refusedFor`'s: a timeout's own sentence says the admission may have gone through. */
const reasonOf = (t, err) => (err?.status === 404 && !err.apiCode ? t("errors.requestFailed", { status: 404 }) : err);

/** Two names as a nurse reads them alike: spaces collapsed, case folded. */
const sameName = (a, b) => {
  const plain = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return plain(a) === plain(b);
};

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
 *  the focus (the form it replaces is gone), and what did not land is said aloud once. */
function NumberBox({ done, onNext }) {
  const { t } = useI18n();
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const failed = PARTS.filter((part) => done.engine?.[part] === "failed");
  const notes = [
    ...(done.recovered ? [t("kabul.recordedNoAnswer")] : []),
    ...failed.map((part) => t(ENGINE_FAILED[part])),
  ];
  return (
    <Box>
      <h2 ref={heading} tabIndex={-1}
        className={`m-0 mb-2.5 flex items-center gap-2 font-text text-11 font-bold uppercase leading-[normal] tracking-[.08em] text-mute ${FOCUS_RING}`}>
        <Icon name="ok" size={15} />
        {t("kabul.doneTitle")}
      </h2>
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
        <Button onClick={onNext}>{t("kabul.next")}</Button>
      </div>
      <Announce text={notes.join(" ")} />
    </Box>
  );
}

export function AdmitTab() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { structure, index, phase, error, reload } = useStructure();
  const toast = useToast();
  const canAdmit = user?.perms?.includes("admissions.admit") ?? false;
  const [form, setForm] = useState(emptyForm);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [held, setHeld] = useState(null);           // {bed}: a send got no answer and its bed is taken
  const [focusTo, setFocusTo] = useState(null);     // {field}: focused once the render it asks for is drawn
  const sending = useRef(false);                    // a send in flight — a ref, so a second press in the same tick sees it
  const unanswered = useRef([]);                    // every send of this form that got no answer: {bedId, bed, name}
  const uid = useId();
  const idOf = (field) => `${uid}-${field}`;
  const panelId = `${uid}-panel`;
  const heldId = `${uid}-held`;
  const today = localToday();
  const gaps = useMemo(() => missing(form, today), [form, today]);
  const wrong = (field) => (tried ? gaps.find((g) => g.field === field) : null);
  const errorOf = (field) => (wrong(field) ? t(wrong(field).key) : undefined);
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const age = ageOf(form.dob, today);

  useEffect(() => { reload(); }, [reload]);

  // A bed a re-read shows taken, closed or gone is no longer the form's: the panel names it missing.
  useEffect(() => {
    if (structure === null || form.bedId === null) return;
    if (admissible(index.beds.get(normId(form.bedId)))) return;
    setForm((prev) => (prev.bedId === form.bedId ? { ...prev, bedId: null, bedLabel: null } : prev));
  }, [structure, index, form.bedId]);

  useEffect(() => {
    if (focusTo) document.getElementById(`${uid}-${focusTo.field}`)?.focus();
  }, [focusTo, uid]);

  if (!canAdmit) return <Note tone="info" icon="eye">{t("kabul.readOnly")}</Note>;
  if (done) {
    return <NumberBox done={done} onNext={() => { setDone(null); setFocusTo({ field: "name" }); }} />;
  }

  const bedText = form.bedLabel ?? "";

  /** An admission written — by this send's answer, or found after one that got none. */
  function admitted(next) {
    unanswered.current = [];
    setHeld(null);
    setDone(next);
    setForm(emptyForm());
    setTried(false);
    toast(doneFor(t, next.bed, t("kabul.admitted", { number: next.number })));
  }

  /** The DRAFT a send with no answer left after all — on its bed, under the name it sent — with
   *  that send; null when none shows, undefined when the list could not be read. */
  async function findLanded() {
    let rows;
    try {
      rows = await store.track(() => store.api.admissions(["DRAFT"]));
    } catch {
      return undefined;
    }
    for (const row of Array.isArray(rows) ? rows : []) {
      const send = unanswered.current.find((s) => normId(s.bedId) === normId(row.bed_id) && sameName(s.name, row.display_name));
      if (send) return { row, send };
    }
    return null;
  }

  /** The bed of a send with no answer is taken: its DRAFT is the admission, else "Kabul et" waits
   *  until the nurse has looked. */
  async function bedTaken(err, sent) {
    const landed = await findLanded();
    if (landed) {
      admitted({ number: landed.row.patient_number, bed: landed.send.bed, engine: null, recovered: true });
      return;
    }
    setHeld({ bed: sent.bed });
    toast(refusedFor(t, sent.bed, reasonOf(t, err)), "error");
  }

  async function failed(err, sent) {
    if (mayHaveLanded(err)) {
      unanswered.current = [...unanswered.current, sent];
      const tree = await reload();
      if (admissible(indexStructure(tree).beds.get(normId(sent.bedId)))) {
        // Nothing landed yet. Sent again to this bed, the server gives it to one of the two.
        toast(refusedFor(t, sent.bed, reasonOf(t, err)), "error");
        return;
      }
      await bedTaken(err, sent);
      return;
    }
    if (err?.apiCode === "bed_not_available" && unanswered.current.some((s) => normId(s.bedId) === normId(sent.bedId))) {
      // Taken — perhaps by the send to this bed that got no answer.
      await reload();
      await bedTaken(err, sent);
      return;
    }
    toast(refusedFor(t, sent.bed, reasonOf(t, err)), "error");
    await reload();
  }

  async function submit(event) {
    event.preventDefault();
    if (sending.current || held) return;
    if (gaps.length > 0) {
      setTried(true);
      setFocusTo({ field: gaps[0].field });
      return;
    }
    sending.current = true;
    setBusy(true);
    const sent = { bedId: form.bedId, bed: bedText, name: form.name };
    try {
      if (unanswered.current.length > 0) {
        // An earlier send got no answer: if it landed after all, it is the admission.
        const landed = await findLanded();
        if (landed) {
          admitted({ number: landed.row.patient_number, bed: landed.send.bed, engine: null, recovered: true });
          reload();
          return;
        }
      }
      const answer = await store.track(() => store.api.admit(toBody(form)));
      admitted({ number: answer.patient_number, bed: sent.bed, engine: answer.engine });
      reload();
    } catch (err) {
      await failed(err, sent);
    } finally {
      sending.current = false;
      setBusy(false);
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
            <p id={heldId} className="m-0 text-12.5 font-semibold text-crit-ink">{t("kabul.heldNoAnswer", { bed: held.bed, where })}</p>
            <Button size="sm" onClick={() => { unanswered.current = []; setHeld(null); }}>{t("kabul.heldGoOn")}</Button>
          </div>
        ) : null}
        {form.bedId ? <p className="m-0 mt-2"><Tag icon="bed">{bedText}</Tag></p> : null}
        <Announce text={busy ? t("kabul.admitting") : ""} />
      </aside>
    </form>
  );
}

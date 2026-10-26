// src/live/screens/kabul/AdmitTab.jsx — "Kabul": the admission form (Group 2 · B1a, spec §3.1,
// §5.2). The prototype's "Elle kayıt", grouped Kimlik · Kabul · İletişim ve onam · Yatak, with a
// side panel naming every required field still missing. "Kabul et" is held (aria-disabled, never
// disabled: it keeps its focus, and pressed it says why) until that panel is empty.
//
// One request writes the admission (POST /admissions). The answer's patient number is shown large,
// with what the nurse does with it — she enters it on the bedside device — and any part of the
// engine write that did not land, named, so it is entered by hand. A refusal goes on the toast,
// named after the bed (amendments (a), (f)); a write with no answer may have landed, and the
// structure is read again either way, so the bed picker never offers a bed that was just taken.
import React, { useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { Announce, Box, Button, Field, Input, Note, Select, Tag, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { doneFor, refusedFor } from "../admin/refusal.js";
import {
  ADMISSION_TYPES, BLOOD_GROUPS, COMORBIDITIES, CONSENTS, ENGINE_FAILED, NATIONALITIES, RELATIONS,
  SEXES, SOURCES, ageOf, emptyForm, missing, toBody,
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

/** A required one-of choice (radio buttons) — its words from `options[].key`. */
function Choice({ name, legend, options, value, onChange, error }) {
  const { t } = useI18n();
  return (
    <fieldset aria-invalid={error ? "true" : undefined} className="mb-2.5 min-w-0 border-0 p-0">
      <legend className="mb-1.5 text-13.5 font-semibold text-mute">{legend}<span aria-hidden="true" className="text-crit-ink"> *</span></legend>
      <div className="flex flex-wrap gap-3">
        {options.map((option) => (
          <label key={option.value} className="inline-flex items-center gap-1.5 text-13.5">
            <input type="radio" name={name} value={option.value} checked={value === option.value}
              onChange={() => onChange(option.value)} className={FOCUS_RING} />
            {t(option.key)}
          </label>
        ))}
      </div>
      {error ? <p className="m-0 mt-1 text-12 font-semibold text-crit-ink">{error}</p> : null}
    </fieldset>
  );
}

function NumberBox({ done, onNext }) {
  const { t } = useI18n();
  const failed = ["board", "weight", "profile"].filter((part) => done.engine?.[part] === "failed");
  return (
    <Box title={t("kabul.doneTitle")} icon="ok" level={2}>
      <p className="m-0 text-13 text-mute">{t("kabul.doneBed", { bed: done.bed })}</p>
      <p className="m-0 my-2 font-data text-34 font-bold tracking-[.06em] text-ink">{done.number}</p>
      <p className="m-0 text-14 font-semibold">{t("kabul.enterOnDevice")}</p>
      {failed.map((part) => (
        <Note key={part} tone="warn" icon="alert">{t(ENGINE_FAILED[part])}</Note>
      ))}
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`#/patients/${encodeURIComponent(done.number)}`}
          className={`inline-flex items-center gap-1.5 rounded-ctl bg-pri px-[13px] py-2 text-13 font-semibold text-onpri ${FOCUS_RING}`}>
          {t("kabul.seeOnBoard")}
        </a>
        <Button onClick={onNext}>{t("kabul.next")}</Button>
      </div>
    </Box>
  );
}

export function AdmitTab() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { structure, reload } = useStructure();
  const toast = useToast();
  const canAdmit = user?.perms?.includes("admissions.admit") ?? false;
  const [form, setForm] = useState(emptyForm);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const panelId = useId();
  const today = localToday();
  const gaps = useMemo(() => missing(form, today), [form, today]);
  const wrong = (field) => (tried ? gaps.find((g) => g.field === field) : null);
  const errorOf = (field) => (wrong(field) ? t(wrong(field).key) : undefined);
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const age = ageOf(form.dob, today);

  useEffect(() => { reload(); }, [reload]);

  if (!canAdmit) return <Note tone="info" icon="eye">{t("kabul.readOnly")}</Note>;
  if (done) return <NumberBox done={done} onNext={() => setDone(null)} />;

  const bedText = form.bedLabel ?? "";
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (gaps.length > 0) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      const answer = await store.track(() => store.api.admit(toBody(form)));
      setDone({ number: answer.patient_number, bed: bedText, engine: answer.engine });
      setForm(emptyForm());
      setTried(false);
      toast(doneFor(t, bedText, t("kabul.admitted", { number: answer.patient_number })));
    } catch (err) {
      toast(refusedFor(t, bedText, reasonOf(t, err)), "error");
    } finally {
      setBusy(false);
      reload();
    }
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-3 min-[1100px]:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-w-0 gap-3">
        <Box title={t("kabul.groupIdentity")} icon="user" level={2}>
          <Field label={t("kabul.f.name")} required error={errorOf("name")}>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.father")}>
            <Input value={form.father} onChange={(e) => set({ father: e.target.value })} autoComplete="off" />
          </Field>
          <Choice name="sex" legend={t("kabul.f.sex")} options={SEXES} value={form.sex}
            onChange={(sex) => set({ sex })} error={errorOf("sex")} />
          <Field label={t("kabul.f.dob")} required error={errorOf("dob")}
            hint={age ? t("kabul.age", age) : undefined}>
            <Input type="date" max={today} value={form.dob} onChange={(e) => set({ dob: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.nationality")}>
            <Select value={form.nationality} onChange={(e) => set({ nationality: e.target.value })}>
              {NATIONALITIES.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.fin")} hint={t("kabul.finHint")} error={errorOf("fin")}>
            <Input value={form.fin} maxLength={7} onChange={(e) => set({ fin: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.passport")}>
            <Input value={form.passport} onChange={(e) => set({ passport: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.phone")} hint={t("kabul.phoneHint")}>
            <Input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="off" />
          </Field>
        </Box>

        <Box title={t("kabul.groupAdmission")} icon="clip" level={2}>
          <Field label={t("kabul.f.type")} required error={errorOf("type")}>
            <Select value={form.type} onChange={(e) => set({ type: e.target.value })}>
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
            <Input value={form.diagnosis} maxLength={500} onChange={(e) => set({ diagnosis: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.weight")} error={errorOf("weight")}>
            <Input inputMode="decimal" value={form.weight} onChange={(e) => set({ weight: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.height")} error={errorOf("height")}>
            <Input inputMode="numeric" value={form.height} onChange={(e) => set({ height: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.blood")}>
            <Select value={form.blood} onChange={(e) => set({ blood: e.target.value })}>
              {BLOOD_GROUPS.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.allergy")} required error={errorOf("allergy")}>
            <Input value={form.allergy} readOnly={form.noAllergy} maxLength={500}
              onChange={(e) => set({ allergy: e.target.value })} />
          </Field>
          <label className="mb-2.5 flex items-center gap-2 text-13.5">
            <input type="checkbox" checked={form.noAllergy} className={FOCUS_RING}
              onChange={(e) => set({ noAllergy: e.target.checked, allergy: e.target.checked ? "" : form.allergy })} />
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
            <Input value={form.relativeName} onChange={(e) => set({ relativeName: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.relativeRelation")}>
            <Select value={form.relativeRelation} onChange={(e) => set({ relativeRelation: e.target.value })}>
              <option value="">{t("kabul.choose")}</option>
              {RELATIONS.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.relativePhone")}>
            <Input type="tel" value={form.relativePhone} onChange={(e) => set({ relativePhone: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.companion")}>
            <Input value={form.companion} onChange={(e) => set({ companion: e.target.value })} autoComplete="off" />
          </Field>
          <Choice name="consent" legend={t("kabul.f.consent")} options={CONSENTS} value={form.consent}
            onChange={(consent) => set({ consent })} error={errorOf("consent")} />
          <label className="flex items-center gap-2 text-13.5">
            <input type="checkbox" checked={form.sms} className={FOCUS_RING} onChange={(e) => set({ sms: e.target.checked })} />
            {t("kabul.sms")}
          </label>
        </Box>

        <Box title={t("kabul.groupBed")} icon="bed" level={2}>
          <BedPicker structure={structure} unitId={form.unitId} bedId={form.bedId} invalid={Boolean(wrong("bed"))}
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
          aria-disabled={gaps.length > 0 ? "true" : undefined} aria-describedby={panelId}>
          {t("kabul.admit")}
        </Button>
        {form.bedId ? <p className="m-0 mt-2"><Tag icon="bed">{bedText}</Tag></p> : null}
        <Announce text={busy ? t("kabul.admitting") : ""} />
      </aside>
    </form>
  );
}

// src/live/screens/patient/careTeam/AddMemberDialog.jsx — «Ekibe ekle» (Group 2 · B1c, spec §4, D8, T8).
//
// - The physician is picked by NAME from the candidates route: every physician of the tenant, from every
//   unit, who is not already on the team (D8). No id is shown; the radio holds none.
// - The role: Yardımcı hekim, Nöbetçi hekim or Sorumlu hekim. An on-call physician needs her window: a
//   start (now by default) and an end, at most 48 hours later and in the future (`windowProblem`). The
//   two ends go out as instants with their offset (X9).
// - Making a new attending says, above the button, who leaves: «<ad> sorumlu hekim olur; <önceki> ekipten
//   çıkar.» The button is the answer to that one question (X6).
// The server checks all of it again. A refusal goes on the toast, named after the bed, and the box reads
// the team again (`onRefused`). A success is said on the toast and handed to the box (`onDone`), which
// reads the team before the dialog lets go of its buttons.
import React, { useEffect, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { useSession } from "../../../session/SessionProvider.jsx";
import { readErrorText } from "../../../apiErrors.js";
import { Button, Field, Input, Modal, Note, useToast } from "../../../ui/index.js";
import { FOCUS_RING } from "../../../ui/focus.js";
import { doneFor, reasonOf, refusedFor } from "../../admin/refusal.js";
import { fromLocalInput, localInput } from "../../kabul/DischargeDialog.jsx";
import { ROLES, matchesName, windowProblem } from "./careTeam.js";

const FORM_ID = "ekip-add";

/** `subject`: the bed, "label · room · unit". `attending`: the attending's row, or null. `onDone(text)`
 *  is awaited; `onRefused` is not. */
export function AddMemberDialog({ admissionId, subject, attending, onClose, onDone, onRefused }) {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [candidates, setCandidates] = useState({ rows: null, error: null });
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(null);
  const [role, setRole] = useState("ASSOCIATE_PHYSICIAN");
  const [start, setStart] = useState(() => localInput(Date.now()));
  const [end, setEnd] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const rows = await store.track(() => store.api.careTeamCandidates(admissionId));
        if (live) setCandidates({ rows: Array.isArray(rows) ? rows : [], error: null });
      } catch (error) {
        if (live) setCandidates({ rows: [], error });
      }
    })();
    return () => { live = false; };
  }, [store, admissionId]);

  const all = candidates.rows ?? [];
  const shown = all.filter((c) => matchesName(c.full_name, query));
  const person = all.find((c) => c.user_id === chosen) ?? null;
  const oncall = role === "ONCALL_PHYSICIAN";
  const startMs = fromLocalInput(start);
  const endMs = fromLocalInput(end);
  const problem = oncall ? windowProblem(startMs, endMs, Date.now()) : null;
  const errors = {
    physician: person ? null : t("ekip.dialog.need.physician"),
    start: problem === "start" ? t("ekip.dialog.need.start") : null,
    end: problem && problem !== "start" ? t(`ekip.dialog.need.${problem}`) : null,
  };
  const physicianError = `${FORM_ID}-physician-error`;

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (errors.physician || errors.start || errors.end) {
      setTried(true);
      return;
    }
    setBusy(true);
    const body = oncall
      ? { user_id: person.user_id, role, window_start: new Date(startMs).toISOString(), window_end: new Date(endMs).toISOString() }
      : { user_id: person.user_id, role };
    try {
      await store.track(() => store.api.addCareTeamMember(admissionId, body));
      const said = t(role === "ATTENDING" ? "ekip.done.promote" : "ekip.done.add", { name: person.full_name });
      toast(doneFor(t, subject, said));
      await onDone(said);
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
      onRefused?.();
    } finally {
      setBusy(false);
    }
  }

  let list;
  if (candidates.rows === null) list = <p className="m-0 text-13 text-mute">{t("ekip.dialog.loading")}</p>;
  else if (candidates.error) {
    list = <p className="m-0 text-13 text-crit-ink">{t("ekip.dialog.failed", { reason: readErrorText(t, candidates.error) })}</p>;
  } else if (all.length === 0) list = <p className="m-0 text-13 text-mute">{t("ekip.dialog.none")}</p>;
  else if (shown.length === 0) list = <p className="m-0 text-13 text-mute">{t("ekip.dialog.noMatch")}</p>;
  else {
    list = (
      <ul className="m-0 grid max-h-[220px] list-none gap-1 overflow-y-auto p-0">
        {shown.map((c) => (
          <li key={c.user_id}>
            <label className="inline-flex items-center gap-1.5 text-13.5">
              <input type="radio" name={`${FORM_ID}-physician`} checked={chosen === c.user_id} disabled={busy}
                onChange={() => setChosen(c.user_id)} className={FOCUS_RING} />
              {c.full_name}
            </label>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Modal open title={t("ekip.dialog.title", { bed: subject })} onClose={onClose} busy={busy}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
          <Button type="submit" form={FORM_ID} variant="primary" icon="userPlus" busy={busy}>{t("ekip.dialog.submit")}</Button>
        </>
      )}>
      <form id={FORM_ID} noValidate onSubmit={submit}>
        <Field label={t("ekip.dialog.search")}>
          <Input type="search" value={query} readOnly={busy} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <fieldset className="mb-2.5 min-w-0 border-0 p-0"
          aria-describedby={tried && errors.physician ? physicianError : undefined}>
          <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("ekip.dialog.physician")}</legend>
          {list}
          {tried && errors.physician
            ? <p id={physicianError} role="alert" className="m-0 mt-1 text-12.5 text-crit-ink">{errors.physician}</p>
            : null}
        </fieldset>
        <fieldset className="mb-2.5 min-w-0 border-0 p-0">
          <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("ekip.dialog.role")}</legend>
          <div className="flex flex-wrap gap-3">
            {ROLES.map((value) => (
              <label key={value} className="inline-flex items-center gap-1.5 text-13.5">
                <input type="radio" name={`${FORM_ID}-role`} checked={role === value} disabled={busy}
                  onChange={() => setRole(value)} className={FOCUS_RING} />
                {t(`ekip.role.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {oncall ? (
          <>
            <Field label={t("ekip.dialog.start")} required error={tried ? errors.start ?? undefined : undefined}>
              <Input type="datetime-local" value={start} readOnly={busy} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label={t("ekip.dialog.end")} required hint={t("ekip.dialog.windowHint")}
              error={tried ? errors.end ?? undefined : undefined}>
              <Input type="datetime-local" value={end} readOnly={busy} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </>
        ) : null}
        {role === "ATTENDING" && person ? (
          <Note tone="warn" icon="alert">
            {attending
              ? t("ekip.ask.body", { name: person.full_name, previous: attending.full_name })
              : t("ekip.ask.alone", { name: person.full_name })}
          </Note>
        ) : null}
      </form>
    </Modal>
  );
}

// src/live/screens/patient/careTeam/AddMemberDialog.jsx — «Ekibe ekle» (Group 2 · B1c, spec §4, D8, T8).
//
// - The physician is picked by NAME from the candidates route: every physician of the tenant, from every
//   unit, who is not already on the team (D8). No id is shown; the radio holds none. The row she picked
//   stays on the list whatever the search says, so what is sent is always what is seen; Enter in the
//   search box sends nothing (the search is not a place to answer the dialog), and Escape there clears
//   the search before it closes the dialog.
// - The role: Yardımcı hekim, Nöbetçi hekim or Sorumlu hekim. An on-call physician needs her window: a
//   start (now by default) and an end, at most 48 hours later and in the future (`windowProblem`). The
//   two ends go out as instants with their offset (X9). The window is checked at the moment of the press,
//   against that moment's clock, not the clock of the last draw. A send stopped for a field moves the
//   focus to the first one at fault, whose error then describes it (as BedStateDialog's note does).
// - Making a new attending says, above the button, who leaves: «<ad> sorumlu hekim olur; <önceki> ekipten
//   çıkar.» The button is the answer to that one question (X6), and says so: the sentence describes it.
// The server checks all of it again. A refusal goes on the toast, named after the bed, and the box reads
// the team again (`onRefused`); unless it was about a field, the list of physicians is read again too,
// for the one she picked may be on the team by now. A success is said on the toast and handed to the box
// (`onDone`), which reads the team before the dialog lets go of its buttons.
import React, { useCallback, useEffect, useRef, useState } from "react";
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
 *  is awaited, outside the add's own try: it MUST handle its own read failure (CareTeamBox's does), for a
 *  throw from it is not a refusal of an add that has landed and is never told to the reader as one.
 *  `onRefused` is not awaited. */
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
  const [asked, setAsked] = useState(0);        // bumped by a send stopped for a field: draws the errors, moves the focus
  const want = useRef(null);                    // the control the focus goes to: "physician" | "start" | "end"
  const searchRef = useRef(null);
  const firstRadio = useRef(null);
  const startRef = useRef(null);
  const endRef = useRef(null);
  const seq = useRef(0);

  // The physicians, read when the dialog opens and again after a refusal. An answer that is not the latest
  // read's, or that comes after the dialog has gone, is dropped. A re-read that fails keeps the rows it had.
  const load = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    try {
      const rows = await store.track(() => store.api.careTeamCandidates(admissionId));
      if (seq.current === mine) setCandidates({ rows: Array.isArray(rows) ? rows : [], error: null });
    } catch (error) {
      if (seq.current === mine) setCandidates((prev) => ({ rows: prev.rows ?? [], error }));
    }
  }, [store, admissionId]);

  useEffect(() => {
    load();
    return () => { seq.current += 1; };
  }, [load]);

  useEffect(() => {
    if (asked === 0) return;
    const target = { physician: firstRadio.current ?? searchRef.current, start: startRef.current, end: endRef.current }[want.current];
    target?.focus();
  }, [asked]);

  const all = candidates.rows ?? [];
  // The picked row stays whatever is typed: a hidden choice would be sent unseen.
  const shown = all.filter((c) => c.user_id === chosen || matchesName(c.full_name, query));
  const person = all.find((c) => c.user_id === chosen) ?? null;
  const oncall = role === "ONCALL_PHYSICIAN";
  const startMs = fromLocalInput(start);
  const endMs = fromLocalInput(end);
  const windowAt = (nowMs) => (oncall ? windowProblem(startMs, endMs, nowMs) : null);
  const problem = windowAt(Date.now());          // for drawing; the press decides with its own clock
  const errors = {
    physician: person ? null : t("ekip.dialog.need.physician"),
    start: problem === "start" ? t("ekip.dialog.need.start") : null,
    end: problem && problem !== "start" ? t(`ekip.dialog.need.${problem}`) : null,
  };
  const physicianError = `${FORM_ID}-physician-error`;
  const askId = `${FORM_ID}-ask`;
  const asking = role === "ATTENDING" && person !== null;

  function searchKey(event) {
    if (event.key === "Enter") event.preventDefault();
    else if (event.key === "Escape" && query !== "") {
      event.preventDefault();       // the dialog's own Escape ignores a stopped key; the search is cleared first
      setQuery("");
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const fresh = windowAt(Date.now());
    const first = !person ? "physician" : fresh === "start" ? "start" : fresh ? "end" : null;
    if (first) {
      want.current = first;
      setTried(true);
      setAsked((n) => n + 1);
      return;
    }
    setBusy(true);
    const body = oncall
      ? { user_id: person.user_id, role, window_start: new Date(startMs).toISOString(), window_end: new Date(endMs).toISOString() }
      : { user_id: person.user_id, role };
    let said = null;
    try {
      await store.track(() => store.api.addCareTeamMember(admissionId, body));
      said = t(role === "ATTENDING" ? "ekip.done.promote" : "ekip.done.add", { name: person.full_name });
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
      onRefused?.();
      // A 422 is about a field she can mend here. Any other refusal says the list may be out of date
      // (the physician is on the team already): it is read again. A session that ended has no reader.
      if (err?.status !== 422 && !err?.superseded) load();
    }
    try {
      if (said !== null) {
        toast(doneFor(t, subject, said));
        await onDone(said);
      }
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
        {shown.map((c, index) => (
          <li key={c.user_id}>
            <label className="inline-flex items-center gap-1.5 text-13.5">
              <input ref={index === 0 ? firstRadio : undefined} type="radio" name={`${FORM_ID}-physician`}
                checked={chosen === c.user_id} disabled={busy}
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
          <Button type="submit" form={FORM_ID} variant="primary" icon="userPlus" busy={busy}
            aria-describedby={asking ? askId : undefined}>
            {t("ekip.dialog.submit")}
          </Button>
        </>
      )}>
      <form id={FORM_ID} noValidate onSubmit={submit}>
        <Field label={t("ekip.dialog.search")}>
          <Input ref={searchRef} type="search" value={query} readOnly={busy} onKeyDown={searchKey}
            onChange={(e) => setQuery(e.target.value)} />
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
              <Input ref={startRef} type="datetime-local" value={start} readOnly={busy}
                onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label={t("ekip.dialog.end")} required hint={t("ekip.dialog.windowHint")}
              error={tried ? errors.end ?? undefined : undefined}>
              <Input ref={endRef} type="datetime-local" value={end} readOnly={busy}
                onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </>
        ) : null}
        {asking ? (
          <div id={askId}>
            <Note tone="warn" icon="alert">
              {attending
                ? t("ekip.ask.body", { name: person.full_name, previous: attending.full_name })
                : t("ekip.ask.alone", { name: person.full_name })}
            </Note>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

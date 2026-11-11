// src/live/screens/patient/careTeam/CareTeamBox.jsx — «Bakım ekibi» on the patient screen (Group 2 · B1c,
// spec §4, D1–D8).
//
// Who is responsible for this patient: the attending (one, D2), the associates and the on-call
// physicians, by name and never by id.
//
// - A session without `admissions.view` reads nothing and shows nothing. The box finds the admission as
//   SignOffStrip does: the open admission of the caller's units whose board key is this card's. Another
//   unit's patient, whom the board may show a member from outside her units, has no box (spec §7).
// - A DRAFT says the attending comes with the signature (D3).
// - Each active member: her name, her role, an on-call window with «süresi doldu» once it has passed,
//   and who added her. The attending's row has no remove: it ends when another attending is made (T5).
// - «Önceki üyeler (n)», folded: the closed rows, each with when it ended.
// - The buttons are §4's table (`careTeam.js`). Making a new attending asks once who leaves (X6).
//   «Ekibe ekle» opens AddMemberDialog.jsx.
// - One write at a time. The pressed button is held until its write AND the re-read after it are in
//   (A-17); a second press does nothing. A success is said on the toast and under the list; a refusal
//   on the toast alone (screens/admin/refusal.js, X7). The team is read again after either. The re-read
//   never throws: AddMemberDialog awaits `onDone` inside the try of its add, and a throw from here would
//   be told to the reader as a refusal of an add that had landed. A read that fails says so in the box.
// - When a write takes the pressed button away (its row left the team), the focus that fell to <body>
//   goes to the box's heading. A focus the reader has moved since is left where it is. The add dialog
//   gives the focus back to its opener on its own (Modal); the heading takes it only if the opener is gone.
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { useSession } from "../../../session/SessionProvider.jsx";
import { readErrorText } from "../../../apiErrors.js";
import { ddmmhhmm } from "../../../i18n/dates.js";
import { Announce, Button, Icon, Modal, useToast } from "../../../ui/index.js";
import { FOCUS_RING } from "../../../ui/focus.js";
import { doneFor, reasonOf, refusedFor } from "../../admin/refusal.js";
import { useAdmissions } from "../../kabul/useAdmissions.js";
import { boardKeyOf } from "../../kabul/boardKey.js";
import { AddMemberDialog } from "./AddMemberDialog.jsx";
import { OPEN, actionsFor, activeRows, attendingOf, canClaim, closedRows, expired } from "./careTeam.js";

/** The admissions are read again every minute, as the sign-off strip reads them: a signature given on
 *  another screen turns the DRAFT's line into the team within the minute. */
const EVERY_MS = 60_000;
/** The bed as the slice names it (SignOffStrip's `bedOf`). */
const bedOf = (row) => `${row.bed_label} · ${row.room_name} · ${row.unit_name}`;
const stamp = (iso) => {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) ? ddmmhhmm(ms) : "—";
};

/** `patientId`: the board's key of the card shown. `nowMs`: the screen's clock («süresi doldu»). */
export function CareTeamBox({ patientId, nowMs }) {
  const { user } = useSession();
  if (!(user?.perms?.includes("admissions.view") ?? false)) return null;
  return <Finder patientId={patientId} nowMs={nowMs} />;
}

function Finder({ patientId, nowMs }) {
  const { rows } = useAdmissions(OPEN, { every: EVERY_MS });
  const admission = rows?.find((r) => boardKeyOf(r) === patientId) ?? null;
  return admission ? <Team key={admission.id} admission={admission} nowMs={nowMs ?? Date.now()} /> : null;
}

/** One active member: her name, her role, her window, who added her, and the row's buttons. */
function Member({ row, nowMs, acts, busy, onPromote, onEnd }) {
  const { t } = useI18n();
  const hours = row.role === "ONCALL_PHYSICIAN" && row.window_start && row.window_end
    ? `${stamp(row.window_start)} – ${stamp(row.window_end)}` : null;
  const late = expired(row, nowMs);
  const named = (key) => `${t(key)}: ${row.full_name}`;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-ctl border border-line px-3 py-2">
      <div className="min-w-0 flex-1">
        <b className="block text-14 text-ink">{row.full_name}</b>
        <span className="block text-12.5 text-mute">
          {t(`ekip.role.${row.role}`)}
          {hours ? ` · ${hours}` : null}
          {late ? <> · <b className="text-att-ink">{t("ekip.expired")}</b></> : null}
          {row.granted_by_name ? ` · ${t("ekip.grantedBy", { name: row.granted_by_name })}` : null}
        </span>
        {row.role === "ATTENDING" ? <span className="block text-12 text-mute">{t("ekip.attendingStays")}</span> : null}
      </div>
      {acts.promote ? (
        <Button size="sm" icon="star" busy={busy === `promote:${row.id}`} onClick={onPromote}
          aria-label={named("ekip.action.promote")}>
          {t("ekip.action.promote")}
        </Button>
      ) : null}
      {acts.remove ? (
        <Button size="sm" icon="x" busy={busy === `remove:${row.id}`} onClick={() => onEnd("remove")}
          aria-label={named("ekip.action.remove")}>
          {t("ekip.action.remove")}
        </Button>
      ) : null}
      {acts.leave ? (
        <Button size="sm" icon="out" busy={busy === `leave:${row.id}`} onClick={() => onEnd("leave")}
          aria-label={named("ekip.action.leave")}>
          {t("ekip.action.leave")}
        </Button>
      ) : null}
    </li>
  );
}

function Team({ admission, nowMs }) {
  const { t } = useI18n();
  const { user, store } = useSession();
  const toast = useToast();
  const headingId = useId();
  const heading = useRef(null);
  const seq = useRef(0);
  const [team, setTeam] = useState({ rows: null, error: null });
  const [busy, setBusy] = useState(null);       // the write in flight: "claim", or "<kind>:<row id>"
  const [asking, setAsking] = useState(null);   // the new-attending question: {kind: "claim"} | {kind: "promote", row}
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState("");
  const [landed, setLanded] = useState(0);
  const [history, setHistory] = useState(false);
  const draft = admission.state === "DRAFT";
  const subject = bedOf(admission);
  const perms = user?.perms ?? [];

  // A read answered after a newer one began is dropped. It never rejects: a failure is said in `team.error`.
  const reload = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    try {
      const rows = await store.track(() => store.api.careTeam(admission.id));
      if (seq.current === mine) setTeam({ rows: Array.isArray(rows) ? rows : [], error: null });
    } catch (error) {
      if (seq.current === mine) setTeam((prev) => ({ rows: prev.rows, error }));    }
  }, [store, admission.id]);

  useEffect(() => { if (!draft) reload(); }, [draft, reload]);

  useEffect(() => {
    if (landed === 0) return;
    const focused = document.activeElement;
    if (!focused || focused === document.body) heading.current?.focus();
  }, [landed]);

  const active = activeRows(team.rows);
  const closed = closedRows(team.rows);
  const attending = attendingOf(team.rows);

  async function run(key, write, text) {
    if (busy !== null) return;
    setBusy(key);
    let ok = false;
    try {
      await store.track(write);
      toast(doneFor(t, subject, text));
      setSaid(text);
      ok = true;
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
    } finally {
      await reload();
      if (ok) setLanded((n) => n + 1);
      setBusy(null);
    }
  }

  function answer() {
    const what = asking;
    setAsking(null);
    if (what?.kind === "claim") {
      run("claim", () => store.api.claimAttending(admission.id), t("ekip.done.claim", { name: user?.fullName }));
    } else if (what?.kind === "promote") {
      run(`promote:${what.row.id}`,
        () => store.api.addCareTeamMember(admission.id, { user_id: what.row.user_id, role: "ATTENDING" }),
        t("ekip.done.promote", { name: what.row.full_name }));
    }
  }

  const end = (row, kind) => run(`${kind}:${row.id}`, () => store.api.endCareTeamMember(admission.id, row.id),
    t(`ekip.done.${kind}`, { name: row.full_name }));
  const ask = (what) => { if (busy === null) setAsking(what); };
  const claimable = !draft && team.rows !== null && canClaim({ user, perms, attending });
  const mayAdd = !draft && perms.includes("care_team.assign");
  const askName = asking?.kind === "claim" ? user?.fullName : asking?.row?.full_name;

  return (
    <section aria-labelledby={headingId} className="rounded-box border border-line bg-card px-[14px] py-3">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <h2 id={headingId} ref={heading} tabIndex={-1}
          className={`m-0 flex items-center gap-2 rounded-md font-text text-11 font-bold uppercase leading-[normal] tracking-[.08em] text-mute ${FOCUS_RING}`}>
          <Icon name="users" size={15} />
          {t("ekip.title")}
        </h2>
        <div className="ml-auto flex flex-wrap gap-2">
          {claimable ? (
            <Button size="sm" icon="star" busy={busy === "claim"} onClick={() => ask({ kind: "claim" })}>
              {t("ekip.action.claim")}
            </Button>
          ) : null}
          {mayAdd ? (
            <Button size="sm" icon="userPlus" onClick={() => { if (busy === null) setAdding(true); }}>
              {t("ekip.action.add")}
            </Button>
          ) : null}
        </div>
      </div>
      {draft ? <p className="m-0 text-13 text-mute">{t("ekip.draft")}</p> : (
        <>
          {team.error ? (
            <p className="m-0 mb-2 text-13 text-crit-ink">{t("ekip.readFailed", { reason: readErrorText(t, team.error) })}</p>
          ) : null}
          {team.rows === null && !team.error ? <p className="m-0 text-13 text-mute">{t("ekip.loading")}</p> : null}
          {team.rows !== null && active.length === 0 ? <p className="m-0 text-13 text-mute">{t("ekip.empty")}</p> : null}
          {active.length > 0 ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {active.map((row) => (
                <Member key={row.id} row={row} nowMs={nowMs} acts={actionsFor(row, { user, perms })} busy={busy}
                  onPromote={() => ask({ kind: "promote", row })} onEnd={(kind) => end(row, kind)} />
              ))}
            </ul>
          ) : null}
          {closed.length > 0 ? (
            <div className="mt-2.5">
              <button type="button" aria-expanded={history} onClick={() => setHistory((open) => !open)}
                className={`inline-flex items-center gap-1 rounded-md text-12.5 font-semibold text-pri ${FOCUS_RING}`}>
                <Icon name={history ? "chevD" : "chevR"} size={14} />
                {t("ekip.previous", { n: closed.length })}
              </button>
              {history ? (
                <ul className="m-0 mt-1.5 grid list-none gap-1 p-0">
                  {closed.map((row) => (
                    <li key={row.id} className="text-12.5 text-mute">
                      <b className="text-ink">{row.full_name}</b> · {t(`ekip.role.${row.role}`)} · {t("ekip.ended", { at: stamp(row.closed_at) })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {said ? <p className="m-0 mt-2 text-12.5 text-mute">{said}</p> : null}
        </>
      )}
      {/* A busy Button reads only "unavailable" to a screen reader; the words come from here. */}
      <Announce text={busy !== null ? t("ekip.working") : ""} />
      {asking ? (
        <Modal open title={t("ekip.ask.title")} onClose={() => setAsking(null)}
          actions={(
            <>
              <Button onClick={() => setAsking(null)}>{t("common.cancel")}</Button>
              <Button variant="primary" icon="ok" onClick={answer}>{t("ekip.ask.confirm")}</Button>
            </>
          )}>
          <p className="m-0 text-14">
            {attending
              ? t("ekip.ask.body", { name: askName, previous: attending.full_name })
              : t("ekip.ask.alone", { name: askName })}
          </p>
        </Modal>
      ) : null}
      {adding ? (
        <AddMemberDialog admissionId={admission.id} subject={subject} attending={attending}
          onClose={() => setAdding(false)}
          onDone={async (text) => {
            setSaid(text);
            await reload();
            setAdding(false);
            setLanded((n) => n + 1);   // the heading takes the focus only if the opener is gone (the effect above)
          }}
          onRefused={() => { reload(); }} />
      ) : null}
    </section>
  );
}

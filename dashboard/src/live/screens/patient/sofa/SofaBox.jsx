// src/live/screens/patient/sofa/SofaBox.jsx — the patient screen's SOFA box (G2-A4, D1), where the "forms come
// later" note stood: the severity form's total, how many organs it has no measurement for, and its last
// signature — «İmzalandı · {who} · {time} · toplam {n}», with the corrections' count when there were any — or
// «İmzalanmadı»; and «Formu aç».
//
// IT IS NOT THE SOFA OF THE SEPSIS-3 BOX BESIDE IT, and says so: that one is the alerting SOFA, read from the
// latest values; this one is the form's, read from the WORST values of the last 24 hours. Both are the
// engine's and correct, and they are not the same number. The box prints the engine's total and counts; it
// computes nothing (Decision 1).
//
// IT READS ONCE (spec O4: every read is a `score` row in the audit): when the patient is shown, after the form
// closes on a write, and when asked again after a failed read — not on a timer and not on every board frame
// (O9) — and when something on the patient screen writes a value the form reads (`reread`, G3-01: a bedside save
// or a «hatalı giriş»; one more `score` row in the audit per write, which is the price of a total that is not
// stale). The read's time is printed (X12), so an old total is never taken for a fresh one. The signature comes
// with the form (`last_signed`, D7), under the form's own permission: no audit right is needed to see it. An
// engine older than G2-A4 sends no `last_signed`; then no signature line is printed at all (X15).
//
// THE FORM IS A DIALOG (D1, A3's pattern). «Formu aç» is offered to every holder of `board.view` — the form is
// read-only without `clinical.chart` and `scores.sign` (X10). The shell keeps this screen mounted across a move
// to another patient (no `key`), so the box remembers WHOSE form it opened and binds the dialog's writes to that
// patient at the opening; a form opened on one patient is never shown on the next; a read that answers for an
// earlier patient is dropped; and an old opening's close closes nothing of a new one (MedsBox's rule).
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { readErrorText } from "../../../apiErrors.js";
import { useBoard } from "../../../data/BoardProvider.jsx";
import { useSession } from "../../../session/SessionProvider.jsx";
import { Box, Button, Icon, Note } from "../../../ui/index.js";
import { SofaFormModal } from "./SofaFormModal.jsx";
import { stampOf } from "./sofaFields.js";

/** The last signature as the box says it (D1, D7): who, when — with its day and month when it is not today's
 *  (X5) — and the total; how many cells were corrected, when any were. «İmzalanmadı» when the engine has none. */
function SignedLine({ last, nowMs }) {
  const { t } = useI18n();
  if (last === null) return <p className="m-0 mt-1 text-13 text-mute">{t("sofa.unsigned")}</p>;
  const corrected = Number.isInteger(last.corrections) && last.corrections > 0;
  const params = { who: last.signed_by ?? "—", time: stampOf(last.at, nowMs) || "—", total: last.total ?? "—", count: last.corrections };
  return (
    <p className="m-0 mt-1 flex items-start gap-1.5 text-13">
      <Icon name="ok" size={14} className="mt-0.5 shrink-0 text-ok-ink" />
      <span>{t(corrected ? "sofa.signedCorrected" : "sofa.signed", params)}</span>
    </p>
  );
}

/** `patientId` is whose form this is; `bed` names the patient in the dialog's title and on its toasts (never
 *  the patient's name, Decision 14); `nowMs` is the screen's clock, which says which stamps are today's.
 *  `reread` is `{ id, n }`: the screen's word that a write for patient `id` landed (`n` counts them); the box reads
 *  again when `n` moves and `id` is the patient it shows — not for a write of another one. */
export function SofaBox({ patientId, bed, nowMs = Date.now(), reread = null }) {
  const { t } = useI18n();
  const board = useBoard();
  const { user } = useSession();
  const canChart = user?.perms?.includes("clinical.chart") ?? false;
  const canSign = user?.perms?.includes("scores.sign") ?? false;
  // The last read and WHOSE it was: a read for an earlier patient is never shown for this one, not even for the
  // one render before the move's effect runs.
  const [read, setRead] = useState({ forId: null, form: null, error: null, reading: true });
  // `{ id, opening, api }`: the patient the form was opened FOR, which opening this is, and the writes bound to
  // that patient at the opening — a write in flight stays its patient's whatever the screen shows next.
  const [editing, setEditing] = useState(null);
  const openings = useRef(0);
  const reads = useRef(0);
  const shownFor = useRef(patientId);
  shownFor.current = patientId;
  const mounted = useRef(false);
  // True inside the effect (the house pattern), so StrictMode's rehearsal does not leave it false.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function load(id) {
    const mine = ++reads.current;
    setRead((r) => (r.forId === id ? { ...r, reading: true } : { forId: id, form: null, error: null, reading: true }));
    try {
      const form = await board.store.sofaForm(id);
      if (!mounted.current || mine !== reads.current) return;
      // null is the store's word for an answer it DROPPED — it came after the session ended; the engine answers
      // every read with a form. Nothing lands (review 2): the box stays as it was, reading or with its error,
      // and «noForm» is said only for an answer that is not a form.
      if (form === null) return;
      setRead({ forId: id, form: form ?? null, error: null, reading: false });
    } catch (err) {
      if (err?.superseded || !mounted.current || mine !== reads.current) return;
      // A failed read keeps what was read before for this patient, and says it could not read again.
      setRead((r) => ({ forId: id, form: r.forId === id ? r.form : null, error: err, reading: false }));
    }
  }
  // The patient shown, read; a form opened for the one before is forgotten.
  useEffect(() => {
    setEditing(null);
    load(patientId);
  }, [patientId]);

  // A write made elsewhere on the screen (the bedside form, a withdrawal): the total it moved is read back. Not on
  // mount, and not for the same count twice.
  const seenReread = useRef(reread?.n ?? 0);
  useEffect(() => {
    const n = reread?.n ?? 0;
    if (n === seenReread.current) return;
    seenReread.current = n;
    if (reread.id === patientId) load(patientId);
  }, [reread?.n]);

  function openForm() {
    openings.current += 1;
    const id = patientId;
    setEditing({
      id, opening: openings.current,
      api: {
        read: () => board.store.sofaForm(id),
        chart: (entries, recordedAt) => board.store.chart(id, entries, recordedAt),
        preview: (overrides) => board.store.sofaPreview(id, overrides),
        sign: (overrides, expect) => board.store.sofaSign(id, overrides, expect),
      },
    });
  }
  function closed(opening, id, changed) {
    // An old opening's close closes nothing of a new one …
    setEditing((current) => (current?.opening === opening ? null : current));
    // … and a write it made is read back only while its patient is still the one shown.
    if (changed && id === shownFor.current) load(id);
  }

  const mine = read.forId === patientId ? read : { form: null, error: null, reading: true };
  const { form } = mine;
  const unmeasured = Array.isArray(form?.unmeasured_organs) ? form.unmeasured_organs.length : null;
  const right = <Button size="sm" icon="clip" onClick={openForm}>{t("sofa.open")}</Button>;
  return (
    <Box title={t("sofa.title")} icon="clip" level={2} right={right}>
      {mine.error ? (
        <div className="mb-2">
          <Note tone="warn" icon="alert">{t("sofa.unreadable", { reason: readErrorText(t, mine.error) })}</Note>
          <Button size="sm" className="mt-1.5" onClick={() => load(patientId)} busy={mine.reading}>{t("sofa.retry")}</Button>
        </div>
      ) : null}
      {form ? (
        <>
          <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-13">
            <span className="text-mute">{t("sofa.boxTotal")}</span>{" "}
            <b className="font-data text-20 font-bold text-ink">{form.total ?? "—"}</b>
            {unmeasured !== null ? (
              <span className="text-mute">{` · ${unmeasured === 0 ? t("sofa.boxAllMeasured") : t("sofa.boxUnmeasured", { count: unmeasured })}`}</span>
            ) : null}
          </p>
          {"last_signed" in form ? <SignedLine last={form.last_signed ?? null} nowMs={nowMs} /> : null}
          <p className="m-0 mt-1.5 text-11.5 text-mute">
            {t("sofa.boxIntro")} {t("sofa.boxReadAt", { time: stampOf(form.window_to, nowMs) || "—" })}
          </p>
        </>
      ) : mine.error ? null : mine.reading ? (
        <p className="m-0 text-13 text-mute">{t("sofa.reading")}</p>
      ) : (
        <div>
          <p className="m-0 text-13 text-mute">{t("sofa.noForm")}</p>
          <Button size="sm" className="mt-1.5" onClick={() => load(patientId)}>{t("sofa.retry")}</Button>
        </div>
      )}
      {/* The dialog is the box's last child whatever the box shows, so a read that lands while it is open does
          not remount it. */}
      {editing && editing.id === patientId ? (
        <SofaFormModal
          key={editing.opening} bed={bed} nowMs={nowMs} canChart={canChart} canSign={canSign} api={editing.api}
          onClose={(changed) => closed(editing.opening, editing.id, changed)}
        />
      ) : null}
    </Box>
  );
}

// src/severityScore.jsx — the severity-score form (M2).
//
// The screen the hospital already has, done the way it should have been done: the physician does
// not fill it in, they confirm it. Every cell arrives from the record, scored on the WORST value
// of the window, carrying the measurement and the timestamp that produced it.
//
// Four things this component refuses to do, because each one is how a pre-filled clinical form
// turns into a liability:
//
//   1. It never lets a clinician type a POINT value. They correct the measurement; the engine
//      re-scores the row from the band table. A typed point would enter quality reporting
//      unbanded, and nothing downstream could tell it from a computed one.
//   2. It never renders an unmeasured organ as a healthy one. SOFA grades a missing organ 0,
//      which is right for the score and misleading for a reader, so the absence is stated.
//   3. It never accepts a correction without a reason. The engine enforces the minimum length;
//      this screen shows it up front rather than letting someone discover it on submit.
//   4. It never shows a score as signed until the engine says so. The signature is the moment a
//      number becomes someone's responsibility, and optimistic UI has no business there.
//
// Scores whose point tables the hospital has not yet given us render as "awaiting the table" —
// deliberately visible rather than hidden, because an empty tab looks like a missing feature and
// a stated one looks like the decision it is.

import React, { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, FileText, PenLine, X } from "lucide-react";

import { btnCls, inputCls } from "./clinicalUi.jsx";

/** Scores the module knows about. Only SOFA has a sourced table today; the rest say so. */
export const SEVERITY_TABS = [
  { key: "sofa", label: "SOFA", ready: true },
  { key: "apache2", label: "APACHE II", ready: false },
  { key: "prism3", label: "PRISM III", ready: false },
  { key: "snap2", label: "SNAP II", ready: false },
];

const fill = (text, vars) => String(text ?? "").replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

const clock = (iso) =>
  !iso ? "—" : new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });

function Badge({ tone, children }) {
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>{children}</span>;
}

/**
 * One organ row. A row can carry more than one measurement — SOFA's cardiovascular limb grades
 * mean pressure and up to four infusions together — so the cells are listed under the row rather
 * than flattened into it, which would imply each had its own score.
 */
function OrganRow({ T, S, row, hours, onCorrect, disabled }) {
  const name = S.pr6.sevOrgans?.[row.organ] || row.organ;
  return (
    <div className={`border-t ${T.border} py-2`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`min-w-[9rem] text-sm font-medium ${T.text}`}>{name}</span>
        <span className={`text-sm font-bold tabular-nums ${row.failure ? "text-amber-500" : T.text}`}>
          {row.points}
        </span>
        {row.failure && <Badge tone="bg-amber-500/15 text-amber-500">{S.pr6.sevOrganFailure}</Badge>}
        {!row.measured && (
          <Badge tone="bg-sky-500/15 text-sky-500">{S.pr6.sevNotMeasured}</Badge>
        )}
      </div>

      {row.inputs.map((cell) => (
        <div key={cell.code} className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 pl-2">
          <span className={`text-xs ${T.faint}`}>{cell.code}</span>
          <span className={`text-xs font-semibold tabular-nums ${T.text}`}>
            {cell.value ?? "—"}
          </span>
          <span className={`text-[11px] ${T.muted}`}>{clock(cell.at)}</span>
          {cell.source && <span className={`text-[11px] ${T.faint}`}>· {cell.source}</span>}
          {cell.overridden && (
            <Badge tone="bg-violet-500/15 text-violet-500">
              {S.pr6.sevCorrected} ({cell.original ?? "—"})
            </Badge>
          )}
          {cell.outside_window && (
            <Badge tone="bg-amber-500/15 text-amber-500" title={fill(S.pr6.sevOutsideHint, { h: hours })}>
              {S.pr6.sevOutside}
            </Badge>
          )}
          {!disabled && (
            <button onClick={() => onCorrect(cell)}
                    className={`ml-auto inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] ${T.ghost}`}>
              <PenLine size={11} /> {S.pr6.sevCorrect}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** The correction dialog. Value and reason; the reason's minimum is shown, not sprung. */
function CorrectionEditor({ T, S, cell, minReason, onCancel, onSave }) {
  const [value, setValue] = useState(cell.value == null ? "" : String(cell.value));
  const [reason, setReason] = useState("");
  const short = reason.trim().length < minReason;
  const noValue = value.trim() === "" || Number.isNaN(Number(value));

  return (
    <div className={`mt-2 rounded-xl border ${T.border} ${T.subtle} p-3`}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`text-xs font-semibold ${T.text}`}>{cell.code}</span>
        <button onClick={onCancel} className={`ml-auto ${T.faint}`} aria-label={S.pr6.sevCancel}>
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`text-xs ${T.muted}`}>{S.pr6.sevNewValue}</label>
        <input type="number" step="any" className={`${inputCls(T)} w-28`} value={value}
               onChange={(e) => setValue(e.target.value)} />
      </div>
      <textarea
        className={`${inputCls(T)} mt-2 h-16 w-full`} value={reason}
        placeholder={fill(S.pr6.sevReasonHint, { n: minReason })}
        onChange={(e) => setReason(e.target.value)} />
      <div className="mt-1 flex items-center gap-2">
        <span className={`text-[11px] ${short ? "text-amber-500" : T.faint}`}>
          {reason.trim().length}/{minReason}
        </span>
        <button disabled={short || noValue}
                onClick={() => onSave({ code: cell.code, value: Number(value), reason: reason.trim() })}
                className={`ml-auto ${btnCls(T, "primary")} px-3 py-1.5 text-xs disabled:opacity-40`}>
          {S.pr6.sevCorrect}
        </button>
      </div>
    </div>
  );
}

export function SeverityScorePanel({ T, S, store, patient, patientId, hours = 24,
                                     minReason = 20, onPrint }) {
  const [tab, setTab] = useState("sofa");
  const [form, setForm] = useState(null);
  const [signed, setSigned] = useState(null);
  const [editing, setEditing] = useState(null);
  const [pending, setPending] = useState([]);     // corrections not yet signed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const active = SEVERITY_TABS.find((t) => t.key === tab) || SEVERITY_TABS[0];

  const load = useCallback(() => {
    if (!active.ready || typeof store?.severityForm !== "function") return;
    setError("");
    store.severityForm(patientId, { score: tab, hours })
      .then((f) => { setForm(f); setSigned(null); setPending([]); })
      .catch(() => { setForm(null); setError(S.pr6.sevFailed); });
  }, [store, patientId, tab, hours, active.ready, S.pr6.sevFailed]);

  useEffect(load, [load]);

  const applyCorrection = (correction) => {
    // Held locally until signing. The engine is the only thing that re-scores, so the preview is
    // refreshed from it rather than recomputed here — two scorers is exactly how the number on
    // the screen and the number in the record start to differ.
    const next = [...pending.filter((p) => p.code !== correction.code), correction];
    setPending(next);
    setEditing(null);
  };

  const signForm = async () => {
    setBusy(true); setError("");
    try {
      const result = await store.signSeverityForm(patientId, { score: tab, hours, overrides: pending });
      setSigned(result);
      setForm(result.form);
      setPending([]);
    } catch (exception) {
      setError(exception?.message || S.pr6.sevFailed);
    } finally {
      setBusy(false);
    }
  };

  if (!active.ready) {
    return (
      <div className={`rounded-xl border ${T.border} ${T.subtle} p-3`}>
        <Tabs T={T} tab={tab} setTab={setTab} />
        <div className={`mt-2 text-sm font-semibold ${T.text}`}>{S.pr6.sevPending}</div>
        <div className={`mt-0.5 text-xs ${T.faint}`}>{S.pr6.sevPendingHint}</div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${T.border} ${T.subtle} p-3`}>
      <Tabs T={T} tab={tab} setTab={setTab} />

      <p className={`mt-2 text-[11px] leading-snug ${T.faint}`}>
        {fill(S.pr6.severitySub, { h: hours })}
      </p>

      {error && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{error}</div>}

      {form && (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
            <span className={`text-[11px] font-semibold uppercase ${T.faint}`}>{S.pr6.sevTotal}</span>
            <span className={`text-2xl font-bold tabular-nums ${T.text}`}>{form.total}</span>
            {form.auto_total != null && form.auto_total !== form.total && (
              <span className={`text-xs ${T.muted}`}>
                {S.pr6.sevAuto}: {form.auto_total}
              </span>
            )}
            <span className={`ml-auto text-[11px] ${T.faint}`}>{S.pr6.sevSource}: {form.source}</span>
          </div>

          {form.covers_full_window === false && (
            <div className="mt-1 text-[11px] text-amber-500">{S.pr6.sevPartialWindow}</div>
          )}

          <div className="mt-2">
            {form.rows.map((row) => (
              <OrganRow key={row.organ} T={T} S={S} row={row} hours={hours}
                        disabled={!!signed}
                        onCorrect={(cell) => setEditing(cell)} />
            ))}
          </div>

          {(form.unmeasured_organs || []).length > 0 && (
            <div className={`mt-1 text-[11px] leading-snug ${T.faint}`}>{S.pr6.sevNotMeasuredHint}</div>
          )}

          {editing && (
            <CorrectionEditor T={T} S={S} cell={editing} minReason={minReason}
                              onCancel={() => setEditing(null)} onSave={applyCorrection} />
          )}

          {pending.length > 0 && !signed && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pending.map((p) => (
                <span key={p.code} className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] text-violet-500">
                  {p.code} → {p.value}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {signed ? (
              <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-500">
                {fill(S.pr6.sevSigned, { who: signed.signed_by, when: clock(signed.signed_at) })}
              </span>
            ) : (
              <button onClick={signForm} disabled={busy}
                      className={`inline-flex items-center gap-1.5 ${btnCls(T, "primary")} px-3 py-1.5 text-xs disabled:opacity-40`}>
                <ClipboardCheck size={13} /> {busy ? S.pr6.sevSigning : S.pr6.sevSign}
              </button>
            )}
            <button onClick={() => onPrint?.({ form, signed, patient, hours, score: active.label })}
                    className={`inline-flex items-center gap-1.5 ${btnCls(T, "ghost")} px-3 py-1.5 text-xs`}>
              <FileText size={13} /> {S.pr6.sevPrint}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Tabs({ T, tab, setTab }) {
  return (
    <div className="flex flex-wrap gap-1">
      {SEVERITY_TABS.map((t) => (
        <button key={t.key} onClick={() => setTab(t.key)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${tab === t.key ? T.navActive : T.navIdle}`}>
          {t.label}{t.ready ? "" : " ·"}
        </button>
      ))}
    </div>
  );
}

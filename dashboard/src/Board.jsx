import React, { useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, History, Languages } from "lucide-react";
import { PatientList } from "./PatientList.jsx";
import { PatientDetail } from "./PatientDetail.jsx";
import { Toasts } from "./Toasts.jsx";
import { NotificationHistory } from "./NotificationHistory.jsx";
import {
  fetchBoard as realFetchBoard, openStream as realOpenStream, ackAlert as realAckAlert,
  openNotifications as realOpenNotifications, recordView as realRecordView,
  fetchAudit as realFetchAudit,
} from "./api.js";
import { ensurePermission, showDesktop, beep } from "./notifications.js";
import { sev } from "./theme.js";
import { strings, LANGS, storedLang, persistLang } from "./i18n.js";

export function Board({ token, fetchBoard = realFetchBoard, openStream = realOpenStream,
                        ackAlert = realAckAlert, openNotifications = realOpenNotifications,
                        recordView = realRecordView, fetchAudit = realFetchAudit }) {
  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [role, setRole] = useState("nurse");
  const [toasts, setToasts] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [lang, setLang] = useState(storedLang);
  const toastId = useRef(0);
  const L = strings(lang);

  useEffect(() => { persistLang(lang); }, [lang]);

  const mergeBoard = (board) => setPatients((prev) => {
    const rest = prev.filter((p) => p.patient_id !== board.patient_id);
    return [...rest, board].sort((a, b) => a.patient_id.localeCompare(b.patient_id));
  });

  useEffect(() => {
    let closed = false;
    fetchBoard(token).then((list) => { if (!closed) setPatients(list); }).catch(() => {});
    const close = openStream(token, mergeBoard, (s) => setStatus(s === "open" ? "live" : "reconnecting"));
    return () => { closed = true; close(); };
  }, [token, fetchBoard, openStream]);

  const dismissToast = (id) => setToasts((t) => t.filter((x) => x.id !== id));

  useEffect(() => {
    ensurePermission();
    const close = openNotifications(token, role, (note) => {
      const id = ++toastId.current;
      setToasts((t) => [...t, { id, note }]);
      showDesktop(note.title || "Uyarı", note.body);
      beep();
      setTimeout(() => dismissToast(id), 8000);
    });
    return close;
  }, [token, role, openNotifications]);

  const selectPatient = (patientId) => {
    setSelected(patientId);
    if (patientId) recordView(token, patientId, role);
  };

  const onAck = (patientId, kind) => { ackAlert(token, patientId, kind, role).then(mergeBoard).catch(() => {}); };

  const current = patients.find((p) => p.patient_id === selected) ?? null;
  const escalated = patients.flatMap((p) => p.alerts.filter((a) => a.escalated).map((a) => ({ p, a })));

  const critical = sev("critical");

  return (
    <div className="grid grid-cols-[320px_1fr] h-screen bg-slate-950 text-slate-100 font-sans">
      <Toasts toasts={toasts} onDismiss={dismissToast} onSelect={selectPatient} lang={lang} />
      <aside className="border-r border-slate-800 overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-3 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Activity className="text-brand" size={18} />
            <span className="font-semibold">Homunculus</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-slate-400" title={L.langLabel}>
              <Languages size={14} />
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                aria-label={L.langLabel}
                className="cursor-pointer rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {LANGS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
            <span className="flex items-center gap-1.5 rounded-full bg-slate-800/60 px-2 py-0.5 text-xs text-slate-400">
              <span
                className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "bg-emerald-400" : "bg-slate-500"}`}
              />
              {status}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 text-sm">
          <span className="text-slate-400">{L.role}</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="cursor-pointer rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <option value="nurse">{L.nurse}</option>
            <option value="doctor">{L.doctor}</option>
          </select>
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 cursor-pointer transition-colors hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <History size={14} />
            {L.notifHistory}
          </button>
        </div>
        {showHistory && (
          <NotificationHistory token={token} fetchAudit={fetchAudit} onSelect={selectPatient} lang={lang} />
        )}
        {escalated.length > 0 && (
          <div className={`m-3 rounded border ${critical.ring} bg-sev-critical/10 border-sev-critical/40`}>
            <div className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold ${critical.text}`}>
              <AlertTriangle className={critical.text} size={14} />
              {L.escalated} ({escalated.length})
            </div>
            <div className="pb-1">
              {escalated.map(({ p, a }) => (
                <div
                  key={p.patient_id + a.kind}
                  onClick={() => selectPatient(p.patient_id)}
                  tabIndex={0}
                  role="button"
                  className="flex items-center gap-2 px-3 py-1 text-sm cursor-pointer transition-colors hover:bg-sev-critical/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <AlertTriangle className={`${critical.text} shrink-0`} size={14} />
                  <span>{p.patient_id} — {a.summary}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <PatientList patients={patients} selected={selected} onSelect={selectPatient} lang={lang} />
      </aside>
      <main className="overflow-y-auto">
        {current
          ? <PatientDetail patient={current} onAck={(kind) => onAck(current.patient_id, kind)} lang={lang} />
          : <p className="p-4 text-slate-500">{L.selectPatient}</p>}
      </main>
    </div>
  );
}

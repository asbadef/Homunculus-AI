// src/clinicalAdmin.jsx — the administrator's and biomedical engineer's screens.
//
// Second slice out of ClinicalDemo.jsx. These fourteen components share an audience rather than
// a mechanism: hospital structure, staff and beds, users and invitations, devices, the archive,
// active sessions and the audit trail. None of them is on a clinician's path through the
// product, which is why they move together — the admin panel can be redesigned without opening
// the file the ward depends on.

import React, { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bed,
  BellRing,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  DoorOpen,
  Download,
  KeyRound,
  Lock,
  Monitor,
  Network,
  Pencil,
  Plus,
  Power,
  QrCode,
  Radio,
  RotateCcw,
  ScrollText,
  Search,
  Send,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";

import { ROLE } from "./clinicalDemo.js";
import {
  ActionOverlay, Field, Menu, btnCls, inputCls, maskedName,
} from "./clinicalUi.jsx";

// Hospital → Unit → Room → Bed tree with live device status per bed.
export function HierarchyTree({ T, S, state }) {
  const units = state.structure.units;
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <h3 className={`mb-1 flex items-center gap-2 font-bold ${T.heading}`}>
        <Building2 size={18} /> {S.pr7.hierarchy}
      </h3>
      <p className={`mb-4 text-sm ${T.muted}`}>{state.structure.tenant} · {state.structure.site}</p>
      <div className="space-y-3">
        {units.map((u) => {
          const rooms = u.rooms || [];
          const unitBeds = state.beds.filter((b) => b.unitId === u.id);
          return (
            <div key={u.id} className={`rounded-xl border ${T.border} ${T.subtle} p-3`}>
              <div className={`mb-2 flex items-center gap-2 font-semibold ${T.text}`}>
                <Network size={15} className="text-brand" /> {u.name}
                <span className={`ml-auto text-xs font-normal ${T.faint}`}>{rooms.length} {S.pr7.room} · {unitBeds.length} {S.pr7.beds}</span>
              </div>
              <div className="space-y-2 pl-4">
                {rooms.map((r) => {
                  const roomBeds = unitBeds.filter((b) => b.roomId === r.id);
                  return (
                    <div key={r.id}>
                      <div className={`mb-1 flex items-center gap-1.5 text-sm font-medium ${T.muted}`}>
                        <DoorOpen size={14} /> {r.label}
                      </div>
                      <div className="flex flex-wrap gap-1.5 pl-5">
                        {roomBeds.length === 0 && <span className={`text-xs ${T.faint}`}>—</span>}
                        {roomBeds.map((b) => {
                          const dev = state.devices?.find((d) => d.bedId === b.id && d.connected);
                          const occ = b.state === "OCCUPIED";
                          return (
                            <span key={b.id}
                              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ${occ ? "bg-brand/10 text-brand" : `${T.chip}`}`}>
                              {S.pr7.bed} {b.label}
                              {dev
                                ? <Radio size={11} className="animate-pulse text-emerald-500" />
                                : occ && <WifiOff size={11} className={T.faint} />}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Visual staff → bed assignment matrix (rows = staff, columns = beds).
export function StaffMatrix({ T, S, store, state }) {
  const staff = state.users.filter((u) => u.role === ROLE.ATTENDING || u.role === ROLE.CHARGE_NURSE);
  const beds = state.beds;
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <h3 className={`mb-1 flex items-center gap-2 font-bold ${T.heading}`}>
        <Users size={18} /> {S.pr7.staffMatrix}
      </h3>
      <p className={`mb-4 text-sm ${T.muted}`}>{S.pr7.staffMatrixInfo}</p>
      {staff.length === 0 ? (
        <div className={`text-sm ${T.faint}`}>{S.pr7.noStaff}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={`sticky left-0 z-10 ${T.card} px-2 py-1.5 text-left font-semibold ${T.muted}`}>{S.pr7.staff}</th>
                {beds.map((b) => (
                  <th key={b.id} className={`px-1 py-1.5 text-center font-medium ${T.faint}`} title={`${b.unitName} · ${b.roomLabel}`}>
                    {b.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => {
                const a = state.staffAssignments?.[u.id] || { bedIds: [], unitIds: [] };
                return (
                  <tr key={u.id} className={`border-t ${T.border}`}>
                    <td className={`sticky left-0 z-10 ${T.card} px-2 py-1.5`}>
                      <div className={`font-semibold ${T.text}`}>{u.full_name}</div>
                      <div className={`text-[10px] ${T.faint}`}>{S.roleName[u.role]}</div>
                      {a.unitIds?.length > 0 && (
                        <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-brand/10 px-1.5 py-0.5 text-[9px] font-semibold text-brand">
                          <Network size={9} /> {S.pr7.wholeUnit}
                        </span>
                      )}
                    </td>
                    {beds.map((b) => {
                      const viaUnit = a.unitIds?.includes(b.unitId);
                      const direct = a.bedIds?.includes(b.id);
                      const on = viaUnit || direct;
                      return (
                        <td key={b.id} className="p-0.5 text-center">
                          <button
                            disabled={viaUnit}
                            onClick={() => store.toggleStaffBed({ userId: u.id, bedId: b.id })}
                            title={b.label}
                            className={`h-7 w-7 rounded-md transition ${
                              viaUnit ? "cursor-not-allowed bg-brand/40" :
                              direct ? "bg-brand text-white hover:bg-brand/80" :
                              `${T.subtle} hover:ring-2 hover:ring-brand/40`
                            }`}>
                            {on ? <Check size={13} className="mx-auto" /> : ""}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Mindray / GE bedside-monitor simulator admin — add device & assign to a bed.
// Düzenlenebilir cihaz satırı — IP, Port, Protokol (HL7 / IEEE 11073) ve seri numarası.
export function DeviceRow({ T, S, store, state, d, occupiedBeds }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ vendor: d.vendor, model: d.model, ip: d.ip, port: d.port ?? "", protocol: d.protocol, serial: d.serial || "" });
  const [err, setErr] = useState("");
  const start = () => { setF({ vendor: d.vendor, model: d.model, ip: d.ip, port: d.port ?? "", protocol: d.protocol, serial: d.serial || "" }); setErr(""); setEdit(true); };
  const save = () => { try { store.updateDevice({ deviceId: d.id, ...f }); setErr(""); setEdit(false); } catch (ex) { setErr(ex.message); } };

  if (edit) {
    return (
      <div className={`space-y-2 px-3 py-3 ${T.subtle}`}>
        {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}
        <div className="grid grid-cols-2 gap-2">
          <select className={`${inputCls(T)} py-1.5 text-xs`} value={f.vendor} onChange={(e) => setF((s) => ({ ...s, vendor: e.target.value }))}>
            <option value="Mindray">Mindray</option><option value="GE Healthcare">GE Healthcare</option>
            <option value="Philips">Philips</option><option value="Dräger">Dräger</option>
          </select>
          <input className={`${inputCls(T)} py-1.5 text-xs`} placeholder={S.pr7.model} value={f.model} onChange={(e) => setF((s) => ({ ...s, model: e.target.value }))} />
          <input className={`${inputCls(T)} py-1.5 text-xs`} placeholder="192.168.1.50" value={f.ip} onChange={(e) => setF((s) => ({ ...s, ip: e.target.value }))} />
          <input className={`${inputCls(T)} py-1.5 text-xs`} placeholder={S.pr8.devicePort} value={f.port} onChange={(e) => setF((s) => ({ ...s, port: e.target.value }))} />
          <input className={`${inputCls(T)} py-1.5 text-xs`} placeholder={S.pr7.protocol} value={f.protocol} onChange={(e) => setF((s) => ({ ...s, protocol: e.target.value }))} />
          <input className={`${inputCls(T)} py-1.5 text-xs`} placeholder={S.pr8.deviceSerial} value={f.serial} onChange={(e) => setF((s) => ({ ...s, serial: e.target.value }))} />
        </div>
        <div className="flex gap-2">
          <button onClick={save} className={`${btnCls(T, "primary")} flex-1 py-1.5 text-xs`}><Check size={14} /> {S.pr8.saveDevice}</button>
          <button onClick={() => setEdit(false)} className={`${btnCls(T, "ghost")} py-1.5 text-xs`}><X size={14} /> {S.pr8.cancelEdit}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${d.connected ? "bg-emerald-500/15 text-emerald-500" : `${T.subtle} ${T.faint}`}`}>
        {d.connected ? <Radio size={17} className="animate-pulse" /> : <WifiOff size={17} />}
      </div>
      <div className="min-w-0">
        <div className={`truncate text-sm font-semibold ${T.text}`}>{d.vendor} {d.model}</div>
        <div className={`truncate text-xs ${T.faint}`}>{d.ip}:{d.port ?? "—"} · {d.protocol}</div>
        {d.serial && <div className={`truncate text-[10px] ${T.faint}`}>{S.pr8.deviceSerial}: {d.serial}</div>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div className="text-right">
          <select value={d.bedId || ""} onChange={(e) => store.assignDeviceToBed({ deviceId: d.id, bedId: e.target.value })}
            className={`${inputCls(T)} mb-1 py-1 text-xs`}>
            <option value="">{S.pr7.unassigned}</option>
            {occupiedBeds.map((b) => <option key={b.id} value={b.id}>{S.pr7.bed} {b.label}</option>)}
          </select>
          {d.connected
            ? <div className="text-[10px] font-semibold text-emerald-500">{S.pr7.live} · {d.packets} {S.pr7.packets}</div>
            : <div className={`text-[10px] ${T.faint}`}>{S.pr7.disconnected}</div>}
        </div>
        <button onClick={start} title={S.pr8.editDevice} className={`grid h-8 w-8 place-items-center rounded-lg ${T.ghost}`}><Pencil size={14} /></button>
      </div>
    </div>
  );
}

export function DeviceAdmin({ T, S, store, state }) {
  const occupiedBeds = state.beds.filter((b) => b.state === "OCCUPIED");
  const [f, setF] = useState({ vendor: "Mindray", model: "BeneVision N17", ip: "", port: "6002", protocol: "HL7 / IEEE 11073", serial: "", bedId: "" });
  const [err, setErr] = useState("");
  const submit = (e) => {
    e.preventDefault();
    try { store.addDevice(f); setF({ vendor: "Mindray", model: "", ip: "", port: "6002", protocol: "HL7 / IEEE 11073", serial: "", bedId: "" }); setErr(""); }
    catch (ex) { setErr(ex.message); }
  };
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
        <h3 className={`mb-1 flex items-center gap-2 font-bold ${T.heading}`}><Radio size={18} /> {S.pr7.addDevice}</h3>
        <p className={`mb-4 text-sm ${T.muted}`}>{S.pr7.deviceInfo}</p>
        {err && <div className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
        <form onSubmit={submit} className="space-y-3">
          <Field T={T} label={S.pr7.vendor}>
            <select className={inputCls(T)} value={f.vendor} onChange={(e) => setF((s) => ({ ...s, vendor: e.target.value }))}>
              <option value="Mindray">Mindray</option><option value="GE Healthcare">GE Healthcare</option>
              <option value="Philips">Philips</option><option value="Dräger">Dräger</option>
            </select>
          </Field>
          <Field T={T} label={S.pr7.model}><input className={inputCls(T)} value={f.model} placeholder="BeneVision N17" onChange={(e) => setF((s) => ({ ...s, model: e.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field T={T} label={S.pr7.ipAddress}><input className={inputCls(T)} value={f.ip} placeholder="192.168.1.50" onChange={(e) => setF((s) => ({ ...s, ip: e.target.value }))} /></Field>
            <Field T={T} label={S.pr8.devicePort} hint={S.pr8.portRange}><input className={inputCls(T)} value={f.port} placeholder="6002" onChange={(e) => setF((s) => ({ ...s, port: e.target.value }))} /></Field>
          </div>
          <Field T={T} label={S.pr7.protocol}><input className={inputCls(T)} value={f.protocol} onChange={(e) => setF((s) => ({ ...s, protocol: e.target.value }))} /></Field>
          <Field T={T} label={S.pr8.deviceSerial}><input className={inputCls(T)} value={f.serial} placeholder="MR-N17-000421" onChange={(e) => setF((s) => ({ ...s, serial: e.target.value }))} /></Field>
          <Field T={T} label={S.pr7.assignToBed}>
            <select className={inputCls(T)} value={f.bedId} onChange={(e) => setF((s) => ({ ...s, bedId: e.target.value }))}>
              <option value="">{S.pr7.unassigned}</option>
              {occupiedBeds.map((b) => <option key={b.id} value={b.id}>{b.unitName} · {S.pr7.bed} {b.label}</option>)}
            </select>
          </Field>
          <button type="submit" className={`${btnCls(T, "primary")} w-full`}><Plus size={16} /> {S.pr7.addDevice}</button>
        </form>
      </div>

      <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
        <h3 className={`mb-4 flex items-center gap-2 font-bold ${T.heading}`}><Network size={18} /> {S.pr7.devices}</h3>
        {(!state.devices || state.devices.length === 0) ? (
          <div className={`text-sm ${T.faint}`}>{S.pr7.noDevices}</div>
        ) : (
          <div className={`divide-y ${T.divide} rounded-xl border ${T.border}`}>
            {state.devices.map((d) => (
              <DeviceRow key={d.id} T={T} S={S} store={store} state={state} d={d} occupiedBeds={occupiedBeds} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Break-glass emergency-access review workflow (approve / reject with note).
export function BreakGlassReview({ T, S, store, state }) {
  const bg = state.breakGlass;
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const review = (approve) => { try { store.reviewBreakGlass({ approve, note }); setNote(""); setErr(""); } catch (ex) { setErr(ex.message); } };
  const statusUi = {
    pending: { text: "text-amber-500", label: S.pr7.bgPending },
    approved: { text: "text-emerald-500", label: S.pr7.bgApproved },
    rejected: { text: "text-red-500", label: S.pr7.bgRejected },
  };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <h3 className={`mb-1 flex items-center gap-2 font-bold ${T.heading}`}><ShieldCheck size={18} /> {S.pr7.breakGlassReview}</h3>
      {!bg ? (
        <p className={`mt-2 text-sm ${T.faint}`}>{S.pr7.bgNone}</p>
      ) : (
        <div className={`mt-3 rounded-xl border ${T.border} ${T.subtle} p-4`}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div><div className={`text-[10px] font-semibold uppercase ${T.faint}`}>{S.pr7.bgActivatedBy}</div><div className={`text-sm ${T.text}`}>{bg.by}{bg.role ? ` · ${S.roleName[bg.role] || bg.role}` : ""}</div></div>
            <div><div className={`text-[10px] font-semibold uppercase ${T.faint}`}>{S.pr7.bgStatus}</div><div className={`text-sm font-semibold ${(statusUi[bg.reviewStatus] || {}).text || T.text}`}>{(statusUi[bg.reviewStatus] || {}).label || bg.reviewStatus}</div></div>
          </div>
          <div className="mt-3"><div className={`text-[10px] font-semibold uppercase ${T.faint}`}>{S.pr7.bgReason}</div><div className={`text-sm ${T.text}`}>{bg.reason}</div></div>
          {bg.reviewNote && <div className="mt-2 text-xs italic text-brand">“{bg.reviewNote}”</div>}
          {bg.reviewStatus === "pending" && (
            <div className="mt-4 space-y-2">
              {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
              <input className={inputCls(T)} placeholder={S.pr7.bgReviewNote} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => review(true)} className={`${btnCls(T, "primary")} flex-1`}><Check size={15} /> {S.pr7.bgApprove}</button>
                <button onClick={() => review(false)} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-500 hover:bg-red-500/25`}><X size={15} /> {S.pr7.bgReject}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tek bir kullanıcı satırı + tam yönetim eylemleri menüsü (parola sıfırlama, geçici PIN,
// aktif/pasif, MFA yönetimi, birim & vardiya erişimi).
export function UserRow({ T, S, store, state, u }) {
  const units = state.structure.units;
  const [modal, setModal] = useState(null); // "password" | "pin" | "units" | "role"
  const [pw, setPw] = useState("");
  const [pinResult, setPinResult] = useState("");
  const [copied, setCopied] = useState(false);
  const [selUnits, setSelUnits] = useState(u.unitIds || []);
  const [selRole, setSelRole] = useState(u.role);
  const [err, setErr] = useState("");
  const wrap = (fn) => { try { fn(); setErr(""); } catch (ex) { setErr(ex.message); } };
  const active = u.active !== false;

  const doRole = () => wrap(() => { store.setUserRole({ userId: u.id, role: selRole }); setModal(null); });
  const doPassword = () => wrap(() => { store.setUserPassword({ userId: u.id, password: pw }); setModal(null); setPw(""); });
  const doPin = () => wrap(() => { const pin = store.resetUserPin({ userId: u.id }); setPinResult(pin); setModal("pin"); });
  const doUnits = () => wrap(() => { store.setUserUnits({ userId: u.id, unitIds: selUnits }); setModal(null); });
  const copyPin = () => { try { navigator.clipboard?.writeText(pinResult); } catch { /* ignore */ } setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const toggleUnit = (id) => setSelUnits((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <div className={`truncate text-sm font-semibold ${T.text}`}>{u.full_name}</div>
          <div className={`truncate text-xs ${T.faint}`}>{u.email}</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${T.chip}`}>{S.roleName[u.role]}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"}`}>
            {active ? S.pr8.activeYes : S.pr8.passiveNo}
          </span>
          {u.mfaRequired && <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500">{S.pr8.mfaRequired}</span>}
          {u.mfa && <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">{S.mfa}</span>}
          <Menu T={T} triggerClass={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 ${T.ghost} ${T.sizes.nav}`}
            trigger={<><Settings size={14} /><span className="hidden sm:inline">{S.pr8.userActions}</span><ChevronDown size={13} /></>}>
            {({ close }) => (
              <div className="text-sm">
                <button onClick={() => { setSelRole(u.role); setModal("role"); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><Shield size={14} /> {S.pr12.roleChange}</button>
                <div className={`my-1 border-t ${T.border}`} />
                <button onClick={() => { setModal("password"); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><KeyRound size={14} /> {S.pr8.resetPassword}</button>
                <button onClick={() => { doPin(); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><Lock size={14} /> {S.pr8.setTempPin}</button>
                <button onClick={() => { wrap(() => store.toggleUserActive(u.id)); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><Power size={14} /> {active ? S.pr8.deactivate : S.pr8.activate}</button>
                <div className={`my-1 border-t ${T.border}`} />
                <button onClick={() => { wrap(() => store.resetUserMfa(u.id)); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><ShieldAlert size={14} /> {S.pr8.resetMfa}</button>
                <button onClick={() => { wrap(() => store.setUserMfaRequired({ userId: u.id, required: !u.mfaRequired })); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><ShieldCheck size={14} /> {u.mfaRequired ? S.pr8.mfaEnforceOff : S.pr8.mfaEnforceOn}</button>
                <div className={`my-1 border-t ${T.border}`} />
                <button onClick={() => { setSelUnits(u.unitIds || []); setModal("units"); close(); }} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${T.navIdle}`}><Building2 size={14} /> {S.pr8.unitAccess}</button>
              </div>
            )}
          </Menu>
        </div>
      </div>
      {err && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}

      {modal === "role" && (
        <ActionOverlay T={T} title={S.pr12.roleChangeTitle} onClose={() => setModal(null)}>
          <p className={`mb-2 text-sm ${T.muted}`}>{S.pr12.roleChangeHint}</p>
          <Field T={T} label={S.pr12.roleLabel}>
            <select className={inputCls(T)} value={selRole} onChange={(e) => setSelRole(e.target.value)} autoFocus>
              {Object.values(ROLE).map((r) => (
                <option key={r} value={r}>{S.roleName[r]}</option>
              ))}
            </select>
          </Field>
          {err && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}
          <button onClick={doRole} className={`${btnCls(T, "primary")} mt-3 w-full`}><Check size={15} /> {S.pr12.roleChangeSave}</button>
        </ActionOverlay>
      )}

      {modal === "password" && (
        <ActionOverlay T={T} title={S.pr8.resetPassword} onClose={() => { setModal(null); setPw(""); }}>
          <Field T={T} label={S.pr8.newPasswordLabel}>
            <input type="text" className={inputCls(T)} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </Field>
          {err && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}
          <button onClick={doPassword} className={`${btnCls(T, "primary")} mt-3 w-full`}><Check size={15} /> {S.pr8.resetPassword}</button>
        </ActionOverlay>
      )}

      {modal === "pin" && (
        <ActionOverlay T={T} title={S.pr8.setTempPin} onClose={() => { setModal(null); setPinResult(""); }}>
          <p className={`mb-2 text-sm ${T.muted}`}>{S.pr8.tempPinIssued}</p>
          <div className={`flex items-center justify-between gap-2 rounded-xl border ${T.border} ${T.subtle} px-4 py-3`}>
            <span className={`font-mono text-2xl font-bold tracking-[0.3em] ${T.heading}`}>{pinResult}</span>
            <button onClick={copyPin} className={btnCls(T, "ghost")}><Check size={14} className={copied ? "text-emerald-500" : ""} /> {copied ? S.pr8.copied : S.pr8.copyPin}</button>
          </div>
        </ActionOverlay>
      )}

      {modal === "units" && (
        <ActionOverlay T={T} title={S.pr8.unitAccess} onClose={() => setModal(null)}>
          <p className={`mb-2 text-sm ${T.muted}`}>{S.pr8.selectUnits}</p>
          <div className="space-y-1.5">
            {units.length === 0 && <div className={`text-sm ${T.faint}`}>{S.pr8.noUnits}</div>}
            {units.map((un) => (
              <label key={un.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border ${T.border} ${T.subtle} px-3 py-2 text-sm`}>
                <input type="checkbox" className="h-4 w-4 accent-current text-brand" checked={selUnits.includes(un.id)} onChange={() => toggleUnit(un.id)} />
                <Building2 size={14} /> <span className={T.text}>{un.name}</span>
              </label>
            ))}
          </div>
          <button onClick={doUnits} className={`${btnCls(T, "primary")} mt-3 w-full`}><Check size={15} /> {S.pr8.saveUnits}</button>
        </ActionOverlay>
      )}
    </div>
  );
}

// ================================================================ INVITE & MFA MANAGEMENT (Madde 6)
export function InviteManagement({ T, S, store, state }) {
  const [f, setF] = useState({ email: "", fullName: "", role: ROLE.ATTENDING });
  const [err, setErr] = useState("");
  const [mfaModal, setMfaModal] = useState(null); // { userId, email, provisioning, secret } or null

  const submitInvite = (e) => {
    e.preventDefault();
    try {
      store.inviteUser({ email: f.email, fullName: f.fullName, role: f.role });
      setF({ email: "", fullName: "", role: ROLE.ATTENDING });
      setErr("");
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const pendingInvites = state.invites.filter((i) => i.status === "PENDING");

  return (
    <div className="space-y-4">
      {/* Invite form */}
      <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
        <h3 className={`mb-1 flex items-center gap-2 font-bold ${T.heading}`}>
          <Send size={18} /> {S.pr10.inviteTitle}
        </h3>
        <p className={`mb-4 text-sm ${T.muted}`}>E-posta ile davet gönderin</p>
        <form onSubmit={submitInvite} className="space-y-3">
          <Field T={T} label={S.pr10.inviteEmail}>
            <input className={inputCls(T)} type="email" value={f.email}
              onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} />
          </Field>
          <Field T={T} label={S.pr10.inviteFullName}>
            <input className={inputCls(T)} value={f.fullName}
              onChange={(e) => setF((s) => ({ ...s, fullName: e.target.value }))} />
          </Field>
          <Field T={T} label={S.pr10.inviteRole}>
            <select className={inputCls(T)} value={f.role}
              onChange={(e) => setF((s) => ({ ...s, role: e.target.value }))}>
              {Object.values(ROLE).map((r) => (
                <option key={r} value={r}>{S.roleName[r]}</option>
              ))}
            </select>
          </Field>
          {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
          <button type="submit" className={`${btnCls(T, "primary")} w-full`}>
            <Send size={16} /> {S.pr10.inviteButton}
          </button>
        </form>
      </div>

      {/* Pending invites list */}
      {pendingInvites.length > 0 && (
        <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
          <h3 className={`mb-1 flex items-center gap-2 font-bold ${T.heading}`}>
            <Clock size={18} /> {S.pr10.inviteListTitle}
          </h3>
          <div className={`mt-3 divide-y ${T.divide}`}>
            {pendingInvites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex-1">
                  <div className={`font-semibold ${T.text}`}>{inv.fullName}</div>
                  <div className={`text-sm ${T.muted}`}>{inv.email} · {S.roleName[inv.role]}</div>
                  <div className={`text-xs ${T.faint}`}>
                    {S.pr10.inviteStatus[inv.status]} · {new Date(inv.invitedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => store.resendInvite(inv.id)}
                    className={`${btnCls(T, "ghost")} text-xs`}>
                    <RotateCcw size={14} /> {S.pr10.inviteResend}
                  </button>
                  <button onClick={() => store.cancelInvite(inv.id)}
                    className={`${btnCls(T, "danger")} text-xs`}>
                    <XCircle size={14} /> {S.pr10.inviteCancel}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MFA modal (if active) */}
      {mfaModal && (
        <MfaModal T={T} S={S} store={store} mfaModal={mfaModal} onClose={() => setMfaModal(null)} />
      )}
    </div>
  );
}

// MFA setup modal (QR code + verification)
export function MfaModal({ T, S, store, mfaModal, onClose }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [verified, setVerified] = useState(false);

  const verify = () => {
    try {
      store.verifyMfa({ userId: mfaModal.userId, code });
      setVerified(true);
      setErr("");
      setTimeout(onClose, 2000);
    } catch (ex) {
      setErr(ex.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className={`w-full max-w-md rounded-2xl border ${T.border} ${T.card} p-6`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className={`font-bold ${T.heading}`}>{S.pr10.mfaSetupTitle}</h3>
          <button onClick={onClose} className={`rounded-lg p-1 ${T.ghost}`}><X size={20} /></button>
        </div>

        {!verified && (
          <>
            <p className={`mb-3 text-sm ${T.muted}`}>{S.pr10.mfaScanQR}</p>
            {/* QR code (placeholder - in production this would be a real QR) */}
            <div className={`mb-4 flex items-center justify-center rounded-xl ${T.subtle} p-6`}>
              <QrCode size={120} className={T.faint} />
            </div>
            <p className={`mb-2 text-xs ${T.faint}`}>Secret: <code>{mfaModal.secret}</code></p>

            <Field T={T} label={S.pr10.mfaEnterCode}>
              <input className={inputCls(T)} type="text" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            </Field>
            {err && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
            <button onClick={verify} className={`${btnCls(T, "primary")} mt-3 w-full`}>
              <Check size={16} /> {S.pr10.mfaVerifyButton}
            </button>
          </>
        )}

        {verified && (
          <div className="flex items-center gap-3 rounded-xl bg-green-500/15 px-4 py-3 text-green-500">
            <CheckCircle2 size={20} /> <span className="font-semibold">{S.pr10.mfaVerified}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function UserAdmin({ T, S, store, state }) {
  const [f, setF] = useState({ full_name: "", email: "", role: ROLE.ATTENDING, password: "" });
  const [err, setErr] = useState("");
  const submit = (e) => { e.preventDefault(); try { store.createUser(f); setF({ full_name: "", email: "", role: ROLE.ATTENDING, password: "" }); setErr(""); } catch (ex) { setErr(ex.message); } };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <h3 className={`mb-1 font-bold ${T.heading}`}>{S.usersSection}</h3>
      <p className={`mb-4 text-sm ${T.muted}`}>{S.createUser}</p>
      <form onSubmit={submit} className="space-y-3">
        <Field T={T} label={S.uName}><input className={inputCls(T)} value={f.full_name} onChange={(e) => setF((s) => ({ ...s, full_name: e.target.value }))} /></Field>
        <Field T={T} label={S.uEmail}><input className={inputCls(T)} value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} /></Field>
        <Field T={T} label={S.uRole}>
          <select className={inputCls(T)} value={f.role} onChange={(e) => setF((s) => ({ ...s, role: e.target.value }))}>
            {Object.values(ROLE).map((r) => <option key={r} value={r}>{S.roleName[r]}</option>)}
          </select>
        </Field>
        <Field T={T} label={S.pr12.initialPassword}>
          <input className={inputCls(T)} type="text" placeholder={S.pr12.initialPasswordHint} value={f.password} onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))} />
        </Field>
        {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
        <button type="submit" className={`${btnCls(T, "primary")} w-full`}><Plus size={16} /> {S.addUser}</button>
      </form>
      <div className={`mt-4 text-xs font-semibold uppercase ${T.faint}`}>{S.userList}</div>
      <div className={`mt-2 divide-y ${T.divide} rounded-xl border ${T.border}`}>
        {state.users.map((u) => (
          <UserRow key={u.id} T={T} S={S} store={store} state={state} u={u} />
        ))}
      </div>
    </div>
  );
}

export function StructureAdmin({ T, S, store, state }) {
  const units = state.structure.units;
  const [unitName, setUnitName] = useState(""); const [unitType, setUnitType] = useState("ADULT_ICU");
  const [roomUnit, setRoomUnit] = useState(units[0]?.id || ""); const [roomName, setRoomName] = useState("");
  const [bedUnit, setBedUnit] = useState(units[0]?.id || ""); const [bedRoom, setBedRoom] = useState(""); const [bedLabel, setBedLabel] = useState("");
  const [err, setErr] = useState("");
  const bedUnitRooms = units.find((u) => u.id === bedUnit)?.rooms || [];
  const wrap = (fn) => { try { fn(); setErr(""); } catch (ex) { setErr(ex.message); } };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <h3 className={`mb-1 font-bold ${T.heading}`}>{S.structureSection}</h3>
      <p className={`mb-4 text-sm ${T.muted}`}>{S.adminSub}</p>
      {err && <div className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}

      {/* add unit */}
      <div className={`mb-3 rounded-xl border ${T.border} ${T.subtle} p-3`}>
        <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.addUnit}</div>
        <div className="flex flex-wrap gap-2">
          <input className={`${inputCls(T)} flex-1`} placeholder={S.unitName} value={unitName} onChange={(e) => setUnitName(e.target.value)} />
          <select className={inputCls(T)} value={unitType} onChange={(e) => setUnitType(e.target.value)}>
            <option value="ADULT_ICU">{S.unitAdult}</option><option value="NICU">{S.unitNicu}</option>
          </select>
          <button onClick={() => wrap(() => { store.addUnit({ name: unitName, type: unitType }); setUnitName(""); })} className={btnCls(T, "primary")}><Plus size={15} /></button>
        </div>
      </div>

      {/* add room */}
      <div className={`mb-3 rounded-xl border ${T.border} ${T.subtle} p-3`}>
        <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.addRoom}</div>
        <div className="flex flex-wrap gap-2">
          <select className={inputCls(T)} value={roomUnit} onChange={(e) => setRoomUnit(e.target.value)}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input className={`${inputCls(T)} flex-1`} placeholder={S.roomName} value={roomName} onChange={(e) => setRoomName(e.target.value)} />
          <button onClick={() => wrap(() => { store.addRoom({ unitId: roomUnit, label: roomName }); setRoomName(""); })} className={btnCls(T, "primary")}><Plus size={15} /></button>
        </div>
      </div>

      {/* add bed */}
      <div className={`rounded-xl border ${T.border} ${T.subtle} p-3`}>
        <div className={`mb-2 text-xs font-semibold uppercase ${T.faint}`}>{S.addBed}</div>
        <div className="flex flex-wrap gap-2">
          <select className={inputCls(T)} value={bedUnit} onChange={(e) => { setBedUnit(e.target.value); setBedRoom(""); }}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className={inputCls(T)} value={bedRoom} onChange={(e) => setBedRoom(e.target.value)}>
            <option value="">{S.selectRoom}</option>
            {bedUnitRooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <input className={`${inputCls(T)} flex-1`} placeholder={S.bedLabel} value={bedLabel} onChange={(e) => setBedLabel(e.target.value)} />
          <button onClick={() => wrap(() => { store.addBed({ unitId: bedUnit, roomId: bedRoom, label: bedLabel }); setBedLabel(""); })} className={btnCls(T, "primary")}><Plus size={15} /></button>
        </div>
      </div>

      {/* structure summary */}
      <div className="mt-4 space-y-2">
        {units.map((u) => {
          const unitBeds = state.beds.filter((b) => b.unitId === u.id);
          return (
            <div key={u.id} className={`rounded-lg ${T.subtle} px-3 py-2 text-sm`}>
              <div className="flex items-center justify-between">
                <span className={`font-semibold ${T.text}`}><Building2 size={14} className="mr-1.5 inline" />{u.name}</span>
                <span className={`text-xs ${T.faint}`}>{(u.rooms || []).length} {S.room} · {unitBeds.length} {S.bed}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* PR#8 · bed operations — durum yönetimi (Boş / Dolu / Dezenfeksiyonda / Teknik Arızalı / Kullanım Dışı) */}
      <div className="mt-5">
        <div className={`mb-2 flex items-center gap-2 text-xs font-semibold uppercase ${T.faint}`}><Bed size={14} /> {S.pr8.bedOps}</div>
        <div className={`divide-y ${T.divide} rounded-xl border ${T.border}`}>
          {state.beds.map((b) => <BedStateRow key={b.id} T={T} S={S} store={store} bed={b} />)}
        </div>
      </div>
    </div>
  );
}

export function BedStateRow({ T, S, store, bed }) {
  const [err, setErr] = useState("");
  const occupied = bed.state === "OCCUPIED";
  const change = (e) => { try { store.setBedState({ bedId: bed.id, state: e.target.value }); setErr(""); } catch (ex) { setErr(ex.message); } };
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
      <Bed size={15} className={T.faint} />
      <span className={`font-semibold ${T.text}`}>{bed.unitName ? `${bed.unitName} · ` : ""}{S.bed} {bed.label}</span>
      <span className={`ml-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${BED_STATE_BADGE[bed.state] || T.chip}`}>
        {S.pr8.bedStateLabels[bed.state] || bed.state}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {occupied ? (
          <span className={`inline-flex items-center gap-1 text-[11px] ${T.faint}`}><Lock size={12} /> {S.pr8.occupiedLock}</span>
        ) : (
          <select value={bed.state} onChange={change} className={`${inputCls(T)} py-1 text-xs`}>
            {BED_ADMIN_STATES.map((s) => <option key={s} value={s}>{S.pr8.bedStateLabels[s] || s}</option>)}
          </select>
        )}
      </div>
      {err && <div className="w-full rounded-lg bg-red-500/15 px-3 py-1.5 text-xs text-red-500">{err}</div>}
    </div>
  );
}

// Madde 27: Arşiv Yönetimi — arşivlenmiş hastalar listesi + anonimizasyon.
export function ArchiveManagement({ T, S, store, state }) {
  const [err, setErr] = useState("");
  const wrap = (fn) => { try { fn(); setErr(""); } catch (ex) { setErr(ex.message); } };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <div className="mb-3 flex items-center gap-2">
        <Archive size={17} className={T.accent} />
        <h3 className={`font-bold ${T.heading}`}>{S.pr13.archiveTitle}</h3>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs ${T.chip}`}>{state.archivedPatients.length} {S.pr13.archived}</span>
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      <div className={`divide-y ${T.divide} rounded-xl border ${T.border}`}>
        {state.archivedPatients.length === 0 && <div className={`px-3 py-6 text-center text-sm ${T.faint}`}>{S.pr13.noArchived}</div>}
        {state.archivedPatients.map((p) => (
          <div key={p.patient_id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className={`truncate font-semibold ${T.text}`}>{p.display_name}</div>
              <div className={`truncate text-xs ${T.faint}`}>{p.mrn} · {new Date(p.archivedAtMs).toLocaleDateString()}</div>
            </div>
            {!p.anonymizedAtMs && (
              <button onClick={() => wrap(() => store.anonymizePatient({ patientId: p.patient_id }))} className={`${btnCls(T, "ghost")} shrink-0 text-xs`}>
                <XCircle size={14} /> {S.pr13.anonymize}
              </button>
            )}
            {p.anonymizedAtMs && <span className={`shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500`}>{S.pr13.anonymized}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Madde 12: Oturum Yönetimi — aktif oturumlar listesi + sonlandırma.
export function SessionManagement({ T, S, store, state }) {
  const [err, setErr] = useState("");
  const wrap = (fn) => { try { fn(); setErr(""); } catch (ex) { setErr(ex.message); } };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <div className="mb-3 flex items-center gap-2">
        <Monitor size={17} className={T.accent} />
        <h3 className={`font-bold ${T.heading}`}>{S.pr13.sessionsTitle}</h3>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs ${T.chip}`}>{state.activeSessions.length} {S.pr13.active}</span>
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      <div className={`divide-y ${T.divide} rounded-xl border ${T.border}`}>
        {state.activeSessions.length === 0 && <div className={`px-3 py-6 text-center text-sm ${T.faint}`}>{S.pr13.noSessions}</div>}
        {state.activeSessions.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
            <Monitor size={15} className="shrink-0 text-emerald-500" />
            <div className="min-w-0 flex-1">
              <div className={`truncate font-semibold ${T.text}`}>{s.email}</div>
              <div className={`truncate text-xs ${T.faint}`}>{s.device} · {s.ip} · {new Date(s.startedAtMs).toLocaleString()}</div>
            </div>
            <button onClick={() => wrap(() => store.terminateSession({ sessionId: s.id }))} className={`${btnCls(T, "ghost")} shrink-0 text-xs`}>
              <Power size={14} /> {S.pr13.terminate}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Append-only audit log viewer + search panel (S-15/C2). Text search + action filter + date range.
// Actor names honour the KVKK mask toggle.
/**
 * Alarm quality — the number the product's premise rests on (E4).
 *
 * Homunculus exists to reduce alarm fatigue, and until now nothing in it measured whether it was
 * producing some. A ward that ignores our alarms has not been made safer; it has been trained to
 * look away, and that shows up here before it shows up in an incident.
 *
 * Three honesty rules are visible in this component, because each one is a way the panel could
 * flatter the product:
 *   - `answered_rate: null` renders as "not enough has settled", never as 0%.
 *   - Open episodes are shown apart from ignored ones. A nurse walking to the bed is not a failure.
 *   - Repeat emissions are shown even though they are not episodes: they are what the ward
 *     actually experiences as noise.
 */
export function AlarmQualityPanel({ T, S, store }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [days, setDays] = useState(7);

  useEffect(() => {
    if (typeof store?.alarmQuality !== "function") return;
    let cancelled = false;
    setFailed(false);
    store.alarmQuality(days)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) { setData(null); setFailed(true); } });
    return () => { cancelled = true; };
  }, [store, days]);

  const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
  const secs = (v) => (v == null ? "—" : v < 90 ? `${Math.round(v)} sn` : `${Math.round(v / 60)} dk`);
  const settled = data ? (data.answered || 0) + (data.unanswered || 0) : 0;

  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} ${T.lift} p-5`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <BellRing size={17} className={T.accent} />
        <h3 className={`font-bold ${T.heading}`}>{S.pr7.alarmQuality}</h3>
        <select className={`${inputCls(T)} ml-auto w-auto`} value={days}
                onChange={(e) => setDays(Number(e.target.value))} aria-label={S.pr7.alarmQuality}>
          {[1, 7, 30].map((d) => (
            <option key={d} value={d}>{fill(S.pr7.aqDays, { n: d })}</option>
          ))}
        </select>
      </div>
      <p className={`mb-3 text-xs ${T.muted}`}>{S.pr7.aqSubtitle}</p>

      {failed && (
        <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-500">{S.pr7.aqFailed}</div>
      )}

      {data && (
        <>
          {/* The headline. A rate with no settled episodes behind it is unknown, not zero. */}
          <div className={`mb-3 rounded-xl border ${T.border} ${T.subtle} p-3`}>
            {settled === 0 ? (
              <>
                <div className={`text-sm font-semibold ${T.text}`}>{S.pr7.aqUnknown}</div>
                <div className={`mt-0.5 text-xs ${T.faint}`}>{S.pr7.aqUnknownHint}</div>
              </>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className={`text-[11px] font-semibold uppercase ${T.faint}`}>{S.pr7.aqRate}</span>
                <span className={`text-2xl font-bold tabular-nums ${data.answered_rate >= 0.9 ? "text-emerald-500" : data.answered_rate >= 0.7 ? "text-amber-500" : "text-red-500"}`}>
                  {Math.round(data.answered_rate * 100)}%
                </span>
                <span className={`text-xs ${T.muted}`}>
                  {data.answered}/{settled} · {S.pr7.aqMedian}: {secs(data.median_response_sec)} · {S.pr7.aqP90}: {secs(data.p90_response_sec)}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[[S.pr7.aqEpisodes, data.episodes, T.text],
              [S.pr7.aqUnanswered, data.unanswered, data.unanswered > 0 ? "text-red-500" : T.text],
              [S.pr7.aqEscalated, data.escalated, data.escalated > 0 ? "text-amber-500" : T.text],
              [S.pr7.aqPending, data.pending, T.muted]].map(([label, value, tone]) => (
              <div key={label} className={`rounded-xl border ${T.border} ${T.subtle} p-2.5`}>
                <div className={`text-[10px] font-semibold uppercase ${T.faint}`}>{label}</div>
                <div className={`text-lg font-bold tabular-nums ${tone}`}>{value ?? 0}</div>
              </div>
            ))}
          </div>
          {data.pending > 0 && <div className={`mt-1 text-[11px] ${T.faint}`}>{S.pr7.aqPendingHint}</div>}

          <div className={`mt-3 rounded-xl border ${T.border} ${T.subtle} p-2.5`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className={`text-[11px] font-semibold uppercase ${T.faint}`}>{S.pr7.aqRepeats}</span>
              <span className={`text-sm font-bold tabular-nums ${T.text}`}>{data.repeats ?? 0}</span>
            </div>
            <div className={`mt-0.5 text-[11px] leading-snug ${T.faint}`}>{S.pr7.aqRepeatsHint}</div>
          </div>

          {(data.per_kind || []).length > 0 && (
            <div className="mt-3">
              <div className={`mb-1 text-[11px] font-semibold uppercase ${T.faint}`}>{S.pr7.aqByKind}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {data.per_kind.map((k) => (
                      <tr key={k.kind} className={`border-t ${T.border}`}>
                        <td className={`py-1.5 pr-3 font-medium ${T.text}`}>{k.kind}</td>
                        <td className={`py-1.5 pr-3 tabular-nums ${T.muted}`}>{k.episodes}</td>
                        <td className={`py-1.5 pr-3 tabular-nums ${k.unanswered > 0 ? "text-red-500" : T.muted}`}>
                          {k.unanswered} {S.pr7.aqUnanswered.toLocaleLowerCase("tr")}
                        </td>
                        <td className={`py-1.5 tabular-nums ${T.muted}`}>{secs(k.median_response_sec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(data.noisiest_beds || []).length > 0 && (
            <div className="mt-3">
              <div className={`mb-1 text-[11px] font-semibold uppercase ${T.faint}`}>{S.pr7.aqNoisiest}</div>
              <div className="flex flex-wrap gap-1.5">
                {data.noisiest_beds.map((b) => (
                  <span key={b.patient_id} className={`rounded-full px-2.5 py-0.5 text-xs ${T.chip}`}>
                    {b.patient_id} · {b.episodes}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The audit chain's verdict, stated plainly.
 *
 * Three things are kept separate on purpose, because collapsing them would each be a lie of a
 * different kind: how many records were sealed and verified, how many predate the seal and were
 * therefore never claimed to be sealed, and whether the run reached the end of the log at all. A
 * green tick over a partial check is the failure mode this panel exists to avoid.
 */
function ChainVerdict({ T, S, chain }) {
  const fill = (text, vars) =>
    String(text).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));

  if (chain.failed) {
    return (
      <div className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-500">
        {S.pr7.integrityFailed}
      </div>
    );
  }
  const broken = chain.ok === false;
  return (
    <div className={`mt-2 rounded-xl px-3 py-2 text-sm ${broken ? "bg-red-500/15 text-red-500" : "bg-emerald-500/10 text-emerald-500"}`}>
      <div className="font-semibold">
        {broken
          ? fill(S.pr7.integrityBroken, { id: chain.broken_at, reason: chain.reason })
          : fill(S.pr7.integrityOk, { n: chain.checked })}
      </div>
      {chain.complete === false && (
        <div className={`mt-0.5 text-xs ${T.muted}`}>{fill(S.pr7.integrityPartial, { n: chain.records })}</div>
      )}
      {chain.unsealed > 0 && (
        <div className={`mt-0.5 text-xs ${T.muted}`}>{fill(S.pr7.integrityUnsealed, { n: chain.unsealed })}</div>
      )}
    </div>
  );
}

export function AuditLog({ T, S, state, store }) {
  const label = (a) => (S.pr6.actions && S.pr6.actions[a]) || a;
  // Pull the engine's own append-only record when there is one to pull. In the simulation this
  // is absent and the local log stands in, which is what it is for; on a live ward the screen
  // must show the record an inspection would be handed, not this browser's memory of it.
  const [loadError, setLoadError] = useState("");
  // The integrity check (G2). Append-only triggers stop the application from rewriting a record;
  // they stop nobody who can reach the database directly, which on an on-prem install is the
  // hospital's own administrator. This button is the answer to the question an inspection asks —
  // "can you show these records were not altered?" — and the engine's verdict is passed through
  // untouched: a UI that softened "broken" into "warning" would be the wrong kind of help.
  const [chain, setChain] = useState(null);
  const [checking, setChecking] = useState(false);
  const verify = async () => {
    setChecking(true);
    try {
      setChain(await store.verifyAudit());
    } catch {
      setChain({ failed: true });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    if (typeof store?.refreshAudit !== "function") return;
    let cancelled = false;
    store.refreshAudit({ limit: 500 })
      .catch(() => { if (!cancelled) setLoadError("Denetim kaydı alınamadı."); });
    return () => { cancelled = true; };
  }, [store]);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const all = state.auditLog || [];
  // Distinct actions present in the log (for the filter dropdown).
  const actions = useMemo(() => Array.from(new Set(all.map((r) => r.action))), [all]);
  const rows = useMemo(() => {
    const ql = q.trim().toLocaleLowerCase("tr");
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(to).getTime() + 24 * 3600 * 1000 : null; // inclusive end-of-day
    return all.filter((r) => {
      if (action && r.action !== action) return false;
      if (fromMs && r.atMs < fromMs) return false;
      if (toMs && r.atMs > toMs) return false;
      if (ql) {
        const hay = `${label(r.action)} ${r.actor || ""} ${r.target || ""} ${r.detail || ""}`.toLocaleLowerCase("tr");
        if (!hay.includes(ql)) return false;
      }
      return true;
    }).reverse();
  }, [all, q, action, from, to]);
  const clear = () => { setQ(""); setAction(""); setFrom(""); setTo(""); };
  const exportCSV = () => {
    const headers = ["Tarih/Saat", "İşlem", "Kullanıcı", "Rol", "Hedef", "Detay"];
    const csvRows = rows.map((r) => [
      new Date(r.atMs).toLocaleString("tr-TR"),
      label(r.action),
      r.actor || "—",
      r.role || "—",
      r.target || "—",
      (r.detail || "").replace(/"/g, '""'),
    ]);
    const csvContent = [headers, ...csvRows].map((row) => row.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `denetim-kaydi-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} ${T.lift} p-5`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ScrollText size={17} className={T.accent} />
        <h3 className={`font-bold ${T.heading}`}>{S.pr7.auditSearch}</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${T.chip}`}>{rows.length} {S.pr7.resultCount}</span>
        {typeof store?.verifyAudit === "function" && (
          <button onClick={verify} disabled={checking}
                  className={`ml-auto inline-flex items-center gap-1.5 ${btnCls(T, "ghost")} disabled:opacity-40`}>
            <ShieldCheck size={14} /> {checking ? S.pr7.integrityChecking : S.pr7.integrityCheck}
          </button>
        )}
        <button onClick={exportCSV} disabled={rows.length === 0} className={`${typeof store?.verifyAudit === "function" ? "" : "ml-auto "}inline-flex items-center gap-1.5 ${btnCls(T, "ghost")} disabled:opacity-40 disabled:cursor-not-allowed`}>
          <Download size={14} /> {S.pr13.exportCSV}
        </button>
      </div>

      {chain && <ChainVerdict T={T} S={S} chain={chain} />}
      {/* A record that failed to load must say so. Showing the local log in its place, silently,
          would present this browser's memory as the hospital's audit trail. */}
      {loadError && (
        <div className="mt-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {loadError} — aşağıdaki liste motorun kaydı DEĞİLDİR.
        </div>
      )}
      {/* search + filters */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={14} className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ${T.faint}`} />
          <input className={`${inputCls(T)} pl-8`} placeholder={S.pr7.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={inputCls(T)} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">{S.pr7.allActions}</option>
          {actions.map((a) => <option key={a} value={a}>{label(a)}</option>)}
        </select>
        <input type="date" className={inputCls(T)} value={from} onChange={(e) => setFrom(e.target.value)} aria-label={S.pr7.dateFrom} />
        <input type="date" className={inputCls(T)} value={to} onChange={(e) => setTo(e.target.value)} aria-label={S.pr7.dateTo} />
      </div>
      {(q || action || from || to) && (
        <button onClick={clear} className={`mt-2 inline-flex items-center gap-1.5 text-xs ${T.accent}`}>
          <X size={12} /> {S.pr7.clearFilters}
        </button>
      )}
      <div className={`mt-3 max-h-[28rem] divide-y ${T.divide} overflow-y-auto rounded-xl border ${T.border}`}>
        {rows.length === 0 && <div className={`px-3 py-6 text-center text-sm ${T.faint}`}>{S.pr6.noAudit}</div>}
        {rows.map((r) => (
          <div key={r.id} className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`shrink-0 rounded-md ${T.subtle} px-1.5 py-0.5 text-[11px] font-semibold ${T.muted}`}>{label(r.action)}</span>
              <span className={`truncate text-xs ${T.text}`}>{maskedName(state, r.actor)}</span>
              <span className={`ml-auto shrink-0 text-[10px] tabular-nums ${T.faint}`}>{new Date(r.atMs).toLocaleString()}</span>
            </div>
            {(r.target || r.detail) && <div className={`mt-0.5 truncate text-xs ${T.faint}`}>{r.target ? `${r.target} · ` : ""}{r.detail}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

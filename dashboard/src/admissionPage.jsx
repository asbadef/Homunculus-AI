// src/admissionPage.jsx — Hasta Kabul / Transfer / Bakım Ekibi, tek ekranda.
//
// Eskiden bu ekran alt alta dizilmiş dört büyük karttı: kabul eden kişi formu görmek için
// kaydırıyor, kaydırınca da hangi alanların kaldığını görmüyordu. Yatak seçimi ekranın
// altındaydı; kabulün asıl kararı olan "hangi yatağa" sorusu, en son görülen şeydi.
//
// Yeni düzen üç şeyi aynı anda görünür tutar ve hiçbirini kaydırmaya bırakmaz:
//   • solda form — üç kompakt bölüm, 12 kolonluk ızgara;
//   • sağda canlı özet — neyin eksik olduğu, hasta kartının nasıl görüneceği;
//   • sağ altta barkod etiketi önizlemesi — kabul onaylanınca basılacak fiziksel etiket.
//
// Bakım ekibi ataması buraya üçüncü sekme olarak taşındı: kendi menü maddesi olarak dururken
// yaptığı iş kabul formunun "sorumlu hekim / hemşire" alanlarının aynısıydı ve aynı üç rol
// görüyordu. İki ayrı yerde yapılan tek bir iş, bir yerde yapılan tek bir iştir.

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowLeftRight, Bed, Check, HeartHandshake, HeartPulse, Printer, PlugZap,
  ShieldAlert, Stethoscope, UserPlus, Users, AlertTriangle, ChevronDown, Plus,
} from "lucide-react";
import { ROLE } from "./clinicalDemo.js";
import { Field, SectionHeader, btnCls, inputCls, maskedName } from "./clinicalUi.jsx";
import { awaitingLocalAdmission, ageFromBirthDate } from "./liveAdapters.js";
import {
  code128Svg, labelLines, labelSafetyChips, printPatientLabel,
} from "./patientLabel.js";

// Triyaj renkleri sınıf adlarıyla yazılır (Tailwind JIT kaynak metni tarar; çalışma anında
// birleştirilen sınıf adı derlemeye girmez).
const TRIAGE_UI = {
  resus:     "bg-red-500/15 text-red-500 ring-1 ring-red-500/30",
  emergent:  "bg-orange-500/15 text-orange-500 ring-1 ring-orange-500/30",
  urgent:    "bg-yellow-500/15 text-yellow-600 ring-1 ring-yellow-500/30",
  standard:  "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30",
  nonurgent: "bg-sky-500/15 text-sky-500 ring-1 ring-sky-500/30",
};
const RISK_CHIP = {
  stable:   "bg-emerald-500/15 text-emerald-500",
  low:      "bg-sky-500/15 text-sky-500",
  high:     "bg-amber-500/15 text-amber-500",
  critical: "bg-red-500/15 text-red-500",
};

// Kompakt alan: ekranın tamamı bir bakışta görünsün diye varsayılan input'tan bir tık dar.
const dense = (T) => `${inputCls(T)} px-2.5 py-2`;
const card = (T) => `rounded-2xl border ${T.border} ${T.card} p-4`;

/** Bir hastanın ünitesinin adı — yatak kaydından, yoksa ünite listesinden. */
function unitNameOf(state, patient) {
  if (!patient) return null;
  const bed = state.beds.find((b) => b.id === patient.bedId);
  if (bed?.unitName) return bed.unitName;
  const unit = state.structure?.units?.find((u) => u.id === (patient.unitId || bed?.unitId));
  return unit?.name || null;
}

/** Hastanın sorumlu hekiminin adı — kabulde atanan ekip kaydından. */
function attendingNameOf(state, patient) {
  if (!patient) return null;
  const team = state.careTeam?.[patient.patient_id];
  if (!team?.attendingId) return null;
  return state.users.find((u) => u.id === team.attendingId)?.full_name || null;
}

// ================================================================ SAYFA
export function AdmissionPage({ T, S, store, state, preselectTransfer, clearPreselect, lang = "tr" }) {
  const P = S.pr19;
  const [tab, setTab] = useState(preselectTransfer ? "transfer" : "admit");
  useEffect(() => { if (preselectTransfer) setTab("transfer"); }, [preselectTransfer]);
  const freeBeds = state.beds.filter((b) => b.state === "AVAILABLE").length;
  const tabs = [
    ["admit", P.tabAdmit, UserPlus],
    ["transfer", P.tabTransfer, ArrowLeftRight],
    ["care", P.tabCare, Users],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className={`inline-flex rounded-xl border ${T.border} ${T.subtle} p-1`}>
          {tabs.map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 font-semibold transition ${T.sizes.nav} ${tab === key ? T.navActive : T.navIdle}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        <span className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${freeBeds ? T.chip : "bg-amber-500/15 text-amber-500"}`}>
          <Bed size={13} /> {freeBeds} {P.availableBeds}
        </span>
      </div>
      {tab === "admit" && <AdmitForm T={T} S={S} store={store} state={state} lang={lang} />}
      {tab === "transfer" && (
        <TransferForm T={T} S={S} store={store} state={state}
          preselect={preselectTransfer} clearPreselect={clearPreselect} />
      )}
      {tab === "care" && <CareTeamPanel T={T} S={S} store={store} state={state} />}
    </div>
  );
}

// ================================================================ KABUL
export function AdmitForm({ T, S, store, state, lang = "tr" }) {
  const P = S.pr19;
  const units = state.structure.units;
  const attendings = state.users.filter((u) => u.role === ROLE.ATTENDING);
  const nurses = state.users.filter((u) => u.role === ROLE.CHARGE_NURSE);
  const [f, setF] = useState({
    name: "", birthDate: "", age: "", sex: "male", isNeonate: false, unitId: units[0]?.id || "",
    bedId: "", source: "emergency", risk: "stable", dx: "",
    triage: "standard", admittingComplaint: "", allergies: "", comorbidities: "",
    codeStatus: "full", isolation: "none", weight: "", height: "", bloodType: "",
    insurance: "", emergencyContact: "", emergencyPhone: "", attendingId: "", nurseId: "",
  });
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [admitted, setAdmitted] = useState(null);   // son kabul edilen hasta — etiket bundan basılır
  const [showContact, setShowContact] = useState(false);
  // The HIS record this form was filled from, kept so an edited field can be reported against
  // what the hospital actually sent rather than silently replacing it.
  const [fromHis, setFromHis] = useState(null);
  const upd = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const availBeds = state.beds.filter((b) => b.unitId === f.unitId && b.state === "AVAILABLE");
  const pending = awaitingLocalAdmission(state.patients);

  // Yaş doğum tarihinden türetilir; ikisi birden saklanıp biri eskimesin diye elle girilen yaş
  // yalnızca doğum tarihi bilinmiyorken kullanılır.
  const derivedAge = f.isNeonate ? null : ageFromBirthDate(f.birthDate);
  const effectiveAge = derivedAge != null ? derivedAge : (Number(f.age) || null);

  /**
   * Fill the form from a patient the HIS already admitted.
   *
   * Only fields the hospital actually stated are written; a value it did not send leaves the
   * form's own default alone rather than blanking it. Diagnoses arrive as ICD-10 codes and go
   * into the diagnosis box as text — the clinician can still edit, and what the HIS sent stays
   * on the card either way.
   */
  const applyHis = (p) => {
    setFromHis(p);
    setErr(""); setMsg("");
    setF((s) => ({
      ...s,
      name: p.display_name || s.name,
      sex: p.sex || s.sex,
      birthDate: p.birthDate || s.birthDate,
      age: p.age != null ? String(p.age) : s.age,
      dx: (p.hisDiagnoses || []).map((d) => `${d.code} ${d.text}`.trim()).join("; ") || s.dx,
    }));
  };

  const triageOpts = [
    ["resus", P.triageResus], ["emergent", P.triageEmergent], ["urgent", P.triageUrgent],
    ["standard", P.triageStandard], ["nonurgent", P.triageNonurgent],
  ];
  const codeOpts = [["full", P.codeFull], ["dnr", P.codeDnr], ["limited", P.codeLimited]];
  const isoOpts = [["none", P.isoNone], ["contact", P.isoContact], ["droplet", P.isoDroplet], ["airborne", P.isoAirborne]];

  // Eksik zorunlu alanlar — kaydırmadan görünür olsun diye sağ panelde de listelenir.
  const missing = useMemo(() => {
    const out = [];
    if (!f.name.trim()) out.push(S.fName);
    if (!f.dx.trim()) out.push(S.fDx);
    if (!f.bedId) out.push(S.fBed);
    return out;
  }, [f.name, f.dx, f.bedId, S]);

  const submit = (e) => {
    e.preventDefault(); setErr(""); setMsg("");
    try {
      const p = store.admitPatient({
        displayName: f.name, sex: f.sex, bedId: f.bedId, diagnosisText: f.dx,
        birthDate: f.isNeonate ? null : (f.birthDate || null),
        age: f.isNeonate ? 0 : effectiveAge,
        isNeonate: f.isNeonate, ageDays: f.isNeonate ? Number(f.age) || 0 : null,
        source: f.source, risk: f.risk,
        triage: f.triage, admittingComplaint: f.admittingComplaint,
        allergies: f.allergies, comorbidities: f.comorbidities, codeStatus: f.codeStatus, isolation: f.isolation,
        weight: Number(f.weight) || null, height: Number(f.height) || null, bloodType: f.bloodType,
        insurance: f.insurance, emergencyContact: f.emergencyContact, emergencyPhone: f.emergencyPhone,
        attendingId: f.attendingId || null, nurseId: f.nurseId || null,
      });
      setAdmitted(p);
      setMsg(`${S.admittedOk} (${p.protocolNo})`);
      setFromHis(null);
      setF((s) => ({ ...s, name: "", birthDate: "", age: "", dx: "", bedId: "", admittingComplaint: "",
        allergies: "", comorbidities: "", weight: "", height: "", bloodType: "", insurance: "",
        emergencyContact: "", emergencyPhone: "", attendingId: "", nurseId: "" }));
    } catch (ex) { setErr(ex.message); }
  };

  const resetForNew = () => { setAdmitted(null); setMsg(""); setErr(""); };

  return (
    <form onSubmit={submit} className="grid grid-cols-12 gap-4">
      {/* ---------------------------------------------------------------- SOL: form */}
      <div className="col-span-12 space-y-4 xl:col-span-8">
        {/* HIS'ten gelmiş, buraya henüz yatağa alınmamış hastalar. Bunlar doldurulacak değil,
            DOĞRULANACAK kayıtlardır: hastane kimliği, yatağı ve tanıları zaten söyledi. */}
        {pending.length > 0 && (
          <div className={`rounded-2xl border border-brand/40 ${T.card} p-3`}>
            <div className="mb-2 flex items-center gap-2">
              <PlugZap size={15} className="text-brand" />
              <span className={`text-xs font-semibold uppercase tracking-wide ${T.faint}`}>HBYS'den bekleyen yatışlar</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pending.map((p) => {
                const active = fromHis?.patient_id === p.patient_id;
                return (
                  <button key={p.patient_id} type="button" onClick={() => applyHis(p)}
                    className={`shrink-0 rounded-lg px-3 py-2 text-left ${T.sizes.nav} ${active ? T.navActive : T.ghost}`}>
                    <div className="font-semibold">{maskedName(state, p.display_name) || p.patient_id}</div>
                    <div className={`text-xs ${T.faint}`}>
                      {p.bedLabel || "—"}{p.hisDiagnoses?.length ? ` · ${p.hisDiagnoses.length} tanı` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
            {fromHis && (
              <div className={`mt-2 text-xs ${T.muted}`}>
                Alanlar HBYS'den dolduruldu. Değiştirebilirsiniz — özgün değer kayıtta kalır.
              </div>
            )}
          </div>
        )}

        {/* Bölüm 1 — Hasta Kimliği */}
        <div className={card(T)}>
          <SectionHeader T={T} icon={UserPlus} title={P.secIdentity} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <div className="col-span-2 sm:col-span-3">
              <Field T={T} label={S.fName}>
                <input className={dense(T)} value={f.name} onChange={(e) => upd("name", e.target.value)} required />
              </Field>
            </div>
            {!f.isNeonate && (
              <div className="col-span-1 sm:col-span-2">
                <Field T={T} label={P.birthDate}>
                  <input type="date" className={dense(T)} value={f.birthDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => upd("birthDate", e.target.value)} />
                </Field>
              </div>
            )}
            <div className="col-span-1">
              <Field T={T} label={f.isNeonate ? `${S.fAge} (${S.dayUnit})` : S.fAge}>
                {/* Doğum tarihi girildiyse yaş hesaplanır ve elle değiştirilemez: iki alan
                    birbiriyle çelişirse hangisinin doğru olduğu kimsenin bilemeyeceği bir şeydir. */}
                <input type="number" min="0" className={dense(T)}
                  value={derivedAge != null ? String(derivedAge) : f.age}
                  readOnly={derivedAge != null}
                  title={derivedAge != null ? P.ageFromBirth : undefined}
                  onChange={(e) => upd("age", e.target.value)} />
              </Field>
            </div>
            <div className="col-span-1 sm:col-span-2">
              <Field T={T} label={S.fSex}>
                <select className={dense(T)} value={f.sex} onChange={(e) => upd("sex", e.target.value)}>
                  <option value="male">{S.male}</option><option value="female">{S.female}</option>
                </select>
              </Field>
            </div>
            <div className="col-span-1 sm:col-span-2">
              <Field T={T} label={P.bloodType}>
                <select className={dense(T)} value={f.bloodType} onChange={(e) => upd("bloodType", e.target.value)}>
                  <option value="">—</option>
                  {["0 Rh+", "0 Rh−", "A Rh+", "A Rh−", "B Rh+", "B Rh−", "AB Rh+", "AB Rh−"].map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
            </div>
            <div className="col-span-1">
              <Field T={T} label={P.weight}>
                <input type="number" min="0" step="0.1" className={dense(T)} value={f.weight} onChange={(e) => upd("weight", e.target.value)} />
              </Field>
            </div>
            <div className="col-span-1">
              <Field T={T} label={P.height}>
                <input type="number" min="0" className={dense(T)} value={f.height} onChange={(e) => upd("height", e.target.value)} />
              </Field>
            </div>
            <label className={`col-span-2 flex items-center gap-2 self-end pb-2 ${T.sizes.nav} ${T.text}`}>
              <input type="checkbox" checked={f.isNeonate} onChange={(e) => upd("isNeonate", e.target.checked)} /> {S.unitNicu}
            </label>
          </div>
        </div>

        {/* Bölüm 2 — Klinik Değerlendirme & Triyaj */}
        <div className={card(T)}>
          <SectionHeader T={T} icon={Activity} title={P.secClinical} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Field T={T} label={P.triage}>
              <select className={dense(T)} value={f.triage} onChange={(e) => upd("triage", e.target.value)}>
                {triageOpts.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select>
            </Field>
            <Field T={T} label={S.riskLevel}>
              <select className={dense(T)} value={f.risk} onChange={(e) => upd("risk", e.target.value)}>
                {["stable", "low", "high", "critical"].map((r) => <option key={r} value={r}>{S.risk[r]}</option>)}
              </select>
            </Field>
            <Field T={T} label={P.codeStatus}>
              <select className={dense(T)} value={f.codeStatus} onChange={(e) => upd("codeStatus", e.target.value)}>
                {codeOpts.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select>
            </Field>
            <Field T={T} label={P.isolation}>
              <select className={dense(T)} value={f.isolation} onChange={(e) => upd("isolation", e.target.value)}>
                {isoOpts.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select>
            </Field>
            <div className="col-span-2">
              <Field T={T} label={P.admittingComplaint}>
                <input className={dense(T)} value={f.admittingComplaint} onChange={(e) => upd("admittingComplaint", e.target.value)} placeholder={P.complaintPlaceholder} />
              </Field>
            </div>
            <Field T={T} label={P.allergies}>
              <input className={dense(T)} value={f.allergies} onChange={(e) => upd("allergies", e.target.value)} placeholder={P.allergyPlaceholder} />
            </Field>
            <Field T={T} label={P.comorbidities}>
              <input className={dense(T)} value={f.comorbidities} onChange={(e) => upd("comorbidities", e.target.value)} placeholder={P.comorbidPlaceholder} />
            </Field>
            <div className="col-span-2 lg:col-span-4">
              <Field T={T} label={S.fDx}>
                <textarea rows={2} className={dense(T)} value={f.dx} onChange={(e) => upd("dx", e.target.value)} placeholder={S.dxPlaceholder} required />
              </Field>
            </div>
          </div>
        </div>

        {/* Bölüm 3 — Yatak, ekip ve (katlanmış) iletişim */}
        <div className={card(T)}>
          <SectionHeader T={T} icon={Bed} title={P.secBedTeam} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Field T={T} label={S.fUnit}>
              <select className={dense(T)} value={f.unitId} onChange={(e) => { upd("unitId", e.target.value); upd("bedId", ""); }}>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field T={T} label={S.fBed}>
              <select className={dense(T)} value={f.bedId} onChange={(e) => upd("bedId", e.target.value)} required>
                <option value="">{availBeds.length ? S.selectTargetBed : S.noAvailableBed}</option>
                {availBeds.map((b) => <option key={b.id} value={b.id}>{b.roomLabel} · {b.label}</option>)}
              </select>
            </Field>
            <Field T={T} label={S.fSource}>
              <select className={dense(T)} value={f.source} onChange={(e) => upd("source", e.target.value)}>
                {Object.keys(S.source).map((k) => <option key={k} value={k}>{S.source[k]}</option>)}
              </select>
            </Field>
            <Field T={T} label={P.assignAttending}>
              <select className={dense(T)} value={f.attendingId} onChange={(e) => upd("attendingId", e.target.value)}>
                <option value="">{S.none}</option>
                {attendings.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </Field>
            <Field T={T} label={P.assignNurse}>
              <select className={dense(T)} value={f.nurseId} onChange={(e) => upd("nurseId", e.target.value)}>
                <option value="">{S.none}</option>
                {nurses.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            </Field>
          </div>
          {/* İletişim/güvence alanları kabul kararını etkilemez; açılır kalır ki ekranın
              tamamı kaydırmadan görünsün. */}
          <button type="button" onClick={() => setShowContact((v) => !v)}
            className={`mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold ${T.navIdle}`}>
            <HeartHandshake size={13} /> {P.secContact}
            <ChevronDown size={13} className={showContact ? "rotate-180 transition" : "transition"} />
          </button>
          {showContact && (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field T={T} label={P.insurance}><input className={dense(T)} value={f.insurance} onChange={(e) => upd("insurance", e.target.value)} /></Field>
              <Field T={T} label={P.emergencyContact}><input className={dense(T)} value={f.emergencyContact} onChange={(e) => upd("emergencyContact", e.target.value)} /></Field>
              <Field T={T} label={P.emergencyPhone}><input className={dense(T)} value={f.emergencyPhone} onChange={(e) => upd("emergencyPhone", e.target.value)} /></Field>
            </div>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- SAĞ: özet + etiket */}
      <div className="col-span-12 xl:col-span-4">
        <div className="space-y-3 xl:sticky xl:top-4">
          <div className={card(T)}>
            <SectionHeader T={T} icon={Check} title={admitted ? P.lastAdmitted : P.summaryTitle} />
            {admitted ? (
              <AdmittedSummary T={T} S={S} state={state} patient={admitted} />
            ) : (
              <DraftSummary T={T} S={S} state={state} f={f} age={effectiveAge}
                unitName={units.find((u) => u.id === f.unitId)?.name}
                bedLabel={availBeds.find((b) => b.id === f.bedId)?.label}
                triageOpts={triageOpts} />
            )}

            {!admitted && missing.length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-500">
                  <AlertTriangle size={13} /> {P.missingRequired}
                </div>
                <ul className={`mt-1 space-y-0.5 text-xs ${T.muted}`}>
                  {missing.map((m) => <li key={m}>· {m}</li>)}
                </ul>
              </div>
            )}

            {err && <div className="mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
            {msg && <div className="mt-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-500">{msg}</div>}

            <div className="mt-3 flex flex-wrap gap-2">
              {admitted ? (
                <>
                  <button type="button" className={btnCls(T, "primary")}
                    onClick={() => printPatientLabel({
                      S, lang, patient: admitted,
                      unitName: unitNameOf(state, admitted),
                      attendingName: attendingNameOf(state, admitted),
                    })}>
                    <Printer size={16} /> {P.printLabel}
                  </button>
                  <button type="button" onClick={resetForNew} className={btnCls(T, "ghost")}>
                    <Plus size={16} /> {P.newAdmission}
                  </button>
                </>
              ) : (
                <button type="submit" disabled={missing.length > 0} className={`${btnCls(T, "primary")} w-full`}>
                  <Check size={16} /> {S.admitBtn}
                </button>
              )}
            </div>
          </div>

          <LabelPreview T={T} S={S} state={state} lang={lang} patient={admitted}
            draft={admitted ? null : {
              display_name: f.name,
              birthDate: f.birthDate,
              bedLabel: availBeds.find((b) => b.id === f.bedId)?.label,
              allergies: f.allergies, isolation: f.isolation, codeStatus: f.codeStatus, bloodType: f.bloodType,
            }}
            unitName={admitted ? unitNameOf(state, admitted) : units.find((u) => u.id === f.unitId)?.name}
            attendingName={admitted
              ? attendingNameOf(state, admitted)
              : state.users.find((u) => u.id === f.attendingId)?.full_name} />
        </div>
      </div>
    </form>
  );
}

/** Form doldurulurken oluşan canlı hasta kartı — kabulden sonra panoda görünecek şeyin aynısı. */
function DraftSummary({ T, S, state, f, age, unitName, bedLabel, triageOpts }) {
  const P = S.pr19;
  const name = f.name.trim();
  if (!name && !f.dx.trim() && !bedLabel) {
    return <div className={`rounded-lg border border-dashed ${T.border} px-3 py-6 text-center text-xs ${T.faint}`}>{P.summaryEmpty}</div>;
  }
  const triageLabel = (triageOpts.find(([k]) => k === f.triage) || [])[1];
  return (
    <div className="space-y-2.5">
      <div>
        <div className={`font-bold ${T.heading}`}>{maskedName(state, name) || "—"}</div>
        <div className={`text-xs ${T.muted}`}>
          {age != null ? `${age}${f.isNeonate ? ` ${S.dayUnit}` : ""}` : "—"} · {f.sex === "male" ? S.male : S.female}
          {f.bloodType ? ` · ${f.bloodType}` : ""}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${TRIAGE_UI[f.triage] || TRIAGE_UI.standard}`}>{triageLabel}</span>
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${RISK_CHIP[f.risk]}`}>{S.risk[f.risk]}</span>
        {f.codeStatus !== "full" && <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-500">{f.codeStatus === "dnr" ? P.codeDnr : P.codeLimited}</span>}
        {f.isolation !== "none" && <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-500">{P.isolation}</span>}
        {f.allergies.trim() && <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-500">{P.allergies}</span>}
      </div>
      <div className={`flex items-center gap-2 rounded-lg ${T.subtle} px-2.5 py-2 text-xs`}>
        <Bed size={13} className={T.faint} />
        <span className={T.text}>{bedLabel || "—"}</span>
        <span className={T.faint}>· {unitName || "—"}</span>
      </div>
      {f.dx.trim() && <div className={`line-clamp-3 text-xs ${T.muted}`}>{f.dx}</div>}
    </div>
  );
}

/** Kabul tamamlandı: artık protokol numarası ve dosya numarası olan gerçek bir kayıt var. */
function AdmittedSummary({ T, S, state, patient }) {
  return (
    <div className="space-y-2">
      <div className={`font-bold ${T.heading}`}>{maskedName(state, patient.display_name)}</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[[S.protocolNo, patient.protocolNo], [S.mrn, patient.mrn],
          [S.bed, patient.bedLabel], [S.admittedBy, patient.admittedBy]].map(([k, v]) => (
          <div key={k} className={`rounded-lg ${T.subtle} px-2.5 py-1.5`}>
            <div className={`text-[10px] uppercase ${T.faint}`}>{k}</div>
            <div className={`truncate font-semibold ${T.text}`}>{v || "—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Barkod etiketi önizlemesi — basılacak şeyin kendisi, ekranda kâğıt gibi.
 *
 * Kabul onaylanmadan önce protokol numarası YOKTUR; barkod alanı bu yüzden boş bir şerit olarak
 * durur ve neden boş olduğunu yazar. Uydurma bir numara göstermek, kabul edildiğinde basılacak
 * etiketin bambaşka bir numara taşıyacağı anlamına gelirdi.
 */
function LabelPreview({ T, S, state, lang, patient, draft, unitName, attendingName }) {
  const P = S.pr19;
  const source = patient || draft;
  const lines = labelLines(
    patient
      ? patient
      : { ...draft, display_name: maskedName(state, draft?.display_name), protocolNo: null, mrn: null, admittedAtMs: null },
    { S, unitName, attendingName, lang },
  );
  const chips = labelSafetyChips(source, { S });
  const svg = patient?.protocolNo ? code128Svg(patient.protocolNo, { module: 2, height: 44 }) : null;
  return (
    <div className={card(T)}>
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-xs font-semibold uppercase tracking-wide ${T.faint}`}>{P.labelPreview}</span>
        <Printer size={14} className={T.faint} />
      </div>
      {/* Etiket her temada beyaz kâğıt gibi görünür — çıktının nasıl çıkacağı budur. */}
      <div className="rounded-lg bg-white p-3 text-slate-900 ring-1 ring-slate-300">
        {svg ? (
          <div className="flex flex-col items-end">
            <div className="w-full" dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="text-sm font-black tracking-wide">{patient.protocolNo}</div>
          </div>
        ) : (
          <div className="rounded border border-dashed border-slate-300 px-2 py-3 text-center text-[10px] leading-tight text-slate-400">
            {P.labelBeforeAdmit}
          </div>
        )}
        <table className="mt-2 w-full">
          <tbody>
            {lines.length === 0 && (
              <tr><td className="py-2 text-center text-[11px] text-slate-400">{P.summaryEmpty}</td></tr>
            )}
            {lines.map(({ label, value }) => (
              <tr key={label}>
                <th className="whitespace-nowrap py-[1px] pr-2 text-left text-[11px] font-medium text-slate-600">{label} :</th>
                <td className="py-[1px] text-[11.5px] font-bold">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {chips.map((c) => (
              <span key={c.text}
                className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${c.kind === "allergy" || c.kind === "code" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-900 text-slate-900"}`}>
                {c.text}
              </span>
            ))}
          </div>
        )}
      </div>
      <p className={`mt-2 text-[11px] ${T.faint}`}>{P.labelNameFull}</p>
    </div>
  );
}

// ================================================================ TRANSFER
export function TransferForm({ T, S, store, state, preselect, clearPreselect }) {
  const [patientId, setPatientId] = useState(preselect || "");
  const [bedId, setBedId] = useState("");
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  useEffect(() => { if (preselect) setPatientId(preselect); }, [preselect]);
  const availBeds = state.beds.filter((b) => b.state === "AVAILABLE");
  const patient = state.patients.find((p) => p.patient_id === patientId) || null;
  const target = availBeds.find((b) => b.id === bedId) || null;
  const submit = (e) => {
    e.preventDefault(); setErr(""); setMsg("");
    try {
      store.transferPatient({ patientId, targetBedId: bedId });
      setMsg(S.transferredOk); setBedId("");
      if (clearPreselect) clearPreselect();
    } catch (ex) { setErr(ex.message); }
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-12 gap-4">
      {/* Hasta seçimi liste olarak: açılır kutuda "hangi hasta" sorusunu yatak etiketiyle
          birlikte görmek mümkün değildi, transfer tam olarak o iki şeyin kararıdır. */}
      <div className={`col-span-12 xl:col-span-7 ${card(T)}`}>
        <SectionHeader T={T} icon={ArrowLeftRight} title={S.selectPatient} hint={S.transferSub} />
        <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
          {state.patients.map((p) => {
            const active = p.patient_id === patientId;
            return (
              <button key={p.patient_id} type="button" onClick={() => setPatientId(p.patient_id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? T.navActive : T.navIdle}`}>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${T.subtle} text-xs font-bold`}>{p.bedLabel}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-semibold ${T.sizes.nav}`}>{maskedName(state, p.display_name)}</span>
                  <span className={`block truncate text-xs ${T.faint}`}>{p.diagnosis || "—"}</span>
                </span>
                {active && <Check size={16} className="shrink-0 text-brand" />}
              </button>
            );
          })}
          {state.patients.length === 0 && (
            <div className={`rounded-lg border border-dashed ${T.border} px-3 py-6 text-center text-xs ${T.faint}`}>{S.emptyBoard}</div>
          )}
        </div>
      </div>
      <div className="col-span-12 xl:col-span-5">
        <div className={`${card(T)} xl:sticky xl:top-4`}>
          <SectionHeader T={T} icon={Bed} title={S.selectTargetBed} />
          <Field T={T} label={S.fBed}>
            <select className={dense(T)} value={bedId} onChange={(e) => setBedId(e.target.value)} required>
              <option value="">{availBeds.length ? S.selectTargetBed : S.noAvailableBed}</option>
              {availBeds.map((b) => <option key={b.id} value={b.id}>{b.unitName} · {b.roomLabel} · {b.label}</option>)}
            </select>
          </Field>
          <div className={`mt-3 flex items-center justify-between rounded-xl ${T.subtle} px-3 py-3`}>
            <div className="min-w-0">
              <div className={`text-[10px] uppercase ${T.faint}`}>{S.bed}</div>
              <div className={`truncate font-bold ${T.heading}`}>{patient?.bedLabel || "—"}</div>
            </div>
            <ArrowLeftRight size={16} className={T.faint} />
            <div className="min-w-0 text-right">
              <div className={`text-[10px] uppercase ${T.faint}`}>{S.selectTargetBed}</div>
              <div className={`truncate font-bold ${T.heading}`}>{target?.label || "—"}</div>
            </div>
          </div>
          {err && <div className="mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
          {msg && <div className="mt-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-500">{msg}</div>}
          <button type="submit" disabled={!patientId || !bedId} className={`${btnCls(T, "primary")} mt-3 w-full`}>
            <ArrowLeftRight size={16} /> {S.transferBtn}
          </button>
        </div>
      </div>
    </form>
  );
}

// ================================================================ BAKIM EKİBİ
export function CareTeamPanel({ T, S, store, state }) {
  const attendings = state.users.filter((u) => u.role === ROLE.ATTENDING);
  const nurses = state.users.filter((u) => u.role === ROLE.CHARGE_NURSE);
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className={`col-span-12 xl:col-span-8 ${card(T)}`}>
        <SectionHeader T={T} icon={Users} title={S.careTitle} hint={S.careSub} />
        <div className="space-y-2">
          {state.patients.map((p) => {
            const team = state.careTeam[p.patient_id] || {};
            return (
              <div key={p.patient_id} className={`grid grid-cols-1 items-center gap-3 rounded-xl border ${T.border} ${T.subtle} p-3 sm:grid-cols-3`}>
                <div className="min-w-0">
                  <div className={`truncate font-semibold ${T.text}`}>{p.bedLabel} · {maskedName(state, p.display_name)}</div>
                  <div className={`truncate text-xs ${T.faint}`}>{p.diagnosis || "—"}</div>
                </div>
                <Field T={T} label={S.attending}>
                  <select className={dense(T)} value={team.attendingId || ""}
                    onChange={(e) => store.assignCareTeam({ patientId: p.patient_id, attendingId: e.target.value })}>
                    <option value="">{S.none}</option>
                    {attendings.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                </Field>
                <Field T={T} label={S.nurse}>
                  <select className={dense(T)} value={team.nurseId || ""}
                    onChange={(e) => store.assignCareTeam({ patientId: p.patient_id, nurseId: e.target.value })}>
                    <option value="">{S.none}</option>
                    {nurses.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                </Field>
              </div>
            );
          })}
          {state.patients.length === 0 && (
            <div className={`rounded-lg border border-dashed ${T.border} px-3 py-6 text-center text-xs ${T.faint}`}>{S.emptyBoard}</div>
          )}
        </div>
      </div>
      <div className="col-span-12 xl:col-span-4">
        <div className={`${card(T)} xl:sticky xl:top-4`}>
          <SectionHeader T={T} icon={HeartPulse} title={S.shiftRoster} />
          <div className="space-y-1.5">
            {state.users.map((u) => (
              <div key={u.id} className={`flex items-center gap-3 rounded-lg ${T.subtle} px-3 py-2`}>
                <div className="grid h-8 w-8 place-items-center rounded-full bg-brand/15 text-brand">
                  {u.role === ROLE.HOSPITAL_ADMIN ? <ShieldAlert size={15} /> : u.role === ROLE.CHARGE_NURSE ? <HeartPulse size={15} /> : <Stethoscope size={15} />}
                </div>
                <div className="min-w-0">
                  <div className={`truncate text-sm font-semibold ${T.text}`}>{u.full_name}</div>
                  <div className={`truncate text-xs ${T.faint}`}>{S.roleName[u.role]}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdmissionPage;

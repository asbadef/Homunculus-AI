// src/ClinicalDemo.jsx — interactive, in-browser clinical demo (login → role panels → admission →
// live alarm / escalation / snooze). Wraps the synthetic engine in clinicalDemo.js. No network.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, LogOut, Languages, ShieldAlert, BedDouble, UserPlus, AlertTriangle, Clock,
  Check, BellOff, ArrowUpCircle, Play, Pause, Stethoscope, HeartPulse, Building2,
} from "lucide-react";
import {
  createDemoStore, DEMO_ACCOUNTS, ROLE, TIER, TIER_TO_SEV, ESCALATION_STEP, STEP_TARGET_ROLE,
  ESCALATION_THRESHOLDS_SEC, secondsToNextStep, canSnooze, snoozeCapMinutes, ACK_REASON_MIN_CHARS,
} from "./clinicalDemo.js";
import { sev } from "./theme.js";
import { LANGS, storedLang, persistLang } from "./i18n.js";

// --------------------------------------------------------------------------- local strings (tr + az)
const STR = {
  tr: {
    appName: "Homunculus", demoBadge: "DEMO · sentetik veri",
    loginTitle: "Demo Girişi", loginSub: "Bir rol seçin ya da hesap bilgileriyle giriş yapın",
    email: "E-posta", password: "Parola", signIn: "Giriş Yap", quickLogin: "Hızlı giriş",
    invalid: "Geçersiz e-posta veya parola.",
    roleName: { ATTENDING: "Sorumlu Hekim", CHARGE_NURSE: "Sorumlu Hemşire",
                HOSPITAL_ADMIN: "Admin", RRT: "Hızlı Yanıt Ekibi (RRT)" },
    logout: "Çıkış", role: "Rol", simClock: "Simülasyon saati", speed: "Demo hızı",
    realtime: "gerçek zaman",
    panelAdmin: "Yapı & Yatak Yönetimi", panelDoctor: "Klinik Panel", panelNurse: "Hemşire Paneli",
    tenant: "Kurum", site: "Kampüs", unit: "Ünite", maxNurse: "Hemşire başı yatak",
    beds: "Yataklar", bedAvailable: "Müsait", bedOccupied: "Dolu",
    admission: "Yeni Hasta Yatışı", admissionHint: "Kabul notu (28 alan) demoda sadeleştirilmiştir.",
    displayName: "Hasta adı (sentetik)", sex: "Cinsiyet", male: "Erkek", female: "Kadın",
    selectBed: "Yatak seçin", diagnosis: "Kabul değerlendirmesi", admit: "Yatışı Onayla",
    admissionOnlyDoctor: "Yeni yatış için Sorumlu Hekim rolü gerekir.",
    noBeds: "Müsait yatak yok.",
    board: "Hasta Panosu", noPatients: "Henüz yatan hasta yok. Soldan yeni yatış yapın.",
    admittedBy: "Yatıran", bed: "Yatak",
    fireAlert: "Alarm tetikle", alertKind: "Alarm", alertTier: "Seviye",
    fireBtn: "Tetikle", activeAlerts: "Aktif Alarmlar", noAlerts: "Aktif alarm yok.",
    elapsed: "Geçen süre", nextStep: "Sonraki adım", atTier3: "En üst eskalasyon (RRT)",
    escChain: "Eskalasyon zinciri", step1: "3 dk · Sorumlu Hemşire", step2: "5 dk · Nöbetçi Hekim",
    step3: "10 dk · RRT", sentTo: "Gönderildi", ack: "Onayla", snooze: "Ertele",
    escalateRRT: "RRT'ye eskale et", statusFired: "Tetiklendi", statusAck: "Onaylandı",
    statusSnoozed: "Ertelendi", snoozedUntil: "Erteleme bitişi",
    ackTitle: "Alarmı Onayla", ackReason: "Gerekçe", ackNote: "Not",
    ackNoteHintCrit: `Kritik alarm için zorunlu · en az ${ACK_REASON_MIN_CHARS} karakter`,
    critNoSnooze: "Kritik alarm ertelenemez — zorunlu gerekçe ile onaylanmalı.",
    snoozeTitle: "Alarmı Ertele", snoozeMinutes: "Süre (dk)", snoozeReason: "Gerekçe",
    cancel: "Vazgeç", confirm: "Onayla", save: "Kaydet",
    reasonOptions: { clinically_reviewed: "Klinik olarak değerlendirildi",
                     intervention_done: "Müdahale yapıldı", clinically_expected: "Beklenen (kronik)",
                     awaiting_labs: "Tetkik bekleniyor", other: "Diğer" },
    breakGlass: "Break-Glass (Acil Erişim)", bgActive: "Aktif", bgActivate: "Etkinleştir",
    bgExtend: "30 dk uzat", bgReason: "Acil erişim gerekçesi",
    bgExpires: "Bitiş", bgInfo: "30 dk geçici acil erişim; zorunlu gerekçe.",
    diagnosisPlaceholder: "Örn. Septik şok kriterleri değerlendirilecek",
    namePlaceholder: "Örn. Sentetik Hasta 1",
  },
  az: {
    appName: "Homunculus", demoBadge: "DEMO · sintetik məlumat",
    loginTitle: "Demo Girişi", loginSub: "Rol seçin və ya hesabla daxil olun",
    email: "E-poçt", password: "Parol", signIn: "Daxil ol", quickLogin: "Sürətli giriş",
    invalid: "Yanlış e-poçt və ya parol.",
    roleName: { ATTENDING: "Məsul Həkim", CHARGE_NURSE: "Məsul Tibb Bacısı",
                HOSPITAL_ADMIN: "Admin", RRT: "Sürətli Cavab Qrupu (RRT)" },
    logout: "Çıxış", role: "Rol", simClock: "Simulyasiya saatı", speed: "Demo sürəti",
    realtime: "real vaxt",
    panelAdmin: "Struktur & Çarpayı İdarəsi", panelDoctor: "Klinik Panel", panelNurse: "Tibb Bacısı Paneli",
    tenant: "Qurum", site: "Kampus", unit: "Bölmə", maxNurse: "Tibb bacısı başına çarpayı",
    beds: "Çarpayılar", bedAvailable: "Boş", bedOccupied: "Dolu",
    admission: "Yeni Xəstə Qəbulu", admissionHint: "Qəbul qeydi (28 sahə) demoda sadələşdirilib.",
    displayName: "Xəstə adı (sintetik)", sex: "Cins", male: "Kişi", female: "Qadın",
    selectBed: "Çarpayı seçin", diagnosis: "Qəbul dəyərləndirməsi", admit: "Qəbulu Təsdiqlə",
    admissionOnlyDoctor: "Yeni qəbul üçün Məsul Həkim rolu lazımdır.",
    noBeds: "Boş çarpayı yoxdur.",
    board: "Xəstə Panosu", noPatients: "Hələ yatan xəstə yoxdur. Soldan yeni qəbul edin.",
    admittedBy: "Qəbul edən", bed: "Çarpayı",
    fireAlert: "Xəbərdarlıq işə sal", alertKind: "Xəbərdarlıq", alertTier: "Səviyyə",
    fireBtn: "İşə sal", activeAlerts: "Aktiv Xəbərdarlıqlar", noAlerts: "Aktiv xəbərdarlıq yoxdur.",
    elapsed: "Keçən vaxt", nextStep: "Növbəti addım", atTier3: "Ən üst eskalasiya (RRT)",
    escChain: "Eskalasiya zənciri", step1: "3 dəq · Məsul Tibb Bacısı", step2: "5 dəq · Növbətçi Həkim",
    step3: "10 dəq · RRT", sentTo: "Göndərildi", ack: "Təsdiqlə", snooze: "Təxirə sal",
    escalateRRT: "RRT-yə eskalasiya", statusFired: "İşə salındı", statusAck: "Təsdiqləndi",
    statusSnoozed: "Təxirə salındı", snoozedUntil: "Təxir bitişi",
    ackTitle: "Xəbərdarlığı Təsdiqlə", ackReason: "Əsas", ackNote: "Qeyd",
    ackNoteHintCrit: `Kritik üçün məcburi · ən az ${ACK_REASON_MIN_CHARS} simvol`,
    critNoSnooze: "Kritik xəbərdarlıq təxirə salına bilməz — məcburi əsasla təsdiqlənməlidir.",
    snoozeTitle: "Xəbərdarlığı Təxirə Sal", snoozeMinutes: "Müddət (dəq)", snoozeReason: "Əsas",
    cancel: "İmtina", confirm: "Təsdiqlə", save: "Yadda saxla",
    reasonOptions: { clinically_reviewed: "Klinik dəyərləndirildi",
                     intervention_done: "Müdaxilə edildi", clinically_expected: "Gözlənilən (xronik)",
                     awaiting_labs: "Analiz gözlənilir", other: "Digər" },
    breakGlass: "Break-Glass (Təcili Giriş)", bgActive: "Aktiv", bgActivate: "Aktivləşdir",
    bgExtend: "30 dəq uzat", bgReason: "Təcili giriş əsası",
    bgExpires: "Bitiş", bgInfo: "30 dəq müvəqqəti təcili giriş; məcburi əsas.",
    diagnosisPlaceholder: "Məs. Septik şok kriterləri dəyərləndiriləcək",
    namePlaceholder: "Məs. Sintetik Xəstə 1",
  },
};
const useStr = (lang) => STR[lang] || STR.tr;

// mm:ss from seconds.
const fmt = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const TIER_LABEL = { CRITICAL: "CRITICAL", HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW", INFO: "INFO" };

// --------------------------------------------------------------------------- store hook + clock
function useDemoStore() {
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createDemoStore();
  const store = storeRef.current;
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), [store]);
  return store;
}

// --------------------------------------------------------------------------- Login
function Login({ store, L, lang, setLang }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const submit = (e) => {
    e.preventDefault();
    try { store.login(email.trim(), password); } catch { setErr(L.invalid); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 p-8 ring-1 ring-slate-800">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="text-brand" size={22} />
            <span className="text-lg font-semibold">{L.appName}</span>
          </div>
          <LangSelect lang={lang} setLang={setLang} L={L} />
        </div>
        <h1 className="text-xl font-semibold">{L.loginTitle}</h1>
        <p className="mt-1 text-sm text-slate-400">{L.loginSub}</p>

        <div className="mt-5 space-y-2">
          <div className="text-xs uppercase tracking-wide text-slate-500">{L.quickLogin}</div>
          <div className="grid gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                onClick={() => store.loginAs(a.role)}
                className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-left text-sm transition-colors hover:border-brand hover:bg-slate-800/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span className="flex items-center gap-2">
                  <RoleIcon role={a.role} />
                  <span>
                    <span className="font-medium text-slate-100">{a.full_name}</span>
                    <span className="ml-2 text-xs text-slate-400">{L.roleName[a.role]}</span>
                  </span>
                </span>
                <span className="font-mono text-xs text-slate-500">{a.email}</span>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <div>
            <label className="block text-xs text-slate-400">{L.email}</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              placeholder="hekim@demo" autoComplete="username" />
          </div>
          <div>
            <label className="block text-xs text-slate-400">{L.password}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              placeholder="demo1234" autoComplete="current-password" />
          </div>
          {err && <p className="text-sm text-sev-critical">{err}</p>}
          <button type="submit"
            className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {L.signIn}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">{L.demoBadge}</p>
      </div>
    </div>
  );
}

function RoleIcon({ role, size = 16 }) {
  if (role === ROLE.ATTENDING) return <Stethoscope size={size} className="text-brand" />;
  if (role === ROLE.CHARGE_NURSE) return <HeartPulse size={size} className="text-emerald-400" />;
  if (role === ROLE.HOSPITAL_ADMIN) return <Building2 size={size} className="text-amber-300" />;
  return <ShieldAlert size={size} className="text-sev-critical" />;
}

function LangSelect({ lang, setLang, L }) {
  return (
    <label className="flex items-center gap-1 text-slate-400" title={L.langLabel}>
      <Languages size={14} />
      <select value={lang} onChange={(e) => setLang(e.target.value)}
        className="cursor-pointer rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        {LANGS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </label>
  );
}

// --------------------------------------------------------------------------- header
function Header({ store, st, L, lang, setLang }) {
  const speeds = [1, 30, 60, 120];
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2">
      <div className="flex items-center gap-2">
        <Activity className="text-brand" size={18} />
        <span className="font-semibold">{L.appName}</span>
      </div>
      <span className="rounded-full bg-teal-600 px-2 py-0.5 text-xs font-semibold text-white">{L.demoBadge}</span>

      <div className="ml-2 flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-1 text-xs">
        <RoleIcon role={st.user.role} size={14} />
        <span className="font-medium">{st.user.full_name}</span>
        <span className="text-slate-400">· {L.roleName[st.user.role]}</span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* sim clock */}
        <span className="flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 font-mono text-xs text-slate-300"
          title={L.simClock}>
          <Clock size={13} /> {fmt(st.clockSec)}
        </span>
        {/* run / pause */}
        <button onClick={() => store.setRunning(!st.running)}
          className="rounded p-1 text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          title={st.running ? "Duraklat" : "Devam"}>
          {st.running ? <Pause size={15} /> : <Play size={15} />}
        </button>
        {/* speed */}
        <label className="flex items-center gap-1 text-xs text-slate-400">
          {L.speed}
          <select value={st.speed} onChange={(e) => store.setSpeed(Number(e.target.value))}
            className="cursor-pointer rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {speeds.map((s) => <option key={s} value={s}>{s === 1 ? L.realtime : `${s}×`}</option>)}
          </select>
        </label>
        <LangSelect lang={lang} setLang={setLang} L={L} />
        <button onClick={() => store.logout()}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <LogOut size={14} /> {L.logout}
        </button>
      </div>
    </header>
  );
}

// --------------------------------------------------------------------------- admission form
function AdmissionForm({ store, st, L }) {
  const avail = st.beds.filter((b) => b.state === "AVAILABLE");
  const [displayName, setDisplayName] = useState("");
  const [sex, setSex] = useState("male");
  const [bedId, setBedId] = useState(avail[0]?.id || "");
  const [diagnosis, setDiagnosis] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { if (!avail.find((b) => b.id === bedId)) setBedId(avail[0]?.id || ""); }, [st.beds]);

  const submit = (e) => {
    e.preventDefault();
    setErr("");
    try {
      store.admitPatient({
        displayName: displayName.trim() || "Sentetik Hasta",
        sex, bedId,
        diagnosisText: diagnosis.trim() || L.diagnosisPlaceholder,
      });
      setDisplayName(""); setDiagnosis("");
    } catch (ex) { setErr(ex.message); }
  };

  return (
    <section className="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <div className="flex items-center gap-2 font-semibold"><UserPlus size={16} className="text-brand" /> {L.admission}</div>
      <p className="mt-1 text-xs text-slate-500">{L.admissionHint}</p>
      {avail.length === 0
        ? <p className="mt-3 text-sm text-amber-300">{L.noBeds}</p>
        : (
          <form onSubmit={submit} className="mt-3 space-y-3">
            <div>
              <label className="block text-xs text-slate-400">{L.displayName}</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                placeholder={L.namePlaceholder}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400">{L.sex}</label>
                <select value={sex} onChange={(e) => setSex(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  <option value="male">{L.male}</option>
                  <option value="female">{L.female}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400">{L.bed}</label>
                <select value={bedId} onChange={(e) => setBedId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  {avail.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400">{L.diagnosis}</label>
              <textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={2}
                placeholder={L.diagnosisPlaceholder}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
            </div>
            {err && <p className="text-sm text-sev-critical">{err}</p>}
            <button type="submit"
              className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              {L.admit}
            </button>
          </form>
        )}
    </section>
  );
}

// --------------------------------------------------------------------------- bed grid
function BedGrid({ st, L }) {
  return (
    <section className="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <div className="flex items-center gap-2 font-semibold"><BedDouble size={16} className="text-brand" /> {L.beds}</div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {st.beds.map((b) => {
          const occupied = b.state === "OCCUPIED";
          const p = occupied ? st.patients.find((x) => x.patient_id === b.patientId) : null;
          return (
            <div key={b.id}
              className={`rounded-lg p-3 ring-1 ${occupied ? "bg-slate-800 ring-brand/50" : "bg-slate-900 ring-slate-700"}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{b.label}</span>
                <span className={`h-2.5 w-2.5 rounded-full ${occupied ? "bg-brand" : "bg-slate-600"}`} />
              </div>
              {occupied
                ? (
                  <div className="mt-2 text-xs">
                    <div className="font-medium text-slate-100">{p?.display_name}</div>
                    <div className="mt-0.5 text-slate-400">{p?.patient_id}</div>
                  </div>
                )
                : <div className="mt-2 text-xs text-slate-500">{L.bedAvailable}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- fire-alert control
function FireAlertControl({ store, st, L }) {
  const [patientId, setPatientId] = useState(st.patients[0]?.patient_id || "");
  const [tier, setTier] = useState(TIER.CRITICAL);
  useEffect(() => { if (!st.patients.find((p) => p.patient_id === patientId)) setPatientId(st.patients[0]?.patient_id || ""); }, [st.patients]);
  if (st.patients.length === 0) return null;
  const fire = () => {
    if (!patientId) return;
    const summary = tier === TIER.CRITICAL
      ? "Septik şok kriterleri değerlendirilecek"
      : "Klinik kötüleşme kriterleri değerlendirilecek";
    store.fireAlert({ patientId, tier, summary });
  };
  return (
    <section className="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} className="text-sev-critical" /> {L.fireAlert}</div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select value={patientId} onChange={(e) => setPatientId(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          {st.patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.bedLabel} · {p.display_name}</option>)}
        </select>
        <select value={tier} onChange={(e) => setTier(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <option value={TIER.CRITICAL}>CRITICAL</option>
          <option value={TIER.HIGH}>HIGH</option>
          <option value={TIER.MEDIUM}>MEDIUM</option>
        </select>
        <button onClick={fire}
          className="rounded-lg bg-sev-critical px-3 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          {L.fireBtn}
        </button>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- alert card
function EscalationChain({ alert, L }) {
  const steps = [
    { step: ESCALATION_STEP.TIER_1_CHARGE_NURSE, label: L.step1 },
    { step: ESCALATION_STEP.TIER_2_PHYSICIAN, label: L.step2 },
    { step: ESCALATION_STEP.TIER_3_RRT, label: L.step3 },
  ];
  const crossed = new Set(alert.events.map((e) => e.step));
  return (
    <div className="mt-3 rounded-lg bg-slate-950/60 p-3 ring-1 ring-slate-800">
      <div className="text-xs font-semibold text-slate-400">{L.escChain}</div>
      <ol className="mt-2 space-y-1.5">
        {steps.map((s) => {
          const done = crossed.has(s.step);
          return (
            <li key={s.step} className="flex items-center gap-2 text-sm">
              {done
                ? <ArrowUpCircle size={15} className="text-sev-critical" />
                : <span className="ml-0.5 h-3 w-3 rounded-full border border-slate-600" />}
              <span className={done ? "font-medium text-slate-100" : "text-slate-500"}>{s.label}</span>
              {done && <span className="ml-auto rounded-full bg-sev-critical/15 px-2 py-0.5 text-xs text-sev-critical">{L.sentTo}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function AlertCard({ store, st, alert, L, onAckOpen, onSnoozeOpen }) {
  const s = sev(TIER_TO_SEV[alert.tier]);
  const elapsed = alert.status === "FIRED" ? st.clockSec - alert.firedAtSec : 0;
  const toNext = secondsToNextStep(elapsed, alert.tier);
  const isCritical = alert.tier === TIER.CRITICAL;
  const statusLabel = { FIRED: L.statusFired, ACKNOWLEDGED: L.statusAck, SNOOZED: L.statusSnoozed,
                        CLOSED: "Kapalı" }[alert.status];

  return (
    <div className={`rounded-xl bg-slate-900 p-4 ring-1 ${s.ring}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${s.text} bg-slate-800`}>
          <AlertTriangle size={13} /> {TIER_LABEL[alert.tier]}
        </span>
        <span className="font-medium text-slate-100">{alert.summary}</span>
        <span className="ml-auto text-xs text-slate-400">{alert.bedLabel}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <span>{L.elapsed}: <span className="font-mono text-slate-200">{fmt(elapsed)}</span></span>
        {alert.status === "FIRED" && (toNext !== null
          ? <span>{L.nextStep}: <span className="font-mono text-slate-200">{fmt(toNext)}</span></span>
          : <span className="text-sev-critical">{L.atTier3}</span>)}
        <span className="rounded-full bg-slate-800 px-2 py-0.5">{statusLabel}</span>
        {alert.status === "SNOOZED" && alert.snooze &&
          <span>{L.snoozedUntil}: <span className="font-mono text-slate-200">{fmt(alert.snooze.until)}</span></span>}
      </div>

      {(alert.status === "FIRED" || alert.events.length > 0) && <EscalationChain alert={alert} L={L} />}

      {alert.status === "ACKNOWLEDGED" && alert.ack && (
        <p className="mt-3 flex items-center gap-1 text-sm text-emerald-400">
          <Check size={14} /> {L.statusAck}: {alert.ack.by}
          {alert.ack.note && <span className="text-slate-400">· {alert.ack.note}</span>}
        </p>
      )}

      {alert.status !== "ACKNOWLEDGED" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => onAckOpen(alert)}
            className="flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <Check size={14} /> {L.ack}
          </button>
          {isCritical
            ? (
              <span title={L.critNoSnooze}
                className="flex cursor-not-allowed items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-500">
                <BellOff size={14} /> {L.snooze}
              </span>
            )
            : (
              <button onClick={() => onSnoozeOpen(alert)}
                className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                <BellOff size={14} /> {L.snooze}
              </button>
            )}
          {alert.currentStep !== ESCALATION_STEP.TIER_3_RRT && (
            <button onClick={() => store.escalateToRRT(alert.id)}
              className="flex items-center gap-1 rounded-lg border border-sev-critical/50 px-3 py-1.5 text-sm text-sev-critical hover:bg-sev-critical/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <ArrowUpCircle size={14} /> {L.escalateRRT}
            </button>
          )}
        </div>
      )}
      {isCritical && alert.status === "FIRED" && (
        <p className="mt-2 text-xs text-slate-500">{L.critNoSnooze}</p>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- modals
function AckModal({ store, alert, L, onClose }) {
  const isCritical = alert.tier === TIER.CRITICAL;
  const [reason, setReason] = useState("clinically_reviewed");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const submit = () => {
    try { store.acknowledgeAlert(alert.id, { reason, note }); onClose(); }
    catch (ex) { setErr(ex.message); }
  };
  return (
    <Modal onClose={onClose} title={L.ackTitle}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-slate-400">{L.ackReason}{isCritical && " *"}</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {Object.entries(L.reasonOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400">{L.ackNote}{isCritical && ` · ${L.ackNoteHintCrit}`}</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
        </div>
        {err && <p className="text-sm text-sev-critical">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">{L.cancel}</button>
          <button onClick={submit} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90">{L.confirm}</button>
        </div>
      </div>
    </Modal>
  );
}

function SnoozeModal({ store, alert, L, onClose }) {
  const cap = snoozeCapMinutes(alert.tier) || 0;
  const [minutes, setMinutes] = useState(Math.min(15, cap));
  const [reason, setReason] = useState("clinically_expected");
  const [err, setErr] = useState("");
  const submit = () => {
    try { store.snoozeAlert(alert.id, { minutes: Number(minutes), reason }); onClose(); }
    catch (ex) { setErr(ex.message); }
  };
  return (
    <Modal onClose={onClose} title={L.snoozeTitle}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">{TIER_LABEL[alert.tier]} · max {cap} dk</p>
        <div>
          <label className="block text-xs text-slate-400">{L.snoozeMinutes}</label>
          <input type="number" min={1} max={cap} value={minutes} onChange={(e) => setMinutes(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
        </div>
        <div>
          <label className="block text-xs text-slate-400">{L.snoozeReason} *</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {Object.entries(L.reasonOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {err && <p className="text-sm text-sev-critical">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">{L.cancel}</button>
          <button onClick={submit} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90">{L.save}</button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 ring-1 ring-slate-700" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-semibold text-slate-100">{title}</h3>
        {children}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- break-glass panel
function BreakGlassPanel({ store, st, L }) {
  const active = store.breakGlassActive();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const activate = () => {
    try { store.activateBreakGlass(reason); setReason(""); setErr(""); }
    catch (ex) { setErr(ex.message); }
  };
  return (
    <section className="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <div className="flex items-center gap-2 font-semibold">
        <ShieldAlert size={16} className="text-amber-300" /> {L.breakGlass}
        {active && <span className="ml-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs text-amber-300">{L.bgActive}</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">{L.bgInfo}</p>
      {active
        ? (
          <div className="mt-3 space-y-2 text-sm">
            <div className="text-slate-300">{st.breakGlass.reason}</div>
            <div className="text-xs text-slate-400">{L.bgExpires}: <span className="font-mono">{fmt(st.breakGlass.expiresAtSec)}</span></div>
            <button onClick={() => store.extendBreakGlass()}
              className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-400/10">{L.bgExtend}</button>
          </div>
        )
        : (
          <div className="mt-3 space-y-2">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder={L.bgReason}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" />
            {err && <p className="text-sm text-sev-critical">{err}</p>}
            <button onClick={activate}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-amber-400">{L.bgActivate}</button>
          </div>
        )}
    </section>
  );
}

// --------------------------------------------------------------------------- panels
function AlertsColumn({ store, st, L }) {
  const [ackAlert, setAckAlert] = useState(null);
  const [snoozeAlert, setSnoozeAlert] = useState(null);
  const active = st.alerts.filter((a) => a.status !== "ACKNOWLEDGED");
  const acked = st.alerts.filter((a) => a.status === "ACKNOWLEDGED");
  return (
    <section className="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle size={16} className="text-sev-critical" /> {L.activeAlerts}
        <span className="ml-1 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{active.length}</span>
      </div>
      {st.alerts.length === 0
        ? <p className="mt-3 text-sm text-emerald-400">{L.noAlerts}</p>
        : (
          <div className="mt-3 space-y-3">
            {active.map((a) => (
              <AlertCard key={a.id} store={store} st={st} alert={a} L={L}
                onAckOpen={setAckAlert} onSnoozeOpen={setSnoozeAlert} />
            ))}
            {acked.map((a) => (
              <AlertCard key={a.id} store={store} st={st} alert={a} L={L}
                onAckOpen={setAckAlert} onSnoozeOpen={setSnoozeAlert} />
            ))}
          </div>
        )}
      {ackAlert && <AckModal store={store} alert={ackAlert} L={L} onClose={() => setAckAlert(null)} />}
      {snoozeAlert && <SnoozeModal store={store} alert={snoozeAlert} L={L} onClose={() => setSnoozeAlert(null)} />}
    </section>
  );
}

function DoctorPanel({ store, st, L }) {
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
      <div className="space-y-4">
        <AdmissionForm store={store} st={st} L={L} />
        <FireAlertControl store={store} st={st} L={L} />
        <BreakGlassPanel store={store} st={st} L={L} />
      </div>
      <div className="space-y-4">
        <BedGrid st={st} L={L} />
        <AlertsColumn store={store} st={st} L={L} />
      </div>
    </div>
  );
}

function NursePanel({ store, st, L }) {
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
      <div className="space-y-4">
        <section className="rounded-xl bg-slate-900 p-4 text-sm text-slate-400 ring-1 ring-slate-800">
          {L.admissionOnlyDoctor}
        </section>
        <FireAlertControl store={store} st={st} L={L} />
        <BreakGlassPanel store={store} st={st} L={L} />
      </div>
      <div className="space-y-4">
        <BedGrid st={st} L={L} />
        <AlertsColumn store={store} st={st} L={L} />
      </div>
    </div>
  );
}

function AdminPanel({ store, st, L }) {
  const u = st.structure.unit;
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
      <div className="space-y-4">
        <section className="rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800">
          <div className="flex items-center gap-2 font-semibold"><Building2 size={16} className="text-amber-300" /> {L.panelAdmin}</div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-slate-400">{L.tenant}</dt><dd className="text-slate-100">{st.structure.tenant}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">{L.site}</dt><dd className="text-slate-100">{st.structure.site}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">{L.unit}</dt><dd className="text-slate-100">{u.name} ({u.type})</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">{L.maxNurse}</dt><dd className="text-slate-100">{u.maxBedsPerNurse}</dd></div>
          </dl>
        </section>
        <AdmissionForm store={store} st={st} L={L} />
      </div>
      <div className="space-y-4">
        <BedGrid st={st} L={L} />
        <AlertsColumn store={store} st={st} L={L} />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- root
export function ClinicalDemo() {
  const store = useDemoStore();
  const st = store.getState();
  const [lang, setLang] = useState(storedLang);
  const L = useStr(lang);
  useEffect(() => { persistLang(lang); }, [lang]);

  // Simulation clock: advance sim seconds by `speed` and reconcile escalation, ~4×/sec.
  useEffect(() => {
    if (!st.user) return undefined;
    const id = setInterval(() => {
      const s = store.getState();
      if (!s.running) return;
      store.reconcile(s.clockSec + s.speed * 0.25);
    }, 250);
    return () => clearInterval(id);
  }, [st.user, store]);

  if (!st.user) return <Login store={store} L={L} lang={lang} setLang={setLang} />;

  const Panel = st.user.role === ROLE.HOSPITAL_ADMIN ? AdminPanel
    : st.user.role === ROLE.CHARGE_NURSE ? NursePanel
    : DoctorPanel;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Header store={store} st={st} L={L} lang={lang} setLang={setLang} />
      <Panel store={store} st={st} L={L} />
    </div>
  );
}


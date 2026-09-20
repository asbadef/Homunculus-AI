// src/wallBoard.jsx — Duvar ekranı (merkezi izleme) modu.
//
// Hemşire bankosundaki büyük ekran, hasta başındaki tabletle aynı arayüz değildir. Orada kimse
// tıklamaz: ekran üç metre öteden okunur, gün boyu açık durur ve tek bir soruya cevap verir —
// **şu an hangi yatağa bakmam gerekiyor?**
//
// Bu yüzden bu mod kabuğu tamamen kaldırır: sol menü, üst bar, banner'lar yok. Ekranın tamamı
// yataklardır. Vital renkleri hastane monitörlerinin kendi geleneğini izler (nabız yeşil, SpO₂
// camgöbeği, kan basıncı beyaz, solunum sarı, ateş turuncu) — koğuşta yıllardır o renkleri okuyan
// bir hemşireye yeni bir renk dili öğretmenin hiçbir faydası yok.
//
// Üç kural:
//   1. **Ölçülmeyen değer boş kalır.** Tire gösterilir, sıfır değil.
//   2. **Alarm yatağı öne çıkarır**, listeyi yeniden sıralamaz — bir hemşire yatakların ekrandaki
//      yerini ezberler; sıra değişirse her alarmda yeniden arar.
//   3. **Skoru motor verir.** Motor göndermiyorsa skor alanı boştur (bkz. News2Pill).

import React, { useEffect, useMemo, useState } from "react";
import { X, AlertTriangle, Radio, WifiOff } from "lucide-react";
import { maskName, computeNews2 } from "./clinicalDemo.js";
import { Waveform } from "./clinicalUi.jsx";

// Monitör geleneğindeki kanal renkleri — sınıf adları değil, doğrudan renk değerleri, çünkü
// bu ekran temadan bağımsız olarak siyahtır.
const CH = {
  hr:   "#22c55e",
  spo2: "#22d3ee",
  map:  "#e2e8f0",
  rr:   "#facc15",
  temp: "#fb923c",
};

function VitalNumber({ code, value, unit, big = false }) {
  const color = CH[code] || "#e2e8f0";
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono font-bold leading-none tabular-nums"
        style={{ color, fontSize: big ? "2.6rem" : "1.9rem" }}>
        {value == null ? "—" : value}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color, opacity: 0.7 }}>
        {unit}
      </span>
    </div>
  );
}

/**
 * Bir yatak hücresi. Boş yatak da çizilir ve yerini korur: duvar ekranında "boş" da bir bilgidir
 * ve yatakların ekrandaki yeri sabit kalmalıdır.
 */
function WallCell({ bed, patient, alert, device, maskNames, elapsed, simulation = false }) {
  if (!patient) {
    return (
      <div className="flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-950/60 p-3">
        <span className="font-mono text-2xl font-bold text-neutral-700">{bed.label}</span>
        <span className="text-xs uppercase tracking-widest text-neutral-700">boş</span>
      </div>
    );
  }
  const name = maskNames ? maskName(patient.display_name || "") : patient.display_name;
  const v = patient.vitals || {};
  const critical = Boolean(alert);
  // Skoru motor verir. Motor yoksa (simülasyon) yerel hesap görünür ve eksik vital varsa
  // yıldızla kısmi işaretlenir; canlıda motor susuyorsa skor alanı boş kalır — ekran
  // kendi hesabını koğuşa okutmaz (bkz. ClinicalDemo.jsx · News2Pill).
  const fromEngine = patient.news2 && typeof patient.news2.total === "number" ? patient.news2 : null;
  const localPartial = ["hr", "map", "spo2", "temp", "rr"].some((k) => v[k] == null);
  const news2 = fromEngine
    || (simulation ? { total: computeNews2(v), partial: localPartial } : null);
  return (
    <div className={`relative flex flex-col gap-2 rounded-xl border p-3 transition ${
      critical ? "border-red-500 bg-red-950/30" : "border-neutral-800 bg-neutral-950/60"}`}>
      {critical && <span className="pointer-events-none absolute inset-0 animate-pulse rounded-xl ring-2 ring-red-500/60" aria-hidden="true" />}

      <div className="flex items-baseline gap-2.5">
        <span className={`font-mono text-2xl font-bold leading-none ${critical ? "text-red-400" : "text-cyan-300"}`}>
          {bed.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-neutral-200">
          {name || "—"}
        </span>
        {news2 && (
          <span className={`shrink-0 font-mono text-xl font-bold leading-none ${
            news2.total >= 7 ? "text-red-400" : news2.total >= 5 ? "text-amber-400" : "text-emerald-400"}`}>
            {news2.total}{news2.partial && <span className="text-xs">*</span>}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <VitalNumber code="hr" value={v.hr} unit="bpm" big />
        <VitalNumber code="spo2" value={v.spo2} unit="SpO₂" big />
        <VitalNumber code="map" value={v.map} unit="mmHg" />
        <VitalNumber code="rr" value={v.rr} unit="/dk" />
        <VitalNumber code="temp" value={v.temp} unit="°C" />
      </div>

      {device ? (
        <div className="flex items-center gap-2">
          <Radio size={12} className="shrink-0 text-emerald-500" />
          <div className="min-w-0 flex-1"><Waveform hr={v.hr || 80} height={26} /></div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-neutral-600">
          <WifiOff size={12} /> cihaz bağlı değil
        </div>
      )}

      {critical && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/15 px-2 py-1.5">
          <AlertTriangle size={13} className="shrink-0 text-red-400" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-red-300">{alert.summary}</span>
          <span className="shrink-0 font-mono text-xs text-red-300">{elapsed}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Duvar ekranı.
 *
 * `units` boşsa tüm koğuş tek ızgarada; birden çok ünite varsa ve `cycleSeconds` verilmişse
 * üniteler sırayla gösterilir — banko ekranı tek bir üniteye ait olmayabilir.
 */
export function WallBoard({ S, state, onExit, cycleSeconds = 0, simulation = false }) {
  const units = state.structure?.units || [];
  const [unitIx, setUnitIx] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!cycleSeconds || units.length < 2) return undefined;
    const t = setInterval(() => setUnitIx((i) => (i + 1) % units.length), cycleSeconds * 1000);
    return () => clearInterval(t);
  }, [cycleSeconds, units.length]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onExit(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const unit = units.length > 1 && cycleSeconds ? units[unitIx] : null;
  const beds = useMemo(
    () => (unit ? (state.beds || []).filter((b) => b.unitId === unit.id) : (state.beds || [])),
    [state.beds, unit],
  );
  const patientOf = (id) => (state.patients || []).find((p) => p.patient_id === id);
  const openAlerts = (state.alerts || []).filter((a) => a.status === "FIRED");
  const occupied = beds.filter((b) => b.state === "OCCUPIED").length;

  // Izgara: yatak sayısına göre sütun. 16 yatakta 4×4, 8 yatakta 4×2 — hücre ne kadar büyükse
  // o kadar uzaktan okunur, o yüzden sütun sayısı gereğinden fazla artırılmıyor.
  const cols = beds.length <= 4 ? 2 : beds.length <= 9 ? 3 : beds.length <= 16 ? 4 : 5;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black text-white">
      <div className="flex items-center gap-5 border-b border-neutral-800 px-5 py-2.5">
        <span className="text-lg font-bold tracking-tight">
          {unit ? unit.name : (S.allUnits || "Tüm üniteler")}
        </span>
        <span className="text-sm text-neutral-400">{state.structure?.tenant}</span>
        <span className="ml-auto flex items-center gap-5">
          <span className="text-sm text-neutral-300">
            {S.occupancy}: <b className="text-white">{occupied}</b> / {beds.length}
          </span>
          <span className={`rounded-lg px-3 py-1 text-sm font-bold ${
            openAlerts.length ? "bg-red-500/20 text-red-300" : "bg-neutral-900 text-neutral-400"}`}>
            {openAlerts.length} {S.top?.openAlarms || "açık alarm"}
          </span>
          <span className="font-mono text-2xl font-bold tabular-nums">
            {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
          </span>
          <button onClick={onExit} aria-label={S.close || "Kapat"}
            className="grid h-9 w-9 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-900 hover:text-white">
            <X size={18} />
          </button>
        </span>
      </div>

      <div className="grid flex-1 gap-3 overflow-y-auto p-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}>
        {beds.map((bed) => {
          const p = bed.patientId ? patientOf(bed.patientId) : null;
          const alert = p ? openAlerts.find((a) => a.patientId === p.patient_id) : null;
          const device = p ? (state.devices || []).find((d) => d.bedId === bed.id && d.connected) : null;
          const secs = alert ? Math.max(0, state.clockSec - alert.firedAtSec) : 0;
          const elapsed = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
          return (
            <WallCell key={bed.id} bed={bed} patient={p} alert={alert} device={device}
              maskNames={state.maskNames} elapsed={elapsed} simulation={simulation} />
          );
        })}
      </div>

      <div className="border-t border-neutral-800 px-5 py-1.5 text-[11px] text-neutral-600">
        {S.pr14?.wallHint || "Çıkmak için Esc"}
      </div>
    </div>
  );
}

export default WallBoard;

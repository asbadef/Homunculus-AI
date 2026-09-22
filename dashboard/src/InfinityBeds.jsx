/**
 * Infinity research beds — every monitored bed's decoded parameter records, as the device
 * sends them: value, unit, the device's own alarm limits, and its own validity flag.
 *
 * These are candidate values from research decoding of monitor traffic, not observations.
 * The panel lives on the device page for the roles responsible for devices; nothing here is
 * written to the clinical record, and the wording keeps saying so.
 *
 * Six situations look different on purpose, because each sends an engineer somewhere else:
 * not configured, no permission, API failure, hub unreachable/stale, a bed in standby that
 * transmits but carries no parameters, and a parameter the device itself flags as invalid.
 */
import React, { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { SectionHeader, Empty } from "./clinicalUi.jsx";

export const POLL_MS = 2000;

const LABEL = {
  hr: "HR", pls: "PLS", spo2: "SpO₂", etco2: "etCO₂", temperature: "Ta",
  art_systolic: "ART sis", art_diastolic: "ART dia", art_mean: "ART ort",
  nbp_systolic: "NBP sis", nbp_diastolic: "NBP dia", nbp_mean: "NBP ort",
  respiration: "RESP", respiration_airway: "RESP (hava yolu)",
};
const ORDER = ["hr", "pls", "spo2", "respiration", "respiration_airway", "etco2",
               "art_systolic", "art_diastolic", "art_mean",
               "nbp_systolic", "nbp_diastolic", "nbp_mean", "temperature"];

const DEVICE_STATUS = {
  streaming: ["yayında", "text-emerald-500 ring-emerald-500/40"],
  no_parameters: ["yayında, parametre yok (standby?)", "text-amber-500 ring-amber-500/50"],
  stale: ["veri kesildi", "text-red-500 ring-red-500/50"],
  waiting: ["paket bekleniyor", "ring-current/20"],
  unsupported: ["desteklenmeyen paket", "text-red-500 ring-red-500/50"],
};

/** Which banner, if any, replaces the bed list. `null` means show the beds. */
export function classify(error, state) {
  if (error) {
    const reason = error.reason;
    if (reason === "not_configured") return { kind: "not_configured", text: "Araştırma hub'ı bu kurulumda yapılandırılmamış." };
    if (error.status === 403) return { kind: "forbidden", text: "Bu sayfa cihazlardan sorumlu rollere açık." };
    if (error.status === 401) return { kind: "unauthorized", text: "Oturum doğrulanamadı." };
    if (reason === "upstream_unreachable" || reason === "upstream_timeout") return { kind: "hub_down", text: "Araştırma hub'ına ulaşılamıyor." };
    if (reason === "research_disabled") return { kind: "hub_down", text: "Hub'da araştırma çözümlemesi kapalı." };
    return { kind: "api_error", text: "Araştırma verisi alınamadı." };
  }
  if (!state) return { kind: "loading", text: "Yükleniyor…" };
  if (!state.devices?.length) return { kind: "empty", text: "Envanterde cihaz yok." };
  return null;
}

/** A trend line from the hub's history — what was valid over the last minutes, nothing more. */
export function Sparkline({ points, width = 120, height = 28 }) {
  if (!points || points.length < 2) return null;
  const values = points.map((p) => p[1]);
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = width / (points.length - 1);
  const d = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - lo) / span) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="trend" className="shrink-0">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function Parameter({ T, name, entry }) {
  const invalid = entry.status === "device_reports_invalid";
  const stale = entry.status === "stale";
  const shown = entry.value === null || entry.value === undefined ? "—" : entry.value;
  const tone = invalid ? "text-amber-500" : stale ? T.faint : T.heading;
  const note = invalid ? "cihaz: geçersiz" : stale ? `bayat · ${Math.round(entry.age_ms / 1000)} sn` : null;
  return (
    <div className={`rounded-xl border ${T.border} p-2.5`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-[11px] font-semibold ${T.muted}`}>{LABEL[name] || name}</span>
        <span className={`text-[10px] ${T.faint}`}>{entry.unit}</span>
      </div>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <span className={`text-2xl font-black tabular-nums ${tone}`}>{shown}</span>
        <span className={T.faint}><Sparkline points={entry.history} /></span>
      </div>
      <div className={`mt-1 flex flex-wrap gap-x-2 text-[10px] ${T.faint}`}>
        <span>alarm {entry.alarm_low}–{entry.alarm_high}</span>
        {note && <span>{note}</span>}
        {entry.evidence === "unverified_layout" && <span className="text-amber-500">doğrulanmadı</span>}
      </div>
    </div>
  );
}

function Bed({ T, device }) {
  const [label, pill] = DEVICE_STATUS[device.status] || [device.status, "ring-current/20"];
  const names = ORDER.filter((n) => device.parameters[n]);
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-4`} data-testid={`bed-${device.source_ip}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className={`font-semibold ${T.heading}`}>{device.device_id}</div>
          <div className={`text-[11px] ${T.faint}`}>{device.source_ip} · {device.packets} paket</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${pill}`}>{label}</span>
      </div>
      {names.length === 0
        ? <div className={`text-xs ${T.muted}`}>Bu cihazdan parametre kaydı gelmiyor.</div>
        : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {names.map((n) => <Parameter key={n} T={T} name={n} entry={device.parameters[n]} />)}
          </div>}
    </div>
  );
}

export function InfinityBeds({ T, store, pollMs = POLL_MS }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const supported = typeof store?.researchState === "function";

  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    async function tick() {
      try {
        const next = await store.researchState();
        if (!cancelled) { setState(next); setError(null); }
      } catch (err) {
        // The old numbers must not stay on screen through an outage: a stuck request and a
        // quiet ward look identical unless the page says which one it is.
        if (!cancelled) { setState(null); setError(err?.detail ?? { status: err?.status, reason: err?.reason }); }
      }
      if (!cancelled) timer.current = setTimeout(tick, pollMs);
    }
    tick();
    return () => { cancelled = true; clearTimeout(timer.current); };
  }, [store, supported, pollMs]);

  if (!supported) return null;
  const banner = classify(error, state);

  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <SectionHeader T={T} icon={Radio} title="Infinity araştırma akışı"
                     hint="Monitörlerin gönderdiği parametre kayıtları, cihazın kendi geçerlilik bayrağı ve alarm sınırlarıyla. Aday değerler — klinik kayıt değil." />
      {banner
        ? <Empty T={T} text={banner.text} />
        : <div className="space-y-3">
            <div className={`text-[11px] ${T.faint}`}>
              kabul {state.accepted_packets} · ret {state.rejected_packets} · eski/tekrar {state.old_or_duplicate_packets}
              {" · "}tazelik eşiği {Math.round(state.stale_after_ms / 1000)} sn · trend {Math.round((state.history_seconds || 0) / 60)} dk
            </div>
            {state.devices.map((d) => <Bed key={d.device_id} T={T} device={d} />)}
          </div>}
    </div>
  );
}

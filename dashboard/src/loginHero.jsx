// src/loginHero.jsx — giriş ekranının sol paneli.
//
// Burada üç madde halinde "erken uyarı motoru", "kademeli eskalasyon", "cihaz bağımsız
// entegrasyon" yazıyordu. Doğru cümlelerdi ve hiçbir şey göstermiyorlardı: ürünün tek iddiası
// **bir şeyi erken görmek**, ve bunu anlatmanın en zayıf yolu onu yazmaktır.
//
// Bu sahne onu çiziyor. Altı saatlik bir seyir soldan sağa akıyor; hastanın skoru sessizce
// yükselirken sistem bir noktada "kriterler karşılanıyor" diyor, klasik eşik ise çok sonra
// aşılıyor. Aradaki mesafe ürünün kendisidir.
//
// Üç kural bu dosyada da geçerli:
//   • **Sayı uydurulmaz.** Sahnede "%99,9" ya da "60 dakika önce" yazmıyor — eksende iki işaret
//     var, mesafeyi göz ölçüyor. Buraya bir rakam ancak ölçülmüş bir çalışmadan gelebilir.
//   • **Tanı yok.** Sahnedeki etiket "sepsis" demiyor, "kriterler karşılanıyor" diyor.
//   • **Hareket kapatılabilir.** `prefers-reduced-motion` açıksa sahne son karesinde durur;
//     vestibüler rahatsızlığı olan bir kullanıcıyı ürünün giriş ekranı zorlamaz.

import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, TrendingUp, Siren, Network } from "lucide-react";

const W = 520;
const H = 172;

/**
 * Skor eğrisi — sabit, çünkü sahne bir senaryo anlatıyor, ölçüm göstermiyor.
 *
 * Düz bir çizgi klinik olarak da yanlış olurdu: bir hastanın skoru sallanır, düzelir, yeniden
 * bozulur. Erken uyarının değeri tam da bu gürültünün içindeki **yönü** görmesi.
 */
const CURVE = [
  [0, 128], [35, 121], [70, 130], [105, 117], [140, 125], [175, 109],
  [210, 116], [245, 100], [280, 95], [315, 102], [350, 78], [385, 62],
  [420, 52], [455, 37], [490, 27], [520, 20],
];

const EARLY_X = 280;     // sistemin kriterleri gördüğü an
const EARLY_Y = 95;
const THRESHOLD_X = 455; // klasik eşiğin aşıldığı an
const THRESHOLD_Y = 37;

function pathFrom(points) {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return undefined;
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);
  return reduced;
}

/**
 * Kötüleşme sahnesi.
 *
 * `phase` 0→1 arası ilerler: eğri çizilir, erken uyarı işareti belirir, sonra klasik eşik.
 * Hareket kapalıysa doğrudan son kare gösterilir.
 */
export function DeteriorationScene({ S }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) { setPhase(1); return undefined; }
    let raf = 0;
    let start = null;
    const DUR = 7000;
    const HOLD = 2200;
    const tick = (t) => {
      if (start === null) start = t;
      const elapsed = (t - start) % (DUR + HOLD);
      setPhase(Math.min(1, elapsed / DUR));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const d = useMemo(() => pathFrom(CURVE), []);
  const drawn = phase * W;
  const earlyOn = drawn >= EARLY_X;
  const lateOn = drawn >= THRESHOLD_X;
  const P = S?.pr9 || {};

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-h-0 w-full flex-1" preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={P.sceneAria || "Hastanın skoru yükselirken sistemin erken uyarı verdiği, klasik eşiğin ise çok sonra aşıldığı örnek seyir"}>
        <defs>
          <linearGradient id="hom-curve" x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#22d3ee" stopOpacity="0.45" />
            <stop offset="0.55" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#fb7185" />
          </linearGradient>
          <linearGradient id="hom-fill" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#22d3ee" stopOpacity="0.18" />
            <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          <clipPath id="hom-clip">
            <rect x="0" y="0" width={drawn} height={H} />
          </clipPath>
        </defs>

        {/* zaman ekseni */}
        <line x1="0" y1={H - 12} x2={W} y2={H - 12} stroke="#ffffff" strokeOpacity="0.12" strokeWidth="1" />
        {[0, 130, 260, 390, 520].map((x, i) => (
          <line key={x} x1={x} y1={H - 16} x2={x} y2={H - 8} stroke="#ffffff" strokeOpacity={i === 4 ? 0.35 : 0.12} strokeWidth="1" />
        ))}
        <text x="2" y={H - 20} fill="#ffffff" fillOpacity="0.3" fontSize="9">−6 sa</text>
        <text x={W - 2} y={H - 20} fill="#ffffff" fillOpacity="0.45" fontSize="9" textAnchor="end">şimdi</text>

        <g clipPath="url(#hom-clip)">
          <path d={`${d} L${W},${H - 12} L0,${H - 12} Z`} fill="url(#hom-fill)" />
          <path d={d} fill="none" stroke="url(#hom-curve)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* erken uyarı: sistemin gördüğü an */}
        <g opacity={earlyOn ? 1 : 0} style={{ transition: "opacity .45s ease" }}>
          <line x1={EARLY_X} y1="18" x2={EARLY_X} y2={H - 12} stroke="#5eead4" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="3 4" />
          <circle cx={EARLY_X} cy={EARLY_Y} r="6" fill="#0b1220" stroke="#5eead4" strokeWidth="2.5" />
          {!reduced && earlyOn && (
            <circle cx={EARLY_X} cy={EARLY_Y} r="6" fill="none" stroke="#5eead4" strokeWidth="2">
              <animate attributeName="r" values="6;16" dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0" dur="1.8s" repeatCount="indefinite" />
            </circle>
          )}
        </g>

        {/* klasik eşik: monitörün öttüğü an */}
        <g opacity={lateOn ? 1 : 0} style={{ transition: "opacity .45s ease" }}>
          <line x1={THRESHOLD_X} y1="18" x2={THRESHOLD_X} y2={H - 12} stroke="#fb7185" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="3 4" />
          <circle cx={THRESHOLD_X} cy={THRESHOLD_Y} r="5" fill="#fb7185" />
        </g>

        {/* iki an arasındaki mesafe — sayı değil, mesafe */}
        <g opacity={lateOn ? 1 : 0} style={{ transition: "opacity .45s ease" }}>
          <line x1={EARLY_X + 8} y1="14" x2={THRESHOLD_X - 8} y2="14" stroke="#5eead4" strokeOpacity="0.55" strokeWidth="1" />
          <path d={`M${EARLY_X + 8},14 l6,-3.5 v7 z`} fill="#5eead4" fillOpacity="0.8" />
          <path d={`M${THRESHOLD_X - 8},14 l-6,-3.5 v7 z`} fill="#5eead4" fillOpacity="0.8" />
        </g>
      </svg>

      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-teal-300">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />
          {P.sceneEarly || "Homunculus: kriterler karşılanıyor"}
        </span>
        <span className={`inline-flex items-center gap-1.5 text-rose-300 transition-opacity duration-500 ${lateOn ? "opacity-100" : "opacity-0"}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
          {P.sceneLate || "Klasik eşik aşıldı"}
        </span>
      </div>
    </div>
  );
}

/** Giriş ekranının sol paneli. */
export function LoginHero({ S }) {
  const P = S.pr9 || {};
  const props = P.props || [];
  const icons = [TrendingUp, Siren, Network];
  return (
    <>
      {/* Panel dikeyde esner: metinler sabit kalır, sahne kalan alanı alır. Sabit yükseklikli
          bir sahne 900 px'lik bir dizüstünde kaydırma çubuğu çıkarıyordu — giriş ekranında
          kaydırma çubuğu, "aşağıda bir şey var" demektir ve orada bir şey yok. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-4">
        <div>
          <h2 className="mb-2.5 text-3xl font-black leading-tight xl:text-[2.5rem]">{P.brandHeadline}</h2>
          <p className="max-w-md text-sm leading-relaxed text-white/70">{P.brandSub}</p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 backdrop-blur">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-400" />
            </span>
            {P.sceneTitle || "Örnek seyir · son 6 saat"}
          </div>
          <DeteriorationScene S={S} />
        </div>

        <ul className="grid gap-3 sm:grid-cols-3">
          {props.map(([title, desc], i) => {
            const Icon = icons[i] || TrendingUp;
            return (
              <li key={title} className="flex flex-col gap-1.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icon size={15} className="text-cyan-300" />
                </span>
                <span className="text-[12.5px] font-bold leading-tight">{title}</span>
                <span className="text-[11px] leading-snug text-white/55">{desc}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="relative z-10 space-y-3">
        <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 backdrop-blur">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-cyan-300/80">
            {P.promiseTitle}
          </div>
          <ul className="space-y-2 text-xs leading-relaxed text-white/70">
            <li className="flex gap-2"><span className="text-cyan-300">·</span>{P.promiseNoDiagnosis}</li>
            <li className="flex gap-2"><span className="text-cyan-300">·</span>{P.promiseNoOrders}</li>
            <li className="flex gap-2"><span className="text-cyan-300">·</span>{P.promiseOnPrem}</li>
          </ul>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-medium text-white/50">
          <ShieldCheck size={13} className="text-emerald-400" /> {S.pr8.loginBrandLine}
        </div>
      </div>
    </>
  );
}

export default LoginHero;

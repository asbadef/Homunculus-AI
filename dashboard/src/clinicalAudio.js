// src/clinicalAudio.js — IEC 60601-1-8 uyumlu medikal alarm ses motoru (WebAudio API).
// Gerçek bir ses dosyası yok: tüm sinyaller tarayıcıda sentezlenir. IEC 60601-1-8, alarm
// önceliğine göre "burst" (patlama) yapısını tanımlar:
//   • Yüksek öncelik (KRİTİK): 10 puls / burst (5 + 5), hızlı ritim, ~2.5 s'de bir tekrar.
//   • Orta öncelik (HIGH/MEDIUM): 3 puls / burst, daha yavaş, ~15 s'de bir tekrar.
// Sesli sinyal mute/onay durumuna saygı gösterecek şekilde üst katman (React) tarafından yönetilir.

let ctx = null;              // paylaşılan AudioContext (kullanıcı etkileşiminden sonra oluşturulur)
let masterGain = null;
let currentTier = null;      // şu an çalan öncelik ("CRITICAL" | "HIGH" | "MEDIUM" | null)
let burstTimer = null;       // burst tekrarını planlayan setTimeout
let enabled = false;         // kullanıcı sesi etkinleştirdi mi (autoplay politikaları)

// IEC 60601-1-8 öncelik profilleri. freq = temel ton (Hz), pulses = burst içindeki puls sayısı,
// pulseMs = tek puls süresi, gapMs = puls arası boşluk, repeatMs = burst tekrar aralığı.
const PROFILES = {
  CRITICAL: { freq: 960, pulses: 10, pulseMs: 150, gapMs: 100, repeatMs: 2500, vol: 0.5, groupGapMs: 350, groupAfter: 5 },
  HIGH:     { freq: 640, pulses: 3,  pulseMs: 180, gapMs: 150, repeatMs: 12000, vol: 0.4, groupGapMs: 0, groupAfter: 0 },
  MEDIUM:   { freq: 500, pulses: 3,  pulseMs: 200, gapMs: 220, repeatMs: 20000, vol: 0.3, groupGapMs: 0, groupAfter: 0 },
};

function ensureCtx() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

// Kullanıcı etkileşiminden sonra bir kez çağrılır (autoplay kısıtlamasını aşmak için).
export function enableAudio() {
  const c = ensureCtx();
  if (!c) return false;
  if (c.state === "suspended") c.resume();
  enabled = true;
  return true;
}

export function isAudioEnabled() { return enabled; }

// Tek bir "puls" (kısa ton) zamanlar. IEC tarzı: hızlı attack + kısa hold + decay.
function schedulePulse(startT, freq, durMs, vol) {
  const c = ctx;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  const dur = durMs / 1000;
  const t = startT;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.setValueAtTime(vol, t + dur - 0.03);
  g.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Bir burst (patlama) planlar: profile göre puls dizisi. groupAfter > 0 ise IEC'nin 5+5 kümesi.
function playBurst(tier) {
  const c = ensureCtx();
  if (!c || !enabled) return;
  const p = PROFILES[tier];
  if (!p) return;
  let t = c.currentTime + 0.02;
  for (let i = 0; i < p.pulses; i++) {
    schedulePulse(t, p.freq, p.pulseMs, p.vol);
    t += (p.pulseMs + p.gapMs) / 1000;
    // Yüksek öncelikte 5 pulsten sonra kısa bir küme boşluğu (5+5 deseni).
    if (p.groupAfter && (i + 1) === p.groupAfter) t += p.groupGapMs / 1000;
  }
}

// Verilen öncelik için ritmik alarmı başlatır (zaten aynı öncelik çalıyorsa yeniden başlatmaz).
export function startAlarm(tier) {
  if (!PROFILES[tier]) return;
  const c = ensureCtx();
  if (!c || !enabled) return;
  if (currentTier === tier && burstTimer) return; // zaten çalıyor
  stopAlarm();
  currentTier = tier;
  const p = PROFILES[tier];
  playBurst(tier);
  const loop = () => {
    if (currentTier !== tier) return;
    playBurst(tier);
    burstTimer = setTimeout(loop, p.repeatMs);
  };
  burstTimer = setTimeout(loop, p.repeatMs);
}

// Çalan alarmı durdurur.
export function stopAlarm() {
  if (burstTimer) { clearTimeout(burstTimer); burstTimer = null; }
  currentTier = null;
}

// En yüksek önceliğe göre alarmı senkronlar. tier=null ise susturur. Üst katman açık/mute olmayan
// en kritik alarmın öncelik seviyesini geçirir.
export function syncAlarm(tier) {
  if (!tier) { stopAlarm(); return; }
  if (tier !== currentTier) startAlarm(tier);
}

export function currentAlarmTier() { return currentTier; }

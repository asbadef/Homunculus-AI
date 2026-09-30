/* Homunculus prototip · duvar monitörü + monitör sesi (24.09, 3. oturum · Ozan #59, #60).
 *
 * Üç parça:
 *   1. H.sound  — nabız bipi (her R dalgasında, perdesi SpO₂ ile iner) ve alarm tonları (öncelik başına ayrı desen).
 *   2. Tek hasta "duvar görünümü" — hasta ekranındaki monitörün ⤢ düğmesi; ekranı kaplayan siyah yatak başı monitörü.
 *   3. "Duvar monitörü" sayfası — hemşire istasyonundaki TV gibi: kapsamdaki bütün yataklar, yalnız siyah monitör bilgisi.
 *
 * Dürüstlük notları (ekranda da yazıyor):
 *   - Dalgalar TEMSİLİ: gerçek EKG/pleth paketleri henüz çözülmedi. Bip de bu temsilî dalgaya bağlı.
 *   - Tarayıcı sesi yardımcıdır, tıbbi alarm değildir: asıl alarm yatak başı monitördedir. Sekme kapalıysa, bilgisayar
 *     sessizdeyse ya da tarayıcı sesi engellediyse hiçbir şey duyulmaz.
 *   - Tarayıcılar ilk tıklamadan önce ses çalmaya izin vermez; ses bu yüzden kapalı başlar ve bir düğmeyle açılır.
 */
(function () {
  const H = window.H, esc = H.esc;
  const svg = (d, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    on:'<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    off:'<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/>',
    full:'<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    x:'<path d="M18 6 6 18M6 6l12 12"/>', bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
    open:'<path d="M7 17 17 7M8 7h9v9"/>', heart:'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
  };

  H.addT({
    m_wall:      { AZ:"Divar monitoru", TR:"Duvar monitörü", RU:"Центральный монитор", EN:"Wall monitor" },
    mw_sub:      { AZ:"Tibb bacısı postundakı ekran kimi: bütün çarpayılar, yalnız monitor məlumatı", TR:"Hemşire istasyonundaki ekran gibi: bütün yataklar, yalnız monitör bilgisi", RU:"Как экран на посту: все койки, только данные монитора", EN:"Like the nurse-station screen: every bed, monitor data only" },
    mw_all:      { AZ:"Hamısı", TR:"Tümü", RU:"Все", EN:"All" },
    mw_sound:    { AZ:"Səs", TR:"Ses", RU:"Звук", EN:"Sound" },
    mw_snd_on:   { AZ:"Səs açıq", TR:"Ses açık", RU:"Звук вкл.", EN:"Sound on" },
    mw_snd_off:  { AZ:"Səs bağlı", TR:"Ses kapalı", RU:"Звук выкл.", EN:"Sound off" },
    mw_pause:    { AZ:"Həyəcanı 2 dəq susdur", TR:"Alarm sesini 2 dk sustur", RU:"Пауза тревоги 2 мин", EN:"Pause alarm audio 2 min" },
    mw_paused:   { AZ:"Həyəcan səsi susdurulub", TR:"Alarm sesi susturuldu", RU:"Звук тревоги на паузе", EN:"Alarm audio paused" },
    mw_pulse:    { AZ:"Nəbz səsi", TR:"Nabız bipi", RU:"Пульсовой тон", EN:"Pulse tone" },
    mw_alarm:    { AZ:"Həyəcan səsi", TR:"Alarm sesi", RU:"Звук тревоги", EN:"Alarm tones" },
    mw_full:     { AZ:"Tam ekran", TR:"Tam ekran", RU:"Во весь экран", EN:"Full screen" },
    mw_wallview: { AZ:"Divar görünüşü", TR:"Duvar görünümü", RU:"Крупный вид", EN:"Wall view" },
    mw_close:    { AZ:"Bağla (Esc)", TR:"Kapat (Esc)", RU:"Закрыть (Esc)", EN:"Close (Esc)" },
    mw_open:     { AZ:"Xəstəni aç", TR:"Hastayı aç", RU:"Открыть пациента", EN:"Open patient" },
    mw_empty:    { AZ:"Boş çarpayı", TR:"Boş yatak", RU:"Свободная койка", EN:"Empty bed" },
    mw_nomon:    { AZ:"Monitor bağlı deyil · son əl ilə ölçmə", TR:"Monitör bağlı değil · son elle ölçüm", RU:"Монитор не подключён · последнее ручное измерение", EN:"No monitor · last manual reading" },
    mw_note:     { AZ:"Dalğa xətti ölçmə deyil. Bu ekranın səsi köməkçidir, tibbi həyəcan deyil: əsas həyəcan çarpayı başındakı monitordadır.",
                   TR:"Dalga çizgisi ölçüm değildir. Bu ekranın sesi yardımcıdır, tıbbi alarm değildir: asıl alarm yatak başı monitördedir.",
                   RU:"Линия кривой не является измерением. Звук этого экрана вспомогательный и не является медицинской тревогой: основная тревога — на прикроватном мониторе.",
                   EN:"The waveform line is not a measurement. Sound here is an aid, not a medical alarm: the primary alarm is the bedside monitor." },
    mw_first:    { AZ:"Səsi açmaq üçün bir dəfə klikləyin (brauzer qaydası)", TR:"Sesi açmak için bir kez tıklayın (tarayıcı kuralı)", RU:"Нажмите один раз, чтобы включить звук (правило браузера)", EN:"Click once to enable sound (browser rule)" },
    mw_crit:     { AZ:"kritik", TR:"kritik", RU:"критич.", EN:"critical" },
    mw_high:     { AZ:"yüksək", TR:"yüksek", RU:"высокий", EN:"high" },
    mw_beds:     { AZ:"çarpayı", TR:"yatak", RU:"коек", EN:"beds" },
    mw_sel:      { AZ:"Nəbz səsi bu çarpayıdan gəlir", TR:"Nabız bipi bu yataktan", RU:"Пульсовой тон с этой койки", EN:"Pulse tone from this bed" },
  });

  /* ================= 1. ses ================= */
  const pref = (k, d) => { try { const v = localStorage.getItem("hmc.snd." + k); return v == null ? d : v === "1"; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem("hmc.snd." + k, v ? "1" : "0"); } catch {} };
  // "on" kaydedilmez: her açılışta kapalı başlar (tarayıcı zaten ilk tıklamadan önce çalmaz; kapalı görünüp çalıyormuş gibi durmasın).
  const SND = { on:false, pulse:pref("pulse", true), alarms:pref("alarms", true), pausedUntil:0, vol:.6 };
  let ac = null;
  const actx = () => { if (!ac) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
      // iPhone: web sesi sessiz düğmesine uyar; "playback" oturumu alarm sesini sessiz modda da çalar (iOS 17+)
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
      ac = new C(); }
    // iPhone bağlamı "interrupted" durumuna da düşer (sayfa değişimi, bildirim, kilit) → çalışmıyorsa her seferinde uyandır
    if (ac.state !== "running") { try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {} ac.resume().catch(() => {}); }
    return ac; };
  /* 25.09 · Ozan: "ses çıkmıyor". Sebep: ses her açılışta KAPALI başlıyordu ve telefonda açma düğmesi yoktu.
   * Şimdi: tarayıcı ilk dokunuştan önce ses çalmaya izin vermez → ilk dokunuşta ses motoru açılır (sessiz bir tampon
   * çalınarak kilit kalkar) ve kişi bilerek kapatmadıysa (hmc.snd.master) alarm sesi açık olur. */
  let unlocked = false;
  function unlock() {
    if (unlocked) return; const a = actx(); if (!a) return; unlocked = true;
    try { const b = a.createBuffer(1, 1, 22050), src = a.createBufferSource(); src.buffer = b; src.connect(a.destination); src.start(0); } catch (e) {}
    if (pref("master", true) && !SND.on) { SND.on = true; paint(); }
  }
  ["pointerdown", "touchend", "keydown"].forEach(ev => document.addEventListener(ev, () => { if (!unlocked) unlock(); else { if (ac && ac.state !== "running") actx(); if (!SND.on && H.state.user && pref("master", true) && !document.querySelector("#root .lock")) { SND.on = true; paint(); } } }, { capture:true, passive:true }));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ac) actx(); });
  function tone(freq, at, dur, vol, type = "sine") {
    const a = actx(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.setValueAtTime(vol, t + dur - .025); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + .03);
  }
  // Nabız oksimetresi geleneği: SpO₂ düştükçe bip kalınlaşır (her %1 ≈ yarım ton). %100 → 880 Hz, %86 → ~590 Hz.
  const pulseHz = (s) => 880 * Math.pow(2, (Math.max(60, Math.min(100, s)) - 100) / 24);
  // Alarm desenleri IEC 60601-1-8'in mantığıyla (yüksek öncelik 3+2 darbe, orta 3 darbe, düşük 2 darbe); perdeler temsilî.
  const PAT = {
    crit:{ every:6000, notes:[[988, 0], [988, .22], [988, .44], [988, .9], [988, 1.12]], dur:.16, type:"square", vol:.07 },
    high:{ every:14000, notes:[[660, 0], [784, .26], [880, .52]], dur:.2, type:"triangle", vol:.16 },
    mid: { every:30000, notes:[[523, 0], [659, .32]], dur:.24, type:"triangle", vol:.12 },
  };
  const last = { crit:0, high:0, mid:0 };
  function playPat(k) { const p = PAT[k]; p.notes.forEach(([f, at]) => tone(f, at, p.dur, p.vol * SND.vol, p.type)); }

  function focusScope() { return document.querySelector(".mon-full .mon") || document.querySelector(".wall .wt.sel .mon") || document.querySelector(".pt-wrap .mon"); }
  function beat(cv) {
    const mon = cv.closest(".mon"); if (mon) { mon.classList.add("hb"); setTimeout(() => mon.classList.remove("hb"), 140); }
    if (!SND.on || !SND.pulse || document.hidden) return;
    const f = focusScope(); if (!f || !f.contains(cv)) return;
    tone(pulseHz(+cv.dataset.s || 97), 0, .075, .2 * SND.vol);
  }
  function topAlarm() {
    if (!H.state.user || !H.can("alarms")) return null;
    const a = H.openAlarms(); return a.some(x => x.sev === "crit") ? "crit" : a.some(x => x.sev === "high") ? "high" : a.some(x => x.sev === "mid") ? "mid" : null;
  }
  setInterval(() => {
    paintPause();
    if (!SND.on || !SND.alarms || document.hidden || Date.now() < SND.pausedUntil) return;
    const k = topAlarm(); if (!k) return;
    const now = Date.now(); if (now - last[k] >= PAT[k].every) { last[k] = now; playPat(k); }
  }, 500);

  const pauseLeft = () => Math.max(0, Math.ceil((SND.pausedUntil - Date.now()) / 1000));
  function paintPause() {
    const s = pauseLeft();
    document.querySelectorAll("[data-snd-pause]").forEach(b => { b.classList.toggle("on", s > 0); const t = b.querySelector("i"); if (t) t.textContent = s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : ""; });
  }
  function paint() {
    document.querySelectorAll("[data-snd]").forEach(b => { b.classList.toggle("on", SND.on); b.title = H.t(SND.on ? "mw_snd_on" : "mw_snd_off"); const lab = b.dataset.snd === "lab";
      b.innerHTML = svg(SND.on ? IC.on : IC.off, lab ? 18 : 16) + (lab ? `<span>${H.t(SND.on ? "mw_snd_on" : "mw_snd_off")}</span>` : ""); });
    document.querySelectorAll("[data-snd-opt]").forEach(c => { c.checked = !!SND[c.dataset.sndOpt]; });
    paintPause();
  }
  H.sound = {
    beat, state:SND, unlock, test:(k) => { actx(); playPat(k || "crit"); },
    toolsHtml:(pid) => `<div class="mon-tools"><button type="button" class="mt-b${SND.on ? " on" : ""}" data-snd title="${H.t(SND.on ? "mw_snd_on" : "mw_snd_off")}">${svg(SND.on ? IC.on : IC.off, 16)}</button>
      <button type="button" class="mt-b" data-mon-full="${pid}" title="${H.t("mw_wallview")}">${svg(IC.full, 16)}</button></div>`,
    toggle() { SND.on = !SND.on; save("master", SND.on); if (SND.on) { actx(); tone(880, 0, .06, .15); } paint(); H.log(SND.on ? "Monitör sesi açıldı" : "Monitör sesi kapatıldı"); },
  };

  /* ================= 2. tek hasta · duvar görünümü ================= */
  function openFull(pid) {
    const p = H.pt(pid); if (!p || !H.inScope(p.id) || !H.monitor) return;
    closeFull();
    const b = H.bed(p.bed), u = H.unit(b.unitId), a = H.data.alarms.find(x => x.pid === p.id && x.state === "open");
    const d = document.createElement("div"); d.className = "mon-full"; d.dataset.theme = "gece";
    d.innerHTML = `<div class="mf-top"><b class="mono" style="color:${H.SEV[p.risk].c}">${esc(b.no)}</b>
        <span class="mf-nm">${H.showNames() ? esc(p.name) : ""} <small>${H.ageText(p)} · ${p.sex === "K" ? "♀" : "♂"} · ${esc(u.tr)}</small></span>
        ${a ? `<span class="mf-al s-${a.sev}">${esc(a.txt)}</span>` : ""}
        <span class="mf-clk mono">${H.nowFull()}</span>
        <button class="mf-b" data-snd="lab"></button>
        <button class="mf-b" data-snd-pause title="${H.t("mw_pause")}">${svg(IC.bell, 16)}<i class="mono"></i></button>
        <button class="mf-b" data-mf-close title="${H.t("mw_close")}">${svg(IC.x, 18)}</button></div>
      ${H.monitor.html(p)}
      <div class="mf-note">${H.t("mw_note")}</div>`;
    document.body.appendChild(d); H.monitor.wire(d); paint();
    H.log("Duvar görünümü açıldı", b.no);
  }
  function closeFull() { document.querySelectorAll(".mon-full").forEach(x => x.remove()); }

  /* ================= 3. duvar monitörü sayfası ================= */
  const W = { unit:"all" };
  const alarmOf = (pid) => H.data.alarms.filter(x => x.pid === pid && x.state === "open").sort((x, y) => "crit high mid low".indexOf(x.sev) - "crit high mid low".indexOf(y.sev))[0];
  function tile(u, b) {
    const p = H.data.patients.find(x => x.bed === b.id);
    if (!p) return `<div class="wt empty"><div class="wt-h"><b class="mono">${esc(b.no)}</b><span class="mute">${H.t("mw_empty")}</span></div></div>`;
    const a = alarmOf(p.id), sev = a ? a.sev : "";
    const head = `<div class="wt-h"><b class="mono" style="color:${H.SEV[p.risk].c}">${esc(b.no)}</b>
      <span class="wt-nm">${H.showNames() ? esc(p.name) : ""}<small>${H.ageText(p)} · ${p.sex === "K" ? "♀" : "♂"}</small></span>
      <button class="wt-o" data-wt-open="${p.id}" title="${H.t("mw_open")}">${svg(IC.open, 14)}</button>
      <button class="wt-o" data-mon-full="${p.id}" title="${H.t("mw_wallview")}">${svg(IC.full, 14)}</button></div>
      ${a ? `<div class="wt-al s-${a.sev}">${esc(a.txt)}</div>` : ""}`;
    const v = p.v;
    const body = p.monitored ? H.monitor.html(p) : `<div class="wt-man"><span class="mute">${H.t("mw_nomon")} · 21:00</span>
      <div><b style="color:var(--v-hr)">${v.hr}</b><b style="color:var(--v-map)">${v.sbp}/${v.dbp}</b><b style="color:var(--v-spo)">${v.spo2}</b><b style="color:var(--v-rr)">${v.rr}</b><b style="color:var(--v-t)">${v.temp.toFixed(1)}</b></div></div>`;
    return `<div class="wt ${sev ? "a-" + sev : ""} ${p.monitored ? "" : "man"}" data-wt="${p.id}">${head}${body}</div>`;
  }
  H.register("wall", { title:() => H.t("m_wall"), perm:"beds", render(root) {
    const units = H.state.user.units.map(H.unit).filter(u => u && u.live);
    if (W.unit !== "all" && !units.some(u => u.id === W.unit)) W.unit = "all";
    const shown = units.filter(u => W.unit === "all" || u.id === W.unit);
    const al = H.openAlarms(), nC = al.filter(a => a.sev === "crit").length, nH = al.filter(a => a.sev === "high").length;
    const nBeds = shown.reduce((s, u) => s + u.beds.length, 0);
    const occ = (b) => H.data.patients.some(x => x.bed === b.id), empties = shown.flatMap(u => u.beds.filter(b => !occ(b)));
    root.innerHTML = `<div class="wall" data-theme="gece">
      <div class="wl-top">
        <div class="wl-t"><b>${H.t("m_wall")}</b><small>${H.t("mw_sub")}</small></div>
        <div class="wl-u">${units.length > 1 ? `<span class="${W.unit === "all" ? "on" : ""}" data-wu="all">${H.t("mw_all")}</span>` : ""}${units.map(u => `<span class="${W.unit === u.id || units.length === 1 ? "on" : ""}" data-wu="${u.id}">${esc(u.tr)}</span>`).join("")}</div>
        <div class="wl-c"><span class="mono">${nBeds} ${H.t("mw_beds")}</span>${nC ? `<span class="s-crit">${nC} ${H.t("mw_crit")}</span>` : ""}${nH ? `<span class="s-high">${nH} ${H.t("mw_high")}</span>` : ""}</div>
        <div class="wl-ctl"><span class="mono wl-clk">${H.nowFull()}</span>
        <button class="mf-b" data-snd="lab"></button>
        <button class="mf-b" data-snd-pause title="${H.t("mw_pause")}">${svg(IC.bell, 16)}<i class="mono"></i></button>
        <details class="wl-opt"><summary class="mf-b">⋯</summary><div>
          <label><input type="checkbox" data-snd-opt="pulse"> ${H.t("mw_pulse")}</label>
          <label><input type="checkbox" data-snd-opt="alarms"> ${H.t("mw_alarm")}</label>
          <p>${H.t("mw_first")}</p></div></details>
        <button class="mf-b" data-wl-full title="${H.t("mw_full")}">${svg(IC.full, 16)}</button></div>
      </div>
      <div class="wl-g">${shown.map(u => u.beds.filter(b => occ(b)).map(b => tile(u, b)).join("")).join("")}</div>
      ${empties.length ? `<div class="wl-e"><span>${H.t("mw_empty")} · ${empties.length}</span>${empties.map(b => `<b class="mono">${esc(b.no)}</b>`).join("")}</div>` : ""}
      <div class="mf-note">${H.t("mw_note")}</div></div>`;
    H.monitor && H.monitor.wire(root); paint();
    root.onclick = (e) => {
      const wu = e.target.closest("[data-wu]"); if (wu) { W.unit = wu.dataset.wu; return H.go("wall"); }
      const op = e.target.closest("[data-wt-open]"); if (op) return H.go("patient", { pid:op.dataset.wtOpen, tab:"ozet" });
      if (e.target.closest("[data-wl-full]")) { const w = root.querySelector(".wall"); if (document.fullscreenElement) document.exitFullscreen(); else if (w.requestFullscreen) w.requestFullscreen().catch(() => {}); return; }
      if (e.target.closest("button, summary, label, input")) return;
      const t = e.target.closest("[data-wt]"); if (t) { const was = t.classList.contains("sel"); root.querySelectorAll(".wt.sel").forEach(x => x.classList.remove("sel")); if (!was) { t.classList.add("sel"); H.toast(H.t("mw_sel") + " · " + H.bed(H.pt(t.dataset.wt).bed).no); } }
    };
  } });

  /* ---------- ortak olaylar (hasta ekranı, duvar sayfası, tam ekran katmanı) ---------- */
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-snd]")) { e.preventDefault(); e.stopPropagation(); return H.sound.toggle(); }
    if (e.target.closest("[data-snd-pause]")) { e.preventDefault(); e.stopPropagation(); SND.pausedUntil = pauseLeft() ? 0 : Date.now() + 120000; if (SND.pausedUntil) H.log("Alarm sesi 2 dk susturuldu"); H.toast(H.t(SND.pausedUntil ? "mw_paused" : "mw_snd_on")); return paint(); }
    const f = e.target.closest("[data-mon-full]"); if (f) { e.preventDefault(); e.stopPropagation(); return openFull(f.dataset.monFull); }
    if (e.target.closest("[data-mf-close]")) return closeFull();
  }, true);
  document.addEventListener("change", (e) => { const c = e.target.closest("[data-snd-opt]"); if (c) { SND[c.dataset.sndOpt] = c.checked; save(c.dataset.sndOpt, c.checked); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.querySelector(".mon-full")) closeFull(); });
  // Çıkışta / kilitte katman ve ses kapanır: kilitli ekranın üstünde hasta monitörü açık kalmasın.
  setInterval(() => { if (!H.state.user || document.querySelector("#root .lock")) { closeFull(); if (SND.on) { SND.on = false; paint(); } } }, 400);
})();

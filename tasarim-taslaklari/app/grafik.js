/* Homunculus prototip · grafik.js — hekim için "Birim panosu" (unitdash).
 * 24.09.2026 · Ozan: "Doktorlar veriyi grafik ve şema olarak görmeyi sever."
 * Kapsamdaki hastaları beş grafikle gösterir: risk ısı haritası, MAP/SpO₂ küçük çoklu grafikleri,
 * skor eğilimi (eğim grafiği), alarm yükü, laktat eğilimi. Grafik kütüphanesi yok; hepsi inline SVG / CSS ızgara.
 * Tanı koymaz, emir vermez: metinler "gösterir, dikkat çeker" dilindedir.
 *
 * VERİ NOTU (yalnız kodda; ekranda yazılmaz — Ozan'ın kararı: ekran canlı ürün gibi durur):
 *   · Vital dizileri H.series'ten gelir (core.js, deterministik sentetik).
 *   · Skorların önceki günleri, geçmiş alarm yükü ve laktat dizisi BU DOSYADA hasta id'sinden türetilen
 *     deterministik sentetik değerlerdir. patient.js'teki laboratuvar verisine bağımlı değildir.
 *   · Operasyonel katmandaki birimler (tier "op": acil gözlem, kemoterapi vb.) klinik skor/öneri almadığı için panoya girmez. */
(function () {
  const H = window.H; if (!H) return;

  /* ================= metinler (4 dil) ================= */
  H.addT({
    m_unitdash:{ AZ:"Şöbə paneli", TR:"Birim panosu", RU:"Панель отделения", EN:"Unit board" },
    gd_pts:{ AZ:"xəstə", TR:"hasta", RU:"пац.", EN:"patients" },
    gd_all:{ AZ:"Hamısı", TR:"Tümü", RU:"Все", EN:"All" },
    gd_units:{ AZ:"şöbə", TR:"birim", RU:"отд.", EN:"units" },
    gd_k_crit:{ AZ:"Kritik", TR:"Kritik", RU:"Критический", EN:"Critical" },
    gd_k_crit_d:{ AZ:"risk səviyyəsi kritik olan xəstə", TR:"risk düzeyi kritik olan hasta", RU:"пациентов с критическим уровнем риска", EN:"patients at critical risk level" },
    gd_k_high:{ AZ:"Yüksək", TR:"Yüksek", RU:"Высокий", EN:"High" },
    gd_k_high_d:{ AZ:"risk səviyyəsi yüksək olan xəstə", TR:"risk düzeyi yüksek olan hasta", RU:"пациентов с высоким уровнем риска", EN:"patients at high risk level" },
    gd_k_worse:{ AZ:"Meyli pisləşən", TR:"Eğilimi kötüleşen", RU:"Ухудшение", EN:"Worsening" },
    gd_k_worse_d:{ AZ:"skoru dünənə görə artan xəstə", TR:"skoru dünden bugüne yükselen hasta", RU:"пациентов с баллом выше вчерашнего", EN:"patients whose score rose since yesterday" },
    gd_heat_t:{ AZ:"Risk istilik xəritəsi", TR:"Risk ısı haritası", RU:"Тепловая карта риска", EN:"Risk heat map" },
    gd_heat_d:{ AZ:"Son 24 saatin hər saatında həyəcan həddindən kənara çıxan vital göstəricilərin sayı. Sətrə toxunanda xəstənin trendləri açılır.",
      TR:"Son 24 saatin her saatinde alarm eşiğinin dışına çıkan vital sayısı. Satıra tıklayınca hastanın trendleri açılır.",
      RU:"Сколько показателей было за порогами тревоги в каждый из последних 24 часов. Нажмите на строку — откроются тренды пациента.",
      EN:"How many vitals were outside alarm limits in each of the last 24 hours. Click a row to open the patient's trends." },
    gd_lv0:{ AZ:"hədd daxilində", TR:"eşik içinde", RU:"в пределах", EN:"within limits" },
    gd_lv1:{ AZ:"1 vital", TR:"1 vital", RU:"1 показатель", EN:"1 vital" },
    gd_lv2:{ AZ:"2 vital", TR:"2 vital", RU:"2 показателя", EN:"2 vitals" },
    gd_lv3:{ AZ:"3+ vital", TR:"3+ vital", RU:"3+ показателя", EN:"3+ vitals" },
    gd_na:{ AZ:"Yaşa uyğun hədlər: xəstə ekranındakı skorda izlənilir", TR:"Yaşa özgü eşikler: hasta ekranındaki skorda izlenir", RU:"Возрастные пороги: отслеживаются в шкале на экране пациента", EN:"Age-specific limits: followed in the score on the patient screen" },
    gd_na_s:{ AZ:"yaşa uyğun hədlər", TR:"yaşa özgü eşikler", RU:"возрастные пороги", EN:"age-specific limits" },
    gd_tip_in:{ AZ:"Bütün vitallar hədd daxilində", TR:"Tüm vitaller eşik içinde", RU:"Все показатели в пределах", EN:"All vitals within limits" },
    gd_tip_out:{ AZ:"Hədd xaricində", TR:"Eşik dışında", RU:"За порогом", EN:"Outside limits" },
    gd_now:{ AZ:"indi", TR:"şimdi", RU:"сейчас", EN:"now" },
    gd_h24:{ AZ:"24 saat əvvəl", TR:"24 sa önce", RU:"24 ч назад", EN:"24 h ago" },
    gd_h48:{ AZ:"48 saat əvvəl", TR:"48 sa önce", RU:"48 ч назад", EN:"48 h ago" },
    gd_sm_t:{ AZ:"MAP və SpO₂ · son 24 saat", TR:"MAP ve SpO₂ · son 24 saat", RU:"САД ср. и SpO₂ · 24 часа", EN:"MAP and SpO₂ · last 24 h" },
    gd_sm_d:{ AZ:"Bütün kartlarda eyni şkala, xəstələri müqayisə etmək olar. Kölgəli sahə həyəcan həddinin xaricidir; böyük rəqəm son ölçmədir.",
      TR:"Bütün kartlarda aynı ölçek; hastalar yan yana karşılaştırılabilir. Gölgeli alan alarm eşiğinin dışı, büyük sayı son ölçüm.",
      RU:"Одинаковая шкала на всех карточках — пациентов можно сравнивать. Затенено — за порогом тревоги; крупная цифра — последнее измерение.",
      EN:"Same scale on every card, so patients compare side by side. Shaded area is outside the alarm limit; the large number is the latest reading." },
    gd_below:{ AZ:"həddən aşağı", TR:"eşik altı", RU:"ниже порога", EN:"below limit" },
    gd_above:{ AZ:"həddən yuxarı", TR:"eşik üstü", RU:"выше порога", EN:"above limit" },
    gd_sl_t:{ AZ:"Skor meyli · 3 gün", TR:"Skor eğilimi · 3 gün", RU:"Динамика баллов · 3 дня", EN:"Score trend · 3 days" },
    gd_sl_d:{ AZ:"Hər xəstənin skoru: iki gün əvvəl, dünən, bu gün. Dünəndən bu günə artan xətlər qırmızı ilə diqqəti çəkir.",
      TR:"Her hastanın skoru: iki gün önce, dün, bugün. Dünden bugüne yükselen çizgiler kırmızıyla dikkat çeker.",
      RU:"Балл каждого пациента: позавчера, вчера, сегодня. Линии, выросшие со вчерашнего дня, выделены красным.",
      EN:"Each patient's score two days ago, yesterday and today. Lines that rose since yesterday are drawn in red." },
    gd_d2:{ AZ:"2 gün əvvəl", TR:"2 gün önce", RU:"2 дня назад", EN:"2 days ago" },
    gd_d1:{ AZ:"Dünən", TR:"Dün", RU:"Вчера", EN:"Yesterday" },
    gd_d0:{ AZ:"Bu gün", TR:"Bugün", RU:"Сегодня", EN:"Today" },
    gd_rise:{ AZ:"artan", TR:"yükselen", RU:"растёт", EN:"rising" },
    gd_flat:{ AZ:"eyni və ya azalan", TR:"aynı ya da düşen", RU:"без изменений или снижается", EN:"same or falling" },
    gd_no_score:{ AZ:"Seçilmiş xəstələrdə bu skor hesablanmır.", TR:"Seçili hastalarda bu skor hesaplanmıyor.", RU:"У выбранных пациентов эта шкала не рассчитывается.", EN:"This score is not calculated for the selected patients." },
    gd_al_t:{ AZ:"Həyəcan yükü · son 24 saat", TR:"Alarm yükü · son 24 saat", RU:"Нагрузка тревог · 24 часа", EN:"Alarm load · last 24 h" },
    gd_al_d:{ AZ:"Saatlıq həyəcan sayı, prioritetə görə üst-üstə.", TR:"Saat başına alarm sayısı, önceliğe göre üst üste.", RU:"Число тревог по часам, по приоритету.", EN:"Alarms per hour, stacked by priority." },
    gd_top3:{ AZ:"Ən çox həyəcan verən 3 çarpayı", TR:"En çok alarm veren 3 yatak", RU:"3 койки с наибольшим числом тревог", EN:"Top 3 beds by alarm count" },
    gd_p_crit:{ AZ:"Kritik", TR:"Kritik", RU:"Критич.", EN:"Critical" },
    gd_p_high:{ AZ:"Yüksək", TR:"Yüksek", RU:"Высокий", EN:"High" },
    gd_p_mid:{ AZ:"Orta", TR:"Orta", RU:"Средний", EN:"Medium" },
    gd_total:{ AZ:"cəmi", TR:"toplam", RU:"всего", EN:"total" },
    gd_alarm:{ AZ:"həyəcan", TR:"alarm", RU:"тревог", EN:"alarms" },
    gd_lac_t:{ AZ:"Laktat meyli · son 48 saat", TR:"Laktat eğilimi · son 48 saat", RU:"Лактат · 48 часов", EN:"Lactate trend · last 48 h" },
    gd_lac_d:{ AZ:"Qırıq xətt 2 mmol/L; ondan yuxarı dəyərlər diqqəti çəkir. Bütün kartlarda eyni şkala.",
      TR:"Kesik çizgi 2 mmol/L; üstündeki değerler dikkat çeker. Bütün kartlarda aynı ölçek.",
      RU:"Пунктир — 2 ммоль/л; значения выше выделяются. Шкала одинакова на всех карточках.",
      EN:"Dashed line is 2 mmol/L; values above it stand out. Same scale on every card." },
    gd_empty:{ AZ:"Seçilmiş şöbədə kliniki izləmdə xəstə yoxdur.", TR:"Seçili birimde klinik izlemdeki hasta yok.", RU:"В выбранном отделении нет пациентов под клиническим наблюдением.", EN:"No patients under clinical monitoring in the selected unit." },
    gd_foot:{ AZ:"Qrafiklər diqqəti çəkir; qiymətləndirmə və qərar həkimindir.", TR:"Grafikler dikkat çeker; değerlendirme ve karar hekimindir.", RU:"Графики привлекают внимание; оценка и решение — за врачом.", EN:"The charts draw attention; assessment and decisions stay with the physician." },
    gd_open:{ AZ:"xəstəni aç", TR:"hastayı aç", RU:"открыть пациента", EN:"open patient" },
    gd_last:{ AZ:"son", TR:"son", RU:"посл.", EN:"latest" },
  });
  const t = (k) => H.t(k);

  /* ================= stil (yalnız gd- önekli) ================= */
  if (!document.getElementById("gd-style")) {
    const st = document.createElement("style"); st.id = "gd-style";
    st.textContent = `
.gd { position:relative; min-width:0; }
.gd * { box-sizing:border-box; }
.gd-units { display:flex; flex-wrap:wrap; gap:6px; }
.gd-chip { font:600 12.5px Figtree; color:var(--mute); background:var(--card); border:1px solid var(--line); border-radius:999px; padding:6px 12px; cursor:pointer; transition:background .15s, color .15s; }
.gd-chip:hover { color:var(--ink); border-color:var(--line2); }
.gd-chip.on { background:var(--pri); color:var(--onpri); border-color:var(--pri); }
.gd-chip b { font-weight:700; opacity:.75; margin-left:5px; }
.gd-chip:focus-visible, .gd-hr:focus-visible, .gd-sm:focus-visible, .gd-lc:focus-visible, .gd-top li:focus-visible, .gd-ln:focus-visible { outline:2px solid var(--pri); outline-offset:2px; }
.gd-kpis { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:12px; margin-bottom:14px; }
.gd-kpi { display:flex; align-items:center; gap:12px; background:var(--card); border:1px solid var(--line); border-left:4px solid var(--k); border-radius:14px; padding:12px 14px; min-width:0; }
.gd-kpi .gd-ki { width:36px; height:36px; border-radius:10px; display:grid; place-items:center; color:var(--k); background:color-mix(in srgb, var(--k) 14%, transparent); flex:none; }
.gd-kpi .gd-ki svg { width:18px; height:18px; }
.gd-kpi b { font:700 30px/1 "Space Grotesk"; color:var(--ink); }
.gd-kpi span { display:block; font:700 13px Figtree; color:var(--ink); }
.gd-kpi small { display:block; font:500 12px Figtree; color:var(--mute); margin-top:2px; }
.gd-sec { margin-top:14px; min-width:0; animation:gd-in .35s ease both; }
.gd-hd { display:flex; gap:6px 14px; align-items:flex-start; flex-wrap:wrap; margin-bottom:10px; }
.gd-hd h3 { margin:0; font:700 15px "Space Grotesk"; color:var(--ink); display:flex; gap:8px; align-items:center; }
.gd-hd h3 svg { width:17px; height:17px; color:var(--pri); }
.gd-hd p { margin:3px 0 0; font:500 12.5px/1.45 Figtree; color:var(--mute); max-width:78ch; }
.gd-hd > div:first-child { min-width:0; flex:1 1 320px; }
.gd-lg { display:flex; flex-wrap:wrap; gap:6px 12px; align-items:center; font:600 11.5px Figtree; color:var(--mute); }
.gd-lg i { display:inline-grid; place-items:center; width:18px; height:14px; border-radius:3px; vertical-align:-2px; margin-right:5px; font:700 9px "JetBrains Mono"; font-style:normal; }
.gd-lg .ln { width:18px; height:0; border-top:2.5px solid var(--crit); border-radius:0; }
.gd-lg .ln.f { border-top:1.5px dashed var(--mute); }
.gd-foot { margin:16px 0 4px; font:500 12px Figtree; color:var(--mute); }
.gd-empty { padding:28px; text-align:center; color:var(--mute); border:1px dashed var(--line2); border-radius:14px; }
/* ısı haritası */
.gd-hw { overflow-x:auto; overscroll-behavior-x:contain; padding-bottom:6px; -webkit-overflow-scrolling:touch; }
.gd-hm { --gdl:210px; min-width:calc(var(--gdl) + 24 * 24px); display:flex; flex-direction:column; gap:3px; }
.gd-hr { display:grid; grid-template-columns:var(--gdl) repeat(24, minmax(21px, 1fr)); gap:3px; align-items:center; border-radius:6px; cursor:pointer; }
.gd-hr.gd-hx { cursor:default; margin-bottom:2px; }
.gd-hl { position:sticky; left:0; z-index:1; background:var(--card); padding:0 10px 0 2px; display:flex; gap:7px; align-items:center; min-width:0; height:26px; font:500 12.5px Figtree; color:var(--mute); }
.gd-hl b { font:700 12.5px "JetBrains Mono"; color:var(--ink); flex:none; }
.gd-hl span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.gd-hl .gd-rk { width:4px; height:18px; border-radius:2px; background:var(--r); flex:none; }
.gd-hr:hover .gd-hl, .gd-hr:focus-visible .gd-hl { color:var(--ink); }
.gd-hr:hover .gd-c { filter:brightness(1.08); }
.gd-hx .gd-hh { font:600 10px "JetBrains Mono"; color:var(--mute); text-align:center; white-space:nowrap; overflow:visible; }
.gd-hx .gd-hh.now { color:var(--ink); text-align:right; letter-spacing:-.03em; }
.gd-c { height:26px; border-radius:4px; display:grid; place-items:center; font:700 10.5px "JetBrains Mono"; font-style:normal; }
.gd-c.l0 { background:color-mix(in srgb, var(--ok) 13%, var(--card2)); color:transparent; }
.gd-c.l1 { background:color-mix(in srgb, var(--mid) 78%, var(--card)); color:color-mix(in srgb, var(--mid) 22%, black); }
.gd-c.l2 { background:color-mix(in srgb, var(--high) 88%, var(--card)); color:color-mix(in srgb, var(--high) 15%, black); }
.gd-c.l3 { background-color:var(--crit); color:white; background-image:repeating-linear-gradient(135deg, color-mix(in srgb, white 22%, transparent) 0 2px, transparent 2px 6px); }
.gd-c.na { background:repeating-linear-gradient(135deg, var(--card2) 0 3px, color-mix(in srgb, var(--line2) 55%, var(--card2)) 3px 5px); }
.gd-c.now { box-shadow:inset 0 0 0 1.5px color-mix(in srgb, var(--ink) 55%, transparent); }
.gd-lg .gd-c { width:20px; height:14px; display:inline-grid; margin-right:5px; vertical-align:-3px; font-size:9px; }
/* küçük çoklu */
.gd-sms { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:10px; }
.gd-sm, .gd-lc { background:var(--card2); border:1px solid var(--line); border-radius:12px; padding:10px 12px; cursor:pointer; min-width:0; transition:border-color .15s; }
.gd-sm:hover, .gd-lc:hover { border-color:var(--line2); }
.gd-smh { display:flex; align-items:center; gap:8px; margin-bottom:6px; min-width:0; }
.gd-smh b { font:700 13px "JetBrains Mono"; color:var(--ink); flex:none; }
.gd-smh span { font:500 12.5px Figtree; color:var(--mute); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1; }
.gd-smh .sv { flex:none; }
.gd-smr { display:grid; grid-template-columns:38px minmax(0,1fr) 70px; gap:8px; align-items:center; }
.gd-smr + .gd-smr { margin-top:4px; }
.gd-smr > em { font:700 10.5px Figtree; font-style:normal; letter-spacing:.04em; color:var(--mute); }
.gd-smr svg, .gd-lc svg, .gd-sl svg, .gd-al svg { display:block; width:100%; }
.gd-big { text-align:right; line-height:1; }
.gd-big b { font:700 22px "Space Grotesk"; }
.gd-big small { display:block; font:600 10px Figtree; color:var(--mute); margin-top:3px; white-space:nowrap; }
.gd-big small.w { color:var(--crit); }
.gd-ax { display:flex; justify-content:space-between; font:600 10px "JetBrains Mono"; color:var(--mute); margin:3px 70px 0 46px; }
.gd-na-n { font:600 11px Figtree; color:var(--mute); margin-top:6px; }
/* ikili satır */
.gd-row2 { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); gap:14px; }
.gd-row2 > .gd-sec { margin-top:14px; }
.gd-seg { display:inline-flex; background:var(--card2); border:1px solid var(--line); border-radius:10px; padding:3px; }
.gd-seg button { font:600 12px Figtree; color:var(--mute); background:none; border:0; padding:5px 10px; border-radius:7px; cursor:pointer; }
.gd-seg button.on { background:var(--pri); color:var(--onpri); }
.gd-ln { cursor:pointer; }
.gd-ln:hover path, .gd-ln:focus path { stroke-width:3.5; }
.gd-ln:hover text, .gd-ln:focus text { font-weight:800; }
.gd-bar:hover rect { opacity:.8; }
.gd-top { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
.gd-t3 { margin:14px 0 8px; font:700 11px Figtree; letter-spacing:.08em; text-transform:uppercase; color:var(--mute); }
.gd-top li { display:grid; grid-template-columns:22px minmax(0,1fr) minmax(80px,1.2fr) 42px; gap:10px; align-items:center; padding:6px 8px; border-radius:10px; background:var(--card2); cursor:pointer; }
.gd-top li > i { font:700 12px "JetBrains Mono"; font-style:normal; color:var(--mute); text-align:center; }
.gd-top li > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:500 12.5px Figtree; color:var(--mute); }
.gd-top li > span b { font:700 12.5px "JetBrains Mono"; color:var(--ink); margin-right:6px; }
.gd-top li > em { font:700 14px "Space Grotesk"; font-style:normal; text-align:right; color:var(--ink); }
.gd-sbar { display:flex; height:10px; border-radius:5px; overflow:hidden; background:var(--line); gap:1px; }
.gd-sbar i { display:block; height:100%; }
/* laktat */
.gd-lcs { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:10px; }
.gd-lcb { display:grid; grid-template-columns:minmax(0,1fr) 66px; gap:8px; align-items:center; }
/* ipucu */
.gd-tip { position:fixed; z-index:60; pointer-events:none; background:var(--ink); color:var(--card); font:600 12px/1.45 Figtree; padding:7px 10px; border-radius:9px; max-width:260px; box-shadow:0 8px 24px rgba(0,0,0,.28); white-space:pre-line; }
.gd-tip[hidden] { display:none; }
@keyframes gd-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
@media (max-width:1100px) { .gd-row2 { grid-template-columns:minmax(0,1fr); gap:0; } }
@media (max-width:900px) {
  .gd-sms, .gd-lcs { grid-template-columns:minmax(0,1fr); }
  .gd-hm { --gdl:150px; }
}
@media (max-width:560px) {
  .gd-kpis { grid-template-columns:minmax(0,1fr); gap:8px; }
  .gd-kpi { padding:9px 12px; }
  .gd-kpi b { font-size:24px; }
  .gd-hm { --gdl:112px; }
  .gd-hl span { display:none; }
  .gd-top li { grid-template-columns:18px minmax(0,1fr) 64px 34px; gap:8px; }
}
@media (prefers-reduced-motion:reduce) {
  .gd-sec { animation:none; }
  .gd-chip, .gd-sm, .gd-lc { transition:none; }
}`;
    document.head.appendChild(st);
  }

  /* ================= yardımcılar ================= */
  const RISK_ORDER = { crit:0, high:1, mid:2, low:3, stable:4 };
  const VK = ["hr", "map", "spo2", "rr", "temp"];
  const VS = { hr:"HR", map:"MAP", spo2:"SpO₂", rr:"RR", temp:"T" };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 2147483646 + 1; };
  const rnd = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const unitOf = (p) => (H.bed(p.bed) || {}).unitId;
  const bedNo = (p) => (H.bed(p.bed) || {}).no || p.bed;
  const shortName = (n) => { const a = String(n).split(" "); return a.length > 1 ? `${a[0]} ${a[1][0]}.` : a[0]; };
  const nameOf = (p) => (H.showNames() ? p.name : "");
  const nowH = () => Math.floor(H.nowT());   // 30.09c: nöbet saati (gece yarısından sonra 24+) → gün öneki doğru düşer
  const p2 = (n) => String(n).padStart(2, "0");
  // t: saat (0 = şimdiki saat, negatif geçmiş) → "21:00" ya da "23.09 · 22:00"
  const clock = (tt) => { const a = nowH() + Math.round(tt), off = Math.floor(a / 24), h = ((a % 24) + 24) % 24; return (off ? H.dm(off) + " · " : "") + p2(h) + ":00"; };
  const fmt = (k, v) => (k === "temp" ? Number(v).toFixed(1) : Math.round(v));
  const esc = H.esc;

  /* ---------- 1. ısı haritası verisi: saat başına eşik dışı vital sayısı (yalnız erişkin) ---------- */
  /* Isı dizisi burada ayrı türetilir: core.js'teki H.series ısıyı da risk katsayısıyla çarpıyor (ör. 36.9 × 0.95 → 35.1 °C),
   * bu da orta riskli hastada 24 saat boyunca sahte "hipotermi" üretiyordu. Diğer vitaller H.series'ten gelir. */
  const tempSeries = (p) => { const r = rnd(hash(p.id + ":temp")), now = p.v.temp, base = Math.min(now, 37.0), n = 24;
    return Array.from({ length:n + 1 }, (_, i) => { const f = i / n, tf = p.risk === "stable" || p.risk === "low" ? f : Math.max(0, (f - .55) / .45);
      return { t:-24 + i, v:i === n ? now : +(base + (now - base) * tf + (r() - .5) * .2).toFixed(1) }; }); };
  const heatRow = (p) => {
    const S = {}; VK.forEach(k => { S[k] = k === "temp" ? tempSeries(p) : H.series(p.id, k, 24, 60); });   // 25 nokta: t = −24 … 0
    return Array.from({ length:24 }, (_, i) => { const idx = i + 1, tt = S.hr[idx].t;
      const out = VK.filter(k => { const v = S[k][idx].v, a = H.VITAL[k].al; return v < a[0] || v > a[1]; })
        .map(k => ({ k, v:S[k][idx].v, lo:S[k][idx].v < H.VITAL[k].al[0] }));
      return { t:tt, out }; });
  };
  const lvl = (n) => (n >= 3 ? 3 : n);

  /* ---------- 3. skor geçmişi (sentetik, deterministik): bugün = hastadaki güncel skor ---------- */
  const SCORES = [["news2", "NEWS2"], ["sofa", "SOFA"], ["pews", "PEWS"], ["nsofa", "nSOFA"]];
  const primaryScore = (p) => (p.news2 != null ? "news2" : p.pews != null ? "pews" : p.nsofa != null ? "nsofa" : p.sofa != null ? "sofa" : null);
  const scoreHist = (p, key) => {
    const d0 = p[key]; if (d0 == null) return null;
    const r = rnd(hash(p.id + ":" + key)), j = () => Math.floor(r() * 2), s = () => [-1, 0, 1][Math.floor(r() * 3)];
    let d1, d2;
    if (p.risk === "crit") { d1 = d0 - 2 - j(); d2 = d1 - 1 - j(); }
    else if (p.risk === "high") { d1 = d0 - 1 - j(); d2 = d1 - j(); }
    else if (p.risk === "mid") { d1 = d0 + s(); d2 = d1 + s(); }
    else { d1 = d0 + j(); d2 = d1 + j(); }
    const c = (v) => Math.max(0, v); return [c(d2), c(d1), d0];
  };
  const isWorse = (p) => { const k = primaryScore(p); if (!k) return false; const h = scoreHist(p, k); return h[2] > h[1]; };

  /* ---------- 4. alarm yükü (sentetik geçmiş, ısı haritasıyla tutarlı) ----------
   * Sürekli monitörlü hastada: eşik dışı her vital o saatte bir alarm üretir; öncelik o saatteki toplam sayıdan
   * (3+ → kritik, 2 → yüksek, 1 → orta). Monitörsüz servis hastasında vital 4 saatte bir ölçülür, yalnız o saatler sayılır.
   * Üstüne H.data.alarms içindeki gerçek (demo) açık/görülmüş alarmlar son saate eklenir. */
  const alarmLoad = (pts, heat) => {
    const B = Array.from({ length:24 }, () => ({ crit:0, high:0, mid:0 })), per = {};
    pts.forEach(p => { const rows = heat[p.id]; per[p.id] = { crit:0, high:0, mid:0 };
      if (rows) rows.forEach((c, i) => { const n = c.out.length; if (!n) return;
        const hour = ((nowH() + Math.round(c.t)) % 24 + 24) % 24; if (!p.monitored && hour % 4) return;
        const sev = n >= 3 ? "crit" : n === 2 ? "high" : "mid"; B[i][sev] += n; per[p.id][sev] += n; }); });
    const ids = new Set(pts.map(p => p.id));
    (H.data.alarms || []).forEach(a => { if (!ids.has(a.pid)) return; const sev = a.sev === "crit" ? "crit" : a.sev === "high" ? "high" : "mid";
      const i = Math.max(0, 23 - Math.floor((a.ageMin || 0) / 60)); B[i][sev]++; per[a.pid][sev]++; });
    return { B, per };
  };

  /* ---------- 5. laktat (sentetik, deterministik): 4 saatte bir numune, 48 saat ----------
   * Son değer risk düzeyine göre; kritik hastada son değer alarm metnindeki 4.1 ile tutarlı. */
  const LAC_END = { crit:4.1, high:2.6, mid:1.9, low:1.3, stable:1.1 }, LAC_START = { crit:1.7, high:1.8, mid:1.6, low:1.5, stable:1.4 };
  const lactate = (p) => { const r = rnd(hash(p.id + ":lac")), n = 12, a = LAC_START[p.risk] ?? 1.4, b = LAC_END[p.risk] ?? 1.2;
    return Array.from({ length:n + 1 }, (_, i) => { const f = i / n, curve = p.risk === "crit" || p.risk === "high" ? Math.pow(f, 1.8) : f;
      const v = i === n ? b : a + (b - a) * curve + (r() - .5) * .3; return { t:-48 + f * 48, v:+Math.max(.4, v).toFixed(1) }; }); };

  /* ================= SVG çizimleri ================= */
  const svgBase = (svg, W, h) => { svg.setAttribute("viewBox", `0 0 ${W} ${h}`); svg.setAttribute("height", h); };

  // MAP / SpO₂ mini grafiği — ölçek H.VITAL lo/hi, bütün kartlarda aynı
  function drawMini(svg, pts, key, bands) {
    const V = H.VITAL[key], W = Math.max(120, svg.clientWidth || svg.parentNode.clientWidth || 200), h = 52, pl = 1, pr = 22, pt = 3, pb = 3;
    const x = (tt) => pl + (tt + 24) / 24 * (W - pl - pr), y = (v) => pt + (1 - (Math.min(V.hi, Math.max(V.lo, v)) - V.lo) / (V.hi - V.lo)) * (h - pt - pb);
    let s = `<rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${h - pt - pb}" rx="3" style="fill:var(--card)"/>`;
    if (bands) {
      if (V.al[0] > V.lo) s += `<rect x="${pl}" y="${y(V.al[0])}" width="${W - pl - pr}" height="${y(V.lo) - y(V.al[0])}" style="fill:var(--band-al)"/>`;
      if (V.al[1] < V.hi) s += `<rect x="${pl}" y="${y(V.hi)}" width="${W - pl - pr}" height="${y(V.al[1]) - y(V.hi)}" style="fill:var(--band-al)"/>`;
      V.al.filter(a => a > V.lo && a < V.hi).forEach(a => { s += `<line x1="${pl}" x2="${W - pr}" y1="${y(a)}" y2="${y(a)}" stroke-dasharray="3 3" style="stroke:var(--line2)"/><text x="${W - pr + 3}" y="${y(a) + 3}" font-size="9" style="fill:var(--mute)" font-family="JetBrains Mono">${a}</text>`; });
    }
    let d = ""; pts.forEach((q, i) => { d += (i ? "L" : "M") + x(q.t).toFixed(1) + "," + y(q.v).toFixed(1); });
    const L = pts[pts.length - 1];
    s += `<path d="${d}" fill="none" stroke-width="1.8" stroke-linejoin="round" style="stroke:var(${V.c})"/>`;
    s += `<circle cx="${x(L.t)}" cy="${y(L.v)}" r="3.2" style="fill:var(${V.c});stroke:var(--card2)" stroke-width="1.5"/>`;
    svgBase(svg, W, h); svg.innerHTML = s;
  }

  // Eğim grafiği (slope chart): 2 gün önce → dün → bugün
  function drawSlope(svg, rows, key) {
    const W = Math.max(280, svg.clientWidth || svg.parentNode.clientWidth || 500), n = rows.length;
    const h = Math.max(230, Math.min(420, 70 + n * 20)), pl = 30, pt = 26, pb = 10;
    const lw = Math.min(W < 420 ? 118 : 190, W * .42), x0 = pl + 12, x2 = W - lw - 14, x1 = (x0 + x2) / 2, X = [x0, x1, x2];
    const mx = Math.max(4, ...rows.flatMap(r => r.h)), step = mx > 12 ? 5 : 2, top = Math.ceil((mx + 1) / step) * step;
    const y = (v) => pt + (1 - v / top) * (h - pt - pb);
    let s = "";
    for (let v = 0; v <= top; v += step) s += `<line x1="${pl}" x2="${x2}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--grid)"/><text x="${pl - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="10" font-family="JetBrains Mono" style="fill:var(--mute)">${v}</text>`;
    // dar ekranda sütun başlıkları çakışmasın diye gün adı yerine tarih yazılır
    const heads = x1 - x0 < 110 ? [H.dm(-2), H.dm(-1), H.dm(0)] : [t("gd_d2"), t("gd_d1"), t("gd_d0")];
    heads.forEach((l, i) => { s += `<line x1="${X[i]}" x2="${X[i]}" y1="${pt - 4}" y2="${h - pb}" style="stroke:var(--line2)"/><text x="${X[i]}" y="${pt - 11}" text-anchor="${i === 0 ? "start" : i === 2 ? "end" : "middle"}" font-size="11" font-weight="700" font-family="Figtree" style="fill:var(--mute)">${esc(l)}</text>`; });
    // etiketler: bugünkü değerin hizasında, üst üste binmeyecek şekilde aralanır
    const lab = rows.map(r => ({ r, y:y(r.h[2]) })).sort((a, b) => a.y - b.y), gap = 14;
    lab.forEach((o, i) => { o.ly = i ? Math.max(o.y, lab[i - 1].ly + gap) : o.y; });
    const over = lab.length ? lab[lab.length - 1].ly - (h - 4) : 0;
    if (over > 0) { lab.forEach(o => { o.ly -= over; }); for (let i = lab.length - 2; i >= 0; i--) lab[i].ly = Math.min(lab[i].ly, lab[i + 1].ly - gap); }
    const maxCh = Math.max(6, Math.floor((lw - 6) / 6.3));
    const order = [...lab].sort((a, b) => (a.r.worse ? 1 : 0) - (b.r.worse ? 1 : 0));   // kötüleşenler üstte çizilir
    order.forEach(o => { const r = o.r, c = r.worse ? "var(--crit)" : "var(--mute)", dlt = r.h[2] - r.h[1];
      const glyph = dlt > 0 ? "▲+" + dlt : dlt < 0 ? "▼" + dlt : "="; let txt = `${r.bed} ${r.name ? shortName(r.name) + " " : ""}`;
      if (txt.length + 6 > maxCh) txt = r.bed + " ";
      const d = r.h.map((v, i) => (i ? "L" : "M") + X[i] + "," + y(v).toFixed(1)).join("");
      s += `<g class="gd-ln" data-pid="${r.id}" data-tab="skor" tabindex="0" role="link" aria-label="${esc(r.bed)} · ${r.h.join(" → ")}">
        <path d="${d}" fill="none" stroke-width="${r.worse ? 2.6 : 1.5}" ${r.worse ? "" : 'stroke-dasharray="4 3" opacity=".75"'} style="stroke:${c}"/>
        ${r.h.map((v, i) => `<circle cx="${X[i]}" cy="${y(v)}" r="${r.worse ? 3.4 : 2.6}" style="fill:${c}"/>`).join("")}
        <line x1="${x2 + 4}" x2="${x2 + 10}" y1="${o.y}" y2="${o.ly}" style="stroke:${c}" opacity=".5"/>
        <text x="${x2 + 12}" y="${o.ly + 4}" font-size="11" font-family="Figtree" font-weight="${r.worse ? 700 : 500}" style="fill:${r.worse ? "var(--crit)" : "var(--ink)"}">${esc(txt)}<tspan font-family="JetBrains Mono" font-weight="700">${r.h[2]}</tspan> <tspan font-family="JetBrains Mono" font-size="10">${glyph}</tspan></text>
        <title>${esc(r.bed + (r.name ? " · " + r.name : "") + " · " + r.h.join(" → "))}</title></g>`; });
    svgBase(svg, W, h); svg.innerHTML = s;
  }

  // Alarm yükü: 24 saatlik yığılmış çubuk
  const SEVK = [["crit", "--crit"], ["high", "--high"], ["mid", "--mid"]];
  function drawAlarms(svg, B) {
    const W = Math.max(280, svg.clientWidth || svg.parentNode.clientWidth || 500), h = 190, pl = 28, pr = 6, pt = 8, pb = 22;
    const tot = B.map(b => b.crit + b.high + b.mid), mx = Math.max(4, ...tot), step = mx > 40 ? 20 : mx > 16 ? 10 : mx > 8 ? 4 : 2, top = Math.ceil(mx / step) * step;
    const bw = (W - pl - pr) / 24, y = (v) => pt + (1 - v / top) * (h - pt - pb);
    let s = "";
    for (let v = 0; v <= top; v += step) s += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--grid)"/><text x="${pl - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="10" font-family="JetBrains Mono" style="fill:var(--mute)">${v}</text>`;
    B.forEach((b, i) => { let acc = 0, g = ""; const x = pl + i * bw + 1.5, w = Math.max(2, bw - 3);
      SEVK.forEach(([k, c]) => { if (!b[k]) return; const y1 = y(acc + b[k]), y0 = y(acc); g += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1, y0 - y1 - 1).toFixed(1)}" rx="1.5" style="fill:var(${c})"/>`; acc += b[k]; });
      const tt = i - 23, tip = `${clock(tt)}\n${t("gd_p_crit")}: ${b.crit} · ${t("gd_p_high")}: ${b.high} · ${t("gd_p_mid")}: ${b.mid}`;
      s += `<g class="gd-bar" data-tip="${esc(tip)}"><rect x="${pl + i * bw}" y="${pt}" width="${bw}" height="${h - pt - pb}" fill="transparent"/>${g}</g>`;
      if (i % (bw < 16 ? 6 : 3) === 2 || i === 23) s += `<text x="${pl + i * bw + bw / 2}" y="${h - 6}" text-anchor="${i === 23 ? "end" : "middle"}" font-size="10" font-family="JetBrains Mono" style="fill:var(${i === 23 ? "--ink" : "--mute"})">${i === 23 ? esc(t("gd_now")) : clock(tt).slice(-5)}</text>`;
    });
    svgBase(svg, W, h); svg.innerHTML = s;
  }

  // Laktat mini grafiği — ölçek 0 … LMAX, bütün kartlarda aynı
  function drawLac(svg, pts, LMAX) {
    const W = Math.max(120, svg.clientWidth || svg.parentNode.clientWidth || 200), h = 58, pl = 18, pr = 4, pt = 4, pb = 4;
    const x = (tt) => pl + (tt + 48) / 48 * (W - pl - pr), y = (v) => pt + (1 - Math.min(LMAX, v) / LMAX) * (h - pt - pb);
    let s = `<rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${h - pt - pb}" rx="3" style="fill:var(--card)"/>`;
    s += `<rect x="${pl}" y="${y(LMAX)}" width="${W - pl - pr}" height="${y(2) - y(LMAX)}" style="fill:var(--band-al)"/>`;
    s += `<line x1="${pl}" x2="${W - pr}" y1="${y(2)}" y2="${y(2)}" stroke-dasharray="4 3" stroke-width="1.2" style="stroke:var(--crit)" opacity=".7"/>`;
    s += `<text x="${pl - 4}" y="${y(2) + 3}" text-anchor="end" font-size="9" font-family="JetBrains Mono" style="fill:var(--mute)">2</text><text x="${pl - 4}" y="${y(LMAX) + 8}" text-anchor="end" font-size="9" font-family="JetBrains Mono" style="fill:var(--mute)">${LMAX}</text>`;
    let d = ""; pts.forEach((q, i) => { d += (i ? "L" : "M") + x(q.t).toFixed(1) + "," + y(q.v).toFixed(1); });
    s += `<path d="${d}" fill="none" stroke-width="1.8" stroke-linejoin="round" style="stroke:var(--pri)"/>`;
    pts.forEach((q, i) => { const hi = q.v > 2; s += `<circle cx="${x(q.t)}" cy="${y(q.v)}" r="${i === pts.length - 1 ? 3.4 : 2.2}" style="fill:${hi ? "var(--crit)" : "var(--pri)"};stroke:var(--card2)" stroke-width="1"/>`; });
    svgBase(svg, W, h); svg.innerHTML = s;
  }

  /* ================= sayfa ================= */
  let scoreSel = null;
  H.register("unitdash", { title:() => t("m_unitdash"), perm:"beds", render(root) {
    const all = H.myPatients().filter(p => { const u = H.unit(unitOf(p)); return u && u.live !== false && H.isClinical(u); });
    const unitIds = [...new Set(all.map(unitOf))], units = unitIds.map(H.unit).sort((a, b) => a.floor - b.floor || a.id.localeCompare(b.id));
    const sel = H.state.unitId && (H.state.user.units || []).includes(H.state.unitId) ? H.state.unitId : null;
    const pts = all.filter(p => !sel || unitOf(p) === sel)
      .sort((a, b) => (RISK_ORDER[a.risk] ?? 9) - (RISK_ORDER[b.risk] ?? 9) || bedNo(a).localeCompare(bedNo(b)));
    const selUnit = sel ? H.unit(sel) : null;
    const sub = `${selUnit ? esc(selUnit.tr) : units.length === 1 ? esc(units[0].tr) : units.length + " " + t("gd_units")} · ${pts.length} ${t("gd_pts")} · ${esc(H.nowFull())}`;
    const chips = units.length > 1 ? `<div class="gd-units" role="group" aria-label="${esc(t("gd_units"))}">
        <button class="gd-chip ${sel ? "" : "on"}" data-unit="" aria-pressed="${!sel}">${t("gd_all")}<b>${all.length}</b></button>
        ${units.map(u => `<button class="gd-chip ${sel === u.id ? "on" : ""}" data-unit="${u.id}" aria-pressed="${sel === u.id}">${esc(u.tr)}<b>${all.filter(p => unitOf(p) === u.id).length}</b></button>`).join("")}</div>` : "";
    const head = `<div class="ph"><div><h2>${t("m_unitdash")}</h2><p>${sub}</p></div><div class="r">${chips}</div></div>`;
    if (!pts.length) { root.innerHTML = `<div class="gd">${head}<div class="gd-empty">${t("gd_empty")}</div></div>`; bind(root, null); return; }

    // veri
    const heat = {}; pts.forEach(p => { if (p.ageGroup === "adult") heat[p.id] = heatRow(p); });
    const load = alarmLoad(pts, heat);
    const nCrit = pts.filter(p => p.risk === "crit").length, nHigh = pts.filter(p => p.risk === "high").length, nWorse = pts.filter(isWorse).length;
    const avail = SCORES.filter(([k]) => pts.some(p => p[k] != null));
    if (!scoreSel || !avail.some(([k]) => k === scoreSel)) scoreSel = avail.length ? avail[0][0] : null;
    const lab = (p) => `<b>${esc(bedNo(p))}</b>${nameOf(p) ? `<span>${esc(nameOf(p))}</span>` : ""}`;
    const aria = (p) => esc(bedNo(p) + (nameOf(p) ? " · " + nameOf(p) : "") + " · " + t("gd_open"));

    const kpi = (c, ic, n, l, d) => `<div class="gd-kpi" style="--k:${c}"><div class="gd-ki">${H.icon(ic)}</div><b>${n}</b><div><span>${l}</span><small>${d}</small></div></div>`;

    // 1 · ısı haritası
    const hx = `<div class="gd-hr gd-hx" aria-hidden="true"><div class="gd-hl"></div>${Array.from({ length:24 }, (_, i) => { const tt = i - 23;
      return `<div class="gd-hh ${i === 23 ? "now" : ""}">${i === 23 ? esc(t("gd_now")) : (i % 3 === 2 ? clock(tt).slice(-5, -3) : "")}</div>`; }).join("")}</div>`;
    const hrows = pts.map(p => { const rows = heat[p.id], bed = bedNo(p), who = bed + (nameOf(p) ? " · " + nameOf(p) : "");
      const cells = rows ? rows.map((c, i) => { const n = c.out.length, L = lvl(n);
        const tip = `${who}\n${clock(c.t)}\n${n ? t("gd_tip_out") + ": " + c.out.map(o => `${VS[o.k]} ${fmt(o.k, o.v)} ${o.lo ? "▼" : "▲"}`).join(" · ") : t("gd_tip_in")}`;
        return `<i class="gd-c l${L}${i === 23 ? " now" : ""}" data-tip="${esc(tip)}">${n || ""}</i>`; }).join("")
        : Array.from({ length:24 }, (_, i) => `<i class="gd-c na${i === 23 ? " now" : ""}" data-tip="${esc(who + "\n" + t("gd_na"))}"></i>`).join("");
      const nowOut = rows ? rows[23].out.length : null;
      return `<div class="gd-hr" role="link" tabindex="0" data-pid="${p.id}" data-tab="trend" aria-label="${esc(who)}${nowOut != null ? ` · ${t("gd_tip_out")} ${nowOut}` : ""} · ${esc(t("gd_open"))}">
        <div class="gd-hl"><i class="gd-rk" style="--r:${H.SEV[p.risk].c}"></i>${lab(p)}</div>${cells}</div>`; }).join("");
    const heatLegend = `<div class="gd-lg"><span><i class="gd-c l0"></i>${t("gd_lv0")}</span><span><i class="gd-c l1">1</i>${t("gd_lv1")}</span><span><i class="gd-c l2">2</i>${t("gd_lv2")}</span><span><i class="gd-c l3">3</i>${t("gd_lv3")}</span>${pts.some(p => !heat[p.id]) ? `<span><i class="gd-c na"></i>${t("gd_na_s")}</span>` : ""}</div>`;

    // 2 · küçük çoklu
    const big = (p, k, bands) => { const v = p.v[k], a = H.VITAL[k].al, lo = bands && v < a[0], hi = bands && v > a[1];
      return `<div class="gd-big"><b style="color:var(${H.VITAL[k].c})">${fmt(k, v)}</b><small class="${lo || hi ? "w" : ""}">${lo ? "▼ " + t("gd_below") : hi ? "▲ " + t("gd_above") : H.VITAL[k].u}</small></div>`; };
    const smCards = pts.map(p => { const adult = p.ageGroup === "adult";
      return `<div class="gd-sm" role="link" tabindex="0" data-pid="${p.id}" data-tab="trend" aria-label="${aria(p)}">
        <div class="gd-smh">${lab(p)}${nameOf(p) ? "" : "<span></span>"}${H.sevPill(p.risk)}</div>
        ${["map", "spo2"].map(k => `<div class="gd-smr"><em>${VS[k]}</em><svg data-mini="${k}" data-pid="${p.id}" data-bands="${adult ? 1 : ""}" role="img" aria-label="${esc(VS[k] + " · " + t("gd_last") + " " + fmt(k, p.v[k]) + " " + H.VITAL[k].u)}"></svg>${big(p, k, adult)}</div>`).join("")}
        <div class="gd-ax"><span>${t("gd_h24")}</span><span>${t("gd_now")}</span></div>
        ${adult ? "" : `<div class="gd-na-n">${t("gd_na")}</div>`}</div>`; }).join("");

    // 3 · skor eğimi
    const slopeSeg = avail.length > 1 ? `<div class="gd-seg" role="group">${avail.map(([k, l]) => `<button data-score="${k}" class="${k === scoreSel ? "on" : ""}" aria-pressed="${k === scoreSel}">${l}</button>`).join("")}</div>` : (avail[0] ? `<span class="pill">${avail[0][1]}</span>` : "");

    // 4 · alarm yükü — en çok alarm veren 3 yatak
    const top3 = pts.map(p => ({ p, c:load.per[p.id], n:load.per[p.id].crit + load.per[p.id].high + load.per[p.id].mid })).filter(o => o.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
    const tmax = Math.max(1, ...top3.map(o => o.n)), total = load.B.reduce((a, b) => a + b.crit + b.high + b.mid, 0);
    const topHtml = top3.length ? `<h4 class="gd-t3">${t("gd_top3")}</h4><ul class="gd-top">${top3.map((o, i) => `<li role="link" tabindex="0" data-pid="${o.p.id}" data-tab="trend" aria-label="${aria(o.p)} · ${o.n} ${t("gd_alarm")}"><i>${i + 1}</i><span>${lab(o.p)}</span>
        <div class="gd-sbar" style="width:${Math.max(18, o.n / tmax * 100)}%" title="${esc(`${t("gd_p_crit")} ${o.c.crit} · ${t("gd_p_high")} ${o.c.high} · ${t("gd_p_mid")} ${o.c.mid}`)}">${SEVK.map(([k, c]) => o.c[k] ? `<i style="flex:${o.c[k]};background:var(${c})"></i>` : "").join("")}</div><em>${o.n}</em></li>`).join("")}</ul>` : "";
    const alLegend = `<div class="gd-lg">${SEVK.map(([k, c]) => `<span><i style="background:var(${c})"></i>${t("gd_p_" + k)}</span>`).join("")}<span>· ${t("gd_total")} <b style="color:var(--ink)">${total}</b></span></div>`;

    // 5 · laktat
    const lacs = {}; pts.forEach(p => { lacs[p.id] = lactate(p); });
    const LMAX = Math.max(6, Math.ceil(Math.max(...Object.values(lacs).flat().map(q => q.v))));
    const lacCards = pts.map(p => { const L = lacs[p.id], v = L[L.length - 1].v, hi = v > 2;
      return `<div class="gd-lc" role="link" tabindex="0" data-pid="${p.id}" data-tab="sonuc" aria-label="${aria(p)} · ${v} mmol/L">
        <div class="gd-smh">${lab(p)}${nameOf(p) ? "" : "<span></span>"}</div>
        <div class="gd-lcb"><svg data-lac="${p.id}" role="img" aria-label="${esc("Laktat · " + L.map(q => q.v).join(", "))}"></svg>
        <div class="gd-big"><b style="color:${hi ? "var(--crit)" : "var(--ink)"}">${v.toFixed(1)}</b><small class="${hi ? "w" : ""}">${hi ? "▲ " + t("gd_above") : "mmol/L"}</small></div></div>
        <div class="gd-ax" style="margin:3px 74px 0 18px"><span>${t("gd_h48")}</span><span>${t("gd_now")}</span></div></div>`; }).join("");

    const sec = (ic, tk, dk, right, body, extra = "") => `<section class="box gd-sec" ${extra}><div class="gd-hd"><div><h3>${H.icon(ic)}${t(tk)}</h3><p>${t(dk)}</p></div>${right || ""}</div>${body}</section>`;
    root.innerHTML = `<div class="gd">${head}
      <div class="gd-kpis">
        ${kpi("var(--crit)", "alert", nCrit, t("gd_k_crit"), t("gd_k_crit_d"))}
        ${kpi("var(--high)", "alert", nHigh, t("gd_k_high"), t("gd_k_high_d"))}
        ${kpi("var(--pri)", "chart", nWorse, t("gd_k_worse"), t("gd_k_worse_d"))}
      </div>
      ${sec("grid", "gd_heat_t", "gd_heat_d", heatLegend, `<div class="gd-hw"><div class="gd-hm">${hx}${hrows}</div></div>`)}
      ${sec("activity", "gd_sm_t", "gd_sm_d", "", `<div class="gd-sms">${smCards}</div>`)}
      <div class="gd-row2">
        ${sec("chart", "gd_sl_t", "gd_sl_d", `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${slopeSeg}<div class="gd-lg"><span><i class="ln"></i>${t("gd_rise")}</span><span><i class="ln f"></i>${t("gd_flat")}</span></div></div>`,
          `<div class="gd-sl">${scoreSel ? `<svg data-slope role="img" aria-label="${esc(t("gd_sl_t"))}"></svg>` : `<div class="gd-empty">${t("gd_no_score")}</div>`}</div>`)}
        ${sec("bell", "gd_al_t", "gd_al_d", alLegend, `<div class="gd-al"><svg data-alarm role="img" aria-label="${esc(t("gd_al_t") + " · " + total)}"></svg></div>${topHtml}`)}
      </div>
      ${sec("flask", "gd_lac_t", "gd_lac_d", "", `<div class="gd-lcs">${lacCards}</div>`)}
      <p class="gd-foot">${t("gd_foot")}</p>
      <div class="gd-tip" role="tooltip" hidden></div></div>`;

    const draw = () => {
      root.querySelectorAll("svg[data-mini]").forEach(svg => { const k = svg.dataset.mini; drawMini(svg, H.series(svg.dataset.pid, k, 24, 30), k, !!svg.dataset.bands); });
      const sl = root.querySelector("svg[data-slope]");
      if (sl && scoreSel) drawSlope(sl, pts.filter(p => p[scoreSel] != null).map(p => { const h = scoreHist(p, scoreSel); return { id:p.id, bed:bedNo(p), name:nameOf(p), h, worse:h[2] > h[1] }; }), scoreSel);
      const al = root.querySelector("svg[data-alarm]"); if (al) drawAlarms(al, load.B);
      root.querySelectorAll("svg[data-lac]").forEach(svg => drawLac(svg, lacs[svg.dataset.lac], LMAX));
    };
    draw();
    // Isı haritası dar ekranda kendi içinde kayar; açılışta en yeni saatler ("şimdi") görünür olsun.
    const hw = root.querySelector(".gd-hw"); if (hw && hw.scrollWidth > hw.clientWidth) hw.scrollLeft = hw.scrollWidth;
    bind(root, draw);
  } });

  /* ================= olaylar ================= */
  function bind(root, draw) {
    const tip = () => root.querySelector(".gd-tip");
    const place = (e) => { const el = tip(); if (!el || el.hidden) return; const r = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      let x = e.clientX + 14, y = e.clientY + 16; if (x + r.width > vw - 8) x = e.clientX - r.width - 14; if (y + r.height > vh - 8) y = e.clientY - r.height - 12;
      el.style.left = Math.max(8, x) + "px"; el.style.top = Math.max(8, y) + "px"; };
    root.addEventListener("mouseover", e => { const el = tip(); if (!el) return; const s = e.target.closest("[data-tip]");
      if (s && root.contains(s)) { el.textContent = s.dataset.tip; el.hidden = false; place(e); } else el.hidden = true; });
    root.addEventListener("mousemove", place);
    root.addEventListener("mouseleave", () => { const el = tip(); if (el) el.hidden = true; });
    root.addEventListener("click", e => {
      const u = e.target.closest("[data-unit]"); if (u) { H.state.unitId = u.dataset.unit || null; H.renderApp(); return; }
      const sc = e.target.closest("[data-score]"); if (sc) { scoreSel = sc.dataset.score; root.querySelectorAll("[data-score]").forEach(b => { b.classList.toggle("on", b === sc); b.setAttribute("aria-pressed", b === sc); }); draw && draw(); return; }
      const p = e.target.closest("[data-pid]"); if (p && root.contains(p)) H.go("patient", { pid:p.dataset.pid, tab:p.dataset.tab || "trend" });
    });
    root.addEventListener("keydown", e => { if (e.key !== "Enter" && e.key !== " ") return; const p = e.target.closest("[data-pid][tabindex]"); if (!p) return;
      e.preventDefault(); H.go("patient", { pid:p.dataset.pid, tab:p.dataset.tab || "trend" }); });
    // Genişlik değişince SVG'ler yeniden çizilir; sayfa değişince gözlemci kendini kapatır.
    if (draw && window.ResizeObserver) { let w = root.clientWidth, raf = 0;
      const ro = new ResizeObserver(() => { if (!root.isConnected) { ro.disconnect(); return; } if (root.clientWidth === w) return; w = root.clientWidth;
        cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
      ro.observe(root); }
  }
})();

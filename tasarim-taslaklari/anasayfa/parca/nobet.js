/*
  parca/nobet.js · "Yoğun bakımda 24 saat" — HIZLANDIRILMIŞ OYNATICI (time-lapse), kendi kendine yeten modül.
  (Dosya adı ve window.HMC_NOBET adı geriye dönük uyum için korunur; bölümün kavramı artık "nöbet" değil, 24 saatlik döngü.)
  Ev sahibi: <section id="nobet" class="s"><div class="wrap"><div class="head">…</div><div id="nobet-mount"></div></div></section>
  24.09 · Ozan geri bildirimi: kaydırarak ilerlemek yoruyor, anların altı ve iki yanı boş, "bir gece" eksik/sakin duruyor;
    ardından: yoğun bakım 7/24 çalışır, ürün bir nöbet aracı değil → 08:00'den ertesi 08:00'e tam gün.
    Uzun kaydırma izi kaldırıldı. Tek, kompakt sahne: solda saat + gündüz/gece + oynatma denetimleri + sayaçlar, ortada anın
    metni, sağda canlı küçük ekran; altta tam genişlikte zaman çizelgesi (güneş/ay bandı, sürüklenir, oklarla oynar) ve an düğmeleri.
    Bölüm görünür olunca kendiliğinden oynar (1×: 08:00→08:00 ≈ 74 sn), her anda kısa durur, küçük ekran o sırada canlanır.
    Kullanıcı bir denetime dokunursa kontrol onda kalır (otomatik oynatma onunla yarışmaz). Ekran dışı / sekme gizli → durur.
    Anlar yalnız prototipte gerçekten olan işlevler: devir (sabah/akşam), vizitte SOFA onayı, acil servisten kabul
    (hasta no + protokol, kol bandı, REA08 boş→dolu), serviste portatif ölçüm, hızlı yanıt çağrısı, SpO₂ eskalasyonu,
    saatlik görev ızgarası, teslim notunun mühürlenmesi.
  - Kendi <style id="nobet-css"> etiketini ekler; bütün seçiciler #nobet altında, sınıflar ve id'ler "nb-" önekli.
  - Renkler ev sahibinin değişkenleri: --page --card --card2 --ink --mute --line --line2 --pri --onpri --priSoft --priInk
    --crit --critSoft --mid --midSoft --ok --okSoft --spo --hr --tile --shadow --shadowS. Tema: html[data-theme="gun"|"gece"].
  - Dil: localStorage "hmc.lang" (AZ varsayılan); document üzerinde "hmc:lang" olayı (detail: "AZ"|"TR"|"RU"|"EN").
    Dil değişince konum/oynatma durumu korunur.
  - API: window.HMC_NOBET = { play(), pause(), speed(n), go(k), state() }.
  - Yatak kodları ve değerler uydurmadır; hasta adı, tanı, ilaç/doz yok. Sistem bildirir ve kaydeder; kararı hekim verir.
*/
(function () {
  "use strict";
  var host = document.getElementById("nobet"), mount = document.getElementById("nobet-mount");
  if (!host || !mount || document.getElementById("nb-root")) return;

  var IDX = { AZ:0, TR:1, RU:2, EN:3 };
  var lang = "AZ";
  try { var sv = localStorage.getItem("hmc.lang"); if (sv && sv in IDX) lang = sv; } catch (e) {}
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ---------- stil ----------
     Yazı tipi yığınları: Figtree / Space Grotesk bazı AZ (ə) ve Kiril glifleri taşımıyor; eksik glif sistem yazı tipinden gelir.
     Karışık glifte satır kutusu oynamasın diye her "font:" kısaltmasında satır yüksekliği SAYI olarak verildi (normal değil). */
  var CSS = `
#nobet .nb { --nb-ff:Figtree, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  --nb-fd:"Space Grotesk", Figtree, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --nb-fm:"JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
  --nb-critInk:#b91c1c; --nb-okInk:#15803d; --nb-midInk:#9a6a00; --nb-wave:#22b8d6; --nb-scrBg:var(--card); --nb-scrLine:var(--line);
  position:relative; color:var(--ink); font:400 16px/1.55 var(--nb-ff); text-align:left; }
html[data-theme="gece"] #nobet .nb { --nb-critInk:#fca5a5; --nb-okInk:#86efac; --nb-midInk:var(--mid); --nb-scrBg:rgba(4,10,20,.78); --nb-scrLine:#1f3150; }
#nobet .nb *, #nobet .nb *::before, #nobet .nb *::after { box-sizing:border-box; }
#nobet .nb-mono { font-family:var(--nb-fm); font-variant-numeric:tabular-nums; }
#nobet svg.nb-i { width:18px; height:18px; flex:none; display:inline-block; vertical-align:middle; }
#nobet .nb button { font:inherit; color:inherit; margin:0; -webkit-tap-highlight-color:transparent; }
#nobet .nb button:focus-visible, #nobet .nb-tl:focus-visible { outline:2px solid var(--pri); outline-offset:3px; }
#nobet .nb h3, #nobet .nb h4, #nobet .nb p, #nobet .nb ul, #nobet .nb ol { margin:0; padding:0; }

/* canlı nokta */
#nobet .nb-live { display:inline-block; width:7px; height:7px; border-radius:50%; background:#22c55e; flex:none; box-shadow:0 0 0 0 rgba(34,197,94,.6); animation:nb-ping 1.6s ease-out infinite; }
@keyframes nb-ping { to { box-shadow:0 0 0 8px rgba(34,197,94,0); } }
#nobet .nb.nb-paused .nb-rltop .nb-live { animation:none; background:var(--line2); }

/* ---------- sahne ---------- */
#nobet .nb-stage { background:var(--card); border:1px solid var(--line); border-radius:24px; box-shadow:var(--shadowS); padding:22px 24px 20px;
  display:grid; grid-template-columns:272px minmax(0, .9fr) minmax(0, 1.1fr); grid-template-areas:"clk tx scr" "tl tl tl" "chips chips chips";
  column-gap:36px; row-gap:18px; align-items:center; }

/* sol: saat paneli */
#nobet .nb-clk { grid-area:clk; align-self:stretch; background:var(--card2); border:1px solid var(--line); border-radius:18px; padding:16px 16px 14px; display:flex; flex-direction:column; min-width:0; }
#nobet .nb-rltop { display:flex; align-items:center; gap:8px; font:700 12px/1.35 var(--nb-ff); color:var(--mute); min-width:0; }
#nobet .nb-rltop > span:last-child { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#nobet .nb-clock { font:700 56px/1.05 var(--nb-fm); letter-spacing:-.03em; margin:8px 0 4px; color:var(--ink); font-variant-numeric:tabular-nums; }
#nobet .nb-left { display:flex; align-items:center; gap:6px; font:400 12.5px/1.4 var(--nb-ff); color:var(--mute); min-width:0; }
#nobet .nb-left svg.nb-i { width:15px; height:15px; color:#d99a1e; }
#nobet .nb.nb-night .nb-left svg.nb-i { color:var(--priInk); }
#nobet .nb-left span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
#nobet .nb-left b { color:var(--ink); font-weight:700; }
#nobet .nb-ctl { display:flex; align-items:center; gap:8px; margin-top:14px; }
#nobet .nb-pp { width:44px; height:44px; border-radius:50%; border:0; background:var(--pri); color:var(--onpri); display:grid; place-items:center; cursor:pointer; flex:none; box-shadow:0 6px 16px color-mix(in srgb, var(--pri) 35%, transparent); transition:transform .15s; }
#nobet .nb-pp:hover { transform:scale(1.05); }
#nobet .nb-pp svg.nb-i { width:18px; height:18px; }
#nobet .nb-spd { display:inline-flex; padding:3px; gap:2px; border-radius:12px; background:var(--card); border:1px solid var(--line); }
#nobet .nb-spd button { border:0; background:none; border-radius:9px; height:34px; min-width:40px; padding:0 8px; font:700 13px/1 var(--nb-fm); color:var(--mute); cursor:pointer; }
#nobet .nb-spd button[aria-pressed="true"] { background:var(--priSoft); color:var(--priInk); }
#nobet .nb-ctl { margin-bottom:16px; }
#nobet .nb-cnt { margin-top:auto; padding-top:12px; border-top:1px solid var(--line); }
#nobet .nb-cnt h4 { font:700 11px/1.35 var(--nb-ff); color:var(--mute); text-transform:uppercase; letter-spacing:.06em; margin-bottom:8px; }
#nobet .nb-cn { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:6px; }
#nobet .nb-cn > div { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:6px 7px 5px; min-width:0; display:flex; flex-direction:column; justify-content:space-between; }
#nobet .nb-cn small { display:flex; align-items:flex-start; gap:5px; font:700 10.5px/1.3 var(--nb-ff); color:var(--mute); min-height:2.6em; overflow-wrap:anywhere; }
#nobet .nb-cn small i { width:7px; height:7px; border-radius:2px; flex:none; margin-top:.3em; }
#nobet .nb-cn b { display:block; font:700 20px/1.2 var(--nb-fm); color:var(--ink); font-variant-numeric:tabular-nums; }
@media (min-width:1181px) {
  #nobet .nb-cn { grid-template-columns:minmax(0, 1fr); gap:4px; }
  #nobet .nb-cn > div { flex-direction:row; align-items:center; padding:4px 10px; }
  #nobet .nb-cn small { min-height:0; font-size:11.5px; align-items:center; }
  #nobet .nb-cn small i { margin-top:0; }
  #nobet .nb-cn b { font-size:16px; margin-left:auto; }
}
#nobet .nb-log { list-style:none; margin-top:10px; display:flex; flex-direction:column; gap:3px; min-height:66px; }
#nobet .nb-log li { display:flex; gap:8px; align-items:baseline; font:400 12px/1.45 var(--nb-ff); color:var(--mute); min-width:0; }
#nobet .nb-log li:first-child { color:var(--ink); }
#nobet .nb-log li .nb-mono { font-size:11px; flex:none; }
#nobet .nb-log li span:last-child { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
#nobet .nb-log li i { width:6px; height:6px; border-radius:50%; flex:none; align-self:center; }

/* renk: etkinlik türleri */
#nobet .nb-cr { background:var(--pri); } #nobet .nb-ct { background:var(--ok); } #nobet .nb-ca { background:var(--crit); } #nobet .nb-ck { background:var(--mid); } #nobet .nb-cx { background:var(--line2); }

/* orta: anın metni (hepsi aynı hücrede üst üste → yükseklik sabit, sayfa zıplamaz) */
#nobet .nb-txs { grid-area:tx; display:grid; min-width:0; align-self:center; }
#nobet .nb-mt { grid-area:1 / 1; min-width:0; align-self:center; opacity:0; visibility:hidden; transform:translateY(10px); transition:opacity .35s ease, transform .35s ease, visibility 0s linear .35s; }
#nobet .nb-mt.nb-on { opacity:1; visibility:visible; transform:none; transition:opacity .35s ease .05s, transform .35s ease .05s, visibility 0s; }
#nobet .nb-chip { display:inline-flex; align-items:center; gap:8px; font:700 13px/1.3 var(--nb-fm); color:var(--priInk); background:var(--priSoft); border-radius:999px; padding:5px 12px; margin-bottom:12px; max-width:100%; }
#nobet .nb-chip svg.nb-i { width:14px; height:14px; }
#nobet .nb-chip .nb-where { font:700 12px/1.3 var(--nb-ff); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
#nobet .nb-h { font:700 clamp(24px, 2.2vw, 32px)/1.15 var(--nb-fd); letter-spacing:-.01em; margin:0 0 12px; color:var(--ink); overflow-wrap:break-word; text-align:left; }
#nobet .nb-p { color:var(--mute); font:400 15.5px/1.6 var(--nb-ff); margin:0; max-width:none; }
#nobet .nb-ticks { list-style:none; margin:14px 0 0; display:flex; flex-direction:column; gap:7px; }
#nobet .nb-ticks li { display:flex; gap:10px; align-items:flex-start; font:400 14px/1.5 var(--nb-ff); margin:0; padding:0; color:var(--ink); }
#nobet .nb-ticks li::before { content:""; flex:none; width:18px; height:18px; margin-top:1px; border-radius:50%; background:var(--priSoft) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230e7490' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center/11px no-repeat; }
html[data-theme="gece"] #nobet .nb-ticks li::before { background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237dd3e6' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E"); }
#nobet .nb-endh { font-size:clamp(28px, 2.8vw, 40px); }
#nobet .nb-endh .nb-mono { color:var(--priInk); }
#nobet .nb-endsum { display:flex; flex-wrap:wrap; gap:6px; margin-top:14px; }
#nobet .nb-endsum span { font:700 12.5px/1.3 var(--nb-ff); padding:6px 10px; border-radius:9px; background:var(--card2); border:1px solid var(--line); }
#nobet .nb-endsum b { font-family:var(--nb-fm); margin-left:4px; }
#nobet .nb-again { display:inline-flex; align-items:center; gap:8px; margin-top:16px; height:40px; padding:0 16px; border-radius:11px; border:1px solid var(--line2); background:var(--card); font:700 14px/1 var(--nb-ff); cursor:pointer; }
#nobet .nb-again:hover { border-color:var(--pri); color:var(--priInk); }

/* sağ: küçük ekranlar (üst üste) */
#nobet .nb-scrs { grid-area:scr; display:grid; min-width:0; align-self:center; }
#nobet .nb-scr { grid-area:1 / 1; align-self:center; background:var(--nb-scrBg); border:1px solid var(--nb-scrLine); border-radius:20px; box-shadow:var(--shadow); padding:14px; min-width:0; position:relative;
  opacity:0; visibility:hidden; transform:translateY(12px) scale(.985); transition:opacity .4s ease, transform .4s ease, visibility 0s linear .4s; }
#nobet .nb-scr.nb-on { opacity:1; visibility:visible; transform:none; transition:opacity .4s ease .05s, transform .4s ease .05s, visibility 0s; }
#nobet .nb-scrh { display:flex; justify-content:space-between; align-items:center; gap:10px; font:700 12px/1.35 var(--nb-ff); color:var(--mute); margin-bottom:12px; min-width:0; }
#nobet .nb-scrh .nb-l { display:flex; align-items:center; gap:8px; min-width:0; }
#nobet .nb-scrh .nb-l > span:last-child { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#nobet .nb-scrh > .nb-mono { color:var(--ink); flex:none; }
#nobet .nb-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:40px; padding:0 16px; border-radius:11px; border:1px solid var(--line2); background:var(--card); color:var(--ink); font:700 14px/1 var(--nb-ff); cursor:default; white-space:nowrap; transition:background .3s, border-color .3s, color .3s; }
#nobet .nb-btn.nb-done { background:var(--ok); border-color:var(--ok); color:#fff; }
#nobet .nb-tag { font:700 11px/1.35 var(--nb-ff); padding:3px 8px; border-radius:999px; background:var(--midSoft); color:var(--nb-midInk); white-space:nowrap; transition:background .3s, color .3s; }
#nobet .nb-tag.nb-g { background:var(--okSoft); color:var(--nb-okInk); }
#nobet .nb-tag.nb-pt { background:var(--priSoft); color:var(--priInk); }
#nobet .nb-cap { margin-top:12px; font:700 14px/1.4 var(--nb-ff); min-height:20px; color:var(--ink); }
#nobet .nb-cap.nb-c { color:var(--nb-critInk); }
#nobet .nb-cap.nb-g { color:var(--nb-okInk); }

/* an · devir */
#nobet .nb-hrow { display:flex; align-items:center; gap:10px; padding:9px 12px; border:1px solid var(--line); border-radius:12px; background:var(--card2); margin-bottom:7px; min-width:0; }
#nobet .nb-hrow > b { font-size:13px; line-height:1.35; flex:none; }
#nobet .nb-hrow .nb-m { margin-left:auto; font:400 12.5px/1.35 var(--nb-ff); color:var(--mute); text-align:right; min-width:0; }
#nobet .nb-sealchip { display:inline-flex; align-items:center; gap:6px; font:700 11px/1.35 var(--nb-ff); color:var(--nb-okInk); }
#nobet .nb-sealchip svg.nb-i { width:13px; height:13px; }
#nobet .nb-take { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:12px; flex-wrap:wrap; }

/* an · portatif ölçüm (monitör gibi: sabit koyu) */
#nobet .nb-dev { background:#040a14; border:6px solid #1d2736; border-radius:18px; padding:12px; color:#e8eef7; box-shadow:inset 0 0 0 1px #22324b; }
html[data-theme="gece"] #nobet .nb-dev { border-color:#111a28; }
#nobet .nb-devh { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:12.5px; margin-bottom:10px; }
#nobet .nb-src { display:inline-flex; align-items:center; gap:6px; font:700 11.5px/1.35 var(--nb-ff); color:#7dd3e6; background:#0b2230; border:1px solid #154257; border-radius:8px; padding:3px 8px; }
#nobet .nb-src svg.nb-i { width:13px; height:13px; }
#nobet .nb-tiles { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; }
#nobet .nb-tile { border:1px solid #1c2c45; border-radius:12px; padding:8px 10px; background:#07101f; min-width:0; transition:border-color .3s; }
#nobet .nb-tile small { display:block; font:700 11px/1.35 var(--nb-ff); color:#8fa1ba; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#nobet .nb-tile b { display:block; font:700 25px/1.15 var(--nb-fm); color:var(--nb-vc); transition:opacity .3s; white-space:nowrap; }
#nobet .nb-tile b em { font-style:normal; font-size:12px; opacity:.75; margin-left:3px; }
#nobet .nb-tile:not(.nb-on) b { opacity:.22; }
#nobet .nb-tile.nb-on { border-color:#23405f; }
#nobet .nb-devf { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-top:10px; font:400 12px/1.4 var(--nb-ff); color:#8fa1ba; }
#nobet .nb-devf b { color:#e8eef7; }
#nobet .nb-okm { color:#86efac; font-weight:700; display:inline-flex; align-items:center; gap:6px; }
#nobet .nb-okm svg.nb-i { width:14px; height:14px; }

/* an · kabul */
#nobet .nb-from { display:flex; align-items:center; gap:8px; font:700 12.5px/1.35 var(--nb-ff); color:var(--mute); padding:8px 12px; border-radius:12px; border:1px dashed var(--line2); margin-bottom:8px; min-width:0; }
#nobet .nb-from > span:nth-child(2) { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
#nobet .nb-from .nb-tag { margin-left:auto; }
#nobet .nb-admbed { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--line); border-radius:12px; background:var(--card2); min-width:0; transition:border-color .35s, box-shadow .35s; }
#nobet .nb-admbed > b { font-size:14px; line-height:1.3; flex:none; }
#nobet .nb-admbed .nb-m { margin-left:auto; font:400 12px/1.35 var(--nb-ff); color:var(--mute); text-align:right; min-width:0; }
#nobet .nb-admbed.nb-occ { border-color:var(--pri); box-shadow:0 0 0 3px var(--priSoft); }
#nobet .nb-nums { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; margin-top:8px; }
#nobet .nb-num { border:1px solid var(--line); border-radius:12px; padding:8px 11px; background:var(--card); min-width:0; transition:opacity .3s, border-color .3s; }
#nobet .nb-num small { display:block; font:700 11px/1.35 var(--nb-ff); color:var(--mute); }
#nobet .nb-num b { display:block; font:700 17px/1.3 var(--nb-fm); color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#nobet .nb-num span { display:block; font:400 11px/1.35 var(--nb-ff); color:var(--mute); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#nobet .nb-num:not(.nb-on) { opacity:.3; }
#nobet .nb-num:not(.nb-on) b { color:transparent; }
#nobet .nb-num.nb-on { border-color:var(--pri); }
#nobet .nb-band { margin-top:10px; height:40px; border-radius:10px; background:var(--card2); border:1px solid var(--line); position:relative; overflow:hidden; }
#nobet .nb-bandin { position:absolute; inset:5px auto 5px 5px; width:0; border-radius:7px; background:#fff; border:1px solid #cbd3de; display:flex; align-items:center; gap:10px; padding:0 10px; overflow:hidden; white-space:nowrap; color:#152231; font:700 11.5px/1 var(--nb-fm); transition:width 1.1s ease; }
#nobet .nb-band.nb-pr .nb-bandin { width:calc(100% - 10px); }
#nobet .nb-bc { flex:none; width:64px; height:20px; background:repeating-linear-gradient(90deg, #152231 0 2px, transparent 2px 3px, #152231 3px 4px, transparent 4px 7px, #152231 7px 10px, transparent 10px 11px); }
#nobet .nb-bandl { position:absolute; left:12px; top:50%; transform:translateY(-50%); font:700 11.5px/1.3 var(--nb-ff); color:var(--mute); display:flex; align-items:center; gap:6px; }
#nobet .nb-bandl svg.nb-i { width:14px; height:14px; }
#nobet .nb-band.nb-pr .nb-bandl { opacity:0; }

/* an · yataklar + eskalasyon zinciri */
#nobet .nb-beds { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:8px; }
#nobet .nb-bed { background:var(--card2); border:1px solid var(--line); border-radius:12px; padding:8px 9px 7px; transition:border-color .4s, background .4s, box-shadow .4s; min-width:0; }
#nobet .nb-bed .nb-no { display:flex; justify-content:space-between; align-items:center; }
#nobet .nb-bed .nb-no b { font-size:11.5px; line-height:1.3; }
#nobet .nb-bed .nb-no i { width:7px; height:7px; border-radius:50%; background:#22c55e; transition:background .4s; }
#nobet .nb-bed svg { width:100%; height:22px; display:block; margin:4px 0 2px; }
#nobet .nb-bed polyline { fill:none; stroke:var(--nb-wave); stroke-width:1.6; vector-effect:non-scaling-stroke; opacity:.8; transition:stroke .4s; }
#nobet .nb-bed .nb-v { display:flex; justify-content:space-between; align-items:baseline; }
#nobet .nb-bed .nb-v small { font:700 9.5px/1.3 var(--nb-ff); color:var(--mute); }
#nobet .nb-bed .nb-v b { font-size:16px; line-height:1.25; color:var(--spo); transition:color .4s; }
#nobet .nb-bed.nb-warn { border-color:var(--mid); }
#nobet .nb-bed.nb-warn .nb-no i { background:var(--mid); }
#nobet .nb-bed.nb-warn polyline { stroke:var(--mid); }
#nobet .nb-bed.nb-crit { border-color:var(--crit); background:var(--critSoft); box-shadow:0 0 0 1px var(--crit), 0 0 22px rgba(239,68,68,.3); }
#nobet .nb-bed.nb-crit .nb-no i { background:var(--crit); }
#nobet .nb-bed.nb-crit polyline { stroke:var(--crit); }
#nobet .nb-bed.nb-crit .nb-v b { color:var(--nb-critInk); }
#nobet .nb-bed.nb-ok { border-color:var(--ok); }
#nobet .nb-bed.nb-ok .nb-v b { color:var(--nb-okInk); }
#nobet .nb-chain { display:flex; align-items:center; gap:6px; margin-top:12px; }
#nobet .nb-chain .nb-ln { flex:1; height:2px; min-width:8px; background:var(--line); border-radius:2px; }
#nobet .nb-st { display:flex; align-items:center; gap:8px; padding:6px 10px 6px 6px; border-radius:999px; border:1px solid var(--line); background:var(--card2); transition:all .35s; min-width:0; }
#nobet .nb-st .nb-ic { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; background:var(--line); color:var(--mute); transition:all .35s; flex:none; }
#nobet .nb-st .nb-ic svg.nb-i { width:14px; height:14px; }
#nobet .nb-st b { font:700 12px/1.3 var(--nb-ff); color:var(--mute); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#nobet .nb-st.nb-on { border-color:var(--crit); background:var(--critSoft); }
#nobet .nb-st.nb-on .nb-ic { background:var(--crit); color:#fff; box-shadow:0 0 0 5px rgba(239,68,68,.18); }
#nobet .nb-st.nb-on b { color:var(--nb-critInk); }
#nobet .nb-st.nb-done { border-color:var(--ok); }
#nobet .nb-st.nb-done .nb-ic { background:var(--ok); color:#fff; }
#nobet .nb-st.nb-done b { color:var(--nb-okInk); }

/* an · görev ızgarası */
#nobet .nb-tg { display:grid; grid-template-columns:58px repeat(6, minmax(0, 1fr)); gap:5px; }
#nobet .nb-tg .nb-hh { font:700 11px/1.3 var(--nb-fm); color:var(--mute); text-align:center; padding:2px 0 4px; border-radius:6px; }
#nobet .nb-tg .nb-hh.nb-now { background:var(--pri); color:var(--onpri); }
#nobet .nb-tg .nb-bn { font:700 11.5px/1.3 var(--nb-fm); display:flex; align-items:center; min-width:0; }
#nobet .nb-cell { height:34px; border-radius:8px; border:1px dashed var(--line); display:flex; align-items:center; justify-content:center; gap:4px; font:700 10.5px/1.2 var(--nb-ff); color:var(--mute); min-width:0; overflow:hidden; transition:all .3s; }
#nobet .nb-cell svg.nb-i { width:13px; height:13px; display:none; }
#nobet .nb-cell span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#nobet .nb-cell.nb-up { border-style:solid; background:var(--card2); }
#nobet .nb-cell.nb-dn { border:1px solid transparent; background:var(--okSoft); color:var(--nb-okInk); }
#nobet .nb-cell.nb-nw { border:1px solid var(--pri); background:var(--priSoft); color:var(--priInk); box-shadow:0 0 0 3px var(--priSoft); }
#nobet .nb-cell.nb-lt { border:1px solid var(--crit); background:var(--critSoft); color:var(--nb-critInk); }
#nobet .nb-tgf { display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-top:12px; font:400 12px/1.4 var(--nb-ff); color:var(--mute); }
#nobet .nb-tgf i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; vertical-align:-1px; }
#nobet .nb-tgf .nb-sum { margin-left:auto; font-weight:700; color:var(--ink); }

/* an · hızlı yanıt */
#nobet .nb-rrc { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--line); border-radius:12px; background:var(--card2); min-width:0; transition:border-color .35s, background .35s, box-shadow .35s; }
#nobet .nb-rrc > b { font-size:15px; line-height:1.3; flex:none; }
#nobet .nb-rrc .nb-m { font:400 12.5px/1.35 var(--nb-ff); color:var(--mute); min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#nobet .nb-rrc .nb-tag { margin-left:auto; }
#nobet .nb-rrc.nb-on { border-color:var(--crit); background:var(--critSoft); box-shadow:0 0 0 1px var(--crit); }
#nobet .nb-rrc.nb-on .nb-tag { background:var(--crit); color:#fff; }
#nobet .nb-rrc.nb-ok { border-color:var(--ok); }
#nobet .nb-rrby { font:400 12px/1.4 var(--nb-ff); color:var(--mute); margin:6px 2px 0; }
#nobet .nb-rrs { list-style:none; display:flex; flex-direction:column; gap:6px; margin-top:10px; }
#nobet .nb-rrs li { display:grid; grid-template-columns:28px minmax(0, 1fr) auto; align-items:center; gap:10px; padding:7px 10px 7px 7px; border:1px solid var(--line); border-radius:12px; background:var(--card); transition:border-color .3s, opacity .3s; }
#nobet .nb-rrs li .nb-ic { width:28px; height:28px; border-radius:50%; display:grid; place-items:center; background:var(--line); color:var(--mute); transition:all .3s; }
#nobet .nb-rrs li .nb-ic svg.nb-i { width:14px; height:14px; }
#nobet .nb-rrs li b { font:700 13.5px/1.3 var(--nb-ff); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#nobet .nb-rrs li .nb-mono { font-size:13px; font-weight:700; color:var(--mute); }
#nobet .nb-rrs li:not(.nb-on) { opacity:.4; }
#nobet .nb-rrs li:not(.nb-on) .nb-mono { color:transparent; }
#nobet .nb-rrs li.nb-on { border-color:var(--ok); }
#nobet .nb-rrs li.nb-on .nb-ic { background:var(--ok); color:#fff; }
#nobet .nb-rrs li.nb-on .nb-mono { color:var(--ink); }
#nobet .nb-rrs li.nb-c { border-color:var(--crit); }
#nobet .nb-rrs li.nb-c .nb-ic { background:var(--crit); }
#nobet .nb-rrf { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:10px; padding-top:10px; border-top:1px solid var(--line); }
#nobet .nb-rrf .nb-tot b { font:700 22px/1.2 var(--nb-fm); margin-left:6px; }

/* an · skor */
#nobet .nb-sof { display:flex; flex-direction:column; gap:5px; }
#nobet .nb-sr { display:grid; grid-template-columns:minmax(0, 1fr) auto 40px; align-items:center; gap:10px; padding:7px 10px; border-radius:10px; background:var(--card2); border:1px solid var(--line); transition:opacity .3s; }
#nobet .nb-sr b { font:700 13.5px/1.3 var(--nb-ff); min-width:0; overflow-wrap:break-word; }
#nobet .nb-sr .nb-s { font:600 11px/1.35 var(--nb-ff); color:var(--mute); background:var(--card); border:1px solid var(--line); border-radius:7px; padding:2px 7px; white-space:nowrap; }
#nobet .nb-sr .nb-n { font:700 18px/1.3 var(--nb-fm); text-align:center; border-radius:8px; background:var(--card); border:1px solid var(--line); }
#nobet .nb-sr:not(.nb-on) { opacity:.35; }
#nobet .nb-sr:not(.nb-on) .nb-n { color:transparent; }
#nobet .nb-soft { display:flex; align-items:center; gap:10px; margin-top:10px; padding-top:10px; border-top:1px solid var(--line); flex-wrap:wrap; }
#nobet .nb-tot { font:700 13px/1.3 var(--nb-ff); }
#nobet .nb-tot b { font:700 22px/1.2 var(--nb-fm); margin-left:6px; }
#nobet .nb-state { margin-left:auto; display:inline-flex; align-items:center; gap:6px; font:700 12px/1.35 var(--nb-ff); padding:6px 10px; border-radius:999px; background:var(--midSoft); color:var(--nb-midInk); }
#nobet .nb-state.nb-ok { background:var(--okSoft); color:var(--nb-okInk); }
#nobet .nb-state svg.nb-i { width:14px; height:14px; }

/* an · mühür */
#nobet .nb-doc { overflow:hidden; }
#nobet .nb-stats { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
#nobet .nb-stats span { font:700 12px/1.35 var(--nb-ff); padding:5px 9px; border-radius:8px; background:var(--card2); border:1px solid var(--line); }
#nobet .nb-dl { font:400 13px/1.45 var(--nb-ff); padding:7px 0; border-bottom:1px dashed var(--line); display:flex; gap:8px; }
#nobet .nb-dl svg.nb-i { width:15px; height:15px; color:var(--pri); margin-top:2px; }
#nobet .nb-dl:last-of-type { border-bottom:0; }
#nobet .nb-seal { display:flex; align-items:center; gap:10px; margin-top:10px; flex-wrap:wrap; }
#nobet .nb-seal .nb-who { font:400 12px/1.4 var(--nb-ff); color:var(--mute); flex:1; min-width:0; padding-right:150px; }
#nobet .nb-stamp { position:absolute; right:16px; bottom:14px; transform:rotate(-8deg) scale(1.6); opacity:0; border:3px solid var(--ok); color:var(--nb-okInk); border-radius:12px; padding:8px 14px; font:700 14px/1.3 var(--nb-fd); text-align:center; background:color-mix(in srgb, var(--card) 88%, transparent); transition:transform .35s cubic-bezier(.2,1.4,.4,1), opacity .25s; pointer-events:none; }
#nobet .nb-stamp small { display:block; font:700 11px/1.3 var(--nb-fm); }
#nobet .nb-doc.nb-sealed .nb-stamp { opacity:1; transform:rotate(-8deg) scale(1); }
#nobet .nb-doc.nb-sealed .nb-sealbtn { background:var(--ok); border-color:var(--ok); color:#fff; }

/* ---------- zaman çizelgesi ---------- */
#nobet .nb-tl { grid-area:tl; position:relative; padding:22px 0 0; cursor:pointer; touch-action:pan-y; user-select:none; -webkit-user-select:none; border-radius:12px; min-width:0; }
#nobet .nb-hrs { position:absolute; left:0; right:0; top:0; height:16px; }
#nobet .nb-hrs span { position:absolute; top:0; transform:translateX(-50%); font:700 11px/1.3 var(--nb-fm); color:var(--mute); white-space:nowrap; }
#nobet .nb-hrs span:first-child { transform:none; }
#nobet .nb-hrs span:last-child { transform:translateX(-100%); }
#nobet .nb-trk { position:relative; height:10px; border-radius:999px; background:linear-gradient(90deg, #f6c46f 0%, #a9dcef 7%, #8fd0ea 38%, #f3b25b 49%, #6d7fb8 55%, #1d2f5c 61%, #1d2f5c 89%, #7c8fc4 95%, #f6c46f 100%); }
#nobet .nb-sky { position:absolute; left:0; right:0; top:1px; height:15px; pointer-events:none; }
#nobet .nb-sky span { position:absolute; top:0; transform:translateX(-50%); display:grid; place-items:center; }
#nobet .nb-sky svg.nb-i { width:14px; height:14px; }
#nobet .nb-sun { color:#d99a1e; } #nobet .nb-moon { color:var(--priInk); }
#nobet .nb-fut { position:absolute; top:0; bottom:0; right:0; border-radius:0 999px 999px 0; background:var(--card); opacity:.62; }
#nobet .nb-tk { position:absolute; top:50%; width:12px; height:12px; margin:-6px 0 0 -6px; border-radius:50%; background:var(--card); border:2px solid var(--line2); transition:border-color .3s, background .3s, transform .3s; }
#nobet .nb-tk.nb-past { border-color:var(--ok); background:var(--ok); }
#nobet .nb-tk.nb-on { border-color:var(--pri); background:var(--pri); transform:scale(1.25); }
#nobet .nb-knob { position:absolute; top:50%; left:0; width:22px; height:22px; margin:-11px 0 0 -11px; border-radius:50%; background:var(--card); border:4px solid var(--pri); box-shadow:0 2px 10px rgba(0,0,0,.25); pointer-events:none; }
#nobet .nb-act { position:relative; height:18px; margin-top:8px; }
#nobet .nb-act > div { position:absolute; inset:0; }
#nobet .nb-act i { position:absolute; bottom:0; width:2px; margin-left:-1px; border-radius:2px; }
#nobet .nb-act i.nb-cr { height:6px; } #nobet .nb-act i.nb-ct { height:10px; } #nobet .nb-act i.nb-ca { height:17px; width:3px; } #nobet .nb-act i.nb-ck { height:17px; width:3px; }
#nobet .nb-actA { opacity:.25; }
#nobet .nb-actB { clip-path:inset(0 100% 0 0); }

/* ---------- an düğmeleri ---------- */
#nobet .nb-chips { grid-area:chips; display:grid; grid-template-columns:repeat(9, minmax(0, 1fr)); gap:6px; }
#nobet .nb-chips button { position:relative; display:flex; flex-direction:column; align-items:flex-start; gap:1px; min-width:0; padding:7px 10px 9px; border-radius:11px; border:1px solid var(--line); background:var(--card2); cursor:pointer; text-align:left; overflow:hidden; color:var(--mute); transition:border-color .25s, background .25s, color .25s; }
#nobet .nb-chips button:hover { border-color:var(--line2); color:var(--ink); }
#nobet .nb-chips .nb-cht { display:flex; align-items:center; gap:5px; font:700 11.5px/1.3 var(--nb-fm); }
#nobet .nb-chips .nb-cht svg.nb-i { width:11px; height:11px; opacity:0; }
#nobet .nb-chips .nb-chl { font:700 12.5px/1.3 var(--nb-ff); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
#nobet .nb-chips button::after { content:""; position:absolute; left:0; bottom:0; height:3px; width:calc(var(--p, 0) * 100%); background:var(--pri); }
#nobet .nb-chips button.nb-past { color:var(--ink); }
#nobet .nb-chips button.nb-past .nb-cht svg.nb-i { opacity:1; color:var(--ok); }
#nobet .nb-chips button.nb-on { border-color:var(--pri); background:var(--priSoft); color:var(--priInk); }

/* ---------- hareket azaltılmış: oynatıcı yok, durağan seçici ---------- */
#nobet .nb.nb-rm .nb-ctl { display:none; }
#nobet .nb.nb-rm .nb-again { display:none; }

/* ---------- orta genişlik: saat paneli üstte yatay ---------- */
@media (max-width:1180px) {
  #nobet .nb-stage { grid-template-columns:minmax(0, .95fr) minmax(0, 1.05fr); grid-template-areas:"clk clk" "tx scr" "tl tl" "chips chips"; column-gap:28px; }
  #nobet .nb-clk { display:grid; grid-template-columns:auto auto minmax(0, 1fr); grid-template-areas:"top top cnt" "clock ctl cnt" "left left cnt"; column-gap:22px; align-items:center; padding:12px 16px; }
  #nobet .nb-rltop { grid-area:top; }
  #nobet .nb-clock { grid-area:clock; font-size:44px; margin:2px 0; }
  #nobet .nb-left { grid-area:left; }
  #nobet .nb-ctl { grid-area:ctl; margin:0; }
  #nobet .nb-cnt { grid-area:cnt; margin:0; padding:0 0 0 18px; border-top:0; border-left:1px solid var(--line); align-self:stretch; display:flex; flex-direction:column; justify-content:center; }
  #nobet .nb-log { display:none; }
  #nobet .nb-chips { grid-template-columns:repeat(5, minmax(0, 1fr)); }
}
/* ---------- telefon: alt alta ---------- */
@media (max-width:760px) {
  #nobet .nb-stage { grid-template-columns:minmax(0, 1fr); grid-template-areas:"clk" "tl" "tx" "scr" "chips"; padding:14px 12px 14px; border-radius:18px; row-gap:16px; }
  #nobet .nb-clk { grid-template-columns:auto minmax(0, 1fr); grid-template-areas:"top top" "clock ctl" "left left" "cnt cnt"; column-gap:12px; padding:12px; }
  #nobet .nb-clock { font-size:40px; }
  #nobet .nb-ctl { justify-self:end; }
  #nobet .nb-cnt { border-left:0; padding:10px 0 0; margin-top:10px; border-top:1px solid var(--line); }
  #nobet .nb-cnt h4 { display:none; }
  #nobet .nb-cn b { font-size:17px; }
  #nobet .nb-tl { padding-top:20px; margin:0 6px; }
  #nobet .nb-hrs span:nth-child(even) { display:none; }
  #nobet .nb-h { font-size:23px; }
  #nobet .nb-p { font-size:15px; }
  #nobet .nb-scr { padding:12px; border-radius:16px; }
  #nobet .nb-chips { grid-template-columns:repeat(3, minmax(0, 1fr)); }
  #nobet .nb-chips button { padding:6px 8px 8px; }
  #nobet .nb-chips .nb-chl { font-size:11.5px; }
  #nobet .nb-chain { flex-direction:column; align-items:stretch; }
  #nobet .nb-chain .nb-ln { width:2px; min-width:0; height:6px; flex:none; margin-left:18px; }
  #nobet .nb-tiles { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  #nobet .nb-tile b { font-size:21px; }
  #nobet .nb-tg { grid-template-columns:44px repeat(6, minmax(0, 1fr)); gap:4px; }
  #nobet .nb-tg .nb-hh { font-size:9.5px; }
  #nobet .nb-tg .nb-bn { font-size:10px; }
  #nobet .nb-cell { height:30px; }
  #nobet .nb-cell span { display:none; }
  #nobet .nb-cell svg.nb-i { display:block; }
  #nobet .nb-tgf .nb-sum { margin-left:0; }
  #nobet .nb-sr { grid-template-columns:minmax(0, 1fr) auto 34px; gap:6px; padding:6px 8px; }
  #nobet .nb-sr b { font-size:12.5px; }
  #nobet .nb-sr .nb-s { font-size:10px; padding:2px 5px; }
  #nobet .nb-sr .nb-n { font-size:16px; }
  #nobet .nb-mt, #nobet .nb-scr { align-self:start; }
  #nobet .nb-state { margin-left:0; }
  #nobet .nb-doc { padding-bottom:70px; }
  #nobet .nb-stats { gap:4px; }
  #nobet .nb-stats span { font-size:11px; padding:3px 7px; }
  #nobet .nb-dl { font-size:12.5px; padding:6px 0; }
  #nobet .nb-seal .nb-who { padding-right:0; }
  #nobet .nb-stamp { bottom:14px; right:14px; }
  #nobet .nb-beds { gap:6px; }
  #nobet .nb-bed { padding:6px 7px; }
  #nobet .nb-bed svg { display:none; }
  #nobet .nb-bed .nb-no b { font-size:10.5px; }
  #nobet .nb-bed .nb-v b { font-size:15px; }
  #nobet .nb-bed .nb-v small { font-size:8.5px; }
  #nobet .nb-hrow { flex-wrap:wrap; }
  #nobet .nb-nums { grid-template-columns:minmax(0, 1fr); }
  #nobet .nb-num b { font-size:15px; }
}
@media (prefers-reduced-motion:reduce) {
  #nobet .nb *, #nobet .nb *::before, #nobet .nb *::after { animation:none !important; transition:none !important; }
}
`;
  if (!document.getElementById("nobet-css")) {
    var st = document.createElement("style"); st.id = "nobet-css"; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- sözlük: [AZ, TR, RU, EN] — TR asıl; a3.html'den gelen cümleler korunarak 24 saate uyarlandı (24.09) ----------
     "Nöbet / növbə / смена / shift" bölümün kavramı DEĞİL (Ozan 24.09: yoğun bakım 7/24 çalışır, ürün bir nöbet aracı değil).
     Devir anları "devir / təhvil / передача / handover" der. */
  var T = {
    rail_lbl:["Böyüklər reanimasiyası · 24 saat", "Erişkin yoğun bakım · 24 saat", "Реанимация (взрослые) · 24 часа", "Adult ICU · 24 hours"],
    day:["Gündüz", "Gündüz", "День", "Day"], night:["Gecə", "Gece", "Ночь", "Night"], nx:["Növbəti", "Sıradaki", "Далее", "Next"],
    unitLive:["Reanimasiya · 8 çarpayı · canlı", "Erişkin yoğun bakım · 8 yatak · canlı", "Реанимация · 8 коек · в эфире", "Adult ICU · 8 beds · live"],
    u_m:["dəq", "dk", "мин", "min"], u_pm:["/dəq", "/dk", "/мин", "/min"],
    /* oynatıcı */
    play:["Başlat", "Oynat", "Воспроизвести", "Play"], pause:["Dayandır", "Duraklat", "Пауза", "Pause"],
    spd:["Sürət", "Hız", "Скорость", "Speed"],
    tl:["24 saatlıq zaman xətti", "24 saatlik zaman çizelgesi", "Шкала 24 часов", "24-hour timeline"],
    moms:["Günün anları", "Günün anları", "Моменты суток", "Moments of the day"],
    cn_h:["08:00-dan bəri qeydə alınanlar", "08:00'den beri kayda geçenler", "Записано с 08:00", "Recorded since 08:00"],
    cn_r:["Ölçmə", "Ölçüm", "Измерения", "Readings"], cn_t:["Bağlanan iş", "Kapanan iş", "Закрыто задач", "Tasks closed"], cn_a:["Siqnal", "Alarm", "Тревоги", "Alerts"],
    again:["Yenidən izlə", "Baştan izle", "Смотреть снова", "Watch again"],
    /* akış satırları */
    ev_r:["ölçmə · monitor", "ölçüm · monitör", "измерение · монитор", "reading · monitor"],
    ev_rp:["ölçmə · portativ cihaz", "ölçüm · portatif cihaz", "измерение · портативный прибор", "reading · portable device"],
    ev_pos:["mövqe dəyişdirildi", "pozisyon verildi", "положение изменено", "turned"],
    ev_care:["qulluq edildi", "bakım yapıldı", "уход выполнен", "care done"],
    ev_a1:["nəbz həddi · tibb bacısı 1 dəq-də cavab verdi", "nabız eşiği · hemşire 1 dk'da yanıtladı", "порог пульса · медсестра ответила за 1 мин", "pulse threshold · nurse responded in 1 min"],
    ev_a2:["SpO₂ həddi · həkimə qədər eskalasiya", "SpO₂ eşiği · hekime kadar eskalasyon", "порог SpO₂ · эскалация до врача", "SpO₂ threshold · escalated to the physician"],
    ev_a3:["təcili cavab komandası çağırıldı", "hızlı yanıt ekibi çağrıldı", "вызвана бригада быстрого реагирования", "rapid response team called"],
    ev_k:["təcili yardımdan qəbul", "acil servisten kabul", "поступление из приёмного отделения", "admitted from the ED"],
    ev_band:["qol bandı çap olundu", "kol bandı basıldı", "браслет напечатан", "wristband printed"],
    ev_h1:["səhər təhvili qəbul edildi", "sabah devri alındı", "утренняя передача принята", "morning handover taken over"],
    ev_h2:["axşam təhvili qəbul edildi", "akşam devri alındı", "вечерняя передача принята", "evening handover taken over"],
    ev_x2:["gündəlik SOFA təsdiqləndi", "günlük SOFA onaylandı", "суточная SOFA подтверждена", "daily SOFA confirmed"],
    ev_x3:["təhvil qeydi möhürləndi", "teslim notu mühürlendi", "записка передачи скреплена", "handover note sealed"],
    /* an düğmeleri (kısa) */
    c_mh:["Səhər təhvili", "Sabah devri", "Утренняя передача", "Morning handover"], c_m5:["Vizit · SOFA", "Vizit · SOFA", "Обход · SOFA", "Rounds · SOFA"],
    c_ma:["Yeni qəbul", "Yeni kabul", "Поступление", "New admission"], c_m2:["Portativ ölçmə", "Portatif ölçüm", "Портативное измерение", "Portable reading"],
    c_mr:["Təcili cavab", "Hızlı yanıt", "Быстрое реагирование", "Rapid response"], c_m1:["Axşam təhvili", "Akşam devri", "Вечерняя передача", "Evening handover"],
    c_m3:["SpO₂ düşür", "SpO₂ düşüyor", "Падение SpO₂", "SpO₂ falls"], c_m4:["Tapşırıqlar", "Görevler", "Задачи", "Tasks"], c_m6:["Möhür", "Mühür", "Скрепление", "Seal"],

    /* devir (sabah ve akşam) */
    mht:["Səhər təhvili: gecə → gündüz", "Sabah devri: gece → gündüz", "Утренняя передача: ночь → день", "Morning handover: night → day"],
    mhp:["Gecə komandasının möhürlənmiş təhvil qeydi, açıq işlər və diqqət tələb edən çarpayılar bir siyahıdadır. Gündüz komandası oxuyur və «Təhvil aldım» düyməsini basır.",
         "Gece ekibinin mühürlü teslim notu, açık işler ve dikkat isteyen yataklar tek listede. Gündüz ekibi okur ve «Devraldım» der.",
         "Скреплённая записка ночной команды, открытые задачи и койки, требующие внимания, — в одном списке. Дневная команда читает её и нажимает «Принял(а)».",
         "The night team's sealed handover note, open tasks and the beds that need attention sit in one list. The day team reads it and taps “Taken over”."],
    mhb1:["Kimin təhvil aldığı saatı ilə qeydə alınır", "Kim devraldı, saatiyle kayda geçer", "Кто принял — записывается со временем", "Who took over is logged with the time"],
    mhb2:["Açıq işlər itmir, təhvil alan komandaya keçir", "Açık işler kaybolmaz, devralan ekibe geçer", "Открытые задачи не теряются — переходят к принимающей команде", "Open tasks carry over to the team taking over"],
    m1t:["Axşam təhvili: gündüz → gecə", "Akşam devri: gündüz → gece", "Вечерняя передача: день → ночь", "Evening handover: day → night"],
    m1p:["Gündüz komandasının möhürlənmiş təhvil qeydi, açıq işlər və diqqət tələb edən çarpayılar bir siyahıdadır. Gecə komandası oxuyur və «Təhvil aldım» düyməsini basır.",
         "Gündüz ekibinin mühürlü teslim notu, açık işler ve dikkat isteyen yataklar tek listede. Gece ekibi okur ve «Devraldım» der.",
         "Скреплённая записка дневной команды, открытые задачи и койки, требующие внимания, — в одном списке. Ночная команда читает её и нажимает «Принял(а)».",
         "The day team's sealed handover note, open tasks and the beds that need attention sit in one list. The night team reads it and taps “Taken over”."],
    m1b1:["Gün ərzində gələn xəstə siyahıya özü düşür", "Gün içinde gelen hasta listeye kendiliğinden girer", "Поступивший за день пациент сам попадает в список", "A patient admitted during the day joins the list by itself"],
    m1b2:["Kimin təhvil aldığı saatı ilə qeydə alınır", "Kim devraldı, saatiyle kayda geçer", "Кто принял — записывается со временем", "Who took over is logged with the time"],
    s1h:["Təhvil · Reanimasiya", "Devir · Yoğun bakım", "Передача · Реанимация", "Handover · ICU"],
    s1sM:["Gecə → Gündüz", "Gece → Gündüz", "Ночь → День", "Night → Day"], s1sE:["Gündüz → Gecə", "Gündüz → Gece", "День → Ночь", "Day → Night"],
    attn:["Diqqət", "Dikkat", "Внимание", "Attention"],
    calmT:["Sabit", "Sakin", "Стабильно", "Calm"],
    open2:["2 açıq iş", "2 açık iş", "2 открытые задачи", "2 open tasks"],
    open1:["1 açıq iş", "1 açık iş", "1 открытая задача", "1 open task"],
    last:["Son ölçmə", "Son ölçüm", "Посл. измерение", "Last reading"],
    calm4:["4 çarpayı · sabit", "4 yatak · sakin", "4 койки · стабильно", "4 beds · calm"],
    bed_free:["Boş · təmiz", "Boş · temiz", "Свободна · убрана", "Empty · clean"],
    bed_ready:["Qəbula hazır", "Kabule hazır", "Готова к приёму", "Ready for admission"],
    bed_new:["Yeni qəbul", "Yeni kabul", "Новое поступление", "New admission"],
    bed_newAt:["11:00 · təcili yardımdan", "11:00 · acil servisten", "11:00 · из приёмного", "11:00 · from the ED"],
    sealed:["Möhürlü qeyd", "Mühürlü not", "Скреплённая записка", "Sealed note"],
    took:["Təhvil aldım", "Devraldım", "Принял(а)", "Taken over"],
    tookM:["Təhvil alındı · 08:02", "Devralındı · 08:02", "Принято · 08:02", "Taken over · 08:02"],
    tookE:["Təhvil alındı · 20:02", "Devralındı · 20:02", "Принято · 20:02", "Taken over · 20:02"],
    /* vizit · skor */
    m5t:["Vizit: şkala dolub, həkim təsdiqləyir", "Vizit: skor dolmuş, hekim onaylar", "Обход: шкала заполнена, врач подтверждает", "Rounds: the score is filled in, the physician confirms"],
    m5p:["Səhər vizitinə gündəlik SOFA hazırdır: sistem onu gecə gələn laboratoriya və monitor məlumatından doldurub. Hər sətrin yanında hansı nəticədən gəldiyi yazılıb. Həkim baxır, lazım olsa düzəldir və təsdiqləyir.",
         "Sabah vizitinde günlük SOFA hazır: sistem onu gece gelen laboratuvar ve monitör verisinden doldurmuştur. Her satırın yanında hangi sonuçtan geldiği yazar. Hekim bakar, gerekirse düzeltir ve onaylar.",
         "К утреннему обходу суточная SOFA готова: система заполнила её по ночным анализам и данным мониторов. У каждой строки указано, из какого результата она взята. Врач проверяет, при необходимости исправляет и подтверждает.",
         "By the morning round the daily SOFA is ready: the system filled it in from overnight lab and monitor data. Each line shows which result it came from. The physician reviews it, corrects it if needed, and confirms."],
    m5b1:["Təsdiqlənməmiş şkala qaralama kimi görünür", "Onaylanmamış skor taslak olarak görünür", "Неподтверждённая шкала помечена как черновик", "An unconfirmed score is marked as a draft"],
    m5b2:["Qərarı həkim verir", "Kararı hekim verir", "Решение за врачом", "The physician decides"],
    s5h:["gündəlik SOFA", "günlük SOFA", "суточная SOFA", "daily SOFA"],
    so_resp:["Tənəffüs", "Solunum", "Дыхание", "Respiratory"], so_coag:["Laxtalanma", "Pıhtılaşma", "Коагуляция", "Coagulation"], so_liver:["Qaraciyər", "Karaciğer", "Печень", "Liver"],
    so_cv:["Ürək-damar", "Kardiyovasküler", "Сердечно-сосуд.", "Cardiovascular"], so_cns:["Nevroloji", "Nörolojik", "Неврология", "Neurological"], so_renal:["Böyrək", "Böbrek", "Почки", "Renal"],
    src_abg:["Qan qazı", "Kan gazı", "Газы крови", "Blood gas"], src_cbc:["Qan analizi", "Hemogram", "ОАК", "Blood count"], src_chem:["Biokimya", "Biyokimya", "Биохимия", "Chemistry"],
    src_mon:["Monitor", "Monitör", "Монитор", "Monitor"], src_nn:["Tibb bacısı qeydi", "Hemşire notu", "Запись медсестры", "Nursing note"],
    total:["Cəmi", "Toplam", "Итого", "Total"],
    st_draft:["Sistem doldurdu · həkim təsdiqi gözlənilir", "Sistem doldurdu · hekim onayı bekliyor", "Заполнено системой · ждёт подтверждения врача", "System-filled · awaiting physician sign-off"],
    st_fill:["Sistem doldurur…", "Sistem dolduruyor…", "Система заполняет…", "System filling in…"],
    st_ok:["Həkim təsdiqlədi · 09:34", "Hekim onayladı · 09:34", "Врач подтвердил · 09:34", "Confirmed by physician · 09:34"],
    /* acil servisten kabul */
    mat:["Təcili yardımdan yeni xəstə", "Acil servisten yeni hasta", "Новый пациент из приёмного отделения", "A new admission from the emergency department"],
    map:["Saat 11:00-da təcili yardımdan xəstə gəlir. Qəbul açılanda iki nömrə yaranır: şəxsə aid xəstə nömrəsi və bu hospitalizasiyaya aid protokol nömrəsi. Qol bandı bu nömrələrlə çap olunur; REA08 «boş · təmiz» vəziyyətindən «dolu» vəziyyətinə keçir.",
         "Saat 11:00'de acil servisten bir hasta gelir. Kabul açılınca iki numara oluşur: kişiye ait hasta no ve bu yatışa ait protokol no. Kol bandı bu numaralarla basılır; REA08 «boş · temiz» durumundan «dolu»ya geçer.",
         "В 11:00 из приёмного отделения поступает пациент. При оформлении создаются два номера: номер пациента, закреплённый за человеком, и номер протокола этой госпитализации. Браслет печатается с этими номерами; REA08 из «свободна · убрана» становится «занята».",
         "At 11:00 a patient comes up from the emergency department. Opening the admission creates two numbers: a patient number that belongs to the person and a protocol number that belongs to this stay. The wristband is printed with both; REA08 goes from “empty · clean” to “occupied”."],
    mab1:["Xəstə nömrəsi şəxsə aiddir, növbəti hospitalizasiyalarda da dəyişmir", "Hasta no kişiye aittir, sonraki yatışlarda da aynı kalır", "Номер пациента закреплён за человеком и не меняется при следующих госпитализациях", "The patient number stays with the person across future stays"],
    mab2:["Çarpayının yeni vəziyyəti bölmə ekranında dərhal görünür", "Yatağın yeni durumu birim ekranında hemen görünür", "Новый статус койки сразу виден на экране отделения", "The bed's new status shows on the unit screen at once"],
    s_adm:["Qəbul · Reanimasiya", "Kabul · Yoğun bakım", "Приём · Реанимация", "Admission · ICU"],
    adm_from:["Haradan: Təcili Yardım", "Geliş: Acil Servis", "Откуда: приёмное отделение", "From: Emergency Department"],
    adm_way:["yoldadır", "yolda", "в пути", "on the way"], adm_here:["gəldi", "geldi", "прибыл", "arrived"],
    bed_occ:["Dolu", "Dolu", "Занята", "Occupied"], bed_sub:["Böyüklər reanimasiyası", "Erişkin yoğun bakım", "Реанимация (взрослые)", "Adult ICU"],
    n_hn:["Xəstə no", "Hasta no", "№ пациента", "Patient no"], n_hn_s:["Şəxsə aid", "Kişiye ait", "Закреплён за человеком", "Belongs to the person"],
    n_pr:["Protokol", "Protokol", "Протокол", "Protocol"], n_pr_s:["Bu hospitalizasiyaya aid", "Bu yatışa ait", "Эта госпитализация", "Belongs to this stay"],
    band:["Qol bandı", "Kol bandı", "Браслет пациента", "Wristband"],
    adm_c0:["Təcili yardımdan xəstə gəlir · REA08 hazırdır", "Acil servisten hasta geliyor · REA08 hazır", "Из приёмного отделения везут пациента · REA08 готова", "A patient is on the way from the ED · REA08 is ready"],
    adm_c1:["Qəbul açıldı · 11:01", "Kabul açıldı · 11:01", "Поступление оформлено · 11:01", "Admission opened · 11:01"],
    adm_c2:["Qol bandı çap olunur…", "Kol bandı basılıyor…", "Печать браслета…", "Printing the wristband…"],
    adm_c3:["Qol bandı çap olundu · 11:04", "Kol bandı basıldı · 11:04", "Браслет напечатан · 11:04", "Wristband printed · 11:04"],
    /* serviste portatif ölçüm */
    m2t:["Servisdə portativ cihazla ölçmə", "Serviste portatif cihazla ölçüm", "Измерение портативным прибором в отделении", "A portable-device reading on the ward"],
    m2p:["Monitora qoşulmayan servis çarpayısında tibb bacısı portativ cihazla ölçür. Dəyərlər əl ilə köçürülmür; cihazın adı və ölçmə saatı ilə birlikdə qeydə düşür.",
         "Monitöre bağlı olmayan servis yatağında hemşire portatif cihazla ölçer. Değerler elle yazılmaz; cihazın adı ve ölçüm saatiyle birlikte kayda düşer.",
         "На койке отделения без монитора медсестра измеряет портативным прибором. Значения не переписываются вручную — они попадают в карту вместе с названием прибора и временем.",
         "On a ward bed with no monitor, the nurse measures with a portable device. Nothing is typed in by hand; the values land in the record with the device name and the time."],
    m2b1:["Hər dəyərin yanında mənbəyi: monitor, portativ cihaz və ya əl ilə", "Her değerin yanında kaynağı: monitör, portatif cihaz ya da elle", "У каждого значения — источник: монитор, портативный прибор или вручную", "Every value shows its source: monitor, portable device or manual"],
    m2b2:["Növbəti ölçmənin vaxtı kartda görünür", "Sıradaki ölçümün saati kartta görünür", "Время следующего измерения видно на карточке", "The time of the next reading shows on the card"],
    s2h:["çarpayı başında ölçmə", "yatak başı ölçüm", "измерение у койки", "bedside reading"],
    s2src:["Portativ cihaz", "Portatif cihaz", "Портативный прибор", "Portable device"],
    v_hr:["Nəbz", "Nabız", "Пульс", "Pulse"], v_bp:["AT", "TA", "АД", "BP"], v_t:["Hərarət", "Ateş", "Темп.", "Temp."], v_rr:["Tənəffüs", "Solunum", "ЧДД", "Resp."], v_pain:["Ağrı", "Ağrı", "Боль", "Pain"],
    s2wait:["Ölçülür…", "Ölçülüyor…", "Измерение…", "Measuring…"],
    s2ok:["Qeydə alındı · 14:00", "Kayda geçti · 14:00", "Записано · 14:00", "Recorded · 14:00"],
    s2next:["Növbəti ölçmə", "Sonraki ölçüm", "Следующее", "Next reading"],
    /* serviste hızlı yanıt */
    mrt:["Servisdə təcili cavab çağırışı", "Serviste hızlı yanıt çağrısı", "Вызов бригады быстрого реагирования в отделение", "A rapid response call on the ward"],
    mrp:["16:40-da Daxili Xəstəliklər Servisindəki tibb bacısı DAX05 üçün təcili cavab komandasını çağırır. Çağırış komandanın ekranına düşür; komanda «Yoldayam» və «Yanındayam» deyir. Çağırış vaxtı, çatma vaxtı və aradakı müddət özü qeydə alınır.",
         "16:40'ta Dahiliye Servisi'ndeki hemşire DAX05 için hızlı yanıt ekibini çağırır. Çağrı ekibin ekranına düşer; ekip «Yoldayım» ve «Yanındayım» der. Çağrı saati, varış saati ve aradaki süre kendiliğinden kayda geçer.",
         "В 16:40 медсестра терапевтического отделения вызывает к DAX05 бригаду быстрого реагирования. Вызов приходит на экран бригады; бригада отмечает «В пути» и «На месте». Время вызова, время прибытия и интервал между ними записываются сами.",
         "At 16:40 the nurse on the internal medicine ward calls the rapid response team to DAX05. The call lands on the team's screen; the team taps “On my way” and “At the bedside”. The call time, the arrival time and the gap between them are recorded on their own."],
    mrb1:["Bölmə tibb bacısı komandanın yolda olduğunu görür", "Birim hemşiresi ekibin yolda olduğunu görür", "Медсестра отделения видит, что бригада в пути", "The ward nurse sees that the team is on its way"],
    mrb2:["Çarpayı başında nə ediləcəyinə həkim qərar verir", "Yatak başında ne yapılacağına hekim karar verir", "Что делать у койки, решает врач", "What happens at the bedside is the physician's call"],
    s_rrt:["Təcili cavab komandası", "Hızlı yanıt ekibi", "Бригада быстрого реагирования", "Rapid response team"],
    dax:["Daxili Xəstəliklər Servisi", "Dahiliye Servisi", "Терапевтическое отделение", "Internal Medicine Ward"],
    rr_by:["Çağıran: servisin tibb bacısı", "Çağıran: servis hemşiresi", "Вызвала: медсестра отделения", "Called by: the ward nurse"],
    rr_calm:["Servis sakitdir", "Servis sakin", "В отделении спокойно", "Ward is calm"], rr_call:["Çağırış", "Çağrı", "Вызов", "Call"],
    rr_s1:["Çağırış gəldi", "Çağrı geldi", "Вызов получен", "Call received"], rr_s2:["Yoldayam", "Yoldayım", "В пути", "On my way"], rr_s3:["Yanındayam", "Yanındayım", "На месте", "At the bedside"],
    rr_rt:["Çatma müddəti", "Varış süresi", "Время прибытия", "Time to bedside"],
    rr_rec:["Qeydə alındı", "Kayda geçti", "Записано", "Recorded"], rr_wait:["Gözlənilir…", "Bekleniyor…", "Ожидание…", "Waiting…"],
    /* gece · SpO2 eskalasyon */
    m3t:["Bir çarpayıda SpO₂ düşür", "Bir yatakta SpO₂ düşüyor", "На одной койке падает SpO₂", "SpO₂ falls on one bed"],
    m3p:["REA03-də dəyər həddən aşağı düşür. Əvvəl çarpayının tibb bacısına xəbər gedir; 3 dəqiqədə cavab yoxdursa baş tibb bacısına, 5 dəqiqədə həkimə. Kimin nə vaxt gördüyü qeydə alınır.",
         "REA03'te değer eşiğin altına iner. Önce yatağın hemşiresine haber gider; 3 dakikada yanıt yoksa sorumlu hemşireye, 5 dakikada hekime. Kim ne zaman gördü, kayıt altında.",
         "На REA03 значение опускается ниже порога. Сначала уведомляется медсестра койки; нет ответа за 3 минуты — старшая медсестра, через 5 минут — врач. Кто и когда увидел, записывается.",
         "On REA03 the value drops below its threshold. The bed's nurse is told first; no response in 3 minutes, the charge nurse; at 5 minutes, the physician. Who saw it, and when, is on the record."],
    m3b1:["Hədlər və müddətlər xəstəxananın öz qaydasıdır", "Eşikler ve süreler hastanenin kendi kuralıdır", "Пороги и интервалы задаёт сама больница", "Thresholds and timings are the hospital's own rules"],
    m3b2:["Nə ediləcəyinə həkim qərar verir", "Ne yapılacağına hekim karar verir", "Что делать дальше, решает врач", "What happens next is the physician's call"],
    sc_n:["Tibb bacısı", "Hemşire", "Медсестра", "Nurse"], sc_c:["Baş tibb bacısı", "Sorumlu hemşire", "Старшая медсестра", "Charge nurse"], sc_d:["Həkim", "Hekim", "Врач", "Physician"],
    sc0:["8 çarpayı izlənilir · hamısı sabit", "8 yatak izleniyor · hepsi sakin", "8 коек под наблюдением · всё стабильно", "8 beds monitored · all calm"],
    sc1:["REA03 · SpO₂ düşür", "REA03 · SpO₂ düşüyor", "REA03 · SpO₂ снижается", "REA03 · SpO₂ falling"],
    sc2:["Tibb bacısına xəbər verildi", "Hemşireye haber verildi", "Медсестра уведомлена", "Nurse notified"],
    sc3:["3 dəq cavab yoxdur → baş tibb bacısı", "3 dk yanıt yok → sorumlu hemşire", "3 мин без ответа → старшая медсестра", "No response in 3 min → charge nurse"],
    sc4:["5 dəq → həkim", "5 dk → hekim", "5 мин → врач", "5 min → physician"],
    sc5:["Həkim gördü · qərar həkimindir", "Hekim gördü · karar hekimin", "Врач увидел · решение за врачом", "Physician acknowledged · the decision is theirs"],
    /* gece · görevler */
    m4t:["Tapşırıqlarım: saat-saat cədvəl", "Görevlerim: saat saat ızgara", "Мои задачи: почасовая сетка", "My tasks: the hourly grid"],
    m4p:["Gecənin gündəlik işləri çarpayı və saat cədvəlindədir. Görülən iş bir toxunuşla bağlanır; vaxtı keçən iş qırmızıya dönür və baş tibb bacısının siyahısında da görünür.",
         "Gecenin rutin işleri yatak ve saat ızgarasında durur. Yapılan iş tek dokunuşla kapanır; saati geçen iş kırmızıya döner ve sorumlu hemşirenin listesinde de görünür.",
         "Плановые ночные задачи — в сетке «койка × час». Выполненное закрывается одним касанием; просроченное краснеет и появляется в списке старшей медсестры.",
         "The night's routine work sits in a bed-by-hour grid. A finished task closes with one tap; an overdue one turns red and also shows on the charge nurse's list."],
    m4b1:["İşlər qulluq planından gəlir", "İşler bakım planından gelir", "Задачи приходят из плана ухода", "Tasks come from the care plan"],
    m4b2:["Kimin bağladığı saatı ilə görünür", "Kim kapattı, saatiyle görünür", "Кто закрыл — видно со временем", "Who closed it shows with the time"],
    s4h:["Tapşırıqlarım", "Görevlerim", "Мои задачи", "My tasks"],
    k_pos:["Mövqe", "Pozisyon", "Положение", "Turning"], k_obs:["Ölçmə", "Ölçüm", "Измерение", "Reading"], k_care:["Qulluq", "Bakım", "Уход", "Care"],
    k_done:["Edildi", "Yapıldı", "Сделано", "Done"], k_now:["İndi", "Şimdi", "Сейчас", "Now"], k_late:["Gecikir", "Gecikti", "Просрочено", "Overdue"],
    k_sum:["{a}/{b} edildi · {c} gecikir", "{a}/{b} yapıldı · {c} gecikti", "{a}/{b} сделано · {c} просрочено", "{a}/{b} done · {c} overdue"],
    /* sabaha karşı · mühür */
    m6t:["Təhvil qeydi möhürlənir", "Teslim notu mühürlenir", "Записка передачи скрепляется", "The handover note is sealed"],
    m6p:["Gecənin xülasəsi özü toplanır: eskalasiyalar, bağlanan və keçən işlər. Komanda çatışmayanı tamamlayır və möhürləyir; möhürlü qeyd dəyişdirilmir, gündüz komandası 08:00-da təhvil alır.",
         "Gecenin özeti kendiliğinden toplanır: eskalasyonlar, kapanan ve devreden işler. Ekip eksiği tamamlar ve mühürler; mühürlü not değiştirilemez, gündüz ekibi 08:00'de devralır.",
         "Сводка за ночь собирается сама: эскалации, закрытые и переходящие задачи. Команда дополняет и скрепляет; скреплённую записку изменить нельзя, дневная команда принимает её в 08:00.",
         "The night's summary assembles itself: escalations, closed and carried-over tasks. The team fills the gaps and seals it; a sealed note can't be altered, and the day team takes over at 08:00."],
    m6b1:["Dəyişdirilə bilməyən qeyd", "Değiştirilemez kayıt", "Неизменяемая запись", "Tamper-proof record"],
    m6b2:["Təhvil alan şəxs və saat qeydə əlavə olunur", "Devralan kişi ve saat nota eklenir", "К записке добавляются принявший и время", "Who takes over, and when, is added to the note"],
    s6h:["Təhvil qeydi · Gecə → Gündüz", "Teslim notu · Gece → Gündüz", "Передача · Ночь → День", "Handover · Night → Day"],
    st1:["8 çarpayı", "8 yatak", "8 коек", "8 beds"], st_adm:["1 yeni qəbul", "1 yeni kabul", "1 новое поступление", "1 new admission"],
    st2:["1 eskalasiya", "1 eskalasyon", "1 эскалация", "1 escalation"], st3:["{n} iş bağlandı", "{n} iş kapandı", "Закрыто задач: {n}", "{n} tasks closed"],
    st4:["2 iş keçir", "2 iş devrediyor", "2 задачи переходят", "2 tasks carried over"],
    dl1:["REA03 · 02:10 SpO₂ düşməsi · həkim 02:16-da gördü", "REA03 · 02:10 SpO₂ düşüşü · hekim 02:16'da gördü", "REA03 · 02:10 падение SpO₂ · врач увидел в 02:16", "REA03 · 02:10 SpO₂ drop · physician saw it at 02:16"],
    dlA:["REA08 · 11:00-da təcili yardımdan qəbul edildi", "REA08 · 11:00'de acil servisten kabul edildi", "REA08 · поступление из приёмного отделения в 11:00", "REA08 · admitted from the ED at 11:00"],
    dl3:["REA02 · 2 iş gündüz komandasına keçir", "REA02 · 2 iş gündüz ekibine devrediyor", "REA02 · 2 задачи переходят дневной команде", "REA02 · 2 tasks carry over to the day team"],
    seal:["Möhürlə", "Mühürle", "Скрепить", "Seal"],
    sealWho:["Gecə komandası · baş tibb bacısı", "Gece ekibi · sorumlu hemşire", "Ночная команда · старшая медсестра", "Night team · charge nurse"],
    sealedS:["Möhürləndi", "Mühürlendi", "Скреплено", "Sealed"],
    end_t:["24 saat, bir qeyddə.", "24 saat, tek kayıtta.", "24 часа — в одной записи.", "24 hours, one record."],
    end_p:["Gündüz komandası möhürlü qeydi təhvil alır; yeni gün qaldığınız yerdən başlayır.", "Gündüz ekibi mühürlü notu devralır; yeni gün, bıraktığınız yerden başlar.", "Дневная команда принимает скреплённую записку; новый день начинается с того места, где вы остановились.", "The day team takes over the sealed note; the new day starts where you left off."]
  };
  var t = function (k) { var r = T[k]; return r ? r[IDX[lang]] : k; };

  /* ---------- simgeler (app/core.js ile aynı çizgiler) ---------- */
  var P = {
    clip:'<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    lock:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', chart:'<path d="M3 3v18h18"/><path d="M7 16V9M12 16V5M17 16v-4"/>',
    tablet:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/>', ok:'<path d="M20 6 9 17l-5-5"/>',
    bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    userPlus:'<circle cx="9" cy="7" r="4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M19 8v6M22 11h-6"/>',
    heart:'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
    clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    play:'<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>', pause:'<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
    print:'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    replay:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', pin:'<path d="M12 22s7-6.1 7-12a7 7 0 0 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'
  };
  var ic = function (k) { return '<svg class="nb-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[k] || "") + "</svg>"; };
  var I = function (k, tag, cls) { return "<" + (tag || "span") + (cls ? ' class="' + cls + '"' : "") + ' data-i="' + k + '"></' + (tag || "span") + ">"; };

  /* ---------- zaman çizelgesi verisi ----------
     Dakika = 08:00'den bu yana (0…1440, ertesi 08:00). Her an: saatte MIN'e gelinir, HOLD saniye durulur (bu sırada saat
     DRIFT dakika ilerler, küçük ekran canlanır), sonra saat RATE dk/sn hızla bir sonraki ana akar. 1× toplam ≈ 74 sn.
     Gündüz 08:00–20:00 (0–720), gece 20:00–08:00 (720–1440). */
  var KEYS = ["mh", "m5", "ma", "m2", "mr", "m1", "m3", "m4", "m6"];
  var WHERE = { m2:"dax", mr:"dax" };                                   // servis anları: çipte birim adı
  var MIN = [0, 90, 180, 360, 520, 720, 1090, 1140, 1425], DRIFT = [2, 4, 4, 0, 4, 2, 6, 0, 0], HOLD = [4.5, 6, 6, 4.5, 6, 4.5, 7, 5, 5];
  var END = 1440, RATE = 64, END_HOLD = 4, NM = KEYS.length, SNAP = 10, BASE_H = 8;
  var SEGS = [], HS = [], HE = [];
  (function () {
    var p = 0, c = 0;
    for (var k = 0; k <= NM; k++) {
      var to = k < NM ? MIN[k] : END;
      if (to > c) { SEGS.push({ go:1, k:k - 1, c0:c, c1:to, p0:p, p1:p + (to - c) / RATE }); p += (to - c) / RATE; c = to; }
      var h = k < NM ? HOLD[k] : END_HOLD, d = k < NM ? DRIFT[k] : 0;
      HS[k] = p; HE[k] = p + h;
      SEGS.push({ go:0, k:k, c0:c, c1:c + d, p0:p, p1:p + h }); p += h; c += d;
    }
  })();
  var TOTAL = HE[NM];
  function at(p) {
    if (p < 0) p = 0; if (p > TOTAL) p = TOTAL;
    for (var i = 0; i < SEGS.length; i++) { var s = SEGS[i]; if (p < s.p1 || i === SEGS.length - 1) {
      var f = s.p1 > s.p0 ? Math.min(1, Math.max(0, (p - s.p0) / (s.p1 - s.p0))) : 1;
      return { k:s.k, f:s.go ? 1 : f, mins:s.c0 + (s.c1 - s.c0) * f, go:!!s.go };
    } }
  }
  function pAt(m, snap) {
    m = Math.max(0, Math.min(END, m));
    if (snap) { if (m >= END - Math.min(snap, 5)) return HS[NM] + .01; for (var k = 0; k < NM; k++) if (m >= MIN[k] - snap && m <= MIN[k] + DRIFT[k] + snap) return HE[k] - .001; }
    for (var i = 0; i < SEGS.length; i++) { var s = SEGS[i]; if (m <= s.c1) {
      if (!s.go) return s.p1 - .001;
      return s.p0 + (m - s.c0) / (s.c1 - s.c0) * (s.p1 - s.p0);
    } }
    return TOTAL;
  }

  /* 24 saatin akışı: ölçümler, kapanan işler, alarmlar, kabul — şeritte ve sayaçlarda (uydurma ama tutarlı) */
  var EV = [];
  ["REA01", "REA02", "REA03", "REA04", "REA05", "REA06", "REA07", "REA08"].forEach(function (bed, b) {
    if (b === 4) { [20, 260, 500, 740, 980, 1220].forEach(function (m) { EV.push({ m:m, ty:"r", bed:bed, key:"ev_rp" }); }); return; }   // REA05: monitörsüz, portatif cihaz
    for (var h = 0; h < 24; h++) { var m = h * 60 + (b * 7 + 11) % 60; if (b === 7 && m < 190) continue; EV.push({ m:m, ty:"r", bed:bed, key:"ev_r" }); }
  });
  EV.push({ m:360, ty:"r", bed:"DAX03", key:"ev_rp" });
  for (var ti = 0, tm = 25; tm < 1425; ti++, tm += 31) {
    var occ = tm >= 180 ? ["REA01", "REA02", "REA03", "REA04", "REA06", "REA07", "REA08"] : ["REA01", "REA02", "REA03", "REA04", "REA06", "REA07"];
    EV.push({ m:tm, ty:"t", bed:occ[ti % occ.length], key:ti % 3 === 1 ? "ev_care" : "ev_pos" });
  }
  EV.push({ m:520, ty:"a", bed:"DAX05", key:"ev_a3" }, { m:890, ty:"a", bed:"REA06", key:"ev_a1" }, { m:1090, ty:"a", bed:"REA03", key:"ev_a2" });
  EV.push({ m:180, ty:"k", bed:"REA08", key:"ev_k" }, { m:184, ty:"x", bed:"REA08", key:"ev_band" });
  EV.push({ m:-20, ty:"x", bed:"REA03", key:"ev_r" }, { m:-15, ty:"x", bed:"", key:"ev_x3" }, { m:2, ty:"x", bed:"", key:"ev_h1" }, { m:94, ty:"x", bed:"REA01", key:"ev_x2" }, { m:722, ty:"x", bed:"", key:"ev_h2" }, { m:1425, ty:"x", bed:"", key:"ev_x3" });
  EV.sort(function (a, b) { return a.m - b.m; });
  var EVM = EV.map(function (e) { return e.m; });
  var cum = function (ty) { return EV.filter(function (e) { return e.ty === ty; }).map(function (e) { return e.m; }); };
  var CR = cum("r"), CT = cum("t"), CA = cum("a");
  var NIGHT_TASKS = CT.filter(function (m) { return m >= 720 && m < 1425; }).length;   // mühürdeki "… iş kapandı" buradan
  var countLE = function (arr, m) { var n = 0; while (n < arr.length && arr[n] <= m) n++; return n; };

  var BEDS = [["REA01", 96], ["REA02", 94], ["REA03", 97], ["REA04", 98], ["REA05", 95], ["REA06", 97], ["REA07", 99], ["REA08", 96]];
  var pts = function (k) { var a = []; for (var x = 0; x < 12; x++) a.push((x / 11 * 100).toFixed(1) + "," + (12 + Math.sin(x * 1.3 + k) * 4 + ((k * 7 + x * 3) % 5) - 2).toFixed(1)); return a.join(" "); };
  var bedsHtml = function () { return BEDS.map(function (b, k) { return '<div class="nb-bed" data-b="' + k + '"><div class="nb-no"><b class="nb-mono">' + b[0] + '</b><i></i></div><svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts(k) + '"/></svg><div class="nb-v"><small>SpO₂</small><b class="nb-mono">' + b[1] + "</b></div></div>"; }).join(""); };
  var HOURS = ["00", "01", "02", "03", "04", "05"];
  var TASKS = [["REA01", ["pos", "obs", "pos", "care", "pos", null]], ["REA02", ["obs", "pos", "obs", "pos", "obs", "pos"]], ["REA03", ["pos", null, "obs", "pos", null, "obs"]], ["REA04", [null, "pos", "care", "obs", "pos", null]]];
  var TK_IC = { pos:"heart", obs:"clock", care:"ok" };
  var SOF = [["so_resp", "src_abg", "04:50", 2], ["so_coag", "src_cbc", "04:30", 0], ["so_liver", "src_chem", "04:30", 1], ["so_cv", "src_mon", "09:00", 1], ["so_cns", "src_nn", "08:00", 0], ["so_renal", "src_chem", "04:30", 1]];

  var fmt = function (m) { m = Math.floor(m + .02); m = ((m % 1440) + 1440) % 1440; var h = (BASE_H + Math.floor(m / 60)) % 24, mm = m % 60; return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm; };
  var pct = function (m) { return (m / END * 100).toFixed(3) + "%"; };

  /* ---------- iskelet ---------- */
  var mt = function (k) {
    var key = KEYS[k];
    return '<div class="nb-mt" data-m="' + k + '"><span class="nb-chip">' + ic(MIN[k] >= 720 ? "moon" : "sun") + '<span>' + fmt(MIN[k]) + "</span>" + (WHERE[key] ? '<span class="nb-where" data-i="' + WHERE[key] + '"></span>' : "") + "</span>" +
      I(key + "t", "h3", "nb-h") + I(key + "p", "p", "nb-p") + '<ul class="nb-ticks">' + I(key + "b1", "li") + I(key + "b2", "li") + "</ul></div>";
  };
  var tile = function (c, lbl, val) { return '<div class="nb-tile" style="--nb-vc:' + c + '"><small>' + lbl + "</small><b>" + val + "</b></div>"; };
  var scr = function (k, inner, extra) { return '<div class="nb-scr' + (extra || "") + '" data-s="' + k + '" aria-hidden="true">' + inner + "</div>"; };
  var hdr = function (icon, lbl, right, rightAttr) { return '<div class="nb-scrh"><span class="nb-l">' + icon + lbl + '</span><span class="nb-mono"' + (rightAttr || "") + ">" + right + "</span></div>"; };
  var hrow = function (bed, tag, m) { return '<div class="nb-hrow"><b class="nb-mono">' + bed + "</b>" + tag + m + "</div>"; };
  // devir ekranı: sabah (gece → gündüz) ve akşam (gündüz → gece) aynı kalıp, farklı satırlar
  var handover = function (k, dirKey, id, rea03At, rea08) {
    return scr(k, hdr(ic("clip"), I("s1h"), "", ' data-i="' + dirKey + '"') +
      hrow("REA01", I("attn", "span", "nb-tag"), I("open2", "span", "nb-m")) +
      hrow("REA02", I("attn", "span", "nb-tag"), I(k === 0 ? "open2" : "open1", "span", "nb-m")) +
      hrow("REA03", I("calmT", "span", "nb-tag nb-g"), '<span class="nb-m">' + I("last") + ' <span class="nb-mono">' + rea03At + "</span></span>") +
      hrow("REA04–07", "", I("calm4", "span", "nb-m")) + rea08 +
      '<div class="nb-take"><span class="nb-sealchip">' + ic("lock") + I("sealed") + '</span><span class="nb-btn" id="nb-take' + id + '">' + ic("ok") + '<span id="nb-taketx' + id + '"></span></span></div>');
  };

  var screens =
    handover(0, "s1sM", "M", "07:40", hrow("REA08", I("bed_free", "span", "nb-tag nb-g"), I("bed_ready", "span", "nb-m"))) +
    scr(1, hdr(ic("chart"), '<span><span class="nb-mono">REA01</span> · <span data-i="s5h"></span></span>', "09:30") +
      '<div class="nb-sof" id="nb-sof"></div><div class="nb-soft"><span class="nb-tot">' + I("total") + '<b id="nb-softot">5</b></span><span class="nb-state" id="nb-sofst"></span></div>') +
    scr(2, hdr(ic("userPlus"), I("s_adm"), "11:00", ' id="nb-admclk"') +
      '<div class="nb-from">' + ic("arrow") + I("adm_from") + '<span class="nb-tag" id="nb-admway"></span></div>' +
      '<div class="nb-admbed" id="nb-admbed"><b class="nb-mono">REA08</b><span class="nb-tag nb-g" id="nb-admst"></span>' + I("bed_sub", "span", "nb-m") + "</div>" +
      '<div class="nb-nums"><div class="nb-num" id="nb-hn">' + I("n_hn", "small") + '<b class="nb-mono">HN-0260214</b>' + I("n_hn_s") + "</div>" +
        '<div class="nb-num" id="nb-pr">' + I("n_pr", "small") + '<b class="nb-mono">G-2026-0031</b>' + I("n_pr_s") + "</div></div>" +
      '<div class="nb-band" id="nb-band"><span class="nb-bandl">' + ic("print") + I("band") + '</span><div class="nb-bandin"><span class="nb-bc"></span><span>REA08 · HN-0260214 · G-2026-0031</span></div></div>' +
      '<div class="nb-cap" id="nb-admcap"></div>') +
    scr(3, hdr(ic("tablet"), '<span><span class="nb-mono">DAX03</span> · <span data-i="s2h"></span></span>', "14:00") +
      '<div class="nb-dev"><div class="nb-devh"><span class="nb-src">' + ic("tablet") + I("s2src") + " · PM-07</span></div>" +
        '<div class="nb-tiles" id="nb-tiles">' +
          tile("#22e05a", I("v_hr"), '88<em data-i="u_pm"></em>') + tile("#ff7a7a", I("v_bp"), "124/76") + tile("#ffe14a", "SpO₂", "96<em>%</em>") +
          tile("#e8eef7", I("v_t"), "36.9<em>°C</em>") + tile("#3fd8ff", I("v_rr"), '16<em data-i="u_pm"></em>') + tile("#c4b5fd", I("v_pain"), "2<em>/10</em>") +
        '</div><div class="nb-devf"><span id="nb-devst"></span><span>' + I("s2next") + ' <b class="nb-mono">18:00</b></span></div></div>') +
    scr(4, hdr(ic("bell"), I("s_rrt"), "16:40", ' id="nb-rrclk"') +
      '<div class="nb-rrc" id="nb-rrc"><b class="nb-mono">DAX05</b>' + I("dax", "span", "nb-m") + '<span class="nb-tag nb-g" id="nb-rrtag"></span></div>' +
      I("rr_by", "p", "nb-rrby") +
      '<ol class="nb-rrs" id="nb-rrs"><li><span class="nb-ic">' + ic("bell") + "</span>" + I("rr_s1", "b") + '<span class="nb-mono">16:40</span></li>' +
        '<li><span class="nb-ic">' + ic("arrow") + "</span>" + I("rr_s2", "b") + '<span class="nb-mono">16:41</span></li>' +
        '<li><span class="nb-ic">' + ic("pin") + "</span>" + I("rr_s3", "b") + '<span class="nb-mono">16:44</span></li></ol>' +
      '<div class="nb-rrf"><span class="nb-tot">' + I("rr_rt") + '<b id="nb-rrtime">–</b></span><span class="nb-state" id="nb-rrst"></span></div>') +
    handover(5, "s1sE", "E", "19:40", hrow("REA08", I("bed_new", "span", "nb-tag nb-pt"), I("bed_newAt", "span", "nb-m"))) +
    scr(6, hdr('<span class="nb-live"></span>', I("unitLive"), "02:09", ' id="nb-escclk"') +
      '<div class="nb-beds" id="nb-escbeds">' + bedsHtml() + '</div><div class="nb-chain" id="nb-chain"></div><div class="nb-cap" id="nb-esccap"></div>') +
    scr(7, hdr(ic("list"), I("s4h"), "03:00") +
      '<div class="nb-tg" id="nb-tg"></div><div class="nb-tgf"><span><i style="background:var(--ok)"></i>' + I("k_done") + '</span><span><i style="background:var(--pri)"></i>' + I("k_now") + '</span><span><i style="background:var(--crit)"></i>' + I("k_late") + '</span><span class="nb-sum" id="nb-tgsum"></span></div>') +
    scr(8, hdr(ic("clip"), I("s6h"), "07:45") +
      '<div class="nb-stats">' + I("st1") + I("st2") + '<span id="nb-st3"></span>' + I("st4") + "</div>" +
      '<div class="nb-dl">' + ic("bell") + I("dl1") + '</div><div class="nb-dl">' + ic("userPlus") + I("dlA") + '</div><div class="nb-dl">' + ic("list") + I("dl3") + "</div>" +
      '<div class="nb-seal"><span class="nb-btn nb-sealbtn">' + ic("lock") + I("seal") + "</span>" + I("sealWho", "span", "nb-who") + "</div>" +
      '<div class="nb-stamp">' + I("sealedS") + "<small>07:45 · #7F3A</small></div>", " nb-doc");

  var texts = KEYS.map(function (k, i) { return mt(i); }).join("") +
    '<div class="nb-mt nb-endb" data-m="' + NM + '">' +
      '<h3 class="nb-h nb-endh"><span class="nb-mono">08:00</span> · <span data-i="end_t"></span></h3>' + I("end_p", "p", "nb-p") +
      '<div class="nb-endsum" id="nb-endsum"></div><button type="button" class="nb-again" data-act="again">' + ic("replay") + I("again") + "</button></div>";

  var hrs = [0, 240, 480, 720, 960, 1200, 1440].map(function (m) { return '<span style="left:' + pct(m) + '">' + fmt(m) + "</span>"; }).join("");
  var acts = EV.filter(function (e) { return e.ty !== "x" && e.m >= 0; }).map(function (e) { return '<i class="nb-c' + e.ty + '" style="left:' + pct(e.m) + '"></i>'; }).join("");
  var ticks = MIN.map(function (m, k) { return '<i class="nb-tk" data-tk="' + k + '" style="left:' + pct(m) + '"></i>'; }).join("");

  mount.innerHTML =
    '<div class="nb' + (reduced ? " nb-rm" : "") + '" id="nb-root">' +
    '<div class="nb-stage" id="nb-stage">' +
      '<div class="nb-clk">' +
        '<div class="nb-rltop"><span class="nb-live"></span>' + I("rail_lbl") + "</div>" +
        '<div class="nb-clock" id="nb-clk" aria-hidden="true">08:00</div>' +
        '<div class="nb-left" id="nb-phase"></div>' +
        '<div class="nb-ctl"><button type="button" class="nb-pp" id="nb-pp" data-act="pp"></button>' +
          '<div class="nb-spd" role="group" id="nb-spd">' + [1, 2, 4].map(function (n) { return '<button type="button" data-spd="' + n + '" aria-pressed="false">' + n + "×</button>"; }).join("") + "</div>" +
          "</div>" +
        '<div class="nb-cnt">' + I("cn_h", "h4") + '<div class="nb-cn">' +
          '<div><small><i class="nb-cr"></i><span data-i="cn_r"></span></small><b id="nb-cnr">0</b></div>' +
          '<div><small><i class="nb-ct"></i><span data-i="cn_t"></span></small><b id="nb-cnt">0</b></div>' +
          '<div><small><i class="nb-ca"></i><span data-i="cn_a"></span></small><b id="nb-cna">0</b></div></div>' +
          '<ol class="nb-log" id="nb-log" aria-hidden="true"></ol></div>' +
      "</div>" +
      '<div class="nb-txs" id="nb-txs">' + texts + "</div>" +
      '<div class="nb-scrs" id="nb-scrs">' + screens + "</div>" +
      '<div class="nb-tl" id="nb-tl" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="1440">' +
        '<div class="nb-hrs nb-mono" aria-hidden="true">' + hrs + "</div>" +
        '<div class="nb-sky" aria-hidden="true"><span class="nb-sun" style="left:' + pct(360) + '">' + ic("sun") + '</span><span class="nb-moon" style="left:' + pct(1080) + '">' + ic("moon") + "</span></div>" +
        '<div class="nb-trk" id="nb-trk" aria-hidden="true"><span class="nb-fut" id="nb-fut"></span>' + ticks + '<span class="nb-knob" id="nb-knob"></span></div>' +
        '<div class="nb-act" aria-hidden="true"><div class="nb-actA">' + acts + '</div><div class="nb-actB" id="nb-actB">' + acts + "</div></div>" +
      "</div>" +
      '<div class="nb-chips" id="nb-chips" role="group"></div>' +
    "</div></div>";

  var root = document.getElementById("nb-root");
  var $ = function (id) { return document.getElementById(id); };
  var txEls = [].slice.call(root.querySelectorAll(".nb-mt")), scEls = [].slice.call(root.querySelectorAll(".nb-scr"));
  var tkEls = [].slice.call(root.querySelectorAll(".nb-tk"));
  var tl = $("nb-tl"), trk = $("nb-trk");
  var last = {};
  var set = function (key, val, fn) { if (last[key] === val) return; last[key] = val; fn(val); };

  /* ---------- oynatma durumu ---------- */
  var S = { p:reduced ? HE[0] - .001 : 0, speed:1, want:!reduced, visible:false, dragging:false, stopAt:null };
  var running = function () { return S.want && S.visible && !document.hidden && !reduced && !S.dragging; };

  /* dile bağlı, yeniden çizilen parçalar */
  function drawStatic() {
    $("nb-chips").innerHTML = KEYS.map(function (k, i) { return '<button type="button" data-go="' + i + '" title="' + fmt(MIN[i]) + ' · ' + t("c_" + k) + '"><span class="nb-cht">' + ic("ok") + fmt(MIN[i]) + '</span><span class="nb-chl">' + t("c_" + k) + "</span></button>"; }).join("");
    $("nb-chips").setAttribute("aria-label", t("moms"));
    $("nb-spd").setAttribute("aria-label", t("spd"));
    tl.setAttribute("aria-label", t("tl"));
    $("nb-chain").innerHTML = [["bell", "sc_n"], ["userPlus", "sc_c"], ["heart", "sc_d"]].map(function (s, k) { return '<div class="nb-st" data-s="' + k + '"><span class="nb-ic">' + ic(s[0]) + "</span><b>" + t(s[1]) + "</b></div>"; }).join('<i class="nb-ln"></i>');
    var g = "<span></span>" + HOURS.map(function (h) { return '<span class="nb-hh nb-mono' + (h === "03" ? " nb-now" : "") + '">' + h + ":00</span>"; }).join("");
    TASKS.forEach(function (r, ri) { g += '<span class="nb-bn">' + r[0] + "</span>" + r[1].map(function (k, hi) { return '<span class="nb-cell" data-r="' + ri + '" data-h="' + hi + '" data-t="' + (k || "") + '">' + (k ? ic(TK_IC[k]) + "<span>" + t("k_" + k) + "</span>" : "") + "</span>"; }).join(""); });
    $("nb-tg").innerHTML = g;
    $("nb-sof").innerHTML = SOF.map(function (s) { return '<div class="nb-sr"><b>' + t(s[0]) + '</b><span class="nb-s">' + t(s[1]) + " · " + s[2] + '</span><span class="nb-n">' + s[3] + "</span></div>"; }).join("");
    $("nb-st3").textContent = t("st3").replace("{n}", NIGHT_TASKS);
    $("nb-endsum").innerHTML = [["cn_r", CR.length], ["cn_t", CT.length], ["cn_a", CA.length]].map(function (x) { return "<span>" + t(x[0]) + "<b>" + x[1] + "</b></span>"; }).join("") + "<span>" + t("st_adm") + "</span>";
    last = {};
  }
  function applyLang() {
    root.setAttribute("lang", lang.toLowerCase());
    root.querySelectorAll("[data-i]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i")); });
    drawStatic(); render();
  }

  /* ---------- çizim: durum → ekran ---------- */
  function render() {
    var A = at(S.p), mins = A.mins, k = A.k;
    var mk = Math.floor(mins + .02);
    set("clk", fmt(mins), function (v) { $("nb-clk").textContent = v; });
    set("mins", mk, function (v) {
      $("nb-knob").style.left = pct(v); $("nb-fut").style.left = pct(v);
      $("nb-actB").style.clipPath = "inset(0 " + (100 - v / END * 100).toFixed(3) + "% 0 0)";
      tl.setAttribute("aria-valuenow", v);
      $("nb-cnr").textContent = countLE(CR, v); $("nb-cnt").textContent = countLE(CT, v); $("nb-cna").textContent = countLE(CA, v);
      var n = countLE(EVM, v);
      set("log", n, function () {
        var out = [];
        for (var i = n - 1; i >= 0 && out.length < 3; i--) { var e = EV[i]; out.push('<li><i class="nb-c' + e.ty + '"></i><span class="nb-mono">' + fmt(e.m) + "</span><span>" + (e.bed ? e.bed + " · " : "") + t(e.key) + "</span></li>"); }
        $("nb-log").innerHTML = out.join("");
      });
    });
    // gündüz / gece + sıradaki an
    var night = mk >= 720 && mk < 1440, nk = k + 1;
    set("phase", night + ":" + nk + ":" + lang, function () {
      var nxt = nk < NM ? fmt(MIN[nk]) + " · " + t("c_" + KEYS[nk]) : "08:00 · " + t("c_mh");
      $("nb-phase").innerHTML = ic(night ? "moon" : "sun") + "<b>" + t(night ? "night" : "day") + "</b><span> · " + t("nx") + ": " + nxt + "</span>";
      root.classList.toggle("nb-night", night);
    });
    set("vt", mk + ":" + k, function () { tl.setAttribute("aria-valuetext", fmt(mk) + " · " + (k < NM ? t("c_" + KEYS[k]) : t("end_t"))); });
    set("k", k, function (v) {
      txEls.forEach(function (el, i) { el.classList.toggle("nb-on", i === v); });
      var sv = Math.min(v, NM - 1);
      scEls.forEach(function (el, i) { el.classList.toggle("nb-on", i === sv); });
      tkEls.forEach(function (el, i) { el.classList.toggle("nb-on", i === v); el.classList.toggle("nb-past", i < v); });
    });
    var chips = $("nb-chips").children;
    set("chip", k + ":" + Math.round(A.f * 40), function () {
      for (var i = 0; i < chips.length; i++) {
        chips[i].classList.toggle("nb-on", i === k); chips[i].classList.toggle("nb-past", i < k || (i === k && A.f >= 1 && !A.go) || k === NM);
        chips[i].setAttribute("aria-current", i === k ? "step" : "false");
        chips[i].style.setProperty("--p", i === k ? A.f.toFixed(3) : "0");
      }
    });
    var F = []; for (var i = 0; i < NM; i++) F[i] = i < k ? 1 : i > k ? 0 : A.f;
    // sabah ve akşam devri
    set("takeM", F[0] > .45, function (v) { $("nb-takeM").classList.toggle("nb-done", v); $("nb-taketxM").textContent = t(v ? "tookM" : "took"); });
    set("takeE", F[5] > .45, function (v) { $("nb-takeE").classList.toggle("nb-done", v); $("nb-taketxE").textContent = t(v ? "tookE" : "took"); });
    // vizit · skor satırları dolar, sonra hekim onayı
    set("sof", Math.min(7, Math.floor(F[1] * 8.5)), function (s) {
      $("nb-sof").querySelectorAll(".nb-sr").forEach(function (r, i) { r.classList.toggle("nb-on", i < s); });
      var el = $("nb-sofst"); el.className = "nb-state" + (s >= 7 ? " nb-ok" : "");
      el.innerHTML = s >= 7 ? ic("ok") + t("st_ok") : s >= 6 ? ic("clock") + t("st_draft") : t("st_fill");
      $("nb-softot").textContent = s >= 6 ? "5" : "–";
    });
    // kabul
    var fa = F[2], pa = fa < .12 ? 0 : fa < .3 ? 1 : fa < .5 ? 2 : fa < .66 ? 3 : fa < .88 ? 4 : 5;
    set("adm", pa, function (p) {
      $("nb-admclk").textContent = ["11:00", "11:01", "11:01", "11:02", "11:03", "11:04"][p];
      var w = $("nb-admway"); w.textContent = t(p ? "adm_here" : "adm_way"); w.className = "nb-tag" + (p ? " nb-g" : "");
      var bs = $("nb-admst"); bs.textContent = t(p ? "bed_occ" : "bed_free"); bs.className = "nb-tag " + (p ? "nb-pt" : "nb-g");
      $("nb-admbed").classList.toggle("nb-occ", p >= 1);
      $("nb-hn").classList.toggle("nb-on", p >= 2); $("nb-pr").classList.toggle("nb-on", p >= 3);
      $("nb-band").classList.toggle("nb-pr", p >= 4);
      var c = $("nb-admcap"); c.textContent = t(p === 0 ? "adm_c0" : p < 4 ? "adm_c1" : p === 4 ? "adm_c2" : "adm_c3"); c.className = "nb-cap" + (p === 5 ? " nb-g" : "");
    });
    // serviste portatif ölçüm: değerler tek tek düşer
    set("tiles", Math.min(6, Math.floor(F[3] * 7.5)), function (v) {
      $("nb-tiles").querySelectorAll(".nb-tile").forEach(function (el, i) { el.classList.toggle("nb-on", i < v); });
      $("nb-devst").innerHTML = v >= 6 ? '<span class="nb-okm">' + ic("ok") + t("s2ok") + "</span>" : t("s2wait");
    });
    // hızlı yanıt: çağrı → yoldayım → yanındayım → süre kayıtta
    var fr = F[4], pr = fr < .1 ? 0 : fr < .35 ? 1 : fr < .6 ? 2 : fr < .78 ? 3 : 4;
    set("rr", pr, function (p) {
      $("nb-rrclk").textContent = ["16:39", "16:40", "16:41", "16:44", "16:44"][p];
      var c = $("nb-rrc"); c.className = "nb-rrc" + (p >= 1 && p <= 2 ? " nb-on" : p >= 3 ? " nb-ok" : "");
      var tg = $("nb-rrtag"); tg.textContent = t(p === 0 ? "rr_calm" : p <= 2 ? "rr_call" : "rr_s3"); tg.className = "nb-tag" + (p === 0 || p >= 3 ? " nb-g" : "");
      $("nb-rrs").querySelectorAll("li").forEach(function (li, n) { li.classList.toggle("nb-on", p >= n + 1); li.classList.toggle("nb-c", n === 0 && p >= 1 && p <= 2); });
      $("nb-rrtime").textContent = p >= 4 ? "4 " + t("u_m") : "–";
      var s = $("nb-rrst"); s.className = "nb-state" + (p >= 4 ? " nb-ok" : ""); s.innerHTML = p >= 4 ? ic("ok") + t("rr_rec") + " · 16:44" : p >= 1 ? ic("clock") + t("rr_wait") : "";
      s.style.visibility = p >= 1 ? "visible" : "hidden";
    });
    // gece · SpO2 eskalasyon zinciri
    var f3 = F[6], ph = f3 < .1 ? 0 : f3 < .26 ? 1 : f3 < .44 ? 2 : f3 < .62 ? 3 : f3 < .8 ? 4 : 5;
    set("ph", ph, function (p) {
      var bed = $("nb-escbeds").querySelector('[data-b="2"]');
      bed.className = "nb-bed" + (p === 1 ? " nb-warn" : p >= 2 && p <= 4 ? " nb-crit" : p === 5 ? " nb-ok" : "");
      bed.querySelector(".nb-v b").textContent = [97, 91, 88, 87, 86, 93][p];
      $("nb-escclk").textContent = ["02:09", "02:10", "02:10", "02:13", "02:15", "02:16"][p];
      $("nb-chain").querySelectorAll(".nb-st").forEach(function (x, n) { x.classList.toggle("nb-on", p >= 2 && p <= 4 && n === p - 2); x.classList.toggle("nb-done", p === 5 || (p >= 3 && n < p - 2)); });
      var c = $("nb-esccap"); c.textContent = t("sc" + p); c.className = "nb-cap" + (p >= 2 && p <= 4 ? " nb-c" : p === 5 ? " nb-g" : "");
    });
    // gece · görev ızgarası: geçmiş saatler kapanır, 03:00 şimdi, bir iş gecikir
    set("tg", Math.min(4, Math.floor(F[7] * 5)), function (s) {
      var done = 0, all = 0, late = 0;
      $("nb-tg").querySelectorAll(".nb-cell").forEach(function (c) {
        var h = +c.getAttribute("data-h"), r = +c.getAttribute("data-r"), has = !!c.getAttribute("data-t"), cls = "nb-cell";
        if (has) { all++;
          if (h < 3) { var isLate = r === 2 && h === 2 && s < 4; if (isLate) { cls += " nb-lt"; late++; } else if (h < s + 1 || s >= 3) { cls += " nb-dn"; done++; } else cls += " nb-up"; }
          else if (h === 3) { if (s >= 4 && r < 2) { cls += " nb-dn"; done++; } else cls += " nb-nw"; }
          else cls += " nb-up";
        }
        c.className = cls;
      });
      $("nb-tgsum").textContent = t("k_sum").replace("{a}", done).replace("{b}", all).replace("{c}", late);
    });
    // sabaha karşı · mühür
    set("seal", F[8] > .55, function (v) { root.querySelector(".nb-doc").classList.toggle("nb-sealed", v); });
    // oynat / duraklat düğmesi
    var on = S.want && !reduced;
    set("pp", on + ":" + lang, function () { var b = $("nb-pp"); b.innerHTML = ic(on ? "pause" : "play"); b.setAttribute("aria-label", t(on ? "pause" : "play")); b.title = t(on ? "pause" : "play"); });
    set("paused", !running(), function (v) { root.classList.toggle("nb-paused", v); });
    set("spd", S.speed, function (v) { $("nb-spd").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.getAttribute("data-spd") === v)); }); });
  }

  /* ---------- döngü ---------- */
  var raf = 0, lastTs = 0;
  function frame(ts) {
    raf = 0;
    var dt = lastTs ? Math.min(.1, (ts - lastTs) / 1000) : 0; lastTs = ts;
    var go = false;
    if (running()) {
      S.p += dt * S.speed; go = true;
      if (S.p >= TOTAL) S.p = 0;                     // ertesi 08:00 kısa durur, sonra döngü baştan
    } else if (S.stopAt != null && !S.dragging && !document.hidden) {
      S.p += dt * Math.max(1, S.speed); go = true;
      if (S.p >= S.stopAt) { S.p = S.stopAt; S.stopAt = null; go = false; }
    }
    render();
    if (go || running() || S.stopAt != null) raf = requestAnimationFrame(frame); else lastTs = 0;
  }
  function kick() { if (!raf) { lastTs = 0; raf = requestAnimationFrame(frame); } }

  /* ---------- denetimler ---------- */
  function play() { if (reduced) return; if (S.p >= TOTAL - .05) S.p = 0; S.want = true; S.stopAt = null; render(); kick(); }
  function pause() { S.want = false; S.stopAt = null; render(); }
  function speed(n) { n = +n; S.speed = n >= 4 ? 4 : n >= 2 ? 2 : 1; render(); }
  function go(k) {
    k = Math.max(0, Math.min(NM, Math.round(+k || 0)));
    S.want = false;
    if (reduced) { S.p = k === NM ? HS[NM] + .01 : HE[k] - .001; S.stopAt = null; render(); return; }
    S.p = HS[k]; S.stopAt = k === NM ? HS[NM] + .01 : HE[k] - .001; render(); kick();   // o anın küçük ekranı bir kez oynar, sonra durur
  }
  function toMins(m, snap) { S.want = false; S.stopAt = null; S.p = pAt(m, snap); render(); }

  root.addEventListener("click", function (e) {
    var b = e.target.closest("[data-go]"); if (b) { go(+b.getAttribute("data-go")); return; }
    var sp = e.target.closest("[data-spd]"); if (sp) { speed(+sp.getAttribute("data-spd")); if (!S.want) play(); return; }
    var a = e.target.closest("[data-act]"); if (!a) return;
    var act = a.getAttribute("data-act");
    if (act === "pp") { if (S.want) pause(); else play(); }
    else if (act === "again") { S.p = 0; if (reduced) { go(0); return; } play(); }
  });

  // zaman çizelgesi: sürükle (fare / dokunma) — dikey kaydırma serbest (touch-action:pan-y)
  var minsFromX = function (x) { var r = trk.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * END; };
  tl.addEventListener("pointerdown", function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    S.dragging = true; try { tl.setPointerCapture(e.pointerId); } catch (er) {}
    toMins(minsFromX(e.clientX), 5); e.preventDefault(); try { tl.focus({ preventScroll:true }); } catch (er) {}
  });
  tl.addEventListener("pointermove", function (e) { if (S.dragging) toMins(minsFromX(e.clientX), 5); });
  var endDrag = function (e) { if (!S.dragging) return; S.dragging = false; if (e && e.type === "pointerup") toMins(minsFromX(e.clientX), SNAP); render(); };
  tl.addEventListener("pointerup", endDrag); tl.addEventListener("pointercancel", endDrag); tl.addEventListener("lostpointercapture", function () { S.dragging = false; });
  tl.addEventListener("keydown", function (e) {
    var A0 = at(S.p), m = Math.round(A0.mins * 10) / 10, k = A0.k, step = e.shiftKey ? 120 : 30;
    switch (e.key) {
      case "ArrowRight": case "ArrowUp": toMins(Math.floor(m / step) * step + step, 2); break;
      case "ArrowLeft": case "ArrowDown": toMins(Math.ceil(m / step) * step - step, 2); break;
      case "PageUp": go(Math.min(NM, k + 1)); break;
      case "PageDown": go(Math.max(0, A0.f < .5 || A0.go ? k - 1 : k)); break;
      case "Home": go(0); break;
      case "End": go(NM); break;
      case " ": case "Enter": if (reduced) return; if (S.want) pause(); else play(); break;
      default: return;
    }
    e.preventDefault();
  });

  // görünürlük: bölüm ekrandayken oynar; dışarıdayken / sekme gizliyken durur
  var stage = $("nb-stage");
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        var vh = window.innerHeight || 800, need = Math.min(en.boundingClientRect.height, vh) * .45;
        S.visible = en.isIntersecting && en.intersectionRect.height >= need;
      });
      render(); if (running()) kick();
    }, { threshold:[0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1] }).observe(stage);
  } else S.visible = true;
  document.addEventListener("visibilitychange", function () { render(); if (running()) kick(); });

  // dil: ev sahibi "hmc:lang" olayı yayar (detail: "AZ" | "TR" | "RU" | "EN"); konum korunur
  document.addEventListener("hmc:lang", function (e) {
    var d = e && e.detail, l = typeof d === "string" ? d : d && d.lang;
    if (!l) return; l = String(l).toUpperCase();
    if (!(l in IDX) || l === lang) return;
    lang = l; applyLang();
  });

  window.HMC_NOBET = { play:play, pause:pause, speed:speed, go:go,
    state:function () { var A = at(S.p); return { p:+S.p.toFixed(3), total:+TOTAL.toFixed(2), clock:fmt(A.mins), mins:+A.mins.toFixed(2), k:A.k, f:+A.f.toFixed(3), playing:running(), want:S.want, visible:S.visible, speed:S.speed, lang:lang, reduced:reduced, nightTasks:NIGHT_TASKS }; } };

  applyLang();
  if (running()) kick();
})();

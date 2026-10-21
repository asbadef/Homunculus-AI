/*
  parca/tur.js — "Ürün turu" (a4.html #tur bölümünden taşındı, 24.09.2026).
  Kendi kendine yeten parça: kendi CSS'ini (#tur-css) basar, #tur-mount içine çizer.
  Renkler sayfanın değişkenlerinden (--page --card --ink --pri ... ); tema html[data-theme] ile.
  Dil: localStorage "hmc.lang" (AZ açılış) + document "hmc:lang" olayı (detail: AZ|TR|RU|EN).
  Metinler a4.html sözlüğünden aynen alındı. Yatak kodları ve değerler uydurmadır; hasta adı yoktur.
*/
(function () {
  "use strict";
  var host = document.getElementById("tur");
  var mount = document.getElementById("tur-mount");
  if (!host || !mount) return;

  var IDX = { AZ:0, TR:1, RU:2, EN:3 };
  var lang = "AZ";
  try { var sv = localStorage.getItem("hmc.lang"); if (sv && sv in IDX) lang = sv; } catch (e) {}
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var wideMq = window.matchMedia ? window.matchMedia("(min-width: 1081px)") : null;

  /* ---------- CSS: yalnız #tur altında ---------- */
  var CSS = [
    '#tur { --tu-app:var(--tile); --tu-high:#ea580c; --tu-highSoft:#fff1e6; --tu-critInk:#b91c1c; --tu-midInk:#9a6a00; --tu-okInk:#15803d;',
    '  --tu-vhr:var(--hr); --tu-vspo:var(--spo); --tu-vmap:#dc2626; --tu-mkBg:var(--pri); --tu-mkInk:var(--onpri); --tu-hsRing:#fff; --tu-hsInk:#fff; --tu-monB:#1d2736; }',
    '[data-theme="gece"] #tur { --tu-high:#f97316; --tu-highSoft:rgba(249,115,22,.12); --tu-critInk:#fca5a5; --tu-midInk:#f5c451; --tu-okInk:#86efac;',
    '  --tu-vmap:#ff5c5c; --tu-mkBg:var(--ink); --tu-mkInk:var(--page); --tu-hsRing:#07101f; --tu-hsInk:#03141c; --tu-monB:#111a28; }',
    '#tur-mount { min-width:0; }',
    '#tur-mount, #tur-mount * { box-sizing:border-box; }',
    '#tur .tu-mono { font-family:"JetBrains Mono", ui-monospace, monospace; }',
    '#tur svg.tu-i { width:18px; height:18px; flex:none; }',
    '#tur button { font:inherit; color:inherit; }',
    '#tur :focus-visible { outline:2px solid var(--pri); outline-offset:2px; border-radius:8px; }',
    '#tur .tu-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:40px; padding:0 16px; border-radius:11px; border:1px solid var(--line2); background:var(--card); color:var(--ink); font:700 14px Figtree, system-ui, sans-serif; cursor:pointer; white-space:nowrap; transition:box-shadow .2s, filter .2s, border-color .15s; }',
    '#tur .tu-btn:hover { border-color:var(--pri); }',
    '#tur .tu-btn.tu-p { background:var(--pri); border-color:var(--pri); color:var(--onpri); }',
    '#tur .tu-btn.tu-sm { height:32px; padding:0 11px; font-size:12.5px; border-radius:9px; }',
    '#tur .tu-btn svg.tu-i { width:15px; height:15px; }',
    /* sekmeler */
    '#tur .tu-tabs { display:flex; gap:6px; padding:6px; background:var(--card); border:1px solid var(--line); border-radius:16px; box-shadow:var(--shadowS); overflow-x:auto; scrollbar-width:none; margin-bottom:16px; }',
    '#tur .tu-tabs::-webkit-scrollbar { display:none; }',
    '#tur .tu-tab { position:relative; flex:1 0 auto; display:flex; align-items:center; justify-content:center; gap:8px; padding:10px 14px; border:0; border-radius:11px; background:none; cursor:pointer; color:var(--mute); font:700 14px Figtree, system-ui, sans-serif; white-space:nowrap; overflow:hidden; transition:background .2s, color .2s; }',
    '#tur .tu-tab:hover { color:var(--ink); background:var(--card2); }',
    '#tur .tu-tab.on { background:var(--priSoft); color:var(--priInk); }',
    '#tur .tu-pg { position:absolute; left:10px; right:10px; bottom:3px; height:3px; border-radius:3px; background:transparent; overflow:hidden; }',
    '#tur .tu-tab.on .tu-pg { background:color-mix(in srgb, var(--pri) 18%, transparent); }',
    '#tur .tu-pg i { display:block; height:100%; width:0; background:var(--pri); border-radius:3px; transition:width .5s ease; }',
    /* sahne */
    '#tur .tu-stage { display:grid; grid-template-columns:minmax(0, 1fr) 340px; gap:18px; align-items:stretch; }',
    '#tur .tu-frame { display:flex; flex-direction:column; background:var(--card); border:1px solid var(--line); border-radius:20px; box-shadow:var(--shadow); overflow:hidden; min-width:0; }',
    '#tur .tu-top { display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--line); font:600 12.5px Figtree, system-ui, sans-serif; color:var(--mute); min-width:0; }',
    '#tur .tu-wdots { display:flex; gap:6px; flex:none; } #tur .tu-wdots i { width:10px; height:10px; border-radius:50%; background:var(--line2); }',
    '#tur .tu-crumb { display:flex; align-items:center; gap:6px; min-width:0; white-space:nowrap; overflow:hidden; }',
    '#tur .tu-crumb b { color:var(--ink); font:700 13.5px "Space Grotesk", Figtree, sans-serif; }',
    '#tur .tu-mkx { width:20px; height:20px; border-radius:6px; background:var(--tu-mkBg); color:var(--tu-mkInk); display:grid; place-items:center; font:700 12px "Space Grotesk", sans-serif; flex:none; }',
    '#tur .tu-clk { margin-left:auto; flex:none; color:var(--ink); }',
    '#tur .tu-body { position:relative; flex:1; display:flex; flex-direction:column; background:var(--tu-app); padding:14px; min-height:470px; }',
    '#tur .tu-scr { flex:1; transition:opacity .25s ease; }',
    '#tur .tu-scr.tu-swap { opacity:0; }',
    '#tur .tu-sbar { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-top:14px; padding-top:10px; border-top:1px dashed var(--line2); font:600 11.5px Figtree, system-ui, sans-serif; color:var(--mute); }',
    '#tur .tu-sbar > span { display:inline-flex; align-items:center; gap:6px; }',
    '#tur .tu-sbar svg.tu-i { width:13px; height:13px; color:var(--ok); }',
    '#tur .tu-lv { width:7px; height:7px; border-radius:50%; background:#22c55e; }',
    '#tur .tu-hs { position:absolute; z-index:4; width:28px; height:28px; margin:-14px 0 0 -14px; padding:0; border-radius:50%; border:2px solid var(--tu-hsRing); background:var(--pri); color:var(--tu-hsInk); font:700 13px Figtree, system-ui, sans-serif; cursor:pointer; display:grid; place-items:center; box-shadow:0 4px 12px rgba(14,116,144,.4); transition:transform .2s, background .2s; }',
    '#tur .tu-hs::after { content:""; position:absolute; inset:-6px; border-radius:50%; border:2px solid var(--pri); opacity:.6; animation:tur-ring 1.8s ease-out infinite; }',
    '@keyframes tur-ring { from { transform:scale(.7); opacity:.7; } to { transform:scale(1.4); opacity:0; } }',
    '#tur .tu-hs.on { transform:scale(1.18); background:#f59e0b; box-shadow:0 0 0 5px rgba(245,158,11,.25); }',
    '#tur .tu-hs.on::after { border-color:#f59e0b; }',
    '#tur .tu-bub { position:absolute; z-index:5; width:260px; background:var(--card); border:1px solid var(--line2); border-radius:14px; box-shadow:var(--shadow); padding:12px 14px; pointer-events:none; transition:opacity .2s; }',
    '#tur .tu-bub[hidden] { display:none; }',
    '#tur .tu-bub b { display:flex; align-items:center; gap:8px; font:700 14px Figtree, system-ui, sans-serif; margin-bottom:4px; color:var(--ink); }',
    '#tur .tu-bub b span { width:20px; height:20px; border-radius:50%; background:#f59e0b; color:#fff; display:grid; place-items:center; font-size:11px; flex:none; }',
    '#tur .tu-bub p { margin:0; font-size:13px; color:var(--mute); line-height:1.45; }',
    /* notlar */
    '#tur .tu-notes { background:var(--card); border:1px solid var(--line); border-radius:20px; box-shadow:var(--shadowS); padding:18px; min-width:0; }',
    '#tur .tu-notes h3 { font:700 21px/1.15 "Space Grotesk", Figtree, sans-serif; margin:0 0 6px; color:var(--ink); }',
    '#tur .tu-notes > p { margin:0 0 14px; color:var(--mute); font-size:14.5px; line-height:1.5; }',
    '#tur .tu-nl { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }',
    '#tur .tu-nl button { display:flex; gap:12px; align-items:flex-start; width:100%; text-align:left; padding:10px; border:1px solid transparent; border-radius:12px; background:none; cursor:pointer; transition:background .2s, border-color .2s; }',
    '#tur .tu-nl button:hover { background:var(--card2); }',
    '#tur .tu-n { width:24px; height:24px; border-radius:50%; background:var(--priSoft); color:var(--priInk); display:grid; place-items:center; font:700 12px Figtree, system-ui, sans-serif; flex:none; margin-top:1px; transition:background .2s, color .2s; }',
    '#tur .tu-nl b { display:block; font:700 14px/1.3 Figtree, system-ui, sans-serif; }',
    '#tur .tu-nl small { display:none; color:var(--mute); font-size:13px; line-height:1.45; margin-top:3px; }',
    '#tur .tu-nl li.on small { display:block; }',
    '#tur .tu-nl li.on button { background:var(--card2); border-color:var(--line2); }',
    '#tur .tu-nl li.on .tu-n { background:#f59e0b; color:#fff; }',
    '#tur .tu-auto { display:flex; align-items:center; gap:10px; margin-top:14px; padding-top:14px; border-top:1px solid var(--line); font-size:12.5px; color:var(--mute); }',
    '#tur .tu-st { display:inline-flex; align-items:center; gap:7px; min-width:0; }',
    '#tur .tu-st i { width:8px; height:8px; border-radius:50%; background:var(--line2); flex:none; }',
    '#tur .tu-auto.tu-play .tu-st i { background:#22c55e; box-shadow:0 0 0 0 rgba(34,197,94,.6); animation:tur-ping 1.6s ease-out infinite; }',
    '@keyframes tur-ping { to { box-shadow:0 0 0 8px rgba(34,197,94,0); } }',
    '#tur .tu-auto .tu-btn { margin-left:auto; }',
    '#tur .tu-tip { display:flex; align-items:center; gap:8px; margin-top:10px; font-size:12.5px; color:var(--mute); }',
    '#tur .tu-tip svg.tu-i { width:15px; height:15px; color:var(--priInk); }',
    /* ekran parçaları */
    '#tur .tu-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }',
    '#tur .tu-chip { display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 11px; border-radius:10px; border:1px solid var(--line); background:var(--card); color:var(--ink); font:700 12.5px Figtree, system-ui, sans-serif; white-space:nowrap; }',
    '#tur .tu-chip svg.tu-i { width:14px; height:14px; color:var(--mute); }',
    '#tur .tu-chip.on { background:var(--pri); border-color:var(--pri); color:var(--onpri); }',
    '#tur .tu-chip em { font-style:normal; opacity:.7; }',
    '#tur .tu-sp { flex:1; }',
    '#tur .tu-card { background:var(--card); border:1px solid var(--line); border-radius:14px; }',
    '#tur .tu-ttl { font:700 12px Figtree, system-ui, sans-serif; color:var(--mute); text-transform:uppercase; letter-spacing:.06em; }',
    '#tur .tu-scr { color:var(--ink); font-size:14px; line-height:1.5; }',
    '#tur .tu-scr p { margin:0; }',
    /* yataklar */
    '#tur .tu-bgrid { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin-top:12px; }',
    '#tur .tu-bc { position:relative; background:var(--card); border:1px solid var(--line); border-left:4px solid var(--tu-rc, var(--ok)); border-radius:12px; padding:9px 10px 8px; min-width:0; }',
    '#tur .tu-bc.r-high { --tu-rc:var(--tu-high); } #tur .tu-bc.r-mid { --tu-rc:var(--mid); } #tur .tu-bc.r-ok { --tu-rc:var(--ok); }',
    '#tur .tu-bc-h { display:flex; align-items:center; justify-content:space-between; gap:6px; }',
    '#tur .tu-bc-h b { font-size:13px; }',
    '#tur .tu-sb { font:700 10.5px Figtree, system-ui, sans-serif; padding:2px 7px; border-radius:999px; white-space:nowrap; background:var(--okSoft); color:var(--tu-okInk); }',
    '#tur .tu-sb.high { background:var(--tu-highSoft); color:var(--tu-high); } #tur .tu-sb.mid { background:var(--midSoft); color:var(--tu-midInk); }',
    '#tur .tu-vals { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:4px; margin:8px 0 6px; }',
    '#tur .tu-vals span { display:flex; flex-direction:column; min-width:0; }',
    '#tur .tu-vals small { font:700 9.5px Figtree, system-ui, sans-serif; color:var(--mute); }',
    '#tur .tu-vals b { font:700 17px/1.1 "JetBrains Mono", monospace; }',
    '#tur .tu-bc-f { display:flex; align-items:center; justify-content:space-between; gap:6px; font-size:10.5px; color:var(--mute); }',
    '#tur .tu-srct { display:inline-flex; align-items:center; gap:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }',
    '#tur .tu-srct svg.tu-i { width:12px; height:12px; }',
    '#tur .tu-tk { font:700 10.5px Figtree, system-ui, sans-serif; padding:2px 7px; border-radius:999px; background:var(--priSoft); color:var(--priInk); white-space:nowrap; }',
    '#tur .tu-bc.empty { border-left-color:var(--line2); border-style:dashed; display:flex; flex-direction:column; justify-content:space-between; color:var(--mute); }',
    '#tur .tu-bc.empty p { font-size:12.5px; margin-top:auto; }',
    /* hasta */
    '#tur .tu-pt-h { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }',
    '#tur .tu-bedno { font:700 22px "JetBrains Mono", monospace; }',
    '#tur .tu-meta { color:var(--mute); font-size:13px; }',
    '#tur .tu-subtabs { display:flex; gap:4px; margin:10px 0 12px; border-bottom:1px solid var(--line); overflow:hidden; }',
    '#tur .tu-subtabs span { padding:7px 10px; font:700 12.5px Figtree, system-ui, sans-serif; color:var(--mute); border-bottom:2px solid transparent; white-space:nowrap; }',
    '#tur .tu-subtabs span.on { color:var(--priInk); border-color:var(--pri); }',
    '#tur .tu-pgrid { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1.25fr); gap:10px; }',
    '#tur .tu-mon { background:#040a14; border:5px solid var(--tu-monB); border-radius:14px; color:#e8eef7; padding:10px 12px; display:flex; flex-direction:column; gap:8px; min-width:0; }',
    '#tur .tu-mon-h { display:flex; align-items:center; gap:6px; font:700 11px Figtree, system-ui, sans-serif; color:#8fa1ba; flex-wrap:wrap; }',
    '#tur .tu-src { display:inline-flex; align-items:center; gap:5px; color:#7dd3e6; background:#0b2230; border:1px solid #154257; border-radius:7px; padding:2px 7px; }',
    '#tur .tu-src svg.tu-i { width:12px; height:12px; }',
    '#tur .tu-mnum { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px; }',
    '#tur .tu-mnum span { border:1px solid #1c2c45; border-radius:10px; padding:6px 9px; background:#07101f; color:var(--c); display:flex; flex-direction:column; min-width:0; }',
    '#tur .tu-mnum small { font:700 10px Figtree, system-ui, sans-serif; opacity:.85; }',
    '#tur .tu-mnum b { font:700 24px/1.1 "JetBrains Mono", monospace; }',
    '#tur .tu-mnum b em { font-style:normal; font-size:11px; opacity:.7; margin-left:3px; }',
    '#tur .tu-ecg { height:34px; overflow:hidden; position:relative; }',
    /* canvas; çizgi rengi CSS color'dan okunur */
    '#tur .tu-ecg canvas { position:absolute; left:0; top:0; width:100%; height:100%; display:block; color:#22e05a; }',
    '#tur data { font:inherit; color:inherit; }',
    '#tur .tu-trend { padding:10px 12px; }',
    '#tur .tu-trend-h { display:flex; justify-content:space-between; align-items:center; font:700 12.5px Figtree, system-ui, sans-serif; margin-bottom:6px; gap:8px; }',
    '#tur .tu-trend-h small { color:var(--mute); font-weight:600; }',
    '#tur .tu-trend svg { width:100%; height:92px; display:block; }',
    '#tur .tu-trend .band { fill:var(--critSoft); }',
    '#tur .tu-trend .ln { fill:none; stroke:var(--tu-vspo); stroke-width:2.2; vector-effect:non-scaling-stroke; }',
    '#tur .tu-trend .gl { stroke:var(--line); stroke-width:1; vector-effect:non-scaling-stroke; }',
    '#tur .tu-score { display:flex; flex-direction:column; gap:8px; margin-top:10px; }',
    '#tur .tu-srow { display:flex; align-items:center; gap:10px; padding:9px 12px; flex-wrap:wrap; }',
    '#tur .tu-big { font:700 22px "JetBrains Mono", monospace; }',
    '#tur .tu-nm { font:700 13px Figtree, system-ui, sans-serif; }',
    '#tur .tu-srow small { color:var(--mute); font-size:12px; }',
    '#tur .tu-badge { display:inline-flex; align-items:center; gap:5px; font:700 11px Figtree, system-ui, sans-serif; padding:3px 8px; border-radius:999px; background:var(--midSoft); color:var(--tu-midInk); white-space:nowrap; }',
    '#tur .tu-badge.ok { background:var(--okSoft); color:var(--tu-okInk); }',
    '#tur .tu-srow .tu-btn { margin-left:auto; }',
    '#tur .tu-notice { display:flex; align-items:center; gap:8px; margin-top:10px; padding:9px 12px; border-radius:12px; background:var(--priSoft); color:var(--priInk); font:600 12.5px Figtree, system-ui, sans-serif; }',
    '#tur .tu-notice svg.tu-i { width:16px; height:16px; }',
    /* alarmlar */
    '#tur .tu-agrid { display:grid; grid-template-columns:minmax(0, 1.35fr) minmax(0, 1fr); gap:10px; margin-top:12px; }',
    '#tur .tu-al { display:flex; flex-direction:column; gap:8px; min-width:0; }',
    '#tur .tu-ar { display:grid; grid-template-columns:4px minmax(0, 1fr) auto; gap:10px; align-items:center; padding:10px 12px 10px 0; overflow:hidden; }',
    '#tur .tu-ar > i { align-self:stretch; background:var(--c); border-radius:0 4px 4px 0; }',
    '#tur .tu-ar.c-crit { --c:var(--crit); border-color:color-mix(in srgb, var(--crit) 45%, transparent); background:var(--critSoft); }',
    '#tur .tu-ar.c-high { --c:var(--tu-high); } #tur .tu-ar.c-mid { --c:var(--mid); }',
    '#tur .tu-ar b { display:block; font-size:13.5px; }',
    '#tur .tu-ar b .tu-mono { margin-right:6px; }',
    '#tur .tu-ar small { display:block; color:var(--mute); font-size:12px; }',
    '#tur .tu-ar.c-crit small { color:var(--tu-critInk); font-weight:700; }',
    '#tur .tu-mini { display:inline-flex; align-items:center; gap:4px; margin-top:6px; }',
    '#tur .tu-mini span { width:22px; height:22px; border-radius:50%; display:grid; place-items:center; background:var(--line); color:var(--mute); }',
    '#tur .tu-mini span svg.tu-i { width:12px; height:12px; }',
    '#tur .tu-mini span.done { background:var(--ok); color:#fff; } #tur .tu-mini span.on { background:var(--crit); color:#fff; box-shadow:0 0 0 4px rgba(239,68,68,.18); }',
    '#tur .tu-mini em { width:14px; height:2px; background:var(--line2); }',
    '#tur .tu-hist { padding:12px; min-width:0; }',
    '#tur .tu-hist ol { list-style:none; margin:8px 0 0; padding:0; position:relative; }',
    '#tur .tu-hist ol::before { content:""; position:absolute; left:7px; top:6px; bottom:6px; width:2px; background:var(--line); }',
    '#tur .tu-hist li { position:relative; display:flex; gap:10px; padding:5px 0; font-size:12.5px; }',
    '#tur .tu-hist li i { width:16px; height:16px; border-radius:50%; background:var(--card); border:2px solid var(--line2); flex:none; margin-top:2px; position:relative; }',
    '#tur .tu-hist li.d i { background:var(--ok); border-color:var(--ok); } #tur .tu-hist li.c i { background:var(--crit); border-color:var(--crit); }',
    '#tur .tu-hist li .tu-mono { color:var(--mute); flex:none; }',
    '#tur .tu-hist li.w { color:var(--mute); }',
    '#tur .tu-rule { margin-top:10px; display:inline-flex; align-items:center; gap:6px; font:700 11.5px Figtree, system-ui, sans-serif; padding:5px 9px; border-radius:8px; border:1px dashed var(--line2); color:var(--mute); }',
    '#tur .tu-rule svg.tu-i { width:13px; height:13px; }',
    /* görevler */
    '#tur .tu-tg { display:grid; grid-template-columns:62px repeat(6, minmax(0, 1fr)); gap:5px; margin-top:12px; }',
    '#tur .tu-hh { font:700 11px "JetBrains Mono", monospace; color:var(--mute); text-align:center; padding:3px 0; border-radius:6px; }',
    '#tur .tu-hh.now { background:var(--pri); color:var(--onpri); }',
    '#tur .tu-bn { font:700 12px "JetBrains Mono", monospace; display:flex; align-items:center; }',
    '#tur .tu-cell { height:40px; border-radius:9px; border:1px dashed var(--line2); display:flex; flex-direction:column; align-items:center; justify-content:center; font:700 10.5px/1.15 Figtree, system-ui, sans-serif; color:var(--mute); min-width:0; overflow:hidden; background:transparent; }',
    '#tur .tu-cell span { max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding:0 3px; }',
    '#tur .tu-cell small { font:600 9px "JetBrains Mono", monospace; opacity:.85; }',
    '#tur .tu-cell.up { border-style:solid; border-color:var(--line); background:var(--card); }',
    '#tur .tu-cell.dn { border:1px solid transparent; background:var(--okSoft); color:var(--tu-okInk); }',
    '#tur .tu-cell.nw { border:1px solid var(--pri); background:var(--priSoft); color:var(--priInk); }',
    '#tur .tu-cell.lt { border:1px solid var(--crit); background:var(--critSoft); color:var(--tu-critInk); }',
    '#tur .tu-lateb { display:flex; align-items:center; gap:8px; margin-top:12px; padding:9px 12px; border-radius:12px; background:var(--critSoft); color:var(--tu-critInk); font:700 12.5px Figtree, system-ui, sans-serif; border:1px solid color-mix(in srgb, var(--crit) 35%, transparent); }',
    '#tur .tu-lateb svg.tu-i { width:16px; height:16px; }',
    /* devir */
    '#tur .tu-hgrid { display:grid; grid-template-columns:190px minmax(0, 1fr); gap:10px; margin-top:12px; }',
    '#tur .tu-hlist { padding:8px; display:flex; flex-direction:column; gap:4px; }',
    '#tur .tu-hlist div { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:7px 9px; border-radius:9px; font-size:12.5px; }',
    '#tur .tu-hlist div.on { background:var(--priSoft); }',
    '#tur .tu-hlist b { font:700 12.5px "JetBrains Mono", monospace; }',
    '#tur .tu-hlist .tu-ok { color:var(--tu-okInk); font:700 11px Figtree, system-ui, sans-serif; } #tur .tu-hlist .tu-no { color:var(--tu-critInk); font:700 11px Figtree, system-ui, sans-serif; }',
    '#tur .tu-hnote { padding:12px 14px; display:flex; flex-direction:column; gap:10px; min-width:0; }',
    '#tur .tu-hsec h6 { margin:0 0 5px; font:700 11px Figtree, system-ui, sans-serif; color:var(--mute); text-transform:uppercase; letter-spacing:.06em; display:flex; align-items:center; gap:6px; }',
    '#tur .tu-hsec h6 svg.tu-i { width:13px; height:13px; }',
    '#tur .tu-hsec p { font-size:13px; padding:3px 0; display:flex; gap:8px; }',
    '#tur .tu-hsec p .tu-mono { color:var(--mute); flex:none; }',
    '#tur .tu-ta { border:1px solid var(--line2); border-radius:10px; padding:8px 10px; font-size:13px; background:var(--card2); }',
    '#tur .tu-hseal { display:flex; align-items:center; gap:10px; flex-wrap:wrap; border-top:1px solid var(--line); padding-top:10px; }',
    '#tur .tu-hseal small { color:var(--mute); font-size:12px; flex:1; min-width:150px; }',
    /* duvar (monitör: sabit koyu) */
    '#tur .tu-wall { background:#02060d; color:#e8eef7; border-radius:14px; padding:12px; border:1px solid #14223a; }',
    '#tur .tu-wl-top { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px; }',
    '#tur .tu-wl-top > b { font:700 15px "Space Grotesk", Figtree, sans-serif; margin-right:4px; }',
    '#tur .tu-wl-u { display:flex; gap:4px; flex-wrap:wrap; }',
    '#tur .tu-wl-u span { padding:4px 10px; border-radius:999px; border:1px solid #22324b; color:#a9bccf; font:600 11.5px Figtree, system-ui, sans-serif; white-space:nowrap; }',
    '#tur .tu-wl-u span.on { background:#22b8d6; color:#03141c; border-color:#22b8d6; }',
    '#tur .tu-wl-r { margin-left:auto; display:flex; align-items:center; gap:8px; color:#8fa1ba; font-size:12px; }',
    '#tur .tu-wl-fs { width:30px; height:30px; border-radius:8px; border:1px solid #2a3f60; background:#0a1628; display:grid; place-items:center; color:#a9bccf; }',
    '#tur .tu-wl-fs svg.tu-i { width:15px; height:15px; }',
    '#tur .tu-wg { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:8px; }',
    '#tur .tu-wt { background:#040a14; border:1px solid #1c2c45; border-radius:11px; padding:7px 9px; min-width:0; }',
    '#tur .tu-wt-h { display:flex; justify-content:space-between; align-items:center; font:700 12px "JetBrains Mono", monospace; color:#a9bccf; }',
    '#tur .tu-wt .tu-ecg { height:26px; margin:4px 0; }',
    '#tur .tu-wt-n { display:flex; justify-content:space-between; align-items:baseline; }',
    '#tur .tu-wt-n b { font:700 18px "JetBrains Mono", monospace; }',
    '#tur .tu-wt-n small { font:700 9px Figtree, system-ui, sans-serif; color:#6f86a3; display:block; }',
    '#tur .tu-wt.crit { border-color:#ef4444; box-shadow:0 0 0 1px #ef4444, 0 0 18px rgba(239,68,68,.4); animation:tur-wcrit 1s steps(2, jump-none) infinite; }',
    '@keyframes tur-wcrit { 50% { box-shadow:none; } }',
    '#tur .tu-wt.crit .tu-ecg canvas { color:#ef4444; }',
    '#tur .tu-wt-al { margin-top:5px; font:700 11px Figtree, system-ui, sans-serif; background:#b91c1c; color:#fff; border-radius:6px; padding:3px 7px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    '#tur .tu-wt.man { border-style:dashed; }',
    '#tur .tu-mv { display:flex; gap:12px; margin:8px 0 4px; }',
    '#tur .tu-mv b { font:700 17px "JetBrains Mono", monospace; opacity:.85; }',
    '#tur .tu-mt { font-size:10.5px; color:#7dd3e6; }',
    /* dar ekran */
    '@media (max-width:1080px) {',
    '  #tur .tu-stage { grid-template-columns:minmax(0, 1fr); }',
    '  #tur .tu-bub { display:none; }',
    '}',
    '@media (max-width:760px) {',
    '  #tur .tu-bgrid { grid-template-columns:repeat(2, minmax(0, 1fr)); }',
    '  #tur .tu-bgrid .tu-bc:nth-child(n+7) { display:none; }',
    '  #tur .tu-pgrid, #tur .tu-agrid, #tur .tu-hgrid { grid-template-columns:minmax(0, 1fr); }',
    '  #tur .tu-hlist { flex-direction:row; flex-wrap:wrap; }',
    '  #tur .tu-hlist div { flex:1 1 40%; }',
    '  #tur .tu-wg { grid-template-columns:repeat(2, minmax(0, 1fr)); }',
    '  #tur .tu-wg .tu-wt:nth-child(n+5) { display:none; }',
    '  #tur .tu-wl-r .tu-clk2 { display:none; }',
    '}',
    '@media (max-width:640px) {',
    '  #tur .tu-tab { flex:0 0 auto; padding:9px 12px; font-size:13.5px; }',
    '  #tur .tu-body { padding:10px; min-height:0; }',
    '  #tur .tu-wdots { display:none; }',
    '  #tur .tu-tg { grid-template-columns:44px repeat(6, minmax(0, 1fr)); gap:3px; }',
    '  #tur .tu-cell span { display:none; }',
    '  #tur .tu-vals b { font-size:15px; }',
    '  #tur .tu-srow .tu-btn { margin-left:0; }',
    '  #tur .tu-notes { padding:14px; }',
    '}',
    '@media (prefers-reduced-motion:reduce) {',
    '  #tur *, #tur *::before, #tur *::after { animation:none !important; transition:none !important; }',
    '}'
  ].join("\n");
  if (!document.getElementById("tur-css")) {
    var st = document.createElement("style"); st.id = "tur-css"; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- sözlük: [AZ, TR, RU, EN] — a4.html'den aynen ---------- */
  var T = {
    nav_tour:["Məhsul turu", "Ürün turu", "Тур по продукту", "Product tour"],
    t1:["Qərarı həkim verir", "Kararı hekim verir", "Решает врач", "The physician decides"],
    t2:["Şifrəli bağlantı", "Şifreli bağlantı", "Защищённое соединение", "Encrypted connection"],
    tip:["Nömrəli nöqtələrə toxunun", "Numaralı noktalara dokunun", "Нажимайте на пронумерованные точки", "Tap the numbered dots"],
    auto_on:["Tur özü irəliləyir", "Tur kendiliğinden ilerliyor", "Тур идёт сам", "The tour is playing"],
    auto_off:["Tur dayandı", "Tur durdu", "Тур остановлен", "Tour paused"],
    play:["Davam et", "Devam et", "Продолжить", "Resume"],
    pause:["Dayandır", "Durdur", "Пауза", "Pause"],
    tb_beds:["Çarpayılar", "Yataklar", "Койки", "Beds"],
    tb_pt:["Xəstə", "Hasta", "Пациент", "Patient"],
    tb_al:["Siqnallar", "Alarmlar", "Тревоги", "Alarms"],
    tb_tk:["Tapşırıqlarım", "Görevlerim", "Мои задачи", "My tasks"],
    tb_ho:["Təhvil", "Devir", "Передача", "Handover"],
    tb_wall:["Divar monitoru", "Duvar monitörü", "Настенный монитор", "Wall monitor"],
    x_beds:["Şöbənin bütün çarpayıları bir ekranda: dəyərlər, şkala, açıq işlər.", "Birimin bütün yatakları tek ekranda: değerler, skor, açık işler.", "Все койки отделения на одном экране: показатели, шкала, открытые задачи.", "Every bed in the unit on one screen: values, score, open tasks."],
    x_pt:["Bir çarpayının təfərrüatı: meyillər, şkalalar, hər dəyərin mənbəyi.", "Bir yatağın ayrıntısı: eğilimler, skorlar, her değerin kaynağı.", "Подробно об одной койке: тренды, шкалы, источник каждого значения.", "One bed in detail: trends, scores and the source of every value."],
    x_al:["Açıq siqnallar və xəbər zənciri: kim, nə vaxt gördü.", "Açık alarmlar ve haber zinciri: kim, ne zaman gördü.", "Открытые тревоги и цепочка оповещения: кто и когда увидел.", "Open alarms and the alert chain: who saw what, and when."],
    x_tk:["Saat-saat iş cədvəli; gecikən iş önə çıxır.", "Saat saat iş ızgarası; geciken iş öne çıkar.", "Почасовая сетка задач; просроченное выходит вперёд.", "An hour-by-hour task grid; overdue work stands out."],
    x_ho:["Növbə sonu təhvil qeydi: sistem toplayır, komanda tamamlayır, qeyd möhürlənir.", "Nöbet sonu teslim notu: sistem toplar, ekip tamamlar, not mühürlenir.", "Записка в конце смены: система собирает, команда дополняет, записка скрепляется.", "The end-of-shift note: the system gathers, the team completes, the note is sealed."],
    x_wall:["Şöbə divarındakı ekran: bütün çarpayılar, uzaqdan oxunur.", "Birim duvarındaki ekran: bütün yataklar, uzaktan okunur.", "Экран на стене отделения: все койки, читается издалека.", "The screen on the unit wall: every bed, readable from across the room."],
    hb1t:["Erkən xəbərdarlıq şkalası", "Erken uyarı skoru", "Шкала раннего предупреждения", "Early warning score"],
    hb1d:["Hər kartın küncündə. Rəng yalnız baxılacaq sıranı göstərir; nə ediləcəyinə həkim qərar verir.", "Her kartın köşesinde. Renk yalnız bakılacak sırayı gösterir; ne yapılacağına hekim karar verir.", "В углу каждой карточки. Цвет показывает лишь очерёдность внимания; что делать, решает врач.", "In the corner of every card. The colour only shows what to look at first; the physician decides what to do."],
    hb2t:["Dəyərin mənbəyi", "Değerin kaynağı", "Источник значения", "Where a value came from"],
    hb2d:["Monitor, portativ cihaz, yoxsa əl ilə — və saatı. Hər dəyərin yanında yazılır.", "Monitör mü, portatif cihaz mı, elle mi — ve saati. Her değerin yanında yazar.", "Монитор, портативный прибор или вручную — и время. Указано у каждого значения.", "Monitor, portable device or manual — and the time. It sits beside every value."],
    hb3t:["Açıq işlər", "Açık işler", "Открытые задачи", "Open tasks"],
    hb3d:["Növbəsi çatan işlərin sayı kartın üstündədir; toxunanda siyahı açılır.", "Sırası gelen işlerin sayı kartın üstünde; dokununca liste açılır.", "Число задач, срок которых подошёл, — прямо на карточке; нажатие открывает список.", "The number of tasks now due sits on the card; tap it to open the list."],
    hb4t:["Şöbə seçimi", "Birim seçici", "Выбор отделения", "Unit picker"],
    hb4d:["Yalnız səlahiyyətiniz olan şöbələr göstərilir.", "Yalnız yetkili olduğunuz birimler listelenir.", "В списке только отделения, к которым у вас есть доступ.", "Only the units you're authorised for are listed."],
    hp1t:["12 saatlıq meyil", "12 saatlik eğilim", "Тренд за 12 часов", "12-hour trend"],
    hp1d:["Dəyərin gedişi, xəstəxananın müəyyən etdiyi hədd zolağı ilə birlikdə.", "Değerin gidişi, hastanenin belirlediği eşik bandıyla birlikte.", "Динамика значения вместе с пороговой полосой, заданной больницей.", "How the value has moved, drawn against the threshold band the hospital set."],
    hp2t:["Şkala qaralaması", "Skor taslağı", "Черновик шкалы", "Score draft"],
    hp2d:["Şkalanı sistem doldurur; həkim təsdiqləyənə qədər qaralama qalır.", "Skoru sistem doldurur; hekim onaylayana kadar taslak kalır.", "Шкалу заполняет система; до подтверждения врачом это черновик.", "The system fills the score; it stays a draft until the physician confirms it."],
    hp3t:["Cihaz və saat", "Cihaz ve saat", "Прибор и время", "Device and time"],
    hp3d:["Hər dəyər hansı cihazdan, hansı saatda gəldiyini daşıyır.", "Her değer hangi cihazdan, hangi saatte geldiğini taşır.", "Каждое значение несёт название прибора и время.", "Every value carries the device it came from and the time."],
    hp4t:["Qərarı həkim verir", "Kararı hekim verir", "Решает врач", "The physician decides"],
    hp4d:["Məhsul diaqnoz qoymur, müalicə təklif etmir; məlumatı səliqəli göstərir.", "Ürün tanı koymaz, tedavi önermez; veriyi düzenli gösterir.", "Продукт не ставит диагноз и не назначает лечение; он упорядоченно показывает данные.", "The product doesn't diagnose or prescribe; it lays the data out clearly."],
    ha1t:["Xəbər zənciri", "Haber zinciri", "Цепочка оповещения", "Alert chain"],
    ha1d:["Tibb bacısı → 3 dəq → baş tibb bacısı → 5 dəq → həkim. Müddətləri xəstəxana müəyyən edir.", "Hemşire → 3 dk → sorumlu hemşire → 5 dk → hekim. Süreleri hastane belirler.", "Медсестра → 3 мин → старшая медсестра → 5 мин → врач. Интервалы задаёт больница.", "Nurse → 3 min → charge nurse → 5 min → physician. The hospital sets the timings."],
    ha2t:["«Gördüm»", "«Gördüm»", "«Увидел(а)»", "“Seen”"],
    ha2d:["Bir toxunuş zənciri dayandırır; kimin gördüyü saatı ilə yazılır.", "Tek dokunuş zinciri durdurur; kimin gördüğü saatiyle yazılır.", "Одно касание останавливает цепочку; кто увидел — записывается со временем.", "One tap stops the chain; who saw it is written down with the time."],
    ha3t:["Tarixçə", "Geçmiş", "История", "History"],
    ha3d:["Hər pillə vaxt damğası ilə; sonradan yoxlanıla bilər.", "Her basamak zaman damgasıyla; sonradan denetlenebilir.", "Каждый шаг с отметкой времени; всё можно проверить позже.", "Every step is time-stamped and can be audited later."],
    ha4t:["Şöbə qaydası", "Birim kuralı", "Правило отделения", "Unit rule"],
    ha4d:["Hansı şkala, hansı hədd, neçə dəqiqə — şöbə üzrə tənzimlənir.", "Hangi skor, hangi eşik, kaç dakika — birim bazında ayarlanır.", "Какая шкала, какой порог, сколько минут — настраивается для каждого отделения.", "Which score, which threshold, how many minutes — set per unit."],
    hk1t:["İndiki saat", "Şimdiki saat", "Текущий час", "Current hour"],
    hk1d:["Sütun seçilib; növbəsi çatan işlər buradadır.", "Sütun vurgulu; sırası gelen işler burada.", "Столбец выделен; здесь задачи, срок которых подошёл.", "The column is highlighted; tasks now due live here."],
    hk2t:["Bir toxunuşla bağla", "Tek dokunuşla kapat", "Закрыть одним касанием", "Close with one tap"],
    hk2d:["Kim bağladı, hansı saatda — qeydə düşür.", "Kim kapattı, hangi saatte — kayda geçer.", "Кто закрыл и когда — попадает в запись.", "Who closed it, and when, goes on the record."],
    hk3t:["Gecikən iş", "Geciken iş", "Просроченная задача", "Overdue task"],
    hk3d:["Qırmızıya dönür və baş tibb bacısının siyahısında da görünür.", "Kırmızıya döner ve sorumlu hemşirenin listesinde de görünür.", "Краснеет и появляется также в списке старшей медсестры.", "It turns red and also appears on the charge nurse's list."],
    hk4t:["Qulluq planından", "Bakım planından", "Из плана ухода", "From the care plan"],
    hk4d:["İşlər qulluq planından gəlir; əl ilə yenidən qurulmur.", "İşler bakım planından gelir; elle yeniden kurulmaz.", "Задачи берутся из плана ухода; вручную их заново не заводят.", "Tasks come from the care plan; nobody re-enters them by hand."],
    hh1t:["Avtomatik xülasə", "Otomatik özet", "Автосводка", "Automatic summary"],
    hh1d:["Şkalalar, siqnallar və işlər növbə boyu toplanır.", "Skorlar, alarmlar ve işler nöbet boyunca toplanır.", "Шкалы, тревоги и задачи собираются в течение смены.", "Scores, alarms and tasks are gathered through the shift."],
    hh2t:["Keçən işlər", "Devreden işler", "Переходящие задачи", "Carried-over tasks"],
    hh2d:["Bağlanmayan iş itmir, növbəti növbəyə keçir.", "Kapanmayan iş kaybolmaz, sonraki nöbete geçer.", "Незакрытая задача не теряется, а переходит в следующую смену.", "An unfinished task isn't lost; it moves to the next shift."],
    hh3t:["Möhür", "Mühür", "Печать", "Seal"],
    hh3d:["Möhürlənmiş qeyd dəyişdirilmir; təhvil alan şəxs və saat əlavə olunur.", "Mühürlenen not değiştirilemez; devralan kişi ve saat eklenir.", "Скреплённую записку нельзя изменить; добавляются принявший и время.", "A sealed note can't be changed; the person taking over, and the time, are added."],
    hh4t:["Çatışmayan qeydlər", "Eksik notlar", "Недостающие записи", "Missing notes"],
    hh4d:["Hansı çarpayının qeydi yazılmayıb, siyahıda görünür.", "Hangi yatağın notu yazılmadı, listede görünür.", "В списке видно, по какой койке записка ещё не написана.", "The list shows which beds still have no note."],
    hw1t:["Kritik kart", "Kritik kart", "Критическая карточка", "Critical tile"],
    hw1d:["Siqnaldakı çarpayı qırmızı çərçivə ilə uzaqdan seçilir.", "Alarmdaki yatak kırmızı çerçeveyle uzaktan seçilir.", "Койка с тревогой видна издалека по красной рамке.", "A bed in alarm is picked out from across the room by its red frame."],
    hw2t:["Portativ ölçmə", "Portatif ölçüm", "Портативное измерение", "Portable reading"],
    hw2d:["Monitoru olmayan çarpayıda son ölçmə və saatı göstərilir.", "Monitörü olmayan yatakta son ölçüm ve saati gösterilir.", "Для койки без монитора показано последнее измерение и его время.", "A bed without a monitor shows its last reading and when it was taken."],
    hw3t:["Şöbələr", "Birimler", "Отделения", "Units"],
    hw3d:["Bir toxunuşla başqa şöbənin divarına keçilir.", "Bir dokunuşla başka birimin duvarına geçilir.", "Одним касанием — на экран другого отделения.", "One tap switches to another unit's wall."],
    hw4t:["Tam ekran", "Tam ekran", "Во весь экран", "Full screen"],
    hw4d:["Şöbə ekranında daim açıq qalmaq üçün hazırlanıb.", "Birim ekranında sürekli açık kalacak şekilde tasarlandı.", "Рассчитан на то, чтобы постоянно работать на экране отделения.", "Built to stay open all day on the unit's screen."],
    sb_upd:["Son yeniləmə", "Son güncelleme", "Обновлено", "Updated"],
    s_unit:["Reanimasiya", "Erişkin yoğun bakım", "Реанимация", "Adult ICU"],
    f_all:["Hamısı", "Tümü", "Все", "All"],
    f_attn:["Diqqət", "Dikkat", "Внимание", "Attention"],
    f_calm:["Sabit", "Sakin", "Стабильно", "Calm"],
    src_mon:["Monitor", "Monitör", "Монитор", "Monitor"],
    src_port:["Portativ", "Portatif", "Портатив", "Portable"],
    n_task:["iş", "iş", "задачи", "tasks"],
    empty:["Boş · təmiz", "Boş · temiz", "Свободна · чистая", "Empty · clean"],
    ready:["Qəbula hazırdır", "Kabule hazır", "Готова к приёму", "Ready for admission"],
    v_hr:["Nəbz", "Nabız", "ЧСС", "HR"],
    v_rr:["Tənəffüs", "Solunum", "ЧДД", "RR"],
    v_t:["Hərarət", "Ateş", "Темп.", "Temp"],
    u_m:["dəq", "dk", "мин", "min"],
    u_pm:["/dəq", "/dk", "/мин", "/min"],
    sexage:["Q · 67", "K · 67", "Ж · 67", "F · 67"],
    day4:["yatışın 4-cü günü", "yatışın 4. günü", "4-й день госпитализации", "day 4 of stay"],
    st_sum:["Xülasə", "Özet", "Сводка", "Summary"],
    st_tr:["Meyillər", "Eğilimler", "Тренды", "Trends"],
    st_sc:["Şkalalar", "Skorlar", "Шкалы", "Scores"],
    st_cp:["Qulluq planı", "Bakım planı", "План ухода", "Care plan"],
    last12:["son 12 saat", "son 12 saat", "за 12 часов", "last 12 h"],
    band:["hədd zolağı", "eşik bandı", "пороговая полоса", "threshold band"],
    sysc:["sistem hesabladı", "sistem hesapladı", "рассчитано системой", "system-calculated"],
    draft:["qaralama", "taslak", "черновик", "draft"],
    await:["həkim təsdiqi gözlənilir", "hekim onayı bekliyor", "ждёт подтверждения врача", "awaiting physician sign-off"],
    confirm:["Təsdiqlə", "Onayla", "Подтвердить", "Confirm"],
    pt_note:["Şkala və meyillər həkimin qiymətləndirməsi üçündür. Qərarı həkim verir.", "Skorlar ve eğilimler hekimin değerlendirmesi içindir. Kararı hekim verir.", "Шкалы и тренды — для оценки врачом. Решение за врачом.", "Scores and trends are there for the physician's assessment. The physician decides."],
    al_open:["Açıq", "Açık", "Открытые", "Open"],
    al_today:["Bu gün", "Bugün", "Сегодня", "Today"],
    a1s:["3 dəq cavab yoxdur → baş tibb bacısı", "3 dk yanıt yok → sorumlu hemşire", "3 мин без ответа → старшая медсестра", "No response in 3 min → charge nurse"],
    a2s:["Tibb bacısı gördü · 21:41", "Hemşire gördü · 21:41", "Медсестра увидела · 21:41", "Nurse acknowledged · 21:41"],
    a3s:["Tibb bacısı gördü · 22:04", "Hemşire gördü · 22:04", "Медсестра увидела · 22:04", "Nurse acknowledged · 22:04"],
    ack:["Gördüm", "Gördüm", "Увидел(а)", "Seen"],
    hist:["Tarixçə", "Geçmiş", "История", "History"],
    hs1:["Tibb bacısına xəbər verildi", "Hemşireye haber verildi", "Медсестра уведомлена", "Nurse notified"],
    hs2:["Baş tibb bacısına keçdi", "Sorumlu hemşireye çıktı", "Передано старшей медсестре", "Escalated to charge nurse"],
    hs3:["Həkimə keçəcək", "Hekime çıkacak", "Будет передано врачу", "Physician next"],
    rule:["Qayda", "Kural", "Правило", "Rule"],
    k_pos:["Mövqe", "Pozisyon", "Положение", "Turning"],
    k_obs:["Ölçmə", "Ölçüm", "Измерение", "Reading"],
    k_care:["Qulluq", "Bakım", "Уход", "Care"],
    lateb:["1 iş gecikir · REA03 · 21:00 · baş tibb bacısı görür", "1 iş gecikti · REA03 · 21:00 · sorumlu hemşire görüyor", "1 задача просрочена · REA03 · 21:00 · видит старшая медсестра", "1 task overdue · REA03 · 21:00 · the charge nurse can see it"],
    fromPlan:["Qulluq planından", "Bakım planından", "Из плана ухода", "From the care plan"],
    ho_ok:["Yazıldı", "Yazıldı", "Готово", "Written"],
    ho_no:["Çatışmır", "Eksik", "Нет записи", "Missing"],
    sec_auto:["Sistemin xülasəsi", "Sistem özeti", "Сводка системы", "System summary"],
    ha_l1:["NEWS2 5 → 7 · baş tibb bacısına xəbər", "NEWS2 5 → 7 · sorumlu hemşireye haber", "NEWS2 5 → 7 · сообщено старшей медсестре", "NEWS2 5 → 7 · charge nurse alerted"],
    ha_l2:["SOFA 5 · həkim təsdiqlədi", "SOFA 5 · hekim onayladı", "SOFA 5 · подтверждено врачом", "SOFA 5 · physician confirmed"],
    sec_open:["Keçən işlər (2)", "Devreden işler (2)", "Переходящие задачи (2)", "Carried-over tasks (2)"],
    sec_note:["Komandanın qeydi", "Ekibin notu", "Запись команды", "Team note"],
    note_tx:["Ailə ilə görüş 10:00-a planlaşdırılıb.", "Aile görüşmesi 10:00'a planlandı.", "Встреча с семьёй запланирована на 10:00.", "Family meeting planned for 10:00."],
    seal:["Möhürlə", "Mühürle", "Скрепить", "Seal"],
    seal_s:["Gündüz komandası təhvil alanda qeyd bağlanır", "Gündüz ekibi devralınca kayıt kapanır", "Запись закрывается, когда дневная смена примет её", "The record closes when the day team takes over"],
    wall_t:["Divar monitoru", "Duvar monitörü", "Настенный монитор", "Wall monitor"],
    u_kvc:["KVC reanimasiyası", "KVC yoğun bakım", "Кардиореанимация", "Cardiac ICU"],
    u_nic:["Yenidoğulmuş", "Yenidoğan", "Неонатальная", "Neonatal"],
    port_last:["Portativ · son 21:40", "Portatif · son 21:40", "Портатив · посл. 21:40", "Portable · last 21:40"],
  };
  var t = function (k) { var r = T[k]; return r ? r[IDX[lang]] : k; };

  /* ---------- simgeler (a4 / app/core.js ile aynı çizgiler) ---------- */
  var P = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
    bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    clip:'<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    tv:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    building:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
    chevD:'<path d="m6 9 6 6 6-6"/>',
    bed:'<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>',
    tablet:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/>',
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    userPlus:'<circle cx="9" cy="7" r="4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M19 8v6M22 11h-6"/>',
    heart:'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
    ok:'<path d="M20 6 9 17l-5-5"/>',
    gear:'<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    chart:'<path d="M3 3v18h18"/><path d="M7 16V9M12 16V5M17 16v-4"/>',
    lock:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    full:'<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    play:'<path d="M7 4v16l13-8Z"/>',
    pause:'<path d="M8 4v16M16 4v16"/>',
    hand:'<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  };
  var ic = function (k, style) { return '<svg class="tu-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (style ? ' style="' + style + '"' : "") + ">" + (P[k] || "") + "</svg>"; };

  /* ---------- ekranlar (uydurma değerler; hasta adı yok, yalnız yatak kodu) ---------- */
  /* EKG şeridi: canvas, canlı motor aşağıda (her yatağın kendi ritmi ve dalga biçimi) */
  var ecg = '<div class="tu-ecg" aria-hidden="true"><canvas></canvas></div>';
  /* canlı değer: sayı <data> içinde; data-v başlangıç değeri, motor küçük sınırlar içinde oynatır */
  var lv = function (kind, v) { return '<data data-lv="' + kind + '" data-v="' + v + '">' + v + "</data>"; };
  var clk = '<span class="tu-mono" data-clk="1">22:14:00</span>';
  var hs = function (n, a) { return ' data-hs="' + n + '" data-ha="' + (a || "tm") + '"'; };
  var BEDS = [
    ["REA01", "high", 7, 118, 91, 64, "mon", "22:14", 2], ["REA02", "mid", 5, 104, 94, 72, "mon", "22:14", 1], ["REA03", "ok", 1, 88, 97, 81, "mon", "22:14", 0], ["REA04", "ok", 0, 76, 98, 85, "mon", "22:14", 1],
    ["REA05", "ok", 2, 92, 96, 78, "port", "21:40", 0], ["REA06", "mid", 4, 110, 95, 70, "mon", "22:14", 2], ["REA07", "ok", 0, 70, 99, 88, "mon", "22:14", 0], null];
  function sBeds() {
    var cards = BEDS.map(function (b, i) {
      if (!b) return '<div class="tu-bc empty"><div class="tu-bc-h"><b class="tu-mono">REA08</b><span class="tu-sb">' + ic("bed", "width:12px;height:12px") + "</span></div><p>" + t("empty") + "<br>" + t("ready") + "</p></div>";
      /* portatif yatak (REA05) aralıklı ölçümdür: değerleri oynamaz */
      var live = b[6] === "mon", V = function (k, v) { return live ? lv(k, v) : v; };
      return '<div class="tu-bc r-' + b[1] + '"' + (live ? ' data-bed="' + b[0] + '"' : "") + '><div class="tu-bc-h"><b class="tu-mono">' + b[0] + '</b><span class="tu-sb ' + (b[1] === "ok" ? "" : b[1]) + '"' + (i === 0 ? hs(1, "l") : "") + ">NEWS2 " + b[2] + "</span></div>" +
        '<div class="tu-vals"><span><small>' + t("v_hr") + '</small><b style="color:var(--tu-vhr)">' + V("hr", b[3]) + '</b></span><span><small>SpO₂</small><b style="color:var(--tu-vspo)">' + V("spo", b[4]) + '</b></span><span><small>MAP</small><b style="color:var(--tu-vmap)">' + V("map", b[5]) + "</b></span></div>" +
        '<div class="tu-bc-f"><span class="tu-srct"' + (i === 4 ? hs(2, "r") : "") + ">" + ic(b[6] === "port" ? "tablet" : "tv") + t(b[6] === "port" ? "src_port" : "src_mon") + " · " + b[7] + "</span>" + (b[8] ? '<span class="tu-tk"' + (i === 5 ? hs(3, "l") : "") + ">" + b[8] + " " + t("n_task") + "</span>" : "") + "</div></div>";
    }).join("");
    return '<div class="tu-row"><span class="tu-chip"' + hs(4, "r") + ">" + ic("building") + t("s_unit") + " " + ic("chevD") + '</span><span class="tu-sp"></span><span class="tu-chip on">' + t("f_all") + ' <em>8</em></span><span class="tu-chip">' + t("f_attn") + ' <em>3</em></span><span class="tu-chip">' + t("f_calm") + " <em>4</em></span></div>" +
      '<div class="tu-bgrid">' + cards + "</div>";
  }
  function sPatient() {
    var pts = [95, 96, 95, 96, 95, 94, 95, 93, 92, 93, 94, 94];
    var line = pts.map(function (v, i) { return (i / 11 * 300).toFixed(1) + "," + (90 - (v - 86) * 7).toFixed(1); }).join(" ");
    return '<div class="tu-pt-h"><span class="tu-bedno">REA02</span><span class="tu-meta">' + t("s_unit") + " · " + t("sexage") + " · " + t("day4") + "</span></div>" +
      '<div class="tu-subtabs"><span class="on">' + t("st_sum") + "</span><span>" + t("st_tr") + "</span><span>" + t("st_sc") + "</span><span>" + t("st_cp") + "</span></div>" +
      '<div class="tu-pgrid"><div class="tu-mon" data-bed="REA02"><div class="tu-mon-h"><span class="tu-src"' + hs(3, "tm") + ">" + ic("tv") + t("src_mon") + " · MX-12</span>" + clk + "</div>" + ecg +
      '<div class="tu-mnum"><span style="--c:#22e05a"><small>' + t("v_hr") + "</small><b>" + lv("hr", 104) + "<em>" + t("u_pm") + '</em></b></span><span style="--c:#ffe14a"><small>SpO₂</small><b>' + lv("spo", 94) + '<em>%</em></b></span><span style="--c:#ff7a7a"><small>MAP</small><b>' + lv("map", 72) + '</b></span><span style="--c:#3fd8ff"><small>' + t("v_rr") + "</small><b>" + lv("rr", 22) + "<em>" + t("u_pm") + "</em></b></span></div></div>" +
      '<div><div class="tu-card tu-trend"' + hs(1) + '><div class="tu-trend-h"><span>SpO₂ · ' + t("last12") + '</span><small><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--critSoft);border:1px solid var(--crit);vertical-align:-1px"></i> ' + t("band") + "</small></div>" +
      '<svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true"><rect class="band" x="0" y="62" width="300" height="38"/><line class="gl" x1="0" y1="20" x2="300" y2="20"/><line class="gl" x1="0" y1="55" x2="300" y2="55"/><polyline class="ln" points="' + line + '"/></svg>' +
      '<div style="display:flex;justify-content:space-between;font:600 10px \'JetBrains Mono\', monospace;color:var(--mute)"><span>10:00</span><span>16:00</span><span>22:00</span></div></div>' +
      '<div class="tu-score"><div class="tu-card tu-srow"><span class="tu-nm">NEWS2</span><span class="tu-big">5</span><small>21:00 · ' + t("sysc") + "</small></div>" +
      '<div class="tu-card tu-srow"' + hs(2) + '><span class="tu-nm">SOFA</span><span class="tu-big">4</span><span class="tu-badge">' + t("draft") + "</span><small>" + t("await") + '</small><button type="button" class="tu-btn tu-p tu-sm" tabindex="-1">' + t("confirm") + "</button></div></div></div></div>" +
      '<div class="tu-notice"' + hs(4) + ">" + ic("shield") + t("pt_note") + "</div>";
  }
  function sAlarms() {
    var mini = '<div class="tu-mini"' + hs(1, "r") + '><span class="done">' + ic("bell") + '</span><em></em><span class="on">' + ic("userPlus") + "</span><em></em><span>" + ic("heart") + "</span></div>";
    return '<div class="tu-row"><span class="tu-chip on">' + t("al_open") + ' <em>3</em></span><span class="tu-chip">' + t("al_today") + ' <em>11</em></span><span class="tu-sp"></span><span class="tu-chip tu-mono">22:14</span></div>' +
      '<div class="tu-agrid"><div class="tu-al">' +
      '<div class="tu-card tu-ar c-crit"><i></i><div><b><span class="tu-mono">REA03</span>SpO₂ 86 · 3 ' + t("u_m") + "</b><small>" + t("a1s") + "</small>" + mini + '</div><button type="button" class="tu-btn tu-p tu-sm" tabindex="-1"' + hs(2) + ">" + ic("ok") + t("ack") + "</button></div>" +
      '<div class="tu-card tu-ar c-high"><i></i><div><b><span class="tu-mono">REA01</span>NEWS2 5 → 7</b><small>' + t("a2s") + '</small></div><span class="tu-badge ok">' + ic("ok", "width:12px;height:12px") + "</span></div>" +
      '<div class="tu-card tu-ar c-mid"><i></i><div><b><span class="tu-mono">REA06</span>MAP 64</b><small>' + t("a3s") + '</small></div><span class="tu-badge ok">' + ic("ok", "width:12px;height:12px") + "</span></div>" +
      '</div><div class="tu-card tu-hist"' + hs(3) + '><div class="tu-ttl">' + t("hist") + " · REA03</div><ol>" +
      '<li class="d"><i></i><span class="tu-mono">22:11</span><span>' + t("hs1") + '</span></li><li class="c"><i></i><span class="tu-mono">22:14</span><span>' + t("hs2") + '</span></li><li class="w"><i></i><span class="tu-mono">22:16</span><span>' + t("hs3") + "</span></li></ol>" +
      '<span class="tu-rule"' + hs(4, "r") + ">" + ic("gear") + t("rule") + " · SpO₂ · 3 / 5 " + t("u_m") + "</span></div></div>";
  }
  function sTasks() {
    var H = ["20", "21", "22", "23", "00", "01"], R = [["REA01", ["pos", "obs", "pos", "care", "pos", "obs"]], ["REA02", ["obs", "pos", "obs", "pos", null, "pos"]], ["REA03", ["pos", "obs", "pos", null, "obs", "pos"]], ["REA04", [null, "pos", "care", "obs", "pos", null]], ["REA05", ["obs", null, "pos", "obs", null, "pos"]]];
    var g = "<span></span>" + H.map(function (h, i) { return '<span class="tu-hh' + (i === 2 ? " now" : "") + '"' + (i === 2 ? hs(1) : "") + ">" + h + ":00</span>"; }).join("");
    R.forEach(function (r, ri) {
      g += '<span class="tu-bn">' + r[0] + "</span>" + r[1].map(function (k, hi) {
        if (!k) return '<span class="tu-cell"></span>';
        var cls = hi < 2 ? "dn" : hi === 2 ? "nw" : "up", extra = "", h2 = "";
        if (ri === 2 && hi === 1) { cls = "lt"; h2 = hs(3); }
        if (ri === 0 && hi === 2) { cls = "dn"; extra = "<small>✓ 22:04</small>"; h2 = hs(2); }
        return '<span class="tu-cell ' + cls + '"' + h2 + "><span>" + t("k_" + k) + "</span>" + extra + "</span>";
      }).join("");
    });
    return '<div class="tu-row"><span class="tu-chip">' + ic("list") + t("tb_tk") + '</span><span class="tu-chip"' + hs(4, "r") + ">" + ic("clip") + t("fromPlan") + '</span><span class="tu-sp"></span><span class="tu-chip tu-mono">22:14</span></div><div class="tu-tg">' + g + '</div><div class="tu-lateb">' + ic("alert") + t("lateb") + "</div>";
  }
  function sHand() {
    var L = [["REA01", 1, 1], ["REA02", 1, 0], ["REA03", 0, 0], ["REA04", 1, 0], ["REA05", 1, 0], ["REA06", 0, 0], ["REA07", 1, 0]];
    return '<div class="tu-row"><span class="tu-chip">' + ic("clip") + t("tb_ho") + ' · 07:40</span><span class="tu-sp"></span><span class="tu-chip">' + t("s_unit") + "</span></div>" +
      '<div class="tu-hgrid"><div class="tu-card tu-hlist"' + hs(4) + ">" + L.map(function (x) { return '<div class="' + (x[2] ? "on" : "") + '"><b>' + x[0] + "</b>" + (x[1] ? '<span class="tu-ok">✓ ' + t("ho_ok") + "</span>" : '<span class="tu-no">' + t("ho_no") + "</span>") + "</div>"; }).join("") + "</div>" +
      '<div class="tu-card tu-hnote"><div class="tu-hsec"' + hs(1, "tr") + "><h6>" + ic("chart") + t("sec_auto") + '</h6><p><span class="tu-mono">21:38</span>' + t("ha_l1") + '</p><p><span class="tu-mono">05:34</span>' + t("ha_l2") + "</p></div>" +
      '<div class="tu-hsec"' + hs(2, "tr") + "><h6>" + ic("list") + t("sec_open") + '</h6><p><span class="tu-mono">08:00</span>' + t("k_pos") + '</p><p><span class="tu-mono">09:00</span>' + t("k_obs") + "</p></div>" +
      '<div class="tu-hsec"><h6>' + ic("user") + t("sec_note") + '</h6><div class="tu-ta">' + t("note_tx") + "</div></div>" +
      '<div class="tu-hseal"><button type="button" class="tu-btn tu-p tu-sm" tabindex="-1"' + hs(3) + ">" + ic("lock") + t("seal") + "</button><small>" + t("seal_s") + "</small></div></div></div>";
  }
  function sWall() {
    var W = [["REA01", 118, 91, 0], ["REA02", 104, 94, 0], ["REA03", 126, 86, 1], ["REA04", 76, 98, 0], ["REA05", 0, 0, 2], ["REA06", 110, 95, 0], ["REA07", 70, 99, 0], ["REA08", 0, 0, 3]];
    var tiles = W.map(function (w) {
      if (w[3] === 3) return '<div class="tu-wt man" style="opacity:.45"><div class="tu-wt-h"><span>REA08</span></div><div class="tu-mt" style="margin-top:14px;color:#6f86a3">' + t("empty") + "</div></div>";
      if (w[3] === 2) return '<div class="tu-wt man"' + hs(2) + '><div class="tu-wt-h"><span>REA05</span>' + ic("tablet", "width:13px;height:13px;color:#7dd3e6") + '</div><div class="tu-mv"><b style="color:#22e05a">92</b><b style="color:#ffe14a">96</b></div><div class="tu-mt">' + t("port_last") + "</div></div>";
      return '<div class="tu-wt' + (w[3] === 1 ? " crit" : "") + '" data-bed="' + w[0] + '"' + (w[3] === 1 ? hs(1, "tr") : "") + '><div class="tu-wt-h"><span>' + w[0] + "</span></div>" + ecg +
        '<div class="tu-wt-n"><span><small>' + t("v_hr") + '</small><b style="color:#22e05a">' + lv("hr", w[1]) + '</b></span><span style="text-align:right"><small>SpO₂</small><b style="color:' + (w[3] === 1 ? "#fca5a5" : "#ffe14a") + '">' + lv("spo", w[2]) + "</b></span></div>" +
        (w[3] === 1 ? '<div class="tu-wt-al">SpO₂ 86 · 3 ' + t("u_m") + "</div>" : "") + "</div>";
    }).join("");
    return '<div class="tu-wall"><div class="tu-wl-top"><b>' + t("wall_t") + '</b><div class="tu-wl-u"' + hs(3, "r") + '><span class="on">' + t("s_unit") + "</span><span>" + t("u_kvc") + "</span><span>" + t("u_nic") + '</span></div><div class="tu-wl-r"><span class="tu-mono tu-clk2" data-clk="1">22:14:00</span><span class="tu-wl-fs"' + hs(4, "tm") + ">" + ic("full") + "</span></div></div>" +
      '<div class="tu-wg">' + tiles + "</div></div>";
  }
  var TABS = [["beds", "grid", "tb_beds", "x_beds", sBeds, "hb"], ["pt", "user", "tb_pt", "x_pt", sPatient, "hp"], ["al", "bell", "tb_al", "x_al", sAlarms, "ha"], ["tk", "list", "tb_tk", "x_tk", sTasks, "hk"], ["ho", "clip", "tb_ho", "x_ho", sHand, "hh"], ["wall", "tv", "tb_wall", "x_wall", sWall, "hw"]];
  var COUNT = 4;

  /* ---------- iskelet ---------- */
  mount.innerHTML =
    '<div class="tu-tabs" role="tablist"></div>' +
    '<div class="tu-stage">' +
      '<div class="tu-frame">' +
        '<div class="tu-top" aria-hidden="true"><span class="tu-wdots"><i></i><i></i><i></i></span><span class="tu-crumb"><span class="tu-mkx">h</span><span>homunculus</span><span>›</span><b class="tu-crumbT"></b></span><span class="tu-clk tu-mono">22:14</span></div>' +
        '<div class="tu-body" role="tabpanel" id="tur-panel"><div class="tu-scr"></div>' +
          '<div class="tu-sbar"><span><i class="tu-lv"></i><span data-tu="sb_upd"></span>&nbsp;<b class="tu-mono">22:14</b></span><span>' + ic("lock") + '<span data-tu="t2"></span></span><span>' + ic("shield") + '<span data-tu="t1"></span></span></div>' +
          '<div class="tu-dots"></div><div class="tu-bub" hidden></div></div>' +
      "</div>" +
      '<aside class="tu-notes"><h3 class="tu-ntT"></h3><p class="tu-ntD"></p><ol class="tu-nl"></ol>' +
        '<div class="tu-auto"><span class="tu-st"><i></i><span class="tu-autoTx"></span></span><button type="button" class="tu-btn tu-sm tu-autoBtn"></button></div>' +
        '<div class="tu-tip">' + ic("hand") + '<span data-tu="tip"></span></div></aside>' +
    "</div>";
  var q = function (s) { return mount.querySelector(s); };
  var tabsEl = q(".tu-tabs"), frame = q(".tu-frame"), body = q(".tu-body"), screen = q(".tu-scr"), dots = q(".tu-dots"), bub = q(".tu-bub"), nl = q(".tu-nl"), notes = q(".tu-notes");
  tabsEl.innerHTML = TABS.map(function (x, i) {
    return '<button type="button" role="tab" class="tu-tab" id="tur-tab-' + i + '" data-tab="' + i + '" aria-controls="tur-panel">' + ic(x[1]) + '<span class="tu-tl"></span><span class="tu-pg" aria-hidden="true"><i></i></span></button>';
  }).join("");

  /* ---------- tur durumu ---------- */
  var S = { tab:0, n:1, playing:false, userStopped:false, inView:false };
  var swapTimer = 0;
  function drawStatic() {
    mount.querySelectorAll("[data-tu]").forEach(function (el) { el.textContent = t(el.getAttribute("data-tu")); });
    tabsEl.setAttribute("aria-label", t("nav_tour"));
    tabsEl.querySelectorAll(".tu-tab").forEach(function (b, i) { b.querySelector(".tu-tl").textContent = t(TABS[i][2]); });
  }
  function syncTabs() {
    tabsEl.querySelectorAll(".tu-tab").forEach(function (b, i) {
      var on = i === S.tab;
      b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
    });
    body.setAttribute("aria-labelledby", "tur-tab-" + S.tab);
  }
  function drawTab(anim) {
    var x = TABS[S.tab];
    var put = function () {
      screen.innerHTML = x[4]();
      q(".tu-crumbT").textContent = t(x[2]);
      q(".tu-ntT").textContent = t(x[2]); q(".tu-ntD").textContent = t(x[3]);
      nl.innerHTML = [1, 2, 3, 4].map(function (n) { return '<li data-n="' + n + '"><button type="button" data-note="' + n + '"><span class="tu-n">' + n + "</span><span><b>" + t(x[5] + n + "t") + "</b><small>" + t(x[5] + n + "d") + "</small></span></button></li>"; }).join("");
      dots.innerHTML = [1, 2, 3, 4].map(function (n) { return '<button type="button" class="tu-hs" data-dot="' + n + '" aria-label="' + n + " · " + t(x[5] + n + "t").replace(/"/g, "") + '">' + n + "</button>"; }).join("");
      screen.classList.remove("tu-swap");
      place(); mark(); liveAttach();
    };
    syncTabs();
    clearTimeout(swapTimer);
    if (anim && !reduced) { screen.classList.add("tu-swap"); swapTimer = setTimeout(put, 180); } else put();
  }
  function place() {
    var br = body.getBoundingClientRect();
    dots.querySelectorAll(".tu-hs").forEach(function (d) {
      var el = screen.querySelector('[data-hs="' + d.getAttribute("data-dot") + '"]');
      if (!el || !el.getClientRects().length) { d.style.display = "none"; return; }
      d.style.display = "";
      var r = el.getBoundingClientRect(), a = el.getAttribute("data-ha"), L = r.left - br.left, R = r.right - br.left, Tp = r.top - br.top, M = Tp + r.height / 2, x, y;
      if (a === "l") { x = L - 17; y = M; } else if (a === "r") { x = R + 17; y = M; } else if (a === "tr") { x = R - 18; y = Tp + 16; } else { x = L + r.width / 2; y = Tp - 6; }
      x = Math.max(16, Math.min(br.width - 16, x)); y = Math.max(16, Math.min(br.height - 16, y));
      d.style.left = x + "px"; d.style.top = y + "px";
    });
  }
  function mark() {
    var x = TABS[S.tab];
    dots.querySelectorAll(".tu-hs").forEach(function (d) { d.classList.toggle("on", +d.getAttribute("data-dot") === S.n); });
    nl.querySelectorAll("li").forEach(function (li) { li.classList.toggle("on", +li.getAttribute("data-n") === S.n); });
    var d = dots.querySelector('[data-dot="' + S.n + '"]');
    var wide = wideMq ? wideMq.matches : window.innerWidth > 1080;
    if (d && d.style.display !== "none" && wide) {
      bub.innerHTML = "<b><span>" + S.n + "</span>" + t(x[5] + S.n + "t") + "</b><p>" + t(x[5] + S.n + "d") + "</p>";
      bub.hidden = false;
      var bw = body.clientWidth, bh = body.clientHeight, dx = parseFloat(d.style.left), dy = parseFloat(d.style.top), w = 260, h = bub.offsetHeight;
      var left = dx + 22; if (left + w > bw - 10) left = dx - 22 - w; left = Math.max(10, left);
      var top = dy - 8; if (top + h > bh - 10) top = bh - 10 - h; top = Math.max(10, top);
      bub.style.left = left + "px"; bub.style.top = top + "px";
    } else bub.hidden = true;
    tabsEl.querySelectorAll(".tu-tab").forEach(function (b, i) { var pg = b.querySelector(".tu-pg i"); if (pg) pg.style.width = i === S.tab ? (S.n / COUNT * 100) + "%" : "0"; });
  }
  function drawAuto() {
    q(".tu-auto").classList.toggle("tu-play", S.playing);
    q(".tu-autoTx").textContent = t(S.playing ? "auto_on" : "auto_off");
    q(".tu-autoBtn").innerHTML = ic(S.playing ? "pause" : "play") + t(S.playing ? "pause" : "play");
    /* kendiliğinden ilerlerken ekran okuyucuyu boğmasın; durunca notlar canlı bölge */
    notes.setAttribute("aria-live", S.playing ? "off" : "polite");
  }
  var timer = 0;
  function schedule() { clearTimeout(timer); if (!S.playing || !S.inView || document.hidden) return; timer = setTimeout(step, 3600); }
  function step() {
    if (S.n < COUNT) { S.n++; mark(); }
    else { S.tab = (S.tab + 1) % TABS.length; S.n = 1; drawTab(true); }
    schedule();
  }
  function stop() { S.playing = false; S.userStopped = true; clearTimeout(timer); drawAuto(); }
  function play() { if (reduced) return; S.playing = true; S.userStopped = false; drawAuto(); schedule(); }
  function go(tab, n) { S.tab = Math.max(0, Math.min(TABS.length - 1, tab | 0)); S.n = Math.max(1, Math.min(COUNT, n || 1)); drawTab(true); }

  /* ---------- canlı monitör: tek rAF döngüsü, tüm yataklar ----------
     Her yatağın EKG'si kendi nabzından üretilir (vuru aralığı = 60/HR), biçimi yatağa göre biraz farklı.
     Monitör gibi soldan sağa tarar, önünde silme boşluğu. Sayılar birkaç saniyede bir küçük sınırlar içinde
     oynar ve NEWS2 bandının dışına çıkmaz (alarm durumu değişmez). Saat 22:14 içinde saniye sayar, dakika sabit
     kalır — ekrandaki diğer saatler (alarm geçmişi 22:11/22:14/22:16) tutarlı kalsın diye.
     Döngü yalnız: hareket azaltılmamışsa, tur ekrandaysa, sekme görünürse ve ekranda iz/değer varsa çalışır. */
  var SWEEP = 4;          /* ekran genişliği = 4 sn */
  var TRS = {}, LVS = {}; /* sekme:yatak anahtarıyla kalıcı durum — dil değişince izler sıfırlanmaz */
  var traces = [], vals = [], clocks = [], raf = 0, lastTs = 0, simSec = 0, lastClk = -1;
  var BANDS = { hr:[40, 50, 90, 110, 130], spo:[91, 93, 95], rr:[8, 11, 20, 24], map:[64] };
  var RANGE = { hr:2, spo:1, rr:1, map:2 };
  var CAP = { spo:100 };
  function bandOf(kind, v) {
    var b = BANDS[kind], lo = 0, hi = 999;
    for (var i = 0; i < b.length; i++) { if (v <= b[i]) { hi = b[i]; break; } lo = b[i] + 1; }
    return [lo, hi];
  }
  function seeded(str) {
    var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h += 0x6D2B79F5; var x = Math.imul(h ^ (h >>> 15), 1 | h); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  }
  function newTrace(bed) {
    var r = seeded(bed);
    return { bed:bed, amp:.78 + r() * .3, p:.06 + r() * .09, t:.14 + r() * .22, qw:.85 + r() * .4, s:.12 + r() * .3, q:.06 + r() * .1,
      seed:r() * 6.28, phase:r(), time:0, head:0, w:0, h:0, buf:null, cv:null, ctx:null, color:"#22e05a", hr:72, dpr:1 };
  }
  /* bir vurunun biçimi; ts = vurunun başından beri geçen saniye */
  function beat(ts, per, m) {
    var g = function (c, w, a) { var d = ts - c; return a * Math.exp(-d * d / (2 * w * w)); };
    var R0 = .2, tc = R0 + .26 * Math.sqrt(per), gT = function (x) { var d = x - tc; return m.t * Math.exp(-d * d / (2 * .045 * .045)); };
    return g(R0 - .14, .022, m.p) + g(R0 - .028 * m.qw, .008 * m.qw, -m.q) + g(R0, .011 * m.qw, 1) + g(R0 + .03 * m.qw, .011 * m.qw, -m.s) + gT(ts) + gT(ts + per);
  }
  function advance(tr, px) {
    var w = tr.w, step = SWEEP / w;
    for (var i = 0; i < px; i++) {
      var hr = tr.hr * (1 + .03 * Math.sin(tr.time * .9 + tr.seed));
      tr.phase += hr / 60 * step; tr.time += step;
      var per = 60 / hr, ph = tr.phase - Math.floor(tr.phase);
      var v = beat(ph * per, per, tr) + .035 * Math.sin(6.283 * .2 * tr.time + tr.seed) + (Math.random() - .5) * .025;
      tr.buf[Math.floor(tr.head) % w] = v;
      tr.head = (tr.head + 1) % w;
    }
  }
  function drawTrace(tr, gap) {
    var c = tr.ctx, w = tr.w, h = tr.h, base = h * .64, k = h * .5 * tr.amp, head = Math.floor(tr.head), g = Math.max(6, Math.round(w * .05));
    c.setTransform(tr.dpr, 0, 0, tr.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.strokeStyle = tr.color; c.lineWidth = 1.6; c.lineJoin = "round";
    c.beginPath();
    var pen = false;
    for (var x = 0; x < w; x++) {
      var ahead = (x - head + w) % w;
      if (gap && ahead < g) { pen = false; continue; }
      var v = tr.buf[x]; if (v !== v) { pen = false; continue; }
      var y = base - v * k;
      if (pen) c.lineTo(x, y); else { c.moveTo(x, y); pen = true; }
    }
    c.stroke();
  }
  function liveMeasure() {
    traces.forEach(function (tr) {
      var cw = Math.round(tr.cv.clientWidth), ch = Math.round(tr.cv.clientHeight), dpr = Math.min(2, window.devicePixelRatio || 1);
      if (!cw || !ch) return;
      if (cw !== tr.w || !tr.buf) { tr.w = cw; tr.buf = new Float32Array(cw); tr.head = 0; advance(tr, cw); }
      if (tr.cv.width !== cw * dpr || tr.cv.height !== ch * dpr) { tr.cv.width = cw * dpr; tr.cv.height = ch * dpr; }
      tr.h = ch; tr.dpr = dpr;
      drawTrace(tr, !reduced);
    });
  }
  function liveAttach() {
    var tab = TABS[S.tab][0];
    vals = []; traces = [];
    clocks = [].slice.call(screen.querySelectorAll("[data-clk]"));
    screen.querySelectorAll("[data-lv]").forEach(function (el) {
      var box = el.closest("[data-bed]"); if (!box) return;
      var kind = el.getAttribute("data-lv"), base = +el.getAttribute("data-v"), key = tab + ":" + box.getAttribute("data-bed") + ":" + kind;
      var st = LVS[key];
      if (!st) {
        var b = bandOf(kind, base);
        st = LVS[key] = { cur:base, lo:Math.max(b[0], base - RANGE[kind]), hi:Math.min(b[1], base + RANGE[kind], CAP[kind] || 999), next:0 };
      }
      el.textContent = st.cur;
      vals.push({ el:el, st:st, kind:kind });
    });
    screen.querySelectorAll(".tu-ecg canvas").forEach(function (cv) {
      var box = cv.closest("[data-bed]"); if (!box) return;
      var bed = box.getAttribute("data-bed"), key = tab + ":" + bed, tr = TRS[key] || (TRS[key] = newTrace(bed));
      var hv = LVS[key + ":hr"]; if (hv) tr.hr = hv.cur;
      tr.cv = cv; tr.ctx = cv.getContext("2d"); tr.color = getComputedStyle(cv).color || "#22e05a"; tr.hrKey = key + ":hr";
      traces.push(tr);
    });
    liveMeasure(); liveClock(true); liveLoop();
  }
  function liveClock(force) {
    var s = Math.floor(simSec) % 60; if (!force && s === lastClk) return; lastClk = s;
    var txt = "22:14:" + (s < 10 ? "0" : "") + s;
    clocks.forEach(function (c) { c.textContent = txt; });
  }
  function liveDrift(now) {
    vals.forEach(function (v) {
      var st = v.st;
      if (!st.next) { st.next = now + 1500 + Math.random() * 3000; return; }
      if (now < st.next) return;
      st.next = now + 2500 + Math.random() * 2500;
      if (v.kind === "spo" && Math.random() < .6) return;
      var d = Math.random() < .5 ? -1 : 1, n = Math.max(st.lo, Math.min(st.hi, st.cur + d));
      if (n === st.cur) return;
      st.cur = n; v.el.textContent = n;
    });
    traces.forEach(function (tr) { var hv = LVS[tr.hrKey]; if (hv) tr.hr = hv.cur; });
  }
  function frameLoop(ts) {
    raf = 0;
    if (!liveOn()) { lastTs = 0; return; }
    var dt = lastTs ? Math.min(.1, (ts - lastTs) / 1000) : 0; lastTs = ts;
    simSec += dt; liveClock(false); liveDrift(ts);
    traces.forEach(function (tr) {
      if (!tr.buf) return;
      tr.acc = (tr.acc || 0) + dt * tr.w / SWEEP;
      var px = Math.floor(tr.acc); tr.acc -= px;
      if (px) advance(tr, px);
      drawTrace(tr, true);
    });
    raf = requestAnimationFrame(frameLoop);
  }
  function liveOn() { return !reduced && S.inView && !document.hidden && !host.hidden && (traces.length || vals.length || clocks.length); }
  function liveLoop() {
    if (liveOn()) { if (!raf) { lastTs = 0; raf = requestAnimationFrame(frameLoop); } }
    else if (raf) { cancelAnimationFrame(raf); raf = 0; lastTs = 0; }
  }

  tabsEl.addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (!b) return; stop(); go(+b.getAttribute("data-tab"), 1); });
  tabsEl.addEventListener("keydown", function (e) {
    var i = S.tab, n = TABS.length;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") i = (i + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i = (i - 1 + n) % n;
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = n - 1;
    else return;
    e.preventDefault(); stop(); go(i, 1);
    var b = document.getElementById("tur-tab-" + i); if (b) b.focus();
  });
  dots.addEventListener("click", function (e) { var b = e.target.closest("[data-dot]"); if (!b) return; stop(); S.n = +b.getAttribute("data-dot"); mark(); });
  nl.addEventListener("click", function (e) { var b = e.target.closest("[data-note]"); if (!b) return; stop(); S.n = +b.getAttribute("data-note"); mark(); });
  screen.addEventListener("click", function () { stop(); });
  q(".tu-autoBtn").addEventListener("click", function () {
    if (S.playing) stop();
    else { S.playing = true; S.userStopped = false; drawAuto(); if (S.inView && !document.hidden) step(); else schedule(); }
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        S.inView = e.isIntersecting;
        if (S.inView && !S.userStopped && !reduced && !S.playing) { S.playing = true; drawAuto(); }
        schedule(); liveLoop();
      });
    }, { threshold:.35 }).observe(frame);
  } else { S.inView = true; if (!reduced) S.playing = true; }
  document.addEventListener("visibilitychange", function () { schedule(); liveLoop(); });

  var relayout = function () { place(); mark(); liveMeasure(); };
  window.addEventListener("resize", relayout);
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(body);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  window.addEventListener("load", relayout);

  /* ---------- dil ---------- */
  document.addEventListener("hmc:lang", function (e) {
    var l = e && e.detail; if (typeof l === "string") l = l.toUpperCase();
    if (!(l in IDX) || l === lang) return;
    lang = l; drawStatic(); drawTab(false); drawAuto();
  });

  drawStatic(); drawTab(false); drawAuto(); schedule();
  window.HMC_TUR = { go:function (tab, n) { stop(); go(tab, n); }, play:play, pause:stop, state:S };
})();

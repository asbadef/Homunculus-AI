/* Homunculus prototip v1 — hemşirelik modülü (nursing.js).
 * Sahiplik: H.body (vücut figürü) · H.forms.open (hemşirelik formları) · 'tasks' (Görevlerim) · 'bedside' (yatak başı ölçüm).
 * Veri SENTETİKTİR. Klinik puan tablolarında yalnız yaygın bilinen standart sürümler kullanıldı; her formda
 * "Puan tablosu: <ölçek>" notu var (herkese). "hastanenin onayı gerekir", "arşive alınacak" gibi kurulum notları 24.09'dan beri
 * yalnız yönetim hesabında görünür (ADM / ADMBOX / ARC → H.adminNote, H.isAdminish).
 *
 * ---------------------------------------------------------------------------------------------------------------
 * H.body(opts) — vücut figürü
 *   opts = {
 *     ageGroup: 'adult' | 'child' | 'neonate'   (oranlar yaşa göre değişir; varsayılan 'adult')
 *     view:     'on' | 'arka'                     (varsayılan 'on')
 *     selected: [regionKey]                       seçili bölgeler (dolgu renkli, .sel)
 *     marks:    [{ region, color, label }]        önceki kayıtlar (.has + numaralı işaret)
 *     multi:    true                              false → tek seçim
 *     toggle:   true                              Ön/Arka düğmesini göster
 *     hot:      false                             arka görünümde bası yarasının sık görüldüğü yerleri kesik halkayla göster
 *     only:     [regionKey]                       yalnız bu bölgeler tıklanabilir (ör. insülin bölgeleri)
 *     names:    { regionKey: 'Ad' }               bu figür için ad üzerine yazma (ör. ust_kol_sag → 'Sağ deltoid')
 *     onPick(regionKey, ctl)  ·  onView(view, ctl)
 *   }
 *   dönüş ctl = { html (string, bağlamadan), mount(el) → ctl, render(), setView(v), setSelected([..]), view, selected }
 *   Yardımcılar: H.body.name(key) → "Sol üst kol" · H.body.viewOf(key) → 'on'|'arka' · H.body.keys(view) → [key]
 *
 *   Anahtarlar HASTANIN GERÇEK TARAFINI taşır (…_sag / …_sol). Ekranda nereye çizileceği TEK yerde (side()) çözülür:
 *   ön görünümde hastanın sağı ekranın SOLUNDA, arka görünümde ekranın SAĞINDA. Ad da tek yerde (H.body.name) çözülür;
 *   görünüm değişince ad asla ters çevrilmez.
 *   Ön: bas boyun gogus_* karin_*_ust karin_*_alt gobek pelvis_* omuz_* ust_kol_* dirsek_* on_kol_* el_* uyluk_* diz_* bacak_* ayak_*
 *   Arka: oksiput ense sirt_* bel sakrum kalca_* kol_arka_* dirsek_arka_* on_kol_arka_* el_sirti_* uyluk_arka_* diz_arka_* baldir_* topuk_*
 *   Özel: 'tum' = belirsiz bölge / tüm vücut (figürde çizilmez, formlar kullanır).
 * ---------------------------------------------------------------------------------------------------------------
 */
(function () {
  const H = window.H;
  if (!H) return;
  const E = (s) => H.esc(s);
  const TODAY = H.dmy(0);   // demo günü core.js'ten; bilgisayarın gerçek tarihi KULLANILMAZ
  const N = (x) => { if (x == null || x === "") return null; const n = +String(x).replace(",", "."); return isFinite(n) ? n : null; };
  const f1 = (n) => n == null ? "—" : String(Math.round(n * 10) / 10).replace(".", ",");
  // 24.09 (2. oturum): 24'ü geçen saat ertesi güne düşer → "25.09 · 02:00" (Ozan: "hiçbir yerde tarih yok").
  const hhmm = (t) => { const h = Math.floor(t), m = Math.round((t - h) * 60); return (h >= 24 ? H.dm(1) + " · " : "") + String(h % 24).padStart(2, "0") + ":" + String(m).padStart(2, "0"); };
  const uname = () => (H.state.user && H.state.user.name) || "—";
  const I = (k) => H.icon(k);

  /* ================================ modüle özel stil (yalnız CSS değişkenleri) ================================ */
  const CSS = `
  .nf .opts i{padding:8px 11px;min-height:38px;display:inline-flex;align-items:center}
  .nf .fld{margin-bottom:12px;grid-template-columns:minmax(150px,min(34%,240px)) minmax(0,1fr)}
  .nf .fld.col{grid-template-columns:minmax(0,1fr)}
  .nf .fld>label{line-height:1.35} .nf .fld>label .req{white-space:nowrap}
  .nf .fld:has(>div>.nfSc){align-items:start} .nf .fld:has(>div>.nfSc)>label{padding-top:10px}
  /* 24.09 · puanlı seçenekler: eşit genişlikte ızgara, puan düğmenin sağında rozet */
  .nf .opts.nfSc{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--ow,190px)),1fr));gap:6px}
  .nf .opts.nfSc>i{display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;line-height:1.3;margin:0}
  .nf .opts.nfSc>i small{margin-left:auto;flex:none;min-width:30px;text-align:center;padding:2px 7px;border-radius:999px;background:var(--card2);color:var(--ink);opacity:1;font:700 12px "JetBrains Mono"}
  .nf .opts.nfSc>i.on small{background:color-mix(in srgb,var(--onpri) 24%,transparent);color:var(--onpri)}
  :where(.adm-note){color:var(--attInk);font-style:italic}
  .nf .box{margin:0}
  .nf .req{color:var(--crit)}
  .nfHead{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:12px}
  .nfHead .pt b{font:700 16px "Space Grotesk"} .nfHead .bn{font:700 15px "JetBrains Mono";color:var(--pri);margin-right:7px}
  .nfHead .mt{font-size:12px;color:var(--mute);line-height:1.45} .nfHead .mt b{color:var(--ink);font-weight:600}
  .nfBadges{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap}
  .nfBadges .scoreBadge{min-width:66px;padding:6px 10px;border:1px solid var(--line)} .nfBadges .scoreBadge b{font-size:22px}
  .nfGrid{display:grid;grid-template-columns:minmax(230px,300px) minmax(0,1fr);gap:14px;align-items:start}
  .nfFig{position:sticky;top:62px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 10px 12px}
  .nfCol{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;min-width:0} .nfCol>*,.nfGrid>*{min-width:0}
  .nfMiss{box-shadow:0 0 0 2px var(--crit);border-radius:10px}
  .nfMissNote{margin-bottom:12px}
  .nfChips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .nfChips span{display:inline-flex;align-items:center;gap:4px;background:color-mix(in srgb,var(--body-sel) 20%,transparent);border:1px solid color-mix(in srgb,var(--body-sel) 55%,transparent);border-radius:999px;padding:2px 3px 2px 10px;font:600 12.5px Figtree}
  .nfChips button{border:0;background:none;cursor:pointer;width:30px;height:30px;display:grid;place-items:center;color:var(--mute);padding:0;border-radius:50%}
  .nfChips button:hover{background:var(--card2);color:var(--ink)} .nfChips svg{width:14px;height:14px}
  .nfChk{display:flex;align-items:center;gap:10px;font:600 13px Figtree;cursor:pointer;padding:8px 0;user-select:none}
  .nfChk input{width:22px;height:22px;accent-color:var(--pri);flex:none;padding:0}
  .nfNote{font-size:11.5px;color:var(--mute);margin-top:8px;line-height:1.45} .nfNote b{color:var(--ink)}
  .nfArc{font-size:12px;color:var(--attInk);background:var(--att);border:1px dashed var(--attLine);border-radius:10px;padding:7px 10px;margin-top:8px}
  .nfTotal{display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;margin-top:10px;padding:10px 14px;border-radius:12px;font-size:13px;color:var(--mute);
    background:color-mix(in srgb,var(--c,var(--line2)) 10%,var(--card2));border-left:4px solid var(--c,var(--line2))}
  .nfTotal>b{font:700 34px/1 "Space Grotesk";color:var(--c,var(--ink))}
  .nfTotal .k{font:700 11px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
  .nfTotal .mx{font:600 14px "JetBrains Mono";color:var(--mute);margin-left:-6px}
  .nfTotal .nfRisk{font:700 13px Figtree;padding:4px 12px;border-radius:999px;color:var(--c,var(--ink));background:color-mix(in srgb,var(--c,var(--line2)) 16%,transparent);border:1px solid color-mix(in srgb,var(--c,var(--line2)) 45%,transparent)}
  .nfTotal .rest{flex:1 1 220px;font-size:12.5px;line-height:1.4}
  @media (max-width:860px){.nf .fld{grid-template-columns:minmax(0,1fr)} .nf .fld:has(>div>.nfSc)>label{padding-top:0} .nf .opts.nfSc{--ow:130px} .nfTotal>b{font-size:30px}}
  /* 24.09 · büyük form penceresi: solda form listesi, sağda form; alt çubuk yapışık */
  .modal.nfDlg{width:min(1320px,100%);height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden}
  .modal.nfDlg>.mb{flex:1;min-height:0;padding:0;display:flex}
  .modal.nfDlg>.mf{flex-wrap:wrap}
  .nfShell{flex:1;min-height:0;display:grid;grid-template-columns:230px minmax(0,1fr)}
  .nfNav{border-right:1px solid var(--line);overflow:auto;padding:12px 10px;display:flex;flex-direction:column;gap:3px;background:var(--card)}
  .nfNav h6{margin:4px 8px 6px;font:700 10.5px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
  .nfNav button{display:grid;grid-template-columns:20px minmax(0,1fr);gap:2px 9px;align-items:center;text-align:left;border:0;background:none;color:var(--ink);padding:8px 9px;border-radius:10px;cursor:pointer;font:600 13px Figtree}
  .nfNav button svg{width:17px;height:17px;color:var(--mute)}
  .nfNav button small{grid-column:2;font:500 11px Figtree;color:var(--mute)}
  .nfNav button:hover{background:var(--card2)}
  .nfNav button.on{background:color-mix(in srgb,var(--pri) 16%,transparent);color:var(--ink);box-shadow:inset 3px 0 0 var(--pri)}
  .nfNav button.on svg{color:var(--pri)}
  .nfNav .nfPrBl{margin-top:auto;border:1px dashed var(--line2)}
  .modal.nfDlg .nf{overflow:auto;padding:16px 18px;min-width:0}
  .nfTwo{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}
  @media (max-width:980px){.nfShell{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)} .nfNav{flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid var(--line);padding:8px} .nfNav h6{display:none}
    .nfNav button{grid-template-columns:18px auto;white-space:nowrap;flex:none} .nfNav button small{display:none} .nfNav .nfPrBl{margin-top:0} .nfTwo{grid-template-columns:minmax(0,1fr)}}
  @media (max-width:640px){.modal.nfDlg{height:100vh;border-radius:0} .modalBg:has(.nfDlg){padding:0}}
  .nrs{display:grid;grid-template-columns:repeat(11,minmax(0,1fr));gap:3px}
  .nrs i{font-style:normal;text-align:center;font:700 14px "JetBrains Mono";padding:10px 0;border-radius:8px;cursor:pointer;background:var(--card2);color:var(--mute);border:2px solid transparent;user-select:none}
  .nrs i.on{color:var(--ink);background:color-mix(in srgb,var(--c) 34%,transparent);border-color:var(--c)}
  .nrsl{display:flex;justify-content:space-between;font-size:11px;color:var(--mute);margin-top:4px;gap:6px}
  .nfRange{width:100%;accent-color:var(--pri);padding:0;border:0;background:none;height:34px;box-shadow:none!important}
  .nfOut{font:700 15px "JetBrains Mono";color:var(--ink)}
  .faces{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}
  .faces i{font-style:normal;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 2px;border-radius:10px;border:2px solid var(--line2);cursor:pointer;text-align:center;font:600 10.5px/1.2 Figtree;color:var(--mute);user-select:none}
  .faces i svg{width:40px;height:40px;color:var(--ink)} .faces i b{font:700 13px "JetBrains Mono";color:var(--ink)}
  .faces i.on{border-color:var(--pri);background:var(--priSoft)}
  table.t td.hl, table.t tr.hl td{background:var(--priSoft);color:var(--ink);font-weight:700}
  .nfTw{overflow-x:auto;border-radius:12px}
  table.n2{width:100%;border-collapse:separate;border-spacing:2px;font-size:11.5px;min-width:560px}
  table.n2 th{font:700 10px Figtree;color:var(--mute);text-transform:uppercase;letter-spacing:.05em;padding:4px 6px;text-align:center}
  table.n2 th:first-child,table.n2 td:first-child{text-align:left}
  table.n2 td{padding:6px 5px;text-align:center;border-radius:6px;background:var(--card2);color:var(--mute);white-space:nowrap}
  table.n2 td:first-child{background:none;color:var(--ink);font-weight:700;font-size:12px}
  table.n2 td.p3{background:color-mix(in srgb,var(--crit) 16%,transparent)} table.n2 td.p2{background:color-mix(in srgb,var(--high) 14%,transparent)} table.n2 td.p1{background:color-mix(in srgb,var(--mid) 12%,transparent)}
  table.n2 td.on{outline:2px solid var(--ink);color:var(--ink);font-weight:800}
  table.n2 td.pt{font:700 13px "JetBrains Mono";color:var(--ink);background:none}
  .n2resp{display:grid;gap:4px;margin-top:10px}
  .n2resp div{display:grid;grid-template-columns:130px 1fr;gap:10px;padding:7px 10px;border-radius:10px;border:1px solid var(--line);font-size:12.5px;color:var(--mute)}
  .n2resp div b{color:var(--ink)} .n2resp div.on{border-color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent);color:var(--ink)}
  .nfSrc{display:inline-flex;align-items:center;gap:6px;font:700 12px Figtree;padding:5px 10px;border-radius:999px;background:var(--priSoft);color:var(--pri)} .nfSrc svg{width:14px;height:14px}
  .nfBar{height:6px;border-radius:99px;background:var(--card2);overflow:hidden;margin-top:8px} .nfBar i{display:block;height:100%;width:0;background:var(--pri);animation:nfFill 1.5s linear forwards}
  @keyframes nfFill{to{width:100%}}
  .ioG{border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin-bottom:6px;background:var(--card)}
  .ioG>header{display:flex;align-items:center;gap:8px;font:600 13px Figtree}
  .ioG>header .s{margin-left:auto;font:700 13px "JetBrains Mono";color:var(--mute)}
  .ioG>header .btn{padding:6px 10px}
  .ioRow{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr) 36px;gap:6px;margin-top:6px;align-items:center}
  .ioRow.o{grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) 36px}
  .ioRow input,.ioRow select{padding:8px 8px;font-size:13px}
  .ioRow .opts i{padding:6px 8px;min-height:34px;font-size:12px}
  .nfDel{width:36px;height:36px;border-radius:9px;border:1px solid var(--line2);background:var(--card);display:grid;place-items:center;cursor:pointer;color:var(--mute);padding:0}
  .nfDel svg{width:15px;height:15px} .nfDel:hover{color:var(--crit);border-color:var(--crit)}
  .ioSum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .ioSum div{background:var(--card2);border-radius:12px;padding:8px 10px} .ioSum small{display:block;font:700 10px Figtree;color:var(--mute);text-transform:uppercase;letter-spacing:.06em} .ioSum b{font:700 20px "JetBrains Mono"}
  .trend{display:flex;align-items:flex-end;gap:8px;height:92px;margin:6px 0 22px}
  .trend div{flex:1;border-radius:6px 6px 2px 2px;position:relative;background:color-mix(in srgb,var(--high) 42%,var(--card2));min-width:0}
  .trend div.now{background:color-mix(in srgb,var(--pri) 55%,var(--card2))}
  .trend div em{position:absolute;top:-17px;left:0;right:0;text-align:center;font:700 10.5px "JetBrains Mono";font-style:normal;color:var(--ink)}
  .trend div span{position:absolute;bottom:-18px;left:0;right:0;text-align:center;font-size:10px;color:var(--mute);white-space:nowrap}
  .photo{display:grid;grid-template-columns:96px 1fr;gap:12px;align-items:center}
  .photo .ph{height:76px;border-radius:12px;border:1.5px dashed var(--line2);display:grid;place-items:center;color:var(--mute);cursor:pointer;background:var(--card2)}
  .photo .ph svg{width:26px;height:26px} .photo .ph.has{border-style:solid;background:repeating-linear-gradient(45deg,var(--card2),var(--card2) 6px,var(--line) 6px,var(--line) 12px);color:var(--ink);font:700 11px Figtree}
  .acTop{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
  .acTop input{max-width:280px}
  .acGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px}
  .acT{display:flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:12px;background:var(--card);min-height:48px;padding:0 4px 0 2px;cursor:pointer}
  .acT:hover{border-color:var(--pri)}
  .acT span{flex:1;font:600 12.5px/1.25 Figtree;padding:6px 2px;min-width:0}
  .acT button{width:36px;height:36px;border:0;background:none;border-radius:9px;display:grid;place-items:center;color:var(--mute);cursor:pointer;flex:none;padding:0}
  .acT button svg{width:17px;height:17px} .acT button:hover{background:var(--card2);color:var(--ink)}
  .acT button.fav{color:var(--mid)} .acT button.fav svg{fill:currentColor}
  .acT button.add{color:var(--pri)}
  .acT.alert{border-color:color-mix(in srgb,var(--crit) 40%,transparent)}
  .ongo{display:grid;gap:6px}
  .ongo div{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:var(--card);font-size:13px;flex-wrap:wrap}
  .ongo div b{font-weight:700} .ongo div small{color:var(--mute)} .ongo div .d{margin-left:auto;font:700 12px "JetBrains Mono";color:var(--attInk)}
  .ongo div.end{opacity:.55;text-decoration:line-through}
  .bodyWrap .sides span.c{font-size:10.5px;letter-spacing:.12em}
  svg.bfig{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
  svg .bf-hot{fill:none;stroke:var(--attInk);stroke-width:1.3;stroke-dasharray:3 3;pointer-events:none}
  svg .bf-pin{pointer-events:none} svg .bf-pin text{font:700 9px Figtree;fill:var(--page);text-anchor:middle}
  svg .bf-pin circle{stroke:var(--card);stroke-width:1.5}
  .bfHint{font-size:11.5px;color:var(--mute);text-align:center;max-width:280px}
  /* ---- Görevlerim ---- */
  /* 24.09 · saat sütunları esnek: kap genişse 24 sütun kabı doldurur, darsa --cwMin'de kalır ve yatay kayar.
   * --cw kabın (container) iç genişliğinden hesaplanır; ilk sütun (--fc) sabit. */
  .tkWrap{--fc:230px;--cwMin:46px;container-type:inline-size;overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--card);-webkit-overflow-scrolling:touch}
  .tkIn{--cw:max(var(--cwMin),calc((100cqw - var(--fc)) / 24));position:relative;width:calc(var(--fc) + 24 * var(--cw))}
  .tk{border-collapse:separate;border-spacing:0;table-layout:fixed;width:100%}
  .tk th,.tk td{width:var(--cw);height:42px;border-bottom:1px solid var(--line);border-left:1px solid var(--line);text-align:center;padding:0}
  .tk th{font:700 10.5px "JetBrains Mono";color:var(--mute);background:var(--card2);height:40px}
  .tk th.nowh{color:var(--crit)}
  .tk th .tkDay{display:block;font:700 9px Figtree;color:var(--pri);letter-spacing:.02em;line-height:1.1;white-space:nowrap}
  .tk th.dayb,.tk td.dayb{border-left:2px solid var(--line2)}
  .tk th:first-child,.tk td:first-child{width:var(--fc);position:sticky;left:0;z-index:3;background:var(--card);text-align:left;padding:0 10px;border-left:0;box-shadow:1px 0 0 var(--line2)}
  .tk th:first-child{background:var(--card2)}
  .tk td.lbl{font:600 12.5px Figtree;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tk td.lbl svg{width:14px;height:14px;vertical-align:-2px;margin-right:6px;color:var(--mute)}
  .tk tr.pt td{background:var(--card2);height:44px}
  .tk tr.pt td:first-child{background:var(--card2)}
  .tk tr.pt td.ps{text-align:left;padding-left:10px;font-size:12px;color:var(--mute)}
  .tk .psIn{position:sticky;left:calc(var(--fc) + 10px);display:inline-flex;gap:6px;align-items:center;white-space:nowrap;max-width:calc(100vw - var(--fc) - 60px);overflow:hidden}
  [data-theme="gece"] .nfChk input{color-scheme:dark}
  .tkP{display:flex;align-items:center;gap:6px;cursor:pointer;min-width:0} .tkP b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700}
  .tkP .bn{font:700 12.5px "JetBrains Mono";color:var(--pri)} .tkP svg{width:16px;height:16px;flex:none;color:var(--mute);transition:transform .15s} .tkP.cl svg{transform:rotate(-90deg)}
  .tc{width:32px;height:32px;border-radius:9px;display:inline-grid;place-items:center;border:1.5px solid transparent;background:none;cursor:pointer;padding:0;font:700 11px Figtree;color:var(--mute);position:relative}
  .tc svg{width:15px;height:15px}
  .tc.done{color:var(--ok)} .tc.miss{color:var(--crit);border-color:color-mix(in srgb,var(--crit) 40%,transparent)}
  .tc.late{background:var(--crit);color:#fff}
  .tc.due{background:var(--priSoft);border-color:var(--pri);color:var(--pri);animation:tkBlink 1.2s ease-in-out infinite}
  .tc.plan{border:1.5px dashed var(--line2);color:var(--mute)}
  .tc sup{position:absolute;top:-5px;right:-5px;background:var(--ink);color:var(--card);border-radius:99px;font:700 9px/14px Figtree;min-width:14px;height:14px}
  @keyframes tkBlink{50%{box-shadow:0 0 0 4px var(--priSoft);opacity:.65}}
  .tkNow{position:absolute;top:0;bottom:0;left:calc(var(--fc) + 13.7 * var(--cw));width:2px;background:var(--crit);z-index:2;pointer-events:none}
  .tkNow span{position:absolute;top:2px;left:4px;font:700 10px "JetBrains Mono";color:var(--crit);background:var(--card);padding:0 3px;border-radius:4px}
  .tkBar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}
  .tkLeg{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px;color:var(--mute);margin-top:10px;align-items:center}
  .tkLeg .tc{width:22px;height:22px;cursor:default;animation:none} .tkLeg .tc svg{width:12px;height:12px}
  .tkList{display:grid;gap:6px}
  .tkItem{display:grid;grid-template-columns:52px 36px 1fr auto;gap:10px;align-items:center;padding:9px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card);cursor:pointer;min-height:54px}
  .tkItem .tm{font:700 13px "JetBrains Mono"} .tkItem small{display:block;color:var(--mute);font-size:12px}
  .tkItem.late{border-color:color-mix(in srgb,var(--crit) 50%,transparent);background:var(--critSoft)}
  .tkItem.done,.tkItem.miss{opacity:.6}
  /* ---- Yatak başı ---- */
  .bsSteps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:14px}
  .bsSteps div{border-radius:12px;padding:8px 10px;background:var(--card);border:1px solid var(--line);font:600 12px Figtree;color:var(--mute);display:flex;gap:8px;align-items:center;min-width:0}
  .bsSteps div i{font-style:normal;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--card2);font:700 11px "JetBrains Mono";flex:none}
  .bsSteps div span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bsSteps div.on{border-color:var(--pri);color:var(--ink)} .bsSteps div.on i{background:var(--pri);color:var(--onpri)}
  .bsSteps div.ok i{background:var(--ok);color:var(--onpri)}
  .bsBig{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .bsBtn{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:18px;border-radius:18px;border:1.5px solid var(--line2);background:var(--card);cursor:pointer;text-align:left;min-height:120px;font:inherit;color:var(--ink)}
  .bsBtn:hover{border-color:var(--pri)} .bsBtn svg{width:30px;height:30px;color:var(--pri)} .bsBtn b{font:700 18px "Space Grotesk"} .bsBtn small{color:var(--mute);font-size:13px}
  .bsBtn.p{background:var(--pri);color:var(--onpri);border-color:transparent} .bsBtn.p svg,.bsBtn.p small{color:var(--onpri)}
  .bsScan{position:relative;width:200px;height:200px;margin:10px auto;border-radius:18px;border:2px solid var(--pri);overflow:hidden;background:var(--card2);display:grid;place-items:center;color:var(--mute)}
  .bsScan svg{width:90px;height:90px;opacity:.5}
  .bsScan::after{content:"";position:absolute;left:8px;right:8px;height:3px;background:var(--pri);box-shadow:0 0 12px var(--pri);animation:bsScan 1.1s ease-in-out infinite alternate;top:10px}
  @keyframes bsScan{to{top:185px}}
  .bsPl{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}
  .bsPl button{display:grid;grid-template-columns:56px 1fr;gap:4px 10px;align-items:center;text-align:left;padding:12px;border-radius:14px;border:1px solid var(--line);background:var(--card);cursor:pointer;min-height:64px;font:inherit;color:var(--ink)}
  .bsPl button:hover{border-color:var(--pri)} .bsPl .bn{grid-row:span 2;font:700 17px "JetBrains Mono";color:var(--pri)} .bsPl small{color:var(--mute);font-size:12px}
  .bsId{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}
  .bsId div{background:var(--card2);border-radius:12px;padding:10px 12px} .bsId small{display:block;font:700 10px Figtree;color:var(--mute);text-transform:uppercase;letter-spacing:.06em} .bsId b{font:700 17px "Space Grotesk"}
  .bsV{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
  .bsV>div{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 12px}
  .bsV>div.need{border-color:var(--attLine);background:var(--att)}
  .bsV label{display:flex;justify-content:space-between;font:700 11px Figtree;color:var(--mute);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em}
  .bsV .step input{width:84px;font-size:18px;height:46px} .bsV .step button{height:46px;width:44px;font-size:18px}
  .bsNews{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  .bsNews .big{font:700 44px/1 "Space Grotesk"}
  .bsOk{text-align:center;padding:30px 10px}
  .bsOk .ic{width:72px;height:72px;border-radius:50%;margin:0 auto 12px;display:grid;place-items:center;background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)} .bsOk .ic svg{width:36px;height:36px}
  @media (max-width:860px){ .nfGrid{grid-template-columns:minmax(0,1fr)!important} .nfFig{position:static} .ioSum{grid-template-columns:1fr 1fr 1fr} .n2resp div{grid-template-columns:1fr} }
  @media (max-width:640px){ .nfLeg{display:none} .nf .bodyWrap svg{max-width:230px} .att.tkAtt{grid-template-columns:1fr 1fr;gap:8px} .tkAtt .ac{grid-template-columns:30px 1fr;padding:9px 10px;gap:2px 8px} .tkAtt .ac .i{width:30px;height:30px} .tkAtt .ac b{font-size:20px} .tkAtt .ac span{font-size:11.5px} .tkWrap{--fc:150px;--cwMin:44px} .bsSteps span{display:none} .bsSteps div{justify-content:center} .ioRow{grid-template-columns:minmax(0,1fr) 72px 72px 36px} .nfHead .nfBadges{margin-left:0} .faces i{font-size:9.5px} .faces i svg{width:32px;height:32px} .nrs i{font-size:12.5px;padding:10px 0} .tkItem{grid-template-columns:46px 30px 1fr} .tkItem>:last-child{grid-column:3} }
  `;
  if (!document.getElementById("nursing-css")) { const st = document.createElement("style"); st.id = "nursing-css"; st.textContent = CSS; document.head.appendChild(st); }

  /* =================================================================================================================
   *  VÜCUT FİGÜRÜ
   * ================================================================================================================= */
  // Birim: baş yüksekliği (1 = tepe → çene). x: orta hattan uzaklık (hep pozitif, iki taraf simetrik çizilir).
  // Noktalar: [x, y, yarıçap]. torso: sağ yarı dış hattı (boyun kökünden kasığa).
  const AG = {
    adult: { S:52, total:7.5, hrx:.38, ear:[.38, .5, .06, .12], neck:[.78, 1.38, .19, .25],
      torso:[[.25,1.3],[.62,1.38],[.86,1.5],[.98,1.72],[.8,2.0],[.78,2.3],[.66,2.95],[.7,3.25],[.8,3.6],[.76,3.95],[.28,4.05]], crY:4.1,
      sh:[.84,1.72,.2], el:[.98,2.85,.15], wr:[1.08,3.85,.085], fb:[[1.0,3.0,.17],[1.05,3.45,.12]], palm:[1.12,4.13,.12,.22], th:[[1.19,3.98,.045],[1.25,4.2,.035]],
      hip:[.4,3.85,.37], kn:[.32,5.55,.18], an:[.28,7.1,.085], cb:[[.35,5.85,.19],[.31,6.5,.12]], foot:[.3,7.36,.13,.11], heel:[.28,7.36,.1,.11],
      y:{ sh:1.45, pec:2.12, chest:2.45, nav:3.0, abd:3.45, cr:4.05 }, gob:.13 },
    child: { S:64, total:5.84, hrx:.41, ear:[.41, .52, .065, .12], neck:[.8, 1.18, .18, .22],
      torso:[[.22,1.12],[.5,1.18],[.68,1.28],[.78,1.45],[.63,1.68],[.63,1.9],[.58,2.4],[.6,2.6],[.66,2.85],[.62,3.1],[.22,3.2]], crY:3.24,
      sh:[.66,1.45,.16], el:[.78,2.3,.12], wr:[.86,3.0,.075], fb:[[.8,2.42,.13],[.84,2.75,.1]], palm:[.88,3.2,.1,.17], th:[[.94,3.08,.04],[.98,3.25,.03]],
      hip:[.32,3.05,.3], kn:[.26,4.35,.15], an:[.23,5.5,.075], cb:[[.28,4.6,.155],[.25,5.05,.1]], foot:[.24,5.73,.11,.1], heel:[.23,5.73,.09,.1],
      y:{ sh:1.24, pec:1.72, chest:1.95, nav:2.42, abd:2.75, cr:3.2 }, gob:.12 },
    neonate: { S:84, total:3.85, hrx:.44, ear:[.44, .54, .06, .1], neck:[.85, 1.05, .2, .24],
      torso:[[.24,1.0],[.42,1.04],[.56,1.12],[.62,1.26],[.52,1.42],[.56,1.6],[.6,1.9],[.58,2.1],[.56,2.25],[.5,2.42],[.16,2.5]], crY:2.53,
      sh:[.56,1.26,.14], el:[.72,1.78,.12], wr:[.66,2.2,.085], fb:[[.71,1.9,.12],[.68,2.08,.1]], palm:[.64,2.33,.11,.13], th:[[.57,2.27,.04],[.56,2.36,.035]],
      hip:[.28,2.35,.26], kn:[.5,3.0,.16], an:[.38,3.58,.09], cb:[[.49,3.15,.15],[.44,3.38,.11]], foot:[.42,3.72,.12,.1], heel:[.39,3.7,.1,.1],
      y:{ sh:1.1, pec:1.45, chest:1.62, nav:1.95, abd:2.2, cr:2.5 }, gob:.12 },
  };
  // kapalı Catmull-Rom → Bezier (yumuşak gövde hattı)
  const crPath = (P) => { const n = P.length; let d = `M${P[0][0]} ${P[0][1]}`;
    for (let i = 0; i < n; i++) { const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0]} ${p2[1]}`; }
    return d + "Z"; };
  // kapsül: iki çember + dış teğetler, tek yol (a, b = [x, y, r] SVG biriminde)
  const cap = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || .001, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const sa = Math.max(-.98, Math.min(.98, (b[2] - a[2]) / L)), ca = Math.sqrt(1 - sa * sa);
    const u1 = [nx * ca + ux * sa, ny * ca + uy * sa], u2 = [-nx * ca + ux * sa, -ny * ca + uy * sa];
    const P = (c, u) => `${(c[0] + c[2] * u[0]).toFixed(1)} ${(c[1] + c[2] * u[1]).toFixed(1)}`;
    return `M${P(a, u1)}L${P(b, u1)}A${b[2]} ${b[2]} 0 ${sa < 0 ? 1 : 0} 0 ${P(b, u2)}L${P(a, u2)}A${a[2]} ${a[2]} 0 ${sa > 0 ? 1 : 0} 0 ${P(a, u1)}Z`; };

  const GCACHE = {};
  function geom(ag, view) {
    const ck = ag + view; if (GCACHE[ck]) return GCACHE[ck];
    const A = AG[ag] || AG.adult, S = A.S, T = 10, on = view !== "arka";
    const X = (x) => +(100 + x * S).toFixed(1), Y = (y) => +(T + y * S).toFixed(1), R = (r) => +(r * S).toFixed(1);
    const J = (p, k) => [X(p[0] * k), Y(p[1]), R(p[2] || 0)];
    // TEK YER: hastanın tarafı → ekrandaki yön. Ön: hastanın sağı ekranın solu (−). Arka: hastanın sağı ekranın sağı (+).
    const side = (s) => (on === (s === "sag")) ? -1 : 1;
    const sil = [], det = [], rg = [], hot = [];
    const rx = A.hrx;
    const egg = `M${X(0)} ${Y(0)}C${X(.56 * rx)} ${Y(0)} ${X(rx)} ${Y(.16)} ${X(rx)} ${Y(.42)}C${X(rx)} ${Y(.68)} ${X(.68 * rx)} ${Y(.93)} ${X(0)} ${Y(1)}C${X(-.68 * rx)} ${Y(.93)} ${X(-rx)} ${Y(.68)} ${X(-rx)} ${Y(.42)}C${X(-rx)} ${Y(.16)} ${X(-.56 * rx)} ${Y(0)} ${X(0)} ${Y(0)}Z`;
    const [ny0, ny1, nw0, nw1] = A.neck, nym = (ny0 + ny1) / 2;
    const neck = `M${X(-nw0)} ${Y(ny0)}L${X(nw0)} ${Y(ny0)}Q${X(nw0 * .96)} ${Y(nym)} ${X(nw1)} ${Y(ny1)}L${X(-nw1)} ${Y(ny1)}Q${X(-nw0 * .96)} ${Y(nym)} ${X(-nw0)} ${Y(ny0)}Z`;
    const R0 = A.torso;
    const torso = crPath([...R0, [0, A.crY], ...R0.slice().reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [X(x), Y(y)]));
    /* ---- tek parça dış hat: aynı şekiller önce kontur rengiyle (.bf-out), sonra dolguyla (.bf-in) ---- */
    sil.push(`<path d="${egg}"/>`, ...[-1, 1].map(k => `<ellipse cx="${X(A.ear[0] * k)}" cy="${Y(A.ear[1])}" rx="${R(A.ear[2])}" ry="${R(A.ear[3])}"/>`), `<path d="${neck}"/>`, `<path d="${torso}"/>`);
    [-1, 1].forEach(k => {
      const f = on ? A.foot : A.heel;
      sil.push(`<path d="${cap(J(A.sh, k), J(A.el, k))}"/>`, `<path d="${cap(J(A.el, k), J(A.wr, k))}"/>`, `<path d="${cap(J(A.fb[0], k), J(A.fb[1], k))}"/>`,
        `<ellipse cx="${X(A.palm[0] * k)}" cy="${Y(A.palm[1])}" rx="${R(A.palm[2])}" ry="${R(A.palm[3])}"/>`, `<path d="${cap(J(A.th[0], k), J(A.th[1], k))}"/>`,
        `<path d="${cap(J(A.hip, k), J(A.kn, k))}"/>`, `<path d="${cap(J(A.kn, k), J(A.an, k))}"/>`, `<path d="${cap(J(A.cb[0], k), J(A.cb[1], k))}"/>`,
        `<path d="${cap(J([A.an[0], A.an[1], A.an[2] * 1.1], k), J([f[0], f[1], f[3] * .9], k))}"/>`,
        `<ellipse cx="${X(f[0] * k)}" cy="${Y(f[1])}" rx="${R(f[2])}" ry="${R(f[3])}"/>`);
    });
    /* ---- ince anatomi çizgileri ---- */
    const d = (s) => det.push(`<path class="bf-det" d="${s}"/>`);
    const Yy = A.y, sc = R0[5][0] / .78, big = ag === "adult", kr = A.kn[2] * .6, er = A.el[2] * .45;
    if (on) {
      [-1, 1].forEach(k => {
        const sx = R0[2][0] * .8, w = R0[6][0];
        d(`M${X(.05 * k)} ${Y(Yy.sh)}Q${X(sx * .5 * k)} ${Y(Yy.sh - .07)} ${X(sx * k)} ${Y(Yy.sh + .03)}`);                       // köprücük
        if (ag !== "neonate") d(`M${X(.06 * k)} ${Y(Yy.pec)}C${X(.3 * sc * k)} ${Y(Yy.pec + .12)} ${X(.6 * sc * k)} ${Y(Yy.pec + .05)} ${X(.72 * sc * k)} ${Y(Yy.pec - .2)}`); // göğüs
        if (big) d(`M${X((A.sh[0] - .1) * k)} ${Y(A.sh[1] - .12)}Q${X((A.sh[0] - .06) * k)} ${Y(A.sh[1] + .14)} ${X((A.sh[0] + .03) * k)} ${Y(A.sh[1] + .3)}`); // deltoid
        d(`M${X(w * .95 * k)} ${Y(Yy.abd - .08)}Q${X(w * .6 * k)} ${Y(Yy.abd + .3)} ${X(.13 * k)} ${Y(Yy.cr - .03)}`);                // kasık
        d(`M${X((A.kn[0] - kr) * k)} ${Y(A.kn[1] - kr * .4)}Q${X(A.kn[0] * k)} ${Y(A.kn[1] + kr * 1.1)} ${X((A.kn[0] + kr) * k)} ${Y(A.kn[1] - kr * .4)}`); // diz kapağı
        d(`M${X((A.kn[0] - kr * .8) * k)} ${Y(A.kn[1] - kr * .6)}Q${X(A.kn[0] * k)} ${Y(A.kn[1] - kr * 1.9)} ${X((A.kn[0] + kr * .8) * k)} ${Y(A.kn[1] - kr * .6)}`);
        d(`M${X((A.el[0] - er) * k)} ${Y(A.el[1])}Q${X(A.el[0] * k)} ${Y(A.el[1] + er * .5)} ${X((A.el[0] + er) * k)} ${Y(A.el[1])}`);  // dirsek kıvrımı
        if (ag !== "neonate") d(`M${X(.13 * k)} ${Y(ny0 + .14)}L${X(.05 * k)} ${Y(ny1 - .03)}`);                                      // boyun kası
        if (big) d(`M${X((A.hip[0] + .2) * k)} ${Y(A.hip[1] + .5)}Q${X((A.hip[0] + .12) * k)} ${Y((A.hip[1] + A.kn[1]) / 2 + .3)} ${X((A.kn[0] + .1) * k)} ${Y(A.kn[1] - .28)}`); // uyluk
      });
      if (big) { d(`M${X(0)} ${Y(Yy.pec - .55)}L${X(0)} ${Y(Yy.pec - .05)}`); d(`M${X(0)} ${Y(Yy.pec + .25)}L${X(0)} ${Y(Yy.nav - .1)}`); }
      det.push(`<ellipse class="bf-det" cx="${X(0)}" cy="${Y(Yy.nav)}" rx="${R(ag === "neonate" ? .05 : .035)}" ry="${R(ag === "neonate" ? .06 : .05)}"/>`);
    } else {
      d(`M${X(0)} ${Y(ny1 - .02)}L${X(0)} ${Y(Yy.abd)}`);                                  // omurga
      d(`M${X(0)} ${Y(Yy.abd + .14)}L${X(0)} ${Y(Yy.cr - .02)}`);                          // gluteal yarık
      [-1, 1].forEach(k => {
        d(`M${X(.14 * sc * k)} ${Y(Yy.sh + .12)}Q${X(.16 * sc * k)} ${Y(Yy.chest - .3)} ${X(.36 * sc * k)} ${Y(Yy.chest - .08)}Q${X(.56 * sc * k)} ${Y(Yy.sh + .42)} ${X(.6 * sc * k)} ${Y(Yy.sh + .1)}`); // kürek kemiği
        d(`M${X(.15 * sc * k)} ${Y(Yy.sh + .2)}L${X(.6 * sc * k)} ${Y(Yy.sh + .06)}`);
        d(`M${X(.04 * k)} ${Y(Yy.cr + .02)}Q${X(.35 * sc * k)} ${Y(Yy.cr + .14)} ${X(.66 * sc * k)} ${Y(Yy.cr - .12)}`);                        // kalça çizgisi
        d(`M${X((A.kn[0] - kr) * k)} ${Y(A.kn[1] + .02)}Q${X(A.kn[0] * k)} ${Y(A.kn[1] - .05)} ${X((A.kn[0] + kr) * k)} ${Y(A.kn[1] + .02)}`);   // diz arkası
        d(`M${X((A.el[0] - er) * k)} ${Y(A.el[1] - .02)}Q${X(A.el[0] * k)} ${Y(A.el[1] + er * .9)} ${X((A.el[0] + er) * k)} ${Y(A.el[1] - .02)}`); // olekranon
        d(`M${X((A.an[0] - .025) * k)} ${Y(A.an[1] - .4 * sc)}L${X((A.an[0] - .02) * k)} ${Y(A.an[1] + .02)}`); d(`M${X((A.an[0] + .025) * k)} ${Y(A.an[1] - .4 * sc)}L${X((A.an[0] + .02) * k)} ${Y(A.an[1] + .02)}`);
        if (big) { d(`M${X(.2 * k)} ${Y(Yy.chest + .15)}Q${X(.16 * k)} ${Y((Yy.chest + Yy.abd) / 2)} ${X(.2 * k)} ${Y(Yy.abd - .05)}`); d(`M${X(A.cb[0][0] * k)} ${Y(A.cb[0][1] - .05)}L${X(A.cb[1][0] * k)} ${Y(A.cb[1][1] - .15)}`); }
      });
    }
    /* ---- tıklanabilir bölgeler (anahtar = hastanın tarafı) ---- */
    const ell = (k, cx, cy, erx, ery) => rg.push({ k, tag:"ellipse", a:`cx="${cx}" cy="${cy}" rx="${erx}" ry="${ery}"`, cx, cy });
    const pth = (k, dd, cx, cy) => rg.push({ k, tag:"path", a:`d="${dd}"`, cx, cy });
    const rct = (k, s, y0, y1, ccx, ccy, full) => { const xa = full ? X(-1.4) : Math.min(X(0), X(1.4 * s)), xb = full ? X(1.4) : Math.max(X(0), X(1.4 * s));
      rg.push({ k, tag:"rect", a:`x="${xa}" y="${Y(y0)}" width="${(xb - xa).toFixed(1)}" height="${(Y(y1) - Y(y0)).toFixed(1)}" rx="5" clip-path="CLIP"`, cx:X(ccx), cy:Y(ccy) }); };
    const capR = (k, a, b, s) => { const pa = J(a, s), pb = J(b, s); rg.push({ k, tag:"path", a:`d="${cap(pa, pb)}"`, cx:+((pa[0] + pb[0]) / 2).toFixed(1), cy:+((pa[1] + pb[1]) / 2).toFixed(1) }); };
    const yN = R0[0][1], cw = R0[5][0];
    const SIDES = ["sag", "sol"];
    if (on) {
      SIDES.forEach(s => { const k = side(s);
        rct(`gogus_${s}`, k, yN, Yy.chest, .45 * cw * k, (yN + Yy.chest) / 2 + .1);
        rct(`karin_${s}_ust`, k, Yy.chest, Yy.nav, .4 * cw * k, (Yy.chest + Yy.nav) / 2);
        rct(`karin_${s}_alt`, k, Yy.nav, Yy.abd, .4 * cw * k, (Yy.nav + Yy.abd) / 2);
        rct(`pelvis_${s}`, k, Yy.abd, A.crY + .3, .42 * cw * k, (Yy.abd + Yy.cr) / 2); });
      ell("gobek", X(0), Y(Yy.nav), R(A.gob), R(A.gob * .9));
      pth("bas", egg, X(0), Y(.5)); pth("boyun", neck, X(0), Y(nym));
      SIDES.forEach(s => { const k = side(s);
        capR(`ust_kol_${s}`, A.sh, A.el, k); capR(`on_kol_${s}`, A.fb[0], A.wr, k);
        capR(`uyluk_${s}`, A.hip, A.kn, k); capR(`bacak_${s}`, A.cb[0], A.an, k); });
      SIDES.forEach(s => { const k = side(s);
        ell(`omuz_${s}`, X(A.sh[0] * k), Y(A.sh[1] - .06), R(A.sh[2] * 1.05), R(A.sh[2] * .95));
        ell(`dirsek_${s}`, X(A.el[0] * k), Y(A.el[1]), R(A.el[2] * 1.12), R(A.el[2] * 1.12));
        ell(`diz_${s}`, X(A.kn[0] * k), Y(A.kn[1]), R(A.kn[2] * 1.12), R(A.kn[2] * 1.12));
        ell(`el_${s}`, X(A.palm[0] * k), Y(A.palm[1]), R(A.palm[2] * 1.15), R(A.palm[3] * 1.1));
        ell(`ayak_${s}`, X(A.foot[0] * k), Y(A.foot[1] - .03), R(A.foot[2] * 1.1), R(A.foot[3] * 1.4)); });
    } else {
      SIDES.forEach(s => { const k = side(s);
        rct(`sirt_${s}`, k, yN, Yy.chest + .1, .42 * cw * k, (yN + Yy.chest) / 2 + .1);
        rct(`kalca_${s}`, k, Yy.abd - .05, A.crY + .4, .42 * cw * k, (Yy.abd + Yy.cr) / 2 + .1); });
      rct("bel", 1, Yy.chest + .1, Yy.abd - .05, 0, (Yy.chest + Yy.abd) / 2, true);
      ell("sakrum", X(0), Y(Yy.abd + .15), R(.15 * sc), R(.2 * sc));
      pth("oksiput", egg, X(0), Y(.5)); pth("ense", neck, X(0), Y(nym));
      SIDES.forEach(s => { const k = side(s);
        capR(`kol_arka_${s}`, A.sh, A.el, k); capR(`on_kol_arka_${s}`, A.fb[0], A.wr, k);
        capR(`uyluk_arka_${s}`, A.hip, A.kn, k); capR(`baldir_${s}`, A.cb[0], A.an, k); });
      SIDES.forEach(s => { const k = side(s);
        ell(`dirsek_arka_${s}`, X(A.el[0] * k), Y(A.el[1]), R(A.el[2] * 1.12), R(A.el[2] * 1.12));
        ell(`diz_arka_${s}`, X(A.kn[0] * k), Y(A.kn[1]), R(A.kn[2] * 1.12), R(A.kn[2] * 1.12));
        ell(`el_sirti_${s}`, X(A.palm[0] * k), Y(A.palm[1]), R(A.palm[2] * 1.15), R(A.palm[3] * 1.1));
        ell(`topuk_${s}`, X(A.heel[0] * k), Y(A.heel[1] - .03), R(A.heel[2] * 1.25), R(A.heel[3] * 1.4)); });
      hot.push([X(0), Y(.55), R(.26)], [X(0), Y(Yy.abd + .15), R(.22 * sc)]);
      [-1, 1].forEach(k => hot.push([X(.38 * sc * k), Y(Yy.sh + .45), R(.17)], [X(A.el[0] * k), Y(A.el[1]), R(A.el[2] * 1.3)], [X(A.heel[0] * k), Y(A.heel[1]), R(A.heel[3] * 1.6)]));
    }
    return (GCACHE[ck] = { h:Math.ceil(Y(A.total) + 10), sil:sil.join(""), torso, det:det.join(""), rg, hot });
  }

  /* ---- adlar: TEK YER ---- */
  const BN = { bas:"Baş · yüz", boyun:"Boyun", gobek:"Göbek çevresi", oksiput:"Başın arkası (oksiput)", ense:"Ense", bel:"Bel", sakrum:"Sakrum", tum:"Belirsiz bölge / tüm vücut",
    gogus:"{S} göğüs", pelvis:"{S} kasık", omuz:"{S} omuz", ust_kol:"{S} üst kol", dirsek:"{S} dirsek içi", on_kol:"{S} ön kol", el:"{S} el", uyluk:"{S} uyluk", diz:"{S} diz", bacak:"{S} alt bacak", ayak:"{S} ayak",
    sirt:"{S} sırt · kürek", kalca:"{S} kalça", kol_arka:"{S} üst kol arkası", dirsek_arka:"{S} dirsek (olekranon)", on_kol_arka:"{S} ön kol arkası", el_sirti:"{S} el sırtı",
    uyluk_arka:"{S} uyluk arkası", diz_arka:"{S} diz arkası", baldir:"{S} baldır", topuk:"{S} topuk" };
  const BACK = new Set(["oksiput", "ense", "bel", "sakrum", "sirt", "kalca", "kol_arka", "dirsek_arka", "on_kol_arka", "el_sirti", "uyluk_arka", "diz_arka", "baldir", "topuk"]);
  const splitKey = (k) => { const m = /^karin_(sag|sol)_(ust|alt)$/.exec(k); if (m) return { base:"karin", s:m[1], pos:m[2] }; const n = /^(.*)_(sag|sol)$/.exec(k); return n ? { base:n[1], s:n[2] } : { base:k }; };
  const bodyName = (k) => { if (!k) return ""; const q = splitKey(k); if (q.base === "karin") return `Karın ${q.s === "sag" ? "sağ" : "sol"} ${q.pos === "ust" ? "üst" : "alt"}`;
    const t = BN[q.base]; if (!t) return k; return q.s ? t.replace("{S}", q.s === "sag" ? "Sağ" : "Sol") : t; };

  let BID = 0;
  H.body = function (o = {}) {
    const c = { ageGroup:AG[o.ageGroup] ? o.ageGroup : "adult", view:o.view === "arka" ? "arka" : "on", selected:[...(o.selected || [])], el:null, id:"bf" + (++BID) + "_" };
    const multi = o.multi !== false, toggle = o.toggle !== false;
    const nm = (k) => (o.names && o.names[k]) || bodyName(k);
    c.markup = () => {
      const G = geom(c.ageGroup, c.view), clip = `url(#${c.id}t)`;
      const rg = G.rg.filter(r => !o.only || o.only.includes(r.k));
      c._centers = rg.map(r => [r.k, r.cx, r.cy]);
      const mk = {}; (o.marks || []).forEach(m => { if (m && m.region) (mk[m.region] = mk[m.region] || []).push(m); });
      const regs = rg.map(r => { const sel = c.selected.includes(r.k), m = mk[r.k];
        const st = !sel && m ? ` style="--hc:${m[0].color || "var(--high)"}"` : "";
        return `<${r.tag} ${r.a.replace("CLIP", clip)} class="bf-rg${sel ? " sel" : m ? " has" : ""}" data-bfr="${r.k}"${st}><title>${E(nm(r.k))}</title></${r.tag}>`; }).join("");
      const pins = rg.filter(r => mk[r.k] && mk[r.k].some(m => m.label != null && m.label !== "")).map(r => { const m = mk[r.k].find(x => x.label != null && x.label !== "");
        return `<g class="bf-pin"><circle cx="${r.cx}" cy="${r.cy}" r="7.5" style="fill:${m.color || "var(--high)"}"/><text x="${r.cx}" y="${r.cy + 3.1}">${E(String(m.label)).slice(0, 3)}</text></g>`; }).join("");
      const hot = o.hot && c.view === "arka" ? G.hot.map(([x, y, r]) => `<circle class="bf-hot" cx="${x}" cy="${y}" r="${r}"/>`).join("") : "";
      const L = c.view === "on" ? ["Sağ", "Sol"] : ["Sol", "Sağ"];
      return `<div class="bodyWrap">${toggle ? `<div class="seg"><button type="button" data-bfv="on" class="${c.view === "on" ? "on" : ""}">Ön</button><button type="button" data-bfv="arka" class="${c.view === "arka" ? "on" : ""}">Arka</button></div>` : ""}
        <div class="sides"><span>${L[0]}</span><span class="c">${c.view === "on" ? "ÖN" : "ARKA"}</span><span>${L[1]}</span></div>
        <svg class="bfig" viewBox="0 0 200 ${G.h}" role="img" aria-label="Vücut haritası · ${c.view === "on" ? "ön" : "arka"} görünüm · ekranın solu hastanın ${L[0].toLowerCase()}ı">
          <defs><clipPath id="${c.id}t"><path d="${G.torso}"/></clipPath></defs>
          <g class="bf-out" style="stroke:var(--body-line);stroke-width:2.4;stroke-linejoin:round">${G.sil}</g><g class="bf-in">${G.sil}</g>
          <g>${G.det}</g><g>${regs}</g>${hot}${pins}</svg>
        ${o.hot && c.view === "arka" ? `<div class="bfHint">Kesik halkalar: bası yarasının sık görüldüğü yerler.</div>` : ""}</div>`;
    };
    Object.defineProperty(c, "html", { get:() => c.markup() });
    c.render = () => { if (c.el) c.el.innerHTML = c.markup(); return c; };
    c.mount = (el) => { c.el = el; c.render(); el.onclick = onClick; return c; };
    c.setView = (v) => { c.view = v === "arka" ? "arka" : "on"; return c.render(); };
    c.setSelected = (a) => { c.selected = [...(a || [])]; return c.render(); };
    function nearest(svg, ev) { try { const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const m = svg.getScreenCTM(); if (!m) return null;
      const q = pt.matrixTransform(m.inverse()); let best = null, bd = 22; (c._centers || []).forEach(([k, x, y]) => { const dd = Math.hypot(x - q.x, y - q.y); if (dd < bd) { bd = dd; best = k; } }); return best; } catch (e) { return null; } }
    function onClick(ev) {
      const vb = ev.target.closest("[data-bfv]"); if (vb) { c.view = vb.dataset.bfv; c.render(); o.onView && o.onView(c.view, c); return; }
      const r = ev.target.closest("[data-bfr]"); let k = r && r.dataset.bfr;
      if (!k) { const svg = ev.target.closest("svg.bfig"); if (!svg) return; k = nearest(svg, ev); }   // küçük bölgeler: görünmez geniş dokunma alanı
      if (!k) return;
      if (multi) { const i = c.selected.indexOf(k); i < 0 ? c.selected.push(k) : c.selected.splice(i, 1); } else c.selected = c.selected[0] === k ? [] : [k];
      c.render(); o.onPick && o.onPick(k, c);
    }
    return c;
  };
  H.body.name = bodyName;
  H.body.viewOf = (k) => BACK.has(splitKey(k).base) ? "arka" : "on";
  H.body.keys = (view) => geom("adult", view === "arka" ? "arka" : "on").rg.map(r => r.k);

  /* =================================================================================================================
   *  HEMŞİRELİK VERİ DEPOSU (yalnız bu modül yazar; sentetik tohum verisi)
   * ================================================================================================================= */
  const NS = H.data.nursing = H.data.nursing || {
    records:[
      { key:"wound", pid:"p6", date:"19.09", at:"08:10", user:"hs.gulnar", d:{ woundId:"w1", regions:["sakrum"], view:"arka", tur:"Basınç ülseri", evre:"2", oy:"İç kaynaklı (hastanede)", L:"4", W:"3", D:"0,3", eksMik:2, doku:3, _area:12, _push:13 } },
      { key:"wound", pid:"p6", date:"20.09", at:"08:30", user:"hs.gulnar", d:{ woundId:"w1", regions:["sakrum"], view:"arka", tur:"Basınç ülseri", evre:"2", oy:"İç kaynaklı (hastanede)", L:"3,8", W:"2,8", D:"0,3", eksMik:2, doku:3, _area:10.6, _push:13 } },
      { key:"wound", pid:"p6", date:"21.09", at:"08:20", user:"hs.gulnar", d:{ woundId:"w1", regions:["sakrum"], view:"arka", tur:"Basınç ülseri", evre:"2", oy:"İç kaynaklı (hastanede)", L:"3,5", W:"2,6", D:"0,2", eksMik:1, doku:2, _area:9.1, _push:11 } },
      { key:"wound", pid:"p6", date:"22.09", at:"08:15", user:"hs.gulnar", d:{ woundId:"w1", regions:["sakrum"], view:"arka", tur:"Basınç ülseri", evre:"2", oy:"İç kaynaklı (hastanede)", L:"3,2", W:"2,4", D:"0,2", eksMik:1, doku:2, _area:7.7, _push:10 } },
      { key:"wound", pid:"p1", date:"22.09", at:"09:00", user:"hs.sevda", d:{ woundId:"w2", regions:["topuk_sag"], view:"arka", tur:"Basınç ülseri", evre:"1", oy:"İç kaynaklı (hastanede)", L:"2", W:"1,5", D:"0", eksMik:0, doku:1, _area:3, _push:6 } },
      { key:"pain", pid:"p6", date:TODAY, at:"09:05", user:"hs.gulnar", d:{ scale:"NRS", regions:["karin_sag_alt", "karin_sol_alt"], _score:3 } },
      { key:"pain", pid:"p10", date:TODAY, at:"16:10", user:"hs.gulnar", d:{ scale:"NRS", regions:["karin_sag_ust"], _score:4 } },
      { key:"io", pid:"p6", date:TODAY, at:"14:00", user:"hs.gulnar", d:{ _in:1050, _out:850 } },
    ],
    ongoing:[
      { pid:"p6", name:"Damar yolu", region:"on_kol_sol", day:2 }, { pid:"p6", name:"Mesane sonda", region:null, day:3 },
      { pid:"p1", name:"CVP", region:"boyun", day:2 }, { pid:"p1", name:"Arter kateteri", region:"on_kol_sol", day:2 }, { pid:"p1", name:"Entübasyon", region:null, day:2 },
      { pid:"p2", name:"Damar yolu", region:"dirsek_sag", day:4 }, { pid:"p7", name:"Damar yolu", region:"dirsek_sag", day:1 }, { pid:"p9", name:"Damar yolu", region:"on_kol_sag", day:1 },
      { pid:"p10", name:"Dren", region:"karin_sag_ust", day:1 }, { pid:"p13", name:"Damar yolu", region:"el_sol", day:4 }, { pid:"p11", name:"Damar yolu", region:"el_sol", day:2 },
    ],
    favs:new Set(["Damar yolu", "Pozisyon verme", "Ağız bakımı", "EKG", "Defekasyon"]),
    ioTpl:[
      { name:"Servis standart", in:{ IV:[{ ad:"%0,9 NaCl", hacim:"1000" }], Oral:[{ ad:"Su / içecek" }] }, out:{ Idrar:[{ tip:"Spontan" }] } },
      { name:"Postoperatif", in:{ IV:[{ ad:"Laktatlı Ringer", hacim:"1000" }], PCAi:[{ ad:"PCA infüzyon" }] }, out:{ Idrar:[{ tip:"Foley" }], Dren:[{ no:"1", bolge:"Batın" }] } },
    ],
    scale2:{ p2:"Dr. Kamran Rzayev" },   // NEWS2 SpO₂ ölçek 2: hekimin seçimi (örnek)
  };

  /* =================================================================================================================
   *  ORTAK: NEWS2 (RCP 2017)
   * ================================================================================================================= */
  const PTS = [3, 2, 1, 0, 1, 2, 3];
  const COLF = {
    rr:(v) => v <= 8 ? 0 : v <= 11 ? 2 : v <= 20 ? 3 : v <= 24 ? 5 : 6,
    spo2:(v, x) => !x.scale2 ? (v <= 91 ? 0 : v <= 93 ? 1 : v <= 95 ? 2 : 3)
      : (v <= 83 ? 0 : v <= 85 ? 1 : v <= 87 ? 2 : v <= 92 ? 3 : !x.o2 ? 3 : v <= 94 ? 4 : v <= 96 ? 5 : 6),
    o2:(v) => v ? 1 : 3,
    sbp:(v) => v <= 90 ? 0 : v <= 100 ? 1 : v <= 110 ? 2 : v <= 219 ? 3 : 6,
    hr:(v) => v <= 40 ? 0 : v <= 50 ? 2 : v <= 90 ? 3 : v <= 110 ? 4 : v <= 130 ? 5 : 6,
    loc:(v) => v === "A" ? 3 : 6,
    temp:(v) => v <= 35 ? 0 : v <= 36 ? 2 : v <= 38 ? 3 : v <= 39 ? 4 : 5,
  };
  const N2ROWS = (scale2) => [
    ["rr", "Solunum /dk", ["≤8", "", "9–11", "12–20", "", "21–24", "≥25"]],
    ["spo2", scale2 ? "SpO₂ ölçek 2 %" : "SpO₂ ölçek 1 %", scale2 ? ["≤83", "84–85", "86–87", "88–92 · ≥93 havada", "93–94 O₂'de", "95–96 O₂'de", "≥97 O₂'de"] : ["≤91", "92–93", "94–95", "≥96", "", "", ""]],
    ["o2", "Ek oksijen", ["", "Evet", "", "Hayır", "", "", ""]],
    ["sbp", "Sistolik KB", ["≤90", "91–100", "101–110", "111–219", "", "", "≥220"]],
    ["hr", "Nabız /dk", ["≤40", "", "41–50", "51–90", "91–110", "111–130", "≥131"]],
    ["loc", "Bilinç", ["", "", "", "A", "", "", "Yeni konfüzyon · V · P · U"]],
    ["temp", "Isı °C", ["≤35,0", "", "35,1–36,0", "36,1–38,0", "38,1–39,0", "≥39,1", ""]],
  ];
  function news2(x) {   // x: { rr, spo2, o2(bool), sbp, hr, acvpu, temp, scale2 }
    const vals = { rr:N(x.rr), spo2:N(x.spo2), o2:!!x.o2, sbp:N(x.sbp), hr:N(x.hr), loc:x.acvpu || null, temp:N(x.temp) };
    const col = {}, pts = {}; let total = 0, complete = true, any3 = false;
    Object.keys(COLF).forEach(k => { const v = vals[k]; if (v == null || v === "") { complete = false; col[k] = null; pts[k] = null; return; }
      col[k] = COLF[k](v, x); pts[k] = PTS[col[k]]; total += pts[k]; if (pts[k] === 3) any3 = true; });
    const lvl = total >= 7 ? 3 : total >= 5 || any3 ? 2 : total >= 1 ? 1 : 0;
    return { total, complete, any3, col, pts, lvl };
  }
  const N2RESP = [
    ["0", "Her vardiyada rutin izlem", "var(--ok)"],
    ["1–4", "En az 4 saatte bir izlem · sorumlu hemşire değerlendirir", "var(--mid)"],
    ["5–6 ya da tek parametrede 3", "En az saatte bir izlem · hekime acil bildirim", "var(--high)"],
    ["≥7", "Sürekli izlem · acil ekip (hızlı yanıt) çağrılır", "var(--crit)"],
  ];
  const lvlColor = (l) => ["var(--ok)", "var(--mid)", "var(--high)", "var(--crit)"][l] || "var(--mute)";
  /* 30.09 · kontrol §4-1: vital kaydı NEWS2'yi güncelliyordu ama risk düzeyi (p.risk) ve alarm zinciri değişmiyordu.
   * Aynı NEWS2 bandı (yukarıdaki news2().lvl) H.riskFromNews2 ile risk düzeyine çevrilir. Yüksek/kritik banda GİRİŞTE
   * mevcut alarm zincirinin aynısı üretilir: alarm listesine açık alarm + hekim (ve sorumlu hemşire) bildirimi. Tanı değildir. */
  function applyNews2Risk(p, r) {
    if (!r || !r.complete || !H.riskFromNews2) return "";
    const before = p.risk || "stable", after = H.riskFromNews2(r.lvl, before), HI = ["high", "crit"];
    p.risk = after;
    const entered = (HI.includes(after) && !HI.includes(before)) || (after === "crit" && before === "high");
    if (entered) {
      const sev = after === "crit" ? "crit" : "high", bed = H.bed(p.bed).no;
      const txt = `NEWS2 ${r.total} · kötüleşme kriterleri karşılanıyor · vital girişi ${H.now()}`;
      const al = H.data.alarms || (H.data.alarms = []), open = al.find(a => a.pid === p.id && a.src === "news2" && a.state === "open");
      if (open) Object.assign(open, { txt, sev, ageMin:0 });
      else al.unshift({ id:Math.max(0, ...al.map(a => +a.id || 0)) + 1, pid:p.id, txt, sev, ageMin:0, step:0, state:"open", src:"news2" });
      if (H.pushNotif) H.pushNotif({ at:H.now(), to:["hekim", "charge"], sev, title:"Kötüleşme kriterleri karşılanıyor", body:`${bed} · NEWS2 ${r.total} · vital girişi ${H.now()} · değerlendirme önerilir`, go:["patient", { pid:p.id, tab:"ozet" }], pid:p.id });
      H.log("NEWS2 eşiği aşıldı · alarm açıldı", `${bed} · NEWS2 ${r.total} · ${H.SEV[before].l} → ${H.SEV[after].l}`);
    }
    return after !== before ? ` · risk ${H.SEV[before].l} → ${H.SEV[after].l}` : "";
  }
  const n2Resp = (r) => `<div class="n2resp">${N2RESP.map(([a, b, c], i) => `<div class="${r && r.complete && r.lvl === i ? "on" : ""}" style="--c:${c}"><b>NEWS2 ${a}</b><span>${b}</span></div>`).join("")}</div>
    <div class="nfNote">Puan tablosu: <b>NEWS2 (RCP 2017)</b>${ADM("değerlendirme sıklığı ve yanıt hastanenin onaylı protokolüne göre uygulanır · hastanenin onayı gerekir")} · Karar hekimindir.</div>`;
  const n2Table = (r, scale2) => `<div class="nfTw"><table class="n2"><thead><tr><th>Parametre</th>${PTS.map(p => `<th>${p}</th>`).join("")}<th>Puan</th></tr></thead><tbody>${N2ROWS(scale2).map(([k, l, cells]) =>
    `<tr><td>${l}</td>${cells.map((t, i) => `<td class="p${PTS[i]}${r.col[k] === i ? " on" : ""}">${t}</td>`).join("")}<td class="pt">${r.pts[k] ?? "—"}</td></tr>`).join("")}</tbody></table></div>`;
  const ACV = [["A", "Uyanık (A)"], ["C", "Yeni konfüzyon (C)"], ["V", "Sese yanıt (V)"], ["P", "Ağrıya yanıt (P)"], ["U", "Yanıtsız (U)"]];
  const ACV_TXT = { A:"Uyanık", C:"Konfüze", V:"Sese yanıt", P:"Ağrıya yanıt", U:"Yanıtsız" };
  const acvFrom = (p) => { const l = (p.v && p.v.loc) || ""; return /Uyan/.test(l) ? "A" : /Konf/.test(l) ? "C" : /Sese/.test(l) ? "V" : /Ağrı/.test(l) ? "P" : /Yanıts/.test(l) ? "U" : undefined; };

  /* ---- görev tamamlama: hastanın o işe ait ilk geciken, yoksa ilk "şimdi" görevi ---- */
  function doneTask(pid, pred, specific) {
    if (specific && specific.pid === pid && specific.state !== "done") { specific.state = "done"; specific.doneAt = H.now(); specific.by = uname(); return specific; }
    const c = H.data.tasks.filter(t => t.pid === pid && pred(t)).sort((a, b) => a.t - b.t);
    const t = c.find(x => x.state === "late") || c.find(x => x.state === "due");
    if (t) { t.state = "done"; t.doneAt = H.now(); t.by = uname(); }
    return t;
  }
  const rerender = () => { try { if (H.renderApp && H.state.user) H.renderApp(); } catch (e) { console.error(e); } };

  /* =================================================================================================================
   *  FORM ALTYAPISI
   * ================================================================================================================= */
  let CUR = null;   // çizilmekte olan form bağlamı
  const val = (d, path) => path.split(".").reduce((o, k) => o == null ? undefined : o[k], d);
  const setv = (d, path, v) => { const ks = path.split("."); let o = d; ks.slice(0, -1).forEach((k, i) => { if (o[k] == null) o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[k]; }); o[ks[ks.length - 1]] = v; };
  // seçenek grubu: vals = ["a", ...] ya da [[değer, etiket, puan]]; o.multi çoklu, o.num sayı değer
  const OP = (d, f, vals, o = {}) => { const cur = val(d, f);
    const sc = vals.some(x => Array.isArray(x) && x[2] != null);   // puanlı grup → eşit ızgara + puan rozeti
    return `<div class="opts${sc ? " nfSc" : ""}" data-f="${f}"${o.multi ? " data-m" : ""}${o.num ? " data-n" : ""}>${vals.map(x => { const [v, l, pt] = Array.isArray(x) ? x : [x, x];
      const on = o.multi ? (cur || []).includes(v) : cur === v;
      return `<i data-v="${E(v)}" class="${on ? "on" : ""}">${E(l)}${pt != null ? `<small>${pt}</small>` : ""}</i>`; }).join("")}</div>`; };
  const FL = (label, inner, o = {}) => { const miss = CUR && CUR.showMiss && o.req && CUR.missing.some(m => m[0] === o.req);
    return `<div class="fld${o.col ? " col" : ""}"><label>${label}${o.req ? ' <span class="req">●</span>' : ""}</label><div class="${miss ? "nfMiss" : ""}" style="min-width:0">${inner}${o.hint ? `<div class="nfNote">${o.hint}</div>` : ""}</div></div>`; };
  const TX = (d, f, ph = "", o = {}) => `<input data-f="${f}" value="${E(val(d, f) ?? "")}" placeholder="${E(ph)}"${o.mode ? ` inputmode="${o.mode}"` : ""}${o.list ? ` list="${o.list}"` : ""}${o.w ? ` style="max-width:${o.w}px"` : ""}${o.type ? ` type="${o.type}"` : ""}>`;
  const TA = (d, f, ph = "") => `<textarea data-f="${f}" placeholder="${E(ph)}" style="min-height:64px">${E(val(d, f) ?? "")}</textarea>`;
  const ST = (d, f, o = {}) => `<div class="step" data-stf="${f}" data-inc="${o.inc || 1}" data-min="${o.min ?? ""}" data-max="${o.max ?? ""}" data-def="${o.def ?? ""}"><button type="button" data-st="-1">−</button><input data-f="${f}" inputmode="decimal" value="${E(val(d, f) ?? "")}" placeholder="${E(o.ph ?? "")}"><button type="button" data-st="1">+</button>${o.u ? `<span class="u">${o.u}</span>` : ""}</div>`;
  const CK = (d, f, label) => `<label class="nfChk"><input type="checkbox" data-f="${f}"${val(d, f) ? " checked" : ""}>${label}</label>`;
  const BOX = (title, inner, right = "") => `<div class="box"><h5>${title}${right ? `<span class="r">${right}</span>` : ""}</h5>${inner}</div>`;
  /* 24.09 · kurulum / yönetim notları klinik kullanıcıya (hemşire, hekim) görünmez; yalnız yönetim hesabında basılır.
   * Klinik KAYNAK ("Puan tablosu: <ölçek>") ve "karar hekimindir" herkese kalır. ADM → " · <not>" ya da "";
   * ADMBOX → tek başına duran not kutusu ya da hiç (boş şerit bırakmaz). */
  const ADM = (txt, pre = " · ") => { const n = H.adminNote ? H.adminNote(txt) : ""; return n ? pre + n : ""; };
  const ADMBOX = (txt, cls = "nfNote", st = "") => H.isAdminish && H.isAdminish() ? `<div class="${cls}"${st ? ` style="${st}"` : ""}>${H.adminNote(txt)}</div>` : "";
  const SCN = (name) => `<div class="nfNote">Puan tablosu: <b>${name}</b>${ADM("hastanenin onayı gerekir")}</div>`;
  const ARC = (name) => H.isAdminish && H.isAdminish() ? `<div class="nfArc" title="Yalnız yönetim hesaplarına görünür">${I("file").replace("<svg ", '<svg style="width:14px;height:14px;vertical-align:-2px" ')} <b>${name}</b> · puan tablosu arşive alınacak. Maddeler aşağıda yapı olarak duruyor; puanlar hastanenin onaylı formundan eklenecek.</div>` : "";
  // toplam satırı: büyük sayı + risk sınıfı rengi (c) + risk hapı
  const TOT = (v, mx, c, risk = "", rest = "", st = "") => `<div class="nfTotal" style="${c ? `--c:${c};` : ""}${st}"><span class="k">Toplam</span><b>${v}</b>${mx ? `<span class="mx">${mx}</span>` : ""}${risk ? `<span class="nfRisk">${risk}</span>` : ""}${rest ? `<span class="rest">${rest}</span>` : ""}</div>`;
  const FIG = (F, id, cfg) => { F.figs[id] = cfg; return `<div data-fig="${id}"></div>`; };
  const badge = (v, l, c) => `<div class="scoreBadge"><b style="color:${c || "var(--ink)"}">${v}</b><small>${l}</small></div>`;
  const chips = (keys, act = "rmReg") => keys.length ? `<div class="nfChips">${keys.map(k => `<span>${E(bodyName(k))}<button type="button" data-act="${act}" data-k="${k}" aria-label="Kaldır">${I("x")}</button></span>`).join("")}</div>` : "";

  function head(F) {
    const p = F.p, b = H.bed(p.bed) || {}, u = H.unit(b.unitId) || {};
    const bs = (F.def.badges ? F.def.badges(F.d, p, F) : []).map(x => badge(x[0], x[1], x[2])).join("");
    return `<div class="nfHead" data-nfhead>
      <div class="pt"><span class="bn">${E(b.no || "")}</span><b>${E(p.name)}</b><div class="mt">${H.ageText(p)} · ${p.sex === "K" ? "Kadın" : "Erkek"} · ${E(u.tr || "")} · ${E(p.dx)}</div></div>
      <div class="mt">Kayıt: <b>${TODAY} ${H.now()}</b><br>Kaydeden: <b>${E(uname())}</b></div>
      ${p.allergies && p.allergies.length ? `<span class="tag c">${I("alert")}Alerji: ${E(p.allergies.join(", "))}</span>` : ""}
      <div class="nfBadges">${bs}</div></div>`;
  }
  function draw(F) {
    if (!F.root || !F.root.isConnected) return;
    CUR = F; F.figs = {};
    F.missing = F.def.req ? F.def.req(F.d, F.p, F) : [];
    const ae = document.activeElement; let fk = null, ss = null, se = null;
    if (ae && F.root.contains(ae) && ae.dataset && ae.dataset.f && ae.type !== "checkbox") { fk = ae.dataset.f; try { ss = ae.selectionStart; se = ae.selectionEnd; } catch (e) {} }
    const sc = F.modal.scrollTop;
    F.root.innerHTML = head(F)
      + (F.readOnly ? `<div class="note i nfMissNote">Görüntüleme modu: bu formu kaydetme yetkiniz yok (hemşirelik formu yetkisi gerekir).</div>` : "")
      + (F.showMiss && F.missing.length ? `<div class="note nfMissNote" style="color:var(--crit);border-color:var(--crit);background:var(--critSoft)">Eksik zorunlu alan: ${F.missing.map(m => E(m[1])).join(" · ")}</div>` : "")
      + F.def.render(F.d, F.p, F);
    F.root.querySelectorAll("[data-fig]").forEach(el => { const cfg = F.figs[el.dataset.fig]; if (cfg) H.body(cfg).mount(el); });
    F.modal.scrollTop = sc;
    if (fk) { const el = [...F.root.querySelectorAll("[data-f]")].find(x => x.dataset.f === fk && x.tagName !== "DIV"); if (el) { try { el.focus({ preventScroll:true }); if (ss != null) el.setSelectionRange(ss, se); } catch (e) {} } }
    CUR = null;
  }
  function drawHead(F) { const h = F.root.querySelector("[data-nfhead]"); if (!h) return; const t = document.createElement("div"); t.innerHTML = head(F); h.replaceWith(t.firstElementChild); }

  function bindForm(F) {
    const root = F.root;
    // form penceresinde başka forma geçilebildiği için F.d her olayda yeniden okunur (sabit yakalanmaz)
    root.addEventListener("click", (e) => {
      const d = F.d, t = e.target;
      const oi = t.closest("[data-f] > i[data-v]");   // .opts, NRS cetveli, yüz ölçeği
      if (oi && root.contains(oi)) { const g = oi.parentNode, f = g.dataset.f; let v = oi.dataset.v; if (g.hasAttribute("data-n")) v = +v;
        if (g.hasAttribute("data-m")) { const a = [...(val(d, f) || [])], i = a.indexOf(v); i < 0 ? a.push(v) : a.splice(i, 1); setv(d, f, a); }
        else setv(d, f, val(d, f) === v ? undefined : v);
        F.def.after && F.def.after(d, f, F); return draw(F); }
      const sb = t.closest("[data-st]");
      if (sb) { const w = sb.closest("[data-stf]"), f = w.dataset.stf, inc = +w.dataset.inc, dir = +sb.dataset.st, cur = N(val(d, f)), def = N(w.dataset.def);
        let v = cur == null ? (def != null ? def : 0) : cur + dir * inc; const mn = N(w.dataset.min), mx = N(w.dataset.max);
        if (mn != null) v = Math.max(mn, v); if (mx != null) v = Math.min(mx, v);
        const dec = (String(inc).split(".")[1] || "").length; setv(d, f, dec ? v.toFixed(dec).replace(".", ",") : String(Math.round(v)));
        F.def.after && F.def.after(d, f, F); return draw(F); }
      const ad = t.closest("[data-add]");
      if (ad) { const f = ad.dataset.add, a = [...(val(d, f) || [])]; a.push(ad.dataset.tpl ? JSON.parse(ad.dataset.tpl) : {}); setv(d, f, a); F.def.after && F.def.after(d, f, F); return draw(F); }
      const dl = t.closest("[data-del]");
      if (dl) { const [f, i] = dl.dataset.del.split("|"), a = [...(val(d, f) || [])]; a.splice(+i, 1); setv(d, f, a); F.def.after && F.def.after(d, f, F); return draw(F); }
      const ac = t.closest("[data-act]");
      if (ac && root.contains(ac)) { const r = F.def.act ? F.def.act(ac.dataset.act, ac, F) : null;
        if (ac.dataset.act === "rmReg") { d.regions = (d.regions || []).filter(k => k !== ac.dataset.k); }
        if (r !== false) draw(F); }
    });
    root.addEventListener("input", (e) => { const d = F.d, el = e.target; if (!el.dataset || !el.dataset.f || el.type === "checkbox") return;
      setv(d, el.dataset.f, el.value); F.def.after && F.def.after(d, el.dataset.f, F);
      if (el.type === "range") { root.querySelectorAll(`[data-out="${el.dataset.f}"]`).forEach(o => o.textContent = f1(N(el.value))); drawHead(F); } else draw(F); });
    root.addEventListener("change", (e) => { const d = F.d, el = e.target; if (!el.dataset || !el.dataset.f) return;
      if (el.type === "checkbox") { setv(d, el.dataset.f, el.checked); F.def.after && F.def.after(d, el.dataset.f, F); draw(F); }
      else if (el.type === "range" || el.tagName === "SELECT") draw(F); });
  }

  function saveForm(F, sign, print) {
    if (F.readOnly) return H.toast("Bu formu kaydetme yetkiniz yok.", "w");
    F.missing = F.def.req ? F.def.req(F.d, F.p, F) : [];
    if (F.missing.length) { F.showMiss = true; draw(F); H.toast("Eksik zorunlu alan: " + F.missing.map(m => m[1]).join(", "), "e"); return; }
    const summary = F.def.save ? F.def.save(F.d, F.p, F) : "";
    const rec = { key:F.key, pid:F.p.id, date:TODAY, at:H.now(), user:H.state.user ? H.state.user.u : "—", signed:!!sign, d:JSON.parse(JSON.stringify(F.d)), summary };
    NS.records.push(rec);
    H.log("form:" + F.key, F.p.id);
    if (sign) H.log("imza:" + F.key, F.p.id);
    if (!F.def.noTask) doneTask(F.p.id, t => t.form === F.key, F.task);
    // yazdırılacaksa içerik pencere kapanmadan, ekrandaki (kaydedilen) hâliyle okunur
    const pr = print ? formPrintData(F.root, false) : null;
    H.closeModal();
    H.toast(`${F.def.title} kaydedildi${sign ? " ve imzalandı" : ""} · ${F.p.name}${summary ? " · " + summary : ""}`);
    rerender();
    if (pr && H.print) H.print.open("form", { pid:F.p.id, form:F.key, title:F.def.title, sections:pr, summary, at:`${TODAY} ${rec.at}`, by:uname(), signed:!!sign });
  }

  /* ---------- form çıktısı: ekrandaki formdan alan / seçenek / değer okunur (her form için ayrı şablon gerekmez) ----------
   * blank=true → boş kâğıt form: bütün seçenekler ☐ ile, metin alanları boş çizgi. Yönetim notları (adm-note, nfArc) alınmaz. */
  const txt = (el) => (el ? el.textContent : "").replace(/\s+/g, " ").trim();
  function fieldOf(fl, blank) {
    const lab = txt(fl.querySelector(":scope>label")).replace(/●/g, "").trim();
    const box = fl.querySelector(":scope>div") || fl, parts = [], opts = [];
    box.querySelectorAll("[data-f]").forEach(el => {
      if (el.closest(".fld") !== fl) return;
      if (el.tagName === "DIV" && el.querySelectorAll(":scope>i[data-v]").length) {
        el.querySelectorAll(":scope>i[data-v]").forEach(i => { const pt = i.querySelector(":scope>small"), c = i.cloneNode(true); c.querySelectorAll(":scope>small").forEach(x => x.remove()); c.querySelectorAll("br").forEach(b => b.replaceWith(" · ")); opts.push({ l:txt(c), pt:pt ? txt(pt) : "", on:!blank && i.classList.contains("on") }); });
      } else if (el.type === "checkbox") { parts.push({ chk:txt(el.closest("label")), on:!blank && el.checked }); }
      else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
        const st = el.closest(".step"), u = st ? txt(st.querySelector(".u")) : "";
        parts.push({ v:blank ? "" : (el.tagName === "SELECT" ? txt(el.selectedOptions[0]) : el.value), u, area:el.tagName === "TEXTAREA" });
      }
    });
    if (!opts.length && !parts.length) { const t2 = txt(box); if (t2) parts.push({ v:blank ? "" : t2 }); }
    return { l:lab, opts, parts };
  }
  function formPrintData(root, blank) {
    const secs = [];
    const boxes = [...root.querySelectorAll(".box")];
    const take = (scope, title) => {
      const own = (sel) => [...scope.querySelectorAll(sel)].filter(x => x.closest(".box") === (scope.classList.contains("box") ? scope : null) || (!scope.classList.contains("box") && !x.closest(".box")));
      const rows = own(".fld").map(fl => fieldOf(fl, blank));
      own(".nfChk").filter(c => !c.closest(".fld")).forEach(c => { const i = c.querySelector("input"); rows.push({ l:"", opts:[], parts:[{ chk:txt(c), on:!blank && i && i.checked }] }); });
      const tot = own(".nfTotal").map(x => blank ? "" : txt(x)).filter(t2 => blank || t2);
      const chips = own(".nfChips").map(x => blank ? "" : [...x.querySelectorAll("span")].map(txt).join(", ")).filter(Boolean);
      const notes = own(".nfNote").filter(n => !n.closest(".adm-note")).map(n => { const c = n.cloneNode(true); c.querySelectorAll(".adm-note").forEach(x => x.remove()); return txt(c).replace(/\s*·\s*$/, ""); })
        .filter(t2 => /^Puan tablosu|Risk sınıfı|Düşük toplam|Yaygın|Kaynak ölçek/i.test(t2));
      if (rows.length || tot.length || chips.length) secs.push({ t:title, rows, tot, chips, notes });
    };
    if (!boxes.length) take(root, ""); else { take(root, ""); boxes.forEach(b => take(b, txt(b.querySelector(":scope>h5")))); }
    return secs;
  }
  // Boş form: formu geçici, görünmez bir kapta varsayılan hâliyle çizip yapısını okur.
  function blankPrint(key, p) {
    const def = FORMS[key]; if (!def || !H.print) return;
    const host = document.createElement("div"); host.style.cssText = "position:absolute;left:-10000px;top:0;width:1000px"; host.className = "nf"; document.body.appendChild(host);
    const T = { key, def, p, d:def.init(p), figs:{}, showMiss:false, missing:[], root:host, modal:{ scrollTop:0 }, blank:true };
    try { draw(T); } catch (e) { console.warn("boş form", e); }
    const secs = formPrintData(host, true); host.remove();
    H.print.open("form", { pid:p.id, form:key, title:def.title, sections:secs, blank:true });
  }

  // pencere çerçevesindeki yeni düğme/başlıklar 4 dilde (form içeriği klinik metin olarak Türkçe kalır)
  H.addT({
    nf_forms:{ AZ:"Formalar", TR:"Formlar", RU:"Формы", EN:"Forms" },
    nf_last:{ AZ:"Son", TR:"Son", RU:"Последняя", EN:"Last" },
    nf_today:{ AZ:"bu gün", TR:"bugün", RU:"сегодня", EN:"today" },
    nf_blank:{ AZ:"Boş formanı çap et", TR:"Boş formu yazdır", RU:"Печать пустой формы", EN:"Print blank form" },
    nf_paper:{ AZ:"Kağız ehtiyatı", TR:"Kâğıt yedek", RU:"Бумажный резерв", EN:"Paper fallback" },
    nf_signprint:{ AZ:"Möhürlə və çap et", TR:"Mühürle ve yazdır", RU:"Подписать и печатать", EN:"Seal and print" },
    nf_io_from_form:{ AZ:"Qəbul–xaric formasından", TR:"Aldığı–çıkardığı formundan", RU:"Из формы «поступление–выведение»", EN:"From the intake–output form" },
  });
  const formsFor = (p, key) => (H.FORMS || []).filter(f => FORMS[f.key] && (f.key === key || !f.ages || f.ages.includes(p.ageGroup)));
  const lastRec = (key, pid) => { const r = recsOf(key, pid).slice(-1)[0]; return r ? `${r.date === TODAY ? H.t("nf_today") : r.date} ${r.at}` : "—"; };
  function navHtml(F) {
    return `<h6>${H.t("nf_forms")}</h6>${formsFor(F.p, F.key).map(f => `<button type="button" data-nfk="${f.key}" class="${f.key === F.key ? "on" : ""}">${I(f.icon)}<span>${E(f.name)}</span><small>${H.t("nf_last")}: ${E(lastRec(f.key, F.p.id))}</small></button>`).join("")}
      ${H.print && H.print.canDoc("form") ? `<button type="button" class="nfPrBl" data-nfblank>${I("print")}<span>${H.t("nf_blank")}</span><small>${H.t("nf_paper")} · ${E(F.def.title)}</small></button>` : ""}`;
  }

  H.forms = H.forms || {};
  H.forms.open = (key, pid, opt = {}) => {
    const def = FORMS[key], p = H.pt(pid);
    if (!def) return H.toast("Bu form tanımlı değil: " + key, "w");
    if (!p) return H.toast("Hasta bulunamadı.", "e");
    const warnAge = (k) => { const cat = (H.FORMS || []).find(x => x.key === k); if (cat && cat.ages && !cat.ages.includes(p.ageGroup) && !FORMS[k].anyAge) H.toast(`${cat.name} bu yaş grubunda kullanılmıyor; yapı gösteriliyor.`, "w"); };
    warnAge(key);
    const origTask = opt.task || null, drafts = {};
    const F = { key, def, p, d:def.init(p), figs:{}, showMiss:false, missing:[], task:origTask, readOnly:!!(H.state.user && !H.can("forms")) };
    const canPr = () => !!(H.print && H.print.canDoc("form"));
    H.modal({ title:`${def.title}`, wide:true, body:`<div class="nfShell"><nav class="nfNav" data-nfnav aria-label="Formlar"></nav><div class="nf" data-nf></div></div>`,
      actions:`<span class="mute nfLeg" style="font-size:11.5px;margin-right:auto"><span class="req" style="color:var(--crit)">●</span> zorunlu alan</span>
        <button class="btn g" data-nfx="cancel">İptal</button><button class="btn" data-nfx="save"${F.readOnly ? " disabled" : ""}>Taslağı sakla</button>${canPr() ? `<button class="btn" data-nfx="signprint"${F.readOnly ? " disabled" : ""}>${I("print")}${H.t("nf_signprint")}</button>` : ""}<button class="btn p" data-nfx="sign"${F.readOnly ? " disabled" : ""}>${I("ok")}Mühürle</button>`,
      onMount(m) { F.modal = m; m.classList.add("nfDlg"); F.root = m.querySelector("[data-nf]"); const nav = m.querySelector("[data-nfnav]");
        F.modal = F.root;   // kaydırma formun kendi alanında
        bindForm(F); draw(F); nav.innerHTML = navHtml(F);
        nav.addEventListener("click", (e) => {
          if (e.target.closest("[data-nfblank]")) return blankPrint(F.key, p);
          const b = e.target.closest("[data-nfk]"); if (!b || b.dataset.nfk === F.key) return;
          drafts[F.key] = F.d;                                   // yarım kalan form bu pencere açıkken saklanır
          const k = b.dataset.nfk; warnAge(k);
          Object.assign(F, { key:k, def:FORMS[k], d:drafts[k] || FORMS[k].init(p), showMiss:false, missing:[], task:k === key ? origTask : null });
          const tt = m.querySelector(".mh b"); if (tt) tt.textContent = F.def.title;
          F.root.scrollTop = 0; draw(F); nav.innerHTML = navHtml(F);
        });
        m.querySelector(".mf").addEventListener("click", (e) => { const b = e.target.closest("[data-nfx]"); if (!b) return;
          if (b.dataset.nfx === "cancel") return H.closeModal(); saveForm(F, b.dataset.nfx !== "save", b.dataset.nfx === "signprint"); }); } });
    return F;
  };
  H.forms.blank = (key, pid) => { const p = H.pt(pid); if (p) blankPrint(key, p); };

  /* =================================================================================================================
   *  FORMLAR
   * ================================================================================================================= */
  const pc = (s, max = 10) => s == null ? "var(--body-sel)" : max !== 10 ? (s > 3 ? "var(--crit)" : s > 0 ? "var(--mid)" : "var(--ok)") : s === 0 ? "var(--ok)" : s <= 3 ? "var(--low)" : s <= 6 ? "var(--mid)" : "var(--crit)";
  const recsOf = (key, pid) => NS.records.filter(r => r.key === key && r.pid === pid);
  const regionReq = (d) => (d.regions && d.regions.length) || d.diffuse;

  /* ---------------------------------------------- AĞRI ---------------------------------------------- */
  const NIPS = [["yuz", "Yüz ifadesi", [[0, "Rahat", 0], [1, "Yüzünü buruşturuyor", 1]]], ["agl", "Ağlama", [[0, "Ağlamıyor", 0], [1, "Sızlanıyor", 1], [2, "Şiddetli ağlıyor", 2]]],
    ["sol", "Solunum", [[0, "Rahat", 0], [1, "Solunumu değişti", 1]]], ["kol", "Kollar", [[0, "Gevşek / kısıtlı", 0], [1, "Fleksiyon / ekstansiyon", 1]]],
    ["bac", "Bacaklar", [[0, "Gevşek / kısıtlı", 0], [1, "Fleksiyon / ekstansiyon", 1]]], ["uya", "Uyanıklık", [[0, "Uyuyor / sakin uyanık", 0], [1, "Huzursuz", 1]]]];
  const FACES = [[0, "Hiç acımıyor"], [2, "Biraz acıyor"], [4, "Biraz daha fazla"], [6, "Daha fazla"], [8, "Çok acıyor"], [10, "En kötü acı"]];
  const faceSvg = (n) => { const c = (5 - n) / 5 * 5; return `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="20" cy="20" r="17"/><circle cx="14" cy="16" r="1.6" fill="currentColor"/><circle cx="26" cy="16" r="1.6" fill="currentColor"/>${n >= 6 ? `<path d="M11 12l5 2M29 12l-5 2"/>` : ""}<path d="M12 ${27 - c * .3} Q20 ${27 + c} 28 ${27 - c * .3}"/>${n === 10 ? `<path d="M12 20v4M28 20v4" stroke-width="1.6"/>` : ""}</svg>`; };
  const painScore = (d) => { switch (d.scale) { case "Ağrı yok": return 0; case "NRS": return d.nrs ?? null; case "VAS": return N(d.vas); case "Yüz": return d.face ?? null;
    case "DAS": case "PAS": return N(d.man); case "NIPS": { const v = NIPS.map(r => (d.nips || {})[r[0]]); return v.every(x => x != null) ? v.reduce((a, b) => a + b, 0) : null; } } return null; };
  const painMax = (d) => d.scale === "NIPS" ? 7 : 10;
  const painCat = (s) => s == null ? null : s === 0 ? 0 : s <= 3 ? 1 : s <= 6 ? 2 : 3;

  const FORMS = {};
  FORMS.pain = {
    title:"Ağrı değerlendirmesi",
    init:(p) => ({ saat:H.now(), scale:p.ageGroup === "neonate" ? "NIPS" : p.ageGroup === "child" ? "Yüz" : "NRS", regions:[], view:"on", target:"3", nit:[], ifade:[], fak:[], hg:[], ilac:[], loc:acvFrom(p), nips:{}, reas:"Yok" }),
    badges:(d) => { const s = painScore(d), m = painMax(d); return [[s == null ? "—" : f1(s), `${d.scale || "Skor"} /${m}`, pc(s, m)], ...(m === 10 ? [[f1(N(d.target)), "Hedef", "var(--mute)"]] : [])]; },
    req:(d) => { const r = []; if (!d.saat) r.push(["saat", "Değerlendirme saati"]); if (!d.scale) r.push(["scale", "Skala"]);
      if (d.scale && d.scale !== "Ağrı yok") { if (painScore(d) == null) r.push(["score", "Ağrı skoru"]); if (!regionReq(d)) r.push(["region", "Ağrı bölgesi"]); }
      if (!d.loc && d.scale !== "NIPS") r.push(["loc", "Bilinç (LOC)"]); return r; },
    render(d, p, F) {
      const s = painScore(d), mx = painMax(d), none = d.scale === "Ağrı yok";
      const prior = recsOf("pain", p.id).slice(-6);
      const marks = prior.flatMap(r => (r.d.regions || []).map(k => ({ region:k, color:pc(r.d._score), label:r.d._score })));
      const medOpts = [...new Set(H.data.tasks.filter(t => t.pid === p.id && t.kind === "med").map(t => t.label))];
      let scoreBox = "";
      if (d.scale === "NRS") scoreBox = `<div class="nrs" data-f="nrs" data-n>${Array.from({ length:11 }, (_, i) => `<i data-v="${i}" class="${d.nrs === i ? "on" : ""}" style="--c:${pc(i)}">${i}</i>`).join("")}</div>
        <div class="nrsl"><span>0 · Ağrı yok</span><span>1–3 hafif</span><span>4–6 orta</span><span>7–9 şiddetli</span><span>10 · Dayanılmaz ağrı</span></div>`;
      else if (d.scale === "VAS") scoreBox = `<div style="display:flex;align-items:center;gap:12px"><input class="nfRange" type="range" min="0" max="10" step="0.5" data-f="vas" value="${N(d.vas) ?? 0}"><span class="nfOut" data-out="vas">${d.vas != null ? f1(N(d.vas)) : "—"}</span></div>
        <div class="nrsl"><span>Ağrı yok</span><span>Dayanılmaz ağrı</span></div><div class="nfNote">Görsel analog skala (10 cm). Hasta çizgi üzerinde gösterir; hemşire kaydırıcıyı aynı noktaya getirir.</div>`;
      else if (d.scale === "Yüz") scoreBox = `<div class="faces" data-f="face" data-n>${FACES.map(([n, l]) => `<i data-v="${n}" class="${d.face === n ? "on" : ""}">${faceSvg(n)}<b>${n}</b>${l}</i>`).join("")}</div>${SCN("Wong-Baker Yüz Ağrı Ölçeği (0–10)")}`;
      else if (d.scale === "NIPS") scoreBox = NIPS.map(([k, l, o]) => FL(l, OP(d, "nips." + k, o, { num:true }), { req:"score" })).join("") + TOT(s ?? "—", "/ 7", s == null ? "" : pc(s, 7), "", "Yaygın kullanımda 3'ün üzeri ağrı göstergesi sayılır" + ADM("eşik hastanenin protokolünden gelir", "; ")) + `${SCN("NIPS (Yenidoğan Bebek Ağrı Ölçeği)")}`;
      else if (d.scale === "DAS" || d.scale === "PAS") scoreBox = ARC(d.scale === "DAS" ? "DAS (davranışsal ağrı skalası)" : "PAS") + FL("Toplam puan", ST(d, "man", { min:0, max:10, def:0, u:"/ 10 · kağıt formdan" }), { req:"score" });
      const cat = mx === 10 ? painCat(s) : null;
      const alerts = (!none && mx === 10 && s != null && s >= 7 ? `<div class="note" style="color:var(--crit);border-color:var(--crit);background:var(--critSoft)">Şiddetli ağrı kaydedildi. Kaydedince sorumlu hekimin bildirimlerine düşer (uygulama içinde; telefona gitmez). Ağrı yönetimi kararı hekimindir.</div>` : "")
        + (!none && mx === 10 && s != null && N(d.target) != null && s > N(d.target) ? `<div class="note">Skor hedeflenen ağrı düzeyinin (${f1(N(d.target))}) üzerinde. Yeniden değerlendirme planlayın.</div>` : "");
      return `<div class="nfGrid">
        <div class="nfFig">${FIG(F, "pain", { ageGroup:p.ageGroup, view:d.view, selected:d.regions, marks, multi:true, onPick:(k, c) => { d.regions = [...c.selected]; d.diffuse = false; draw(F); }, onView:(v) => { d.view = v; } })}
          ${chips(d.regions)}
          ${CK(d, "diffuse", "Belirsiz bölge / tüm vücut")}
          ${F.showMiss && F.missing.some(m => m[0] === "region") ? `<div class="nfNote" style="color:var(--crit)">Ağrı bölgesini seçin ya da “belirsiz” işaretleyin.</div>` : ""}
          ${prior.length ? `<div class="nfNote">Figürdeki renkli bölgeler bugünkü önceki ağrı kayıtlarıdır (${prior.map(r => r.at + " · " + r.d._score).join(", ")}).</div>` : ""}</div>
        <div class="nfCol">
          ${BOX("Değerlendirme", FL("Saat", TX(d, "saat", "SS:DD", { w:110, mode:"numeric" }), { req:"saat" })
            + FL("Değerlendirme tipi / skala", OP(d, "scale", ["Ağrı yok", "VAS", "NRS", "DAS", "Yüz", "PAS", "NIPS"]), { req:"scale", hint:"Yenidoğanda NIPS, konuşamayan çocukta Yüz ya da davranışsal ölçek." + ADM("skala seçimi hastanenin protokolüne göredir", " ") }))}
          ${none ? `<div class="note i">Ağrı yok olarak kaydedilecek (skor 0).</div>` : BOX(`Ağrı skoru${d.scale ? " · " + d.scale : ""}`, `<div class="${F.showMiss && F.missing.some(m => m[0] === "score") ? "nfMiss" : ""}">${scoreBox || '<div class="mute">Önce skala seçin.</div>'}</div>`, s != null ? `<b style="color:${pc(s, mx)}">${f1(s)} / ${mx}</b>` : "")}
          ${alerts}
          ${mx === 10 ? BOX("Hedeflenen ağrı düzeyi", `<div style="display:flex;align-items:center;gap:12px"><input class="nfRange" type="range" min="0" max="10" step="1" data-f="target" value="${N(d.target) ?? 3}"><span class="nfOut" data-out="target">${f1(N(d.target))}</span></div><div class="nrsl"><span>0</span><span>Hasta ile birlikte belirlenir</span><span>10</span></div>`) : ""}
          ${none ? "" : BOX("Ağrının özellikleri",
            FL("Ağrı bölgesi", d.diffuse ? "Belirsiz bölge / tüm vücut" : (d.regions.length ? d.regions.map(bodyName).map(E).join(", ") : `<span class="mute">Figürden seçin</span>`), { req:"region" })
            + FL("Yayılımı", TX(d, "yayilim", "ör. sırta, sol kola"))
            + FL("Nedeni", TX(d, "neden", "ör. ameliyat yeri, pozisyon"))
            + FL("Niteliği", OP(d, "nit", ["Keskin", "Bastırıcı", "Kolik", "Ezici", "Dolgunluk", "Saplanıcı", "Künt", "Yanıcı", "Stabilize", "Diğer"], { multi:true }) + ((d.nit || []).includes("Diğer") ? `<div style="margin-top:6px">${TX(d, "nitDiger", "Diğer nitelik")}</div>` : ""))
            + FL("İfade tarzı", OP(d, "ifade", ["Sözel", "Yüz ifadesi", "İnleme / ağlama", "Huzursuzluk", "Korunma davranışı", "İfade edemiyor"], { multi:true }))
            + FL("Ritim", OP(d, "ritim", ["Sürekli", "Aralıklı"]))
            + FL("Tip", OP(d, "tip", ["Akut", "Kronik"]))
            + FL("Artıran faktör", OP(d, "fak", ["İstirahat", "Hareket"], { multi:true }))
            + FL("Başlangıç", ST(d, "bas", { min:0, def:0, u:"gün önce" }))
            + FL("Süre", ST(d, "sure", { min:0, def:0, inc:0.5, u:"saat" })))}
          ${none ? "" : BOX("Girişimler",
            FL("Uygulanan ilaçlar", (medOpts.length ? OP(d, "ilac", medOpts, { multi:true }) : "") + `<div style="margin-top:6px">${TX(d, "ilacNot", "Order'daki diğer ilaç (hastane kaydındaki ilaç çizelgesinden)")}</div>`, { hint:"Yalnız order edilmiş ilaç kaydedilir; sistem ilaç ya da doz önermez." })
            + FL("Hemşirelik girişimleri (ilaç dışı)", OP(d, "hg", ["Pozisyon verme", "Soğuk uygulama", "Sıcak uygulama", "Masaj", "Dikkati başka yöne çekme", "Gevşeme / solunum egzersizi", "Ortam düzenleme", ...(p.ageGroup === "neonate" ? ["Kanguru bakımı", "Sarmalama", "Emzirme"] : [])], { multi:true })))}
          ${BOX("Bilinç (LOC)", FL("Bilinç", OP(d, "loc", ACV), { req:d.scale !== "NIPS" ? "loc" : "" }))}
          ${BOX("Yeniden değerlendirme", `<div class="tw"><table class="t"><thead><tr><th>Ağrı düzeyi</th><th>Skor</th><th>Yeniden değerlendirme sıklığı</th></tr></thead><tbody>
              ${[["Ağrı yok", "0"], ["Hafif", "1–3"], ["Orta", "4–6"], ["Şiddetli", "7–10"]].map(([a, b], i) => `<tr class="${cat === i ? "hl" : ""}"><td>${a}</td><td class="n">${b}</td><td class="mute">hastane protokolü</td></tr>`).join("")}</tbody></table></div>
            <div class="tw" style="margin-top:8px"><table class="t"><thead><tr><th>İlaç sonrası (yol)</th><th>Değerlendirme zamanı</th></tr></thead><tbody><tr><td>IV / SC</td><td>15–30 dk sonra</td></tr><tr><td>Oral</td><td>30–60 dk sonra</td></tr></tbody></table></div>
            ${ADMBOX("Sıklık ve ilaç sonrası süreler hastanenin ağrı protokolünden gelir; tablodaki süreler örnektir, hastanenin onayı gerekir.")}
            ${FL("Hatırlatma görevi", OP(d, "reas", ["Yok", "30 dk", "1 saat", "2 saat", "4 saat"]), { hint:"Seçilirse Görevlerim'e “Ağrı yeniden değerlendirme” eklenir." })}`)}
        </div></div>`;
    },
    act(name, el, F) { return true; },
    save(d, p) {
      const s = painScore(d); d._score = s;
      p.flags = p.flags || {}; p.flags.pain = s; p.flags.painScale = d.scale;
      // 30.09 · kontrol §4-2: formun "≥7 sorumlu hekimin bildirimlerine düşer" sözü artık tutuluyor (uygulama içi bildirim).
      if (painMax(d) === 10 && s != null && s >= 7 && H.pushNotif) {
        H.pushNotif({ at:H.now(), to:["hekim"], sev:"high", title:"Şiddetli ağrı kaydedildi", body:`${H.bed(p.bed).no} · ağrı ${f1(s)}/10 · ${H.now()}`, go:["patient", { pid:p.id, tab:"ozet" }], pid:p.id });
        H.log("Şiddetli ağrı · hekime bildirim", `${H.bed(p.bed).no} · ${d.scale} ${f1(s)}/10`);
      }
      const add = { "30 dk":.5, "1 saat":1, "2 saat":2, "4 saat":4 }[d.reas];
      if (add) H.data.tasks.push({ pid:p.id, t:21.7 + add, kind:"form", label:"Ağrı yeniden değerlendirme", form:"pain", state:"plan" });
      return `${d.scale} ${s == null ? "—" : f1(s)}/${painMax(d)}${d.diffuse ? " · tüm vücut" : d.regions.length ? " · " + d.regions.map(bodyName).join(", ") : ""}`;
    },
  };

  /* ---------------------------------------------- YARA ---------------------------------------------- */
  const PUSH_SIZE = [[0, "0 cm²"], [1, "< 0,3"], [2, "0,3–0,6"], [3, "0,7–1,0"], [4, "1,1–2,0"], [5, "2,1–3,0"], [6, "3,1–4,0"], [7, "4,1–8,0"], [8, "8,1–12,0"], [9, "12,1–24,0"], [10, "> 24,0"]];
  const pushSize = (a) => { if (a == null) return null; a = Math.round(a * 10) / 10; return a <= 0 ? 0 : a < 0.3 ? 1 : a <= 0.6 ? 2 : a <= 1.0 ? 3 : a <= 2 ? 4 : a <= 3 ? 5 : a <= 4 ? 6 : a <= 8 ? 7 : a <= 12 ? 8 : a <= 24 ? 9 : 10; };
  const wArea = (d) => { const l = N(d.L), w = N(d.W); return l != null && w != null ? Math.round(l * w * 100) / 100 : null; };
  const wSize = (d) => { const a = wArea(d); return a != null ? pushSize(a) : d.sizeM; };
  const wPush = (d) => { const s = wSize(d); return s != null && d.eksMik != null && d.doku != null ? s + d.eksMik + d.doku : null; };
  FORMS.wound = {
    title:"Basınç yarası / yara değerlendirme ve izlem",
    init:(p) => { const last = recsOf("wound", p.id).slice(-1)[0]; return { view:"arka", regions:[], kabul:false, cevre:[], enf:[], cilt:[], irig:[], debr:[], photo:0, woundId:null, _new:!last }; },
    badges:(d) => { const pu = wPush(d), a = wArea(d); return [[pu ?? "—", "PUSH /17", pu == null ? "var(--mute)" : pu >= 12 ? "var(--crit)" : pu >= 7 ? "var(--high)" : "var(--mid)"], [a == null ? "—" : f1(a), "Alan cm²"], ...(d.evre ? [[d.evre.length > 2 ? "—" : d.evre, d.evre.length > 2 ? d.evre : "Evre", "var(--high)"]] : [])]; },
    req:(d) => { const r = []; if (!regionReq(d) && !d.bolgeDetay) r.push(["region", "Yara bölgesi"]); if (!d.tur) r.push(["tur", "Yara türü"]);
      if (d.tur === "Basınç ülseri" && !d.evre) r.push(["evre", "Evre"]); if (N(d.L) == null || N(d.W) == null) r.push(["size", "Uzunluk ve genişlik"]);
      if (d.doku == null) r.push(["doku", "Doku tipi"]); if (d.eksMik == null) r.push(["eksMik", "Eksüda miktarı"]); return r; },
    render(d, p, F) {
      const recs = recsOf("wound", p.id), wounds = {}; recs.forEach(r => { (wounds[r.d.woundId] = wounds[r.d.woundId] || []).push(r); });
      const wl = Object.entries(wounds);
      const marks = wl.map(([id, rs], i) => ({ region:rs[rs.length - 1].d.regions[0], color:"var(--high)", label:i + 1 }));
      const a = wArea(d), sz = wSize(d), pu = wPush(d);
      const series = d.woundId && wounds[d.woundId] ? wounds[d.woundId].map(r => [r.date, r.d._area, r.d._push]) : [];
      if (a != null && d.woundId) series.push(["şimdi", a, pu]);
      const mxA = Math.max(1, ...series.map(x => x[1] || 0));
      const pushRow = (label, f, opts, auto) => `<tr><td style="white-space:normal">${label}</td><td>${OP(d, f, opts.map(([v, l]) => [v, l, v]), { num:true })}${auto || ""}</td></tr>`;
      return `<div class="nfGrid">
        <div class="nfFig">${FIG(F, "w", { ageGroup:p.ageGroup, view:d.view, selected:d.regions, marks, multi:false, hot:true, onPick:(k, c) => { d.regions = [...c.selected]; draw(F); }, onView:(v) => { d.view = v; } })}
          ${chips(d.regions)}
          ${CK(d, "kabul", "Kabulde bası yarası vardı")}
          ${wl.length ? `<div class="nfNote">Figürdeki numaralar kayıtlı yaralardır.</div>` : ""}</div>
        <div class="nfCol">
          ${wl.length ? BOX("Kayıtlı yaralar", `<div class="opts">${wl.map(([id, rs], i) => { const l = rs[rs.length - 1]; return `<i data-act="loadW" data-id="${id}" class="${d.woundId === id ? "on" : ""}">${i + 1} · ${E(bodyName(l.d.regions[0]))} · ${E(l.d.tur)}${l.d.evre ? " evre " + E(l.d.evre) : ""} · ${rs.length} ölçüm</i>`; }).join("")}<i data-act="newW" class="${!d.woundId ? "on" : ""}">+ Yeni yara</i></div>
              <div class="nfNote">İzlem için kayıtlı yarayı seçin; bölge ve tür önceki kayıttan gelir, yalnız bugünkü ölçüm girilir.</div>`) : ""}
          ${BOX("Yara", FL("Bölge", d.regions.length ? E(d.regions.map(bodyName).join(", ")) : '<span class="mute">Figürden seçin</span>', { req:"region" })
            + FL("Bölge detayı", TX(d, "bolgeDetay", "ör. sakrumun sol kenarı, 2 cm lateral"))
            + FL("Yara türü", OP(d, "tur", ["Basınç ülseri", "Venöz ülser", "Travmatik", "Diyabetik ülser", "Nöropatik ülser", "Arteriyel ülser", "Cerrahi yara", "Yanık", "Diğer"]), { req:"tur" })
            + (d.tur === "Basınç ülseri" ? FL("Evre", OP(d, "evre", [["1", "Evre 1"], ["2", "Evre 2"], ["3", "Evre 3"], ["4", "Evre 4"], ["Derin doku hasarı", "Derin doku hasarı"], ["Sınıflandırılamayan", "Sınıflandırılamayan"]]), { req:"evre", hint:"Evreleme: NPIAP sınıflaması" + ADM("hastanenin onayı gerekir") }) : "")
            + FL("Oluşum tarihi", TX(d, "tarih", "", { type:"date", w:190 }))
            + FL("Oluşum yeri", OP(d, "oy", ["Dış kaynaklı (kabulden önce)", "İç kaynaklı (hastanede)"])))}
          ${BOX("Boyut", `<div class="g3">${[["L", "Uzunluk"], ["W", "Genişlik"], ["D", "Derinlik"]].map(([f, l]) => `<div class="${F.showMiss && f !== "D" && N(d[f]) == null ? "nfMiss" : ""}"><div class="mute" style="font-size:12px;font-weight:600;margin-bottom:4px">${l}${f !== "D" ? ' <span class="req">●</span>' : ""}</div>${ST(d, f, { inc:0.1, min:0, def:1, u:"cm" })}</div>`).join("")}</div>
            <div class="nfTotal">Alan (uzunluk × genişlik) <b>${a == null ? "—" : f1(a)}</b> cm² · PUSH boyut puanı kendiliğinden seçilir.</div>`)}
          ${BOX("Eksüda", FL("Rengi", OP(d, "eksRenk", ["Seröz", "Hemorajik", "Pürülan", "Serohemorajik", "Seropürülan"])))}
          ${BOX("PUSH ölçeği", `<div class="${F.showMiss && (d.doku == null || d.eksMik == null) ? "nfMiss" : ""}"><div class="tw"><table class="t"><tbody>
              <tr><td style="white-space:normal;width:120px">Boyut (cm²)</td><td>${a != null ? `<div class="opts nfSc">${PUSH_SIZE.map(([v, l]) => `<i class="${sz === v ? "on" : ""}" style="cursor:default">${l}<small>${v}</small></i>`).join("")}</div><div class="nfNote">Alandan otomatik: <b>${f1(a)} cm² → ${sz}</b></div>` : OP(d, "sizeM", PUSH_SIZE.map(([v, l]) => [v, l, v]), { num:true })}</td></tr>
              ${pushRow("Eksüda miktarı <span class='req'>●</span>", "eksMik", [[0, "Yok"], [1, "Az"], [2, "Orta"], [3, "Fazla"]])}
              ${pushRow("Doku tipi <span class='req'>●</span>", "doku", [[0, "Kapalı"], [1, "Epitel"], [2, "Granülasyon (kırmızı-pembe)"], [3, "Sarı / slough"], [4, "Siyah / nekrotik"]])}
            </tbody></table></div></div>
            ${TOT(pu ?? "—", "/ 17", pu == null ? "" : pu >= 12 ? "var(--crit)" : pu >= 7 ? "var(--high)" : "var(--mid)", "", `${sz ?? "—"} boyut + ${d.eksMik ?? "—"} eksüda + ${d.doku ?? "—"} doku`)}${SCN("PUSH 3.0 (Pressure Ulcer Scale for Healing)")}`)}
          ${BOX("Yara çevresi ve enfeksiyon", FL("Yara etrafı cilt", OP(d, "cevre", ["Sağlıklı", "Islak", "Ödemli", "Masere", "Kabuklaşma", "Hipergranülasyon", "Frajil", "Kuru", "Eritem", "Bül", "Selülit", "Sütur"], { multi:true }))
            + FL("Enfeksiyon bulguları", OP(d, "enf", ["Yok", "Kızarıklık artışı", "Isı artışı", "Ödem artışı", "Kötü koku", "Pürülan akıntı", "Ağrı artışı", "Ateş"], { multi:true }), { hint:"Bulgu varsa hekime bildirilir; tanı ve tedavi kararı hekimindir." })
            + FL("Yara kültürü", OP(d, "kultur", ["Alınmadı", "Alındı"]) + (d.kultur === "Alındı" ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">${ST(d, "kulturGun", { min:0, def:0, u:"gün önce" })}${OP(d, "kulturSonuc", ["Bekleniyor", "Üreme yok", "Üreme var"])}</div>` : "")))}
          ${BOX("Tedavi planı", FL("Cilt bakımı", OP(d, "cilt", ["Bariyer sprey", "Nemlendirici", "Bariyer krem"], { multi:true }))
            + FL("İrigasyon", OP(d, "irig", ["SF (serum fizyolojik)", "Steril su"], { multi:true }))
            + FL("Debridman", OP(d, "debr", ["Otolitik", "Enzimatik", "Mekanik", "Cerrahi"], { multi:true }))
            + FL("Örtü / not", TX(d, "ortu", "ör. hidrokolloid, 3 günde bir"))
            + `<div class="nfNote">Tedavi planı hekim ya da yara bakım hemşiresinin order'ına göre işlenir.</div>`)}
          ${BOX("Fotoğraf", `<div class="photo"><div class="ph ${d.photo ? "has" : ""}" data-act="photo">${d.photo ? `Fotoğraf ${d.photo}<br>${H.now()}` : I("eye")}</div>
            <div class="nfNote" style="margin:0">Fotoğraf <b>yalnız hasta kaydında</b> saklanır; cihazın galerisine düşmez, paylaşılamaz. ${ADM("Kimlerin göreceği hastanenin kararıdır (KVKK / yerel veri koruma mevzuatı).", "")} ${d.photo ? `<a data-act="photoDel" style="cursor:pointer">Fotoğrafı kaldır</a>` : "Çekmek için kutuya dokunun (simülasyon)."}</div></div>`)}
          ${series.length ? BOX("Önceki ölçümler · alan ve PUSH", `<div class="trend">${series.map(([dt, ar, ps], i) => `<div class="${dt === "şimdi" ? "now" : ""}" style="height:${Math.max(6, (ar || 0) / mxA * 100)}%"><em>${ps ?? "—"}</em><span>${dt}</span></div>`).join("")}</div>
            <div class="nfNote">Sütun yüksekliği alan (cm²), üstteki sayı PUSH toplamı. ${series.length > 1 ? `Alan ${f1(series[0][1])} → ${f1(series[series.length - 1][1])} cm²; PUSH ${series[0][2]} → ${series[series.length - 1][2] ?? "—"}.` : ""} Düşen PUSH iyileşmeyi gösterir.</div>`) : ""}
        </div></div>`;
    },
    act(name, el, F) { const d = F.d;
      if (name === "loadW") { const rs = recsOf("wound", F.p.id).filter(r => r.d.woundId === el.dataset.id), l = rs[rs.length - 1].d;
        Object.assign(d, { woundId:el.dataset.id, regions:[...l.regions], view:l.view || "arka", tur:l.tur, evre:l.evre, oy:l.oy, tarih:l.tarih }); }
      if (name === "newW") Object.assign(d, { woundId:null, regions:[], tur:undefined, evre:undefined });
      if (name === "photo") d.photo = (d.photo || 0) + 1;
      if (name === "photoDel") d.photo = 0;
    },
    save(d, p) { d._area = wArea(d); d._push = wPush(d); if (!d.woundId) d.woundId = "w" + Date.now(); d.date = TODAY;
      return `PUSH ${d._push}/17 · ${f1(d._area)} cm²${d.regions.length ? " · " + bodyName(d.regions[0]) : ""}`; },
  };

  /* ---------------------------------------------- ALDIĞI–ÇIKARDIĞI ---------------------------------------------- */
  const IO_IN = [["IV", "IV sıvı"], ["Oral", "Oral"], ["TPN", "Parenteral beslenme"], ["PCAi", "PCA infüzyon"], ["PCAb", "PCA bolus"], ["PEG", "PEG / PEJ"], ["NGOG", "NG / OG (verilen)"], ["Kan", "Kan ürünleri"], ["PD", "Periton diyaliz (verilen)"], ["Irig", "İrigasyon (verilen)"], ["Diger", "Diğer"]];
  const IO_OUT = [["Idrar", "İdrar", ["Spontan", "Foley"]], ["Dren", "Dren", "dren"], ["Stoma", "Kolostomi / İleostomi", ["Kolostomi", "İleostomi"]], ["Nefro", "Nefrostomi", ["Sağ", "Sol"]], ["Uro", "Ürostomi"], ["Sisto", "Sistostomi"], ["NGOGc", "NG / OG (drenaj)"], ["Gaita", "Gaita"], ["Kusma", "Kusma"], ["Kanama", "Kanama"], ["Hemo", "Hemofiltrat"]];
  const ioSum = (d) => { let i = 0, o = 0; Object.values(d.in || {}).forEach(a => a.forEach(r => i += N(r.miktar) || 0)); Object.values(d.out || {}).forEach(a => a.forEach(r => o += N(r.ml) || 0)); return { i, o, b:i - o }; };
  const sgn = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(Math.round(n));
  // form satırı → sıvı ızgarası satırı (careplan.js IO). Dren numarası kayıtta ayrıca çözülür.
  const IO_MAP = { IV:"iv", Oral:"oral", TPN:"tpn", PCAi:"pcai", PCAb:"pcab", PEG:"peg", NGOG:"ngin", Kan:"blood", PD:"pd", Irig:"irrin", Diger:"inoth",
    Idrar:"uri", Stoma:"outoth", Nefro:"nefro", Uro:"uro", Sisto:"sisto", NGOGc:"ngd", Gaita:"gaita", Kusma:"kusma", Kanama:"kan", Hemo:"outoth" };
  FORMS.io = {
    title:"Aldığı – çıkardığı",
    init:() => ({ in:{}, out:{}, _tpl:"" }),
    badges:(d) => { const s = ioSum(d); return [[Math.round(s.i), "Aldığı ml", "var(--pri)"], [Math.round(s.o), "Çıkardığı ml", "var(--high)"], [sgn(s.b), "Denge ml", s.b < 0 ? "var(--crit)" : "var(--ok)"]]; },
    req:(d) => { const s = ioSum(d); return s.i + s.o > 0 ? [] : [["any", "En az bir miktar (ml)"]]; },
    render(d, p, F) {
      const s = ioSum(d), prev = recsOf("io", p.id), G = H.fluidGrid && H.fluidGrid.summary ? H.fluidGrid.summary(p) : null,   // 30.09: nöbet toplamı tek defterden (sıvı ızgarası)
        pi = G ? G.tin : prev.reduce((a, r) => a + (r.d._in || 0), 0), po = G ? G.tout : prev.reduce((a, r) => a + (r.d._out || 0), 0);
      const grpIn = IO_IN.map(([k, l]) => { const rows = (d.in || {})[k] || [], sum = rows.reduce((a, r) => a + (N(r.miktar) || 0), 0);
        return `<div class="ioG"><header><b>${l}</b>${rows.length ? `<span class="s">${Math.round(sum)} ml</span>` : `<span class="s"></span>`}<button type="button" class="btn sm" data-add="in.${k}">${I("plus")}Ekle</button></header>
          ${rows.map((r, i) => `<div class="ioRow">${TX(d, `in.${k}.${i}.ad`, k === "Kan" ? "Ürün (ör. ES, TDP)" : "Ad / içerik")}${TX(d, `in.${k}.${i}.hacim`, "Hacim ml", { mode:"decimal" })}${TX(d, `in.${k}.${i}.miktar`, "Verilen ml", { mode:"decimal" })}<button type="button" class="nfDel" data-del="in.${k}|${i}" aria-label="Sil">${I("trash")}</button></div>`).join("")}</div>`; }).join("");
      const grpOut = IO_OUT.map(([k, l, sub]) => { const rows = (d.out || {})[k] || [], sum = rows.reduce((a, r) => a + (N(r.ml) || 0), 0);
        const tpl = sub === "dren" ? JSON.stringify({ no:String(Math.min(5, rows.length + 1)) }) : "";
        return `<div class="ioG"><header><b>${l}</b><span class="s">${rows.length ? Math.round(sum) + " ml" : ""}</span><button type="button" class="btn sm" data-add="out.${k}"${tpl ? ` data-tpl='${tpl}'` : ""}${sub === "dren" && rows.length >= 5 ? " disabled" : ""}>${I("plus")}Ekle</button></header>
          ${rows.map((r, i) => `<div class="ioRow o"><div>${sub === "dren" ? `<div style="display:flex;gap:6px"><select data-f="out.${k}.${i}.no" style="width:84px">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${String(r.no) === String(n) ? " selected" : ""}>Dren ${n}</option>`).join("")}</select>${TX(d, `out.${k}.${i}.bolge`, "Bölge (ör. batın sağ)")}</div>` : Array.isArray(sub) ? OP(d, `out.${k}.${i}.tip`, sub) : `<span class="mute" style="font-size:12.5px">${l}</span>`}</div>${TX(d, `out.${k}.${i}.ml`, "ml", { mode:"decimal" })}<button type="button" class="nfDel" data-del="out.${k}|${i}" aria-label="Sil">${I("trash")}</button></div>`).join("")}</div>`; }).join("");
      return `<div class="nfCol">
        <div class="ioSum"><div><small>Aldığı</small><b style="color:var(--pri)">${Math.round(s.i)}</b> ml</div><div><small>Çıkardığı</small><b style="color:var(--high)">${Math.round(s.o)}</b> ml</div><div><small>Denge</small><b style="color:${s.b < 0 ? "var(--crit)" : "var(--ok)"}">${sgn(s.b)}</b> ml</div></div>
        <div class="nfNote" style="margin:0">Nöbet toplamı (08:00'den beri, bu kayıt dahil): aldığı <b>${Math.round(pi + s.i)}</b> ml · çıkardığı <b>${Math.round(po + s.o)}</b> ml · denge <b>${sgn(pi + s.i - po - s.o)}</b> ml${G ? (G.last ? ` · son giriş ${G.last.at}` : "") : prev.length ? ` · ${prev.length} önceki kayıt` : ""}.</div>
        ${BOX("Şablon", `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><select data-f="_tpl" style="max-width:240px"><option value="">Şablon seç…</option>${NS.ioTpl.map((t, i) => `<option value="${i}"${String(d._tpl) === String(i) ? " selected" : ""}>${E(t.name)}</option>`).join("")}</select>
            <button type="button" class="btn sm" data-act="tplApply"${d._tpl === "" || d._tpl == null ? " disabled" : ""}>Uygula</button><span class="mute" style="font-size:12px">ya da</span>
            ${TX(d, "_tplName", "Şablon adı", { w:180 })}<button type="button" class="btn sm" data-act="tplSave">${I("star")}Şablon olarak kaydet</button></div>
            <div class="nfNote">Şablon yalnız satırları (ad, hacim, tür) saklar; miktarlar her kayıtta yeniden girilir.</div>`)}
        <div class="g2" style="align-items:start"><div>${BOX("Aldığı", `<div class="${F.showMiss && F.missing.length ? "nfMiss" : ""}">${grpIn}</div>`, `<b style="color:var(--pri)">${Math.round(s.i)} ml</b>`)}</div>
          <div>${BOX("Çıkardığı", grpOut, `<b style="color:var(--high)">${Math.round(s.o)} ml</b>`)}</div></div>
      </div>`;
    },
    act(name, el, F) { const d = F.d;
      if (name === "tplApply") { const t = NS.ioTpl[+d._tpl]; if (!t) return; const cp = JSON.parse(JSON.stringify(t)); d.in = cp.in || {}; d.out = cp.out || {}; H.toast(`Şablon uygulandı: ${t.name}`); }
      if (name === "tplSave") { const nm = (d._tplName || "").trim(); if (!nm) { H.toast("Şablon için bir ad yazın.", "w"); return false; }
        const strip = (o, keep) => Object.fromEntries(Object.entries(o || {}).filter(([, a]) => a.length).map(([k, a]) => [k, a.map(r => Object.fromEntries(Object.entries(r).filter(([f]) => keep.includes(f))))]));
        NS.ioTpl.push({ name:nm, in:strip(d.in, ["ad", "hacim"]), out:strip(d.out, ["tip", "no", "bolge"]) }); d._tpl = String(NS.ioTpl.length - 1); d._tplName = ""; H.toast(`Şablon kaydedildi: ${nm}`); }
    },
    // 30.09 · kontrol §4-3: kayıt artık sıvı ızgarasına (H.data.ioGrid — tek defter) şu anki saat hücresine yazılır; sekmenin
    // özet kutuları ve grafik aynı defterden hesaplanır. Form satırı → ızgara satırı eşlemesi aşağıda (IO_MAP).
    save(d, p) { const s = ioSum(d); d._in = s.i; d._out = s.o;
      if (H.fluidGrid && H.fluidGrid.add) {
        const note = () => H.t("nf_io_from_form");
        Object.entries(d.in || {}).forEach(([k, a]) => a.forEach(r => H.fluidGrid.add(p, IO_MAP[k] || "inoth", N(r.miktar) || 0, { form:true, note })));
        Object.entries(d.out || {}).forEach(([k, a]) => a.forEach(r => H.fluidGrid.add(p, k === "Dren" ? (String(r.no) === "2" ? "dr2" : String(r.no) === "1" || !r.no ? "dr1" : "outoth") : IO_MAP[k] || "outoth", N(r.ml) || 0, { form:true, note })));
        d._grid = true;
      }
      return `aldığı ${Math.round(s.i)} ml · çıkardığı ${Math.round(s.o)} ml · denge ${sgn(s.b)} ml`; },
  };

  /* ---------------------------------------------- VİTAL BULGULAR ---------------------------------------------- */
  const PEWS_ROWS = [["Davranış", "pews.dav"], ["Kardiyovasküler", "pews.kv"], ["Solunum", "pews.sol"]];
  const vAge = (p) => p.ageGroup;
  const vNews = (d, p) => news2({ rr:d.rr, spo2:d.spo2, o2:d.o2 === "Ek oksijen", sbp:d.sbp, hr:d.hr, acvpu:d.acvpu, temp:d.temp, scale2:!!NS.scale2[p.id] });
  const devVals = (p, jitter) => { const j = (n, a) => jitter ? n + Math.round((Math.random() - .5) * 2 * a) : n;
    return { hr:String(j(p.v.hr, 2)), sbp:String(j(p.v.sbp, 3)), dbp:String(j(p.v.dbp, 2)), spo2:String(Math.min(100, j(p.v.spo2, 1))), temp:String(p.v.temp).replace(".", ",") }; };
  FORMS.vitals = {
    title:"Vital bulgular",
    init:(p) => ({ src:"Elle", tempSite:"Aksiller", spo2Site:p.ageGroup === "neonate" ? "Sağ el (preduktal)" : "Parmak", ritim:"Düzenli", poz:"Yatarak", bpM:"NIBP", o2:p.v.o2 === "Oda havası" ? "Oda havası" : "Ek oksijen", o2Dev:["CPAP", "HFNC", "NIV", "MV"].includes(p.v.o2) ? p.v.o2 : undefined, acvpu:acvFrom(p) }),
    badges:(d, p) => { const out = []; if (vAge(p) === "adult") { const r = vNews(d, p); out.push([r.complete ? r.total : "…", "NEWS2", r.complete ? lvlColor(r.lvl) : "var(--mute)"]); }
      if (vAge(p) === "child") { const v = PEWS_ROWS.map(([, f]) => val(d, f)); out.push([v.every(x => x != null) ? v.reduce((a, b) => a + b, 0) + (d.pewsEk || 0) : "—", "PEWS", "var(--mid)"]); }
      const m = N(d.sbp) != null && N(d.dbp) != null ? Math.round((N(d.sbp) + 2 * N(d.dbp)) / 3) : null; out.push([m ?? "—", "MAP"]); return out; },
    req:(d, p) => { const r = []; [["hr", "Nabız"], ["temp", "Ateş"], ["rr", "Solunum"], ["spo2", "SpO₂"], ["sbp", "Sistolik KB"]].forEach(([f, l]) => { if (N(d[f]) == null) r.push([f, l]); });
      if (vAge(p) === "adult" && !d.acvpu) r.push(["acvpu", "Bilinç (ACVPU)"]); return r; },
    render(d, p, F) {
      const r = vAge(p) === "adult" ? vNews(d, p) : null, s2 = NS.scale2[p.id];
      const lastHint = (f, u) => `<span class="mute" style="font-size:11.5px">son: ${E(String(p.v[f] ?? "—"))} ${u || ""}</span>`;
      const srcBadge = d.srcBadge ? `<span class="nfSrc">${I(d.src === "Monitör" ? "tv" : "tablet")}${E(d.srcBadge)}</span>` : "";
      return `<div class="nfCol">
        ${BOX("Ölçüm kaynağı", `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">${OP(d, "src", ["Elle", "Portatif cihaz", "Monitör"])}${srcBadge}</div>
          ${d.measuring ? `<div class="nfNote">Portatif cihaz P-07'den ölçüm alınıyor…</div><div class="nfBar"><i></i></div>` : ""}
          <div class="nfNote">Cihazdan gelen değerler düzeltilebilir; düzeltilen alan kayıtta “elle düzeltildi” olarak işaretlenir.${ADM("Cihaz bağlantısı cihaz ekibinin işidir.", " ")}</div>`)}
        <div class="g2" style="align-items:start">
          ${BOX("Dolaşım ve solunum",
            FL("Nabız", ST(d, "hr", { min:0, max:300, def:p.v.hr, u:"/dk" }) + lastHint("hr", "/dk"), { req:"hr" })
            + FL("Ritim", OP(d, "ritim", ["Düzenli", "Düzensiz"]))
            + FL("KB sistolik", ST(d, "sbp", { min:0, max:300, def:p.v.sbp, u:"mmHg" }), { req:"sbp" })
            + FL("KB diyastolik", ST(d, "dbp", { min:0, max:200, def:p.v.dbp, u:"mmHg" }) + lastHint("dbp", "mmHg"))
            + FL("KB ölçümü", OP(d, "bpM", ["NIBP", "İnvaziv (arter)"]))
            + FL("Solunum", ST(d, "rr", { min:0, max:120, def:p.v.rr, u:"/dk" }) + lastHint("rr", "/dk"), { req:"rr" })
            + FL("SpO₂", ST(d, "spo2", { min:50, max:100, def:p.v.spo2, u:"%" }), { req:"spo2" })
            + FL("SpO₂ ölçüm yeri", OP(d, "spo2Site", p.ageGroup === "neonate" ? ["Sağ el (preduktal)", "Ayak (postduktal)"] : ["Parmak", "Kulak", "Ayak"])))}
          ${BOX("Isı, bilinç ve destek",
            FL("Ateş", ST(d, "temp", { inc:0.1, min:30, max:43, def:p.v.temp, u:"°C" }) + lastHint("temp", "°C"), { req:"temp" })
            + FL("Ölçüm yeri", OP(d, "tempSite", ["Aksiller", "Timpanik", "Oral", "Rektal", "Temporal"]))
            + FL("Bilinç (ACVPU)", OP(d, "acvpu", ACV), { req:vAge(p) === "adult" ? "acvpu" : "" })
            + FL("O₂ desteği", OP(d, "o2", ["Oda havası", "Ek oksijen"]) + (d.o2 === "Ek oksijen" ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${OP(d, "o2Dev", ["Nazal kanül", "Maske", "Rezervuarlı maske", "HFNC", "CPAP", "NIV", "MV"])}${ST(d, "o2Flow", { inc:0.5, min:0, max:60, def:2, u:"L/dk" })}</div>` : ""))
            + FL("Vücut pozisyonu", OP(d, "poz", ["Yatarak", "Yarı oturur", "Oturarak", "Ayakta"]))
            + FL("Ağrı", ST(d, "agri", { min:0, max:10, def:0, u:"/ 10" }), { hint:"Ayrıntılı değerlendirme için Ağrı formu." }))}
        </div>
        ${r ? BOX("Erken uyarı · NEWS2 (18 yaş ve üzeri)", `${TOT(r.complete ? r.total : "…", "", r.complete ? lvlColor(r.lvl) : "", "",r.complete ? (r.any3 && r.total < 5 ? "Tek parametrede 3 puan" : "") : "Tüm parametreler girilince hesaplanır", "margin:0 0 8px")}
            ${n2Table(r, !!s2)}
            <div class="nfNote">SpO₂ ölçeği: ${s2 ? `<b>Ölçek 2</b> (hiperkapnik solunum yetmezliği) · ${E(s2)} tarafından seçildi.` : "<b>Ölçek 1</b>. Ölçek 2'yi (ör. KOAH, hiperkapni riski) yalnız hekim seçer."}</div>
            ${n2Resp(r)}`) : ""}
        ${vAge(p) === "child" ? BOX("Erken uyarı · PEWS (çocuk)", ARC("PEWS") + PEWS_ROWS.map(([l, f]) => FL(l, OP(d, f, [[0, "0"], [1, "1"], [2, "2"], [3, "3"]], { num:true }))).join("") + ADMBOX("Madde tanımları ve ek puanlar (ör. nebül, kusma) hastanenin PEWS formundan eklenecek.")) : ""}
        ${vAge(p) === "neonate" ? `<div class="note i">Yenidoğanda NEWS2 kullanılmaz.${ADM("Yenidoğan erken uyarı ölçeği hastanenin protokolüne göre eklenecek (puan tablosu arşive alınacak).", " ")}</div>` : ""}
      </div>`;
    },
    after(d, f, F) {
      if (["hr", "sbp", "dbp", "spo2", "temp"].includes(f) && d._dev && d._dev[f] != null && d._dev[f] !== d[f]) (d._edited = d._edited || {})[f] = true;
      if (f !== "src") return;
      const p = F.p;
      if (d.src === "Portatif cihaz") { d.measuring = true; d.srcBadge = ""; setTimeout(() => { if (!F.root.isConnected || d.src !== "Portatif cihaz") return; const v = devVals(p, true); Object.assign(d, v); d._dev = v; d._edited = {}; d.measuring = false; d.srcBadge = "Portatif cihaz P-07 · 21:44"; draw(F); H.toast("Portatif cihazdan değerler alındı. Solunum ve bilinci siz girin."); }, 1500); }
      else if (d.src === "Monitör") { d.measuring = false; if (!p.monitored) { d.src = "Elle"; d.srcBadge = ""; H.toast("Bu yatakta monitör bağlı değil. Elle girin ya da portatif cihaz kullanın.", "w"); return; }
        const v = devVals(p, false); v.rr = String(p.v.rr); Object.assign(d, v); d._dev = v; d._edited = {}; d.srcBadge = `Monitör · canlı · ${H.now()}`; }
      else { d.measuring = false; d.srcBadge = ""; d._dev = null; }
    },
    save(d, p) {
      const n = (f) => N(d[f]); const v = p.v;
      Object.assign(v, { hr:n("hr"), sbp:n("sbp"), dbp:n("dbp") ?? v.dbp, spo2:n("spo2"), rr:n("rr"), temp:n("temp") });
      v.map = Math.round((v.sbp + 2 * v.dbp) / 3);
      v.o2 = d.o2 === "Ek oksijen" ? (["CPAP", "HFNC", "NIV", "MV"].includes(d.o2Dev) ? d.o2Dev : "Ek oksijen") : "Oda havası";
      if (d.acvpu) v.loc = ACV_TXT[d.acvpu];
      let sum = `Nb ${v.hr} · KB ${v.sbp}/${v.dbp} · SpO₂ ${v.spo2} · SS ${v.rr} · ${f1(v.temp)}°C`;
      if (vAge(p) === "adult") { const r = vNews(d, p); if (r.complete) { p.news2 = r.total; sum += ` · NEWS2 ${r.total}` + applyNews2Risk(p, r); } }
      if (vAge(p) === "child") { const a = PEWS_ROWS.map(([, f]) => val(d, f)); if (a.every(x => x != null)) { p.pews = a.reduce((x, y) => x + y, 0); sum += ` · PEWS ${p.pews}`; } }
      d.source = d.srcBadge || "Elle";
      return sum;
    },
  };

  /* ---------------------------------------------- KAN ŞEKERİ ---------------------------------------------- */
  const INS_SITES = ["ust_kol_sag", "ust_kol_sol", "uyluk_sag", "uyluk_sol", "gobek"];
  const INS_NAMES = { ust_kol_sag:"Sağ deltoid", ust_kol_sol:"Sol deltoid", uyluk_sag:"Sağ femur (uyluk)", uyluk_sol:"Sol femur (uyluk)", gobek:"Umblikal (göbek çevresi)" };
  FORMS.glucose = {
    title:"Kan şekeri ve diyabet takip",
    init:() => ({ olcum:"Glukometre", ins:[], act:0, komp:"Yok", kompT:[], oad:"Order yok" }),
    badges:(d) => { const v = N(d.ks); return [[v ?? "—", "KŞ mg/dL", v != null && v < 70 ? "var(--crit)" : "var(--ink)"], [(d.ins || []).reduce((a, r) => a + (N(r.doz) || 0), 0) || "—", "İnsülin IU"]]; },
    req:(d) => { const r = []; if (N(d.ks) == null) r.push(["ks", "Kan şekeri"]); if (!d.zaman) r.push(["zaman", "Açlık / tokluk"]);
      (d.ins || []).forEach((x, i) => { if (!x.ad || N(x.doz) == null || !x.yol || (x.yol === "SC" && !x.bolge)) r.push(["ins" + i, `İnsülin ${i + 1} (ad, doz, yol, bölge)`]); }); return r; },
    render(d, p, F) {
      const v = N(d.ks), ins = d.ins || [], a = Math.min(d.act || 0, Math.max(0, ins.length - 1));
      const marks = ins.map((x, i) => x.bolge && i !== a ? { region:x.bolge, color:"var(--pri)", label:i + 1 } : null).filter(Boolean);
      const sel = ins[a] && ins[a].bolge ? [ins[a].bolge] : [];
      const diet = (p.chronic || []).includes("Diabetes mellitus") ? "Diyabetik diyet · 1800 kcal (örnek)" : "Normal diyet (örnek)";
      return `<div class="nfGrid">
        <div class="nfFig">${FIG(F, "g", { ageGroup:p.ageGroup, view:"on", toggle:false, selected:sel, marks, multi:false, only:INS_SITES, names:INS_NAMES,
            onPick:(k) => { if (!d.ins || !d.ins.length) d.ins = [{ yol:"SC" }]; const i = Math.min(d.act || 0, d.ins.length - 1); d.ins[i].bolge = k; draw(F); } })}
          <div class="nfNote">Enjeksiyon bölgesi: ${ins.length ? `aktif satır <b>İnsülin ${a + 1}</b> için figürde dokunun.` : "önce insülin satırı ekleyin ya da figüre dokunun."} Yalnız insülin bölgeleri (deltoid, femur, umblikal) seçilebilir.</div></div>
        <div class="nfCol">
          ${BOX("Ölçüm", FL("Kan şekeri", ST(d, "ks", { min:10, max:800, def:120, inc:1, u:"mg/dL" }), { req:"ks" })
            + FL("Zaman", OP(d, "zaman", ["Açlık", "Tokluk", "Rastgele"]), { req:"zaman" })
            + FL("Ölçüm", OP(d, "olcum", ["Glukometre", "Laboratuvar", "Kan gazı"]))
            + FL("Not", TX(d, "not", "ör. yemekten 2 saat sonra")))}
          ${v != null && v < 70 ? `<div class="note" style="color:var(--crit);border-color:var(--crit);background:var(--critSoft)">Hipoglisemi aralığında (&lt;70 mg/dL). Hastanenin hipoglisemi protokolü uygulanır ve hekime bildirilir. Karar hekimindir.</div>` : ""}
          ${BOX("İnsülin", ins.map((x, i) => `<div class="box" style="margin-bottom:8px;background:var(--card2);${i === a ? "border-color:var(--pri)" : ""}">
              <h5>İnsülin ${i + 1}${i === a ? ' <span class="pill" style="color:var(--pri)">figürde aktif</span>' : ` <button type="button" class="btn sm g" data-act="insAct" data-i="${i}">Figürde bu satırı seç</button>`}<span class="r"><button type="button" class="nfDel" data-del="ins|${i}" aria-label="Sil">${I("trash")}</button></span></h5>
              ${FL("Ad", TX(d, `ins.${i}.ad`, "İnsülin adı (order'daki)", { list:"nfInsList" }), { req:"ins" + i })}
              ${FL("Doz", ST(d, `ins.${i}.doz`, { min:0, max:200, def:0, u:"IU" }))}
              ${FL("Yol", OP(d, `ins.${i}.yol`, ["SC", "IV"]))}
              ${x.yol !== "IV" ? FL("Uygulama bölgesi", OP(d, `ins.${i}.bolge`, INS_SITES.map(k => [k, INS_NAMES[k]]))) : ""}</div>`).join("")
            + `<button type="button" class="btn" data-add="ins" data-tpl='{"yol":"SC"}'>${I("plus")}İnsülin satırı ekle</button>
            <datalist id="nfInsList"><option value="İnsülin aspart (hızlı etkili)"><option value="İnsülin lispro (hızlı etkili)"><option value="Regüler insülin (kısa etkili)"><option value="NPH insülin (orta etkili)"><option value="İnsülin glarjin (uzun etkili)"><option value="İnsülin detemir (uzun etkili)"></datalist>
            <div class="nfNote">Doz hekim order'ından girilir; sistem doz önermez.</div>`)}
          ${BOX("Enjeksiyon ve oral tedavi", FL("Enjeksiyona bağlı komplikasyon", OP(d, "komp", ["Yok", "Var"]) + (d.komp === "Var" ? `<div style="margin-top:8px">${OP(d, "kompT", ["Lipohipertrofi", "Morarma", "Kızarıklık", "Ağrı", "Sızıntı"], { multi:true })}</div>` : ""))
            + FL("Oral antidiyabetik", OP(d, "oad", ["Order yok", "Aldı", "Almadı"]) + (d.oad === "Almadı" ? `<div style="margin-top:6px">${TX(d, "oadNeden", "Neden (ör. NPO)")}</div>` : "")))}
          ${BOX("Diyet", `<div class="kv"><span>Diyet order'ı</span><b style="font-family:Figtree">${diet}</b></div><div class="nfNote">Salt okunur · hastane kaydından gelir.</div>`)}
        </div></div>`;
    },
    act(name, el, F) { if (name === "insAct") F.d.act = +el.dataset.i; },
    after(d, f) { const m = /^ins\.(\d+)\./.exec(f); if (m) d.act = +m[1]; if (f === "ins") d.act = Math.max(0, (d.ins || []).length - 1); },
    save(d, p) { p.lastGlucose = N(d.ks); return `KŞ ${N(d.ks)} mg/dL · ${d.zaman}${(d.ins || []).length ? ` · ${(d.ins || []).length} insülin kaydı` : ""}`; },
  };

  /* ---------------------------------------------- FAALİYET / OLAY / BAKIM ---------------------------------------------- */
  const ACT = [
    ["24/48/72 saatlik ritim Holter", "F", null, 0, { opt:["24 saat", "48 saat", "72 saat"] }], ["Arter kateteri", "F", ["Tak", "Çıkar"], 1], ["CPR", "F"], ["CVP", "F", ["Tak", "Çıkar"], 1], ["Damar yolu", "F", ["Aç", "Sonlandır"], 1],
    ["Diyaliz kateteri", "F", ["Tak", "Çıkar"], 1], ["Dren", "F", ["Tak", "Çıkar"], 1], ["EKG", "F"], ["Ekstübe edildi", "F", null, 0, { ends:"Entübasyon" }], ["Entübe edildi", "F", null, 0, { starts:"Entübasyon" }],
    ["Enteral beslenme", "F", ["Başlat", "Sonlandır"]], ["İnfüzyon takibi", "F"], ["Kolostomi", "F", ["Aç", "Kapat"], 1], ["Lavman", "F"], ["Lomber ponksiyon", "F"], ["Mesane irigasyonu", "F"],
    ["Mesane sonda", "F", ["Aç", "Kapat"]], ["Mide yıkaması", "F"], ["Nazotrakeal aspirasyon", "F"], ["NG sonda", "F", ["Aç", "Kapat"]], ["Pace maker takıldı", "F", null, 1, { starts:"Pace maker" }],
    ["PEG açıldı", "F", null, 1, { starts:"PEG" }], ["Pleurocan", "F", ["Tak", "Çıkar"], 1], ["Rektal tüp", "F", ["Tak", "Çıkar"]], ["Sıvı sistemi", "F", ["Tak", "Çıkar"]], ["Soğuk uygulama", "F", null, 1],
    ["Tansiyon Holter", "F"], ["Toraks tüpü", "F", ["Tak", "Çıkar"], 1], ["Trakeostomi", "F", ["Aç", "Kapat"]], ["VAC", "F", ["Tak", "Çıkar"], 1],
    ["Defekasyon", "O"], ["Düştü", "O", null, 1, { alert:1 }], ["GİS kanama", "O"], ["İshal", "O"], ["Konvülsiyon", "O", null, 0, { alert:1 }], ["Kustu", "O"],
    ["Ağız bakımı", "B"], ["Arter bakımı", "B"], ["Beden bakımı", "B"], ["Dekübit bakımı", "B", null, 1], ["Dren bakımı", "B"], ["Göz bakımı", "B"], ["İntübasyon bakımı", "B"], ["Kolostomi bakımı", "B"],
    ["Mekanik ventilasyon izlemi", "B"], ["Nörolojik izlem", "B"], ["Oksijen tedavisi izlemi", "B"], ["Pozisyon verme", "B", null, 0, { opt:["Sağ yan", "Sol yan", "Sırt üstü", "Yarı oturur (30°)", "Yüz üstü"] }], ["Trakeostomi bakımı", "B"],
    ["Kateter flush", "B"], ["Periferik kateter bakımı", "B"], ["Santral kateter bakımı", "B"], ["NG sonda bakımı", "B"], ["Perine bakımı", "B"], ["Saç bakımı", "B"], ["Tırnak bakımı", "B"],
  ].map(([n, g, pair, body, x], i) => Object.assign({ i, n, g, pair:pair || null, body:!!body }, x || {}));
  const ACT_TABS = [["F", "Faaliyetler"], ["O", "Olaylar"], ["B", "Bakımlar"], ["*", "Favoriler"]];
  const isStart = (it, action) => it.starts || (it.pair && action === it.pair[0]);
  const ongoingOf = (pid) => NS.ongoing.filter(o => o.pid === pid);
  FORMS.activity = {
    title:"Faaliyet / olay / bakım", noTask:true, anyAge:true,
    init:() => ({ tab:"F", q:"", sel:null, entries:[], ev:{}, ends:[] }),
    badges:(d, p) => [[ongoingOf(p.id).length, "Devam eden", "var(--attInk)"], [d.entries.length, "Bu kayıtta", "var(--pri)"]],
    req:(d) => d.entries.length ? [] : [["entries", "En az bir işlem (listeye ekleyin)"]],
    render(d, p, F) {
      const og = ongoingOf(p.id);
      const q = (d.q || "").toLocaleLowerCase("tr");
      const list = ACT.filter(it => (d.tab === "*" ? NS.favs.has(it.n) : it.g === d.tab) && (!q || it.n.toLocaleLowerCase("tr").includes(q)));
      const cnt = (g) => g === "*" ? ACT.filter(it => NS.favs.has(it.n)).length : ACT.filter(it => it.g === g).length;
      let detail = "";
      if (d.sel != null) { const it = ACT[d.sel], ev = d.ev, action = it.pair ? ev.action : null, start = isStart(it, action);
        detail = BOX(`${E(it.n)}${it.g === "O" ? " · olay" : it.g === "B" ? " · bakım" : ""}`, `<div class="nfGrid" style="grid-template-columns:${it.body && (start || it.g !== "F") ? "minmax(200px,260px) minmax(0,1fr)" : "1fr"}">
          ${it.body && (start || it.g !== "F") ? `<div>${FIG(F, "a", { ageGroup:p.ageGroup, view:ev.view || "on", selected:ev.region ? [ev.region] : [], marks:og.filter(o => o.region).map(o => ({ region:o.region, color:"var(--attInk)", label:o.day + "g" })), multi:false, onPick:(k, c) => { ev.region = c.selected[0] || null; draw(F); }, onView:(v) => { ev.view = v; } })}</div>` : ""}
          <div>
            ${FL("Saat", TX(d, "ev.saat", "SS:DD", { w:110 }))}
            ${it.pair ? FL("İşlem", OP(d, "ev.action", it.pair)) : ""}
            ${it.opt ? FL(it.n === "Pozisyon verme" ? "Pozisyon" : "Süre", OP(d, "ev.opt", it.opt)) : ""}
            ${it.body && (start || it.g !== "F") ? FL("Yer", ev.region ? E(bodyName(ev.region)) : '<span class="mute">Figürden seçin (isteğe bağlı)</span>') : ""}
            ${it.pair && action === it.pair[1] ? FL("Sonlandırılan", og.filter(o => o.name === it.n).length ? OP(d, "ev.endIdx", og.map((o, i) => [String(NS.ongoing.indexOf(o)), `${o.name}${o.region ? " · " + bodyName(o.region) : ""} · ${o.day}. gün`]).filter((x, i) => og[i].name === it.n)) : '<span class="mute">Devam eden kayıt yok</span>') : ""}
            ${it.alert ? `<div class="note" style="color:var(--crit);border-color:var(--crit);background:var(--critSoft);margin-bottom:10px">${I("bell").replace("<svg ", '<svg style="width:14px;height:14px;vertical-align:-2px" ')} Kaydedince sorumlu hekimin bildirimlerine düşer (uygulama içinde; telefona gitmez).</div>
              ${it.n === "Düştü" ? FL("Nerede", OP(d, "ev.yer", ["Yataktan", "Ayakta / yürürken", "Banyo / tuvalet", "Sandalyeden"])) + FL("Yaralanma", OP(d, "ev.yar", ["Yok", "Var"])) + FL("Tanık", OP(d, "ev.tanik", ["Var", "Yok"])) : ""}
              ${it.n === "Konvülsiyon" ? FL("Süre", ST(d, "ev.sure", { min:0, def:1, u:"dk" })) + FL("Tip", OP(d, "ev.tip", ["Jeneralize", "Fokal", "Belirsiz"])) + FL("Sonrası bilinç", OP(d, "ev.bil", ACV)) : ""}` : ""}
            ${FL("Not", TX(d, "ev.not", "Kısa not"))}
            <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn p" data-act="addEntry">${I("plus")}Listeye ekle</button><button type="button" class="btn g" data-act="cancelSel">Vazgeç</button></div>
          </div></div>`); }
      return `<div class="nfCol">
        ${BOX(`Devam eden faaliyetler <span class="pill">${og.length}</span>`, og.length ? `<div class="ongo">${og.map(o => { const ix = NS.ongoing.indexOf(o), ending = d.ends.includes(ix);
            return `<div class="${ending ? "end" : ""}"><b>${E(o.name)}</b><small>${o.region ? E(bodyName(o.region)) : ""}</small><span class="d">${o.day}. gün</span>${ending ? `<button type="button" class="btn sm g" data-act="undoEnd" data-ix="${ix}">Geri al</button>` : `<button type="button" class="btn sm" data-act="end" data-ix="${ix}">Sonlandır</button>`}</div>`; }).join("")}</div>` : '<div class="mute" style="font-size:13px">Devam eden faaliyet yok.</div>')}
        ${d.entries.length || d.ends.length ? BOX("Bu kayıtta", `<div class="ongo">${d.entries.map((e, i) => `<div><b>${E(e.label)}</b><small>${E(e.saat)}${e.region ? " · " + E(bodyName(e.region)) : ""}${e.extra ? " · " + E(e.extra) : ""}</small><span class="d"></span><button type="button" class="nfDel" data-del="entries|${i}" aria-label="Sil">${I("trash")}</button></div>`).join("")}</div>`, `${d.entries.length} işlem`) : ""}
        ${F.showMiss && F.missing.length ? `<div class="note">Kaydetmeden önce bir işlem seçip “Listeye ekle”ye basın.</div>` : ""}
        ${detail || `<div>
          <div class="tabs" style="margin-top:0">${ACT_TABS.map(([k, l]) => `<span data-act="tab" data-t="${k}" class="${d.tab === k ? "on" : ""}">${k === "*" ? I("star").replace("<svg ", '<svg style="width:13px;height:13px" ') : ""}${l} <em style="background:var(--card2);color:var(--mute)">${cnt(k)}</em></span>`).join("")}</div>
          <div class="acTop"><div class="search" style="margin:0;max-width:320px;flex:1;display:flex">${I("search")}<input data-f="q" value="${E(d.q || "")}" placeholder="Ara: ör. dren, pozisyon"></div></div>
          <div class="acGrid">${list.map(it => `<div class="acT${it.alert ? " alert" : ""}" data-act="pick" data-i="${it.i}"><button type="button" class="${NS.favs.has(it.n) ? "fav" : ""}" data-act="fav" data-i="${it.i}" aria-label="Favori">${I("star")}</button><span>${E(it.n)}${it.pair ? `<br><small class="mute">${it.pair.join(" / ")}</small>` : ""}</span><button type="button" class="add" data-act="pick" data-i="${it.i}" aria-label="Kaydet">${I("plus")}</button></div>`).join("") || '<div class="empty" style="grid-column:1/-1">Eşleşen kayıt yok.</div>'}</div></div>`}
      </div>`;
    },
    act(name, el, F) { const d = F.d;
      if (name === "tab") { d.tab = el.dataset.t; }
      if (name === "fav") { const n = ACT[+el.dataset.i].n; NS.favs.has(n) ? NS.favs.delete(n) : NS.favs.add(n); }
      if (name === "pick") { const it = ACT[+el.dataset.i]; d.sel = it.i; d.ev = { saat:H.now(), action:it.pair ? it.pair[0] : null, view:"on" }; }
      if (name === "cancelSel") { d.sel = null; }
      if (name === "end") { const ix = +el.dataset.ix; if (!d.ends.includes(ix)) d.ends.push(ix); const o = NS.ongoing[ix]; d.entries.push({ label:`${o.name} · sonlandırıldı`, saat:H.now(), region:o.region, endIx:ix, n:o.name }); }
      if (name === "undoEnd") { const ix = +el.dataset.ix; d.ends = d.ends.filter(x => x !== ix); d.entries = d.entries.filter(e => e.endIx !== ix); }
      if (name === "addEntry") { const it = ACT[d.sel], ev = d.ev;
        if (it.pair && !ev.action) { H.toast("İşlemi seçin (" + it.pair.join(" / ") + ").", "w"); return false; }
        const extra = [ev.opt, ev.yer, ev.yar ? "yaralanma " + ev.yar.toLowerCase() : "", ev.tip, ev.sure ? ev.sure + " dk" : "", ev.not].filter(Boolean).join(" · ");
        const e = { label:it.pair ? `${it.n} · ${ev.action}` : it.n, n:it.n, g:it.g, saat:ev.saat || H.now(), region:ev.region || null, extra, alert:!!it.alert };
        if (isStart(it, ev.action)) e.starts = it.starts || it.n;
        if (it.ends) e.endsName = it.ends;
        if (it.pair && ev.action === it.pair[1] && ev.endIdx != null) { e.endIx = +ev.endIdx; if (!d.ends.includes(e.endIx)) d.ends.push(e.endIx); }
        d.entries.push(e); d.sel = null; d.ev = {}; }
    },
    save(d, p) {
      const endIx = new Set(d.ends); d.entries.forEach(e => { if (e.endsName) { const o = NS.ongoing.find(x => x.pid === p.id && x.name === e.endsName); if (o) endIx.add(NS.ongoing.indexOf(o)); } });
      NS.ongoing = NS.ongoing.filter((o, i) => !endIx.has(i));
      d.entries.forEach(e => {
        if (e.starts) NS.ongoing.push({ pid:p.id, name:e.starts, region:e.region, day:1 });
        if (e.n === "Pozisyon verme") doneTask(p.id, t => t.kind === "care" && /Pozisyon/i.test(t.label));
        if (e.alert) { if (H.pushNotif) H.pushNotif({ at:H.now(), to:["hekim"], sev:"high", title:"Hemşire olay bildirimi", body:H.bed(p.bed).no + " · " + e.n, go:["patient", { pid:p.id, tab:"ozet" }], pid:p.id }); const al = H.data.alarms || []; al.unshift({ id:Date.now() + Math.random(), pid:p.id, txt:`Olay: ${e.n} · ${e.saat} · hemşire bildirimi`, sev:"high", ageMin:0, step:0, state:"open" }); H.log("olay:" + e.n, p.id); }
      });
      return d.entries.map(e => e.label).join(", ");
    },
  };

  /* ---------------------------------------------- DÜŞME RİSKİ ---------------------------------------------- */
  const MORSE = [["m1", "Düşme öyküsü (son 3 ay)", [[0, "Hayır"], [25, "Evet"]]], ["m2", "İkincil tanı", [[0, "Hayır"], [15, "Evet"]]],
    ["m3", "Yürümeye yardımcı", [[0, "Yok · yatak istirahati · hemşire yardımı"], [15, "Koltuk değneği · baston · yürüteç"], [30, "Mobilyaya tutunarak"]]],
    ["m4", "IV tedavi / heparin kilidi", [[0, "Hayır"], [20, "Evet"]]], ["m5", "Yürüyüş", [[0, "Normal · yatak istirahati · tekerlekli sandalye"], [10, "Zayıf"], [20, "Bozuk"]]],
    ["m6", "Mental durum", [[0, "Kendi kapasitesinin farkında"], [15, "Kapasitesini abartıyor / unutuyor"]]]];
  const HUMPTY = [["Yaş", ["3 yaş altı", "3–7 yaş", "7–13 yaş", "13 yaş ve üzeri"]], ["Cinsiyet", ["Erkek", "Kız"]], ["Tanı", ["Nörolojik tanı", "Oksijenasyonda değişiklik", "Psikiyatrik / davranış bozukluğu", "Diğer"]],
    ["Bilişsel durum", ["Kısıtlılığının farkında değil", "Kısıtlılığını unutuyor", "Yeteneklerinin farkında"]], ["Çevresel faktörler", ["Düşme öyküsü / yatakta bebek", "Yardımcı araç kullanıyor", "Yatakta", "Ayaktan hasta alanı"]],
    ["Cerrahi / sedasyon / anestezi", ["24 saat içinde", "48 saat içinde", "48 saatten önce / yok"]], ["İlaç kullanımı", ["Birden fazla riskli ilaç", "Riskli ilaçlardan biri", "Diğer / yok"]]];
  const morseTot = (d) => { const v = MORSE.map(([k]) => d[k]); return v.every(x => x != null) ? v.reduce((a, b) => a + b, 0) : null; };
  const morseBand = (t) => t == null ? null : t >= 45 ? ["yüksek", "var(--crit)"] : t >= 25 ? ["orta", "var(--high)"] : ["düşük", "var(--ok)"];
  FORMS.fall = {
    title:"Düşme riski",
    init:(p) => ({ scale:p.ageGroup === "child" ? "Humpty Dumpty" : "Morse", hd:{} }),
    badges:(d) => { if (d.scale === "Morse") { const t = morseTot(d), b = morseBand(t); return [[t ?? "—", "Morse", b ? b[1] : "var(--mute)"], ...(b ? [[b[0], "Risk", b[1]]] : [])]; } return [[N(d.man) ?? "—", d.scale]]; },
    req:(d) => d.scale === "Morse" ? MORSE.filter(([k]) => d[k] == null).map(([k, l]) => [k, l]) : (N(d.man) == null ? [["man", "Toplam puan (kağıt formdan)"]] : []),
    render(d, p) {
      if (p.ageGroup === "neonate") return `<div class="note i">Yenidoğan için düşme riski formu kullanılmıyor.${ADM("Katalog: erişkin ve çocuk. Hastanenin protokolü farklıysa eklenecek.", " ")}</div>`;
      const t = morseTot(d), b = morseBand(t);
      if (p.ageGroup === "child") return `<div class="nfCol">${BOX("Humpty Dumpty Düşme Riski Ölçeği (çocuk)", ARC("Humpty Dumpty") + HUMPTY.map(([l, o], i) => FL(l, OP(d, "hd.h" + i, o))).join("")
        + FL("Toplam puan", ST(d, "man", { min:0, max:30, def:7, u:"kağıt formdan" }), { req:"man" }) + ADMBOX("Risk eşiği hastanenin onaylı formundan gelir."))}</div>`;
      return `<div class="nfCol">
        ${BOX("Ölçek", OP(d, "scale", ["Morse", "İTAKİ"]) + ADMBOX("Erişkinde hangi ölçeğin kullanılacağı hastanenin kararıdır."))}
        ${d.scale === "Morse" ? BOX("Morse Düşme Ölçeği", MORSE.map(([k, l, o]) => FL(l, OP(d, k, o.map(([v, t2]) => [v, t2, v]), { num:true }), { req:k })).join("")
            + TOT(t ?? "—", "/ 125", b ? b[1] : "", b ? b[0] + " risk" : "")
            + `<div class="nfNote">Risk sınıfı yaygın kullanımla: 0–24 düşük · 25–44 orta · 45 ve üzeri yüksek.${ADM("Eşikler ve önlem paketi hastanenin protokolünden gelir.", " ")}</div>${SCN("Morse Düşme Ölçeği")}`)
          : BOX("İTAKİ Düşme Riski Ölçeği", ARC("İTAKİ") + FL("Toplam puan", ST(d, "man", { min:0, max:60, def:0, u:"kağıt formdan" }), { req:"man" }))}
        ${b && b[0] === "yüksek" ? `<div class="note">Yüksek düşme riski: yatak kenarları, çağrı zili, kaymaz çorap gibi önlemler hastanenin düşme önleme protokolüne göre uygulanır.</div>` : ""}</div>`;
    },
    save(d, p) { p.flags = p.flags || {};
      if (d.scale === "Morse") { const t = morseTot(d); p.flags.fall = morseBand(t)[0]; return `Morse ${t} · ${p.flags.fall} risk`; }
      return `${d.scale} ${N(d.man)}`; },
  };

  /* ---------------------------------------------- BASI YARASI RİSKİ ---------------------------------------------- */
  const BRADEN = [["b1", "Duyusal algılama", ["Tamamen kısıtlı", "Çok kısıtlı", "Hafif kısıtlı", "Kısıtlılık yok"]], ["b2", "Nem", ["Sürekli nemli", "Çok nemli", "Ara sıra nemli", "Nadiren nemli"]],
    ["b3", "Aktivite", ["Yatağa bağımlı", "Sandalyeye bağımlı", "Ara sıra yürüyor", "Sık yürüyor"]], ["b4", "Hareket", ["Tamamen hareketsiz", "Çok kısıtlı", "Hafif kısıtlı", "Kısıtlılık yok"]],
    ["b5", "Beslenme", ["Çok yetersiz", "Muhtemelen yetersiz", "Yeterli", "Mükemmel"]], ["b6", "Sürtünme ve tahriş", ["Sorun var", "Potansiyel sorun", "Belirgin sorun yok"]]];
  const BQ = ["Hareketlilik", "Aktivite", "Duyusal algılama", "Nem", "Sürtünme ve tahriş", "Beslenme", "Doku perfüzyonu ve oksijenasyon"];
  const bradenTot = (d) => { const v = BRADEN.map(([k]) => d[k]); return v.every(x => x != null) ? v.reduce((a, b) => a + b, 0) : null; };
  const bradenBand = (t) => t == null ? null : t <= 9 ? ["çok yüksek risk", "var(--crit)", "yüksek"] : t <= 12 ? ["yüksek risk", "var(--crit)", "yüksek"] : t <= 14 ? ["orta risk", "var(--high)", "orta"] : t <= 18 ? ["hafif risk", "var(--mid)", "düşük"] : ["risk yok", "var(--ok)", null];
  FORMS.braden = {
    title:"Bası yarası riski",
    init:() => ({ bq:{} }),
    badges:(d, p) => { if (p.ageGroup !== "adult") return [[N(d.man) ?? "—", p.ageGroup === "child" ? "Braden Q" : "Yenidoğan"]]; const t = bradenTot(d), b = bradenBand(t); return [[t ?? "—", "Braden /23", b ? b[1] : "var(--mute)"]]; },
    req:(d, p) => p.ageGroup === "adult" ? BRADEN.filter(([k]) => d[k] == null).map(([k, l]) => [k, l]) : (N(d.man) == null ? [["man", "Toplam puan (kağıt formdan)"]] : []),
    render(d, p) {
      if (p.ageGroup === "child") return `<div class="nfCol">${BOX("Braden Q (çocuk)", ARC("Braden Q") + BQ.map((l, i) => FL(l, OP(d, "bq.q" + i, [[1, "1"], [2, "2"], [3, "3"], [4, "4"]], { num:true }))).join("") + FL("Toplam puan", ST(d, "man", { min:7, max:28, def:20, u:"kağıt formdan" }), { req:"man" }))}</div>`;
      if (p.ageGroup === "neonate") return `<div class="nfCol">${BOX("Yenidoğan cilt / bası yarası riski", ARC("Yenidoğan bası yarası risk ölçeği (ör. NSRAS)") + FL("Toplam puan", ST(d, "man", { min:0, max:30, def:10, u:"kağıt formdan" }), { req:"man" }))}</div>`;
      const t = bradenTot(d), b = bradenBand(t);
      return `<div class="nfCol">${BOX("Braden Ölçeği (erişkin)", BRADEN.map(([k, l, o]) => FL(l, OP(d, k, o.map((t2, i) => [i + 1, t2, i + 1]), { num:true }), { req:k })).join("")
        + TOT(t ?? "—", "/ 23", b ? b[1] : "", b ? b[0] : "")
        + `<div class="nfNote">Düşük toplam = yüksek risk. Yaygın sınıflama: ≤9 çok yüksek · 10–12 yüksek · 13–14 orta · 15–18 hafif · 19–23 risk yok.${ADM("Önlem paketi (pozisyon sıklığı, yüzey) hastanenin protokolünden gelir.", " ")}</div>${SCN("Braden Ölçeği (6 madde, 6–23)")}`)}</div>`;
    },
    save(d, p) { p.flags = p.flags || {}; if (p.ageGroup !== "adult") return `${p.ageGroup === "child" ? "Braden Q" : "Yenidoğan"} ${N(d.man)}`;
      const t = bradenTot(d), b = bradenBand(t); if (b[2]) p.flags.braden = b[2]; else delete p.flags.braden; return `Braden ${t} · ${b[0]}`; },
  };

  /* ---------------------------------------------- GLASGOW KOMA SKALASI ---------------------------------------------- */
  const GCS_E = [[4, "Spontan"], [3, "Sese"], [2, "Ağrıya"], [1, "Yok"]];
  const GCS_V = [[5, "Oryante"], [4, "Konfüze"], [3, "Uygunsuz kelimeler"], [2, "Anlamsız sesler"], [1, "Yok"]];
  const GCS_VC = [[5, "Agular / yaşına uygun sesler, gülümser"], [4, "Huzursuz ağlar, teselli edilir"], [3, "Ağrıyla ağlar"], [2, "Ağrıyla inler"], [1, "Yok"]];
  const GCS_M = [[6, "Emre uyar"], [5, "Ağrıyı lokalize eder"], [4, "Normal fleksör (çekme)"], [3, "Anormal fleksör"], [2, "Ekstansör"], [1, "Yok"]];
  const gcsTot = (d) => { if (d.e == null || d.v == null || d.m == null) return null; return d.v === "T" ? `${d.e + d.m}T` : d.e + d.v + d.m; };
  FORMS.gcs = {
    title:"Glasgow Koma Skalası",
    init:() => ({ sed:undefined }),
    badges:(d) => d.sed === "Evet" ? [["—", "GKS · sedasyon"]] : [[gcsTot(d) ?? "—", "GKS /15", "var(--ink)"], ...(d.e != null && d.v != null && d.m != null ? [[`E${d.e}V${d.v}M${d.m}`, "Bileşen"]] : [])],
    req:(d) => { if (!d.sed) return [["sed", "Sedasyon var mı?"]]; if (d.sed === "Evet") return []; const r = []; if (d.e == null) r.push(["e", "Göz"]); if (d.v == null) r.push(["v", "Sözel"]); if (d.m == null) r.push(["m", "Motor"]); return r; },
    render(d, p) {
      const young = p.ageGroup === "child" && p.age < 5;
      const vOpts = (young ? GCS_VC : GCS_V).map(([v, l]) => [v, l, v]);
      return `<div class="nfCol">
        ${BOX("Sedasyon", FL("Sedasyon var mı?", OP(d, "sed", ["Hayır", "Evet"]), { req:"sed" }) + (d.sed === "Evet" ? `<div class="note i">Sedasyon altında GKS <b>değerlendirilemez</b> olarak kaydedilir. Sedasyon düzeyi hastanenin kullandığı ölçekle ayrıca değerlendirilir.</div>` : ""))}
        ${d.sed === "Evet" ? "" : BOX("Glasgow Koma Skalası", FL("Göz açma (E)", OP(d, "e", GCS_E.map(([v, l]) => [v, l, v]), { num:true }), { req:"e" })
          + FL(`Sözel yanıt (V)${young ? " · 5 yaş altı" : ""}`, `<div class="opts nfSc" data-f="v">${vOpts.map(([v, l]) => `<i data-v="${v}" class="${d.v === v ? "on" : ""}">${E(l)}<small>${v}</small></i>`).join("")}<i data-v="T" class="${d.v === "T" ? "on" : ""}">Entübe<small>T</small></i></div>`, { req:"v", hint:young ? "5 yaş altı çocukta sözel madde çocuk sürümüdür." : "Entübe hastada sözel yanıt “T” olarak işaretlenir; toplam “T” ile yazılır." })
          + FL("Motor yanıt (M)", OP(d, "m", GCS_M.map(([v, l]) => [v, l, v]), { num:true }), { req:"m" })
          + TOT(gcsTot(d) ?? "—", d.v === "T" ? "" : "/ 15", "", "", d.v === "T" ? "Sözel değerlendirilemedi" : "") + `${SCN(young ? "Glasgow Koma Skalası · çocuk sözel sürümü" : "Glasgow Koma Skalası (3–15)")}`)}
      </div>`;
    },
    after(d, f) { if (f === "v" && d.v !== "T" && d.v != null) d.v = +d.v; },
    save(d) { return d.sed === "Evet" ? "sedasyon altında · değerlendirilemedi" : `GKS ${gcsTot(d)} (E${d.e} V${d.v} M${d.m})`; },
  };

  /* ---------------------------------------------- 24.09 · YOĞUN BAKIM ÖLÇEKLERİ ----------------------------------------------
   * Yalnız yayımlanmış ölçeklerin kendi basamakları ve kendi karar kuralı kullanılır; sistem tanı koymaz, ilaç/doz önermez.
   *   RASS · Richmond Ajitasyon-Sedasyon Ölçeği (Sessler ve ark., 2002): +4 … −5, 10 basamak.
   *   CPOT · Critical-Care Pain Observation Tool (Gélinas ve ark., 2006): 4 madde × 0–2, toplam 0–8; >2 ağrı olası.
   *   CAM-ICU (Ely ve ark., 2001): 4 özellik; deliryum = 1 + 2 + (3 ya da 4). RASS −4/−5 ise değerlendirilemez.
   *   CAM-ICU harf dizisi ve soru setleri dile özgü onaylı sürümdendir; burada metinleri yazılmaz, yalnız hata sayısı girilir. */
  const RASS = [[4, "Saldırgan", "Açıkça saldırgan, şiddet içeren davranış; personel için tehlike"], [3, "Çok ajite", "Tüp ya da kateterleri çeker / çıkarır; agresif"],
    [2, "Ajite", "Sık amaçsız hareket; ventilatörle uyumsuzluk"], [1, "Huzursuz", "Endişeli, ancak hareketleri agresif ya da şiddetli değil"], [0, "Uyanık ve sakin", ""],
    [-1, "Uykulu", "Tam uyanık değil; sese ≥10 sn süren uyanıklık (göz açma / göz teması)"], [-2, "Hafif sedasyon", "Sese kısa süre uyanır (<10 sn göz teması)"],
    [-3, "Orta sedasyon", "Sese hareket ya da göz açma; göz teması yok"], [-4, "Derin sedasyon", "Sese yanıt yok; fiziksel uyarıyla hareket ya da göz açma"],
    [-5, "Uyandırılamıyor", "Sese ya da fiziksel uyarıya yanıt yok"]];
  const lastOf = (key, pid) => recsOf(key, pid).slice(-1)[0];
  FORMS.rass = {
    title:"RASS · sedasyon-ajitasyon",
    init:() => ({ saat:H.now() }),
    badges:(d) => [[d.r == null ? "—" : sgn(d.r), "RASS", d.r == null ? "var(--mute)" : Math.abs(d.r) >= 3 ? "var(--crit)" : d.r !== 0 ? "var(--mid)" : "var(--ok)"]],
    req:(d) => { const r = []; if (!d.saat) r.push(["saat", "Değerlendirme saati"]); if (d.r == null) r.push(["r", "RASS düzeyi"]); return r; },
    render(d) {
      return `<div class="nfCol">${BOX("Richmond Ajitasyon-Sedasyon Ölçeği (RASS)", FL("Saat", TX(d, "saat", "", { w:120 }), { req:"saat" })
        + FL("Düzey", `<div class="opts nfSc" data-f="r" data-n style="--ow:420px">${RASS.map(([v, l, x]) => `<i data-v="${v}" class="${d.r === v ? "on" : ""}"><span><b>${E(l)}</b>${x ? `<br><span style="font-weight:500;font-size:12px">${E(x)}</span>` : ""}</span><small>${sgn(v)}</small></i>`).join("")}</div>`, { req:"r", col:true })
        + FL("Hedef RASS (hekim istemi)", TX(d, "hedef", "ör. 0 ile −1 arası", { w:220 }), { hint:"Hedef düzey hekimin istemidir; sistem hedef önermez." })
        + `<div class="nfNote">Uygulama: 1) Hastayı gözle (uyanık / huzursuz / ajite → 0 … +4). 2) Uyanık değilse adıyla seslen, gözlerini açıp bakmasını iste (−1 … −3). 3) Sese yanıt yoksa omzunu sars ya da sternumu ov (−4 / −5).</div>
        <div class="nfNote">Kaynak ölçek: <b>Richmond Agitation-Sedation Scale (Sessler ve ark., 2002)</b>${ADM("hastanenin onaylı Türkçe formuyla karşılaştırılmalı")}</div>`)}</div>`;
    },
    after(d, f) { if (f === "r" && d.r != null) d.r = +d.r; },
    save(d, p) { p.flags = p.flags || {}; p.flags.rass = d.r; return `RASS ${sgn(d.r)}`; },
  };

  const CPOT = [["yuz", "Yüz ifadesi", [[0, "Rahat, nötr", "Kas gerginliği yok"], [1, "Gergin", "Kaş çatma, kaşlarda düşme, göz çevresinde sıkma"], [2, "Yüzünü buruşturuyor", "Yukarıdakilere ek olarak göz kapaklarını sıkıca kapatma"]]],
    ["hrk", "Vücut hareketleri", [[0, "Hareket yok ya da normal pozisyon", ""], [1, "Korunma", "Yavaş, dikkatli hareketler; ağrılı bölgeye dokunma ya da ovma; hareketle dikkat çekme"], [2, "Huzursuzluk / ajitasyon", "Tüpü çekme, oturmaya çalışma, kolları savurma, komutlara uymama, personele vurma, yataktan çıkmaya çalışma"]]],
    ["kas", "Kas gerginliği (üst ekstremitenin pasif fleksiyon ve ekstansiyonu)", [[0, "Gevşek", "Pasif harekete direnç yok"], [1, "Gergin, sert", "Pasif harekete direnç"], [2, "Çok gergin ya da sert", "Güçlü direnç; hareket tamamlanamıyor"]]]];
  const CPOT_V = [[0, "Ventilatöre uyumlu", "Alarm yok, ventilasyon kolay"], [1, "Öksürüyor ama uyumlu", "Öksürük; alarm çalabilir ama kendiliğinden durur"], [2, "Ventilatörle savaşıyor", "Asenkroni; ventilasyon engelleniyor, sık alarm"]];
  const CPOT_S = [[0, "Normal tonda konuşuyor ya da ses yok", ""], [1, "İç çekme, inleme", ""], [2, "Bağırma, hıçkırarak ağlama", ""]];
  const cpotTot = (d) => { const v = [...CPOT.map(r => d[r[0]]), d.son]; return v.every(x => x != null) ? v.reduce((a, b) => a + b, 0) : null; };
  const opt3 = (d, f, rows) => `<div class="opts nfSc" data-f="${f}" data-n style="--ow:300px">${rows.map(([v, l, x]) => `<i data-v="${v}" class="${d[f] === v ? "on" : ""}"><span><b>${E(l)}</b>${x ? `<br><span style="font-weight:500;font-size:12px">${E(x)}</span>` : ""}</span><small>${v}</small></i>`).join("")}</div>`;
  FORMS.cpot = {
    title:"CPOT · yoğun bakım ağrı gözlemi",
    init:(p) => ({ saat:H.now(), ent:/ventil|entübe|mekanik/i.test((p.v || {}).o2 || "") ? "Evet" : undefined }),
    badges:(d) => { const t = cpotTot(d); return [[t ?? "—", "CPOT /8", t == null ? "var(--mute)" : t > 2 ? "var(--crit)" : "var(--ok)"]]; },
    req:(d) => { const r = CPOT.filter(([k]) => d[k] == null).map(([k, l]) => [k, l]); if (!d.ent) r.push(["ent", "Entübe mi?"]); else if (d.son == null) r.push(["son", d.ent === "Evet" ? "Ventilatör uyumu" : "Sesli ifade"]); return r; },
    render(d) {
      const t = cpotTot(d);
      return `<div class="nfCol">${BOX("Critical-Care Pain Observation Tool (CPOT)", FL("Saat", TX(d, "saat", "", { w:120 }))
        + CPOT.map(([k, l, rows]) => FL(l, opt3(d, k, rows), { req:k })).join("")
        + FL("Hasta entübe mi?", OP(d, "ent", ["Evet", "Hayır"]), { req:"ent", hint:"Entübe hastada ventilatör uyumu, entübe olmayan hastada sesli ifade puanlanır; ikisi birlikte puanlanmaz." })
        + (d.ent ? FL(d.ent === "Evet" ? "Ventilatör uyumu" : "Sesli ifade", opt3(d, "son", d.ent === "Evet" ? CPOT_V : CPOT_S), { req:"son" }) : "")
        + TOT(t ?? "—", "/ 8", t == null ? "" : t > 2 ? "var(--crit)" : "var(--ok)", t == null ? "" : t > 2 ? "ağrı olası (>2)" : "ağrı olası değil (0–2)")
        + `<div class="nfNote">Değerlendirme dinlenme sırasında ve ağrılı işlem (pozisyon verme, aspirasyon) sırasında ayrı ayrı yapılır. Ağrı yönetimi kararı hekimindir.</div>
        <div class="nfNote">Kaynak ölçek: <b>Critical-Care Pain Observation Tool (Gélinas ve ark., 2006)</b> · toplam 0–8, >2 ağrı olası${ADM("hastanenin onaylı Türkçe formuyla karşılaştırılmalı")}</div>`)}</div>`;
    },
    after(d, f) { if (["yuz", "hrk", "kas", "son"].includes(f) && d[f] != null) d[f] = +d[f]; if (f === "ent") d.son = undefined; },
    save(d) { const t = cpotTot(d); return `CPOT ${t}/8${t > 2 ? " · ağrı olası" : ""}`; },
  };

  // CAM-ICU: özellik 3, son RASS kaydından doldurulur (varsa); kullanıcı değiştirebilir.
  const camRes = (d) => {
    if (d.rass != null && d.rass <= -4) return { k:"na", l:"Değerlendirilemez (RASS −4 / −5)", c:"var(--mute)" };
    const f1 = d.f1 === "Evet" ? true : d.f1 === "Hayır" ? false : null;
    const f2 = N(d.f2e) == null ? null : N(d.f2e) > 2;
    const f3 = d.rass == null ? null : d.rass !== 0;
    const f4 = N(d.f4e) == null ? null : N(d.f4e) > 1;
    if (f1 === false || f2 === false) return { k:"neg", l:"CAM-ICU negatif", c:"var(--ok)", f:[f1, f2, f3, f4] };
    if (f1 && f2 && (f3 || f4)) return { k:"pos", l:"CAM-ICU pozitif (deliryum bulguları)", c:"var(--crit)", f:[f1, f2, f3, f4] };
    if (f1 && f2 && f3 === false && f4 === false) return { k:"neg", l:"CAM-ICU negatif", c:"var(--ok)", f:[f1, f2, f3, f4] };
    return null; };
  FORMS.camicu = {
    title:"CAM-ICU · deliryum taraması",
    init:(p) => { const r = lastOf("rass", p.id); return { saat:H.now(), rass:r ? r.d.r : undefined }; },
    badges:(d) => { const r = camRes(d); return [[r ? (r.k === "pos" ? "+" : r.k === "neg" ? "−" : "—") : "…", "CAM-ICU", r ? r.c : "var(--mute)"]]; },
    req:(d) => { const r = []; if (d.rass == null) r.push(["rass", "Güncel RASS"]); if (d.rass != null && d.rass <= -4) return r;
      if (!d.f1) r.push(["f1", "Özellik 1"]); if (d.f1 === "Evet" && N(d.f2e) == null) r.push(["f2e", "Özellik 2 · hata sayısı"]);
      if (d.f1 === "Evet" && N(d.f2e) > 2 && d.rass === 0 && N(d.f4e) == null) r.push(["f4e", "Özellik 4 · hata sayısı"]); return r; },
    render(d, p) {
      const r = camRes(d), last = lastOf("rass", p.id), na = d.rass != null && d.rass <= -4;
      return `<div class="nfCol">
        ${BOX("Ön koşul · bilinç düzeyi", FL("Güncel RASS", `<div class="opts" data-f="rass" data-n>${RASS.map(([v]) => `<i data-v="${v}" class="${d.rass === v ? "on" : ""}">${sgn(v)}</i>`).join("")}</div>`, { req:"rass", hint:last ? `Son RASS kaydı: ${sgn(last.d.r)} · ${last.at}` : "Kayıtlı RASS yok; önce RASS değerlendirin." })
          + (na ? `<div class="note i">RASS −4 ya da −5: CAM-ICU <b>değerlendirilemez</b>. Daha sonra yeniden değerlendirin.</div>` : ""))}
        ${na ? "" : `<div class="nfTwo">
        ${BOX("Özellik 1 · Mental durumda akut değişiklik ya da dalgalanma", FL("Başlangıca göre akut değişiklik ya da son 24 saatte dalgalanma var mı?", OP(d, "f1", ["Evet", "Hayır"]), { req:"f1", col:true }))}
        ${BOX("Özellik 2 · Dikkatsizlik", FL("Harf dikkat testi · hata sayısı (0–10)", ST(d, "f2e", { min:0, max:10, def:0 }), { req:"f2e", col:true, hint:"Onaylı CAM-ICU sürümündeki 10 harflik dizi okunur; hata >2 ise özellik var." }))}
        ${BOX("Özellik 3 · Bilinç düzeyinde değişiklik", `<div class="kv"><span>Güncel RASS</span><b>${d.rass == null ? "—" : sgn(d.rass)}</b></div><div class="nfNote">RASS 0 dışında ise özellik var.</div>`)}
        ${BOX("Özellik 4 · Dezorganize düşünce", FL("Evet/hayır soruları + komut · hata sayısı (0–5)", ST(d, "f4e", { min:0, max:5, def:0 }), { req:"f4e", col:true, hint:"Onaylı sürümdeki 4 soru ve 1 komut; hata >1 ise özellik var." }))}
        </div>`}
        ${r ? `<div class="nfTotal" style="--c:${r.c}"><span class="k">Sonuç</span><span class="nfRisk">${r.l}</span></div>` : ""}
        <div class="nfNote">Karar kuralı: Özellik 1 ve 2 var, ayrıca 3 ya da 4 var ise CAM-ICU pozitif. Sonuç tarama bulgusudur; tanı ve tedavi kararı hekimindir.</div>
        <div class="nfNote">Kaynak ölçek: <b>CAM-ICU (Ely ve ark., 2001)</b>${ADM("harf dizisi ve sorular hastanenin onaylı Türkçe sürümünden alınmalı")}</div></div>`;
    },
    after(d, f) { if (f === "rass" && d.rass != null) d.rass = +d.rass; },
    save(d) { const r = camRes(d); return r ? r.l : "CAM-ICU · eksik"; },
  };
  // Form kataloğuna ekle (core.js'teki H.FORMS dizisi çalışma anında genişletilir; görev planı üretilmez)
  [["rass", "RASS · sedasyon-ajitasyon", "eye", "hekim istemine göre"], ["cpot", "CPOT · ağrı gözlemi (YB)", "body", "4 saatte bir"], ["camicu", "CAM-ICU · deliryum", "activity", "vardiyada bir"]]
    .forEach(([key, name, icon, freq]) => { if (H.FORMS && !H.FORMS.some(f => f.key === key)) H.FORMS.push({ key, name, icon, freq, ages:["adult"] }); });

  /* =================================================================================================================
   *  GÖREVLERİM
   * ================================================================================================================= */
  const TS = { kind:"all", late:false, collapsed:new Set(), mode:null };
  // saat sütununun GERÇEK genişliği (--cw artık esnek; CSS değişkeni sayı olarak okunamaz)
  const tkColW = (w) => { const th = w && w.querySelector(".tk thead th:nth-child(2)"); return (th && th.getBoundingClientRect().width) || 46; };
  const KIND = { form:["clip", "Form"], med:["pill", "İlaç"], care:["heart", "Bakım"], lab:["flask", "Lab"] };
  const PRIO = { late:0, due:1, plan:2, miss:3, done:4 };
  const tcIcon = (s) => s === "done" ? I("ok") : s === "miss" ? I("x") : s === "late" ? "!" : s === "due" ? I("clock") : "";
  const stTxt = { done:"Tamamlandı", miss:"Uygulanmadı", late:"Gecikti", due:"Şimdi", plan:"Planlı" };

  function medModal(t, opt = {}) {
    const p = H.pt(t.pid), S = { res:null, why:null, scan:false, note:"" };
    const body = () => `<div class="nf">
      <div class="kv"><span>Hasta</span><b style="font-family:Figtree">${E(H.bed(p.bed).no)} · ${E(p.name)}</b></div>
      <div class="kv"><span>İlaç (order)</span><b style="font-family:Figtree">${E(t.label)}</b></div><div class="kv"><span>Planlanan saat</span><b>${hhmm(t.t)}</b></div>
      ${p.allergies && p.allergies.length ? `<div class="note" style="margin:10px 0">Alerji kaydı: <b>${E(p.allergies.join(", "))}</b>. Bu ilaçla ilişkisini değerlendirmek hekimin kararıdır.</div>` : ""}
      <label class="nfChk"><input type="checkbox" data-m-scan${S.scan ? " checked" : ""}>Hasta bilekliği ve ilaç barkodu okutuldu (eşleşti)</label>
      <div class="fld col"><label>Sonuç <span class="req">●</span></label><div class="opts">${["Uygulandı", "Uygulanmadı"].map(x => `<i data-m-res="${x}" class="${S.res === x ? "on" : ""}">${x}</i>`).join("")}</div></div>
      ${S.res === "Uygulanmadı" ? `<div class="fld col"><label>Neden <span class="req">●</span></label><div class="opts">${["Hasta reddetti", "Hasta serviste değil", "Aç / NPO", "İlaç eczaneden gelmedi", "Hekim durdurdu", "Damar yolu yok", "Diğer"].map(x => `<i data-m-why="${x}" class="${S.why === x ? "on" : ""}">${x}</i>`).join("")}</div></div>` : ""}
      <div class="fld col"><label>Not</label><input data-m-note value="${E(S.note)}" placeholder="İsteğe bağlı"></div>
      <div class="nfNote">Sistem doz ya da ilaç önermez; yalnız order'daki uygulamayı kaydeder.</div></div>`;
    const m = H.modal({ title:"İlaç uygulama", body:body(), actions:`<button class="btn g" data-mx="c">İptal</button>${t.prn ? "" : `<button class="btn" data-mx="later">Ertele · 30 dk</button>`}<button class="btn p" data-mx="s">${I("ok")}Kaydet</button>`,
      onMount(el) { const re = () => { el.querySelector(".mb").innerHTML = body(); };
        el.addEventListener("click", (e) => { const r = e.target.closest("[data-m-res]"); if (r) { S.res = r.dataset.mRes; return re(); } const w = e.target.closest("[data-m-why]"); if (w) { S.why = w.dataset.mWhy; return re(); }
          const b = e.target.closest("[data-mx]"); if (!b) return; if (b.dataset.mx === "c") return H.closeModal();
          if (b.dataset.mx === "later") { t.state = "plan"; t.deferred = hhmm(21.7 + 0.5); H.log("İlaç ertelendi", `${H.bed(p.bed).no} · ${t.label} → ${t.deferred}`); H.closeModal(); H.toast("30 dk ertelendi · " + t.deferred, "w"); if (opt.onDone) opt.onDone(t); return rerender(); }
          if (!S.res) return H.toast("Sonucu seçin.", "e"); if (S.res === "Uygulanmadı" && !S.why) return H.toast("Uygulanmama nedenini seçin.", "e");
          if (S.res === "Uygulandı" && !S.scan) return H.toast("Önce bileklik ve ilaç barkodunu okutun.", "e");
          t.state = S.res === "Uygulandı" ? "done" : "miss"; t.reason = S.why; t.note = S.note; t.doneAt = H.now(); t.by = uname();
          if (S.res === "Uygulandı") t.given = true; else t.given = false;
          H.log(S.res === "Uygulandı" ? "İlaç uygulandı" : "İlaç uygulanmadı", `${H.bed(p.bed).no} · ${t.label} · ${hhmm(t.t)}${S.why ? " · " + S.why : ""}`); H.closeModal(); H.toast(`${t.label} · ${S.res.toLowerCase()}${S.why ? " · " + S.why : ""}`, S.res === "Uygulandı" ? "" : "w");
          if (opt.onDone) opt.onDone(t); rerender(); });
        el.addEventListener("change", (e) => { if (e.target.matches("[data-m-scan]")) S.scan = e.target.checked; });
        el.addEventListener("input", (e) => { if (e.target.matches("[data-m-note]")) S.note = e.target.value; }); } });
    return m;
  }
  // 30.09 · kontrol §4-5: tek ilaç uygulama penceresi — Görevlerim, hasta İlaç ve Takip sekmeleri bunu çağırır.
  H.medAct = (t, opt = {}) => {
    if (t.state === "done" || t.state === "miss") { const p = H.pt(t.pid);
      return H.modal({ title:t.label, body:`<div class="kv"><span>Hasta</span><b style="font-family:Figtree">${E(H.bed(p.bed).no)} · ${E(p.name)}</b></div><div class="kv"><span>Planlanan</span><b>${hhmm(t.t)}</b></div>
        <div class="kv"><span>Durum</span><b style="font-family:Figtree">${t.state === "miss" || t.given === false ? stTxt.miss : stTxt.done}${t.reason ? " · " + E(t.reason) : ""}</b></div><div class="kv"><span>Kaydeden</span><b style="font-family:Figtree">${E(t.by || "önceki vardiya")}${t.doneAt ? " · " + t.doneAt : ""}</b></div>${t.note ? `<div class="kv"><span>Not</span><b style="font-family:Figtree">${E(t.note)}</b></div>` : ""}`,
        actions:`<button class="btn" data-x>Kapat</button>` }); }
    return medModal(t, opt);
  };
  function careModal(t) {
    const p = H.pt(t.pid), pos = /Pozisyon/i.test(t.label), lab = t.kind === "lab", S = { pos:null, scan:false, note:"" };
    const body = () => `<div class="nf"><div class="kv"><span>Hasta</span><b style="font-family:Figtree">${E(H.bed(p.bed).no)} · ${E(p.name)}</b></div><div class="kv"><span>İş</span><b style="font-family:Figtree">${E(t.label)}</b></div><div class="kv"><span>Planlanan saat</span><b>${hhmm(t.t)}</b></div>
      ${pos ? `<div class="fld col" style="margin-top:10px"><label>Verilen pozisyon <span class="req">●</span></label><div class="opts">${["Sağ yan", "Sol yan", "Sırt üstü", "Yarı oturur (30°)"].map(x => `<i data-c-pos="${x}" class="${S.pos === x ? "on" : ""}">${x}</i>`).join("")}</div></div>` : ""}
      ${lab ? `<label class="nfChk"><input type="checkbox" data-c-scan${S.scan ? " checked" : ""}>Tüp etiketi ve hasta bilekliği okutuldu</label>` : ""}
      <div class="fld col"><label>Not</label><input data-c-note value="${E(S.note)}" placeholder="İsteğe bağlı"></div></div>`;
    H.modal({ title:lab ? "Numune alma" : "Bakım", body:body(), actions:`<button class="btn g" data-cx="c">İptal</button><button class="btn p" data-cx="s">${I("ok")}Tamamlandı</button>`,
      onMount(el) { const re = () => { el.querySelector(".mb").innerHTML = body(); };
        el.addEventListener("click", (e) => { const q = e.target.closest("[data-c-pos]"); if (q) { S.pos = q.dataset.cPos; return re(); }
          const b = e.target.closest("[data-cx]"); if (!b) return; if (b.dataset.cx === "c") return H.closeModal();
          if (pos && !S.pos) return H.toast("Verilen pozisyonu seçin.", "e"); if (lab && !S.scan) return H.toast("Önce tüp etiketi ve bilekliği okutun.", "e");
          t.state = "done"; t.doneAt = H.now(); t.by = uname(); t.note = [S.pos, S.note].filter(Boolean).join(" · ");
          H.log((lab ? "numune:" : "bakım:") + t.label, t.pid); H.closeModal(); H.toast(`${t.label} tamamlandı${S.pos ? " · " + S.pos : ""}`); rerender(); });
        el.addEventListener("change", (e) => { if (e.target.matches("[data-c-scan]")) S.scan = e.target.checked; });
        el.addEventListener("input", (e) => { if (e.target.matches("[data-c-note]")) S.note = e.target.value; }); } });
  }
  function taskAct(t) {
    const p = H.pt(t.pid); if (!p) return;
    if (t.state === "done" || t.state === "miss") return H.modal({ title:t.label, body:`<div class="kv"><span>Hasta</span><b style="font-family:Figtree">${E(p.name)}</b></div><div class="kv"><span>Planlanan</span><b>${hhmm(t.t)}</b></div>
      <div class="kv"><span>Durum</span><b style="font-family:Figtree">${stTxt[t.state]}${t.reason ? " · " + E(t.reason) : ""}</b></div><div class="kv"><span>Kaydeden</span><b style="font-family:Figtree">${E(t.by || "önceki vardiya")}${t.doneAt ? " · " + t.doneAt : ""}</b></div>${t.note ? `<div class="kv"><span>Not</span><b style="font-family:Figtree">${E(t.note)}</b></div>` : ""}`,
      actions:`<button class="btn" data-x>Kapat</button>` });
    if (t.state === "plan" && t.t > 23) H.toast(`Planlı iş (${hhmm(t.t)}). Erken kayıt denetim kaydına işlenir.`, "w");
    if (t.kind === "form" && t.form) return H.forms.open(t.form, t.pid, { task:t });
    if (t.kind === "med") return medModal(t);
    return careModal(t);
  }

  H.register("tasks", { title:() => H.t("m_tasks"), perm:"tasks", render(root, params = {}) {
    if (H.ensureMedTasks) H.data.patients.forEach(H.ensureMedTasks);   // 30.09: sonradan kabul edilen hastanın planlı dozları da Görevlerim'e düşsün
    const pts = (params.pid ? [H.pt(params.pid)] : H.myPatients()).filter(Boolean).filter(p => !H.state.unitId || H.bed(p.bed).unitId === H.state.unitId);
    const ids = new Set(pts.map(p => p.id));
    const all = H.data.tasks.filter(t => ids.has(t.pid));
    const cnt = (s) => all.filter(t => t.state === s).length;
    const mode = TS.mode || (window.innerWidth < 700 ? "liste" : "izgara");
    const keep = (t) => (TS.kind === "all" || t.kind === TS.kind) && (!TS.late || t.state === "late");
    const hours = Array.from({ length:24 }, (_, i) => 8 + i);
    let bodyHtml = "";
    if (mode === "izgara") {
      const rows = pts.map(p => {
        const ts = all.filter(t => t.pid === p.id && keep(t)); if (!ts.length) return "";
        const groups = {}; ts.forEach(t => { const k = t.kind + "|" + t.label; (groups[k] = groups[k] || []).push(t); });
        const order = Object.keys(groups).sort((a, b) => Object.keys(KIND).indexOf(a.split("|")[0]) - Object.keys(KIND).indexOf(b.split("|")[0]) || a.localeCompare(b, "tr"));
        const lt = ts.filter(t => t.state === "late").length, du = ts.filter(t => t.state === "due").length, cl = TS.collapsed.has(p.id);
        return `<tr class="pt"><td><div class="tkP${cl ? " cl" : ""}" data-tk-tg="${p.id}">${I("chevD")}<span class="bn">${E(H.bed(p.bed).no)}</span><b>${E(p.name)}</b></div></td>
          <td colspan="24" class="ps"><div class="psIn">${H.ageText(p)} · ${E(p.dx)} · ${lt ? `<span class="tag c">${lt} geciken</span> ` : ""}${du ? `<span class="tag">${du} şimdi</span> ` : ""}${ts.length} iş</div></td></tr>`
          + (cl ? "" : order.map(k => { const [kind, label] = k.split("|"), g = groups[k];
            return `<tr><td class="lbl" title="${E(label)}">${I(KIND[kind][0])}${E(label)}</td>${hours.map(h => { const c = g.filter(t => Math.floor(t.t) === h); const dc = h === 24 ? ' class="dayb"' : ""; if (!c.length) return `<td${dc}></td>`;
              const t = c.slice().sort((a, b) => PRIO[a.state] - PRIO[b.state])[0];
              return `<td${dc}><button type="button" class="tc ${t.state}" data-tk-i="${H.data.tasks.indexOf(t)}" title="${hhmm(t.t)} · ${E(label)} · ${stTxt[t.state]}">${tcIcon(t.state)}${c.length > 1 ? `<sup>${c.length}</sup>` : ""}</button></td>`; }).join("")}</tr>`; }).join(""));
      }).join("");
      bodyHtml = `<div class="tkWrap"><div class="tkIn"><div class="tkNow"><span>${H.now()}</span></div><table class="tk"><thead><tr><th>Hasta / iş<small class="tkDay">${H.wd(0)} ${H.dm(0)} → ${H.wd(1)} ${H.dm(1)}</small></th>${hours.map(h => `<th class="${h === 21 ? "nowh" : ""}${h === 24 ? " dayb" : ""}">${h === 8 || h === 24 ? `<small class="tkDay">${H.wd(h === 24 ? 1 : 0)} ${H.dm(h === 24 ? 1 : 0)}</small>` : ""}${String(h % 24).padStart(2, "0")}</th>`).join("")}</tr></thead>
        <tbody>${rows || `<tr><td colspan="25" style="text-align:center;padding:26px;color:var(--mute)">Bu filtreyle iş yok.</td></tr>`}</tbody></table></div></div>
        <div class="tkLeg"><span><span class="tc done">${I("ok")}</span> tamamlandı</span><span><span class="tc late">!</span> gecikti</span><span><span class="tc due">${I("clock")}</span> şimdi</span><span><span class="tc plan"></span> planlı</span><span><span class="tc miss">${I("x")}</span> uygulanmadı</span><span>· kırmızı çizgi: şimdi (${H.nowFull()})</span><span>· kalın çizgi: gün değişimi (${H.dm(1)} 00:00)</span></div>`;
    } else {
      const items = all.filter(keep).filter(t => TS.late || t.state !== "done").sort((a, b) => PRIO[a.state] - PRIO[b.state] || a.t - b.t);
      bodyHtml = `<div class="tkList">${items.map(t => { const p = H.pt(t.pid);
        return `<div class="tkItem ${t.state}" data-tk-i="${H.data.tasks.indexOf(t)}"><span class="tm">${hhmm(t.t)}</span><span class="tc ${t.state}">${tcIcon(t.state)}</span><div><b>${E(t.label)}</b><small>${E(H.bed(p.bed).no)} · ${E(p.name)}</small></div><span class="${t.state === "late" ? "tag c" : "tag"}">${stTxt[t.state]}</span></div>`; }).join("") || `<div class="empty">Bekleyen iş yok.</div>`}</div>
        <div class="nfNote">Liste görünümünde tamamlanan işler gizlidir; ızgarada görünür.</div>`;
    }
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_tasks")}</h2><p>${E(uname())} · bu nöbet <b class="mono">${H.SHIFT.start} → ${H.SHIFT.end}</b> · ${pts.length} hasta${params.pid ? ` · <a data-tk-all style="cursor:pointer">tüm hastalarım</a>` : ""}</p></div>
        <div class="r"><div class="seg" data-tk-mode><button type="button" data-v="izgara" class="${mode === "izgara" ? "on" : ""}">Izgara</button><button type="button" data-v="liste" class="${mode === "liste" ? "on" : ""}">Liste</button></div></div></div>
      <div class="att tkAtt">
        <div class="ac ${cnt("late") ? "crit" : "ok"}" data-tk-late><div class="i">${I("alert")}</div><b>${cnt("late")}</b><span>Geciken${TS.late ? " · filtre açık" : " · yalnız bunları göster"}</span></div>
        <div class="ac" style="background:var(--priSoft);border-color:color-mix(in srgb,var(--pri) 40%,transparent)"><div class="i" style="background:var(--priSoft);color:var(--pri)">${I("clock")}</div><b>${cnt("due")}</b><span>Şimdi (bu saat)</span></div>
        <div class="ac ok"><div class="i" style="color:var(--mute)">${I("list")}</div><b>${cnt("plan")}</b><span>Kalan (planlı)</span></div>
        <div class="ac ok"><div class="i">${I("ok")}</div><b>${cnt("done")}</b><span>Tamamlanan${cnt("miss") ? ` · ${cnt("miss")} uygulanmadı` : ""}</span></div></div>
      <div class="tkBar"><div class="seg" data-tk-kind>${[["all", "Tümü"], ["form", "Form"], ["med", "İlaç"], ["care", "Bakım"], ["lab", "Lab"]].map(([k, l]) => `<button type="button" data-v="${k}" class="${TS.kind === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <label class="nfChk" style="padding:0"><input type="checkbox" data-tk-lo${TS.late ? " checked" : ""}>Yalnız gecikenler</label>
        ${mode === "izgara" ? `<button type="button" class="btn sm g" data-tk-now>${I("clock")}Şimdiye git</button>` : ""}
        ${mode === "izgara" ? `<button type="button" class="btn sm g" data-tk-colall>${TS.collapsed.size ? "Tümünü aç" : "Tümünü kapat"}</button>` : ""}</div>
      ${bodyHtml}`;
    root.addEventListener("click", (e) => {
      const i = e.target.closest("[data-tk-i]"); if (i) return taskAct(H.data.tasks[+i.dataset.tkI]);
      const tg = e.target.closest("[data-tk-tg]"); if (tg) { const id = tg.dataset.tkTg; TS.collapsed.has(id) ? TS.collapsed.delete(id) : TS.collapsed.add(id); return H.renderApp(); }
      const md = e.target.closest("[data-tk-mode] button"); if (md) { TS.mode = md.dataset.v; return H.renderApp(); }
      const kd = e.target.closest("[data-tk-kind] button"); if (kd) { TS.kind = kd.dataset.v; return H.renderApp(); }
      if (e.target.closest("[data-tk-late]")) { TS.late = !TS.late; return H.renderApp(); }
      if (e.target.closest("[data-tk-colall]")) { if (TS.collapsed.size) TS.collapsed.clear(); else pts.forEach(p => TS.collapsed.add(p.id)); return H.renderApp(); }
      if (e.target.closest("[data-tk-all]")) return H.go("tasks", {});
      if (e.target.closest("[data-tk-now]")) { const w2 = root.querySelector(".tkWrap"), cw2 = tkColW(w2); return w2.scrollTo({ left:Math.max(0, (13.7 - 3) * cw2), behavior:"smooth" }); }
    });
    root.addEventListener("change", (e) => { if (e.target.matches("[data-tk-lo]")) { TS.late = e.target.checked; H.renderApp(); } });
    // ızgarayı "şimdi"ye kaydır
    const w = root.querySelector(".tkWrap"); if (w) { const cw = tkColW(w); w.scrollLeft = Math.max(0, (13.7 - 3) * cw); }
  } });

  /* =================================================================================================================
   *  YATAK BAŞI ÖLÇÜM (portatif cihaz)
   * ================================================================================================================= */
  const BS = { step:1, pid:null, scanning:false, idOk:false, meas:false, src:null, v:{}, dev:{}, saved:null };
  const bsReset = () => Object.assign(BS, { step:1, pid:null, scanning:false, idOk:false, meas:false, src:null, v:{}, dev:{}, saved:null });
  const BS_F = [["hr", "Nabız", "/dk", 1, 0, 300, "device"], ["sbp", "KB sistolik", "mmHg", 1, 0, 300, "device"], ["dbp", "KB diyastolik", "mmHg", 1, 0, 200, "device"], ["spo2", "SpO₂", "%", 1, 50, 100, "device"], ["temp", "Ateş", "°C", 0.1, 30, 43, "device"], ["rr", "Solunum", "/dk", 1, 0, 120, "nurse"]];
  const birth = (p) => { const d = new Date(); if (p.ageGroup === "neonate") { d.setDate(d.getDate() - (p.ageDays || 0)); return d.toLocaleDateString("tr-TR"); } return String(d.getFullYear() - p.age); };
  const bsNews = (p) => p.ageGroup === "adult" ? news2({ ...BS.v, o2:BS.v.o2 === "Ek oksijen", scale2:!!NS.scale2[p.id] }) : null;

  H.register("bedside", { title:() => H.t("m_bedside"), perm:"bedside", render(root, params = {}) {
    if (params.pid && BS.pid !== params.pid && BS.step === 1 && !BS.scanning) { BS.pid = params.pid; }
    const p = BS.pid ? H.pt(BS.pid) : null;
    const steps = ["Hastayı tanımla", "Ölçüm kaynağı", "Kontrol", "Kaydet"];
    const stepper = `<div class="bsSteps">${steps.map((s, i) => `<div class="${BS.step === i + 1 ? "on" : BS.step > i + 1 ? "ok" : ""}"><i>${BS.step > i + 1 ? "✓" : i + 1}</i><span>${s}</span></div>`).join("")}</div>`;
    const ptCard = p ? `<div class="box" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><span class="mono" style="font:700 20px 'JetBrains Mono';color:var(--pri)">${E(H.bed(p.bed).no)}</span><div><b style="font:700 17px 'Space Grotesk'">${E(p.name)}</b><div class="mute" style="font-size:12.5px">${H.ageText(p)} · ${p.sex === "K" ? "Kadın" : "Erkek"} · ${E(p.dx)}</div></div>${BS.idOk ? `<span class="tag" style="margin-left:auto;color:var(--ok);border-color:var(--ok)">${I("ok")}Kimlik doğrulandı</span>` : ""}</div>` : "";
    let main = "";
    if (BS.step === 1) {
      if (BS.scanning) main = `<div class="box" style="text-align:center"><div class="bsScan">${I("qr")}</div><b>Bileklik okunuyor…</b><div class="mute" style="font-size:13px">Kamerayı hasta bilekliğindeki QR koda tutun.</div></div>`;
      else if (p) main = `<div class="box"><h5>Kimlik doğrulama</h5>
          <div class="bsId"><div><small>Ad soyad</small><b>${E(p.name)}</b></div><div><small>${p.ageGroup === "neonate" ? "Doğum tarihi" : "Doğum yılı"}</small><b class="mono">${birth(p)}</b></div><div><small>Yatak</small><b class="mono">${E(H.bed(p.bed).no)}</b></div><div><small>Protokol</small><b class="mono">${E(H.protoOf ? H.protoOf(p) : p.id)}</b></div><div><small>Hasta no</small><b class="mono">${E(H.hnOf ? H.hnOf(p) : "")}</b></div></div>
          <p style="font:700 16px 'Space Grotesk';margin:6px 0 12px">Ad soyad + ${p.ageGroup === "neonate" ? "doğum tarihi" : "doğum yılı"} hastayla (ya da yakınıyla) eşleşiyor mu?</p>
          <div class="bsBig"><button type="button" class="bsBtn p" data-bs="idok">${I("ok")}<b>Evet, eşleşiyor</b><small>Ölçüme geç</small></button><button type="button" class="bsBtn" data-bs="idno">${I("x")}<b>Hayır, eşleşmiyor</b><small>Seçimi iptal et</small></button></div></div>`;
      else main = `<div class="bsBig" style="margin-bottom:16px"><button type="button" class="bsBtn p" data-bs="scan">${I("qr")}<b>Bilekliği okut (QR)</b><small>En güvenli yol: hasta kimliği bileklikten gelir</small></button></div>
        <div class="sec">ya da listeden seçin <small>${H.myPatients().length} hasta</small></div>
        <div class="bsPl">${H.myPatients().map(x => { const due = H.data.tasks.some(t => t.pid === x.id && t.form === "vitals" && (t.state === "late" || t.state === "due"));
          return `<button type="button" data-bs-pick="${x.id}"><span class="bn">${E(H.bed(x.bed).no)}</span><b>${E(x.name)}</b><small>${H.ageText(x)} · ${due ? '<span style="color:var(--crit);font-weight:700">vital zamanı</span>' : "vital güncel"}</small></button>`; }).join("")}</div>`;
    }
    if (BS.step === 2 && p) main = BS.meas ? `<div class="box" style="text-align:center;padding:28px 14px"><div style="width:64px;height:64px;margin:0 auto 10px;color:var(--pri)">${I("activity")}</div><b style="font:700 18px 'Space Grotesk'">Ölçüm alınıyor…</b><div class="mute" style="font-size:13px">Portatif cihaz P-07 · NIBP manşonu şişiyor, SpO₂ ve ısı okunuyor</div><div class="nfBar" style="max-width:360px;margin:14px auto 0;height:8px"><i style="animation-duration:2s"></i></div></div>`
      : `<div class="bsBig"><button type="button" class="bsBtn p" data-bs="dev">${I("tablet")}<b>Portatif cihaz P-07 · bağlı</b><small>${I("wifi").replace("<svg ", '<svg style="width:14px;height:14px;vertical-align:-2px" ')} Kablosuz · pil %82 · son kalibrasyon 02.09 · dokununca ölçüm başlar</small></button>
          <button type="button" class="bsBtn" data-bs="manual">${I("edit")}<b>Elle gir</b><small>Cihaz yoksa ya da ölçüm başarısızsa</small></button></div>
          <div style="margin-top:12px"><button type="button" class="btn g" data-bs="back">${I("chevL")}Geri</button></div>`;
    if (BS.step === 3 && p) {
      const r = bsNews(p), resp = r && r.complete ? N2RESP[r.lvl] : null;
      const fld = ([k, l, u, inc, mn, mx, who]) => { const need = who === "nurse" || (BS.src === "manual"), edited = BS.dev[k] != null && String(BS.dev[k]) !== String(BS.v[k]);
        return `<div class="${who === "nurse" && N(BS.v[k]) == null ? "need" : ""}"><label>${l}<span>${who === "nurse" ? "hemşire girer" : BS.src === "dev" ? (edited ? "elle düzeltildi" : "cihaz") : "elle"}</span></label>
          <div class="step" data-bs-stf="${k}" data-inc="${inc}" data-min="${mn}" data-max="${mx}"><button type="button" data-bs-st="-1">−</button><input data-bs-f="${k}" inputmode="decimal" value="${E(BS.v[k] ?? "")}" placeholder="${E(String(p.v[k] ?? ""))}"><button type="button" data-bs-st="1">+</button><span class="u">${u}</span></div></div>`; };
      main = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">${BS.src === "dev" ? `<span class="nfSrc">${I("tablet")}Portatif cihaz P-07 · 21:44</span>` : `<span class="nfSrc">${I("edit")}Elle giriş · ${H.now()}</span>`}<span class="mute" style="font-size:12.5px">Değerler düzeltilebilir. Solunum ve bilinç cihazdan gelmez.</span></div>
        <div class="bsV">${BS_F.map(fld).join("")}
          <div class="${!BS.v.acvpu ? "need" : ""}"><label>Bilinç (ACVPU)<span>hemşire girer</span></label><div class="opts">${ACV.map(([k, l]) => `<i data-bs-acv="${k}" class="${BS.v.acvpu === k ? "on" : ""}">${l}</i>`).join("")}</div></div>
          <div><label>O₂ desteği</label><div class="opts">${["Oda havası", "Ek oksijen"].map(x => `<i data-bs-o2="${x}" class="${BS.v.o2 === x ? "on" : ""}">${x}</i>`).join("")}</div></div></div>
        ${r ? `<div class="box" style="margin-top:12px"><h5>Erken uyarı · NEWS2</h5><div class="bsNews"><span class="big" style="color:${r.complete ? lvlColor(r.lvl) : "var(--mute)"}">${r.complete ? r.total : "…"}</span>
            <div>${r.complete ? `<b>${resp[0] === "0" ? "Puan 0" : "NEWS2 " + resp[0]}</b><div style="color:var(--mute);font-size:13px">Protokole göre önerilen yanıt: <b style="color:var(--ink)">${resp[1]}</b></div>` : `<span class="mute">Solunum ve bilinç girilince hesaplanır.</span>`}</div></div>
            ${r.complete ? `<div class="flags" style="margin-top:8px">${Object.entries(r.pts).filter(([, v]) => v > 0).map(([k, v]) => `<span class="${v === 3 ? "c" : v === 2 ? "h" : "m"}">${{ rr:"Solunum", spo2:"SpO₂", o2:"O₂", sbp:"Sistolik", hr:"Nabız", loc:"Bilinç", temp:"Isı" }[k]} +${v}</span>`).join("") || "<span>Tüm parametreler 0</span>"}</div>` : ""}
            <div class="nfNote">Puan tablosu: <b>NEWS2 (RCP 2017)</b>${ADM("yanıt hastanenin onaylı protokolüne göredir")} · karar hekimindir.</div></div>`
          : p.ageGroup === "child" ? `<div class="note i" style="margin-top:12px">Çocukta NEWS2 kullanılmaz. PEWS için <a data-bs="pews" style="cursor:pointer;font-weight:700">Vital bulgular formunu</a> açın.</div>` : `<div class="note i" style="margin-top:12px">Yenidoğanda NEWS2 kullanılmaz.${ADM("Yenidoğan erken uyarı ölçeği hastanenin protokolüne göre eklenecek.", " ")}</div>`}
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button type="button" class="btn g lg" data-bs="back">${I("chevL")}Geri</button><button type="button" class="btn p lg" data-bs="save" style="flex:1;justify-content:center;min-width:200px">${I("ok")}Kaydet</button></div>`;
    }
    if (BS.step === 4 && p) main = `<div class="box bsOk"><div class="ic">${I("ok")}</div><b style="font:700 22px 'Space Grotesk'">Kaydedildi · ${BS.saved ? BS.saved.at : H.now()}</b>
        <div class="mute" style="margin:6px 0 16px">${E(BS.saved ? BS.saved.sum : "")}</div>
        <div class="bsBig" style="max-width:640px;margin:0 auto"><button type="button" class="bsBtn p" data-bs="next">${I("qr")}<b>Sıradaki hasta</b><small>Yeni bileklik okut</small></button>${H.can("patient") ? `<button type="button" class="bsBtn" data-bs="open">${I("user")}<b>Hasta ekranı</b><small>Trend ve ayrıntı</small></button>` : ""}</div></div>`;
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_bedside")} · portatif cihazla ölçüm</h2><p>Tablet ve telefon için · ${E(uname())}</p></div>${BS.step > 1 || p ? `<div class="r"><button type="button" class="btn g" data-bs="reset">${I("x")}Baştan başla</button></div>` : ""}</div>
      ${ADMBOX("Portatif cihazların sisteme bağlanması cihaz ekibinin işidir; burada yalnız ekran akışı tasarlanır.", "note i", "margin-bottom:14px")}
      ${stepper}${BS.step > 1 ? ptCard : ""}${main}`;

    const again = () => H.renderApp();
    root.addEventListener("click", (e) => {
      const pk = e.target.closest("[data-bs-pick]"); if (pk) { BS.pid = pk.dataset.bsPick; BS.idOk = false; return again(); }
      const acv = e.target.closest("[data-bs-acv]"); if (acv) { BS.v.acvpu = BS.v.acvpu === acv.dataset.bsAcv ? undefined : acv.dataset.bsAcv; return again(); }
      const o2 = e.target.closest("[data-bs-o2]"); if (o2) { BS.v.o2 = o2.dataset.bsO2; return again(); }
      const st = e.target.closest("[data-bs-st]"); if (st) { const w = st.closest("[data-bs-stf]"), k = w.dataset.bsStf, inc = +w.dataset.inc, cur = N(BS.v[k]) ?? N(p.v[k]) ?? 0;
        const v = Math.max(+w.dataset.min, Math.min(+w.dataset.max, cur + (N(BS.v[k]) == null ? 0 : +st.dataset.bsSt * inc))); BS.v[k] = inc < 1 ? v.toFixed(1).replace(".", ",") : String(Math.round(v)); return again(); }
      const b = e.target.closest("[data-bs]"); if (!b) return; const a = b.dataset.bs;
      if (a === "reset" || a === "next") { bsReset(); return again(); }
      // 25.09 · gerçek kamera ile okutma (tarayici.js). Kamera yoksa elle numara. Eski canlandırma yalnız H.scanner yüklenemezse.
      if (a === "scan" && H.scanner) return H.scanner.open((pt) => { BS.pid = pt.id; BS.idOk = false; BS.scanned = true; if (H.state.page === "bedside") again(); else H.go("bedside", {}); });
      if (a === "scan") { BS.scanning = true; again(); setTimeout(() => { BS.scanning = false; const mine = H.myPatients(); const due = mine.find(x => H.data.tasks.some(t => t.pid === x.id && t.form === "vitals" && (t.state === "late" || t.state === "due")));
        BS.pid = (due || mine[0] || {}).id || null; BS.idOk = false; if (!BS.pid) H.toast("Birimlerinizde hasta yok.", "w"); if (H.state.page === "bedside") again(); }, 1300); return; }
      if (a === "idok") { BS.idOk = true; BS.step = 2; H.log("yatak başı:kimlik doğrulandı", BS.pid); return again(); }
      if (a === "idno") { H.log("yatak başı:kimlik eşleşmedi", BS.pid); bsReset(); H.toast("Kimlik eşleşmedi; hasta seçimi iptal edildi. Bileklik kontrolü için sorumlu hemşireye bildirin.", "w"); return again(); }
      if (a === "back") { BS.step = Math.max(1, BS.step - 1); if (BS.step === 1) { BS.idOk = false; } return again(); }
      if (a === "manual") { BS.src = "manual"; BS.v = { o2:p.v.o2 === "Oda havası" ? "Oda havası" : "Ek oksijen" }; BS.dev = {}; BS.step = 3; return again(); }
      if (a === "dev") { BS.meas = true; again(); setTimeout(() => { BS.meas = false; const v = devVals(p, true); BS.dev = { ...v }; BS.v = { ...v, rr:"", o2:p.v.o2 === "Oda havası" ? "Oda havası" : "Ek oksijen" }; BS.src = "dev"; BS.step = 3;
        H.log("yatak başı:cihaz ölçümü P-07", BS.pid); if (H.state.page === "bedside") again(); }, 2000); return; }
      if (a === "pews") return H.forms.open("vitals", p.id);
      if (a === "open") return H.go("patient", { pid:p.id, tab:"ozet" });
      if (a === "save") { const miss = BS_F.filter(([k]) => N(BS.v[k]) == null).map(x => x[1]); if (p.ageGroup === "adult" && !BS.v.acvpu) miss.push("Bilinç");
        if (miss.length) return H.toast("Eksik: " + miss.join(", "), "e");
        const v = p.v, n = (k) => N(BS.v[k]); Object.assign(v, { hr:n("hr"), sbp:n("sbp"), dbp:n("dbp"), spo2:n("spo2"), rr:n("rr"), temp:n("temp") }); v.map = Math.round((v.sbp + 2 * v.dbp) / 3);
        if (BS.v.o2) v.o2 = BS.v.o2 === "Ek oksijen" ? (["CPAP", "HFNC", "NIV", "MV"].includes(v.o2) ? v.o2 : "Ek oksijen") : "Oda havası"; if (BS.v.acvpu) v.loc = ACV_TXT[BS.v.acvpu];
        const r = bsNews(p); let sum = `Nb ${v.hr} · KB ${v.sbp}/${v.dbp} · SpO₂ ${v.spo2} · SS ${v.rr} · ${f1(v.temp)}°C`; if (r && r.complete) { p.news2 = r.total; sum += ` · NEWS2 ${r.total}` + applyNews2Risk(p, r); }
        const src = BS.src === "dev" ? "Portatif cihaz P-07 · 21:44" : "Elle";
        NS.records.push({ key:"vitals", pid:p.id, date:TODAY, at:H.now(), user:H.state.user ? H.state.user.u : "—", d:{ ...BS.v, source:src, edited:Object.keys(BS.dev).filter(k => String(BS.dev[k]) !== String(BS.v[k])) }, summary:sum });
        doneTask(p.id, t => t.form === "vitals"); H.log("form:vitals", p.id);
        BS.saved = { at:H.now(), sum:`${sum} · kaynak: ${src}` }; BS.step = 4; H.toast("Vital bulgular kaydedildi · " + p.name); return again(); }
    });
    root.addEventListener("input", (e) => { const f = e.target.dataset && e.target.dataset.bsF; if (f) { BS.v[f] = e.target.value; } });
    root.addEventListener("change", (e) => { const f = e.target.dataset && e.target.dataset.bsF; if (f) again(); });
  } });
})();

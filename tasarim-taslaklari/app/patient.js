/* Homunculus prototip v1 — hasta ekranı (patient.js).
 * Dışa verir: H.patientHeader(p), H.register('patient', …).
 * Sekmeler: ozet · trend · skor · takip · ilac · sivi · sonuc · devir.
 * Veri SENTETİKTİR. Sistem tanı koymaz, emir vermez, doz önermez; ilaç satırları HBYS order'ının gösterimidir. */
(function () {
  const H = window.H;
  const esc = (s) => H.esc(s);
  const NOW = 21.7;                         // H.now() = 21:42
  const TODAY = H.DAY0.getDate();           // demo günü core.js'ten (24.09.2026)
  const r1 = (v, d = 0) => +(+v).toFixed(d);
  const clk = (h) => { h = ((h % 24) + 24) % 24; let a = Math.floor(h), m = Math.round((h - a) * 60); if (m === 60) { a = (a + 1) % 24; m = 0; } return `${String(a).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };
  const dayOf = (t) => TODAY + Math.floor((NOW + t) / 24);          // t: şimdiye göre saat
  const stamp = (t) => `${String(dayOf(t)).padStart(2, "0")}.09 ${clk(NOW + t)}`;
  const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
  const seedOf = (str) => { let h = 7; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 2147483000; return h || 11; };
  const unitOf = (p) => H.unit(H.bed(p.bed).unitId);
  const isIcuAdult = (p) => p.ageGroup === "adult" && unitOf(p).type === "icu";
  const me = () => (H.state.user ? H.state.user.name : "—");
  // 30.09 · kontrol §4-6: sabit saat yerine son gerçek kayıt (core.js H.lastEntry: form kaydı, yoksa tamamlanan iş)
  const lastTxt = (pid, key, fb = "—") => { const e = H.lastEntry && H.lastEntry(pid, key); return e ? H.entryText(e) : fb; };
  const cssIn = (el, n) => getComputedStyle(el).getPropertyValue(n).trim() || H.cssVar(n);

  /* ================= stil (yalnız bu modülün sınıfları; renkler değişkenden) ================= */
  const CSS = `
.pt-h{display:flex;gap:10px 14px;align-items:flex-start;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--r);border-radius:14px;padding:10px 14px}
.pt-h .bn{font:700 26px/1 "JetBrains Mono";color:var(--r);padding-top:2px}
.pt-h .md{flex:1 1 260px;min-width:0}
.pt-h .nm{font:700 20px/1.2 "Space Grotesk";display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.pt-h .mt{font-size:12.5px;color:var(--mute);margin-top:2px}
.pt-h .mt b{color:var(--ink);font-weight:600}
.pt-h .tg{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}
.pt-h .rt{display:flex;flex-direction:column;align-items:flex-end;gap:5px;margin-left:auto}
.pt-h .rt .sc{font:700 12px "JetBrains Mono";color:var(--mute)}
.pt-h .rhn{color:var(--crit);font-weight:700}
.pt-bar{display:flex;align-items:center;gap:8px;margin:10px 0 0;flex-wrap:wrap}
.pt-bar .src{font-size:12px;color:var(--mute);margin-right:auto}
.pt-dd{position:relative}
.pt-dd .menu{position:absolute;right:0;top:calc(100% + 4px);max-height:360px;overflow:auto}
.pt-wrap .mon{margin-top:10px}
.pt-wrap .mon .wv{justify-content:space-evenly}
.pt-wrap .mon canvas{height:64px}
.pt-wrap .mon .nu{padding:4px 12px}
.pt-wrap .mon .nu b{font-size:25px}
.pt-so .bdg svg{width:11px;height:11px;flex:none}
.pt-h .tag svg,.pt-wrap .pill svg{width:12px;height:12px}
.pt-wrap .seg button svg,.modal .seg button svg{width:14px;height:14px;vertical-align:-2px;margin-right:4px}
.pt-vb{margin-top:10px}
.pt-vb .ln{display:flex;gap:8px 14px;align-items:center;flex-wrap:wrap;font-size:12.5px;color:var(--mute);margin-top:8px}
.pt-vb .ln b{color:var(--ink)}
.pt-vb .ln .btn{margin-left:auto}
.pt-reco{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--crit);border-radius:12px;padding:12px 14px}
.pt-reco.h{border-left-color:var(--high)}
.pt-reco h4{margin:0 0 2px;font:700 16px "Space Grotesk"}
.pt-reco ul{margin:8px 0;padding-left:18px;color:var(--mute);font-size:13px}
.pt-reco .src{font-size:11.5px;color:var(--mute);margin-bottom:10px}
.pt-reco .done{font-size:12.5px;color:var(--ok);font-weight:700}
.pt-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pt-sm{display:grid;grid-template-columns:88px 1fr;gap:10px;align-items:center;padding:4px 4px;border-bottom:1px solid var(--line);cursor:pointer;border-radius:8px}
.pt-sm:hover{background:var(--card2)} .pt-sm:last-of-type{border-bottom:0}
.pt-sm small{display:block;font:700 10.5px Figtree}
.pt-sm b{font:700 20px/1 "JetBrains Mono"} .pt-sm i{font:600 10px Figtree;font-style:normal;color:var(--mute);margin-left:3px}
.pt-sm svg{width:100%;display:block}
.pt-leg{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:12px;color:var(--mute);margin-top:8px}
.pt-leg i{width:14px;height:8px;border-radius:2px;display:inline-block;margin-right:5px;vertical-align:middle}
.pt-risk{display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:center;padding:8px 0;border-bottom:1px dashed var(--line)}
.pt-risk:last-child{border-bottom:0}
.pt-risk small{grid-column:1;color:var(--mute);font-size:11.5px}
.pt-risk .btn{grid-row:span 2;grid-column:2}
.pt-lv{font:700 11px Figtree;padding:2px 7px;border-radius:6px;margin-left:6px;background:var(--card2);color:var(--mute)}
.pt-lv.c{color:var(--crit);background:var(--critSoft)} .pt-lv.w{color:var(--attInk);background:var(--att)} .pt-lv.o{color:var(--ok)}
.pt-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.pt-vc{cursor:pointer;background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:7px 11px;min-width:96px}
.pt-vc.on{border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 18%,transparent)}
.pt-vc small{display:block;font:700 10.5px Figtree;color:var(--c)} .pt-vc b{font:700 20px/1.1 "JetBrains Mono"} .pt-vc i{font:600 11px Figtree;font-style:normal;margin-left:4px;color:var(--mute)}
.pt-hov{font:600 12px "JetBrains Mono";color:var(--mute);min-height:18px}
.pt-hov b{color:var(--ink)}
.pt-sofa{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.pt-so{background:var(--card2);border-radius:10px;padding:8px 10px;position:relative;font-size:12px;min-width:0}
.pt-so>span{color:var(--mute);font-weight:600;display:block}
.pt-so>b{display:block;font:700 13px "JetBrains Mono";margin:3px 0 3px}
.pt-so .bdg{display:inline-flex;gap:4px;align-items:center;font:700 10px Figtree;color:var(--pri);background:var(--priSoft);border-radius:6px;padding:2px 6px}
.pt-so em{position:absolute;top:6px;right:8px;font:700 17px "Space Grotesk";font-style:normal;color:var(--pri)}
.pt-so.need{border:1.5px dashed var(--attLine);background:var(--att)} .pt-so.need>b{font-family:Figtree;color:var(--attInk);font-size:12px}
.pt-pick{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.pt-pick i{font:700 11px Figtree;font-style:normal;padding:4px 7px;border-radius:6px;border:1px solid var(--line2);cursor:pointer;background:var(--card)}
.pt-pick i.on{background:var(--pri);color:var(--onpri);border-color:transparent}
.pt-tot{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px}
.pt-signed{color:var(--ok);font-weight:700;font-size:13px}
.pt-ap{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1.3fr) 34px;gap:6px 10px;align-items:center;font-size:12.5px;padding:6px 0;border-bottom:1px dashed var(--line)}
.pt-ap .v{font:700 12.5px "JetBrains Mono"} .pt-ap .s{color:var(--mute);font-size:11.5px} .pt-ap .p{font:700 15px "Space Grotesk";color:var(--pri);text-align:right}
.pt-ap.need{background:var(--att);border-radius:8px;padding:6px 8px;border:1px dashed var(--attLine)}
.pt-ap .opts{grid-column:span 2}
.pt-gw{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--card)}
.pt-grid{border-collapse:separate;border-spacing:0;font-size:12px;min-width:100%}
.pt-grid th,.pt-grid td{border-bottom:1px solid var(--line);border-right:1px solid var(--line);height:34px;min-width:36px;text-align:center;padding:0}
.pt-grid th{font:700 10.5px "JetBrains Mono";color:var(--mute);background:var(--card2);position:sticky;top:0}
.pt-grid .lb{position:sticky;left:0;z-index:2;background:var(--card);text-align:left;padding:4px 10px;min-width:150px;max-width:190px;font:600 12px Figtree;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pt-grid th.lb{background:var(--card2);z-index:3}
.pt-grid .lb small{display:block;font:600 10px Figtree;color:var(--mute)}
.pt-grid tr.gh td{background:var(--card2);font:700 10px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);text-align:left;padding:0 10px;height:24px}
.pt-grid tr.gh td.lb{background:var(--card2)}
.pt-grid .nowc{position:relative}
.pt-grid .nowc::after{content:"";position:absolute;top:0;bottom:0;left:70%;width:2px;background:var(--crit);opacity:.8;pointer-events:none}
.pt-grid th.nowc{color:var(--crit)}
.pt-c{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:7px;cursor:pointer}
.pt-c svg{width:14px;height:14px}
.pt-c.done{color:var(--ok);background:color-mix(in srgb,var(--ok) 14%,transparent)}
.pt-c.late{color:#fff;background:var(--crit)}
.pt-c.due{color:var(--onpri);background:var(--pri);animation:ptBlink 1.4s infinite}
.pt-c.plan{border:1.5px dashed var(--line2)}
.pt-c.no{color:var(--mute);background:var(--card2)}
@keyframes ptBlink{50%{opacity:.35}}
.pt-mar{display:flex;gap:5px;flex-wrap:wrap}
.pt-dose{display:inline-flex;align-items:center;gap:4px;font:700 11px "JetBrains Mono";padding:4px 7px;border-radius:7px;cursor:pointer;border:1px solid transparent}
.pt-dose.done{color:var(--ok);background:color-mix(in srgb,var(--ok) 14%,transparent)}
.pt-dose.late{color:var(--crit);background:var(--critSoft);border-color:color-mix(in srgb,var(--crit) 45%,transparent)}
.pt-dose.due{background:var(--pri);color:var(--onpri);animation:ptBlink 1.6s infinite}
.pt-dose.plan{border:1px dashed var(--line2);color:var(--mute)}
.pt-dose.no{color:var(--mute);background:var(--card2);text-decoration:line-through}
.pt-med{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;padding:10px 0;border-bottom:1px solid var(--line)}
.pt-med:last-child{border-bottom:0}
.pt-med b{font-size:14px} .pt-med .f{color:var(--mute);font-size:12px}
.pt-med .pt-mar{grid-column:1 / -1}
.pt-tl{display:flex;margin:8px 0 4px}
.pt-tl span{flex:1;text-align:center;font:700 10.5px Figtree;padding:6px 2px;background:var(--card2);color:var(--mute);min-width:0}
.pt-tl span small{display:block;font:600 10px "JetBrains Mono";opacity:.85}
.pt-tl span:first-child{border-radius:8px 0 0 8px} .pt-tl span:last-child{border-radius:0 8px 8px 0}
.pt-tl span.done{background:var(--priSoft);color:var(--pri)} .pt-tl span.now{background:var(--pri);color:var(--onpri)}
.pt-flag{font:700 12px "JetBrains Mono"} .pt-flag.h{color:var(--high)} .pt-flag.l{color:var(--low)} .pt-flag.c{color:var(--crit)}
.pt-new{font:700 9.5px Figtree;background:var(--mid);color:#1b1400;border-radius:999px;padding:1px 6px;margin-left:6px}
.pt-lab td .spark{width:90px;height:22px}
.pt-rep{background:var(--card2);border-radius:10px;padding:10px 12px;font-size:13px;margin:6px 0}
.pt-io svg{width:100%;display:block}
.pt-dv textarea{min-height:92px}
.pt-dv .lab{font:700 11px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:10px 0 4px;display:block}
.pt-lock{background:var(--critSoft);border:1px solid color-mix(in srgb,var(--crit) 45%,transparent);color:var(--crit);border-radius:10px;padding:8px 10px;font:600 12.5px Figtree;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pt-lock svg{width:16px;height:16px}
.pt-big{width:100%;display:block}
.pt-dev{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:6px}
.pt-dev .lb{font:700 10.5px Figtree;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin-right:2px}
.pt-dev .tag b{font:700 11.5px Figtree;color:var(--ink);margin-left:4px}
.pt-dev .tag svg{width:12px;height:12px}
.pt-dev .tag{white-space:normal;max-width:100%}
.pt-cb h5,.pt-po h5{flex-wrap:wrap}
.pt-rg td{height:40px;min-width:78px;padding:3px 4px;vertical-align:middle}
.pt-rg th{padding:0 6px}
.pt-rc{display:inline-flex;gap:3px;align-items:center;padding:4px 6px;margin:1px;border-radius:7px;cursor:pointer;border:1px solid var(--line2);background:var(--card);color:var(--ink);font:700 10.5px "JetBrains Mono";white-space:nowrap}
.pt-rc svg{width:12px;height:12px}
.pt-rc em{font-style:normal;color:var(--crit);font-size:10px}
.pt-rc.un{border-color:color-mix(in srgb,var(--crit) 55%,transparent);color:var(--crit);background:var(--critSoft)}
.pt-rc.wt{border-style:dashed;color:var(--mute)}
.pt-rc.on{box-shadow:0 0 0 2px var(--pri)}
.pt-rxc{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:8px}
.pt-rxc.one{grid-template-columns:minmax(0,1fr)}
.pt-rxc .lb{font:700 10.5px Figtree;color:var(--mute);text-transform:uppercase;letter-spacing:.06em}
.pt-rep.prev{background:transparent;border:1px dashed var(--line2)}
.pt-rep{overflow-wrap:anywhere}
.pt-who{font-size:12px;color:var(--mute);margin-top:8px;display:flex;flex-direction:column;gap:3px}
.pt-who b{color:var(--ink)}
.pt-cs{padding:9px 0;border-bottom:1px dashed var(--line)}
.pt-cs:last-of-type{border-bottom:0}
.pt-cs .hd{display:flex;gap:4px 8px;align-items:center;flex-wrap:wrap}
.pt-cs .hd b{font-size:13.5px}
.pt-cs .pt-lv{margin-left:0}
.pt-st{display:flex;flex-wrap:wrap;gap:4px 0;align-items:center;margin-top:6px;font-size:11.5px}
.pt-st .s{background:var(--card2);border-radius:8px;padding:4px 8px;color:var(--mute);font-weight:600}
.pt-st .s b{display:block;font:700 11.5px "JetBrains Mono";color:var(--ink)}
.pt-st .s.done{background:var(--priSoft);color:var(--pri)}
.pt-st .s.wait{background:var(--att);color:var(--attInk);border:1px dashed var(--attLine)}
.pt-st .d{font:700 10.5px "JetBrains Mono";color:var(--mute);padding:0 5px}
.pt-po{border-left:4px solid var(--pri)}
.pt-po .pt-pot{display:flex;gap:10px 18px;flex-wrap:wrap;align-items:flex-end}
.pt-po .big{font:700 28px/1.1 "Space Grotesk"}
.pt-po .bar{height:6px;border-radius:99px;background:var(--card2);overflow:hidden;margin-top:6px}
.pt-po .bar em{display:block;height:100%;background:var(--pri)}
.pt-pv{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:6px}
.pt-pv>div{background:var(--card2);border-radius:10px;padding:7px 9px;min-width:0}
.pt-pv small{display:block;font:700 10.5px Figtree}
.pt-pv b{font:700 13px "JetBrains Mono"}
.pt-pv .spark{width:100%;height:22px;display:block;margin-top:3px}
.pt-po .g3x{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:12px}
.pt-po .g3x>div{min-width:0}
.pt-hb{display:flex;align-items:flex-end;gap:2px;height:46px;margin-top:6px;border-bottom:1px solid var(--line)}
.pt-hb i{flex:1;background:var(--pri);border-radius:2px 2px 0 0;min-width:2px;opacity:.85}
.pt-hb.d i{background:var(--mid)}
.pt-pn{display:flex;gap:5px;flex-wrap:wrap;margin-top:4px}
.pt-pn span{font:700 11px "JetBrains Mono";background:var(--card2);border-radius:6px;padding:3px 6px;color:var(--mute)}
.pt-pn span b{font-size:13px;margin-left:4px;color:var(--ink)}
.pt-fm{padding:9px 0;border-bottom:1px dashed var(--line)}
.pt-fm:last-of-type{border-bottom:0}
.pt-fm .hd{display:flex;gap:4px 8px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--mute)}
.pt-fm .hd b{color:var(--ink)}
.pt-fm p{margin:6px 0;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}
.pt-fm .sl{font:700 11.5px Figtree;color:var(--ok);display:inline-flex;gap:5px;align-items:center}
.pt-fm .sl svg{width:12px;height:12px}
@media (max-width:1100px){.pt-pv{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:860px){.pt-po .g3x{grid-template-columns:minmax(0,1fr)}}
@media (max-width:640px){.pt-rxc{grid-template-columns:minmax(0,1fr)}.pt-pv{grid-template-columns:1fr 1fr}.pt-po .big{font-size:24px}}
@media (max-width:860px){.pt-sofa{grid-template-columns:1fr 1fr}.pt-ap{grid-template-columns:minmax(0,1fr) auto 34px}.pt-ap .s{grid-column:1 / -1;grid-row:2}.pt-ap .opts{grid-column:1 / -1}}
@media (max-width:640px){.pt-sofa{grid-template-columns:1fr}.pt-h .rt{align-items:flex-start;margin-left:0}.pt-sm{grid-template-columns:76px 1fr}}
`;
  const ensureCss = () => { if (document.getElementById("pt-css")) return; const s = document.createElement("style"); s.id = "pt-css"; s.textContent = CSS; document.head.appendChild(s); };

  /* ================= modül içi durum (hasta başına) ================= */
  const STS = {};
  const S = (pid) => STS[pid] || (STS[pid] = { trendKey:"hr", trendH:24, cmp:"", resTab:"lab", labView:"graf", seen:{}, sofaGcs:null, sofaSigned:null, apGcs:null, apChronic:null, apSigned:null, reco:null, doses:null, devir:null, patoNotify:true });

  /* ================= başlık ================= */
  // Hasta no kişiye, protokol yatışa ait (#77). Kayıttan gelen hastada numaralar hastane kaydından okunur; burada kimliğe bağlı sabit üretilir.
  const idNum = (p) => +String(p.id).replace(/\D/g, "") || 1;
  const hnOf = (p) => p.hn || "HN-" + String(250000 + idNum(p) * 137).padStart(7, "0");
  const protoOf = (p) => "2026-" + String(103900 + idNum(p) * 29);
  H.hnOf = hnOf; H.protoOf = protoOf;   // bileklik okutma (tarayici.js) ve yatak başı kimlik kartı aynı numarayı kullanır
  H.patientHeader = (p) => {
    const bed = H.bed(p.bed), u = unitOf(p), sev = H.SEV[p.risk] || H.SEV.stable;
    const bsa = Math.sqrt(p.height * p.weight / 3600);
    const bmi = p.weight / Math.pow(p.height / 100, 2);
    const rhNeg = /Rh\(-\)/.test(p.blood);
    const wt = p.ageGroup === "neonate" ? `${Math.round(p.weight * 1000)} g` : `${p.weight} kg`;
    const att = H.userBy(p.attending), nur = H.userBy(p.nurse);
    const body = `${wt} · ${p.height} cm${p.ageGroup !== "neonate" ? ` · VKİ ${r1(bmi, 1)}` : ""} · VYA ${r1(bsa, 2)} m²`;
    return `<div class="pt-h" style="--r:${sev.c}">
      <span class="bn">${esc(bed.no)}</span>
      <div class="md">
        <div class="nm">${esc(pname(p))}</div>
        <div class="mt">${H.ageText(p)} · ${p.sex === "E" ? "Erkek" : "Kadın"} · <span class="${rhNeg ? "rhn" : ""}">${esc(p.blood)}</span> · ${body}</div>
        <div class="mt k dx"><b>${esc(p.dx)}</b> <span class="mono">${esc(p.icd)}</span> · ${esc(u.tr)} · Yatış: ${p.admitDays}. gün${p.antibioticDay ? ` · <b>Antibiyotik: ${p.antibioticDay}. gün</b>` : ""}</div>
        <div class="tg k">${p.allergies.map(a => `<span class="tag c k">${H.icon("alert")}Alerji: ${esc(a)}</span>`).join("")}${p.allergies.length ? "" : `<span class="tag k">Bilinen alerji yok</span>`}
          ${p.chronic.map(c => `<span class="tag w">${esc(c)}</span>`).join("")}
          ${p.isolation ? `<span class="tag w k">${H.icon("shield")}İzolasyon: ${esc(p.isolation)}</span>` : ""}
          <span class="tag">Kod: ${esc(p.codeStatus)}</span>
          ${p.ageGroup === "neonate" && p.gestWeeks ? `<span class="tag">${p.gestWeeks} hf · DA ${p.birthWeight} g</span>` : ""}</div>
        ${devRow(p)}
        <div class="mt">Hekim: <b>${esc(att ? att.name : "—")}</b> · Hemşire: <b>${esc(nur ? nur.name : "—")}</b> · Hasta no <b class="mono">${esc(hnOf(p))}</b> · Protokol <b class="mono">${esc(p.proto || protoOf(p))}</b>${p.temp ? ` <span class="tag w">GEÇİCİ</span>` : ""}</div>
      </div>
      <div class="rt">${H.sevPill(p.risk)}<span class="sc">${esc(H.scoreLabel(p))}</span></div>
    </div>`;
  };

  /* ================= laboratuvar (sentetik, hastanın durumuyla tutarlı) ================= */
  const LABDEF = [
    { k:"lac",  n:"Laktat",     u:"mmol/L",   ref:[0.5, 2.0], crit:[null, 4], d:1 },
    { k:"cre",  n:"Kreatinin",  u:"mg/dL",    ref:[0.6, 1.2], d:2 },
    { k:"k",    n:"Potasyum",   u:"mmol/L",   ref:[3.5, 5.1], crit:[2.8, 6.0], d:1 },
    { k:"na",   n:"Sodyum",     u:"mmol/L",   ref:[136, 145], crit:[120, 160], d:0 },
    { k:"crp",  n:"CRP",        u:"mg/L",     ref:[0, 5], d:0 },
    { k:"hb",   n:"Hemoglobin", u:"g/dL",     ref:[12, 16], crit:[7, null], d:1 },
    { k:"plt",  n:"Trombosit",  u:"×10³/µL",  ref:[150, 400], crit:[50, null], d:0 },
    { k:"aptt", n:"aPTT",       u:"sn",       ref:[25, 35], crit:[null, 100], d:1 },
    { k:"glu",  n:"Glukoz",     u:"mg/dL",    ref:[70, 110], crit:[50, 400], d:0 },
    { k:"bil",  n:"Total bilirubin", u:"mg/dL", ref:[0.3, 1.2], d:1, only:["p14"] },
  ];
  const refFor = (p, def) => {
    if (p.ageGroup === "neonate") return ({ cre:[0.3, 1.0], hb:[13.5, 21.5], glu:[50, 110], bil:[1, 12], aptt:[30, 50] })[def.k] || def.ref;
    if (p.ageGroup === "child") return ({ cre:[0.3, 0.7], hb:[11.5, 15.5] })[def.k] || def.ref;
    if (def.k === "hb") return p.sex === "E" ? [13.5, 17.5] : [12, 15.5];
    return def.ref;
  };
  // son değerler + skorlarda kullanılan ek değerler (bil, pf, ph, pao2, hct, wbc)
  const PV = {
    p1:{ lac:4.1, cre:1.9, k:4.9, na:138, crp:212, hb:11.2, plt:96, aptt:41.2, glu:168, bili:1.4, pf:210, ph:7.31, pao2:68, hct:34, wbc:17.4 },
    p2:{ lac:2.3, cre:1.4, k:4.4, na:141, crp:96, hb:13.1, plt:210, aptt:31, glu:212, bili:1.3, pf:185, ph:7.30, pao2:58, hct:40, wbc:13.2 },
    p3:{ lac:1.6, cre:3.1, k:5.8, na:134, crp:18, hb:10.9, plt:140, aptt:33, glu:118, bili:0.8, pf:320, ph:7.29, pao2:84, hct:33, wbc:9.8 },
    p4:{ lac:1.3, cre:0.8, k:4.0, na:139, crp:64, hb:11.6, plt:232, aptt:29, glu:132, bili:0.7, pf:380, ph:7.39, pao2:92, hct:35, wbc:11.1 },
    p5:{ lac:1.1, cre:1.2, k:4.2, na:140, crp:7, hb:14.2, plt:245, aptt:34, glu:124, bili:0.6, pf:350, ph:7.41, pao2:88, hct:42, wbc:9.4 },
    p6:{ lac:2.4, cre:1.5, k:3.4, na:132, crp:148, hb:11.8, plt:188, aptt:30, glu:104 },
    p7:{ lac:1.4, cre:1.6, k:3.6, na:133, crp:12, hb:12.4, plt:201, aptt:32, glu:110 },
    p8:{ lac:1.8, cre:0.9, k:4.6, na:134, crp:6, hb:13.6, plt:280, aptt:28, glu:286 },
    p9:{ lac:1.9, cre:1.1, k:4.1, na:137, crp:124, hb:13.2, plt:219, aptt:30, glu:121 },
    p10:{ lac:1.0, cre:0.7, k:4.0, na:140, crp:22, hb:12.8, plt:260, aptt:28, glu:98 },
    p11:{ lac:1.5, cre:0.4, k:4.3, na:138, crp:34, hb:12.1, plt:310, aptt:32, glu:96 },
    p12:{ lac:1.9, cre:0.6, k:3.3, na:133, crp:8, hb:12.6, plt:290, aptt:31, glu:72 },
    p13:{ lac:2.6, cre:0.9, k:5.2, na:134, crp:14, hb:13.2, plt:118, aptt:48, glu:58 },
    p14:{ lac:1.2, cre:0.6, k:4.8, na:139, crp:2, hb:17.9, plt:240, aptt:38, glu:72, bil:16.8 },
  };
  const PREV = { p1:{ lac:2.2 } };
  const pv = (p) => PV[p.id] || PV.p5;
  const labDefs = (p) => LABDEF.filter(d => (!d.only || d.only.includes(p.id)) && pv(p)[d.k] != null);
  const flagOf = (p, def, v) => {
    const ref = refFor(p, def), c = def.crit || [];
    const crit = (c[0] != null && v <= c[0]) || (c[1] != null && v >= c[1]);
    if (v > ref[1]) return { f:crit ? "↑↑" : "↑", cls:crit ? "c" : "h", hl:"H", crit };
    if (v < ref[0]) return { f:crit ? "↓↓" : "↓", cls:crit ? "c" : "l", hl:"L", crit };
    return { f:"", cls:"", hl:"", crit:false };
  };
  const labCache = {};
  const labHist = (p, def) => {
    const key = p.id + def.k; if (labCache[key]) return labCache[key];
    const cur = pv(p)[def.k], ref = refFor(p, def), rnd = seeded(seedOf(key));
    const days = Math.min(7, Math.max(1, p.admitDays)), ts = [];
    for (let dd = -(days - 1); dd <= 0; dd++) ts.push(dd * 24 + 6.17 - NOW);
    if (ts.length < 2) ts.push(14.17 - NOW);                       // ilk gün: 06:10 + 14:10
    if (def.k === "lac" && (p.risk === "crit" || p.risk === "high")) ts.push(15.5 - NOW, 21.5 - NOW);
    if (p.id === "p3" && def.k === "k") ts.push(21.17 - NOW);
    ts.sort((a, b) => a - b);
    const start = cur > ref[1] ? Math.max(ref[1] * 0.9, cur * 0.55) : cur < ref[0] ? Math.min(ref[0] * 1.05, cur * 1.25) : cur * (1 + (rnd() - .5) * .08);
    const n = ts.length;
    const out = ts.map((t, i) => { const f = n === 1 ? 1 : i / (n - 1); const v = i === n - 1 ? cur : start + (cur - start) * Math.pow(f, 1.4) + (rnd() - .5) * Math.abs(cur - start) * .12; return { t, v:r1(Math.max(0, v), def.d) }; });
    if (PREV[p.id] && PREV[p.id][def.k] != null && n > 1) out[n - 2].v = PREV[p.id][def.k];
    return (labCache[key] = out);
  };
  // yeni (görülmemiş) sonuç: bugün 18:00'den sonra gelenler; önceden görülenler
  const PRESEEN = { p3:{ k:{ by:"hs.sevda", at:"21:30" } } };
  const seenOf = (p, def) => { const st = S(p.id); if (st.seen[def.k]) return st.seen[def.k]; if (PRESEEN[p.id] && PRESEEN[p.id][def.k]) { const s = PRESEEN[p.id][def.k]; return { by:H.userBy(s.by).name, at:s.at }; }
    const h = labHist(p, def), last = h[h.length - 1]; if (NOW + last.t >= 18) return null; return { by:H.userBy(p.attending).name, at:clk(NOW + last.t + 1.1) }; };
  const unseenLabs = (p) => labDefs(p).filter(d => !seenOf(p, d));

  /* ================= skor tabloları (standart sürümler) ================= */
  // SOFA (Vincent 1996)
  const SOFA = {
    resp:(pf, sup) => pf < 100 && sup ? 4 : pf < 200 && sup ? 3 : pf < 300 ? 2 : pf < 400 ? 1 : 0,
    coag:(x) => x < 20 ? 4 : x < 50 ? 3 : x < 100 ? 2 : x < 150 ? 1 : 0,
    liver:(b) => b >= 12 ? 4 : b >= 6 ? 3 : b >= 2 ? 2 : b >= 1.2 ? 1 : 0,
    cardio:(map, ne) => ne > 0.1 ? 4 : ne > 0 ? 3 : map < 70 ? 1 : 0,
    renal:(c) => c >= 5 ? 4 : c >= 3.5 ? 3 : c >= 2 ? 2 : c >= 1.2 ? 1 : 0,
  };
  const SOFA_GCS = [["15", 0], ["13–14", 1], ["10–12", 2], ["6–9", 3], ["<6", 4]];
  // APACHE II (Knaus 1985) — akut fizyoloji puanları
  const AP = {
    temp:(v) => v >= 41 ? 4 : v >= 39 ? 3 : v >= 38.5 ? 1 : v >= 36 ? 0 : v >= 34 ? 1 : v >= 32 ? 2 : v >= 30 ? 3 : 4,
    map:(v) => v >= 160 ? 4 : v >= 130 ? 3 : v >= 110 ? 2 : v >= 70 ? 0 : v >= 50 ? 2 : 4,
    hr:(v) => v >= 180 ? 4 : v >= 140 ? 3 : v >= 110 ? 2 : v >= 70 ? 0 : v >= 55 ? 2 : v >= 40 ? 3 : 4,
    rr:(v) => v >= 50 ? 4 : v >= 35 ? 3 : v >= 25 ? 1 : v >= 12 ? 0 : v >= 10 ? 1 : v >= 6 ? 2 : 4,
    pao2:(v) => v > 70 ? 0 : v >= 61 ? 1 : v >= 55 ? 3 : 4,
    ph:(v) => v >= 7.7 ? 4 : v >= 7.6 ? 3 : v >= 7.5 ? 1 : v >= 7.33 ? 0 : v >= 7.25 ? 2 : v >= 7.15 ? 3 : 4,
    na:(v) => v >= 180 ? 4 : v >= 160 ? 3 : v >= 155 ? 2 : v >= 150 ? 1 : v >= 130 ? 0 : v >= 120 ? 2 : v >= 111 ? 3 : 4,
    k:(v) => v >= 7 ? 4 : v >= 6 ? 3 : v >= 5.5 ? 1 : v >= 3.5 ? 0 : v >= 3 ? 1 : v >= 2.5 ? 2 : 4,
    cre:(v) => v >= 3.5 ? 4 : v >= 2 ? 3 : v >= 1.5 ? 2 : v >= 0.6 ? 0 : 2,
    hct:(v) => v >= 60 ? 4 : v >= 50 ? 2 : v >= 46 ? 1 : v >= 30 ? 0 : v >= 20 ? 2 : 4,
    wbc:(v) => v >= 40 ? 4 : v >= 20 ? 2 : v >= 15 ? 1 : v >= 3 ? 0 : v >= 1 ? 2 : 4,
    age:(a) => a >= 75 ? 6 : a >= 65 ? 5 : a >= 55 ? 3 : a >= 45 ? 2 : 0,
  };
  const AP_CHRONIC = [["Yok", 0], ["Var · ameliyatsız ya da acil ameliyat", 5], ["Var · planlı ameliyat sonrası", 2]];

  /* ================= ilaçlar (HBYS order'ı · Mod 1) ================= */
  const medsFor = (p) => {
    const L = [], icuA = isIcuAdult(p);
    const abx = H.data.tasks.find(t => t.pid === p.id && t.kind === "med" && !t.med);
    if (abx) L.push({ id:"abx", name:abx.label, freq:"8 saatte bir · 14:00 · 22:00 · 06:00", kind:"task", start:`${TODAY - p.antibioticDay + 1}.09` });
    if (p.risk === "crit" && p.ageGroup === "adult") L.push({ id:"ne", name:"Noradrenalin 4 mg / 50 mL", freq:"sürekli infüzyon · 0.08 µg/kg/dk (pompa)", kind:"inf", since:"20:25", src:"Pompa · canlı", start:`${TODAY}.09` });
    if (icuA) L.push({ id:"ppi", name:"Pantoprazol 40 mg IV", freq:"24 saatte bir", times:[30] });
    if (p.ageGroup === "adult" && p.v.temp >= 38) L.push({ id:"pcm", name:"Parasetamol 1 g IV", freq:"gerekirse · en az 6 saat ara", kind:"prn", last:"18:00" });
    if (p.chronic.includes("Diabetes mellitus")) L.push({ id:"ins", name:"Hızlı etkili insülin SC", freq:"kan şekerine göre · order'daki skala", kind:"prn", last:"17:05" });
    if (p.chronic.includes("KOAH")) L.push({ id:"neb", name:"Salbutamol + ipratropium nebül", freq:"6 saatte bir", times:[12, 18, 24, 30] });
    if (p.icd.startsWith("I50")) L.push({ id:"fur", name:"Furosemid 40 mg IV", freq:"12 saatte bir", times:[10, 22] });
    if (p.icd.startsWith("I21")) L.push({ id:"asa", name:"Asetilsalisilik asit 100 mg PO", freq:"24 saatte bir", times:[10] }, { id:"enx", name:"Enoksaparin 80 mg SC", freq:"12 saatte bir", times:[10, 22] });
    if (p.id === "p10") L.push({ id:"pcm8", name:"Parasetamol 1 g IV", freq:"8 saatte bir", times:[14, 22, 30] });
    if (p.id === "p11") L.push({ id:"salb", name:"Salbutamol nebül", freq:"4 saatte bir", times:[10, 14, 18, 22, 26, 30] }, { id:"pcmc", name:"Parasetamol şurup PO", freq:"gerekirse · order'daki doz", kind:"prn", last:"16:20" });
    if (p.id === "p12") L.push({ id:"iv", name:"%0.9 NaCl IV", freq:"sürekli · order'daki hız", kind:"inf", since:"yatıştan beri", src:"hastane kaydı" });
    if (p.id === "p13") L.push({ id:"caf", name:"Kafein sitrat IV", freq:"24 saatte bir", times:[10] }, { id:"tpn", name:"Parenteral beslenme", freq:"sürekli · eczane hazırlığı", kind:"inf", since:"08:00", src:"hastane kaydı" });
    const prn = S(p.id).prnLast || {};
    return L.map(m => Object.assign({ kind:"sched", src:"hastane kaydı", start:`${TODAY - Math.min(p.admitDays, 3) + 1}.09`, by:p.attending }, m, prn[m.id] ? { last:prn[m.id] } : {}));
  };
  H.ptMeds = medsFor;   // salt okunur: yazdir.js infüzyon etiketi order'ı buradan okur
  const stateAt = (t) => t < 21 ? "done" : t < 22 ? "late" : t < 23 ? "due" : "plan";
  /* 30.09 · kontrol §4-5: TEK ilaç çizelgesi. Planlı dozlar (nebül, pantoprazol, furosemid…) önceden yalnız bu sayfanın yerel
   * listesindeydi ve Görevlerim'e hiç düşmüyordu. Artık hepsi H.data.tasks'ta ({ kind:"med", med:<order id> }): hasta İlaç/Takip
   * sekmesi ve Görevlerim aynı nesneyi okur; uygulama penceresi de tek (nursing.js H.medAct). */
  const MED_SEEDED = new Set();
  const ensureMedTasks = (p) => {
    if (!p || MED_SEEDED.has(p.id)) return; MED_SEEDED.add(p.id);
    medsFor(p).forEach(m => { if (m.kind === "sched") m.times.forEach(t => H.data.tasks.push({ pid:p.id, t, kind:"med", label:m.name, med:m.id, state:stateAt(t) })); });
  };
  H.ensureMedTasks = ensureMedTasks;
  H.data.patients.forEach(ensureMedTasks);
  const dosesOf = (p) => { ensureMedTasks(p); return H.data.tasks.filter(x => x.pid === p.id && x.kind === "med"); };
  const doneAt = (d) => d.doneAt || (d.state === "done" ? clk(d.t + 0.1) : null);
  const notGiven = (d) => d.state === "miss" || (d.state === "done" && d.given === false);

  /* ================= sıvı (sentetik) ================= */
  const ioCache = {};
  const ioOf = (p) => {
    if (ioCache[p.id]) return ioCache[p.id];
    const rnd = seeded(seedOf(p.id + "io")), kg = p.weight, neo = p.ageGroup === "neonate";
    const inBase = neo ? 6 * kg : p.ageGroup === "child" ? 3.5 * kg : ({ crit:125, high:95, mid:85 }[p.risk] || 75);
    const uo = ({ p1:0.35, p3:0.3, p7:1.6, p13:2.2 }[p.id]) || (neo ? 3 : p.risk === "crit" ? 0.4 : 0.9);
    const rows = [];
    for (let i = 23; i >= 0; i--) {
      const hh = Math.floor(NOW) - i; let ins = inBase * (0.8 + rnd() * 0.4), out = uo * kg * (0.7 + rnd() * 0.6);
      if (p.id === "p1" && (hh === 19 || hh === 20)) ins += 250;               // 500 mL sıvı 19:40
      if (p.id === "p7" && (hh === 11 || hh === 12)) out += 180;               // diüretik sonrası
      if (p.id === "p1" && hh >= 18) out *= 0.6;
      rows.push({ h:((hh % 24) + 24) % 24, i:Math.round(ins), o:Math.round(out) });
    }
    return (ioCache[p.id] = rows);
  };

  /* ================= grafik yardımcıları ================= */
  const EV_BASE = (p) => {
    const ev = [];
    H.data.alarms.filter(a => a.pid === p.id).forEach(a => ev.push({ t:-a.ageMin / 60, label:a.txt, kind:"al" }));
    dosesOf(p).filter(d => d.state === "done" && d.given !== false).forEach(d => ev.push({ t:d.t - NOW, label:d.label, kind:"tx" }));
    if (p.risk === "crit") ev.push({ t:20.42 - NOW, label:"Noradrenalin başlandı", kind:"tx" }, { t:19.67 - NOW, label:"Sıvı 500 mL", kind:"tx" }, { t:-3.1, label:"NEWS2 10", kind:"al" });
    if (p.risk === "high") ev.push({ t:-5.4, label:"SpO₂ düşük · kısa epizod", kind:"al" });
    return ev;
  };
  const xTicksFor = (hours) => {
    const st = hours <= 6 ? 1 : hours <= 24 ? 4 : 12, out = [];
    for (let k = Math.ceil((NOW - hours) / st) * st; k <= NOW; k += st) { const t = k - NOW; if (t < -hours) continue;
      out.push([t, hours > 24 && ((k % 24) + 24) % 24 === 0 ? `${String(dayOf(t)).padStart(2, "0")}.09` : clk(k)]); }
    return out;
  };
  const stepFor = (p, hours) => p.monitored ? (hours > 24 ? 30 : hours > 6 ? 15 : 5) : 240;
  const vitalBands = (V) => [[V.lo, V.al[0], H.cssVar("--band-al")], [V.al[1], V.hi, H.cssVar("--band-al")], [V.nb[0], V.nb[1], H.cssVar("--band-n")]];
  const vTicks = (V) => [V.lo, V.al[0], V.al[1], V.hi].filter(v => v <= V.hi && v >= V.lo);
  const fmtV = (k, v) => v == null ? "—" : k === "temp" ? (+v).toFixed(1) : Math.round(v);
  const nearest = (pts, t) => { let b = null, bd = 1e9; pts.forEach(q => { const d = Math.abs(q.t - t); if (d < bd && q.v != null) { bd = d; b = q; } }); return b; };

  function drawVital(svg, p, key, hours, opt = {}) {
    const V = H.VITAL[key], step = stepFor(p, hours), pts = H.series(p.id, key, hours, step), col = H.cssVar(V.c);
    const series = [{ pts, color:col, width:opt.big ? 2.3 : 1.7, dots:!p.monitored }];
    let cpts = null;
    if (opt.cmp && H.VITAL[opt.cmp]) { const C = H.VITAL[opt.cmp]; cpts = H.series(p.id, opt.cmp, hours, step);
      series.push({ pts:cpts.map(q => ({ t:q.t, v:V.lo + (q.v - C.lo) / (C.hi - C.lo) * (V.hi - V.lo) })), color:H.cssVar(C.c), width:1.6, dots:!p.monitored }); }
    const ev = opt.events ? EV_BASE(p).filter(e => e.t >= -hours && e.t <= 0) : [];
    H.lineChart(svg, { series, lo:V.lo, hi:V.hi, bands:vitalBands(V), ticks:vTicks(V), hours, height:opt.height || 46, padL:opt.big ? 34 : 28,
      xLabels:!!opt.big, xTicks:xTicksFor(hours), events:ev,
      onHover:opt.readout ? (t) => {
        if (t == null) { opt.readout.innerHTML = opt.idle || ""; return; }
        const q = nearest(pts, t); let s = `<b>${stamp(q.t)}</b> · ${V.s} <b>${fmtV(key, q.v)}</b> ${V.u}`;
        if (cpts) { const C = H.VITAL[opt.cmp], c = nearest(cpts, t); s += ` · ${C.s} <b>${fmtV(opt.cmp, c.v)}</b> ${C.u}`; }
        const e = ev.find(e => Math.abs(e.t - t) < hours / 60); if (e) s += ` · ${e.kind === "al" ? "▲" : "◆"} ${esc(e.label)}`;
        opt.readout.innerHTML = s; } : null });
  }
  const LEG_T = `<div class="pt-leg"><span><i style="background:var(--band-al)"></i>alarm eşiği dışı</span><span><i style="background:var(--band-n)"></i>normal aralık</span><span>◆ ilaç / tedavi</span><span>▲ alarm</span></div>`;

  function openBigChart(p, key) {
    let hours = 24;
    const V = H.VITAL[key];
    const body = `<div class="pt-row" style="margin-bottom:8px"><div class="seg" data-bh>${[6, 24, 72].map(h => `<button data-v="${h}" class="${h === hours ? "on" : ""}">${h === 72 ? "3 gün" : h + " sa"}</button>`).join("")}</div>
      <span class="mute" style="font-size:12px">${V.n} · ${V.u} · kaynak: ${p.monitored ? "monitör · canlı" : "elle / portatif cihaz"}</span></div>
      <div class="pt-hov" data-ro></div><svg class="pt-big" data-big></svg>${LEG_T}`;
    H.modal({ title:`${esc(H.bed(p.bed).no)} · ${esc(pname(p))} · ${V.n}`, body, wide:true, onMount(m) {
      const draw = () => { const ro = m.querySelector("[data-ro]"), idle = `Grafiğin üzerinde gezinin · son değer <b>${fmtV(key, p.v[key])}</b> ${V.u}`; ro.innerHTML = idle;
        drawVital(m.querySelector("[data-big]"), p, key, hours, { big:true, height:280, events:true, readout:ro, idle }); };
      m.addEventListener("click", (e) => { const b = e.target.closest("[data-bh] button"); if (!b) return; hours = +b.dataset.v; m.querySelectorAll("[data-bh] button").forEach(x => x.classList.toggle("on", x === b)); draw(); });
      draw(); } });
  }

  /* ================= monitör dalgası (TEMSİLİ) ================= */
  const G = (x, m, s) => Math.exp(-((x - m) ** 2) / (2 * s * s));
  const WF = {
    hr:(t, r) => { const q = (t * r / 60) % 1; return .12 * G(q, .12, .025) - .12 * G(q, .27, .008) + G(q, .3, .011) - .28 * G(q, .33, .01) + .28 * G(q, .55, .045); },
    map:(t, r) => { const q = ((t * r / 60) + .8) % 1; return q < .12 ? Math.sin(q / .12 * Math.PI / 2) : .95 * Math.exp(-(q - .12) * 2.6) - .12 * G(q, .33, .02) + .1 * G(q, .38, .03); },
    spo:(t, r) => { const q = ((t * r / 60) + .7) % 1; return q < .2 ? Math.sin(q / .2 * Math.PI / 2) ** 2 : .9 * Math.exp(-(q - .2) * 2.2); },
  };
  let SW = [], raf = 0, prevT = 0;
  const wireWaves = (root) => {
    SW = SW.filter(s => s.cv.isConnected);
    root.querySelectorAll("canvas[data-w]").forEach(cv => { const mon = cv.closest(".mon") || document.body;
      SW.push({ cv, k:cv.dataset.w, r:+cv.dataset.r || 80, col:cssIn(mon, cv.dataset.c), px:0, t:0, last:null, ctx:null, w:0 }); });
    if (!raf && SW.length) { prevT = performance.now(); raf = requestAnimationFrame(frame); }
  };
  function frame(now) {
    SW = SW.filter(s => s.cv.isConnected);
    if (!SW.length) { raf = 0; return; }                         // sayfadan çıkınca döngü kendiliğinden durur
    const dt = Math.min(.05, (now - prevT) / 1000); prevT = now;
    for (const s of SW) {
      const w = s.cv.clientWidth, h = s.cv.clientHeight; if (!w || !h) continue;
      if (s.w !== w) { const d = window.devicePixelRatio || 1; s.cv.width = w * d; s.cv.height = h * d; s.ctx = s.cv.getContext("2d"); s.ctx.setTransform(d, 0, 0, d, 0, 0); s.w = w; s.px = 0; s.last = null; }
      const x = s.ctx;
      // Tarama hızı genişliğe bağlı: ekran ~5 saniyelik dalga gösterir (geniş monitörde atımlar sıkışmasın).
      s.acc = (s.acc || 0) + Math.max(60, w / 5) * dt; const n = Math.max(1, Math.floor(s.acc)); s.acc -= n;
      for (let i = 0; i < n; i++) {
        s.t += dt / n; const y = h - 5 - WF[s.k](s.t, s.r) * (h - 12) * .85 - (s.k === "hr" ? h * .12 : 0);
        if (s.k === "hr") { const q = (s.t * s.r / 60) % 1; if (s.q != null && s.q < .3 && q >= .3 && H.sound) H.sound.beat(s.cv); s.q = q; }   // R dalgası = bip
        x.clearRect(s.px, 0, 14, h);
        if (s.last != null && s.px > 0) { x.strokeStyle = s.col; x.lineWidth = 1.7; x.beginPath(); x.moveTo(s.px - 1, s.last); x.lineTo(s.px, y); x.stroke(); }
        s.last = y; s.px++; if (s.px > w) { s.px = 0; s.last = null; }
      }
    }
    raf = requestAnimationFrame(frame);
  }

  const monitorHtml = (p) => {
    const art = p.ageGroup !== "neonate" && (p.risk === "crit" || p.risk === "high");
    const ch = [["hr", "EKG II", "--v-hr"]].concat(art ? [["map", "ART", "--v-map"]] : []).concat([["spo", "SpO₂", "--v-spo"]]);
    const v = p.v;
    // 24.09 (3. oturum): data-s = SpO₂ → nabız bipinin perdesi (monitor.js); mon-tools = ses + duvar görünümü düğmeleri.
    return `<div class="mon" data-theme="gece" data-beep><div class="wv">${ch.map(([k, l, c]) => `<div class="ch"><span style="color:var(${c})">${l}</span><canvas data-w="${k}" data-r="${v.hr}" data-s="${v.spo2}" data-c="${c}"></canvas></div>`).join("")}<span class="wm">TEMSİLİ DALGA</span>
      ${H.sound ? H.sound.toolsHtml(p.id) : ""}</div>
      <div class="nums">
        <div class="nu"><small style="color:var(--v-hr)"><span>HR</span><span>/dk</span></small><b style="color:var(--v-hr)">${v.hr}</b></div>
        <div class="nu"><small style="color:var(--v-map)"><span>${art ? "ART" : "NIBP"}</span><span>${art ? "mmHg" : "21:30"}</span></small><b style="color:var(--v-map)">${v.sbp}<em>/${v.dbp}</em> <em>(${v.map})</em></b></div>
        <div class="nu"><small style="color:var(--v-spo)"><span>SpO₂</span><span>%</span></small><b style="color:var(--v-spo)">${v.spo2}</b></div>
        <div class="nu"><small style="color:var(--v-rr)"><span>RESP</span><span>/dk</span></small><b style="color:var(--v-rr)">${v.rr}</b></div>
        <div class="nu" style="border:0"><small style="color:var(--v-t)"><span>ISI</span><span>elle · ${lastTxt(p.id, "vitals")}</span></small><b style="color:var(--v-t)">${v.temp.toFixed(1)}</b></div>
      </div></div>`;
  };
  H.monitor = { html:monitorHtml, wire:(root) => wireWaves(root) };   // monitor.js (duvar monitörü) aynı dalgayı kullanır
  /* 24.09 (3. oturum) · Ozan #68/#70: portatif cihazla (aralıklı) ölçülen hastada da siyah monitör paneli.
   * Canlı dalga YOK (cihaz sürekli bağlı değil) — bunu gizlemiyoruz: her rakamın yanında ölçüm saati ve kaynağı var.
   * Her vital: son değer · bir öncekine göre fark · son 24 saatin mini eğrisi · alarm eşiği dışıysa kırmızı çerçeve. */
  const spotHtml = (p) => {
    const v = p.v, nextV = H.data.tasks.filter(t => t.pid === p.id && t.form === "vitals" && t.state !== "done").sort((a, b) => a.t - b.t)[0];
    const LE = H.lastEntry ? H.lastEntry(p.id, "vitals") : null, LAST = LE && LE.t != null ? LE.t : 20, NOWH = 21 + 42 / 60, nextH = nextV ? nextV.t : LAST + 4, pct = Math.max(0, Math.min(100, (NOWH - LAST) / Math.max(.1, nextH - LAST) * 100));
    const late = nextV && nextV.t < NOWH;
    const cell = (k, label, val, unit, extra = "") => {
      const V = H.VITAL[k], pts = H.series(p.id, k, 24, 240).map(q => q.v), prev = pts[pts.length - 2], now = pts[pts.length - 1];
      const d = prev == null ? 0 : +(now - prev).toFixed(k === "temp" ? 1 : 0), out = now < V.al[0] || now > V.al[1];
      const arrow = d > 0 ? "↑" : d < 0 ? "↓" : "→";
      return `<div class="sp-c${out ? " out" : ""}" style="--vc:var(${V.c})"><div class="sp-l"><span>${label}</span><span>${unit}</span></div>
        <div class="sp-v"><b>${val}</b>${extra}</div>
        <div class="sp-t"><span class="sp-d" title="Bir önceki ölçüme göre">${arrow} ${d > 0 ? "+" : ""}${d}</span>${H.spark(pts, H.cssVar(V.c))}</div></div>`;
    };
    return `<div class="sp-mon" data-theme="gece">
      <div class="sp-h"><span class="sp-src">${H.icon("tablet")} Portatif cihaz · aralıklı ölçüm</span><span class="mute">Son ölçüm <b class="mono">${esc(H.entryText(LE))}</b>${LE && H.agoText(LE) ? " · " + esc(H.agoText(LE)) : ""} · ${esc(H.bed(p.bed).no)}</span>
        <span class="sp-next${late ? " late" : ""}">${late ? "Ölçüm gecikti" : "Sıradaki"} <b class="mono">${nextV ? clk(nextV.t) : "—"}</b><i><em style="width:${pct.toFixed(0)}%"></em></i></span></div>
      <div class="sp-g">
        ${cell("hr", "Nabız", v.hr, "/dk")}
        ${cell("map", "Tansiyon", `${v.sbp}/${v.dbp}`, "mmHg", `<em>(${v.map})</em>`)}
        ${cell("spo2", "SpO₂", v.spo2, "%")}
        ${cell("rr", "Solunum", v.rr, "/dk")}
        ${cell("temp", "Ateş", v.temp.toFixed(1), "°C")}
        <div class="sp-c sp-o"><div class="sp-l"><span>O₂ · bilinç</span></div><div class="sp-v"><b style="font:700 16px/1.25 Figtree">${esc(v.o2)}</b></div><div class="sp-t"><span>${esc(v.loc)}</span></div></div>
      </div>
      <div class="sp-f"><span class="mute">Eğriler son 24 saatin ölçümleri · kırmızı çerçeve = alarm eşiği dışında</span>
        <button class="btn p" data-form="vitals">${H.icon("heart")}Vital gir</button></div></div>`;
  };
  const vitalBarHtml = (p) => spotHtml(p);

  /* ================= sekmeler ================= */
  const TABS = [["ozet", "Özet"], ["trend", "Trendler"], ["skor", "Skorlar"], ["takip", "Takip"], ["bakim", "Bakım planı"], ["ilac", "İlaç"], ["sivi", "Sıvı"], ["sonuc", "Sonuçlar"], ["kamera", "Kamera"], ["devir", "Teslim notu"], ["belge", "Belgeler"]];
  // 24.09: bakım planı yalnız hemşirelik yapan rollerde ve klinik birimde; kamera yalnız yetkili rolde ve yoğun bakım yatağında
  // Hangi sekmeyi kim görür: Yönetim → Roller → Modül erişimi (pt_* yetkileri). Özet her zaman açılabilir olmalı.
  const tabsFor = (p) => TABS.filter(([k]) => (k === "ozet" || H.can("pt_" + k)) && (k === "kamera" ? H.can("camera") && ["icu", "nicu"].includes(unitOf(p).type) && !!H.cameraTab
    : k === "bakim" ? !!H.carePlan && H.isClinical(unitOf(p)) : true));
  const badge = (p, k) => {
    if (k === "skor" && isIcuAdult(p) && !S(p.id).sofaSigned) return "1";
    if (k === "takip") { ensureMedTasks(p); const n = H.data.tasks.filter(t => t.pid === p.id && t.state === "late").length; return n ? String(n) : ""; }
    if (k === "sonuc") { const n = unseenLabs(p).length + radUnseen(p).length; return n ? String(n) : ""; }
    return "";
  };

  /* ---------- Özet ---------- */
  const reasonsOf = (p) => {
    const v = p.v, L = pv(p), R = [];
    if (v.map < 65) R.push(`MAP ${v.map} mmHg · 65'in altında`);
    if (L.lac >= 2) R.push(`Laktat ${L.lac} mmol/L${PREV[p.id] && PREV[p.id].lac ? ` (önceki ${PREV[p.id].lac})` : ""}`);
    if (v.spo2 < 92) R.push(`SpO₂ %${v.spo2} · ${esc(v.o2).toLowerCase()} altında`);
    if (p.news2 != null && p.news2 >= 5) R.push(`NEWS2 ${p.news2}`);
    if (p.nsofa != null && p.nsofa >= 2) R.push(`nSOFA ${p.nsofa}`);
    if (v.rr >= 25) R.push(`Solunum ${v.rr} /dk`);
    if (v.hr >= 120) R.push(`Kalp hızı ${v.hr} /dk`);
    if (v.temp >= 38.3) R.push(`Ateş ${v.temp.toFixed(1)} °C`);
    return R.slice(0, 3);
  };
  /* 30.09 · kontrol §4-9: hemşire formlarında girilip hiçbir ekranda okunmayan değerler. Yalnız BİLGİ satırı: skorlara bağlanmaz
   * (SOFA nörolojik puanını hekim seçer). Kaynak: nursing.js kayıtları (H.data.nursing.records) ve p.lastGlucose / p.flags.rass. */
  const recOf = (pid, key) => { const R = ((H.data.nursing || {}).records || []).filter(r => r.pid === pid && r.key === key); return R[R.length - 1] || null; };
  const recWhen = (r) => r ? (r.date === H.dmy(0) ? r.at : `${String(r.date).slice(0, 5)} ${r.at}`) : "";
  const sgnN = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n);
  const obsLine = (p) => {
    const g = recOf(p.id, "gcs"), r = recOf(p.id, "rass"), k = recOf(p.id, "glucose"), out = [];
    if (g && g.d && g.d.e != null && g.d.m != null) out.push(`<span>${esc(L("obs_gcs"))} <b class="mono">${g.d.v === "T" ? `${g.d.e + g.d.m}T` : g.d.e + g.d.v + g.d.m}</b> <i class="mute">${esc(recWhen(g))}</i></span>`);
    const rv = p.flags && p.flags.rass != null ? p.flags.rass : null;
    if (rv != null) out.push(`<span>RASS <b class="mono">${sgnN(+rv)}</b> <i class="mute">${esc(recWhen(r))}</i></span>`);
    if (p.lastGlucose != null) out.push(`<span>${esc(L("obs_glu"))} <b class="mono">${p.lastGlucose}</b> mg/dL <i class="mute">${esc(recWhen(k))}</i></span>`);
    if (!out.length) return "";
    return `<div class="pt-obs" style="padding:8px 0 2px;border-top:1px dashed var(--line);margin-top:4px;font-size:12.5px"><b>${esc(L("obs_title"))}</b><div class="pt-row" style="gap:4px 14px;margin-top:4px">${out.join("")}</div><div class="mute" style="font-size:11px;margin-top:3px">${esc(L("obs_note"))}</div></div>`;
  };
  const woundLine = (p) => {
    const R = ((H.data.nursing || {}).records || []).filter(r => r.pid === p.id && r.key === "wound"), O = ((H.data.nursing || {}).ongoing || []).filter(o => o.pid === p.id);
    if (!R.length && !O.length) return "";
    const last = R[R.length - 1], reg = last && last.d && (last.d.regions || [])[0], rn = reg && H.body && H.body.name ? H.body.name(reg) : "";
    const lastTxt = last ? `${rn ? rn + " · " : ""}${last.d._push != null ? "PUSH " + last.d._push + " · " : ""}${recWhen(last)}` : "—";
    return `<div class="pt-obs" style="padding:8px 0 2px;border-top:1px dashed var(--line);margin-top:4px;font-size:12.5px"><b>${esc(L("wd_title"))}</b>
      <div style="margin-top:3px">${esc(L("wd_line", R.length, O.length))} · ${esc(L("wd_last"))}: <b>${esc(lastTxt)}</b> ${R.length ? `<a href="#" data-form="wound" style="margin-left:6px">${esc(L("wd_open"))} →</a>` : ""}</div></div>`;
  };
  function tabOzet(p) {
    const st = S(p.id), u = unitOf(p);
    let reco = "";
    if (p.risk === "crit" || p.risk === "high") {
      reco = `<div class="pt-reco ${p.risk === "high" ? "h" : ""}"><h4>Kötüleşme kriterleri karşılanıyor</h4><div class="mute" style="font-size:13px">Değerlendirme önerilir · karar hekimindir.</div>
        <ul>${reasonsOf(p).map(r => `<li>${r}</li>`).join("")}</ul>
        <div class="src">Dayanak: hastanenin onayladığı erken uyarı eşikleri${p.ageGroup === "adult" ? " · NEWS2 (RCP 2017)" : ""}${p.risk === "crit" && p.ageGroup === "adult" ? " · Sepsis-3 (2016)" : ""}</div>
        ${st.reco ? `<div class="done">${H.icon("ok")} ${st.reco}</div>` : `<div class="pt-row"><button class="btn p" data-act="reco-ok">Değerlendirdim</button><button class="btn d" data-act="reco-esc">Eskale et</button></div>`}</div>`;
    } else reco = `<div class="note i">Kötüleşme kriteri karşılanmıyor · son hesaplama 21:40</div>`;
    const score = isIcuAdult(p)
      ? `<div class="box" style="margin-top:12px"><h5>Anlık SOFA <span class="mute" style="text-transform:none;letter-spacing:0">son değerlerden</span><span class="r"><a href="#" data-tab="skor">24 saatlik formu aç →</a></span></h5><div class="pt-row" style="align-items:baseline"><b style="font:700 30px 'Space Grotesk'">${p.sofa}</b><span class="mute" style="font-size:12.5px">günlük form ${st.sofaSigned ? `<b style="color:var(--ok)">onaylandı ✓</b>` : `<b style="color:var(--attInk)">onay bekliyor</b>`}</span></div></div>`
      : `<div class="box" style="margin-top:12px"><h5>Skor <span class="r"><a href="#" data-tab="skor">Skorlar →</a></span></h5><b style="font:700 24px 'Space Grotesk'">${esc(H.scoreLabel(p))}</b><div class="mute" style="font-size:12.5px">${esc(u.rule)} · ${esc(u.tr)}</div></div>`;
    const fl = p.flags || {}, allowed = (k) => H.FORMS.some(f => f.key === k && f.ages.includes(p.ageGroup));
    const lv = (s) => s === "yüksek" ? "c" : s === "orta" ? "w" : s ? "o" : "";
    const risks = [
      allowed("fall") ? ["Düşme riski", fl.fall, "fall"] : null,
      ["Bası yarası riski", fl.braden, "braden"],
      ["Ağrı", fl.pain != null ? `${fl.pain}/10` : null, "pain"],
    ].filter(Boolean).map(([n, v, f]) => { const le = H.lastEntry ? H.lastEntry(p.id, f) : null; return `<div class="pt-risk"><div><b>${n}</b>${v ? `<span class="pt-lv ${f === "pain" ? (fl.pain >= 6 ? "c" : fl.pain >= 4 ? "w" : "o") : lv(v)}">${esc(v)}</span>` : `<span class="pt-lv">kayıt yok</span>`}</div>
      <button class="btn sm" data-form="${f}">Değerlendir</button><small>Son değerlendirme: ${le ? (le.today ? `bugün ${le.at}` : H.entryText(le)) : "—"}</small></div>`; }).join("");
    const pc = consOf(p).filter(c => c.reco == null);
    const pend = pc.length ? `<div class="note" style="margin-bottom:12px">${H.icon("clock").replace("<svg", '<svg style="width:14px;height:14px;vertical-align:-2px"')} ${esc(L("cs_pending"))}: ${pc.map(c => `<b>${esc(L("dep_" + c.dep))}</b> · ${esc(L("cs_st_" + (c.seen != null ? "seen" : "req")))} · ${esc(L("cs_waiting", dur(-(c.seen ?? c.req))))}`).join(" · ")}</div>` : "";
    return `${pend}${isPostop(p) ? postopPanel(p) : ""}<div class="g2"><div>${reco}${score}
        <div class="box" style="margin-top:12px"><h5>Hemşirelik riskleri</h5>${risks}${obsLine(p)}${woundLine(p)}</div></div>
      <div class="box"><h5>Son 24 saat <span class="r"><a href="#" data-tab="trend">Trendler →</a></span></h5>
        ${["hr", "map", "spo2", "rr", "temp"].map(k => { const V = H.VITAL[k]; return `<div class="pt-sm" data-big="${k}"><div><small style="color:var(${V.c})">${V.n}</small><b>${fmtV(k, p.v[k])}</b><i>${V.u}</i></div><svg data-mini="${k}" height="46"></svg></div>`; }).join("")}
        <div class="pt-leg"><span><i style="background:var(--band-al)"></i>alarm eşiği dışı</span><span><i style="background:var(--band-n)"></i>normal aralık</span><span>satıra tıkla → büyük grafik</span></div>
        <div class="mute" style="font-size:11.5px;margin-top:4px">Ölçek sabit klinik ölçektir; hastadan hastaya karşılaştırılabilir.${p.monitored ? "" : " Servis hastası: noktalar 4 saatlik elle ölçümler."}</div></div></div>
      <div class="g2" style="margin-top:12px">${consBox(p)}${famBox(p)}</div>`;
  }
  const afterOzet = (root, p) => root.querySelectorAll("svg[data-mini]").forEach(svg => drawVital(svg, p, svg.dataset.mini, 24, { height:46 }));

  /* ---------- Trendler ---------- */
  function tabTrend(p) {
    const st = S(p.id);
    return `<div class="pt-chips">${["hr", "map", "spo2", "rr", "temp"].map(k => { const V = H.VITAL[k]; return `<div class="pt-vc ${st.trendKey === k ? "on" : ""}" data-sel="${k}" style="--c:var(${V.c})"><small>${V.n}</small><b>${fmtV(k, p.v[k])}</b><i>${V.u}</i></div>`; }).join("")}</div>
      <div class="pt-row" style="margin-bottom:8px"><div class="seg" data-th>${[6, 24, 72].map(h => `<button data-v="${h}" class="${st.trendH === h ? "on" : ""}">${h === 72 ? "3 gün" : h + " sa"}</button>`).join("")}</div>
        <label class="mute" style="font-size:12.5px;display:flex;gap:6px;align-items:center">Karşılaştır
          <select data-cmp style="width:auto;padding:6px 9px"><option value="">—</option>${["hr", "map", "spo2", "rr", "temp"].filter(k => k !== st.trendKey).map(k => `<option value="${k}" ${st.cmp === k ? "selected" : ""}>${H.VITAL[k].n}</option>`).join("")}</select></label>
        <button class="btn g sm" data-act="big-trend">${H.icon("eye")}Büyüt</button></div>
      <div class="box"><div class="pt-hov" data-ro></div><svg class="pt-big" data-trend></svg>${LEG_T}
        ${st.cmp ? `<div class="mute" style="font-size:11.5px;margin-top:4px">İkinci seri (${H.VITAL[st.cmp].n}) kendi klinik ölçeğine göre bu eksene yerleştirildi; değerini imleçle okuyun.</div>` : ""}
        <div class="mute" style="font-size:11.5px;margin-top:4px">Kaynak: ${p.monitored ? `monitör · canlı (ateş: elle, ${lastTxt(p.id, "vitals")})` : "elle / portatif cihaz"}</div></div>`;
  }
  const afterTrend = (root, p) => { const st = S(p.id), ro = root.querySelector("[data-ro]"), V = H.VITAL[st.trendKey], idle = `Grafiğin üzerinde gezinin · ${V.n} son <b>${fmtV(st.trendKey, p.v[st.trendKey])}</b> ${V.u}`; ro.innerHTML = idle;
    drawVital(root.querySelector("[data-trend]"), p, st.trendKey, st.trendH, { big:true, height:300, events:true, cmp:st.cmp, readout:ro, idle }); };

  /* ---------- Skorlar ---------- */
  const srcBadge = (s) => `<span class="bdg">${H.icon("cpu")}sistem doldurdu · ${s}</span>`;
  // 30.09 · kontrol §4-7: onaylanan günlük SOFA toplamı (başlık, yatak kartı ve bildirim bununla eşitlenir)
  const sofaTot = (p) => { const st = S(p.id), L = pv(p), ne = p.risk === "crit" ? 0.08 : 0, sup = /NIV|entübe|mekanik/i.test(p.v.o2), g = SOFA_GCS.find(x => x[0] === st.sofaGcs);
    const base = SOFA.resp(L.pf, sup) + SOFA.coag(L.plt) + SOFA.liver(L.bili) + SOFA.cardio(p.v.map, ne) + SOFA.renal(L.cre); return g ? base + g[1] : null; };
  function sofaCard(p) {
    const st = S(p.id), L = pv(p), ne = p.risk === "crit" ? 0.08 : 0, sup = /NIV|entübe|mekanik/i.test(p.v.o2);
    const org = [
      ["Solunum", `PaO₂/FiO₂ ${L.pf}${sup ? " · solunum desteği" : ""}`, "Kan gazı · 07:40", SOFA.resp(L.pf, sup)],
      ["Pıhtılaşma", `Trombosit ${L.plt} bin`, "Laboratuvar · 06:10", SOFA.coag(L.plt)],
      ["Karaciğer", `Bilirubin ${L.bili} mg/dL`, "Laboratuvar · 06:10", SOFA.liver(L.bili)],
      ["Dolaşım", ne ? `Noradrenalin ${ne} µg/kg/dk` : `MAP ${p.v.map} mmHg`, ne ? "Pompa · canlı" : "Monitör · 21:37", SOFA.cardio(p.v.map, ne)],
      ["Böbrek", `Kreatinin ${L.cre} mg/dL`, "Laboratuvar · 06:10", SOFA.renal(L.cre)],
    ];
    const base = org.reduce((a, o) => a + o[3], 0), g = SOFA_GCS.find(x => x[0] === st.sofaGcs), tot = g ? base + g[1] : null;
    const canSign = H.can("scores_sign");
    return `<div class="box"><h5>Günlük SOFA · son 24 saatin en kötü değerleri <span class="r mute">puan tablosu: SOFA (Vincent 1996)${H.adminNote(" · hastanenin onayı gerekir")}</span></h5>
      <div class="mute" style="font-size:12.5px;margin-bottom:10px">Sistem 5 / 6 organı kaynaklı olarak doldurdu. <b style="color:var(--ink)">Kaynağı olmayan hiçbir değer kendiliğinden girilmez.</b> Anlık SOFA (${p.sofa}) son değerlerden hesaplanır; bu formdan farklı olabilir.</div>
      <div class="pt-sofa">${org.map(([o, v, s, pt]) => `<div class="pt-so"><span>${o}</span><b>${v}</b>${srcBadge(s)}<em>${pt}</em></div>`).join("")}
        <div class="pt-so need"><span>Nörolojik · GKS</span><b>${st.sofaSigned ? `GKS ${st.sofaGcs}` : "Hekim seçimi gerekli"}</b>
          <div class="pt-pick">${SOFA_GCS.map(([l]) => `<i class="${st.sofaGcs === l ? "on" : ""}" ${st.sofaSigned ? "" : `data-gcs="${l}"`}>${l}</i>`).join("")}</div>${g ? `<em>${g[1]}</em>` : ""}</div></div>
      <div class="pt-tot"><div class="scoreBadge"><b>${tot ?? base + "+"}</b><small>Günlük SOFA</small></div>
        ${st.sofaSigned ? `<span class="pt-signed">✓ Onaylandı · ${esc(st.sofaSigned.by)} · ${st.sofaSigned.at} · toplam ${tot}</span>`
          : canSign ? `<button class="btn p" data-act="sofa-sign" ${g ? "" : "disabled"}>${H.icon("ok")}Mühürle</button><span class="mute" style="font-size:12.5px">${g ? "Tüm maddeler tamam" : "GKS seçilince etkinleşir"}</span>`
          : `<button class="btn" disabled>Hekim onayı bekliyor</button><span class="mute" style="font-size:12.5px">İmza yetkisi hekimdedir.</span>`}</div></div>`;
  }
  function apacheCard(p) {
    const st = S(p.id), L = pv(p), v = p.v, arf = p.icd.startsWith("N17");
    const rows = [
      ["Vücut ısısı", `${v.temp.toFixed(1)} °C`, "monitör · 21:40", AP.temp(v.temp)],
      ["Ortalama kan basıncı", `${v.map} mmHg`, "monitör · 21:37", AP.map(v.map)],
      ["Kalp hızı", `${v.hr} /dk`, "monitör", AP.hr(v.hr)],
      ["Solunum hızı", `${v.rr} /dk`, "monitör", AP.rr(v.rr)],
      ["Oksijenlenme", `PaO₂ ${L.pao2} mmHg (FiO₂ < 0.5)`, "kan gazı · 07:40", AP.pao2(L.pao2)],
      ["Arter pH", `${L.ph}`, "kan gazı · 07:40", AP.ph(L.ph)],
      ["Sodyum", `${L.na} mmol/L`, "laboratuvar · 06:10", AP.na(L.na)],
      ["Potasyum", `${L.k} mmol/L`, "laboratuvar · 06:10", AP.k(L.k)],
      ["Kreatinin", `${L.cre} mg/dL${arf ? " · ABH: puan ×2" : ""}`, "laboratuvar · 06:10", AP.cre(L.cre) * (arf ? 2 : 1)],
      ["Hematokrit", `%${L.hct}`, "laboratuvar · 06:10", AP.hct(L.hct)],
      ["Lökosit", `${L.wbc} ×10³/µL`, "laboratuvar · 06:10", AP.wbc(L.wbc)],
      ["Yaş", `${p.age}`, "Kayıt", AP.age(p.age)],
    ];
    const base = rows.reduce((a, r) => a + r[3], 0);
    const note = `<div class="mute" style="font-size:11.5px;margin-top:8px">Puan tablosu: APACHE II (Knaus 1985)${H.adminNote(" · hastanenin onayı gerekir")}. APACHE II <b style="color:var(--ink)">bir kez</b>, yatışın ilk 24 saati için hesaplanır; günlük gidiş SOFA ile izlenir.</div>`;
    const rowHtml = rows.map(([n, val, s, pt]) => `<div class="pt-ap"><span>${n}</span><span class="v">${val}</span><span class="s">${H.icon("cpu").replace("<svg", '<svg style="width:11px;height:11px;vertical-align:-1px"')} ${s}</span><span class="p">${pt}</span></div>`).join("");
    if (p.admitDays <= 1) {
      const gcs = st.apGcs, ch = st.apChronic;
      const tot = gcs != null && ch != null ? base + (15 - gcs) + AP_CHRONIC[ch][1] : null;
      return `<div class="box" style="margin-top:12px"><h5>APACHE II · yatışın ilk 24 saati · en kötü değerler <span class="r mute">${rows.length} / 14 madde kendiliğinden doldu</span></h5>
        ${rowHtml}
        <div class="pt-ap need"><span><b>Glasgow Koma Skoru</b><br><small class="mute">puan = 15 − GKS · hekim seçer</small></span><span class="opts">${st.apSigned ? `<b>${gcs}</b>` : `<select data-apgcs style="width:auto;padding:6px 9px"><option value="">Seçin</option>${Array.from({ length:13 }, (_, i) => 15 - i).map(g => `<option ${gcs === g ? "selected" : ""}>${g}</option>`).join("")}</select>`}</span><span class="p">${gcs != null ? 15 - gcs : "—"}</span></div>
        <div class="pt-ap need"><span><b>Kronik sağlık durumu</b><br><small class="mute">ağır organ yetmezliği / immünsüpresyon öyküsü</small></span><span class="opts">${AP_CHRONIC.map(([l], i) => `<i class="${ch === i ? "on" : ""}" ${st.apSigned ? "" : `data-apch="${i}"`}>${l}</i>`).join("")}</span><span class="p">${ch != null ? AP_CHRONIC[ch][1] : "—"}</span></div>
        <div class="pt-tot"><div class="scoreBadge"><b>${tot ?? base + "+"}</b><small>APACHE II</small></div>
          ${st.apSigned ? `<span class="pt-signed">✓ ${esc(st.apSigned.by)} · ${st.apSigned.at} · salt okunur</span>` : H.can("scores_sign") ? `<button class="btn p" data-act="ap-sign" ${tot == null ? "disabled" : ""}>${H.icon("ok")}Mühürle</button><span class="mute" style="font-size:12.5px">${tot == null ? "eksik madde var" : "tüm maddeler tamam"}</span>` : `<button class="btn" disabled>Hekim onayı bekliyor</button>`}</div>${note}</div>`;
    }
    const gcsDay1 = { p1:11, p2:14, p3:15, p5:15 }[p.id] ?? 15, tot = base + (15 - gcsDay1);
    return `<div class="box" style="margin-top:12px"><h5>APACHE II <span class="r mute">salt okunur</span></h5>
      <div class="pt-row" style="align-items:baseline"><b style="font:700 26px 'Space Grotesk'">${tot}</b><span class="mute" style="font-size:12.5px">1. gün hesaplandı (${TODAY - p.admitDays + 1}.09) · bir kez hesaplanır · ${esc(H.userBy(p.attending).name)} onayladı</span></div>
      <details style="margin-top:8px"><summary class="mute" style="cursor:pointer;font-size:12.5px">Maddeleri göster</summary>${rowHtml}<div class="pt-ap"><span>Glasgow Koma Skoru</span><span class="v">${gcsDay1}</span><span class="s">hekim</span><span class="p">${15 - gcsDay1}</span></div><div class="pt-ap"><span>Kronik sağlık durumu</span><span class="v">Yok</span><span class="s">hekim</span><span class="p">0</span></div></details>${note}</div>`;
  }
  const news2Pts = (p) => { const now = p.news2 ?? 0, st = Math.max(0, now - ({ crit:6, high:3, mid:1 }[p.risk] || 0)), rnd = seeded(seedOf(p.id + "n2"));
    return [-24, -20, -16, -12, -8, -4, 0].map((t, i, a) => ({ t, v:i === a.length - 1 ? now : Math.max(0, Math.round(st + (now - st) * Math.pow(i / (a.length - 1), 1.6) + (rnd() - .5) * 1.2)) })); };
  const NEWS2_RESP = [[0, 0, "En az 12 saatte bir izlem"], [1, 4, "En az 4–6 saatte bir izlem · sorumlu hemşire değerlendirmesi"], [5, 6, "En az saatlik izlem · acil hekim değerlendirmesi önerilir"], [7, 99, "Sürekli izlem · acil/kritik bakım ekibi değerlendirmesi önerilir"]];
  function news2Card(p, withResp) {
    const cur = p.news2 ?? 0;
    return `<div class="box" style="margin-top:12px"><h5>NEWS2 geçmişi · son 24 saat <span class="r mute">motor hesapladı · 4 saatlik</span></h5>
      <svg class="pt-big" data-n2></svg>
      <div class="pt-leg"><span><i style="background:var(--band-al)"></i>7 ve üzeri</span><span><i style="background:var(--att);border:1px solid var(--attLine)"></i>5–6</span></div>
      ${withResp ? `<div style="margin-top:10px">${NEWS2_RESP.map(([a, b, t]) => { const on = cur >= a && cur <= b; return `<div class="kv" style="${on ? "color:var(--ink);font-weight:700" : "color:var(--mute)"}"><span>${on ? "▶ " : ""}${b === 99 ? "7+" : a === b ? a : a + "–" + b}</span><span style="text-align:right">${t}</span></div>`; }).join("")}
        <div class="mute" style="font-size:12px;margin-top:4px">Tek parametrede 3 puan: en az saatlik izlem, hekime bilgi önerilir.</div>
        <div class="mute" style="font-size:11.5px;margin-top:4px">Puan tablosu: NEWS2 (RCP 2017)${H.adminNote(" · hastanenin onayı gerekir")} · öneri, karar hekimindir.</div></div>` : ""}</div>`;
  }
  const afterN2 = (root, p) => { const svg = root.querySelector("[data-n2]"); if (!svg) return;
    H.lineChart(svg, { series:[{ pts:news2Pts(p), color:H.cssVar("--pri"), width:2, dots:true }], lo:0, hi:20, bands:[[7, 20, H.cssVar("--band-al")], [5, 7, H.cssVar("--att")]], ticks:[0, 5, 7, 20], hours:24, height:140, xLabels:true, xTicks:xTicksFor(24) }); };
  function tabSkor(p) {
    const u = unitOf(p);
    if (p.ageGroup === "neonate") return `<div class="g2"><div class="box"><h5>nSOFA · yenidoğan organ yetmezliği</h5><div class="pt-row"><div class="scoreBadge"><b>${p.nsofa}</b><small>nSOFA</small></div><span class="mute" style="font-size:12.5px">motor hesapladı · 21:40</span></div>
        ${H.adminNote("Puan tablosu arşive alınacak · madde ayrıntısı o zaman gösterilecek. Hastanenin onayı gerekir.", "div")}</div>
      <div class="box"><h5>SNAPPE II · bilgi</h5><div class="kv"><span>Doğum ağırlığı</span><b>${p.birthWeight} g</b></div><div class="kv"><span>Gebelik haftası</span><b>${p.gestWeeks} hf</b></div><div class="kv"><span>Yaş</span><b>${p.ageDays} gün</b></div>
        <div class="mute" style="font-size:12.5px;margin-top:8px">SNAPPE II, yatışın ilk 12 saatinin en kötü değerlerinden bir kez hesaplanır.</div><div class="note" style="margin-top:8px">Puan tablosu arşive alınacak.</div></div></div>`;
    if (p.ageGroup === "child") return `<div class="box"><h5>PEWS · çocuk erken uyarı</h5><div class="pt-row"><div class="scoreBadge"><b>${p.pews}</b><small>PEWS</small></div><span class="mute" style="font-size:12.5px">son hesaplama ${lastTxt(p.id, "vitals")} · vital bulgulardan</span></div>
      <div class="note" style="margin-top:10px">Puan tablosu arşive alınacak · hastanenin kullandığı PEWS sürümü seçilince madde ayrıntısı ve yanıt önerisi gösterilecek.</div></div>`;
    if (u.type === "icu") return sofaCard(p) + apacheCard(p) + news2Card(p, false);
    return news2Card(p, true);
  }

  /* ---------- Takip (saatlik ızgara 08:00 → 08:00) ---------- */
  const KIND_RANK = { form:0, med:1, care:2, lab:3 }, KIND_NAME = { form:"Formlar", med:"İlaçlar", care:"Bakım", lab:"Laboratuvar" };
  const cellIcon = (x) => x.state === "miss" ? `<span class="pt-c no" title="uygulanmadı">${H.icon("x")}</span>` : x.state === "done" ? (x.given === false ? `<span class="pt-c no" title="uygulanmadı">${H.icon("x")}</span>` : `<span class="pt-c done">${H.icon("ok")}</span>`)
    : x.state === "late" ? `<span class="pt-c late">${H.icon("clock")}</span>` : x.state === "due" ? `<span class="pt-c due">${H.icon("clock")}</span>` : `<span class="pt-c plan"></span>`;
  let TK = [];                       // son çizilen ızgaradaki görev nesneleri (tıklama için)
  function tabTakip(p) {
    ensureMedTasks(p); const all = H.data.tasks.filter(t => t.pid === p.id);
    TK = all;
    const groups = {};
    all.forEach(t => { (groups[t.label] = groups[t.label] || []).push(t); });
    const rows = Object.entries(groups).sort((a, b) => (KIND_RANK[a[1][0].kind] - KIND_RANK[b[1][0].kind]) || (Math.min(...a[1].map(x => x.t)) - Math.min(...b[1].map(x => x.t))));
    const cols = Array.from({ length:24 }, (_, i) => 8 + i);
    let lastKind = null, body = "";
    rows.forEach(([label, list]) => {
      const k = list[0].kind;
      if (k !== lastKind) { body += `<tr class="gh"><td class="lb">${KIND_NAME[k]}</td><td colspan="24"></td></tr>`; lastKind = k; }
      body += `<tr><td class="lb" title="${esc(label)}">${esc(label)}<small>${list.length} kez · ${list.filter(x => x.state === "done").length} tamam</small></td>${cols.map(c => {
        const here = list.filter(x => Math.floor(x.t) === c); const nc = c === Math.floor(NOW) ? "nowc" : "";
        if (!here.length) return `<td class="${nc}"></td>`;
        const x = here.find(y => y.state !== "done") || here[0], i = TK.indexOf(x);
        return `<td class="${nc}" data-task="${i}" title="${esc(label)} · ${clk(x.t)} · ${({ done:x.given === false ? "uygulanmadı" : "tamam", miss:"uygulanmadı", late:"gecikti", due:"zamanı geldi", plan:"planlı" })[x.state]}">${cellIcon(x)}</td>`; }).join("")}</tr>`;
    });
    const late = all.filter(t => t.state === "late").length, due = all.filter(t => t.state === "due").length;
    return `<div class="pt-row" style="margin-bottom:8px"><span class="mute" style="font-size:12.5px">Nöbet <b class="mono">${H.SHIFT.start} → ${H.SHIFT.end}</b> · şimdi <b style="color:var(--crit)">${H.nowFull()}</b> · <b style="color:var(--crit)">${late}</b> gecikmiş · <b style="color:var(--pri)">${due}</b> zamanı gelen</span></div>
      <div class="pt-gw"><table class="pt-grid"><thead><tr><th class="lb">Görev<small style="display:block;font:700 9px Figtree;color:var(--pri)">${H.wd(0)} ${H.dm(0)} → ${H.wd(1)} ${H.dm(1)}</small></th>${cols.map(c => `<th class="${c === Math.floor(NOW) ? "nowc" : ""}" style="${c === 24 ? "border-left:2px solid var(--line2)" : ""}">${c === 8 || c === 24 ? `<small style="display:block;font:700 9px Figtree;color:var(--pri);white-space:nowrap">${H.dm(c === 24 ? 1 : 0)}</small>` : ""}${String(c % 24).padStart(2, "0")}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="pt-leg" style="margin-top:10px"><span><span class="pt-c done" style="width:18px;height:18px">${H.icon("ok")}</span> tamam</span><span><span class="pt-c late" style="width:18px;height:18px">${H.icon("clock")}</span> gecikti</span><span><span class="pt-c due" style="width:18px;height:18px;animation:none">${H.icon("clock")}</span> zamanı geldi</span><span><span class="pt-c plan" style="width:18px;height:18px"></span> planlı</span><span><span class="pt-c no" style="width:18px;height:18px">${H.icon("x")}</span> uygulanmadı</span><span style="color:var(--crit)">│ şimdi</span></div>
      <div class="mute" style="font-size:11.5px;margin-top:6px">Hücreye dokunun: form açılır, ilaç için uygulama kaydı, bakım/numune için tamamlama. Satırı sola kaydırarak gece saatlerini görün.</div>`;
  }

  /* ---------- ilaç uygulama kaydı (Takip ve İlaç ortak) ---------- */
  const NOT_GIVEN = ["Hasta reddetti", "Hasta bölümde değil (tetkikte)", "Ağızdan alamıyor / aç", "İlaç eczaneden gelmedi", "Hekim bekletti", "Diğer"];
  function medDialog(p, d, onDone) {
    if (H.medAct) return H.medAct(d, { onDone });                 // 30.09: Görevlerim ile aynı tek uygulama penceresi (nursing.js)
    if (d.state === "done") { H.toast(d.given === false ? `Uygulanmadı · ${d.reason || ""}` : `Uygulandı · ${doneAt(d)}${d.by ? " · " + d.by : ""}`); return; }
    const allergy = p.allergies.length ? `<div class="note" style="margin-bottom:10px">Alerji kaydı: ${p.allergies.map(esc).join(", ")} · kayıt gösterilir, karar hekimin.</div>` : "";
    H.modal({ title:`${esc(d.label)} · ${clk(d.t)}`, body:`${allergy}<div class="kv"><span>Hasta</span><b>${esc(H.bed(p.bed).no)} · ${esc(pname(p))}</b></div><div class="kv"><span>Planlanan saat</span><b>${clk(d.t)}</b></div><div class="kv"><span>Kaynak</span><b>hastane kaydı</b></div>
      <div style="margin-top:12px" class="fld col"><label>Uygulanmadıysa neden</label><div class="opts" data-rs>${NOT_GIVEN.map(r => `<i>${r}</i>`).join("")}</div></div>`,
      actions:`<button class="btn g" data-x>${H.t("cancel")}</button><button class="btn" data-m="later">Ertele · 30 dk</button><button class="btn" data-m="no">Uygulanmadı</button><button class="btn p" data-m="yes">${H.icon("ok")}Uygulandı</button>`,
      onMount(m) { let reason = null;
        m.addEventListener("click", (e) => {
          const r = e.target.closest("[data-rs] i"); if (r) { reason = r.textContent; m.querySelectorAll("[data-rs] i").forEach(x => x.classList.toggle("on", x === r)); return; }
          const b = e.target.closest("[data-m]"); if (!b) return;
          const bed = H.bed(p.bed).no;
          if (b.dataset.m === "yes") { d.state = "done"; d.given = true; d.doneAt = H.now(); d.by = me(); H.log("İlaç uygulandı", `${bed} · ${d.label} · ${clk(d.t)}`); H.toast("Uygulandı olarak kaydedildi · " + H.now()); }
          else if (b.dataset.m === "no") { if (!reason) { H.toast("Uygulanmadı için neden seçin", "w"); return; } d.state = "done"; d.given = false; d.reason = reason; d.doneAt = H.now(); d.by = me(); H.log("İlaç uygulanmadı", `${bed} · ${d.label} · ${reason}`); H.toast("Uygulanmadı · " + reason, "w"); }
          else { d.state = "plan"; d.deferred = clk(NOW + 0.5); H.log("İlaç ertelendi", `${bed} · ${d.label} → ${d.deferred}`); H.toast("30 dk ertelendi · " + d.deferred, "w"); }
          H.closeModal(); onDone && onDone(); }); } });
  }
  function taskClick(p, x, refresh) {
    if (!x) return;
    if (x.kind === "form") { H.forms.open(x.form, p.id); return; }
    if (x.kind === "med") { medDialog(p, x, refresh); return; }
    if (x.state === "done" || x.state === "miss") { H.toast(`Tamamlandı · ${doneAt(x)}`); return; }
    x.state = "done"; x.doneAt = H.now(); x.by = me();
    H.log(x.kind === "lab" ? "Numune alındı" : "Bakım tamamlandı", `${H.bed(p.bed).no} · ${x.label}`);
    H.toast(`${x.label} · tamamlandı ${H.now()}`); refresh();
  }

  /* ---------- İlaç ---------- */
  function tabIlac(p) {
    const meds = medsFor(p), doses = dosesOf(p);
    const doseChip = (d) => `<span class="pt-dose ${notGiven(d) ? "no" : d.state}" data-dose="${doses.indexOf(d)}" title="${esc(d.label)}">${clk(d.t)}${notGiven(d) ? " ✕" : d.state === "done" ? " ✓" : ""}${d.deferred ? " → " + d.deferred : ""}</span>`;
    const rows = meds.map(m => {
      let mar = "";
      if (m.kind === "task") mar = doses.filter(d => !d.med && d.label === m.name).sort((a, b) => a.t - b.t).map(doseChip).join("");
      else if (m.kind === "sched") mar = doses.filter(d => d.med === m.id).sort((a, b) => a.t - b.t).map(doseChip).join("");
      else if (m.kind === "inf") mar = `<span class="pt-dose done">sürekli · ${esc(m.since)}'ten beri</span>`;
      else mar = `<span class="pt-dose done">son: ${esc(m.last)} ✓</span><button class="btn sm" data-prn="${esc(m.id)}">Uygula (gerekirse)</button>`;
      return `<div class="pt-med"><div><b>${esc(m.name)}</b><div class="f">${esc(m.freq)} · başlangıç ${esc(m.start)} · ${esc(H.userBy(m.by).name)}</div></div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;align-items:flex-start"><span class="pill">${esc(m.src)}</span>${m.kind === "inf" ? `<span class="pill">${H.icon("activity")}infüzyon</span>` : ""}</div>
        <div class="pt-mar">${mar}</div></div>`;
    }).join("");
    return `${p.allergies.length ? `<div class="note" style="margin-bottom:12px">${H.icon("alert").replace("<svg", '<svg style="width:14px;height:14px;vertical-align:-2px"')} Alerji kaydı: ${p.allergies.map(esc).join(", ")} · kayıt gösterilir, karar hekimin.</div>` : ""}
      <div class="box"><h5>Aktif order'lar ve uygulama çizelgesi · bugün 08:00 → yarın 08:00 <span class="r mute">order hastane kaydından gelir · burada değiştirilmez</span></h5>
        ${rows || `<div class="empty">Aktif ilaç order'ı yok.</div>`}</div>
      <div class="pt-leg"><span><span class="pt-dose done">✓</span> uygulandı</span><span><span class="pt-dose late">saat</span> gecikti</span><span><span class="pt-dose due" style="animation:none">saat</span> zamanı geldi</span><span><span class="pt-dose plan">saat</span> planlı</span><span>dozlara dokunun → uygulama kaydı</span></div>
      <div class="mute" style="font-size:11.5px;margin-top:6px">Sistem doz önermez. Gösterilen doz ve sıklık hekimin hastane kaydındaki order'ıdır.</div>`;
  }

  /* ---------- Sıvı ---------- */
  // 30.09 · kontrol §4-3: tek defter — sıvı ızgarası (careplan.js H.fluidGrid, H.data.ioGrid). Form ve ızgara girişleri aynı yere yazar;
  // buradaki kutular ve grafik oradan hesaplanır. Izgara modülü yüklenmediyse eski sentetik gösterime düşer.
  const ioSum = (p) => {
    if (H.fluidGrid && H.fluidGrid.summary) return H.fluidGrid.summary(p);
    const io = ioOf(p), tin = io.reduce((a, r) => a + r.i, 0), tout = io.reduce((a, r) => a + r.o, 0), split = (v, a) => a.map(x => Math.round(v * x));
    const [iv, ent, blood] = split(tin, [.72, .18, .10]), [uri, drn, oth] = split(tout, [.94, 0, .06]);
    return { rows:io, tin, tout, bal:tin - tout, uokg:io.slice(-6).reduce((a, r) => a + r.o, 0) / 6 / p.weight, iv, ent, blood, inOth:0, uri, drn, outOth:oth, last:null, since:null };
  };
  function tabSivi(p) {
    const S = ioSum(p), f = (n) => Math.round(n).toLocaleString("tr-TR"), per = S.since ? `${S.since}'den beri` : "24 sa";
    return `<div class="g4" style="margin-bottom:12px">
        <div class="box"><h5>Aldığı · ${per}</h5><b style="font:700 24px 'JetBrains Mono'">${f(S.tin)}</b> <span class="mute">mL</span></div>
        <div class="box"><h5>Çıkardığı · ${per}</h5><b style="font:700 24px 'JetBrains Mono'">${f(S.tout)}</b> <span class="mute">mL</span></div>
        <div class="box"><h5>Denge</h5><b style="font:700 24px 'JetBrains Mono';color:${Math.abs(S.bal) > 1500 ? "var(--attInk)" : "var(--ink)"}">${S.bal > 0 ? "+" : ""}${f(S.bal)}</b> <span class="mute">mL</span></div>
        <div class="box"><h5>İdrar · son 6 sa</h5><b style="font:700 24px 'JetBrains Mono'">${S.uokg.toFixed(1)}</b> <span class="mute">mL/kg/sa</span></div></div>
      <div class="box pt-io"><h5>${S.since ? `Saatlik aldığı / çıkardığı · bugün ${S.since}'den beri` : "Saatlik aldığı / çıkardığı · son 24 saat"} <span class="r"><button class="btn p sm" data-form="io">${H.icon("plus")}Aldığı–çıkardığı gir</button></span></h5>
        <svg data-io></svg>
        <div class="pt-leg"><span><i style="background:var(--pri)"></i>aldığı</span><span><i style="background:var(--mid)"></i>çıkardığı</span><span><i style="background:var(--ink);height:2px"></i>kümülatif denge</span><span>çubuğun üzerinde durun → saat değeri</span></div></div>
      <div class="g2" style="margin-top:12px"><div class="box"><h5>Aldığı</h5><div class="kv"><span>IV sıvı / infüzyon</span><b>${f(S.iv)} mL</b></div><div class="kv"><span>${p.ageGroup === "neonate" ? "Enteral beslenme" : "Oral / enteral"}</span><b>${f(S.ent)} mL</b></div>${S.blood ? `<div class="kv"><span>Kan ürünleri</span><b>${f(S.blood)} mL</b></div>` : ""}${S.inOth ? `<div class="kv"><span>Diğer</span><b>${f(S.inOth)} mL</b></div>` : ""}</div>
        <div class="box"><h5>Çıkardığı</h5><div class="kv"><span>İdrar</span><b>${f(S.uri)} mL</b></div>${S.drn ? `<div class="kv"><span>Dren</span><b>${f(S.drn)} mL</b></div>` : ""}<div class="kv"><span>Diğer (kusma, gaita, NG)</span><b>${f(S.outOth)} mL</b></div></div></div>
      <div class="mute" style="font-size:11.5px;margin-top:6px">Kaynak: aşağıdaki sıvı izlem ızgarası (pompa + hemşire girişi ve Aldığı–çıkardığı formu) · ${S.last ? `son giriş <b>${esc(S.last.at)}</b> · <span data-notr>${esc(S.last.by)}</span>` : "son giriş —"}</div>`;
  }
  function afterSivi(root, p) {
    const svg = root.querySelector("[data-io]"); if (!svg) return;
    const io = ioSum(p).rows, W = svg.clientWidth || 600, h = 220, pl = 40, pr = 40, pt = 10, pb = 22, n = io.length;
    const mxBar = Math.max(...io.map(r => Math.max(r.i, r.o))) * 1.1;
    let cum = 0; const cumA = io.map(r => (cum += r.i - r.o));
    const cmx = Math.max(...cumA.map(Math.abs), 1) * 1.15, mid = pt + (h - pt - pb) / 2, half = (h - pt - pb) / 2;
    const bw = (W - pl - pr) / n, x = (i) => pl + i * bw;
    const yb = (v) => v / mxBar * half, yc = (v) => mid - v / cmx * half;
    const pri = H.cssVar("--pri"), mdc = H.cssVar("--mid"), ink = H.cssVar("--ink"), mute = H.cssVar("--mute"), grid = H.cssVar("--grid");
    let s = `<line x1="${pl}" x2="${W - pr}" y1="${mid}" y2="${mid}" stroke="${grid}"/>`;
    s += `<text x="${pl - 5}" y="${pt + 8}" text-anchor="end" font-size="9.5" fill="${mute}">${Math.round(mxBar)}</text><text x="${pl - 5}" y="${mid + 3}" text-anchor="end" font-size="9.5" fill="${mute}">0</text><text x="${pl - 5}" y="${h - pb}" text-anchor="end" font-size="9.5" fill="${mute}">${Math.round(mxBar)}</text>`;
    s += `<text x="${W - pr + 5}" y="${pt + 8}" font-size="9.5" fill="${mute}">+${Math.round(cmx)}</text><text x="${W - pr + 5}" y="${h - pb}" font-size="9.5" fill="${mute}">−${Math.round(cmx)}</text>`;
    io.forEach((r, i) => { const w = Math.max(2, bw * .36);
      s += `<g><title>${String(r.h).padStart(2, "0")}:00 · aldığı ${r.i} mL · çıkardığı ${r.o} mL · denge ${cumA[i] > 0 ? "+" : ""}${cumA[i]} mL</title><rect x="${x(i)}" y="${pt}" width="${bw}" height="${h - pt - pb}" fill="transparent"/>`
        + `<rect x="${x(i) + bw * .5 - w}" y="${mid - yb(r.i)}" width="${w}" height="${yb(r.i)}" rx="2" fill="${pri}" opacity=".85"/>`
        + `<rect x="${x(i) + bw * .5}" y="${mid}" width="${w}" height="${yb(r.o)}" rx="2" fill="${mdc}" opacity=".85"/></g>`;
      if (i % (W < 500 ? 6 : 3) === 0) s += `<text x="${x(i) + bw / 2}" y="${h - 6}" text-anchor="middle" font-size="10" fill="${mute}">${String(r.h).padStart(2, "0")}</text>`; });
    s += `<path d="${cumA.map((v, i) => `${i ? "L" : "M"}${(x(i) + bw / 2).toFixed(1)},${yc(v).toFixed(1)}`).join("")}" fill="none" stroke="${ink}" stroke-width="2" stroke-linejoin="round" pointer-events="none"/>`;
    svg.setAttribute("viewBox", `0 0 ${W} ${h}`); svg.setAttribute("height", h); svg.innerHTML = s;
  }

  /* ---------- Sonuçlar ---------- */
  const RAD = {
    p1:[{ n:"Akciğer grafisi (yatak başı AP)", st:3, t:"18:50", rep:"Sağ alt zonda konsolidasyonla uyumlu opasite. Sağ sinüs kapalı; az miktarda plevral sıvı ile uyumlu olabilir. Kalp gölgesi normal sınırlarda. 21.09 grafisine göre sağ alt zonda artış." },
        { n:"Toraks BT (kontrastsız)", st:1, t:"19:15", wait:"çekim bekleniyor · sırada 2. hasta" }],
    p2:[{ n:"Akciğer grafisi (PA)", st:4, t:"09:20", rep:"Her iki akciğerde havalanma artışı, diyafram kubbeleri düzleşmiş. Aktif infiltrasyon ayırt edilmedi." }],
    p3:[{ n:"Üriner sistem USG", st:4, t:"11:05", rep:"Her iki böbrek boyutu normal, parankim ekojenitesi grade 1 artmış. Hidronefroz saptanmadı." }],
    p4:[{ n:"Akciğer grafisi (postoperatif)", st:4, t:"07:30", rep:"Santral venöz kateter ucu vena kava superior projeksiyonunda. Pnömotoraks yok. Bazal atelektatik bantlar." }],
    p5:[{ n:"Akciğer grafisi (PA)", st:4, t:"10:10", rep:"Kardiyotorasik oran normal. Akciğer parankimi olağan." }],
    p6:[{ n:"Üriner sistem USG", st:3, t:"15:40", rep:"Mesane duvarı düzensiz, kalınlaşmış görünümde. Hidronefroz saptanmadı." }],
    p7:[{ n:"Akciğer grafisi (PA)", st:4, t:"08:45", rep:"Kardiyotorasik oran artmış. Bilateral az miktarda plevral sıvı, vasküler redistribüsyon." }],
    p9:[{ n:"Akciğer grafisi (PA)", st:3, t:"17:20", rep:"Sol alt zonda infiltrasyonla uyumlu dansite artışı." }],
    p10:[{ n:"Batın USG (preoperatif)", st:4, t:"22.09 14:00", rep:"Safra kesesi lümeninde en büyüğü 14 mm taşlar. Duvar kalınlığı normal." }],
    p11:[{ n:"Akciğer grafisi", st:4, t:"12:30", rep:"Bilateral peribronşiyal kalınlaşma, havalanma artışı. Konsolidasyon izlenmedi." }],
    p13:[{ n:"Akciğer grafisi (yenidoğan)", st:4, t:"08:15", rep:"Bilateral buzlu cam görünümü, hava bronkogramları. Önceki grafiye göre belirgin değişiklik yok." }],
  };
  const PATO = { p4:[{ n:"Kolon rezeksiyon materyali", since:1 }], p10:[{ n:"Kolesistektomi materyali", since:1 }] };
  // q.t = sonucun onay saati; istem / numune / kabul ondan önce
  const labTimes = (p, q, i) => ({ istem:clk(NOW + q.t - 1.4), numune:clk(NOW + q.t - 1.15), kabul:clk(NOW + q.t - 0.9), onay:clk(NOW + q.t),
    by:(i % 3 === 1 ? H.userBy("rrt.emil") : H.userBy(p.attending)).name });
  function tabSonuc(p) {
    const st = S(p.id), sub = st.resTab;
    const seg = `<div class="seg" data-rt style="margin-bottom:12px">${[["lab", "Laboratuvar"], ["rad", "Radyoloji"], ["pat", "Patoloji"]].map(([k, l]) => `<button data-v="${k}" class="${sub === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
    if (sub === "rad") return seg + radTab(p);
    if (sub === "pat") {
      const L = PATO[p.id] || [];
      return seg + (L.length ? L.map(r => `<div class="box"><h5>${esc(r.n)} <span class="r"><span class="pill">bekliyor · ${r.since}. gün</span></span></h5>
          <div class="pt-tl"><span class="done">Alındı</span><span class="now">Değerlendiriliyor</span><span>Rapor</span><span>Görüldü</span></div>
          <label class="pt-row" style="margin-top:8px;font-size:13px;cursor:pointer"><input type="checkbox" data-patn ${st.patoNotify ? "checked" : ""} style="width:auto"> Sonuç gelince bildirim (sorumlu hekim + bana)</label></div>`).join("")
        : `<div class="empty">Bekleyen patoloji incelemesi yok.</div>`);
    }
    const defs = labDefs(p);
    return seg + `<div class="tw"><table class="t pt-lab"><thead><tr><th>Tetkik</th><th>Son</th><th></th><th>Referans</th><th>7 gün</th><th>Saat</th></tr></thead><tbody>
      ${defs.map(d => { const h = labHist(p, d), last = h[h.length - 1], fl = flagOf(p, d, last.v), ref = refFor(p, d), seen = seenOf(p, d);
        return `<tr class="row" data-lab="${d.k}"><td><b>${d.n}</b>${seen ? "" : `<span class="pt-new">yeni</span>`}</td>
          <td class="n" style="${fl.crit ? "color:var(--crit)" : ""}">${last.v} <span class="mute" style="font:600 11px Figtree">${d.u}</span></td>
          <td><span class="pt-flag ${fl.cls}">${fl.f}</span></td><td class="mono mute" style="font-size:12px;white-space:nowrap">${ref[0]}–${ref[1]}</td>
          <td>${H.spark(h.map(q => q.v), fl.crit ? H.cssVar("--crit") : fl.cls ? H.cssVar("--high") : H.cssVar("--pri"))}</td><td class="mono mute" style="font-size:12px;white-space:nowrap">${stamp(last.t)}</td></tr>`; }).join("")}
      </tbody></table></div>
      <div class="mute" style="font-size:11.5px;margin-top:6px">Kaynak: laboratuvar kaydı · referans aralıkları ve kritik değer sınırları laboratuvarın bildirdiğidir (örnek). Satıra dokunun → grafik / tablo.</div>`;
  }
  function openLab(p, k, refresh) {
    const d = LABDEF.find(x => x.k === k), st = S(p.id);
    const draw = (m) => {
      const h = labHist(p, d), last = h[h.length - 1], ref = refFor(p, d), fl = flagOf(p, d, last.v), seen = seenOf(p, d), tm = labTimes(p, last, h.length - 1), view = st.labView;
      const steps = [["İstendi", tm.istem], ["Numune", tm.numune], ["Çalışıldı", tm.kabul], ["Sonuç", tm.onay], ["Görüldü", seen ? seen.at : ""]];
      m.querySelector(".mb").innerHTML = `<div class="pt-row" style="margin-bottom:8px"><b style="font:700 26px 'JetBrains Mono';${fl.crit ? "color:var(--crit)" : ""}">${last.v}</b><span class="mute">${d.u}</span><span class="pt-flag ${fl.cls}">${fl.f}${fl.crit ? " kritik" : ""}</span>
          <span class="mute" style="font-size:12.5px">ref ${ref[0]}–${ref[1]} · ${stamp(last.t)}</span>
          <div class="seg" data-lv style="margin-left:auto"><button data-v="graf" class="${view === "graf" ? "on" : ""}">${H.icon("chart")}Grafik</button><button data-v="tab" class="${view === "tab" ? "on" : ""}">${H.icon("list")}Tablo</button></div></div>
        ${view === "graf" ? `<div class="pt-hov" data-ro></div><svg class="pt-big" data-lab></svg><div class="pt-leg"><span><i style="background:var(--band-n)"></i>referans aralığı</span><span>• sonuç · kesikli çizgi: ölçümler arası</span></div>`
          : `<div class="tw"><table class="t"><thead><tr><th>Tarih</th><th>Sonuç</th><th>H/L</th><th>Referans</th><th>Durum</th><th>İsteyen</th><th>İstem</th><th>Kabul</th><th>Onay</th></tr></thead><tbody>
            ${h.slice().reverse().map((q, j) => { const i = h.length - 1 - j, f = flagOf(p, d, q.v), t = labTimes(p, q, i); return `<tr><td class="mono" style="white-space:nowrap">${stamp(q.t)}</td><td class="n" style="${f.crit ? "color:var(--crit)" : ""}">${q.v}</td><td><span class="pt-flag ${f.cls}">${f.hl}</span></td><td class="mono mute">${ref[0]}–${ref[1]}</td><td>Uzman onay</td><td style="white-space:nowrap">${esc(t.by)}</td><td class="mono">${t.istem}</td><td class="mono">${t.kabul}</td><td class="mono">${t.onay}</td></tr>`; }).join("")}
          </tbody></table></div>`}
        <div class="sec" style="margin-top:14px">Tetkik yolculuğu <small>son istem · ${esc(tm.by)}</small></div>
        <div class="pt-tl">${steps.map(([l, t], i) => `<span class="${i < 4 || seen ? "done" : "now"}">${l}<small>${t || "bekliyor"}</small></span>`).join("")}</div>
        <div class="pt-row" style="margin-top:10px">${seen ? `<span class="pt-signed">✓ Görüldü · ${esc(seen.by)} · ${seen.at}</span>` : `<button class="btn p" data-lseen>${H.icon("eye")}Gördüm</button><span class="mute" style="font-size:12.5px">Görülme kaydı denetim izine yazılır.</span>`}</div>`;
      if (view === "graf") {
        const svg = m.querySelector("[data-lab]"), vals = h.map(q => q.v), lo0 = Math.min(ref[0], ...vals), hi0 = Math.max(ref[1], ...vals), pad = (hi0 - lo0) * .15 || 1;
        const lo = r1(Math.max(0, lo0 - pad), d.d), hi = r1(hi0 + pad, d.d), ro = m.querySelector("[data-ro]");
        const xt = []; for (let dd = -6; dd <= 0; dd++) xt.push([dd * 24 - NOW + 12, `${TODAY + dd}.09`]);
        ro.innerHTML = "Noktaların üzerinde gezinin";
        H.lineChart(svg, { series:[{ pts:h, color:fl.crit ? H.cssVar("--crit") : H.cssVar("--pri"), width:2, dots:true }], lo, hi, bands:[[ref[0], ref[1], H.cssVar("--band-n")]], ticks:[lo, ref[0], ref[1], hi], t0:-(6 * 24) - NOW, t1:24 - NOW, height:240, xLabels:true, xTicks:xt,
          onHover:(t) => { if (t == null) { ro.innerHTML = "Noktaların üzerinde gezinin"; return; } const q = nearest(h, t); ro.innerHTML = `<b>${stamp(q.t)}</b> · ${d.n} <b>${q.v}</b> ${d.u} ${flagOf(p, d, q.v).hl}`; } });
        const path = svg.querySelector("path"); if (path) path.setAttribute("stroke-dasharray", "4 4");
      }
    };
    H.modal({ title:`${esc(d.n)} · ${esc(H.bed(p.bed).no)} ${esc(pname(p))}`, body:"", wide:true, onMount(m) {
      draw(m);
      m.addEventListener("click", (e) => {
        const v = e.target.closest("[data-lv] button"); if (v) { st.labView = v.dataset.v; draw(m); return; }
        if (e.target.closest("[data-lseen]")) { st.seen[d.k] = { by:me(), at:H.now() }; H.log("Sonuç görüldü", `${H.bed(p.bed).no} · ${d.n}`); H.toast(`${d.n} · görüldü olarak işaretlendi`); draw(m); refresh(); }
      }); } });
  }

  /* ---------- Devir notu (D-Ö-D-Ö) ---------- */
  function devirDraft(p) {
    const v = p.v, L = pv(p), abn = labDefs(p).map(d => { const h = labHist(p, d), last = h[h.length - 1], f = flagOf(p, d, last.v); return f.f ? `${d.n} ${last.v}${f.f}` : null; }).filter(Boolean).slice(0, 4);
    const open = H.data.tasks.filter(t => t.pid === p.id && t.state !== "done" && t.t < 26).sort((a, b) => a.t - b.t).slice(0, 3).map(t => `${clk(t.t)} ${t.label}`);
    const sev = { crit:"kritik", high:"yüksek riskli", mid:"orta riskli", low:"düşük riskli", stable:"stabil" }[p.risk];
    return {
      d:`${sev[0].toUpperCase() + sev.slice(1)} · ${H.scoreLabel(p)}. Nabız ${v.hr}, TA ${v.sbp}/${v.dbp} (MAP ${v.map}), SpO₂ %${v.spo2} (${v.o2}), solunum ${v.rr}, ateş ${v.temp.toFixed(1)}. Bilinç: ${v.loc}.`,
      o:`Yatışın ${p.admitDays}. günü · ${p.dx} (${p.icd}).${p.chronic.length ? " Kronik: " + p.chronic.join(", ") + "." : ""}${p.allergies.length ? " Alerji: " + p.allergies.join(", ") + "." : " Bilinen alerji yok."}${p.antibioticDay ? ` Antibiyotik ${p.antibioticDay}. gün.` : ""}`,
      g:`${abn.length ? "Referans dışı sonuçlar: " + abn.join(", ") + "." : "Son laboratuvar sonuçları referans aralığında."}${p.risk === "crit" || p.risk === "high" ? " Kötüleşme kriterleri karşılanıyor." : " Son 24 saatte kötüleşme kriteri yok."}${L.lac >= 2 && PREV[p.id] ? ` Laktat ${PREV[p.id].lac} → ${L.lac}.` : ""}`,
      n:`${p.risk === "crit" || p.risk === "high" ? "Hekim değerlendirmesi önerilir. " : ""}${open.length ? "Sıradaki işler: " + open.join(" · ") + "." : "Açık iş yok."}`,
    };
  }
  function tabDevir(p) {
    const st = S(p.id), dr = st.devir || (st.devir = devirDraft(p));
    const crit = H.data.alarms.filter(a => a.pid === p.id && a.state === "open" && a.sev === "crit");
    const mine = H.data.handovers.filter(h => h.pid === p.id);
    const f = (k, l) => `<label class="lab">${l}</label><textarea data-dv="${k}">${esc(dr[k])}</textarea>`;
    return `<div class="box pt-dv"><h5>Teslim notu · sistem hazırladı, düzenleyebilirsiniz <span class="r"><button class="btn g sm" data-act="dv-reset">${H.icon("swap")}Taslağı yenile</button></span></h5>
        ${f("d", "D · Durum")}${f("o", "Ö · Öykü")}${f("g", "D · Değerlendirme")}${f("n", "Ö · Öneri")}
        <div style="margin-top:12px">${crit.length ? `<div class="pt-lock">${H.icon("lock")}Teslim edilemez: bu hastada yanıtlanmamış kritik alarm var (${esc(crit[0].txt)}). Yazdıklarınız kaybolmaz; taslağı saklayın, alarmı yanıtlayınca teslim edin.<button class="btn sm" data-goalarm style="margin-left:auto">Alarma git →</button></div>` : ""}
          <div class="pt-row" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button class="btn" data-act="dv-save">${H.icon("file")}Taslağı sakla</button>
          ${crit.length ? `<button class="btn" disabled>${H.icon("lock")}Mühürle ve teslim et</button>` : `<button class="btn p" data-act="dv-sign">${H.icon("ok")}Mühürle ve teslim et</button>`}
          <span class="mute" style="font-size:12.5px">${st.devirSaved ? `Taslak saklandı · ${st.devirSaved}` : "Mühürlenen not değiştirilemez; gelen ekip teslim alır."}</span></div></div></div>
      ${mine.length ? `<div class="box" style="margin-top:12px"><h5>Bu hastanın devirleri</h5>${mine.map(h => `<div class="kv"><span>${esc(h.from)}${h.at ? " · " + h.at : ""}</span><b>${h.state === "waiting" ? "karşı imza bekliyor" : "tamamlandı"}</b></div>`).join("")}</div>` : ""}
      <div class="mute" style="font-size:11.5px;margin-top:8px">D-Ö-D-Ö: Durum · Öykü · Değerlendirme · Öneri. Taslak sistemin hazırladığı özettir; tanı içermez.</div>`;
  }

  /* ================= 24.09 (4. oturum) · "sistem neler olabilir" #3 #5 #7 #11 #19 =================
   * #3 cihaz günleri (başlık) · #5 görüntüleme zaman çizelgesi (Sonuçlar → Radyoloji) · #7 konsültasyon süreleri (Özet)
   * #11 ameliyat sonrası ilk 24 saat (Özet, post-op hasta) · #19 aile bilgilendirme kaydı (Özet).
   * Hiçbirinde klinik eşik yok: yalnız kayıtlı zaman ve ölçülmüş değer gösterilir. Sistem aileye bir şey göndermez. */
  H.addT({
    pt_obs_title:{ AZ:"Son müşahidələr", TR:"Son gözlemler", RU:"Последние наблюдения", EN:"Latest observations" },
    pt_obs_gcs:{ AZ:"QKŞ", TR:"GKS", RU:"ШКГ", EN:"GCS" },
    pt_obs_glu:{ AZ:"Qan şəkəri", TR:"Kan şekeri", RU:"Глюкоза крови", EN:"Blood glucose" },
    pt_obs_note:{ AZ:"Tibb bacısı qeydi · yalnız məlumat, şkala hesablamasına qoşulmur", TR:"Hemşire kaydı · yalnız bilgi, skor hesabına katılmaz", RU:"Запись медсестры · только информация, в расчёт шкал не входит", EN:"Nurse record · information only, not used in score calculation" },
    pt_wd_title:{ AZ:"Yara / kateter", TR:"Yara / kateter", RU:"Рана / катетер", EN:"Wound / catheter" },
    pt_wd_line:{ AZ:"{0} yara qeydi · {1} kateter / xətt", TR:"{0} yara kaydı · {1} kateter / hat", RU:"записей о ране: {0} · катетеров / линий: {1}", EN:"{0} wound records · {1} catheters / lines" },
    pt_wd_last:{ AZ:"son", TR:"son", RU:"последняя", EN:"latest" },
    pt_wd_open:{ AZ:"Yara forması", TR:"Yara formu", RU:"Форма раны", EN:"Wound form" },
    pt_dev_title:{ AZ:"Cihaz günləri", TR:"Cihaz günleri", RU:"Дни устройств", EN:"Device days" },
    pt_dev_cvc:{ AZ:"Mərkəzi venoz kateter", TR:"Santral kateter", RU:"ЦВК", EN:"Central line" },
    pt_dev_art:{ AZ:"Arterial kateter", TR:"Arter kateteri", RU:"Артериальный катетер", EN:"Arterial line" },
    pt_dev_ett:{ AZ:"İntubasiya", TR:"Entübasyon", RU:"Интубация", EN:"Intubation" },
    pt_dev_uc:{ AZ:"Sidik kateteri", TR:"Üriner kateter", RU:"Мочевой катетер", EN:"Urinary catheter" },
    pt_dev_hd:{ AZ:"Dializ kateteri", TR:"Diyaliz kateteri", RU:"Диализный катетер", EN:"Dialysis catheter" },
    pt_dev_drn:{ AZ:"Drenaj", TR:"Dren", RU:"Дренаж", EN:"Drain" },
    pt_dev_piv:{ AZ:"Periferik venoz yol", TR:"Periferik damar yolu", RU:"Периферический катетер", EN:"Peripheral IV" },
    pt_dev_src:{ AZ:"Mənbə: qulluq qeydi · taxıldığı gün 1-ci gündür", TR:"Kaynak: bakım kaydı · takıldığı gün 1. gündür", RU:"Источник: запись ухода · день установки = день 1", EN:"Source: care record · insertion day = day 1" },
    pt_u_d:{ AZ:"g", TR:"g", RU:"д", EN:"d" }, pt_u_h:{ AZ:"saat", TR:"sa", RU:"ч", EN:"h" }, pt_u_m:{ AZ:"dəq", TR:"dk", RU:"мин", EN:"min" },
    pt_today:{ AZ:"bu gün", TR:"bugün", RU:"сегодня", EN:"today" },
    // konsültasyon
    pt_cs_title:{ AZ:"Konsultasiyalar", TR:"Konsültasyonlar", RU:"Консультации", EN:"Consultations" },
    pt_cs_req:{ AZ:"İstənildi", TR:"İstendi", RU:"Запрошена", EN:"Requested" },
    pt_cs_seen:{ AZ:"Baxıldı", TR:"Görüldü", RU:"Осмотрен", EN:"Seen" },
    pt_cs_reco:{ AZ:"Tövsiyə yazıldı", TR:"Öneri yazıldı", RU:"Рекомендация записана", EN:"Recommendation written" },
    pt_cs_st_done:{ AZ:"tövsiyə yazıldı", TR:"öneri yazıldı", RU:"рекомендация записана", EN:"recommendation written" },
    pt_cs_st_seen:{ AZ:"baxıldı · tövsiyə gözlənilir", TR:"görüldü · öneri bekleniyor", RU:"осмотрен · ждём рекомендацию", EN:"seen · awaiting recommendation" },
    pt_cs_st_req:{ AZ:"istənildi · hələ baxılmayıb", TR:"istendi · henüz görülmedi", RU:"запрошена · ещё не осмотрен", EN:"requested · not yet seen" },
    pt_cs_waiting:{ AZ:"{0} gözləyir", TR:"{0} bekliyor", RU:"ждёт {0}", EN:"waiting {0}" },
    pt_cs_total:{ AZ:"ümumi {0}", TR:"toplam {0}", RU:"всего {0}", EN:"total {0}" },
    pt_cs_pending:{ AZ:"Gözləyən konsultasiya", TR:"Bekleyen konsültasyon", RU:"Ожидающая консультация", EN:"Pending consultation" },
    pt_cs_none:{ AZ:"Konsultasiya istəyi yoxdur.", TR:"Konsültasyon istemi yok.", RU:"Запросов на консультацию нет.", EN:"No consultation requests." },
    pt_cs_form:{ AZ:"Formu xəstəxana sistemində aç", TR:"Formu hastane sisteminde aç", RU:"Открыть форму в системе больницы", EN:"Open form in hospital system" },
    pt_cs_form_t:{ AZ:"Konsultasiya forması xəstəxana sistemində açılır", TR:"Konsültasyon formu hastane sisteminde açılır", RU:"Форма консультации открывается в системе больницы", EN:"The consultation form opens in the hospital system" },
    pt_cs_foot:{ AZ:"Vaxtlar xəstəxana sistemindəki istək və forma qeydlərindəndir. Formu burada yenidən yazmırıq; yalnız gözləmə müddətini göstəririk.", TR:"Zamanlar hastane sistemindeki istem ve form kayıtlarından gelir. Formu burada yeniden yazmayız; yalnız bekleme süresini gösteririz.", RU:"Время берётся из записей запроса и формы в системе больницы. Форму здесь не дублируем — показываем только время ожидания.", EN:"Times come from the request and form records in the hospital system. We don't rewrite the form; we only show how long it waited." },
    pt_dep_inf:{ AZ:"İnfeksion xəstəlikləri", TR:"Enfeksiyon hastalıkları", RU:"Инфекционные болезни", EN:"Infectious diseases" },
    pt_dep_pulm:{ AZ:"Ağciyər xəstəlikləri", TR:"Göğüs hastalıkları", RU:"Пульмонология", EN:"Pulmonology" },
    pt_dep_endo:{ AZ:"Endokrinologiya", TR:"Endokrinoloji", RU:"Эндокринология", EN:"Endocrinology" },
    pt_dep_neph:{ AZ:"Nefrologiya", TR:"Nefroloji", RU:"Нефрология", EN:"Nephrology" },
    pt_dep_gs:{ AZ:"Ümumi cərrahiyyə", TR:"Genel cerrahi", RU:"Общая хирургия", EN:"General surgery" },
    pt_dep_card:{ AZ:"Kardiologiya", TR:"Kardiyoloji", RU:"Кардиология", EN:"Cardiology" },
    pt_dep_cvs:{ AZ:"Ürək-damar cərrahiyyəsi", TR:"Kalp-damar cerrahisi", RU:"Сердечно-сосудистая хирургия", EN:"Cardiovascular surgery" },
    // radyoloji
    pt_rad_grid:{ AZ:"Görüntüləmə · müayinə × tarix", TR:"Görüntüleme · tetkik × tarih", RU:"Визуализация · исследование × дата", EN:"Imaging · study × date" },
    pt_rad_exam:{ AZ:"Müayinə", TR:"Tetkik", RU:"Исследование", EN:"Study" },
    pt_rad_unseen:{ AZ:"hesabat çıxıb, baxılmayıb", TR:"rapor çıktı, görülmedi", RU:"заключение готово, не просмотрено", EN:"report out, not seen" },
    pt_rad_seen:{ AZ:"baxıldı", TR:"görüldü", RU:"просмотрено", EN:"seen" },
    pt_rad_waitst:{ AZ:"çəkiliş gözlənilir", TR:"çekim bekleniyor", RU:"ожидает съёмки", EN:"awaiting acquisition" },
    pt_rad_queue:{ AZ:"Çəkiliş gözləyənlər", TR:"Çekim bekleyenler", RU:"Ожидают съёмки", EN:"Awaiting acquisition" },
    pt_rad_queue_none:{ AZ:"Çəkiliş gözləyən müayinə yoxdur.", TR:"Çekim bekleyen tetkik yok.", RU:"Нет исследований в очереди.", EN:"No studies waiting." },
    pt_rad_ordered:{ AZ:"istək {0}", TR:"istem {0}", RU:"запрос {0}", EN:"ordered {0}" },
    pt_rad_this:{ AZ:"Bu hesabat", TR:"Bu rapor", RU:"Это заключение", EN:"This report" },
    pt_rad_prev:{ AZ:"Eyni müayinənin əvvəlki hesabatı", TR:"Aynı tetkikin önceki raporu", RU:"Предыдущее заключение того же исследования", EN:"Previous report of the same study" },
    pt_rad_noprev:{ AZ:"Eyni müayinənin əvvəlki hesabatı yoxdur.", TR:"Aynı tetkikin önceki raporu yok.", RU:"Предыдущего заключения нет.", EN:"No previous report of this study." },
    pt_rad_src:{ AZ:"Hesabat: radioloq təsdiqli · xəstəxana qeydi", TR:"Rapor: radyoloji uzman onaylı · hastane kaydı", RU:"Заключение подтверждено рентгенологом · запись больницы", EN:"Report: radiologist-approved · hospital record" },
    pt_rad_pacs:{ AZ:"PACS-da aç", TR:"PACS'ta aç", RU:"Открыть в PACS", EN:"Open in PACS" },
    pt_rad_pacs_t:{ AZ:"Görüntünü PACS açır; bağlantı qurulanda yeni pəncərədə açılacaq", TR:"Görüntüyü PACS açar; bağlantı kurulunca yeni pencerede açılır", RU:"Изображение открывает PACS; после подключения откроется в новом окне", EN:"PACS opens the image; once connected it opens in a new window" },
    pt_rad_iseen:{ AZ:"Baxdım", TR:"Gördüm", RU:"Просмотрел(а)", EN:"Mark seen" },
    pt_rad_who:{ AZ:"Kim baxdı", TR:"Kim gördü", RU:"Кто просмотрел", EN:"Seen by" },
    pt_rad_nobody:{ AZ:"hələ heç kim", TR:"henüz kimse", RU:"пока никто", EN:"nobody yet" },
    pt_rad_notif:{ AZ:"Bildiriş: {0} · {1}", TR:"Bildirim: {0} · {1}", RU:"Уведомление: {0} · {1}", EN:"Notified: {0} · {1}" },
    pt_rad_hint:{ AZ:"Xanaya toxunun → hesabat və əvvəlki ilə müqayisə", TR:"Hücreye dokunun → rapor ve öncekiyle karşılaştırma", RU:"Нажмите на ячейку → заключение и сравнение с предыдущим", EN:"Tap a cell → report and comparison with the previous one" },
    pt_rad_none:{ AZ:"Radiologiya istəyi yoxdur.", TR:"Radyoloji istemi yok.", RU:"Запросов на исследования нет.", EN:"No imaging requests." },
    pt_rad_s1:{ AZ:"İstənildi", TR:"İstendi", RU:"Запрошено", EN:"Ordered" }, pt_rad_s2:{ AZ:"Çəkildi", TR:"Çekildi", RU:"Выполнено", EN:"Acquired" },
    pt_rad_s3:{ AZ:"Hesabat", TR:"Raporlandı", RU:"Описано", EN:"Reported" }, pt_rad_s4:{ AZ:"Baxıldı", TR:"Görüldü", RU:"Просмотрено", EN:"Seen" },
    pt_rad_img:{ AZ:"görüntü PACS-da", TR:"görüntü PACS'ta", RU:"изображение в PACS", EN:"image in PACS" },
    pt_rad_rep:{ AZ:"hesabat", TR:"rapor", RU:"заключение", EN:"report" },
    pt_rad_marked:{ AZ:"Baxıldı kimi qeyd edildi", TR:"Görüldü olarak işaretlendi", RU:"Отмечено как просмотренное", EN:"Marked as seen" },
    // ameliyat sonrası
    pt_po_title:{ AZ:"Əməliyyatdan sonrakı ilk 24 saat", TR:"Ameliyat sonrası ilk 24 saat", RU:"Первые 24 часа после операции", EN:"First 24 hours after surgery" },
    pt_po_since:{ AZ:"Əməliyyatdan bəri", TR:"Ameliyattan bu yana", RU:"После операции", EN:"Since surgery" },
    pt_po_end:{ AZ:"əməliyyatxanadan çıxış {0}", TR:"ameliyathaneden çıkış {0}", RU:"выход из операционной {0}", EN:"left theatre {0}" },
    pt_po_arr:{ AZ:"reanimasiyaya gəliş {0}", TR:"yoğun bakıma geliş {0}", RU:"поступление в ОРИТ {0}", EN:"ICU arrival {0}" },
    pt_po_over:{ AZ:"İlk 24 saat bitdi", TR:"İlk 24 saat doldu", RU:"Первые 24 часа прошли", EN:"First 24 hours are over" },
    pt_po_report:{ AZ:"Əməliyyat hesabatı", TR:"Ameliyat raporu", RU:"Протокол операции", EN:"Operative report" },
    pt_po_report_t:{ AZ:"Əməliyyat hesabatı xəstəxana sistemində açılır", TR:"Ameliyat raporu hastane sisteminde açılır", RU:"Протокол операции открывается в системе больницы", EN:"The operative report opens in the hospital system" },
    pt_po_vit:{ AZ:"Əməliyyatdan bəri vital göstəricilər · ilk → son", TR:"Ameliyattan bu yana vitaller · ilk → son", RU:"Показатели после операции · первое → последнее", EN:"Vitals since surgery · first → latest" },
    pt_po_uo:{ AZ:"Sidik · saatlıq", TR:"İdrar · saatlik", RU:"Диурез · по часам", EN:"Urine · hourly" },
    pt_po_drn:{ AZ:"Drenaj · saatlıq", TR:"Dren · saatlik", RU:"Дренаж · по часам", EN:"Drain · hourly" },
    pt_po_sum:{ AZ:"cəmi {0} mL · son saat {1} mL", TR:"toplam {0} mL · son saat {1} mL", RU:"всего {0} мл · за последний час {1} мл", EN:"total {0} mL · last hour {1} mL" },
    pt_po_uokg:{ AZ:"son 6 saat {0} mL/kq/saat", TR:"son 6 sa {0} mL/kg/sa", RU:"за 6 ч {0} мл/кг/ч", EN:"last 6 h {0} mL/kg/h" },
    pt_po_nodrn:{ AZ:"Drenaj qeydi yoxdur.", TR:"Dren kaydı yok.", RU:"Записей по дренажу нет.", EN:"No drain record." },
    pt_po_pain:{ AZ:"Ağrı şkalası (NRS)", TR:"Ağrı skoru (NRS)", RU:"Шкала боли (NRS)", EN:"Pain score (NRS)" },
    pt_po_mob:{ AZ:"İlk mobilizasiya", TR:"İlk mobilizasyon", RU:"Первая мобилизация", EN:"First mobilisation" },
    pt_po_mob_sit:{ AZ:"Çarpayı kənarında oturma", TR:"Yatak kenarında oturma", RU:"Сидя на краю кровати", EN:"Sitting at bedside" },
    pt_po_nomob:{ AZ:"Qeyd yoxdur", TR:"Kayıt yok", RU:"Записи нет", EN:"No record" },
    pt_po_rec:{ AZ:"Qeyd et", TR:"Kaydet", RU:"Записать", EN:"Record" },
    pt_po_foot:{ AZ:"Yalnız ölçülmüş dəyərlər və onların gedişi göstərilir; sistem hədd qoymur.", TR:"Yalnız ölçülmüş değerler ve eğilimleri gösterilir; sistem eşik koymaz.", RU:"Показаны только измеренные значения и их динамика; система не задаёт пороги.", EN:"Only measured values and their trend are shown; the system sets no thresholds." },
    // aile
    pt_fm_title:{ AZ:"Ailəyə məlumat qeydi", TR:"Aile bilgilendirme kaydı", RU:"Журнал информирования семьи", EN:"Family communication log" },
    pt_fm_last:{ AZ:"son: {0} · {1} əvvəl", TR:"son: {0} · {1} önce", RU:"последнее: {0} · {1} назад", EN:"last: {0} · {1} ago" },
    pt_fm_never:{ AZ:"hələ möhürlənmiş qeyd yoxdur", TR:"henüz mühürlü kayıt yok", RU:"скреплённых записей пока нет", EN:"no sealed entry yet" },
    pt_fm_new:{ AZ:"Yeni qeyd", TR:"Yeni kayıt", RU:"Новая запись", EN:"New entry" },
    pt_fm_none:{ AZ:"Qeyd yoxdur.", TR:"Kayıt yok.", RU:"Записей нет.", EN:"No entries." },
    pt_fm_foot:{ AZ:"Sistem ailəyə heç nə göndərmir; bu yalnız qeyddir. Möhürlənmiş qeyd dəyişdirilə bilməz.", TR:"Sistem aileye hiçbir şey göndermez; bu yalnız kayıttır. Mühürlenen kayıt değiştirilemez.", RU:"Система ничего не отправляет семье; это только запись. Скреплённую запись изменить нельзя.", EN:"The system sends nothing to the family; this is a record only. A sealed entry cannot be changed." },
    pt_fm_sealed:{ AZ:"Möhürləndi · {0} · dəyişdirilə bilməz", TR:"Mühürlendi · {0} · değiştirilemez", RU:"Скреплено · {0} · изменить нельзя", EN:"Sealed · {0} · cannot be changed" },
    pt_fm_draft:{ AZ:"Qaralama", TR:"Taslak", RU:"Черновик", EN:"Draft" },
    pt_fm_edit:{ AZ:"Qaralamanı aç", TR:"Taslağı aç", RU:"Открыть черновик", EN:"Open draft" },
    pt_fm_to:{ AZ:"Kimə", TR:"Kime", RU:"Кому", EN:"To whom" },
    pt_fm_name:{ AZ:"Adı soyadı", TR:"Adı soyadı", RU:"ФИО", EN:"Full name" },
    pt_fm_rel:{ AZ:"Yaxınlığı", TR:"Yakınlığı", RU:"Родство", EN:"Relationship" },
    pt_fm_how:{ AZ:"Necə", TR:"Nasıl", RU:"Как", EN:"How" },
    pt_fm_when:{ AZ:"Tarix · saat", TR:"Tarih · saat", RU:"Дата · время", EN:"Date · time" },
    pt_fm_by:{ AZ:"Məlumat verən", TR:"Görüşen", RU:"Информировал(а)", EN:"Informed by" },
    pt_fm_top:{ AZ:"Mövzu", TR:"Konu", RU:"Тема", EN:"Topic" },
    pt_fm_txt:{ AZ:"Nə danışıldı", TR:"Ne anlatıldı", RU:"Что сообщено", EN:"What was discussed" },
    pt_fm_need:{ AZ:"Möhürləmək üçün yaxınlıq və mətn lazımdır", TR:"Mühürlemek için yakınlık ve metin gerekli", RU:"Для скрепления нужны родство и текст", EN:"Relationship and text are required to seal" },
    pt_fm_saved:{ AZ:"Qaralama saxlandı", TR:"Taslak saklandı", RU:"Черновик сохранён", EN:"Draft kept" },
    pt_fm_sealed_t:{ AZ:"Qeyd möhürləndi · artıq dəyişdirilə bilməz", TR:"Kayıt mühürlendi · artık değiştirilemez", RU:"Запись скреплена · изменить нельзя", EN:"Entry sealed · can no longer be changed" },
    pt_fm_ro:{ AZ:"Qeyd yazmaq həkim və tibb bacısına açıqdır.", TR:"Kayıt yazmak hekim ve hemşireye açıktır.", RU:"Запись доступна врачу и медсестре.", EN:"Entries can be written by physicians and nurses." },
    pt_rel_spouse:{ AZ:"Həyat yoldaşı", TR:"Eşi", RU:"Супруг(а)", EN:"Spouse" },
    pt_rel_child:{ AZ:"Övladı", TR:"Çocuğu", RU:"Ребёнок", EN:"Child" },
    pt_rel_parent:{ AZ:"Valideyni", TR:"Annesi / babası", RU:"Родитель", EN:"Parent" },
    pt_rel_sibling:{ AZ:"Bacısı / qardaşı", TR:"Kardeşi", RU:"Брат / сестра", EN:"Sibling" },
    pt_rel_legal:{ AZ:"Qanuni nümayəndə", TR:"Yasal temsilci", RU:"Законный представитель", EN:"Legal representative" },
    pt_rel_other:{ AZ:"Digər", TR:"Diğer", RU:"Другое", EN:"Other" },
    pt_how_face:{ AZ:"Üzbəüz", TR:"Yüz yüze", RU:"Лично", EN:"In person" },
    pt_how_phone:{ AZ:"Telefon", TR:"Telefon", RU:"По телефону", EN:"Phone" },
    pt_how_video:{ AZ:"Video zəng", TR:"Görüntülü görüşme", RU:"Видеозвонок", EN:"Video call" },
    pt_top_gen:{ AZ:"Ümumi vəziyyət", TR:"Genel durum", RU:"Общее состояние", EN:"General condition" },
    pt_top_plan:{ AZ:"Müalicə planı", TR:"Tedavi planı", RU:"План лечения", EN:"Treatment plan" },
    pt_top_op:{ AZ:"Əməliyyat / prosedur", TR:"Ameliyat / işlem", RU:"Операция / процедура", EN:"Surgery / procedure" },
    pt_top_cam:{ AZ:"Kamera barədə məlumat", TR:"Kamera bilgilendirmesi", RU:"Информирование о камере", EN:"Camera notice" },
    pt_top_visit:{ AZ:"Ziyarət", TR:"Ziyaret", RU:"Посещения", EN:"Visiting" },
    pt_top_other:{ AZ:"Digər", TR:"Diğer", RU:"Другое", EN:"Other" },
  });
  const L = (k, ...a) => H.t("pt_" + k).replace(/\{(\d)\}/g, (_, i) => a[+i]);
  const pname = (p) => H.showNames() ? p.name : hnOf(p);                       // ad yetkisi yoksa hasta no
  const azSuf = (n) => { const d = n % 10, t = Math.floor(n / 10) % 10;
    return d ? ({ 1:"ci", 2:"ci", 3:"cü", 4:"cü", 5:"ci", 6:"cı", 7:"ci", 8:"ci", 9:"cu" })[d] : ({ 1:"cu", 2:"ci", 3:"cu", 4:"cı", 5:"ci", 6:"cı", 7:"ci", 8:"ci", 9:"cu" })[t] || "cü"; };
  const dayN = (n) => ({ AZ:`${n}-${azSuf(n)} gün`, RU:`${n}-й день`, EN:`day ${n}` })[H.state.lang] || `${n}. gün`;
  const dur = (h) => { const m = Math.max(0, Math.round(h * 60)), d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
    return d ? `${d} ${L("u_d")} ${hh} ${L("u_h")}` : hh ? `${hh} ${L("u_h")} ${mm} ${L("u_m")}` : `${mm} ${L("u_m")}`; };
  const when = (t) => dayOf(t) === TODAY ? clk(NOW + t) : `${String(dayOf(t)).padStart(2, "0")}.09 ${clk(NOW + t)}`;
  const hOf = (hhmm) => { const [a, b] = String(hhmm).split(":").map(Number); return a + (b || 0) / 60; };
  const relT = (day, hhmm) => (day - TODAY) * 24 + hOf(hhmm) - NOW;           // tarih + saat → şimdiye göre saat
  const isPostop = (p) => /Postoperatif/i.test(p.dx || "") || !!(p.flags && p.flags.postop);

  /* ---------- #3 kateter ve cihaz günleri ---------- */
  // Kaynak: bakım kaydı (nursing.js → H.data.nursing.ongoing: {pid,name,region,day}). Kaydı olmayan hastada kimlikten türetilen sabit liste.
  const DEV = [["cvc", /^(CVP|Santral|Mərkəzi)/i], ["art", /^Arter/i], ["ett", /^(Entübasyon|Trakeostomi)/i], ["uc", /^(Mesane sonda|Üriner|Foley)/i], ["hd", /^Diyaliz kateteri/i], ["drn", /^Dren/i], ["piv", /^Damar yolu/i]];
  const devGen = {};
  const genDevices = (p) => {
    const rnd = seeded(seedOf(p.id + "dev")), u = unitOf(p), icu = ["icu", "nicu"].includes(u.type), ad = Math.max(1, p.admitDays || 1), po = isPostop(p);
    const day = (max) => Math.max(1, Math.min(ad, max, 1 + Math.floor(rnd() * ad)));
    const out = [];
    if (p.ageGroup !== "neonate" && (icu || po)) {
      if (p.ageGroup === "adult" && (po || p.risk !== "low" || rnd() < .5)) out.push({ k:"cvc", day:po ? ad : day(ad) });
      if (icu && (p.risk === "crit" || p.risk === "high" || /^Z95/.test(p.icd))) out.push({ k:"art", day:day(ad) });
      if (/entübe|mekanik|ventil/i.test(p.v.o2)) out.push({ k:"ett", day:day(ad) });
      out.push({ k:"uc", day:po ? ad : day(ad) });
      if (po) out.push({ k:"drn", day:ad });
    }
    if (icu || po || p.admitDays > 0) out.push({ k:"piv", day:day(3) });
    return out;
  };
  const devicesOf = (p) => {
    const rec = ((H.data.nursing || {}).ongoing || []).filter(o => o.pid === p.id);
    const list = rec.length ? rec.map(o => { const d = DEV.find(x => x[1].test(o.name)); return d ? { k:d[0], day:o.day } : null; }).filter(Boolean)
      : (devGen[p.id] || (devGen[p.id] = genDevices(p)));
    const ord = DEV.map(d => d[0]);
    return list.slice().sort((a, b) => ord.indexOf(a.k) - ord.indexOf(b.k));
  };
  const devRow = (p) => {
    const D = devicesOf(p), pc = consOf(p).filter(c => !c.reco);
    if (!D.length && !pc.length) return "";
    return `<div class="pt-dev">${D.length ? `<span class="lb" title="${esc(L("dev_src"))}">${L("dev_title")}</span>${D.map(d => `<span class="tag" title="${esc(L("dev_src"))}">${esc(L("dev_" + d.k))}<b>${esc(dayN(d.day))}</b></span>`).join("")}` : ""}
      ${pc.map(c => `<span class="tag w" data-tab="ozet" style="cursor:pointer">${H.icon("clock")}${esc(L("cs_pending"))}: ${esc(L("dep_" + c.dep))} · ${esc(dur(-(c.seen ?? c.req)))}</span>`).join("")}
      ${D.length ? H.adminNote("Cihaz günleri için uyarı eşiği gösterilmez: hangi günde ne yapılacağı hastanenin enfeksiyon kontrol protokolünden alınır; protokol tanımlanınca eklenir.") : ""}</div>`;
  };

  /* ---------- #7 konsültasyon takibi ---------- */
  // t: şimdiye göre saat (negatif = geçmiş). Kaynak: hastane sistemindeki istem ve form zaman damgaları.
  const CONS = {
    p1:[{ dep:"inf", req:-26, by:"dr.kamran", who:"Dr. Aygün Kərimova", seen:-22.6, reco:-21.9 }, { dep:"pulm", req:-3.2, by:"dr.kamran", who:null, seen:null, reco:null }],
    p2:[{ dep:"pulm", req:-52.4, by:"dr.kamran", who:"Dr. Rövşən Əhmədli", seen:-49.5, reco:-48.8 }, { dep:"endo", req:-6.5, by:"dr.kamran", who:"Dr. Lalə Mustafayeva", seen:-2.1, reco:null }],
    p3:[{ dep:"neph", req:-44.3, by:"dr.kamran", who:"Dr. Elnur Qəribov", seen:-41.2, reco:-40.5 }],
    p4:[{ dep:"gs", req:-9.5, by:"dr.kamran", who:"Dr. Rauf Əsgərov", seen:-8.1, reco:-7.6 }],
    p7:[{ dep:"card", req:-7.4, by:"dr.kamran", who:null, seen:null, reco:null }],
    p16:[{ dep:"cvs", req:-10.2, by:"dr.kamran", who:"Dr. Tural Həsənov", seen:-9.1, reco:-8.4 }],
  };
  const consOf = (p) => CONS[p.id] || [];
  const consBox = (p) => {
    const C = consOf(p);
    const row = (c) => {
      const stt = c.reco != null ? "done" : c.seen != null ? "seen" : "req", last = c.reco ?? c.seen ?? c.req;
      const step = (lbl, t, cls) => `<span class="s ${cls}">${lbl}<b>${t != null ? esc(when(t)) : "—"}</b></span>`;
      const gap = (a, b) => `<span class="d">→ ${esc(dur(b - a))} →</span>`;
      return `<div class="pt-cs"><div class="hd"><b>${esc(L("dep_" + c.dep))}</b><span class="pt-lv ${stt === "done" ? "o" : "w"}">${esc(L("cs_st_" + stt))}</span>${c.who ? `<span class="mute" style="font-size:12px">${esc(c.who)}</span>` : ""}</div>
        <div class="pt-st">${step(L("cs_req"), c.req, "done")}${c.seen != null ? gap(c.req, c.seen) + step(L("cs_seen"), c.seen, "done") : `<span class="d">→</span>${step(L("cs_seen"), null, "wait")}`}${c.seen != null ? (c.reco != null ? gap(c.seen, c.reco) + step(L("cs_reco"), c.reco, "done") : `<span class="d">→</span>${step(L("cs_reco"), null, "wait")}`) : ""}</div>
        <div class="mute" style="font-size:12px;margin-top:5px">${stt === "done" ? esc(L("cs_total", dur(c.reco - c.req))) : `<b style="color:var(--attInk)">${esc(L("cs_waiting", dur(-last)))}</b>`}</div></div>`;
    };
    return `<div class="box pt-cb"><h5>${esc(L("cs_title"))}${C.length ? `<span class="r"><button class="btn g sm" data-csform>${H.icon("link")}${esc(L("cs_form"))}</button></span>` : ""}</h5>
      ${C.length ? C.slice().sort((a, b) => (a.reco != null) - (b.reco != null) || b.req - a.req).map(row).join("") : `<div class="empty">${esc(L("cs_none"))}</div>`}
      <div class="mute" style="font-size:11.5px;margin-top:6px">${esc(L("cs_foot"))}</div></div>`;
  };

  /* ---------- #5 görüntüleme zaman çizelgesi ---------- */
  const exOf = (n) => /Akciğer grafisi/i.test(n) ? "cxr" : /Toraks BT/i.test(n) ? "ctc" : /Üriner sistem USG/i.test(n) ? "usu" : /Batın USG/i.test(n) ? "usa" : n;
  // Aynı tetkikin önceki çekimleri (hastane kaydı). Bugünkü çekimler yukarıdaki RAD'dan gelir.
  const RADX = {
    p1:[{ n:"Akciğer grafisi (PA)", day:21, tm:"10:40", rep:"Sağ alt zonda silik opasite artışı. Sinüsler açık. Kalp gölgesi normal sınırlarda." },
        { n:"Akciğer grafisi (yatak başı AP)", day:23, tm:"20:05", rep:"Sağ alt zonda konsolidasyonla uyumlu opasite. Sinüsler açık. Kalp gölgesi normal sınırlarda." }],
    p2:[{ n:"Akciğer grafisi (PA)", day:21, tm:"11:30", rep:"Her iki akciğerde havalanma artışı, diyafram kubbeleri düzleşmiş. Sağ alt zonda silik infiltrasyon ayırt edilemedi." }],
    p4:[{ n:"Akciğer grafisi (preoperatif)", day:22, tm:"15:10", rep:"Kardiyotorasik oran normal. Akciğer parankimi olağan. Sinüsler açık." }],
    p7:[{ n:"Akciğer grafisi (PA)", day:20, tm:"09:15", rep:"Kardiyotorasik oran artmış. Bilateral minimal plevral sıvı." }],
    p13:[{ n:"Akciğer grafisi (yenidoğan)", day:16, tm:"03:40", rep:"Bilateral buzlu cam görünümü, hava bronkogramları." },
         { n:"Akciğer grafisi (yenidoğan)", day:20, tm:"08:30", rep:"Bilateral buzlu cam görünümü, hava bronkogramları. Önceki grafiye göre hafif azalma." }],
  };
  const addMin = (hhmm, m) => clk(hOf(hhmm) + m / 60);
  const radCache = {};
  const radOf = (p) => {
    if (radCache[p.id]) return radCache[p.id];
    const att = H.userBy(p.attending), attN = att ? att.name : "—";
    const prev = (RADX[p.id] || []).map((r, i) => ({ id:"rx" + i, ex:exOf(r.n), n:r.n, day:r.day, tm:r.tm, rep:r.rep, st:4, pre:[{ by:attN, at:`${String(r.day).padStart(2, "0")}.09 ${addMin(r.tm, 45)}` }] }));
    const cur = (RAD[p.id] || []).map((r, i) => { const m = /^(\d\d)\.09 (.*)$/.exec(r.t), day = m ? +m[1] : TODAY, tm = m ? m[2] : r.t;
      return { id:"rad" + i, ex:exOf(r.n), n:r.n, day, tm, rep:r.rep, wait:r.wait, st:r.st, pre:r.st === 4 ? [{ by:attN, at:`${String(day).padStart(2, "0")}.09 ${addMin(tm, 40)}` }] : [] }; });
    return (radCache[p.id] = prev.concat(cur).map(s => Object.assign(s, { t:relT(s.day, s.tm), notify:{ to:attN, at:`${String(s.day).padStart(2, "0")}.09 ${addMin(s.tm, 2)}` } })).sort((a, b) => a.t - b.t));
  };
  const radSeen = (p, s) => { const st = S(p.id), mine = (st.radSeen || {})[s.id] || []; return s.pre.concat(mine); };
  const radUnseen = (p) => radOf(p).filter(s => s.st >= 3 && s.rep && !radSeen(p, s).length);
  function radTab(p) {
    const st = S(p.id), R = radOf(p);
    if (!R.length) return `<div class="empty">${esc(L("rad_none"))}</div>`;
    const done = R.filter(s => s.st >= 3 && s.rep), wait = R.filter(s => s.st < 3);
    const sel = R.find(s => s.id === st.radSel) || radUnseen(p).slice(-1)[0] || done.slice(-1)[0] || R[R.length - 1];
    const exams = [...new Map(R.map(s => [s.ex, s])).keys()], days = [...new Set(R.map(s => s.day))].sort((a, b) => a - b);
    const cell = (s) => { const un = s.st >= 3 && s.rep && !radSeen(p, s).length, wt = s.st < 3;
      return `<span class="pt-rc${un ? " un" : ""}${wt ? " wt" : ""}${s === sel ? " on" : ""}" data-rsel="${s.id}" title="${esc(s.n)} · ${esc(wt ? L("rad_waitst") : un ? L("rad_unseen") : L("rad_seen"))}">${wt ? H.icon("clock") : H.icon("file") + H.icon("eye")}${esc(s.tm)}${un ? `<em>●</em>` : ""}</span>`; };
    const grid = `<div class="pt-gw"><table class="pt-grid pt-rg"><thead><tr><th class="lb">${esc(L("rad_exam"))}</th>${days.map(d => `<th>${String(d).padStart(2, "0")}.09</th>`).join("")}</tr></thead><tbody>
      ${exams.map(ex => { const nm = R.filter(s => s.ex === ex).slice(-1)[0].n.replace(/\s*\(.*\)$/, "");
        return `<tr><td class="lb" title="${esc(nm)}">${esc(nm)}</td>${days.map(d => `<td>${R.filter(s => s.ex === ex && s.day === d).map(cell).join("")}</td>`).join("")}</tr>`; }).join("")}</tbody></table></div>
      <div class="pt-leg"><span><span class="pt-rc" style="cursor:default">${H.icon("file")}${esc(L("rad_rep"))}</span></span><span><span class="pt-rc" style="cursor:default">${H.icon("eye")}${esc(L("rad_img"))}</span></span><span><span class="pt-rc un" style="cursor:default">${esc(L("rad_unseen"))}</span></span><span><span class="pt-rc wt" style="cursor:default">${H.icon("clock")}${esc(L("rad_waitst"))}</span></span><span>${esc(L("rad_hint"))}</span></div>`;
    const queue = `<div class="box" style="margin-top:12px"><h5>${esc(L("rad_queue"))}</h5>${wait.length ? wait.map(s => `<div class="kv"><span>${esc(s.n)} <span class="mute">· ${esc(L("rad_ordered", s.tm))}</span></span><b style="font-family:Figtree;color:var(--attInk)">${esc(s.wait || L("rad_waitst"))}</b></div>`).join("") : `<div class="mute" style="font-size:12.5px">${esc(L("rad_queue_none"))}</div>`}</div>`;
    let det = "";
    if (sel) {
      const prev = R.filter(s => s.ex === sel.ex && s.t < sel.t && s.rep).slice(-1)[0], seen = radSeen(p, sel), stp = seen.length ? 4 : sel.st;
      const mineSeen = seen.some(x => x.by === me());
      det = `<div class="box pt-cb" style="margin-top:12px"><h5>${esc(sel.n)} · ${String(sel.day).padStart(2, "0")}.09 ${esc(sel.tm)} <span class="r">${sel.st < 3 ? `<span class="pill">${esc(sel.wait || L("rad_waitst"))}</span>` : seen.length ? `<span class="pill">${esc(L("rad_seen"))}</span>` : `<span class="tag c">${esc(L("rad_unseen"))}</span>`}</span></h5>
        <div class="pt-tl">${[1, 2, 3, 4].map((x, j) => `<span class="${j < stp ? "done" : j === stp ? "now" : ""}">${esc(L("rad_s" + x))}</span>`).join("")}</div>
        ${sel.rep ? `<div class="pt-rxc${prev ? "" : " one"}"><div><div class="lb">${esc(L("rad_this"))} · ${String(sel.day).padStart(2, "0")}.09 ${esc(sel.tm)}</div><div class="pt-rep">${esc(sel.rep)}</div></div>
          ${prev ? `<div><div class="lb">${esc(L("rad_prev"))} · ${String(prev.day).padStart(2, "0")}.09 ${esc(prev.tm)}</div><div class="pt-rep prev">${esc(prev.rep)}</div></div>` : ""}</div>
          ${prev ? "" : `<div class="mute" style="font-size:12px">${esc(L("rad_noprev"))}</div>`}
          <div class="mute" style="font-size:11.5px;margin-top:4px">${esc(L("rad_src"))}</div>` : ""}
        <div class="pt-row" style="margin-top:8px">${sel.st >= 3 ? `<a href="#" class="btn sm" data-pacs>${H.icon("link")}${esc(L("rad_pacs"))}</a>` : ""}${sel.rep && !mineSeen ? `<button class="btn p sm" data-radseen="${sel.id}">${H.icon("eye")}${esc(L("rad_iseen"))}</button>` : ""}</div>
        ${sel.st >= 3 ? `<div class="pt-who"><span>${esc(L("rad_notif", sel.notify.to, sel.notify.at))}</span><span>${esc(L("rad_who"))}: ${seen.length ? seen.map(x => `<b>${esc(x.by)}</b> · ${esc(x.at)}`).join(" · ") : `<b style="color:var(--crit)">${esc(L("rad_nobody"))}</b>`}</span></div>` : ""}</div>`;
    }
    return `<div class="sec" style="margin-bottom:6px">${esc(L("rad_grid"))}</div>${grid}${det}${queue}`;
  }

  /* ---------- #11 ameliyat sonrası ilk 24 saat ---------- */
  // end/arrive: şimdiye göre saat. pain: [t, NRS] (ağrı formu kayıtları). mob: ilk mobilizasyon kaydı.
  const POSTOP = { p4:{ op:"Kolektomi", end:relT(TODAY, "06:40"), arrive:relT(TODAY, "07:05"), pain:[[relT(TODAY, "07:20"), 5], [relT(TODAY, "11:00"), 4], [relT(TODAY, "15:05"), 3], [relT(TODAY, "18:10"), 3], [relT(TODAY, "21:00"), 2]], mob:{ t:relT(TODAY, "16:25"), what:"sit", by:"hs.sevda" } } };
  const poOf = (p) => { if (POSTOP[p.id]) return POSTOP[p.id];
    const rnd = seeded(seedOf(p.id + "po")), end = -(6 + Math.floor(rnd() * 14)) - .25, fp = (p.flags || {}).pain;
    return (POSTOP[p.id] = { op:(p.dx || "").replace(/^Postoperatif takip\s*·\s*/i, ""), end, arrive:end + .4, pain:fp != null ? [[end + 1, Math.min(10, fp + 2)], [end / 2, fp + 1], [-0.7, fp]] : [], mob:null }); };
  function postopPanel(p) {
    const po = poOf(p), since = -po.end, pct = Math.min(100, since / 24 * 100);
    const hrs = Math.max(1, Math.ceil(since));
    const vit = ["hr", "map", "spo2", "rr", "temp"].map(k => { const V = H.VITAL[k], pts = H.series(p.id, k, hrs, 60).filter(q => q.t >= po.end && q.v != null); if (pts.length < 2) return "";
      const a = pts[0].v, b = pts[pts.length - 1].v;
      return `<div><small style="color:var(${V.c})">${esc(V.n)}</small><b>${fmtV(k, a)} → ${fmtV(k, b)}</b> <i class="mute" style="font:600 10.5px Figtree;font-style:normal">${esc(V.u)}</i>${H.spark(pts.map(q => q.v), H.cssVar(V.c))}</div>`; }).join("");
    // 30.09: idrar/dren tek defterden (sıvı ızgarası); ızgara yüklenmediyse eski sentetik seri
    const G = H.fluidGrid && H.fluidGrid.summary ? H.fluidGrid.summary(p) : null, hasDrn = devicesOf(p).some(d => d.k === "drn");
    let rows, uri, drn;
    if (G) { const ix = G.rows.map((r, i) => i).filter(i => 8 + G.rows[i].slot - NOW >= po.arrive - 1); rows = ix.map(i => G.rows[i]); uri = ix.map(i => Math.round(G.urineSlots[i])); drn = hasDrn || G.drn ? ix.map(i => Math.round(G.drainSlots[i])) : []; }
    else { rows = ioOf(p).filter((r, i) => Math.floor(NOW) - (23 - i) - NOW >= po.arrive - 1); uri = rows.map(r => Math.round(r.o * (hasDrn ? .82 : .94))); drn = hasDrn ? rows.map(r => Math.round(r.o * .14)) : []; }
    const bars = (arr, cls) => { const mx = Math.max(...arr, 1); return `<div class="pt-hb ${cls}">${arr.map((v, i) => `<i style="height:${Math.max(4, v / mx * 100).toFixed(0)}%" title="${String(rows[i].h).padStart(2, "0")}:00 · ${v} mL"></i>`).join("")}</div>`; };
    const sum = (a) => a.reduce((x, y) => x + y, 0), f = (n) => n.toLocaleString("tr-TR");
    const uokg = uri.slice(-6).reduce((a, b) => a + b, 0) / Math.min(6, uri.length || 1) / p.weight;
    const mobU = po.mob && H.userBy(po.mob.by), canAct = H.FORMS.some(x => x.key === "activity" && x.ages.includes(p.ageGroup));
    return `<div class="box pt-po" style="margin-bottom:12px"><h5>${esc(L("po_title"))} <span class="r"><button class="btn g sm" data-poreport>${H.icon("link")}${esc(L("po_report"))}</button></span></h5>
      <div class="pt-pot"><div><div class="mute" style="font-size:12px">${esc(L("po_since"))}</div><div class="big">${esc(dur(since))}</div></div>
        <div style="flex:1 1 200px;min-width:0"><div class="mute" style="font-size:12.5px"><b style="color:var(--ink)">${esc(po.op)}</b> · ${esc(L("po_end", when(po.end)))} · ${esc(L("po_arr", when(po.arrive)))}</div>
          <div class="bar"><em style="width:${pct.toFixed(0)}%"></em></div>${since >= 24 ? `<div class="mute" style="font-size:12px;margin-top:4px">${esc(L("po_over"))}</div>` : ""}</div></div>
      ${vit ? `<div class="sec" style="margin-top:12px">${esc(L("po_vit"))}</div><div class="pt-pv">${vit}</div>` : ""}
      <div class="g3x">
        <div><div class="sec">${esc(L("po_uo"))}</div>${uri.length ? bars(uri, "") : ""}<div class="mute" style="font-size:12px;margin-top:4px">${esc(L("po_sum", f(sum(uri)), f(uri[uri.length - 1] || 0)))} · ${esc(L("po_uokg", uokg.toFixed(1)))}</div></div>
        <div><div class="sec">${esc(L("po_drn"))}</div>${drn.length ? bars(drn, "d") + `<div class="mute" style="font-size:12px;margin-top:4px">${esc(L("po_sum", f(sum(drn)), f(drn[drn.length - 1] || 0)))}</div>` : `<div class="mute" style="font-size:12.5px">${esc(L("po_nodrn"))}</div>`}</div>
        <div><div class="sec">${esc(L("po_pain"))}</div><div class="pt-pn">${po.pain.length ? po.pain.map(([t, v]) => `<span>${esc(clk(NOW + t))}<b>${v}</b></span>`).join("") : `<span class="mute">—</span>`}</div>
          <div class="sec" style="margin-top:10px">${esc(L("po_mob"))}</div>${po.mob ? `<div style="font-size:13px"><b>${esc(L("po_mob_" + po.mob.what))}</b> <span class="mute">· ${esc(when(po.mob.t))} · ${esc(mobU ? mobU.name : "—")}</span></div>`
            : `<div class="pt-row"><span class="mute" style="font-size:12.5px">${esc(L("po_nomob"))}</span>${canAct ? `<button class="btn sm" data-form="activity">${H.icon("plus")}${esc(L("po_rec"))}</button>` : ""}</div>`}</div></div>
      <div class="mute" style="font-size:11.5px;margin-top:10px">${esc(L("po_foot"))}${H.adminNote(" · İzlem sıklığı ve dren/idrar hatırlatmaları hastanenin ameliyat sonrası protokolünden alınır; protokol tanımlanmadıkça gösterilmez.")}</div></div>`;
  }

  /* ---------- #19 aile bilgilendirme kaydı ---------- */
  const FAM0 = {
    p1:[{ t:-26.3, by:"dr.kamran", rel:"spouse", nm:"Aynur Hüseynova", how:"face", top:["gen", "plan"], txt:"Yoğun bakıma yatış nedeni ve izlem planı anlatıldı. Soruları yanıtlandı. Ziyaret saatleri bildirildi.", sealed:-26 },
        { t:-4.2, by:"hs.sevda", rel:"spouse", nm:"Aynur Hüseynova", how:"phone", top:["visit"], txt:"Ziyaret saati ve getirilecek kişisel eşyalar hakkında bilgi verildi. Klinik durum sorusu için hekimle görüşme önerildi.", sealed:-4.1 }],
    p2:[{ t:-20.5, by:"dr.kamran", rel:"child", nm:"Günay Əliyeva", how:"face", top:["gen", "cam"], txt:"Genel durum anlatıldı. Odadaki kamera, amacı ve kimlerin görebileceği açıklandı.", sealed:-20.3 },
        { t:-1.1, by:"hs.sevda", rel:"child", nm:"Günay Əliyeva", how:"phone", top:["gen"], txt:"Telefonla arandı; hekimin sabah vizitten sonra görüşeceği iletildi.", sealed:null }],
    p4:[{ t:-13.4, by:"dr.kamran", rel:"spouse", nm:"Elçin Vəliyev", how:"face", top:["op"], txt:"Ameliyatın tamamlandığı ve hastanın ilk gün yoğun bakımda izleneceği anlatıldı.", sealed:-13.2 }],
  };
  const famOf = (p) => { const st = S(p.id); return st.fam || (st.fam = (FAM0[p.id] || []).map((x, i) => Object.assign({ id:i + 1 }, x))); };
  const canFam = () => !!H.state.user && ["hekim", "hemsire"].includes(H.state.user.role) && H.canEdit("pt_ozet");
  const REL = ["spouse", "child", "parent", "sibling", "legal", "other"], HOW = ["face", "phone", "video"], TOP = ["gen", "plan", "op", "cam", "visit", "other"];
  const famBox = (p) => {
    const F = famOf(p).slice().sort((a, b) => b.t - a.t), last = F.filter(x => x.sealed != null)[0];
    const item = (x) => { const u = H.userBy(x.by);
      return `<div class="pt-fm"><div class="hd"><b class="mono">${esc(typeof x.t === "number" ? when(x.t) : x.t)}</b><span>${esc(u ? u.name : x.by)}</span><span>→</span><b>${esc(L("rel_" + x.rel))}${H.showNames() && x.nm ? " · " + esc(x.nm) : ""}</b><span class="pill">${esc(L("how_" + x.how))}</span></div>
        <div class="pt-row" style="gap:4px;margin-top:4px">${x.top.map(k => `<span class="tag">${esc(L("top_" + k))}</span>`).join("")}</div>
        <p>${esc(x.txt)}</p>
        ${x.sealed != null ? `<span class="sl">${H.icon("lock")}${esc(L("fm_sealed", when(x.sealed)))}</span>` : `<div class="pt-row"><span class="pt-lv w">${esc(L("fm_draft"))}</span>${canFam() && x.by === (H.state.user || {}).u ? `<button class="btn sm" data-fmedit="${x.id}">${H.icon("edit")}${esc(L("fm_edit"))}</button>` : ""}</div>`}</div>`; };
    return `<div class="box pt-cb"><h5>${esc(L("fm_title"))} <span class="r">${canFam() ? `<button class="btn p sm" data-fmnew>${H.icon("plus")}${esc(L("fm_new"))}</button>` : ""}</span></h5>
      <div class="mute" style="font-size:12.5px;margin-bottom:4px">${last ? esc(L("fm_last", when(last.t), dur(-last.t))) : esc(L("fm_never"))}</div>
      ${F.length ? F.map(item).join("") : `<div class="empty">${esc(L("fm_none"))}</div>`}
      <div class="mute" style="font-size:11.5px;margin-top:6px">${esc(L("fm_foot"))}${canFam() ? "" : " " + esc(L("fm_ro"))}</div></div>`;
  };
  function famDialog(p, entry, refresh) {
    if (!canFam()) return;
    const x = entry ? Object.assign({}, entry, { top:entry.top.slice() }) : { rel:null, how:"face", top:[], nm:"", txt:"", date:"2026-09-24", time:H.now() };
    if (entry && typeof entry.t === "number") { x.date = `2026-09-${String(dayOf(entry.t)).padStart(2, "0")}`; x.time = clk(NOW + entry.t); }
    const opts = (name, keys, pre, multi) => `<div class="opts" data-fo="${name}">${keys.map(k => `<i data-v="${k}" class="${(multi ? x[name].includes(k) : x[name] === k) ? "on" : ""}">${esc(L(pre + k))}</i>`).join("")}</div>`;
    H.modal({ title:`${esc(L("fm_title"))} · ${esc(H.bed(p.bed).no)}${H.showNames() ? " · " + esc(p.name) : ""}`, wide:true,
      body:`<div class="fld"><label>${esc(L("fm_rel"))}</label>${opts("rel", REL, "rel_")}</div>
        <div class="fld"><label>${esc(L("fm_name"))}</label><input data-ff="nm" value="${esc(x.nm || "")}" autocomplete="off"></div>
        <div class="fld"><label>${esc(L("fm_how"))}</label>${opts("how", HOW, "how_")}</div>
        <div class="fld"><label>${esc(L("fm_when"))}</label><div class="pt-row"><input type="date" data-ff="date" value="${esc(x.date)}" style="width:auto"><input type="time" data-ff="time" value="${esc(x.time)}" style="width:auto"></div></div>
        <div class="fld"><label>${esc(L("fm_by"))}</label><b>${esc(me())}</b></div>
        <div class="fld"><label>${esc(L("fm_top"))}</label>${opts("top", TOP, "top_", true)}</div>
        <div class="fld col"><label>${esc(L("fm_txt"))}</label><textarea data-ff="txt" style="min-height:110px">${esc(x.txt || "")}</textarea></div>
        <div class="mute" style="font-size:12px">${esc(L("fm_foot"))}</div>`,
      actions:`<button class="btn g" data-x>${H.t("cancel")}</button><button class="btn" data-fs="draft">${H.icon("file")}${H.t("save_draft")}</button><button class="btn p" data-fs="seal">${H.icon("lock")}${H.t("save_sign")}</button>`,
      onMount(m) {
        m.addEventListener("click", (e) => {
          const o = e.target.closest("[data-fo] i"); if (o) { const n = o.parentElement.dataset.fo, v = o.dataset.v;
            if (n === "top") { x.top = x.top.includes(v) ? x.top.filter(k => k !== v) : x.top.concat(v); o.classList.toggle("on"); }
            else { x[n] = v; o.parentElement.querySelectorAll("i").forEach(i => i.classList.toggle("on", i === o)); } return; }
          const b = e.target.closest("[data-fs]"); if (!b) return;
          m.querySelectorAll("[data-ff]").forEach(i => { x[i.dataset.ff] = i.value; });
          const seal = b.dataset.fs === "seal";
          if (seal && (!x.rel || !String(x.txt).trim())) { H.toast(L("fm_need"), "w"); return; }
          const dm = /^\d{4}-\d\d-(\d\d)$/.exec(x.date || ""), t = dm && x.time ? relT(+dm[1], x.time) : 0;
          const rec = { t, by:H.state.user.u, rel:x.rel || "other", nm:x.nm, how:x.how, top:x.top.length ? x.top : ["gen"], txt:String(x.txt || "").trim(), sealed:seal ? 0 : null };
          const F = famOf(p);
          if (entry) Object.assign(entry, rec); else F.push(Object.assign({ id:Math.max(0, ...F.map(y => y.id)) + 1 }, rec));
          H.log(seal ? "Aile bilgilendirme kaydı mühürlendi" : "Aile bilgilendirme taslağı saklandı", `${H.bed(p.bed).no} · ${L("rel_" + rec.rel)}`);
          H.toast(seal ? L("fm_sealed_t") : L("fm_saved"), seal ? "" : "w"); H.closeModal(); refresh(); });
      } });
  }

  /* ================= sayfa ================= */
  const TAB_FN = { ozet:tabOzet, trend:tabTrend, skor:tabSkor, takip:tabTakip, ilac:tabIlac, sivi:(p) => tabSivi(p) + (H.fluidGrid ? `<div style="margin-top:12px">${H.fluidGrid.html(p)}</div>` : ""), sonuc:tabSonuc, devir:tabDevir,
    bakim:(p) => H.carePlan ? H.carePlan.html(p) : `<div class="empty">Bakım planı modülü yüklenmedi.</div>`,
    belge:(p) => H.docs ? H.docs.html(p) : `<div class="empty">Belgeler modülü yükleniyor…</div>`, kamera:() => `<div data-cam></div>` };
  const AFTER = { ozet:afterOzet, trend:afterTrend, skor:afterN2, sivi:(el, p) => { afterSivi(el, p); H.fluidGrid && H.fluidGrid.after(el, p); },
    bakim:(el, p) => H.carePlan && H.carePlan.after(el, p), belge:(el, p) => H.docs && H.docs.after(el, p), kamera:(el, p) => H.cameraTab && H.cameraTab(el.querySelector("[data-cam]"), p.id) };

  function pickList(root) {
    const L = H.myPatients();
    root.innerHTML = `<div class="ph"><div><h2>Hasta seçin</h2><p>Birimlerinizdeki hastalar</p></div></div>
      ${L.length ? `<div class="tw"><table class="t"><thead><tr><th>Yatak</th><th>Hasta</th><th>Durum</th></tr></thead><tbody>${L.map(p => `<tr class="row" data-pid="${p.id}"><td class="n">${esc(H.bed(p.bed).no)}</td><td><b>${esc(p.name)}</b><div class="mute" style="font-size:12px">${H.ageText(p)} · ${esc(p.dx)}</div></td><td>${H.sevPill(p.risk)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Kapsamınızda hasta yok.</div>`}`;
    root.onclick = (e) => { const r = e.target.closest("[data-pid]"); if (r) H.go("patient", { pid:r.dataset.pid, tab:"ozet" }); };
  }

  function render(root, params = {}) {
    ensureCss();
    const p = H.pt(params.pid);
    if (!p) { pickList(root); return; }
    if (!H.inScope(p.id)) { root.innerHTML = `<div class="empty">${H.icon("lock")} Bu hasta sizin birimlerinizde değil. Erişim denetim kaydına yazıldı.</div>`; H.log("Kapsam dışı hasta erişim denemesi", p.id); root.onclick = null; return; }
    const tab = TAB_FN[params.tab] && tabsFor(p).some(([k]) => k === params.tab) ? params.tab : "ozet";
    const forms = H.FORMS.filter(f => f.ages.includes(p.ageGroup));
    root.innerHTML = `<div class="pt-wrap">${H.patientHeader(p)}
      <div class="pt-bar"><span class="src">${H.icon("link").replace("<svg", '<svg style="width:13px;height:13px;vertical-align:-2px"')} Kimlik ve tanı: hastane kaydı · son eşitleme 21:40</span>
        <div class="pt-dd"><button class="btn sm" data-act="fm">${H.icon("clip")}Form doldur ${H.icon("chevD")}</button>
          <div class="menu hidden" data-fm>${forms.map(f => `<a data-form="${f.key}">${H.icon(f.icon)}${esc(f.name)} <span class="mute" style="margin-left:auto;font-size:11px;font-weight:600">${esc(f.freq)}</span></a>`).join("")}</div></div></div>
      ${p.monitored ? monitorHtml(p) : vitalBarHtml(p)}
      <div class="tabs">${tabsFor(p).map(([k, l]) => { const b = badge(p, k); return `<span data-tab="${k}" class="${tab === k ? "on" : ""}">${l}${b ? `<em>${b}</em>` : ""}</span>`; }).join("")}</div>
      <div class="pt-body"></div></div>`;
    const bodyEl = root.querySelector(".pt-body");
    const refresh = () => {
      bodyEl.innerHTML = (H.can("pt_" + tab) && !H.canEdit("pt_" + tab) ? `<div class="note i" style="margin-bottom:10px">${H.icon("eye")} Bu sekmeyi yalnız görüntüleme yetkiniz var. Değişiklikler kaydedilmez.</div>` : "") + TAB_FN[tab](p);
      AFTER[tab] && AFTER[tab](bodyEl, p);
      root.querySelectorAll(".tabs [data-tab]").forEach(s => { const b = badge(p, s.dataset.tab), em = s.querySelector("em"); if (b) { if (em) em.textContent = b; else s.insertAdjacentHTML("beforeend", `<em>${b}</em>`); } else if (em) em.remove(); });
    };
    refresh();
    if (p.monitored) wireWaves(root);
    const bedNo = H.bed(p.bed).no;

    root.onclick = (e) => {
      const T = e.target;
      const dd = root.querySelector("[data-fm]");
      if (T.closest("[data-act='fm']")) { dd.classList.toggle("hidden"); return; }
      if (dd && !dd.classList.contains("hidden") && !T.closest("[data-fm]")) dd.classList.add("hidden");
      const fm = T.closest("[data-form]"); if (fm) { e.preventDefault(); dd && dd.classList.add("hidden"); H.forms.open(fm.dataset.form, p.id); return; }
      const tb = T.closest("[data-tab]"); if (tb) { e.preventDefault(); H.go("patient", { pid:p.id, tab:tb.dataset.tab }); return; }
      const big = T.closest("[data-big]"); if (big) { openBigChart(p, big.dataset.big); return; }
      const act = T.closest("[data-act]");
      if (act) {
        const a = act.dataset.act, st = S(p.id);
        if (a === "reco-ok") { st.reco = `Değerlendirildi · ${me()} · ${H.now()}`; H.log("Öneri değerlendirildi", `${bedNo} · ${p.name}`); H.toast("Değerlendirme kaydedildi"); refresh(); }
        else if (a === "reco-esc") { st.reco = `Hızlı yanıt ekibine eskale edildi · ${me()} · ${H.now()}`; H.log("Eskale edildi", `${bedNo} · ${p.name} → hızlı yanıt ekibi`); H.toast("Hızlı yanıt ekibine eskale edildi", "w"); refresh(); }
        else if (a === "big-trend") openBigChart(p, st.trendKey);
        else if (a === "sofa-sign") { if (!H.can("scores_sign")) return; const tot = sofaTot(p), prev = p.sofa; st.sofaSigned = { by:me(), at:H.now(), tot };
          // 30.09: başlık / yatak kartı onaylanan değeri gösterir; "İmza bekliyor" bildirimi kapanır (okundu + sonuç yazılır)
          if (tot != null) { p.sofa = tot; p.sofaSigned = { tot, by:me(), at:H.now() }; }
          H.data.notifs.filter(n => n.pid === p.id && /İmza bekliyor/.test(n.title) && /SOFA/.test(n.body) && !n.done).forEach(n => { n.read = true; n.done = true; n.title = "İmza tamamlandı"; n.body = `${bedNo} · günlük SOFA ${tot ?? "—"} · onaylandı ${H.now()}`; n.go = ["patient", { pid:p.id, tab:"skor" }]; });
          H.log("SOFA onaylandı", `${bedNo} · GKS ${st.sofaGcs} · toplam ${tot}${prev !== tot ? ` (anlık ${prev} → onaylı ${tot})` : ""}`); H.toast("Günlük SOFA mühürlendi"); H.renderApp(); }
        else if (a === "ap-sign") { if (!H.can("scores_sign")) return; st.apSigned = { by:me(), at:H.now() }; H.log("APACHE II onaylandı", bedNo); H.toast("APACHE II mühürlendi · artık değiştirilemez"); refresh(); }
        else if (a === "dv-reset") { st.devir = devirDraft(p); H.toast("Taslak güncel verilerle yeniden hazırlandı"); refresh(); }
        else if (a === "dv-save") { st.devirSaved = H.nowFull(); H.log("Teslim notu taslağı saklandı", bedNo); H.toast("Taslak saklandı · " + st.devirSaved); refresh(); }
        else if (a === "dv-sign") {
          const crit = H.data.alarms.some(x => x.pid === p.id && x.state === "open" && x.sev === "crit");
          if (crit) { H.toast("Kritik alarm açıkken teslim edilemez; taslağı saklayabilirsiniz", "e"); refresh(); return; }
          const dr = st.devir, text = `D: ${dr.d}\nÖ: ${dr.o}\nD: ${dr.g}\nÖ: ${dr.n}`;
          H.data.handovers.push({ id:Math.max(0, ...H.data.handovers.map(h => h.id)) + 1, pid:p.id, from:`${me()} (akşam)`, by:me(), byU:(H.state.user || {}).u, to:null, state:"waiting", text, parts:{ d:dr.d, o:dr.o, g:dr.g, n:dr.n }, at:H.now(), day:H.dm(0) });   // 30.09: parçalar Devir ekranında gösterilir
          H.log("Teslim notu mühürlendi", bedNo); H.toast("Mühürlendi · gelen ekibin teslim alması bekleniyor"); refresh();
        }
        return;
      }
      const sel = T.closest("[data-sel]"); if (sel) { const st = S(p.id); st.trendKey = sel.dataset.sel; if (st.cmp === st.trendKey) st.cmp = ""; refresh(); return; }
      const th = T.closest("[data-th] button"); if (th) { S(p.id).trendH = +th.dataset.v; refresh(); return; }
      const g = T.closest("[data-gcs]"); if (g) { S(p.id).sofaGcs = g.dataset.gcs; refresh(); return; }
      const ch = T.closest("[data-apch]"); if (ch) { S(p.id).apChronic = +ch.dataset.apch; refresh(); return; }
      const tk = T.closest("[data-task]"); if (tk) { taskClick(p, TK[+tk.dataset.task], refresh); return; }
      const ds = T.closest("[data-dose]"); if (ds) { medDialog(p, dosesOf(p)[+ds.dataset.dose], refresh); return; }
      const prn = T.closest("[data-prn]"); if (prn) { const m = medsFor(p).find(x => x.id === prn.dataset.prn);
        medDialog(p, { pid:p.id, t:NOW, kind:"med", label:m.name, state:"due", prn:true }, () => { const st = S(p.id); (st.prnLast = st.prnLast || {})[m.id] = H.now(); refresh(); }); return; }
      const rt = T.closest("[data-rt] button"); if (rt) { S(p.id).resTab = rt.dataset.v; refresh(); return; }
      const lb = T.closest("[data-lab]"); if (lb && !T.closest(".modal")) { openLab(p, lb.dataset.lab, refresh); return; }
      const sn = T.closest("[data-seen]"); if (sn) { S(p.id).seen[sn.dataset.seen] = { by:me(), at:H.now() }; H.log("Radyoloji raporu görüldü", bedNo); H.toast("Görüldü olarak işaretlendi"); refresh(); return; }
      const rs = T.closest("[data-rsel]"); if (rs) { S(p.id).radSel = rs.dataset.rsel; refresh(); return; }
      const rsn = T.closest("[data-radseen]"); if (rsn) { const st = S(p.id), s0 = radOf(p).find(x => x.id === rsn.dataset.radseen); st.radSeen = st.radSeen || {};
        (st.radSeen[s0.id] = st.radSeen[s0.id] || []).push({ by:me(), at:H.nowFull() }); H.log("Radyoloji raporu görüldü", `${bedNo} · ${s0.n} · ${s0.day}.09 ${s0.tm}`); H.toast(L("rad_marked")); refresh(); return; }
      if (T.closest("[data-csform]")) { H.toast(L("cs_form_t"), "w"); H.log("Konsültasyon formu (hastane sistemi)", bedNo); return; }
      if (T.closest("[data-poreport]")) { H.toast(L("po_report_t"), "w"); H.log("Ameliyat raporu (hastane sistemi)", bedNo); return; }
      if (T.closest("[data-fmnew]")) { famDialog(p, null, refresh); return; }
      const fe = T.closest("[data-fmedit]"); if (fe) { famDialog(p, famOf(p).find(x => x.id === +fe.dataset.fmedit), refresh); return; }
      if (T.closest("[data-pacs]")) { e.preventDefault(); H.toast(L("rad_pacs_t"), "w"); H.log("PACS bağlantısı", bedNo); return; }
      if (T.closest("[data-goalarm]")) { H.go("alarms", { pid:p.id }); return; }
    };
    root.onchange = (e) => {
      const T = e.target, st = S(p.id);
      if (T.matches("[data-cmp]")) { st.cmp = T.value; refresh(); }
      else if (T.matches("[data-apgcs]")) { st.apGcs = T.value ? +T.value : null; refresh(); }
      else if (T.matches("[data-patn]")) { st.patoNotify = T.checked; H.toast(T.checked ? "Sonuç gelince bildirimlerinize düşecek (uygulama içinde)" : "Bildirim kapatıldı", T.checked ? "" : "w"); }
    };
    root.oninput = (e) => { const T = e.target; if (T.matches("[data-dv]")) { const st = S(p.id); (st.devir || (st.devir = devirDraft(p)))[T.dataset.dv] = T.value; } };
  }

  H.register("patient", {
    title:() => { const p = H.pt(H.state.params && H.state.params.pid); return p ? `${H.bed(p.bed).no} · ${pname(p)}` : H.t("m_patient"); },
    perm:"patient",
    render,
  });
})();

/* Homunculus prototip v1 — yönetim ve hasta kabul modülü.
 * Sayfalar: 'admission' (hasta kabul; HBYS yoksa elle/geçici kayıt, eşleştirme, transfer/taburcu)
 *           'admin'     (kullanıcılar, roller, hastane yapısı, entegrasyonlar, sistem ayarları, denetim kaydı)
 * Dışa verilenler: H.settings, H.bedPicker(host, opts), H.genPassword()
 * Tüm adlar UYDURMADIR; fiyat / fatura / teklif alanı yoktur. */
(function () {
  const H = window.H;
  if (!H) return;
  const esc = H.esc, I = H.icon;

  /* ================= stil (yalnız bu modül) ================= */
  const css = `
.ck{width:16px!important;height:16px;padding:0!important;margin:0;accent-color:var(--pri);flex:none;cursor:pointer}
.adm-chk{display:flex;gap:8px;align-items:flex-start;font-size:13px;cursor:pointer;margin:7px 0}
.adm-chk .ck{margin-top:2px}
.adm-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.adm-bar input,.adm-bar select{width:auto;min-width:0;flex:1 1 150px;max-width:260px}
.adm-sub{font-size:12px;color:var(--mute)}
.adm-rooms{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.adm-room{border:1px solid var(--line);border-radius:12px;padding:8px;background:var(--card2);min-width:0}
.adm-room>small{display:block;font:700 10.5px Figtree;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin-bottom:6px}
.adm-beds{display:flex;gap:6px;flex-wrap:wrap}
.adm-bd{--c:var(--mute);min-width:62px;flex:1 1 62px;text-align:left;border:1.5px solid color-mix(in srgb,var(--c) 60%,transparent);background:color-mix(in srgb,var(--c) 13%,var(--card));border-radius:10px;padding:6px 8px;font:700 12.5px "JetBrains Mono";color:var(--ink);cursor:pointer}
.adm-bd small{display:block;font:600 10.5px Figtree;color:var(--mute)}
.adm-bd[disabled]{cursor:not-allowed;opacity:.5}
.adm-bd.sel{outline:3px solid var(--pri);outline-offset:1px}
.s-bos{--c:var(--ok)}.s-dolu{--c:var(--mute)}.s-temizlik{--c:var(--mid)}.s-bloke{--c:var(--crit)}.s-rezerve{--c:var(--low)}
.adm-lg{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--mute);margin:10px 0}
.adm-lg span{display:inline-flex;align-items:center;gap:5px}
.adm-lg span::before{content:"";width:10px;height:10px;border-radius:3px;background:color-mix(in srgb,var(--c) 40%,transparent);border:1.5px solid var(--c)}
.adm-pk h6{margin:10px 0 6px;font:700 10.5px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.adm-pk h6:first-child{margin-top:0}
.adm-split{display:grid;grid-template-columns:minmax(230px,320px) 1fr;gap:14px;align-items:start}
.adm-split>*{min-width:0}
.adm-tn{display:flex;gap:8px;align-items:center;padding:7px 8px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;min-width:0}
.adm-tn:hover{background:var(--card2)}.adm-tn.on{background:var(--priSoft);color:var(--pri)}
.adm-tn svg{width:15px;height:15px;flex:none;color:var(--mute)}
.adm-tn .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.adm-tn .c{margin-left:auto;font:600 11px "JetBrains Mono";color:var(--mute);white-space:nowrap}
.adm-mx th{white-space:normal!important;min-width:82px;vertical-align:bottom;text-align:center!important}
.adm-mx td{text-align:center}
.adm-mx td:first-child,.adm-mx th:first-child{text-align:left!important;position:sticky;left:0;background:var(--card);z-index:1;min-width:170px}
.adm-mx th:first-child{background:var(--card2)}
.adm-mx tr.grp td{background:var(--card2);font:700 10.5px Figtree;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);text-align:left}
.adm-mx td small{display:block;color:var(--mute);font:600 10.5px "JetBrains Mono"}
.adm-err>label{color:var(--crit)!important}
.adm-err input,.adm-err select,.adm-err textarea,.adm-err .opts,.adm-err .adm-rooms{outline:2px solid color-mix(in srgb,var(--crit) 60%,transparent);outline-offset:2px;border-radius:10px}
.adm-pw{font:700 18px "JetBrains Mono";letter-spacing:.06em;background:var(--card2);border:1px dashed var(--line2);border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap;word-break:break-all}
.adm-dot{width:9px;height:9px;border-radius:50%;background:var(--c,var(--ok));display:inline-block;box-shadow:0 0 0 3px color-mix(in srgb,var(--c,var(--ok)) 25%,transparent);flex:none}
.adm-acts{display:flex;gap:2px;justify-content:flex-end}
.adm-cand{display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px dashed var(--line);flex-wrap:wrap}
.adm-pct{font:700 18px "JetBrains Mono";min-width:54px}
.adm-meter{height:6px;border-radius:99px;background:var(--card2);overflow:hidden;width:80px;margin-top:4px}
.adm-meter i{display:block;height:100%;background:var(--c)}
.adm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.adm-stack{display:grid;gap:12px}
.adm .fld>div,.modal .fld>div{min-width:0}
.adm-num{width:96px!important}
@media(max-width:860px){.adm-split{grid-template-columns:1fr}}
/* hastane yapısı (24.09 yeniden) · ağaç + kat planı; ≤900px ağaç üstte açılır çekmece */
.adm-st{display:grid;grid-template-columns:minmax(250px,300px) minmax(0,1fr);gap:14px;align-items:start}
.adm-st>*{min-width:0}
.adm-st-side{padding:8px;position:sticky;top:0;max-height:calc(100vh - 170px);display:flex;flex-direction:column;min-width:0}
.adm-st-body{display:flex;flex-direction:column;gap:6px;min-height:0;flex:1}
.adm-st-tog{display:none;align-items:center;gap:8px;width:100%;background:none;border:0;padding:4px 4px;cursor:pointer;font:600 13px Figtree;color:var(--ink);text-align:left;min-width:0}
.adm-st-tog svg{width:16px;height:16px;flex:none;color:var(--mute)}
.adm-st-tog svg:last-child{margin-left:auto;transition:transform .15s}
.adm-st-side.open .adm-st-tog svg:last-child{transform:rotate(180deg)}
.adm-st-tog .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.adm-st-find{display:flex;gap:6px;align-items:center;min-width:0}
.adm-st-q{flex:1;min-width:0;display:flex;align-items:center;gap:6px;background:var(--card2);border:1px solid var(--line2);border-radius:9px;padding:0 8px;color:var(--mute)}
.adm-st-q:focus-within{border-color:var(--pri);box-shadow:0 0 0 3px var(--priSoft)}
.adm-st-q svg{width:14px;height:14px;flex:none}
.adm-st-q input{border:0;background:transparent;padding:6px 0;font-size:13px;box-shadow:none!important;min-width:0}
.adm-st-tree{overflow:auto;min-height:0;flex:1}
.adm-tn{padding-top:5px;padding-bottom:5px;gap:6px}
.adm-tn .car{width:18px;height:18px;border:0;background:none;padding:0;display:grid;place-items:center;color:var(--mute);cursor:pointer;flex:none;border-radius:5px}
.adm-tn .car:hover{background:var(--card2);color:var(--ink)}
.adm-tn .car svg{width:14px;height:14px;transition:transform .15s}
.adm-tn .car.shut svg{transform:rotate(-90deg)}
.adm-tn .car.nil{visibility:hidden}
.adm-tn.off{opacity:.5}
.adm-tn .nm{min-width:0}
.adm-tn .cd,.adm-st-li .cd{font:600 10.5px "JetBrains Mono";color:var(--mute);flex:none}
.adm-ptag{font:700 9.5px Figtree;padding:1px 5px;border:1px solid var(--line2);border-radius:6px;color:var(--mute);text-transform:uppercase;letter-spacing:.04em;flex:none;white-space:nowrap}
.adm-tier{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block;background:var(--c,var(--mute))}
.adm-tier.tam{--c:var(--pri)}.adm-tier.ara{--c:var(--ok)}.adm-tier.op{--c:var(--mute)}
.adm-st-foot{border-top:1px dashed var(--line);padding:7px 4px 2px;font-size:11.5px;color:var(--mute);display:grid;gap:4px}
.adm-st-foot .lg{display:flex;gap:10px;flex-wrap:wrap}
.adm-st-foot .lg span{display:inline-flex;align-items:center;gap:5px}
.adm-st-li{display:flex;gap:8px;align-items:center;width:100%;min-width:0;background:none;border:0;border-bottom:1px dashed var(--line);padding:8px 2px;cursor:pointer;font:600 13px Figtree;color:var(--ink);text-align:left}
.adm-st-li:last-child{border-bottom:0}
.adm-st-li:hover{color:var(--pri)}
.adm-st-li.off{opacity:.55}
.adm-st-li .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.adm-st-li .c{margin-left:auto;font:600 11px "JetBrains Mono";color:var(--mute);white-space:nowrap;flex:none}
.adm-rm-h{display:flex;align-items:center;gap:6px;width:100%;min-width:0;background:none;border:0;padding:0 0 6px;cursor:pointer;font:700 10.5px Figtree;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);text-align:left}
.adm-rm-h:hover{color:var(--pri)}
.adm-rm-h .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.adm-rm-h .c{margin-left:auto;font:600 10.5px "JetBrains Mono";letter-spacing:0;flex:none}
.adm-room.sel{border-color:var(--pri);box-shadow:0 0 0 1px var(--pri)}
.adm-room.off{opacity:.6}
.adm-life{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}
.adm-life .adm-sub{flex:1 1 200px}
.adm-st-det .kv>span:first-child{flex:none}
.adm-st-det .kv>b{text-align:right;min-width:0;overflow-wrap:anywhere}
@media(max-width:640px){.adm-st-hint{display:none}}
@media(max-width:900px){.adm-st{grid-template-columns:1fr}.adm-st-side{position:static;max-height:none}.adm-st-tog{display:flex}
  .adm-st-side:not(.open) .adm-st-body{display:none}.adm-st-side.open .adm-st-body{margin-top:6px}.adm-st-side.open .adm-st-tree{max-height:55vh}}
`;
  const st = document.createElement("style"); st.id = "adm-css"; st.textContent = css; document.head.appendChild(st);

  /* ================= sabitler ve yardımcılar ================= */
  const TODAY = new Date(H.DAY0);   // 30.09c: gerçek nöbet günü (yaş hesabı)
  const AGE_L = { adult:"Erişkin", child:"Çocuk", neonate:"Yenidoğan" };
  const BST = { bos:"Boş", dolu:"Dolu", temizlik:"Temizlik", bloke:"Bloke", rezerve:"Rezerve" };
  const ADM_T = { medikal:"Medikal yatış", ameliyat:"Ameliyat", yb:"Yoğun bakım", mudahale:"Müdahale" };
  const BLOOD = ["Bilinmiyor", "0 Rh(+)", "0 Rh(-)", "A Rh(+)", "A Rh(-)", "B Rh(+)", "B Rh(-)", "AB Rh(+)", "AB Rh(-)"];
  const NAT = ["Azərbaycan", "Türkiyə", "Rusiya", "Gürcüstan", "İran", "Digər"];
  const RULES = ["NEWS2", "SOFA + NEWS2", "PEWS", "nSOFA"];
  const unitKind = (u) => (H.KIND && H.KIND[u.kind]) || (u.type === "nicu" ? "Yenidoğan yoğun bakım" : u.type === "icu" ? "Yoğun bakım" : "Servis");

  const ageFromDob = (dob) => {
    if (!dob) return null; const d = new Date(dob + "T00:00:00"); if (isNaN(d) || d > TODAY) return null;
    const days = Math.floor((TODAY - d) / 864e5); let y = TODAY.getFullYear() - d.getFullYear();
    if (TODAY.getMonth() < d.getMonth() || (TODAY.getMonth() === d.getMonth() && TODAY.getDate() < d.getDate())) y--;
    return { years:y, days };
  };
  const ageGroupOf = (a) => !a ? null : a.days <= 28 ? "neonate" : a.years < 18 ? "child" : "adult";
  const ageStr = (a) => !a ? "—" : a.days <= 28 ? a.days + " günlük" : a.years < 1 ? Math.floor(a.days / 30.4) + " aylık" : a.years + " yaş";
  const dmy = (iso) => iso ? iso.split("-").reverse().join(".") : "—";
  const bedLabel = (id) => { const b = H.bed(id); if (!b) return "—"; const u = H.unit(b.unitId); return `${b.no} · ${u.tr} · Oda ${b.room}`; };
  const uname = (u) => (H.userBy(u) || {}).name || u || "—";
  const counts = (beds) => ({ t:beds.length, d:beds.filter(b => b.status === "dolu").length, b:beds.filter(b => b.status === "bos").length });
  const me = () => H.state.user || {};
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const opts = (f, list, val, multi) => `<div class="opts" data-f="${f}"${multi ? " data-multi" : ""}>${list.map(([v, l]) => `<i data-v="${esc(v)}" class="${(multi ? (val || []).includes(v) : val === v) ? "on" : ""}">${l}</i>`).join("")}</div>`;
  const fld = (f, label, html, req) => `<div class="fld" data-w="${f}"><label>${label}${req ? ' <span class="req">*</span>' : ""}</label><div>${html}</div></div>`;
  const inp = (f, v, a = "") => `<input data-f="${f}" value="${esc(v ?? "")}" ${a}>`;
  const sel = (f, list, v) => `<select data-f="${f}">${list.map(x => { const [k, l] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(k)}"${k === v ? " selected" : ""}>${esc(l)}</option>`; }).join("")}</select>`;
  const chk = (f, v, label) => `<label class="adm-chk"><input type="checkbox" class="ck" data-f="${f}"${v ? " checked" : ""}><span>${label}</span></label>`;

  /* form alanlarını (data-f) bir nesneye bağlar; .opts[data-f] tek/çoklu seçim */
  function bindForm(box, obj, onChange) {
    box.addEventListener("click", e => {
      const i = e.target.closest(".opts[data-f] > i"); if (!i || !box.contains(i) || i.closest("fieldset[disabled]")) return;
      const g = i.parentElement, f = g.dataset.f;
      if (g.hasAttribute("data-multi")) { const a = new Set(obj[f] || []); a.has(i.dataset.v) ? a.delete(i.dataset.v) : a.add(i.dataset.v); obj[f] = [...a]; i.classList.toggle("on"); }
      else { obj[f] = i.dataset.v; g.querySelectorAll("i").forEach(x => x.classList.toggle("on", x === i)); }
      const w = g.closest("[data-w]"); if (w) w.classList.remove("adm-err");
      onChange && onChange(f);
    });
    const upd = e => { const t = e.target; if (!t.dataset || !t.dataset.f || t.classList.contains("opts")) return;
      obj[t.dataset.f] = t.type === "checkbox" ? t.checked : t.value; const w = t.closest("[data-w]"); if (w) w.classList.remove("adm-err"); onChange && onChange(t.dataset.f); };
    box.addEventListener("input", upd); box.addEventListener("change", upd);
  }
  const markErr = (box, keys) => box.querySelectorAll("[data-w]").forEach(w => w.classList.toggle("adm-err", keys.includes(w.dataset.w)));

  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ə/g, "e").replace(/ı/g, "i").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const lev = (a, b) => { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let prev = Array.from({ length:n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; };
  const sim = (a, b) => { a = norm(a); b = norm(b); if (!a || !b) return 0; return 1 - lev(a, b) / Math.max(a.length, b.length); };

  H.genPassword = (len) => {
    const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnpqrstuvwxyz", D = "23456789", S = "!#%+?@", pick = s => s[Math.floor(Math.random() * s.length)];
    const n = Math.max(12, len || (H.settings && +H.settings.pwMin) || 10), a = [pick(U), pick(L), pick(D), pick(S)];
    while (a.length < n) a.push(pick(U + L + D));
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.join("");
  };

  /* ================= sistem ayarları (varsayılanlar) ================= */
  const MODS = [
    ["med_order", "İlaç order'ı", 1], ["med_admin", "İlaç uygulama çizelgesi", 3, "HBYS'de yoksa bizde"], ["lab", "Laboratuvar sonuçları", 1],
    ["rad", "Radyoloji raporu / PACS", 1], ["path", "Patoloji raporu", 1], ["req", "Tetkik isteme", 1],
    ["nurse", "Hemşirelik değerlendirmeleri", 3, "düşme, bası yarası, ağrı…"], ["vitals", "Vital bulgular", 0], ["hand", "Vardiya devri", 3],
  ];
  H.settings = Object.assign({
    lang:"AZ", userLangChange:"evet", sessionTimeout:15, quickLock:"acik",
    pwMin:10, pwUpper:true, pwDigit:true, pwSpecial:true, pwDays:90, pwHistory:5,
    maxFails:5, lockMin:15, mfaRoles:["sistem", "yonetici", "hekim"], mortality:"kapali",
    modes:Object.fromEntries(MODS.filter(m => m[2]).map(m => [m[0], m[2]])),
  }, H.settings || {});

  /* ================= demo verisine ekler (uydurma) ================= */
  const LAST = { "dr.kamran":"23.09 19:58", "hs.sevda":"23.09 20:05", "hs.gulnar":"23.09 08:04", "hs.nuray":"23.09 07:52", "rrt.emil":"23.09 21:03", "ecz.lale":"23.09 16:40",
    "bio.orxan":"23.09 13:12", "kabul.ulviyye":"23.09 19:31", "mudur.rauf":"22.09 23:15", admin:"23.09 20:10", "kalite.tural":"23.09 17:08" };
  H.data.users.forEach(x => { if ((!x.lastLogin || x.lastLogin === "—") && LAST[x.u]) x.lastLogin = H.ts(LAST[x.u]); });   // 30.09c: gerçek saate kaydırılır
  if (!H.userBy("hs.melek")) H.data.users.push({ u:"hs.melek", pw:"Demo123!", name:"Mələk Abbasova", role:"hemsire", units:["rea"], title:"Tibb bacısı", mfa:false, active:true, fails:5, lockedUntil:Date.now() + 11 * 60000, lastLogin:H.ts("23.09 07:58"), email:"" });
  if (!H.userBy("dr.samir")) H.data.users.push({ u:"dr.samir", pw:"Demo123!", name:"Dr. Samir Quliyev", role:"hekim", units:["cer"], title:"Cərrah", mfa:true, active:false, fails:0, lockedUntil:0, lastLogin:H.ts("02.09 18:20"), email:"" });

  /* hastane kaydından gelen bekleyen yatışlar (HL7 ADT ön kabul) */
  const HBYS_Q = [
    { id:"h1", proto:"2026-104512", name:"Orxan", surname:"Cəlilov", father:"Vüqar", sex:"E", dob:"1962-03-14", fin:"4TR7K2M", type:"yb", unit:"rea", doc:"dr.kamran", reason:"Solunum sıkıntısı, yakın izlem talebi", at:H.at("21:12"), blood:"B Rh(+)", weight:86, height:178, allergies:[], comp:"Oğlu · +994 50 *** ** 14" },
    { id:"h5", proto:"2026-104509", name:"Vüsal", surname:"Kazımov", father:"Arif", sex:"E", dob:"1977-01-30", fin:"9LC3H6D", type:"mudahale", unit:"dax", doc:"dr.kamran", reason:"Endoskopik işlem sonrası gözlem", at:H.at("21:05"), blood:"Bilinmiyor", weight:90, height:182, allergies:[], comp:"Yok" },
    { id:"h2", proto:"2026-104497", name:"Günay", surname:"Məlikova", father:"Rafiq", sex:"K", dob:"1990-07-02", fin:"7WE2S5N", type:"ameliyat", unit:"cer", doc:"dr.kamran", reason:"Planlı ameliyat · safra kesesi taşı", at:H.at("20:47"), blood:"A Rh(-)", weight:61, height:165, allergies:["Lateks"], comp:"Eşi" },
    { id:"h3", proto:"2026-104490", name:"Eldar", surname:"Hacıyev", father:"Musa", sex:"E", dob:"1951-11-20", fin:"3FG8B1K", type:"medikal", unit:"dax", doc:"yeni.hekim", reason:"Nefes darlığı, bacaklarda ödem", at:H.at("20:31"), blood:"0 Rh(+)", weight:79, height:170, allergies:[], comp:"Kızı" },
    { id:"h4", proto:"2026-104478", name:"Aylin", surname:"Novruzova", father:"Ramin", sex:"K", dob:"2020-05-09", fin:"—", type:"medikal", unit:"usq", doc:"dr.kamran", reason:"Yüksek ateş, sıvı alımında azalma", at:H.at("19:58"), blood:"A Rh(+)", weight:21, height:116, allergies:[], comp:"Annesi (refakatçi kalacak)" },
  ];
  /* HBYS kişi dizini — geçici kayıtların eşleştirme adayları */
  const HBYS_DIR = [
    { proto:"2026-104388", name:"Elşən", surname:"Talıbov", father:"Rövşən", sex:"E", dob:"1981-06-17", fin:"6JH3P8Q", blood:"0 Rh(+)", allergies:["Metamizol"] },
    { proto:"2026-104401", name:"Elçin", surname:"Talıbov", father:"Rövşən", sex:"E", dob:"1979-02-03", fin:"2MN8R4T", blood:"A Rh(+)", allergies:[] },
    { proto:"2026-104276", name:"Kənan", surname:"Əsgərov", father:"Səməd", sex:"E", dob:"1984-10-11", fin:"7PL2W5E", blood:"B Rh(+)", allergies:[] },
    { proto:"2026-104455", name:"Sevinc", surname:"Rüstəmova", father:"Nazim", sex:"K", dob:"1972-08-25", fin:"3QD9Z6Y", blood:"AB Rh(-)", allergies:[] },
    { proto:"2026-104460", name:"Fidan", surname:"Mirzəyeva", father:"Elxan", sex:"K", dob:"1995-12-01", fin:"5VB7N1C", blood:"0 Rh(-)", allergies:["Penisilin"] },
    { proto:"2026-104502", name:"Ramil", surname:"Əhmədov", father:"Qəzənfər", sex:"E", dob:"1968-04-22", fin:"8XK4M2A", blood:"A Rh(-)", allergies:[] },
  ];

  /* ================= hasta oluşturma ================= */
  let gSeq = 0;
  const nextG = () => "G-2026-" + String(++gSeq).padStart(4, "0");
  const peekG = () => "G-2026-" + String(gSeq + 1).padStart(4, "0");
  /* 24.09 (3. oturum) · Ozan #77: elle kayıtta iki numara oluşur.
   *   Hasta no (HN) · KİŞİYE ait, bir kez verilir, sonraki yatışlarda aynı kalır.
   *   Protokol (G-) · bu YATIŞA ait, geçici; hastane kaydıyla eşleşince hastanenin protokolü gelir, G- numarası geçmişte kalır. */
  let hnSeq = 0;
  const nextHN = () => "HN-" + String(260200 + ++hnSeq).padStart(7, "0");
  const peekHN = () => "HN-" + String(260200 + hnSeq + 1).padStart(7, "0");
  function numbersModal(p) {
    H.modal({ title:"Kayıt açıldı · " + esc(H.bed(p.bed).no),
      body:`<div class="adm-nums"><div><small>Hasta no</small><b class="mono">${esc(p.hn)}</b><span>Kişiye ait · sonraki yatışlarda da aynı</span></div>
        <div><small>Protokol</small><b class="mono">${esc(p.proto)}</b><span>Bu yatışa ait · geçici, hastane kaydıyla eşleşince değişir</span></div></div>
        <p class="adm-sub" style="margin:12px 0 0">${esc(p.name)} · ${esc(bedLabel(p.bed))}. Kol bandı bu iki numarayla basılır.</p>`,
      actions:`<button class="btn" data-x>Kapat</button>${H.print && H.print.canDoc("prlbl") ? `<button class="btn" data-x data-stk>${I("qr")}${H.t("pr_btn_stk")}</button>` : ""}<button class="btn p" data-x data-band>${I("print")}Kol bandı yazdır</button>` });
    const sk = document.querySelector("[data-stk]"); if (sk) sk.addEventListener("click", () => H.print.open("prlbl", { pid:p.id, n:6 }));
    // 24.09 · yazdir.js varsa kol bandı önizlemesi açılır (barkodlu); denetim kaydı "Yazıcıya gönder"de düşer.
    const b = document.querySelector("[data-band]"); if (b) b.addEventListener("click", () => {
      if (H.print && H.print.canDoc("band")) { H.print.open("band", { pid:p.id }); return; }
      H.log("Kol bandı yazdırıldı", `${p.hn} · ${p.proto}`); H.toast("Kol bandı yazıcıya gönderildi"); });
  }
  const nextPid = () => "p" + (Math.max(0, ...H.data.patients.map(p => +String(p.id).replace(/\D/g, "") || 0)) + 1);
  const VDEF = { adult:{ hr:84, sbp:124, dbp:76, map:92, spo2:97, rr:16, temp:36.8, o2:"Oda havası", loc:"Uyanık" },
    child:{ hr:102, sbp:100, dbp:62, map:75, spo2:98, rr:22, temp:36.9, o2:"Oda havası", loc:"Uyanık" },
    neonate:{ hr:140, sbp:64, dbp:38, map:47, spo2:97, rr:46, temp:36.8, o2:"Oda havası", loc:"—" } };
  const nurseFor = (unitId) => { const n = H.data.users.find(x => x.active !== false && x.role === "hemsire" && x.units.includes(unitId)); return n ? n.u : null; };
  function admit(d, bedId) {
    const b = H.bed(bedId), u = H.unit(b.unitId), ag = d.ageGroup || "adult";
    const p = Object.assign({ id:nextPid(), name:d.name, sex:d.sex, age:d.age || 0, ageGroup:ag, bed:bedId, dx:d.dx || "—", icd:"—", admitDays:0,
      attending:d.attending || null, nurse:nurseFor(u.id), blood:d.blood || "Bilinmiyor", weight:d.weight || null, height:d.height || null,
      allergies:d.allergies || [], chronic:[], isolation:null, codeStatus:"Tam", antibioticDay:null, monitored:u.type === "icu" || u.type === "nicu", risk:"stable",
      v:Object.assign({}, VDEF[ag]), flags:{}, notes:[], admittedAt:H.now(), admittedBy:me().u || "—" }, d.meta || {});
    if (ag === "neonate") Object.assign(p, { ageDays:d.ageDays || 0, nsofa:0, gestWeeks:null, birthWeight:null });
    else if (ag === "child") p.pews = 0; else Object.assign(p, { news2:0, sofa:0 });
    if (!p.hn) p.hn = nextHN();
    b.status = "dolu"; b.pid = p.id; H.data.patients.push(p);
    return p;
  }
  const prune = (arr, pid) => { if (!Array.isArray(arr)) return; for (let i = arr.length - 1; i >= 0; i--) if (arr[i].pid === pid) arr.splice(i, 1); };
  H.data.discharged = H.data.discharged || [];

  // Demo: acilden gelen, kimliği bilinmeyen bir geçici kayıt (eşleşme ekranı boş görünmesin)
  (function seed() { const b = H.bed("cer-6"); if (!b || b.status !== "bos") return; const proto = nextG();
    admit({ name:`Bilinmeyen hasta (E) · ${proto}`, sex:"E", age:45, ageGroup:"adult", dx:"Acil başvuru · kimlik belgesi yok, gözlem", attending:"dr.kamran",
      meta:{ temp:true, proto, source:"elle", unknown:true, estAge:45, consent:"sonra alınacak", admitType:"medikal", admittedAt:H.at("19:36"), admittedBy:"kabul.ulviyye" } }, "cer-6"); })();

  /* ================= yapı seçici: Bina > Kat > Birim > oda/yatak ızgarası ================= */
  const locOf = (unitId) => { for (const b of H.data.hospital.buildings) for (const f of b.floors) if (f.units.some(u => u.id === unitId)) return { b:b.id, f:f.id }; return {}; };
  const roomsOf = (u) => { const m = new Map(); u.beds.forEach(b => { if (!m.has(b.room)) m.set(b.room, []); m.get(b.room).push(b); }); return [...m.entries()]; };
  const legend = () => `<div class="adm-lg">${Object.entries(BST).map(([k, l]) => `<span class="s-${k}">${l}</span>`).join("")}</div>`;
  const bedTile = (b, attrs, selected, showPt) => { const p = b.status === "dolu" && showPt && H.showNames() ? H.pt(b.pid) : null;
    return `<button type="button" class="adm-bd s-${b.status}${selected ? " sel" : ""}" ${attrs}>${esc(b.no)}<small>${p ? esc(p.name.split(" ")[0]) : BST[b.status]}</small></button>`; };

  /** H.bedPicker(host, { unitId?, ageGroup? (string|function), selected?, onPick(bedId|null) }) → { redraw, get } */
  function bedPicker(host, o = {}) {
    const ag = () => typeof o.ageGroup === "function" ? o.ageGroup() : o.ageGroup;
    const S = { u:o.unitId || null, bed:o.selected || null };
    if (!S.u) { const g = ag(); const c = H.units().find(u => (!g || u.ageGroup === g) && u.beds.some(b => b.status === "bos")) || H.units()[0]; S.u = c && c.id; }
    Object.assign(S, locOf(S.u));
    host.classList.add("adm-pk");
    function draw() {
      const hs = H.data.hospital, bl = hs.buildings.find(b => b.id === S.b) || hs.buildings[0];
      const fl = bl ? (bl.floors.find(f => f.id === S.f) || bl.floors[0]) : null, un = fl ? fl.units.find(u => u.id === S.u) : null, g = ag();
      let h = `<h6>Bina</h6><div class="opts">${hs.buildings.map(b => `<i data-pb="${b.id}" class="${bl && b.id === bl.id ? "on" : ""}">${esc(b.name)}</i>`).join("")}</div>`;
      h += `<h6>Kat</h6><div class="opts">${bl && bl.floors.length ? bl.floors.map(f => `<i data-pf="${f.id}" class="${fl && f.id === fl.id ? "on" : ""}">Kat ${f.no}</i>`).join("") : '<span class="adm-sub">Bu binada kat yok</span>'}</div>`;
      h += `<h6>Birim</h6><div class="opts">${fl && fl.units.length ? fl.units.map(u => `<i data-pu="${u.id}" class="${un && u.id === un.id ? "on" : ""}">${esc(u.tr)} <small>${counts(u.beds).b} boş</small></i>`).join("") : '<span class="adm-sub">Bu katta birim yok</span>'}</div>`;
      if (un) {
        if (g && un.ageGroup !== g) h += `<div class="note" style="margin-top:10px">${I("alert")} Bu birim ${AGE_L[un.ageGroup].toLowerCase()} hastalar için; hasta ${AGE_L[g].toLowerCase()}. Uygunluğu sorumlu hekimle doğrulayın.</div>`;
        h += legend() + `<div class="adm-rooms">${roomsOf(un).map(([r, bs]) => `<div class="adm-room"><small>Oda ${esc(r)}</small><div class="adm-beds">${bs.map(b => bedTile(b, `data-pbed="${b.id}"${b.status === "bos" ? "" : " disabled"} title="${BST[b.status]}"`, b.id === S.bed)).join("")}</div></div>`).join("")}</div>`;
        h += `<p class="adm-sub" style="margin:10px 0 0">${S.bed ? `Seçilen: <b style="color:var(--ink)">${esc(bedLabel(S.bed))}</b>` : "Yalnız boş yataklar seçilebilir."}</p>`;
      }
      host.innerHTML = h;
    }
    host.addEventListener("click", e => {
      const t = e.target.closest("[data-pb],[data-pf],[data-pu],[data-pbed]"); if (!t || !host.contains(t) || t.disabled) return;
      const prevU = S.u;
      if (t.dataset.pb) { S.b = t.dataset.pb; const bl = H.data.hospital.buildings.find(b => b.id === S.b); const f = bl && bl.floors[0]; S.f = f && f.id; S.u = f && f.units[0] ? f.units[0].id : null; }
      else if (t.dataset.pf) { S.f = t.dataset.pf; const f = H.data.hospital.buildings.find(b => b.id === S.b).floors.find(x => x.id === S.f); S.u = f.units[0] ? f.units[0].id : null; }
      else if (t.dataset.pu) S.u = t.dataset.pu;
      else if (t.dataset.pbed) { S.bed = t.dataset.pbed; o.onPick && o.onPick(S.bed); }
      if (S.u !== prevU && S.bed) { S.bed = null; o.onPick && o.onPick(null); }
      draw();
    });
    draw();
    return { redraw:draw, get:() => S.bed };
  }
  H.bedPicker = bedPicker;

  /* ================================================================
   *                         HASTA KABUL
   * ================================================================ */
  const A = { tab:"hbys", form:null, q:"", tSel:null };
  const newForm = () => ({ name:"", surname:"", father:"", sex:"", dob:"", nat:"Azərbaycan", fin:"", idDoc:"", phone:"", kin:"", kinRel:"", kinPhone:"", comp:"yok",
    type:"medikal", attending:"", reason:"", allergy:"", noAllergy:false, blood:"Bilinmiyor", weight:"", height:"", kvkk:false, sms:false, unconscious:false, bed:null });
  const doctors = () => H.data.users.filter(x => x.role === "hekim" && x.active !== false);
  const docOpts = (v) => [["", "Seçin…"], ...doctors().map(d => [d.u, d.name])];
  const hbysChip = () => `<span class="tag"><span class="adm-dot"></span>Kayıt bağlantısı çalışıyor · ${H.at("21:40")}</span>`;

  H.register("admission", { title:() => "Hasta kabul", perm:["admission", "admission_view"], render(root, params) {
    root.innerHTML = ""; const el = document.createElement("div"); el.className = "adm"; root.appendChild(el);
    if (params && params.tab) A.tab = params.tab;
    admissionPage(el);
  } });

  function admissionPage(el) {
    const can = H.can("admission");
    if (!A.form) A.form = newForm();

    function draw() {
      const temps = H.data.patients.filter(p => p.temp);
      const tabs = [["hbys", "Gelen yatışlar", HBYS_Q.length], ["elle", "Elle kayıt"], ["eslesme", "Eşleşme bekleyenler", temps.length], ["transfer", "Transfer / taburcu"]];
      el.innerHTML = `<div class="ph"><div><h2>Hasta kabul</h2><p>Yatışlar normalde hastane kaydından gelir. Kayda ulaşılamazsa geçici kayıt açılır, sonra asıl kayıtla eşleştirilir.</p></div><div class="r">${hbysChip()}</div></div>
        ${can ? "" : `<div class="note i">${I("eye")} Görüntüleme yetkisiyle açtınız. Kayıt açma, yatak atama ve taburcu işlemleri kabul görevlisi ya da sorumlu hemşiredir.</div>`}
        <div class="tabs">${tabs.map(([k, l, n]) => `<span data-tab="${k}" class="${A.tab === k ? "on" : ""}">${l}${n ? ` <em>${n}</em>` : ""}</span>`).join("")}</div><div data-body></div>`;
      const body = el.querySelector("[data-body]");
      ({ hbys:tabHbys, elle:tabElle, eslesme:tabMatch, transfer:tabTransfer })[A.tab](body);
    }

    el.addEventListener("click", e => {
      const t = e.target.closest("[data-tab]"); if (t && el.contains(t)) { A.tab = t.dataset.tab; H.state.params = Object.assign({}, H.state.params, { tab:A.tab }); draw(); return; }
      const a = e.target.closest("[data-act]"); if (!a || !el.contains(a) || a.disabled) return;
      const id = a.dataset.id;
      if (a.dataset.act === "assign") assignModal(HBYS_Q.find(q => q.id === id));
      else if (a.dataset.act === "unknown") unknownModal();
      else if (a.dataset.act === "formSave") saveForm();
      else if (a.dataset.act === "formReset") { A.form = newForm(); draw(); }
      else if (a.dataset.act === "merge") { const [pid, proto] = id.split("|"); mergeModal(H.pt(pid), HBYS_DIR.find(c => c.proto === proto)); }
      else if (a.dataset.act === "requery") { H.toast("Kayıt sorgusu gönderildi · yeni aday yok"); H.log("Kayıt kimlik sorgusu", H.pt(id) ? H.pt(id).proto : id); }
      else if (a.dataset.act === "tsel") { A.tSel = id; draw(); }
      else if (a.dataset.act === "transfer") transferModal(H.pt(id));
      else if (a.dataset.act === "discharge") dischargeModal(H.pt(id));
      else if (a.dataset.act === "openpt") H.go("patient", { pid:id, tab:"ozet" });
    });

    /* ---------- 1. Gelen yatışlar ---------- */
    function tabHbys(body) {
      if (!HBYS_Q.length) { body.innerHTML = `<div class="empty">Bekleyen yatış yok. Yeni yatış geldiğinde burada görünür.</div>`; return; }
      body.innerHTML = `<div class="tw"><table class="t"><thead><tr><th>Kaynak</th><th>Hasta</th><th>Yatış tipi</th><th>İstenen birim</th><th>Hekim</th><th>Yatış nedeni</th><th></th></tr></thead><tbody>
        ${HBYS_Q.map(q => { const a = ageFromDob(q.dob), u = H.unit(q.unit);
          return `<tr><td><span class="tag">${I("link")}Kayıt · ${q.at}</span></td>
            <td><b>${esc(q.name + " " + q.surname)}</b><div class="adm-sub">${q.sex === "E" ? "Erkek" : "Kadın"} · ${ageStr(a)} · FİN <span class="mono">${esc(q.fin)}</span></div></td>
            <td>${ADM_T[q.type]}</td><td>${esc(u ? u.tr : q.unit)}</td><td>${esc(uname(q.doc))}</td><td class="adm-sub" style="min-width:180px">${esc(q.reason)}</td>
            <td><button class="btn sm p" data-act="assign" data-id="${q.id}"${can ? "" : " disabled"}>${I("bed")}Yatak ata</button></td></tr>`; }).join("")}
        </tbody></table></div>
        <p class="adm-sub" style="margin-top:10px">Liste ön kabul kayıtlarıyla güncellenir. Kimlik ve yatış planı hastane kaydından gelir; burada yalnız yatak atanır.</p>`;
    }

    function assignModal(q) {
      if (!q) return; let chosen = null; const a = ageFromDob(q.dob), ag = ageGroupOf(a), u = H.unit(q.unit);
      const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
      H.modal({ title:"Yatak ata · " + esc(q.name + " " + q.surname), wide:true,
        body:`<div class="g2" style="margin-bottom:12px"><div class="box"><h5>Hastane kaydı <span class="r"><span class="tag">Kayıt · ${q.at}</span></span></h5>
            ${kv("Protokol", esc(q.proto))}${kv("Ata adı", esc(q.father))}${kv("Cinsiyet · yaş", `${q.sex === "E" ? "Erkek" : "Kadın"} · ${ageStr(a)}`)}${kv("Doğum tarihi", dmy(q.dob))}${kv("FİN", esc(q.fin))}${kv("Kan grubu", esc(q.blood))}${kv("Alerji", q.allergies.length ? esc(q.allergies.join(", ")) : "Bilinen yok")}</div>
          <div class="box"><h5>Yatış planı</h5>${kv("Yatış tipi", ADM_T[q.type])}${kv("İstenen birim", esc(u ? u.tr : q.unit))}${kv("Sorumlu hekim", esc(uname(q.doc)))}${kv("Refakatçi", esc(q.comp))}
            <div class="adm-sub" style="margin-top:8px">${esc(q.reason)}</div></div></div>
          <div class="box"><h5>${I("bed")} Yatak seçimi</h5><div data-pk></div></div>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok disabled>${I("ok")}Ata ve kabul et</button>`,
        onMount(m) {
          const ok = m.querySelector("[data-ok]");
          bedPicker(m.querySelector("[data-pk]"), { unitId:q.unit, ageGroup:ag, onPick(id) { chosen = id; ok.disabled = !id; } });
          ok.onclick = () => {
            if (!chosen) return;
            const p = admit({ name:q.name + " " + q.surname, sex:q.sex, age:a.years, ageDays:a.days, ageGroup:ag, dx:q.reason, attending:q.doc, blood:q.blood, weight:q.weight, height:q.height, allergies:q.allergies.slice(),
              meta:{ temp:false, proto:q.proto, source:"hbys", fin:q.fin, dob:q.dob, father:q.father, admitType:q.type, companion:q.comp } }, chosen);
            HBYS_Q.splice(HBYS_Q.indexOf(q), 1);
            H.log("Hasta kabul (kayıttan)", `${p.name} · Protokol ${q.proto} → ${bedLabel(chosen)}`);
            H.closeModal(); H.toast(`${p.name} · ${H.bed(chosen).no} yatağına yerleşti`); draw();
          };
        } });
    }

    /* ---------- 2. Elle kayıt ---------- */
    let picker = null;
    const formAge = () => ageFromDob(A.form.dob);
    function tabElle(body) {
      const f = A.form, a = formAge(), rels = [["esi", "Eşi"], ["anne", "Annesi"], ["baba", "Babası"], ["cocugu", "Çocuğu"], ["kardesi", "Kardeşi"], ["diger", "Diğer"]];
      body.innerHTML = `
        <div class="card adm-row" style="margin-bottom:12px"><div style="flex:1;min-width:200px"><b>Kimliği bilinmeyen hasta mı?</b><div class="adm-sub">Acil durumda ad beklemeden kayıt açın; kimlik sonra hastane kaydıyla eşleştirilir.</div></div>
          <button class="btn" data-act="unknown"${can ? "" : " disabled"}>${I("zap")}Bilinmeyen hasta kaydı</button></div>
        <div class="note i" style="margin-bottom:12px">Bu form hastane kaydına ulaşılamadığında kullanılır. Kayıt <b>GEÇİCİ</b> rozetiyle ve ${peekG()} protokolüyle açılır; bağlantı dönünce eşleştirilir.</div>
        <div data-form><fieldset style="border:0;padding:0;margin:0;min-width:0"${can ? "" : " disabled"}>
        <div class="g2">
          <div class="box"><h5>${I("user")} Kimlik</h5>
            ${fld("name", "Ad", inp("name", f.name, 'autocomplete="off"'), 1)}
            ${fld("surname", "Soyad", inp("surname", f.surname, 'autocomplete="off"'), 1)}
            ${fld("father", "Ata adı", inp("father", f.father))}
            ${fld("sex", "Cinsiyet", opts("sex", [["E", "Erkek"], ["K", "Kadın"]], f.sex), 1)}
            ${fld("dob", "Doğum tarihi", `<div class="adm-row"><input type="date" data-f="dob" value="${esc(f.dob)}" max="2026-09-23" style="flex:1;min-width:140px"><span class="pill" data-age>${ageStr(a)}</span></div>`, 1)}
            ${fld("nat", "Milliyet", sel("nat", NAT, f.nat))}
            ${fld("fin", "FİN kod", inp("fin", f.fin, 'maxlength="7" placeholder="7 karakter" style="text-transform:uppercase"'))}
            ${fld("idDoc", "Pasaport / kimlik no", inp("idDoc", f.idDoc))}
            ${fld("phone", "Telefon", `<div class="adm-row" style="flex-wrap:nowrap"><span class="tag mono">+994</span>${inp("phone", f.phone, 'inputmode="tel" placeholder="50 123 45 67"')}</div>`)}
          </div>
          <div class="box"><h5>${I("clip")} Yatış</h5>
            ${fld("type", "Yatış tipi", opts("type", Object.entries(ADM_T), f.type), 1)}
            ${fld("attending", "Sorumlu hekim", sel("attending", docOpts(), f.attending), 1)}
            ${fld("reason", "Yatış nedeni", `<textarea data-f="reason" rows="2" style="min-height:60px">${esc(f.reason)}</textarea>`, 1)}
            ${fld("allergy", "Bilinen alerji", `${inp("allergy", f.allergy, 'placeholder="Virgülle ayırın"' + (f.noAllergy ? " disabled" : ""))}${chk("noAllergy", f.noAllergy, "Bilinen alerjisi yok")}`)}
            ${fld("blood", "Kan grubu", sel("blood", BLOOD, f.blood))}
            ${fld("wh", "Kilo / boy", `<div class="adm-row" style="flex-wrap:nowrap"><input data-f="weight" class="adm-num" inputmode="decimal" value="${esc(f.weight)}" placeholder="kg"><input data-f="height" class="adm-num" inputmode="numeric" value="${esc(f.height)}" placeholder="cm"></div>`)}
          </div>
        </div>
        <div class="g2" style="margin-top:12px">
          <div class="box"><h5>${I("users")} Yakını / refakatçi</h5>
            ${fld("kin", "Yakınının adı", inp("kin", f.kin))}
            ${fld("kinRel", "Yakınlığı", opts("kinRel", rels, f.kinRel))}
            ${fld("kinPhone", "Telefonu", `<div class="adm-row" style="flex-wrap:nowrap"><span class="tag mono">+994</span>${inp("kinPhone", f.kinPhone, 'inputmode="tel"')}</div>`)}
            ${fld("comp", "Refakatçi", opts("comp", [["yok", "Kalmayacak"], ["var", "Kalacak"]], f.comp))}
          </div>
          <div class="box" data-w="consent"><h5>${I("shield")} Onaylar</h5>
            ${chk("kvkk", f.kvkk, "Kişisel verilerin işlenmesine onay alındı")}
            ${chk("sms", f.sms, "SMS ile bilgilendirme izni")}
            ${chk("unconscious", f.unconscious, "Hasta bilinçsiz / onay veremiyor — onay sonra alınacak")}
            <p class="adm-sub" style="margin:8px 0 0">Onaylardan biri ya da "sonra alınacak" işareti zorunludur. Sonra alınacak onaylar hasta kartında hatırlatılır.</p>
          </div>
        </div>
        <div class="box" style="margin-top:12px" data-w="bed"><h5>${I("bed")} Bölüm / birim ve yatak <span class="r"><span class="req" style="color:var(--crit)">*</span></span></h5><div data-pk></div></div>
        </fieldset></div>
        <div class="formbar"><span class="adm-sub">GEÇİCİ kayıt · hasta no <span class="mono">${peekHN()}</span> · protokol <span class="mono">${peekG()}</span></span><span class="spacer"></span>
          <button class="btn g" data-act="formReset"${can ? "" : " disabled"}>Temizle</button><button class="btn p" data-act="formSave"${can ? "" : " disabled"}>${I("ok")}Geçici kaydı aç</button></div>`;
      const box = body.querySelector("[data-form]");
      picker = bedPicker(box.querySelector("[data-pk]"), { ageGroup:() => ageGroupOf(formAge()) || "adult", selected:f.bed, unitId:f.bed ? H.bed(f.bed).unitId : null,
        onPick(id) { f.bed = id; if (id) box.querySelector('[data-w="bed"]').classList.remove("adm-err"); } });
      bindForm(box, f, k => {
        if (k === "dob") { box.querySelector("[data-age]").textContent = ageStr(formAge()); picker.redraw(); }
        if (k === "noAllergy") { const i = box.querySelector('[data-f="allergy"]'); i.disabled = f.noAllergy; if (f.noAllergy) { i.value = ""; f.allergy = ""; } }
        if (k === "kvkk" || k === "unconscious") box.querySelector('[data-w="consent"]').classList.remove("adm-err");
      });
    }

    function saveForm() {
      const f = A.form, box = el.querySelector("[data-form]"), a = formAge(), miss = [];
      [["name", "Ad"], ["surname", "Soyad"], ["sex", "Cinsiyet"], ["type", "Yatış tipi"], ["attending", "Sorumlu hekim"], ["reason", "Yatış nedeni"]].forEach(([k, l]) => { if (!String(f[k] || "").trim()) miss.push([k, l]); });
      if (!a) miss.push(["dob", "Doğum tarihi"]);
      if (!f.kvkk && !f.unconscious) miss.push(["consent", "Onay"]);
      if (!f.bed) miss.push(["bed", "Yatak"]);
      if (f.fin && !/^[A-Za-z0-9]{7}$/.test(f.fin.trim())) miss.push(["fin", "FİN kod (7 karakter)"]);
      markErr(box, miss.map(m => m[0]));
      if (miss.length) { H.toast("Eksik ya da hatalı: " + miss.map(m => m[1]).join(", "), "e"); return; }
      const b = H.bed(f.bed); if (!b || b.status !== "bos") { H.toast("Seçilen yatak artık boş değil; başka yatak seçin", "e"); f.bed = null; picker.redraw(); return; }
      const proto = nextG(), ag = ageGroupOf(a);
      const p = admit({ name:`${f.name.trim()} ${f.surname.trim()}`, sex:f.sex, age:a.years, ageDays:a.days, ageGroup:ag, dx:f.reason.trim(), attending:f.attending, blood:f.blood,
        weight:+String(f.weight).replace(",", ".") || null, height:+f.height || null, allergies:f.noAllergy ? [] : f.allergy.split(",").map(s => s.trim()).filter(Boolean),
        meta:{ temp:true, proto, source:"elle", fin:f.fin.trim().toUpperCase(), dob:f.dob, father:f.father.trim(), nationality:f.nat, idDoc:f.idDoc.trim(), phone:f.phone ? "+994 " + f.phone.trim() : "",
          kin:f.kin ? { name:f.kin.trim(), rel:f.kinRel, phone:f.kinPhone ? "+994 " + f.kinPhone.trim() : "" } : null, companion:f.comp === "var" ? "Kalacak" : "Yok", admitType:f.type,
          consent:f.kvkk ? "alındı" : "sonra alınacak", sms:!!f.sms } }, f.bed);
      H.log("Geçici kayıt açıldı", `${proto} · ${p.name} → ${bedLabel(p.bed)}`);
      A.form = newForm(); A.tab = "eslesme"; draw(); numbersModal(p);
    }

    function unknownModal() {
      const o = { sex:"", est:"40", type:"medikal", attending:"", reason:"" }; let chosen = null;
      const agOf = () => (+o.est || 0) < 18 ? "child" : "adult";
      H.modal({ title:"Bilinmeyen hasta · hızlı kayıt", wide:true,
        body:`<div class="note" style="margin-bottom:12px">${I("alert")} Kimlik belgesi olmadan açılır. Kol bandında geçici protokol no kullanılır; kimlik öğrenilince "Eşleşme bekleyenler"den hastane kaydına bağlanır.</div>
          <div class="g2"><div>
            ${fld("sex", "Cinsiyet", opts("sex", [["E", "Erkek"], ["K", "Kadın"]], ""), 1)}
            ${fld("est", "Tahmini yaş", `<div class="step"><button type="button" data-st="-5">−</button><input data-f="est" value="40" inputmode="numeric"><button type="button" data-st="5">+</button><span class="u">yaş</span></div>`, 1)}
            ${fld("type", "Yatış tipi", opts("type", Object.entries(ADM_T), "medikal"), 1)}
          </div><div>
            ${fld("attending", "Sorumlu hekim", sel("attending", docOpts(), ""), 1)}
            ${fld("reason", "Geliş notu", inp("reason", "", 'placeholder="ör. acil başvuru, bilinç bulanık"'))}
          </div></div>
          <div class="box" data-w="bed" style="margin-top:6px"><h5>${I("bed")} Yatak</h5><div data-pk></div></div>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>${I("ok")}Kaydı aç</button>`,
        onMount(m) {
          const pk = bedPicker(m.querySelector("[data-pk]"), { ageGroup:agOf, onPick(id) { chosen = id; } });
          bindForm(m, o, k => { if (k === "est") pk.redraw(); });
          m.addEventListener("click", e => { const b = e.target.closest("[data-st]"); if (!b) return; const i = m.querySelector('[data-f="est"]'); o.est = String(Math.min(110, Math.max(1, (+i.value || 0) + +b.dataset.st))); i.value = o.est; pk.redraw(); });
          m.querySelector("[data-ok]").onclick = () => {
            const miss = []; if (!o.sex) miss.push("sex"); if (!o.attending) miss.push("attending"); if (!chosen) miss.push("bed"); if (!(+o.est > 0)) miss.push("est");
            markErr(m, miss); if (miss.length) { H.toast("Cinsiyet, tahmini yaş, hekim ve yatak gerekli", "e"); return; }
            const proto = nextG(), age = Math.round(+o.est);
            const p = admit({ name:`Bilinmeyen hasta (${o.sex}) · ${proto}`, sex:o.sex, age, ageGroup:agOf(), dx:o.reason.trim() || "Acil başvuru · kimlik bilinmiyor", attending:o.attending,
              meta:{ temp:true, proto, source:"elle", unknown:true, estAge:age, consent:"sonra alınacak", admitType:o.type } }, chosen);
            H.log("Bilinmeyen hasta kaydı", `${proto} · ${o.sex === "E" ? "Erkek" : "Kadın"}, ~${age} yaş → ${bedLabel(p.bed)}`);
            H.closeModal(); A.tab = "eslesme"; draw(); setTimeout(() => numbersModal(p), 0);
          };
        } });
    }

    /* ---------- 3. Eşleşme bekleyenler ---------- */
    function candidates(p) {
      return HBYS_DIR.map(c => {
        const ca = ageFromDob(c.dob).years; let s = 0; const why = [];
        if (p.unknown) {
          const dy = Math.abs(ca - (p.estAge || p.age)); s = (p.sex === c.sex ? 25 : 0) + Math.max(0, 35 - dy * 5);
          why.push(p.sex === c.sex ? "cinsiyet aynı" : "cinsiyet farklı", `yaş farkı ~${dy}`);
        } else {
          const ns = sim(p.name, c.name + " " + c.surname); s = ns * 50; why.push(`ad benzerliği %${Math.round(ns * 100)}`);
          if (p.dob) { if (p.dob === c.dob) { s += 30; why.push("doğum tarihi aynı"); } else if (p.dob.slice(0, 4) === c.dob.slice(0, 4)) { s += 12; why.push("doğum yılı aynı"); } }
          if (p.fin) { if (p.fin.toUpperCase() === c.fin) { s += 20; why.push("FİN aynı"); } else if (sim(p.fin, c.fin) >= .7) { s += 10; why.push("FİN benzer"); } }
          if (p.sex !== c.sex) { s *= .6; why.push("cinsiyet farklı"); }
        }
        return { c, pct:Math.min(99, Math.round(s)), why };
      }).filter(x => x.pct >= 15).sort((a, b) => b.pct - a.pct).slice(0, 3);
    }
    const pctColor = (n) => n >= 75 ? "var(--ok)" : n >= 45 ? "var(--mid)" : "var(--mute)";

    function tabMatch(body) {
      const temps = H.data.patients.filter(p => p.temp);
      if (!temps.length) { body.innerHTML = `<div class="empty">Eşleşme bekleyen geçici kayıt yok.</div>`; return; }
      body.innerHTML = `<div class="adm-stack">${temps.map(p => { const b = H.bed(p.bed), u = b && H.unit(b.unitId), cs = candidates(p);
        return `<div class="box"><div class="adm-row" style="margin-bottom:6px"><b style="font:700 15px 'Space Grotesk'">${esc(p.name)}</b><span class="tag w">GEÇİCİ · ${esc(p.proto)}</span>
            <span class="adm-sub">${b ? esc(b.no) + " · " + esc(u.tr) : ""} · açılış ${esc(p.admittedAt || "—")} · ${esc(uname(p.admittedBy))}</span>
            <span class="spacer" style="flex:1"></span><button class="btn sm g" data-act="requery" data-id="${p.id}"${can ? "" : " disabled"}>${I("search")}Kayıtta yeniden sorgula</button></div>
          <div class="adm-sub">${p.sex === "E" ? "Erkek" : "Kadın"} · ${p.unknown ? `tahmini ${p.estAge} yaş` : `${ageStr(ageFromDob(p.dob))} · ${dmy(p.dob)}`}${p.fin ? ` · FİN <span class="mono">${esc(p.fin)}</span>` : ""} · onay: ${esc(p.consent || "—")}</div>
          ${p.unknown ? `<div class="note" style="margin-top:8px">Adaylar yalnız cinsiyet ve tahmini yaşa göre sıralandı. Kimlik belgesi ya da yakın beyanıyla doğrulanmadan birleştirmeyin.</div>` : ""}
          <div style="margin-top:6px">${cs.length ? cs.map(x => `<div class="adm-cand">
              <div><div class="adm-pct" style="color:${pctColor(x.pct)}">%${x.pct}</div><div class="adm-meter"><i style="width:${x.pct}%;--c:${pctColor(x.pct)}"></i></div></div>
              <div style="flex:1;min-width:180px"><b>${esc(x.c.name + " " + x.c.surname)}</b> <span class="adm-sub">ata adı ${esc(x.c.father)}</span>
                <div class="adm-sub">${dmy(x.c.dob)} · FİN <span class="mono">${esc(x.c.fin)}</span> · Protokol ${esc(x.c.proto)}</div><div class="adm-sub">${x.why.join(" · ")}</div></div>
              <button class="btn sm${x.pct >= 75 ? " p" : ""}" data-act="merge" data-id="${p.id}|${x.c.proto}"${can ? "" : " disabled"}>${I("link")}Eşleştir ve birleştir</button></div>`).join("")
            : `<div class="adm-sub" style="padding:10px 0">Hastane kaydında uygun aday bulunamadı.</div>`}</div></div>`; }).join("")}</div>`;
    }

    function mergeModal(p, c) {
      if (!p || !c) return;
      const ca = ageFromDob(c.dob);
      const rows = [
        ["name", "Ad soyad", p.name, c.name + " " + c.surname],
        ["father", "Ata adı", p.father || "—", c.father],
        ["dob", "Doğum tarihi", p.unknown ? `~${p.estAge} yaş (tahmini)` : dmy(p.dob), `${dmy(c.dob)} (${ageStr(ca)})`],
        ["sex", "Cinsiyet", p.sex === "E" ? "Erkek" : "Kadın", c.sex === "E" ? "Erkek" : "Kadın"],
        ["fin", "FİN", p.fin || "—", c.fin],
        ["blood", "Kan grubu", p.blood || "Bilinmiyor", c.blood],
      ];
      const take = {}; rows.forEach(([k, , a, b]) => { take[k] = a !== b && (k !== "blood" || !p.blood || p.blood === "Bilinmiyor"); });
      const bloodClash = p.blood && p.blood !== "Bilinmiyor" && p.blood !== c.blood;
      const allergies = [...new Set([...(p.allergies || []), ...(c.allergies || [])])];
      H.modal({ title:"Eşleştir ve birleştir", wide:true,
        body:`<div class="adm-row" style="margin-bottom:10px"><span class="tag w">GEÇİCİ · ${esc(p.proto)}</span>${I("swap")}<span class="tag">Kayıt · ${esc(c.proto)}</span></div>
          <div class="tw"><table class="t"><thead><tr><th>Alan</th><th>Bizdeki (geçici)</th><th>Hastane kaydı</th><th>Kayıttan al</th></tr></thead><tbody>
          ${rows.map(([k, l, a, b]) => `<tr><td>${l}</td><td>${esc(a)}</td><td><b>${esc(b)}</b>${k === "blood" && bloodClash ? ` <span class="tag c">uyuşmuyor</span>` : ""}</td>
            <td>${a === b ? '<span class="adm-sub">aynı</span>' : `<input type="checkbox" class="ck" data-take="${k}"${take[k] ? " checked" : ""}>`}</td></tr>`).join("")}
          <tr><td>Alerjiler</td><td>${esc((p.allergies || []).join(", ") || "—")}</td><td>${esc((c.allergies || []).join(", ") || "—")}</td><td><span class="adm-sub">birleştirilir: ${esc(allergies.join(", ") || "—")}</span></td></tr>
          <tr><td>Protokol no</td><td class="mono">${esc(p.proto)}</td><td class="mono"><b>${esc(c.proto)}</b></td><td><span class="adm-sub">Kayıttan (zorunlu)</span></td></tr>
          </tbody></table></div>
          ${bloodClash ? `<div class="note" style="margin-top:10px">${I("alert")} Kan grubu iki kayıtta farklı. Laboratuvarla doğrulanmadan kayıttaki değer alınmaz.</div>` : ""}
          <div class="note i" style="margin-top:10px">Klinik kayıtlar (vital bulgular, formlar, skorlar, notlar) bu hastada kalır ve hastane protokolüne bağlanır. Geçici protokol no denetim kaydında saklanır.</div>
          <div style="margin-top:10px">${chk("verified", false, "Kimliği belge, kol bandı ya da yakın beyanıyla doğruladım")}</div>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok disabled>${I("link")}Birleştir</button>`,
        onMount(m) {
          const ok = m.querySelector("[data-ok]");
          m.querySelector('[data-f="verified"]').onchange = e => { ok.disabled = !e.target.checked; };
          m.querySelectorAll("[data-take]").forEach(i => i.onchange = () => { take[i.dataset.take] = i.checked; });
          ok.onclick = () => {
            const taken = rows.filter(r => r[2] !== r[3] && take[r[0]]).map(r => r[1]);
            if (take.name) p.name = c.name + " " + c.surname;
            if (take.father) p.father = c.father;
            if (take.dob) { p.dob = c.dob; p.age = ca.years; if (p.ageGroup === "neonate") p.ageDays = ca.days; }
            if (take.sex) p.sex = c.sex;
            if (take.fin) p.fin = c.fin;
            if (take.blood) p.blood = c.blood;
            p.allergies = allergies; p.tempProto = p.proto; p.proto = c.proto; p.hbysProto = c.proto; p.temp = false; p.unknown = false; p.source = "elle → kayıt";
            HBYS_DIR.splice(HBYS_DIR.indexOf(c), 1);
            H.log("Kayıt eşleştirildi", `${p.tempProto} ↔ Protokol ${c.proto} · ${p.name} · alınan: ${taken.join(", ") || "yalnız protokol"}`);
            H.closeModal(); H.toast(`${p.name} hastane kaydıyla birleştirildi`); draw();
          };
        } });
    }

    /* ---------- 4. Transfer / taburcu ---------- */
    function tabTransfer(body) {
      const p = A.tSel && H.pt(A.tSel);
      body.innerHTML = `${p ? selCard(p) : `<div class="note i" style="margin-bottom:12px">Listeden hasta seçin. Normalde transfer ve taburcu hastane kaydından gelir; bu ekran hastane kaydına ulaşılamadığında kullanılır ve işlem hastane kaydına sonradan bildirilir.</div>`}
        <div class="adm-bar"><input data-q placeholder="Hasta adı, yatak ya da protokol ara" value="${esc(A.q)}"></div><div data-list></div>`;
      const list = body.querySelector("[data-list]");
      const drawList = () => {
        const q = norm(A.q);
        const ps = H.data.patients.filter(x => !q || norm(`${x.name} ${(H.bed(x.bed) || {}).no} ${x.proto || ""}`).includes(q))
          .sort((a, b) => (H.bed(a.bed).unitId + a.bed).localeCompare(H.bed(b.bed).unitId + b.bed, "tr", { numeric:true }));
        list.innerHTML = ps.length ? `<div class="tw"><table class="t"><thead><tr><th>Yatak</th><th>Hasta</th><th>Birim</th><th>Yaş</th><th>Kayıt</th></tr></thead><tbody>
          ${ps.map(x => { const b = H.bed(x.bed), u = H.unit(b.unitId); return `<tr class="row" data-act="tsel" data-id="${x.id}"${x.id === A.tSel ? ' style="outline:2px solid var(--pri);outline-offset:-2px"' : ""}>
            <td class="n">${esc(b.no)}</td><td><b>${esc(x.name)}</b></td><td>${esc(u.tr)}</td><td>${H.ageText(x)}</td>
            <td>${x.temp ? `<span class="tag w">GEÇİCİ</span>` : `<span class="adm-sub mono">${esc(x.proto || "Kayıt")}</span>`}</td></tr>`; }).join("")}</tbody></table></div>`
          : `<div class="empty">Eşleşen hasta yok.</div>`;
      };
      drawList();
      body.querySelector("[data-q]").oninput = e => { A.q = e.target.value; drawList(); };
    }
    function selCard(p) {
      const b = H.bed(p.bed), u = H.unit(b.unitId);
      return `<div class="box" style="margin-bottom:12px"><div class="adm-row"><div style="flex:1;min-width:200px"><b style="font:700 16px 'Space Grotesk'">${esc(p.name)}</b> ${p.temp ? `<span class="tag w">GEÇİCİ</span>` : ""}
          <div class="adm-sub">${esc(b.no)} · ${esc(u.tr)} · Oda ${esc(b.room)} · ${H.ageText(p)} · hekim ${esc(uname(p.attending))}</div></div>
        ${H.can("patient") ? `<button class="btn g sm" data-act="openpt" data-id="${p.id}">${I("eye")}Hasta ekranı</button>` : ""}
        <button class="btn" data-act="transfer" data-id="${p.id}"${can ? "" : " disabled"}>${I("swap")}Transfer</button>
        <button class="btn" data-act="discharge" data-id="${p.id}"${can ? "" : " disabled"}>${I("out")}Taburcu</button></div></div>`;
    }

    function transferModal(p) {
      if (!p) return; const cur = H.bed(p.bed); let chosen = null; const o = { why:"Klinik ihtiyaç" };
      const whys = ["Klinik ihtiyaç", "Yoğun bakıma", "Yoğun bakımdan servise", "İzolasyon", "Hasta / yakın isteği", "Diğer"].map(x => [x, x]);
      H.modal({ title:"Transfer · " + esc(p.name), wide:true,
        body:`<div class="note i" style="margin-bottom:12px">Şu an: <b>${esc(bedLabel(p.bed))}</b>. Eski yatak "temizlik" durumuna geçer.</div>
          ${fld("why", "Neden", opts("why", whys, o.why))}<div class="box"><h5>${I("bed")} Yeni yatak</h5><div data-pk></div></div>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok disabled>${I("swap")}Transfer et</button>`,
        onMount(m) {
          const ok = m.querySelector("[data-ok]"); bindForm(m, o);
          bedPicker(m.querySelector("[data-pk]"), { unitId:cur.unitId, ageGroup:p.ageGroup, onPick(id) { chosen = id; ok.disabled = !id; } });
          ok.onclick = () => {
            const nb = H.bed(chosen); if (!nb || nb.status !== "bos") return;
            cur.status = "temizlik"; delete cur.pid; nb.status = "dolu"; nb.pid = p.id;
            if (nb.unitId !== cur.unitId) { p.nurse = nurseFor(nb.unitId) || p.nurse; p.monitored = ["icu", "nicu"].includes(H.unit(nb.unitId).type) || p.monitored; }
            p.bed = chosen;
            H.log("Transfer", `${p.name} · ${cur.no} → ${nb.no} (${H.unit(nb.unitId).tr}) · ${o.why}`);
            H.closeModal(); H.toast(`${p.name} → ${nb.no} · ${cur.no} temizliğe alındı`); draw();
          };
        } });
    }

    function dischargeModal(p) {
      if (!p) return; const b = H.bed(p.bed); const o = { reason:"ev", inst:"", doc:p.attending || "", time:H.now(), note:"" };
      const extra = () => o.reason === "kurum" ? fld("inst", "Sevk edilen kurum", inp("inst", o.inst, 'placeholder="Kurum adı"'), 1)
        : o.reason === "exitus" ? `<div class="note" style="margin-bottom:10px">Kayıt "vefat" olarak kapanır. Yakınlara bildirim ve ölüm belgesi hekimin sürecidir; bu ekran yalnız kaydı ve yatağı kapatır.</div>${fld("doc", "Bildiren hekim", sel("doc", docOpts(), o.doc), 1)}` : "";
      H.modal({ title:"Taburcu · " + esc(p.name),
        body:`<div class="adm-sub" style="margin-bottom:12px">${esc(bedLabel(p.bed))}${p.temp ? ` · <span class="tag w">GEÇİCİ · ${esc(p.proto)}</span>` : ""}</div>
          ${fld("reason", "Çıkış şekli", opts("reason", [["ev", "Eve taburcu"], ["kurum", "Başka kuruma sevk"], ["exitus", "Vefat (exitus)"]], o.reason), 1)}
          <div data-extra>${extra()}</div>
          ${fld("time", "Saat", inp("time", o.time, 'type="time"'), 1)}
          ${fld("note", "Not", inp("note", "", 'placeholder="İsteğe bağlı"'))}
          <p class="adm-sub" style="margin:4px 0 0">Bağlantı gelince kuyruktan bildirilir. Yatak "temizlik" durumuna geçer.</p>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>${I("ok")}Kaydı kapat</button>`,
        onMount(m) {
          bindForm(m, o, k => { if (k === "reason") { m.querySelector("[data-extra]").innerHTML = extra(); } });
          m.querySelector("[data-ok]").onclick = () => {
            const miss = []; if (o.reason === "kurum" && !o.inst.trim()) miss.push("inst"); if (o.reason === "exitus" && !o.doc) miss.push("doc"); if (!o.time) miss.push("time");
            markErr(m, miss); if (miss.length) { H.toast("Zorunlu alanları doldurun", "e"); return; }
            const lbl = { ev:"Eve taburcu", kurum:"Başka kuruma sevk · " + o.inst.trim(), exitus:"Vefat" }[o.reason];
            b.status = "temizlik"; delete b.pid;
            const i = H.data.patients.indexOf(p); if (i >= 0) H.data.patients.splice(i, 1);
            prune(H.data.tasks, p.id); prune(H.data.alarms, p.id); prune(H.data.handovers, p.id);
            H.data.discharged.push({ pid:p.id, name:p.name, bed:b.no, reason:o.reason, detail:lbl, time:o.time, by:me().u, doc:o.doc });
            H.log(o.reason === "exitus" ? "Taburcu (vefat)" : "Taburcu", `${p.name} · ${b.no} · ${lbl} · ${o.time}`);
            A.tSel = null; H.closeModal();
            H.toast(o.reason === "exitus" ? `Kayıt kapatıldı · ${b.no} temizliğe alındı` : `${p.name} taburcu edildi · ${b.no} temizliğe alındı`); draw();
          };
        } });
    }

    draw();
  }

  /* ================================================================
   *                            YÖNETİM
   * ================================================================ */
  const AD = { tab:null, q:"", role:"", sel:"hosp", af:{ user:"", type:"", date:"" }, sys:null };
  const ATABS = [["users", "Kullanıcılar", "admin_users", "users"], ["roles", "Roller ve yetkiler", "admin_roles", "shield"], ["structure", "Hastane yapısı", "admin_structure", "building"],
    ["integrations", "Entegrasyonlar", "admin_integrations", "plug"], ["camera", "Kamera bağlantısı", "admin_camera", "tv"], ["notify", "Bildirim kuralları", "admin_system", "bell"],
    ["careCat", { toString:() => H.t("adm_cc_tab") }, "admin_system", "list"],   // 24.09 · bakım kataloğu (etiket dile göre)
    ["mobile", "Telefon modülleri", "admin_system", "tablet"],   // 27.09 · #193
    ["system", "Sistem ayarları", "admin_system", "gear"], ["audit", "Denetim kaydı", "audit", "file"],
    // 30.09 · İzleme ve işletim (Y1–Y7) · kod: dosyanın sonundaki "İZLEME VE İŞLETİM" bölümü
    ["health", "Sistem durumu", "admin_system", "activity"], ["events", "Olay günlüğü", "admin_system", "list"], ["integrity", "Veri bütünlüğü", "admin_system", "chart"],
    ["sessions", "Açık oturumlar", "admin_users", "key"], ["announce", "Duyuru", "admin_system", "zap"], ["backup", "Yedek ve geri yükleme", "admin_system", "swap"],
    ["viewas", "Rol gözüyle bak", "admin_roles", "eye"]];
  /* 30.09 · 17 sekme tek şeritte sığmıyor (1440 px'te bile) → iki kat: üstte grup çipleri, altta seçili grubun sekmeleri.
   * Bir gruba konmamış yeni sekme "Sistem" grubuna düşer (kaybolmaz). */
  const AGRP = [["access", "Kullanıcılar ve erişim", "users", ["users", "roles", "viewas"]], ["hospital", "Hastane", "building", ["structure", "careCat", "mobile"]],
    ["links", "Bağlantılar ve bildirim", "plug", ["integrations", "camera", "notify", "announce"]], ["watch", "İzleme", "activity", ["health", "events", "integrity", "sessions"]],
    ["sys", "Sistem", "gear", ["system", "backup", "audit"]]];
  ATABS.forEach(t => { if (!AGRP.some(g => g[3].includes(t[0]))) AGRP[AGRP.length - 1][3].push(t[0]); });
  const grpOf = (k) => AGRP.find(g => g[3].includes(k)) || AGRP[0];

  H.register("admin", { title:() => "Yönetim", perm:["admin_users", "admin_roles", "admin_structure", "admin_integrations", "admin_system", "admin_camera", "audit"], render(root, params) {
    root.innerHTML = ""; const el = document.createElement("div"); el.className = "adm"; root.appendChild(el);
    if (params && params.tab) AD.tab = params.tab;
    adminPage(el);
  } });

  function adminPage(el) {
    const tabs = ATABS.filter(t => H.can(t[2]));
    if (!tabs.length) { el.innerHTML = `<div class="empty">Yönetim yetkiniz yok.</div>`; return; }
    if (!AD.tab || !tabs.some(t => t[0] === AD.tab)) AD.tab = tabs[0][0];
    AD.gLast = AD.gLast || {};
    function draw() {
      const grps = AGRP.map(g => [g, tabs.filter(t => g[3].includes(t[0]))]).filter(x => x[1].length), cur = grpOf(AD.tab), two = grps.length > 1;
      const inG = two ? (grps.find(x => x[0] === cur) || grps[0])[1] : tabs; AD.gLast[cur[0]] = AD.tab;
      const badge = (g) => g[0] === "watch" && H.healthWarn && H.healthWarn() ? `<em title="Uyarı">${H.healthWarn()}</em>` : "";
      el.innerHTML = `<div class="ph"><div><h2>${tabs.length === 1 && tabs[0][0] === "audit" ? "Denetim kaydı" : "Yönetim"}</h2><p>${esc(H.data.hospital.name)} · her değişiklik denetim kaydına yazılır</p></div></div>
        ${two ? `<div class="adm-grp" role="tablist">${grps.map(([g]) => `<button type="button" data-grp="${g[0]}" class="${g === cur ? "on" : ""}">${I(g[2])}<span>${g[1]}</span>${badge(g)}</button>`).join("")}</div>` : ""}
        ${tabs.length > 1 ? `<div class="tabs${two ? " adm-sub-tabs" : ""}">${inG.map(([k, l]) => `<span data-tab="${k}" class="${AD.tab === k ? "on" : ""}">${l}</span>`).join("")}</div>` : ""}<div data-body></div>`;
      const body = el.querySelector("[data-body]");
      ({ users:tabUsers, roles:tabRoles, structure:tabStructure, integrations:tabIntegrations, system:tabSystem, audit:tabAudit, notify:tabNotify, careCat:tabCareCat, mobile:tabMobile,
         health:tabHealth, events:tabEvents, integrity:tabIntegrity, sessions:tabSessions, announce:tabAnnounce, backup:tabBackup, viewas:tabViewAs,
         camera:(b) => H.cameraAdmin ? H.cameraAdmin(b) : (b.innerHTML = `<div class="empty">Kamera modülü yüklenmedi.</div>`) })[AD.tab](body, draw);
    }
    el.addEventListener("click", e => {
      const g = e.target.closest("[data-grp]");
      if (g && el.contains(g)) { const G = AGRP.find(x => x[0] === g.dataset.grp), mine = tabs.filter(t => G[3].includes(t[0])), last = AD.gLast[G[0]];
        AD.tab = mine.some(t => t[0] === last) ? last : mine[0][0]; H.state.params = Object.assign({}, H.state.params, { tab:AD.tab }); draw(); return; }
      const t = e.target.closest("[data-tab]"); if (t && el.contains(t)) { AD.tab = t.dataset.tab; H.state.params = Object.assign({}, H.state.params, { tab:AD.tab }); draw(); } });
    draw();
  }

  /* ---------- Kullanıcılar ---------- */
  const isLocked = (x) => x.lockedUntil && x.lockedUntil > Date.now();
  const unitNames = (ids) => { const all = H.units(); if (all.every(u => ids.includes(u.id))) return "Tüm birimler"; return ids.map(i => (H.unit(i) || { tr:i }).tr).join(", ") || "—"; };
  const USER_PFX = { hekim:"dr.", hemsire:"hs.", kabul:"kabul.", eczaci:"ecz.", biyomed:"bio.", yonetici:"mudur.", kalite:"kalite.", sistem:"it." };

  function tabUsers(body, draw) {
    const roles = Object.entries(H.data.roles);
    body.innerHTML = `<div class="adm-bar"><input data-q placeholder="Ad ya da kullanıcı adı ara" value="${esc(AD.q)}">
        <select data-rf>${[["", "Tüm roller"], ...roles.map(([k, r]) => [k, r.name])].map(([k, l]) => `<option value="${k}"${k === AD.role ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <span class="spacer"></span><button class="btn p" data-act="new">${I("userPlus")}Yeni kullanıcı</button></div>
      <div data-list></div>
      <p class="adm-sub" style="margin-top:10px">Şifreler hiçbir ekranda gösterilmez. Yalnız oluşturma ya da sıfırlama anında üretilen geçici şifre bir kez görünür.</p>`;
    const list = body.querySelector("[data-list]");
    const drawList = () => {
      const q = norm(AD.q), us = H.data.users.filter(x => (!AD.role || x.role === AD.role) && (!q || norm(x.name + " " + x.u).includes(q)));
      list.innerHTML = us.length ? `<div class="tw"><table class="t"><thead><tr><th>Ad</th><th>Kullanıcı adı</th><th>Rol</th><th>Birimler</th><th>Durum</th><th>2FA</th><th>Son giriş</th><th></th></tr></thead><tbody>
        ${us.map(x => { const lk = isLocked(x), req = H.settings.mfaRoles.includes(x.role);
          const stt = x.active === false ? `<span class="tag">Pasif</span>` : lk ? `<span class="tag c">${I("lock")}Kilitli · ${Math.ceil((x.lockedUntil - Date.now()) / 60000)} dk</span>` : `<span class="sv" style="--r:var(--ok)">AKTİF</span>`;
          return `<tr><td><b>${esc(x.name)}</b><div class="adm-sub">${esc(x.title || "")}</div></td><td class="mono">${esc(x.u)}</td><td>${esc(H.roleLabel(x))}</td>
            <td class="adm-sub" style="max-width:220px">${esc(unitNames(x.units || []))}</td>
            <td>${stt}${x.mustChange ? ` <span class="tag w">ilk girişte şifre</span>` : ""}</td>
            <td>${x.mfa ? `<span class="pill">${I("ok")}Açık</span>` : req ? `<span class="tag w">Zorunlu · kurulmadı</span>` : `<span class="adm-sub">Kapalı</span>`}</td>
            <td class="mono adm-sub">${esc(x.lastLogin || "—")}</td>
            <td><div class="adm-acts">
              <button class="btn g sm" data-act="edit" data-id="${esc(x.u)}" title="Düzenle">${I("edit")}</button>
              <button class="btn g sm" data-act="reset" data-id="${esc(x.u)}" title="Şifre sıfırla">${I("key")}</button>
              ${lk ? `<button class="btn g sm" data-act="unlock" data-id="${esc(x.u)}" title="Kilidi aç">${I("lock")}</button>` : ""}
              <button class="btn g sm" data-act="toggle" data-id="${esc(x.u)}" title="${x.active === false ? "Aktifleştir" : "Pasifleştir"}">${I(x.active === false ? "ok" : "x")}</button>
            </div></td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">Eşleşen kullanıcı yok.</div>`;
    };
    drawList();
    body.querySelector("[data-q]").oninput = e => { AD.q = e.target.value; drawList(); };
    body.querySelector("[data-rf]").onchange = e => { AD.role = e.target.value; drawList(); };
    body.addEventListener("click", e => {
      const a = e.target.closest("[data-act]"); if (!a || !body.contains(a)) return; const x = a.dataset.id ? H.userBy(a.dataset.id) : null;
      if (a.dataset.act === "new") userModal(null, drawList);
      else if (a.dataset.act === "edit") userModal(x, drawList);
      else if (a.dataset.act === "reset") resetPw(x, drawList);
      else if (a.dataset.act === "unlock") { x.fails = 0; x.lockedUntil = 0; H.log("Hesap kilidi açıldı", `${x.u} · ${x.name}`); H.toast(`${x.name} hesabının kilidi açıldı`); drawList(); }
      else if (a.dataset.act === "toggle") {
        if (x.u === me().u) { H.toast("Kendi hesabınızı pasifleştiremezsiniz", "e"); return; }
        x.active = x.active === false; H.log(x.active ? "Kullanıcı aktifleştirildi" : "Kullanıcı pasifleştirildi", `${x.u} · ${x.name}`);
        H.toast(`${x.name} ${x.active ? "aktifleştirildi" : "pasifleştirildi"}`, x.active ? "" : "w"); drawList();
      }
    });
  }

  function userModal(x, after) {
    const isNew = !x;
    const o = isNew ? { name:"", u:"", email:"", title:"", role:"hemsire", extras:[], units:[], mfa:false, mustChange:true, pw:H.genPassword() }
      : { name:x.name, u:x.u, email:x.email || "", title:x.title || "", role:x.role, extras:[...(x.extras || [])], units:[...(x.units || [])], mfa:!!x.mfa };
    let uTouched = !isNew;
    const roleOpts = Object.entries(H.data.roles).map(([k, r]) => [k, `${r.group} · ${r.name} · ${r.az}`]);
    const exOpts = () => Object.entries(H.EXTRA).filter(([, e]) => e.for.includes(o.role)).map(([k, e]) => [k, e.name + (e.duty ? " (nöbet görevi)" : "")]);
    const unitOpts = H.units().map(u => [u.id, esc(u.tr)]);
    const mfaNote = () => H.settings.mfaRoles.includes(o.role) ? "Bu rol için 2FA sistem ayarlarında zaten zorunlu." : "";
    const suggest = () => { const w = norm(o.name).split(" ").filter(s => s && s !== "dr"); return w.length ? (USER_PFX[o.role] || "") + w[0] : ""; };
    H.modal({ title:isNew ? "Yeni kullanıcı" : "Kullanıcıyı düzenle · " + esc(x.u),
      body:`${fld("name", "Ad soyad", inp("name", o.name), 1)}
        ${fld("u", "Kullanıcı adı", inp("u", o.u, isNew ? 'autocomplete="off" placeholder="ör. hs.aygun"' : "disabled") + (isNew ? `<div class="adm-sub" style="margin-top:4px">Küçük harf, rakam, nokta · değiştirilemez</div>` : ""), 1)}
        ${fld("email", "E-posta", inp("email", o.email, 'type="email" placeholder="kurumsal adres"'))}
        ${fld("title", "Unvan", inp("title", o.title, 'placeholder="ör. Tibb bacısı"'))}
        ${fld("role", "Rol", sel("role", roleOpts, o.role), 1)}
        <div data-exw>${exOpts().length ? fld("extras", "Ek işaret / görev", opts("extras", exOpts(), o.extras, true) + `<div class="adm-sub" style="margin-top:4px">Rol değildir; kişinin rolüne yetki ekler. Nöbet görevi nöbet bitince kaldırılabilir.</div>`) : ""}</div>
        ${fld("units", "Birimler", opts("units", unitOpts, o.units, true) + `<div style="margin-top:6px"><button type="button" class="btn g sm" data-all>Tümünü seç</button></div>`, 1)}
        ${fld("mfa", "2FA", chk("mfa", o.mfa, "Bu kullanıcı için 2FA zorunlu") + `<div class="adm-sub" data-mfanote>${mfaNote()}</div>`)}
        ${isNew ? `${fld("pw", "Geçici şifre", `<div class="adm-pw"><span data-pw>${esc(o.pw)}</span><button type="button" class="btn sm" data-regen>${I("swap")}Yeniden üret</button></div>
            <div class="adm-sub" style="margin-top:4px">Kullanıcıya yüz yüze ya da telefonla iletin; e-postayla göndermeyin.</div>`)}
          ${fld("mustChange", "", chk("mustChange", o.mustChange, "İlk girişte şifresini değiştirsin"))}` : ""}`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>${I("ok")}${isNew ? "Kullanıcıyı oluştur" : "Kaydet"}</button>`,
      onMount(m) {
        bindForm(m, o, k => {
          if (k === "u") uTouched = true;
          if ((k === "name" || k === "role") && !uTouched) { o.u = suggest(); m.querySelector('[data-f="u"]').value = o.u; }
          if (k === "role") { m.querySelector("[data-mfanote]").textContent = mfaNote(); o.extras = o.extras.filter(e => H.EXTRA[e].for.includes(o.role));
            m.querySelector("[data-exw]").innerHTML = exOpts().length ? fld("extras", "Ek işaret / görev", opts("extras", exOpts(), o.extras, true)) : ""; }
        });
        m.addEventListener("click", e => {
          if (e.target.closest("[data-regen]")) { o.pw = H.genPassword(); m.querySelector("[data-pw]").textContent = o.pw; }
          if (e.target.closest("[data-all]")) { o.units = H.units().map(u => u.id); m.querySelectorAll('.opts[data-f="units"] i').forEach(i => i.classList.add("on")); }
        });
        m.querySelector("[data-ok]").onclick = () => {
          const miss = [];
          if (!o.name.trim()) miss.push("name");
          if (isNew && (!/^[a-z0-9._]{3,32}$/.test(o.u) || H.userBy(o.u))) miss.push("u");
          if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) miss.push("email");
          if (!o.units.length) miss.push("units");
          markErr(m, miss);
          if (miss.length) { H.toast(miss.includes("u") && isNew && H.userBy(o.u) ? "Bu kullanıcı adı kullanılıyor" : "Zorunlu alanları kontrol edin", "e"); return; }
          if (!isNew && x.u === me().u && o.role !== x.role && !H.perms({ role:o.role, extras:o.extras }).includes("admin_users")) { H.toast("Kendi rolünüzü yönetim yetkisi olmayan bir role çeviremezsiniz", "e"); return; }
          if (isNew) {
            H.data.users.push({ u:o.u, pw:o.pw, name:o.name.trim(), role:o.role, extras:o.extras.slice(), units:o.units.slice(), mfa:!!o.mfa, title:o.title.trim() || H.data.roles[o.role].az,
              email:o.email.trim(), active:true, fails:0, lockedUntil:0, lastLogin:"—", mustChange:!!o.mustChange });
            H.log("Kullanıcı oluşturuldu", `${o.u} · ${H.data.roles[o.role].name} · ${unitNames(o.units)}`);
            H.toast(`${o.name.trim()} oluşturuldu · geçici şifreyi iletin`);
          } else {
            const ch = []; if (x.role !== o.role) ch.push(`rol ${H.data.roles[x.role].name} → ${H.data.roles[o.role].name}`);
            if (x.units.join() !== o.units.join()) ch.push("birimler"); if ((x.extras || []).join() !== o.extras.join()) ch.push("işaret/görev: " + (o.extras.map(e => H.EXTRA[e].name).join(", ") || "yok")); if (!!x.mfa !== !!o.mfa) ch.push("2FA " + (o.mfa ? "açık" : "kapalı"));
            Object.assign(x, { name:o.name.trim(), email:o.email.trim(), title:o.title.trim(), role:o.role, extras:o.extras.slice(), units:o.units.slice(), mfa:!!o.mfa });
            H.log("Kullanıcı düzenlendi", `${x.u}${ch.length ? " · " + ch.join(", ") : ""}`);
            H.toast("Kaydedildi");
          }
          H.closeModal(); after && after();
        };
      } });
  }

  function resetPw(x, after) {
    if (!x) return;
    H.modal({ title:"Şifre sıfırla · " + esc(x.u),
      body:`<p style="margin-top:0">${esc(x.name)} için geçici şifre üretilecek. Mevcut şifre geçersiz olur; kullanıcı ilk girişte yeni şifre belirlemek zorunda kalır.</p>${isLocked(x) ? `<div class="note i">Hesap kilitli; sıfırlama kilidi de açar.</div>` : ""}`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>${I("key")}Sıfırla</button>`,
      onMount(m) {
        m.querySelector("[data-ok]").onclick = () => {
          const pw = H.genPassword(); Object.assign(x, { pw, mustChange:true, fails:0, lockedUntil:0 });
          H.log("Şifre sıfırlandı", `${x.u} · geçici şifre, ilk girişte değiştirme zorunlu`);
          after && after();
          H.modal({ title:"Geçici şifre · " + esc(x.u),
            body:`<div class="adm-pw"><span>${esc(pw)}</span></div><p class="adm-sub">Bu şifre yalnız şimdi görünür. Kullanıcıya yüz yüze ya da telefonla iletin; e-postayla ya da mesajla göndermeyin.</p>`,
            actions:`<button class="btn p" data-x>Tamam</button>` });
        };
      } });
  }

  /* ---------- Roller ve yetkiler ---------- */
  const PERMS = [
    ["Klinik", [["beds", "Yatak paneli (vital, skor)"], ["patient", "Hasta ekranı"], ["tasks", "Görevlerim"], ["bedside", "Yatak başı ölçüm"], ["alarms", "Alarmlar"], ["hand", "Vardiya devri"],
      ["results", "Sonuçlar (lab, radyoloji)"], ["orders", "Order'lar"], ["scores_sign", "Skor onayı (imza)"], ["forms", "Hemşirelik formları"], ["camera", "Kamera izleme"]]],
    ["Kabul ve yatak", [["admission", "Hasta kabul (kayıt açar)"], ["admission_view", "Hasta kabul (görüntüler)"], ["occupancy", "Yatak doluluğu (klinik bilgi yok)"], ["staff_view", "Personel görünümü"]]],
    ["Ekipler", [["rrt", "Hızlı yanıt ekibi"], ["pharmacy", "Eczane"], ["devices", "Cihaz envanteri"], ["maintenance", "Bakım ve kalibrasyon takvimi"]]],
    ["Yönetim", [["summary", "Yönetici özeti"], ["quality", "Kalite göstergeleri"], ["audit", "Denetim kaydı"], ["admin_users", "Kullanıcı yönetimi"], ["admin_structure", "Hastane yapısı"], ["admin_roles", "Roller ve yetkiler"],
      ["admin_system", "Sistem ayarları"], ["admin_integrations", "Entegrasyonlar"], ["admin_camera", "Kamera bağlantısı"]]],
  ];
  /* 24.09 (3. oturum) · Ozan #67: "admin panelinde tüm yetkileri aktif getir; elle açıyorum sonra kayboluyor".
   * 1) Sistem yöneticisi prototipte BÜTÜN yetkilerle gelir (hasta ekranları dahil).
   * 2) Yetki tablosundaki değişiklikler bu tarayıcıda saklanır; sayfa yenilenince kaybolmaz. "Varsayılana dön" hepsini sıfırlar. */
  const ALLP = PERMS.flatMap(g => g[1].map(x => x[0])).concat((H.PT_TABS || []).map(t => "pt_" + t[0]));
  H.data.roles.sistem.perms = [...new Set([...H.data.roles.sistem.perms, ...ALLP])]; H.data.roles.sistem.names = true;
  H.data.users.filter(u => u.role === "sistem").forEach(u => { u.units = H.allUnits().map(x => x.id); });
  try { const sv = JSON.parse(localStorage.getItem("hmc.roles") || "null"); if (sv) Object.entries(sv).forEach(([k, v]) => { if (H.data.roles[k] && Array.isArray(v.perms)) H.data.roles[k].perms = v.perms; }); } catch {}
  H.saveRoles = () => { try { localStorage.setItem("hmc.roles", JSON.stringify(Object.fromEntries(Object.entries(H.data.roles).map(([k, r]) => [k, { perms:r.perms }])))); } catch {} };
  const protectedPerm = (r, p) => p.startsWith("admin_") && (r === me().role || (r === "sistem" && (p === "admin_roles" || p === "admin_users")));
  const permLabel = (p) => (PERMS.flatMap(g => g[1]).find(x => x[0] === p) || [p, p])[1];

  function tabRoles(body) {
    const roles = Object.entries(H.data.roles), ro = !H.can("admin_roles"), groups = [...new Set(roles.map(([, r]) => r.group))];
    const nUsers = (k) => H.data.users.filter(u => u.role === k && u.active !== false).length;
    body.innerHTML = `<div class="note i" style="margin-bottom:12px">${I("shield")} <b>Öneri (24.09):</b> rol kişinin işidir, 8 rol yeter. "Sorumlu hemşire" hemşireye eklenen bir işarettir, "Hızlı yanıt ekibi" hekim ya da hemşireye verilen nöbet görevidir. En az yetki: kimse işi olmayan ekranı görmez.</div>
      ${groups.map(g => `<div class="sec" style="margin-top:6px">${g}</div><div class="g3">${roles.filter(([, r]) => r.group === g).map(([k, r]) => `<div class="card">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><b style="font:700 15px 'Space Grotesk'">${esc(r.name)}</b><span class="adm-sub">${esc(r.az)}</span><span class="pill" style="margin-left:auto">${nUsers(k)} kişi</span></div>
        <div style="margin:8px 0;display:flex;flex-wrap:wrap;gap:4px">${r.perms.map(p => `<span class="tag">${esc(permLabel(p))}</span>`).join("")}</div>
        <div class="kv"><span>Hasta adını görür</span>${r.names ? `<b style="font-family:Figtree;color:var(--ok)">Evet</b>` : `<b style="font-family:Figtree">Hayır · yalnız yatak no</b>`}</div>
        <div class="kv"><span>Gerçek üründe</span><span class="adm-sub mono" style="text-align:right">${esc(r.engine)}</span></div></div>`).join("")}</div>`).join("")}
      <div class="sec">Rol olmayan ekler <small>kişinin rolüne yetki ekler</small></div>
      <div class="g2">${Object.entries(H.EXTRA).map(([k, e]) => `<div class="card"><b style="font:700 15px 'Space Grotesk'">${esc(e.name)}</b> <span class="pill">${e.duty ? "nöbet görevi" : "işaret"}</span>
        <div class="adm-sub" style="margin:6px 0">Kime verilir: ${e.for.map(r => esc(H.data.roles[r].name)).join(", ")} · şu an ${H.data.users.filter(u => (u.extras || []).includes(k)).length} kişide</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${e.perms.map(p => `<span class="tag">+ ${esc(permLabel(p))}</span>`).join("")}</div>
        <div class="kv" style="margin-top:6px"><span>Gerçek üründe</span><span class="adm-sub mono">${esc(e.engine)}</span></div></div>`).join("")}</div>
      <div class="sec">Ayrıntılı yetki tablosu <small>kutucuklar anında uygulanır ve denetim kaydına yazılır</small></div>
      <div class="tw"><table class="t adm-mx"><thead><tr><th>Yetki</th>${roles.map(([k, r]) => `<th>${esc(r.name)}<div class="adm-sub" style="text-transform:none;letter-spacing:0;font-weight:600">${esc(r.az)}</div></th>`).join("")}</tr></thead><tbody>
      ${PERMS.map(([g, ps]) => `<tr class="grp"><td colspan="${roles.length + 1}">${g}</td></tr>` + ps.map(([p, l]) => `<tr><td>${l}<small>${p}</small></td>${roles.map(([k, r]) => { const on = r.perms.includes(p), lock = on && protectedPerm(k, p);
        return `<td><input type="checkbox" class="ck" data-r="${k}" data-p="${p}"${on ? " checked" : ""}${lock || ro ? " disabled" : ""} title="${lock ? "Korunan yetki" : esc(r.name + " · " + l)}"></td>`; }).join("")}</tr>`).join("")).join("")}
      </tbody></table></div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap"><span class="adm-sub">Değişiklikler bu tarayıcıda saklanır; sayfayı yenileyince kaybolmaz.</span><button class="btn sm g" data-roles-reset>Varsayılana dön</button></div>
      <div class="note w" style="margin-top:10px">Sistem yöneticisi bütün ekranları görür. Bilgi işlem hesabının hasta verisini görüp görmeyeceği hastaneyle kararlaştırılır; önerimiz görmemesi.</div>
      <p class="adm-sub" style="margin-top:10px">Kendi rolünüzün yönetim yetkileri kaldırılamaz. Menüden gizlemek yetmez: gerçek üründe her yetki sunucuda da denetlenir.</p>`;
    body.onclick = e => { if (e.target.closest("[data-roles-reset]")) { try { localStorage.removeItem("hmc.roles"); } catch {} H.log("Yetki tablosu varsayılana döndü"); location.reload(); } };
    body.onchange = e => {
      const c = e.target.closest("input[data-r]"); if (!c) return; const r = c.dataset.r, p = c.dataset.p, role = H.data.roles[r];
      if (!c.checked && protectedPerm(r, p)) { c.checked = true; H.toast("Kendi yönetim yetkinizi kaldıramazsınız", "e"); return; }
      if (c.checked) { if (!role.perms.includes(p)) role.perms.push(p); } else role.perms = role.perms.filter(x => x !== p);
      H.saveRoles();
      H.log("Yetki değişikliği", `${role.name}: ${c.checked ? "+" : "−"} ${permLabel(p)}`);
      H.toast(`${role.name}: ${permLabel(p)} ${c.checked ? "verildi" : "kaldırıldı"}`, c.checked ? "" : "w");
      if (r === me().role && typeof H.renderApp === "function") H.renderApp(); else tabRoles(body);
    };
  }

  /* ---------- Bildirim kuralları ---------- */
  const NR = [
    ["Kritik alarm", "Hemşire", "3. dk sorumlu hemşire · 5. dk hekim · 10. dk hızlı yanıt · telefona bildirim", true],
    ["Yüksek alarm", "Hemşire", "3. dk sorumlu hemşire · 5. dk hekim · uygulama içi", true],
    ["Kritik laboratuvar sonucu", "Hemşire + hekim birlikte", "Basamak süresi: hastanenin laboratuvar protokolü girilince etkinleşir", false],
    ["Skor imza bekliyor", "Hekim", "Sorumlu hekim · hatırlatma 60 dk", true],
    ["Geciken hemşirelik işi", "Hemşire", "30 dk gecikince sorumlu hemşire", true],
    ["Devir karşı imzası", "Hemşire / hekim", "Nöbet değişiminde gelen ekip", true],
    ["Monitör sessiz", "Biyomedikal", "5 dk veri yoksa · birim sorumlu hemşiresine de", true],
    ["Bakım zamanı", "Biyomedikal", "Haftalık özet · pazartesi 09:00", true],
    ["Yeni yatış", "Hasta kabul · sorumlu hemşire", "Ön kabul kaydı gelince", true],
    ["Uzun yanıtsız alarm", "Kalite · başhekim", "10 dk'yı geçen her alarm · hasta adı olmadan", false],
  ];
  function tabNotify(body) {
    body.innerHTML = `<div class="g2" style="margin-bottom:12px"><div class="box"><h5>${I("bell")} Kanallar</h5>
        ${H.CHANNELS.map(([k, l, ok]) => `<div class="kv"><span>${l}</span>${ok ? `<span class="chan ok">✓ çalışıyor</span>` : `<span class="chan">yok · geliştirilecek</span>`}</div>`).join("")}
        <p class="adm-sub" style="margin:8px 0 0">Uygulama kapalıyken bildirim ulaşmaz. Telefona bildirim için karar gerekiyor: bildirim hastane dışındaki bir servisten geçer, bu yüzden içeriğinde hasta bilgisi olmamalı.</p></div>
      <div class="box"><h5>${I("shield")} İlkeler</h5><div class="kv"><span>Hasta bilgisi</span><span>Yalnız yatak no ve bulgu</span></div><div class="kv"><span>Hedef</span><span>Rol + birim; kişi değil</span></div>
        <div class="kv"><span>Tekrar</span><span>Aynı olay için bir kez; eskalasyonda yeniden</span></div><div class="kv"><span>Erteleme</span><span>Kritik ertelenemez · yüksek en çok 30 dk · orta en çok 120 dk</span></div>
        <div class="kv"><span>Telefon</span><span>Yalnız kritik · içerik: yatak no + "kritik"</span></div><div class="kv"><span>Gece</span><span>Sessiz saat yok</span></div>
        <div class="kv"><span>Vardiya değişimi</span><span>Açık bildirim gelen ekibe geçer; giden ekip devir imzasına kadar görür</span></div></div></div>
      <div class="tw"><table class="t"><thead><tr><th>Olay</th><th>İlk kime</th><th>Sonra</th><th>Açık</th></tr></thead><tbody>
        ${NR.map((r, i) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td class="adm-sub">${r[2]}</td><td><input type="checkbox" class="ck" data-nr="${i}"${r[3] ? " checked" : ""}></td></tr>`).join("")}</tbody></table></div>
      <p class="adm-sub" style="margin-top:10px">Dakikalar <b>örnek başlangıç değeridir</b>; geçerli olan hastanenin protokolüdür ve her değişiklik denetim kaydına yazılır.
        Gerçek üründe bugün: 3 / 5 / 10 zinciri motorun kodunda yazılı ama canlı hatta bağlı değil; canlıda tek basamak var (5. dk hekime). Telefona bildirim ve kritik laboratuvar akışı henüz yok.</p>`;
    body.onchange = e => { const c = e.target.closest("[data-nr]"); if (!c) return; const r = NR[+c.dataset.nr]; r[3] = c.checked; H.log("Bildirim kuralı", `${r[0]}: ${c.checked ? "açık" : "kapalı"}`); H.toast(`${r[0]}: ${c.checked ? "açık" : "kapalı"}`); };
  }

  /* ---------- Hastane yapısı ----------
   * 24.09 · yeniden kuruldu (Ozan'ın ekran görüntüsü + konsey kararı):
   *   · Ağaç yalnız Hastane → Bina → Kat → Birim. Oda ve yataklar sağda "kat planı" ızgarasında.
   *   · Sıra: bina kodu · kat numarası artan (zeminden yukarı) · birim HBYS kodu · oda/yatak doğal sayı sırası (2 < 10).
   *     Sıralama yalnız GÖRÜNTÜDE yapılır; veri dizilerinin sırası değişmez (başka ekranları etkilemesin).
   *   · Dolu olan hiçbir şey arşivlenemez / silinemez. Hasta geçmişi olan (en az bir kez dolu olmuş) öğe SİLİNEMEZ,
   *     yalnız "Arşivle (pasif)" — denetim zinciri kopmasın. "Sil" yalnız hiç kullanılmamış (yanlış girilmiş) öğede görünür.
   *     Prototipte geçmiş = yatağın hiç hastası olmuş olması (b.hist; her çizimde pid'den işaretlenir, taburcu listesine de bakılır).
   *   · Yeni hastane bu ekrandan eklenmez (kurum konsolu, Taslak 20). */
  const coll = new Intl.Collator("tr", { numeric:true, sensitivity:"base" });
  const natCmp = (a, b) => coll.compare(String(a ?? ""), String(b ?? ""));
  const allBeds = () => H.allUnits().flatMap(u => u.beds);
  const liveBeds = (beds) => beds.filter(b => !b.archived);
  const findB = (id) => H.data.hospital.buildings.find(b => b.id === id);
  const findF = (id) => { for (const b of H.data.hospital.buildings) { const f = b.floors.find(x => x.id === id); if (f) return { b, f }; } return {}; };
  const bCode = (b) => b.code || b.id;
  const sortB = () => H.data.hospital.buildings.slice().sort((x, y) => natCmp(bCode(x), bCode(y)));
  const sortF = (b) => b.floors.slice().sort((x, y) => x.no - y.no);
  const sortU = (f) => f.units.slice().sort((x, y) => (x.code ? 0 : 1) - (y.code ? 0 : 1) || natCmp(x.code, y.code) || natCmp(x.tr, y.tr));
  const roomsSorted = (u) => roomsOf(u).sort((x, y) => natCmp(x[0], y[0])).map(([r, bs]) => [r, bs.slice().sort((p, q) => natCmp(p.no, q.no))]);
  const bedsOfB = (b) => b.floors.flatMap(f => f.units.flatMap(u => u.beds));
  const bedsOfF = (f) => f.units.flatMap(u => u.beds);
  const cTxt = (beds) => { const c = counts(liveBeds(beds)); return `${c.t} yatak · ${c.d} dolu · ${c.b} boş`; };
  const markHist = () => allBeds().forEach(b => { if (b.pid) b.hist = true; });
  const bedHist = (b) => !!(b.hist || b.pid || (H.data.discharged || []).some(d => d.bed === b.no));
  const anyHist = (beds) => beds.some(bedHist);
  markHist();
  const nextBedN = (u) => Math.max(0, ...u.beds.map(b => +String(b.id).split("-").pop() || 0)) + 1;
  function addBeds(u, room, n) { for (let i = 0; i < n; i++) { const k = nextBedN(u); u.beds.push({ id:`${u.id}-${k}`, no:`${u.id.slice(0, 3).toUpperCase()}${String(k).padStart(2, "0")}`, room:String(room), status:"bos", type:(u.beds[0] && u.beds[0].type) || "Yatak", iso:false, oos:false, clean:"temiz" }); } }
  // seçimin ağaçtaki yolu: { b, f, u }
  const pathOf = (sel) => { const [k, a] = sel.split(":");
    if (k === "b") return { b:a };
    if (k === "f") { const r = findF(a); return r.f ? { b:r.b.id, f:a } : {}; }
    const uid = k === "u" || k === "r" ? a : k === "bed" ? (H.bed(a) || {}).unitId : null; if (!uid || !H.unit(uid)) return {};
    const l = locOf(uid); return { b:l.b, f:l.f, u:uid }; };
  const openPath = (sel) => { const p = pathOf(sel); AD.stOpen = AD.stOpen || new Set(); if (p.b) AD.stOpen.add("b:" + p.b); if (p.f) AD.stOpen.add("f:" + p.f); };

  function askModal(title, html, o, onOk) {
    H.modal({ title, body:html, actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>${I("ok")}Kaydet</button>`,
      onMount(m) { bindForm(m, o); m.querySelector("[data-ok]").onclick = () => { const err = onOk(m); if (err) { H.toast(err, "e"); return; } H.closeModal(); }; } });
  }

  /* arşivle / sil hedefi: key = b:<id> | f:<id> | u:<id> | r:<birim>:<oda> | bed:<id> */
  function lifeTarget(key) {
    const [k, a, ...rest] = key.split(":"), r = rest.join(":");
    if (k === "b") { const o = findB(a); return o && { k, obj:o, label:o.name, beds:bedsOfB(o), parent:H.data.hospital.buildings, up:"hosp", active:o.active !== false }; }
    if (k === "f") { const { b, f } = findF(a); return f && { k, obj:f, label:`${b.name} · ${H.floorText(f.no)}`, beds:bedsOfF(f), parent:b.floors, up:"b:" + b.id, active:f.active !== false }; }
    if (k === "u") { const u = H.unit(a); if (!u) return null; const l = locOf(a); return { k, obj:u, label:u.tr, beds:u.beds, parent:findF(l.f).f.units, up:"f:" + l.f, active:u.active !== false }; }
    if (k === "r") { const u = H.unit(a); if (!u) return null; const beds = u.beds.filter(b => b.room === r); return { k, obj:{ u, room:r }, label:`${u.tr} · Oda ${r}`, beds, up:"u:" + u.id, active:beds.some(b => !b.archived) }; }
    if (k === "bed") { const b = H.bed(a); return b && { k, obj:b, label:"Yatak " + b.no, beds:[b], up:"u:" + b.unitId, active:!b.archived }; }
    return null;
  }
  const lifeBar = (key) => { const t = lifeTarget(key); if (!t) return "";
    const full = t.beds.filter(b => b.status === "dolu").length, hist = anyHist(t.beds), k = esc(key);
    const why = full ? `${full} dolu yatak var: önce hastalar transfer ya da taburcu edilmeli.`
      : !t.active ? "Pasif: klinik ekranlarda görünmez, geçmişi korunur."
      : hist ? "Hasta geçmişi var: silinemez, yalnız arşivlenir. Denetim zinciri korunur."
      : "Hiç kullanılmamış. Yanlış girildiyse silinebilir.";
    return `<div class="adm-life">${t.active
        ? `<button class="btn sm" data-life="toggle" data-k="${k}"${full ? " disabled" : ""}>${I("x")}Arşivle (pasif)</button>`
        : `<button class="btn sm" data-life="toggle" data-k="${k}">${I("ok")}Aktif yap</button>`}
      ${hist ? "" : `<button class="btn sm" data-life="del" data-k="${k}" style="color:var(--crit)"${full ? " disabled" : ""}>${I("trash")}Sil</button>`}
      <span class="adm-sub">${why}</span></div>`; };

  function lifeAct(op, key, redraw) {
    const t = lifeTarget(key); if (!t) return;
    const full = t.beds.filter(b => b.status === "dolu").length;
    if (op === "toggle") {
      const on = !t.active;
      if (!on && full) { H.toast(`${t.label}: ${full} dolu yatak var. Önce hastaları transfer ya da taburcu edin.`, "e"); return; }
      if (t.k === "r" || t.k === "bed") t.beds.forEach(b => Object.assign(b, on ? { archived:false, oos:false, oosWhy:"", status:"bos" } : { archived:true, oos:true, oosWhy:"Arşivlendi", status:"bloke" }));
      else t.obj.active = on;
      H.log(on ? "Yapı: aktif yapıldı" : "Yapı: arşivlendi (pasif)", t.label);
      H.toast(`${t.label}: ${on ? "aktif" : "arşivlendi · klinik ekranlarda görünmez"}`, on ? "" : "w"); redraw(); return;
    }
    if (full) { H.toast(`${t.label}: ${full} dolu yatak var. Silinemez.`, "e"); return; }
    if (anyHist(t.beds)) { H.toast(`${t.label}: hasta geçmişi var, silinemez. Arşivleyin.`, "e"); return; }
    const o = { c:"" };
    askModal("Sil · " + esc(t.label), `<div class="note" style="margin-bottom:10px">${I("alert")} Geri alınamaz. ${t.beds.length} yatak da silinir. Bu öğede hiç hasta yatmadı; silme denetim kaydına yazılır.</div>` + fld("c", "Onay için yazın: SİL", inp("c", "", 'autocomplete="off"'), 1), o, () => {
      if (o.c.trim().toLocaleUpperCase("tr") !== "SİL") return "Onay için SİL yazın";
      if (t.k === "r") { const u = t.obj.u; u.beds = u.beds.filter(b => b.room !== t.obj.room); }
      else if (t.k === "bed") { const u = H.unit(t.obj.unitId); u.beds = u.beds.filter(b => b !== t.obj); }
      else { t.parent.splice(t.parent.indexOf(t.obj), 1); if (t.k === "u") H.data.users.forEach(x => x.units = (x.units || []).filter(id => id !== t.obj.id)); }
      AD.sel = t.up;
      H.log("Yapı: silindi (hiç kullanılmamış)", `${t.label} · ${t.beds.length} yatak`); H.toast(`${t.label} silindi`, "w"); redraw(); });
  }

  /* birim ekle / düzenle — hastane, bina ya da kat düzeyinden açılır */
  const KD = { servis:["ward", "adult", "NEWS2", "ward", "ara"], cocuk:["ward", "child", "PEWS", "ward", "ara"], yb:["icu", "adult", "SOFA + NEWS2", "icu", "tam"], kvc:["icu", "adult", "SOFA + NEWS2", "cvicu", "ara"],
    picu:["icu", "child", "PEWS", "picu", "ara"], nicu:["nicu", "neonate", "nSOFA", "nicu", "tam"], bmt:["ward", "adult", "NEWS2", "bmt", "ara"], acil:["op", "adult", "—", "er", "op"],
    gun:["op", "adult", "—", "day", "op"], kemo:["op", "adult", "—", "chemo", "op"], anjio:["op", "adult", "—", "cath", "op"], ivf:["op", "adult", "—", "ivf", "op"], bebek:["op", "neonate", "—", "nursery", "op"] };
  const KL = [["yb", "Erişkin yoğun bakım"], ["kvc", "KVC yoğun bakım"], ["picu", "Çocuk yoğun bakım"], ["nicu", "Yenidoğan yoğun bakım"], ["servis", "Servis"], ["cocuk", "Çocuk servisi"], ["bmt", "Kemik iliği nakli"],
    ["acil", "Acil servis"], ["gun", "Günübirlik"], ["kemo", "Kemoterapi"], ["anjio", "Anjiyografi"], ["ivf", "IVF"], ["bebek", "Bebek odası"]];
  const TIERS = ["tam", "ara", "op"];
  const tierDot = (t) => `<i class="adm-tier ${esc(t || "op")}" title="${esc(H.TIER[t] ? H.TIER[t][0] : "")}"></i>`;
  const kindOf = (x) => (Object.entries(KD).find(([, d]) => d[3] === x.kind && d[1] === x.ageGroup) || Object.entries(KD).find(([, d]) => d[3] === x.kind) || ["servis"])[0];

  function unitModal(ctx, redraw) {
    const u = ctx.u || null, isNew = !u;
    const fl = sortB().filter(b => !ctx.bid || b.id === ctx.bid).flatMap(b => sortF(b).map(f => [f.id, `${b.name} · ${H.floorText(f.no)}`]));
    if (isNew && !fl.length) { H.toast(ctx.bid ? "Bu binada kat yok. Önce kat ekleyin." : "Önce bina ve kat ekleyin", "e"); return; }
    const o = isNew ? { f:ctx.fid || fl[0][0], name:"", tr:"", ru:"", en:"", kind:"servis", tier:"ara", code:"", ageGroup:"adult", rule:"NEWS2", rooms:"4", per:"2" }
      : { name:u.names.AZ, tr:u.names.TR || "", ru:u.names.RU || "", en:u.names.EN || "", kind:kindOf(u), tier:u.tier || KD[kindOf(u)][4], code:u.code || "", ageGroup:u.ageGroup, rule:u.rule };
    const tierNote = (t) => H.TIER[t] ? H.TIER[t][1] : "";
    const fixedLoc = isNew && ctx.fid ? (fl.find(x => x[0] === ctx.fid) || [])[1] : null;
    H.modal({ title:isNew ? "Birim / bölüm ekle" : "Birimi düzenle · " + esc(u.tr),
      body:`${isNew ? (fixedLoc ? fld("f", "Konum", `<b>${esc(fixedLoc)}</b>`) : fld("f", "Konum (bina · kat)", sel("f", fl, o.f), 1)) : ""}
        ${fld("name", "Ad (AZ)", inp("name", o.name, 'placeholder="ör. Kardiologiya Servisi"'), 1)}${fld("tr", "Ad (TR)", inp("tr", o.tr, 'placeholder="ör. Kardiyoloji Servisi"'), 1)}
        ${fld("ru", "Ad (RU)", inp("ru", o.ru, 'placeholder="boş kalırsa TR adı"'))}${fld("en", "Ad (EN)", inp("en", o.en, 'placeholder="boş kalırsa TR adı"'))}
        ${fld("code", "HBYS birim kodu", inp("code", o.code, 'class="adm-num" autocomplete="off" placeholder="ör. 2411"') + `<div class="adm-sub" style="margin-top:4px">Ağaç bu koda göre sıralanır; hastane kaydıyla eşleşme de bu kodla yapılır.</div>`)}
        ${fld("kind", "Tür", opts("kind", KL, o.kind), 1)}
        ${fld("tier", "Katman", opts("tier", TIERS.map(t => [t, H.TIER[t][0]]), o.tier) + `<div class="adm-sub" data-tiernote style="margin-top:4px">${tierNote(o.tier)}</div>`, 1)}
        ${fld("ageGroup", "Yaş grubu", opts("ageGroup", Object.entries(AGE_L), o.ageGroup), 1)}
        ${fld("rule", "İzleme kuralı", opts("rule", [...RULES, "—"].map(r => [r, r === "—" ? "Yok (operasyonel)" : r]), o.rule), 1)}
        ${isNew ? fld("rooms", "Oda sayısı × oda başına yatak", `<div class="adm-row" style="flex-wrap:nowrap"><input data-f="rooms" class="adm-num" inputmode="numeric" value="${esc(o.rooms)}"><span class="adm-sub">oda ×</span><input data-f="per" class="adm-num" inputmode="numeric" value="${esc(o.per)}"><span class="adm-sub">yatak</span></div>`, 1) : ""}
        <p class="adm-sub" style="margin:4px 0 0">Tür seçilince katman, yaş grubu ve kural önerilir; değiştirebilirsiniz. Eşikler hastanenin onayıyla etkinleşir.</p>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>${I("ok")}Kaydet</button>`,
      onMount(m) {
        const setOpt = (f, v) => m.querySelectorAll(`.opts[data-f="${f}"] i`).forEach(i => i.classList.toggle("on", i.dataset.v === v));
        const note = () => { m.querySelector("[data-tiernote]").textContent = tierNote(o.tier); };
        bindForm(m, o, k => {
          if (k === "kind") { const [, ag, rule, , tier] = KD[o.kind]; Object.assign(o, { ageGroup:ag, rule, tier }); setOpt("ageGroup", ag); setOpt("rule", rule); setOpt("tier", tier); note(); }
          if (k === "tier") note();
        });
        m.querySelector("[data-ok]").onclick = () => {
          const miss = [], code = String(o.code || "").trim();
          if (!o.name.trim()) miss.push("name"); if (!o.tr.trim()) miss.push("tr");
          const dup = code && H.allUnits().find(x => x !== u && String(x.code || "") === code);
          if (dup) miss.push("code");
          const rooms = parseInt(o.rooms, 10), per = parseInt(o.per, 10);
          if (isNew && (!(rooms >= 1 && rooms <= 40) || !(per >= 1 && per <= 8))) miss.push("rooms");
          markErr(m, miss);
          if (miss.length) { H.toast(dup ? `Bu kod kullanılıyor: ${dup.tr}` : miss.includes("rooms") ? "Oda 1–40, oda başına yatak 1–8 olmalı" : "Zorunlu alanları kontrol edin", "e"); return; }
          const [type, , , kindKey] = KD[o.kind];
          const names = { AZ:o.name.trim(), TR:o.tr.trim(), RU:(o.ru || "").trim() || o.tr.trim(), EN:(o.en || "").trim() || o.tr.trim() };
          if (isNew) {
            const { b, f } = findF(o.f); let base = norm(o.tr).replace(/[^a-z]/g, "").slice(0, 3) || "brm", id = base, i = 2;
            while (H.unit(id)) id = base + i++;
            const nu = H.localizeUnit({ id, names, type, kind:kindKey, tier:o.tier, ageGroup:o.ageGroup, beds:[], rule:o.rule, code, active:true });
            for (let r = 1; r <= rooms; r++) addBeds(nu, r, per);
            f.units.push(nu);
            H.log("Yapı: birim eklendi", `${nu.tr} · ${b.name} · ${H.floorText(f.no)} · ${unitKind(nu)} · ${H.TIER[o.tier][0]} · kod ${code || "—"} · ${rooms}×${per} yatak`);
            AD.sel = "u:" + id; openPath(AD.sel); H.toast(`${nu.tr} eklendi · ${rooms * per} yatak`);
          } else {
            const ch = [];
            if (u.names.TR !== names.TR) ch.push(`ad ${u.names.TR} → ${names.TR}`);
            if ((u.code || "") !== code) ch.push(`kod ${u.code || "—"} → ${code || "—"}`);
            if (u.tier !== o.tier) ch.push(`katman ${H.TIER[u.tier] ? H.TIER[u.tier][0] : "—"} → ${H.TIER[o.tier][0]}`);
            if (u.rule !== o.rule) ch.push(`kural ${u.rule} → ${o.rule}`);
            if (u.kind !== kindKey) ch.push(`tür ${unitKind(u)} → ${H.KIND[kindKey] || kindKey}`);
            if (u.ageGroup !== o.ageGroup) ch.push(`yaş ${AGE_L[u.ageGroup]} → ${AGE_L[o.ageGroup]}`);
            Object.assign(u.names, names); Object.assign(u, { type, kind:kindKey, tier:o.tier, ageGroup:o.ageGroup, rule:o.rule, code });
            H.log("Yapı: birim düzenlendi", `${u.tr}${ch.length ? " · " + ch.join(", ") : " · değişiklik yok"}`); H.toast("Kaydedildi");
          }
          H.closeModal(); redraw();
        };
      } });
  }

  function tabStructure(body, draw) {
    const hs = H.data.hospital; H.allUnits(); markHist();
    AD.stOpen = AD.stOpen || new Set(); if (AD.stQ === undefined) AD.stQ = "";
    const parts = AD.sel.split(":"), kind = parts[0], a1 = parts[1], a2 = parts.slice(2).join(":");
    const ok = kind === "hosp" || (kind === "b" && findB(a1)) || (kind === "f" && findF(a1).f) || (kind === "u" && H.unit(a1))
      || (kind === "r" && H.unit(a1) && H.unit(a1).beds.some(b => b.room === a2)) || (kind === "bed" && H.bed(a1));
    if (!ok) { AD.sel = "hosp"; return tabStructure(body, draw); }
    if (!AD.stInit) { AD.stInit = true; sortB().forEach(b => AD.stOpen.add("b:" + b.id)); openPath(AD.sel); }
    const P = pathOf(AD.sel), redraw = () => tabStructure(body, draw);
    const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    const btn = (act, ic, l, extra = "") => `<button class="btn sm" data-act="${act}" ${extra}>${I(ic)}${l}</button>`;
    const ptag = `<span class="adm-ptag">pasif</span>`;

    /* ---- ağaç ---- */
    const row = (key, lvl, lead, name, cnt, o = {}) => `<div class="adm-tn${AD.sel === key || o.hot ? " on" : ""}${o.dim ? " off" : ""}" data-sel="${esc(key)}" style="padding-left:${4 + lvl * 14}px" title="${esc(name)}">`
      + (o.tog === undefined ? `<span class="car nil"></span>` : `<button type="button" class="car${o.tog ? "" : " shut"}" data-tog="${esc(key)}" aria-label="${o.tog ? "Kapat" : "Aç"}">${I("chevD")}</button>`)
      + `${lead}<span class="nm">${o.code ? `<span class="cd">${esc(o.code)}</span> ` : ""}${esc(name)}</span>${o.off ? ptag : ""}<span class="c">${cnt}</span></div>`;
    const allKeys = () => sortB().flatMap(b => ["b:" + b.id, ...b.floors.map(f => "f:" + f.id)]);
    function drawTree() {
      const host = body.querySelector("[data-tree]"); if (!host) return;
      const q = norm(AD.stQ), hit = (u) => !q || norm([...Object.values(u.names || {}), u.code, u.id].join(" ")).includes(q);
      let h = row("hosp", 0, I("building"), hs.name, liveBeds(allBeds()).length), n = 0;
      sortB().forEach(b => {
        const fls = sortF(b).map(f => [f, sortU(f).filter(hit)]).filter(([, us]) => !q || us.length);
        if (q && !fls.length) return;
        const bOff = b.active === false, bo = !!q || AD.stOpen.has("b:" + b.id);
        h += row("b:" + b.id, 1, I("building"), b.name, liveBeds(bedsOfB(b)).length, { tog:bo, off:bOff, dim:bOff, code:bCode(b) });
        if (!bo) return;
        fls.forEach(([f, us]) => {
          const fOff = f.active === false, fo = !!q || AD.stOpen.has("f:" + f.id);
          h += row("f:" + f.id, 2, I("list"), H.floorText(f.no), liveBeds(bedsOfF(f)).length, f.units.length ? { tog:fo, off:fOff, dim:bOff || fOff } : { off:fOff, dim:bOff || fOff });
          if (!fo) return;
          us.forEach(u => { n++; const c = counts(liveBeds(u.beds)), uOff = u.active === false;
            h += row("u:" + u.id, 3, tierDot(u.tier), u.tr, `${c.d}/${c.t}`, { off:uOff, dim:bOff || fOff || uOff, code:u.code, hot:P.u === u.id && kind !== "u" }); });
        });
      });
      if (q && !n) h += `<div class="adm-sub" style="padding:10px 8px">"${esc(AD.stQ)}" ile eşleşen birim yok.</div>`;
      host.innerHTML = h;
      const all = body.querySelector("[data-alltog]"); if (all) { const open = allKeys().every(k => AD.stOpen.has(k)); all.textContent = open ? "Tümünü kapat" : "Tümünü aç"; all.dataset.alltog = open ? "close" : "open"; all.disabled = !!q; }
    }

    const selName = kind === "hosp" ? hs.name : kind === "b" ? findB(a1).name : kind === "f" ? `${findF(a1).b.name} · ${H.floorText(findF(a1).f.no)}` : H.unit(P.u).tr;
    const side = `<div class="box adm-st-side${AD.stDrawer ? " open" : ""}">
      <button type="button" class="adm-st-tog" data-drawer aria-expanded="${AD.stDrawer ? "true" : "false"}">${I("tree")}<span class="nm">Yapı ağacı · <b>${esc(selName)}</b></span>${I("chevD")}</button>
      <div class="adm-st-body">
        <div class="adm-st-find"><label class="adm-st-q">${I("search")}<input data-stq placeholder="Birim adı ya da kodu" value="${esc(AD.stQ)}" autocomplete="off"></label><button type="button" class="btn g sm" data-alltog="open">Tümünü aç</button></div>
        <div class="adm-st-tree" data-tree></div>
        <div class="adm-st-foot"><div>Sıra: bina kodu · kat (zeminden yukarı) · birim kodu</div>
          <div class="lg">${TIERS.map(t => `<span>${tierDot(t)}${H.TIER[t][0]}</span>`).join("")}</div>
          <div>Sayılar: birimde dolu/toplam, katta ve binada toplam yatak.</div></div>
      </div></div>`;

    /* ---- kat planı: odalar ve yataklar ---- */
    const plan = (u, selBed, selRoom) => { const rs = roomsSorted(u);
      return `<div class="box" style="margin-top:12px"><h5>${I("grid")} Kat planı · ${rs.length} oda <span class="r adm-sub adm-st-hint">odaya ya da yatağa dokunun</span></h5>${legend()}
        ${rs.length ? `<div class="adm-rooms">${rs.map(([r, bs]) => { const c = counts(liveBeds(bs)), off = bs.every(b => b.archived);
          return `<div class="adm-room${selRoom === r ? " sel" : ""}${off ? " off" : ""}"><button type="button" class="adm-rm-h" data-sel="${esc(`r:${u.id}:${r}`)}"><span class="nm">Oda ${esc(r)}</span>${off ? ptag : ""}<span class="c">${c.d}/${c.t}</span></button>
            <div class="adm-beds">${bs.map(b => bedTile(b, `data-sel="bed:${esc(b.id)}" title="${esc(b.archived ? "Arşivlendi" : BST[b.status])}"${b.archived ? ' style="opacity:.45"' : ""}`, selBed === b.id, true)).join("")}</div></div>`; }).join("")}</div>`
          : `<div class="empty">Bu birimde oda yok. "Oda ekle" ile başlayın.</div>`}</div>`; };
    const back = (u) => `<div class="adm-row" style="margin-bottom:10px"><button class="btn sm g" data-sel="u:${esc(u.id)}">${I("chevL")}${esc(u.tr)}</button></div>`;

    /* ---- sağ panel ---- */
    let det = "";
    if (kind === "hosp") {
      const us = H.allUnits();
      det = `<div class="box"><h5>${I("building")} Hastane</h5>${kv("Ad", esc(hs.name))}${kv("Şehir", esc(hs.city))}${kv("Bina", hs.buildings.length)}${kv("Birim", `${us.filter(u => u.live).length} aktif / ${us.length}`)}${kv("Yatak", cTxt(allBeds()))}
        <div class="adm-row" style="margin-top:10px">${btn("addB", "plus", "Bina ekle")}${btn("addU", "plus", "Birim / bölüm ekle")}${btn("import", "swap", "Hastane kaydından içe aktar")}</div>
        <div class="note i" style="margin-top:12px">${I("shield")} Bu kurulum tek hastaneye aittir. Yeni hastane bu ekrandan eklenmez; Homunculus ekibinin kurum konsolundan açılır (bkz. Taslak 20).</div>
        <p class="adm-sub" style="margin:8px 0 0">Birim, oda ve yatak listesi hastane kaydından (HBYS) okunabilir; kodlar eşleşir, burada yalnız izleme ayarları eklenir.</p></div>
        <div class="box" style="margin-top:12px"><h5>${I("list")} Binalar</h5>${sortB().map(b => `<button type="button" class="adm-st-li${b.active === false ? " off" : ""}" data-sel="b:${esc(b.id)}"><span class="cd">${esc(bCode(b))}</span><span class="nm">${esc(b.name)}</span>${b.active === false ? ptag : ""}<span class="c">${b.floors.length} kat · ${liveBeds(bedsOfB(b)).length} yatak</span></button>`).join("") || '<p class="adm-sub">Henüz bina yok.</p>'}</div>`;
    } else if (kind === "b") {
      const b = findB(a1), beds = bedsOfB(b);
      det = `<div class="box"><h5>${I("building")} ${esc(b.name)}${b.active === false ? " " + ptag : ""}</h5>${kv("Kod / sıra", esc(bCode(b)))}${kv("Kat", b.floors.length)}${kv("Birim", b.floors.reduce((s, f) => s + f.units.length, 0))}${kv("Yatak", cTxt(beds))}
        <div class="adm-row" style="margin-top:10px">${btn("renB", "edit", "Ad ve kod")}${btn("addF", "plus", "Kat ekle")}${btn("addU", "plus", "Birim / bölüm ekle")}</div>${lifeBar("b:" + b.id)}</div>
        <div class="box" style="margin-top:12px"><h5>${I("list")} Katlar</h5>${sortF(b).map(f => `<button type="button" class="adm-st-li${f.active === false ? " off" : ""}" data-sel="f:${esc(f.id)}"><span class="nm">${esc(H.floorText(f.no))}</span>${f.active === false ? ptag : ""}<span class="c">${f.units.length} birim · ${liveBeds(bedsOfF(f)).length} yatak</span></button>`).join("") || '<p class="adm-sub">Bu binada kat yok. "Kat ekle" ile başlayın.</p>'}</div>`;
    } else if (kind === "f") {
      const { b, f } = findF(a1);
      det = `<div class="box"><h5>${I("list")} ${esc(H.floorText(f.no))} · ${esc(b.name)}${f.active === false ? " " + ptag : ""}</h5>${kv("Birim", f.units.length)}${kv("Yatak", cTxt(bedsOfF(f)))}
        <div class="adm-row" style="margin-top:10px">${btn("renF", "edit", "Kat numarası")}${btn("addU", "plus", "Birim / bölüm ekle")}</div>${lifeBar("f:" + f.id)}</div>
        <div class="box" style="margin-top:12px"><h5>${I("bed")} Birimler</h5>${sortU(f).map(u => { const c = counts(liveBeds(u.beds));
          return `<button type="button" class="adm-st-li${u.active === false ? " off" : ""}" data-sel="u:${esc(u.id)}">${tierDot(u.tier)}${u.code ? `<span class="cd">${esc(u.code)}</span>` : ""}<span class="nm">${esc(u.tr)}</span>${u.active === false ? ptag : ""}<span class="c">${c.d}/${c.t}</span></button>`; }).join("") || '<p class="adm-sub">Bu katta birim yok.</p>'}</div>`;
    } else if (kind === "u") {
      const u = H.unit(a1), loc = findF(locOf(u.id).f), T = H.TIER[u.tier];
      const other = ["AZ", "TR", "RU", "EN"].filter(l => H.state.lang !== l).map(l => `${l}: ${esc((u.names || {})[l] || "—")}`).join("<br>");
      det = `<div class="box"><h5>${I("bed")} ${esc(u.tr)}${u.active === false ? " " + ptag : ""}<span class="r adm-row" style="gap:6px">${tierDot(u.tier)}${T ? T[0] : "—"}</span></h5>
          ${kv("Konum", `${esc(loc.b.name)} · ${esc(H.floorText(loc.f.no))}`)}${kv("Tür", esc(unitKind(u)))}${kv("Katman", T ? `${T[0]} <span class="adm-sub" style="font-family:Figtree;font-weight:500">· ${T[1]}</span>` : "—")}
          ${kv("HBYS birim kodu", esc(u.code || "—"))}${kv("Yaş grubu", AGE_L[u.ageGroup])}${kv("İzleme kuralı", esc(u.rule))}${kv("Yatak", cTxt(u.beds))}
          ${kv("Diğer adlar", `<span class="adm-sub" style="font-family:Figtree;font-weight:500;text-align:right;display:block">${other}</span>`)}
          <div class="adm-row" style="margin-top:10px">${btn("editU", "edit", "Düzenle")}${btn("addR", "plus", "Oda ekle")}</div>${lifeBar("u:" + u.id)}</div>${plan(u)}`;
    } else if (kind === "r") {
      const u = H.unit(a1), bs = u.beds.filter(b => b.room === a2), types = [...new Set(bs.map(b => b.type || "Yatak"))].join(", "), off = bs.every(b => b.archived);
      det = `${back(u)}<div class="box"><h5>${I("grid")} Oda ${esc(a2)} · ${esc(u.tr)}${off ? " " + ptag : ""}</h5>${kv("Yatak", cTxt(bs))}${kv("Yatak tipi", esc(types))}${kv("İzolasyon", bs.some(b => b.iso) ? "Var" : "Yok")}
          <div class="adm-row" style="margin-top:10px">${btn("renR", "edit", "Yeniden adlandır")}${btn("addBed", "plus", "Yatak ekle")}</div>${lifeBar(`r:${u.id}:${a2}`)}</div>${plan(u, null, a2)}`;
    } else if (kind === "bed") {
      const b = H.bed(a1), u = H.unit(b.unitId), p = b.status === "dolu" && H.showNames() ? H.pt(b.pid) : null;
      const cb = (f, on, label, dis) => `<label class="adm-chk" style="margin:0"><input type="checkbox" class="ck" data-f="${f}"${on ? " checked" : ""}${dis ? ` disabled title="${esc(dis)}"` : ""}><span>${label}</span></label>`;
      det = `${back(u)}<div class="box"><h5>${I("bed")} Yatak ${esc(b.no)}${b.archived ? " " + ptag : ""}</h5>
          ${kv("Birim", esc(u.tr))}${kv("Oda", esc(b.room))}${kv("Yatak tipi", esc(b.type || "Yatak"))}${kv("Durum", b.archived ? "Arşivlendi" : BST[b.status])}${p ? kv("Hasta", esc(p.name)) : ""}
          <div class="kv"><span>İzolasyon</span>${cb("iso", b.iso, b.iso ? "İzolasyon odası" : "Hayır", b.archived ? "Arşivlenmiş yatak" : "")}</div>
          <div class="kv"><span>Kullanım dışı</span>${cb("oos", b.oos && !b.archived, b.oos && !b.archived ? "Evet" + (b.oosWhy ? " · " + esc(b.oosWhy) : "") : "Hayır", b.archived ? "Arşivlenmiş yatak" : b.status === "dolu" ? "Dolu yatak kullanım dışı yapılamaz" : "")}</div>
          <div style="margin-top:12px">${b.archived ? "" : b.status === "dolu" ? `<div class="note i">Dolu yatağın durumu değiştirilemez. Önce hasta kabul ekranından transfer ya da taburcu yapılmalı.</div>`
            : `<div class="adm-sub" style="margin-bottom:6px">Durumu değiştir</div><div class="opts">${["bos", "temizlik", "bloke", "rezerve"].map(s => `<i data-bst="${s}" class="${b.status === s ? "on" : ""}">${BST[s]}</i>`).join("")}</div>`}</div>
          <div class="adm-row" style="margin-top:12px">${btn("renBed", "edit", "Yeniden adlandır")}</div>${lifeBar("bed:" + b.id)}</div>${plan(u, b.id, null)}`;
    }
    body.innerHTML = `<div class="adm-st">${side}<div class="adm-st-det">${det}</div></div>`;
    drawTree();

    const select = (key) => { AD.sel = key; openPath(key); AD.stDrawer = false; redraw(); };
    body.oninput = e => { if (e.target.matches("[data-stq]")) { AD.stQ = e.target.value; drawTree(); } };
    body.onchange = e => { const c = e.target.closest('input[data-f="iso"],input[data-f="oos"]'); if (!c || kind !== "bed") return; const b = H.bed(a1);
      if (c.dataset.f === "iso") { b.iso = c.checked; H.log("Yapı: izolasyon", `${b.no} · ${c.checked ? "izolasyon odası" : "normal"}`); return redraw(); }
      if (c.checked && b.status === "dolu") { c.checked = false; H.toast("Dolu yatak kullanım dışı yapılamaz", "e"); return; }
      if (c.checked) { const o = { why:"" }; askModal("Kullanım dışı · " + esc(b.no), fld("why", "Neden", inp("why", "", 'placeholder="ör. monitör arızası, tadilat"'), 1), o, () => { if (!o.why.trim()) return "Neden gerekli";
          Object.assign(b, { oos:true, oosWhy:o.why.trim(), status:"bloke" }); H.log("Yapı: kullanım dışı", `${b.no} · ${o.why.trim()}`); redraw(); }); c.checked = false; return; }
      Object.assign(b, { oos:false, oosWhy:"", status:"bos" }); H.log("Yapı: kullanıma alındı", b.no); redraw(); };
    body.onclick = e => {
      const tg = e.target.closest("[data-tog]"); if (tg && body.contains(tg)) { const k = tg.dataset.tog; AD.stOpen.has(k) ? AD.stOpen.delete(k) : AD.stOpen.add(k); drawTree(); return; }
      const at = e.target.closest("[data-alltog]"); if (at) { if (at.dataset.alltog === "close") AD.stOpen.clear(); else allKeys().forEach(k => AD.stOpen.add(k)); drawTree(); return; }
      const dr = e.target.closest("[data-drawer]"); if (dr) { AD.stDrawer = !AD.stDrawer; dr.closest(".adm-st-side").classList.toggle("open", AD.stDrawer); dr.setAttribute("aria-expanded", AD.stDrawer ? "true" : "false"); return; }
      const lf = e.target.closest("[data-life]"); if (lf) { if (!lf.disabled) lifeAct(lf.dataset.life, lf.dataset.k, redraw); return; }
      const s = e.target.closest("[data-sel]"); if (s && body.contains(s)) { select(s.dataset.sel); return; }
      const bs = e.target.closest("[data-bst]");
      if (bs) { const b = H.bed(a1); if (!b || b.status === "dolu" || b.archived) return; const old = b.status; if (b.pid) b.hist = true; b.status = bs.dataset.bst; if (b.status !== "dolu") delete b.pid;
        H.log("Yapı: yatak durumu", `${b.no} · ${BST[old]} → ${BST[b.status]}`); H.toast(`${b.no}: ${BST[b.status]}`); redraw(); return; }
      const a = e.target.closest("[data-act]"); if (!a || !body.contains(a)) return;
      const act = a.dataset.act;
      if (act === "addU") unitModal({ fid:kind === "f" ? a1 : null, bid:kind === "b" ? a1 : null }, redraw);
      else if (act === "editU") unitModal({ u:H.unit(a1) }, redraw);
      else if (act === "import") { H.modal({ title:"Hastane kaydından içe aktar", wide:true,
          body:`<div class="note i" style="margin-bottom:12px">Önizleme: HBYS birim ağacı okundu. Eşleşen birimler koduyla bağlanır; yeni birimler eklenir, hiçbir şey silinmez.</div>
            <div class="tw"><table class="t"><thead><tr><th>HBYS kodu</th><th>Birim</th><th>Oda / yatak</th><th>Durum</th></tr></thead><tbody>
            ${H.units().slice().sort((x, y) => natCmp(x.code, y.code)).map(u => `<tr><td class="mono">${esc(u.code || "—")}</td><td>${esc(u.name)}<div class="adm-sub">${esc(u.tr)}</div></td><td class="mono">${new Set(u.beds.map(b => b.room)).size} / ${u.beds.length}</td><td><span class="pill">${I("ok")}eşleşti</span></td></tr>`).join("")}
            <tr><td class="mono">3701</td><td>Doğum Otağı<div class="adm-sub">Doğumhane</div></td><td class="mono">4 / 4</td><td><span class="tag w">yeni · eklenecek</span></td></tr>
            <tr><td class="mono">1102</td><td>Ambulator qəbul<div class="adm-sub">Poliklinik (yatak yok)</div></td><td class="mono">0 / 0</td><td><span class="tag">atlanacak · yatak yok</span></td></tr></tbody></table></div>`,
          actions:`<button class="btn" data-x>Kapat</button><button class="btn p" data-x>${I("ok")}Önizlemeyi onayla</button>` }); H.log("Yapı: içe aktarma önizlemesi", "HBYS birim ağacı"); }
      else if (act === "addB") { const hsb = hs.buildings, id = String.fromCharCode(Math.max(64, ...hsb.map(b => b.id.charCodeAt(0))) + 1), o = { name:"", code:id };
        askModal("Bina ekle", fld("name", "Bina adı", inp("name", "", 'placeholder="ör. 3. Blok · Cərrahiyyə"'), 1) + fld("code", "Kod / sıra", inp("code", id, 'class="adm-num" autocomplete="off"') + `<div class="adm-sub" style="margin-top:4px">Ağaçta binalar bu koda göre sıralanır.</div>`), o, () => {
          const nm = o.name.trim(), code = String(o.code || "").trim() || id; if (!nm) return "Bina adı gerekli";
          if (hsb.some(b => String(bCode(b)) === code)) return "Bu kod kullanılıyor";
          hsb.push({ id, code, name:nm, names:{ AZ:nm, TR:nm, RU:nm, EN:nm }, floors:[], active:true }); H.log("Yapı: bina eklendi", `${code} · ${nm}`); AD.sel = "b:" + id; openPath(AD.sel); redraw(); }); }
      else if (act === "renB") { const b = findB(a1), o = { name:b.name, code:bCode(b) };
        askModal("Bina · ad ve kod", fld("name", "Bina adı", inp("name", b.name), 1) + fld("code", "Kod / sıra", inp("code", o.code, 'class="adm-num" autocomplete="off"'), 1), o, () => {
          const nm = o.name.trim(), code = String(o.code || "").trim(); if (!nm) return "Ad gerekli"; if (!code) return "Kod gerekli";
          if (hs.buildings.some(x => x !== b && String(bCode(x)) === code)) return "Bu kod kullanılıyor";
          H.log("Yapı: bina düzenlendi", `${b.name} → ${nm} · kod ${bCode(b)} → ${code}`); b.name = nm; if (b.names) Object.assign(b.names, { AZ:nm, TR:nm, RU:nm, EN:nm }); b.code = code; redraw(); }); }
      else if (act === "addF") { const b = findB(a1), o = { no:String(Math.max(-1, ...b.floors.map(f => f.no)) + 1) };
        askModal("Kat ekle · " + esc(b.name), fld("no", "Kat numarası", inp("no", o.no, 'inputmode="numeric" class="adm-num"') + `<div class="adm-sub" style="margin-top:4px">0 = zemin kat, eksi sayı = bodrum.</div>`, 1), o, () => {
          const n = parseInt(o.no, 10); if (isNaN(n) || n < -5 || n > 60) return "Geçerli bir kat numarası girin (−5 … 60)"; if (b.floors.some(f => f.no === n)) return "Bu kat zaten var";
          let fid = b.id + n, i = 2; while (findF(fid).f) fid = b.id + n + "-" + i++;
          const f = { id:fid, no:n, units:[], active:true }; b.floors.push(f); H.log("Yapı: kat eklendi", `${b.name} · ${H.floorText(n)}`); AD.sel = "f:" + f.id; openPath(AD.sel); redraw(); }); }
      else if (act === "renF") { const { b, f } = findF(a1), o = { no:String(f.no) };
        askModal("Kat numarası", fld("no", "Kat numarası", inp("no", o.no, 'inputmode="numeric" class="adm-num"'), 1), o, () => {
          const n = parseInt(o.no, 10); if (isNaN(n) || n < -5 || n > 60) return "Geçerli bir kat numarası girin (−5 … 60)"; if (n !== f.no && b.floors.some(x => x.no === n)) return "Bu kat zaten var";
          H.log("Yapı: kat numarası", `${b.name} · ${H.floorText(f.no)} → ${H.floorText(n)}`); f.no = n; redraw(); }); }
      else if (act === "addR") { const u = H.unit(a1), nr = Math.max(0, ...u.beds.map(b => parseInt(b.room, 10) || 0)) + 1, o = { room:String(nr), n:"2" };
        askModal("Oda ekle · " + esc(u.tr), fld("room", "Oda adı / no", inp("room", o.room), 1) + fld("n", "Yatak sayısı", inp("n", o.n, 'inputmode="numeric" class="adm-num"'), 1), o, () => {
          const n = parseInt(o.n, 10), r = o.room.trim(); if (!r) return "Oda adı gerekli"; if (r.includes(":")) return "Oda adında ':' kullanılamaz"; if (u.beds.some(b => b.room === r)) return "Bu oda zaten var"; if (!(n >= 1 && n <= 8)) return "Yatak sayısı 1–8 olmalı";
          addBeds(u, r, n); H.log("Yapı: oda eklendi", `${u.tr} · Oda ${r} · ${n} yatak`); AD.sel = `r:${u.id}:${r}`; redraw(); }); }
      else if (act === "renR") { const u = H.unit(a1), o = { room:a2 };
        askModal("Odayı yeniden adlandır", fld("room", "Oda adı / no", inp("room", a2), 1), o, () => {
          const r = o.room.trim(); if (!r) return "Oda adı gerekli"; if (r.includes(":")) return "Oda adında ':' kullanılamaz"; if (r !== a2 && u.beds.some(b => b.room === r)) return "Bu oda zaten var";
          u.beds.forEach(b => { if (b.room === a2) b.room = r; }); H.log("Yapı: yeniden adlandırma", `${u.tr} · Oda ${a2} → ${r}`); AD.sel = `r:${u.id}:${r}`; redraw(); }); }
      else if (act === "addBed") { const u = H.unit(a1), o = { n:"1" };
        askModal("Yatak ekle · Oda " + esc(a2), fld("n", "Yatak sayısı", inp("n", "1", 'inputmode="numeric" class="adm-num"'), 1), o, () => {
          const n = parseInt(o.n, 10); if (!(n >= 1 && n <= 8)) return "1–8 arası girin";
          addBeds(u, a2, n); H.log("Yapı: yatak eklendi", `${u.tr} · Oda ${a2} · +${n}`); redraw(); }); }
      else if (act === "renBed") { const b = H.bed(a1), u = H.unit(b.unitId), o = { no:b.no };
        askModal("Yatağı yeniden adlandır", fld("no", "Yatak no", inp("no", b.no), 1), o, () => {
          const n = o.no.trim(); if (!n) return "Yatak no gerekli"; if (n !== b.no && allBeds().some(x => x.no === n)) return "Bu yatak no kullanılıyor";
          H.log("Yapı: yeniden adlandırma", `${u.tr} · Yatak ${b.no} → ${n}`); b.no = n; redraw(); }); }
    };
  }

  /* ---------- Entegrasyonlar ---------- */
  function tabIntegrations(body) {
    const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    const md = H.settings.modes;
    body.innerHTML = `<div class="g2">
      <div class="box"><h5>${I("link")} HBYS bağlantısı <span class="r adm-row"><span class="adm-dot"></span>Bağlı</span></h5>
        ${kv("Son mesaj", H.at("21:40"))}${kv("Kuyrukta", "0")}${kv("Protokol", "HL7 v2 · FHIR R4")}${kv("Mesaj türleri", "ADT · ORM · ORU")}
        <div class="note i" style="margin-top:10px">Uç nokta, kimlik bilgileri ve kod eşlemeleri entegrasyon ekibinde yapılandırılır; bu ekranda gösterilmez.</div>
        <div class="adm-row" style="margin-top:10px"><button class="btn sm" data-act="test">${I("zap")}Bağlantıyı sına</button></div></div>
      <div class="box"><h5>${I("cpu")} Cihaz ağ geçidi <span class="r"><span class="tag">salt okunur</span></span></h5>
        ${kv("Bağlı cihaz", "22 / 24")}${kv("Yanıt vermeyen", "2 · ayrıntı Cihazlar ekranında")}${kv("Sorumlu", "Cihaz / biyomedikal ekibi")}
        <p class="adm-sub" style="margin:10px 0 0">Cihaz ekibinin alanıdır; eşleştirme ve sürücüler buradan değiştirilmez.</p>
        ${H.can("devices") ? `<div class="adm-row" style="margin-top:10px"><button class="btn sm g" data-act="devices">${I("chevR")}Cihazlar ekranı</button></div>` : ""}</div>
      <div class="box"><h5>${I("eye")} PACS bağlantısı <span class="r adm-row"><span class="adm-dot"></span>Bağlı</span></h5>
        ${kv("Görüntüleyici", "HBYS protokolüyle açılır")}${kv("Son sorgu", H.at("21:36"))}${kv("Rapor kaynağı", "HBYS (Mod 1)")}</div>
      <div class="box"><h5>${I("edit")} E-imza <span class="r"><span class="tag w">kısmi</span></span></h5>
        ${kv("Kurum içi imza", "Kullanıcı + PIN · etkin")}${kv("Nitelikli e-imza", "Yapılandırılmadı")}
        <p class="adm-sub" style="margin:10px 0 0">Skor onayı ve hemşirelik formları için kullanılır. Nitelikli e-imza sağlayıcısı hastanenin sözleşmesine bağlıdır.</p></div>
    </div>
    <div class="sec">Modül bazında çalışma modu <small>Her modül ayrı seçilir</small></div>
    <div class="g3" style="margin-bottom:12px">
      <div class="card"><b>Mod 1 · HBYS ana sistem</b><div class="adm-sub">Onlar girer, biz gösteririz.</div></div>
      <div class="card"><b>Mod 2 · Birlikte</b><div class="adm-sub">Bizde girilir, HBYS'ye gider.</div></div>
      <div class="card"><b>Mod 3 · Bağımsız</b><div class="adm-sub">Her şey bizde; HBYS'de karşılığı yok.</div></div></div>
    <div class="tw"><table class="t"><thead><tr><th>Modül</th><th>Mod</th></tr></thead><tbody>
      ${MODS.map(([k, l, , n]) => `<tr><td><b>${l}</b>${n ? `<div class="adm-sub">${n}</div>` : ""}</td><td>${k === "vitals" ? `<span class="pill">${I("cpu")}Cihazdan + elle</span>`
        : `<div class="seg">${[1, 2, 3].map(x => `<button data-mode="${k}" data-v="${x}" class="${md[k] === x ? "on" : ""}">Mod ${x}</button>`).join("")}</div>`}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="adm-sub" style="margin-top:10px">Mod değişikliği canlı ortamda entegrasyon ekibinin testinden sonra etkinleşir.</p>`;
    body.onclick = e => {
      const m = e.target.closest("[data-mode]");
      if (m) { const k = m.dataset.mode, v = +m.dataset.v; if (md[k] === v) return; const l = MODS.find(x => x[0] === k)[1];
        H.log("Entegrasyon modu", `${l}: Mod ${md[k]} → Mod ${v}`); md[k] = v; H.toast(`${l}: Mod ${v}`); tabIntegrations(body); return; }
      const a = e.target.closest("[data-act]"); if (!a) return;
      if (a.dataset.act === "test") { H.log("Entegrasyon testi", "HBYS · yanıt 84 ms"); H.toast("HBYS yanıt verdi · 84 ms"); }
      if (a.dataset.act === "devices") H.go("devices");
    };
  }

  /* ---------- Sistem ayarları ---------- */
  const SYS_L = { lang:"Varsayılan dil", userLangChange:"Kullanıcı dil değiştirebilir", sessionTimeout:"Oturum zaman aşımı", quickLock:"Hızlı kilit", pwMin:"Şifre min. uzunluk",
    pwUpper:"Büyük harf", pwDigit:"Rakam", pwSpecial:"Özel karakter", pwDays:"Şifre geçerliliği", pwHistory:"Şifre geçmişi", maxFails:"Başarısız giriş sınırı", lockMin:"Kilit süresi",
    mfaRoles:"2FA zorunlu roller", mortality:"Beklenen ölüm oranı" };
  /* 24.09 (3. oturum) · Ozan #51: "giriş için LDAP ileride aktif olacak". Bugün yalnız yerel hesap var;
   * LDAP kutusu yerini ve kararlarını gösterir, alanlar kilitli. Açılınca yerel hesap acil durum girişi olarak kalır. */
  function ldapBox() {
    const dis = `disabled style="opacity:.6"`;
    return `<div class="box" style="margin-top:12px"><h5>${I("key")} Giriş kaynağı <span class="r"><span class="tag">LDAP · ileride</span></span></h5>
      <div class="g2" style="gap:14px">
        <div>
          <label class="adm-row" style="gap:8px;margin-bottom:8px"><input type="radio" checked disabled> <b>Yerel hesaplar</b> <span class="pill">${I("ok")}Kullanımda</span></label>
          <label class="adm-row" style="gap:8px;opacity:.6"><input type="radio" disabled> <b>Kurumsal hesap (LDAP / Active Directory)</b></label>
          <p class="adm-sub" style="margin:10px 0 0">Açıldığında çalışanlar hastanedeki bilgisayar şifreleriyle girer; işten ayrılan kişi kurumda kapatılınca burada da kapanır. 2FA kuralı iki kaynakta da geçerlidir.</p>
        </div>
        <div>
          ${fld("ldapHost", "Sunucu", `<input ${dis} placeholder="ldaps://dc01.hastane.local:636">`)}
          ${fld("ldapBase", "Arama kökü", `<input ${dis} placeholder="OU=Personel,DC=hastane,DC=local">`)}
          ${fld("ldapMap", "Grup → rol eşlemesi", `<input ${dis} placeholder="YB-Hekim → Hekim · YB-Hemsire → Hemşire">`)}
        </div>
      </div>
      <div class="note i" style="margin-top:10px">Kararlar: yalnız şifreli bağlantı (LDAPS) · rol, kurumdaki gruptan gelir ama birim ataması burada yapılır · <b>sistem yöneticisi için bir yerel hesap her zaman kalır</b> (kurum sunucusu çökerse sisteme girilebilsin) · her LDAP girişi denetim kaydına yazılır.</div></div>`;
  }
  /* ---------- Telefon modülleri (27.09 · #192 #193) ----------
   * Kurum, hasta ekranının hangi sekmesinin ve hangi formun TELEFONDA görüneceğini seçer. Web hep hepsini gösterir.
   * Üç kova: sabit (kapatılamaz) · telefonda açık · yalnız web (açılabilir). Yetki kuralı değişmez: telefonda
   * açık olsa da kişinin yetkisi yoksa görmez. Kapalı bir forma iş listesinden gelinirse form yine açılır (iş kaybolmaz). */
  const MOB_DEF = {
    tab:{ ozet:"fix", trend:"on", skor:"on", takip:"on", ilac:"on", sonuc:"on", devir:"on", sivi:"off", bakim:"off", belge:"off", kamera:"off" },
    form:{ vitals:"fix", pain:"on", glucose:"on", io:"on", activity:"on", gcs:"on", rass:"on", cpot:"on", camicu:"on", fall:"off", braden:"off", wound:"off" } };
  const MOB_WHY = { sivi:"Saatlik ızgara geniş ekran ister", bakim:"Tanı ekleme ve katalog uzun iş; vardiya başında masada", belge:"Belge okuma/yazdırma masaüstünde", kamera:"Canlı görüntü telefonda veri ve gizlilik yükü",
    fall:"8 saatte bir, planlı; masada doldurulur", braden:"Günde bir, planlı", wound:"Günde bir; fotoğraflı yara için açılabilir", ozet:"Hasta ekranının kendisi", vitals:"Yatak başında en sık girilen veri" };
  let mobCfg = null;
  const mobLoad = () => { if (mobCfg) return mobCfg; mobCfg = clone(MOB_DEF); try { const s = JSON.parse(localStorage.getItem("hmc.mobmod") || "null"); if (s) ["tab", "form"].forEach(k => Object.entries(s[k] || {}).forEach(([x, v]) => { if (mobCfg[k][x] && mobCfg[k][x] !== "fix" && (v === "on" || v === "off")) mobCfg[k][x] = v; })); } catch {} return mobCfg; };
  const mobSave = () => { try { localStorage.setItem("hmc.mobmod", JSON.stringify(mobCfg)); } catch {} };
  // mobil.js sorar: bu sekme/form telefonda görünsün mü? Listede olmayan (yeni eklenen) her şey açık sayılır.
  H.mobileAllows = (kind, key) => { const v = (mobLoad()[kind] || {})[key]; return v !== "off"; };
  function tabMobile(body, draw) {
    const c = mobLoad();
    const TL = { ozet:"Özet", trend:"Trendler", skor:"Skorlar", takip:"Takip", ilac:"İlaç", sonuc:"Sonuçlar", devir:"Teslim notu", sivi:"Sıvı (saatlik ızgara)", bakim:"Bakım planı", belge:"Belgeler", kamera:"Kamera" };
    const fname = (k) => ((H.FORMS || []).find(f => f.key === k) || { name:k }).name;
    const n = (kind) => Object.values(c[kind]).filter(v => v !== "off").length, tot = (kind) => Object.keys(c[kind]).length;
    const row = (kind, k, label) => { const v = c[kind][k];
      return `<tr><td><b>${esc(label)}</b>${MOB_WHY[k] ? `<div class="adm-sub">${esc(MOB_WHY[k])}</div>` : ""}</td>
        <td>${v === "fix" ? `<span class="tag">${I("lock")}Sabit</span>` : v === "on" ? `<span class="tag ok">Telefonda</span>` : `<span class="tag">Yalnız web</span>`}</td>
        <td style="text-align:right"><label class="st-sw${v === "fix" ? " dis" : ""}"><input type="checkbox" data-mob="${kind}:${k}"${v !== "off" ? " checked" : ""}${v === "fix" ? " disabled" : ""}><span></span></label></td></tr>`; };
    const table = (kind, title, entries) => `<div class="box"><h5>${title} <span class="r mute" style="text-transform:none;letter-spacing:0">telefonda ${n(kind)} / ${tot(kind)}</span></h5>
      <div class="tw"><table class="t"><thead><tr><th>Modül</th><th>Durum</th><th style="text-align:right">Telefonda</th></tr></thead><tbody>${entries.map(([k, l]) => row(kind, k, l)).join("")}</tbody></table></div></div>`;
    body.innerHTML = `<p class="adm-sub" style="margin:0 0 12px">Telefonda hangi hasta sekmesinin ve formun görüneceğini seçin. <b>Web'de her şey görünür.</b> Kişinin yetkisi yoksa açık olsa da görmez. İş listesinden gelinen bir form, kapalı olsa da açılır.</p>
      <div class="g2">${table("tab", I("bed") + " Hasta ekranı sekmeleri", Object.keys(c.tab).map(k => [k, TL[k] || k]))}${table("form", I("clip") + " Formlar", Object.keys(c.form).map(k => [k, fname(k)]))}</div>
      <div class="adm-row" style="margin-top:12px"><button class="btn" data-mobreset>${I("swap")}Önerilen düzene dön</button></div>`;
    body.querySelectorAll("[data-mob]").forEach(i => i.onchange = () => { const [kind, k] = i.dataset.mob.split(":"); if (c[kind][k] === "fix") return;
      c[kind][k] = i.checked ? "on" : "off"; mobSave(); H.log("Telefon modülü " + (i.checked ? "açıldı" : "kapatıldı"), kind + ":" + k); draw(); });
    body.querySelector("[data-mobreset]").onclick = () => { mobCfg = clone(MOB_DEF); mobSave(); H.log("Telefon modülleri önerilen düzene döndü", ""); draw(); };
  }

  function tabSystem(body) {
    if (!AD.sys) AD.sys = clone(H.settings);
    const o = AD.sys, num = (f, u, a = "") => `<div class="adm-row" style="flex-wrap:nowrap"><input data-f="${f}" class="adm-num" inputmode="numeric" value="${esc(o[f])}" ${a}><span class="adm-sub">${u}</span></div>`;
    body.innerHTML = `<div data-form><div class="g2">
      <div class="box"><h5>${I("globe")} Dil</h5>
        ${fld("lang", "Varsayılan dil", `<div class="langs" style="flex-wrap:wrap">${H.LANGS.map(([k, l]) => `<span class="lang${o.lang === k ? " on" : ""}" data-deflang="${k}" title="${esc(l)}">${H.flagBox(k)}${k}</span>`).join("")}</div>`)}
        ${fld("userLangChange", "Kullanıcı dil değiştirebilir", opts("userLangChange", [["evet", "Evet"], ["hayir", "Hayır"]], o.userLangChange))}</div>
      <div class="box"><h5>${I("lock")} Oturum</h5>
        ${fld("sessionTimeout", "Zaman aşımı", num("sessionTimeout", "dk hareketsizlikte"))}
        ${fld("quickLock", "Ortak istasyonda hızlı kilit", opts("quickLock", [["acik", "Açık"], ["kapali", "Kapalı"]], o.quickLock))}
        ${fld("maxFails", "Başarısız giriş sınırı", num("maxFails", "deneme"))}
        ${fld("lockMin", "Kilit süresi", num("lockMin", "dk"))}</div>
      <div class="box"><h5>${I("key")} Şifre politikası</h5>
        ${fld("pwMin", "En az uzunluk", num("pwMin", "karakter"))}
        ${fld("pwRules", "İçermeli", chk("pwUpper", o.pwUpper, "Büyük harf") + chk("pwDigit", o.pwDigit, "Rakam") + chk("pwSpecial", o.pwSpecial, "Özel karakter"))}
        ${fld("pwDays", "Geçerlilik", num("pwDays", "gün"))}
        ${fld("pwHistory", "Tekrar yasağı", num("pwHistory", "son şifre"))}</div>
      <div class="box"><h5>${I("shield")} 2FA ve klinik gösterim</h5>
        ${fld("mfaRoles", "2FA zorunlu roller", opts("mfaRoles", Object.entries(H.data.roles).map(([k, r]) => [k, esc(r.name)]), o.mfaRoles, true))}
        ${fld("mortality", "Beklenen ölüm oranı", opts("mortality", [["kapali", "Kapalı"], ["acik", "Hastane açabilir"]], o.mortality) + `<div class="adm-sub" style="margin-top:4px">Varsayılan kapalı. Açılması hastanenin klinik kurul kararına bağlıdır.</div>`)}</div>
    </div>
    ${ldapBox()}
    <div data-socwrap>${H.social ? H.social.editorHtml() : ""}</div>
    <div class="box" style="margin-top:12px"><h5>${I("file")} Yedekleme ve saklama <span class="r"><span class="tag">salt okunur</span></span></h5>
      <div class="kv"><span>Yedekleme</span><b>Günlük, şifreli · kurulumda belirlenir</b></div>
      <div class="kv"><span>Klinik kayıt saklama süresi</span><b>Yerel mevzuata göre hastane belirler</b></div>
      <div class="kv"><span>Denetim kaydı</span><b>Değiştirilemez · silinemez</b></div>
      <p class="adm-sub" style="margin:8px 0 0">Bu alanlar kurulum ve bakım sözleşmesiyle yönetilir; ekrandan değiştirilmez.</p></div></div>
    <div class="formbar"><span class="adm-sub" data-dirty></span><span class="spacer"></span><button class="btn g" data-act="undo">Geri al</button><button class="btn p" data-act="save">${I("ok")}Kaydet</button></div>`;
    const sw = body.querySelector("[data-socwrap]"); if (sw && H.social) H.social.bind(sw);
    const box = body.querySelector("[data-form]");
    const dirty = () => { const ch = Object.keys(SYS_L).filter(k => JSON.stringify(normSys(o)[k]) !== JSON.stringify(H.settings[k])); body.querySelector("[data-dirty]").textContent = ch.length ? `${ch.length} değişiklik kaydedilmedi` : "Kayıtlı ayarlar"; return ch; };
    bindForm(box, o, dirty);
    body.onclick = e => {
      const l = e.target.closest("[data-deflang]"); if (l) { o.lang = l.dataset.deflang; box.querySelectorAll("[data-deflang]").forEach(x => x.classList.toggle("on", x === l)); dirty(); return; }
      const a = e.target.closest("[data-act]"); if (!a) return;
      if (a.dataset.act === "undo") { AD.sys = null; tabSystem(body); return; }
      if (a.dataset.act === "save") {
        const n = normSys(o), bad = [];
        if (!(n.sessionTimeout >= 1 && n.sessionTimeout <= 240)) bad.push("sessionTimeout"); if (!(n.pwMin >= 8 && n.pwMin <= 64)) bad.push("pwMin");
        if (!(n.pwDays >= 0 && n.pwDays <= 730)) bad.push("pwDays"); if (!(n.pwHistory >= 0 && n.pwHistory <= 24)) bad.push("pwHistory");
        if (!(n.maxFails >= 3 && n.maxFails <= 20)) bad.push("maxFails"); if (!(n.lockMin >= 1 && n.lockMin <= 1440)) bad.push("lockMin");
        markErr(box, bad); if (bad.length) { H.toast("Geçersiz değer: " + bad.map(k => SYS_L[k]).join(", "), "e"); return; }
        const ch = dirty(); if (!ch.length) { H.toast("Değişiklik yok"); return; }
        Object.keys(SYS_L).forEach(k => { H.settings[k] = clone({ v:n[k] }).v; }); AD.sys = clone(H.settings);
        H.log("Sistem ayarları kaydedildi", ch.map(k => SYS_L[k]).join(", "));
        H.toast("Sistem ayarları kaydedildi"); tabSystem(body);
      }
    };
    dirty();
  }
  function normSys(o) { const n = clone(o); ["sessionTimeout", "pwMin", "pwDays", "pwHistory", "maxFails", "lockMin"].forEach(k => { n[k] = parseInt(n[k], 10); }); return n; }

  /* ---------- Denetim kaydı ---------- */
  const SYN = [
    ["23.09.2026", "21:31", "hs.sevda", "Form kaydı", "Vital bulgular · Elvin Hüseynov (REA01)"],
    ["23.09.2026", "21:28", "dr.kamran", "Skor imzası", "SOFA 11 onaylandı · Elvin Hüseynov"],
    ["23.09.2026", "21:05", "rrt.emil", "Kırılan cam erişimi", "Rəşad Məmmədov (kapsam dışı hasta) · gerekçe: hızlı yanıt çağrısı · 30 dk"],
    ["23.09.2026", "20:58", "hs.gulnar", "Form kaydı", "Düşme riski · Zərifə Həşimova (DAX01)"],
    ["23.09.2026", "20:44", "hs.melek", "Başarısız giriş", "5. deneme · hesap 15 dk kilitlendi"],
    ["23.09.2026", "20:41", "hs.melek", "Başarısız giriş", "4. deneme"],
    ["23.09.2026", "20:12", "admin", "Şifre sıfırlandı", "yeni.hekim · geçici şifre, ilk girişte değiştirme zorunlu"],
    ["23.09.2026", "20:05", "hs.sevda", "Giriş", "İstasyon REA-1"],
    ["23.09.2026", "19:58", "dr.kamran", "Giriş", "2FA doğrulandı"],
    ["23.09.2026", "19:36", "kabul.ulviyye", "Bilinmeyen hasta kaydı", "G-2026-0001 · Erkek, ~45 yaş → CER06"],
    ["23.09.2026", "18:22", "admin", "Yetki değişikliği", "Hasta kabul görevlisi: + Yatak paneli"],
    ["23.09.2026", "17:10", "kalite.tural", "Denetim kaydı dışa aktarıldı", "22.09.2026 · 214 kayıt"],
    ["23.09.2026", "16:47", "hs.gulnar", "Form kaydı", "Aldığı–çıkardığı · Tofiq Babaşov (DAX02)"],
    ["23.09.2026", "14:02", "dr.kamran", "Skor imzası", "NEWS2 6 onaylandı · Zərifə Həşimova"],
    ["23.09.2026", "08:04", "hs.gulnar", "Giriş", "İstasyon DAX-1"],
    ["22.09.2026", "23:15", "mudur.rauf", "Giriş", "2FA doğrulandı"],
    ["22.09.2026", "22:40", "admin", "Kullanıcı oluşturuldu", "yeni.hekim · Hekim · Dahiliye Servisi"],
    ["22.09.2026", "19:12", "dr.kamran", "Başarısız giriş", "1. deneme"],
    ["22.09.2026", "11:30", "admin", "Sistem ayarları kaydedildi", "Oturum zaman aşımı 20 → 15 dk"],
    ["22.09.2026", "09:18", "admin", "Kullanıcı pasifleştirildi", "dr.samir · görev değişikliği"],
  ].map(([d0, t0, user, action, detail]) => { const [d, t] = H.tsPair(d0, t0); return { d, t, user, action, detail }; });   // 30.09c: gerçek saate kaydırılır
  const TYPES = [
    ["Başarısız giriş", /başarısız/i], ["Giriş / çıkış", /^(giriş|çıkış|oturum|ekran kilit|kilit açıldı)/i], ["Kırılan cam", /kırılan cam/i], ["Form kaydı", /form/i], ["Skor imzası", /skor|imza/i],
    ["Şifre sıfırlama", /şifre/i], ["Yetki değişikliği", /yetki|rol/i], ["Kullanıcı yönetimi", /kullanıcı|hesap kilidi/i], ["Hastane yapısı", /^yapı/i],
    ["Hasta kabul / yatak", /kabul|kayıt|transfer|taburcu|eşleştir|hbys kimlik/i], ["Sistem / entegrasyon", /ayar|entegrasyon/i], ["Denetim", /denetim/i],
  ];
  const typeOf = (a, d) => (TYPES.find(([, r]) => r.test(a) || (r.source === "başarısız" && r.test(d || ""))) || ["Diğer"])[0];
  const pad = (n) => String(n).padStart(2, "0");

  function tabAudit(body) {
    const live = H.audit.map(x => { const d = x.at instanceof Date ? x.at : new Date(x.at);
      return { d:`${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`, t:`${pad(d.getHours())}:${pad(d.getMinutes())}`, user:x.user, action:x.action, detail:x.detail, live:true }; });
    // Adı görme yetkisi olmayan roller (kalite, başhekim, BT) kayıtta hastayı yalnız yatak no ile görür; kayıt kendisi değişmez.
    const mask = (t) => H.showNames() ? t : H.data.patients.reduce((a, p) => a.split(p.name).join(`[hasta · ${(H.bed(p.bed) || {}).no || p.id}]`), String(t || ""));
    const all = [...live, ...SYN].map(x => Object.assign({}, x, { detail:mask(x.detail), type:typeOf(x.action, x.detail) }));
    const users = [...new Set(all.map(x => x.user))].sort(), dates = [...new Set(all.map(x => x.d))];
    const f = AD.af;
    const rows = all.filter(x => (!f.user || x.user === f.user) && (!f.type || x.type === f.type) && (!f.date || x.d === f.date));
    const tagCls = (t) => t === "Kırılan cam" ? "tag c" : t === "Başarısız giriş" || t === "Yetki değişikliği" ? "tag w" : "tag";
    const selF = (k, list, all) => `<select data-af="${k}"><option value="">${all}</option>${list.map(([v, l]) => `<option value="${esc(v)}"${f[k] === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    body.innerHTML = `<div class="adm-bar">${selF("user", users.map(u => [u, u === "—" ? "sistem" : `${uname(u)} (${u})`]), "Tüm kullanıcılar")}${selF("type", TYPES.map(t => [t[0], t[0]]).concat([["Diğer", "Diğer"]]), "Tüm işlemler")}${selF("date", dates.map(d => [d, d]), "Tüm tarihler")}
        <span class="spacer"></span><button class="btn" data-act="export">${I("file")}Dışa aktar</button></div>
      <div class="note i" style="margin-bottom:12px">${I("lock")} Kayıtlar değiştirilemez ve silinemez; bu ekranda düzenleme yoktur. ${rows.length} kayıt gösteriliyor.</div>
      ${rows.length ? `<div class="tw"><table class="t"><thead><tr><th>Zaman</th><th>Kullanıcı</th><th>İşlem</th><th>Ayrıntı</th></tr></thead><tbody>
        ${rows.map(x => `<tr><td class="mono" style="white-space:nowrap">${x.d.slice(0, 5)} <b>${x.t}</b></td><td style="white-space:nowrap">${esc(x.user === "—" ? "sistem" : uname(x.user))}<div class="adm-sub mono">${esc(x.user)}</div></td>
          <td><span class="${tagCls(x.type)}">${esc(x.action)}</span></td><td class="adm-sub" style="min-width:220px">${esc(x.detail)}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="empty">Filtreye uyan kayıt yok.</div>`}`;
    body.onchange = e => { const s = e.target.closest("[data-af]"); if (!s) return; f[s.dataset.af] = s.value; tabAudit(body); };
    body.onclick = e => { const a = e.target.closest("[data-act]"); if (!a || a.dataset.act !== "export") return;
      H.log("Denetim kaydı dışa aktarıldı", `${rows.length} kayıt · filtre: ${[f.user, f.type, f.date].filter(Boolean).join(", ") || "yok"}`);
      H.toast(`${rows.length} kayıt dışa aktarılmaya hazırlandı`); tabAudit(body); };
  }

  /* ---------- Bakım kataloğu (24.09 · yetki: admin_system) ----------
   * Hemşirelik bakım planı kataloğu VERİDİR (careplan.js → H.careCatalog): hastane kaydından içe aktarılır, burada düzenlenir,
   * SÜRÜMLÜ yayımlanır. Düzenleme bir taslak üzerinde yapılır; hemşireler "yayımla" denene kadar önceki sürümü görür.
   * Eski planlar yazıldıkları sürümle açılır (plan kendi kopyasını taşır). Yeni gelen tanıların içeriği burada UYDURULMAZ;
   * boş kalır ve "içerik bekliyor" görünür. Önerme kuralları: hangi veri hangi tanıyı ÖNERİR (hemşire kabul etmeden plana girmez). */
  H.addT({
    adm_cc_tab:{ AZ:"Qulluq kataloqu", TR:"Bakım kataloğu", RU:"Каталог ухода", EN:"Care catalogue" },
    adm_cc_nomod:{ AZ:"Qulluq planı modulu yüklənməyib.", TR:"Bakım planı modülü yüklenmedi.", RU:"Модуль плана ухода не загружен.", EN:"The care plan module is not loaded." },
    adm_cc_pub_tpl:{ AZ:"Dərcdə olan versiya <b>v{v}</b> · {at} · {by}", TR:"Yayımdaki sürüm <b>v{v}</b> · {at} · {by}", RU:"Опубликованная версия <b>v{v}</b> · {at} · {by}", EN:"Published version <b>v{v}</b> · {at} · {by}" },
    adm_cc_counts_tpl:{ AZ:"{n} diaqnoz · {h} xəstəxana qeydində · {l} yalnız bu kataloqda · {p} məzmun gözləyir", TR:"{n} tanı · {h} hastane kaydında · {l} yalnız bu katalogda · {p} içerik bekliyor", RU:"Диагнозов: {n} · в записи больницы: {h} · только в этом каталоге: {l} · ждут содержания: {p}", EN:"{n} diagnoses · {h} in the hospital record · {l} only in this catalogue · {p} awaiting content" },
    adm_cc_plans_tpl:{ AZ:"Bu versiya ilə yazılmış plan: {a} · köhnə versiyalarla: {b}", TR:"Bu sürümle yazılan plan: {a} · eski sürümlerle: {b}", RU:"Планов по этой версии: {a} · по старым версиям: {b}", EN:"Plans written with this version: {a} · with older versions: {b}" },
    adm_cc_import:{ AZ:"Xəstəxana qeydindən idxal et", TR:"Hastane kaydından içe aktar", RU:"Импорт из записи больницы", EN:"Import from hospital record" },
    adm_cc_draft_tpl:{ AZ:"Qaralamada {n} dəyişiklik var. Tibb bacıları dərc edilənə qədər v{v} görür.", TR:"Taslakta {n} değişiklik var. Hemşireler yayımlanana kadar v{v}'ü görür.", RU:"В черновике изменений: {n}. До публикации медсёстры видят v{v}.", EN:"{n} change(s) in draft. Nurses see v{v} until it is published." },
    adm_cc_publish_tpl:{ AZ:"v{v} kimi dərc et", TR:"v{v} olarak yayımla", RU:"Опубликовать как v{v}", EN:"Publish as v{v}" },
    adm_cc_discard:{ AZ:"Qaralamanı at", TR:"Taslağı at", RU:"Отменить черновик", EN:"Discard draft" },
    adm_cc_v_list:{ AZ:"Diaqnozlar", TR:"Tanılar", RU:"Диагнозы", EN:"Diagnoses" },
    adm_cc_v_rules:{ AZ:"Təklif qaydaları", TR:"Önerme kuralları", RU:"Правила предложений", EN:"Suggestion rules" },
    adm_cc_v_hist:{ AZ:"Versiya tarixçəsi", TR:"Sürüm geçmişi", RU:"История версий", EN:"Version history" },
    adm_cc_search:{ AZ:"Diaqnoz axtar", TR:"Tanı ara", RU:"Поиск диагноза", EN:"Search diagnoses" },
    adm_cc_all_st:{ AZ:"Bütün vəziyyətlər", TR:"Tüm durumlar", RU:"Все статусы", EN:"All statuses" },
    adm_cc_all_grp:{ AZ:"Bütün qruplar", TR:"Tüm gruplar", RU:"Все группы", EN:"All groups" },
    adm_cc_st_full:{ AZ:"məzmun tamdır", TR:"içerik tam", RU:"содержание полное", EN:"content complete" },
    adm_cc_st_pending:{ AZ:"məzmun gözləyir", TR:"içerik bekliyor", RU:"ждёт содержания", EN:"content pending" },
    adm_cc_st_passive:{ AZ:"passiv", TR:"pasif", RU:"неактивен", EN:"inactive" },
    adm_cc_th_name:{ AZ:"Ad", TR:"Ad", RU:"Название", EN:"Name" },
    adm_cc_th_grp:{ AZ:"Qrup", TR:"Grup", RU:"Группа", EN:"Group" },
    adm_cc_th_c:{ AZ:"Səbəb", TR:"Neden", RU:"Причины", EN:"Causes" },
    adm_cc_th_g:{ AZ:"Hədəf", TR:"Hedef", RU:"Цели", EN:"Goals" },
    adm_cc_th_a:{ AZ:"Fəaliyyət", TR:"Faaliyet", RU:"Меропр.", EN:"Interv." },
    adm_cc_th_st:{ AZ:"Vəziyyət", TR:"Durum", RU:"Статус", EN:"Status" },
    adm_cc_th_ch:{ AZ:"Son dəyişiklik", TR:"Son değişiklik", RU:"Последнее изменение", EN:"Last change" },
    adm_cc_src_hbys:{ AZ:"xəstəxana qeydi", TR:"hastane kaydı", RU:"запись больницы", EN:"hospital record" },
    adm_cc_src_local:{ AZ:"yalnız bu kataloq", TR:"yalnız bu katalog", RU:"только этот каталог", EN:"this catalogue only" },
    adm_cc_was_tpl:{ AZ:"əvvəlki ad: {n}", TR:"önceki ad: {n}", RU:"прежнее название: {n}", EN:"previous name: {n}" },
    adm_cc_open:{ AZ:"Aç", TR:"Aç", RU:"Открыть", EN:"Open" },
    adm_cc_none:{ AZ:"Filtrə uyğun diaqnoz yoxdur.", TR:"Filtreye uyan tanı yok.", RU:"Нет диагнозов по фильтру.", EN:"No diagnoses match the filter." },
    // tanı düzenleme
    adm_cc_m_edit_tpl:{ AZ:"Diaqnoz · {n}", TR:"Tanı · {n}", RU:"Диагноз · {n}", EN:"Diagnosis · {n}" },
    adm_cc_passive_lbl:{ AZ:"Passiv (tibb bacısının siyahısında görünmür; köhnə planlar dəyişmir)", TR:"Pasif (hemşirenin listesinde görünmez; eski planlar değişmez)", RU:"Неактивен (не виден в списке медсестры; старые планы не меняются)", EN:"Inactive (hidden from the nurse's list; old plans are unchanged)" },
    adm_cc_add_row:{ AZ:"Yeni sətir…", TR:"Yeni satır…", RU:"Новая строка…", EN:"New line…" },
    adm_cc_add:{ AZ:"Əlavə et", TR:"Ekle", RU:"Добавить", EN:"Add" },
    adm_cc_up:{ AZ:"Yuxarı", TR:"Yukarı", RU:"Вверх", EN:"Up" },
    adm_cc_down:{ AZ:"Aşağı", TR:"Aşağı", RU:"Вниз", EN:"Down" },
    adm_cc_del:{ AZ:"Sil", TR:"Sil", RU:"Удалить", EN:"Delete" },
    adm_cc_row_off:{ AZ:"passiv", TR:"pasif", RU:"неакт.", EN:"inactive" },
    adm_cc_def_freq:{ AZ:"standart tezlik", TR:"varsayılan sıklık", RU:"частота по умолчанию", EN:"default frequency" },
    adm_cc_empty_sec:{ AZ:"Hələ sətir yoxdur · xəstəxana kataloqundan gələcək", TR:"Henüz satır yok · hastane kataloğundan gelecek", RU:"Строк пока нет · поступят из каталога больницы", EN:"No lines yet · they will come from the hospital catalogue" },
    adm_cc_to_draft:{ AZ:"Qaralamaya yaz", TR:"Taslağa işle", RU:"Внести в черновик", EN:"Apply to draft" },
    adm_cc_cancel:{ AZ:"İmtina", TR:"Vazgeç", RU:"Отмена", EN:"Cancel" },
    adm_cc_close:{ AZ:"Bağla", TR:"Kapat", RU:"Закрыть", EN:"Close" },
    adm_cc_toast_draft_tpl:{ AZ:"{n}: {c} dəyişiklik qaralamaya yazıldı", TR:"{n}: {c} değişiklik taslağa işlendi", RU:"{n}: изменений в черновике: {c}", EN:"{n}: {c} change(s) applied to draft" },
    adm_cc_toast_nochange:{ AZ:"Dəyişiklik yoxdur", TR:"Değişiklik yok", RU:"Изменений нет", EN:"No changes" },
    adm_cc_toast_pub_tpl:{ AZ:"Kataloq v{v} dərc edildi · audit qeydinə yazıldı", TR:"Katalog v{v} yayımlandı · denetim kaydına yazıldı", RU:"Каталог v{v} опубликован · записано в журнал аудита", EN:"Catalogue v{v} published · written to the audit log" },
    adm_cc_toast_discard:{ AZ:"Qaralama atıldı", TR:"Taslak atıldı", RU:"Черновик отменён", EN:"Draft discarded" },
    adm_cc_pv_note:{ AZ:"Köhnə planlar yazıldıqları versiya ilə açılır; dərc onları dəyişmir.", TR:"Eski planlar yazıldıkları sürümle açılır; yayımlamak onları değiştirmez.", RU:"Старые планы открываются в своей версии; публикация их не меняет.", EN:"Old plans open with the version they were written in; publishing does not change them." },
    // içe aktarma
    adm_cc_m_import:{ AZ:"Xəstəxana qeydindən idxal · baxış", TR:"Hastane kaydından içe aktar · önizleme", RU:"Импорт из записи больницы · предпросмотр", EN:"Import from hospital record · preview" },
    adm_cc_imp_add:{ AZ:"Əlavə olunacaq", TR:"Eklenecek", RU:"Будет добавлено", EN:"To be added" },
    adm_cc_imp_change:{ AZ:"Dəyişəcək", TR:"Değişecek", RU:"Изменится", EN:"To be changed" },
    adm_cc_imp_same:{ AZ:"Eyni qalan", TR:"Aynı kalan", RU:"Без изменений", EN:"Unchanged" },
    adm_cc_imp_local:{ AZ:"Yalnız bu kataloqda (toxunulmur)", TR:"Yalnız bu katalogda (dokunulmaz)", RU:"Только в этом каталоге (не трогается)", EN:"Only in this catalogue (left as is)" },
    adm_cc_imp_what:{ AZ:"İdxal diaqnoz adlarını gətirir. Yeni diaqnozların səbəb/hədəf/fəaliyyət məzmunu xəstəxana kataloqundan ayrıca gələcək; o vaxta qədər “məzmun gözləyir” görünür.", TR:"Aktarım tanı adlarını getirir. Yeni tanıların neden/hedef/faaliyet içeriği hastane kataloğundan ayrıca gelecek; o zamana dek \"içerik bekliyor\" görünür.", RU:"Импорт приносит названия диагнозов. Причины/цели/мероприятия новых диагнозов поступят из каталога больницы отдельно; до тех пор отображается «ждёт содержания».", EN:"The import brings diagnosis names. Causes/goals/interventions for new diagnoses will come separately from the hospital catalogue; until then they show “content pending”." },
    adm_cc_imp_last_tpl:{ AZ:"Son idxal: v{v} · {at} · {by}", TR:"Son aktarım: v{v} · {at} · {by}", RU:"Последний импорт: v{v} · {at} · {by}", EN:"Last import: v{v} · {at} · {by}" },
    adm_cc_imp_zero:{ AZ:"Xəstəxana qeydi son idxal ilə eynidir; versiya artmır.", TR:"Hastane kaydı son aktarımla aynı; sürüm artmaz.", RU:"Запись больницы совпадает с последним импортом; версия не повышается.", EN:"The hospital record matches the last import; the version does not change." },
    adm_cc_imp_ok_tpl:{ AZ:"Təsdiqlə · v{v} dərc et", TR:"Onayla · v{v} yayımla", RU:"Подтвердить · опубликовать v{v}", EN:"Confirm · publish v{v}" },
    adm_cc_imp_more_tpl:{ AZ:"… və daha {n}", TR:"… ve {n} tane daha", RU:"… и ещё {n}", EN:"… and {n} more" },
    adm_cc_imp_draft_tpl:{ AZ:"Qaralamadakı {n} dəyişiklik də bu versiya ilə dərc olunacaq.", TR:"Taslaktaki {n} değişiklik de bu sürümle yayımlanacak.", RU:"Изменения из черновика ({n}) тоже будут опубликованы в этой версии.", EN:"The {n} change(s) in draft will be published with this version too." },
    // sürüm geçmişi
    adm_cc_th_v:{ AZ:"Versiya", TR:"Sürüm", RU:"Версия", EN:"Version" },
    adm_cc_th_at:{ AZ:"Tarix", TR:"Tarih", RU:"Дата", EN:"Date" },
    adm_cc_th_by:{ AZ:"Kim", TR:"Kim", RU:"Кто", EN:"By" },
    adm_cc_th_n:{ AZ:"Dəyişiklik", TR:"Değişiklik", RU:"Изменения", EN:"Changes" },
    adm_cc_th_kind:{ AZ:"Növ", TR:"Tür", RU:"Тип", EN:"Type" },
    adm_cc_th_plans:{ AZ:"Bu versiya ilə plan", TR:"Bu sürümle plan", RU:"Планов по версии", EN:"Plans on version" },
    adm_cc_k_init:{ AZ:"Qurulum", TR:"Kurulum", RU:"Создание", EN:"Setup" },
    adm_cc_k_edit:{ AZ:"Düzəliş", TR:"Düzenleme", RU:"Правка", EN:"Edit" },
    adm_cc_k_import:{ AZ:"Xəstəxana qeydindən idxal", TR:"Hastane kaydından aktarım", RU:"Импорт из записи больницы", EN:"Hospital record import" },
    adm_cc_n_tpl:{ AZ:"{n} dəyişiklik", TR:"{n} değişiklik", RU:"изменений: {n}", EN:"{n} changes" },
    adm_cc_n_add_tpl:{ AZ:"+{a} əlavə", TR:"+{a} eklendi", RU:"+{a} добавлено", EN:"+{a} added" },
    adm_cc_n_ch_tpl:{ AZ:"{c} dəyişdi", TR:"{c} değişti", RU:"{c} изменено", EN:"{c} changed" },
    adm_cc_current:{ AZ:"dərcdə", TR:"yayımda", RU:"опубликована", EN:"published" },
    // önerme kuralları
    adm_cc_r_on:{ AZ:"Açıq", TR:"Açık", RU:"Вкл.", EN:"On" },
    adm_cc_r_field:{ AZ:"Məlumat", TR:"Veri", RU:"Данные", EN:"Data" },
    adm_cc_r_cond:{ AZ:"Şərt", TR:"Koşul", RU:"Условие", EN:"Condition" },
    adm_cc_r_dx:{ AZ:"Təklif olunan diaqnoz", TR:"Önerilen tanı", RU:"Предлагаемый диагноз", EN:"Suggested diagnosis" },
    adm_cc_r_now:{ AZ:"İndi uyğun xəstə", TR:"Şu an eşleşen hasta", RU:"Совпадает пациентов", EN:"Patients matching now" },
    adm_cc_r_add:{ AZ:"Qayda əlavə et", TR:"Kural ekle", RU:"Добавить правило", EN:"Add rule" },
    adm_cc_r_foot:{ AZ:"Qayda yalnız TƏKLİF yaradır: tibb bacısı qəbul etmədən plana düşmür. Sistem diaqnoz qoymur. Hər dəyişiklik audit qeydinə yazılır.", TR:"Kural yalnız ÖNERİ üretir: hemşire kabul etmeden plana girmez. Sistem tanı koymaz. Her değişiklik denetim kaydına yazılır.", RU:"Правило только ПРЕДЛАГАЕТ: без согласия медсестры в план ничего не попадает. Система не ставит диагнозы. Каждое изменение записывается в журнал аудита.", EN:"A rule only SUGGESTS: nothing enters the plan until the nurse accepts. The system does not diagnose. Every change is written to the audit log." },
    adm_cc_r_adm:{ AZ:"Eşiklər xəstəxananın təsdiqi ilə təyin olunur; qaydalar hazırda versiyalanmır, dərhal qüvvəyə minir.", TR:"Eşikler hastanenin onayıyla belirlenir; kurallar şimdilik sürümlenmiyor, hemen yürürlüğe girer.", RU:"Пороги устанавливаются с одобрения больницы; правила пока не версионируются и действуют сразу.", EN:"Thresholds are set with the hospital's approval; rules are not versioned yet and take effect immediately." },
    adm_cc_r_toast_tpl:{ AZ:"Təklif qaydası yeniləndi · {x}", TR:"Önerme kuralı güncellendi · {x}", RU:"Правило предложения обновлено · {x}", EN:"Suggestion rule updated · {x}" },
    adm_cc_r_del_toast:{ AZ:"Qayda silindi", TR:"Kural silindi", RU:"Правило удалено", EN:"Rule deleted" },
    adm_cc_adm_note:{ AZ:"Qurulum qeydi: xəstəxana qeydindən ad idxalı hazırda əl ilə başladılır (İnteqrasiyalar). Məzmun (səbəb/hədəf/fəaliyyət) Excel şablonu ilə toplanır: şablonu endirin, xəstəxana düzəltsin, “Excel-dən idxal et” ilə yükləyin. “Başlanğıc məzmunu” xəstəxananın təsdiqini gözləyir.", TR:"Kurulum notu: hastane kaydından ad aktarımı şimdilik elle başlatılır (Entegrasyonlar). İçerik (neden/hedef/faaliyet) Excel şablonuyla toplanır: şablonu indirin, hastane düzeltsin, \"Excel'den içe aktar\" ile yükleyin. \"Başlangıç içeriği\" hastanenin onayını bekler.", RU:"Заметка по настройке: импорт названий из записи больницы пока запускается вручную («Интеграции»). Содержание (причины/цели/мероприятия) собирается через шаблон Excel: скачайте шаблон, больница исправит его, загрузите через «Импорт из Excel». «Начальное содержание» ждёт одобрения больницы.", EN:"Setup note: importing names from the hospital record is started manually for now (Integrations). Content (causes/goals/interventions) is collected with the Excel template: download it, the hospital corrects it, upload it with “Import from Excel”. “Starter content” awaits the hospital's approval." },
  });
  /* 24.09 (5. oturum) · bölüme göre içerik: içerik durumu, kapsam, birim paketleri, bekleyen öneriler, Excel şablonu / içe aktarma. */
  H.addT({
    adm_cc_st_hospital:{ AZ:"Xəstəxana kataloqu", TR:"Hastane kataloğu", RU:"Каталог больницы", EN:"Hospital catalogue" },
    adm_cc_st_starter:{ AZ:"Başlanğıc məzmunu · xəstəxananın təsdiqini gözləyir", TR:"Başlangıç içeriği · hastane onayı bekliyor", RU:"Начальное содержание · ждёт одобрения больницы", EN:"Starter content · awaiting hospital approval" },
    adm_cc_counts2_tpl:{ AZ:"{n} diaqnoz · {h} xəstəxana kataloqu · {s} başlanğıc məzmunu (təsdiq gözləyir) · {p} məzmun gözləyir · {x} passiv", TR:"{n} tanı · {h} hastane kataloğu · {s} başlangıç içeriği (onay bekliyor) · {p} içerik bekliyor · {x} pasif", RU:"Диагнозов: {n} · каталог больницы: {h} · начальное содержание (ждёт одобрения): {s} · ждут содержания: {p} · неактивных: {x}", EN:"{n} diagnoses · {h} hospital catalogue · {s} starter content (awaiting approval) · {p} content pending · {x} inactive" },
    adm_cc_th_units:{ AZ:"Bölmələr", TR:"Birimler", RU:"Отделения", EN:"Units" },
    adm_cc_src_lbl:{ AZ:"Məzmunun mənbəyi", TR:"İçeriğin kaynağı", RU:"Источник содержания", EN:"Content source" },
    adm_cc_units_lbl:{ AZ:"Diaqnozun keçərli olduğu bölmələr", TR:"Tanının geçerli olduğu birimler", RU:"Отделения, где действует диагноз", EN:"Units where the diagnosis applies" },
    adm_cc_row_units:{ AZ:"Bu maddənin bölmələri", TR:"Bu maddenin birimleri", RU:"Отделения этого пункта", EN:"Units for this item" },
    adm_cc_ps_yb:{ AZ:"Bütün reanimasiyalar", TR:"Tüm yoğun bakımlar", RU:"Все реанимации", EN:"All ICUs" },
    adm_cc_ps_eyb:{ AZ:"Böyüklər reanimasiyaları", TR:"Erişkin yoğun bakımlar", RU:"Взрослые реанимации", EN:"Adult ICUs" },
    adm_cc_ps_notnn:{ AZ:"Yenidoğulmuş xaric", TR:"Yenidoğan hariç", RU:"Кроме новорождённых", EN:"All except neonatal" },
    adm_cc_ps_ward:{ AZ:"Servislər", TR:"Servisler", RU:"Отделения (палаты)", EN:"Wards" },
    adm_cc_v_pkg:{ AZ:"Bölmə paketləri", TR:"Birim paketleri", RU:"Пакеты отделений", EN:"Unit packages" },
    adm_cc_v_prop_tpl:{ AZ:"Gözləyən təkliflər ({n})", TR:"Bekleyen öneriler ({n})", RU:"Ожидающие предложения ({n})", EN:"Pending suggestions ({n})" },
    adm_cc_xl_dl:{ AZ:"Excel şablonunu endir", TR:"Excel şablonunu indir", RU:"Скачать шаблон Excel", EN:"Download Excel template" },
    adm_cc_xl_imp:{ AZ:"Excel-dən idxal et", TR:"Excel'den içe aktar", RU:"Импорт из Excel", EN:"Import from Excel" },
    adm_cc_xl_dl_log:{ AZ:"Şablon endirildi", TR:"Şablon indirildi", RU:"Шаблон скачан", EN:"Template downloaded" },
    // birim paketleri
    adm_cc_p_nounit:{ AZ:"bu xəstəxanada bölmə yoxdur", TR:"bu hastanede birimi yok", RU:"в этой больнице нет такого отделения", EN:"no such unit in this hospital" },
    adm_cc_p_head_tpl:{ AZ:"{v} diaqnoz görünür · {f} tez-tez istifadə olunan · {o} bölməyə xas maddə", TR:"{v} tanı görünür · {f} sık kullanılan · {o} birime özgü madde", RU:"Видно диагнозов: {v} · часто используемых: {f} · пунктов отделения: {o}", EN:"{v} diagnoses visible · {f} frequently used · {o} unit-specific items" },
    adm_cc_p_visible:{ AZ:"Bu bölmədə görünür", TR:"Bu birimde görünür", RU:"Видно в отделении", EN:"Visible in this unit" },
    adm_cc_p_fav:{ AZ:"Tez-tez", TR:"Sık kullanılan", RU:"Часто", EN:"Frequent" },
    adm_cc_p_rows:{ AZ:"Bu bölmədəki maddələr (səbəb · hədəf · fəaliyyət)", TR:"Bu birimdeki maddeler (neden · hedef · faaliyet)", RU:"Пункты в отделении (причины · цели · мероприятия)", EN:"Items in this unit (causes · goals · interventions)" },
    adm_cc_p_own:{ AZ:"Bölməyə xas", TR:"Birime özgü", RU:"Для отделения", EN:"Unit-specific" },
    adm_cc_p_f_all:{ AZ:"Hamısı", TR:"Tümü", RU:"Все", EN:"All" },
    adm_cc_p_f_on:{ AZ:"Görünənlər", TR:"Görünenler", RU:"Видимые", EN:"Visible" },
    adm_cc_p_f_off:{ AZ:"Gizlilər", TR:"Gizliler", RU:"Скрытые", EN:"Hidden" },
    adm_cc_p_f_fav:{ AZ:"Tez-tez istifadə olunan", TR:"Sık kullanılanlar", RU:"Часто используемые", EN:"Frequently used" },
    adm_cc_p_add:{ AZ:"Bölməyə xas maddə əlavə et", TR:"Birime özgü madde ekle", RU:"Добавить пункт отделения", EN:"Add a unit-specific item" },
    adm_cc_p_add_ph:{ AZ:"Maddənin mətni…", TR:"Madde metni…", RU:"Текст пункта…", EN:"Item text…" },
    adm_cc_p_copy:{ AZ:"Bu paketi başqa bölməyə köçür", TR:"Bu paketi başka birime kopyala", RU:"Скопировать пакет в другое отделение", EN:"Copy this package to another unit" },
    adm_cc_p_copy_to:{ AZ:"Hədəf bölmə", TR:"Hedef birim", RU:"Целевое отделение", EN:"Target unit" },
    adm_cc_p_note:{ AZ:"Görünürlük və tez-tez istifadə açarları dərhal qüvvəyə minir və audit qeydinə yazılır. Bölməyə xas maddə qaralamaya düşür; dərc edildikdən sonra tibb bacıları görür.", TR:"Görünürlük ve sık kullanılan anahtarları hemen yürürlüğe girer ve denetim kaydına yazılır. Birime özgü madde taslağa girer; yayımlanınca hemşireler görür.", RU:"Переключатели видимости и частоты действуют сразу и записываются в журнал аудита. Пункт отделения попадает в черновик; медсёстры увидят его после публикации.", EN:"Visibility and frequent-use switches take effect immediately and are written to the audit log. A unit-specific item goes into the draft; nurses see it once published." },
    adm_cc_p_toast_vis_tpl:{ AZ:"{d}: {u} bölməsində {s}", TR:"{d}: {u} biriminde {s}", RU:"{d}: в отделении {u} — {s}", EN:"{d}: {s} in {u}" },
    adm_cc_p_shown:{ AZ:"görünür", TR:"görünür", RU:"видно", EN:"visible" },
    adm_cc_p_hidden:{ AZ:"gizlidir", TR:"gizli", RU:"скрыто", EN:"hidden" },
    adm_cc_p_toast_copy_tpl:{ AZ:"{a} paketi {b} bölməsinə köçürüldü · {n} maddə qaralamada", TR:"{a} paketi {b} birimine kopyalandı · {n} madde taslakta", RU:"Пакет {a} скопирован в {b} · пунктов в черновике: {n}", EN:"{a} package copied to {b} · {n} item(s) in draft" },
    adm_cc_p_copy_q_tpl:{ AZ:"{b} paketinin tez-tez istifadə olunanları və görünürlük açarları {a} paketindəki kimi olacaq. {a} bölməsinə xas maddələr {b} üçün də qaralamada açılacaq.", TR:"{b} paketinin sık kullanılanları ve görünürlük anahtarları {a} paketindeki gibi olacak. {a} birimine özgü maddeler {b} için de taslakta açılacak.", RU:"Часто используемые и переключатели видимости пакета {b} станут такими же, как в пакете {a}. Пункты отделения {a} будут открыты и для {b} в черновике.", EN:"The {b} package's frequently used list and visibility switches will match the {a} package. Items specific to {a} will also be opened for {b} in the draft." },
    adm_cc_p_toast_add:{ AZ:"Maddə qaralamaya əlavə edildi", TR:"Madde taslağa eklendi", RU:"Пункт добавлен в черновик", EN:"Item added to the draft" },
    // bekleyen öneriler
    adm_cc_q_th_at:{ AZ:"Tarix", TR:"Tarih", RU:"Дата", EN:"Date" },
    adm_cc_q_th_by:{ AZ:"Təklif edən", TR:"Öneren", RU:"Кто предложил", EN:"Suggested by" },
    adm_cc_q_th_unit:{ AZ:"Bölmə", TR:"Birim", RU:"Отделение", EN:"Unit" },
    adm_cc_q_th_dx:{ AZ:"Diaqnoz", TR:"Tanı", RU:"Диагноз", EN:"Diagnosis" },
    adm_cc_q_th_item:{ AZ:"Maddə", TR:"Madde", RU:"Пункт", EN:"Item" },
    adm_cc_q_ok:{ AZ:"Təsdiqlə", TR:"Onayla", RU:"Одобрить", EN:"Approve" },
    adm_cc_q_no:{ AZ:"Rədd et", TR:"Reddet", RU:"Отклонить", EN:"Reject" },
    adm_cc_q_none:{ AZ:"Gözləyən təklif yoxdur.", TR:"Bekleyen öneri yok.", RU:"Ожидающих предложений нет.", EN:"No pending suggestions." },
    adm_cc_q_done:{ AZ:"Qərar verilmiş təkliflər", TR:"Karara bağlanan öneriler", RU:"Рассмотренные предложения", EN:"Decided suggestions" },
    adm_cc_q_approved:{ AZ:"təsdiqləndi", TR:"onaylandı", RU:"одобрено", EN:"approved" },
    adm_cc_q_rejected:{ AZ:"rədd edildi", TR:"reddedildi", RU:"отклонено", EN:"rejected" },
    adm_cc_q_foot:{ AZ:"Bölmənin baş tibb bacısı diaqnoz pəncərəsində “bu bölmə üçün maddə təklif et” deyə bilər. Təsdiqlənən maddə yalnız həmin bölmə üçün qaralamaya düşür.", TR:"Birim sorumlu hemşiresi tanı penceresinde \"bu birim için madde öner\" diyebilir. Onaylanan madde yalnız o birim için taslağa girer.", RU:"Старшая медсестра отделения может в окне диагноза нажать «предложить пункт для отделения». Одобренный пункт попадает в черновик только для этого отделения.", EN:"A unit's charge nurse can use “suggest an item for this unit” in the diagnosis window. An approved item goes into the draft for that unit only." },
    adm_cc_q_toast_ok:{ AZ:"Təklif təsdiqləndi · maddə qaralamada", TR:"Öneri onaylandı · madde taslakta", RU:"Предложение одобрено · пункт в черновике", EN:"Suggestion approved · item in draft" },
    adm_cc_q_toast_no:{ AZ:"Təklif rədd edildi", TR:"Öneri reddedildi", RU:"Предложение отклонено", EN:"Suggestion rejected" },
    // Excel'den içe aktar
    adm_cc_x_title:{ AZ:"Excel-dən idxal · baxış", TR:"Excel'den içe aktar · önizleme", RU:"Импорт из Excel · предпросмотр", EN:"Import from Excel · preview" },
    adm_cc_x_pick:{ AZ:"Xəstəxananın doldurduğu qulluq kataloqu şablonunu (.xlsx) seçin. Hər sətir: diaqnoz · növ · maddə · bölmələr · tezlik · vəziyyət.", TR:"Hastanenin doldurduğu bakım kataloğu şablonunu (.xlsx) seçin. Her satır: tanı · tür · madde · birimler · sıklık · durum.", RU:"Выберите шаблон каталога ухода (.xlsx), заполненный больницей. Каждая строка: диагноз · тип · пункт · отделения · частота · статус.", EN:"Choose the care catalogue template (.xlsx) filled in by the hospital. Each row: diagnosis · type · item · units · frequency · status." },
    adm_cc_x_file_tpl:{ AZ:"Fayl: {f}", TR:"Dosya: {f}", RU:"Файл: {f}", EN:"File: {f}" },
    adm_cc_x_off:{ AZ:"Passivə keçiriləcək", TR:"Pasife alınacak", RU:"Станет неактивным", EN:"To be deactivated" },
    adm_cc_x_per:{ AZ:"Bölmələr üzrə", TR:"Birim bazında", RU:"По отделениям", EN:"By unit" },
    adm_cc_x_zero:{ AZ:"Fayl dərcdə olan kataloqla eynidir; versiya artmır.", TR:"Dosya yayımdaki katalogla aynı; sürüm artmaz.", RU:"Файл совпадает с опубликованным каталогом; версия не повышается.", EN:"The file matches the published catalogue; the version does not change." },
    adm_cc_x_src:{ AZ:"Faylla gələn diaqnozların mənbəyi “xəstəxana kataloqu” olur.", TR:"Dosyayla gelen tanıların kaynağı \"hastane kataloğu\" olur.", RU:"Источником диагнозов из файла становится «каталог больницы».", EN:"Diagnoses that come with the file get the source “hospital catalogue”." },
    adm_cc_k_excel:{ AZ:"Excel-dən idxal", TR:"Excel'den aktarım", RU:"Импорт из Excel", EN:"Excel import" },
    adm_cc_kind_c:{ AZ:"Səbəb", TR:"Neden", RU:"Причина", EN:"Cause" },
    adm_cc_kind_g:{ AZ:"Hədəf", TR:"Hedef", RU:"Цель", EN:"Goal" },
    adm_cc_kind_a:{ AZ:"Fəaliyyət", TR:"Faaliyet", RU:"Мероприятие", EN:"Intervention" },
  });
  const KIND_LBL = { causes:"adm_cc_kind_c", goals:"adm_cc_kind_g", acts:"adm_cc_kind_a" };
  const CCU = { view:"list", q:"", st:"", grp:"", sc:"icu", pq:"", pf:"", add:null, to:"" };
  const ccT = (key, vals) => Object.entries(vals || {}).reduce((s, [k, v]) => s.split("{" + k + "}").join(v), H.t(key));
  // kapsam seçici: hazır kümeler + tek birim; listede olmayan özel küme ayrı seçenek olarak görünür
  const SC_PRESETS = [["", "cp_sc_all"], ["YB", "adm_cc_ps_yb"], ["EYB", "adm_cc_ps_eyb"], ["-YD", "adm_cc_ps_notnn"], ["SERVIS", "adm_cc_ps_ward"]];
  const scKey = (u) => { const CC = H.careCatalog; if (!u || !u.length || u.length >= CC.scopes.length) return "";
    const same = (a, b) => a.length === b.length && a.every(x => b.includes(x)); const pr = SC_PRESETS.find(([k]) => k && same(CC.scList(k), u)); return pr ? pr[0] : u.join(","); };
  const scSelect = (attr, u, title) => { const CC = H.careCatalog, cur = scKey(u), opts = [...SC_PRESETS.map(([k, l]) => [k, H.t(l)]), ...CC.scopes.map(s => [s, CC.scopeName(s)])];
    if (!opts.some(([k]) => k === cur)) opts.push([cur, CC.scopesText(u)]);
    return `<select ${attr} title="${esc(title || "")}" style="width:auto;max-width:210px">${opts.map(([k, l]) => `<option value="${esc(k)}"${k === cur ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`; };
  const scFrom = (v) => v ? H.careCatalog.scList(v) : null;

  function tabCareCat(body) {
    const CC = H.careCatalog;
    if (!CC) { body.innerHTML = `<div class="empty">${H.t("adm_cc_nomod")}</div>`; return; }
    const redraw = () => tabCareCat(body);
    const base = () => CC.draft || CC.master;
    const act = (L) => L.filter(x => !x.off).length;
    const cur = CC.versions[CC.versions.length - 1];
    const L = base(), pv = CC.importPreview(), pbv = CC.plansByVersion();
    const nSt = (s) => L.filter(m => CC.status(m) === s).length;
    const onV = pbv[CC.version] || 0, oldV = Object.entries(pbv).filter(([v]) => +v < CC.version).reduce((a, [, n]) => a + n, 0);
    const stTag = (s) => s === "hospital" ? `<span class="tag">${H.t("adm_cc_st_hospital")}</span>` : s === "starter" ? `<span class="tag w" style="white-space:normal">${H.t("adm_cc_st_starter")}</span>`
      : s === "pending" ? `<span class="tag w">${H.t("adm_cc_st_pending")}</span>` : `<span class="tag" style="opacity:.6">${H.t("adm_cc_st_passive")}</span>`;
    const nProp = CC.proposals.filter(x => x.state === "pending").length;
    const head = `<div class="box" style="margin-bottom:12px"><div class="adm-row" style="justify-content:space-between;align-items:flex-start">
        <div style="min-width:0;flex:1 1 320px"><div>${ccT("adm_cc_pub_tpl", { v:cur.v, at:esc(cur.at), by:esc(uname(cur.by)) })}</div>
          <div class="adm-sub" style="margin-top:3px">${ccT("adm_cc_counts2_tpl", { n:L.length, h:nSt("hospital"), s:nSt("starter"), p:nSt("pending"), x:nSt("passive") })}</div>
          <div class="adm-sub">${ccT("adm_cc_plans_tpl", { a:onV, b:oldV })}</div></div>
        <div class="adm-row"><a class="btn" href="../bakim-katalogu-sablonu.xlsx" download="bakim-katalogu-sablonu.xlsx" data-cc-dl>${I("file")}${H.t("adm_cc_xl_dl")}</a>
          <button class="btn" data-cc="xlsx">${I("chart")}${H.t("adm_cc_xl_imp")}</button>
          <button class="btn g" data-cc="import">${I("plug")}${H.t("adm_cc_import")}</button></div></div>
      ${CC.draft ? `<div class="note" style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="flex:1 1 240px">${ccT("adm_cc_draft_tpl", { n:CC.draftN, v:CC.version })}</span>
          <button class="btn g sm" data-cc="discard">${H.t("adm_cc_discard")}</button><button class="btn p sm" data-cc="publish">${I("ok")}${ccT("adm_cc_publish_tpl", { v:CC.version + 1 })}</button></div>` : ""}
      ${H.adminNote(H.t("adm_cc_adm_note"), "div")}</div>
      <div class="seg" data-cc-view style="margin-bottom:12px;flex-wrap:wrap">${[["list", H.t("adm_cc_v_list")], ["pkg", H.t("adm_cc_v_pkg")], ["prop", ccT("adm_cc_v_prop_tpl", { n:nProp })], ["rules", H.t("adm_cc_v_rules")], ["hist", H.t("adm_cc_v_hist")]].map(([k, l]) => `<button type="button" data-v="${k}" class="${CCU.view === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;

    let view = "";
    if (CCU.view === "list") {
      const groups = [...new Set(L.map(m => m.group))].sort((a, b) => a.localeCompare(b, "tr"));
      const q = CC.normName(CCU.q);
      const rows = L.filter(m => (!q || CC.normName(m.name).includes(q) || (m.was && CC.normName(m.was).includes(q))) && (!CCU.st || CC.status(m) === CCU.st) && (!CCU.grp || m.group === CCU.grp))
        .slice().sort((a, b) => a.name.localeCompare(b.name, "tr"));
      view = `<div class="adm-bar"><input data-cc-q placeholder="${esc(H.t("adm_cc_search"))}" value="${esc(CCU.q)}">
          <select data-cc-st>${[["", "adm_cc_all_st"], ["hospital", "adm_cc_st_hospital"], ["starter", "adm_cc_st_starter"], ["pending", "adm_cc_st_pending"], ["passive", "adm_cc_st_passive"]].map(([k, l]) => `<option value="${k}"${CCU.st === k ? " selected" : ""}>${esc(H.t(l))}</option>`).join("")}</select>
          <select data-cc-grp><option value="">${esc(H.t("adm_cc_all_grp"))}</option>${groups.map(g => `<option value="${esc(g)}"${CCU.grp === g ? " selected" : ""}>${esc(g)}</option>`).join("")}</select></div>
        ${rows.length ? `<div class="tw"><table class="t"><thead><tr><th>${H.t("adm_cc_th_name")}</th><th>${H.t("adm_cc_th_grp")}</th><th>${H.t("adm_cc_th_units")}</th><th style="text-align:right">${H.t("adm_cc_th_c")}</th><th style="text-align:right">${H.t("adm_cc_th_g")}</th><th style="text-align:right">${H.t("adm_cc_th_a")}</th><th>${H.t("adm_cc_th_st")}</th><th>${H.t("adm_cc_th_ch")}</th><th></th></tr></thead><tbody>
          ${rows.map(m => `<tr class="row" data-cc-open="${esc(m.key)}" style="cursor:pointer"><td style="min-width:220px"><b>${esc(m.name)}</b><div class="adm-sub">${m.hbys ? H.t("adm_cc_src_hbys") : H.t("adm_cc_src_local")}${m.was ? ` · ${esc(ccT("adm_cc_was_tpl", { n:m.was }))}` : ""}</div></td>
            <td class="adm-sub">${esc(m.group)}</td><td class="adm-sub" style="min-width:120px;max-width:190px">${esc(CC.scopesText(m.units))}</td><td class="mono" style="text-align:right">${act(m.causes)}</td><td class="mono" style="text-align:right">${act(m.goals)}</td><td class="mono" style="text-align:right">${act(m.acts)}</td>
            <td style="max-width:210px">${stTag(CC.status(m))}</td><td class="adm-sub mono" style="white-space:nowrap">${esc(m.changed)}<div>${esc(m.by)}</div></td>
            <td><button class="btn g sm" data-cc-open="${esc(m.key)}">${I("edit")}${H.t("adm_cc_open")}</button></td></tr>`).join("")}</tbody></table></div>`
          : `<div class="empty">${H.t("adm_cc_none")}</div>`}`;
    } else if (CCU.view === "pkg") {
      /* Birim paketleri: solda kapsamlar (bağlı birimlerle), sağda o birimde görünen tanılar + sık kullanılan + birime özgü madde */
      const sc = CC.scopes.includes(CCU.sc) ? CCU.sc : "icu", K = CC.packages[sc], act2 = L.filter(m => !m.passive);
      const uNames = (s) => CC.unitsOf(s).map(u => u.tr).join(", ");
      const left = CC.scopes.map(s => `<div class="adm-tn ${s === sc ? "on" : ""}" data-ccp-sc="${s}">${I("building")}<span class="nm" style="white-space:normal">${esc(CC.scopeName(s))}<small class="adm-sub" style="display:block;font-weight:500">${esc(uNames(s) || H.t("adm_cc_p_nounit"))}</small></span><span class="c">${act2.filter(m => CC.visibleIn(m.key, s)).length}</span></div>`).join("");
      const q = CC.normName(CCU.pq);
      const rowsP = act2.filter(m => (!q || CC.normName(m.name).includes(q)) && (!CCU.pf || (CCU.pf === "on" ? CC.visibleIn(m.key, sc) : CCU.pf === "off" ? !CC.visibleIn(m.key, sc) : K.favs.includes(m.key))))
        .slice().sort((a, b) => (K.favs.includes(b.key) - K.favs.includes(a.key)) || (CC.visibleIn(b.key, sc) - CC.visibleIn(a.key, sc)) || a.name.localeCompare(b.name, "tr"));
      const vis = act2.filter(m => CC.visibleIn(m.key, sc)), own = vis.reduce((a, m) => a + CC.rowsIn(m, sc).own, 0);
      const A = CCU.add;
      const addForm = A ? `<div class="box" style="margin-top:10px;background:var(--card2)"><div class="adm-row">
          <select data-ccp-ak style="flex:1 1 220px;min-width:0">${vis.slice().sort((a, b) => a.name.localeCompare(b.name, "tr")).map(m => `<option value="${esc(m.key)}"${A.key === m.key ? " selected" : ""}>${esc(m.name)}</option>`).join("")}</select>
          <select data-ccp-akind style="width:auto">${["causes", "goals", "acts"].map(k => `<option value="${k}"${A.kind === k ? " selected" : ""}>${esc(H.t(KIND_LBL[k]))}</option>`).join("")}</select>
          ${A.kind === "acts" ? `<select data-ccp-af style="width:auto">${CC.freqs.map(f => `<option value="${f}"${A.f === f ? " selected" : ""}>${esc(CC.freqName(f))}</option>`).join("")}</select>` : ""}</div>
        <div class="adm-row" style="margin-top:8px"><input data-ccp-at value="${esc(A.t)}" placeholder="${esc(H.t("adm_cc_p_add_ph"))}" style="flex:1 1 260px;min-width:0">
          <button type="button" class="btn g sm" data-ccp="addx">${H.t("adm_cc_cancel")}</button><button type="button" class="btn p sm" data-ccp="addok">${I("plus")}${H.t("adm_cc_add")}</button></div></div>` : "";
      view = `<div class="adm-split"><div class="box" style="padding:8px">${left}</div><div style="min-width:0">
        <div class="box"><h5>${esc(CC.scopeName(sc))} <span class="r adm-sub">${esc(uNames(sc) || H.t("adm_cc_p_nounit"))}</span></h5>
          <div class="adm-sub">${ccT("adm_cc_p_head_tpl", { v:vis.length, f:K.favs.filter(k => CC.visibleIn(k, sc)).length, o:own })}</div>
          <div class="adm-row" style="margin-top:10px"><button type="button" class="btn sm" data-ccp="add">${I("plus")}${H.t("adm_cc_p_add")}</button>
            <span class="adm-row" style="margin-left:auto;gap:6px"><select data-ccp-to title="${esc(H.t("adm_cc_p_copy_to"))}" style="width:auto">${CC.scopes.filter(s => s !== sc).map(s => `<option value="${s}"${CCU.to === s ? " selected" : ""}>${esc(CC.scopeName(s))}</option>`).join("")}</select>
            <button type="button" class="btn sm" data-ccp="copy">${I("swap")}${H.t("adm_cc_p_copy")}</button></span></div>
          ${addForm}
          <p class="adm-sub" style="margin:10px 0 0">${H.t("adm_cc_p_note")}</p></div>
        <div class="adm-bar" style="margin-top:12px"><input data-ccp-q placeholder="${esc(H.t("adm_cc_search"))}" value="${esc(CCU.pq)}">
          <select data-ccp-f>${[["", "adm_cc_p_f_all"], ["on", "adm_cc_p_f_on"], ["off", "adm_cc_p_f_off"], ["fav", "adm_cc_p_f_fav"]].map(([k, l]) => `<option value="${k}"${CCU.pf === k ? " selected" : ""}>${esc(H.t(l))}</option>`).join("")}</select></div>
        <div class="tw"><table class="t"><thead><tr><th>${H.t("adm_cc_th_name")}</th><th style="text-align:center">${H.t("adm_cc_p_visible")}</th><th style="text-align:center">${H.t("adm_cc_p_fav")}</th><th style="text-align:right">${H.t("adm_cc_p_rows")}</th><th style="text-align:right">${H.t("adm_cc_p_own")}</th><th>${H.t("adm_cc_th_st")}</th></tr></thead><tbody>
          ${rowsP.map(m => { const on = CC.visibleIn(m.key, sc), r = CC.rowsIn(m, sc);
            return `<tr${on ? "" : ' style="opacity:.6"'}><td style="min-width:200px"><a data-cc-open="${esc(m.key)}" style="cursor:pointer;font-weight:700">${esc(m.name)}</a><div class="adm-sub">${esc(m.group)} · ${esc(CC.scopesText(m.units))}</div></td>
              <td style="text-align:center"><input type="checkbox" class="ck" data-ccp-vis="${esc(m.key)}"${on ? " checked" : ""} aria-label="${esc(H.t("adm_cc_p_visible"))}"></td>
              <td style="text-align:center"><input type="checkbox" class="ck" data-ccp-fav="${esc(m.key)}"${K.favs.includes(m.key) ? " checked" : ""}${on ? "" : " disabled"} aria-label="${esc(H.t("adm_cc_p_fav"))}"></td>
              <td class="mono" style="text-align:right;white-space:nowrap">${r.c} · ${r.g} · ${r.a}</td><td class="mono" style="text-align:right">${r.own || "—"}</td><td style="max-width:200px">${stTag(CC.status(m))}</td></tr>`; }).join("")}</tbody></table></div></div></div>`;
    } else if (CCU.view === "prop") {
      const P = CC.proposals, pend = P.filter(x => x.state === "pending"), done = P.filter(x => x.state !== "pending");
      const dxName = (k) => (L.find(m => m.key === k) || {}).name || k;
      const item = (x) => `${esc(x.t)}<div class="adm-sub">${esc(H.t(KIND_LBL[x.kind]))}${x.f ? ` · ${esc(CC.freqName(x.f))}` : ""}</div>`;
      view = `${pend.length ? `<div class="tw"><table class="t"><thead><tr><th>${H.t("adm_cc_q_th_at")}</th><th>${H.t("adm_cc_q_th_by")}</th><th>${H.t("adm_cc_q_th_unit")}</th><th>${H.t("adm_cc_q_th_dx")}</th><th>${H.t("adm_cc_q_th_item")}</th><th></th></tr></thead><tbody>
          ${pend.map(x => `<tr><td class="mono adm-sub" style="white-space:nowrap">${esc(x.at)}</td><td>${esc(uname(x.by))}</td><td>${esc(CC.scopeName(x.sc))}</td><td><b>${esc(dxName(x.key))}</b></td><td style="min-width:240px">${item(x)}</td>
            <td><span class="adm-row" style="flex-wrap:nowrap;gap:6px"><button class="btn g sm" data-ccq-no="${esc(x.id)}">${I("x")}${H.t("adm_cc_q_no")}</button><button class="btn p sm" data-ccq-ok="${esc(x.id)}">${I("ok")}${H.t("adm_cc_q_ok")}</button></span></td></tr>`).join("")}</tbody></table></div>`
          : `<div class="empty">${H.t("adm_cc_q_none")}</div>`}
        ${done.length ? `<div class="box" style="margin-top:12px"><h5>${H.t("adm_cc_q_done")}</h5>${done.map(x => `<div class="kv"><span>${esc(dxName(x.key))} · ${esc(x.t)} <span class="adm-sub">· ${esc(CC.scopeName(x.sc))} · ${esc(uname(x.by))}</span></span><b class="adm-sub">${H.t(x.state === "approved" ? "adm_cc_q_approved" : "adm_cc_q_rejected")} · ${esc(x.dec ? x.dec.at : "")}</b></div>`).join("")}</div>` : ""}
        <p class="adm-sub" style="margin-top:10px">${H.t("adm_cc_q_foot")}</p>`;
    } else if (CCU.view === "rules") {
      const pts = H.data.patients.filter(p => H.inScope ? H.inScope(p.id) : true);
      const dxOpts = (sel) => base().filter(m => !m.passive).slice().sort((a, b) => a.name.localeCompare(b.name, "tr")).map(m => `<option value="${esc(m.key)}"${m.key === sel ? " selected" : ""}>${esc(m.name)}</option>`).join("");
      const cond = (r, i) => { const F = CC.fields[r.f] || {};
        if (F.kind === "bool") return `<span class="adm-sub">${H.t("cp_yes")}</span>`;
        if (F.kind === "lvl") return `<select data-cc-rv="${i}">${CC.levels.map(v => `<option value="${v}"${r.v === v ? " selected" : ""}>${esc(CC.levelName(v))}</option>`).join("")}</select>`;
        return `<span class="adm-row" style="gap:6px;flex-wrap:nowrap"><b class="mono">${F.op === "<=" ? "≤" : "≥"}</b><input class="adm-num" type="number" step="0.1" data-cc-rv="${i}" value="${esc(r.v)}"></span>`; };
      view = `<div class="tw"><table class="t"><thead><tr><th>${H.t("adm_cc_r_on")}</th><th>${H.t("adm_cc_r_field")}</th><th>${H.t("adm_cc_r_cond")}</th><th>${H.t("adm_cc_r_dx")}</th><th style="text-align:right">${H.t("adm_cc_r_now")}</th><th></th></tr></thead><tbody>
          ${CC.rules.map((r, i) => `<tr><td><input type="checkbox" class="ck" data-cc-ron="${i}"${r.on ? " checked" : ""}></td>
            <td><select data-cc-rf="${i}">${Object.keys(CC.fields).map(f => `<option value="${f}"${r.f === f ? " selected" : ""}>${esc(CC.fieldName(f))}</option>`).join("")}</select></td>
            <td>${cond(r, i)}</td><td><select data-cc-rk="${i}" style="min-width:200px">${dxOpts(r.key)}</select></td>
            <td class="mono" style="text-align:right">${pts.filter(p => CC.hits(r, p)).length}</td>
            <td><button class="btn g sm" data-cc-rdel="${i}" title="${esc(H.t("adm_cc_del"))}">${I("trash")}</button></td></tr>`).join("")}</tbody></table></div>
        <div class="adm-row" style="margin-top:10px"><button class="btn" data-cc="radd">${I("plus")}${H.t("adm_cc_r_add")}</button></div>
        <p class="adm-sub" style="margin-top:10px">${H.t("adm_cc_r_foot")}</p>${H.adminNote(H.t("adm_cc_r_adm"), "div")}`;
    } else {
      view = `<div class="tw"><table class="t"><thead><tr><th>${H.t("adm_cc_th_v")}</th><th>${H.t("adm_cc_th_at")}</th><th>${H.t("adm_cc_th_by")}</th><th>${H.t("adm_cc_th_kind")}</th><th>${H.t("adm_cc_th_n")}</th><th style="text-align:right">${H.t("adm_cc_th_plans")}</th></tr></thead><tbody>
          ${CC.versions.slice().reverse().map(v => `<tr><td class="mono"><b>v${v.v}</b>${v.v === CC.version ? ` <span class="tag">${H.t("adm_cc_current")}</span>` : ""}</td><td class="mono adm-sub" style="white-space:nowrap">${esc(v.at)}</td>
            <td>${esc(uname(v.by))}<div class="adm-sub mono">${esc(v.by)}</div></td><td>${H.t("adm_cc_k_" + v.kind)}</td>
            <td>${esc(ccT("adm_cc_n_tpl", { n:v.add + v.change }))}<div class="adm-sub">${[v.add ? ccT("adm_cc_n_add_tpl", { a:v.add }) : "", v.change ? ccT("adm_cc_n_ch_tpl", { c:v.change }) : ""].filter(Boolean).join(" · ")}</div></td>
            <td class="mono" style="text-align:right">${pbv[v.v] || 0}</td></tr>`).join("")}</tbody></table></div>
        <p class="adm-sub" style="margin-top:10px">${H.t("adm_cc_pv_note")}</p>`;
    }
    body.innerHTML = head + view;

    const logRule = (r, what) => { H.log("Bakım kataloğu: önerme kuralı", `${CC.fieldName(r.f)} → ${(base().find(m => m.key === r.key) || {}).name || r.key} · ${what}`); H.toast(ccT("adm_cc_r_toast_tpl", { x:what })); };
    body.oninput = (e) => { if (e.target.matches("[data-cc-q]")) { CCU.q = e.target.value; const pos = e.target.selectionStart; redraw(); const i = body.querySelector("[data-cc-q]"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
      if (e.target.matches("[data-ccp-q]")) { CCU.pq = e.target.value; const pos = e.target.selectionStart; redraw(); const i = body.querySelector("[data-ccp-q]"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
      if (e.target.matches("[data-ccp-at]") && CCU.add) CCU.add.t = e.target.value; };
    body.onchange = (e) => {
      const T = e.target;
      if (T.matches("[data-ccp-f]")) { CCU.pf = T.value; redraw(); return; }
      if (T.matches("[data-ccp-to]")) { CCU.to = T.value; return; }
      if (T.matches("[data-ccp-ak]")) { CCU.add.key = T.value; return; }
      if (T.matches("[data-ccp-akind]")) { CCU.add.kind = T.value; redraw(); return; }
      if (T.matches("[data-ccp-af]")) { CCU.add.f = T.value; return; }
      const sc = CCU.sc, scN = CC.scopeName(sc);
      if (T.matches("[data-ccp-vis]")) { const k = T.dataset.ccpVis, m = base().find(x => x.key === k); CC.setVisible(k, sc, T.checked); if (!T.checked) CC.setFav(k, sc, false);
        H.log("Bakım kataloğu: birim paketi", `${scN} · ${m ? m.name : k} · ${T.checked ? "görünür" : "gizli"}`);
        H.toast(ccT("adm_cc_p_toast_vis_tpl", { d:m ? m.name : k, u:scN, s:H.t(T.checked ? "adm_cc_p_shown" : "adm_cc_p_hidden") })); redraw(); return; }
      if (T.matches("[data-ccp-fav]")) { const k = T.dataset.ccpFav, m = base().find(x => x.key === k); CC.setFav(k, sc, T.checked);
        H.log("Bakım kataloğu: birim paketi", `${scN} · ${m ? m.name : k} · sık kullanılan ${T.checked ? "eklendi" : "çıkarıldı"}`); redraw(); return; }
      if (T.matches("[data-cc-st]")) { CCU.st = T.value; redraw(); return; }
      if (T.matches("[data-cc-grp]")) { CCU.grp = T.value; redraw(); return; }
      const on = T.dataset.ccRon, rf = T.dataset.ccRf, rv = T.dataset.ccRv, rk = T.dataset.ccRk;
      if (on != null) { const r = CC.rules[+on]; r.on = T.checked; logRule(r, T.checked ? "açık" : "kapalı"); redraw(); return; }
      if (rf != null) { const r = CC.rules[+rf], F = CC.fields[T.value]; r.f = T.value; r.v = F.kind === "lvl" ? "orta" : F.kind === "num" ? (r.v != null && !isNaN(+r.v) ? +r.v : 0) : undefined; logRule(r, "veri: " + T.value); redraw(); return; }
      if (rv != null) { const r = CC.rules[+rv]; const F = CC.fields[r.f]; if (F.kind === "num") { const n = parseFloat(String(T.value).replace(",", ".")); if (isNaN(n)) { H.toast(H.t("adm_cc_toast_nochange"), "w"); redraw(); return; } r.v = n; } else r.v = T.value; logRule(r, "eşik: " + r.v); redraw(); return; }
      if (rk != null) { const r = CC.rules[+rk]; r.key = T.value; logRule(r, "tanı: " + T.value); redraw(); return; }
    };
    body.onclick = (e) => {
      const T = e.target;
      const v = T.closest("[data-cc-view] button"); if (v) { CCU.view = v.dataset.v; redraw(); return; }
      if (T.closest("[data-cc-dl]")) { H.log("Bakım kataloğu: Excel şablonu indirildi", "bakim-katalogu-sablonu.xlsx"); H.toast(H.t("adm_cc_xl_dl_log")); return; }
      const ps = T.closest("[data-ccp-sc]"); if (ps) { CCU.sc = ps.dataset.ccpSc; CCU.add = null; CCU.to = ""; redraw(); return; }
      const qo = T.closest("[data-ccq-ok],[data-ccq-no]"); if (qo) { const ok = !!qo.dataset.ccqOk, pr = CC.decide(qo.dataset.ccqOk || qo.dataset.ccqNo, ok, H.state.user.u);
        if (pr) { H.log(`Bakım kataloğu: birim önerisi ${ok ? "onaylandı (taslak)" : "reddedildi"}`, `${CC.scopeName(pr.sc)} · ${(base().find(m => m.key === pr.key) || {}).name || pr.key} · ${pr.t}`); H.toast(H.t(ok ? "adm_cc_q_toast_ok" : "adm_cc_q_toast_no")); }
        redraw(); return; }
      const pa = T.closest("[data-ccp]"); if (pa) { const k = pa.dataset.ccp, sc = CC.scopes.includes(CCU.sc) ? CCU.sc : "icu";
        if (k === "add") { const first = base().filter(m => !m.passive && CC.visibleIn(m.key, sc)).sort((a, b) => a.name.localeCompare(b.name, "tr"))[0]; CCU.add = { key:first ? first.key : "", kind:"acts", t:"", f:"shift" }; redraw(); const i = body.querySelector("[data-ccp-at]"); if (i) i.focus(); return; }
        if (k === "addx") { CCU.add = null; redraw(); return; }
        if (k === "addok") { const A = CCU.add, t = (A.t || "").trim(); if (!t) { H.toast(H.t("cp_prop_empty"), "w"); return; }
          CC.addRow(A.key, A.kind, t, A.f, sc, H.state.user.u); H.log("Bakım kataloğu: birime özgü madde (taslak)", `${CC.scopeName(sc)} · ${(base().find(m => m.key === A.key) || {}).name} · ${t}`);
          CCU.add = null; H.toast(H.t("adm_cc_p_toast_add")); redraw(); return; }
        if (k === "copy") { const to = CCU.to || CC.scopes.find(s => s !== sc);
          // hedef paketin sık kullanılanları ve görünürlük ayarları değişir → önce onay
          H.modal({ title:esc(H.t("adm_cc_p_copy")), body:`<p>${esc(ccT("adm_cc_p_copy_q_tpl", { a:CC.scopeName(sc), b:CC.scopeName(to) }))}</p>`,
            actions:`<button class="btn g" data-x>${H.t("adm_cc_cancel")}</button><button class="btn p" data-ccp-cok>${I("swap")}${H.t("adm_cc_p_copy")}</button>`,
            onMount(mm) { mm.querySelector("[data-ccp-cok]").onclick = () => { const n = CC.copyPackage(sc, to);
              H.log("Bakım kataloğu: birim paketi kopyalandı", `${CC.scopeName(sc)} → ${CC.scopeName(to)} · ${n} madde taslakta`);
              H.closeModal(); H.toast(ccT("adm_cc_p_toast_copy_tpl", { a:CC.scopeName(sc), b:CC.scopeName(to), n })); CCU.sc = to; redraw(); }; } });
          return; } }
      const del = T.closest("[data-cc-rdel]"); if (del) { const r = CC.rules.splice(+del.dataset.ccRdel, 1)[0]; H.log("Bakım kataloğu: önerme kuralı silindi", `${CC.fieldName(r.f)} → ${r.key}`); H.toast(H.t("adm_cc_r_del_toast")); redraw(); return; }
      const op = T.closest("[data-cc-open]"); if (op && !T.closest("select,input")) { ccItemModal(op.dataset.ccOpen, redraw); return; }
      const a = T.closest("[data-cc]"); if (!a) return;
      const k = a.dataset.cc;
      if (k === "import") ccImportModal(redraw);
      else if (k === "xlsx") ccXlsxModal(redraw);
      else if (k === "discard") { CC.discard(); H.log("Bakım kataloğu: taslak atıldı", ""); H.toast(H.t("adm_cc_toast_discard")); redraw(); }
      else if (k === "publish") { const n = CC.draftN, vv = CC.publish(H.state.user.u, "edit"); H.log("Bakım kataloğu yayımlandı", `v${vv} · ${n} değişiklik`); H.toast(ccT("adm_cc_toast_pub_tpl", { v:vv })); redraw(); }
      else if (k === "radd") { const key = (base().find(m => m.key === "dusme") || base()[0]).key; const r = { id:"r" + Date.now(), f:"age", v:65, key, on:false }; CC.rules.push(r); logRule(r, "eklendi (kapalı)"); redraw(); }
    };
  }

  /* tanıyı aç: neden / hedef / faaliyet listelerini düzenle (ekle, sil, sırala, pasif yap); faaliyetin varsayılan sıklığı */
  function ccItemModal(key, redraw) {
    const CC = H.careCatalog, src = (CC.draft || CC.master).find(m => m.key === key); if (!src) return;
    const W = JSON.parse(JSON.stringify(src));
    const SECS = [["causes", "cp_h_causes"], ["goals", "cp_h_goals"], ["acts", "cp_h_acts"]];
    const groups = [...new Set((CC.draft || CC.master).map(m => m.group))].sort((a, b) => a.localeCompare(b, "tr"));
    const secHtml = (sec, lbl) => { const L = W[sec];
      return `<div class="box" style="margin-top:10px"><h5>${H.t(lbl)} <span class="r adm-sub mono">${L.filter(x => !x.off).length}/${L.length}</span></h5>
        ${L.length ? L.map((x, i) => `<div class="adm-row" style="padding:5px 0;border-bottom:1px dashed var(--line);align-items:flex-start;flex-wrap:wrap${x.off ? ";opacity:.55" : ""}">
            <input data-ccm-t="${sec}|${i}" value="${esc(x.t)}" style="flex:1 1 260px;min-width:0">
            ${sec === "acts" ? `<select data-ccm-f="${i}" title="${esc(H.t("adm_cc_def_freq"))}" style="width:auto">${CC.freqs.map(f => `<option value="${f}"${(x.f || "shift") === f ? " selected" : ""}>${esc(CC.freqName(f))}</option>`).join("")}</select>` : ""}
            ${scSelect(`data-ccm-u="${sec}|${i}"`, x.u, H.t("adm_cc_row_units"))}
            <span class="adm-row" style="gap:2px;flex-wrap:nowrap">
              <button type="button" class="btn g sm" data-ccm-mv="${sec}|${i}|-1" title="${esc(H.t("adm_cc_up"))}"${i === 0 ? " disabled" : ""}>↑</button>
              <button type="button" class="btn g sm" data-ccm-mv="${sec}|${i}|1" title="${esc(H.t("adm_cc_down"))}"${i === L.length - 1 ? " disabled" : ""}>↓</button>
              <label class="adm-chk" style="margin:0 6px;font-size:12px"><input type="checkbox" class="ck" data-ccm-off="${sec}|${i}"${x.off ? " checked" : ""}>${H.t("adm_cc_row_off")}</label>
              <button type="button" class="btn g sm" data-ccm-del="${sec}|${i}" title="${esc(H.t("adm_cc_del"))}">${I("trash")}</button></span></div>`).join("")
          : `<div class="adm-sub">${H.t("adm_cc_empty_sec")}</div>`}
        <div class="adm-row" style="margin-top:8px"><input data-ccm-new="${sec}" placeholder="${esc(H.t("adm_cc_add_row"))}" style="flex:1 1 220px;min-width:0"><button type="button" class="btn sm" data-ccm-add="${sec}">${I("plus")}${H.t("adm_cc_add")}</button></div></div>`; };
    const bodyHtml = () => `<div class="fld col"><label>${H.t("adm_cc_th_name")}</label><input data-ccm-name value="${esc(W.name)}">${W.was ? `<div class="adm-sub" style="margin-top:4px">${esc(ccT("adm_cc_was_tpl", { n:W.was }))}</div>` : ""}</div>
      <div class="adm-row"><div class="fld col" style="flex:1 1 200px;margin:0"><label>${H.t("adm_cc_th_grp")}</label><select data-ccm-grp>${groups.map(g => `<option${g === W.group ? " selected" : ""}>${esc(g)}</option>`).join("")}</select></div>
        <div style="flex:1 1 260px"><span class="adm-sub">${W.hbys ? H.t("adm_cc_src_hbys") : H.t("adm_cc_src_local")}</span>
          <label class="adm-chk"><input type="checkbox" class="ck" data-ccm-passive${W.passive ? " checked" : ""}>${H.t("adm_cc_passive_lbl")}</label></div></div>
      <div class="adm-row"><div class="fld col" style="flex:1 1 200px;margin:0"><label>${H.t("adm_cc_units_lbl")}</label>${scSelect("data-ccm-units", W.units)}</div>
        <div class="fld col" style="flex:1 1 260px;margin:0"><label>${H.t("adm_cc_src_lbl")}</label><select data-ccm-src>${[["hastane", "adm_cc_st_hospital"], ["baslangic", "adm_cc_st_starter"]].map(([k, l]) => `<option value="${k}"${(W.src || "baslangic") === k ? " selected" : ""}>${esc(H.t(l))}</option>`).join("")}</select></div></div>
      ${SECS.map(([s, l]) => secHtml(s, l)).join("")}`;
    const m = H.modal({ title:esc(ccT("adm_cc_m_edit_tpl", { n:src.name })), wide:true, body:bodyHtml(),
      actions:`<button class="btn g" data-x>${H.t("adm_cc_cancel")}</button><button class="btn p" data-ccm-ok>${I("ok")}${H.t("adm_cc_to_draft")}</button>` });
    const mb = m.querySelector(".mb"), re = () => { const st = m.scrollTop; mb.innerHTML = bodyHtml(); m.scrollTop = st; };
    const sync = () => { mb.querySelectorAll("[data-ccm-t]").forEach(inp => { const [s, i] = inp.dataset.ccmT.split("|"); if (W[s][+i]) W[s][+i].t = inp.value; });
      const n = mb.querySelector("[data-ccm-name]"); if (n) W.name = n.value; };
    m.addEventListener("change", (e) => { const T = e.target;
      if (T.matches("[data-ccm-f]")) W.acts[+T.dataset.ccmF].f = T.value;
      else if (T.matches("[data-ccm-off]")) { sync(); const [s, i] = T.dataset.ccmOff.split("|"); W[s][+i].off = T.checked; re(); }
      else if (T.matches("[data-ccm-grp]")) W.group = T.value;
      else if (T.matches("[data-ccm-u]")) { const [s, i] = T.dataset.ccmU.split("|"); W[s][+i].u = scFrom(T.value); }
      else if (T.matches("[data-ccm-units]")) W.units = scFrom(T.value);
      else if (T.matches("[data-ccm-src]")) W.src = T.value;
      else if (T.matches("[data-ccm-passive]")) W.passive = T.checked; });
    m.addEventListener("click", (e) => { const T = e.target;
      const mv = T.closest("[data-ccm-mv]"); if (mv) { sync(); const [s, i, d] = mv.dataset.ccmMv.split("|"), a = +i, b = a + +d, L = W[s]; if (b < 0 || b >= L.length) return; [L[a], L[b]] = [L[b], L[a]]; re(); return; }
      const del = T.closest("[data-ccm-del]"); if (del) { sync(); const [s, i] = del.dataset.ccmDel.split("|"); W[s].splice(+i, 1); re(); return; }
      const add = T.closest("[data-ccm-add]"); if (add) { sync(); const s = add.dataset.ccmAdd, inp = mb.querySelector(`[data-ccm-new="${s}"]`), t = (inp.value || "").trim(); if (!t) return;
        W[s].push(s === "acts" ? { t, l:null, f:"shift", off:false, u:null } : { t, off:false, u:null }); re(); const ni = mb.querySelector(`[data-ccm-new="${s}"]`); if (ni) ni.focus(); return; }
      if (T.closest("[data-ccm-ok]")) { sync(); W.name = W.name.trim() || src.name;
        const strip = (x) => JSON.stringify(Object.assign({}, x, { changed:null, by:null }));
        if (strip(W) === strip(src)) { H.closeModal(); H.toast(H.t("adm_cc_toast_nochange")); return; }
        // değişiklik sayısı: ad/grup/pasif + her listede eklenen, silinen, değişen ya da yeri değişen satır
        let c = (W.name !== src.name) + (W.group !== src.group) + (W.passive !== src.passive) + (JSON.stringify(W.units || null) !== JSON.stringify(src.units || null)) + (W.src !== src.src);
        SECS.forEach(([s]) => { const a = src[s], b = W[s], n = Math.max(a.length, b.length); for (let i = 0; i < n; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) c++; });
        const d = CC.edit(), ix = d.findIndex(x => x.key === key);
        if (W.name !== src.name && !W.was) W.was = src.name;
        W.changed = `${H.clockDate().toLocaleDateString("tr-TR")}`; W.by = H.state.user.u; d[ix] = W; CC.draftN += c;
        H.log("Bakım kataloğu: tanı düzenlendi (taslak)", `${W.name} · ${c} değişiklik`);
        H.closeModal(); H.toast(ccT("adm_cc_toast_draft_tpl", { n:W.name, c })); redraw(); } });
  }

  function ccImportModal(redraw) {
    const CC = H.careCatalog, pv = CC.importPreview(), n = pv.add.length + pv.change.length, withDraft = CC.draft ? CC.draftN : 0;
    const last = CC.versions.filter(v => v.kind === "import").pop();
    const tile = (lbl, v, cls) => `<div class="ac ${cls || "ok"}"><b>${v}</b><span>${lbl}</span></div>`;
    const list = (L, f) => L.length ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:12.5px;line-height:1.5">${L.slice(0, 12).map(f).join("")}${L.length > 12 ? `<li class="adm-sub">${esc(ccT("adm_cc_imp_more_tpl", { n:L.length - 12 }))}</li>` : ""}</ul>` : "";
    H.modal({ title:H.t("adm_cc_m_import"),
      body:`${last ? `<div class="adm-sub" style="margin-bottom:8px">${esc(ccT("adm_cc_imp_last_tpl", { v:last.v, at:last.at, by:uname(last.by) }))}</div>` : ""}<div class="att" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">${tile(H.t("adm_cc_imp_add"), pv.add.length, pv.add.length ? "" : "ok")}${tile(H.t("adm_cc_imp_change"), pv.change.length, pv.change.length ? "" : "ok")}${tile(H.t("adm_cc_imp_same"), pv.same)}${tile(H.t("adm_cc_imp_local"), pv.local)}</div>
        ${pv.add.length ? `<div class="box" style="margin-top:12px"><h5>${H.t("adm_cc_imp_add")}</h5>${list(pv.add, a => `<li>${esc(a.name)} <span class="adm-sub">· ${esc(a.group)}</span></li>`)}</div>` : ""}
        ${pv.change.length ? `<div class="box" style="margin-top:12px"><h5>${H.t("adm_cc_imp_change")}</h5>${list(pv.change, c => `<li>${esc(c.from)} → <b>${esc(c.to)}</b></li>`)}</div>` : ""}
        <div class="note i" style="margin-top:12px">${H.t("adm_cc_imp_what")}</div>
        ${n ? (withDraft ? `<div class="note" style="margin-top:8px">${esc(ccT("adm_cc_imp_draft_tpl", { n:withDraft }))}</div>` : "") : `<div class="note i" style="margin-top:8px">${H.t("adm_cc_imp_zero")}</div>`}`,
      actions:`<button class="btn g" data-x>${H.t(n ? "adm_cc_cancel" : "adm_cc_close")}</button>${n ? `<button class="btn p" data-cci-ok>${I("ok")}${ccT("adm_cc_imp_ok_tpl", { v:CC.version + 1 })}</button>` : ""}`,
      onMount(m) { const b = m.querySelector("[data-cci-ok]"); if (b) b.onclick = () => {
        const v = CC.importApply(H.state.user.u);
        H.log("Bakım kataloğu: hastane kaydından içe aktarıldı", `v${v} · ${pv.add.length} eklendi · ${pv.change.length} değişti · ${pv.same} aynı`);
        H.closeModal(); H.toast(ccT("adm_cc_toast_pub_tpl", { v })); redraw(); }; } });
  }

  /* Excel'den içe aktar: dosya seç → önizleme (toplam + birim bazında eklenecek / değişecek / aynı kalan / pasife alınacak)
   * → onay → sürüm +1 ve denetim kaydı. Şablon: ../bakim-katalogu-sablonu.xlsx (sütunlar: Tanı · Tür · Madde metni ·
   * Birimler · Varsayılan sıklık · Durum). Fark kümesi careplan.js'teki H.careCatalog.xlsxPreview()'dan gelir. */
  function ccXlsxModal(redraw) {
    const CC = H.careCatalog; let file = null;
    const tile = (lbl, v, cls) => `<div class="ac ${cls || "ok"}"><b>${v}</b><span>${lbl}</span></div>`;
    const dxName = (k) => ((CC.draft || CC.master).find(m => m.key === k) || {}).name || k;
    const li = (x, txt) => `<li>${esc(dxName(x.key))} · <span class="adm-sub">${esc(H.t(KIND_LBL[x.kind]))}</span> — ${txt}${x.u ? ` <span class="adm-sub">(${esc(CC.scopesText(x.u))})</span>` : ""}</li>`;
    const bodyHtml = () => { const pick = `<div class="note i">${H.t("adm_cc_x_pick")}</div>
        <div class="adm-row" style="margin-top:10px"><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-ccx-file style="flex:1 1 260px;min-width:0">
          <a class="btn g sm" href="../bakim-katalogu-sablonu.xlsx" download="bakim-katalogu-sablonu.xlsx">${I("file")}${H.t("adm_cc_xl_dl")}</a></div>`;
      if (!file) return pick;
      const pv = CC.xlsxPreview(), T = pv.tot, n = pv.add.length + pv.change.length + pv.off.length, withDraft = CC.draft ? CC.draftN : 0;
      const per = pv.per.filter(r => r.add || r.change || r.off || CC.unitsOf(r.sc).length);
      return pick + `<div class="adm-sub" style="margin:10px 0 8px">${esc(ccT("adm_cc_x_file_tpl", { f:file }))}</div>
        <div class="att" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">${tile(H.t("adm_cc_imp_add"), T.add, T.add ? "" : "ok")}${tile(H.t("adm_cc_imp_change"), T.change, T.change ? "" : "ok")}${tile(H.t("adm_cc_imp_same"), T.same)}${tile(H.t("adm_cc_x_off"), T.off, T.off ? "" : "ok")}</div>
        <div class="box" style="margin-top:12px"><h5>${H.t("adm_cc_x_per")}</h5><div class="tw"><table class="t"><thead><tr><th>${H.t("adm_cc_q_th_unit")}</th><th style="text-align:right">${H.t("adm_cc_imp_add")}</th><th style="text-align:right">${H.t("adm_cc_imp_change")}</th><th style="text-align:right">${H.t("adm_cc_imp_same")}</th><th style="text-align:right">${H.t("adm_cc_x_off")}</th></tr></thead><tbody>
          ${per.map(r => `<tr><td>${esc(CC.scopeName(r.sc))}<div class="adm-sub">${esc(CC.unitsOf(r.sc).map(u => u.tr).join(", ") || H.t("adm_cc_p_nounit"))}</div></td><td class="mono" style="text-align:right">${r.add || "—"}</td><td class="mono" style="text-align:right">${r.change || "—"}</td><td class="mono" style="text-align:right">${r.same}</td><td class="mono" style="text-align:right">${r.off || "—"}</td></tr>`).join("")}</tbody></table></div></div>
        ${n ? `<div class="box" style="margin-top:12px"><ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.55">
            ${pv.add.map(x => li(x, `<b>+</b> ${esc(x.t)}`)).join("")}${pv.change.map(x => li(x, `${esc(x.from)} → <b>${esc(x.to)}</b>`)).join("")}${pv.off.map(x => li(x, `<s>${esc(x.t)}</s> · ${esc(H.t("adm_cc_st_passive"))}`)).join("")}</ul></div>
          <div class="note i" style="margin-top:10px">${H.t("adm_cc_x_src")} ${H.t("adm_cc_pv_note")}</div>${withDraft ? `<div class="note" style="margin-top:8px">${esc(ccT("adm_cc_imp_draft_tpl", { n:withDraft }))}</div>` : ""}`
          : `<div class="note i" style="margin-top:10px">${H.t("adm_cc_x_zero")}</div>`}`; };
    const actHtml = () => { const n = file ? (() => { const pv = CC.xlsxPreview(); return pv.add.length + pv.change.length + pv.off.length; })() : 0;
      return `<button class="btn g" data-x>${H.t(n ? "adm_cc_cancel" : "adm_cc_close")}</button>${n ? `<button class="btn p" data-ccx-ok>${I("ok")}${ccT("adm_cc_imp_ok_tpl", { v:CC.version + 1 })}</button>` : ""}`; };
    const m = H.modal({ title:H.t("adm_cc_x_title"), wide:true, body:bodyHtml(), actions:actHtml() });
    const re = () => { m.querySelector(".mb").innerHTML = bodyHtml(); m.querySelector(".mf").innerHTML = actHtml(); };
    m.addEventListener("change", (e) => { if (!e.target.matches("[data-ccx-file]")) return; const f = e.target.files && e.target.files[0]; if (!f) return; file = f.name; re(); });
    m.addEventListener("click", (e) => { if (!e.target.closest("[data-ccx-ok]")) return; const pv = CC.xlsxPreview(), v = CC.xlsxApply(H.state.user.u);
      H.log("Bakım kataloğu: Excel'den içe aktarıldı", `v${v} · ${file} · ${pv.add.length} eklendi · ${pv.change.length} değişti · ${pv.off.length} pasife alındı · ${pv.tot.same} aynı`);
      H.closeModal(); H.toast(ccT("adm_cc_toast_pub_tpl", { v })); redraw(); });
  }

  /* ================================================================
   *        İZLEME VE İŞLETİM · 30.09.2026 (Ozan onayı: Y1–Y7)
   * ================================================================
   * Yeni sekmeler (ATABS + AGRP): health (Sistem durumu) · events (Olay günlüğü) · integrity (Veri bütünlüğü)
   *   · sessions (Açık oturumlar) · announce (Duyuru) · backup (Yedek ve geri yükleme) · viewas (Rol gözüyle bak).
   * Buradaki diziler SENTETİKTİR: arka ucun döndüreceği yanıtın BİÇİMİNİ gösterir. Her dizinin üstündeki "BACKEND:"
   * bloğu uç noktayı ve alanları tarif eder. Geliştirici notu ekranda yalnız H.adminNote ile (yönetim hesabına) görünür.
   * Gizlilik: bu ekranlarda hasta adı YOK; kayıtlar yalnız yatak no ile anılır. Kullanıcı adları H.data.users'tan gelir.
   * Saat (30.09c): gerçek saat. Tohum zamanları "24.09 21:42" varsayımıyla yazıldı → core.js H.at / H.atD ile kaydırılır. */
  const IZ = { hAt:H.atHM("21:41"), ev:{ lvl:"", src:"", rng:"24h", q:"" }, live:false, liveN:0, liveT:0, intR:"today", intAt:null,
    ses:{ role:"", dev:"", q:"" }, ann:null, dis:new Set(), bk:null };
  const NOW0 = H.clockDate(), NOW_MIN = 1440 + NOW0.getHours() * 60 + NOW0.getMinutes();   // dün 00:00 = 0 · bugün (takvim) 00:00 = 1440 · şimdi
  const isoCal = (off) => { const d = H.clockDate(); d.setDate(d.getDate() + off); return H.isoD(d); };   // takvim gününe göre (olay günlüğü)
  /* sağdan açılan ayrıntı çekmecesi: H.modal'ın kendisi (kapatma, Esc, arka plan tıklaması aynı) + .adm-drw sınıfı */
  function drawer(title, body, actions, onMount) { const m = H.modal({ title, body, actions, onMount }); m.parentElement.classList.add("adm-drw"); return m; }
  const kv2 = (k, v, fig) => `<div class="kv"><span>${esc(k)}</span><b${fig ? ` style="font-family:Figtree"` : ""}>${v}</b></div>`;
  const isoDay = (off) => { const d = new Date(H.DAY0); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const hexOf = (n) => ((n * 2654435761) >>> 0).toString(16).padStart(8, "0");

  /* ---------- Y1 · Sistem durumu ----------
   * BACKEND: GET /api/admin/health   (ekran 30 sn'de bir yoklar)
   *   yanıt: { checkedAt:"ISO", items:[HEALTH_ITEM] }
   *   HEALTH_ITEM: {
   *     key:"app"|"db"|"monitor"|"devices"|"hbys"|"queue"|"push"|"disk"|"clock"   — sabit bileşen anahtarı
   *     name:string        — ekranda görünen ad (ya da dil anahtarı)
   *     status:"ok"|"warn"|"down"   — yeşil / sarı / kırmızı; eşikler sunucu yapılandırmasında
   *     detail:string      — tek satır özet ("9 / 10 yatak bağlı · REA07 yanıt vermiyor")
   *     metrics:[[etiket, değer]]   — kutudaki anahtar-değer satırları, sıralı
   *     lastCheck:"ISO"    — bu bileşenin son denetim zamanı
   *     ms:number|null     — son yanıt süresi (ölçülmeyen bileşende null)
   *   }
   *   Ayrıntı çekmecesi: GET /api/admin/health/:key/history?limit=12 → [{ at:"ISO", status, ms, note }]  (yeniden eskiye)
   *   "Şimdi denetle": POST /api/admin/health/run → yeni yanıtın aynısı. */
  const HST = { ok:["Çalışıyor", "var(--ok)"], warn:["Uyarı", "var(--mid)"], down:["Çalışmıyor", "var(--crit)"] };
  const hsv = (s) => `<span class="sv" style="--r:${HST[s][1]}">${HST[s][0]}</span>`;
  const HEALTH = [
    { key:"app", icon:"cpu", name:"Uygulama sunucusu", status:"ok", detail:"Çalışma süresi 12 gün 4 saat", m:[["Yanıt süresi", "38 ms"], ["Sürüm", "2.6.1"], ["Bellek kullanımı", "%54"]], at:H.atHM("21:41"), ms:38 },
    { key:"db", icon:"file", name:"Veritabanı", status:"ok", detail:"Birincil ve yedek sunucu eşit", m:[["Bağlantı havuzu", "14 / 50"], ["Ortalama sorgu", "6 ms"], ["Eşleme gecikmesi", "0,3 sn"]], at:H.atHM("21:41"), ms:6 },
    { key:"monitor", icon:"activity", name:"Monitör köprüsü (Infinity)", status:"warn", detail:"9 / 10 yatak bağlı · REA07 yanıt vermiyor", m:[["Bağlı yatak", "9 / 10"], ["Son veri", "4 sn önce"], ["Kopuk", `REA07 · ${H.atHM("21:38")}'den beri`]], at:H.atHM("21:41"), ms:112 },
    { key:"devices", icon:"tablet", name:"Portatif cihazlar", status:"ok", detail:"6 / 6 cihaz eşleşmiş", m:[["Son veri", "3 dk önce"], ["Pili azalan", "1 cihaz"]], at:H.atHM("21:40"), ms:null },
    { key:"hbys", icon:"link", name:"Hastane kaydı (HBYS) bağlantısı", status:"warn", detail:"Son mesaj 12 dk önce · yanıt yavaş", m:[["Son mesaj", H.at("21:30")], ["Yanıt süresi", "1840 ms"], ["Kuyrukta", "4 mesaj"]], at:H.atHM("21:41"), ms:1840 },
    { key:"queue", icon:"list", name:"Bildirim kuyruğu", status:"ok", detail:"Bekleyen 3 · başarısız 0", m:[["Bekleyen", "3"], ["Başarısız (24 sa)", "0"], ["Ortalama bekleme", "1,2 sn"]], at:H.atHM("21:41"), ms:null },
    { key:"push", icon:"bell", name:"Anlık bildirim ve SMS kanalı", status:"ok", detail:"Teslim oranı %99,2", m:[["Anlık bildirim", "Çalışıyor"], ["SMS sağlayıcısı", "Çalışıyor"], ["Teslim edilemeyen (24 sa)", "2"]], at:H.atHM("21:40"), ms:240 },
    { key:"disk", icon:"file", name:"Disk ve yedek alanı", status:"ok", detail:"Veri diski %61 dolu", m:[["Veri diski", "%61 · 1,2 TB boş"], ["Yedek alanı", "%48 · 3,1 TB boş"], ["Tahmini dolma", "~140 gün"]], at:H.atHM("21:35"), ms:null },
    { key:"clock", icon:"clock", name:"Saat eşitleme", status:"ok", detail:"Sapma 0,04 sn", m:[["Zaman sunucusu", "ntp.hastane.local"], ["Son eşitleme", H.at("21:30")]], at:H.atHM("21:41"), ms:null },
  ];
  H.healthWarn = () => HEALTH.filter(h => h.status !== "ok").length;
  function hHist(h) {
    const [h0, m0] = h.at.split(":").map(Number); let t = h0 * 60 + m0; const out = [];
    for (let i = 0; i < 12; i++, t -= 5) {
      const bad = h.status !== "ok" && i < (h.key === "monitor" ? 1 : 4);
      const ms = h.ms == null ? null : Math.max(2, Math.round((bad || h.key !== "hbys" ? h.ms : 210) + ((i * 7) % 11) - 5));
      const note = h.key === "monitor" ? (bad ? "REA07 yanıt vermiyor" : "10 / 10 yatak bağlı") : h.key === "hbys" ? (bad ? "Yanıt yavaş · eşik 1000 ms" : "Yanıt normal") : "Normal";
      const tt = ((t % 1440) + 1440) % 1440; out.push({ at:`${pad(Math.floor(tt / 60))}:${pad(tt % 60)}`, status:bad ? h.status : "ok", ms, note });   // gece yarısını geçerken
    }
    return out;
  }
  function hlDrawer(h) {
    drawer(esc(h.name), `<div class="adm-row" style="margin-bottom:10px">${hsv(h.status)}<span>${esc(h.detail)}</span></div>
      ${h.m.map(([k, v]) => kv2(k, esc(v), /[a-zçğışöü]{4,}/i.test(v))).join("")}
      <div class="sec">Son denetimler <small>5 dakikalık özet · yeniden eskiye</small></div>
      <div class="tw"><table class="t"><thead><tr><th>Zaman</th><th>Durum</th><th>Yanıt</th><th>Not</th></tr></thead><tbody>
        ${hHist(h).map(r => `<tr><td class="mono">${r.at}</td><td>${hsv(r.status)}</td><td class="mono">${r.ms == null ? "—" : r.ms + " ms"}</td><td class="adm-sub">${esc(r.note)}</td></tr>`).join("")}</tbody></table></div>
      ${H.adminNote(`GET /api/admin/health/${h.key}/history?limit=12 → [{ at, status, ms, note }]`, "div")}`,
      `<button class="btn" data-x>Kapat</button><button class="btn p" data-hl-one>${I("swap")}Yeniden denetle</button>`,
      (m) => { m.querySelector("[data-hl-one]").onclick = () => { h.at = H.now(); H.log("Sistem durumu denetlendi", h.name); H.toast("Bileşen yeniden denetlendi"); H.closeModal(); const b = document.querySelector(".adm [data-body]"); if (b && AD.tab === "health") tabHealth(b); }; });
  }
  function tabHealth(body) {
    const bad = HEALTH.filter(h => h.status !== "ok"), down = bad.filter(h => h.status === "down").length, cls = down ? "crit" : bad.length ? "warn" : "ok";
    body.innerHTML = `<div class="hl-sum ${cls}">${I(cls === "ok" ? "ok" : "alert")}<div>
        <b>${bad.length ? `${bad.length} uyarı` : "Tüm sistemler çalışıyor"}</b>
        <div class="adm-sub">${bad.length ? bad.map(h => `<span>${esc(h.name)}</span>`).join(" · ") : `<span>${HEALTH.length} bileşen denetlendi</span>`}</div></div>
        <div class="hl-at"><span class="adm-sub">Son denetim</span> <b class="mono">${H.dm(H.calOff())} · ${IZ.hAt}</b><span class="adm-sub">Her 30 saniyede bir</span></div>
        <button class="btn sm" data-hl-run>${I("swap")}Şimdi denetle</button></div>
      <div class="hl-grid">${HEALTH.map(h => `<div class="box hl-t" style="--c:${HST[h.status][1]}">
        <div class="hl-h">${I(h.icon)}<b>${esc(h.name)}</b>${hsv(h.status)}</div>
        <div class="hl-d">${esc(h.detail)}</div>
        ${h.m.map(([k, v]) => kv2(k, esc(v), /[a-zçğışöü]{4,}/i.test(v))).join("")}
        <div class="hl-f"><span class="adm-sub">Son denetim</span><span class="mono adm-sub">${h.at}</span><button class="btn sm g" data-hl="${h.key}">Ayrıntı${I("chevR")}</button></div></div>`).join("")}</div>
      ${H.adminNote("Prototip saat testi: adrese ?saat=SS:DD (isteğe bağlı &gun=YYYY-AA-GG) eklenirse saat o anda durur ve bütün örnek kayıtlar o ana göre kurulur. Parametresiz adres gerçek saati gösterir.", "div")}
      ${H.adminNote("Kurulum notu: bu ekran GET /api/admin/health uç noktasından 30 saniyede bir beslenir → { checkedAt, items:[{ key, name, status: ok|warn|down, detail, metrics, lastCheck, ms }] }. Eşikler (ör. HBYS yanıtı 1000 ms üstü = uyarı) sunucu yapılandırmasındadır. Ayrıntı: /api/admin/health/:key/history.", "div")}`;
    body.onclick = e => {
      const d = e.target.closest("[data-hl]"); if (d) return hlDrawer(HEALTH.find(h => h.key === d.dataset.hl));
      if (e.target.closest("[data-hl-run]")) { IZ.hAt = H.now(); HEALTH.forEach(h => { h.at = H.now(); }); H.log("Sistem durumu denetlendi", `${HEALTH.length} bileşen`); H.toast(`Denetim tamamlandı · ${HEALTH.length} bileşen`); tabHealth(body); }
    };
  }

  /* ---------- Y2 · Olay günlüğü (sistemin kendi kaydı; "kim ne yaptı" = Denetim kaydı) ----------
   * BACKEND: GET /api/admin/events?level=&source=&from=&to=&q=&cursor=  → { items:[EVENT], nextCursor:string|null }
   *   Canlı izleme: GET /api/admin/events/stream  (SSE; her mesaj bir EVENT, listenin başına eklenir)
   *   CSV: GET /api/admin/events.csv?<aynı filtreler>  (UTF-8, ; ayraçlı)
   *   EVENT: {
   *     id:string                 — olay kimliği
   *     at:"ISO"                  — sunucu saati (saat dilimli)
   *     level:"error"|"warn"|"info"                       — Hata / Uyarı / Bilgi
   *     source:"server"|"bridge"|"integration"|"notify"|"mobile"   — Sunucu / Köprü / Entegrasyon / Bildirim / Mobil
   *     message:string            — tek satır; hasta adı İÇERMEZ, yalnız yatak no
   *     corrId:string             — ilişki kimliği: aynı olayın/isteğin bütün satırlarını bağlar (kopma → yeniden bağlanma)
   *     payload:object            — ham ayrıntı; kişisel veri sunucuda maskelenmiş gelir
   *   } */
  const EV_LVL = { error:["Hata", "tag c"], warn:["Uyarı", "tag w"], info:["Bilgi", "tag"] };
  const EV_SRC = { server:"Sunucu", bridge:"Köprü", integration:"Entegrasyon", notify:"Bildirim", mobile:"Mobil" };
  const EV_RNG = [["1h", "Son 1 saat", 60], ["6h", "Son 6 saat", 360], ["today", "Bugün", 0], ["24h", "Son 24 saat", 1440], ["7d", "Son 7 gün", 99999]];
  // [gün (1 = bugün, 0 = dün), saat, düzey, kaynak, ileti, payload, ilişki anahtarı]
  const EVENTS = [
    [1, "21:40:51", "warn", "integration", "HBYS yavaş yanıt · 1840 ms", { endpoint:"/hl7/adt", ms:1840, thresholdMs:1000, attempt:1 }],
    [1, "21:39:02", "info", "notify", "Kritik alarm bildirimi teslim edildi · REA01", { channel:"push", target:"role:hemsire unit:rea", devices:3, latencyMs:840 }],
    [1, "21:38:05", "info", "notify", "Monitör sessiz uyarısı kuyruğa alındı · REA07", { rule:"monitor_silent", afterSec:30, target:"role:hemsire unit:rea" }, "a7e3c1"],
    [1, "21:38:04", "error", "bridge", "Monitör bağlantısı koptu · REA07", { bed:"REA07", device:"Infinity M540", gateway:"inf-gw-01", lastFrameAgoSec:31 }, "a7e3c1"],
    [1, "21:36:40", "warn", "mobile", "Çevrimdışı kayıtlar geç gönderildi · 3 kayıt", { device:"iPhone 13", app:"1.6.0", queued:3, delaySec:412, user:"hs.nuray" }],
    [1, "21:31:14", "info", "notify", "SMS ile yeniden gönderildi", { channel:"sms", provider:"sms-gw", status:"delivered" }, "b21f90"],
    [1, "21:31:12", "error", "notify", "Anlık bildirim teslim edilemedi · cihaz kaydı geçersiz", { channel:"push", provider:"APNs", status:410, reason:"Unregistered", user:"hs.gulnar" }, "b21f90"],
    [1, "21:30:02", "info", "integration", "ADT mesajı işlendi · A01 kabul · DAX05", { msgType:"ADT^A01", bed:"DAX05", ack:"AA", ms:212 }],
    [1, "21:22:47", "warn", "integration", "HBYS yavaş yanıt · 1320 ms", { endpoint:"/hl7/oru", ms:1320, thresholdMs:1000, attempt:1 }],
    [1, "21:15:00", "info", "server", "Zamanlanmış görev tamamlandı · skor hesaplama", { job:"score_recalc", beds:61, durationMs:3810 }],
    [1, "21:05:58", "info", "bridge", "Veri akışı normale döndü · KVC02", { bed:"KVC02", lagSec:2 }, "c4d2e8"],
    [1, "21:05:33", "warn", "bridge", "Veri gecikmesi · KVC02 · 45 sn", { bed:"KVC02", lagSec:45, thresholdSec:30 }, "c4d2e8"],
    [1, "20:48:10", "error", "integration", "ORU mesajı reddedildi · eşleşmeyen protokol numarası", { msgType:"ORU^R01", reason:"PID-3 not found", ack:"AE", bed:"CER03" }],
    [1, "20:31:09", "info", "mobile", "Yeni cihaz eşleştirildi · yatak başı tablet", { device:"Samsung Galaxy Tab S9", station:"REA-1", by:"bio.orxan" }],
    [1, "20:12:44", "warn", "server", "Yavaş veritabanı sorgusu · 2,4 sn", { query:"tasks_by_unit", ms:2412, thresholdMs:1000 }],
    [1, "20:05:01", "info", "server", "Önbellek yenilendi", { cache:"unit_structure", keys:148 }],
    [1, "19:59:10", "info", "notify", "Bildirim kuyruğu boşaldı", { pending:0 }, "d9a0b3"],
    [1, "19:58:30", "warn", "notify", "Bildirim kuyruğunda birikme · 12 mesaj", { pending:12, thresholdPending:10, oldestSec:48 }, "d9a0b3"],
    [1, "19:14:22", "info", "bridge", "Monitör yeniden bağlandı · REA07", { bed:"REA07", downSec:139 }, "e0b7f4"],
    [1, "19:12:03", "error", "bridge", "Monitör bağlantısı koptu · REA07", { bed:"REA07", device:"Infinity M540", gateway:"inf-gw-01", lastFrameAgoSec:30 }, "e0b7f4"],
    [1, "18:40:00", "info", "integration", "ADT mesajı işlendi · A03 taburcu · CER04", { msgType:"ADT^A03", bed:"CER04", ack:"AA", ms:198 }],
    [1, "18:02:17", "error", "server", "Oturum doğrulama hatası · süresi dolmuş anahtar", { ip:"10.20.6.14", path:"/api/beds", status:401 }],
    [1, "17:45:39", "warn", "mobile", "Eski uygulama sürümü · 1.4.2", { device:"Samsung Galaxy A54", app:"1.4.2", minSupported:"1.5.0", user:"hs.gulnar" }],
    [1, "16:20:11", "info", "integration", "ORM mesajı gönderildi · laboratuvar istemi · NIC02", { msgType:"ORM^O01", bed:"NIC02", ack:"AA" }],
    [1, "15:02:55", "warn", "bridge", "Cihaz saati sapmış · PIC03 · 7 sn", { bed:"PIC03", driftSec:7, thresholdSec:5 }],
    [1, "14:10:00", "info", "server", "Sürüm güncellendi · 2.6.1", { from:"2.6.0", to:"2.6.1", downtimeSec:0 }],
    [1, "12:32:40", "info", "integration", "HBYS bağlantısı yeniden kuruldu", { endpoint:"/hl7/orm", downSec:92 }, "f13c6a"],
    [1, "12:31:08", "error", "integration", "HBYS bağlantısı zaman aşımı", { endpoint:"/hl7/orm", timeoutMs:10000, retry:"3/3" }, "f13c6a"],
    [1, "07:58:21", "info", "mobile", "Vardiya başı eşitleme tamamlandı · 14 cihaz", { devices:14, records:236 }],
    [1, "06:00:12", "info", "server", "Günlük veri bütünlüğü denetimi tamamlandı", { job:"integrity_daily", modules:7, issues:41 }],
    [1, "02:47:31", "info", "server", "Gece yedeği tamamlandı · 18,4 GB · 47 dk", { job:"backup_nightly", sizeGb:18.4, durationMin:47, sha256:"9c1e…41af" }, "0b8d22"],
    [1, "02:00:00", "info", "server", "Gece yedeği başladı", { job:"backup_nightly" }, "0b8d22"],
    [1, "01:10:44", "warn", "bridge", "Veri gecikmesi · NIC04 · 38 sn", { bed:"NIC04", lagSec:38, thresholdSec:30 }],
    [0, "23:55:02", "info", "server", "Saat eşitlendi · sapma 0,04 sn", { ntp:"ntp.hastane.local", offsetSec:0.04 }],
    [0, "23:12:50", "info", "notify", "SMS sağlayıcısı yeniden yanıt veriyor", { provider:"sms-gw" }, "11c5e9"],
    [0, "23:12:18", "error", "notify", "SMS gönderilemedi · sağlayıcı yanıt vermedi", { provider:"sms-gw", status:503, retry:"2/3" }, "11c5e9"],
    [0, "22:40:05", "warn", "integration", "HBYS yavaş yanıt · 1510 ms", { endpoint:"/hl7/adt", ms:1510, thresholdMs:1000, attempt:1 }],
    [0, "21:02:33", "info", "mobile", "Yeni cihaz eşleştirildi · yatak başı tablet", { device:"Samsung Galaxy Tab S9", station:"DAX-1", by:"bio.orxan" }],
    [0, "20:15:47", "warn", "server", "Disk yazma yeniden denendi · başarılı", { volume:"data", retries:1 }],
    [0, "19:31:12", "info", "bridge", "Monitör yeniden bağlandı · 10 / 10 yatak", { gateway:"inf-gw-01", beds:10 }, "2de6a1"],
    [0, "19:30:00", "info", "bridge", "Köprü yeniden başlatıldı · planlı bakım", { gateway:"inf-gw-01", reason:"planned" }, "2de6a1"],
  ].map((r, i) => {
    // 30.09c · yazılmış an (1 = 24.09, 0 = 23.09) → gerçek saate kaydırılır; gün yeniden takvime göre (1 = bugün, 0 = dün, <0 daha eski)
    const [h0, m0, s0] = r[1].split(":").map(Number), a = new Date(2026, 8, 23 + r[0], h0, m0, s0), n = new Date(+a + H.SHIFT_MS);
    const day = 1 + H.dOff(n) - H.calOff(), hh = n.getHours(), mm = n.getMinutes(), t = `${pad(hh)}:${pad(mm)}:${pad(n.getSeconds())}`;
    return { id:"ev-" + (48120 - i), day, d:H.dm(H.dOff(n)), t, min:day * 1440 + hh * 60 + mm, level:r[2], source:r[3], msg:r[4], payload:r[5] || {}, corr:"c-" + (r[6] || hexOf(i + 7).slice(0, 6)) }; });
  const EV_LIVE = [
    ["info", "bridge", "Köprü kalp atışı · 9 / 10 yatak bağlı", { gateway:"inf-gw-01", beds:10, connected:9 }],
    ["info", "notify", "Kritik alarm bildirimi teslim edildi · REA02", { channel:"push", target:"role:hemsire unit:rea", devices:3, latencyMs:610 }],
    ["info", "integration", "ADT mesajı işlendi · A08 güncelleme · DAX03", { msgType:"ADT^A08", bed:"DAX03", ack:"AA", ms:240 }],
    ["warn", "integration", "HBYS yavaş yanıt · 1210 ms", { endpoint:"/hl7/adt", ms:1210, thresholdMs:1000, attempt:1 }],
  ];
  function evDrawer(e) {
    const rel = EVENTS.filter(x => x.corr === e.corr && x !== e);
    const js = { id:e.id, at:`${isoCal(e.day - 1)}T${e.t}+04:00`, level:e.level, source:e.source, message:e.msg, corrId:e.corr, payload:e.payload };
    drawer("Olay ayrıntısı", `<div class="adm-row" style="margin-bottom:10px"><span class="${EV_LVL[e.level][1]}">${EV_LVL[e.level][0]}</span><span class="pill">${EV_SRC[e.source]}</span><span class="mono adm-sub">${e.d} · ${e.t}</span></div>
      <p class="ev-msg">${esc(e.msg)}</p>
      ${kv2("Olay kimliği", e.id)}${kv2("İlişki kimliği", e.corr)}
      <div class="sec">Ham ayrıntı <small>JSON</small></div>
      <pre class="adm-json" data-notr>${esc(JSON.stringify(js, null, 2))}</pre>
      ${rel.length ? `<div class="sec">Aynı ilişki kimliğindeki olaylar</div>${rel.map(x => `<div class="kv ev-rel" data-evrel="${x.id}"><span>${esc(x.msg)}</span><b>${x.t}</b></div>`).join("")}` : ""}`,
      `<button class="btn" data-x>Kapat</button><button class="btn" data-ev-copy>${I("file")}İlişki kimliğini kopyala</button>`,
      (m) => { m.onclick = (ev) => { const r = ev.target.closest("[data-evrel]"); if (r) return evDrawer(EVENTS.find(x => x.id === r.dataset.evrel));
        if (ev.target.closest("[data-ev-copy]")) { try { navigator.clipboard && navigator.clipboard.writeText(e.corr).catch(() => {}); } catch (er) {} H.toast("İlişki kimliği kopyalandı"); } }; });
  }
  function tabEvents(body) {
    const f = IZ.ev;
    const sel = (k, list, all) => `<select data-ev="${k}">${all ? `<option value="">${all}</option>` : ""}${list.map(([v, l]) => `<option value="${v}"${f[k] === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    body.innerHTML = `<div class="adm-bar">
        <input data-ev="q" placeholder="İleti, yatak no ya da ilişki kimliği ara" value="${esc(f.q)}">
        ${sel("lvl", Object.entries(EV_LVL).map(([k, v]) => [k, v[0]]), "Tüm düzeyler")}${sel("src", Object.entries(EV_SRC), "Tüm kaynaklar")}
        <span class="ev-rng">${I("clock")}${sel("rng", EV_RNG.map(x => [x[0], x[1]]))}</span>
        <span class="spacer"></span>
        <span class="adm-row ev-lt"><label class="st-sw"><input type="checkbox" data-ev-live${IZ.live ? " checked" : ""}><span></span></label><span>Canlı izle</span></span>
        <button class="btn" data-ev-csv>${I("file")}CSV indir</button></div>
      <div class="adm-row" style="margin-bottom:10px" data-ev-sum></div>
      <div data-ev-list></div>
      <p class="adm-sub" style="margin-top:10px">Olay günlüğü sistemin kendi kaydıdır: bağlantı, kuyruk, hata. Kimin ne yaptığı için Denetim kaydına bakın.</p>
      ${H.adminNote("Kurulum notu: GET /api/admin/events?level=&source=&from=&to=&q=&cursor= → { items:[{ id, at, level, source, message, corrId, payload }], nextCursor }. Canlı izleme: GET /api/admin/events/stream (SSE). CSV: GET /api/admin/events.csv aynı filtrelerle. İletide hasta adı olmaz; payload kişisel veriyi maskeli getirir.", "div")}`;
    const list = body.querySelector("[data-ev-list]");
    const rows = () => { const q = norm(f.q), r = EV_RNG.find(x => x[0] === f.rng) || EV_RNG[3];
      return EVENTS.filter(e => (!f.lvl || e.level === f.lvl) && (!f.src || e.source === f.src) && (r[0] === "today" ? e.day === 1 : e.min >= NOW_MIN - r[2])
        && (!q || norm(`${e.msg} ${e.corr} ${e.id}`).includes(q))); };
    const drawList = () => { const rs = rows(), nE = rs.filter(x => x.level === "error").length, nW = rs.filter(x => x.level === "warn").length;
      body.querySelector("[data-ev-sum]").innerHTML = `<span class="pill">${rs.length} kayıt</span>${nE ? `<span class="tag c">${nE} hata</span>` : ""}${nW ? `<span class="tag w">${nW} uyarı</span>` : ""}${IZ.live ? `<span class="ev-live"><i></i>Canlı</span>` : ""}`;
      list.innerHTML = rs.length ? `<div class="tw"><table class="t ev-t"><thead><tr><th>Zaman</th><th>Düzey</th><th>Kaynak</th><th>İleti</th><th>İlişki kimliği</th></tr></thead><tbody>
        ${rs.map(e => `<tr class="ev-r${e.fresh ? " fresh" : ""}" data-evid="${e.id}" tabindex="0"><td class="mono" style="white-space:nowrap"><span class="adm-sub">${e.d}</span> <b>${e.t}</b></td>
          <td><span class="${EV_LVL[e.level][1]}">${EV_LVL[e.level][0]}</span></td><td>${EV_SRC[e.source]}</td><td style="min-width:240px">${esc(e.msg)}</td><td class="mono adm-sub">${e.corr}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="empty">Filtreye uyan olay yok.</div>`; };
    const tick = () => {
      if (!list.isConnected || !IZ.live) { clearInterval(IZ.liveT); IZ.liveT = 0; return; }
      const L = EV_LIVE[IZ.liveN % EV_LIVE.length], s = 5 * (++IZ.liveN), tm = NOW_MIN - 1440 + Math.floor(s / 60);
      EVENTS.forEach(e => { e.fresh = false; });
      EVENTS.unshift({ id:"ev-" + (48120 + IZ.liveN), day:1, d:H.dm(H.calOff()), t:`${pad(Math.floor(tm / 60) % 24)}:${pad(tm % 60)}:${pad(s % 60)}`, min:NOW_MIN + Math.floor(s / 60),
        level:L[0], source:L[1], msg:L[2], payload:L[3], corr:"c-" + hexOf(900 + IZ.liveN).slice(0, 6), fresh:true });
      drawList(); };
    const live = (on) => { IZ.live = on; clearInterval(IZ.liveT); IZ.liveT = on ? setInterval(tick, 3000) : 0; drawList(); };
    drawList(); if (IZ.live) live(true);
    body.oninput = e => { if (e.target.dataset.ev === "q") { f.q = e.target.value; drawList(); } };
    body.onchange = e => { const s = e.target.closest("select[data-ev]"); if (s) { f[s.dataset.ev] = s.value; drawList(); return; }
      if (e.target.matches("[data-ev-live]")) { live(e.target.checked); H.toast(e.target.checked ? "Canlı izleme açıldı" : "Canlı izleme kapandı"); } };
    body.onclick = e => {
      if (e.target.closest("[data-ev-csv]")) { const rs = rows(), q = (s) => `"${String(s).replace(/"/g, '""')}"`;
        const txt = ["zaman;duzey;kaynak;ileti;iliski_kimligi", ...rs.map(x => [`${isoCal(x.day - 1)} ${x.t}`, x.level, x.source, x.msg, x.corr].map(q).join(";"))].join("\r\n");
        try { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + txt], { type:"text/csv;charset=utf-8" })); a.download = `olay-gunlugu-${isoCal(0)}.csv`;
          document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800); } catch (er) {}
        H.log("Olay günlüğü dışa aktarıldı", `${rs.length} kayıt · CSV`); H.toast(`${rs.length} kayıt CSV olarak indirildi`); return; }
      const r = e.target.closest("[data-evid]"); if (r) evDrawer(EVENTS.find(x => x.id === r.dataset.evid));
    };
    body.onkeydown = e => { if (e.key === "Enter") { const r = e.target.closest("[data-evid]"); if (r) evDrawer(EVENTS.find(x => x.id === r.dataset.evid)); } };
  }

  /* ---------- Y3 · Veri bütünlüğü ----------
   * BACKEND: GET /api/admin/integrity?range=today|7d → { checkedAt:"ISO", nextRunAt:"ISO", modules:[INT_MODULE] }
   *   "Şimdi denetle": POST /api/admin/integrity/run → aynı yanıt
   *   INT_MODULE: { key, name, entered:number, incomplete:number, unmatched:number, late:number, issues:[INT_ISSUE] }
   *   INT_ISSUE: {
   *     kind:"incomplete"|"unmatched"|"late"
   *       · incomplete = zorunlu alanı boş kaydedilmiş form
   *       · unmatched  = kayıt anında o yatakta yatış yok (ör. boş yataktan monitör verisi) ya da barkod yataktaki hastayla eşleşmedi
   *       · late       = planlanan saatten 30 dk sonra girilen
   *     bedNo:string, unitId:string, at:"ISO", what:string   — HASTA ADI DÖNMEZ
   *     ref:{ page:"patient"|"admission", pid?, tab?, recordId }   — "Kayda git" bağlantısı
   *   } */
  const INT_K = { incomplete:["Yarım", "w"], unmatched:["Eşleşmeyen", "c"], late:["Geciken", "w"] };
  // [anahtar, ad, hasta sekmesi, bugün [girilen, yarım, eşleşmeyen, geciken], son 7 gün [...], yarım kaydın eksiği, eşleşmeyenin nedeni]
  const INT_MOD = [
    ["pain", "Ağrı değerlendirmesi", "takip", [46, 2, 0, 3], [318, 9, 1, 17], "Ağrı puanı boş", "Yatakta yatış yok"],
    ["nurse", "Hemşire takip", "takip", [212, 4, 3, 6], [1466, 21, 12, 38], "Bilinç durumu boş", "Monitör verisi · yatakta yatış yok"],
    ["fluid", "Sıvı dengesi", "sivi", [88, 5, 0, 2], [604, 26, 0, 14], "Çıkan miktar girilmemiş", "Yatakta yatış yok"],
    ["care", "Bakım planı", "bakim", [19, 1, 0, 0], [131, 4, 0, 3], "Hedef değerlendirmesi boş", "Yatakta yatış yok"],
    ["med", "İlaç uygulama", "ilac", [164, 0, 1, 7], [1132, 2, 3, 41], "Uygulama saati boş", "Barkod yataktaki hastayla eşleşmedi"],
    ["score", "Skor onayı", "skor", [27, 0, 0, 4], [189, 0, 0, 22], "İmza eksik", "Yatakta yatış yok"],
    ["hand", "Devir", "devir", [31, 2, 0, 1], [214, 6, 0, 5], "Karşı imza yok", "Yatakta yatış yok"],
  ];
  const intCounts = () => INT_MOD.map(m => ({ key:m[0], name:m[1], tab:m[2], c:IZ.intR === "7d" ? m[4] : m[3], inc:m[5], um:m[6] }));
  function intIssues(mod) {
    const occ = H.data.patients.map(p => ({ p, b:H.bed(p.bed) })).filter(x => x.b), free = H.units().flatMap(u => u.beds).filter(b => b.status !== "dolu" && !b.archived && !b.oos);
    const out = [], week = IZ.intR === "7d";
    [["incomplete", 1], ["unmatched", 2], ["late", 3]].forEach(([kind, ci], ki) => {
      for (let i = 0; i < mod.c[ci]; i++) {
        const seed = (mod.key.length * 13 + i * 7 + ki * 5), um = kind === "unmatched" && mod.key !== "med";
        const pick = um ? { b:free[seed % free.length] } : occ[seed % occ.length]; if (!pick || !pick.b) continue;
        const tm = 8 * 60 + ((i * 97 + ki * 31 + mod.key.length * 17) % (13 * 60)), off = week ? -((i + ki) % 7) : 0, t = `${pad(Math.floor(tm / 60))}:${pad(tm % 60)}`;
        const what = kind === "incomplete" ? mod.inc : kind === "unmatched" ? mod.um : `Planlanan ${pad(Math.floor(tm / 60))}:00 · girilen ${t}`;
        out.push({ kind, mod:mod.key, modName:mod.name, tab:mod.tab, bedNo:pick.b.no, unit:(H.unit(pick.b.unitId) || {}).tr || "", pid:pick.p && !um ? pick.p.id : null, d:H.dm(off), t, what, off, tm });
      }
    });
    return out.sort((a, b) => b.off - a.off || b.tm - a.tm);
  }
  function goRecord(x) {
    const det = `${x.bedNo} · ${x.modName} · ${x.d} ${x.t}`;
    if (x.kind !== "unmatched" && x.pid && H.pt(x.pid) && H.can("patient")) { H.closeModal(); H.log("Veri bütünlüğü: kayda gidildi", det); return H.go("patient", { pid:x.pid, tab:x.tab }); }
    if (x.kind === "unmatched" && H.can("admission")) { H.closeModal(); H.log("Veri bütünlüğü: eşleştirmeye gidildi", det); return H.go("admission", {}); }
    H.log("Veri bütünlüğü: birim sorumlusuna iletildi", det); H.toast("Kaydı açma yetkiniz yok · birim sorumlu hemşiresine iletildi", "w");
  }
  function intDrawer(mk, kind0) {
    let kind = kind0 || "";
    const mods = intCounts().filter(m => !mk || m.key === mk), all = mods.flatMap(intIssues);
    const bodyH = () => { const L = all.filter(x => !kind || x.kind === kind), CAP = 40;
      return `<div class="seg" style="margin-bottom:10px;flex-wrap:wrap">${[["", "Tümü"], ...Object.entries(INT_K).map(([k, v]) => [k, v[0]])].map(([k, l]) => `<button data-ik="${k}" class="${kind === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="adm-sub" style="margin-bottom:8px"><span>${L.length} kayıt</span> · <span>Hasta adı gösterilmez; kayıt yatak numarası ve zamanla anılır.</span></div>
        ${L.length ? `<div class="tw"><table class="t"><thead><tr><th>Yatak</th><th>Zaman</th>${mk ? "" : "<th>Modül</th>"}<th>Sorun</th><th></th></tr></thead><tbody>
          ${L.slice(0, CAP).map((x, i) => `<tr><td><b class="mono">${esc(x.bedNo)}</b><div class="adm-sub">${esc(x.unit)}</div></td><td class="mono" style="white-space:nowrap">${x.d} ${x.t}</td>
            ${mk ? "" : `<td>${esc(x.modName)}</td>`}<td><span class="tag ${INT_K[x.kind][1]}">${INT_K[x.kind][0]}</span><div class="adm-sub" style="margin-top:3px">${esc(x.what)}</div></td>
            <td><button class="btn sm g" data-igo="${i}">Kayda git${I("chevR")}</button></td></tr>`).join("")}</tbody></table></div>
          ${L.length > CAP ? `<p class="adm-sub" style="margin:8px 0 0">İlk ${CAP} kayıt gösteriliyor · toplam ${L.length}</p>` : ""}` : `<div class="empty">Bu türde sorunlu kayıt yok.</div>`}`; };
    const title = mk ? `<span>${esc(mods[0].name)}</span>` : `<span>Sorunlu kayıtlar</span>`;
    drawer(title, bodyH(), `<button class="btn" data-x>Kapat</button>`, (m) => {
      m.onclick = (e) => { const s = e.target.closest("[data-ik]"); if (s) { kind = s.dataset.ik; m.querySelector(".mb").innerHTML = bodyH(); return; }
        const g = e.target.closest("[data-igo]"); if (g) goRecord(all.filter(x => !kind || x.kind === kind)[+g.dataset.igo]); };
    });
  }
  function tabIntegrity(body) {
    const mods = intCounts(), tot = [0, 1, 2, 3].map(i => mods.reduce((s, m) => s + m.c[i], 0)), last = IZ.intAt || `${H.dm(0)} 06:00`;
    const card = (ic, label, n, cls, k) => `<div class="ac ${cls}" data-int-k="${k}" data-int-m="" role="button" tabindex="0"><div class="i">${I(ic)}</div><b>${n}</b><span>${label}</span></div>`;
    const cell = (m, i, k) => m.c[i] ? `<button class="iz-n ${INT_K[k][1]}" data-int-m="${m.key}" data-int-k="${k}" title="Kayıtları göster">${m.c[i]}</button>` : `<span class="iz-n z">0</span>`;
    body.innerHTML = `<div class="adm-bar"><div class="seg">${[["today", "Bugün"], ["7d", "Son 7 gün"]].map(([k, l]) => `<button data-ir="${k}" class="${IZ.intR === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <span class="adm-sub iz-at"><span>Günlük denetim her gün 06:00</span> · <span>son denetim</span> <b class="mono">${last}</b></span><span class="spacer"></span>
        <button class="btn" data-int-run>${I("swap")}Şimdi denetle</button></div>
      <div class="att iz-att">${card("clip", "Girilen kayıt", tot[0], "ok", "")}${card("edit", "Yarım", tot[1], tot[1] ? "" : "ok", "incomplete")}${card("link", "Eşleşmeyen", tot[2], tot[2] ? "crit" : "ok", "unmatched")}${card("clock", "Geciken", tot[3], tot[3] ? "" : "ok", "late")}</div>
      <div class="tw" style="margin-top:12px"><table class="t iz-t"><thead><tr><th>Modül</th><th class="n">Girilen</th><th class="n">Yarım</th><th class="n">Eşleşmeyen</th><th class="n">Geciken</th><th>Durum</th><th></th></tr></thead><tbody>
        ${mods.map(m => { const p = m.c[1] + m.c[2] + m.c[3];
          return `<tr><td><b>${esc(m.name)}</b></td><td class="n mono">${m.c[0]}</td><td class="n">${cell(m, 1, "incomplete")}</td><td class="n">${cell(m, 2, "unmatched")}</td><td class="n">${cell(m, 3, "late")}</td>
            <td>${p ? `<span class="tag w">${p} sorun</span>` : `<span class="sv" style="--r:var(--ok)">Sorun yok</span>`}</td>
            <td>${p ? `<button class="btn sm g" data-int-m="${m.key}">Kayıtlar${I("chevR")}</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>
      <div class="box" style="margin-top:12px"><h5>${I("list")} Tanımlar</h5>
        <div class="kv"><span>Yarım</span><span>Zorunlu alanı boş kaydedilmiş form</span></div>
        <div class="kv"><span>Eşleşmeyen</span><span>Kayıt anında o yatakta yatış yok ya da barkod yataktaki hastayla eşleşmedi</span></div>
        <div class="kv"><span>Geciken</span><span>Planlanan saatten 30 dakika sonra girilen kayıt</span></div></div>
      ${H.adminNote("Kurulum notu: GET /api/admin/integrity?range=today|7d → { checkedAt, modules:[{ key, entered, incomplete, unmatched, late, issues:[{ kind, bedNo, unitId, at, what, ref }] }] }. Denetim her gün 06:00'da sunucuda koşar; “Şimdi denetle” POST /api/admin/integrity/run. Yanıtta hasta adı olmaz.", "div")}`;
    body.onclick = e => {
      const r = e.target.closest("[data-ir]"); if (r) { IZ.intR = r.dataset.ir; return tabIntegrity(body); }
      if (e.target.closest("[data-int-run]")) { IZ.intAt = `${H.dm(0)} ${H.now()}`; H.log("Veri bütünlüğü denetlendi", `${INT_MOD.length} modül`); H.toast(`Denetim tamamlandı · ${INT_MOD.length} modül`); return tabIntegrity(body); }
      const c = e.target.closest("[data-int-m]"); if (c) intDrawer(c.dataset.intM || "", c.dataset.intK || "");
    };
    body.onkeydown = e => { if (e.key === "Enter") { const c = e.target.closest(".ac[data-int-m]"); if (c) intDrawer("", c.dataset.intK || ""); } };
  }

  /* ---------- Y4 · Açık oturumlar ----------
   * BACKEND: GET /api/admin/sessions?role=&device= → [SESSION]
   *   SESSION: { id, user:"kullanıcı adı", role, device:{ kind:"ios"|"android"|"web", model:string, client:string }, ip:string,
   *              unitId:string|null (oturumun seçili birimi), loginAt:"ISO", lastActiveAt:"ISO", current:boolean (bu isteği yapan oturum) }
   *   Oturumu kapat: DELETE /api/admin/sessions/:id · Tüm cihazlardan çıkış: POST /api/admin/users/:u/sessions/revoke-all
   *   İkisi de denetim kaydına yazılır; kapatılan cihaz bir sonraki istekte 401 alır ve giriş ekranına döner. */
  const DEV_K = { ios:["iPhone", "tablet"], android:["Android", "tablet"], web:["Web", "globe"] };
  let SESS = null;
  const sessions = () => SESS || (SESS = [
    ["admin", "web", "Windows · Chrome 129", "10.20.1.15", "", "20:05", 0, true],
    ["hs.sevda", "ios", "iPhone 14 · Homunculus 1.6.0", "10.20.4.31", "rea", "19:58", 1],
    ["hs.sevda", "web", "Windows · Edge 129", "10.20.4.10", "rea", "20:05", 4],
    ["dr.kamran", "web", "Windows · Chrome 129", "10.20.4.12", "rea", "19:58", 2],
    ["dr.kamran", "ios", "iPhone 15 · Homunculus 1.6.0", "10.20.9.77", "rea", "08:12", 37],
    ["hs.gulnar", "android", "Samsung Galaxy A54 · Homunculus 1.4.2", "10.20.2.44", "dax", "08:04", 6],
    ["hs.gulnar", "web", "Windows · Chrome 129", "10.20.2.10", "dax", "08:04", 11],
    ["hs.nuray", "android", "Xiaomi Redmi Note 13 · Homunculus 1.6.0", "10.20.7.23", "nic", "19:50", 0],
    ["rrt.emil", "ios", "iPhone 13 · Homunculus 1.6.0", "10.20.9.81", "aci", "20:01", 3],
    ["ecz.lale", "web", "Windows · Firefox 131", "10.20.3.18", "", "08:30", 52],
    ["kabul.ulviyye", "web", "Windows · Chrome 129", "10.20.1.40", "", "07:55", 8],
    ["bio.orxan", "android", "Samsung Galaxy Tab S9 · Homunculus 1.6.0", "10.20.5.60", "", "09:10", 71],
    ["mudur.rauf", "web", "macOS · Safari 18", "10.20.1.22", "", "17:40", 124],
    ["kalite.tural", "web", "Windows · Chrome 129", "10.20.1.31", "", "09:02", 190],
  ].filter(r => H.userBy(r[0])).map((r, i) => ({ id:"s-" + (7100 + i), u:r[0], dev:r[1], client:r[2], ip:r[3], unit:r[4], login:(d => `${H.dm(H.dOff(d))} ${H.hm(d)}`)(H.atD(r[5], true)), idle:r[6], cur:!!r[7] })));   // 30.09c: giriş saati kayar
  const idleTxt = (n) => n === 0 ? "şimdi" : n < 60 ? `${n} dk önce` : `${Math.floor(n / 60)} sa önce`;
  function sesConfirm(title, rows, note, okLbl, onOk) {
    H.modal({ title, body:`${rows}<div class="note" style="margin-top:12px">${note}</div>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn d" data-ok>${I("out")}${okLbl}</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { H.closeModal(); onOk(); }; } });
  }
  function tabSessions(body) {
    const f = IZ.ses, meU = (H.state.realUser || H.state.user || {}).u;
    body.innerHTML = `<div class="adm-bar"><input data-ses="q" placeholder="Ad, kullanıcı adı ya da IP ara" value="${esc(f.q)}">
        <select data-ses="role"><option value="">Tüm roller</option>${Object.entries(H.data.roles).map(([k, r]) => `<option value="${k}"${f.role === k ? " selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
        <select data-ses="dev"><option value="">Tüm cihazlar</option>${Object.entries(DEV_K).map(([k, v]) => `<option value="${k}"${f.dev === k ? " selected" : ""}>${v[0]}</option>`).join("")}</select></div>
      <div class="adm-row" style="margin-bottom:10px" data-ses-sum></div><div data-ses-list></div>
      <p class="adm-sub" style="margin-top:10px">Oturum ${esc(H.settings.sessionTimeout)} dakika hareketsizlikte kendiliğinden kilitlenir (Sistem ayarları). Kapatılan oturumun cihazı bir sonraki işlemde giriş ekranına döner.</p>
      ${H.adminNote("Kurulum notu: GET /api/admin/sessions → [{ id, user, role, device:{ kind, model, client }, ip, unitId, loginAt, lastActiveAt, current }]. Kapat: DELETE /api/admin/sessions/:id · tüm cihazlar: POST /api/admin/users/:u/sessions/revoke-all. İkisi de denetim kaydına yazılır.", "div")}`;
    const drawList = () => { const q = norm(f.q), rs = sessions().filter(s => { const u = H.userBy(s.u) || {};
        return (!f.role || u.role === f.role) && (!f.dev || s.dev === f.dev) && (!q || norm(`${u.name} ${s.u} ${s.ip}`).includes(q)); });
      body.querySelector("[data-ses-sum]").innerHTML = `<span class="pill">${rs.length} açık oturum</span><span class="pill">${new Set(rs.map(s => s.u)).size} kullanıcı</span>${rs.some(s => s.client.includes("1.4.2")) ? `<span class="tag w">Eski uygulama sürümü var</span>` : ""}`;
      body.querySelector("[data-ses-list]").innerHTML = rs.length ? `<div class="tw"><table class="t"><thead><tr><th>Kullanıcı</th><th>Rol</th><th>Cihaz</th><th>IP</th><th>Birim</th><th>Giriş</th><th>Son etkinlik</th><th></th></tr></thead><tbody>
        ${rs.map(s => { const u = H.userBy(s.u) || { name:s.u }, un = s.unit && H.unit(s.unit);
          return `<tr><td style="white-space:nowrap"><b>${esc(u.name)}</b><div class="adm-sub mono">${esc(s.u)}</div></td><td>${esc(H.roleLabel(u))}</td>
            <td><div class="ses-dev">${I(DEV_K[s.dev][1])}<div><b>${DEV_K[s.dev][0]}</b><div class="adm-sub">${esc(s.client)}</div></div></div></td>
            <td class="mono adm-sub">${esc(s.ip)}</td><td class="adm-sub">${un ? esc(un.tr) : "—"}</td><td class="mono" style="white-space:nowrap">${s.login}</td>
            <td>${s.cur ? `<span class="sv" style="--r:var(--ok)">Bu oturum</span>` : `<span class="adm-sub">${idleTxt(s.idle)}</span>`}</td>
            <td><div class="adm-acts">${s.cur ? "" : `<button class="btn sm g" data-ses-x="${s.id}">${I("out")}Oturumu kapat</button>`}
              ${s.u === meU ? "" : `<button class="btn sm g" data-ses-all="${esc(s.u)}">${I("lock")}Tüm cihazlardan çıkış</button>`}</div></td></tr>`; }).join("")}</tbody></table></div>`
        : `<div class="empty">Filtreye uyan açık oturum yok.</div>`; };
    drawList();
    body.oninput = e => { if (e.target.dataset.ses === "q") { f.q = e.target.value; drawList(); } };
    body.onchange = e => { const s = e.target.closest("select[data-ses]"); if (s) { f[s.dataset.ses] = s.value; drawList(); } };
    body.onclick = e => {
      const x = e.target.closest("[data-ses-x]"), a = e.target.closest("[data-ses-all]");
      if (x) { const s = sessions().find(v => v.id === x.dataset.sesX), u = H.userBy(s.u) || { name:s.u };
        sesConfirm("Oturumu kapat", kv2("Kullanıcı", esc(u.name), 1) + kv2("Cihaz", `${DEV_K[s.dev][0]} · ${esc(s.client)}`, 1) + kv2("IP", esc(s.ip)),
          "Bu cihazdaki oturum hemen kapanır; kaydedilmemiş bir form varsa kaybolabilir. İşlem denetim kaydına yazılır.", "Oturumu kapat", () => {
            SESS = SESS.filter(v => v.id !== s.id); H.log("Oturum kapatıldı", `${s.u} · ${DEV_K[s.dev][0]} · ${s.ip}`); H.toast("Oturum kapatıldı"); drawList(); }); }
      if (a) { const uu = a.dataset.sesAll, u = H.userBy(uu) || { name:uu }, n = sessions().filter(v => v.u === uu).length;
        sesConfirm("Tüm cihazlardan çıkış", kv2("Kullanıcı", esc(u.name), 1) + kv2("Açık oturum", String(n)),
          "Kişinin bütün cihazlarındaki oturumları kapanır; yeniden girmesi gerekir. Kayıp ya da çalınan telefonda kullanın. İşlem denetim kaydına yazılır.", "Tüm cihazlardan çıkış", () => {
            SESS = SESS.filter(v => v.u !== uu); H.log("Tüm cihazlardan çıkış yaptırıldı", `${uu} · ${n} oturum`); H.toast(`${n} oturum kapatıldı`); drawList(); }); }
    };
  }

  /* ---------- Y5 · Duyuru ----------
   * BACKEND: GET /api/admin/announcements → [ANN] · POST /api/admin/announcements (ANN, id'siz) · POST /api/admin/announcements/:id/end
   *   Kullanıcı tarafı: GET /api/me/announcements → kişinin rolüne/birimine uyan, şu an etkin ve banner:true olanlar (kabuk şeridi: H.announceBar)
   *   ANN: { id, title:string (≤80), body:string (≤280, hasta bilgisi yazılmaz), target:{ kind:"all"|"unit"|"role", ids:[birim ya da rol anahtarı] },
   *          sev:"info"|"warn", start:"ISO", end:"ISO", banner:boolean (üst şerit), notify:boolean (bildirim kanalı),
   *          by:"kullanıcı adı", seen:number (şeridi gören kişi sayısı), ended?:boolean (elle sonlandırıldı) }
   *   Durum sunucuda hesaplanır: start > şimdi → planlandı · end ≤ şimdi ya da ended → geçmiş · diğerleri → yayında. */
  // 30.09c · "şimdi" gerçek saat (takvim). Sürüm duyurusu bir OLAY'dır (kayar); bakım ve tatbikat pencereleri takvimdir (nöbet gününe göre).
  const annNow = () => `${H.isoD(H.clockDate())}T${H.now()}`;
  H.data.announcements = H.data.announcements || [
    { id:"an-104", title:"Yeni sürüm 2.6.1 kuruldu", body:"Yönetim ekranına İzleme bölümü eklendi: sistem durumu, olay günlüğü, veri bütünlüğü ve açık oturumlar.", target:{ kind:"role", ids:["sistem"] }, sev:"info", start:H.ts("2026-09-24T14:10"), end:`${isoDay(3)}T18:00`, banner:true, notify:false, by:"admin", seen:1 },
    { id:"an-103", title:"Planlı bakım: hastane kaydı bağlantısı", body:"Gece 02:00–03:00 arasında hastane kaydı (HBYS) bağlantısı bakımda olacak. Bu sürede kabul ve sonuçlar gecikebilir; kayıtlar sonra kendiliğinden aktarılır.", target:{ kind:"all", ids:[] }, sev:"warn", start:`${isoDay(1)}T00:00`, end:`${isoDay(1)}T03:30`, banner:true, notify:true, by:"admin", seen:0 },
    { id:"an-102", title:"Yangın tatbikatı · 2. Blok", body:"Saat 10:00'da 2. Blok'ta yangın tatbikatı yapılacak. Yoğun bakım yatakları tahliye edilmeyecek.", target:{ kind:"unit", ids:["usq", "nic", "pic"] }, sev:"warn", start:`${isoDay(-2)}T08:00`, end:`${isoDay(-1)}T11:00`, banner:true, notify:true, by:"admin", seen:37 },
    { id:"an-101", title:"Şifre yenileme hatırlatması", body:"Şifresi 90 günü dolan hesaplar ilk girişte yeni şifre ister.", target:{ kind:"all", ids:[] }, sev:"info", start:`${isoDay(-9)}T08:00`, end:`${isoDay(-2)}T08:00`, banner:false, notify:true, by:"admin", seen:212 },
  ];
  const annSt = (a) => { const now = annNow(); return a.ended || a.end <= now ? "past" : a.start > now ? "scheduled" : "active"; };
  const annFor = (a, u) => a.target.kind === "all" || (a.target.kind === "role" ? a.target.ids.includes(u.role) : (u.units || []).some(x => a.target.ids.includes(x)));
  const annDt = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)} ${s.slice(11, 16)}`;
  const annTgt = (t) => t.kind === "all" ? `<span>Herkes</span>` : t.kind === "role" ? t.ids.map(k => `<span>${esc((H.data.roles[k] || { name:k }).name)}</span>`).join(", ") : t.ids.map(k => esc((H.unit(k) || { tr:k }).tr)).join(", ");
  const annBar = (a) => `<div class="ann-b ${a.sev}" role="status" title="${esc(a.body)}">${I(a.sev === "warn" ? "alert" : "bell")}<div class="tx"><b>${esc(a.title)}</b><span>${esc(a.body)}</span></div>`;
  /* Kabuk şeridi: shell.js renderApp üst çubuktan sonra çağırır. Hedefe uyan, yayında ve şeridi açık duyurular; kullanıcı kapatabilir (oturum boyunca). */
  H.announceBar = (main) => {
    if (!main) return; let bar = main.querySelector(":scope > .hmc-ann"); const u = H.state.user;
    const list = u ? H.data.announcements.filter(a => a.banner && annSt(a) === "active" && annFor(a, u) && !IZ.dis.has(a.id)) : [];
    if (!list.length) { if (bar) bar.remove(); main.classList.remove("has-ann"); return; }
    if (!bar) { bar = document.createElement("div"); bar.className = "hmc-ann"; main.insertBefore(bar, main.querySelector(":scope > .content"));
      bar.onclick = e => { const x = e.target.closest("[data-ann-x]"); if (x) { IZ.dis.add(x.dataset.annX); H.announceBar(main); } }; }
    main.classList.add("has-ann");
    bar.innerHTML = list.map(a => `${annBar(a)}<button type="button" data-ann-x="${a.id}" title="Kapat">${I("x")}</button></div>`).join("");
  };
  const annRefresh = () => H.announceBar(document.querySelector("#root .main"));
  function tabAnnounce(body) {
    if (!IZ.ann) IZ.ann = { title:"", body:"", tk:"all", units:[], roles:[], sev:"info", start:`${isoDay(0)}T22:00`, end:`${isoDay(1)}T08:00`, banner:true, notify:false };
    const o = IZ.ann;
    const tgHtml = () => o.tk === "unit" ? fld("units", "Birimler", opts("units", H.units().map(u => [u.id, esc(u.tr)]), o.units, true), 1)
      : o.tk === "role" ? fld("roles", "Roller", opts("roles", Object.entries(H.data.roles).map(([k, r]) => [k, esc(r.name)]), o.roles, true), 1) : "";
    const reach = () => H.data.users.filter(u => u.active !== false && annFor({ target:{ kind:o.tk, ids:o.tk === "unit" ? o.units : o.roles } }, u)).length;
    const pv = () => { const t = esc(o.title.trim() || "Duyuru başlığı"), b = esc(o.body.trim() || "Duyuru metni burada görünür.");
      body.querySelector("[data-an-who]").innerHTML = `<span>${reach()} kişi görecek</span>`;
      body.querySelector("[data-an-pv]").innerHTML = `<div class="an-pv"><div class="an-pv-top"><i></i><i></i><i></i></div>
        ${o.banner ? `<div class="ann-b ${o.sev}">${I(o.sev === "warn" ? "alert" : "bell")}<div class="tx"><b>${t}</b><span>${b}</span></div>${I("x")}</div>` : `<div class="an-pv-off">Şerit kapalı</div>`}
        <div class="an-pv-body"><i></i><i></i><i></i><i></i></div></div>
        ${o.notify ? `<div class="an-pv-n">${I("bell")}<div><b>${t}</b><span>${b}</span></div></div>` : ""}
        ${!o.banner && !o.notify ? `<div class="note" style="margin-top:10px">Gösterim seçilmedi: duyuru kimseye ulaşmaz.</div>` : ""}`; };
    const row = (a) => { const st = annSt(a);
      return `<tr><td style="min-width:220px"><b>${esc(a.title)}</b><div class="adm-sub">${esc(a.body)}</div></td><td class="adm-sub">${annTgt(a.target)}</td>
        <td><span class="${a.sev === "warn" ? "tag w" : "tag"}">${a.sev === "warn" ? "Uyarı" : "Bilgi"}</span></td>
        <td class="mono" style="white-space:nowrap">${annDt(a.start)}<div class="adm-sub">→ ${annDt(a.end)}</div></td>
        <td class="adm-sub" style="white-space:nowrap">${[a.banner ? "<span>Şerit</span>" : "", a.notify ? "<span>Bildirim</span>" : ""].filter(Boolean).join(" · ")}</td><td class="mono">${a.seen}</td>
        <td>${st === "active" ? `<span class="sv" style="--r:var(--ok)">Yayında</span>` : st === "scheduled" ? `<span class="tag">Planlandı</span>` : `<span class="adm-sub">${a.ended ? "Sonlandırıldı" : "Bitti"}</span>`}</td>
        <td><div class="adm-acts">${st === "past" ? `<button class="btn sm g" data-an-copy="${a.id}">${I("swap")}Yeniden kullan</button>` : `<button class="btn sm g" data-an-end="${a.id}">${I("x")}Sonlandır</button>`}</div></td></tr>`; };
    const table = (L) => L.length ? `<div class="tw"><table class="t"><thead><tr><th>Duyuru</th><th>Hedef</th><th>Önem</th><th>Zaman</th><th>Gösterim</th><th>Gören</th><th>Durum</th><th></th></tr></thead><tbody>${L.map(row).join("")}</tbody></table></div>` : `<div class="empty">Kayıt yok.</div>`;
    const A = H.data.announcements, cur = A.filter(a => annSt(a) !== "past"), past = A.filter(a => annSt(a) === "past");
    body.innerHTML = `<div class="g2 an-g">
      <div class="box"><h5>${I("edit")} Yeni duyuru</h5><div data-an-form>
        ${fld("title", "Başlık", `<input data-f="title" maxlength="80" value="${esc(o.title)}" placeholder="Kısa ve açık: ne, ne zaman">`, 1)}
        ${fld("body", "Metin", `<textarea data-f="body" rows="3" maxlength="280" placeholder="En çok 280 karakter · hasta bilgisi yazmayın">${esc(o.body)}</textarea>`, 1)}
        ${fld("tk", "Hedef", opts("tk", [["all", "Herkes"], ["unit", "Birim"], ["role", "Rol"]], o.tk), 1)}
        <div data-an-tg>${tgHtml()}</div>
        ${fld("sev", "Önem", opts("sev", [["info", "Bilgi"], ["warn", "Uyarı"]], o.sev))}
        ${fld("start", "Başlangıç", `<input type="datetime-local" data-f="start" value="${esc(o.start)}">`, 1)}
        ${fld("end", "Bitiş", `<input type="datetime-local" data-f="end" value="${esc(o.end)}">`, 1)}
        ${fld("ch", "Gösterim", chk("banner", o.banner, "Ekranın üstünde şerit") + chk("notify", o.notify, "Bildirim olarak gönder"))}
        <div class="adm-row" style="margin-top:4px"><button class="btn g" data-an-clear>Temizle</button><span class="spacer"></span><button class="btn p" data-an-pub>${I("ok")}Yayımla</button></div></div></div>
      <div class="box"><h5>${I("eye")} Önizleme <span class="r adm-sub" data-an-who></span></h5><div data-an-pv></div>
        <p class="adm-sub" style="margin:10px 0 0">Şerit, hedefteki kullanıcıların bütün ekranlarında üst çubuğun altında görünür. Kullanıcı kapatabilir; bitiş saatinde kendiliğinden kalkar.</p></div></div>
      <div class="sec">Yayında ve planlanmış <small>${cur.length}</small></div>${table(cur)}
      <div class="sec">Geçmiş <small>${past.length}</small></div>${table(past)}
      ${H.adminNote("Kurulum notu: GET/POST /api/admin/announcements · sonlandır: POST /api/admin/announcements/:id/end. Kullanıcı tarafı GET /api/me/announcements yalnız kişinin rolüne ya da birimine uyan, şu an yayında ve şeridi açık olanları döndürür; şerit kabukta (H.announceBar) çizilir. Bildirim, Bildirim kuralları ekranındaki kanalları kullanır.", "div")}`;
    const box = body.querySelector("[data-an-form]");
    bindForm(box, o, (k) => { if (k === "tk") box.querySelector("[data-an-tg]").innerHTML = tgHtml(); pv(); });
    pv();
    body.onclick = e => {
      if (e.target.closest("[data-an-clear]")) { IZ.ann = null; return tabAnnounce(body); }
      const en = e.target.closest("[data-an-end]"); if (en) { const a = A.find(x => x.id === en.dataset.anEnd);
        a.ended = true; a.end = annNow() < a.end ? annNow() : a.end; H.log("Duyuru sonlandırıldı", a.title); H.toast("Duyuru sonlandırıldı", "w"); annRefresh(); return tabAnnounce(body); }
      const cp = e.target.closest("[data-an-copy]"); if (cp) { const a = A.find(x => x.id === cp.dataset.anCopy);
        IZ.ann = { title:a.title, body:a.body, tk:a.target.kind, units:a.target.kind === "unit" ? a.target.ids.slice() : [], roles:a.target.kind === "role" ? a.target.ids.slice() : [],
          sev:a.sev, start:`${isoDay(0)}T22:00`, end:`${isoDay(1)}T08:00`, banner:a.banner, notify:a.notify };
        H.toast("Duyuru forma kopyalandı · tarihleri kontrol edin"); tabAnnounce(body); body.closest(".content") && body.closest(".content").scrollTo({ top:0 }); return; }
      if (e.target.closest("[data-an-pub]")) {
        const miss = []; if (!o.title.trim()) miss.push("title"); if (!o.body.trim()) miss.push("body");
        if (o.tk === "unit" && !o.units.length) miss.push("units"); if (o.tk === "role" && !o.roles.length) miss.push("roles");
        if (!o.start) miss.push("start"); if (!o.end || o.end <= o.start) miss.push("end"); if (!o.banner && !o.notify) miss.push("ch");
        markErr(box, miss);
        if (miss.length) return H.toast(miss.includes("end") && o.end && o.end <= o.start ? "Bitiş, başlangıçtan sonra olmalı" : "Zorunlu alanları kontrol edin", "e");
        const a = { id:"an-" + (105 + A.length), title:o.title.trim(), body:o.body.trim(), target:{ kind:o.tk, ids:o.tk === "unit" ? o.units.slice() : o.tk === "role" ? o.roles.slice() : [] },
          sev:o.sev, start:o.start, end:o.end, banner:!!o.banner, notify:!!o.notify, by:(H.state.user || {}).u, seen:0 };
        A.unshift(a); H.log("Duyuru yayımlandı", `${a.title} · ${a.target.kind}${a.target.ids.length ? ": " + a.target.ids.join(", ") : ""} · ${annDt(a.start)} → ${annDt(a.end)}`);
        H.toast(annSt(a) === "scheduled" ? "Duyuru planlandı" : "Duyuru yayımlandı"); IZ.ann = null; annRefresh(); tabAnnounce(body);
      }
    };
  }

  /* ---------- Y6 · Yedek ve geri yükleme ----------
   * BACKEND: GET /api/admin/backups?limit=14 → [BACKUP]
   *   BACKUP: { id, at:"ISO", kind:"full"|"incremental"|"manual", sizeBytes:number, durationSec:number, result:"ok"|"failed", error?:string,
   *             location:"local+offsite"|"local", checksum:"sha256" }
   *   GET/PUT /api/admin/backup-policy → { time:"HH:MM", mode:"full"|"weekly_full_daily_incr", retentionDays:number, offsite:boolean }  (şifreleme hep açık)
   *   POST /api/admin/backups → { jobId } · GET /api/admin/backups/jobs/:jobId → { progress:0-100, phase:string, etaSec:number }
   *   GET /api/admin/restore-tests/last → { at:"ISO", backupId, result:"ok"|"failed", durationMin, by }
   *   POST /api/admin/restore { backupId, target:"test"|"live", confirmName } → test: { jobId } · live: { requestId, status:"awaiting_second_admin" }
   *   Canlıya geri yükleme İKİNCİ bir sistem yöneticisinin onayını ister; sunucu confirmName'i hastane adıyla karşılaştırır. */
  function bkInit() {
    if (IZ.bk) return IZ.bk;
    const list = [];
    for (let i = 0; i < 14; i++) { const fail = i === 5;
      list.push({ id:"bk-" + (2600 - i), d:H.dm(-i), t:"02:00", kind:"Tam", size:fail ? "—" : (18.4 - i * 0.06).toFixed(1).replace(".", ",") + " GB", dur:fail ? "12 dk" : `${47 - (i % 4)} dk`,
        ok:!fail, err:fail ? "Kurum dışı hedef yanıt vermedi (bağlantı zaman aşımı). Yerel kopya tamamlanamadı; bir sonraki gece yedeği başarılı." : "", loc:fail ? "Yerel" : "Yerel + kurum dışı" }); }
    return (IZ.bk = { list, pol:{ time:"02:00", mode:"full", keep:30, offsite:true }, edit:null, test:{ d:H.dmy(-43), days:43, ok:true, dur:"38 dk", by:"admin" }, testRun:false, pending:null, running:false });
  }
  function bkRun(redraw) {
    const B = bkInit(); if (B.running) return H.toast("Yedek zaten alınıyor", "w");
    B.running = true; let p = 0; H.log("Elle yedek başlatıldı", `${H.dm(0)} ${H.now()}`);
    H.modal({ title:"Yedek alınıyor", body:`<div class="adm-row" style="justify-content:space-between;margin-bottom:8px"><b data-bk-ph>Veritabanı kopyalanıyor</b><span class="mono" data-bk-p>0%</span></div>
      <div class="bk-bar"><i data-bk-bar style="width:0%"></i></div>
      <p class="adm-sub" style="margin:10px 0 0">Yedek alınırken sistem çalışmaya devam eder. Bu pencereyi kapatabilirsiniz; yedek arka planda sürer.</p>`,
      actions:`<button class="btn" data-x>Arka planda sürsün</button>` });
    const PH = [[0, "Veritabanı kopyalanıyor"], [45, "Dosyalar sıkıştırılıyor"], [80, "Şifreleniyor ve doğrulanıyor"]];
    const tm = setInterval(() => { p = Math.min(100, p + 7); const ph = PH.filter(x => p >= x[0]).pop()[1], q = (s) => document.querySelector(s);
      if (q("[data-bk-p]")) { q("[data-bk-p]").textContent = p + "%"; q("[data-bk-bar]").style.width = p + "%"; if (q("[data-bk-ph]").dataset.v !== ph) { q("[data-bk-ph]").dataset.v = ph; q("[data-bk-ph]").textContent = ph; } }
      if (p >= 100) { clearInterval(tm); B.running = false; B.list.forEach(x => { x.fresh = false; });
        B.list.unshift({ id:"bk-" + (2601 + B.list.length), d:H.dm(0), t:H.now(), kind:"Tam (elle)", size:"18,5 GB", dur:"6 dk", ok:true, err:"", loc:B.pol.offsite ? "Yerel + kurum dışı" : "Yerel", fresh:true });
        H.log("Elle yedek tamamlandı", `${H.dm(0)} ${H.now()} · 18,5 GB`); if (q("[data-bk-p]")) H.closeModal(); H.toast("Yedek tamamlandı · 18,5 GB"); redraw(); } }, 300);
  }
  function bkRestore(b, target, redraw) {
    const B = bkInit(), hn = H.data.hospital.name, o = { target:target || "test", name:"" };
    const match = () => o.name.trim().toLocaleLowerCase("tr") === hn.toLocaleLowerCase("tr");
    const warnH = () => o.target === "live"
      ? `<div class="note bk-live">${I("alert")} Canlı sisteme geri yükleme, ${b.d} ${b.t} sonrasında girilen bütün kayıtları geri alır. İstek, ikinci bir sistem yöneticisinin onayından sonra planlı bir bakım penceresinde çalışır.</div>`
      : `<div class="note i">${I("shield")} Yedek ayrı bir test ortamına açılır; canlı sistem etkilenmez. Sonuç “Son geri yükleme testi” kutusuna yazılır.</div>`;
    const okBtn = () => `<button class="btn ${o.target === "live" ? "d" : "p"}" data-rs-ok${match() ? "" : " disabled"}>${I(o.target === "live" ? "alert" : "ok")}${o.target === "live" ? "Onaya gönder" : "Test geri yüklemesini başlat"}</button>`;
    H.modal({ title:"Yedekten geri yükle", body:`${kv2("Yedek", `${b.d} ${b.t} · ${esc(b.size)}`)}${kv2("Tür", esc(b.kind), 1)}
        <div data-rs-form style="margin-top:12px">${fld("target", "Nereye", opts("target", [["test", "Test ortamına (önerilir)"], ["live", "Canlı sisteme"]], o.target), 1)}
        <div data-rs-warn>${warnH()}</div>
        <div class="fld col" style="margin-top:12px"><label>Onaylamak için hastanenin adını yazın: <b data-notr>${esc(hn)}</b></label><div><input data-f="name" autocomplete="off" spellcheck="false"></div></div></div>`,
      actions:`<button class="btn" data-x>Vazgeç</button><span data-rs-okw>${okBtn()}</span>`,
      onMount(m) {
        bindForm(m.querySelector("[data-rs-form]"), o, (k) => { if (k === "target") m.querySelector("[data-rs-warn]").innerHTML = warnH(); m.querySelector("[data-rs-okw]").innerHTML = okBtn(); });
        m.addEventListener("click", e => { const k = e.target.closest("[data-rs-ok]"); if (!k || k.disabled || !match()) return;
          H.closeModal();
          if (o.target === "live") { B.pending = { b, at:`${H.dm(0)} ${H.now()}` }; H.log("Geri yükleme isteği (canlı)", `${b.d} ${b.t} yedeği · ikinci yönetici onayı bekleniyor`);
            H.toast("Geri yükleme isteği oluşturuldu · ikinci yönetici onayı bekleniyor", "w"); redraw(); return; }
          B.testRun = true; H.log("Geri yükleme testi başlatıldı", `${b.d} ${b.t} yedeği · test ortamı`); H.toast("Test ortamına geri yükleme başladı"); redraw();
          setTimeout(() => { B.testRun = false; B.test = { d:H.dmy(0), days:0, ok:true, dur:"36 dk", by:(H.state.user || {}).u }; H.log("Geri yükleme testi başarılı", `${b.d} ${b.t} yedeği`); H.toast("Geri yükleme testi başarılı"); redraw(); }, 3500);
        });
      } });
  }
  function tabBackup(body) {
    const B = bkInit(), redraw = () => { if (body.isConnected && AD.tab === "backup") tabBackup(body); }, last = B.list[0], lastOk = B.list.find(x => x.ok);
    if (!B.edit) B.edit = clone(B.pol); const e0 = B.edit, dirty = JSON.stringify(e0) !== JSON.stringify(B.pol);
    const stale = B.test.days > 30;
    body.innerHTML = `<div class="adm-bar"><span class="adm-sub"><span>Yedekler şifreli alınır</span> · <span>her gece</span> <b class="mono">${B.pol.time}</b></span><span class="spacer"></span>
        <button class="btn" data-bk-test${B.testRun ? " disabled" : ""}>${I("shield")}${B.testRun ? "Test sürüyor…" : "Geri yükleme testi"}</button>
        <button class="btn p" data-bk-now${B.running ? " disabled" : ""}>${I("file")}${B.running ? "Yedek alınıyor…" : "Şimdi yedek al"}</button></div>
      ${B.pending ? `<div class="note bk-live" style="margin-bottom:12px">${I("alert")} <span>Canlıya geri yükleme isteği · ikinci yönetici onayı bekleniyor</span> · <span class="mono">${B.pending.b.d} ${B.pending.b.t}</span> <button class="btn sm" data-bk-cancel style="margin-left:8px">İsteği geri çek</button></div>` : ""}
      ${stale ? `<div class="note" style="margin-bottom:12px">${I("alert")} Son geri yükleme testi ${B.test.days} gün önce yapıldı. Yedeğin gerçekten açılabildiğini görmek için en az ayda bir test önerilir.</div>` : ""}
      <div class="adm-nums bk-nums">
        <div><small>Son yedek</small><b class="mono">${last.d} ${last.t}</b><span>${last.ok ? `<span>Başarılı</span> · ${esc(last.size)}` : "<span>Başarısız</span>"}</span></div>
        <div><small>Sonraki yedek</small><b class="mono">${H.dm(1)} ${B.pol.time}</b><span>${B.pol.mode === "full" ? "Tam yedek" : "Artımlı yedek"}</span></div>
        <div><small>Saklama</small><b>${B.pol.keep} gün</b><span>${B.pol.offsite ? "Yerel + kurum dışı kopya" : "Yalnız yerel"}</span></div>
        <div class="${stale ? "bk-stale" : ""}"><small>Son geri yükleme testi</small><b class="mono">${B.test.d}</b><span>${B.testRun ? "Test sürüyor" : B.test.days ? `<span>${B.test.days} gün önce</span> · <span>Başarılı</span>` : "<span>Bugün</span> · <span>Başarılı</span>"}</span></div></div>
      <div class="sec">Son yedekler <small>${B.list.length}</small></div>
      <div class="tw"><table class="t"><thead><tr><th>Zaman</th><th>Tür</th><th class="n">Boyut</th><th class="n">Süre</th><th>Sonuç</th><th>Konum</th><th></th></tr></thead><tbody>
        ${B.list.map(x => `<tr class="${x.fresh ? "fresh" : ""}"><td class="mono" style="white-space:nowrap">${x.d} <b>${x.t}</b></td><td>${esc(x.kind)}</td><td class="n mono">${esc(x.size)}</td><td class="n mono">${esc(x.dur)}</td>
          <td>${x.ok ? `<span class="sv" style="--r:var(--ok)">Başarılı</span>` : `<span class="tag c">Başarısız</span>`}</td><td class="adm-sub">${esc(x.loc)}</td>
          <td><div class="adm-acts">${x.ok ? `<button class="btn sm g" data-bk-rs="${x.id}">${I("swap")}Geri yükle</button>` : `<button class="btn sm g" data-bk-err="${x.id}">${I("alert")}Hata ayrıntısı</button>`}</div></td></tr>`).join("")}</tbody></table></div>
      <div class="box" style="margin-top:12px"><h5>${I("clock")} Zamanlama ve saklama</h5><div data-bk-form>
        ${fld("time", "Yedek saati", `<div class="bk-time">` + sel("time", ["00:00", "01:00", "02:00", "03:00", "04:00", "05:00"], e0.time) + `</div>`)}
        ${fld("mode", "Tür", opts("mode", [["full", "Her gece tam yedek"], ["incr", "Haftada bir tam · her gece artımlı"]], e0.mode))}
        ${fld("keep", "Saklama süresi", `<div class="adm-row" style="flex-wrap:nowrap"><input data-f="keep" class="adm-num" inputmode="numeric" value="${esc(e0.keep)}"><span class="adm-sub">gün</span></div>`)}
        ${fld("offsite", "Kurum dışı kopya", chk("offsite", e0.offsite, "Her yedeğin bir kopyası kurum dışındaki şifreli alana gönderilsin"))}
        ${fld("enc", "Şifreleme", `<span class="pill">${I("lock")}Açık · kapatılamaz</span>`)}</div>
        <div class="adm-row" style="margin-top:4px"><span class="adm-sub">${dirty ? "Kaydedilmemiş değişiklik var" : "Kayıtlı ayarlar"}</span><span class="spacer"></span><button class="btn g" data-bk-undo>Geri al</button><button class="btn p" data-bk-save>${I("ok")}Kaydet</button></div></div>
      ${H.adminNote("Kurulum notu: GET /api/admin/backups?limit=14 · GET/PUT /api/admin/backup-policy · POST /api/admin/backups (iş başlatır; ilerleme GET /api/admin/backups/jobs/:id) · POST /api/admin/restore { backupId, target: test|live, confirmName }. Canlıya geri yükleme ikinci yönetici onayı ister; sunucu confirmName'i de denetler. Saklama süresi yerel mevzuata göre hastanece belirlenir.", "div")}`;
    const form = body.querySelector("[data-bk-form]");
    bindForm(form, e0, () => { const s = body.querySelector("[data-bk-save]").parentElement.querySelector(".adm-sub"); s.textContent = JSON.stringify(normBk(e0)) !== JSON.stringify(B.pol) ? "Kaydedilmemiş değişiklik var" : "Kayıtlı ayarlar"; });
    body.onclick = e => {
      if (e.target.closest("[data-bk-now]")) return bkRun(redraw);
      if (e.target.closest("[data-bk-test]")) return bkRestore(lastOk, "test", redraw);
      if (e.target.closest("[data-bk-cancel]")) { H.log("Geri yükleme isteği geri çekildi", `${B.pending.b.d} ${B.pending.b.t}`); B.pending = null; H.toast("Geri yükleme isteği geri çekildi"); return redraw(); }
      const rs = e.target.closest("[data-bk-rs]"); if (rs) return bkRestore(B.list.find(x => x.id === rs.dataset.bkRs), "test", redraw);
      const er = e.target.closest("[data-bk-err]"); if (er) { const x = B.list.find(v => v.id === er.dataset.bkErr);
        return drawer("Yedek hatası", `${kv2("Zaman", `${x.d} ${x.t}`)}${kv2("Süre", esc(x.dur))}${kv2("Konum", esc(x.loc), 1)}<div class="note" style="margin-top:12px">${esc(x.err)}</div>
          <pre class="adm-json" data-notr style="margin-top:12px">${esc(JSON.stringify({ id:x.id, result:"failed", stage:"offsite_upload", error:"ETIMEDOUT", retries:3 }, null, 2))}</pre>`, `<button class="btn" data-x>Kapat</button>`); }
      if (e.target.closest("[data-bk-undo]")) { B.edit = null; return tabBackup(body); }
      if (e.target.closest("[data-bk-save]")) { const n = normBk(e0);
        if (!(n.keep >= 7 && n.keep <= 365)) { markErr(form, ["keep"]); return H.toast("Saklama süresi 7–365 gün olmalı", "e"); }
        if (JSON.stringify(n) === JSON.stringify(B.pol)) return H.toast("Değişiklik yok");
        B.pol = n; B.edit = null; H.log("Yedekleme ayarları kaydedildi", `${n.time} · ${n.mode} · ${n.keep} gün · kurum dışı ${n.offsite ? "açık" : "kapalı"}`); H.toast("Yedekleme ayarları kaydedildi"); tabBackup(body); }
    };
  }
  const normBk = (o) => ({ time:o.time, mode:o.mode, keep:parseInt(o.keep, 10), offsite:!!o.offsite });

  /* ---------- Y7 · Rol gözüyle bak ----------
   * Kapı ekranı: asıl önizleme kabukta (shell.js H.previewAs · üst çubuktaki "Rol gözüyle bak" çipi). Burada yeniden yazılmaz.
   * BACKEND: POST /api/admin/preview { role } → önizleme oturumu (salt okunur; yazma istekleri 403) · DELETE /api/admin/preview → kapat.
   *   İkisi de denetim kaydına yazılır. Rol → yetki listesi GET /api/admin/roles'tan (bu ekran H.data.roles'u okur). */
  function tabViewAs(body) {
    const real = H.state.realUser || H.state.user || {}, can = real.role === "sistem" && typeof H.previewAs === "function";
    const MAINP = ALLP.filter(p => !p.startsWith("pt_")), nPT = (H.PT_TABS || []).length;
    const roles = Object.entries(H.data.roles).filter(([k]) => k !== real.role);
    body.innerHTML = `<div class="note i" style="margin-bottom:12px">${I("eye")} Seçtiğiniz rolün menüsünü ve ekranlarını o rolün yetkileriyle görürsünüz. Bu görünüm salt okunurdur: kayıt açılmaz, form kaydedilmez. Her açılış ve kapanış denetim kaydına yazılır.</div>
      <div class="va-g">${roles.map(([k, r]) => { const has = MAINP.filter(p => r.perms.includes(p)), not = MAINP.filter(p => !r.perms.includes(p)), pt = (H.PT_TABS || []).filter(t => r.perms.includes("pt_" + t[0])).length;
        const n = H.data.users.filter(u => u.role === k && u.active !== false).length;
        return `<div class="card va-c"><div class="adm-row"><b class="va-n">${esc(r.name)}</b><span class="adm-sub">${esc(r.group)}</span><span class="pill" style="margin-left:auto">${n} kişi</span></div>
          <div class="va-l">Görür</div><div class="va-t">${has.map(p => `<span class="tag">${esc(permLabel(p))}</span>`).join("")}</div>
          <div class="va-l">Görmez</div><div class="va-t">${not.slice(0, 5).map(p => `<span class="tag va-no">${esc(permLabel(p))}</span>`).join("")}${not.length > 5 ? `<span class="adm-sub">+${not.length - 5} ekran daha</span>` : ""}</div>
          <div class="kv"><span>Hasta ekranı sekmeleri</span><b>${pt} / ${nPT}</b></div>
          <div class="kv"><span>Hasta adını görür</span><b style="font-family:Figtree">${r.names ? "Evet" : "Hayır · yalnız yatak no"}</b></div>
          <button class="btn ${can ? "p" : ""} va-b" data-va="${k}"${can ? "" : " disabled"}>${I("eye")}Bu rolün gözüyle aç</button></div>`; }).join("")}</div>
      ${can ? "" : `<div class="note" style="margin-top:12px">Rol gözüyle bakış yalnız sistem yöneticisi hesabında açılır.</div>`}
      <p class="adm-sub" style="margin-top:12px">Üst çubuktaki “Rol gözüyle bak” düğmesi de aynı görünümü açar. Kendi görünümünüze dönmek için oradan kendi rolünüzü seçin.</p>
      ${H.adminNote("Kurulum notu: önizleme sunucuda salt okunur zorlanmalı; önizleme oturumunda her yazma isteği 403 döner. Açma POST /api/admin/preview { role }, kapatma DELETE /api/admin/preview; ikisi de denetim kaydına yazılır. Prototipte geçiş kabukta H.previewAs ile yapılır.", "div")}`;
    body.onclick = e => { const b = e.target.closest("[data-va]"); if (!b || b.disabled) return; H.previewAs(b.dataset.va); };
  }
})();

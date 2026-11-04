/* Homunculus prototip v1 — ana ekranlar: yatak paneli, alarmlar, devir, hızlı yanıt, eczane, cihazlar, yönetici özeti, ayarlar, profil. */
(function () {
  const H = window.H, I = H.icon, esc = H.esc;
  const unitsInView = () => (H.state.unitId ? [H.unit(H.state.unitId)] : H.state.user.units.map(H.unit)).filter(u => u && u.live !== false);
  const nm = (u) => (H.userBy(u) || {}).name || u;
  const lateTasks = (pid) => H.data.tasks.filter(t => (!pid || t.pid === pid) && t.state === "late" && H.inScope(t.pid));
  const hhmm = (t) => { const h = Math.floor(t) % 24, m = Math.round((t % 1) * 60); return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"); };

  /* ================= YATAK PANELİ ================= */
  const flagChips = (p) => {
    const f = [], lv = { "yüksek":"h", "orta":"m" };
    if (p.allergies.length) f.push(`<span class="c">Alerji</span>`);
    if (p.isolation) f.push(`<span class="m">İzolasyon · ${p.isolation}</span>`);
    if (p.flags.fall && p.flags.fall !== "düşük") f.push(`<span class="${lv[p.flags.fall]}">Düşme ${p.flags.fall}</span>`);
    if (p.flags.braden && p.flags.braden !== "düşük") f.push(`<span class="${lv[p.flags.braden]}">Bası yarası ${p.flags.braden}</span>`);
    if (p.flags.pain >= 4) f.push(`<span class="${p.flags.pain >= 7 ? "c" : "m"}">Ağrı ${p.flags.pain}</span>`);
    const late = lateTasks(p.id).length; if (late) f.push(`<span class="c">${late} geciken iş</span>`);
    return f.length ? `<div class="flags">${f.join("")}</div>` : "";
  };
  const vitRow = (p) => `<div class="vit"><div><small style="color:var(--v-hr)">HR</small>${p.v.hr}</div><div><small style="color:var(--v-map)">${p.ageGroup === "adult" ? "MAP" : "KB"}</small>${p.ageGroup === "adult" ? p.v.map : p.v.sbp + "/" + p.v.dbp}</div><div><small style="color:var(--v-spo)">SpO₂</small>${p.v.spo2}</div><div><small style="color:var(--v-rr)">RR</small>${p.v.rr}</div><div><small style="color:var(--v-t)">Isı</small>${p.v.temp}</div></div>`;
  const srcLine = (p) => p.monitored ? `<span>${I("activity")} Monitör · canlı</span>` : (() => { const due = H.data.tasks.find(t => t.pid === p.id && t.form === "vitals" && (t.state === "late" || t.state === "due"));
    const le = H.lastEntry && H.lastEntry(p.id, "vitals");   // 30.09: son gerçek vital kaydı (sabit 20:00 değil)
    return `<span>Son ölçüm ${le ? H.entryText(le) : "—"} · elle</span>${due ? `<span style="color:${due.state === "late" ? "var(--crit)" : "var(--pri)"};font-weight:700">Vital ${due.state === "late" ? "gecikti" : "zamanı"} · ${hhmm(due.t)}</span>` : ""}`; })();
  function bedCard(b, u) {
    const p = b.pid && H.pt(b.pid);
    if (!p) { const st = { bos:["Boş", "var(--ok)", "Hasta atanabilir"], temizlik:["Temizlikte", "var(--mid)", `Temizlik ${H.at("21:10")}'da başladı`], bloke:["Bloke", "var(--crit)", "Arıza · biyomedikal bilgilendirildi"], rezerve:["Rezerve", "var(--low)", "Ameliyathaneden gelecek hasta"] }[b.status] || ["—", "var(--line2)", ""];
      return `<div class="bed empty" style="--r:${st[1]}"><div class="h"><div><span class="no">${b.no}</span><span class="nm" style="color:var(--mute)">${st[0]}</span><div class="mt">Oda ${b.room} · ${st[2]}</div></div></div>${b.status === "bos" && H.can("admission") ? `<div style="margin-top:10px"><button class="btn sm" data-admit="${b.id}">${I("plus")} Hasta ata</button></div>` : ""}</div>`; }
    const s = H.SEV[p.risk], hr = H.series(p.id, "hr", 8, 40).map(x => x.v);
    return `<div class="bed" style="--r:${s.c}" data-pid="${p.id}"><div class="h"><div style="min-width:0"><span class="no">${b.no}</span><span class="nm">${H.esc(p.name)}</span><div class="mt">${H.ageText(p)} ${p.sex} · ${H.esc(p.dx)}</div></div>${H.sevPill(p.risk)}</div>
      ${vitRow(p)}${H.spark(hr, s.c)}${flagChips(p)}<div class="ft"><span>${H.scoreLabel(p)}</span>${srcLine(p)}</div></div>`;
  }
  H.register("beds", { title:() => H.t("m_beds"), perm:"beds", render(root) {
    const units = unitsInView(), pts = H.myPatients().filter(p => units.some(u => u.id === H.bed(p.bed).unitId));
    const occ = units.reduce((a, u) => a + u.beds.filter(b => b.status === "dolu").length, 0), tot = units.reduce((a, u) => a + u.beds.length, 0);
    const alarms = H.openAlarms(), hand = H.data.handovers.filter(h => h.state === "waiting" && H.inScope(h.pid)), late = lateTasks();
    const att = [
      H.can("alarms") && [alarms.some(a => a.sev === "crit") ? "crit" : "", "bell", alarms.length, `alarm yanıt bekliyor${alarms.length ? ", en eskisi " + Math.round(Math.max(...alarms.map(a => a.ageMin))) + " dk" : ""}`, "alarms"],
      H.can("tasks") && [late.length ? "crit" : "ok", "clock", late.length, "geciken hemşirelik işi (vital, ağrı, pozisyon…)", "tasks"],
      H.can("hand") && [hand.length ? "" : "ok", "clip", hand.length, "devir karşı imzanızı bekliyor", "hand"],
      ["", "flask", 3, "sonuç görülmedi · laktat 4.1 dahil", null],
      H.can("devices") || H.can("beds") ? ["", "plug", 1, "cihaz sessiz · RE07, 6 dk'dır veri yok", H.can("devices") ? "devices" : null] : null,
    ].filter(Boolean).slice(0, 4);
    const card = H.state.bedView === "kart";
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_beds")}</h2><p>${units.length === 1 ? H.esc(units[0].tr) : units.length + " birim"} · ${occ} / ${tot} dolu · son veri 2 sn önce</p></div>
      <div class="r"><div class="seg" data-bv><button data-v="kart" class="${card ? "on" : ""}">Kart</button><button data-v="liste" class="${!card ? "on" : ""}">Liste</button></div>${H.can("admission") ? `<button class="btn p" data-admit="">${I("plus")} Hasta kabul</button>` : ""}</div></div>
      <div class="att">${att.map(([c, ic, n, t, go]) => `<div class="ac ${c}" ${go ? `data-att="${go}"` : ""}><div class="i">${I(ic)}</div><b>${n}</b><span>${t}</span></div>`).join("")}</div>
      ${units.map(u => { const ups = u.beds.map(b => ({ b, p:b.pid && H.pt(b.pid) })).sort((a, z) => (a.p ? 0 : 1) - (z.p ? 0 : 1) || (a.p && z.p ? ["crit","high","mid","low","stable"].indexOf(a.p.risk) - ["crit","high","mid","low","stable"].indexOf(z.p.risk) : 0));
        return `<div class="sec">${H.esc(u.tr)} <span class="pill">${H.kindName(u.kind)}</span> <span class="pill">${H.floorText(u.floor)}</span> <span class="pill" title="${H.TIER[u.tier][1]}">${H.TIER[u.tier][0]}${u.rule !== "—" ? " · " + u.rule : ""}</span><small>${u.beds.filter(b => b.status === "dolu").length} / ${u.beds.length} dolu · risk sırasına göre</small></div>
        ${card ? `<div class="beds">${ups.map(({ b }) => bedCard(b, u)).join("")}</div>`
        : `<div class="tw"><table class="t"><tr><th>Yatak</th><th>Hasta</th><th>Durum</th><th>HR</th><th>KB</th><th>SpO₂</th><th>RR</th><th>Isı</th><th>Skor</th><th>Uyarılar</th></tr>
          ${ups.map(({ b, p }) => p ? `<tr class="row" data-pid="${p.id}"><td class="n" style="color:${H.SEV[p.risk].c}">${b.no}</td><td><b>${H.esc(p.name)}</b><div class="mute" style="font-size:11.5px">${H.ageText(p)} ${p.sex} · ${H.esc(p.dx)}</div></td><td>${H.sevPill(p.risk)}</td><td class="n" style="color:var(--v-hr)">${p.v.hr}</td><td class="n" style="color:var(--v-map)">${p.v.sbp}/${p.v.dbp}</td><td class="n" style="color:var(--v-spo)">${p.v.spo2}</td><td class="n" style="color:var(--v-rr)">${p.v.rr}</td><td class="n">${p.v.temp}</td><td>${H.scoreLabel(p)}</td><td>${flagChips(p)}</td></tr>`
            : `<tr><td class="n mute">${b.no}</td><td colspan="9" class="mute">${{ bos:"Boş", temizlik:"Temizlikte", bloke:"Bloke", rezerve:"Rezerve" }[b.status]}</td></tr>`).join("")}</table></div>`}`; }).join("")}`;
    root.addEventListener("click", e => {
      const pc = e.target.closest("[data-pid]"); if (pc) return H.can("patient") ? H.go("patient", { pid:pc.dataset.pid, tab:"ozet" }) : H.toast("Hasta ekranına erişim yetkiniz yok.", "w");
      const bv = e.target.closest("[data-bv] button"); if (bv) { H.state.bedView = bv.dataset.v; H.savePref("bedView", bv.dataset.v); return H.renderApp(); }
      const at = e.target.closest("[data-att]"); if (at) return H.go(at.dataset.att);
      const ad = e.target.closest("[data-admit]"); if (ad) return H.go("admission", ad.dataset.admit ? { bed:ad.dataset.admit } : {});
    });
  } });

  /* ================= TÜM GELİŞLER / İŞ LİSTESİ (doktorun ana giriş ekranı) ================= */
  // Birimlerinizdeki tüm başvurular: hangi hasta ne amaçla gelmiş (başvuru tipi + tanı), lab/rad sayısı, "Göreve git".
  H.register("gelisler", { title:() => H.t("m_gelisler"), perm:"beds", render(root, params = {}) {
    const pts = H.myPatients(), enc = params.enc || "hepsi";
    const filt = enc === "hepsi" ? pts : pts.filter(p => H.encOf(p) === enc);
    const ordCount = (pid, cat) => (H.data.orders || []).filter(o => o.pid === pid && o.cat === cat).length;
    const encTabs = [["hepsi", "Hepsi"], ["ayaktan", "Ayaktan"], ["gunubirlik", "Günübirlik"], ["yatan", "Yatan"], ["yogun", "Yoğun bakım"]];
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_gelisler")}</h2><p>${filt.length} hasta · birimlerinizdeki tüm başvurular</p></div><div class="r"><button class="btn" data-gelexp>${I("save") || ""} Excel</button></div></div>
      <div class="seg" style="margin-bottom:8px" data-enctabs>${encTabs.map(([k, l]) => `<button data-enc="${k}" class="${enc === k ? "on" : ""}">${l}${k !== "hepsi" ? ` (${pts.filter(p => H.encOf(p) === k).length})` : ""}</button>`).join("")}</div>
      <div class="adm-bar" style="margin-bottom:10px">${H.filterBox("Hasta / tanı / birim ara…")}</div>
      <div class="tw"><table class="t"><thead><tr><th>Hasta</th><th style="width:110px">Başvuru</th><th>Tanı / amaç</th><th style="width:60px">Lab</th><th style="width:60px">Rad</th><th>Birim</th><th>Hekim</th><th style="width:110px"></th></tr></thead><tbody>
      ${filt.length ? filt.map(p => { const b = H.bed(p.bed), e = H.encOf(p), ei = H.ENC[e] || {}, u = b && H.unit(b.unitId), att = H.userBy(p.attending);
        return `<tr class="row" data-pid="${p.id}"><td><b>${H.esc(H.showNames() ? p.name : (b ? b.no : "—"))}</b><div class="mute" style="font-size:11.5px">${H.ageText(p)} ${p.sex} · ${b ? H.esc(b.no) : ""}</div></td>
          <td>${H.encIcon(p)} <span class="tag">${H.esc(ei.label || e)}</span> ${H.protoLock(p)}</td>
          <td>${H.esc(p.dx || "")} ${p.icd ? `<span class="mono mute">${H.esc(p.icd)}</span>` : ""}</td>
          <td class="n">${ordCount(p.id, "Laboratuvar")}</td><td class="n">${ordCount(p.id, "Radyoloji")}</td>
          <td class="mute" style="font-size:12px">${u ? H.esc(u.tr) : "—"}</td><td class="mute" style="font-size:12px">${H.esc(att ? att.name : "—")}</td>
          <td><button class="btn sm p" data-goto="${p.id}">${I("link")}Göreve git</button></td></tr>`; }).join("")
        : `<tr><td colspan="8" class="mute" style="padding:20px;text-align:center">Bu grupta hasta yok.</td></tr>`}
      </tbody></table></div>`;
    root.onclick = (e) => {
      if (e.target.closest("[data-gelexp]")) { H.exportCsv("Gelisler", ["Hasta", "Başvuru", "Tanı", "Birim", "Hekim"], filt.map(p => { const b = H.bed(p.bed), u = b && H.unit(b.unitId), att = H.userBy(p.attending); return [H.showNames() ? p.name : (b ? b.no : "—"), (H.ENC[H.encOf(p)] || {}).label || H.encOf(p), p.dx || "", u ? u.tr : "—", att ? att.name : "—"]; })); H.toast("Excel (CSV) indirildi"); return; }
      const en = e.target.closest("[data-enc]"); if (en) return H.go("gelisler", { enc:en.dataset.enc });
      const g = e.target.closest("[data-goto]"); if (g) return H.can("patient") ? H.go("patient", { pid:g.dataset.goto, tab:"ozet" }) : H.toast("Hasta ekranına erişim yetkiniz yok.", "w");
      const pc = e.target.closest("[data-pid]"); if (pc) return H.can("patient") ? H.go("patient", { pid:pc.dataset.pid, tab:"ozet" }) : H.toast("Hasta ekranına erişim yetkiniz yok.", "w");
    };
    H.wireFilter(root);
  } });

  /* ================= DOKTOR İŞ LİSTESİ ================= */
  H.register("drislem", { title:() => H.t("m_drislem"), perm:"results", render(root, params = {}) {
    const me = H.state.user || {}, myName = me.name || "";
    const today = new Date().toISOString().slice(0, 10);
    const all = (H.data.randevular = H.data.randevular || seedRandevu());
    const mine = all.filter(r => (r.doktor || "") === myName);
    const bekRand = (mine.length ? mine : all).filter(r => (r.tarih || "").slice(0, 10) === today && (r.durum === "Bekliyor" || r.durum === "Geldi"));
    const fallback = !mine.length && bekRand.length;
    const myPts = H.myPatients();
    const pend = (pid, cat) => (H.data.orders || []).filter(o => o.pid === pid && (o.cat || "").includes(cat) && !/Sonuçland|Tamam/.test(o.durum || "")).length;
    const sonucBek = myPts.reduce((a, p) => a + pend(p.id, "Laboratuvar") + pend(p.id, "Radyoloji"), 0);
    // Lab/Rad "tamam/toplam" (referanstaki 5/5 gibi) + muayene imza durumu (docs.js muayene belgesi)
    const cnt = (pid, cat) => { const os = (H.data.orders || []).filter(o => o.pid === pid && (o.cat || "").includes(cat)); return [os.filter(o => /Sonuçland|Tamam/.test(o.durum || "")).length, os.length]; };
    const xy = (a) => a[1] ? `${a[0]}/${a[1]}` : "—";
    const muaDoc = (pid) => (H.data.docs || []).filter(x => x.pid === pid && x.type === "muayene").sort((a, z) => (z.at || "").localeCompare(a.at || ""))[0];
    const muaSigned = (d) => !!d && (d.status === "muhur" || d.status === "imzali");
    const muaTag = (pid) => { const d = muaDoc(pid); return d ? `<span class="tag ${muaSigned(d) ? "ok" : "w"}">${muaSigned(d) ? "İmzalı" : "Taslak"}</span>` : `<span class="tag">—</span>`; };
    const imzaBek = myPts.reduce((a, p) => { const d = muaDoc(p.id); return a + (d && !muaSigned(d) ? 1 : 0); }, 0);
    const epiBek = myPts.reduce((a, p) => a + (H.data.docs || []).filter(x => x.pid === p.id && x.type === "epikriz" && x.status !== "muhur").length, 0);
    const kutu = (n, l, key) => `<div class="box" ${key && n ? `data-drq="${key}" role="button" tabindex="0" title="Kuyruğu aç"` : ""} style="text-align:center;min-width:110px;flex:1${key && n ? ";cursor:pointer" : ""}"><div style="font-size:24px;font-weight:800;color:var(--pri)">${n}</div><div class="adm-sub">${l}${key && n ? ` ${I("chevR") || "›"}` : ""}</div></div>`;
    const muaIco = I("stethoscope") || I("activity") || "";
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_drislem")}</h2><p>${H.esc(myName || "Hekim")} · bugünkü muayene kuyruğu ve hastalarınız</p></div></div>
      <div class="r" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">${kutu(myPts.length, "İş listesi (hastam)")}${kutu(bekRand.length, "Randevular")}${kutu(imzaBek, "Muayene imza bekleyen", "imza")}${kutu(epiBek, "Epikriz işlem", "epi")}${kutu(sonucBek, "Sonuç bekleyen", "sonuc")}</div>
      <div class="ist-sec ist-hd"><h5>Bugünün randevuları — muayene bekleyen${fallback ? ` <span class="adm-sub">(demo: tüm bölümler)</span>` : ""}</h5></div>
      <div class="tw"><table class="t"><thead><tr><th style="width:70px">Saat</th><th>Hasta</th><th>Bölüm</th><th>Doktor</th><th style="width:100px">Durum</th><th style="width:140px"></th></tr></thead><tbody>
      ${bekRand.length ? bekRand.slice().sort((a, z) => (a.tarih || "").localeCompare(z.tarih || "")).map(r => `<tr><td class="mono adm-sub">${H.esc((r.tarih || "").slice(11, 16))}</td><td><b>${H.esc(vzName(r.hasta))}</b></td><td class="adm-sub">${H.esc(r.bolum || "")}</td><td class="adm-sub">${H.esc(r.doktor || "")}</td><td><span class="tag ${r.durum === "Geldi" ? "ok" : "w"}">${H.esc(r.durum)}</span></td><td><button class="btn p sm" data-muarand="${r.id}">${muaIco} Muayeneye al</button></td></tr>`).join("") : `<tr><td colspan="6" class="mute" style="padding:16px;text-align:center">Bugün muayene bekleyen randevu yok.</td></tr>`}
      </tbody></table></div>
      <div class="ist-sec ist-hd" style="margin-top:14px"><h5>Hastalarım</h5></div>
      <div class="adm-bar" style="margin-bottom:8px">${H.filterBox("Hasta / tanı ara…")}</div>
      <div class="tw"><table class="t"><thead><tr><th>Hasta</th><th style="width:110px">Başvuru</th><th>Tanı</th><th style="width:56px">Lab</th><th style="width:56px">Rad</th><th style="width:84px">Finansal</th><th style="width:84px">Muayene</th><th>Birim</th><th style="width:120px"></th></tr></thead><tbody>
      ${myPts.length ? myPts.map(p => { const b = H.bed(p.bed), e = H.encOf(p), ei = H.ENC[e] || {}, un = b && H.unit(b.unitId);
        return `<tr class="row"><td><b>${H.esc(H.showNames() ? p.name : (b ? b.no : "—"))}</b><div class="mute" style="font-size:11.5px">${H.ageText(p)} ${p.sex}</div></td><td>${H.encIcon(p)} <span class="tag">${H.esc(ei.label || e)}</span> ${H.protoLock(p)}</td><td>${H.esc(p.dx || "")} ${p.icd ? `<span class="mono mute">${H.esc(p.icd)}</span>` : ""}</td><td class="n">${xy(cnt(p.id, "Laboratuvar"))}</td><td class="n">${xy(cnt(p.id, "Radyoloji"))}</td><td><span class="tag ok">Uygun</span></td><td>${muaTag(p.id)}</td><td class="mute" style="font-size:12px">${un ? H.esc(un.tr) : "—"}</td><td><button class="btn p sm" data-muapt="${p.id}">${muaIco} Muayene</button></td></tr>`; }).join("") : `<tr><td colspan="9" class="mute" style="padding:16px;text-align:center">Birimlerinizde hasta yok.</td></tr>`}
      </tbody></table></div>`;
    // Tıklanabilir iş kuyrukları: Muayene imza / Epikriz / Sonuç bekleyen → hasta listesi → Aç.
    function drQueueModal(key) {
      let title, rows, go;
      if (key === "imza") { title = "Muayene imza bekleyen"; rows = myPts.filter(p => { const d = muaDoc(p.id); return d && !muaSigned(d); }); go = (p) => H.go("hasta360", { pid:p.id, atab:"tedavi", ttab:"muayene" }); }
      else if (key === "epi") { title = "Epikriz işlem bekleyen"; rows = myPts.filter(p => (H.data.docs || []).some(x => x.pid === p.id && x.type === "epikriz" && x.status !== "muhur")); go = (p) => H.go("hasta360", { pid:p.id, atab:"tedavi", ttab:"muayene" }); }
      else { title = "Sonuç bekleyen"; rows = myPts.filter(p => pend(p.id, "Laboratuvar") + pend(p.id, "Radyoloji") > 0); go = (p) => H.go("hasta360", { pid:p.id, atab:"tedavi", ttab:"laboratuvar" }); }
      H.modal({ title:title + " (" + rows.length + ")", wide:true,
        body:rows.length ? `<div class="tw"><table class="t"><thead><tr><th>Hasta</th><th>Tanı</th><th>Birim</th><th style="width:100px"></th></tr></thead><tbody>${rows.map(p => { const b = H.bed(p.bed), u = b && H.unit(b.unitId); return `<tr><td><b>${H.esc(H.showNames() ? p.name : (b ? b.no : "—"))}</b></td><td class="adm-sub">${H.esc(p.dx || "")}</td><td class="adm-sub">${u ? H.esc(u.tr) : "—"}</td><td><button class="btn p sm" data-drqgo="${p.id}">${muaIco} Aç</button></td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">Kuyruk boş.</div>`,
        actions:`<button class="btn" data-x>Kapat</button>`,
        onMount(m) { const tb = m.querySelector("tbody"); if (tb) tb.addEventListener("click", ev => { const g = ev.target.closest("[data-drqgo]"); if (g) { const p = H.pt(g.dataset.drqgo); H.closeModal(); if (p) go(p); } }); } });
    }
    root.onclick = (e) => {
      const q = e.target.closest("[data-drq]"); if (q) { drQueueModal(q.dataset.drq); return; }
      const mr = e.target.closest("[data-muarand]"); if (mr) { const r = all.find(x => x.id === mr.dataset.muarand); if (!r) return;
        const pid = pidByName(r.hasta); if (!pid) { H.toast("Hasta kaydı yok · kabule gidiliyor.", "w"); return H.go("admission", { tab:"ayaktan", pre:{ name:r.hasta, bolum:r.bolum } }); }
        const p = H.pt(pid); let pno = H.proto ? H.proto.activeNo(pid) : null;
        if (!pno) { const rec = H.proto.create(pid, { bolum:r.bolum || "—", doktor:myName || "—", gelisTipi:"Ayaktan", ptip:"Genel muayene" }); pno = rec.no; p.encounter = "ayaktan"; }
        r.durum = "Geldi"; H.saveData && H.saveData(); H.log("Muayeneye alındı", vzName(r.hasta) + " · " + pno);
        return H.go("hasta360", { pid, atab:"tedavi", ttab:"muayene", proto:pno }); }
      const mp = e.target.closest("[data-muapt]"); if (mp) { const p = H.pt(mp.dataset.muapt); if (!p) return;
        const pno = H.proto ? H.proto.activeNo(p.id) : null;
        if (!pno) return H.kabulForm(p, {}, (rec) => H.go("hasta360", { pid:p.id, atab:"tedavi", ttab:"muayene", proto:rec.no }));
        return H.go("hasta360", { pid:p.id, atab:"tedavi", ttab:"muayene", proto:pno }); }
    };
    H.wireFilter(root);
  } });

  /* ================= YATAN HASTALAR (yatış / transfer / taburcu) ================= */
  H.register("yatanlar", { title:() => H.t("m_yatanlar"), perm:["beds", "admission"], render(root, params = {}) {
    const pts = H.myPatients().filter(p => /yatan|yogun/.test(H.encOf(p) || ""));
    const canTr = H.can("admission");
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_yatanlar")}</h2><p>${pts.length} yatan hasta · yatış · transfer · taburcu</p></div></div>
      <div class="adm-bar" style="margin-bottom:10px">${H.filterBox("Hasta / yatak / birim ara…")}</div>
      <div class="tw"><table class="t"><thead><tr><th style="width:80px">Yatak</th><th>Hasta</th><th>Birim</th><th style="width:90px">Yatış</th><th>Hekim</th><th>Tanı</th><th style="width:90px">Durum</th><th style="width:220px"></th></tr></thead><tbody>
      ${pts.length ? pts.map(p => { const b = H.bed(p.bed), u = b && H.unit(b.unitId), att = H.userBy(p.attending), e = H.encOf(p), ei = H.ENC[e] || {};
        return `<tr class="row" data-s="${H.esc(((H.showNames() ? p.name : (b ? b.no : "")) + " " + (b ? b.no : "") + " " + (u ? u.tr : "")).toLocaleLowerCase("tr"))}"><td class="n">${b ? H.esc(b.no) : "—"}</td><td><b>${H.esc(H.showNames() ? p.name : (b ? b.no : "—"))}</b><div class="mute" style="font-size:11.5px">${H.ageText(p)} ${p.sex || ""}</div></td><td class="adm-sub">${u ? H.esc(u.tr) : "—"} <span class="tag">${H.esc(ei.label || e)}</span></td><td class="n">${p.admitDays != null ? p.admitDays + ". gün" : "—"}</td><td class="adm-sub">${H.esc(att ? att.name : "—")}</td><td class="adm-sub">${H.esc(p.dx || "")}</td><td>${p.risk === "crit" ? `<span class="tag crit">Kritik</span>` : p.risk === "high" ? `<span class="tag w">Yüksek</span>` : `<span class="tag ok">Stabil</span>`}</td><td><button class="btn sm" data-yatdosya="${p.id}">Dosya</button> <button class="btn p sm" data-yattransfer="${p.id}">Transfer / Taburcu</button></td></tr>`; }).join("") : `<tr><td colspan="8" class="mute" style="padding:20px;text-align:center">Birimlerinizde yatan hasta yok. Hasta kabulden yatış yapılınca burada görünür.</td></tr>`}
      </tbody></table></div>
      <p class="adm-sub" style="margin-top:8px">Transfer (yatak/servis değişikliği) ve taburcu, hasta kabul ekranındaki akışla yapılır; buradan hasta seçili açılır. Görüntüleme herkeste, işlem yetkisi kabul görevlisi / sorumlu hemşirededir.</p>`;
    root.onclick = (e) => {
      const d = e.target.closest("[data-yatdosya]"); if (d) return H.go("hasta360", { pid:d.dataset.yatdosya });
      const t = e.target.closest("[data-yattransfer]"); if (t) { if (!canTr) { H.toast("Transfer/taburcu yetkisi kabul görevlisi / sorumlu hemşirededir.", "w"); return; } return H.go("admission", { tab:"transfer", sel:t.dataset.yattransfer }); }
    };
    H.wireFilter(root);
  } });

  /* ================= RANDEVU ================= */
  const randevular = () => (H.data.randevular = H.data.randevular || seedRandevu());
  function seedRandevu() {
    const now = new Date(), d = (h, m) => { const x = new Date(now); x.setHours(h, m, 0, 0); return x.toISOString().slice(0, 16); };
    return [
      { id:"rnd1", hasta:"Elvin Hüseynov", bolum:"Mamalıq-Ginekologiya", doktor:"Dr. Kamran Rzayev", tarih:d(9, 0), durum:"Bekliyor", not:"Hamiləlik izləmi" },
      { id:"rnd2", hasta:"Nərgiz Əliyeva", bolum:"Kardiologiya", doktor:"Dr. Kamran Rzayev", tarih:d(9, 30), durum:"Bekliyor", not:"Hipertansiyon kontrolü" },
      { id:"rnd3", hasta:"Rəşad Məmmədov", bolum:"Oftalmologiya", doktor:"Dr. Kamran Rzayev", tarih:d(10, 15), durum:"Geldi", not:"Check-up" },
      { id:"rnd4", hasta:"Nərgiz Əliyeva", bolum:"Kardiologiya", doktor:"Dr. Kamran Rzayev", tarih:d(8, 0), durum:"Gelmedi", not:"" },
      { id:"rnd5", hasta:"Nərgiz Əliyeva", bolum:"Kardiologiya", doktor:"Dr. Kamran Rzayev", tarih:d(8, 30), durum:"Gelmedi", not:"" },
    ];
  }
  const RND_DURUM = ["Bekliyor", "Geldi", "Tamamlandı", "Gelmedi", "İptal"];
  const RND_TUR = ["Poliklinik", "Cihaz", "Video klinik", "Check-up", "Kemoterapi"];
  // Randevu verilebilir doktorlar: İK personel kartında HAFTALIK ÇALIŞMA TAKVİMİ dolu VE
  // "Poliklinik/Web randevusu verilebilir" işaretli olanlar. Takvimi olmayan doktor randevu listelerinde çıkmaz.
  const takvimDolu = (p) => p.haftalik && Object.values(p.haftalik).some(d => d && d.calisiyor);
  const randevuBayrak = (p) => (p.randevuOzellik || []).some(x => /Poliklinik randevusu|Web randevusu/.test(x));
  const randevuDoktorlari = () => (H.data.personel || []).filter(p => takvimDolu(p) && randevuBayrak(p)).map(p => (p.ad + " " + (p.soyad || "")).trim()).filter(Boolean);
  function randevuDoktorSeed() {
    if (H.data.rndDoktorSeeded) return; H.data.rndDoktorSeeded = true; H.data.personel = H.data.personel || [];
    const gunler = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"];
    const takvim = () => Object.fromEntries(gunler.map(g => [g, { calisiyor:true, bas:"09:00", bit:"16:00" }]));
    const mk = (ad, soyad, bolum, varTakvim, flags) => ({ id:"perrnd_" + ad, ad, soyad, tip:"Doktor", meslek:"Doktor", unvan:"həkim", bolum, brans:bolum, randevuOzellik:flags, haftalik:varTakvim ? takvim() : {}, ranSure:"15", ranGunluk:"20", kurumTipi:"Tümü", _rndSeed:true });
    const names = new Set(H.data.personel.map(p => (p.ad + " " + (p.soyad || "")).trim()));
    [mk("Kamran", "Rzayev", "Kardiologiya", true, ["Poliklinik randevusu verilebilir", "Web randevusu verilebilir"]),
     mk("Əhməd", "Abdullayev", "Oftalmologiya", true, ["Poliklinik randevusu verilebilir"]),
     mk("Rauf", "Abbasov", "Ümumi Cərrahiyyə", false, ["Poliklinik randevusu verilebilir"])  // takvim YOK → randevu listesinde çıkmaz
    ].forEach(p => { if (!names.has((p.ad + " " + p.soyad).trim())) H.data.personel.push(p); });
  }
  H.register("randevu", { title:() => "Randevu", perm:["admission", "admission_view"], render(root, params = {}) {
    randevuDoktorSeed();
    const all = randevular(), f = params.durum || "hepsi", GECMIS = ["Tamamlandı", "Gelmedi", "İptal"];
    const list = f === "hepsi" ? all : f === "gecmis" ? all.filter(r => GECMIS.includes(r.durum)) : all.filter(r => r.durum === f);
    const view = params.view || "liste", gun = params.gun || new Date().toISOString().slice(0, 10);
    const listeHtml = () => `<div class="seg" style="margin-bottom:12px">${[["hepsi", "Hepsi"], ["gecmis", "Geçmiş"], ...RND_DURUM.map(x => [x, x])].map(([k, l]) => `<button data-rf="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="tw"><table class="t"><thead><tr><th style="width:150px">Saat</th><th>Hasta</th><th>Bölüm</th><th>Doktor</th><th>Not</th><th style="width:120px">Durum</th><th style="width:130px"></th></tr></thead><tbody>
      ${list.length ? list.slice().sort((a, z) => a.tarih.localeCompare(z.tarih)).map(r => `<tr><td class="mono adm-sub">${H.esc((r.tarih || "").replace("T", " "))}${r.sms ? ` ${I("bell") || ""}` : ""}</td><td><b>${H.esc(r.hasta)}</b></td><td>${H.esc(r.bolum)}${r.tur ? ` <span class="tag">${H.esc(r.tur)}</span>` : ""}</td><td class="adm-sub">${H.esc(r.doktor)}</td><td class="adm-sub">${H.esc(r.not || "")}</td><td><select data-rndst="${r.id}">${RND_DURUM.map(s => `<option${r.durum === s ? " selected" : ""}>${s}</option>`).join("")}</select></td><td>${["Tamamlandı", "İptal"].includes(r.durum) ? "" : `<button class="btn p sm" data-rndkabul="${r.id}" title="Hasta kabul (protokol aç)">Kabul</button> `}<button class="btn g sm" data-rnddel="${r.id}" title="Sil">${I("trash") || "×"}</button></td></tr>`).join("") : `<tr><td colspan="7" class="mute" style="padding:20px;text-align:center">Bu durumda randevu yok.</td></tr>`}
      </tbody></table></div>`;
    const pad = (n) => String(n).padStart(2, "0"), SAAT = [];
    for (let h = 8; h < 18; h++) { SAAT.push(pad(h) + ":00"); SAAT.push(pad(h) + ":30"); }
    const SEVC = { "Bekliyor":"var(--mid)", "Geldi":"var(--ok)", "Tamamlandı":"var(--line)", "Gelmedi":"var(--crit)", "İptal":"var(--mute)" };
    const kapali = H.data.slotKapali = H.data.slotKapali || [];          // "YYYY-MM-DDTHH:MM|Doktor" biçiminde kapalı slotlar
    const slotKey = (t, d) => t + "|" + d;
    // hücre: dolu randevu → renkli, kapalıysa → gri "Kapalı", boşsa → randevu ver
    const cellHtml = (tarih, saat, dr) => { const a = all.find(r => (r.tarih || "").slice(0, 16) === tarih && r.doktor === dr);
      if (a) return `<td data-rndopen="${a.id}" style="cursor:pointer;background:color-mix(in srgb,${SEVC[a.durum] || "var(--mid)"} 20%,transparent);border-left:3px solid ${SEVC[a.durum] || "var(--mid)"}"><b>${H.esc(a.hasta)}</b><div class="adm-sub" style="font-size:10.5px">${H.esc(a.tur || a.bolum || "")} · ${H.esc(a.durum)}</div></td>`;
      if (kapali.includes(slotKey(tarih, dr))) return `<td data-rndunblock="${H.esc(slotKey(tarih, dr))}" style="cursor:pointer;background:var(--line);color:var(--mute)" title="Kapalı · açmak için tıkla">Kapalı</td>`;
      return `<td data-rndcell="${tarih}|${H.esc(dr)}" style="cursor:pointer" title="Boş · tıkla randevu ver, sağ tık slot kapat"></td>`; };
    const takvimHtml = () => { const drs = randevuDoktorlari();
      const dayAppts = all.filter(r => (r.tarih || "").slice(0, 10) === gun);
      const bar = `<div class="r" style="gap:8px;margin-bottom:10px;align-items:center"><button class="btn sm" data-rndgun="-1">${I("left") || "‹"}</button><input type="date" data-rndgunset value="${gun}"><button class="btn sm" data-rndgun="1">${I("right") || "›"}</button><span class="adm-sub">${dayAppts.length} randevu · ${drs.length} doktor</span></div>`;
      if (!drs.length) return bar + `<div class="empty">Randevu takvimi tanımlı doktor yok. İK → personel → Çalışma takvimi + "Poliklinik/Web randevusu verilebilir".</div>`;
      return bar + `<div class="tw"><table class="t" style="font-size:12px"><thead><tr><th style="width:64px">Saat</th>${drs.map(d => `<th>${H.esc(d)}</th>`).join("")}</tr></thead><tbody>
        ${SAAT.map(s => `<tr><td class="mono adm-sub">${s}</td>${drs.map(d => cellHtml(gun + "T" + s, s, d)).join("")}</tr>`).join("")}
        </tbody></table></div><p class="adm-sub" style="margin-top:8px">Doluysa tıkla (randevu detayı) · boşsa tıkla (randevu ver) · boşa sağ tık (slot kapat). Renk = durum.</p>`; };
    const haftaHtml = () => { const drs = randevuDoktorlari(); if (!drs.length) return `<div class="empty">Randevu takvimi tanımlı doktor yok.</div>`;
      const dr = params.dr && drs.includes(params.dr) ? params.dr : drs[0];
      const g0 = new Date(gun), gunler = []; for (let i = 0; i < 7; i++) { const d = new Date(g0); d.setDate(g0.getDate() + i); gunler.push(d.toISOString().slice(0, 10)); }
      const GAD = ["Baz", "Çər", "Cüm", "Şən", "Baz", "B.e", "Ç.a"];                 // azerice gün kısaltmaları (gösterim)
      const dgun = (iso) => { const d = new Date(iso); return GAD[d.getDay()] + " " + pad(d.getDate()) + "." + pad(d.getMonth() + 1); };
      const bar = `<div class="r" style="gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap"><button class="btn sm" data-rndhaftagun="-7">${I("left") || "‹"}</button><input type="date" data-rndgunset value="${gun}"><button class="btn sm" data-rndhaftagun="7">${I("right") || "›"}</button><select data-rnddr>${drs.map(d => `<option${d === dr ? " selected" : ""}>${H.esc(d)}</option>`).join("")}</select><span class="adm-sub">Hafta görünümü · ${H.esc(dr)}</span></div>`;
      return bar + `<div class="tw"><table class="t" style="font-size:12px"><thead><tr><th style="width:64px">Saat</th>${gunler.map(iso => `<th>${dgun(iso)}</th>`).join("")}</tr></thead><tbody>
        ${SAAT.map(s => `<tr><td class="mono adm-sub">${s}</td>${gunler.map(iso => cellHtml(iso + "T" + s, s, dr)).join("")}</tr>`).join("")}
        </tbody></table></div><p class="adm-sub" style="margin-top:8px">Bir doktorun haftası. Boşa tıkla (randevu ver) · boşa sağ tık (slot kapat) · kapalıya tıkla (aç).</p>`; };
    root.innerHTML = `<div class="ph"><div><h2>Randevu${f === "gecmis" && view === "liste" ? " geçmişi" : ""}</h2><p>${view === "takvim" ? "Gün takvimi · " + gun : view === "hafta" ? "Hafta takvimi · " + gun : list.length + " randevu"} · poliklinik / bölüm</p></div><div class="r"><button class="btn ${view === "liste" ? "p" : ""}" data-rndview="liste">Liste</button><button class="btn ${view === "takvim" ? "p" : ""}" data-rndview="takvim">Gün</button><button class="btn ${view === "hafta" ? "p" : ""}" data-rndview="hafta">Hafta</button><button class="btn" data-rndexp>${I("save") || ""} Excel</button><button class="btn" data-rndyaz>${I("print") || ""} Yazdır</button><button class="btn p" data-rndnew>${I("plus")} Yeni randevu</button></div></div>
      ${view === "takvim" ? takvimHtml() : view === "hafta" ? haftaHtml() : listeHtml()}`;
    root.onchange = (e) => { const st = e.target.closest("[data-rndst]"); if (st) { const r = all.find(x => x.id === st.dataset.rndst); if (r) { r.durum = st.value; H.saveData && H.saveData(); H.log("Randevu durumu", r.hasta + " · " + st.value); } return; }
      const gs = e.target.closest("[data-rndgunset]"); if (gs) return H.go("randevu", { view:view === "hafta" ? "hafta" : "takvim", gun:gs.value, dr:params.dr });
      const dd = e.target.closest("[data-rnddr]"); if (dd) return H.go("randevu", { view:"hafta", gun, dr:dd.value }); };
    root.oncontextmenu = (e) => { const rc = e.target.closest("[data-rndcell]"); if (!rc) return; e.preventDefault();
      const key = rc.dataset.rndcell; if (!kapali.includes(key)) { kapali.push(key); H.saveData && H.saveData(); H.toast("Slot kapatıldı"); H.go("randevu", params); } };
    root.onclick = (e) => {
      const rv = e.target.closest("[data-rndview]"); if (rv) return H.go("randevu", { view:rv.dataset.rndview, gun, durum:f, dr:params.dr });
      const rg = e.target.closest("[data-rndgun]"); if (rg) { const dd = new Date(gun); dd.setDate(dd.getDate() + (+rg.dataset.rndgun)); return H.go("randevu", { view:"takvim", gun:dd.toISOString().slice(0, 10) }); }
      const rh = e.target.closest("[data-rndhaftagun]"); if (rh) { const dd = new Date(gun); dd.setDate(dd.getDate() + (+rh.dataset.rndhaftagun)); return H.go("randevu", { view:"hafta", gun:dd.toISOString().slice(0, 10), dr:params.dr }); }
      const ru = e.target.closest("[data-rndunblock]"); if (ru) { const i = kapali.indexOf(ru.dataset.rndunblock); if (i >= 0) { kapali.splice(i, 1); H.saveData && H.saveData(); H.toast("Slot açıldı"); H.go("randevu", params); } return; }
      const rc = e.target.closest("[data-rndcell]"); if (rc) { const [tarih, dr] = rc.dataset.rndcell.split("|"); return rndForm({ tarih, doktor:dr }); }
      const ro = e.target.closest("[data-rndopen]"); if (ro) { const r = all.find(x => x.id === ro.dataset.rndopen); if (r) return rndDetay(r); }
      const rf = e.target.closest("[data-rf]"); if (rf) return H.go("randevu", { durum:rf.dataset.rf });
      const rk = e.target.closest("[data-rndkabul]"); if (rk) { const r = all.find(x => x.id === rk.dataset.rndkabul); if (r) rndKabul(r); return; }
      const del = e.target.closest("[data-rnddel]"); if (del) { const i = all.findIndex(x => x.id === del.dataset.rnddel); if (i >= 0 && confirm("Bu randevu silinsin mi?")) { all.splice(i, 1); H.toast("Randevu silindi", "w"); H.go("randevu", params); } return; }
      if (e.target.closest("[data-rndexp]") || e.target.closest("[data-rndyaz]")) { const cols = ["Saat", "Hasta", "Bölüm", "Doktor", "Not", "Durum"], rows = list.map(r => [(r.tarih || "").replace("T", " "), r.hasta, r.bolum, r.doktor, r.not || "", r.durum]);
        if (e.target.closest("[data-rndexp]")) { H.exportCsv ? (H.exportCsv("Randevular", cols, rows), H.toast("Excel indirildi")) : H.toast("yok", "w"); } else { H.printTable ? H.printTable("Randevular", cols, rows) : H.toast("yok", "w"); } return; }
      if (e.target.closest("[data-rndnew]")) return rndForm();
    };
    // Randevudan hasta kabul: kayıtlı hastaya protokol açar (→ dosyası), kayıt yoksa ayaktan kayda (önden dolu) gider.
    function rndKabul(r) {
      r.durum = "Geldi"; H.saveData && H.saveData();
      const pat = (H.data.patients || []).find(p => p.name === r.hasta);
      if (pat) { if (H.proto) { const att = H.userBy(pat.attending); H.proto.create(pat.id, { bolum:r.bolum || "—", doktor:r.doktor || (att && att.name) || "—", gelisTipi:"Ayaktan", ptip:r.tur || "Genel muayene" }); }
        H.log("Randevudan kabul", r.hasta + " · protokol açıldı"); H.toast("Kabul edildi · protokol açıldı"); H.go("hasta360", { pid:pat.id }); }
      else { H.toast("Hasta kaydı yok · ayaktan kayıt açılıyor"); H.go("admission", { tab:"ayaktan", pre:{ name:r.hasta, bolum:r.bolum } }); }
    }
    function rndDetay(r) {
      H.modal({ title:"Randevu · " + H.esc(r.hasta), body:`<div class="icd-form">
          <div class="fr"><label>Hasta</label><input value="${H.esc(r.hasta)}" readonly></div>
          <div class="fr"><label>Tarih / saat</label><input value="${H.esc((r.tarih || "").replace("T", " "))}" readonly></div>
          <div class="fr"><label>Bölüm</label><input value="${H.esc(r.bolum || "")}" readonly></div>
          <div class="fr"><label>Doktor</label><input value="${H.esc(r.doktor || "")}" readonly></div>
          <div class="fr"><label>Durum</label><select data-f="durum">${RND_DURUM.map(s => `<option${r.durum === s ? " selected" : ""}>${s}</option>`).join("")}</select></div>
          <div class="fr"><label>Not</label><input value="${H.esc(r.not || "")}" readonly></div></div>`,
        actions:`<button class="btn g" data-rddel>${I("trash") || ""} Sil</button><button class="btn p" data-rdkabul>${I("ok") || ""} Kabul et (protokol aç)</button><span class="spacer"></span><button class="btn" data-x>Kapat</button><button class="btn p" data-ok>Kaydet</button>`,
        onMount(m) { m.querySelector("[data-ok]").onclick = () => { r.durum = m.querySelector('[data-f="durum"]').value; H.saveData && H.saveData(); H.log("Randevu durumu", r.hasta + " · " + r.durum); H.closeModal(); H.go("randevu", { view:"takvim", gun:(r.tarih || "").slice(0, 10) }); };
          m.querySelector("[data-rdkabul]").onclick = () => { H.closeModal(); rndKabul(r); };
          m.querySelector("[data-rddel]").onclick = () => { if (!confirm("Bu randevu silinsin mi?")) return; const i = all.findIndex(x => x.id === r.id); if (i >= 0) all.splice(i, 1); H.saveData && H.saveData(); H.closeModal(); H.toast("Randevu silindi", "w"); H.go("randevu", { view:"takvim", gun:(r.tarih || "").slice(0, 10) }); }; } });
    }
    function rndForm(pre) {
      const drs = randevuDoktorlari(), bols = H.klinikBolumler ? H.klinikBolumler() : (H.data.bolumler || []);
      const now = (pre && pre.tarih) ? pre.tarih : new Date().toISOString().slice(0, 16);
      const hastaAdlari = (H.data.patients || []).map(p => p.name);
      H.modal({ title:"Yeni randevu", body:`<div class="icd-form">
        <div class="fr" style="grid-column:1/-1"><label>Hasta</label><input data-f="hasta" list="rnd-hasta" placeholder="Hasta adı — yazın ya da seçin" value="${H.esc((pre && pre.hasta) || "")}"><datalist id="rnd-hasta">${hastaAdlari.map(n => `<option>${H.esc(n)}</option>`).join("")}</datalist></div>
        <div class="fr" style="grid-column:1/-1" data-rndwarn hidden></div>
        <div class="fr"><label>Randevu türü</label><select data-f="tur">${RND_TUR.map(x => `<option>${H.esc(x)}</option>`).join("")}</select></div>
        <div class="fr"><label>Bölüm</label><input data-f="bolum" list="rnd-bol" placeholder="Bölüm" value="${H.esc((pre && pre.bolum) || "")}"><datalist id="rnd-bol">${bols.map(b => `<option>${H.esc(b.ad)}</option>`).join("")}</datalist></div>
        <div class="fr"><label>Doktor</label><select data-f="doktor"><option value="">—</option>${drs.map(n => `<option${pre && pre.doktor === n ? " selected" : ""}>${H.esc(n)}</option>`).join("")}</select>${drs.length ? "" : `<div class="adm-sub" style="margin-top:4px">Randevu takvimi tanımlı doktor yok. İK → personel kartı → Çalışma takvimi + "Poliklinik/Web randevusu verilebilir" işaretleyin.</div>`}</div>
        <div class="fr"><label>Tarih / saat</label><input type="datetime-local" data-f="tarih" value="${now}"></div>
        <div class="fr"><label>Süre (dk)</label><input data-f="sure" type="number" min="5" step="5" value="15"></div>
        <div class="fr"><label>Not</label><input data-f="not" placeholder="Geliş nedeni"></div>
        <div class="fr"><label>Hatırlatma</label><label class="dc-chk"><input type="checkbox" data-f="sms" checked> SMS ile hatırlatma gönder</label></div></div>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Kaydet</button>`,
        onMount(m) { const hi = m.querySelector('[data-f="hasta"]'), warn = m.querySelector("[data-rndwarn]");
          const checkNoShow = () => { const nm = (hi.value || "").trim(); const ns = nm ? all.filter(r => r.hasta === nm && r.durum === "Gelmedi").length : 0;
            if (ns > 0) { warn.hidden = false; warn.innerHTML = `<div class="note" style="background:color-mix(in srgb,var(--crit) 12%,transparent);border:1px solid var(--crit);color:var(--crit)">${I("alert") || "⚠"} Bu hasta <b>${ns}</b> randevusuna gelmemiş.</div>`; } else warn.hidden = true; };
          hi.oninput = checkNoShow; checkNoShow();
          m.querySelector("[data-ok]").onclick = () => { const g = s => (m.querySelector(`[data-f="${s}"]`).value || "").trim();
          if (!g("hasta")) { H.toast("Hasta adı gerekli.", "w"); return; }
          const sms = m.querySelector('[data-f="sms"]').checked;
          all.unshift({ id:"rnd" + Date.now(), hasta:g("hasta"), tur:m.querySelector('[data-f="tur"]').value, bolum:g("bolum"), doktor:m.querySelector('[data-f="doktor"]').value, tarih:m.querySelector('[data-f="tarih"]').value, sure:+g("sure") || 15, durum:"Bekliyor", not:g("not"), sms });
          H.saveData && H.saveData(); H.log("Randevu oluşturuldu", g("hasta")); H.toast("Randevu eklendi" + (sms ? " · SMS hatırlatma açık" : "")); H.closeModal(); H.go("randevu", params); }; } });
    }
  } });

  /* ================= VEZNE / FATURALAMA ================= */
  const faturalar = () => (H.data.faturalar = H.data.faturalar || [
    { id:"fat1", hasta:"Elvin Hüseynov", protokol:"Ayaktan · Hamiləlik izləmi", kurum:"İcbari Tibbi Sığorta (SAMHI)", toplam:85, katilim:0, durum:"Bekliyor" },
    { id:"fat2", hasta:"Nərgiz Əliyeva", protokol:"Ayaktan · Kardioloji", kurum:"Özel ödeme", toplam:60, katilim:60, durum:"Bekliyor" },
    { id:"fat3", hasta:"Rəşad Məmmədov", protokol:"Günübirlik · Check-up", kurum:"Kurum anlaşması", toplam:240, katilim:48, durum:"Ödendi" },
  ]);
  // Bankolar tercihen admin "Kayıt Seçenekleri" > banko listesinden; yoksa yedek.
  const BANKOLAR = () => (H.data.secenekler && H.data.secenekler.banko && H.data.secenekler.banko.length ? H.data.secenekler.banko : (H.data.bankolar = H.data.bankolar || ["Yatan Kasası", "Estetik Kasası", "Pediatri Kasası", "Preop Kasası", "Eczane Kasası", "Ofis Kasası", "Acil Kasası"]));
  const ODEME_TIP = ["Kart", "Nakit", "Havale"];
  const GFK_DURUM = ["Hasta faturası kesilmiş", "Kurum faturası kesilmiş", "Provizyonu alınmamış", "Hasta faturası kesilmemiş"];
  const gfkRows = () => (H.data.gfk = H.data.gfk || [
    { proto:"50873355", hasta:"Elvin Hüseynov", gelis:"Ayaktan", ptip:"Genel muayene", bolum:"Kardiologiya", kurum:"İcbari Tibbi Sığorta (SAMHI)", provizyon:"Alınmadı", durum:"Hasta faturası kesilmiş" },
    { proto:"50874258", hasta:"Nərgiz Əliyeva", gelis:"Ayaktan", ptip:"Genel muayene", bolum:"Daxili Xəstəliklər", kurum:"Paşa Sığorta", provizyon:"Alınmadı", durum:"Provizyonu alınmamış" },
    { proto:"50875215", hasta:"Rəşad Məmmədov", gelis:"Günübirlik", ptip:"Check-up", bolum:"Check Up", kurum:"Özel ödeme", provizyon:"Gerekmez", durum:"Kurum faturası kesilmiş" },
    { proto:"50876568", hasta:"Səbinə Vəliyeva", gelis:"Ayaktan", ptip:"Kontrol", bolum:"Dermatologiya", kurum:"İcbari Tibbi Sığorta (SAMHI)", provizyon:"Alınmadı", durum:"Hasta faturası kesilmemiş" },
  ]);
  // Fatura öncesi kurum onayı (video 16): SAMHI'de müstehaklık/takip, özel sigortada provizyon.
  const samhiKurum = (k) => /SAMHI|İcbari|Icbari/i.test(k || "");
  const ozelSigorta = (k) => !!k && !samhiKurum(k) && !/Özel ödeme|Ozel odeme|ödeme/i.test(k);
  const EVRAK_DURUM = ["Veznede", "Vezneden teslim edildi", "Medikal muhasebede", "Vezneye iade edildi"];
  const EVRAK_TIP = ["Nüfus cüzdanı fotokopisi", "İrsaliye nüshası", "Fotoğraf", "Test sonucu", "Fatura nüshası", "Provizyon formu", "Sevk belgesi"];
  const evrakRows = () => (H.data.evrak = H.data.evrak || [
    { no:"1167530", matbu:"508944877", kurum:"Qalf Drilling Services", durum:"Veznede" },
    { no:"1167526", matbu:"1UY7L0J78452", kurum:"İcbari Tibbi Sığorta", durum:"Medikal muhasebede" },
    { no:"1167466", matbu:"508942966", kurum:"Azərsun Holding", durum:"Vezneden teslim edildi" },
    { no:"1167468", matbu:"", kurum:"İcbari Tibbi Sığorta", durum:"Vezneye iade edildi" },
  ]);
  const ONAY_DURUM = ["Onay bekliyor", "Onaylandı", "Reddedildi"];
  const zinc = (defs) => defs.map(([sev, kisi, durum], i) => ({ seviye:i + 1, birim:sev, personel:kisi, durum:durum || "Onay bekliyor" }));
  // Onay zincirini bir kademe ilerletir; tüm kademeler onaylanınca kayıt onaylanır, biri reddederse reddedilir.
  const onayIlerlet = (rec, ok) => { const z = rec.zincir || (rec.zincir = zinc([["", "—", "Onay bekliyor"]])); const s = z.find(x => x.durum === "Onay bekliyor");
    if (!ok) { if (s) s.durum = "Reddedildi"; rec.durum = "Reddedildi"; return; }
    if (s) { s.durum = "Onaylandı"; s.personel = (H.state.user && H.state.user.name) || s.personel; }
    rec.durum = z.every(x => x.durum === "Onaylandı") ? "Onaylandı" : "Onay bekliyor"; };
  const zincStr = (z) => (z || []).map(x => `${x.seviye}. ${x.birim || "onay"}: ${x.durum === "Onaylandı" ? "✓" : x.durum === "Reddedildi" ? "✕" : "⏳"}`).join("  ");
  const indirimRows = () => (H.data.indirimOnay = H.data.indirimOnay || [
    { id:"io1", tarih:"22.10.2026 10:47", hasta:"Kamal Səmədov", isteyen:"Esli Daşdiyeva", islem:"Fibroblast deri/kozmetoloji tatbiqi", tutar:1250, oran:40, durum:"Onay bekliyor", grup:"Doktorlar Tatbiq", zincir:zinc([["Misafir Hizmetleri", "Kamal Səmədov", "Onaylandı"], ["Üst Yönetim", "Ahmet Hakan"], ["Mali İşler", "Ülvi İsgenderov"]]) },
    { id:"io2", tarih:"21.10.2026 12:26", hasta:"Zərifə Həşimova", isteyen:"Şöle Şıxeliyeva", islem:"Muayene paketi", tutar:41, oran:2.27, durum:"Onay bekliyor", grup:"Hastaya İskonto", zincir:zinc([["Vezne", "Esli Daşdiyeva"], ["Mali İşler", "Ülvi İsgenderov"]]) },
    { id:"io3", tarih:"21.10.2026 16:18", hasta:"Tofiq Babaşov", isteyen:"Esli Daşdiyeva", islem:"Radyoloji tetkik", tutar:400, oran:15, durum:"Onay bekliyor", grup:"Doktorlar Tatbiq", zincir:zinc([["Bölüm Sorumlusu", "Dr. Elxan"], ["Üst Yönetim", "Ahmet Hakan"]]) },
    { id:"io4", tarih:"19.10.2026 10:40", hasta:"Leyli Nağıyeva", isteyen:"Esli Daşdiyeva", islem:"Laboratuvar paketi", tutar:530, oran:19.14, durum:"Onaylandı", grup:"Hastaya İskonto", zincir:zinc([["Vezne", "Esli Daşdiyeva", "Onaylandı"], ["Mali İşler", "Ülvi İsgenderov", "Onaylandı"]]) },
  ]);
  const IADE_DURUM = ["Onay bekliyor", "Onaylandı", "Reddedildi", "İade tamamlandı"];
  const iadeRows = () => (H.data.iadeTalep = H.data.iadeTalep || [
    { id:"ia1", tip:"Avans İade", tarih:"21.10.2026 15:55", eden:"Fuad Orucov", tutar:2.90, dep:"Genel İade", aciklama:"Doktor ilaca gerek görmedi", durum:"Onay bekliyor", proto:"50894485", zincir:zinc([["Misafir Hizmetleri", "Kamal Səmədov", "Onaylandı"], ["Üst Yönetim", "Ahmet Hakan"], ["Mali İşler", "Ülvi İsgenderov"]]) },
    { id:"ia2", tip:"Avans İade", tarih:"21.10.2026 13:36", eden:"Aysu Rəhimova", tutar:607.02, dep:"Genel İade", aciklama:"Depozitten qalan məbləğ", durum:"Onay bekliyor", proto:"50880632", zincir:zinc([["Vezne", "Aysu Rəhimova"], ["Mali İşler", "Ülvi İsgenderov"]]) },
    { id:"ia3", tip:"Fatura İade", tarih:"20.10.2026 17:15", eden:"Elvin Hüseynov", tutar:30, dep:"Protokolden Protokola", aciklama:"Anadan yenidoğmuşa iade", durum:"Onaylandı", proto:"50892002", zincir:zinc([["Vezne", "Elvin Hüseynov", "Onaylandı"]]) },
    { id:"ia4", tip:"Avans İade", tarih:"20.10.2026 12:59", eden:"Nərgiz Əliyeva", tutar:100, dep:"Genel İade", aciklama:"Anestezi olmadığı üçün", durum:"Onay bekliyor", proto:"50893269", zincir:zinc([["Vezne", "Nərgiz Əliyeva"], ["Üst Yönetim", "Ahmet Hakan"]]) },
  ]);
  const PTIP_ETKI = [["hastaFark", "Hastaya fark atılmaz (hasta payı 0)"], ["sgkKatilim", "SGK katılım payı oluşmaz"], ["avans", "Avans alınabilir"], ["otoKapanma", "Otomatik kapanmaz"], ["islemHavuz", "İşlem havuzuna düşer"], ["doktorsuz", "Doktorsuz protokol"], ["nobetsiz", "Nöbetsiz protokol"]];
  const hzName = (r) => (H.state.lang === "TR" ? (r[2] || r[1]) : (r[1] || r[2])) || r[1] || r[2] || "";
  // Ad maskeleme: isim görme yetkisi olmayan (ör. yönetici, names:false) için baş harf maskesi.
  const vzName = (n) => (H.showNames && !H.showNames()) ? (String(n || "").trim().split(/\s+/).map(w => w ? w[0] + "***" : "").join(" ") || "—") : (n || "—");
  // İsimden hasta kartına bağlantı (liste satırı → hasta dosyası). Tam eşleşme bulunamazsa null.
  const pidByName = (nm) => { nm = String(nm || "").trim(); const p = (H.data.patients || []).find(x => (x.name || "").trim() === nm); return p ? p.id : null; };
  // Protokolün fatura tutarı: o protokole bağlı fiyatlı order'ların (kod→fiyatOf) toplamı. İstem→fatura zinciri.
  const protoTutar = (proto, kurum) => (H.data.orders || []).filter(o => o.protokolNo === proto).reduce((a, o) => a + ((o.kod && H.fiyatOf) ? (+H.fiyatOf(o.kod, kurum || "Özel ödeme") || 0) : (+o.tutar || 0)), 0);

  /* ===== VERİ ZİNCİRİ · Adım 1: Protokol deposu (kalıcı) =====
   * Tek hasta kartı, altında çok protokol. H.data.protokolKayit[pid] = [ {no,bolum,doktor,gelisTipi,ptip,kapali,tarih,bucket,islemIds[]}, ... ]
   * İşlemler (orders) ileride protokolNo ile buna bağlanacak; fatura/GFK/evrak bundan türeyecek (Adım 3–5). */
  const PROTO_BUCKETS = ["Bu hafta", "İki hafta önce", "Son ay", "Daha eski"];
  const bugunStr = () => { try { return new Date().toLocaleDateString("az"); } catch { return new Date().toLocaleDateString(); } };
  H.proto = {
    store() { return (H.data.protokolKayit = H.data.protokolKayit || {}); },
    list(pid) { return (this.store()[pid] || []).slice(); },
    get(pid, no) { return (this.store()[pid] || []).find(x => x.no === no); },
    // İstem bağlanacak protokol: ekranda seçili (tumu değilse) → yoksa açık (son) protokol → yoksa en yeni. (Ozan kararı)
    activeNo(pid, sel) { if (sel && sel !== "tumu") return sel; const list = this.list(pid); return ((list.find(x => !x.kapali)) || list[0] || {}).no; },
    // Protokol numara düzenimiz: YIL-SIRA (ör. 2026-104601). Her kabul farklı/sıralı; seed'lerle (2026-104512…) tutarlı; referanstan (düz 8 hane) farklı.
    nextNo() { const y = new Date().getFullYear(); H.data.protoSeq = (H.data.protoSeq || 104600) + 1; return y + "-" + H.data.protoSeq; },
    // Mevcut demo protokollerini (p._protokoller) bir kez depoya taşır; sonra depo gerçek kaynaktır.
    seedFrom(pid, arr) { const s = this.store(); if (!s[pid]) { s[pid] = (arr || []).map(x => Object.assign({ islemIds:[] }, x)); } return s[pid]; },
    create(pid, d) { const s = this.store(), list = s[pid] = s[pid] || []; const rec = Object.assign({ no:this.nextNo(), tarih:bugunStr(), bucket:"Bu hafta", kapali:false, islemIds:[] }, d || {}); list.unshift(rec); H.saveData && H.saveData(); return rec; },
    setOpen(pid, no, acik) { const r = this.get(pid, no); if (r) { r.kapali = !acik; H.saveData && H.saveData(); } return r; },
    remove(pid, no) { const s = this.store(); if (s[pid]) { s[pid] = s[pid].filter(x => x.no !== no); H.saveData && H.saveData(); } },
  };
  // Kabul anahtarı -> geliş tipi eşlemesi (hasta360 "Hasta kabul ▾" ve vezne sağ-tık aynı eşlemeyi kullanır)
  const KABUL_GELIS = { ayaktan:"Ayaktan", gunubirlik:"Günübirlik", yatan:"Yatarak", yogun:"Yoğun", kontrol:"Kontrol", donor:"Ayaktan" };
  // Ortak "Hasta kabul" formu: mevcut hastaya yeni protokol açar. Hasta dosyası da vezne de buradan geçer → tek tutarlı ekran.
  // preset: {gelis, bolum, doktor}. onDone(rec) verilmezse hasta dosyasına gider.
  H.kabulForm = (patient, preset = {}, onDone) => {
    if (!patient) return;
    const now = () => H.nowFull ? H.nowFull() : (H.now ? H.now() : new Date().toLocaleString("az-AZ"));
    const bols = H.klinikBolumler ? H.klinikBolumler() : (H.data.bolumler || []);
    const docs = (H.data.users || []).filter(u => u.role === "hekim");
    const ptipler = (H.data.secenekler && H.data.secenekler.protokol) || ["Genel muayene", "Kontrol", "Preop"];
    const danismanlar = [...new Set((H.data.users || []).filter(u => u.active !== false).map(u => u.name))];
    const GELIS = ["Ayaktan", "Acil", "Günübirlik", "Yatarak", "Kontrol", "Yoğun"];
    const curBed = H.bed && H.bed(patient.bed), curUnit = curBed && H.unit && H.unit(curBed.unitId), att = H.userBy && H.userBy(patient.attending);
    const preG = GELIS.includes(preset.gelis) ? preset.gelis : "Ayaktan";
    const preB = preset.bolum || (curUnit && curUnit.tr) || "";
    const preD = preset.doktor || (att && att.name) || "";
    H.modal({ title:"Hasta kabul · " + H.esc(vzName(patient.name)), body:`<div class="icd-form">
        <div class="fr"><label>Geliş tipi</label><select data-f="gelis">${GELIS.map(x => `<option value="${H.esc(x)}"${x === preG ? " selected" : ""}>${x}</option>`).join("")}</select></div>
        <div class="fr"><label>Protokol tipi</label><select data-f="ptip">${ptipler.map(x => `<option>${H.esc(x)}</option>`).join("")}</select></div>
        <div class="fr"><label>Bölüm</label><input data-f="bolum" list="kf-bol" value="${H.esc(preB)}"><datalist id="kf-bol">${bols.map(b => `<option>${H.esc(b.ad)}</option>`).join("")}</datalist></div>
        <div class="fr"><label>Doktor</label><select data-f="doktor"><option value="">—</option>${docs.map(d => `<option${preD === d.name ? " selected" : ""}>${H.esc(d.name)}</option>`).join("")}</select></div>
        <div class="fr"><label>Danışman (ops.)</label><input data-f="danisman" list="kf-dan" placeholder="Hasta danışmanı"><datalist id="kf-dan">${danismanlar.map(d => `<option>${H.esc(d)}</option>`).join("")}</datalist></div>
        <div class="fr"><label>Kayıt tipi</label><select data-f="kayit"><option value="Kesin kayıt">Kesin kayıt</option><option value="Ön kayıt">Ön kayıt</option></select></div></div>
        <p class="adm-sub" style="margin-top:6px">Mevcut hastaya yeni protokol açılır; numara otomatik üretilir, hasta kartına kalıcı eklenir.</p>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Kabul et · protokol aç</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = s => (m.querySelector(`[data-f="${s}"]`).value || "").trim();
        const gelis = g("gelis"), bolum = g("bolum") || preB || "—", doktor = g("doktor") || "—", ptip = g("ptip"), danisman = g("danisman"), onKayit = g("kayit") === "Ön kayıt";
        patient.encounter = { "Yatarak":"yatan", "Günübirlik":"gunubirlik", "Yoğun":"yogun" }[gelis] || "ayaktan";
        patient.onKayit = onKayit;
        const rec = H.proto.create(patient.id, { bolum, doktor, gelisTipi:gelis, ptip });
        if (danisman) (H.data.danismanlar = H.data.danismanlar || []).unshift({ id:"dn" + Date.now(), hasta:patient.name, danisman, konu:"Kabul sırasında atandı", durum:"Açık", tarih:now(), not:"" });
        H.saveData && H.saveData();
        H.log("Hasta kabul", vzName(patient.name) + " · " + gelis + " · " + rec.no); H.closeModal(); H.toast("Kabul: " + gelis + " · protokol " + rec.no);
        if (onDone) onDone(rec); else H.go("hasta360", { pid:patient.id, atab:"360", stab:"gelisler", proto:rec.no }); }; } });
  };
  // Basit sağ-tık/işlem menüsü (İşlem Havuzu)
  function vzMenu(ev, items) {
    document.querySelectorAll(".vz-menu").forEach(m => m.remove());
    const m = document.createElement("div"); m.className = "vz-menu";
    m.innerHTML = items.map((it, i) => `<button data-mi="${i}">${H.esc(it[0])}</button>`).join("");
    document.body.appendChild(m);
    m.style.left = Math.min(ev.clientX, window.innerWidth - 220) + "px";
    m.style.top = Math.min(ev.clientY, window.innerHeight - items.length * 34 - 12) + "px";
    m.onclick = (e) => { const b = e.target.closest("[data-mi]"); if (b) items[+b.dataset.mi][1](); m.remove(); };
    setTimeout(() => document.addEventListener("click", function h() { m.remove(); document.removeEventListener("click", h); }), 0);
  }
  // Vezne 360 sağ ray hızlı listeleri (örnek/özet)
  function railData(name) {
    if (name === "Son hastalar") { const L = (H.data.patients || []).slice(-8).reverse(); return { cols:["Hasta no", "Hasta", "Yatak / birim", "Geliş"], pids:L.map(p => p.id), rows:L.map(p => { const b = H.bed(p.bed), u = b && H.unit(b.unitId); return [p.hn || "—", vzName(p.name), b ? b.no + (u ? " · " + u.tr : "") : "—", (H.ENC[H.encOf(p)] || {}).label || H.encOf(p)]; }) }; }
    if (name === "Protokol listesi") return { cols:["Protokol", "Hasta", "Geliş", "Bölüm", "Fatura durumu"], rows:gfkRows().map(x => [x.proto, vzName(x.hasta), x.gelis, x.bolum, x.durum]) };
    if (name === "Reçete listesi") return { cols:["Reçete no", "Hasta", "Tür", "Tarih"], rows:[["RX-50894308", "Nobatxanım Dadaşova", "Normal reçete", "21.10.2026"], ["RX-50893071", "Elvin Hüseynov", "İlaç reçetesi", "20.10.2026"], ["RX-50889384", "Elvin Hüseynov", "Gözlük reçetesi", "14.10.2026"]] };
    if (name === "Hasta arama") { const L = (H.data.patients || []); return { cols:["Hasta no", "Hasta", "Cinsiyet", "Yaş"], pids:L.map(p => p.id), rows:L.map(p => [p.hn || "—", vzName(p.name), p.sex === "E" ? "Erkek" : "Kadın", p.age || "—"]), note:"Satıra tıklayınca hasta bilgisi açılır · ara kutusu ad/no ile filtreler." }; }
    if (name === "Doktor iş listesi") { const g = {}; (H.data.patients || []).forEach(p => { const d = (H.data.users || []).find(u => u.u === p.attending); const n = d ? d.name : (p.attending || "—"); (g[n] = g[n] || []).push(p); });
      const rows = [], pids = []; Object.entries(g).forEach(([d, ps]) => ps.forEach(p => { rows.push([d, vzName(p.name), (H.ENC[H.encOf(p)] || {}).label || H.encOf(p), H.ozelOnay(p) ? "Ödeme OK" : "Ödeme bekliyor"]); pids.push(p.id); })); return { cols:["Doktor", "Hasta", "Geliş", "Özel onay"], pids, rows }; }
    if (name === "Randevu arama") return { cols:["Tarih", "Hasta", "Bölüm", "Doktor", "Durum"], rows:[["22.10.2026 09:00", "Nobatxanım Dadaşova", "Oftalmologiya", "Dr. Əhməd Abdullayev", "Bekliyor"], ["22.10.2026 10:30", "Nərgiz Əliyeva", "Daxili", "Dr. Kamran Rzayev", "Geldi"]], note:"Örnek randevular." };
    if (name === "Gizli / VIP hasta listesi") return { cols:["Hasta no", "Hasta", "Not"], rows:[["0260215", "VIP Hasta 1", "Gizli · yalnız yetkili görür"], ["0260233", "VIP Hasta 2", "Gizli"]], note:"Gizli/VIP hastalar maskeli; gerçekte özel yetki ile açılır." };
    if (name === "Kampanyalar") { const ks = (H.data.kampanyalar || []); return { cols:["Kampanya", "Uygulama", "Oran / tutar", "Durum"], rows:ks.length ? ks.map(k => [k.ad, k.uyg || "—", k.uyg === "Yüzde indirim" ? "%" + (k.oran || 0) : (k.tutar != null ? k.tutar + " ₼" : "—"), k.aktif ? "Aktif" : "Pasif"]) : [["Örnek kampanya", "Yüzde indirim", "%10", "Aktif"]], note:"Kampanyayı yetkili rol admin'de oluşturur; vezne fiyat verirken seçer." }; }
    if (name === "Dönem bilgileri") { const dl = H.data.vezneDonemler || {}, ks = Object.keys(dl);
      return { cols:["Banko / kasa", "Dönem no", "Durum"], rows:ks.length ? ks.map(b => [b, dl[b].no ? "#" + dl[b].no : "—", dl[b].acik ? "Açık" : "Kapalı"]) : [[H.state.vezneBanko || "—", "—", "Dönem açılmadı"]], note:"Her bankonun kendi dönemi vardır. Dönem açma/kapama ve devir üstteki dönem çubuğundan, çalıştığın banko için yapılır." }; }
    if (name === "UHM hasta arama") return { cols:["FİN", "Ad Soyad", "Doğum", "Kaynak"], rows:[["5AB12CD", "Nümunə Vətəndaş", "11.09.1996", "UHM (dövlət reyestri)"]], note:"UHM (Unikal Həkim/Vətəndaş reyestri) sorgusu · gerçek bağlantıyı ayrı ekip kurar." };
    if (name === "Onam formları") return { cols:["Form", "Hasta", "Tarih", "Durum"], rows:[["Aydınlatılmış onam", "Elvin Hüseynov", "24.10.2026", "İmzalı"], ["Ameliyat onamı", "Elvin Hüseynov", "23.10.2026", "Bekliyor"]], note:"Onam formları hastaya bağlı tutulur; imzalı/bekleyen takip edilir." };
    if (name === "İade taleplerim") return { cols:["Tip", "Tarih", "Tutar", "Durum"], rows:iadeRows().filter(x => x.eden === ((H.state.user || {}).name)).map(x => [x.tip, x.tarih, x.tutar + " ₼", x.durum]), note:"Yalnız sizin açtığınız iade talepleri; onay zinciri 'İade onay' ekranında." };
    if (name === "Toplu fatura işlemleri") return { cols:["Protokol", "Hasta", "Kurum", "Tutar", "Durum"], rows:gfkRows().filter(x => x.durum !== "Fatura kesildi").slice(0, 10).map(x => { const pid = pidByName(x.hasta), p = pid && H.pt(pid), kurum = (p && p.kurum) || "Özel ödeme", t = protoTutar(x.proto, kurum); return [x.proto, vzName(x.hasta), kurum, t ? t.toFixed(2) + " ₼" : "—", x.durum]; }), note:"Fatura kesilmemiş protokoller toplu faturalanabilir; tutar istem order'larından hesaplanır." };
    if (name === "Randevulanacak hizmetler") return { cols:["Hizmet", "Hasta", "Bölüm", "Durum"], rows:[["MR çekimi", "Nərgiz Əliyeva", "Radiologiya", "Randevu bekliyor"], ["Fizik tedavi", "Nərgiz Əliyeva", "FTR", "Randevu bekliyor"]], note:"Faturalanıp randevusu verilecek hizmetler." };
    if (name === "Hasta danışman") return { cols:["Danışman", "Hasta", "Konu", "Durum"], rows:[["Hasta Danışmanı 1", "Elvin Hüseynov", "Yurtdışı hasta karşılama", "Açık"]], note:"Hasta danışmanı/karşılama takibi." };
    if (name === "Kurum değişiklik onay") return { cols:["Protokol", "Hasta", "Eski kurum", "Yeni kurum", "Durum"], rows:[["50894026", "Nurgül Süleymanova", "Özel ödeme", "SAMHI", "Onay bekliyor"]], note:"Protokol kurum/sigorta değişikliği yetkili rol onayıyla yapılır." };
    return null;
  }
  /* ---------------- Klinik doküman görüntüleyici (yalnız okuma) + antetli çıktı ---------------- */
  function docPrintLetterhead(title, metaRows, bodyHtml) {
    const h = H.data.hospital || {}, w = window.open("", "_blank"); if (!w) { H.toast("Yazdırma penceresi engellendi (pop-up izni gerekli).", "e"); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${H.esc(title)}</title>
      <style>body{font:13px system-ui,Arial;padding:28px;color:#111}.hd{text-align:center;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}.hd b{font-size:18px}.hd small{color:#555}.m{width:100%;border-collapse:collapse;margin:10px 0}.m td{padding:3px 6px;font-size:12px}.m td:first-child{color:#555;width:150px}h2{font-size:15px;text-align:center;margin:8px 0 12px}.sig{display:flex;justify-content:space-around;margin-top:70px;text-align:center;font-size:12px}</style></head>
      <body><div class="hd"><b>${H.esc(h.name || "Hastane")}</b><br><small>${H.esc(h.adres || "Bakı")}</small></div><h2>${H.esc(title)}</h2>
      <table class="m">${metaRows.map(r => `<tr><td>${H.esc(r[0])}</td><td><b>${H.esc(r[1])}</b></td></tr>`).join("")}</table>
      <div style="line-height:1.7">${bodyHtml}</div><div class="sig"><div>Düzenleyen<br><br>İmza</div><div>Baş Həkim<br><br>İmza</div></div>
      <script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},200)}<\/script></body></html>`);
    w.document.close(); H.log("Klinik doküman çıktı", title);
  }
  function klinikDocView(k, sel) {
    const baslik = k[1] || "Klinik döküman", tarih = k[0] || "", doktor = k[2] || "", kurum = (sel && sel.kurum) || "";
    const meta = [["Belge", baslik], ["Tarih", tarih], ["Düzenleyen", doktor]].concat(kurum ? [["Kurum", kurum]] : []);
    H.modal({ title:baslik + " · görüntüle", wide:true,
      body:`<div class="vz-hk" style="margin-bottom:10px">${meta.map(r => `<div class="kv"><span>${H.esc(r[0])}</span><span>${H.esc(r[1])}</span></div>`).join("")}</div>
        <div class="box"><p style="margin:0;line-height:1.7">Bu belge hekim/hemşire tarafından <b>klinik sistemde</b> oluşturulmuştur. Vezne/ön büro yalnız <b>okuyabilir ve çıktı alabilir</b>, değiştiremez.</p>
        <p class="adm-sub" style="margin-top:8px">${H.esc(baslik)} içeriği klinik modülde tutulur; tam, antetli çıktı için "Antetli yazdır".</p></div>`,
      actions:`<button class="btn" data-x>Kapat</button><button class="btn p" data-dyaz>${I("print") || ""} Antetli yazdır</button>`,
      onMount(m) { m.querySelector("[data-dyaz]").onclick = () => docPrintLetterhead(baslik, meta, "<p>" + H.esc(baslik) + " — klinik belge içeriği (demo).</p>"); } });
  }

  /* ---------------- Hasta Danışman (danışman → hasta atama/takip) ---------------- */
  const DN_DURUM = ["Açık", "Takipte", "Kapandı"], DN_DURC = { "Açık":"w", "Takipte":"", "Kapandı":"ok" };
  const DN_KONU = ["Yurtdışı hasta karşılama", "VIP refakat", "Tercüman / dil desteği", "Konaklama / transfer", "Fiyat / paket bilgilendirme", "Şikâyet / memnuniyet", "Diğer"];
  function danismanStore() { return H.data.danismanlar = H.data.danismanlar || [
    { id:"dn1", hasta:"Fuad Orucov", danisman:"Leyli Nağıyeva", konu:"Yurtdışı hasta karşılama", durum:"Takipte", tarih:H.nowFull ? H.nowFull() : new Date().toLocaleString("az-AZ"), not:"İngilizce konuşuyor; transfer ayarlandı." },
    { id:"dn2", hasta:"Aysu Rəhimova", danisman:"Leyli Nağıyeva", konu:"VIP refakat", durum:"Açık", tarih:H.nowFull ? H.nowFull() : new Date().toLocaleString("az-AZ"), not:"" },
  ]; }
  function danismanModal() {
    const now = () => H.nowFull ? H.nowFull() : new Date().toLocaleString("az-AZ");
    const hastalar = (H.data.patients || []).map(p => p.name);
    const danismanlar = [...new Set((H.data.users || []).filter(u => u.active !== false).map(u => u.name))];
    const draw = (m) => { const list = danismanStore();
      m.querySelector("[data-dnbody]").innerHTML = list.length ? list.map(x => `<tr><td data-dnh="${H.esc(x.hasta)}" style="cursor:pointer"><b>${H.esc(vzName(x.hasta))}</b></td><td>${H.esc(x.danisman)}</td><td class="adm-sub">${H.esc(x.konu)}${x.not ? `<div class="adm-sub" style="font-size:11px">${H.esc(x.not)}</div>` : ""}</td><td><span class="tag ${DN_DURC[x.durum] || ""}">${H.esc(x.durum)}</span></td><td class="mono adm-sub">${H.esc(x.tarih)}</td><td><select data-dnst="${x.id}">${DN_DURUM.map(s => `<option${x.durum === s ? " selected" : ""}>${s}</option>`).join("")}</select> <button class="btn sm" data-dnnot="${x.id}">Not</button></td></tr>`).join("") : `<tr><td colspan="6" class="mute" style="padding:16px;text-align:center">Danışman ataması yok. "+ Yeni atama" ile ekleyin.</td></tr>`;
    };
    H.modal({ title:"Hasta Danışman", wide:true,
      body:`<div class="r" style="gap:8px;margin-bottom:8px"><button class="btn p sm" data-dnnew>${I("plus") || "+"} Yeni atama</button><span class="adm-sub" style="align-self:center">Danışman hastaya atanır; durum (Açık → Takipte → Kapandı) takip edilir. Yurtdışı/VIP hastalarda kullanılır.</span></div>
        <div class="tw"><table class="t"><thead><tr><th>Hasta</th><th>Danışman</th><th>Konu / not</th><th style="width:100px">Durum</th><th style="width:140px">Tarih</th><th style="width:180px"></th></tr></thead><tbody data-dnbody></tbody></table></div>`,
      actions:`<button class="btn" data-x>Kapat</button>`,
      onMount(m) { draw(m);
        m.querySelector("[data-dnnew]").onclick = () => dnForm();
        m.querySelector("[data-dnbody]").onchange = (e) => { const st = e.target.closest("[data-dnst]"); if (st) { const x = danismanStore().find(y => y.id === st.dataset.dnst); if (x) { x.durum = st.value; H.saveData && H.saveData(); H.log("Danışman durumu", x.hasta + " · " + x.durum); draw(m); } } };
        m.querySelector("[data-dnbody]").onclick = (e) => { const nt = e.target.closest("[data-dnnot]"); if (nt) { const x = danismanStore().find(y => y.id === nt.dataset.dnnot); if (x) { const v = prompt("Danışman notu:", x.not || ""); if (v != null) { x.not = v.trim(); H.saveData && H.saveData(); draw(m); } } return; }
          const h = e.target.closest("[data-dnh]"); if (h) { const pid = pidByName(h.dataset.dnh); if (pid) { H.closeModal(); H.go("hasta360", { pid }); } } };
        function dnForm() {
          H.modal({ title:"Yeni danışman ataması", onClose:danismanModal, body:`<div class="icd-form">
            <div class="fr"><label>Hasta</label><input data-f="hasta" list="dn-hasta" placeholder="Hasta adı"><datalist id="dn-hasta">${hastalar.map(h => `<option>${H.esc(h)}</option>`).join("")}</datalist></div>
            <div class="fr"><label>Danışman</label><input data-f="danisman" list="dn-dan" placeholder="Danışman adı"><datalist id="dn-dan">${danismanlar.map(d => `<option>${H.esc(d)}</option>`).join("")}</datalist></div>
            <div class="fr"><label>Konu</label><select data-f="konu">${DN_KONU.map(k => `<option>${H.esc(k)}</option>`).join("")}</select></div>
            <div class="fr" style="grid-column:1/-1"><label>Not</label><input data-f="not" placeholder="ops."></div></div>`,
            actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Ata</button>`,
            onMount(mm) { mm.querySelector("[data-ok]").onclick = () => { const g = s => (mm.querySelector(`[data-f="${s}"]`).value || "").trim();
              if (!g("hasta") || !g("danisman")) { H.toast("Hasta ve danışman gerekli.", "w"); return; }
              danismanStore().unshift({ id:"dn" + Date.now(), hasta:g("hasta"), danisman:g("danisman"), konu:mm.querySelector('[data-f="konu"]').value, durum:"Açık", tarih:now(), not:g("not") });
              H.saveData && H.saveData(); H.log("Danışman atandı", g("hasta") + " · " + g("danisman")); H.toast("Danışman atandı"); H.closeModal(); danismanModal(); }; } });
        } } });
  }
  // Vezne hasta bilgi kartı: vezneye uygun özet (demografik + mali + ziyaret). İsme tıklayınca açılır.
  function vzHastaModal(pid) {
    const p = H.pt(pid); if (!p) { H.toast("Hasta bulunamadı.", "e"); return; }
    const b = H.bed(p.bed), u = b && H.unit(b.unitId), doctor = (H.data.users || []).find(x => x.u === p.attending);
    const kv = (k, v) => `<div class="kv"><span>${H.esc(k)}</span><span>${v === 0 || v ? H.esc(String(v)) : "—"}</span></div>`;
    H.modal({ title:"Hasta · " + H.esc(vzName(p.name)),
      body:`<div class="vz-hk">${kv("Hasta no", p.hn)}${kv("Protokol", p.proto)}${kv("FİN", p.fin)}${kv("Cinsiyet · yaş", (p.sex === "E" ? "Erkek" : "Kadın") + " · " + (p.age || "—"))}${kv("Telefon", p.phone)}<div class="kv"><span>Geliş tipi</span><span>${H.encIcon(p)} ${H.esc((H.ENC[H.encOf(p)] || {}).label || H.encOf(p))} ${H.protoLock(p)}</span></div>${kv("Bölüm / birim", u ? u.tr : "")}${kv("Doktor", doctor ? doctor.name : p.attending)}${kv("Kurum / sigorta", p.kurum)}${kv("Özel onay (ödeme)", H.ozelOnay(p) ? "Alındı" : "Bekliyor")}${kv("Ön tanı", p.dx)}${kv("Kan grubu", p.blood)}${(p.allergies && p.allergies.length) ? kv("Alerji", p.allergies.join(", ")) : ""}</div>
        <p class="adm-sub" style="margin-top:8px">Vezne için özet bilgi kartı. Klinik ayrıntılar yalnız yetkili (hekim/hemşire) ekranında.</p>`,
      actions:`<button class="btn" data-x>Kapat</button>${(H.can("admission") || H.can("summary")) ? `<button class="btn" data-havuz>${I("list") || ""} İşlem havuzu</button>` : ""}${(H.can("admission") || H.can("orders")) ? `<button class="btn" data-istek>${I("flask") || ""} Tetkik/Radyoloji iste</button>` : ""}<button class="btn p" data-h360>Hasta 360 aç</button>${H.can("patient") ? `<button class="btn" data-git>Hastaya git</button>` : ""}`,
      onMount(m) { const g = m.querySelector("[data-git]"); if (g) g.onclick = () => { H.closeModal(); H.go("patient", { pid }); };
        const h3 = m.querySelector("[data-h360]"); if (h3) h3.onclick = () => { H.closeModal(); H.go("hasta360", { pid }); };
        const it = m.querySelector("[data-istek]"); if (it) it.onclick = () => { H.closeModal(); vzIstekModal(pid); };
        const hv = m.querySelector("[data-havuz]"); if (hv) hv.onclick = () => { H.closeModal(); vzIslemHavuzu(pid); }; } });
  }
  // İşlem Havuzu: hastanın işlemleri (tetkik/hizmet/ilaç) → seç → fatura kes / indirime gönder (vezne uçtan uca).
  function vzIslemHavuzu(pid) {
    const p = H.pt(pid); if (!p) return; const kurum = p.kurum || "Özel ödeme";
    const fiyatOf = (o) => o.fiyat != null ? o.fiyat : (o.kod ? H.fiyatOf(o.kod, kurum) : 0);
    H.modal({ title:"İşlem havuzu · " + H.esc(vzName(p.name)), wide:true,
      body:`<div class="adm-bar" style="margin-bottom:8px"><span class="tag">Kurum: ${H.esc(kurum)}</span><label class="adm-sub">Protokol</label><select data-hproto><option value="tumu">Tüm protokoller</option>${(H.proto ? H.proto.list(p.id) : []).map(x => `<option value="${H.esc(x.no)}">${H.esc(x.no)}${x.kapali ? " (kapalı)" : ""} · ${H.esc(x.bolum)}</option>`).join("")}</select><span class="spacer"></span><div class="seg"><button data-hf2="bekleyen" class="on">Fatura bekleyen</button><button data-hf2="tumu">Tümü</button></div></div>
        <div class="r" style="gap:6px;margin-bottom:8px;flex-wrap:wrap"><button class="btn p sm" data-hfatura>Fatura kes</button><button class="btn sm" data-hparcali>Parçalı fatura</button><button class="btn sm" data-hindirim>İndirime gönder</button><button class="btn sm" data-hproviz>Provizyon iste</button><button class="btn sm" data-hpaket>Panel paket</button><button class="btn g sm" data-hbekle>Bekleyene at</button></div>
        <div class="tw"><table class="t"><thead><tr><th style="width:34px"><input type="checkbox" data-hall></th><th>İşlem</th><th>Tür</th><th style="width:90px">Protokol</th><th style="width:90px">Fiyat</th><th style="width:120px">Durum</th></tr></thead><tbody data-hbody></tbody></table></div>
        <div class="adm-bar" style="margin-top:10px"><b>Seçili toplam: <span data-htop>0</span> ₼</b><span class="spacer"></span><span class="adm-sub">Satıra sağ tıklayın: Doktor · Tarih · Tutar · Yeniden fiyatlandır · Özel onay · Durum · Yazdır · Diğer</span></div>`,
      actions:`<button class="btn" data-x>Kapat</button>`,
      onMount(m) {
        const body = m.querySelector("[data-hbody]"), topEl = m.querySelector("[data-htop]");
        let f2 = "bekleyen", hproto = "tumu";
        const draw = () => { const ords = (H.data.orders || []).filter(o => o.pid === p.id && (hproto === "tumu" || o.protokolNo === hproto) && (f2 === "tumu" || o.durum !== "Faturalandı"));
          body.innerHTML = ords.length ? ords.map(o => `<tr data-hrow="${o.id}" style="cursor:context-menu"><td><input type="checkbox" data-hsel="${o.id}" ${o.durum === "Faturalandı" ? "disabled" : ""}></td><td><b>${H.esc(o.ad || o.cat || "—")}</b><div class="adm-sub" style="font-size:11px">${H.esc(o.at || "")} · ${H.esc(o.by || "")}</div></td><td class="adm-sub">${H.esc(o.cat || "")}</td><td class="mono adm-sub">${H.esc(o.protokolNo || "—")}</td><td class="n">${fiyatOf(o)} ₼</td><td><span class="tag ${o.durum === "Faturalandı" ? "ok" : ""}">${H.esc(o.durum || "İstendi")}</span></td></tr>`).join("") : `<tr><td colspan="6" class="mute" style="padding:16px;text-align:center">${f2 === "bekleyen" ? "Fatura bekleyen işlem yok." : "İşlem yok. Doktor istem yapınca ya da vezne tetkik isteyince burada görünür."}</td></tr>`;
          recompute(); H.saveData && H.saveData(); };
        m.querySelectorAll("[data-hf2]").forEach(b => b.onclick = () => { f2 = b.dataset.hf2; m.querySelectorAll("[data-hf2]").forEach(x => x.classList.toggle("on", x === b)); draw(); });
        const hp = m.querySelector("[data-hproto]"); if (hp) hp.onchange = () => { hproto = hp.value; draw(); };
        m.querySelector("[data-hproviz]").onclick = () => { const s = selected(); if (!s.length) { H.toast("İşlem seçin.", "w"); return; } s.forEach(o => o.durum = "Provizyon istendi"); H.log("Provizyon istendi", vzName(p.name) + " · " + s.length + " işlem"); H.toast("Provizyon istendi (" + s.length + ")"); draw(); };
        m.querySelector("[data-hparcali]").onclick = () => { if (!H.protoOpen(p)) { H.toast("Protokol kapalı · fatura kesilemez.", "e"); return; } const s = selected(); if (!s.length) { H.toast("İşlem seçin.", "w"); return; } faturaKesinlestirModal(p, s, "Parçalı fatura"); };
        m.querySelector("[data-hpaket]").onclick = () => H.toast("Panel paket için paket tanımı gerekir (admin → Hizmet Kartı · Paketler).", "w");
        body.oncontextmenu = (e) => { const tr = e.target.closest("[data-hrow]"); if (!tr) return; e.preventDefault(); const o = (H.data.orders || []).find(x => x.id === tr.dataset.hrow); if (!o) return;
          const needP = (perm, fn) => () => { if (!H.canAct(perm)) { H.toast("Yetkiniz yok (" + perm + ").", "e"); return; } fn(); };
          vzMenu(e, [
            ["Doktor değiştir", needP("protokol_duzenle", () => { const n = prompt("İsteyen doktor:", o.by || ""); if (n != null) { o.by = n.trim(); H.log("İstem doktoru değişti", o.ad || ""); draw(); } })],
            ["Tarih değiştir", needP("protokol_duzenle", () => { const n = prompt("Tarih (GG.AA.YYYY SS:DD):", o.at || ""); if (n != null) { o.at = n.trim(); H.log("İstem tarihi değişti", o.ad || ""); draw(); } })],
            ["Tutar düzelt / yeniden fiyatlandır", needP("fiyat_duzenle", () => { const v = prompt("Yeni fiyat (₼):", fiyatOf(o)); if (v != null && v !== "" && !isNaN(+v)) { o.fiyat = +v; H.log("İşlem yeniden fiyatlandırıldı", (o.ad || "") + " · " + v); draw(); } })],
            ["Durum değiştir", needP("protokol_duzenle", () => { const v = prompt("Durum (İstendi / Bekliyor / İşlemde / Faturalandı / İptal):", o.durum || "İstendi"); if (v != null && v.trim()) { o.durum = v.trim(); draw(); } })],
            ["Özel onay (ödeme alındı)", () => { o.ozelOnay = true; H.log("Özel onay", o.ad || ""); H.toast("Özel onay işaretlendi"); }],
            ["Yazdır (hizmet dökümü)", () => H.printTable ? H.printTable("Hizmet dökümü · " + vzName(p.name), ["İşlem", "Tür", "Tarih", "Fiyat ₼", "Durum"], [[o.ad || "", o.cat || "", o.at || "", fiyatOf(o), o.durum || ""]]) : H.toast("Yazdırma yok", "w")],
          ]); };
        const selected = () => [...m.querySelectorAll("[data-hsel]:checked")].map(c => (H.data.orders || []).find(o => o.id === c.dataset.hsel)).filter(Boolean);
        const recompute = () => { topEl.textContent = selected().reduce((a, o) => a + fiyatOf(o), 0); };
        draw();
        body.addEventListener("change", recompute);
        m.querySelector("[data-hall]").onchange = (e) => { m.querySelectorAll("[data-hsel]:not(:disabled)").forEach(c => c.checked = e.target.checked); recompute(); };
        m.querySelector("[data-hfatura]").onclick = () => { if (!H.protoOpen(p)) { H.toast("Protokol kapalı · fatura kesilemez.", "e"); return; } const s = selected(); if (!s.length) { H.toast("İşlem seçin.", "w"); return; } faturaKesinlestirModal(p, s, "Fatura kesildi"); };
        m.querySelector("[data-hindirim]").onclick = () => { const s = selected(); if (!s.length) { H.toast("İşlem seçin.", "w"); return; }
          const top = s.reduce((a, o) => a + fiyatOf(o), 0); (H.data.indirimOnay = indirimRows()).unshift({ id:"io" + Date.now(), tarih:H.nowFull ? H.nowFull() : H.now(), hasta:p.name, isteyen:(H.state.user || {}).name || "Vezne", islem:s.map(o => o.ad).join(", ").slice(0, 60), tutar:top, oran:0, durum:"Onay bekliyor", grup:"Hastaya İskonto", zincir:zinc([["Vezne", (H.state.user || {}).name || "Vezne"], ["Mali İşler", "Ülvi İsgenderov"]]) });
          H.log("İndirime gönderildi", vzName(p.name) + " · " + s.length + " işlem"); H.toast("İndirim onayına gönderildi (" + s.length + " işlem)"); H.closeModal(); };
        m.querySelector("[data-hbekle]").onclick = () => { const s = selected(); if (!s.length) { H.toast("İşlem seçin.", "w"); return; } s.forEach(o => o.durum = "Bekliyor"); H.toast("Bekleyene atıldı (" + s.length + ")", "w"); draw(); };
      } });
  }
  // Vezneden tetkik/radyoloji isteği: hastanın istem listesine düşer (doktor iş listesinde görünür).
  function vzIstekModal(pid) {
    const p = H.pt(pid); if (!p) return;
    const tipOf = (r) => (H.HIZMET_TIP ? H.HIZMET_TIP[r[3]] : "") || "";
    const POOL = (H.HIZMET || []).filter(r => ["Laboratuvar Hizmeti", "Radyoloji Hizmeti", "Patoloji Hizmeti"].includes(tipOf(r)));
    H.modal({ title:"Tetkik / radyoloji iste · " + H.esc(vzName(p.name)), wide:true,
      body:`<div class="rc-add" style="margin-bottom:10px"><div class="amel-cb" style="flex:1;min-width:240px"><input data-vi placeholder="Tetkik / radyoloji ara (katalogdan)" autocomplete="off"><div class="amel-dd hidden" data-vidd></div></div><button class="btn p sm" data-viadd>Ekle</button></div>
        <div data-vilist></div>
        <p class="adm-sub" style="margin-top:8px">Vezne hastaya tetkik/radyoloji isteğinde bulunabilir; istek hastanın istem listesine ve doktorun iş listesine düşer. Protokol kapalıysa eklenemez.</p>`,
      actions:`<button class="btn" data-x>Kapat</button>`,
      onMount(m) {
        const inp = m.querySelector("[data-vi]"), dd = m.querySelector("[data-vidd]"), list = m.querySelector("[data-vilist]");
        inp.dataset.kod = "";
        const show = () => { const q = (inp.value || "").trim().toLocaleLowerCase("tr"); const hits = (q ? POOL.filter(r => (r[1] + " " + r[2] + " " + r[0]).toLocaleLowerCase("tr").includes(q)) : POOL).slice(0, 40);
          dd.innerHTML = hits.length ? hits.map(r => `<div class="amel-opt" data-code="${H.esc(r[0])}" data-ad="${H.esc(hzName(r))}" data-tip="${H.esc(tipOf(r))}"><b>${H.esc(hzName(r))}</b> <span class="mono adm-sub">${H.esc(r[0])}</span> <span class="adm-sub">${H.esc(tipOf(r))}</span></div>`).join("") : `<div class="amel-opt mute">Eşleşen tetkik yok</div>`; dd.classList.remove("hidden"); };
        inp.addEventListener("input", show); inp.addEventListener("focus", show);
        dd.addEventListener("click", (e) => { const o = e.target.closest("[data-code]"); if (!o) return; inp.value = o.dataset.ad; inp.dataset.kod = o.dataset.code; inp.dataset.tip = o.dataset.tip; dd.classList.add("hidden"); });
        const drawL = () => { const mine = (H.data.orders || []).filter(o => o.pid === p.id && o.vzIstek); list.innerHTML = mine.length ? `<div class="tw"><table class="t"><thead><tr><th>İstek</th><th>Tür</th><th>Saat</th></tr></thead><tbody>${mine.map(o => `<tr><td><b>${H.esc(o.ad || "")}</b></td><td class="adm-sub">${H.esc(o.cat || "")}</td><td class="adm-sub">${H.esc(o.at || "")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="adm-sub">Henüz istek eklenmedi.</div>`; };
        drawL();
        m.querySelector("[data-viadd]").onclick = () => {
          if (!H.protoOpen(p)) { H.toast("Protokol kapalı · istek eklenemez.", "e"); return; }
          const ad = (inp.value || "").trim(), kod = inp.dataset.kod || "", tip = inp.dataset.tip || ""; if (!ad) { H.toast("Katalogdan tetkik seçin.", "w"); return; }
          const cat = /Radyoloji/.test(tip) ? "Radyoloji" : /Patoloji/.test(tip) ? "Patoloji" : "Laboratuvar";
          (H.data.orders = H.data.orders || []).unshift({ id:"ord" + Date.now() + Math.floor(Math.random() * 1e3), pid:p.id, cat, ad, kod, by:(H.state.user || {}).name || "Vezne", at:H.nowFull ? H.nowFull() : H.now(), durum:"İstendi", vzIstek:true, protokolNo:(H.proto ? H.proto.activeNo(p.id) : undefined) }); H.saveData && H.saveData();
          H.log("Vezneden tetkik isteği", vzName(p.name) + " · " + ad); H.toast("İstek eklendi: " + ad); inp.value = ""; inp.dataset.kod = ""; drawL();
        };
        document.addEventListener("click", (e) => { const cb = m.querySelector(".amel-cb"); if (cb && !cb.contains(e.target)) dd.classList.add("hidden"); });
      } });
  }
  // Rail listesi modalı: filtre kutusu + (pid varsa) tıklanabilir satırlar.
  // Vezne hasta kabul: FİN/hasta no ile ara → varsa kart, yoksa yeni kayıt pop-up.
  function vzFinAra(root) {
    const inp = root.querySelector("[data-fin]"); const raw = (inp && inp.value || "").trim(); if (!raw) { H.toast("FİN veya hasta no girin.", "w"); return; }
    const q = raw.toLocaleLowerCase("tr"), qd = raw.replace(/\D/g, "");
    const p = (H.data.patients || []).find(x => (x.fin || "").toLocaleLowerCase("tr") === q || (x.hn || "").toLocaleLowerCase("tr") === q || (qd && String(x.hn || "").replace(/\D/g, "") === qd));
    if (p) { H.go("hasta360", { pid:p.id }); return; }
    H.modal({ title:"Hasta bulunamadı", body:`<p>Bu FİN / hasta no ile kayıtlı hasta yok:</p><p><b class="mono">${H.esc(raw)}</b></p><p class="adm-sub">Yeni kayıt açmak ister misiniz? (Hasta kabul ekranına gidersiniz.)</p>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-yeni>Yeni kayıt aç</button>`,
      onMount(m) { m.querySelector("[data-yeni]").onclick = () => { H.closeModal(); H.go("admission", { tab:"ayaktan", pre:/^[A-Za-z0-9]{7}$/.test(raw) ? { fin:raw.toUpperCase() } : { name:raw } }); }; } });
  }
  // İstek havuzu: doktor/hemşirenin açtığı istemler (durum "İstendi") burada bekler; vezne seçip "İşleme Al" ile protokole geçirir.
  function istekHavuzuModal() {
    const draw = (m) => {
      const reqs = (H.data.orders || []).filter(o => (o.durum || "İstendi") === "İstendi");
      const body = m.querySelector("[data-ihbody]");
      body.innerHTML = reqs.length ? reqs.map(o => { const p = H.pt(o.pid) || {};
        return `<tr><td><input type="checkbox" data-ihc="${H.esc(o.id)}"></td><td><b>${H.esc(vzName(p.name || "—"))}</b></td><td class="mono adm-sub">${H.esc(o.protokolNo || "—")}</td><td class="adm-sub">${H.esc(o.cat || "—")}</td><td>${H.esc(o.ad || "—")}</td><td class="adm-sub">${H.esc(o.by || "—")}</td><td class="adm-sub">${H.esc(o.at || "—")}</td></tr>`;
      }).join("") : `<tr><td colspan="7" class="mute" style="padding:16px;text-align:center">İşleme alınacak istem yok.</td></tr>`;
      const cnt = m.querySelector("[data-ihcount]"); if (cnt) cnt.textContent = reqs.length + " bekleyen istem";
    };
    H.modal({ title:"İstek havuzu · doktor/hemşire istemleri", wide:true,
      body:`<p class="adm-sub" style="margin:0 0 10px">Doktor ve hemşirenin açtığı tetkik/işlem istemleri burada bekler. Seçip <b>İşleme Al</b> deyince hastanın protokolüne (işlem havuzu) geçer ve faturalanabilir olur.</p>
        <div class="adm-bar"><label class="r" style="gap:6px;align-items:center"><input type="checkbox" data-ihall> Tümünü seç</label><span class="spacer"></span><span class="adm-sub" data-ihcount></span></div>
        <div class="tw"><table class="t"><thead><tr><th style="width:34px"></th><th>Hasta</th><th style="width:120px">Protokol</th><th>Tür</th><th>İstem</th><th>İsteyen</th><th style="width:120px">Tarih</th></tr></thead><tbody data-ihbody></tbody></table></div>`,
      actions:`<button class="btn p" data-ihal>${I("ok") || ""} İşleme Al</button><span class="spacer"></span><button class="btn" data-x>Kapat</button>`,
      onMount(m) {
        draw(m);
        const all = m.querySelector("[data-ihall]"); if (all) all.onchange = () => m.querySelectorAll("[data-ihc]").forEach(c => { c.checked = all.checked; });
        m.querySelector("[data-ihal]").onclick = () => {
          const ids = [...m.querySelectorAll("[data-ihc]:checked")].map(c => c.dataset.ihc);
          if (!ids.length) { H.toast("İstem seçin.", "w"); return; }
          (H.data.orders || []).forEach(o => { if (ids.includes(o.id)) o.durum = "İşlemde"; });
          H.saveData && H.saveData(); H.log("İşleme alındı", ids.length + " istem"); H.toast(ids.length + " istem işleme alındı · protokole geçti"); draw(m);
          const all2 = m.querySelector("[data-ihall]"); if (all2) all2.checked = false;
        };
      } });
  }
  // Onam formları (video 6): bekleyen onam/dosya kayıtları; dosya yükleyince tamamlanır.
  function onamStore() { return H.data.onamlar = H.data.onamlar || [
    { id:"on1", tip:"Onam formu", ad:"Ameliyat onamı", hasta:"Elvin Hüseynov", proto:"2026-104501", bolum:"Kardiologiya", durum:"Bekliyor" },
    { id:"on2", tip:"Dosya", ad:"Pasaport", hasta:"Nobatxanım Dadaşova", proto:"2026-104812", bolum:"Oftalmologiya", durum:"Bekliyor" },
    { id:"on3", tip:"Dosya", ad:"Nüfus cüzdanı fotokopisi", hasta:"Nərgiz Əliyeva", proto:"2026-104533", bolum:"Daxili", durum:"Bekliyor" },
    { id:"on4", tip:"Onam formu", ad:"Aydınlatılmış onam", hasta:"Elvin Hüseynov", proto:"2026-104501", bolum:"Kardiologiya", durum:"Tamamlandı" },
  ]; }
  function onamModal() {
    let f = "Bekliyor";
    const draw = (m) => { const list = onamStore().filter(x => f === "hepsi" ? true : x.durum === f);
      m.querySelector("[data-onbody]").innerHTML = list.length ? list.map(x => `<tr><td><span class="tag">${H.esc(x.tip)}</span></td><td><b>${H.esc(x.ad)}</b></td><td>${H.esc(vzName(x.hasta))}</td><td class="mono adm-sub">${H.esc(x.proto)}</td><td class="adm-sub">${H.esc(x.bolum || "—")}</td><td><span class="tag ${x.durum === "Tamamlandı" ? "ok" : "w"}">${H.esc(x.durum)}</span></td><td>${x.durum === "Bekliyor" ? `<button class="btn p sm" data-onyukle="${x.id}">${x.tip === "Dosya" ? "Dosya yükle" : "İmzalı yükle"} · tamamla</button>` : `<span class="adm-sub">—</span>`}</td></tr>`).join("") : `<tr><td colspan="7" class="mute" style="padding:16px;text-align:center">Kayıt yok.</td></tr>`;
      m.querySelectorAll("[data-onseg]").forEach(b => b.classList.toggle("on", b.dataset.onseg === f));
    };
    H.modal({ title:"Onam formları / dosya kontrol", wide:true,
      body:`<p class="adm-sub" style="margin:0 0 8px">Eksik onam formu ve dosyalar burada bekler; yükleyip tamamlayınca listeden düşer (çıkış/fatura öncesi kontrol).</p>
        <div class="seg" style="margin-bottom:10px">${[["Bekliyor", "Bekleyen"], ["Tamamlandı", "Tamamlanmış"], ["hepsi", "Tümü"]].map(([k, l]) => `<button data-onseg="${k}">${l}</button>`).join("")}</div>
        <div class="tw"><table class="t"><thead><tr><th style="width:90px">Tip</th><th>Doküman</th><th>Hasta</th><th style="width:110px">Protokol</th><th>Bölüm</th><th style="width:120px">Durum</th><th style="width:180px"></th></tr></thead><tbody data-onbody></tbody></table></div>`,
      actions:`<button class="btn" data-x>Kapat</button>`,
      onMount(m) { draw(m);
        m.querySelector(".seg").onclick = (e) => { const b = e.target.closest("[data-onseg]"); if (b) { f = b.dataset.onseg; draw(m); } };
        m.querySelector("[data-onbody]").onclick = (e) => { const b = e.target.closest("[data-onyukle]"); if (!b) return; const x = onamStore().find(y => y.id === b.dataset.onyukle); if (x) { x.durum = "Tamamlandı"; x.yukleyen = (H.state.user || {}).name || "Vezne"; H.saveData && H.saveData(); H.log("Onam/dosya tamamlandı", x.ad + " · " + x.hasta); H.toast(x.ad + " yüklendi · tamamlandı"); draw(m); } }; } });
  }
  /* ---------- Fatura kesinleştirme: satır-kalem + kurum payı + indirim + KDV ---------- */
  // Kurum payı oranı (demo): SAMHI %70, özel sigorta/anlaşmalı %60, özel ödeme %0 (hasta hepsini öder).
  const kurumPayOrani = (k) => samhiKurum(k) ? 0.70 : ozelSigorta(k) ? 0.60 : 0;
  // Fatura kesme zinciri: order'lar "Faturalandı" + protokol fatura durumu + Faturalar + GFK + evrak. bd = kesim dökümü.
  function cutInvoice(p, s, label, bd) {
    const kurum = p.kurum || "Özel ödeme";
    s.forEach(o => o.durum = "Faturalandı"); p.faturaKesildi = true;
    const protos = [...new Set(s.map(o => o.protokolNo).filter(Boolean))], fno = "FTR-" + (Date.now() % 1000000);
    protos.forEach(no => { const pr = H.proto && H.proto.get(p.id, no); if (pr) pr.fatura = { durum:"Kesildi", tutar:Math.round(((pr.fatura && pr.fatura.tutar) || 0) + bd.hastaPayi / protos.length), kurum }; });
    (H.data.faturalar = faturalar()).unshift({ id:"fat" + Date.now(), hasta:p.name, protokol:(protos[0] || p.proto || "—") + (p.dx ? " · " + p.dx : ""), kurum, toplam:bd.brut, katilim:bd.hastaPayi, kurumPayi:bd.kurumPayi, indirim:bd.indirim, kdv:bd.kdvTutar, kdvOran:bd.kdvOran, kalemler:bd.kalem, kesin:true, durum:"Bekliyor", protokolNo:protos[0], no:fno, tarih:(H.nowFull ? H.nowFull() : "") });
    H.data.gfk = gfkRows(); protos.forEach(no => { const ex = H.data.gfk.find(g => g.proto === no); if (ex) ex.durum = "Hasta faturası kesilmiş"; else { const pr = H.proto && H.proto.get(p.id, no); H.data.gfk.unshift({ proto:no, hasta:p.name, gelis:(pr && pr.gelisTipi) || "Ayaktan", ptip:(pr && pr.ptip) || "Normal", bolum:(pr && pr.bolum) || "—", durum:"Hasta faturası kesilmiş" }); } });
    (H.data.evrak = evrakRows()).unshift({ no:fno, matbu:"", kurum, durum:"Veznede" });
    H.saveData && H.saveData();
    H.log(label, vzName(p.name) + " · " + s.length + " işlem · brüt " + bd.brut + " ₼ · hasta payı " + bd.hastaPayi + " ₼" + (protos.length ? " · prot " + protos.join(",") : ""));
    H.toast(label + ": hasta payı " + bd.hastaPayi + " ₼ · fatura + GFK + evrak oluştu");
    H.closeModal();
  }
  // Kesinleştirme modalı: kalem dökümü + düzenlenebilir kurum payı %, indirim ₼, KDV %. Net hasta payı canlı hesaplanır.
  function faturaKesinlestirModal(p, s, label) {
    if (!s || !s.length) { H.toast("İşlem seçin.", "w"); return; }
    const kurum = p.kurum || "Özel ödeme";
    const fiyatOf = (o) => o.fiyat != null ? +o.fiyat : (o.kod ? (+H.fiyatOf(o.kod, kurum) || 0) : (+o.tutar || 0));
    const kalem = s.map(o => ({ ad:o.ad || o.cat || "—", kod:o.kod || "", cat:o.cat || "", birim:+fiyatOf(o) || 0 }));
    const brut = kalem.reduce((a, k) => a + k.birim, 0);
    const kpOran0 = Math.round(kurumPayOrani(kurum) * 100), kdvMuaf = !!p.kdvMuaf;
    const body = `<div class="adm-bar" style="margin-bottom:8px"><span class="tag">Kurum: ${esc(kurum)}</span>${kdvMuaf ? `<span class="tag w">KDV'den muaf hasta</span>` : ""}<span class="spacer"></span><span class="adm-sub">${s.length} kalem</span></div>
      <div class="tw"><table class="t"><thead><tr><th>İşlem / kalem</th><th style="width:140px">Tür</th><th style="width:120px">Kod</th><th style="width:100px">Tutar</th></tr></thead><tbody>
      ${kalem.map(k => `<tr><td><b>${esc(k.ad)}</b></td><td class="adm-sub">${esc(k.cat)}</td><td class="mono adm-sub">${esc(k.kod || "—")}</td><td class="n">${k.birim.toFixed(2)} ₼</td></tr>`).join("")}
      </tbody><tfoot><tr><td colspan="3"><b>Brüt toplam</b></td><td class="n"><b data-fkbrut>${brut.toFixed(2)} ₼</b></td></tr></tfoot></table></div>
      <div class="rc-head" style="margin-top:12px">
        <div class="fr"><label>Kurum payı (%)</label><input type="number" data-fk="kp" value="${kpOran0}" min="0" max="100"></div>
        <div class="fr"><label>İndirim (₼)</label><input type="number" data-fk="ind" value="0" min="0"></div>
        <div class="fr"><label>KDV (%)</label><input type="number" data-fk="kdv" value="0" min="0" max="18"${kdvMuaf ? " disabled" : ""}></div>
      </div>
      <div class="tw" style="margin-top:10px"><table class="t"><tbody data-fkhesap></tbody></table></div>
      <p class="adm-sub" style="margin-top:6px">Kurum payı sigorta/kurum tarafından karşılanır; kalanı hasta öder. İndirim onaylı olmalıdır. Tıbbi hizmet çoğunlukla KDV'den muaftır (hasta kartında işaretliyse kilitli). Değerler örnektir, gerçek oranlar kurum anlaşmasına göre.</p>`;
    H.modal({ title:(label || "Fatura kes") + " · " + esc(vzName(p.name)), wide:true, body,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-fkok>Kesinleştir ve fatura kes</button>`,
      onMount(m) {
        const g = (k) => { const el = m.querySelector(`[data-fk="${k}"]`); return Math.max(0, +(el && el.value) || 0); };
        const calc = () => {
          const kp = Math.min(100, g("kp")), kdv = kdvMuaf ? 0 : Math.min(100, g("kdv"));
          const kurumPayi = Math.round(brut * kp / 100 * 100) / 100;
          const afterKurum = brut - kurumPayi;
          const indirim = Math.min(afterKurum, g("ind"));
          const netHasta = Math.max(0, afterKurum - indirim);
          const kdvTutar = Math.round(netHasta * kdv / 100 * 100) / 100;
          const hastaPayi = Math.round((netHasta + kdvTutar) * 100) / 100;
          return { brut, kalem, kurumPayi, indirim, netHasta, kdvOran:kdv, kdvTutar, hastaPayi };
        };
        const drawHesap = () => { const b = calc();
          m.querySelector("[data-fkhesap]").innerHTML = [
            ["Brüt toplam", b.brut], ["Kurum payı (−)", -b.kurumPayi], ["İndirim (−)", -b.indirim],
            ["Ara toplam (hasta)", b.netHasta], [`KDV (%${b.kdvOran})`, b.kdvTutar],
          ].map(([l, v]) => `<tr><td class="adm-sub">${l}</td><td class="n adm-sub">${v.toFixed(2)} ₼</td></tr>`).join("") +
          `<tr><td><b>Hasta ödeyecek</b></td><td class="n"><b>${b.hastaPayi.toFixed(2)} ₼</b></td></tr>`;
        };
        drawHesap();
        m.querySelectorAll("[data-fk]").forEach(el => el.addEventListener("input", drawHesap));
        m.querySelector("[data-fkok]").onclick = () => { if (!H.protoOpen(p)) { H.toast("Protokol kapalı · fatura kesilemez.", "e"); return; } cutInvoice(p, s, label || "Fatura kesildi", calc()); };
      } });
  }
  // Fatura dökümü (satır-kalem + kesim): kesinleşmiş faturanın kalem ve kırılım görünümü, yazdırılabilir.
  function faturaDetayModal(f) {
    const kalem = f.kalemler || [];
    const brk = [["Brüt toplam", f.toplam], ["Kurum payı (−)", -(f.kurumPayi || 0)], ["İndirim (−)", -(f.indirim || 0)], [`KDV (%${f.kdvOran || 0})`, f.kdv || 0], ["Hasta ödeyecek", f.katilim]];
    const body = `<div class="adm-bar" style="margin-bottom:8px"><span class="tag">${esc(f.no || f.id)}</span><span class="tag ${f.durum === "Ödendi" ? "ok" : "w"}">${esc(f.durum)}</span><span class="spacer"></span><span class="adm-sub">${esc(f.kurum || "")} · ${esc(f.tarih || "")}</span></div>
      ${kalem.length ? `<div class="tw"><table class="t"><thead><tr><th>Kalem</th><th style="width:140px">Tür</th><th style="width:120px">Kod</th><th style="width:100px">Tutar</th></tr></thead><tbody>${kalem.map(k => `<tr><td><b>${esc(k.ad)}</b></td><td class="adm-sub">${esc(k.cat || "")}</td><td class="mono adm-sub">${esc(k.kod || "—")}</td><td class="n">${(+k.birim || 0).toFixed(2)} ₼</td></tr>`).join("")}</tbody></table></div>` : `<div class="adm-sub" style="margin-bottom:8px">Bu fatura kalem dökümü olmadan oluşturulmuş (eski kayıt).</div>`}
      <div class="tw" style="margin-top:10px"><table class="t"><tbody>${brk.map(([l, v], i) => `<tr><td class="${i === brk.length - 1 ? "" : "adm-sub"}">${i === brk.length - 1 ? "<b>" + l + "</b>" : l}</td><td class="n ${i === brk.length - 1 ? "" : "adm-sub"}">${i === brk.length - 1 ? "<b>" + (+v || 0).toFixed(2) + " ₼</b>" : (+v || 0).toFixed(2) + " ₼"}</td></tr>`).join("")}</tbody></table></div>`;
    H.modal({ title:"Fatura dökümü · " + esc(vzName(f.hasta)), wide:true, body,
      actions:`<button class="btn" data-fkyaz>${I("print") || ""} Yazdır</button><span class="spacer"></span><button class="btn p" data-x>Kapat</button>`,
      onMount(m) { m.querySelector("[data-fkyaz]").onclick = () => H.printTable ? H.printTable("Fatura · " + (f.no || f.id), ["Kalem", "Kod", "Tutar ₼"], kalem.map(k => [k.ad, k.kod || "—", (+k.birim || 0).toFixed(2)]).concat(brk.map(([l, v]) => [l, "", (+v || 0).toFixed(2)])), { sub:esc(f.kurum || "") + " · " + esc(f.tarih || "") }) : H.toast("Yazdırma yok", "w"); } });
  }
  // Toplu fatura işlemleri: fatura kesilmemiş protokolleri seçip toplu faturala.
  function topluFaturaModal() {
    const draw = (m) => { const list = gfkRows().filter(x => x.durum !== "Fatura kesildi");
      m.querySelector("[data-tfbody]").innerHTML = list.length ? list.map(x => { const pid = pidByName(x.hasta), p = pid && H.pt(pid), k = (p && p.kurum) || x.kurum || "Özel ödeme", t = protoTutar(x.proto, k); return `<tr><td><input type="checkbox" data-tfc="${H.esc(x.proto)}"></td><td class="mono">${H.esc(x.proto)}</td><td><b>${H.esc(vzName(x.hasta))}</b></td><td class="adm-sub">${H.esc(k)}</td><td class="n">${t ? t.toFixed(2) + " ₼" : "—"}</td><td class="adm-sub">${H.esc(x.ptip)}</td><td><span class="tag w">${H.esc(x.durum)}</span></td></tr>`; }).join("") : `<tr><td colspan="7" class="mute" style="padding:16px;text-align:center">Faturalanacak protokol yok.</td></tr>`;
      const c = m.querySelector("[data-tfcount]"); if (c) c.textContent = list.length + " protokol"; };
    H.modal({ title:"Toplu fatura işlemleri", wide:true,
      body:`<p class="adm-sub" style="margin:0 0 8px">Fatura kesilmemiş protokoller; seçip toplu faturalayın.</p>
        <div class="adm-bar"><label class="r" style="gap:6px;align-items:center"><input type="checkbox" data-tfall> Tümünü seç</label><span class="spacer"></span><span class="adm-sub" data-tfcount></span></div>
        <div class="tw"><table class="t"><thead><tr><th style="width:34px"></th><th style="width:110px">Protokol</th><th>Hasta</th><th>Kurum</th><th style="width:110px">Tutar</th><th>Protokol tipi</th><th style="width:160px">Durum</th></tr></thead><tbody data-tfbody></tbody></table></div>`,
      actions:`<button class="btn p" data-tffat>Seçilenleri faturala</button><span class="spacer"></span><button class="btn" data-x>Kapat</button>`,
      onMount(m) { draw(m);
        const all = m.querySelector("[data-tfall]"); if (all) all.onchange = () => m.querySelectorAll("[data-tfc]").forEach(c => { c.checked = all.checked; });
        m.querySelector("[data-tffat]").onclick = () => { if (!H.canAct("toplu_fatura") && !H.can("summary")) { H.toast("Toplu fatura yetkiniz yok.", "e"); return; } const ids = [...m.querySelectorAll("[data-tfc]:checked")].map(c => c.dataset.tfc); if (!ids.length) { H.toast("Protokol seçin.", "w"); return; }
          gfkRows().forEach(x => { if (ids.includes(x.proto)) x.durum = "Fatura kesildi"; }); H.saveData && H.saveData(); H.log("Toplu fatura", ids.length + " protokol"); H.toast(ids.length + " protokol faturalandı"); draw(m); const a = m.querySelector("[data-tfall]"); if (a) a.checked = false; }; } });
  }
  // Randevulanacak hizmetler: faturalanıp randevusu verilecek hizmetler; "Randevu ver" → randevu ekranı.
  function randevuHizmetStore() { return H.data.randevuHizmet = H.data.randevuHizmet || [
    { id:"rh1", hizmet:"MR çekimi", hasta:"Nərgiz Əliyeva", bolum:"Radiologiya", durum:"Randevu bekliyor" },
    { id:"rh2", hizmet:"Fizik tedavi", hasta:"Nərgiz Əliyeva", bolum:"FTR", durum:"Randevu bekliyor" },
    { id:"rh3", hizmet:"Ekokardiyografi", hasta:"Elvin Hüseynov", bolum:"Kardiologiya", durum:"Randevu bekliyor" },
  ]; }
  function randevulanacakModal() {
    const draw = (m) => { const list = randevuHizmetStore();
      m.querySelector("[data-rhbody]").innerHTML = list.length ? list.map(x => `<tr><td><b>${H.esc(x.hizmet)}</b></td><td>${H.esc(vzName(x.hasta))}</td><td class="adm-sub">${H.esc(x.bolum)}</td><td><span class="tag ${x.durum === "Randevu verildi" ? "ok" : "w"}">${H.esc(x.durum)}</span></td><td>${x.durum === "Randevu bekliyor" ? `<button class="btn p sm" data-rhver="${x.id}">Randevu ver</button>` : `<span class="adm-sub">—</span>`}</td></tr>`).join("") : `<tr><td colspan="5" class="mute" style="padding:16px;text-align:center">Randevu bekleyen hizmet yok.</td></tr>`;
    };
    H.modal({ title:"Randevulanacak hizmetler", wide:true,
      body:`<p class="adm-sub" style="margin:0 0 8px">Faturalanıp randevusu verilecek hizmetler. "Randevu ver" randevu ekranını açar; verilince listeden düşer.</p>
        <div class="tw"><table class="t"><thead><tr><th>Hizmet</th><th>Hasta</th><th>Bölüm</th><th style="width:150px">Durum</th><th style="width:130px"></th></tr></thead><tbody data-rhbody></tbody></table></div>`,
      actions:`<button class="btn" data-x>Kapat</button>`,
      onMount(m) { draw(m);
        m.querySelector("[data-rhbody]").onclick = (e) => { const b = e.target.closest("[data-rhver]"); if (!b) return; const x = randevuHizmetStore().find(y => y.id === b.dataset.rhver); if (x) { x.durum = "Randevu verildi"; H.saveData && H.saveData(); H.log("Randevulanacak hizmet", x.hizmet + " · " + x.hasta); H.closeModal(); H.toast(x.hizmet + " için randevu ekranı açılıyor"); H.go("randevu", { view:"liste" }); } }; } });
  }
  // Onay bekleyen protokoller (video 17): faturalanmamış protokole süreli onay (Gün → Max. onaylı tarih).
  function onayProtokolModal() {
    const fmt = (d) => d.toLocaleDateString("az");
    const draw = (m) => {
      const list = gfkRows().filter(x => x.durum !== "Fatura kesildi");
      m.querySelector("[data-opbody]").innerHTML = list.length ? list.map(x => { const o = x.protokolOnay;
        return `<tr><td class="mono">${H.esc(x.proto)}</td><td><b>${H.esc(vzName(x.hasta))}</b></td><td class="adm-sub">${H.esc(x.ptip)}</td><td class="adm-sub">${H.esc(x.gelis)}</td><td>${o ? `<span class="tag ok">Onaylı · ${H.esc(o.maxTarih)}</span>` : `<span class="tag w">Onay bekliyor</span>`}</td><td>${o ? `<span class="adm-sub">${H.esc(o.aciklama || "")}</span>` : `<button class="btn p sm" data-opok="${H.esc(x.proto)}">Onayla (süreli)</button>`}</td></tr>`;
      }).join("") : `<tr><td colspan="6" class="mute" style="padding:16px;text-align:center">Onay bekleyen protokol yok.</td></tr>`;
    };
    H.modal({ title:"Onay bekleyen protokoller", wide:true,
      body:`<p class="adm-sub" style="margin:0 0 10px">Faturalanmamış protokollere süreli onay verilir: kaç gün içinde faturalanabileceğine izin (Max. onaylı tarih).</p>
        <div class="tw"><table class="t"><thead><tr><th style="width:110px">Protokol</th><th>Hasta</th><th>Protokol tipi</th><th>Geliş</th><th style="width:180px">Durum</th><th style="width:180px"></th></tr></thead><tbody data-opbody></tbody></table></div>`,
      actions:`<button class="btn" data-x>Kapat</button>`,
      onMount(m) { draw(m);
        m.querySelector("[data-opbody]").onclick = (e) => { const b = e.target.closest("[data-opok]"); if (!b) return; const x = gfkRows().find(y => y.proto === b.dataset.opok); if (!x) return;
          H.modal({ title:"Protokol onayı · " + H.esc(x.proto), body:`<div class="icd-form">
            <div class="fr"><label>Gün (onay süresi)</label><input type="number" data-f="gun" value="5" min="1"></div>
            <div class="fr"><label>Max. onaylı tarih</label><input data-f="maxt" readonly></div>
            <div class="fr" style="grid-column:1/-1"><label>Açıklama</label><input data-f="acik" placeholder="ops."></div></div>`,
            actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Onayla</button>`,
            onMount(mm) { const gun = mm.querySelector('[data-f="gun"]'), maxt = mm.querySelector('[data-f="maxt"]');
              const calc = () => { const d = new Date(); d.setDate(d.getDate() + (+gun.value || 0)); maxt.value = fmt(d); };
              gun.oninput = calc; calc();
              mm.querySelector("[data-ok]").onclick = () => { x.protokolOnay = { gun:+gun.value || 0, maxTarih:maxt.value, aciklama:(mm.querySelector('[data-f="acik"]').value || "").trim() };
                H.saveData && H.saveData(); H.log("Protokol onayı", x.proto + " · " + x.protokolOnay.gun + " gün"); H.toast("Protokol onaylandı · son tarih " + x.protokolOnay.maxTarih); H.closeModal(); onayProtokolModal(); }; } });
        }; } });
  }
  function railModal(lbl, rd) {
    const head = `<tr>${rd.cols.map(c => `<th>${H.esc(c)}</th>`).join("")}</tr>`;
    const rowHtml = (r, i) => `<tr${rd.pids ? ` data-open="${rd.pids[i]}" style="cursor:pointer"` : ""}>${r.map(c => `<td>${H.esc(String(c))}</td>`).join("")}</tr>`;
    H.modal({ title:lbl, wide:true,
      body:`<div class="adm-bar"><input data-rq placeholder="Ara (ad, no, ...)" style="flex:1"></div>
        <div class="tw"><table class="t"><thead>${head}</thead><tbody data-rbody>${rd.rows.length ? rd.rows.map(rowHtml).join("") : `<tr><td colspan="${rd.cols.length}" class="mute" style="padding:16px;text-align:center">Kayıt yok.</td></tr>`}</tbody></table></div>
        ${rd.note ? `<p class="adm-sub" style="margin-top:8px">${H.esc(rd.note)}</p>` : ""}`,
      actions:`<button class="btn" data-rexp>${I("save") || ""} Excel</button><button class="btn" data-ryaz>${I("print") || ""} Yazdır</button><span class="spacer"></span><button class="btn" data-x>Kapat</button>`,
      onMount(m) {
        const body = m.querySelector("[data-rbody]"), q = m.querySelector("[data-rq]");
        m.querySelector("[data-rexp]").onclick = () => { H.exportCsv ? (H.exportCsv(lbl.replace(/[^\wÇĞİÖŞÜçğıöşü ]+/g, "").trim() || "Liste", rd.cols, rd.rows), H.toast("Excel (CSV) indirildi")) : H.toast("Dışa aktarma yok", "w"); };
        m.querySelector("[data-ryaz]").onclick = () => { H.printTable ? H.printTable(lbl, rd.cols, rd.rows) : H.toast("Yazdırma yok", "w"); };
        if (q) q.addEventListener("input", () => { const t = q.value.trim().toLocaleLowerCase("tr");
          body.innerHTML = (t ? rd.rows.map((r, i) => [r, i]).filter(([r]) => r.join(" ").toLocaleLowerCase("tr").includes(t)) : rd.rows.map((r, i) => [r, i]))
            .map(([r, i]) => rowHtml(r, i)).join("") || `<tr><td colspan="${rd.cols.length}" class="mute" style="padding:16px;text-align:center">Eşleşme yok.</td></tr>`; });
        if (rd.pids) body.addEventListener("click", (e) => { const tr = e.target.closest("[data-open]"); if (tr) { H.closeModal(); vzHastaModal(tr.dataset.open); } });
      } });
  }
  H.register("vezne", { title:() => H.t("m_vezne"), perm:["admission", "summary"], render(root, params = {}) {
    const bankolar = BANKOLAR(), banko = H.state.vezneBanko || bankolar[0], tab = params.tab || "giris";
    // Dönem per-banko: her banko/kasa kendi dönemini açar/kapatır. Banko değişince o bankonun dönemi görünür (gerçek vezne akışı).
    const donemler = H.data.vezneDonemler = H.data.vezneDonemler || {};
    if (!H.data.vezneDonemSeq) H.data.vezneDonemSeq = 54038;
    if (!(banko in donemler)) donemler[banko] = (banko === bankolar[0]) ? { no:H.data.vezneDonemSeq, acik:true } : { no:null, acik:false };
    const cur = donemler[banko], donemNo = cur.no, donemAcik = cur.acik, donemYetki = H.can("vezne_donem");
    const acikBankolar = Object.keys(donemler).filter(b => donemler[b].acik);
    const TABS = [["giris", "Giriş"], ["fatura", "Faturalar"], ["fiyat", "Fiyat verme"], ["indirim", "İndirim onay"], ["iade", "İade"], ["gfk", "GFK takip"], ["evrak", "Evrak takip"]];
    const bekKap = (H.data.vezneKapanislar || []).find(x => x.banko === banko && x.onay === "bekliyor");
    const bar = `<div class="ist-lock ${donemAcik ? "" : "closed"}">${I(donemAcik ? "key" : "lock") || ""}<span>${donemAcik ? `Dönem <b>#${donemNo}</b> · <b>Açık</b>` : bekKap ? `<b>Kapalı · Mali İşler onayı bekliyor (#${bekKap.no})</b>` : `<b>Kapalı · işlem yapılamaz</b>`} · Banko: <b>${H.esc(banko)}</b></span><select data-vbanko title="Çalıştığın banko/kasa — her bankonun kendi dönemi vardır">${bankolar.map(b => `<option${b === banko ? " selected" : ""}>${H.esc(b)}${donemler[b] && donemler[b].acik ? " ● açık" : ""}</option>`).join("")}</select>${donemYetki ? `<button class="btn sm" data-vdonem>${donemAcik ? "Dönemi kapat" : "Bu bankoda dönem aç"}</button>` : ""}${!donemAcik && donemYetki ? `<button class="btn sm" data-vdevir>${I("key") || ""} Devir alarak aç</button>` : ""}<button class="btn sm" data-vozet>Dönem özeti</button>${acikBankolar.length > 1 ? `<span class="adm-sub" style="margin-left:4px">Açık bankolar: ${acikBankolar.map(H.esc).join(", ")}</span>` : ""}</div>`;
    const strip = `<div class="seg" style="margin-bottom:12px">${TABS.map(([k, l]) => `<button data-vtab="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
    const panFatura = () => { const sub = params.fsub || "fatura", all = faturalar();
      const subSeg = `<div class="seg" style="margin-bottom:10px">${[["fatura", "Faturalar"], ["katilim", "Katılım payı"]].map(([k, l]) => `<button data-fsub="${k}" class="${sub === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
      if (sub === "katilim") { const top = all.reduce((a, x) => a + (x.katilim || 0), 0);
        return subSeg + `<div class="tw"><table class="t"><thead><tr><th>Protokol</th><th>Hasta</th><th>Kurum / sigorta</th><th style="width:130px">Katılım payı ₼</th><th style="width:130px">Durum</th></tr></thead><tbody>
          ${all.length ? all.map(x => `<tr data-vzhasta="${H.esc(x.hasta)}" style="cursor:pointer" title="Hasta dosyasını aç"><td class="mono adm-sub">${H.esc(x.protokol)}</td><td><b>${H.esc(vzName(x.hasta))}</b></td><td class="adm-sub">${H.esc(x.kurum)}</td><td class="n">${x.katilim} ₼</td><td><span class="tag ${x.durum === "Ödendi" ? "ok" : "w"}">${x.durum === "Ödendi" ? "Tahsil edildi" : "Bekliyor"}</span></td></tr>`).join("") : `<tr><td colspan="5" class="mute" style="padding:16px;text-align:center">Kayıt yok.</td></tr>`}
          <tr><td colspan="3"><b>Toplam katılım payı</b></td><td class="n"><b>${top} ₼</b></td><td></td></tr></tbody></table></div>
          <p class="adm-sub" style="margin-top:8px">Protokol başına hasta katılım payları (tahsil edilen / bekleyen).</p>`; }
      const f = params.durum || "hepsi", list = f === "hepsi" ? all : all.filter(x => x.durum === f);
      return subSeg + `<div class="seg" style="margin-bottom:10px">${[["hepsi", "Hepsi"], ["Bekliyor", "Bekliyor"], ["Ödendi", "Ödendi"]].map(([k, l]) => `<button data-vf="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
        ${H.durumLejant([["Tahsil edildi", "ok"], ["Bekliyor", "w"], ["Hukuksal takip", "crit"]])}
        <div class="tw"><table class="t"><thead><tr><th>Hasta</th><th>Protokol</th><th>Kurum / sigorta</th><th style="width:80px">Toplam</th><th style="width:100px">Katılım payı</th><th style="width:160px">Durum / ödeme</th><th style="width:160px"></th></tr></thead><tbody>
        ${list.length ? list.map(x => { const hukBtn = `<button class="btn sm" data-huk="${x.id}">${x.hukuksal ? "Hukuksal ✓" : "Hukuksal"}</button>`;
          const durHtml = `<span class="tag ${x.durum === "Ödendi" ? "ok" : ""}">${x.durum}</span>${x.odemeTipi ? ` <span class="adm-sub">${H.esc(x.odemeTipi)}</span>` : ""}${x.hukuksal ? ` <span class="tag w">Hukuksal takip</span>` : ""}`;
          const dokBtn = `<button class="btn sm" data-fdetay="${x.id}">Döküm</button>`;
          const act = (x.durum === "Bekliyor" ? `<button class="btn p sm" data-tahsil="${x.id}">Tahsil et</button> ${hukBtn}` : `<span class="adm-sub">${x.banko ? H.esc(x.banko) : "—"}</span>${x.hukuksal ? " " + hukBtn : ""}`) + " " + dokBtn;
          return `<tr data-vzhasta="${H.esc(x.hasta)}" style="cursor:pointer" title="Hasta dosyasını aç"><td><b>${H.esc(vzName(x.hasta))}</b></td><td class="adm-sub">${H.esc(x.protokol)}</td><td>${H.esc(x.kurum)}</td><td class="n">${x.toplam} ₼</td><td class="n">${x.katilim} ₼</td><td>${durHtml}</td><td>${act}</td></tr>`; }).join("") : `<tr><td colspan="7" class="mute" style="padding:20px;text-align:center">Fatura yok.</td></tr>`}</tbody></table></div>`; };
    const panFiyat = () => { const rows = H.data.vFiyat = H.data.vFiyat || [], kurum = params.kurum || "Özel ödeme", samhi = kurum.includes("SAMHI");
      const kamps = (H.data.kampanyalar || []).filter(k => k.aktif), kamp = kamps.find(k => k.id === params.kamp);
      const ptipler = H.data.protokolTipleri || [], ptip = ptipler.find(x => x.id === params.fptip), pf = (ptip && ptip.flags) || {}, farkYok = !!(pf.hastaFark || pf.sgkKatilim);
      const top = rows.reduce((a, r) => a + r.fiyat, 0), sgk = farkYok ? top : (samhi ? Math.round(top * 0.7) : 0), hastaBrut = top - sgk;
      const ind = (kamp && kamp.uyg === "Yüzde indirim") ? Math.round(hastaBrut * (kamp.oran || 0) / 100) : 0, hasta = hastaBrut - ind;
      const flagNot = ptip ? PTIP_ETKI.filter(([k]) => pf[k]).map(([, l]) => l) : [];
      return `<div class="rc-head" style="margin-bottom:10px"><div class="fr"><label>Kurum / sigorta</label><select data-fkurum>${((H.data.secenekler && H.data.secenekler.kurum && H.data.secenekler.kurum.length ? H.data.secenekler.kurum : ["Özel ödeme", "SAMHI (İcbari Tibbi Sığorta)", "Anlaşmalı kurum"])).map(k => `<option${k === kurum ? " selected" : ""}>${H.esc(k)}</option>`).join("")}</select></div>
        <div class="fr"><label>Protokol tipi</label><select data-fptip><option value="">— seç —</option>${ptipler.map(x => `<option value="${x.id}"${ptip && ptip.id === x.id ? " selected" : ""}>${H.esc(x.ad)}</option>`).join("")}</select></div>
        <div class="fr"><label>Kampanya / indirim</label><select data-fkamp><option value="">— yok —</option>${kamps.map(k => `<option value="${k.id}"${kamp && kamp.id === k.id ? " selected" : ""}>${H.esc(k.ad)}${k.uyg === "Yüzde indirim" ? " (%" + k.oran + ")" : ""}</option>`).join("")}</select></div></div>
        ${flagNot.length ? `<div class="ist-lock" style="margin-bottom:10px"><span>${I("key") || ""} Protokol tipi etkisi: <b>${H.esc(flagNot.join(" · "))}</b></span></div>` : ""}
        <div class="rc-add" style="margin-bottom:10px"><div class="amel-cb" style="flex:1;min-width:220px"><input data-fhiz placeholder="Hızlı ekle: hizmet ara…" autocomplete="off"${donemAcik ? "" : " disabled"}><div class="amel-dd hidden" data-fhiz-dd></div></div><input data-ffiyat type="number" placeholder="Fiyat (₼)" style="max-width:130px"${donemAcik ? "" : " disabled"}><button class="btn p sm" data-fadd${donemAcik ? "" : " disabled"}>Ekle</button><button class="btn sm" data-fsec${donemAcik ? "" : " disabled"}>${I("list") || ""} Katalogdan seç</button></div>
        <div class="tw"><table class="t"><thead><tr><th>İşlem</th><th style="width:100px">Fiyat</th><th style="width:100px">Hasta</th><th style="width:100px">SGK/kurum</th><th style="width:40px"></th></tr></thead><tbody>
        ${rows.length ? rows.map((r, i) => { const rs = farkYok ? r.fiyat : (samhi ? Math.round(r.fiyat * 0.7) : 0); return `<tr data-fri="${i}" title="Sağ tık: işlem menüsü"><td><b>${H.esc(r.ad)}</b></td><td class="n">${r.fiyat} ₼</td><td class="n">${r.fiyat - rs} ₼</td><td class="n">${rs} ₼</td><td><button class="btn g sm" data-frm="${i}">${I("x") || "×"}</button></td></tr>`; }).join("") : `<tr><td colspan="5" class="mute" style="padding:16px;text-align:center">Fiyat teklifi için hizmet ekleyin.</td></tr>`}</tbody>
        <tfoot>${ind ? `<tr><td class="adm-sub">Kampanya indirimi (${H.esc(kamp.ad)})</td><td class="n adm-sub">–${ind} ₼</td><td class="n adm-sub">–${ind} ₼</td><td class="n adm-sub">—</td><td></td></tr>` : ""}<tr><td><b>Toplam</b></td><td class="n"><b>${top} ₼</b></td><td class="n"><b>${hasta} ₼</b></td><td class="n"><b>${sgk} ₼</b></td><td></td></tr></tfoot></table></div>
        <p class="adm-sub" style="margin-top:8px">SAMHI'de hasta/kurum payı örnek %30/%70 bölünür. Kampanyayı yetkili rol admin'de oluşturur, vezne burada seçer. Teklif çıktısı alınabilir.</p>`; };
    const panGfk = () => { const g = params.gfk || "hepsi", all = gfkRows(), list = g === "hepsi" ? all : all.filter(x => x.durum === g);
      return `<div class="seg" style="margin-bottom:10px">${[["hepsi", "Hepsi"], ...GFK_DURUM.map(d => [d, d])].map(([k, l]) => `<button data-gf="${k}" class="${g === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="tw"><table class="t"><thead><tr><th>Protokol</th><th>Hasta</th><th>Kurum / sigorta</th><th>Bölüm</th><th style="width:150px">Provizyon</th><th style="width:180px">Fatura durumu</th><th style="width:130px"></th></tr></thead><tbody>
        ${list.map((x) => { const pv = x.provizyon || (samhiKurum(x.kurum) || ozelSigorta(x.kurum) ? "Alınmadı" : "Gerekmez"), al = pv === "Alınmadı";
          return `<tr data-vzhasta="${H.esc(x.hasta)}" style="cursor:pointer" title="Hasta dosyasını aç"><td class="mono">${H.esc(x.proto)}</td><td><b>${H.esc(vzName(x.hasta))}</b></td><td class="adm-sub">${H.esc(x.kurum || "—")}</td><td class="adm-sub">${H.esc(x.bolum)}</td><td><span class="tag ${/alındı|OK/i.test(pv) ? "ok" : al ? "w" : ""}">${H.esc(pv)}</span></td><td><select data-gfkst="${all.indexOf(x)}">${GFK_DURUM.map(d => `<option${x.durum === d ? " selected" : ""}>${d}</option>`).join("")}</select></td><td>${al ? `<button class="btn p sm" data-gfkprov="${all.indexOf(x)}">${samhiKurum(x.kurum) ? "Müstehaklık / takip" : "Provizyon al"}</button>` : `<span class="adm-sub">—</span>`}</td></tr>`; }).join("") || `<tr><td colspan="7" class="mute" style="padding:16px;text-align:center">Kayıt yok.</td></tr>`}</tbody></table></div>
        <p class="adm-sub" style="margin-top:8px">GFK takip: fatura öncesi kurum onayı. SAMHI'de müstehaklık sorgulanıp takip alınır, özel sigortada provizyon alınır; özel ödemede gerekmez.</p>`; };
    const panEvrak = () => { const e = params.ev || "hepsi", all = evrakRows(), list = e === "hepsi" ? all : all.filter(x => x.durum === e);
      return `<div class="seg" style="margin-bottom:10px">${[["hepsi", "Hepsi"], ...EVRAK_DURUM.map(d => [d, d])].map(([k, l]) => `<button data-ef="${k}" class="${e === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="tw"><table class="t"><thead><tr><th>Fatura no</th><th>Matbu fatura no</th><th>Kurum</th><th style="width:190px">Evrak durumu</th><th style="width:110px"></th></tr></thead><tbody>
        ${list.map(x => `<tr><td class="mono">${H.esc(x.no)}</td><td class="mono adm-sub">${H.esc(x.matbu || "—")}</td><td>${H.esc(x.kurum)}</td><td><span class="tag ${/teslim edildi|Medikal/.test(x.durum) ? "ok" : /iade/.test(x.durum) ? "w" : ""}">${H.esc(x.durum)}</span>${(x.hareket || []).length ? ` <span class="adm-sub">(${x.hareket.length} hareket)</span>` : ""}</td><td><button class="btn sm" data-evdetay="${x.no}">Detay / işlem</button></td></tr>`).join("") || `<tr><td colspan="5" class="mute" style="padding:16px;text-align:center">Evrak yok.</td></tr>`}</tbody></table></div>
        <p class="adm-sub" style="margin-top:8px">Fatura evrak teslim takibi (veznede → teslim edildi → medikal muhasebede → iç/dış iade). Satırda "Detay / işlem": evrak kontrol listesi + hareket geçmişi.</p>`; };
    const panIndirim = () => { const d = params.io || "Onay bekliyor", all = indirimRows(), list = d === "hepsi" ? all : all.filter(x => x.durum === d), can = H.canAct("indirim_onay");
      return `<div class="seg" style="margin-bottom:10px">${[["Onay bekliyor", "Onay bekleyen"], ["hepsi", "Hepsi"], ["Onaylandı", "Onaylanan"], ["Reddedildi", "Reddedilen"]].map(([k, l]) => `<button data-io="${k}" class="${d === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="tw"><table class="t"><thead><tr><th>Tarih</th><th>Hasta</th><th>İsteyen</th><th>İşlem</th><th style="width:80px">Tutar</th><th style="width:70px">Oran</th><th>Onay grubu</th><th style="width:120px">Durum</th><th style="width:150px"></th></tr></thead><tbody>
        ${list.map(x => `<tr><td class="adm-sub">${H.esc(x.tarih)}</td><td><b>${H.esc(vzName(x.hasta))}</b></td><td class="adm-sub">${H.esc(x.isteyen)}</td><td class="adm-sub">${H.esc(x.islem)}</td><td class="n">${x.tutar} ₼</td><td class="n">%${x.oran}</td><td class="adm-sub">${H.esc(x.grup)}<div class="adm-sub" style="font-size:11px">${H.esc(zincStr(x.zincir))}</div></td><td><span class="tag ${x.durum === "Onaylandı" ? "ok" : x.durum === "Reddedildi" ? "w" : ""}">${x.durum}</span></td><td>${x.durum === "Onay bekliyor" && can ? `<button class="btn p sm" data-ioap="${x.id}">Onayla</button> <button class="btn g sm" data-iored="${x.id}">Reddet</button>` : x.durum === "Onay bekliyor" ? `<span class="adm-sub">yetki yok</span>` : `<span class="adm-sub">—</span>`}</td></tr>`).join("") || `<tr><td colspan="9" class="mute" style="padding:16px;text-align:center">Kayıt yok.</td></tr>`}</tbody></table></div>
        <p class="adm-sub" style="margin-top:8px">Bir hastaya indirim atılınca yetkili rol (İndirim onayla) onaylar/reddeder. Onaylanmayan indirim fatura/tahsilatta uygulanmaz. Çok kademeli onay gerçek kurguda eklenir.</p>`; };
    const panIade = () => { const d = params.ia || "Onay bekliyor", t = params.iatip || "Tümü", all = iadeRows(), list = all.filter(x => (d === "hepsi" || x.durum === d) && (t === "Tümü" || x.tip === t)), can = H.can("iade_onay");
      return `<div class="seg" style="margin-bottom:8px">${["Tümü", "Avans İade", "Fatura İade"].map(k => `<button data-iatip="${k}" class="${t === k ? "on" : ""}">${k}</button>`).join("")}</div>
        <div class="seg" style="margin-bottom:10px">${[["Onay bekliyor", "Onay bekleyen"], ["hepsi", "Hepsi"], ["Onaylandı", "Onaylanan"], ["İade tamamlandı", "Tamamlanan"]].map(([k, l]) => `<button data-ia="${k}" class="${d === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="tw"><table class="t"><thead><tr><th>Tip</th><th>Tarih</th><th>Talep eden</th><th style="width:90px">Tutar</th><th>Departman</th><th>Açıklama</th><th>Protokol</th><th style="width:120px">Durum</th><th style="width:230px"></th></tr></thead><tbody>
        ${list.map(x => `<tr><td class="adm-sub">${H.esc(x.tip)}</td><td class="adm-sub">${H.esc(x.tarih)}</td><td><b>${H.esc(vzName(x.eden))}</b></td><td class="n">${x.tutar} ₼</td><td class="adm-sub">${H.esc(x.dep)}</td><td class="adm-sub">${H.esc(x.aciklama)}</td><td class="mono adm-sub">${H.esc(x.proto)}<div class="adm-sub" style="font-size:11px">${H.esc(zincStr(x.zincir))}</div></td><td><span class="tag ${/Onaylandı|tamamlandı/.test(x.durum) ? "ok" : x.durum === "Reddedildi" ? "w" : ""}">${x.durum}</span></td><td><button class="btn sm" data-iazinc="${x.id}">Alıcılar</button> ${x.durum === "Onay bekliyor" && can ? `<button class="btn p sm" data-iaap="${x.id}">Onayla</button> <button class="btn g sm" data-iared="${x.id}">Reddet</button>` : x.durum === "Onay bekliyor" ? `<span class="adm-sub">yetki yok</span>` : ""}</td></tr>`).join("") || `<tr><td colspan="9" class="mute" style="padding:16px;text-align:center">Kayıt yok.</td></tr>`}</tbody></table></div>
        <p class="adm-sub" style="margin-top:8px">Avans/fatura iadeleri çok kademeli onaylanır (seviye 1/2/3): her onay bir sonraki alıcıya geçer, tüm seviyeler onaylayınca iade tamamlanır. "Alıcılar" ile zinciri görebilirsiniz.</p>`; };
    const panGiris = () => { const hep = (H.data.patients || []).slice().reverse();
      const sf = (k, ph) => `<div class="fr"><label>${H.esc(ph)}</label><input data-vs="${k}" placeholder=""></div>`;
      const row = (pp) => { const bb = H.bed(pp.bed), uu = bb && H.unit(bb.unitId), att = H.userBy(pp.attending);
        const nm = (vzName(pp.name) || "").split(" "), ad = nm[0] || "", soyad = nm.slice(1).join(" ");
        const durum = pp.onKayit ? "Ön kayıt" : "Kesin", guv = pp.gizli ? "Gizli hasta" : "Normal";
        const s = [pp.hn, pp.fin, ad, soyad, pp.father, pp.mother, pp.phone, pp.pasaport, pp.uyruk, pp.proto, uu && uu.tr, att && att.name].join(" ").toLocaleLowerCase("tr");
        return `<tr data-h3open="${pp.id}" data-s="${H.esc(s)}" style="cursor:pointer"><td><span class="tag ${pp.onKayit ? "w" : "ok"}">${durum}</span></td><td class="mono adm-sub">${H.esc(pp.hn || "—")}</td><td class="mono adm-sub">${H.esc(pp.fin || "—")}</td><td><b>${H.esc(ad)}</b></td><td>${H.esc(soyad)}</td><td class="adm-sub">${H.esc(pp.father || "—")}</td><td class="adm-sub">${H.esc(pp.dob || "—")}</td><td class="adm-sub">${H.esc(pp.kurum || "—")}</td><td class="adm-sub">${H.esc(pp.phone || "—")}</td><td><span class="tag ${pp.gizli ? "w" : ""}">${guv}</span></td></tr>`; };
      return `<div class="box"><div class="ist-sec ist-hd" style="margin:0 0 8px"><h5>Hasta arama</h5><button class="btn sm" data-vsdetay>Arama detay ▾</button></div>
        <div class="icd-form vz-search">${sf("fin", "Kimlik / FİN no")}${sf("hn", "Hasta no")}${sf("ad", "Adı")}${sf("soyad", "Soyadı")}${sf("baba", "Baba adı")}${sf("ana", "Ana adı")}${sf("tel", "Telefon")}${sf("pasaport", "Pasaport no")}${sf("uyruk", "Uyruk")}</div>
        <div class="icd-form vz-search hidden" data-vsdetaym style="margin-top:4px">${sf("proto", "Protokol no")}${sf("bolum", "Bölüm")}${sf("doktor", "Doktor")}${sf("tarih1", "Tarih (baş)")}${sf("tarih2", "Tarih (bitiş)")}</div>
        <div class="r" style="gap:6px;margin-top:8px"><button class="btn p sm" data-vsara>${I("search") || ""} Listele</button><button class="btn sm" data-vstemizle>Temizle</button><span class="spacer"></span><button class="btn sm" data-vsnew title="Aradığın hasta yoksa yeni hasta + kayıt (protokol) aç">${I("plus") || ""} Yeni hasta + kayıt aç</button></div></div>
        <div class="ist-sec ist-hd"><h5>Hasta listesi</h5><span class="adm-sub" data-vscount>${hep.length} hasta</span></div>
        <div class="tw"><table class="t"><thead><tr><th style="width:80px">Durum</th><th style="width:100px">Hasta no</th><th style="width:100px">Kimlik</th><th>Adı</th><th>Soyadı</th><th>Baba adı</th><th style="width:100px">Doğum</th><th>Kurum / SGK</th><th style="width:110px">Telefon</th><th style="width:110px">Güvenlik</th></tr></thead><tbody data-vsbody>
        ${hep.length ? hep.map(row).join("") : `<tr><td colspan="10" class="mute" style="padding:16px;text-align:center">Hasta yok.</td></tr>`}</tbody></table></div>`; };
    // Kurumsal Faturalama (#61): anlaşmalı kurum faturaları · sol liste + sağ 8 dikey sekme.
    function kfSeed() {
      if (H.data.kurumFatura) return;
      H.data.kurumFatura = [
        { no:"KF-2026-0012", kurum:"Paşa Sığorta", tarih:"20.10.2026", durum:"Açık", donem:"Ekim 2026",
          kalemler:[["Tam kan sayımı (hemogram)", "L107020", 3, 18], ["Kardiyoloji muayenesi", "20.18331", 2, 60], ["EKG", "530020", 2, 25], ["Ekokardiyografi", "803840", 1, 120]],
          islemler:[["18.10.2026", "Kardiyoloji muayenesi", "Kardiologiya", "Dr. Kamran Rzayev", "Tamam"], ["18.10.2026", "EKG", "Kardiologiya", "Dr. Kamran Rzayev", "Tamam"], ["19.10.2026", "Ekokardiyografi", "Kardiologiya", "Dr. Kamran Rzayev", "Bekliyor"]],
          protokoller:[["2026-104501", "Elvin Hüseynov", "18.10.2026", "Kardiologiya"], ["2026-104533", "Nərgiz Əliyeva", "19.10.2026", "Kardiologiya"]],
          vezne:[["18.10.2026", "Avans (kurum)", 200, "Yatan Kasası"], ["19.10.2026", "Fatura tahakkuku", 436, "Yatan Kasası"]],
          evrak:[["Fatura ön yazısı", "Veznede", "20.10.2026"], ["Hizmet dökümü", "Veznede", "20.10.2026"], ["Provizyon formu", "Teslim edildi", "19.10.2026"]],
          notlar:[["19.10.2026", "Ozan Sunkur", "Kurumla aylık icmal 25'inde kesilecek."]],
          klinik:[["18.10.2026", "Muayene Dökümanı", "Dr. Kamran Rzayev"], ["19.10.2026", "Eko raporu", "Dr. Kamran Rzayev"]] },
        { no:"KF-2026-0013", kurum:"Allianz Worldwide Care", tarih:"21.10.2026", durum:"Açık", donem:"Ekim 2026",
          kalemler:[["Göz muayenesi", "20.18201", 1, 55], ["Fakoemülsifikasiya (katarakt)", "610180", 1, 1430], ["OCT", "804420", 1, 90]],
          islemler:[["20.10.2026", "Göz muayenesi", "Oftalmologiya", "Dr. Əhməd Abdullayev", "Tamam"], ["21.10.2026", "Fakoemülsifikasiya", "Oftalmologiya", "Dr. Əhməd Abdullayev", "Tamam"]],
          protokoller:[["2026-104812", "Nobatxanım Dadaşova", "20.10.2026", "Oftalmologiya"]],
          vezne:[["21.10.2026", "Fatura tahakkuku", 1575, "Yatan Kasası"]],
          evrak:[["Fatura ön yazısı", "Veznede", "21.10.2026"], ["Ameliyat raporu", "Veznede", "21.10.2026"]],
          notlar:[["21.10.2026", "Ozan Sunkur", "Yurtdışı sigorta; İngilizce fatura isteniyor."]],
          klinik:[["20.10.2026", "Preoperatif Değerlendirme", "Dr. Əhməd Abdullayev"], ["21.10.2026", "Ameliyat Raporu", "Dr. Əhməd Abdullayev"]] },
        { no:"KF-2026-0009", kurum:"Xalq Sığorta", tarih:"14.10.2026", durum:"Kapandı", donem:"Ekim 2026",
          kalemler:[["Ümumi cərrahiyyə muayenesi", "20.18101", 4, 50], ["Qarın yırtığı təmiri", "603780", 1, 780]],
          islemler:[["12.10.2026", "Cərrahiyyə muayenesi", "Ümumi Cərrahiyyə", "Dr. Rauf Abbasov", "Tamam"], ["13.10.2026", "Qarın yırtığı təmiri", "Ümumi Cərrahiyyə", "Dr. Rauf Abbasov", "Tamam"]],
          protokoller:[["2026-103990", "Vüsal Kazımov", "12.10.2026", "Ümumi Cərrahiyyə"]],
          vezne:[["12.10.2026", "Avans (kurum)", 300, "Yatan Kasası"], ["14.10.2026", "Fatura kesildi", 980, "Yatan Kasası"]],
          evrak:[["Fatura ön yazısı", "Teslim edildi", "14.10.2026"], ["Hizmet dökümü", "Teslim edildi", "14.10.2026"]],
          notlar:[["14.10.2026", "Ozan Sunkur", "Dönem kapandı, icmal kuruma iletildi."]],
          klinik:[["13.10.2026", "Ameliyat Raporu", "Dr. Rauf Abbasov"], ["14.10.2026", "Epikriz", "Dr. Rauf Abbasov"]] },
      ];
    }
    // Adım 5 · zincirden türeyen kurumsal faturalar: İşlem Havuzu'nda kurumsal kesilen faturalar burada da görünür (kalemler = protokol işlemleri).
    const kurumsalMu = (k) => k && k !== "Özel ödeme" && !/İcbari|SAMHI/.test(k);
    const chainKf = () => (H.data.faturalar || []).filter(f => f.protokolNo && kurumsalMu(f.kurum)).map(f => {
      const ords = (H.data.orders || []).filter(o => o.protokolNo === f.protokolNo), pat = (H.data.patients || []).find(x => x.name === f.hasta) || {};
      const pr = (H.proto && pat.id) ? H.proto.get(pat.id, f.protokolNo) : null, fy = (o) => o.fiyat != null ? o.fiyat : (o.kod ? H.fiyatOf(o.kod, f.kurum) : 0);
      return { no:f.no || ("KF-" + f.protokolNo), kurum:f.kurum, tarih:f.tarih || "", durum:f.durum === "Ödendi" ? "Kapandı" : "Açık", donem:new Date().toLocaleDateString("az"),
        kalemler:ords.length ? ords.map(o => [o.ad || o.cat || "—", o.kod || "—", 1, fy(o)]) : [["(işlem kaydı yok)", "—", 1, f.toplam || 0]],
        islemler:ords.map(o => [o.at || "", o.ad || o.cat || "", (pr && pr.bolum) || "—", o.by || "", o.durum || ""]),
        protokoller:[[f.protokolNo, f.hasta, f.tarih || "", (pr && pr.bolum) || "—"]],
        vezne:[[f.tarih || "", "Fatura tahakkuku", f.toplam || 0, H.state.vezneBanko || "—"]],
        evrak:(H.data.evrak || []).filter(e => e.no === f.no).map(e => [e.no, e.durum, ""]),
        notlar:[], klinik:[], _chain:true };
    });
    const kfAll = () => { kfSeed(); return [...chainKf(), ...(H.data.kurumFatura || [])]; };
    const panKurumsal = () => { const all = kfAll(), kq = (params.kfq || "").toLocaleLowerCase("tr");
      const list = all.filter(x => !kq || (x.no + " " + x.kurum).toLocaleLowerCase("tr").includes(kq));
      const sel = all.find(x => x.no === params.kfno) || list[0] || all[0];
      const KFT = [["kalemler", "Kalemler"], ["islemler", "İşlemler"], ["protokoller", "Protokoller"], ["vezne", "Vezne işlemleri"], ["evrak", "Evrak takip"], ["icmal", "İcmal"], ["notlar", "Notlar"], ["klinik", "Klinik dökümanlar"]];
      const kft = params.kftab || "kalemler";
      const tbl = (cols, rows, empty) => `<div class="tw"><table class="t"><thead><tr>${cols.map(c => `<th>${H.esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map((cell, i) => `<td${i > 0 && typeof cell === "number" ? ' class="n"' : ""}>${H.esc(String(cell))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}" class="mute" style="padding:16px;text-align:center">${H.esc(empty || "Kayıt yok.")}</td></tr>`}</tbody></table></div>`;
      let pane = "";
      if (!sel) pane = `<div class="empty">Kurum faturası yok.</div>`;
      else if (kft === "kalemler") { const rows = sel.kalemler.map(k => [k[0], k[1], k[2], k[3] + " ₼", (k[2] * k[3]) + " ₼"]); pane = tbl(["Hizmet / işlem", "Kod", "Miktar", "Birim fiyat", "Tutar"], rows); }
      else if (kft === "islemler") pane = tbl(["Tarih", "İşlem", "Bölüm", "Doktor", "Durum"], sel.islemler);
      else if (kft === "protokoller") pane = tbl(["Protokol", "Hasta", "Tarih", "Bölüm"], sel.protokoller.map(p => [p[0], vzName(p[1]), p[2], p[3]]));
      else if (kft === "vezne") pane = tbl(["Tarih", "İşlem", "Tutar", "Banko"], sel.vezne.map(v => [v[0], v[1], v[2] + " ₼", v[3]]));
      else if (kft === "evrak") pane = tbl(["Evrak", "Durum", "Tarih"], sel.evrak);
      else if (kft === "notlar") pane = `<div class="r" style="margin-bottom:8px"><button class="btn p sm" data-kfnotadd>+ Not ekle</button></div>` + tbl(["Tarih", "Kullanıcı", "Not"], sel.notlar);
      else if (kft === "klinik") pane = `<div class="tw"><table class="t"><thead><tr><th>Tarih</th><th>Döküman</th><th>Doktor</th><th style="width:44px"></th></tr></thead><tbody>${(sel.klinik || []).length ? sel.klinik.map((k, i) => `<tr class="row" data-kldoc="${i}" style="cursor:pointer"><td class="mono adm-sub">${H.esc(k[0])}</td><td><b>${H.esc(k[1])}</b></td><td class="adm-sub">${H.esc(k[2])}</td><td>${I("eye") || "👁"}</td></tr>`).join("") : `<tr><td colspan="4" class="mute" style="padding:16px;text-align:center">Klinik döküman yok.</td></tr>`}</tbody></table></div><p class="adm-sub" style="margin-top:8px">Hekim/hemşire yazmış belgeler. Satıra tıkla → görüntüle + antetli çıktı (yalnız okuma).</p>`;
      else { const top = sel.kalemler.reduce((a, k) => a + k[2] * k[3], 0), avans = sel.vezne.filter(v => /[Aa]vans/.test(v[1])).reduce((a, v) => a + v[2], 0);
        pane = tbl(["Kalem", "Değer"], [["Fatura no", sel.no], ["Kurum", sel.kurum], ["Dönem", sel.donem], ["Durum", sel.durum], ["Kalem sayısı", sel.kalemler.length], ["Protokol sayısı", sel.protokoller.length], ["Toplam tutar", top + " ₼"], ["Alınan avans", avans + " ₼"], ["Kalan", (top - avans) + " ₼"]]); }
      return `<div class="g2" style="align-items:start;grid-template-columns:320px 1fr;gap:14px">
        <div class="box"><div class="adm-bar"><input data-kfq placeholder="Fatura / kurum ara" value="${H.esc(params.kfq || "")}" style="flex:1"></div>
          <div class="tw" style="max-height:60vh;overflow:auto"><table class="t"><thead><tr><th>Fatura</th><th>Kurum</th><th style="width:70px">Durum</th></tr></thead><tbody>
          ${list.length ? list.map(x => `<tr data-kfsel="${H.esc(x.no)}" style="cursor:pointer"${sel && x.no === sel.no ? ' class="on" style="background:color-mix(in srgb,var(--pri) 12%,transparent)"' : ""}><td class="mono">${H.esc(x.no)}</td><td><b>${H.esc(x.kurum)}</b><div class="adm-sub" style="font-size:11px">${H.esc(x.tarih)}</div></td><td><span class="tag ${x.durum === "Açık" ? "" : "ok"}">${H.esc(x.durum)}</span></td></tr>`).join("") : `<tr><td colspan="3" class="mute" style="padding:16px;text-align:center">Fatura yok.</td></tr>`}</tbody></table></div></div>
        <div class="box">${sel ? `<div class="ist-sec ist-hd" style="margin:0 0 8px"><h5>${H.esc(sel.kurum)} · <span class="mono">${H.esc(sel.no)}</span></h5><div class="r" style="gap:6px"><button class="btn sm" data-kfyaz>${I("print") || ""} Fatura yazdır</button><button class="btn sm" data-kficmal>${I("save") || ""} İcmal (CSV)</button></div></div>` : ""}
          <div class="seg" style="margin-bottom:10px;flex-wrap:wrap">${KFT.map(([k, l]) => `<button data-kftab="${k}" class="${kft === k ? "on" : ""}">${l}</button>`).join("")}</div>
          ${pane}</div></div>
        <p class="adm-sub" style="margin-top:10px">Kurumsal faturalama: anlaşmalı kurumun dönem faturası; soldan fatura seçilir, sağda kalemler/işlemler/protokoller/vezne/evrak/icmal/notlar/klinik dökümanlar görülür. İcmal kuruma gönderilecek özettir. <b>Aynı kayıt Medikal Muhasebe'den de açılır</b> (asıl ev orası; bu, veznedeki kısayol).</p>`; };
    const panel = ({ giris:panGiris, fatura:panFatura, fiyat:panFiyat, kurumsal:panKurumsal, indirim:panIndirim, iade:panIade, gfk:panGfk, evrak:panEvrak })[tab]();
    // Sol panel: işleve göre 5 mantıklı grup + ikon (referanstan farklı, kullanıcıya daha kolay). [etiket, tab, ikon]
    const RAIL = [
      ["Arama & kabul", "search", [["Hasta arama", "", "user"], ["Randevu arama", "", "clock"], ["Son hastalar", "", "clock"], ["Gizli / VIP hasta listesi", "", "shield"], ["UHM hasta arama", "", "search"]]],
      ["Fiyat & kampanya", "file", [["Fiyat verme", "fiyat", "file"], ["Kampanyalar", "", "star"], ["Fiyat teklifleri", "fiyat", "file"]]],
      ["İstek & tahsilat", "file", [["İstek havuzu", "", "clock"], ["Ödeme takip", "fatura", "file"], ["Evrak takip", "evrak", "clip"], ["GFK takip", "gfk", "list"], ["Dönem bilgileri", "", "clock"]]],
      ["Onaylar", "shield", [["Onay bekleyen indirimler", "indirim", "edit"], ["Onay bekleyen iadeler", "iade", "refresh"], ["İade taleplerim", "", "list"], ["Onay bekleyen protokoller", "", "clip"], ["Kurum değişiklik onay", "", "edit"]]],
      ["Listeler & diğer", "list", [["Protokol listesi", "", "list"], ["Reçete listesi", "", "file"], ["Doktor iş listesi", "", "users"], ["Hasta danışman", "", "user"], ["Randevulanacak hizmetler", "", "clock"], ["Toplu fatura işlemleri", "", "file"], ["Onam formları", "", "clip"]]],
    ];
    const rail = `<div class="vz-rail">${RAIL.map(([g, gi, items]) => `<div class="vz-rg"><h6>${I(gi) || ""}${H.esc(g)}</h6>${items.map(([l, t, ic]) => `<button class="vz-ri${t === tab && t ? " on" : ""}" data-rail="${t || ""}" data-raill="${H.esc(l)}">${I(ic) || ""}<span>${l}</span></button>`).join("")}</div>`).join("")}</div>`;
    const kabulBar = `<div class="rc-add" style="margin-bottom:10px"><b style="align-self:center;font-size:13px">Hasta kabul:</b><input data-fin placeholder="FİN / Hasta no ile ara (hasta gelince kimliği girilir)" style="flex:1;min-width:240px"><button class="btn p sm" data-finara>${I("search") || ""} Ara / Kabul</button></div>`;
    // Geçerli vezne sekmesinin tablo verisi (Excel/Yazdır için).
    const vzTableData = () => {
      if (tab === "fatura") return { title:"Faturalar", cols:["Hasta", "Protokol", "Kurum", "Toplam ₼", "Katılım ₼", "Durum"], rows:faturalar().map(x => [vzName(x.hasta), x.protokol, x.kurum, x.toplam, x.katilim, x.durum]) };
      if (tab === "gfk") return { title:"GFK takip", cols:["Protokol", "Hasta", "Geliş", "Protokol tipi", "Bölüm", "Durum"], rows:gfkRows().map(x => [x.proto, vzName(x.hasta), x.gelis, x.ptip, x.bolum, x.durum]) };
      if (tab === "evrak") return { title:"Evrak takip", cols:["Fatura no", "Matbu no", "Kurum", "Durum"], rows:evrakRows().map(x => [x.no, x.matbu || "—", x.kurum, x.durum]) };
      if (tab === "indirim") return { title:"İndirim onay", cols:["Tarih", "Hasta", "İşlem", "Tutar ₼", "Oran %", "Durum"], rows:indirimRows().map(x => [x.tarih, vzName(x.hasta), x.islem, x.tutar, x.oran, x.durum]) };
      if (tab === "iade") return { title:"İade talepleri", cols:["Tip", "Tarih", "Talep eden", "Tutar ₼", "Durum"], rows:iadeRows().map(x => [x.tip, x.tarih, vzName(x.eden), x.tutar, x.durum]) };
      if (tab === "fiyat") return { title:"Fiyat verme", cols:["İşlem", "Fiyat ₼"], rows:(H.data.vFiyat || []).map(r => [r.ad, r.fiyat]) };
      if (tab === "giris") return { title:"Hasta listesi", cols:["Hasta no", "Kimlik", "Ad Soyad", "Telefon"], rows:(H.data.patients || []).map(p => [p.hn || "—", p.fin || "—", vzName(p.name), p.phone || "—"]) };
      return null;
    };
    const vzTab = vzTableData();
    const vzTools = vzTab ? `<div class="r" style="justify-content:flex-end;gap:6px;margin:-2px 0 10px"><button class="btn sm" data-vzexp>${I("save") || ""} Excel</button><button class="btn sm" data-vzyaz>${I("print") || ""} Yazdır</button></div>` : "";
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_vezne")}</h2><p>Hasta paneli · vezne · banko ${H.esc(banko)}${donemNo ? " · dönem #" + donemNo : " · dönem kapalı"}</p></div></div>${bar}${kabulBar}<div class="vz-wrap"><div class="vz-main">${strip}${vzTools}${panel}</div>${rail}</div>`;
    { const xp = root.querySelector("[data-vzexp]"); if (xp) xp.onclick = () => { H.exportCsv ? H.exportCsv("Vezne_" + tab, vzTab.cols, vzTab.rows) : H.toast("Dışa aktarma yok", "w"); };
      const yz = root.querySelector("[data-vzyaz]"); if (yz) yz.onclick = () => { H.printTable ? H.printTable(vzTab.title, vzTab.cols, vzTab.rows) : H.toast("Yazdırma yok", "w"); }; }
    { const fi = root.querySelector("[data-fin]"); if (fi) fi.addEventListener("keydown", (ev) => { if (ev.key === "Enter") vzFinAra(root); }); }
    if (tab === "giris") {
      const body = root.querySelector("[data-vsbody]"), cnt = root.querySelector("[data-vscount]"), inputs = [...root.querySelectorAll("[data-vs]")];
      const uygula = () => { const toks = inputs.map(i => (i.value || "").trim().toLocaleLowerCase("tr")).filter(Boolean);
        let n = 0; body.querySelectorAll("tr[data-s]").forEach(tr => { const ok = toks.every(t => tr.dataset.s.includes(t)); tr.style.display = ok ? "" : "none"; if (ok) n++; });
        if (cnt) cnt.textContent = n + " hasta"; };
      inputs.forEach(i => i.addEventListener("keydown", (e) => { if (e.key === "Enter") uygula(); }));
      const ara = root.querySelector("[data-vsara]"); if (ara) ara.onclick = uygula;
      const tmz = root.querySelector("[data-vstemizle]"); if (tmz) tmz.onclick = () => { inputs.forEach(i => i.value = ""); uygula(); };
      const yeni = root.querySelector("[data-vsnew]"); if (yeni) yeni.onclick = () => { const g = k => { const el = root.querySelector(`[data-vs="${k}"]`); return (el && el.value || "").trim(); };
        const ad = g("ad"), soyad = g("soyad"), nm = [ad, soyad].filter(Boolean).join(" ");
        H.go("admission", { tab:"ayaktan", pre:{ name:nm, fin:g("fin").toUpperCase(), phone:g("tel") } }); };
      const dt = root.querySelector("[data-vsdetay]"), dtm = root.querySelector("[data-vsdetaym]"); if (dt && dtm) dt.onclick = () => dtm.classList.toggle("hidden");
      if (body) body.oncontextmenu = (ev) => { const tr = ev.target.closest("[data-h3open]"); if (!tr) return; ev.preventDefault(); const pp = H.pt(tr.dataset.h3open); if (!pp) return;
        const kabul = (k, l) => ["Hasta kabul: " + l, () => H.kabulForm(pp, { gelis:KABUL_GELIS[k] || "Ayaktan" }, () => H.go("vezne", params))];
        vzMenu(ev, [
          ["Hasta dosyası aç", () => H.go("hasta360", { pid:pp.id })],
          ...(pp.onKayit ? [["Kesin kayda çevir", () => { pp.onKayit = false; H.saveData && H.saveData(); H.log("Kesin kayıt", vzName(pp.name)); H.toast("Kesin kayda çevrildi"); H.go("vezne", params); }]] : []),
          ["Birleştir (eşleştir)", () => H.go("admission", { tab:"eslesme" })],
          kabul("ayaktan", "Poliklinik"), kabul("ayaktan", "Acil"), kabul("gunubirlik", "Günübirlik"), kabul("yatan", "Yatış"), kabul("kontrol", "Kontrol"), kabul("donor", "Donör"),
          ["Yeni doğan kaydı aç", () => H.toast("Yeni doğan: anneye bağlı bebek protokolü açılır (yakında).", "w")],
          ["Protokol bilgileri", () => H.go("hasta360", { pid:pp.id, atab:"360", stab:"gelisler" })],
        ]); };
    }
    if (tab === "fiyat" && donemAcik) {  // hizmet combobox (her yerde aynı H.HIZMET kataloğu)
      const inp = root.querySelector("[data-fhiz]"), dd = root.querySelector("[data-fhiz-dd]"), fy = root.querySelector("[data-ffiyat]"), kurum = params.kurum || "Özel ödeme";
      const show = () => { const q = (inp.value || "").trim().toLocaleLowerCase("tr");
        const hits = (H.HIZMET || []).filter(r => !q || (r[1] + " " + r[2] + " " + r[0]).toLocaleLowerCase("tr").includes(q)).slice(0, 40);
        dd.innerHTML = hits.length ? hits.map(r => `<div class="amel-opt" data-code="${H.esc(r[0])}" data-ad="${H.esc(hzName(r))}"><b>${H.esc(hzName(r))}</b> <span class="mono adm-sub">${H.esc(r[0])}</span> <span class="adm-sub">${H.fiyatOf(r[0], kurum)} ₼</span></div>`).join("") : `<div class="amel-opt mute">Eşleşen hizmet yok</div>`;
        dd.classList.remove("hidden"); };
      inp.addEventListener("input", show); inp.addEventListener("focus", show);
      dd.addEventListener("click", (e) => { const o = e.target.closest("[data-code]"); if (!o) return; inp.value = o.dataset.ad; inp.dataset.kod = o.dataset.code; fy.value = H.fiyatOf(o.dataset.code, kurum); dd.classList.add("hidden"); });
      document.addEventListener("click", (e) => { const cb = root.querySelector(".amel-cb"); if (cb && !cb.contains(e.target)) dd.classList.add("hidden"); });
      // İşlem Havuzu sağ-tık menüsü (fiyat satırları)
      root.querySelector(".vz-main").addEventListener("contextmenu", (e) => { const tr = e.target.closest("[data-fri]"); if (!tr) return; e.preventDefault(); const i = +tr.dataset.fri, r = (H.data.vFiyat || [])[i]; if (!r) return;
        vzMenu(e, [
          ["Yeniden fiyatlandır", () => { if (!H.can("fiyat_duzenle")) { H.toast("Fiyat düzenleme yetkiniz yok.", "e"); return; } const v = prompt("Yeni fiyat (₼):", r.fiyat); if (v != null && v !== "" && !isNaN(+v)) { r.fiyat = +v; H.log("İşlem yeniden fiyatlandırıldı", r.ad + " · " + v); H.go("vezne", params); } }],
          ["Bekleyene at", () => { r.bekleyen = true; H.log("Fiyat satırı bekleyene atıldı", r.ad); H.toast("Bekleyene atıldı: " + r.ad, "w"); }],
          ["Özel onay (ödeme alındı)", () => { r.ozelOnay = true; H.log("Özel onay", r.ad); H.toast("Özel onay işaretlendi: " + r.ad); }],
          ["Fatura kesilmeyecek", () => { r.faturaYok = true; H.log("Fatura kesilmeyecek", r.ad); H.toast("'Fatura kesilmeyecek' işaretlendi", "w"); }],
          ["Yazdır (hizmet dökümü)", () => H.printTable ? H.printTable("Hizmet dökümü", ["İşlem", "Fiyat ₼"], [[r.ad, r.fiyat]]) : H.toast("Yazdırma yok", "w")],
          ["İptal (satırı çıkar)", () => { (H.data.vFiyat || []).splice(i, 1); H.toast("İşlem çıkarıldı", "w"); H.go("vezne", params); }],
        ]);
      });
    }
    if (tab === "kurumsal") { const q = root.querySelector("[data-kfq]"); if (q) q.oninput = () => { const v = q.value.toLocaleLowerCase("tr"); root.querySelectorAll("[data-kfsel]").forEach(tr => { tr.style.display = tr.textContent.toLocaleLowerCase("tr").includes(v) ? "" : "none"; }); }; }
    function donemAcModal() {
      const MESAI = ["Gündüz", "Gecə", "24 saat", "Həftəsonu"];
      const cih = (H.data.cihazlar || []).filter(c => c.durum === "Aktif");   // admin → Cihaz Listesi'nden okunur
      const YKASA = [...cih.filter(c => /Yazar kasa/i.test(c.tip)).map(c => c.ad), "—"];
      const POSL = [...cih.filter(c => /POS/i.test(c.tip)).map(c => c.ad), "—"];
      const vzAd = (H.state.user || {}).name || "—", now = H.nowFull ? H.nowFull() : new Date().toLocaleString("az-AZ");
      H.modal({ title:"Dönem aç · " + H.esc(banko), body:`<div class="icd-form">
        <div class="fr"><label>Vezne / kullanıcı</label><input value="${H.esc(vzAd)}" readonly></div>
        <div class="fr"><label>Banko / kasa</label><input value="${H.esc(banko)}" readonly></div>
        <div class="fr"><label>Dönem başlangıç</label><input value="${H.esc(now)}" readonly></div>
        <div class="fr"><label>Max. kapanış tarihi (ops.)</label><input type="datetime-local" data-f="max"></div>
        <div class="fr"><label>Mesai tipi</label><select data-f="mesai">${MESAI.map(x => `<option>${H.esc(x)}</option>`).join("")}</select></div>
        <div class="fr"><label>Yazar kasa (ÖKC)</label><select data-f="ykasa">${YKASA.map(x => `<option>${H.esc(x)}</option>`).join("")}</select></div>
        <div class="fr"><label>POS cihazı</label><select data-f="pos">${POSL.map(x => `<option>${H.esc(x)}</option>`).join("")}</select></div>
        <div class="fr"><label>Açılış matbu no</label><input data-f="matbu" placeholder="ör. A-100245"></div></div>
        <p class="adm-sub" style="margin-top:8px">Bu banko için yeni dönem açılır. Dönem boyunca yaptığın işlemler bu bankodan takip edilir.</p>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Dönemi aç</button>`,
        onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = k => { const el = m.querySelector(`[data-f="${k}"]`); return el ? el.value : ""; };
          cur.no = ++H.data.vezneDonemSeq; cur.acik = true; cur.acilis = { mesai:g("mesai"), ykasa:g("ykasa"), pos:g("pos"), matbu:g("matbu"), max:g("max"), baslangic:now, vezne:vzAd };
          H.saveData && H.saveData(); H.log("Vezne dönem açıldı", banko + " · #" + cur.no); H.toast(banko + " · dönem açıldı: #" + cur.no); H.closeModal(); H.go("vezne", params); }; } });
    }
    function hizmetSecModal() {
      const kurum = params.kurum || "Özel ödeme", TIP = H.HIZMET_TIP || [], tipOf = r => TIP[r[3]] || "", hzName = r => r[1] || r[2] || "";
      let q = "", tip = "";
      H.modal({ title:"Hizmet seç (katalog)", wide:true,
        body:`<div class="adm-bar" style="margin-bottom:8px"><input data-hsq placeholder="Hizmet adı / kod ara…" style="flex:1"><select data-hstip><option value="">Tüm tipler</option>${TIP.map(t => `<option>${H.esc(t)}</option>`).join("")}</select></div>
          <div class="tw" style="max-height:52vh;overflow:auto"><table class="t"><thead><tr><th style="width:34px"></th><th>Hizmet</th><th>Tip</th><th style="width:90px">Kod</th><th style="width:90px">Fiyat ₼</th></tr></thead><tbody data-hsbody></tbody></table></div>
          <p class="adm-sub" style="margin-top:6px"><span data-hscount>0</span> sonuç (en çok 100 gösterilir). Ara/filtrele → işaretle → ekle.</p>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Seçilenleri ekle</button>`,
        onMount(m) { const body = m.querySelector("[data-hsbody]");
          const draw = () => { const ql = q.toLocaleLowerCase("tr");
            const res = (!ql && !tip) ? [] : (H.HIZMET || []).filter(r => (!tip || tipOf(r) === tip) && (!ql || (r[1] + " " + r[2] + " " + r[0]).toLocaleLowerCase("tr").includes(ql))).slice(0, 100);
            m.querySelector("[data-hscount]").textContent = res.length;
            body.innerHTML = res.length ? res.map(r => `<tr><td><input type="checkbox" data-hs="${H.esc(r[0])}"></td><td><b>${H.esc(hzName(r))}</b></td><td class="adm-sub">${H.esc(tipOf(r))}</td><td class="mono adm-sub">${H.esc(r[0])}</td><td class="n">${H.fiyatOf ? H.fiyatOf(r[0], kurum) : "—"}</td></tr>`).join("") : `<tr><td colspan="5" class="mute" style="padding:16px;text-align:center">Arama yapın ya da tip seçin.</td></tr>`;
          };
          m.querySelector("[data-hsq]").oninput = e => { q = e.target.value; draw(); };
          m.querySelector("[data-hstip]").onchange = e => { tip = e.target.value; draw(); };
          m.querySelector("[data-ok]").onclick = () => { const kods = [...m.querySelectorAll("[data-hs]:checked")].map(c => c.dataset.hs); if (!kods.length) { H.toast("Hizmet seçin.", "w"); return; }
            kods.forEach(kod => { const r = (H.HIZMET || []).find(x => x[0] === kod); if (r) (H.data.vFiyat = H.data.vFiyat || []).push({ ad:hzName(r), kod, fiyat:H.fiyatOf ? H.fiyatOf(kod, kurum) : 0 }); });
            H.saveData && H.saveData(); H.log("Fiyat verme · hizmet eklendi", kods.length + " hizmet"); H.toast(kods.length + " hizmet eklendi"); H.closeModal(); H.go("vezne", params); };
          draw(); } });
    }
    function donemOzet() {
      const all = faturalar(), odenen = all.filter(x => x.durum === "Ödendi"), bekleyen = all.filter(x => x.durum !== "Ödendi");
      const kanal = {}; odenen.forEach(x => { const k = x.odemeTipi || "Nakit"; kanal[k] = (kanal[k] || 0) + (x.katilim || 0); });
      const tahsil = odenen.reduce((a, x) => a + (x.katilim || 0), 0), bek = bekleyen.reduce((a, x) => a + (x.katilim || 0), 0), devir = H.data.vezneDevir || 0;
      H.modal({ title:`Dönem özeti · #${donemNo} · ${H.esc(banko)}`, wide:true,
        body:`<div class="h360-meta" style="margin-bottom:12px"><div><span>Dönem</span><b>#${donemNo} · ${donemAcik ? "Açık" : "Kapalı"}</b></div><div><span>Banko / kasa</span><b>${H.esc(banko)}</b></div><div><span>Devir (açılış)</span><b>${devir} ₼</b></div><div><span>Tahsil edilen</span><b>${tahsil} ₼</b></div><div><span>Bekleyen tahakkuk</span><b>${bek} ₼</b></div><div><span>Kasa toplamı</span><b>${devir + tahsil} ₼</b></div></div>
          <div class="tw"><table class="t"><thead><tr><th>Ödeme kanalı</th><th style="width:140px">Tahsilat ₼</th></tr></thead><tbody>
          ${Object.keys(kanal).length ? Object.entries(kanal).map(([k, v]) => `<tr><td>${H.esc(k)}</td><td class="n">${v} ₼</td></tr>`).join("") : `<tr><td colspan="2" class="mute" style="padding:14px;text-align:center">Bu dönemde tahsilat yok.</td></tr>`}
          <tr><td><b>Toplam tahsilat</b></td><td class="n"><b>${tahsil} ₼</b></td></tr></tbody></table></div>
          <p class="adm-sub" style="margin-top:8px">Dönem kapatılırken bu özet kasa raporu olarak alınır; devir bir sonraki döneme taşınır.</p>`,
        actions:`<button class="btn" data-x>Kapat</button><button class="btn p" data-ozetyaz>${I("print") || ""} Yazdır</button>`,
        onMount(m) { const y = m.querySelector("[data-ozetyaz]"); if (y) y.onclick = () => H.toast("Dönem özeti yazdırılıyor"); } });
    }
    // Dönem devir al: başka veznenin açık dönemindeki faturalanmamış protokolleri kendi dönemine devralır (vardiya devri).
    function donemDevirModal() {
      const kaynaklar = acikBankolar.filter(b => b !== banko);
      const kList = kaynaklar.length ? kaynaklar.map(b => ({ ad:b, no:(donemler[b] || {}).no })) : [{ ad:"Gecə vezne (ADMINNT)", no:3888 }, { ad:"Berna Çolak", no:3864 }];
      const devredilebilir = gfkRows().filter(x => x.durum !== "Fatura kesildi");
      let src = kList[0].ad;
      const draw = (m) => {
        m.querySelector("[data-dvsrc]").innerHTML = kList.map(k => `<button class="btn sm${k.ad === src ? " p" : ""}" data-dvs="${H.esc(k.ad)}">${H.esc(k.ad)}${k.no ? " · #" + H.esc(String(k.no)) : ""}</button>`).join("");
        m.querySelector("[data-dvbody]").innerHTML = devredilebilir.length ? devredilebilir.map(x => `<tr><td><input type="checkbox" data-dvc="${H.esc(x.proto)}"></td><td class="adm-sub">${/SGK|provizyon|müstehak/i.test(x.durum) ? "SGK takibi eksik" : "Faturalanmamış"}</td><td><b>${H.esc(vzName(x.hasta))}</b></td><td class="mono adm-sub">${H.esc(x.proto)}</td><td>${H.esc(x.gelis)}</td><td class="adm-sub">${H.esc(x.ptip)}</td></tr>`).join("") : `<tr><td colspan="6" class="mute" style="padding:14px;text-align:center">Devralınacak protokol yok.</td></tr>`;
      };
      H.modal({ title:"Dönem devir al · " + H.esc(banko), wide:true,
        body:`<p class="adm-sub" style="margin:0 0 10px">Ayrılan/başka veznenin açık dönemindeki faturalanmamış protokolleri kendi dönemine devralırsın; sonra bu banko için yeni dönem açılır (vardiya devri).</p>
          <h6 style="margin:0 0 6px">Açık dönemler (diğer vezneler)</h6><div class="r" data-dvsrc style="gap:6px;margin-bottom:12px;flex-wrap:wrap"></div>
          <div class="adm-bar"><b style="align-self:center">Devralınacak protokoller</b><span class="spacer"></span><label class="r" style="gap:6px;align-items:center"><input type="checkbox" data-dvall> Tümünü seç</label></div>
          <div class="tw"><table class="t"><thead><tr><th style="width:34px"></th><th style="width:130px">Tip</th><th>Hasta</th><th style="width:110px">Protokol</th><th>Geliş</th><th>Protokol tipi</th></tr></thead><tbody data-dvbody></tbody></table></div>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-dvok>Seçilenleri devral ve dönem aç</button>`,
        onMount(m) { draw(m);
          m.querySelector("[data-dvsrc]").onclick = e => { const b = e.target.closest("[data-dvs]"); if (b) { src = b.dataset.dvs; draw(m); } };
          const all = m.querySelector("[data-dvall]"); if (all) all.onchange = () => m.querySelectorAll("[data-dvc]").forEach(c => { c.checked = all.checked; });
          m.querySelector("[data-dvok]").onclick = () => { const sel = [...m.querySelectorAll("[data-dvc]:checked")].length;
            cur.no = ++H.data.vezneDonemSeq; cur.acik = true; cur.devir = { kaynak:src, adet:sel };
            H.saveData && H.saveData(); H.log("Dönem devir alındı", banko + " ← " + src + " · " + sel + " protokol · #" + cur.no);
            H.toast(banko + " · " + sel + " protokol devralındı · dönem #" + cur.no + " açıldı"); H.closeModal(); H.go("vezne", params); }; } });
    }
    // Kasa kapama: fiziken sayılan tutarlar + kapatmadan önce ele alınacak bekleyen işler (faturalanmamış/SGK eksik protokoller).
    function donemKapatModal() {
      const allF = faturalar(), odenen = allF.filter(x => x.durum === "Ödendi");
      const kanal = {}; odenen.forEach(x => { const k = x.odemeTipi || "Nakit"; kanal[k] = (kanal[k] || 0) + (x.katilim || 0); });
      const tahsil = odenen.reduce((a, x) => a + (x.katilim || 0), 0);
      const pick = (...ks) => ks.reduce((a, k) => a + (kanal[k] || 0), 0);
      const bekleyen = gfkRows().filter(x => x.durum !== "Fatura kesildi");
      const SAY = [["nakit", "Nakit ₼", pick("Nakit")], ["kk", "Kredi kartı ₼", pick("Kredi kartı", "Kredi Kartı", "Kart")], ["havale", "Havale/EFT ₼", pick("Havale", "Havale/EFT", "EFT")], ["cek", "Çek ₼", 0], ["senet", "Senet ₼", 0], ["usd", "USD $", 0], ["eur", "EUR €", 0], ["avans", "Avans ₼", 0], ["katilim", "Katılım payı ₼", 0]];
      const now = H.nowFull ? H.nowFull() : new Date().toLocaleString("az-AZ");
      const read = (m) => { const o = {}; SAY.forEach(([k]) => { const el = m.querySelector(`[data-say="${k}"]`); o[k] = +(el && el.value) || 0; }); const acks = {}; m.querySelectorAll("[data-kack]").forEach(el => { if (el.value.trim()) acks[el.dataset.kack] = el.value.trim(); }); return { sayim:o, aciklamalar:acks, kapanis:now }; };
      H.modal({ title:`Dönem kapama · #${donemNo} · ${H.esc(banko)}`, wide:true,
        body:`<div class="h360-meta" style="margin-bottom:12px"><div><span>Dönem</span><b>#${donemNo}</b></div><div><span>Sistem tahsilatı</span><b>${tahsil} ₼</b></div><div><span>Nakit (sistem)</span><b>${pick("Nakit")} ₼</b></div><div><span>Kart (sistem)</span><b>${pick("Kredi kartı", "Kredi Kartı", "Kart")} ₼</b></div></div>
          <h6 style="margin:0 0 6px">Kasa sayımı (fiziken sayılan)</h6>
          <div class="icd-form">${SAY.map(([k, l, v]) => `<div class="fr"><label>${l}</label><input type="number" data-say="${k}" value="${v}" placeholder="0"></div>`).join("")}</div>
          <h6 style="margin:14px 0 6px">Bekleyen iş listesi (kapatmadan önce)</h6>
          <div class="tw"><table class="t"><thead><tr><th style="width:130px">Tip</th><th>Hasta</th><th style="width:110px">Protokol</th><th>Protokol tipi</th><th style="width:220px">Açıklama</th></tr></thead><tbody>
          ${bekleyen.length ? bekleyen.map(x => `<tr><td class="adm-sub">${/SGK|provizyon|müstehak/i.test(x.durum) ? "SGK takibi eksik" : "Faturalanmamış"}</td><td><b>${H.esc(vzName(x.hasta))}</b></td><td class="mono adm-sub">${H.esc(x.proto)}</td><td class="adm-sub">${H.esc(x.ptip)}</td><td><input data-kack="${H.esc(x.proto)}" placeholder="açıklama / not"></td></tr>`).join("") : `<tr><td colspan="5" class="mute" style="padding:14px;text-align:center">Bekleyen iş yok.</td></tr>`}</tbody></table></div>
          <p class="adm-sub" style="margin-top:8px">Önce sayımı kaydet, sonra dönemi kapat. Kapanınca bu bankoda işlem yapılamaz; özet kasa raporu olarak alınır.</p>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn" data-kkaydet>Sayımı kaydet</button><button class="btn p" data-kkapat>Dönemi kapat</button>`,
        onMount(m) {
          m.querySelector("[data-kkaydet]").onclick = () => { cur.kapanis = read(m); H.saveData && H.saveData(); H.toast("Sayım kaydedildi"); };
          m.querySelector("[data-kkapat]").onclick = () => { const k = read(m); cur.kapanis = k; cur.acik = false; cur.onay = "bekliyor";
            const sayilan = Object.values(k.sayim).reduce((a, v) => a + (+v || 0), 0), beklenen = tahsil;
            (H.data.vezneKapanislar = H.data.vezneKapanislar || []).unshift({ id:"vk" + Date.now(), no:cur.no, banko, vezne:(H.state.user || {}).name || "—", vezneU:(H.state.user || {}).u, kapanisT:now, sayim:k.sayim, beklenenKanal:Object.fromEntries(SAY.map(([kk, , vv]) => [kk, vv])), beklenen, sayilan, fark:+(sayilan - beklenen).toFixed(2), onay:"bekliyor", onaylayan:null, redNot:"" });
            H.log("Vezne dönem kapatıldı (onay bekliyor)", "#" + cur.no + " · " + banko + " · sayılan " + sayilan + " / beklenen " + beklenen + " ₼"); H.saveData && H.saveData();
            H.toast(banko + " dönemi kapatıldı · Mali İşler onayı bekleniyor", "w"); H.closeModal(); H.go("vezne", params); }; } });
    }
    // Provizyon / müstehaklık (fatura öncesi kurum onayı)
    function provizyonModal(x) {
      const samhi = samhiKurum(x.kurum);
      H.modal({ title:(samhi ? "SAMHI müstehaklık / takip" : "Provizyon al") + " · " + H.esc(x.proto),
        body: samhi
          ? `<div class="icd-form"><div class="fr"><label>Kurum</label><input value="${H.esc(x.kurum)}" readonly></div>
             <div class="fr"><label>Tedavi türü</label><select data-f="tedavi"><option>Ayakta tedavi</option><option>Yatan tedavi</option><option>Günübirlik</option></select></div>
             <div class="fr" style="grid-column:1/-1"><label class="r" style="gap:6px;align-items:center"><input type="checkbox" data-f="biyo" checked> Biyometrik kimlik doğrulama ile takip al</label></div></div>
             <p class="adm-sub" style="margin-top:8px">Müstehaklık (hak sahipliği) sorgulanıp takip numarası alınır. SAMHI entegrasyonunu ayrı ekip bağlar.</p>`
          : `<div class="icd-form"><div class="fr"><label>Kurum / sigorta</label><input value="${H.esc(x.kurum)}" readonly></div>
             <div class="fr"><label>Provizyon tipi</label><select data-f="ptip"><option>Telefon</option><option>Online</option><option>Faks</option></select></div>
             <div class="fr"><label>Poliçe oranı (%)</label><input type="number" data-f="oran" value="80"></div>
             <div class="fr"><label>Poliçe limiti (₼)</label><input type="number" data-f="limit" placeholder="ops."></div></div>
             <p class="adm-sub" style="margin-top:8px">Sigorta provizyonu alınır; poliçe oranıyla hasta/kurum payı dağıtılır.</p>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>${samhi ? "Takip al" : "Provizyon al"}</button>`,
        onMount(m) { m.querySelector("[data-ok]").onclick = () => {
          if (samhi) { x.provizyon = "Takip alındı #TKP-" + Math.floor(100000 + Math.random() * 900000); }
          else { const oran = +(m.querySelector('[data-f="oran"]').value) || 0; x.provizyon = "Provizyon alındı %" + oran; }
          if (x.durum === "Provizyonu alınmamış") x.durum = "Hasta faturası kesilmemiş";
          H.saveData && H.saveData(); H.log("Provizyon/müstehaklık", x.proto + " · " + x.provizyon); H.toast(x.provizyon); H.closeModal(); H.go("vezne", params); }; } });
    }
    // Evrak detay: kontrol listesi + hareket geçmişi + durum zinciri (video 14).
    function evrakDetayModal(x) {
      const now = H.nowFull ? H.nowFull() : new Date().toLocaleString("az-AZ"), per = (H.state.user || {}).name || "Vezne";
      x.hareket = x.hareket || [];
      const adv = (yeniDurum, hareketTip, aciklama) => { x.durum = yeniDurum; x.hareket.unshift({ tip:hareketTip, personel:per, tarih:now, aciklama:aciklama || "" }); H.saveData && H.saveData(); H.log("Evrak hareket", x.no + " · " + hareketTip); H.toast(hareketTip); H.closeModal(); evrakDetayModal(x); };
      const evrakKontrol = () => { H.modal({ title:"Evrak kontrol · " + H.esc(x.no),
        body:`<p class="adm-sub" style="margin:0 0 8px">Teslim edilecek evrakları işaretleyin.</p>
          <div class="icd-form" style="grid-template-columns:1fr 1fr">${EVRAK_TIP.map((t, i) => `<label class="r" style="gap:6px;align-items:center"><input type="checkbox" data-evt="${i}"> ${H.esc(t)}</label>`).join("")}</div>
          <div class="fr" style="margin-top:8px"><label>Açıklama</label><input data-evack placeholder="ops."></div>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Tamam · teslim et</button>`,
        onMount(m) { m.querySelector("[data-ok]").onclick = () => { const sel = [...m.querySelectorAll("[data-evt]:checked")].map(c => EVRAK_TIP[+c.dataset.evt]); const ack = (m.querySelector("[data-evack]").value || "").trim(); H.closeModal(); adv("Vezneden teslim edildi", "Vezne teslim etti", [sel.join(", "), ack].filter(Boolean).join(" · ")); }; } }); };
      const d = x.durum;
      const actBtns = d === "Veznede" ? `<button class="btn p" data-evkontrol>Evrak kontrol · teslim et</button>`
        : d === "Vezneden teslim edildi" ? `<button class="btn p" data-evmk>Medikal muhasebe kabul</button>`
        : d === "Medikal muhasebede" ? `<button class="btn" data-eviade="İç">İç iade</button> <button class="btn" data-eviade="Dış">Dış iade</button>`
        : d === "Vezneye iade edildi" ? `<button class="btn p" data-evretesl>Yeniden teslim et</button>` : "";
      const hrows = x.hareket.length ? x.hareket.map(h => `<tr><td>${H.esc(h.tip)}</td><td class="adm-sub">${H.esc(h.personel)}</td><td class="adm-sub">${H.esc(h.tarih)}</td><td class="adm-sub">${H.esc(h.aciklama || "")}</td></tr>`).join("") : `<tr><td colspan="4" class="mute" style="padding:12px;text-align:center">Henüz hareket yok.</td></tr>`;
      H.modal({ title:"Evrak detay · " + H.esc(x.no), wide:true,
        body:`<div class="h360-meta" style="margin-bottom:12px"><div><span>Fatura no</span><b>${H.esc(x.no)}</b></div><div><span>Matbu no</span><b>${H.esc(x.matbu || "—")}</b></div><div><span>Kurum</span><b>${H.esc(x.kurum)}</b></div><div><span>Durum</span><b>${H.esc(x.durum)}</b></div></div>
          <div class="r" style="gap:6px;margin-bottom:12px">${actBtns || '<span class="adm-sub">Bu aşamada işlem yok.</span>'}</div>
          <h6 style="margin:0 0 6px">Hareket geçmişi</h6>
          <div class="tw"><table class="t"><thead><tr><th>İşlem</th><th>Personel</th><th>Tarih</th><th>Açıklama</th></tr></thead><tbody>${hrows}</tbody></table></div>`,
        actions:`<button class="btn" data-x>Kapat</button>`,
        onMount(m) { const k = m.querySelector("[data-evkontrol]"); if (k) k.onclick = evrakKontrol;
          const mk = m.querySelector("[data-evmk]"); if (mk) mk.onclick = () => adv("Medikal muhasebede", "Medikal muhasebe kabul");
          m.querySelectorAll("[data-eviade]").forEach(b => b.onclick = () => adv("Vezneye iade edildi", "Vezneye iade (" + b.dataset.eviade + " iade)"));
          const rt = m.querySelector("[data-evretesl]"); if (rt) rt.onclick = () => adv("Vezneden teslim edildi", "Yeniden teslim edildi"); } });
    }
    // Hukuksal takip (video 15): ödenmeyen faturayı avukatlık/icra sürecine bağlar.
    function hukuksalModal(x) {
      const h = x.hukuksal || {}, bugun = H.nowFull ? H.nowFull() : new Date().toLocaleDateString("az");
      const SUREC = ["Açıldı", "Avukatta", "1. görüşme", "2. görüşme", "İcra", "Kapandı"];
      H.modal({ title:"Hukuksal takip · " + H.esc(x.protokol || x.id), body:`<div class="icd-form">
        <div class="fr"><label>Tarih</label><input data-f="tarih" value="${H.esc(h.tarih || bugun)}"></div>
        <div class="fr"><label>Bekleyen tutar</label><input value="${x.katilim} ₼" readonly></div>
        <div class="fr"><label>Avukat</label><input data-f="avukat" value="${H.esc(h.avukat || "")}"></div>
        <div class="fr"><label>Referans no</label><input data-f="ref" value="${H.esc(h.ref || "")}"></div>
        <div class="fr"><label>Süreç</label><select data-f="surec">${SUREC.map(s => `<option${h.surec === s ? " selected" : ""}>${s}</option>`).join("")}</select></div>
        <div class="fr" style="grid-column:1/-1"><label>Açıklama</label><input data-f="acik" value="${H.esc(h.aciklama || "")}"></div></div>`,
        actions:`<button class="btn" data-x>Vazgeç</button>${x.hukuksal ? `<button class="btn g" data-hukkaldir>Takipten çıkar</button>` : ""}<button class="btn p" data-ok>Kaydet</button>`,
        onMount(m) { const g = k => (m.querySelector(`[data-f="${k}"]`).value || "").trim();
          m.querySelector("[data-ok]").onclick = () => { x.hukuksal = { tarih:g("tarih"), avukat:g("avukat"), ref:g("ref"), surec:m.querySelector('[data-f="surec"]').value, aciklama:g("acik") };
            H.saveData && H.saveData(); H.log("Hukuksal takip", (x.protokol || x.id) + " · " + x.hukuksal.surec); H.toast("Hukuksal takip kaydedildi"); H.closeModal(); H.go("vezne", params); };
          const kd = m.querySelector("[data-hukkaldir]"); if (kd) kd.onclick = () => { delete x.hukuksal; H.saveData && H.saveData(); H.log("Hukuksal takipten çıkarıldı", x.protokol || x.id); H.toast("Hukuksal takipten çıkarıldı", "w"); H.closeModal(); H.go("vezne", params); }; } });
    }
    // İade onay zinciri (Alıcılar · seviye 1/2/3) — video 9-12.
    function iadeZincirModal(x) {
      const z = x.zincir || [], pend = z.find(s => s.durum === "Onay bekliyor");
      const rows = z.length ? z.map(s => `<tr${pend && s === pend ? ' style="background:color-mix(in srgb,var(--mid) 12%,transparent)"' : ""}><td>${s.seviye}</td><td>${H.esc(s.birim || "—")}</td><td>${H.esc(s.personel || "—")}</td><td><span class="tag ${s.durum === "Onaylandı" ? "ok" : s.durum === "Reddedildi" ? "w" : ""}">${H.esc(s.durum)}</span>${pend && s === pend ? ` <span class="adm-sub">← onayı beklenen</span>` : ""}</td></tr>`).join("") : `<tr><td colspan="4" class="mute" style="padding:12px;text-align:center">Zincir tanımı yok.</td></tr>`;
      H.modal({ title:"İade onay zinciri (Alıcılar) · " + H.esc(vzName(x.eden)),
        body:`<div class="h360-meta" style="margin-bottom:12px"><div><span>Tip</span><b>${H.esc(x.tip)}</b></div><div><span>Tutar</span><b>${x.tutar} ₼</b></div><div><span>Protokol</span><b>${H.esc(x.proto)}</b></div><div><span>Durum</span><b>${H.esc(x.durum)}</b></div></div>
          <div class="tw"><table class="t"><thead><tr><th style="width:60px">Seviye</th><th>Birim</th><th>Personel</th><th style="width:210px">Durum</th></tr></thead><tbody>${rows}</tbody></table></div>
          <p class="adm-sub" style="margin-top:8px">Onay sırayla ilerler: üstteki seviye onaylayınca sıra bir alttakine geçer; hepsi onaylayınca iade tamamlanır.</p>`,
        actions:`<button class="btn" data-x>Kapat</button>` });
    }
    root.onchange = (e) => {
      const vb = e.target.closest("[data-vbanko]"); if (vb) { if (!H.can("vezne_banko")) { vb.value = banko; H.toast("Banko değiştirme yetkiniz yok.", "e"); return; } H.state.vezneBanko = vb.value; H.log("Vezne banko değişti", vb.value); const d = donemler[vb.value]; H.toast("Banko: " + vb.value + (d && d.acik ? " · dönem açık #" + d.no : " · dönem kapalı")); return H.go("vezne", params); }
      const fk = e.target.closest("[data-fkurum]"); if (fk) return H.go("vezne", { tab:"fiyat", kurum:fk.value, kamp:params.kamp, fptip:params.fptip });
      const fkp = e.target.closest("[data-fkamp]"); if (fkp) return H.go("vezne", { tab:"fiyat", kurum:params.kurum, kamp:fkp.value, fptip:params.fptip });
      const fpt = e.target.closest("[data-fptip]"); if (fpt) return H.go("vezne", { tab:"fiyat", kurum:params.kurum, kamp:params.kamp, fptip:fpt.value });
      const gs = e.target.closest("[data-gfkst]"); if (gs) { if (!donemAcik) { gs.value = gfkRows()[+gs.dataset.gfkst].durum; H.toast("Dönem kapalı · değişiklik yapılamaz.", "e"); return; } const x = gfkRows()[+gs.dataset.gfkst]; if (x) { x.durum = gs.value; H.log("GFK durumu", x.proto + " · " + x.durum); H.toast("Durum: " + x.durum); } }
    };
    root.onclick = (e) => {
      const vzh = e.target.closest("[data-vzhasta]"); if (vzh && !e.target.closest("button,select,input,a")) { const pid = pidByName(vzh.dataset.vzhasta); if (pid) return H.go("hasta360", { pid }); H.toast("Bu hastanın kartı prototipte yüklü değil.", "w"); return; }
      const fnr = e.target.closest("[data-finara]"); if (fnr) { vzFinAra(root); return; }
      const h3o = e.target.closest("[data-h3open]"); if (h3o) return H.go("hasta360", { pid:h3o.dataset.h3open });
      const vt = e.target.closest("[data-vtab]"); if (vt) return H.go("vezne", { tab:vt.dataset.vtab });
      const gp = e.target.closest("[data-gfkprov]"); if (gp) { if (!donemAcik) { H.toast("Dönem kapalı · işlem yapılamaz.", "e"); return; } const x = gfkRows()[+gp.dataset.gfkprov]; if (x) provizyonModal(x); return; }
      const pendKapanis = () => (H.data.vezneKapanislar || []).find(x => x.banko === banko && x.onay === "bekliyor");
      if (e.target.closest("[data-vdonem]")) { if (!donemYetki) { H.toast("Dönem açma/kapatma yetkiniz yok.", "e"); return; }
        if (cur.acik) return donemKapatModal();
        const pk = pendKapanis(); if (pk) { H.toast("Bu bankonun önceki dönemi (#" + pk.no + ") Mali İşler onayını bekliyor · onaylanmadan yeni dönem açılamaz.", "e"); return; }
        return donemAcModal(); }
      if (e.target.closest("[data-vdevir]")) { if (!donemYetki) { H.toast("Devir yetkiniz yok.", "e"); return; } const pk = pendKapanis(); if (pk) { H.toast("Önceki dönem (#" + pk.no + ") Mali İşler onayını bekliyor · devir alınamaz.", "e"); return; } return donemDevirModal(); }
      if (e.target.closest("[data-vozet]")) { donemOzet(); return; }
      if (!donemAcik) { if (e.target.closest("[data-fadd],[data-tahsil],[data-frm]")) { H.toast("Dönem kapalı · önce yeni dönem açın.", "e"); return; } }
      const evd = e.target.closest("[data-evdetay]"); if (evd) { const x = evrakRows().find(y => y.no === evd.dataset.evdetay); if (x) evrakDetayModal(x); return; }
      const fsub = e.target.closest("[data-fsub]"); if (fsub) return H.go("vezne", { tab:"fatura", fsub:fsub.dataset.fsub });
      const fd = e.target.closest("[data-fdetay]"); if (fd) { const x = faturalar().find(y => y.id === fd.dataset.fdetay); if (x) faturaDetayModal(x); return; }
      const huk = e.target.closest("[data-huk]"); if (huk) { const x = faturalar().find(y => y.id === huk.dataset.huk); if (x) hukuksalModal(x); return; }
      const vf = e.target.closest("[data-vf]"); if (vf) return H.go("vezne", { tab:"fatura", durum:vf.dataset.vf });
      const gf = e.target.closest("[data-gf]"); if (gf) return H.go("vezne", { tab:"gfk", gfk:gf.dataset.gf });
      const ef = e.target.closest("[data-ef]"); if (ef) return H.go("vezne", { tab:"evrak", ev:ef.dataset.ef });
      const rl = e.target.closest("[data-rail]"); if (rl) { const t = rl.dataset.rail; if (t) return H.go("vezne", { tab:t }); const lbl = rl.dataset.raill;
        if (lbl === "Hasta danışman") return danismanModal();
        if (lbl === "İstek havuzu") return istekHavuzuModal();
        if (lbl === "Randevu arama") return H.go("randevu", {});
        if (lbl === "Onay bekleyen protokoller") return onayProtokolModal();
        if (lbl === "Onam formları") return onamModal();
        if (lbl === "Toplu fatura işlemleri") return topluFaturaModal();
        if (lbl === "Randevulanacak hizmetler") return randevulanacakModal();
        const rd = railData(lbl);
        if (!rd) { H.toast(lbl + " · yapım aşamasında", "w"); return; }
        railModal(lbl, rd); return; }
      const kld = e.target.closest("[data-kldoc]"); if (kld) { const all = kfAll(), sel = all.find(x => x.no === params.kfno) || all[0]; const k = sel && (sel.klinik || [])[+kld.dataset.kldoc]; if (k) klinikDocView(k, sel); return; }
      const kfs = e.target.closest("[data-kfsel]"); if (kfs) return H.go("vezne", { tab:"kurumsal", kfno:kfs.dataset.kfsel, kftab:params.kftab });
      const kftb = e.target.closest("[data-kftab]"); if (kftb) return H.go("vezne", { tab:"kurumsal", kfno:params.kfno, kftab:kftb.dataset.kftab });
      if (e.target.closest("[data-kfyaz]")) { const s = kfAll().find(x => x.no === params.kfno) || kfAll()[0]; if (s && H.printTable) H.printTable("Kurum faturası · " + s.kurum + " · " + s.no, ["Hizmet / işlem", "Kod", "Miktar", "Birim fiyat", "Tutar"], s.kalemler.map(k => [k[0], k[1], k[2], k[3] + " ₼", (k[2] * k[3]) + " ₼"]), { sub:s.kurum + " · " + s.donem }); return; }
      if (e.target.closest("[data-kficmal]")) { const s = kfAll().find(x => x.no === params.kfno) || kfAll()[0]; if (s) H.exportCsv("Icmal_" + s.no, ["Hizmet", "Kod", "Miktar", "Birim ₼", "Tutar ₼"], s.kalemler.map(k => [k[0], k[1], k[2], k[3], k[2] * k[3]])); return; }
      if (e.target.closest("[data-kfnotadd]")) { const s = kfAll().find(x => x.no === params.kfno) || kfAll()[0]; if (s) { const t = prompt("Not:"); if (t) { s.notlar.unshift([new Date().toLocaleDateString("tr"), (H.state.user || {}).name || "Vezne", t]); H.go("vezne", { tab:"kurumsal", kfno:s.no, kftab:"notlar" }); } } return; }
      const io = e.target.closest("[data-io]"); if (io) return H.go("vezne", { tab:"indirim", io:io.dataset.io });
      const ia = e.target.closest("[data-ia]"); if (ia) return H.go("vezne", { tab:"iade", ia:ia.dataset.ia, iatip:params.iatip });
      const iat = e.target.closest("[data-iatip]"); if (iat) return H.go("vezne", { tab:"iade", ia:params.ia, iatip:iat.dataset.iatip });
      const iap = e.target.closest("[data-ioap],[data-iored]"); if (iap) { if (!H.canAct("indirim_onay")) { H.toast("İndirim onay yetkiniz yok.", "e"); return; } const id = iap.dataset.ioap || iap.dataset.iored, ok = !!iap.dataset.ioap, x = indirimRows().find(y => y.id === id); if (x) { onayIlerlet(x, ok); H.log("İndirim onay kademesi " + (ok ? "ilerledi" : "reddedildi"), x.hasta + " · %" + x.oran + " · " + x.durum); H.toast(ok ? (x.durum === "Onaylandı" ? "İndirim tamamen onaylandı" : "Bir kademe onaylandı · sonraki onay bekliyor") : "İndirim reddedildi", ok && x.durum !== "Onay bekliyor" ? "ok" : "w"); H.go("vezne", params); } return; }
      const iaz = e.target.closest("[data-iazinc]"); if (iaz) { const x = iadeRows().find(y => y.id === iaz.dataset.iazinc); if (x) iadeZincirModal(x); return; }
      const iae = e.target.closest("[data-iaap],[data-iared]"); if (iae) { if (!H.can("iade_onay")) { H.toast("İade onay yetkiniz yok.", "e"); return; } const id = iae.dataset.iaap || iae.dataset.iared, ok = !!iae.dataset.iaap, x = iadeRows().find(y => y.id === id); if (x) { onayIlerlet(x, ok); if (ok && x.durum === "Onaylandı") x.durum = "İade tamamlandı";
        if (x.durum === "İade tamamlandı" && x.tip === "Fatura İade") { const f = (H.data.faturalar || []).find(y => (y.protokolNo && y.protokolNo === x.proto) || y.no === x.proto); if (f) { f.katilim = Math.max(0, (f.katilim || 0) - x.tutar); f.toplam = Math.max(0, (f.toplam || 0) - x.tutar); f.iade = (f.iade || 0) + x.tutar; if (f.katilim <= 0) f.durum = "İade edildi"; } }
        H.saveData && H.saveData();
        H.log("İade onay kademesi " + (ok ? "ilerledi" : "reddedildi"), x.eden + " · " + x.tutar + " ₼ · " + x.durum); H.toast(ok ? (x.durum === "İade tamamlandı" ? "İade tamamen onaylandı" : "Bir kademe onaylandı · sonraki onay bekliyor") : "İade reddedildi", ok && x.durum !== "Onay bekliyor" ? "ok" : "w"); H.go("vezne", params); } return; }
      if (e.target.closest("[data-fsec]")) return hizmetSecModal();
      const fa = e.target.closest("[data-fadd]"); if (fa) { const el = root.querySelector("[data-fhiz]"), ad = (el.value || "").trim(), kod = el.dataset.kod || "", fy = +root.querySelector("[data-ffiyat]").value || (kod ? H.fiyatOf(kod, params.kurum || "Özel ödeme") : 0); if (!ad) { H.toast("Katalogdan hizmet seçin.", "w"); return; } (H.data.vFiyat = H.data.vFiyat || []).push({ ad, kod, fiyat:fy }); H.go("vezne", params); return; }
      const frm = e.target.closest("[data-frm]"); if (frm) { (H.data.vFiyat || []).splice(+frm.dataset.frm, 1); H.go("vezne", params); return; }
      const th = e.target.closest("[data-tahsil]"); if (th) { const x = faturalar().find(y => y.id === th.dataset.tahsil); if (!x) return;
        const kalan = x.katilim - (x.odenen || 0);
        H.modal({ title:"Tahsilat · " + H.esc(vzName(x.hasta)), body:`<div class="icd-form"><div class="fr"><label>Fatura tutarı</label><input value="${x.katilim} ₼" readonly></div>
          <div class="fr"><label>Kalan</label><input value="${kalan} ₼" readonly></div>
          <div class="fr"><label>Tahsil edilecek</label><input type="number" data-f="tutar" value="${kalan}" min="0" max="${kalan}"></div>
          <div class="fr"><label>Ödeme tipi</label><select data-f="odeme">${ODEME_TIP.map(o => `<option>${o}</option>`).join("")}</select></div>
          <div class="fr"><label>Banko</label><input value="${H.esc(banko)}" readonly></div></div>
          <p class="adm-sub" style="margin-top:6px">Kısmi tutar girilebilir; kalan kadar ödenince fatura "Ödendi" olur.</p>`,
          actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Tahsil et</button>`,
          onMount(m) { m.querySelector("[data-ok]").onclick = () => { let t = +m.querySelector('[data-f="tutar"]').value || 0; if (t <= 0) { H.toast("Tutar girin.", "w"); return; } if (t > kalan) t = kalan;
            x.odenen = (x.odenen || 0) + t; x.odemeTipi = m.querySelector('[data-f="odeme"]').value; x.banko = banko; x.donem = donemNo;
            const bitti = x.odenen >= x.katilim; x.durum = bitti ? "Ödendi" : "Bekliyor";
            H.saveData && H.saveData(); H.log("Tahsilat" + (bitti ? "" : " (kısmi)"), x.hasta + " · " + t + " ₼ · " + x.odemeTipi + " · " + banko); H.closeModal();
            H.toast(bitti ? "Tam tahsil edildi: " + t + " ₼" : "Kısmi tahsilat: " + t + " ₼ · kalan " + (x.katilim - x.odenen) + " ₼", bitti ? "" : "w"); H.go("vezne", params); }; } });
      }
    };
  } });

  /* ================= MEDİKAL MUHASEBE (kurumsal faturalama / evrak / alacak hub'ı) ================= */
  H.addT && H.addT({ m_medmuhasebe:{ TR:"Medikal Muhasebe", AZ:"Tibbi Mühasibat", RU:"Медицинская бухгалтерия", EN:"Medical accounting" } });
  H.register("medmuhasebe", { title:() => H.t("m_medmuhasebe"), perm:["summary", "muhasebe"], render(root) {
    // Kurum bazlı açık alacak: ödenmemiş hasta/kurum faturalarından türetilir.
    const alacak = {}; faturalar().filter(x => x.durum !== "Ödendi").forEach(x => { const k = x.kurum || "—"; alacak[k] = alacak[k] || { a:0, t:0 }; alacak[k].a++; alacak[k].t += (x.toplam - x.katilim); });
    (H.data.kurumFatura || []).forEach(kf => { const top = kf.kalemler.reduce((a, r) => a + r[2] * r[3], 0), av = kf.vezne.filter(v => /[Aa]vans/.test(v[1])).reduce((a, v) => a + v[2], 0); const k = kf.kurum; alacak[k] = alacak[k] || { a:0, t:0 }; alacak[k].a++; alacak[k].t += (top - av); });
    const cards = [["Kurumsal faturalama", "Anlaşmalı kurum dönem faturaları, kalem/işlem/protokol/icmal", "vezne", { tab:"kurumsal" }],
      ["Fatura durumu (GFK)", "Fatura kesildi/kesilmedi ve provizyon takibi", "vezne", { tab:"gfk" }],
      ["Evrak takip", "Fatura evrakının veznede/medikal muhasebede/teslim durumu", "vezne", { tab:"evrak" }],
      ["İndirim / iade onayları", "Yetkili onayı bekleyen indirim ve iadeler", "vezne", { tab:"indirim" }]];
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_medmuhasebe")}</h2><p>Kurumsal faturalama, evrak ve alacak takibi · vezne ile bağlantılı</p></div></div>
      <div class="g2" style="align-items:start">${cards.map(([t, d, pg, pr]) => `<button class="card" style="text-align:left;cursor:pointer" data-mmgo="${pg}" data-mmp='${H.esc(JSON.stringify(pr))}'><b style="font:700 15px 'Space Grotesk'">${H.esc(t)}</b><div class="adm-sub" style="margin-top:4px">${H.esc(d)}</div></button>`).join("")}</div>
      <div class="ist-sec ist-hd" style="margin-top:16px"><h5>Kurum bazlı açık alacak</h5><div class="r" style="gap:6px">${H.filterBox("Kurum ara…")}<button class="btn sm" data-mmexp>${I("save") || ""} Excel</button><button class="btn sm" data-mmyaz>${I("print") || ""} Yazdır</button></div></div>
      <div class="tw"><table class="t"><thead><tr><th>Kurum / sigorta</th><th style="width:120px">Fatura</th><th style="width:150px">Açık alacak ₼</th></tr></thead><tbody>
      ${Object.keys(alacak).length ? Object.entries(alacak).sort((a, b) => b[1].t - a[1].t).map(([k, v]) => `<tr><td><b>${H.esc(k)}</b></td><td class="n">${v.a}</td><td class="n">${v.t} ₼</td></tr>`).join("") : `<tr><td colspan="3" class="mute" style="padding:16px;text-align:center">Açık alacak yok.</td></tr>`}</tbody></table></div>
      <p class="adm-sub" style="margin-top:10px">Medikal muhasebe, kurumlara kesilen faturaların ve tahsilatının takip edildiği yerdir. Detay kurgu (hakediş, kurum mutabakatı, SAMHI dönem icmali) referans görsellerle oturtulacak.</p>`;
    root.onclick = (e) => { const g = e.target.closest("[data-mmgo]"); if (g) { let pr = {}; try { pr = JSON.parse(g.dataset.mmp); } catch {} return H.go(g.dataset.mmgo, pr); }
      if (e.target.closest("[data-mmexp]")) { H.exportCsv("Kurum_acik_alacak", ["Kurum", "Fatura", "Açık alacak ₼"], Object.entries(alacak).map(([k, v]) => [k, v.a, v.t])); H.toast("Excel (CSV) indirildi"); return; }
      if (e.target.closest("[data-mmyaz]")) { if (H.printTable) H.printTable("Kurum bazlı açık alacak", ["Kurum / sigorta", "Fatura", "Açık alacak ₼"], Object.entries(alacak).sort((a, b) => b[1].t - a[1].t).map(([k, v]) => [k, v.a, v.t + " ₼"])); } };
    H.wireFilter(root);
  } });

  /* ================= YÖNETİM RAPORLARI (başlık kataloğu · içerik yapım aşamasında) ================= */
  // Rapor adları sahibin verdiği referans ekranla birebir (6 grup). Medula yok (Azerbaycan). İçerikler örnek veriyle sırayla dolar.
  const RAPOR_GRUP = [
    ["Geliş ve Muayene", ["TSIM", "Aynı Gün Geliş Analizi", "Hasta Geliş Analizi", "Yeni Muayene Gelişi", "Doktor Protokol Sayı Analizi", "Doktor İşlem Analizi"]],
    ["Fatura ve Tahsilat", ["Fatura Analizi", "Faturalanmamış Tahsilat Analizi", "Vezne Tahakkuk Tahsilat Analizi", "Banko Vezne Fatura Analizi", "Protokol Fiyat Log"]],
    ["İndirim ve İade", ["Hasta İndirim Analizi", "Onay Bekleyen İndirimler", "İade Talepleri (Avans/Fatura)"]],
    ["Borç ve Açık Hesap", ["Protokol Borç Takip", "Hasta Borç Takip", "Vezne Borç Takip", "Vezne Açık Hesap Analizi", "Personel ve Yakını Açık Hesap Analizi", "Bekleyen Avans Listesi"]],
    ["İptal Analizleri", ["Protokol İptal Analizi", "Fatura İptal Analizi", "Vezne İşlem İptal Analizi", "Protokol İşlem İptal Analizi"]],
    ["Protokol ve Liste", ["Protokol Listesi", "Kvk / Demografik Bilgi Raporu"]],
  ];
  H.raporGruplari = RAPOR_GRUP.map(g => g[0]);   // admin "Rapor Yetkileri" ekranı bunu kullanır
  H.register("raporlar", { title:() => H.t("m_raporlar"), perm:["summary", "audit"], render(root) {
    const role = (H.state.user || {}).role, allow = H.data.rolRapor && H.data.rolRapor[role];
    const groups = RAPOR_GRUP.filter(([g]) => !allow || allow[g]);
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_raporlar")}</h2><p>Yönetim raporları ve analizler · rol yetkisine göre${allow ? " (kısıtlı)" : ""}</p></div></div>
      <div class="adm-bar" style="margin-bottom:12px">${H.filterBox("Rapor adı ara…")}</div>
      ${(groups.length ? groups : [["", ["— Bu rol için tanımlı rapor yok (admin → Rapor Yetkileri) —"]]]).map(([g, items]) => `<div class="ist-sec"><div class="ist-hd"><h5>${H.esc(g)}</h5></div>
        <div class="rp-grid">${items.map(r => `<button class="rp-card" data-rap="${H.esc(r)}">${I("chart") || ""}<span>${H.esc(r)}</span></button>`).join("")}</div></div>`).join("")}
      <p class="adm-sub" style="margin-top:10px">Her rapor: tarih/bölüm/doktor filtresi + tablo/özet olacak. Öncelikli raporlar örnek veriyle sırayla doldurulacak.</p>`;
    const rq = root.querySelector("[data-tfilter]"); if (rq) rq.oninput = () => { const v = rq.value.trim().toLocaleLowerCase("tr");
      root.querySelectorAll(".rp-card").forEach(c => c.style.display = (!v || c.textContent.toLocaleLowerCase("tr").includes(v)) ? "" : "none");
      root.querySelectorAll(".ist-sec").forEach(s => s.style.display = [...s.querySelectorAll(".rp-card")].some(c => c.style.display !== "none") ? "" : "none"); };
    root.onclick = (e) => { const c = e.target.closest("[data-rap]"); if (!c) return; const name = c.dataset.rap, d = reportData(name);
      if (!d) { H.toast(name + " · yapım aşamasında", "w"); return; }
      const bols = (H.klinikBolumler ? H.klinikBolumler() : []), docs = (H.data.users || []).filter(u => u.role === "hekim");
      H.modal({ title:name, wide:true, body:`<div class="rp-filtre"><div class="fr"><label>Tarih (baş)</label><input type="date" data-rf="t1"></div><div class="fr"><label>Tarih (bitiş)</label><input type="date" data-rf="t2"></div>
          <div class="fr"><label>Bölüm</label><select data-rf="bol"><option value="">Tümü</option>${bols.map(b => `<option>${H.esc(b.ad)}</option>`).join("")}</select></div>
          <div class="fr"><label>Doktor</label><select data-rf="dr"><option value="">Tümü</option>${docs.map(u => `<option>${H.esc(u.name)}</option>`).join("")}</select></div>
          <button class="btn p sm" data-rfuygula>${I("search") || ""} Uygula</button></div>
        <div class="tw"><table class="t"><thead><tr>${d.cols.map(cc => `<th>${H.esc(cc)}</th>`).join("")}</tr></thead><tbody>${d.rows.length ? d.rows.map(r => `<tr>${r.map((cell, i) => `<td${i > 0 ? ' class="n"' : ""}>${H.esc(String(cell))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${d.cols.length}" class="mute" style="padding:16px;text-align:center">Veri yok.</td></tr>`}</tbody></table></div><p class="adm-sub" style="margin-top:8px">${H.esc(d.note || "Örnek/özet veri.")}</p>`,
        actions:`<button class="btn" data-exp>${I("save") || ""} Excel'e aktar</button><button class="btn" data-rapyaz>${I("print") || ""} Yazdır</button><span class="spacer"></span><button class="btn" data-x>Kapat</button>`,
        onMount(m) { m.querySelector("[data-exp]").onclick = () => { csvExport(name, d.cols, d.rows); H.toast("Excel (CSV) indirildi"); };
          const u = m.querySelector("[data-rfuygula]"); if (u) u.onclick = () => H.toast("Filtre uygulandı (tarih/bölüm/doktor)");
          const y = m.querySelector("[data-rapyaz]"); if (y) y.onclick = () => H.printTable ? H.printTable(name, d.cols, d.rows) : H.toast("Yazdırma yok", "w"); } });
    };
  } });
  // Rapor/tabloyu Excel'in açacağı CSV olarak indirir (UTF-8 BOM + ; ayracı).
  function csvExport(name, cols, rows) {
    const q = (v) => { v = String(v == null ? "" : v); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [cols.map(q).join(";"), ...rows.map(r => r.map(q).join(";"))];
    try { const blob = new Blob(["﻿" + lines.join("\r\n")], { type:"text/csv;charset=utf-8" }), url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = String(name || "rapor").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) + ".csv"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { H.toast("Dışa aktarma bu tarayıcıda çalışmadı.", "e"); }
  }
  H.exportCsv = csvExport;   // diğer modüller (admin listeleri vb.) de kullanır
  // Ortak liste filtresi: ekranda bir [data-tfilter] kutusu varsa, görünür .t tablolarının satırlarını metne göre gizler/gösterir.
  H.filterBox = (ph) => `<input data-tfilter class="tfilter" placeholder="${H.esc(ph || "Listede ara…")}" style="min-width:200px">`;
  H.wireFilter = (root) => { const q = root && root.querySelector("[data-tfilter]"); if (!q) return;
    q.oninput = () => { const v = q.value.trim().toLocaleLowerCase("tr");
      root.querySelectorAll("table.t").forEach(tb => { if (tb.offsetParent === null) return;   // gizli sekmedeki tabloya dokunma
        const body = tb.tBodies[0]; if (!body) return;
        [...body.rows].forEach(r => { if (r.querySelector("td[colspan]")) return; r.style.display = (!v || r.textContent.toLocaleLowerCase("tr").includes(v)) ? "" : "none"; }); }); }; };
  // Öncelikli raporların örnek/özet verisi (gerçek veriden türetilir)
  function reportData(name) {
    const docName = (id) => { const u = (H.data.users || []).find(x => x.u === id); return u ? u.name : (id || "—"); };
    if (name === "Hasta Geliş Analizi") { const g = {}; (H.data.patients || []).forEach(p => { const e = (H.ENC[H.encOf(p)] || {}).label || H.encOf(p); g[e] = (g[e] || 0) + 1; });
      return { cols:["Geliş tipi", "Hasta sayısı"], rows:Object.entries(g).map(([k, v]) => [k, v]), note:"Yatan hastalar birimlerinden, ayaktan hastalar başvuru tipinden sayılır." }; }
    if (name === "Fatura Analizi") { const f = faturalar(), g = {}; f.forEach(x => { g[x.durum] = g[x.durum] || { a:0, t:0, k:0 }; g[x.durum].a++; g[x.durum].t += x.toplam; g[x.durum].k += x.katilim; });
      return { cols:["Durum", "Adet", "Toplam ₼", "Katılım ₼"], rows:Object.entries(g).map(([k, v]) => [k, v.a, v.t, v.k]) }; }
    if (name === "Hasta İndirim Analizi") { const r = indirimRows(), g = {}; r.forEach(x => { g[x.durum] = g[x.durum] || { a:0, t:0 }; g[x.durum].a++; g[x.durum].t += x.tutar; });
      return { cols:["Durum", "Adet", "Toplam tutar ₼"], rows:Object.entries(g).map(([k, v]) => [k, v.a, v.t]), note:"İndirim onay ekranındaki taleplerden." }; }
    if (name === "Doktor Protokol Sayı Analizi") { const g = {}; (H.data.patients || []).forEach(p => { const d = docName(p.attending); g[d] = (g[d] || 0) + 1; });
      return { cols:["Doktor", "Hasta / protokol sayısı"], rows:Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]) }; }
    if (name === "Protokol Listesi") { return { cols:["Protokol", "Hasta", "Geliş", "Bölüm", "Fatura durumu"], rows:gfkRows().map(x => [x.proto, vzName(x.hasta), x.gelis, x.bolum, x.durum]) }; }
    if (name === "Aynı Gün Geliş Analizi") { const bolum = {}; (H.data.patients || []).filter(p => (p.admitDays || 0) === 0).forEach(p => { const b = H.bed(p.bed), u = b && H.unit(b.unitId), k = u ? u.tr : "—"; bolum[k] = (bolum[k] || 0) + 1; });
      return { cols:["Bölüm / birim", "Bugünkü geliş"], rows:Object.entries(bolum).map(([k, v]) => [k, v]), note:"Yatış günü 0 olan (bugün gelen) hastalar." }; }
    if (name === "Yeni Muayene Gelişi") { const r = (H.data.patients || []).filter(p => H.encOf(p) === "ayaktan").map(p => [p.hn || "—", vzName(p.name), p.dx || "—", docName(p.attending)]);
      return { cols:["Hasta no", "Hasta", "Ön tanı", "Doktor"], rows:r, note:"Ayaktan (poliklinik) muayene gelişleri." }; }
    if (name === "Vezne Tahakkuk Tahsilat Analizi") { const f = faturalar(), od = f.filter(x => x.durum === "Ödendi"), bk = f.filter(x => x.durum !== "Ödendi");
      return { cols:["Durum", "Adet", "Tutar ₼"], rows:[["Tahsil edildi", od.length, od.reduce((a, x) => a + x.katilim, 0)], ["Bekleyen tahakkuk", bk.length, bk.reduce((a, x) => a + x.katilim, 0)]] }; }
    if (name === "Provizyon Takip Analizi") { const g = {}; gfkRows().forEach(x => { g[x.durum] = (g[x.durum] || 0) + 1; });
      return { cols:["Provizyon / fatura durumu", "Protokol sayısı"], rows:Object.entries(g).map(([k, v]) => [k, v]), note:"GFK takipteki protokollerin provizyon/fatura durumu." }; }
    if (name === "Bekleyen Avans Listesi") return { cols:["Protokol", "Hasta", "Avans ₼", "Durum"], rows:[["50894026", "Aysu Rəhimova", 500, "Bekliyor"], ["50892562", "Nurgül Süleymanova", 300, "Bekliyor"], ["50790716", "Nərgiz Əliyeva", 100, "Kısmi iade"]], note:"Örnek veri." };
    if (name === "Tahsilat Analizi") { const f = faturalar(), od = f.filter(x => x.durum === "Ödendi");
      return { cols:["Durum", "Adet", "Katılım ₼"], rows:[["Tahsil edildi", od.length, od.reduce((a, x) => a + x.katilim, 0)], ["Bekleyen", f.length - od.length, f.filter(x => x.durum !== "Ödendi").reduce((a, x) => a + x.katilim, 0)]], note:"Vezne faturalarından türetilmiştir." }; }
    if (name === "Ciro") { const f = faturalar(), top = f.reduce((a, x) => a + x.toplam, 0), kat = f.reduce((a, x) => a + x.katilim, 0);
      return { cols:["Kalem", "Tutar ₼"], rows:[["Toplam fatura (brüt)", top], ["Hasta katılımı", kat], ["Kurum / SAMHI payı", top - kat], ["Fatura adedi", f.length]], note:"Dönemdeki vezne faturalarının toplamı." }; }
    if (name === "Yatan Hasta Listesi") { const r = (H.data.patients || []).filter(p => H.encOf(p) !== "ayaktan").map(p => { const b = H.bed(p.bed), u = b && H.unit(b.unitId); return [p.hn || "—", vzName(p.name), u ? u.tr : "—", b ? b.no : "—", docName(p.attending), p.dx || "—"]; });
      return { cols:["Hasta no", "Hasta", "Birim", "Yatak", "Doktor", "Tanı"], rows:r, note:"Yatan / yoğun bakım hastaları." }; }
    if (name === "Taburcu Hasta Listesi") { const r = (H.data.discharged || []).map(d => [d.name ? vzName(d.name) : "—", d.bed || "—", d.unit || "—", d.when || d.date || "—"]);
      return { cols:["Hasta", "Yatak", "Birim", "Taburcu"], rows:r, note:"Taburcu edilmiş hastalar." }; }
    if (name === "Yatak Doluluk Oranları") { const r = (H.units ? H.units() : []).map(u => { const beds = (u.beds || []).filter(b => !b.archived), dolu = beds.filter(b => b.pid || b.status === "dolu").length, t = beds.length;
      return [u.tr, t, dolu, t - dolu, t ? Math.round(dolu / t * 100) + "%" : "—"]; });
      return { cols:["Birim", "Yatak", "Dolu", "Boş", "Doluluk"], rows:r, note:"Arşivlenmiş yataklar hariç." }; }
    if (name === "Doktor İşlem Analizi") { const g = {}; (H.data.patients || []).forEach(p => { const d = docName(p.attending); g[d] = g[d] || { h:0, y:0 }; g[d].h++; if (H.encOf(p) !== "ayaktan") g[d].y++; });
      return { cols:["Doktor", "Toplam protokol", "Yatan"], rows:Object.entries(g).sort((a, b) => b[1].h - a[1].h).map(([k, v]) => [k, v.h, v.y]) }; }
    if (name === "Personel Listesi Raporu") { const r = (H.data.personel || []).map(pp => [(pp.ad || "") + " " + (pp.soyad || ""), pp.unvan || pp.gorev || "—", pp.bolum || "—", pp.personelTip || pp.tip || "—", pp.sube || "Bakü Hastanesi"]);
      return { cols:["Ad soyad", "Unvan / görev", "Bölüm", "Tip", "Şube"], rows:r, note:"İnsan Kaynakları kartlarından." }; }
    if (name === "Kvk / Demografik Bilgi Raporu") { const cins = {}, uyr = {}; (H.data.patients || []).forEach(p => { const c = p.sex === "E" ? "Kişi (E)" : "Qadın (K)"; cins[c] = (cins[c] || 0) + 1; const un = p.uyruk || "Azərbaycan"; uyr[un] = (uyr[un] || 0) + 1; });
      return { cols:["Demografi", "Değer", "Hasta sayısı"], rows:[...Object.entries(cins).map(([k, v]) => ["Cinsiyet", k, v]), ...Object.entries(uyr).map(([k, v]) => ["Uyruk", k, v])], note:"KVKK: isim/kimlik içermez, yalnız toplu demografi." }; }
    if (name === "Faturalanmamış Tahsilat Analizi") { const g = {}; gfkRows().forEach(x => { g[x.durum] = (g[x.durum] || 0) + 1; });
      return { cols:["Fatura durumu", "Protokol sayısı"], rows:Object.entries(g).map(([k, v]) => [k, v]), note:"Fatura kesilmemiş protokoller (GFK takip)." }; }
    if (name === "Banko Vezne Fatura Analizi") { const g = {}; faturalar().filter(x => x.durum === "Ödendi").forEach(x => { const b = x.banko || "—"; g[b] = g[b] || { a:0, t:0 }; g[b].a++; g[b].t += x.katilim; });
      return { cols:["Banko / kasa", "Fatura", "Tahsilat ₼"], rows:Object.entries(g).map(([k, v]) => [k, v.a, v.t]), note:"Tahsil edilen faturaların bankoya göre dağılımı." }; }
    if (name === "Onay Bekleyen İndirimler") { const r = indirimRows().filter(x => x.durum === "Onay bekliyor");
      return { cols:["Tarih", "Hasta", "İşlem", "Tutar ₼", "Oran %", "Onay grubu"], rows:r.map(x => [x.tarih, vzName(x.hasta), x.islem, x.tutar, x.oran, x.grup]), note:"Yetkili rolün onayını bekleyen indirimler." }; }
    if (name === "İade Talepleri (Avans/Fatura)") { const r = iadeRows();
      return { cols:["Tip", "Tarih", "Talep eden", "Tutar ₼", "Durum"], rows:r.map(x => [x.tip, x.tarih, vzName(x.eden), x.tutar, x.durum]), note:"Avans ve fatura iade talepleri." }; }
    if (name === "Hasta Borç Takip") { const g = {}; faturalar().filter(x => x.durum !== "Ödendi").forEach(x => { const h = vzName(x.hasta); g[h] = (g[h] || 0) + x.katilim; });
      return { cols:["Hasta", "Bekleyen borç ₼"], rows:Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]), note:"Hasta katılım payı bazında bekleyen tutarlar." }; }
    if (name === "Protokol Borç Takip") { const r = faturalar().filter(x => x.durum !== "Ödendi").map(x => [x.protokol, vzName(x.hasta), x.kurum, x.katilim]);
      return { cols:["Protokol", "Hasta", "Kurum", "Bekleyen ₼"], rows:r, note:"Ödemesi bekleyen protokoller." }; }
    if (name === "Vezne Borç Takip" || name === "Vezne Açık Hesap Analizi") { const bek = faturalar().filter(x => x.durum !== "Ödendi"), top = bek.reduce((a, x) => a + x.katilim, 0);
      return { cols:["Kalem", "Değer"], rows:[["Bekleyen fatura adedi", bek.length], ["Toplam bekleyen ₼", top], ["Devir (açılış) ₼", H.data.vezneDevir || 0]], note:"Veznenin açık hesap/bekleyen tahsilat özeti." }; }
    if (/İptal Analizi/.test(name)) { const ip = (H.data.iptaller || []);
      return { cols:["Tarih", "Tür", "Kayıt", "Sebep"], rows:ip.map(x => [x.tarih || "—", x.tur || "—", x.kayit || "—", x.sebep || "—"]), note:"İptal edilen kayıtlar. Henüz iptal işlemi yoksa boş görünür." }; }
    return null;
  }

  /* ================= MALİ İŞLER · Vezne dönem onay (iki aşamalı kapanış) =================
   * Kasiyer dönemi kapatınca "onay bekliyor" kaydı oluşur. Mali İşler beklenen (sistem) ile
   * sayılan (kasiyer) tutarı karşılaştırıp (Fark) onaylar (kilitlenir, kasiyer yeni dönem açabilir)
   * ya da reddeder (dönem kasiyere geri açılır, düzeltir). Renk: fark 0 yeşil, fark var kırmızı. */
  H.register("donemonay", { title:() => H.t("m_donemonay"), perm:["donem_onay"], render(root, params = {}) {
    const can = H.can("donem_onay"), f = params.f || "bekliyor";
    const list = (H.data.vezneKapanislar || []).filter(x => f === "hepsi" ? true : x.onay === f);
    const SEG = [["bekliyor", "Onay bekleyen"], ["onaylandi", "Onaylanan"], ["reddedildi", "Reddedilen"], ["hepsi", "Tümü"]];
    const para = (v) => (v == null ? "—" : (+v).toLocaleString("az") + " ₼");
    const farkTag = (x) => { const d = x.fark || 0; return `<span class="tag ${d === 0 ? "ok" : "w"}" title="${d > 0 ? "Fazla" : d < 0 ? "Eksik" : "Tam"}">${d > 0 ? "+" : ""}${para(d)}</span>`; };
    const durTag = (o) => `<span class="tag ${o === "onaylandi" ? "ok" : o === "reddedildi" ? "w" : ""}">${o === "onaylandi" ? "Onaylandı" : o === "reddedildi" ? "Reddedildi" : "Onay bekliyor"}</span>`;
    const bekSay = (H.data.vezneKapanislar || []).filter(x => x.onay === "bekliyor").length;
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_donemonay")}</h2><p>Kapanmış vezne dönemlerini kontrol et, kasayı teslim al, onayla. ${bekSay} dönem onay bekliyor.</p></div></div>
      <div class="seg" style="margin-bottom:12px">${SEG.map(([k, l]) => `<button data-fseg="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="tw"><table class="t"><thead><tr><th style="width:70px">Dönem</th><th>Vezne</th><th>Banko / kasa</th><th style="width:140px">Kapanış</th><th style="width:110px">Beklenen</th><th style="width:110px">Sayılan</th><th style="width:120px">Fark</th><th style="width:120px">Durum</th><th style="width:200px"></th></tr></thead><tbody>
      ${list.length ? list.map(x => `<tr><td class="mono">#${H.esc(String(x.no))}</td><td><b>${H.esc(x.vezne)}</b></td><td class="adm-sub">${H.esc(x.banko)}</td><td class="adm-sub">${H.esc(x.kapanisT || "—")}</td><td class="n">${para(x.beklenen)}</td><td class="n">${para(x.sayilan)}</td><td class="n">${farkTag(x)}</td><td>${durTag(x.onay)}${x.redNot ? `<div class="adm-sub" style="font-size:11px">${H.esc(x.redNot)}</div>` : ""}${x.onaylayan ? `<div class="adm-sub" style="font-size:11px">${H.esc(x.onaylayan)}</div>` : ""}</td><td>${x.onay === "bekliyor" && can ? `<button class="btn p sm" data-vkdetay="${x.id}">İncele</button> <button class="btn p sm" data-vkonay="${x.id}">Teslim al / Onayla</button> <button class="btn g sm" data-vkred="${x.id}">Reddet</button>` : `<button class="btn sm" data-vkdetay="${x.id}">İncele</button>`}</td></tr>`).join("") : `<tr><td colspan="9" class="mute" style="padding:20px;text-align:center">Bu durumda dönem yok.</td></tr>`}</tbody></table></div>
      <p class="adm-sub" style="margin-top:8px">Fark yeşil (0) ise kasa tam; kırmızı ise eksik/fazla var, incelenir. Onaylanınca dönem kilitlenir ve kasiyer yeni dönem/kasa açabilir. Reddedilince dönem kasiyere geri açılır.</p>`;
    const rec = (id) => (H.data.vezneKapanislar || []).find(x => x.id === id);
    const SAYAD = { nakit:"Nakit", kk:"Kredi kartı", havale:"Havale/EFT", cek:"Çek", senet:"Senet", usd:"USD", eur:"EUR", avans:"Avans", katilim:"Katılım payı" };
    function onayla(x) { x.onay = "onaylandi"; x.onaylayan = (H.state.user || {}).name || "Mali İşler"; const dl = H.data.vezneDonemler || {}; if (dl[x.banko]) dl[x.banko].onay = "onaylandi"; H.saveData && H.saveData(); H.log("Vezne dönem onaylandı", "#" + x.no + " · " + x.banko + " · fark " + (x.fark || 0) + " ₼"); H.toast("Kasa teslim alındı · dönem #" + x.no + " onaylandı"); H.go("donemonay", params); }
    function reddet(x) { const not = prompt("Red nedeni (kasiyere iletilecek):", "Kasa farkı var, yeniden sayın."); if (not == null) return; x.onay = "reddedildi"; x.redNot = not.trim(); const dl = H.data.vezneDonemler || {}; if (dl[x.banko]) { dl[x.banko].acik = true; dl[x.banko].onay = null; } H.saveData && H.saveData(); H.log("Vezne dönem reddedildi", "#" + x.no + " · " + x.banko); H.toast("Dönem reddedildi · kasiyere geri açıldı", "w"); H.go("donemonay", params); }
    function detay(x) {
      const chans = [...new Set([...Object.keys(x.beklenenKanal || {}), ...Object.keys(x.sayim || {})])].filter(k => (x.beklenenKanal || {})[k] || (x.sayim || {})[k]);
      const krows = chans.length ? chans.map(k => { const bek = (x.beklenenKanal || {})[k] || 0, say = (x.sayim || {})[k] || 0, fk = +(say - bek).toFixed(2);
        return `<tr><td>${H.esc(SAYAD[k] || k)}</td><td class="n">${para(bek)}</td><td class="n">${para(say)}</td><td class="n"><span class="tag ${fk === 0 ? "ok" : "w"}">${fk > 0 ? "+" : ""}${para(fk)}</span></td></tr>`; }).join("")
        : `<tr><td colspan="4" class="mute" style="padding:12px;text-align:center">Sayım/beklenen kaydı yok.</td></tr>`;
      const tah = (H.data.faturalar || []).filter(f => f.banko === x.banko && f.durum === "Ödendi");
      const trows = tah.length ? tah.map(f => `<tr><td><b>${H.esc(vzName(f.hasta))}</b></td><td class="mono adm-sub">${H.esc(f.protokol || "—")}</td><td class="adm-sub">${H.esc(f.odemeTipi || "—")}</td><td class="n">${para(f.katilim)}</td></tr>`).join("")
        : `<tr><td colspan="4" class="mute" style="padding:12px;text-align:center">Bu döneme bağlı tahsilat kaydı yok (demo).</td></tr>`;
      const bekliyor = x.onay === "bekliyor";
      H.modal({ title:`Kasa teslim · #${x.no} · ${H.esc(x.vezne)}`, wide:true,
        body:`<div class="h360-meta" style="margin-bottom:12px"><div><span>Banko</span><b>${H.esc(x.banko)}</b></div><div><span>Beklenen (sistem)</span><b>${para(x.beklenen)}</b></div><div><span>Sayılan (kasiyer)</span><b>${para(x.sayilan)}</b></div><div><span>Fark</span><b style="color:${(x.fark || 0) === 0 ? "var(--ok)" : "var(--crit)"}">${(x.fark || 0) > 0 ? "+" : ""}${para(x.fark)}</b></div><div><span>Durum</span><b>${x.onay === "onaylandi" ? "Onaylandı" : x.onay === "reddedildi" ? "Reddedildi" : "Onay bekliyor"}</b></div></div>
          <h6 style="margin:0 0 6px">Kasa kontrolü (kanal bazında)</h6>
          <div class="tw"><table class="t"><thead><tr><th>Para türü</th><th style="width:120px">Beklenen ₼</th><th style="width:120px">Sayılan ₼</th><th style="width:130px">Fark ₼</th></tr></thead><tbody>${krows}</tbody></table></div>
          <h6 style="margin:14px 0 6px">Dönem tahsilatları (açılan hastalar)</h6>
          <div class="tw" style="max-height:34vh;overflow:auto"><table class="t"><thead><tr><th>Hasta</th><th style="width:110px">Protokol</th><th style="width:130px">Ödeme tipi</th><th style="width:110px">Tahsilat ₼</th></tr></thead><tbody>${trows}</tbody></table></div>`,
        actions:`<button class="btn" data-x>Kapat</button>${bekliyor && can ? `<span class="spacer"></span><button class="btn g" data-dred>Reddet</button><button class="btn p" data-don>Teslim al / Onayla</button>` : ""}`,
        onMount(m) { const o = m.querySelector("[data-don]"), r = m.querySelector("[data-dred]");
          if (o) o.onclick = () => { H.closeModal(); onayla(x); };
          if (r) r.onclick = () => { reddet(x); if (x.onay === "reddedildi") H.closeModal(); }; } });
    }
    root.onclick = (e) => {
      const seg = e.target.closest("[data-fseg]"); if (seg) return H.go("donemonay", { f:seg.dataset.fseg });
      const dt = e.target.closest("[data-vkdetay]"); if (dt) { const x = rec(dt.dataset.vkdetay); if (x) detay(x); return; }
      if (!can) return;
      const on = e.target.closest("[data-vkonay]"); if (on) { const x = rec(on.dataset.vkonay); if (x) onayla(x); return; }
      const rd = e.target.closest("[data-vkred]"); if (rd) { const x = rec(rd.dataset.vkred); if (x) reddet(x); return; }
    };
  } });

  /* ================= HASTA 360 (tam ekran hasta kartı · bizim tasarım) ================= */
  const H360_ANA = [["360", "Genel"], ["ishavuzu", "İş Havuzu"], ["tedavi", "Tedavi"], ["arsiv", "Arşiv"]];
  const H360_ALT = [["kart", "Hasta Kartı"], ["gelisler", "Gelişler"], ["faturalar", "Faturalar"], ["odeme", "Ödemeler / Avanslar"], ["indirim", "İndirimler"], ["dosya", "Dosyalar / Resimler"], ["notlar", "Notlar"], ["teklif", "Teklifler"], ["online", "Online Ödemeler"], ["pos", "POS İşlem Ödeme"], ["anlasma", "Anlaşmalarım"]];
  const H360_KABUL = [["ayaktan", "Poliklinik"], ["gunubirlik", "Günübirlik"], ["yatan", "Yatış"], ["yogun", "Yoğun bakım"], ["kontrol", "Kontrol"], ["donor", "Donör"]];
  const H360_DIGER = ["Hasta uyarısı", "Kullanılan steril setler", "Özel hasta bilgileri", "Hasta yakınları", "Hasta vefat etmiş", "Tercüman listesi", "Yeni doğan kaydı aç", "Bebek hasta bilgileri", "Transplantasyon bilgileri", "Hasta referans", "Hasta değişim logu", "Arşiv bilgileri", "Mobil onay kodları", "E-posta / SMS", "Finans bilgileri", "Hasta yönlendirme", "Araç plaka bilgileri", "Diyaliz tedavi bilgileri"];
  const secArr = (k, def) => { const s = H.data.secenekler; return (s && s[k] && s[k].length) ? s[k] : def; };
  H.register("hasta360", { title:() => "Hasta Dosyası", perm:["admission", "summary", "patient"], render(root, params = {}) {
    const p = H.pt(params.pid); if (!p) { root.innerHTML = `<div class="ph"><div><h2>Hasta Dosyası</h2><p>Hasta seçilmedi.</p></div></div><div class="empty">Vezne panelinden bir hasta seçin.</div>`; return; }
    const ana = params.atab || "360", alt = params.stab || "kart", b = H.bed(p.bed), u = b && H.unit(b.unitId), doctor = H.userBy(p.attending);
    const hdr = `<div class="h360-hdr">
      <div class="h360-id"><span class="h360-risk" style="background:${(H.SEV && H.SEV[p.risk] || {}).c || "var(--mute)"}" title="Durum"></span><div><div class="h360-name">${H.esc(vzName(p.name))}</div><div class="adm-sub">${H.encIcon(p)} ${H.esc((H.ENC[H.encOf(p)] || {}).label || H.encOf(p))} ${H.protoLock(p)} · ${H.esc(p.dx || "")}</div></div></div>
      <div class="h360-meta">
        <div><span>FİN</span><b>${H.esc(p.fin || "—")}</b></div><div><span>Hasta no</span><b>${H.esc(p.hn || "—")}</b></div><div><span>Protokol</span><b>${H.esc(p.proto || "—")}</b></div>
        <div><span>Hasta tipi</span><b>${H.esc(p.hastaTipi || "Normal")}</b></div><div><span>Uyruk</span><b>${H.esc(p.uyruk || "Azərbaycan")}</b></div>
        <div><span>Cinsiyet · yaş</span><b>${p.sex === "E" ? "Kişi" : "Qadın"} · ${p.age || "—"}</b></div><div><span>Yatak</span><b>${b ? H.esc(b.no) : "—"}</b></div><div><span>Banko</span><b>${H.esc(H.state.vezneBanko || "—")}</b></div>
        <div><span>Kayıt</span><b${p.onKayit ? ' style="color:var(--mid)"' : ""}>${p.onKayit ? "Ön kayıt" : "Kesin kayıt"}</b></div>${(() => { const d = (H.data.danismanlar || []).find(x => x.hasta === p.name && x.durum !== "Kapandı"); return d ? `<div><span>Danışman</span><b>${H.esc(d.danisman)}</b></div>` : ""; })()}</div></div>`;
    const anaTabs = `<div class="seg h360-ana">${H360_ANA.map(([k, l]) => `<button data-h3ana="${k}" class="${ana === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
    const toolbar = `<div class="h360-tools">
      <button class="btn p sm" data-h3save>${I("save") || ""} Kaydet</button>
      <div class="h360-dd"><button class="btn sm" data-h3kabul>${I("userPlus") || ""} Hasta kabul ▾</button><div class="h360-menu hidden" data-h3kabulm>${H360_KABUL.map(([k, l]) => `<button data-kabul="${k}">${l}</button>`).join("")}</div></div>
      <div class="h360-dd"><button class="btn sm" data-h3diger>Diğer ▾</button><div class="h360-menu hidden" data-h3digerm>${H360_DIGER.map(d => `<button data-diger="${H.esc(d)}">${d}</button>`).join("")}</div></div>
      <button class="btn sm" data-h3yaz>${I("print") || ""} Yazdır</button>
      <button class="btn sm" data-h3must>Müstehaklık sorgula</button>
      <button class="btn sm ${p.kvkk ? "" : "g"}" data-h3kvkk>KVKK onay</button>
      <button class="btn sm ${p.etk ? "" : "g"}" data-h3etk>ETK onay</button></div>`;
    const altTabs = ana === "360" ? `<div class="seg h360-alt">${H360_ALT.map(([k, l]) => `<button data-h3alt="${k}" class="${alt === k ? "on" : ""}">${l}</button>`).join("")}</div>` : "";
    const uyari = ((H.data.hastaBilgi || {})[p.id] || {}).uyari;
    const uyariBar = uyari ? `<div class="note" style="background:color-mix(in srgb,var(--crit) 14%,transparent);border:1px solid var(--crit);color:var(--crit);display:flex;align-items:center;gap:8px;margin-bottom:10px">${I("alert") || "⚠"} <b>Hasta uyarısı:</b> ${H.esc(uyari)}</div>` : "";
    root.innerHTML = `${hdr}${uyariBar}${anaTabs}${toolbar}${altTabs}<div class="h360-body" data-h3body></div>`;
    const body = root.querySelector("[data-h3body]");
    const fld = (k, lbl, ph, val) => `<div class="fr"><label>${H.esc(lbl)}</label><input data-hf="${k}" value="${H.esc(val != null ? val : (p[k] != null ? p[k] : ""))}" placeholder="${ph || ""}"></div>`;
    const selF = (k, lbl, list, val) => `<div class="fr"><label>${H.esc(lbl)}</label><select data-hf="${k}">${["", ...list].map(x => `<option${(val || p[k] || "") === x ? " selected" : ""}>${H.esc(x || "— seç —")}</option>`).join("")}</select></div>`;
    const kartHtml = () => `<div class="h360-cards">
      <div class="box"><h5>Kimlik ve demografi</h5><div class="icd-form">
        ${fld("hn", "Hasta no", "", p.hn)}${fld("proto", "Protokol no")}${fld("fin", "FİN kod")}${fld("seriya", "Seri no")}
        ${fld("ad", "Ad", "", (p.name || "").split(" ")[0])}${fld("soyad", "Soyad", "", (p.name || "").split(" ").slice(1).join(" "))}
        ${selF("sexT", "Cinsiyet", ["Qadın", "Kişi"], p.sex === "E" ? "Kişi" : "Qadın")}${fld("dob", "Doğum tarihi", "gg.aa.yyyy", p.dob)}
        ${fld("father", "Ata adı")}${fld("motherKimlik", "Ana kimlik")}${fld("mother", "Ana adı-soyadı")}${fld("cocukSira", "Uşaq sırası")}
        ${selF("uyruk", "Uyruk", ["Azərbaycan", "Türkiyə", "Rusiya", "Digər"], p.uyruk)}${fld("pasaport", "Pasaport no")}</div></div>
      <div class="box"><h5>Kimlik belgesi ve adres</h5><div class="icd-form">
        ${selF("belgeTip", "Kimlik belgesi", ["Şəxsiyyət vəsiqəsi", "Pasaport", "Sürücülük vəsiqəsi"])}${fld("sehir", "Şəhər")}${fld("rayon", "Rayon")}${fld("dogumYeri", "Doğum yeri")}
        ${selF("aile", "Ailə vəziyyəti", ["Subay", "Evli", "Bilinmir"])}${selF("erisim", "Erişim kanalı", secArr("erisim", ["Web", "Telefon", "Tövsiyə", "Digər"]))}
        ${selF("ulke", "Ölkə", ["Azərbaycan", "Digər"], p.ulke)}${fld("adres", "Ünvan")}${fld("postaKodu", "Poçt kodu")}</div></div>
      <div class="box"><h5>İletişim</h5><div class="icd-form">
        ${fld("phone", "Mobil tel")}${fld("evTel", "Ev / iş tel")}${fld("eposta", "E-posta")}${fld("fax", "Faks")}
        ${selF("smsOnay", "SMS bilgilendirme", ["Bəli", "Xeyr"])}${selF("mailOnay", "E-posta bilgilendirme", ["Bəli", "Xeyr"])}</div></div>
      <div class="box"><h5>Kurumsal</h5><div class="icd-form">
        ${selF("kurum", "Kurum / sigorta", secArr("kurum", ["İcbari Tibbi Sığorta (SAMHI)", "Özel ödeme", "Kurum anlaşması"]), p.kurum)}${fld("ozelSigorta", "Özel sigorta")}${fld("kurumSicil", "Kurum sicil no")}${fld("calistigiKurum", "Çalıştığı kurum")}
        ${fld("anlasmaliKurulus", "Anlaşmalı kuruluş")}${fld("indirimliGrup", "İndirimli grup")}${fld("personelIndirim", "Personel indirimi")}${fld("indirimSebep", "İndirim sebebi")}</div></div>
    </div>`;
    const placeholder = (ad) => `<div class="empty">${H.esc(ad)}</div>`;
    // Alt sekmeler için örnek veri (hastaya bir kez işlenir, kalıcı olur)
    const h3seed = () => {
      if (p._h3) return; p._h3 = true;
      const pr = p.proto || "50894026", tr = p.dob ? "" : "";
      const base = parseInt(String(pr).replace(/\D/g, ""), 10) || 50894026, pno = (off) => String(base - off);
      const kbols = (H.klinikBolumler ? H.klinikBolumler() : []), bn = (i) => (kbols[i % Math.max(1, kbols.length)] || { ad:"Daxili Xəstəliklər" }).ad;
      // Tek hasta kartı, altında çok sayıda protokol (geliş). Tarihe göre gruplu.
      p._protokoller = p._protokoller || [
        { no:String(base), tarih:"24.10.2026", bolum:(u && u.tr) || bn(0), doktor:(doctor && doctor.name) || "—", gelisTipi:"Acil", ptip:"Normal", kapali:false, bucket:"İki hafta önce" },
        { no:pno(1306), tarih:"09.10.2026", bolum:bn(1), doktor:"Dr. Elçin Şirinov", gelisTipi:"Ayaktan", ptip:"Acil muayene", kapali:true, bucket:"İki hafta önce" },
        { no:pno(5778), tarih:"24.09.2026", bolum:bn(2), doktor:"Dr. Rəvan İbrahimov", gelisTipi:"Ayaktan", ptip:"Normal", kapali:true, bucket:"Son ay" },
        { no:pno(48651), tarih:"14.08.2026", bolum:bn(3), doktor:"Dr. Məhərrəm Nəbiyev", gelisTipi:"Ayaktan", ptip:"Kontrol", kapali:true, bucket:"Daha eski" },
        { no:pno(65928), tarih:"28.07.2026", bolum:bn(4), doktor:"Dr. Cavanşir Vahabov", gelisTipi:"Yatarak", ptip:"Ameliyat", kapali:true, bucket:"Daha eski" },
      ];
      if (H.proto) H.proto.seedFrom(p.id, p._protokoller);   // demo protokolleri kalıcı depoya bir kez taşı
      p._fatura = p._fatura || [
        { proto:String(base), tarih:"24.10.2026", tip:"Satış faturası", cari:vzName(p.name), tur:"Hizmet", no:"FTR-" + pr, parent:"", durum:"Açık", pb:"₼", tutar:420, kdv:0 },
        { proto:String(base), tarih:"20.10.2026", tip:"Satış faturası", cari:vzName(p.name), tur:"Hizmet", no:"FTR-" + pno(7), parent:"", durum:"Ödendi", pb:"₼", tutar:180, kdv:0 },
        { proto:pno(5778), tarih:"24.09.2026", tip:"Satış faturası", cari:vzName(p.name), tur:"Hizmet", no:"FTR-" + pno(5780), parent:"", durum:"Ödendi", pb:"₼", tutar:95, kdv:0 },
      ];
      p._odeme = p._odeme || [
        { proto:String(base), tarih:"24.10.2026 10:12", sube:H.state.vezneBanko || "Mərkəz", kurumHasta:"Hasta", islem:"Tahsilat", sap:"—", odeme:"Kredi kartı", pb:"₼", kur:1, tutar:250 },
        { proto:String(base), tarih:"20.10.2026 14:40", sube:H.state.vezneBanko || "Mərkəz", kurumHasta:"Hasta", islem:"Avans", sap:"—", odeme:"Nakit", pb:"₼", kur:1, tutar:100 },
      ];
      p._indirim = p._indirim || [
        { proto:String(base), tarih:"24.10.2026", islem:"Hizmet indirimi", durum:"Onaylandı", onceki:420, oran:10, tutar:42, vezne:(H.state.user || {}).name || "—" },
      ];
      p._dosya = p._dosya || [
        { bag:"Protokol", grup:"Onam formları", bagId:pr, tip:"PDF", ad:"aydinlatilmis-onam.pdf", tarih:"24.10.2026" },
        { bag:"Hasta", grup:"Kimlik", bagId:p.fin || "", tip:"JPG", ad:"kimlik-on.jpg", tarih:"24.10.2026" },
      ];
      p._not = p._not || [
        { tarih:"24.10.2026 09:30", tip:"Bilgi", tur:"Protokol", ekleyen:(H.state.user || {}).name || "—", metin:"Hasta ödeme planı için bilgilendirildi." },
      ];
      p._teklif = p._teklif || [
        { no:"TKL-" + pr, tarih:"24.10.2026", ad:"Katarakt ameliyatı teklifi", ameliyat:true, aciklama:"Tek göz, standart lens", durum:"Bekliyor",
          hizmetler:[{ ad:"Fakoemülsifikasyon", hasta:1200, oss:1000, ak:1100, sgk:0, miktar:1, pb:"₼" }, { ad:"Göz içi lens", hasta:400, oss:350, ak:380, sgk:0, miktar:1, pb:"₼" }] },
      ];
      p._online = p._online || [{ tarih:"22.10.2026 13:20", kanal:"Web (kart)", tutar:"₼ 150", durum:"Başarılı", ref:"ONL-" + pr }];
      p._pos = p._pos || [{ tarih:"24.10.2026 10:12", terminal:"POS-01", kart:"**** 4721", tutar:"₼ 250", durum:"Onaylandı", ref:"POS-" + pr }];
      p._anlasma = p._anlasma || [{ kurum:p.kurum || "Özel ödeme", tip:"Kurum anlaşması", kullanim:"1 / 5", durum:"Aktif" }];
    };
    // Sağ-tık menü aksiyonları: her sekme için görseldeki menü maddeleri
    const SAGTIK = {
      faturalar:["Ödeme", "Ödeme listesi", "İptal", "İade", "Faturaya çevir", "Evrak durumu", "Düzenle (dönem/tarih/açıklama)", "İptalleri göster", "Provizyon"],
      odeme:["İptal", "İade", "Düzenle (dönem/cari/aktar/banka)", "Dosyalar", "İptalleri göster", "Katılım payı iade", "Fatura eşleştirme tarihçesi"],
      indirim:["İptal et", "Dosyalar", "Onay maili gönder", "İptalleri göster"],
      dosya:["İndir", "Döküman grubunu değiştir", "Dosya tipini değiştir"],
      notlar:["Tarihçe", "İptalleri göster"],
      teklif:["Fiyat verildi", "Değerlendirme", "Onayla", "Reddet", "İptal", "Tarihçe"],
      online:["Dekont", "İade", "İptal"],
      pos:["Dekont", "İade", "İptal", "Fatura eşleştir"],
      anlasma:["Detay", "Kullanım geçmişi"],
    };
    const tbar = (btns) => `<div class="r" style="gap:6px;margin-bottom:10px">${btns.map(b => `<button class="btn sm"${b[2] ? ` data-tbact="${b[2]}"` : ""}>${I(b[1]) || ""} ${b[0]}</button>`).join("")}<span class="spacer"></span><button class="btn sm" data-h3tblexp>${I("save") || ""} Excel</button><button class="btn sm" data-h3tblyaz>${I("print") || ""} Yazdır</button></div>`;
    const sagtikNote = (k) => `<p class="adm-sub" style="margin-top:8px">Satıra sağ tıklayın: ${SAGTIK[k].join(" · ")}.</p>`;
    const money = (n, pb) => (pb || "₼") + " " + (n || 0).toLocaleString("az");
    const selProto = params.proto || "tumu";
    const protoList = () => { const ps = (H.proto ? H.proto.list(p.id) : (p._protokoller || [])), buckets = {};
      ps.forEach(x => { const b = x.bucket || "Daha eski"; (buckets[b] = buckets[b] || []).push(x); });
      const order = [...PROTO_BUCKETS, ...Object.keys(buckets).filter(b => !PROTO_BUCKETS.includes(b))];
      const fatRozet = (x) => x.fatura && x.fatura.durum ? ` <span class="tag ${x.fatura.durum === "Ödendi" ? "ok" : ""}" style="font-size:10px">${H.esc(x.fatura.durum)}</span>` : "";
      const row = (x) => `<div class="h360-prow${selProto === x.no ? " on" : ""}" data-proto="${H.esc(x.no)}"><span class="pr-lock ${x.kapali ? "bad" : "ok"}" data-protolock="${H.esc(x.no)}" title="${x.kapali ? "Kapalı · açmak için tıkla" : "Açık · kapatmak için tıkla"}">${x.kapali ? (I("lock") || "") : (I("ok") || "")}</span><div><b class="mono">${H.esc(x.no)}</b>${fatRozet(x)}<div class="adm-sub" style="font-size:11px">${H.esc(x.tarih)} · ${H.esc(x.bolum)}</div></div></div>`;
      const newBtn = H.can("admission") ? `<button class="btn p sm" data-protonew title="Yeni protokol aç">${I("plus") || "+"}</button>` : "";
      return `<div class="h360-plist"><div class="h360-pbar">${I("refresh") || ""} Protokoller (${ps.length})<span class="spacer"></span>${newBtn}</div><div class="h360-prow${selProto === "tumu" ? " on" : ""}" data-proto="tumu"><b>TÜMÜ</b></div>${order.filter(b => buckets[b]).map(b => `<div class="h360-pgrp">${H.esc(b)}</div>${buckets[b].map(row).join("")}`).join("")}</div>`; };
    const split = (right) => `<div class="h360-2col">${protoList()}<div class="h360-pdetail">${right}</div></div>`;
    const byProto = (arr) => selProto === "tumu" ? arr : arr.filter(x => (x.proto || "") === selProto);
    const gelisHtml = () => `<div class="h360-cards">
      <div class="box"><h5>Geliş bilgileri</h5><div class="icd-form">
        ${fld("acilis", "Açılış", "", p.acilis || p.proto)}${fld("kapanis", "Kapanış")}${selF("gelisTipi", "Geliş tipi", ["İlk muayene", "Kontrol", "Acil", "Sevk"])}${selF("protokolTipi", "Protokol tipi", secArr("protokolTipi", ["Normal", "Ameliyat", "Preop", "Günübirlik"]))}
        ${fld("saglikMerkezi", "Sağlık merkezi")}${fld("tercihSebebi", "Tercih sebebi")}${fld("ozelDurum", "Özel durum")}${fld("dosyaNo", "Dosya no")}</div>
        <div style="margin-top:6px;display:flex;gap:14px;flex-wrap:wrap" class="adm-sub"><label class="dc-chk"><input type="checkbox" ${p.damarIzi ? "checked" : ""} disabled> Damar izi okutuldu</label><label class="dc-chk"><input type="checkbox" ${p.yeniDogan ? "checked" : ""} disabled> Yeni doğan</label><label class="dc-chk"><input type="checkbox" ${p.kdvMuaf ? "checked" : ""} disabled> KDV'den muaf</label></div></div>
      <div class="box"><h5>Hekim</h5><div class="icd-form">
        ${selF("gelisBolum", "Bölüm", (H.klinikBolumler ? H.klinikBolumler() : []).map(x => x.ad), (u && u.tr) || "")}${fld("gelisDoktor", "Doktor", "", doctor ? doctor.name : "")}${fld("misafirDoktor", "Misafir doktor")}</div>
        <div style="margin-top:6px;display:flex;gap:14px" class="adm-sub"><label class="dc-chk"><input type="checkbox" disabled> Nöbetçi doktor</label><label class="dc-chk"><input type="checkbox" disabled> Doktoru hasta seçti</label></div></div>
      <div class="box"><h5>Arşiv</h5><div class="icd-form">${selF("arsivDurum", "Durum", ["Arşivde", "Teslim edildi", "Beklemede"])}${fld("arsivTeslim", "Teslim alan")}${fld("arsivNo", "Arşiv no")}${fld("arsivTarih", "Teslim tarihi", "gg.aa.yyyy")}</div></div>
      <div class="box"><h5>Kurum</h5><div class="icd-form">${selF("kurumGelis", "Kurum / sigorta", secArr("kurum", ["İcbari Tibbi Sığorta (SAMHI)", "Özel ödeme", "Kurum anlaşması"]), p.kurum)}${fld("ossAk", "ÖSS / AK")}${selF("indirimKamp", "İndirim / kampanya", ["—", "Kampanya A", "Personel"])}${fld("sirket", "Şirket")}${fld("sigortaRef", "Sigorta referans no")}${selF("policeTuru", "Poliçe türü", ["—", "Tamamlayıcı", "Özel sağlık"])}</div></div>
      <div class="box"><h5>Takip</h5><div class="icd-form">${fld("basvuruNo", "Başvuru no")}${fld("takipNo", "Takip no")}${fld("takipTarih", "Takip tarihi", "gg.aa.yyyy")}${selF("takipTipi", "Takip tipi", ["Ayaktan", "Yatan", "Günübirlik"])}${selF("tedaviTuru", "Tedavi türü", ["Normal", "Ameliyat", "Kemoterapi", "Diyaliz"])}</div></div>
      <div class="box"><h5>Yurtdışı sigorta</h5><div class="icd-form">${fld("geldigiYer", "Geldiği yer")}${fld("otel", "Kaldığı otel")}${fld("odaNo", "Oda no")}${fld("acenta", "Seyahat acentası")}${fld("turOperator", "Tur operatörü")}</div></div>
      <div class="box"><h5>Yatış</h5><div class="icd-form">${fld("kat", "Kat", "", b ? b.kat : "")}${fld("yatakNo", "Yatak", "", b ? b.no : "")}${fld("taburcuKodu", "Taburcu kodu")}${fld("kabulT", "Kabul tarihi")}${fld("taburcuT", "Taburcu tarihi")}${fld("yatisGun", "Yatış gün", "", p.admitDays)}</div></div>
    </div>${tbar([["Durum", "edit"], ["Yatış", "bed"], ["Yazdır", "print"], ["Tüm gelişler", "link"]])}
    <div style="margin-top:4px"><button class="btn sm" data-h3git-gelis>${I("link") || ""} Tüm Gelişler ekranını aç</button></div>`;
    const tabloHtml = (k, cols, rows, btns, ids) => `${tbar(btns)}<div class="tw"><table class="t"><thead><tr>${cols.map(c => `<th>${H.esc(c)}</th>`).join("")}</tr></thead><tbody>
      ${rows.length ? rows.map((r, i) => `<tr data-ctx="${k}"${ids && ids[i] ? ` data-rid="${H.esc(ids[i])}"` : ""} style="cursor:context-menu">${r.map(c => `<td>${H.esc(String(c))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}" class="mute" style="padding:18px;text-align:center">Kayıt yok.</td></tr>`}
      </tbody></table></div>${sagtikNote(k)}`;
    // Zincir faturaları (İşlem Havuzu'nda kesilen) + demo faturalar birlikte; seçili protokole göre.
    const zincirFatura = () => (H.data.faturalar || []).filter(f => f.hasta === p.name && f.protokolNo && (selProto === "tumu" || f.protokolNo === selProto))
      .map(f => ({ tarih:f.tarih || (new Date().toLocaleDateString("az")), tip:"Satış faturası", cari:vzName(p.name), tur:"Hizmet", no:f.no || f.id, durum:f.durum, pb:"₼", tutar:f.toplam, kdv:0, proto:f.protokolNo }));
    const faturaHtml = () => { const zf = zincirFatura(), df = byProto(p._fatura);
      const rows = [...zf, ...df].map(x => [x.tarih, x.tip, x.cari, x.tur, x.no, x.durum, x.pb, x.tutar, x.kdv]);
      const ids = [...zf.map(x => "chain|" + x.no), ...df.map(x => "demo|" + x.no)];
      return tabloHtml("faturalar", ["Tarih", "Fatura tipi", "Cari", "Fatura türü", "Fatura no", "Durum", "Para b.", "Tutar", "KDV"], rows, [["Yenile", "refresh"], ["Yazdır", "print"], ["Omnitech faturalarını göster", "edit"]], ids); };
    const odemeHtml = () => tabloHtml("odeme", ["Tarih", "Şube", "Kurum/Hasta", "İşlem tipi", "SAP belge", "Ödeme tipi", "Para b.", "Kur", "Tutar"],
      byProto(p._odeme).map(x => [x.tarih, x.sube, x.kurumHasta, x.islem, x.sap, x.odeme, x.pb, x.kur, x.tutar]), [["Yenile", "refresh"], ["Avans", "plus", "avans"], ["Kurum avans", "plus", "kurumavans"], ["Katkı payı", "plus", "katkipayi"], ["İade talebi", "edit", "iadetalep"]], byProto(p._odeme).map(x => String(p._odeme.indexOf(x))));
    const indirimHtml = () => tabloHtml("indirim", ["Tarih", "İşlem tipi", "Durum", "İndirim öncesi", "Oran %", "Tutar", "Vezne"],
      byProto(p._indirim).map(x => [x.tarih, x.islem, x.durum, money(x.onceki), x.oran, money(x.tutar), x.vezne]), [["Yenile", "refresh"], ["Yazdır", "print"]], byProto(p._indirim).map(x => String(p._indirim.indexOf(x))));
    const DOSYA_TIP = ["Nüfus cüzdanı fotokopisi", "Pasaport", "Fotoğraf", "Fatura nüshası", "İrsaliye nüshası", "Test sonucu", "Reçete", "Sipariş nüshası", "Garanti belgesi", "Kalibrasyon sertifikası", "Kullanım kitapçığı", "Tıbbi form", "Radyoloji evrak", "Diğer"];
    const DOSYA_GRUP = ["Hasta dosyaları", "Onam formları", "Kimlik", "Protokol", "Fatura / mali", "Radyoloji", "Laboratuvar"];
    const DOSYA_BAG = ["Hasta", "Protokol", "Fatura", "Cihaz"];
    const dosyaHtml = () => `<div class="r" style="gap:6px;margin-bottom:10px"><button class="btn p sm" data-dosyaekle>${I("plus") || ""} Dosya ekle</button><button class="btn sm" data-dosyatara>${I("plus") || ""} Tarayıcıdan yükle</button><button class="btn sm" data-dosyaimza>${I("edit") || ""} Dijital imzadan getir</button><span class="spacer"></span><button class="btn sm" data-h3tblexp>${I("save") || ""} Excel</button><button class="btn sm" data-h3tblyaz>${I("print") || ""} Yazdır</button></div>
      <div class="tw"><table class="t"><thead><tr><th>Bağlantı tipi</th><th>Döküman grubu</th><th>Bağlantı id</th><th>Dosya tipi</th><th>Dosya adı</th><th>Kayıt tarihi</th><th style="width:44px"></th></tr></thead><tbody>
      ${p._dosya.length ? p._dosya.map((x, i) => `<tr><td>${H.esc(x.bag)}</td><td class="adm-sub">${H.esc(x.grup)}</td><td class="mono adm-sub">${H.esc(x.bagId || "—")}</td><td>${H.esc(x.tip)}</td><td><b>${H.esc(x.ad)}</b></td><td class="mono adm-sub">${H.esc(x.tarih)}</td><td><button class="btn g sm" data-dosyadel="${i}" title="Sil">${I("trash") || "×"}</button></td></tr>`).join("") : `<tr><td colspan="7" class="mute" style="padding:18px;text-align:center">Dosya yok. "Dosya ekle" ile ekleyin.</td></tr>`}
      </tbody></table></div><p class="adm-sub" style="margin-top:8px">Doküman tipi/grubu seçilerek hastaya belge eklenir. (Gerçek dosya yükleme/tarama ayrı ekip; burada kayıt tutulur.)</p>`;
    const notHtml = () => tabloHtml("notlar", ["Tarih", "Not tipi", "Not türü", "Ekleyen kullanıcı", "Not"],
      p._not.map(x => [x.tarih, x.tip, x.tur, x.ekleyen, x.metin]), [["Ekle", "plus"], ["Sil", "trash"]], p._not.map((_, i) => String(i)));
    const teklifHtml = () => { const t = p._teklif[0];
      return `<div class="seg" style="margin-bottom:10px"><button class="on">Ameliyat teklifleri</button><button>Tüm teklifler</button></div>
      ${tbar([["Yeni", "plus"], ["Teklif üzerinden oluştur", "edit"], ["Güncelle", "refresh"], ["Yazdır", "print"], ["İptal", "trash"]])}
      <div class="tw"><table class="t"><thead><tr><th>Teklif no</th><th>Tarih</th><th>Teklif adı</th><th>Açıklama</th><th>Durum</th></tr></thead><tbody>
      ${p._teklif.map(x => `<tr data-ctx="teklif" style="cursor:context-menu"><td class="mono adm-sub">${H.esc(x.no)}</td><td class="adm-sub">${H.esc(x.tarih)}</td><td><b>${H.esc(x.ad)}</b></td><td class="adm-sub">${H.esc(x.aciklama)}</td><td><span class="tag ${x.durum === "Onaylandı" ? "ok" : "w"}">${H.esc(x.durum)}</span></td></tr>`).join("")}
      </tbody></table></div>
      <h5 style="margin:14px 0 6px">Teklif hizmetleri — ${H.esc(t.ad)}</h5>
      <div class="tw"><table class="t"><thead><tr><th>Hizmet adı</th><th>Hasta fiyatı</th><th>ÖSS</th><th>AK</th><th>SGK</th><th>Miktar</th><th>Para b.</th></tr></thead><tbody>
      ${t.hizmetler.map(h => `<tr><td>${H.esc(h.ad)}</td><td>${money(h.hasta)}</td><td>${money(h.oss)}</td><td>${money(h.ak)}</td><td>${money(h.sgk)}</td><td class="n">${h.miktar}</td><td>${H.esc(h.pb)}</td>`).join("")}
      <tr><td><b>Toplam</b></td><td colspan="6"><b>${money(t.hizmetler.reduce((a, h) => a + h.hasta * h.miktar, 0))}</b></td></tr>
      </tbody></table></div>${sagtikNote("teklif")}`; };
    const drawBody = () => {
      h3seed();
      if (ana === "ishavuzu") {
        const ih = params.ihtab || "istek", ords = (H.data.orders || []).filter(o => o.pid === p.id);
        const IH = [["istek", "İstek Havuzu"], ["islem", "İşlem Havuzu"], ["provizyon", "Provizyon Takip"], ["randevu", "Randevular"], ["yatis", "Yatış İstekleri"], ["onam", "Onam Formları"], ["tetkik", "Tetkik Havuzu"], ["arsiv", "Arşiv"]];
        const seg = `<div class="seg" style="margin:4px 0 12px;flex-wrap:wrap">${IH.map(([k, l]) => `<button data-ih="${k}" class="${ih === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
        const T = (cols, rows, empty) => `<div class="tw"><table class="t"><thead><tr>${cols.map(c => `<th>${H.esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${H.esc(String(c))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}" class="mute" style="padding:16px;text-align:center">${H.esc(empty)}</td></tr>`}</tbody></table></div>`;
        let inner = "";
        if (ih === "istek") { const r = ords.filter(o => o.durum === "İstendi" || o.durum === "Bekliyor");
          const fy = (o) => (H.fiyatOf && o.kod) ? (+H.fiyatOf(o.kod, p.kurum || "Özel ödeme") || 0) : 0, top = r.reduce((a, o) => a + fy(o), 0);
          inner = `<div class="r" style="gap:6px;margin-bottom:8px"><button class="btn p sm" data-h3islem>İşlem havuzuna al</button><button class="btn sm" data-ihrand>Randevu ver</button><button class="btn sm" data-ihhazir>Hazırlık açıklaması</button></div>` + T(["İşlem tipi", "İşlem adı", "Resmi kod", "Miktar", "Tutar", "Tarih", "İsteyen"], r.map(o => [o.cat || "", o.ad || "", o.kod || "—", 1, fy(o) ? fy(o) + " ₼" : "—", o.at || "", o.by || ""]), "İstek yok. Doktor/vezne istem yapınca burada görünür.") + (r.length ? `<p class="adm-sub" style="margin-top:6px;text-align:right">Toplam istem tutarı: <b>${top.toFixed(2)} ₼</b> <span style="font-weight:400">(katalog fiyatı; faturada kurum/indirime göre kesinleşir)</span></p>` : ""); }
        else if (ih === "islem") { inner = `<p class="adm-sub" style="margin-bottom:8px">Hastanın faturalanacak işlemleri; tam ekranda fatura/indirim/provizyon.</p><button class="btn p" data-h3islem>${I("link") || ""} İşlem havuzunu aç</button>`; }
        else if (ih === "provizyon") { inner = T(["Protokol", "Kurum / sigorta", "Tutar", "Provizyon durumu"], [[p.proto || "—", p.kurum || "Özel ödeme", "—", "Beklemede"]], "Provizyon kaydı yok."); }
        else if (ih === "randevu") { const rs = (H.data.randevular || []).filter(r => r.hasta && vzName(r.hasta) === vzName(p.name)); inner = `<div class="r" style="gap:6px;margin-bottom:8px"><button class="btn sm" data-ihrand>Yeni randevu</button></div>` + T(["Tarih", "Bölüm", "Doktor", "Durum"], rs.map(r => [(r.tarih || "").replace("T", " "), r.bolum, r.doktor, r.durum]), "Randevu yok."); }
        else if (ih === "yatis") { inner = T(["Tarih", "Bölüm", "Yatak", "Durum"], b ? [[p.kabulT || "—", (u && u.tr) || "—", b.no, "Yatışta"]] : [], "Yatış isteği yok."); }
        else if (ih === "onam") { inner = `<div class="r" style="gap:6px;margin-bottom:8px"><button class="btn sm" data-ihonam>Onam formu ekle</button></div>` + T(["Form", "Tarih", "Durum"], (p._dosya || []).filter(d => d.grup === "Onam formları").map(d => [d.ad, d.tarih, "İmzalı"]), "Onam formu yok."); }
        else if (ih === "tetkik") { const r = ords.filter(o => /Laboratuvar|Radyoloji|Patoloji/.test(o.cat || "")); inner = T(["Tür", "Tetkik", "Resmi kod", "Tarih", "Durum"], r.map(o => [o.cat, o.ad, o.kod || "—", o.at || "", o.durum || "İstendi"]), "Tetkik yok."); }
        else { inner = T(["Protokol", "Tarih", "Arşiv no", "Durum"], [[p.proto || "—", "—", "—", "Arşivde"]], "Arşiv kaydı yok."); }
        body.innerHTML = seg + inner; return;
      }
      if (ana === "tedavi") {
        const tt = params.ttab || "muayene", ords = (H.data.orders || []).filter(o => o.pid === p.id);
        const TT = [["muayene", "Muayene / belgeler"], ["laboratuvar", "Laboratuvar"], ["radyoloji", "Radyoloji / görüntüleme"], ["patoloji", "Patoloji"], ["tanilar", "Tanılar (ICD)"], ["recete", "Reçete / ilaç"]];
        const seg = `<div class="seg" style="margin:4px 0 12px;flex-wrap:wrap">${TT.map(([k, l]) => `<button data-ttab="${k}" class="${tt === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
        const T = (cols, rows, empty) => `<div class="tw"><table class="t"><thead><tr>${cols.map(c => `<th>${H.esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${H.esc(String(c))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}" class="mute" style="padding:16px;text-align:center">${H.esc(empty)}</td></tr>`}</tbody></table></div>`;
        // Doktor istem düzenleme (yetki: protokol_duzenle) — tarih/doktor değiştirilebilir; genel istem tablosu
        const canProt = H.canAct("protokol_duzenle");
        const ordTable = (re, cols, empty, sonuc) => { const rows = (H.data.orders || []).map((o, gi) => [o, gi]).filter(([o]) => o.pid === p.id && re.test(o.cat || ""));
          const head = [cols[0], cols[1], "Protokol", ...cols.slice(2), ...(canProt ? ["Düzenle"] : [])];
          return `<div class="tw"><table class="t"><thead><tr>${head.map(c => `<th>${H.esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(([o, gi]) => { const cells = sonuc ? [o.ad, o.kod || "—", o.protokolNo || "—", o.at || "—", o.durum || "İstendi", o.sonuc || "—"] : [o.ad, o.kod || "—", o.protokolNo || "—", o.at || "—", o.durum || "İstendi"];
            return `<tr>${cells.map((c, i) => `<td${i > 1 ? ' class="n"' : ""}>${H.esc(String(c))}</td>`).join("")}${canProt ? `<td><button class="btn g sm" data-ordi="${gi}">${I("edit") || "Düzenle"}</button></td>` : ""}</tr>`; }).join("") : `<tr><td colspan="${head.length}" class="mute" style="padding:16px;text-align:center">${H.esc(empty)}</td></tr>`}</tbody></table></div>`; };
        if (tt === "muayene") {
          // Muayene = var olan zengin "Muayene notu" editoru (docs.js): Yakinma/Oyku/Ozgecmis/Soygecmis/fizik + detayli goz muayenesi/izlem-plan.
          // Imzalaninca Dokumanlar'a "Muayene belgesi" olarak duser. Istem icin kisayol ustte.
          const canOrd0 = H.can("orders") || H.can("results");
          body.innerHTML = seg + (canOrd0 ? `<div class="r" style="margin-bottom:8px"><button class="btn sm" data-mkistem>${I("flask") || ""} İstem yap</button></div>` : "") + `<div data-docswrap>${H.docs ? H.docs.html(p) : `<div class="empty">Klinik doküman modülü yüklenmedi.</div>`}</div>`;
          const ib0 = body.querySelector("[data-mkistem]"); if (ib0) ib0.onclick = () => istemModal(p);
          if (H.docs && H.docs.after) try { H.docs.after(body.querySelector("[data-docswrap]"), p); } catch (e) {}
          return;
        }
        if (tt === "dokuman") { body.innerHTML = seg + `<div data-docswrap>${H.docs ? H.docs.html(p) : `<div class="empty">Klinik döküman modülü yok.</div>`}</div>`; if (H.docs && H.docs.after) try { H.docs.after(body.querySelector("[data-docswrap]"), p); } catch (e) {} return; }
        if (tt === "laboratuvar") { body.innerHTML = seg + ordTable(/Laboratuvar|Lab/i, ["Tetkik", "Kod", "Tarih", "Durum", "Sonuç"], "Laboratuvar istemi yok. Doktor istem yapınca burada görünür.", true); return; }
        if (tt === "radyoloji") { body.innerHTML = seg + ordTable(/Radyoloji|Görüntüleme/i, ["Tetkik", "Kod", "Tarih", "Durum", "Sonuç"], "Radyoloji / görüntüleme istemi yok.", true); return; }
        if (tt === "patoloji") { body.innerHTML = seg + ordTable(/Patoloji/i, ["Tetkik", "Kod", "Tarih", "Durum", "Sonuç"], "Patoloji istemi yok.", true); return; }
        if (tt === "recete") { body.innerHTML = seg + `<div class="r" style="margin-bottom:8px">${(H.can("orders") || H.can("results")) ? `<button class="btn p sm" data-receteyap>${I("pill") || ""} Reçete / ilaç istemi yap</button>` : ""}</div>` + ordTable(/İlaç|Reçete|ilac/i, ["İlaç", "Kod", "Tarih", "Durum"], "Reçete / ilaç istemi yok. Klinik personel 'Reçete / ilaç istemi yap' ile ekler.", false); const rb = body.querySelector("[data-receteyap]"); if (rb) rb.onclick = () => istemModal(p); return; }
        // tanilar (ICD) — hastanın tanı listesi; ICD katalogundan ara-ekle
        p._tanilar = p._tanilar || (p.dx ? [{ kod:"", ad:p.dx, tip:"Ön tanı" }] : []);
        const TAN_TIP = ["Ön tanı", "Kesin tanı", "Ayırıcı tanı"];
        body.innerHTML = seg + `<div class="rc-add" style="margin-bottom:10px;gap:6px;flex-wrap:wrap"><div class="amel-cb" style="flex:1;min-width:240px"><input data-tanq placeholder="Tanı ara (ICD kod / ad)" autocomplete="off"><div class="amel-dd hidden" data-tandd></div></div>
          <select data-tantip>${TAN_TIP.map(x => `<option>${x}</option>`).join("")}</select><button class="btn p sm" data-tanekle>Ekle</button></div>
          <div class="tw"><table class="t"><thead><tr><th style="width:90px">Kod</th><th>Tanı</th><th style="width:120px">Tip</th><th style="width:44px"></th></tr></thead><tbody>
          ${p._tanilar.length ? p._tanilar.map((t, i) => `<tr><td class="mono adm-sub">${H.esc(t.kod || "—")}</td><td><b>${H.esc(t.ad)}</b></td><td class="adm-sub">${H.esc(t.tip || "")}</td><td><button class="btn g sm" data-tandel="${i}">${I("x") || "×"}</button></td></tr>`).join("") : `<tr><td colspan="4" class="mute" style="padding:16px;text-align:center">Tanı yok. Yukarıdan ICD katalogundan ekleyin.</td></tr>`}</tbody></table></div>
          <p class="adm-sub" style="margin-top:8px">Tanılar ICD-10 katalogundan seçilir; muayene dökümanına ve protokole işlenir. Ana tanı ve taraf tipi muayene ekranında belirlenir.</p>`;
        const tq = body.querySelector("[data-tanq]"), tdd = body.querySelector("[data-tandd]");
        const showT = () => { const q = (tq.value || "").trim().toLocaleLowerCase("tr"); const hits = (H.ICD || []).filter(r => !q || (r[0] + " " + r[1]).toLocaleLowerCase("tr").includes(q)).slice(0, 40);
          tdd.innerHTML = hits.length ? hits.map(r => `<div class="amel-opt" data-ic="${H.esc(r[0])}" data-ia="${H.esc(r[1])}"><b>${H.esc(r[1])}</b> <span class="mono adm-sub">${H.esc(r[0])}</span></div>`).join("") : `<div class="amel-opt mute">Eşleşen tanı yok</div>`; tdd.classList.remove("hidden"); };
        tq.oninput = showT; tq.onfocus = showT;
        tdd.onclick = (ev) => { const o = ev.target.closest("[data-ic]"); if (!o) return; tq.value = o.dataset.ia; tq.dataset.kod = o.dataset.ic; tdd.classList.add("hidden"); };
        document.addEventListener("click", (ev) => { const cb = body.querySelector(".amel-cb"); if (cb && !cb.contains(ev.target)) tdd.classList.add("hidden"); });
        body.querySelector("[data-tanekle]").onclick = () => { const ad = (tq.value || "").trim(); if (!ad) { H.toast("Tanı seçin ya da yazın.", "w"); return; }
          p._tanilar.push({ kod:tq.dataset.kod || "", ad, tip:body.querySelector("[data-tantip]").value }); if (!p.dx) p.dx = ad; H.log("Tanı eklendi", vzName(p.name) + " · " + ad); H.go("hasta360", { pid:p.id, atab:"tedavi", ttab:"tanilar" }); };
        body.querySelector("tbody").addEventListener("click", (ev) => { const d = ev.target.closest("[data-tandel]"); if (d) { p._tanilar.splice(+d.dataset.tandel, 1); H.go("hasta360", { pid:p.id, atab:"tedavi", ttab:"tanilar" }); } });
        return;
      }
      if (ana === "arsiv") { const ords = (H.data.orders || []).filter(o => o.pid === p.id);
        body.innerHTML = `<p class="adm-sub" style="margin-top:0">Aktarım protokolleri ve işlemleri — başka protokolden bu hastaya aktarılan kayıtlar.</p>
          <div class="tw"><table class="t"><thead><tr><th>Protokol</th><th>Tarih</th><th>Bölüm</th><th>İşlem</th><th>Durum</th></tr></thead><tbody>${ords.length ? ords.slice(0, 20).map(o => `<tr><td class="mono adm-sub">${H.esc(p.proto || "—")}</td><td class="adm-sub">${H.esc(o.at || "—")}</td><td class="adm-sub">${H.esc(o.cat || "—")}</td><td>${H.esc(o.ad || "—")}</td><td><span class="tag">${H.esc(o.durum || "—")}</span></td></tr>`).join("") : `<tr><td colspan="5" class="mute" style="padding:16px;text-align:center">Aktarım kaydı yok.</td></tr>`}</tbody></table></div>`;
        return; }
      // ana === 360
      if (alt === "kart") { body.innerHTML = kartHtml(); return; }
      if (alt === "gelisler") { body.innerHTML = split(gelisHtml()); return; }
      if (alt === "faturalar") { body.innerHTML = split(faturaHtml()); return; }
      if (alt === "odeme") { body.innerHTML = split(odemeHtml()); return; }
      if (alt === "indirim") { body.innerHTML = split(indirimHtml()); return; }
      if (alt === "dosya") { body.innerHTML = split(dosyaHtml()); return; }
      if (alt === "notlar") { body.innerHTML = split(notHtml()); return; }
      if (alt === "teklif") { body.innerHTML = teklifHtml(); return; }
      if (alt === "online") { body.innerHTML = tabloHtml("online", ["Tarih", "Kanal", "Tutar", "Durum", "Referans"], p._online.map(x => [x.tarih, x.kanal, x.tutar, x.durum, x.ref]), [["Yenile", "refresh"]], p._online.map((_, i) => String(i))); return; }
      if (alt === "pos") { body.innerHTML = tabloHtml("pos", ["Tarih", "Terminal", "Kart", "Tutar", "Durum", "Referans"], p._pos.map(x => [x.tarih, x.terminal, x.kart, x.tutar, x.durum, x.ref]), [["Yenile", "refresh"]], p._pos.map((_, i) => String(i))); return; }
      if (alt === "anlasma") { body.innerHTML = tabloHtml("anlasma", ["Kurum", "Anlaşma tipi", "Kullanım", "Durum"], p._anlasma.map(x => [x.kurum, x.tip, x.kullanim, x.durum]), [["Yenile", "refresh"]]); return; }
      body.innerHTML = placeholder(H360_ALT.find(x => x[0] === alt)[1]);
    };
    drawBody();
    function istemModal(p) {
      H.modal({ title:"İstem · " + H.esc(vzName(p.name)), wide:true,
        body:`<div data-istemwrap>${H.orders ? H.orders.html(p) : `<div class="empty">İstem modülü yüklenmedi.</div>`}</div>`,
        actions:`<button class="btn" data-x>Kapat</button>`,
        onMount(m) { if (H.orders && H.orders.after) { try { H.orders.after(m.querySelector("[data-istemwrap]"), p); } catch (e) {} } } });
    }
    function protoNewModal() {
      const bols = H.klinikBolumler ? H.klinikBolumler() : (H.data.bolumler || []);
      const docs = (H.data.users || []).filter(u => u.role === "hekim");
      const ptipler = (H.data.secenekler && H.data.secenekler.protokol) || ["Genel muayene", "Kontrol", "Preop"];
      H.modal({ title:"Yeni protokol · " + H.esc(vzName(p.name)), body:`<div class="icd-form">
          <div class="fr"><label>Bölüm</label><input data-f="bolum" list="pn-bol" value="${H.esc((u && u.tr) || "")}"><datalist id="pn-bol">${bols.map(b => `<option>${H.esc(b.ad)}</option>`).join("")}</datalist></div>
          <div class="fr"><label>Doktor</label><select data-f="doktor"><option value="">—</option>${docs.map(d => `<option${doctor && doctor.name === d.name ? " selected" : ""}>${H.esc(d.name)}</option>`).join("")}</select></div>
          <div class="fr"><label>Geliş tipi</label><select data-f="gelis">${["Ayaktan", "Acil", "Günübirlik", "Yatarak", "Kontrol"].map(x => `<option>${x}</option>`).join("")}</select></div>
          <div class="fr"><label>Protokol tipi</label><select data-f="ptip">${ptipler.map(x => `<option>${H.esc(x)}</option>`).join("")}</select></div></div>
          <p class="adm-sub" style="margin-top:6px">Yeni protokol numarası otomatik üretilir; hasta kartına kalıcı eklenir.</p>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Protokol aç</button>`,
        onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = s => (m.querySelector(`[data-f="${s}"]`).value || "").trim();
          const rec = H.proto.create(p.id, { bolum:g("bolum") || ((u && u.tr) || "—"), doktor:m.querySelector('[data-f="doktor"]').value || "—", gelisTipi:m.querySelector('[data-f="gelis"]').value, ptip:m.querySelector('[data-f="ptip"]').value });
          H.log("Protokol açıldı", vzName(p.name) + " · " + rec.no); H.closeModal(); H.toast("Protokol açıldı: " + rec.no);
          H.go("hasta360", { pid:p.id, atab:params.atab || "360", stab:params.stab || "gelisler", proto:rec.no }); }; } });
    }
    function onayModal(tur) {
      const kvkk = tur === "kvkk", ad = kvkk ? "KVKK / Kişisel veri onayı" : "Ticari elektronik ileti (ETK) onayı";
      const metin = kvkk ? "Hastanın kişisel ve sağlık verilerinin tedavi ve yasal yükümlülükler için işlenmesine dair aydınlatma onayı." : "Hastaya randevu, kampanya ve bilgilendirme amaçlı SMS/e-posta gönderilmesine izin.";
      const mevcut = kvkk ? p.kvkk : p.etk, tel = p.phone || "—", mail = p.eposta || "—";
      H.modal({ title:ad, body:`<p class="adm-sub" style="margin:0 0 10px">${H.esc(metin)}</p>
        <div class="h360-meta" style="margin-bottom:12px"><div><span>Mevcut durum</span><b>${mevcut ? "Onaylı" : "Onay yok"}</b></div><div><span>Mobil</span><b>${H.esc(tel)}</b></div><div><span>E-posta</span><b>${H.esc(mail)}</b></div></div>
        <div class="r" style="gap:8px;flex-wrap:wrap"><button class="btn sm" data-osms>${I("bell") || ""} SMS ile onay linki gönder</button><button class="btn sm" data-omail>${I("bell") || ""} E-posta ile gönder</button></div>`,
        actions:`<button class="btn" data-x>Kapat</button>${mevcut ? `<button class="btn g" data-okaldir>Onayı kaldır</button>` : `<button class="btn p" data-oonay>Onayı işaretle</button>`}`,
        onMount(m) {
          const sms = m.querySelector("[data-osms]"); if (sms) sms.onclick = () => H.toast("Onay linki SMS ile gönderildi: " + tel);
          const ml = m.querySelector("[data-omail]"); if (ml) ml.onclick = () => H.toast("Onay e-postası gönderildi: " + mail);
          const on = m.querySelector("[data-oonay]"); if (on) on.onclick = () => { if (kvkk) p.kvkk = true; else p.etk = true; H.log(ad, vzName(p.name) + " · onaylandı"); H.toast(ad + ": alındı"); H.closeModal(); H.go("hasta360", { pid:p.id, atab:ana, stab:alt }); };
          const kal = m.querySelector("[data-okaldir]"); if (kal) kal.onclick = () => { if (kvkk) p.kvkk = false; else p.etk = false; H.toast(ad + ": kaldırıldı", "w"); H.closeModal(); H.go("hasta360", { pid:p.id, atab:ana, stab:alt }); };
        } });
    }
    // Faturalar sağ-tık: gerçek aksiyonlar (Ödeme / İptal / İade / Yazdır) o satıra etki eder (Ozan kararı: gerçek yap).
    function faturaMenu(e, rid) {
      const [src, no] = rid.split("|"); const f = src === "chain" ? (H.data.faturalar || []).find(y => y.no === no) : (p._fatura || []).find(y => y.no === no);
      if (!f) { H.toast("Fatura bulunamadı.", "e"); return; }
      const tutar = f.tutar != null ? f.tutar : (f.katilim || 0), reDraw = () => H.go("hasta360", { pid:p.id, atab:ana, stab:"faturalar", proto:params.proto });
      vzMenu(e, [
        ["Ödeme (tahsil et)", () => { if (f.durum === "Ödendi") { H.toast("Zaten ödendi.", "w"); return; } f.durum = "Ödendi"; f.odenen = tutar; H.saveData && H.saveData(); H.log("Tahsilat (hasta dosyası)", p.name + " · " + no); H.toast("Ödendi: " + no); reDraw(); }],
        ["Fatura iptal", () => { if (!H.canAct("fatura_iptal")) { H.toast("Yetkiniz yok (fatura_iptal).", "e"); return; } f.durum = "İptal"; H.saveData && H.saveData(); H.log("Fatura iptal", p.name + " · " + no); H.toast("Fatura iptal: " + no, "w"); reDraw(); }],
        ["İade talebi oluştur", () => { (H.data.iadeTalep = iadeRows()).unshift({ id:"ia" + Date.now(), tip:"Fatura İade", tarih:H.nowFull ? H.nowFull() : H.now(), eden:p.name, tutar, dep:"Protokolden", aciklama:"Fatura iadesi · " + no, durum:"Onay bekliyor", proto:f.proto || f.protokolNo || p.proto, zincir:zinc([["Vezne", (H.state.user || {}).name || "Vezne"], ["Mali İşler", "Ülvi İsgenderov"]]) }); H.saveData && H.saveData(); H.log("İade talebi", p.name + " · " + no); H.toast("İade talebi oluşturuldu (onay bekliyor)."); }],
        ["Yazdır", () => H.printTable ? H.printTable("Fatura · " + no, ["Alan", "Değer"], [["Fatura no", no], ["Tarih", f.tarih || ""], ["Durum", f.durum || ""], ["Tutar", tutar + " ₼"]]) : H.toast("Yazdırma yok", "w")],
      ]);
    }
    // Ödeme/İndirim/Not/Online/POS sağ-tık: satıra etki eden gerçek aksiyonlar.
    const ROW_FIELD = { odeme:"_odeme", indirim:"_indirim", notlar:"_not", online:"_online", pos:"_pos" };
    function rowMenu(e, ctx, idx) {
      const arr = p[ROW_FIELD[ctx]] || [], it = arr[+idx]; if (!it) { H.toast("Kayıt bulunamadı.", "e"); return; }
      const reDraw = () => H.go("hasta360", { pid:p.id, atab:ana, stab:alt, proto:params.proto });
      const num = (v) => +String(v == null ? 0 : v).replace(/[^\d.,-]/g, "").replace(",", ".") || 0;
      const act = (label) => () => {
        if (/^İptal et$|^İptal$/.test(label)) { if (ctx === "notlar" || ctx === "indirim") arr.splice(+idx, 1); else it.durum = "İptal"; H.saveData && H.saveData(); H.log(label, ctx); H.toast(label + " yapıldı", "w"); reDraw(); return; }
        if (label === "Sil") { arr.splice(+idx, 1); H.saveData && H.saveData(); H.toast("Silindi", "w"); reDraw(); return; }
        if (label === "İade" || label === "İade talebi") { (H.data.iadeTalep = iadeRows()).unshift({ id:"ia" + Date.now(), tip:(ctx === "online" || ctx === "pos") ? "Avans İade" : "Fatura İade", tarih:H.nowFull ? H.nowFull() : H.now(), eden:p.name, tutar:num(it.tutar), dep:"Protokolden", aciklama:label + " · " + ctx, durum:"Onay bekliyor", proto:it.proto || p.proto, zincir:zinc([["Vezne", (H.state.user || {}).name || "Vezne"], ["Mali İşler", "Ülvi İsgenderov"]]) }); H.saveData && H.saveData(); H.log("İade talebi", ctx); H.toast("İade talebi oluşturuldu (onay bekliyor)."); return; }
        if (label === "Dekont" || /Yazdır|Karekod/.test(label)) { if (H.printTable) H.printTable((label === "Dekont" ? "Dekont" : "Çıktı") + " · " + vzName(p.name), ["Alan", "Değer"], Object.entries(it).slice(0, 12).map(([k, v]) => [k, String(v)])); return; }
        H.toast(label + " işaretlendi"); // bilgi amaçlı (tarihçe, iptalleri göster, dosyalar, kurum avans…)
      };
      vzMenu(e, SAGTIK[ctx].map(l => [l, act(l)]));
    }
    root.oncontextmenu = (e) => { const tr = e.target.closest("[data-ctx]"); if (!tr || !SAGTIK[tr.dataset.ctx]) return;
      e.preventDefault(); const ctx = tr.dataset.ctx;
      if (ctx === "faturalar" && tr.dataset.rid) return faturaMenu(e, tr.dataset.rid);
      if (ROW_FIELD[ctx] && tr.dataset.rid != null) return rowMenu(e, ctx, tr.dataset.rid);
      vzMenu(e, SAGTIK[ctx].map(a => [a, () => H.toast(a + " · bu işlem Vezne ekranından yapılır", "w")])); };
    // Ödemeler sekmesi aksiyonları (video 2): Avans / Kurum avans / Katkı payı / İade talebi.
    function odemeAction(act, p) {
      const now = H.nowFull ? H.nowFull() : new Date().toLocaleString("az"), sube = H.state.vezneBanko || "Mərkəz";
      const reRender = () => H.go("hasta360", { pid:p.id, atab:"360", stab:"odeme", proto:params.proto });
      if (act === "iadetalep") {
        H.modal({ title:"İade talebi · " + H.esc(vzName(p.name)), body:`<div class="icd-form">
          <div class="fr"><label>Tip</label><select data-f="tip"><option>Avans İade</option><option>Fatura İade</option></select></div>
          <div class="fr"><label>Tutar ₼</label><input type="number" data-f="tutar" placeholder="0"></div>
          <div class="fr"><label>Departman</label><select data-f="dep">${["Genel İade", "Vezne İade", "Kurum İade"].map(d => `<option>${d}</option>`).join("")}</select></div>
          <div class="fr" style="grid-column:1/-1"><label>Açıklama</label><input data-f="acik" placeholder="iade nedeni"></div></div>
          <p class="adm-sub" style="margin-top:6px">Talep, "Onay bekleyen iadeler" ekranına düşer; yetkili rol onaylar.</p>`,
          actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Talep oluştur</button>`,
          onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = k => (m.querySelector(`[data-f="${k}"]`).value || "").trim(); const tutar = +g("tutar") || 0; if (!tutar) { H.toast("Tutar girin.", "w"); return; }
            (H.data.iadeTalep = H.data.iadeTalep || []).unshift({ id:"ia" + Date.now(), tip:m.querySelector('[data-f="tip"]').value, tarih:now, eden:p.name, tutar, dep:m.querySelector('[data-f="dep"]').value, aciklama:g("acik"), durum:"Onay bekliyor", proto:p.proto || "—", zincir:zinc([["Vezne", (H.state.user || {}).name || "Vezne"], ["Mali İşler", "—"]]) });
            H.saveData && H.saveData(); H.log("İade talebi", p.name + " · " + tutar + " ₼"); H.toast("İade talebi oluşturuldu · onaya düştü"); H.closeModal(); reRender(); }; } });
        return;
      }
      const titleMap = { avans:"Avans al", kurumavans:"Kurum avansı al", katkipayi:"Katkı payı tahsil" }, islemMap = { avans:"Avans", kurumavans:"Avans (kurum)", katkipayi:"Katkı payı" }, kh = act === "kurumavans" ? "Kurum" : "Hasta";
      H.modal({ title:(titleMap[act] || "İşlem") + " · " + H.esc(vzName(p.name)), body:`<div class="icd-form">
        <div class="fr"><label>Tutar ₼</label><input type="number" data-f="tutar" placeholder="0"></div>
        <div class="fr"><label>Ödeme tipi</label><select data-f="odeme">${["Nakit", "Kredi kartı", "Havale/EFT"].map(o => `<option>${o}</option>`).join("")}</select></div>
        <div class="fr" style="grid-column:1/-1"><label>Açıklama</label><input data-f="acik" placeholder="ops."></div></div>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Kaydet</button>`,
        onMount(m) { m.querySelector("[data-ok]").onclick = () => { const tutar = +(m.querySelector('[data-f="tutar"]').value) || 0; if (!tutar) { H.toast("Tutar girin.", "w"); return; }
          (p._odeme = p._odeme || []).unshift({ proto:p.proto || "—", tarih:now, sube, kurumHasta:kh, islem:islemMap[act], sap:"—", odeme:m.querySelector('[data-f="odeme"]').value, pb:"₼", kur:1, tutar });
          H.saveData && H.saveData(); H.log(titleMap[act], p.name + " · " + tutar + " ₼"); H.toast(titleMap[act] + ": " + tutar + " ₼"); H.closeModal(); reRender(); }; } });
    }
    root.onclick = (e) => {
      const tbact = e.target.closest("[data-tbact]"); if (tbact) { odemeAction(tbact.dataset.tbact, p); return; }
      const tex = e.target.closest("[data-h3tblexp],[data-h3tblyaz]"); if (tex) { const tw = tex.closest(".r") && tex.closest(".r").nextElementSibling, tbl = tw && tw.querySelector("table.t");
        if (!tbl || !tbl.tHead) { H.toast("Bu sekmede aktarılacak tablo yok.", "w"); return; }
        const cols = [...tbl.tHead.rows[0].cells].map(c => c.textContent.replace(/\s+/g, " ").trim()); while (cols.length && cols[cols.length - 1] === "") cols.pop();
        const rows = [...(tbl.tBodies[0] ? tbl.tBodies[0].rows : [])].filter(r => !r.cells[0] || !r.cells[0].hasAttribute("colspan")).map(r => [...r.cells].slice(0, cols.length).map(c => c.textContent.replace(/\s+/g, " ").trim()));
        const ttl = ((H360_ALT.find(x => x[0] === alt) || [, "Liste"])[1]) + " · " + vzName(p.name);
        if (e.target.closest("[data-h3tblexp]")) { H.exportCsv && H.exportCsv("Hasta_" + alt, cols, rows); H.toast("Excel (CSV) indirildi"); } else { H.printTable && H.printTable(ttl, cols, rows); }
        return; }
      const an = e.target.closest("[data-h3ana]"); if (an) return H.go("hasta360", { pid:p.id, atab:an.dataset.h3ana, stab:"kart" });
      const al = e.target.closest("[data-h3alt]"); if (al) return H.go("hasta360", { pid:p.id, atab:"360", stab:al.dataset.h3alt });
      if (e.target.closest("[data-protonew]")) { if (!H.can("admission")) { H.toast("Protokol açma yetkiniz yok.", "e"); return; } protoNewModal(); return; }
      const pl = e.target.closest("[data-protolock]"); if (pl) { const no = pl.dataset.protolock, r = H.proto && H.proto.get(p.id, no); if (!r) return;
        const acarak = r.kapali, perm = acarak ? "protokol_duzenle" : "admission";
        if (!H.canAct(perm)) { H.toast("Yetkiniz yok (" + perm + ").", "e"); return; }
        H.proto.setOpen(p.id, no, acarak); H.log(acarak ? "Protokol yeniden açıldı" : "Protokol kapatıldı", vzName(p.name) + " · " + no); H.toast(acarak ? "Protokol açıldı: " + no : "Protokol kapatıldı: " + no, acarak ? "" : "w");
        return H.go("hasta360", { pid:p.id, atab:params.atab || "360", stab:params.stab || alt, proto:params.proto || "tumu" }); }
      const pp = e.target.closest("[data-proto]"); if (pp) return H.go("hasta360", { pid:p.id, atab:"360", stab:alt, proto:pp.dataset.proto });
      const kb = e.target.closest("[data-h3kabul]"); if (kb) { root.querySelector("[data-h3kabulm]").classList.toggle("hidden"); return; }
      const dg = e.target.closest("[data-h3diger]"); if (dg) { root.querySelector("[data-h3digerm]").classList.toggle("hidden"); return; }
      const ka = e.target.closest("[data-kabul]"); if (ka) { root.querySelector("[data-h3kabulm]").classList.add("hidden");
        const att = H.userBy(p.attending); return H.kabulForm(p, { gelis:KABUL_GELIS[ka.dataset.kabul] || "Ayaktan", bolum:(u && u.tr) || "", doktor:(att && att.name) || "" }); }
      const di = e.target.closest("[data-diger]"); if (di) { const ad = di.dataset.diger; root.querySelector("[data-h3digerm]").classList.add("hidden");
        if (ad === "Kullanılan steril setler") { const list = H.sterSetsOfPatient ? H.sterSetsOfPatient(p.id) : [];
          H.modal({ title:"Kullanılan steril setler · " + H.esc(vzName(p.name)), wide:true,
            body:`<p class="adm-sub" style="margin:0 0 8px">Bu hastaya teslim edilen / kullanılan steril setler (Sterilizasyon modülünden gelir).</p>
              <div class="tw"><table class="t"><thead><tr><th>Set no</th><th>Set</th><th>Aşama</th><th>Vaka</th><th>Döngü no</th><th>Teslim alan</th></tr></thead><tbody>
              ${list.length ? list.map(s => `<tr><td class="mono"><b>${H.esc(s.no)}</b></td><td>${H.esc(s.ad)}</td><td>${H.esc(s.asama)}</td><td class="adm-sub">${H.esc(s.vaka || "—")}</td><td class="adm-sub">${H.esc((s.otoklav && s.otoklav.no) || "—")}</td><td class="adm-sub">${H.esc(s.teslimAlan || "—")}</td></tr>`).join("") : `<tr><td colspan="6" class="mute" style="padding:16px;text-align:center">Bu hastaya kayıtlı steril set yok. (Sterilizasyon → vaka arabası / teslim ile hastaya bağlanır.)</td></tr>`}
              </tbody></table></div>`,
            actions:`<button class="btn" data-x>Kapat</button>${list.length ? `<button class="btn" data-sgit>Sterilizasyon modülü</button>` : ""}`,
            onMount(m) { const g = m.querySelector("[data-sgit]"); if (g) g.onclick = () => { H.closeModal(); H.go("sterilizasyon", { tab:"pano" }); }; } }); return; }
        const hb = (H.data.hastaBilgi = H.data.hastaBilgi || {}), cur = (hb[p.id] = hb[p.id] || {}), val = ad === "Hasta uyarısı" ? (cur.uyari || "") : ((cur.diger || {})[ad] || "");
        H.modal({ title:ad, body:`<p class="adm-sub" style="margin:0 0 10px">${H.esc(ad)} — ${H.esc(vzName(p.name))}</p><div class="icd-form"><div class="fr"><label>Açıklama / not</label><input data-diginp value="${H.esc(val)}" placeholder="${H.esc(ad)} bilgisi"></div></div><p class="adm-sub" style="margin-top:8px">${ad === "Hasta uyarısı" ? "Uyarı, hasta kartının üstünde kırmızı şeritte görünür." : "Bu ek bilgi hastaya bağlı olarak tutulur."}</p>`,
          actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-digsave>Kaydet</button>`,
          onMount(m) { m.querySelector("[data-digsave]").onclick = () => { const v = (m.querySelector("[data-diginp]").value || "").trim(); if (ad === "Hasta uyarısı") cur.uyari = v; else { cur.diger = cur.diger || {}; cur.diger[ad] = v; } H.saveData && H.saveData(); H.log(ad + " kaydedildi", vzName(p.name)); H.closeModal(); H.toast(ad + " kaydedildi"); H.go("hasta360", { pid:p.id, atab:ana, stab:alt, proto:params.proto }); }; } }); return; }
      if (e.target.closest("[data-h3kvkk]")) { onayModal("kvkk"); return; }
      if (e.target.closest("[data-h3etk]")) { onayModal("etk"); return; }
      if (e.target.closest("[data-h3must]")) { H.toast("Müstehaklık/provizyon sorgusu gönderildi"); return; }
      if (e.target.closest("[data-h3yaz]")) { if (H.printTable) H.printTable("Hasta kartı · " + vzName(p.name), ["Alan", "Değer"], [["Hasta no", p.hn || "—"], ["FİN", p.fin || "—"], ["Protokol", p.proto || "—"], ["Tanı", p.dx || "—"], ["Kurum", p.kurum || "—"]]); else H.toast("Yazdırma yok", "w"); return; }
      if (e.target.closest("[data-h3git-gelis]")) return H.go("gelisler");
      const ihb = e.target.closest("[data-ih]"); if (ihb) return H.go("hasta360", { pid:p.id, atab:"ishavuzu", ihtab:ihb.dataset.ih });
      const ttb = e.target.closest("[data-ttab]"); if (ttb) return H.go("hasta360", { pid:p.id, atab:"tedavi", ttab:ttb.dataset.ttab });
      const ordi = e.target.closest("[data-ordi]"); if (ordi) { if (!H.canAct("protokol_duzenle")) { H.toast("Protokol/istem düzenleme yetkiniz yok.", "e"); return; }
        const o = (H.data.orders || [])[+ordi.dataset.ordi]; if (!o) return; const docs = (H.data.users || []).filter(u => u.role === "hekim");
        H.modal({ title:"İstem düzenle · " + H.esc(o.ad || ""), body:`<div class="icd-form">
            <div class="fr"><label>İşlem</label><input value="${H.esc(o.ad || "")}" readonly></div>
            <div class="fr"><label>Tarih</label><input data-f="at" value="${H.esc(o.at || "")}" placeholder="GG.AA.YYYY SS:DD"></div>
            <div class="fr"><label>İsteyen doktor</label><select data-f="by"><option value="">—</option>${docs.map(u => `<option${(o.by === u.name) ? " selected" : ""}>${H.esc(u.name)}</option>`).join("")}</select></div>
            <div class="fr"><label>Durum</label><select data-f="durum">${["İstendi", "Bekliyor", "İşlemde", "Tamam", "İptal"].map(s => `<option${(o.durum === s) ? " selected" : ""}>${s}</option>`).join("")}</select></div></div>
          <p class="adm-sub" style="margin-top:6px">Değişiklik denetim kaydına yazılır (yetki: protokol/istem düzenle).</p>`,
          actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Kaydet</button>`,
          onMount(m) { m.querySelector("[data-ok]").onclick = () => { const at = m.querySelector('[data-f="at"]').value.trim(), by = m.querySelector('[data-f="by"]').value, durum = m.querySelector('[data-f="durum"]').value;
            const ch = []; if (at !== (o.at || "")) ch.push("tarih"); if (by !== (o.by || "")) ch.push("doktor"); if (durum !== (o.durum || "")) ch.push("durum");
            o.at = at; o.by = by; o.durum = durum; H.log("İstem düzenlendi", (o.ad || "") + (ch.length ? " · " + ch.join(", ") : "")); H.closeModal(); H.toast("İstem güncellendi"); H.go("hasta360", { pid:p.id, atab:"tedavi", ttab:params.ttab || "laboratuvar" }); }; } });
        return; }
      if (e.target.closest("[data-ihrand]")) { H.toast("Randevu ekranı açılıyor"); return H.go("randevu"); }
      if (e.target.closest("[data-ihhazir]")) { const t = prompt("Hazırlık açıklaması (hastaya):"); if (t) H.toast("Hazırlık açıklaması kaydedildi."); return; }
      if (e.target.closest("[data-ihonam]")) { const p2 = H.pt(p.id); (p2._dosya = p2._dosya || []).unshift({ bag:"Protokol", grup:"Onam formları", bagId:p2.proto || "", tip:"PDF", ad:"onam-" + Date.now() + ".pdf", tarih:new Date().toLocaleDateString("az") }); H.saveData && H.saveData(); H.toast("Onam formu eklendi."); return; }
      const dsek = e.target.closest("[data-dosyaekle]"), dstr = e.target.closest("[data-dosyatara]"), dsim = e.target.closest("[data-dosyaimza]");
      if (dsek || dstr || dsim) { const tara = !!dstr, imza = !!dsim;
        H.modal({ title:imza ? "Dijital imzadan getir" : tara ? "Tarayıcıdan yükle" : "Dosya ekle", body:`<div class="icd-form">
          <div class="fr"><label>Bağlantı tipi</label><select data-f="bag">${DOSYA_BAG.map(x => `<option>${H.esc(x)}</option>`).join("")}</select></div>
          <div class="fr"><label>Döküman grubu</label><select data-f="grup">${DOSYA_GRUP.map(x => `<option>${H.esc(x)}</option>`).join("")}</select></div>
          <div class="fr"><label>Dosya tipi</label><select data-f="tip">${DOSYA_TIP.map(x => `<option>${H.esc(x)}</option>`).join("")}</select></div>
          <div class="fr"><label>Dosya adı</label><input data-f="ad" placeholder="${tara ? "tarama otomatik adlanır" : "ör. kimlik-on.jpg"}"></div></div>
          <p class="adm-sub" style="margin-top:8px">${tara ? "Tarayıcı entegrasyonu ayrı ekip; burada kayıt oluşturulur." : imza ? "Dijital imza servisinden belge çekme ayrı ekip; kayıt oluşturulur." : "Doküman tipi/grubu seçin, belge hastaya bağlanır."}</p>`,
          actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Ekle</button>`,
          onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = s => m.querySelector(`[data-f="${s}"]`).value;
            const ad = (g("ad") || "").trim() || (tara ? "tarama-" + Date.now() + ".pdf" : imza ? "imzali-" + Date.now() + ".pdf" : "belge-" + Date.now());
            p._dosya.unshift({ bag:g("bag"), grup:g("grup"), bagId:p.proto || "", tip:g("tip"), ad, tarih:new Date().toLocaleDateString("az") });
            H.saveData && H.saveData(); H.log("Dosya eklendi", ad); H.toast("Dosya eklendi"); H.closeModal(); H.go("hasta360", { pid:p.id, atab:ana, stab:alt, proto:params.proto }); }; } }); return; }
      const dsdel = e.target.closest("[data-dosyadel]"); if (dsdel) { if (!confirm("Bu dosya kaydı silinsin mi?")) return; p._dosya.splice(+dsdel.dataset.dosyadel, 1); H.saveData && H.saveData(); H.toast("Silindi", "w"); H.go("hasta360", { pid:p.id, atab:ana, stab:alt, proto:params.proto }); return; }
      if (e.target.closest("[data-h3islem]")) { vzIslemHavuzu(p.id); return; }
      if (e.target.closest("[data-h3save]")) { body.querySelectorAll("[data-hf]").forEach(el => { p[el.dataset.hf] = el.value; }); if (p.ad || p.soyad) p.name = ((p.ad || "") + " " + (p.soyad || "")).trim() || p.name; if (p.sexT) p.sex = p.sexT === "Kişi" ? "E" : "K"; H.log("Hasta kartı kaydedildi", vzName(p.name)); H.toast("Hasta kartı kaydedildi"); return; }
    };
  } });

  /* ================= DESTEK / İŞ TAKİP (talep aç → IT çözer/kapatır) ================= */
  const TALEP_KAT = ["Bilgi Sistemleri", "Donanım", "Yazılım / program", "Hesap / yetki", "Ağ / internet", "Yazıcı / barkod", "Diğer"];
  const TALEP_ONCELIK = ["Düşük", "Normal", "Yüksek", "Acil"];
  const TALEP_DURUM = ["Açık", "İşlemde", "Çözüldü", "Kapalı"];
  let talepSeq = 0;
  const talepler = () => (H.data.talepler = H.data.talepler || [
    { id:"t1", no:"IT-24100", acan:"hs.sevda", acanAd:"Sevda Quliyeva", kategori:"Yazıcı / barkod", konu:"Kol bandı yazıcısı çalışmıyor", aciklama:"Serviste kol bandı yazıcısı boş kağıt çıkarıyor.", oncelik:"Yüksek", durum:"Açık", atanan:"", tarih:"24.10.2026 09:12", notlar:[] },
    { id:"t2", no:"IT-24099", acan:"dr.kamran", acanAd:"Dr. Kamran Rzayev", kategori:"Hesap / yetki", konu:"İstem ekranı açılmıyor", aciklama:"Hasta istem sekmesi boş geliyor, yetki eksik olabilir.", oncelik:"Normal", durum:"İşlemde", atanan:"admin", tarih:"24.10.2026 08:40", notlar:[{ by:"admin", at:"24.10.2026 08:55", text:"Rol yetkisi kontrol ediliyor." }] },
    { id:"t3", no:"IT-24098", acan:"kabul.ulviyye", acanAd:"Ülviyyə Səfərova", kategori:"Ağ / internet", konu:"Vezne bilgisayarı internete bağlanmıyor", aciklama:"Sabahtan beri ağ yok.", oncelik:"Acil", durum:"Çözüldü", atanan:"admin", tarih:"23.10.2026 16:20", notlar:[{ by:"admin", at:"23.10.2026 16:45", text:"Switch portu değiştirildi, bağlandı." }] },
  ]);
  const talepAd = (u) => { const x = (H.data.users || []).find(y => y.u === u); return x ? x.name : (u || "—"); };
  // NAV rozeti: IT'de açık talep sayısı; normal kullanıcıda kendi talebi çözülüp görülmemişse bildirim.
  H.istakipBadge = () => { const all = talepler(), me = (H.state.user || {}).u;
    if (H.can("destek_yonet")) return all.filter(t => t.durum === "Açık").length;
    return all.filter(t => t.acan === me && t.cozumGoruldu === false).length; };
  H.register("istakip", { title:() => H.t("m_istakip"), perm:"destek_ac", render(root, params = {}) {
    const yonet = H.can("destek_yonet"), all = talepler(), f = params.durum || "aktif", mine = params.kapsam === "benim" || !yonet;
    const me = (H.state.user || {}).u;
    let list = all.filter(t => mine ? t.acan === me : true);
    list = f === "hepsi" ? list : f === "aktif" ? list.filter(t => t.durum === "Açık" || t.durum === "İşlemde") : list.filter(t => t.durum === f);
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_istakip")}</h2><p>${yonet ? "Bilgi Sistemleri · talep yönetimi" : "Sorununuzu iletin, Bilgi Sistemleri çözsün · yalnız kendi talepleriniz"}</p></div><div class="r"><button class="btn" data-talexp>${I("save") || ""} Excel</button><button class="btn" data-talprint>${I("print") || ""} Yazdır</button><button class="btn p" data-talnew>${I("plus")} Yeni talep</button></div></div>
      ${yonet ? `<div class="seg" style="margin-bottom:8px"><button data-talkap="tum" class="${!mine ? "on" : ""}">Tüm talepler</button><button data-talkap="benim" class="${mine ? "on" : ""}">Benim taleplerim</button></div>` : ""}
      <div class="seg" style="margin-bottom:8px">${[["aktif", "Aktif"], ["hepsi", "Hepsi"], ...TALEP_DURUM.map(d => [d, d])].map(([k, l]) => `<button data-talf="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="adm-bar" style="margin-bottom:10px">${H.filterBox("Konu / açan / no ara…")}</div>
      <div class="tw"><table class="t"><thead><tr><th style="width:90px">No</th><th>Konu</th><th>Kategori</th><th>Açan</th><th style="width:80px">Öncelik</th><th style="width:150px">Tarih</th><th style="width:110px">Durum</th></tr></thead><tbody>
      ${list.length ? list.map(t => `<tr data-talopen="${t.id}" style="cursor:pointer"><td class="mono adm-sub">${H.esc(t.no)}</td><td><b>${H.esc(t.konu)}</b></td><td class="adm-sub">${H.esc(t.kategori)}</td><td class="adm-sub">${H.esc(t.acanAd)}</td><td>${H.esc(t.oncelik)}</td><td class="adm-sub">${H.esc(t.tarih)}</td><td><span class="tag ${t.durum === "Çözüldü" || t.durum === "Kapalı" ? "ok" : t.durum === "İşlemde" ? "w" : ""}">${t.durum}</span></td></tr>`).join("") : `<tr><td colspan="7" class="mute" style="padding:20px;text-align:center">Talep yok. "+ Yeni talep" ile açın.</td></tr>`}
      </tbody></table></div>
      <p class="adm-sub" style="margin-top:8px">Talebi açan takip eder; Bilgi Sistemleri (IT) durumunu günceller, not ekler ve kapatır.</p>`;
    root.onclick = (e) => {
      const tf = e.target.closest("[data-talf]"); if (tf) return H.go("istakip", { durum:tf.dataset.talf, kapsam:params.kapsam });
      const tk = e.target.closest("[data-talkap]"); if (tk) return H.go("istakip", { durum:params.durum, kapsam:tk.dataset.talkap === "benim" ? "benim" : "tum" });
      if (e.target.closest("[data-talnew]")) return talepForm();
      if (e.target.closest("[data-talexp]")) { H.exportCsv("Destek_talepleri", ["No", "Konu", "Kategori", "Açan", "Öncelik", "Tarih", "Durum"], list.map(t => [t.no, t.konu, t.kategori, t.acanAd, t.oncelik, t.tarih, t.durum])); H.toast("Excel (CSV) indirildi"); return; }
      if (e.target.closest("[data-talprint]")) { talepPrint(list); return; }
      const op = e.target.closest("[data-talopen]"); if (op) { const t = all.find(x => x.id === op.dataset.talopen); if (t) { if (t.acan === me) t.cozumGoruldu = true; talepDetay(t); } }
    };
    H.wireFilter(root);
    function talepPrint(lst) {
      const w = window.open("", "_blank"); if (!w) { H.toast("Yazdırma penceresi engellendi (pop-up izni gerekli).", "e"); return; }
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Destek talepleri</title><style>body{font:13px system-ui,Arial;padding:24px;color:#111}h2{font-size:17px;margin:0 0 12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:12px}th{background:#f3f4f6}</style></head><body><h2>Destek / İş Takip — ${lst.length} talep</h2><table><thead><tr><th>No</th><th>Konu</th><th>Kategori</th><th>Açan</th><th>Öncelik</th><th>Tarih</th><th>Durum</th></tr></thead><tbody>${lst.map(t => `<tr><td>${H.esc(t.no)}</td><td>${H.esc(t.konu)}</td><td>${H.esc(t.kategori)}</td><td>${H.esc(t.acanAd)}</td><td>${H.esc(t.oncelik)}</td><td>${H.esc(t.tarih)}</td><td>${H.esc(t.durum)}</td></tr>`).join("")}</tbody></table></body></html>`);
      w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (x) {} }, 300);
    }
    function talepForm() {
      H.modal({ title:"Yeni destek talebi", wide:true, body:`<div class="icd-form">
        <div class="fr"><label>Kategori</label><select data-f="kat">${TALEP_KAT.map(k => `<option>${H.esc(k)}</option>`).join("")}</select></div>
        <div class="fr"><label>Öncelik</label><select data-f="onc">${TALEP_ONCELIK.map(k => `<option${k === "Normal" ? " selected" : ""}>${H.esc(k)}</option>`).join("")}</select></div>
        <div class="fr"><label>İlgili modül (ops.)</label><input data-f="modul" placeholder="ör. Vezne, İstem, Randevu"></div>
        <div class="fr"><label>Konu</label><input data-f="konu" placeholder="Sorunu kısaca yazın"></div>
        <div class="fr"><label>Açıklama</label><textarea data-f="acik" rows="4" placeholder="Ne oldu, ne zaman, hangi ekranda?"></textarea></div>
      </div>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Talep aç</button>`,
        onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = (k) => (m.querySelector(`[data-f="${k}"]`).value || "").trim();
          const konu = g("konu"); if (!konu) { H.toast("Konu gerekli.", "w"); return; }
          const no = "IT-" + (24101 + (talepSeq++)); const u = (H.state.user || {});
          all.unshift({ id:"t" + Date.now(), no, acan:u.u || "me", acanAd:u.name || "Ben", kategori:g("kat"), modul:g("modul"), konu, aciklama:g("acik"), oncelik:g("onc"), durum:"Açık", atanan:"", tarih:H.nowFull ? H.nowFull() : H.now(), notlar:[], cozumGoruldu:true });
          H.log("Destek talebi açıldı", no + " · " + konu); H.closeModal(); H.toast("Talep açıldı: " + no + " · Bilgi Sistemleri'ne bildirildi"); H.go("istakip", params); }; } });
    }
    function talepDetay(t) {
      const yonet2 = H.can("destek_yonet"), heks = (H.data.users || []).filter(u => u.role === "sistem");
      H.modal({ title:t.no + " · " + H.esc(t.konu), wide:true, body:`<div class="vz-hk">
          <div class="kv"><span>Kategori</span><span>${H.esc(t.kategori)}</span></div><div class="kv"><span>Öncelik</span><span>${H.esc(t.oncelik)}</span></div>
          <div class="kv"><span>Açan</span><span>${H.esc(t.acanAd)}</span></div><div class="kv"><span>Tarih</span><span>${H.esc(t.tarih)}</span></div>
          <div class="kv"><span>İlgili modül</span><span>${H.esc(t.modul || "—")}</span></div><div class="kv"><span>Atanan</span><span>${H.esc(talepAd(t.atanan) || "—")}</span></div>
        </div>
        <div class="box" style="margin-top:10px"><b>Açıklama</b><div class="adm-sub" style="margin-top:4px;white-space:pre-wrap">${H.esc(t.aciklama || "—")}</div></div>
        <div class="ist-sec ist-hd"><h5>İşlem notları</h5></div>
        <div data-talnot>${(t.notlar || []).length ? t.notlar.map(n => `<div class="box" style="margin-bottom:6px"><div class="adm-sub">${H.esc(talepAd(n.by))} · ${H.esc(n.at)}</div><div>${H.esc(n.text)}</div></div>`).join("") : `<div class="adm-sub">Henüz not yok.</div>`}</div>
        ${yonet2 ? `<div class="icd-form" style="margin-top:8px">
          <div class="fr"><label>Durum</label><select data-td="durum">${TALEP_DURUM.map(d => `<option${t.durum === d ? " selected" : ""}>${d}</option>`).join("")}</select></div>
          <div class="fr"><label>Ata</label><select data-td="atanan"><option value="">—</option>${heks.map(u => `<option value="${H.esc(u.u)}"${t.atanan === u.u ? " selected" : ""}>${H.esc(u.name)}</option>`).join("")}</select></div>
          <div class="fr"><label>Not ekle</label><textarea data-td="not" rows="2" placeholder="Yapılan işlem / çözüm"></textarea></div></div>` : ""}`,
        actions:`<button class="btn" data-x>Kapat</button>${yonet2 ? `<button class="btn p" data-talkay>Kaydet</button>` : ""}`,
        onMount(m) { const kb = m.querySelector("[data-talkay]"); if (kb) kb.onclick = () => {
          const d = m.querySelector('[data-td="durum"]').value, a = m.querySelector('[data-td="atanan"]').value, nt = (m.querySelector('[data-td="not"]').value || "").trim();
          const cozuldu = (d === "Çözüldü" || d === "Kapalı") && t.durum !== d; t.durum = d; t.atanan = a; if (nt) (t.notlar = t.notlar || []).push({ by:(H.state.user || {}).u || "admin", at:H.nowFull ? H.nowFull() : H.now(), text:nt });
          if (cozuldu) t.cozumGoruldu = false;   // açan kullanıcıya bildirim (rozet) olarak görünür
          H.log("Destek talebi güncellendi", t.no + " · " + d); H.closeModal(); H.toast(cozuldu ? "Talep " + d.toLowerCase() + " · açan kullanıcıya bildirildi" : "Talep güncellendi: " + d); H.go("istakip", params); }; } });
    }
  } });

  /* ================= LAB / RADYOLOJİ İŞ AKIŞI ================= */
  const LAB_DURUM = ["İstendi", "Numune alındı", "Çalışılıyor", "Sonuç onaylandı", "Serbest bırakıldı"];
  // Lab referans aralıkları — YAŞA GÖRE. Dizi = yaştan bağımsız; nesne = {adult, child, neonate}. NICU/pediatri için yenidoğan aralıkları ayrı.
  H.LABREF = {
    "WBC":{adult:[4,10,"10⁹/L"], child:[5,15,"10⁹/L"], neonate:[9,30,"10⁹/L"]}, "Lökosit":{adult:[4,10,"10⁹/L"], child:[5,15,"10⁹/L"], neonate:[9,30,"10⁹/L"]},
    "Hemoglobin":{adult:[12,16,"g/dL"], child:[11,14,"g/dL"], neonate:[14,22,"g/dL"]}, "Hgb":{adult:[12,16,"g/dL"], child:[11,14,"g/dL"], neonate:[14,22,"g/dL"]},
    "Hematokrit":{adult:[36,48,"%"], child:[33,42,"%"], neonate:[44,64,"%"]}, "Trombosit":[150,400,"10⁹/L"], "Plt":[150,400,"10⁹/L"],
    "Glukoz":{adult:[70,100,"mg/dL"], child:[60,100,"mg/dL"], neonate:[40,90,"mg/dL"]}, "CRP":[0,5,"mg/L"],
    "Sodyum":[135,145,"mmol/L"], "Na":[135,145,"mmol/L"], "Potasyum":{adult:[3.5,5.1,"mmol/L"], neonate:[3.7,5.9,"mmol/L"]}, "K":{adult:[3.5,5.1,"mmol/L"], neonate:[3.7,5.9,"mmol/L"]},
    "Kreatinin":{adult:[0.6,1.2,"mg/dL"], child:[0.3,0.7,"mg/dL"], neonate:[0.3,1,"mg/dL"]}, "Üre":[17,43,"mg/dL"], "ALT":[0,41,"U/L"], "AST":{adult:[0,40,"U/L"], neonate:[25,75,"U/L"]},
    "Total bilirubin":{adult:[0.3,1.2,"mg/dL"], neonate:[0,12,"mg/dL"]}, "Albumin":[3.5,5.2,"g/dL"], "INR":[0.8,1.2,""], "Laktat":[0.5,2.2,"mmol/L"],
    "Troponin":[0,0.04,"ng/mL"], "D-dimer":[0,0.5,"mg/L"], "Prokalsitonin":[0,0.5,"ng/mL"], "HbA1c":[4,5.7,"%"], "TSH":{adult:[0.4,4,"mIU/L"], neonate:[1,39,"mIU/L"]}, "Ferritin":[30,400,"ng/mL"]
  };
  // Admin'in düzenlediği referans aralıkları (kalıcı: labRef) varsayılanın üstüne biner. Canlı sorgu bu birleşik tabloyu kullanır.
  H.LABREF_DEFAULT = JSON.parse(JSON.stringify(H.LABREF));   // varsayılana dönüş için kopya
  if (H.data && H.data.labRef) Object.assign(H.LABREF, H.data.labRef);
  H.labAge = (p) => { if (!p) return "adult"; if (p.ageGroup === "neonate" || p.ageDays != null) return "neonate"; const a = p.age != null ? p.age : 99; return (p.ageGroup === "child" || p.ageGroup === "infant" || a <= 12) ? "child" : "adult"; };
  H.labRange = (entry, ageGroup) => Array.isArray(entry) ? entry : (entry[ageGroup] || entry.adult || entry[Object.keys(entry)[0]]);
  H.labFlag = (ad, deger, ageGroup) => { const n = parseFloat(String(deger).replace(",", ".")); if (isNaN(n)) return { ref:"", birim:"", dir:"norm", sym:"" };
    const low = String(ad).trim().toLocaleLowerCase("tr");
    const key = Object.keys(H.LABREF).find(k => k.toLocaleLowerCase("tr") === low) || Object.keys(H.LABREF).find(k => low.includes(k.toLocaleLowerCase("tr")));
    if (!key) return { ref:"", birim:"", dir:"norm", sym:"" };
    const r = H.labRange(H.LABREF[key], ageGroup || "adult"), dir = n < r[0] ? "dus" : n > r[1] ? "yuk" : "norm";
    return { ref:r[0] + "–" + r[1], birim:r[2], dir, sym:dir === "yuk" ? "↑" : dir === "dus" ? "↓" : "" };
  };
  // Serbest metin ("WBC: 12.5;CRP: 8") -> yapısal sonuç + anormal işaretli özet (yaşa göre).
  H.parseLabResult = (text, ageGroup) => { const sonuclar = [], parts = [];
    String(text || "").split(/\n|;/).map(s => s.trim()).filter(Boolean).forEach(ln => { const m = ln.match(/^(.+?)[:=]\s*([-\d.,]+)\s*(.*)$/);
      if (m) { const ad = m[1].trim(), deger = m[2].trim(), f = H.labFlag(ad, deger, ageGroup); sonuclar.push({ ad, deger, birim:f.birim || m[3].trim(), ref:f.ref, dir:f.dir }); parts.push(ad + " " + deger + (f.sym ? " " + f.sym : "")); }
      else { parts.push(ln); sonuclar.push({ ad:ln, deger:"", ref:"", dir:"norm" }); } });
    return { sonuclar, ozet:parts.join(" · ") };
  };
  // Zaman-içi trend: aynı hastanın önceki sonuçlarında aynı analitle kıyas (↗ artış / ↘ azalış / → aynı).
  H.labTrend = (pid, ad, deger, exceptOrderId) => { const n = parseFloat(String(deger).replace(",", ".")); if (isNaN(n) || !pid) return "";
    const low = String(ad).trim().toLocaleLowerCase("tr");
    const hits = (H.data.orders || []).filter(o => o.pid === pid && o.id !== exceptOrderId && (o.sonuclar || []).some(s => String(s.ad).trim().toLocaleLowerCase("tr") === low)).sort((a, z) => String(z.at || "").localeCompare(String(a.at || "")));
    for (const o of hits) { const s = (o.sonuclar || []).find(x => String(x.ad).trim().toLocaleLowerCase("tr") === low && x.deger !== ""); if (s) { const pv = parseFloat(String(s.deger).replace(",", ".")); if (!isNaN(pv)) return n > pv ? " ↗" : n < pv ? " ↘" : " →"; } }
    return "";
  };
  // Sonucu renkli (anormal vurgulu) HTML olarak göster.
  H.labResultHtml = (o) => (o.sonuclar && o.sonuclar.length) ? o.sonuclar.map(x => { const c = x.dir === "yuk" ? "var(--crit)" : x.dir === "dus" ? "var(--low)" : "var(--mute)", tr = x.deger ? H.labTrend(o.pid, x.ad, x.deger, o.id) : ""; return `<span class="mono" style="color:${c};font-size:12px"${x.ref ? ` title="Ref: ${H.esc(x.ref)} ${H.esc(x.birim || "")}"` : ""}>${H.esc(x.ad)}${x.deger ? " " + H.esc(x.deger) : ""}${x.dir === "yuk" ? " ↑" : x.dir === "dus" ? " ↓" : ""}${tr}</span>`; }).join(" · ") : (o.sonuc ? H.esc(o.sonuc) : "—");
  /* ================= NUMUNE (örnek) AKIŞI ================= */
  H.numune = {
    store() { return H.data.numuneler = H.data.numuneler || []; },
    nextNo() { H.data.numuneSeq = (H.data.numuneSeq || 16707667000) + 1; return String(H.data.numuneSeq); },
    byOrder(oid) { return this.store().find(n => n.orderId === oid); },
    create(order, o) { const n = { no:this.nextNo(), orderId:order.id, pid:order.pid, test:order.ad, grup:order.grup || order.cat || "—", tup:o.tup, lab:o.lab, durum:"Bekliyor", by:(H.state.user || {}).name || "—", at:H.nowFull ? H.nowFull() : H.now() }; this.store().unshift(n); order.numuneNo = n.no; H.saveData && H.saveData(); return n; },
    setDurum(no, durum, extra) { const n = this.store().find(x => x.no === no); if (n) { n.durum = durum; Object.assign(n, extra || {}); H.log("Numune " + durum.toLowerCase(), no + " · " + (n.test || "")); H.saveData && H.saveData(); } return n; },
  };
  H.register("numune", { title:() => H.t("m_numune"), perm:["numune_islem", "lab_islem", "tasks", "results"], render(root, params = {}) {
    const TUP = (H.data.secenekler && H.data.secenekler.tupTipi) || ["Mor Kapak (EDTA)", "Sarı Kapak (Jelli)", "Kırmızı Kapak", "Heparinli Tüp", "Kan Gazı Enjektörü", "Gaita Kabı", "İdrar Kabı", "Özel Sürüntü"];
    const LABS = (H.data.secenekler && H.data.secenekler.laboratuvar) || ["Biyokimya", "Hematoloji", "Mikrobiyoloji", "Hormon", "İmmünoloji", "Qan Bankı", "Patoloji", "Dış Laboratuvar"];
    // Tüp kapak renk kodu: tüp adındaki anahtar sözcükten rengi türet (laboratuvar standart kapak renkleri).
    const tupRenk = (t) => { const s = String(t || "").toLocaleLowerCase("tr"); return /mor|edta/.test(s) ? "#7c3aed" : /sarı|jel/.test(s) ? "#eab308" : /kırmızı|kirmizi/.test(s) ? "#ef4444" : /mavi|sitrat/.test(s) ? "#3b82f6" : /yeşil|heparin/.test(s) ? "#22c55e" : /gri|flor/.test(s) ? "#64748b" : /gaz/.test(s) ? "#111827" : /gaita|idrar|kap/.test(s) ? "#a16207" : "#94a3b8"; };
    const tupHtml = (t) => t ? `<span style="display:inline-flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:50%;background:${tupRenk(t)};border:1px solid rgba(0,0,0,.25);flex:none"></i>${H.esc(t)}</span>` : "—";
    const canCollect = H.canAct("numune_islem") || H.can("tasks") || H.can("lab_islem");
    const canAccept = H.can("lab_islem") || H.canAct("numune_islem");
    const nums = H.numune.store();
    const labOrders = (H.data.orders || []).filter(o => /Laboratuvar|Patoloji/i.test(o.cat || ""));
    const bekleyenTest = labOrders.filter(o => !H.numune.byOrder(o.id));
    const tab = params.tab || "testler";
    const byD = (d) => nums.filter(n => n.durum === d);
    const pname = (pid) => { const p = H.pt(pid); return p ? vzName(p.name) : "—"; };
    const SEG = [["testler", "Testler", bekleyenTest.length], ["Bekliyor", "Numune bekliyor", byD("Bekliyor").length], ["Alındı", "Alındı", byD("Alındı").length], ["Kabul", "Kabul", byD("Kabul").length], ["Red", "Red", byD("Red").length], ["Tekrar", "Tekrar", byD("Tekrar").length]];
    const seg = `<div class="seg" style="flex-wrap:wrap">${SEG.map(([k, l, n]) => `<button data-ntab="${k}" class="${tab === k ? "on" : ""}">${l}${n ? ` <em>${n}</em>` : ""}</button>`).join("")}</div>`;
    let body = "";
    if (tab === "testler") {
      body = `<div class="tw"><table class="t"><thead><tr><th>Hasta</th><th>Test</th><th>Kod</th><th>Protokol</th><th>Tarih</th><th style="width:150px"></th></tr></thead><tbody>
        ${bekleyenTest.length ? bekleyenTest.map(o => `<tr><td><b>${H.esc(pname(o.pid))}</b></td><td>${H.esc(o.ad || "")}</td><td class="mono adm-sub">${H.esc(o.kod || "—")}</td><td class="adm-sub">${H.esc(o.protokolNo || "—")}</td><td class="adm-sub">${H.esc(o.at || "—")}</td><td>${canCollect ? `<button class="btn p sm" data-numolustur="${o.id}">Numune oluştur</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="6" class="mute" style="padding:16px;text-align:center">Numune bekleyen test yok. Doktor lab/patoloji istemi yapınca burada görünür.</td></tr>`}
        </tbody></table></div>`;
    } else {
      const list = byD(tab);
      const act = (n) => { if (tab === "Bekliyor" && canCollect) return `<button class="btn p sm" data-numal="${n.no}">Numune al</button>`;
        if (tab === "Alındı" && canAccept) return `<button class="btn p sm" data-numkabul="${n.no}">Kabul</button> <button class="btn g sm" data-numred="${n.no}">Red</button> <button class="btn sm" data-numtekrar="${n.no}">Tekrar</button>`;
        if (n.durum === "Red") return `<span class="adm-sub"><span class="tag crit">${H.esc(n.redNeden || "Red")}</span>${n.redBy ? " · Reddeden: " + H.esc(n.redBy) : ""}</span>`;
        if (n.durum === "Tekrar") return `<span class="adm-sub">Tekrara atan: ${H.esc(n.tekrarBy || "—")}</span>${canCollect ? ` <button class="btn p sm" data-numtekraral="${n.no}">Yeni numune al</button>` : ""}`;
        return ""; };
      const lej = (tab === "Bekliyor" || tab === "Alındı") ? `<div class="durum-lej">Tüp kapağı: <span><i style="background:#7c3aed"></i>Mor/EDTA</span><span><i style="background:#eab308"></i>Sarı/Jelli</span><span><i style="background:#ef4444"></i>Kırmızı</span><span><i style="background:#22c55e"></i>Yeşil/Heparin</span><span><i style="background:#3b82f6"></i>Mavi/Sitrat</span></div>` : "";
      body = lej + `<div class="tw"><table class="t"><thead><tr><th style="width:140px">Numune no</th><th>Hasta</th><th>Test</th><th>Tüp</th><th>Laboratuvar</th><th>Tarih</th><th style="width:260px"></th></tr></thead><tbody>
        ${list.length ? list.map(n => `<tr><td class="mono adm-sub">${H.esc(n.no)}</td><td><b>${H.esc(pname(n.pid))}</b></td><td>${H.esc(n.test || "")}</td><td class="adm-sub">${tupHtml(n.tup)}</td><td class="adm-sub">${H.esc(n.lab || "—")}</td><td class="adm-sub">${H.esc(n.at || "—")}</td><td>${act(n)}</td></tr>`).join("") : `<tr><td colspan="7" class="mute" style="padding:16px;text-align:center">Kayıt yok.</td></tr>`}
        </tbody></table></div>`;
    }
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_numune")}</h2><p>Order → numune oluştur → al → laboratuvar kabul/red. Numune no otomatik üretilir.</p></div></div>${seg}<div style="margin-top:10px">${body}</div>`;
    root.onclick = (e) => {
      const nt = e.target.closest("[data-ntab]"); if (nt) return H.go("numune", { tab:nt.dataset.ntab });
      const no = e.target.closest("[data-numolustur]"); if (no) { const o = (H.data.orders || []).find(x => x.id === no.dataset.numolustur); if (o) numOlusturModal(o); return; }
      const al = e.target.closest("[data-numal]"); if (al) { H.numune.setDurum(al.dataset.numal, "Alındı"); H.toast("Numune alındı."); return H.go("numune", { tab:"Alındı" }); }
      const kb = e.target.closest("[data-numkabul]"); if (kb) { H.numune.setDurum(kb.dataset.numkabul, "Kabul"); const n = H.numune.store().find(x => x.no === kb.dataset.numkabul); const o = n && (H.data.orders || []).find(x => x.id === n.orderId); if (o) { o.durum = "İşlemde"; H.saveData && H.saveData(); } H.toast("Numune kabul edildi · test işleme alındı."); return H.go("numune", { tab:"Kabul" }); }
      const rd = e.target.closest("[data-numred]"); if (rd) { const nn = rd.dataset.numred; H.modal({ title:"Numune red", body:`<div class="icd-form"><div class="fr" style="grid-column:1/-1"><label>Red nedeni</label><select data-f="neden">${["Hemoliz", "Pıhtılı numune", "Yetersiz numune", "Yanlış tüp", "Etiketsiz / yanlış etiket", "Cihazın 0, >> veya << okuması", "Diğer"].map(x => `<option>${x}</option>`).join("")}</select></div></div>`, actions:`<button class="btn" data-x>Vazgeç</button><button class="btn g" data-ok>Reddet</button>`, onMount(m) { m.querySelector("[data-ok]").onclick = () => { H.numune.setDurum(nn, "Red", { redNeden:m.querySelector('[data-f="neden"]').value, redBy:(H.state.user || {}).name || "—", redAt:H.nowFull ? H.nowFull() : H.now() }); H.closeModal(); H.toast("Numune reddedildi."); H.go("numune", { tab:"Red" }); }; } }); return; }
      const tk = e.target.closest("[data-numtekrar]"); if (tk) { H.numune.setDurum(tk.dataset.numtekrar, "Tekrar", { tekrarBy:(H.state.user || {}).name || "—", tekrarAt:H.nowFull ? H.nowFull() : H.now() }); H.toast("Tekrara atandı · yeni numune beklenir."); return H.go("numune", { tab:"Tekrar" }); }
      const tka = e.target.closest("[data-numtekraral]"); if (tka) { H.numune.setDurum(tka.dataset.numtekraral, "Alındı", { tekrarAlindi:true }); H.toast("Tekrar numune alındı · laboratuvar kabulüne düştü."); return H.go("numune", { tab:"Alındı" }); }
    };
    function numOlusturModal(o) {
      H.modal({ title:"Numune oluştur · " + H.esc(o.ad || ""), body:`<div class="icd-form">
          <div class="fr"><label>Tüp tipi</label><select data-f="tup">${TUP.map(x => `<option>${H.esc(x)}</option>`).join("")}</select></div>
          <div class="fr"><label>Laboratuvar</label><select data-f="lab">${LABS.map(x => `<option>${H.esc(x)}</option>`).join("")}</select></div></div>
          <p class="adm-sub" style="margin-top:6px">Numune no otomatik üretilir; numune "Bekliyor"a düşer, hemşire alır, laboratuvar kabul/red eder.</p>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Oluştur</button>`,
        onMount(m) { m.querySelector("[data-ok]").onclick = () => { const n = H.numune.create(o, { tup:m.querySelector('[data-f="tup"]').value, lab:m.querySelector('[data-f="lab"]').value }); H.closeModal(); H.toast("Numune oluşturuldu: " + n.no); H.go("numune", { tab:"Bekliyor" }); }; } });
    }
  } });

  H.register("labislem", { title:() => "Laboratuvar / Radyoloji", perm:"lab_islem", render(root, params = {}) {
    const cats = { lab:["Laboratuvar"], rad:["Radyoloji"], kan:["Kan ürünü"] };
    const tur = params.tur || "lab";
    const ord = (H.data.orders || []).filter(o => cats[tur].includes(o.cat));
    const pn = (pid) => { const p = H.pt(pid), b = p && H.bed(p.bed); return p ? (H.showNames() ? p.name : (b ? b.no : pid)) : pid; };
    root.innerHTML = `<div class="ph"><div><h2>Laboratuvar / Radyoloji</h2><p>${ord.length} istem · numune/çekim → onay → serbest bırakma</p></div><div class="r"><button class="btn" data-lbexp>${I("save") || ""} Excel</button><button class="btn" data-lbyaz>${I("print") || ""} Yazdır</button></div></div>
      <div class="seg" style="margin-bottom:8px">${[["lab", "Laboratuvar"], ["rad", "Radyoloji"], ["kan", "Kan ürünü"]].map(([k, l]) => `<button data-lt="${k}" class="${tur === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="adm-bar" style="margin-bottom:10px">${H.filterBox("Hasta / istem / isteyen ara…")}</div>
      <div class="tw"><table class="t"><thead><tr><th style="width:120px">Saat</th><th>Hasta</th><th>İstem</th><th>İsteyen</th><th style="width:170px">Durum</th><th>Sonuç</th><th style="width:90px"></th></tr></thead><tbody>
      ${ord.length ? ord.map(o => `<tr><td class="mono adm-sub">${H.esc(o.at || "")}</td><td><b>${H.esc(pn(o.pid))}</b></td><td>${H.esc(o.ad || "")}<div class="adm-sub" style="font-size:11.5px">${H.esc(o.detay || "")}</div></td><td class="adm-sub">${H.esc(o.by || "")}</td><td><select data-labst="${o.id}">${LAB_DURUM.map(s => `<option${(o.durum || "İstendi") === s ? " selected" : ""}>${s}</option>`).join("")}</select></td><td>${H.labResultHtml(o)}</td><td><button class="btn g sm" data-labres="${o.id}">${I("edit") || "Sonuç"} Sonuç</button></td></tr>`).join("") : `<tr><td colspan="7" class="mute" style="padding:20px;text-align:center">Bu türde istem yok.</td></tr>`}
      </tbody></table></div>
      <p class="adm-sub" style="margin-top:8px">"Sonuç gir" ile sonuç yazılır; "Serbest bırakıldı" olunca hekime/hastaya (Hasta Dosyası → Tedavi) görünür.</p>`;
    root.onchange = (e) => { const st = e.target.closest("[data-labst]"); if (st) { const o = (H.data.orders || []).find(x => x.id === st.dataset.labst); if (o) { o.durum = st.value; H.saveData && H.saveData(); H.log("Lab/Rad durumu", (o.ad || "") + " · " + st.value); H.toast("Durum: " + st.value); } } };
    const lbData = () => ({ cols:["Saat", "Hasta", "İstem", "İsteyen", "Durum"], rows:ord.map(o => [o.at || "", pn(o.pid), o.ad || "", o.by || "", o.durum || "İstendi"]) });
    root.onclick = (e) => { const lt = e.target.closest("[data-lt]"); if (lt) return H.go("labislem", { tur:lt.dataset.lt });
      const lr = e.target.closest("[data-labres]"); if (lr) { const o = (H.data.orders || []).find(x => x.id === lr.dataset.labres); if (!o) return;
        H.modal({ title:"Sonuç gir · " + H.esc(o.ad || ""), wide:true,
          body:`<div class="icd-form"><div class="fr" style="grid-column:1/-1"><label>Sonuçlar — her satır: <b>Analit: değer</b></label><textarea data-f="s" rows="6" placeholder="WBC: 12.5&#10;CRP: 8&#10;Sodyum: 134&#10;(radyoloji/patoloji için serbest rapor da yazılabilir)">${H.esc((o.sonuclar || []).map(x => x.ad + (x.deger ? ": " + x.deger : "")).join("\n") || o.sonuc || "")}</textarea></div></div>
            <p class="adm-sub" style="margin-top:4px">Analit referans listesinde tanınırsa anormal <b style="color:var(--crit)">↑ yüksek</b> / <b style="color:var(--low)">↓ düşük</b> otomatik işaretlenir.</p>`,
          actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Kaydet</button>`,
          onMount(m) { m.querySelector("[data-ok]").onclick = () => { const r = H.parseLabResult(m.querySelector('[data-f="s"]').value, H.labAge(H.pt(o.pid)));
            o.sonuclar = r.sonuclar; o.sonuc = r.ozet; if (o.sonuc && /İstendi|İşlemde|Numune alındı|Çalışılıyor/.test(o.durum || "")) o.durum = "Sonuç onaylandı";
            H.saveData && H.saveData(); H.log("Lab/Rad sonuç girildi", o.ad || ""); H.closeModal(); H.toast("Sonuç kaydedildi."); H.go("labislem", { tur }); }; } });
        return; }
      if (e.target.closest("[data-lbexp]")) { const d = lbData(); H.exportCsv ? (H.exportCsv("Lab_Rad_" + tur, d.cols, d.rows), H.toast("Excel indirildi")) : H.toast("yok", "w"); return; }
      if (e.target.closest("[data-lbyaz]")) { const d = lbData(); H.printTable ? H.printTable("Laboratuvar / Radyoloji", d.cols, d.rows) : H.toast("yok", "w"); return; } };
    H.wireFilter(root);
  } });

  /* ================= İNSAN KAYNAKLARI (İK) ================= */
  const IK_TIP = ["Doktor", "Hemşire", "İdari", "Teknik", "Laborant", "Radyoloji teknisyeni", "Temizlik", "Güvenlik"];
  const IK_YETKI = ["Konsültasyon yapabilir", "Randevu verilebilir", "Web randevu ekranında görünsün", "Ameliyat personeli", "Çağrı merkezi personeli", "Danışman personel", "Vezne kasalar arası para giriş/çıkış", "İş yeri hekimi"];
  const IK_MEDENI = ["Bekar", "Evli", "Belirtilmedi"];
  const IK_EGITIM = ["Lise", "Ön lisans", "Lisans", "Yüksek lisans", "Doktora"];
  const persAll = () => { const users = (H.data.users || []).filter(u => !u.temp && !u._persId).map(u => ({ name:u.name, u:u.u, title:u.title || "", role:u.role, rol:(H.data.roles[u.role] || { name:u.role }).name, units:u.units, active:u.active !== false, src:"user" }));
    const pers = (H.data.personel || []).map(p => ({ name:(p.ad + " " + p.soyad).trim(), u:p.kimlik || "", title:p.unvan || "", rol:p.tip, units:p.bolum ? [p.bolum] : [], active:true, src:"personel", _p:p }));
    return users.concat(pers); };
  H.register("ik", { title:() => H.t("m_ik"), perm:["admin_users", "summary"], render(root) {
    const staff = persAll();
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_ik")}</h2><p>${staff.length} personel · kart, rol, birim</p></div><div class="r"><button class="btn" data-izinler>${I("clock") || ""} İzin talepleri</button><button class="btn" data-nobetciz>${I("calendar") || ""} Nöbet çizelgesi</button><button class="btn" data-persexp>${I("save") || ""} Excel</button><button class="btn" data-persyaz>${I("print") || ""} Yazdır</button><button class="btn p" data-persnew>${I("plus")} Personel ekle</button></div></div>
      <div class="adm-bar" style="margin-bottom:10px">${H.filterBox("Personel ara…")}</div>
      <div class="tw"><table class="t"><thead><tr><th>Ad</th><th>Unvan</th><th>Rol / tip</th><th>Birimler</th><th>Durum</th></tr></thead><tbody>
      ${staff.map(u => `<tr class="row" style="cursor:pointer" ${u.src === "personel" ? `data-persedit="${H.esc(u._p.id)}"` : `data-usdetay="${H.esc(u.u)}"`}><td><b>${H.esc(u.name)}</b><div class="mute" style="font-size:11.5px">${H.esc(u.u)}</div></td><td class="adm-sub">${H.esc(u.title || "—")}</td><td>${H.esc(u.rol)}</td><td class="adm-sub">${(u.units === "*" ? ["Tüm birimler"] : (u.units || []).map(id => (H.unit(id) || { tr:id }).tr)).join(", ") || "—"}</td><td><span class="tag ${u.active ? "ok" : ""}">${u.active ? "Aktif" : "Pasif"}</span></td></tr>`).join("")}
      </tbody></table></div>
      <p class="adm-sub" style="margin-top:8px">Login hesapları Yönetim → Kullanıcılar'da; buradan HR personel kartı (doktor/hemşire/idari…) eklenir. Satıra tıklayınca personel kartı / kullanıcı detayı açılır.</p>`;
    root.onclick = (e) => {
      if (e.target.closest("[data-persexp]")) { H.exportCsv("Personel_listesi", ["Ad", "Kullanıcı/Kimlik", "Ünvan", "Rol/tip", "Birimler", "Durum"], staff.map(u => [u.name, u.u, u.title, u.rol, (u.units === "*" ? "Tüm birimler" : (u.units || []).map(id => (H.unit(id) || { tr:id }).tr)).join(", "), u.active ? "Aktif" : "Pasif"])); H.toast("Excel (CSV) indirildi"); return; }
      if (e.target.closest("[data-persyaz]")) { if (H.printTable) H.printTable("Personel listesi", ["Ad", "Unvan", "Rol / tip", "Birimler", "Durum"], staff.map(u => [u.name, u.title || "—", u.rol, (u.units === "*" ? "Tüm birimler" : (u.units || []).map(id => (H.unit(id) || { tr:id }).tr)).join(", ") || "—", u.active ? "Aktif" : "Pasif"])); return; }
      if (e.target.closest("[data-nobetciz]")) return nobetCiz();
      if (e.target.closest("[data-izinler]")) return izinAkis();
      if (e.target.closest("[data-persnew]")) return persForm(null);
      const ed = e.target.closest("[data-persedit]"); if (ed) { const p = (H.data.personel || []).find(x => x.id === ed.dataset.persedit); if (p) persForm(p); return; }
      const ud = e.target.closest("[data-usdetay]"); if (ud) { const user = (H.data.users || []).find(x => x.u === ud.dataset.usdetay); if (user) persForm(null, user); }
    };
    H.wireFilter(root);
    function userDetay(user) {
      const rol = (H.data.roles[user.role] || { name:user.role }), units = user.units === "*" ? "Tüm birimler" : (user.units || []).map(id => (H.unit(id) || { tr:id }).tr).join(", ") || "—";
      const kv = (k, v) => `<div class="kv"><span>${H.esc(k)}</span><span>${H.esc(v || "—")}</span></div>`;
      H.modal({ title:"Kullanıcı · " + H.esc(user.name),
        body:`<div class="vz-hk">${kv("Ad soyad", user.name)}${kv("Kullanıcı adı", user.u)}${kv("Rol", rol.name)}${kv("Ünvan", user.title)}${kv("Birimler", units)}${kv("Durum", user.active !== false ? "Aktif" : "Pasif")}</div>
          <p class="adm-sub" style="margin-top:8px">Bu bir <b>login hesabı</b>. Personel kartı (SGK/izin/çalışma takvimi/zimmet) İK'dan "Personel ekle" ile açılır; yetki/rol ataması Yönetim → Kullanıcılar ve Roller'den yapılır.</p>`,
        actions:`<button class="btn" data-x>Kapat</button>${H.can("admin_users") ? `<button class="btn p" data-usrol>Yetki / rol ekranı</button>` : ""}`,
        onMount(m) { const b = m.querySelector("[data-usrol]"); if (b) b.onclick = () => { H.closeModal(); H.go("admin", { tab:"users" }); }; } });
    }
    function nobetCiz() {
      // tüm personel kartlarındaki nöbet/mesai/izin satırlarını tek listede, tarihe göre topla
      const rows = [];
      (H.data.personel || []).forEach(p => { const ad = ((p.ad || "") + " " + (p.soyad || "")).trim() || p.kimlik || "—";
        (p.nobetler || []).forEach(r => rows.push([ad, "Nöbet", r[0] || "", r[1] || "", r[2] || ""]));
        (p.mesailer || []).forEach(r => rows.push([ad, "Mesai", r[0] || "", r[1] || "", (r[2] ? r[2] + " · " : "") + (r[3] || "")]));
        (p.izinler || []).forEach(r => rows.push([ad, "İzin", r[0] || "", r[1] || "", r[2] || ""])); });
      rows.sort((a, z) => String(a[2]).localeCompare(String(z[2])));
      const cols = ["Personel", "Tür", "Başlangıç", "Bitiş", "Açıklama"];
      const TURC = { "Nöbet":"crit", "Mesai":"mid", "İzin":"ok" };
      H.modal({ title:"Nöbet / mesai / izin çizelgesi", wide:true,
        body:`<div class="r" style="gap:8px;margin-bottom:8px"><button class="btn sm" data-ncexp>${I("save") || ""} Excel</button><button class="btn sm" data-ncyaz>${I("print") || ""} Yazdır</button><span class="adm-sub" style="align-self:center">${rows.length} kayıt · personel kartlarından toplanır</span></div>
          <div class="tw"><table class="t"><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>
          ${rows.length ? rows.map(r => `<tr><td><b>${H.esc(r[0])}</b></td><td><span class="tag ${TURC[r[1]] || ""}">${H.esc(r[1])}</span></td><td class="mono adm-sub">${H.esc(r[2])}</td><td class="mono adm-sub">${H.esc(r[3])}</td><td class="adm-sub">${H.esc(r[4])}</td></tr>`).join("") : `<tr><td colspan="5" class="mute" style="padding:16px;text-align:center">Kayıt yok. Personel kartı → Nöbet / Mesai / İzin sekmesinden eklenir.</td></tr>`}
          </tbody></table></div>`,
        actions:`<button class="btn" data-x>Kapat</button>`,
        onMount(m) { m.querySelector("[data-ncexp]").onclick = () => { H.exportCsv && H.exportCsv("Nobet_cizelgesi", cols, rows); H.toast("Excel indirildi"); };
          m.querySelector("[data-ncyaz]").onclick = () => H.printTable && H.printTable("Nöbet / mesai / izin çizelgesi", cols, rows); } });
    }
    function izinAkis() {
      // İzin / işgöremezlik onay akışı: talep → yetkili onay/red → onaylıysa personel kartı izinler tablosuna + nöbet çizelgesine yansır.
      const IZIN_TIP = ["Yıllık izin", "Hastalık (işgöremezlik)", "Ücretsiz izin", "Mazeret izni", "Doğum izni", "İdari izin"];
      const names = persAll().map(u => u.name).filter(Boolean);
      const canApp = H.can("admin_users");
      const me = (H.state.user || {}).name || "—";
      const store = () => (H.data.izinTalep = H.data.izinTalep || [
        { id:"izn1", personel:names[0] || "—", tip:"Yıllık izin", bas:"2026-11-03", bit:"2026-11-07", gun:5, aciklama:"", durum:"Bekliyor", eden:names[0] || "—" },
        { id:"izn2", personel:names[1] || "—", tip:"Hastalık (işgöremezlik)", bas:"2026-10-20", bit:"2026-10-22", gun:3, aciklama:"Rapor ekli", durum:"Onaylandı", eden:names[1] || "—" },
      ]);
      const gunHesap = (bas, bit) => { const a = new Date(bas), b = new Date(bit); return (a && b && !isNaN(a) && !isNaN(b)) ? Math.max(1, Math.round((b - a) / 86400000) + 1) : 1; };
      const DUR = { "Bekliyor":"", "Onaylandı":"ok", "Reddedildi":"crit" };
      const draw = (m) => { const list = store();
        m.querySelector("[data-izbody]").innerHTML = list.length ? list.map(x => `<tr><td><b>${H.esc(x.personel)}</b></td><td>${H.esc(x.tip)}</td><td class="mono adm-sub">${H.esc(x.bas)}</td><td class="mono adm-sub">${H.esc(x.bit)}</td><td class="n">${x.gun}</td><td><span class="tag ${DUR[x.durum] || ""}">${H.esc(x.durum)}</span></td><td>${x.durum === "Bekliyor" && canApp ? `<button class="btn p sm" data-izok="${x.id}">Onayla</button> <button class="btn g sm" data-izred="${x.id}">Reddet</button>` : x.durum === "Bekliyor" ? `<span class="adm-sub">onay bekliyor</span>` : "—"}</td></tr>`).join("") : `<tr><td colspan="7" class="mute" style="padding:16px;text-align:center">İzin talebi yok. "+ Yeni talep" ile açın.</td></tr>`;
      };
      H.modal({ title:"İzin / işgöremezlik talepleri", wide:true,
        body:`<div class="r" style="gap:8px;margin-bottom:8px"><button class="btn p sm" data-iznew>${I("plus") || "+"} Yeni talep</button><span class="adm-sub" style="align-self:center">${canApp ? "Yetkili: bekleyen talepleri onaylayabilir/reddedebilirsiniz." : "Yalnız görüntüleme · onay yetkisi İK yöneticisinde."}</span></div>
          <div class="tw"><table class="t"><thead><tr><th>Personel</th><th>Tip</th><th>Başlangıç</th><th>Bitiş</th><th style="width:50px">Gün</th><th style="width:110px">Durum</th><th style="width:170px"></th></tr></thead><tbody data-izbody></tbody></table></div>
          <p class="adm-sub" style="margin-top:8px">Onaylanan izin, personelin kartındaki İzin tablosuna ve Nöbet çizelgesine düşer.</p>`,
        actions:`<button class="btn" data-x>Kapat</button>`,
        onMount(m) { draw(m);
          m.querySelector("[data-iznew]").onclick = () => izinForm();
          m.querySelector("[data-izbody]").onclick = (e) => { const ok = e.target.closest("[data-izok]"), red = e.target.closest("[data-izred]"); if (!ok && !red) return;
            if (!canApp) { H.toast("Onay yetkiniz yok.", "e"); return; }
            const id = (ok || red).dataset.izok || (ok || red).dataset.izred, x = store().find(y => y.id === id); if (!x) return;
            if (ok) { x.durum = "Onaylandı";
              const p = (H.data.personel || []).find(z => ((z.ad || "") + " " + (z.soyad || "")).trim() === x.personel);   // personel kartı varsa izin tablosuna yaz
              if (p) { p.izinler = p.izinler || []; p.izinler.push([x.bas, x.bit, x.tip + (x.aciklama ? " · " + x.aciklama : "")]); }
              H.log("İzin onaylandı", x.personel + " · " + x.tip); H.toast("İzin onaylandı" + (p ? " · çizelgeye işlendi" : ""), "ok");
            } else { x.durum = "Reddedildi"; H.log("İzin reddedildi", x.personel + " · " + x.tip); H.toast("İzin reddedildi", "w"); }
            H.saveData && H.saveData(); draw(m); }; } });
      function izinForm() {
        H.modal({ title:"Yeni izin talebi", onClose:izinAkis, body:`<div class="icd-form">
          <div class="fr"><label>Personel</label><input data-f="personel" list="iz-pers" value="${H.esc(me)}" placeholder="Personel adı"><datalist id="iz-pers">${names.map(n => `<option>${H.esc(n)}</option>`).join("")}</datalist></div>
          <div class="fr"><label>İzin tipi</label><select data-f="tip">${IZIN_TIP.map(t => `<option>${H.esc(t)}</option>`).join("")}</select></div>
          <div class="fr"><label>Başlangıç</label><input type="date" data-f="bas"></div>
          <div class="fr"><label>Bitiş</label><input type="date" data-f="bit"></div>
          <div class="fr"><label>Açıklama</label><input data-f="aciklama" placeholder="ör. rapor no / neden"></div></div>`,
          actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Talep oluştur</button>`,
          onMount(mm) { mm.querySelector("[data-ok]").onclick = () => { const g = s => (mm.querySelector(`[data-f="${s}"]`).value || "").trim();
            if (!g("personel") || !g("bas") || !g("bit")) { H.toast("Personel, başlangıç ve bitiş gerekli.", "w"); return; }
            store().unshift({ id:"izn" + Date.now(), personel:g("personel"), tip:mm.querySelector('[data-f="tip"]').value, bas:g("bas"), bit:g("bit"), gun:gunHesap(g("bas"), g("bit")), aciklama:g("aciklama"), durum:"Bekliyor", eden:me });
            H.saveData && H.saveData(); H.log("İzin talebi açıldı", g("personel")); H.toast("İzin talebi oluşturuldu · onay bekliyor"); izinAkis(); }; } });
      }
    }
    function persForm(existing, seed) {
      const p = existing || (seed ? { ad:(seed.name || "").trim().split(/\s+/)[0] || "", soyad:(seed.name || "").trim().split(/\s+/).slice(1).join(" "), kimlik:seed.u || "", unvan:seed.title || "", tip:(H.data.roles[seed.role] || { name:seed.role }).name || "", bolum:(seed.units && seed.units !== "*" && seed.units[0] && (H.unit(seed.units[0]) || {}).tr) || "" } : {}), bols = H.data.bolumler || [];
      const TABS = [["genel", "Genel"], ["kisisel", "Kişisel"], ["nobet", "Nöbet / Mesai / İzin"], ["egitim", "Eğitim / Tecrübe"], ["calisma", "Çalışma takvimi"], ["yakin", "Yakınları"], ["zimmet", "Zimmet"], ["diger", "Diğer özellikler"], ["iletisim", "İletişim"], ["yetki", "Yetkiler"]];
      const ptbl = (title, cols, rows) => `<div class="fr" style="grid-column:1/-1"><label>${H.esc(title)}</label><div style="width:100%"><div class="tw"><table class="t"><thead><tr>${cols.map(c => `<th>${H.esc(c)}</th>`).join("")}</tr></thead><tbody>${rows && rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${H.esc(String(c))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}" class="mute" style="padding:12px;text-align:center">Kayıt yok.</td></tr>`}</tbody></table></div><button type="button" class="btn sm" style="margin-top:6px" data-ptadd="${H.esc(title)}">${I("plus") || "+"} Ekle</button></div></div>`;
      const DIGER_YETKI = ["Ameliyat isteğini yapan doktor bilgisini değiştirebilir", "Protokol açabilir", "VIP hasta kabul yapabilir", "Hasta birleştirebilir", "Hasta kaydını silebilir", "Mernis'ten veri çekebilir", "Kök hücre numarası girebilir", "VNA portala erişebilir"];
      const f = (k, lbl, html) => `<div class="fr"><label>${lbl}</label>${html}</div>`;
      const inp = (k, ph) => `<input data-f="${k}" value="${H.esc(p[k] || "")}" placeholder="${ph || ""}">`;
      const selOf = (k, list) => `<select data-f="${k}">${["", ...list].map(x => `<option${(p[k] || "") === x ? " selected" : ""}>${H.esc(x || "— seçiniz —")}</option>`).join("")}</select>`;
      const panels = {
        genel:`${f("ad", "Ad", inp("ad"))}${f("soyad", "Soyad", inp("soyad"))}${f("kimlik", "Kimlik / FİN", inp("kimlik"))}
          ${f("tip", "Personel tipi", selOf("tip", IK_TIP))}${f("meslek", "Meslek", inp("meslek"))}${f("gorev", "Görev", inp("gorev"))}${f("unvan", "Ünvan", inp("unvan"))}
          ${f("bolum", "Bölüm", `<input data-f="bolum" list="pers-bol" value="${H.esc(p.bolum || "")}" placeholder="Bölüm"><datalist id="pers-bol">${bols.map(b => `<option>${H.esc(b.ad)}</option>`).join("")}</datalist>`)}
          ${f("brans", "Branş", inp("brans"))}${f("sube", "Şube", inp("sube"))}
          <div class="pers-dr" style="margin-top:6px"><b style="font-size:12.5px">Doktor bilgileri</b>
          ${f("diploma", "Diploma no", inp("diploma"))}${f("tescil", "Tescil no", inp("tescil"))}${f("muayeneSure", "Muayene süresi (dk)", inp("muayeneSure"))}${f("ereceteKod", "E-reçete kullanıcı kodu", inp("ereceteKod"))}</div>`,
        kisisel:`${f("pasaport", "Pasaport no", inp("pasaport"))}${f("anne", "Anne adı", inp("anne"))}${f("baba", "Baba adı", inp("baba"))}
          ${f("kan", "Kan grubu", selOf("kan", ["0 Rh(+)", "0 Rh(-)", "A Rh(+)", "A Rh(-)", "B Rh(+)", "B Rh(-)", "AB Rh(+)", "AB Rh(-)"]))}
          ${f("medeni", "Medeni hal", selOf("medeni", IK_MEDENI))}${f("egitim", "Eğitim", selOf("egitim", IK_EGITIM))}${f("uyruk", "Uyruk", inp("uyruk"))}${f("dogum", "Doğum tarihi", `<input type="date" data-f="dogum" value="${H.esc(p.dogum || "")}">`)}`,
        calisma:`<div class="fr" style="grid-column:1/-1"><label>Haftalık çalışma takvimi</label><div class="pers-takvim">${["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"].map(gn => { const h = (p.haftalik || {})[gn] || {}, calis = h.calisiyor != null ? h.calisiyor : (gn !== "Cumartesi" && gn !== "Pazar"); return `<div class="ptk-row"><label class="dc-chk"><input type="checkbox" data-wd="${gn}"${calis ? " checked" : ""}> ${gn}</label><input type="time" data-ws="${gn}" value="${H.esc(h.bas || "08:00")}"><span>–</span><input type="time" data-we="${gn}" value="${H.esc(h.bit || "17:00")}"></div>`; }).join("")}</div></div>
          ${f("calismaGun", "Özet (serbest)", inp("calismaGun", "ör. Pzt-Cuma"))}${f("calismaSaat", "Çalışma saatleri", inp("calismaSaat", "ör. 08:00-17:00"))}
          ${f("nobet", "Nöbet durumu", inp("nobet", "ör. ayda 4 nöbet"))}${f("sgk", "SGK / sosyal sigorta no", inp("sgk"))}${f("izin", "Yıllık izin (gün)", inp("izin"))}
          ${f("ranSure", "Randevu çizelge süresi (dk)", inp("ranSure"))}${f("ranGunluk", "Günlük randevu sayısı", inp("ranGunluk"))}
          ${f("saatlikRandevu", "Saatlik ara randevu sayısı", inp("saatlikRandevu"))}${f("ayniTarihRandevu", "Aynı tarihli randevu sayısı", inp("ayniTarihRandevu"))}
          ${f("kurumTipi", "Kurum tipi (randevu)", selOf("kurumTipi", ["Ücretli", "SGK", "ÖSS", "TSS", "AK", "Tümü"]))}
          <div class="fr" style="grid-column:1/-1"><label>Randevu özellikleri</label><div class="icd-oz">${["Web randevusu verilebilir", "Online muayene randevusu", "Poliklinik randevusu verilebilir", "FTR randevusu verilir", "Hizmet randevusu verilir"].map(y => `<label><input type="checkbox" data-rf="${H.esc(y)}"${(p.randevuOzellik || []).includes(y) ? " checked" : ""}> ${H.esc(y)}</label>`).join("")}</div></div>`,
        iletisim:`${f("telefon", "Telefon", inp("telefon"))}${f("eposta", "E-posta", inp("eposta"))}${f("adres", "Adres", `<textarea data-f="adres" rows="2">${H.esc(p.adres || "")}</textarea>`)}${f("acilKisi", "Acil durumda aranacak", inp("acilKisi"))}`,
        yetki:`<div class="icd-oz">${IK_YETKI.map(y => `<label><input type="checkbox" data-y="${H.esc(y)}"${(p.yetki || []).includes(y) ? " checked" : ""}> ${H.esc(y)}</label>`).join("")}</div>`,
        nobet:`${ptbl("Nöbet", ["Başlangıç tarihi", "Bitiş tarihi", "Açıklama"], (p.nobetler || []))}
          ${ptbl("Mesai", ["Başlangıç tarihi", "Bitiş tarihi", "Bölüm", "Açıklama"], (p.mesailer || []))}
          ${ptbl("İzin", ["Başlangıç tarihi", "Bitiş tarihi", "Açıklama"], (p.izinler || []))}
          ${ptbl("Randevu slot kapatma (diğer)", ["Başlangıç", "Bitiş", "Şube", "Kapatma sebebi"], (p.slotKapatma || []))}`,
        egitim:`${ptbl("Okul / eğitim", ["Eğitim derecesi", "Okul adı", "Bölüm", "Portalda görünsün"], (p.egitimler || []))}
          ${ptbl("Kurs / sertifika", ["Ad", "Kurum", "Tarih"], (p.sertifikalar || []))}
          ${ptbl("Yabancı dil", ["Dil", "Seviye"], (p.diller || []))}`,
        yakin:`${ptbl("Personel yakınları", ["Yakınlığı", "Adı", "Soyadı", "T.C / Pasaport", "Cinsiyet", "Doğum tarihi"], (p.yakinlar || []))}`,
        zimmet:`${ptbl("Zimmet bilgileri", ["Demirbaş / cihaz", "Seri no", "Zimmet tarihi", "Durum"], (p.zimmetler || []))}`,
        diger:`${f("maxMaasKesinti", "Max maaş kesintisi", inp("maxMaasKesinti"))}${f("iadeOnaySeviye", "İade onay seviyesi", inp("iadeOnaySeviye"))}${f("disKapiIp", "Dış kapı ekranı IP", inp("disKapiIp"))}${f("orgSema", "Organizasyon şeması", inp("orgSema"))}
          <div class="fr" style="grid-column:1/-1"><label>Seçenekler</label><div class="icd-oz"><label><input type="checkbox" data-do="videoWall"${p.videoWall ? " checked" : ""}> VideoWall kullanıyor</label><label><input type="checkbox" data-do="randevuTeyid"${p.randevuTeyid ? " checked" : ""}> Randevu teyid araması</label><label><input type="checkbox" data-do="canliMesaj"${p.canliMesaj ? " checked" : ""}> Canlı mesaj istemiyor</label></div></div>
          <div class="fr" style="grid-column:1/-1"><label>Fonksiyon yetkileri</label><div class="icd-oz">${DIGER_YETKI.map(y => `<label><input type="checkbox" data-dy="${H.esc(y)}"${(p.digerYetki || []).includes(y) ? " checked" : ""}> ${H.esc(y)}</label>`).join("")}</div></div>`,
      };
      const body = `<div class="pers-card"><div class="seg pers-tabs" data-pt>${TABS.map(([k, l], i) => `<button data-ptab="${k}" class="${i === 0 ? "on" : ""}">${l}</button>`).join("")}</div>
        ${TABS.map(([k], i) => `<div class="icd-form pers-panel" data-panel="${k}"${i === 0 ? "" : " hidden"}>${panels[k]}</div>`).join("")}</div>`;
      H.modal({ title:existing ? "Personel kartı düzenle" : "Yeni personel", wide:true, body,
        actions:`${existing ? `<button class="btn g" data-persdel>${I("trash")}Sil</button>` : ""}<span class="spacer"></span><button class="btn" data-x>Vazgeç</button><button class="btn p" data-perssave>Kaydet</button>`,
        onMount(m) {
          m.querySelector("[data-pt]").onclick = (e) => { const b = e.target.closest("[data-ptab]"); if (!b) return; m.querySelectorAll("[data-ptab]").forEach(x => x.classList.toggle("on", x === b)); m.querySelectorAll("[data-panel]").forEach(x => x.hidden = x.dataset.panel !== b.dataset.ptab); };
          const PTMAP = { "Nöbet":["nobetler", ["Başlangıç tarihi", "Bitiş tarihi", "Açıklama"]], "Mesai":["mesailer", ["Başlangıç tarihi", "Bitiş tarihi", "Bölüm", "Açıklama"]], "İzin":["izinler", ["Başlangıç tarihi", "Bitiş tarihi", "Açıklama"]], "Randevu slot kapatma (diğer)":["slotKapatma", ["Başlangıç", "Bitiş", "Şube", "Kapatma sebebi"]], "Okul / eğitim":["egitimler", ["Eğitim derecesi", "Okul adı", "Bölüm", "Portalda görünsün"]], "Kurs / sertifika":["sertifikalar", ["Ad", "Kurum", "Tarih"]], "Yabancı dil":["diller", ["Dil", "Seviye"]], "Personel yakınları":["yakinlar", ["Yakınlığı", "Adı", "Soyadı", "T.C / Pasaport", "Cinsiyet", "Doğum tarihi"]], "Zimmet bilgileri":["zimmetler", ["Demirbaş / cihaz", "Seri no", "Zimmet tarihi", "Durum"]] };
          m.querySelectorAll("[data-ptadd]").forEach(b => b.onclick = () => { const map = PTMAP[b.dataset.ptadd]; if (!map) { H.toast("Eklenemedi.", "w"); return; } const [field, cols] = map; const vals = cols.map(c => prompt(c + ":") || ""); if (vals.every(v => !v)) return; p[field] = p[field] || []; p[field].push(vals); H.toast(b.dataset.ptadd + " · satır eklendi"); H.closeModal(); persForm(p, seed); });
          m.querySelector("[data-perssave]").onclick = () => {
            const g = s => { const el = m.querySelector(`[data-f="${s}"]`); return el ? (el.value || "").trim() : ""; };
            const ad = g("ad"); if (!ad) { H.toast("Ad gerekli.", "w"); return; }
            const rec = {}; ["ad", "soyad", "kimlik", "tip", "meslek", "gorev", "unvan", "bolum", "brans", "sube", "diploma", "tescil", "muayeneSure", "ereceteKod", "pasaport", "anne", "baba", "kan", "medeni", "egitim", "uyruk", "dogum", "calismaGun", "calismaSaat", "nobet", "sgk", "izin", "ranSure", "ranGunluk", "saatlikRandevu", "ayniTarihRandevu", "kurumTipi", "telefon", "eposta", "adres", "acilKisi", "maxMaasKesinti", "iadeOnaySeviye", "disKapiIp", "orgSema"].forEach(k => rec[k] = g(k));
            rec.yetki = [...m.querySelectorAll("[data-y]:checked")].map(x => x.dataset.y);
            rec.randevuOzellik = [...m.querySelectorAll("[data-rf]:checked")].map(x => x.dataset.rf);
            rec.digerYetki = [...m.querySelectorAll("[data-dy]:checked")].map(x => x.dataset.dy);
            ["videoWall", "randevuTeyid", "canliMesaj"].forEach(k => rec[k] = !!m.querySelector(`[data-do="${k}"]:checked`));
            rec.haftalik = {}; m.querySelectorAll("[data-wd]").forEach(cb => { const gn = cb.dataset.wd; rec.haftalik[gn] = { calisiyor:cb.checked, bas:(m.querySelector(`[data-ws="${gn}"]`) || {}).value || "", bit:(m.querySelector(`[data-we="${gn}"]`) || {}).value || "" }; });
            ["nobetler", "mesailer", "izinler", "slotKapatma", "egitimler", "sertifikalar", "diller", "yakinlar", "zimmetler"].forEach(k => rec[k] = p[k] || []);   // tablo satırları korunur
            H.data.personel = H.data.personel || [];
            if (existing) Object.assign(p, rec); else { const np = Object.assign({ id:"per" + Date.now() }, rec); H.data.personel.unshift(np); if (seed) seed._persId = np.id; }
            H.log(existing ? "Personel güncellendi" : "Personel eklendi", ad + " " + rec.soyad); H.closeModal(); H.toast("Kaydedildi: " + ad); H.go("ik");
          };
          const del = m.querySelector("[data-persdel]"); if (del) del.onclick = () => { if (!confirm("Bu personel silinsin mi?")) return; const i = (H.data.personel || []).findIndex(x => x.id === p.id); if (i >= 0) H.data.personel.splice(i, 1); H.closeModal(); H.toast("Silindi", "w"); H.go("ik"); };
        } });
    }
  } });

  /* ================= ALARMLAR ================= */
  const STEPS = ["3. dk · sorumlu hemşire", "5. dk · hekim", "10. dk · hızlı yanıt"];
  const SEVC = { crit:"var(--crit)", high:"var(--high)", mid:"var(--mid)", low:"var(--low)" };
  const mmss = (m) => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, "0")}`;
  H.register("alarms", { title:() => H.t("m_alarms"), perm:"alarms", render(root, params) {
    const f = params.f || "open", all = H.data.alarms.filter(a => H.inScope(a.pid));
    const list = (st) => all.filter(a => a.state === st && (f !== "crit" || a.sev === "crit") && (f !== "mine" || H.pt(a.pid).nurse === H.state.user.u || H.pt(a.pid).attending === H.state.user.u)).sort((a, b) => b.ageMin - a.ageMin);
    const row = (a) => { const p = H.pt(a.pid), b = H.bed(p.bed);
      return `<div class="card" style="display:grid;grid-template-columns:70px 4px 1fr auto;gap:12px;align-items:center;margin-bottom:8px;${a.state === "done" ? "opacity:.55" : ""}">
        <span class="mono" style="font:700 16px 'JetBrains Mono';color:${SEVC[a.sev]}">${mmss(a.ageMin)}</span><span style="align-self:stretch;border-radius:2px;background:${SEVC[a.sev]}"></span>
        <div style="min-width:0"><b style="cursor:pointer" data-open="${p.id}">${b.no} · ${H.esc(p.name)}</b> <span class="pill">${H.unit(b.unitId).tr}</span><div class="mute" style="font-size:13px">${H.esc(a.txt)}</div>
          ${a.state === "open" ? `<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">${STEPS.map((s, i) => `<span class="pill" style="${i < a.step ? `background:color-mix(in srgb, ${SEVC[a.sev]} 20%, transparent);color:${SEVC[a.sev]}` : ""}">${s}</span>`).join("")}</div>` : ""}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${a.state === "open" ? `<button class="btn p sm" data-ack="${a.id}">Gördüm</button><button class="btn sm" data-snooze="${a.id}">Ertele</button><button class="btn d sm" data-esc="${a.id}">Eskale</button>` : a.state === "seen" ? `<button class="btn sm" data-close="${a.id}">Değerlendirildi · kapat</button>` : `<span class="mute" style="font-size:12px">kapandı</span>`}</div></div>`; };
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_alarms")}</h2><p>Zaman sırasına göre · en eski yanıtsız en üstte · eskalasyon: 3 / 5 / 10 dakika</p></div></div>
      <div class="seg" data-f style="margin-bottom:12px">${[["open", "Açık · " + all.filter(a => a.state === "open").length], ["crit", "Yalnız kritik"], ["mine", "Benim hastalarım"]].map(([k, l]) => `<button data-v="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="sec">Yanıt bekliyor</div>${list("open").map(row).join("") || `<div class="empty">Yanıt bekleyen alarm yok.</div>`}
      <div class="sec">Değerlendiriliyor</div>${list("seen").map(row).join("") || `<div class="mute">—</div>`}
      <div class="sec">Son 1 saatte kapanan</div>${list("done").map(row).join("") || `<div class="mute">—</div>`}`;
    root.addEventListener("click", e => {
      const g = (s) => { const el = e.target.closest(`[data-${s}]`); return el && H.data.alarms.find(a => a.id == el.dataset[s]); };
      const fb = e.target.closest("[data-f] button"); if (fb) return H.go("alarms", { f:fb.dataset.v });
      const op = e.target.closest("[data-open]"); if (op) return H.go("patient", { pid:op.dataset.open, tab:"ozet" });
      let a;
      if ((a = g("ack"))) { a.state = "seen"; H.log("alarm görüldü", a.pid); H.toast("Alarm görüldü olarak işaretlendi. Eskalasyon durdu."); return H.renderApp(); }
      if ((a = g("close"))) { a.state = "done"; H.log("alarm kapatıldı", a.pid); return H.renderApp(); }
      if ((a = g("esc"))) { a.step = Math.min(3, a.step + 1); H.log("alarm eskale", a.pid); H.toast(`Eskale edildi → ${STEPS[a.step - 1] || "hızlı yanıt ekibi"}`, "w"); return H.renderApp(); }
      if ((a = g("snooze"))) return H.modal({ title:"Ertele", body:`<p class="mute" style="margin-top:0">Neden ve süre seçin. Kritik alarmlar en çok 10 dakika ertelenebilir.</p><div class="fld"><label>Süre</label><div class="opts" data-o><i class="on">5 dk</i><i>10 dk</i>${a.sev !== "crit" ? "<i>30 dk</i>" : ""}</div></div><div class="fld"><label>Neden</label><div class="opts" data-o><i class="on">Hasta başındayım</i><i>Artefakt / kablo</i><i>Hekim bilgili</i></div></div>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Ertele</button>`,
        onMount:(m) => { m.addEventListener("click", ev => { const o = ev.target.closest("[data-o] i"); if (o) [...o.parentNode.children].forEach(x => x.classList.toggle("on", x === o)); if (ev.target.closest("[data-ok]")) { a.state = "seen"; H.log("alarm ertelendi", a.pid); H.closeModal(); H.toast("Ertelendi."); H.renderApp(); } }); } });
    });
  } });

  /* ================= VARDİYA DEVRİ ================= */
  const dodo = (p, h) => [["D", `${H.SEV[p.risk].l.toLowerCase()} · ${H.scoreLabel(p)} · HR ${p.v.hr}, KB ${p.v.sbp}/${p.v.dbp}, SpO₂ ${p.v.spo2}`], ["Ö", `${H.esc(p.dx)} · yatışın ${p.admitDays}. günü${p.allergies.length ? " · alerji: " + p.allergies.join(", ") : ""}`],
    ["D", `${lateTasks(p.id).length ? lateTasks(p.id).length + " geciken iş var" : "geciken iş yok"}${p.flags.fall === "yüksek" ? " · düşme riski yüksek" : ""}${p.flags.braden === "yüksek" ? " · bası yarası riski yüksek" : ""}`], ["Ö", h && h.parts && String(h.parts.n || "").trim() ? H.esc(h.parts.n) : p.risk === "crit" || p.risk === "high" ? "Yakın izlem, hekim değerlendirmesi" : "Rutin izlem"]];
  // 30.09 · kontrol §4-4: hemşirenin mühürlediği teslim notu metni (yazan + saat) sistem özetinin ÜSTÜNDE gösterilir.
  const noteBlock = (h) => { if (!h || !(h.parts || h.text)) return ""; const P = h.parts;
    const rows = P ? [["D", P.d], ["Ö", P.o], ["D", P.g], ["Ö", P.n]].filter(([, v]) => String(v || "").trim()) : [["", h.text]];
    return `<div class="hv-note" style="border:1px solid var(--line);border-left:3px solid var(--pri);border-radius:10px;padding:8px 10px;margin:10px 0 6px;background:var(--card2)">
      <div style="font-size:12px;color:var(--mute);margin-bottom:6px">${I("file").replace("<svg", '<svg style="width:13px;height:13px;vertical-align:-2px"')} Teslim notu · <b data-notr style="color:var(--ink)">${H.esc(h.by || h.from)}</b> · ${H.esc(h.day ? h.day + " · " : "")}${H.esc(h.at || "")} · mühürlü</div>
      <div style="display:grid;grid-template-columns:20px 1fr;gap:3px 8px;font-size:12.5px">${rows.map(([k, v]) => `<b style="color:var(--pri)">${k}</b><span data-notr style="white-space:pre-wrap;overflow-wrap:anywhere">${H.esc(v)}</span>`).join("")}</div></div>`; };
  H.register("hand", { title:() => H.t("m_hand"), perm:"hand", render(root) {
    const u = H.state.user, wait = H.data.handovers.filter(h => H.inScope(h.pid));
    const mine = H.myPatients().filter(p => p.nurse === u.u || p.attending === u.u).slice(0, 6);
    const critOpen = (pid) => H.data.alarms.some(a => a.pid === pid && a.state === "open" && a.sev === "crit");
    root.innerHTML = `<div class="ph"><div><h2>Vardiya devri</h2><p>Akşam → gece · 23:00 · devir iki imzalıdır: giden imzalar, gelen karşı imzalar</p></div></div>
      <div class="g2"><div><div class="sec" style="margin-top:0">Karşı imzanızı bekleyenler <small>${wait.filter(h => h.state === "waiting").length} hasta</small></div>
        ${wait.map(h => { const p = H.pt(h.pid), b = H.bed(p.bed); return `<div class="card" style="margin-bottom:10px"><div style="display:flex;gap:8px;align-items:center"><b class="nm" style="font:700 15px 'Space Grotesk'"><span style="color:${H.SEV[p.risk].c}" class="mono">${b.no}</span> ${H.esc(p.name)}</b><span class="mute" style="margin-left:auto;font-size:12px">${H.esc(h.from)}</span></div>
          ${noteBlock(h)}${h.parts || h.text ? `<div class="mute" style="font-size:11.5px;margin-top:8px">Sistem özeti · şu anki veriden</div>` : ""}<div style="display:grid;grid-template-columns:20px 1fr;gap:3px 8px;font-size:12.5px;margin:${h.parts || h.text ? "4px" : "10px"} 0 10px">${dodo(p, h).map(([k, v]) => `<b style="color:var(--pri)">${k}</b><span>${v}</span>`).join("")}</div>
          ${h.state === "signed" ? `<span style="color:var(--ok);font-weight:700;font-size:13px">✓ Karşı imza atıldı · ${H.now()}</span>` : `<button class="btn p sm" data-sign="${h.id}">Okudum, karşı imzala</button> <button class="btn sm" data-open="${p.id}">Hastayı aç</button>`}</div>`; }).join("") || `<div class="empty">Bekleyen devir yok.</div>`}
        ${wait.filter(h => h.state === "waiting").length > 1 ? `<button class="btn" data-signall>Hepsini okudum, toplu imzala</button>` : ""}</div>
      <div><div class="sec" style="margin-top:0">Benim devrettiklerim <small>giden imzası</small></div>
        ${mine.map(p => { const b = H.bed(p.bed), done = H.data.handovers.some(h => h.pid === p.id && (h.from === u.name || h.by === u.name)); return `<div class="card" style="margin-bottom:10px"><div style="display:flex;gap:8px;align-items:center"><b style="font:700 15px 'Space Grotesk'"><span class="mono" style="color:${H.SEV[p.risk].c}">${b.no}</span> ${H.esc(p.name)}</b>${done ? `<span style="margin-left:auto;color:var(--ok);font-weight:700;font-size:12.5px">✓ İmzalandı</span>` : ""}</div>
          ${critOpen(p.id) && !done ? `<div class="note" style="margin:8px 0;color:var(--crit);background:var(--critSoft);border-color:transparent">🔒 İmzalanamaz: bu hastada yanıtlanmamış kritik alarm var. Önce alarmı yanıtlayın.</div><button class="btn sm" data-goalarm>Alarma git →</button>`
            : done ? `<div class="mute" style="font-size:12.5px;margin-top:4px">Gelen ekibin karşı imzası bekleniyor</div>` : `<div class="mute" style="font-size:12.5px;margin:6px 0 8px">Özet sistem tarafından hazırlandı, düzenleyebilirsiniz.</div><button class="btn p sm" data-out="${p.id}">Devret ve imzala</button>`}</div>`; }).join("") || `<div class="empty">Size atanmış hasta yok.</div>`}</div></div>
      <div class="mute" style="font-size:12px;margin-top:10px">D-Ö-D-Ö: Durum · Öykü · Değerlendirme · Öneri.</div>`;
    root.addEventListener("click", e => {
      const s = e.target.closest("[data-sign]"); if (s) { const h = H.data.handovers.find(x => x.id == s.dataset.sign); h.state = "signed"; h.to = H.state.user.name; H.log("devir karşı imza", h.pid); H.toast("Karşı imza atıldı."); return H.renderApp(); }
      if (e.target.closest("[data-signall]")) { wait.forEach(h => { h.state = "signed"; h.to = H.state.user.name; }); H.log("toplu karşı imza"); H.toast("Tüm devirler imzalandı."); return H.renderApp(); }
      const o = e.target.closest("[data-out]"); if (o) { H.data.handovers.push({ id:Date.now(), pid:o.dataset.out, from:H.state.user.name, to:null, state:"outgoing" }); H.log("devir giden imza", o.dataset.out); H.toast("Devredildi. Gelen ekibin karşı imzası bekleniyor."); return H.renderApp(); }
      const op = e.target.closest("[data-open]"); if (op) return H.go("patient", { pid:op.dataset.open, tab:"devir" });
      if (e.target.closest("[data-goalarm]")) return H.go("alarms");
    });
  } });

  /* ================= HIZLI YANIT ================= */
  H.register("rrt", { title:() => "Hızlı yanıt ekibi", perm:"rrt", render(root) {
    const all = H.data.alarms.filter(a => a.state === "open"), on = all.filter(a => a.step >= 2), inc = all.filter(a => a.step < 2);
    const card = (a, lvl) => { const p = H.pt(a.pid), b = H.bed(p.bed), u = H.unit(b.unitId);
      return `<div class="card" style="margin-bottom:10px;border-left:4px solid ${SEVC[a.sev]}"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font:700 16px 'Space Grotesk'"><span class="mono" style="color:${SEVC[a.sev]}">${b.no}</span> ${H.esc(p.name)}</b><span class="pill">${u.tr} · ${H.floorText(u.floor)} · Oda ${b.room}</span><span class="mono" style="margin-left:auto;color:${SEVC[a.sev]};font-weight:700">${mmss(a.ageMin)}</span></div>
        <div class="mute" style="font-size:13px;margin:6px 0">${H.esc(a.txt)}</div><div style="font-size:12.5px;margin-bottom:8px">${H.ageText(p)} ${p.sex} · ${H.esc(p.dx)}${p.allergies.length ? ` · <b style="color:var(--crit)">Alerji: ${p.allergies.join(", ")}</b>` : ""} · Kod durumu: ${p.codeStatus}</div>
        ${lvl ? `<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn p sm" data-st="yolda" data-id="${a.id}">Yoldayım</button><button class="btn sm" data-st="yaninda" data-id="${a.id}">Yanındayım</button><button class="btn sm" data-open="${p.id}">Hastayı aç</button></div>` : `<div class="mute" style="font-size:12.5px">Size ${Math.max(0, 10 - a.ageMin).toFixed(0)} dk içinde düşebilir · şu an: ${STEPS[a.step] || STEPS[0]}</div>`}</div>`; };
    root.innerHTML = `<div class="ph"><div><h2>Hızlı yanıt ekibi</h2><p>Size eskale edilenler ve eskale olabilecekler</p></div></div>
      <div class="g2"><div><div class="sec" style="margin-top:0">Size eskale edilen <small>${on.length}</small></div>${on.map(a => card(a, 1)).join("") || `<div class="empty">Şu an size eskale edilmiş alarm yok.</div>`}</div>
      <div><div class="sec" style="margin-top:0">Yaklaşan <small>henüz size düşmedi</small></div>${inc.map(a => card(a, 0)).join("") || `<div class="empty">—</div>`}</div></div>`;
    root.addEventListener("click", e => { const s = e.target.closest("[data-st]"); if (s) { H.log("hızlı yanıt: " + s.dataset.st, s.dataset.id); return H.toast(s.dataset.st === "yolda" ? "Ekip yolda olarak bildirildi. Birim hemşiresi görecek." : "Hasta başında olarak işaretlendi."); }
      const op = e.target.closest("[data-open]"); if (op) H.go("patient", { pid:op.dataset.open, tab:"ozet" }); });
  } });

  /* ================= ECZANE ================= */
  H.register("pharmacy", { title:() => H.t("m_pharmacy"), perm:"pharmacy", render(root, params = {}) {
    const ab = H.myPatients().filter(p => p.antibioticDay), crit = H.myPatients().filter(p => p.risk === "crit");
    const EPTAB = [["Bekliyor", "Bekliyor"], ["Karşılandı", "Karşılandı"], ["Reddedildi", "Reddedildi"], ["Transfer", "Transfer"]];
    const DEPO = ["Ana Eczane", "Kemoterapi Eczane", "Afet Deposu", "Kat Deposu", "Dış Eczane"];
    const ept = params.ptab || "Bekliyor";
    const allIlac = (H.data.orders || []).filter(o => /İlaç|ilac|Reçete|ilaç/.test(o.cat || ""));
    const stOf = (o) => /Karşıland/.test(o.durum || "") ? "Karşılandı" : /Redded/.test(o.durum || "") ? "Reddedildi" : /Transfer/.test(o.durum || "") ? "Transfer" : "Bekliyor";
    const ecnt = (s) => allIlac.filter(o => stOf(o) === s).length, erows = allIlac.filter(o => stOf(o) === ept);
    // İlaç stok/miad (ilk 120 katalog ilacı için deterministik demo; admin ileride düzenler). Kalıcı: ilacStok.
    if (!H.data.ilacStok) { const S = H.data.ilacStok = {}; (H.ILAC || []).slice(0, 120).forEach((d, i) => { const h = (d[0] || "x").split("").reduce((a, c) => a + c.charCodeAt(0), i); const kritik = 20 + (h % 15); const gun = (h % 7 === 0) ? -((h % 30) + 1) : (h % 5 === 0) ? (h % 80) : 400 + (h % 300); const m = new Date(); m.setDate(m.getDate() + gun); S[d[0]] = { kod:d[0], ad:d[1], stok:h % 250, kritik, miad:m.toISOString().slice(0, 10) }; }); H.saveData && H.saveData(); }
    const stokArr = Object.values(H.data.ilacStok || {}), bugun = new Date(), miadGun = (s) => Math.round((new Date(s) - bugun) / 86400000);
    const kritikStok = stokArr.filter(x => x.stok <= x.kritik).sort((a, z) => a.stok - z.stok), miadli = stokArr.filter(x => miadGun(x.miad) <= 90).sort((a, z) => miadGun(a.miad) - miadGun(z.miad));
    // İade (pas geçilen / kullanılmayan ilaç eczaneye döner) ve Zayi (kırık/dökük/miadı geçti) demo kayıtları. Kalıcı: ilacIade, ilacZayi.
    if (!H.data.ilacIade) { const hn = ["Rəhilə Nuriyeva", "Mənzər Məmmədzadə", "Elvin Hüseynov", "Nərgiz Əliyeva"]; H.data.ilacIade = stokArr.slice(0, 4).map((x, i) => ({ id:"iade" + i, kod:x.kod, ad:x.ad, miktar:1 + (i % 3), hasta:hn[i] || "—", saat:"25.10.2026 " + (18 + i) + ":30", yer:"Eczane", durum:"Bekliyor" })); H.saveData && H.saveData(); }
    const iade = H.data.ilacIade || [], iadeBek = iade.filter(x => x.durum === "Bekliyor").length;
    const zayi = H.data.ilacZayi = H.data.ilacZayi || [];
    root.innerHTML = `<div class="ph"><div><h2>Eczane</h2><p>Order'lar hastane kaydından gelir. Bu ekran izleme içindir, doz önerisi yapmaz.</p></div></div>
      <div class="att"><div class="ac"><div class="i">${I("pill")}</div><b>${ab.length}</b><span>antibiyotik kullanan hasta</span></div><div class="ac ${ab.some(p => p.antibioticDay >= 3) ? "" : "ok"}"><div class="i">${I("clock")}</div><b>${ab.filter(p => p.antibioticDay >= 3).length}</b><span>3. günü geçen, gözden geçirme zamanı</span></div><div class="ac crit"><div class="i">${I("alert")}</div><b>${crit.length}</b><span>yüksek riskli ilaç (vazopressör) alan</span></div><div class="ac"><div class="i">${I("shield")}</div><b>${H.myPatients().filter(p => p.allergies.length).length}</b><span>kayıtlı alerjisi olan hasta</span></div></div>
      <div class="sec">Antibiyotik kullananlar</div><div class="tw"><table class="t"><tr><th>Yatak</th><th>Hasta</th><th>Tedavi günü</th><th>Alerji</th><th>Son kültür</th><th></th></tr>
        ${ab.map(p => `<tr class="row" data-pid="${p.id}"><td class="n">${H.bed(p.bed).no}</td><td><b>${H.esc(p.name)}</b><div class="mute" style="font-size:11.5px">${H.esc(p.dx)}</div></td><td><b>${p.antibioticDay}. gün</b>${p.antibioticDay >= 3 ? ' <span class="tag w">gözden geçir</span>' : ""}</td><td>${p.allergies.length ? `<span class="tag c">${p.allergies.join(", ")}</span>` : "—"}</td><td class="mute">Kan kültürü · bekleniyor</td><td>${I("chevR")}</td></tr>`).join("")}</table></div>
      <div class="sec">İlaç istemleri — eczane karşılama</div>
      <div class="seg" style="margin-bottom:8px">${EPTAB.map(([k, l]) => `<button data-eptab="${k}" class="${ept === k ? "on" : ""}">${l}${ecnt(k) ? ` <em>${ecnt(k)}</em>` : ""}</button>`).join("")}</div>
      <div class="tw"><table class="t"><thead><tr><th style="width:120px">Tarih</th><th>Hasta</th><th>İlaç</th><th>Doz / yol</th><th>Muadil</th><th>Protokol</th><th style="width:300px"></th></tr></thead><tbody>
        ${erows.length ? erows.map(o => { const bek = stOf(o) === "Bekliyor"; return `<tr><td class="mono adm-sub">${H.esc(o.at || "")}</td><td><b>${H.esc((H.pt(o.pid) || {}).name || "—")}</b></td><td>${H.esc(o.ad || "")}</td><td class="adm-sub">${H.esc(o.detay || "")}</td><td class="adm-sub">${o.muadil ? `<span class="tag">↔ ${H.esc(o.muadil)}</span>` : "—"}</td><td class="adm-sub">${H.esc(o.protokolNo || "—")}</td><td>${bek ? `<button class="btn p sm" data-eczok="${o.id}">Karşıla</button> <button class="btn sm" data-eczmuadil="${o.id}">Muadil</button> <button class="btn sm" data-ecztr="${o.id}">Transfer</button> <button class="btn g sm" data-eczred="${o.id}">Reddet</button> <button class="btn sm" data-eczddi="${o.id}">Etkileşim</button>` : (o.redNeden ? `<span class="adm-sub">Red: ${H.esc(o.redNeden)}</span>` : (o.transferDepo ? `<span class="adm-sub">→ ${H.esc(o.transferDepo)}</span>` : ""))}</td></tr>`; }).join("") : `<tr><td colspan="7" class="mute" style="padding:16px;text-align:center">Bu durumda ilaç istemi yok.</td></tr>`}
      </tbody></table></div>
      <div class="sec">Stok durumu <span class="adm-sub">(kritik: ${kritikStok.length} · miadı yakın/geçen: ${miadli.length})</span></div>
      <div class="g2">
        <div class="box"><h5>Kritik miktar altında (${kritikStok.length})</h5><div class="tw" style="max-height:260px;overflow:auto"><table class="t"><thead><tr><th>İlaç</th><th style="width:70px">Mevcut</th><th style="width:70px">Kritik</th></tr></thead><tbody>${kritikStok.length ? kritikStok.slice(0, 40).map(x => `<tr><td><b>${H.esc(x.ad)}</b></td><td class="n" style="color:var(--crit)">${x.stok}</td><td class="n adm-sub">${x.kritik}</td></tr>`).join("") : `<tr><td colspan="3" class="mute" style="padding:12px;text-align:center">Kritik stok yok.</td></tr>`}</tbody></table></div></div>
        <div class="box"><h5>Miadı yaklaşan / geçen (${miadli.length})</h5><div class="tw" style="max-height:260px;overflow:auto"><table class="t"><thead><tr><th>İlaç</th><th style="width:110px">Miad</th><th style="width:90px">Durum</th><th style="width:80px"></th></tr></thead><tbody>${miadli.length ? miadli.slice(0, 40).map(x => { const g = miadGun(x.miad); return `<tr><td><b>${H.esc(x.ad)}</b></td><td class="mono adm-sub">${H.esc(x.miad)}</td><td>${g < 0 ? `<span class="tag crit">Geçti</span>` : `<span class="tag w">${g} gün</span>`}</td><td><button class="btn g sm" data-zayi="${H.esc(x.kod)}" title="Zayi düş">Zayi</button></td></tr>`; }).join("") : `<tr><td colspan="4" class="mute" style="padding:12px;text-align:center">Yakın miadlı ürün yok.</td></tr>`}</tbody></table></div></div>
      </div>
      <div class="sec">İade işlemleri <span class="adm-sub">(bekleyen: ${iadeBek})</span></div>
      <div class="tw"><table class="t"><thead><tr><th>İlaç</th><th style="width:66px">Miktar</th><th>Hasta</th><th style="width:150px">Pas geçme saati</th><th style="width:120px">Karşılama yeri</th><th style="width:100px">Durum</th><th style="width:200px"></th></tr></thead><tbody>
        ${iade.length ? iade.map(x => `<tr><td><b>${H.esc(x.ad)}</b></td><td class="n">${x.miktar}</td><td class="adm-sub">${H.esc(x.hasta)}</td><td class="mono adm-sub">${H.esc(x.saat)}</td><td class="adm-sub">${H.esc(x.yer)}</td><td>${x.durum === "Bekliyor" ? `<span class="tag w">Bekliyor</span>` : `<span class="tag ${x.durum === "Kabul" ? "ok" : "crit"}">${H.esc(x.durum)}${x.redNeden ? " · " + H.esc(x.redNeden) : ""}</span>`}</td><td>${x.durum === "Bekliyor" ? `<button class="btn p sm" data-iadeok="${x.id}">İade Kabul</button> <button class="btn g sm" data-iadered="${x.id}">İade Red</button>` : `<span class="adm-sub">${H.esc(x.kabulEden || "—")}</span>`}</td></tr>`).join("") : `<tr><td colspan="7" class="mute" style="padding:14px;text-align:center">İade bekleyen ilaç yok.</td></tr>`}
      </tbody></table></div>
      ${zayi.length ? `<div class="sec">Zayi kaydı (${zayi.length})</div><div class="tw" style="max-height:200px;overflow:auto"><table class="t"><thead><tr><th>İlaç</th><th style="width:66px">Miktar</th><th style="width:140px">Sebep</th><th style="width:150px">Tarih</th><th>Kullanıcı</th></tr></thead><tbody>${zayi.map(z => `<tr><td><b>${H.esc(z.ad)}</b></td><td class="n">${z.miktar}</td><td class="adm-sub">${H.esc(z.sebep)}</td><td class="mono adm-sub">${H.esc(z.tarih)}</td><td class="adm-sub">${H.esc(z.by || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <div class="note i" style="margin-top:12px">Muadil: aynı etken/gruptan alternatif. "Etkileşim": hastanın o an kullandığı ilaçlar. İade: pas geçilen/kullanılmayan ilaç; kabul edilirse stoğa geri eklenir. Zayi: miadı geçen/bozulan ürün stoktan düşülür. Tam Vademecum/DDI motoru gerçek ilaç veri tabanı ister (ileri faz). Stok/miad/iade ilk 120 ilaç için demo; admin düzenleyebilir.</div>`;
    root.addEventListener("click", e => {
      const tb = e.target.closest("[data-eptab]"); if (tb) return H.go("pharmacy", { ptab:tb.dataset.eptab });
      const ok = e.target.closest("[data-eczok]"); if (ok) { const o = (H.data.orders || []).find(x => x.id === ok.dataset.eczok); if (o) { o.durum = "Karşılandı"; H.saveData && H.saveData(); H.log("Eczane karşıladı", o.ad || ""); H.toast("İlaç karşılandı: " + (o.ad || "")); H.go("pharmacy", { ptab:"Karşılandı" }); } return; }
      const rd = e.target.closest("[data-eczred]"); if (rd) { const o = (H.data.orders || []).find(x => x.id === rd.dataset.eczred); if (!o) return; H.modal({ title:"İlaç reddet", body:`<div class="icd-form"><div class="fr" style="grid-column:1/-1"><label>Red nedeni</label><select data-f="n">${["Stokta yok", "Doz hatalı", "Etkileşim riski", "Mükerrer order", "Order iptal", "Diğer"].map(x => `<option>${x}</option>`).join("")}</select></div></div>`, actions:`<button class="btn" data-x>Vazgeç</button><button class="btn g" data-ok>Reddet</button>`, onMount(m) { m.querySelector("[data-ok]").onclick = () => { o.durum = "Reddedildi"; o.redNeden = m.querySelector('[data-f="n"]').value; H.saveData && H.saveData(); H.log("Eczane reddetti", o.ad || ""); H.closeModal(); H.toast("Reddedildi."); H.go("pharmacy", { ptab:"Reddedildi" }); }; } }); return; }
      const tr = e.target.closest("[data-ecztr]"); if (tr) { const o = (H.data.orders || []).find(x => x.id === tr.dataset.ecztr); if (!o) return; H.modal({ title:"Depoya transfer", body:`<div class="icd-form"><div class="fr" style="grid-column:1/-1"><label>Hedef depo</label><select data-f="d">${DEPO.map(x => `<option>${x}</option>`).join("")}</select></div></div>`, actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Transfer</button>`, onMount(m) { m.querySelector("[data-ok]").onclick = () => { o.durum = "Transfer"; o.transferDepo = m.querySelector('[data-f="d"]').value; H.saveData && H.saveData(); H.log("Eczane transfer", (o.ad || "") + " → " + o.transferDepo); H.closeModal(); H.toast("Transfer: " + o.transferDepo); H.go("pharmacy", { ptab:"Transfer" }); }; } }); return; }
      const mu = e.target.closest("[data-eczmuadil]"); if (mu) { const o = (H.data.orders || []).find(x => x.id === mu.dataset.eczmuadil); if (!o) return; const cat = (H.ILAC || []).concat(H.data.ilacEk || []); H.modal({ title:"Muadil seç · " + H.esc(o.ad || ""), body:`<div class="icd-form"><div class="fr" style="grid-column:1/-1"><label>Muadil ilaç</label><input data-f="m" list="ecz-mu" placeholder="Katalogdan muadil ara"><datalist id="ecz-mu">${cat.slice(0, 1500).map(d => `<option value="${H.esc(d[1])}">`).join("")}</datalist></div></div><p class="adm-sub">Aynı etken/gruptan alternatif; seçim order'a işlenir.</p>`, actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Uygula</button>`, onMount(m) { m.querySelector("[data-ok]").onclick = () => { const v = (m.querySelector('[data-f="m"]').value || "").trim(); if (v) { o.muadil = v; H.saveData && H.saveData(); H.log("Eczane muadil", (o.ad || "") + " ↔ " + v); } H.closeModal(); H.toast(v ? "Muadil: " + v : "Muadil seçilmedi"); H.go("pharmacy", { ptab:ept }); }; } }); return; }
      const dd = e.target.closest("[data-eczddi]"); if (dd) { const o = (H.data.orders || []).find(x => x.id === dd.dataset.eczddi); if (!o) return; const conc = (H.data.orders || []).filter(x => x.pid === o.pid && /İlaç|ilac|Reçete|ilaç/.test(x.cat || "") && x.id !== o.id); H.modal({ title:"Etkileşim sorgusu · " + H.esc(o.ad || ""), body:`<p class="adm-sub">Hastanın o an kullandığı diğer ilaçlar (tam DDI motoru ileri faz):</p>${conc.length ? `<div class="tw"><table class="t"><tbody>${conc.map(x => `<tr><td><b>${H.esc(x.ad || "")}</b></td><td class="adm-sub">${H.esc(x.detay || "")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="adm-sub">Başka aktif ilaç yok.</div>`}`, actions:`<button class="btn" data-x>Kapat</button>` }); return; }
      const iok = e.target.closest("[data-iadeok]"); if (iok) { const x = (H.data.ilacIade || []).find(y => y.id === iok.dataset.iadeok); if (!x) return; x.durum = "Kabul"; x.kabulEden = (H.state.user || {}).name || "Eczacı"; const st = (H.data.ilacStok || {})[x.kod]; if (st) st.stok += x.miktar; H.saveData && H.saveData(); H.log("İade kabul (stoğa geri)", (x.ad || "") + " · " + x.miktar + " adet"); H.toast("İade kabul: " + x.miktar + " adet stoğa eklendi"); H.go("pharmacy", { ptab:ept }); return; }
      const ird = e.target.closest("[data-iadered]"); if (ird) { const x = (H.data.ilacIade || []).find(y => y.id === ird.dataset.iadered); if (!x) return; H.modal({ title:"İade red", body:`<div class="icd-form"><div class="fr" style="grid-column:1/-1"><label>Red nedeni</label><select data-f="n">${["Ambalaj açılmış", "Soğuk zincir bozulmuş", "Miadı geçmiş", "Kullanılmış", "Diğer"].map(n => `<option>${n}</option>`).join("")}</select></div></div>`, actions:`<button class="btn" data-x>Vazgeç</button><button class="btn g" data-ok>İade reddet</button>`, onMount(m) { m.querySelector("[data-ok]").onclick = () => { x.durum = "Red"; x.redNeden = m.querySelector('[data-f="n"]').value; x.kabulEden = (H.state.user || {}).name || "Eczacı"; H.saveData && H.saveData(); H.log("İade red", (x.ad || "") + " · " + x.redNeden); H.closeModal(); H.toast("İade reddedildi: " + x.redNeden); H.go("pharmacy", { ptab:ept }); }; } }); return; }
      const zy = e.target.closest("[data-zayi]"); if (zy) { const st = (H.data.ilacStok || {})[zy.dataset.zayi]; if (!st) return; H.modal({ title:"Zayi düş · " + H.esc(st.ad), body:`<div class="icd-form"><div class="fr"><label>Miktar</label><input type="number" data-f="m" value="1" min="1" max="${st.stok}"></div><div class="fr"><label>Sebep</label><select data-f="s">${["Miadı geçti", "Kırık / dökük", "Soğuk zincir bozuldu", "Bozuldu", "Sayım farkı", "Diğer"].map(x => `<option>${x}</option>`).join("")}</select></div></div><p class="adm-sub">Zayi miktarı stoktan düşülür ve zayi kaydına yazılır (geri alınamaz).</p>`, actions:`<button class="btn" data-x>Vazgeç</button><button class="btn g" data-ok>Zayi düş</button>`, onMount(m) { m.querySelector("[data-ok]").onclick = () => { const mik = Math.max(1, Math.min(st.stok, +m.querySelector('[data-f="m"]').value || 1)), sebep = m.querySelector('[data-f="s"]').value; st.stok = Math.max(0, st.stok - mik); (H.data.ilacZayi = H.data.ilacZayi || []).unshift({ ad:st.ad, kod:st.kod, miktar:mik, sebep, tarih:(H.nowFull ? H.nowFull() : ""), by:(H.state.user || {}).name || "Eczacı" }); H.saveData && H.saveData(); H.log("Zayi düşüldü", st.ad + " · " + mik + " · " + sebep); H.closeModal(); H.toast("Zayi düşüldü: " + mik + " adet"); H.go("pharmacy", { ptab:ept }); }; } }); return; }
      const r = e.target.closest("[data-pid]"); if (r) H.go("patient", { pid:r.dataset.pid, tab:"ilac" });
    });
  } });

  /* CİHAZLAR → devices.js (24.09: biyomedikal modülü; hasta adı göstermez) */

  /* ================= YÖNETİCİ ÖZETİ ================= */
  H.register("summary", { title:() => "Yönetici özeti", perm:"summary", render(root) {
    const us = H.units();
    // 29.09: dönem seçimi "Alarm kalitesi" kutusunu değiştirir (sayılar 7 günlük örnekten orantılanır, oranlar aynı kalır).
    const per = H.summaryPeriod || 7, perLabel = per === 1 ? "Bugün" : per + " gün", sc = (n) => Math.max(0, Math.round(n * per / 7));
    root.innerHTML = `<div class="ph"><div><h2>Yönetici özeti</h2><p>${H.data.hospital.name} · 23 Eylül 2026</p></div><div class="r"><div class="seg">${[[1, "Bugün"], [7, "7 gün"], [30, "30 gün"]].map(([d, l]) => `<button data-per="${d}"${per === d ? ' class="on"' : ""}>${l}</button>`).join("")}</div><button class="btn" data-rep>${I("print")} Rapor al</button></div></div>
      <div class="sec" style="margin-top:0">Unutulan işler</div><div class="att">
        <div class="ac crit"><div class="i">${I("bell")}</div><b>3</b><span>alarm 10 dk'dan uzun yanıtsız kaldı · bu hafta</span></div>
        <div class="ac"><div class="i">${I("clip")}</div><b>4</b><span>karşı imzası atılmamış devir · en eskisi 2 gün</span></div>
        <div class="ac"><div class="i">${I("clock")}</div><b>${lateTasks().length || 11}</b><span>geciken hemşirelik değerlendirmesi · bugün</span></div>
        <div class="ac"><div class="i">${I("plug")}</div><b>2</b><span>cihaz 1 saatten uzun sessiz</span></div></div>
      <div class="g2" style="margin-top:14px"><div class="box"><h5>Günlük alarm sayısı</h5><div style="display:flex;gap:10px;align-items:baseline"><b style="font:700 30px 'Space Grotesk'">14</b><span class="mute" style="font-size:13px">bugün · <b style="color:var(--ok)">▼ %22</b> geçen haftaya göre</span></div>
          <div style="display:flex;align-items:flex-end;gap:6px;height:110px;margin:10px 0 6px">${[40,52,38,60,72,55,48,64,58,44,50,36,42,30].map((h, i) => `<i style="flex:1;height:${h}%;border-radius:6px 6px 3px 3px;background:${i === 13 ? "var(--pri)" : "color-mix(in srgb, var(--pri) 25%, var(--card2))"}"></i>`).join("")}</div><div class="mute" style="font-size:11.5px">son 14 gün</div></div>
        <div class="box"><h5>Alarm kalitesi · ${perLabel}</h5>${[["Yanıtlanan",sc(186) + " · %92","var(--ok)",92],["3 dk içinde yanıt",sc(148) + " · %73","var(--pri)",73],["Eskale edilen",sc(21) + " · %10","var(--high)",10],["Hatalı olarak işaretlenen",sc(34) + " · %17","var(--crit)",17]].map(([l, v, c, w]) => `<div style="margin:10px 0 12px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${l}</span><b class="mono">${v}</b></div><div style="height:7px;border-radius:4px;background:var(--card2);margin-top:6px;overflow:hidden"><i style="display:block;height:100%;width:${w}%;background:${c};border-radius:4px"></i></div></div>`).join("")}</div></div>
      <div class="sec">Birimler</div><div class="tw"><table class="t"><tr><th>Birim</th><th>Tür</th><th>Doluluk</th><th>Kritik / yüksek</th><th>Geciken iş</th><th>Açık alarm</th></tr>
        ${us.map(u => { const ps = H.data.patients.filter(p => H.bed(p.bed).unitId === u.id); return `<tr><td><b>${H.esc(u.tr)}</b></td><td>${H.kindName(u.kind)}<div class="mute" style="font-size:11px">${H.TIER[u.tier][0]}</div></td><td class="n">${u.beds.filter(b => b.status === "dolu").length} / ${u.beds.length}</td><td class="n">${ps.filter(p => p.risk === "crit" || p.risk === "high").length}</td><td class="n">${H.data.tasks.filter(t => t.state === "late" && ps.some(p => p.id === t.pid)).length}</td><td class="n">${H.data.alarms.filter(a => a.state === "open" && ps.some(p => p.id === a.pid)).length}</td></tr>`; }).join("")}</table></div>`;
    root.addEventListener("click", e => { if (e.target.closest("[data-rep]")) H.toast("Aylık kalite raporu hazırlanıyor.");
      const b = e.target.closest("[data-per]"); if (b) { H.summaryPeriod = +b.dataset.per; H.go("summary"); } });
  } });

  /* ================= YATAK DOLULUĞU (kabul, sorumlu hemşire, yönetim) =================
   * Klinik bilgi yok: vital, skor, tanı gösterilmez. Hasta adı yalnız adı görme yetkisi olan rolde (kabul, hemşire). */
  const OST = { bos:["Boş", "var(--ok)"], dolu:["Dolu", "var(--mute)"], temizlik:["Temizlikte", "var(--mid)"], bloke:["Bloke", "var(--crit)"], rezerve:["Rezerve", "var(--low)"] };
  const OCC = { unit:"", kind:"" };
  H.register("occupancy", { title:() => H.t("m_occupancy"), perm:"occupancy", render(root) {
    const all = H.units().filter(u => H.state.user.units.includes(u.id)), names = H.showNames();
    const us = all.filter(u => (!OCC.unit || u.id === OCC.unit) && (!OCC.kind || u.tier === OCC.kind));
    const cnt = (bs, st) => bs.filter(b => b.status === st).length, allB = all.flatMap(u => u.beds);
    const rooms = (u) => { const m = new Map(); u.beds.forEach(b => { if (!m.has(b.room)) m.set(b.room, []); m.get(b.room).push(b); }); return [...m]; };
    const tile = (b) => { const p = b.pid && H.pt(b.pid), st = OST[b.status];
      return `<button class="oc-b" style="--c:${st[1]}" data-ob="${b.id}" title="${H.esc(b.type)}${b.iso ? " · izolasyon odası" : ""}${b.oos ? " · kullanım dışı: " + H.esc(b.oosWhy || "") : ""}">
        <b>${b.no}</b><small>${p ? (names ? H.esc(p.temp ? "GEÇİCİ · " + (p.proto || "") : p.name.split(" ")[0] + " " + (p.name.split(" ")[1] || "")[0] + ".") : "Dolu") : b.oos ? "Kullanım dışı" : st[0]}</small></button>`; };
    root.innerHTML = `<style>.oc-rooms{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}.oc-room{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px}
      .oc-room>small{display:flex;gap:6px;align-items:center;font:700 10.5px Figtree;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin-bottom:6px}.oc-bs{display:flex;gap:6px;flex-wrap:wrap}
      .oc-b{flex:1 1 70px;min-width:0;text-align:left;border:1.5px solid color-mix(in srgb,var(--c) 60%,transparent);background:color-mix(in srgb,var(--c) 12%,var(--card));border-radius:10px;padding:6px 8px;cursor:pointer;color:var(--ink)}
      .oc-b b{font:700 12.5px "JetBrains Mono";display:block}.oc-b small{display:block;font:600 11px Figtree;color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style>
      <div class="ph"><div><h2>${H.t("m_occupancy")}</h2><p>Yalnız yatak durumu · klinik bilgi bu ekranda yok${names ? "" : " · hasta adı gösterilmez"}</p></div>
        <div class="r">${H.can("admission") ? `<button class="btn p" data-go="admission">${I("userPlus")} Hasta kabul</button>` : ""}</div></div>
      <div class="att"><div class="ac ok"><div class="i">${I("bed")}</div><b>${cnt(allB, "bos")}</b><span>boş yatak · hasta atanabilir</span></div>
        <div class="ac"><div class="i">${I("clock")}</div><b>${cnt(allB, "temizlik")}</b><span>temizlikte</span></div>
        <div class="ac"><div class="i">${I("star")}</div><b>${cnt(allB, "rezerve")}</b><span>rezerve</span></div>
        <div class="ac ${cnt(allB, "bloke") ? "crit" : "ok"}"><div class="i">${I("x")}</div><b>${cnt(allB, "bloke")}</b><span>bloke / kullanım dışı</span></div></div>
      <div class="adm-bar" style="margin-top:14px"><select data-of="unit"><option value="">Tüm birimler (${all.length})</option>${all.map(u => `<option value="${u.id}" ${OCC.unit === u.id ? "selected" : ""}>${H.esc(u.tr)}</option>`).join("")}</select>
        <div class="seg" data-ok>${[["", "Hepsi"], ["tam", "Yoğun bakım"], ["ara", "Servis"], ["op", "Acil ve günübirlik"]].map(([k, l]) => `<button data-v="${k}" class="${OCC.kind === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <div class="adm-lg">${Object.entries(OST).map(([k, [l, c]]) => `<span style="--c:${c}">${l}</span>`).join("")}</div>
      ${us.map(u => `<div class="sec">${H.esc(u.tr)} <span class="pill">${H.KIND[u.kind]}</span> <span class="pill">${H.data.hospital.buildings.find(b => b.id === u.building).name.split(" · ")[0]} · ${H.floorText(u.floor)}</span><small>${cnt(u.beds, "dolu")} / ${u.beds.length} dolu · ${cnt(u.beds, "bos")} boş</small></div>
        <div class="oc-rooms">${rooms(u).map(([r, bs]) => `<div class="oc-room"><small>Oda ${H.esc(r)}${bs.some(b => b.iso) ? ` <span class="tag w" style="padding:1px 6px">izolasyon</span>` : ""}</small><div class="oc-bs">${bs.map(tile).join("")}</div></div>`).join("")}</div>`).join("") || `<div class="empty">Seçime uyan birim yok.</div>`}`;
    root.addEventListener("change", e => { const f = e.target.closest("[data-of]"); if (f) { OCC.unit = f.value; H.renderApp(); } });
    root.addEventListener("click", e => {
      const k = e.target.closest("[data-ok] button"); if (k) { OCC.kind = k.dataset.v; return H.renderApp(); }
      if (e.target.closest("[data-go]")) return H.go("admission");
      const t = e.target.closest("[data-ob]"); if (!t) return; const b = H.bed(t.dataset.ob), u = H.unit(b.unitId), p = b.pid && H.pt(b.pid);
      const acts = b.status === "temizlik" ? `<button class="btn p" data-cl>${I("ok")} Temizlik bitti · boş</button>` : b.status === "bos" && H.can("admission") ? `<button class="btn p" data-ad>${I("plus")} Bu yatağa hasta kabul</button>` : "";
      H.modal({ title:`Yatak ${b.no}`, body:`<div class="kv"><span>Birim</span><b>${H.esc(u.tr)}</b></div><div class="kv"><span>Oda</span><b>${H.esc(b.room)}</b></div><div class="kv"><span>Yatak tipi</span><span>${H.esc(b.type)}${b.iso ? " · izolasyon" : ""}</span></div>
          <div class="kv"><span>Durum</span><span>${OST[b.status][0]}${b.oos ? " · kullanım dışı (" + H.esc(b.oosWhy || "") + ")" : ""}</span></div>${p ? `<div class="kv"><span>Hasta</span><span>${names ? H.esc(p.name) : "Dolu · ad gösterilmez"}</span></div>` : ""}
          <p class="mute" style="font-size:12px;margin:10px 0 0">Kullanım dışı yapma ve yatak ekleme Yönetim → Hastane yapısı'ndan yapılır.</p>`,
        actions:`<button class="btn" data-x>Kapat</button>${acts}`,
        onMount(m) { m.addEventListener("click", ev => {
          if (ev.target.closest("[data-cl]")) { b.status = "bos"; H.log("Yatak temizlendi", `${b.no} · ${u.tr}`); H.closeModal(); H.toast(`${b.no} boş · hasta atanabilir`); H.renderApp(); }
          if (ev.target.closest("[data-ad]")) { H.closeModal(); H.go("admission", { bed:b.id }); } }); } });
    });
  } });

  /* ================= KALİTE GÖSTERGELERİ =================
   * Kişi değil süreç ölçülür: hasta adı yok, yatak no var. Sayılar ÖRNEK veridir; gerçek üründe denetim kaydı ve alarm zaman damgalarından hesaplanır. */
  const QD = { range:"7" };
  H.register("quality", { title:() => H.t("m_quality"), perm:"quality", render(root) {
    const us = H.units().filter(H.isClinical);
    const bar = (l, v, pct, c, hint) => `<div style="margin:10px 0 12px" title="${hint || ""}"><div style="display:flex;justify-content:space-between;font-size:13px;gap:8px"><span>${l}</span><b class="mono">${v}</b></div><div style="height:7px;border-radius:4px;background:var(--card2);margin-top:6px;overflow:hidden"><i style="display:block;height:100%;width:${pct}%;background:${c};border-radius:4px"></i></div></div>`;
    const seed = (s) => (s.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 37) % 100;
    root.innerHTML = `<div class="ph"><div><h2>Kalite göstergeleri</h2><p>Süreç ölçülür, kişi değil · hasta adı gösterilmez</p></div>
        <div class="r"><div class="seg" data-qr>${[["1", "Dün"], ["7", "7 gün"], ["30", "30 gün"]].map(([k, l]) => `<button data-v="${k}" class="${QD.range === k ? "on" : ""}">${l}</button>`).join("")}</div><button class="btn" data-rep>${I("print")} Rapor al</button></div></div>
      <div class="att"><div class="ac"><div class="i">${I("bell")}</div><b>2:40</b><span>alarm ilk yanıt süresi · ortanca (dk:sn)</span></div>
        <div class="ac crit"><div class="i">${I("alert")}</div><b>3</b><span>alarm 10 dk'dan uzun yanıtsız</span></div>
        <div class="ac"><div class="i">${I("clip")}</div><b>%94</b><span>devirlerin karşı imzası 30 dk içinde</span></div>
        <div class="ac"><div class="i">${I("clock")}</div><b>%81</b><span>hemşirelik değerlendirmesi zamanında</span></div></div>
      <div class="g2" style="margin-top:14px">
        <div class="box"><h5>Alarm süreci</h5>${bar("3 dk içinde yanıtlanan", "%73", 73, "var(--ok)")}${bar("Hekime eskale edilen", "%18", 18, "var(--mid)")}${bar("Hızlı yanıt ekibine ulaşan", "%4", 4, "var(--high)")}${bar("Hatalı / artefakt olarak kapatılan", "%17", 17, "var(--crit)", "Yüksekse eşikler gözden geçirilmeli")}</div>
        <div class="box"><h5>Güvenlik olayları <span class="r mute">hemşirelik formlarından</span></h5>${bar("Düşme", "1", 10, "var(--high)")}${bar("Yeni bası yarası (evre 2+)", "2", 20, "var(--high)")}${bar("Yüksek düşme riskli hastada önlem kaydı", "%88", 88, "var(--ok)")}${bar("Yüksek bası yarası riskinde pozisyon zamanında", "%76", 76, "var(--mid)")}</div></div>
      <div class="sec">Birimlere göre <small>yalnız klinik izlem yapılan birimler</small></div>
      <div class="tw"><table class="t"><tr><th>Birim</th><th>Alarm yanıtı (ortanca)</th><th>10 dk+ yanıtsız</th><th>Devir imzası</th><th>Değerlendirme zamanında</th><th>Cihaz kesintisi</th></tr>
        ${us.map(u => { const s = seed(u.id); return `<tr><td><b>${H.esc(u.tr)}</b><div class="mute" style="font-size:11.5px">${H.KIND[u.kind]}</div></td><td class="n">${1 + s % 4}:${String(s % 60).padStart(2, "0")}</td><td class="n">${s % 3}</td><td class="n">%${88 + s % 12}</td><td class="n">%${70 + s % 28}</td><td class="n">${s % 5 ? (s % 5) * 7 + " dk" : "—"}</td></tr>`; }).join("")}</table></div>
      <div class="sec">İncelenecek olaylar <small>yatak no ile · kişi adı yok</small></div>
      <div class="tw"><table class="t"><tr><th>Zaman</th><th>Birim · yatak</th><th>Olay</th><th>Durum</th></tr>
        ${[["23.09 21:38", "Erişkin YB · REA01", "Kritik alarm 7 dk 40 sn yanıtsız, hızlı yanıta ulaştı", "incelenecek"], ["23.09 14:05", "Dahiliye · DAX01", "Yüksek düşme riski · 16:00 değerlendirmesi 2 sa gecikti", "incelenecek"], ["22.09 03:12", "Erişkin YB · REA07", "Monitör 42 dk veri göndermedi", "biyomedikale iletildi"], ["21.09 19:40", "Genel Cerrahi · CER03", "Devir karşı imzası 3 sa sonra atıldı", "kapandı"]].map(([t, w, o, st]) => `<tr><td class="mono">${H.ts(t)}</td><td>${w}</td><td>${o}</td><td><span class="tag ${st === "incelenecek" ? "w" : ""}">${st}</span></td></tr>`).join("")}</table></div>
      <div class="note i" style="margin-top:12px">Kalite ekranı kişileri değil süreçleri gösterir. Bir olayın hangi hastaya ait olduğunu yalnız o birimin sorumlu hekimi görebilir.</div>`;
    root.addEventListener("click", e => { const q = e.target.closest("[data-qr] button"); if (q) { QD.range = q.dataset.v; return H.renderApp(); } if (e.target.closest("[data-rep]")) { H.log("Kalite raporu alındı", QD.range + " gün"); H.toast("Kalite raporu hazırlanıyor (örnek)."); } });
  } });

  /* ================= AYARLAR ================= */
  /* Ayarlar ve Profil: ayarlar.js (24.09, 3. oturum). */
})();

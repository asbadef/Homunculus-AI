/* Homunculus prototip v1 — ana ekranlar: yatak paneli, alarmlar, devir, hızlı yanıt, eczane, cihazlar, yönetici özeti, ayarlar, profil. */
(function () {
  const H = window.H, I = H.icon;
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
      <div class="seg" style="margin-bottom:12px" data-enctabs>${encTabs.map(([k, l]) => `<button data-enc="${k}" class="${enc === k ? "on" : ""}">${l}${k !== "hepsi" ? ` (${pts.filter(p => H.encOf(p) === k).length})` : ""}</button>`).join("")}</div>
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
  } });

  /* ================= RANDEVU ================= */
  const randevular = () => (H.data.randevular = H.data.randevular || seedRandevu());
  function seedRandevu() {
    const now = new Date(), d = (h, m) => { const x = new Date(now); x.setHours(h, m, 0, 0); return x.toISOString().slice(0, 16); };
    return [
      { id:"rnd1", hasta:"Günel Məmmədova", bolum:"Mamalıq-Ginekologiya", doktor:"Dr. Kamran Rzayev", tarih:d(9, 0), durum:"Bekliyor", not:"Hamiləlik izləmi" },
      { id:"rnd2", hasta:"Orxan Əliyev", bolum:"Kardiologiya", doktor:"Dr. Kamran Rzayev", tarih:d(9, 30), durum:"Bekliyor", not:"Hipertansiyon kontrolü" },
      { id:"rnd3", hasta:"Elvin Səmədov", bolum:"Oftalmologiya", doktor:"Dr. Kamran Rzayev", tarih:d(10, 15), durum:"Geldi", not:"Check-up" },
    ];
  }
  const RND_DURUM = ["Bekliyor", "Geldi", "Tamamlandı", "Gelmedi", "İptal"];
  const RND_TUR = ["Poliklinik", "Cihaz", "Video klinik", "Check-up", "Kemoterapi"];
  H.register("randevu", { title:() => "Randevu", perm:["admission", "beds"], render(root, params = {}) {
    const all = randevular(), f = params.durum || "hepsi", GECMIS = ["Tamamlandı", "Gelmedi", "İptal"];
    const list = f === "hepsi" ? all : f === "gecmis" ? all.filter(r => GECMIS.includes(r.durum)) : all.filter(r => r.durum === f);
    root.innerHTML = `<div class="ph"><div><h2>Randevu${f === "gecmis" ? " geçmişi" : ""}</h2><p>${list.length} randevu · poliklinik / cihaz / bölüm takvimi (tasarım)</p></div><div class="r"><button class="btn p" data-rndnew>${I("plus")} Yeni randevu</button></div></div>
      <div class="seg" style="margin-bottom:12px">${[["hepsi", "Hepsi"], ["gecmis", "Geçmiş"], ...RND_DURUM.map(x => [x, x])].map(([k, l]) => `<button data-rf="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="tw"><table class="t"><thead><tr><th style="width:150px">Saat</th><th>Hasta</th><th>Bölüm</th><th>Doktor</th><th>Not</th><th style="width:120px">Durum</th><th style="width:44px"></th></tr></thead><tbody>
      ${list.length ? list.slice().sort((a, z) => a.tarih.localeCompare(z.tarih)).map(r => `<tr><td class="mono adm-sub">${H.esc((r.tarih || "").replace("T", " "))}${r.sms ? ` ${I("bell") || ""}` : ""}</td><td><b>${H.esc(r.hasta)}</b></td><td>${H.esc(r.bolum)}${r.tur ? ` <span class="tag">${H.esc(r.tur)}</span>` : ""}</td><td class="adm-sub">${H.esc(r.doktor)}</td><td class="adm-sub">${H.esc(r.not || "")}</td><td><select data-rndst="${r.id}">${RND_DURUM.map(s => `<option${r.durum === s ? " selected" : ""}>${s}</option>`).join("")}</select></td><td><button class="btn g sm" data-rnddel="${r.id}" title="Sil">${I("trash") || "×"}</button></td></tr>`).join("") : `<tr><td colspan="7" class="mute" style="padding:20px;text-align:center">Bu durumda randevu yok.</td></tr>`}
      </tbody></table></div>`;
    root.onchange = (e) => { const st = e.target.closest("[data-rndst]"); if (st) { const r = all.find(x => x.id === st.dataset.rndst); if (r) { r.durum = st.value; H.log("Randevu durumu", r.hasta + " · " + st.value); } } };
    root.onclick = (e) => {
      const rf = e.target.closest("[data-rf]"); if (rf) return H.go("randevu", { durum:rf.dataset.rf });
      const del = e.target.closest("[data-rnddel]"); if (del) { const i = all.findIndex(x => x.id === del.dataset.rnddel); if (i >= 0 && confirm("Bu randevu silinsin mi?")) { all.splice(i, 1); H.toast("Randevu silindi", "w"); H.go("randevu", params); } return; }
      if (e.target.closest("[data-rndnew]")) return rndForm();
    };
    function rndForm() {
      const hekims = (H.data.users || []).filter(u => u.role === "hekim"), bols = H.klinikBolumler ? H.klinikBolumler() : (H.data.bolumler || []);
      const now = new Date().toISOString().slice(0, 16);
      H.modal({ title:"Yeni randevu", body:`<div class="icd-form">
        <div class="fr"><label>Hasta</label><input data-f="hasta" placeholder="Hasta adı"></div>
        <div class="fr"><label>Randevu türü</label><select data-f="tur">${RND_TUR.map(x => `<option>${H.esc(x)}</option>`).join("")}</select></div>
        <div class="fr"><label>Bölüm</label><input data-f="bolum" list="rnd-bol" placeholder="Bölüm"><datalist id="rnd-bol">${bols.map(b => `<option>${H.esc(b.ad)}</option>`).join("")}</datalist></div>
        <div class="fr"><label>Doktor</label><select data-f="doktor"><option value="">—</option>${hekims.map(u => `<option>${H.esc(u.name)}</option>`).join("")}</select></div>
        <div class="fr"><label>Tarih / saat</label><input type="datetime-local" data-f="tarih" value="${now}"></div>
        <div class="fr"><label>Süre (dk)</label><input data-f="sure" type="number" min="5" step="5" value="15"></div>
        <div class="fr"><label>Not</label><input data-f="not" placeholder="Geliş nedeni"></div>
        <div class="fr"><label>Hatırlatma</label><label class="dc-chk"><input type="checkbox" data-f="sms" checked> SMS ile hatırlatma gönder</label></div></div>`,
        actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Kaydet</button>`,
        onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = s => (m.querySelector(`[data-f="${s}"]`).value || "").trim();
          if (!g("hasta")) { H.toast("Hasta adı gerekli.", "w"); return; }
          const sms = m.querySelector('[data-f="sms"]').checked;
          all.unshift({ id:"rnd" + Date.now(), hasta:g("hasta"), tur:m.querySelector('[data-f="tur"]').value, bolum:g("bolum"), doktor:m.querySelector('[data-f="doktor"]').value, tarih:m.querySelector('[data-f="tarih"]').value, sure:+g("sure") || 15, durum:"Bekliyor", not:g("not"), sms });
          H.log("Randevu oluşturuldu", g("hasta")); H.toast("Randevu eklendi" + (sms ? " · SMS hatırlatma açık" : "")); H.closeModal(); H.go("randevu", params); }; } });
    }
  } });

  /* ================= VEZNE / FATURALAMA ================= */
  const faturalar = () => (H.data.faturalar = H.data.faturalar || [
    { id:"fat1", hasta:"Günel Məmmədova", protokol:"Ayaktan · Hamiləlik izləmi", kurum:"İcbari Tibbi Sığorta (SAMHI)", toplam:85, katilim:0, durum:"Bekliyor" },
    { id:"fat2", hasta:"Orxan Əliyev", protokol:"Ayaktan · Kardioloji", kurum:"Özel ödeme", toplam:60, katilim:60, durum:"Bekliyor" },
    { id:"fat3", hasta:"Elvin Səmədov", protokol:"Günübirlik · Check-up", kurum:"Kurum anlaşması", toplam:240, katilim:48, durum:"Ödendi" },
  ]);
  // Bankolar tercihen admin "Kayıt Seçenekleri" > banko listesinden; yoksa yedek.
  const BANKOLAR = () => (H.data.secenekler && H.data.secenekler.banko && H.data.secenekler.banko.length ? H.data.secenekler.banko : (H.data.bankolar = H.data.bankolar || ["Yatan Kasası", "Estetik Kasası", "Pediatri Kasası", "Preop Kasası", "Eczane Kasası", "Ofis Kasası", "Acil Kasası"]));
  const ODEME_TIP = ["Kart", "Nakit", "Havale"];
  const GFK_DURUM = ["Hasta faturası kesilmiş", "Kurum faturası kesilmiş", "Provizyonu alınmamış", "Hasta faturası kesilmemiş"];
  const gfkRows = () => (H.data.gfk = H.data.gfk || [
    { proto:"50873355", hasta:"Günel Məmmədova", gelis:"Ayaktan", ptip:"Genel muayene", bolum:"Kardiologiya", durum:"Hasta faturası kesilmiş" },
    { proto:"50874258", hasta:"Orxan Əliyev", gelis:"Ayaktan", ptip:"Genel muayene", bolum:"Daxili Xəstəliklər", durum:"Provizyonu alınmamış" },
    { proto:"50875215", hasta:"Elvin Səmədov", gelis:"Günübirlik", ptip:"Check-up", bolum:"Check Up", durum:"Kurum faturası kesilmiş" },
    { proto:"50876568", hasta:"Ayan Hümbətova", gelis:"Ayaktan", ptip:"Kontrol", bolum:"Dermatologiya", durum:"Hasta faturası kesilmemiş" },
  ]);
  const EVRAK_DURUM = ["Veznede", "Vezneden teslim edildi", "Medikal muhasebede", "Vezneye iade edildi"];
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
    { id:"io1", tarih:"22.10.2026 10:47", hasta:"Murat Can Aslan", isteyen:"Esli Daşdiyeva", islem:"Fibroblast deri/kozmetoloji tatbiqi", tutar:1250, oran:40, durum:"Onay bekliyor", grup:"Doktorlar Tatbiq", zincir:zinc([["Misafir Hizmetleri", "Murat Can Aslan", "Onaylandı"], ["Üst Yönetim", "Ahmet Hakan"], ["Mali İşler", "Ülvi İsgenderov"]]) },
    { id:"io2", tarih:"21.10.2026 12:26", hasta:"Nermin Süleymanova", isteyen:"Şöle Şıxeliyeva", islem:"Muayene paketi", tutar:41, oran:2.27, durum:"Onay bekliyor", grup:"Hastaya İskonto", zincir:zinc([["Vezne", "Esli Daşdiyeva"], ["Mali İşler", "Ülvi İsgenderov"]]) },
    { id:"io3", tarih:"21.10.2026 16:18", hasta:"Brilyand Memmedova", isteyen:"Esli Daşdiyeva", islem:"Radyoloji tetkik", tutar:400, oran:15, durum:"Onay bekliyor", grup:"Doktorlar Tatbiq", zincir:zinc([["Bölüm Sorumlusu", "Dr. Elxan"], ["Üst Yönetim", "Ahmet Hakan"]]) },
    { id:"io4", tarih:"19.10.2026 10:40", hasta:"Sure Babayeva", isteyen:"Esli Daşdiyeva", islem:"Laboratuvar paketi", tutar:530, oran:19.14, durum:"Onaylandı", grup:"Hastaya İskonto", zincir:zinc([["Vezne", "Esli Daşdiyeva", "Onaylandı"], ["Mali İşler", "Ülvi İsgenderov", "Onaylandı"]]) },
  ]);
  const IADE_DURUM = ["Onay bekliyor", "Onaylandı", "Reddedildi", "İade tamamlandı"];
  const iadeRows = () => (H.data.iadeTalep = H.data.iadeTalep || [
    { id:"ia1", tip:"Avans İade", tarih:"21.10.2026 15:55", eden:"Sebine Bağırova", tutar:2.90, dep:"Genel İade", aciklama:"Doktor ilaca gerek görmedi", durum:"Onay bekliyor", proto:"50894485", zincir:zinc([["Misafir Hizmetleri", "Murat Can Aslan", "Onaylandı"], ["Üst Yönetim", "Ahmet Hakan"], ["Mali İşler", "Ülvi İsgenderov"]]) },
    { id:"ia2", tip:"Avans İade", tarih:"21.10.2026 13:36", eden:"Şebnem Süleymanlı", tutar:607.02, dep:"Genel İade", aciklama:"Depozitten qalan məbləğ", durum:"Onay bekliyor", proto:"50880632", zincir:zinc([["Vezne", "Şebnem Süleymanlı"], ["Mali İşler", "Ülvi İsgenderov"]]) },
    { id:"ia3", tip:"Fatura İade", tarih:"20.10.2026 17:15", eden:"Helime Ehmedova", tutar:30, dep:"Protokolden Protokola", aciklama:"Anadan yenidoğmuşa iade", durum:"Onaylandı", proto:"50892002", zincir:zinc([["Vezne", "Helime Ehmedova", "Onaylandı"]]) },
    { id:"ia4", tip:"Avans İade", tarih:"20.10.2026 12:59", eden:"Aytac Rüstemli", tutar:100, dep:"Genel İade", aciklama:"Anestezi olmadığı üçün", durum:"Onay bekliyor", proto:"50893269", zincir:zinc([["Vezne", "Aytac Rüstemli"], ["Üst Yönetim", "Ahmet Hakan"]]) },
  ]);
  const PTIP_ETKI = [["hastaFark", "Hastaya fark atılmaz (hasta payı 0)"], ["sgkKatilim", "SGK katılım payı oluşmaz"], ["avans", "Avans alınabilir"], ["otoKapanma", "Otomatik kapanmaz"], ["islemHavuz", "İşlem havuzuna düşer"], ["doktorsuz", "Doktorsuz protokol"], ["nobetsiz", "Nöbetsiz protokol"]];
  const hzName = (r) => (H.state.lang === "TR" ? (r[2] || r[1]) : (r[1] || r[2])) || r[1] || r[2] || "";
  // Ad maskeleme: isim görme yetkisi olmayan (ör. yönetici, names:false) için baş harf maskesi.
  const vzName = (n) => (H.showNames && !H.showNames()) ? (String(n || "").trim().split(/\s+/).map(w => w ? w[0] + "***" : "").join(" ") || "—") : (n || "—");
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
    if (name === "Reçete listesi") return { cols:["Reçete no", "Hasta", "Tür", "Tarih"], rows:[["RX-50894308", "Nobatxanım Dadaşova", "Normal reçete", "21.10.2026"], ["RX-50893071", "Elvin Hüseynov", "İlaç reçetesi", "20.10.2026"], ["RX-50889384", "Günel Məmmədova", "Gözlük reçetesi", "14.10.2026"]] };
    if (name === "Hasta arama") { const L = (H.data.patients || []); return { cols:["Hasta no", "Hasta", "Cinsiyet", "Yaş"], pids:L.map(p => p.id), rows:L.map(p => [p.hn || "—", vzName(p.name), p.sex === "E" ? "Erkek" : "Kadın", p.age || "—"]), note:"Satıra tıklayınca hasta bilgisi açılır · ara kutusu ad/no ile filtreler." }; }
    if (name === "Doktor iş listesi") { const g = {}; (H.data.patients || []).forEach(p => { const d = (H.data.users || []).find(u => u.u === p.attending); const n = d ? d.name : (p.attending || "—"); (g[n] = g[n] || []).push(p); });
      const rows = [], pids = []; Object.entries(g).forEach(([d, ps]) => ps.forEach(p => { rows.push([d, vzName(p.name), (H.ENC[H.encOf(p)] || {}).label || H.encOf(p), H.ozelOnay(p) ? "Ödeme OK" : "Ödeme bekliyor"]); pids.push(p.id); })); return { cols:["Doktor", "Hasta", "Geliş", "Özel onay"], pids, rows }; }
    if (name === "Randevu arama") return { cols:["Tarih", "Hasta", "Bölüm", "Doktor", "Durum"], rows:[["22.10.2026 09:00", "Nobatxanım Dadaşova", "Oftalmologiya", "Dr. Əhməd Abdullayev", "Bekliyor"], ["22.10.2026 10:30", "Orxan Əliyev", "Daxili", "Dr. Kamran Rzayev", "Geldi"]], note:"Örnek randevular." };
    if (name === "Gizli / VIP hasta listesi") return { cols:["Hasta no", "Hasta", "Not"], rows:[["0260215", "VIP Hasta 1", "Gizli · yalnız yetkili görür"], ["0260233", "VIP Hasta 2", "Gizli"]], note:"Gizli/VIP hastalar maskeli; gerçekte özel yetki ile açılır." };
    return null;
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
      body:`<div class="adm-bar" style="margin-bottom:8px"><span class="tag">Kurum: ${H.esc(kurum)}</span><span class="spacer"></span><div class="seg"><button data-hf2="bekleyen" class="on">Fatura bekleyen</button><button data-hf2="tumu">Tümü</button></div></div>
        <div class="r" style="gap:6px;margin-bottom:8px;flex-wrap:wrap"><button class="btn p sm" data-hfatura>Fatura kes</button><button class="btn sm" data-hparcali>Parçalı fatura</button><button class="btn sm" data-hindirim>İndirime gönder</button><button class="btn sm" data-hproviz>Provizyon iste</button><button class="btn sm" data-hpaket>Panel paket</button><button class="btn g sm" data-hbekle>Bekleyene at</button></div>
        <div class="tw"><table class="t"><thead><tr><th style="width:34px"><input type="checkbox" data-hall></th><th>İşlem</th><th>Tür</th><th style="width:90px">Fiyat</th><th style="width:120px">Durum</th></tr></thead><tbody data-hbody></tbody></table></div>
        <div class="adm-bar" style="margin-top:10px"><b>Seçili toplam: <span data-htop>0</span> ₼</b><span class="spacer"></span><span class="adm-sub">Satıra sağ tıklayın: Doktor · Tarih · Tutar · Yeniden fiyatlandır · Özel onay · Durum · Yazdır · Diğer</span></div>`,
      actions:`<button class="btn" data-x>Kapat</button>`,
      onMount(m) {
        const body = m.querySelector("[data-hbody]"), topEl = m.querySelector("[data-htop]");
        let f2 = "bekleyen";
        const draw = () => { const ords = (H.data.orders || []).filter(o => o.pid === p.id && (f2 === "tumu" || o.durum !== "Faturalandı"));
          body.innerHTML = ords.length ? ords.map(o => `<tr data-hrow="${o.id}" style="cursor:context-menu"><td><input type="checkbox" data-hsel="${o.id}" ${o.durum === "Faturalandı" ? "disabled" : ""}></td><td><b>${H.esc(o.ad || o.cat || "—")}</b><div class="adm-sub" style="font-size:11px">${H.esc(o.at || "")} · ${H.esc(o.by || "")}</div></td><td class="adm-sub">${H.esc(o.cat || "")}</td><td class="n">${fiyatOf(o)} ₼</td><td><span class="tag ${o.durum === "Faturalandı" ? "ok" : ""}">${H.esc(o.durum || "İstendi")}</span></td></tr>`).join("") : `<tr><td colspan="5" class="mute" style="padding:16px;text-align:center">${f2 === "bekleyen" ? "Fatura bekleyen işlem yok." : "İşlem yok. Doktor istem yapınca ya da vezne tetkik isteyince burada görünür."}</td></tr>`;
          recompute(); };
        m.querySelectorAll("[data-hf2]").forEach(b => b.onclick = () => { f2 = b.dataset.hf2; m.querySelectorAll("[data-hf2]").forEach(x => x.classList.toggle("on", x === b)); draw(); });
        ["hparcali:Parçalı fatura", "hproviz:Provizyon iste", "hpaket:Panel paket"].forEach(s => { const [k, l] = s.split(":"); const el = m.querySelector("[data-" + k + "]"); if (el) el.onclick = () => H.toast(l + " · tasarım", "w"); });
        body.oncontextmenu = (e) => { const tr = e.target.closest("[data-hrow]"); if (!tr) return; e.preventDefault();
          vzMenu(e, ["Doktor değiştir", "Tarih değiştir", "Tutar düzelt", "Yeniden fiyatlandır", "Özel onay", "Durum", "Yazdır", "Diğer"].map(a => [a, () => H.toast(a + " · tasarım", "w")])); };
        const selected = () => [...m.querySelectorAll("[data-hsel]:checked")].map(c => (H.data.orders || []).find(o => o.id === c.dataset.hsel)).filter(Boolean);
        const recompute = () => { topEl.textContent = selected().reduce((a, o) => a + fiyatOf(o), 0); };
        draw();
        body.addEventListener("change", recompute);
        m.querySelector("[data-hall]").onchange = (e) => { m.querySelectorAll("[data-hsel]:not(:disabled)").forEach(c => c.checked = e.target.checked); recompute(); };
        m.querySelector("[data-hfatura]").onclick = () => { if (!H.protoOpen(p)) { H.toast("Protokol kapalı · fatura kesilemez.", "e"); return; } const s = selected(); if (!s.length) { H.toast("İşlem seçin.", "w"); return; }
          const top = s.reduce((a, o) => a + fiyatOf(o), 0); s.forEach(o => o.durum = "Faturalandı"); p.faturaKesildi = true;
          H.log("Fatura kesildi (işlem havuzu)", vzName(p.name) + " · " + s.length + " işlem · " + top + " ₼"); H.toast("Fatura kesildi: " + top + " ₼ (" + s.length + " işlem)"); draw(); };
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
          (H.data.orders = H.data.orders || []).unshift({ id:"ord" + Date.now() + Math.floor(Math.random() * 1e3), pid:p.id, cat, ad, kod, by:(H.state.user || {}).name || "Vezne", at:H.nowFull ? H.nowFull() : H.now(), durum:"İstendi", vzIstek:true });
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
      onMount(m) { m.querySelector("[data-yeni]").onclick = () => { H.closeModal(); H.go("admission"); }; } });
  }
  function railModal(lbl, rd) {
    const head = `<tr>${rd.cols.map(c => `<th>${H.esc(c)}</th>`).join("")}</tr>`;
    const rowHtml = (r, i) => `<tr${rd.pids ? ` data-open="${rd.pids[i]}" style="cursor:pointer"` : ""}>${r.map(c => `<td>${H.esc(String(c))}</td>`).join("")}</tr>`;
    H.modal({ title:lbl, wide:true,
      body:`<div class="adm-bar"><input data-rq placeholder="Ara (ad, no, ...)" style="flex:1"></div>
        <div class="tw"><table class="t"><thead>${head}</thead><tbody data-rbody>${rd.rows.length ? rd.rows.map(rowHtml).join("") : `<tr><td colspan="${rd.cols.length}" class="mute" style="padding:16px;text-align:center">Kayıt yok.</td></tr>`}</tbody></table></div>
        ${rd.note ? `<p class="adm-sub" style="margin-top:8px">${H.esc(rd.note)}</p>` : ""}`,
      actions:`<button class="btn" data-x>Kapat</button>`,
      onMount(m) {
        const body = m.querySelector("[data-rbody]"), q = m.querySelector("[data-rq]");
        if (q) q.addEventListener("input", () => { const t = q.value.trim().toLocaleLowerCase("tr");
          body.innerHTML = (t ? rd.rows.map((r, i) => [r, i]).filter(([r]) => r.join(" ").toLocaleLowerCase("tr").includes(t)) : rd.rows.map((r, i) => [r, i]))
            .map(([r, i]) => rowHtml(r, i)).join("") || `<tr><td colspan="${rd.cols.length}" class="mute" style="padding:16px;text-align:center">Eşleşme yok.</td></tr>`; });
        if (rd.pids) body.addEventListener("click", (e) => { const tr = e.target.closest("[data-open]"); if (tr) { H.closeModal(); vzHastaModal(tr.dataset.open); } });
      } });
  }
  H.register("vezne", { title:() => H.t("m_vezne"), perm:["admission", "summary"], render(root, params = {}) {
    const bankolar = BANKOLAR(), banko = H.state.vezneBanko || bankolar[0], donemNo = H.data.vezneDonemNo || (H.data.vezneDonemNo = 54038), tab = params.tab || "giris";
    const donemAcik = H.data.vezneDonemAcik !== false, donemYetki = H.can("vezne_donem");
    const TABS = [["giris", "Giriş"], ["fatura", "Faturalar"], ["fiyat", "Fiyat verme"], ["indirim", "İndirim onay"], ["iade", "İade"], ["gfk", "GFK takip"], ["evrak", "Evrak takip"]];
    const bar = `<div class="ist-lock ${donemAcik ? "" : "closed"}">${I(donemAcik ? "key" : "lock") || ""}<span>Dönem <b>#${donemNo}</b> · <b>${donemAcik ? "Açık" : "Kapalı · işlem yapılamaz"}</b> · Banko: <b>${H.esc(banko)}</b></span><select data-vbanko title="Çalıştığın banko/kasa"${donemAcik ? "" : " disabled"}>${bankolar.map(b => `<option${b === banko ? " selected" : ""}>${H.esc(b)}</option>`).join("")}</select>${donemYetki ? `<button class="btn sm" data-vdonem>${donemAcik ? "Dönem kapat" : "Yeni dönem aç"}</button>` : ""}${!donemAcik && donemYetki ? `<button class="btn sm" data-vdevir>${I("key") || ""} Devir al</button>` : ""}<button class="btn sm" data-vozet>Dönem özeti</button></div>`;
    const strip = `<div class="seg" style="margin-bottom:12px">${TABS.map(([k, l]) => `<button data-vtab="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
    const panFatura = () => { const all = faturalar(), f = params.durum || "hepsi", list = f === "hepsi" ? all : all.filter(x => x.durum === f);
      return `<div class="seg" style="margin-bottom:10px">${[["hepsi", "Hepsi"], ["Bekliyor", "Bekliyor"], ["Ödendi", "Ödendi"]].map(([k, l]) => `<button data-vf="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="tw"><table class="t"><thead><tr><th>Hasta</th><th>Protokol</th><th>Kurum / sigorta</th><th style="width:80px">Toplam</th><th style="width:100px">Katılım payı</th><th style="width:130px">Durum / ödeme</th><th style="width:100px"></th></tr></thead><tbody>
        ${list.length ? list.map(x => `<tr><td><b>${H.esc(vzName(x.hasta))}</b></td><td class="adm-sub">${H.esc(x.protokol)}</td><td>${H.esc(x.kurum)}</td><td class="n">${x.toplam} ₼</td><td class="n">${x.katilim} ₼</td><td><span class="tag ${x.durum === "Ödendi" ? "ok" : ""}">${x.durum}</span>${x.odemeTipi ? ` <span class="adm-sub">${H.esc(x.odemeTipi)}</span>` : ""}</td><td>${x.durum === "Bekliyor" ? `<button class="btn p sm" data-tahsil="${x.id}">Tahsil et</button>` : `<span class="adm-sub">${x.banko ? H.esc(x.banko) : "—"}</span>`}</td></tr>`).join("") : `<tr><td colspan="7" class="mute" style="padding:20px;text-align:center">Fatura yok.</td></tr>`}</tbody></table></div>`; };
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
        <div class="rc-add" style="margin-bottom:10px"><div class="amel-cb" style="flex:1;min-width:220px"><input data-fhiz placeholder="Hizmet ara (katalogdan)" autocomplete="off"${donemAcik ? "" : " disabled"}><div class="amel-dd hidden" data-fhiz-dd></div></div><input data-ffiyat type="number" placeholder="Fiyat (₼)" style="max-width:130px"${donemAcik ? "" : " disabled"}><button class="btn p sm" data-fadd${donemAcik ? "" : " disabled"}>Ekle</button></div>
        <div class="tw"><table class="t"><thead><tr><th>İşlem</th><th style="width:100px">Fiyat</th><th style="width:100px">Hasta</th><th style="width:100px">SGK/kurum</th><th style="width:40px"></th></tr></thead><tbody>
        ${rows.length ? rows.map((r, i) => { const rs = farkYok ? r.fiyat : (samhi ? Math.round(r.fiyat * 0.7) : 0); return `<tr data-fri="${i}" title="Sağ tık: işlem menüsü"><td><b>${H.esc(r.ad)}</b></td><td class="n">${r.fiyat} ₼</td><td class="n">${r.fiyat - rs} ₼</td><td class="n">${rs} ₼</td><td><button class="btn g sm" data-frm="${i}">${I("x") || "×"}</button></td></tr>`; }).join("") : `<tr><td colspan="5" class="mute" style="padding:16px;text-align:center">Fiyat teklifi için hizmet ekleyin.</td></tr>`}</tbody>
        <tfoot>${ind ? `<tr><td class="adm-sub">Kampanya indirimi (${H.esc(kamp.ad)})</td><td class="n adm-sub">–${ind} ₼</td><td class="n adm-sub">–${ind} ₼</td><td class="n adm-sub">—</td><td></td></tr>` : ""}<tr><td><b>Toplam</b></td><td class="n"><b>${top} ₼</b></td><td class="n"><b>${hasta} ₼</b></td><td class="n"><b>${sgk} ₼</b></td><td></td></tr></tfoot></table></div>
        <p class="adm-sub" style="margin-top:8px">SAMHI'de hasta/kurum payı örnek %30/%70 bölünür. Kampanyayı yetkili rol admin'de oluşturur, vezne burada seçer. Teklif çıktısı alınabilir.</p>`; };
    const panGfk = () => { const g = params.gfk || "hepsi", all = gfkRows(), list = g === "hepsi" ? all : all.filter(x => x.durum === g);
      return `<div class="seg" style="margin-bottom:10px">${[["hepsi", "Hepsi"], ...GFK_DURUM.map(d => [d, d])].map(([k, l]) => `<button data-gf="${k}" class="${g === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="tw"><table class="t"><thead><tr><th>Protokol</th><th>Hasta</th><th>Geliş</th><th>Protokol tipi</th><th>Bölüm</th><th style="width:200px">Fatura durumu</th></tr></thead><tbody>
        ${list.map((x, i) => `<tr><td class="mono">${H.esc(x.proto)}</td><td><b>${H.esc(vzName(x.hasta))}</b></td><td>${H.esc(x.gelis)}</td><td class="adm-sub">${H.esc(x.ptip)}</td><td class="adm-sub">${H.esc(x.bolum)}</td><td><select data-gfkst="${all.indexOf(x)}">${GFK_DURUM.map(d => `<option${x.durum === d ? " selected" : ""}>${d}</option>`).join("")}</select></td></tr>`).join("") || `<tr><td colspan="6" class="mute" style="padding:16px;text-align:center">Kayıt yok.</td></tr>`}</tbody></table></div>
        <p class="adm-sub" style="margin-top:8px">GFK takip: protokollerin fatura kesildi/kesilmedi ve provizyon durumu. Fatura kesilmeyen protokoller takip edilir.</p>`; };
    const panEvrak = () => { const e = params.ev || "hepsi", all = evrakRows(), list = e === "hepsi" ? all : all.filter(x => x.durum === e);
      return `<div class="seg" style="margin-bottom:10px">${[["hepsi", "Hepsi"], ...EVRAK_DURUM.map(d => [d, d])].map(([k, l]) => `<button data-ef="${k}" class="${e === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="tw"><table class="t"><thead><tr><th>Fatura no</th><th>Matbu fatura no</th><th>Kurum</th><th style="width:190px">Evrak durumu</th><th style="width:110px"></th></tr></thead><tbody>
        ${list.map(x => `<tr><td class="mono">${H.esc(x.no)}</td><td class="mono adm-sub">${H.esc(x.matbu || "—")}</td><td>${H.esc(x.kurum)}</td><td><span class="tag ${x.durum === "Vezneden teslim edildi" ? "ok" : ""}">${H.esc(x.durum)}</span></td><td>${x.durum === "Veznede" ? `<button class="btn p sm" data-evteslim="${x.no}">Teslim et</button>` : `<span class="adm-sub">—</span>`}</td></tr>`).join("") || `<tr><td colspan="5" class="mute" style="padding:16px;text-align:center">Evrak yok.</td></tr>`}</tbody></table></div>
        <p class="adm-sub" style="margin-top:8px">Fatura evrak teslim takibi (veznede → teslim edildi → medikal muhasebede → iade).</p>`; };
    const panIndirim = () => { const d = params.io || "Onay bekliyor", all = indirimRows(), list = d === "hepsi" ? all : all.filter(x => x.durum === d), can = H.can("indirim_onay");
      return `<div class="seg" style="margin-bottom:10px">${[["Onay bekliyor", "Onay bekleyen"], ["hepsi", "Hepsi"], ["Onaylandı", "Onaylanan"], ["Reddedildi", "Reddedilen"]].map(([k, l]) => `<button data-io="${k}" class="${d === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="tw"><table class="t"><thead><tr><th>Tarih</th><th>Hasta</th><th>İsteyen</th><th>İşlem</th><th style="width:80px">Tutar</th><th style="width:70px">Oran</th><th>Onay grubu</th><th style="width:120px">Durum</th><th style="width:150px"></th></tr></thead><tbody>
        ${list.map(x => `<tr><td class="adm-sub">${H.esc(x.tarih)}</td><td><b>${H.esc(vzName(x.hasta))}</b></td><td class="adm-sub">${H.esc(x.isteyen)}</td><td class="adm-sub">${H.esc(x.islem)}</td><td class="n">${x.tutar} ₼</td><td class="n">%${x.oran}</td><td class="adm-sub">${H.esc(x.grup)}<div class="adm-sub" style="font-size:11px">${H.esc(zincStr(x.zincir))}</div></td><td><span class="tag ${x.durum === "Onaylandı" ? "ok" : x.durum === "Reddedildi" ? "w" : ""}">${x.durum}</span></td><td>${x.durum === "Onay bekliyor" && can ? `<button class="btn p sm" data-ioap="${x.id}">Onayla</button> <button class="btn g sm" data-iored="${x.id}">Reddet</button>` : x.durum === "Onay bekliyor" ? `<span class="adm-sub">yetki yok</span>` : `<span class="adm-sub">—</span>`}</td></tr>`).join("") || `<tr><td colspan="9" class="mute" style="padding:16px;text-align:center">Kayıt yok.</td></tr>`}</tbody></table></div>
        <p class="adm-sub" style="margin-top:8px">Bir hastaya indirim atılınca yetkili rol (İndirim onayla) onaylar/reddeder. Onaylanmayan indirim fatura/tahsilatta uygulanmaz. Çok kademeli onay gerçek kurguda eklenir.</p>`; };
    const panIade = () => { const d = params.ia || "Onay bekliyor", t = params.iatip || "Tümü", all = iadeRows(), list = all.filter(x => (d === "hepsi" || x.durum === d) && (t === "Tümü" || x.tip === t)), can = H.can("iade_onay");
      return `<div class="seg" style="margin-bottom:8px">${["Tümü", "Avans İade", "Fatura İade"].map(k => `<button data-iatip="${k}" class="${t === k ? "on" : ""}">${k}</button>`).join("")}</div>
        <div class="seg" style="margin-bottom:10px">${[["Onay bekliyor", "Onay bekleyen"], ["hepsi", "Hepsi"], ["Onaylandı", "Onaylanan"], ["İade tamamlandı", "Tamamlanan"]].map(([k, l]) => `<button data-ia="${k}" class="${d === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="tw"><table class="t"><thead><tr><th>Tip</th><th>Tarih</th><th>Talep eden</th><th style="width:90px">Tutar</th><th>Departman</th><th>Açıklama</th><th>Protokol</th><th style="width:120px">Durum</th><th style="width:150px"></th></tr></thead><tbody>
        ${list.map(x => `<tr><td class="adm-sub">${H.esc(x.tip)}</td><td class="adm-sub">${H.esc(x.tarih)}</td><td><b>${H.esc(vzName(x.eden))}</b></td><td class="n">${x.tutar} ₼</td><td class="adm-sub">${H.esc(x.dep)}</td><td class="adm-sub">${H.esc(x.aciklama)}</td><td class="mono adm-sub">${H.esc(x.proto)}<div class="adm-sub" style="font-size:11px">${H.esc(zincStr(x.zincir))}</div></td><td><span class="tag ${/Onaylandı|tamamlandı/.test(x.durum) ? "ok" : x.durum === "Reddedildi" ? "w" : ""}">${x.durum}</span></td><td>${x.durum === "Onay bekliyor" && can ? `<button class="btn p sm" data-iaap="${x.id}">Onayla</button> <button class="btn g sm" data-iared="${x.id}">Reddet</button>` : x.durum === "Onay bekliyor" ? `<span class="adm-sub">yetki yok</span>` : `<span class="adm-sub">—</span>`}</td></tr>`).join("") || `<tr><td colspan="9" class="mute" style="padding:16px;text-align:center">Kayıt yok.</td></tr>`}</tbody></table></div>
        <p class="adm-sub" style="margin-top:8px">Avans/fatura iadeleri yetkili rol (İade onayla) tarafından onaylanır. Onay zinciri (seviye 1/2/3) gerçek kurguda eklenir.</p>`; };
    const panGiris = () => { const son = (H.data.patients || []).slice(-8).reverse();
      return `<div class="box"><h5>Hasta kabul / arama</h5><p class="adm-sub" style="margin:4px 0 0">Yukarıdaki "Hasta kabul" çubuğundan FİN ya da hasta no ile arayın; kayıt yoksa yeni kayıt açılır. Son gelen hastalar aşağıda — satıra tıklayın.</p></div>
        <div class="ist-sec ist-hd"><h5>Son hastalar</h5></div>
        <div class="tw"><table class="t"><thead><tr><th style="width:110px">Hasta no</th><th>Hasta</th><th>Geliş</th><th>Bölüm</th><th style="width:110px">Protokol</th></tr></thead><tbody>
        ${son.length ? son.map(pp => { const bb = H.bed(pp.bed), uu = bb && H.unit(bb.unitId); return `<tr data-h3open="${pp.id}" style="cursor:pointer"><td class="mono adm-sub">${H.esc(pp.hn || "—")}</td><td><b>${H.esc(vzName(pp.name))}</b></td><td>${H.encIcon(pp)} ${H.esc((H.ENC[H.encOf(pp)] || {}).label || H.encOf(pp))} ${H.protoLock(pp)}</td><td class="adm-sub">${uu ? H.esc(uu.tr) : "—"}</td><td class="mono adm-sub">${H.esc(pp.proto || "—")}</td></tr>`; }).join("") : `<tr><td colspan="5" class="mute" style="padding:16px;text-align:center">Hasta yok.</td></tr>`}</tbody></table></div>`; };
    const panel = ({ giris:panGiris, fatura:panFatura, fiyat:panFiyat, indirim:panIndirim, iade:panIade, gfk:panGfk, evrak:panEvrak })[tab]();
    const RAIL = [
      ["Vezne paneli", [["Hasta arama", ""], ["Randevu arama", ""], ["Son hastalar", ""], ["Reçete listesi", ""], ["Gizli / VIP hasta listesi", ""], ["Doktor iş listesi", ""]]],
      ["Vezne iş havuzu", [["Evrak takip", "evrak"], ["Ödeme takip", "fatura"], ["GFK takip", "gfk"], ["Onay bekleyen indirimler", "indirim"], ["Onay bekleyen iadeler", "iade"], ["Fiyat teklifleri", "fiyat"], ["Toplu fatura işlemleri", ""], ["Protokol listesi", ""], ["Kurum değişiklik onay", ""]]],
    ];
    const rail = `<div class="vz-rail">${RAIL.map(([g, items]) => `<div class="vz-rg"><h6>${g}</h6>${items.map(([l, t]) => `<button class="vz-ri${t === tab && t ? " on" : ""}" data-rail="${t}" data-raill="${H.esc(l)}">${l}</button>`).join("")}</div>`).join("")}</div>`;
    const kabulBar = `<div class="rc-add" style="margin-bottom:10px"><b style="align-self:center;font-size:13px">Hasta kabul:</b><input data-fin placeholder="FİN / Hasta no ile ara (hasta gelince kimliği girilir)" style="flex:1;min-width:240px"><button class="btn p sm" data-finara>${I("search") || ""} Ara / Kabul</button></div>`;
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_vezne")}</h2><p>Hasta paneli · vezne · banko ${H.esc(banko)} · dönem #${donemNo} (tasarım)</p></div></div>${bar}${kabulBar}<div class="vz-wrap"><div class="vz-main">${strip}${panel}</div>${rail}</div>`;
    { const fi = root.querySelector("[data-fin]"); if (fi) fi.addEventListener("keydown", (ev) => { if (ev.key === "Enter") vzFinAra(root); }); }
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
          ["Bekleyene at", () => H.toast("Bekleyene atıldı (tasarım)", "w")],
          ["Özel onay (ödeme alındı)", () => H.toast("Özel onay işaretlendi (tasarım)")],
          ["Fatura kesilmeyecek", () => H.toast("'Fatura kesilmeyecek' işaretlendi (tasarım)", "w")],
          ["Yazdır (hizmet dökümü)", () => H.toast("Çıktı hazırlanıyor (tasarım)")],
          ["İptal (satırı çıkar)", () => { (H.data.vFiyat || []).splice(i, 1); H.toast("İşlem çıkarıldı", "w"); H.go("vezne", params); }],
        ]);
      });
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
    root.onchange = (e) => {
      const vb = e.target.closest("[data-vbanko]"); if (vb) { if (!H.can("vezne_banko")) { vb.value = banko; H.toast("Banko değiştirme yetkiniz yok.", "e"); return; } H.state.vezneBanko = vb.value; H.log("Vezne banko değişti", vb.value); H.toast("Banko: " + vb.value); return; }
      const fk = e.target.closest("[data-fkurum]"); if (fk) return H.go("vezne", { tab:"fiyat", kurum:fk.value, kamp:params.kamp, fptip:params.fptip });
      const fkp = e.target.closest("[data-fkamp]"); if (fkp) return H.go("vezne", { tab:"fiyat", kurum:params.kurum, kamp:fkp.value, fptip:params.fptip });
      const fpt = e.target.closest("[data-fptip]"); if (fpt) return H.go("vezne", { tab:"fiyat", kurum:params.kurum, kamp:params.kamp, fptip:fpt.value });
      const gs = e.target.closest("[data-gfkst]"); if (gs) { if (!donemAcik) { gs.value = gfkRows()[+gs.dataset.gfkst].durum; H.toast("Dönem kapalı · değişiklik yapılamaz.", "e"); return; } const x = gfkRows()[+gs.dataset.gfkst]; if (x) { x.durum = gs.value; H.log("GFK durumu", x.proto + " · " + x.durum); H.toast("Durum: " + x.durum); } }
    };
    root.onclick = (e) => {
      const fnr = e.target.closest("[data-finara]"); if (fnr) { vzFinAra(root); return; }
      const h3o = e.target.closest("[data-h3open]"); if (h3o) return H.go("hasta360", { pid:h3o.dataset.h3open });
      const vt = e.target.closest("[data-vtab]"); if (vt) return H.go("vezne", { tab:vt.dataset.vtab });
      if (e.target.closest("[data-vdonem]")) { if (!donemYetki) { H.toast("Dönem açma/kapatma yetkiniz yok.", "e"); return; } H.data.vezneDonemAcik = !donemAcik; if (donemAcik) { H.log("Vezne dönem kapatıldı", "#" + donemNo + " · " + banko); H.toast("Dönem kapatıldı · kapatmadan işlem yapılamaz", "w"); } else { H.data.vezneDonemNo = donemNo + 1; H.log("Vezne yeni dönem açıldı", "#" + (donemNo + 1)); H.toast("Yeni dönem açıldı: #" + (donemNo + 1)); } return H.go("vezne", params); }
      if (e.target.closest("[data-vdevir]")) { if (!donemYetki) { H.toast("Devir yetkiniz yok.", "e"); return; } H.data.vezneDonemNo = donemNo + 1; H.data.vezneDonemAcik = true; H.data.vezneDevir = (H.data.vezneDevir || 0) + 0; H.log("Dönem devir alındı", "#" + donemNo + " → #" + (donemNo + 1) + " · " + banko); H.toast("Devir alındı · yeni dönem #" + (donemNo + 1) + " açıldı"); return H.go("vezne", params); }
      if (e.target.closest("[data-vozet]")) { donemOzet(); return; }
      if (!donemAcik) { if (e.target.closest("[data-fadd],[data-tahsil],[data-frm],[data-evteslim]")) { H.toast("Dönem kapalı · önce yeni dönem açın.", "e"); return; } }
      const vf = e.target.closest("[data-vf]"); if (vf) return H.go("vezne", { tab:"fatura", durum:vf.dataset.vf });
      const gf = e.target.closest("[data-gf]"); if (gf) return H.go("vezne", { tab:"gfk", gfk:gf.dataset.gf });
      const ef = e.target.closest("[data-ef]"); if (ef) return H.go("vezne", { tab:"evrak", ev:ef.dataset.ef });
      const rl = e.target.closest("[data-rail]"); if (rl) { const t = rl.dataset.rail; if (t) return H.go("vezne", { tab:t }); const lbl = rl.dataset.raill, rd = railData(lbl);
        if (!rd) { H.toast(lbl + " · yapım aşamasında (tasarım)", "w"); return; }
        railModal(lbl, rd); return; }
      const io = e.target.closest("[data-io]"); if (io) return H.go("vezne", { tab:"indirim", io:io.dataset.io });
      const ia = e.target.closest("[data-ia]"); if (ia) return H.go("vezne", { tab:"iade", ia:ia.dataset.ia, iatip:params.iatip });
      const iat = e.target.closest("[data-iatip]"); if (iat) return H.go("vezne", { tab:"iade", ia:params.ia, iatip:iat.dataset.iatip });
      const iap = e.target.closest("[data-ioap],[data-iored]"); if (iap) { if (!H.can("indirim_onay")) { H.toast("İndirim onay yetkiniz yok.", "e"); return; } const id = iap.dataset.ioap || iap.dataset.iored, ok = !!iap.dataset.ioap, x = indirimRows().find(y => y.id === id); if (x) { onayIlerlet(x, ok); H.log("İndirim onay kademesi " + (ok ? "ilerledi" : "reddedildi"), x.hasta + " · %" + x.oran + " · " + x.durum); H.toast(ok ? (x.durum === "Onaylandı" ? "İndirim tamamen onaylandı" : "Bir kademe onaylandı · sonraki onay bekliyor") : "İndirim reddedildi", ok && x.durum !== "Onay bekliyor" ? "ok" : "w"); H.go("vezne", params); } return; }
      const iae = e.target.closest("[data-iaap],[data-iared]"); if (iae) { if (!H.can("iade_onay")) { H.toast("İade onay yetkiniz yok.", "e"); return; } const id = iae.dataset.iaap || iae.dataset.iared, ok = !!iae.dataset.iaap, x = iadeRows().find(y => y.id === id); if (x) { onayIlerlet(x, ok); if (ok && x.durum === "Onaylandı") x.durum = "İade tamamlandı"; H.log("İade onay kademesi " + (ok ? "ilerledi" : "reddedildi"), x.eden + " · " + x.tutar + " ₼ · " + x.durum); H.toast(ok ? (x.durum === "İade tamamlandı" ? "İade tamamen onaylandı" : "Bir kademe onaylandı · sonraki onay bekliyor") : "İade reddedildi", ok && x.durum !== "Onay bekliyor" ? "ok" : "w"); H.go("vezne", params); } return; }
      const fa = e.target.closest("[data-fadd]"); if (fa) { const el = root.querySelector("[data-fhiz]"), ad = (el.value || "").trim(), kod = el.dataset.kod || "", fy = +root.querySelector("[data-ffiyat]").value || (kod ? H.fiyatOf(kod, params.kurum || "Özel ödeme") : 0); if (!ad) { H.toast("Katalogdan hizmet seçin.", "w"); return; } (H.data.vFiyat = H.data.vFiyat || []).push({ ad, kod, fiyat:fy }); H.go("vezne", params); return; }
      const frm = e.target.closest("[data-frm]"); if (frm) { (H.data.vFiyat || []).splice(+frm.dataset.frm, 1); H.go("vezne", params); return; }
      const et = e.target.closest("[data-evteslim]"); if (et) { const x = evrakRows().find(y => y.no === et.dataset.evteslim); if (x) { x.durum = "Vezneden teslim edildi"; H.log("Evrak teslim", x.no); H.toast("Evrak teslim edildi"); H.go("vezne", params); } return; }
      const th = e.target.closest("[data-tahsil]"); if (th) { const x = faturalar().find(y => y.id === th.dataset.tahsil); if (!x) return;
        H.modal({ title:"Tahsilat · " + H.esc(vzName(x.hasta)), body:`<div class="icd-form"><div class="fr"><label>Tutar</label><input value="${x.katilim} ₼" readonly></div>
          <div class="fr"><label>Ödeme tipi</label><select data-f="odeme">${ODEME_TIP.map(o => `<option>${o}</option>`).join("")}</select></div>
          <div class="fr"><label>Banko</label><input value="${H.esc(banko)}" readonly></div></div>`,
          actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Tahsil et</button>`,
          onMount(m) { m.querySelector("[data-ok]").onclick = () => { x.durum = "Ödendi"; x.odemeTipi = m.querySelector('[data-f="odeme"]').value; x.banko = banko; x.donem = donemNo;
            H.log("Tahsilat", x.hasta + " · " + x.katilim + " ₼ · " + x.odemeTipi + " · " + banko); H.closeModal(); H.toast("Tahsil edildi: " + x.katilim + " ₼ (" + x.odemeTipi + ")"); H.go("vezne", params); }; } });
      }
    };
  } });

  /* ================= YÖNETİM RAPORLARI (başlık kataloğu · içerik yapım aşamasında) ================= */
  const RAPOR_GRUP = [
    ["Geliş ve Muayene", ["TSIM", "Aynı Gün Geliş Analizi", "Hasta Geliş Analizi", "Yeni Muayene Gelişi", "Doktor Protokol Sayı Analizi", "Doktor İşlem Analizi", "Muayene Bekleme Analizi"]],
    ["Fatura ve Tahsilat", ["Fatura Analizi", "Faturalanmamış Tahsilat Analizi", "Vezne Tahakkuk Tahsilat Analizi", "Banko Vezne Fatura Analizi", "Protokol Fiyat Log", "Tahsilat Analizi", "Protokol Fatura Durumu"]],
    ["İndirim ve İade", ["Hasta İndirim Analizi", "Onay Bekleyen İndirimler", "İade Talepleri (Avans/Fatura)"]],
    ["Borç ve Açık Hesap", ["Protokol Borç Takip", "Hasta Borç Takip", "Vezne Borç Takip", "Vezne Açık Hesap Analizi", "Personel ve Yakını Açık Hesap Analizi", "Bekleyen Avans Listesi", "Kurumsal Vade Alacak Raporu"]],
    ["İptal Analizleri", ["Protokol İptal Analizi", "Fatura İptal Analizi", "Vezne İşlem İptal Analizi", "Protokol İşlem İptal Analizi"]],
    ["Protokol ve Liste", ["Protokol Listesi", "Provizyon Takip Analizi", "Kvk / Demografik Bilgi Raporu"]],
    ["Tedavi", ["Doktor Hakediş İşlemleri", "Tedavi Analiz", "Tıbbi Form Analizi", "Kemoterapi Protokol Analizi"]],
    ["Yatan Hasta", ["Yatan Hasta Listesi", "Yatak Doluluk Oranları", "Diyet Analizi", "Order Uygulama Analizi", "Hemşire Bakım Planı Analizi", "Taburcu Hasta Listesi"]],
    ["Laboratuvar", ["Lab İşlem Durumu", "Test Analiz", "Hasta Bazlı Çalışılan Test Analizi", "Kritik Değer Bildirim Listesi", "Lab Maliyet Analizi", "Transfüzyon Merkez Analizi"]],
    ["Tetkik ve Radyoloji", ["Tetkik Analiz", "Panik Değer Bildirim Analizi"]],
    ["Randevu", ["Randevu Takip Raporu", "Verilemeyen Randevu Takip Raporu", "Randevu Takip Raporu (Yetkili)"]],
    ["Finans", ["Hakediş Analizi", "Faturasız Tahsilat Analizi", "Tahsilatsız Fatura Analizi", "Cari Bakiye Analizi", "Alacak Devir Hızı", "Günlük Finans Hareketleri", "Cari Hesap Ekstresi", "Tahsil Edilecek Faturalar"]],
    ["Stok", ["Stok Durumu", "Hareketsiz Ürünler", "Stok İşlem Listesi", "İlaç Stok İşlem Analizi", "Sayım Listesi", "Miadı Yaklaşan Ürünler", "Sarf Analizi"]],
    ["Satınalma", ["Satınalma Fatura Analizi", "İrsaliye Analizi", "Satınalma Talep Analizi", "Sipariş Analizi"]],
    ["Ciro ve Verimlilik", ["Ciro", "Bölüm Bazlı Ciro", "Doktor Bazlı Ciro", "Hizmet Analizi", "Hastaya İşlenen Malzemeler", "Protokol Ciro Analizi", "Hasta Ciro Analizi", "Doktor Verimlilik Analizi", "Kurum Bazlı Ciro", "Günlük Nakit Akış Analizi", "Yurtdışı Hasta Ciro Analizi"]],
  ];
  H.raporGruplari = RAPOR_GRUP.map(g => g[0]);   // admin "Rapor Yetkileri" ekranı bunu kullanır
  H.register("raporlar", { title:() => H.t("m_raporlar"), perm:["summary", "audit"], render(root) {
    const role = (H.state.user || {}).role, allow = H.data.rolRapor && H.data.rolRapor[role];
    const groups = RAPOR_GRUP.filter(([g]) => !allow || allow[g]);
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_raporlar")}</h2><p>Yönetim raporları ve analizler · rol yetkisine göre${allow ? " (kısıtlı)" : ""} (tasarım)</p></div></div>
      ${(groups.length ? groups : [["", ["— Bu rol için tanımlı rapor yok (admin → Rapor Yetkileri) —"]]]).map(([g, items]) => `<div class="ist-sec"><div class="ist-hd"><h5>${H.esc(g)}</h5></div>
        <div class="rp-grid">${items.map(r => `<button class="rp-card" data-rap="${H.esc(r)}">${I("chart") || ""}<span>${H.esc(r)}</span></button>`).join("")}</div></div>`).join("")}
      <p class="adm-sub" style="margin-top:10px">Her rapor: tarih/bölüm/doktor filtresi + tablo/özet olacak. Öncelikli raporlar örnek veriyle sırayla doldurulacak.</p>`;
    root.onclick = (e) => { const c = e.target.closest("[data-rap]"); if (!c) return; const name = c.dataset.rap, d = reportData(name);
      if (!d) { H.toast(name + " · yapım aşamasında (tasarım)", "w"); return; }
      H.modal({ title:name, wide:true, body:`<div class="tw"><table class="t"><thead><tr>${d.cols.map(cc => `<th>${H.esc(cc)}</th>`).join("")}</tr></thead><tbody>${d.rows.length ? d.rows.map(r => `<tr>${r.map((cell, i) => `<td${i > 0 ? ' class="n"' : ""}>${H.esc(String(cell))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${d.cols.length}" class="mute" style="padding:16px;text-align:center">Veri yok.</td></tr>`}</tbody></table></div><p class="adm-sub" style="margin-top:8px">${H.esc(d.note || "Örnek/özet veri. Gerçek filtre (tarih/bölüm/doktor) ve veri bağlantısı ileride.")}</p>`,
        actions:`<button class="btn" data-exp>${I("save") || ""} Excel'e aktar</button><span class="spacer"></span><button class="btn" data-x>Kapat</button>`,
        onMount(m) { m.querySelector("[data-exp]").onclick = () => { csvExport(name, d.cols, d.rows); H.toast("Excel (CSV) indirildi"); }; } });
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
    if (name === "Bekleyen Avans Listesi") return { cols:["Protokol", "Hasta", "Avans ₼", "Durum"], rows:[["50894026", "Şebnem Süleymanlı", 500, "Bekliyor"], ["50892562", "Nurgül Süleymanova", 300, "Bekliyor"], ["50790716", "Aytac Rüstemli", 100, "Kısmi iade"]], note:"Örnek veri." };
    return null;
  }

  /* ================= HASTA 360 (tam ekran hasta kartı · bizim tasarım) ================= */
  const H360_ANA = [["360", "Genel"], ["ishavuzu", "İş Havuzu"], ["tedavi", "Tedavi"], ["arsiv", "Arşiv"]];
  const H360_ALT = [["kart", "Hasta Kartı"], ["gelisler", "Gelişler"], ["faturalar", "Faturalar"], ["odeme", "Ödemeler / Avanslar"], ["indirim", "İndirimler"], ["dosya", "Dosyalar / Resimler"], ["notlar", "Notlar"], ["teklif", "Teklifler"], ["online", "Online Ödemeler"], ["pos", "POS İşlem Ödeme"], ["anlasma", "Anlaşmalarım"]];
  const H360_KABUL = [["ayaktan", "Poliklinik"], ["gunubirlik", "Günübirlik"], ["yatan", "Yatış"], ["yogun", "Yoğun bakım"], ["kontrol", "Kontrol"], ["donor", "Donör"]];
  const H360_DIGER = ["Özel hasta bilgileri", "Hasta yakınları", "Hasta vefat etmiş", "Tercüman listesi", "Yeni doğan kaydı aç", "Bebek hasta bilgileri", "Transplantasyon bilgileri", "Hasta referans", "Hasta değişim logu", "Arşiv bilgileri", "Mobil onay kodları", "E-posta / SMS", "Finans bilgileri", "Hasta yönlendirme", "Araç plaka bilgileri", "Diyaliz tedavi bilgileri"];
  const secArr = (k, def) => { const s = H.data.secenekler; return (s && s[k] && s[k].length) ? s[k] : def; };
  H.register("hasta360", { title:() => "Hasta Dosyası", perm:["admission", "summary", "patient"], render(root, params = {}) {
    const p = H.pt(params.pid); if (!p) { root.innerHTML = `<div class="ph"><div><h2>Hasta Dosyası</h2><p>Hasta seçilmedi.</p></div></div><div class="empty">Vezne panelinden bir hasta seçin.</div>`; return; }
    const ana = params.atab || "360", alt = params.stab || "kart", b = H.bed(p.bed), u = b && H.unit(b.unitId), doctor = H.userBy(p.attending);
    const hdr = `<div class="h360-hdr">
      <div class="h360-id"><span class="h360-risk" style="background:${(H.SEV && H.SEV[p.risk] || {}).c || "var(--mute)"}" title="Durum"></span><div><div class="h360-name">${H.esc(vzName(p.name))}</div><div class="adm-sub">${H.encIcon(p)} ${H.esc((H.ENC[H.encOf(p)] || {}).label || H.encOf(p))} ${H.protoLock(p)} · ${H.esc(p.dx || "")}</div></div></div>
      <div class="h360-meta">
        <div><span>FİN</span><b>${H.esc(p.fin || "—")}</b></div><div><span>Hasta no</span><b>${H.esc(p.hn || "—")}</b></div><div><span>Protokol</span><b>${H.esc(p.proto || "—")}</b></div>
        <div><span>Hasta tipi</span><b>${H.esc(p.hastaTipi || "Normal")}</b></div><div><span>Uyruk</span><b>${H.esc(p.uyruk || "Azərbaycan")}</b></div>
        <div><span>Cinsiyet · yaş</span><b>${p.sex === "E" ? "Kişi" : "Qadın"} · ${p.age || "—"}</b></div><div><span>Yatak</span><b>${b ? H.esc(b.no) : "—"}</b></div><div><span>Banko</span><b>${H.esc(H.state.vezneBanko || "—")}</b></div></div></div>`;
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
    root.innerHTML = `${hdr}${anaTabs}${toolbar}${altTabs}<div class="h360-body" data-h3body></div>`;
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
      p._fatura = p._fatura || [
        { tarih:"24.10.2026", tip:"Satış faturası", cari:vzName(p.name), tur:"Hizmet", no:"FTR-" + pr, parent:"", durum:"Açık", pb:"₼", tutar:420, kdv:0 },
        { tarih:"20.10.2026", tip:"Satış faturası", cari:vzName(p.name), tur:"Hizmet", no:"FTR-" + (+pr - 7), parent:"", durum:"Ödendi", pb:"₼", tutar:180, kdv:0 },
      ];
      p._odeme = p._odeme || [
        { tarih:"24.10.2026 10:12", sube:H.state.vezneBanko || "Mərkəz", kurumHasta:"Hasta", islem:"Tahsilat", sap:"—", odeme:"Kredi kartı", pb:"₼", kur:1, tutar:250 },
        { tarih:"20.10.2026 14:40", sube:H.state.vezneBanko || "Mərkəz", kurumHasta:"Hasta", islem:"Avans", sap:"—", odeme:"Nakit", pb:"₼", kur:1, tutar:100 },
      ];
      p._indirim = p._indirim || [
        { tarih:"24.10.2026", islem:"Hizmet indirimi", durum:"Onaylandı", onceki:420, oran:10, tutar:42, vezne:(H.state.user || {}).name || "—" },
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
    };
    // Sağ-tık menü aksiyonları (tasarım): her sekme için görseldeki menü maddeleri
    const SAGTIK = {
      faturalar:["Ödeme", "Ödeme listesi", "İptal", "İade", "Faturaya çevir", "Evrak durumu", "Düzenle (dönem/tarih/açıklama)", "İptalleri göster", "Provizyon"],
      odeme:["İptal", "İade", "Düzenle (dönem/cari/aktar/banka)", "Dosyalar", "İptalleri göster", "Katılım payı iade", "Fatura eşleştirme tarihçesi"],
      indirim:["İptal et", "Dosyalar", "Onay maili gönder", "İptalleri göster"],
      dosya:["İndir", "Döküman grubunu değiştir", "Dosya tipini değiştir"],
      notlar:["Tarihçe", "İptalleri göster"],
      teklif:["Fiyat verildi", "Değerlendirme", "Onayla", "Reddet", "İptal", "Tarihçe"],
    };
    const tbar = (btns) => `<div class="r" style="gap:6px;margin-bottom:10px">${btns.map(b => `<button class="btn sm">${I(b[1]) || ""} ${b[0]}</button>`).join("")}</div>`;
    const sagtikNote = (k) => `<p class="adm-sub" style="margin-top:8px">Satıra sağ tıklayın: ${SAGTIK[k].join(" · ")}.</p>`;
    const money = (n, pb) => (pb || "₼") + " " + (n || 0).toLocaleString("az");
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
    const tabloHtml = (k, cols, rows, btns) => `${tbar(btns)}<div class="tw"><table class="t"><thead><tr>${cols.map(c => `<th>${H.esc(c)}</th>`).join("")}</tr></thead><tbody>
      ${rows.length ? rows.map(r => `<tr data-ctx="${k}" style="cursor:context-menu">${r.map(c => `<td>${H.esc(String(c))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}" class="mute" style="padding:18px;text-align:center">Kayıt yok.</td></tr>`}
      </tbody></table></div>${sagtikNote(k)}`;
    const faturaHtml = () => tabloHtml("faturalar", ["Tarih", "Fatura tipi", "Cari", "Fatura türü", "Fatura no", "Durum", "Para b.", "Tutar", "KDV"],
      p._fatura.map(x => [x.tarih, x.tip, x.cari, x.tur, x.no, x.durum, x.pb, x.tutar, x.kdv]), [["Yenile", "refresh"], ["Yazdır", "print"]]);
    const odemeHtml = () => tabloHtml("odeme", ["Tarih", "Şube", "Kurum/Hasta", "İşlem tipi", "SAP belge", "Ödeme tipi", "Para b.", "Kur", "Tutar"],
      p._odeme.map(x => [x.tarih, x.sube, x.kurumHasta, x.islem, x.sap, x.odeme, x.pb, x.kur, x.tutar]), [["Yenile", "refresh"], ["Kurum avans", "plus"], ["İade talebi", "edit"], ["Karekod üret", "print"], ["Yazdır", "print"]]);
    const indirimHtml = () => tabloHtml("indirim", ["Tarih", "İşlem tipi", "Durum", "İndirim öncesi", "Oran %", "Tutar", "Vezne"],
      p._indirim.map(x => [x.tarih, x.islem, x.durum, money(x.onceki), x.oran, money(x.tutar), x.vezne]), [["Yenile", "refresh"], ["Yazdır", "print"]]);
    const dosyaHtml = () => tabloHtml("dosya", ["Bağlantı tipi", "Döküman grubu", "Bağlantı id", "Dosya tipi", "Dosya adı", "Kayıt tarihi"],
      p._dosya.map(x => [x.bag, x.grup, x.bagId, x.tip, x.ad, x.tarih]), [["Ekle", "plus"], ["Tarayıcıdan yükle", "plus"], ["Dijital imzadan getir", "edit"], ["Sil", "trash"]]);
    const notHtml = () => tabloHtml("notlar", ["Tarih", "Not tipi", "Not türü", "Ekleyen kullanıcı", "Not"],
      p._not.map(x => [x.tarih, x.tip, x.tur, x.ekleyen, x.metin]), [["Ekle", "plus"], ["Sil", "trash"]]);
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
    const basitTab = (ad, not) => `<div class="empty">${H.esc(ad)}${not ? ` · ${H.esc(not)}` : ""}</div>`;
    const drawBody = () => {
      h3seed();
      if (ana === "ishavuzu") {
        const ih = params.ihtab || "istek", ords = (H.data.orders || []).filter(o => o.pid === p.id);
        const IH = [["istek", "İstek Havuzu"], ["islem", "İşlem Havuzu"], ["provizyon", "Provizyon Takip"], ["randevu", "Randevular"], ["yatis", "Yatış İstekleri"], ["onam", "Onam Formları"], ["tetkik", "Tetkik Havuzu"], ["arsiv", "Arşiv"]];
        const seg = `<div class="seg" style="margin:4px 0 12px;flex-wrap:wrap">${IH.map(([k, l]) => `<button data-ih="${k}" class="${ih === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
        const T = (cols, rows, empty) => `<div class="tw"><table class="t"><thead><tr>${cols.map(c => `<th>${H.esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${H.esc(String(c))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}" class="mute" style="padding:16px;text-align:center">${H.esc(empty)}</td></tr>`}</tbody></table></div>`;
        let inner = "";
        if (ih === "istek") { const r = ords.filter(o => o.durum === "İstendi" || o.durum === "Bekliyor"); inner = `<div class="r" style="gap:6px;margin-bottom:8px"><button class="btn p sm" data-h3islem>İşlem havuzuna al</button><button class="btn sm" data-ihrand>Randevu ver</button><button class="btn sm" data-ihhazir>Hazırlık açıklaması</button></div>` + T(["İşlem tipi", "İşlem adı", "Resmi kod", "Miktar", "Tarih", "İsteyen"], r.map(o => [o.cat || "", o.ad || "", o.kod || "—", 1, o.at || "", o.by || ""]), "İstek yok. Doktor/vezne istem yapınca burada görünür."); }
        else if (ih === "islem") { inner = `<p class="adm-sub" style="margin-bottom:8px">Hastanın faturalanacak işlemleri; tam ekranda fatura/indirim/provizyon.</p><button class="btn p" data-h3islem>${I("link") || ""} İşlem havuzunu aç</button>`; }
        else if (ih === "provizyon") { inner = T(["Protokol", "Kurum / sigorta", "Tutar", "Provizyon durumu"], [[p.proto || "—", p.kurum || "Özel ödeme", "—", "Beklemede"]], "Provizyon kaydı yok."); }
        else if (ih === "randevu") { const rs = (H.data.randevular || []).filter(r => r.hasta && vzName(r.hasta) === vzName(p.name)); inner = `<div class="r" style="gap:6px;margin-bottom:8px"><button class="btn sm" data-ihrand>Yeni randevu</button></div>` + T(["Tarih", "Bölüm", "Doktor", "Durum"], rs.map(r => [(r.tarih || "").replace("T", " "), r.bolum, r.doktor, r.durum]), "Randevu yok."); }
        else if (ih === "yatis") { inner = T(["Tarih", "Bölüm", "Yatak", "Durum"], b ? [[p.kabulT || "—", (u && u.tr) || "—", b.no, "Yatışta"]] : [], "Yatış isteği yok."); }
        else if (ih === "onam") { inner = `<div class="r" style="gap:6px;margin-bottom:8px"><button class="btn sm" data-ihonam>Onam formu ekle</button></div>` + T(["Form", "Tarih", "Durum"], (p._dosya || []).filter(d => d.grup === "Onam formları").map(d => [d.ad, d.tarih, "İmzalı"]), "Onam formu yok."); }
        else if (ih === "tetkik") { const r = ords.filter(o => /Laboratuvar|Radyoloji|Patoloji/.test(o.cat || "")); inner = T(["Tür", "Tetkik", "Resmi kod", "Tarih", "Durum"], r.map(o => [o.cat, o.ad, o.kod || "—", o.at || "", o.durum || "İstendi"]), "Tetkik yok."); }
        else { inner = T(["Protokol", "Tarih", "Arşiv no", "Durum"], [[p.proto || "—", "—", "—", "Arşivde"]], "Arşiv kaydı yok."); }
        body.innerHTML = seg + inner; return;
      }
      if (ana === "tedavi") { body.innerHTML = placeholder("Tedavi (Klinik dokümanlar / Lab / Radyoloji / Patoloji / Tanılar)"); return; }
      if (ana === "arsiv") { body.innerHTML = placeholder("Arşiv (aktarım protokolleri / işlemler)"); return; }
      // ana === 360
      if (alt === "kart") { body.innerHTML = kartHtml(); return; }
      if (alt === "gelisler") { body.innerHTML = gelisHtml(); return; }
      if (alt === "faturalar") { body.innerHTML = faturaHtml(); return; }
      if (alt === "odeme") { body.innerHTML = odemeHtml(); return; }
      if (alt === "indirim") { body.innerHTML = indirimHtml(); return; }
      if (alt === "dosya") { body.innerHTML = dosyaHtml(); return; }
      if (alt === "notlar") { body.innerHTML = notHtml(); return; }
      if (alt === "teklif") { body.innerHTML = teklifHtml(); return; }
      if (alt === "online") { body.innerHTML = basitTab("Online ödemeler", "web/mobil ödeme hareketleri"); return; }
      if (alt === "pos") { body.innerHTML = basitTab("POS işlem ödeme listesi", "kredi kartı POS hareketleri"); return; }
      if (alt === "anlasma") { body.innerHTML = basitTab("Anlaşmalarım", "hastanın kurum/kampanya anlaşma kullanımları"); return; }
      body.innerHTML = placeholder(H360_ALT.find(x => x[0] === alt)[1]);
    };
    drawBody();
    root.oncontextmenu = (e) => { const tr = e.target.closest("[data-ctx]"); if (!tr || !SAGTIK[tr.dataset.ctx]) return;
      e.preventDefault(); vzMenu(e, SAGTIK[tr.dataset.ctx].map(a => [a, () => H.toast(a + " · tasarım", "w")])); };
    root.onclick = (e) => {
      const an = e.target.closest("[data-h3ana]"); if (an) return H.go("hasta360", { pid:p.id, atab:an.dataset.h3ana, stab:"kart" });
      const al = e.target.closest("[data-h3alt]"); if (al) return H.go("hasta360", { pid:p.id, atab:"360", stab:al.dataset.h3alt });
      const kb = e.target.closest("[data-h3kabul]"); if (kb) { root.querySelector("[data-h3kabulm]").classList.toggle("hidden"); return; }
      const dg = e.target.closest("[data-h3diger]"); if (dg) { root.querySelector("[data-h3digerm]").classList.toggle("hidden"); return; }
      const ka = e.target.closest("[data-kabul]"); if (ka) { p.encounter = ka.dataset.kabul === "yogun" ? "yogun" : ka.dataset.kabul === "kontrol" || ka.dataset.kabul === "donor" ? "ayaktan" : ka.dataset.kabul; H.log("Hasta kabul", vzName(p.name) + " · " + ka.dataset.kabul); H.toast("Kabul: " + (H360_KABUL.find(x => x[0] === ka.dataset.kabul) || [, ka.dataset.kabul])[1]); return H.go("hasta360", { pid:p.id, atab:ana, stab:alt }); }
      const di = e.target.closest("[data-diger]"); if (di) { H.toast(di.dataset.diger + " · yapım aşamasında (tasarım)", "w"); root.querySelector("[data-h3digerm]").classList.add("hidden"); return; }
      if (e.target.closest("[data-h3kvkk]")) { p.kvkk = !p.kvkk; H.toast("KVKK onay: " + (p.kvkk ? "alındı" : "kaldırıldı"), p.kvkk ? "" : "w"); return H.go("hasta360", { pid:p.id, atab:ana, stab:alt }); }
      if (e.target.closest("[data-h3etk]")) { p.etk = !p.etk; H.toast("ETK onay: " + (p.etk ? "alındı" : "kaldırıldı"), p.etk ? "" : "w"); return H.go("hasta360", { pid:p.id, atab:ana, stab:alt }); }
      if (e.target.closest("[data-h3must]")) { H.toast("Müstehaklık/provizyon sorgusu gönderildi (tasarım)"); return; }
      if (e.target.closest("[data-h3yaz]")) { H.toast("Yazdır çıktıları (tasarım)"); return; }
      if (e.target.closest("[data-h3git-gelis]")) return H.go("gelisler");
      const ihb = e.target.closest("[data-ih]"); if (ihb) return H.go("hasta360", { pid:p.id, atab:"ishavuzu", ihtab:ihb.dataset.ih });
      if (e.target.closest("[data-ihrand]")) { H.toast("Randevu ekranı açılıyor"); return H.go("randevu"); }
      if (e.target.closest("[data-ihhazir]")) { H.toast("Hazırlık açıklaması · tasarım", "w"); return; }
      if (e.target.closest("[data-ihonam]")) { H.toast("Onam formu ekle · tasarım", "w"); return; }
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
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_istakip")}</h2><p>${yonet ? "Bilgi Sistemleri · talep yönetimi" : "Sorununuzu iletin, Bilgi Sistemleri çözsün · yalnız kendi talepleriniz"} (tasarım)</p></div><div class="r"><button class="btn" data-talexp>${I("save") || ""} Excel</button><button class="btn" data-talprint>${I("print") || ""} Yazdır</button><button class="btn p" data-talnew>${I("plus")} Yeni talep</button></div></div>
      ${yonet ? `<div class="seg" style="margin-bottom:8px"><button data-talkap="tum" class="${!mine ? "on" : ""}">Tüm talepler</button><button data-talkap="benim" class="${mine ? "on" : ""}">Benim taleplerim</button></div>` : ""}
      <div class="seg" style="margin-bottom:12px">${[["aktif", "Aktif"], ["hepsi", "Hepsi"], ...TALEP_DURUM.map(d => [d, d])].map(([k, l]) => `<button data-talf="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
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
  H.register("labislem", { title:() => "Laboratuvar / Radyoloji", perm:["beds", "summary"], render(root, params = {}) {
    const cats = { lab:["Laboratuvar"], rad:["Radyoloji"], kan:["Kan ürünü"] };
    const tur = params.tur || "lab";
    const ord = (H.data.orders || []).filter(o => cats[tur].includes(o.cat));
    const pn = (pid) => { const p = H.pt(pid), b = p && H.bed(p.bed); return p ? (H.showNames() ? p.name : (b ? b.no : pid)) : pid; };
    root.innerHTML = `<div class="ph"><div><h2>Laboratuvar / Radyoloji</h2><p>${ord.length} istem · numune/çekim → onay → serbest bırakma (tasarım)</p></div></div>
      <div class="seg" style="margin-bottom:12px">${[["lab", "Laboratuvar"], ["rad", "Radyoloji"], ["kan", "Kan ürünü"]].map(([k, l]) => `<button data-lt="${k}" class="${tur === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="tw"><table class="t"><thead><tr><th style="width:120px">Saat</th><th>Hasta</th><th>İstem</th><th>İsteyen</th><th style="width:170px">Durum</th></tr></thead><tbody>
      ${ord.length ? ord.map(o => `<tr><td class="mono adm-sub">${H.esc(o.at || "")}</td><td><b>${H.esc(pn(o.pid))}</b></td><td>${H.esc(o.ad || "")}<div class="adm-sub" style="font-size:11.5px">${H.esc(o.detay || "")}</div></td><td class="adm-sub">${H.esc(o.by || "")}</td><td><select data-labst="${o.id}">${LAB_DURUM.map(s => `<option${(o.durum || "İstendi") === s ? " selected" : ""}>${s}</option>`).join("")}</select></td></tr>`).join("") : `<tr><td colspan="5" class="mute" style="padding:20px;text-align:center">Bu türde istem yok.</td></tr>`}
      </tbody></table></div>
      <p class="adm-sub" style="margin-top:8px">"Serbest bırakıldı" olunca sonuç hekime/hastaya görünür.</p>`;
    root.onchange = (e) => { const st = e.target.closest("[data-labst]"); if (st) { const o = (H.data.orders || []).find(x => x.id === st.dataset.labst); if (o) { o.durum = st.value; H.log("Lab/Rad durumu", (o.ad || "") + " · " + st.value); H.toast("Durum: " + st.value); } } };
    root.onclick = (e) => { const lt = e.target.closest("[data-lt]"); if (lt) return H.go("labislem", { tur:lt.dataset.lt }); };
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
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_ik")}</h2><p>${staff.length} personel · kart, rol, birim (tasarım)</p></div><div class="r"><button class="btn" data-persexp>${I("save") || ""} Excel</button><button class="btn p" data-persnew>${I("plus")} Personel ekle</button></div></div>
      <div class="tw"><table class="t"><thead><tr><th>Ad</th><th>Unvan</th><th>Rol / tip</th><th>Birimler</th><th>Durum</th></tr></thead><tbody>
      ${staff.map(u => `<tr class="row" style="cursor:pointer" ${u.src === "personel" ? `data-persedit="${H.esc(u._p.id)}"` : `data-usdetay="${H.esc(u.u)}"`}><td><b>${H.esc(u.name)}</b><div class="mute" style="font-size:11.5px">${H.esc(u.u)}</div></td><td class="adm-sub">${H.esc(u.title || "—")}</td><td>${H.esc(u.rol)}</td><td class="adm-sub">${(u.units === "*" ? ["Tüm birimler"] : (u.units || []).map(id => (H.unit(id) || { tr:id }).tr)).join(", ") || "—"}</td><td><span class="tag ${u.active ? "ok" : ""}">${u.active ? "Aktif" : "Pasif"}</span></td></tr>`).join("")}
      </tbody></table></div>
      <p class="adm-sub" style="margin-top:8px">Login hesapları Yönetim → Kullanıcılar'da; buradan HR personel kartı (doktor/hemşire/idari…) eklenir. Satıra tıklayınca personel kartı / kullanıcı detayı açılır.</p>`;
    root.onclick = (e) => {
      if (e.target.closest("[data-persexp]")) { H.exportCsv("Personel_listesi", ["Ad", "Kullanıcı/Kimlik", "Ünvan", "Rol/tip", "Birimler", "Durum"], staff.map(u => [u.name, u.u, u.title, u.rol, (u.units === "*" ? "Tüm birimler" : (u.units || []).map(id => (H.unit(id) || { tr:id }).tr)).join(", "), u.active ? "Aktif" : "Pasif"])); H.toast("Excel (CSV) indirildi"); return; }
      if (e.target.closest("[data-persnew]")) return persForm(null);
      const ed = e.target.closest("[data-persedit]"); if (ed) { const p = (H.data.personel || []).find(x => x.id === ed.dataset.persedit); if (p) persForm(p); return; }
      const ud = e.target.closest("[data-usdetay]"); if (ud) { const user = (H.data.users || []).find(x => x.u === ud.dataset.usdetay); if (user) persForm(null, user); }
    };
    function userDetay(user) {
      const rol = (H.data.roles[user.role] || { name:user.role }), units = user.units === "*" ? "Tüm birimler" : (user.units || []).map(id => (H.unit(id) || { tr:id }).tr).join(", ") || "—";
      const kv = (k, v) => `<div class="kv"><span>${H.esc(k)}</span><span>${H.esc(v || "—")}</span></div>`;
      H.modal({ title:"Kullanıcı · " + H.esc(user.name),
        body:`<div class="vz-hk">${kv("Ad soyad", user.name)}${kv("Kullanıcı adı", user.u)}${kv("Rol", rol.name)}${kv("Ünvan", user.title)}${kv("Birimler", units)}${kv("Durum", user.active !== false ? "Aktif" : "Pasif")}</div>
          <p class="adm-sub" style="margin-top:8px">Bu bir <b>login hesabı</b>. Personel kartı (SGK/izin/çalışma takvimi/zimmet) İK'dan "Personel ekle" ile açılır; yetki/rol ataması Yönetim → Kullanıcılar ve Roller'den yapılır.</p>`,
        actions:`<button class="btn" data-x>Kapat</button>${H.can("admin_users") ? `<button class="btn p" data-usrol>Yetki / rol ekranı</button>` : ""}`,
        onMount(m) { const b = m.querySelector("[data-usrol]"); if (b) b.onclick = () => { H.closeModal(); H.go("admin", { tab:"users" }); }; } });
    }
    function persForm(existing, seed) {
      const p = existing || (seed ? { ad:(seed.name || "").trim().split(/\s+/)[0] || "", soyad:(seed.name || "").trim().split(/\s+/).slice(1).join(" "), kimlik:seed.u || "", unvan:seed.title || "", tip:(H.data.roles[seed.role] || { name:seed.role }).name || "", bolum:(seed.units && seed.units !== "*" && seed.units[0] && (H.unit(seed.units[0]) || {}).tr) || "" } : {}), bols = H.data.bolumler || [];
      const TABS = [["genel", "Genel"], ["kisisel", "Kişisel"], ["calisma", "Çalışma / takvim"], ["iletisim", "İletişim"], ["yetki", "Yetkiler"]];
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
        calisma:`${f("calismaGun", "Çalışma günleri", inp("calismaGun", "ör. Pzt-Cuma"))}${f("calismaSaat", "Çalışma saatleri", inp("calismaSaat", "ör. 08:00-17:00"))}
          ${f("nobet", "Nöbet durumu", inp("nobet", "ör. ayda 4 nöbet"))}${f("sgk", "SGK / sosyal sigorta no", inp("sgk"))}${f("izin", "Yıllık izin (gün)", inp("izin"))}
          ${f("ranSure", "Randevu çizelge süresi (dk)", inp("ranSure"))}${f("ranGunluk", "Günlük randevu sayısı", inp("ranGunluk"))}
          ${f("saatlikRandevu", "Saatlik ara randevu sayısı", inp("saatlikRandevu"))}${f("ayniTarihRandevu", "Aynı tarihli randevu sayısı", inp("ayniTarihRandevu"))}
          ${f("kurumTipi", "Kurum tipi (randevu)", selOf("kurumTipi", ["Ücretli", "SGK", "ÖSS", "TSS", "AK", "Tümü"]))}
          <div class="fr" style="grid-column:1/-1"><label>Randevu özellikleri</label><div class="icd-oz">${["Web randevusu verilebilir", "Online muayene randevusu", "Poliklinik randevusu verilebilir", "FTR randevusu verilir", "Hizmet randevusu verilir"].map(y => `<label><input type="checkbox" data-rf="${H.esc(y)}"${(p.randevuOzellik || []).includes(y) ? " checked" : ""}> ${H.esc(y)}</label>`).join("")}</div></div>`,
        iletisim:`${f("telefon", "Telefon", inp("telefon"))}${f("eposta", "E-posta", inp("eposta"))}${f("adres", "Adres", `<textarea data-f="adres" rows="2">${H.esc(p.adres || "")}</textarea>`)}${f("acilKisi", "Acil durumda aranacak", inp("acilKisi"))}`,
        yetki:`<div class="icd-oz">${IK_YETKI.map(y => `<label><input type="checkbox" data-y="${H.esc(y)}"${(p.yetki || []).includes(y) ? " checked" : ""}> ${H.esc(y)}</label>`).join("")}</div>`,
      };
      const body = `<div class="pers-card"><div class="seg pers-tabs" data-pt>${TABS.map(([k, l], i) => `<button data-ptab="${k}" class="${i === 0 ? "on" : ""}">${l}</button>`).join("")}</div>
        ${TABS.map(([k], i) => `<div class="icd-form pers-panel" data-panel="${k}"${i === 0 ? "" : " hidden"}>${panels[k]}</div>`).join("")}</div>`;
      H.modal({ title:existing ? "Personel kartı düzenle" : "Yeni personel", wide:true, body,
        actions:`${existing ? `<button class="btn g" data-persdel>${I("trash")}Sil</button>` : ""}<span class="spacer"></span><button class="btn" data-x>Vazgeç</button><button class="btn p" data-perssave>Kaydet</button>`,
        onMount(m) {
          m.querySelector("[data-pt]").onclick = (e) => { const b = e.target.closest("[data-ptab]"); if (!b) return; m.querySelectorAll("[data-ptab]").forEach(x => x.classList.toggle("on", x === b)); m.querySelectorAll("[data-panel]").forEach(x => x.hidden = x.dataset.panel !== b.dataset.ptab); };
          m.querySelector("[data-perssave]").onclick = () => {
            const g = s => { const el = m.querySelector(`[data-f="${s}"]`); return el ? (el.value || "").trim() : ""; };
            const ad = g("ad"); if (!ad) { H.toast("Ad gerekli.", "w"); return; }
            const rec = {}; ["ad", "soyad", "kimlik", "tip", "meslek", "gorev", "unvan", "bolum", "brans", "sube", "diploma", "tescil", "muayeneSure", "ereceteKod", "pasaport", "anne", "baba", "kan", "medeni", "egitim", "uyruk", "dogum", "calismaGun", "calismaSaat", "nobet", "sgk", "izin", "ranSure", "ranGunluk", "saatlikRandevu", "ayniTarihRandevu", "kurumTipi", "telefon", "eposta", "adres", "acilKisi"].forEach(k => rec[k] = g(k));
            rec.yetki = [...m.querySelectorAll("[data-y]:checked")].map(x => x.dataset.y);
            rec.randevuOzellik = [...m.querySelectorAll("[data-rf]:checked")].map(x => x.dataset.rf);
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
  H.register("pharmacy", { title:() => H.t("m_pharmacy"), perm:"pharmacy", render(root) {
    const ab = H.myPatients().filter(p => p.antibioticDay), crit = H.myPatients().filter(p => p.risk === "crit");
    root.innerHTML = `<div class="ph"><div><h2>Eczane</h2><p>Order'lar hastane kaydından gelir. Bu ekran izleme içindir, doz önerisi yapmaz.</p></div></div>
      <div class="att"><div class="ac"><div class="i">${I("pill")}</div><b>${ab.length}</b><span>antibiyotik kullanan hasta</span></div><div class="ac ${ab.some(p => p.antibioticDay >= 3) ? "" : "ok"}"><div class="i">${I("clock")}</div><b>${ab.filter(p => p.antibioticDay >= 3).length}</b><span>3. günü geçen, gözden geçirme zamanı</span></div><div class="ac crit"><div class="i">${I("alert")}</div><b>${crit.length}</b><span>yüksek riskli ilaç (vazopressör) alan</span></div><div class="ac"><div class="i">${I("shield")}</div><b>${H.myPatients().filter(p => p.allergies.length).length}</b><span>kayıtlı alerjisi olan hasta</span></div></div>
      <div class="sec">Antibiyotik kullananlar</div><div class="tw"><table class="t"><tr><th>Yatak</th><th>Hasta</th><th>Tedavi günü</th><th>Alerji</th><th>Son kültür</th><th></th></tr>
        ${ab.map(p => `<tr class="row" data-pid="${p.id}"><td class="n">${H.bed(p.bed).no}</td><td><b>${H.esc(p.name)}</b><div class="mute" style="font-size:11.5px">${H.esc(p.dx)}</div></td><td><b>${p.antibioticDay}. gün</b>${p.antibioticDay >= 3 ? ' <span class="tag w">gözden geçir</span>' : ""}</td><td>${p.allergies.length ? `<span class="tag c">${p.allergies.join(", ")}</span>` : "—"}</td><td class="mute">Kan kültürü · bekleniyor</td><td>${I("chevR")}</td></tr>`).join("")}</table></div>
      <div class="note i" style="margin-top:12px">İlaç etkileşim sorgusu hastanenin ilaç veri tabanına bağlanınca bu ekranda görünecek. Bugün kodda yok.</div>`;
    root.addEventListener("click", e => { const r = e.target.closest("[data-pid]"); if (r) H.go("patient", { pid:r.dataset.pid, tab:"ilac" }); });
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

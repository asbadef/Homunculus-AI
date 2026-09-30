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

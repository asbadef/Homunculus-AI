/* İstem modülü (H.orders): hekimin tetkik/radyoloji/hizmet/ilaç/kan ürünü/konsültasyon istemleri.
 * Tasarım prototipi: istemler H.data.orders'ta tutulur; gerçek HBYS/LIS/PACS/eczane bağlantısını
 * ayrı ekip kurar. Sistem istem/tanı önermez; hekim seçer. Yetki: "orders" (hekim).
 * Laboratuvar/Radyoloji/Hizmet istemleri H.HIZMET (kurumun hizmet listesi) kataloğundan seçilir. */
(function () {
  const H = window.H; if (!H) return;
  const esc = H.esc;
  const me = () => (H.state.user && H.state.user.name) || "";
  const now = () => (H.nowFull ? H.nowFull() : "");
  const bedNo = (p) => (H.bed && H.bed(p.bed) ? H.bed(p.bed).no : p.bed);
  const ic = (n) => (H.icon ? H.icon(n) : "");

  // Hizmet adı: TR seçiliyse ikinci (TR) ad, değilse kurum (AZ) adı. Boşsa diğerine düş.
  const hzName = (row) => (H.state.lang === "TR" ? (row[2] || row[1]) : (row[1] || row[2]));
  // tip: hizmet kataloğunda sayı (H.HIZMET_TIP index), özel kataloglarda düz metin.
  const tipOf = (row) => (typeof row[3] === "number" ? (H.HIZMET_TIP ? H.HIZMET_TIP[row[3]] : "") : (row[3] || ""));

  // İlaç/kan ürünü örnek listesi (katalog dışı; kendi alanları var).
  const KAN = ["Eritrosit Süspansiyonu", "Taze Donmuş Plazma", "Tam Kan", "Random Trombosit Süspansiyonu", "Aferez Trombosit Süspansiyonu", "Kriyopresipitat", "Aferez Granülosit Süspansiyonu", "Havuzlanmış Trombosit"];
  // Hemşirelik bakım kataloğu: tercihen kurum listesi (H.BAKIM = [[kod, ad(AZ), ad(TR)]]), yoksa kısa yedek.
  const BAKIM_FALLBACK = [["B001", "Yara Baxımı", "Yara bakımı"], ["B002", "Ağız Baxımı", "Ağız bakımı"], ["B003", "Pozisiya Dəyişməsi", "Pozisyon değiştirme"], ["B004", "Aspirasiya", "Aspirasyon"]];
  const bakimPool = () => (H.BAKIM && H.BAKIM.length ? H.BAKIM : BAKIM_FALLBACK).map(r => [r[0], r[1], r[2], "Bakım"]);
  // Diyet tipleri (öğün bazlı diyet formunda kullanılır).
  const DIET = ["Normal", "Diyabetik", "Tuzsuz", "Yüksek proteinli", "Düşük proteinli", "Gebe / emziren diyeti", "Sıvı diyet", "Yumuşak diyet", "Gazsız diyet", "Oral alım yok (NPO)"];

  const favs = () => (H.data.hizmetFav = H.data.hizmetFav || {});
  const isFav = (kod) => !!favs()[kod];
  const toggleFav = (kod) => { const f = favs(); if (f[kod]) delete f[kod]; else f[kod] = 1; };

  // Katalogda hizmet olarak GÖSTERİLMEYEN kategoriler: CheckUp bir pakettir (içinde tanımlı lab/rad);
  // 1./2./3. Asistan faturalama kodudur, istenmez. (Ozan)
  const EXCLUDE_TIP = ["CheckUp", "1. Asistan", "2. Asistan", "3. Asistan", "Anestezi Asistanı", "Ameliyathane Dışı Anestezi", "1. Asistan "];

  const all = () => (H.data.orders = H.data.orders || []);
  const ordersOf = (p) => all().filter(o => o.pid === p.id);
  function addOrder(p, o) {
    const protokolNo = (H.proto ? H.proto.activeNo(p.id) : undefined);   // istem, hastanın aktif/açık protokolüne bağlanır
    all().unshift(Object.assign({ id:"ord" + Date.now() + Math.floor(Math.random() * 1e3), pid:p.id, by:me(), at:now(), durum:"İstendi", protokolNo }, o));
    H.saveData && H.saveData();
    H.log("İstem oluşturuldu", bedNo(p) + " · " + o.cat + " · " + (o.ad || "") + (protokolNo ? " · prot " + protokolNo : ""));
  }

  // İstem başlatıcı grupları. Katalogdan seçilenler "kat" ile işaretli; ötekiler kendi kısa formunu açar.
  const GROUPS = [
    ["Tetkik ve görüntüleme", [["lab", "Laboratuvar tetkiki"], ["rad", "Görüntüleme (radyoloji)"]]],
    ["Hizmet ve işlem", [["hizmet", "Hizmet / işlem"], ["kons", "Konsültasyon"], ["diyet", "Diyet istemi"], ["bakim", "Bakım istemi"], ["periyodik", "Periyodik takip"]]],
    ["İlaç ve kan", [["ilac", "İlaç istemi"], ["recete", "İlaç reçetesi"], ["kan", "Kan ürünü"]]],
    ["Ameliyat / yatış", [["ameliyat", "Ameliyat / yatış istemi"]]],
  ];

  function html(p) {
    const list = ordersOf(p);
    const grp = GROUPS.map(([g, items]) => `<div class="ist-g"><h6>${esc(g)}</h6><div class="ist-btns">${items.map(it => `<button class="ist-b" data-ist="${it[0]}">${esc(it[1])}</button>`).join("")}</div></div>`).join("");
    const rows = list.length
      ? `<div class="tw"><table class="t"><thead><tr><th style="width:116px">Saat</th><th style="width:130px">Tür</th><th>İstem</th><th>Ayrıntı</th><th style="width:96px">Durum</th><th style="width:44px"></th></tr></thead><tbody>${list.map(o => `<tr><td class="mono adm-sub">${esc(o.at)}</td><td>${esc(o.cat)}</td><td><b>${esc(o.ad || "")}</b></td><td class="adm-sub">${esc(o.detay || "")}${o.cevap ? `<div style="margin-top:4px;padding:6px 8px;border-left:2px solid var(--ok);background:color-mix(in srgb,var(--ok) 8%,transparent);border-radius:6px"><b>Konsültan cevabı</b> <span class="adm-sub">${esc(o.cevap.by)} · ${esc(o.cevap.at)}</span><div>${esc(o.cevap.metin)}</div>${o.cevap.oneri ? `<div class="adm-sub">Öneri: ${esc(o.cevap.oneri)}</div>` : ""}</div>` : ""}</td><td><span class="tag ${o.durum === "Cevaplandı" ? "ok" : ""}">${esc(o.durum)}</span></td><td><button class="btn g sm" data-istrm="${o.id}" title="Kaldır">${ic("x") || "×"}</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Bu başvuruda henüz istem yok. Yukarıdan bir istem türü seçin.</div>`;
    // Şablonlar (adlı istem paketleri): kapsam Benim / Bölümüm / Tümü. Tek tıkla hepsi hastaya eklenir.
    const mt = tplsFor();
    const scopeTabs = `<div class="seg sm" data-tplsc>${TPL_SCOPES.map(([k, l]) => `<button data-tplscope="${k}" class="${tplScope === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
    const tplRow = mt.length
      ? `<div class="ist-tpls">${mt.map(t => `<span class="ist-tpl"><button class="btn sm" data-tplap="${t.id}" title="Bu paketteki tüm istemleri hastaya ekle · ${esc(t.owner || "")}">${ic("add") || "+"} ${esc(t.name)} <em>${t.items.length}</em></button>${t.owner === me() ? `<button class="btn g sm" data-tpldel="${t.id}" title="Paketi sil">${ic("x") || "×"}</button>` : ""}</span>`).join("")}</div>`
      : `<div class="adm-sub">Bu kapsamda kayıtlı paket yok. Birkaç istem ekleyip <b>Paket olarak kaydet</b> deyin.</div>`;
    const pOpen = H.protoOpen(p), pCan = H.can("admission") || H.can("orders");
    const lockBar = `<div class="ist-lock ${pOpen ? "" : "closed"}">${ic(pOpen ? "ok" : "lock") || ""}<span>Protokol: <b>${pOpen ? "Açık" : (p.faturaKesildi ? "Fatura kesildi · kilitli" : "Kapalı · kilitli")}</b>${pOpen ? "" : " · yeni işlem/hizmet eklenemez"}</span>${pCan ? `<button class="btn sm" data-protokat>${pOpen ? "Protokolü kapat" : "Protokolü aç"}</button>` : ""}${H.can("protokol_duzenle") ? `<button class="btn sm" data-protduz>Protokol işlemleri</button>` : ""}</div>`;
    const payOk = H.ozelOnay(p), payCan = H.can("admission") || H.can("vezne_donem") || H.can("summary") || H.can("orders");
    const payBar = payOk ? "" : `<div class="ist-lock closed">${ic("lock") || ""}<span>Özel onay: <b>Ödeme alınmadı · işlem/hizmet eklenemez</b> · (gerçekte vezne ödemeyi alınca açılır)</span>${payCan ? `<button class="btn sm" data-ozelonay>Özel onay ver (ödeme alındı)</button>` : ""}</div>`;
    const pt = H.protoTipOf(p), ptFlags = pt && pt.flags ? Object.keys(pt.flags).filter(k => pt.flags[k]) : [];
    const ptBar = pt ? `<div class="ist-lock"><span>${ic("key") || ""} Protokol tipi: <b>${esc(pt.ad)}</b>${ptFlags.length ? " · " + ptFlags.map(k => esc(H.ptipLabel ? H.ptipLabel(k) : k)).join(" · ") : ""}</span></div>` : "";
    return `<div class="ist" data-ist-root>${lockBar}${payBar}${ptBar}<div class="ist-launch">${grp}</div>
      <div class="ist-sec"><div class="ist-hd"><h5>Hazır paketler (şablonlar)</h5>${scopeTabs}</div>${tplRow}</div>
      <div class="ist-sec ist-hd"><h5>Bu başvurudaki istemler</h5><span class="r" style="display:flex;gap:8px">${list.length ? `<button class="btn sm" data-tplsave>${ic("save") || ""} Paket olarak kaydet</button>` : ""}<button class="btn sm" data-isthist>${ic("clock") || ""} İstem tarihçesi</button></span></div>${rows}
      <p class="adm-sub" style="margin-top:8px">İstemler bu başvuruda tutulur; laboratuvar, radyoloji ve eczanaya iletilir.</p></div>`;
  }

  /* ---------- Katalog seçici (Laboratuvar / Radyoloji / Hizmet) ---------- */
  function openCatalog(p, cfg, rerender) {
    const tipsOk = cfg.tips;                       // izinli Hizmet Tipi listesi; null → tümü
    const tipIdxOk = tipsOk && (H.HIZMET_TIP || []).reduce((a, t, i) => { if (tipsOk.includes(t)) a[i] = 1; return a; }, {});
    // cfg.pool verilirse özel katalog (ör. bakım); yoksa kurum hizmet listesi (hariç tutulan kategoriler çıkarılır).
    const pool = cfg.pool || (H.HIZMET || []).filter(r => (!tipIdxOk || tipIdxOk[r[3]]) && !EXCLUDE_TIP.includes(tipOf(r)));
    // Sol ağaç: havuzdaki kategoriler + "Favoriler" + "Hepsi"
    const cats = [...new Set(pool.map(r => tipOf(r)))];
    const cart = [];                               // seçilenler: {row, aciklama, acil}
    const state = { cat:"*", q:"", limit:60 };

    const matches = () => {
      const q = state.q.toLowerCase();
      return pool.filter(r => {
        if (state.cat === "fav" && !isFav(r[0])) return false;
        if (state.cat !== "*" && state.cat !== "fav" && tipOf(r) !== state.cat) return false;
        if (!q) return true;
        return (r[1] && r[1].toLowerCase().includes(q)) || (r[2] && r[2].toLowerCase().includes(q)) || (r[0] && r[0].includes(q));
      });
    };

    const treeHtml = () => `<button class="hc-cat ${state.cat === "*" ? "on" : ""}" data-cat="*">Hepsi <em>${pool.length}</em></button>
      <button class="hc-cat ${state.cat === "fav" ? "on" : ""}" data-cat="fav">${ic("star") || "★"} Favoriler <em>${pool.filter(r => isFav(r[0])).length}</em></button>
      <div class="hc-sep"></div>
      ${cats.map(c => `<button class="hc-cat ${state.cat === c ? "on" : ""}" data-cat="${esc(c)}">${esc(c)} <em>${pool.filter(r => tipOf(r) === c).length}</em></button>`).join("")}`;

    const listHtml = () => {
      const m = matches(), shown = m.slice(0, state.limit);
      if (!m.length) return `<div class="empty">Eşleşen hizmet yok.</div>`;
      return `<div class="tw hc-tw"><table class="t"><thead><tr><th style="width:36px"></th><th>Ad</th><th style="width:160px">Katalog</th><th style="width:90px">Kod</th><th style="width:44px"></th></tr></thead><tbody>${shown.map(r => {
        const inCart = cart.some(c => c.row[0] === r[0]);
        return `<tr><td><button class="hc-fav ${isFav(r[0]) ? "on" : ""}" data-fav="${esc(r[0])}" title="Favori">${isFav(r[0]) ? "★" : "☆"}</button></td>
          <td><b>${esc(hzName(r))}</b></td><td class="adm-sub">${esc(tipOf(r))}</td><td class="mono adm-sub">${esc(r[0])}</td>
          <td><button class="btn ${inCart ? "" : "p"} sm" data-add="${esc(r[0])}" ${inCart ? "disabled" : ""}>${inCart ? "✓" : "+"}</button></td></tr>`;
      }).join("")}</tbody></table></div>
      ${m.length > state.limit ? `<div class="hc-more"><button class="btn g sm" data-more>Daha fazla göster (${m.length - state.limit})</button></div>` : ""}`;
    };

    const cartHtml = () => cart.length
      ? cart.map((c, i) => `<div class="hc-cr" data-ci="${i}"><div class="hc-crn"><b>${esc(hzName(c.row))}</b> <span class="mono adm-sub">${esc(c.row[0])}</span></div>
          <input class="hc-crx" data-note="${i}" placeholder="Açıklama (rapora yazılır)" value="${esc(c.aciklama)}">
          <label class="hc-ac"><input type="checkbox" data-acil="${i}" ${c.acil ? "checked" : ""}> Acil</label>
          <button class="btn g sm" data-crm="${i}" title="Çıkar">${ic("x") || "×"}</button></div>`).join("")
      : `<div class="empty" style="padding:14px">Soldan hizmet seçin; buraya eklenir.</div>`;

    const body = `<div class="hc">
      <div class="hc-tree">${treeHtml()}</div>
      <div class="hc-main">
        <div class="hc-search"><input data-q placeholder="Ad veya kodla ara…" autofocus></div>
        <div class="hc-list">${listHtml()}</div>
      </div>
      <div class="hc-cart"><h6>Seçilenler <span data-cn>(${cart.length})</span></h6><div class="hc-cwrap">${cartHtml()}</div></div>
    </div>`;

    H.modal({
      title:cfg.title, wide:true, body,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Seçilenleri isteme ekle</button>`,
      onMount(m) {
        const tree = m.querySelector(".hc-tree"), listEl = m.querySelector(".hc-list"), cartEl = m.querySelector(".hc-cwrap"), cnEl = m.querySelector("[data-cn]"), q = m.querySelector("[data-q]");
        const redrawList = () => { listEl.innerHTML = listHtml(); };
        const redrawTree = () => { tree.innerHTML = treeHtml(); };
        const redrawCart = () => { cartEl.innerHTML = cartHtml(); cnEl.textContent = "(" + cart.length + ")"; };
        q.oninput = () => { state.q = q.value.trim(); state.limit = 60; redrawList(); };
        tree.onclick = (e) => { const b = e.target.closest("[data-cat]"); if (!b) return; state.cat = b.dataset.cat; state.limit = 60; redrawTree(); redrawList(); };
        listEl.onclick = (e) => {
          const more = e.target.closest("[data-more]"); if (more) { state.limit += 60; redrawList(); return; }
          const fv = e.target.closest("[data-fav]"); if (fv) { toggleFav(fv.dataset.fav); redrawList(); redrawTree(); return; }
          const ad = e.target.closest("[data-add]"); if (ad) { const r = pool.find(x => x[0] === ad.dataset.add); if (r && !cart.some(c => c.row[0] === r[0])) { cart.push({ row:r, aciklama:"", acil:false }); redrawList(); redrawCart(); } }
        };
        cartEl.onclick = (e) => { const rm = e.target.closest("[data-crm]"); if (rm) { cart.splice(+rm.dataset.crm, 1); redrawCart(); redrawList(); } };
        cartEl.oninput = (e) => { const n = e.target.closest("[data-note]"); if (n) cart[+n.dataset.note].aciklama = n.value; };
        cartEl.onchange = (e) => { const a = e.target.closest("[data-acil]"); if (a) cart[+a.dataset.acil].acil = a.checked; };
        m.querySelector("[data-ok]").onclick = () => {
          if (!cart.length) { H.toast("Önce hizmet seçin.", "w"); return; }
          cart.forEach(c => addOrder(p, { cat:cfg.cat, ad:hzName(c.row), kod:c.row[0], detay:[c.acil ? "Acil" : "", c.aciklama].filter(Boolean).join(" · ") }));
          H.toast(cart.length + " istem eklendi"); H.closeModal(); rerender();
        };
      },
    });
  }

  /* ---------- Katalog dışı kısa formlar (ilaç/kan/konsültasyon/diyet/bakım) ---------- */
  function openForm(p, type, rerender) {
    const val = (m, s) => { const el = m.querySelector(`[data-f="${s}"]`); return el ? (el.value || "").trim() : ""; };
    const simple = (title, fields, build) => H.modal({ title, body:`<div class="icd-form">${fields}</div>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Ekle</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { const o = build(m); if (!o) return; addOrder(p, o); H.toast("İstem eklendi: " + (o.ad || o.cat)); H.closeModal(); rerender(); }; } });

    if (type === "kan") return simple("Kan ürünü istemi",
      `<div class="fr"><label>Ürün</label><select data-f="ad">${KAN.map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
       <div class="fr"><label>Miktar (torba)</label><input data-f="mik" type="number" value="1" min="1"></div>
       <div class="fr"><label>İstek şekli</label><select data-f="sekil"><option>İstem</option><option>Acil</option><option>Hazırda bulunsun</option></select></div>
       <div class="fr"><label>İstek nedeni</label><input data-f="neden" placeholder="ör. anemi / kanama"></div>`,
      (m) => { const ad = val(m, "ad"), mik = val(m, "mik") || "1"; return { cat:"Kan ürünü", ad, detay:`${mik} torba · ${val(m, "sekil")}${val(m, "neden") ? " · " + val(m, "neden") : ""}` }; });
    if (type === "kons") {
      const units = H.units ? H.units() : [];
      const hekims = (H.data.users || []).filter(u => u.role === "hekim");
      const nowL = new Date().toISOString().slice(0, 16);
      return simple("Konsültasyon istemi",
        `<div class="fr"><label>İstek yapan</label><input value="${esc(me())}" readonly></div>
         <div class="fr"><label>Bölüm</label><input data-f="ad" list="kons-bolum" placeholder="ör. Kardiologiya"><datalist id="kons-bolum">${units.map(u => `<option>${esc(u.tr)}</option>`).join("")}</datalist></div>
         <div class="fr"><label>Hedef doktor (ops.)</label><select data-f="dr"><option value="">—</option>${hekims.map(u => `<option>${esc(u.name)}</option>`).join("")}</select></div>
         <div class="fr"><label>Aciliyet</label><select data-f="acil"><option>Normal</option><option>Acil</option></select></div>
         <div class="fr"><label>İstek tarihi</label><input type="datetime-local" data-f="tarih" value="${nowL}"></div>
         <div class="fr"><label>Konsültasyon nedeni</label><input data-f="det" placeholder="Neden / soru"></div>`,
        (m) => { const ad = val(m, "ad"); if (!ad) { H.toast("Bölüm gerekli.", "w"); return null; }
          const dr = val(m, "dr"), acil = m.querySelector('[data-f="acil"]').value, tarih = m.querySelector('[data-f="tarih"]').value, det = val(m, "det");
          return { cat:"Konsültasyon", ad:ad + (dr ? " · " + dr : ""), detay:[acil, tarih, det, "İsteyen: " + me()].filter(Boolean).join(" · ") }; });
    }
    H.toast("Bu istem türü yakında eklenecek.", "w");
  }

  /* ---------- Diyet istemi (öğün bazlı) ---------- */
  // Diyet adları listesi: tercihen kurum listesi (H.DIYET), yoksa kısa yedek.
  const dietList = () => (H.DIYET && H.DIYET.length ? H.DIYET.map(r => r[1]) : DIET);
  const cutoff = () => (H.data.dietCutoff || H.DIYET_CUTOFF || {});
  // Öğün için son giriş saati geçti mi? (mutfak hazırlığı). "" → sınır yok.
  const mealLate = (meal) => { const c = cutoff()[meal]; if (!c) return false; const n = new Date(), [hh, mm] = c.split(":").map(Number); return (n.getHours() * 60 + n.getMinutes()) > (hh * 60 + mm); };
  function openDiyet(p, rerender) {
    const MEALS = ["Kahvaltı", "Öğle", "Akşam", "Ara öğün", "Ek öğün"];
    const today = new Date().toISOString().slice(0, 10);
    const opts = `<option value="">— seçilmedi —</option>${dietList().map(d => `<option>${esc(d)}</option>`).join("")}`;
    const body = `<div class="dyt">
      <div class="fr"><label>Diyet başlangıcı</label><input type="date" data-f="tarih" value="${today}"></div>
      <div class="tw"><table class="t"><thead><tr><th style="width:132px">Öğün</th><th>Hasta diyeti</th><th style="width:150px">Not</th><th style="width:76px">Porsiyon</th><th style="width:62px">Refakatçi</th><th>Refakatçi diyeti</th></tr></thead><tbody>
      ${MEALS.map((mm, i) => { const late = mealLate(mm), c = cutoff()[mm];
        return `<tr><td><b>${esc(mm)}</b>${c ? `<div class="dyt-cut ${late ? "late" : ""}">son ${esc(c)}${late ? " · geçti" : ""}</div>` : ""}</td>
        <td><select data-diet="${i}">${opts}</select></td>
        <td><input data-dnot="${i}" placeholder="Not"></td>
        <td><input type="number" data-dpor="${i}" value="1" min="0" style="width:62px"></td>
        <td style="text-align:center"><input type="checkbox" data-dref="${i}"></td>
        <td><select data-drefd="${i}" disabled>${opts}</select></td></tr>`; }).join("")}
      </tbody></table></div>
      <p class="adm-sub" style="margin-top:6px">Diyet tipi seçili öğünler istemle mutfağa iletilir. Son saati geçen öğün bir sonraki güne geçebilir.</p></div>`;
    H.modal({ title:"Diyet istemi", wide:true, body,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>İsteme ekle</button>`,
      onMount(m) {
        // Refakatçi işaretlenince refakatçi diyeti seçimi açılır.
        m.querySelectorAll("[data-dref]").forEach(cb => cb.onchange = () => { const d = m.querySelector(`[data-drefd="${cb.dataset.dref}"]`); d.disabled = !cb.checked; if (!cb.checked) d.value = ""; });
        m.querySelector("[data-ok]").onclick = () => {
          const tarih = m.querySelector("[data-f='tarih']").value || today;
          let lateHit = false;
          const picked = MEALS.map((mm, i) => {
            const diet = m.querySelector(`[data-diet="${i}"]`).value;
            if (!diet) return null;
            if (mealLate(mm)) lateHit = true;
            const not = m.querySelector(`[data-dnot="${i}"]`).value.trim();
            const por = m.querySelector(`[data-dpor="${i}"]`).value;
            const ref = m.querySelector(`[data-dref="${i}"]`).checked;
            const refd = m.querySelector(`[data-drefd="${i}"]`).value;
            return `${mm}: ${diet}${por ? " ×" + por : ""}${ref ? " · refakatçi" + (refd ? " (" + refd + ")" : "") : ""}${not ? " · " + not : ""}`;
          }).filter(Boolean);
          if (!picked.length) { H.toast("En az bir öğüne diyet seçin.", "w"); return; }
          if (lateHit) H.toast("Bazı öğünlerde mutfak saati geçti; bir sonraki güne geçebilir.", "w");
          addOrder(p, { cat:"Diyet", ad:"Diyet planı", detay:`${tarih} · ${picked.join(" | ")}` });
          H.toast("Diyet istemi eklendi"); H.closeModal(); rerender();
        };
      } });
  }

  /* ---------- Ameliyat / yatış istemi ---------- */
  function openAmeliyat(p, rerender) {
    const today = new Date().toISOString().slice(0, 16);
    const hekims = (H.data.users || []).filter(u => u.role === "hekim");
    const units = (H.units ? H.units() : []).filter(u => u.tier !== "op" || u.type === "op");
    const ANES = ["Genel", "Spinal", "Lokal", "İntravenöz", "İnfiltrasyon", "Rejyonal", "Sedoanaljezi"];
    const OPTS = [["ameliyathane", "Ameliyathane kullanımı"], ["malzeme", "Özellikli malzeme"], ["kanrez", "Kan ürünü rezerve"], ["patoloji", "Muhtemel patoloji"], ["frozen", "Frozen inceleme"], ["konsinye", "Konsinye malzeme"]];
    const body = `<div class="icd-form amf">
      <div class="fg2">
        <div class="fr"><label>Aciliyet</label><select data-f="acil"><option>Normal</option><option>En kısa sürede</option><option>Acil</option></select></div>
        <div class="fr"><label>Ameliyat tarihi</label><input type="datetime-local" data-f="tarih" value="${today}"></div>
        <div class="fr"><label>Yatış süresi (gün)</label><input type="number" data-f="yatis" value="1" min="0"></div>
        <div class="fr"><label>Yoğun bakım süresi (gün)</label><input type="number" data-f="ybu" value="0" min="0"></div>
        <div class="fr"><label>Bölüm</label><select data-f="bolum"><option value="">—</option>${units.map(u => `<option>${esc(u.tr)}</option>`).join("")}</select></div>
        <div class="fr"><label>Cerrah</label><select data-f="cerrah">${hekims.map(u => `<option>${esc(u.name)}</option>`).join("")}</select></div>
      </div>
      <label class="hc-ac" style="margin:4px 0 10px"><input type="checkbox" data-f="gunubirlik"> Günübirlik ameliyat</label>
      <div class="fr"><label>Yapılacak ameliyat</label><div class="amel-cb"><input data-f="ad" placeholder="Ameliyat ara (katalogdan)" autocomplete="off"><div class="amel-dd hidden" data-amel-dd></div></div></div>
      <div class="fg2">
        <div class="fr"><label>Anestezi tipi</label><select data-f="anes">${ANES.map(a => `<option>${esc(a)}</option>`).join("")}</select></div>
        <div class="fr"><label>Anestezi değerlendirmesi</label><select data-f="anesist"><option>İç anestezist</option><option>Dış anestezist</option><option>Gerekmez</option></select></div>
      </div>
      <div class="fg2">
        <div class="fr"><label>Kesi tipi (yara sınıfı)</label><select data-f="kesi"><option>Temiz</option><option>Temiz-kontamine</option><option>Kontamine</option><option>Kirli / enfekte</option></select></div>
        <div class="fr"><label>Ameliyat grubu (faturalama)</label><select data-f="grup"><option value="">—</option>${["A (büyük)", "B", "C", "D", "E (küçük)"].map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
      </div>
      <div class="fr"><label>Özellikli istekler</label><div class="amf-opts">${OPTS.map(o => `<label class="hc-ac"><input type="checkbox" data-opt="${o[0]}"> ${esc(o[1])}</label>`).join("")}</div></div>
      <div class="fr"><label>Gerekli onamlar</label><input data-f="onam" placeholder="ör. Ameliyat ve anestezi onamı"></div>
      <div class="fr"><label>İstek notu</label><input data-f="not" placeholder="Not"></div>
      <p class="adm-sub">Ameliyat planı ameliyathane ve anesteziye iletilir; onam çıktısı alınır.</p></div>`;
    H.modal({ title:"Ameliyat / yatış istemi", wide:true, body,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>İsteme ekle</button>`,
      onMount(m) {
        const v = (s) => { const el = m.querySelector(`[data-f="${s}"]`); return el ? (el.type === "checkbox" ? el.checked : (el.value || "").trim()) : ""; };
        // "Yapılacak ameliyat": sisteme yüklü ameliyat hizmetleri kataloğundan aranarak seçilir.
        const AMEL = (H.HIZMET || []).filter(r => ["Ameliyat Hizmeti", "Ameliyathane Hizmeti"].includes(tipOf(r)));
        const adEl = m.querySelector('[data-f="ad"]'), dd = m.querySelector("[data-amel-dd]");
        adEl.oninput = () => { adEl.dataset.code = ""; const q = adEl.value.trim().toLowerCase(); if (q.length < 2) { dd.classList.add("hidden"); return; }
          const hits = AMEL.filter(r => (r[1] && r[1].toLowerCase().includes(q)) || (r[2] && r[2].toLowerCase().includes(q)) || r[0].includes(q)).slice(0, 40);
          dd.innerHTML = hits.length ? hits.map(r => `<div class="amel-opt" data-code="${esc(r[0])}"><b>${esc(hzName(r))}</b> <span class="mono adm-sub">${esc(r[0])}</span></div>`).join("") : `<div class="amel-opt mute">Eşleşen ameliyat yok</div>`;
          dd.classList.remove("hidden"); };
        dd.onclick = (e) => { const o = e.target.closest("[data-code]"); if (!o) return; const r = AMEL.find(x => x[0] === o.dataset.code); if (r) { adEl.value = hzName(r); adEl.dataset.code = r[0]; } dd.classList.add("hidden"); };
        document.addEventListener("click", (e) => { if (!m.querySelector(".amel-cb").contains(e.target)) dd.classList.add("hidden"); });
        m.querySelector("[data-ok]").onclick = () => {
          const ad = v("ad"); if (!ad) { H.toast("Yapılacak ameliyatı seçin.", "w"); return; }
          const kod = adEl.dataset.code;
          const opts = OPTS.filter(o => m.querySelector(`[data-opt="${o[0]}"]`).checked).map(o => o[1]);
          const det = [kod ? "Kod " + kod : "", v("acil"), v("gunubirlik") ? "Günübirlik" : `Yatış ${v("yatis")} gün`, +v("ybu") ? `YBÜ ${v("ybu")} gün` : "",
            v("bolum"), v("cerrah"), "Anestezi: " + v("anes"), v("anesist"), v("kesi") ? "Kesi: " + v("kesi") : "", v("grup") ? "Grup " + v("grup") : "", opts.join(" + "), v("onam") ? "Onam: " + v("onam") : "", v("not")].filter(Boolean).join(" · ");
          addOrder(p, { cat:"Ameliyat", ad, detay:det, kesiTipi:v("kesi"), ameliyatGrubu:v("grup") });
          H.toast("Ameliyat istemi eklendi"); H.closeModal(); rerender();
        };
      } });
  }

  /* ---------- Şablonlar (adlı istem paketleri) · kapsam: Benim / Bölümüm / Tümü ---------- */
  const TPL_SCOPES = [["benim", "Benim"], ["bolum", "Bölümüm"], ["tumu", "Tümü"]];
  let tplScope = "benim";
  const myDept = () => (H.state.user && (H.state.user.units || []).slice().sort().join(",")) || "";
  const tpls = () => (H.data.orderTemplates = H.data.orderTemplates || []);
  const tplsFor = () => tpls().filter(t => tplScope === "tumu" ? true : tplScope === "bolum" ? (t.dept === myDept() || t.owner === me()) : (t.owner === me() || !t.owner));
  function saveTemplate(p, rerender) {
    const items = ordersOf(p).map(o => ({ cat:o.cat, ad:o.ad, detay:o.detay }));
    if (!items.length) { H.toast("Önce birkaç istem ekleyin.", "w"); return; }
    H.modal({ title:"İstem paketi (şablon) kaydet",
      body:`<div class="icd-form"><div class="fr"><label>Paket adı</label><input data-f="ad" placeholder="ör. Apse drenajı paketi" autofocus></div>
        <div class="fr"><label>Paylaşım</label><select data-f="scope"><option value="benim">Yalnız benim</option><option value="bolum">Bölümüm</option><option value="tumu">Tümü (hastane)</option></select></div>
        <p class="adm-sub">Bu başvurudaki ${items.length} istem bu adla paket olur; sonra tek tıkla başka hastaya da istenebilir.</p></div>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Kaydet</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => {
        const ad = (m.querySelector("[data-f='ad']").value || "").trim(); if (!ad) { H.toast("Paket adı gerekli.", "w"); return; }
        const scope = m.querySelector('[data-f="scope"]').value;
        tpls().unshift({ id:"tpl" + Date.now(), name:ad, owner:me(), dept:myDept(), scope, items });
        H.log("İstem paketi kaydedildi", ad + " · " + items.length + " istem · " + scope); H.toast("Paket kaydedildi: " + ad); H.closeModal(); rerender(); }; } });
  }
  function applyTemplate(p, id, rerender) {
    if (!H.protoOpen(p)) { H.toast("Protokol kapalı · işlem eklenemez.", "e"); return; }
    if (!H.ozelOnay(p)) { H.toast("Özel onay yok (ödeme alınmadı) · işlem eklenemez.", "e"); return; }
    const t = tpls().find(x => x.id === id); if (!t) return;
    t.items.forEach(it => addOrder(p, { cat:it.cat, ad:it.ad, detay:it.detay }));
    H.toast(t.name + " paketi eklendi (" + t.items.length + " istem)"); rerender();
  }

  /* ---------- İstem tarihçesi (bu hastanın tüm istemleri, zaman sırasıyla) ---------- */
  function openHistory(p) {
    const list = ordersOf(p);   // en yeni en üstte
    const body = list.length
      ? `<div class="tw"><table class="t"><thead><tr><th style="width:130px">Zaman</th><th style="width:120px">Tür</th><th>İstem</th><th>Ayrıntı</th><th style="width:90px">Durum</th><th style="width:150px">İsteyen</th></tr></thead><tbody>${list.map(o => `<tr><td class="mono adm-sub">${esc(o.at)}</td><td>${esc(o.cat)}</td><td><b>${esc(o.ad || "")}</b></td><td class="adm-sub">${esc(o.detay || "")}</td><td><span class="tag">${esc(o.durum)}</span></td><td class="adm-sub">${esc(o.by || "")}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Bu hastada henüz istem yok.</div>`;
    H.modal({ title:"İstem tarihçesi", wide:true, body:`${body}<p class="adm-sub" style="margin-top:8px">Hastanın tüm istemleri zaman sırasıyla. Gerçek sistemde önceki başvurular da burada listelenir (HBYS bağlantısıyla).</p>`,
      actions:`<button class="btn p" data-x>Kapat</button>` });
  }

  /* ---------- İlaç reçetesi (çok ilaçlı) ---------- */
  const RECETE_TUR = ["Normal", "Narkotik", "Psikotrop", "Kontrollü"];   // Azerbaycan muadili netleşince düzenlenir
  const RECETE_ALT = ["Ayakta reçetesi", "Taburcu reçetesi"];
  const RECETE_YOL = ["Ağızdan", "IV", "IM", "SC", "Topikal", "İnhalasyon", "Rektal", "Göze/kulağa"];
  function openRecete(p, rerender) {
    const drugs = [];   // {ad, doz, siklik, sure, yol, not}
    const body = `<div class="rc">
      <div class="rc-head">
        <div class="fr"><label>Reçete türü</label><select data-f="tur">${RECETE_TUR.map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
        <div class="fr"><label>Alt tür</label><select data-f="alt">${RECETE_ALT.map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
        <div class="fr"><label>Tanı (ICD)</label><input data-f="tani" value="${esc((p.dx || "") + (p.icd ? " (" + p.icd + ")" : ""))}" placeholder="Tanı / ICD"></div>
      </div>
      <h6 style="margin:14px 0 6px">İlaç ekle</h6>
      <div class="rc-add">
        <input data-r="ad" placeholder="İlaç adı (ör. Parasetamol 500 mg)">
        <input data-r="doz" placeholder="Doz/miktar" style="max-width:120px">
        <input data-r="siklik" placeholder="Sıklık (2x1)" style="max-width:110px">
        <input data-r="sure" placeholder="Süre (7 gün)" style="max-width:110px">
        <select data-r="yol">${RECETE_YOL.map(x => `<option>${esc(x)}</option>`).join("")}</select>
        <input data-r="not" placeholder="Açıklama">
        <button class="btn p sm" data-radd>Ekle</button>
      </div>
      <div class="tw" style="margin-top:10px"><table class="t"><thead><tr><th>İlaç</th><th>Doz</th><th>Sıklık</th><th>Süre</th><th>Yol</th><th>Açıklama</th><th style="width:40px"></th></tr></thead><tbody data-rclist><tr><td colspan="7" class="empty" style="padding:14px">Henüz ilaç eklenmedi.</td></tr></tbody></table></div>
      <p class="adm-sub" style="margin-top:8px">İlaç listesi/etkileşim sorgusu, ilaç kataloğu yüklenince bağlanır. Azerbaycan reçete türü (e-reçete) netleşince güncellenir.</p></div>`;
    H.modal({ title:"İlaç reçetesi", wide:true, body,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Reçeteyi isteme ekle</button>`,
      onMount(m) {
        const g = s => (m.querySelector(`[data-r="${s}"]`).value || "").trim();
        const listEl = m.querySelector("[data-rclist]");
        const draw = () => { listEl.innerHTML = drugs.length ? drugs.map((d, i) => `<tr><td><b>${esc(d.ad)}</b></td><td>${esc(d.doz)}</td><td>${esc(d.siklik)}</td><td>${esc(d.sure)}</td><td>${esc(d.yol)}</td><td class="adm-sub">${esc(d.not)}</td><td><button class="btn g sm" data-rrm="${i}">${ic("x") || "×"}</button></td></tr>`).join("") : `<tr><td colspan="7" class="empty" style="padding:14px">Henüz ilaç eklenmedi.</td></tr>`; };
        m.querySelector("[data-radd]").onclick = () => { const ad = g("ad"); if (!ad) { H.toast("İlaç adı gerekli.", "w"); return; }
          drugs.push({ ad, doz:g("doz"), siklik:g("siklik"), sure:g("sure"), yol:m.querySelector('[data-r="yol"]').value, not:g("not") });
          ["ad", "doz", "siklik", "sure", "not"].forEach(s => m.querySelector(`[data-r="${s}"]`).value = ""); m.querySelector('[data-r="ad"]').focus(); draw(); };
        listEl.onclick = (e) => { const rm = e.target.closest("[data-rrm]"); if (rm) { drugs.splice(+rm.dataset.rrm, 1); draw(); } };
        m.querySelector("[data-ok]").onclick = () => {
          if (!drugs.length) { H.toast("En az bir ilaç ekleyin.", "w"); return; }
          const tur = m.querySelector('[data-f="tur"]').value, alt = m.querySelector('[data-f="alt"]').value, tani = (m.querySelector('[data-f="tani"]').value || "").trim();
          drugs.forEach(d => addOrder(p, { cat:"Reçete", ad:d.ad, detay:[tur, alt, [d.doz, d.siklik, d.sure, d.yol].filter(Boolean).join(" · "), d.not, tani ? "Tanı: " + tani : ""].filter(Boolean).join(" · ") }));
          H.toast(drugs.length + " ilaçlı reçete eklendi"); H.closeModal(); rerender();
        };
      } });
  }

  /* ---------- İlaç istemi (katalogdan aranır, dozlu) ---------- */
  const ILAC_SIKLIK = ["1x1", "2x1", "3x1", "4x1", "1x2", "Tek doz (stat)", "Gerektiğinde (PRN)", "Sürekli infüzyon"];
  const ilacPool = () => (H.ILAC || []).concat(H.data.ilacEk || []);   // kurum ilaç listesi + admin'in eklediği ilaçlar
  function openIlac(p, rerender) {
    const body = `<div class="icd-form amf">
      <div class="fr"><label>İlaç</label><div class="amel-cb"><input data-f="ad" placeholder="İlaç ara (ad veya barkod · katalogdan)" autocomplete="off"><div class="amel-dd hidden" data-ilac-dd></div></div><div class="adm-sub" data-ilac-info style="margin-top:4px"></div></div>
      <div class="fg2">
        <div class="fr"><label>Doz / miktar</label><input data-f="doz" placeholder="ör. 500 mg"></div>
        <div class="fr"><label>Sıklık</label><input data-f="siklik" list="ilac-siklik" placeholder="ör. 2x1"><datalist id="ilac-siklik">${ILAC_SIKLIK.map(x => `<option value="${esc(x)}">`).join("")}</datalist></div>
        <div class="fr"><label>Veriliş yolu</label><select data-f="yol">${RECETE_YOL.map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
        <div class="fr"><label>Süre</label><input data-f="sure" placeholder="ör. 7 gün"></div>
        <div class="fr"><label>Başlangıç</label><input type="date" data-f="bas" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="fr"><label>İstem miktarı (adet)</label><input type="number" data-f="adet" value="1" min="1"></div>
      </div>
      <div class="fr" style="grid-column:1/-1"><details><summary class="adm-sub" style="cursor:pointer;font-weight:600">Doz / infüzyon hesaplayıcı (kg · VYA · akış hızı)</summary>
        <div class="icd-form" style="grid-template-columns:1fr 1fr 1fr;margin-top:8px">
          <div class="fr"><label>Kilo (kg)</label><input type="number" data-f="kg" value="${p.weight || ""}"></div>
          <div class="fr"><label>Boy (cm)</label><input type="number" data-f="boy" value="${p.height || ""}"></div>
          <div class="fr"><label>VYA (m²)</label><input data-f="vya" readonly placeholder="oto (Mosteller)"></div>
          <div class="fr"><label>mg/kg doz</label><input type="number" data-f="mgkg" placeholder="ör. 10"></div>
          <div class="fr" style="grid-column:2/-1;align-self:end"><button class="btn sm" type="button" data-dozhesap>Hesapla → Doz'a yaz</button> <span class="adm-sub" data-dozsonuc></span></div>
          <div class="fr"><label>İnfüzyon hacmi (ml)</label><input type="number" data-f="hacim" placeholder="ör. 100"></div>
          <div class="fr"><label>Süre (saat)</label><input type="number" data-f="infsure" step="0.25" placeholder="ör. 2"></div>
          <div class="fr"><label>Akış hızı (ml/saat)</label><input data-f="akis" readonly placeholder="oto"></div>
        </div></details></div>
      <div class="fr"><label>Özellikli istekler</label><div class="amf-opts"><label class="hc-ac"><input type="checkbox" data-opt="acil"> Acil (STAT)</label><label class="hc-ac"><input type="checkbox" data-opt="prn"> Gerektiğinde (PRN)</label></div></div>
      <div class="fr"><label>İstem notu</label><input data-f="not" placeholder="Not"></div>
      <p class="adm-sub">İlaç istemi eczaneye iletilir; eczacı karşılar. Doz/etkileşim denetimi eczane karşılamada yapılır.</p></div>`;
    H.modal({ title:"İlaç istemi", wide:true, body,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>İsteme ekle</button>`,
      onMount(m) {
        const v = (s) => { const el = m.querySelector(`[data-f="${s}"]`); return el ? (el.value || "").trim() : ""; };
        const pool = ilacPool();
        const adEl = m.querySelector('[data-f="ad"]'), dd = m.querySelector("[data-ilac-dd]"), info = m.querySelector("[data-ilac-info]");
        // Katalogdan arama: ad veya barkod. Seçilen ilacın grubu/formu/fiyatı altında gösterilir.
        adEl.oninput = () => { adEl.dataset.code = ""; info.textContent = ""; const q = adEl.value.trim().toLowerCase(); if (q.length < 2) { dd.classList.add("hidden"); return; }
          const hits = pool.filter(r => (r[1] && r[1].toLowerCase().includes(q)) || (r[0] && String(r[0]).includes(q))).slice(0, 40);
          dd.innerHTML = hits.length ? hits.map(r => `<div class="amel-opt" data-code="${esc(String(r[0]))}"><b>${esc(r[1])}</b> <span class="adm-sub">${esc([r[2], r[3]].filter(Boolean).join(" · "))}</span></div>`).join("") : `<div class="amel-opt mute">Eşleşen ilaç yok</div>`;
          dd.classList.remove("hidden"); };
        dd.onclick = (e) => { const o = e.target.closest("[data-code]"); if (!o) return; const r = pool.find(x => String(x[0]) === o.dataset.code); if (r) { adEl.value = r[1]; adEl.dataset.code = String(r[0]); info.textContent = [r[2], r[3], +r[4] ? (+r[4]).toFixed(2) + " ₼" : ""].filter(Boolean).join(" · "); } dd.classList.add("hidden"); };
        document.addEventListener("click", (e) => { if (!m.querySelector(".amel-cb") || !m.querySelector(".amel-cb").contains(e.target)) dd.classList.add("hidden"); });
        // Doz/infüzyon hesaplayıcı: VYA (Mosteller), kg×mg/kg → doz, hacim/süre → ml/saat.
        const gel = (s) => m.querySelector(`[data-f="${s}"]`), num = (s) => +(gel(s) || {}).value || 0;
        const hesapVya = () => { const kg = num("kg"), boy = num("boy"); gel("vya").value = (kg > 0 && boy > 0) ? (Math.sqrt(kg * boy / 3600)).toFixed(2) : ""; };
        const hesapAkis = () => { const h = num("hacim"), s = num("infsure"); gel("akis").value = (h > 0 && s > 0) ? (h / s).toFixed(1) : ""; };
        ["kg", "boy"].forEach(s => gel(s) && (gel(s).oninput = hesapVya)); ["hacim", "infsure"].forEach(s => gel(s) && (gel(s).oninput = hesapAkis)); hesapVya();
        const dz = m.querySelector("[data-dozhesap]"); if (dz) dz.onclick = () => { const kg = num("kg"), mgkg = num("mgkg"); if (kg <= 0 || mgkg <= 0) { H.toast("Kilo ve mg/kg girin.", "w"); return; }
          const doz = Math.round(kg * mgkg * 100) / 100; gel("doz").value = doz + " mg"; m.querySelector("[data-dozsonuc]").textContent = kg + " kg × " + mgkg + " mg/kg = " + doz + " mg"; };
        m.querySelector("[data-ok]").onclick = () => {
          const ad = v("ad"); if (!ad) { H.toast("İlaç gerekli.", "w"); return; }
          const opts = [m.querySelector('[data-opt="acil"]').checked ? "Acil (STAT)" : "", m.querySelector('[data-opt="prn"]').checked ? "PRN" : ""].filter(Boolean);
          const detay = [v("doz"), v("siklik"), v("yol"), v("sure"), v("akis") ? "Akış " + v("akis") + " ml/saat" : "", v("bas") ? "Başl. " + v("bas") : "", +v("adet") > 1 ? v("adet") + " adet" : "", ...opts, v("not")].filter(Boolean).join(" · ");
          addOrder(p, { cat:"İlaç", ad, kod:adEl.dataset.code || "", detay });
          H.toast("İlaç istemi eklendi: " + ad); H.closeModal(); rerender();
        };
      } });
  }

  /* ---------- Periyodik takip: kronik hasta için otomatik tekrarlayan kontrol/tetkik randevuları ---------- */
  const PERIYOT = [["Haftalık", 7], ["15 günde bir", 15], ["Aylık", 30], ["3 ayda bir", 90], ["6 ayda bir", 180], ["Yıllık", 365]];
  function openPeriyodik(p, rerender) {
    const units = H.units ? H.units() : [], today = new Date().toISOString().slice(0, 10);
    const doktor = (H.userBy && H.userBy(p.attending) ? H.userBy(p.attending).name : "") || me();
    H.modal({ title:"Periyodik takip planı · " + esc(p.name),
      body:`<div class="icd-form">
        <div class="fr"><label>Takip türü</label><select data-f="tur"><option>Kontrol muayenesi</option><option>Laboratuvar tetkiki</option><option>Görüntüleme (radyoloji)</option><option>Diğer</option></select></div>
        <div class="fr"><label>Açıklama</label><input data-f="ad" placeholder="ör. HbA1c + açlık glukozu"></div>
        <div class="fr"><label>Sıklık</label><select data-f="sik">${PERIYOT.map(([l, d]) => `<option value="${d}">${esc(l)}</option>`).join("")}</select></div>
        <div class="fr"><label>Kaç kez</label><input type="number" data-f="adet" value="6" min="1" max="24"></div>
        <div class="fr"><label>Başlangıç</label><input type="date" data-f="bas" value="${today}"></div>
        <div class="fr"><label>Bölüm</label><input data-f="bolum" list="per-bol" value="${esc(p.bolum || "")}"><datalist id="per-bol">${units.map(u => `<option>${esc(u.tr)}</option>`).join("")}</datalist></div>
      </div><p class="adm-sub">Seçilen sıklıkta ileri tarihli kontrol randevuları otomatik oluşur (hastaya ve doktorun randevu listesine düşer).</p>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Planı oluştur</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => {
        const g = (k) => (m.querySelector(`[data-f="${k}"]`).value || "").trim();
        const tur = m.querySelector('[data-f="tur"]').value, ad = g("ad"), sik = +m.querySelector('[data-f="sik"]').value || 30, adet = Math.max(1, Math.min(24, +g("adet") || 6)), bolum = g("bolum") || "—";
        const bas = new Date(g("bas") || today); if (isNaN(bas.getTime())) { H.toast("Başlangıç tarihi geçersiz.", "w"); return; }
        const rand = (H.data.randevular = H.data.randevular || []), planId = "per" + Date.now();
        for (let i = 1; i <= adet; i++) { const t = new Date(bas); t.setDate(t.getDate() + sik * i);
          rand.unshift({ id:planId + "_" + i, hasta:p.name, bolum, doktor, tarih:t.toISOString().slice(0, 16), durum:"Bekliyor", not:"Periyodik takip: " + tur + (ad ? " · " + ad : ""), periyodik:planId, sira:i + "/" + adet }); }
        (H.data.periyodikTakip = H.data.periyodikTakip || []).unshift({ id:planId, pid:p.id, hasta:p.name, tur, ad, sik, adet, bolum, doktor, bas:g("bas") || today, at:now() });
        const sikL = (PERIYOT.find(x => x[1] === sik) || ["", ""])[0];
        addOrder(p, { cat:"Periyodik takip", ad:(ad || tur), detay:adet + " kez · " + sikL + " · " + bolum });   // istem listesinde işaret
        H.saveData && H.saveData(); H.log("Periyodik takip oluşturuldu", bedNo(p) + " · " + tur + " · " + adet + " kez / " + sik + " gün");
        H.closeModal(); H.toast(adet + " kontrol randevusu oluşturuldu (periyodik takip)"); rerender();
      }; } });
  }

  function dispatch(p, key, rerender) {
    if (!H.protoOpen(p)) { H.toast("Protokol kapalı / fatura kesildi · işlem eklenemez.", "e"); return; }
    if (!H.ozelOnay(p)) { H.toast("Özel onay yok (ödeme alınmadı) · işlem eklenemez.", "e"); return; }
    if (key === "periyodik") return openPeriyodik(p, rerender);
    if (key === "ilac") return openIlac(p, rerender);
    if (key === "recete") return openRecete(p, rerender);
    if (key === "lab") return openCatalog(p, { title:"Laboratuvar tetkiki", tips:["Laboratuvar Hizmeti", "Patoloji Hizmeti"], cat:"Laboratuvar" }, rerender);
    if (key === "rad") return openCatalog(p, { title:"Görüntüleme (radyoloji)", tips:["Radyoloji Hizmeti"], cat:"Radyoloji" }, rerender);
    if (key === "hizmet") return openCatalog(p, { title:"Hizmet / işlem", tips:null, cat:"Hizmet" }, rerender);
    if (key === "bakim") return openCatalog(p, { title:"Bakım istemi", pool:bakimPool(), cat:"Bakım" }, rerender);
    if (key === "diyet") return openDiyet(p, rerender);
    if (key === "ameliyat") return openAmeliyat(p, rerender);
    return openForm(p, key, rerender);   // ilac / kan / kons
  }

  // Protokol işlemleri: bölüm/doktor/tarih düzelt, hizmet tarihlerini düzelt, protokolü sil (yetkiye bağlı).
  function protokolModal(p, rerender) {
    if (!H.can("protokol_duzenle")) { H.toast("Protokol düzenleme yetkiniz yok.", "e"); return; }
    const bols = H.klinikBolumler ? H.klinikBolumler() : (H.data.bolumler || []), heks = (H.data.users || []).filter(u => u.role === "hekim"), ords = ordersOf(p);
    H.modal({ title:"Protokol işlemleri · " + esc(p.name), wide:true,
      body:`<div class="icd-form">
        <div class="fr"><label>Protokol no</label><input value="${esc(p.proto || "—")}" readonly></div>
        <div class="fr"><label>Bölüm</label><select data-pf="bolum"><option value="">—</option>${bols.map(b => `<option${(p.bolum || "") === b.ad ? " selected" : ""}>${esc(b.ad)}</option>`).join("")}</select></div>
        <div class="fr"><label>Doktor</label><select data-pf="attending"><option value="">—</option>${heks.map(u => `<option value="${esc(u.u)}"${p.attending === u.u ? " selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
        <div class="fr"><label>Protokol tarihi</label><input type="date" data-pf="tarih" value="${esc((p.protoTarih || "").slice(0, 10))}"></div>
      </div>
      ${ords.length ? `<div class="ist-sec ist-hd"><h5>Girilen hizmetlerin tarihleri</h5></div>
        <div class="tw"><table class="t"><thead><tr><th>İşlem</th><th style="width:190px">Tarih / saat</th></tr></thead><tbody>
        ${ords.map(o => `<tr><td>${esc(o.ad || o.cat || "—")} <span class="adm-sub">${esc(o.cat || "")}</span></td><td><input data-ord="${o.id}" value="${esc(o.at || "")}" style="width:180px"></td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="adm-sub" style="margin-top:8px">Protokolün bölümü/doktoru/tarihi ve doktorun girdiği hizmetlerin tarihleri buradan düzeltilir. Her değişiklik denetim kaydına yazılır.</p>`,
      actions:`<button class="btn g" data-protsil>${ic("trash") || ""} Protokolü sil</button><span class="spacer"></span><button class="btn" data-x>Vazgeç</button><button class="btn p" data-protkay>Kaydet</button>`,
      onMount(m) {
        m.querySelector("[data-protkay]").onclick = () => { const g = (k) => { const el = m.querySelector(`[data-pf="${k}"]`); return el ? el.value : ""; };
          if (g("bolum")) p.bolum = g("bolum"); if (g("attending")) p.attending = g("attending"); if (g("tarih")) p.protoTarih = g("tarih");
          m.querySelectorAll("[data-ord]").forEach(i => { const o = all().find(x => x.id === i.dataset.ord); if (o) o.at = i.value; });
          H.log("Protokol düzenlendi", bedNo(p) + " · " + (p.proto || "")); H.closeModal(); H.toast("Protokol güncellendi"); rerender(); };
        m.querySelector("[data-protsil]").onclick = () => { if (!confirm("Bu protokol silinsin mi? (Geri alınamaz)")) return; p.protoDurum = "Silindi"; p.protoSilindi = true; H.log("Protokol SİLİNDİ", bedNo(p) + " · " + (p.proto || "")); H.closeModal(); H.toast("Protokol silindi", "w"); H.go("gelisler"); };
      } });
  }
  function after(el, p) {
    const root = (el && el.querySelector) ? (el.matches && el.matches("[data-ist-root]") ? el : el.querySelector("[data-ist-root]")) : null;
    if (!root) return;
    const rerender = () => H.go("patient", { pid:p.id, tab:"istem" });
    root.onclick = (e) => {
      const pk = e.target.closest("[data-protokat]"); if (pk) { if (!(H.can("admission") || H.can("orders"))) return; const willOpen = !H.protoOpen(p); p.protoDurum = willOpen ? "Açık" : "Kapalı"; if (willOpen) p.faturaKesildi = false; H.log("Protokol durumu", bedNo(p) + " · " + p.protoDurum); H.toast("Protokol " + p.protoDurum.toLowerCase()); rerender(); return; }
      const oz = e.target.closest("[data-ozelonay]"); if (oz) { if (!(H.can("admission") || H.can("vezne_donem") || H.can("summary") || H.can("orders"))) { H.toast("Özel onay yetkiniz yok.", "e"); return; } p.ozelOnay = true; H.log("Özel onay verildi (ödeme alındı)", bedNo(p)); H.toast("Özel onay verildi · işlem eklenebilir"); rerender(); return; }
      const pd = e.target.closest("[data-protduz]"); if (pd) { protokolModal(p, rerender); return; }
      const b = e.target.closest("[data-ist]"); if (b) { dispatch(p, b.dataset.ist, rerender); return; }
      const sc = e.target.closest("[data-tplscope]"); if (sc) { tplScope = sc.dataset.tplscope; rerender(); return; }
      const ap = e.target.closest("[data-tplap]"); if (ap) { applyTemplate(p, ap.dataset.tplap, rerender); return; }
      const sv = e.target.closest("[data-tplsave]"); if (sv) { saveTemplate(p, rerender); return; }
      const hs = e.target.closest("[data-isthist]"); if (hs) { openHistory(p); return; }
      const td = e.target.closest("[data-tpldel]"); if (td) { const a = tpls(), i = a.findIndex(t => t.id === td.dataset.tpldel);
        if (i >= 0 && confirm("Bu paketi silmek istiyor musunuz?")) { a.splice(i, 1); H.toast("Paket silindi", "w"); rerender(); } return; }
      const rm = e.target.closest("[data-istrm]"); if (rm) { if (!H.protoOpen(p)) { H.toast("Protokol kapalı · değişiklik yapılamaz.", "e"); return; } const arr = all(), i = arr.findIndex(o => o.id === rm.dataset.istrm);
        if (i >= 0) { arr.splice(i, 1); H.log("İstem kaldırıldı", bedNo(p)); H.toast("İstem kaldırıldı", "w"); rerender(); } return; }
    };
  }

  H.orders = { html, after };
})();

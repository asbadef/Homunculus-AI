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
  const tipOf = (row) => (H.HIZMET_TIP ? H.HIZMET_TIP[row[3]] : "");

  // İlaç/kan ürünü örnek listesi (katalog dışı; kendi alanları var).
  const KAN = ["Eritrosit Süspansiyonu", "Taze Donmuş Plazma", "Tam Kan", "Random Trombosit Süspansiyonu", "Aferez Trombosit Süspansiyonu", "Kriyopresipitat", "Aferez Granülosit Süspansiyonu", "Havuzlanmış Trombosit"];

  const favs = () => (H.data.hizmetFav = H.data.hizmetFav || {});
  const isFav = (kod) => !!favs()[kod];
  const toggleFav = (kod) => { const f = favs(); if (f[kod]) delete f[kod]; else f[kod] = 1; };

  const all = () => (H.data.orders = H.data.orders || []);
  const ordersOf = (p) => all().filter(o => o.pid === p.id);
  function addOrder(p, o) {
    all().unshift(Object.assign({ id:"ord" + Date.now() + Math.floor(Math.random() * 1e3), pid:p.id, by:me(), at:now(), durum:"İstendi" }, o));
    H.log("İstem oluşturuldu", bedNo(p) + " · " + o.cat + " · " + (o.ad || ""));
  }

  // İstem başlatıcı grupları. Katalogdan seçilenler "kat" ile işaretli; ötekiler kendi kısa formunu açar.
  const GROUPS = [
    ["Tetkik ve görüntüleme", [
      ["lab", "Laboratuvar tetkiki", "kat", ["Laboratuvar Hizmeti", "Patoloji Hizmeti"], "Laboratuvar"],
      ["rad", "Görüntüleme (radyoloji)", "kat", ["Radyoloji Hizmeti"], "Radyoloji"],
    ]],
    ["Hizmet ve işlem", [
      ["hizmet", "Hizmet / işlem", "kat", null, "Hizmet"],
      ["kons", "Konsültasyon", "form"],
      ["diyet", "Diyet", "form"],
      ["bakim", "Bakım istemi", "form"],
    ]],
    ["İlaç ve kan", [
      ["ilac", "İlaç istemi", "form"],
      ["kan", "Kan ürünü", "form"],
    ]],
  ];

  function html(p) {
    const list = ordersOf(p);
    const grp = GROUPS.map(([g, items]) => `<div class="ist-g"><h6>${esc(g)}</h6><div class="ist-btns">${items.map(it => `<button class="ist-b" data-ist="${it[0]}">${esc(it[1])}</button>`).join("")}</div></div>`).join("");
    const rows = list.length
      ? `<div class="tw"><table class="t"><thead><tr><th style="width:116px">Saat</th><th style="width:130px">Tür</th><th>İstem</th><th>Ayrıntı</th><th style="width:96px">Durum</th><th style="width:44px"></th></tr></thead><tbody>${list.map(o => `<tr><td class="mono adm-sub">${esc(o.at)}</td><td>${esc(o.cat)}</td><td><b>${esc(o.ad || "")}</b></td><td class="adm-sub">${esc(o.detay || "")}</td><td><span class="tag">${esc(o.durum)}</span></td><td><button class="btn g sm" data-istrm="${o.id}" title="Kaldır">${ic("x") || "×"}</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Bu başvuruda henüz istem yok. Yukarıdan bir istem türü seçin.</div>`;
    return `<div class="ist" data-ist-root><div class="ist-launch">${grp}</div>
      <h5 style="margin:16px 0 6px">Bu başvurudaki istemler</h5>${rows}
      <p class="adm-sub" style="margin-top:8px">İstemler bu ekranda tutulur; gerçek HBYS / laboratuvar / radyoloji (PACS) / eczane bağlantısını ayrı ekip kurar.</p></div>`;
  }

  /* ---------- Katalog seçici (Laboratuvar / Radyoloji / Hizmet) ---------- */
  function openCatalog(p, cfg, rerender) {
    const tipsOk = cfg.tips;                       // izinli Hizmet Tipi listesi; null → tümü
    const tipIdxOk = tipsOk && (H.HIZMET_TIP || []).reduce((a, t, i) => { if (tipsOk.includes(t)) a[i] = 1; return a; }, {});
    const pool = (H.HIZMET || []).filter(r => !tipIdxOk || tipIdxOk[r[3]]);
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
      return `<div class="tw hc-tw"><table class="t"><thead><tr><th style="width:36px"></th><th>Ad</th><th style="width:150px">Katalog</th><th style="width:90px">Kod</th><th style="width:72px">SUT</th><th style="width:44px"></th></tr></thead><tbody>${shown.map(r => {
        const inCart = cart.some(c => c.row[0] === r[0]);
        return `<tr><td><button class="hc-fav ${isFav(r[0]) ? "on" : ""}" data-fav="${esc(r[0])}" title="Favori">${isFav(r[0]) ? "★" : "☆"}</button></td>
          <td><b>${esc(hzName(r))}</b></td><td class="adm-sub">${esc(tipOf(r))}</td><td class="mono adm-sub">${esc(r[0])}</td><td class="mono adm-sub">${esc(r[4] || "—")}</td>
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
          cart.forEach(c => addOrder(p, { cat:cfg.cat, ad:hzName(c.row), detay:[c.acil ? "Acil" : "", c.row[4] ? "SUT " + c.row[4] : "", c.aciklama].filter(Boolean).join(" · ") }));
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

    if (type === "ilac") return simple("İlaç istemi",
      `<div class="fr"><label>İlaç</label><input data-f="ad" placeholder="ör. Seftriakson 1 g"></div>
       <div class="fr"><label>Doz / yol</label><input data-f="doz" placeholder="ör. 2x1 IV"></div>
       <div class="fr"><label>Süre</label><input data-f="sure" placeholder="ör. 7 gün"></div>`,
      (m) => { const ad = val(m, "ad"); if (!ad) { H.toast("İlaç gerekli.", "w"); return null; } return { cat:"İlaç", ad, detay:[val(m, "doz"), val(m, "sure")].filter(Boolean).join(" · ") }; });
    if (type === "kan") return simple("Kan ürünü istemi",
      `<div class="fr"><label>Ürün</label><select data-f="ad">${KAN.map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
       <div class="fr"><label>Miktar (torba)</label><input data-f="mik" type="number" value="1" min="1"></div>
       <div class="fr"><label>İstek şekli</label><select data-f="sekil"><option>İstem</option><option>Acil</option><option>Hazırda bulunsun</option></select></div>
       <div class="fr"><label>İstek nedeni</label><input data-f="neden" placeholder="ör. anemi / kanama"></div>`,
      (m) => { const ad = val(m, "ad"), mik = val(m, "mik") || "1"; return { cat:"Kan ürünü", ad, detay:`${mik} torba · ${val(m, "sekil")}${val(m, "neden") ? " · " + val(m, "neden") : ""}` }; });
    if (type === "kons") return simple("Konsültasyon istemi",
      `<div class="fr"><label>Bölüm</label><input data-f="ad" placeholder="ör. Kardiyoloji"></div>
       <div class="fr"><label>Neden</label><input data-f="det" placeholder="Konsültasyon nedeni"></div>`,
      (m) => { const ad = val(m, "ad"); if (!ad) { H.toast("Bölüm gerekli.", "w"); return null; } return { cat:"Konsültasyon", ad, detay:val(m, "det") }; });
    if (type === "diyet") return simple("Diyet istemi",
      `<div class="fr"><label>Diyet</label><input data-f="ad" placeholder="ör. Diyabetik diyet"></div>
       <div class="fr"><label>Not</label><input data-f="det" placeholder="Açıklama"></div>`,
      (m) => { const ad = val(m, "ad"); if (!ad) { H.toast("Diyet gerekli.", "w"); return null; } return { cat:"Diyet", ad, detay:val(m, "det") }; });
    if (type === "bakim") return simple("Bakım istemi",
      `<div class="fr"><label>Bakım</label><input data-f="ad" placeholder="ör. Yara pansumanı"></div>
       <div class="fr"><label>Sıklık</label><input data-f="det" placeholder="ör. günde 1 kez"></div>`,
      (m) => { const ad = val(m, "ad"); if (!ad) { H.toast("Bakım gerekli.", "w"); return null; } return { cat:"Bakım", ad, detay:val(m, "det") }; });
    H.toast("Bu istem türü yakında eklenecek.", "w");
  }

  function dispatch(p, key, rerender) {
    for (const [, items] of GROUPS) {
      const it = items.find(x => x[0] === key);
      if (it) {
        if (it[2] === "kat") return openCatalog(p, { title:it[1], tips:it[3], cat:it[4] }, rerender);
        return openForm(p, key, rerender);
      }
    }
  }

  function after(el, p) {
    const root = (el && el.querySelector) ? (el.matches && el.matches("[data-ist-root]") ? el : el.querySelector("[data-ist-root]")) : null;
    if (!root) return;
    const rerender = () => H.go("patient", { pid:p.id, tab:"istem" });
    root.onclick = (e) => {
      const b = e.target.closest("[data-ist]"); if (b) { dispatch(p, b.dataset.ist, rerender); return; }
      const rm = e.target.closest("[data-istrm]"); if (rm) { const arr = all(), i = arr.findIndex(o => o.id === rm.dataset.istrm);
        if (i >= 0) { arr.splice(i, 1); H.log("İstem kaldırıldı", bedNo(p)); H.toast("İstem kaldırıldı", "w"); rerender(); } return; }
    };
  }

  H.orders = { html, after };
})();

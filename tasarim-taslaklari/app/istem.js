/* İstem modülü (H.orders): hekimin tetkik/radyoloji/ilaç/kan ürünü/konsültasyon istemleri.
 * Tasarım prototipi: istemler H.data.orders'ta tutulur; gerçek HBYS/LIS/PACS/eczane bağlantısını
 * ayrı ekip kurar. Sistem istem/tanı önermez; hekim seçer. Yetki: "orders" (hekim). */
(function () {
  const H = window.H; if (!H) return;
  const esc = H.esc;
  const me = () => (H.state.user && H.state.user.name) || "";
  const now = () => (H.nowFull ? H.nowFull() : "");
  const bedNo = (p) => (H.bed ? H.bed(p.bed).no : p.bed);
  const ic = (n) => (H.icon ? H.icon(n) : "");

  // Örnek listeler — gerçek lab/radyoloji/ilaç katalogları ayrı ekranlardan (Tanımlar) gelecek.
  const KAN = ["Eritrosit Süspansiyonu", "Taze Donmuş Plazma", "Tam Kan", "Random Trombosit Süspansiyonu", "Aferez Trombosit Süspansiyonu", "Kriyopresipitat", "Aferez Granülosit Süspansiyonu", "Havuzlanmış Trombosit"];
  const LAB_PRESET = ["Tam kan sayımı (Hemogram)", "Biyokimya paneli", "CRP", "Koagülasyon (PT/aPTT/INR)", "Kan gazı", "İdrar tahlili", "Kültür-antibiyogram"];
  const RAD_PRESET = ["Akciğer grafisi", "Toraks BT", "Batın USG", "Beyin BT", "Beyin MR", "Abdomen BT", "EKG"];

  const all = () => (H.data.orders = H.data.orders || []);
  const ordersOf = (p) => all().filter(o => o.pid === p.id);
  function addOrder(p, o) {
    all().unshift(Object.assign({ id:"ord" + Date.now() + Math.floor(Math.random() * 1e3), pid:p.id, by:me(), at:now(), durum:"İstendi" }, o));
    H.log("İstem oluşturuldu", bedNo(p) + " · " + o.cat + " · " + (o.ad || ""));
    H.toast("İstem eklendi: " + (o.ad || o.cat));
  }

  // Launcher grupları — referans muayene ekranındaki düzene göre.
  const GROUPS = [
    ["İstem", [["lab", "Tetkik İstem"], ["rad", "Radyoloji İstem"], ["ilac", "İlaç İstem"], ["kan", "Kan Ürünleri İstem"], ["kons", "Konsültasyon İstem"], ["diyet", "Diyet İstem"], ["hizmet", "Hizmet İstem"], ["bakim", "Bakım İstem"]]],
    ["Reçete", [["recete", "İlaç Reçetesi"], ["ereçete", "E-Reçete"], ["malzeme", "Malzeme Reçetesi"]]],
    ["Ameliyat / Yatış", [["ameliyat", "Ameliyat İstem"], ["yatis", "Yatış İstem"], ["taburcu", "Taburculuk İstem"]]],
  ];

  function html(p) {
    const list = ordersOf(p);
    const grp = GROUPS.map(([g, items]) => `<div class="ist-g"><h6>${esc(g)}</h6><div class="ist-btns">${items.map(([k, l]) => `<button class="ist-b" data-ist="${k}">${esc(l)}</button>`).join("")}</div></div>`).join("");
    const rows = list.length
      ? `<div class="tw"><table class="t"><thead><tr><th style="width:120px">Saat</th><th style="width:120px">Tür</th><th>İstem</th><th>Detay</th><th style="width:100px">Durum</th><th style="width:44px"></th></tr></thead><tbody>${list.map(o => `<tr><td class="mono adm-sub">${esc(o.at)}</td><td>${esc(o.cat)}</td><td><b>${esc(o.ad || "")}</b></td><td class="adm-sub">${esc(o.detay || "")}</td><td><span class="tag">${esc(o.durum)}</span></td><td><button class="btn g sm" data-istrm="${o.id}" title="İptal">${ic("x") || "×"}</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Bu hasta için henüz istem yok. Yukarıdan bir istem türü seçin.</div>`;
    return `<div class="ist" data-ist-root><div class="ist-launch">${grp}</div>
      <h5 style="margin:16px 0 6px">Bu gelişteki istemler</h5>${rows}
      <p class="adm-sub" style="margin-top:8px">İstemler bu ekranda tutulur; gerçek HBYS / laboratuvar / radyoloji (PACS) / eczane bağlantısını ayrı ekip kurar.</p></div>`;
  }

  function openIstem(p, type, rerender) {
    const val = (m, s) => { const el = m.querySelector(`[data-f="${s}"]`); return el ? (el.value || "").trim() : ""; };
    const simple = (title, fields, build) => H.modal({ title, body:`<div class="icd-form">${fields}</div>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Ekle</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { const o = build(m); if (!o) return; addOrder(p, o); H.closeModal(); rerender(); }; } });

    if (type === "lab") return simple("Tetkik / Laboratuvar istemi",
      `<div class="fr"><label>Tetkik</label><input data-f="ad" list="ist-lab" placeholder="ör. Hemogram"><datalist id="ist-lab">${LAB_PRESET.map(x => `<option>${esc(x)}</option>`).join("")}</datalist></div>
       <div class="fr"><label>Açıklama</label><input data-f="det" placeholder="Klinik bilgi / acil"></div>`,
      (m) => { const ad = val(m, "ad"); if (!ad) { H.toast("Tetkik gerekli.", "w"); return null; } return { cat:"Laboratuvar", ad, detay:val(m, "det") }; });
    if (type === "rad") return simple("Radyoloji istemi",
      `<div class="fr"><label>Tetkik</label><input data-f="ad" list="ist-rad" placeholder="ör. Akciğer grafisi"><datalist id="ist-rad">${RAD_PRESET.map(x => `<option>${esc(x)}</option>`).join("")}</datalist></div>
       <div class="fr"><label>Bölge / not</label><input data-f="det" placeholder="ör. sağ alt lob"></div>`,
      (m) => { const ad = val(m, "ad"); if (!ad) { H.toast("Tetkik gerekli.", "w"); return null; } return { cat:"Radyoloji", ad, detay:val(m, "det") }; });
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
    // Henüz form tasarımı yapılmayan türler
    H.toast("Bu istem türü yakında eklenecek.", "w");
  }

  function after(el, p) {
    const root = (el && el.querySelector) ? (el.matches && el.matches("[data-ist-root]") ? el : el.querySelector("[data-ist-root]")) : null;
    if (!root) return;
    const rerender = () => H.go("patient", { pid:p.id, tab:"istem" });
    root.onclick = (e) => {
      const b = e.target.closest("[data-ist]"); if (b) { openIstem(p, b.dataset.ist, rerender); return; }
      const rm = e.target.closest("[data-istrm]"); if (rm) { const arr = all(), i = arr.findIndex(o => o.id === rm.dataset.istrm);
        if (i >= 0) { arr.splice(i, 1); H.log("İstem iptal edildi", bedNo(p)); H.toast("İstem iptal edildi", "w"); rerender(); } return; }
    };
  }

  H.orders = { html, after };
})();

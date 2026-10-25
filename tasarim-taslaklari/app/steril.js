/* ============================================================================
 * STERİLİZASYON (MSÜ / CSSD) — Merkezi Sterilizasyon takip modülü
 * Cerrahi setleri kirli kabulden ameliyathaneye teslime kadar izler.
 * Tasarım/prototip: barkod okuyucu, otoklav ve HBYS donanım bağlantısı ayrı ekip;
 * burada tıkla/kod-gir ile demo veriyle uçtan uca çalışır. Varsayılan dil AZ.
 * ========================================================================== */
(function () {
  const H = window.H; if (!H) return;
  const I = (n) => H.icon(n) || "";
  const esc = (s) => H.esc(s);
  const me = () => (H.state.user || {}).name || "—";
  const now = () => (H.nowFull ? H.nowFull() : new Date().toLocaleString("az-AZ"));
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (iso, d) => { const x = new Date(iso); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

  const ASAMALAR = ["Kirli Kabul", "Yıkama", "Paketleme", "Sterilizasyon", "Steril Depo", "Teslim"];
  const ASAMA_IC = { "Kirli Kabul":"trash", "Yıkama":"refresh", "Paketleme":"box", "Sterilizasyon":"flask", "Steril Depo":"grid", "Teslim":"check" };
  const OTOKLAVLAR = ["Buxar Otoklavı-1", "Buxar Otoklavı-2", "Plazma Sterilizatoru-1"];   // demo otoklav listesi
  const RAF_OMUR = 180;   // steril depoda varsayılan raf ömrü (gün)

  /* ---------------- veri (kalıcı; PERSIST_KEYS: sterSetKart, sterSet, sterSeq) -------------- */
  function seed() {
    if (!H.data.sterSetKart) H.data.sterSetKart = [
      { id:"sk1", ad:"Ümumi Cərrahiyyə Əsas Set", bolum:"Ümumi Cərrahiyyə", versiyon:"v3", not:"47 parçalı tam set.",
        parcalar:["Bistuvar sapı", "Portequ (iynə tutan)", "Anatomik pensa ×6", "Cərrahi pensa ×6", "Küt uclu qayçı", "İti uclu qayçı", "Ekartor ×2", "Klemp (düz) ×8", "Klemp (əyri) ×6", "Aspirator ucluğu", "Yara ayırıcı", "Böyrək qab"] },
      { id:"sk2", ad:"Laparoskopiya Seti", bolum:"Ümumi Cərrahiyyə", versiyon:"v2", not:"Minimal invaziv.",
        parcalar:["Troakar 10mm ×2", "Troakar 5mm ×3", "Qayçı (laparoskopik)", "Qrasper ×2", "Veres iynəsi", "Optik 30°", "İşıq kabeli", "İnsuflyasiya borusu"] },
      { id:"sk3", ad:"Sezaryen Seti", bolum:"Doğuş", versiyon:"v1", not:"",
        parcalar:["Skalpel", "Portequ", "Pensa ×8", "Klemp ×6", "Ekartor", "İynə tutan", "Qayçı", "Böyrək qab", "Sarğı qabı"] },
    ];
    if (!H.data.sterSeq) H.data.sterSeq = 1048;
    if (!H.data.sterSet) {
      const mk = (kartId, asama, extra) => { const k = kartOf(kartId); return Object.assign({ id:"ss" + (++H.data.sterSeq), no:"SET-" + H.data.sterSeq, kartId, ad:k.ad, bolum:k.bolum, asama, eksik:[], otoklav:null, raf:"", sonKullanim:"", vaka:"", teslimAlan:"",
        gecmis:[{ asama, kim:"Sistem (demo)", zaman:now() }] }, extra || {}); };
      H.data.sterSet = [
        mk("sk1", "Kirli Kabul"),
        mk("sk3", "Yıkama"),
        mk("sk2", "Paketleme"),
        mk("sk1", "Sterilizasyon", { otoklav:{ otoklav:"Buxar Otoklavı-1", no:"D-2041", sic:"134", sure:"7", bowie:"Keçdi", biyo:"Keçdi" } }),
        mk("sk3", "Steril Depo", { raf:"A-03", sonKullanim:addDays(today(), 120) }),
        mk("sk2", "Steril Depo", { raf:"B-11", sonKullanim:addDays(today(), 18) }),   // süresi yaklaşan (uyarı)
      ];
    }
  }
  const kartOf = (id) => (H.data.sterSetKart || []).find(k => k.id === id) || { ad:"—", bolum:"—", parcalar:[], versiyon:"" };
  const sets = () => H.data.sterSet || [];
  const nextNo = () => "SET-" + (++H.data.sterSeq);
  const amelVakalar = () => [...new Set((H.data.orders || []).filter(o => o.cat === "Ameliyat").map(o => (o.ad || "").split(" · ")[0]).filter(Boolean))];
  const yakinSonKul = (s) => s.sonKullanim && (new Date(s.sonKullanim) - new Date()) / 86400000 <= 30;
  const asamaIdx = (a) => ASAMALAR.indexOf(a);

  function push(s, asama) { s.asama = asama; s.gecmis = s.gecmis || []; s.gecmis.push({ asama, kim:me(), zaman:now() }); H.saveData && H.saveData(); H.log("Sterilizasyon aşaması", s.no + " · " + asama); }

  /* ---------------- aşama ilerletme ---------------- */
  function ilerlet(s, afterGo) {
    const i = asamaIdx(s.asama);
    // Paketleme: parça checklist → eksikse ilerlemez
    if (s.asama === "Paketleme") return paketleModal(s, afterGo);
    // Sterilizasyon: otoklav döngüsü + test
    if (s.asama === "Sterilizasyon") return otoklavModal(s, afterGo);
    // Steril Depo: ameliyathaneye teslim
    if (s.asama === "Steril Depo") return teslimModal(s, afterGo);
    // Teslim: yeniden kullanım için kirli kabule döner
    if (s.asama === "Teslim") { s.otoklav = null; s.raf = ""; s.sonKullanim = ""; s.vaka = ""; s.teslimAlan = ""; s.eksik = []; push(s, "Kirli Kabul"); H.toast("Set yeniden kullanıma alındı · Kirli Kabul", "w"); afterGo && afterGo(); return; }
    // Kirli Kabul→Yıkama, Yıkama→Paketleme: düz ilerleme
    push(s, ASAMALAR[i + 1]); H.toast(s.no + " → " + ASAMALAR[i + 1]); afterGo && afterGo();
  }

  function paketleModal(s, afterGo) {
    const parts = kartOf(s.kartId).parcalar || [];
    H.modal({ title:"Paketleme · " + esc(s.no), wide:true,
      body:`<p class="adm-sub" style="margin:0 0 8px">${esc(s.ad)} · ${esc(kartOf(s.kartId).versiyon || "")} · beklenen ${parts.length} parça. Olan parçaları işaretleyin; eksik varsa set ilerlemez.</p>
        <div class="icd-oz" style="max-height:46vh;overflow:auto">${parts.map((p, i) => `<label><input type="checkbox" data-pk="${i}" checked> ${esc(p)}</label>`).join("")}</div>
        <div class="r" style="gap:8px;margin-top:8px"><button class="btn sm" data-pkall>Hamısını seç</button><button class="btn sm" data-pknone>Hamısını sil</button></div>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Paketlemeyi tamamla</button>`,
      onMount(m) {
        m.querySelector("[data-pkall]").onclick = () => m.querySelectorAll("[data-pk]").forEach(c => c.checked = true);
        m.querySelector("[data-pknone]").onclick = () => m.querySelectorAll("[data-pk]").forEach(c => c.checked = false);
        m.querySelector("[data-ok]").onclick = () => {
          const eksik = [...m.querySelectorAll("[data-pk]")].filter(c => !c.checked).map(c => parts[+c.dataset.pk]);
          if (eksik.length) { s.eksik = eksik; s.durum = "Eksik"; H.saveData && H.saveData(); H.log("Set eksik parça", s.no + " · " + eksik.length); H.toast(eksik.length + " parça əksik · set ilerletilemez", "e"); H.closeModal(); afterGo && afterGo(); return; }
          s.eksik = []; s.durum = ""; push(s, "Sterilizasyon"); H.closeModal(); H.toast("Paketləmə tamam · Sterilizasyona keçdi"); afterGo && afterGo();
        };
      } });
  }

  function otoklavModal(s, afterGo) {
    H.modal({ title:"Sterilizasyon döngüsü · " + esc(s.no),
      body:`<div class="icd-form">
        <div class="fr"><label>Otoklav / cihaz</label><select data-f="otoklav">${OTOKLAVLAR.map(o => `<option>${esc(o)}</option>`).join("")}</select></div>
        <div class="fr"><label>Döngü no</label><input data-f="no" placeholder="ör. D-2042"></div>
        <div class="fr"><label>Sıcaklık (°C)</label><input data-f="sic" value="134"></div>
        <div class="fr"><label>Süre (dk)</label><input data-f="sure" value="7"></div>
        <div class="fr"><label>Bowie-Dick testi</label><select data-f="bowie"><option>Keçdi</option><option>Keçmədi</option></select></div>
        <div class="fr"><label>Biyolojik indikatör</label><select data-f="biyo"><option>Keçdi</option><option>Keçmədi</option><option>Gözlənilir</option></select></div></div>
        <p class="adm-sub" style="margin-top:8px">Test "Keçmədi" ise set steril depoya alınmaz, uyarı verilir.</p>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Döngüyü kaydet</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = k => (m.querySelector(`[data-f="${k}"]`).value || "").trim();
        const o = { otoklav:m.querySelector('[data-f="otoklav"]').value, no:g("no"), sic:g("sic"), sure:g("sure"), bowie:m.querySelector('[data-f="bowie"]').value, biyo:m.querySelector('[data-f="biyo"]').value, tarih:now() };
        s.otoklav = o;
        if (o.bowie === "Keçmədi" || o.biyo === "Keçmədi") { s.durum = "Test başarısız"; H.saveData && H.saveData(); H.log("Sterilizasyon testi başarısız", s.no); H.toast("Test keçmədi · set serbest bırakılamaz", "e"); H.closeModal(); afterGo && afterGo(); return; }
        s.durum = ""; s.raf = ""; s.sonKullanim = addDays(today(), RAF_OMUR); push(s, "Steril Depo"); H.closeModal(); H.toast("Döngü tamam · Steril Depoya alındı · son kullanım " + s.sonKullanim); afterGo && afterGo(); }; } });
  }

  function teslimModal(s, afterGo) {
    const vak = amelVakalar();
    H.modal({ title:"Ameliyathaneye teslim · " + esc(s.no),
      body:`<div class="icd-form">
        <div class="fr"><label>Raf / konum</label><input data-f="raf" value="${esc(s.raf || "")}" placeholder="ör. A-03"></div>
        <div class="fr"><label>Son kullanım</label><input type="date" data-f="sk" value="${esc(s.sonKullanim || "")}"></div>
        <div class="fr"><label>Vaka / ameliyat</label><input data-f="vaka" list="ster-vaka" placeholder="Ameliyat seç ya da yaz"><datalist id="ster-vaka">${vak.map(v => `<option>${esc(v)}</option>`).join("")}</datalist></div>
        <div class="fr"><label>Teslim alan</label><input data-f="alan" placeholder="Ameliyathane personeli"></div></div>
        <p class="adm-sub" style="margin-top:8px">Teslim onayı (donanımda QR imza) burada ekranda onaylanır; kim-ne zaman kaydedilir.</p>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Teslimi onayla</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = k => (m.querySelector(`[data-f="${k}"]`).value || "").trim();
        if (!g("vaka")) { H.toast("Vaka / ameliyat gerekli.", "w"); return; }
        s.raf = g("raf"); s.sonKullanim = g("sk") || s.sonKullanim; s.vaka = g("vaka"); s.teslimAlan = g("alan"); push(s, "Teslim");
        H.closeModal(); H.toast("Set təhvil verildi · " + g("vaka")); afterGo && afterGo(); }; } });
  }

  /* ---------------- set detay ---------------- */
  function setDetay(s, afterGo) {
    const k = kartOf(s.kartId), i = asamaIdx(s.asama), son = i < 5;
    const kv = (a, b) => `<div class="kv"><span>${esc(a)}</span><span>${b === 0 || b ? esc(String(b)) : "—"}</span></div>`;
    const hist = (s.gecmis || []).map(h => `<tr><td>${esc(h.asama)}</td><td class="adm-sub">${esc(h.kim)}</td><td class="mono adm-sub">${esc(h.zaman)}</td></tr>`).join("");
    const uyari = s.eksik && s.eksik.length ? `<div class="note" style="background:color-mix(in srgb,var(--crit) 12%,transparent);border:1px solid var(--crit);color:var(--crit);margin:0 0 10px">${I("alert")} Eksik parça (${s.eksik.length}): ${esc(s.eksik.join(", "))}</div>`
      : s.durum === "Test başarısız" ? `<div class="note" style="background:color-mix(in srgb,var(--crit) 12%,transparent);border:1px solid var(--crit);color:var(--crit);margin:0 0 10px">${I("alert")} Sterilizasyon testi keçmədi · set serbest bırakılamaz.</div>` : "";
    const otk = s.otoklav ? `<div class="box" style="margin-top:8px"><h5>Son otoklav döngüsü</h5><div class="vz-hk">${kv("Otoklav", s.otoklav.otoklav)}${kv("Döngü no", s.otoklav.no)}${kv("Sıcaklık", s.otoklav.sic + " °C")}${kv("Süre", s.otoklav.sure + " dk")}${kv("Bowie-Dick", s.otoklav.bowie)}${kv("Biyolojik", s.otoklav.biyo)}</div></div>` : "";
    H.modal({ title:"Set · " + esc(s.no), wide:true,
      body:`${uyari}<div class="g2" style="align-items:start"><div class="box"><h5>${esc(s.ad)}</h5><div class="vz-hk">${kv("Set no", s.no)}${kv("Şablon", k.ad + " · " + (k.versiyon || ""))}${kv("Bölüm", s.bolum)}${kv("Aşama", s.asama)}${kv("Parça sayısı", (k.parcalar || []).length)}${kv("Raf / konum", s.raf)}${kv("Son kullanım", s.sonKullanim)}${kv("Vaka / ameliyat", s.vaka)}${kv("Teslim alan", s.teslimAlan)}</div>${otk}</div>
        <div class="box"><h5>Aşama geçmişi (kim · ne zaman)</h5><div class="tw"><table class="t"><thead><tr><th>Aşama</th><th>Kullanıcı</th><th>Zaman</th></tr></thead><tbody>${hist || `<tr><td colspan="3" class="mute">—</td></tr>`}</tbody></table></div></div></div>`,
      actions:`<button class="btn" data-x>Kapat</button><button class="btn p" data-ilerlet>${son ? "Sonraki aşamaya al → " + ASAMALAR[i + 1] : "Yeniden kullanıma al (Kirli Kabul)"}</button>`,
      onMount(m) { m.querySelector("[data-ilerlet]").onclick = () => { if (son) H.closeModal(); ilerlet(s, afterGo); }; } });
  }

  /* ---------------- yeni set (kirli kabul) ---------------- */
  function yeniSet(afterGo) {
    const kartlar = H.data.sterSetKart || [], vak = amelVakalar();
    H.modal({ title:"Yeni set · kirli kabul", body:`<div class="icd-form">
      <div class="fr"><label>Set şablonu</label><select data-f="kart">${kartlar.map(k => `<option value="${k.id}">${esc(k.ad)} · ${esc(k.bolum)}</option>`).join("")}</select></div>
      <div class="fr"><label>Nereden döndü (vaka, ops.)</label><input data-f="vaka" list="ster-vaka2" placeholder="Ameliyat / kaynak"><datalist id="ster-vaka2">${vak.map(v => `<option>${esc(v)}</option>`).join("")}</datalist></div></div>
      <p class="adm-sub" style="margin-top:8px">Donanımda setin barkodu okutulur; burada şablon seçilir. Set "Kirli Kabul"da açılır.</p>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Kirli kabule al</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { const kartId = m.querySelector('[data-f="kart"]').value, k = kartOf(kartId);
        const s = { id:"ss" + Date.now(), no:nextNo(), kartId, ad:k.ad, bolum:k.bolum, asama:"Kirli Kabul", eksik:[], otoklav:null, raf:"", sonKullanim:"", vaka:(m.querySelector('[data-f="vaka"]').value || "").trim(), teslimAlan:"", durum:"", gecmis:[{ asama:"Kirli Kabul", kim:me(), zaman:now() }] };
        sets().unshift(s); H.saveData && H.saveData(); H.log("Yeni set kirli kabul", s.no + " · " + k.ad); H.toast("Set kirli kabule alındı: " + s.no); H.closeModal(); afterGo && afterGo(); }; } });
  }

  /* ---------------- set şablonu (tanım) formu ---------------- */
  function kartForm(existing, afterGo) {
    const k = existing || { parcalar:[] };
    H.modal({ title:existing ? "Set şablonu düzenle" : "Yeni set şablonu", wide:true, body:`<div class="icd-form">
      <div class="fr"><label>Set adı</label><input data-f="ad" value="${esc(k.ad || "")}" placeholder="ör. Ümumi Cərrahiyyə Əsas Set"></div>
      <div class="fr"><label>Bölüm</label><input data-f="bolum" value="${esc(k.bolum || "")}" placeholder="ör. Ümumi Cərrahiyyə"></div>
      <div class="fr"><label>Versiyon</label><input data-f="versiyon" value="${esc(k.versiyon || "v1")}"></div>
      <div class="fr"><label>Not</label><input data-f="not" value="${esc(k.not || "")}"></div>
      <div class="fr" style="grid-column:1/-1"><label>Parça listesi (her satıra bir parça)</label><textarea data-f="parts" rows="8" placeholder="Bistuvar sapı&#10;Portequ&#10;Pensa ×6">${esc((k.parcalar || []).join("\n"))}</textarea></div></div>`,
      actions:`${existing ? `<button class="btn g" data-del>${I("trash")}Sil</button>` : ""}<span class="spacer"></span><button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Kaydet</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = s => (m.querySelector(`[data-f="${s}"]`).value || "").trim();
        if (!g("ad")) { H.toast("Set adı gerekli.", "w"); return; }
        const parts = (m.querySelector('[data-f="parts"]').value || "").split("\n").map(x => x.trim()).filter(Boolean);
        if (existing) { Object.assign(existing, { ad:g("ad"), bolum:g("bolum"), versiyon:g("versiyon"), not:g("not"), parcalar:parts }); }
        else { (H.data.sterSetKart = H.data.sterSetKart || []).push({ id:"sk" + Date.now(), ad:g("ad"), bolum:g("bolum"), versiyon:g("versiyon") || "v1", not:g("not"), parcalar:parts }); }
        H.saveData && H.saveData(); H.log("Set şablonu " + (existing ? "güncellendi" : "eklendi"), g("ad")); H.toast("Set şablonu kaydedildi"); H.closeModal(); afterGo && afterGo(); };
        const d = m.querySelector("[data-del]"); if (d) d.onclick = () => { if (!confirm("Bu set şablonu silinsin mi?")) return; H.data.sterSetKart = (H.data.sterSetKart || []).filter(x => x.id !== existing.id); H.saveData && H.saveData(); H.closeModal(); H.toast("Şablon silindi", "w"); afterGo && afterGo(); }; } });
  }

  /* ---------------- ekran ---------------- */
  H.register("sterilizasyon", { title:() => H.t("m_steril"), perm:"steril", render(root, params = {}) {
    seed();
    const tab = params.tab || "pano";
    const TABS = [["pano", "Akış panosu"], ["depo", "Steril depo"], ["tanim", "Set tanımları"], ["komuta", "Komuta merkezi"]];
    const go = () => H.go("sterilizasyon", { tab });
    const rerender = () => H.go("sterilizasyon", params);

    const SEVC = { "Kirli Kabul":"var(--crit)", "Yıkama":"var(--mid)", "Paketleme":"var(--low)", "Sterilizasyon":"var(--high)", "Steril Depo":"var(--ok)", "Teslim":"var(--line)" };
    const kart = (s) => { const warn = (s.eksik && s.eksik.length) || s.durum === "Test başarısız" || (s.asama === "Steril Depo" && yakinSonKul(s));
      return `<div class="ster-card" data-set="${s.id}" style="cursor:pointer;border:1px solid ${warn ? "var(--crit)" : "var(--line2)"};border-radius:10px;padding:8px 10px;margin-bottom:8px;background:var(--card)">
        <div style="display:flex;justify-content:space-between;gap:6px"><b style="font-size:13px">${esc(s.ad)}</b><span class="mono adm-sub" style="font-size:11px">${esc(s.no)}</span></div>
        <div class="adm-sub" style="font-size:11.5px">${esc(s.bolum)}</div>
        ${s.eksik && s.eksik.length ? `<span class="tag c" style="margin-top:4px">Eksik ${s.eksik.length}</span>` : ""}${s.durum === "Test başarısız" ? `<span class="tag c" style="margin-top:4px">Test ✗</span>` : ""}
        ${s.asama === "Steril Depo" ? `<div class="adm-sub" style="font-size:11px;margin-top:3px">Raf ${esc(s.raf || "—")} · s.kul. ${esc(s.sonKullanim || "—")}${yakinSonKul(s) ? ' <span class="tag w">yaklaşıyor</span>' : ""}</div>` : ""}
        ${s.asama === "Teslim" && s.vaka ? `<div class="adm-sub" style="font-size:11px;margin-top:3px">→ ${esc(s.vaka)}</div>` : ""}</div>`; };

    const panoHtml = () => `<div class="tw" style="overflow:auto"><div style="display:flex;gap:10px;min-width:900px;align-items:start">
      ${ASAMALAR.map(a => { const list = sets().filter(s => s.asama === a);
        return `<div style="flex:1;min-width:150px"><div style="display:flex;align-items:center;gap:6px;font:700 12.5px Figtree;padding:6px 8px;border-radius:8px;background:color-mix(in srgb,${SEVC[a]} 16%,transparent);border-left:3px solid ${SEVC[a]};margin-bottom:8px">${I(ASAMA_IC[a]) || ""} ${esc(a)} <span class="adm-sub" style="margin-left:auto">${list.length}</span></div>
          ${list.map(kart).join("") || `<div class="adm-sub" style="font-size:11.5px;padding:6px 2px">—</div>`}</div>`; }).join("")}
      </div></div><p class="adm-sub" style="margin-top:8px">Bir karta tıkla → detay + "Sonraki aşamaya al". Paketlemede eksik parça olursa set ilerlemez; sterilizasyonda test "keçmədi" ise serbest bırakılmaz.</p>`;

    const depoHtml = () => { const d = sets().filter(s => s.asama === "Steril Depo").sort((a, z) => String(a.sonKullanim).localeCompare(String(z.sonKullanim)));
      return `<div class="tw"><table class="t"><thead><tr><th>Set</th><th>Bölüm</th><th>Raf</th><th>Son kullanım</th><th>Durum</th><th style="width:120px"></th></tr></thead><tbody>
        ${d.length ? d.map(s => `<tr class="row" data-set="${s.id}" style="cursor:pointer"><td><b>${esc(s.ad)}</b><div class="mono adm-sub" style="font-size:11px">${esc(s.no)}</div></td><td class="adm-sub">${esc(s.bolum)}</td><td>${esc(s.raf || "—")}</td><td class="mono ${yakinSonKul(s) ? "" : "adm-sub"}">${esc(s.sonKullanim || "—")}</td><td>${yakinSonKul(s) ? '<span class="tag w">süre yaklaşıyor</span>' : '<span class="tag ok">steril</span>'}</td><td><button class="btn p sm" data-teslim="${s.id}">Teslim et</button></td></tr>`).join("") : `<tr><td colspan="6" class="mute" style="padding:18px;text-align:center">Steril depoda set yok.</td></tr>`}
        </tbody></table></div><p class="adm-sub" style="margin-top:8px">FIFO: son kullanımı yakın olan üstte. 30 günden az kalanlar uyarılı.</p>`; };

    const tanimHtml = () => `<div class="tw"><table class="t"><thead><tr><th>Set şablonu</th><th>Bölüm</th><th>Versiyon</th><th style="width:90px">Parça</th><th>Not</th></tr></thead><tbody>
      ${(H.data.sterSetKart || []).map(k => `<tr class="row" data-kart="${k.id}" style="cursor:pointer"><td><b>${esc(k.ad)}</b></td><td class="adm-sub">${esc(k.bolum || "—")}</td><td>${esc(k.versiyon || "")}</td><td class="n">${(k.parcalar || []).length}</td><td class="adm-sub">${esc(k.not || "")}</td></tr>`).join("") || `<tr><td colspan="5" class="mute" style="padding:18px;text-align:center">Set şablonu yok.</td></tr>`}
      </tbody></table></div><p class="adm-sub" style="margin-top:8px">Set şablonu = paketlemede beklenen parça listesi. Satıra tıkla düzenle.</p>`;

    const komutaHtml = () => { const all = sets();
      const say = (a) => all.filter(s => s.asama === a).length;
      const dongBugun = all.filter(s => s.otoklav && String(s.otoklav.tarih || "").includes(new Date().toLocaleDateString("az-AZ"))).length;
      const eksikler = all.filter(s => s.eksik && s.eksik.length), testFail = all.filter(s => s.durum === "Test başarısız"), yakin = all.filter(s => s.asama === "Steril Depo" && yakinSonKul(s)), teslimBek = all.filter(s => s.asama === "Steril Depo");
      const stat = (b, l, c) => `<div class="ac${c ? " " + c : ""}"><div class="i">${I("box")}</div><b>${b}</b><span>${esc(l)}</span></div>`;
      const uyarilar = [...testFail.map(s => ["crit", s.no + " · sterilizasyon testi keçmədi"]), ...eksikler.map(s => ["crit", s.no + " · " + s.eksik.length + " eksik parça"]), ...yakin.map(s => ["w", s.no + " · son kullanım yaklaşıyor (" + s.sonKullanim + ")"])];
      return `<div class="att">${stat(all.length, "toplam set", "")}${stat(say("Sterilizasyon"), "sterilizasyonda", "")}${stat(teslimBek.length, "teslime hazır (depoda)", "")}${stat(eksikler.length + testFail.length, "sorunlu set", eksikler.length + testFail.length ? "crit" : "ok")}</div>
        <div class="g2" style="margin-top:14px;align-items:start"><div class="box"><h5>Aşamalardaki set sayısı</h5>${ASAMALAR.map(a => `<div style="display:flex;justify-content:space-between;font-size:13px;margin:6px 0"><span>${esc(a)}</span><b class="mono">${say(a)}</b></div>`).join("")}<div class="adm-sub" style="margin-top:6px">Bugünkü otoklav döngüsü: <b>${dongBugun}</b></div></div>
          <div class="box"><h5>Uyarılar (${uyarilar.length})</h5>${uyarilar.length ? uyarilar.map(([c, t]) => `<div class="note" style="margin:6px 0;padding:7px 9px;border-radius:8px;background:color-mix(in srgb,var(--${c === "crit" ? "crit" : "mid"}) 10%,transparent);font-size:12.5px">${I(c === "crit" ? "alert" : "clock")} ${esc(t)}</div>`).join("") : `<p class="adm-sub">Açık uyarı yok.</p>`}</div></div>
        <p class="adm-sub" style="margin-top:10px">Komuta merkezi: tüm MSÜ akışının özeti. Donanım bağlandığında otoklav doluluğu ve canlı döngüler buraya gerçek veriyle akar.</p>`; };

    const body = { pano:panoHtml, depo:depoHtml, tanim:tanimHtml, komuta:komutaHtml }[tab]();
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_steril")}</h2><p>Merkezi Sterilizasyon (MSÜ) · set izleme · ${sets().length} aktif set</p></div><div class="r">${H.filterBox ? H.filterBox("Set / bölüm ara…") : ""}${tab === "tanim" ? `<button class="btn p" data-kartnew>${I("plus")} Yeni şablon</button>` : `<button class="btn p" data-yeniset>${I("plus")} Yeni set (kirli kabul)</button>`}</div></div>
      <div class="seg" style="margin-bottom:12px">${TABS.map(([k, l]) => `<button data-stab="${k}" class="${tab === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
      ${body}`;

    root.onclick = (e) => {
      const st = e.target.closest("[data-stab]"); if (st) return H.go("sterilizasyon", { tab:st.dataset.stab });
      if (e.target.closest("[data-yeniset]")) return yeniSet(rerender);
      if (e.target.closest("[data-kartnew]")) return kartForm(null, rerender);
      const tz = e.target.closest("[data-teslim]"); if (tz) { const s = sets().find(x => x.id === tz.dataset.teslim); if (s) teslimModal(s, rerender); return; }
      const kt = e.target.closest("[data-kart]"); if (kt) { const k = (H.data.sterSetKart || []).find(x => x.id === kt.dataset.kart); if (k) kartForm(k, rerender); return; }
      const se = e.target.closest("[data-set]"); if (se) { const s = sets().find(x => x.id === se.dataset.set); if (s) setDetay(s, rerender); return; }
    };
    H.wireFilter && H.wireFilter(root);
  } });
})();

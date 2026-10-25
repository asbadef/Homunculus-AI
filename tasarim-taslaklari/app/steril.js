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
  const STER_SEKIL = ["Buxar (nəm)", "Etilen oksid (EO)", "Plazma (H₂O₂)", "Quru istilik"];   // sterilizasyon şekli
  const IADE_TUR = ["Kirli (yenidən istifadə)", "Kullanılmamış (açılmamış iadə)", "Fire (zədəli / istifadə olunmaz)"];   // malzeme kabul türleri (referans)
  const RAF_OMUR = 180;   // steril depoda varsayılan raf ömrü (gün)

  /* ---------------- veri (kalıcı; PERSIST_KEYS: sterSetKart, sterSet, sterSeq) -------------- */
  function seed() {
    if (!H.data.sterSetKart) H.data.sterSetKart = [
      { id:"sk1", ad:"Ümumi Cərrahiyyə Əsas Set", bolum:"Ümumi Cərrahiyyə", versiyon:"v3", maxDongu:300, not:"47 parçalı tam set.",
        parcalar:["Bistuvar sapı", "Portequ (iynə tutan)", "Anatomik pensa ×6", "Cərrahi pensa ×6", "Küt uclu qayçı", "İti uclu qayçı", "Ekartor ×2", "Klemp (düz) ×8", "Klemp (əyri) ×6", "Aspirator ucluğu", "Yara ayırıcı", "Böyrək qab"] },
      { id:"sk2", ad:"Laparoskopiya Seti", bolum:"Ümumi Cərrahiyyə", versiyon:"v2", maxDongu:250, not:"Minimal invaziv.",
        parcalar:["Troakar 10mm ×2", "Troakar 5mm ×3", "Qayçı (laparoskopik)", "Qrasper ×2", "Veres iynəsi", "Optik 30°", "İşıq kabeli", "İnsuflyasiya borusu"] },
      { id:"sk3", ad:"Sezaryen Seti", bolum:"Doğuş", versiyon:"v1", maxDongu:400, not:"",
        parcalar:["Skalpel", "Portequ", "Pensa ×8", "Klemp ×6", "Ekartor", "İynə tutan", "Qayçı", "Böyrək qab", "Sarğı qabı"] },
    ];
    if (!H.data.sterSeq) H.data.sterSeq = 1048;
    if (!H.data.sterSet) {
      const mk = (kartId, asama, extra) => { const k = kartOf(kartId); return Object.assign({ id:"ss" + (++H.data.sterSeq), no:"SET-" + H.data.sterSeq, kartId, ad:k.ad, bolum:k.bolum, asama, eksik:[], otoklav:null, raf:"", sonKullanim:"", vaka:"", teslimAlan:"", dongu:0, kayip:false,
        gecmis:[{ asama, kim:"Sistem (demo)", zaman:now() }] }, extra || {}); };
      H.data.sterSet = [
        mk("sk1", "Kirli Kabul", { dongu:142 }),
        mk("sk3", "Yıkama", { dongu:88 }),
        mk("sk2", "Paketleme", { dongu:230 }),
        mk("sk1", "Sterilizasyon", { dongu:297, otoklav:{ otoklav:"Buxar Otoklavı-1", no:"D-2041", sic:"134", sure:"7", bowie:"Keçdi", biyo:"Keçdi" } }),   // ömre yakın (max 300)
        mk("sk3", "Steril Depo", { dongu:51, raf:"A-03", sonKullanim:addDays(today(), 120) }),
        mk("sk2", "Steril Depo", { dongu:244, raf:"B-11", sonKullanim:addDays(today(), 18) }),   // süresi yaklaşan (uyarı)
      ];
    }
    if (!H.data.sterLoadSeq) H.data.sterLoadSeq = 7014;
    if (!H.data.sterCartSeq) H.data.sterCartSeq = 3010;
    if (!H.data.sterTalepSeq) H.data.sterTalepSeq = 4020;
    if (!H.data.sterTalep) H.data.sterTalep = [   // ReUse (yeniden kullanılabilir) malzeme talepleri — bölüm → MSÜ
      { id:"tl1", no:"TLP-" + (++H.data.sterTalepSeq), bolum:"Ümumi Cərrahiyyə", kat:"2", depo:"Əməliyyat anbarı", tarih:now(), malzeme:"Laparoskopiya Seti", miktar:2, onaylanan:0, karsilanan:0, aciklama:"Səhər proqramı üçün", durum:"Bekliyor" },
      { id:"tl2", no:"TLP-" + (++H.data.sterTalepSeq), bolum:"Doğuş", kat:"3", depo:"Doğuş anbarı", tarih:now(), malzeme:"Sezaryen Seti", miktar:1, onaylanan:1, karsilanan:0, aciklama:"", durum:"Onaylandı" },
    ];
    if (!H.data.sterAletSeq) H.data.sterAletSeq = 5080;
    if (!H.data.sterAlet) {   // tekil izlenen (pahalı/kritik) aletler
      const first = (H.data.sterSet || [])[0], lap = (H.data.sterSet || []).find(s => s.kartId === "sk2");
      H.data.sterAlet = [
        { id:"al1", seri:"OPT-30-0012", ad:"Laparoskopi Optik 30°", bolum:"Ümumi Cərrahiyyə", kartId:"sk2", setId:lap ? lap.id : "", dongu:118, durum:"Aktif" },
        { id:"al2", seri:"MTR-0045", ad:"Cərrahi Motor (drill)", bolum:"Travmatologiya", kartId:"", setId:"", dongu:264, durum:"Tamirde" },
        { id:"al3", seri:"KAM-0203", ad:"Endoskopi Kamera Başlığı", bolum:"Ümumi Cərrahiyyə", kartId:"sk2", setId:"", dongu:77, durum:"Aktif" },
      ];
    }
    if (!H.data.sterLoad) {   // demo yük: iki steril depo seti tek döngüden geldi, biyolojik indikatör "Gözlənilir" (recall denemesi için)
      const depo = (H.data.sterSet || []).filter(s => s.asama === "Steril Depo");
      const ld = { id:"ld_demo", no:"YÜK-" + (++H.data.sterLoadSeq), otoklav:"Buxar Otoklavı-2", no2:"D-2039", sic:"134", sure:"7", bowie:"Keçdi", biyo:"Gözlənilir", tarih:now(), setIds:depo.map(s => s.id), durum:"BI bekliyor" };
      depo.forEach(s => { s.loadId = ld.id; s.otoklav = { otoklav:ld.otoklav, no:ld.no2, sic:ld.sic, sure:ld.sure, bowie:ld.bowie, biyo:ld.biyo, tarih:ld.tarih, yuk:ld.no }; });
      H.data.sterLoad = [ld];
    }
  }
  const loads = () => H.data.sterLoad || [];
  const loadOf = (id) => loads().find(l => l.id === id);
  const carts = () => H.data.sterCart || [];
  const cartOf = (id) => carts().find(c => c.id === id);
  // Ameliyat programı: HBYS'deki ameliyat istemlerinden türetilir (vaka → hasta).
  const amelProgram = () => (H.data.orders || []).filter(o => o.cat === "Ameliyat").map(o => ({ pid:o.pid, ad:(o.ad || "").split(" · ")[0], at:o.at || "", hasta:(H.pt && H.pt(o.pid)) ? H.pt(o.pid).name : "" }));
  const depoUygun = () => sets().filter(s => s.asama === "Steril Depo" && !s.cartId && !s.kayip && !s.bakim);
  const cartNoOf = (s) => { const c = s.cartId && cartOf(s.cartId); return c ? c.no : ""; };
  const kartOf = (id) => (H.data.sterSetKart || []).find(k => k.id === id) || { ad:"—", bolum:"—", parcalar:[], versiyon:"" };
  const sets = () => H.data.sterSet || [];
  // Hasta dosyası ters görünümü: bu hastaya teslim edilmiş/kullanılmış steril setler.
  H.sterSetsOfPatient = (pid) => (H.data.sterSet || []).filter(s => s.pid === pid);
  const nextNo = () => "SET-" + (++H.data.sterSeq);
  const amelVakalar = () => [...new Set((H.data.orders || []).filter(o => o.cat === "Ameliyat").map(o => (o.ad || "").split(" · ")[0]).filter(Boolean))];
  const yakinSonKul = (s) => s.sonKullanim && (new Date(s.sonKullanim) - new Date()) / 86400000 <= 30;
  const maxDongu = (s) => kartOf(s.kartId).maxDongu || 0;
  const omurUyari = (s) => { const mx = maxDongu(s); return mx && (s.dongu || 0) >= mx - 10; };   // ömrün son 10 döngüsü ya da dolmuş
  const omurDoldu = (s) => { const mx = maxDongu(s); return mx && (s.dongu || 0) >= mx; };
  const asamaIdx = (a) => ASAMALAR.indexOf(a);

  function push(s, asama) { s.asama = asama; s.gecmis = s.gecmis || []; s.gecmis.push({ asama, kim:me(), zaman:now() }); H.saveData && H.saveData(); H.log("Sterilizasyon aşaması", s.no + " · " + asama); }

  /* ---------------- aşama ilerletme ---------------- */
  function ilerlet(s, afterGo) {
    const i = asamaIdx(s.asama);
    // Paketleme: parça checklist → eksikse ilerlemez
    if (s.asama === "Paketleme") return paketleModal(s, afterGo);
    // Sterilizasyon: yük (çok set tek döngü) oluştur
    if (s.asama === "Sterilizasyon") return loadBuilder(s.id, afterGo);
    // Steril Depo: ameliyathaneye teslim
    if (s.asama === "Steril Depo") return teslimModal(s, afterGo);
    // Teslim: set MSÜ'ye geri döner → iade/kabul türü (Kirli / Kullanılmamış / Fire) seçilir
    if (s.asama === "Teslim") return iadeModal(s, afterGo);
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

  // Yük (load) kurucusu: Sterilizasyon aşamasındaki setlerden birkaçı tek otoklav döngüsüne (yüke) alınır.
  // Test geçerse hepsi birlikte Steril Depoya; "Keçmədi" ise sterilizasyonda tutulur; "Gözlənilir" ise depoya alınır ama yük "BI bekliyor" (recall mümkün).
  function loadBuilder(preId, afterGo) {
    const bekle = sets().filter(s => s.asama === "Sterilizasyon" && !s.kayip && !s.bakim);
    if (!bekle.length) { H.toast("Sterilizasyon aşamasında set yok.", "w"); return; }
    H.modal({ title:"Yük oluştur (sterilizasyon döngüsü)", wide:true,
      body:`<div class="icd-form">
        <div class="fr"><label>Sterilizasyon şekli</label><select data-f="sekil">${STER_SEKIL.map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
        <div class="fr"><label>Otoklav / cihaz</label><select data-f="otoklav">${OTOKLAVLAR.map(o => `<option>${esc(o)}</option>`).join("")}</select></div>
        <div class="fr"><label>Döngü no</label><input data-f="no" placeholder="ör. D-2042"></div>
        <div class="fr"><label>Sıcaklık (°C)</label><input data-f="sic" value="134"></div>
        <div class="fr"><label>Süre (dk)</label><input data-f="sure" value="7"></div>
        <div class="fr"><label>Bowie-Dick testi</label><select data-f="bowie"><option>Keçdi</option><option>Keçmədi</option></select></div>
        <div class="fr"><label>Biyolojik indikatör</label><select data-f="biyo"><option>Keçdi</option><option>Gözlənilir</option><option>Keçmədi</option></select></div></div>
        <div class="ist-sec ist-hd" style="margin:10px 0 4px"><h5>Yüke alınacak setler</h5><span class="adm-sub">${bekle.length} hazır</span></div>
        <div class="icd-oz" style="max-height:34vh;overflow:auto">${bekle.map(s => `<label><input type="checkbox" data-ls="${s.id}"${s.id === preId || !preId ? " checked" : ""}> ${esc(s.no)} · ${esc(s.ad)} <span class="adm-sub">(${esc(s.bolum)})</span></label>`).join("")}</div>
        <p class="adm-sub" style="margin-top:8px">Bir yükteki tüm setler aynı döngü/test sonucunu paylaşır. Biyolojik "Gözlənilir" ise setler depoya alınır, yük BI onayı beklenir (pozitif çıkarsa geri çağırılır).</p>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Yükü çalıştır</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = k => (m.querySelector(`[data-f="${k}"]`).value || "").trim();
        const ids = [...m.querySelectorAll("[data-ls]:checked")].map(c => c.dataset.ls);
        if (!ids.length) { H.toast("En az bir set seçin.", "w"); return; }
        const bowie = m.querySelector('[data-f="bowie"]').value, biyo = m.querySelector('[data-f="biyo"]').value, fail = (bowie === "Keçmədi" || biyo === "Keçmədi");
        const parametrik = H.data.sterParametrik !== false;   // açık (varsayılan): fiziksel+kimyasal uygunsa BI beklemeden serbest
        const biHold = (biyo === "Gözlənilir" && !parametrik);  // parametrik kapalıysa BI çıkana dek karantina
        const sekil = m.querySelector('[data-f="sekil"]').value;
        const load = { id:"ld" + Date.now(), no:"YÜK-" + (++H.data.sterLoadSeq), sekil, otoklav:m.querySelector('[data-f="otoklav"]').value, no2:g("no"), sic:g("sic"), sure:g("sure"), bowie, biyo, tarih:now(), setIds:ids.slice(),
          durum:fail ? "Test başarısız" : biyo === "Gözlənilir" ? "BI bekliyor" : "Serbest" };
        (H.data.sterLoad = H.data.sterLoad || []).unshift(load);
        ids.forEach(id => { const s = sets().find(x => x.id === id); if (!s) return;
          s.otoklav = { otoklav:load.otoklav, no:load.no2, sic:load.sic, sure:load.sure, sekil, bowie, biyo, tarih:load.tarih, yuk:load.no }; s.loadId = load.id;
          if (fail) { s.durum = "Test başarısız"; }
          else if (biHold) { s.durum = "Karantina (BI bekliyor)"; }   // sterilizasyonda bekler, depoya alınmaz
          else { s.durum = ""; s.dongu = (s.dongu || 0) + 1; s.raf = ""; s.sonKullanim = addDays(today(), RAF_OMUR); push(s, "Steril Depo"); } });
        H.saveData && H.saveData(); H.log("Sterilizasyon yükü", load.no + " · " + ids.length + " set · " + load.durum + (biHold ? " · karantina" : ""));
        H.toast(fail ? "Test keçmədi · " + ids.length + " set serbest bırakılmadı" : biHold ? load.no + " · " + ids.length + " set karantinada (BI bekleniyor)" : load.no + " · " + ids.length + " set Steril Depoya alındı" + (biyo === "Gözlənilir" ? " (BI bekliyor)" : ""), fail ? "e" : biHold ? "w" : "ok");
        H.closeModal(); afterGo && afterGo(); }; } });
  }

  // BI sonucu girme: BI bekleyen bir yükün biyolojik indikatör okuması. Keçdi → serbest (karantinadakiler depoya); Keçmədi → geri çağır.
  function biSonuc(load, afterGo) {
    H.modal({ title:"Biyolojik indikatör sonucu · " + esc(load.no),
      body:`<p class="adm-sub" style="margin:0 0 10px">${esc(load.no)} · ${esc(load.otoklav)} · ${esc(load.tarih)} · ${(load.setIds || []).length} set. BI inkübasyon sonucunu girin.</p>
        <div class="icd-form"><div class="fr"><label>Biyolojik indikatör</label><select data-f="r"><option>Keçdi</option><option>Keçmədi</option></select></div></div>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Sonucu uygula</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { const r = m.querySelector('[data-f="r"]').value; load.biyo = r;
        if (r === "Keçmədi") { H.closeModal(); H.saveData && H.saveData(); return recallLoad(load, afterGo); }   // pozitif → geri çağırma akışı
        load.durum = "Serbest";
        (load.setIds || []).forEach(id => { const s = sets().find(x => x.id === id); if (!s) return; if (s.otoklav) s.otoklav.biyo = "Keçdi";
          if (s.asama === "Sterilizasyon" && s.durum === "Karantina (BI bekliyor)") { s.durum = ""; s.dongu = (s.dongu || 0) + 1; s.raf = ""; s.sonKullanim = addDays(today(), RAF_OMUR); push(s, "Steril Depo"); } });
        H.saveData && H.saveData(); H.log("BI sonucu girildi", load.no + " · Keçdi"); H.toast(load.no + " · BI keçdi · setler serbest", "ok"); H.closeModal(); afterGo && afterGo(); }; } });
  }

  // Yük geri çağırma (recall-by-load): bir yüke giren tüm setleri (ve ulaştıkları vakaları) bulup yeniden işleme alır.
  function recallLoad(load, afterGo) {
    const ls = (load.setIds || []).map(id => sets().find(x => x.id === id)).filter(Boolean);
    const vakalar = [...new Set(ls.map(s => s.vaka).filter(Boolean))];
    const satir = ls.map(s => `<tr><td><b>${esc(s.no)}</b></td><td>${esc(s.ad)}</td><td>${esc(s.asama)}</td><td>${esc(s.vaka || "—")}</td></tr>`).join("");
    H.modal({ title:"Yük geri çağırma · " + esc(load.no), wide:true,
      body:`<div class="note" style="background:color-mix(in srgb,var(--crit) 10%,transparent);border:1px solid var(--crit);margin:0 0 10px">${I("alert")} Bu yük geri çağrılırsa içindeki <b>${ls.length} set</b> yeniden işleme (Kirli Kabul) alınır. Bu setlerin ulaştığı <b>${vakalar.length} vaka</b> bilgilendirilmelidir.</div>
        <div class="vz-hk" style="margin-bottom:8px"><div class="kv"><span>Otoklav · döngü</span><span>${esc(load.otoklav)} · ${esc(load.no2 || "—")}</span></div><div class="kv"><span>Tarih</span><span>${esc(load.tarih)}</span></div><div class="kv"><span>Test</span><span>Bowie:${esc(load.bowie)} · BI:${esc(load.biyo)}</span></div><div class="kv"><span>Etkilenen vakalar</span><span>${esc(vakalar.join(", ") || "—")}</span></div></div>
        <div class="tw"><table class="t"><thead><tr><th>Set no</th><th>Set</th><th>Şu anki aşama</th><th>Ulaştığı vaka</th></tr></thead><tbody>${satir || `<tr><td colspan="4" class="mute">Bu yükte set yok.</td></tr>`}</tbody></table></div>`,
      actions:`<button class="btn" data-x>Kapat</button><button class="btn" data-yaz>${I("print")} Raporu yazdır</button><button class="btn g" data-recall>${I("alert")} Yükü geri çağır (hepsini yeniden işle)</button>`,
      onMount(m) {
        m.querySelector("[data-yaz]").onclick = () => H.printTable && H.printTable("Yük geri çağırma · " + load.no, ["Set no", "Set", "Aşama", "Vaka"], ls.map(s => [s.no, s.ad, s.asama, s.vaka || "—"]), { sub:load.otoklav + " · " + load.tarih + " · Bowie:" + load.bowie + " · BI:" + load.biyo });
        m.querySelector("[data-recall]").onclick = () => { if (!confirm(ls.length + " set yeniden işleme alınacak. Onaylıyor musunuz?")) return;
          ls.forEach(s => { s.durum = "Geri çağrıldı"; s.otoklav = null; s.raf = ""; s.sonKullanim = ""; s.eksik = []; s.gecmis.push({ asama:"Geri çağrıldı (yük " + load.no + ")", kim:me(), zaman:now() }); s.asama = "Kirli Kabul"; });
          load.durum = "Geri çağrıldı"; H.saveData && H.saveData(); H.log("Yük geri çağrıldı", load.no + " · " + ls.length + " set · " + vakalar.length + " vaka");
          H.toast(load.no + " geri çağrıldı · " + ls.length + " set yeniden işleme alındı", "w"); H.closeModal(); afterGo && afterGo(); }; } });
  }

  function teslimModal(s, afterGo) {
    const prog = amelProgram();
    H.modal({ title:"Ameliyathaneye teslim · " + esc(s.no),
      body:`<div class="icd-form">
        <div class="fr"><label>Raf / konum</label><input data-f="raf" value="${esc(s.raf || "")}" placeholder="ör. A-03"></div>
        <div class="fr"><label>Son kullanım</label><input type="date" data-f="sk" value="${esc(s.sonKullanim || "")}"></div>
        <div class="fr" style="grid-column:1/-1"><label>Hasta / ameliyat (HBYS programından)</label><select data-f="prog"><option value="">— Hastanedeki ameliyat programından seç —</option>${prog.map((x, i) => `<option value="${i}">${esc(x.hasta || "Hasta")} · ${esc(x.ad)}${x.at ? " · " + esc(x.at) : ""}</option>`).join("")}<option value="serbest">(Listede yok · elle yaz)</option></select></div>
        <div class="fr" style="grid-column:1/-1" data-serbestwrap hidden><label>Vaka / ameliyat (serbest)</label><input data-f="vaka" placeholder="Ameliyat adı"></div>
        <div class="fr"><label>Teslim alan</label><input data-f="alan" placeholder="Ameliyathane personeli"></div></div>
        <p class="adm-sub" style="margin-top:8px">Set gerçek hastaya/ameliyata bağlanır → izlenebilirlik ve geri çağırma hastaya kadar iner. (Donanımda QR imza; burada ekranda onaylanır.)</p>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Teslimi onayla</button>`,
      onMount(m) { const sel = m.querySelector('[data-f="prog"]'), sw = m.querySelector("[data-serbestwrap]");
        sel.onchange = () => { sw.hidden = sel.value !== "serbest"; };
        m.querySelector("[data-ok]").onclick = () => { const g = k => { const el = m.querySelector(`[data-f="${k}"]`); return el ? (el.value || "").trim() : ""; };
        let vaka = "", pid = null;
        if (sel.value === "serbest") { vaka = g("vaka"); }
        else if (sel.value !== "") { const x = prog[+sel.value]; if (x) { vaka = (x.hasta || "Hasta") + " · " + x.ad; pid = x.pid; } }
        if (!vaka) { H.toast("Hasta/ameliyat seçin ya da yazın.", "w"); return; }
        s.raf = g("raf"); s.sonKullanim = g("sk") || s.sonKullanim; s.vaka = vaka; s.pid = pid || null; s.teslimAlan = g("alan"); push(s, "Teslim");
        H.closeModal(); H.toast("Set təhvil verildi · " + vaka); afterGo && afterGo(); }; } });
  }

  // İade / malzeme kabulü: set vakadan döndüğünde türü (Kirli / Kullanılmamış / Fire) ve sebebi kaydedilir (referans: Malzeme Kabul).
  function iadeModal(s, afterGo) {
    H.modal({ title:"İade / malzeme kabulü · " + esc(s.no),
      body:`<p class="adm-sub" style="margin:0 0 10px">${esc(s.ad)}${s.vaka ? " · vaka: " + esc(s.vaka) : ""} MSÜ'ye geri dönüyor. Türünü seçin — bu kayıt (hangi hastada kullanıldı) izlenebilirlikte kalır.</p>
        <div class="icd-form"><div class="fr" style="grid-column:1/-1"><label>İade / kabul türü</label><select data-f="tur">${IADE_TUR.map(t => `<option>${esc(t)}</option>`).join("")}</select></div>
        <div class="fr" style="grid-column:1/-1"><label>İade sebebi (ops.)</label><input data-f="sebep" placeholder="ör. kontaminasyon, zədə, açılmadı"></div></div>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>İadeyi kaydet</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { const tur = m.querySelector('[data-f="tur"]').value, sebep = (m.querySelector('[data-f="sebep"]').value || "").trim();
        s.iadeTuru = tur; s.iadeSebep = sebep; s.sonHasta = s.vaka || s.sonHasta || "";
        if (tur.indexOf("Fire") === 0) { s.fire = true; s.durum = "Fire"; s.gecmis.push({ asama:"Fire (hurda) · " + s.asama + (sebep ? " · " + sebep : ""), kim:me(), zaman:now() }); H.saveData && H.saveData(); H.log("Set fire/hurda", s.no + (sebep ? " · " + sebep : "")); H.toast("Set FIRE olarak işaretlendi · dolaşım dışı", "e"); }
        else { s.otoklav = null; s.raf = ""; s.sonKullanim = ""; s.vaka = ""; s.pid = null; s.teslimAlan = ""; s.eksik = []; s.durum = ""; s.gecmis.push({ asama:"İade: " + tur + (sebep ? " · " + sebep : ""), kim:me(), zaman:now() }); push(s, "Kirli Kabul"); H.toast("Set kabul edildi · yeniden işleme (" + tur.split(" ")[0] + ")", "w"); }
        H.closeModal(); afterGo && afterGo(); }; } });
  }

  /* ---------------- vaka arabası (case cart) — gerçek hastaya bağlı ---------------- */
  function cartForm(prefillIdx, afterGo) {
    const prog = amelProgram(), uygun = depoUygun();
    H.modal({ title:"Vaka arabası hazırla", wide:true,
      body:`<div class="icd-form">
        <div class="fr" style="grid-column:1/-1"><label>Hasta / ameliyat (HBYS programı)</label><select data-f="prog"><option value="">— Ameliyat programından seç —</option>${prog.map((x, i) => `<option value="${i}"${i === prefillIdx ? " selected" : ""}>${esc(x.hasta || "Hasta")} · ${esc(x.ad)}${x.at ? " · " + esc(x.at) : ""}</option>`).join("")}<option value="serbest">(Listede yok · elle yaz)</option></select></div>
        <div class="fr" style="grid-column:1/-1" data-sw hidden><label>Vaka / ameliyat (serbest)</label><input data-f="vaka" placeholder="Ameliyat adı"></div></div>
        <div class="ist-sec ist-hd" style="margin:10px 0 4px"><h5>Steril depodan set seç</h5><span class="adm-sub">${uygun.length} uygun set</span></div>
        <div class="icd-oz" style="max-height:34vh;overflow:auto">${uygun.length ? uygun.map(s => `<label><input type="checkbox" data-cs="${s.id}"> ${esc(s.no)} · ${esc(s.ad)} <span class="adm-sub">(${esc(s.bolum)} · raf ${esc(s.raf || "—")}${yakinSonKul(s) ? " · süre yakın" : ""})</span></label>`).join("") : `<p class="adm-sub">Steril depoda uygun (henüz bir arabaya ayrılmamış) set yok.</p>`}</div>
        <p class="adm-sub" style="margin-top:8px">Araba, ameliyat için gereken setleri toplar; "Ameliyathaneye gönder" deyince setler o hastaya teslim edilir.</p>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Arabayı oluştur</button>`,
      onMount(m) { const sel = m.querySelector('[data-f="prog"]'), sw = m.querySelector("[data-sw]");
        sel.onchange = () => { sw.hidden = sel.value !== "serbest"; };
        m.querySelector("[data-ok]").onclick = () => {
          const ids = [...m.querySelectorAll("[data-cs]:checked")].map(c => c.dataset.cs);
          let vaka = "", pid = null, hasta = "";
          if (sel.value === "serbest") { vaka = (m.querySelector('[data-f="vaka"]').value || "").trim(); }
          else if (sel.value !== "") { const x = prog[+sel.value]; if (x) { hasta = x.hasta || "Hasta"; vaka = hasta + " · " + x.ad; pid = x.pid; } }
          if (!vaka) { H.toast("Hasta/ameliyat seçin ya da yazın.", "w"); return; }
          if (!ids.length) { H.toast("En az bir set seçin.", "w"); return; }
          const cart = { id:"ct" + Date.now(), no:"ARB-" + (++H.data.sterCartSeq), vaka, pid, hasta, tarih:now(), setIds:ids.slice(), durum:"Hazırlanıyor" };
          (H.data.sterCart = H.data.sterCart || []).unshift(cart);
          ids.forEach(id => { const s = sets().find(x => x.id === id); if (s) s.cartId = cart.id; });
          H.saveData && H.saveData(); H.log("Vaka arabası hazırlandı", cart.no + " · " + vaka + " · " + ids.length + " set");
          H.toast("Araba hazırlandı: " + cart.no + " · " + ids.length + " set"); H.closeModal(); afterGo && afterGo(); }; } });
  }
  function cartGonder(cart, afterGo) {
    const ls = (cart.setIds || []).map(id => sets().find(x => x.id === id)).filter(Boolean);
    ls.forEach(s => { if (s.asama === "Steril Depo") { s.vaka = cart.vaka; s.pid = cart.pid || null; s.teslimAlan = "Vaka arabası " + cart.no; push(s, "Teslim"); } });
    cart.durum = "Gönderildi"; H.saveData && H.saveData(); H.log("Vaka arabası gönderildi", cart.no + " · " + cart.vaka);
    H.toast(cart.no + " ameliyathaneye gönderildi · " + ls.length + " set teslim", "ok"); afterGo && afterGo();
  }
  function cartIptal(cart, afterGo) {
    if (!confirm(cart.no + " arabası iptal edilsin mi? Setlerin rezervasyonu kalkar.")) return;
    (cart.setIds || []).forEach(id => { const s = sets().find(x => x.id === id); if (s && s.cartId === cart.id) s.cartId = null; });
    cart.durum = "İptal"; H.saveData && H.saveData(); H.log("Vaka arabası iptal", cart.no); H.toast("Araba iptal edildi", "w"); afterGo && afterGo();
  }

  /* ---------------- ReUse malzeme talep karşılama (bölüm → MSÜ) ---------------- */
  const talepler = () => H.data.sterTalep || [];
  const talepOf = (id) => talepler().find(t => t.id === id);
  const talepKalan = (t) => Math.max(0, (t.onaylanan || t.miktar || 0) - (t.karsilanan || 0));
  const mevcutStok = (ad) => sets().filter(s => s.asama === "Steril Depo" && !s.cartId && !s.kayip && !s.bakim && !s.fire && s.ad === ad).length;
  function talepForm(afterGo) {
    const kartlar = H.data.sterSetKart || [], bols = (H.klinikBolumler ? H.klinikBolumler() : (H.data.bolumler || [])).map(b => b.ad || b).filter(Boolean);
    H.modal({ title:"Yeni ReUse malzeme talebi", wide:true, body:`<div class="icd-form">
      <div class="fr"><label>Bölüm</label><input data-f="bolum" list="tl-bol" placeholder="Talep eden bölüm"><datalist id="tl-bol">${bols.map(b => `<option>${esc(b)}</option>`).join("")}</datalist></div>
      <div class="fr"><label>Kat</label><input data-f="kat" placeholder="ör. 2"></div>
      <div class="fr"><label>Depo</label><input data-f="depo" placeholder="ör. Əməliyyat anbarı"></div>
      <div class="fr"><label>Malzeme / set</label><input data-f="malzeme" list="tl-mlz" placeholder="Set / malzeme adı"><datalist id="tl-mlz">${kartlar.map(k => `<option>${esc(k.ad)}</option>`).join("")}</datalist></div>
      <div class="fr"><label>Miktar</label><input data-f="miktar" type="number" min="1" value="1"></div>
      <div class="fr" style="grid-column:1/-1"><label>Açıklama</label><input data-f="aciklama" placeholder="ops."></div></div>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Talep oluştur</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = s => (m.querySelector(`[data-f="${s}"]`).value || "").trim();
        if (!g("bolum") || !g("malzeme")) { H.toast("Bölüm ve malzeme gerekli.", "w"); return; }
        talepler().unshift({ id:"tl" + Date.now(), no:"TLP-" + (++H.data.sterTalepSeq), bolum:g("bolum"), kat:g("kat"), depo:g("depo"), tarih:now(), malzeme:g("malzeme"), miktar:parseInt(g("miktar"), 10) || 1, onaylanan:0, karsilanan:0, aciklama:g("aciklama"), durum:"Bekliyor" });
        H.saveData && H.saveData(); H.log("ReUse talep açıldı", g("bolum") + " · " + g("malzeme")); H.toast("Talep oluşturuldu"); H.closeModal(); afterGo && afterGo(); }; } });
  }
  function talepOnayla(t, afterGo) {
    const v = prompt("Onaylanan miktar (talep: " + t.miktar + "):", String(t.onaylanan || t.miktar));
    if (v == null) return; const n = parseInt(v, 10); if (isNaN(n) || n < 0) { H.toast("Geçersiz miktar.", "w"); return; }
    t.onaylanan = Math.min(n, t.miktar); t.durum = t.onaylanan > 0 ? "Onaylandı" : "Reddedildi"; H.saveData && H.saveData(); H.log("ReUse talep onay", t.no + " · " + t.onaylanan); H.toast("Onaylandı: " + t.onaylanan); afterGo && afterGo();
  }
  function talepKarsila(t, afterGo) {
    const kalan = talepKalan(t); if (kalan <= 0) { H.toast("Karşılanacak kalan yok.", "w"); return; }
    const mev = mevcutStok(t.malzeme);
    const v = prompt("Karşılanan miktar (kalan: " + kalan + " · depoda mevcut: " + mev + "):", String(Math.min(kalan, mev) || kalan));
    if (v == null) return; const n = parseInt(v, 10); if (isNaN(n) || n <= 0) { H.toast("Geçersiz miktar.", "w"); return; }
    t.karsilanan = (t.karsilanan || 0) + Math.min(n, kalan);
    t.durum = talepKalan(t) <= 0 ? "Karşılandı" : "Kısmi";
    H.saveData && H.saveData(); H.log("ReUse talep karşılandı", t.no + " · " + t.karsilanan + "/" + (t.onaylanan || t.miktar)); H.toast(t.durum === "Karşılandı" ? "Talep tam karşılandı" : "Kısmi karşılandı (" + t.karsilanan + ")", "ok"); afterGo && afterGo();
  }
  function talepReddet(t, afterGo) { if (!confirm(t.no + " reddedilsin mi?")) return; t.durum = "Reddedildi"; H.saveData && H.saveData(); H.log("ReUse talep reddedildi", t.no); H.toast("Talep reddedildi", "w"); afterGo && afterGo(); }

  /* ---------------- tekil alet (instrument-level) ---------------- */
  const ALET_DURUM = ["Aktif", "Tamirde", "Kayıp", "Emekli"];
  function aletForm(existing, afterGo) {
    const a = existing || {}, kartlar = H.data.sterSetKart || [], bols = (H.klinikBolumler ? H.klinikBolumler() : (H.data.bolumler || [])).map(b => b.ad || b).filter(Boolean);
    const insts = sets();
    H.modal({ title:existing ? "Alet · " + esc(a.seri || "") : "Yeni tekil alet", wide:true, body:`<div class="icd-form">
      <div class="fr"><label>Seri / tekil no</label><input data-f="seri" value="${esc(a.seri || "")}" placeholder="ör. OPT-30-0012"></div>
      <div class="fr"><label>Alet adı</label><input data-f="ad" value="${esc(a.ad || "")}" placeholder="ör. Laparoskopi Optik 30°"></div>
      <div class="fr"><label>Bölüm</label><input data-f="bolum" list="al-bol" value="${esc(a.bolum || "")}"><datalist id="al-bol">${bols.map(b => `<option>${esc(b)}</option>`).join("")}</datalist></div>
      <div class="fr"><label>Ait olduğu set şablonu</label><select data-f="kartId"><option value="">—</option>${kartlar.map(k => `<option value="${k.id}"${a.kartId === k.id ? " selected" : ""}>${esc(k.ad)}</option>`).join("")}</select></div>
      <div class="fr"><label>Bağlı set (örnek)</label><select data-f="setId"><option value="">— (serbest)</option>${insts.map(s => `<option value="${s.id}"${a.setId === s.id ? " selected" : ""}>${esc(s.no)} · ${esc(s.ad)}</option>`).join("")}</select></div>
      <div class="fr"><label>Kullanım döngüsü</label><input data-f="dongu" type="number" min="0" value="${esc(a.dongu || 0)}"></div>
      <div class="fr"><label>Durum</label><select data-f="durum">${ALET_DURUM.map(d => `<option${a.durum === d ? " selected" : ""}>${d}</option>`).join("")}</select></div></div>
      <p class="adm-sub" style="margin-top:8px">Pahalı/kritik aletler tek tek (seri no ile) izlenir: hangi sette, kaç döngü, durumu ne. "Alet nerede?" için seri no ile aratılır.</p>`,
      actions:`${existing ? `<button class="btn g" data-del>${I("trash")}Sil</button>` : ""}<span class="spacer"></span><button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Kaydet</button>`,
      onMount(m) { m.querySelector("[data-ok]").onclick = () => { const g = s => (m.querySelector(`[data-f="${s}"]`).value || "").trim();
        if (!g("seri") || !g("ad")) { H.toast("Seri no ve alet adı gerekli.", "w"); return; }
        const rec = { seri:g("seri"), ad:g("ad"), bolum:g("bolum"), kartId:m.querySelector('[data-f="kartId"]').value, setId:m.querySelector('[data-f="setId"]').value, dongu:parseInt(g("dongu"), 10) || 0, durum:m.querySelector('[data-f="durum"]').value };
        if (existing) Object.assign(existing, rec); else (H.data.sterAlet = H.data.sterAlet || []).unshift(Object.assign({ id:"al" + (++H.data.sterAletSeq) }, rec));
        H.saveData && H.saveData(); H.log("Tekil alet " + (existing ? "güncellendi" : "eklendi"), rec.seri + " · " + rec.ad); H.toast("Alet kaydedildi"); H.closeModal(); afterGo && afterGo(); };
        const d = m.querySelector("[data-del]"); if (d) d.onclick = () => { if (!confirm("Bu alet kaydı silinsin mi?")) return; H.data.sterAlet = (H.data.sterAlet || []).filter(x => x.id !== existing.id); H.saveData && H.saveData(); H.closeModal(); H.toast("Alet silindi", "w"); afterGo && afterGo(); }; } });
  }

  /* ---------------- etiket + izlenebilirlik ---------------- */
  function etiketYazdir(s) {
    const k = kartOf(s.kartId), w = window.open("", "_blank");
    if (!w) { H.toast("Yazdırma penceresi engellendi (pop-up izni gerekli).", "e"); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiket ${esc(s.no)}</title>
      <style>body{font:12px system-ui,Arial;margin:0;padding:10px;color:#111}.lbl{width:300px;border:1px solid #111;border-radius:6px;padding:10px}.lbl h3{margin:0 0 4px;font-size:15px}.row{display:flex;justify-content:space-between;margin:2px 0;font-size:11.5px}.bc{font:700 15px 'Courier New',monospace;letter-spacing:3px;text-align:center;margin-top:8px;padding:6px;border-top:1px dashed #999}</style></head>
      <body><div class="lbl"><h3>${esc(s.ad)}</h3>
        <div class="row"><span>Set no</span><b>${esc(s.no)}</b></div>
        <div class="row"><span>Bölüm</span><span>${esc(s.bolum)}</span></div>
        <div class="row"><span>Şablon / ver.</span><span>${esc(k.ad)} · ${esc(k.versiyon || "")}</span></div>
        <div class="row"><span>Sterilizasyon</span><span>${esc((s.otoklav && s.otoklav.tarih) || "—")}</span></div>
        <div class="row"><span>Döngü no</span><span>${esc((s.otoklav && s.otoklav.no) || "—")}</span></div>
        <div class="row"><span>Son kullanım</span><b>${esc(s.sonKullanim || "—")}</b></div>
        <div class="row"><span>Raf</span><span>${esc(s.raf || "—")}</span></div>
        <div class="row"><span>Toplam döngü</span><span>${s.dongu || 0}</span></div>
        <div class="bc">*${esc(s.no)}*</div></div>
      <script>window.onload=function(){setTimeout(function(){try{window.print()}catch(e){}},200)}<\/script></body></html>`);
    w.document.close(); H.log("Steril etiket yazdırıldı", s.no);
  }
  function izlenebilirlik(s) {
    if (!H.printTable) { H.toast("Yazdırma yok", "w"); return; }
    const k = kartOf(s.kartId);
    const rows = (s.gecmis || []).map(h => [h.asama, h.kim, h.zaman]);
    if (s.otoklav) rows.push(["Otoklav: " + s.otoklav.otoklav + " · döngü " + s.otoklav.no + " · " + s.otoklav.sic + "°C/" + s.otoklav.sure + "dk · Bowie:" + s.otoklav.bowie + " · Biyo:" + s.otoklav.biyo, "—", s.otoklav.tarih || "—"]);
    const sub = s.no + " · " + k.ad + " · döngü " + (s.dongu || 0) + (maxDongu(s) ? "/" + maxDongu(s) : "") + (s.vaka ? " · vaka: " + s.vaka : "") + (s.sonKullanim ? " · son kul. " + s.sonKullanim : "");
    H.printTable("İzlenebilirlik raporu · " + s.no, ["Aşama / işlem", "Kullanıcı", "Zaman"], rows, { sub });
    H.log("İzlenebilirlik raporu", s.no);
  }

  /* ---------------- set detay ---------------- */
  function setDetay(s, afterGo) {
    const k = kartOf(s.kartId), i = asamaIdx(s.asama), son = i < 5;
    const kv = (a, b) => `<div class="kv"><span>${esc(a)}</span><span>${b === 0 || b ? esc(String(b)) : "—"}</span></div>`;
    const hist = (s.gecmis || []).map(h => `<tr><td>${esc(h.asama)}</td><td class="adm-sub">${esc(h.kim)}</td><td class="mono adm-sub">${esc(h.zaman)}</td></tr>`).join("");
    const ban = (c, t) => `<div class="note" style="background:color-mix(in srgb,var(--${c}) 12%,transparent);border:1px solid var(--${c});color:var(--${c});margin:0 0 10px">${I("alert")} ${t}</div>`;
    let uyari = "";
    if (s.kayip) uyari += ban("crit", "KAYIP set · son görülen aşama: " + esc(s.asama) + ". Bulununca 'Bulundu' ile aktif edin.");
    if (s.eksik && s.eksik.length) uyari += ban("crit", "Eksik parça (" + s.eksik.length + "): " + esc(s.eksik.join(", ")));
    if (s.durum === "Test başarısız") uyari += ban("crit", "Sterilizasyon testi keçmədi · set serbest bırakılamaz.");
    if (s.fire) uyari += ban("crit", "FIRE / HURDA · set dolaşım dışı (zədəli/istifadə olunmaz)" + (s.iadeSebep ? " · " + esc(s.iadeSebep) : "") + ".");
    if (s.bakim) uyari += ban("high", "BAKIMDA / TAMİRDE · set dolaşım dışı. Dönünce 'Bakımdan dön' ile aktif edin.");
    if (s.loaner) uyari += ban("mid", "LOANER / firma seti" + (s.firma ? " · " + esc(s.firma) : "") + " · kullanımdan önce tüm akıştan geçmelidir.");
    if (omurDoldu(s)) uyari += ban("crit", "Kullanım ömrü doldu (" + (s.dongu || 0) + "/" + maxDongu(s) + ") · bakıma/yenilemeye gönderin.");
    else if (omurUyari(s)) uyari += ban("high", "Kullanım ömrü yaklaşıyor (" + (s.dongu || 0) + "/" + maxDongu(s) + ").");
    const otk = s.otoklav ? `<div class="box" style="margin-top:8px"><h5>Son otoklav döngüsü</h5><div class="vz-hk">${kv("Sterilizasyon şekli", s.otoklav.sekil)}${kv("Otoklav", s.otoklav.otoklav)}${kv("Döngü no", s.otoklav.no)}${kv("Sıcaklık", s.otoklav.sic + " °C")}${kv("Süre", s.otoklav.sure + " dk")}${kv("Bowie-Dick", s.otoklav.bowie)}${kv("Biyolojik", s.otoklav.biyo)}</div></div>` : "";
    H.modal({ title:"Set · " + esc(s.no), wide:true,
      body:`${uyari}<div class="g2" style="align-items:start"><div class="box"><h5>${esc(s.ad)}</h5><div class="vz-hk">${kv("Set no", s.no)}${kv("Şablon", k.ad + " · " + (k.versiyon || ""))}${kv("Bölüm", s.bolum)}${kv("Aşama", s.kayip ? s.asama + " (KAYIP)" : s.asama)}${kv("Parça sayısı", (k.parcalar || []).length)}${kv("Kullanım döngüsü", (s.dongu || 0) + (maxDongu(s) ? " / " + maxDongu(s) : ""))}${kv("Raf / konum", s.raf)}${kv("Son kullanım", s.sonKullanim)}${kv("Vaka / ameliyat", s.vaka)}${kv("Teslim alan", s.teslimAlan)}</div>${otk}</div>
        <div class="box"><h5>Aşama geçmişi (kim · ne zaman)</h5><div class="tw"><table class="t"><thead><tr><th>Aşama</th><th>Kullanıcı</th><th>Zaman</th></tr></thead><tbody>${hist || `<tr><td colspan="3" class="mute">—</td></tr>`}</tbody></table></div></div></div>`,
      actions:`<button class="btn ${s.stat ? "p" : ""}" data-stat>${s.stat ? "Acil ✓" : I("clock") + " Acil"}</button><button class="btn" data-bakim>${s.bakim ? I("refresh") + " Bakımdan dön" : I("cpu") + " Bakıma al"}</button><button class="btn g" data-kayip>${s.kayip ? I("refresh") + " Bulundu" : I("alert") + " Kayıp"}</button><button class="btn" data-etiket>${I("print")} Etiket</button><button class="btn" data-izlen>${I("print")} İzlenebilirlik</button><span class="spacer"></span><button class="btn" data-x>Kapat</button>${(s.kayip || s.bakim || s.fire) ? "" : `<button class="btn p" data-ilerlet>${son ? "Sonraki aşamaya al → " + ASAMALAR[i + 1] : "İade / kabul (geri dönüş)"}</button>`}`,
      onMount(m) { const il = m.querySelector("[data-ilerlet]"); if (il) il.onclick = () => { if (son) H.closeModal(); ilerlet(s, afterGo); };
        m.querySelector("[data-stat]").onclick = () => { s.stat = !s.stat; H.saveData && H.saveData(); H.log(s.stat ? "Set ACİL işaretlendi" : "Set normal önceliğe alındı", s.no); H.toast(s.stat ? "ACİL · set tüm kuyruklarda üste çıkar" : "Normal öncelik"); H.closeModal(); afterGo && afterGo(); };
        m.querySelector("[data-bakim]").onclick = () => { s.bakim = !s.bakim; s.gecmis.push({ asama:(s.bakim ? "Bakıma alındı" : "Bakımdan döndü") + " · " + s.asama, kim:me(), zaman:now() }); H.saveData && H.saveData(); H.log(s.bakim ? "Set bakıma alındı" : "Set bakımdan döndü", s.no); H.toast(s.bakim ? "Set bakıma/tamire alındı · dolaşım dışı" : "Set bakımdan döndü · aktif", s.bakim ? "w" : "ok"); H.closeModal(); afterGo && afterGo(); };
        m.querySelector("[data-kayip]").onclick = () => { s.kayip = !s.kayip; s.gecmis.push({ asama:(s.kayip ? "KAYIP işaretlendi" : "Bulundu / aktif") + " · " + s.asama, kim:me(), zaman:now() }); H.saveData && H.saveData(); H.log(s.kayip ? "Set kayıp işaretlendi" : "Set bulundu", s.no); H.toast(s.kayip ? "Set KAYIP olarak işaretlendi · tüm personele görünür" : "Set yeniden aktif", s.kayip ? "w" : "ok"); H.closeModal(); afterGo && afterGo(); };
        m.querySelector("[data-etiket]").onclick = () => etiketYazdir(s);
        m.querySelector("[data-izlen]").onclick = () => izlenebilirlik(s); } });
  }

  /* ---------------- yeni set (kirli kabul) ---------------- */
  function yeniSet(afterGo) {
    const kartlar = H.data.sterSetKart || [], vak = amelVakalar();
    H.modal({ title:"Yeni set · kirli kabul", body:`<div class="icd-form">
      <div class="fr"><label>Set şablonu</label><select data-f="kart">${kartlar.map(k => `<option value="${k.id}">${esc(k.ad)} · ${esc(k.bolum)}</option>`).join("")}</select></div>
      <div class="fr"><label>Nereden döndü (vaka, ops.)</label><input data-f="vaka" list="ster-vaka2" placeholder="Ameliyat / kaynak"><datalist id="ster-vaka2">${vak.map(v => `<option>${esc(v)}</option>`).join("")}</datalist></div>
      <div class="fr" style="grid-column:1/-1"><label class="dc-chk"><input type="checkbox" data-f2="loaner"> Loaner / firma seti (konsinye)</label></div>
      <div class="fr" style="grid-column:1/-1" data-firmawrap hidden><label>Firma adı</label><input data-f="firma" placeholder="ör. Medtronic, B.Braun"></div></div>
      <p class="adm-sub" style="margin-top:8px">Donanımda setin barkodu okutulur; burada şablon seçilir. Set "Kirli Kabul"da açılır. <b>Loaner set</b>, kullanımdan önce zorunlu olarak tüm akıştan (yeniden işlem) geçmelidir.</p>`,
      actions:`<button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Kirli kabule al</button>`,
      onMount(m) { const lo = m.querySelector('[data-f2="loaner"]'), fw = m.querySelector("[data-firmawrap]");
        lo.onchange = () => { fw.hidden = !lo.checked; };
        m.querySelector("[data-ok]").onclick = () => { const kartId = m.querySelector('[data-f="kart"]').value, k = kartOf(kartId);
        const loaner = lo.checked, firma = loaner ? (m.querySelector('[data-f="firma"]').value || "").trim() : "";
        const s = { id:"ss" + Date.now(), no:nextNo(), kartId, ad:k.ad, bolum:k.bolum, asama:"Kirli Kabul", eksik:[], otoklav:null, raf:"", sonKullanim:"", vaka:(m.querySelector('[data-f="vaka"]').value || "").trim(), teslimAlan:"", durum:"", dongu:0, kayip:false, bakim:false, stat:false, loaner, firma, gecmis:[{ asama:"Kirli Kabul", kim:me(), zaman:now() }] };
        sets().unshift(s); H.saveData && H.saveData(); H.log("Yeni set kirli kabul", s.no + " · " + k.ad + (loaner ? " · LOANER " + firma : "")); H.toast("Set kirli kabule alındı: " + s.no); H.closeModal(); afterGo && afterGo(); }; } });
  }

  /* ---------------- set şablonu (tanım) formu ---------------- */
  function kartForm(existing, afterGo) {
    const k = existing || { parcalar:[] };
    const bols = (H.klinikBolumler ? H.klinikBolumler() : (H.data.bolumler || [])).map(b => b.ad || b).filter(Boolean);
    const draw = (m) => { const parts = [...m.querySelectorAll("[data-pline]")].map(i => i.value.trim()).filter(Boolean);
      m.querySelector("[data-pcount]").textContent = parts.length + " parça"; };
    H.modal({ title:existing ? "Set şablonu düzenle" : "Yeni set şablonu", wide:true, body:`<div class="icd-form">
      <div class="fr" style="grid-column:1/-1"><label>Set adı</label><input data-f="ad" value="${esc(k.ad || "")}" placeholder="ör. Ümumi Cərrahiyyə Əsas Set"></div>
      <div class="fr"><label>Bölüm</label><input data-f="bolum" list="sk-bol" value="${esc(k.bolum || "")}" placeholder="Bölüm seç ya da yaz"><datalist id="sk-bol">${bols.map(b => `<option>${esc(b)}</option>`).join("")}</datalist></div>
      <div class="fr"><label>Versiyon</label><input data-f="versiyon" value="${esc(k.versiyon || "v1")}"></div>
      <div class="fr"><label>Maks. kullanım döngüsü (ömür)</label><input data-f="maxDongu" type="number" min="0" value="${esc(k.maxDongu || "")}" placeholder="ör. 300"></div>
      <div class="fr"><label>Sterilizasyon şekli</label><select data-f="sterSekil">${STER_SEKIL.map(x => `<option${(k.sterSekil || STER_SEKIL[0]) === x ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
      <div class="fr"><label>Not</label><input data-f="not" value="${esc(k.not || "")}" placeholder="ops."></div>
      <div class="fr" style="grid-column:1/-1"><label>Parça listesi <span class="adm-sub" data-pcount></span></label>
        <div data-plist>${((k.parcalar || []).length ? k.parcalar : [""]).map(p => `<div class="ster-pline" style="display:flex;gap:6px;margin-bottom:5px;align-items:center"><input data-pline value="${esc(p)}" placeholder="Parça adı (ör. Pensa ×6)" style="flex:1;min-width:0"><button type="button" class="btn g sm" data-prm style="flex:none" title="Satırı sil">${I("trash") || "×"}</button></div>`).join("")}</div>
        <button type="button" class="btn sm" data-padd style="margin-top:2px">${I("plus") || "+"} Parça ekle</button>
        <p class="adm-sub" style="margin-top:6px">Bu liste, paketleme aşamasında teknikerin tek tek işaretleyeceği kontrol föyüdür.</p></div></div>`,
      actions:`${existing ? `<button class="btn g" data-del>${I("trash")}Sil</button>` : ""}<span class="spacer"></span><button class="btn" data-x>Vazgeç</button><button class="btn p" data-ok>Kaydet</button>`,
      onMount(m) { draw(m);
        const plist = m.querySelector("[data-plist]");
        const addRow = (val) => { const d = document.createElement("div"); d.className = "ster-pline"; d.style = "display:flex;gap:6px;margin-bottom:5px;align-items:center"; d.innerHTML = `<input data-pline value="${esc(val || "")}" placeholder="Parça adı (ör. Pensa ×6)" style="flex:1;min-width:0"><button type="button" class="btn g sm" data-prm style="flex:none" title="Satırı sil">${I("trash") || "×"}</button>`; plist.appendChild(d); d.querySelector("[data-pline]").focus(); draw(m); };
        m.querySelector("[data-padd]").onclick = () => addRow("");
        plist.addEventListener("click", (e) => { const rm = e.target.closest("[data-prm]"); if (rm) { rm.closest(".r").remove(); draw(m); } });
        plist.addEventListener("input", () => draw(m));
        m.querySelector("[data-ok]").onclick = () => { const g = s => (m.querySelector(`[data-f="${s}"]`).value || "").trim();
        if (!g("ad")) { H.toast("Set adı gerekli.", "w"); return; }
        const parts = [...m.querySelectorAll("[data-pline]")].map(i => i.value.trim()).filter(Boolean);
        if (!parts.length) { H.toast("En az bir parça ekleyin.", "w"); return; }
        const maxD = parseInt(g("maxDongu"), 10) || 0, sekil = m.querySelector('[data-f="sterSekil"]').value;
        if (existing) { Object.assign(existing, { ad:g("ad"), bolum:g("bolum"), versiyon:g("versiyon"), maxDongu:maxD, sterSekil:sekil, not:g("not"), parcalar:parts }); }
        else { (H.data.sterSetKart = H.data.sterSetKart || []).push({ id:"sk" + Date.now(), ad:g("ad"), bolum:g("bolum"), versiyon:g("versiyon") || "v1", maxDongu:maxD, sterSekil:sekil, not:g("not"), parcalar:parts }); }
        H.saveData && H.saveData(); H.log("Set şablonu " + (existing ? "güncellendi" : "eklendi"), g("ad")); H.toast("Set şablonu kaydedildi"); H.closeModal(); afterGo && afterGo(); };
        const d = m.querySelector("[data-del]"); if (d) d.onclick = () => { if (!confirm("Bu set şablonu silinsin mi?")) return; H.data.sterSetKart = (H.data.sterSetKart || []).filter(x => x.id !== existing.id); H.saveData && H.saveData(); H.closeModal(); H.toast("Şablon silindi", "w"); afterGo && afterGo(); }; } });
  }

  /* ---------------- ekran ---------------- */
  H.register("sterilizasyon", { title:() => H.t("m_steril"), perm:"steril", render(root, params = {}) {
    seed();
    const tab = params.tab || "pano";
    const TABS = [["pano", "Akış panosu"], ["depo", "Steril depo"], ["yukler", "Yükler"], ["arabalar", "Vaka arabaları"], ["talepler", "ReUse talepler"], ["tanim", "Set tanımları"], ["aletler", "Tekil aletler"], ["komuta", "Komuta merkezi"]];
    const go = () => H.go("sterilizasyon", { tab });
    const rerender = () => H.go("sterilizasyon", params);

    const SEVC = { "Kirli Kabul":"var(--crit)", "Yıkama":"var(--mid)", "Paketleme":"var(--low)", "Sterilizasyon":"var(--high)", "Steril Depo":"var(--ok)", "Teslim":"var(--line)" };
    const kart = (s) => { const warn = s.kayip || s.bakim || (s.eksik && s.eksik.length) || s.durum === "Test başarısız" || omurDoldu(s) || (s.asama === "Steril Depo" && yakinSonKul(s));
      const badges = [s.stat ? `<span class="tag c" style="margin-top:4px">ACİL</span>` : "", s.fire ? `<span class="tag c" style="margin-top:4px">FIRE</span>` : "", s.kayip ? `<span class="tag c" style="margin-top:4px">KAYIP</span>` : "",
        s.bakim ? `<span class="tag w" style="margin-top:4px">Bakımda</span>` : "", s.loaner ? `<span class="tag" style="margin-top:4px">Loaner</span>` : "", s.cartId ? `<span class="tag" style="margin-top:4px">Arabada</span>` : "",
        s.eksik && s.eksik.length ? `<span class="tag c" style="margin-top:4px">Eksik ${s.eksik.length}</span>` : "", s.durum === "Test başarısız" ? `<span class="tag c" style="margin-top:4px">Test ✗</span>` : "",
        omurDoldu(s) ? `<span class="tag c" style="margin-top:4px">Ömür doldu</span>` : omurUyari(s) ? `<span class="tag w" style="margin-top:4px">Ömür yakın</span>` : ""].join("");
      return `<div class="ster-card" data-set="${s.id}" style="cursor:pointer;border:1px solid ${s.stat ? "var(--crit)" : warn ? "var(--crit)" : "var(--line2)"};border-left:${s.stat ? "4px solid var(--crit)" : "1px solid " + (warn ? "var(--crit)" : "var(--line2)")};border-radius:10px;padding:8px 10px;margin-bottom:8px;background:var(--card)">
        <div style="display:flex;justify-content:space-between;gap:6px"><b style="font-size:13px">${s.stat ? "⚡ " : ""}${esc(s.ad)}</b><span class="mono adm-sub" style="font-size:11px">${esc(s.no)}</span></div>
        <div class="adm-sub" style="font-size:11.5px">${esc(s.bolum)} · ${s.dongu || 0}${maxDongu(s) ? "/" + maxDongu(s) : ""} döngü</div>
        ${badges}
        ${s.asama === "Steril Depo" ? `<div class="adm-sub" style="font-size:11px;margin-top:3px">Raf ${esc(s.raf || "—")} · s.kul. ${esc(s.sonKullanim || "—")}${yakinSonKul(s) ? ' <span class="tag w">yaklaşıyor</span>' : ""}</div>` : ""}
        ${s.asama === "Teslim" && s.vaka ? `<div class="adm-sub" style="font-size:11px;margin-top:3px">→ ${esc(s.vaka)}</div>` : ""}</div>`; };

    const panoHtml = () => `<div class="tw" style="overflow:auto"><div style="display:flex;gap:10px;min-width:900px;align-items:start">
      ${ASAMALAR.map(a => { const list = sets().filter(s => s.asama === a).sort((x, z) => (z.stat ? 1 : 0) - (x.stat ? 1 : 0));
        return `<div style="flex:1;min-width:150px"><div style="display:flex;align-items:center;gap:6px;font:700 12.5px Figtree;padding:6px 8px;border-radius:8px;background:color-mix(in srgb,${SEVC[a]} 16%,transparent);border-left:3px solid ${SEVC[a]};margin-bottom:8px">${I(ASAMA_IC[a]) || ""} ${esc(a)} <span class="adm-sub" style="margin-left:auto">${list.length}</span>${a === "Sterilizasyon" && list.length ? `<button class="btn sm" data-yukyeni title="Yük oluştur (çok set tek döngü)" style="margin-left:6px;padding:2px 7px">${I("flask") || ""} Yük</button>` : ""}</div>
          ${list.map(kart).join("") || `<div class="adm-sub" style="font-size:11.5px;padding:6px 2px">—</div>`}</div>`; }).join("")}
      </div></div><p class="adm-sub" style="margin-top:8px">Bir karta tıkla → detay + "Sonraki aşamaya al". Paketlemede eksik parça olursa set ilerlemez; sterilizasyonda test "keçmədi" ise serbest bırakılmaz.</p>`;

    const depoHtml = () => { const d = sets().filter(s => s.asama === "Steril Depo").sort((a, z) => String(a.sonKullanim).localeCompare(String(z.sonKullanim)));
      return `<div class="tw"><table class="t"><thead><tr><th>Set</th><th>Bölüm</th><th>Raf</th><th>Son kullanım</th><th>Durum</th><th style="width:120px"></th></tr></thead><tbody>
        ${d.length ? d.map(s => `<tr class="row" data-set="${s.id}" style="cursor:pointer"><td><b>${esc(s.ad)}</b><div class="mono adm-sub" style="font-size:11px">${esc(s.no)}</div></td><td class="adm-sub">${esc(s.bolum)}</td><td>${esc(s.raf || "—")}</td><td class="mono ${yakinSonKul(s) ? "" : "adm-sub"}">${esc(s.sonKullanim || "—")}</td><td>${s.cartId ? `<span class="tag">arabada ${esc(cartNoOf(s))}</span>` : yakinSonKul(s) ? '<span class="tag w">süre yaklaşıyor</span>' : '<span class="tag ok">steril</span>'}</td><td>${s.cartId ? '<span class="adm-sub">arabaya ayrıldı</span>' : `<button class="btn p sm" data-teslim="${s.id}">Teslim et</button>`}</td></tr>`).join("") : `<tr><td colspan="6" class="mute" style="padding:18px;text-align:center">Steril depoda set yok.</td></tr>`}
        </tbody></table></div><p class="adm-sub" style="margin-top:8px">FIFO: son kullanımı yakın olan üstte. 30 günden az kalanlar uyarılı.</p>`; };

    const tanimHtml = () => `<div class="tw"><table class="t"><thead><tr><th>Set şablonu</th><th>Bölüm</th><th>Versiyon</th><th style="width:90px">Parça</th><th>Not</th></tr></thead><tbody>
      ${(H.data.sterSetKart || []).map(k => `<tr class="row" data-kart="${k.id}" style="cursor:pointer"><td><b>${esc(k.ad)}</b></td><td class="adm-sub">${esc(k.bolum || "—")}</td><td>${esc(k.versiyon || "")}</td><td class="n">${(k.parcalar || []).length}</td><td class="adm-sub">${esc(k.not || "")}</td></tr>`).join("") || `<tr><td colspan="5" class="mute" style="padding:18px;text-align:center">Set şablonu yok.</td></tr>`}
      </tbody></table></div><p class="adm-sub" style="margin-top:8px">Set şablonu = paketlemede beklenen parça listesi. Satıra tıkla düzenle.</p>`;

    const komutaHtml = () => { const all = sets();
      const say = (a) => all.filter(s => s.asama === a).length;
      const dongBugun = all.filter(s => s.otoklav && String(s.otoklav.tarih || "").includes(new Date().toLocaleDateString("az-AZ"))).length;
      const eksikler = all.filter(s => s.eksik && s.eksik.length), testFail = all.filter(s => s.durum === "Test başarısız"), yakin = all.filter(s => s.asama === "Steril Depo" && yakinSonKul(s)), teslimBek = all.filter(s => s.asama === "Steril Depo");
      const kayipSet = all.filter(s => s.kayip), omurSet = all.filter(s => omurDoldu(s)), acilSet = all.filter(s => s.stat), bakimSet = all.filter(s => s.bakim), loanerSet = all.filter(s => s.loaner), fireSet = all.filter(s => s.fire);
      const sorunlu = eksikler.length + testFail.length + kayipSet.length + omurSet.length + bakimSet.length + fireSet.length;
      const teslimli = all.filter(s => s.asama === "Teslim").length, aktifAraba = carts().filter(c => c.durum === "Hazırlanıyor").length;
      const stat = (b, l, c) => `<div class="ac${c ? " " + c : ""}"><div class="i">${I("box")}</div><b>${b}</b><span>${esc(l)}</span></div>`;
      const uyarilar = [...acilSet.map(s => ["crit", s.no + " · ACİL · " + s.asama]), ...testFail.map(s => ["crit", s.no + " · sterilizasyon testi keçmədi"]), ...kayipSet.map(s => ["crit", s.no + " · KAYIP (son: " + s.asama + ")"]), ...eksikler.map(s => ["crit", s.no + " · " + s.eksik.length + " eksik parça"]), ...fireSet.map(s => ["crit", s.no + " · FIRE/hurda" + (s.iadeSebep ? " · " + s.iadeSebep : "")]), ...bakimSet.map(s => ["w", s.no + " · bakımda/tamirde"]), ...omurSet.map(s => ["w", s.no + " · kullanım ömrü doldu (" + (s.dongu || 0) + "/" + maxDongu(s) + ")"]), ...yakin.map(s => ["w", s.no + " · son kullanım yaklaşıyor (" + s.sonKullanim + ")"])];
      return `<div class="att">${stat(all.length, "toplam set", "")}${stat(acilSet.length, "acil (STAT)", acilSet.length ? "crit" : "")}${stat(teslimBek.length, "teslime hazır (depoda)", "")}${stat(sorunlu, "sorunlu set", sorunlu ? "crit" : "ok")}</div>
        <div class="g2" style="margin-top:14px;align-items:start"><div class="box"><h5>Aşamalardaki set sayısı</h5>${ASAMALAR.map(a => `<div style="display:flex;justify-content:space-between;font-size:13px;margin:6px 0"><span>${esc(a)}</span><b class="mono">${say(a)}</b></div>`).join("")}<div class="adm-sub" style="margin-top:8px;line-height:1.7">Bugünkü otoklav döngüsü: <b>${dongBugun}</b> · Toplam yük: <b>${loads().length}</b><br>Teslim edilen set: <b>${teslimli}</b> · Aktif araba: <b>${aktifAraba}</b> · Bakımda: <b>${bakimSet.length}</b> · Loaner: <b>${loanerSet.length}</b></div></div>
          <div class="box"><h5>Uyarılar (${uyarilar.length})</h5>${uyarilar.length ? uyarilar.map(([c, t]) => `<div class="note" style="margin:6px 0;padding:7px 9px;border-radius:8px;background:color-mix(in srgb,var(--${c === "crit" ? "crit" : "mid"}) 10%,transparent);font-size:12.5px">${I(c === "crit" ? "alert" : "clock")} ${esc(t)}</div>`).join("") : `<p class="adm-sub">Açık uyarı yok.</p>`}</div></div>
        <div class="box" style="margin-top:14px"><h5>Serbest bırakma politikası</h5><label class="dc-chk"><input type="checkbox" data-param${H.data.sterParametrik !== false ? " checked" : ""}> Parametrik serbest bırakma açık (fiziksel + kimyasal uygunsa biyolojik sonucu <b>beklemeden</b> serbest bırak)</label><p class="adm-sub" style="margin-top:6px">Kapalıysa, biyolojik indikatör "Gözlənilir" olan yükler <b>karantinada</b> tutulur; "Yükler → BI sonucu" ile sonuç girilince serbest bırakılır. Gerçek kullanımda bu ayar doğrulanmış sürece bağlıdır.</p></div>
        <p class="adm-sub" style="margin-top:10px">Komuta merkezi: tüm MSÜ akışının özeti. Donanım bağlandığında otoklav doluluğu ve canlı döngüler buraya gerçek veriyle akar.</p>`; };

    const LDUR = { "Serbest":"ok", "BI bekliyor":"w", "Test başarısız":"crit", "Geri çağrıldı":"crit" };
    const yukHtml = () => { const L = loads();
      return `<div class="tw"><table class="t"><thead><tr><th>Yük</th><th>Otoklav · döngü</th><th>Tarih</th><th style="width:60px">Set</th><th>Test (Bowie / BI)</th><th style="width:130px">Durum</th><th style="width:120px"></th></tr></thead><tbody>
        ${L.length ? L.map(l => `<tr class="row" data-load="${l.id}" style="cursor:pointer"><td><b>${esc(l.no)}</b></td><td class="adm-sub">${esc(l.otoklav)} · ${esc(l.no2 || "—")}</td><td class="mono adm-sub">${esc(l.tarih)}</td><td class="n">${(l.setIds || []).length}</td><td class="adm-sub">${esc(l.bowie)} / ${esc(l.biyo)}</td><td><span class="tag ${LDUR[l.durum] || ""}">${esc(l.durum)}</span></td><td>${l.durum === "BI bekliyor" ? `<button class="btn p sm" data-bisonuc="${l.id}">BI sonucu</button> ` : ""}<button class="btn g sm" data-recall="${l.id}">${I("alert") || ""} Geri çağır</button></td></tr>`).join("") : `<tr><td colspan="7" class="mute" style="padding:18px;text-align:center">Henüz yük yok. Sterilizasyon sütununda "Yük" ile oluşturun.</td></tr>`}
        </tbody></table></div><p class="adm-sub" style="margin-top:8px">Her sterilizasyon döngüsü bir "yük"tür. Biyolojik indikatör pozitif/şüpheli çıkarsa yükü <b>geri çağır</b> → içindeki tüm setler ve ulaştıkları vakalar listelenir, setler yeniden işleme alınır.</p>`; };

    const setAd = (id) => { const s = sets().find(x => x.id === id); return s ? s.no : "—"; };
    const CDUR = { "Hazırlanıyor":"w", "Gönderildi":"ok", "İptal":"" };
    const arabaHtml = () => { const prog = amelProgram(), cs = carts().filter(c => c.durum !== "İptal");
      const prgRows = prog.length ? prog.map((x, i) => `<tr><td><b>${esc(x.hasta || "Hasta")}</b></td><td>${esc(x.ad)}</td><td class="mono adm-sub">${esc(x.at || "—")}</td><td><button class="btn p sm" data-cartprep="${i}">${I("plus") || ""} Araba hazırla</button></td></tr>`).join("") : `<tr><td colspan="4" class="mute" style="padding:14px;text-align:center">Ameliyat programı boş (HBYS'de ameliyat istemi girilince burada listelenir).</td></tr>`;
      const cRows = cs.length ? cs.map(c => `<tr><td><b>${esc(c.no)}</b></td><td>${esc(c.vaka)}</td><td class="adm-sub">${(c.setIds || []).map(setAd).join(", ")}</td><td><span class="tag ${CDUR[c.durum] || ""}">${esc(c.durum)}</span></td><td>${c.durum === "Hazırlanıyor" ? `<button class="btn p sm" data-cartgonder="${c.id}">Ameliyathaneye gönder</button> <button class="btn g sm" data-cartiptal="${c.id}">İptal</button>` : "—"}</td></tr>`).join("") : `<tr><td colspan="5" class="mute" style="padding:14px;text-align:center">Araba yok.</td></tr>`;
      return `<div class="ist-sec ist-hd" style="margin:0 0 6px"><h5>Ameliyat programı</h5><span class="adm-sub">${prog.length} vaka</span></div>
        <div class="tw"><table class="t"><thead><tr><th>Hasta</th><th>Ameliyat</th><th>Zaman</th><th style="width:150px"></th></tr></thead><tbody>${prgRows}</tbody></table></div>
        <div class="ist-sec ist-hd" style="margin:14px 0 6px"><h5>Vaka arabaları</h5><span class="adm-sub">${cs.length} araba</span></div>
        <div class="tw"><table class="t"><thead><tr><th>Araba</th><th>Hasta / ameliyat</th><th>Setler</th><th style="width:110px">Durum</th><th style="width:230px"></th></tr></thead><tbody>${cRows}</tbody></table></div>
        <p class="adm-sub" style="margin-top:8px">Programdaki vaka için steril depodan setler toplanır; "gönder" deyince setler o <b>hastaya</b> teslim edilir (izlenebilirlik hastaya iner).</p>`; };

    const TDUR = { "Bekliyor":"w", "Onaylandı":"", "Kısmi":"w", "Karşılandı":"ok", "Reddedildi":"c" };
    const talepHtml = () => { const T = talepler();
      return `<div class="tw"><table class="t"><thead><tr><th>Talep no</th><th>Bölüm</th><th>Kat</th><th>Depo</th><th>Malzeme / set</th><th style="width:60px">Miktar</th><th style="width:70px">Onaylı</th><th style="width:75px">Karşılanan</th><th style="width:55px">Kalan</th><th style="width:65px">Mevcut</th><th style="width:110px">Durum</th><th style="width:230px"></th></tr></thead><tbody>
        ${T.length ? T.map(t => { const kalan = talepKalan(t), aktif = t.durum !== "Reddedildi" && t.durum !== "Karşılandı"; return `<tr data-talep="${t.id}"><td><b>${esc(t.no)}</b><div class="adm-sub" style="font-size:11px">${esc(t.tarih)}</div></td><td>${esc(t.bolum)}</td><td class="adm-sub">${esc(t.kat || "—")}</td><td class="adm-sub">${esc(t.depo || "—")}</td><td>${esc(t.malzeme)}${t.aciklama ? `<div class="adm-sub" style="font-size:11px">${esc(t.aciklama)}</div>` : ""}</td><td class="n">${t.miktar}</td><td class="n">${t.onaylanan || 0}</td><td class="n">${t.karsilanan || 0}</td><td class="n">${kalan}</td><td class="n">${mevcutStok(t.malzeme)}</td><td><span class="tag ${TDUR[t.durum] || ""}">${esc(t.durum)}</span></td><td>${t.durum === "Bekliyor" ? `<button class="btn p sm" data-talep-onay="${t.id}">Onayla</button> <button class="btn g sm" data-talep-red="${t.id}">Reddet</button>` : aktif ? `<button class="btn p sm" data-talep-kars="${t.id}">Karşıla</button> <button class="btn g sm" data-talep-red="${t.id}">Reddet</button>` : "—"}</td></tr>`; }).join("") : `<tr><td colspan="12" class="mute" style="padding:18px;text-align:center">ReUse malzeme talebi yok. "Yeni talep" ile bölüm adına talep açın.</td></tr>`}
        </tbody></table></div><p class="adm-sub" style="margin-top:8px">Bölümler steril (yeniden kullanılabilir) set/malzeme talep eder; MSÜ onaylar ve steril depodan karşılar. "Mevcut" = depodaki hazır sayı.</p>`; };

    const ADUR = { "Aktif":"ok", "Tamirde":"w", "Kayıp":"c", "Emekli":"" };
    const aletHtml = () => { const A = H.data.sterAlet || [];
      return `<div class="tw"><table class="t"><thead><tr><th>Seri no</th><th>Alet</th><th>Bölüm</th><th>Bağlı set</th><th style="width:80px">Döngü</th><th style="width:110px">Durum</th></tr></thead><tbody>
        ${A.length ? A.map(a => { const s = sets().find(x => x.id === a.setId); return `<tr class="row" data-alet="${a.id}" style="cursor:pointer"><td class="mono"><b>${esc(a.seri)}</b></td><td>${esc(a.ad)}</td><td class="adm-sub">${esc(a.bolum || "—")}</td><td class="adm-sub">${s ? esc(s.no) : (a.kartId ? esc((kartOf(a.kartId).ad)) : "—")}</td><td class="n">${a.dongu || 0}</td><td><span class="tag ${ADUR[a.durum] || ""}">${esc(a.durum)}</span></td></tr>`; }).join("") : `<tr><td colspan="6" class="mute" style="padding:18px;text-align:center">Tekil izlenen alet yok. "Yeni alet" ile ekleyin.</td></tr>`}
        </tbody></table></div><p class="adm-sub" style="margin-top:8px">Pahalı/kritik aletler seri no ile tek tek izlenir. Aramak için üstteki kutuya seri no / alet adı yazın ("alet nerede?").</p>`; };

    const body = { pano:panoHtml, depo:depoHtml, yukler:yukHtml, arabalar:arabaHtml, talepler:talepHtml, tanim:tanimHtml, aletler:aletHtml, komuta:komutaHtml }[tab]();
    const yeniBtn = tab === "tanim" ? `<button class="btn p" data-kartnew>${I("plus")} Yeni şablon</button>`
      : tab === "yukler" ? `<button class="btn p" data-yukyeni2>${I("flask") || ""} Yük oluştur</button>`
      : tab === "arabalar" ? `<button class="btn p" data-cartnew>${I("plus")} Yeni araba</button>`
      : tab === "talepler" ? `<button class="btn p" data-talepnew>${I("plus")} Yeni talep</button>`
      : tab === "aletler" ? `<button class="btn p" data-aletnew>${I("plus")} Yeni alet</button>`
      : `<button class="btn p" data-yeniset title="Kirli kabule yeni set al">${I("plus")} Yeni set</button>`;
    root.innerHTML = `<div class="ph"><div><h2>${H.t("m_steril")}</h2><p>Merkezi Sterilizasyon (MSÜ) · set izleme · ${sets().length} aktif set</p></div><div class="r">${yeniBtn}</div></div>
      <div class="seg" style="margin-bottom:10px">${TABS.map(([k, l]) => `<button data-stab="${k}" class="${tab === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
      <div class="adm-bar" style="margin-bottom:10px">${H.filterBox ? H.filterBox("Set no / ad / bölüm ara…") : ""}</div>
      ${body}`;

    root.onclick = (e) => {
      const st = e.target.closest("[data-stab]"); if (st) return H.go("sterilizasyon", { tab:st.dataset.stab });
      if (e.target.closest("[data-yeniset]")) return yeniSet(rerender);
      if (e.target.closest("[data-kartnew]")) return kartForm(null, rerender);
      if (e.target.closest("[data-yukyeni]") || e.target.closest("[data-yukyeni2]")) return loadBuilder(null, rerender);
      if (e.target.closest("[data-cartnew]")) return cartForm(null, rerender);
      if (e.target.closest("[data-aletnew]")) return aletForm(null, rerender);
      const al = e.target.closest("[data-alet]"); if (al) { const a = (H.data.sterAlet || []).find(x => x.id === al.dataset.alet); if (a) aletForm(a, rerender); return; }
      if (e.target.closest("[data-talepnew]")) return talepForm(rerender);
      const to = e.target.closest("[data-talep-onay]"); if (to) { const t = talepOf(to.dataset.talepOnay); if (t) talepOnayla(t, rerender); return; }
      const tk = e.target.closest("[data-talep-kars]"); if (tk) { const t = talepOf(tk.dataset.talepKars); if (t) talepKarsila(t, rerender); return; }
      const tr = e.target.closest("[data-talep-red]"); if (tr) { const t = talepOf(tr.dataset.talepRed); if (t) talepReddet(t, rerender); return; }
      const cp = e.target.closest("[data-cartprep]"); if (cp) return cartForm(+cp.dataset.cartprep, rerender);
      const cg = e.target.closest("[data-cartgonder]"); if (cg) { const c = cartOf(cg.dataset.cartgonder); if (c) cartGonder(c, rerender); return; }
      const ci = e.target.closest("[data-cartiptal]"); if (ci) { const c = cartOf(ci.dataset.cartiptal); if (c) cartIptal(c, rerender); return; }
      const pr = e.target.closest("[data-param]"); if (pr) { H.data.sterParametrik = pr.checked; H.saveData && H.saveData(); H.log("Parametrik serbest bırakma", pr.checked ? "açık" : "kapalı"); H.toast(pr.checked ? "Parametrik serbest bırakma açık" : "Parametrik kapalı · biyolojik sonuç beklenir"); return; }
      const bs = e.target.closest("[data-bisonuc]"); if (bs) { const l = loadOf(bs.dataset.bisonuc); if (l) biSonuc(l, rerender); return; }
      const ld = e.target.closest("[data-load]"); if (ld) { const l = loadOf(ld.dataset.load); if (l) recallLoad(l, rerender); return; }
      const tz = e.target.closest("[data-teslim]"); if (tz) { const s = sets().find(x => x.id === tz.dataset.teslim); if (s) teslimModal(s, rerender); return; }
      const kt = e.target.closest("[data-kart]"); if (kt) { const k = (H.data.sterSetKart || []).find(x => x.id === kt.dataset.kart); if (k) kartForm(k, rerender); return; }
      const se = e.target.closest("[data-set]"); if (se) { const s = sets().find(x => x.id === se.dataset.set); if (s) setDetay(s, rerender); return; }
    };
    // Ortak filtre + pano kartlarını da süz (pano tablo değil, kart olduğu için H.wireFilter tek başına yetmez)
    const fq = root.querySelector("[data-tfilter]");
    if (fq) fq.oninput = () => { const v = fq.value.trim().toLocaleLowerCase("tr");
      root.querySelectorAll(".ster-card").forEach(c => c.style.display = (!v || c.textContent.toLocaleLowerCase("tr").includes(v)) ? "" : "none");
      root.querySelectorAll("table.t").forEach(tb => { if (tb.offsetParent === null) return; const b = tb.tBodies[0]; if (!b) return;
        [...b.rows].forEach(r => { if (r.querySelector("td[colspan]")) return; r.style.display = (!v || r.textContent.toLocaleLowerCase("tr").includes(v)) ? "" : "none"; }); }); };
  } });
})();

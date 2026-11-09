/* Homunculus · bileklik / barkod okutma · 25.09.2026
 * Ozan: "bileklik okut sayfasında gerçek kamera açılıp hasta barkodunu ya da protokol barkodunu okutması gerekmiyor mu?
 * Okuttuğunda o bilgiler ekrana yansımalı." Önceki akış canlandırmaydı (rastgele hasta seçiyordu).
 * Şimdi: telefonun arka kamerası açılır → QR / Code 128 (bizim kol bandı ve kimlik bandı barkodları, barkod.js) okunur →
 * okunan değer hasta no (HN-…), protokol (2026-…) ya da yatak koduyla eşleştirilir → hasta ekrana gelir.
 * Çözücü: tarayıcının kendi BarcodeDetector'ı (Android Chrome); yoksa ZXing (iPhone Safari). Kamera yalnız güvenli (https)
 * adreste açılır; açılamazsa numarayı elle yazma yolu hep vardır. Görüntü hiçbir yere gönderilmez, kaydedilmez. */
(function () {
  "use strict";
  const H = window.H, I = (k) => H.icon(k), esc = (s) => H.esc(String(s == null ? "" : s));
  H.addT({
    sc_title:{ AZ:"Qolbağını oxut", TR:"Bilekliği okut", RU:"Сканировать браслет", EN:"Scan wristband" },
    sc_aim:{ AZ:"Kameranı qolbaqdakı barkoda və ya QR koda tutun", TR:"Kamerayı bileklikteki barkoda ya da QR koda tutun", RU:"Наведите камеру на штрихкод или QR-код браслета", EN:"Point the camera at the wristband barcode or QR code" },
    sc_start:{ AZ:"Kamera açılır…", TR:"Kamera açılıyor…", RU:"Камера включается…", EN:"Starting camera…" },
    sc_insecure:{ AZ:"Kamera bu ünvanda açılmır: təhlükəsiz (https) bağlantı lazımdır. Nömrəni aşağıda yazın.", TR:"Kamera bu adreste açılmaz: güvenli (https) bağlantı gerekir. Numarayı aşağıya yazın.", RU:"Камера не открывается на этом адресе: нужно защищённое (https) соединение. Введите номер ниже.", EN:"The camera can't open on this address: a secure (https) connection is needed. Type the number below." },
    sc_denied:{ AZ:"Kameraya icazə verilmədi. Parametrlərdən icazə verin və ya nömrəni yazın.", TR:"Kameraya izin verilmedi. Ayarlardan izin verin ya da numarayı yazın.", RU:"Нет доступа к камере. Разрешите в настройках или введите номер.", EN:"Camera access was denied. Allow it in settings or type the number." },
    sc_manual:{ AZ:"Və ya nömrəni yazın: xəstə №, protokol və ya çarpayı", TR:"Ya da numarayı yazın: hasta no, protokol ya da yatak", RU:"Или введите номер: № пациента, протокол или койку", EN:"Or type the number: patient no., protocol or bed" },
    sc_find:{ AZ:"Tap", TR:"Bul", RU:"Найти", EN:"Find" },
    sc_nf:{ AZ:"Bu kodla xəstə tapılmadı: {c}", TR:"Bu kodla hasta bulunamadı: {c}", RU:"Пациент с этим кодом не найден: {c}", EN:"No patient found for this code: {c}" },
    sc_scope:{ AZ:"Bu xəstə sizin şöbələrinizdə deyil. Cəhd qeydə alındı.", TR:"Bu hasta sizin birimlerinizde değil. Deneme kayda geçti.", RU:"Этот пациент не в ваших отделениях. Попытка записана.", EN:"This patient isn't in your units. The attempt was logged." },
    sc_read:{ AZ:"Oxundu", TR:"Okundu", RU:"Считано", EN:"Read" },
    sc_nfc:{ AZ:"NFC etiketinə toxunun", TR:"NFC etiketine dokunun", RU:"Приложите к NFC-метке", EN:"Tap the NFC tag" },
    sc_nfc_wait:{ AZ:"Telefonu çarpayı etiketinə yaxınlaşdırın…", TR:"Telefonu yatak etiketine yaklaştırın…", RU:"Поднесите телефон к метке кровати…", EN:"Hold the phone near the bed tag…" },
    sc_drug:{ AZ:"Dərmanın barkodunu oxut", TR:"İlacın barkodunu okut", RU:"Сканировать штрихкод препарата", EN:"Scan the drug barcode" },
    sc_torch:{ AZ:"İşıq", TR:"Işık", RU:"Фонарь", EN:"Light" },
  });

  const norm = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, "");
  // okunan değer → hasta. Kabul: HN-0250137 · 0250137 · 2026-103929 · REA01 · QR içinde "HN:…" ya da "P:…" alanları
  function match(code) {
    const c = norm(code), all = H.data.patients;
    const parts = c.split(/[|;,]/).map(x => x.replace(/^(HN|P|PROT|PROTOKOL|BED|YATAK)[:=]/, ""));
    for (const x of [c, ...parts]) {
      const p = all.find(q => (H.hnOf && norm(H.hnOf(q)) === x) || (H.hnOf && norm(H.hnOf(q)).replace("HN-", "") === x) || (H.protoOf && norm(H.protoOf(q)) === x)
        || norm(q.id) === x || (H.bed(q.bed) && norm(H.bed(q.bed).no) === x));
      if (p) return p;
    }
    return null;
  }

  let stream = null, raf = 0, reader = null, done = false;
  function stop() { done = true; cancelAnimationFrame(raf); raf = 0; try { reader && reader.reset && reader.reset(); } catch (e) {} reader = null;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } const o = document.querySelector(".scn"); if (o) o.remove(); }
  const loadZXing = () => window.ZXing ? Promise.resolve(window.ZXing) : new Promise((ok, no) => { const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js"; s.onload = () => ok(window.ZXing); s.onerror = no; document.head.appendChild(s); });

  function open(onPatient, opt) {
    opt = opt || {};
    stop(); done = false;
    const o = document.createElement("div"); o.className = "scn"; o.setAttribute("role", "dialog");
    o.innerHTML = `<div class="scn-top"><b>${esc(opt.title || H.t("sc_title"))}</b><button type="button" class="scn-x" data-scx aria-label="×">${I("x")}</button></div>
      <div class="scn-cam"><video playsinline muted autoplay></video><div class="scn-frame"><i></i><i></i><i></i><i></i><span class="scn-line"></span></div></div>
      <div class="scn-st" data-scst>${esc(H.t("sc_start"))}</div>
      <form class="scn-man" data-scman><label>${esc(H.t("sc_manual"))}</label><div><input name="c" autocomplete="off" autocapitalize="characters" inputmode="text" placeholder="${esc(opt.ph || "HN-0250137 · 2026-103929 · REA01")}"><button class="btn p">${esc(H.t("sc_find"))}</button></div></form>`;
    document.body.appendChild(o);
    const st = o.querySelector("[data-scst]"), video = o.querySelector("video");
    const found = (code, how) => {
      if (done) return;
      if (opt.raw) { if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) {} stop(); return onPatient(String(code)); }
      const p = match(code);
      if (!p) { st.textContent = H.t("sc_nf").replace("{c}", code); st.classList.add("bad"); H.log("bileklik okutma · eşleşmedi", code); return; }
      if (!H.inScope(p.id)) { st.textContent = H.t("sc_scope"); st.classList.add("bad"); H.log("bileklik okutma · kapsam dışı", p.id); return; }
      if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) {}
      H.log("bileklik okutuldu (" + how + ")", p.id); stop(); onPatient(p);
    };
    o.addEventListener("click", e => { if (e.target.closest("[data-scx]")) stop(); });
    if ("NDEFReader" in window && window.isSecureContext && !opt.raw) {
      const nb = document.createElement("button"); nb.type = "button"; nb.className = "btn scn-nfc"; nb.textContent = H.t("sc_nfc");
      o.querySelector("[data-scman]").before(nb);
      nb.onclick = async () => { try { const r = new window.NDEFReader(); await r.scan(); st.textContent = H.t("sc_nfc_wait");
        r.onreading = (ev) => { for (const rec of ev.message.records) { try { const txt = new TextDecoder(rec.encoding || "utf-8").decode(rec.data); return found(txt, "NFC"); } catch (e) {} } found(ev.serialNumber || "", "NFC"); }; }
        catch (e) { st.textContent = H.t("sc_denied"); } };
    }
    o.querySelector("[data-scman]").addEventListener("submit", e => { e.preventDefault(); const v = e.target.c.value; if (v.trim()) found(v, "elle"); });

    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { o.classList.add("nocam"); st.textContent = H.t("sc_insecure"); return; }
    navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:"environment" }, width:{ ideal:1280 } }, audio:false }).then(async (s) => {
      if (done) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s; video.srcObject = s; await video.play().catch(() => {}); st.textContent = H.t("sc_aim");
      if ("BarcodeDetector" in window) {
        const bd = new window.BarcodeDetector({ formats:["qr_code", "code_128", "code_39", "ean_13", "data_matrix"] });
        const tick = async () => { if (done) return; try { const r = await bd.detect(video); if (r && r[0]) return found(r[0].rawValue, "kamera"); } catch (e) {} raf = requestAnimationFrame(tick); };
        tick();
      } else {
        const Z = await loadZXing().catch(() => null); if (!Z || done) { if (!Z) st.textContent = H.t("sc_manual"); return; }
        const hints = new Map(); hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.DATA_MATRIX]);
        reader = new Z.MultiFormatReader(); reader.setHints(hints);
        const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently:true });
        let last = 0;
        const tick = (ts) => { if (done) return; raf = requestAnimationFrame(tick); if (ts - last < 180 || !video.videoWidth) return; last = ts;
          const w = Math.min(960, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth); cv.width = w; cv.height = h; cx.drawImage(video, 0, 0, w, h);
          try { const lum = new Z.HTMLCanvasElementLuminanceSource(cv), bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(lum)); const r = reader.decode(bmp); if (r) found(r.getText(), "kamera"); } catch (e) { /* bu karede kod yok */ } };
        raf = requestAnimationFrame(tick);
      }
    }).catch(() => { o.classList.add("nocam"); st.textContent = H.t("sc_denied"); });
  }
  H.scanner = { open, match, stop };
})();

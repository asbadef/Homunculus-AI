/*
  anasayfa/gorsel/cek.cjs — tanıtım sayfasının "Neler var" görsellerini prototipten OTOMATİK çeker.

  Ürün değiştiğinde görselleri yenilemek için (cmd.exe):
      cd C:\Dev\Homunculus\tasarim-taslaklari\anasayfa\gorsel
      node cek.cjs

  Önkoşul: prototip sunucusu açık olmalı → http://localhost:5199/app/ (tasarim-taslaklari\sunucu.py).
  Bağımlılık yok: Node 22+ (yerleşik fetch + WebSocket) ve Chrome yeterli.

  Ne yapar: Chrome'u başsız (--headless=new) ve geçici profille açar, CDP ile sürer. Her ekran için
  doğru rolle "Hızlı giriş" yapar, H.go(...) ile ekrana gider, çizilmesini bekler ve sol menüyü dışarıda
  bırakarak içerik alanını (üst çubuk + ekran) WebP olarak kaydeder:
      <ekran>-<dil>-<tema>.webp     dil: AZ TR RU EN · tema: gun gece     (15 ekran × 4 dil × 2 tema = 120 dosya)
  Liste parca/neler.js içindeki ekran anahtarlarıyla birebir aynıdır; birini değiştirirsen ötekini de değiştir.

  Seçenekler (isteğe bağlı):
      node cek.cjs --only skor,wall      yalnız bu ekranlar
      node cek.cjs --lang TR --theme gun yalnız bu dil / tema
      node cek.cjs --url http://localhost:5199/app/

  Veri: prototipin SENTETİK verisidir. Tanıtımda gerçek kişi izlenimi vermesin diye hasta ve personel
  adları çekim sırasında baş harflere indirilir (yalnız bu tarayıcı oturumunda; app\ dosyalarına dokunulmaz).
*/
const { spawn } = require("child_process"), fs = require("fs"), path = require("path"), os = require("os");

const OUT = __dirname, PORT = 9371, W = 1440, H_ = 900, QUALITY = 80, MASK_NAMES = true;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const arg = (k) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : null; };
const APP = arg("url") || "http://localhost:5199/app/";
const LANGS = (arg("lang") || "AZ,TR,RU,EN").split(",").map(s => s.trim().toUpperCase());
const THEMES = (arg("theme") || "gun,gece").split(",").map(s => s.trim());
const ONLY = arg("only") ? arg("only").split(",") : null;

/* Ekranlar. key = dosya adı ve neler.js'teki anahtar. user = hızlı giriş hesabı (rolü ekrana yetkili olan).
   go = H.go(sayfa, parametre). bed → o yataktaki hastanın pid'i parametreye eklenir. unit → birim kapsamı (null = tümü).
   prep = ekran çizildikten sonra sayfada çalışan küçük hazırlık (ör. bir sekmeyi açmak). */
// hasta ekranı: üstteki kimlik + monitör şeridi yerine seçili sekmenin içeriği görünsün
const TABS_TOP = `(() => { const t = document.querySelector(".content .tabs"); if (t) t.scrollIntoView({ block:"start" }); return true; })()`;
const SHOTS = [
  // Hekim
  { key:"unitdash", user:"dr.kamran",     go:["unitdash"], unit:"rea" },
  { key:"skor",     user:"dr.kamran",     go:["patient", { tab:"skor" }], bed:"rea-2", prep:TABS_TOP },
  { key:"alarms",   user:"dr.kamran",     go:["alarms"] },
  { key:"rrt",      user:"rrt.emil",      go:["rrt"] },
  { key:"wall",     user:"dr.kamran",     go:["wall"], unit:"rea" },
  // Hemşire
  { key:"tasks",    user:"hs.sevda",      go:["tasks"] },
  { key:"bakim",    user:"hs.sevda",      go:["patient", { tab:"bakim" }], bed:"rea-1", prep:TABS_TOP },
  // yatak başı: kimlik adımı boş görünüyor → kimliği onayla, portatif cihazla ölç, hemşirenin girdiği alanları doldur (NEWS2 hesaplansın)
  { key:"bedside",  user:"hs.sevda",      go:["bedside"], bed:"rea-2", prep:`(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), c = s => { const e = document.querySelector(s); if (e) e.click(); return !!e; };
      const until = async (s, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (document.querySelector(s)) return true; await w(150); } return false; };
      await until('[data-bs="idok"]'); c('[data-bs="idok"]'); await until('[data-bs="dev"]'); c('[data-bs="dev"]');
      if (!(await until('[data-bs-f="rr"]'))) return "ölçüm adımı açılmadı";
      const rr = document.querySelector('[data-bs-f="rr"]'); rr.value = "22"; rr.dispatchEvent(new Event("input", { bubbles:true }));
      // ikinci temada durum korunuyor: seçili olana yeniden tıklamak seçimi kaldırır
      if (!document.querySelector('[data-bs-acv="A"].on')) c('[data-bs-acv="A"]'); await w(300); if (!document.querySelector('[data-bs-o2="Ek oksijen"].on')) c('[data-bs-o2="Ek oksijen"]'); await w(300);
      return /NEWS2/.test(document.querySelector(".content").innerText) && !!document.querySelector('[data-bs-acv="A"].on') ? true : "NEWS2 hesaplanmadı"; })()` },
  { key:"portatif", user:"rrt.emil",      go:["patient", { tab:"ozet" }], bed:"aci-3" },
  { key:"hand",     user:"hs.sevda",      go:["hand"] },
  // Kurum
  { key:"admission",user:"kabul.ulviyye", go:["occupancy"] },
  { key:"workload", user:"hs.sevda",      go:["workload"] },
  { key:"devices",  user:"bio.orxan",     go:["devices"] },
  // pilot ekranı bugün boş bir başlangıç şablonu ("ölçüm başlamadı") → yerine dolu kalite göstergeleri
  { key:"quality",  user:"mudur.rauf",    go:["quality"] },
  // rol kartları (ana sayfa "Kim ne görür") için eczane ve yönetim özeti
  { key:"pharmacy", user:"ecz.lale",      go:["pharmacy"] },
  { key:"summary",  user:"mudur.rauf",    go:["summary"] },
  // Yönetim: "Roller" sekmesi iç yetki anahtarlarını (pt_ozet…) gösteriyor, "Denetim kaydı" ayrıntısında maskelenmeyen
  // tam hasta adları var → tanıtım için "Kullanıcılar" (rol, birim, 2FA, son giriş) sekmesi
  { key:"users",    user:"admin",         go:["admin", { tab:"users" }] },
].filter(s => !ONLY || ONLY.includes(s.key));

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (typeof WebSocket === "undefined") { console.error("Bu betik Node 22+ ister (yerleşik WebSocket)."); process.exit(1); }
  try { const r = await fetch(APP, { method:"GET" }); if (!r.ok) throw new Error("HTTP " + r.status); }
  catch (e) { console.error("Prototip açılmıyor: " + APP + " (" + e.message + "). Önce sunucuyu başlat."); process.exit(1); }

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "hmc-cek-"));
  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + prof, "--no-first-run",
    "--no-default-browser-check", "--hide-scrollbars", "--window-size=" + W + "," + H_, "about:blank"], { stdio:"ignore" });
  const done = (code) => { try { chrome.kill(); } catch (e) {} setTimeout(() => { try { fs.rmSync(prof, { recursive:true, force:true }); } catch (e) {} process.exit(code); }, 600); };

  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) { try { const j = await (await fetch("http://127.0.0.1:" + PORT + "/json")).json(); const p = j.find(x => x.type === "page"); if (p) wsUrl = p.webSocketDebuggerUrl; } catch (e) {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) { console.error("Chrome'a bağlanılamadı (port " + PORT + ")."); return done(1); }
  const sock = new WebSocket(wsUrl); await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
  let id = 0; const pend = {}, errs = [];
  sock.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
    if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errs.push(m.params.args.map(a => a.value ?? a.description).join(" ")); };
  // sayfa yeniden yüklenirken bir CDP çağrısı yanıtsız kalabiliyor → 25 sn sonra hata olarak dön, betik takılmasın
  const send = (method, params = {}) => new Promise(r => { const i = ++id;
    const to = setTimeout(() => { if (pend[i]) { delete pend[i]; r({ result:{ exceptionDetails:{ text:"CDP zaman aşımı: " + method } } }); } }, 25000);
    pend[i] = (m) => { clearTimeout(to); r(m); }; sock.send(JSON.stringify({ id:i, method, params })); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression:expr, returnByValue:true, awaitPromise:true });
    if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text); return r.result.result.value; };
  const waitFor = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(120); } return false; };

  await send("Runtime.enable"); await send("Page.enable");
  // her yüklemede: yüklenemeyen <script> sayacı
  await send("Page.addScriptToEvaluateOnNewDocument", { source:"window.__cekBad = 0; addEventListener('error', e => { if (e.target && e.target.tagName === 'SCRIPT') window.__cekBad++; }, true);" });
  await send("Emulation.setDeviceMetricsOverride", { width:W, height:H_, deviceScaleFactor:1, mobile:false });
  await send("Emulation.setEmulatedMedia", { features:[{ name:"prefers-reduced-motion", value:"reduce" }] });

  // Çekimi bozan geçici katmanlar: bildirim baloncukları, kilit uyarısı, "başa dön", animasyonlar.
  const HIDE_CSS = ".toasts,.idlewarn,.toTop,.pwa-bar,.ck{display:none!important} *,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}";
  const MASK_JS = `(() => {
    const ini = (s) => String(s).replace(/\\(.*?\\)/g, "").trim().split(/\\s+/).filter(Boolean).map(w => w[0].toUpperCase() + ".").slice(0, 2).join(" ");
    H.data.patients.forEach(p => { if (!p.__m) { p.name = ini(p.name); p.__m = 1; } });
    H.data.users.forEach(u => { if (!u.__m) { const pre = (u.name.match(/^(Dr\\.|Ecz\\.)\\s*/) || [""])[0]; u.name = pre + ini(u.name.slice(pre.length)); u.__m = 1; } });
  })()`;

  const users = [...new Set(SHOTS.map(s => s.user))];
  const NEED = [...new Set(SHOTS.map(s => s.go[0]).concat(["settings", "beds"]))];
  let n = 0, bytes = 0; const miss = [];
  for (const lang of LANGS) for (const user of users) { try {
    // temiz başlangıç: dil ve tema tercihini yaz, sayfayı yeniden yükle
    // Yerel sunucu yük altında ara sıra bir .js isteğini düşürüyor (yanıt 0) → o modülün ekranları eksik kalır.
    // Bu yüzden: bütün betikler yüklenene ve gereken sayfalar kaydolana kadar en çok 6 kez yeniden yükle.
    let booted = false;
    for (let tr = 0; tr < 6 && !booted; tr++) {
      await send("Page.navigate", { url:APP + "?cek=" + Date.now() });
      await waitFor("document.readyState === 'complete' && !!window.H", 30000);
      await ev(`localStorage.clear(); localStorage.setItem("hmc.lang", ${JSON.stringify(lang)}); localStorage.setItem("hmc.theme", "gun"); localStorage.setItem("hmc.cookieNote", "1"); true`);
      await send("Page.reload", { ignoreCache:true });
      booted = await waitFor(`document.readyState === 'complete' && window.__cekBad === 0 && !!window.H && ${JSON.stringify(NEED)}.every(k => !!H.pages[k]) && !!document.querySelector('[data-demo]')`, 30000);
      if (!booted) process.stdout.write(`  (yükleme eksik, yeniden deneniyor: ${lang} · ${user})\n`);
    }
    if (!booted) { miss.push(lang + " · " + user + ": uygulama tam yüklenmedi"); continue; }
    await ev(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(HIDE_CSS)}; document.head.appendChild(s); return true; })()`);
    if (MASK_NAMES) await ev(MASK_JS);
    const ok = await ev(`(() => { const b = document.querySelector('[data-demo="${user}"]'); if (!b) return false; b.click(); return true; })()`);
    if (!ok || !(await waitFor("!!H.state.user && !!document.querySelector('.shell .content')"))) { miss.push(lang + " · " + user + ": giriş olmadı"); continue; }
    await sleep(400);
    for (const theme of THEMES) for (const s of SHOTS.filter(x => x.user === user)) {
      const params = Object.assign({}, s.go[1] || {});
      const r = await ev(`(() => {
        H.state.theme = ${JSON.stringify(theme)}; H.savePref("theme", H.state.theme); document.body.dataset.theme = H.state.theme;
        H.state.unitId = ${JSON.stringify(s.unit || null)};
        const params = ${JSON.stringify(params)};
        ${s.bed ? `const p = H.ptByBed(${JSON.stringify(s.bed)}); if (!p) return "yatakta hasta yok: ${s.bed}"; params.pid = p.id;` : ""}
        H.go(${JSON.stringify(s.go[0])}, params);
        return H.state.page === ${JSON.stringify(s.go[0])} ? "ok" : "sayfa açılmadı (yetki?): " + H.state.page;
      })()`);
      if (r !== "ok") { miss.push(`${s.key} ${lang} ${theme}: ${r}`); continue; }
      await sleep(700);
      if (s.prep) { try { const pr = await ev(s.prep); if (pr !== true) miss.push(`${s.key} ${lang} ${theme}: hazırlık eksik — ${pr} (görsel yine yazıldı, kontrol et)`); } catch (e) { miss.push(`${s.key}: prep ${e.message}`); } await sleep(400); }
      await ev("document.fonts ? document.fonts.ready.then(() => true) : true");
      // grafikler requestAnimationFrame ile çizilebilir: iki kare bekle
      await ev("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))");
      const box = await ev(`(() => { const m = document.querySelector(".shell .main"); if (!m) return null; const b = m.getBoundingClientRect(); return { x:b.left, y:b.top, w:b.width, h:Math.min(b.height, ${H_}) }; })()`);
      if (!box) { miss.push(`${s.key} ${lang} ${theme}: uygulama kabuğu yok (kilit ekranı?) — bu dosya için betiği yeniden çalıştır`); continue; }
      const shot = await send("Page.captureScreenshot", { format:"webp", quality:QUALITY, clip:{ x:box.x, y:box.y, width:box.w, height:box.h, scale:1 } });
      if (!shot.result || !shot.result.data) { miss.push(`${s.key} ${lang} ${theme}: ekran görüntüsü alınamadı`); continue; }
      const buf = Buffer.from(shot.result.data, "base64"), file = `${s.key}-${lang}-${theme}.webp`;
      fs.writeFileSync(path.join(OUT, file), buf); n++; bytes += buf.length;
      process.stdout.write(`  ${file}  ${Math.round(box.w)}×${Math.round(box.h)}  ${(buf.length / 1024).toFixed(0)} KB\n`);
    }
  } catch (e) { miss.push(lang + " · " + user + ": " + e.message); } }
  console.log(`\n${n} görsel yazıldı · toplam ${(bytes / 1048576).toFixed(2)} MB · ${OUT}`);
  if (miss.length) console.log("Çekilemeyenler:\n  " + miss.join("\n  "));
  if (errs.length) console.log("Sayfa hataları (ilk 10):\n  " + [...new Set(errs)].slice(0, 10).join("\n  "));
  sock.close(); done(miss.length ? 2 : 0);
})();

/* Homunculus · çeviri katmanı (prototip) · 25.09.2026
 * Sorun (ölçüldü 24–25.09): ekranlardaki metinlerin bir kısmı koda Türkçe gömülü; H.t() anahtarı yok, dil değişince
 * Türkçe kalıyor. Varsayılan dil Azerbaycanca olduğu için bu metinler AZ kullanıcıya da Türkçe görünüyordu.
 * Çözüm (prototip için): ekrana gelen her metin, Türkçe kaynak → AZ/RU/EN sözlüğünde (ceviri-sozluk.js) aranır.
 * Sayılar kalıptan ayrılır: "6 geciken iş" ve "3 geciken iş" aynı "{#} geciken iş" girdisini kullanır.
 * Gerçek üründe doğru yol anahtar tabanlı çeviridir (H.t); bu katman o geçiş yapılana kadar boşluğu kapatır.
 * Dokunulmayan yerler: kullanıcının yazdığı alanlar (input, textarea, contenteditable) ve [data-notr] işaretli öğeler. */
(function () {
  "use strict";
  const H = window.H, D = window.HMC_SOZLUK || {};
  const NUM = /\d+(?:[.,:]\d+)*/g;
  const ATTR = ["placeholder", "title", "aria-label"];
  const SKIP = "script,style,textarea,input,select,option,[contenteditable=true],[data-notr]";
  const WILD = Object.keys(D).filter(k => k.includes("{*}")).map(k => ({ e:D[k],
    re:new RegExp("^" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\{\\*\\}", "(.+)") + "$") }));

  // bir metnin karşılığı: yoksa null
  function tr(s, lang) {
    const t = s.trim(); if (!t || t.length < 2) return null;
    const nums = t.match(NUM) || [], k = t.replace(NUM, "{#}");
    let e = D[k], tpl = e && e[lang];
    if (!tpl) {   // jokerli kalıp: "Hoş geldiniz, {*}" → ad olduğu gibi taşınır
      for (const w of WILD) { const m = w.re.exec(k); if (m && w.e[lang]) { tpl = w.e[lang].replace("{*}", m[1]); break; } }
      if (!tpl) return null;
    }
    let i = 0; let out = tpl.replace(/\{#\}/g, () => (i < nums.length ? nums[i++] : ""));
    if (lang === "AZ") out = out.replace(/(\d+)-c[iıuü]\b/g, (m, d) => d + "-" + azSira(d));
    return out === t ? null : s.replace(t, out);
  }
  // Azerbaycanca sıra eki sayının okunuşuna uyar: 1-ci 2-ci 3-cü 4-cü 5-ci 6-cı 7-ci 8-ci 9-cu 10-cu 20-ci 30-cu 40-cı … 100-cü
  function azSira(d) {
    const n = parseInt(d, 10), U = ["", "ci", "ci", "cü", "cü", "ci", "cı", "ci", "ci", "cu"], T = ["", "cu", "ci", "cu", "cı", "ci", "cı", "ci", "ci", "cı"];
    if (n % 10) return U[n % 10];
    if (n % 100) return T[(n % 100) / 10];
    return n % 1000 ? "cü" : "ci";
  }
  H.ceviri = { tr, sayi:() => Object.keys(D).length };

  function textNode(n, lang) {
    if (n.__hmc === n.nodeValue) return;           // zaten çevrildi (kendi yazdığımız değer)
    const el = n.parentElement; if (!el || el.closest(SKIP)) return;
    const r = tr(n.nodeValue, lang); if (r != null) { n.nodeValue = r; n.__hmc = r; }
  }
  function element(el, lang) {
    if (el.closest && el.closest(SKIP) && !/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.tagName)) return;
    ATTR.forEach(a => { const v = el.getAttribute && el.getAttribute(a); if (!v || el["__hmc_" + a] === v) return;
      const r = tr(v, lang); if (r != null) { el.setAttribute(a, r); el["__hmc_" + a] = r; } });
    if (el.tagName === "OPTION") { const r = tr(el.textContent, lang); if (r != null) el.textContent = r; }
  }
  function walk(root, lang) {
    if (!root) return;
    if (root.nodeType === 3) return textNode(root, lang);
    if (root.nodeType !== 1) return;
    element(root, lang);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) textNode(n, lang); else element(n, lang); }
  }

  const lang = () => (H.state && H.state.lang) || "AZ";
  let pending = new Set(), raf = 0;
  function flush() { raf = 0; const L = lang(); if (L === "TR") { pending.clear(); return; }
    const list = [...pending]; pending.clear(); list.forEach(n => { if (n.isConnected) walk(n, L); }); }
  // değişiklik gözlemcisi mikro-görevde çalışır: çeviri, tarayıcı ekranı çizmeden önce biter (Türkçe metin bir an bile görünmez)
  const queue = (n) => { pending.add(n); };
  if (window.MutationObserver) new MutationObserver(ms => {
    if (lang() === "TR") return;
    ms.forEach(m => {
      if (m.type === "childList") m.addedNodes.forEach(queue);
      else if (m.type === "characterData") { if (m.target.__hmc !== m.target.nodeValue) queue(m.target); }
      else if (m.type === "attributes" && ATTR.includes(m.attributeName)) queue(m.target);
    });
    flush();
  }).observe(document.body, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:ATTR });
  // ilk çizim bu dosyadan önce oldu: bir kez tamamını çevir
  if (lang() !== "TR") walk(document.body, lang());
})();

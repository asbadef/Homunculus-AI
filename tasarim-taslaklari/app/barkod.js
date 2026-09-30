/* Homunculus · barkod (barkod.js) — 24.09.2026
 * Bağımlılıksız Code 128 üreticisi (ASCII 32–126). B alt kümesi + rakam dizilerinde C alt kümesi (daha kısa barkod).
 * Çıktı satır içi SVG + altında okunur metin.
 *   H.barcode.encode(text, { b:true }?) → { codes:[başlangıç, veri…, sağlama, bitiş], widths:"2112…", modules:n, check } | null (kodlanamayan karakter varsa)
 *   H.barcode.svg(text, { x:0.254, h:8, quiet:10, label:true, cls:"", b:false }) → HTML dizesi (kodlanamazsa yalnız metin)
 *     x: modül (en ince çubuk) genişliği mm · 0.254 mm = 300 dpi'de 3, 600 dpi'de 6 nokta, yuvarlama bozulması olmaz
 *     h: çubuk yüksekliği mm · quiet: iki yandaki sessiz bölge, modül cinsinden (standart en az 10)
 * Sağlama: (başlangıç + Σ değer_i × i) mod 103, i = 1…n. Doğrulama: python-barcode 0.16.1 ile karşılaştırıldı ("Wikipedia" → sağlama 88,
 * bit bit aynı); C alt kümeli kodlama 19 örneğin 17'sinde kütüphaneyle aynı, 19'unda bağımsız çözücüyle geri okunuyor.
 * Çubuklar tek <path> olarak, shape-rendering="crispEdges" ile çizilir; SVG mm cinsinden boyutlanır, yazıcıda ölçek sabittir. */
(function () {
  const H = window.H;
  if (!H) return;

  // 0…106 · her desen çubuk/boşluk genişlikleri (modül); 106 = bitiş (7 öğe, 13 modül)
  const P = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
    "123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 " +
    "111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 " +
    "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 " +
    "141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 " +
    "124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 " +
    "311141 411131 211412 211214 211232 2331112").split(" ");
  const START_B = 104, STOP = 106;

  // Alt küme seçimi (auto): 4 ve daha uzun rakam dizisi C alt kümesiyle çift çift kodlanır (barkod ~%20 kısalır);
  // tek kalan rakam ve diğer karakterler B'de. Başlangıçta 4+ rakam varsa C ile başlanır. o.b === true → yalnız B.
  const START_C = 105, TO_C = 99, TO_B = 100;
  const digitRun = (s, i) => { let n = 0; while (i + n < s.length && s[i + n] >= "0" && s[i + n] <= "9") n++; return n; };
  function symbols(s, onlyB) {
    for (const ch of s) { const c = ch.codePointAt(0); if (c < 32 || c > 126) return null; }
    if (onlyB) return [START_B, ...[...s].map(ch => ch.charCodeAt(0) - 32)];
    let i = 0, set = digitRun(s, 0) >= 4 ? "C" : "B";
    const out = [set === "C" ? START_C : START_B];
    while (i < s.length) {
      const run = digitRun(s, i);
      if (set === "C") {
        if (run >= 2) { out.push(+s.substr(i, 2)); i += 2; continue; }
        out.push(TO_B); set = "B"; continue;
      }
      if (run >= 4) { out.push(TO_C); set = "C"; continue; }
      out.push(s.charCodeAt(i) - 32); i++;
    }
    return out;
  }

  function encode(text, o = {}) {
    const s = String(text ?? "");
    if (!s.length) return null;
    const head = symbols(s, o.b === true);
    if (!head) return null;
    let sum = head[0]; head.slice(1).forEach((v, i) => { sum += v * (i + 1); });
    const check = sum % 103;
    const codes = [...head, check, STOP];
    const widths = codes.map(c => P[c]).join("");
    let modules = 0; for (const w of widths) modules += +w;
    return { codes, widths, modules, check };
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[c]);

  function svg(text, o = {}) {
    const x = o.x || 0.254, h = o.h || 8, q = o.quiet == null ? 10 : o.quiet, label = o.label !== false;
    const e = encode(text, o);
    const txt = label ? `<span class="bc-t">${esc(text)}</span>` : "";
    if (!e) return `<span class="bc bc-none ${o.cls || ""}">${txt}</span>`;
    let pos = q, d = "", bar = true;
    for (const w of e.widths) { const n = +w; if (bar) d += `M${pos} 0h${n}v1h-${n}z`; pos += n; bar = !bar; }
    const W = e.modules + 2 * q;
    // viewBox yüksekliği 1 birim; preserveAspectRatio="none" ile mm cinsinden yüksekliğe gerilir (çubuklar dikeyde bölünmez).
    return `<span class="bc ${o.cls || ""}"><svg class="bc-s" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 1" preserveAspectRatio="none" width="${(W * x).toFixed(2)}mm" height="${h}mm" shape-rendering="crispEdges" role="img" aria-label="${esc(text)}"><path fill="#000" d="${d}"/></svg>${txt}</span>`;
  }

  H.barcode = { encode, svg, patterns:P };
})();

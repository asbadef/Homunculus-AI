/* Homunculus · sosyal medya ve iletişim bağlantıları (24.09, 3. oturum · Ozan #88).
 * Karar: hesaplar sonradan açılacak; ikonlar şimdiden yerinde durur. Yönetim → Sistem ayarları'nda bağlantı girilince
 * o ikon AKTİF olur (tıklanır, renklenir); girilmemiş ikon soluk ve tıklanamaz. Bağlantılar bu tarayıcıda saklanır.
 * Dışa: H.social = { list, get(), set(k, url), iconsHtml(cls), editorHtml(), bind(el) } */
(function () {
  const H = window.H;
  const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const LIST = [
    ["whatsapp", "WhatsApp", "https://wa.me/994…", P('<path d="M20 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.2A8.5 8.5 0 1 1 20 11.5Z"/><path d="M9 8.5c.3 2.6 2.4 4.9 5 5.5l1.2-1.2 1.8.8-.4 1.6c-3.8.2-7.8-3.6-7.6-7.6l1.6-.4.8 1.8Z"/>')],
    ["instagram", "Instagram", "https://instagram.com/…", P('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>')],
    ["youtube", "YouTube", "https://youtube.com/@…", P('<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10 9 5 3-5 3Z"/>')],
    ["linkedin", "LinkedIn", "https://linkedin.com/company/…", P('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/>')],
    ["x", "X", "https://x.com/…", P('<path d="M4 4l16 16M20 4 4 20"/>')],
    ["web", "Web", "https://…", P('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>')],
  ];
  const load = () => { try { return JSON.parse(localStorage.getItem("hmc.social") || "{}"); } catch { return {}; } };
  let S = load();
  const ok = (u) => /^https?:\/\/[^\s…]+\.[^\s…]+/.test(u || "");
  H.social = {
    list:LIST, get:() => S,
    set(k, url) { url = String(url || "").trim(); if (url && !ok(url)) return false; if (url) S[k] = url; else delete S[k]; try { localStorage.setItem("hmc.social", JSON.stringify(S)); } catch {} H.log("Sosyal bağlantı", `${k}: ${url || "kaldırıldı"}`); return true; },
    iconsHtml(cls = "") { return `<div class="soc ${cls}">${LIST.map(([k, n, , ic]) => S[k] ? `<a class="on s-${k}" href="${H.esc(S[k])}" target="_blank" rel="noopener" title="${n}">${ic}</a>` : `<span class="s-${k}" title="${n}">${ic}</span>`).join("")}</div>`; },
    editorHtml() {
      return `<div class="box" style="margin-top:12px"><h5>${H.icon("globe")} Sosyal medya ve web <span class="r"><span class="tag">${Object.keys(S).length} / ${LIST.length} aktif</span></span></h5>
        <p class="adm-sub" style="margin:0 0 10px">Bağlantı girilen ikon giriş ekranında ve yasal sayfalarda aktif olur; boş bırakılan soluk kalır.</p>
        <div class="soc-ed">${LIST.map(([k, n, ph, ic]) => `<label class="soc-row"><span class="soc-ic${S[k] ? " on" : ""} s-${k}">${ic}</span><b>${n}</b><input data-soc="${k}" value="${H.esc(S[k] || "")}" placeholder="${ph}" inputmode="url"></label>`).join("")}</div>
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px">${H.social.iconsHtml("pv")}<span class="spacer"></span><button class="btn p sm" data-soc-save>${H.icon("ok")}Bağlantıları uygula</button></div></div>`;
    },
    bind(el) {
      el.addEventListener("click", (e) => { if (!e.target.closest("[data-soc-save]")) return;
        const bad = []; el.querySelectorAll("[data-soc]").forEach(i => { if (!H.social.set(i.dataset.soc, i.value)) bad.push(i.dataset.soc); i.classList.toggle("adm-err", bad.includes(i.dataset.soc)); });
        if (bad.length) return H.toast("Geçersiz bağlantı: " + bad.join(", ") + " (https:// ile başlamalı)", "e");
        H.toast("Bağlantılar uygulandı"); const box = e.target.closest(".box"); if (box) { box.outerHTML = H.social.editorHtml(); } });
    },
  };
})();

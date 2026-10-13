import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Bu paketin hangi koddan çıktığı.
 *
 * Panelde çalışan sürüm hiçbir yerde yazmıyordu: 20.09.2026'da pilotta hangi sürümün canlı
 * olduğu ancak dosya adındaki karma değere bakılarak anlaşıldı. Bir hastane sisteminde bu,
 * hata ayıklamanın ilk adımıdır — "sizde hangi sürüm var" sorusunun cevabı ekranda olmalı.
 *
 * Docker imajı `.git` olmadan derlenebilir; o durumda uydurulmaz, "bilinmiyor" denir.
 */
function gitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(gitSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      // What a ward gets when it adds this to a tablet's home screen. start_url was "/?demo=1",
      // left over from before the bare URL became the live system: the installed icon opened the
      // SIMULATION, and the description said so while the app itself is the real one. An icon
      // installed before then keeps opening "/?demo=1" until the browser re-reads this manifest;
      // since G1-16 that address opens the live system too (main.jsx, withoutRetired). The language
      // is the one the UI opens in (live/i18n/langs.js DEFAULT_LANG), not Turkish.
      manifest: {
        name: "Homunculus",
        short_name: "Homunculus",
        description: "Reanimasiya və yenidoğan bölmələri üçün klinik qərar dəstəyi",
        theme_color: "#0891b2",
        background_color: "#020617",
        display: "standalone",
        start_url: "/",
        lang: "az",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      // What a ward PC downloads on its first visit: the live system and nothing else. The design
      // gallery (?tasarim=1) is a review page with no data, linked from nowhere — fetched from the
      // network when someone types its address, not kept offline. (The simulation's chunk and the
      // replay scenarios were excluded the same way until G1-16 removed them.)
      workbox: {
        globPatterns: ["**/*.{js,css,html,json,woff2,svg}"],
        globIgnores: ["**/DesignGallery-*.js"],
      },
    }),
  ],
  preview: {
    host: true,
    port: 3000,
    allowedHosts: true,
  },
  server: {
    allowedHosts: true,
    // Every path the dashboard actually calls. This list had fallen behind the API: /auth and
    // /clinical were missing, so on the dev server a clinician could not sign in and nothing they
    // charted reached the engine — the two things a person opening this locally does first.
    proxy: Object.fromEntries([
      "/auth",            // login, refresh, /me, TOTP
      "/patients",
      "/stream",
      "/stream-ticket",
      "/ingest",
      "/ack",
      "/notifications",
      "/audit",           // also covers /audit/verify
      "/alarm-quality",
      "/clinical",        // charting + the patient profile
      "/admissions",
      "/alerts",
      "/tenant",
      "/handovers",
      "/shift-schedule",
      "/break-glass",
      "/health",
      "/view",
      // Behind nginx in production too (deploy/local/web/nginx.conf); missing here until G1-07.
      "/admin",
      "/scope",
      "/scores",
      "/infinity-research",
    ].map((path) => [path, "http://localhost:8000"])),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.js",
    // Bu paketin testleri tam uygulamayı jsdom'da render ediyor; 5 sn'lik varsayılan, makine
    // yüklüyken sağlam testleri de düşürüyordu (aynı test tek başına 2 sn'de geçiyor). Zaman
    // aşımı bir performans ölçüsü değil, takılmayı yakalama ağıdır — 20 sn o işi görür.
    testTimeout: 20000,
  },
});

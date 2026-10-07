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
      includeAssets: ["icon.svg", "demo/*.json"],
      manifest: {
        name: "Homunculus",
        short_name: "Homunculus",
        description: "ICU/NICU klinik erken-uyarı — demo (sentetik veri)",
        theme_color: "#0891b2",
        background_color: "#020617",
        display: "standalone",
        start_url: "/?demo=1",
        lang: "tr",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,json,woff2,svg}"] },
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

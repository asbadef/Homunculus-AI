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
 * Docker imajı `.git` olmadan derlenir (.dockerignore) ve imajda git yoktur: orada SHA dışarıdan
 * gelir — `BUILD_SHA=$(git rev-parse --short HEAD) docker compose build web`, compose'un build
 * argümanı, Dockerfile'ın ARG'ı (G1-15, F2). İkisi de yoksa uydurulmaz, "bilinmiyor" denir.
 */
export function gitSha(
  env = process.env,
  run = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }),
) {
  try {
    const sha = run("git rev-parse --short HEAD").toString().trim();
    if (sha) return sha;
  } catch {
    // git yok ya da burası bir checkout değil: BUILD_SHA'ya bakılır.
  }
  return (env.BUILD_SHA ?? "").trim();
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
  build: {
    rollupOptions: {
      output: {
        // The string tables (live/i18n/strings/*.js: every namespace, four languages each) in
        // chunks of their own. They sat in the chunk the live UI shares with its lazy screens
        // (Toast-*.js), which passed the 500 kB the build warns at (502 kB, 2026-11-12). Two
        // chunks, split by the namespace's name (a–k, l–z), because the tables alone were 478 kB
        // and every new screen adds its own: one chunk would cross 500 kB again within a slice or
        // two, and halves by name grow about evenly. Only the grouping changes, not when the text
        // arrives: catalog.js still imports every table statically, so the chunk holding it imports
        // these statically and the dictionaries are complete before the first render, as before.
        // The tables import nothing, so nothing else moves with them and these chunks can be in no
        // import cycle (the risk an earlier, wider manualChunks split was dropped for, before the
        // screens went lazy). catalog.js itself stays out
        // on purpose: Rollup pulls a manual chunk's static dependencies into it, catalog.js
        // imports langs.js, and langs.js is also the first chunk's (LoadFailed.jsx) — the first
        // chunk would then import the whole catalogue, which LoadFailed.jsx exists to avoid.
        manualChunks(id) {
          const table = /[\\/]src[\\/]live[\\/]i18n[\\/]strings[\\/]([^\\/]+)\.js$/.exec(id);
          if (!table) return undefined;
          return table[1] < "l" ? "i18n-a-k" : "i18n-l-z";
        },
      },
    },
  },
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
      "/infinity-shadow",   // Aşama A's monitor strip (the board GET; the POST is the hub forwarder's)
      "/infinity-waves",    // Lane C (dalga): the live waveform panel's GET
      "/tasks",             // G3-02: Görevlerim — the queue and its settings
      "/pharmacy",          // G3-04: Eczane — the pharmacist's ward page
      "/readings",          // G3-05: «Eşleşmeyen ölçümler» — the unmatched list, the link, the rejection
      "/quality",           // G4-03: Kalite göstergeleri — GET /quality
      "/infection",         // G4-05: Enfeksiyon kontrol — GET /infection
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
    // The same net for the hooks: setupTests.js's beforeAll fetches every lazy screen a test file's
    // imports made (live/shell/lazyScreen.js), and on a loaded machine that may take more than the
    // 10 s default — it was a test's job, in the static imports, before the split.
    hookTimeout: 20000,
  },
});

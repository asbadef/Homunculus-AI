import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
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
    ].map((path) => [path, "http://localhost:8000"])),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.js",
  },
});

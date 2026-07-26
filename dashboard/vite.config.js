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
  server: {
    proxy: {
      "/patients": "http://localhost:8000",
      "/stream": "http://localhost:8000",
      "/ingest": "http://localhost:8000",
      "/ack": "http://localhost:8000",
      "/notifications": "http://localhost:8000",
      "/audit": "http://localhost:8000",
      "/view": "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.js",
  },
});

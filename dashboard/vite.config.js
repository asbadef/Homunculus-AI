import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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

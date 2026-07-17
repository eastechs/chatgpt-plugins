import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    // Proxy API requests to the Express server running in Electron's main
    // process. Use 127.0.0.1 explicitly to match the loopback bind in
    // src/main/server.ts and avoid IPv4/::1 ambiguity on macOS/Windows.
    proxy: {
      "/api": "http://127.0.0.1:19274",
    },
  },
  esbuild: {
    jsx: "automatic",
  },
});

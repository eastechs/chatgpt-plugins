import express from "express";
import path from "path";
import { app as electronApp } from "electron";

export async function createServer(port: number): Promise<void> {
  const isDev = !electronApp.isPackaged;
  const app = express();

  // Default body-parser limit is 100 KB. If the app sends large request
  // payloads (e.g. multi-turn chat with embedded attachments), bump this
  // up — it's a local-only server, no DoS concerns.
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // ─── JSON API routes ────────────────────────────────────
  // Mount your routers here. Example:
  //   import myRoutes from "./routes/my-routes.js";
  //   app.use("/api/things", myRoutes);
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ─── SPA serving (production only) ──────────────────────
  // In dev, Vite serves the SPA and proxies /api/* to this server.
  if (!isDev) {
    const rendererDir = path.join(__dirname, "../renderer");
    app.use(express.static(rendererDir));

    // SPA catch-all — serve index.html for all non-API routes.
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(rendererDir, "index.html"));
    });
  }

  // ─── Start listening ────────────────────────────────────
  // Bind explicitly to loopback so the API isn't reachable from other devices
  // on the LAN. 127.0.0.1 (not "localhost") avoids IPv4/::1 ambiguity.
  return new Promise((resolve) => {
    app.listen(port, "127.0.0.1", () => {
      console.log(`Express server running on http://127.0.0.1:${port}`);
      resolve();
    });
  });
}

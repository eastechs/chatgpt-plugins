import { randomBytes } from "crypto";
import type { RequestHandler } from "express";

// REPLACE: per-app header name. Pick something distinctive so it's grep-able.
const AUTH_HEADER = "X-MyApp-Auth";

// Per-launch shared secret. Regenerated every app start; the renderer fetches
// it via an IPC handler exposed in preload. Every /api/* request must include
// it as the AUTH_HEADER. This limits the local Express server to processes
// that can read the live BrowserWindow's preload context — other apps on the
// same machine (and other devices on the LAN) can't reach the API.
const SERVER_AUTH = randomBytes(32).toString("hex");

export function getServerAuth(): string {
  return SERVER_AUTH;
}

export const requireServerAuth: RequestHandler = (req, res, next) => {
  const provided = req.header(AUTH_HEADER);
  if (provided !== SERVER_AUTH) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

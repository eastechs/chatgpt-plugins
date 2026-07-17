---
name: electron-loopback-server-auth
description: Use when an Electron app stands up a local HTTP server (e.g. Express on a loopback port) and needs to ensure only the renderer can talk to it. Mints a per-launch random shared secret in the main process, exposes it to the renderer via IPC + preload, requires it on every `/api/*` request, and provides an `authedFetch` wrapper plus `api_get/post/put/patch/delete` helpers for the renderer.
---

# electron-loopback-server-auth

Per-launch shared secret on a loopback Express server. Small but high-leverage — any time an Electron app stands up a local HTTP server, this is the auth model you want.

## When to use

- The app uses `electron-express-react-router` (Electron + Express + Vite stack) or any equivalent local-server pattern.
- You want to keep the API local-only, even from other apps running as the same user on the same machine.
- The renderer needs to talk to the API; nothing else should be able to.

## Threat model

The server already binds to `127.0.0.1`, so other devices on the LAN can't reach it. But other apps running as the same user on the same machine *can* — they could open `http://127.0.0.1:19274/api/projects` and read everything.

A 32-byte hex secret minted at launch and required on every `/api/*` request closes that gap. The secret lives in:
- The main process (one in-memory string).
- The renderer's preload context (fetched on first call, cached).

Other processes don't have access to either. To extract the secret an attacker would need either main-process code execution (game over anyway) or the ability to read the live BrowserWindow's preload context (also game over — they're already inside the renderer).

This is **not** a defence against a malicious npm dep running inside the renderer. That's a different threat model and needs CSP + careful dep auditing.

## What it scaffolds

| Source | Destination |
|---|---|
| `templates/src/main/auth.ts` | `src/main/auth.ts` — `getServerAuth()` + `requireServerAuth` middleware |
| `templates/src/renderer/lib/api.ts` | `src/renderer/lib/api.ts` — `authedFetch`, `ApiError`, `api_get/post/put/patch/delete` |

Plus snippets to add to `index.ts` and `preload.ts` (in the SKILL.md, not as standalone files — they need to be merged into existing files):

**`src/main/index.ts`** — register the IPC handler:

```typescript
import { getServerAuth } from "./auth.js";

ipcMain.handle("get-server-auth", () => getServerAuth());
```

**`src/main/server.ts`** — mount the middleware on `/api`:

```typescript
import { requireServerAuth } from "./auth.js";

app.use("/api", requireServerAuth);
```

**`src/main/preload.ts`** — expose the secret-fetcher:

```typescript
contextBridge.exposeInMainWorld("electronAPI", {
  // ... other exposures
  getServerAuth: (): Promise<string> => ipcRenderer.invoke("get-server-auth"),
});
```

## Decision points

- **Header name** — defaults to `X-MyApp-Auth`. Pick something unique per app so it's grep-able in logs and doesn't collide with any other `X-Auth-Token` header you might encounter.
- **Mount path** — defaults to `/api`. If the server has unauthenticated routes (e.g. health checks, static SPA assets), keep those off `/api`.
- **Secret length** — 32 bytes hex (256 bits). Don't go below 16 bytes; longer is fine but pointless.

## Why mount at `/api` and not on the static-asset middleware?

The SPA bundle is useless without the auth secret anyway — it can't talk to the API without first calling `window.electronAPI.getServerAuth()`. Authenticating the static assets would just create a chicken-and-egg problem (the renderer can't load until it has the secret, but it can't get the secret until the renderer is loaded). Skipping auth for the SPA's static files is the right call.

## Renderer error model

`ApiError` carries `status` and `response` so the UI can branch on:

- `401` — auth failed (rare; usually means the cached secret is stale after a hot reload).
- `400`/`422` — validation; `response` typically has a structured `{ field, message }` body.
- `5xx` — server error; show a generic message + retry button.

`isApiError(err)` is a type guard for try/catch ergonomics.

## Source

Lifted from:
- [trident/src/main/auth.ts](https://github.com/eastechs/trident/blob/main/src/main/auth.ts)
- [trident/src/renderer/lib/api.ts](https://github.com/eastechs/trident/blob/main/src/renderer/lib/api.ts)

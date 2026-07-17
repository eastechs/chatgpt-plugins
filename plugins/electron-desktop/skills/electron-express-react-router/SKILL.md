---
name: electron-express-react-router
description: Use when starting a new Electron desktop app that needs a real HTTP API surface (not just IPC). Scaffolds an Electron main process that boots an Express server on a fixed loopback port, a Vite renderer that proxies `/api/*` to that server in dev and is served as static files by the same Express server in production, and React Router on the renderer side. The dual-mode serving keeps the renderer code identical between dev and packaged builds.
---

# electron-express-react-router

The core stack scaffold: Electron + Express + Vite + React Router with a per-file tsup build for the main process.

## When to use

- Starting a new Electron desktop app from scratch.
- The app needs a real HTTP API (not just IPC) — e.g. for an AI-SDK chat route that benefits from streaming over HTTP, or for any code that's easier to write/test as a route handler than an IPC call.
- You want the renderer to talk to one URL shape regardless of dev vs. production build.

## What it scaffolds

| Source | Destination | Purpose |
|---|---|---|
| `templates/src/main/index.ts` | `src/main/index.ts` | Main process bootstrap |
| `templates/src/main/server.ts` | `src/main/server.ts` | Express setup, route mounting, SPA serving |
| `templates/src/main/preload.ts` | `src/main/preload.ts` | `contextBridge` exposure |
| `templates/src/renderer/index.html` | `src/renderer/index.html` | Vite entry HTML |
| `templates/src/renderer/app.tsx` | `src/renderer/app.tsx` | React Router setup |
| `templates/src/renderer/css/app.css` | `src/renderer/css/app.css` | Stub stylesheet |
| `templates/vite.config.ts` | `vite.config.ts` | Vite + `/api` proxy + `dist/renderer` outDir |
| `templates/tsup.config.ts` | `tsup.config.ts` | Per-file main-process build (CJS, Node 20) |
| `templates/tsconfig.json` | `tsconfig.json` | Renderer tsconfig with `@/*` alias |
| `templates/tsconfig.main.json` | `tsconfig.main.json` | Main-process tsconfig |
| `templates/scripts/launch-electron.js` | `scripts/launch-electron.js` | Dev launcher (drops `ELECTRON_RUN_AS_NODE`) |
| `templates/scripts/wait-for-vite.js` | `scripts/wait-for-vite.js` | Polls Vite before launching Electron |
| `templates/package.json` | `package.json` | Scripts + deps for the stack |
| `templates/.gitignore` | `.gitignore` | dist/, release/, node_modules/, etc. |

## Decision points

- **App name** — used in `productName`, `appId`, the window title, `app.setName()`, etc.
- **Server port** — defaults to `19274`. Pick something stable; the renderer's API client caches it. Don't use a well-known port.
- **Vite dev port** — defaults to `5173`. Match `vite.config.ts`'s `server.port` and `wait-for-vite.js`'s polling URL.
- **Tailwind y/n** — template ships *without* Tailwind to keep the scaffold provider-neutral. Add `@tailwindcss/vite` and a `@tailwindcss` plugin block if needed.

## The non-obvious bits

- **Bind to `127.0.0.1`, not `localhost`.** `localhost` resolution can return `::1` (IPv6) on some macOS / Windows setups; the Vite proxy and the Express bind would then point at different stacks and look at one another's traffic in confusion. `127.0.0.1` is unambiguous.
- **In production, also load via `127.0.0.1`** — `mainWindow.loadURL("http://127.0.0.1:<port>")`. Same reasoning.
- **Per-file tsup config (`bundle: false`)** is intentional. The main process imports its own modules with explicit `.js` extensions (`./server.js`, `./settings.js`, …) so the relative imports resolve correctly when the build emits one `.js` per source `.ts`. Bundling everything into one file would break those imports' implicit assumption of per-file output.
- **`outExtension: () => ({ js: ".js" })`** — without this, tsup would emit `.cjs` and the imports above would 404.
- **`scripts/launch-electron.js`** drops `ELECTRON_RUN_AS_NODE` from the spawned env. Some setups (notably nvm shims, certain VSCode terminals) leak that variable in, which makes Electron run as plain Node and the main process boot silently fails.
- **`scripts/wait-for-vite.js`** is needed because `concurrently` doesn't actually serialise — Electron would race Vite and load `http://localhost:5173` before the dev server is up.
- **`limit: "50mb"` on the Express body parser** — the default 100 KB blows past the first multi-turn chat with any embedded attachments. 50 MB is way more than realistic for a local-only server.
- **Auth middleware on `/api`, but not on the SPA static assets.** The bundle is useless without the auth secret anyway, and serving the SPA without auth lets the renderer load before it has fetched the secret.

## Production routing

In production:
1. `vite build` outputs to `dist/renderer/`.
2. The Express server `app.use(express.static(rendererDir))` serves those files.
3. SPA catch-all routes everything that didn't match `/api/*` to `index.html` so React Router can take over.
4. The main process does `mainWindow.loadURL("http://127.0.0.1:19274/")`.

In development:
1. Vite serves the renderer at `http://localhost:5173`.
2. Vite's proxy forwards `/api/*` to `http://127.0.0.1:19274`.
3. The main process does `mainWindow.loadURL("http://localhost:5173/")`.

The renderer's API client (`electron-loopback-server-auth` — `lib/api.ts`) hits `/api/*` in both cases. The renderer code is identical.

## Pairs well with

- **`electron-loopback-server-auth`** — almost always: the local server should require a per-launch secret.
- **`electron-secondary-windows`** — for the `setMainWindow`/`getMainWindow` accessor and `attachExternalLinkHandlers`.
- **`electron-pglite-drizzle`** — if the app needs persistence.

The `bundle-electron-trident-stack` skill composes the complete base stack in one pass.

## Source

Lifted from:
- [trident/src/main/index.ts](https://github.com/eastechs/trident/blob/main/src/main/index.ts)
- [trident/src/main/server.ts](https://github.com/eastechs/trident/blob/main/src/main/server.ts)
- [trident/src/main/preload.ts](https://github.com/eastechs/trident/blob/main/src/main/preload.ts)
- [trident/vite.config.ts](https://github.com/eastechs/trident/blob/main/vite.config.ts)
- [trident/tsup.config.ts](https://github.com/eastechs/trident/blob/main/tsup.config.ts)
- [trident/scripts/launch-electron.js](https://github.com/eastechs/trident/blob/main/scripts/launch-electron.js)
- [trident/scripts/wait-for-vite.js](https://github.com/eastechs/trident/blob/main/scripts/wait-for-vite.js)

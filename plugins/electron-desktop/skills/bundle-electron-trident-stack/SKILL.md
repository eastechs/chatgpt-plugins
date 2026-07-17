---
name: bundle-electron-trident-stack
description: Use when starting a new Electron desktop app and you want the full Trident-shaped base stack — Electron + Express + Vite + React Router + PGLite + Drizzle, with per-launch loopback auth, encrypted settings, safe secondary windows, a native menu bridge, and signed/notarized builds. This bundle composes the electron-express-react-router, electron-pglite-drizzle, electron-loopback-server-auth, electron-encrypted-settings, electron-secondary-windows, electron-native-menu-bridge, and electron-builder-mac-notarize skills in one pass, surfacing shared decisions (server port, app id, signing identity) up-front so you don't get asked the same question seven times.
---

# bundle-electron-trident-stack

Composes the full base stack in dependency order. No new templates of its own — this skill orchestrates the others.

## When to use

- Starting a new Electron app and you want the whole base stack at once.
- You've decided you want all of: HTTP API + persistence + auth + settings + native menu + signed builds.
- You don't need the AI layer yet (or ever) — that's the `bundle-electron-ai-workspace` bundle on top of this one.

If you only need a subset, invoke the individual skills directly. This bundle exists for the "one-shot scaffold a new app" path.

## Composition order

Apply in this order — earlier skills are imports for later ones:

1. **[electron-express-react-router](../electron-express-react-router/SKILL.md)** — base stack scaffolding. Creates `src/main/`, `src/renderer/`, configs, scripts, `package.json`.
2. **[electron-pglite-drizzle](../electron-pglite-drizzle/SKILL.md)** — PGLite + Drizzle + migration runner. Creates `src/main/database.ts`, `src/main/db/`, adds Drizzle deps.
3. **[electron-encrypted-settings](../electron-encrypted-settings/SKILL.md)** — `electron-store` + `safeStorage`. Creates `src/main/settings.ts`, adds `electron-store` dep.
4. **[electron-loopback-server-auth](../electron-loopback-server-auth/SKILL.md)** — per-launch shared secret. Creates `src/main/auth.ts`, `src/renderer/lib/api.ts`, modifies `index.ts`/`server.ts`/`preload.ts`.
5. **[electron-secondary-windows](../electron-secondary-windows/SKILL.md)** — safe secondary-window registry and external-link handling. Creates `src/main/native/windows.ts`, which the native-menu template imports for its About and Documentation actions.
6. **[electron-native-menu-bridge](../electron-native-menu-bridge/SKILL.md)** — native menu sync. Creates `src/main/native/menus.ts`, `src/renderer/hooks/use-native-menu.ts`, modifies `index.ts`/`preload.ts`.
7. **[electron-builder-mac-notarize](../electron-builder-mac-notarize/SKILL.md)** — signed + notarized DMG. Creates `electron-builder.yml`, `scripts/notarize-dmg.js`, `resources/entitlements.mac.plist`.

The `electron-safe-paths` and `electron-native-notifications` skills are intentionally **not** included — they're orthogonal to the base stack. Add them on top if your app needs them. `electron-secondary-windows` is included because the native-menu template depends on its About and Documentation window helpers.

## Shared decisions to make up-front

Resolve these *before* invoking any sub-skills, so they propagate consistently:

| Decision | Used by | Default |
|---|---|---|
| **App name** | electron-express-react-router (`productName`, window title), electron-builder-mac-notarize (`productName`) | Ask |
| **`appId`** (reverse-DNS) | electron-express-react-router (`setAppUserModelId`), electron-builder-mac-notarize (`appId`) | Ask |
| **Server port** (loopback) | electron-express-react-router (`SERVER_PORT`), electron-loopback-server-auth (auth scope), electron-secondary-windows (allowed origins) | `19274` |
| **Auth header name** (`X-AppName-Auth`) | electron-loopback-server-auth main + renderer | Ask, derive from app name |
| **Settings store name** | electron-encrypted-settings | `<app-slug>-settings` |
| **Action menu ids** | electron-native-menu-bridge main + renderer | `new-document`, `save`, `print`, `close` |
| **Mac signing identity** | electron-builder-mac-notarize | From keychain at build time |
| **Output directory** | electron-express-react-router (`build`), electron-builder-mac-notarize (`directories.output`) | `release/` |

Confirm these once, then drop the answers into each sub-skill so you don't ask the user "what's your app name?" six times.

## After-bundle wiring (do this once at the end)

Once all seven skills have run, the resulting `src/main/index.ts` needs the imports + boot order from all of them threaded together:

```typescript
import { app, BrowserWindow, ipcMain, Menu } from "electron";
import path from "path";
import { createServer } from "./server.js";
import { initDatabase } from "./database.js";
import { initSettings } from "./settings.js";
import { getServerAuth } from "./auth.js";
import { buildMenu, setEnabledMenuActions } from "./native/menus.js";
import {
  attachExternalLinkHandlers,
  setMainWindow,
} from "./native/windows.js";

app.setName("MyApp");
app.setAppUserModelId("com.example.myapp");

const SERVER_PORT = 19274;
let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  const win = new BrowserWindow({ /* ... */ });
  mainWindow = win;
  setMainWindow(win);
  attachExternalLinkHandlers(win);
  Menu.setApplicationMenu(buildMenu(win));
  win.loadURL(/* ... */);
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
      setMainWindow(null);
    }
  });
}

ipcMain.handle("get-server-auth", () => getServerAuth());
ipcMain.on("menu-set-enabled", (_event, actions: string[]) => {
  if (Array.isArray(actions)) setEnabledMenuActions(actions);
});

app.whenReady().then(async () => {
  await initSettings();
  await initDatabase();
  await createServer(SERVER_PORT);
  await createWindow();
});
```

Order matters in the `whenReady` block: settings first (other modules read it), database second (routes need it), server third (creates routes), window last (loads `127.0.0.1:port`).

The `preload.ts` likewise needs the merged exposures from `electron-loopback-server-auth` + `electron-native-menu-bridge` + (later) `electron-native-notifications`.

## End-to-end verification

After all seven skills are in place:

1. `npm install` — should pull all deps cleanly.
2. `npm run types:check` — should pass with zero errors.
3. `npm run dev` — should boot Vite, then tsup, then Electron. The renderer should load. `curl http://127.0.0.1:19274/api/health` (without auth) should return 401. The renderer should be able to make API calls (if you've added one).
4. `npm run build` — should produce `dist/main/`, `dist/renderer/`.
5. `npm run build:all` (with signing env vars set on a Mac) — should produce a signed + notarized DMG in `release/`.

If you don't have signing certs handy, skip step 5; the rest still verifies the stack is wired correctly.

## What this bundle leaves out

- **No AI provider routing** — install the `electron-ai-workspace` plugin and apply its `bundle-electron-ai-workspace` skill when the base is ready.
- **No safe-paths utility** (`electron-safe-paths`) — add when your routes start composing user-supplied filenames.
- **No native notifications** (`electron-native-notifications`) — add when long-running operations finish out-of-window.
- **No tests** — testing strategy is too app-specific to template.

## Source

This bundle is the "stack base" half of trident's skill-suggestions. The "AI layer" half is `bundle-electron-ai-workspace` in the `electron-ai-workspace` plugin.

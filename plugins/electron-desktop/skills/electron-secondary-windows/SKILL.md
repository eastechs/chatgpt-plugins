---
name: electron-secondary-windows
description: Use when an Electron app needs secondary windows and safe handling for anchor links in user-generated or AI-generated content. Provides an open-or-focus window registry, main-window accessors, and external-link handlers that prevent in-app navigation hijacks.
---

# electron-secondary-windows

Two things bundled in one small file:

1. A **secondary-window registry** so opening "About" twice focuses the existing window instead of stacking a duplicate.
2. **External-link handlers** that re-route `<a href>` clicks to the system browser instead of letting Electron navigate the BrowserWindow itself.

The link-hijack issue is the underrated one. If an agent renders `[click me](https://attacker.example.com)` in chat and the user clicks it, default Electron behaviour is to navigate the entire window to that URL — replacing the app with a chrome-less, URL-bar-less browser pointing at attacker.example.com. That's a credible phishing surface.

## When to use

- App has any window besides the main one (preferences, about, docs viewer).
- App renders any user-generated or AI-generated `<a href>` links.
- Multiple modules in the main process need a handle on the primary window (notifications, deep-link handlers, tray menu, …) without circular imports.

## What it scaffolds

| Source | Destination |
|---|---|
| `templates/windows.ts` | `src/main/native/windows.ts` |

Exports:

- `setMainWindow(win)` / `getMainWindow()` — the singleton main-window pointer.
- `attachExternalLinkHandlers(win)` — call this on every BrowserWindow you create. Handles `setWindowOpenHandler` (covers `target="_blank"` and `window.open`) and `will-navigate` (covers click + JS-driven `location.href`).
- `openSecondaryWindow(key, route, options)` — the open-or-focus pattern; key is your dedupe key.
- `openDocumentationWindow()` / `openAboutWindow()` — examples of the pattern (rename / replicate as needed).

## Decision points

- **`SERVER_PORT`** — has to match the loopback Express port from `electron-express-react-router` (default 19274). Hard-coded as a constant at the top of the file.
- **`ALLOWED_HTTP_ORIGINS`** — the set of origins that count as "inside the app". Default is dev Vite (`http://localhost:5173`), prod loopback `localhost`, and prod loopback `127.0.0.1`. **Both** loopback forms are needed because some renderer code paths normalise URLs to one and some to the other.
- **`SAFE_EXTERNAL_PROTOCOLS`** — protocols allowed through to `shell.openExternal`. Default is `http:`, `https:`, `mailto:`. **Don't** add `file:`, `vscode:`, or other custom schemes unless you're sure — a stray click on `vscode://file/etc/passwd` shouldn't launch VSCode.
- **Window options** — defaults use `titleBarStyle: "hidden"` with `trafficLightPosition`. Drop these for a stock title bar.

## Why both `setWindowOpenHandler` and `will-navigate`?

- `setWindowOpenHandler` fires for `<a target="_blank">` clicks and `window.open(url)` calls.
- `will-navigate` fires for plain `<a>` clicks (no target) and JS-driven `window.location.href = url` assignments.

Block one and the other still works as a hijack vector. Block both and the only remaining navigation paths are programmatic ones the app explicitly invokes (`win.loadURL`, etc.).

The `isInternalUrl` helper allows `""` and `"about:blank"` through — those are used by `window.print()` helpers and various Electron internals; blocking them breaks print preview.

## What `getMainWindow()` is for

Other modules in the main process — notifications (`electron-native-notifications`), tray menus, deep-link handlers — need to focus or message the primary window without importing the bootstrap module that created it (which would create circular imports). The singleton pointer is the cheapest fix; just make sure `index.ts` calls `setMainWindow(win)` after creating it and `setMainWindow(null)` on `closed`.

## Source

Lifted from [trident/src/main/native/windows.ts](https://github.com/eastechs/trident/blob/main/src/main/native/windows.ts).

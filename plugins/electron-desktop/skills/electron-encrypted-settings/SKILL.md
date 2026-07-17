---
name: electron-encrypted-settings
description: Use when an Electron app needs typed user settings plus OS-keychain-encrypted slots for credentials (API keys, tokens). Wires up `electron-store` for plain values and `safeStorage` for encrypted ones, with the right "refuse to write if encryption unavailable" guard so a Linux box without a keyring doesn't silently store keys in plaintext.
---

# electron-encrypted-settings

Typed settings store for an Electron main process. Plain values via `electron-store`, credentials via `electron-store` + `safeStorage` with the encryption-availability guard.

## When to use

- The app has user preferences (autosave, theme, telemetry flags, etc.) that need to survive restarts.
- The app accepts user-supplied API keys / OAuth tokens that need to live somewhere reasonable.
- You don't want to depend on a separate keychain library — `safeStorage` already routes through Keychain on macOS, DPAPI on Windows, and libsecret on Linux when available.

## What it scaffolds

A single `src/main/settings.ts` parameterised on a `SettingsSchema` interface. Exports:

- `initSettings()` — async; resolves the dynamic ESM import of `electron-store`. Call once at main-process startup before anything else reads settings.
- `getSetting<K>(key)` / `setSetting<K>(key, value)` — typed accessors over the plain store.
- `getApiKey(provider)` / `setApiKey(provider, key)` / `deleteApiKey(provider)` — encrypted slot helpers.
- `isApiKeyEncryptionAvailable()` — surface this to the renderer so the settings UI can show "secure storage unavailable on this machine" instead of a silent failure.
- `getConfiguredProviders()` — derived helper for the renderer's "which keys do we have" UI; doesn't decrypt, just reports presence.

## Decision points

- **`SettingsSchema` shape** — what keys does the app care about? Provide an interface up front; defaults are typed against it.
- **`apiKeys` providers** — which providers are valid? The example uses `anthropic | openai | gemini` — narrow this to what the app actually needs.
- **Store name** — defaults to `<product-slug>-settings`. Multiple stores per app are fine (`-cache`, `-history`, etc.).
- **Defaults** — must satisfy the schema completely; `electron-store` writes them on first launch.

## Why dynamic import?

`electron-store` is ESM-only as of v9. A CJS Electron main process (which is what `tsup` produces by default with the per-file config in `electron-express-react-router`) can only get at it via `await import("electron-store")`. The wrapper here keeps that detail out of every call site.

## Why "refuse to write if encryption unavailable"?

On Linux without a working keyring (libsecret), `safeStorage` falls back to writing a `v10`-prefixed plaintext buffer. That looks encrypted at a glance but isn't — anyone with read access to `~/.config/<app>/` can recover the key with two lines of code. Refusing to persist is the right call: surface the error to the user, point them at installing `gnome-keyring` or equivalent, and let them try again.

## Drop-in template

`templates/settings.ts` is a working file with placeholders for the schema; rename the `apiKeys` providers and add other settings as needed.

## Wiring it in

In `src/main/index.ts`, before `BrowserWindow` is created and before any other module reads settings:

```typescript
import { initSettings } from "./settings.js";

app.whenReady().then(async () => {
  await initSettings();
  // ... boot the rest of the app
});
```

For the renderer to read user preferences, expose individual `getSetting` calls via IPC handlers in `index.ts` and `contextBridge` in `preload.ts`. Don't expose the full schema — pick the keys the renderer is allowed to see.

## Source

Lifted from [trident/src/main/settings.ts](https://github.com/eastechs/trident/blob/main/src/main/settings.ts).

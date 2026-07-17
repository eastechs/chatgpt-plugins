---
name: electron-native-menu-bridge
description: >-
  Use when an Electron app needs a native OS menu whose available actions
  change per page or document state. Provides a two-way bridge between the
  main-process menu and renderer actions, including IPC events and a
  useNativeMenu hook that keeps enabled states synchronized.
---

# electron-native-menu-bridge

Two-way native menu / renderer sync. The pieces that other templates skip:

1. The renderer declares which menu actions are *currently* relevant. `useNativeMenu({ onSave, onPrint })` enables Save and Print and disables every other action; switch routes and the next page's hook flips it.
2. Subscribers return unsubscribe functions. Without that, every remount leaks a listener — one menu click then fires N stale handlers (two New Document callbacks → two new docs).

## When to use

- The app has more than one "page" / route, and different pages support different actions (Save makes sense in the editor, not in Settings).
- You want native shortcuts (`Cmd+S`, `Cmd+P`, `Cmd+W`) that only fire when the active page handles them — and grey out otherwise so the user gets the right feedback.
- The renderer is the source of truth for what's actionable.

## What it scaffolds

| Source | Destination |
|---|---|
| `templates/src/main/native/menus.ts` | `src/main/native/menus.ts` — `buildMenu(mainWindow)` + `setEnabledMenuActions(ids)` + `ACTION_MENU_IDS` |
| `templates/src/renderer/hooks/use-native-menu.ts` | `src/renderer/hooks/use-native-menu.ts` — the hook |

Plus snippets for `index.ts` and `preload.ts` (merge into existing files):

**`src/main/index.ts`**:

```typescript
import { Menu } from "electron";
import { buildMenu, setEnabledMenuActions } from "./native/menus.js";

// In createWindow(), after creating mainWindow:
Menu.setApplicationMenu(buildMenu(mainWindow));

// Top-level IPC handler:
ipcMain.on("menu-set-enabled", (_event, actions: string[]) => {
  if (Array.isArray(actions)) setEnabledMenuActions(actions);
});
```

**`src/main/preload.ts`**:

```typescript
contextBridge.exposeInMainWorld("electronAPI", {
  onMenuAction: (callback: (action: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string) =>
      callback(action);
    ipcRenderer.on("menu-action", handler);
    return () => ipcRenderer.removeListener("menu-action", handler);
  },
  setMenuEnabled: (actions: string[]) =>
    ipcRenderer.send("menu-set-enabled", actions),
});
```

## Decision points

- **Action ids** — defaults: `new-document`, `new-conversation`, `save`, `save-as`, `export`, `print`, `close`, `delete`. Replace with whatever your app's actions are. Keep them kebab-case for symmetry with menu ids.
- **Mac app menu** — defaults to standard Apple-required items (About, Services, Hide, Quit). Replace `app.name`-driven labels.
- **Help menu** — defaults to a single "Documentation" item that calls `openDocumentationWindow()` (`electron-secondary-windows`). Drop or rename if you don't have docs.

## Renderer usage

```typescript
function EditorPage() {
  const [doc, setDoc] = useState<Doc>();

  useNativeMenu({
    onSave: () => save(doc),
    onPrint: () => print(doc),
    // onNewDocument, onClose, etc. — omit to disable in the menu
  });

  return <Editor value={doc} onChange={setDoc} />;
}
```

The hook does three things:
1. Subscribes to `menu-action` events and dispatches them to the matching handler.
2. Derives the enabled set from which handlers are defined and pushes it via `menu-set-enabled` whenever the set changes (using a sorted-string key so handler-identity changes don't re-fire).
3. On unmount, sends `menu-set-enabled([])` so the next page starts from a clean slate.

## The listener-leak failure mode

Without unsubscribe-returning subscribers:

```typescript
// BAD — what most templates show
contextBridge.exposeInMainWorld("electronAPI", {
  onMenuAction: (cb) => ipcRenderer.on("menu-action", (_, a) => cb(a)),
});
```

Every time a component using this re-mounts (route change, key change, hot reload), a new listener is added. Old ones are never removed. Click "New Document" once after five remounts → five new documents.

The fix is straightforward: return an unsubscribe.

```typescript
// GOOD — what's in the template
onMenuAction: (callback) => {
  const handler = (_event, action: string) => callback(action);
  ipcRenderer.on("menu-action", handler);
  return () => ipcRenderer.removeListener("menu-action", handler);
},
```

Same pattern for any other `ipcRenderer.on` exposure (notifications in `electron-native-notifications` follows the same shape — same reason).

## Source

Lifted from:
- [trident/src/main/native/menus.ts](https://github.com/eastechs/trident/blob/main/src/main/native/menus.ts)
- [trident/src/renderer/hooks/use-native-menu.ts](https://github.com/eastechs/trident/blob/main/src/renderer/hooks/use-native-menu.ts)

---
name: electron-native-notifications
description: Use when an Electron app needs to surface OS notifications whose body might contain markdown (agent output, AI responses, user-generated content). Strips inline markdown so the notification reads as plain text instead of literal `**bold**`, and routes notification clicks back into the renderer with focus/restore handling.
---

# electron-native-notifications

OS notifications with markdown stripping + click-to-navigate. The two pieces template authors usually skip:

1. The notification shell (Notification Center, libnotify, Action Center) renders body text as plain text. Pasting markdown in shows the literal asterisks/brackets.
2. When the user clicks the notification, you almost always want to focus the main window and route to a specific place — not just bring it forward.

## When to use

- App has long-running operations (agent runs, file imports, sync) that finish out-of-window.
- Notification bodies are assembled from agent output, LLM responses, or any user-generated content that might contain markdown.
- Click-to-navigate is desirable (e.g. clicking a "conversation completed" notification opens that conversation).

## What it scaffolds

| Source | Destination |
|---|---|
| `templates/notifications.ts` | `src/main/native/notifications.ts` |

Plus IPC wiring snippets for `preload.ts` and the renderer router. The skill assumes:

- A `getMainWindow()` accessor exists (`electron-secondary-windows` provides this) — or substitute your own.
- A `getSetting('notifications')` boolean exists (`electron-encrypted-settings` provides this) — or remove the gate.
- `appIconPath()` returns an absolute path to a PNG suitable for notification icons.

## Decision points

- **NotificationTarget shape** — what does "where to navigate" look like? Default template uses `{ projectId, conversationId }`. Replace with whatever your routing key is.
- **Setting key** — default checks `getSetting('notifications')`. Rename or drop if your settings module isn't shaped that way.
- **Icon strategy** — use the app icon, a per-notification icon, or none. PNG only — `.icns` and `.ico` aren't supported by Electron's `Notification`.

## The stripMarkdown regex stack

The included regex stack handles, in order: fenced code blocks, inline code, images (must run before links), links, bold, italic, strikethrough, headings, blockquotes, list markers, horizontal rules, and intra-line whitespace runs. The order matters — `![alt](url)` would be eaten by the link rule first if image came after, leaving a dangling `!`.

It is **not** a real markdown parser. For a 3-line preview that's fine; if you ever need to render markdown anywhere else in the main process, swap in `remark-stringify` or similar. The function is exported separately in case it's useful elsewhere (it is — error messages from agent output get the same treatment).

## Renderer wiring

Preload exposure (the unsubscribe-returning pattern is borrowed from `electron-native-menu-bridge`'s menu bridge — same reasoning, same listener-leak failure mode):

```typescript
// preload.ts (excerpt)
contextBridge.exposeInMainWorld("electronAPI", {
  onNotificationNavigate: (
    callback: (target: { projectId: string; conversationId: string }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      target: { projectId: string; conversationId: string },
    ) => callback(target);
    ipcRenderer.on("notification-navigate", handler);
    return () => ipcRenderer.removeListener("notification-navigate", handler);
  },
});
```

Renderer hook:

```typescript
// useNotificationNavigation.ts
import { useEffect } from "react";
import { useNavigate } from "react-router";

export function useNotificationNavigation(): void {
  const navigate = useNavigate();
  useEffect(() => {
    return window.electronAPI.onNotificationNavigate((target) => {
      navigate(`/projects/${target.projectId}/conversations/${target.conversationId}`);
    });
  }, [navigate]);
}
```

## macOS-specific notes

- The first time a notification is shown, macOS records the bundle id in System Settings → Notifications. If you change `appId` mid-development, old preferences linger; remove the entry there to reset.
- Notifications only fire when your app is signed and notarized in production builds. In dev they work because they inherit Electron Helper's identity.
- `Notification.isSupported()` is always true on macOS but returns false on Windows in some edge cases — call before showing if you target Windows aggressively.

## Source

Lifted from [trident/src/main/native/notifications.ts](https://github.com/eastechs/trident/blob/main/src/main/native/notifications.ts).

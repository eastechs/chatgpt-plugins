import { contextBridge, ipcRenderer } from "electron";

// Subscription helpers should return an unsubscribe function so callers can
// detach on component unmount. Without this, useEffect-based subscribers
// accumulate listeners across remounts/route changes — every event then
// fires every stale handler in turn.
contextBridge.exposeInMainWorld("electronAPI", {
  // Example invoke (matches `ipcMain.handle("some-action", …)` in index.ts):
  // someAction: () => ipcRenderer.invoke("some-action"),

  // Example subscriber pattern (returns unsubscribe):
  // onSomeEvent: (callback: (payload: SomePayload) => void) => {
  //   const handler = (
  //     _event: Electron.IpcRendererEvent,
  //     payload: SomePayload,
  //   ) => callback(payload);
  //   ipcRenderer.on("some-event", handler);
  //   return () => ipcRenderer.removeListener("some-event", handler);
  // },
});

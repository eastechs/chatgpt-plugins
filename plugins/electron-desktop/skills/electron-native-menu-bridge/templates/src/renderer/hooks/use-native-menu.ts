import { useEffect, useRef } from "react";

// REPLACE: shape this to match your app's action set. Keys are camelCase
// callback names; entries map menu-action ids → those callback names.
interface NativeMenuActions {
  onNewDocument?: () => void;
  onNewConversation?: () => void;
  onSave?: () => void;
  onSaveAs?: () => void;
  onExport?: () => void;
  onPrint?: () => void;
  onClose?: () => void;
  onDelete?: () => void;
}

const ACTION_MAP: Record<string, keyof NativeMenuActions> = {
  "new-document": "onNewDocument",
  "new-conversation": "onNewConversation",
  save: "onSave",
  "save-as": "onSaveAs",
  export: "onExport",
  print: "onPrint",
  close: "onClose",
  delete: "onDelete",
};

export function useNativeMenu(actions: NativeMenuActions): void {
  const actionsRef = useRef(actions);

  useEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    // Listen for menu actions from Electron main process via preload bridge.
    // The preload returns an unsubscribe so we can detach on unmount —
    // without this, every page that mounts useNativeMenu leaks a listener
    // and a single menu click fires every stale handler (e.g. two `New
    // Document` callbacks → two new docs from one click).
    const api = window.electronAPI;
    if (!api?.onMenuAction) return;

    const unsubscribe = api.onMenuAction((action: string) => {
      const actionKey = ACTION_MAP[action];
      if (actionKey) {
        actionsRef.current[actionKey]?.();
      }
    });
    return unsubscribe;
  }, []);

  // Derive the set of currently-enabled action ids from which handlers are
  // defined. Pages omit handlers (or pass undefined) when an action doesn't
  // apply to the current state — e.g. Save when the active tab is read-only.
  // The sorted-string key keeps the sync effect from re-firing when only
  // handler identity changed but the enabled set didn't.
  const enabledKey = Object.entries(ACTION_MAP)
    .filter(([, handlerKey]) => typeof actions[handlerKey] === "function")
    .map(([id]) => id)
    .sort()
    .join(",");

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.setMenuEnabled) return;
    api.setMenuEnabled(enabledKey ? enabledKey.split(",") : []);
  }, [enabledKey]);

  useEffect(() => {
    // Reset menu state when the page using this hook unmounts so a route
    // change doesn't leave stale items enabled. The next page's hook (if
    // any) will re-enable what it actually supports.
    return () => {
      window.electronAPI?.setMenuEnabled?.([]);
    };
  }, []);
}

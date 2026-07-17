import { Menu, BrowserWindow, app } from "electron";
import type { MenuItemConstructorOptions } from "electron";
// REPLACE: drop or replace with your secondary-window helpers if not using electron-secondary-windows.
import { openAboutWindow, openDocumentationWindow } from "./windows.js";

// REPLACE: shape this to your app's actions. Keep ids kebab-case so they
// match the keys in use-native-menu.ts ACTION_MAP.
const ACTION_MENU_IDS = [
  "new-document",
  "new-conversation",
  "save",
  "save-as",
  "export",
  "print",
  "close",
  "delete",
] as const;

export function buildMenu(mainWindow: BrowserWindow): Menu {
  const isMac = process.platform === "darwin";

  const sendAction = (action: string) => () =>
    mainWindow.webContents.send("menu-action", action);

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: `About ${app.name}`, click: () => openAboutWindow() },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          id: "new-document",
          label: "New Document",
          accelerator: "CmdOrCtrl+N",
          enabled: false,
          click: sendAction("new-document"),
        },
        {
          id: "new-conversation",
          label: "New Conversation",
          accelerator: "CmdOrCtrl+Shift+N",
          enabled: false,
          click: sendAction("new-conversation"),
        },
        { type: "separator" },
        {
          id: "save",
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          enabled: false,
          click: sendAction("save"),
        },
        {
          id: "save-as",
          label: "Save as",
          enabled: false,
          click: sendAction("save-as"),
        },
        { type: "separator" },
        {
          id: "export",
          label: "Export",
          enabled: false,
          click: sendAction("export"),
        },
        {
          id: "print",
          label: "Print",
          accelerator: "CmdOrCtrl+P",
          enabled: false,
          click: sendAction("print"),
        },
        { type: "separator" },
        {
          id: "close",
          label: "Close",
          accelerator: "CmdOrCtrl+W",
          enabled: false,
          click: sendAction("close"),
        },
        {
          id: "delete",
          label: "Delete",
          enabled: false,
          click: sendAction("delete"),
        },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [
        {
          label: "Documentation",
          click: () => openDocumentationWindow(),
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

// Flip the `enabled` flag on every action item to match the renderer's
// declared set. Items not in `enabledIds` are disabled. Called whenever the
// active page (or its tab/document state) changes so the menu accurately
// reflects what's currently actionable.
export function setEnabledMenuActions(enabledIds: string[]): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;

  const enabled = new Set(enabledIds);
  for (const id of ACTION_MENU_IDS) {
    const item = menu.getMenuItemById(id);
    if (item) item.enabled = enabled.has(id);
  }
}

import { BrowserWindow, app, shell } from "electron";
import path from "path";

const isDev = !app.isPackaged;
// REPLACE: must match the loopback Express port in electron-express-react-router.
const SERVER_PORT = 19274;

// Origins that count as "inside the app". Anything else opens in the user's
// default browser — see attachExternalLinkHandlers.
const ALLOWED_HTTP_ORIGINS = new Set([
  "http://localhost:5173",
  `http://localhost:${SERVER_PORT}`,
  `http://127.0.0.1:${SERVER_PORT}`,
]);

// Protocols we're willing to hand to shell.openExternal. Anything else is
// dropped silently — we don't want a stray click on a custom-scheme link
// (vscode:, file:, …) to launch arbitrary OS handlers.
const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

const secondaryWindows = new Map<string, BrowserWindow>();

// Single-instance pointer to the primary window so anything in the main
// process (notifications, deep-link handlers, etc.) can focus or dispatch
// to it without re-importing the index module.
let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function baseUrl(): string {
  return isDev ? "http://localhost:5173" : `http://localhost:${SERVER_PORT}`;
}

// Route every link click that targets something other than the SPA itself out
// to the user's default browser. Without this, Electron navigates the
// BrowserWindow itself when the user clicks a markdown link in chat (or any
// other agent-rendered <a href>) — replacing the entire app with the linked
// page in a chrome-less window with no URL bar, a credible phishing surface.
// `target="_blank"` and `window.open(url)` route through setWindowOpenHandler;
// regular clicks and JS-driven `location.href` route through will-navigate.
// Empty / about:blank URLs (used by the print helper) pass through untouched.
export function attachExternalLinkHandlers(win: BrowserWindow): void {
  const isInternalUrl = (url: string): boolean => {
    if (url === "" || url === "about:blank") return true;
    try {
      return ALLOWED_HTTP_ORIGINS.has(new URL(url).origin);
    } catch {
      return false;
    }
  };

  const openIfSafe = (url: string): void => {
    try {
      if (SAFE_EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) {
        void shell.openExternal(url);
      }
    } catch {
      /* malformed URL — drop it */
    }
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) return { action: "allow" };
    openIfSafe(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    openIfSafe(url);
  });
}

export function openSecondaryWindow(
  key: string,
  route: string,
  options: { title: string; width: number; height: number },
): void {
  const existing = secondaryWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    title: options.title,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 8 },
    center: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  attachExternalLinkHandlers(win);
  win.loadURL(`${baseUrl()}${route}`);
  secondaryWindows.set(key, win);
  win.on("closed", () => secondaryWindows.delete(key));
}

// Example secondary-window helpers — replicate the pattern for whatever
// secondary windows your app needs.

export function openDocumentationWindow(): void {
  openSecondaryWindow("documentation", "/documentation", {
    title: "Documentation",
    width: 1000,
    height: 700,
  });
}

export function openAboutWindow(): void {
  const key = "about";
  const existing = secondaryWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 380,
    height: 420,
    title: "About",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 8 },
    center: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  attachExternalLinkHandlers(win);
  win.setMenu(null);
  win.loadURL(
    `${baseUrl()}/about?version=${encodeURIComponent(app.getVersion())}`,
  );
  secondaryWindows.set(key, win);
  win.on("closed", () => secondaryWindows.delete(key));
}

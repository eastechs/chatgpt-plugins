import { app, BrowserWindow } from "electron";
import path from "path";
import { createServer } from "./server.js";

// REPLACE: app name + reverse-DNS bundle id.
app.setName("MyApp");
app.setAppUserModelId("com.example.myapp");

const isDev = !app.isPackaged;
// REPLACE: pick a stable port, avoid well-known ones. Must match vite.config.ts proxy
// target and the renderer's API client.
const SERVER_PORT = 19274;

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 8 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Production loads the SPA from the same Express server. Use 127.0.0.1
  // explicitly to match the loopback bind in server.ts and avoid any IPv4 vs
  // ::1 ambiguity from `localhost` resolution.
  const baseUrl = isDev
    ? "http://localhost:5173"
    : `http://127.0.0.1:${SERVER_PORT}`;
  mainWindow.loadURL(baseUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await createServer(SERVER_PORT);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

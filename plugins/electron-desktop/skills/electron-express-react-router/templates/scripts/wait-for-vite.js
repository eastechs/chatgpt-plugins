// Wait for Vite dev server to be ready before launching Electron
const http = await import("http");

const MAX_RETRIES = 30;
const RETRY_DELAY = 500;

for (let i = 0; i < MAX_RETRIES; i++) {
  try {
    await new Promise((resolve, reject) => {
      const req = http.get("http://localhost:5173", (res) => {
        res.resume();
        resolve(undefined);
      });
      req.on("error", reject);
      req.setTimeout(1000, () => {
        req.destroy();
        reject(new Error("timeout"));
      });
    });
    console.log("Vite dev server is ready");
    process.exit(0);
  } catch {
    await new Promise((r) => setTimeout(r, RETRY_DELAY));
  }
}

console.error("Vite dev server did not start in time");
process.exit(1);

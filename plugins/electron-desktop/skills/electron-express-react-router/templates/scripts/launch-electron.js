// Launches Electron with a clean environment (drops ELECTRON_RUN_AS_NODE if set).
// Some shell environments set ELECTRON_RUN_AS_NODE=1 which makes Electron run as plain
// Node.js instead of launching the Electron runtime — that breaks main process startup.
const { spawn } = require("child_process");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [".", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

child.on("close", (code) => process.exit(code ?? 0));

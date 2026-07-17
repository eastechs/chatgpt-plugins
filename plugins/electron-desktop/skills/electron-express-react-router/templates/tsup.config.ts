import { defineConfig } from "tsup";
import { readdirSync, statSync } from "fs";
import { join } from "path";

// Collect all .ts files in src/main as separate entries (preserves module structure)
function collectEntries(dir: string, base = dir): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      Object.assign(entries, collectEntries(full, base));
    } else if (name.endsWith(".ts")) {
      const rel = full.substring(base.length + 1).replace(/\.ts$/, "");
      entries[rel] = full;
    }
  }
  return entries;
}

export default defineConfig({
  entry: collectEntries("src/main"),
  outDir: "dist/main",
  format: ["cjs"],
  target: "node20",
  platform: "node",
  splitting: false,
  sourcemap: true,
  clean: true,
  bundle: false, // Keep each file as its own module
  outExtension: () => ({ js: ".js" }), // Output .js so relative imports resolve
});

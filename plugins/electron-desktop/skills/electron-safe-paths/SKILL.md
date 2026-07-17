---
name: electron-safe-paths
description: Use when an Electron (or Node) app composes a filesystem path from user input, DB-stored data, or agent-tool arguments and is about to write/rename/unlink it. Adds a `safePathInside(boundary, target)` helper that resolves symlinks and rejects paths that escape the boundary, even when the target leaf doesn't exist yet.
---

# electron-safe-paths

A drop-in path-traversal-safe filesystem helper. One file, ~57 lines.

## When to use

- An API route receives a filename from the renderer and writes to it.
- An agent tool exposes filesystem operations (read/write/rename/unlink) to a model.
- Any code composes `path.join(userRoot, somethingFromDb)` and then calls `fs.*`.
- You need to reject `../` traversal **and** symlinks planted inside the boundary that escape it via `realpath`.

If you're calling `fs.writeFile` / `fs.rename` / `fs.unlink` with a path that has any user-influenced component, you want this.

## What it does

`safePathInside(boundaryRel, targetRel)` takes two paths, both relative to the user's home directory:

- Realpaths the home dir.
- Resolves the boundary, `mkdir -p`s it (so the realpath call never fails on a fresh install), realpaths it.
- Resolves the target. If it doesn't exist yet, walks up until it finds an ancestor that does, realpaths that, then re-stitches the not-yet-existing suffix on. This lets callers pre-compose paths for files they're about to create.
- Throws if the resolved target isn't equal to the boundary or a path strictly underneath it.

The "ancestor walk" is the bit you'd forget if you wrote this from scratch — without it, `realpath` throws on a not-yet-existing leaf and the caller has to either pre-create the file (defeating the purpose) or handle ENOENT and fall back to a non-realpath check (which a symlink defeats).

## Rules of engagement

- Both arguments are relative to `os.homedir()`. Don't pass absolute paths.
- The boundary will be created if it doesn't exist — don't pass a boundary you don't want auto-created.
- Throws synchronously. Wrap call sites in try/catch when the input is untrusted.
- Don't use the returned path lazily — by the time you write to it, a symlink could have been swapped in. Realpath right before the write, or open the dir handle once and `openat`-style underneath it. (For most desktop apps, calling `safePathInside` immediately before each `fs.*` call is enough.)

## Drop-in code

Save as `src/main/safe-paths.ts` (or wherever your main-process utilities live):

```typescript
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Resolves a relative path under a parent boundary directory, where both args
 * are expressed relative to the user's home directory. Returns the absolute
 * resolved path. Throws if the resolved path escapes the boundary even after
 * symlinks are resolved.
 *
 * Realpaths the home dir, the boundary itself (mkdir'd first so the call
 * always succeeds), and the deepest existing ancestor of the target. The
 * target leaf doesn't need to exist — any not-yet-existing suffix is stitched
 * back on so callers can pre-compose paths for files they're about to write.
 *
 * Use this anywhere the API or an agent tool composes a filesystem path from
 * DB-stored or user-supplied data and then performs a write/rename/unlink. A
 * symlink planted anywhere on the path is caught here before fs follows it.
 */
export function safePathInside(
  boundaryRel: string,
  targetRel: string,
): string {
  const realHome = fs.realpathSync(os.homedir());
  const rawBoundary = path.resolve(realHome, boundaryRel);
  fs.mkdirSync(rawBoundary, { recursive: true });
  const realBoundary = fs.realpathSync(rawBoundary);

  const rawTarget = path.resolve(realHome, targetRel);

  let realTarget: string;
  try {
    realTarget = fs.realpathSync(rawTarget);
  } catch {
    let dir = path.dirname(rawTarget);
    let suffix = path.basename(rawTarget);
    while (!fs.existsSync(dir)) {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      suffix = path.join(path.basename(dir), suffix);
      dir = parent;
    }
    try {
      realTarget = path.join(fs.realpathSync(dir), suffix);
    } catch {
      realTarget = rawTarget;
    }
  }

  if (
    realTarget !== realBoundary &&
    !realTarget.startsWith(realBoundary + path.sep)
  ) {
    throw new Error(`Path escapes ${boundaryRel}.`);
  }
  return realTarget;
}
```

## Usage example

```typescript
import { safePathInside } from "./safe-paths.js";

// Boundary = ~/Documents/MyApp/projects/<id>
// Target  = a filename submitted by the renderer
const safeAbs = safePathInside(
  `Documents/MyApp/projects/${projectId}`,
  `Documents/MyApp/projects/${projectId}/${filenameFromUser}`,
);
await fs.promises.writeFile(safeAbs, contents);
```

## Test cases worth writing

- `..` traversal: `targetRel = "Documents/MyApp/projects/p1/../../etc/passwd"` → throws.
- Symlink escape: pre-create a symlink inside the boundary pointing outside, request a path under it → throws.
- Non-existent leaf: `targetRel` ending in a file that doesn't exist yet, but with all ancestors inside the boundary → returns the resolved absolute path (success).
- Boundary-equals-target: passing the same path for both → returns the resolved boundary (success).
- Deeply-nested non-existent path: many missing levels → walks up correctly, succeeds if the existing ancestor is inside the boundary.

## Source

Lifted from [trident/src/main/safe-paths.ts](https://github.com/eastechs/trident/blob/main/src/main/safe-paths.ts).

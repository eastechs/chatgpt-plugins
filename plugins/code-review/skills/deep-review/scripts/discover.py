#!/usr/bin/env python3
"""
discover.py — scan a project root and emit a JSON manifest for deep-review.

Usage:
    python3 discover.py <project-root> [--scope <subpath>]

Emits JSON to stdout with:
    - stack: detected frameworks/languages
    - project_summary_hints: paths to files useful for inferring what the app does
    - files_by_module: reviewable files grouped by top-level module directory
    - excluded_dirs: what was skipped, with reasons
    - totals: file count, line count

Respects .gitignore when git is available; otherwise uses a built-in exclude list.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Directories always excluded, regardless of .gitignore
ALWAYS_EXCLUDE_DIRS = {
    "node_modules", "vendor", ".git", ".svn", ".hg",
    "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
    ".turbo", ".cache", ".parcel-cache", ".vite",
    "coverage", ".nyc_output", "htmlcov",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    ".tox", ".venv", "venv", "env",
    "target",  # Rust, Java
    ".gradle", ".idea", ".vscode",
    "bootstrap/cache", "storage/framework", "storage/logs", "storage/debugbar",
    "public/build", "public/hot", "public/storage",
    ".DS_Store",
}

# File extensions considered reviewable source
SOURCE_EXTENSIONS = {
    # PHP
    ".php",
    # JS/TS
    ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
    # UI frameworks with their own file types
    ".vue", ".astro",
    # Templates (security-relevant)
    ".blade.php", ".twig", ".erb", ".ejs", ".hbs", ".pug",
}

# Files to always exclude by name
ALWAYS_EXCLUDE_FILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "composer.lock",
    "Gemfile.lock", "poetry.lock", "Pipfile.lock", "Cargo.lock",
    ".DS_Store", "Thumbs.db",
}


def detect_stack(root: Path) -> list[str]:
    """Detect frameworks/languages from marker files.

    Focuses on stacks we have hints for: Laravel (+ NativePHP), JS/TS
    (React, Vue, Next, Nuxt, Astro, Electron, Node servers), and TypeScript.
    Unknown stacks get a generic "php" or "javascript" label so the reviewer
    still knows what it's looking at.
    """
    stack = []

    # PHP / Laravel / NativePHP
    composer_path = root / "composer.json"
    if composer_path.exists():
        try:
            composer = json.loads(composer_path.read_text())
            require = {**composer.get("require", {}), **composer.get("require-dev", {})}
            is_laravel = any(k.startswith("laravel/") for k in require)
            has_nativephp = any(k.startswith("nativephp/") for k in require)
            if is_laravel:
                stack.append("laravel")
            else:
                stack.append("php")
            if has_nativephp:
                stack.append("nativephp")
        except Exception:
            stack.append("php")

    # JS/TS — examine package.json once and map deps to framework tags
    pkg_path = root / "package.json"
    has_ts = (root / "tsconfig.json").exists()
    if pkg_path.exists():
        try:
            pkg = json.loads(pkg_path.read_text())
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}

            # Meta-frameworks first (they imply their underlying framework)
            if "next" in deps:
                stack.append("nextjs")
            if any(k in deps for k in ("nuxt", "nuxt3")):
                stack.append("nuxt")
            if "astro" in deps:
                stack.append("astro")

            # UI frameworks
            if "react" in deps:
                stack.append("react")
            if "vue" in deps:
                stack.append("vue")

            # Desktop shells
            if "electron" in deps or any(k.startswith("electron-") for k in deps):
                stack.append("electron")

            # Build tools worth knowing about
            if "vite" in deps:
                stack.append("vite")

            # Node servers
            if any(k in deps for k in ("express", "fastify", "koa", "@nestjs/core", "hono")):
                stack.append("node-server")

            # TypeScript (from deps or tsconfig)
            if "typescript" in deps or has_ts:
                stack.append("typescript")

            # If nothing framework-y was detected, label as plain JS
            framework_tags = {"nextjs", "nuxt", "astro", "react", "vue", "electron", "node-server"}
            if not (set(stack) & framework_tags):
                stack.append("javascript")
        except Exception:
            stack.append("javascript")
    elif has_ts:
        # tsconfig.json without package.json is unusual but possible
        stack.append("typescript")

    return stack


def summary_hints(root: Path) -> dict:
    """Point at files useful for inferring what the app does."""
    hints = {}

    # Codex project instructions are authoritative when present.
    for candidate in ["AGENTS.md", ".agents/AGENTS.md"]:
        p = root / candidate
        if p.exists():
            hints["agents_md"] = str(p.relative_to(root))
            break

    # Preserve other agent-specific project guidance when present.
    for candidate in ["CLAUDE.md", ".claude/CLAUDE.md"]:
        p = root / candidate
        if p.exists():
            hints["claude_md"] = str(p.relative_to(root))
            break

    for candidate in ["README.md", "README.rst", "README.txt", "README"]:
        p = root / candidate
        if p.exists():
            hints["readme"] = str(p.relative_to(root))
            break

    if (root / "package.json").exists():
        hints["package_json"] = "package.json"
    if (root / "composer.json").exists():
        hints["composer_json"] = "composer.json"
    if (root / "pyproject.toml").exists():
        hints["pyproject_toml"] = "pyproject.toml"

    # Route files — often describe what the app actually does
    routes = []
    for candidate in ["routes/web.php", "routes/api.php", "routes/console.php",
                      "src/routes", "app/routes", "config/routes.rb",
                      "src/app", "pages", "app/pages"]:
        p = root / candidate
        if p.exists():
            routes.append(str(p.relative_to(root)))
    if routes:
        hints["routes"] = routes

    return hints


def git_ls_files(root: Path) -> list[str] | None:
    """Use git ls-files when available (respects .gitignore)."""
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-co", "--exclude-standard"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return [line for line in result.stdout.splitlines() if line]
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return None


def walk_fs(root: Path) -> list[str]:
    """Fallback walk when git isn't available."""
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune excluded directories
        dirnames[:] = [d for d in dirnames if d not in ALWAYS_EXCLUDE_DIRS and not d.startswith(".")]
        rel_dir = os.path.relpath(dirpath, root)
        for fname in filenames:
            if fname in ALWAYS_EXCLUDE_FILES:
                continue
            rel = os.path.normpath(os.path.join(rel_dir, fname)) if rel_dir != "." else fname
            files.append(rel.replace(os.sep, "/"))
    return files


def is_reviewable(path: str) -> bool:
    """Check if a file is worth reviewing based on extension."""
    p = path.lower()
    # Handle .blade.php as a special compound extension
    if p.endswith(".blade.php"):
        return True
    ext = os.path.splitext(p)[1]
    return ext in SOURCE_EXTENSIONS


def count_lines(path: Path) -> int:
    try:
        with open(path, "rb") as f:
            return sum(1 for _ in f)
    except Exception:
        return 0


def module_key(path: str) -> str:
    """
    Group a file into a module. Uses the first two path components
    for deeply nested source trees, falling back to the first component
    or 'root' for top-level files.
    """
    parts = path.split("/")
    if len(parts) == 1:
        return "_root"
    # For common patterns, use 2 levels of nesting
    top = parts[0]
    if top in ("app", "src", "lib", "packages") and len(parts) >= 3:
        return f"{parts[0]}/{parts[1]}"
    return top


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", help="Project root to scan")
    parser.add_argument("--scope", default=None, help="Optional subpath to limit review to")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"Error: {root} is not a directory", file=sys.stderr)
        sys.exit(1)

    stack = detect_stack(root)
    hints = summary_hints(root)

    # Get all files
    files = git_ls_files(root)
    used_git = files is not None
    if files is None:
        files = walk_fs(root)

    # Apply scope filter if provided
    if args.scope:
        scope = args.scope.strip("/").replace(os.sep, "/")
        files = [f for f in files if f == scope or f.startswith(scope + "/")]

    # Apply always-exclude (belt and suspenders; git ls-files already respects .gitignore
    # but we still want to exclude things like vendor/ in repos that track it)
    def excluded(path: str) -> str | None:
        parts = path.split("/")
        for part in parts[:-1]:
            if part in ALWAYS_EXCLUDE_DIRS:
                return part
        # Multi-segment excludes
        for multi in ("bootstrap/cache", "storage/framework", "storage/logs",
                      "storage/debugbar", "public/build", "public/hot"):
            if path.startswith(multi + "/") or path == multi:
                return multi
        if parts[-1] in ALWAYS_EXCLUDE_FILES:
            return parts[-1]
        return None

    reviewable = []
    excluded_counts = {}
    for f in files:
        reason = excluded(f)
        if reason:
            excluded_counts[reason] = excluded_counts.get(reason, 0) + 1
            continue
        if is_reviewable(f):
            reviewable.append(f)

    # Group by module with line counts
    files_by_module: dict[str, list[dict]] = {}
    total_lines = 0
    for f in reviewable:
        key = module_key(f)
        lines = count_lines(root / f)
        total_lines += lines
        files_by_module.setdefault(key, []).append({"path": f, "lines": lines})

    # Sort each module's files by line count desc, then alphabetically
    for key in files_by_module:
        files_by_module[key].sort(key=lambda x: (-x["lines"], x["path"]))

    # Sort modules by total lines desc
    module_order = sorted(
        files_by_module.keys(),
        key=lambda k: -sum(f["lines"] for f in files_by_module[k]),
    )
    files_by_module = {k: files_by_module[k] for k in module_order}

    manifest = {
        "project_root": str(root),
        "scope": args.scope,
        "stack": stack,
        "project_summary_hints": hints,
        "used_git_ls_files": used_git,
        "totals": {
            "files_reviewable": len(reviewable),
            "lines_reviewable": total_lines,
            "modules": len(files_by_module),
        },
        "excluded_counts": excluded_counts,
        "files_by_module": files_by_module,
    }

    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

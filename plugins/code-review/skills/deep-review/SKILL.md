---
name: deep-review
description: Orchestrate a parallel, multi-agent deep code review of the current project. Use this skill whenever the user says "deep review", "deep-review", "/deep-review", "review my codebase", "audit this project", "full code review", "comprehensive review", or asks for a broad review across the whole codebase (not a single file). This skill runs any configured static analyzers (eslint, phpstan, pint, prettier, tsc, biome, psalm, etc.) when present, then dispatches multiple subagents in parallel — each reviewing a slice of the codebase for lint-level issues, correctness bugs, security vulnerabilities, and domain/business-logic errors — and aggregates findings into a markdown report plus a chat summary. Always excludes node_modules, vendor, build artifacts, and framework scaffolding. Prefer this skill over single-file review tools whenever the user is asking about the project as a whole.
---

# Deep Review

A multi-agent orchestrator for deep code review of an entire project. The goal is to surface issues that actually matter — correctness bugs, security holes, domain/business-logic errors, and low-hanging lint problems — while deliberately ignoring framework scaffolding, generated code, and boilerplate.

This is not a linter and not a single-file review. It's a coordinator: it scans, it partitions, it dispatches independent reviewers in parallel, and it consolidates findings.

## Why this exists (so you calibrate correctly)

Most "AI code review" produces noise: every framework pattern flagged as "potential SQL injection", every try/catch flagged as "consider error handling", a dump of surface observations the user has to triage. That's useless.

A good deep review looks more like a senior engineer reading the code with context about what the app does. It finds the real bugs — the condition that's reversed, the auth check that's missing on one endpoint, the invariant that's enforced in one place and not another, the secret that got committed. It skips the noise.

Hold that bar. When in doubt, omit rather than speculate. A confident medium-severity finding is worth more than five low-confidence high-severity ones.

## Workflow overview

Four phases, in order: **Scan → Lint → Dispatch → Aggregate**.

### Phase 1 — Scan the project

Run the discovery script from the skill directory:

```bash
python3 "$SKILL_DIR/scripts/discover.py" . > /tmp/deep-review-manifest.json
```

Replace `$SKILL_DIR` with the actual path to this skill's directory. The script emits a JSON manifest containing:

- `stack`: detected frameworks/languages (e.g. `["laravel", "vite", "react", "typescript"]`)
- `project_summary_hints`: paths to README, package.json/composer.json descriptions, and top-level route files — useful for inferring what the app does
- `files_by_module`: reviewable files grouped by top-level module directory, each with estimated line counts
- `excluded_dirs`: what was skipped (node_modules, vendor, build artifacts, etc.)
- `totals`: file count, line count

Then **read the summary hints** (README, composer.json, package.json description, top-level routes, and applicable `AGENTS.md` or `CLAUDE.md` files) and write a one-paragraph mental model of what the app does. This grounding is what separates a real review from a keyword scan. Reviewers need it.

For Laravel projects specifically: CLAUDE.md scaffolded by recent Laravel versions contains the package list and project conventions. Include a short summary of it in the project summary you pass to reviewers, so they don't duplicate effort trying to infer what's already documented. Also note whether Laravel Boost MCP tools appear to be available — reviewers can use those directly.

### Phase 2 — Run configured linters

```bash
bash "$SKILL_DIR/scripts/run_linters.sh" . > /tmp/deep-review-lint.json 2> /tmp/deep-review-lint.err
```

The script detects and runs (when present and configured): eslint, prettier --check, tsc --noEmit, biome, phpstan, psalm, pint, php-cs-fixer, phpcs. It tries to get JSON output from each tool; when a tool only outputs text, that's captured verbatim. Tool failures are non-fatal — they're recorded and the review continues.

The result is a JSON object keyed by tool name, where each entry has `ran`, `exit_code`, and `findings` (either structured or raw text).

### Phase 3 — Dispatch reviewers in parallel

Partition `files_by_module` into **3–10 chunks**. Each chunk should be roughly 20–80 files or ~3000–8000 lines. Rules:

- Prefer module-based grouping — each reviewer should see a cohesive unit (e.g., `app/Http/Controllers/Billing` + `app/Services/Billing` + `app/Models/Invoice`, not a random mix).
- Split oversized modules into sub-chunks if a single module exceeds ~8000 lines.
- Bundle tiny related modules together rather than creating a reviewer for 3 files.
- For large codebases, prioritize: controllers, services, models, policies, middleware, jobs, commands, and domain logic first. Config, migrations, and seeders only if there's evidence of meaningful customization.

For each chunk, call `spawn_agent` in the **same turn** so the reviewers run in parallel. Each subagent gets the prompt from `assets/reviewer-prompt.md` with these substitutions:

- `{PROJECT_SUMMARY}`: your one-paragraph mental model from Phase 1
- `{STACK}`: detected stack list, comma-separated
- `{FILES}`: newline-separated list of file paths in this chunk
- `{LINT_FINDINGS}`: the subset of `/tmp/deep-review-lint.json` applicable to these files (pre-filter; don't dump the whole file)
- `{STACK_HINTS}`: concatenated contents of the relevant `references/hints-<stack>.md` files for the stacks detected in this chunk

Each reviewer applies **all four lenses** (lint / correctness / security / domain logic) — not one lens per reviewer. The rubric at `references/review-rubric.md` defines each lens; include its full contents in the prompt.

Launch all reviewers in a single turn so they run concurrently.

### Phase 4 — Aggregate and report

When all reviewers have returned, collect their JSON findings arrays. Then:

1. **Deduplicate** by `(file, line, title)`. If two reviewers found the same thing, keep one and note the duplication count.
2. **Sort** by severity (critical → high → medium → low), then category, then file.
3. **Separate** confident findings from low-confidence/speculative ones. Low-confidence items go under a "Possibly worth investigating" section at the bottom, not mixed with confident findings.
4. **Write the report** to `deep-review-YYYY-MM-DD-HHMM.md` in the project root. If the project already has a dedicated review directory such as `.codex/reviews/` or `.claude/reviews/`, use it. Use the template in `references/output-format.md`.
5. **Print a chat summary** with: counts by severity, top 3–5 findings by severity, tools that ran (or failed), chunks dispatched, and the path to the full report.

## What to skip (critical — do not flag these)

The fastest way to make this skill useless is to flag every framework-standard pattern. Skip:

- **Unmodified scaffold**: default middleware stubs, vanilla `Exceptions/Handler.php`, default service providers with no custom bindings, scaffolded `AuthServiceProvider`, default Next.js `_app.tsx`/`layout.tsx` with no app-specific logic.
- **Generated files**: compiled assets in `public/build`, `.next/`, lockfiles, generated API clients, vanilla migrations with no custom logic.
- **Idiomatic framework usage**: Eloquent queries aren't SQL injection candidates unless `DB::raw`, `whereRaw`, or `selectRaw` is used with unsanitized input. React components using standard hooks aren't "hook misuse" just for existing. Laravel controllers using FormRequests aren't missing validation.
- **Style bikeshedding**: inconsistent quotes, trailing commas, spacing — unless a linter is specifically flagging it and the project clearly cares about it.

Heuristic: if removing this file wouldn't change behavior for end users of the app, it probably doesn't deserve deep scrutiny. Focus on where humans wrote actual business decisions.

## Scope control

The default is to review the entire project. If the user asks to review only part of it (e.g., "deep review on src/billing"), constrain Phase 1's discovery to that path, then proceed normally. Everything else is unchanged.

## References

- `references/review-rubric.md` — the four review lenses with what each reviewer looks for, severity definitions, and confidence guidance
- `references/hints-laravel.md` — Laravel + NativePHP patterns (mass assignment, Eloquent pitfalls, queue/job safety, policies, local-server exposure)
- `references/hints-js-ts.md` — JS/TS/React/Vue/Next/Nuxt/Astro/Electron/Node patterns (XSS, async pitfalls, IPC security, env leakage, Astro islands)
- `references/output-format.md` — JSON finding schema and final markdown report template
- `assets/reviewer-prompt.md` — the prompt template dispatched to each subagent
- `scripts/discover.py` — file discovery and stack detection
- `scripts/run_linters.sh` — linter auto-detection and execution

## Notes on environment

Use Codex multi-agent collaboration when available: dispatch reviewers with `spawn_agent`, collect them with `wait_agent`, and aggregate only after every reviewer returns. If subagents are unavailable, review each chunk sequentially with the same prompt. The output format stays the same.

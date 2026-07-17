---
name: project-interview
description: >-
  Interviews the user about a codebase, inspects config and relevant source
  files, and writes a comprehensive README.md. Use only when explicitly invoked
  (e.g. /project-interview or @project-interview).
---

# Project Interview

Discover the project from configs and an interactive interview, then write `README.md`.

## Workflow

Copy this checklist and track progress:

```
Interview Progress:
- [ ] Phase 1: Config discovery
- [ ] Phase 2: Interview (until stop/end)
- [ ] Phase 3: Targeted file review
- [ ] Phase 4: README decision + write
```

### Phase 1: Config discovery

Scan the project root (and obvious monorepo package roots) for meaningful config. Read what exists; do not invent files.

**Always check when present:**
- `package.json` / `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` / `bun.lock`
- `composer.json` / `composer.lock`
- `Cargo.toml` / `go.mod` / `pyproject.toml` / `requirements.txt` / `Gemfile`
- `tsconfig.json` / `jsconfig.json`
- Framework configs: `next.config.*`, `nuxt.config.*`, `astro.config.*`, `vite.config.*`, `webpack.config.*`, `remix.config.*`
- App/runtime: `Dockerfile*`, `docker-compose*.yml`, `Procfile`, `fly.toml`, `vercel.json`, `netlify.toml`, `wrangler.toml`, `railway.toml`
- Tooling: `.env.example`, `Makefile`, `Taskfile*`, `justfile`, `turbo.json`, `nx.json`, `lerna.json`
- CI: `.github/workflows/*`, `.gitlab-ci.yml`, `circleci` configs
- Existing docs: `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/**`

From configs, note: project name, description, scripts, dependencies, package manager, language/runtime, frameworks, deploy targets, and workspace layout.

Briefly summarize what you found (5–10 bullets max), then start the interview.

### Phase 2: Interview

Ask questions one at a time (or a short related pair). Prefer open questions that surface intent, not trivia already obvious from configs.

**Stop conditions:** End the interview immediately when the user says `stop`, `end`, `done`, `that's enough`, or equivalent. Do not ask “one more” after that — proceed to Phase 3.

**Question themes** (adapt to the stack; skip what configs already answered):

1. Purpose — what problem does this solve, and for whom?
2. Current status — prototype, production, maintenance, abandoned?
3. Architecture — major components, data flow, boundaries
4. Setup — how a new contributor runs it locally
5. Key workflows — the 3–5 things people do most
6. Non-obvious gotchas — env vars, secrets, platform quirks
7. Ownership / audience — who maintains it; who reads the README
8. Out of scope — what this project deliberately does *not* do
9. Roadmap — near-term plans worth documenting
10. Anything else they want in the README

Follow up when an answer names a module, path, API, or behavior you have not inspected yet. Keep a running mental (or checklist) note of files/dirs to review in Phase 3.

### Phase 3: Targeted file review

Using interview answers + config findings, read the relevant source and docs:

- Entry points and bootstrapping
- Core domain modules the user emphasized
- Auth, data, and external integrations they mentioned
- Scripts/commands they described as “how you run it”
- Existing README / docs for accuracy gaps

Do not dump the whole tree into context. Prefer depth on what the interview made important. If answers conflict with the code, trust the code and note the discrepancy when writing the README (or ask one clarifying question if blocking).

### Phase 4: README decision + write

**Decision rule:**

| Existing `README.md` | Action |
|----------------------|--------|
| Missing | Write a full README. Do not ask. |
| Stub / boilerplate (see below) | Replace with a full README. Do not ask. |
| Substantive content | Ask whether to replace, merge/update, or abort. Wait for an answer before writing. |

Treat as stub/boilerplate when most of these hold:
- Default scaffold text (“Getting Started”, create-react-app / Vite / Laravel / Rails placeholders)
- Only a title + one vague sentence
- Mostly badges/TODOs with no real project-specific guidance
- Clearly unfinished (`TODO`, `TBD`, `Replace this`, lorem)

**Write** `README.md` at the project root using the template in [readme-template.md](readme-template.md).

Fill every section you have evidence for (configs, interview, file review). Omit sections that do not apply — do not leave empty placeholders or “TBD” headings. Prefer concrete commands and paths over vague advice.

After writing, give a short summary: what was discovered, how many interview turns, and whether the README was created, replaced, or merged.

## Rules

- Do not invent product facts the user did not state and the code does not show.
- Prefer the user's wording for purpose/audience when it is clear.
- Keep the interview moving; do not lecture between questions.
- Never commit the README unless the user asks.

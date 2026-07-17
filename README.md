# Eastechs ChatGPT Plugins

Focused Codex and ChatGPT plugins maintained by [Eastechs](https://github.com/eastechs).

## Plugins

| Plugin | Purpose | Skills |
|---|---|---|
| `electron-desktop` | Build secure Electron desktop applications and native integrations | 10 |
| `electron-ai-workspace` | Add provider routing, pricing, RAG, and persistent chat to Electron | 5 |
| `laravel-ai` | Build Laravel AI agents, tools, and streamed chat integrations | 2 |
| `code-review` | Review diffs, audit codebases, and verify implementation work | 3 |
| `project-discovery` | Turn project interviews into plans and documentation | 2 |

`electron-ai-workspace` expects the foundation supplied by `electron-desktop` or an equivalent Electron server, database, authentication, and settings stack. Install and apply `electron-desktop` first when starting from scratch.

## Install

Add the GitHub repository as a marketplace:

```bash
codex plugin marketplace add eastechs/chatgpt-plugins --ref main
```

Install a plugin from the Eastechs marketplace:

```bash
codex plugin add electron-desktop@eastechs
codex plugin add electron-ai-workspace@eastechs
```

Replace the plugin name with any entry from the table above.

## Local development

Add a local checkout as a marketplace:

```bash
codex plugin marketplace add /path/to/chatgpt-plugins
```

Validate the entire repository:

```bash
python3 -m pip install -r requirements-dev.txt
python3 scripts/validate_all.py
```

Each plugin is independently versioned under `plugins/<plugin-name>/`. Runtime files and references must stay inside their owning plugin so every marketplace entry remains independently installable.

## License

Released under the [MIT License](LICENSE).

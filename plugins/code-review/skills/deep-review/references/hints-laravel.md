# Laravel / NativePHP Review Hints

## Get project context first — don't duplicate what's already available

Before applying any generic Laravel rule, gather project-specific context:

1. **Read applicable `AGENTS.md` files** for project-specific Codex instructions.
2. **Read `CLAUDE.md`** in the project root if it exists. Some Laravel projects scaffold one with installed packages and project conventions.
3. **Use Laravel Boost MCP tools** if available (tools named `mcp__laravel-boost__*` or similar). Boost exposes first-party Laravel doc search, schema inspection, tinker, and artisan. Use it to verify whether a pattern you're about to flag is current-recommended or outdated — don't flag something as an antipattern based on stale knowledge.

Boost covers **first-party Laravel packages only**, not NativePHP. The NativePHP section below is where the skill carries its own weight.

The checklist below is *review-specific antipatterns* — things to actively scan for in a chunk. It's intentionally terse; assume the reviewer already has project context from AGENTS.md, CLAUDE.md, and/or Boost.

## Security antipatterns to scan for

- **Mass assignment**: `$request->all()` into `create()` / `update()` / `fill()`. Check the model's `$fillable` / `$guarded`. Empty `$guarded = []` effectively disables protection. Watch for role-like fields (`is_admin`, `role_id`, `team_id`) reachable through mass assignment.
- **Raw SQL with user input**: `DB::raw()`, `DB::select()`, `DB::statement()`, `->whereRaw()`, `->orderByRaw()`, `->selectRaw()` with interpolated values. Bindings are fine; `"col = $value"` is not.
- **Column-name injection**: `->orderBy($request->input('sort'))` and similar — user-controlled column names.
- **Trusting request identity**: Controllers accepting `user_id` / `team_id` from the request body/query and using it directly, instead of `$request->user()` / `auth()->user()`.
- **Missing/empty policies**: Policies that return `true` unconditionally, or never registered in `AuthServiceProvider`. `Gate::allows()` results computed but never checked.
- **Blade XSS**: `{!! $variable !!}` on user-controlled content. `{{ }}` is the default for a reason.
- **Secret leakage via env fallbacks**: `env('API_KEY', 'sk_live_real_looking_fallback')` in config files — when config is cached, the fallback is what ships.
- **File uploads**: `->store()` without MIME / size / extension validation. `getClientOriginalName()` used in paths without sanitization.

## Correctness antipatterns to scan for

- **N+1**: `$model->relation` inside a loop without `->with()`. Obvious but easy to miss in nested views/components.
- **`first()` vs `firstOrFail()`**: `first()` return value treated as non-null.
- **Swallowed transactions**: `DB::transaction()` with a try/catch *inside* the closure catching and not re-throwing — the transaction commits on logical failure.
- **Queue job staleness**: Jobs that don't use `SerializesModels` can capture and rehydrate stale model state.
- **Ignored `save()` return**: Returns `false` on failure with some drivers — silent data loss.
- **Timezones**: Carbon comparisons that ignore the app/user timezone.
- **Global scopes assumed-away**: a query that should be filtered by a global scope, but isn't (e.g., soft-delete scope bypassed via a relationship that doesn't re-apply it).

## Business-logic antipatterns to scan for

- Business rules enforced in one call path (Livewire component, HTTP controller) but not another (webhook handler, artisan command, Nova action, queue job).
- Soft-deleted records leaking through relationships that don't scope on `deleted_at`.
- Model observers / `boot()` with side effects that don't run in seeders or tests, leaving the DB in a state the app never sees in prod.

## NativePHP-specific (not covered by Boost)

NativePHP wraps a Laravel app in an Electron-based desktop shell. The PHP side is regular Laravel, but the threat model shifts — the app runs on the user's machine with their filesystem.

- `Native\Laravel\Facades\Shell::openExternal($url)` with user-controlled URLs — arbitrary scheme can become arbitrary command execution on some platforms. Allowlist schemes and/or hosts.
- `Native\Laravel\Facades\Window::open()` loading URLs from untrusted sources.
- `Native\Laravel\Facades\ChildProcess` with user-controlled argument vectors.
- Local HTTP server bound to `0.0.0.0` instead of `127.0.0.1` — exposes the app to the local network (coffee-shop wifi surface).
- Routes that rely on "it's only reachable locally" for auth — that assumption breaks the moment the server binds past loopback.
- `Storage::disk('local')` paths accepting user input without normalization — on desktop, the "local" disk is the user's filesystem.
- Menu items and global shortcuts triggering destructive actions without confirmation.

Also review the Electron bootstrap layer if present in the project — see `hints-js-ts.md` → Electron section. That's where the most severe issues in a NativePHP app usually live (contextIsolation, nodeIntegration, IPC sender validation).

## What to skip

- Default `AuthServiceProvider`, `RouteServiceProvider`, `EventServiceProvider` with no custom bindings.
- `Exceptions/Handler.php` matching the scaffold.
- `Kernel.php` middleware lists matching the default stack.
- Vanilla migrations (standard tables with `id` + `timestamps` and nothing custom).
- `config/*.php` matching the published defaults unless they reference secrets as fallbacks.
- `resources/views/welcome.blade.php` if unchanged from scaffold.

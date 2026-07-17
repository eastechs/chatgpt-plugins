# Review Rubric

Each reviewer applies all four lenses to the files in their chunk. This document defines what each lens covers, how to rate severity, and how to report confidence.

## The four lenses

### 1. Lint-level issues (lowest-hanging fruit)

Things a good linter would catch if configured. Report these even if the project has no linter configured, because that's often when they're most useful.

- Unused imports, variables, functions, parameters
- Undeclared or shadowed variables
- Dead code (unreachable branches, unused exports, commented-out blocks that are clearly stale)
- Obvious type mismatches (wrong argument types, returning wrong shape)
- Inconsistent patterns within a file that suggest a bug rather than style (e.g., three functions handle errors one way, one handles it a different way)

If a linter already flagged it (it'll appear in `LINT_FINDINGS`), don't re-flag it unless you have additional context — instead, add context like "this is flagged by eslint AND also leaks into the response body, so it's actually a security issue not just lint".

### 2. Correctness & functional issues

Real bugs. These are the highest-value findings.

- Off-by-one errors, boundary conditions
- Null/undefined dereferences, especially on values that could legitimately be null
- Incorrect error handling: swallowed exceptions, empty catch blocks, errors logged but not propagated, missing error paths
- Async/await misuse: missing await, unhandled promise rejections, race conditions, non-atomic read-modify-write patterns
- Incorrect conditionals: `==` vs `===` where it matters, reversed logic, dead branches
- State management issues: mutations of shared state, stale closures, missing dependencies in effects
- Concurrency/ordering issues: assumptions that two operations are atomic when they aren't
- Resource leaks: unclosed file handles, connections, subscriptions
- Input validation missing where it matters for correctness (not just security)

### 3. Security issues

- **Injection**: SQL (raw queries with unsanitized input), command injection (`exec`, `shell_exec`, `subprocess(shell=True)` with user input), LDAP injection, template injection
- **XSS**: unescaped user input in views/templates, `dangerouslySetInnerHTML` with untrusted content, unsafe `v-html`
- **CSRF**: state-changing endpoints without CSRF protection, especially API endpoints that accept cookies
- **Authentication/Authorization**: missing auth middleware on sensitive routes, authorization checks that use the request input instead of the authenticated user, policies/gates that return true unconditionally, privilege escalation via role assignment endpoints
- **Mass assignment**: models without `$fillable`/`$guarded` where user input reaches `create`/`update`/`fill`
- **Secrets**: hardcoded API keys, tokens, passwords, connection strings in source; secrets committed to `.env.example` that look real
- **Session/cookie issues**: missing `HttpOnly`/`Secure`/`SameSite`, predictable session IDs, session fixation
- **Open redirects**: unvalidated redirect targets from user input
- **Path traversal**: user-controlled paths reaching file operations without normalization
- **Insecure deserialization**: `pickle.loads`, `unserialize`, `yaml.load` on untrusted input
- **Weak crypto**: MD5/SHA1 for passwords, hardcoded IVs, ECB mode, `Math.random()` for security tokens
- **Rate limiting**: missing on login, password reset, or expensive endpoints
- **Information disclosure**: stack traces returned to the client, verbose error messages revealing internals, debug mode on in production code paths
- **SSRF**: server-side HTTP requests with user-controlled URLs and no allowlist
- **IDOR**: direct object references without authorization check (e.g., `/users/{id}` that returns any user's data)

### 4. Domain/business-logic issues

The highest-context lens. Use the project summary to reason about what the app is supposed to do, then look for:

- Invariants that should hold but aren't enforced (e.g., an order can't be both "shipped" and "cancelled"; a user can't vote twice; a balance shouldn't go negative)
- Inconsistencies between related flows (create does validation X, but update doesn't; webhook handler trusts input that the API endpoint validates)
- Off-by-one or rounding errors in domain math (pro-rata billing, tax calculation, inventory decrements)
- Missing validations on domain-critical fields (negative prices, non-integer quantities, invalid state transitions)
- Business rules that are hardcoded in one place and re-implemented incorrectly elsewhere
- Race conditions that matter for domain correctness (two concurrent requests both pass the "can afford this" check, then both deduct)
- Soft-delete patterns that are incomplete (deleted records still appear in some queries)
- Feature flags or config values used inconsistently

This lens requires you to actually think about what the app does. If you can't infer the domain well enough from the project summary and the code, say so — don't invent invariants.

## Severity

Four levels. Be honest about severity; don't inflate.

- **critical**: exploitable security vulnerability, data corruption, or bug that breaks a core user flow in production. Needs immediate attention.
- **high**: security hole requiring specific conditions; a real bug affecting real users; a domain invariant that's actively violated in normal operation.
- **medium**: a bug under less common conditions; a security concern that's defense-in-depth rather than directly exploitable; correctness issue that degrades behavior but doesn't break it.
- **low**: lint-level issues, minor style inconsistencies that suggest bugs, dead code, speculative concerns worth noting.

## Confidence

For each finding, note confidence:

- **confident**: you can point to the exact line(s) and explain the concrete harm. A reviewer looking at this would agree.
- **possible**: the pattern looks suspicious but requires project context you don't fully have. Or the harm depends on how callers use this code.

Confident findings go in the main report sections. Possible findings go in a "Possibly worth investigating" section at the bottom. Don't mix them — mixing kills the signal-to-noise of the whole report.

## Things that are NOT findings

Do not report:

- Style preferences (tab width, quote style, import order) unless a linter is specifically flagging them
- "Consider adding comments" or "consider refactoring" unless there's a concrete correctness issue
- "This could use more tests" — that's not a code review finding
- "This variable name could be clearer" unless the name is actively misleading
- Framework idioms that the reviewer happens to dislike (if Laravel's `$request->validate()` is being used correctly, it's not a finding)
- Theoretical concerns with no basis in the actual code ("what if someone passed a billion items here?" — only flag if there's evidence this happens or could plausibly happen)

When in doubt about whether something is a finding, omit it. A shorter report with real issues beats a long report with noise.

# Output Format

Two formats are defined here: the **JSON schema** each reviewer returns, and the **markdown report** the orchestrator writes.

## Reviewer output (JSON)

Each reviewer returns a single JSON object wrapped in a fenced `json` code block at the end of its response:

```json
{
  "chunk_id": "billing",
  "files_reviewed": ["app/Http/Controllers/BillingController.php", "app/Services/Billing/ChargeService.php"],
  "findings": [
    {
      "severity": "critical",
      "category": "security",
      "confidence": "confident",
      "file": "app/Http/Controllers/BillingController.php",
      "line": 42,
      "title": "Mass assignment via Request::all() into User model",
      "detail": "BillingController::update passes $request->all() into User::update(). The User model has $guarded = [] (empty), so fields like is_admin and team_id are mass-assignable. A malicious user can elevate privileges by including is_admin=1 in the update request.",
      "fix": "Replace $request->all() with $request->validated() from a FormRequest that whitelists only billing-related fields (email, billing_address, etc). Also add a non-empty $guarded or $fillable to the User model."
    }
  ],
  "notes": "Skipped AuthServiceProvider and RouteServiceProvider as they match the default scaffold. Linter reported 3 unused imports which I've included below as low-severity."
}
```

Field rules:

- `severity`: one of `"critical" | "high" | "medium" | "low"`
- `category`: one of `"security" | "correctness" | "business_logic" | "lint" | "performance"`
- `confidence`: one of `"confident" | "possible"`
- `file`: path relative to project root
- `line`: integer, 1-indexed. Use the first relevant line; use 0 if the finding applies to the whole file.
- `title`: one line, under 120 chars, specific enough to be useful in a list view
- `detail`: explain the concrete harm and the reasoning. Not just "this is bad" — *why* is it bad, *what* could go wrong, *under what conditions*.
- `fix`: concrete suggestion. Optional but strongly encouraged for non-trivial findings.

If a reviewer has nothing to report for its chunk, it still returns the JSON with an empty `findings` array and notes explaining why (e.g., "chunk was all vanilla Laravel scaffolding").

## Final report (markdown)

The orchestrator writes this to `deep-review-YYYY-MM-DD-HHMM.md` in the project root, or to an existing project review directory such as `.codex/reviews/` or `.claude/reviews/`.

Template:

```markdown
# Deep Review — {YYYY-MM-DD HH:MM}

**Project:** {project name from package.json / composer.json / directory name}
**Summary:** {one-paragraph description of what the app does, written by the orchestrator during Phase 1}

## Totals

| Severity | Count |
|----------|-------|
| Critical | N |
| High     | N |
| Medium   | N |
| Low      | N |

**Chunks reviewed:** N
**Files reviewed:** N
**Linters run:** eslint (passed), phpstan (3 findings), pint (clean)
**Linters skipped:** prettier (no config found), tsc (no tsconfig)

---

## Critical

### [security] {title}
**File:** `path/to/file.ext:42`

{detail}

**Suggested fix:** {fix}

---

### [correctness] {title}
...

---

## High

{same structure}

---

## Medium

{same structure}

---

## Low

Low-severity findings are listed compactly:

- `path/to/file.ext:10` — [lint] Unused import `Foo`
- `path/to/file.ext:15` — [lint] Variable `x` shadows outer scope
- ...

---

## Possibly worth investigating

Findings flagged with lower confidence — these are patterns that look suspicious but depend on context this review doesn't fully have.

### [domain] {title}
**File:** `path/to/file.ext:42`
**Confidence:** possible

{detail}

---

## Appendix: reviewer notes

Per-chunk notes from reviewers (what was skipped and why, surprising findings, etc.).

- **Chunk `billing`**: 12 files reviewed. Skipped 3 migration files matching Laravel defaults. Notes: BillingController has inconsistent error handling compared to OrderController — may be worth unifying.
- **Chunk `auth`**: 8 files. All lint-clean. The LoginController uses a custom rate limiter that may not be wired up correctly — flagged as "possible" above.
- **Chunk `admin`**: 0 findings. Seemed to be thin wrappers around shared services already reviewed elsewhere.
```

## Chat summary

After writing the report, print to chat (not to the file):

```
Deep review complete.

Totals
- Critical: 2
- High: 5
- Medium: 11
- Low: 18 (mostly lint)

Top findings
1. [critical/security] Mass assignment in BillingController — app/Http/Controllers/BillingController.php:42
2. [critical/security] Hardcoded API key in config/services.php:18
3. [high/correctness] Missing await in PaymentWebhookHandler — app/Jobs/ProcessWebhook.php:67
4. [high/security] CSRF exempt on admin role-change endpoint — routes/web.php:120
5. [high/business_logic] Invoice total can go negative due to unchecked credit — app/Services/Billing/InvoiceService.php:88

Linters: eslint (clean), phpstan (3 findings), pint (clean). prettier skipped (no config).

Full report: ./deep-review-2026-04-19-1445.md
```

Keep the chat summary tight. The full report is where detail lives.

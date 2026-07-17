---
name: review-loop
description: "Post-execution review loop. Use after completing plan execution, implementing features, or fixing bugs. Runs iterative checks (plan completeness, git diff review, tests, linting, code review) and fixes issues until a full pass is clean. Triggers when work is claimed as done or complete."
---

# Review Loop

You are executing a thorough, iterative review of the work just completed. Your job is to find every remaining issue — missing work, bugs, lint failures, test failures, incomplete implementations — and fix them. You do NOT stop after one pass. You loop until clean.

## Rules

1. **No declaring done until a full clean pass.** Every check must pass with zero findings before you can stop.
2. **Fix, don't report.** When you find an issue, fix it immediately. Then restart the loop.
3. **Max 5 iterations.** If you hit 5 loops without a clean pass, stop and surface the remaining issues to the user. Something structural is wrong.
4. **Be honest.** Do not skip checks. Do not hand-wave. Do not mark things as "minor" and move on.

## The Loop

For each iteration, run ALL of the following steps in order. If ANY step finds an issue, fix it and restart from Step 1.

### Step 1: Plan Completeness

If the task has an active plan or an explicit plan/handoff file:
- Read the plan
- For each step/requirement in the plan, verify it was actually implemented
- Check for steps that were started but not finished
- Check for requirements that were silently dropped

Check paths the user named first, then applicable project conventions such as
`.codex/plans/` or `.claude/plans/`. If no plan exists, skip this step.

### Step 2: Git Diff Review

Run `git diff` and `git diff --cached` to see all changes. Read every changed file. Look for:
- `TODO`, `FIXME`, `HACK`, `XXX` comments that were added (not pre-existing)
- Placeholder or stub implementations (empty method bodies, `throw new \Exception('not implemented')`, `// ...`)
- Commented-out code that should be removed
- Debug statements (`dd(`, `dump(`, `console.log(`, `var_dump(`, `ray(`)
- Hardcoded values that should come from config/env
- Incomplete error handling (empty catch blocks, swallowed exceptions)

### Step 3: Tests

Detect what changed and run the appropriate tests:

**If PHP files changed:**
- Run `php artisan test --compact`
- If specific test files were added/modified, run those first with `--filter`
- ALL tests must pass. A failure is an issue.

**If TypeScript/JavaScript files changed:**
- Run `npm run types` (TypeScript type checking)
- If tests exist for the changed components, run them

### Step 4: Linting & Formatting

**If PHP files changed:**
- Run `vendor/bin/pint --dirty --format agent`
- If Pint made changes, that counts as a finding (the code wasn't clean)

**If JS/TS files changed:**
- Run `npm run lint`
- Run `npm run format:check`
- If either reports issues, fix them

### Step 5: Code Review

Invoke the `loop-review` skill on the git diff. Prioritize its findings on:
- Logic errors and bugs
- Security vulnerabilities (SQL injection, XSS, mass assignment, etc.)
- Missing edge cases
- N+1 query problems (for Eloquent changes)
- Broken type contracts

Only act on findings marked as critical or high-confidence. Ignore stylistic nitpicks.

### Step 6: Consistency Check

For each new or significantly modified file:
- Read 1-2 sibling files in the same directory
- Verify the new code follows the same patterns (naming conventions, import style, structure, return types)
- Check that new routes have names, new models have factories, new controllers have form requests (per project conventions)

## After a Clean Pass

When all 6 steps complete with zero findings:
1. State which iteration achieved the clean pass
2. Summarize what was checked
3. List any fixes made during earlier iterations
4. Confirm: "All checks pass. Work is complete."

## After Hitting Max Iterations

If you reach iteration 5 without a clean pass:
1. List every remaining issue you could not resolve
2. Explain what you tried
3. Ask the user how to proceed

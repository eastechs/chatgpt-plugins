#!/usr/bin/env bash
# run_linters.sh — detect and run available static analyzers, emit consolidated JSON.
#
# Usage: bash run_linters.sh <project-root>
#
# Emits a single JSON object to stdout, keyed by tool name. Each entry has:
#   - ran: bool (whether the tool was available and executed)
#   - exit_code: int (the tool's exit code, or null)
#   - findings: structured findings where possible, otherwise raw text
#   - note: short explanation when a tool was skipped
#
# Tools are detected lazily — the tool must be on PATH or available via the
# project's dependency manager (e.g., ./vendor/bin/phpstan, npx eslint).
#
# Failures are non-fatal. Errors go to stderr; stdout stays valid JSON.

set -u

ROOT="${1:-.}"
cd "$ROOT" || exit 1

# Accumulator for JSON output. We build strings and wrap in {} at the end.
declare -a RESULTS=()

json_escape() {
    # Minimal JSON string escape via python (portable) with a jq fallback
    if command -v python3 >/dev/null 2>&1; then
        python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
    elif command -v jq >/dev/null 2>&1; then
        jq -Rs .
    else
        # Very basic escape fallback — replaces " and \ and newlines
        sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'BEGIN{printf "\""} {printf "%s\\n", $0} END{printf "\""}'
    fi
}

add_result() {
    # $1: tool name
    # $2: ran (true/false)
    # $3: exit code (or "null")
    # $4: findings (already-valid JSON or a JSON-escaped string)
    # $5: note (already-JSON-escaped string, including quotes)
    local name="$1" ran="$2" exit_code="$3" findings="$4" note="$5"
    RESULTS+=("\"$name\":{\"ran\":$ran,\"exit_code\":$exit_code,\"findings\":$findings,\"note\":$note}")
}

has() { command -v "$1" >/dev/null 2>&1; }

# ── PHP ──────────────────────────────────────────────────────────────────────

# phpstan
if [ -x "vendor/bin/phpstan" ]; then
    OUT=$(vendor/bin/phpstan analyse --error-format=json --no-progress 2>&1) || true
    EC=$?
    # phpstan emits JSON on stdout; filter to valid JSON by taking the last {...}
    if echo "$OUT" | python3 -c 'import json,sys;json.loads(sys.stdin.read())' 2>/dev/null; then
        add_result "phpstan" "true" "$EC" "$OUT" "\"\""
    else
        ESCAPED=$(printf '%s' "$OUT" | json_escape)
        add_result "phpstan" "true" "$EC" "$ESCAPED" "\"non-JSON output; returning raw\""
    fi
elif [ -f "phpstan.neon" ] || [ -f "phpstan.neon.dist" ]; then
    add_result "phpstan" "false" "null" "null" "\"phpstan config found but vendor/bin/phpstan missing — run composer install\""
fi

# psalm
if [ -x "vendor/bin/psalm" ]; then
    OUT=$(vendor/bin/psalm --output-format=json 2>&1) || true
    EC=$?
    if echo "$OUT" | python3 -c 'import json,sys;json.loads(sys.stdin.read())' 2>/dev/null; then
        add_result "psalm" "true" "$EC" "$OUT" "\"\""
    else
        ESCAPED=$(printf '%s' "$OUT" | json_escape)
        add_result "psalm" "true" "$EC" "$ESCAPED" "\"non-JSON output\""
    fi
fi

# laravel pint
if [ -x "vendor/bin/pint" ]; then
    OUT=$(vendor/bin/pint --test --format=json 2>&1) || true
    EC=$?
    if echo "$OUT" | python3 -c 'import json,sys;json.loads(sys.stdin.read())' 2>/dev/null; then
        add_result "pint" "true" "$EC" "$OUT" "\"\""
    else
        ESCAPED=$(printf '%s' "$OUT" | json_escape)
        add_result "pint" "true" "$EC" "$ESCAPED" "\"\""
    fi
fi

# php-cs-fixer
if [ -x "vendor/bin/php-cs-fixer" ]; then
    OUT=$(vendor/bin/php-cs-fixer fix --dry-run --format=json 2>&1) || true
    EC=$?
    if echo "$OUT" | python3 -c 'import json,sys;json.loads(sys.stdin.read())' 2>/dev/null; then
        add_result "php-cs-fixer" "true" "$EC" "$OUT" "\"\""
    fi
fi

# phpcs
if [ -x "vendor/bin/phpcs" ]; then
    OUT=$(vendor/bin/phpcs --report=json 2>&1) || true
    EC=$?
    if echo "$OUT" | python3 -c 'import json,sys;json.loads(sys.stdin.read())' 2>/dev/null; then
        add_result "phpcs" "true" "$EC" "$OUT" "\"\""
    fi
fi

# ── JavaScript / TypeScript ─────────────────────────────────────────────────

# eslint — check for config first to avoid noisy "no config" errors
HAS_ESLINT_CONFIG=false
for f in .eslintrc .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yaml .eslintrc.yml eslint.config.js eslint.config.mjs eslint.config.cjs; do
    [ -f "$f" ] && HAS_ESLINT_CONFIG=true && break
done
# Also check package.json for eslintConfig
if [ -f "package.json" ] && python3 -c 'import json,sys; sys.exit(0 if "eslintConfig" in json.load(open("package.json")) else 1)' 2>/dev/null; then
    HAS_ESLINT_CONFIG=true
fi

if $HAS_ESLINT_CONFIG; then
    ESLINT_CMD=""
    if [ -x "node_modules/.bin/eslint" ]; then
        ESLINT_CMD="node_modules/.bin/eslint"
    elif has eslint; then
        ESLINT_CMD="eslint"
    fi
    if [ -n "$ESLINT_CMD" ]; then
        OUT=$($ESLINT_CMD . --format=json --max-warnings=-1 2>&1) || true
        EC=$?
        if echo "$OUT" | python3 -c 'import json,sys;json.loads(sys.stdin.read())' 2>/dev/null; then
            add_result "eslint" "true" "$EC" "$OUT" "\"\""
        else
            ESCAPED=$(printf '%s' "$OUT" | json_escape)
            add_result "eslint" "true" "$EC" "$ESCAPED" "\"non-JSON output; may have crashed\""
        fi
    else
        add_result "eslint" "false" "null" "null" "\"eslint config found but no binary available (no node_modules/.bin/eslint and not on PATH)\""
    fi
fi

# tsc — only if tsconfig.json exists
if [ -f "tsconfig.json" ]; then
    TSC_CMD=""
    if [ -x "node_modules/.bin/tsc" ]; then
        TSC_CMD="node_modules/.bin/tsc"
    elif has tsc; then
        TSC_CMD="tsc"
    fi
    if [ -n "$TSC_CMD" ]; then
        OUT=$($TSC_CMD --noEmit 2>&1) || true
        EC=$?
        ESCAPED=$(printf '%s' "$OUT" | json_escape)
        add_result "tsc" "true" "$EC" "$ESCAPED" "\"tsc text output; not JSON-structured\""
    fi
fi

# prettier
HAS_PRETTIER_CONFIG=false
for f in .prettierrc .prettierrc.js .prettierrc.cjs .prettierrc.json .prettierrc.yaml .prettierrc.yml prettier.config.js prettier.config.cjs .prettierrc.toml; do
    [ -f "$f" ] && HAS_PRETTIER_CONFIG=true && break
done
if [ -f "package.json" ] && python3 -c 'import json,sys; sys.exit(0 if "prettier" in json.load(open("package.json")) else 1)' 2>/dev/null; then
    HAS_PRETTIER_CONFIG=true
fi
if $HAS_PRETTIER_CONFIG; then
    PRETTIER_CMD=""
    if [ -x "node_modules/.bin/prettier" ]; then
        PRETTIER_CMD="node_modules/.bin/prettier"
    elif has prettier; then
        PRETTIER_CMD="prettier"
    fi
    if [ -n "$PRETTIER_CMD" ]; then
        OUT=$($PRETTIER_CMD --check . 2>&1) || true
        EC=$?
        ESCAPED=$(printf '%s' "$OUT" | json_escape)
        add_result "prettier" "true" "$EC" "$ESCAPED" "\"prettier --check text output\""
    fi
fi

# biome (alternative to eslint+prettier)
if [ -f "biome.json" ] || [ -f "biome.jsonc" ]; then
    BIOME_CMD=""
    if [ -x "node_modules/.bin/biome" ]; then
        BIOME_CMD="node_modules/.bin/biome"
    elif has biome; then
        BIOME_CMD="biome"
    fi
    if [ -n "$BIOME_CMD" ]; then
        OUT=$($BIOME_CMD check --reporter=json . 2>&1) || true
        EC=$?
        if echo "$OUT" | python3 -c 'import json,sys;json.loads(sys.stdin.read())' 2>/dev/null; then
            add_result "biome" "true" "$EC" "$OUT" "\"\""
        else
            ESCAPED=$(printf '%s' "$OUT" | json_escape)
            add_result "biome" "true" "$EC" "$ESCAPED" "\"\""
        fi
    fi
fi

# ── Emit final JSON ──────────────────────────────────────────────────────────

if [ ${#RESULTS[@]} -eq 0 ]; then
    echo "{}"
else
    printf '{'
    for i in "${!RESULTS[@]}"; do
        if [ "$i" -gt 0 ]; then
            printf ','
        fi
        printf '%s' "${RESULTS[$i]}"
    done
    printf '}\n'
fi

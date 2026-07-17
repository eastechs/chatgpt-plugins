# JavaScript / TypeScript Review Hints

Patterns and pitfalls for JS/TS codebases. Include this when the chunk contains JS/TS files. Covers React, Vue, Next.js, Nuxt, Astro, Electron, and general Node. Only emphasize the subsections that match the stacks detected in the current chunk.

## Security — universal

### XSS
- React: `dangerouslySetInnerHTML={{ __html: value }}` with user-controlled `value`
- Vue: `v-html` on user-controlled content; `innerHTML` assignments in templates or lifecycle hooks
- Astro: `set:html={value}` with user-controlled content; interpolating user input into `<script>` or `<style>` blocks
- Server-rendered templates (EJS, Pug, Handlebars) using unescaped output syntax with user input
- Next.js / Nuxt `Head` / `<title>` with user-controlled meta content

### Injection
- `eval()`, `Function()`, `setTimeout(stringArg)` anywhere near user input
- Template literals passed to database clients as queries (should use parameterized queries)
- `child_process.exec(cmd)` with user input — use `execFile` or `spawn` with args array
- `require(userInput)` or dynamic `import(userInput)` — arbitrary module load

### SSRF / outbound
- `fetch(userUrl)` or axios with user-controlled URLs and no allowlist
- `new URL(input)` not validated before being fetched (watch for `file://`, `http://localhost`, internal IPs)

### Secrets / client exposure
- `process.env.SECRET_KEY` referenced in client-side code
- Next.js: only `NEXT_PUBLIC_` vars should appear in client bundles — anything else is a leak if it reaches the client
- Nuxt: `runtimeConfig.public.*` vs `runtimeConfig.*` — the former ships to the client, the latter doesn't. Mixing these up leaks secrets.
- Astro: `import.meta.env` without the `PUBLIC_` prefix is server-only; importing it into a client-hydrated component leaks it
- Vite: same rule — only `VITE_`-prefixed vars reach the client
- API keys in hooks or components
- Logging full request bodies that include tokens
- `console.log` of user objects including password hashes or session tokens

### Auth
- Route handlers without auth checks on sensitive operations
- JWT verification without signature check (`jwt.decode` instead of `jwt.verify`)
- `req.body.userId` trusted instead of `req.user.id` from auth middleware
- CORS with `origin: '*'` on endpoints that accept cookies/credentials
- Missing `httpOnly`, `secure`, `sameSite` on auth cookies

### Prototype pollution
- `Object.assign(target, userInput)` or spreads of user input without allowlist
- `lodash.merge` or similar on untrusted input (older versions are vulnerable)
- `JSON.parse` of user input then used as object key / assigned to

### Other
- `Math.random()` for tokens/IDs/anything security-relevant — should be `crypto.randomUUID()` / `crypto.randomBytes`
- Open redirects: `res.redirect(req.query.next)` without allowlist validation
- File reads: `fs.readFile(path.join(base, userInput))` without normalization — `../` traversal

## Correctness — async / promises

- Missing `await` on a call that returns a promise (especially in loops)
- `Array.forEach(async fn)` — the loop doesn't wait for async functions
- `map` returning promises without `Promise.all` — callers get promises they don't await
- Unhandled promise rejections: promises whose `.catch` is missing or silent
- Race conditions in component code: state update after unmount, or an effect not checking a cancellation flag
- `await` inside a transaction that can throw — partial commit risk

## Correctness — React

- `useEffect` missing dependencies → stale closures
- `useEffect` with dependencies that change every render → infinite loops
- `useState` initialized from props without `key` → stale state on prop change
- Keys in lists using array index when the list can reorder
- Event handlers recreated every render and passed to memoized children (defeats memo)
- Setting state during render (not in an effect or handler)
- Context providers re-rendering everything due to unstable value object
- `useCallback`/`useMemo` with missing or wrong deps — same stale-closure problems as useEffect

## Correctness — Vue

- `ref` vs `reactive` confusion — forgetting `.value` on refs in `<script setup>`, or destructuring a `reactive()` and losing reactivity
- `watch` vs `watchEffect` — `watchEffect` auto-tracks access; if you only want to react to specific values use `watch`
- `computed` with side effects (should be pure; use `watch` for side effects)
- Mutating props directly (Vue warns but the pattern still ships)
- `v-for` with `v-if` on the same element — priority differs between Vue 2 and 3, usually a bug either way
- Missing `:key` on `v-for`, or `:key` using array index when the list can reorder
- Async `setup()` without a Suspense boundary — errors crash the subtree
- `provide`/`inject` with non-reactive values when reactivity is expected
- `defineProps` with complex types but no runtime validator — runtime type mismatches go undetected
- Teleport targets that don't exist yet at mount time
- Pinia/Vuex stores being mutated from outside actions (breaks devtools and can introduce subtle bugs)

## Correctness — Next.js

- `"use client"` missing on components that use hooks but were imported from a server component
- `"use server"` actions without auth/authorization checks — they're callable from any client that can reach the page
- `fetch` in Server Components without `cache` or `next.revalidate` options where freshness matters
- `generateMetadata` / `generateStaticParams` with fetch calls that have mutable side effects
- Route handlers (`route.ts`) without input validation
- `cookies()` / `headers()` calls in code paths that can run at build time — throws
- Middleware that runs on paths you didn't intend (check `matcher` config)

## Correctness — Nuxt

- `useFetch` / `useAsyncData` without unique keys — cache collisions
- Server-only composables accidentally imported into client components
- `definePageMeta({ middleware: ... })` referencing middleware that doesn't exist (silent pass)
- `useState` (Nuxt's SSR state) being mutated in ways that leak between users on the server
- Server routes under `server/api/*` without auth checks
- `useRuntimeConfig()` in `<template>` — runs client-side and may leak server-only values

## Correctness — Astro

- Islands with `client:load` when `client:visible` or `client:idle` would suffice — unnecessary hydration cost
- `client:only` without a `fallback` — layout shift or blank area
- Server-side `Astro.request` / `Astro.cookies` used in code that also runs on static builds — undefined at build time
- API routes (`pages/api/*.ts` or `pages/*.json.ts`) without input validation
- SSR mode assumed but adapter is set to static — endpoints don't work
- `getStaticPaths` returning mutable data references — build-time state bleed
- `Astro.props` trusting data from `getStaticPaths` as safe to render without escaping
- Content collections: `getEntry` / `getCollection` with user-controlled slugs used in paths (path traversal into the content dir)

## Correctness — Electron (security-heavy — treat most of these as high/critical)

Electron's main/renderer split means the rules are different from a normal browser app. A confirmed `nodeIntegration: true` with any XSS surface is effectively RCE.

- `nodeIntegration: true` in `BrowserWindow` webPreferences — any XSS in the renderer becomes RCE on the host
- `contextIsolation: false` — renderer can reach into the preload/main context
- `webSecurity: false` — disables same-origin; loaded content can exfil cross-origin
- `allowRunningInsecureContent: true`
- `sandbox: false` without a good reason
- `enableRemoteModule: true` (deprecated but older codebases still carry it)
- Loading arbitrary URLs into windows (`loadURL(untrusted)`), or accepting URLs from renderer IPC without validation
- `shell.openExternal(url)` with a URL that can be user-controlled — reject `file://`, `javascript:`, and unexpected custom schemes
- `new-window` / `will-navigate` handlers that don't restrict destinations
- IPC handlers (`ipcMain.handle`, `ipcMain.on`) that don't validate sender (`event.senderFrame.url`) or don't validate arguments — these run with Node privileges
- Preload scripts exposing arbitrary APIs via `contextBridge.exposeInMainWorld` — expose specific narrow functions, not whole modules like `fs` or `child_process`
- Missing CSP (`Content-Security-Policy`) on renderer pages
- `fs` / `child_process` / `net` reached directly from the renderer (should only be reachable via narrow preload APIs)
- Unsigned auto-updates, or updates fetched over HTTP
- Protocol handlers (`app://` or similar) registered without path allowlists — path traversal into the app bundle or arbitrary file read
- `webContents.executeJavaScript(userInput)` with anything that isn't a hardcoded literal

## Correctness — general JS

- `==` vs `===` — especially around `null` / `undefined`
- `parseInt(x)` without radix
- `Date` math across timezones
- Floating-point equality (`0.1 + 0.2 === 0.3` is false)
- Shallow copies where deep is needed (`{...obj}` when `obj` has nested structures being mutated)
- Destructuring with defaults where `null` is passed (defaults only apply to `undefined`)
- `try/catch` around `await` where only one branch is actually awaited

## TypeScript-specific

- `any` in places that hide real type mismatches (especially at function boundaries)
- `as` casts that lie (casting `unknown` to a specific type without validation)
- Non-null assertions (`!`) on values that can actually be null
- Type predicates that don't actually narrow correctly
- `@ts-ignore` / `@ts-expect-error` hiding real issues

## Node / server

- `express` / `fastify` routes without input validation (especially sizes, types of query params)
- Missing `helmet` or equivalent security headers
- File uploads without size limits (multer `limits` missing)
- `body-parser` or equivalent without size limits
- `res.json(user)` where `user` includes password hash / tokens
- Long-running sync operations in request handlers (crypto, large JSON parse)

## Business logic (framework-agnostic hooks)

- Invariants enforced in one handler but not another (REST vs GraphQL vs webhook paths)
- State machine transitions not validated
- Optimistic UI updates that don't reconcile on server error

## What to skip

- `next.config.js`, `vite.config.ts`, `nuxt.config.ts`, `astro.config.mjs`, `tsconfig.json` unless they contain obvious issues (e.g. `webSecurity: false`, broken CSP, leaked env references)
- `app/layout.tsx`, `app/page.tsx` if they're the default Next.js scaffold
- `pages/_app.tsx`, `pages/_document.tsx` if default
- Default Nuxt `app.vue` / `error.vue` if unchanged
- Default Astro index / layout if it's just the starter
- Electron: the boilerplate main-process setup from a starter kit (guasam/electron-react-app, electron-vite, etc.) if security defaults are already correct — focus on where the IPC surface is actually defined
- Lockfiles
- Generated files under `.next/`, `.nuxt/`, `dist/`, `build/`, `out/`
- `components/ui/` if it's shadcn/ui scaffolded components (review the places that consume them instead)

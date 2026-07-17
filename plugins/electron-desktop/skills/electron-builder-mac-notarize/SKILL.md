---
name: electron-builder-mac-notarize
description: Use when packaging an Electron app for distribution and you need a signed + notarized macOS DMG (plus Windows NSIS and Linux AppImage targets). Drops in an `electron-builder.yml`, an entitlements plist, and an `afterAllArtifactBuild` hook that runs `xcrun notarytool submit --wait` followed by `stapler staple`/`validate`.
---

# electron-builder-mac-notarize

End-to-end signed + notarized DMG out of the box. The notarization hook is the bit most templates skip — without it your DMG ships unstapled and Gatekeeper requires an internet round-trip on first launch (or fails entirely on quarantined-then-airgapped machines).

## When to use

- Shipping a public Electron app to macOS users.
- The CI matrix already has `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` available.
- You want the bundle to also build on Windows (NSIS) and Linux (AppImage) from the same config.

## Decision points to ask before scaffolding

- **`appId`** — reverse-DNS, e.g. `com.example.myapp`. Has to match your developer-account bundle id.
- **`productName`** — display name. Spaces allowed.
- **Mac arch** — `arm64` only (default), or both `arm64` and `x64`. Universal binaries roughly double DMG size.
- **Linux target** — `AppImage` (default), `deb`, `rpm`, or several. Skip the linux block entirely if you don't ship Linux.
- **Output dir** — defaults to `release/`. Add to `.gitignore`.
- **Icon paths** — does the project already have `resources/images/app-icon.png`? If not, the template references it so the user knows what to drop in.

## What gets scaffolded

| Source path | Destination |
|---|---|
| `templates/electron-builder.yml` | `electron-builder.yml` (project root) |
| `templates/scripts/notarize-dmg.js` | `scripts/notarize-dmg.js` |
| `templates/resources/entitlements.mac.plist` | `resources/entitlements.mac.plist` |

After copying, edit `electron-builder.yml` to substitute `appId`, `productName`, `copyright`, the icon paths, and the arch list.

## Required env vars at build time

- `APPLE_ID` — Apple ID email used for the developer account.
- `APPLE_APP_SPECIFIC_PASSWORD` — generated at appleid.apple.com → Sign-In and Security → App-Specific Passwords.
- `APPLE_TEAM_ID` — the 10-character team id from developer.apple.com → Membership.

The hook fails fast with a clear error if any are missing. It also throws if DMG artifacts are present but the build host isn't macOS — you can't notarize from Linux/Windows runners.

## Signing identity

`electron-builder` picks the signing identity from the keychain automatically. On CI, import a Developer ID Application certificate into a keychain before the build runs (e.g. via `apple-actions/import-codesign-certs` on GitHub Actions). The `entitlementsInherit` line is intentional — child processes (renderer, GPU, helper apps) need the same entitlements as the main bundle for hardened runtime to permit JIT.

## Why the entitlements look the way they do

```xml
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
```

- `allow-jit` + `allow-unsigned-executable-memory` — V8 needs both to JIT JavaScript under hardened runtime.
- `allow-dyld-environment-variables` — required if any sub-process consumes `DYLD_*` (some native modules do).
- `disable-library-validation` — needed for native modules that aren't signed by your team. Tighten if you control all native deps.

## Verifying the result

After `npm run build` (or your build command):

```bash
codesign -dvv release/Trident-*.dmg          # check signing identity
spctl --assess --type install release/Trident-*.dmg   # gatekeeper assessment
xcrun stapler validate release/Trident-*.dmg # confirm ticket is stapled
```

All three should report success on a notarized + stapled DMG.

## Source

Lifted from:
- [trident/electron-builder.yml](https://github.com/eastechs/trident/blob/main/electron-builder.yml)
- [trident/scripts/notarize-dmg.js](https://github.com/eastechs/trident/blob/main/scripts/notarize-dmg.js)
- [trident/resources/entitlements.mac.plist](https://github.com/eastechs/trident/blob/main/resources/entitlements.mac.plist)

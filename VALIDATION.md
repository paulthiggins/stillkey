# Build validation

Validated on 26 October 2026 using synthetic secrets only. No independent security audit has been performed.

## Dense multi-account QR compatibility fix

The larger supplied JPEG contains four TOTP entries. ZXing's standard finder-pattern detection failed on its dense image before account parsing began. Image import now tries upright QR sampling and bounded smaller-size retries in memory, releasing bitmaps and canvas buffers after use. The exact JPEG now produces a four-account preview with import enabled in a disposable browser context; none of its accounts were saved.

Strict type checking, lint, production build, and all **37 unit tests** passed after this change. **20 targeted browser checks** passed across Chromium, Edge, Firefox, WebKit, and mobile Chromium. These include a synthetic dense four-account QR that fails standard detection, compressed JPEG paste, offline import/persistence, existing single-account version 2 import, migration batches, and offline backup/restore. Permanent regression fixtures contain synthetic secrets only.

## Google Authenticator compatibility fix

The supplied QR decoded successfully but carried migration payload version 2; the original parser only allowed version 1. The parser now explicitly supports versions 1 and 2 while retaining unknown-version rejection and consistent batch checks.

After this fix: strict type checking, lint, production build, and all **37 unit tests** passed. **10 targeted browser regressions** passed across Chromium, Edge, Firefox, WebKit, and mobile Chromium, covering version 2 QR-image import through save/unlock and existing multipart/HOTP behavior. The provided image was also checked locally in a disposable browser context: one supported account appeared in preview with import enabled. Its account was not saved or embedded in automated fixtures; regressions use synthetic secrets.

The complete browser-suite results below are from the initial build; only the relevant import tests were rerun for this focused change.

## Automated results

- TypeScript strict type checking: passed.
- Development startup and synthetic vault creation: passed with no page errors.
- ESLint: passed.
- Vitest: **29 tests passed**, including all RFC 6238 SHA-1/256/512 vectors at six timestamps, 6/8-digit output, leading zeros, time boundaries, URI validation, duplicate handling, protobuf/batch validation, encrypted round trips, wrong passwords, authenticated tamper rejection, and hostile KDF bounds.
- Production Vite build: passed. Static output in `dist/`; locally bundled QR chunks are loaded on demand and precached for offline use. Approximately 1.1 MB total output, with no oversized JavaScript chunk warning.
- Playwright production suite: **43 passed, 2 explicitly skipped**, across Chromium, installed Microsoft Edge, Firefox, WebKit, and a Pixel 7 Chromium viewport. No failed tests.
- `npm audit --audit-level=low`: **0 known vulnerabilities** in the pinned dependency tree at validation time. This does not establish that dependencies are vulnerability-free.
- Production assets inspected for JavaScript `eval(` and `new Function`: none found.

## Phase evidence

| Spec phase | Implemented and verified |
| --- | --- |
| Foundation | React/strict TypeScript/Vite/Tailwind, responsive shell, TOTP reference vectors |
| Secure vault | First-run creation, unlock, wrong-password failure, encrypted IndexedDB record inspection, password change, background/inactivity/multi-tab locks |
| Account management | Add/edit/delete, independent custom labels, search, copy feedback, persistence, keyboard modal behavior, responsive screenshots |
| Imports | URI/protobuf parsing, incomplete batches blocked, HOTP reported, offline image upload and synthetic clipboard-image handling, duplicate preview; synthetic camera decode/track shutdown on Chromium and Edge |
| Backups | Offline encrypted download/restore, wrong-password rejection without overwrite, merge, replacement, restoration into a separate browser context, QR export confirmation |
| PWA | Offline reload/unlock/import/backup; actual service-worker replacement waits for user acceptance, locks and reloads, preserving the encrypted vault |
| Security/testing | Size/parameter bounds, CSP, authenticated encryption tests, dependency audit, threat model, recovery and deployment documentation |

The production browser suite runs against real built assets, not a mocked application. The update test serves two versions of the service worker on an isolated temporary local origin. Network-disabled tests reload after activation and perform the import/backup workflows offline. The CRUD test observes requests and rejects third-party requests.

## Reproduce

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium firefox webkit
# Install Microsoft Edge for the edge project; install Linux browser libraries if needed.
npm run test:e2e
```

This Linux host lacked WebKit's libavif13/libgav1/libyuv runtime dependencies. They were downloaded into `/tmp/stillkey-browser-libs` without changing installed system packages. The passing run supplied their library path and preloaded those three libraries because WebKit's launcher replaces LD_LIBRARY_PATH. A normal workstation with Playwright's OS dependencies installed does not need this workaround.

## Explicit remaining validation

- Real iOS/Android installation, camera permission UX, physical camera quality, device wake behavior, low-memory Argon2id performance, and operating-system storage eviction/uninstall behavior were not tested on physical hardware.
- WebKit tests exercise the browser engine on Linux, not the branded Safari app on an Apple device.
- Firefox and WebKit skip the synthetic canvas-camera test; camera scanning there requires real-device validation. Their offline QR image and synthetic paste paths pass.
- Native clipboard-write success is asserted on Chromium/Edge; other browser clipboard permissions require device checks.
- No independent penetration test, cryptographic code audit, or formal accessibility audit is claimed.

## Docker/Caddy deployment kit — 27 October 2026

Added `deployment/` with fresh Debian/Ubuntu bootstrap, separate SSH hardening, local packaging, three Compose projects, public HTTP verification, and an isolated local container rehearsal. Bash syntax and ShellCheck passed. The packaged application passed strict TypeScript, lint, all 37 unit tests, and a production build; npm reported zero known dependency vulnerabilities.

The actual public deployment bundle was built and exercised using Docker and a checksum-verified Compose CLI. Tests passed for domain routing, application health, internal networks, public content and the repaired packaged favicon, security/cache headers, missing-asset 404 behavior, Caddy config reload through its directory mount, and application restart. The test used random loopback ports and HTTP-only test domains, made no production certificate requests, and removed its containers/networks/volumes afterwards.

Host bootstrap, SSH hardening, provider firewall rules, public DNS, real HTTPS certificate issuance, and real-device production checks have not been executed on the VPS. Follow `deployment/README.md` for that sequence. No VPS files or services were changed during preparation.

## Independent application deployments — 28 October 2026

Normal releases under `deployment/` now contain Stillkey only. The original combined server setup, gateway configuration, and clinic migration are separated under `infrastructure/initial-vps/`; its deploy command refuses an existing installation. The app-only updater transitions from the legacy shared environment to a Stillkey-local environment while preserving the original shared file.

Bash syntax, ShellCheck, strict TypeScript, lint, all 37 unit tests, and the production build passed. A Docker integration rehearsal ran the actual update/rollback scripts against a synthetic legacy-style installation. Two successful updates, a deliberately unhealthy update with automatic rollback, and manual rollback to the original baseline passed. Shared file hashes and gateway/other-app container IDs, start times, image IDs, and restart counts were unchanged. The bundle was checked for absence of other application content and gateway/bootstrap files. Test resources were removed; the VPS was not accessed or changed.

The npm audit at packaging time reported four low-severity advisories in the build-tool dependency chain (deepmerge, @rollup/plugin-node-resolve, workbox-build, and vite-plugin-pwa); no moderate/high/critical advisories were reported. Dependency versions were not changed as part of this deployment separation.

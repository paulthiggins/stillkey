# Stillkey

An offline-first authenticator PWA built from [SPEC.md](SPEC.md). React, TypeScript, Vite, Tailwind, Dexie, Web Crypto, Argon2id, OTPAuth, ZXing, and protobufjs. No backend, accounts, cloud sync, telemetry, or runtime third-party requests.

## Run locally

Requires Node.js 22.12+ (tested with Node 24).

```sh
npm ci
npm run dev
```

Development mode does not install the production service worker and allows the inline React Fast Refresh preamble. Production retains the restrictive script policy. For installation and offline testing:

```sh
npm run build
npm run preview
```

Open the localhost address shown in the terminal. Create a vault with a unique password of at least 12 characters. Add a synthetic account first to learn the workflow. Do not put real secrets into source files, test fixtures, tickets, or screenshots.

## Use

- **Add account:** enter the service's Base32 setup key, then its algorithm, digit count, and period. Custom display labels are independent of issuer and account identifier.
- **Import:** scan with your camera, upload a PNG/JPEG/WebP, paste an image while the import dialog is open, or paste an `otpauth://` or Google Authenticator migration URI (export formats 1 and 2). Review before committing. Every QR part of a migration batch is required. HOTP and unsupported parameters are reported and skipped. Exact secret/algorithm/digits/period duplicates are skipped on import.
- **Codes:** generated from device time; copying always regenerates the current code. Set your device time automatically. Alphabetical or manual ordering is available; use each account's menu to move it up/down, edit, delete, or explicitly reveal/export its secret QR.
- **Lock:** use Lock vault, choose an inactivity timeout, or enable locking when backgrounded. Sensitive dialogs close on lock.
- **Install:** use the browser's Install app action; on iOS Safari use Share → Add to Home Screen. Wait for Available offline on the first online load. Then confirm you can reload and unlock with the network disabled.
- **Update:** updates prompt before activation. Lock & update clears the session before reloading. Unknown vault formats are rejected rather than overwritten.

## Back up and restore

1. Choose Back up vault or Settings → Export encrypted backup.
2. Keep the downloaded JSON somewhere independent of this browser/device. The file contains ciphertext, a salt, an IV, and versioned encryption parameters, not plaintext account data.
3. Record the password in a trusted password manager. Backups retain the password used when created, even after changing the live vault password.
4. On another device, load Stillkey, create an empty vault, then Settings → Restore backup. Select the file and its original password. Merge skips duplicate accounts; replace removes current accounts after successful validation.
5. If locked out of an existing vault, use Recover accounts from an encrypted backup. This replaces that vault and adopts the backup's password.
6. Verify access before deleting your old installation or backup. The reminder records a requested download, not proof that a file was safely retained.

**There is no password reset.** Without a working vault password or usable backup, recover access through each service's recovery codes/support. Clearing site data, private browsing, browser eviction, uninstall behavior, or device loss can destroy your only copy. The app requests persistent storage, but the browser can decline.

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium firefox webkit
# The Edge project also needs Microsoft Edge installed.
npm run test:e2e
```

On Linux, Playwright may need OS libraries (`npx playwright install-deps`). Tests use only synthetic secrets. The browser suite serves the production build and covers desktop Chromium, Firefox, WebKit, and a mobile Chromium viewport. WebKit emulation is not a substitute for testing real Safari/iOS hardware; actual camera permissions, installation, and OS storage lifecycle require device checks. See [VALIDATION.md](VALIDATION.md) for the results from this build.

## Stillkey deployment

Use [deployment/README.md](deployment/README.md) for independent Stillkey releases. Packaging and updates affect only Stillkey, reusing the existing server gateway. Server-wide bootstrap and the original combined migration are kept separately in [infrastructure/README.md](infrastructure/README.md) for initial setup/recovery.

## Static deployment

Deploy the contents of `dist/` to a dedicated HTTPS origin at its root. Do not deploy the source tree or `node_modules`. Localhost is a secure-context exception; plain HTTP on a LAN is not. No server API is required. Keep the same origin to retain access to IndexedDB. Moving domains does not move the vault: use a backup.

Recommended server headers (in addition to the CSP included in HTML):

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
Permissions-Policy: camera=(self), microphone=(), geolocation=()
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

Serve `index.html`, `sw.js`, and the manifest with `Cache-Control: no-cache`; hashed assets can use `public, max-age=31536000, immutable`. Serve correct MIME types. Keep old hashed assets during rollouts so existing clients can update safely. HTTPS hosting may receive same-origin requests for app files and service worker checks; no account data is transmitted. Do not add analytics, third-party scripts, or runtime CDN dependencies.

Read [SECURITY.md](SECURITY.md), [THREAT_MODEL.md](THREAT_MODEL.md), and [ARCHITECTURE.md](ARCHITECTURE.md) before relying on the app. This implementation has not undergone an independent security audit.

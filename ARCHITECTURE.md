# Architecture

Stillkey is a static React/TypeScript application. Vite builds locally bundled dependencies and Tailwind CSS; vite-plugin-pwa/Workbox precaches a versioned application shell. No network data layer exists.

## Boundaries

- `src/model.ts`: typed in-memory accounts/settings, validation, OTPAuth generation, canonical duplicate fingerprints, and merge behavior.
- `src/vault.ts`: strict encrypted envelope parsing, Argon2id key derivation, AES-GCM sealing/opening, Dexie storage, atomic revision-checked writes.
- `src/imports.ts`: standard URI parsing and bounded Google Authenticator protobuf decoding. Uses protobufjs's minimal Reader to avoid runtime code generation. Extracts counter information for unsupported HOTP; these entries remain warnings, not TOTP records.
- `src/qr-image.ts`: bounded image decoding with normal detection, upright screenshot fallback, and smaller-size retries for dense exports; releases image buffers after use.
- `src/App.tsx`: locked/unlocked state machine, form dialogs, camera lifecycle, clipboard, backups, and account UI. No decrypted state in localStorage, URLs, caches, or persistent Redux stores.
- `src/style.css`: responsive light/dark interface; system fonts only.
- `vite.config.ts`: app manifest, offline asset allowlist, prompt-based service worker updates.

## Vault lifecycle

Creation → random salt → Argon2id → non-extractable AES key → empty encrypted vault → unlocked session. Unlock reads the envelope, validates bounded parameters, derives the key, authenticates/decrypts, validates the schema, and only then enters the unlocked state.

Mutations build and validate the next complete in-memory object. Encryption uses a fresh IV. The IndexedDB transaction compares the expected revision and replaces a single record atomically. UI state commits only after persistence succeeds. Other tabs receive only a change signal and lock; no secrets are broadcast. Lock invalidates the session generation to prevent in-flight operations from reopening the vault.

Backup exports reuse the interoperable vault envelope. Restore decrypts with the backup password. Merge compares canonical secret + algorithm + digits + period and issues fresh IDs for incoming records. Replace preserves validated backup accounts. Both re-encrypt with the current vault key; locked recovery instead adopts the backup password/key. No raw imported image is retained.

## Formats and migrations

Encrypted envelope v1: `{format, version, cipher, kdf, salt, iv, ciphertext}`. Base64 encodes byte fields. AAD is canonical JSON in this order: format, version, cipher, kdf (name/version/memory/iterations/parallelism), salt, iv. The ciphertext includes the 128-bit GCM tag.

Decrypted schema v1: `{schemaVersion, accounts, settings, changedAt, backedUpAt}`. `validateVault` is the explicit schema boundary. There are no historical formats to migrate; versions other than 1 are rejected. A future upgrade must add a validated migration from the old decrypted schema and tests before writing it back. Never change the meaning of v1 fields or KDF parameters in place.

Dexie database version 1 has one `vault` store keyed by `id`. The `main` record holds an envelope and monotonically incrementing revision. Deleting the vault removes this record; static service worker assets remain installed.

## Timing and offline behavior

Codes use epoch milliseconds and are recomputed from the current clock, rather than incrementing a counter in a background timer. A foreground timer updates the presentation, and visibility/pageshow refreshes after suspension. The clipboard handler generates the code at click time. No server clock is consulted.

Only build assets are precached. There is no runtime cache rule. Update installation waits; explicit user acceptance locks and reloads. The encrypted IndexedDB record is unrelated to cache cleanup. After a successful initial cache, navigation, QR decoding, Argon2id, backup, and OTP generation require no network.

## Validation strategy

Vitest covers RFC 6238 vectors and core validation/encryption/import logic. Playwright runs the production build across desktop Chromium/Firefox/WebKit and mobile Chromium. Offline tests disable network after service worker activation, reload, unlock, import QR files and synthetic clipboard images, and export/restore backups. See VALIDATION.md for actual run results and remaining real-device checks.

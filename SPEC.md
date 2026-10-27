# Offline Authenticator PWA — Build Specification

## 1. Objective

Build a production-quality, installable, offline-first, single-page authenticator application for managing and generating Time-based One-Time Passwords (TOTP).

The application must operate entirely on the user's device. No backend, cloud synchronisation, analytics, telemetry, third-party APIs, or user accounts.

The application must work on desktop and mobile browsers and be installable as a Progressive Web App (PWA).

Security, portability, data ownership, and simplicity are primary design objectives.

## 2. Technology Stack

- React + TypeScript (strict mode)
- Vite
- Tailwind CSS
- vite-plugin-pwa / Workbox
- IndexedDB via Dexie
- Web Crypto API for cryptographic operations
- Argon2id for master-password key derivation, bundled for offline use
- `otpauth` for TOTP calculations
- ZXing or equivalent for QR code scanning and decoding
- `protobufjs` for Google Authenticator migration payloads
- Vitest for unit tests
- Playwright for end-to-end tests

All dependencies must be bundled locally. No external CDNs, fonts, scripts, or runtime network dependencies.

Pin dependency versions using a lockfile.

## 3. Functional Requirements

### 3.1 Main Screen

Display a searchable, scrollable list of authenticator accounts.

Each entry must display:

- Custom display label (primary)
- Issuer/service name
- Account identifier (typically email or username)
- Current 6- or 8-digit TOTP
- Countdown to expiration
- Visual progress indicator
- Copy-to-clipboard button
- Context menu for editing, exporting and deleting

Requirements:

- Refresh codes automatically at the correct time boundaries.
- Default period is 30 seconds, configurable per entry.
- Support SHA-1, SHA-256 and SHA-512.
- Copy codes without spaces.
- Display temporary feedback after copying.
- Support responsive mobile and desktop layouts.
- Allow sorting alphabetically or manually.
- Support dark and light themes.
- Support keyboard navigation and accessibility.

### 3.2 Account Management

Users must be able to:

- Add an account manually.
- Edit custom display labels.
- Edit issuer and account metadata.
- Reorder accounts.
- Delete accounts with confirmation.
- Search and filter accounts.
- Identify possible duplicate accounts.
- Export individual account QR codes with an explicit security warning.

Custom display labels must be independent of the underlying issuer and account identifiers.

### 3.3 QR Import

Support the following input methods:

1. Camera scanning using `getUserMedia`.
2. Pasting a QR image from the clipboard.
3. Uploading PNG, JPEG or WebP QR images.
4. Pasting an `otpauth://` URI.
5. Pasting an `otpauth-migration://` URI.
6. Manual secret entry.

Parse standard `otpauth://totp/` URIs.

Support issuer, account, secret, algorithm, digit count and period.

Validate all fields before saving.

Do not transmit, log or persist raw imported images.

Handle invalid and unsupported QR codes gracefully.

### 3.4 Google Authenticator Migration Import

Implement support for:

`otpauth-migration://offline?data=...`

Decode the URL-encoded Base64 Protocol Buffers payload locally.

Extract:

- Secret bytes
- Account name
- Issuer
- Algorithm
- Digit count
- OTP type
- Counter (where applicable)
- Batch size, index and identifier

Support multi-QR exports.

Require complete and consistent batches before importing a batch as complete.

Present an import preview with account count, labels and duplicate warnings.

Do not silently import HOTP entries as TOTP.

For v1, unsupported HOTP accounts must be clearly identified and skipped, with an explanation.

Do not silently accept unsupported algorithms.

Commit imported accounts atomically to the encrypted vault.

### 3.5 TOTP Engine

Implement RFC 6238-compatible TOTP generation.

Requirements:

- Default 30-second interval.
- Configurable period.
- 6- and 8-digit support.
- SHA-1, SHA-256 and SHA-512.
- Correct leading-zero handling.
- Use device time in UTC epoch seconds.
- No server time dependency.
- Recalculate on visibility changes and device wake.
- Avoid reliance on background timers for correctness.

Warn users when device time may be incorrect, where detectable.

### 3.6 Local Storage and Encryption

Store all account secrets in an encrypted local vault using IndexedDB.

Use:

- AES-256-GCM
- Cryptographically secure random IVs/nonces
- Unique salt per vault
- Argon2id password-based key derivation
- Versioned encrypted vault format
- Authenticated metadata

The master password must never be stored.

Keep decrypted secrets in memory only while unlocked.

Never store secrets in localStorage, sessionStorage, service worker caches, logs, URLs, or analytics.

Clear application references to decrypted data on locking, understanding that JavaScript cannot guarantee physical memory erasure.

Provide:

- First-run vault creation
- Master-password unlock
- Manual lock
- Configurable inactivity lock
- Lock when backgrounded (optional setting)
- Master-password change by decrypting and re-encrypting the vault

Use appropriate authenticated encryption handling and never reuse an AES-GCM nonce with the same key.

Handle corrupted vaults and wrong passwords safely.

### 3.7 Import / Export / Backup

Implement a versioned encrypted backup format.

Backup must contain:

- Format version
- Encryption and KDF metadata
- Encrypted account data
- Integrity/authentication information

Support:

- Export encrypted backup file.
- Restore encrypted backup file.
- Merge or replace existing accounts.
- Detect duplicates.
- Verify successful decryption before changing the existing vault.
- Show backup reminders after meaningful changes.

For merge, decrypt the backup using its password, then re-encrypt entries into the current vault.

Exporting plaintext secrets or QR codes must require explicit confirmation and a security warning.

Never overwrite the current vault before successful backup validation.

### 3.8 Progressive Web App

Implement:

- Web app manifest
- App icons (192px and 512px, including maskable icon)
- Standalone display mode
- Service worker
- Offline-first application shell
- Fully local JavaScript/CSS/fonts
- Offline launch after successful installation
- Responsive layouts
- Install guidance on supported platforms

The app must remain fully functional in airplane mode after installation.

The service worker must never cache decrypted secrets or backup files.

Use safe update behaviour: never delete user data or silently replace incompatible vault schemas.

### 3.9 Settings

Provide settings for:

- Theme: light/dark/system
- Default account sorting
- Auto-lock timeout
- Lock when backgrounded
- Show/hide account identifiers
- Backup export
- Backup restore
- Change master password
- Data deletion
- App version
- Offline status

### 3.10 Privacy and Security

The application must:

- Have no backend or API.
- Make no outbound requests during normal operation.
- Include no analytics, telemetry or tracking.
- Use no externally hosted fonts or assets.
- Avoid dangerous HTML injection patterns.
- Use a restrictive Content Security Policy.
- Avoid `eval` and unnecessary dynamic code execution.
- Sanitize and validate imported labels and metadata.
- Reject malformed and oversized import payloads.
- Never log OTP secrets, decrypted vault contents or live codes.
- Never store plaintext secrets in browser storage.
- Avoid exposing sensitive data through error messages.
- Provide explicit confirmation before destructive operations.

The clipboard may contain sensitive OTP codes after copying. Display an appropriate warning in the security documentation.

### 3.11 Data Model

Each account should have:

```typescript
interface TotpAccount {
  id: string;
  issuer: string;
  accountName: string;
  displayLabel: string;
  secretBase32: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 8;
  period: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

This structure represents decrypted in-memory data.

The persisted representation must be encrypted.

Include a versioned vault schema and explicit migrations.

### 3.12 User Experience

Design a clean, minimal, professional interface.

Prioritise:

- Fast launch
- Readable OTP codes
- Large copy buttons
- Minimal interaction steps
- Good touch targets
- Accessible contrast
- Smooth countdown indicators
- Clear error messages
- No unnecessary animations

The application should feel like a native authenticator rather than a conventional website.

## 4. Testing Requirements

### Unit Tests

Test against RFC 6238 reference vectors.

Cover:

- SHA-1, SHA-256 and SHA-512
- 6- and 8-digit output
- Time-step boundaries
- Leading zeros
- Invalid secrets
- Invalid algorithms
- QR parsing
- Migration protobuf parsing
- Multi-part migration batches
- Duplicate handling
- Encryption/decryption
- Wrong passwords
- Backup round trips

### Integration Tests

Verify:

- Vault creation and unlock
- Add/edit/delete account
- Google Authenticator import
- QR image import
- Clipboard copy
- Encrypted backup and restore
- Lock/unlock transitions
- Storage persistence
- Service worker update behaviour

### End-to-End Tests

Test desktop and mobile viewport layouts.

Test with network disabled after initial installation.

Verify:

- App opens offline.
- Accounts remain available offline.
- Codes remain correct offline.
- QR image import works offline.
- Backup and restore work offline.
- No unexpected network requests occur.

Test browser compatibility with Chrome, Edge, Firefox and Safari where supported.

## 5. Acceptance Criteria

The application is complete when:

1. It can be installed as a PWA.
2. It operates entirely offline after installation.
3. It generates correct TOTPs matching established authenticators.
4. It imports standard TOTP QR codes.
5. It imports Google Authenticator migration QR codes, including multi-part exports.
6. It supports editable custom labels.
7. Every account has a functioning copy button.
8. Camera and image-based QR imports work on supported browsers.
9. Secrets are encrypted at rest.
10. Encrypted backups can be restored on another device.
11. No backend or runtime third-party service is required.
12. Automated tests pass.
13. The application builds to static deployable files.
14. Documentation explains security limitations and recovery procedures.

## 6. Deliverables

Generate:

- Complete application source code
- `README.md`
- `SECURITY.md`
- `ARCHITECTURE.md`
- `THREAT_MODEL.md`
- `package.json` and lockfile
- PWA manifest and icons
- Service worker configuration
- Automated tests
- Production build instructions
- Static deployment instructions
- Backup/restore documentation

## 7. Implementation Instructions for Coding Agent

Work in phases:

**Phase 1 — Foundation**

Create the Vite/React/TypeScript project, UI shell, TOTP engine and tests.

**Phase 2 — Secure Vault**

Implement encryption, IndexedDB persistence, master-password handling and lock/unlock.

**Phase 3 — Account Management**

Implement account CRUD, custom labels, sorting, search, live TOTP display and clipboard copying.

**Phase 4 — Imports**

Implement manual entry, standard QR import, image paste, camera scanning and Google Authenticator migration import.

**Phase 5 — Backups**

Implement encrypted backup/export and safe restoration.

**Phase 6 — PWA**

Implement installation, offline caching and service worker updates.

**Phase 7 — Security and Testing**

Complete threat modelling, tests, dependency audit and cross-browser validation.

At the end of each phase:

- Run type checking and linting.
- Run relevant tests.
- Report what was implemented.
- Identify outstanding issues.
- Do not claim a feature is complete unless tested.

Do not introduce any backend, authentication provider, cloud storage or telemetry without explicit approval.

Prioritise correctness and security over feature quantity.

Do not import or test using real personal TOTP secrets.

Do not claim the application is security-audited simply because tests pass.
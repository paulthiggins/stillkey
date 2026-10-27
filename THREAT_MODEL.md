# Threat model

## Assets and trust boundaries

Assets: permanent TOTP secrets, master passwords, derived keys, decrypted account metadata, exported QR codes, and encrypted backups. Trust boundary: browser application code and Web Crypto/Argon2id execution versus persisted storage, imported files/images, clipboard, static hosting, and the operating system.

The issuing service, user's OS/browser, static deployment, and installed extensions must be trustworthy. The threat model does not assume an unlocked compromised device can protect secrets.

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Copying IndexedDB or a backup | Argon2id and AES-256-GCM; unique salt; new random IV on every write | Weak passwords can be guessed offline |
| Tampering with ciphertext or encryption metadata | GCM authentication including canonical header; strict version/parameter checks | Deletion and rollback of a valid old vault remain possible |
| Malformed import or malicious labels | Input/size bounds, plain React text, strict account validation, minimal protobuf Reader | Browser image decoder vulnerabilities and memory pressure are outside app control |
| Wrong or mixed migration QR parts | Consistent batch ID/size/version, unique indexes, complete-batch requirement, preview | Google export metadata is not cryptographically signed; inspect the preview |
| Unsupported OTP silently converted | HOTP and unsupported algorithms/digits explicitly skipped with explanation | Users must migrate unsupported entries through another tool |
| Accidental destructive operations | Confirmation before account/vault deletion; restore validation before atomic write | A confirmed replacement requires a backup to undo |
| Multiple tabs overwrite accounts | Revision-checked IndexedDB transaction and secret-free broadcast lock | Older valid external copies are not detected as rollback |
| Shoulder surfing / abandoned session | Manual, inactivity, and optional background lock; identifier visibility control | OS suspension, screenshots, extensions, and unlocked device access |
| Secret leaked through clipboard/export | Explicit QR warning; no raw images persisted; no secret logging or telemetry | Clipboard history and externally saved QR files are outside app control |
| Hosting or supply chain compromise | Lockfile, bundled assets, restrictive CSP, dedicated HTTPS origin, dependency audit | Malicious same-origin code could steal an unlocked vault; independent release review needed |
| Clock skew | Epoch-based calculation and clock-jump notice | No authoritative offline clock; user must correct device time |
| Device loss or browser eviction | Encrypted backup export, reminder, persistent-storage request | No cloud recovery; loss of both password and usable backup is unrecoverable |

## Explicit non-goals

Hardware-backed key custody, secure physical memory erasure, HOTP generation, cloud sync, phishing-resistant authentication, recovery from a forgotten master password without a backup, hostile-root-device protection, and cryptographic provenance for imported Google migration batches.

## Before broad distribution

Review crypto serialization and lock/async behavior independently; verify real mobile install and camera behavior; test low-memory device Argon2id performance; configure deployment headers; establish a dependency/update review process; and test restoring a backup on a second device. Automated checks do not replace that review.

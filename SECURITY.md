# Security and recovery

## Encryption

The vault is encrypted as a single authenticated AES-256-GCM message using the browser Web Crypto API. Every encryption generates a new 96-bit random IV; every vault/password change creates a fresh 128-bit random salt. Passwords derive a 256-bit key with Argon2id v19, 64 MiB memory, three iterations, one lane. These parameters are fixed for v1, bounded before any password derivation, and included in authenticated metadata. AES-GCM's 128-bit tag is included in ciphertext.

Argon2id WebAssembly is bundled in the application. CSP permits WebAssembly compilation through `wasm-unsafe-eval`, not JavaScript eval. The AES key is non-extractable. The password is never persisted. All account data, settings, and backup reminder timestamps are encrypted. IndexedDB contains only the envelope, record identifier, and conflict-detection revision.

A wrong password or failed authentication never changes the existing vault. Unsupported schemas and KDF settings fail closed. Import and restore perform validation before atomic replacement of the encrypted record. Concurrent writes use a revision check; broadcasts lock other tabs so they must reload the current vault.

## Unlocked sessions

Decrypted data exists in JavaScript memory while unlocked. Lock clears application references, sensitive dialogs, QR output, searches, and the key. Temporary plaintext byte buffers are overwritten where possible, but JavaScript strings, garbage collection, browser internals, and OS memory cannot be reliably erased. Async operations retain temporary references until they finish. There is no claim of physical memory zeroization.

Auto-lock checks elapsed wall time on activity, visibility changes, wake/pageshow, and timer ticks. Browsers can suspend JavaScript, so automatic locking cannot run during suspension; the app checks on resume. Optional background locking closes the vault when the page is hidden. A system clock jump is detected heuristically; the app cannot establish accurate time independently without an external source.

## QR codes, clipboard, and files

QR import images are decoded locally in memory and are not persisted. Decoded bitmaps are closed and temporary canvases cleared after decoding. Import limits: 100,000 URI characters, 2,000 accounts, up to 100 migration parts, 10 MB encoded QR images, 24 million decoded pixels, and 4 MB backup JSON. Dimensions can only be checked after browser image decoding; do not open untrusted pathological files on low-memory devices.

Plaintext QR exports require a warning and confirmation. The resulting image contains a permanent account secret. Protect it as carefully as the original setup key. Deleting the downloaded file does not guarantee removal from backups, thumbnails, or cloud photo services.

Copied OTPs remain in the system clipboard and may be accessible to other applications or clipboard history. The app does not promise to clear the clipboard. Codes and unlocked account labels can be exposed through screenshots, screen sharing, shoulder surfing, browser extensions, or OS compromise.

## Limits

Encryption protects stored files from someone who lacks the password. It does not protect an unlocked browser against malware, malicious extensions, compromised hosting, modified application code, or a hostile device administrator. Weak passwords remain susceptible to offline guessing. Browser storage is not a backup. A rollback to an older valid backup cannot be detected without an external trusted record.

No backend, telemetry, remote fonts, or third-party runtime APIs are used. The service worker caches only the generated application shell/assets. It never receives vault plaintext or backup files. Same-origin static hosting requests and update checks are expected while online. CSP `connect-src 'self'` permits those requests, and production code must remain free of data upload endpoints. Use a dedicated origin and the deployment headers in README.

## Recovery and reporting

Keep encrypted backups and their passwords separately and test restoration. If a secret is exposed, rotate the second factor at the issuing service. A password change re-encrypts the live vault; it cannot revoke previously copied backups or QR secrets. Report suspected vulnerabilities privately to the deployment/repository maintainer without including personal secrets, actual live codes, or decrypted backups.

Automated test success is not a security audit. Independent review is recommended before broad deployment.

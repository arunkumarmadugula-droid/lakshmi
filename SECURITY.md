# Security

## Design

- AES-256-GCM authenticated encryption for vaults, snapshots, and archived documents
- Random 256-bit master key per profile
- PBKDF2-SHA-256 recovery wrapper with a unique 128-bit salt and 600,000 iterations
- WebAuthn PRF device wrapper for biometric/device unlock where supported
- PBKDF2-SHA-256 PIN wrapper with a unique salt and 900,000 iterations
- Random 96-bit IVs and purpose-specific additional authenticated data
- Non-extractable Web Crypto keys kept only in page memory while unlocked
- Automatic inactivity lock and passphrase checks for restore, API-key, unlock, and destructive changes
- Content Security Policy permits only same-origin assets and direct `api.openai.com` connections
- No third-party scripts, analytics, advertising, or embedded objects
- Backup validation, file-size bounds, and KDF-iteration bounds before import
- AES-256-GCM household update files with sequence checkpoints, duplicate detection, and gap rejection

## API key tradeoff

The OpenAI API key is encrypted inside the vault and never written to source code or plaintext browser storage. A static PWA still cannot make a client-side key equivalent to a backend secret. An injected script, malicious extension, compromised browser, or unlocked device may read it from memory. Use a project-specific key, set usage limits in the OpenAI dashboard, and rotate it if the device or site is compromised.

## Limits

- A 4-digit PIN is convenience protection and is weaker than device unlock or a long recovery passphrase.
- Data is decrypted in memory while a profile is unlocked.
- Profile-picker labels and operational metadata are locally visible before unlock.
- Origin storage is shared by pages on the same host origin. A dedicated domain offers stronger isolation than multiple unrelated GitHub Pages projects under one user origin.
- Local encryption does not replace phone encryption and a strong device passcode.
- There is no remote passphrase reset.
- A household invitation contains its household update key in the URL fragment. Share it privately; anyone who receives the invitation can create files encrypted for that household until the link is disabled.
- Unencrypted Excel exports intentionally fall outside the vault's encryption boundary.

## Deployment

- Keep `.github/workflows/deploy-pages.yml` and dependency lockfiles under review.
- Do not add API keys to GitHub Actions secrets for this static client design.
- Use HTTPS; WebAuthn and the PWA storage model require a secure context.
- Back up before changing domains because browser storage and WebAuthn credentials are origin-bound.

## Reporting

Do not include real documents, backups, passphrases, PINs, or API keys in a public issue. Use synthetic data when reporting a reproducible concern.

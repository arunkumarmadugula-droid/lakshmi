# Security

## Design

- AES-256-GCM authenticated encryption for vault contents
- PBKDF2-SHA-256 passphrase derivation with a unique 128-bit salt and 600,000 iterations
- Random 96-bit IV for each vault encryption
- Encryption key is non-extractable and kept only in page memory
- Automatic lock after inactivity
- Content Security Policy blocks third-party scripts, network API calls, and embedded objects
- No API keys, OAuth client secrets, or financial records are committed to the repository
- Encrypted backup format with validation before import

## Limits

- A short numeric passcode is weaker than a long passphrase if an attacker obtains the encrypted database.
- Data is decrypted in memory while the profile is unlocked.
- A compromised browser, malicious extension, jailbroken device, or injected script can access data displayed in an unlocked session.
- Local encryption does not replace iPhone device encryption and a strong device passcode.
- There is no remote passphrase reset.

## API keys

Never add an OpenAI or other provider secret to `src/`, `public/`, IndexedDB, localStorage, GitHub Actions output, or a GitHub Pages environment. A static website cannot keep a secret from its visitors. Use a server-side secret store and an authenticated proxy for any future direct API integration.

## Reporting

Do not include real financial documents, backups, passphrases, or API keys in a public issue. Report reproducible security concerns with synthetic data.

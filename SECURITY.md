# Vidya security boundary

- The local password is never stored. PBKDF2-SHA-256 derives a wrapping key;
  AES-256-GCM protects the random vault key and browser records.
- Task/chat/memory/settings state is encrypted in localStorage. Library records
  are encrypted in IndexedDB.
- Device unlock uses a platform passkey plus WebAuthn PRF when supported. iOS may
  use Face ID, Touch ID or the device passcode. Vidya never receives face data.
- The recovery key is shown once. Losing the password, recovery key and device
  credential makes a local-only vault unrecoverable.
- Encrypted backups omit Gemini, Claude and secure-engine access tokens. Restore
  the backup, then enter the engine token again in Settings.
- Production Gemini and Supabase server keys belong only in Supabase Edge
  Function secrets. Never commit them to GitHub or put them in `config.js`.
- The owner token is an API password. It is kept inside the encrypted vault,
  checked server-side, limited to the configured owner UUID and should be rotated
  if a device is lost or hosting is compromised.
- Exact-origin CORS, rate limiting, private tables and row-level security are
  included in the Supabase scaffold. Test them again after deployment.
- Full Library files remain local. Coach/brief calls send only the selected small
  excerpts and task/feed metadata needed for the request. Confirm that employer
  policy permits cloud processing before using confidential work material.

Local encryption protects data at rest from casual storage inspection. It cannot
protect an already unlocked device, malicious browser extension, operating-system
malware or a compromised hosting account. Protect GitHub and Google accounts with
MFA, review deployments, keep iOS/browser updates current and make encrypted
backups regularly.

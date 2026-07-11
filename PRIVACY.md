# Privacy

Lakshmi is local-first software. The public host serves only static application files; each browser origin keeps its own encrypted profile database.

## Encrypted locally

- Expenses, receipt items, split repayments, and income
- Budgets, schedules, payslips, and card statements
- Bank and savings balances
- Vehicle and fuel history
- Archived receipt, payslip, and statement files
- OpenAI API key, usage history, and cost estimates
- Settings and local snapshots

The locked profile picker retains the profile label and operational encryption metadata outside the vault. Recovery passphrases, PINs, raw encryption keys, and the plaintext API key are not written to disk by Lakshmi.

## Information sent to OpenAI

Lakshmi contacts OpenAI only after the user selects a document for analysis, asks a question from Board Insights, or validates a new API key.

- PDF text is extracted locally and used instead of the full PDF when practical.
- Images are compressed locally before analysis.
- Financial questions send a compact calculated summary, not the complete vault or archived files.
- Requests set `store: false`.

OpenAI processing is governed by the user's OpenAI account and API terms. Lakshmi records estimated tokens and cost locally.

## Backups

Portable `.lakshmi` files contain encrypted vault and document ciphertext plus the recovery-key wrapper. The operating-system share sheet controls whether a backup is saved to Files, iCloud Drive, Google Drive, or another provider. Quick biometric/PIN unlock data is never included.

## Separate users

Opening the same public URL on another phone creates an independent database. Multiple profiles on one browser use separate master keys, wrappers, records, snapshots, and document namespaces. No application-owned service combines user data.

## Deletion

Deleting a profile removes its encrypted records, snapshots, document metadata, document ciphertext, and quick unlock from that browser. Clearing website data or deleting the Home Screen app may also remove local records. External encrypted backups are the recovery method.

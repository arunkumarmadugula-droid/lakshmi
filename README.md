# Lakshmi Private Finance

Lakshmi is an offline-first household finance PWA for iPhone and Android Home Screen use. It can be hosted as a static site on GitHub Pages; every device keeps an independent local database.

First-time setup locks each profile to Canada (`CAD`, `en-CA`) or India (`INR`, `en-IN`). A linked companion inherits the primary household currency so imported records cannot mix units.

## Privacy and unlock model

- Financial records, settings, AI usage, snapshots, and archived documents are encrypted with AES-256-GCM before local storage.
- Each profile has a random 256-bit master key. The recovery passphrase wraps that key using PBKDF2-SHA-256 with 600,000 iterations.
- Face ID, Touch ID, fingerprint, and device unlock use WebAuthn with the PRF extension when the browser supports it. A 4-digit local PIN is the fallback.
- Quick-unlock wrappers never appear in a backup. A restored profile always requires its recovery passphrase before quick unlock can be configured again.
- Profile names and operational metadata needed by the locked profile picker remain visible locally. Financial contents and the OpenAI key remain encrypted.
- There is no recovery service. A lost recovery passphrase cannot be reset.

Safari 18 or newer is required for encrypted WebAuthn PRF unlock. The operating system chooses Face ID, Touch ID, fingerprint, face, or device passcode. If the required capability is unavailable, Lakshmi offers PIN or recovery-passphrase unlock.

## Direct AI document reading

An OpenAI API key can be entered during profile creation or from protected Settings. It is encrypted inside that profile and is never committed to GitHub, localStorage, logs, or backups in plaintext.

When the user chooses Camera or Photo / PDF:

1. Images are compressed locally; PDFs are parsed locally first.
2. Extracted PDF text is sent instead of the full PDF when sufficient text is available.
3. Scanned PDFs use low-detail page processing and images are resized before upload.
4. The OpenAI Responses API returns strict structured data.
5. Every field remains editable before saving.
6. The compressed original is encrypted into the local date-organized document archive.

Requests use `store: false` and the low-cost `gpt-5.4-mini` model. Estimated token usage and cost are recorded in the encrypted vault.

Important: a static browser app cannot protect an API key as strongly as a backend secret store. Malicious browser extensions, injected code, or a compromised unlocked device may read the key. This client-side design is intended for personal use and is an explicit tradeoff.

Receiptless purchases can be entered from Drive-through favourites on Add. Merchant, broad bucket, category, and usual payment method are remembered, while the amount always begins blank.

## Local storage and backup

- The live vault uses encrypted IndexedDB plus encrypted Origin Private File System storage when supported.
- Documents are organized internally by year, month, and type.
- Up to seven encrypted local snapshots are retained.
- A `.lakshmi` backup includes the encrypted vault and encrypted document archive.
- Backups can be saved to Files, iCloud Drive, Google Drive, or another personal provider through the operating-system share sheet.
- iOS does not allow a PWA to silently keep writing to an arbitrary cloud folder. Each external backup requires user confirmation.

Clearing website data, deleting the Home Screen app, or storage pressure can remove the local database. Keep a recent external encrypted backup.

An unencrypted `.xlsx` export is available for portability. It includes financial tables but excludes the API key and archived receipt files. Treat that workbook as sensitive.

## Linked household companion

- The primary profile creates a private invitation from the household button beside Settings.
- The invitation opens a separate encrypted companion profile on the partner's device.
- The companion has focused Add, Board, and Ledger tabs and manually chooses **Send updates now**.
- The companion Add tab accepts both receipts and credit-card statements; statement due dates, payment history, and card ownership synchronize separately from spending.
- On Android, open the invitation in Chrome, complete the encrypted profile, then choose **Install** in Linked household or Chrome's **Add to Home screen > Install** menu.
- Each encrypted incremental file contains only additions, edits, refunds, split repayments, and deletions since the previous successful send.
- Imports are duplicate-safe. A sequence gap is rejected instead of silently losing data, and the companion can send a full resync for recovery.
- There is no shared server or automatic background synchronization. Receipt images remain on the device that captured them; the shared file carries ledger records only.

## Accounting rules

- Receipt expenses count in `SPENT`, including purchases made on credit.
- Refunds reduce the related purchase and category. Credit-card refunds never become income or card payments.
- A credit-card statement creates reminders and a ledger record, but never a duplicate expense.
- Statement transactions are matched against existing receipts; unmatched debits or credits affect totals only after review.
- Paying a card reduces bank balance and stays separate from `SPENT`.
- Bill-split repayments reduce the original expense category and are not counted as income.
- `SAVED` equals recorded inflow minus net recorded expenses for the selected month.
- Income schedules begin from the first expected date and can move a selected share to savings.
- Dated salary-rate changes affect unposted deposits from their effective date; one-time bonuses do not change the recurring rate.
- Budget detail lines roll into their parent category totals.

## Run and verify

```bash
npm install
npm run dev
npm run check
```

The production build is written to `dist/`.

## Deploy to GitHub Pages

1. Back up the current Lakshmi profile before upgrading.
2. Put this project at the repository root and push `main`.
3. In **Settings > Pages**, select **GitHub Actions** as the source.
4. The included workflow tests, builds, and publishes `dist/`.
5. Open the Pages URL once online, then reopen the Home Screen app to activate the new service worker.

The relative Vite base supports both a user site and a repository subpath.

## Install on a phone

On iPhone, open the Pages URL in Safari, tap Share, then **Add to Home Screen**. On Android, use the browser's **Install app** or **Add to Home screen** command.

Google and Apple account login are intentionally omitted. They need OAuth configuration and a trusted identity backend. Local encrypted profiles keep users independent without a central database.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

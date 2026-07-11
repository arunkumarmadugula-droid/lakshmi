# Lakshmi 8.0.0

This release keeps the approved compact black-and-white interface while replacing manual ChatGPT handoffs with a complete encrypted, direct-analysis workflow.

## Highlights

- Face ID, Touch ID, fingerprint, or device unlock through WebAuthn PRF, with PIN and recovery-passphrase fallbacks
- Random master-key vault encryption with separate recovery and quick-unlock wrappers
- Optional encrypted OpenAI API key at profile setup and protected Settings
- Automatic AI analysis after camera, image, or PDF selection; no manual handoff or pasted JSON steps
- Local image compression, PDF text extraction, low-detail scanned-PDF processing, and per-feature API cost estimates
- Encrypted year/month/type document archive included in portable backups
- Direct one-tap manual forms for receipts, payslips, and card statements
- Editable receipt totals with automatic item, tax, tip, and discount calculations
- Payslip gross/net line calculations and reconciliation with salary, bank, and savings records
- Separate salary selector for personal and spouse Canadian estimates
- Salary inflow/outflow adjustments with per-pay, monthly, or yearly frequency
- Debt and EMI budget category
- Bill splitting, share sheet, copy, PDF receipt, repayment matching, and net category accounting
- Financial-only AI assistant inside Board Insights
- 2024 Ford Bronco Sport Badlands 4WD offline vehicle entry with tank capacity
- Lighter Fuel layout, iPhone safe-area fix, 16px form controls, and fixed-scale Home Screen behavior
- Stored-document browser, backup restore, encrypted local snapshots, and safer service-worker cache cleanup

## Privacy decisions

- No analytics, advertising, tracking, application-owned cloud, or central user database
- OpenAI requests happen only after the user selects a document or asks a financial question
- API requests use `store: false`; the key and usage history remain inside the encrypted vault
- Quick unlock is device-local and excluded from backups
- iCloud Drive, Google Drive, and Files backups require operating-system confirmation

## Verification

- Accounting, schedules, payroll, fuel, prices, split-repayment, and six-tab render tests
- Encryption, wrong-passphrase, PIN wrapper, raw-storage, document archive, isolated restore, and backup-validation tests
- OpenAI request-shape, structured-output, low-detail PDF, and cost-accounting test
- Production build and complete offline-asset verification

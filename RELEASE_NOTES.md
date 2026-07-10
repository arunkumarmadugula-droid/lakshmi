# Lakshmi 7.0.0

This release turns the approved black-and-white mockup into a complete local-first finance PWA for GitHub Pages and iPhone Home Screen use.

## Included

- Six-tab interface: Add, Board, Ledger, Prices, Budget, and Fuel
- Cash-flow calendar with month and dated-list views
- PDF, photo, screenshot, clipboard, manual, and ChatGPT-share document workflows
- Editable receipt, payslip, and card-statement review before saving
- Credit-card reminders and payment tracking without duplicate spending
- Salary estimates, payslip actuals, recurring budgets, savings splits, and current balances
- Offline Canadian 2020-2026 vehicle catalogue and fuel-economy tracking
- Three themes based on the approved compact Apple-style visual system
- Encrypted local profiles, automatic local snapshots, and encrypted portable backups
- Offline PWA assets, iPhone icons, and automated GitHub Pages deployment

## Privacy decisions

- No API key is stored in the app.
- No Google or Apple login is included; profiles are local and independent.
- No analytics, advertising, tracking, or application-owned cloud database is used.
- A selected document leaves the device only through an explicit share-sheet action.
- Cloud backups are encrypted files saved by the user to their own provider.

## Verification

- Accounting and schedule regression tests
- Six-tab server-render test with populated data
- Encryption, wrong-passphrase, raw-storage, isolated-restore, and backup-validation tests
- Production build and offline-asset verification
- Dependency vulnerability audit

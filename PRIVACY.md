# Privacy

Lakshmi is local-first software. The static application code can be hosted publicly, while each user's financial database remains inside that user's browser storage.

## Stored locally

- Expenses and receipt items
- Income sources and deposits
- Budgets and scheduled expenses
- Payslip figures
- Credit-card statements and payments
- Bank and savings balances
- Vehicle and fuel records
- Theme and privacy settings

Financial data is encrypted before it is written to IndexedDB. The passphrase and decrypted encryption key are not written to disk by Lakshmi.

## Information that may leave the device

Lakshmi itself does not sync financial data. A document leaves the device only when the user explicitly chooses **AI read** and selects ChatGPT or another destination in the operating-system share sheet. That document is then governed by the selected destination's privacy terms.

Encrypted `.lakshmi` backup files leave the device only when the user explicitly saves or shares them. The backup remains encrypted and requires the original passphrase.

## Separate users

Browser storage is isolated by website origin and browser profile. Opening the URL on another phone creates an independent database. Multiple local Lakshmi profiles on one browser use separate salts, keys, encrypted vault records, and snapshots.

## Deletion

Deleting a local profile removes its encrypted vault and local snapshots from that browser. Clearing Safari website data, deleting the Home Screen web app, or losing the device may also remove local records. External encrypted backups are the recovery method.

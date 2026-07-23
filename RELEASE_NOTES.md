# Lakshmi 8.5.2

This patch restores reliable encrypted-file selection on iPhone and makes the app's recovery boundary explicit.

## Highlights

- Backup, partner-update, and joint-account import pickers no longer hide custom Lakshmi files that iOS reports as an unknown type
- Every selected import still passes the existing format, size, and encryption validation before any vault data is written
- The lock screen now explains that profile names are local, quick unlock is device-only, and an encrypted backup cannot be reset without its original recovery passphrase
- Home Screen artwork moves to a new `v852` URL so installed copies receive the release cleanly

## Verification

- Automated coverage confirms all encrypted import pickers are unrestricted while strict backup validation remains active
- Production GitHub Pages build verifies the manifest and `/lakshmi/` launch path

---

# Lakshmi 8.5.1

This patch prevents iPhone Home Screen installations from launching a hashed `/assets/` manifest path and returning GitHub Pages 404.

## Highlights

- GitHub Actions derives the Vite base from the repository name (`/lakshmi/`)
- Manifest, browser icon, and Apple touch icon use Vite's project-base placeholder and remain at the deployed app root
- A production assertion fails the build if the manifest is ever emitted under `/assets/`
- The assertion also resolves `start_url` exactly as a phone would and requires `/lakshmi/`
- Home Screen artwork moves to a new `v851` URL
- Source deployment instructions now match the repository's build-and-deploy workflow

## Verification

- Live deployment diagnosis confirmed the old manifest resolved `./` from `/lakshmi/assets/`
- Automated app tests and production Pages build pass before packaging

---

# Lakshmi 8.5.0

This release makes the phone shell truly edge anchored, adds locked Canada/India currency profiles, and completes Android companion installation and card-statement capture.

## Highlights

- Bottom navigation is fixed to the physical bottom viewport edge while the screen reserves its own safe scrolling space
- JavaScript viewport-height measurement has been removed, preventing stale iPhone installation geometry
- First-time setup asks Canada or India and locks the profile to CAD/en-CA or INR/en-IN
- Indian salary planning accepts entered or payslip take-home pay without misapplying Canadian tax deductions
- Household invitations carry the primary profile's country and currency to the companion profile
- Partner Add presents Receipt and Card bill as two full-width choices; card statements, due dates, and payments synchronize as partner-owned records
- Android companion settings include install status, an in-app install prompt when Chrome offers one, and exact fallback menu guidance
- Versioned `v850` Home Screen icons force a new asset URL instead of reusing old iOS icon artwork
- Manifest and version checks are network-first while the rest of the PWA remains available offline

## Verification

- 34 automated tests cover full-screen layout, currencies, partner cards, invitation region locking, accounting, encryption, documents, and rendering
- Production GitHub Pages build verified with 20 offline assets

---

# Lakshmi 8.4.0

This release corrects the iPhone Home Screen geometry, makes chart history begin at profile activation, and makes deployed-version status visible.

## Highlights

- Mobile shell is anchored to all four viewport edges instead of trusting iOS's shorter visual viewport measurement
- Bottom navigation uses a compact home-indicator allowance, keeping controls lower without placing labels on the gesture area
- Cash-flow charts exclude records before profile activation and omit every inactive month after activation
- A new profile with no activity shows one honest empty current-month plot instead of fabricated historical bars
- Category, cash-flow, budget, and card-payment visuals retain tap, click, and keyboard value exploration
- Settings displays the installed app version, chart start month, and a GitHub Pages update check
- Service-worker changes reload an already installed PWA once the new release takes control
- Vault schema 5 persists a stable chart start month across backups and restores

## Verification

- 30 automated tests cover activation-aware charting, empty-state rendering, version comparison, accounting, encryption, documents, and household sync
- Production build and mobile browser geometry verified before packaging

---

# Lakshmi 8.3.2

This patch makes every Board chart responsive to the records that actually exist and adds accessible value exploration.

## Highlights

- Cash-flow charts show up to six recorded months rather than six fixed calendar placeholders
- Fully refunded, future, and empty months no longer create blank bars
- Credit-card payment history derives its own month axis from real payments
- Category, cash-flow, budget, and card-payment charts support tap, click, and keyboard selection
- Selected points reveal exact amounts, percentages, net cash flow, or budget variance
- Category charts group overflow into an accurate Other categories segment
- Clear empty states replace charts when no qualifying records exist
- Ask Lakshmi receives the same compact, data-backed monthly history

## Verification

- 28 automated tests passed, including data-driven chart and owner-scope regressions
- Production GitHub Pages build verified with 15 offline assets

---

# Lakshmi 8.3.1

This patch prevents scanned receipt dates from swapping the day and year.

## Highlights

- Canadian dates such as `20/07/2026` normalize to the internal ISO value `2026-07-20`
- Repairs the observed OCR forms `2020 26th 07`, `2020-26-07`, and `2020-07-26` when the scan reference is July 20, 2026
- Validates that extracted dates exist on the calendar before they reach a date input or ledger record
- Adds a visible confirmation warning whenever a suspicious date is automatically repaired
- Applies the same validation to receipts, payslips, card statements, due dates, and card transactions
- Displays Ledger dates as `DD/MM/YYYY`
- Strengthens the AI instruction with today's date and explicit Canadian day/month/year handling

## Verification

- 26 automated tests passed, including three date-specific regression tests
- Production GitHub Pages build verified with 15 offline assets

---

# Lakshmi 8.3.0

This release fixes the remaining iPhone bottom-viewport gap and refreshes Lakshmi's identity without changing the approved compact interface.

## Highlights

- Edge-to-edge mobile shell uses the measured visible viewport instead of conflicting fixed and percentage heights
- Bottom navigation and page background now share the same theme surface, including the iPhone safe area
- New minimal three-petal prosperity lotus in the header, lock screen, browser icon, and home-screen icons
- Lock and profile screens inherit Black and white, Lotus light, or Fun and bright from the selected profile
- Theme metadata contains only the appearance name; financial records and API credentials remain encrypted
- Theme colors are also applied to the browser status area and persist across a full restart
- Fresh `lakshmi-v8-3` service-worker cache ensures the updated shell and icons replace the previous release

## Verification

- 23 automated tests passed
- Production build verified with 15 offline assets
- Mobile browser QA passed at 375 x 667, 390 x 844, and 430 x 932
- Measured bottom gap: 0 px at all tested viewport sizes
- No horizontal overflow and no browser console warnings

---

# Lakshmi 8.2.0

This release completes the shared-household money model while keeping the approved compact black-and-white interface as the default.

## Highlights

- Parent budgets now use one exclusive rule: direct amount when no details exist, otherwise the exact sum of all subcategories
- Ledger Day mode changes the navigator to single-day arrows, with the calendar retained for direct date jumps
- Direct refund access from both Manual entry and the floating quick-entry menu
- Joint account with opening balance, contribution and withdrawal history, optional personal-balance adjustment, and derived balance math
- Partner updates now include expenses, refunds, split repayments, cards, statements, payments, and joint transfers
- Encrypted joint-account snapshots reconcile the companion device without sending the primary user's private ledger
- Partner credit-card due status and payment history on both devices, with personal, joint, or status-only payment sources
- Multiple savings goals for emergency funds, home purchases, vehicles, general savings, and custom targets
- Ask Lakshmi suggestions for spending, savings goals, emergency funds, and locally estimated Canadian payroll tax
- In-app Document Library grouped by month and document type, backed by compressed encrypted app storage
- New Fun and bright theme; the former Forest wealth theme migrates back to the black-and-white default
- Network-first PWA navigation prevents a newly deployed release from loading a stale HTML shell with removed assets
- Excel export now includes owner-scoped card history, savings goals, and joint-account transfers

## Verification

- 23 automated tests covering accounting, schedules, encryption, document analysis, partner checkpoints, joint reconciliation, rendering, and Excel validity
- Mobile browser QA at 390 x 844 with no horizontal overflow, header overlap, navigation overlap, or console warnings
- Production GitHub Pages build with complete offline-asset verification

---

# Lakshmi 8.1.0

This release preserves the approved compact black-and-white UI while extending Lakshmi for refund-aware accounting, receiptless purchases, dated income changes, and a private two-device household workflow.

## Highlights

- Manual linked-household companion with independent encrypted profiles
- Three-tab companion experience: Add, Board, and Ledger
- **Send updates now** exports only changes since the previous successful send
- Duplicate-safe imports, sequence-gap detection, deletions, and full-resync recovery
- Mine, Partner, and Household dashboard and ledger views on the primary profile
- Drive-through favourites for Apple Wallet, credit-card, debit, or cash purchases without receipts
- User-managed merchants and broad Coffee, Breakfast, Quick meal, Snacks, and Other buckets
- Blank amount on every quick-capture entry, with optional purchase detail for later completion
- AI and manual refund classification with bank, cash, or card destinations
- Linked refunds restate the original expense; unlinked refunds reduce the month received
- Credit-card statement transaction extraction, editable review, receipt matching, and confirmation queue
- Statement card credits become refunds and never inflate income, spending, or card-payment totals
- Day, Month, and All ledger views with an exact-date calendar picker
- Dated salary-rate history for future scheduled deposits and separate one-time bonuses
- Personal and partner salary estimate selector with persistent tax breakdowns
- Parent budget totals that include every detailed subcategory, including Debt & EMI
- First-run private setup for balances, salary, cards, starter budgets, and optional vehicle setup
- Fuel history with litres, price per litre, total cost, odometer, octane, and observed economy
- Bundled 2024 Ford Bronco Sport Badlands 4WD vehicle entry
- Unencrypted Excel portability export covering expenses, refunds, income, cards, fuel, budgets, and split repayments
- Fixed mobile viewport shell, safe-area navigation, and 16px focused form controls

## Privacy decisions

- No analytics, advertising, tracking, application-owned cloud, or central user database
- Household updates are AES-GCM encrypted with a household-specific key carried in the private invitation fragment
- Partner receipt images remain encrypted on the device that captured them; update files contain ledger records only
- OpenAI requests happen only after the user selects a document or asks a financial question
- API requests use `store: false`; the encrypted API key never enters a partner update or Excel export
- External backup, partner sharing, and cloud destinations require an explicit operating-system share action

## Verification

- 20 automated tests covering accounting, refunds, owner isolation, schedules, dated salary rates, budgets, fuel, prices, OpenAI request shape, encrypted vaults, partner checkpoints, duplicate imports, gap recovery, rendering, and Excel export
- Production GitHub Pages build with complete offline-asset verification

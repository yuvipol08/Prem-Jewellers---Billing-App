# Changelog

All notable changes to Prem Jewellers Billing.
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Windows print dialog showed "This app doesn't support print preview."** Electron does not
  implement Chromium's print-preview data source, so its dialog can never fill that pane.
  Printing now uses an in-app printer picker and prints straight to the chosen printer; the OS
  dialog remains available under *System dialog…* for tray and duplex options.
- **Two scrollbars in the print preview.** The modal body and the preview stage were both
  scrolling the same content. The stage is now the only scroll container, and the sheet is scaled
  to fit in both directions, so a whole A4 page is visible with nothing to scroll.

- **Print could land in OneNote.** Electron dropped the default-printer flag from `PrinterInfo`
  and Windows does not reliably populate its replacement, so detection returned nothing and
  selection fell through to the first printer in the list — often OneNote or Microsoft Print to
  PDF. The Windows default is now read from the registry, virtual printers are never guessed at,
  and the shop's chosen printer is remembered.

### Added

- **Interactive preview.** Zoom in and out, Fit Page, Fit Width, click the percentage to reset to
  100%, Ctrl and the wheel to zoom about the pointer, and drag to move the page. Scrollbars appear
  only when the zoomed page is larger than the window, and the sheet holds true A4 proportions at
  every zoom level.
- A toolbar above the sheet carrying the zoom controls, the printer and the print actions.
- Virtual printers are marked *(saves to a file)* in the list, sorted below real printers, and
  warned about when one is selected.
- Printer selection in the preview, with the system default pre-selected.
- A clear message when no printer is attached, pointing at Save PDF.
- The preview states the true page size — *A4 210 × 297 mm · shown at 68%*.

## [1.0.0] — 2026-08-19

First release. Offline-first billing for Prem Jewellers, Jalgaon, on Windows and macOS.

### Billing

- Billing screen opens first, with the next invoice number already prepared
- Invoice numbers derived from stored data (`PJ/25-26/0001`), restarting each financial year, or
  continuous — configurable, with a settable start number so it can continue from the paper book
- Customer type-ahead over name, mobile, GSTIN and PAN, with automatic fill of returning customers
- Item grid matching the paper bill: HSN, particulars, gross weight, net weight, rate, making
  charge, amount
- Making charges per line as a flat amount, per gram, or a percentage of metal value
- Automatic GST: CGST + SGST for intra-state, IGST for inter-state, decided by place of supply
- Discount apportioned pro-rata across lines so each HSN line keeps a correct taxable value
- Round-off to the nearest rupee, amount in Indian words, part payment with balance
- Payment by Cash, Cheque or Online with reference capture
- Keyboard-first: `Enter` walks the item grid, `F2` new bill, `Ctrl+Enter` save and print,
  `Ctrl+1`–`5` switch screens

### Documents

- A4 invoice rendered from a single template shared by preview, PDF and printer
- Bills up to nine lines fit one page; short bills padded with ruled rows like the bill book
- Reprints banded *Duplicate Copy*
- Self-contained documents — no fonts, images or scripts fetched
- PDF export and instant print preview

### Records

- Local SQLite database in WAL mode; billing never requires internet
- Customers saved automatically from bills, with full purchase history
- Invoice history with search and filters by date, customer, number and payment mode
- Edit today's invoices; cancel older ones (they stay in the records but stop counting as sales)
- Duplicate any invoice onto a fresh number
- Dashboard: today, this month, this financial year, customer count, last 30 days, recent bills

### Backup

- Offline JSON backups with SHA-256 verification and idempotent restore
- Optional automatic backup on exit to a chosen folder
- Cloud backup to the shop's own Firebase project over REST (no SDK bundled)
- **Emergency Backup & Clear Device** — uploads, verifies by checksum, then securely erases

### Sharing

- WhatsApp delivery via the Cloud API, or by opening the customer's chat with the PDF ready to
  attach; Indian mobile numbers normalised automatically

### Quality

- 236 automated checks across six suites: unit, integration/E2E, backup, security, UI and
  performance
- Verified at 5,000 invoices: list 1 ms, search 5 ms, dashboard 1 ms, flat memory
- Nine hand-worked GST scenarios cross-checked against the calculation engine

### Fixed during pre-release QA

- **Duplicate billing on `Ctrl+Enter`** — a stale React closure caused save-and-print to write the
  same bill twice under two invoice numbers
- **Emergency wipe left records readable** — `VACUUM` under WAL needs a checkpoint *after* it, and
  `secure_delete` to zero freed pages; verified against the raw database bytes
- **Emergency archive failed past ~1,565 invoices** — Firestore's 1 MiB document cap; archives are
  now chunked and reassembled with checksum verification
- **Credentials could reach a snapshot** — the sanitisation flag was inverted; snapshots now strip
  secrets unconditionally
- **Settings screen read the whole book** — replaced an N+1 snapshot with a `COUNT` query
  (932 ms → 0 ms at 5,000 invoices)
- **Negative amounts printed `₹-0.19`** — the sign now sits outside the symbol
- **Raw SQLite error at the counter** — duplicate invoice numbers now explain themselves

### Known limitations

The local database is not encrypted; cloud backup is on demand rather than scheduled; there is no
auto-update, no multi-counter support, and the app ships with the default Electron icon. See
`docs/PRODUCTION_READINESS.md` for the full list and for what remains unverified.

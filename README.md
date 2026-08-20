# Prem Jewellers — Billing

A premium, offline-first billing application for **Prem Jewellers, Jalgaon**, running on
Windows and macOS.

Every bill is written to a local SQLite database on the shop's own computer. The internet is
used only when you ask for it — cloud backup, WhatsApp delivery — and never stands between
the counter and a printed invoice.

---

## Screens

| Screen | What it is for |
| --- | --- |
| **Billing** | The screen the app opens on. Auto-numbered invoice, customer lookup, item grid, live GST and totals, print / PDF / WhatsApp. |
| **Customers** | The customer book. Search by name, mobile, GSTIN or PAN; full purchase history per customer. |
| **Invoices** | Every bill ever raised. Filter by date, customer, invoice number or payment mode; reprint, re-download, duplicate, edit or cancel. |
| **Dashboard** | Today's sales, this month, this financial year, customer count, last 30 days, recent bills. |
| **Backup & Settings** | Shop details, invoice format, offline and cloud backup, WhatsApp, and Emergency Backup & Clear Device. |

---

## The billing screen

* Invoice numbers are generated automatically as `PJ/25-26/0001`, restarting each financial
  year (1 April – 31 March). Continuous numbering is available in Settings.
* Typing two characters into the customer field searches name, mobile and GSTIN. Arrow keys
  move, `Enter` picks, and the rest of the customer's details fill in.
* The item grid matches the paper bill column for column: **HSN · Particulars · Gross Weight ·
  Net Weight · Rate · Making · Amount**.
* Making charges can be a **flat amount**, **per gram**, or a **percentage of metal value** —
  pick per line with the small selector in the Making column.
* GST is calculated per line. When the customer's state matches the shop's it splits into
  CGST + SGST; otherwise the full rate is charged as IGST. Jewellery defaults to 3%.
* A discount is apportioned across lines pro-rata, so each HSN line keeps the correct taxable
  value for your GST return.
* The total rounds to the nearest rupee and the round-off is printed on the bill.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `F2` | New bill |
| `Ctrl`/`Cmd` + `S` | Save |
| `Ctrl`/`Cmd` + `Enter` | Save and print |
| `Ctrl`/`Cmd` + `P` | Print |
| `Ctrl`/`Cmd` + `Shift` + `P` | Print preview |
| `Ctrl`/`Cmd` + `E` | Save as PDF |
| `Ctrl`/`Cmd` + `W` | Share on WhatsApp |
| `Alt` + `N` | Add an item line |
| `Enter` (in the grid) | Move down the same column |
| `Ctrl`/`Cmd` + `1`…`5` | Switch screens |
| `F1` | Shortcut help |

---

## Printing and PDFs

The printed invoice, the PDF and the on-screen preview are all produced from **one** template
([`shared/invoiceTemplate.ts`](shared/invoiceTemplate.ts)), so what the shop sees on screen is
exactly what comes out of the printer.

* True A4 portrait with physical margins in millimetres.
* Bills of up to nine lines always fit a single sheet; longer bills flow to a second page.
* Short bills are padded with ruled blank rows so the sheet keeps the look of the bill book.
* Weight columns are aligned to three decimals, amounts to two, in tabular figures.
* Signature block, declaration, terms, bank/UPI details and the GST summary are all on the page.
* The document is entirely self-contained — no fonts, images or scripts are fetched, which is
  why it renders instantly and works with no internet.

Everything printed in the header and footer — shop name, address, GSTIN, terms, declaration,
signature label — comes from **Settings → Shop Details** and **Invoice & Printing**. Adjust
those to match your existing bill book; no code changes are needed.

Reprints of an existing invoice are banded **Duplicate Copy**.

---

## Fixed business identity

The shop's name, address, GSTIN, PAN, phone, bank details, invoice heading, terms, declaration
and signature label live in [`shared/business.ts`](shared/business.ts) and are **not editable
from Settings**. They print on every invoice, and a GSTIN changed by accident at the counter
would make every later bill non-compliant.

The values are re-applied on every settings read, so a stale row from an older build, an edited
database, or a backup restored from another machine can never reach a printed bill. Settings
shows them read-only with an explanation. To change them, edit that file and rebuild.

Any statutory field still blank raises a banner across the top of the app until it is filled in.

## Typography

Cormorant Garamond for the masthead and brand mark, Manrope for everything else, both
self-hosted so they work with no network under the app's content security policy.

The printed invoice embeds its faces as base64. That keeps the document self-contained, and it
means the bill renders identically on Windows and macOS rather than falling back to Segoe UI or
Helvetica depending on the machine. Money columns use tabular figures throughout, so digits line
up in every column on screen and on paper.

## Offline-first

* All data lives in a local SQLite database in the app's user-data folder (the exact path is
  shown in **Settings → Offline Backup**).
* SQLite runs in WAL mode, so reading history never blocks writing a bill.
* Billing, printing and PDF export never touch the network. The header shows an
  *Offline — billing continues* badge when there is no connection.

---

## Backup

**Offline backup.** *Settings → Offline Backup* writes a single JSON file containing every
invoice, customer and setting, with a SHA-256 checksum. Restoring verifies that checksum first
and refuses a damaged file. Restores are idempotent: invoices match on invoice number and
customers on mobile number, so importing the same backup twice does not double your books.
The app can also write a backup automatically each time it closes.

**Cloud backup.** *Settings → Cloud Backup* uses **your own Firebase project** over the REST
APIs — no Firebase SDK is bundled, which keeps the app small and startup instant. You need:

1. A Firebase project with **Cloud Firestore** enabled.
2. **Email/Password** sign-in enabled under Authentication, and one user created for the shop.
3. The project ID and Web API key from Project Settings.

Enter those in Settings and press **Test Connection** — it writes a probe document, reads it
back and compares checksums before reporting success.

### Emergency Backup & Clear Device

One button, under *Settings → Emergency*, for the case where the shop's laptop may be seen by
someone who should not see the books. It runs in this order, and the order is the whole point:

1. Uploads every invoice and customer to your cloud account, plus a single complete archive.
2. **Reads the archive back and compares SHA-256 checksums.**
3. Only if that verification passes, erases all business records from this computer.

If the upload or the verification fails, **nothing is deleted** and you are told why. Shop
settings survive so the app stays usable, and everything can be brought back later with
*Restore From Cloud*.

Deletion is a real deletion: the tables are cleared, the write-ahead log is checkpointed and
the database is `VACUUM`ed, so the old rows are not left behind in free pages of the file.

Arming it requires typing **`BACKUP AND CLEAR`** exactly, and it is disabled entirely until
cloud backup is configured.

---

## WhatsApp

After a bill is saved, **WhatsApp** produces the PDF and then:

* **With the WhatsApp Cloud API configured** (Settings → WhatsApp): uploads the PDF and sends
  it to the customer's number automatically.
* **Otherwise**: opens WhatsApp on the customer's chat with the message already written, and
  highlights the PDF in your file manager so you can attach it in one drag.

Either way you end up with a PDF — sharing never fails silently. Indian mobile numbers are
normalised automatically (a leading `0` is dropped, the country code is added).

---

## Tech

| Layer | Choice |
| --- | --- |
| Shell | Electron 43 (Windows + macOS) |
| UI | React 19 + TypeScript, built by Vite 8 |
| Local database | SQLite via `better-sqlite3` (WAL) |
| Cloud | Firebase Auth + Firestore over REST |
| PDF / print | Chromium `printToPDF` from the shared invoice template |
| Typography | Cormorant Garamond + Manrope, self-hosted |
| Packaging | electron-builder (NSIS installer, portable exe, DMG) |

The renderer runs with `nodeIntegration: false`, `contextIsolation: true` and a locked-down
CSP. It reaches the database only through the small typed bridge in
[`shared/api.ts`](shared/api.ts).

### Layout

```
shared/              types, calculations and the invoice template (used by both sides)
  business.ts        LOCKED shop identity — edit here, never at runtime
  fonts.ts           generated: invoice faces inlined as base64
electron/main/       app lifecycle, SQLite, IPC, PDF, printing, WhatsApp, backup, cloud
electron/preload/    the context bridge — the only path from UI to Node
src/                 React UI: pages, components, hooks, styles
scripts/             doctor, QA runner, font embedding, document generation
tests/unit/          calculation, template, numbering and messaging tests
tests/electron/      integration, backup, security, UI and performance suites
```

---

## Documentation

| Document | For |
| --- | --- |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Running on Windows, remaining work, build commands, delivery checklist |
| [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) | Test results, defects found and fixed, what remains unverified |
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | Installing and first-run setup at the shop |
| [docs/BACKUP_AND_RESTORE.md](docs/BACKUP_AND_RESTORE.md) | Backup routine, cloud setup, the emergency wipe |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | Architecture and maintenance |
| [docs/Prem-Jewellers-Billing-User-Manual.pdf](docs/Prem-Jewellers-Billing-User-Manual.pdf) | The counter staff's manual |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

## Deploying and handing over

[**DEPLOYMENT.md**](DEPLOYMENT.md) covers running the app on Windows, the remaining work
before production, build commands with troubleshooting, and a delivery checklist for the
shop.

## Development

```bash
npm install          # no compiler toolchain needed — see below
npm run dev          # Vite + tsc watch + Electron, with hot reload
npm run doctor       # checks the environment when something misbehaves
```

**`npm install` requires nothing but Node 22+.** No Python, no Visual Studio Build Tools.
`better-sqlite3` ships ABI-stable N-API prebuilds for every platform, so nothing is compiled.
Never run `electron-builder install-app-deps` on this project — it bypasses that and will demand
a full C++ toolchain.

```bash
npm run typecheck     # both TypeScript projects
npm test              # 94 unit tests: calculations, template, numbering, messaging
npm run test:core     # database, numbering, billing cycle, PDF
npm run test:backup   # backup, restore, cloud, emergency wipe, WhatsApp
npm run test:security # injection, escaping, credentials, process isolation
npm run test:ui       # boots the built UI and drives it, saving screenshots
npm run test:perf     # 5,000-invoice stress, memory, timings
npm run qa            # all six suites, writes qa-results/summary.json
npm run verify        # typecheck + qa
```

236 checks across six suites. The QA runner adds `xvfb-run` by itself on headless Linux.
Raise the stress size with `PJ_STRESS_INVOICES=20000 npm run test:perf`.

### Building installers

```bash
npm run dist:win     # NSIS installer for Windows (x64)
npm run dist:mac     # DMG for macOS (Intel + Apple Silicon)
```

Build each installer **on** its target OS. No compiler toolchain is required —
`better-sqlite3` ships ABI-stable N-API prebuilds for every platform, so there is nothing to
build from source (no Visual Studio Build Tools, no node-gyp). electron-builder does download
Electron and the installer toolchain on first run, so the machine needs normal internet access.

---

## Notes

* **Invoice layout.** The template reproduces a standard Indian jewellery GST tax invoice with
  the columns listed in the requirements. All the wording and identity on the page is driven by
  Settings, so it can be tuned to match the existing bill book exactly — if any column widths
  or ordering need to change, that is a small edit to `shared/invoiceTemplate.ts`.
* **Editing.** Only invoices dated **today** can be edited. Older bills are reprinted,
  duplicated or cancelled — cancelled bills stay in the records for GST but stop counting as
  sales.
* **Single instance.** The app refuses to open twice, so two windows can never hand out the
  same invoice number.

---

## Support

Built and maintained by **TridentCrew**.

| | |
| --- | --- |
| Mobile | 9096310817 |
| Email | contact@tridentcrew.com |

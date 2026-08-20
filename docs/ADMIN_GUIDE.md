# Admin Guide

For whoever maintains the software — not for the counter staff.

Maintained by **TridentCrew** — 9096310817 · contact@tridentcrew.com

## Architecture in one page

```
shared/          pure domain code, imported by BOTH sides
  business.ts    LOCKED shop identity — edit here, never at runtime
  fonts.ts       generated: invoice faces inlined as base64
  types.ts       every record shape
  calc.ts        GST, making charges, round-off, amount in words
  numbering.ts   financial-year series, LIKE escaping, sequence parsing
  invoiceTemplate.ts   the A4 invoice as one HTML function
  whatsapp.ts    number normalisation and message templating
  api.ts         the IPC contract shared by preload and renderer

electron/main/   the only process with disk, network and print access
  db/            better-sqlite3: connection, migrations, repositories, snapshot
  services/      documents (PDF/print), whatsapp, cloud (Firebase REST), backup
  ipc.ts         every channel, each wrapped so failures return {ok,message}
  index.ts       lifecycle, window, single-instance lock, navigation guards

electron/preload/  the one bridge; nothing else crosses

src/             React renderer — no Node access at all
```

The important property: **`shared/calc.ts` and `shared/invoiceTemplate.ts` are imported by both
the renderer and the main process.** The number on screen and the number on paper cannot diverge,
because they are produced by the same function.

## Database

SQLite via `better-sqlite3`, WAL mode, `synchronous = NORMAL`, foreign keys on.

| Table | Holds |
| --- | --- |
| `customers` | the customer book |
| `invoices` | one row per bill, with computed totals **stored alongside the inputs** |
| `invoice_items` | line items, cascade-deleted with their invoice |
| `settings` | one JSON blob under key `app_settings` |
| `sync_state` | last cloud backup / sync timestamps |

Totals are stored, not recomputed on read. This is deliberate: changing the default GST rate or a
making-charge mode next year must never alter what an old bill says.

### Migrations

Forward-only, keyed off `PRAGMA user_version`, in `electron/main/db/connection.ts`. To add one,
append a function to the `migrations` array — never edit an existing entry. Each step runs inside
a transaction with the version bump, so an interrupted upgrade cannot half-apply.

### Invoice numbering

Derived from stored data, not a counter. `nextInvoiceNumber()` scans existing numbers in the
current series and takes the highest + 1. This means restoring a backup or clearing the device can
never reissue a number. The prefix is escaped before it reaches `LIKE`, so a prefix containing
`_` or `%` cannot scan the wrong series.

## Common tasks

### Change the invoice layout

Everything printed lives in `shared/invoiceTemplate.ts`. It is one function returning a complete
HTML document with inline CSS in millimetres. Preview, PDF and printer all use it, so a change
lands in all three.

Watch the page budget: at present up to **nine** item lines fit one A4 sheet. The default filler
row count (10) was chosen by measuring actual page counts; if you change row heights or paddings,
re-measure with `npm run test:core`, which asserts one page for a nine-line bill.

### Change GST behaviour

`shared/calc.ts`. Discount is apportioned pro-rata by line value so each HSN line keeps a correct
taxable value for the return. `tests/unit/gst-manual.test.mjs` contains nine hand-worked scenarios
with the arithmetic written out — update those first if the rules change.

### Change the shop's business details

Edit `shared/business.ts` and rebuild. Those values are copied into the default settings and
re-applied on every settings read, so a stale value in the database — from an older build or a
restored backup — can never reach a printed invoice. `LOCKED_SHOP_FIELDS` in
`shared/defaults.ts` lists which keys are enforced this way; Settings renders them read-only.

`missingBusinessDetails()` drives the warning banner. Add a field to `REQUIRED_FOR_COMPLIANCE`
if it must be present before invoices are considered compliant.

### Change the fonts

The invoice embeds its faces as base64 so the document is self-contained and prints identically
on every machine. After changing a font dependency, run `npm run fonts` to regenerate
`shared/fonts.ts`. The UI loads the same families from `@fontsource` through the bundler.

### Add a setting

1. Add the field to `ShopSettings` (or the relevant block) in `shared/types.ts`
2. Add a default in `shared/defaults.ts`
3. Add the control in `src/pages/SettingsPage.tsx`

`mergeSettings()` deep-merges stored settings over the defaults, so existing installs pick up new
keys automatically without a migration.

### Add an IPC channel

1. Add the channel name to `IPC` and the method to `BillingApi` in `shared/api.ts`
2. Register the handler in `electron/main/ipc.ts` (wrap in `guarded()` if it can fail)
3. Expose it in `electron/preload/index.ts`

The typed contract means missing any step is a compile error.

## Running the checks

```bash
npm run typecheck     # both TypeScript projects
npm test              # 94 unit tests
npm run test:core     # database, numbering, billing cycle, PDF
npm run test:backup   # backup, restore, cloud, emergency wipe, WhatsApp
npm run test:security # injection, escaping, credentials, isolation
npm run test:ui       # boots the built UI and drives it
npm run test:perf     # 5,000-invoice stress, memory, timings
npm run qa            # everything, writes qa-results/summary.json
```

On headless Linux the QA runner adds `xvfb-run` by itself. On Windows and macOS it runs Electron
directly. Raise the stress size with `PJ_STRESS_INVOICES=20000 npm run test:perf`.

## Building

```bash
npm run build         # compile only
npm run dist:win      # NSIS installer + portable exe
npm run dist:mac      # DMG (must run on a Mac)
npm run docs          # regenerate the User Manual PDF
```

No compiler toolchain is needed. `better-sqlite3` ships ABI-stable N-API prebuilds for every
platform, which is why `npmRebuild: false` is set in `electron-builder.yml` and there is no
`postinstall` script. If you ever see node-gyp or MSBuild errors, something has re-enabled a
rebuild that this project does not need.

## Cloud storage layout

Firestore, via REST — no Firebase SDK is bundled. Collections are namespaced:

```
{namespace}__invoices/{invoiceNo}       one document per bill
{namespace}__customers/{id}             one document per customer
{namespace}__manifests/latest           counts and checksum of the last backup
{namespace}__archives/{archiveId}       emergency archive manifest
{namespace}__archives/{archiveId}__partN chunks of the archive
{namespace}__health/connection-check    written by Test Connection
```

Each document stores its payload as one JSON string plus a SHA-256 checksum, so a restore can
prove the data came back byte-identical.

**Archives are chunked at 600 KB.** Firestore caps a document at 1 MiB; a single-document archive
failed at roughly 1,565 invoices. Do not remove the chunking.

## Things that will bite you

- **Stale React closures.** Any async handler that reads `invoice` or `dirty` from render state
  after an `await` is reading pre-save values. `BillingPage` uses `persistedRef` for exactly this
  reason. This caused a duplicate-billing bug; do not undo it.
- **WAL and VACUUM ordering.** In `clearLocalData()` the checkpoint after the VACUUM is load
  bearing. Removing it leaves wiped records readable in the `-wal` file.
- **The render window is reused deliberately.** Creating a fresh `BrowserWindow` per PDF makes
  subsequent navigations fail on some platforms, and costs window construction per bill.
- **Snapshots must never carry credentials.** `createSnapshot()` strips them unconditionally.
  Do not add a caller-controlled bypass.

## Support checklist

When the shop reports a problem, collect: the app version (About dialog), what they were doing,
the exact message, and whether the header shows Online or Offline. Then take a backup file before
changing anything. `npm run doctor` reports environment problems in plain language.

---

## Support

Built and maintained by **TridentCrew**.

| | |
| --- | --- |
| Mobile | 9096310817 |
| Email | contact@tridentcrew.com |

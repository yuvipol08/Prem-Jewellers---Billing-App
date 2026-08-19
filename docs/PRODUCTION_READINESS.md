# Production Readiness Report

**Application:** Prem Jewellers Billing v1.0.0
**Report date:** 19 August 2026
**Test environment:** Linux x64, Node 22.22.2, Electron 43.4.1, headless (Xvfb)
**Raw results:** `qa-results/summary.json` and per-suite logs, regenerated with `npm run qa`

---

## 1. Executive summary

| | |
| --- | --- |
| **Total test cases executed** | **236** |
| **Passed** | **236** |
| **Failed** | **0** |
| Defects found during this cycle | 7 |
| Defects fixed | 7 |
| Defects outstanding | 0 |
| **Production readiness status** | **NOT CERTIFIED — conditionally ready** |

The application passes every check that can be executed in this environment, including all
seven defects found and fixed during the cycle. It is **not** certified production-ready,
because a set of verifications that matter for a real shop deployment cannot be performed
here at all. Those are listed in section 6 and are the gate to sign-off.

This distinction is deliberate. Signing a certificate that says "passed all verification
checks" would be false: the software has never run on Windows, never printed on paper, and
never talked to a real Firebase project.

---

## 2. Test execution by type

| Testing type | Cases | Passed | Failed | Where |
| --- | ---: | ---: | ---: | --- |
| Unit testing (calculations, templates, numbering, messaging) | 94 | 94 | 0 | `tests/unit/` |
| Functional and integration testing (database, records, filters) | 44 | 44 | 0 | `tests/electron/core.cjs` |
| End-to-end workflow testing | included in core | — | 0 | `tests/electron/core.cjs` |
| API testing (Firebase REST, WhatsApp Cloud API) | 17 + 4 | 21 | 0 | `tests/unit/cloud-api.test.mjs`, `backup.cjs` |
| SQLite database validation | included in core | — | 0 | `tests/electron/core.cjs` |
| PDF generation and print-path validation | 15 | 15 | 0 | `tests/electron/core.cjs` |
| Backup and restore validation | 9 | 9 | 0 | `tests/electron/backup.cjs` |
| Emergency Backup & Clear validation | 7 | 7 | 0 | `tests/electron/backup.cjs` |
| Security testing | 24 | 24 | 0 | `tests/electron/security.cjs` |
| Edge-case testing | included in security | — | 0 | `tests/electron/security.cjs` |
| UI/UX validation | 24 | 24 | 0 | `tests/electron/ui.cjs` |
| Offline-first behaviour testing | 1 (+ design-level) | 1 | 0 | `tests/electron/ui.cjs` |
| Performance, stress and memory testing | 25 | 25 | 0 | `tests/electron/performance.cjs` |
| **Total** | **236** | **236** | **0** | |

Manual testing was performed as an adversarial code audit plus visual review of rendered
screenshots and PDFs. It is what surfaced defects 1–4 below; the automated suites were then
written to prove each one and prevent regression.

Cross-platform testing was performed **statically only** — see section 6.

---

## 3. Defects found and fixed

All seven were introduced by this project's own code and all were found during this cycle.

### DEF-1 · Credentials could leave the device in a snapshot — *Security, High*

`createSnapshot(false)` returned the **raw** settings object including the Firebase password
and WhatsApp access token. The parameter was named `includeSettings` but actually toggled
*sanitisation*, so the safe-looking call was the dangerous one. `cloudStatus()` used it, so an
unsanitised credential-bearing object was built every time the Settings screen opened.

**Fix:** snapshots now always strip credentials through a single `withoutCredentials()` helper,
whatever the caller passes. Regression tests assert no secret appears in a serialised snapshot
for either argument value, in either the backup suite or the security suite.

### DEF-2 · Settings screen read the entire book to show one number — *Performance, High*

`cloudStatus()` built a full snapshot — every invoice with every line item, an N+1 query
pattern — purely to count how many invoices had changed since the last backup.

**Fix:** replaced with a single `COUNT(*)` query. Measured on 5,000 invoices: **932 ms → 0 ms**.

### DEF-3 · Emergency archive broke past ~1,565 invoices — *Data safety, Critical*

The emergency backup wrote the whole archive as one Firestore document. Firestore caps a
document at 1,048,576 bytes; at ~670 bytes per invoice the upload would start failing at
roughly 1,565 bills — meaning the shop's most important safety feature would quietly stop
working exactly as their history grew. (It would have failed safe, refusing to delete, but the
feature would have been unusable.)

**Fix:** archives are now split into chunks under 600 KB with a manifest, and reassembled and
checksum-verified on read. Verified with a 1.53 MB archive of 2,500 invoices end-to-end, and a
1.43 MB payload splitting into 3 chunks with a matching checksum.

### DEF-4 · Ctrl+Enter could bill a customer twice — *Data integrity, Critical*

Save-and-print created **two invoices with two numbers for one bill**. The root cause was a
stale React closure: `ensureSaved()` read `invoice` and `dirty` from the render in which the
callback was created, so after `await save()` it still saw an unsaved invoice and saved again.

Worth noting: the first fix attempt (a concurrency guard sharing one in-flight promise) did
**not** resolve it, because the second save started only after the first had completed. The UI
test caught that the fix was incomplete, and the real cause was then found and fixed by
tracking the persisted invoice in a ref that survives across awaits.

**Fix:** `persistedRef` holds the invoice as actually stored and is invalidated on every edit;
`ensureSaved()` consults it instead of render state, and `saveAndPrint()` prints the invoice
`save()` returned directly. Regression test drives a real Ctrl+Enter through the built UI and
asserts exactly one invoice is created.

### DEF-5 · Negative amounts printed the minus inside the rupee symbol — *Display, Medium*

`formatCurrency(-0.19)` produced `₹-0.19`. This was visible in the app: the Round Off row shows
a negative on most bills.

**Fix:** the sign is now placed outside the symbol — `-₹0.19`. A UI test asserts it on a live
round-off value.

### DEF-6 · Raw SQLite error shown at the counter — *Usability, Low*

Renumbering a bill onto a number another bill already held surfaced
`UNIQUE constraint failed: invoices.invoice_no` in a toast.

**Fix:** the clash is detected first and reported as *"Invoice number X is already used by
another bill. Choose a different number."* Data integrity was never at risk — the constraint
did its job — but the message was unusable.

### DEF-7 · Wiped records were still readable in the database file — *Security, Critical*

The headline promise of Emergency Backup & Clear is that cleared records cannot be recovered
from the device. A test that grepped the raw `.db` bytes after a wipe **found the customer name
still there**.

The wipe ran `DELETE`, then `wal_checkpoint(TRUNCATE)`, then `VACUUM`. Under WAL, the VACUUM's
output lands in the write-ahead log, so checkpointing *before* the VACUUM leaves the old
content intact. I tested four candidate sequences against the raw file bytes to establish the
correct one.

**Fix:** `PRAGMA secure_delete = ON` (zeroes page content as it is freed) → deletes in one
transaction → checkpoint → `VACUUM` → **checkpoint again**. The regression test writes a
distinctive string, wipes, and asserts it is absent from the `.db`, `-wal` and `-shm` files.

---

## 4. Performance results

Measured on 5,000 invoices and 800 customers. Budgets are set for an older shop PC; this
machine is faster, so treat headroom as the meaningful figure rather than the absolute number.

| Operation | Measured | Budget |
| --- | ---: | ---: |
| Database open and migrate (cold start) | 8 ms | 500 ms |
| First invoice number ready | 1 ms | 100 ms |
| Invoice list (200 rows) | 1 ms | 150 ms |
| Text search across the whole book | 5 ms | 400 ms |
| Date-range filter | 1 ms | 200 ms |
| Customer type-ahead | 1 ms | 120 ms |
| Open a single invoice | 1 ms | 60 ms |
| Invoice numbering at scale | 0 ms | 200 ms |
| Dashboard aggregation | 1 ms | 400 ms |
| Cloud status (was 932 ms before DEF-2) | 0 ms | 150 ms |
| Save a bill | 1 ms | 300 ms |
| First PDF of the session | 183 ms | 3,000 ms |
| Warm PDF render | 54 ms | 1,500 ms |
| 25-line bill PDF | 64 ms | 3,000 ms |
| Full snapshot of the book | 932 ms | 20,000 ms |

**Memory.** Heap flat at ~7 MB across 40 rounds of mixed reads, searches, saves and dashboard
refreshes (+0.0 MB). 30 consecutive PDF renders produced **−0.2 MB** net and left exactly one
reusable render window open — no window or memory leak.

**Storage.** 2.1 MB for 5,091 invoices (0.42 KB per invoice). A shop billing 50 invoices a day
would reach roughly 8 MB per year.

---

## 5. Security assessment

| Area | Result |
| --- | --- |
| SQL injection | 5 payload classes across customer fields, invoice fields and both search paths — all stored as literal text, no statement executed. All queries are parameterised. |
| LIKE wildcard injection | A shop-chosen invoice prefix containing `_` or `%` is escaped before reaching `LIKE`, so it cannot scan the wrong number series. |
| HTML / PDF injection | Hostile markup in every printed field, and in shop settings, is escaped to inert text. No live tag is ever rendered. |
| External resources in printed documents | None — no script, link, or remote URL. Documents are fully self-contained. |
| Electron isolation | `nodeIntegration: false`, `contextIsolation: true` on the main window; the PDF render window additionally sets `javascript: false` and `sandbox: true`. `window.require` and `window.process` confirmed unreachable from the renderer. |
| Content Security Policy | `default-src 'self'`, no `unsafe-eval`. |
| IPC surface | Fixed, typed bridge; only the `menu-action` channel can be subscribed to. |
| Navigation | New windows denied and pushed to the OS browser; in-app navigation restricted. |
| Credential handling | Never written to a backup file, never uploaded in a snapshot, never printed on an invoice, never hardcoded in source. |
| Secure deletion | Verified at the raw-file level after DEF-7 (see above). |

Not assessed: encryption at rest of the local database (it is unencrypted — see limitations),
Firestore security rules on the customer's own project, and OS-level access control.

---

## 6. What could NOT be verified here

These are the gate to production sign-off. None can be executed from this Linux container.

| # | Item | Why it matters | Blocker |
| --- | --- | --- | --- |
| U1 | **Running on Windows** | The target platform. Never executed there. | No Windows machine |
| U2 | **Running on macOS** | Second target platform. | No Mac |
| U3 | **Physical printing on A4** | Real printers differ from Chromium's PDF engine in margins and scaling. Column alignment is the whole point of the layout. | No printer |
| U4 | **Installer install / uninstall / reinstall** | Data must survive a reinstall. Never tested. | Windows NSIS stub needs 32-bit wine, unavailable here |
| U5 | **Live Firebase project** | All cloud tests run against a scripted stub of the REST contract. Real auth, quotas, security rules and latency are untested. | No Firebase account |
| U6 | **Live WhatsApp Cloud API** | Same — the contract is tested against a stub, not Meta's servers. | No Meta Business account |
| U7 | **Invoice layout vs the actual bill book** | The template is a standard Indian jewellery GST invoice with the specified columns. It has never been compared to Prem Jewellers' real bill book. | Reference image never supplied |
| U8 | **Real-hardware performance** | All timings are from this machine, not the shop's PC. | No access |
| U9 | **Power-cut durability** | WAL should protect against this, but it was not tested by actually cutting power. | Not reproducible here |

**What was verified about packaging:** the complete Windows application directory builds
successfully (`release/win-unpacked/Prem Jewellers Billing.exe`) with the correct
`win32-x64.node` unpacked from the asar, and the packaged Linux build boots and creates its
database. Only the final NSIS installer assembly is unverified.

---

## 7. Known limitations

These are deliberate design decisions or accepted constraints, not defects.

1. **The local database is not encrypted.** Anyone with file access to the shop PC can read
   `prem-jewellers.db` with any SQLite tool. The Emergency wipe is the mitigation; full
   encryption at rest would need SQLCipher and is not in this build.
2. **The Firebase password is stored in the settings table in plain text**, because the app must
   sign in unattended. It is never exported, printed or backed up, but it is readable on disk by
   anyone with file access.
3. **Bills of ten or more lines flow onto a second page.** Up to nine lines fit one A4 sheet.
   This is correct behaviour, but the shop should know.
4. **Only today's invoices can be edited.** Older bills are cancelled and re-billed by design,
   to keep the books consistent with what was printed.
5. **Cloud backup is on demand, not automatic.** There is no background sync scheduler.
6. **Emergency wipe uploads records one document at a time.** For a very large book this takes
   time proportional to the number of records. It fails safe, but it is not fast.
7. **No multi-user or multi-counter support.** The app refuses to open twice, and two machines
   sharing one database file is not supported.
8. **No auto-update.** Fixes require reinstalling.
9. **App icon is the Electron default.** Cosmetic, but visible in the installer and taskbar.

---

## 8. Readiness status

**NOT CERTIFIED — conditionally ready for deployment testing.**

Everything within reach of automated verification passes, and the code is in good shape: 236
checks green, seven real defects found and fixed, including two that would have hurt the shop
(duplicate billing on the primary keyboard shortcut, and an emergency wipe that did not
actually make records unrecoverable).

Sign-off requires closing U1–U9, and at minimum:

- [ ] U1 — the app runs correctly on the shop's Windows PC
- [ ] U3 — a real bill prints correctly on A4 and matches the bill book
- [ ] U4 — installer install / uninstall / reinstall verified, data survives
- [ ] U5 — a real Firebase project passes **Test Connection**, and a full backup → clear →
      restore drill succeeds on test data
- [ ] U7 — the invoice layout is confirmed against the actual bill book by the owner

Re-run `npm run qa` on the Windows machine before sign-off; the whole suite runs there
unchanged. A production readiness certificate should be issued only once those boxes are
ticked, and it should name who verified each one.

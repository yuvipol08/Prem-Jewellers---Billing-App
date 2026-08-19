# Backup & Restore Guide

Everything about protecting Prem Jewellers' records. Read this before using the Emergency button.

## Where the records are

One file on the billing computer:

```
Windows   %APPDATA%\Prem Jewellers Billing\prem-jewellers.db
macOS     ~/Library/Application Support/Prem Jewellers Billing/prem-jewellers.db
```

You will also see `-wal` and `-shm` files beside it. That is normal write-ahead logging; they are
folded back into the main file when the app closes cleanly. Copy all three, or better, use
**Save Backup File**.

> The database is **not encrypted**. Anyone with access to the computer's files can read it with
> a free SQLite tool. This is why the Emergency wipe exists, and why the machine should have a
> Windows password.

## The three kinds of backup

| Kind | What it does | When |
| --- | --- | --- |
| **Offline backup file** | Writes one JSON file with every bill, customer and setting, plus a checksum | Daily |
| **Cloud backup** | Uploads everything to the shop's own Firebase account | Weekly, or after a big day |
| **Emergency Backup & Clear** | Uploads, verifies, then erases the device | Only in an emergency |

Credentials are **never** included in any backup — the Firebase password and WhatsApp token are
stripped out before anything is written or uploaded.

## Daily: offline backup

1. **Backup & Settings** (`Ctrl+5`) → **Offline Backup**
2. **Save Backup File**
3. Save onto a pen drive. Keep the pen drive away from the shop.

To automate it: set **Automatic Backup Folder** to the pen drive or a synced folder (Google
Drive, OneDrive), and set **On Closing the App** to write a backup. A file is then written every
time the software closes.

Keep at least a week of files. They are small.

## Restoring from a file

1. **Offline Backup** → **Restore From File**
2. Choose the backup file.

The file's checksum is verified first; a damaged or edited file is refused rather than
half-imported. Restoring is safe to repeat — bills are matched by invoice number and customers by
mobile number, so importing the same backup twice does not double the books.

## Setting up cloud backup

One-time setup, needs a Google account.

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. **Build → Firestore Database → Create database**
3. **Build → Authentication → Sign-in method → Email/Password → Enable**
4. **Authentication → Users → Add user** — create one account for the shop
5. **Project Settings → General** — copy the **Project ID** and **Web API Key**
6. In the app: **Backup & Settings → Cloud Backup**, enter all of it, set **Cloud Backup: On**,
   click **Save Settings**
7. Click **Test Connection**

**Test Connection** writes a probe document, reads it back, and compares checksums. It must
report success before you rely on any of this.

### Using it

- **Back Up Now** — uploads every bill and customer, plus a manifest.
- **Restore From Cloud** — brings everything back onto this or any other machine.

The **Namespace** field lets several shops share one Firebase project, and is also how you keep a
test run separate from real data.

## Emergency Backup & Clear Device

**This permanently erases all bills and customers from the computer.** Use it only if the machine
may be seen by someone who should not see the records.

### What it does, in order

1. Uploads every bill and customer to the cloud account, plus one complete archive (split into
   chunks so size is never a limit).
2. Reads the archive back, reassembles it, and compares SHA-256 checksums.
3. **Only if that verification passes**, erases everything from the computer.

If the upload fails, or the verification fails, **nothing is deleted** and you are told why.

### How the erase works

It is a real erase, not a hide. The app turns on SQLite's `secure_delete` so freed pages are
zeroed rather than just unlinked, deletes everything in one transaction, checkpoints the
write-ahead log, rebuilds the database with `VACUUM`, and checkpoints again. This sequence was
verified by inspecting the raw database bytes afterwards — the records are genuinely gone from
the `.db`, `-wal` and `-shm` files.

Shop settings survive, so the software works normally straight afterwards.

### Rehearse it before you ever need it

Do this once, on test data, before the shop relies on it.

1. Save an offline backup file.
2. Copy `prem-jewellers.db` to the Desktop as a second safety net.
3. Set **Namespace** to `test-run` so nothing mixes with real data.
4. **Test Connection** — must pass.
5. **Back Up Now** — then check the Firebase console shows `test-run__invoices` with your bills.
6. **Emergency Backup & Clear Device** → type `BACKUP AND CLEAR` → confirm.
7. Confirm the app is empty but Settings survived.
8. **Restore From Cloud** — everything comes back.
9. Set the namespace back.

### There is no undo

Once cleared, the cloud copy is the only copy. Never press this button unless **Test Connection**
and a full restore drill have both succeeded.

## Recovering after a disaster

**The computer died, you have a backup file:** install the software on the new machine, complete
the shop settings, then **Restore From File**.

**The computer died, you have cloud backup:** install, enter the same Firebase details, then
**Restore From Cloud**.

**You have neither:** the records are gone. This is why the daily routine matters.

## Backup routine at a glance

| When | Do this |
| --- | --- |
| Every day, at closing | Save Backup File to the pen drive (or let it happen automatically) |
| Every week | Back Up Now to the cloud |
| Every month | Test a restore onto a spare machine — a backup you have never restored is not a backup |
| Before any software update | Save a backup file |

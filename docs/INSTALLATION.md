# Installation Guide

For the person installing the software at Prem Jewellers.

## Before you start

| Requirement | Detail |
| --- | --- |
| Operating system | Windows 10 or 11, 64-bit (or macOS 11+) |
| Disk space | 400 MB for the application, plus about 8 MB per year of billing |
| Printer | Any A4 printer, connected and working |
| Internet | Not required for billing. Needed only for cloud backup and WhatsApp |

Nothing else needs installing — no .NET, no Java, no database server.

## Installing on Windows

1. Copy `Prem Jewellers Billing-1.0.0-Setup.exe` to the computer.
2. Double-click it.
3. Windows may show **"Windows protected your PC"**. This appears for any installer that has not
   been code-signed. Click **More info**, then **Run anyway**.
4. Choose the install folder, or accept the default.
5. Tick **Create desktop shortcut**.
6. Click **Install**, then **Finish**.

The software opens straight onto the Billing screen.

### Portable version

`Prem Jewellers Billing-1.0.0-Portable.exe` runs without installing — useful on a pen drive or a
locked-down machine. Note that the portable build still stores its data in the user's AppData
folder on whichever machine it runs on, not on the pen drive.

## Installing on macOS

1. Open the `.dmg` and drag the app into Applications.
2. The first time, **right-click the app and choose Open** (not double-click), then confirm.
   macOS blocks unsigned apps on a normal double-click.

## First-run setup

Do this once, with the owner present. Go to **Backup & Settings** (`Ctrl+5`).

### Shop Details — appears on every printed bill

Fill in every field: shop name, tagline, full address, city, state, PIN code, phone, email,
**GSTIN**, **PAN**, and the bank and UPI details if they want them printed.

> A wrong GSTIN makes every invoice non-compliant. Check it character by character against the
> registration certificate.

### Invoice & Printing

| Setting | Guidance |
| --- | --- |
| Invoice prefix | Usually `PJ`. Appears as `PJ/25-26/0001`. |
| **Start number** | **Set this to continue from the last paper bill.** If the bill book ended at 147, set 148. This is easy now and painful later. |
| Numbering | Restart each financial year (usual), or continuous. |
| Default GST rate | 3% for gold and silver jewellery. Confirm with their accountant. |
| Default HSN | 7113 for jewellery. |
| Default making charge | Whichever the shop quotes most often: flat, per gram, or percent. |
| Terms, declaration, signature label | Copy the wording from the existing bill book. |

Click **Save Settings**.

### Test the print

Make a test bill and print it. Check paper is **A4**, orientation **Portrait**, scale **100%** —
not "Fit to page". Hold the printed sheet against a page from the bill book and check the columns
line up. Adjust the settings above until the owner is happy, then cancel the test bill.

### Set up backup

At minimum, set the **Automatic Backup Folder** to a pen drive or synced folder and turn on
**On Closing the App**. See the Backup & Restore Guide for the full routine, including cloud.

## Where the data lives

```
Windows   %APPDATA%\Prem Jewellers Billing\prem-jewellers.db
macOS     ~/Library/Application Support/Prem Jewellers Billing/prem-jewellers.db
```

The exact path is shown in **Settings → Offline Backup**. Never move or delete this file. To copy
it, use **Save Backup File** instead.

## Uninstalling

Windows: **Settings → Apps → Prem Jewellers Billing → Uninstall**.

Uninstalling **does not delete the bills** — the data folder above is left in place, so
reinstalling brings everything back. To remove the records too, delete that folder by hand,
after taking a backup.

## Upgrading

Run the new installer over the top. Bills, customers and settings are kept. Take a backup first
anyway.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| SmartScreen warning | Expected without a code-signing certificate. **More info → Run anyway.** |
| Antivirus quarantines the installer | Add an exclusion, or sign the build. |
| App will not start | Restart the PC. If it still fails, run the executable from a terminal to see the error. Do not reinstall — the data is safe either way, but reinstalling will not fix a startup fault. |
| Printer not listed | Fix it in Windows first; the app uses the standard Windows print dialog. |
| Wrong date format | The app requests the `en-IN` locale, giving dd/mm/yyyy. If Windows is set to a different region the picker may still differ; this is cosmetic and does not affect stored dates. |

# Deployment & Handoff — Prem Jewellers Billing

Everything needed to run the app on Windows, finish the remaining work, build the
installer, and hand the software to the shop.

- [1. Running on Windows right now](#1-running-on-windows-right-now)
- [2. Remaining work before production](#2-remaining-work-before-production)
- [3. Timeline and delivery estimate](#3-timeline-and-delivery-estimate)
- [4. Build commands](#4-build-commands)
- [5. Client delivery checklist](#5-client-delivery-checklist)

---

## 1. Running on Windows right now

### 1.1 Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Windows | 10 or 11, 64-bit | The app targets x64. |
| **Node.js** | **22 LTS or newer** | Hard requirement — `better-sqlite3@13` declares `engines: node >= 22`. Get the **LTS** installer from [nodejs.org](https://nodejs.org). Tick *"Add to PATH"*. |
| Git for Windows | any | Optional — you can download the repo as a ZIP instead. |

**You do not need Visual Studio Build Tools, Python, or windows-build-tools.**

This is worth stating plainly because almost every Electron + SQLite guide tells you
otherwise. `better-sqlite3@13` ships **pre-compiled N-API binaries for every platform**
inside its npm package (`node_modules/better-sqlite3/prebuilds/win32-x64.node`). N-API
binaries are ABI-stable across Node *and* Electron versions, so nothing is ever compiled
on your machine. The project sets `npmRebuild: false` in `electron-builder.yml` for the
same reason — forcing a rebuild would add a toolchain dependency for no benefit.

> During the build I confirmed this: with the rebuild disabled, the complete Windows
> application directory packages successfully, including the correct `win32-x64.node`.

### 1.2 Get the project

Open **PowerShell** (not Command Prompt) and run:

```powershell
git clone https://github.com/yuvipol08/Prem-Jewellers---Billing-App.git
cd Prem-Jewellers---Billing-App
```

No Git? Download the ZIP from GitHub, extract it, then `cd` into the folder.

Verify your Node version before going further:

```powershell
node --version    # must print v22.x.x or higher
npm --version
```

### 1.3 Install and run

```powershell
npm install
npm run dev
```

`npm install` takes 1–3 minutes. `npm run dev` starts three things together — the Vite
dev server, the TypeScript compiler in watch mode, and Electron — and the app window
opens by itself after a few seconds. Edits to the UI reload instantly.

**Stop it** with `Ctrl + C` in the terminal.

To run the app the way the shop will actually experience it (compiled, no dev server):

```powershell
npm start
```

> There is no `npm run electron`. The scripts are `dev` (development) and `start`
> (production-style run). `npm run` on its own lists them all.

### 1.4 Test the invoice PDF

1. Open the app — it lands on **Billing** with an invoice number already generated.
2. Type a customer name (e.g. `Test Customer`) and a mobile number.
3. On the first item line enter: Particulars `Gold Chain 22K`, Gross Wt `10`, Net Wt
   `9.5`, Rate `6200`, Making `500` with the `/g` mode selected.
4. Check the **Bill Summary** on the right updates live — taxable value, CGST, SGST,
   round-off, grand total, and the amount in words.
5. Press **`Ctrl + Shift + P`** for Print Preview. This is the exact page that will print.
6. Press **`Ctrl + E`** (or *Save PDF*) and choose a location. The PDF opens in your file
   manager with the file highlighted.

**What to check in the PDF:** it is a single A4 page; the weight columns line up to three
decimals; GST is split CGST + SGST; the round-off and grand total are correct; the amount
in words is right; the signature block is at the bottom of the page.

### 1.5 Test printing

Start with a **safe dry run** — no paper, no ink:

1. Press **`Ctrl + P`**.
2. In the Windows print dialog choose **`Microsoft Print to PDF`**.
3. Settings: **A4**, **Portrait**, scale **100%** (not "Fit to page"), margins **Default**
   or **None**.
4. Save and open the result. It should be identical to the preview.

Then repeat with the real printer, on plain paper first:

- Load A4. The layout reserves its own margins, so leave the printer scaling at 100% —
  "shrink to fit" will misalign the weight columns.
- Print one bill. Hold it against a page from the existing bill book and compare the
  column positions and the signature area.
- Try **Reprint** from the *Invoices* tab. It should come out banded **Duplicate Copy**.

### 1.6 Test SQLite persistence

The database lives at:

```
%APPDATA%\Prem Jewellers Billing\prem-jewellers.db
```

Paste that into File Explorer's address bar to open the folder. *Settings → Offline
Backup* also shows the exact path.

> The development run and the installed app now use the **same** folder, so bills you
> create while testing are the bills the installed app will show.

**The test:**

1. Save two or three bills (`Ctrl + S` on each).
2. Close the app completely — the window, and `Ctrl + C` in the terminal if using `npm run dev`.
3. Confirm `prem-jewellers.db` exists and is non-zero in the folder above.
4. Reopen the app. Go to **Invoices** — all bills are listed.
5. Go to **Customers** — the customers were saved automatically from the bills.
6. Go to **Dashboard** — today's sales total matches.
7. Now **turn off Wi-Fi / unplug the network** and create another bill. It saves and
   prints normally; the header badge reads *"Offline — billing continues"*.

You will also see `prem-jewellers.db-wal` and `-shm` files. That is normal (write-ahead
logging). They are folded back into the main file when the app closes cleanly.

### 1.7 Test Emergency Backup & Clear safely

**This feature permanently erases local records.** Test it deliberately, in this order.
Do not test it on real shop data until you have done a full rehearsal.

**Before you touch the button:**

1. *Settings → Offline Backup → Save Backup File* — write a JSON backup somewhere safe.
2. Manually copy `prem-jewellers.db` to your Desktop as a second safety net.
3. In *Settings → Cloud Backup*, set **Namespace** to something like `test-run` so the
   rehearsal never mixes with real shop data. (Change it back afterwards.)

**Set up Firebase** (needed — the button stays disabled without it):

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Build → Firestore Database → Create database.**
3. **Build → Authentication → Sign-in method → Email/Password → Enable.**
4. **Authentication → Users → Add user** — create one account for the shop.
5. **Project Settings → General** — copy the **Project ID** and the **Web API Key**.
6. Enter all of it in *Settings → Cloud Backup*, set it to **On**, and press **Save Settings**.

**Rehearse:**

1. Press **Test Connection**. It writes a probe document, reads it back, and compares
   checksums. It must say complete before you go on.
2. Press **Back Up Now**. Open the Firebase console → Firestore and confirm you can see
   `test-run__invoices` and `test-run__customers` collections with your bills in them.
3. Now press **Emergency Backup & Clear Device** and type `BACKUP AND CLEAR`.
4. It uploads everything, reads the archive back, compares SHA-256 checksums, and only
   then erases. You should see a message naming how many invoices and customers are safe.
5. Confirm the app is now empty: *Invoices* and *Customers* show nothing, the *Dashboard*
   reads zero — but your shop details in *Settings* survived.
6. Press **Restore From Cloud**. Everything comes back.
7. Set the namespace back to your real one.

**Safety properties worth knowing:** if the upload or the verification fails, nothing is
deleted and you are told why. The wipe checkpoints the write-ahead log and runs `VACUUM`,
so cleared rows are not recoverable from free pages of the database file — that is the
point of the feature, but it also means there is no undo except the cloud copy.

---

## 2. Remaining work before production

### Critical — must be done before the shop uses this

| # | Item | Why | Who |
| --- | --- | --- | --- |
| C1 | **Build and test the NSIS installer on Windows** | Never built on real Windows. Install, launch, create a bill, uninstall, reinstall — confirm data survives. | You |
| C2 | **Application icon** (`build/icon.ico` 256×256, `build/icon.icns`) | The app currently ships with the default Electron icon. Looks unfinished on the taskbar and in the installer. | You (logo) |
| C3 | **Confirm the invoice layout against the real bill book** | The template is a standard Indian jewellery GST invoice with the columns you specified. It has never been compared to your actual bill book. Send a photo/scan and the column widths and ordering can be matched exactly. | You → me |
| C4 | **Real printer test on A4** | Only ever rendered through Chromium's PDF engine. Physical printers differ in margins and scaling. | You |
| C5 | **Enter the real shop details** in Settings | GSTIN, PAN, full address, phone, bank/UPI, terms. These print on every bill — wrong GSTIN makes the invoice non-compliant. | Shop |
| C6 | **Create the Firebase project and verify Test Connection** | Cloud backup and the Emergency button do nothing without it. | You |
| C7 | **Run a restore drill** | Back up, wipe a test copy, restore, confirm the books match. A backup you have never restored is not a backup. | You |
| C8 | **Test on the actual shop PC** | Older hardware, its printer, its screen resolution, its antivirus. | You |

### Recommended — should be done

| # | Item | Notes |
| --- | --- | --- |
| R1 | **Code signing certificate** | Without one, Windows SmartScreen shows *"Windows protected your PC"* on first run and the shop has to click through *More info → Run anyway*. An OV certificate is roughly ₹15,000–35,000/year. Worth it for a client handover; skippable if you will install it yourself. |
| R2 | **macOS DMG build** | Only if the shop actually uses a Mac. Must be built on a Mac. Unsigned Mac apps need right-click → Open the first time. |
| R3 | **WhatsApp Cloud API setup** | Without it, sharing still works — WhatsApp opens on the customer's chat with the message written and the PDF highlighted to attach. With it, the PDF sends automatically. Needs a Meta Business account and a verified number. |
| R4 | **Test on Windows 10 and Windows 11** | Print dialogs and file pickers differ. |
| R5 | **Performance check with a realistic dataset** | Load ~5,000 invoices and confirm the Invoices tab and Dashboard stay instant. |
| R6 | **User manual in the shop's language** | One or two pages with screenshots: raise a bill, reprint, back up. Marathi or Hindi as appropriate. |
| R7 | **Decide the daily backup routine** | Set the automatic backup folder to a pen drive or a synced folder, and turn on *backup on exit*. |
| R8 | **Auto-update** | `electron-updater` plus a publish target, so fixes reach the shop without a manual reinstall. |

### Optional — future improvements

| # | Item |
| --- | --- |
| O1 | Old-gold exchange lines on the bill (deduct returned metal) |
| O2 | GSTR-1 export (CSV/JSON) for the accountant |
| O3 | Daily / monthly sales report printout |
| O4 | Stock and inventory tracking |
| O5 | Advance booking and part-payment tracking |
| O6 | QR code on the invoice for UPI payment |
| O7 | Multi-counter / multi-user with a shared database |
| O8 | Scheduled automatic cloud sync rather than on-demand |
| O9 | Estimate / quotation documents alongside tax invoices |

---

## 3. Timeline and delivery estimate

### Where the project stands

| Area | Status |
| --- | --- |
| Application code | **~95%** — all five screens, billing, GST, PDF, printing, WhatsApp, backup, emergency wipe |
| Automated testing | **~90%** — 33 unit tests, 18 end-to-end checks in real Electron, 15 UI checks |
| Packaging configuration | **~90%** — verified to produce a complete Windows app directory |
| Real-world validation | **~15%** — never run on Windows, never printed on paper, installer never tested |
| Client setup (Firebase, shop details, manual) | **~0%** |

**Overall: roughly 75% of the way to a client handover.**

The code is close to finished. Almost everything left is validation on real hardware and
account setup — work that cannot be done from here, and that depends partly on you.

### Remaining effort

| Phase | Effort | Depends on |
| --- | --- | --- |
| Development — icon, invoice layout adjustments after seeing your bill book, any fixes from Windows testing | **1–2 days** | You sending the bill book photo |
| Setup — Firebase project, shop details, WhatsApp (optional) | **half a day** | Your Firebase/Meta accounts |
| Testing — Windows install/uninstall, real printing, persistence, backup and restore drill, performance | **2–3 days** | Access to the shop PC and printer |
| Documentation — user manual and backup guide | **half a day** | — |
| Code signing, if you choose to | **+2–5 days elapsed** | Certificate authority verification |

### When you can hand over the installer

- **Unsigned installer, ready to test yourself: 1–2 days** from when you start on Windows
  and send the bill book image.
- **Tested installer ready for the shop: 4–6 working days.**
- **Signed installer (no SmartScreen warning): add 2–5 days** for certificate issuance.

These assume part-time work and reasonably quick turnaround on the bill book image and
the Firebase account. The single biggest schedule risk is the invoice layout — if your
bill book differs substantially from the standard format, allow an extra day.

### What Prem Jewellers receives

1. **`Prem Jewellers Billing-1.0.0-Setup.exe`** — the Windows installer (choose install
   folder, desktop and Start Menu shortcuts).
2. **`Prem Jewellers Billing-1.0.0-Portable.exe`** — optional, runs from a pen drive
   without installing.
3. **User manual** — raising a bill, reprinting, customers, daily backup, in their language.
4. **Backup & recovery guide** — where the data lives, how to back up, how to restore, and
   what the Emergency button does and does not do.
5. **Firebase account details** — handed over securely, separately from the software.
6. **Source code** — this repository, if the engagement includes it.
7. **A signed handover note** — version number, install date, and what support covers.

---

## 4. Build commands

Run all of these from the project folder in PowerShell.

### Development

```powershell
npm install                 # once, after cloning or pulling changes
npm run dev                 # Vite + TypeScript watch + Electron, hot reload
```

### Production build (compile only, no installer)

```powershell
npm run build               # compiles main process + renderer into dist/ and dist-electron/
npm start                   # build, then run the compiled app
```

### Verification

```powershell
npm run typecheck           # both TypeScript projects
npm test                    # 33 unit tests: calculations + invoice template
npm run test:e2e            # database, numbering, PDF, wipe — inside real Electron
npm run test:ui             # boots the built UI, asserts it renders, saves screenshots
npm run verify              # all of the above
```

### Windows installer

```powershell
npm run dist:win            # NSIS installer + portable exe -> release\
```

Output in `release\`:

- `Prem Jewellers Billing-1.0.0-Setup.exe` — the installer
- `Prem Jewellers Billing-1.0.0-Portable.exe` — single-file portable build
- `win-unpacked\` — the raw application folder, useful for debugging

### Portable only

```powershell
npm run dist:win:portable
```

### macOS DMG

```bash
npm run dist:mac            # must be run on a Mac; produces Intel + Apple Silicon DMGs
```

### Troubleshooting

**`npm install` fails, or `better-sqlite3` errors**

The overwhelmingly likely cause is the Node version. Check `node --version` — it must be
**22 or higher**. If it is, do a clean reinstall:

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
```

If you see node-gyp, `MSBuild.exe`, or Python errors, something is trying to compile the
module from source, which this project does not need. Confirm `npmRebuild: false` is still
present in `electron-builder.yml` and that there is no `postinstall` script in
`package.json`. Then verify the prebuilt binary is present:

```powershell
dir node_modules\better-sqlite3\prebuilds\win32-x64.node
```

If that file exists, the module is ready and nothing needs building.

**`electron-builder` fails downloading Electron or NSIS**

It fetches Electron and the NSIS toolchain on first run. Behind a corporate proxy or
firewall, point it at a mirror or set the proxy:

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:HTTPS_PROXY="http://your-proxy:port"
npm run dist:win
```

The download cache is at `%LOCALAPPDATA%\electron-builder\Cache`. Deleting it forces a
clean re-download if a partial file is corrupted.

**Packaged app starts then immediately closes, or says it cannot find a module**

Almost always the native module not being unpacked from the asar archive. Confirm
`electron-builder.yml` still contains:

```yaml
asarUnpack:
  - '**/node_modules/better-sqlite3/**'
```

Then check the built output has `release\win-unpacked\resources\app.asar.unpacked\
node_modules\better-sqlite3\prebuilds\win32-x64.node`. To see the real error, run the
unpacked executable from a terminal — `.\release\win-unpacked\"Prem Jewellers Billing.exe"` —
so the console output stays visible.

**Windows SmartScreen: "Windows protected your PC"**

Expected for an unsigned installer. Click **More info → Run anyway**. The permanent fix is
a code signing certificate (item R1).

**Antivirus quarantines the installer**

Common with unsigned NSIS installers. Add an exclusion, or sign the build.

**`npm run dev` fails with a port error**

Port 5273 is taken. Find and stop the process, or change `server.port` in
`vite.config.mts` and the matching `wait-on tcp:5273` in the `dev:electron` script.

**Building the Windows installer on Linux or macOS**

It works but needs `wine` with 32-bit support for the final NSIS step. Building on Windows
avoids the problem entirely and is what I recommend.

---

## 5. Client delivery checklist

Print this and tick it off at the shop.

### Installer

- [ ] `Setup.exe` installs on a clean Windows 10 machine
- [ ] `Setup.exe` installs on a clean Windows 11 machine
- [ ] Installer lets you choose the install folder
- [ ] Desktop shortcut created and works
- [ ] Start Menu entry created and works
- [ ] Correct app icon on the taskbar, desktop and in Add/Remove Programs
- [ ] App appears in **Settings → Apps** with the right name and version
- [ ] Uninstall removes the program **and leaves the data folder intact**
- [ ] Reinstalling over an existing install keeps all bills and customers
- [ ] Portable `.exe` runs from a pen drive (if you are shipping it)

### First run and setup

- [ ] App opens in under 5 seconds on the shop PC
- [ ] Opens directly on the Billing screen
- [ ] Shop name, address, GSTIN, PAN, phone all entered and correct
- [ ] Bank / UPI details entered
- [ ] Terms and declaration text matches what the shop wants printed
- [ ] Invoice prefix and starting number agreed with the owner
- [ ] **Starting number set so it continues from the last paper bill, not from 1**
- [ ] Default GST rate (3%) and HSN (7113) confirmed with their accountant

### Billing

- [ ] A bill can be raised end to end using only the keyboard
- [ ] Invoice number increments correctly across restarts
- [ ] Customer search finds people by name, mobile and GSTIN
- [ ] A returning customer's details fill in automatically
- [ ] All three making-charge modes calculate correctly (flat, per gram, %)
- [ ] Discount reduces the taxable value and the GST correctly
- [ ] Local customer gets CGST + SGST; out-of-state gets IGST
- [ ] Round-off and grand total verified against a manual calculation
- [ ] Amount in words is correct for a large value (over a lakh)
- [ ] **Totals cross-checked against three real past bills from the bill book**

### Printing

- [ ] Prints on A4 at 100% scale with correct margins
- [ ] Layout matches the existing bill book to the owner's satisfaction
- [ ] Weight columns align; nothing is clipped
- [ ] Signature block and declaration print in the right place
- [ ] GST section is correct and complete
- [ ] Reprint from Invoices is banded *Duplicate Copy*
- [ ] Print preview matches the printed result exactly
- [ ] PDF export opens correctly in Adobe Reader and on a phone

### Data and persistence

- [ ] Bills survive closing and reopening the app
- [ ] Bills survive a full PC restart
- [ ] Bills survive a power cut during use (test it — pull the plug once)
- [ ] Customers are saved automatically from bills
- [ ] Purchase history shows correctly for a repeat customer
- [ ] Search and date filters return the right invoices
- [ ] Dashboard totals match a manual count for the day
- [ ] A cancelled invoice stops counting as a sale but stays in the records
- [ ] **Billing works with the internet disconnected**

### Backup and recovery

- [ ] Offline backup file saves successfully
- [ ] Backup folder configured (pen drive or synced folder)
- [ ] *Backup on exit* enabled if the shop wants it
- [ ] Restoring a backup file works and does not duplicate records
- [ ] Firebase **Test Connection** passes
- [ ] **Cloud Backup Now** completes and the data is visible in the Firebase console
- [ ] **Restore From Cloud** brings everything back onto a clean machine
- [ ] Emergency Backup & Clear rehearsed on **test** data — upload verified, device
      cleared, restore successful
- [ ] Owner understands the Emergency button deletes local data permanently
- [ ] Firebase credentials handed over securely and written down somewhere safe

### Performance

- [ ] App starts quickly on the shop's oldest PC
- [ ] Typing in the item grid has no lag
- [ ] Invoices list scrolls smoothly with a few thousand records
- [ ] PDF generates in under 2 seconds
- [ ] Memory use stays reasonable after an hour of billing

### WhatsApp

- [ ] Sharing produces a PDF every time
- [ ] WhatsApp opens on the correct customer chat
- [ ] Indian mobile numbers are handled correctly (with and without +91, with leading 0)
- [ ] Cloud API sends automatically, if configured

### Handover

- [ ] Owner and counter staff trained on raising a bill
- [ ] Staff trained on reprinting and finding an old bill
- [ ] Staff trained on the daily backup routine
- [ ] User manual delivered in their language
- [ ] Backup & recovery guide delivered
- [ ] Keyboard shortcut sheet printed and stuck near the counter
- [ ] Support contact and response expectations agreed in writing
- [ ] Version number and install date recorded
- [ ] Source code and repository access handed over, if in scope

---

## Support

Built and maintained by **TridentCrew**.

| | |
| --- | --- |
| Mobile | 9096310817 |
| Email | contact@tridentcrew.com |

/**
 * Renders the HTML documents in docs/ into print-ready A4 PDFs, using the same
 * Chromium print engine the invoices go through.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const docs = [['docs/user-manual.html', 'docs/Prem-Jewellers-Billing-User-Manual.pdf']];

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false, width: 794, height: 1123,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true },
  });

  for (const [source, target] of docs) {
    await window.loadFile(path.join(root, source));
    await new Promise((r) => setTimeout(r, 400));
    const pdf = await window.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    fs.writeFileSync(path.join(root, target), pdf);
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    console.log(`${target} — ${pages} pages, ${(pdf.length / 1024).toFixed(0)}KB`);
  }

  window.destroy();
  app.exit(0);
});

/** Renders the printed invoice at A4 size and saves a PNG, to eyeball the layout. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'pj-render-')));
const outDir = process.env.PJ_SHOT_DIR || os.tmpdir();

app.whenReady().then(async () => {
  const { computeInvoice } = require('../dist-electron/shared/calc.js');
  const { renderInvoiceHtml } = require('../dist-electron/shared/invoiceTemplate.js');
  const { DEFAULT_SHOP } = require('../dist-electron/shared/defaults.js');

  const shop = {
    ...DEFAULT_SHOP,
    addressLine1: '123, Sarafa Bazar, Main Road',
    phone: '0257-2223344, 98765 43210',
    email: 'premjewellers.jalgaon@gmail.com',
    gstin: '27AAAPJ1234A1Z5',
    pan: 'AAAPJ1234A',
    bankName: 'Bank of Maharashtra, Jalgaon',
    bankAccount: '60123456789',
    bankIfsc: 'MAHB0000123',
    upiId: 'premjewellers@okaxis',
  };

  const invoice = computeInvoice({
    invoiceNo: 'PJ/25-26/0148', invoiceDate: '2025-11-14', customerId: 1,
    customerName: 'Ramesh Dattatray Patil',
    customerMobile: '98765 43210',
    customerAddress: 'Plot 42, Ring Road, Jalgaon 425001',
    customerPan: 'ABCDE1234F', customerGstin: '27ABCDE1234F1Z5',
    customerStateCode: '27', intraState: true,
    items: [
      { hsnCode: '7113', particulars: 'Gold Necklace 22K (Antique)', grossWeight: 25.5,
        netWeight: 24.125, rate: 6200, makingChargeMode: 'per_gram', makingChargeValue: 450, gstRate: 3 },
      { hsnCode: '7113', particulars: 'Gold Bangles 22K — Pair', grossWeight: 32.4,
        netWeight: 31.8, rate: 6200, makingChargeMode: 'percent', makingChargeValue: 12, gstRate: 3 },
      { hsnCode: '7106', particulars: 'Silver Payal 925', grossWeight: 84.2,
        netWeight: 84.2, rate: 92, makingChargeMode: 'flat', makingChargeValue: 1200, gstRate: 3 },
    ],
    discount: 2500, paymentMode: 'Online', paymentReference: 'UPI 4471829930',
    amountPaid: 200000, notes: '', status: 'saved',
  });

  const html = renderInvoiceHtml(invoice, shop, {});
  const htmlPath = path.join(outDir, 'invoice-preview.html');
  fs.writeFileSync(htmlPath, html);

  const window = new BrowserWindow({
    show: false, width: 812, height: 1160,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true },
  });
  await window.loadFile(htmlPath);
  await new Promise((r) => setTimeout(r, 400));

  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, '08-invoice-print.png'), image.toPNG());

  const pdf = await window.webContents.printToPDF({
    pageSize: 'A4', printBackground: true, preferCSSPageSize: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  fs.writeFileSync(path.join(outDir, 'invoice-sample.pdf'), pdf);

  console.log('grand total:', invoice.totals.grandTotal);
  console.log('pdf bytes:', pdf.length);
  console.log('png written to', path.join(outDir, '08-invoice-print.png'));
  app.exit(0);
});

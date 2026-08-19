/**
 * End-to-end smoke test, run inside the real Electron runtime.
 *
 * Exercises the parts that only exist once Electron is booted: better-sqlite3
 * against Electron's Node ABI, the migrations, saving and reading an invoice,
 * invoice numbering, and rendering a real A4 PDF through printToPDF.
 *
 * Exits 0 on success, 1 with a reason on failure.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

// An isolated userData folder so the test never touches a real shop database.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-smoke-'));
app.setPath('userData', scratch);

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push(`  ok   ${name}`);
  } catch (error) {
    checks.push(`  FAIL ${name}: ${error.message}`);
    throw error;
  }
}

async function run() {
  const { getDb, closeDb, getDatabasePath } = require('../dist-electron/electron/main/db/connection.js');
  const invoicesDb = require('../dist-electron/electron/main/db/invoices.js');
  const customersDb = require('../dist-electron/electron/main/db/customers.js');
  const settingsDb = require('../dist-electron/electron/main/db/settings.js');
  const dashboardDb = require('../dist-electron/electron/main/db/dashboard.js');
  const snapshotDb = require('../dist-electron/electron/main/db/snapshot.js');
  const documents = require('../dist-electron/electron/main/services/documents.js');
  const { registerIpcHandlers } = require('../dist-electron/electron/main/ipc.js');
  const { todayIso } = require('../dist-electron/shared/defaults.js');

  check('database opens and migrates', () => {
    const db = getDb();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map((row) => row.name);
    for (const table of ['customers', 'invoices', 'invoice_items', 'settings', 'sync_state']) {
      if (!tables.includes(table)) throw new Error(`missing table ${table}`);
    }
    if (db.pragma('journal_mode', { simple: true }) !== 'wal') throw new Error('WAL not enabled');
    if (!fs.existsSync(getDatabasePath())) throw new Error('database file was not created');
  });

  check('IPC handlers register without collisions', () => {
    registerIpcHandlers();
  });

  check('settings round-trip through the database', () => {
    const settings = settingsDb.getSettings();
    if (settings.shop.shopName !== 'Prem Jewellers') throw new Error('unexpected default shop');
    settingsDb.saveSettings({
      ...settings,
      shop: { ...settings.shop, gstin: '27AAAAA0000A1Z5', phone: '9999999999' },
    });
    if (settingsDb.getSettings().shop.gstin !== '27AAAAA0000A1Z5') {
      throw new Error('settings did not persist');
    }
  });

  let customerId;
  check('a customer saves and is found by mobile number', () => {
    const saved = customersDb.saveCustomer({
      name: 'Ramesh Patil',
      mobile: '9876543210',
      address: 'Ring Road, Jalgaon',
      pan: 'ABCDE1234F',
      gstin: '27ABCDE1234F1Z5',
      stateCode: '27',
      notes: '',
    });
    customerId = saved.id;
    if (!customerId) throw new Error('no id returned');
    if (customersDb.findCustomerByMobile('9876543210').name !== 'Ramesh Patil') {
      throw new Error('lookup by mobile failed');
    }
    if (customersDb.listCustomers('ramesh').length !== 1) throw new Error('search failed');
  });

  check('saving the same mobile updates instead of duplicating', () => {
    customersDb.saveCustomer({
      name: 'Ramesh D Patil',
      mobile: '9876543210',
      address: 'Ring Road, Jalgaon',
      pan: 'ABCDE1234F',
      gstin: '27ABCDE1234F1Z5',
      stateCode: '27',
      notes: '',
    });
    if (customersDb.countCustomers() !== 1) throw new Error('a duplicate customer was created');
  });

  const invoice = {
    invoiceNo: '',
    invoiceDate: todayIso(),
    customerId,
    customerName: 'Ramesh D Patil',
    customerMobile: '9876543210',
    customerAddress: 'Ring Road, Jalgaon',
    customerPan: 'ABCDE1234F',
    customerGstin: '27ABCDE1234F1Z5',
    customerStateCode: '27',
    intraState: true,
    items: [
      {
        hsnCode: '7113',
        particulars: 'Gold Necklace 22K',
        grossWeight: 25.5,
        netWeight: 24.125,
        rate: 6200,
        makingChargeMode: 'per_gram',
        makingChargeValue: 450,
        gstRate: 3,
      },
    ],
    discount: 0,
    paymentMode: 'Cash',
    paymentReference: '',
    amountPaid: 0,
    notes: '',
    status: 'saved',
  };

  let firstNumber;
  let savedId;
  check('invoice numbering starts the financial-year series', () => {
    firstNumber = invoicesDb.nextInvoiceNumber();
    if (!/^PJ\/\d{2}-\d{2}\/0001$/.test(firstNumber)) {
      throw new Error(`unexpected invoice number: ${firstNumber}`);
    }
  });

  check('an invoice saves with its computed totals', () => {
    const result = invoicesDb.saveInvoice({ ...invoice, invoiceNo: firstNumber });
    savedId = result.id;
    const stored = getDb().prepare('SELECT * FROM invoices WHERE id = ?').get(savedId);
    // 24.125 g x 6200 = 149,575 + making 24.125 x 450 = 10,856.25 -> 160,431.25
    if (Math.abs(stored.taxable_value - 160431.25) > 0.01) {
      throw new Error(`taxable value was ${stored.taxable_value}`);
    }
    if (Math.abs(stored.cgst - 2406.47) > 0.01) throw new Error(`cgst was ${stored.cgst}`);
    if (stored.grand_total !== 165244) throw new Error(`grand total was ${stored.grand_total}`);
    if (Math.abs(stored.total_net_wt - 24.125) > 0.0001) throw new Error('net weight not stored');
  });

  check('the invoice reads back with its line items', () => {
    const loaded = invoicesDb.getInvoice(savedId);
    if (loaded.items.length !== 1) throw new Error('items did not come back');
    if (loaded.items[0].particulars !== 'Gold Necklace 22K') throw new Error('wrong particulars');
    if (loaded.customerMobile !== '9876543210') throw new Error('customer details lost');
  });

  check('the next number advances', () => {
    const second = invoicesDb.nextInvoiceNumber();
    if (second === firstNumber) throw new Error('the number did not advance');
    if (!second.endsWith('0002')) throw new Error(`unexpected second number: ${second}`);
  });

  check('a duplicate invoice gets a fresh number and no id', () => {
    const copy = invoicesDb.duplicateInvoice(savedId);
    if (copy.id) throw new Error('the copy carries the original id');
    if (copy.invoiceNo === firstNumber) throw new Error('the copy reuses the number');
    if (copy.items.length !== 1) throw new Error('the copy lost its items');
  });

  check("today's invoice is editable", () => {
    if (!invoicesDb.canEditInvoice(savedId)) throw new Error('should be editable today');
  });

  check('search and filters find the invoice', () => {
    if (invoicesDb.listInvoices({ search: 'ramesh' }).length !== 1) throw new Error('name search');
    if (invoicesDb.listInvoices({ search: '9876543210' }).length !== 1) throw new Error('mobile');
    if (invoicesDb.listInvoices({ paymentMode: 'Cheque' }).length !== 0) throw new Error('payment');
    if (invoicesDb.listInvoices({ fromDate: '1999-01-01', toDate: '1999-12-31' }).length !== 0) {
      throw new Error('date filter');
    }
  });

  check('the dashboard counts the sale', () => {
    const summary = dashboardDb.dashboardSummary();
    if (summary.todayInvoiceCount !== 1) throw new Error('today count');
    if (summary.todaySales !== 165244) throw new Error(`today sales ${summary.todaySales}`);
    if (summary.totalCustomers !== 1) throw new Error('customer count');
    if (summary.recentInvoices.length !== 1) throw new Error('recent invoices');
  });

  check('a cancelled invoice stops counting as a sale', () => {
    invoicesDb.cancelInvoice(savedId);
    if (dashboardDb.dashboardSummary().todaySales !== 0) throw new Error('still counted');
    invoicesDb.saveInvoice({ ...invoicesDb.getInvoice(savedId), status: 'saved' });
    if (dashboardDb.dashboardSummary().todaySales !== 165244) throw new Error('restore failed');
  });

  let pdfPath;
  await (async () => {
    const loaded = invoicesDb.getInvoice(savedId);
    const buffer = await documents.renderInvoicePdf(loaded);
    check('printToPDF produces a real A4 PDF', () => {
      if (!Buffer.isBuffer(buffer) || buffer.length < 6000) {
        throw new Error(`PDF was only ${buffer.length} bytes`);
      }
      if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('not a PDF');
    });

    pdfPath = await documents.exportInvoicePdf(loaded);
    check('the PDF is written to disk under the invoice name', () => {
      if (!fs.existsSync(pdfPath)) throw new Error('file missing');
      if (!path.basename(pdfPath).includes('Ramesh')) throw new Error(`named ${path.basename(pdfPath)}`);
    });
  })();

  check('a snapshot captures everything and restores idempotently', () => {
    const snapshot = snapshotDb.createSnapshot();
    if (snapshot.invoices.length !== 1) throw new Error('invoice missing from snapshot');
    if (snapshot.customers.length !== 1) throw new Error('customer missing from snapshot');
    if (snapshot.settings.firebase.password !== '') throw new Error('credentials leaked into backup');

    snapshotDb.restoreSnapshot(snapshot);
    if (invoicesDb.countInvoices() !== 1) throw new Error('restore duplicated invoices');
    if (customersDb.countCustomers() !== 1) throw new Error('restore duplicated customers');
  });

  check('clearing the device removes records but keeps shop settings', () => {
    snapshotDb.clearLocalData();
    if (invoicesDb.countInvoices() !== 0) throw new Error('invoices survived');
    if (customersDb.countCustomers() !== 0) throw new Error('customers survived');
    if (settingsDb.getSettings().shop.gstin !== '27AAAAA0000A1Z5') {
      throw new Error('settings were wiped too');
    }
    // Numbering restarts cleanly rather than reusing a cleared number.
    if (!invoicesDb.nextInvoiceNumber().endsWith('0001')) throw new Error('numbering not reset');
  });

  closeDb();
  fs.rmSync(scratch, { recursive: true, force: true });
  if (pdfPath) fs.rmSync(pdfPath, { force: true });
}

app.whenReady().then(async () => {
  let failed = false;
  try {
    await run();
  } catch (error) {
    failed = true;
    console.error('\n[smoke] failed:', error && error.stack ? error.stack : error);
  }

  console.log(`\n[smoke] ${checks.length} checks\n${checks.join('\n')}`);
  console.log(failed ? '\n[smoke] RESULT: FAILED' : '\n[smoke] RESULT: PASSED');
  app.exit(failed ? 1 : 0);
});

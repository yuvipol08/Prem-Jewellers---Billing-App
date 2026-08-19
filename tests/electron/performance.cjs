/**
 * Performance, stress and memory.
 *
 * Budgets are set for an older shop PC, not this machine — if a check passes
 * here with little headroom, treat it as a warning for the real hardware.
 */
const H = require('./_harness.cjs');
const { check, checkAsync, eq, group, isolate, makeInvoice, mod, ok } = H;

isolate('performance');

const INVOICES = Number(process.env.PJ_STRESS_INVOICES || 5000);
const CUSTOMERS = 800;

function ms(fn) {
  const started = process.hrtime.bigint();
  const value = fn();
  return { ms: Number(process.hrtime.bigint() - started) / 1e6, value };
}

async function msAsync(fn) {
  const started = process.hrtime.bigint();
  const value = await fn();
  return { ms: Number(process.hrtime.bigint() - started) / 1e6, value };
}

function heapMb() {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

/** Budget check that always reports the measured number, pass or fail. */
function budget(name, measured, limit, unit = 'ms') {
  return check(name, () => {
    ok(measured <= limit, `took ${measured.toFixed(0)}${unit}, budget ${limit}${unit}`);
    return `${measured.toFixed(0)}${unit} (budget ${limit}${unit})`;
  });
}

H.run('performance', async () => {
  const { getDb, closeDb } = mod('electron/main/db/connection.js');
  const invoicesDb = mod('electron/main/db/invoices.js');
  const customersDb = mod('electron/main/db/customers.js');
  const dashboardDb = mod('electron/main/db/dashboard.js');
  const snapshotDb = mod('electron/main/db/snapshot.js');
  const backup = mod('electron/main/services/backup.js');
  const documents = mod('electron/main/services/documents.js');

  // ============================================================== cold open
  group('startup');

  const open = ms(() => getDb());
  budget('database opens and migrates quickly on a cold start', open.ms, 500);

  const firstNumber = ms(() => invoicesDb.nextInvoiceNumber());
  budget('the first invoice number is ready immediately', firstNumber.ms, 100);

  // =============================================================== seeding
  group(`stress: ${INVOICES.toLocaleString()} invoices, ${CUSTOMERS} customers`);

  const db = getDb();
  const seed = ms(() => {
    const insertAll = db.transaction(() => {
      for (let i = 0; i < CUSTOMERS; i += 1) {
        customersDb.saveCustomer({
          name: `Customer ${i}`, mobile: `9${String(100000000 + i)}`,
          address: `House ${i}, Ring Road, Jalgaon`, pan: '', gstin: '', stateCode: '27', notes: '',
        });
      }
    });
    insertAll();

    // Insert invoices directly so the measurement is about read performance at
    // scale, not about repeating the save path 5,000 times.
    const insertInvoice = db.prepare(`
      INSERT INTO invoices (invoice_no, invoice_date, customer_id, customer_name, customer_mobile,
        customer_address, customer_pan, customer_gstin, customer_state, intra_state, discount,
        taxable_value, cgst, sgst, igst, round_off, grand_total, total_gross_wt, total_net_wt,
        payment_mode, payment_reference, amount_paid, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '', '', '27', 1, 0, 160431.25, 2406.47, 2406.47, 0, -0.19, 165244,
        25.5, 24.125, ?, '', 0, '', 'saved', datetime('now'), datetime('now'))`);
    const insertItem = db.prepare(`
      INSERT INTO invoice_items (invoice_id, line_no, hsn_code, particulars, gross_weight,
        net_weight, rate, making_charge_mode, making_charge_value, making_charge, gst_rate, amount)
      VALUES (?, 1, '7113', 'Gold Necklace 22K', 25.5, 24.125, 6200, 'per_gram', 450, 10856.25, 3, 160431.25)`);

    const modes = ['Cash', 'Cheque', 'Online'];
    const bulk = db.transaction(() => {
      for (let i = 0; i < INVOICES; i += 1) {
        const day = String((i % 28) + 1).padStart(2, '0');
        const month = String((i % 12) + 1).padStart(2, '0');
        const info = insertInvoice.run(
          `BULK/${String(i).padStart(6, '0')}`, `2025-${month}-${day}`,
          (i % CUSTOMERS) + 1, `Customer ${i % CUSTOMERS}`, `9${String(100000000 + (i % CUSTOMERS))}`,
          `House ${i % CUSTOMERS}, Ring Road, Jalgaon`, modes[i % 3]);
        insertItem.run(Number(info.lastInsertRowid));
      }
    });
    bulk();
  });

  check('the dataset seeded', () => {
    eq(invoicesDb.countInvoices(), INVOICES, 'invoice count');
    eq(customersDb.countCustomers(), CUSTOMERS, 'customer count');
    return `${(seed.ms / 1000).toFixed(1)}s to seed`;
  });

  // ============================================================ read paths
  group('query performance at scale');

  const listing = ms(() => invoicesDb.listInvoices({ limit: 200 }));
  budget('the invoice list opens instantly', listing.ms, 150);
  check('the list returns a full page', () => eq(listing.value.length, 200, 'rows'));

  const textSearch = ms(() => invoicesDb.listInvoices({ search: 'Customer 42', limit: 200 }));
  budget('text search across the whole book stays responsive', textSearch.ms, 400);
  check('text search finds the right rows', () => ok(textSearch.value.length > 0, 'no matches'));

  const dateFilter = ms(() => invoicesDb.listInvoices({ fromDate: '2025-06-01', toDate: '2025-06-30', limit: 500 }));
  budget('date filtering uses its index', dateFilter.ms, 200);

  const payment = ms(() => invoicesDb.listInvoices({ paymentMode: 'Cheque', limit: 200 }));
  budget('payment-mode filtering stays fast', payment.ms, 200);

  const customerSearch = ms(() => customersDb.listCustomers('Customer 5', 100));
  budget('customer type-ahead stays under a keystroke', customerSearch.ms, 120);

  const single = ms(() => invoicesDb.getInvoice(invoicesDb.listInvoices({ limit: 1 })[0].id));
  budget('opening one invoice is immediate', single.ms, 60);

  const numbering = ms(() => invoicesDb.nextInvoiceNumber());
  budget('invoice numbering does not slow down as the book grows', numbering.ms, 200);

  const dashboard = ms(() => dashboardDb.dashboardSummary());
  budget('the dashboard aggregates without a full scan', dashboard.ms, 400);

  const status = ms(() => backup.cloudStatus());
  budget('cloud status is a count, not a full read of the book', status.ms, 150);

  const history = ms(() => customersDb.customerHistory(1));
  budget('a customer purchase history opens quickly', history.ms, 150);

  // ================================================================ writes
  group('write performance at scale');

  const saveOne = ms(() => invoicesDb.saveInvoice(makeInvoice({ invoiceNo: 'PERF-SAVE-1' })));
  budget('saving a bill stays fast with thousands already stored', saveOne.ms, 300);

  const saveMany = ms(() => {
    for (let i = 0; i < 50; i += 1) {
      invoicesDb.saveInvoice(makeInvoice({ invoiceNo: `PERF-BATCH-${i}` }));
    }
  });
  budget('fifty consecutive bills average well under a second each', saveMany.ms / 50, 200);

  // =================================================================== PDF
  group('document generation at scale');

  const firstPdf = await msAsync(() => documents.renderInvoicePdf(makeInvoice()));
  budget('the first PDF of the session', firstPdf.ms, 3000);

  const warmPdf = await msAsync(() => documents.renderInvoicePdf(makeInvoice()));
  budget('a warm PDF render', warmPdf.ms, 1500);

  const bigPdf = await msAsync(() => documents.renderInvoicePdf(makeInvoice({
    items: Array.from({ length: 25 }, (_, i) => ({
      hsnCode: '7113', particulars: `Item ${i}`, grossWeight: 5, netWeight: 5,
      rate: 6200, makingChargeMode: 'flat', makingChargeValue: 500, gstRate: 3,
    })),
  })));
  budget('a 25-line bill still renders quickly', bigPdf.ms, 3000);

  // ================================================================ backup
  group('backup at scale');

  const snapshot = await msAsync(() => snapshotDb.createSnapshot());
  budget('a full snapshot of the book completes in reasonable time', snapshot.ms, 20000);
  check('the snapshot is complete', () => {
    eq(snapshot.value.invoices.length, invoicesDb.countInvoices(), 'invoices captured');
    return `${(JSON.stringify(snapshot.value).length / 1024 / 1024).toFixed(1)}MB`;
  });

  // ================================================================ memory
  group('memory');

  check('memory does not grow without bound over extended billing', () => {
    global.gc?.();
    const before = heapMb();

    // Simulate a long shift: repeated reads, searches and saves.
    for (let round = 0; round < 40; round += 1) {
      invoicesDb.listInvoices({ limit: 200 });
      invoicesDb.listInvoices({ search: `Customer ${round}`, limit: 100 });
      customersDb.listCustomers(`Customer ${round}`, 50);
      dashboardDb.dashboardSummary();
      const saved = invoicesDb.saveInvoice(makeInvoice({ invoiceNo: `MEM-${round}` }));
      invoicesDb.getInvoice(saved.id);
    }

    global.gc?.();
    const after = heapMb();
    const growth = after - before;
    ok(growth < 120, `heap grew ${growth.toFixed(1)}MB across 40 rounds`);
    return `${before.toFixed(0)}MB to ${after.toFixed(0)}MB (+${growth.toFixed(1)}MB)`;
  });

  await checkAsync('repeated PDF rendering does not leak windows or memory', async () => {
    const { BrowserWindow } = require('electron');
    global.gc?.();
    const before = heapMb();
    for (let i = 0; i < 30; i += 1) {
      await documents.renderInvoicePdf(makeInvoice({ invoiceNo: `MEMPDF-${i}` }));
    }
    global.gc?.();
    const after = heapMb();
    eq(BrowserWindow.getAllWindows().length, 1, 'render windows still open');
    ok(after - before < 150, `heap grew ${(after - before).toFixed(1)}MB over 30 PDFs`);
    return `${(after - before).toFixed(1)}MB over 30 PDFs, 1 window`;
  });

  check('the database file stays proportionate to the data', () => {
    const fs = require('node:fs');
    const size = fs.statSync(mod('electron/main/db/connection.js').getDatabasePath()).size / 1024 / 1024;
    const perInvoice = (size * 1024) / invoicesDb.countInvoices();
    ok(perInvoice < 6, `${perInvoice.toFixed(2)}KB per invoice is larger than expected`);
    return `${size.toFixed(1)}MB for ${invoicesDb.countInvoices().toLocaleString()} invoices (${perInvoice.toFixed(2)}KB each)`;
  });

  closeDb();
});

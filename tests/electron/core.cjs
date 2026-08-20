/** Database integrity, invoice numbering, the full billing cycle, and PDF output. */
const fs = require('node:fs');
const H = require('./_harness.cjs');
const { check, checkAsync, eq, group, isolate, makeInvoice, mod, near, ok, throws } = H;

isolate('core');

H.run('core', async () => {
  const { getDb, closeDb, getDatabasePath } = mod('electron/main/db/connection.js');
  const invoicesDb = mod('electron/main/db/invoices.js');
  const customersDb = mod('electron/main/db/customers.js');
  const settingsDb = mod('electron/main/db/settings.js');
  const dashboardDb = mod('electron/main/db/dashboard.js');
  const documents = mod('electron/main/services/documents.js');
  const { registerIpcHandlers } = mod('electron/main/ipc.js');
  const { computeInvoice } = mod('shared/calc.js');
  const { todayIso } = mod('shared/defaults.js');

  // ================================================================ schema
  group('database schema and durability');

  check('database opens, migrates and enables WAL', () => {
    const db = getDb();
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
    for (const t of ['customers', 'invoices', 'invoice_items', 'settings', 'sync_state']) {
      ok(tables.includes(t), `missing table ${t}`);
    }
    eq(db.pragma('journal_mode', { simple: true }), 'wal', 'journal mode');
    eq(db.pragma('foreign_keys', { simple: true }), 1, 'foreign keys');
    ok(fs.existsSync(getDatabasePath()), 'database file created');
  });

  check('migrations are idempotent — reopening does not re-run them', () => {
    const before = getDb().pragma('user_version', { simple: true });
    closeDb();
    const after = getDb().pragma('user_version', { simple: true });
    eq(after, before, 'user_version');
  });

  check('IPC handlers register exactly once without channel collisions', () => {
    registerIpcHandlers();
  });

  check('every index the hot queries rely on exists', () => {
    const indexes = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all().map((r) => r.name);
    for (const i of ['idx_invoices_date', 'idx_invoices_customer', 'idx_customers_mobile']) {
      ok(indexes.includes(i), `missing index ${i}`);
    }
  });

  // ============================================================= customers
  group('customer records');

  let customerId;
  check('a customer saves and is found by every search route', () => {
    const saved = customersDb.saveCustomer({
      name: 'Ramesh Patil', mobile: '9876543210', address: 'Ring Road, Jalgaon',
      pan: 'ABCDE1234F', gstin: '27ABCDE1234F1Z5', stateCode: '27', notes: '',
    });
    customerId = saved.id;
    ok(customerId, 'id returned');
    eq(customersDb.listCustomers('ramesh').length, 1, 'by name');
    eq(customersDb.listCustomers('9876543210').length, 1, 'by mobile');
    eq(customersDb.listCustomers('27ABCDE').length, 1, 'by gstin');
    eq(customersDb.listCustomers('ABCDE1234F').length, 1, 'by pan');
  });

  check('search is case insensitive', () => {
    eq(customersDb.listCustomers('RAMESH').length, 1, 'upper');
    eq(customersDb.listCustomers('RaMeSh').length, 1, 'mixed');
  });

  check('the same mobile updates rather than duplicating', () => {
    customersDb.saveCustomer({
      name: 'Ramesh D Patil', mobile: '9876543210', address: 'Ring Road',
      pan: 'ABCDE1234F', gstin: '27ABCDE1234F1Z5', stateCode: '27', notes: '',
    });
    eq(customersDb.countCustomers(), 1, 'customer count');
    eq(customersDb.getCustomer(customerId).name, 'Ramesh D Patil', 'name updated');
  });

  check('two walk-ins with no mobile stay separate people', () => {
    const a = customersDb.saveCustomer({ name: 'Walk In A', mobile: '', address: '', pan: '', gstin: '', stateCode: '27', notes: '' });
    const b = customersDb.saveCustomer({ name: 'Walk In B', mobile: '', address: '', pan: '', gstin: '', stateCode: '27', notes: '' });
    ok(a.id !== b.id, 'blank mobiles must not collapse into one customer');
    customersDb.deleteCustomer(a.id);
    customersDb.deleteCustomer(b.id);
  });

  check('a nameless customer is rejected with a readable message', () => {
    throws(() => customersDb.saveCustomer({ name: '   ', mobile: '1', address: '', pan: '', gstin: '', stateCode: '', notes: '' }),
      /name is required/i);
  });

  check('PAN and GSTIN are normalised to upper case', () => {
    const saved = customersDb.saveCustomer({
      name: 'Case Test', mobile: '9000000001', address: '', pan: 'abcde1234f',
      gstin: '27abcde1234f1z5', stateCode: '27', notes: '',
    });
    eq(saved.pan, 'ABCDE1234F', 'pan');
    eq(saved.gstin, '27ABCDE1234F1Z5', 'gstin');
    customersDb.deleteCustomer(saved.id);
  });

  // ============================================================= numbering
  group('invoice numbering');

  check('the first number opens the financial-year series', () => {
    const first = invoicesDb.nextInvoiceNumber();
    ok(/^PJ\/\d{2}-\d{2}\/0001$/.test(first), `unexpected: ${first}`);
    return first;
  });

  let savedId;
  check('saving stores the computed totals alongside the inputs', () => {
    const result = invoicesDb.saveInvoice(makeInvoice({ customerId }));
    savedId = result.id;
    const row = getDb().prepare('SELECT * FROM invoices WHERE id = ?').get(savedId);
    // 24.125 x 6200 = 149,575 + making 24.125 x 450 = 10,856.25 -> 160,431.25
    near(row.taxable_value, 160431.25, 0.01, 'taxable value');
    near(row.cgst, 2406.47, 0.01, 'cgst');
    near(row.sgst, 2406.47, 0.01, 'sgst');
    eq(row.igst, 0, 'igst');
    eq(row.grand_total, 165244, 'grand total');
    near(row.total_net_wt, 24.125, 0.0001, 'net weight');
  });

  check('the number advances and never repeats', () => {
    const seen = new Set();
    for (let i = 0; i < 25; i += 1) {
      const number = invoicesDb.nextInvoiceNumber();
      ok(!seen.has(number) || i === 0, 'nextInvoiceNumber is stable until one is taken');
      seen.add(number);
      invoicesDb.saveInvoice(makeInvoice({ invoiceNo: number, customerId }));
    }
    eq(invoicesDb.countInvoices(), 26, 'invoice count');
    const all = getDb().prepare('SELECT invoice_no FROM invoices').all().map((r) => r.invoice_no);
    eq(new Set(all).size, all.length, 'all invoice numbers are unique');
  });

  check('renumbering onto another bill is refused with a readable message', () => {
    const [a, b] = getDb().prepare('SELECT id, invoice_no FROM invoices ORDER BY id LIMIT 2').all();
    ok(a && b && a.id !== b.id, 'fixture needs two distinct invoices');
    throws(
      () => invoicesDb.saveInvoice({ ...invoicesDb.getInvoice(b.id), invoiceNo: a.invoice_no }),
      /already used by another bill/i,
    );
    // The refusal must not have half-applied the edit.
    eq(invoicesDb.getInvoice(b.id).invoiceNo, b.invoice_no, 'the bill kept its own number');
  });

  check('re-saving a bill under its own number is not treated as a clash', () => {
    const existing = getDb().prepare('SELECT id, invoice_no FROM invoices ORDER BY id LIMIT 1').get();
    const loaded = invoicesDb.getInvoice(existing.id);
    invoicesDb.saveInvoice({ ...loaded, notes: 'edited' });
    eq(invoicesDb.getInvoice(existing.id).invoiceNo, existing.invoice_no, 'number unchanged');
  });

  check('a prefix containing a LIKE wildcard still scans its own series', () => {
    const settings = settingsDb.getSettings();
    settingsDb.saveSettings({ ...settings, shop: { ...settings.shop, invoicePrefix: 'PJ_', resetNumberYearly: false } });
    const number = invoicesDb.nextInvoiceNumber();
    ok(number.startsWith('PJ_-'), `unexpected: ${number}`);
    eq(number, 'PJ_-0001', 'a wildcard prefix must not match the PJ/ series');
    settingsDb.saveSettings(settings);
  });

  check('the configured start number is honoured on a fresh series', () => {
    const settings = settingsDb.getSettings();
    settingsDb.saveSettings({ ...settings, shop: { ...settings.shop, invoicePrefix: 'NEW', invoiceStartNumber: 501, resetNumberYearly: false } });
    eq(invoicesDb.nextInvoiceNumber(), 'NEW-0501', 'start number');
    settingsDb.saveSettings(settings);
  });

  check('a manually numbered bill does not corrupt the sequence', () => {
    const prefix = invoicesDb.invoiceSeriesPrefix();
    invoicesDb.saveInvoice(makeInvoice({ invoiceNo: `${prefix}0007-A`, customerId }));
    const next = invoicesDb.nextInvoiceNumber();
    ok(/\/\d{4}$/.test(next), `sequence broken by manual number: ${next}`);
  });

  // ========================================================== full cycle
  group('end-to-end billing cycle');

  await checkAsync('create customer, bill, save, PDF, search, reopen — all intact', async () => {
    const customer = customersDb.saveCustomer({
      name: 'Sunita Deshmukh', mobile: '9822012345', address: 'Sarafa Bazar, Jalgaon',
      pan: 'PQRSX9876Z', gstin: '27PQRSX9876Z1Z9', stateCode: '27', notes: '',
    });
    const saved = invoicesDb.saveInvoice(makeInvoice({
      customerId: customer.id, customerName: customer.name, customerMobile: customer.mobile,
      invoiceNo: invoicesDb.nextInvoiceNumber(),
    }));

    const loaded = invoicesDb.getInvoice(saved.id);
    eq(loaded.items.length, 1, 'items round-tripped');
    eq(loaded.customerName, 'Sunita Deshmukh', 'customer on the bill');

    const pdf = await documents.renderInvoicePdf(loaded);
    ok(pdf.subarray(0, 5).toString() === '%PDF-', 'a real PDF was produced');

    eq(invoicesDb.listInvoices({ search: 'Sunita' }).length, 1, 'search by name');
    eq(invoicesDb.listInvoices({ search: '9822012345' }).length, 1, 'search by mobile');
    eq(customersDb.customerHistory(customer.id).length, 1, 'purchase history');

    // Reopen the database and confirm nothing was lost.
    closeDb();
    const reopened = invoicesDb.getInvoice(saved.id);
    eq(reopened.invoiceNo, saved.invoiceNo, 'survives a close/reopen');
    eq(reopened.items.length, 1, 'items survive');
    return saved.invoiceNo;
  });

  check('cancelling removes a bill from sales but keeps it in the records', () => {
    const before = dashboardDb.dashboardSummary().todaySales;
    invoicesDb.cancelInvoice(savedId);
    const after = dashboardDb.dashboardSummary().todaySales;
    ok(after < before, 'cancelled sale stopped counting');
    eq(invoicesDb.getInvoice(savedId).status, 'cancelled', 'still on record');
    eq(invoicesDb.canEditInvoice(savedId), false, 'a cancelled bill cannot be edited');
  });

  check('deleting an invoice cascades to its line items', () => {
    const result = invoicesDb.saveInvoice(makeInvoice({ invoiceNo: invoicesDb.nextInvoiceNumber() }));
    invoicesDb.deleteInvoice(result.id);
    const orphans = getDb().prepare('SELECT COUNT(*) AS c FROM invoice_items WHERE invoice_id = ?').get(result.id);
    eq(orphans.c, 0, 'orphaned line items');
  });

  check('deleting a customer preserves their past invoices', () => {
    const customer = customersDb.saveCustomer({ name: 'Temp Buyer', mobile: '9000000099', address: '', pan: '', gstin: '', stateCode: '27', notes: '' });
    const inv = invoicesDb.saveInvoice(makeInvoice({ customerId: customer.id, customerName: 'Temp Buyer', invoiceNo: invoicesDb.nextInvoiceNumber() }));
    customersDb.deleteCustomer(customer.id);
    const after = invoicesDb.getInvoice(inv.id);
    ok(after, 'the invoice still exists');
    eq(after.customerName, 'Temp Buyer', 'the printed name is preserved');
    eq(after.customerId, null, 'the link is cleared, not dangling');
  });

  check('an invoice with no billable line is refused', () => {
    throws(() => invoicesDb.saveInvoice(makeInvoice({ items: [] })), /at least one item/i);
    throws(() => invoicesDb.saveInvoice(makeInvoice({
      items: [{ hsnCode: '7113', particulars: '', grossWeight: 0, netWeight: 0, rate: 0, makingChargeMode: 'flat', makingChargeValue: 0, gstRate: 3 }],
    })), /at least one item/i);
  });

  check('a failed save leaves nothing behind', () => {
    const before = invoicesDb.countInvoices();
    const itemsBefore = getDb().prepare('SELECT COUNT(*) AS c FROM invoice_items').get().c;
    try { invoicesDb.saveInvoice(makeInvoice({ items: [] })); } catch { /* expected */ }
    eq(invoicesDb.countInvoices(), before, 'invoice count unchanged');
    eq(getDb().prepare('SELECT COUNT(*) AS c FROM invoice_items').get().c, itemsBefore, 'no stray items');
  });

  check('editing is limited to today and rewrites lines atomically', () => {
    const created = invoicesDb.saveInvoice(makeInvoice({ invoiceNo: invoicesDb.nextInvoiceNumber() }));
    eq(invoicesDb.canEditInvoice(created.id), true, "today's bill is editable");

    const loaded = invoicesDb.getInvoice(created.id);
    invoicesDb.saveInvoice({ ...loaded, items: [
      { ...loaded.items[0], netWeight: 10, rate: 6000, makingChargeMode: 'flat', makingChargeValue: 1000 },
      { hsnCode: '7106', particulars: 'Silver Payal', grossWeight: 50, netWeight: 50, rate: 92, makingChargeMode: 'flat', makingChargeValue: 500, gstRate: 3 },
    ] });
    const edited = invoicesDb.getInvoice(created.id);
    eq(edited.items.length, 2, 'lines replaced, not appended');
    eq(getDb().prepare('SELECT COUNT(*) AS c FROM invoice_items WHERE invoice_id = ?').get(created.id).c, 2, 'no leftovers');

    getDb().prepare(`UPDATE invoices SET invoice_date = '2020-01-01' WHERE id = ?`).run(created.id);
    eq(invoicesDb.canEditInvoice(created.id), false, 'an older bill is locked');
  });

  check('duplicating produces an unsaved copy on a fresh number', () => {
    const source = invoicesDb.listInvoices({ limit: 1 })[0];
    const copy = invoicesDb.duplicateInvoice(source.id);
    eq(copy.id, undefined, 'no id carried over');
    ok(copy.invoiceNo !== source.invoiceNo, 'new number');
    eq(copy.invoiceDate, todayIso(), 'dated today');
    eq(copy.amountPaid, 0, 'payment not carried over');
    ok(copy.items.every((i) => i.id === undefined), 'line ids cleared');
  });

  // ================================================================ filters
  group('search and filters');

  check('date, payment and text filters each narrow correctly', () => {
    eq(invoicesDb.listInvoices({ fromDate: '1999-01-01', toDate: '1999-12-31' }).length, 0, 'past range');
    eq(invoicesDb.listInvoices({ paymentMode: 'Cheque' }).length, 0, 'unused payment mode');
    ok(invoicesDb.listInvoices({ search: 'ramesh' }).length > 0, 'name search');
    eq(invoicesDb.listInvoices({ search: 'no-such-customer-xyz' }).length, 0, 'miss');
  });

  check('paging returns disjoint pages', () => {
    const first = invoicesDb.listInvoices({ limit: 5, offset: 0 }).map((r) => r.id);
    const second = invoicesDb.listInvoices({ limit: 5, offset: 5 }).map((r) => r.id);
    eq(first.length, 5, 'first page size');
    ok(!first.some((id) => second.includes(id)), 'pages overlap');
  });

  // ==================================================================== PDF
  group('PDF and print output');

  const scenarios = [
    ['intra-state CGST + SGST', makeInvoice({ intraState: true })],
    ['inter-state IGST', makeInvoice({ intraState: false, customerStateCode: '29' })],
    ['with a discount', makeInvoice({ discount: 5000 })],
    ['part payment showing a balance', makeInvoice({ amountPaid: 50000 })],
    ['flat making charge', makeInvoice({ items: [{ hsnCode: '7113', particulars: 'Ring', grossWeight: 5, netWeight: 5, rate: 6200, makingChargeMode: 'flat', makingChargeValue: 1500, gstRate: 3 }] })],
    ['percent making charge', makeInvoice({ items: [{ hsnCode: '7113', particulars: 'Bangle', grossWeight: 30, netWeight: 29, rate: 6200, makingChargeMode: 'percent', makingChargeValue: 12, gstRate: 3 }] })],
    ['nine lines still fits one page', makeInvoice({ items: Array.from({ length: 9 }, (_, i) => ({ hsnCode: '7113', particulars: `Item ${i + 1}`, grossWeight: 5, netWeight: 5, rate: 6200, makingChargeMode: 'flat', makingChargeValue: 500, gstRate: 3 })) })],
    ['a name containing markup', makeInvoice({ customerName: '<script>alert(1)</script> & "Sons"' })],
    ['a Devanagari customer name', makeInvoice({ customerName: 'रमेश पाटील' })],
  ];

  for (const [label, invoice] of scenarios) {
    await checkAsync(`PDF renders: ${label}`, async () => {
      const pdf = await documents.renderInvoicePdf(invoice);
      ok(pdf.subarray(0, 5).toString() === '%PDF-', 'not a PDF');
      ok(pdf.length > 5000, `suspiciously small: ${pdf.length} bytes`);
      const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      eq(pages, 1, 'page count');
      return `${(pdf.length / 1024).toFixed(0)}KB`;
    });
  }

  await checkAsync('a bill of 30 lines flows onto more pages rather than truncating', async () => {
    const pdf = await documents.renderInvoicePdf(makeInvoice({
      items: Array.from({ length: 30 }, (_, i) => ({ hsnCode: '7113', particulars: `Item ${i + 1}`, grossWeight: 5, netWeight: 5, rate: 6200, makingChargeMode: 'flat', makingChargeValue: 500, gstRate: 3 })),
    }));
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    ok(pages >= 2, `expected multiple pages, got ${pages}`);
    return `${pages} pages`;
  });

  await checkAsync('the A4 page box is exactly right', async () => {
    const pdf = await documents.renderInvoicePdf(makeInvoice());
    const box = /\/MediaBox\s*\[([^\]]*)\]/.exec(pdf.toString('latin1'));
    ok(box, 'no MediaBox');
    const [, , width, height] = box[1].trim().split(/\s+/).map(Number);
    near(width, 595, 2, 'A4 width in points');
    near(height, 842, 2, 'A4 height in points');
    return `${width.toFixed(0)}x${height.toFixed(0)}pt`;
  });

  await checkAsync('repeated PDF renders stay stable — no window leak', async () => {
    for (let i = 0; i < 12; i += 1) {
      const pdf = await documents.renderInvoicePdf(makeInvoice({ invoiceNo: `LOOP-${i}` }));
      ok(pdf.length > 5000, `render ${i} produced ${pdf.length} bytes`);
    }
    const { BrowserWindow } = require('electron');
    eq(BrowserWindow.getAllWindows().length, 1, 'exactly one reusable render window');
  });

  await checkAsync('concurrent PDF requests all succeed', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      documents.renderInvoicePdf(makeInvoice({ invoiceNo: `PAR-${i}` }))));
    ok(results.every((b) => b.subarray(0, 5).toString() === '%PDF-'), 'all rendered');
    ok(new Set(results.map((b) => b.length)).size >= 1, 'all produced output');
  });

  check('PDF file names are safe on Windows and never empty', () => {
    const cases = [
      [makeInvoice({ invoiceNo: 'PJ/25-26/0001', customerName: 'Ramesh Patil' }), /^PJ_25-26_0001_Ramesh_Patil\.pdf$/],
      [makeInvoice({ invoiceNo: 'PJ/25-26/0002', customerName: 'रमेश पाटील' }), /^PJ_25-26_0002.*\.pdf$/],
      [makeInvoice({ invoiceNo: 'PJ/25-26/0003', customerName: 'A/B\\C:D*E?F"G<H>I|J' }), /^PJ_25-26_0003.*\.pdf$/],
      [makeInvoice({ invoiceNo: 'PJ/25-26/0004', customerName: '' }), /^PJ_25-26_0004\.pdf$/],
    ];
    for (const [invoice, pattern] of cases) {
      const name = documents.pdfFileName(invoice);
      ok(pattern.test(name), `unexpected file name: ${name}`);
      ok(!/[/\\:*?"<>|]/.test(name), `illegal Windows character in: ${name}`);
    }
  });

  await checkAsync('the printer list is readable without throwing', async () => {
    const printers = await documents.listPrinters();
    ok(Array.isArray(printers), 'not an array');
    for (const printer of printers) {
      ok(typeof printer.name === 'string', 'printer name');
      ok(typeof printer.isDefault === 'boolean', 'default flag');
    }
    return `${printers.length} printer(s) visible`;
  });

  await checkAsync('printing with no printer attached explains itself', async () => {
    const printers = await documents.listPrinters();
    if (printers.length > 0) return 'skipped — a printer is attached';
    let message = '';
    try {
      await documents.printInvoice(makeInvoice());
    } catch (error) {
      message = error.message;
    }
    ok(/no printer is available/i.test(message), `unhelpful message: ${message}`);
    ok(/save pdf/i.test(message), 'the message should offer a way forward');
    return 'clear message, no crash';
  });

  check('the printed HTML carries every column and escapes hostile input', () => {
    const html = documents.buildInvoiceHtml(makeInvoice({ customerName: '<img src=x onerror=alert(1)>' }));
    for (const heading of ['HSN', 'Particulars', 'Gross Wt', 'Net Wt', 'Rate', 'Making', 'Amount', 'TAX INVOICE']) {
      ok(html.includes(heading), `missing ${heading}`);
    }
    ok(!html.includes('<img src=x'), 'markup reached the page unescaped');
    ok(html.includes('&lt;img src=x'), 'expected escaped output');
  });

  check('the on-screen total and the printed total are the same number', () => {
    const invoice = makeInvoice({ discount: 3333.33, amountPaid: 1000 });
    const computed = computeInvoice(invoice);
    const html = documents.buildInvoiceHtml(invoice);
    const formatted = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .format(computed.totals.grandTotal);
    ok(html.includes(formatted), `printed page is missing the grand total ${formatted}`);
  });

  closeDb();
});

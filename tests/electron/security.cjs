/** Security posture, injection resistance, and hostile-input edge cases. */
const fs = require('node:fs');
const path = require('node:path');
const H = require('./_harness.cjs');
const { check, checkAsync, eq, group, isolate, makeInvoice, mod, ok } = H;

isolate('security');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

H.run('security', async () => {
  const { getDb, closeDb } = mod('electron/main/db/connection.js');
  const invoicesDb = mod('electron/main/db/invoices.js');
  const customersDb = mod('electron/main/db/customers.js');
  const settingsDb = mod('electron/main/db/settings.js');
  const snapshotDb = mod('electron/main/db/snapshot.js');
  const documents = mod('electron/main/services/documents.js');
  const { escapeHtml } = mod('shared/invoiceTemplate.js');

  getDb();

  // ==================================================== process isolation
  group('electron process isolation');

  check('the main window runs with node integration off and isolation on', () => {
    const source = read('electron/main/index.ts');
    ok(/nodeIntegration:\s*false/.test(source), 'nodeIntegration must be false');
    ok(/contextIsolation:\s*true/.test(source), 'contextIsolation must be true');
  });

  check('the PDF render window disables javascript and is sandboxed', () => {
    const source = read('electron/main/services/documents.ts');
    ok(/javascript:\s*false/.test(source), 'invoice markup must never execute script');
    ok(/sandbox:\s*true/.test(source), 'the render window should be sandboxed');
    ok(/nodeIntegration:\s*false/.test(source), 'nodeIntegration must be false');
  });

  check('a restrictive CSP ships in the renderer HTML', () => {
    const html = read('index.html');
    ok(/Content-Security-Policy/.test(html), 'no CSP');
    ok(/default-src 'self'/.test(html), 'default-src not locked down');
    ok(!/unsafe-eval/.test(html), 'unsafe-eval must not be allowed');
    ok(/script-src 'self'/.test(html), 'script-src not locked down');
  });

  check('the preload exposes a fixed surface and only one event channel', () => {
    const source = read('electron/preload/index.ts');
    ok(/contextBridge\.exposeInMainWorld/.test(source), 'must go through the context bridge');
    ok(/channel !== 'menu-action'/.test(source), 'event subscription must be restricted');
  });

  check('external navigation and new windows are pushed to the OS browser', () => {
    const source = read('electron/main/index.ts');
    ok(/setWindowOpenHandler/.test(source), 'no window-open handler');
    ok(/will-navigate/.test(source), 'no navigation guard');
    ok(/action: 'deny'/.test(source), 'new windows must be denied');
  });

  // ========================================================= sql injection
  group('sql injection resistance');

  const payloads = [
    "'; DROP TABLE invoices; --",
    "' OR '1'='1",
    "'); DELETE FROM customers; --",
    "Robert'); DROP TABLE customers;--",
    '1 UNION SELECT * FROM settings',
  ];

  check('injection payloads in customer fields are stored as literal text', () => {
    for (const payload of payloads) {
      const saved = customersDb.saveCustomer({
        name: payload, mobile: '', address: payload, pan: '', gstin: '', stateCode: '27', notes: payload,
      });
      eq(saved.name, payload, 'stored verbatim');
      const tables = getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
      ok(tables.includes('invoices') && tables.includes('customers'), `payload dropped a table: ${payload}`);
      customersDb.deleteCustomer(saved.id);
    }
  });

  check('injection payloads in search do not execute', () => {
    customersDb.saveCustomer({ name: 'Safe Customer', mobile: '9000000000', address: '', pan: '', gstin: '', stateCode: '27', notes: '' });
    for (const payload of payloads) {
      ok(Array.isArray(customersDb.listCustomers(payload)), 'search returned a result set');
      ok(customersDb.countCustomers() >= 1, 'customers survived the search');
    }
    eq(invoicesDb.listInvoices({ search: "' OR 1=1 --" }).length, 0, 'a tautology must not match every bill');
  });

  check('a LIKE wildcard typed into search does not crash', () => {
    ok(Array.isArray(customersDb.listCustomers('%')), 'no crash on a bare wildcard');
    ok(Array.isArray(customersDb.listCustomers('_')), 'no crash on a single-char wildcard');
  });

  check('injection payloads in invoice fields are stored verbatim', () => {
    const result = invoicesDb.saveInvoice(makeInvoice({
      invoiceNo: invoicesDb.nextInvoiceNumber(),
      customerName: "'; DROP TABLE invoices; --",
      notes: "' OR '1'='1",
    }));
    eq(invoicesDb.getInvoice(result.id).customerName, "'; DROP TABLE invoices; --", 'stored verbatim');
    ok(invoicesDb.countInvoices() >= 1, 'the table survived');
  });

  // ======================================================= html injection
  group('printed document injection');

  check('escapeHtml neutralises every dangerous character', () => {
    eq(escapeHtml('<script>'), '&lt;script&gt;', 'tags');
    eq(escapeHtml('"'), '&quot;', 'double quote');
    eq(escapeHtml("'"), '&#39;', 'single quote');
    eq(escapeHtml('&'), '&amp;', 'ampersand');
    eq(escapeHtml(null), '', 'null');
    eq(escapeHtml(undefined), '', 'undefined');
  });

  check('hostile content in every printed field is escaped', () => {
    const attack = '<img src=x onerror=alert(1)>';
    const html = documents.buildInvoiceHtml(makeInvoice({
      customerName: attack, customerAddress: attack, customerPan: attack,
      customerGstin: attack, paymentReference: attack,
      items: [{ hsnCode: attack, particulars: attack, grossWeight: 1, netWeight: 1, rate: 1, makingChargeMode: 'flat', makingChargeValue: 0, gstRate: 3 }],
    }));
    ok(!html.includes('<img src=x'), 'raw tag reached the document');
    // The payload must survive only as inert text: no live tag may exist anywhere.
    // (Checking for "onerror=" after stripping entities is wrong — that finds the
    // escaped text and reports a hole that is not there.)
    ok(!/<\s*(img|script|iframe|svg|object|embed|link)/i.test(html), 'a live tag was rendered');
    ok(html.includes('&lt;img src=x'), 'the payload should still print as escaped text');
  });

  check('hostile content in shop settings is escaped too', () => {
    const settings = settingsDb.getSettings();
    settingsDb.saveSettings({ ...settings, shop: { ...settings.shop,
      shopName: '<script>alert("shop")</script>', termsAndConditions: '<iframe src=evil>',
      declaration: '</style><script>x</script>' } });
    const html = documents.buildInvoiceHtml(makeInvoice());
    ok(!html.includes('<script>alert("shop")'), 'shop name injected script');
    ok(!html.includes('<iframe src=evil>'), 'terms injected an iframe');
    settingsDb.saveSettings(settings);
  });

  check('the printed document never references an external resource', () => {
    const html = documents.buildInvoiceHtml(makeInvoice());
    ok(!/<script/i.test(html), 'contains a script tag');
    ok(!/https?:\/\//i.test(html), 'references a remote URL');
    ok(!/<link/i.test(html), 'contains a link tag');
  });

  // ============================================================ credentials
  group('credential handling');

  check('credentials are never written into a snapshot', () => {
    const settings = settingsDb.getSettings();
    settingsDb.saveSettings({ ...settings,
      firebase: { ...settings.firebase, password: 'SUPERSECRET-PW' },
      whatsapp: { ...settings.whatsapp, accessToken: 'SUPERSECRET-TOKEN' } });

    for (const includeSettings of [true, false]) {
      const serialised = JSON.stringify(snapshotDb.createSnapshot(includeSettings));
      ok(!serialised.includes('SUPERSECRET-PW'), `password leaked (includeSettings=${includeSettings})`);
      ok(!serialised.includes('SUPERSECRET-TOKEN'), `token leaked (includeSettings=${includeSettings})`);
    }
    settingsDb.saveSettings(settings);
  });

  check('the printed invoice never carries a credential', () => {
    const settings = settingsDb.getSettings();
    settingsDb.saveSettings({ ...settings,
      firebase: { ...settings.firebase, password: 'SUPERSECRET-PW', apiKey: 'SUPERSECRET-KEY' },
      whatsapp: { ...settings.whatsapp, accessToken: 'SUPERSECRET-TOKEN' } });
    const html = documents.buildInvoiceHtml(makeInvoice());
    for (const secret of ['SUPERSECRET-PW', 'SUPERSECRET-KEY', 'SUPERSECRET-TOKEN']) {
      ok(!html.includes(secret), `${secret} appears on the printed bill`);
    }
    settingsDb.saveSettings(settings);
  });

  check('no credential is hardcoded in the source', () => {
    for (const file of ['electron/main/services/cloud.ts', 'electron/main/services/whatsapp.ts', 'shared/defaults.ts']) {
      const source = read(file);
      ok(!/AIza[0-9A-Za-z_-]{30,}/.test(source), `a Firebase API key is hardcoded in ${file}`);
      ok(!/EAA[0-9A-Za-z]{40,}/.test(source), `a Meta access token is hardcoded in ${file}`);
    }
  });

  // ============================================================= edge cases
  group('hostile and edge-case input');

  check('very long field values are stored without truncating the record', () => {
    const long = 'A'.repeat(20000);
    const saved = customersDb.saveCustomer({ name: long, mobile: '9333333333', address: long, pan: '', gstin: '', stateCode: '27', notes: long });
    eq(customersDb.getCustomer(saved.id).name.length, 20000, 'long name survived');
    customersDb.deleteCustomer(saved.id);
  });

  check('unicode, emoji and right-to-left text round-trip intact', () => {
    // Devanagari, an emoji, Arabic, Japanese, Greek.
    const names = ['रमेश', '💎 Gold', 'مجوهرات', '日本語', 'Ωμέγα'];
    for (const name of names) {
      const saved = customersDb.saveCustomer({ name, mobile: '', address: name, pan: '', gstin: '', stateCode: '27', notes: '' });
      eq(customersDb.getCustomer(saved.id).name, name, 'unicode round trip');
      customersDb.deleteCustomer(saved.id);
    }
  });

  check('a null byte in input does not truncate the stored value', () => {
    const name = `Before${String.fromCharCode(0)}After`;
    const saved = customersDb.saveCustomer({ name, mobile: '9444444444', address: '', pan: '', gstin: '', stateCode: '27', notes: '' });
    ok(customersDb.getCustomer(saved.id).name.includes('After'), 'value was truncated at the null byte');
    customersDb.deleteCustomer(saved.id);
  });

  check('extreme numeric values do not corrupt a bill', () => {
    const result = invoicesDb.saveInvoice(makeInvoice({
      invoiceNo: invoicesDb.nextInvoiceNumber(),
      items: [{ hsnCode: '7113', particulars: 'Extreme', grossWeight: 1e9, netWeight: 1e9, rate: 1e9, makingChargeMode: 'flat', makingChargeValue: 0, gstRate: 3 }],
    }));
    const row = getDb().prepare('SELECT grand_total FROM invoices WHERE id = ?').get(result.id);
    ok(Number.isFinite(row.grand_total), 'grand total is not finite');
    invoicesDb.deleteInvoice(result.id);
  });

  check('an invalid date string never puts NaN on the printed bill', () => {
    const result = invoicesDb.saveInvoice(makeInvoice({ invoiceNo: invoicesDb.nextInvoiceNumber(), invoiceDate: 'not-a-date' }));
    const html = documents.buildInvoiceHtml(invoicesDb.getInvoice(result.id));
    ok(!html.includes('NaN'), 'NaN reached the printed page');
    invoicesDb.deleteInvoice(result.id);
  });

  check('corrupted settings JSON falls back to defaults instead of blocking billing', () => {
    getDb().prepare(`INSERT INTO settings (key, value) VALUES ('app_settings', '{not valid json')
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
    eq(settingsDb.getSettings().shop.shopName, 'Prem Jewellers', 'defaults restored');
    ok(invoicesDb.nextInvoiceNumber().length > 0, 'billing still works');
  });

  check('settings survive an unknown future key without dropping known ones', () => {
    const settings = settingsDb.getSettings();
    // invoicePrefix is an operating preference, not part of the locked identity.
    settingsDb.saveSettings({ ...settings, shop: { ...settings.shop, invoicePrefix: 'ZZ' }, unknownFuture: true });
    eq(settingsDb.getSettings().shop.invoicePrefix, 'ZZ', 'editable key preserved');
    settingsDb.saveSettings(settings);
  });

  // ------------------------------------------------------- locked identity
  group('locked business identity');

  check('the identity cannot be changed through the settings API', () => {
    const { BUSINESS } = mod('shared/business.js');
    const settings = settingsDb.getSettings();
    settingsDb.saveSettings({
      ...settings,
      shop: {
        ...settings.shop,
        shopName: 'Rogue Jewellers',
        gstin: '99ZZZZZ9999Z9Z9',
        pan: 'ZZZZZ9999Z',
        bankAccount: '000000000',
        declaration: 'Anything at all',
        signatureLabel: 'Someone Else',
      },
    });
    const after = settingsDb.getSettings().shop;
    eq(after.shopName, BUSINESS.shopName, 'shop name');
    eq(after.gstin, BUSINESS.gstin, 'gstin');
    eq(after.pan, BUSINESS.pan, 'pan');
    eq(after.bankAccount, BUSINESS.bankAccount, 'bank account');
    eq(after.declaration, BUSINESS.declaration, 'declaration');
    eq(after.signatureLabel, BUSINESS.signatureLabel, 'signature label');
  });

  check('a tampered database row cannot put wrong details on a bill', () => {
    // Simulate an edited settings blob or a backup from another shop.
    const stored = JSON.parse(
      getDb().prepare(`SELECT value FROM settings WHERE key = 'app_settings'`).get().value,
    );
    stored.shop.shopName = 'Injected Shop';
    stored.shop.gstin = '11FAKE1111F1Z1';
    getDb()
      .prepare(`UPDATE settings SET value = ? WHERE key = 'app_settings'`)
      .run(JSON.stringify(stored));

    const { BUSINESS } = mod('shared/business.js');
    eq(settingsDb.getSettings().shop.shopName, BUSINESS.shopName, 'shop name overridden');
    const html = documents.buildInvoiceHtml(makeInvoice());
    ok(!html.includes('Injected Shop'), 'a tampered shop name reached the printed bill');
    ok(!html.includes('11FAKE1111F1Z1'), 'a tampered GSTIN reached the printed bill');
  });

  check('a restored backup cannot reintroduce another shop\'s identity', () => {
    const { BUSINESS } = mod('shared/business.js');
    const snapshot = snapshotDb.createSnapshot();
    snapshot.settings.shop.shopName = 'Other Shop';
    snapshot.settings.shop.gstin = '22OTHER2222O2Z2';
    snapshotDb.restoreSnapshot(snapshot, { settings: true });
    eq(settingsDb.getSettings().shop.shopName, BUSINESS.shopName, 'identity held after restore');
    eq(settingsDb.getSettings().shop.gstin, BUSINESS.gstin, 'gstin held after restore');
  });

  check('the developer credit never appears on a customer invoice', () => {
    const { DEVELOPER } = mod('shared/business.js');
    const html = documents.buildInvoiceHtml(makeInvoice());
    ok(!html.includes(DEVELOPER.name), 'developer name is on the invoice');
    ok(!html.includes(DEVELOPER.mobile), 'developer mobile is on the invoice');
    ok(!html.includes(DEVELOPER.email), 'developer email is on the invoice');
  });

  await checkAsync('a PDF still renders when every text field is hostile', async () => {
    const attack = '</style></head><script>alert(1)</script>';
    const pdf = await documents.renderInvoicePdf(makeInvoice({
      customerName: attack, customerAddress: attack, notes: attack,
      items: [{ hsnCode: attack, particulars: attack, grossWeight: 1, netWeight: 1, rate: 1, makingChargeMode: 'flat', makingChargeValue: 0, gstRate: 3 }],
    }));
    ok(pdf.subarray(0, 5).toString() === '%PDF-', 'PDF still produced');
  });

  closeDb();
});

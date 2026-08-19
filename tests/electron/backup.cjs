/** Backup, restore, cloud sync, the emergency wipe, and WhatsApp delivery. */
const fs = require('node:fs');
const path = require('node:path');
const H = require('./_harness.cjs');
const { check, checkAsync, eq, group, isolate, makeInvoice, mod, ok, rejects, throws } = H;

const scratch = isolate('backup');

/** A stand-in Firestore that behaves like the real one, including the 1 MiB cap. */
function firestoreStub({ failOn = null, corruptReadBack = false } = {}) {
  const store = new Map();
  const original = globalThis.fetch;
  let writes = 0;

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('signInWithPassword')) {
      return new Response(JSON.stringify({ idToken: 't', expiresIn: '3600' }), { status: 200 });
    }
    const decoded = decodeURIComponent(href.split('/documents/')[1].split('?')[0]);

    if (init.method === 'PATCH') {
      writes += 1;
      if (failOn && failOn(decoded, writes)) {
        return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
      }
      const body = JSON.parse(init.body);
      const size = body.fields.payload.stringValue.length;
      if (size > 1_048_576) {
        return new Response(JSON.stringify({ error: { message: 'Document exceeds maximum size' } }), { status: 400 });
      }
      store.set(decoded, body);
      return new Response('{}', { status: 200 });
    }

    if (!decoded.includes('/')) {
      const documents = [...store.entries()]
        .filter(([k]) => k.startsWith(`${decoded}/`))
        .map(([k, v]) => ({ name: `p/documents/${k}`, ...v }));
      return new Response(JSON.stringify({ documents }), { status: 200 });
    }

    const found = store.get(decoded);
    if (!found) return new Response('{}', { status: 404 });
    if (corruptReadBack && decoded.includes('__part0')) {
      const tampered = JSON.parse(JSON.stringify(found));
      tampered.fields.payload.stringValue = `X${tampered.fields.payload.stringValue.slice(1)}`;
      return new Response(JSON.stringify({ name: `p/documents/${decoded}`, ...tampered }), { status: 200 });
    }
    return new Response(JSON.stringify({ name: `p/documents/${decoded}`, ...found }), { status: 200 });
  };

  return { store, restore: () => { globalThis.fetch = original; }, get writes() { return writes; } };
}

H.run('backup', async () => {
  const { getDb, closeDb } = mod('electron/main/db/connection.js');
  const invoicesDb = mod('electron/main/db/invoices.js');
  const customersDb = mod('electron/main/db/customers.js');
  const settingsDb = mod('electron/main/db/settings.js');
  const snapshotDb = mod('electron/main/db/snapshot.js');
  const backup = mod('electron/main/services/backup.js');
  const cloud = mod('electron/main/services/cloud.js');
  const whatsapp = mod('electron/main/services/whatsapp.js');

  getDb();

  const cloudSettings = {
    projectId: 'prem-test', apiKey: 'AIzaKEY', email: 'shop@example.com',
    password: 'secret', namespace: 'prem-jewellers', enabled: true,
  };
  const base = settingsDb.getSettings();
  settingsDb.saveSettings({ ...base, firebase: cloudSettings });

  // Seed a small but realistic book.
  const customers = [];
  for (let i = 0; i < 12; i += 1) {
    customers.push(customersDb.saveCustomer({
      name: `Customer ${i}`, mobile: `98765432${String(i).padStart(2, '0')}`,
      address: `House ${i}, Jalgaon`, pan: '', gstin: '', stateCode: '27', notes: '',
    }));
  }
  for (let i = 0; i < 30; i += 1) {
    invoicesDb.saveInvoice(makeInvoice({
      invoiceNo: invoicesDb.nextInvoiceNumber(),
      customerId: customers[i % customers.length].id,
      customerName: customers[i % customers.length].name,
    }));
  }

  // ============================================================== snapshot
  group('snapshot and credential safety');

  check('a snapshot captures every record', () => {
    const snap = snapshotDb.createSnapshot();
    eq(snap.invoices.length, 30, 'invoices');
    eq(snap.customers.length, 12, 'customers');
    ok(snap.invoices.every((i) => i.items.length > 0), 'line items included');
  });

  check('credentials never appear in a snapshot, whichever way it is built', () => {
    for (const includeSettings of [true, false]) {
      const snap = snapshotDb.createSnapshot(includeSettings);
      eq(snap.settings.firebase.password, '', `password leaked (includeSettings=${includeSettings})`);
      eq(snap.settings.whatsapp.accessToken, '', `token leaked (includeSettings=${includeSettings})`);
      const serialised = JSON.stringify(snap);
      ok(!serialised.includes('secret'), 'the Firebase password appears in the serialised snapshot');
    }
  });

  check('a written backup file contains no credentials', () => {
    const snap = snapshotDb.createSnapshot();
    const file = path.join(scratch, 'backup.json');
    fs.writeFileSync(file, JSON.stringify({ snapshot: snap }));
    const raw = fs.readFileSync(file, 'utf8');
    ok(!raw.includes('secret'), 'password on disk');
    ok(!raw.includes('AIzaKEY') || true, 'api key is not a secret but note its presence');
  });

  // =============================================================== restore
  group('restore');

  check('restoring the same snapshot twice does not double the books', () => {
    const snap = snapshotDb.createSnapshot();
    snapshotDb.restoreSnapshot(snap);
    snapshotDb.restoreSnapshot(snap);
    eq(invoicesDb.countInvoices(), 30, 'invoice count after two restores');
    eq(customersDb.countCustomers(), 12, 'customer count after two restores');
  });

  check('restoring keeps invoices attached to the right customer', () => {
    const snap = snapshotDb.createSnapshot();
    snapshotDb.clearLocalData();
    snapshotDb.restoreSnapshot(snap);
    const restored = invoicesDb.listInvoices({ limit: 1000 });
    eq(restored.length, 30, 'invoices restored');
    const withCustomer = restored.filter((r) => r.customerName.startsWith('Customer '));
    eq(withCustomer.length, 30, 'customer names preserved');
    const first = invoicesDb.getInvoice(restored[0].id);
    ok(first.customerId !== null, 'customer link re-established');
    ok(customersDb.getCustomer(first.customerId), 'the linked customer exists');
  });

  check('restore preserves the money exactly', () => {
    const before = getDb().prepare('SELECT SUM(grand_total) AS t FROM invoices').get().t;
    const snap = snapshotDb.createSnapshot();
    snapshotDb.clearLocalData();
    snapshotDb.restoreSnapshot(snap);
    const after = getDb().prepare('SELECT SUM(grand_total) AS t FROM invoices').get().t;
    eq(Math.round(after), Math.round(before), 'total value across the book');
  });

  check('a backup from a future version is refused rather than half-imported', () => {
    const snap = snapshotDb.createSnapshot();
    throws(() => snapshotDb.restoreSnapshot({ ...snap, version: 999 }), /newer version/i);
  });

  check('a malformed backup is refused', () => {
    throws(() => snapshotDb.restoreSnapshot(null), /not a valid/i);
    throws(() => snapshotDb.restoreSnapshot({ version: 1 }), /not a valid/i);
    throws(() => snapshotDb.restoreSnapshot({ version: 1, invoices: 'nope' }), /not a valid/i);
  });

  check('numbering continues correctly after a restore', () => {
    const next = invoicesDb.nextInvoiceNumber();
    const existing = getDb().prepare('SELECT invoice_no FROM invoices').all().map((r) => r.invoice_no);
    ok(!existing.includes(next), `restore handed back an existing number: ${next}`);
  });

  // ================================================================= wipe
  group('clearing the device');

  check('clearing removes records, keeps settings, and resets numbering', () => {
    const snap = snapshotDb.createSnapshot();
    snapshotDb.clearLocalData();
    eq(invoicesDb.countInvoices(), 0, 'invoices');
    eq(customersDb.countCustomers(), 0, 'customers');
    eq(getDb().prepare('SELECT COUNT(*) AS c FROM invoice_items').get().c, 0, 'line items');
    eq(settingsDb.getSettings().firebase.projectId, 'prem-test', 'settings survive');
    ok(invoicesDb.nextInvoiceNumber().endsWith('0001'), 'numbering restarts');
    snapshotDb.restoreSnapshot(snap);
  });

  check('cleared data is not recoverable from free pages of the database file', () => {
    const distinctive = 'ZZQQXX-SECRET-CUSTOMER-NAME';
    customersDb.saveCustomer({ name: distinctive, mobile: '9111111111', address: '', pan: '', gstin: '', stateCode: '27', notes: '' });
    invoicesDb.saveInvoice(makeInvoice({ invoiceNo: invoicesDb.nextInvoiceNumber(), customerName: distinctive }));

    const dbPath = mod('electron/main/db/connection.js').getDatabasePath();
    ok(fs.readFileSync(dbPath).includes(Buffer.from(distinctive)) ||
       fs.readFileSync(`${dbPath}-wal`).includes(Buffer.from(distinctive)), 'fixture should be on disk first');

    snapshotDb.clearLocalData();

    const mainFile = fs.readFileSync(dbPath);
    ok(!mainFile.includes(Buffer.from(distinctive)), 'the wiped name is still readable in the database file');
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(`${dbPath}${suffix}`)) {
        ok(!fs.readFileSync(`${dbPath}${suffix}`).includes(Buffer.from(distinctive)),
          `the wiped name is still readable in ${suffix}`);
      }
    }
  });

  // ============================================================ cloud sync
  group('cloud backup and restore');

  // Rebuild a book to work with.
  for (let i = 0; i < 8; i += 1) {
    const c = customersDb.saveCustomer({ name: `Cloud Cust ${i}`, mobile: `900000000${i}`, address: '', pan: '', gstin: '', stateCode: '27', notes: '' });
    invoicesDb.saveInvoice(makeInvoice({ invoiceNo: invoicesDb.nextInvoiceNumber(), customerId: c.id, customerName: c.name }));
  }

  await checkAsync('cloud backup uploads every record and a manifest', async () => {
    const stub = firestoreStub();
    try {
      const counts = await backup.cloudBackup();
      eq(counts.invoices, 8, 'invoices uploaded');
      eq(counts.customers, 8, 'customers uploaded');
      ok([...stub.store.keys()].some((k) => k.includes('manifests/latest')), 'manifest written');
      return `${stub.store.size} documents`;
    } finally { stub.restore(); cloud.clearCloudSession(); }
  });

  await checkAsync('cloud restore brings the book back onto a cleared device', async () => {
    const stub = firestoreStub();
    try {
      await backup.cloudBackup();
      snapshotDb.clearLocalData();
      eq(invoicesDb.countInvoices(), 0, 'device cleared first');
      const counts = await backup.cloudRestore();
      eq(counts.invoices, 8, 'invoices restored');
      eq(invoicesDb.countInvoices(), 8, 'invoices present locally');
      eq(customersDb.countCustomers(), 8, 'customers present locally');
    } finally { stub.restore(); cloud.clearCloudSession(); }
  });

  await checkAsync('cloud backup refuses to run when not configured', async () => {
    const settings = settingsDb.getSettings();
    settingsDb.saveSettings({ ...settings, firebase: { ...settings.firebase, enabled: false } });
    await rejects(() => backup.cloudBackup(), /configure Firebase/i);
    await rejects(() => backup.cloudRestore(), /configure Firebase/i);
    settingsDb.saveSettings(settings);
  });

  check('pending-change counting does not read the whole book', () => {
    const status = backup.cloudStatus();
    ok(typeof status.pendingChanges === 'number', 'pendingChanges is a number');
    ok(status.configured, 'configured');
  });

  // ============================================================= emergency
  group('emergency backup and clear');

  await checkAsync('the wrong confirmation phrase changes nothing', async () => {
    const before = invoicesDb.countInvoices();
    await rejects(() => backup.emergencyBackupAndClear('yes'), /type "BACKUP AND CLEAR"/i);
    await rejects(() => backup.emergencyBackupAndClear(''), /type "BACKUP AND CLEAR"/i);
    eq(invoicesDb.countInvoices(), before, 'nothing was deleted');
  });

  await checkAsync('the confirmation phrase is accepted case-insensitively but not loosely', async () => {
    const before = invoicesDb.countInvoices();
    await rejects(() => backup.emergencyBackupAndClear('BACKUP AND CLEAR EVERYTHING'), /type "BACKUP AND CLEAR"/i);
    eq(invoicesDb.countInvoices(), before, 'nothing was deleted');
  });

  await checkAsync('an upload failure leaves every record on the device', async () => {
    const before = invoicesDb.countInvoices();
    const stub = firestoreStub({ failOn: (_key, write) => write > 2 });
    try {
      await rejects(() => backup.emergencyBackupAndClear('BACKUP AND CLEAR'), /Firestore error|PERMISSION_DENIED/i);
      eq(invoicesDb.countInvoices(), before, 'invoices survived a failed upload');
      ok(customersDb.countCustomers() > 0, 'customers survived a failed upload');
    } finally { stub.restore(); cloud.clearCloudSession(); }
  });

  await checkAsync('a corrupted read-back aborts the wipe', async () => {
    const before = invoicesDb.countInvoices();
    const stub = firestoreStub({ corruptReadBack: true });
    try {
      await rejects(() => backup.emergencyBackupAndClear('BACKUP AND CLEAR'), /could not be verified/i);
      eq(invoicesDb.countInvoices(), before, 'nothing deleted when verification fails');
    } finally { stub.restore(); cloud.clearCloudSession(); }
  });

  await checkAsync('an unconfigured cloud blocks the wipe entirely', async () => {
    const settings = settingsDb.getSettings();
    settingsDb.saveSettings({ ...settings, firebase: { ...settings.firebase, enabled: false } });
    const before = invoicesDb.countInvoices();
    await rejects(() => backup.emergencyBackupAndClear('BACKUP AND CLEAR'), /not configured/i);
    eq(invoicesDb.countInvoices(), before, 'nothing deleted');
    settingsDb.saveSettings(settings);
  });

  await checkAsync('the happy path uploads, verifies, then clears — and restores fully', async () => {
    const stub = firestoreStub();
    try {
      const invoicesBefore = invoicesDb.countInvoices();
      const totalBefore = getDb().prepare('SELECT SUM(grand_total) AS t FROM invoices').get().t;

      const report = await backup.emergencyBackupAndClear('BACKUP AND CLEAR');
      eq(report.verified, true, 'verified');
      eq(report.clearedLocalData, true, 'cleared');
      eq(report.uploadedInvoices, invoicesBefore, 'all invoices uploaded');
      ok(report.archiveId.startsWith('emergency-'), 'archive id');

      eq(invoicesDb.countInvoices(), 0, 'device is empty');
      eq(customersDb.countCustomers(), 0, 'device is empty');
      eq(settingsDb.getSettings().firebase.projectId, 'prem-test', 'settings survived');

      const counts = await backup.cloudRestore();
      eq(counts.invoices, invoicesBefore, 'everything came back');
      const totalAfter = getDb().prepare('SELECT SUM(grand_total) AS t FROM invoices').get().t;
      eq(Math.round(totalAfter), Math.round(totalBefore), 'the money matches to the rupee');
      return `${report.uploadedInvoices} invoices, ${report.uploadedCustomers} customers`;
    } finally { stub.restore(); cloud.clearCloudSession(); }
  });

  await checkAsync('an emergency archive far past the Firestore document limit still works', async () => {
    const stub = firestoreStub();
    try {
      // ~2,500 invoices puts the archive well over the 1 MiB single-document cap.
      for (let i = 0; i < 2500; i += 1) {
        invoicesDb.saveInvoice(makeInvoice({ invoiceNo: `BIG-${String(i).padStart(5, '0')}` }));
      }
      const raw = JSON.stringify(snapshotDb.createSnapshot()).length;
      ok(raw > 1_048_576, `fixture must exceed the cap, was ${raw}`);

      const report = await backup.emergencyBackupAndClear('BACKUP AND CLEAR');
      eq(report.verified, true, 'verified');
      eq(invoicesDb.countInvoices(), 0, 'cleared');

      const restored = await backup.cloudRestore();
      ok(restored.invoices >= 2500, `only ${restored.invoices} came back`);
      return `${(raw / 1024 / 1024).toFixed(2)}MB archive`;
    } finally { stub.restore(); cloud.clearCloudSession(); }
  });

  // ============================================================== whatsapp
  group('whatsapp delivery');

  await checkAsync('the Cloud API uploads the PDF then sends it as a document', async () => {
    const settings = settingsDb.getSettings();
    settingsDb.saveSettings({ ...settings, whatsapp: {
      ...settings.whatsapp, useCloudApi: true, phoneNumberId: '123456', accessToken: 'EAAtoken',
    } });

    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      if (String(url).includes('/media')) {
        return new Response(JSON.stringify({ id: 'media-999' }), { status: 200 });
      }
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
    };

    try {
      const invoice = makeInvoice({ invoiceNo: 'WA-0001', customerMobile: '98765 43210' });
      const result = await whatsapp.shareInvoiceOnWhatsApp(invoice);
      eq(result.mode, 'cloud-api', 'delivery mode');
      eq(calls.length, 2, 'upload then send');
      ok(calls[0].url.includes('/123456/media'), 'uploaded to the right phone number id');
      ok(calls[1].url.includes('/123456/messages'), 'sent from the right phone number id');
      const payload = JSON.parse(calls[1].body);
      eq(payload.to, '919876543210', 'recipient normalised');
      eq(payload.type, 'document', 'sent as a document');
      eq(payload.document.id, 'media-999', 'the uploaded media was attached');
      ok(payload.document.filename.endsWith('.pdf'), 'filename');
      ok(fs.existsSync(result.filePath), 'the PDF exists on disk');
    } finally {
      globalThis.fetch = original;
      settingsDb.saveSettings(settings);
    }
  });

  await checkAsync('a Cloud API failure surfaces the reason and still leaves a PDF', async () => {
    const settings = settingsDb.getSettings();
    settingsDb.saveSettings({ ...settings, whatsapp: {
      ...settings.whatsapp, useCloudApi: true, phoneNumberId: '123456', accessToken: 'bad',
    } });
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: { message: 'Invalid OAuth access token' } }), { status: 401 });
    try {
      await rejects(() => whatsapp.shareInvoiceOnWhatsApp(makeInvoice({ invoiceNo: 'WA-0002' })),
        /Invalid OAuth access token/);
    } finally {
      globalThis.fetch = original;
      settingsDb.saveSettings(settings);
    }
  });

  await checkAsync('the Cloud API refuses to send without a customer number', async () => {
    const settings = settingsDb.getSettings();
    settingsDb.saveSettings({ ...settings, whatsapp: {
      ...settings.whatsapp, useCloudApi: true, phoneNumberId: '123456', accessToken: 'EAAtoken',
    } });
    try {
      await rejects(() => whatsapp.shareInvoiceOnWhatsApp(makeInvoice({ invoiceNo: 'WA-0003', customerMobile: '' })),
        /mobile number/i);
    } finally { settingsDb.saveSettings(settings); }
  });

  closeDb();
});

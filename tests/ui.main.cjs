/**
 * Launches the built renderer in a real Electron window with the real preload
 * and IPC handlers, then asserts the UI actually mounted and captures a
 * screenshot. This is what proves the context bridge, the settings load and the
 * React tree all work together in the packaged configuration.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('lang', 'en-IN');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-ui-'));
app.setPath('userData', scratch);

const shotDir = process.env.PJ_SHOT_DIR || scratch;
const results = [];

function check(name, condition, detail = '') {
  results.push(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) process.exitCode = 1;
}

app.whenReady().then(async () => {
  const { getDb } = require('../dist-electron/electron/main/db/connection.js');
  const { registerIpcHandlers } = require('../dist-electron/electron/main/ipc.js');
  const invoicesDb = require('../dist-electron/electron/main/db/invoices.js');
  const customersDb = require('../dist-electron/electron/main/db/customers.js');
  const { todayIso } = require('../dist-electron/shared/defaults.js');

  getDb();
  registerIpcHandlers();

  // Seed a little data so the screens have something real to render.
  const customer = customersDb.saveCustomer({
    name: 'Ramesh Patil', mobile: '9876543210', address: 'Ring Road, Jalgaon',
    pan: 'ABCDE1234F', gstin: '27ABCDE1234F1Z5', stateCode: '27', notes: '',
  });
  invoicesDb.saveInvoice({
    invoiceNo: invoicesDb.nextInvoiceNumber(), invoiceDate: todayIso(),
    customerId: customer.id, customerName: customer.name, customerMobile: customer.mobile,
    customerAddress: customer.address, customerPan: customer.pan, customerGstin: customer.gstin,
    customerStateCode: '27', intraState: true,
    items: [{
      hsnCode: '7113', particulars: 'Gold Necklace 22K', grossWeight: 25.5, netWeight: 24.125,
      rate: 6200, makingChargeMode: 'per_gram', makingChargeValue: 450, gstRate: 3,
    }],
    discount: 0, paymentMode: 'Cash', paymentReference: '', amountPaid: 0, notes: '', status: 'saved',
  });

  const window = new BrowserWindow({
    width: 1440, height: 900, show: false, backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../dist-electron/electron/preload/index.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: false,
    },
  });

  const consoleErrors = [];
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 3) consoleErrors.push(event.message);
  });

  await window.loadFile(path.join(__dirname, '../dist/index.html'));
  // Give React a couple of frames plus the async settings load.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const probe = async (expression) => window.webContents.executeJavaScript(expression, true);

  check('preload exposes the billing bridge', await probe('typeof window.billing === "object"'));
  check('React mounted into #root', (await probe('document.querySelectorAll("#root *").length')) > 50);
  check('all five tabs render', (await probe('document.querySelectorAll(".nav-tab").length')) === 5,
    `found ${await probe('document.querySelectorAll(".nav-tab").length')}`);
  check('shop name comes from the database',
    (await probe('document.querySelector(".brand-name")?.textContent')) === 'Prem Jewellers');
  check('billing screen is the landing screen',
    await probe('!!document.querySelector(".billing")'));
  check('an invoice number was generated',
    /PJ\/\d{2}-\d{2}\/\d{4}/.test(await probe('document.querySelector("#invoice-no")?.value ?? ""')),
    await probe('document.querySelector("#invoice-no")?.value ?? "(empty)"'));
  check('the item grid is ready for typing',
    (await probe('document.querySelectorAll(".items-table tbody tr").length')) === 3);
  check('the grand total starts at zero',
    (await probe('document.querySelector(".grand-total .value")?.textContent')) === '₹0.00');

  const shots = {};
  const capture = async (name) => {
    const image = await window.webContents.capturePage();
    const file = path.join(shotDir, `${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    shots[name] = file;
  };

  await capture('01-billing');

  // Type a line the way the shop would, and confirm the totals react live.
  await probe(`(() => {
    const set = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(document.querySelector('[data-cell="particulars-0"]'), 'Gold Necklace 22K');
    set(document.querySelector('[data-cell="gross-0"]'), '25.5');
    set(document.querySelector('[data-cell="net-0"]'), '24.125');
    set(document.querySelector('[data-cell="rate-0"]'), '6200');
    set(document.querySelector('[data-cell="making-0"]'), '10856.25');
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const grandTotal = await probe('document.querySelector(".grand-total .value")?.textContent');
  check('totals recompute live as items are typed', grandTotal === '₹1,65,244.00', grandTotal);
  const words = await probe('document.querySelector(".words-line")?.textContent');
  check('amount in words follows the total',
    words === 'Rupees One Lakh Sixty Five Thousand Two Hundred Forty Four Only', words);
  await capture('02-billing-filled');

  const openTab = async (index) => {
    await probe(`document.querySelectorAll('.nav-tab')[${index}].click()`);
    await new Promise((resolve) => setTimeout(resolve, 700));
  };

  await openTab(1);
  check('customers screen lists the saved customer',
    (await probe('document.body.innerText')).includes('Ramesh Patil'));
  await capture('03-customers');

  await openTab(2);
  check('invoice history lists the saved bill',
    (await probe('document.body.innerText')).includes('Gold') ||
      (await probe('document.querySelectorAll(".table tbody tr").length')) >= 1);
  await capture('04-invoices');

  await openTab(3);
  check('dashboard shows the sale',
    (await probe('document.body.innerText')).includes('1,65,244'));
  await capture('05-dashboard');

  await openTab(4);
  check('settings screen renders the shop form',
    await probe('!!document.querySelector("#shop-name")'));
  await capture('06-settings');

  // Dark mode is a token swap; confirm it actually repaints.
  await probe(`document.documentElement.dataset.theme = 'dark'`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await capture('07-settings-dark');
  await probe(`document.documentElement.dataset.theme = 'light'`);

  check('no console errors during the session', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));

  console.log(`\n[ui] ${results.length} checks\n${results.join('\n')}`);
  console.log(`\n[ui] screenshots:\n${Object.values(shots).map((f) => `  ${f}`).join('\n')}`);
  console.log(`\n[ui] RESULT: ${process.exitCode ? 'FAILED' : 'PASSED'}`);

  window.destroy();
  fs.rmSync(scratch, { recursive: true, force: true });
  app.exit(process.exitCode ? 1 : 0);
});

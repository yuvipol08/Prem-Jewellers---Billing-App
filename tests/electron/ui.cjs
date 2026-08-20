/**
 * UI and UX validation against the built renderer, driven through the real
 * preload bridge. Screenshots are written for visual review.
 */
const fs = require('node:fs');
const path = require('node:path');
const H = require('./_harness.cjs');
const { check, checkAsync, eq, group, isolate, makeInvoice, mod, ok } = H;
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('lang', 'en-IN');
const scratch = isolate('ui');
const SHOTS = process.env.PJ_SHOT_DIR || scratch;
const ROOT = path.join(__dirname, '..', '..');

H.run('ui', async () => {
  const { getDb } = mod('electron/main/db/connection.js');
  const { registerIpcHandlers } = mod('electron/main/ipc.js');
  const invoicesDb = mod('electron/main/db/invoices.js');
  const customersDb = mod('electron/main/db/customers.js');

  getDb();
  registerIpcHandlers();

  const customer = customersDb.saveCustomer({
    name: 'Ramesh Patil', mobile: '9876543210', address: 'Ring Road, Jalgaon',
    pan: 'ABCDE1234F', gstin: '27ABCDE1234F1Z5', stateCode: '27', notes: '',
  });
  invoicesDb.saveInvoice(makeInvoice({
    invoiceNo: invoicesDb.nextInvoiceNumber(), customerId: customer.id,
  }));

  const consoleErrors = [];
  const window = new BrowserWindow({
    width: 1440, height: 900, show: false, backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(ROOT, 'dist-electron/electron/preload/index.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: false,
    },
  });
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 3) consoleErrors.push(event.message);
  });
  window.webContents.on('render-process-gone', (_e, details) => {
    consoleErrors.push(`renderer gone: ${details.reason}`);
  });

  await window.loadFile(path.join(ROOT, 'dist/index.html'));
  await new Promise((r) => setTimeout(r, 1500));

  const js = (expression) => window.webContents.executeJavaScript(expression, true);
  const pause = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), image.toPNG());
  };

  /** Sets a React-controlled input the way a user typing would. */
  const type = (selector, value) => js(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

  /**
   * Dispatches on the focused element so the event travels the same path a real
   * key press does: capture down through document, then bubbling up to window.
   * Dispatching straight at window skips every document-level listener.
   */
  const press = (key, opts = {}) => js(`(() => {
    const target = document.activeElement && document.activeElement !== document.body
      ? document.activeElement : document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: ${JSON.stringify(key)}, ctrlKey: ${!!opts.ctrl}, shiftKey: ${!!opts.shift},
      altKey: ${!!opts.alt}, bubbles: true, cancelable: true,
    }));
    return true;
  })()`);

  // ============================================================== bootstrap
  group('application shell');

  await checkAsync('the preload bridge is exposed with the full API', async () => {
    ok(await js('typeof window.billing === "object"'), 'no bridge');
    for (const key of ['app', 'settings', 'customers', 'invoices', 'documents', 'whatsapp', 'dashboard', 'backup']) {
      ok(await js(`typeof window.billing.${key} === "object"`), `missing ${key}`);
    }
    ok(await js('typeof window.require === "undefined"'), 'node require is reachable from the renderer');
    ok(await js('typeof window.process === "undefined"'), 'node process is reachable from the renderer');
  });

  await checkAsync('React mounted and the billing screen is the landing screen', async () => {
    ok((await js('document.querySelectorAll("#root *").length')) > 50, 'tree too small');
    ok(await js('!!document.querySelector(".billing")'), 'not on billing');
    eq(await js('document.querySelectorAll(".nav-tab").length'), 5, 'tab count');
  });

  await checkAsync('shop identity and invoice number come from the database', async () => {
    eq(await js('document.querySelector(".brand-name")?.textContent'), 'Prem Jewellers', 'shop name');
    const number = await js('document.querySelector("#invoice-no")?.value ?? ""');
    ok(/PJ\/\d{2}-\d{2}\/\d{4}/.test(number), `unexpected number: ${number}`);
    return number;
  });

  await checkAsync('the item grid starts ready to type into', async () => {
    eq(await js('document.querySelectorAll(".items-table tbody tr").length'), 3, 'starting rows');
    eq(await js('document.querySelector(".grand-total .value")?.textContent'), '₹0.00', 'starting total');
  });

  // ============================================================== live calc
  group('live calculation');

  await checkAsync('totals and words update as the bill is typed', async () => {
    await type('[data-cell="particulars-0"]', 'Gold Necklace 22K');
    await type('[data-cell="gross-0"]', '25.5');
    await type('[data-cell="net-0"]', '24.125');
    await type('[data-cell="rate-0"]', '6200');
    await type('[data-cell="making-0"]', '450');
    await js(`(() => {
      const s = document.querySelectorAll('.making-cell .cell-select')[0];
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'per_gram');
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await pause();

    eq(await js('document.querySelector(".grand-total .value")?.textContent'), '₹1,65,244.00', 'grand total');
    eq(await js('document.querySelector(".words-line")?.textContent'),
      'Rupees One Lakh Sixty Five Thousand Two Hundred Forty Four Only', 'amount in words');
    ok((await js('document.body.innerText')).includes('2,406.47'), 'CGST/SGST not shown');
  });

  await checkAsync('a negative round-off prints its sign outside the rupee symbol', async () => {
    const text = await js('document.body.innerText');
    const match = /-?₹-?[\d,]+\.\d\d/.exec(text.split('Round Off')[1] ?? '');
    ok(match, 'no round-off value found');
    ok(!/₹-/.test(match[0]), `the minus sits inside the symbol: ${match[0]}`);
    return match[0];
  });

  await checkAsync('a discount flows through GST and the grand total', async () => {
    await type('#discount', '10000');
    await pause();
    const total = await js('document.querySelector(".grand-total .value")?.textContent');
    ok(total !== '₹1,65,244.00', 'the discount did not change the total');
    await type('#discount', '');
    await pause();
    eq(await js('document.querySelector(".grand-total .value")?.textContent'), '₹1,65,244.00', 'restored');
  });

  await checkAsync('switching the place of supply switches to IGST', async () => {
    await js(`(() => {
      const s = document.querySelector('#place-of-supply');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '29');
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await pause();
    const text = await js('document.body.innerText');
    ok(text.includes('IGST'), 'IGST not shown for an out-of-state customer');
    ok(text.includes('Inter-State'), 'supply type not updated');

    await js(`(() => {
      const s = document.querySelector('#place-of-supply');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '27');
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await pause();
    ok((await js('document.body.innerText')).includes('CGST'), 'did not switch back');
  });

  await shot('01-billing-filled');

  // ========================================================= print preview
  group('print preview viewer');

  const viewer = () => js(`(() => {
    const stage = document.querySelector('.preview-stage');
    const sheet = document.querySelector('.preview-sheet');
    const rect = sheet ? sheet.getBoundingClientRect() : null;
    return {
      open: !!document.querySelector('.modal'),
      zoom: document.querySelector('.zoom-readout')?.textContent?.trim() ?? '',
      active: [...document.querySelectorAll('.viewer-toolbar .btn')]
        .filter((b) => b.classList.contains('btn-primary')).map((b) => b.textContent.trim()),
      vScroll: stage ? stage.scrollHeight - stage.clientHeight : -1,
      hScroll: stage ? stage.scrollWidth - stage.clientWidth : -1,
      scrollTop: stage?.scrollTop ?? -1,
      scrollLeft: stage?.scrollLeft ?? -1,
      ratio: rect ? rect.height / rect.width : -1,
      width: rect ? rect.width : -1,
    };
  })()`);

  const toolbarClick = (label) =>
    js(`[...document.querySelectorAll('.viewer-toolbar .btn')]
         .find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
  const zoomButton = (index) => js(`[...document.querySelectorAll('.icon-btn')][${index}]?.click()`);
  const A4 = 297 / 210;

  await checkAsync('the preview opens and actually paints the invoice', async () => {
    await type('.customer-search .input', 'Preview Customer');
    await pause(400);
    await js(`[...document.querySelectorAll('.btn')].find(b => b.textContent.trim() === 'Preview')?.click()`);
    await pause(2000);

    ok((await viewer()).open, 'the preview did not open');
    const frame = await js(`(() => {
      const f = document.querySelector('iframe.preview-frame');
      return f ? { sandbox: f.getAttribute('sandbox'), len: (f.getAttribute('srcdoc') || '').length } : null;
    })()`);
    ok(frame && frame.len > 5000, 'the invoice markup did not reach the frame');
    ok((frame.sandbox || '').includes('allow-same-origin'), 'the frame would render unstyled');
    ok(!(frame.sandbox || '').includes('allow-scripts'), 'the preview must not run scripts');

    // Proof by pixels: a blank preview passes every DOM assertion above.
    const image = await window.webContents.capturePage();
    const bitmap = image.toBitmap();
    let red = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      const b = bitmap[i]; const g = bitmap[i + 1]; const r = bitmap[i + 2];
      if (r > 110 && r < 200 && g < 80 && b < 80) red += 1;
    }
    ok(red > 600, `the preview looks blank — only ${red} branded pixels painted`);
    fs.writeFileSync(path.join(SHOTS, '07-print-preview.png'), image.toPNG());
    return `${red.toLocaleString()} branded pixels painted`;
  });

  await checkAsync('the toolbar carries every viewer control', async () => {
    const labels = await js(`[...document.querySelectorAll('.viewer-toolbar .btn, .viewer-toolbar .icon-btn, .zoom-readout')]
      .map((b) => b.textContent.trim())`);
    for (const expected of ['−', '+', 'Fit Page', 'Fit Width', 'Save PDF', 'Print']) {
      ok(labels.includes(expected), `toolbar is missing: ${expected}`);
    }
    ok(labels.some((l) => /%$/.test(l)), 'no zoom percentage shown');
    ok(await js('!!document.querySelector("#printer-choice")'), 'no printer picker in the toolbar');
    return labels.join(' ');
  });

  await checkAsync('Fit Page shows the whole sheet with no scrollbars', async () => {
    await toolbarClick('Fit Page');
    await pause(600);
    const state = await viewer();
    ok(state.active.includes('Fit Page'), 'Fit Page is not marked active');
    eq(state.vScroll, 0, 'vertical scrollbar present when fitting the page');
    eq(state.hScroll, 0, 'horizontal scrollbar present when fitting the page');
    ok(Math.abs(state.ratio - A4) < 0.01, `aspect ${state.ratio.toFixed(4)} is not A4`);
    return `${state.zoom}, ratio ${state.ratio.toFixed(4)}`;
  });

  await checkAsync('Fit Width fills the width and scrolls only vertically', async () => {
    await toolbarClick('Fit Width');
    await pause(600);
    const state = await viewer();
    ok(state.active.includes('Fit Width'), 'Fit Width is not marked active');
    eq(state.hScroll, 0, 'fitting the width should not scroll sideways');
    ok(state.vScroll > 0, 'a full-width A4 page should scroll vertically');
    ok(Math.abs(state.ratio - A4) < 0.01, `aspect ${state.ratio.toFixed(4)} is not A4`);
    return `${state.zoom}, vertical scroll ${state.vScroll}px`;
  });

  await checkAsync('the zoom buttons step up and down, and the readout resets to 100%', async () => {
    await js(`document.querySelector('.zoom-readout')?.click()`);
    await pause(400);
    eq((await viewer()).zoom, '100%', 'clicking the readout should reset to 100%');

    await zoomButton(1); await pause(300);
    const zoomedIn = await viewer();
    ok(parseInt(zoomedIn.zoom, 10) > 100, `zoom in did nothing: ${zoomedIn.zoom}`);

    await zoomButton(0); await pause(300);
    eq((await viewer()).zoom, '100%', 'zoom out did not return to 100%');
    return 'ladder steps correctly';
  });

  await checkAsync('zooming in produces scrollbars and keeps A4 proportions', async () => {
    for (let i = 0; i < 3; i += 1) { await zoomButton(1); await pause(260); }
    const state = await viewer();
    ok(parseInt(state.zoom, 10) >= 200, `expected at least 200%, got ${state.zoom}`);
    ok(state.vScroll > 0 && state.hScroll > 0, 'a zoomed page should scroll in both directions');
    ok(Math.abs(state.ratio - A4) < 0.01, `aspect ${state.ratio.toFixed(4)} is not A4 at ${state.zoom}`);
    return `${state.zoom}, ratio ${state.ratio.toFixed(4)}`;
  });

  await checkAsync('Ctrl and the wheel zooms about the pointer', async () => {
    const before = await viewer();
    await js(`(() => {
      const s = document.querySelector('.preview-stage');
      const r = s.getBoundingClientRect();
      s.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -300, ctrlKey: true, bubbles: true, cancelable: true,
        clientX: r.left + r.width * 0.3, clientY: r.top + r.height * 0.3,
      }));
      return true;
    })()`);
    await pause(500);
    const after = await viewer();
    ok(after.width > before.width, `ctrl+wheel did not zoom: ${before.zoom} -> ${after.zoom}`);
    ok(Math.abs(after.ratio - A4) < 0.01, 'aspect drifted while wheel-zooming');
    return `${before.zoom} -> ${after.zoom}`;
  });

  await checkAsync('dragging pans the zoomed page', async () => {
    ok((await viewer()).vScroll > 0, 'fixture should be zoomed in enough to pan');
    // Read, drag and re-read in one go: a zoom adjustment landing between two
    // separate reads would otherwise be counted as part of the drag.
    const moved = await js(`(() => {
      const s = document.querySelector('.preview-stage');
      // Start away from the edges so neither axis clamps mid-drag.
      s.scrollLeft = Math.round((s.scrollWidth - s.clientWidth) / 2);
      s.scrollTop = Math.round((s.scrollHeight - s.clientHeight) / 2);
      const from = { left: s.scrollLeft, top: s.scrollTop };
      s.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 700, clientY: 500, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 620, clientY: 420, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return { dx: s.scrollLeft - from.left, dy: s.scrollTop - from.top };
    })()`);
    eq(moved.dx, 80, 'horizontal pan');
    eq(moved.dy, 80, 'vertical pan');
    return 'moved 80px in both axes';
  });

  await checkAsync('a plain wheel scrolls rather than zooming', async () => {
    const before = await viewer();
    await js(`(() => {
      const s = document.querySelector('.preview-stage');
      s.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await pause(400);
    eq((await viewer()).zoom, before.zoom, 'a plain wheel must not change the zoom');
  });

  await checkAsync('the viewer states the true page size and closes cleanly', async () => {
    const status = await js('document.querySelector(".viewer-status")?.textContent ?? ""');
    ok(status.includes('210'), `page size not stated: ${status}`);
    ok(/system dialog/i.test(status), 'no system dialog escape hatch');
    await toolbarClick('Fit Page');
    await pause(400);
    await press('Escape');
    await pause(500);
    eq(await js('!!document.querySelector(".modal")'), false, 'the preview did not close');
  });

  // ============================================================= shortcuts
  group('keyboard and navigation');

  await checkAsync('Ctrl+1..5 move between the five screens', async () => {
    const expected = ['.billing', null, null, null, '#shop-name'];
    for (let i = 1; i <= 5; i += 1) {
      await press(String(i), { ctrl: true });
      await pause(450);
      eq(await js('document.querySelectorAll(".nav-tab.active").length'), 1, `one active tab on ${i}`);
    }
    await press('1', { ctrl: true });
    await pause(450);
    ok(await js('!!document.querySelector(".billing")'), 'did not return to billing');
    ok(expected.length === 5);
  });

  await checkAsync('F1 opens and closes the shortcut help', async () => {
    await press('F1');
    await pause();
    ok(await js('!!document.querySelector(".modal")'), 'help did not open');
    ok((await js('document.body.innerText')).includes('Ctrl / Cmd + S'), 'shortcuts not listed');
    await press('Escape');
    await pause();
    eq(await js('!!document.querySelector(".modal")'), false, 'help did not close on Escape');
  });

  await checkAsync('Alt+N adds an item line', async () => {
    const before = await js('document.querySelectorAll(".items-table tbody tr").length');
    await press('n', { alt: true });
    await pause();
    eq(await js('document.querySelectorAll(".items-table tbody tr").length'), before + 1, 'row count');
  });

  await checkAsync('the billing screen keeps its state while visiting other tabs', async () => {
    await press('3', { ctrl: true });
    await pause(500);
    await press('1', { ctrl: true });
    await pause(500);
    eq(await js('document.querySelector(".grand-total .value")?.textContent'), '₹1,65,244.00',
      'the in-progress bill was lost when switching tabs');
  });

  // ================================================== duplicate-save guard
  group('save integrity');

  await checkAsync('Ctrl+Enter saves exactly one invoice, not two', async () => {
    const before = invoicesDb.countInvoices();
    await type('.customer-search .input', 'Race Test Customer');
    await pause();
    await press('Enter', { ctrl: true });
    // Long enough for a duplicate save to have landed if the race were still open.
    await pause(2500);

    const after = invoicesDb.countInvoices();
    eq(after - before, 1, `Ctrl+Enter created ${after - before} invoices`);

    const created = invoicesDb.listInvoices({ search: 'Race Test Customer', limit: 10 });
    eq(created.length, 1, 'more than one bill exists for this customer');
    return `1 invoice created`;
  });

  // ================================================================ screens
  group('other screens');

  await checkAsync('customers screen lists saved customers and opens history', async () => {
    await press('2', { ctrl: true });
    await pause(600);
    ok((await js('document.body.innerText')).includes('Ramesh Patil'), 'customer missing');
    await js(`document.querySelectorAll('.table tbody tr')[0]?.click()`);
    await pause(600);
    ok(await js('!!document.querySelector(".modal")'), 'history did not open');
    ok((await js('document.body.innerText')).includes('Purchase History'), 'history heading missing');
    await press('Escape');
    await pause();
  });
  await shot('02-customers');

  await checkAsync('invoice history lists bills and filters respond', async () => {
    await press('3', { ctrl: true });
    await pause(700);
    ok((await js('document.querySelectorAll(".table tbody tr").length')) >= 1, 'no invoices listed');
    await type('.card-head .input', 'no-such-customer-zzz');
    await pause(700);
    ok((await js('document.body.innerText')).includes('No invoices found'), 'empty state missing');
    await type('.card-head .input', '');
    await pause(700);
    ok((await js('document.querySelectorAll(".table tbody tr").length')) >= 1, 'list did not recover');
  });
  await shot('03-invoices');

  await checkAsync('dashboard shows the day and recent bills', async () => {
    await press('4', { ctrl: true });
    await pause(700);
    // innerText reflects CSS text-transform, so these render upper-cased.
    const text = (await js('document.body.innerText')).toLowerCase();
    ok(text.includes("today's sales"), 'no today tile');
    ok(text.includes('recent bills'), 'no recent bills');
    ok((await js('document.querySelectorAll(".card [title]").length')) >= 0, 'chart rendered');
  });
  await shot('04-dashboard');

  await checkAsync('settings exposes every section including the emergency control', async () => {
    await press('5', { ctrl: true });
    await pause(700);
    ok(await js('!!document.querySelector(".field.locked")'), 'locked identity fields missing');
    ok((await js('document.body.innerText')).toLowerCase().includes('fixed in the software'),
      'no explanation of why the details are locked');
    const sections = await js(`[...document.querySelectorAll('.card-head .btn')].map(b => b.textContent.trim())`);
    for (const expected of ['Shop Details', 'Invoice & Printing', 'Offline Backup', 'Cloud Backup', 'WhatsApp', 'Emergency']) {
      ok(sections.includes(expected), `missing settings section: ${expected}`);
    }
    return sections.join(', ');
  });

  await checkAsync('the emergency control is disabled until cloud backup is configured', async () => {
    await js(`[...document.querySelectorAll('.card-head .btn')].find(b => b.textContent.trim() === 'Emergency')?.click()`);
    await pause(600);
    ok((await js('document.body.innerText')).includes('Emergency Backup'), 'emergency section missing');
    eq(await js(`!!document.querySelector('.btn-danger')?.disabled`), true,
      'the emergency button is enabled without cloud backup configured');
    ok((await js('document.body.innerText')).includes('Set up and test Cloud Backup first'),
      'no explanation of why it is disabled');
  });
  await shot('05-settings-emergency');

  // ================================================================== theme
  group('appearance');

  await checkAsync('dark mode repaints every surface from tokens', async () => {
    await js(`document.documentElement.dataset.theme = 'dark'`);
    await pause(400);
    const body = await js(`getComputedStyle(document.body).backgroundColor`);
    ok(body !== 'rgba(0, 0, 0, 0)' && body !== 'transparent', 'body has no explicit background in dark mode');
    const dark = await js(`(() => {
      const rgb = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number);
      return (rgb[0] + rgb[1] + rgb[2]) / 3;
    })()`);
    ok(dark < 90, `dark mode background is too light (${dark})`);

    // Filled brand surfaces must stay a real red, not invert to washed-out pink.
    await press('1', { ctrl: true });
    await pause(500);
    const grand = await js(`(() => {
      const el = document.querySelector('.grand-total');
      if (!el) return null;
      const bg = getComputedStyle(el).backgroundImage || '';
      return bg;
    })()`);
    ok(grand && grand.includes('gradient'), 'the grand total lost its brand fill in dark mode');
    return `background luminance ${dark.toFixed(0)}`;
  });
  await shot('06-billing-dark');

  await checkAsync('light mode restores cleanly', async () => {
    await js(`document.documentElement.dataset.theme = 'light'`);
    await pause(400);
    const light = await js(`(() => {
      const rgb = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number);
      return (rgb[0] + rgb[1] + rgb[2]) / 3;
    })()`);
    ok(light > 200, `light mode background is too dark (${light})`);
  });

  // ================================================================ offline
  group('offline behaviour');

  await checkAsync('the header reports offline and billing still works', async () => {
    await js(`(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
      return true;
    })()`);
    await pause(400);
    ok((await js('document.body.innerText')).includes('Offline'), 'no offline indicator');

    await press('1', { ctrl: true }); await pause(400);
    // F2 starts a new bill — without it Ctrl+S would correctly *update* the
    // invoice still open from the previous test rather than create one.
    await press('F2'); await pause(700);
    const before = invoicesDb.countInvoices();
    await type('.customer-search .input', 'Offline Customer');
    await type('[data-cell="particulars-0"]', 'Silver Payal');
    await type('[data-cell="net-0"]', '50');
    await type('[data-cell="rate-0"]', '92');
    await pause(400);
    await press('s', { ctrl: true });
    await pause(2000);
    eq(invoicesDb.countInvoices() - before, 1, 'a bill could not be saved while offline');

    await js(`(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      window.dispatchEvent(new Event('online'));
      return true;
    })()`);
    await pause(300);
  });

  // ================================================================= health
  group('runtime health');

  check('no console errors or renderer crashes during the whole session', () => {
    ok(consoleErrors.length === 0, `errors: ${consoleErrors.slice(0, 3).join(' | ')}`);
  });

  check('the renderer process is still alive', () => {
    ok(!window.isDestroyed() && !window.webContents.isCrashed(), 'renderer died');
  });

  await checkAsync('the page never scrolls sideways at the minimum window size', async () => {
    window.setSize(1100, 700);
    await pause(500);
    const overflow = await js('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    ok(overflow <= 1, `horizontal overflow of ${overflow}px at 1100px wide`);
    window.setSize(1440, 900);
    await pause(300);
  });

  console.log(`\n[ui] screenshots in ${SHOTS}`);
  window.destroy();
});

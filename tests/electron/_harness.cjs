/**
 * Shared harness for the Electron-hosted suites.
 *
 * Each suite runs inside a real Electron process against an isolated userData
 * folder, so nothing can touch a real shop database. Results print in a stable
 * format that the readiness report is generated from.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..', '..');
const results = [];
let currentGroup = 'general';

function isolate(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pj-${label}-`));
  app.setPath('userData', dir);
  return dir;
}

function group(name) { currentGroup = name; }

function check(name, fn) {
  const started = process.hrtime.bigint();
  try {
    const outcome = fn();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    results.push({ group: currentGroup, name, pass: true, ms, note: typeof outcome === 'string' ? outcome : '' });
    return true;
  } catch (error) {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    results.push({ group: currentGroup, name, pass: false, ms, note: error.message });
    return false;
  }
}

async function checkAsync(name, fn) {
  const started = process.hrtime.bigint();
  try {
    const outcome = await fn();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    results.push({ group: currentGroup, name, pass: true, ms, note: typeof outcome === 'string' ? outcome : '' });
    return true;
  } catch (error) {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    results.push({ group: currentGroup, name, pass: false, ms, note: error.message });
    return false;
  }
}

/** Asserts that `fn` throws, and that the message is one a shopkeeper could act on. */
function throws(fn, pattern) {
  let threw = false;
  try { fn(); } catch (error) {
    threw = true;
    if (pattern && !pattern.test(error.message)) {
      throw new Error(`threw, but message did not match ${pattern}: ${error.message}`);
    }
  }
  if (!threw) throw new Error('expected this to be rejected, but it succeeded');
}

async function rejects(fn, pattern) {
  let threw = false;
  try { await fn(); } catch (error) {
    threw = true;
    if (pattern && !pattern.test(error.message)) {
      throw new Error(`rejected, but message did not match ${pattern}: ${error.message}`);
    }
  }
  if (!threw) throw new Error('expected this to be rejected, but it resolved');
}

function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

function near(actual, expected, tolerance, what) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${what}: expected ~${expected}, got ${actual}`);
  }
}

function ok(condition, what) {
  if (!condition) throw new Error(what);
}

const mod = (relative) => require(path.join(ROOT, 'dist-electron', relative));

/** Builds a valid invoice, overridable per test. */
function makeInvoice(overrides = {}) {
  const { todayIso } = mod('shared/defaults.js');
  return {
    invoiceNo: '', invoiceDate: todayIso(), customerId: null,
    customerName: 'Ramesh Patil', customerMobile: '9876543210',
    customerAddress: 'Ring Road, Jalgaon', customerPan: 'ABCDE1234F',
    customerGstin: '27ABCDE1234F1Z5', customerStateCode: '27', intraState: true,
    items: [{
      hsnCode: '7113', particulars: 'Gold Necklace 22K', grossWeight: 25.5,
      netWeight: 24.125, rate: 6200, makingChargeMode: 'per_gram',
      makingChargeValue: 450, gstRate: 3,
    }],
    discount: 0, paymentMode: 'Cash', paymentReference: '', amountPaid: 0,
    notes: '', status: 'saved', ...overrides,
  };
}

function report(suiteName) {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  const groups = [...new Set(results.map((r) => r.group))];

  const lines = [`\n[${suiteName}] ${results.length} checks — ${passed} passed, ${failed.length} failed`];
  for (const name of groups) {
    lines.push(`\n  ${name}`);
    for (const r of results.filter((x) => x.group === name)) {
      const mark = r.pass ? 'ok  ' : 'FAIL';
      const timing = r.ms >= 50 ? ` (${r.ms.toFixed(0)}ms)` : '';
      lines.push(`    ${mark} ${r.name}${timing}${r.note ? ` — ${r.note}` : ''}`);
    }
  }
  lines.push(`\n[${suiteName}] RESULT: ${failed.length === 0 ? 'PASSED' : 'FAILED'}`);
  console.log(lines.join('\n'));

  // Machine-readable line the readiness report is compiled from.
  console.log(`[[SUMMARY]] ${JSON.stringify({
    suite: suiteName, total: results.length, passed, failed: failed.length,
    failures: failed.map((f) => ({ name: f.name, note: f.note })),
  })}`);

  return failed.length === 0;
}

async function run(suiteName, body) {
  await app.whenReady();
  let crashed = null;
  try {
    await body();
  } catch (error) {
    crashed = error;
    results.push({ group: 'suite', name: 'suite completed without crashing', pass: false, ms: 0, note: error.message });
  }
  const passed = report(suiteName);
  if (crashed) console.error(crashed.stack);
  app.exit(passed ? 0 : 1);
}

module.exports = { app, check, checkAsync, eq, group, isolate, makeInvoice, mod, near, ok, rejects, report, run, throws, results };

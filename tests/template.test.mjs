/** Guards the printed invoice: escaping, totals on the page, and the A4 page box. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { computeInvoice } = await import('../dist-electron/shared/calc.js');
const { renderInvoiceHtml, escapeHtml } = await import('../dist-electron/shared/invoiceTemplate.js');
const { DEFAULT_SHOP } = await import('../dist-electron/shared/defaults.js');

const baseInvoice = (overrides = {}) => ({
  invoiceNo: 'PJ/25-26/0007',
  invoiceDate: '2025-06-14',
  customerId: null,
  customerName: 'Ramesh Patil',
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
  ...overrides,
});

const render = (invoice, options) =>
  renderInvoiceHtml(computeInvoice(invoice), DEFAULT_SHOP, options);

test('escapeHtml neutralises markup in customer-supplied text', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml(`Ram "Raja" & Sons`), 'Ram &quot;Raja&quot; &amp; Sons');
  assert.equal(escapeHtml(null), '');
});

test('a customer name containing markup cannot inject into the printed bill', () => {
  const html = render(baseInvoice({ customerName: '<img src=x onerror=alert(1)>' }));
  assert.ok(!html.includes('<img src=x'), 'the raw tag must not reach the document');
  assert.ok(html.includes('&lt;img src=x'));
});

test('the sheet is a single A4 page with explicit margins', () => {
  const html = render(baseInvoice());
  assert.ok(html.includes('@page { size: A4 portrait; margin: 0; }'));
  assert.ok(html.includes('width: 210mm'));
  // 296mm rather than 297mm: a hair of slack so sub-pixel rounding in the print
  // engine never pushes a one-page bill onto a second sheet.
  assert.ok(html.includes('min-height: 296mm'));
});

test('every column of the paper bill is present in the header row', () => {
  const html = render(baseInvoice());
  for (const heading of ['HSN', 'Particulars', 'Gross Wt', 'Net Wt', 'Rate', 'Making', 'Amount']) {
    assert.ok(html.includes(heading), `missing column: ${heading}`);
  }
});

test('weights, totals and the amount in words are printed', () => {
  const html = render(baseInvoice());
  const computed = computeInvoice(baseInvoice());

  assert.ok(html.includes('24.125'), 'net weight');
  assert.ok(html.includes('25.500'), 'gross weight');
  assert.ok(html.includes(computed.amountInWords), 'amount in words');
  assert.ok(html.includes('GRAND TOTAL'));
  assert.ok(html.includes('TAX INVOICE'));
});

test('intra-state bills print CGST and SGST, inter-state prints IGST', () => {
  const local = render(baseInvoice());
  assert.ok(local.includes('CGST') && local.includes('SGST'));
  assert.ok(!local.includes('>IGST<'));

  const outside = render(baseInvoice({ intraState: false, customerStateCode: '29' }));
  assert.ok(outside.includes('IGST'));
  assert.ok(outside.includes('Inter-State'));
});

test('the signature and declaration blocks are on the page', () => {
  const html = render(baseInvoice());
  assert.ok(html.includes("Customer's Signature"));
  assert.ok(html.includes(DEFAULT_SHOP.signatureLabel));
  assert.ok(html.includes('We declare that this invoice shows the actual price'));
});

test('short bills are padded with ruled blank rows like the bill book', () => {
  const html = render(baseInvoice(), { minimumRows: 8 });
  const fillers = html.match(/class="filler"/g) ?? [];
  assert.equal(fillers.length, 7, 'one item plus seven blank rows');
});

test('the default fills ten ruled rows', () => {
  const fillers = render(baseInvoice()).match(/class="filler"/g) ?? [];
  assert.equal(fillers.length, 9, 'one item plus nine blank rows');
});

test('a long bill is not padded at all', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    hsnCode: '7113', particulars: `Item ${index + 1}`, grossWeight: 5, netWeight: 5,
    rate: 6000, makingChargeMode: 'flat', makingChargeValue: 100, gstRate: 3,
  }));
  const html = render(baseInvoice({ items }));
  assert.equal((html.match(/class="filler"/g) ?? []).length, 0);
});

test('a duplicate copy is banded as such', () => {
  const html = render(baseInvoice(), { copyLabel: 'Duplicate Copy' });
  assert.ok(html.includes('Duplicate Copy'));
  assert.ok(html.includes('class="copy-label"'));
});

test('the document is fully self-contained — no external requests', () => {
  const html = render(baseInvoice());
  assert.ok(!/<script/i.test(html), 'no scripts');
  assert.ok(!/https?:\/\//i.test(html), 'no remote assets');
});

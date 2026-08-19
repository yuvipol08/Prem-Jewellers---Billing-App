/**
 * Tests run against the compiled shared modules in dist-electron, so they check
 * exactly the code the packaged app ships. Run `npm run build:main` first.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const calc = await import('../../dist-electron/shared/calc.js');
const {
  computeInvoice,
  computeItem,
  computeTotals,
  formatCurrency,
  isSameState,
  makingChargeFor,
  numberToIndianWords,
  round2,
} = calc;

const item = (overrides = {}) => ({
  hsnCode: '7113',
  particulars: 'Gold Chain 22K',
  grossWeight: 10,
  netWeight: 10,
  rate: 6000,
  makingChargeMode: 'flat',
  makingChargeValue: 0,
  gstRate: 3,
  ...overrides,
});

// ------------------------------------------------------------------ rounding

test('round2 rounds half up rather than to even', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(0.1 + 0.2), 0.3);
});

// ----------------------------------------------------------- making charges

test('flat making charge is used as entered', () => {
  assert.equal(makingChargeFor('flat', 1500, 10, 60000), 1500);
});

test('per-gram making charge multiplies by net weight', () => {
  assert.equal(makingChargeFor('per_gram', 450, 12.5, 75000), 5625);
});

test('percent making charge applies to metal value, not gross weight', () => {
  assert.equal(makingChargeFor('percent', 12, 10, 60000), 7200);
});

// ------------------------------------------------------------- line amounts

test('line amount is net weight x rate plus making charge', () => {
  const computed = computeItem(item({ makingChargeMode: 'per_gram', makingChargeValue: 500 }));
  assert.equal(computed.metalValue, 60000);
  assert.equal(computed.makingCharge, 5000);
  assert.equal(computed.amount, 65000);
});

test('gross weight never affects the amount', () => {
  const heavy = computeItem(item({ grossWeight: 25 }));
  const light = computeItem(item({ grossWeight: 10 }));
  assert.equal(heavy.amount, light.amount);
});

// --------------------------------------------------------------------- GST

test('intra-state supply splits GST equally into CGST and SGST', () => {
  const totals = computeTotals([computeItem(item())], { intraState: true });
  assert.equal(totals.taxableValue, 60000);
  assert.equal(totals.cgst, 900);
  assert.equal(totals.sgst, 900);
  assert.equal(totals.igst, 0);
  assert.equal(totals.totalGst, 1800);
  assert.equal(totals.grandTotal, 61800);
});

test('inter-state supply charges the whole rate as IGST', () => {
  const totals = computeTotals([computeItem(item())], { intraState: false });
  assert.equal(totals.igst, 1800);
  assert.equal(totals.cgst, 0);
  assert.equal(totals.sgst, 0);
  assert.equal(totals.grandTotal, 61800);
});

test('a discount is apportioned across lines before GST', () => {
  const items = [
    computeItem(item({ netWeight: 10, rate: 6000 })), // 60,000
    computeItem(item({ netWeight: 5, rate: 6000 })), //  30,000
  ];
  const totals = computeTotals(items, { intraState: true, discount: 9000 });

  assert.equal(totals.taxableBeforeDiscount, 90000);
  assert.equal(totals.taxableValue, 81000);
  // 3% of the discounted 81,000, split in half.
  assert.equal(totals.totalGst, 2430);
  assert.equal(totals.cgst, 1215);
  assert.equal(totals.sgst, 1215);
});

test('a discount larger than the bill is clamped, never negative', () => {
  const totals = computeTotals([computeItem(item())], { discount: 999999 });
  assert.equal(totals.discount, 60000);
  assert.equal(totals.taxableValue, 0);
  assert.equal(totals.grandTotal, 0);
});

test('lines may carry different GST rates', () => {
  const items = [
    computeItem(item({ netWeight: 10, rate: 6000, gstRate: 3 })), // 1,800
    computeItem(item({ netWeight: 10, rate: 1000, gstRate: 5 })), //   500
  ];
  const totals = computeTotals(items, { intraState: true });
  assert.equal(totals.totalGst, 2300);
});

// -------------------------------------------------------------- round off

test('round off carries the bill to the nearest rupee', () => {
  const totals = computeTotals([computeItem(item({ netWeight: 3.333, rate: 6111 }))], {
    intraState: true,
  });
  assert.equal(totals.grandTotal, Math.round(totals.totalBeforeRounding));
  assert.equal(
    round2(totals.totalBeforeRounding + totals.roundOff),
    round2(totals.grandTotal),
  );
  assert.ok(Math.abs(totals.roundOff) <= 0.5);
});

test('an already-whole total has no round off', () => {
  const totals = computeTotals([computeItem(item())], { intraState: true });
  assert.equal(totals.roundOff, 0);
});

// ---------------------------------------------------------------- weights

test('weight totals keep three decimals', () => {
  const items = [
    computeItem(item({ grossWeight: 10.125, netWeight: 9.875 })),
    computeItem(item({ grossWeight: 5.256, netWeight: 5.13 })),
  ];
  const totals = computeTotals(items);
  assert.equal(totals.totalGrossWeight, 15.381);
  assert.equal(totals.totalNetWeight, 15.005);
});

// --------------------------------------------------------------- balance

test('balance is what is still owed after the amount received', () => {
  const totals = computeTotals([computeItem(item())], { intraState: true, amountPaid: 50000 });
  assert.equal(totals.grandTotal, 61800);
  assert.equal(totals.balance, 11800);
});

// ------------------------------------------------------- amount in words

test('amounts are spelled out in Indian numbering', () => {
  assert.equal(numberToIndianWords(0), 'Rupees Zero Only');
  assert.equal(numberToIndianWords(61800), 'Rupees Sixty One Thousand Eight Hundred Only');
  assert.equal(numberToIndianWords(100000), 'Rupees One Lakh Only');
  assert.equal(numberToIndianWords(10000000), 'Rupees One Crore Only');
  assert.equal(
    numberToIndianWords(1234567),
    'Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only',
  );
});

test('paise are spelled out when present', () => {
  assert.equal(numberToIndianWords(105.5), 'Rupees One Hundred Five and Fifty Paise Only');
});

// ---------------------------------------------------------------- currency

test('currency uses Indian digit grouping', () => {
  assert.equal(formatCurrency(123456.5), '₹1,23,456.50');
  assert.equal(formatCurrency(1000, false), '1,000.00');
});

// ------------------------------------------------------------ place of supply

test('place of supply decides intra vs inter state', () => {
  assert.equal(isSameState('27', '27'), true);
  assert.equal(isSameState('27', '29'), false);
  // A walk-in customer with no state is billed as local.
  assert.equal(isSameState('27', ''), true);
});

// -------------------------------------------------------- whole invoice

test('computeInvoice drops blank rows and resolves the whole bill', () => {
  const invoice = {
    invoiceNo: 'PJ/25-26/0001',
    invoiceDate: '2025-06-01',
    customerId: null,
    customerName: 'Ramesh Patil',
    customerMobile: '9876543210',
    customerAddress: 'Jalgaon',
    customerPan: '',
    customerGstin: '',
    customerStateCode: '27',
    intraState: true,
    items: [
      item({ netWeight: 10, rate: 6000, makingChargeMode: 'per_gram', makingChargeValue: 500 }),
      item({ particulars: '', grossWeight: 0, netWeight: 0, rate: 0, makingChargeValue: 0 }),
    ],
    discount: 0,
    paymentMode: 'Cash',
    paymentReference: '',
    amountPaid: 0,
    notes: '',
    status: 'saved',
  };

  const computed = computeInvoice(invoice);
  assert.equal(computed.items.length, 1, 'the blank row is not billed');
  assert.equal(computed.totals.taxableValue, 65000);
  assert.equal(computed.totals.grandTotal, 66950);
  assert.equal(
    computed.amountInWords,
    'Rupees Sixty Six Thousand Nine Hundred Fifty Only',
  );
});

test('an invoice with no items totals to zero rather than throwing', () => {
  const computed = computeInvoice({
    invoiceNo: 'PJ/25-26/0002',
    invoiceDate: '2025-06-01',
    customerId: null,
    customerName: '',
    customerMobile: '',
    customerAddress: '',
    customerPan: '',
    customerGstin: '',
    customerStateCode: '27',
    intraState: true,
    items: [],
    discount: 0,
    paymentMode: 'Cash',
    paymentReference: '',
    amountPaid: 0,
    notes: '',
    status: 'saved',
  });
  assert.equal(computed.totals.grandTotal, 0);
});

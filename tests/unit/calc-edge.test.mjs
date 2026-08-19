/** Edge and defensive cases for the money engine — the code that must never be wrong. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  computeInvoice, computeItem, computeTotals, formatCurrency, formatWeight,
  isSameState, makingChargeFor, numberToIndianWords, round2, round3, toNumber,
} = await import('../../dist-electron/shared/calc.js');

const item = (o = {}) => ({
  hsnCode: '7113', particulars: 'Gold', grossWeight: 10, netWeight: 10, rate: 6000,
  makingChargeMode: 'flat', makingChargeValue: 0, gstRate: 3, ...o,
});

// ------------------------------------------------------------ hostile input

test('toNumber survives anything a text field can produce', () => {
  assert.equal(toNumber('1,23,456.50'), 123456.5);
  assert.equal(toNumber('  42  '), 42);
  assert.equal(toNumber(''), 0);
  assert.equal(toNumber('abc'), 0);
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber(undefined), 0);
  assert.equal(toNumber(NaN), 0);
  assert.equal(toNumber(Infinity), 0);
  assert.equal(toNumber({}), 0);
  assert.equal(toNumber([]), 0);
});

test('rounding never returns NaN or Infinity', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(round2(bad), 0);
    assert.equal(round3(bad), 0);
  }
});

test('a line with non-numeric text in every field totals to zero, not NaN', () => {
  const computed = computeItem(item({ netWeight: 'abc', rate: 'xyz', makingChargeValue: '??' }));
  assert.equal(computed.amount, 0);
  assert.ok(!Number.isNaN(computed.amount));
});

test('negative weights and rates do not produce NaN totals', () => {
  const totals = computeTotals([computeItem(item({ netWeight: -5, rate: 6000 }))]);
  assert.ok(Number.isFinite(totals.grandTotal));
});

// --------------------------------------------------------------- precision

test('a long bill accumulates without drifting off the paise', () => {
  const items = Array.from({ length: 60 }, () =>
    computeItem(item({ netWeight: 3.333, rate: 6111.11, makingChargeValue: 133.33 })));
  const totals = computeTotals(items, { intraState: true });
  const expectedLine = round2(round2(3.333 * 6111.11) + 133.33);
  assert.equal(totals.taxableBeforeDiscount, round2(expectedLine * 60));
  assert.equal(totals.cgst, totals.sgst, 'CGST and SGST must stay exactly equal');
  assert.equal(round2(totals.cgst + totals.sgst), totals.totalGst);
});

test('CGST and SGST always sum to the total GST, across many random bills', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let trial = 0; trial < 300; trial += 1) {
    const items = Array.from({ length: 1 + Math.floor(rand() * 6) }, () =>
      computeItem(item({
        netWeight: round3(rand() * 90 + 0.1),
        rate: round2(rand() * 9000 + 50),
        makingChargeValue: round2(rand() * 4000),
        makingChargeMode: ['flat', 'per_gram', 'percent'][Math.floor(rand() * 3)],
      })));
    const totals = computeTotals(items, { intraState: true, discount: round2(rand() * 500) });
    assert.equal(round2(totals.cgst + totals.sgst + totals.igst), totals.totalGst);
    assert.equal(totals.grandTotal, Math.round(totals.totalBeforeRounding));
    assert.ok(Math.abs(totals.roundOff) <= 0.5 + 1e-9, `round off out of range: ${totals.roundOff}`);
    assert.ok(totals.taxableValue >= 0);
    assert.ok(Number.isFinite(totals.grandTotal));
  }
});

test('a discount exactly equal to the bill zeroes the GST too', () => {
  const totals = computeTotals([computeItem(item())], { intraState: true, discount: 60000 });
  assert.equal(totals.taxableValue, 0);
  assert.equal(totals.totalGst, 0);
  assert.equal(totals.grandTotal, 0);
});

test('a negative discount is clamped to zero rather than inflating the bill', () => {
  const totals = computeTotals([computeItem(item())], { discount: -5000 });
  assert.equal(totals.discount, 0);
  assert.equal(totals.taxableValue, 60000);
});

test('zero-value lines do not divide by zero during discount apportionment', () => {
  const totals = computeTotals(
    [computeItem(item({ netWeight: 0, rate: 0 })), computeItem(item({ netWeight: 0, rate: 0 }))],
    { discount: 100, intraState: true },
  );
  assert.equal(totals.taxableBeforeDiscount, 0);
  assert.equal(totals.grandTotal, 0);
  assert.ok(Number.isFinite(totals.cgst));
});

test('a zero GST rate produces a bill with no tax', () => {
  const totals = computeTotals([computeItem(item({ gstRate: 0 }))], { intraState: true });
  assert.equal(totals.totalGst, 0);
  assert.equal(totals.grandTotal, 60000);
});

// ---------------------------------------------------------------- scale

test('a crore-scale bill stays exact', () => {
  const totals = computeTotals([computeItem(item({ netWeight: 2000, rate: 6200 }))], { intraState: true });
  assert.equal(totals.taxableValue, 12400000);
  assert.equal(totals.totalGst, 372000);
  assert.equal(totals.grandTotal, 12772000);
  assert.equal(numberToIndianWords(12772000),
    'Rupees One Crore Twenty Seven Lakh Seventy Two Thousand Only');
});

test('words handle boundaries that trip naive implementations', () => {
  assert.equal(numberToIndianWords(10), 'Rupees Ten Only');
  assert.equal(numberToIndianWords(19), 'Rupees Nineteen Only');
  assert.equal(numberToIndianWords(20), 'Rupees Twenty Only');
  assert.equal(numberToIndianWords(100), 'Rupees One Hundred Only');
  assert.equal(numberToIndianWords(101), 'Rupees One Hundred One Only');
  assert.equal(numberToIndianWords(1000), 'Rupees One Thousand Only');
  assert.equal(numberToIndianWords(99999), 'Rupees Ninety Nine Thousand Nine Hundred Ninety Nine Only');
  assert.equal(numberToIndianWords(100000), 'Rupees One Lakh Only');
  assert.equal(numberToIndianWords(1000000000),
    'Rupees One Hundred Crore Only');
});

test('words handle paise rounding at the boundary', () => {
  assert.equal(numberToIndianWords(0.5), 'Rupees Zero and Fifty Paise Only');
  assert.equal(numberToIndianWords(0.01), 'Rupees Zero and One Paise Only');
  assert.equal(numberToIndianWords(99.999), 'Rupees One Hundred Only');
});

test('negative amounts are spelled as Minus rather than silently dropped', () => {
  assert.ok(numberToIndianWords(-500).startsWith('Minus Rupees'));
});

// -------------------------------------------------------------- formatting

test('currency and weight formatting hold at the extremes', () => {
  assert.equal(formatCurrency(0), '₹0.00');
  assert.equal(formatCurrency(-1234.5), '-₹1,234.50');
  assert.equal(formatCurrency(10000000), '₹1,00,00,000.00');
  assert.equal(formatWeight(0), '');
  assert.equal(formatWeight(0.0004), '');
  assert.equal(formatWeight(1), '1.000');
});

// ----------------------------------------------------------- place of supply

test('place of supply comparison ignores stray whitespace', () => {
  assert.equal(isSameState('27', ' 27 '), true);
  assert.equal(isSameState(' 27', '29'), false);
  assert.equal(isSameState('27', '   '), true);
});

// ------------------------------------------------------------ making charges

test('percent making charge is taken on metal value, never on the gross weight', () => {
  const computed = computeItem(item({
    grossWeight: 100, netWeight: 10, rate: 6000, makingChargeMode: 'percent', makingChargeValue: 10,
  }));
  assert.equal(computed.metalValue, 60000);
  assert.equal(computed.makingCharge, 6000);
});

test('an unknown making-charge mode falls back to flat rather than throwing', () => {
  assert.equal(makingChargeFor('nonsense', 500, 10, 60000), 500);
});

// -------------------------------------------------------- whole-invoice guards

test('computeInvoice tolerates a completely empty invoice', () => {
  const computed = computeInvoice({
    invoiceNo: '', invoiceDate: '', customerId: null, customerName: '', customerMobile: '',
    customerAddress: '', customerPan: '', customerGstin: '', customerStateCode: '',
    intraState: true, items: [], discount: 0, paymentMode: 'Cash', paymentReference: '',
    amountPaid: 0, notes: '', status: 'saved',
  });
  assert.equal(computed.totals.grandTotal, 0);
  assert.equal(computed.amountInWords, 'Rupees Zero Only');
});

test('overpayment produces a negative balance rather than hiding it', () => {
  const totals = computeTotals([computeItem(item())], { intraState: true, amountPaid: 100000 });
  assert.equal(totals.grandTotal, 61800);
  assert.equal(totals.balance, -38200);
});

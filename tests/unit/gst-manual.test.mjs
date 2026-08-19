/**
 * Invoice totals checked against calculations worked by hand.
 *
 * Every expected figure below was computed on paper first, the way the shop or
 * their accountant would check a bill, and is written out step by step so a
 * reviewer can follow the arithmetic without trusting the code.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { computeInvoice } = await import('../../dist-electron/shared/calc.js');

const invoice = (items, extra = {}) => computeInvoice({
  invoiceNo: 'MANUAL', invoiceDate: '2025-06-14', customerId: null,
  customerName: 'Manual Check', customerMobile: '', customerAddress: '',
  customerPan: '', customerGstin: '', customerStateCode: '27', intraState: true,
  items, discount: 0, paymentMode: 'Cash', paymentReference: '', amountPaid: 0,
  notes: '', status: 'saved', ...extra,
});

const line = (o) => ({
  hsnCode: '7113', particulars: 'Item', grossWeight: 0, netWeight: 0, rate: 0,
  makingChargeMode: 'flat', makingChargeValue: 0, gstRate: 3, ...o,
});

test('scenario 1 — gold chain, flat making, intra-state', () => {
  // Net 10.000 g x Rs 6,200/g            = 62,000.00
  // Making (flat)                        =  1,500.00
  // Taxable                              = 63,500.00
  // CGST 1.5%  = 63,500 x 0.015          =    952.50
  // SGST 1.5%  = 63,500 x 0.015          =    952.50
  // Total                                = 65,405.00  (already whole)
  const { totals } = invoice([line({ netWeight: 10, rate: 6200, makingChargeValue: 1500 })]);
  assert.equal(totals.taxableValue, 63500);
  assert.equal(totals.cgst, 952.5);
  assert.equal(totals.sgst, 952.5);
  assert.equal(totals.igst, 0);
  assert.equal(totals.totalGst, 1905);
  assert.equal(totals.roundOff, 0);
  assert.equal(totals.grandTotal, 65405);
});

test('scenario 2 — per-gram making charge, with a round-off', () => {
  // Net 24.125 g x Rs 6,200/g            = 149,575.00
  // Making 24.125 g x Rs 450/g           =  10,856.25
  // Taxable                              = 160,431.25
  // CGST 1.5% = 160,431.25 x 0.015       =   2,406.469 -> 2,406.47
  // SGST 1.5%                            =   2,406.47
  // Before rounding                      = 165,244.19
  // Round off                            =      -0.19
  // Grand total                          = 165,244.00
  const { totals } = invoice([
    line({ grossWeight: 25.5, netWeight: 24.125, rate: 6200, makingChargeMode: 'per_gram', makingChargeValue: 450 }),
  ]);
  assert.equal(totals.taxableValue, 160431.25);
  assert.equal(totals.cgst, 2406.47);
  assert.equal(totals.sgst, 2406.47);
  assert.equal(totals.totalBeforeRounding, 165244.19);
  assert.equal(totals.roundOff, -0.19);
  assert.equal(totals.grandTotal, 165244);
});

test('scenario 3 — percentage making charge', () => {
  // Net 31.800 g x Rs 6,200/g            = 197,160.00
  // Making 12% of 197,160                =  23,659.20
  // Taxable                              = 220,819.20
  // CGST 1.5%                            =   3,312.288 -> 3,312.29
  // SGST 1.5%                            =   3,312.29
  // Before rounding                      = 227,443.78
  // Grand total                          = 227,444.00, round off +0.22
  const { totals } = invoice([
    line({ grossWeight: 32.4, netWeight: 31.8, rate: 6200, makingChargeMode: 'percent', makingChargeValue: 12 }),
  ]);
  assert.equal(totals.taxableValue, 220819.2);
  assert.equal(totals.cgst, 3312.29);
  assert.equal(totals.grandTotal, 227444);
  assert.equal(totals.roundOff, 0.22);
});

test('scenario 4 — inter-state supply charges the full rate as IGST', () => {
  // Taxable                              = 63,500.00
  // IGST 3%   = 63,500 x 0.03            =  1,905.00
  // Grand total                          = 65,405.00
  const { totals } = invoice(
    [line({ netWeight: 10, rate: 6200, makingChargeValue: 1500 })],
    { intraState: false, customerStateCode: '29' },
  );
  assert.equal(totals.igst, 1905);
  assert.equal(totals.cgst, 0);
  assert.equal(totals.sgst, 0);
  assert.equal(totals.grandTotal, 65405);
  // The customer pays the same either way; only the split differs.
  assert.equal(totals.grandTotal, invoice([line({ netWeight: 10, rate: 6200, makingChargeValue: 1500 })]).totals.grandTotal);
});

test('scenario 5 — three lines with a discount, matching a real counter bill', () => {
  // Line 1: 24.125 x 6,200 = 149,575.00 + (24.125 x 450 = 10,856.25) = 160,431.25
  // Line 2: 31.800 x 6,200 = 197,160.00 + (12% = 23,659.20)          = 220,819.20
  // Line 3: 84.200 x    92 =   7,746.40 + 1,200.00                   =   8,946.40
  // Gross taxable                                                    = 390,196.85
  // Less discount                                                    =   2,500.00
  // Net taxable                                                      = 387,696.85
  // CGST 1.5% = 387,696.85 x 0.015 = 5,815.4527 -> 5,815.45  (per-line, summed)
  // SGST 1.5%                                                        =   5,815.45
  // Before rounding                                                  = 399,327.75
  // Grand total                                                      = 399,328.00, round off +0.25
  const { totals, amountInWords } = invoice([
    line({ grossWeight: 25.5, netWeight: 24.125, rate: 6200, makingChargeMode: 'per_gram', makingChargeValue: 450 }),
    line({ grossWeight: 32.4, netWeight: 31.8, rate: 6200, makingChargeMode: 'percent', makingChargeValue: 12 }),
    line({ hsnCode: '7106', grossWeight: 84.2, netWeight: 84.2, rate: 92, makingChargeValue: 1200 }),
  ], { discount: 2500 });

  assert.equal(totals.taxableBeforeDiscount, 390196.85);
  assert.equal(totals.discount, 2500);
  assert.equal(totals.taxableValue, 387696.85);
  assert.equal(totals.cgst, 5815.45);
  assert.equal(totals.sgst, 5815.45);
  assert.equal(totals.roundOff, 0.25);
  assert.equal(totals.grandTotal, 399328);
  assert.equal(totals.totalGrossWeight, 142.1);
  assert.equal(totals.totalNetWeight, 140.125);
  assert.equal(totals.totalMakingCharges, 35715.45);
  assert.equal(amountInWords,
    'Rupees Three Lakh Ninety Nine Thousand Three Hundred Twenty Eight Only');
});

test('scenario 6 — part payment leaves the right balance', () => {
  // Grand total 165,244.00 less 100,000.00 received = 65,244.00 outstanding
  const { totals } = invoice(
    [line({ netWeight: 24.125, rate: 6200, makingChargeMode: 'per_gram', makingChargeValue: 450 })],
    { amountPaid: 100000 },
  );
  assert.equal(totals.grandTotal, 165244);
  assert.equal(totals.balance, 65244);
});

test('scenario 7 — silver at 3%, small value, rounds down', () => {
  // Net 12.500 g x Rs 92/g               = 1,150.00
  // Making (flat)                        =   250.00
  // Taxable                              = 1,400.00
  // CGST 1.5% = 21.00, SGST 1.5% = 21.00
  // Total                                = 1,442.00 (whole)
  const { totals } = invoice([line({ hsnCode: '7106', netWeight: 12.5, rate: 92, makingChargeValue: 250 })]);
  assert.equal(totals.taxableValue, 1400);
  assert.equal(totals.cgst, 21);
  assert.equal(totals.grandTotal, 1442);
});

test('scenario 8 — a discount that exactly cancels one line', () => {
  // Line 1 = 62,000.00, Line 2 = 8,000.00, gross = 70,000.00
  // Discount 8,000 -> net taxable 62,000.00
  // GST 3% of 62,000 = 1,860.00 split 930/930
  // Grand total = 63,860.00
  const { totals } = invoice([
    line({ netWeight: 10, rate: 6200 }),
    line({ netWeight: 1, rate: 8000 }),
  ], { discount: 8000 });
  assert.equal(totals.taxableValue, 62000);
  assert.equal(totals.cgst, 930);
  assert.equal(totals.sgst, 930);
  assert.equal(totals.grandTotal, 63860);
});

test('the GST split always reconstructs the taxable value at the stated rate', () => {
  // A property the accountant can check on any bill: total GST / taxable = 3%.
  const scenarios = [
    [line({ netWeight: 10, rate: 6200, makingChargeValue: 1500 })],
    [line({ netWeight: 24.125, rate: 6200, makingChargeMode: 'per_gram', makingChargeValue: 450 })],
    [line({ netWeight: 31.8, rate: 6200, makingChargeMode: 'percent', makingChargeValue: 12 })],
    [line({ netWeight: 84.2, rate: 92, makingChargeValue: 1200 })],
  ];
  for (const items of scenarios) {
    const { totals } = invoice(items);
    const impliedRate = (totals.totalGst / totals.taxableValue) * 100;
    assert.ok(Math.abs(impliedRate - 3) < 0.001,
      `implied GST rate was ${impliedRate.toFixed(4)}%, expected 3%`);
  }
});

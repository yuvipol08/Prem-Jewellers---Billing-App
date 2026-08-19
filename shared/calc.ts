/**
 * Pure invoice arithmetic. No I/O, no Electron, no React — so the renderer can
 * recompute totals on every keystroke and the main process can recompute the
 * exact same numbers when it renders a PDF.
 */

import type {
  ComputedInvoice,
  ComputedInvoiceItem,
  Invoice,
  InvoiceItem,
  InvoiceTotals,
  MakingChargeMode,
} from './types';

/** Rounds to paise, correcting the usual binary-float shortfall (1.005 -> 1.01). */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON * Math.sign(value || 1)) * 100) / 100;
}

export function round3(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON * Math.sign(value || 1)) * 1000) / 1000;
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function makingChargeFor(
  mode: MakingChargeMode,
  value: number,
  netWeight: number,
  metalValue: number,
): number {
  const amount = toNumber(value);
  switch (mode) {
    case 'per_gram':
      return round2(amount * toNumber(netWeight));
    case 'percent':
      return round2((metalValue * amount) / 100);
    case 'flat':
    default:
      return round2(amount);
  }
}

export function computeItem(item: InvoiceItem): ComputedInvoiceItem {
  const netWeight = toNumber(item.netWeight);
  const rate = toNumber(item.rate);
  const metalValue = round2(netWeight * rate);
  const makingCharge = makingChargeFor(
    item.makingChargeMode,
    item.makingChargeValue,
    netWeight,
    metalValue,
  );
  return {
    ...item,
    grossWeight: toNumber(item.grossWeight),
    netWeight,
    rate,
    makingChargeValue: toNumber(item.makingChargeValue),
    gstRate: toNumber(item.gstRate),
    metalValue,
    makingCharge,
    amount: round2(metalValue + makingCharge),
  };
}

/** True when an item has anything worth printing on the bill. */
export function isItemFilled(item: InvoiceItem): boolean {
  return (
    item.particulars.trim().length > 0 ||
    toNumber(item.netWeight) > 0 ||
    toNumber(item.grossWeight) > 0 ||
    toNumber(item.rate) > 0 ||
    toNumber(item.makingChargeValue) > 0
  );
}

export function computeTotals(
  items: ComputedInvoiceItem[],
  options: { discount?: number; intraState?: boolean; amountPaid?: number } = {},
): InvoiceTotals {
  const intraState = options.intraState !== false;
  const taxableBeforeDiscount = round2(items.reduce((sum, item) => sum + item.amount, 0));

  // Clamp: a discount can never exceed the bill, and never goes negative.
  const discount = round2(Math.min(Math.max(toNumber(options.discount), 0), taxableBeforeDiscount));
  const taxableValue = round2(taxableBeforeDiscount - discount);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  // The discount is apportioned pro-rata by line value, so each HSN line keeps
  // the correct taxable value and GST split for the GST return.
  for (const item of items) {
    const share = taxableBeforeDiscount > 0 ? item.amount / taxableBeforeDiscount : 0;
    const lineTaxable = item.amount - discount * share;
    const lineGst = (lineTaxable * toNumber(item.gstRate)) / 100;
    if (intraState) {
      cgst += lineGst / 2;
      sgst += lineGst / 2;
    } else {
      igst += lineGst;
    }
  }

  cgst = round2(cgst);
  sgst = round2(sgst);
  igst = round2(igst);

  const totalGst = round2(cgst + sgst + igst);
  const totalBeforeRounding = round2(taxableValue + totalGst);
  const grandTotal = Math.round(totalBeforeRounding);
  const roundOff = round2(grandTotal - totalBeforeRounding);
  const amountPaid = round2(toNumber(options.amountPaid));

  return {
    taxableBeforeDiscount,
    discount,
    taxableValue,
    cgst,
    sgst,
    igst,
    totalGst,
    totalBeforeRounding,
    roundOff,
    grandTotal,
    totalGrossWeight: round3(items.reduce((sum, item) => sum + item.grossWeight, 0)),
    totalNetWeight: round3(items.reduce((sum, item) => sum + item.netWeight, 0)),
    totalMakingCharges: round2(items.reduce((sum, item) => sum + item.makingCharge, 0)),
    balance: round2(grandTotal - amountPaid),
  };
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitsToWords(value: number): string {
  if (value < 20) return ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
}

function belowThousandToWords(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigitsToWords(rest));
  return parts.join(' ');
}

/** Indian numbering: crore / lakh / thousand / hundred, as printed on the bill. */
export function numberToIndianWords(value: number): string {
  const total = round2(Math.abs(toNumber(value)));
  const rupees = Math.floor(total);
  const paise = Math.round((total - rupees) * 100);

  const words = (amount: number): string => {
    if (amount === 0) return 'Zero';
    const crore = Math.floor(amount / 10000000);
    const lakh = Math.floor((amount % 10000000) / 100000);
    const thousand = Math.floor((amount % 100000) / 1000);
    const rest = amount % 1000;

    const parts: string[] = [];
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${belowThousandToWords(lakh)} Lakh`);
    if (thousand) parts.push(`${belowThousandToWords(thousand)} Thousand`);
    if (rest) parts.push(belowThousandToWords(rest));
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };

  const sign = toNumber(value) < 0 ? 'Minus ' : '';
  const rupeeWords = `${sign}Rupees ${words(rupees)}`;
  return paise > 0
    ? `${rupeeWords} and ${twoDigitsToWords(paise)} Paise Only`
    : `${rupeeWords} Only`;
}

/** Resolves an invoice into everything printing, PDFs and the UI need. */
export function computeInvoice(invoice: Invoice): ComputedInvoice {
  const items = invoice.items.filter(isItemFilled).map(computeItem);
  const totals = computeTotals(items, {
    discount: invoice.discount,
    intraState: invoice.intraState,
    amountPaid: invoice.amountPaid,
  });
  return {
    ...invoice,
    items,
    totals,
    amountInWords: numberToIndianWords(totals.grandTotal),
  };
}

/**
 * ₹ formatting with Indian digit grouping (1,23,456.00).
 *
 * The sign is placed outside the symbol — "-₹1,234.50", not "₹-1,234.50" —
 * which is how a negative round-off or an overpaid balance should read.
 */
export function formatCurrency(value: number, withSymbol = true): string {
  const amount = round2(toNumber(value));
  const magnitude = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  const sign = amount < 0 ? '-' : '';
  return withSymbol ? `${sign}₹${magnitude}` : `${sign}${magnitude}`;
}

export function formatWeight(value: number): string {
  const weight = round3(toNumber(value));
  return weight === 0 ? '' : weight.toFixed(3);
}

/** GST state codes must be exactly two digits; anything else is treated as unknown. */
export function isSameState(shopStateCode: string, customerStateCode: string): boolean {
  const shop = (shopStateCode || '').trim();
  const customer = (customerStateCode || '').trim();
  if (!customer) return true; // Walk-in customers are billed as local by default.
  return shop === customer;
}

/** Invoice-number formatting rules, kept pure so they can be tested directly. */

/** Indian financial year label for a date: 2025-06-01 -> "25-26". FY starts 1 April. */
export function financialYearLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = valid.getFullYear();
  const startYear = valid.getMonth() >= 3 ? year : year - 1;
  const short = (value: number) => String(((value % 100) + 100) % 100).padStart(2, '0');
  return `${short(startYear)}-${short(startYear + 1)}`;
}

/**
 * Escapes SQL LIKE wildcards so a prefix such as "PJ_" matches literally
 * instead of treating "_" as "any character". Pair with ESCAPE '\' in the query.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Builds the constant part of an invoice number: "PJ/25-26/" or "PJ-". */
export function seriesPrefix(prefix: string, resetYearly: boolean, isoDate: string): string {
  const base = (prefix || 'PJ').trim() || 'PJ';
  return resetYearly ? `${base}/${financialYearLabel(isoDate)}/` : `${base}-`;
}

/** Reads the running number off an invoice number, or null if it does not fit the series. */
export function sequenceFromInvoiceNo(invoiceNo: string, prefix: string): number | null {
  if (!invoiceNo.startsWith(prefix)) return null;
  const suffix = invoiceNo.slice(prefix.length);
  // Only a pure run of digits is a sequence — "0001-A" is a manual override.
  if (!/^\d+$/.test(suffix)) return null;
  const parsed = Number.parseInt(suffix, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatInvoiceNo(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(4, '0')}`;
}

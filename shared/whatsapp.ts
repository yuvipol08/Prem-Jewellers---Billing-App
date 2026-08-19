/**
 * Pure WhatsApp helpers — number normalisation and message templating.
 *
 * Kept out of the Electron service so they can be unit tested directly and so
 * the renderer could preview a message without touching the main process.
 */

import { computeInvoice, formatCurrency } from './calc';
import type { Invoice } from './types';

/**
 * Normalises an Indian mobile number to the digits WhatsApp expects.
 *
 * Handles the forms a shop actually types: "98765 43210", "+91-9876543210",
 * "09876543210", and numbers that already carry a country code.
 */
export function normaliseMobile(mobile: string, defaultCountryCode: string): string {
  let digits = (mobile || '').replace(/\D/g, '');
  if (!digits) return '';

  const country = (defaultCountryCode || '91').replace(/\D/g, '') || '91';

  // Drop a leading STD zero (0 98765 43210) before applying the country code.
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

  // Already carries the country code.
  if (digits.startsWith(country) && digits.length === country.length + 10) return digits;

  if (digits.length === 10) return `${country}${digits}`;

  return digits;
}

/** Fills the shop's message template with this invoice's details. */
export function buildMessage(invoice: Invoice, template: string, shopName: string): string {
  const computed = computeInvoice(invoice);
  const replacements: Record<string, string> = {
    '{customerName}': invoice.customerName.trim() || 'Customer',
    '{shopName}': shopName,
    '{invoiceNo}': invoice.invoiceNo,
    '{invoiceDate}': invoice.invoiceDate,
    '{grandTotal}': formatCurrency(computed.totals.grandTotal),
  };

  return Object.entries(replacements).reduce(
    (message, [token, value]) => message.split(token).join(value),
    template,
  );
}

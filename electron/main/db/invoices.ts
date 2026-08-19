import { computeInvoice } from '../../../shared/calc';
import { todayIso } from '../../../shared/defaults';
import {
  escapeLikePattern,
  financialYearLabel,
  formatInvoiceNo,
  sequenceFromInvoiceNo,
  seriesPrefix,
} from '../../../shared/numbering';
import type {
  Invoice,
  InvoiceFilter,
  InvoiceItem,
  InvoiceListRow,
  MakingChargeMode,
  PaymentMode,
} from '../../../shared/types';
import { getDb } from './connection';
import { getSettings } from './settings';

export { financialYearLabel };

/** The constant part of an invoice number, e.g. "PJ/25-26/" or "PJ-". */
export function invoiceSeriesPrefix(isoDate = todayIso()): string {
  const { shop } = getSettings();
  return seriesPrefix(shop.invoicePrefix, shop.resetNumberYearly, isoDate);
}

/**
 * Next number in the current series.
 *
 * Derived from what is actually stored rather than a counter, so restoring a
 * backup or clearing the device can never hand out a number that already exists.
 * The prefix is escaped before it reaches LIKE — a prefix containing "_" or "%"
 * would otherwise act as a wildcard and scan the wrong series.
 */
export function nextInvoiceNumber(isoDate = todayIso()): string {
  const db = getDb();
  const { shop } = getSettings();
  const prefix = invoiceSeriesPrefix(isoDate);

  const rows = db
    .prepare<[string]>(
      `SELECT invoice_no FROM invoices WHERE invoice_no LIKE ? || '%' ESCAPE '\\'`,
    )
    .all(escapeLikePattern(prefix)) as { invoice_no: string }[];

  let highest = 0;
  for (const row of rows) {
    const sequence = sequenceFromInvoiceNo(row.invoice_no, prefix);
    if (sequence !== null && sequence > highest) highest = sequence;
  }

  return formatInvoiceNo(prefix, Math.max(highest + 1, shop.invoiceStartNumber || 1));
}

interface InvoiceRow {
  id: number;
  invoice_no: string;
  invoice_date: string;
  customer_id: number | null;
  customer_name: string;
  customer_mobile: string;
  customer_address: string;
  customer_pan: string;
  customer_gstin: string;
  customer_state: string;
  intra_state: number;
  discount: number;
  payment_mode: string;
  payment_reference: string;
  amount_paid: number;
  notes: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: number;
  hsn_code: string;
  particulars: string;
  gross_weight: number;
  net_weight: number;
  rate: number;
  making_charge_mode: string;
  making_charge_value: number;
  gst_rate: number;
}

function toInvoice(row: InvoiceRow, items: ItemRow[]): Invoice {
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    invoiceDate: row.invoice_date,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerMobile: row.customer_mobile,
    customerAddress: row.customer_address,
    customerPan: row.customer_pan,
    customerGstin: row.customer_gstin,
    customerStateCode: row.customer_state,
    intraState: row.intra_state === 1,
    discount: row.discount,
    paymentMode: row.payment_mode as PaymentMode,
    paymentReference: row.payment_reference,
    amountPaid: row.amount_paid,
    notes: row.notes,
    status: row.status as Invoice['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map(
      (item): InvoiceItem => ({
        id: item.id,
        hsnCode: item.hsn_code,
        particulars: item.particulars,
        grossWeight: item.gross_weight,
        netWeight: item.net_weight,
        rate: item.rate,
        makingChargeMode: item.making_charge_mode as MakingChargeMode,
        makingChargeValue: item.making_charge_value,
        gstRate: item.gst_rate,
      }),
    ),
  };
}

export function getInvoice(id: number): Invoice | null {
  const db = getDb();
  const row = db.prepare<[number], InvoiceRow>(`SELECT * FROM invoices WHERE id = ?`).get(id);
  if (!row) return null;

  const items = db
    .prepare<[number], ItemRow>(`SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY line_no`)
    .all(id);
  return toInvoice(row, items);
}

export function getInvoiceByNumber(invoiceNo: string): Invoice | null {
  const row = getDb()
    .prepare<[string], InvoiceRow>(`SELECT id FROM invoices WHERE invoice_no = ?`)
    .get(invoiceNo) as { id: number } | undefined;
  return row ? getInvoice(row.id) : null;
}

/**
 * Writes an invoice and its lines atomically, storing the computed money
 * figures alongside the inputs so history, reports and reprints never shift
 * if a rate or GST default is changed later.
 */
export function saveInvoice(invoice: Invoice): { id: number; invoiceNo: string } {
  const db = getDb();
  const computed = computeInvoice(invoice);

  if (computed.items.length === 0) {
    throw new Error('Add at least one item before saving the invoice.');
  }

  const run = db.transaction((): { id: number; invoiceNo: string } => {
    let invoiceId = invoice.id ?? 0;
    let invoiceNo = invoice.invoiceNo.trim() || nextInvoiceNumber(invoice.invoiceDate);

    if (invoiceId) {
      // Editing onto a number another bill already holds would otherwise surface
      // a raw "UNIQUE constraint failed" from SQLite at the counter.
      const clash = getInvoiceByNumber(invoiceNo);
      if (clash && clash.id !== invoiceId) {
        throw new Error(
          `Invoice number ${invoiceNo} is already used by another bill. Choose a different number.`,
        );
      }

      db.prepare(
        `UPDATE invoices SET
           invoice_no = ?, invoice_date = ?, customer_id = ?, customer_name = ?,
           customer_mobile = ?, customer_address = ?, customer_pan = ?, customer_gstin = ?,
           customer_state = ?, intra_state = ?, discount = ?, taxable_value = ?,
           cgst = ?, sgst = ?, igst = ?, round_off = ?, grand_total = ?,
           total_gross_wt = ?, total_net_wt = ?, payment_mode = ?, payment_reference = ?,
           amount_paid = ?, notes = ?, status = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        invoiceNo,
        invoice.invoiceDate,
        invoice.customerId,
        invoice.customerName.trim(),
        invoice.customerMobile.trim(),
        invoice.customerAddress.trim(),
        invoice.customerPan.trim().toUpperCase(),
        invoice.customerGstin.trim().toUpperCase(),
        invoice.customerStateCode.trim(),
        invoice.intraState ? 1 : 0,
        computed.totals.discount,
        computed.totals.taxableValue,
        computed.totals.cgst,
        computed.totals.sgst,
        computed.totals.igst,
        computed.totals.roundOff,
        computed.totals.grandTotal,
        computed.totals.totalGrossWeight,
        computed.totals.totalNetWeight,
        invoice.paymentMode,
        invoice.paymentReference.trim(),
        computed.amountPaid,
        invoice.notes.trim(),
        invoice.status,
        invoiceId,
      );
      db.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).run(invoiceId);
    } else {
      // A number handed out earlier may have been taken while this bill was open.
      if (getInvoiceByNumber(invoiceNo)) {
        invoiceNo = nextInvoiceNumber(invoice.invoiceDate);
      }
      const result = db
        .prepare(
          `INSERT INTO invoices (
             invoice_no, invoice_date, customer_id, customer_name, customer_mobile,
             customer_address, customer_pan, customer_gstin, customer_state, intra_state,
             discount, taxable_value, cgst, sgst, igst, round_off, grand_total,
             total_gross_wt, total_net_wt, payment_mode, payment_reference, amount_paid,
             notes, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          invoiceNo,
          invoice.invoiceDate,
          invoice.customerId,
          invoice.customerName.trim(),
          invoice.customerMobile.trim(),
          invoice.customerAddress.trim(),
          invoice.customerPan.trim().toUpperCase(),
          invoice.customerGstin.trim().toUpperCase(),
          invoice.customerStateCode.trim(),
          invoice.intraState ? 1 : 0,
          computed.totals.discount,
          computed.totals.taxableValue,
          computed.totals.cgst,
          computed.totals.sgst,
          computed.totals.igst,
          computed.totals.roundOff,
          computed.totals.grandTotal,
          computed.totals.totalGrossWeight,
          computed.totals.totalNetWeight,
          invoice.paymentMode,
          invoice.paymentReference.trim(),
          computed.amountPaid,
          invoice.notes.trim(),
          invoice.status,
        );
      invoiceId = Number(result.lastInsertRowid);
    }

    const insertItem = db.prepare(
      `INSERT INTO invoice_items (
         invoice_id, line_no, hsn_code, particulars, gross_weight, net_weight, rate,
         making_charge_mode, making_charge_value, making_charge, gst_rate, amount
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    computed.items.forEach((item, index) => {
      insertItem.run(
        invoiceId,
        index + 1,
        item.hsnCode.trim(),
        item.particulars.trim(),
        item.grossWeight,
        item.netWeight,
        item.rate,
        item.makingChargeMode,
        item.makingChargeValue,
        item.makingCharge,
        item.gstRate,
        item.amount,
      );
    });

    return { id: invoiceId, invoiceNo };
  });

  return run();
}

export function listInvoices(filter: InvoiceFilter = {}): InvoiceListRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.fromDate) {
    conditions.push(`i.invoice_date >= ?`);
    params.push(filter.fromDate);
  }
  if (filter.toDate) {
    conditions.push(`i.invoice_date <= ?`);
    params.push(filter.toDate);
  }
  if (filter.customerId) {
    conditions.push(`i.customer_id = ?`);
    params.push(filter.customerId);
  }
  if (filter.paymentMode) {
    conditions.push(`i.payment_mode = ?`);
    params.push(filter.paymentMode);
  }
  if (filter.search && filter.search.trim()) {
    const like = `%${filter.search.trim().toLowerCase()}%`;
    conditions.push(
      `(lower(i.invoice_no) LIKE ? OR lower(i.customer_name) LIKE ? OR i.customer_mobile LIKE ? OR lower(i.customer_gstin) LIKE ?)`,
    );
    params.push(like, like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(filter.limit ?? 200, filter.offset ?? 0);

  const rows = getDb()
    .prepare(
      `SELECT i.id, i.invoice_no, i.invoice_date, i.customer_name, i.customer_mobile,
              i.grand_total, i.payment_mode, i.status,
              (SELECT COUNT(*) FROM invoice_items it WHERE it.invoice_id = i.id) AS item_count
         FROM invoices i
         ${where}
        ORDER BY i.invoice_date DESC, i.id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as number,
    invoiceNo: row.invoice_no as string,
    invoiceDate: row.invoice_date as string,
    customerName: row.customer_name as string,
    customerMobile: row.customer_mobile as string,
    grandTotal: row.grand_total as number,
    paymentMode: row.payment_mode as PaymentMode,
    status: row.status as InvoiceListRow['status'],
    itemCount: row.item_count as number,
  }));
}

export function cancelInvoice(id: number): void {
  getDb()
    .prepare(`UPDATE invoices SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`)
    .run(id);
}

export function deleteInvoice(id: number): void {
  getDb().prepare(`DELETE FROM invoices WHERE id = ?`).run(id);
}

/**
 * Editing is restricted to invoices dated today. A bill from a closed day has
 * already gone into the books, so it is reprinted or cancelled, never rewritten.
 */
export function canEditInvoice(id: number): boolean {
  const row = getDb()
    .prepare<[number]>(`SELECT invoice_date, status FROM invoices WHERE id = ?`)
    .get(id) as { invoice_date: string; status: string } | undefined;
  if (!row) return false;
  return row.status !== 'cancelled' && row.invoice_date === todayIso();
}

/** Copies an existing bill onto a fresh number and today's date, unsaved. */
export function duplicateInvoice(id: number): Invoice | null {
  const source = getInvoice(id);
  if (!source) return null;

  const invoiceDate = todayIso();
  return {
    ...source,
    id: undefined,
    invoiceNo: nextInvoiceNumber(invoiceDate),
    invoiceDate,
    status: 'saved',
    amountPaid: 0,
    paymentReference: '',
    createdAt: undefined,
    updatedAt: undefined,
    items: source.items.map((item) => ({ ...item, id: undefined })),
  };
}

export function countInvoices(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS c FROM invoices`).get() as { c: number };
  return row.c;
}

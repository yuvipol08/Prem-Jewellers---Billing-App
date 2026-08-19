import type { Customer, InvoiceListRow } from '../../../shared/types';
import { getDb } from './connection';

interface CustomerRow {
  id: number;
  name: string;
  mobile: string;
  address: string;
  pan: string;
  gstin: string;
  state_code: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    address: row.address,
    pan: row.pan,
    gstin: row.gstin,
    stateCode: row.state_code,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Searches name, mobile and GSTIN at once — the three ways the counter looks someone up. */
export function listCustomers(search = '', limit = 100): Customer[] {
  const db = getDb();
  const term = search.trim();

  if (!term) {
    const rows = db
      .prepare<[number], CustomerRow>(
        `SELECT * FROM customers ORDER BY updated_at DESC, name ASC LIMIT ?`,
      )
      .all(limit);
    return rows.map(toCustomer);
  }

  const like = `%${term.toLowerCase()}%`;
  const rows = db
    .prepare<[string, string, string, string, string, number], CustomerRow>(
      `SELECT * FROM customers
        WHERE lower(name)  LIKE ?
           OR mobile       LIKE ?
           OR lower(gstin) LIKE ?
           OR lower(pan)   LIKE ?
        ORDER BY
          CASE WHEN lower(name) LIKE ? THEN 0 ELSE 1 END,
          updated_at DESC
        LIMIT ?`,
    )
    // The extra binding drives the prefix-match-first ordering.
    .all(like, like, like, like, `${term.toLowerCase()}%`, limit) as CustomerRow[];
  return rows.map(toCustomer);
}

export function getCustomer(id: number): Customer | null {
  const row = getDb()
    .prepare<[number], CustomerRow>(`SELECT * FROM customers WHERE id = ?`)
    .get(id);
  return row ? toCustomer(row) : null;
}

export function findCustomerByMobile(mobile: string): Customer | null {
  const trimmed = (mobile || '').trim();
  if (!trimmed) return null;
  const row = getDb()
    .prepare<[string], CustomerRow>(`SELECT * FROM customers WHERE mobile = ? LIMIT 1`)
    .get(trimmed);
  return row ? toCustomer(row) : null;
}

/**
 * Inserts or updates. When no id is supplied, an existing customer with the same
 * mobile number is updated instead of creating a duplicate — returning customers
 * are the norm and duplicate rows would break purchase history.
 */
export function saveCustomer(customer: Customer): Customer {
  const db = getDb();
  const name = customer.name.trim();
  if (!name) throw new Error('Customer name is required.');

  const existingId = customer.id ?? findCustomerByMobile(customer.mobile)?.id ?? null;

  if (existingId) {
    db.prepare(
      `UPDATE customers
          SET name = ?, mobile = ?, address = ?, pan = ?, gstin = ?,
              state_code = ?, notes = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(
      name,
      customer.mobile.trim(),
      customer.address.trim(),
      customer.pan.trim().toUpperCase(),
      customer.gstin.trim().toUpperCase(),
      customer.stateCode.trim(),
      customer.notes.trim(),
      existingId,
    );
    return getCustomer(existingId)!;
  }

  const result = db
    .prepare(
      `INSERT INTO customers (name, mobile, address, pan, gstin, state_code, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name,
      customer.mobile.trim(),
      customer.address.trim(),
      customer.pan.trim().toUpperCase(),
      customer.gstin.trim().toUpperCase(),
      customer.stateCode.trim(),
      customer.notes.trim(),
    );

  return getCustomer(Number(result.lastInsertRowid))!;
}

export function deleteCustomer(id: number): void {
  getDb().prepare(`DELETE FROM customers WHERE id = ?`).run(id);
}

export function customerHistory(id: number): InvoiceListRow[] {
  const rows = getDb()
    .prepare<[number]>(
      `SELECT i.id, i.invoice_no, i.invoice_date, i.customer_name, i.customer_mobile,
              i.grand_total, i.payment_mode, i.status,
              (SELECT COUNT(*) FROM invoice_items it WHERE it.invoice_id = i.id) AS item_count
         FROM invoices i
        WHERE i.customer_id = ?
        ORDER BY i.invoice_date DESC, i.id DESC`,
    )
    .all(id) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as number,
    invoiceNo: row.invoice_no as string,
    invoiceDate: row.invoice_date as string,
    customerName: row.customer_name as string,
    customerMobile: row.customer_mobile as string,
    grandTotal: row.grand_total as number,
    paymentMode: row.payment_mode as InvoiceListRow['paymentMode'],
    status: row.status as InvoiceListRow['status'],
    itemCount: row.item_count as number,
  }));
}

export function countCustomers(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS c FROM customers`).get() as { c: number };
  return row.c;
}

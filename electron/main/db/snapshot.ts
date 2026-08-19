import { DEFAULT_SETTINGS } from '../../../shared/defaults';
import type { AppSettings, Customer, Invoice } from '../../../shared/types';
import { getDb } from './connection';
import { listCustomers, saveCustomer } from './customers';
import { getInvoice, getInvoiceByNumber, listInvoices, saveInvoice } from './invoices';
import { getSettings, saveSettings } from './settings';

export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  version: number;
  createdAt: string;
  shopName: string;
  customers: Customer[];
  invoices: Invoice[];
  settings: AppSettings;
}

/** Strips every secret out of a settings object before it can leave the device. */
function withoutCredentials(settings: AppSettings): AppSettings {
  return {
    ...settings,
    firebase: { ...settings.firebase, password: '' },
    whatsapp: { ...settings.whatsapp, accessToken: '' },
  };
}

/**
 * Reads every record out of the local store. Used by every backup path.
 *
 * Settings are ALWAYS stripped of credentials — a snapshot is something that
 * gets written to a file or uploaded, so it must never be able to carry the
 * Firebase password or the WhatsApp token, whatever the caller asks for.
 */
export function createSnapshot(includeSettings = true): Snapshot {
  const settings = getSettings();
  const customers = listCustomers('', 1_000_000);
  const invoiceRows = listInvoices({ limit: 1_000_000 });
  const invoices = invoiceRows
    .map((row) => getInvoice(row.id))
    .filter((invoice): invoice is Invoice => invoice !== null);

  return {
    version: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    shopName: settings.shop.shopName,
    customers,
    invoices,
    settings: withoutCredentials(includeSettings ? settings : DEFAULT_SETTINGS),
  };
}

/** Counts invoices touched since a timestamp, without loading a single row of data. */
export function countInvoicesChangedSince(isoTimestamp: string | null): number {
  const db = getDb();
  if (!isoTimestamp) {
    return (db.prepare(`SELECT COUNT(*) AS c FROM invoices`).get() as { c: number }).c;
  }
  const row = db
    .prepare<[string]>(`SELECT COUNT(*) AS c FROM invoices WHERE updated_at > ?`)
    .get(isoTimestamp) as { c: number };
  return row.c;
}

export interface RestoreCounts {
  invoices: number;
  customers: number;
}

/**
 * Merges a snapshot back in.
 *
 * Customers match on mobile number and invoices on invoice number, so restoring
 * the same backup twice is idempotent rather than doubling the books.
 */
export function restoreSnapshot(snapshot: Snapshot, options: { settings?: boolean } = {}): RestoreCounts {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.invoices)) {
    throw new Error('This file is not a valid Prem Jewellers backup.');
  }
  if (snapshot.version > SNAPSHOT_VERSION) {
    throw new Error(
      `This backup was made by a newer version of the app (v${snapshot.version}). Update the app first.`,
    );
  }

  const db = getDb();
  const counts: RestoreCounts = { invoices: 0, customers: 0 };

  // Old id -> new id, so restored invoices stay attached to their customer.
  const customerIdMap = new Map<number, number>();

  const run = db.transaction(() => {
    for (const customer of snapshot.customers ?? []) {
      const originalId = customer.id;
      const saved = saveCustomer({ ...customer, id: undefined });
      if (originalId && saved.id) customerIdMap.set(originalId, saved.id);
      counts.customers += 1;
    }

    for (const invoice of snapshot.invoices) {
      const existing = getInvoiceByNumber(invoice.invoiceNo);
      const mappedCustomerId =
        invoice.customerId && customerIdMap.has(invoice.customerId)
          ? customerIdMap.get(invoice.customerId)!
          : null;

      saveInvoice({
        ...invoice,
        id: existing?.id,
        customerId: mappedCustomerId,
        items: invoice.items.map((item) => ({ ...item, id: undefined })),
      });
      counts.invoices += 1;
    }

    if (options.settings && snapshot.settings) {
      const current = getSettings();
      saveSettings({
        ...snapshot.settings,
        // Never overwrite live credentials with the blanked-out backup copy.
        firebase: {
          ...snapshot.settings.firebase,
          password: current.firebase.password,
        },
        whatsapp: {
          ...snapshot.settings.whatsapp,
          accessToken: current.whatsapp.accessToken,
        },
      });
    }
  });

  run();
  return counts;
}

/**
 * Removes every business record from this device, unrecoverably.
 *
 * A plain DELETE only marks pages free — the old rows stay legible in the file
 * and can be carved straight back out of it, which would defeat the whole point
 * of the emergency wipe. The order here was established by testing the raw
 * database bytes after each step:
 *
 *   1. secure_delete zeroes page content as it is released, rather than just
 *      unlinking it.
 *   2. The deletes run in one transaction so a crash cannot half-clear the books.
 *   3. VACUUM rebuilds the file so freed pages are gone and the file shrinks.
 *   4. The final checkpoint is essential: under WAL the VACUUM's output lands in
 *      the write-ahead log, so without folding it back and truncating, the old
 *      content survives in the -wal file. Checkpointing only before the VACUUM
 *      (the obvious order) leaves the data readable.
 *
 * Shop settings survive so the app is immediately usable again.
 */
export function clearLocalData(): void {
  const db = getDb();

  db.pragma('secure_delete = ON');

  const wipe = db.transaction(() => {
    db.prepare(`DELETE FROM invoice_items`).run();
    db.prepare(`DELETE FROM invoices`).run();
    db.prepare(`DELETE FROM customers`).run();
    db.prepare(`DELETE FROM sync_state`).run();
    db.prepare(`DELETE FROM sqlite_sequence WHERE name IN ('invoices','invoice_items','customers')`).run();
  });

  wipe();

  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  db.pragma('wal_checkpoint(TRUNCATE)');
}

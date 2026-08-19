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

/** Reads every record out of the local store. Used by every backup path. */
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
    settings: includeSettings
      ? // Credentials never travel inside a portable backup file.
        {
          ...settings,
          firebase: { ...settings.firebase, password: '' },
          whatsapp: { ...settings.whatsapp, accessToken: '' },
        }
      : settings,
  };
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
 * Removes every business record from this device.
 *
 * VACUUM is the point of this function: DELETE alone leaves the old rows sitting
 * in free pages where they can still be carved out of the file. Vacuuming
 * rewrites the database without them. Shop settings survive so the app is
 * immediately usable again.
 */
export function clearLocalData(): void {
  const db = getDb();

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
}

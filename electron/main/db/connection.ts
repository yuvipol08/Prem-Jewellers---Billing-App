import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';

let db: Database.Database | null = null;

export function getDatabasePath(): string {
  return path.join(app.getPath('userData'), 'prem-jewellers.db');
}

/**
 * Opens the local store, creating it on first run.
 *
 * WAL keeps reads fast while a bill is being written, and NORMAL synchronous is
 * the right trade for a single-till shop machine: durable across app crashes,
 * without an fsync on every keystroke-driven save.
 */
export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = getDatabasePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);
  return db;
}

export function closeDb(): void {
  if (!db) return;
  try {
    // Fold the WAL back into the main file so a copied .db is complete.
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } finally {
    db = null;
  }
}

/**
 * Forward-only migrations keyed off user_version. Each step runs exactly once
 * and the whole batch is transactional, so an interrupted upgrade never leaves
 * a half-migrated database behind.
 */
function runMigrations(database: Database.Database): void {
  const migrations: ((d: Database.Database) => void)[] = [
    (d) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS customers (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          name         TEXT NOT NULL,
          mobile       TEXT NOT NULL DEFAULT '',
          address      TEXT NOT NULL DEFAULT '',
          pan          TEXT NOT NULL DEFAULT '',
          gstin        TEXT NOT NULL DEFAULT '',
          state_code   TEXT NOT NULL DEFAULT '',
          notes        TEXT NOT NULL DEFAULT '',
          created_at   TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile);
        CREATE INDEX IF NOT EXISTS idx_customers_name   ON customers(name);
        CREATE INDEX IF NOT EXISTS idx_customers_gstin  ON customers(gstin);

        CREATE TABLE IF NOT EXISTS invoices (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_no        TEXT NOT NULL UNIQUE,
          invoice_date      TEXT NOT NULL,
          customer_id       INTEGER REFERENCES customers(id) ON DELETE SET NULL,
          customer_name     TEXT NOT NULL DEFAULT '',
          customer_mobile   TEXT NOT NULL DEFAULT '',
          customer_address  TEXT NOT NULL DEFAULT '',
          customer_pan      TEXT NOT NULL DEFAULT '',
          customer_gstin    TEXT NOT NULL DEFAULT '',
          customer_state    TEXT NOT NULL DEFAULT '',
          intra_state       INTEGER NOT NULL DEFAULT 1,
          discount          REAL NOT NULL DEFAULT 0,
          taxable_value     REAL NOT NULL DEFAULT 0,
          cgst              REAL NOT NULL DEFAULT 0,
          sgst              REAL NOT NULL DEFAULT 0,
          igst              REAL NOT NULL DEFAULT 0,
          round_off         REAL NOT NULL DEFAULT 0,
          grand_total       REAL NOT NULL DEFAULT 0,
          total_gross_wt    REAL NOT NULL DEFAULT 0,
          total_net_wt      REAL NOT NULL DEFAULT 0,
          payment_mode      TEXT NOT NULL DEFAULT 'Cash',
          payment_reference TEXT NOT NULL DEFAULT '',
          amount_paid       REAL NOT NULL DEFAULT 0,
          notes             TEXT NOT NULL DEFAULT '',
          status            TEXT NOT NULL DEFAULT 'saved',
          created_at        TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_invoices_date     ON invoices(invoice_date);
        CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_mobile   ON invoices(customer_mobile);

        CREATE TABLE IF NOT EXISTS invoice_items (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_id          INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          line_no             INTEGER NOT NULL,
          hsn_code            TEXT NOT NULL DEFAULT '',
          particulars         TEXT NOT NULL DEFAULT '',
          gross_weight        REAL NOT NULL DEFAULT 0,
          net_weight          REAL NOT NULL DEFAULT 0,
          rate                REAL NOT NULL DEFAULT 0,
          making_charge_mode  TEXT NOT NULL DEFAULT 'flat',
          making_charge_value REAL NOT NULL DEFAULT 0,
          making_charge       REAL NOT NULL DEFAULT 0,
          gst_rate            REAL NOT NULL DEFAULT 3,
          amount              REAL NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id);

        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_state (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  ];

  const currentVersion = database.pragma('user_version', { simple: true }) as number;

  for (let version = currentVersion; version < migrations.length; version += 1) {
    const migrate = migrations[version];
    const apply = database.transaction(() => {
      migrate(database);
      database.pragma(`user_version = ${version + 1}`);
    });
    apply();
  }
}

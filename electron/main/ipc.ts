import { BrowserWindow, app, ipcMain } from 'electron';
import { IPC } from '../../shared/api';
import type {
  AppSettings,
  Customer,
  Invoice,
  InvoiceFilter,
  OperationResult,
} from '../../shared/types';
import { getDatabasePath } from './db/connection';
import {
  customerHistory,
  deleteCustomer,
  getCustomer,
  listCustomers,
  saveCustomer,
} from './db/customers';
import { dashboardSummary } from './db/dashboard';
import {
  canEditInvoice,
  cancelInvoice,
  deleteInvoice,
  duplicateInvoice,
  getInvoice,
  listInvoices,
  nextInvoiceNumber,
  saveInvoice,
} from './db/invoices';
import { getSettings, saveSettings } from './db/settings';
import {
  chooseBackupFolder,
  cloudBackup,
  cloudRestore,
  cloudStatus,
  emergencyBackupAndClear,
  exportLocalBackup,
  importLocalBackup,
} from './services/backup';
import { clearCloudSession, testCloudConnection } from './services/cloud';
import {
  buildInvoiceHtml,
  exportInvoicePdf,
  openPath,
  printInvoice,
  revealPath,
  saveInvoicePdfAs,
} from './services/documents';
import { shareInvoiceOnWhatsApp } from './services/whatsapp';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Wraps a handler so the renderer always receives `{ ok, message, data }`
 * instead of a rejected promise. An unexpected failure surfaces as a readable
 * message on screen rather than an unhandled rejection in the console.
 */
function guarded<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | Promise<TResult>,
): (...args: TArgs) => Promise<OperationResult<TResult>> {
  return async (...args: TArgs) => {
    try {
      const data = await handler(...args);
      return { ok: true, data };
    } catch (error) {
      console.error('[ipc]', error);
      return { ok: false, message: errorMessage(error) };
    }
  };
}

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function registerIpcHandlers(): void {
  // ------------------------------------------------------------------- app
  ipcMain.handle(IPC.appVersion, () => app.getVersion());
  ipcMain.handle(IPC.appPlatform, () => process.platform);
  ipcMain.handle(IPC.appDataPath, () => getDatabasePath());

  // -------------------------------------------------------------- settings
  ipcMain.handle(IPC.settingsGet, () => getSettings());
  ipcMain.handle(
    IPC.settingsSave,
    guarded((_event: unknown, settings: AppSettings) => {
      const saved = saveSettings(settings);
      // Credentials may have changed — drop any cached Firebase token.
      clearCloudSession();
      return saved;
    }),
  );

  // ------------------------------------------------------------- customers
  ipcMain.handle(IPC.customersList, (_event, search: string, limit: number) =>
    listCustomers(search, limit),
  );
  ipcMain.handle(IPC.customersGet, (_event, id: number) => getCustomer(id));
  ipcMain.handle(
    IPC.customersSave,
    guarded((_event: unknown, customer: Customer) => saveCustomer(customer)),
  );
  ipcMain.handle(
    IPC.customersRemove,
    guarded((_event: unknown, id: number) => {
      deleteCustomer(id);
    }),
  );
  ipcMain.handle(IPC.customersHistory, (_event, id: number) => customerHistory(id));

  // -------------------------------------------------------------- invoices
  ipcMain.handle(IPC.invoicesNextNumber, () => nextInvoiceNumber());
  ipcMain.handle(IPC.invoicesList, (_event, filter: InvoiceFilter) => listInvoices(filter));
  ipcMain.handle(IPC.invoicesGet, (_event, id: number) => getInvoice(id));
  ipcMain.handle(
    IPC.invoicesSave,
    guarded((_event: unknown, invoice: Invoice) => saveInvoice(invoice)),
  );
  ipcMain.handle(
    IPC.invoicesCancel,
    guarded((_event: unknown, id: number) => {
      cancelInvoice(id);
    }),
  );
  ipcMain.handle(
    IPC.invoicesRemove,
    guarded((_event: unknown, id: number) => {
      deleteInvoice(id);
    }),
  );
  ipcMain.handle(
    IPC.invoicesDuplicate,
    guarded((_event: unknown, id: number) => {
      const copy = duplicateInvoice(id);
      if (!copy) throw new Error('That invoice could not be found.');
      return copy;
    }),
  );
  ipcMain.handle(IPC.invoicesCanEdit, (_event, id: number) => canEditInvoice(id));

  // ------------------------------------------------------------- documents
  ipcMain.handle(IPC.docsPreviewHtml, (_event, invoice: Invoice, copyLabel?: string) =>
    buildInvoiceHtml(invoice, copyLabel, true),
  );
  ipcMain.handle(
    IPC.docsExportPdf,
    guarded(async (_event: unknown, invoice: Invoice, copyLabel?: string) => ({
      filePath: await exportInvoicePdf(invoice, copyLabel),
    })),
  );
  ipcMain.handle(
    IPC.docsSaveAsPdf,
    guarded(async (_event: unknown, invoice: Invoice, copyLabel?: string) => {
      const filePath = await saveInvoicePdfAs(focusedWindow(), invoice, copyLabel);
      if (!filePath) throw new Error('Save cancelled.');
      return { filePath };
    }),
  );
  ipcMain.handle(
    IPC.docsPrint,
    guarded((_event: unknown, invoice: Invoice, copyLabel?: string) =>
      printInvoice(invoice, copyLabel),
    ),
  );
  ipcMain.handle(
    IPC.docsOpenFile,
    guarded((_event: unknown, filePath: string) => openPath(filePath)),
  );
  ipcMain.handle(
    IPC.docsRevealFile,
    guarded((_event: unknown, filePath: string) => {
      revealPath(filePath);
    }),
  );

  // -------------------------------------------------------------- whatsapp
  ipcMain.handle(
    IPC.whatsappShare,
    guarded(async (_event: unknown, invoice: Invoice) => {
      const result = await shareInvoiceOnWhatsApp(invoice);
      return { mode: result.mode };
    }),
  );

  // ------------------------------------------------------------- dashboard
  ipcMain.handle(IPC.dashboardSummary, () => dashboardSummary());

  // ---------------------------------------------------------------- backup
  ipcMain.handle(
    IPC.backupExportLocal,
    guarded(async () => {
      const result = await exportLocalBackup(focusedWindow());
      if (!result) throw new Error('Backup cancelled.');
      return result;
    }),
  );
  ipcMain.handle(
    IPC.backupImportLocal,
    guarded(async () => {
      const result = await importLocalBackup(focusedWindow());
      if (!result) throw new Error('Restore cancelled.');
      return result;
    }),
  );
  ipcMain.handle(
    IPC.backupChooseFolder,
    guarded(async () => {
      const folder = await chooseBackupFolder(focusedWindow());
      if (!folder) throw new Error('No folder selected.');
      return { folder };
    }),
  );
  ipcMain.handle(IPC.backupCloudStatus, () => cloudStatus());
  ipcMain.handle(
    IPC.backupCloudBackup,
    guarded(() => cloudBackup()),
  );
  ipcMain.handle(
    IPC.backupCloudRestore,
    guarded(() => cloudRestore()),
  );
  ipcMain.handle(
    IPC.backupTestCloud,
    guarded(() => testCloudConnection(getSettings().firebase)),
  );
  ipcMain.handle(
    IPC.backupEmergency,
    guarded((_event: unknown, confirmation: string) => emergencyBackupAndClear(confirmation)),
  );
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import { computeInvoice } from '../../../shared/calc';
import { renderInvoiceHtml } from '../../../shared/invoiceTemplate';
import type { Invoice } from '../../../shared/types';
import { getSettings } from '../db/settings';

/** Safe file name for an invoice PDF: "PJ_25-26_0001_Ramesh.pdf". */
export function pdfFileName(invoice: Invoice): string {
  const invoiceNo = invoice.invoiceNo.replace(/[^\w-]+/g, '_');
  const customer = invoice.customerName.trim().replace(/[^\w]+/g, '_').slice(0, 24);
  return customer ? `${invoiceNo}_${customer}.pdf` : `${invoiceNo}.pdf`;
}

export function buildInvoiceHtml(invoice: Invoice, copyLabel?: string, screenPreview = false): string {
  const { shop } = getSettings();
  return renderInvoiceHtml(computeInvoice(invoice), shop, { copyLabel, screenPreview });
}

/** Renders are serialised: two hidden windows at once is wasted work on an old till PC. */
let renderQueue: Promise<unknown> = Promise.resolve();
let renderWindow: BrowserWindow | null = null;

/**
 * One hidden window is created on first use and reused for every render.
 *
 * Reuse is deliberate, not just an optimisation: creating and destroying a
 * BrowserWindow per invoice makes subsequent navigations fail outright on some
 * platforms, and it also costs window construction on every single bill. One
 * warm window keeps PDF export instant on an old laptop.
 */
function getRenderWindow(): BrowserWindow {
  if (renderWindow && !renderWindow.isDestroyed()) return renderWindow;

  renderWindow = new BrowserWindow({
    show: false,
    width: 794, // 210mm at 96dpi
    height: 1123,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // The invoice is static markup; no page script ever needs to run.
      javascript: false,
    },
  });

  renderWindow.on('closed', () => {
    renderWindow = null;
  });

  return renderWindow;
}

/** Tears the render window down on quit. */
export function disposeRenderWindow(): void {
  if (renderWindow && !renderWindow.isDestroyed()) renderWindow.destroy();
  renderWindow = null;
}

/**
 * Loads the invoice markup into the shared hidden window and hands it to
 * `action`. The markup goes through a temp file rather than a `data:` URL —
 * Chromium treats long data URLs as opaque and intermittently refuses to
 * navigate to them. The temp file is always removed, even on failure.
 */
function withRenderWindow<T>(
  html: string,
  action: (window: BrowserWindow) => Promise<T>,
): Promise<T> {
  const run = async (): Promise<T> => {
    const folder = path.join(os.tmpdir(), 'prem-jewellers-render');
    fs.mkdirSync(folder, { recursive: true });
    const htmlPath = path.join(folder, `invoice-${process.pid}-${Date.now()}.html`);
    fs.writeFileSync(htmlPath, html, 'utf8');

    const window = getRenderWindow();
    try {
      await window.loadFile(htmlPath);
      return await action(window);
    } finally {
      fs.rmSync(htmlPath, { force: true });
    }
  };

  const result = renderQueue.then(run, run);
  // Keep the chain alive even when a render fails.
  renderQueue = result.catch(() => undefined);
  return result;
}

const PDF_OPTIONS = {
  pageSize: 'A4' as const,
  printBackground: true,
  landscape: false,
  // @page in the template already reserves the physical margins.
  margins: { top: 0, bottom: 0, left: 0, right: 0 },
  preferCSSPageSize: true,
};

export async function renderInvoicePdf(invoice: Invoice, copyLabel?: string): Promise<Buffer> {
  const html = buildInvoiceHtml(invoice, copyLabel);
  return withRenderWindow(html, (window) => window.webContents.printToPDF(PDF_OPTIONS));
}

/** Writes the PDF to a temp folder — the fast path used by preview and WhatsApp. */
export async function exportInvoicePdf(invoice: Invoice, copyLabel?: string): Promise<string> {
  const buffer = await renderInvoicePdf(invoice, copyLabel);
  const folder = path.join(os.tmpdir(), 'prem-jewellers-invoices');
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, pdfFileName(invoice));
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/** Asks where to save, then writes the PDF there. Returns '' if cancelled. */
export async function saveInvoicePdfAs(
  parent: BrowserWindow | null,
  invoice: Invoice,
  copyLabel?: string,
): Promise<string> {
  const defaultPath = path.join(
    getSettings().shop.localBackupFolder || os.homedir(),
    pdfFileName(invoice),
  );

  const result = parent
    ? await dialog.showSaveDialog(parent, {
        title: 'Save Invoice PDF',
        defaultPath,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      })
    : await dialog.showSaveDialog({
        title: 'Save Invoice PDF',
        defaultPath,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      });

  if (result.canceled || !result.filePath) return '';

  const buffer = await renderInvoicePdf(invoice, copyLabel);
  fs.writeFileSync(result.filePath, buffer);
  return result.filePath;
}

export interface PrinterChoice {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

/**
 * Whether the OS reports this as the default printer.
 *
 * Electron moved this out of PrinterInfo and into the platform-specific
 * `options` bag, where the key differs per platform — Windows reports
 * "printer-is-default", CUPS reports "is-default". Read whatever is there
 * rather than assuming a shape.
 */
function isDefaultPrinter(options: Record<string, unknown> | undefined): boolean {
  if (!options) return false;
  for (const [key, value] of Object.entries(options)) {
    if (!/default/i.test(key)) continue;
    if (value === true || value === 'true' || value === 'yes' || value === 1) return true;
  }
  return false;
}

/** Printers the OS is offering, for the in-app picker. */
export async function listPrinters(): Promise<PrinterChoice[]> {
  return withRenderWindow('<!doctype html><html><body></body></html>', async (window) => {
    const printers = await window.webContents.getPrintersAsync();
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      description: printer.description ?? '',
      isDefault: isDefaultPrinter(printer.options as Record<string, unknown> | undefined),
    }));
  });
}

export interface PrintRequest {
  copyLabel?: string;
  /** OS printer name. Omit to use the system default. */
  deviceName?: string;
  copies?: number;
  /**
   * Opens the operating system's print dialog instead of printing straight
   * away. Electron does not implement Chromium's print-preview data source, so
   * that dialog shows "This app doesn't support print preview" — which is why
   * it is not the default path. It stays available for printer-specific options
   * like trays and duplex.
   */
  useSystemDialog?: boolean;
}

export interface PrintOutcome {
  printed: boolean;
  cancelled: boolean;
  deviceName: string;
}

/**
 * Prints the invoice from the same HTML the preview and the PDF are built from.
 *
 * The default path is a silent print to a named printer, chosen in the app. That
 * is deliberate: Electron's own dialog cannot show a preview, so putting an
 * empty preview pane in front of the shop on every bill looked broken. The app's
 * A4 preview is the preview, and printing is then one click to the till printer.
 */
export async function printInvoice(
  invoice: Invoice,
  request: PrintRequest = {},
): Promise<PrintOutcome> {
  const html = buildInvoiceHtml(invoice, request.copyLabel);
  const silent = request.useSystemDialog !== true;

  let deviceName = request.deviceName?.trim() ?? '';
  if (silent && !deviceName) {
    const printers = await listPrinters();
    if (printers.length === 0) {
      throw new Error(
        'No printer is available. Connect a printer, or use Save PDF to print from another program.',
      );
    }
    deviceName = (printers.find((printer) => printer.isDefault) ?? printers[0]).name;
  }

  return withRenderWindow(html, async (window) => {
    return new Promise<PrintOutcome>((resolve, reject) => {
      window.webContents.print(
        {
          silent,
          ...(deviceName ? { deviceName } : {}),
          copies: Math.max(1, Math.min(request.copies ?? 1, 10)),
          printBackground: true,
          pageSize: 'A4',
          landscape: false,
          // The template reserves its own margins in millimetres; letting the
          // driver add more would push the weight columns out of alignment.
          margins: { marginType: 'none' },
        },
        (success, failureReason) => {
          if (success) {
            resolve({ printed: true, cancelled: false, deviceName });
            return;
          }
          // Dismissing the system dialog reports failure with a cancellation
          // reason — that is a choice, not an error worth showing.
          if (!failureReason || /cancel/i.test(failureReason)) {
            resolve({ printed: false, cancelled: true, deviceName });
            return;
          }
          reject(new Error(failureReason));
        },
      );
    });
  });
}

export async function openPath(filePath: string): Promise<void> {
  const error = await shell.openPath(filePath);
  if (error) throw new Error(error);
}

export function revealPath(filePath: string): void {
  shell.showItemInFolder(filePath);
}

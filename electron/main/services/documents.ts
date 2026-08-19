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

/** Sends the invoice to the OS print dialog, rendered from the same HTML as the PDF. */
export async function printInvoice(invoice: Invoice, copyLabel?: string): Promise<void> {
  const html = buildInvoiceHtml(invoice, copyLabel);
  await withRenderWindow(html, async (window) => {
    await new Promise<void>((resolve, reject) => {
      window.webContents.print(
        {
          silent: false,
          printBackground: true,
          pageSize: 'A4',
          margins: { marginType: 'none' },
        },
        (success, failureReason) => {
          // Closing the print dialog reports failure with no reason — not an error.
          if (success || !failureReason || /cancel/i.test(failureReason)) resolve();
          else reject(new Error(failureReason));
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

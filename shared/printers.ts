/**
 * Choosing which printer a bill goes to.
 *
 * Pure logic, kept out of the Electron service so the rules can be tested
 * directly — getting this wrong sends a customer's invoice into OneNote.
 */

export interface PrinterChoice {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

/**
 * Printers that capture the job into a file or an app instead of putting ink on
 * paper. They are perfectly valid choices when the shop picks one deliberately,
 * but must never be guessed at: "Print" landing in OneNote looks like a bug.
 */
const VIRTUAL_PRINTER_PATTERNS = [
  /onenote/i,
  /print\s*to\s*pdf/i,
  /\bpdf\b/i,
  /xps\s*document\s*writer/i,
  /\bfax\b/i,
  /send\s*to\s*/i,
  /microsoft\s*document\s*imaging/i,
  /\bonedrive\b/i,
  /adobe\s*pdf/i,
  /cutepdf|bullzip|dopdf|pdfcreator|foxit/i,
];

export function isVirtualPrinter(printer: { name: string; displayName?: string }): boolean {
  const haystack = `${printer.name} ${printer.displayName ?? ''}`;
  return VIRTUAL_PRINTER_PATTERNS.some((pattern) => pattern.test(haystack));
}

export interface PrinterSelectionInput {
  printers: PrinterChoice[];
  /** The printer the shop chose previously, from settings. */
  remembered?: string;
  /** The OS default, read from the platform where that is possible. */
  systemDefault?: string;
}

export interface PrinterSelection {
  name: string;
  reason: 'remembered' | 'system-default' | 'first-physical' | 'first-available' | 'none';
}

/**
 * Picks the printer to preselect.
 *
 * Order matters and is deliberate:
 *
 *  1. What the shop chose last time, if it is still connected. An explicit
 *     choice outranks anything we could infer.
 *  2. The operating system's default printer.
 *  3. The first printer that puts ink on paper. This is the step that was
 *     missing: without it the fallback was simply `printers[0]`, which on a
 *     stock Windows install is often OneNote or Microsoft Print to PDF.
 *  4. Only then, whatever is available.
 */
export function selectPrinter(input: PrinterSelectionInput): PrinterSelection {
  const printers = input.printers ?? [];
  if (printers.length === 0) return { name: '', reason: 'none' };

  const byName = (name: string | undefined) =>
    name ? printers.find((printer) => printer.name === name) : undefined;

  const remembered = byName(input.remembered?.trim());
  if (remembered) return { name: remembered.name, reason: 'remembered' };

  const systemDefault =
    byName(input.systemDefault?.trim()) ?? printers.find((printer) => printer.isDefault);
  if (systemDefault) return { name: systemDefault.name, reason: 'system-default' };

  const physical = printers.find((printer) => !isVirtualPrinter(printer));
  if (physical) return { name: physical.name, reason: 'first-physical' };

  return { name: printers[0].name, reason: 'first-available' };
}

/** Sorts real printers above virtual ones so the dropdown reads sensibly. */
export function orderPrinters(printers: PrinterChoice[]): PrinterChoice[] {
  return [...printers].sort((a, b) => {
    const virtualA = isVirtualPrinter(a) ? 1 : 0;
    const virtualB = isVirtualPrinter(b) ? 1 : 0;
    if (virtualA !== virtualB) return virtualA - virtualB;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Reads the printer name out of the Windows registry `Device` value, which
 * looks like `Brother HL-2270DW,winspool,Ne01:`. Returns '' for anything
 * unexpected rather than guessing.
 */
export function parseWindowsDefaultPrinter(registryOutput: string): string {
  const match = /Device\s+REG_SZ\s+(.+)/i.exec(registryOutput);
  if (!match) return '';
  return match[1].split(',')[0]!.trim();
}

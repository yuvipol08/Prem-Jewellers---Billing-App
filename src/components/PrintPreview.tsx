import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PrinterChoice } from '@shared/api';
import type { Invoice } from '@shared/types';
import { api } from '../lib/api';
import { Modal } from './Modal';

interface PrintPreviewProps {
  invoice: Invoice;
  copyLabel?: string;
  onClose(): void;
  onPrint(request: { deviceName?: string; useSystemDialog?: boolean }): void;
  onExportPdf(): void;
  busy?: boolean;
}

/** A4 portrait at 96dpi — the sheet size the template renders at. */
const SHEET_WIDTH = 794;
const SHEET_HEIGHT = 1123;

/**
 * Shows the exact HTML that the printer and the PDF exporter will render, and
 * carries the print controls.
 *
 * Two details are load bearing:
 *
 * 1. The frame carries `allow-same-origin`. With a bare `sandbox=""` the document
 *    gets an opaque origin and Chromium then drops its inline `<style>` even
 *    though the page CSP allows `'unsafe-inline'` — the invoice rendered
 *    completely unstyled, which read as a blank preview. Scripts stay blocked.
 *
 * 2. The sheet is scaled to fit the stage in BOTH directions, and only the stage
 *    scrolls. Sizing the sheet at full height inside a scrolling modal body gave
 *    two nested scrollbars for the same content.
 */
export function PrintPreview({
  invoice,
  copyLabel,
  onClose,
  onPrint,
  onExportPdf,
  busy,
}: PrintPreviewProps) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [scale, setScale] = useState(1);
  const [printers, setPrinters] = useState<PrinterChoice[] | null>(null);
  const [selected, setSelected] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api()
      .documents.previewHtml(invoice, copyLabel)
      .then((markup) => {
        if (!cancelled) setHtml(markup);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [invoice, copyLabel]);

  useEffect(() => {
    let cancelled = false;
    void api()
      .documents.listPrinters()
      .then((found) => {
        if (cancelled) return;
        setPrinters(found);
        setSelected((found.find((printer) => printer.isDefault) ?? found[0])?.name ?? '');
      })
      .catch(() => {
        if (!cancelled) setPrinters([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Fits a whole A4 page inside the stage, so normally nothing needs to scroll. */
  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const byWidth = (stage.clientWidth - 28) / SHEET_WIDTH;
    const byHeight = (stage.clientHeight - 28) / SHEET_HEIGHT;
    const next = Math.min(byWidth, byHeight);
    if (Number.isFinite(next) && next > 0) setScale(Math.min(1, Math.max(0.3, next)));
  }, []);

  useLayoutEffect(() => {
    fit();
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fit, html]);

  const noPrinters = printers !== null && printers.length === 0;

  return (
    <Modal
      title="Print Preview — A4"
      onClose={onClose}
      wide
      flush
      footer={
        <>
          <div className="print-controls">
            <label className="print-controls-label" htmlFor="printer-choice">
              Printer
            </label>
            <select
              id="printer-choice"
              className="select"
              value={selected}
              disabled={printers === null || noPrinters || busy}
              onChange={(event) => setSelected(event.target.value)}
            >
              {printers === null ? <option>Looking for printers…</option> : null}
              {noPrinters ? <option>No printer found</option> : null}
              {(printers ?? []).map((printer) => (
                <option key={printer.name} value={printer.name}>
                  {printer.displayName}
                  {printer.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              title="Opens the operating system print dialog for tray and duplex options"
              onClick={() => onPrint({ useSystemDialog: true })}
            >
              System dialog…
            </button>
          </div>

          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button type="button" className="btn" onClick={onExportPdf} disabled={busy}>
            Save PDF
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || noPrinters}
            onClick={() => onPrint({ deviceName: selected || undefined })}
          >
            {busy ? <span className="spinner" /> : null}
            Print
          </button>
        </>
      }
    >
      {error ? (
        <div className="empty">
          <div className="empty-title">Preview failed</div>
          <div>{error}</div>
        </div>
      ) : (
        <>
          <div className="preview-stage" ref={stageRef}>
            <div
              className="preview-sheet"
              style={{ width: SHEET_WIDTH * scale, height: SHEET_HEIGHT * scale }}
            >
              <iframe
                className="preview-frame"
                title="Invoice preview"
                sandbox="allow-same-origin"
                srcDoc={html}
                scrolling="no"
                style={{
                  width: SHEET_WIDTH,
                  height: SHEET_HEIGHT,
                  transform: `scale(${scale})`,
                }}
              />
            </div>
          </div>
          <div className="preview-scale">
            A4 210 × 297 mm · shown at {Math.round(scale * 100)}%
          </div>
        </>
      )}
    </Modal>
  );
}
